/**
 * EffState v4 - Core Types
 *
 * Lean, schema-first state machine types with:
 * - Full R (Requirements) channel support
 * - Honest error handling via callbacks
 * - Proper discriminated union handling
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

// ============================================================================
// Type Utilities
// ============================================================================

/** Extract state tag literal type */
export type StateTag<S extends MachineState> = S["_tag"];

/** Extract a specific state variant by tag */
export type StateByTag<S extends MachineState, K extends S["_tag"]> = Extract<S, { _tag: K }>;

/** Extract a specific event variant by tag */
export type EventByTag<E extends MachineEvent, K extends E["_tag"]> = Extract<E, { _tag: K }>;

// ============================================================================
// Transitions
// ============================================================================

/** Fire-and-forget action executed during a transition */
export type TransitionAction = () => void;

/**
 * Transition result:
 * - { goto: NewState } → transition to new state
 * - { goto: NewState, update: {} } → transition + update context
 * - { update: {} } → stay in current state, update context
 * - { actions: [...] } → stay, run actions only
 * - null → stay in current state (no changes)
 */
export type Transition<S extends MachineState, C extends MachineContext> =
  | { readonly goto: S; readonly update?: Partial<C>; readonly actions?: readonly TransitionAction[] }
  | { readonly update: Partial<C>; readonly actions?: readonly TransitionAction[] }
  | { readonly actions: readonly TransitionAction[] }
  | null;

// ============================================================================
// Event Handlers
// ============================================================================

/** Handler for a specific event type */
export type EventHandler<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
> = (ctx: C, event: E) => Transition<S, C>;

/** Object of handlers keyed by event tag (all optional) */
export type EventHandlers<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
> = {
  [K in E["_tag"]]?: EventHandler<S, C, EventByTag<E, K>>;
};

// ============================================================================
// State Configuration
// ============================================================================

/** Configuration for a single state */
export interface StateConfig<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
  R = never,
  Err = never,
> {
  /** Entry effect - runs when entering this state */
  readonly entry?: (snapshot: MachineSnapshot<S, C>) => Effect.Effect<void, Err, R>;

  /** Exit effect - runs when leaving this state */
  readonly exit?: (snapshot: MachineSnapshot<S, C>) => Effect.Effect<void, Err, R>;

  /** Run stream - produces events while in this state (auto-cancels on exit) */
  readonly run?:
    | Stream.Stream<E, Err, R>
    | ((snapshot: MachineSnapshot<S, C>) => Stream.Stream<E, Err, R>);

  /** Event handlers for this state */
  readonly on?: EventHandlers<S, C, E>;
}

// ============================================================================
// Machine Configuration
// ============================================================================

/** Full machine configuration */
export interface MachineConfig<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
  R = never,
  Err = never,
  CI = C,
> {
  /** Machine identifier */
  readonly id?: string;

  /**
   * Context schema for validation / serialization.
   *
   * `CI` is the schema's Encoded type; it defaults to `C` and is inferred from
   * the schema you pass, so a transforming schema (e.g. `Schema.DateFromString`,
   * where the in-memory type is `Date` and the encoded type is `string`) keeps
   * full encoded-type information for downstream codecs.
   */
  readonly context?: Schema.Schema<C, CI, never>;

  /** Initial context value */
  readonly initialContext: C;

  /** Initial state */
  readonly initialState: S;

  /** State configurations keyed by state tag */
  readonly states: {
    [K in S["_tag"]]?: StateConfig<S, C, E, R, Err>;
  };

  /** Global handlers (run in any state) */
  readonly global?: EventHandlers<S, C, E>;
}

// ============================================================================
// Machine Snapshot
// ============================================================================

/** Current machine state + context */
export interface MachineSnapshot<S extends MachineState, C extends MachineContext> {
  readonly state: S;
  readonly context: C;
}

// ============================================================================
// Machine Actor
// ============================================================================

/**
 * Runtime actor interface for a running machine.
 *
 * Methods are imperative for React integration.
 * The "purity" is in entry/exit/run effects which have full R and Err channels.
 */
export interface MachineActor<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
> {
  /** Send an event to the machine */
  readonly send: (event: E) => void;

  /** Get current snapshot */
  readonly getSnapshot: () => MachineSnapshot<S, C>;

  /** Subscribe to snapshot changes */
  readonly subscribe: (observer: (snapshot: MachineSnapshot<S, C>) => void) => () => void;

  /** Stop the actor and cleanup resources */
  readonly stop: () => void;

  /** Sync snapshot from external source (triggers exit/entry effects if state changes) */
  readonly _syncSnapshot: (snapshot: MachineSnapshot<S, C>) => void;
}

// ============================================================================
// Machine Definition
// ============================================================================

/** A defined machine that can be interpreted */
export interface MachineDefinition<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
  R = never,
  Err = never,
  CI = C,
> {
  /** Machine configuration (retains the context schema's encoded type `CI`) */
  readonly config: MachineConfig<S, C, E, R, Err, CI>;

  /**
   * Interpret the machine to create an actor.
   *
   * Returns Effect<MachineActor, never, R>:
   * - Requires R services to be provided
   * - Never fails (errors reported via onError callback)
   */
  readonly interpret: (options?: {
    snapshot?: MachineSnapshot<S, C>;
    onError?: (error: { effectType: "entry" | "exit" | "run"; stateTag: string; cause: Cause.Cause<Err> }) => void;
  }) => Effect.Effect<MachineActor<S, C, E>, never, R>;
}

// ============================================================================
// Type Extractors
// ============================================================================

/** Extract state type from a machine definition */
export type MachineStateType<T> = T extends MachineDefinition<infer S, any, any, any, any, any> ? S : never;

/** Extract context type from a machine definition */
export type MachineContextType<T> = T extends MachineDefinition<any, infer C, any, any, any, any> ? C : never;

/** Extract event type from a machine definition */
export type MachineEventType<T> = T extends MachineDefinition<any, any, infer E, any, any, any> ? E : never;

/** Extract requirements type from a machine definition */
export type MachineRequirements<T> = T extends MachineDefinition<any, any, any, infer R, any, any> ? R : never;

/** Extract error type from a machine definition */
export type MachineError<T> = T extends MachineDefinition<any, any, any, any, infer Err, any> ? Err : never;

/** Extract the context schema's encoded type from a machine definition */
export type MachineContextEncoded<T> = T extends MachineDefinition<any, any, any, any, any, infer CI> ? CI : never;
