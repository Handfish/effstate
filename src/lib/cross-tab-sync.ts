import { useSyncExternalStore } from "react";

// ============================================================================
// Tab Visibility State
// ============================================================================

let isTabActive = typeof document !== "undefined" ? !document.hidden : true;
const tabActiveListeners = new Set<() => void>();

const subscribeToTabActive = (callback: () => void) => {
  tabActiveListeners.add(callback);
  return () => tabActiveListeners.delete(callback);
};

const getTabActiveSnapshot = () => isTabActive;
const getTabActiveServerSnapshot = () => true;

// ============================================================================
// Sync Callbacks
// ============================================================================

type SyncCallbacks = {
  onFocusGained: () => void;
  onFocusLost: () => void;
};

let callbacks: SyncCallbacks | null = null;

/**
 * Register callbacks for cross-tab sync events.
 * Call this once when your actor is ready.
 */
export const registerSyncCallbacks = (cb: SyncCallbacks) => {
  callbacks = cb;
};

/**
 * Unregister sync callbacks (for cleanup).
 */
export const unregisterSyncCallbacks = () => {
  callbacks = null;
};

// ============================================================================
// Visibility Change Handler
// ============================================================================

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    const wasActive = isTabActive;
    isTabActive = !document.hidden;

    if (document.hidden) {
      // Tab lost focus - save state so other tabs can pick it up
      callbacks?.onFocusLost();
    } else if (!wasActive) {
      // Tab gained focus - sync from storage and restart activities
      callbacks?.onFocusGained();
    }

    // Notify all React listeners
    tabActiveListeners.forEach((listener) => listener());
  });
}

// ============================================================================
// React Hook
// ============================================================================

/**
 * React hook to track if the current tab is active.
 * Returns true if the tab is focused, false if in background.
 */
export const useIsTabActive = (): boolean => {
  return useSyncExternalStore(
    subscribeToTabActive,
    getTabActiveSnapshot,
    getTabActiveServerSnapshot,
  );
};

/**
 * Get the current tab active state (non-reactive).
 */
export const getIsTabActive = (): boolean => isTabActive;
