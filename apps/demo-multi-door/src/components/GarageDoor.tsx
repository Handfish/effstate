import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import type { DoorActor } from "@/machines/door";
import { Click, getStateLabel, getButtonLabel } from "@/machines/door";

interface GarageDoorProps {
  actor: DoorActor;
  isSpecial?: boolean;
  label: string;
}

/**
 * GarageDoor component
 *
 * Receives an actor from parent - demonstrates that React's component
 * tree IS the hierarchy. No need for XState's spawn/sendParent.
 *
 * Parent can call actor.send() directly to communicate with this door.
 */
export function GarageDoor({ actor, isSpecial = false, label }: GarageDoorProps) {
  // Subscribe to actor's snapshot
  const snapshot = useSyncExternalStore(actor.subscribe, actor.getSnapshot, actor.getSnapshot);

  const { state, context } = snapshot;
  const doorHeight = 100 - context.position;

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 p-4 rounded-lg transition-all",
        isSpecial
          ? "bg-gradient-to-b from-purple-900/50 to-purple-800/30 ring-2 ring-purple-500"
          : "bg-gray-900/50",
      )}
    >
      {/* Title */}
      <h3 className={cn("text-lg font-bold", isSpecial ? "text-purple-300" : "text-gray-300")}>
        {label}
        {isSpecial && <span className="ml-2 text-xs">(receives messages)</span>}
      </h3>

      {/* Message Display (only for special door) */}
      {isSpecial && context.message && (
        <div className="bg-purple-600 text-white px-3 py-1 rounded-full text-sm animate-pulse">
          {context.message}
        </div>
      )}

      {/* Garage Frame */}
      <div
        className={cn(
          "relative w-32 h-24 border-4 rounded-t-lg overflow-hidden",
          isSpecial ? "border-purple-600 bg-purple-950" : "border-gray-700 bg-gray-900",
        )}
      >
        {/* Inside */}
        <div className="absolute inset-0 flex items-center justify-center text-gray-600 text-2xl">
          {state._tag === "Open" ? "🚗" : ""}
        </div>

        {/* Door Panels */}
        <div
          className={cn(
            "absolute top-0 left-0 right-0 border-b-2 transition-none",
            isSpecial
              ? "bg-gradient-to-b from-purple-400 to-purple-500 border-purple-600"
              : "bg-gradient-to-b from-gray-400 to-gray-500 border-gray-600",
          )}
          style={{ height: `${doorHeight}%` }}
        >
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={cn("border-b", isSpecial ? "border-purple-600" : "border-gray-600")}
              style={{ height: "25%" }}
            />
          ))}
        </div>

        {/* Progress bar */}
        <div className="absolute bottom-1 left-1 right-1">
          <div className="h-1 bg-gray-700 rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full transition-none rounded-full",
                isSpecial ? "bg-purple-400" : "bg-green-500",
              )}
              style={{ width: `${context.position}%` }}
            />
          </div>
        </div>
      </div>

      {/* Floor */}
      <div
        className={cn("w-32 h-2 -mt-3 rounded-b", isSpecial ? "bg-purple-700" : "bg-gray-600")}
      />

      {/* Status */}
      <div className="text-center">
        <div className="text-sm font-medium">{getStateLabel(state)}</div>
        <div className="text-xs text-gray-500">{context.position.toFixed(0)}%</div>
      </div>

      {/* Control Button */}
      <button
        onClick={() => actor.send(new Click())}
        className={cn(
          "px-4 py-2 rounded font-medium text-sm transition-colors",
          isSpecial
            ? "bg-purple-600 hover:bg-purple-500 text-white"
            : "bg-gray-700 hover:bg-gray-600 text-white",
        )}
      >
        {getButtonLabel(state)}
      </button>
    </div>
  );
}
