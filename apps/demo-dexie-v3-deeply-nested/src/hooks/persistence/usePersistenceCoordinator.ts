/**
 * Persistence Coordinator
 *
 * Coordinates atomic persistence across all domain hooks.
 * Handles cross-tab sync via Dexie liveQuery.
 */

import { useCallback } from "react";
import { usePersistence } from "@effstate/react/v3";
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
import type { HamsterDomain } from "../domains/useHamster";
import type { DoorsDomain } from "../domains/useDoors";

// Singleton adapter
const dexieAdapter = createDexieAdapter();

export { dexieAdapter, isLeader };

export interface PersistenceOptions {
  hamster: HamsterDomain;
  doors: DoorsDomain;
}

export function usePersistenceCoordinator({ hamster, doors }: PersistenceOptions) {
  // Serialize all domains atomically
  const serialize = useCallback(
    (): SerializedAppState => ({
      hamster: serializeHamster(hamster.state, hamster.context),
      leftDoor: serializeDoor(doors.left.state, doors.left.context),
      rightDoor: serializeDoor(doors.right.state, doors.right.context),
    }),
    [hamster.state, hamster.context, doors.left.state, doors.left.context, doors.right.state, doors.right.context]
  );

  // Apply external state from other tabs
  const applyExternal = useCallback(
    (state: SerializedAppState) => {
      hamster.actor._syncSnapshot({
        state: deserializeHamsterState(state.hamster),
        context: deserializeHamsterContext(state.hamster),
      });
      doors.left.actor._syncSnapshot({
        state: deserializeDoorState(state.leftDoor),
        context: deserializeDoorContext(state.leftDoor),
      });
      doors.right.actor._syncSnapshot({
        state: deserializeDoorState(state.rightDoor),
        context: deserializeDoorContext(state.rightDoor),
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

  // Wire up persistence
  usePersistence({
    adapter: dexieAdapter,
    serialize,
    applyExternal,
    subscribeToActors,
  });

  // Cross-tab sync via liveQuery
  useDexieLiveQuery(dexieAdapter, applyExternal);

  return { isLeader: isLeader() };
}
