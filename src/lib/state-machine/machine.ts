import { Duration, Effect, Fiber, Runtime, Scope } from "effect";
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
  TransitionConfig,
} from "./types.js";

// ============================================================================
// Machine Creation
// ============================================================================

/**
 * Create a state machine definition from config
 */
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
      // Already have items, append to end
      this._last!.next = item;
      this._last = item;
    } else {
      // Empty queue
      this._current = item;
      this._last = item;
    }

    // If not currently processing, start processing
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

  clear(): void {
    this._current = null;
    this._last = null;
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
  /** Send an event to the machine */
  readonly send: (event: TEvent) => void;
  /** Get current snapshot synchronously */
  readonly getSnapshot: () => MachineSnapshot<TStateValue, TContext>;
  /** Subscribe to snapshot changes */
  readonly subscribe: (observer: (snapshot: MachineSnapshot<TStateValue, TContext>) => void) => () => void;
  /**
   * Register a listener for emitted events.
   * Returns an unsubscribe function.
   */
  readonly on: <TEmitted extends EmittedEvent>(
    eventType: TEmitted["type"],
    handler: (event: TEmitted) => void,
  ) => () => void;
  /** Map of child actors by ID */
  readonly children: ReadonlyMap<string, MachineActor<string, MachineContext, MachineEvent>>;
  /** Parent actor (if spawned) */
  readonly _parent?: MachineActor<string, MachineContext, MachineEvent>;
}

// ============================================================================
// Interpreter Implementation
// ============================================================================

/**
 * Create and start a machine actor (interpreter)
 * Uses XState-style synchronous event processing for performance
 */
export const interpret = <
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
): Effect.Effect<MachineActor<TStateValue, TContext, TEvent>, never, R | Scope.Scope> =>
  Effect.gen(function* () {
    // Mutable state (like XState)
    let snapshot: MachineSnapshot<TStateValue, TContext> = machine.initialSnapshot;
    const observers = new Set<(snapshot: MachineSnapshot<TStateValue, TContext>) => void>();
    const activityFibersRef = new Map<string, Fiber.RuntimeFiber<void, never>>();
    const delayFibersRef = new Map<string, Fiber.RuntimeFiber<void, never>>();
    const listenersRef = new Map<string, Set<(event: EmittedEvent) => void>>();
    const childrenRef = new Map<string, MachineActor<any, any, any>>();

    // Deferred effects queue (like XState's _deferred)
    const deferredEffects: Array<Effect.Effect<void, never, any>> = [];

    // Get runtime for running deferred effects
    const runtime = yield* Effect.runtime<R>();

    // Helper to run deferred effects synchronously
    const flushDeferred = () => {
      while (deferredEffects.length > 0) {
        const eff = deferredEffects.shift()!;
        try {
          Effect.runSync(Effect.provide(eff, runtime));
        } catch {
          // Silently ignore sync errors, async effects handle their own errors
        }
      }
    };

    // Notify observers (like XState's update)
    const notifyObservers = () => {
      for (const observer of observers) {
        observer(snapshot);
      }
    };

    const emitEvent = (event: EmittedEvent) => {
      const listeners = listenersRef.get(event.type);
      if (listeners) {
        for (const handler of listeners) {
          handler(event);
        }
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
      return () => {
        listeners!.delete(handler as (event: EmittedEvent) => void);
      };
    };

    // Forward declare actor for circular reference
    let actor: MachineActor<TStateValue, TContext, TEvent>;

    // Action helpers
    const cancelDelay = (id: string) => {
      const fiber = delayFibersRef.get(id);
      if (fiber) {
        delayFibersRef.delete(id);
        deferredEffects.push(Fiber.interrupt(fiber).pipe(Effect.catchAll(() => Effect.void)));
      }
    };

    const sendToChild = (childId: string, event: MachineEvent): void => {
      const child = childrenRef.get(childId);
      if (child) child.send(event);
    };

    const sendToParent = (event: MachineEvent): void => {
      if (actor._parent) actor._parent.send(event);
    };

    // Process a single event synchronously
    const processEvent = (event: TEvent): void => {
      const stateConfig = machine.config.states[snapshot.value];

      // Handle $after events (delayed transitions)
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

        // Run exit actions
        if (stateConfig?.exit) {
          newContext = runActionsSync(stateConfig.exit, newContext, event);
        }

        // Stop activities (deferred)
        stopAllActivitiesSync();

        // Run transition actions
        if (transitionConfig.actions) {
          newContext = runActionsSync(
            transitionConfig.actions as ReadonlyArray<Action<TContext, TEvent, R, E>>,
            newContext,
            event,
          );
        }

        // Run entry actions
        const targetStateConfig = machine.config.states[targetState];
        if (targetStateConfig?.entry) {
          newContext = runActionsSync(targetStateConfig.entry, newContext, event);
        }

        // Update snapshot
        snapshot = { value: targetState, context: newContext, event };

        // Start activities for new state (deferred)
        if (targetStateConfig?.activities) {
          startActivitiesDeferred(targetStateConfig.activities, newContext, event);
        }

        // Handle delayed transitions for new state
        if (targetStateConfig?.after) {
          scheduleAfterTransition(targetStateConfig.after, snapshot);
        }

        // Flush deferred effects and notify
        flushDeferred();
        notifyObservers();
        return;
      }

      if (!stateConfig?.on) return;

      const transitionConfig = stateConfig.on[event._tag as TEvent["_tag"]];
      if (!transitionConfig) return;

      // Check guard synchronously
      if (transitionConfig.guard) {
        const allowed = evaluateGuardSync(
          transitionConfig.guard as Guard<TContext, TEvent, R, E>,
          snapshot.context,
          event,
        );
        if (!allowed) return;
      }

      const targetState = transitionConfig.target ?? snapshot.value;
      const isTransition = targetState !== snapshot.value;

      let newContext = snapshot.context;

      // Run exit actions if transitioning
      if (isTransition && stateConfig.exit) {
        newContext = runActionsSync(stateConfig.exit, newContext, event);
      }

      // Stop activities if transitioning (deferred)
      if (isTransition) {
        stopAllActivitiesSync();
      }

      // Run transition actions
      if (transitionConfig.actions) {
        newContext = runActionsSync(
          transitionConfig.actions as ReadonlyArray<Action<TContext, TEvent, R, E>>,
          newContext,
          event,
        );
      }

      // Run entry actions if transitioning
      const targetStateConfig = machine.config.states[targetState];
      if (isTransition && targetStateConfig?.entry) {
        newContext = runActionsSync(targetStateConfig.entry, newContext, event);
      }

      // Update snapshot
      snapshot = { value: targetState, context: newContext, event };

      // Start activities for new state (deferred)
      if (isTransition && targetStateConfig?.activities) {
        startActivitiesDeferred(targetStateConfig.activities, newContext, event);
      }

      // Handle delayed transitions
      if (isTransition && targetStateConfig?.after) {
        scheduleAfterTransition(targetStateConfig.after, snapshot);
      }

      // Flush deferred effects and notify
      flushDeferred();
      notifyObservers();
    };

    // Synchronous action runner
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
            // Defer effect execution
            deferredEffects.push(action.fn({ context: ctx, event }).pipe(Effect.catchAll(() => Effect.void)));
            break;
          }
          case "raise": {
            const raisedEvent = typeof action.event === "function"
              ? action.event({ context: ctx, event })
              : action.event;
            mailbox.enqueue(raisedEvent);
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
            // Defer child spawning
            deferredEffects.push(
              Effect.gen(function* () {
                const childActor = yield* interpret(action.src, { parent: actor as MachineActor<string, MachineContext, MachineEvent> });
                childrenRef.set(childId, childActor);
              }),
            );
            break;
          }
          case "stopChild": {
            const childId = typeof action.childId === "function"
              ? action.childId({ context: ctx, event })
              : action.childId;
            const child = childrenRef.get(childId);
            if (child) {
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

    const evaluateGuardSync = (
      guard: Guard<TContext, TEvent, any, any>,
      context: TContext,
      event: TEvent,
    ): boolean => {
      switch (guard._tag) {
        case "sync":
          return guard.fn({ context, event });
        case "effect":
          // Run effect guard synchronously using captured runtime
          try {
            return Runtime.runSync(runtime)(guard.fn({ context, event }));
          } catch {
            return false;
          }
      }
    };

    const stopAllActivitiesSync = () => {
      for (const fiber of activityFibersRef.values()) {
        deferredEffects.push(Fiber.interrupt(fiber).pipe(Effect.catchAll(() => Effect.void)));
      }
      activityFibersRef.clear();
    };

    const startActivitiesDeferred = (
      activities: ReadonlyArray<{
        readonly id: string;
        readonly src: (params: { context: TContext; event: TEvent; send: (event: TEvent) => void }) => Effect.Effect<void, any, any>;
      }>,
      context: TContext,
      event: TEvent,
    ) => {
      for (const activity of activities) {
        deferredEffects.push(
          Effect.gen(function* () {
            const fiber = yield* activity.src({ context, event, send: mailbox.enqueue.bind(mailbox) }).pipe(
              Effect.catchAll(() => Effect.void),
              Effect.forkScoped,
            );
            activityFibersRef.set(activity.id, fiber as Fiber.RuntimeFiber<void, never>);
          }),
        );
      }
    };

    const scheduleAfterTransition = (
      after: StateNodeConfig<TStateValue, TContext, TEvent, any, any>["after"],
      _snapshot: MachineSnapshot<TStateValue, TContext>,
    ) => {
      if (!after) return;

      if ("delay" in after && "transition" in after) {
        const delay = Duration.toMillis(Duration.decode(after.delay));
        const transitionId = (after.transition as TransitionConfig<TStateValue, TContext, TEvent, any, any>).id;
        deferredEffects.push(
          Effect.gen(function* () {
            const fiber = yield* Effect.sleep(Duration.millis(delay)).pipe(
              Effect.zipRight(Effect.sync(() => mailbox.enqueue({ _tag: "$after", delay } as unknown as TEvent))),
              Effect.forkScoped,
            );
            if (transitionId) {
              delayFibersRef.set(transitionId, fiber as Fiber.RuntimeFiber<void, never>);
            }
          }),
        );
        return;
      }

      const entries = Object.entries(after as Record<number, TransitionConfig<TStateValue, TContext, TEvent, any, any>>);
      for (const [delayMs, config] of entries) {
        deferredEffects.push(
          Effect.gen(function* () {
            const fiber = yield* Effect.sleep(Duration.millis(Number(delayMs))).pipe(
              Effect.zipRight(Effect.sync(() => mailbox.enqueue({ _tag: "$after", delay: delayMs } as unknown as TEvent))),
              Effect.forkScoped,
            );
            if (config.id) {
              delayFibersRef.set(config.id, fiber as Fiber.RuntimeFiber<void, never>);
            }
          }),
        );
      }
    };

    // Create mailbox with synchronous processor
    const mailbox = new Mailbox<TEvent>(processEvent);

    // Create actor object
    actor = {
      send: (event: TEvent) => mailbox.enqueue(event),
      getSnapshot: () => snapshot,
      subscribe: (observer) => {
        observers.add(observer);
        return () => observers.delete(observer);
      },
      on,
      children: childrenRef as ReadonlyMap<string, MachineActor<string, MachineContext, MachineEvent>>,
      _parent: options?.parent,
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
      startActivitiesDeferred(initialState.activities, snapshot.context, { _tag: "$init" } as TEvent);
    }

    // Handle delayed transitions for initial state
    if (initialState?.after) {
      scheduleAfterTransition(initialState.after, snapshot);
    }

    // Flush any deferred effects from initialization
    flushDeferred();

    return actor;
  });

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
