/**
 * App State Hook - Zustand + Dexie + Leader Election
 *
 * Pattern from working demo-zustand:
 * 1. Each store has _isInitialized flag
 * 2. Cross-tab sync checks if data is DIFFERENT before applying
 * 3. Explicit saves (not subscription-based) to avoid race conditions
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, STATE_ID, isLeader, subscribeToLeadership, type AppState } from "@/lib/db";
import { useHamsterStore, setSyncToDb } from "./hamster";
import { createDoorStore, type Weather } from "./door";

// Create door stores at module level
const useLeftDoorStore = createDoorStore();
const useRightDoorStore = createDoorStore();

// Wire up syncToDb for hamster timer callback (after syncToDb is defined below)
let _syncWired = false;

// ============================================================================
// Persistence State
// ============================================================================

let _isInitialized = false;
let _isSyncing = false;

// ============================================================================
// Persistence Helpers
// ============================================================================

function serializeState(): Omit<AppState, "id" | "updatedAt"> {
  const hamster = useHamsterStore.getState();
  const leftDoor = useLeftDoorStore.getState();
  const rightDoor = useRightDoorStore.getState();

  return {
    hamster: {
      stateTag: hamster.stateTag,
      wheelRotation: hamster.wheelRotation,
      electricityLevel: hamster.electricityLevel,
    },
    leftDoor: {
      stateTag: leftDoor.stateTag,
      position: leftDoor.position,
      isPowered: leftDoor.isPowered,
      weather: leftDoor.weather,
    },
    rightDoor: {
      stateTag: rightDoor.stateTag,
      position: rightDoor.position,
      isPowered: rightDoor.isPowered,
      weather: rightDoor.weather,
    },
  };
}

// Explicit save - call after actions (like original demo-zustand)
export function syncToDb() {
  if (_isSyncing) return;

  db.appState.put({
    id: STATE_ID,
    ...serializeState(),
    updatedAt: Date.now(),
  });
}

// Wire up hamster's syncToDb callback
if (!_syncWired) {
  _syncWired = true;
  setSyncToDb(syncToDb);
}

async function loadFromDb(): Promise<AppState | undefined> {
  return db.appState.get(STATE_ID);
}

function applyDbState(saved: AppState) {
  _isSyncing = true;

  useHamsterStore.getState()._setState({
    stateTag: saved.hamster.stateTag as "Idle" | "Running" | "Stopping",
    wheelRotation: saved.hamster.wheelRotation,
    electricityLevel: saved.hamster.electricityLevel,
  });
  useLeftDoorStore.getState()._setState({
    stateTag: saved.leftDoor.stateTag as "Closed" | "Opening" | "Open" | "Closing" | "PausedOpening" | "PausedClosing",
    position: saved.leftDoor.position,
    isPowered: saved.leftDoor.isPowered,
    weather: saved.leftDoor.weather as Weather,
  });
  useRightDoorStore.getState()._setState({
    stateTag: saved.rightDoor.stateTag as "Closed" | "Opening" | "Open" | "Closing" | "PausedOpening" | "PausedClosing",
    position: saved.rightDoor.position,
    isPowered: saved.rightDoor.isPowered,
    weather: saved.rightDoor.weather as Weather,
  });

  // Ensure door power state matches hamster electricity after sync
  const hasPower = saved.hamster.electricityLevel > 0;
  useLeftDoorStore.getState().setPower(hasPower);
  useRightDoorStore.getState().setPower(hasPower);

  setTimeout(() => { _isSyncing = false; }, 0);
}

// Check if DB state is different from current (like original demo-zustand)
function isDbStateDifferent(dbState: AppState): boolean {
  const hamster = useHamsterStore.getState();
  const leftDoor = useLeftDoorStore.getState();
  const rightDoor = useRightDoorStore.getState();

  return (
    dbState.hamster.stateTag !== hamster.stateTag ||
    Math.abs(dbState.hamster.wheelRotation - hamster.wheelRotation) > 10 ||
    dbState.hamster.electricityLevel !== hamster.electricityLevel ||
    dbState.leftDoor.stateTag !== leftDoor.stateTag ||
    Math.abs(dbState.leftDoor.position - leftDoor.position) > 5 ||
    dbState.rightDoor.stateTag !== rightDoor.stateTag ||
    Math.abs(dbState.rightDoor.position - rightDoor.position) > 5
  );
}

// ============================================================================
// Main Hook
// ============================================================================

export function useAppState() {
  const [loaded, setLoaded] = useState(false);
  const animationRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPowerRef = useRef<boolean | null>(null);

  // Get store states
  const hamster = useHamsterStore();
  const leftDoor = useLeftDoorStore();
  const rightDoor = useRightDoorStore();

  // Live query for cross-tab sync
  const dbState = useLiveQuery(() => db.appState.get(STATE_ID), []);

  // Initial load
  useEffect(() => {
    loadFromDb().then((saved) => {
      if (saved) {
        applyDbState(saved);
      }
      _isInitialized = true;
      setLoaded(true);
    });
  }, []);

  // Cross-tab sync - only apply if DIFFERENT (key fix from original)
  useEffect(() => {
    if (!_isInitialized || !dbState) return;

    // Check if actually different before applying
    if (isDbStateDifferent(dbState)) {
      applyDbState(dbState);
    }
  }, [dbState]);

  // Power sync: hamster → doors
  useEffect(() => {
    if (!loaded) return;
    const hasPower = hamster.electricityLevel > 0;
    if (lastPowerRef.current !== hasPower) {
      lastPowerRef.current = hasPower;
      useLeftDoorStore.getState().setPower(hasPower);
      useRightDoorStore.getState().setPower(hasPower);
    }
  }, [loaded, hamster.electricityLevel]);

  // Leadership-aware animation loop
  useEffect(() => {
    if (!loaded) return;

    const isLeaderRef = { current: isLeader() };

    const runAnimation = () => {
      if (!isLeaderRef.current) return;

      const hamsterState = useHamsterStore.getState();
      const leftState = useLeftDoorStore.getState();
      const rightState = useRightDoorStore.getState();

      if (hamsterState.stateTag === "Running") {
        hamsterState.tick(5);
        if (Math.floor(hamsterState.wheelRotation) % 30 === 0) {
          syncToDb();
        }
      }

      if (leftState.stateTag === "Opening" || leftState.stateTag === "Closing") {
        leftState.tick(leftState.stateTag === "Opening" ? 0.16 : -0.16);
        if (Math.floor(leftState.position) % 10 === 0) {
          syncToDb();
        }
      }
      if (rightState.stateTag === "Opening" || rightState.stateTag === "Closing") {
        rightState.tick(rightState.stateTag === "Opening" ? 0.16 : -0.16);
        if (Math.floor(rightState.position) % 10 === 0) {
          syncToDb();
        }
      }
    };

    // Subscribe to leadership changes
    const unsubscribe = subscribeToLeadership((newIsLeader) => {
      isLeaderRef.current = newIsLeader;

      if (newIsLeader) {
        // Became leader - check if hamster needs timer started
        const hamsterState = useHamsterStore.getState();
        if (hamsterState.stateTag === "Stopping" && !hamsterState._stopTimer) {
          const timer = setTimeout(() => {
            useHamsterStore.getState()._completeStop();
          }, 2000);
          useHamsterStore.setState({ _stopTimer: timer });
        }

        // Start animation if not already running
        if (!animationRef.current) {
          animationRef.current = setInterval(runAnimation, 16);
        }
      } else {
        // Lost leadership - stop animation
        if (animationRef.current) {
          clearInterval(animationRef.current);
          animationRef.current = null;
        }
      }
    });

    return () => {
      unsubscribe();
      if (animationRef.current) {
        clearInterval(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [loaded]);

  // Actions with explicit saves
  const toggleHamster = useCallback(() => {
    useHamsterStore.getState().toggle();
    syncToDb();
  }, []);

  const clickDoor = useCallback((door: "left" | "right") => {
    (door === "left" ? useLeftDoorStore : useRightDoorStore).getState().click();
    syncToDb();
  }, []);

  return {
    loaded,
    state: {
      hamster: { stateTag: hamster.stateTag, wheelRotation: hamster.wheelRotation, electricityLevel: hamster.electricityLevel },
      leftDoor: { stateTag: leftDoor.stateTag, position: leftDoor.position, isPowered: leftDoor.isPowered, weather: leftDoor.weather },
      rightDoor: { stateTag: rightDoor.stateTag, position: rightDoor.position, isPowered: rightDoor.isPowered, weather: rightDoor.weather },
    },
    toggleHamster,
    clickDoor,
  };
}
