import { useEffect, useState, useRef } from "react";
import { Match, pipe } from "effect";
import { cn } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

type PacketType = "optimistic" | "mutation" | "sync" | "correction";
type EventType = "optimistic" | "server_confirmed" | "server_correction" | "external_update";

interface Packet {
  id: string;
  type: PacketType;
  direction: "up" | "down";
  progress: number;
  label: string;
}

interface DataFlowVisualizationProps {
  isSyncing: boolean;
  pendingMutations: number;
  lastEventType?: EventType;
  className?: string;
}

// ============================================================================
// Packet Styling (Record-based for O(1) lookup)
// ============================================================================

interface PacketStyle {
  readonly glow: string;
  readonly fill: string;
}

const packetStyles: Record<PacketType, PacketStyle> = {
  optimistic: { glow: "fill-yellow-500/20", fill: "fill-yellow-500" },
  mutation: { glow: "fill-green-500/20", fill: "fill-green-500" },
  correction: { glow: "fill-red-500/20", fill: "fill-red-500" },
  sync: { glow: "fill-purple-500/20", fill: "fill-purple-500" },
};

// ============================================================================
// Event-to-Packet Mapping (Match for discriminated union)
// ============================================================================

interface PacketConfig {
  readonly type: PacketType;
  readonly direction: "up" | "down";
  readonly label: string;
}

const getPacketConfig = (eventType: EventType): PacketConfig =>
  pipe(
    Match.value(eventType),
    Match.when("optimistic", () => ({
      type: "optimistic" as const,
      direction: "up" as const,
      label: "EVENT",
    })),
    Match.when("server_confirmed", () => ({
      type: "mutation" as const,
      direction: "down" as const,
      label: "OK",
    })),
    Match.when("server_correction", () => ({
      type: "correction" as const,
      direction: "down" as const,
      label: "SYNC",
    })),
    Match.when("external_update", () => ({
      type: "sync" as const,
      direction: "down" as const,
      label: "UPDATE",
    })),
    Match.exhaustive
  );

// ============================================================================
// Component
// ============================================================================

export function DataFlowVisualization({
  isSyncing,
  pendingMutations,
  lastEventType,
  className,
}: DataFlowVisualizationProps) {
  const [packets, setPackets] = useState<Packet[]>([]);
  const packetIdRef = useRef(0);

  // Add packet when events happen
  useEffect(() => {
    if (!lastEventType) return;

    const config = getPacketConfig(lastEventType);
    const newPacket: Packet = {
      id: `packet-${++packetIdRef.current}`,
      ...config,
      progress: 0,
    };

    setPackets((prev) => [...prev.slice(-10), newPacket]);
  }, [lastEventType]);

  // Animate packets
  useEffect(() => {
    const interval = setInterval(() => {
      setPackets((prev) =>
        prev
          .map((p) => ({ ...p, progress: p.progress + 0.05 }))
          .filter((p) => p.progress <= 1)
      );
    }, 16);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className={cn("relative", className)}>
      <svg viewBox="0 0 400 300" className="w-full h-auto">
        <defs>
          {/* Glow filters */}
          <filter id="glow-yellow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="glow-green" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="glow-purple" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Gradient definitions */}
          <linearGradient id="client-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fbbf24" />
            <stop offset="100%" stopColor="#f59e0b" />
          </linearGradient>
          <linearGradient id="server-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#1d4ed8" />
          </linearGradient>
          <linearGradient id="connection-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#6b7280" stopOpacity="0.3" />
            <stop offset="50%" stopColor="#9ca3af" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#6b7280" stopOpacity="0.3" />
          </linearGradient>
        </defs>

        {/* Background grid */}
        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#374151" strokeWidth="0.5" opacity="0.3" />
        </pattern>
        <rect width="400" height="300" fill="url(#grid)" />

        {/* Connection beam */}
        <path
          d="M 200 80 L 200 220"
          stroke="url(#connection-gradient)"
          strokeWidth="40"
          strokeLinecap="round"
          opacity="0.3"
        />

        {/* Animated connection line */}
        <line
          x1="200"
          y1="80"
          x2="200"
          y2="220"
          stroke="#4b5563"
          strokeWidth="2"
          strokeDasharray="8 4"
          className="animate-pulse"
        />

        {/* Client box (EffState) */}
        <g transform="translate(200, 50)">
          <rect
            x="-80"
            y="-30"
            width="160"
            height="60"
            rx="12"
            fill="#1f2937"
            stroke="url(#client-gradient)"
            strokeWidth="2"
            filter="url(#glow-yellow)"
          />
          <text x="0" y="-5" textAnchor="middle" className="fill-yellow-400 text-sm font-bold">
            EffState
          </text>
          <text x="0" y="12" textAnchor="middle" className="fill-gray-400 text-[10px]">
            Client-Side Machine
          </text>
          {pendingMutations > 0 && (
            <circle cx="70" cy="-20" r="6" className="fill-yellow-500 animate-ping" />
          )}
          <circle
            cx="70"
            cy="-20"
            r="4"
            className={pendingMutations > 0 ? "fill-yellow-400" : "fill-gray-600"}
          />
        </g>

        {/* Server box (Convex) */}
        <g transform="translate(200, 250)">
          <rect
            x="-80"
            y="-30"
            width="160"
            height="60"
            rx="12"
            fill="#1f2937"
            stroke="url(#server-gradient)"
            strokeWidth="2"
            filter="url(#glow-purple)"
          />
          <text x="0" y="-5" textAnchor="middle" className="fill-blue-400 text-sm font-bold">
            Convex
          </text>
          <text x="0" y="12" textAnchor="middle" className="fill-gray-400 text-[10px]">
            Server + Real-time Sync
          </text>
          {isSyncing && <circle cx="70" cy="-20" r="6" className="fill-blue-500 animate-ping" />}
          <circle
            cx="70"
            cy="-20"
            r="4"
            className={isSyncing ? "fill-blue-400" : "fill-gray-600"}
          />
        </g>

        {/* Labels */}
        <g transform="translate(90, 110)">
          <text className="fill-yellow-500/70 text-[9px] font-medium">OPTIMISTIC</text>
          <text y="10" className="fill-yellow-500/50 text-[8px]">Instant UI</text>
        </g>
        <g transform="translate(250, 110)">
          <text className="fill-green-500/70 text-[9px] font-medium">MUTATION</text>
          <text y="10" className="fill-green-500/50 text-[8px]">Persist</text>
        </g>
        <g transform="translate(90, 180)">
          <text className="fill-purple-500/70 text-[9px] font-medium">SYNC</text>
          <text y="10" className="fill-purple-500/50 text-[8px]">Real-time</text>
        </g>
        <g transform="translate(250, 180)">
          <text className="fill-red-500/70 text-[9px] font-medium">CORRECT</text>
          <text y="10" className="fill-red-500/50 text-[8px]">_syncSnapshot</text>
        </g>

        {/* Animated packets */}
        {packets.map((packet) => {
          const startY = packet.direction === "up" ? 80 : 220;
          const endY = packet.direction === "up" ? 220 : 80;
          const currentY = startY + (endY - startY) * packet.progress;
          const xOffset = packet.direction === "up" ? -30 : 30;
          const style = packetStyles[packet.type];

          return (
            <g
              key={packet.id}
              transform={`translate(${200 + xOffset}, ${currentY})`}
              style={{ opacity: 1 - packet.progress * 0.3 }}
            >
              {/* Packet glow */}
              <circle r="20" className={cn("animate-pulse", style.glow)} />
              {/* Packet body */}
              <circle r="12" className={cn("transition-all", style.fill)} />
              {/* Packet label */}
              <text
                y="3"
                textAnchor="middle"
                className="fill-white text-[7px] font-bold pointer-events-none"
              >
                {packet.label}
              </text>
              {/* Trail effect */}
              {[...Array(3)].map((_, i) => {
                const trailY = packet.direction === "up" ? -15 - i * 8 : 15 + i * 8;
                return (
                  <circle
                    key={i}
                    cy={trailY}
                    r={6 - i * 2}
                    className={style.fill}
                    style={{ opacity: 0.3 - i * 0.1 }}
                  />
                );
              })}
            </g>
          );
        })}

        {/* Legend */}
        <g transform="translate(20, 280)">
          <circle cx="0" cy="0" r="4" className="fill-yellow-500" />
          <text x="10" y="3" className="fill-gray-400 text-[8px]">
            Event
          </text>
          <circle cx="50" cy="0" r="4" className="fill-green-500" />
          <text x="60" y="3" className="fill-gray-400 text-[8px]">
            Confirm
          </text>
          <circle cx="110" cy="0" r="4" className="fill-purple-500" />
          <text x="120" y="3" className="fill-gray-400 text-[8px]">
            Sync
          </text>
          <circle cx="155" cy="0" r="4" className="fill-red-500" />
          <text x="165" y="3" className="fill-gray-400 text-[8px]">
            Correct
          </text>
        </g>
      </svg>
    </div>
  );
}
