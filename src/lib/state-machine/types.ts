import type { Duration, Effect } from "effect";

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
 * Sync action that can modify context
 */
export interface AssignAction<
  TContext extends MachineContext,
  TEvent extends MachineEvent,
> {
  readonly _tag: "assign";
  readonly fn: (params: { context: TContext; event: TEvent }) => Partial<TContext>;
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

export type Action<
  TContext extends MachineContext,
  TEvent extends MachineEvent,
  R = never,
  E = never,
> =
  | AssignAction<TContext, TEvent>
  | EffectAction<TContext, TEvent, R, E>
  | RaiseAction<TEvent>
  | CancelAction<TContext, TEvent>;

// ============================================================================
// Guard Types
// ============================================================================

/**
 * Sync guard condition
 */
export interface SyncGuard<
  TContext extends MachineContext,
  TEvent extends MachineEvent,
> {
  readonly _tag: "sync";
  readonly fn: (params: { context: TContext; event: TEvent }) => boolean;
}

/**
 * Effect guard for async conditions
 */
export interface EffectGuard<
  TContext extends MachineContext,
  TEvent extends MachineEvent,
  R = never,
  E = never,
> {
  readonly _tag: "effect";
  readonly fn: (params: { context: TContext; event: TEvent }) => Effect.Effect<boolean, E, R>;
}

export type Guard<
  TContext extends MachineContext,
  TEvent extends MachineEvent,
  R = never,
  E = never,
> = SyncGuard<TContext, TEvent> | EffectGuard<TContext, TEvent, R, E>;

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
  readonly guard?: Guard<TContext, TEvent, R, E>;
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
  readonly guard?: Guard<TContext, EventByTag<TEvent, TEventTag>, R, E>;
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
  /** After delay, auto-transition */
  readonly after?: {
    readonly [delay: number]: TransitionConfig<TStateValue, TContext, TEvent, R, E>;
  } | {
    readonly delay: Duration.DurationInput;
    readonly transition: TransitionConfig<TStateValue, TContext, TEvent, R, E>;
  };
}

// ============================================================================
// Machine Config
// ============================================================================

export interface MachineConfig<
  TId extends string,
  TStateValue extends string,
  TContext extends MachineContext,
  TEvent extends MachineEvent,
  R = never,
  E = never,
> {
  readonly id: TId;
  readonly initial: TStateValue;
  readonly context: TContext;
  readonly states: {
    readonly [K in TStateValue]: StateNodeConfig<TStateValue, TContext, TEvent, R, E>;
  };
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
> {
  readonly _tag: "MachineDefinition";
  readonly id: TId;
  readonly config: MachineConfig<TId, TStateValue, TContext, TEvent, R, E>;
  readonly initialSnapshot: MachineSnapshot<TStateValue, TContext>;
}
