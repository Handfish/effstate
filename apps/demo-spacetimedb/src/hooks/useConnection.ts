/**
 * useConnection Hook
 *
 * Provides connection state management for SpacetimeDB with:
 * - Auto-reconnection
 * - State resync
 * - Health monitoring
 * - Typed state access
 */

import { useEffect, useCallback, useMemo } from "react";
import { useActor, useActorEffect } from "effstate-react";
import {
  connectionMachine,
  Connect,
  Disconnect,
  ConnectionSuccess,
  ConnectionError,
  SyncComplete,
  SyncError,
  StaleDetected,
  Reset,
  Connected,
  Connecting,
  Reconnecting,
  Syncing,
  ErrorState,
  Disconnected,
  RECONNECT_CONFIG,
  type ConnectionState,
  type ConnectionContext,
} from "../machines/connection";

// ============================================================================
// Hook Result Type
// ============================================================================

export interface UseConnectionResult {
  // State
  state: ConnectionState;
  stateTag: ConnectionState["_tag"];
  context: ConnectionContext;

  // Derived state
  isConnected: boolean;
  isConnecting: boolean;
  isReconnecting: boolean;
  isSyncing: boolean;
  isError: boolean;
  isDisconnected: boolean;

  // Connection info (when connected)
  identity: string | null;
  uri: string | null;

  // Reconnection info
  reconnectAttempt: number | null;
  maxRetries: number;

  // Error info
  errorMessage: string | null;
  canRetry: boolean;

  // Actions
  connect: (uri: string, moduleName: string) => void;
  disconnect: () => void;
  retry: () => void;
  reset: () => void;

  // For SpacetimeDB integration
  onConnected: (identity: string) => void;
  onConnectionError: (message: string) => void;
  onDisconnected: () => void;
  onSyncComplete: () => void;
  onSyncError: (message: string) => void;
  onStaleDetected: () => void;
  markMessageReceived: () => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useConnection(options?: {
  autoConnect?: { uri: string; moduleName: string };
}): UseConnectionResult {
  const { state, context, stateTag, send, actor } = useActor(connectionMachine);

  // ============================================================================
  // Derived State
  // ============================================================================

  const isConnected = Connected.is(state);
  const isConnecting = Connecting.is(state);
  const isReconnecting = Reconnecting.is(state);
  const isSyncing = Syncing.is(state);
  const isError = ErrorState.is(state);
  const isDisconnected = Disconnected.is(state);

  const identity = useMemo(() => {
    if (Connected.is(state)) return state.identity;
    if (Syncing.is(state)) return state.identity;
    return context.currentIdentity;
  }, [state, context.currentIdentity]);

  const uri = useMemo(() => {
    if (Connected.is(state)) return state.uri;
    if (Connecting.is(state)) return state.uri;
    if (Reconnecting.is(state)) return state.uri;
    if (Syncing.is(state)) return state.uri;
    return context.currentUri;
  }, [state, context.currentUri]);

  const reconnectAttempt = Reconnecting.is(state) ? state.attempt : null;

  const errorMessage = ErrorState.is(state) ? state.message : null;
  const canRetry = ErrorState.is(state) ? state.canRetry : false;

  // ============================================================================
  // Actions
  // ============================================================================

  const connect = useCallback(
    (uri: string, moduleName: string) => {
      send(Connect.make({ uri, moduleName }));
    },
    [send]
  );

  const disconnect = useCallback(() => {
    send(Disconnect.make());
  }, [send]);

  const retry = useCallback(() => {
    if (ErrorState.is(actor.getSnapshot().state)) {
      const errorState = actor.getSnapshot().state as typeof ErrorState.schema.Type;
      if (errorState.lastUri && errorState.lastModuleName) {
        send(Connect.make({ uri: errorState.lastUri, moduleName: errorState.lastModuleName }));
      }
    }
  }, [send, actor]);

  const reset = useCallback(() => {
    send(Reset.make());
  }, [send]);

  // Event handlers for SpacetimeDB SDK callbacks
  const onConnected = useCallback(
    (identity: string) => {
      send(ConnectionSuccess.make({ identity }));
    },
    [send]
  );

  const onConnectionError = useCallback(
    (message: string) => {
      send(ConnectionError.make({ message }));
    },
    [send]
  );

  const onDisconnected = useCallback(() => {
    send(Disconnect.make());
  }, [send]);

  const onSyncComplete = useCallback(() => {
    send(SyncComplete.make());
  }, [send]);

  const onSyncError = useCallback(
    (message: string) => {
      send(SyncError.make({ message }));
    },
    [send]
  );

  const onStaleDetected = useCallback(() => {
    send(StaleDetected.make());
  }, [send]);

  // Message tracking for health checks
  const markMessageReceived = useCallback(() => {
    // In a real implementation, you'd send a MessageReceived event
    // that updates context.lastMessageAt
  }, []);

  // ============================================================================
  // Auto-connect on mount
  // ============================================================================

  useEffect(() => {
    if (options?.autoConnect && isDisconnected) {
      connect(options.autoConnect.uri, options.autoConnect.moduleName);
    }
  }, [options?.autoConnect, isDisconnected, connect]);

  // ============================================================================
  // Debug logging
  // ============================================================================

  useActorEffect(
    actor,
    (snapshot) => {
      console.log(`[Connection] State: ${snapshot.state._tag}`, snapshot.state);
    },
    []
  );

  return {
    state,
    stateTag,
    context,
    isConnected,
    isConnecting,
    isReconnecting,
    isSyncing,
    isError,
    isDisconnected,
    identity,
    uri,
    reconnectAttempt,
    maxRetries: RECONNECT_CONFIG.maxRetries,
    errorMessage,
    canRetry,
    connect,
    disconnect,
    retry,
    reset,
    onConnected,
    onConnectionError,
    onDisconnected,
    onSyncComplete,
    onSyncError,
    onStaleDetected,
    markMessageReceived,
  };
}
