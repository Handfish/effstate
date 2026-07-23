/**
 * EffState v2 React Hooks
 *
 * React integration for v2 machines using @effect-atom.
 * Supports discriminated union states (Data.TaggedEnum).
 */

import { Atom, Result, useAtomValue } from "@effect-atom/atom-react";
import { Effect, SubscriptionRef } from "effect";
import React from "react";
import type {
  MachineState,
  MachineContext,
  MachineEvent,
  MachineSnapshot,
  MachineActor,
  ChildrenConfig,
  StateTag,
} from "effstate/v2";

// ============================================================================
// React Hook Result Type
// ============================================================================

export interface UseMachineResult<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
  TChildren extends ChildrenConfig = {},
> {
  /** Current state snapshot */
  readonly snapshot: MachineSnapshot<S, C>;
  /** Send an event to the machine */
  readonly send: (event: E) => void;
  /** Whether the machine is still initializing */
  readonly isLoading: boolean;
  /** Check if machine is in a specific state by tag */
  readonly matches: (stateTag: StateTag<S>) => boolean;
  /** Current state (discriminated union) */
  readonly state: S;
  /** Current state tag */
  readonly stateTag: StateTag<S>;
  /** Current context */
  readonly context: C;
  /** Access child actors */
  readonly children: ReadonlyMap<string, unknown>;
}

// ============================================================================
// Hook Factory
// ============================================================================

/**
 * Create a React hook for using a v2 state machine.
 *
 * This works with discriminated union states (Data.TaggedEnum).
 *
 * @example
 * ```ts
 * // Create atoms with full type inference from appRuntime
 * const actorAtom = appRuntime
 *   .atom(garageDoorMachine.interpret())
 *   .pipe(Atom.keepAlive);
 *
 * const snapshotAtom = appRuntime
 *   .subscriptionRef((get) =>
 *     Effect.gen(function* () {
 *       const actor = yield* get.result(actorAtom);
 *       return yield* SubscriptionRef.make(actor.getSnapshot());
 *       // Note: you'd also subscribe to actor changes
 *     })
 *   )
 *   .pipe(Atom.keepAlive);
 *
 * // Create the hook with full type safety
 * const useGarageDoor = createUseMachineHook(
 *   actorAtom,
 *   snapshotAtom,
 *   GarageDoorMachine.initialSnapshot,
 * );
 *
 * // In component:
 * const { state, matches, send } = useGarageDoor();
 * if (matches("Opening")) {
 *   // state is narrowed to Opening
 *   console.log(state.startedAt); // Type-safe access to state data
 * }
 * ```
 */
export const createUseMachineHook = <
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
  TChildren extends ChildrenConfig = {},
>(
  actorAtom: Atom.Atom<Result.Result<MachineActor<S, C, E, TChildren>, never>>,
  snapshotAtom: Atom.Atom<Result.Result<MachineSnapshot<S, C>, never>>,
  initialSnapshot: MachineSnapshot<S, C>,
): (() => UseMachineResult<S, C, E, TChildren>) => {
  return function useMachine(): UseMachineResult<S, C, E, TChildren> {
    const actorResult = useAtomValue(actorAtom);
    const snapshotResult = useAtomValue(snapshotAtom);

    const send = React.useCallback(
      (event: E) => {
        if (actorResult._tag === "Success") {
          actorResult.value.send(event);
        }
      },
      [actorResult],
    );

    const isLoading = actorResult._tag !== "Success" || snapshotResult._tag !== "Success";

    const snapshot: MachineSnapshot<S, C> =
      snapshotResult._tag === "Success" ? snapshotResult.value : initialSnapshot;

    const matches = React.useCallback(
      (stateTag: StateTag<S>) => snapshot.state._tag === stateTag,
      [snapshot.state._tag],
    );

    const children: ReadonlyMap<string, unknown> =
      actorResult._tag === "Success"
        ? actorResult.value.children
        : new Map();

    return {
      snapshot,
      send,
      isLoading,
      matches,
      state: snapshot.state,
      stateTag: snapshot.state._tag as StateTag<S>,
      context: snapshot.context,
      children,
    };
  };
};

// ============================================================================
// Selector Helpers
// ============================================================================

/**
 * Create a selector for extracting values from context
 */
export const selectContext =
  <C extends MachineContext, TSelected>(selector: (context: C) => TSelected) =>
  <S extends MachineState>(snapshot: MachineSnapshot<S, C>): TSelected =>
    selector(snapshot.context);

/**
 * Create a selector for checking current state by tag
 */
export const selectState =
  <S extends MachineState>(stateTag: StateTag<S>) =>
  <C extends MachineContext>(snapshot: MachineSnapshot<S, C>): boolean =>
    snapshot.state._tag === stateTag;

/**
 * Create a selector that narrows state to a specific variant
 * Returns the state data if matched, undefined otherwise
 */
export const selectStateData =
  <S extends MachineState, Tag extends StateTag<S>>(stateTag: Tag) =>
  <C extends MachineContext>(
    snapshot: MachineSnapshot<S, C>
  ): Extract<S, { _tag: Tag }> | undefined =>
    snapshot.state._tag === stateTag
      ? (snapshot.state as Extract<S, { _tag: Tag }>)
      : undefined;

// ============================================================================
// Child Machine Hook Factory
// ============================================================================

/**
 * Create a React hook for using a child state machine spawned by a parent.
 *
 * Works with v2's discriminated union states.
 *
 * @example
 * ```ts
 * // Parent defines children in machine config:
 * // children: {
 * //   garageDoor: GarageDoorMachine,
 * // }
 *
 * // Create hook for the child
 * const useGarageDoor = createUseChildMachineHook(
 *   appRuntime,
 *   houseActorAtom,
 *   "garageDoor",
 *   GarageDoorMachine.initialSnapshot,
 * );
 *
 * // Use in component
 * const { state, matches, send } = useGarageDoor();
 * if (matches("Open")) {
 *   console.log("Door opened at:", state.openedAt);
 * }
 * ```
 */
export const createUseChildMachineHook = <
  TParentState extends MachineState,
  TParentContext extends MachineContext,
  TParentEvent extends MachineEvent,
  TParentChildren extends ChildrenConfig,
  TChildState extends MachineState,
  TChildContext extends MachineContext,
  TChildEvent extends MachineEvent,
  TChildChildren extends ChildrenConfig = {},
>(
  runtime: {
    atom: (effect: Effect.Effect<any, any, any>) => Atom.Atom<any>;
    subscriptionRef: (
      fn: (get: any) => Effect.Effect<SubscriptionRef.SubscriptionRef<any>, any, any>
    ) => Atom.Atom<any>;
  },
  parentActorAtom: Atom.Atom<
    Result.Result<MachineActor<TParentState, TParentContext, TParentEvent, TParentChildren>, never>
  >,
  childId: keyof TParentChildren & string,
  initialSnapshot: MachineSnapshot<TChildState, TChildContext>,
): (() => UseMachineResult<TChildState, TChildContext, TChildEvent, TChildChildren>) => {
  // Create atom that derives child actor from parent
  const childActorAtom = runtime
    .subscriptionRef(
      (get: {
        result: (
          atom: Atom.Atom<
            Result.Result<
              MachineActor<TParentState, TParentContext, TParentEvent, TParentChildren>,
              never
            >
          >
        ) => Effect.Effect<
          MachineActor<TParentState, TParentContext, TParentEvent, TParentChildren>,
          never,
          never
        >;
      }) =>
        Effect.gen(function* () {
          const parentActor = yield* get.result(parentActorAtom);

          // Create a ref that tracks the child actor
          const childActor = parentActor.children.get(childId) as
            | MachineActor<TChildState, TChildContext, TChildEvent, TChildChildren>
            | undefined;
          const ref = yield* SubscriptionRef.make<
            MachineActor<TChildState, TChildContext, TChildEvent, TChildChildren> | undefined
          >(childActor);

          // Subscribe to parent changes to detect when child is spawned
          parentActor.subscribe(() => {
            const child = parentActor.children.get(childId) as
              | MachineActor<TChildState, TChildContext, TChildEvent, TChildChildren>
              | undefined;
            Effect.runSync(SubscriptionRef.set(ref, child));
          });

          return ref;
        })
    )
    .pipe(Atom.keepAlive);

  // Create atom that subscribes to child's snapshot
  const childSnapshotAtom = runtime
    .subscriptionRef(
      (get: {
        result: (
          atom: Atom.Atom<
            Result.Result<
              MachineActor<TChildState, TChildContext, TChildEvent, TChildChildren> | undefined,
              never
            >
          >
        ) => Effect.Effect<
          MachineActor<TChildState, TChildContext, TChildEvent, TChildChildren> | undefined,
          never,
          never
        >;
      }) =>
        Effect.gen(function* () {
          const childActor = yield* get.result(childActorAtom);

          const currentSnapshot = childActor?.getSnapshot() ?? initialSnapshot;
          const ref = yield* SubscriptionRef.make<MachineSnapshot<TChildState, TChildContext>>(
            currentSnapshot
          );

          // Subscribe to child snapshot changes if child exists
          if (childActor) {
            childActor.subscribe((snapshot) => {
              Effect.runSync(SubscriptionRef.set(ref, snapshot));
            });
          }

          return ref;
        })
    )
    .pipe(Atom.keepAlive);

  // Return hook that uses these atoms
  return function useChildMachine(): UseMachineResult<
    TChildState,
    TChildContext,
    TChildEvent,
    TChildChildren
  > {
    const childActorResult = useAtomValue(childActorAtom);
    const snapshotResult = useAtomValue(childSnapshotAtom);

    const send = React.useCallback(
      (event: TChildEvent) => {
        if (childActorResult._tag === "Success" && childActorResult.value) {
          childActorResult.value.send(event);
        }
      },
      [childActorResult],
    );

    const isLoading =
      childActorResult._tag !== "Success" ||
      snapshotResult._tag !== "Success" ||
      !childActorResult.value;

    const snapshot: MachineSnapshot<TChildState, TChildContext> =
      snapshotResult._tag === "Success" ? snapshotResult.value : initialSnapshot;

    const matches = React.useCallback(
      (stateTag: StateTag<TChildState>) => snapshot.state._tag === stateTag,
      [snapshot.state._tag],
    );

    const children: ReadonlyMap<string, unknown> =
      childActorResult._tag === "Success" && childActorResult.value
        ? childActorResult.value.children
        : new Map();

    return {
      snapshot,
      send,
      isLoading,
      matches,
      state: snapshot.state,
      stateTag: snapshot.state._tag as StateTag<TChildState>,
      context: snapshot.context,
      children,
    };
  };
};

// ============================================================================
// Type Guard Helpers
// ============================================================================

/**
 * Type guard for narrowing state in components
 *
 * @example
 * ```ts
 * const { state } = useGarageDoor();
 *
 * if (isState(state, "Opening")) {
 *   // state is narrowed to GarageDoorState.Opening
 *   console.log(state.startedAt);
 * }
 * ```
 */
export function isState<S extends MachineState, Tag extends StateTag<S>>(
  state: S,
  tag: Tag
): state is Extract<S, { _tag: Tag }> {
  return state._tag === tag;
}

/**
 * Get state data with narrowing
 *
 * @example
 * ```ts
 * const { state } = useGarageDoor();
 *
 * const openingData = getStateData(state, "Opening");
 * if (openingData) {
 *   console.log(openingData.startedAt);
 * }
 * ```
 */
export function getStateData<S extends MachineState, Tag extends StateTag<S>>(
  state: S,
  tag: Tag
): Extract<S, { _tag: Tag }> | undefined {
  return state._tag === tag ? (state as Extract<S, { _tag: Tag }>) : undefined;
}
