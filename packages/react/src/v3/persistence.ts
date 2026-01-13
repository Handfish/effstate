/**
 * Persistence Adapter Interface
 *
 * A clean abstraction for state persistence that works with any storage backend:
 * - Dexie (IndexedDB)
 * - Electric SQL
 * - localStorage
 * - Any offline-first technology
 *
 * @example
 * ```ts
 * const adapter = createDexieAdapter({
 *   db,
 *   table: "appState",
 *   id: "main",
 *   serialize: (actors) => ({ ... }),
 *   deserialize: (saved) => ({ ... }),
 * });
 *
 * // In your hook:
 * usePersistence(adapter, actors);
 * ```
 */

import { useEffect, useRef } from "react";

// ============================================================================
// Adapter Interface
// ============================================================================

export interface PersistenceAdapter<TSerialized> {
  /**
   * Save state to storage. Only called by the leader.
   */
  save(state: TSerialized): void;

  /**
   * Subscribe to external changes (from other tabs/clients).
   * The callback receives the new state when it changes externally.
   * Returns an unsubscribe function.
   */
  subscribe(callback: (state: TSerialized) => void): () => void;

  /**
   * Check if this client is the leader (responsible for writes).
   * Called synchronously when needed.
   */
  isLeader(): boolean;
}

// ============================================================================
// usePersistence Hook
// ============================================================================

export interface UsePersistenceOptions<TActors, TSerialized> {
  /**
   * The persistence adapter to use.
   */
  adapter: PersistenceAdapter<TSerialized>;

  /**
   * Serialize actors to the storage format.
   */
  serialize: () => TSerialized;

  /**
   * Apply external state to actors (when syncing from another client).
   */
  applyExternal: (state: TSerialized) => void;

  /**
   * Subscribe to actor changes. Returns unsubscribe function.
   */
  subscribeToActors: (callback: () => void) => () => void;
}

/**
 * Hook that wires up actors to a persistence adapter.
 *
 * - Leader: saves to storage on actor changes
 * - Follower: syncs from storage when external changes arrive
 */
export function usePersistence<TActors, TSerialized>(
  options: UsePersistenceOptions<TActors, TSerialized>
): { isLeader: boolean } {
  const { adapter, serialize, applyExternal, subscribeToActors } = options;

  // Use refs to avoid stale closures
  const serializeRef = useRef(serialize);
  const applyExternalRef = useRef(applyExternal);
  serializeRef.current = serialize;
  applyExternalRef.current = applyExternal;

  // Throttle saves
  const saveTimeoutRef = useRef<number | null>(null);
  const pendingSaveRef = useRef(false);

  const saveIfLeader = () => {
    if (!adapter.isLeader()) return;

    if (saveTimeoutRef.current) {
      pendingSaveRef.current = true;
      return;
    }

    adapter.save(serializeRef.current());

    const _setTimeout = (globalThis as Record<string, unknown>).setTimeout as (fn: () => void, ms: number) => number;
    saveTimeoutRef.current = _setTimeout(() => {
      saveTimeoutRef.current = null;
      if (pendingSaveRef.current && adapter.isLeader()) {
        pendingSaveRef.current = false;
        adapter.save(serializeRef.current());
      }
    }, 100);
  };

  // Subscribe to actor changes → save if leader
  useEffect(() => {
    const unsubscribe = subscribeToActors(() => saveIfLeader());
    saveIfLeader(); // Initial save
    return unsubscribe;
  }, [subscribeToActors]);

  // Subscribe to external changes → apply if not leader
  useEffect(() => {
    const unsubscribe = adapter.subscribe((state) => {
      if (!adapter.isLeader()) {
        applyExternalRef.current(state);
      }
    });
    return unsubscribe;
  }, [adapter]);

  return { isLeader: adapter.isLeader() };
}
