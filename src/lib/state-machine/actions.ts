import type { Effect } from "effect";
import type {
  Action,
  AssignAction,
  EffectAction,
  MachineContext,
  MachineEvent,
  RaiseAction,
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
