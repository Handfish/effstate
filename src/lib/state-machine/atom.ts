import { Atom, Result, useAtomValue } from "@effect-atom/atom-react";
import { Effect } from "effect";
import React from "react";
import { interpret, type MachineActor } from "./machine.js";
import type { MachineContext, MachineDefinition, MachineEvent, MachineSnapshot } from "./types.js";

// ============================================================================
// Atom Integration
// ============================================================================

export interface MachineAtomConfig<
  TId extends string,
  TStateValue extends string,
  TContext extends MachineContext,
  TEvent extends MachineEvent,
  R,
  E,
> {
  readonly machine: MachineDefinition<TId, TStateValue, TContext, TEvent, R, E>;
}

/**
 * Create atoms for a state machine that integrate with @effect-atom
 *
 * @example
 * ```ts
 * const { actorAtom, snapshotAtom, useMachine } = createMachineAtoms({
 *   runtime: appRuntime,
 *   machine: toggleMachine,
 * })
 * ```
 */
export function createMachineAtoms<
  TId extends string,
  TStateValue extends string,
  TContext extends MachineContext,
  TEvent extends MachineEvent,
  R,
  E,
>(
  runtime: {
    atom: <A, E2, R2>(effect: Effect.Effect<A, E2, R2>) => Atom.Atom<Result.Result<A, E2>>;
    subscriptionRef: <A, E2>(
      fn: (get: any) => Effect.Effect<import("effect").SubscriptionRef.SubscriptionRef<A>, E2, any>,
    ) => Atom.Atom<Result.Result<A, E2>>;
  },
  config: MachineAtomConfig<TId, TStateValue, TContext, TEvent, R, E>,
): {
  actorAtom: Atom.Atom<Result.Result<MachineActor<TStateValue, TContext, TEvent>, never>>;
  snapshotAtom: Atom.Atom<Result.Result<unknown, unknown>>;
  useMachine: () => {
    snapshot: MachineSnapshot<TStateValue, TContext>;
    send: (event: TEvent) => void;
    isLoading: boolean;
    matches: (state: TStateValue) => boolean;
  };
} {
  // Actor atom - creates and holds the interpreter
  const actorAtom = runtime
    .atom(interpret(config.machine))
    .pipe(Atom.keepAlive);

  // Snapshot atom - reactive state using subscriptionRef
  const snapshotAtom = runtime
    .subscriptionRef((get: any) =>
      Effect.gen(function* () {
        const actor = yield* get.result(actorAtom);
        return actor.snapshotRef;
      }),
    )
    .pipe(Atom.keepAlive);

  // React hook for using the machine
  const useMachine = (): {
    snapshot: MachineSnapshot<TStateValue, TContext>;
    send: (event: TEvent) => void;
    isLoading: boolean;
    matches: (state: TStateValue) => boolean;
  } => {
    const actorResult = useAtomValue(actorAtom);
    const snapshotResult = useAtomValue(snapshotAtom);

    const send = React.useCallback(
      (event: TEvent) => {
        if (actorResult._tag !== "Success") return;
        actorResult.value.send(event);
      },
      [actorResult],
    );

    const isLoading = actorResult._tag !== "Success" || snapshotResult._tag !== "Success";

    const snapshot: MachineSnapshot<TStateValue, TContext> =
      snapshotResult._tag === "Success"
        ? (snapshotResult.value as MachineSnapshot<TStateValue, TContext>)
        : config.machine.initialSnapshot;

    const matches = React.useCallback(
      (state: TStateValue) => snapshot.value === state,
      [snapshot.value],
    );

    return {
      snapshot,
      send,
      isLoading,
      matches,
    };
  };

  return {
    actorAtom,
    snapshotAtom,
    useMachine,
  };
}

// ============================================================================
// Selector Helpers
// ============================================================================

/**
 * Create a selector for extracting values from context
 */
export function selectContext<
  TContext extends MachineContext,
  TSelected,
>(
  selector: (context: TContext) => TSelected,
): <TStateValue extends string>(
  snapshot: MachineSnapshot<TStateValue, TContext>,
) => TSelected {
  return (snapshot) => selector(snapshot.context);
}

/**
 * Create a selector for checking current state
 */
export function selectState<TStateValue extends string>(
  state: TStateValue,
): <TContext extends MachineContext>(
  snapshot: MachineSnapshot<TStateValue, TContext>,
) => boolean {
  return (snapshot) => snapshot.value === state;
}
