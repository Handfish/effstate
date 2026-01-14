/**
 * Database + Loro CRDT Storage
 *
 * Simple single-table approach like demo-dexie-v3-deeply-nested,
 * but stores state as Loro snapshots for future CRDT merge capability.
 */

import Dexie, { type EntityTable } from "dexie";
import { LoroDoc } from "loro-crdt";
import type {
  HamsterState,
  HamsterContext,
  DoorState,
  DoorContext,
  WeatherStatus,
} from "@/machines";

// ============================================================================
// Loro Snapshot Helpers
// ============================================================================

export interface AppStateSnapshot {
  hamster: { state: HamsterState; context: HamsterContext };
  leftDoor: { state: DoorState; context: DoorContext };
  rightDoor: { state: DoorState; context: DoorContext };
}

export function encodeToLoro(state: AppStateSnapshot): Uint8Array {
  const doc = new LoroDoc();

  // Hamster
  const hamster = doc.getMap("hamster");
  hamster.set("stateTag", state.hamster.state._tag);
  hamster.set("wheelRotation", state.hamster.context.wheelRotation);
  hamster.set("electricityLevel", state.hamster.context.electricityLevel);

  // Left door
  const leftDoor = doc.getMap("leftDoor");
  setDoorMap(leftDoor, state.leftDoor.state, state.leftDoor.context);

  // Right door
  const rightDoor = doc.getMap("rightDoor");
  setDoorMap(rightDoor, state.rightDoor.state, state.rightDoor.context);

  return doc.export({ mode: "snapshot" });
}

function setDoorMap(
  door: ReturnType<LoroDoc["getMap"]>,
  state: DoorState,
  context: DoorContext
) {
  door.set("stateTag", state._tag);
  door.set("position", context.position);
  door.set("isPowered", context.isPowered);
  // Don't persist "loading" - it's transient
  const weatherStatus = context.weather.status === "loading" ? "idle" : context.weather.status;
  door.set("weatherStatus", weatherStatus);
  if (context.weather.status === "loaded") {
    door.set("weatherTemp", context.weather.temp);
    door.set("weatherDesc", context.weather.desc);
    door.set("weatherIcon", context.weather.icon);
  } else if (context.weather.status === "error") {
    door.set("weatherError", context.weather.message);
  }
}

export function decodeFromLoro(snapshot: Uint8Array): AppStateSnapshot {
  const doc = new LoroDoc();
  doc.import(snapshot);

  const hamsterMap = doc.getMap("hamster");
  const leftDoorMap = doc.getMap("leftDoor");
  const rightDoorMap = doc.getMap("rightDoor");

  return {
    hamster: extractHamster(hamsterMap),
    leftDoor: extractDoor(leftDoorMap),
    rightDoor: extractDoor(rightDoorMap),
  };
}

function extractHamster(map: ReturnType<LoroDoc["getMap"]>): {
  state: HamsterState;
  context: HamsterContext;
} {
  const stateTag = (map.get("stateTag") as string) || "Idle";
  const now = new Date();

  const state: HamsterState =
    stateTag === "Idle" ? { _tag: "Idle" }
    : stateTag === "Running" ? { _tag: "Running", startedAt: now }
    : { _tag: "Stopping", stoppingAt: now };

  return {
    state,
    context: {
      wheelRotation: (map.get("wheelRotation") as number) ?? 0,
      electricityLevel: (map.get("electricityLevel") as number) ?? 0,
    },
  };
}

function extractDoor(map: ReturnType<LoroDoc["getMap"]>): {
  state: DoorState;
  context: DoorContext;
} {
  const stateTag = (map.get("stateTag") as string) || "Closed";
  const now = new Date();

  const state: DoorState =
    stateTag === "Closed" ? { _tag: "Closed" }
    : stateTag === "Opening" ? { _tag: "Opening", startedAt: now }
    : stateTag === "PausedOpening" ? { _tag: "PausedOpening", pausedAt: now }
    : stateTag === "Open" ? { _tag: "Open", openedAt: now }
    : stateTag === "Closing" ? { _tag: "Closing", startedAt: now }
    : { _tag: "PausedClosing", pausedAt: now };

  const weatherStatus = (map.get("weatherStatus") as string) ?? "idle";
  let weather: WeatherStatus;

  if (weatherStatus === "loaded") {
    weather = {
      status: "loaded",
      temp: (map.get("weatherTemp") as number) ?? 0,
      desc: (map.get("weatherDesc") as string) ?? "",
      icon: (map.get("weatherIcon") as string) ?? "",
    };
  } else if (weatherStatus === "error") {
    weather = { status: "error", message: (map.get("weatherError") as string) ?? "" };
  } else {
    weather = { status: "idle" };
  }

  return {
    state,
    context: {
      position: (map.get("position") as number) ?? 0,
      isPowered: (map.get("isPowered") as boolean) ?? false,
      weather,
    },
  };
}

// ============================================================================
// Dexie Database
// ============================================================================

/**
 * Main app state - the "committed" state that cross-tab sync uses.
 * This is what the current working sync relies on - DON'T CHANGE THIS FLOW.
 */
export interface AppState {
  id: string;
  snapshot: Uint8Array;
  updatedAt: Date;
  // Server sync fields (optional - for future use)
  serverVersion?: Uint8Array; // Last known server version vector
  syncedAt?: Date; // When we last synced with server
}

/**
 * Pending changes - for offline-first server sync (FUTURE USE).
 * Local changes are queued here before being pushed to server.
 * Cross-tab sync does NOT use this table - it's purely for server sync.
 */
export interface PendingChange {
  id: string; // Auto-generated UUID
  snapshot: Uint8Array; // Loro snapshot of the change
  createdAt: Date;
  // For deduplication and ordering
  sequence: number;
}

/**
 * Sync metadata - tracks sync state with server (FUTURE USE).
 */
export interface SyncMeta {
  id: string;
  clientId: string; // Unique client identifier
  lastPushAt?: Date;
  lastPullAt?: Date;
  serverUrl?: string;
}

const db = new Dexie("effstate-v3-loro") as Dexie & {
  appState: EntityTable<AppState, "id">;
  pendingChanges: EntityTable<PendingChange, "id">;
  syncMeta: EntityTable<SyncMeta, "id">;
};

// Version 1: Original simple schema (still works)
db.version(1).stores({
  appState: "id, updatedAt",
});

// Version 2: Add server sync tables (additive - doesn't break existing)
db.version(2).stores({
  appState: "id, updatedAt, syncedAt",
  pendingChanges: "id, createdAt, sequence",
  syncMeta: "id",
});

export { db };
export const STATE_ID = "app-state";
export const SYNC_META_ID = "sync-meta";

// ============================================================================
// Leader Election (same as working demo)
// ============================================================================

const LEADER_KEY = "effstate-v3-loro:leader";
const windowId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function claimLeadership() {
  localStorage.setItem(LEADER_KEY, windowId);
}

export function isLeader(): boolean {
  return localStorage.getItem(LEADER_KEY) === windowId;
}

if (typeof window !== "undefined") {
  claimLeadership();
  window.addEventListener("focus", claimLeadership);
  window.addEventListener("beforeunload", () => {
    if (isLeader()) localStorage.removeItem(LEADER_KEY);
  });
}
