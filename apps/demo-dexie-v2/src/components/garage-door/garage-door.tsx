import { Button } from "@/components/ui/button";
import {
  type GarageDoorState,
  type WeatherStatus,
  AnimationComplete,
  BangHammer,
  Click,
  getButtonLabel,
  getStateLabel,
  getWeatherStatus,
} from "@/data-access/garage-door-operations";
import { useGarageDoorLeft } from "@/data-access/hamster-wheel-operations";
import { cn } from "@/lib/utils";

type GarageDoorHook = typeof useGarageDoorLeft;

const isPaused = (stateTag: GarageDoorState["_tag"]): boolean =>
  stateTag === "PausedWhileOpening" || stateTag === "PausedWhileClosing";

const isAnimatingState = (stateTag: GarageDoorState["_tag"]): boolean =>
  stateTag === "Opening" || stateTag === "Closing";

const WeatherDisplay = ({ weather }: { weather: WeatherStatus }) => {
  switch (weather._tag) {
    case "loading":
      return (
        <div className="text-gray-400 text-sm animate-pulse">
          Loading weather...
        </div>
      );
    case "loaded":
      return (
        <div className="flex flex-col items-center gap-1">
          <div className="text-3xl">{weather.weather.icon}</div>
          <div className="text-white text-lg font-bold">
            {weather.weather.temperature}°F
          </div>
          <div className="text-gray-300 text-xs">
            {weather.weather.description}
          </div>
        </div>
      );
    case "error":
      return (
        <div className="flex flex-col items-center gap-1">
          <div className="text-2xl">⚠️</div>
          <div className="text-red-400 text-xs text-center px-2">
            {weather.error}
          </div>
        </div>
      );
    default:
      return (
        <div className="text-gray-600 text-sm">Garage Interior</div>
      );
  }
};

interface GarageDoorProps {
  useHook?: GarageDoorHook;
  title?: string;
  mobileTitle?: string;
}

export const GarageDoor = ({ useHook = useGarageDoorLeft, title = "Garage Door", mobileTitle }: GarageDoorProps) => {
  const { send, isLoading, context, state, stateTag } = useHook();

  // Handle animation completion - use stateTag for comparisons (v2 API)
  const isOpening = stateTag === "Opening";
  const isClosing = stateTag === "Closing";

  if (context.position >= 100 && isOpening) {
    send(new AnimationComplete());
  } else if (context.position <= 0 && isClosing) {
    send(new AnimationComplete());
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-muted-foreground">Initializing...</div>
      </div>
    );
  }

  // Derive status from context
  const hasElectricity = context.isPowered;
  const isAnimatingNow = isOpening || isClosing;
  const isPausedDueToNoPower = !hasElectricity && isAnimatingNow;
  const status = {
    state,
    stateTag,
    position: context.position,
    weather: getWeatherStatus(context),
  };

  const handleButtonClick = () => send(new Click());

  // Door panel height based on position (0 = fully covering, 100 = fully retracted)
  const doorHeight = 100 - status.position;

  return (
    <div className={cn(
      "flex flex-col items-center gap-4 md:gap-6 p-4 md:p-8 rounded-lg transition-all duration-500",
      !hasElectricity && "opacity-70"
    )}>
      <div className="flex items-center gap-2">
        <h2 className={cn(
          "text-xl md:text-2xl font-bold transition-colors duration-500",
          hasElectricity ? "text-gray-100" : "text-gray-300"
        )}>
          {mobileTitle ? (
            <>
              <span className="lg:hidden">{mobileTitle}</span>
              <span className="hidden lg:inline">{title}</span>
            </>
          ) : (
            title
          )}
        </h2>
        {!hasElectricity && (
          <span className="text-red-500 text-lg md:text-xl" title="No Power">🔌</span>
        )}
      </div>

      {/* Garage Frame */}
      <div className="relative w-48 h-36 md:w-64 md:h-48 border-4 border-gray-700 rounded-t-lg bg-gray-900 overflow-hidden">
        {/* Inside of garage (visible when door opens) */}
        <div className="absolute inset-0 bg-gray-800 flex items-center justify-center">
          <WeatherDisplay weather={status.weather} />
        </div>

        {/* Door Panels */}
        <div
          className="absolute top-0 left-0 right-0 bg-gradient-to-b from-gray-400 to-gray-500 border-b-2 border-gray-600 transition-none"
          style={{ height: `${doorHeight}%` }}
        >
          {/* Door panel lines */}
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="border-b border-gray-600"
              style={{ height: "25%" }}
            />
          ))}

          {/* Door handle */}
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-8 h-2 bg-gray-700 rounded" />
        </div>

        {/* Progress indicator */}
        <div className="absolute bottom-2 left-2 right-2">
          <div className="h-1 bg-gray-700 rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full transition-none rounded-full",
                status.stateTag === "Opening" || status.stateTag === "PausedWhileOpening"
                  ? "bg-green-500"
                  : status.stateTag === "Closing" || status.stateTag === "PausedWhileClosing"
                    ? "bg-orange-500"
                    : status.stateTag === "Open"
                      ? "bg-green-500"
                      : "bg-gray-500"
              )}
              style={{ width: `${status.position}%` }}
            />
          </div>
        </div>
      </div>

      {/* Floor/Driveway */}
      <div className="w-48 md:w-64 h-3 md:h-4 bg-gray-600 -mt-4 md:-mt-6 rounded-b" />

      {/* Status Display */}
      <div className={cn(
        "text-center space-y-1 transition-colors duration-500",
        hasElectricity ? "text-gray-100" : "text-gray-300"
      )}>
        <div className="text-base md:text-lg font-medium">{getStateLabel(status.state)}</div>
        <div className="text-xs md:text-sm opacity-70">
          Position: {status.position.toFixed(0)}%
        </div>
        {isPausedDueToNoPower && (
          <div className="text-xs md:text-sm text-orange-500 animate-pulse">
            Paused - No Power
          </div>
        )}
      </div>

      {/* Control Button */}
      <Button
        onClick={handleButtonClick}
        size="lg"
        variant={
          isPaused(status.stateTag)
            ? "secondary"
            : isAnimatingState(status.stateTag)
              ? "destructive"
              : "default"
        }
        className="min-w-28 md:min-w-32"
        disabled={!hasElectricity}
      >
        {!hasElectricity ? "No Power" : getButtonLabel(status.state)}
      </Button>

      {/* Bang Hammer Button - Wake the hamster when there's no power! */}
      {!hasElectricity && (
        <Button
          onClick={() => send(new BangHammer())}
          size="lg"
          variant="outline"
          className="min-w-28 md:min-w-32 border-orange-500 text-orange-500 hover:bg-orange-500 hover:text-white text-xs md:text-sm"
        >
          🔨 Wake Hamster
        </Button>
      )}

      {/* State Machine Debug Info */}
      <div className={cn(
        "text-[10px] md:text-xs mt-2 md:mt-4 p-3 md:p-4 rounded-lg font-mono transition-colors duration-500 w-full max-w-[200px] md:max-w-none",
        hasElectricity ? "bg-gray-700 text-gray-100" : "bg-gray-800 text-gray-300"
      )}>
        <div>State: {status.stateTag}</div>
        <div>Position: {status.position.toFixed(2)}%</div>
        <div>Power: {hasElectricity ? "On" : "Off"}</div>
        {isPausedDueToNoPower && <div className="text-orange-400">Animation Paused (no power)</div>}
        <div className="mt-2 text-[8px] md:text-[10px]">
          Click behavior:
          {status.stateTag === "Closed" && " Start opening"}
          {status.stateTag === "Opening" && " Pause (will close on resume)"}
          {status.stateTag === "PausedWhileOpening" && " Close door"}
          {status.stateTag === "Open" && " Start closing"}
          {status.stateTag === "Closing" && " Pause (will open on resume)"}
          {status.stateTag === "PausedWhileClosing" && " Open door"}
        </div>
      </div>
    </div>
  );
};
