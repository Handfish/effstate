import Dexie, { type EntityTable } from "dexie";
import {
  type HamsterState,
  type HamsterContext,
  type DoorState,
  type DoorContext,
  Idle,
  Running,
  Stopping,
  Closed,
  Opening,
  PausedOpening,
  Open,
  Closing,
  PausedClosing,
} from "@/machines";

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

const db = new Dexie("effstate-v4-demo") as Dexie & {
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
    case "Idle": return Idle.make();
    case "Running": return Running.make({ startedAt: now });
    case "Stopping": return Stopping.make({ stoppingAt: now });
    default: return Idle.make();
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
    case "Closed": return Closed.make();
    case "Opening": return Opening.make({ startedAt: now });
    case "PausedOpening": return PausedOpening.make({ pausedAt: now });
    case "Open": return Open.make({ openedAt: now });
    case "Closing": return Closing.make({ startedAt: now });
    case "PausedClosing": return PausedClosing.make({ pausedAt: now });
    default: return Closed.make();
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
