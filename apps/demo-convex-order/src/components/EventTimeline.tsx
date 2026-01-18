import { cn } from "@/lib/utils";
import { useRef, useEffect } from "react";
import type { TimelineEvent } from "@/hooks/useOrderState";

// Re-export for convenience
export type { TimelineEvent };

interface EventTimelineProps {
  events: TimelineEvent[];
  className?: string;
}

const typeConfig: Record<
  TimelineEvent["type"],
  { color: string; bgColor: string; icon: string; label: string }
> = {
  optimistic: {
    color: "text-yellow-400",
    bgColor: "bg-yellow-500/20",
    icon: "O",
    label: "Optimistic Update",
  },
  server_confirmed: {
    color: "text-green-400",
    bgColor: "bg-green-500/20",
    icon: "C",
    label: "Server Confirmed",
  },
  server_correction: {
    color: "text-red-400",
    bgColor: "bg-red-500/20",
    icon: "!",
    label: "Server Correction",
  },
  external_update: {
    color: "text-purple-400",
    bgColor: "bg-purple-500/20",
    icon: "S",
    label: "External Sync",
  },
};

export function EventTimeline({ events, className }: EventTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length]);

  return (
    <div className={cn("bg-gray-900 rounded-lg p-4 flex flex-col", className)}>
      <h3 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-blue-500" />
        Event Timeline
        <span className="ml-auto text-xs text-gray-500">{events.length} events</span>
      </h3>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mb-3 text-xs">
        {Object.entries(typeConfig).map(([key, config]) => (
          <div key={key} className="flex items-center gap-1">
            <span
              className={cn(
                "w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold",
                config.bgColor,
                config.color
              )}
            >
              {config.icon}
            </span>
            <span className="text-gray-500">{config.label}</span>
          </div>
        ))}
      </div>

      {/* Timeline */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-2 min-h-[200px] max-h-[300px] scrollbar-thin scrollbar-thumb-gray-700"
      >
        {events.length === 0 ? (
          <div className="text-center text-gray-500 text-sm py-8">
            No events yet. Interact with the order to see events appear here.
          </div>
        ) : (
          events.map((event) => {
            const config = typeConfig[event.type];
            return (
              <div
                key={event.id}
                className={cn(
                  "flex items-start gap-3 p-2 rounded border-l-2 transition-all",
                  config.bgColor,
                  event.type === "server_correction"
                    ? "border-red-500"
                    : event.type === "server_confirmed"
                      ? "border-green-500"
                      : event.type === "optimistic"
                        ? "border-yellow-500"
                        : "border-purple-500"
                )}
              >
                <span
                  className={cn(
                    "w-6 h-6 rounded flex items-center justify-center text-xs font-bold shrink-0",
                    config.bgColor,
                    config.color
                  )}
                >
                  {config.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn("font-mono text-sm font-medium", config.color)}>
                      {event.eventTag ?? event.type}
                    </span>
                    <span className="text-xs text-gray-500">
                      {event.timestamp.toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    <span className="text-gray-500">{event.fromState}</span>
                    <span className="mx-1 text-gray-600">→</span>
                    <span className={config.color}>{event.toState}</span>
                  </div>
                  {event.details && (
                    <div className="text-xs text-gray-500 mt-1 font-mono">{event.details}</div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
