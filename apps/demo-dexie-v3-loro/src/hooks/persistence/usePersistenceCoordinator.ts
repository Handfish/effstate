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
  isLeader,
} from "@/lib/dexie-adapter";
import type { AppStateSnapshot } from "@/lib/db";
import type { HamsterDomain } from "../domains/useHamster";
import type { DoorsDomain } from "../domains/useDoors";

// Singleton adapter (same as working demo)
const dexieAdapter = createDexieAdapter();

export { dexieAdapter, isLeader };

export interface PersistenceOptions {
  hamster: HamsterDomain;
  doors: DoorsDomain;
}

export function useLoroSync({ hamster, doors }: PersistenceOptions) {
  // Serialize all domains
  const serialize = useCallback(
    (): AppStateSnapshot => ({
      hamster: { state: hamster.state, context: hamster.context },
      leftDoor: { state: doors.left.state, context: doors.left.context },
      rightDoor: { state: doors.right.state, context: doors.right.context },
    }),
    [
      hamster.state,
      hamster.context,
      doors.left.state,
      doors.left.context,
      doors.right.state,
      doors.right.context,
    ]
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

  return { isLeader: isLeader() };
}
