/**
 * Server Sync Service (Effect-based)
 *
 * Leader/follower model:
 * - Leader claims server, pushes state changes
 * - Followers poll server, apply received state
 */

import { Effect, Ref, Schedule, Fiber, pipe } from "effect";
import { encodeToLoro, decodeFromLoro, type AppStateSnapshot } from "./db";

// ============================================================================
// Types
// ============================================================================

export interface SyncState {
  connected: boolean;
  isServerLeader: boolean;
  serverLeaderId: string | null;
  serverVersion: number;
  polling: boolean;
  lastError: string | null;
}

export interface ServerStateResponse {
  leaderId: string | null;
  snapshot: string | null;
  version: number;
  isLeader: boolean;
}

// ============================================================================
// Configuration
// ============================================================================

const SERVER_URL = "http://localhost:3001";
const POLL_INTERVAL_MS = 2000;

// Client ID (stable per browser session)
const CLIENT_ID = `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// ============================================================================
// Internal State
// ============================================================================

const syncStateRef = Ref.unsafeMake<SyncState>({
  connected: false,
  isServerLeader: false,
  serverLeaderId: null,
  serverVersion: 0,
  polling: false,
  lastError: null,
});

let pollingFiber: Fiber.RuntimeFiber<unknown, unknown> | null = null;
let onStateReceived: ((state: AppStateSnapshot) => void) | null = null;
let getLocalState: (() => AppStateSnapshot) | null = null;

// ============================================================================
// Helpers
// ============================================================================

function arrayToBase64(arr: Uint8Array): string {
  return btoa(String.fromCharCode(...arr));
}

function base64ToArray(base64: string): Uint8Array {
  return new Uint8Array(atob(base64).split("").map((c) => c.charCodeAt(0)));
}

// ============================================================================
// API Effects
// ============================================================================

const fetchState = Effect.tryPromise({
  try: async (): Promise<ServerStateResponse> => {
    const res = await fetch(`${SERVER_URL}/sync/state`, {
      headers: { "X-Client-Id": CLIENT_ID },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
  catch: (e) => new Error(`Failed to fetch state: ${e}`),
});

const claimLeadership = (snapshot: string) =>
  Effect.tryPromise({
    try: async () => {
      const res = await fetch(`${SERVER_URL}/sync/claim`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Client-Id": CLIENT_ID,
        },
        body: JSON.stringify({ snapshot }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<{ success: boolean; version: number }>;
    },
    catch: (e) => new Error(`Failed to claim: ${e}`),
  });

const pushState = (snapshot: string) =>
  Effect.tryPromise({
    try: async () => {
      const res = await fetch(`${SERVER_URL}/sync/push`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Client-Id": CLIENT_ID,
        },
        body: JSON.stringify({ snapshot }),
      });
      if (!res.ok) {
        if (res.status === 403) {
          // Lost leadership
          return { success: false, lostLeadership: true };
        }
        throw new Error(`HTTP ${res.status}`);
      }
      return res.json() as Promise<{ success: boolean; version: number }>;
    },
    catch: (e) => new Error(`Failed to push: ${e}`),
  });

const releaseLeadership = Effect.tryPromise({
  try: async () => {
    const res = await fetch(`${SERVER_URL}/sync/release`, {
      method: "POST",
      headers: { "X-Client-Id": CLIENT_ID },
    });
    return res.json() as Promise<{ success: boolean }>;
  },
  catch: (e) => new Error(`Failed to release: ${e}`),
});

// ============================================================================
// Polling Logic
// ============================================================================

const pollOnce = pipe(
  fetchState,
  Effect.flatMap((serverState) =>
    Effect.gen(function* () {
      const current = yield* Ref.get(syncStateRef);

      // Update our sync state
      yield* Ref.set(syncStateRef, {
        ...current,
        connected: true,
        isServerLeader: serverState.isLeader,
        serverLeaderId: serverState.leaderId,
        serverVersion: serverState.version,
        lastError: null,
      });

      // If we're a follower and there's new state, apply it
      if (!serverState.isLeader && serverState.snapshot && onStateReceived) {
        console.log("[server-sync] Follower receiving state, version:", serverState.version);
        const decoded = decodeFromLoro(base64ToArray(serverState.snapshot));
        console.log("[server-sync] Decoded state:", decoded);
        onStateReceived(decoded);
      } else {
        console.log("[server-sync] Poll result - isLeader:", serverState.isLeader, "hasSnapshot:", !!serverState.snapshot, "hasCallback:", !!onStateReceived);
      }
    })
  ),
  Effect.catchAll((error) =>
    Ref.update(syncStateRef, (s) => ({
      ...s,
      connected: false,
      lastError: error.message,
    }))
  )
);

const pollingLoop = pipe(
  pollOnce,
  Effect.repeat(Schedule.spaced(`${POLL_INTERVAL_MS} millis`)),
  Effect.catchAll(() => Effect.void)
);

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize the sync service with callbacks
 */
export function initialize(
  onReceive: (state: AppStateSnapshot) => void,
  getState: () => AppStateSnapshot
): void {
  onStateReceived = onReceive;
  getLocalState = getState;
}

/**
 * Start polling the server
 */
export function startPolling(): void {
  if (pollingFiber) return;

  Ref.update(syncStateRef, (s) => ({ ...s, polling: true })).pipe(
    Effect.runSync
  );

  pollingFiber = Effect.runFork(pollingLoop);
}

/**
 * Stop polling
 */
export function stopPolling(): void {
  if (pollingFiber) {
    Effect.runFork(Fiber.interrupt(pollingFiber));
    pollingFiber = null;
  }

  Ref.update(syncStateRef, (s) => ({ ...s, polling: false })).pipe(
    Effect.runSync
  );
}

/**
 * Claim server leadership and start pushing state
 */
export async function claim(): Promise<boolean> {
  if (!getLocalState) return false;

  const state = getLocalState();
  const snapshot = arrayToBase64(encodeToLoro(state));

  const result = await Effect.runPromise(
    pipe(
      claimLeadership(snapshot),
      Effect.flatMap((res) =>
        Effect.gen(function* () {
          if (res.success) {
            yield* Ref.update(syncStateRef, (s) => ({
              ...s,
              isServerLeader: true,
              serverLeaderId: CLIENT_ID,
              serverVersion: res.version,
            }));
          }
          return res.success;
        })
      ),
      Effect.catchAll(() => Effect.succeed(false))
    )
  );

  return result;
}

/**
 * Release server leadership
 */
export async function release(): Promise<void> {
  await Effect.runPromise(
    pipe(
      releaseLeadership,
      Effect.flatMap(() =>
        Ref.update(syncStateRef, (s) => ({
          ...s,
          isServerLeader: false,
        }))
      ),
      Effect.catchAll(() => Effect.void)
    )
  );
}

/**
 * Push current state to server (only works if leader)
 */
export async function push(): Promise<boolean> {
  const current = Ref.get(syncStateRef).pipe(Effect.runSync);
  if (!current.isServerLeader || !getLocalState) return false;

  const state = getLocalState();
  const snapshot = arrayToBase64(encodeToLoro(state));

  const result = await Effect.runPromise(
    pipe(
      pushState(snapshot),
      Effect.flatMap((res) =>
        Effect.gen(function* () {
          if ("lostLeadership" in res && res.lostLeadership) {
            yield* Ref.update(syncStateRef, (s) => ({
              ...s,
              isServerLeader: false,
            }));
            return false;
          }
          if (res.success && "version" in res) {
            yield* Ref.update(syncStateRef, (s) => ({
              ...s,
              serverVersion: res.version,
            }));
          }
          return res.success;
        })
      ),
      Effect.catchAll(() => Effect.succeed(false))
    )
  );

  return result;
}

/**
 * Get current sync state (reactive)
 */
export function getSyncState(): SyncState {
  return Ref.get(syncStateRef).pipe(Effect.runSync);
}

/**
 * Subscribe to sync state changes
 */
export function subscribeSyncState(callback: (state: SyncState) => void): () => void {
  // Simple polling-based subscription (Effect.Ref doesn't have built-in subscriptions)
  const interval = setInterval(() => {
    callback(getSyncState());
  }, 100);

  // Initial call
  callback(getSyncState());

  return () => clearInterval(interval);
}

export { CLIENT_ID };
