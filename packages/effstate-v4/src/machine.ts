/**
 * EffState v4 - Machine Implementation
 *
 * Creates and interprets state machines with:
 * - Full R (Requirements) channel support
 * - Honest error handling via callbacks
 * - Entry/exit effects and run streams
 */

import { Cause, Effect, Fiber, Runtime, Stream } from "effect";

// Minimal console declaration for Node.js/browser compatibility without DOM lib
declare const console: { error: (...args: unknown[]) => void };
import type {
  MachineState,
  MachineContext,
  MachineEvent,
  MachineConfig,
  MachineDefinition,
  MachineActor,
  MachineSnapshot,
  StateConfig,
  EventHandlers,
  Transition,
  StateByTag,
  EventByTag,
} from "./types";

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Call an event handler with proper typing.
 *
 * The casts here are unavoidable due to TypeScript's "correlated union" limitation.
 * Soundness: handler lookup by event._tag guarantees type alignment.
 */
function callHandler<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
>(
  handlers: EventHandlers<S, C, E>,
  ctx: C,
  event: E
): Transition<S, C> | null {
  const handler = handlers[event._tag as E["_tag"]];
  if (!handler) return null;
  type Handler = (ctx: C, event: E) => Transition<S, C>;
  return (handler as Handler)(ctx, event);
}

/**
 * Narrow a state to a specific variant.
 *
 * Sound: caller verifies state._tag === expectedTag before calling.
 */
function narrowState<S extends MachineState, K extends S["_tag"]>(
  state: S,
  _expectedTag: K
): StateByTag<S, K> {
  return state as StateByTag<S, K>;
}

// ============================================================================
// Error Types
// ============================================================================

/** Error reported when an entry/exit/run effect fails */
export interface MachineEffectError<Err> {
  readonly _tag: "MachineEffectError";
  readonly effectType: "entry" | "exit" | "run";
  readonly stateTag: string;
  readonly cause: Cause.Cause<Err>;
}

/** Options for interpreting a machine */
export interface InterpretOptions<S extends MachineState, C extends MachineContext, Err> {
  /** Initial snapshot to restore from */
  readonly snapshot?: MachineSnapshot<S, C>;

  /** Error handler for entry/exit/run effect failures */
  readonly onError?: (error: MachineEffectError<Err>) => void;

  /**
   * Whether to interrupt entry effects when transitioning away from a state
   * before the entry effect completes.
   *
   * - `false` (default): Entry effects run to completion even if the machine
   *   transitions away. Safer for animations and setup logic that must finish.
   *
   * - `true`: Entry effects are interrupted on rapid transitions. Use when
   *   entry effects are expensive and shouldn't continue for states you've left.
   *
   * Note: Entry effects are always interrupted on `stop()` regardless of this setting.
   *
   * @default false
   */
  readonly interruptEntryOnTransition?: boolean;
}

// ============================================================================
// Interpret Implementation
// ============================================================================

function interpret<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
  R,
  Err,
  CI,
>(
  config: MachineConfig<S, C, E, R, Err, CI>,
  options?: InterpretOptions<S, C, Err>
): Effect.Effect<MachineActor<S, C, E>, never, R> {
  return Effect.gen(function* () {
    // Get runtime for forking effects with proper R context
    const runtime = yield* Effect.runtime<R>();

    // Error handler
    const handleError = (effectType: "entry" | "exit" | "run", stateTag: string, cause: Cause.Cause<Err>) => {
      const error: MachineEffectError<Err> = {
        _tag: "MachineEffectError",
        effectType,
        stateTag,
        cause,
      };

      if (options?.onError) {
        options.onError(error);
      } else {
        console.error(`EffState: ${effectType}(${stateTag}) failed:`, Cause.pretty(cause));
      }
    };

    // Internal mutable state (see types.ts for design rationale)
    let snapshot: MachineSnapshot<S, C> = options?.snapshot ?? {
      state: config.initialState,
      context: config.initialContext,
    };
    const subscribers = new Set<(snap: MachineSnapshot<S, C>) => void>();
    let stopped = false;
    const interruptEntry = options?.interruptEntryOnTransition ?? false;

    // Fiber tracking for proper cleanup (exit fibers are fire-and-forget cleanup)
    let runFiber: Fiber.RuntimeFiber<void, never> | null = null;
    let entryFiber: Fiber.RuntimeFiber<void, never> | null = null;

    // Notify subscribers
    const notify = () => {
      for (const sub of subscribers) {
        sub(snapshot);
      }
    };

    // Run entry effect - tracked so it can be cancelled on rapid transitions
    const runEntry = (stateTag: string) => {
      const stateConfig = config.states[stateTag as S["_tag"]] as StateConfig<S, C, E, R, Err> | undefined;
      if (!stateConfig?.entry) return;

      const program = stateConfig.entry(snapshot).pipe(
        Effect.catchAllCause((cause) =>
          Effect.sync(() => handleError("entry", stateTag, cause))
        )
      );
      entryFiber = Runtime.runFork(runtime)(program);
    };

    // Run exit effect - fire-and-forget cleanup for the old state
    const runExit = (stateTag: string) => {
      const stateConfig = config.states[stateTag as S["_tag"]] as StateConfig<S, C, E, R, Err> | undefined;
      if (!stateConfig?.exit) return;

      const program = stateConfig.exit(snapshot).pipe(
        Effect.catchAllCause((cause) =>
          Effect.sync(() => handleError("exit", stateTag, cause))
        )
      );
      Runtime.runFork(runtime)(program);
    };

    // Run stream (returns fiber for cancellation)
    const runStream = (stream: Stream.Stream<E, Err, R>, stateTag: string): Fiber.RuntimeFiber<void, never> => {
      const program = Stream.runForEach(stream, (event) =>
        Effect.sync(() => processEvent(event))
      ).pipe(
        Effect.catchAllCause((cause) =>
          Effect.sync(() => handleError("run", stateTag, cause))
        )
      );
      return Runtime.runFork(runtime)(program);
    };

    // Start run stream for current state
    const startRunStream = () => {
      const stateTag = snapshot.state._tag;
      const stateConfig = config.states[stateTag as S["_tag"]] as StateConfig<S, C, E, R, Err> | undefined;

      if (stateConfig?.run) {
        const stream = typeof stateConfig.run === "function"
          ? stateConfig.run(snapshot)
          : stateConfig.run;
        runFiber = runStream(stream, stateTag);
      }
    };

    // Apply a transition
    const applyTransition = (transition: Transition<S, C>) => {
      if (!transition) return;

      const hasGoto = "goto" in transition;
      const hasUpdate = "update" in transition;
      const hasActions = "actions" in transition && transition.actions;

      if (hasGoto) {
        const oldStateTag = snapshot.state._tag as S["_tag"];
        const newStateTag = transition.goto._tag as S["_tag"];
        const hadRunningStream = runFiber !== null;

        // Handle previous entry effect based on interruptEntryOnTransition option
        if (entryFiber) {
          if (interruptEntry) {
            Runtime.runFork(runtime)(Fiber.interrupt(entryFiber));
          }
          entryFiber = null;
        }

        // Interrupt run stream, then start new one after interrupt completes
        if (runFiber) {
          const oldRunFiber = runFiber;
          runFiber = null;

          Runtime.runFork(runtime)(
            Fiber.interrupt(oldRunFiber).pipe(
              Effect.ensuring(Effect.sync(() => {
                if (!stopped) startRunStream();
              }))
            )
          );
        }

        // Run exit effect
        runExit(oldStateTag);

        // Update snapshot
        snapshot = {
          state: transition.goto,
          context: hasUpdate ? { ...snapshot.context, ...transition.update } : snapshot.context,
        };

        // Run entry effect
        runEntry(newStateTag);

        // Start run stream only if there was no previous stream to interrupt
        // (otherwise it's chained to the interrupt completion above)
        if (!hadRunningStream) {
          startRunStream();
        }
      } else if (hasUpdate) {
        snapshot = {
          state: snapshot.state,
          context: { ...snapshot.context, ...transition.update },
        };
      }

      // Run actions
      if (hasActions) {
        for (const action of transition.actions) {
          try {
            action();
          } catch (e) {
            console.error("EffState: Action failed:", e);
          }
        }
      }

      notify();
    };

    // Process an event
    const processEvent = (event: E) => {
      if (stopped) return; // Ignore events after stop

      const stateTag = snapshot.state._tag as S["_tag"];
      const stateConfig = config.states[stateTag] as StateConfig<S, C, E, R, Err> | undefined;

      // Try state-specific handler
      if (stateConfig?.on) {
        const transition = callHandler(stateConfig.on, snapshot.context, event);
        if (transition !== null) {
          applyTransition(transition);
          return;
        }
      }

      // Try global handler
      if (config.global) {
        const transition = callHandler(config.global, snapshot.context, event);
        if (transition !== null) {
          applyTransition(transition);
        }
      }
    };

    // Run initial entry effect and start run stream
    const initialStateTag = snapshot.state._tag as S["_tag"];
    runEntry(initialStateTag);
    startRunStream();

    // Return actor
    return {
      send: (event: E) => processEvent(event),
      getSnapshot: () => snapshot,
      subscribe: (observer) => {
        subscribers.add(observer);
        return () => subscribers.delete(observer);
      },
      stop: () => {
        if (stopped) return;
        stopped = true;

        // Collect all fibers to interrupt
        const fibersToInterrupt: Fiber.RuntimeFiber<void, never>[] = [];

        if (runFiber) {
          fibersToInterrupt.push(runFiber);
          runFiber = null;
        }

        if (entryFiber) {
          fibersToInterrupt.push(entryFiber);
          entryFiber = null;
        }

        // Batch interrupt all active fibers in a single fork (exit fibers allowed to complete)
        if (fibersToInterrupt.length > 0) {
          Runtime.runFork(runtime)(
            Effect.forEach(fibersToInterrupt, (fiber) => Fiber.interrupt(fiber), { discard: true })
          );
        }

        // Run final exit effect for current state
        const stateTag = snapshot.state._tag as S["_tag"];
        runExit(stateTag);

        subscribers.clear();
      },
      _syncSnapshot: (newSnapshot: MachineSnapshot<S, C>) => {
        if (stopped) return;

        const oldStateTag = snapshot.state._tag as S["_tag"];
        const newStateTag = newSnapshot.state._tag as S["_tag"];

        if (oldStateTag !== newStateTag) {
          // State changed - run exit/entry effects
          const hadRunningStream = runFiber !== null;

          // Handle previous entry effect based on interruptEntryOnTransition option
          if (entryFiber) {
            if (interruptEntry) {
              Runtime.runFork(runtime)(Fiber.interrupt(entryFiber));
            }
            entryFiber = null;
          }

          // Interrupt run stream, then start new one after interrupt completes
          if (runFiber) {
            const oldRunFiber = runFiber;
            runFiber = null;

            Runtime.runFork(runtime)(
              Fiber.interrupt(oldRunFiber).pipe(
                Effect.ensuring(Effect.sync(() => {
                  if (!stopped) startRunStream();
                }))
              )
            );
          }

          runExit(oldStateTag);
          snapshot = newSnapshot;
          runEntry(newStateTag);

          // Start run stream only if there was no previous stream to interrupt
          if (!hadRunningStream) {
            startRunStream();
          }
        } else {
          // Just context update
          snapshot = newSnapshot;
        }

        notify();
      },
    };
  });
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Define a state machine.
 *
 * @example
 * ```ts
 * const machine = defineMachine<MyState, MyContext, MyEvent>({
 *   id: "myMachine",
 *   initialState: Idle.make(),
 *   initialContext: { count: 0 },
 *   states: {
 *     Idle: {
 *       on: {
 *         Start: () => ({ goto: Running.make({ startedAt: new Date() }) }),
 *       },
 *     },
 *     Running: {
 *       run: tickStream,
 *       on: {
 *         Stop: () => ({ goto: Idle.make() }),
 *       },
 *     },
 *   },
 * });
 *
 * // Interpret (returns Effect requiring R)
 * const actor = Effect.runSync(machine.interpret());
 * actor.send(Start.make());
 * ```
 */
export function defineMachine<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
  R = never,
  Err = never,
  CI = C,
>(
  config: MachineConfig<S, C, E, R, Err, CI>
): MachineDefinition<S, C, E, R, Err, CI> {
  return {
    config,
    interpret: (options) => interpret(config, options),
  };
}

/** Alias for defineMachine */
export const define = defineMachine;
