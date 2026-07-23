/**
 * Persistence Adapter Interface
 *
 * A clean interface for persisting state machine snapshots.
 * Implementations can use any storage backend (Postgres, Redis, etc.)
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Serialized snapshot stored in the database
 */
export interface PersistedSnapshot<TState, TContext> {
  id: string;
  stateTag: string;
  stateData: TState;
  context: TContext;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Persistence adapter interface
 */
export interface PersistenceAdapter<TState, TContext> {
  /**
   * Save a snapshot (insert or update)
   */
  save(id: string, stateTag: string, stateData: TState, context: TContext): Promise<void>;

  /**
   * Load a snapshot by ID
   */
  load(id: string): Promise<PersistedSnapshot<TState, TContext> | null>;

  /**
   * Load all snapshots (for listing)
   */
  loadAll(): Promise<PersistedSnapshot<TState, TContext>[]>;

  /**
   * Delete a snapshot
   */
  delete(id: string): Promise<void>;

  /**
   * Query snapshots by state
   */
  findByState(stateTag: string): Promise<PersistedSnapshot<TState, TContext>[]>;
}

// ============================================================================
// In-Memory Adapter (for development/testing)
// ============================================================================

export function createMemoryAdapter<TState, TContext>(): PersistenceAdapter<TState, TContext> {
  const store = new Map<string, PersistedSnapshot<TState, TContext>>();

  return {
    async save(id, stateTag, stateData, context) {
      const existing = store.get(id);
      store.set(id, {
        id,
        stateTag,
        stateData,
        context,
        createdAt: existing?.createdAt ?? new Date(),
        updatedAt: new Date(),
      });
    },

    async load(id) {
      return store.get(id) ?? null;
    },

    async loadAll() {
      return Array.from(store.values());
    },

    async delete(id) {
      store.delete(id);
    },

    async findByState(stateTag) {
      return Array.from(store.values()).filter((s) => s.stateTag === stateTag);
    },
  };
}
