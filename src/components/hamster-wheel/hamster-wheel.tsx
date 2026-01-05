import { Button } from "@/components/ui/button";
import {
  getButtonLabel,
  getStateLabel,
  useHamsterWheel,
  useGarageDoorLeft,
  useGarageDoorRight,
} from "@/data-access/hamster-wheel-operations";
import { GarageDoor } from "@/components/garage-door/garage-door";
import { cn } from "@/lib/utils";

const ElectricityBolt = ({ active, delay }: { active: boolean; delay: number }) => (
  <div
    className={cn(
      "text-2xl transition-all duration-300",
      active ? "text-amber-400 animate-pulse" : "text-gray-600 opacity-50"
    )}
    style={{ animationDelay: `${delay}ms` }}
  >
    ⚡
  </div>
);

const LightBulb = ({ on }: { on: boolean }) => (
  <div className={cn(
    "text-4xl transition-all duration-500",
    on ? "text-amber-300 drop-shadow-[0_0_10px_rgba(251,191,36,0.5)]" : "text-gray-600"
  )}>
    💡
  </div>
);

const HamsterWheelContent = ({
  status,
  handleToggle,
}: {
  status: ReturnType<typeof useHamsterWheel>["status"];
  handleToggle: () => void;
}) => {
  const isRunning = status.state === "running";
  const isStopping = status.state === "stopping";
  const hasElectricity = status.electricityLevel > 0;

  return (
    <div className="flex flex-col items-center justify-center p-8">
      <h2 className={cn(
        "text-2xl font-bold mb-8 transition-colors duration-500",
        status.isDark ? "text-gray-300" : "text-gray-100"
      )}>
        Hamster Power Generator
      </h2>

      {/* Light bulbs */}
      <div className="flex gap-4 mb-8">
        <LightBulb on={hasElectricity} />
        <LightBulb on={hasElectricity} />
        <LightBulb on={hasElectricity} />
      </div>

      {/* Electricity flow */}
      <div className="flex gap-2 mb-4 h-8">
        {hasElectricity && (
          <>
            <ElectricityBolt active={hasElectricity} delay={0} />
            <ElectricityBolt active={hasElectricity} delay={100} />
            <ElectricityBolt active={hasElectricity} delay={200} />
          </>
        )}
      </div>

      {/* Hamster wheel container */}
      <div className="relative mb-8">
        {/* Wheel */}
        <div
          className={cn(
            "w-48 h-48 rounded-full border-8 relative",
            hasElectricity
              ? "border-amber-700 bg-amber-100/80"
              : "border-gray-600 bg-gray-800"
          )}
          style={{
            transform: `rotate(${status.wheelRotation}deg)`,
            transition: isRunning ? "none" : "transform 0.5s ease-out",
          }}
        >
          {/* Wheel spokes */}
          {[0, 45, 90, 135].map((angle) => (
            <div
              key={angle}
              className={cn(
                "absolute top-1/2 left-1/2 w-full h-1 -translate-x-1/2 -translate-y-1/2",
                hasElectricity ? "bg-amber-700" : "bg-gray-600"
              )}
              style={{ transform: `rotate(${angle}deg)` }}
            />
          ))}

          {/* Center hub */}
          <div
            className={cn(
              "absolute top-1/2 left-1/2 w-8 h-8 rounded-full -translate-x-1/2 -translate-y-1/2",
              hasElectricity ? "bg-amber-800" : "bg-gray-700"
            )}
          />
        </div>

        {/* Hamster */}
        <div
          className={cn(
            "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-5xl transition-transform duration-200",
            isRunning && "animate-bounce"
          )}
          style={{
            transform: `translate(-50%, -50%) ${isRunning ? "" : "scale(0.9)"}`,
            animation: status.state === "idle" ? "breathe 3s ease-in-out infinite" : undefined,
          }}
        >
          {status.state === "idle" ? "😴" : isRunning ? "🐹" : "🐹"}
        </div>
        <style>{`
          @keyframes breathe {
            0%, 100% { transform: translate(-50%, -50%) scale(0.85); }
            50% { transform: translate(-50%, -50%) scale(0.95); }
          }
        `}</style>

        {/* Running indicator */}
        {isRunning && (
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-sm text-gray-300 whitespace-nowrap flex">
            {"*running noises*".split("").map((char, i) => (
              <span
                key={i}
                className="inline-block animate-bounce"
                style={{
                  animationDelay: `${i * 50}ms`,
                  animationDuration: "600ms",
                }}
              >
                {char === " " ? "\u00A0" : char}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Generator */}
      <div className={cn(
        "w-32 h-16 rounded-lg flex items-center justify-center text-2xl mb-8 transition-all duration-500",
        hasElectricity
          ? "bg-emerald-600 shadow-md shadow-emerald-600/30"
          : "bg-gray-700"
      )}>
        {hasElectricity ? "🔋" : "🪫"}
      </div>

      {/* Status Display */}
      <div className={cn(
        "text-center space-y-1 mb-6",
        status.isDark ? "text-gray-300" : "text-gray-100"
      )}>
        <div className="text-lg font-medium">{getStateLabel(status.state)}</div>
        <div className="text-sm">
          Electricity: {status.electricityLevel}%
        </div>
        {isStopping && (
          <div className="text-sm text-orange-500 animate-pulse">
            Power shutting down in 2 seconds...
          </div>
        )}
      </div>

      {/* Control Button */}
      <Button
        onClick={handleToggle}
        size="lg"
        variant={isRunning ? "destructive" : isStopping ? "secondary" : "default"}
        className="min-w-[160px]"
      >
        {getButtonLabel(status.state)}
      </Button>

      {/* State Machine Debug Info */}
      <div className="text-xs mt-8 p-4 rounded-lg font-mono bg-gray-800 text-gray-400 w-[225px]">
        <div>State: {status.state}</div>
        <div>Wheel Rotation: {status.wheelRotation.toFixed(0)}°</div>
        <div>Electricity: {status.electricityLevel}%</div>
        <div>Background: {status.isDark ? "Dark" : "Light"}</div>
        <div className="mt-2 text-[10px]">
          State transitions:
          {status.state === "idle" && " → TOGGLE → running"}
          {status.state === "running" && " → TOGGLE → stopping"}
          {status.state === "stopping" && " → 2s delay → idle (OR TOGGLE → running)"}
        </div>
      </div>
    </div>
  );
};

export const HamsterWheel = () => {
  const { status, handleToggle, isLoading } = useHamsterWheel();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8 min-h-screen">
        <div className="text-muted-foreground">Initializing...</div>
      </div>
    );
  }

  const hasElectricity = status.electricityLevel > 0;

  return (
    <div
      className={cn(
        "min-h-screen w-full transition-all duration-1000 relative",
        status.isDark
          ? "bg-gray-800"
          : hasElectricity
            ? "bg-gray-600"
            : "bg-gray-800"
      )}
    >
      {/* Side by side layout: Garage Door (left) | Hamster Wheel (center) | Garage Door (right) */}
      <div className="flex flex-row items-center justify-center min-h-screen gap-8">
        <div className={cn(
          "rounded-lg transition-colors duration-500",
          hasElectricity ? "bg-gray-500/50" : "bg-gray-700/50"
        )}>
          <GarageDoor useHook={useGarageDoorLeft} title="Left Garage" />
        </div>
        <HamsterWheelContent status={status} handleToggle={handleToggle} />
        <div className={cn(
          "rounded-lg transition-colors duration-500",
          hasElectricity ? "bg-gray-500/50" : "bg-gray-700/50"
        )}>
          <GarageDoor useHook={useGarageDoorRight} title="Right Garage" />
        </div>
      </div>
    </div>
  );
};
