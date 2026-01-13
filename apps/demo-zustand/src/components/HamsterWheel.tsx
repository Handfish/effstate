import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { useHamsterStore, getHamsterStateLabel, getHamsterButtonLabel } from "@/stores/hamster";

export function HamsterWheel() {
  const { state, wheelRotation, electricityLevel, toggle, tick } = useHamsterStore();

  // Animation loop - external to store
  useEffect(() => {
    if (state === "running") {
      const interval = setInterval(() => tick(5), 16);
      return () => clearInterval(interval);
    }
  }, [state, tick]);

  return (
    <div className="flex flex-col items-center gap-4 p-6 rounded-lg bg-amber-950/50">
      <h2 className="text-xl font-bold">Hamster Wheel (Zustand)</h2>

      {/* Wheel */}
      <div className="relative w-32 h-32">
        {/* Outer ring */}
        <div className="absolute inset-0 rounded-full border-4 border-amber-600" />

        {/* Spokes */}
        <div
          className="absolute inset-2 rounded-full border-2 border-amber-500/50"
          style={{ transform: `rotate(${wheelRotation}deg)` }}
        >
          <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-amber-500/50" />
          <div className="absolute top-0 bottom-0 left-1/2 w-0.5 bg-amber-500/50" />
          <div
            className="absolute top-1/2 left-0 right-0 h-0.5 bg-amber-500/50"
            style={{ transform: "rotate(45deg)" }}
          />
          <div
            className="absolute top-1/2 left-0 right-0 h-0.5 bg-amber-500/50"
            style={{ transform: "rotate(-45deg)" }}
          />
        </div>

        {/* Center / Hamster */}
        <div className="absolute inset-0 flex items-center justify-center text-3xl">
          {state === "idle" ? "😴" : state === "running" ? "🐹" : "😮‍💨"}
        </div>
      </div>

      {/* Electricity meter */}
      <div className="w-full max-w-[200px]">
        <div className="flex justify-between text-sm text-gray-400 mb-1">
          <span>Electricity</span>
          <span>{electricityLevel}%</span>
        </div>
        <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full transition-all duration-300 rounded-full",
              electricityLevel > 50 ? "bg-yellow-500" : electricityLevel > 20 ? "bg-orange-500" : "bg-red-500"
            )}
            style={{ width: `${electricityLevel}%` }}
          />
        </div>
      </div>

      {/* Status */}
      <div className="text-center">
        <div className="text-lg font-medium">{getHamsterStateLabel(state)}</div>
        <div className="text-sm text-gray-500">Rotation: {wheelRotation.toFixed(0)}°</div>
      </div>

      {/* Button */}
      <button
        onClick={toggle}
        className={cn(
          "px-6 py-2 rounded font-medium transition-colors",
          state === "idle"
            ? "bg-green-600 hover:bg-green-500 text-white"
            : state === "running"
            ? "bg-red-600 hover:bg-red-500 text-white"
            : "bg-amber-600 hover:bg-amber-500 text-white"
        )}
      >
        {getHamsterButtonLabel(state)}
      </button>
    </div>
  );
}
