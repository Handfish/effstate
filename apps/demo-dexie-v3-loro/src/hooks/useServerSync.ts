/**
 * Server Sync Hook
 *
 * Leader/follower model for server synchronization.
 * - Click "Start Sync" to claim leadership and push state
 * - Followers automatically poll and receive state updates
 */

import { useCallback, useEffect, useState, useRef } from "react";
import {
  initialize,
  startPolling,
  stopPolling,
  claim,
  release,
  push,
  getSyncState,
  subscribeSyncState,
  CLIENT_ID,
  type SyncState,
} from "@/lib/server-sync";
import type { AppStateSnapshot } from "@/lib/db";

export interface UseServerSyncOptions {
  /** Called when state is received from server (for followers) */
  onStateReceived?: (state: AppStateSnapshot) => void;
  /** Get current local state (for pushing as leader) */
  getLocalState?: () => AppStateSnapshot;
}

export interface ServerSyncControls {
  /** Current sync state */
  syncState: SyncState;
  /** This client's ID */
  clientId: string;
  /** Claim server leadership and start pushing */
  claimLeadership: () => Promise<void>;
  /** Release server leadership */
  releaseLeadership: () => Promise<void>;
  /** Push current state (only works if leader) */
  pushState: () => Promise<void>;
  /** Whether sync is active (polling) */
  isActive: boolean;
  /** Start syncing (polling) */
  startSync: () => void;
  /** Stop syncing */
  stopSync: () => void;
}

export function useServerSync(options: UseServerSyncOptions = {}): ServerSyncControls {
  const { onStateReceived, getLocalState } = options;
  const [syncState, setSyncState] = useState<SyncState>(getSyncState);
  const [isActive, setIsActive] = useState(false);

  // Keep refs to callbacks so they're always up-to-date
  const onStateReceivedRef = useRef(onStateReceived);
  const getLocalStateRef = useRef(getLocalState);

  useEffect(() => {
    onStateReceivedRef.current = onStateReceived;
  }, [onStateReceived]);

  useEffect(() => {
    getLocalStateRef.current = getLocalState;
  }, [getLocalState]);

  // Initialize the sync service with wrapper functions that use refs
  useEffect(() => {
    initialize(
      (state) => onStateReceivedRef.current?.(state),
      () => getLocalStateRef.current?.()!
    );
  }, []);

  // Subscribe to sync state changes
  useEffect(() => {
    return subscribeSyncState(setSyncState);
  }, []);

  // Auto-push when server leader and state changes
  const prevHashRef = useRef<string | null>(null);
  useEffect(() => {
    if (!syncState.isServerLeader || !getLocalState) return;

    const interval = setInterval(async () => {
      const current = getLocalState();
      // Use stable hash of primitive values (JSON.stringify can vary for Effect classes)
      const hash = [
        current.hamster.state._tag,
        current.hamster.context.electricityLevel,
        current.hamster.context.wheelRotation,
        current.leftDoor.state._tag,
        current.leftDoor.context.position,
        current.rightDoor.state._tag,
        current.rightDoor.context.position,
      ].join("|");

      if (hash !== prevHashRef.current) {
        prevHashRef.current = hash;
        await push();
      }
    }, 500);

    return () => clearInterval(interval);
  }, [syncState.isServerLeader, getLocalState]);

  const claimLeadership = useCallback(async () => {
    const success = await claim();
    if (success) {
      // Start polling to detect if we lose leadership
      if (!isActive) {
        startPolling();
        setIsActive(true);
      }
    }
  }, [isActive]);

  const releaseLeadership = useCallback(async () => {
    await release();
  }, []);

  const pushState = useCallback(async () => {
    await push();
  }, []);

  const startSync = useCallback(() => {
    startPolling();
    setIsActive(true);
  }, []);

  const stopSync = useCallback(() => {
    stopPolling();
    setIsActive(false);
  }, []);

  return {
    syncState,
    clientId: CLIENT_ID,
    claimLeadership,
    releaseLeadership,
    pushState,
    isActive,
    startSync,
    stopSync,
  };
}
