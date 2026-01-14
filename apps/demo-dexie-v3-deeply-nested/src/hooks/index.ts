/**
 * Hooks Index - Clean exports for the modular hook architecture
 *
 * Instead of one giant useAppState hook, we have:
 * - useHamster: Manages hamster state machine
 * - useDoor: Manages a single door state machine (reusable)
 * - usePersistenceCoordinator: Ties multiple hooks together for Dexie
 * - useInitialSnapshots: Loads persisted state on startup
 */

export { useHamster, type UseHamsterResult, type HamsterSnapshot } from "./useHamster";
export { useDoor, type UseDoorResult, type DoorSnapshot } from "./useDoor";
export { usePersistenceCoordinator, isLeader } from "./usePersistenceCoordinator";
export { useInitialSnapshots, type InitialSnapshots, type UseInitialSnapshotsResult } from "./useInitialSnapshots";

// Re-export the old hook for backwards compatibility (can be removed later)
export { useAppState, useInitialSnapshots as useInitialSnapshotsLegacy } from "./useAppState";
