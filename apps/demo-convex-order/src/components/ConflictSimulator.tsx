import { useState, useCallback } from "react";
import { useMutation } from "convex/react";
import { Effect, pipe } from "effect";
import { api } from "../../convex/_generated/api";
import { cn } from "@/lib/utils";
import type { ConvexOrderState } from "@/lib/convex-adapter";

// ============================================================================
// Types
// ============================================================================

interface ConflictSimulatorProps {
  orderId: string;
  currentState: string;
  className?: string;
}

interface Simulation {
  readonly label: string;
  readonly description: string;
  readonly state: ConvexOrderState;
  readonly color: string;
  readonly available: boolean;
}

// ============================================================================
// Simulation Definitions
// ============================================================================

const createSimulations = (currentState: string): readonly Simulation[] => [
  {
    label: "Force → Processing",
    description: "Simulate admin starting processing",
    state: { _tag: "Processing", startedAt: Date.now() },
    color: "from-yellow-600 to-amber-600",
    available: currentState === "Cart" || currentState === "Checkout",
  },
  {
    label: "Force → Shipped",
    description: "Simulate warehouse shipping order",
    state: { _tag: "Shipped", trackingNumber: "SIM-" + Date.now(), shippedAt: Date.now() },
    color: "from-purple-600 to-violet-600",
    available: currentState === "Processing",
  },
  {
    label: "Force → Delivered",
    description: "Simulate delivery confirmation",
    state: { _tag: "Delivered", deliveredAt: Date.now() },
    color: "from-green-600 to-emerald-600",
    available: currentState === "Shipped",
  },
  {
    label: "Force → Cancelled",
    description: "Simulate admin cancellation",
    state: { _tag: "Cancelled", reason: "Simulated server cancellation", cancelledAt: Date.now() },
    color: "from-red-600 to-rose-600",
    available: currentState === "Cart" || currentState === "Checkout" || currentState === "Processing",
  },
];

// ============================================================================
// Component
// ============================================================================

export function ConflictSimulator({ orderId, currentState, className }: ConflictSimulatorProps) {
  const [isSimulating, setIsSimulating] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const updateStateMutation = useMutation(api.functions.orders.updateOrderState);

  const simulateServerChange = useCallback(
    (targetState: ConvexOrderState, actionName: string) => {
      setIsSimulating(true);
      setLastAction(actionName);

      const program = pipe(
        // Directly update server state, bypassing local EffState
        // This simulates another client or server process changing state
        Effect.promise(() => updateStateMutation({ orderId, state: targetState })),
        // Brief delay before clearing simulation state
        Effect.flatMap(() => Effect.sleep(500)),
        // Always clear simulating state when done
        Effect.ensuring(Effect.sync(() => setIsSimulating(false)))
      );

      Effect.runPromise(program);
    },
    [orderId, updateStateMutation]
  );

  const availableSimulations = createSimulations(currentState).filter((s) => s.available);

  if (availableSimulations.length === 0) {
    return (
      <div className={cn("bg-gray-900/50 rounded-lg p-4 border border-gray-800", className)}>
        <h3 className="text-sm font-medium text-gray-500 mb-2 flex items-center gap-2">
          <span className="text-lg">⚡</span>
          Conflict Simulator
        </h3>
        <p className="text-xs text-gray-600">
          Order is in a terminal state. No conflicts can be simulated.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "bg-gradient-to-br from-red-950/30 to-orange-950/30 rounded-lg p-4 border border-red-800/50",
        className
      )}
    >
      <h3 className="text-sm font-bold text-red-400 mb-2 flex items-center gap-2">
        <span className="text-lg">⚡</span>
        Conflict Simulator
        <span className="ml-auto text-[10px] font-normal text-red-500/70 bg-red-900/30 px-2 py-0.5 rounded">
          DEMO TOOL
        </span>
      </h3>

      <p className="text-xs text-gray-400 mb-3">
        Simulate server-side state changes to see how{" "}
        <code className="text-purple-400 bg-purple-900/30 px-1 rounded">_syncSnapshot()</code>{" "}
        corrects local state drift.
      </p>

      <div className="space-y-2">
        {availableSimulations.map((sim) => (
          <button
            key={sim.label}
            onClick={() => simulateServerChange(sim.state, sim.label)}
            disabled={isSimulating}
            className={cn(
              "w-full p-3 rounded-lg border transition-all text-left group",
              "bg-gradient-to-r",
              sim.color,
              "border-white/10 hover:border-white/30",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              "hover:scale-[1.02] active:scale-[0.98]"
            )}
          >
            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium text-white text-sm">{sim.label}</span>
                <p className="text-xs text-white/60 mt-0.5">{sim.description}</p>
              </div>
              <div className="text-white/50 group-hover:text-white/80 transition-colors">
                {isSimulating ? (
                  <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24">
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
                ) : (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 10V3L4 14h7v7l9-11h-7z"
                    />
                  </svg>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>

      {lastAction && (
        <div className="mt-3 p-2 bg-black/30 rounded text-xs">
          <span className="text-gray-500">Last simulation:</span>{" "}
          <span className="text-orange-400">{lastAction}</span>
          <p className="text-gray-600 mt-1">
            Watch the Event Timeline for the{" "}
            <span className="text-red-400">server correction</span> event!
          </p>
        </div>
      )}

      {/* Visual hint */}
      <div className="mt-3 flex items-center gap-2 text-[10px] text-gray-500">
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        <span>These bypass local EffState to simulate external changes</span>
      </div>
    </div>
  );
}
