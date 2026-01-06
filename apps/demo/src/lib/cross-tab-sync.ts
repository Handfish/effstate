import { useSyncExternalStore } from "react";

// ============================================================================
// Tab Visibility State (for React)
// ============================================================================

let isTabActive = typeof document !== "undefined" ? !document.hidden : true;
const tabActiveListeners = new Set<() => void>();

const subscribeToTabActive = (callback: () => void) => {
  tabActiveListeners.add(callback);
  return () => tabActiveListeners.delete(callback);
};

const getTabActiveSnapshot = () => isTabActive;
const getTabActiveServerSnapshot = () => true;

// Keep React state in sync with document visibility
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    isTabActive = !document.hidden;
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
