import { Effect, Schema } from "effect";
import { DexieService, type MachineStateRow } from "./dexie";
import { GarageDoorContextSchema } from "@/data-access/garage-door-operations";

// ============================================================================
// Schemas
// ============================================================================

const HamsterWheelContextSchema = Schema.Struct({
  wheelRotation: Schema.Number,
  electricityLevel: Schema.Number,
});

const GarageDoorSnapshotSchema = Schema.Struct({
  value: Schema.Literal("closed", "opening", "paused-while-opening", "open", "closing", "paused-while-closing"),
  context: GarageDoorContextSchema,
});

const PersistedStateSchema = Schema.Struct({
  parent: Schema.Struct({
    value: Schema.Literal("idle", "running", "stopping"),
    context: HamsterWheelContextSchema,
  }),
  children: Schema.Struct({
    garageDoorLeft: Schema.optional(GarageDoorSnapshotSchema),
    garageDoorRight: Schema.optional(GarageDoorSnapshotSchema),
  }),
});

export type PersistedState = typeof PersistedStateSchema.Type;

// ============================================================================
// State Persistence Service
// ============================================================================

/**
 * State Persistence service for saving/loading machine state to IndexedDB.
 *
 * This service provides:
 * - Type-safe state persistence using Effect.Schema
 * - Automatic serialization/deserialization
 * - Integration with Dexie for IndexedDB storage
 */
export class StatePersistence extends Effect.Service<StatePersistence>()(
  "StatePersistence",
  {
    effect: Effect.gen(function* () {
      const { db, query } = yield* DexieService;

      return {
        /**
         * Save machine state to IndexedDB.
         * Uses Dexie's put() which creates or updates.
         */
        save: (id: string, state: PersistedState): Effect.Effect<void, never> =>
          Effect.gen(function* () {
            // Encode the state using Schema for proper Date serialization
            const encoded = Schema.encodeSync(PersistedStateSchema)(state);

            const row: MachineStateRow = {
              id,
              parentValue: encoded.parent.value,
              parentContext: encoded.parent.context,
              childSnapshots: encoded.children,
              updatedAt: new Date(),
            };

            yield* query((db) => db.machineStates.put(row));
          }).pipe(
            // Log errors but don't fail - persistence is best-effort
            Effect.catchAll((error) =>
              Effect.sync(() => {
                console.warn("[StatePersistence] Failed to save:", error);
              })
            )
          ),

        /**
         * Load machine state from IndexedDB.
         * Returns null if no state is found or if decoding fails.
         */
        load: (id: string): Effect.Effect<PersistedState | null, never> =>
          Effect.gen(function* () {
            const row = yield* query((db) => db.machineStates.get(id));
            if (!row) return null;

            // Reconstruct the persisted state from the row
            const raw = {
              parent: {
                value: row.parentValue,
                context: row.parentContext,
              },
              children: row.childSnapshots,
            };

            // Decode using Schema
            const decoded = Schema.decodeUnknownSync(PersistedStateSchema)(raw);
            return decoded;
          }).pipe(
            // Return null on any error
            Effect.catchAll((error) =>
              Effect.sync(() => {
                console.warn("[StatePersistence] Failed to load:", error);
                return null;
              })
            )
          ),

        /**
         * Get the raw Dexie database for liveQuery usage.
         * Components can use this with useLiveQuery for reactive updates.
         */
        getDb: () => db,
      };
    }),
    dependencies: [DexieService.Default],
  }
) {}
