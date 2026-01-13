/**
 * Dexie Database + Leader Election
 *
 * Using the same simple focus-based leader election as demo-dexie-v3.
 */

import Dexie from "dexie";

// ============================================================================
// Database Schema
// ============================================================================

export interface DoorRecord {
  id: string;
  state: string;
  position: number;
  isPowered: boolean;
  weather: string;
  updatedAt: number;
}

export interface HamsterRecord {
  id: string;
  state: string;
  wheelRotation: number;
  electricityLevel: number;
  updatedAt: number;
}

class AppDatabase extends Dexie {
  doors!: Dexie.Table<DoorRecord, string>;
  hamsters!: Dexie.Table<HamsterRecord, string>;

  constructor() {
    super("zustand-demo");
    this.version(1).stores({
      doors: "id",
      hamsters: "id",
    });
  }
}

export const db = new AppDatabase();

// ============================================================================
// Leader Election (same as demo-dexie-v3 - simple, focus-based)
// ============================================================================

const LEADER_KEY = "zustand-demo:leader";
const windowId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function claimLeadership() {
  localStorage.setItem(LEADER_KEY, windowId);
  notifyListeners();
}

export function isLeader() {
  return localStorage.getItem(LEADER_KEY) === windowId;
}

// Alias for component usage
export const getIsLeader = isLeader;

export function getTabId() {
  return windowId;
}

// Leadership change listeners
const leaderListeners = new Set<(isLeader: boolean) => void>();

function notifyListeners() {
  const leader = isLeader();
  leaderListeners.forEach((cb) => cb(leader));
}

export function subscribeToLeadership(callback: (isLeader: boolean) => void): () => void {
  leaderListeners.add(callback);
  callback(isLeader()); // Immediate
  return () => {
    leaderListeners.delete(callback);
  };
}

// Initialize
export function startLeaderElection() {
  if (typeof window === "undefined") return;

  claimLeadership();

  window.addEventListener("focus", claimLeadership);

  // Listen for other tabs claiming leadership
  window.addEventListener("storage", (e) => {
    if (e.key === LEADER_KEY) {
      notifyListeners();
    }
  });

  window.addEventListener("beforeunload", () => {
    if (isLeader()) {
      localStorage.removeItem(LEADER_KEY);
    }
  });
}
