/**
 * Hamster Domain Hook
 *
 * Standalone hook for hamster state machine.
 * Exposes actor for persistence coordination.
 */

import { useCallback } from "react";
import { useActor } from "@effstate/react/v3";
import type { MachineSnapshot } from "effstate/v3";
import {
  hamsterWheelMachine,
  Toggle,
  type HamsterState,
  type HamsterContext,
  type HamsterWheelActor,
} from "@/machines";

export type HamsterSnapshot = MachineSnapshot<HamsterState, HamsterContext>;

export interface HamsterDomain {
  state: HamsterState;
  context: HamsterContext;
  actor: HamsterWheelActor;
  toggle: () => void;
  isPowered: boolean;
}

export function useHamster(initialSnapshot: HamsterSnapshot | null): HamsterDomain {
  const { state, context, send, actor } = useActor(
    hamsterWheelMachine,
    initialSnapshot ? { initialSnapshot } : undefined
  );

  return {
    state,
    context,
    actor,
    toggle: useCallback(() => send(new Toggle()), [send]),
    isPowered: context.electricityLevel > 0,
  };
}
