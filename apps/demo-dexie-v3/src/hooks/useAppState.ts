/**
 * App State Hook - v3 API with Dexie Persistence
 *
 * Uses the clean PersistenceAdapter pattern.
 * Split into two hooks to avoid transition on initial load:
 * - useInitialSnapshots: loads from Dexie
 * - useAppState: creates actors (only called after load)
 */

import { useCallback, useEffect, useState } from "react";
import { useActor, useActorWatch, usePersistence } from "@effstate/react/v3";
import type { MachineSnapshot } from "effstate/v3";
import {
  hamsterWheelMachine,
  garageDoorMachine,
  Toggle,
  Click,
  PowerOn,
  PowerOff,
  getHamsterStateLabel,
  getHamsterButtonLabel,
  getDoorStateLabel,
  getDoorButtonLabel,
  type HamsterState,
  type HamsterContext,
  type DoorState,
  type DoorContext,
} from "@/machines";
import {
  serializeHamster,
  serializeDoor,
  deserializeHamsterState,
  deserializeHamsterContext,
  deserializeDoorState,
  deserializeDoorContext,
} from "@/lib/db";
import {
  createDexieAdapter,
  useDexieLiveQuery,
  isLeader,
  type SerializedAppState,
} from "@/lib/dexie-adapter";

// Re-export UI helpers
export { getHamsterStateLabel, getHamsterButtonLabel, getDoorStateLabel, getDoorButtonLabel };

// ============================================================================
// Types
// ============================================================================

export type InitialSnapshots = {
  hamster: MachineSnapshot<HamsterState, HamsterContext>;
  leftDoor: MachineSnapshot<DoorState, DoorContext>;
  rightDoor: MachineSnapshot<DoorState, DoorContext>;
};

export type AppState = {
  hamster: { state: HamsterState; context: HamsterContext };
  leftDoor: { state: DoorState; context: DoorContext };
  rightDoor: { state: DoorState; context: DoorContext };
};

export type AppStateResult = {
  state: AppState;
  isLeader: boolean;
  toggleHamster: () => void;
  clickDoor: (door: "left" | "right") => void;
};

// ============================================================================
// Adapter (module level)
// ============================================================================

const dexieAdapter = createDexieAdapter();

// ============================================================================
// Initial Load Hook (call this first, before actors exist)
// ============================================================================

export function useInitialSnapshots(): { loaded: boolean; snapshots: InitialSnapshots | null } {
  const [result, setResult] = useState<{ loaded: boolean; snapshots: InitialSnapshots | null }>({
    loaded: false,
    snapshots: null,
  });

  useEffect(() => {
    dexieAdapter.load().then((saved) => {
      if (saved) {
        setResult({
          loaded: true,
          snapshots: {
            hamster: {
              state: deserializeHamsterState(saved.hamster),
              context: deserializeHamsterContext(saved.hamster),
            },
            leftDoor: {
              state: deserializeDoorState(saved.leftDoor),
              context: deserializeDoorContext(saved.leftDoor),
            },
            rightDoor: {
              state: deserializeDoorState(saved.rightDoor),
              context: deserializeDoorContext(saved.rightDoor),
            },
          },
        });
      } else {
        setResult({ loaded: true, snapshots: null });
      }
    });
  }, []);

  return result;
}

// ============================================================================
// Main Hook (only call after loaded, with initial snapshots)
// ============================================================================

export function useAppState(initialSnapshots: InitialSnapshots | null): AppStateResult {
  // Create actors with initial snapshots (or machine defaults if no saved state)
  const hamster = useActor(hamsterWheelMachine, initialSnapshots?.hamster ? {
    initialSnapshot: initialSnapshots.hamster,
  } : undefined);

  const leftDoor = useActor(garageDoorMachine, initialSnapshots?.leftDoor ? {
    initialSnapshot: initialSnapshots.leftDoor,
  } : undefined);

  const rightDoor = useActor(garageDoorMachine, initialSnapshots?.rightDoor ? {
    initialSnapshot: initialSnapshots.rightDoor,
  } : undefined);

  // Serialize current state
  const serialize = useCallback((): SerializedAppState => ({
    hamster: serializeHamster(hamster.state, hamster.context),
    leftDoor: serializeDoor(leftDoor.state, leftDoor.context),
    rightDoor: serializeDoor(rightDoor.state, rightDoor.context),
  }), [hamster.state, hamster.context, leftDoor.state, leftDoor.context, rightDoor.state, rightDoor.context]);

  // Apply external state (for cross-tab sync)
  const applyExternal = useCallback((state: SerializedAppState) => {
    hamster.actor._syncSnapshot({
      state: deserializeHamsterState(state.hamster),
      context: deserializeHamsterContext(state.hamster),
    });
    leftDoor.actor._syncSnapshot({
      state: deserializeDoorState(state.leftDoor),
      context: deserializeDoorContext(state.leftDoor),
    });
    rightDoor.actor._syncSnapshot({
      state: deserializeDoorState(state.rightDoor),
      context: deserializeDoorContext(state.rightDoor),
    });
  }, [hamster.actor, leftDoor.actor, rightDoor.actor]);

  // Subscribe to actor changes
  const subscribeToActors = useCallback((callback: () => void) => {
    const unsubs = [
      hamster.actor.subscribe(callback),
      leftDoor.actor.subscribe(callback),
      rightDoor.actor.subscribe(callback),
    ];
    return () => unsubs.forEach((u) => u());
  }, [hamster.actor, leftDoor.actor, rightDoor.actor]);

  // Wire up persistence
  usePersistence({
    adapter: dexieAdapter,
    serialize,
    applyExternal,
    subscribeToActors,
  });

  // Connect Dexie liveQuery for cross-tab sync
  useDexieLiveQuery(dexieAdapter, applyExternal);

  // Power sync: hamster → doors
  useActorWatch(
    hamster.actor,
    (snap) => snap.context.electricityLevel > 0,
    (isPowered) => {
      const event = isPowered ? new PowerOn() : new PowerOff();
      leftDoor.send(event);
      rightDoor.send(event);
    }
  );

  return {
    state: {
      hamster: { state: hamster.state, context: hamster.context },
      leftDoor: { state: leftDoor.state, context: leftDoor.context },
      rightDoor: { state: rightDoor.state, context: rightDoor.context },
    },
    isLeader: isLeader(),
    toggleHamster: useCallback(() => hamster.send(new Toggle()), [hamster]),
    clickDoor: useCallback(
      (door: "left" | "right") => (door === "left" ? leftDoor : rightDoor).send(new Click()),
      [leftDoor, rightDoor]
    ),
  };
}
