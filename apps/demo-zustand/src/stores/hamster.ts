/**
 * Hamster Wheel - Zustand Implementation
 *
 * Compare with v3: apps/demo-dexie-v3/src/machines/hamster-wheel.ts
 */

import { create } from "zustand";

// ============================================================================
// Types
// ============================================================================

type HamsterState = "idle" | "running" | "stopping";

interface HamsterStore {
  // State
  state: HamsterState;
  wheelRotation: number;
  electricityLevel: number;
  startedAt: Date | null;
  stoppingAt: Date | null;

  // Internal
  _stopTimer: ReturnType<typeof setTimeout> | null;

  // Actions
  toggle: () => void;
  tick: (delta: number) => void;
  _completeStop: () => void;
}

// ============================================================================
// Store
// ============================================================================

export const useHamsterStore = create<HamsterStore>((set, get) => ({
  state: "idle",
  wheelRotation: 0,
  electricityLevel: 0,
  startedAt: null,
  stoppingAt: null,
  _stopTimer: null,

  toggle: () => {
    const { state, _stopTimer } = get();

    switch (state) {
      case "idle":
        set({
          state: "running",
          electricityLevel: 100,
          startedAt: new Date(),
        });
        break;

      case "running":
        // Clear any existing timer
        if (_stopTimer) clearTimeout(_stopTimer);
        // Start 2-second stop delay
        const timer = setTimeout(() => get()._completeStop(), 2000);
        set({
          state: "stopping",
          stoppingAt: new Date(),
          _stopTimer: timer,
        });
        break;

      case "stopping":
        // Cancel stop, resume running
        if (_stopTimer) clearTimeout(_stopTimer);
        set({
          state: "running",
          electricityLevel: 100,
          startedAt: new Date(),
          _stopTimer: null,
        });
        break;
    }
  },

  tick: (delta: number) => {
    const { state, wheelRotation } = get();
    if (state === "running") {
      set({ wheelRotation: (wheelRotation + delta) % 360 });
    }
  },

  _completeStop: () => {
    set({
      state: "idle",
      electricityLevel: 0,
      _stopTimer: null,
    });
  },
}));

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
