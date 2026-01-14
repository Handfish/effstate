/**
 * Level 1 - Dashboard (Top Level)
 *
 * Receives events from deeply nested children via EventBus.
 * Demonstrates that Level 5 components can trigger actions here
 * without any prop drilling through levels 2-4.
 */

import { useEffect, useState } from "react";
import { useEventSubscription, type AppEvent } from "@/context/EventBus";
import { Level2_Section } from "./Level2_Section";
import { cn } from "@/lib/utils";

interface Level1Props {
  hamsterIsPowered: boolean;
  onToggleHamster: () => void;
  onClickDoor: (door: "left" | "right") => void;
}

export function Level1_Dashboard({ hamsterIsPowered, onToggleHamster, onClickDoor }: Level1Props) {
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const [eventCount, setEventCount] = useState(0);

  // Subscribe to ALL events that bubble up from deep components
  useEventSubscription((event: AppEvent) => {
    setLastEvent(`${event.type} @ ${new Date().toLocaleTimeString()}`);
    setEventCount((c) => c + 1);

    // Handle events from deep components
    switch (event.type) {
      case "TOGGLE_HAMSTER":
        onToggleHamster();
        break;
      case "CLICK_DOOR":
        onClickDoor(event.door);
        break;
      case "WAKE_HAMSTER_FOR_DOOR":
        // Wake hamster when requested from a door component
        if (!hamsterIsPowered) {
          onToggleHamster();
        }
        break;
      case "DEEP_COMPONENT_ACTION":
        console.log("[Level1] Received deep action:", event.action, event.payload);
        break;
      case "NOTIFICATION":
        console.log(`[Level1] ${event.level.toUpperCase()}: ${event.message}`);
        break;
    }
  });

  // Clear last event display after 3 seconds
  useEffect(() => {
    if (lastEvent) {
      const timer = setTimeout(() => setLastEvent(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [lastEvent]);

  return (
    <div className="border-2 border-blue-500 rounded-lg p-4 bg-blue-500/10">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-blue-400">Level 1: Dashboard</h2>
        <div className="text-xs text-gray-400">
          Events received: {eventCount}
        </div>
      </div>

      {/* Event indicator */}
      <div
        className={cn(
          "mb-3 px-3 py-2 rounded text-sm transition-all duration-300",
          lastEvent
            ? "bg-green-500/20 text-green-400"
            : "bg-gray-700/50 text-gray-500"
        )}
      >
        {lastEvent ? `Last event: ${lastEvent}` : "Waiting for events from Level 5..."}
      </div>

      {/* Pass power state down - this is the ONLY prop that flows through all levels */}
      <Level2_Section hamsterIsPowered={hamsterIsPowered} />
    </div>
  );
}
