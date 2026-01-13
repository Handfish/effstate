/**
 * Dexie Database + Leader Election
 *
 * Minimal implementation for cross-tab sync.
 */

import Dexie from "dexie";

// ============================================================================
// Database Schema
// ============================================================================

export interface AppState {
  id: string;
  hamster: { stateTag: string; wheelRotation: number; electricityLevel: number };
  leftDoor: { stateTag: string; position: number; isPowered: boolean; weather: unknown };
  rightDoor: { stateTag: string; position: number; isPowered: boolean; weather: unknown };
  updatedAt: number;
}

class AppDatabase extends Dexie {
  appState!: Dexie.Table<AppState, string>;

  constructor() {
    super("zustand-clean-demo");
    this.version(1).stores({
      appState: "id",
    });
  }
}

export const db = new AppDatabase();
export const STATE_ID = "app-state";

// ============================================================================
// Leader Election (focus-based, simple)
// ============================================================================

const LEADER_KEY = "zustand-clean:leader";
const windowId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function claimLeadership() {
  localStorage.setItem(LEADER_KEY, windowId);
}

export function isLeader() {
  return localStorage.getItem(LEADER_KEY) === windowId;
}

// Leadership change listeners
const leaderListeners = new Set<(isLeader: boolean) => void>();

function notifyListeners() {
  const leader = isLeader();
  leaderListeners.forEach((cb) => cb(leader));
}

export function subscribeToLeadership(callback: (isLeader: boolean) => void): () => void {
  leaderListeners.add(callback);
  callback(isLeader()); // Immediate callback with current state
  return () => {
    leaderListeners.delete(callback);
  };
}

// Initialize leader election
if (typeof window !== "undefined") {
  claimLeadership();
  window.addEventListener("focus", () => {
    claimLeadership();
    notifyListeners();
  });
  window.addEventListener("storage", (e) => {
    if (e.key === LEADER_KEY) {
      notifyListeners();
    }
  });
  window.addEventListener("beforeunload", () => {
    if (isLeader()) localStorage.removeItem(LEADER_KEY);
  });
}
