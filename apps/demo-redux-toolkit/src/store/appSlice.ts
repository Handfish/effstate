import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type {
  HamsterState,
  GarageDoorState,
  GarageDoorContext,
  Weather,
} from "@/lib/db";

export interface AppState {
  hamster: {
    state: HamsterState;
    wheelRotation: number;
    electricityLevel: number;
  };
  leftDoor: GarageDoorContext;
  rightDoor: GarageDoorContext;
}

const initialState: AppState = {
  hamster: {
    state: "idle",
    wheelRotation: 0,
    electricityLevel: 0,
  },
  leftDoor: {
    state: "closed",
    position: 0,
    weather: { status: "idle" },
  },
  rightDoor: {
    state: "closed",
    position: 0,
    weather: { status: "idle" },
  },
};

// Helper to pause doors when power goes out
const pauseDoor = (door: GarageDoorContext): GarageDoorContext => {
  if (door.state === "opening") {
    return { ...door, state: "pausedWhileOpening" };
  }
  if (door.state === "closing") {
    return { ...door, state: "pausedWhileClosing" };
  }
  return door;
};

// Helper to resume paused doors
const resumeDoor = (door: GarageDoorContext): GarageDoorContext => {
  if (door.state === "pausedWhileOpening") {
    return { ...door, state: "opening" };
  }
  if (door.state === "pausedWhileClosing") {
    return { ...door, state: "closing" };
  }
  return door;
};

// Door state transitions on click
const getNextDoorState = (current: GarageDoorState): GarageDoorState => {
  switch (current) {
    case "closed":
      return "opening";
    case "opening":
      return "pausedWhileOpening";
    case "pausedWhileOpening":
      return "closing";
    case "open":
      return "closing";
    case "closing":
      return "pausedWhileClosing";
    case "pausedWhileClosing":
      return "opening";
    default:
      return current;
  }
};

export const appSlice = createSlice({
  name: "app",
  initialState,
  reducers: {
    toggleHamster: (state) => {
      const currentState = state.hamster.state;
      if (currentState === "idle" || currentState === "stopping") {
        state.hamster.state = "running";
        state.hamster.electricityLevel = 100;
        // Resume paused doors
        state.leftDoor = resumeDoor(state.leftDoor);
        state.rightDoor = resumeDoor(state.rightDoor);
      } else if (currentState === "running") {
        state.hamster.state = "stopping";
      }
    },

    hamsterTick: (state) => {
      if (state.hamster.state === "running") {
        state.hamster.wheelRotation = (state.hamster.wheelRotation + 5) % 360;
      }
    },

    stopComplete: (state) => {
      if (state.hamster.state === "stopping") {
        state.hamster.state = "idle";
        state.hamster.electricityLevel = 0;
        // Pause any animating doors
        state.leftDoor = pauseDoor(state.leftDoor);
        state.rightDoor = pauseDoor(state.rightDoor);
      }
    },

    wakeHamster: (state) => {
      if (state.hamster.state === "idle") {
        state.hamster.state = "running";
        state.hamster.electricityLevel = 100;
        // Resume paused doors
        state.leftDoor = resumeDoor(state.leftDoor);
        state.rightDoor = resumeDoor(state.rightDoor);
      }
    },

    doorClick: (state, action: PayloadAction<"left" | "right">) => {
      if (state.hamster.electricityLevel === 0) return;

      const doorKey = action.payload === "left" ? "leftDoor" : "rightDoor";
      state[doorKey].state = getNextDoorState(state[doorKey].state);
    },

    doorTick: (state, action: PayloadAction<"left" | "right">) => {
      if (state.hamster.electricityLevel === 0) return;

      const doorKey = action.payload === "left" ? "leftDoor" : "rightDoor";
      const door = state[doorKey];

      if (door.state === "opening") {
        door.position = Math.min(door.position + 1, 100);
      } else if (door.state === "closing") {
        door.position = Math.max(door.position - 1, 0);
      }
    },

    doorAnimationComplete: (state, action: PayloadAction<"left" | "right">) => {
      const doorKey = action.payload === "left" ? "leftDoor" : "rightDoor";
      const door = state[doorKey];

      if (door.state === "opening" && door.position >= 100) {
        door.state = "open";
        door.position = 100;
      } else if (door.state === "closing" && door.position <= 0) {
        door.state = "closed";
        door.position = 0;
        door.weather = { status: "idle" };
      }
    },

    weatherLoading: (state, action: PayloadAction<"left" | "right">) => {
      const doorKey = action.payload === "left" ? "leftDoor" : "rightDoor";
      state[doorKey].weather = { status: "loading" };
    },

    weatherLoaded: (
      state,
      action: PayloadAction<{ door: "left" | "right"; weather: Weather }>
    ) => {
      const doorKey = action.payload.door === "left" ? "leftDoor" : "rightDoor";
      state[doorKey].weather = { status: "loaded", data: action.payload.weather };
    },

    weatherError: (
      state,
      action: PayloadAction<{ door: "left" | "right"; error: string }>
    ) => {
      const doorKey = action.payload.door === "left" ? "leftDoor" : "rightDoor";
      state[doorKey].weather = { status: "error", error: action.payload.error };
    },

    syncState: (_state, action: PayloadAction<AppState>) => {
      return action.payload;
    },
  },
});

export const {
  toggleHamster,
  hamsterTick,
  stopComplete,
  wakeHamster,
  doorClick,
  doorTick,
  doorAnimationComplete,
  weatherLoading,
  weatherLoaded,
  weatherError,
  syncState,
} = appSlice.actions;

export default appSlice.reducer;

// Helper functions for UI labels
export function getHamsterStateLabel(state: HamsterState): string {
  switch (state) {
    case "idle":
      return "Resting";
    case "running":
      return "Running!";
    case "stopping":
      return "Slowing down...";
  }
}

export function getHamsterButtonLabel(state: HamsterState): string {
  switch (state) {
    case "idle":
      return "Wake Up Hamster";
    case "running":
      return "Stop Hamster";
    case "stopping":
      return "Start Running Again";
  }
}

export function getDoorStateLabel(state: GarageDoorState): string {
  switch (state) {
    case "closed":
      return "Closed";
    case "opening":
      return "Opening...";
    case "pausedWhileOpening":
      return "Paused (Opening)";
    case "open":
      return "Open";
    case "closing":
      return "Closing...";
    case "pausedWhileClosing":
      return "Paused (Closing)";
  }
}

export function getDoorButtonLabel(state: GarageDoorState): string {
  switch (state) {
    case "closed":
      return "Open";
    case "opening":
      return "Pause";
    case "pausedWhileOpening":
      return "Close";
    case "open":
      return "Close";
    case "closing":
      return "Pause";
    case "pausedWhileClosing":
      return "Open";
  }
}
