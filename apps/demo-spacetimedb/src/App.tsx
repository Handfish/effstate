/**
 * SpacetimeDB + EffState Demo App
 *
 * Demonstrates connection state management with:
 * - Auto-reconnection with exponential backoff
 * - State resync on reconnect
 * - Health monitoring
 * - Visual feedback
 */

import { useConnection } from "./hooks/useConnection";
import { ConnectionOverlay } from "./components/ConnectionOverlay";
import { SyncIndicator } from "./components/SyncIndicator";
import { RECONNECT_CONFIG } from "./machines/connection";

// Demo configuration
const SPACETIME_URI = "ws://localhost:3000";
const SPACETIME_MODULE = "demo-game";

function App() {
  const connection = useConnection({
    // Uncomment to auto-connect on mount:
    // autoConnect: { uri: SPACETIME_URI, moduleName: SPACETIME_MODULE },
  });

  const {
    stateTag,
    isDisconnected,
    identity,
    uri,
    context,
    connect,
    disconnect,
    reset,
    // These would be wired to SpacetimeDB SDK callbacks:
    onConnected,
    onConnectionError,
    onDisconnected,
    onSyncComplete,
    onSyncError,
    onStaleDetected,
    onMessageReceived,
  } = connection;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Connection overlay (shown during connection issues) */}
      <ConnectionOverlay connection={connection} />

      {/* Sync indicator (corner badge) */}
      <SyncIndicator connection={connection} />

      {/* Main content */}
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold mb-2">
            SpacetimeDB + EffState Demo
          </h1>
          <p className="text-gray-400">
            Connection state management with auto-reconnection and resync
          </p>
        </header>

        {/* Connection Controls */}
        <section className="bg-gray-900 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Connection Controls</h2>

          <div className="flex flex-wrap gap-3 mb-6">
            <button
              onClick={() => connect(SPACETIME_URI, SPACETIME_MODULE)}
              disabled={!isDisconnected}
              className="px-4 py-2 bg-green-600 rounded hover:bg-green-500
                       disabled:opacity-50 disabled:cursor-not-allowed
                       transition-colors"
            >
              Connect
            </button>

            <button
              onClick={disconnect}
              disabled={isDisconnected}
              className="px-4 py-2 bg-red-600 rounded hover:bg-red-500
                       disabled:opacity-50 disabled:cursor-not-allowed
                       transition-colors"
            >
              Disconnect
            </button>

            <button
              onClick={reset}
              className="px-4 py-2 bg-gray-700 rounded hover:bg-gray-600
                       transition-colors"
            >
              Reset
            </button>
          </div>

          {/* Simulate SDK callbacks (for demo) */}
          <div className="border-t border-gray-800 pt-4">
            <h3 className="text-sm font-medium text-gray-400 mb-3">
              Simulate SDK Callbacks (Demo)
            </h3>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => onConnected(`id-${Date.now()}`)}
                className="px-3 py-1 text-sm bg-gray-800 rounded hover:bg-gray-700"
              >
                onConnect
              </button>
              <button
                onClick={() => onConnectionError("Simulated error")}
                className="px-3 py-1 text-sm bg-gray-800 rounded hover:bg-gray-700"
              >
                onConnectError
              </button>
              <button
                onClick={onDisconnected}
                className="px-3 py-1 text-sm bg-gray-800 rounded hover:bg-gray-700"
              >
                onDisconnect
              </button>
              <button
                onClick={onSyncComplete}
                className="px-3 py-1 text-sm bg-gray-800 rounded hover:bg-gray-700"
              >
                onSyncComplete
              </button>
              <button
                onClick={() => onSyncError("Sync failed")}
                className="px-3 py-1 text-sm bg-gray-800 rounded hover:bg-gray-700"
              >
                onSyncError
              </button>
              <button
                onClick={onStaleDetected}
                className="px-3 py-1 text-sm bg-gray-800 rounded hover:bg-gray-700"
              >
                onStaleDetected
              </button>
              <button
                onClick={onMessageReceived}
                className="px-3 py-1 text-sm bg-gray-800 rounded hover:bg-gray-700"
              >
                onMessageReceived
              </button>
            </div>
          </div>
        </section>

        {/* Current State */}
        <section className="bg-gray-900 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Current State</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-gray-400 text-sm">State</label>
              <div className="font-mono text-lg">{stateTag}</div>
            </div>

            <div>
              <label className="text-gray-400 text-sm">Identity</label>
              <div className="font-mono text-lg">
                {identity ?? <span className="text-gray-600">—</span>}
              </div>
            </div>

            <div>
              <label className="text-gray-400 text-sm">URI</label>
              <div className="font-mono text-lg">
                {uri ?? <span className="text-gray-600">—</span>}
              </div>
            </div>

            <div>
              <label className="text-gray-400 text-sm">Total Reconnects</label>
              <div className="font-mono text-lg">{context.totalReconnects}</div>
            </div>
          </div>
        </section>

        {/* Configuration */}
        <section className="bg-gray-900 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Configuration</h2>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div>
              <label className="text-gray-400">Max Retries</label>
              <div className="font-mono">{RECONNECT_CONFIG.maxRetries}</div>
            </div>
            <div>
              <label className="text-gray-400">Initial Delay</label>
              <div className="font-mono">
                {RECONNECT_CONFIG.initialDelayMs}ms
              </div>
            </div>
            <div>
              <label className="text-gray-400">Max Delay</label>
              <div className="font-mono">{RECONNECT_CONFIG.maxDelayMs}ms</div>
            </div>
            <div>
              <label className="text-gray-400">Backoff Multiplier</label>
              <div className="font-mono">
                {RECONNECT_CONFIG.backoffMultiplier}x
              </div>
            </div>
            <div>
              <label className="text-gray-400">Stale Timeout</label>
              <div className="font-mono">
                {RECONNECT_CONFIG.staleTimeoutMs}ms
              </div>
            </div>
            <div>
              <label className="text-gray-400">Health Check Interval</label>
              <div className="font-mono">
                {RECONNECT_CONFIG.healthCheckIntervalMs}ms
              </div>
            </div>
          </div>
        </section>

        {/* State Machine Diagram */}
        <section className="bg-gray-900 rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">State Machine</h2>

          <pre className="text-xs text-gray-400 overflow-x-auto">
            {`
                    ┌─────────────────────────────────────────┐
                    │                                         │
                    ▼                                         │
┌──────────────┐  Connect   ┌──────────────┐  Success   ┌───┴────────┐
│ Disconnected │───────────▶│  Connecting  │───────────▶│  Syncing   │
└──────────────┘            └──────────────┘            └────────────┘
       ▲                           │                          │
       │                        Error                      Applied
       │                           │                          │
       │                           ▼                          ▼
       │                    ┌──────────────┐           ┌──────────────┐
       │                    │    Error     │           │  Connected   │◀─┐
       │                    └──────────────┘           └──────────────┘  │
       │                           │                          │          │
       │                      Retry/Reset                 Disconnect     │
       │                           │                          │          │
       │                           ▼                          ▼          │
       │                    ┌──────────────┐           ┌──────────────┐  │
       └────────────────────│   (Reset)    │           │ Reconnecting │──┘
                            └──────────────┘           └──────────────┘
                                                              │
                                                         Max Retries
                                                              │
                                                              ▼
                                                        ┌──────────────┐
                                                        │    Error     │
                                                        └──────────────┘
            `}
          </pre>
        </section>

        {/* How it works */}
        <section className="mt-8 text-gray-400 text-sm">
          <h2 className="text-lg font-semibold text-white mb-3">
            How EffState Helps
          </h2>
          <ul className="space-y-2 list-disc list-inside">
            <li>
              <strong className="text-white">Schema-first states:</strong> Each
              connection state is typed with its own data (uri, attempt count,
              etc.)
            </li>
            <li>
              <strong className="text-white">Entry/exit effects:</strong>{" "}
              Logging, cleanup, and setup happen automatically on state
              transitions
            </li>
            <li>
              <strong className="text-white">Run streams:</strong> Health checks
              run while Connected, retry timers while Reconnecting — both
              auto-cancel on exit
            </li>
            <li>
              <strong className="text-white">Effect R channel:</strong>{" "}
              SpacetimeService is injected, making testing easy
            </li>
            <li>
              <strong className="text-white">React integration:</strong>{" "}
              useActor hook provides reactive state, useActorEffect for side
              effects
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}

export default App;
