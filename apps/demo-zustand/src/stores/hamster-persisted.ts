/**
 * Hamster Wheel - Zustand + Dexie + Leader Election
 *
 * More complexity explosion.
 */

import { create } from "zustand";
import { db, type HamsterRecord, getIsLeader, subscribeToLeadership } from "@/lib/db";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef } from "react";

// ============================================================================
// Types
// ============================================================================

type HamsterState = "idle" | "running" | "stopping";

interface HamsterStore {
  state: HamsterState;
  wheelRotation: number;
  electricityLevel: number;

  _isInitialized: boolean;
  _isSyncing: boolean;
  _stopTimer: ReturnType<typeof setTimeout> | null;

  toggle: () => void;
  tick: (delta: number) => void;
  _completeStop: () => void;
  _syncToDb: () => Promise<void>;
  _loadFromDb: () => Promise<void>;
  _applyDbRecord: (record: HamsterRecord) => void;
}

// ============================================================================
// Store
// ============================================================================

const HAMSTER_ID = "main-hamster";

export const useHamsterStore = create<HamsterStore>((set, get) => ({
  state: "idle",
  wheelRotation: 0,
  electricityLevel: 0,
  _isInitialized: false,
  _isSyncing: false,
  _stopTimer: null,

  toggle: () => {
    const { state, _stopTimer, _isSyncing } = get();
    if (_isSyncing) return;

    // Only the leader should manage timers!
    const isLeader = getIsLeader();

    switch (state) {
      case "idle":
        set({ state: "running", electricityLevel: 100 });
        break;

      case "running":
        if (isLeader) {
          if (_stopTimer) clearTimeout(_stopTimer);
          const timer = setTimeout(() => get()._completeStop(), 2000);
          set({ state: "stopping", _stopTimer: timer });
        } else {
          // Non-leader just updates state, leader will handle timer
          set({ state: "stopping" });
        }
        break;

      case "stopping":
        if (isLeader && _stopTimer) {
          clearTimeout(_stopTimer);
        }
        set({ state: "running", electricityLevel: 100, _stopTimer: null });
        break;
    }

    get()._syncToDb();
  },

  tick: (delta: number) => {
    const { state, wheelRotation, _isSyncing } = get();
    if (_isSyncing) return;

    if (state === "running") {
      const newRotation = (wheelRotation + delta) % 360;
      set({ wheelRotation: newRotation });

      // Throttle persistence
      if (Math.floor(newRotation) % 30 === 0) {
        get()._syncToDb();
      }
    }
  },

  _completeStop: () => {
    set({ state: "idle", electricityLevel: 0, _stopTimer: null });
    get()._syncToDb();
  },

  _syncToDb: async () => {
    const { state, wheelRotation, electricityLevel } = get();
    try {
      await db.hamsters.put({
        id: HAMSTER_ID,
        state,
        wheelRotation,
        electricityLevel,
        updatedAt: Date.now(),
      });
    } catch (e) {
      console.error("Failed to sync hamster to DB:", e);
    }
  },

  _loadFromDb: async () => {
    try {
      const record = await db.hamsters.get(HAMSTER_ID);
      if (record) {
        get()._applyDbRecord(record);
      }
      set({ _isInitialized: true });
    } catch (e) {
      console.error("Failed to load hamster from DB:", e);
      set({ _isInitialized: true });
    }
  },

  _applyDbRecord: (record: HamsterRecord) => {
    const isLeader = getIsLeader();
    const { _stopTimer } = get();

    set({
      _isSyncing: true,
      state: record.state as HamsterState,
      wheelRotation: record.wheelRotation,
      electricityLevel: record.electricityLevel,
    });

    // If we're the leader and state is "stopping", we need to manage the timer
    if (isLeader && record.state === "stopping" && !_stopTimer) {
      const timer = setTimeout(() => get()._completeStop(), 2000);
      set({ _stopTimer: timer });
    }

    setTimeout(() => set({ _isSyncing: false }), 0);
  },
}));

// ============================================================================
// Hook for Persistence + Leader-aware Animation
// ============================================================================

export function useHamsterWithPersistence() {
  const store = useHamsterStore();
  const animationRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isLeaderRef = useRef(false);

  // Live query for cross-tab sync
  const dbRecord = useLiveQuery(() => db.hamsters.get(HAMSTER_ID), []);

  // Initial load
  useEffect(() => {
    store._loadFromDb();
  }, []);

  // Sync from DB
  useEffect(() => {
    if (dbRecord && store._isInitialized) {
      const currentState = useHamsterStore.getState();
      if (
        dbRecord.state !== currentState.state ||
        Math.abs(dbRecord.wheelRotation - currentState.wheelRotation) > 10
      ) {
        store._applyDbRecord(dbRecord);
      }
    }
  }, [dbRecord]);

  // Leader-aware animation
  useEffect(() => {
    const unsubscribe = subscribeToLeadership((isLeader) => {
      isLeaderRef.current = isLeader;

      if (isLeader && !animationRef.current) {
        animationRef.current = setInterval(() => {
          const state = useHamsterStore.getState().state;
          if (state === "running") {
            useHamsterStore.getState().tick(5);
          }
        }, 16);
      } else if (!isLeader && animationRef.current) {
        clearInterval(animationRef.current);
        animationRef.current = null;
      }
    });

    return () => {
      unsubscribe();
      if (animationRef.current) clearInterval(animationRef.current);
    };
  }, []);

  // State-based animation control
  useEffect(() => {
    const isRunning = store.state === "running";

    if (isLeaderRef.current && isRunning && !animationRef.current) {
      animationRef.current = setInterval(() => {
        const state = useHamsterStore.getState().state;
        if (state === "running") {
          useHamsterStore.getState().tick(5);
        }
      }, 16);
    } else if (!isRunning && animationRef.current) {
      clearInterval(animationRef.current);
      animationRef.current = null;
    }
  }, [store.state]);

  return store;
}

// ============================================================================
// Helpers
// ============================================================================

export function getHamsterStateLabel(state: HamsterState): string {
  switch (state) {
    case "idle": return "Resting";
    case "running": return "Running!";
    case "stopping": return "Slowing down...";
  }
}

export function getHamsterButtonLabel(state: HamsterState): string {
  switch (state) {
    case "idle": return "Wake Up Hamster";
    case "running": return "Stop Hamster";
    case "stopping": return "Start Running Again";
  }
}
