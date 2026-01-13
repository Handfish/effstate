/**
 * Cross-Tab Leader Election
 *
 * Provides a simple leader election mechanism for cross-tab/window synchronization.
 * The newest window becomes the leader, and leadership can be reclaimed on focus.
 *
 * With Dexie, we still use leader election to coordinate writes, but we don't need
 * BroadcastChannel for sync since Dexie's liveQuery handles cross-tab reactivity.
 *
 * @example
 * ```ts
 * const sync = createCrossTabSync({
 *   storageKey: "myApp:state",
 *   onSave: () => saveState(actor),
 * });
 *
 * // Call when state changes
 * actor.subscribe(() => sync.saveIfLeader());
 * ```
 */

export interface CrossTabSyncConfig {
  /** Storage key for the leader coordination */
  storageKey: string;
  /** Called to save state (only when leader) */
  onSave: () => void;
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
  const { storageKey, onSave, throttleMs = 500 } = config;

  const leaderKey = `${storageKey}:leader`;
  const windowId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  let saveTimeout: ReturnType<typeof setTimeout> | null = null;
  let pendingSave = false;

  const claimLeadership = () => {
    localStorage.setItem(leaderKey, windowId);
  };

  const isLeader = () => {
    return localStorage.getItem(leaderKey) === windowId;
  };

  const saveIfLeader = () => {
    if (!isLeader()) return;

    if (saveTimeout) {
      pendingSave = true;
      return;
    }

    onSave();

    saveTimeout = setTimeout(() => {
      saveTimeout = null;
      if (pendingSave && isLeader()) {
        pendingSave = false;
        onSave();
      }
    }, throttleMs);
  };

  // Event handlers
  const handleFocus = () => {
    claimLeadership();
  };

  const handleBeforeUnload = () => {
    if (isLeader()) {
      localStorage.removeItem(leaderKey);
    }
  };

  // Initialize
  if (typeof window !== "undefined") {
    claimLeadership();

    window.addEventListener("focus", handleFocus);
    window.addEventListener("beforeunload", handleBeforeUnload);
  }

  const destroy = () => {
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", handleFocus);
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
