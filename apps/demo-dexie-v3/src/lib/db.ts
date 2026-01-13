import Dexie, { type EntityTable } from "dexie";
import type { HamsterState, HamsterContext, DoorState, DoorContext } from "@/machines";

// ============================================================================
// Serializable State (for Dexie storage)
// ============================================================================

export interface SerializedHamster {
  stateTag: HamsterState["_tag"];
  wheelRotation: number;
  electricityLevel: number;
}

export interface SerializedDoor {
  stateTag: DoorState["_tag"];
  position: number;
  isPowered: boolean;
  weather:
    | { status: "idle" }
    | { status: "loading" }
    | { status: "loaded"; temp: number; desc: string; icon: string }
    | { status: "error"; message: string };
}

export interface AppState {
  id: string;
  hamster: SerializedHamster;
  leftDoor: SerializedDoor;
  rightDoor: SerializedDoor;
  updatedAt: Date;
}

// ============================================================================
// Dexie Database
// ============================================================================

const db = new Dexie("effstate-v3-demo") as Dexie & {
  appState: EntityTable<AppState, "id">;
};

db.version(1).stores({
  appState: "id, updatedAt",
});

export { db };

// ============================================================================
// Serialization Helpers
// ============================================================================

export function serializeHamster(state: HamsterState, context: HamsterContext): SerializedHamster {
  return {
    stateTag: state._tag,
    wheelRotation: context.wheelRotation,
    electricityLevel: context.electricityLevel,
  };
}

export function serializeDoor(state: DoorState, context: DoorContext): SerializedDoor {
  return {
    stateTag: state._tag,
    position: context.position,
    isPowered: context.isPowered,
    weather: context.weather,
  };
}

export function deserializeHamsterState(serialized: SerializedHamster): HamsterState {
  const now = new Date();
  switch (serialized.stateTag) {
    case "Idle": return { _tag: "Idle" };
    case "Running": return { _tag: "Running", startedAt: now };
    case "Stopping": return { _tag: "Stopping", stoppingAt: now };
    default: return { _tag: "Idle" };
  }
}

export function deserializeHamsterContext(serialized: SerializedHamster): HamsterContext {
  return {
    wheelRotation: serialized.wheelRotation,
    electricityLevel: serialized.electricityLevel,
  };
}

export function deserializeDoorState(serialized: SerializedDoor): DoorState {
  const now = new Date();
  switch (serialized.stateTag) {
    case "Closed": return { _tag: "Closed" };
    case "Opening": return { _tag: "Opening", startedAt: now };
    case "PausedOpening": return { _tag: "PausedOpening", pausedAt: now };
    case "Open": return { _tag: "Open", openedAt: now };
    case "Closing": return { _tag: "Closing", startedAt: now };
    case "PausedClosing": return { _tag: "PausedClosing", pausedAt: now };
    default: return { _tag: "Closed" };
  }
}

export function deserializeDoorContext(serialized: SerializedDoor): DoorContext {
  return {
    position: serialized.position,
    isPowered: serialized.isPowered,
    weather: serialized.weather,
  };
}

export const STATE_ID = "app-state";
