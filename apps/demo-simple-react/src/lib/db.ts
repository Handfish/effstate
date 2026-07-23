import Dexie, { type EntityTable } from "dexie";

// Hamster wheel states
export type HamsterState = "idle" | "running" | "stopping";

// Garage door states
export type GarageDoorState =
  | "closed"
  | "opening"
  | "pausedWhileOpening"
  | "open"
  | "closing"
  | "pausedWhileClosing";

// Weather data
export interface Weather {
  temperature: number;
  description: string;
  icon: string;
}

export type WeatherStatus =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; data: Weather }
  | { status: "error"; error: string };

// Garage door context
export interface GarageDoorContext {
  state: GarageDoorState;
  position: number;
  weather: WeatherStatus;
}

// Full app state
export interface AppState {
  id: string;
  hamster: {
    state: HamsterState;
    wheelRotation: number;
    electricityLevel: number;
  };
  leftDoor: GarageDoorContext;
  rightDoor: GarageDoorContext;
  updatedAt: Date;
}

// Dexie database
const db = new Dexie("simple-react-demo") as Dexie & {
  appState: EntityTable<AppState, "id">;
};

db.version(1).stores({
  appState: "id, updatedAt",
});

export { db };

// Initial state factory
export const createInitialState = (): Omit<AppState, "id" | "updatedAt"> => ({
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
});

export const STATE_ID = "app-state";
