/**
 * Persistence Coordinator Hook
 *
 * Coordinates persistence between multiple independent hooks:
 * - useHamster
 * - useDoor (left)
 * - useDoor (right)
 *
 * This pattern keeps each domain hook simple while still
 * achieving atomic persistence to Dexie.
 */

import { useCallback, useEffect, useRef } from "react";
import { usePersistence } from "@effstate/react/v3";
import {
  createDexieAdapter,
  useDexieLiveQuery,
  isLeader,
  type SerializedAppState,
} from "@/lib/dexie-adapter";
import type { UseHamsterResult } from "./useHamster";
import type { UseDoorResult } from "./useDoor";

// ============================================================================
// Types
// ============================================================================

export interface PersistenceCoordinatorOptions {
  hamster: UseHamsterResult;
  leftDoor: UseDoorResult;
  rightDoor: UseDoorResult;
}

// ============================================================================
// Adapter (module level singleton)
// ============================================================================

const dexieAdapter = createDexieAdapter();

// Re-export for initial load
export { dexieAdapter, isLeader };

// ============================================================================
// Hook
// ============================================================================

export function usePersistenceCoordinator({
  hamster,
  leftDoor,
  rightDoor,
}: PersistenceCoordinatorOptions) {
  // Track latest references for callbacks
  const hooksRef = useRef({ hamster, leftDoor, rightDoor });
  hooksRef.current = { hamster, leftDoor, rightDoor };

  // Serialize all state atomically
  const serialize = useCallback((): SerializedAppState => ({
    hamster: hooksRef.current.hamster.serialize(),
    leftDoor: hooksRef.current.leftDoor.serialize(),
    rightDoor: hooksRef.current.rightDoor.serialize(),
  }), []);

  // Apply external state (for cross-tab sync)
  const applyExternal = useCallback((state: SerializedAppState) => {
    hooksRef.current.hamster.applyExternal(state.hamster);
    hooksRef.current.leftDoor.applyExternal(state.leftDoor);
    hooksRef.current.rightDoor.applyExternal(state.rightDoor);
  }, []);

  // Subscribe to all actor changes
  const subscribeToActors = useCallback((callback: () => void) => {
    const unsubs = [
      hooksRef.current.hamster.subscribe(callback),
      hooksRef.current.leftDoor.subscribe(callback),
      hooksRef.current.rightDoor.subscribe(callback),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  // Wire up persistence
  usePersistence({
    adapter: dexieAdapter,
    serialize,
    applyExternal,
    subscribeToActors,
  });

  // Connect Dexie liveQuery for cross-tab sync
  useDexieLiveQuery(dexieAdapter, applyExternal);

  // Sync power from hamster to doors
  const prevPoweredRef = useRef(hamster.isPowered);
  useEffect(() => {
    if (hamster.isPowered !== prevPoweredRef.current) {
      prevPoweredRef.current = hamster.isPowered;
      leftDoor.setPower(hamster.isPowered);
      rightDoor.setPower(hamster.isPowered);
    }
  }, [hamster.isPowered, leftDoor, rightDoor]);

  return {
    isLeader: isLeader(),
  };
}
