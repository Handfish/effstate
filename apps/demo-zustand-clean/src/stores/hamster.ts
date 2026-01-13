/**
 * Hamster Wheel Store - Zustand
 *
 * States: Idle → Running → Stopping → Idle
 */

import { create } from "zustand";
import { isLeader } from "@/lib/db";

type HamsterState = "Idle" | "Running" | "Stopping";

// Reference to syncToDb - set by useAppState to avoid circular imports
let _syncToDb: (() => void) | null = null;
export function setSyncToDb(fn: () => void) {
  _syncToDb = fn;
}

interface HamsterStore {
  stateTag: HamsterState;
  wheelRotation: number;
  electricityLevel: number;
  _stopTimer: ReturnType<typeof setTimeout> | null;

  toggle: () => void;
  tick: (delta: number) => void;
  _setState: (state: Partial<HamsterStore>) => void;
  _completeStop: () => void;
}

export const useHamsterStore = create<HamsterStore>((set, get) => ({
  stateTag: "Idle",
  wheelRotation: 0,
  electricityLevel: 0,
  _stopTimer: null,

  toggle: () => {
    const { stateTag, _stopTimer } = get();

    switch (stateTag) {
      case "Idle":
        set({ stateTag: "Running", electricityLevel: 100 });
        break;
      case "Running":
        // Only leader manages timers
        if (isLeader()) {
          if (_stopTimer) clearTimeout(_stopTimer);
          const timer = setTimeout(() => get()._completeStop(), 2000);
          set({ stateTag: "Stopping", _stopTimer: timer });
        } else {
          set({ stateTag: "Stopping" });
        }
        break;
      case "Stopping":
        // Cancel stop, resume running
        if (isLeader() && _stopTimer) clearTimeout(_stopTimer);
        set({ stateTag: "Running", electricityLevel: 100, _stopTimer: null });
        break;
    }
  },

  _completeStop: () => {
    set({ stateTag: "Idle", electricityLevel: 0, _stopTimer: null });
    if (_syncToDb) _syncToDb();
  },

  tick: (delta: number) => {
    const { stateTag, wheelRotation } = get();
    if (stateTag === "Running") {
      set({ wheelRotation: (wheelRotation + delta) % 360 });
    }
  },

  _setState: (state: Partial<HamsterStore>) => {
    const { _stopTimer } = get();

    // If we're the leader and receiving "Stopping" state, start the timer
    if (isLeader() && state.stateTag === "Stopping" && !_stopTimer) {
      const timer = setTimeout(() => get()._completeStop(), 2000);
      set({ ...state, _stopTimer: timer });
    } else {
      set(state);
    }
  },
}));

// Helpers
export function getHamsterStateLabel(state: HamsterState): string {
  switch (state) {
    case "Idle": return "Resting";
    case "Running": return "Running!";
    case "Stopping": return "Slowing down...";
  }
}

export function getHamsterButtonLabel(state: HamsterState): string {
  switch (state) {
    case "Idle": return "Wake Up Hamster";
    case "Running": return "Stop Hamster";
    case "Stopping": return "Start Running Again";
  }
}
