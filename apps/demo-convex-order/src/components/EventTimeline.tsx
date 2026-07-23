import { Match, pipe } from "effect";
import { cn } from "@/lib/utils";
import { useRef, useEffect } from "react";
import type { TimelineEvent } from "@/hooks/useOrderState";

// Re-export for convenience
export type { TimelineEvent };

// ============================================================================
// Event Type Styling (Match-based)
// ============================================================================

type EventType = TimelineEvent["type"];

interface EventTypeStyle {
  readonly color: string;
  readonly bgColor: string;
  readonly border: string;
  readonly icon: string;
  readonly label: string;
}

/** Get style configuration for an event type */
const getEventStyle = (type: EventType): EventTypeStyle =>
  pipe(
    Match.value(type),
    Match.when("optimistic", () => ({
      color: "text-yellow-400",
      bgColor: "bg-yellow-500/20",
      border: "border-yellow-500",
      icon: "O",
      label: "Optimistic Update",
    })),
    Match.when("server_confirmed", () => ({
      color: "text-green-400",
      bgColor: "bg-green-500/20",
      border: "border-green-500",
      icon: "C",
      label: "Server Confirmed",
    })),
    Match.when("server_correction", () => ({
      color: "text-red-400",
      bgColor: "bg-red-500/20",
      border: "border-red-500",
      icon: "!",
      label: "Server Correction",
    })),
    Match.when("external_update", () => ({
      color: "text-purple-400",
      bgColor: "bg-purple-500/20",
      border: "border-purple-500",
      icon: "S",
      label: "External Sync",
    })),
    Match.exhaustive
  );

/** All event types for legend rendering */
const eventTypes: readonly EventType[] = [
  "optimistic",
  "server_confirmed",
  "server_correction",
  "external_update",
];

// ============================================================================
// Component
// ============================================================================

interface EventTimelineProps {
  events: TimelineEvent[];
  className?: string;
}

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
        {eventTypes.map((type) => {
          const style = getEventStyle(type);
          return (
            <div key={type} className="flex items-center gap-1">
              <span
                className={cn(
                  "w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold",
                  style.bgColor,
                  style.color
                )}
              >
                {style.icon}
              </span>
              <span className="text-gray-500">{style.label}</span>
            </div>
          );
        })}
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
            const style = getEventStyle(event.type);
            return (
              <div
                key={event.id}
                className={cn(
                  "flex items-start gap-3 p-2 rounded border-l-2 transition-all",
                  style.bgColor,
                  style.border
                )}
              >
                <span
                  className={cn(
                    "w-6 h-6 rounded flex items-center justify-center text-xs font-bold shrink-0",
                    style.bgColor,
                    style.color
                  )}
                >
                  {style.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn("font-mono text-sm font-medium", style.color)}>
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
                    <span className={style.color}>{event.toState}</span>
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
