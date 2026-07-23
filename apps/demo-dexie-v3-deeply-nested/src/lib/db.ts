/**
 * Database + Serialization using Effect.Schema
 *
 * Schema.encode: runtime → storage (serialize)
 * Schema.decode: storage → runtime (deserialize)
 *
 * Dates are transformed to fresh Date() on decode since
 * we don't persist timing info (animations restart).
 */

import Dexie, { type EntityTable } from "dexie";
import { Schema } from "effect";
import type { HamsterState, HamsterContext, DoorState, DoorContext } from "@/machines";

// ============================================================================
// Hamster Schema
// ============================================================================

// Storage format (what goes in Dexie)
const SerializedHamsterSchema = Schema.Struct({
  stateTag: Schema.Literal("Idle", "Running", "Stopping"),
  wheelRotation: Schema.Number,
  electricityLevel: Schema.Number,
});

export type SerializedHamster = typeof SerializedHamsterSchema.Type;

// Transform: storage ↔ runtime
const HamsterStateSchema = Schema.transform(
  SerializedHamsterSchema,
  Schema.Unknown as Schema.Schema<{ state: HamsterState; context: HamsterContext }>,
  {
    decode: (s) => ({
      state: s.stateTag === "Idle" ? { _tag: "Idle" as const }
           : s.stateTag === "Running" ? { _tag: "Running" as const, startedAt: new Date() }
           : { _tag: "Stopping" as const, stoppingAt: new Date() },
      context: { wheelRotation: s.wheelRotation, electricityLevel: s.electricityLevel },
    }),
    encode: (r) => ({
      stateTag: r.state._tag,
      wheelRotation: r.context.wheelRotation,
      electricityLevel: r.context.electricityLevel,
    }),
  }
);

export const HamsterCodec = {
  encode: (state: HamsterState, context: HamsterContext): SerializedHamster =>
    Schema.encodeSync(HamsterStateSchema)({ state, context }),
  decode: (s: SerializedHamster): { state: HamsterState; context: HamsterContext } =>
    Schema.decodeSync(HamsterStateSchema)(s),
};

// ============================================================================
// Door Schema
// ============================================================================

const WeatherSchema = Schema.Union(
  Schema.Struct({ status: Schema.Literal("idle") }),
  Schema.Struct({ status: Schema.Literal("loading") }),
  Schema.Struct({
    status: Schema.Literal("loaded"),
    temp: Schema.Number,
    desc: Schema.String,
    icon: Schema.String,
  }),
  Schema.Struct({ status: Schema.Literal("error"), message: Schema.String })
);

const SerializedDoorSchema = Schema.Struct({
  stateTag: Schema.Literal("Closed", "Opening", "PausedOpening", "Open", "Closing", "PausedClosing"),
  position: Schema.Number,
  isPowered: Schema.Boolean,
  weather: WeatherSchema,
});

export type SerializedDoor = typeof SerializedDoorSchema.Type;

const DoorStateSchema = Schema.transform(
  SerializedDoorSchema,
  Schema.Unknown as Schema.Schema<{ state: DoorState; context: DoorContext }>,
  {
    decode: (s) => {
      const now = new Date();
      const state: DoorState =
        s.stateTag === "Closed" ? { _tag: "Closed" }
        : s.stateTag === "Opening" ? { _tag: "Opening", startedAt: now }
        : s.stateTag === "PausedOpening" ? { _tag: "PausedOpening", pausedAt: now }
        : s.stateTag === "Open" ? { _tag: "Open", openedAt: now }
        : s.stateTag === "Closing" ? { _tag: "Closing", startedAt: now }
        : { _tag: "PausedClosing", pausedAt: now };
      return {
        state,
        context: { position: s.position, isPowered: s.isPowered, weather: s.weather },
      };
    },
    encode: (r) => ({
      stateTag: r.state._tag,
      position: r.context.position,
      isPowered: r.context.isPowered,
      weather: r.context.weather,
    }),
  }
);

export const DoorCodec = {
  encode: (state: DoorState, context: DoorContext): SerializedDoor =>
    Schema.encodeSync(DoorStateSchema)({ state, context }),
  decode: (s: SerializedDoor): { state: DoorState; context: DoorContext } =>
    Schema.decodeSync(DoorStateSchema)(s),
};

// ============================================================================
// Dexie Database
// ============================================================================

export interface AppState {
  id: string;
  hamster: SerializedHamster;
  leftDoor: SerializedDoor;
  rightDoor: SerializedDoor;
  updatedAt: Date;
}

const db = new Dexie("effstate-v3-demo") as Dexie & {
  appState: EntityTable<AppState, "id">;
};

db.version(1).stores({
  appState: "id, updatedAt",
});

export { db };
export const STATE_ID = "app-state";

