import { Atom, Result, useAtomValue } from "@effect-atom/atom-react";
import { Effect, SubscriptionRef } from "effect";
import React from "react";
import type { MachineActor } from "./machine.js";
import type { MachineContext, MachineEvent, MachineSnapshot } from "./types.js";

// ============================================================================
// React Hook Result Type
// ============================================================================

export interface UseMachineResult<
  TStateValue extends string,
  TContext extends MachineContext,
  TEvent extends MachineEvent,
> {
  /** Current state snapshot */
  readonly snapshot: MachineSnapshot<TStateValue, TContext>;
  /** Send an event to the machine */
  readonly send: (event: TEvent) => void;
  /** Whether the machine is still initializing */
  readonly isLoading: boolean;
  /** Check if machine is in a specific state */
  readonly matches: (state: TStateValue) => boolean;
  /** Current state value */
  readonly state: TStateValue;
  /** Current context */
  readonly context: TContext;
}

// ============================================================================
// Hook Factory
// ============================================================================

/**
 * Create a React hook for using a state machine.
 *
 * This is the type-safe way to integrate with @effect-atom.
 * You create the atoms directly with your runtime (full inference),
 * then pass them here to get a typed hook.
 *
 * @example
 * ```ts
 * // Create atoms with full type inference from appRuntime
 * const actorAtom = appRuntime
 *   .atom(interpret(myMachine))
 *   .pipe(Atom.keepAlive);
 *
 * const snapshotAtom = appRuntime
 *   .subscriptionRef((get) =>
 *     Effect.gen(function* () {
 *       const actor = yield* get.result(actorAtom);
 *       return actor.snapshotRef;
 *     })
 *   )
 *   .pipe(Atom.keepAlive);
 *
 * // Create the hook with full type safety
 * const useMachine = createUseMachineHook(
 *   actorAtom,
 *   snapshotAtom,
 *   myMachine.initialSnapshot,
 * );
 * ```
 */
export const createUseMachineHook = <
  TStateValue extends string,
  TContext extends MachineContext,
  TEvent extends MachineEvent,
>(
  actorAtom: Atom.Atom<Result.Result<MachineActor<TStateValue, TContext, TEvent>, never>>,
  snapshotAtom: Atom.Atom<Result.Result<MachineSnapshot<TStateValue, TContext>, never>>,
  initialSnapshot: MachineSnapshot<TStateValue, TContext>,
): (() => UseMachineResult<TStateValue, TContext, TEvent>) => {
  return function useMachine(): UseMachineResult<TStateValue, TContext, TEvent> {
    const actorResult = useAtomValue(actorAtom);
    const snapshotResult = useAtomValue(snapshotAtom);

    const send = React.useCallback(
      (event: TEvent) => {
        if (actorResult._tag === "Success") {
          actorResult.value.send(event);
        }
      },
      [actorResult],
    );

    const isLoading = actorResult._tag !== "Success" || snapshotResult._tag !== "Success";

    const snapshot: MachineSnapshot<TStateValue, TContext> =
      snapshotResult._tag === "Success" ? snapshotResult.value : initialSnapshot;

    const matches = React.useCallback(
      (state: TStateValue) => snapshot.value === state,
      [snapshot.value],
    );

    return {
      snapshot,
      send,
      isLoading,
      matches,
      state: snapshot.value,
      context: snapshot.context,
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
  <TContext extends MachineContext, TSelected>(selector: (context: TContext) => TSelected) =>
  <TStateValue extends string>(snapshot: MachineSnapshot<TStateValue, TContext>): TSelected =>
    selector(snapshot.context);

/**
 * Create a selector for checking current state
 */
export const selectState =
  <TStateValue extends string>(state: TStateValue) =>
  <TContext extends MachineContext>(snapshot: MachineSnapshot<TStateValue, TContext>): boolean =>
    snapshot.value === state;

// ============================================================================
// Child Machine Hook Factory
// ============================================================================

/**
 * Create a React hook for using a child state machine spawned by a parent.
 *
 * This provides the same interface as createUseMachineHook but derives the
 * child actor from the parent's children map. The child's snapshot is
 * automatically subscribed to when the child becomes available.
 *
 * @example
 * ```ts
 * // Parent spawns child in its machine definition:
 * // spawnChild(ChildMachine, { id: "myChild" })
 *
 * // Create hook for the child
 * const useChildMachine = createUseChildMachineHook(
 *   appRuntime,
 *   parentActorAtom,
 *   "myChild",
 *   childInitialSnapshot,
 * );
 *
 * // Use in component
 * const { snapshot, send, matches } = useChildMachine();
 * ```
 */
export const createUseChildMachineHook = <
  TParentStateValue extends string,
  TParentContext extends MachineContext,
  TParentEvent extends MachineEvent,
  TChildStateValue extends string,
  TChildContext extends MachineContext,
  TChildEvent extends MachineEvent,
>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runtime: { atom: (effect: Effect.Effect<any, any, any>) => Atom.Atom<any>; subscriptionRef: (fn: (get: any) => Effect.Effect<SubscriptionRef.SubscriptionRef<any>, any, any>) => Atom.Atom<any> },
  parentActorAtom: Atom.Atom<Result.Result<MachineActor<TParentStateValue, TParentContext, TParentEvent>, never>>,
  childId: string,
  initialSnapshot: MachineSnapshot<TChildStateValue, TChildContext>,
): (() => UseMachineResult<TChildStateValue, TChildContext, TChildEvent>) => {
  // Create atom that derives child actor from parent
  const childActorAtom = runtime
    .subscriptionRef((get: { result: (atom: Atom.Atom<Result.Result<MachineActor<TParentStateValue, TParentContext, TParentEvent>, never>>) => Effect.Effect<MachineActor<TParentStateValue, TParentContext, TParentEvent>, never, never> }) =>
      Effect.gen(function* () {
        const parentActor = yield* get.result(parentActorAtom);

        // Create a ref that tracks the child actor
        const childActor = parentActor.children.get(childId) as MachineActor<TChildStateValue, TChildContext, TChildEvent> | undefined;
        const ref = yield* SubscriptionRef.make<MachineActor<TChildStateValue, TChildContext, TChildEvent> | undefined>(childActor);

        // Subscribe to parent changes to detect when child is spawned
        parentActor.subscribe(() => {
          const child = parentActor.children.get(childId) as MachineActor<TChildStateValue, TChildContext, TChildEvent> | undefined;
          Effect.runSync(SubscriptionRef.set(ref, child));
        });

        return ref;
      })
    )
    .pipe(Atom.keepAlive);

  // Create atom that subscribes to child's snapshot
  const childSnapshotAtom = runtime
    .subscriptionRef((get: { result: (atom: Atom.Atom<Result.Result<MachineActor<TChildStateValue, TChildContext, TChildEvent> | undefined, never>>) => Effect.Effect<MachineActor<TChildStateValue, TChildContext, TChildEvent> | undefined, never, never> }) =>
      Effect.gen(function* () {
        const childActor = yield* get.result(childActorAtom);

        const currentSnapshot = childActor?.getSnapshot() ?? initialSnapshot;
        const ref = yield* SubscriptionRef.make<MachineSnapshot<TChildStateValue, TChildContext>>(currentSnapshot);

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
  return function useChildMachine(): UseMachineResult<TChildStateValue, TChildContext, TChildEvent> {
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

    const isLoading = childActorResult._tag !== "Success" ||
                      snapshotResult._tag !== "Success" ||
                      !childActorResult.value;

    const snapshot: MachineSnapshot<TChildStateValue, TChildContext> =
      snapshotResult._tag === "Success" ? snapshotResult.value : initialSnapshot;

    const matches = React.useCallback(
      (state: TChildStateValue) => snapshot.value === state,
      [snapshot.value],
    );

    return {
      snapshot,
      send,
      isLoading,
      matches,
      state: snapshot.value,
      context: snapshot.context,
    };
  };
};
