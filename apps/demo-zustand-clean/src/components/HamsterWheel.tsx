import { Button } from "@/components/ui/button";
import { getHamsterStateLabel, getHamsterButtonLabel } from "@/stores/hamster";
import { cn } from "@/lib/utils";

const LightBulb = ({ on }: { on: boolean }) => (
  <div className={cn(
    "text-2xl md:text-4xl transition-all duration-500",
    on ? "text-amber-300 drop-shadow-[0_0_10px_rgba(251,191,36,0.5)]" : "text-gray-600"
  )}>
    💡
  </div>
);

interface HamsterWheelProps {
  stateTag: "Idle" | "Running" | "Stopping";
  wheelRotation: number;
  electricityLevel: number;
  onToggle: () => void;
}

export function HamsterWheel({ stateTag, wheelRotation, electricityLevel, onToggle }: HamsterWheelProps) {
  const isRunning = stateTag === "Running";
  const isStopping = stateTag === "Stopping";
  const isIdle = stateTag === "Idle";
  const hasElectricity = electricityLevel > 0;

  return (
    <div className="flex flex-col items-center justify-center p-4 md:p-8">
      <h2 className={cn(
        "text-xl md:text-2xl font-bold mb-4 md:mb-8 transition-colors duration-500 text-center",
        hasElectricity ? "text-gray-100" : "text-gray-300"
      )}>
        Hamster Power Generator
      </h2>

      {/* Light bulbs */}
      <div className="flex gap-2 md:gap-4 mb-4 md:mb-8">
        <LightBulb on={hasElectricity} />
        <LightBulb on={hasElectricity} />
        <LightBulb on={hasElectricity} />
      </div>

      {/* Electricity flow */}
      <div className="flex gap-2 mb-2 md:mb-4 h-6 md:h-8">
        {hasElectricity && (
          <>
            <span className="text-lg md:text-2xl text-amber-400 animate-pulse">⚡</span>
            <span className="text-lg md:text-2xl text-amber-400 animate-pulse" style={{ animationDelay: "100ms" }}>⚡</span>
            <span className="text-lg md:text-2xl text-amber-400 animate-pulse" style={{ animationDelay: "200ms" }}>⚡</span>
          </>
        )}
      </div>

      {/* Hamster wheel */}
      <div className="relative mb-4 md:mb-8 w-32 h-32 md:w-48 md:h-48">
        <div
          className={cn(
            "absolute inset-0 rounded-full border-4 md:border-8",
            hasElectricity ? "border-amber-700 bg-amber-100/80" : "border-gray-600 bg-gray-800"
          )}
          style={{
            transform: `rotate(${wheelRotation}deg)`,
            transition: isRunning ? "none" : "transform 0.5s ease-out",
          }}
        >
          {[0, 45, 90, 135].map((angle) => (
            <div
              key={angle}
              className={cn("absolute top-1/2 left-1/2 w-full h-1 origin-center", hasElectricity ? "bg-amber-700" : "bg-gray-600")}
              style={{ transform: `translate(-50%, -50%) rotate(${angle}deg)` }}
            />
          ))}
          <div
            className={cn("absolute w-6 h-6 md:w-9 md:h-9 rounded-full left-1/2 -translate-x-1/2", hasElectricity ? "bg-amber-700" : "bg-gray-600")}
            style={{ top: "-20px" }}
          />
        </div>

        {/* Center hub */}
        <div className={cn(
          "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-5 md:w-8 md:h-8 rounded-full z-10",
          hasElectricity ? "bg-amber-800" : "bg-gray-700"
        )} />

        {/* Hamster */}
        <div
          className={cn("absolute text-3xl md:text-5xl z-20 transition-[top,left] duration-300", isRunning && "animate-bounce")}
          style={{
            top: isRunning ? "55%" : "50%",
            left: isRunning ? "60%" : "50%",
            transform: "translate(-50%, -50%)",
          }}
        >
          {isIdle ? "😴" : "🐹"}
        </div>

        {isRunning && (
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-xs md:text-sm text-gray-300 whitespace-nowrap z-20">
            *running noises*
          </div>
        )}
      </div>

      {/* Generator */}
      <div className={cn(
        "w-24 h-12 md:w-32 md:h-16 rounded-lg flex items-center justify-center text-xl md:text-2xl mb-4 md:mb-8 transition-all duration-500",
        hasElectricity ? "bg-emerald-600 shadow-md shadow-emerald-600/30" : "bg-gray-700"
      )}>
        {hasElectricity ? "🔋" : "🪫"}
      </div>

      {/* Status */}
      <div className={cn("text-center space-y-1 mb-4 md:mb-6", hasElectricity ? "text-gray-100" : "text-gray-300")}>
        <div className="text-base md:text-lg font-medium">{getHamsterStateLabel(stateTag)}</div>
        <div className="text-xs md:text-sm">Electricity: {electricityLevel}%</div>
        {isStopping && <div className="text-xs md:text-sm text-orange-500 animate-pulse">Power shutting down in 2 seconds...</div>}
      </div>

      {/* Button */}
      <Button
        onClick={onToggle}
        size="lg"
        variant={isRunning ? "destructive" : isStopping ? "secondary" : "default"}
        className="min-w-[140px] md:min-w-[160px]"
      >
        {getHamsterButtonLabel(stateTag)}
      </Button>
    </div>
  );
}
