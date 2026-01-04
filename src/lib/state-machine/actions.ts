import type { Effect } from "effect";
import type {
  Action,
  AssignAction,
  CancelAction,
  EffectAction,
  EmitAction,
  EmittedEvent,
  EnqueueActionsAction,
  EnqueueActionsParams,
  ForwardToAction,
  MachineContext,
  MachineDefinition,
  MachineEvent,
  RaiseAction,
  SendParentAction,
  SendToAction,
  SpawnChildAction,
  StopChildAction,
} from "./types.js";

// ============================================================================
// Action Creators
// ============================================================================

/**
 * Create an assign action that updates context
 *
 * @example
 * ```ts
 * assign(({ context }) => ({ count: context.count + 1 }))
 * assign({ count: 0 }) // static assignment
 * ```
 */
export function assign<
  TContext extends MachineContext,
  TEvent extends MachineEvent = MachineEvent,
>(
  assignment:
    | Partial<TContext>
    | ((params: { context: TContext; event: TEvent }) => Partial<TContext>),
): AssignAction<TContext, TEvent> {
  return {
    _tag: "assign",
    fn: typeof assignment === "function"
      ? assignment
      : () => assignment,
  };
}

/**
 * Create an effect action for side effects
 *
 * @example
 * ```ts
 * effect(({ context }) => Effect.log(`Count is ${context.count}`))
 * ```
 */
export function effect<
  TContext extends MachineContext,
  TEvent extends MachineEvent = MachineEvent,
  R = never,
  E = never,
>(
  fn: (params: { context: TContext; event: TEvent }) => Effect.Effect<void, E, R>,
): EffectAction<TContext, TEvent, R, E> {
  return {
    _tag: "effect",
    fn,
  };
}

/**
 * Create a raise action to send an event to self
 *
 * @example
 * ```ts
 * raise({ type: "TIMER_TICK" })
 * raise(({ context }) => ({ type: "UPDATE", payload: context.value }))
 * ```
 */
export function raise<TEvent extends MachineEvent>(
  event: TEvent | ((params: { context: unknown; event: MachineEvent }) => TEvent),
): RaiseAction<TEvent> {
  return {
    _tag: "raise",
    event,
  };
}

/**
 * Cancel a pending delayed event by its ID.
 *
 * @example
 * ```ts
 * // In after config, give the delay an ID
 * after: {
 *   1000: { target: "timeout", id: "myDelay" }
 * }
 *
 * // Cancel it before it fires
 * actions: [cancel("myDelay")]
 *
 * // Or with dynamic ID
 * actions: [cancel(({ context }) => `delay-${context.id}`)]
 * ```
 */
export function cancel<
  TContext extends MachineContext,
  TEvent extends MachineEvent = MachineEvent,
>(
  sendId: string | ((params: { context: TContext; event: TEvent }) => string),
): CancelAction<TContext, TEvent> {
  return {
    _tag: "cancel",
    sendId,
  };
}

/**
 * Emit an event to external listeners registered via actor.on().
 *
 * @example
 * ```ts
 * // Static event
 * emit({ type: "notification", message: "Hello" })
 *
 * // Dynamic event from context
 * emit(({ context }) => ({ type: "countChanged", count: context.count }))
 *
 * // Listen externally
 * const actor = interpret(machine);
 * actor.on("notification", (event) => console.log(event.message));
 * ```
 */
export function emit<
  TContext extends MachineContext,
  TEvent extends MachineEvent = MachineEvent,
  TEmitted extends EmittedEvent = EmittedEvent,
>(
  event: TEmitted | ((params: { context: TContext; event: TEvent }) => TEmitted),
): EmitAction<TContext, TEvent, TEmitted> {
  return {
    _tag: "emit",
    event,
  };
}

/**
 * Log action helper
 */
export function log<
  TContext extends MachineContext,
  TEvent extends MachineEvent = MachineEvent,
>(
  message: string | ((params: { context: TContext; event: TEvent }) => string),
): EffectAction<TContext, TEvent, never, never> {
  return effect(({ context, event }) => {
    const msg = typeof message === "function" ? message({ context, event }) : message;
    return import("effect").then(({ Effect }) => Effect.log(msg)) as any;
  });
}

/**
 * Dynamically enqueue actions at runtime based on conditions.
 *
 * @example
 * ```ts
 * enqueueActions(({ context, event, enqueue }) => {
 *   enqueue(assign({ count: 0 }));
 *
 *   if (context.count > 10) {
 *     enqueue.assign({ status: 'high' });
 *   }
 *
 *   enqueue.raise({ _tag: 'DONE' });
 * })
 * ```
 */
export function enqueueActions<
  TContext extends MachineContext,
  TEvent extends MachineEvent = MachineEvent,
  R = never,
  E = never,
>(
  collect: (params: EnqueueActionsParams<TContext, TEvent, R, E>) => void,
): EnqueueActionsAction<TContext, TEvent, R, E> {
  return {
    _tag: "enqueueActions",
    collect,
  };
}

/**
 * Spawn a child actor from a machine definition.
 *
 * @example
 * ```ts
 * // Static ID
 * spawnChild(childMachine, { id: "myChild" })
 *
 * // Dynamic ID from context
 * spawnChild(childMachine, { id: ({ context }) => `child-${context.count}` })
 * ```
 */
export function spawnChild<
  TContext extends MachineContext,
  TEvent extends MachineEvent = MachineEvent,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TChildMachine extends MachineDefinition<string, string, any, any, unknown, unknown> = MachineDefinition<string, string, any, any, unknown, unknown>,
>(
  src: TChildMachine,
  options: {
    id: string | ((params: { context: TContext; event: TEvent }) => string);
  },
): SpawnChildAction<TContext, TEvent, TChildMachine> {
  return {
    _tag: "spawnChild",
    src,
    id: options.id,
  };
}

/**
 * Stop a child actor by ID.
 *
 * @example
 * ```ts
 * // Static ID
 * stopChild("myChild")
 *
 * // Dynamic ID from context/event
 * stopChild(({ context }) => `child-${context.count}`)
 * stopChild(({ event }) => `child-${event.childId}`)
 * ```
 */
export function stopChild<
  TContext extends MachineContext,
  TEvent extends MachineEvent = MachineEvent,
>(
  childId: string | ((params: { context: TContext; event: TEvent }) => string),
): StopChildAction<TContext, TEvent> {
  return {
    _tag: "stopChild",
    childId,
  };
}

/**
 * Send an event to a child actor by ID.
 *
 * @example
 * ```ts
 * // Static target and event
 * sendTo("myChild", new ChildEvent())
 *
 * // Dynamic target from context
 * sendTo(({ context }) => `child-${context.id}`, new ChildEvent())
 *
 * // Dynamic event from context
 * sendTo("myChild", ({ context }) => new CountEvent({ count: context.count }))
 * ```
 */
export function sendTo<
  TContext extends MachineContext,
  TEvent extends MachineEvent = MachineEvent,
  TTargetEvent extends MachineEvent = MachineEvent,
>(
  target: string | ((params: { context: TContext; event: TEvent }) => string),
  event: TTargetEvent | ((params: { context: TContext; event: TEvent }) => TTargetEvent),
): SendToAction<TContext, TEvent, TTargetEvent> {
  return {
    _tag: "sendTo",
    target,
    event,
  };
}

/**
 * Send an event to the parent actor.
 *
 * @example
 * ```ts
 * // Static event
 * sendParent(new DoneEvent({ result: 42 }))
 *
 * // Dynamic event from context
 * sendParent(({ context }) => new CountEvent({ count: context.count }))
 * ```
 */
export function sendParent<
  TContext extends MachineContext,
  TEvent extends MachineEvent = MachineEvent,
  TParentEvent extends MachineEvent = MachineEvent,
>(
  event: TParentEvent | ((params: { context: TContext; event: TEvent }) => TParentEvent),
): SendParentAction<TContext, TEvent, TParentEvent> {
  return {
    _tag: "sendParent",
    event,
  };
}

/**
 * Forward the current event to a child actor.
 *
 * @example
 * ```ts
 * // Static target
 * forwardTo("myChild")
 *
 * // Dynamic target from context
 * forwardTo(({ context }) => `child-${context.id}`)
 * ```
 */
export function forwardTo<
  TContext extends MachineContext,
  TEvent extends MachineEvent = MachineEvent,
>(
  target: string | ((params: { context: TContext; event: TEvent }) => string),
): ForwardToAction<TContext, TEvent> {
  return {
    _tag: "forwardTo",
    target,
  };
}

// ============================================================================
// Type Helpers
// ============================================================================

export type ActionFrom<T> = T extends Action<infer C, infer E, infer R, infer Err>
  ? Action<C, E, R, Err>
  : never;

export type ActionsArray<
  TContext extends MachineContext,
  TEvent extends MachineEvent,
  R = never,
  E = never,
> = ReadonlyArray<Action<TContext, TEvent, R, E>>;
