/**
 * Cross-Tab Leader Election
 *
 * Provides a simple leader election mechanism for cross-tab/window synchronization.
 * The newest window becomes the leader, and leadership can be reclaimed on focus.
 *
 * @example
 * ```ts
 * const sync = createCrossTabSync({
 *   storageKey: "myApp:state",
 *   onSave: () => saveState(actor),
 *   onSync: () => {
 *     const state = loadState();
 *     if (state) actor._syncSnapshot(state);
 *   },
 * });
 *
 * // Call when state changes
 * actor.subscribe(() => sync.saveIfLeader());
 * ```
 */

export interface CrossTabSyncConfig {
  /** Storage key for the state data */
  storageKey: string;
  /** Called to save state (only when leader) */
  onSave: () => void;
  /** Called to sync state from storage (when not leader) */
  onSync: () => void;
  /** Throttle interval in ms (default: 500) */
  throttleMs?: number;
}

export interface CrossTabSync {
  /** Save state if this window is the leader (throttled) */
  saveIfLeader: () => void;
  /** Check if this window is currently the leader */
  isLeader: () => boolean;
  /** Manually claim leadership */
  claimLeadership: () => void;
  /** Clean up event listeners */
  destroy: () => void;
}

export function createCrossTabSync(config: CrossTabSyncConfig): CrossTabSync {
  const { storageKey, onSave, onSync, throttleMs = 500 } = config;

  const leaderKey = `${storageKey}:leader`;
  const windowId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  let isSyncing = false;
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;
  let pendingSave = false;

  const claimLeadership = () => {
    localStorage.setItem(leaderKey, windowId);
  };

  const isLeader = () => {
    return localStorage.getItem(leaderKey) === windowId;
  };

  const syncFromStorage = () => {
    isSyncing = true;
    try {
      onSync();
    } finally {
      isSyncing = false;
    }
  };

  const saveIfLeader = () => {
    if (!isLeader()) return;
    if (isSyncing) return;

    if (saveTimeout) {
      pendingSave = true;
      return;
    }

    onSave();

    saveTimeout = setTimeout(() => {
      saveTimeout = null;
      if (pendingSave && !isSyncing && isLeader()) {
        pendingSave = false;
        onSave();
      }
    }, throttleMs);
  };

  // Event handlers
  const handleFocus = () => {
    claimLeadership();
  };

  const handleStorage = (event: StorageEvent) => {
    if (event.key === leaderKey) return;
    if (event.key !== storageKey) return;
    if (isSyncing) return;

    // Only sync if we're not the leader
    if (!isLeader()) {
      syncFromStorage();
    }
  };

  const handleBeforeUnload = () => {
    if (isLeader()) {
      localStorage.removeItem(leaderKey);
    }
  };

  // Initialize
  if (typeof window !== "undefined") {
    // Sync first, then claim leadership
    syncFromStorage();
    claimLeadership();

    window.addEventListener("focus", handleFocus);
    window.addEventListener("storage", handleStorage);
    window.addEventListener("beforeunload", handleBeforeUnload);
  }

  const destroy = () => {
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (isLeader()) {
        localStorage.removeItem(leaderKey);
      }
    }
  };

  return {
    saveIfLeader,
    isLeader,
    claimLeadership,
    destroy,
  };
}
