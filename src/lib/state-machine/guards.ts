import type { Effect } from "effect";
import type { EffectGuard, Guard, MachineContext, MachineEvent, SyncGuard } from "./types.js";

// ============================================================================
// Guard Creators
// ============================================================================

/**
 * Create a sync guard condition
 *
 * @example
 * ```ts
 * guard(({ context }) => context.count < 10)
 * ```
 */
export function guard<
  TContext extends MachineContext,
  TEvent extends MachineEvent = MachineEvent,
>(
  fn: (params: { context: TContext; event: TEvent }) => boolean,
): SyncGuard<TContext, TEvent> {
  return {
    _tag: "sync",
    fn,
  };
}

/**
 * Create an async guard using Effect
 *
 * @example
 * ```ts
 * guardEffect(({ context }) =>
 *   Effect.gen(function* () {
 *     const allowed = yield* checkPermission(context.userId)
 *     return allowed
 *   })
 * )
 * ```
 */
export function guardEffect<
  TContext extends MachineContext,
  TEvent extends MachineEvent = MachineEvent,
  R = never,
  E = never,
>(
  fn: (params: { context: TContext; event: TEvent }) => Effect.Effect<boolean, E, R>,
): EffectGuard<TContext, TEvent, R, E> {
  return {
    _tag: "effect",
    fn,
  };
}

/**
 * Combine multiple guards with AND logic
 */
export function and<
  TContext extends MachineContext,
  TEvent extends MachineEvent,
>(
  ...guards: ReadonlyArray<SyncGuard<TContext, TEvent>>
): SyncGuard<TContext, TEvent> {
  return {
    _tag: "sync",
    fn: (params) => guards.every((g) => g.fn(params)),
  };
}

/**
 * Combine multiple guards with OR logic
 */
export function or<
  TContext extends MachineContext,
  TEvent extends MachineEvent,
>(
  ...guards: ReadonlyArray<SyncGuard<TContext, TEvent>>
): SyncGuard<TContext, TEvent> {
  return {
    _tag: "sync",
    fn: (params) => guards.some((g) => g.fn(params)),
  };
}

/**
 * Negate a guard
 */
export function not<
  TContext extends MachineContext,
  TEvent extends MachineEvent,
>(guard: SyncGuard<TContext, TEvent>): SyncGuard<TContext, TEvent> {
  return {
    _tag: "sync",
    fn: (params) => !guard.fn(params),
  };
}

// ============================================================================
// Type Helpers
// ============================================================================

export type GuardFrom<T> = T extends Guard<infer C, infer E, infer R, infer Err>
  ? Guard<C, E, R, Err>
  : never;
