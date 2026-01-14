/**
 * Dexie Persistence Adapter (matches working demo pattern exactly)
 *
 * Uses Loro snapshots for storage format (CRDT-ready),
 * but same simple patterns as demo-dexie-v3-deeply-nested.
 */

import type { PersistenceAdapter } from "@effstate/react/v3";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef } from "react";
import {
  db,
  STATE_ID,
  isLeader,
  encodeToLoro,
  decodeFromLoro,
  type AppState,
  type AppStateSnapshot,
} from "./db";

// ============================================================================
// Adapter
// ============================================================================

export interface DexieLoroAdapter extends PersistenceAdapter<AppStateSnapshot> {
  load(): Promise<AppStateSnapshot | null>;
}

export function createDexieAdapter(): DexieLoroAdapter {
  return {
    async load() {
      const saved = await db.appState.get(STATE_ID);
      if (!saved) return null;
      return decodeFromLoro(saved.snapshot);
    },

    save(state: AppStateSnapshot) {
      db.appState.put({
        id: STATE_ID,
        snapshot: encodeToLoro(state),
        updatedAt: new Date(),
      });
    },

    // Cross-tab sync handled by useDexieLiveQuery
    subscribe: () => () => {},
    isLeader,
  };
}

// ============================================================================
// Cross-Tab Sync Hook (same pattern as working demo)
// ============================================================================

export function useDexieLiveQuery(
  _adapter: PersistenceAdapter<AppStateSnapshot>,
  onExternalChange: (state: AppStateSnapshot) => void
) {
  const savedState = useLiveQuery(() => db.appState.get(STATE_ID), []);
  const prevRef = useRef<AppState | undefined>(undefined);

  useEffect(() => {
    if (!savedState || savedState === prevRef.current) return;
    if (isLeader()) return; // Leader doesn't sync from external

    prevRef.current = savedState;
    onExternalChange(decodeFromLoro(savedState.snapshot));
  }, [savedState, onExternalChange]);
}

export { isLeader };
