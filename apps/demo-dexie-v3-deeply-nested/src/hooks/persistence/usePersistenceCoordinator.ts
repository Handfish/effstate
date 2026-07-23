/**
 * Persistence Coordinator
 *
 * Coordinates atomic persistence across all domain hooks.
 * Uses Effect.Schema codecs for encode/decode.
 */

import { useCallback } from "react";
import { usePersistence } from "@effstate/react/v3";
import { HamsterCodec, DoorCodec } from "@/lib/db";
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
  // Serialize all domains atomically using Schema codecs
  const serialize = useCallback(
    (): SerializedAppState => ({
      hamster: HamsterCodec.encode(hamster.state, hamster.context),
      leftDoor: DoorCodec.encode(doors.left.state, doors.left.context),
      rightDoor: DoorCodec.encode(doors.right.state, doors.right.context),
    }),
    [hamster.state, hamster.context, doors.left.state, doors.left.context, doors.right.state, doors.right.context]
  );

  // Apply external state using Schema codecs
  const applyExternal = useCallback(
    (state: SerializedAppState) => {
      const h = HamsterCodec.decode(state.hamster);
      const l = DoorCodec.decode(state.leftDoor);
      const r = DoorCodec.decode(state.rightDoor);

      hamster.actor._syncSnapshot({ state: h.state, context: h.context });
      doors.left.actor._syncSnapshot({ state: l.state, context: l.context });
      doors.right.actor._syncSnapshot({ state: r.state, context: r.context });
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
