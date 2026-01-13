/**
 * Dexie Persistence Adapter
 *
 * Implements PersistenceAdapter for Dexie (IndexedDB) with:
 * - Cross-tab sync via Dexie's liveQuery
 * - Leader election via localStorage
 */

import type { PersistenceAdapter } from "@effstate/react/v3";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef } from "react";
import { db, STATE_ID, type AppState } from "./db";

// ============================================================================
// Leader Election (simple, stable)
// ============================================================================

const LEADER_KEY = "effstate-v3:leader";
const windowId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function claimLeadership() {
  localStorage.setItem(LEADER_KEY, windowId);
}

function isLeader() {
  return localStorage.getItem(LEADER_KEY) === windowId;
}

// Initialize leader election
if (typeof window !== "undefined") {
  claimLeadership();
  window.addEventListener("focus", claimLeadership);
  window.addEventListener("beforeunload", () => {
    if (isLeader()) localStorage.removeItem(LEADER_KEY);
  });
}

// ============================================================================
// Dexie Adapter
// ============================================================================

export type SerializedAppState = Omit<AppState, "id" | "updatedAt">;

export interface DexieAdapter extends PersistenceAdapter<SerializedAppState> {
  load(): Promise<SerializedAppState | null>;
}

export function createDexieAdapter(): DexieAdapter {
  const subscribers = new Set<(state: SerializedAppState) => void>();

  return {
    async load() {
      const saved = await db.appState.get(STATE_ID);
      if (!saved) return null;
      return {
        hamster: saved.hamster,
        leftDoor: saved.leftDoor,
        rightDoor: saved.rightDoor,
      };
    },

    save(state: SerializedAppState) {
      db.appState.put({
        id: STATE_ID,
        ...state,
        updatedAt: new Date(),
      });
    },

    subscribe(callback: (state: SerializedAppState) => void) {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },

    isLeader,
  };
}

/**
 * Hook that connects Dexie's liveQuery to the adapter's subscribers.
 * This must be called in a React component to use useLiveQuery.
 */
export function useDexieLiveQuery(
  adapter: PersistenceAdapter<SerializedAppState>,
  onExternalChange: (state: SerializedAppState) => void
) {
  const savedState = useLiveQuery(() => db.appState.get(STATE_ID), []);
  const prevRef = useRef<AppState | undefined>(undefined);

  useEffect(() => {
    if (!savedState || savedState === prevRef.current) return;
    if (isLeader()) return; // Leader doesn't sync from external

    prevRef.current = savedState;
    onExternalChange({
      hamster: savedState.hamster,
      leftDoor: savedState.leftDoor,
      rightDoor: savedState.rightDoor,
    });
  }, [savedState, onExternalChange]);
}

export { isLeader };
