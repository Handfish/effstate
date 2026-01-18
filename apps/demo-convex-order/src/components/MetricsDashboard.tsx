import { useMemo } from "react";
import { Match, pipe } from "effect";
import { cn } from "@/lib/utils";
import type { TimelineEvent } from "./EventTimeline";

// ============================================================================
// Types
// ============================================================================

interface MetricsDashboardProps {
  events: TimelineEvent[];
  simulatedLatency: number;
  className?: string;
}

type ColorKey = "yellow" | "green" | "purple" | "red" | "blue";

interface MetricCardProps {
  label: string;
  value: string | number;
  subValue?: string;
  gradient: string;
  colorKey: ColorKey;
  icon: React.ReactNode;
  highlight?: boolean;
}

// ============================================================================
// Color Styling (Record-based for O(1) lookup)
// ============================================================================

interface ColorStyle {
  readonly ring: string;
  readonly text: string;
  readonly iconBg: string;
}

const colorStyles: Record<ColorKey, ColorStyle> = {
  yellow: { ring: "ring-yellow-500", text: "text-yellow-400", iconBg: "bg-yellow-500/20 text-yellow-400" },
  green: { ring: "ring-green-500", text: "text-green-400", iconBg: "bg-green-500/20 text-green-400" },
  purple: { ring: "ring-purple-500", text: "text-purple-400", iconBg: "bg-purple-500/20 text-purple-400" },
  red: { ring: "ring-red-500", text: "text-red-400", iconBg: "bg-red-500/20 text-red-400" },
  blue: { ring: "ring-blue-500", text: "text-blue-400", iconBg: "bg-blue-500/20 text-blue-400" },
};

// ============================================================================
// Hit Rate Styling (Match-based)
// ============================================================================

type HitRateCategory = "perfect" | "good" | "poor";

const categorizeHitRate = (rate: number): HitRateCategory =>
  rate === 100 ? "perfect" : rate >= 80 ? "good" : "poor";

interface HitRateStyle {
  readonly text: string;
  readonly bar: string;
  readonly message: (rate: number) => string;
}

const getHitRateStyle = (category: HitRateCategory): HitRateStyle =>
  pipe(
    Match.value(category),
    Match.when("perfect", () => ({
      text: "text-green-400",
      bar: "bg-gradient-to-r from-green-500 to-emerald-400",
      message: () => "Perfect! All optimistic updates matched server state",
    })),
    Match.when("good", () => ({
      text: "text-yellow-400",
      bar: "bg-gradient-to-r from-yellow-500 to-amber-400",
      message: (rate: number) => `${100 - rate}% of updates required server correction`,
    })),
    Match.when("poor", () => ({
      text: "text-red-400",
      bar: "bg-gradient-to-r from-red-500 to-rose-400",
      message: (rate: number) => `${100 - rate}% of updates required server correction`,
    })),
    Match.exhaustive
  );

// ============================================================================
// Components
// ============================================================================

function MetricCard({ label, value, subValue, gradient, colorKey, icon, highlight }: MetricCardProps) {
  const style = colorStyles[colorKey];

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg p-3 transition-all",
        "bg-gradient-to-br from-gray-900 to-gray-800",
        "border border-gray-700",
        highlight && "ring-2 ring-offset-2 ring-offset-gray-950",
        highlight && style.ring
      )}
    >
      {/* Background glow */}
      <div className={cn("absolute inset-0 opacity-10", `bg-gradient-to-br ${gradient}`)} />

      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">{label}</p>
          <p className={cn("text-2xl font-bold mt-1", style.text)}>{value}</p>
          {subValue && <p className="text-[10px] text-gray-500 mt-0.5">{subValue}</p>}
        </div>
        <div className={cn("p-2 rounded-lg", style.iconBg)}>{icon}</div>
      </div>
    </div>
  );
}

function HitRateIndicator({ rate }: { rate: number }) {
  const category = categorizeHitRate(rate);
  const style = getHitRateStyle(category);

  return (
    <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-800">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-400">Optimistic Hit Rate</span>
        <span className={cn("text-sm font-bold", style.text)}>{rate}%</span>
      </div>
      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", style.bar)}
          style={{ width: `${rate}%` }}
        />
      </div>
      <p className="text-[10px] text-gray-600 mt-1">{style.message(rate)}</p>
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
          gradient="from-yellow-600 to-amber-600"
          colorKey="yellow"
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
          gradient="from-green-600 to-emerald-600"
          colorKey="green"
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
          gradient="from-red-600 to-rose-600"
          colorKey="red"
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
          gradient="from-purple-600 to-violet-600"
          colorKey="purple"
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
      <HitRateIndicator rate={metrics.hitRate} />
    </div>
  );
}
