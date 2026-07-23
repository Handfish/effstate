import { Button } from "@/components/ui/button";
import { getDoorStateLabel, getDoorButtonLabel } from "@/hooks/useAppState";
import type { DoorState, DoorContext } from "@/machines";
import { cn } from "@/lib/utils";

const isPaused = (stateTag: DoorState["_tag"]): boolean =>
  stateTag === "PausedOpening" || stateTag === "PausedClosing";

const isAnimating = (stateTag: DoorState["_tag"]): boolean =>
  stateTag === "Opening" || stateTag === "Closing";

type Weather = DoorContext["weather"];

const WeatherDisplay = ({ weather }: { weather: Weather }) => {
  switch (weather.status) {
    case "loading":
      return (
        <div className="text-gray-400 text-sm animate-pulse">Loading weather...</div>
      );
    case "loaded":
      return (
        <div className="flex flex-col items-center gap-1">
          <div className="text-3xl">{weather.icon}</div>
          <div className="text-white text-lg font-bold">{weather.temp}°F</div>
          <div className="text-gray-300 text-xs">{weather.desc}</div>
        </div>
      );
    case "error":
      return (
        <div className="flex flex-col items-center gap-1">
          <div className="text-2xl">⚠️</div>
          <div className="text-red-400 text-xs text-center px-2">{weather.message}</div>
        </div>
      );
    default:
      return <div className="text-gray-600 text-sm">Garage Interior</div>;
  }
};

interface GarageDoorProps {
  doorState: DoorState;
  doorContext: DoorContext;
  hasPower: boolean;
  title: string;
  mobileTitle?: string;
  onClick: () => void;
  onWakeHamster: () => void;
}

export const GarageDoor = ({
  doorState,
  doorContext,
  hasPower,
  title,
  mobileTitle,
  onClick,
  onWakeHamster,
}: GarageDoorProps) => {
  const stateTag = doorState._tag;
  const doorHeight = 100 - doorContext.position;
  const isPausedDueToNoPower = !hasPower && isAnimating(stateTag);

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-4 md:gap-6 p-4 md:p-8 rounded-lg transition-all duration-500",
        !hasPower && "opacity-70"
      )}
    >
      <div className="flex items-center gap-2">
        <h2
          className={cn(
            "text-xl md:text-2xl font-bold transition-colors duration-500",
            hasPower ? "text-gray-100" : "text-gray-300"
          )}
        >
          {mobileTitle ? (
            <>
              <span className="lg:hidden">{mobileTitle}</span>
              <span className="hidden lg:inline">{title}</span>
            </>
          ) : (
            title
          )}
        </h2>
        {!hasPower && (
          <span className="text-red-500 text-lg md:text-xl" title="No Power">
            🔌
          </span>
        )}
      </div>

      {/* Garage Frame */}
      <div className="relative w-48 h-36 md:w-64 md:h-48 border-4 border-gray-700 rounded-t-lg bg-gray-900 overflow-hidden">
        {/* Inside of garage */}
        <div className="absolute inset-0 bg-gray-800 flex items-center justify-center">
          <WeatherDisplay weather={doorContext.weather} />
        </div>

        {/* Door Panels */}
        <div
          className="absolute top-0 left-0 right-0 bg-gradient-to-b from-gray-400 to-gray-500 border-b-2 border-gray-600 transition-none"
          style={{ height: `${doorHeight}%` }}
        >
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="border-b border-gray-600" style={{ height: "25%" }} />
          ))}
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-8 h-2 bg-gray-700 rounded" />
        </div>

        {/* Progress indicator */}
        <div className="absolute bottom-2 left-2 right-2">
          <div className="h-1 bg-gray-700 rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full transition-none rounded-full",
                stateTag === "Opening" || stateTag === "PausedOpening"
                  ? "bg-green-500"
                  : stateTag === "Closing" || stateTag === "PausedClosing"
                    ? "bg-orange-500"
                    : stateTag === "Open"
                      ? "bg-green-500"
                      : "bg-gray-500"
              )}
              style={{ width: `${doorContext.position}%` }}
            />
          </div>
        </div>
      </div>

      {/* Floor/Driveway */}
      <div className="w-48 md:w-64 h-3 md:h-4 bg-gray-600 -mt-4 md:-mt-6 rounded-b" />

      {/* Status Display */}
      <div
        className={cn(
          "text-center space-y-1 transition-colors duration-500",
          hasPower ? "text-gray-100" : "text-gray-300"
        )}
      >
        <div className="text-base md:text-lg font-medium">{getDoorStateLabel(doorState)}</div>
        <div className="text-xs md:text-sm opacity-70">Position: {doorContext.position.toFixed(0)}%</div>
        {isPausedDueToNoPower && (
          <div className="text-xs md:text-sm text-orange-500 animate-pulse">Paused - No Power</div>
        )}
      </div>

      {/* Control Button */}
      <Button
        onClick={onClick}
        size="lg"
        variant={isPaused(stateTag) ? "secondary" : isAnimating(stateTag) ? "destructive" : "default"}
        className="min-w-28 md:min-w-32"
        disabled={!hasPower}
      >
        {!hasPower ? "No Power" : getDoorButtonLabel(doorState)}
      </Button>

      {/* Wake Hamster Button */}
      {!hasPower && (
        <Button
          onClick={onWakeHamster}
          size="lg"
          variant="outline"
          className="min-w-28 md:min-w-32 border-orange-500 text-orange-500 hover:bg-orange-500 hover:text-white text-xs md:text-sm"
        >
          🔨 Wake Hamster
        </Button>
      )}

      {/* Debug Info */}
      <div
        className={cn(
          "text-[10px] md:text-xs mt-2 md:mt-4 p-3 md:p-4 rounded-lg font-mono transition-colors duration-500 w-full max-w-[200px] md:max-w-none",
          hasPower ? "bg-gray-700 text-gray-100" : "bg-gray-800 text-gray-300"
        )}
      >
        <div>State: {stateTag}</div>
        <div>Position: {doorContext.position.toFixed(2)}%</div>
        <div>Power: {hasPower ? "On" : "Off"}</div>
        {isPausedDueToNoPower && <div className="text-orange-400">Animation Paused (no power)</div>}
        <div className="mt-2 text-[8px] md:text-[10px]">
          Click behavior:
          {stateTag === "Closed" && " Start opening"}
          {stateTag === "Opening" && " Pause (will close on resume)"}
          {stateTag === "PausedOpening" && " Close door"}
          {stateTag === "Open" && " Start closing"}
          {stateTag === "Closing" && " Pause (will open on resume)"}
          {stateTag === "PausedClosing" && " Open door"}
        </div>
      </div>
    </div>
  );
};
