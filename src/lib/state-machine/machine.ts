import { Duration, Effect, Exit, Fiber, Scope } from "effect";
// Note: Exit is still used for effect action error handling
import type {
  Action,
  ActionEnqueuer,
  EmittedEvent,
  Guard,
  MachineConfig,
  MachineContext,
  MachineDefinition,
  MachineEvent,
  MachineSnapshot,
  StateNodeConfig,
  StateMachineError,
  TransitionConfig,
} from "./types.js";
import {
  EffectActionError,
  ActivityError,
} from "./types.js";

// ============================================================================
// Machine Creation
// ============================================================================

export function createMachine<
  TId extends string,
  TStateValue extends string,
  TContext extends MachineContext,
  TEvent extends MachineEvent,
  R = never,
  E = never,
>(
  config: MachineConfig<TId, TStateValue, TContext, TEvent, R, E>,
): MachineDefinition<TId, TStateValue, TContext, TEvent, R, E> {
  return {
    _tag: "MachineDefinition",
    id: config.id,
    config,
    initialSnapshot: {
      value: config.initial,
      context: config.context,
      event: null,
    },
  };
}

// ============================================================================
// Mailbox (XState-style linked list queue)
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
// Interpreter Types
// ============================================================================

export interface MachineActor<
  TStateValue extends string,
  TContext extends MachineContext,
  TEvent extends MachineEvent,
> {
  readonly send: (event: TEvent) => void;
  readonly getSnapshot: () => MachineSnapshot<TStateValue, TContext>;
  readonly subscribe: (observer: (snapshot: MachineSnapshot<TStateValue, TContext>) => void) => () => void;
  readonly on: <TEmitted extends EmittedEvent>(
    eventType: TEmitted["type"],
    handler: (event: TEmitted) => void,
  ) => () => void;
  /** Subscribe to machine errors (observer failures, effect errors, etc.) */
  readonly onError: (handler: (error: StateMachineError) => void) => () => void;
  /**
   * Wait for the machine to reach a state matching the predicate.
   * Returns an Effect that resolves with the snapshot when condition is met.
   *
   * @example
   * ```ts
   * const result = yield* actor.waitFor(s => s.value === "done")
   * ```
   */
  readonly waitFor: (
    predicate: (snapshot: MachineSnapshot<TStateValue, TContext>) => boolean,
  ) => Effect.Effect<MachineSnapshot<TStateValue, TContext>>;
  readonly children: ReadonlyMap<string, MachineActor<string, MachineContext, MachineEvent>>;
  readonly _parent?: MachineActor<string, MachineContext, MachineEvent>;
  /** Stop the actor and clean up resources */
  readonly stop: () => void;
}

// ============================================================================
// Interpreter Implementation - SYNCHRONOUS like XState
// ============================================================================

export function interpret<
  TId extends string,
  TStateValue extends string,
  TContext extends MachineContext,
  TEvent extends MachineEvent,
  R,
  E,
>(
  machine: MachineDefinition<TId, TStateValue, TContext, TEvent, R, E>,
  options?: {
    parent?: MachineActor<string, MachineContext, MachineEvent>;
  },
): MachineActor<TStateValue, TContext, TEvent> {
  // Mutable state
  let snapshot: MachineSnapshot<TStateValue, TContext> = machine.initialSnapshot;
  let stopped = false;

  const observers = new Set<(snapshot: MachineSnapshot<TStateValue, TContext>) => void>();
  const errorHandlers = new Set<(error: StateMachineError) => void>();
  const activityCleanups = new Map<string, () => void>();
  const delayTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const listenersRef = new Map<string, Set<(event: EmittedEvent) => void>>();
  const childrenRef = new Map<string, MachineActor<any, any, any>>();

  // Emit error to all error handlers
  const emitError = (error: StateMachineError) => {
    errorHandlers.forEach((handler) => {
      try {
        handler(error);
      } catch {
        // Prevent error handler errors from cascading
      }
    });
  };

  // Deferred effects to run after state update
  const deferredEffects: Array<() => void> = [];

  const flushDeferred = () => {
    while (deferredEffects.length > 0) {
      const fn = deferredEffects.shift()!;
      try { fn(); } catch { /* ignore */ }
    }
  };

  const notifyObservers = () => {
    observers.forEach((observer) => {
      try { observer(snapshot); } catch { /* isolate only */ }
    });
  };

  const emitEvent = (event: EmittedEvent) => {
    const listeners = listenersRef.get(event.type);
    if (listeners) {
      listeners.forEach((handler) => handler(event));
    }
  };

  const on = <TEmitted extends EmittedEvent>(
    eventType: TEmitted["type"],
    handler: (event: TEmitted) => void,
  ): (() => void) => {
    let listeners = listenersRef.get(eventType);
    if (!listeners) {
      listeners = new Set();
      listenersRef.set(eventType, listeners);
    }
    listeners.add(handler as (event: EmittedEvent) => void);
    return () => listeners!.delete(handler as (event: EmittedEvent) => void);
  };

  // Forward declare actor
  let actor: MachineActor<TStateValue, TContext, TEvent>;

  const cancelDelay = (id: string) => {
    const timer = delayTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      delayTimers.delete(id);
    }
  };

  const sendToChild = (childId: string, event: MachineEvent): void => {
    const child = childrenRef.get(childId);
    if (child) child.send(event);
  };

  const sendToParent = (event: MachineEvent): void => {
    if (actor._parent) actor._parent.send(event);
  };

  const processEvent = (event: TEvent): void => {
    if (stopped) return;

    const stateConfig = machine.config.states[snapshot.value];

    // Handle $after events
    if (event._tag === "$after") {
      const afterEvent = event as unknown as { _tag: "$after"; delay: number | string };
      const afterConfig = stateConfig?.after;
      if (!afterConfig) return;

      let transitionConfig: TransitionConfig<TStateValue, TContext, TEvent, R, E> | undefined;
      if ("delay" in afterConfig && "transition" in afterConfig) {
        transitionConfig = afterConfig.transition as TransitionConfig<TStateValue, TContext, TEvent, R, E>;
      } else {
        const delays = afterConfig as Record<number, TransitionConfig<TStateValue, TContext, TEvent, R, E>>;
        transitionConfig = delays[Number(afterEvent.delay)];
      }

      if (!transitionConfig?.target) return;

      const targetState = transitionConfig.target;
      let newContext = snapshot.context;

      if (stateConfig?.exit) {
        newContext = runActionsSync(stateConfig.exit, newContext, event);
      }

      stopAllActivities();

      if (transitionConfig.actions) {
        newContext = runActionsSync(
          transitionConfig.actions as ReadonlyArray<Action<TContext, TEvent, R, E>>,
          newContext,
          event,
        );
      }

      const targetStateConfig = machine.config.states[targetState];
      if (targetStateConfig?.entry) {
        newContext = runActionsSync(targetStateConfig.entry, newContext, event);
      }

      snapshot = { value: targetState, context: newContext, event };

      if (targetStateConfig?.activities) {
        startActivities(targetStateConfig.activities, newContext, event);
      }

      if (targetStateConfig?.after) {
        scheduleAfterTransition(targetStateConfig.after);
      }

      flushDeferred();
      notifyObservers();
      return;
    }

    if (!stateConfig?.on) return;

    const transitionConfig = stateConfig.on[event._tag as TEvent["_tag"]];
    if (!transitionConfig) return;

    if (transitionConfig.guard) {
      // Cast guard to accept the event (narrowed event type is compatible)
      const guardFn = transitionConfig.guard as Guard<TContext, TEvent>;
      if (!guardFn({ context: snapshot.context, event })) {
        return;
      }
    }

    const targetState = transitionConfig.target ?? snapshot.value;
    const isTransition = targetState !== snapshot.value;

    let newContext = snapshot.context;

    if (isTransition && stateConfig.exit) {
      newContext = runActionsSync(stateConfig.exit, newContext, event);
    }

    if (isTransition) {
      stopAllActivities();
    }

    if (transitionConfig.actions) {
      newContext = runActionsSync(
        transitionConfig.actions as ReadonlyArray<Action<TContext, TEvent, R, E>>,
        newContext,
        event,
      );
    }

    const targetStateConfig = machine.config.states[targetState];
    if (isTransition && targetStateConfig?.entry) {
      newContext = runActionsSync(targetStateConfig.entry, newContext, event);
    }

    snapshot = { value: targetState, context: newContext, event };

    if (isTransition && targetStateConfig?.activities) {
      startActivities(targetStateConfig.activities, newContext, event);
    }

    if (isTransition && targetStateConfig?.after) {
      scheduleAfterTransition(targetStateConfig.after);
    }

    flushDeferred();
    notifyObservers();
  };

  const runActionsSync = (
    actions: ReadonlyArray<Action<TContext, TEvent, any, any>>,
    context: TContext,
    event: TEvent,
  ): TContext => {
    let ctx = context;
    for (const action of actions) {
      switch (action._tag) {
        case "assign": {
          const updates = action.fn({ context: ctx, event });
          ctx = { ...ctx, ...updates };
          break;
        }
        case "effect": {
          // Defer effect - run async with Exit-based error handling
          const eff = action.fn({ context: ctx, event }) as Effect.Effect<void>;
          deferredEffects.push(() => {
            Effect.runPromiseExit(eff).then((exit) => {
              Exit.match(exit, {
                onFailure: (cause) => {
                  emitError(new EffectActionError({
                    message: "Effect action failed",
                    cause,
                  }));
                },
                onSuccess: () => {},
              });
            });
          });
          break;
        }
        case "raise": {
          const raisedEvent = typeof action.event === "function"
            ? action.event({ context: ctx, event })
            : action.event;
          mailbox.enqueue(raisedEvent as TEvent);
          break;
        }
        case "cancel": {
          const id = typeof action.sendId === "function"
            ? action.sendId({ context: ctx, event })
            : action.sendId;
          cancelDelay(id);
          break;
        }
        case "emit": {
          const emitted = typeof action.event === "function"
            ? action.event({ context: ctx, event })
            : action.event;
          emitEvent(emitted);
          break;
        }
        case "enqueueActions": {
          const queue: Array<Action<TContext, TEvent, any, any>> = [];
          const enqueue = createActionEnqueuer<TContext, TEvent, any, any>(queue);
          action.collect({ context: ctx, event, enqueue });
          ctx = runActionsSync(queue, ctx, event);
          break;
        }
        case "spawnChild": {
          const childId = typeof action.id === "function"
            ? action.id({ context: ctx, event })
            : action.id;
          // Spawn child synchronously
          const childActor = interpret(action.src, { parent: actor as unknown as MachineActor<string, MachineContext, MachineEvent> });
          childrenRef.set(childId, childActor);
          break;
        }
        case "stopChild": {
          const childId = typeof action.childId === "function"
            ? action.childId({ context: ctx, event })
            : action.childId;
          const child = childrenRef.get(childId);
          if (child) {
            child.stop();
            childrenRef.delete(childId);
          }
          break;
        }
        case "sendTo": {
          const targetId = typeof action.target === "function"
            ? action.target({ context: ctx, event })
            : action.target;
          const targetEvent = typeof action.event === "function"
            ? action.event({ context: ctx, event })
            : action.event;
          sendToChild(targetId, targetEvent);
          break;
        }
        case "sendParent": {
          const parentEvent = typeof action.event === "function"
            ? action.event({ context: ctx, event })
            : action.event;
          sendToParent(parentEvent);
          break;
        }
        case "forwardTo": {
          const targetId = typeof action.target === "function"
            ? action.target({ context: ctx, event })
            : action.target;
          sendToChild(targetId, event);
          break;
        }
      }
    }
    return ctx;
  };

  const stopAllActivities = () => {
    activityCleanups.forEach((cleanup) => {
      try { cleanup(); } catch { /* ignore */ }
    });
    activityCleanups.clear();
  };

  const startActivities = (
    activities: ReadonlyArray<{
      readonly id: string;
      readonly src: (params: { context: TContext; event: TEvent; send: (event: TEvent) => void }) => Effect.Effect<void, any, any>;
    }>,
    context: TContext,
    event: TEvent,
  ) => {
    for (const activity of activities) {
      const send = (e: TEvent) => {
        if (!stopped) mailbox.enqueue(e);
      };

      // Fork the activity and store the fiber for interruption
      const activityId = activity.id;
      const fiber = Effect.runFork(
        activity.src({ context, event, send }).pipe(
          // catchAllCause handles both typed errors and defects
          Effect.catchAllCause((cause) => {
            emitError(new ActivityError({
              message: `Activity "${activityId}" failed`,
              activityId,
              cause,
            }));
            return Effect.void;
          }),
        ) as Effect.Effect<void>
      );

      activityCleanups.set(activity.id, () => {
        Effect.runFork(Fiber.interrupt(fiber));
      });
    }
  };

  const scheduleAfterTransition = (
    after: StateNodeConfig<TStateValue, TContext, TEvent, any, any>["after"],
  ) => {
    if (!after) return;

    if ("delay" in after && "transition" in after) {
      const delayMs = Duration.toMillis(Duration.decode(after.delay));
      const transitionId = (after.transition as TransitionConfig<TStateValue, TContext, TEvent, any, any>).id;

      const timer = setTimeout(() => {
        if (transitionId) delayTimers.delete(transitionId);
        mailbox.enqueue({ _tag: "$after", delay: delayMs } as unknown as TEvent);
      }, delayMs);

      if (transitionId) {
        delayTimers.set(transitionId, timer);
      }
      return;
    }

    const entries = Object.entries(after as Record<number, TransitionConfig<TStateValue, TContext, TEvent, any, any>>);
    for (const [delayMs, config] of entries) {
      const timer = setTimeout(() => {
        if (config.id) delayTimers.delete(config.id);
        mailbox.enqueue({ _tag: "$after", delay: delayMs } as unknown as TEvent);
      }, Number(delayMs));

      if (config.id) {
        delayTimers.set(config.id, timer);
      }
    }
  };

  const stop = () => {
    stopped = true;
    stopAllActivities();
    delayTimers.forEach((timer) => clearTimeout(timer));
    delayTimers.clear();
    childrenRef.forEach((child) => child.stop());
    childrenRef.clear();
  };

  // Create mailbox
  const mailbox = new Mailbox<TEvent>(processEvent);

  // waitFor implementation - returns Effect that resolves when predicate matches
  const waitFor = (
    predicate: (snapshot: MachineSnapshot<TStateValue, TContext>) => boolean,
  ): Effect.Effect<MachineSnapshot<TStateValue, TContext>> => {
    // Check if already satisfied
    if (predicate(snapshot)) {
      return Effect.succeed(snapshot);
    }

    // Use Effect.async to bridge callback-based subscription to Effect
    return Effect.async<MachineSnapshot<TStateValue, TContext>>((resume) => {
      let resolved = false;

      const observer = (newSnapshot: MachineSnapshot<TStateValue, TContext>) => {
        if (!resolved && predicate(newSnapshot)) {
          resolved = true;
          observers.delete(observer);
          resume(Effect.succeed(newSnapshot));
        }
      };

      observers.add(observer);

      // Return cleanup function for interruption
      return Effect.sync(() => {
        observers.delete(observer);
      });
    });
  };

  // Create actor
  actor = {
    send: (event: TEvent) => mailbox.enqueue(event),
    getSnapshot: () => snapshot,
    subscribe: (observer) => {
      observers.add(observer);
      return () => observers.delete(observer);
    },
    on,
    onError: (handler) => {
      errorHandlers.add(handler);
      return () => errorHandlers.delete(handler);
    },
    waitFor,
    children: childrenRef as ReadonlyMap<string, MachineActor<string, MachineContext, MachineEvent>>,
    stop,
    ...(options?.parent ? { _parent: options.parent } : {}),
  };

  // Run entry actions for initial state
  const initialState = machine.config.states[machine.initialSnapshot.value];
  if (initialState?.entry) {
    snapshot = {
      ...snapshot,
      context: runActionsSync(initialState.entry, snapshot.context, { _tag: "$init" } as TEvent),
    };
  }

  // Start activities for initial state
  if (initialState?.activities) {
    startActivities(initialState.activities, snapshot.context, { _tag: "$init" } as TEvent);
  }

  // Handle delayed transitions for initial state
  if (initialState?.after) {
    scheduleAfterTransition(initialState.after);
  }

  flushDeferred();

  return actor;
}

// ============================================================================
// Effect-wrapped interpret (for Effect users who want Scope integration)
// ============================================================================

export const interpretEffect = <
  TId extends string,
  TStateValue extends string,
  TContext extends MachineContext,
  TEvent extends MachineEvent,
  R,
  E,
>(
  machine: MachineDefinition<TId, TStateValue, TContext, TEvent, R, E>,
  options?: {
    parent?: MachineActor<string, MachineContext, MachineEvent>;
  },
): Effect.Effect<MachineActor<TStateValue, TContext, TEvent>, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => interpret(machine, options)),
    (actor) => Effect.sync(() => actor.stop()),
  );

// ============================================================================
// Internal Helpers
// ============================================================================

const createActionEnqueuer = <TContext extends MachineContext, TEvent extends MachineEvent, R, E>(
  queue: Array<Action<TContext, TEvent, R, E>>,
): ActionEnqueuer<TContext, TEvent, R, E> => {
  const enqueue = ((action: Action<TContext, TEvent, R, E>) => {
    queue.push(action);
  }) as ActionEnqueuer<TContext, TEvent, R, E>;

  enqueue.assign = (assignment) => {
    queue.push({
      _tag: "assign",
      fn: typeof assignment === "function" ? assignment : () => assignment,
    } as Action<TContext, TEvent, R, E>);
  };

  enqueue.raise = (event) => {
    queue.push({
      _tag: "raise",
      event,
    } as Action<TContext, TEvent, R, E>);
  };

  enqueue.effect = (fn) => {
    queue.push({
      _tag: "effect",
      fn,
    } as Action<TContext, TEvent, R, E>);
  };

  return enqueue;
};
