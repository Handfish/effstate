import { Duration, Effect, Fiber, Queue, Stream, SubscriptionRef } from "effect";
import type {
  Action,
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
): Effect.Effect<MachineActor<TStateValue, TContext, TEvent>, never, R> =>
  Effect.gen(function* () {
    const snapshotRef = yield* SubscriptionRef.make<MachineSnapshot<TStateValue, TContext>>(
      machine.initialSnapshot,
    );

    const commandQueue = yield* Queue.unbounded<TEvent>();
    const activityFibersRef = yield* Effect.sync(() => new Map<string, Fiber.RuntimeFiber<void, never>>());
    const send = (event: TEvent) => commandQueue.unsafeOffer(event);

    // Run entry actions for initial state
    const initialState = machine.config.states[machine.initialSnapshot.value];
    if (initialState?.entry) {
      yield* runActions(initialState.entry, machine.initialSnapshot.context, { _tag: "$init" } as TEvent, send);
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
              yield* runActions(stateConfig.exit, newContext, event, send);
            }

            // Stop activities
            yield* stopAllActivities(activityFibersRef);

            // Run transition actions
            if (transitionConfig.actions) {
              newContext = yield* runActionsWithContext(
                transitionConfig.actions as ReadonlyArray<Action<TContext, TEvent, R, E>>,
                newContext,
                event,
                send,
              );
            }

            // Run entry actions
            const targetStateConfig = machine.config.states[targetState];
            if (targetStateConfig?.entry) {
              newContext = yield* runActionsWithContext(targetStateConfig.entry, newContext, event, send);
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
              yield* handleAfterTransition(targetStateConfig.after, newSnapshot, commandQueue);
            }

            yield* Effect.log(
              `[${machine.id}] ${snapshot.value} -> ${targetState} ($after)`,
            );
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
            yield* runActions(stateConfig.exit, newContext, event, send);
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
              send,
            );
          }

          // Run entry actions if transitioning
          const targetStateConfig = machine.config.states[targetState];
          if (isTransition && targetStateConfig?.entry) {
            newContext = yield* runActionsWithContext(targetStateConfig.entry, newContext, event, send);
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
            yield* handleAfterTransition(targetStateConfig.after, newSnapshot, commandQueue);
          }

          yield* Effect.log(
            `[${machine.id}] ${snapshot.value} -> ${targetState} (${event._tag})`,
          );
        }),
      ),
      Effect.forkScoped,
    );

    return {
      snapshotRef,
      commandQueue,
      send: (event: TEvent) => commandQueue.unsafeOffer(event),
      getSnapshot: SubscriptionRef.get(snapshotRef),
    };
  });

// ============================================================================
// Internal Helpers
// ============================================================================

const runActions = <TContext extends MachineContext, TEvent extends MachineEvent>(
  actions: ReadonlyArray<Action<TContext, TEvent, any, any>>,
  context: TContext,
  event: TEvent,
  send: (event: TEvent) => void,
): Effect.Effect<void, never, any> =>
  Effect.forEach(actions, (action) => {
    switch (action._tag) {
      case "assign":
        return Effect.void;
      case "effect":
        return action.fn({ context, event }).pipe(Effect.catchAll(() => Effect.void));
      case "raise": {
        const raisedEvent = typeof action.event === "function"
          ? action.event({ context, event })
          : action.event;
        send(raisedEvent);
        return Effect.void;
      }
    }
  }, { discard: true });

const runActionsWithContext = <TContext extends MachineContext, TEvent extends MachineEvent>(
  actions: ReadonlyArray<Action<TContext, TEvent, any, any>>,
  context: TContext,
  event: TEvent,
  send: (event: TEvent) => void,
): Effect.Effect<TContext, never, any> =>
  Effect.reduce(actions, context, (ctx, action) => {
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
        send(raisedEvent);
        return Effect.succeed(ctx);
      }
    }
  });

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
): Effect.Effect<void, never, any> =>
  Effect.forEach(
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

const stopAllActivities = (
  fibersRef: Map<string, Fiber.RuntimeFiber<void, never>>,
): Effect.Effect<void> =>
  Effect.forEach(
    Array.from(fibersRef.values()),
    (fiber) => Fiber.interrupt(fiber).pipe(Effect.catchAll(() => Effect.void)),
    { discard: true },
  ).pipe(
    Effect.tap(() => Effect.sync(() => fibersRef.clear())),
  );

const handleAfterTransition = <
  TStateValue extends string,
  TContext extends object,
  TEvent extends MachineEvent,
>(
  after: StateNodeConfig<TStateValue, TContext, TEvent, any, any>["after"],
  _snapshot: MachineSnapshot<TStateValue, TContext>,
  commandQueue: Queue.Queue<TEvent>,
): Effect.Effect<void, never, any> => {
  if (!after) return Effect.void;

  // Handle object with delay/transition
  if ("delay" in after && "transition" in after) {
    const delay = Duration.decode(after.delay);
    return Effect.sleep(delay).pipe(
      Effect.zipRight(
        Queue.offer(commandQueue, { _tag: "$after", delay } as unknown as TEvent),
      ),
      Effect.forkScoped,
      Effect.asVoid,
    );
  }

  // Handle numeric delays
  const entries = Object.entries(after as Record<number, TransitionConfig<TStateValue, TContext, TEvent, any, any>>);
  return Effect.forEach(
    entries,
    ([delayMs, _config]) =>
      Effect.sleep(Duration.millis(Number(delayMs))).pipe(
        Effect.zipRight(
          Queue.offer(commandQueue, { _tag: "$after", delay: delayMs } as unknown as TEvent),
        ),
        Effect.forkScoped,
      ),
    { discard: true },
  );
};
