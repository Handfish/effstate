import Dexie, { type EntityTable } from "dexie";
import { Data, Effect } from "effect";

// ============================================================================
// Errors
// ============================================================================

export class DexieQueryError extends Data.TaggedError("DexieQueryError")<{
  readonly cause: unknown;
}> {}

// ============================================================================
// Table Types
// ============================================================================

/**
 * Machine state row stored in IndexedDB.
 *
 * We store the state as JSON-compatible values since IndexedDB handles
 * serialization automatically. The context is stored as a plain object
 * that matches the Schema-encoded form.
 */
export interface MachineStateRow {
  /** Unique identifier for the machine instance (e.g., "hamsterWheel") */
  id: string;
  /** The current state value (e.g., "idle", "running") */
  parentValue: string;
  /** The serialized parent context */
  parentContext: unknown;
  /** Serialized child snapshots */
  childSnapshots: unknown;
  /** When the state was last updated */
  updatedAt: Date;
}

// ============================================================================
// Dexie Database
// ============================================================================

/**
 * EffState Dexie database for storing machine states.
 *
 * Uses Dexie 4.x EntityTable pattern for type-safe tables.
 */
class EffStateDexie extends Dexie {
  machineStates!: EntityTable<MachineStateRow, "id">;

  constructor() {
    super("effstate");

    this.version(1).stores({
      // id is the primary key, updatedAt is indexed for queries
      machineStates: "id, updatedAt",
    });
  }
}

// ============================================================================
// Dexie Service
// ============================================================================

/**
 * Dexie service for IndexedDB access.
 *
 * Following the sync-engine-web pattern of wrapping Dexie in an Effect.Service.
 * This provides:
 * - Type-safe database access
 * - Effect-based error handling
 * - Composable with other Effect services
 */
export class DexieService extends Effect.Service<DexieService>()(
  "DexieService",
  {
    effect: Effect.sync(() => {
      const db = new EffStateDexie();

      return {
        /** The raw Dexie database instance */
        db,

        /**
         * Execute a query against the database.
         * Wraps Dexie's Promise-based API in Effect for proper error handling.
         */
        query: <T>(execute: (db: EffStateDexie) => Promise<T>): Effect.Effect<T, DexieQueryError> =>
          Effect.tryPromise({
            try: () => execute(db),
            catch: (cause) => new DexieQueryError({ cause }),
          }),
      };
    }),
  }
) {}

// Re-export the database type for use in other modules
export type { EffStateDexie };
