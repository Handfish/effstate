/**
 * Dexie Database + Leader Election
 *
 * This is where Zustand gets complicated.
 * Compare to v3's simple adapter pattern.
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
  weather: string; // JSON serialized
  updatedAt: number;
}

export interface HamsterRecord {
  id: string;
  state: string;
  wheelRotation: number;
  electricityLevel: number;
  updatedAt: number;
}

export interface LeaderRecord {
  id: string;
  tabId: string;
  heartbeat: number;
}

class AppDatabase extends Dexie {
  doors!: Dexie.Table<DoorRecord, string>;
  hamsters!: Dexie.Table<HamsterRecord, string>;
  leaders!: Dexie.Table<LeaderRecord, string>;

  constructor() {
    super("zustand-demo");
    this.version(1).stores({
      doors: "id",
      hamsters: "id",
      leaders: "id",
    });
  }
}

export const db = new AppDatabase();

// ============================================================================
// Leader Election
// ============================================================================

const TAB_ID = crypto.randomUUID();
const HEARTBEAT_INTERVAL = 1000;
const LEADER_TIMEOUT = 3000;

let isLeader = false;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
const leaderListeners: Set<(isLeader: boolean) => void> = new Set();

export function getTabId() {
  return TAB_ID;
}

export function getIsLeader() {
  return isLeader;
}

export function subscribeToLeadership(callback: (isLeader: boolean) => void) {
  leaderListeners.add(callback);
  callback(isLeader); // Initial value
  return () => leaderListeners.delete(callback);
}

function notifyLeadershipChange(newIsLeader: boolean) {
  if (isLeader !== newIsLeader) {
    isLeader = newIsLeader;
    leaderListeners.forEach((cb) => cb(isLeader));
    console.log(`[${TAB_ID.slice(0, 8)}] Leadership: ${isLeader ? "LEADER" : "FOLLOWER"}`);
  }
}

async function tryBecomeLeader(): Promise<boolean> {
  const now = Date.now();

  try {
    const current = await db.leaders.get("main");

    if (!current) {
      // No leader, claim it
      await db.leaders.put({
        id: "main",
        tabId: TAB_ID,
        heartbeat: now,
      });
      return true;
    }

    if (current.tabId === TAB_ID) {
      // We're already leader, update heartbeat
      await db.leaders.update("main", { heartbeat: now });
      return true;
    }

    if (now - current.heartbeat > LEADER_TIMEOUT) {
      // Leader timed out, take over
      await db.leaders.put({
        id: "main",
        tabId: TAB_ID,
        heartbeat: now,
      });
      console.log(`[${TAB_ID.slice(0, 8)}] Taking over from timed-out leader`);
      return true;
    }

    return false;
  } catch (e) {
    console.error("Leader election error:", e);
    return false;
  }
}

async function heartbeatLoop() {
  const nowIsLeader = await tryBecomeLeader();
  notifyLeadershipChange(nowIsLeader);
}

export function startLeaderElection() {
  if (heartbeatInterval) return;

  // Initial attempt
  heartbeatLoop();

  // Ongoing heartbeat
  heartbeatInterval = setInterval(heartbeatLoop, HEARTBEAT_INTERVAL);

  // Cleanup on tab close
  window.addEventListener("beforeunload", () => {
    if (isLeader) {
      // Try to release leadership synchronously
      // Note: This may not always work due to browser restrictions
      db.leaders.delete("main").catch(() => {});
    }
  });
}

export function stopLeaderElection() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}
