import { Atom, Result, useAtomValue } from "@effect-atom/atom-react";
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
