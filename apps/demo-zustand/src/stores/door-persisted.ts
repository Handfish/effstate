/**
 * Garage Door - Zustand + Dexie + Leader Election
 *
 * THIS IS WHERE IT GETS COMPLICATED.
 *
 * Compare with v3: Just add { adapter: dexieAdapter } to useActor()
 */

import { create } from "zustand";
import { db, type DoorRecord, subscribeToLeadership } from "@/lib/db";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef } from "react";

// ============================================================================
// Types (same as before)
// ============================================================================

type DoorState =
  | "closed"
  | "opening"
  | "pausedOpening"
  | "open"
  | "closing"
  | "pausedClosing";

type Weather =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; temp: number; desc: string; icon: string }
  | { status: "error"; message: string };

interface DoorStore {
  // State
  state: DoorState;
  position: number;
  isPowered: boolean;
  weather: Weather;

  // Sync state
  _isInitialized: boolean;
  _isSyncing: boolean;

  // Actions
  click: () => void;
  setPower: (powered: boolean) => void;
  tick: (delta: number) => void;
  setWeather: (weather: Weather) => void;

  // Persistence
  _syncToDb: () => Promise<void>;
  _loadFromDb: () => Promise<void>;
  _applyDbRecord: (record: DoorRecord) => void;
}

// ============================================================================
// Store (now with persistence complexity)
// ============================================================================

const DOOR_ID = "main-door";

export const useDoorStore = create<DoorStore>((set, get) => ({
  state: "closed",
  position: 0,
  isPowered: false,
  weather: { status: "idle" },
  _isInitialized: false,
  _isSyncing: false,

  click: () => {
    const { state, isPowered, _isSyncing } = get();
    if (_isSyncing) return; // Prevent actions during sync

    switch (state) {
      case "closed":
        if (isPowered) set({ state: "opening" });
        break;
      case "opening":
        set({ state: "pausedOpening" });
        break;
      case "pausedOpening":
        if (isPowered) set({ state: "closing" });
        break;
      case "open":
        if (isPowered) set({ state: "closing", weather: { status: "idle" } });
        break;
      case "closing":
        set({ state: "pausedClosing" });
        break;
      case "pausedClosing":
        if (isPowered) set({ state: "opening" });
        break;
    }

    // Persist after state change
    get()._syncToDb();
  },

  setPower: (powered: boolean) => {
    const { state, isPowered } = get();
    if (powered === isPowered) return;

    set({ isPowered: powered });

    if (powered) {
      // Resume from paused states
      if (state === "pausedOpening") set({ state: "opening" });
      if (state === "pausedClosing") set({ state: "closing" });
    } else {
      // Pause if moving
      if (state === "opening") set({ state: "pausedOpening" });
      if (state === "closing") set({ state: "pausedClosing" });
    }
    get()._syncToDb();
  },

  tick: (delta: number) => {
    const { state, position, _isSyncing } = get();
    if (_isSyncing) return;

    if (state === "opening") {
      const newPos = Math.min(100, position + delta);
      if (newPos >= 100) {
        set({ position: 100, state: "open", weather: { status: "loading" } });
        fetchWeather().then((weather) => {
          get().setWeather(weather);
        });
      } else {
        set({ position: newPos });
      }
      // Only persist occasionally during animation (throttle)
      if (Math.floor(newPos) % 10 === 0) {
        get()._syncToDb();
      }
    }

    if (state === "closing") {
      const newPos = Math.max(0, position + delta);
      if (newPos <= 0) {
        set({ position: 0, state: "closed" });
      } else {
        set({ position: newPos });
      }
      if (Math.floor(newPos) % 10 === 0) {
        get()._syncToDb();
      }
    }
  },

  setWeather: (weather: Weather) => {
    set({ weather });
    get()._syncToDb();
  },

  // ============================================================================
  // Persistence Methods (THE COMPLEX PART)
  // ============================================================================

  _syncToDb: async () => {
    const { state, position, isPowered, weather } = get();

    try {
      await db.doors.put({
        id: DOOR_ID,
        state,
        position,
        isPowered,
        weather: JSON.stringify(weather),
        updatedAt: Date.now(),
      });
    } catch (e) {
      console.error("Failed to sync door to DB:", e);
    }
  },

  _loadFromDb: async () => {
    try {
      const record = await db.doors.get(DOOR_ID);
      if (record) {
        get()._applyDbRecord(record);
      }
      set({ _isInitialized: true });
    } catch (e) {
      console.error("Failed to load door from DB:", e);
      set({ _isInitialized: true });
    }
  },

  _applyDbRecord: (record: DoorRecord) => {
    set({
      _isSyncing: true,
      state: record.state as DoorState,
      position: record.position,
      isPowered: record.isPowered,
      weather: JSON.parse(record.weather) as Weather,
    });
    // Allow actions again after a tick
    setTimeout(() => set({ _isSyncing: false }), 0);
  },
}));

// ============================================================================
// Weather Fetch
// ============================================================================

async function fetchWeather(): Promise<Weather> {
  try {
    await new Promise((r) => setTimeout(r, 800));
    return { status: "loaded", temp: 72, desc: "Sunny", icon: "01d" };
  } catch {
    return { status: "error", message: "Failed to fetch" };
  }
}

// ============================================================================
// Hook for Dexie Live Sync + Leader-aware Animation
// ============================================================================

export function useDoorWithPersistence() {
  const store = useDoorStore();
  const animationRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isLeaderRef = useRef(false);

  // Live query for cross-tab sync
  const dbRecord = useLiveQuery(() => db.doors.get(DOOR_ID), []);

  // Initial load
  useEffect(() => {
    store._loadFromDb();
  }, []);

  // Sync from DB when other tabs update
  useEffect(() => {
    if (dbRecord && store._isInitialized) {
      // Only apply if this is an external update (not our own)
      const currentState = useDoorStore.getState();
      if (dbRecord.updatedAt > Date.now() - 100) {
        // Recent update, might be ours - check if different
        if (
          dbRecord.state !== currentState.state ||
          Math.abs(dbRecord.position - currentState.position) > 5
        ) {
          store._applyDbRecord(dbRecord);
        }
      }
    }
  }, [dbRecord]);

  // Leader-aware animation loop
  useEffect(() => {
    const unsubscribe = subscribeToLeadership((isLeader) => {
      isLeaderRef.current = isLeader;

      // Start/stop animation based on leadership
      if (isLeader && !animationRef.current) {
        animationRef.current = setInterval(() => {
          const state = useDoorStore.getState().state;
          if (state === "opening" || state === "closing") {
            const delta = state === "opening" ? 0.16 : -0.16;
            useDoorStore.getState().tick(delta);
          }
        }, 16);
      } else if (!isLeader && animationRef.current) {
        clearInterval(animationRef.current);
        animationRef.current = null;
      }
    });

    return () => {
      unsubscribe();
      if (animationRef.current) {
        clearInterval(animationRef.current);
      }
    };
  }, []);

  // Also check state changes to start/stop animation
  useEffect(() => {
    const state = store.state;
    const isAnimating = state === "opening" || state === "closing";

    if (isLeaderRef.current && isAnimating && !animationRef.current) {
      animationRef.current = setInterval(() => {
        const currentState = useDoorStore.getState().state;
        if (currentState === "opening" || currentState === "closing") {
          const delta = currentState === "opening" ? 0.16 : -0.16;
          useDoorStore.getState().tick(delta);
        }
      }, 16);
    } else if (!isAnimating && animationRef.current) {
      clearInterval(animationRef.current);
      animationRef.current = null;
    }
  }, [store.state]);

  return store;
}

// ============================================================================
// Helpers (same as before)
// ============================================================================

export function getDoorStateLabel(state: DoorState): string {
  switch (state) {
    case "closed": return "Closed";
    case "opening": return "Opening...";
    case "pausedOpening": return "Paused (Opening)";
    case "open": return "Open";
    case "closing": return "Closing...";
    case "pausedClosing": return "Paused (Closing)";
  }
}

export function getDoorButtonLabel(state: DoorState): string {
  switch (state) {
    case "closed": return "Open";
    case "opening": return "Pause";
    case "pausedOpening": return "Close";
    case "open": return "Close";
    case "closing": return "Pause";
    case "pausedClosing": return "Open";
  }
}
