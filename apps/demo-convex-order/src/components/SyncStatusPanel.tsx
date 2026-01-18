import { cn } from "@/lib/utils";
import { getStateBg, type StateTag } from "@/lib/state-styles";
import type { OrderState, OrderContext } from "@/machines/order";
import type { ConvexOrderState } from "@/lib/convex-adapter";

interface SyncStatusPanelProps {
  localState: OrderState;
  localContext: OrderContext;
  serverState: ConvexOrderState | null;
  serverTotal: number | null;
  isSyncing: boolean;
  lastSyncTime: Date | null;
  pendingMutations: number;
  className?: string;
}

/** Check if a string is a valid StateTag */
const isValidStateTag = (tag: string): tag is StateTag =>
  ["Cart", "Checkout", "Processing", "Shipped", "Delivered", "Cancelled"].includes(tag);

function StateDisplay({
  label,
  stateTag,
  total,
  itemCount,
  isSource,
  highlight,
}: {
  label: string;
  stateTag: string;
  total: number;
  itemCount: number;
  isSource: "local" | "server";
  highlight: boolean;
}) {
  const bgColor = isValidStateTag(stateTag) ? getStateBg(stateTag) : "bg-gray-600";

  return (
    <div
      className={cn(
        "flex-1 p-3 rounded-lg border-2 transition-all duration-300",
        isSource === "local"
          ? "bg-yellow-950/30 border-yellow-600/50"
          : "bg-blue-950/30 border-blue-600/50",
        highlight && "ring-2 ring-offset-2 ring-offset-gray-900",
        highlight && isSource === "local" ? "ring-yellow-400" : highlight && "ring-blue-400"
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className={cn(
            "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
            isSource === "local" ? "bg-yellow-600 text-yellow-100" : "bg-blue-600 text-blue-100"
          )}
        >
          {label}
        </span>
        {isSource === "local" && (
          <span className="text-[10px] text-yellow-500">Optimistic</span>
        )}
        {isSource === "server" && (
          <span className="text-[10px] text-blue-500">Source of Truth</span>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">State:</span>
          <span className={cn("px-2 py-0.5 rounded text-xs font-medium text-white", bgColor)}>
            {stateTag}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Items:</span>
          <span className="text-sm font-mono text-gray-300">{itemCount}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Total:</span>
          <span className="text-sm font-mono text-gray-300">${total.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}

export function SyncStatusPanel({
  localState,
  localContext,
  serverState,
  serverTotal,
  isSyncing,
  lastSyncTime,
  pendingMutations,
  className,
}: SyncStatusPanelProps) {
  const localTag = localState._tag;
  const serverTag = serverState?._tag ?? "unknown";
  const isInSync = localTag === serverTag && localContext.total === (serverTotal ?? localContext.total);
  const hasDrift = !isInSync && serverState !== null;

  return (
    <div className={cn("bg-gray-900 rounded-lg p-4", className)}>
      <h3 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
        <span
          className={cn(
            "w-2 h-2 rounded-full transition-colors",
            isSyncing
              ? "bg-yellow-500 animate-pulse"
              : isInSync
                ? "bg-green-500"
                : "bg-orange-500 animate-pulse"
          )}
        />
        Sync Status
        {pendingMutations > 0 && (
          <span className="ml-2 px-1.5 py-0.5 bg-yellow-600 text-yellow-100 text-[10px] rounded">
            {pendingMutations} pending
          </span>
        )}
      </h3>

      {/* Sync indicator */}
      <div className="mb-4 p-2 rounded bg-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isSyncing ? (
            <>
              <svg className="w-4 h-4 animate-spin text-yellow-500" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              <span className="text-xs text-yellow-400">Syncing to Convex...</span>
            </>
          ) : isInSync ? (
            <>
              <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="text-xs text-green-400">In Sync</span>
            </>
          ) : (
            <>
              <svg className="w-4 h-4 text-orange-500" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="text-xs text-orange-400">Optimistic Update Pending</span>
            </>
          )}
        </div>
        {lastSyncTime && (
          <span className="text-[10px] text-gray-500">
            Last sync:{" "}
            {lastSyncTime.toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
        )}
      </div>

      {/* Side by side comparison */}
      <div className="flex gap-3">
        <StateDisplay
          label="Local (EffState)"
          stateTag={localTag}
          total={localContext.total}
          itemCount={localContext.items.length}
          isSource="local"
          highlight={hasDrift}
        />
        <div className="flex flex-col items-center justify-center px-2">
          <div
            className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center transition-all",
              isInSync ? "bg-green-600" : isSyncing ? "bg-yellow-600" : "bg-orange-600"
            )}
          >
            {isInSync ? (
              <span className="text-lg">=</span>
            ) : (
              <span className="text-lg animate-pulse">≠</span>
            )}
          </div>
          {hasDrift && (
            <span className="text-[10px] text-orange-400 mt-1">Drift!</span>
          )}
        </div>
        <StateDisplay
          label="Server (Convex)"
          stateTag={serverTag}
          total={serverTotal ?? 0}
          itemCount={localContext.items.length}
          isSource="server"
          highlight={hasDrift}
        />
      </div>

      {/* Explanation */}
      <div className="mt-3 p-2 bg-gray-800/50 rounded text-[11px] text-gray-500">
        <strong className="text-gray-400">How it works:</strong> EffState updates locally for instant
        UI feedback (optimistic update). Convex validates & persists. If server differs,{" "}
        <code className="text-purple-400">_syncSnapshot()</code> corrects local state.
      </div>
    </div>
  );
}
