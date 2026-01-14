/**
 * Hamster Hook - Isolated state management for the hamster wheel
 *
 * This hook manages only the hamster state machine, making it:
 * - More maintainable than a giant combined hook
 * - Easier to test in isolation
 * - Reusable across different components
 */

import { useCallback } from "react";
import { useActor } from "@effstate/react/v3";
import type { MachineSnapshot } from "effstate/v3";
import {
  hamsterWheelMachine,
  Toggle,
  type HamsterState,
  type HamsterContext,
} from "@/machines";
import {
  serializeHamster,
  deserializeHamsterState,
  deserializeHamsterContext,
  type SerializedHamster,
} from "@/lib/db";

// ============================================================================
// Types
// ============================================================================

export type HamsterSnapshot = MachineSnapshot<HamsterState, HamsterContext>;

export interface UseHamsterResult {
  state: HamsterState;
  context: HamsterContext;
  toggle: () => void;
  // For persistence coordination
  serialize: () => SerializedHamster;
  applyExternal: (serialized: SerializedHamster) => void;
  subscribe: (callback: () => void) => () => void;
  // Derived state
  isPowered: boolean;
}

// ============================================================================
// Hook
// ============================================================================

export function useHamster(initialSnapshot: HamsterSnapshot | null): UseHamsterResult {
  const { state, context, send, actor } = useActor(
    hamsterWheelMachine,
    initialSnapshot ? { initialSnapshot } : undefined
  );

  const toggle = useCallback(() => send(new Toggle()), [send]);

  const serialize = useCallback(
    () => serializeHamster(state, context),
    [state, context]
  );

  const applyExternal = useCallback(
    (serialized: SerializedHamster) => {
      actor._syncSnapshot({
        state: deserializeHamsterState(serialized),
        context: deserializeHamsterContext(serialized),
      });
    },
    [actor]
  );

  const subscribe = useCallback(
    (callback: () => void) => actor.subscribe(callback),
    [actor]
  );

  return {
    state,
    context,
    toggle,
    serialize,
    applyExternal,
    subscribe,
    isPowered: context.electricityLevel > 0,
  };
}
