import { Button } from "@/components/ui/button";
import {
  type GarageDoorState,
  getButtonLabel,
  getStateLabel,
  useGarageDoor,
} from "@/data-access/garage-door-operations";
import { cn } from "@/lib/utils";

const isPaused = (state: GarageDoorState): boolean =>
  state === "paused-while-opening" || state === "paused-while-closing";

const isAnimating = (state: GarageDoorState): boolean =>
  state === "opening" || state === "closing";

export const GarageDoor = () => {
  const { status, handleButtonClick, isLoading } = useGarageDoor();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-muted-foreground">Initializing...</div>
      </div>
    );
  }

  // Door panel height based on position (0 = fully covering, 100 = fully retracted)
  const doorHeight = 100 - status.position;

  return (
    <div className="flex flex-col items-center gap-6 p-8">
      <h2 className="text-2xl font-bold">Garage Door Simulator</h2>

      {/* Garage Frame */}
      <div className="relative w-64 h-48 border-4 border-gray-700 rounded-t-lg bg-gray-900 overflow-hidden">
        {/* Inside of garage (visible when door opens) */}
        <div className="absolute inset-0 bg-gray-800 flex items-center justify-center">
          <div className="text-gray-600 text-sm">Garage Interior</div>
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
                status.state === "opening" || status.state === "paused-while-opening"
                  ? "bg-green-500"
                  : status.state === "closing" || status.state === "paused-while-closing"
                    ? "bg-orange-500"
                    : status.state === "open"
                      ? "bg-green-500"
                      : "bg-gray-500"
              )}
              style={{ width: `${status.position}%` }}
            />
          </div>
        </div>
      </div>

      {/* Floor/Driveway */}
      <div className="w-64 h-4 bg-gray-600 -mt-6 rounded-b" />

      {/* Status Display */}
      <div className="text-center space-y-1">
        <div className="text-lg font-medium">{getStateLabel(status.state)}</div>
        <div className="text-sm text-muted-foreground">
          Position: {status.position.toFixed(0)}%
        </div>
      </div>

      {/* Control Button */}
      <Button
        onClick={handleButtonClick}
        size="lg"
        variant={
          isPaused(status.state)
            ? "secondary"
            : isAnimating(status.state)
              ? "destructive"
              : "default"
        }
        className="min-w-32"
      >
        {getButtonLabel(status.state)}
      </Button>

      {/* State Machine Debug Info */}
      <div className="text-xs text-muted-foreground mt-4 p-4 bg-muted rounded-lg font-mono">
        <div>State: {status.state}</div>
        <div>Position: {status.position.toFixed(2)}%</div>
        <div className="mt-2 text-[10px]">
          Click behavior:
          {status.state === "closed" && " Start opening"}
          {status.state === "opening" && " Pause (will close on resume)"}
          {status.state === "paused-while-opening" && " Close door"}
          {status.state === "open" && " Start closing"}
          {status.state === "closing" && " Pause (will open on resume)"}
          {status.state === "paused-while-closing" && " Open door"}
        </div>
      </div>
    </div>
  );
};
