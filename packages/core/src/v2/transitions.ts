/**
 * EffState v2 Transition Builders
 *
 * Fluent API for creating state transitions:
 * - `goto(state)` - transition to a new state
 * - `update(partial)` - update context without changing state
 * - `stay` - no state or context change
 *
 * All transitions support chaining:
 * ```ts
 * goto(State.Open({ openedAt: new Date() }))
 *   .update({ count: ctx.count + 1 })
 *   .effect(Effect.log("opened"))
 *   .spawn("child")
 *   .send("child", new ChildEvent())
 * ```
 */

import type { Effect } from "effect";
import type {
  MachineState,
  MachineContext,
  MachineEvent,
  GotoTransition,
  UpdateTransition,
  StayTransition,
  SpawnAction,
  SendAction,
  GotoBuilder,
  UpdateBuilder,
  StayBuilder,
  ChildrenConfig,
  TransitionBuilders,
  ChildEventType,
} from "./types.js";

// ============================================================================
// Internal: Create transition with fluent methods
// ============================================================================

/**
 * Add fluent methods to a transition object
 */
function withFluentMethods<
  T extends GotoTransition<any, any, any> | UpdateTransition<any, any> | StayTransition<any>,
>(transition: T): T {
  const self = transition as T & FluentMethods;

  self.update = (partial: Partial<any>) => {
    if (transition._tag === "Stay") {
      // Convert Stay to Update when .update() is called
      return withFluentMethods({
        _tag: "Update",
        updates: partial,
        effects: transition.effects,
        emissions: transition.emissions,
        spawns: transition.spawns,
        despawns: transition.despawns,
        sends: transition.sends,
      } as UpdateTransition<any, any>) as any;
    }

    const updated = {
      ...transition,
      updates: transition.updates
        ? { ...transition.updates, ...partial }
        : partial,
    };
    return withFluentMethods(updated) as any;
  };

  self.effect = <R2>(eff: Effect.Effect<void, never, R2>) => {
    const updated = {
      ...transition,
      effects: [...transition.effects, eff],
    };
    return withFluentMethods(updated) as any;
  };

  self.emit = (event: MachineEvent) => {
    const updated = {
      ...transition,
      emissions: [...transition.emissions, event],
    };
    return withFluentMethods(updated) as any;
  };

  self.spawn = (childId: string, options?: { restoreSnapshot?: boolean }) => {
    const action: SpawnAction = { childId, options };
    const updated = {
      ...transition,
      spawns: [...transition.spawns, action],
    };
    return withFluentMethods(updated) as any;
  };

  self.despawn = (childId: string) => {
    const updated = {
      ...transition,
      despawns: [...transition.despawns, childId],
    };
    return withFluentMethods(updated) as any;
  };

  self.send = (childId: string, event: MachineEvent) => {
    const action: SendAction = { childId, event };
    const updated = {
      ...transition,
      sends: [...transition.sends, action],
    };
    return withFluentMethods(updated) as any;
  };

  return self;
}

/**
 * Fluent methods interface (for internal typing)
 */
interface FluentMethods {
  update(partial: Partial<any>): any;
  effect<R2>(eff: Effect.Effect<void, never, R2>): any;
  emit(event: MachineEvent): any;
  spawn(childId: string, options?: { restoreSnapshot?: boolean }): any;
  despawn(childId: string): any;
  send(childId: string, event: MachineEvent): any;
}

// ============================================================================
// Goto Builder
// ============================================================================

/**
 * Create a goto transition to a new state.
 *
 * @example
 * ```ts
 * // Simple transition
 * goto(State.Open({ openedAt: new Date() }))
 *
 * // With context update
 * goto(State.Open({ openedAt: new Date() }))
 *   .update({ position: 100 })
 *
 * // With effects and child management
 * goto(State.Active({ activatedAt: new Date() }))
 *   .update({ isPowered: true })
 *   .spawn("garage")
 *   .send("garage", new PowerOn())
 *   .effect(Effect.log("Activated"))
 * ```
 */
export function goto<S extends MachineState>(state: S): GotoBuilder<S, any, any, any, never> {
  const transition: GotoTransition<S, any, never> = {
    _tag: "Goto",
    state,
    updates: null,
    effects: [],
    emissions: [],
    spawns: [],
    despawns: [],
    sends: [],
  };

  return withFluentMethods(transition) as GotoBuilder<S, any, any, any, never>;
}

// ============================================================================
// Update Builder
// ============================================================================

/**
 * Create an update transition (stay in current state, update context).
 *
 * @example
 * ```ts
 * // Simple update
 * update({ count: ctx.count + 1 })
 *
 * // With effects
 * update({ position: ctx.position + delta })
 *   .effect(Effect.log(`Position: ${ctx.position + delta}`))
 *
 * // Multiple updates (merged)
 * update({ count: 1 })
 *   .update({ name: "test" })
 * ```
 */
export function update<C extends MachineContext>(
  partial: Partial<C>
): UpdateBuilder<any, C, any, any, never> {
  const transition: UpdateTransition<C, never> = {
    _tag: "Update",
    updates: partial,
    effects: [],
    emissions: [],
    spawns: [],
    despawns: [],
    sends: [],
  };

  return withFluentMethods(transition) as UpdateBuilder<any, C, any, any, never>;
}

// ============================================================================
// Stay Builder
// ============================================================================

/**
 * Create a stay transition (no state change, no context change).
 * Can still run effects, spawn children, etc.
 *
 * @example
 * ```ts
 * // Simple stay (ignore event)
 * stay
 *
 * // Stay with logging
 * stay.effect(Effect.log("Event ignored"))
 *
 * // Stay but spawn a child
 * stay.spawn("worker")
 * ```
 */
function createStay(): StayBuilder<any, any, any, any, never> {
  const transition: StayTransition<never> = {
    _tag: "Stay",
    effects: [],
    emissions: [],
    spawns: [],
    despawns: [],
    sends: [],
  };

  return withFluentMethods(transition) as StayBuilder<any, any, any, any, never>;
}

/**
 * Stay transition constant.
 * Use `stay` directly or chain methods: `stay.effect(...)`
 */
export const stay: StayBuilder<any, any, any, any, never> = createStay();

// ============================================================================
// Typed Builders Factory
// ============================================================================

/**
 * Create typed transition builders for use inside state handlers.
 * This is called internally by the machine to provide properly-typed builders.
 */
export function createTransitionBuilders<
  S extends MachineState,
  C extends MachineContext,
  TChildren extends ChildrenConfig,
  TEmits extends MachineEvent,
>(): TransitionBuilders<S, C, TChildren, TEmits> {
  return {
    goto: <TargetState extends S>(state: TargetState) =>
      goto(state) as unknown as GotoBuilder<S, C, TChildren, TEmits>,
    update: (partial: Partial<C>) =>
      update(partial) as unknown as UpdateBuilder<S, C, TChildren, TEmits>,
    stay: stay as unknown as StayBuilder<S, C, TChildren, TEmits>,
  };
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a transition is a Goto
 */
export function isGoto<S extends MachineState, C extends MachineContext, R>(
  t: GotoTransition<S, C, R> | UpdateTransition<C, R> | StayTransition<R>
): t is GotoTransition<S, C, R> {
  return t._tag === "Goto";
}

/**
 * Check if a transition is an Update
 */
export function isUpdate<C extends MachineContext, R>(
  t: GotoTransition<any, C, R> | UpdateTransition<C, R> | StayTransition<R>
): t is UpdateTransition<C, R> {
  return t._tag === "Update";
}

/**
 * Check if a transition is a Stay
 */
export function isStay<R>(
  t: GotoTransition<any, any, R> | UpdateTransition<any, R> | StayTransition<R>
): t is StayTransition<R> {
  return t._tag === "Stay";
}
