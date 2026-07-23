import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { useDoorStore, getDoorStateLabel, getDoorButtonLabel } from "@/stores/door";

export function GarageDoor() {
  const { state, position, isPowered, weather, click, powerOn, powerOff, tick } = useDoorStore();

  // Animation loop - external to store
  useEffect(() => {
    if (state === "opening" || state === "closing") {
      const delta = state === "opening" ? 0.16 : -0.16;
      const interval = setInterval(() => tick(delta), 16);
      return () => clearInterval(interval);
    }
  }, [state, tick]);

  const doorHeight = 100 - position;
  const bgColor = isPowered ? "bg-green-950" : "bg-red-950";

  return (
    <div className={cn("flex flex-col items-center gap-4 p-6 rounded-lg transition-colors", bgColor)}>
      <h2 className="text-xl font-bold">Garage Door (Zustand)</h2>

      {/* Power Toggle */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-400">Power:</span>
        <button
          onClick={isPowered ? powerOff : powerOn}
          className={cn(
            "px-3 py-1 rounded text-sm font-medium transition-colors",
            isPowered ? "bg-green-600 text-white" : "bg-red-600 text-white"
          )}
        >
          {isPowered ? "ON" : "OFF"}
        </button>
      </div>

      {/* Weather Display */}
      {weather.status === "loaded" && (
        <div className="flex items-center gap-2 text-sm bg-blue-900/50 px-3 py-1 rounded">
          <span>{weather.temp}°F</span>
          <span>{weather.desc}</span>
        </div>
      )}
      {weather.status === "loading" && (
        <div className="text-sm text-gray-400">Loading weather...</div>
      )}

      {/* Garage Frame */}
      <div className="relative w-40 h-28 border-4 border-gray-600 rounded-t-lg overflow-hidden bg-gray-900">
        {/* Inside */}
        <div className="absolute inset-0 flex items-center justify-center text-3xl">
          {state === "open" ? "🚗" : ""}
        </div>

        {/* Door */}
        <div
          className="absolute top-0 left-0 right-0 bg-gradient-to-b from-gray-400 to-gray-500 border-b-2 border-gray-600 transition-none"
          style={{ height: `${doorHeight}%` }}
        >
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="border-b border-gray-600" style={{ height: "25%" }} />
          ))}
        </div>

        {/* Progress bar */}
        <div className="absolute bottom-1 left-1 right-1">
          <div className="h-1 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 transition-none rounded-full"
              style={{ width: `${position}%` }}
            />
          </div>
        </div>
      </div>

      {/* Floor */}
      <div className="w-40 h-2 -mt-4 bg-gray-600 rounded-b" />

      {/* Status */}
      <div className="text-center">
        <div className="text-lg font-medium">{getDoorStateLabel(state)}</div>
        <div className="text-sm text-gray-500">{position.toFixed(0)}%</div>
      </div>

      {/* Button */}
      <button
        onClick={click}
        disabled={!isPowered && (state === "closed" || state === "pausedOpening" || state === "pausedClosing")}
        className={cn(
          "px-6 py-2 rounded font-medium transition-colors",
          isPowered
            ? "bg-blue-600 hover:bg-blue-500 text-white"
            : "bg-gray-700 text-gray-400 cursor-not-allowed"
        )}
      >
        {getDoorButtonLabel(state)}
      </button>
    </div>
  );
}
