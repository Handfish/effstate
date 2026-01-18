import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { TimelineEvent } from "./EventTimeline";

interface MetricsDashboardProps {
  events: TimelineEvent[];
  simulatedLatency: number;
  className?: string;
}

interface MetricCardProps {
  label: string;
  value: string | number;
  subValue?: string;
  color: string;
  icon: React.ReactNode;
  highlight?: boolean;
}

function MetricCard({ label, value, subValue, color, icon, highlight }: MetricCardProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg p-3 transition-all",
        "bg-gradient-to-br from-gray-900 to-gray-800",
        "border border-gray-700",
        highlight && "ring-2 ring-offset-2 ring-offset-gray-950",
        highlight && color.includes("yellow") && "ring-yellow-500",
        highlight && color.includes("green") && "ring-green-500",
        highlight && color.includes("purple") && "ring-purple-500",
        highlight && color.includes("red") && "ring-red-500"
      )}
    >
      {/* Background glow */}
      <div
        className={cn(
          "absolute inset-0 opacity-10",
          `bg-gradient-to-br ${color}`
        )}
      />

      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">{label}</p>
          <p className={cn("text-2xl font-bold mt-1", color.includes("yellow") ? "text-yellow-400" : color.includes("green") ? "text-green-400" : color.includes("purple") ? "text-purple-400" : color.includes("red") ? "text-red-400" : "text-blue-400")}>
            {value}
          </p>
          {subValue && <p className="text-[10px] text-gray-500 mt-0.5">{subValue}</p>}
        </div>
        <div className={cn("p-2 rounded-lg", color.includes("yellow") ? "bg-yellow-500/20 text-yellow-400" : color.includes("green") ? "bg-green-500/20 text-green-400" : color.includes("purple") ? "bg-purple-500/20 text-purple-400" : color.includes("red") ? "bg-red-500/20 text-red-400" : "bg-blue-500/20 text-blue-400")}>
          {icon}
        </div>
      </div>
    </div>
  );
}

export function MetricsDashboard({ events, simulatedLatency, className }: MetricsDashboardProps) {
  const metrics = useMemo(() => {
    const optimisticEvents = events.filter((e) => e.type === "optimistic");
    const confirmedEvents = events.filter((e) => e.type === "server_confirmed");
    const correctionEvents = events.filter((e) => e.type === "server_correction");
    const syncEvents = events.filter((e) => e.type === "external_update");

    // Calculate perceived latency (time from optimistic to confirmed)
    let avgPerceivedLatency = 0;
    if (optimisticEvents.length > 0 && confirmedEvents.length > 0) {
      // Rough calculation - in real app you'd match events properly
      avgPerceivedLatency = simulatedLatency;
    }

    // Calculate optimistic hit rate
    const totalStateChanges = optimisticEvents.length;
    const successfulOptimistic = confirmedEvents.length;
    const hitRate = totalStateChanges > 0 ? (successfulOptimistic / totalStateChanges) * 100 : 100;

    return {
      totalEvents: events.length,
      optimisticUpdates: optimisticEvents.length,
      serverConfirms: confirmedEvents.length,
      corrections: correctionEvents.length,
      syncs: syncEvents.length,
      perceivedLatency: avgPerceivedLatency,
      hitRate: Math.round(hitRate),
      savedTime: optimisticEvents.length * simulatedLatency,
    };
  }, [events, simulatedLatency]);

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-300 flex items-center gap-2">
          <span className="text-lg">📊</span>
          Live Metrics
        </h3>
        <span className="text-[10px] text-gray-500 bg-gray-800 px-2 py-1 rounded">
          {events.length} events tracked
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <MetricCard
          label="Optimistic Updates"
          value={metrics.optimisticUpdates}
          subValue="Instant UI changes"
          color="from-yellow-600 to-amber-600"
          highlight={metrics.optimisticUpdates > 0}
          icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          }
        />

        <MetricCard
          label="Server Confirms"
          value={metrics.serverConfirms}
          subValue="Persisted to Convex"
          color="from-green-600 to-emerald-600"
          highlight={metrics.serverConfirms > 0}
          icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          }
        />

        <MetricCard
          label="Corrections"
          value={metrics.corrections}
          subValue="_syncSnapshot() calls"
          color="from-red-600 to-rose-600"
          highlight={metrics.corrections > 0}
          icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          }
        />

        <MetricCard
          label="Real-time Syncs"
          value={metrics.syncs}
          subValue="From Convex"
          color="from-purple-600 to-violet-600"
          highlight={metrics.syncs > 0}
          icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          }
        />
      </div>

      {/* Big stat - Time saved */}
      {simulatedLatency > 0 && metrics.optimisticUpdates > 0 && (
        <div className="bg-gradient-to-r from-emerald-900/50 to-cyan-900/50 rounded-lg p-4 border border-emerald-700/50">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-emerald-400/70 uppercase tracking-wider">
                User Time Saved by Optimistic Updates
              </p>
              <p className="text-3xl font-bold text-emerald-400 mt-1">
                {(metrics.savedTime / 1000).toFixed(1)}s
              </p>
              <p className="text-xs text-emerald-500/60 mt-1">
                {metrics.optimisticUpdates} updates × {simulatedLatency}ms latency
              </p>
            </div>
            <div className="text-6xl opacity-30">⚡</div>
          </div>
        </div>
      )}

      {/* Hit rate indicator */}
      <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-800">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-gray-400">Optimistic Hit Rate</span>
          <span
            className={cn(
              "text-sm font-bold",
              metrics.hitRate === 100
                ? "text-green-400"
                : metrics.hitRate >= 80
                  ? "text-yellow-400"
                  : "text-red-400"
            )}
          >
            {metrics.hitRate}%
          </span>
        </div>
        <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              metrics.hitRate === 100
                ? "bg-gradient-to-r from-green-500 to-emerald-400"
                : metrics.hitRate >= 80
                  ? "bg-gradient-to-r from-yellow-500 to-amber-400"
                  : "bg-gradient-to-r from-red-500 to-rose-400"
            )}
            style={{ width: `${metrics.hitRate}%` }}
          />
        </div>
        <p className="text-[10px] text-gray-600 mt-1">
          {metrics.hitRate === 100
            ? "Perfect! All optimistic updates matched server state"
            : `${100 - metrics.hitRate}% of updates required server correction`}
        </p>
      </div>
    </div>
  );
}
