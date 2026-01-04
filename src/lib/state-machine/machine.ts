import { Duration, Effect, Fiber, Queue, Stream, SubscriptionRef } from "effect";
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
 *
 * @example
 * ```ts
 * const toggleMachine = createMachine({
 *   id: "toggle",
 *   initial: "inactive",
 *   context: { count: 0 },
 *   states: {
 *     inactive: {
 *       on: { TOGGLE: { target: "active" } }
 *     },
 *     active: {
 *       entry: [assign(({ context }) => ({ count: context.count + 1 }))],
 *       on: { TOGGLE: { target: "inactive" } }
 *     }
 *   }
 * })
 * ```
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
// Interpreter Types
// ============================================================================

export interface MachineActor<
  TStateValue extends string,
  TContext extends MachineContext,
  TEvent extends MachineEvent,
> {
  /** Current snapshot SubscriptionRef for reactive updates */
  readonly snapshotRef: SubscriptionRef.SubscriptionRef<MachineSnapshot<TStateValue, TContext>>;
  /** Command queue for sending events */
  readonly commandQueue: Queue.Queue<TEvent>;
  /** Send an event to the machine */
  readonly send: (event: TEvent) => void;
  /** Get current snapshot */
  readonly getSnapshot: Effect.Effect<MachineSnapshot<TStateValue, TContext>>;
  /**
   * Register a listener for emitted events.
   * Returns an unsubscribe function.
   */
  readonly on: <TEmitted extends EmittedEvent>(
    eventType: TEmitted["type"],
    handler: (event: TEmitted) => void,
  ) => () => void;
  /** Map of child actors by ID. Use type assertion for specific child types. */
  readonly children: ReadonlyMap<string, MachineActor<string, MachineContext, MachineEvent>>;
  /** Parent actor (if this is a spawned child). Use type assertion for specific parent type. */
  readonly _parent?: MachineActor<string, MachineContext, MachineEvent>;
}

// ============================================================================
// Interpreter Implementation
// ============================================================================

/**
 * Create and start a machine actor (interpreter)
 * Returns an Effect that creates the actor with proper scoping
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
): Effect.Effect<MachineActor<TStateValue, TContext, TEvent>, never, R> =>
  Effect.gen(function* () {
    // Create refs in parallel for better performance
    const [snapshotRef, commandQueue] = yield* Effect.all([
      SubscriptionRef.make<MachineSnapshot<TStateValue, TContext>>(machine.initialSnapshot),
      Queue.unbounded<TEvent>(),
    ]);

    // Plain Maps don't need Effect wrapping - created directly
    const activityFibersRef = new Map<string, Fiber.RuntimeFiber<void, never>>();
    const delayFibersRef = new Map<string, Fiber.RuntimeFiber<void, never>>();
    const listenersRef = new Map<string, Set<(event: EmittedEvent) => void>>();
    const childrenRef = new Map<string, MachineActor<any, any, any>>();
    const childFibersRef = new Map<string, Fiber.RuntimeFiber<void, never>>();
    const send = (event: TEvent) => commandQueue.unsafeOffer(event);
    const cancelDelay = (id: string) => {
      const fiber = delayFibersRef.get(id);
      if (fiber) {
        delayFibersRef.delete(id);
        return Fiber.interrupt(fiber).pipe(Effect.catchAll(() => Effect.void));
      }
      return Effect.void;
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
      // Return unsubscribe function
      return () => {
        listeners!.delete(handler as (event: EmittedEvent) => void);
      };
    };

    // Create actor object early so we can pass it as parent to children
    const actor: MachineActor<TStateValue, TContext, TEvent> = {
      snapshotRef,
      commandQueue,
      send: (event: TEvent) => commandQueue.unsafeOffer(event),
      getSnapshot: SubscriptionRef.get(snapshotRef),
      on,
      children: childrenRef as ReadonlyMap<string, MachineActor<string, MachineContext, MachineEvent>>,
      _parent: options?.parent,
    };

    const spawnChildActor = (
      childMachine: MachineDefinition<any, any, any, any, any, any>,
      childId: string,
    ): Effect.Effect<void, never, any> =>
      Effect.gen(function* () {
        // Create the child actor with this actor as parent
        const childActor = yield* interpret(childMachine, { parent: actor as MachineActor<string, MachineContext, MachineEvent> });
        childrenRef.set(childId, childActor);
      });
    const stopChildActor = (childId: string): Effect.Effect<void> => {
      const child = childrenRef.get(childId);
      if (child) {
        childrenRef.delete(childId);
        const fiber = childFibersRef.get(childId);
        if (fiber) {
          childFibersRef.delete(childId);
          return Fiber.interrupt(fiber).pipe(Effect.catchAll(() => Effect.void));
        }
      }
      return Effect.void;
    };
    const sendToChild = (childId: string, event: MachineEvent): void => {
      const child = childrenRef.get(childId);
      if (child) {
        child.send(event);
      }
    };
    const sendToParent = (event: MachineEvent): void => {
      if (actor._parent) {
        actor._parent.send(event);
      }
    };

    // Create helpers object for action runners
    const actionHelpers = {
      send,
      cancelDelay,
      emitEvent,
      spawnChildActor,
      stopChildActor,
      sendToChild,
      sendToParent,
    };

    // Run entry actions for initial state
    const initialState = machine.config.states[machine.initialSnapshot.value];
    if (initialState?.entry) {
      yield* runActions(initialState.entry, machine.initialSnapshot.context, { _tag: "$init" } as TEvent, actionHelpers);
    }

    // Start activities for initial state
    if (initialState?.activities) {
      yield* startActivities(
        initialState.activities,
        machine.initialSnapshot.context,
        { _tag: "$init" } as TEvent,
        send,
        activityFibersRef,
      );
    }

    // Handle delayed transitions for initial state
    if (initialState?.after) {
      yield* handleAfterTransition(
        initialState.after,
        machine.initialSnapshot,
        commandQueue,
        delayFibersRef,
      );
    }

    // Main event processing loop
    yield* Stream.fromQueue(commandQueue).pipe(
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          const snapshot = yield* SubscriptionRef.get(snapshotRef);
          const stateConfig = machine.config.states[snapshot.value];

          // Handle $after events (delayed transitions)
          if (event._tag === "$after") {
            const afterEvent = event as unknown as { _tag: "$after"; delay: number | string };
            const afterConfig = stateConfig?.after;
            if (!afterConfig) return;

            // Find the matching transition config
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
              yield* runActions(stateConfig.exit, newContext, event, actionHelpers);
            }

            // Stop activities
            yield* stopAllActivities(activityFibersRef);

            // Run transition actions
            if (transitionConfig.actions) {
              newContext = yield* runActionsWithContext(
                transitionConfig.actions as ReadonlyArray<Action<TContext, TEvent, R, E>>,
                newContext,
                event,
                actionHelpers,
              );
            }

            // Run entry actions
            const targetStateConfig = machine.config.states[targetState];
            if (targetStateConfig?.entry) {
              newContext = yield* runActionsWithContext(targetStateConfig.entry, newContext, event, actionHelpers);
            }

            // Update snapshot
            const newSnapshot: MachineSnapshot<TStateValue, TContext> = {
              value: targetState,
              context: newContext,
              event,
            };
            yield* SubscriptionRef.set(snapshotRef, newSnapshot);

            // Start activities for new state
            if (targetStateConfig?.activities) {
              yield* startActivities(
                targetStateConfig.activities,
                newContext,
                event,
                send,
                activityFibersRef,
              );
            }

            // Handle delayed transitions for new state
            if (targetStateConfig?.after) {
              yield* handleAfterTransition(targetStateConfig.after, newSnapshot, commandQueue, delayFibersRef);
            }

            yield* Effect.log(`[${machine.id}] ${snapshot.value} -> ${targetState} ($after)`);
            return;
          }

          if (!stateConfig?.on) return;

          const transitionConfig = stateConfig.on[event._tag as TEvent["_tag"]];
          if (!transitionConfig) return;

          // Check guard
          // Note: Type assertion is safe here because we looked up the transition by event._tag,
          // so the guard/actions are typed for exactly this event type at compile time
          if (transitionConfig.guard) {
            const allowed = yield* evaluateGuard(
              transitionConfig.guard as Guard<TContext, TEvent, R, E>,
              snapshot.context,
              event,
            );
            if (!allowed) return;
          }

          // Determine target state
          const targetState = transitionConfig.target ?? snapshot.value;
          const isTransition = targetState !== snapshot.value;

          let newContext = snapshot.context;

          // Run exit actions if transitioning
          if (isTransition && stateConfig.exit) {
            yield* runActions(stateConfig.exit, newContext, event, actionHelpers);
          }

          // Stop activities if transitioning
          if (isTransition) {
            yield* stopAllActivities(activityFibersRef);
          }

          // Run transition actions
          if (transitionConfig.actions) {
            newContext = yield* runActionsWithContext(
              transitionConfig.actions as ReadonlyArray<Action<TContext, TEvent, R, E>>,
              newContext,
              event,
              actionHelpers,
            );
          }

          // Run entry actions if transitioning
          const targetStateConfig = machine.config.states[targetState];
          if (isTransition && targetStateConfig?.entry) {
            newContext = yield* runActionsWithContext(targetStateConfig.entry, newContext, event, actionHelpers);
          }

          // Update snapshot
          const newSnapshot: MachineSnapshot<TStateValue, TContext> = {
            value: targetState,
            context: newContext,
            event,
          };
          yield* SubscriptionRef.set(snapshotRef, newSnapshot);

          // Start activities for new state
          if (isTransition && targetStateConfig?.activities) {
            yield* startActivities(
              targetStateConfig.activities,
              newContext,
              event,
              send,
              activityFibersRef,
            );
          }

          // Handle delayed transitions
          if (isTransition && targetStateConfig?.after) {
            yield* handleAfterTransition(targetStateConfig.after, newSnapshot, commandQueue, delayFibersRef);
          }

          yield* Effect.log(`[${machine.id}] ${snapshot.value} -> ${targetState} (${event._tag})`);
        }),
      ),
      Effect.forkScoped,
    );

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

interface ActionRunnerHelpers<TEvent extends MachineEvent> {
  send: (event: TEvent) => void;
  cancelDelay: (id: string) => Effect.Effect<void>;
  emitEvent: (event: EmittedEvent) => void;
  spawnChildActor: (machine: MachineDefinition<any, any, any, any, any, any>, id: string) => Effect.Effect<void, never, any>;
  stopChildActor: (id: string) => Effect.Effect<void>;
  sendToChild: (childId: string, event: MachineEvent) => void;
  sendToParent: (event: MachineEvent) => void;
}

const runActions = <TContext extends MachineContext, TEvent extends MachineEvent>(
  actions: ReadonlyArray<Action<TContext, TEvent, any, any>>,
  context: TContext,
  event: TEvent,
  helpers: ActionRunnerHelpers<TEvent>,
): Effect.Effect<void, never, any> => {
  if (actions.length === 0) return Effect.void;
  return Effect.forEach(actions, (action) => {
    switch (action._tag) {
      case "assign":
        return Effect.void;
      case "effect":
        return action.fn({ context, event }).pipe(Effect.catchAll(() => Effect.void));
      case "raise": {
        const raisedEvent = typeof action.event === "function"
          ? action.event({ context, event })
          : action.event;
        helpers.send(raisedEvent);
        return Effect.void;
      }
      case "cancel": {
        const id = typeof action.sendId === "function"
          ? action.sendId({ context, event })
          : action.sendId;
        return helpers.cancelDelay(id);
      }
      case "emit": {
        const emitted = typeof action.event === "function"
          ? action.event({ context, event })
          : action.event;
        helpers.emitEvent(emitted);
        return Effect.void;
      }
      case "enqueueActions": {
        const queue: Array<Action<TContext, TEvent, any, any>> = [];
        const enqueue = createActionEnqueuer<TContext, TEvent, any, any>(queue);
        action.collect({ context, event, enqueue });
        // Recursively run the collected actions
        return runActions(queue, context, event, helpers);
      }
      case "spawnChild": {
        const childId = typeof action.id === "function"
          ? action.id({ context, event })
          : action.id;
        return helpers.spawnChildActor(action.src, childId);
      }
      case "stopChild": {
        const childId = typeof action.childId === "function"
          ? action.childId({ context, event })
          : action.childId;
        return helpers.stopChildActor(childId);
      }
      case "sendTo": {
        const targetId = typeof action.target === "function"
          ? action.target({ context, event })
          : action.target;
        const targetEvent = typeof action.event === "function"
          ? action.event({ context, event })
          : action.event;
        helpers.sendToChild(targetId, targetEvent);
        return Effect.void;
      }
      case "sendParent": {
        const parentEvent = typeof action.event === "function"
          ? action.event({ context, event })
          : action.event;
        helpers.sendToParent(parentEvent);
        return Effect.void;
      }
      case "forwardTo": {
        const targetId = typeof action.target === "function"
          ? action.target({ context, event })
          : action.target;
        helpers.sendToChild(targetId, event);
        return Effect.void;
      }
    }
  }, { discard: true });
};

const runActionsWithContext = <TContext extends MachineContext, TEvent extends MachineEvent>(
  actions: ReadonlyArray<Action<TContext, TEvent, any, any>>,
  context: TContext,
  event: TEvent,
  helpers: ActionRunnerHelpers<TEvent>,
): Effect.Effect<TContext, never, any> => {
  if (actions.length === 0) return Effect.succeed(context);
  return Effect.reduce(actions, context, (ctx, action) => {
    switch (action._tag) {
      case "assign": {
        const updates = action.fn({ context: ctx, event });
        return Effect.succeed({ ...ctx, ...updates });
      }
      case "effect":
        return action.fn({ context: ctx, event }).pipe(
          Effect.catchAll(() => Effect.void),
          Effect.map(() => ctx),
        );
      case "raise": {
        const raisedEvent = typeof action.event === "function"
          ? action.event({ context: ctx, event })
          : action.event;
        helpers.send(raisedEvent);
        return Effect.succeed(ctx);
      }
      case "cancel": {
        const id = typeof action.sendId === "function"
          ? action.sendId({ context: ctx, event })
          : action.sendId;
        return helpers.cancelDelay(id).pipe(Effect.map(() => ctx));
      }
      case "emit": {
        const emitted = typeof action.event === "function"
          ? action.event({ context: ctx, event })
          : action.event;
        helpers.emitEvent(emitted);
        return Effect.succeed(ctx);
      }
      case "enqueueActions": {
        const queue: Array<Action<TContext, TEvent, any, any>> = [];
        const enqueue = createActionEnqueuer<TContext, TEvent, any, any>(queue);
        action.collect({ context: ctx, event, enqueue });
        // Recursively run the collected actions with context tracking
        return runActionsWithContext(queue, ctx, event, helpers);
      }
      case "spawnChild": {
        const childId = typeof action.id === "function"
          ? action.id({ context: ctx, event })
          : action.id;
        return helpers.spawnChildActor(action.src, childId).pipe(Effect.map(() => ctx));
      }
      case "stopChild": {
        const childId = typeof action.childId === "function"
          ? action.childId({ context: ctx, event })
          : action.childId;
        return helpers.stopChildActor(childId).pipe(Effect.map(() => ctx));
      }
      case "sendTo": {
        const targetId = typeof action.target === "function"
          ? action.target({ context: ctx, event })
          : action.target;
        const targetEvent = typeof action.event === "function"
          ? action.event({ context: ctx, event })
          : action.event;
        helpers.sendToChild(targetId, targetEvent);
        return Effect.succeed(ctx);
      }
      case "sendParent": {
        const parentEvent = typeof action.event === "function"
          ? action.event({ context: ctx, event })
          : action.event;
        helpers.sendToParent(parentEvent);
        return Effect.succeed(ctx);
      }
      case "forwardTo": {
        const targetId = typeof action.target === "function"
          ? action.target({ context: ctx, event })
          : action.target;
        helpers.sendToChild(targetId, event);
        return Effect.succeed(ctx);
      }
    }
  });
};

const evaluateGuard = <TContext extends MachineContext, TEvent extends MachineEvent>(
  guard: Guard<TContext, TEvent, any, any>,
  context: TContext,
  event: TEvent,
): Effect.Effect<boolean, never, any> => {
  switch (guard._tag) {
    case "sync":
      return Effect.succeed(guard.fn({ context, event }));
    case "effect":
      return guard.fn({ context, event }).pipe(Effect.catchAll(() => Effect.succeed(false)));
  }
};

const startActivities = <TContext extends MachineContext, TEvent extends MachineEvent>(
  activities: ReadonlyArray<{
    readonly id: string;
    readonly src: (params: {
      context: TContext;
      event: TEvent;
      send: (event: TEvent) => void;
    }) => Effect.Effect<void, any, any>;
  }>,
  context: TContext,
  event: TEvent,
  send: (event: TEvent) => void,
  fibersRef: Map<string, Fiber.RuntimeFiber<void, never>>,
): Effect.Effect<void, never, any> => {
  if (activities.length === 0) return Effect.void;
  return Effect.forEach(
    activities,
    (activity) =>
      Effect.gen(function* () {
        const fiber = yield* activity.src({ context, event, send }).pipe(
          Effect.catchAll(() => Effect.void),
          Effect.forkScoped,
        );
        fibersRef.set(activity.id, fiber as Fiber.RuntimeFiber<void, never>);
      }),
    { discard: true },
  );
};

const stopAllActivities = (
  fibersRef: Map<string, Fiber.RuntimeFiber<void, never>>,
): Effect.Effect<void> => {
  if (fibersRef.size === 0) return Effect.void;
  return Effect.forEach(
    Array.from(fibersRef.values()),
    (fiber) => Fiber.interrupt(fiber).pipe(Effect.catchAll(() => Effect.void)),
    { discard: true },
  ).pipe(
    Effect.tap(() => Effect.sync(() => fibersRef.clear())),
  );
};

const handleAfterTransition = <
  TStateValue extends string,
  TContext extends object,
  TEvent extends MachineEvent,
>(
  after: StateNodeConfig<TStateValue, TContext, TEvent, any, any>["after"],
  _snapshot: MachineSnapshot<TStateValue, TContext>,
  commandQueue: Queue.Queue<TEvent>,
  delayFibersRef: Map<string, Fiber.RuntimeFiber<void, never>>,
): Effect.Effect<void, never, any> => {
  if (!after) return Effect.void;

  // Handle object with delay/transition
  if ("delay" in after && "transition" in after) {
    const delay = Duration.decode(after.delay);
    const transitionId = (after.transition as TransitionConfig<TStateValue, TContext, TEvent, any, any>).id;
    return Effect.gen(function* () {
      const fiber = yield* Effect.sleep(delay).pipe(
        Effect.zipRight(
          Queue.offer(commandQueue, { _tag: "$after", delay } as unknown as TEvent),
        ),
        Effect.forkScoped,
      );
      if (transitionId) {
        delayFibersRef.set(transitionId, fiber as Fiber.RuntimeFiber<void, never>);
      }
    });
  }

  // Handle numeric delays
  const entries = Object.entries(after as Record<number, TransitionConfig<TStateValue, TContext, TEvent, any, any>>);
  return Effect.forEach(
    entries,
    ([delayMs, config]) =>
      Effect.gen(function* () {
        const fiber = yield* Effect.sleep(Duration.millis(Number(delayMs))).pipe(
          Effect.zipRight(
            Queue.offer(commandQueue, { _tag: "$after", delay: delayMs } as unknown as TEvent),
          ),
          Effect.forkScoped,
        );
        if (config.id) {
          delayFibersRef.set(config.id, fiber as Fiber.RuntimeFiber<void, never>);
        }
      }),
    { discard: true },
  );
};
