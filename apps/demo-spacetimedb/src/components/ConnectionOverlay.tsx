/**
 * ConnectionOverlay Component
 *
 * Full-screen overlay shown during connection issues.
 * Provides visual feedback and retry controls.
 */

import { useConnection } from "../hooks/useConnection";

interface ConnectionOverlayProps {
  connection: ReturnType<typeof useConnection>;
}

export function ConnectionOverlay({ connection }: ConnectionOverlayProps) {
  const {
    stateTag,
    isConnected,
    isSyncing,
    isConnecting,
    isReconnecting,
    isError,
    reconnectAttempt,
    maxRetries,
    errorMessage,
    canRetry,
    retry,
    reset,
  } = connection;

  // Don't show overlay when fully connected
  if (isConnected) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg p-8 text-center max-w-md shadow-2xl border border-gray-700">
        {isConnecting && (
          <>
            <Spinner />
            <h2 className="text-white text-xl font-semibold mt-4">
              Connecting to server...
            </h2>
            <p className="text-gray-400 text-sm mt-2">
              Establishing connection
            </p>
          </>
        )}

        {isReconnecting && (
          <>
            <Spinner />
            <h2 className="text-white text-xl font-semibold mt-4">
              Reconnecting...
            </h2>
            <p className="text-gray-400 text-sm mt-2">
              Attempt {reconnectAttempt} of {maxRetries}
            </p>
            <div className="mt-4 w-full bg-gray-700 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{
                  width: `${((reconnectAttempt ?? 0) / maxRetries) * 100}%`,
                }}
              />
            </div>
            <p className="text-gray-500 text-xs mt-2">
              Next retry with exponential backoff
            </p>
          </>
        )}

        {isSyncing && (
          <>
            <Spinner />
            <h2 className="text-white text-xl font-semibold mt-4">
              Synchronizing...
            </h2>
            <p className="text-gray-400 text-sm mt-2">
              Resyncing game state from server
            </p>
          </>
        )}

        {isError && (
          <>
            <div className="text-red-500 text-5xl mb-4">⚠</div>
            <h2 className="text-white text-xl font-semibold">
              Connection Lost
            </h2>
            <p className="text-gray-400 text-sm mt-2 mb-6">{errorMessage}</p>
            <div className="flex gap-3 justify-center">
              {canRetry && (
                <button
                  onClick={retry}
                  className="px-6 py-2 bg-blue-600 rounded-lg hover:bg-blue-500
                           text-white font-medium transition-colors"
                >
                  Try Again
                </button>
              )}
              <button
                onClick={reset}
                className="px-6 py-2 bg-gray-700 rounded-lg hover:bg-gray-600
                         text-white font-medium transition-colors"
              >
                Reset
              </button>
            </div>
          </>
        )}

        {/* State debug info */}
        <div className="mt-6 pt-4 border-t border-gray-700">
          <p className="text-gray-500 text-xs font-mono">
            State: {stateTag}
          </p>
        </div>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <div className="relative w-16 h-16 mx-auto">
      <div
        className="absolute inset-0 border-4 border-blue-500 border-t-transparent
                   rounded-full animate-spin"
      />
      <div
        className="absolute inset-2 border-4 border-blue-300 border-b-transparent
                   rounded-full animate-spin"
        style={{ animationDirection: "reverse", animationDuration: "0.8s" }}
      />
    </div>
  );
}

export default ConnectionOverlay;
