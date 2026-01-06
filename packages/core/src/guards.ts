import type { Guard, MachineContext, MachineEvent } from "./types.js";

// ============================================================================
// Guard Creators
// ============================================================================

/**
 * Create a guard condition (identity function for type inference).
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
): Guard<TContext, TEvent> {
  return fn;
}

/**
 * Combine multiple guards with AND logic
 */
export function and<
  TContext extends MachineContext,
  TEvent extends MachineEvent,
>(
  ...guards: ReadonlyArray<Guard<TContext, TEvent>>
): Guard<TContext, TEvent> {
  return (params) => guards.every((g) => g(params));
}

/**
 * Combine multiple guards with OR logic
 */
export function or<
  TContext extends MachineContext,
  TEvent extends MachineEvent,
>(
  ...guards: ReadonlyArray<Guard<TContext, TEvent>>
): Guard<TContext, TEvent> {
  return (params) => guards.some((g) => g(params));
}

/**
 * Negate a guard
 */
export function not<
  TContext extends MachineContext,
  TEvent extends MachineEvent,
>(g: Guard<TContext, TEvent>): Guard<TContext, TEvent> {
  return (params) => !g(params);
}
