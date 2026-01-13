/**
 * EffState v3 Core Types
 *
 * Simplified API with same type safety guarantees:
 * - Object-based handlers (no Match boilerplate)
 * - Implicit stay for unhandled events
 * - Discriminated union states preserved
 * - Effect/Stream integration for async operations
 */

import type { Effect, Schema, Stream } from "effect";

// ============================================================================
// Core Types (same as v2)
// ============================================================================

export type MachineState = { readonly _tag: string };
export type MachineEvent = { readonly _tag: string };
export type MachineContext = Record<string, unknown>;

export type StateTag<S extends MachineState> = S["_tag"];
export type StateByTag<S extends MachineState, T extends S["_tag"]> = Extract<S, { _tag: T }>;
export type EventByTag<E extends MachineEvent, T extends E["_tag"]> = Extract<E, { _tag: T }>;

// ============================================================================
// Transition Results (simplified - no complex builder chains)
// ============================================================================

export type Transition<S extends MachineState, C extends MachineContext> =
  | { readonly type: "goto"; readonly state: S; readonly updates?: Partial<C> }
  | { readonly type: "update"; readonly updates: Partial<C> }
  | { readonly type: "stay" }
  | null; // null = stay shorthand

// ============================================================================
// Transition Builders (simplified)
// ============================================================================

export interface TransitionBuilders<S extends MachineState, C extends MachineContext> {
  goto: (state: S, updates?: Partial<C>) => Transition<S, C>;
  update: (updates: Partial<C>) => Transition<S, C>;
  stay: Transition<S, C>;
}

export function createBuilders<S extends MachineState, C extends MachineContext>(): TransitionBuilders<S, C> {
  return {
    goto: (state, updates) => ({ type: "goto", state, updates }),
    update: (updates) => ({ type: "update", updates }),
    stay: { type: "stay" },
  };
}

// ============================================================================
// Event Handlers (the key simplification!)
// ============================================================================

/**
 * Handler for a single event type
 */
export type EventHandler<S extends MachineState, C extends MachineContext, E extends MachineEvent> = (
  ctx: C,
  event: E,
  builders: TransitionBuilders<S, C>
) => Transition<S, C>;

/**
 * Object mapping event tags to handlers.
 * Partial = unhandled events stay. Full = exhaustive.
 */
export type EventHandlers<S extends MachineState, C extends MachineContext, E extends MachineEvent> = {
  [K in E["_tag"]]?: EventHandler<S, C, EventByTag<E, K>>;
};

/**
 * Exhaustive handlers - requires ALL event types handled
 */
export type ExhaustiveEventHandlers<S extends MachineState, C extends MachineContext, E extends MachineEvent> = {
  [K in E["_tag"]]: EventHandler<S, C, EventByTag<E, K>>;
};

// ============================================================================
// State Configuration (simplified - no R type for browser use)
// ============================================================================

export interface StateConfig<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
  TStateTag extends S["_tag"],
> {
  /** Entry effect when entering this state */
  entry?: (state: StateByTag<S, TStateTag>, ctx: C) => Effect.Effect<void>;

  /** Exit effect when leaving this state */
  exit?: (state: StateByTag<S, TStateTag>, ctx: C) => Effect.Effect<void>;

  /** Continuous stream while in this state (e.g., animation ticks) */
  run?: Stream.Stream<E>;

  /** One-shot effect that returns a transition */
  invoke?: Effect.Effect<Transition<S, C>>;

  /** Event handlers - object map, unhandled = stay */
  on: EventHandlers<S, C, E>;
}

// ============================================================================
// Machine Configuration
// ============================================================================

export interface MachineConfig<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
  TContextSchema extends Schema.Schema.Any,
> {
  readonly id: string;
  readonly context: TContextSchema;
  readonly initialContext: C;
  readonly initialState: S;

  /** Global handlers - run before state handlers, return null to pass through */
  readonly global?: EventHandlers<S, C, E>;

  /** State configurations */
  readonly states: {
    [K in S["_tag"]]: StateConfig<S, C, E, K>;
  };
}

// ============================================================================
// Machine Definition & Actor
// ============================================================================

export interface MachineSnapshot<S extends MachineState, C extends MachineContext> {
  readonly state: S;
  readonly context: C;
}

export interface MachineActor<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
> {
  readonly send: (event: E) => void;
  readonly getSnapshot: () => MachineSnapshot<S, C>;
  readonly subscribe: (observer: (snapshot: MachineSnapshot<S, C>) => void) => () => void;
  readonly stop: () => void;
  readonly _syncSnapshot: (snapshot: MachineSnapshot<S, C>) => void;
}

export interface MachineDefinition<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
  TContextSchema extends Schema.Schema.Any,
> {
  readonly id: string;
  readonly config: MachineConfig<S, C, E, TContextSchema>;
  readonly contextSchema: TContextSchema;
  readonly interpret: (options?: {
    snapshot?: MachineSnapshot<S, C>;
  }) => Effect.Effect<MachineActor<S, C, E>>;
}
