/**
 * useConnection Hook (Hybrid Architecture)
 *
 * This hook:
 * - Creates the EffState connection machine
 * - Provides the SpacetimeSDK service via Effect Layer
 * - Exposes typed state and actions to React
 */

import { useEffect, useCallback, useMemo, useRef } from "react";
import { Effect, Layer } from "effect";
import type { MachineActor } from "effstate-react";
import { useSyncExternalStore } from "react";
import {
  connectionMachine,
  Connect,
  Disconnect,
  ConnectionSuccess,
  ConnectionFailed,
  SyncComplete,
  SyncFailed,
  StaleDetected,
  Reset,
  MessageReceived,
  Connected,
  Connecting,
  Reconnecting,
  Syncing,
  ErrorState,
  Disconnected,
  RECONNECT_CONFIG,
  type ConnectionState,
  type ConnectionContext,
  type ConnectionEvent,
} from "../machines/connection";
import { SpacetimeSDK, MockSpacetimeSDKLayer } from "../services/SpacetimeSDK";

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

  // Connection info
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

  // SDK callback wiring (call these from SpacetimeDB SDK callbacks)
  onConnected: (identity: string) => void;
  onConnectionError: (message: string) => void;
  onDisconnected: () => void;
  onSyncComplete: () => void;
  onSyncError: (message: string) => void;
  onStaleDetected: () => void;
  onMessageReceived: () => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useConnection(options?: {
  autoConnect?: { uri: string; moduleName: string };
  sdkLayer?: Layer.Layer<SpacetimeSDK>;
}): UseConnectionResult {
  // Use provided layer or default to mock
  const sdkLayer = options?.sdkLayer ?? MockSpacetimeSDKLayer;

  // Create actor ref (persists across renders)
  const actorRef = useRef<MachineActor<
    ConnectionState,
    ConnectionContext,
    ConnectionEvent
  > | null>(null);

  // Initialize actor on first render
  if (actorRef.current === null) {
    // Create the interpret effect with SDK layer provided
    const interpretWithLayer = connectionMachine.interpret({
      onError: (error) => {
        console.error(`[Connection] Effect error:`, error);
      },
    }).pipe(
      Effect.provide(sdkLayer)
    );

    // Run synchronously to create actor
    actorRef.current = Effect.runSync(interpretWithLayer);
  }

  const actor = actorRef.current;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      actorRef.current?.stop();
      actorRef.current = null;
    };
  }, []);

  // Subscribe to state changes
  const snapshot = useSyncExternalStore(
    actor.subscribe,
    actor.getSnapshot,
    actor.getSnapshot
  );

  const { state, context } = snapshot;
  const stateTag = state._tag;

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

  const send = useCallback(
    (event: ConnectionEvent) => actor.send(event),
    [actor]
  );

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
      const errorState = actor.getSnapshot()
        .state as typeof ErrorState.schema.Type;
      if (errorState.lastUri && errorState.lastModuleName) {
        send(
          Connect.make({
            uri: errorState.lastUri,
            moduleName: errorState.lastModuleName,
          })
        );
      }
    }
  }, [send, actor]);

  const reset = useCallback(() => {
    send(Reset.make());
  }, [send]);

  // ============================================================================
  // SDK Callback Wiring
  // ============================================================================

  const onConnected = useCallback(
    (identity: string) => {
      send(ConnectionSuccess.make({ identity }));
    },
    [send]
  );

  const onConnectionError = useCallback(
    (message: string) => {
      send(ConnectionFailed.make({ error: message }));
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
      send(SyncFailed.make({ error: message }));
    },
    [send]
  );

  const onStaleDetected = useCallback(() => {
    send(StaleDetected.make());
  }, [send]);

  const onMessageReceived = useCallback(() => {
    send(MessageReceived.make());
  }, [send]);

  // ============================================================================
  // Auto-connect
  // ============================================================================

  useEffect(() => {
    if (options?.autoConnect && isDisconnected) {
      connect(options.autoConnect.uri, options.autoConnect.moduleName);
    }
  }, [options?.autoConnect, isDisconnected, connect]);

  // ============================================================================
  // Debug logging
  // ============================================================================

  useEffect(() => {
    const unsub = actor.subscribe((snap) => {
      console.log(`[useConnection] State: ${snap.state._tag}`, snap.state);
    });
    return unsub;
  }, [actor]);

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
    onMessageReceived,
  };
}
