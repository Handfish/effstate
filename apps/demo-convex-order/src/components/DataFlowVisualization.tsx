import { useEffect, useState, useRef } from "react";
import { cn } from "@/lib/utils";

interface Packet {
  id: string;
  type: "optimistic" | "mutation" | "sync" | "correction";
  direction: "up" | "down";
  progress: number;
  label: string;
}

interface DataFlowVisualizationProps {
  isSyncing: boolean;
  pendingMutations: number;
  lastEventType?: "optimistic" | "server_confirmed" | "server_correction" | "external_update";
  className?: string;
}

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

    const newPacket: Packet = {
      id: `packet-${++packetIdRef.current}`,
      type:
        lastEventType === "optimistic"
          ? "optimistic"
          : lastEventType === "server_confirmed"
            ? "mutation"
            : lastEventType === "server_correction"
              ? "correction"
              : "sync", // external_update -> sync
      direction: lastEventType === "optimistic" ? "up" : "down",
      progress: 0,
      label:
        lastEventType === "optimistic"
          ? "EVENT"
          : lastEventType === "server_confirmed"
            ? "OK"
            : lastEventType === "server_correction"
              ? "SYNC"
              : "UPDATE", // external_update label
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
          {/* Pulse animation when active */}
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
          {/* Pulse when syncing */}
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

          return (
            <g
              key={packet.id}
              transform={`translate(${200 + xOffset}, ${currentY})`}
              style={{ opacity: 1 - packet.progress * 0.3 }}
            >
              {/* Packet glow */}
              <circle
                r="20"
                className={cn(
                  "animate-pulse",
                  packet.type === "optimistic"
                    ? "fill-yellow-500/20"
                    : packet.type === "mutation"
                      ? "fill-green-500/20"
                      : packet.type === "correction"
                        ? "fill-red-500/20"
                        : "fill-purple-500/20"
                )}
              />
              {/* Packet body */}
              <circle
                r="12"
                className={cn(
                  "transition-all",
                  packet.type === "optimistic"
                    ? "fill-yellow-500"
                    : packet.type === "mutation"
                      ? "fill-green-500"
                      : packet.type === "correction"
                        ? "fill-red-500"
                        : "fill-purple-500"
                )}
              />
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
                    className={cn(
                      packet.type === "optimistic"
                        ? "fill-yellow-500"
                        : packet.type === "mutation"
                          ? "fill-green-500"
                          : packet.type === "correction"
                            ? "fill-red-500"
                            : "fill-purple-500"
                    )}
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
