/**
 * Garage Door - Zustand Implementation
 *
 * Compare with v3: apps/demo-dexie-v3/src/machines/garage-door.ts
 */

import { create } from "zustand";

// ============================================================================
// Types (same as v3 for fair comparison)
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

  // Actions
  click: () => void;
  powerOn: () => void;
  powerOff: () => void;
  tick: (delta: number) => void;
  setWeather: (weather: Weather) => void;
}

// ============================================================================
// Store
// ============================================================================

export const useDoorStore = create<DoorStore>((set, get) => ({
  state: "closed",
  position: 0,
  isPowered: false,
  weather: { status: "idle" },

  click: () => {
    const { state, isPowered } = get();

    // State machine logic - manually encoded transitions
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
  },

  powerOn: () => {
    const { state } = get();
    set({ isPowered: true });

    // Resume from paused states
    if (state === "pausedOpening") set({ state: "opening" });
    if (state === "pausedClosing") set({ state: "closing" });
  },

  powerOff: () => {
    const { state } = get();
    set({ isPowered: false });

    // Pause if moving
    if (state === "opening") set({ state: "pausedOpening" });
    if (state === "closing") set({ state: "pausedClosing" });
  },

  tick: (delta: number) => {
    const { state, position } = get();

    if (state === "opening") {
      const newPos = Math.min(100, position + delta);
      if (newPos >= 100) {
        set({ position: 100, state: "open", weather: { status: "loading" } });
        // Trigger weather fetch
        fetchWeather().then((weather) => get().setWeather(weather));
      } else {
        set({ position: newPos });
      }
    }

    if (state === "closing") {
      const newPos = Math.max(0, position + delta);
      if (newPos <= 0) {
        set({ position: 0, state: "closed" });
      } else {
        set({ position: newPos });
      }
    }
  },

  setWeather: (weather: Weather) => set({ weather }),
}));

// ============================================================================
// Weather Fetch (same as v3)
// ============================================================================

async function fetchWeather(): Promise<Weather> {
  try {
    await new Promise((r) => setTimeout(r, 800));
    return {
      status: "loaded",
      temp: 72,
      desc: "Sunny",
      icon: "01d",
    };
  } catch {
    return { status: "error", message: "Failed to fetch" };
  }
}

// ============================================================================
// Helpers
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
