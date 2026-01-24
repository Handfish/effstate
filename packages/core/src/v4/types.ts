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
export type MachineContext = object;

export type StateTag<S extends MachineState> = S["_tag"];
export type StateByTag<S extends MachineState, T extends S["_tag"]> = Extract<S, { _tag: T }>;
export type EventByTag<E extends MachineEvent, T extends E["_tag"]> = Extract<E, { _tag: T }>;

// ============================================================================
// Transition Results (clean return-object pattern)
// ============================================================================

/**
 * Fire-and-forget action executed during a transition.
 * Has closure access to ctx and event from the handler.
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
 *
 * @example
 * ```ts
 * Click: () => ({ goto: DoorState.Opening(new Date()) })
 * DoorTick: (ctx, event) => ({ update: { position: ctx.position + event.delta } })
 * PowerOff: () => null  // stay, do nothing
 * Log: (ctx) => ({ actions: [() => console.log(ctx.count)] })  // actions only
 * Submit: (ctx) => ({
 *   goto: State.Submitted(),
 *   actions: [() => analytics.track('submitted', ctx)]
 * })
 * ```
 */
export type EventHandler<S extends MachineState, C extends MachineContext, E extends MachineEvent> = (
  ctx: C,
  event: E,
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

/**
 * Helper to enforce exhaustive event handling.
 * Use this when you want compile-time errors for missing handlers.
 *
 * @example
 * ```ts
 * states: {
 *   Closed: {
 *     on: strict<DoorState, DoorContext, DoorEvent>({
 *       Click: () => ({ goto: DoorState.Opening() }),
 *       DoorTick: () => null,  // must handle all events
 *       PowerOn: () => null,
 *       PowerOff: () => null,
 *       // ... compiler error if any event missing
 *     }),
 *   },
 * }
 * ```
 */
export function strict<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
>(handlers: ExhaustiveEventHandlers<S, C, E>): EventHandlers<S, C, E> {
  return handlers;
}

// ============================================================================
// State Configuration (simplified - no R type for browser use)
// ============================================================================

interface StateConfigBase<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
  TStateTag extends S["_tag"],
> {
  /** Entry effect when entering this state */
  entry?: (state: StateByTag<S, TStateTag>, ctx: C) => Effect.Effect<void>;

  /** Exit effect when leaving this state */
  exit?: (state: StateByTag<S, TStateTag>, ctx: C) => Effect.Effect<void>;

  /** Continuous stream while in this state (e.g., animation ticks, async fetches)
   *  Can be a static stream or a function that receives snapshot for conditional behavior.
   *  For one-shot effects, use a function that returns Stream.fromEffect(...) conditionally. */
  run?: Stream.Stream<E> | ((snapshot: MachineSnapshot<S, C>) => Stream.Stream<E>);
}

/**
 * State configuration with optional strict mode.
 * - strict: false (default) - unhandled events stay in current state
 * - strict: true - ALL events must be explicitly handled (compile error if missing)
 *
 * @example
 * ```ts
 * states: {
 *   // Lenient: unhandled events stay
 *   Idle: {
 *     on: { Toggle: () => ({ goto: State.Running() }) }
 *   },
 *   // Strict: must handle ALL events
 *   Running: {
 *     strict: true,
 *     on: {
 *       Toggle: () => ({ goto: State.Idle() }),
 *       Tick: (ctx) => ({ update: { count: ctx.count + 1 } }),
 *       // Compiler error if any event missing!
 *     }
 *   },
 * }
 * ```
 */
export type StateConfig<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
  TStateTag extends S["_tag"],
> = StateConfigBase<S, C, E, TStateTag> & (
  | { strict?: false; on: EventHandlers<S, C, E> }
  | { strict: true; on: ExhaustiveEventHandlers<S, C, E> }
);

// ============================================================================
// Machine Configuration
// ============================================================================

export interface MachineConfig<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
> {
  readonly id: string;
  /** Optional schema for context validation/serialization. Must decode to type C. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly context?: Schema.Schema<C, any, never>;
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
> {
  readonly id: string;
  readonly config: MachineConfig<S, C, E>;
  /** Schema for context validation/serialization. Must decode to type C. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly contextSchema?: Schema.Schema<C, any, never>;
  readonly interpret: (options?: {
    snapshot?: MachineSnapshot<S, C>;
  }) => Effect.Effect<MachineActor<S, C, E>>;
}
