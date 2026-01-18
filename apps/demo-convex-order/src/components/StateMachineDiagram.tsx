import { cn } from "@/lib/utils";
import type { OrderState } from "@/machines/order";
import type { StateTag } from "@/lib/state-styles";

// ============================================================================
// Types
// ============================================================================

interface StateMachineDiagramProps {
  currentState: OrderState;
  className?: string;
}

// ============================================================================
// State Configuration
// ============================================================================

const states = [
  { id: "Cart", label: "Cart", x: 50, y: 100 },
  { id: "Checkout", label: "Checkout", x: 200, y: 100 },
  { id: "Processing", label: "Processing", x: 350, y: 100 },
  { id: "Shipped", label: "Shipped", x: 500, y: 100 },
  { id: "Delivered", label: "Delivered", x: 650, y: 100 },
  { id: "Cancelled", label: "Cancelled", x: 350, y: 220 },
] as const;

const transitions: Array<{
  from: string;
  to: string;
  label: string;
  curved?: boolean;
}> = [
  { from: "Cart", to: "Checkout", label: "checkout" },
  { from: "Checkout", to: "Cart", label: "back", curved: true },
  { from: "Checkout", to: "Processing", label: "place" },
  { from: "Processing", to: "Shipped", label: "ship" },
  { from: "Shipped", to: "Delivered", label: "deliver" },
  { from: "Cart", to: "Cancelled", label: "cancel" },
  { from: "Checkout", to: "Cancelled", label: "cancel" },
  { from: "Processing", to: "Cancelled", label: "cancel" },
];

// ============================================================================
// Unified State Styling (Record-based)
// ============================================================================

interface StateVisualStyle {
  readonly inactive: { bg: string; border: string; text: string };
  readonly active: { bg: string; border: string; glow: string };
}

const stateStyles: Record<StateTag, StateVisualStyle> = {
  Cart: {
    inactive: { bg: "fill-gray-700", border: "stroke-gray-500", text: "fill-gray-300" },
    active: { bg: "fill-gray-600", border: "stroke-gray-300", glow: "drop-shadow-[0_0_8px_rgba(156,163,175,0.5)]" },
  },
  Checkout: {
    inactive: { bg: "fill-blue-900", border: "stroke-blue-500", text: "fill-blue-200" },
    active: { bg: "fill-blue-700", border: "stroke-blue-300", glow: "drop-shadow-[0_0_8px_rgba(59,130,246,0.5)]" },
  },
  Processing: {
    inactive: { bg: "fill-yellow-900", border: "stroke-yellow-500", text: "fill-yellow-200" },
    active: { bg: "fill-yellow-700", border: "stroke-yellow-300", glow: "drop-shadow-[0_0_8px_rgba(234,179,8,0.5)]" },
  },
  Shipped: {
    inactive: { bg: "fill-purple-900", border: "stroke-purple-500", text: "fill-purple-200" },
    active: { bg: "fill-purple-700", border: "stroke-purple-300", glow: "drop-shadow-[0_0_8px_rgba(168,85,247,0.5)]" },
  },
  Delivered: {
    inactive: { bg: "fill-green-900", border: "stroke-green-500", text: "fill-green-200" },
    active: { bg: "fill-green-700", border: "stroke-green-300", glow: "drop-shadow-[0_0_8px_rgba(34,197,94,0.5)]" },
  },
  Cancelled: {
    inactive: { bg: "fill-red-900", border: "stroke-red-500", text: "fill-red-200" },
    active: { bg: "fill-red-700", border: "stroke-red-300", glow: "drop-shadow-[0_0_8px_rgba(239,68,68,0.5)]" },
  },
};

/** Get resolved styles for a state based on active status */
const getStateNodeStyle = (stateId: StateTag, isActive: boolean) => {
  const config = stateStyles[stateId];
  return isActive
    ? { bg: config.active.bg, border: config.active.border, glow: config.active.glow, text: "fill-white" }
    : { bg: config.inactive.bg, border: config.inactive.border, glow: "", text: config.inactive.text };
};

// ============================================================================
// Helpers
// ============================================================================

function getStatePosition(stateId: string) {
  return states.find((s) => s.id === stateId) ?? { x: 0, y: 0 };
}

export function StateMachineDiagram({ currentState, className }: StateMachineDiagramProps) {
  const currentTag = currentState._tag;

  return (
    <div className={cn("bg-gray-900 rounded-lg p-4", className)}>
      <h3 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        State Machine Visualization
      </h3>
      <svg viewBox="0 0 750 280" className="w-full h-auto">
        <defs>
          <marker
            id="arrowhead"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" className="fill-gray-500" />
          </marker>
          <marker
            id="arrowhead-active"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" className="fill-emerald-400" />
          </marker>
        </defs>

        {/* Transition arrows */}
        {transitions.map((t, i) => {
          const from = getStatePosition(t.from);
          const to = getStatePosition(t.to);
          const isFromCurrent = t.from === currentTag;

          // Calculate arrow path
          let path: string;
          if (t.curved) {
            // Curved path for back arrow
            path = `M ${from.x} ${from.y - 35} Q ${(from.x + to.x) / 2} ${from.y - 80} ${to.x} ${to.y - 35}`;
          } else if (to.y > from.y) {
            // Arrow going down to Cancelled
            const midX = from.x;
            const midY = from.y + 40;
            path = `M ${from.x} ${from.y + 25} L ${midX} ${midY} L ${to.x} ${to.y - 25}`;
          } else {
            // Horizontal arrow
            path = `M ${from.x + 55} ${from.y} L ${to.x - 55} ${to.y}`;
          }

          return (
            <g key={i}>
              <path
                d={path}
                fill="none"
                className={cn(
                  "stroke-2 transition-all duration-300",
                  isFromCurrent ? "stroke-emerald-400" : "stroke-gray-600"
                )}
                markerEnd={isFromCurrent ? "url(#arrowhead-active)" : "url(#arrowhead)"}
              />
            </g>
          );
        })}

        {/* State nodes */}
        {states.map((state) => {
          const isActive = state.id === currentTag;
          const style = getStateNodeStyle(state.id, isActive);

          return (
            <g key={state.id} className={cn("transition-all duration-300", style.glow)}>
              <rect
                x={state.x - 50}
                y={state.y - 25}
                width={100}
                height={50}
                rx={8}
                className={cn(
                  "transition-all duration-300 stroke-2",
                  style.bg,
                  style.border,
                  isActive && "stroke-[3px]"
                )}
              />
              <text
                x={state.x}
                y={state.y + 5}
                textAnchor="middle"
                className={cn(
                  "text-sm font-medium transition-all duration-300",
                  style.text,
                  isActive && "font-bold"
                )}
              >
                {state.label}
              </text>
              {isActive && (
                <circle
                  cx={state.x + 40}
                  cy={state.y - 15}
                  r={6}
                  className="fill-emerald-500 animate-pulse"
                />
              )}
            </g>
          );
        })}

        {/* Legend */}
        <g transform="translate(20, 260)">
          <circle cx={0} cy={0} r={4} className="fill-emerald-500" />
          <text x={10} y={4} className="text-xs fill-gray-400">
            Current State
          </text>
          <line x1={80} y1={0} x2={110} y2={0} className="stroke-emerald-400 stroke-2" />
          <text x={120} y={4} className="text-xs fill-gray-400">
            Available Transitions
          </text>
        </g>
      </svg>
    </div>
  );
}
