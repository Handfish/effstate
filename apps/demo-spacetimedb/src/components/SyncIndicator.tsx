/**
 * SyncIndicator Component
 *
 * Subtle corner badge showing connection/sync status.
 * Shown when there's something noteworthy to indicate.
 */

import { useConnection } from "../hooks/useConnection";

interface SyncIndicatorProps {
  connection: ReturnType<typeof useConnection>;
}

export function SyncIndicator({ connection }: SyncIndicatorProps) {
  const { stateTag, isConnected, isDisconnected, identity } = connection;

  // Config for each state
  const stateConfig: Record<
    string,
    { color: string; bg: string; text: string; pulse?: boolean }
  > = {
    Disconnected: {
      color: "text-gray-400",
      bg: "bg-gray-800",
      text: "Offline",
    },
    Connecting: {
      color: "text-yellow-400",
      bg: "bg-yellow-900/50",
      text: "Connecting...",
      pulse: true,
    },
    Connected: {
      color: "text-green-400",
      bg: "bg-green-900/50",
      text: "Connected",
    },
    Reconnecting: {
      color: "text-orange-400",
      bg: "bg-orange-900/50",
      text: "Reconnecting...",
      pulse: true,
    },
    Syncing: {
      color: "text-blue-400",
      bg: "bg-blue-900/50",
      text: "Syncing...",
      pulse: true,
    },
    Error: {
      color: "text-red-400",
      bg: "bg-red-900/50",
      text: "Error",
    },
  };

  const config = stateConfig[stateTag] ?? stateConfig.Disconnected;

  return (
    <div className="fixed bottom-4 right-4 z-40">
      <div
        className={`${config.bg} ${config.color} text-xs px-3 py-2 rounded-lg
                   flex items-center gap-2 backdrop-blur-sm border border-white/10
                   shadow-lg transition-all duration-300`}
      >
        {/* Status dot */}
        <div className="relative">
          <div
            className={`w-2 h-2 rounded-full ${
              isConnected
                ? "bg-green-400"
                : isDisconnected
                  ? "bg-gray-500"
                  : "bg-current"
            }`}
          />
          {config.pulse && (
            <div
              className={`absolute inset-0 w-2 h-2 rounded-full bg-current
                         animate-ping opacity-75`}
            />
          )}
        </div>

        {/* Status text */}
        <span className="font-medium">{config.text}</span>

        {/* Identity (when connected) */}
        {isConnected && identity && (
          <span className="text-gray-500 font-mono text-[10px]">
            {identity.slice(0, 8)}...
          </span>
        )}
      </div>
    </div>
  );
}

export default SyncIndicator;
