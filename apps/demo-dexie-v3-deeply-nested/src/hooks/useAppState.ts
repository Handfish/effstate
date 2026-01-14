/**
 * App State Hook - Thin Coordinator
 *
 * Composes domain hooks and wires up:
 * - Persistence (atomic save/load across domains)
 * - Cross-domain effects (hamster powers doors)
 *
 * Each domain hook is testable in isolation.
 */

import { useEffect, useState } from "react";
import { useActorWatch } from "@effstate/react/v3";
import { useHamster, type HamsterSnapshot } from "./domains/useHamster";
import { useDoors, type DoorSnapshot } from "./domains/useDoors";
import {
  usePersistenceCoordinator,
  dexieAdapter,
  isLeader,
} from "./persistence/usePersistenceCoordinator";
import {
  deserializeHamsterState,
  deserializeHamsterContext,
  deserializeDoorState,
  deserializeDoorContext,
} from "@/lib/db";

// ============================================================================
// Types
// ============================================================================

export type InitialSnapshots = {
  hamster: HamsterSnapshot;
  leftDoor: DoorSnapshot;
  rightDoor: DoorSnapshot;
};

// ============================================================================
// Initial Load Hook
// ============================================================================

export function useInitialSnapshots() {
  const [result, setResult] = useState<{
    loaded: boolean;
    snapshots: InitialSnapshots | null;
  }>({ loaded: false, snapshots: null });

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
// Main Coordinator Hook
// ============================================================================

export function useAppState(snapshots: InitialSnapshots | null) {
  // Domain hooks (each testable in isolation)
  const hamster = useHamster(snapshots?.hamster ?? null);
  const doors = useDoors(snapshots?.leftDoor ?? null, snapshots?.rightDoor ?? null);

  // Persistence (atomic across all domains)
  const { isLeader: isLeaderNow } = usePersistenceCoordinator({ hamster, doors });

  // Cross-domain effect: hamster powers doors
  useActorWatch(
    hamster.actor,
    (snap) => snap.context.electricityLevel > 0,
    doors.setPower
  );

  return {
    // Expose domain hooks directly
    hamster,
    doors,
    // Convenience accessors for backwards compat
    state: {
      hamster: { state: hamster.state, context: hamster.context },
      leftDoor: { state: doors.left.state, context: doors.left.context },
      rightDoor: { state: doors.right.state, context: doors.right.context },
    },
    isLeader: isLeaderNow,
    toggleHamster: hamster.toggle,
    clickDoor: doors.click,
  };
}

// Re-export for convenience
export { isLeader };
export {
  getHamsterStateLabel,
  getHamsterButtonLabel,
  getDoorStateLabel,
  getDoorButtonLabel,
} from "@/machines";
