/**
 * EffState v2 Core Types
 *
 * This module defines the foundational types for the v2 API:
 * - Discriminated union states (Rust-style enums with data)
 * - Type-safe transitions (goto, update, stay)
 * - Exhaustive event handling
 * - Parent-child relationships
 */

import type { Effect, Schema, Stream } from "effect";

// ============================================================================
// State Types
// ============================================================================

/**
 * A state in the machine - a tagged enum variant with optional data.
 * States carry their own data, like Rust enums.
 *
 * @example
 * ```ts
 * type MyState = Data.TaggedEnum<{
 *   Idle: {};
 *   Loading: { startedAt: Date };
 *   Success: { data: string; loadedAt: Date };
 *   Error: { error: string; retryCount: number };
 * }>;
 * ```
 */
export type MachineState = { readonly _tag: string };

/**
 * Extract the tag (state name) from a state type
 */
export type StateTag<S extends MachineState> = S["_tag"];

/**
 * Extract state data (everything except _tag)
 */
export type StateData<S extends MachineState> = Omit<S, "_tag">;

/**
 * Get a specific state variant by tag
 */
export type StateByTag<S extends MachineState, T extends S["_tag"]> = Extract<S, { _tag: T }>;

// ============================================================================
// Event Types
// ============================================================================

/**
 * A machine event - must have a _tag discriminator.
 * Use Data.TaggedClass for event definitions.
 *
 * @example
 * ```ts
 * class Click extends Data.TaggedClass("Click")<{}> {}
 * class Tick extends Data.TaggedClass("Tick")<{ delta: number }> {}
 * type MyEvent = Click | Tick;
 * ```
 */
export interface MachineEvent {
  readonly _tag: string;
}

/**
 * Extract event data (everything except _tag)
 */
export type EventData<E extends MachineEvent> = Omit<E, "_tag">;

/**
 * Get a specific event variant by tag
 */
export type EventByTag<E extends MachineEvent, T extends E["_tag"]> = Extract<E, { _tag: T }>;

// ============================================================================
// Context Types
// ============================================================================

/**
 * Machine context - shared data across all states.
 * Must be defined with an Effect Schema for serialization.
 */
export type MachineContext = Record<string, unknown>;

// ============================================================================
// Type Hints (similar to XState v5's types field)
// ============================================================================

/**
 * Type hints for machine configuration.
 * Use this to provide explicit type information.
 *
 * @example
 * ```ts
 * types: {} as {
 *   state: GarageDoorState;
 *   event: GarageDoorEvent;
 *   emits: WakeHamster;
 * }
 * ```
 */
export interface MachineTypes<
  S extends MachineState,
  E extends MachineEvent,
  TEmits extends MachineEvent = never,
> {
  state: S;
  event: E;
  emits?: TEmits;
}

// ============================================================================
// Transition Result Types
// ============================================================================

/**
 * Base interface for all transition results.
 * Used internally for type discrimination.
 */
interface TransitionBase {
  readonly _tag: string;
}

/**
 * Goto transition - move to a new state.
 *
 * @example
 * ```ts
 * goto(MyState.Loading({ startedAt: new Date() }))
 * goto(MyState.Idle({})).update({ count: 0 })
 * ```
 */
export interface GotoTransition<S extends MachineState, C extends MachineContext, R = never>
  extends TransitionBase {
  readonly _tag: "Goto";
  readonly state: S;
  readonly updates: Partial<C> | null;
  readonly effects: ReadonlyArray<Effect.Effect<void, never, R>>;
  readonly emissions: ReadonlyArray<MachineEvent>;
  readonly spawns: ReadonlyArray<SpawnAction>;
  readonly despawns: ReadonlyArray<string>;
  readonly sends: ReadonlyArray<SendAction>;
}

/**
 * Update transition - stay in current state, update context.
 *
 * @example
 * ```ts
 * update({ count: ctx.count + 1 })
 * update({ position: 50 }).effect(Effect.log("halfway"))
 * ```
 */
export interface UpdateTransition<C extends MachineContext, R = never> extends TransitionBase {
  readonly _tag: "Update";
  readonly updates: Partial<C>;
  readonly effects: ReadonlyArray<Effect.Effect<void, never, R>>;
  readonly emissions: ReadonlyArray<MachineEvent>;
  readonly spawns: ReadonlyArray<SpawnAction>;
  readonly despawns: ReadonlyArray<string>;
  readonly sends: ReadonlyArray<SendAction>;
}

/**
 * Stay transition - no state change, no context change.
 *
 * @example
 * ```ts
 * stay
 * stay.effect(Effect.log("ignored event"))
 * ```
 */
export interface StayTransition<R = never> extends TransitionBase {
  readonly _tag: "Stay";
  readonly effects: ReadonlyArray<Effect.Effect<void, never, R>>;
  readonly emissions: ReadonlyArray<MachineEvent>;
  readonly spawns: ReadonlyArray<SpawnAction>;
  readonly despawns: ReadonlyArray<string>;
  readonly sends: ReadonlyArray<SendAction>;
}

/**
 * Union of all transition types
 */
export type TransitionResult<
  S extends MachineState = MachineState,
  C extends MachineContext = MachineContext,
  R = never,
> = GotoTransition<S, C, R> | UpdateTransition<C, R> | StayTransition<R>;

// ============================================================================
// Child Action Types
// ============================================================================

/**
 * Action to spawn a child machine
 */
export interface SpawnAction {
  readonly childId: string;
  readonly options?: {
    readonly restoreSnapshot?: boolean;
  };
}

/**
 * Action to send an event to a child
 */
export interface SendAction {
  readonly childId: string;
  readonly event: MachineEvent;
}

// ============================================================================
// Fluent Builder Interface
// ============================================================================

/**
 * Methods available on all transition results for chaining.
 */
export interface TransitionMethods<
  S extends MachineState,
  C extends MachineContext,
  TChildren extends ChildrenConfig,
  TEmits extends MachineEvent,
  R = never,
> {
  /**
   * Update context (merged with any existing updates)
   */
  update(partial: Partial<C>): this;

  /**
   * Run a side effect
   */
  effect<R2>(eff: Effect.Effect<void, never, R2>): TransitionWithR<this, R | R2>;

  /**
   * Emit an event to the parent machine
   */
  emit(event: TEmits): this;

  /**
   * Spawn a child machine
   */
  spawn<K extends keyof TChildren & string>(
    childId: K,
    options?: { restoreSnapshot?: boolean }
  ): this;

  /**
   * Despawn (stop) a child machine
   */
  despawn<K extends keyof TChildren & string>(childId: K): this;

  /**
   * Send an event to a child machine
   */
  send<K extends keyof TChildren & string>(
    childId: K,
    event: ChildEventType<TChildren, K>
  ): this;
}

/**
 * Helper to add R to a transition type
 */
type TransitionWithR<T, R> = T extends GotoTransition<infer S, infer C, infer R1>
  ? GotoTransition<S, C, R | R1>
  : T extends UpdateTransition<infer C, infer R1>
    ? UpdateTransition<C, R | R1>
    : T extends StayTransition<infer R1>
      ? StayTransition<R | R1>
      : never;

// ============================================================================
// Transition Builder Interfaces
// ============================================================================

/**
 * Goto transition result with fluent methods
 */
export interface GotoBuilder<
  S extends MachineState,
  C extends MachineContext,
  TChildren extends ChildrenConfig,
  TEmits extends MachineEvent,
  R = never,
> extends GotoTransition<S, C, R> {
  update(partial: Partial<C>): GotoBuilder<S, C, TChildren, TEmits, R>;
  effect<R2>(eff: Effect.Effect<void, never, R2>): GotoBuilder<S, C, TChildren, TEmits, R | R2>;
  emit(event: TEmits): GotoBuilder<S, C, TChildren, TEmits, R>;
  spawn<K extends keyof TChildren & string>(childId: K, options?: { restoreSnapshot?: boolean }): GotoBuilder<S, C, TChildren, TEmits, R>;
  despawn<K extends keyof TChildren & string>(childId: K): GotoBuilder<S, C, TChildren, TEmits, R>;
  send<K extends keyof TChildren & string>(childId: K, event: ChildEventType<TChildren, K>): GotoBuilder<S, C, TChildren, TEmits, R>;
}

/**
 * Update transition result with fluent methods
 */
export interface UpdateBuilder<
  S extends MachineState,
  C extends MachineContext,
  TChildren extends ChildrenConfig,
  TEmits extends MachineEvent,
  R = never,
> extends UpdateTransition<C, R> {
  update(partial: Partial<C>): UpdateBuilder<S, C, TChildren, TEmits, R>;
  effect<R2>(eff: Effect.Effect<void, never, R2>): UpdateBuilder<S, C, TChildren, TEmits, R | R2>;
  emit(event: TEmits): UpdateBuilder<S, C, TChildren, TEmits, R>;
  spawn<K extends keyof TChildren & string>(childId: K, options?: { restoreSnapshot?: boolean }): UpdateBuilder<S, C, TChildren, TEmits, R>;
  despawn<K extends keyof TChildren & string>(childId: K): UpdateBuilder<S, C, TChildren, TEmits, R>;
  send<K extends keyof TChildren & string>(childId: K, event: ChildEventType<TChildren, K>): UpdateBuilder<S, C, TChildren, TEmits, R>;
}

/**
 * Stay transition result with fluent methods
 */
export interface StayBuilder<
  S extends MachineState,
  C extends MachineContext,
  TChildren extends ChildrenConfig,
  TEmits extends MachineEvent,
  R = never,
> extends StayTransition<R> {
  update(partial: Partial<C>): UpdateBuilder<S, C, TChildren, TEmits, R>;
  effect<R2>(eff: Effect.Effect<void, never, R2>): StayBuilder<S, C, TChildren, TEmits, R | R2>;
  emit(event: TEmits): StayBuilder<S, C, TChildren, TEmits, R>;
  spawn<K extends keyof TChildren & string>(childId: K, options?: { restoreSnapshot?: boolean }): StayBuilder<S, C, TChildren, TEmits, R>;
  despawn<K extends keyof TChildren & string>(childId: K): StayBuilder<S, C, TChildren, TEmits, R>;
  send<K extends keyof TChildren & string>(childId: K, event: ChildEventType<TChildren, K>): StayBuilder<S, C, TChildren, TEmits, R>;
}

// ============================================================================
// State Handler Types
// ============================================================================

/**
 * Transition builders passed to state handlers, pre-typed for the machine.
 */
export interface TransitionBuilders<
  S extends MachineState,
  C extends MachineContext,
  TChildren extends ChildrenConfig,
  TEmits extends MachineEvent,
> {
  /**
   * Transition to a new state
   */
  goto<TargetState extends S>(state: TargetState): GotoBuilder<S, C, TChildren, TEmits>;

  /**
   * Update context without changing state
   */
  update(partial: Partial<C>): UpdateBuilder<S, C, TChildren, TEmits>;

  /**
   * Stay in current state (no changes)
   */
  readonly stay: StayBuilder<S, C, TChildren, TEmits>;
}

/**
 * Handler function for a single state.
 * Receives context, state data, and typed transition builders.
 *
 * @example
 * ```ts
 * Opening: {
 *   on: (ctx, { startedAt }, { goto, update, stay }) => (event) =>
 *     Match.value(event).pipe(
 *       Match.tag("Click", () => goto(State.Paused({ ... }))),
 *       Match.tag("Tick", ({ delta }) => update({ position: ctx.position + delta })),
 *       Match.exhaustive,
 *     ),
 * }
 * ```
 */
export type StateEventHandler<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
  TStateTag extends S["_tag"],
  TChildren extends ChildrenConfig,
  TEmits extends MachineEvent,
  R = never,
> = (
  ctx: C,
  state: StateByTag<S, TStateTag>,
  builders: TransitionBuilders<S, C, TChildren, TEmits>
) => (event: E) => TransitionResult<S, C, R> | null;

/**
 * Configuration for a single state
 */
export interface StateConfig<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
  TStateTag extends S["_tag"],
  TChildren extends ChildrenConfig,
  TEmits extends MachineEvent,
  R = never,
> {
  /**
   * Effect to run when entering this state.
   * Receives the state data.
   */
  entry?: (state: StateByTag<S, TStateTag>) => Effect.Effect<void, never, R>;

  /**
   * Effect to run when exiting this state.
   * Receives the state data.
   */
  exit?: (state: StateByTag<S, TStateTag>) => Effect.Effect<void, never, R>;

  /**
   * Scope for entry + cleanup (alternative to entry/exit).
   * Uses Effect.acquireRelease pattern.
   */
  scope?: (
    state: StateByTag<S, TStateTag>
  ) => Effect.Effect<void, never, R>;

  /**
   * Long-running effect or stream while in this state.
   * - Effect: runs once, result is applied as transition
   * - Stream: runs continuously, elements are sent as events
   */
  run?:
    | Effect.Effect<TransitionResult<S, C, R>, never, R>
    | Stream.Stream<E, never, R>;

  /**
   * Delayed transition after entering state.
   */
  after?: {
    readonly delay: import("effect").Duration.DurationInput;
    readonly transition: () => TransitionResult<S, C, R>;
  };

  /**
   * Event handler for this state.
   */
  on: StateEventHandler<S, C, E, TStateTag, TChildren, TEmits, R>;
}

// ============================================================================
// Children Types
// ============================================================================

/**
 * Configuration for child machines.
 * Maps child IDs to their machine definitions.
 */
export type ChildrenConfig = Record<string, AnyMachineDefinition>;

/**
 * Extract the event type a child machine accepts
 */
export type ChildEventType<
  TChildren extends ChildrenConfig,
  K extends keyof TChildren,
> = TChildren[K] extends MachineDefinition<any, any, infer E, any, any, any, any>
  ? E
  : MachineEvent;

/**
 * Extract the state type of a child machine
 */
export type ChildStateType<
  TChildren extends ChildrenConfig,
  K extends keyof TChildren,
> = TChildren[K] extends MachineDefinition<infer S, any, any, any, any, any, any>
  ? S
  : MachineState;

/**
 * Extract the context type of a child machine
 */
export type ChildContextType<
  TChildren extends ChildrenConfig,
  K extends keyof TChildren,
> = TChildren[K] extends MachineDefinition<any, infer C, any, any, any, any, any>
  ? C
  : MachineContext;

/**
 * Configuration for child event subscriptions
 */
export type ChildEventsConfig<
  E extends MachineEvent,
  TChildren extends ChildrenConfig,
> = {
  [K in keyof TChildren]?: {
    /**
     * Called when child transitions to a new state.
     * Return an event to send to self, or null to ignore.
     */
    onState?: (state: ChildStateType<TChildren, K>) => E | null;

    /**
     * Called when child emits an event.
     * Return an event to send to self, or null to ignore.
     */
    onEmit?: (event: ChildEmitType<TChildren, K>) => E | null;
  };
};

/**
 * Extract the emit type of a child machine
 */
export type ChildEmitType<
  TChildren extends ChildrenConfig,
  K extends keyof TChildren,
> = TChildren[K] extends MachineDefinition<any, any, any, any, infer TEmits, any, any>
  ? TEmits
  : MachineEvent;

// ============================================================================
// Machine Definition Types
// ============================================================================

/**
 * Full machine configuration
 */
export interface MachineConfig<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
  TContextSchema extends Schema.Schema.Any,
  TEmits extends MachineEvent = never,
  TChildren extends ChildrenConfig = Record<string, never>,
  R = never,
> {
  /**
   * Unique identifier for this machine
   */
  readonly id: string;

  /**
   * Type hints for better type inference (similar to XState v5).
   * Use this to explicitly specify state, event, and emit types.
   *
   * @example
   * ```ts
   * types: {} as {
   *   state: GarageDoorState;
   *   event: GarageDoorEvent;
   *   emits: WakeHamster;
   * }
   * ```
   */
  readonly types?: MachineTypes<S, E, TEmits>;

  /**
   * Schema for context validation and serialization
   */
  readonly context: TContextSchema;

  /**
   * Initial context value
   */
  readonly initialContext: Schema.Schema.Type<TContextSchema>;

  /**
   * Initial state
   */
  readonly initialState: S;

  /**
   * Child machines this machine can spawn
   */
  readonly children?: TChildren;

  /**
   * Subscriptions to child events
   */
  readonly childEvents?: ChildEventsConfig<E, TChildren>;

  /**
   * Global event handler - runs before state handlers.
   * Receives context, event, and typed transition builders.
   * Return null to pass through to state handler.
   */
  readonly global?: (
    ctx: C,
    event: E,
    builders: TransitionBuilders<S, C, TChildren, TEmits>
  ) => TransitionResult<S, C, R> | null;

  /**
   * State configurations
   */
  readonly states: {
    [K in S["_tag"]]: StateConfig<S, C, E, K, TChildren, TEmits, R>;
  };
}

/**
 * Machine definition - the result of Machine.define()
 */
export interface MachineDefinition<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
  TContextSchema extends Schema.Schema.Any,
  TEmits extends MachineEvent = never,
  TChildren extends ChildrenConfig = Record<string, never>,
  R = never,
> {
  readonly _tag: "MachineDefinition";
  readonly _version: 2;
  readonly id: string;
  readonly config: MachineConfig<S, C, E, TContextSchema, TEmits, TChildren, R>;
  readonly initialSnapshot: MachineSnapshot<S, C>;
  readonly contextSchema: TContextSchema;

  /**
   * Create an actor from this machine definition.
   * Returns an Effect that requires R and Scope.
   */
  readonly interpret: (options?: InterpretOptions<S, C>) => Effect.Effect<
    MachineActor<S, C, E, TChildren>,
    never,
    R | import("effect").Scope.Scope
  >;
}

/**
 * Type-erased machine definition for parent-child relationships
 */
export interface AnyMachineDefinition {
  readonly _tag: "MachineDefinition";
  readonly _version: 2;
  readonly id: string;
}

// ============================================================================
// Snapshot Types
// ============================================================================

/**
 * Machine snapshot - current state and context
 */
export interface MachineSnapshot<S extends MachineState, C extends MachineContext> {
  readonly state: S;
  readonly context: C;
  readonly event: MachineEvent | null;
}

// ============================================================================
// Actor Types
// ============================================================================

/**
 * Options for interpreting a machine
 */
export interface InterpretOptions<S extends MachineState, C extends MachineContext> {
  /**
   * Initial snapshot to restore from
   */
  readonly snapshot?: MachineSnapshot<S, C>;

  /**
   * Child snapshots to restore (when restoring parent with children)
   */
  readonly childSnapshots?: ReadonlyMap<string, MachineSnapshot<MachineState, MachineContext>>;

  /**
   * Parent actor (for child machines)
   */
  readonly parent?: AnyMachineActor;
}

/**
 * A running machine actor
 */
export interface MachineActor<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
  TChildren extends ChildrenConfig = Record<string, never>,
> {
  /**
   * Send an event to this actor
   */
  readonly send: (event: E) => void;

  /**
   * Get the current snapshot
   */
  readonly getSnapshot: () => MachineSnapshot<S, C>;

  /**
   * Subscribe to snapshot changes
   */
  readonly subscribe: (
    observer: (snapshot: MachineSnapshot<S, C>) => void
  ) => () => void;

  /**
   * Get a child actor by ID
   */
  readonly child: <K extends keyof TChildren & string>(
    childId: K
  ) => ChildActor<TChildren, K> | undefined;

  /**
   * All children as a map
   */
  readonly children: ReadonlyMap<string, AnyMachineActor>;

  /**
   * Wait for a condition to be met
   */
  readonly waitFor: (
    predicate: (snapshot: MachineSnapshot<S, C>) => boolean
  ) => Effect.Effect<MachineSnapshot<S, C>>;

  /**
   * Stop the actor
   */
  readonly stop: () => void;

  /**
   * Sync the actor's snapshot from external state (e.g., cross-tab sync).
   * Updates the snapshot and notifies observers without going through normal transitions.
   * Also syncs child actors if childSnapshots is provided.
   * @internal
   */
  readonly _syncSnapshot: (
    newSnapshot: MachineSnapshot<S, C>,
    childSnapshots?: ReadonlyMap<string, MachineSnapshot<MachineState, MachineContext>>
  ) => void;
}

/**
 * Child actor with correct types
 */
export type ChildActor<
  TChildren extends ChildrenConfig,
  K extends keyof TChildren,
> = TChildren[K] extends MachineDefinition<
  infer S,
  infer C,
  infer E,
  any,
  any,
  infer TGrandChildren,
  any
>
  ? MachineActor<S, C, E, TGrandChildren>
  : never;

/**
 * Type-erased actor for internal use
 */
export interface AnyMachineActor {
  readonly send: (event: MachineEvent) => void;
  readonly getSnapshot: () => MachineSnapshot<MachineState, MachineContext>;
  readonly subscribe: (observer: (snapshot: MachineSnapshot<MachineState, MachineContext>) => void) => () => void;
  readonly stop: () => void;
  readonly _syncSnapshot: (
    newSnapshot: MachineSnapshot<MachineState, MachineContext>,
    childSnapshots?: ReadonlyMap<string, MachineSnapshot<MachineState, MachineContext>>
  ) => void;
}

// ============================================================================
// Type Utilities
// ============================================================================

/**
 * Extract state type from a machine definition
 */
export type MachineStateType<T> = T extends MachineDefinition<
  infer S,
  any,
  any,
  any,
  any,
  any,
  any
>
  ? S
  : never;

/**
 * Extract context type from a machine definition
 */
export type MachineContextType<T> = T extends MachineDefinition<
  any,
  infer C,
  any,
  any,
  any,
  any,
  any
>
  ? C
  : never;

/**
 * Extract event type from a machine definition
 */
export type MachineEventType<T> = T extends MachineDefinition<
  any,
  any,
  infer E,
  any,
  any,
  any,
  any
>
  ? E
  : never;

/**
 * Extract R (requirements) from a machine definition
 */
export type MachineRequirements<T> = T extends MachineDefinition<
  any,
  any,
  any,
  any,
  any,
  any,
  infer R
>
  ? R
  : never;

/**
 * Extract children config from a machine definition
 */
export type MachineChildrenType<T> = T extends MachineDefinition<
  any,
  any,
  any,
  any,
  any,
  infer TChildren,
  any
>
  ? TChildren
  : {};
