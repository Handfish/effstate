/**
 * Level 1 - Dashboard (Top Level)
 *
 * Receives events from Level 5 via EventBus context.
 * Events are handled in App.tsx, this just shows what's happening.
 */

import { useEffect, useState } from "react";
import { useEventSubscription, type AppEvent } from "@/context/EventBus";
import { Level2_Section } from "./Level2_Section";
import { cn } from "@/lib/utils";

interface Level1Props {
  hamsterIsPowered: boolean;
}

export function Level1_Dashboard({ hamsterIsPowered }: Level1Props) {
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const [eventCount, setEventCount] = useState(0);

  // Subscribe to see events flowing through (handled by App.tsx)
  useEventSubscription((appEvent: AppEvent) => {
    setLastEvent(`${appEvent.target}:${appEvent.event._tag}`);
    setEventCount((c) => c + 1);
  });

  useEffect(() => {
    if (lastEvent) {
      const timer = setTimeout(() => setLastEvent(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [lastEvent]);

  return (
    <div className="border-2 border-blue-500 rounded-lg p-4 bg-blue-500/10">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-blue-400">Level 1: Dashboard</h2>
        <div className="text-xs text-gray-400">Events: {eventCount}</div>
      </div>

      <div
        className={cn(
          "mb-3 px-3 py-2 rounded text-sm transition-all",
          lastEvent ? "bg-green-500/20 text-green-400" : "bg-gray-700/50 text-gray-500"
        )}
      >
        {lastEvent ? `Event: ${lastEvent}` : "Waiting for events from Level 5..."}
      </div>

      <Level2_Section hamsterIsPowered={hamsterIsPowered} />
    </div>
  );
}
