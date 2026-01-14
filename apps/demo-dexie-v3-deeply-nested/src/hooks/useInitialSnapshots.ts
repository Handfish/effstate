/**
 * Initial Snapshots Hook - Loads persisted state from Dexie
 *
 * This hook handles the async loading of state from IndexedDB
 * before any actors are created. This prevents state loss on refresh.
 */

import { useEffect, useState } from "react";
import {
  deserializeHamsterState,
  deserializeHamsterContext,
  deserializeDoorState,
  deserializeDoorContext,
} from "@/lib/db";
import { dexieAdapter } from "./usePersistenceCoordinator";
import type { HamsterSnapshot } from "./useHamster";
import type { DoorSnapshot } from "./useDoor";

// ============================================================================
// Types
// ============================================================================

export interface InitialSnapshots {
  hamster: HamsterSnapshot;
  leftDoor: DoorSnapshot;
  rightDoor: DoorSnapshot;
}

export interface UseInitialSnapshotsResult {
  loaded: boolean;
  snapshots: InitialSnapshots | null;
}

// ============================================================================
// Hook
// ============================================================================

export function useInitialSnapshots(): UseInitialSnapshotsResult {
  const [result, setResult] = useState<UseInitialSnapshotsResult>({
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
