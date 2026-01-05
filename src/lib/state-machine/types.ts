import { Data, type Duration, type Effect, type Schema } from "effect";

// ============================================================================
// Core Types
// ============================================================================

/**
 * Base context type - allows any object
 */
export type MachineContext = object;

/**
 * Represents a state machine event with a _tag discriminator.
 * Compatible with Effect's Data.TaggedClass pattern.
 */
export interface MachineEvent<TTag extends string = string> {
  readonly _tag: TTag;
}

/**
 * State snapshot containing current state, context, and metadata
 */
export interface MachineSnapshot<
  TStateValue extends string,
  TContext extends MachineContext,
> {
  readonly value: TStateValue;
  readonly context: TContext;
  readonly event: MachineEvent | null;
}

// ============================================================================
// Action Types
// ============================================================================

/**
 * Sync action that can modify context.
 *
 * Note: The fn parameter uses MachineContext/MachineEvent in contravariant position
 * to allow narrower assign actions to be used where wider ones are expected.
 * This is safe because the machine always passes the full context.
 */
export interface AssignAction<
  TContext extends MachineContext,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _TEvent extends MachineEvent = MachineEvent,
> {
  readonly _tag: "assign";
  readonly fn: (params: { context: MachineContext; event: MachineEvent }) => Partial<TContext>;
}

/**
 * Effect action for side effects (logging, API calls, etc.)
 */
export interface EffectAction<
  TContext extends MachineContext,
  TEvent extends MachineEvent,
  R = never,
  E = never,
> {
  readonly _tag: "effect";
  readonly fn: (params: { context: TContext; event: TEvent }) => Effect.Effect<void, E, R>;
}

/**
 * Raise action to send events to self
 */
export interface RaiseAction<TEvent extends MachineEvent> {
  readonly _tag: "raise";
  readonly event: TEvent | ((params: { context: unknown; event: MachineEvent }) => TEvent);
}

/**
 * Cancel action to cancel a pending delayed event by ID
 */
export interface CancelAction<
  TContext extends MachineContext,
  TEvent extends MachineEvent,
> {
  readonly _tag: "cancel";
  readonly sendId: string | ((params: { context: TContext; event: TEvent }) => string);
}

/**
 * Base type for emitted events (events sent to external listeners)
 */
export interface EmittedEvent {
  readonly type: string;
}

// ============================================================================
// Machine Error Types (Effect TaggedErrors)
// ============================================================================

/**
 * Error thrown when an effect action fails
 */
export class EffectActionError extends Data.TaggedError("EffectActionError")<{
  readonly message: string;
  readonly actionId?: string;
  readonly cause?: unknown;
}> {}

/**
 * Error thrown when an activity fails
 */
export class ActivityError extends Data.TaggedError("ActivityError")<{
  readonly message: string;
  readonly activityId: string;
  readonly cause?: unknown;
}> {}

/**
 * Union of all machine error types
 */
export type StateMachineError =
  | EffectActionError
  | ActivityError;

/**
 * Emit action to send events to external listeners via actor.on()
 */
export interface EmitAction<
  TContext extends MachineContext,
  TEvent extends MachineEvent,
  TEmitted extends EmittedEvent = EmittedEvent,
> {
  readonly _tag: "emit";
  readonly event: TEmitted | ((params: { context: TContext; event: TEvent }) => TEmitted);
}

/**
 * Enqueue actions interface for building dynamic action lists.
 * Provides shortcuts for common action types.
 */
export interface ActionEnqueuer<
  TContext extends MachineContext,
  TEvent extends MachineEvent,
  R = never,
  E = never,
> {
  /** Enqueue any action */
  (action: Action<TContext, TEvent, R, E>): void;
  /** Enqueue an assign action */
  assign: (
    assignment:
      | Partial<TContext>
      | ((params: { context: TContext; event: TEvent }) => Partial<TContext>),
  ) => void;
  /** Enqueue a raise action (can raise any event type) */
  raise: (
    event: MachineEvent | ((params: { context: TContext; event: TEvent }) => MachineEvent),
  ) => void;
  /** Enqueue an effect action */
  effect: (
    fn: (params: { context: TContext; event: TEvent }) => import("effect").Effect.Effect<void, E, R>,
  ) => void;
}

/**
 * Parameters passed to enqueueActions collector function
 */
export interface EnqueueActionsParams<
  TContext extends MachineContext,
  TEvent extends MachineEvent,
  R = never,
  E = never,
> {
  readonly context: TContext;
  readonly event: TEvent;
  readonly enqueue: ActionEnqueuer<TContext, TEvent, R, E>;
}

/**
 * EnqueueActions action for dynamically building action lists at runtime
 */
export interface EnqueueActionsAction<
  TContext extends MachineContext,
  TEvent extends MachineEvent,
  R = never,
  E = never,
> {
  readonly _tag: "enqueueActions";
  readonly collect: (params: EnqueueActionsParams<TContext, TEvent, R, E>) => void;
}

/**
 * SpawnChild action to dynamically create a child actor.
 *
 * The child machine's R channel (requirements) is preserved for dependency composition,
 * while internal TContext/TEvent types are erased to avoid contravariance issues.
 *
 * For automatic R channel composition, use Effect.Service with dependencies instead.
 *
 * @example
 * ```ts
 * entry: [
 *   spawnChild(GarageDoorMachine, { id: "garage-door" }),
 * ]
 * ```
 */
export interface SpawnChildAction<
  TContext extends MachineContext,
  TEvent extends MachineEvent,
  TChildR = unknown,
  TChildE = unknown,
> {
  readonly _tag: "spawnChild";
  readonly src: AnyMachineDefinition<TChildR, TChildE>;
  readonly id: string | ((params: { context: TContext; event: TEvent }) => string);
}

/**
 * StopChild action to stop a child actor by ID
 */
export interface StopChildAction<
  TContext extends MachineContext,
  TEvent extends MachineEvent,
> {
  readonly _tag: "stopChild";
  readonly childId: string | ((params: { context: TContext; event: TEvent }) => string);
}

/**
 * SendTo action to send an event to a child actor by ID
 */
export interface SendToAction<
  TContext extends MachineContext,
  TEvent extends MachineEvent,
  TTargetEvent extends MachineEvent = MachineEvent,
> {
  readonly _tag: "sendTo";
  readonly target: string | ((params: { context: TContext; event: TEvent }) => string);
  readonly event: TTargetEvent | ((params: { context: TContext; event: TEvent }) => TTargetEvent);
}

/**
 * SendParent action to send an event to the parent actor
 */
export interface SendParentAction<
  TContext extends MachineContext,
  TEvent extends MachineEvent,
  TParentEvent extends MachineEvent = MachineEvent,
> {
  readonly _tag: "sendParent";
  readonly event: TParentEvent | ((params: { context: TContext; event: TEvent }) => TParentEvent);
}

/**
 * ForwardTo action to forward the current event to a child actor
 */
export interface ForwardToAction<
  TContext extends MachineContext,
  TEvent extends MachineEvent,
> {
  readonly _tag: "forwardTo";
  readonly target: string | ((params: { context: TContext; event: TEvent }) => string);
}

export type Action<
  TContext extends MachineContext,
  TEvent extends MachineEvent,
  R = never,
  E = never,
> =
  | AssignAction<TContext, TEvent>
  | EffectAction<TContext, TEvent, R, E>
  | RaiseAction<MachineEvent>
  | CancelAction<TContext, TEvent>
  | EmitAction<TContext, TEvent>
  | EnqueueActionsAction<TContext, TEvent, R, E>
  | SpawnChildAction<TContext, TEvent, unknown, unknown>
  | StopChildAction<TContext, TEvent>
  | SendToAction<TContext, TEvent>
  | SendParentAction<TContext, TEvent>
  | ForwardToAction<TContext, TEvent>;

// ============================================================================
// Guard Types
// ============================================================================

/**
 * Guard condition - a pure synchronous predicate.
 * Returns true to allow the transition, false to block it.
 *
 * For async validation, use the state machine pattern:
 * transition to a "validating" state, run the async check as an effect,
 * then raise an event based on the result.
 */
export type Guard<
  TContext extends MachineContext,
  TEvent extends MachineEvent,
> = (params: { context: TContext; event: TEvent }) => boolean;

// ============================================================================
// Transition Types
// ============================================================================

export interface TransitionConfig<
  TStateValue extends string,
  TContext extends MachineContext,
  TEvent extends MachineEvent,
  R = never,
  E = never,
> {
  readonly target?: TStateValue;
  readonly guard?: Guard<TContext, TEvent>;
  readonly actions?: ReadonlyArray<Action<TContext, TEvent, R, E>>;
  /** Optional ID for delayed transitions (used with cancel()) */
  readonly id?: string;
}

// ============================================================================
// Activity Types (for long-running effects like animations)
// ============================================================================

export interface ActivityConfig<
  TContext extends MachineContext,
  TEvent extends MachineEvent,
  R = never,
  E = never,
> {
  readonly id: string;
  readonly src: (params: {
    context: TContext;
    event: TEvent;
    send: (event: TEvent) => void;
  }) => Effect.Effect<void, E, R>;
}

// ============================================================================
// Invoke Types (for async operations with cause-aware error handling)
// ============================================================================

/**
 * Internal event emitted when an invoke completes successfully
 */
export interface InvokeSuccessEvent<TOutput = unknown> {
  readonly _tag: "$invoke.success";
  readonly id: string;
  readonly output: TOutput;
}

/**
 * Internal event emitted when an invoke fails with a typed error (E channel)
 */
export interface InvokeFailureEvent<TError = unknown> {
  readonly _tag: "$invoke.failure";
  readonly id: string;
  readonly error: TError;
}

/**
 * Internal event emitted when an invoke fails with an unexpected error (defect)
 */
export interface InvokeDefectEvent {
  readonly _tag: "$invoke.defect";
  readonly id: string;
  readonly defect: unknown;
}

/**
 * Internal event emitted when an invoke is interrupted
 */
export interface InvokeInterruptEvent {
  readonly _tag: "$invoke.interrupt";
  readonly id: string;
}

/** @deprecated Use InvokeSuccessEvent instead */
export type InvokeDoneEvent<TOutput = unknown> = InvokeSuccessEvent<TOutput>;

/** @deprecated Use InvokeFailureEvent instead */
export type InvokeErrorEvent<TError = unknown> = InvokeFailureEvent<TError>;

/**
 * Helper type to extract tagged error types from an error union
 */
export type TaggedError = { readonly _tag: string };

/**
 * Extract the specific error type from a union based on its _tag field
 */
export type ErrorByTag<TError, TTag extends string> = Extract<TError, { _tag: TTag }>;

/**
 * Invoke configuration for async operations.
 * Uses Effect's Cause to distinguish between typed failures, defects, and interrupts.
 *
 * @example Basic usage
 * ```ts
 * loading: {
 *   invoke: {
 *     id: "fetchUser",
 *     src: ({ context }) => fetchUser(context.userId),
 *     onSuccess: {
 *       target: "ready",
 *       actions: [assign(({ event }) => ({ user: event.output }))],
 *     },
 *     onFailure: {
 *       target: "error",
 *       actions: [assign(({ event }) => ({ error: event.error }))],
 *     },
 *   },
 * }
 * ```
 *
 * @example With catchTags for typed error handling
 * ```ts
 * loading: {
 *   invoke: {
 *     src: () => fetchUser(), // Effect<User, NetworkError | ValidationError, R>
 *     onSuccess: { target: "ready" },
 *     catchTags: {
 *       NetworkError: { target: "retry" },
 *       ValidationError: { target: "invalid" },
 *     },
 *     onFailure: { target: "error" }, // Fallback for unhandled errors
 *     onDefect: { target: "crashed" }, // Unexpected throws
 *   },
 * }
 * ```
 */
export interface InvokeConfig<
  TStateValue extends string,
  TContext extends MachineContext,
  TEvent extends MachineEvent,
  TOutput = unknown,
  TError = unknown,
  R = never,
> {
  /** Unique identifier for this invoke (used for cancellation) */
  readonly id?: string;

  /** Effect to execute - receives context and triggering event */
  readonly src: (params: {
    context: TContext;
    event: TEvent;
  }) => Effect.Effect<TOutput, TError, R>;

  /**
   * Transition when Effect succeeds.
   * Receives InvokeSuccessEvent with the output value.
   */
  readonly onSuccess?: {
    readonly target?: TStateValue;
    readonly guard?: Guard<TContext, InvokeSuccessEvent<TOutput>>;
    readonly actions?: ReadonlyArray<Action<TContext, InvokeSuccessEvent<TOutput>, R, never>>;
  };

  /** @deprecated Use onSuccess instead */
  readonly onDone?: {
    readonly target?: TStateValue;
    readonly guard?: Guard<TContext, InvokeSuccessEvent<TOutput>>;
    readonly actions?: ReadonlyArray<Action<TContext, InvokeSuccessEvent<TOutput>, R, never>>;
  };

  /**
   * Handle specific tagged error types differently.
   * Only works with errors that have a `_tag` property (e.g., Data.TaggedError).
   * Takes precedence over onFailure for matching error tags.
   */
  readonly catchTags?: TError extends TaggedError
    ? {
        readonly [K in TError["_tag"]]?: {
          readonly target?: TStateValue;
          readonly guard?: Guard<TContext, InvokeFailureEvent<ErrorByTag<TError, K>>>;
          readonly actions?: ReadonlyArray<Action<TContext, InvokeFailureEvent<ErrorByTag<TError, K>>, R, never>>;
        };
      }
    : never;

  /**
   * Fallback transition for typed errors (E channel) not handled by catchTags.
   * Receives InvokeFailureEvent with the error value.
   */
  readonly onFailure?: {
    readonly target?: TStateValue;
    readonly guard?: Guard<TContext, InvokeFailureEvent<TError>>;
    readonly actions?: ReadonlyArray<Action<TContext, InvokeFailureEvent<TError>, R, never>>;
  };

  /** @deprecated Use onFailure instead */
  readonly onError?: {
    readonly target?: TStateValue;
    readonly guard?: Guard<TContext, InvokeFailureEvent<TError>>;
    readonly actions?: ReadonlyArray<Action<TContext, InvokeFailureEvent<TError>, R, never>>;
  };

  /**
   * Transition when Effect fails with an unexpected error (defect/die).
   * Defects are unexpected errors like thrown exceptions or Effect.die().
   */
  readonly onDefect?: {
    readonly target?: TStateValue;
    readonly actions?: ReadonlyArray<Action<TContext, InvokeDefectEvent, R, never>>;
  };

  /**
   * Transition when the invoke fiber is interrupted.
   * Useful for cleanup or showing cancellation state.
   */
  readonly onInterrupt?: {
    readonly target?: TStateValue;
    readonly actions?: ReadonlyArray<Action<TContext, InvokeInterruptEvent, R, never>>;
  };
}

// ============================================================================
// State Node Config
// ============================================================================

/**
 * Extract the specific event type from a union based on its _tag field.
 * This enables proper event narrowing in transition handlers.
 */
export type EventByTag<TEvent extends MachineEvent, TTag extends TEvent["_tag"]> = Extract<
  TEvent,
  { _tag: TTag }
>;

/**
 * Transition config with properly narrowed event type.
 * When handling a "TICK" event, the event parameter will be typed as the TICK event specifically.
 */
export interface NarrowedTransitionConfig<
  TStateValue extends string,
  TContext extends MachineContext,
  TEvent extends MachineEvent,
  TEventTag extends TEvent["_tag"],
  R = never,
  E = never,
> {
  readonly target?: TStateValue;
  readonly guard?: Guard<TContext, EventByTag<TEvent, TEventTag>>;
  readonly actions?: ReadonlyArray<Action<TContext, EventByTag<TEvent, TEventTag>, R, E>>;
}

export interface StateNodeConfig<
  TStateValue extends string,
  TContext extends MachineContext,
  TEvent extends MachineEvent,
  R = never,
  E = never,
> {
  readonly entry?: ReadonlyArray<Action<TContext, TEvent, R, E>>;
  readonly exit?: ReadonlyArray<Action<TContext, TEvent, R, E>>;
  readonly on?: {
    readonly [K in TEvent["_tag"]]?: NarrowedTransitionConfig<TStateValue, TContext, TEvent, K, R, E>;
  };
  readonly activities?: ReadonlyArray<ActivityConfig<TContext, TEvent, R, E>>;
  /** Invoke an Effect when entering this state. Auto-sends done/error events. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly invoke?: InvokeConfig<TStateValue, TContext, TEvent, any, any, R>;
  /** After delay, auto-transition */
  readonly after?: {
    readonly [delay: number]: TransitionConfig<TStateValue, TContext, TEvent, R, E>;
  } | {
    readonly delay: Duration.DurationInput;
    readonly transition: TransitionConfig<TStateValue, TContext, TEvent, R, E>;
  };
}

// ============================================================================
// Machine Config (Schema-based context required)
// ============================================================================

/**
 * Machine configuration with Schema-based context.
 * Context must be defined using Effect Schema for type-safe serialization.
 *
 * @example
 * ```ts
 * const ContextSchema = Schema.Struct({
 *   count: Schema.Number,
 *   lastUpdated: Schema.DateFromString,
 * });
 *
 * const machine = createMachine({
 *   id: "counter",
 *   initial: "idle",
 *   context: ContextSchema,
 *   initialContext: { count: 0, lastUpdated: new Date() },
 *   states: { ... },
 * });
 * ```
 */
/**
 * Schema-based machine config (with serialization support)
 */
export interface MachineConfigSchema<
  TId extends string,
  TStateValue extends string,
  TContext extends MachineContext,
  TEvent extends MachineEvent,
  R = never,
  E = never,
  TContextEncoded = unknown,
> {
  readonly id: TId;
  readonly initial: TStateValue;
  /** Schema for context validation and serialization */
  readonly context: Schema.Schema<TContext, TContextEncoded>;
  /** Initial context value */
  readonly initialContext: TContext;
  readonly states: Record<TStateValue, StateNodeConfig<TStateValue, TContext, TEvent, R, E>>;
}

/**
 * Plain machine config (backwards compatible, no serialization)
 */
export interface MachineConfigPlain<
  TId extends string,
  TStateValue extends string,
  TContext extends MachineContext,
  TEvent extends MachineEvent,
  R = never,
  E = never,
> {
  readonly id: TId;
  readonly initial: TStateValue;
  /** Plain context object */
  readonly context: TContext;
  readonly states: Record<TStateValue, StateNodeConfig<TStateValue, TContext, TEvent, R, E>>;
}

/**
 * Union of machine config types
 */
export type MachineConfig<
  TId extends string,
  TStateValue extends string,
  TContext extends MachineContext,
  TEvent extends MachineEvent,
  R = never,
  E = never,
  TContextEncoded = unknown,
> = MachineConfigSchema<TId, TStateValue, TContext, TEvent, R, E, TContextEncoded>
  | MachineConfigPlain<TId, TStateValue, TContext, TEvent, R, E>;

/**
 * Type guard to check if a value is a Schema
 */
export function isSchema(value: unknown): value is Schema.Schema<unknown, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "_tag" in value &&
    (value as { _tag: unknown })._tag === "Schema"
  );
}

// ============================================================================
// Machine Definition (output of createMachine)
// ============================================================================

export interface MachineDefinition<
  TId extends string,
  TStateValue extends string,
  TContext extends MachineContext,
  TEvent extends MachineEvent,
  R = never,
  E = never,
  TContextEncoded = unknown,
> {
  readonly _tag: "MachineDefinition";
  readonly id: TId;
  readonly config: MachineConfigSchema<TId, TStateValue, TContext, TEvent, R, E, TContextEncoded>
    | MachineConfigPlain<TId, TStateValue, TContext, TEvent, R, E>;
  readonly initialSnapshot: MachineSnapshot<TStateValue, TContext>;
  /** Schema for context serialization (only present for Schema-based configs) */
  readonly contextSchema?: Schema.Schema<TContext, TContextEncoded>;
}

// ============================================================================
// Type-Erased Machine Reference (for parent-child composition)
// ============================================================================

/**
 * Type-erased machine definition that preserves only the R and E channels.
 *
 * This type is used for parent-child machine composition where:
 * - R (requirements) must be preserved for dependency injection
 * - E (errors) must be preserved for error handling
 * - TContext and TEvent are erased to avoid contravariance issues
 *
 * The internal context/event types don't matter to the parent - only
 * the child's service dependencies (R) and potential errors (E).
 */
export interface AnyMachineDefinition<R = unknown, E = unknown> {
  readonly _tag: "MachineDefinition";
  readonly id: string;
  readonly config: {
    readonly id: string;
    readonly initial: string;
    readonly states: Record<string, StateNodeConfig<string, MachineContext, MachineEvent, R, E>>;
    readonly context?: Schema.Schema.Any | MachineContext;
    readonly initialContext?: MachineContext;
  };
  readonly initialSnapshot: MachineSnapshot<string, MachineContext>;
  readonly contextSchema?: Schema.Schema.Any;
}

/**
 * Extract the R channel from a MachineDefinition type.
 */
export type MachineDefinitionR<T> = T extends MachineDefinition<
  string,
  string,
  MachineContext,
  MachineEvent,
  infer R,
  unknown,
  unknown
>
  ? R
  : T extends AnyMachineDefinition<infer R, unknown>
    ? R
    : never;

/**
 * Extract the E channel from a MachineDefinition type.
 */
export type MachineDefinitionE<T> = T extends MachineDefinition<
  string,
  string,
  MachineContext,
  MachineEvent,
  unknown,
  infer E,
  unknown
>
  ? E
  : T extends AnyMachineDefinition<unknown, infer E>
    ? E
    : never;

// ============================================================================
// Config R/E Inference Helpers
// ============================================================================

/**
 * Extract the R channel from an EffectAction.
 */
type _ExtractEffectActionR<T> = T extends EffectAction<MachineContext, MachineEvent, infer R, unknown>
  ? R
  : never;

/**
 * Extract the R channel from an array of actions.
 */
type ExtractActionsR<T> = T extends ReadonlyArray<infer TAction>
  ? TAction extends EffectAction<MachineContext, MachineEvent, infer R, unknown>
    ? R
    : never
  : never;

/**
 * Extract the R channel from an InvokeConfig.
 */
type ExtractInvokeR<T> = T extends InvokeConfig<string, MachineContext, MachineEvent, unknown, unknown, infer R>
  ? R
  : never;

/**
 * Extract the R channel from an ActivityConfig.
 */
type ExtractActivityR<T> = T extends ActivityConfig<MachineContext, MachineEvent, infer R, unknown>
  ? R
  : never;

/**
 * Extract the R channel from an array of activities.
 */
type ExtractActivitiesR<T> = T extends ReadonlyArray<infer TActivity>
  ? ExtractActivityR<TActivity>
  : never;

/**
 * Extract the R channel from a single StateNodeConfig.
 * Combines R from entry, exit, invoke, activities, and transitions.
 */
type ExtractStateNodeR<T> = T extends {
  entry?: infer TEntry;
  exit?: infer TExit;
  invoke?: infer TInvoke;
  activities?: infer TActivities;
  on?: infer TOn;
  after?: infer TAfter;
}
  ? ExtractActionsR<TEntry> |
    ExtractActionsR<TExit> |
    ExtractInvokeR<TInvoke> |
    ExtractActivitiesR<TActivities> |
    ExtractTransitionsR<TOn> |
    ExtractAfterR<TAfter>
  : never;

/**
 * Extract R from transition configs (the "on" handler).
 */
type ExtractTransitionsR<T> = T extends Record<string, infer TTransition>
  ? TTransition extends { actions?: infer TActions }
    ? ExtractActionsR<TActions>
    : never
  : never;

/**
 * Extract R from after configs.
 */
type ExtractAfterR<T> = T extends { transition?: { actions?: infer TActions } }
  ? ExtractActionsR<TActions>
  : T extends Record<number, { actions?: infer TActions }>
    ? ExtractActionsR<TActions>
    : never;

/**
 * Extract the R channel from all states in a machine config.
 * This is the union of R from all state nodes.
 */
export type ExtractStatesR<TStates> = TStates extends Record<string, infer TState>
  ? ExtractStateNodeR<TState>
  : never;

/**
 * Similar helpers for E channel extraction.
 */
type _ExtractEffectActionE<T> = T extends EffectAction<MachineContext, MachineEvent, unknown, infer E>
  ? E
  : never;

type ExtractActionsE<T> = T extends ReadonlyArray<infer TAction>
  ? TAction extends EffectAction<MachineContext, MachineEvent, unknown, infer E>
    ? E
    : never
  : never;

type ExtractActivityE<T> = T extends ActivityConfig<MachineContext, MachineEvent, unknown, infer E>
  ? E
  : never;

type ExtractActivitiesE<T> = T extends ReadonlyArray<infer TActivity>
  ? ExtractActivityE<TActivity>
  : never;

type ExtractStateNodeE<T> = T extends {
  entry?: infer TEntry;
  exit?: infer TExit;
  activities?: infer TActivities;
  on?: infer TOn;
  after?: infer TAfter;
}
  ? ExtractActionsE<TEntry> |
    ExtractActionsE<TExit> |
    ExtractActivitiesE<TActivities> |
    ExtractTransitionsE<TOn> |
    ExtractAfterE<TAfter>
  : never;

type ExtractTransitionsE<T> = T extends Record<string, infer TTransition>
  ? TTransition extends { actions?: infer TActions }
    ? ExtractActionsE<TActions>
    : never
  : never;

type ExtractAfterE<T> = T extends { transition?: { actions?: infer TActions } }
  ? ExtractActionsE<TActions>
  : T extends Record<number, { actions?: infer TActions }>
    ? ExtractActionsE<TActions>
    : never;

/**
 * Extract the E channel from all states in a machine config.
 */
export type ExtractStatesE<TStates> = TStates extends Record<string, infer TState>
  ? ExtractStateNodeE<TState>
  : never;
