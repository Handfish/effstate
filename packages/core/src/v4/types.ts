/**
 * EffState v4 Core Types
 *
 * PhD-level type safety:
 * - Full R (Requirements) channel support
 * - Honest Err (Error) channel - errors typed but handled via callback
 * - Proper discriminated union handling
 * - Effect/Stream integration with dependency injection
 */

import type { Cause, Effect, Schema, Stream } from "effect";

// ============================================================================
// Core Types
// ============================================================================

/** Base state shape - must have readonly _tag */
export type MachineState = { readonly _tag: string };

/** Base event shape - must have readonly _tag */
export type MachineEvent = { readonly _tag: string };

/** Base context shape */
export type MachineContext = object;

/** Extract the tag type from a state */
export type StateTag<S extends MachineState> = S["_tag"];

/** Extract a specific state variant by tag */
export type StateByTag<S extends MachineState, T extends S["_tag"]> = Extract<S, { _tag: T }>;

/** Extract a specific event variant by tag */
export type EventByTag<E extends MachineEvent, T extends E["_tag"]> = Extract<E, { _tag: T }>;

// ============================================================================
// Transition Results
// ============================================================================

/**
 * Fire-and-forget action executed during a transition.
 * Has closure access to ctx and event from the handler.
 *
 * Design decision: Why `() => void` instead of `Effect<void, Err, R>`?
 *
 * Actions are intentionally simple synchronous side effects for:
 * - Logging: `() => console.log("transitioned")`
 * - External refs: `() => externalRef.current = value`
 * - Analytics: `() => track("event")`
 *
 * For effectful operations that need:
 * - Dependencies (R channel) → use entry/exit effects
 * - Error handling (Err channel) → use entry/exit effects
 * - Async operations → use run streams
 *
 * This is a "functional core, imperative shell" boundary. The core
 * (state transitions, handlers) is pure. Actions are the escape hatch
 * for synchronous side effects at the edge.
 *
 * A fully pure alternative would be:
 * ```typescript
 * type TransitionAction<R, Err> = Effect.Effect<void, Err, R>
 * ```
 * But this adds significant complexity to the API with minimal benefit,
 * since entry/exit/run already provide full Effect support.
 */
export type TransitionAction = () => void;

/**
 * Transition result - return what you want to happen:
 * - { goto: NewState }              → transition to new state
 * - { goto: NewState, update: {} }  → transition + update context
 * - { update: {} }                  → stay in current state, update context
 * - { actions: [...] }              → stay, run actions only
 * - null                            → stay in current state (no changes)
 *
 * All variants can include `actions: [() => void]` for fire-and-forget effects.
 */
export type Transition<S extends MachineState, C extends MachineContext> =
  | { readonly goto: S; readonly update?: Partial<C>; readonly actions?: readonly TransitionAction[] }
  | { readonly update: Partial<C>; readonly actions?: readonly TransitionAction[] }
  | { readonly actions: readonly TransitionAction[] }
  | null;

// ============================================================================
// Event Handlers
// ============================================================================

/**
 * Handler for a single event type.
 * Return what you want to happen - no builder functions needed.
 */
export type EventHandler<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent
> = (ctx: C, event: E) => Transition<S, C>;

/**
 * Object mapping event tags to handlers.
 * Partial = unhandled events stay in current state.
 */
export type EventHandlers<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent
> = {
  [K in E["_tag"]]?: EventHandler<S, C, EventByTag<E, K>>;
};

/**
 * Exhaustive handlers - requires ALL event types handled
 */
export type ExhaustiveEventHandlers<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent
> = {
  [K in E["_tag"]]: EventHandler<S, C, EventByTag<E, K>>;
};

/**
 * Helper to enforce exhaustive event handling.
 * Use this when you want compile-time errors for missing handlers.
 */
export function strict<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
>(handlers: ExhaustiveEventHandlers<S, C, E>): EventHandlers<S, C, E> {
  return handlers;
}

// ============================================================================
// State Configuration (with R and Err channels)
// ============================================================================

/**
 * State configuration base with full Effect type parameters.
 *
 * @typeParam S - State discriminated union
 * @typeParam C - Context type
 * @typeParam E - Event discriminated union
 * @typeParam TStateTag - The specific state tag this config is for
 * @typeParam R - Requirements (Effect context/services)
 * @typeParam Err - Error type for effects (honestly typed, handled via callback)
 */
interface StateConfigBase<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
  TStateTag extends S["_tag"],
  R,
  Err,
> {
  /**
   * Entry effect when entering this state.
   * Can require services via R channel.
   * Errors are reported via onError callback, not thrown.
   */
  entry?: (state: StateByTag<S, TStateTag>, ctx: C) => Effect.Effect<void, Err, R>;

  /**
   * Exit effect when leaving this state.
   * Can require services via R channel.
   * Errors are reported via onError callback, not thrown.
   */
  exit?: (state: StateByTag<S, TStateTag>, ctx: C) => Effect.Effect<void, Err, R>;

  /**
   * Continuous stream while in this state (e.g., animation ticks, async fetches).
   * Can be a static stream or a function that receives snapshot for conditional behavior.
   * Can require services via R channel.
   * Errors are reported via onError callback.
   */
  run?: Stream.Stream<E, Err, R> | ((snapshot: MachineSnapshot<S, C>) => Stream.Stream<E, Err, R>);
}

/**
 * State configuration with optional strict mode.
 * - strict: false (default) - unhandled events stay in current state
 * - strict: true - ALL events must be explicitly handled (compile error if missing)
 */
export type StateConfig<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
  TStateTag extends S["_tag"],
  R = never,
  Err = never,
> = StateConfigBase<S, C, E, TStateTag, R, Err> & (
  | { strict?: false; on: EventHandlers<S, C, E> }
  | { strict: true; on: ExhaustiveEventHandlers<S, C, E> }
);

// ============================================================================
// Machine Configuration
// ============================================================================

/**
 * Machine configuration with full type parameters.
 *
 * @typeParam S - State discriminated union
 * @typeParam C - Context type
 * @typeParam E - Event discriminated union
 * @typeParam R - Requirements (Effect context/services needed by entry/exit/run)
 * @typeParam Err - Error type for entry/exit/run effects
 */
export interface MachineConfig<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
  R = never,
  Err = never,
> {
  readonly id: string;

  /**
   * Optional schema for context validation/serialization.
   */
  readonly context?: Schema.Schema<C>;

  readonly initialContext: C;
  readonly initialState: S;

  /** Global handlers - run before state handlers, return null to pass through */
  readonly global?: EventHandlers<S, C, E>;

  /** State configurations */
  readonly states: {
    [K in S["_tag"]]: StateConfig<S, C, E, K, R, Err>;
  };
}

// ============================================================================
// Machine Snapshot
// ============================================================================

export interface MachineSnapshot<S extends MachineState, C extends MachineContext> {
  readonly state: S;
  readonly context: C;
}

// ============================================================================
// Machine Actor
// ============================================================================

/**
 * The runtime actor interface for interacting with a running machine.
 *
 * Design decision: Why are methods like `send` returning `void` instead of `Effect`?
 *
 * This is an intentional "functional core, imperative shell" design:
 *
 * 1. **interpret** returns `Effect<MachineActor, never, R>` - the creation is effectful,
 *    requiring services from R to be provided.
 *
 * 2. **MachineActor methods** are imperative - they're designed for integration with
 *    React, callbacks, and other imperative UI frameworks where running Effects on
 *    every interaction adds friction.
 *
 * A fully pure alternative would be:
 * ```typescript
 * interface PureMachineActor<S, C, E> {
 *   send: (event: E) => Effect<void, never, never>;
 *   getSnapshot: Effect<Snapshot, never, never>;
 *   stop: Effect<void, never, never>;
 * }
 * ```
 *
 * We chose the imperative interface because:
 * - React integration: `onClick={() => actor.send(event)}` is cleaner than Effect.runSync
 * - The interesting effects (entry/exit/run) are already properly managed
 * - Send is synchronous state update - no R or Err to track
 * - Matches XState, Zustand, and other state management conventions
 *
 * The "purity" is preserved where it matters: entry/exit/run effects have full
 * R and Err channels. The actor interface is just the imperative boundary.
 */
export interface MachineActor<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
> {
  /** Send an event to the machine (synchronous state update) */
  readonly send: (event: E) => void;

  /** Get current snapshot (synchronous read) */
  readonly getSnapshot: () => MachineSnapshot<S, C>;

  /** Subscribe to snapshot changes (callback-based for React compatibility) */
  readonly subscribe: (observer: (snapshot: MachineSnapshot<S, C>) => void) => () => void;

  /** Stop the actor and cleanup resources */
  readonly stop: () => void;

  /**
   * Sync snapshot from external source (e.g., Convex).
   * Triggers exit/entry effects if state changes.
   */
  readonly _syncSnapshot: (snapshot: MachineSnapshot<S, C>) => void;
}

// ============================================================================
// Machine Definition
// ============================================================================

/**
 * Machine definition with full type parameters.
 *
 * @typeParam S - State discriminated union
 * @typeParam C - Context type
 * @typeParam E - Event discriminated union
 * @typeParam R - Requirements for entry/exit/run effects
 * @typeParam Err - Error type for entry/exit/run effects (handled via callback)
 */
export interface MachineDefinition<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
  R = never,
  Err = never,
> {
  readonly id: string;
  readonly config: MachineConfig<S, C, E, R, Err>;

  /** Schema for context validation/serialization */
  readonly contextSchema?: Schema.Schema<C>;

  /**
   * Create an actor from this machine.
   *
   * Returns an Effect that:
   * - Requires R (services needed by entry/exit/run)
   * - Never fails (errors are handled via onError callback)
   * - Produces a MachineActor
   *
   * This is the honest approach: the Effect itself doesn't fail,
   * but entry/exit/run effects can fail and those errors are
   * reported via the onError callback in interpret options.
   */
  readonly interpret: (options?: {
    snapshot?: MachineSnapshot<S, C>;
    onError?: (error: { effectType: "entry" | "exit" | "run"; stateTag: string; cause: Cause.Cause<Err> }) => void;
  }) => Effect.Effect<MachineActor<S, C, E>, never, R>;
}

// ============================================================================
// Type-level utilities for advanced usage
// ============================================================================

/**
 * Extract the state type from a machine definition.
 */
export type MachineStateType<T> = T extends MachineDefinition<infer S, infer _C, infer _E, infer _R, infer _Err>
  ? S
  : never;

/**
 * Extract the context type from a machine definition.
 */
export type MachineContextType<T> = T extends MachineDefinition<infer _S, infer C, infer _E, infer _R, infer _Err>
  ? C
  : never;

/**
 * Extract the event type from a machine definition.
 */
export type MachineEventType<T> = T extends MachineDefinition<infer _S, infer _C, infer E, infer _R, infer _Err>
  ? E
  : never;

/**
 * Extract the requirements type from a machine definition.
 */
export type MachineRequirements<T> = T extends MachineDefinition<infer _S, infer _C, infer _E, infer R, infer _Err>
  ? R
  : never;

/**
 * Extract the error type from a machine definition.
 */
export type MachineError<T> = T extends MachineDefinition<infer _S, infer _C, infer _E, infer _R, infer Err>
  ? Err
  : never;
