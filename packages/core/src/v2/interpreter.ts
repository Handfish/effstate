/**
 * EffState v2 Interpreter
 *
 * The interpreter is responsible for:
 * - Creating and managing machine actors
 * - Processing events through state handlers
 * - Executing transitions (goto, update, stay)
 * - Managing child machines
 * - Running entry/exit effects
 * - Handling `run` (Effect or Stream)
 */

import {
  Cause,
  Effect,
  Exit,
  Fiber,
  Option,
  Runtime,
  Scope,
  Stream,
} from "effect";
import type {
  MachineState,
  MachineContext,
  MachineEvent,
  MachineDefinition,
  MachineSnapshot,
  MachineActor,
  MachineConfig,
  ChildrenConfig,
  InterpretOptions,
  TransitionResult,
  GotoTransition,
  UpdateTransition,
  StayTransition,
  AnyMachineActor,
  StateConfig,
  TransitionBuilders,
} from "./types.js";
import { isGoto, isUpdate, isStay, createTransitionBuilders } from "./transitions.js";

// ============================================================================
// Mailbox (Event Queue)
// ============================================================================

interface MailboxItem<T> {
  value: T;
  next: MailboxItem<T> | null;
}

class Mailbox<T> {
  private _processing = false;
  private _current: MailboxItem<T> | null = null;
  private _last: MailboxItem<T> | null = null;
  private _processor: (event: T) => void;

  constructor(processor: (event: T) => void) {
    this._processor = processor;
  }

  enqueue(event: T): void {
    const item: MailboxItem<T> = { value: event, next: null };

    if (this._current) {
      this._last!.next = item;
      this._last = item;
    } else {
      this._current = item;
      this._last = item;
    }

    if (!this._processing) {
      this.flush();
    }
  }

  private flush(): void {
    this._processing = true;
    while (this._current) {
      const item = this._current;
      this._current = item.next;
      if (!this._current) {
        this._last = null;
      }
      this._processor(item.value);
    }
    this._processing = false;
  }
}

// ============================================================================
// Interpreter
// ============================================================================

/**
 * Create an interpreter for a v2 machine definition.
 * Returns an Effect that creates the actor within the current Scope.
 */
export function createInterpreter<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
  TContextSchema extends import("effect").Schema.Schema.Any,
  TEmits extends MachineEvent,
  TChildren extends ChildrenConfig,
  R,
>(
  definition: MachineDefinition<S, C, E, TContextSchema, TEmits, TChildren, R>,
  options?: InterpretOptions<S, C>
): Effect.Effect<MachineActor<S, C, E, TChildren>, never, R | Scope.Scope> {
  return Effect.flatMap(Effect.runtime<R>(), (runtime) => {
    const actor = createActor(definition, runtime, options);

    // Register cleanup when scope closes
    return Effect.as(
      Effect.addFinalizer(() => Effect.sync(() => actor.stop())),
      actor
    );
  });
}

/**
 * Internal actor creation
 */
function createActor<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
  TContextSchema extends import("effect").Schema.Schema.Any,
  TEmits extends MachineEvent,
  TChildren extends ChildrenConfig,
  R,
>(
  definition: MachineDefinition<S, C, E, TContextSchema, TEmits, TChildren, R>,
  runtime: Runtime.Runtime<R>,
  options?: InterpretOptions<S, C>
): MachineActor<S, C, E, TChildren> {
  const config = definition.config;

  // ============================================================================
  // State
  // ============================================================================

  let snapshot: MachineSnapshot<S, C> =
    options?.snapshot ?? definition.initialSnapshot;
  let stopped = false;

  const observers = new Set<(snapshot: MachineSnapshot<S, C>) => void>();
  const childrenRef = new Map<string, AnyMachineActor>();

  // Active fibers for cleanup
  const runFiber = { current: null as Fiber.RuntimeFiber<unknown, unknown> | null };
  const entryFiber = { current: null as Fiber.RuntimeFiber<unknown, unknown> | null };

  // ============================================================================
  // Runtime Helpers
  // ============================================================================

  const runFork = <A>(eff: Effect.Effect<A, never, R>): Fiber.RuntimeFiber<A, never> =>
    Runtime.runFork(runtime)(eff);

  const runPromiseExit = <A, E2>(
    eff: Effect.Effect<A, E2, R>
  ): Promise<Exit.Exit<A, E2>> => Runtime.runPromiseExit(runtime)(eff);

  // ============================================================================
  // Notifications
  // ============================================================================

  const notifyObservers = () => {
    observers.forEach((observer) => {
      try {
        observer(snapshot);
      } catch {
        // Isolate observer errors
      }
    });
  };

  // ============================================================================
  // Child Management
  // ============================================================================

  const spawnChild = (
    childId: string,
    childSnapshot?: MachineSnapshot<MachineState, MachineContext>
  ) => {
    if (childrenRef.has(childId)) return; // Already spawned

    const childDef = config.children?.[childId];
    if (!childDef) {
      console.warn(`Cannot spawn unknown child: ${childId}`);
      return;
    }

    // Create child actor (recursive interpreter call)
    // Pass snapshot if restoring from persistence
    const childActor = createActor(
      childDef as MachineDefinition<any, any, any, any, any, any, any>,
      runtime as Runtime.Runtime<any>,
      {
        parent: actor as unknown as AnyMachineActor,
        snapshot: childSnapshot,
      }
    );

    childrenRef.set(childId, childActor);

    // Subscribe to child events if configured
    const childEventConfig = config.childEvents?.[childId];
    if (childEventConfig) {
      // Subscribe to state changes
      if (childEventConfig.onState) {
        childActor.subscribe((childSnapshot: any) => {
          const event = (childEventConfig.onState as any)(childSnapshot.state);
          if (event) {
            mailbox.enqueue(event as E);
          }
        });
      }
    }
  };

  const despawnChild = (childId: string) => {
    const child = childrenRef.get(childId);
    if (child) {
      child.stop();
      childrenRef.delete(childId);
    }
  };

  const sendToChild = (childId: string, event: MachineEvent) => {
    const child = childrenRef.get(childId);
    if (child) {
      child.send(event);
    }
  };

  // ============================================================================
  // Run Management (Effect or Stream)
  // ============================================================================

  const stopCurrentRun = () => {
    if (runFiber.current) {
      Effect.runFork(Fiber.interrupt(runFiber.current));
      runFiber.current = null;
    }
  };

  const startRun = (stateTag: S["_tag"]) => {
    const stateConfig = config.states[stateTag] as StateConfig<S, C, E, typeof stateTag, TChildren, TEmits, R> | undefined;
    if (!stateConfig?.run) return;

    const run = stateConfig.run;

    // Check if it's an Effect first (since Effect.isEffect exists)
    // If not an Effect, assume it's a Stream
    if (Effect.isEffect(run)) {
      // Effect: run once, apply result as transition
      const effectWithHandler = (run as Effect.Effect<TransitionResult<S, C, R>, never, R>).pipe(
        Effect.flatMap((result) =>
          Effect.sync(() => {
            if (!stopped) {
              applyTransition(result);
            }
          })
        ),
        Effect.catchAllCause((cause) =>
          Effect.sync(() => {
            console.error("Run effect failed:", Cause.pretty(cause));
          })
        )
      );

      runFiber.current = runFork(effectWithHandler);
    } else {
      // Stream: subscribe and forward events
      const streamEffect = Stream.runForEach(run as Stream.Stream<E, never, R>, (event) =>
        Effect.sync(() => {
          if (!stopped) {
            mailbox.enqueue(event);
          }
        })
      );

      runFiber.current = runFork(streamEffect as Effect.Effect<void, never, R>);
    }
  };

  // ============================================================================
  // Entry/Exit Effects
  // ============================================================================

  const stopCurrentEntry = () => {
    if (entryFiber.current) {
      Effect.runFork(Fiber.interrupt(entryFiber.current));
      entryFiber.current = null;
    }
  };

  const runEntry = (stateTag: S["_tag"], state: S) => {
    const stateConfig = config.states[stateTag] as StateConfig<S, C, E, typeof stateTag, TChildren, TEmits, R> | undefined;
    if (!stateConfig?.entry) return;

    const entryEffect = stateConfig.entry(state as any);
    entryFiber.current = runFork(
      entryEffect.pipe(
        Effect.catchAllCause((cause) =>
          Effect.sync(() => {
            console.error("Entry effect failed:", Cause.pretty(cause));
          })
        )
      ) as Effect.Effect<void, never, R>
    );
  };

  const runExit = (stateTag: S["_tag"], state: S) => {
    const stateConfig = config.states[stateTag] as StateConfig<S, C, E, typeof stateTag, TChildren, TEmits, R> | undefined;
    if (!stateConfig?.exit) return;

    // Exit runs synchronously (fire and forget)
    const exitEffect = stateConfig.exit(state as any);
    runFork(
      exitEffect.pipe(
        Effect.catchAllCause((cause) =>
          Effect.sync(() => {
            console.error("Exit effect failed:", Cause.pretty(cause));
          })
        )
      ) as Effect.Effect<void, never, R>
    );
  };

  // ============================================================================
  // Transition Application
  // ============================================================================

  const applyTransition = (result: TransitionResult<S, C, R>) => {
    if (stopped) return;

    // Execute spawns (no snapshot - fresh child)
    for (const spawn of result.spawns) {
      spawnChild(spawn.childId);
    }

    // Execute despawns
    for (const despawn of result.despawns) {
      despawnChild(despawn);
    }

    // Execute sends to children
    for (const send of result.sends) {
      sendToChild(send.childId, send.event);
    }

    // Execute side effects
    for (const eff of result.effects) {
      runFork(
        eff.pipe(
          Effect.catchAllCause((cause) =>
            Effect.sync(() => {
              console.error("Transition effect failed:", Cause.pretty(cause));
            })
          )
        ) as Effect.Effect<void, never, R>
      );
    }

    // Handle emissions to parent
    for (const emission of result.emissions) {
      if (options?.parent) {
        options.parent.send(emission);
      }
    }

    // Apply state/context changes
    if (isGoto(result)) {
      const gotoResult = result as GotoTransition<S, C, R>;
      const previousState = snapshot.state;
      const newState = gotoResult.state;

      // Exit previous state
      stopCurrentRun();
      stopCurrentEntry();
      runExit(previousState._tag as S["_tag"], previousState);

      // Update snapshot
      const newContext = gotoResult.updates
        ? { ...snapshot.context, ...gotoResult.updates }
        : snapshot.context;

      snapshot = {
        state: newState,
        context: newContext,
        event: null, // Event is set by processEvent
      };

      // Enter new state
      runEntry(newState._tag as S["_tag"], newState);
      startRun(newState._tag as S["_tag"]);

      notifyObservers();
    } else if (isUpdate(result)) {
      const updateResult = result as UpdateTransition<C, R>;

      snapshot = {
        state: snapshot.state,
        context: { ...snapshot.context, ...updateResult.updates },
        event: null,
      };

      notifyObservers();
    }
    // Stay: no state/context changes, but observers might care about effects
  };

  // ============================================================================
  // Transition Builders
  // ============================================================================

  // Create typed transition builders for this machine
  const builders = createTransitionBuilders<S, C, TChildren, TEmits>();

  // ============================================================================
  // Event Processing
  // ============================================================================

  const processEvent = (event: E) => {
    if (stopped) return;

    const currentStateTag = snapshot.state._tag as S["_tag"];

    // Try global handler first
    if (config.global) {
      const globalResult = config.global(snapshot.context, event, builders);
      if (globalResult !== null) {
        // Update event in snapshot
        snapshot = { ...snapshot, event };
        applyTransition(globalResult);
        return;
      }
    }

    // Get state-specific handler
    const stateConfig = config.states[currentStateTag] as StateConfig<S, C, E, typeof currentStateTag, TChildren, TEmits, R> | undefined;
    if (!stateConfig?.on) return;

    // Call handler: (ctx, state, builders) => (event) => result
    const handler = stateConfig.on;
    const eventHandler = handler(snapshot.context, snapshot.state as any, builders);
    const result = eventHandler(event);

    if (result !== null) {
      // Update event in snapshot
      snapshot = { ...snapshot, event };
      applyTransition(result);
    }
  };

  // ============================================================================
  // Mailbox
  // ============================================================================

  const mailbox = new Mailbox<E>(processEvent);

  // ============================================================================
  // Actor API
  // ============================================================================

  const actor: MachineActor<S, C, E, TChildren> = {
    send: (event: E) => {
      if (!stopped) {
        mailbox.enqueue(event);
      }
    },

    getSnapshot: () => snapshot,

    subscribe: (observer) => {
      observers.add(observer);
      return () => observers.delete(observer);
    },

    child: <K extends keyof TChildren & string>(childId: K) => {
      return childrenRef.get(childId) as any;
    },

    children: childrenRef as ReadonlyMap<string, AnyMachineActor>,

    waitFor: (predicate) => {
      if (predicate(snapshot)) {
        return Effect.succeed(snapshot);
      }

      return Effect.async<MachineSnapshot<S, C>>((resume) => {
        let resolved = false;

        const observer = (newSnapshot: MachineSnapshot<S, C>) => {
          if (!resolved && predicate(newSnapshot)) {
            resolved = true;
            observers.delete(observer);
            resume(Effect.succeed(newSnapshot));
          }
        };

        observers.add(observer);

        return Effect.sync(() => {
          observers.delete(observer);
        });
      });
    },

    stop: () => {
      if (stopped) return;
      stopped = true;

      // Stop run fiber
      stopCurrentRun();
      stopCurrentEntry();

      // Run exit for current state
      runExit(snapshot.state._tag as S["_tag"], snapshot.state);

      // Stop all children
      childrenRef.forEach((child) => child.stop());
      childrenRef.clear();

      // Clear observers
      observers.clear();
    },

    _syncSnapshot: (
      newSnapshot: MachineSnapshot<S, C>,
      childSnapshotsToSync?: ReadonlyMap<string, MachineSnapshot<MachineState, MachineContext>>
    ) => {
      if (stopped) return;

      const previousStateTag = snapshot.state._tag;
      const newStateTag = newSnapshot.state._tag;
      const stateChanged = previousStateTag !== newStateTag;

      // Only stop/restart run if state actually changed
      if (stateChanged) {
        stopCurrentRun();
        stopCurrentEntry();
      }

      // Update the snapshot
      snapshot = newSnapshot;

      // Sync child snapshots if provided
      if (childSnapshotsToSync) {
        childSnapshotsToSync.forEach((childSnapshot, childId) => {
          let child = childrenRef.get(childId);

          // Spawn child if it doesn't exist but should (cross-tab sync may have new children)
          if (!child && config.children?.[childId]) {
            spawnChild(childId, childSnapshot);
            child = childrenRef.get(childId);
          }

          // Sync the child's snapshot
          if (child) {
            child._syncSnapshot(childSnapshot);
          }
        });
      }

      // Only restart run if state changed
      if (stateChanged) {
        runEntry(newStateTag as S["_tag"], newSnapshot.state);
        startRun(newStateTag as S["_tag"]);
      }

      // Notify observers of the new snapshot
      notifyObservers();
    },
  };

  // ============================================================================
  // Initialization
  // ============================================================================

  // Restore children from childSnapshots if provided (persistence restore)
  if (options?.childSnapshots) {
    for (const [childId, childSnapshot] of options.childSnapshots) {
      spawnChild(childId, childSnapshot);
    }
  }

  // Run entry for initial state
  runEntry(snapshot.state._tag as S["_tag"], snapshot.state);

  // Start run for initial state
  startRun(snapshot.state._tag as S["_tag"]);

  return actor;
}
