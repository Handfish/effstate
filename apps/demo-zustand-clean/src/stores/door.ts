/**
 * Garage Door Store - Zustand
 *
 * States: Closed → Opening → Open → Closing → Closed
 *         (with PausedOpening/PausedClosing)
 */

import { create, type StoreApi, type UseBoundStore } from "zustand";

export type DoorState = "Closed" | "Opening" | "PausedOpening" | "Open" | "Closing" | "PausedClosing";

export type Weather =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; temp: number; desc: string; icon: string }
  | { status: "error"; message: string };

interface DoorStore {
  stateTag: DoorState;
  position: number;
  isPowered: boolean;
  weather: Weather;

  click: () => void;
  setPower: (powered: boolean) => void;
  tick: (delta: number) => void;
  setWeather: (weather: Weather) => void;
  _setState: (state: Partial<DoorStore>) => void;
}

export function createDoorStore(): UseBoundStore<StoreApi<DoorStore>> {
  return create<DoorStore>((set, get) => ({
    stateTag: "Closed",
    position: 0,
    isPowered: false,
    weather: { status: "idle" },

    click: () => {
      const { stateTag, isPowered } = get();

      switch (stateTag) {
        case "Closed":
          if (isPowered) set({ stateTag: "Opening" });
          break;
        case "Opening":
          set({ stateTag: "PausedOpening" });
          break;
        case "PausedOpening":
          if (isPowered) set({ stateTag: "Closing" });
          break;
        case "Open":
          if (isPowered) set({ stateTag: "Closing", weather: { status: "idle" } });
          break;
        case "Closing":
          set({ stateTag: "PausedClosing" });
          break;
        case "PausedClosing":
          if (isPowered) set({ stateTag: "Opening" });
          break;
      }
    },

    setPower: (powered: boolean) => {
      const { stateTag, isPowered } = get();
      if (powered === isPowered) return;

      set({ isPowered: powered });

      if (powered) {
        // Resume from paused
        if (stateTag === "PausedOpening") set({ stateTag: "Opening" });
        if (stateTag === "PausedClosing") set({ stateTag: "Closing" });
      } else {
        // Pause if moving
        if (stateTag === "Opening") set({ stateTag: "PausedOpening" });
        if (stateTag === "Closing") set({ stateTag: "PausedClosing" });
      }
    },

    tick: (delta: number) => {
      const { stateTag, position } = get();

      if (stateTag === "Opening") {
        const newPos = Math.min(100, position + delta);
        if (newPos >= 100) {
          set({ position: 100, stateTag: "Open", weather: { status: "loading" } });
          // Fetch weather
          fetchWeather().then((weather) => get().setWeather(weather));
        } else {
          set({ position: newPos });
        }
      }

      if (stateTag === "Closing") {
        const newPos = Math.max(0, position + delta);
        if (newPos <= 0) {
          set({ position: 0, stateTag: "Closed" });
        } else {
          set({ position: newPos });
        }
      }
    },

    setWeather: (weather: Weather) => set({ weather }),
    _setState: (state: Partial<DoorStore>) => set(state),
  }));
}

// Weather fetch (simulated)
async function fetchWeather(): Promise<Weather> {
  await new Promise((r) => setTimeout(r, 800));
  return { status: "loaded", temp: 72, desc: "Sunny", icon: "01d" };
}

// Helpers
export function getDoorStateLabel(state: DoorState): string {
  switch (state) {
    case "Closed": return "Closed";
    case "Opening": return "Opening...";
    case "PausedOpening": return "Paused (Opening)";
    case "Open": return "Open";
    case "Closing": return "Closing...";
    case "PausedClosing": return "Paused (Closing)";
  }
}

export function getDoorButtonLabel(state: DoorState): string {
  switch (state) {
    case "Closed": return "Open";
    case "Opening": return "Pause";
    case "PausedOpening": return "Close";
    case "Open": return "Close";
    case "Closing": return "Pause";
    case "PausedClosing": return "Open";
  }
}
