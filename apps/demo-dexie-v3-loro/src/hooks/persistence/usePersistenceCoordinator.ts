/**
 * Persistence Coordinator (matches working demo pattern exactly)
 *
 * Uses usePersistence hook (with built-in 100ms throttling)
 * and Loro snapshots for storage format.
 */

import { useCallback } from "react";
import { usePersistence } from "@effstate/react/v3";
import {
  createDexieAdapter,
  useDexieLiveQuery,
  isTabLeader,
} from "@/lib/dexie-adapter";
import type { AppStateSnapshot } from "@/lib/db";
import type { HamsterDomain } from "../domains/useHamster";
import type { DoorsDomain } from "../domains/useDoors";

// Singleton adapter (same as working demo)
const dexieAdapter = createDexieAdapter();

export { dexieAdapter, isTabLeader };

export interface PersistenceOptions {
  hamster: HamsterDomain;
  doors: DoorsDomain;
}

export function useLoroSync({ hamster, doors }: PersistenceOptions) {
  // Serialize all domains - read from actors directly to get current state
  const serialize = useCallback(
    (): AppStateSnapshot => {
      const hamsterSnap = hamster.actor.getSnapshot();
      const leftDoorSnap = doors.left.actor.getSnapshot();
      const rightDoorSnap = doors.right.actor.getSnapshot();
      return {
        hamster: { state: hamsterSnap.state, context: hamsterSnap.context },
        leftDoor: { state: leftDoorSnap.state, context: leftDoorSnap.context },
        rightDoor: { state: rightDoorSnap.state, context: rightDoorSnap.context },
      };
    },
    [hamster.actor, doors.left.actor, doors.right.actor]
  );

  // Apply external state
  const applyExternal = useCallback(
    (state: AppStateSnapshot) => {
      hamster.actor._syncSnapshot({
        state: state.hamster.state,
        context: state.hamster.context,
      });
      doors.left.actor._syncSnapshot({
        state: state.leftDoor.state,
        context: state.leftDoor.context,
      });
      doors.right.actor._syncSnapshot({
        state: state.rightDoor.state,
        context: state.rightDoor.context,
      });
    },
    [hamster.actor, doors.left.actor, doors.right.actor]
  );

  // Subscribe to all actors
  const subscribeToActors = useCallback(
    (callback: () => void) => {
      const unsubs = [
        hamster.actor.subscribe(callback),
        doors.left.actor.subscribe(callback),
        doors.right.actor.subscribe(callback),
      ];
      return () => unsubs.forEach((u) => u());
    },
    [hamster.actor, doors.left.actor, doors.right.actor]
  );

  // Wire up persistence (has 100ms throttling built in)
  usePersistence({
    adapter: dexieAdapter,
    serialize,
    applyExternal,
    subscribeToActors,
  });

  // Cross-tab sync via liveQuery (same pattern as working demo)
  useDexieLiveQuery(dexieAdapter, applyExternal);

  return { isTabLeader: isTabLeader(), applyExternal, getState: serialize };
}
