/**
 * App State Hook
 *
 * Coordinates domain state (hamster, doors) with persistence and sync.
 * - Tab Leader: Which tab writes to IndexedDB (cross-tab sync)
 * - Server Leader: Which client pushes to server (cross-browser sync)
 */

import { useCallback, useEffect, useState } from "react";
import { useActorWatch } from "@effstate/react/v3";
import { useHamster, type HamsterSnapshot } from "./domains/useHamster";
import { useDoors, type DoorSnapshot } from "./domains/useDoors";
import { useLoroSync, dexieAdapter, isTabLeader } from "./persistence/usePersistenceCoordinator";

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

export interface UseAppStateOptions {
  initialSnapshots: InitialSnapshots | null;
  /** Called before any user action - use to auto-claim server leadership */
  onBeforeAction?: () => void;
}

export function useAppState(options: UseAppStateOptions) {
  const { initialSnapshots, onBeforeAction } = options;

  // Domain hooks
  const hamster = useHamster(initialSnapshots?.hamster ?? null);
  const doors = useDoors(initialSnapshots?.leftDoor ?? null, initialSnapshots?.rightDoor ?? null);

  // Persistence (cross-tab sync via Dexie)
  const { isTabLeader: isTabLeaderNow, applyExternal, getState } = useLoroSync({ hamster, doors });

  // Cross-domain effect: hamster powers doors
  useActorWatch(
    hamster.actor,
    (snap) => snap.context.electricityLevel > 0,
    doors.setPower
  );

  // Wrap actions to call onBeforeAction first (for auto-claiming server leadership)
  const toggleHamster = useCallback(() => {
    onBeforeAction?.();
    hamster.toggle();
  }, [onBeforeAction, hamster]);

  const clickDoor = useCallback((door: "left" | "right") => {
    onBeforeAction?.();
    doors.click(door);
  }, [onBeforeAction, doors]);

  return {
    hamster,
    doors,
    state: {
      hamster: { state: hamster.state, context: hamster.context },
      leftDoor: { state: doors.left.state, context: doors.left.context },
      rightDoor: { state: doors.right.state, context: doors.right.context },
    },
    /** Is this tab the leader for cross-tab sync (Dexie/IndexedDB)? */
    isTabLeader: isTabLeaderNow,
    toggleHamster,
    clickDoor,
    applyExternal,
    getState,
  };
}

// Re-export for convenience
export { isTabLeader };
export {
  getHamsterStateLabel,
  getHamsterButtonLabel,
  getDoorStateLabel,
  getDoorButtonLabel,
} from "@/machines";
