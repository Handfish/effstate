/**
 * Loro Sync Service - Server Synchronization (FUTURE USE)
 *
 * This module provides offline-first sync with a server using Loro CRDTs.
 * It is COMPLETELY SEPARATE from the cross-tab sync - that still works
 * via the simple dexie-adapter pattern.
 *
 * To enable server sync later:
 * 1. Configure the server URL via `configure()`
 * 2. Call `push()` to send local changes to server
 * 3. Call `pull()` to fetch and merge remote changes
 * 4. Or use `sync()` for bidirectional sync
 *
 * The Loro CRDT handles conflict resolution automatically via merge.
 */

import { LoroDoc } from "loro-crdt";
import {
  db,
  STATE_ID,
  SYNC_META_ID,
  decodeFromLoro,
  type PendingChange,
  type AppStateSnapshot,
} from "./db";

// ============================================================================
// Types
// ============================================================================

export interface SyncConfig {
  serverUrl: string;
  clientId?: string; // Auto-generated if not provided
}

export interface SyncResult {
  success: boolean;
  pushed: number; // Number of changes pushed
  pulled: boolean; // Whether we pulled new changes
  error?: string;
}

// ============================================================================
// Internal State
// ============================================================================

let config: SyncConfig | null = null;
let pendingSequence = 0;

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configure the sync service with server URL.
 * Call this before using push/pull/sync.
 */
export async function configure(newConfig: SyncConfig): Promise<void> {
  config = {
    ...newConfig,
    clientId: newConfig.clientId ?? crypto.randomUUID(),
  };

  // Store config in DB for persistence
  await db.syncMeta.put({
    id: SYNC_META_ID,
    clientId: config.clientId!,
    serverUrl: config.serverUrl,
  });
}

/**
 * Check if sync is configured.
 */
export function isConfigured(): boolean {
  return config !== null;
}

/**
 * Load config from DB (call on app start if you want to restore config).
 */
export async function loadConfig(): Promise<boolean> {
  const meta = await db.syncMeta.get(SYNC_META_ID);
  if (meta?.serverUrl) {
    config = {
      serverUrl: meta.serverUrl,
      clientId: meta.clientId,
    };
    return true;
  }
  return false;
}

// ============================================================================
// Queue Local Changes (for offline-first)
// ============================================================================

/**
 * Queue a local change for later push to server.
 * This does NOT affect cross-tab sync - that happens via appState directly.
 *
 * Call this when you want to track changes for server sync.
 * The change will be pushed to server on next `push()` call.
 */
export async function queueChange(snapshot: Uint8Array): Promise<string> {
  const id = crypto.randomUUID();
  await db.pendingChanges.add({
    id,
    snapshot,
    createdAt: new Date(),
    sequence: ++pendingSequence,
  });
  return id;
}

/**
 * Get all pending changes that haven't been pushed yet.
 */
export async function getPendingChanges(): Promise<PendingChange[]> {
  return db.pendingChanges.orderBy("sequence").toArray();
}

/**
 * Clear pending changes (after successful push).
 */
export async function clearPendingChanges(ids: string[]): Promise<void> {
  await db.pendingChanges.bulkDelete(ids);
}

// ============================================================================
// Push to Server
// ============================================================================

/**
 * Push local changes to server.
 *
 * Flow:
 * 1. Get current local state (appState)
 * 2. Send to server as Loro snapshot
 * 3. Server merges with its state and returns merged result
 * 4. We import merged result and update local state
 * 5. Clear pending changes
 */
export async function push(): Promise<SyncResult> {
  if (!config) {
    return { success: false, pushed: 0, pulled: false, error: "Not configured" };
  }

  try {
    // Get current local state
    const local = await db.appState.get(STATE_ID);
    if (!local) {
      return { success: true, pushed: 0, pulled: false }; // Nothing to push
    }

    // Get pending changes
    const pending = await getPendingChanges();

    // Merge all pending changes into current state
    const doc = new LoroDoc();
    doc.import(local.snapshot);
    for (const change of pending) {
      doc.import(change.snapshot);
    }
    const mergedSnapshot = doc.export({ mode: "snapshot" });
    const localVersion = doc.version().encode();

    // Send to server (use JSON with base64-encoded snapshot for compatibility)
    const response = await fetch(`${config.serverUrl}/sync/push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Client-Id": config.clientId!,
      },
      body: JSON.stringify({
        snapshot: arrayToBase64(mergedSnapshot),
        version: arrayToBase64(localVersion),
      }),
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const serverData = await response.json() as {
      snapshot: string; // base64
      version: string; // base64
    };

    // Import server's response (may contain changes from other clients)
    doc.import(base64ToArray(serverData.snapshot));
    const finalSnapshot = doc.export({ mode: "snapshot" });

    // Update local state with merged result
    await db.appState.put({
      id: STATE_ID,
      snapshot: finalSnapshot,
      updatedAt: new Date(),
      serverVersion: base64ToArray(serverData.version),
      syncedAt: new Date(),
    });

    // Clear pending changes
    await clearPendingChanges(pending.map((p) => p.id));

    // Update sync meta
    await db.syncMeta.update(SYNC_META_ID, { lastPushAt: new Date() });

    return { success: true, pushed: pending.length, pulled: true };
  } catch (error) {
    return {
      success: false,
      pushed: 0,
      pulled: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ============================================================================
// Pull from Server
// ============================================================================

/**
 * Pull changes from server and merge with local state.
 *
 * Flow:
 * 1. Send our version vector to server
 * 2. Server returns changes since that version (or full snapshot)
 * 3. We merge server changes with local state
 * 4. Update local appState
 */
export async function pull(): Promise<SyncResult> {
  if (!config) {
    return { success: false, pushed: 0, pulled: false, error: "Not configured" };
  }

  try {
    // Get current local state and version
    const local = await db.appState.get(STATE_ID);
    const localVersion = local?.serverVersion ?? new Uint8Array();

    // Request changes from server
    const response = await fetch(`${config.serverUrl}/sync/pull`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Client-Id": config.clientId!,
      },
      body: JSON.stringify({
        version: arrayToBase64(localVersion),
      }),
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const serverData = await response.json() as {
      snapshot: string; // base64
      version: string; // base64
    };

    // Merge server state with local
    const doc = new LoroDoc();
    if (local?.snapshot) {
      doc.import(local.snapshot);
    }
    doc.import(base64ToArray(serverData.snapshot));
    const mergedSnapshot = doc.export({ mode: "snapshot" });

    // Update local state
    await db.appState.put({
      id: STATE_ID,
      snapshot: mergedSnapshot,
      updatedAt: new Date(),
      serverVersion: base64ToArray(serverData.version),
      syncedAt: new Date(),
    });

    // Update sync meta
    await db.syncMeta.update(SYNC_META_ID, { lastPullAt: new Date() });

    return { success: true, pushed: 0, pulled: true };
  } catch (error) {
    return {
      success: false,
      pushed: 0,
      pulled: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ============================================================================
// Bidirectional Sync
// ============================================================================

/**
 * Perform bidirectional sync: push local changes, then pull remote changes.
 */
export async function sync(): Promise<SyncResult> {
  const pushResult = await push();
  if (!pushResult.success) {
    return pushResult;
  }

  const pullResult = await pull();
  return {
    success: pullResult.success,
    pushed: pushResult.pushed,
    pulled: pullResult.pulled,
    error: pullResult.error,
  };
}

// ============================================================================
// Merge Utilities
// ============================================================================

/**
 * Merge a remote snapshot with local state.
 * This uses Loro's CRDT merge - conflicts are resolved automatically.
 *
 * @param remoteSnapshot - Snapshot received from server or another client
 * @returns The merged state as AppStateSnapshot
 */
export async function mergeRemote(
  remoteSnapshot: Uint8Array
): Promise<AppStateSnapshot> {
  const local = await db.appState.get(STATE_ID);

  const doc = new LoroDoc();

  // Import local state first
  if (local?.snapshot) {
    doc.import(local.snapshot);
  }

  // Import remote state - Loro handles merge
  doc.import(remoteSnapshot);

  // Export merged snapshot
  const mergedSnapshot = doc.export({ mode: "snapshot" });

  // Update local state
  await db.appState.put({
    id: STATE_ID,
    snapshot: mergedSnapshot,
    updatedAt: new Date(),
  });

  return decodeFromLoro(mergedSnapshot);
}

/**
 * Get the current Loro version vector.
 * Useful for incremental sync.
 */
export async function getLocalVersion(): Promise<Uint8Array | null> {
  const local = await db.appState.get(STATE_ID);
  if (!local?.snapshot) return null;

  const doc = new LoroDoc();
  doc.import(local.snapshot);
  return doc.version().encode();
}

// ============================================================================
// Helpers (exported for potential use by server implementations)
// ============================================================================

export function arrayToBase64(arr: Uint8Array): string {
  return btoa(String.fromCharCode(...arr));
}

export function base64ToArray(base64: string): Uint8Array {
  return new Uint8Array(atob(base64).split("").map((c) => c.charCodeAt(0)));
}
