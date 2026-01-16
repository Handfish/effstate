/**
 * App State Hook (matches working demo pattern exactly)
 *
 * Uses Loro for storage format but same simple patterns
 * as demo-dexie-v3-deeply-nested.
 */

import { useEffect, useState } from "react";
import { useActorWatch } from "@effstate/react/v3";
import { useHamster, type HamsterSnapshot } from "./domains/useHamster";
import { useDoors, type DoorSnapshot } from "./domains/useDoors";
import { useLoroSync, dexieAdapter, isLeader } from "./persistence/usePersistenceCoordinator";

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
            hamster: saved.hamster,
            leftDoor: saved.leftDoor,
            rightDoor: saved.rightDoor,
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
  // Domain hooks
  const hamster = useHamster(snapshots?.hamster ?? null);
  const doors = useDoors(snapshots?.leftDoor ?? null, snapshots?.rightDoor ?? null);

  // Persistence (matches working demo pattern)
  const { isLeader: isLeaderNow, applyExternal, getState } = useLoroSync({ hamster, doors });

  // Cross-domain effect: hamster powers doors
  useActorWatch(
    hamster.actor,
    (snap) => snap.context.electricityLevel > 0,
    doors.setPower
  );

  return {
    hamster,
    doors,
    state: {
      hamster: { state: hamster.state, context: hamster.context },
      leftDoor: { state: doors.left.state, context: doors.left.context },
      rightDoor: { state: doors.right.state, context: doors.right.context },
    },
    isLeader: isLeaderNow,
    toggleHamster: hamster.toggle,
    clickDoor: doors.click,
    applyExternal,
    getState,
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
