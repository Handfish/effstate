/**
 * Door Hook - Isolated state management for a single garage door
 *
 * This hook manages a single door state machine, making it:
 * - More maintainable than a giant combined hook
 * - Reusable for multiple doors (left, right, etc.)
 * - Easier to test in isolation
 */

import { useCallback } from "react";
import { useActor } from "@effstate/react/v3";
import type { MachineSnapshot } from "effstate/v3";
import {
  garageDoorMachine,
  Click,
  PowerOn,
  PowerOff,
  type DoorState,
  type DoorContext,
} from "@/machines";
import {
  serializeDoor,
  deserializeDoorState,
  deserializeDoorContext,
  type SerializedDoor,
} from "@/lib/db";

// ============================================================================
// Types
// ============================================================================

export type DoorSnapshot = MachineSnapshot<DoorState, DoorContext>;

export interface UseDoorResult {
  state: DoorState;
  context: DoorContext;
  click: () => void;
  setPower: (isPowered: boolean) => void;
  // For persistence coordination
  serialize: () => SerializedDoor;
  applyExternal: (serialized: SerializedDoor) => void;
  subscribe: (callback: () => void) => () => void;
}

// ============================================================================
// Hook
// ============================================================================

export function useDoor(initialSnapshot: DoorSnapshot | null): UseDoorResult {
  const { state, context, send, actor } = useActor(
    garageDoorMachine,
    initialSnapshot ? { initialSnapshot } : undefined
  );

  const click = useCallback(() => send(new Click()), [send]);

  const setPower = useCallback(
    (isPowered: boolean) => send(isPowered ? new PowerOn() : new PowerOff()),
    [send]
  );

  const serialize = useCallback(
    () => serializeDoor(state, context),
    [state, context]
  );

  const applyExternal = useCallback(
    (serialized: SerializedDoor) => {
      actor._syncSnapshot({
        state: deserializeDoorState(serialized),
        context: deserializeDoorContext(serialized),
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
    click,
    setPower,
    serialize,
    applyExternal,
    subscribe,
  };
}
