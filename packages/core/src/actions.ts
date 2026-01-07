import { Effect } from "effect";
import type {
  Action,
  AssignAction,
  CancelAction,
  EffectAction,
  EffectError,
  EffectSuccess,
  EmitAction,
  EmittedEvent,
  EnqueueActionsAction,
  EnqueueActionsParams,
  ErrorByTag,
  ForwardToAction,
  Guard,
  InvokeDefectEvent,
  InvokeFailureEvent,
  InvokeInterruptEvent,
  InvokeResult,
  InvokeSuccessEvent,
  MachineContext,
  MachineDefinitionE,
  MachineDefinitionR,
  MachineEvent,
  RaiseAction,
  SendParentAction,
  SendToAction,
  SpawnChildAction,
  StopChildAction,
  TaggedError,
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
): AssignAction<TContext> {
  // Cast to the base types for storage - the machine will pass the actual types at runtime
  const fn = typeof assignment === "function"
    ? assignment as (params: { context: MachineContext; event: MachineEvent }) => Partial<TContext>
    : () => assignment;
  return { _tag: "assign", fn };
}

// ============================================================================
// Typed Invoke Action Helpers
// ============================================================================

/**
 * Create an assign action for invoke onSuccess handlers.
 * Provides proper typing for the output value.
 *
 * @example
 * ```ts
 * onSuccess: {
 *   actions: [
 *     assignOnSuccess<MyContext, User>(({ context, output }) => ({
 *       user: output,
 *       loading: false,
 *     })),
 *   ],
 * }
 * ```
 */
export function assignOnSuccess<TContext extends MachineContext, TOutput>(
  fn: (params: { context: TContext; output: TOutput }) => Partial<TContext>,
): AssignAction<TContext, InvokeSuccessEvent<TOutput>> {
  return {
    _tag: "assign",
    // Cast needed: AssignAction.fn receives MachineEvent, but we know this is used in onSuccess handlers
    fn: ({ context, event }) => fn({
      context: context as TContext,
      output: (event as InvokeSuccessEvent<TOutput>).output,
    }),
  };
}

/**
 * Create an assign action for invoke onFailure/catchTags handlers.
 * Provides proper typing for the error value.
 *
 * @example
 * ```ts
 * catchTags: {
 *   NetworkError: {
 *     actions: [
 *       assignOnFailure<MyContext, NetworkError>(({ context, error }) => ({
 *         errorMessage: error.message,
 *       })),
 *     ],
 *   },
 * }
 * ```
 */
export function assignOnFailure<TContext extends MachineContext, TError>(
  fn: (params: { context: TContext; error: TError }) => Partial<TContext>,
): AssignAction<TContext, InvokeFailureEvent<TError>> {
  return {
    _tag: "assign",
    // Cast needed: AssignAction.fn receives MachineEvent, but we know this is used in onFailure handlers
    fn: ({ context, event }) => fn({
      context: context as TContext,
      error: (event as InvokeFailureEvent<TError>).error,
    }),
  };
}

/**
 * Create an assign action for invoke onDefect handlers.
 * Provides access to the defect (unexpected error) value.
 *
 * @example
 * ```ts
 * onDefect: {
 *   actions: [
 *     assignOnDefect<MyContext>(({ context, defect }) => ({
 *       errorMessage: `Unexpected error: ${String(defect)}`,
 *     })),
 *   ],
 * }
 * ```
 */
export function assignOnDefect<TContext extends MachineContext>(
  fn: (params: { context: TContext; defect: unknown }) => Partial<TContext>,
): AssignAction<TContext, InvokeDefectEvent> {
  return {
    _tag: "assign",
    // Cast needed: AssignAction.fn receives MachineEvent, but we know this is used in onDefect handlers
    fn: ({ context, event }) => fn({
      context: context as TContext,
      defect: (event as InvokeDefectEvent).defect,
    }),
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
export function raise<
  TContext extends MachineContext,
  TEvent extends MachineEvent,
>(
  event: TEvent | ((params: { context: TContext; event: MachineEvent }) => TEvent),
): RaiseAction<TContext, TEvent> {
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
    return Effect.log(msg);
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
 * Minimal constraint for machine definitions - avoids deep structural checking
 * that causes contravariance issues with `exactOptionalPropertyTypes`.
 */
interface MachineDefinitionLike {
  readonly _tag: "MachineDefinition";
  readonly id: string;
}

/**
 * Spawn a child actor from a machine definition.
 *
 * The child machine's R channel (requirements) is preserved for dependency composition.
 * Internal TContext/TEvent types are erased to avoid TypeScript contravariance issues.
 *
 * For automatic R channel composition, use Effect.Service with dependencies instead.
 *
 * @example
 * ```ts
 * // Static ID
 * spawnChild(GarageDoorMachine, { id: "myChild" })
 *
 * // Dynamic ID from context
 * spawnChild(GarageDoorMachine, { id: ({ context }) => `child-${context.count}` })
 * ```
 */
export function spawnChild<
  TContext extends MachineContext,
  TEvent extends MachineEvent = MachineEvent,
  // Use minimal constraint to avoid contravariance issues, but infer full type
  TDef extends MachineDefinitionLike = MachineDefinitionLike,
>(
  src: TDef,
  options: {
    id: string | ((params: { context: TContext; event: TEvent }) => string);
  },
): SpawnChildAction<TContext, TEvent, MachineDefinitionR<TDef>, MachineDefinitionE<TDef>> {
  return {
    _tag: "spawnChild",
    // Cast through unknown to convert from specific MachineDefinition to type-erased AnyMachineDefinition
    src: src as unknown as import("./types.js").AnyMachineDefinition<MachineDefinitionR<TDef>, MachineDefinitionE<TDef>>,
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
// Invoke Helper
// ============================================================================

/**
 * Helper to create invoke configurations with proper type inference.
 *
 * When defining invoke directly in state config, TypeScript can't infer
 * output/error types from the src function. This helper enables inference.
 *
 * @example
 * ```ts
 * invoke: invoke({
 *   src: () => fetchWeather(), // Effect<WeatherData, WeatherError, never>
 *   assignResult: {
 *     success: ({ output }) => ({ data: output }), // output is WeatherData
 *     catchTags: {
 *       WeatherError: ({ error }) => ({ error: error.message }), // error is WeatherError
 *     },
 *   },
 * })
 * ```
 */
export function invoke<
  TStateValue extends string,
  TContext extends MachineContext,
  TEvent extends MachineEvent,
  A,
  E,
  R,
>(config: {
  readonly id?: string;
  readonly src: (params: { context: TContext; event: TEvent }) => Effect.Effect<A, E, R>;
  readonly onSuccess?: {
    readonly target?: TStateValue;
    readonly guard?: Guard<TContext, InvokeSuccessEvent<A>>;
    readonly actions?: ReadonlyArray<Action<TContext, InvokeSuccessEvent<A>, R, never>>;
  };
  readonly onDone?: {
    readonly target?: TStateValue;
    readonly guard?: Guard<TContext, InvokeSuccessEvent<A>>;
    readonly actions?: ReadonlyArray<Action<TContext, InvokeSuccessEvent<A>, R, never>>;
  };
  readonly catchTags?: E extends TaggedError
    ? {
        readonly [K in E["_tag"]]?: {
          readonly target?: TStateValue;
          readonly guard?: Guard<TContext, InvokeFailureEvent<ErrorByTag<E, K>>>;
          readonly actions?: ReadonlyArray<Action<TContext, InvokeFailureEvent<ErrorByTag<E, K>>, R, never>>;
        };
      }
    : Record<string, {
        readonly target?: TStateValue;
        readonly guard?: Guard<TContext, InvokeFailureEvent<TaggedError>>;
        readonly actions?: ReadonlyArray<Action<TContext, InvokeFailureEvent<TaggedError>, R, never>>;
      }>;
  readonly onFailure?: {
    readonly target?: TStateValue;
    readonly guard?: Guard<TContext, InvokeFailureEvent<E>>;
    readonly actions?: ReadonlyArray<Action<TContext, InvokeFailureEvent<E>, R, never>>;
  };
  readonly onError?: {
    readonly target?: TStateValue;
    readonly guard?: Guard<TContext, InvokeFailureEvent<E>>;
    readonly actions?: ReadonlyArray<Action<TContext, InvokeFailureEvent<E>, R, never>>;
  };
  readonly onDefect?: {
    readonly target?: TStateValue;
    readonly actions?: ReadonlyArray<Action<TContext, InvokeDefectEvent, R, never>>;
  };
  readonly onInterrupt?: {
    readonly target?: TStateValue;
    readonly actions?: ReadonlyArray<Action<TContext, InvokeInterruptEvent, R, never>>;
  };
  readonly assignResult?: {
    readonly success: (params: { context: TContext; output: A }) => Partial<TContext>;
    readonly catchTags?: E extends TaggedError
      ? {
          readonly [K in E["_tag"]]?: (params: { context: TContext; error: ErrorByTag<E, K> }) => Partial<TContext>;
        }
      : Record<string, (params: { context: TContext; error: TaggedError }) => Partial<TContext>>;
    readonly failure?: (params: { context: TContext; error: E }) => Partial<TContext>;
    readonly defect?: (params: { context: TContext; defect: unknown }) => Partial<TContext>;
  };
}): InvokeResult<R> {
  // Return the config as InvokeResult. At runtime it's the full object,
  // but the branded type ensures users must use invoke() to create it.
  // Type safety is provided by the config parameter type.
  return config as unknown as InvokeResult<R>;
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
