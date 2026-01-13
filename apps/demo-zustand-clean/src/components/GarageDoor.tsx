import { Button } from "@/components/ui/button";
import { getDoorStateLabel, getDoorButtonLabel, type DoorState, type Weather } from "@/stores/door";
import { cn } from "@/lib/utils";

const WeatherDisplay = ({ weather }: { weather: Weather }) => {
  switch (weather.status) {
    case "loading":
      return <div className="text-gray-400 text-sm animate-pulse">Loading weather...</div>;
    case "loaded":
      return (
        <div className="flex flex-col items-center gap-1">
          <div className="text-3xl">{weather.icon}</div>
          <div className="text-white text-lg font-bold">{weather.temp}°F</div>
          <div className="text-gray-300 text-xs">{weather.desc}</div>
        </div>
      );
    case "error":
      return <div className="text-red-400 text-xs">{weather.message}</div>;
    default:
      return <div className="text-gray-600 text-sm">Garage Interior</div>;
  }
};

interface GarageDoorProps {
  stateTag: DoorState;
  position: number;
  weather: Weather;
  hasPower: boolean;
  title: string;
  onClick: () => void;
  onWakeHamster: () => void;
}

export function GarageDoor({ stateTag, position, weather, hasPower, title, onClick, onWakeHamster }: GarageDoorProps) {
  const doorHeight = 100 - position;

  return (
    <div className={cn(
      "flex flex-col items-center gap-4 md:gap-6 p-4 md:p-8 rounded-lg transition-all duration-500",
      !hasPower && "opacity-70"
    )}>
      <div className="flex items-center gap-2">
        <h2 className={cn(
          "text-xl md:text-2xl font-bold transition-colors duration-500",
          hasPower ? "text-gray-100" : "text-gray-300"
        )}>
          {title}
        </h2>
        {!hasPower && <span className="text-red-500 text-lg md:text-xl">🔌</span>}
      </div>

      {/* Garage Frame */}
      <div className="relative w-48 h-36 md:w-64 md:h-48 border-4 border-gray-700 rounded-t-lg bg-gray-900 overflow-hidden">
        <div className="absolute inset-0 bg-gray-800 flex items-center justify-center">
          <WeatherDisplay weather={weather} />
        </div>
        <div
          className="absolute top-0 left-0 right-0 bg-gradient-to-b from-gray-400 to-gray-500 border-b-2 border-gray-600 transition-none"
          style={{ height: `${doorHeight}%` }}
        >
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="border-b border-gray-600" style={{ height: "25%" }} />
          ))}
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-8 h-2 bg-gray-700 rounded" />
        </div>
        <div className="absolute bottom-2 left-2 right-2">
          <div className="h-1 bg-gray-700 rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full transition-none rounded-full",
                stateTag === "Opening" || stateTag === "PausedOpening" || stateTag === "Open"
                  ? "bg-green-500"
                  : "bg-orange-500"
              )}
              style={{ width: `${position}%` }}
            />
          </div>
        </div>
      </div>

      <div className="w-48 md:w-64 h-3 md:h-4 bg-gray-600 -mt-4 md:-mt-6 rounded-b" />

      <div className={cn(
        "text-center space-y-1 transition-colors duration-500",
        hasPower ? "text-gray-100" : "text-gray-300"
      )}>
        <div className="text-base md:text-lg font-medium">{getDoorStateLabel(stateTag)}</div>
        <div className="text-xs md:text-sm opacity-70">Position: {position.toFixed(0)}%</div>
      </div>

      <Button
        onClick={onClick}
        size="lg"
        variant={stateTag.includes("Paused") ? "secondary" : stateTag === "Opening" || stateTag === "Closing" ? "destructive" : "default"}
        className="min-w-28 md:min-w-32"
        disabled={!hasPower}
      >
        {!hasPower ? "No Power" : getDoorButtonLabel(stateTag)}
      </Button>

      {!hasPower && (
        <Button onClick={onWakeHamster} size="lg" variant="outline" className="min-w-28 md:min-w-32 border-orange-500 text-orange-500 hover:bg-orange-500 hover:text-white text-xs md:text-sm">
          🔨 Wake Hamster
        </Button>
      )}
    </div>
  );
}
