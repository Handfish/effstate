import { Button } from "@/components/ui/button";
import {
  getHamsterStateLabel,
  getHamsterButtonLabel,
} from "@/hooks/useAppState";
import type { HamsterState, HamsterContext } from "@/machines";
import { cn } from "@/lib/utils";

const ElectricityBolt = ({ active, delay }: { active: boolean; delay: number }) => (
  <div
    className={cn(
      "text-lg md:text-2xl transition-all duration-300",
      active ? "text-amber-400 animate-pulse" : "text-gray-600 opacity-50"
    )}
    style={{ animationDelay: `${delay}ms` }}
  >
    ⚡
  </div>
);

const LightBulb = ({ on }: { on: boolean }) => (
  <div
    className={cn(
      "text-2xl md:text-4xl transition-all duration-500",
      on ? "text-amber-300 drop-shadow-[0_0_10px_rgba(251,191,36,0.5)]" : "text-gray-600"
    )}
  >
    💡
  </div>
);

interface HamsterWheelContentProps {
  hamsterState: HamsterState;
  hamsterContext: HamsterContext;
  onToggle: () => void;
}

export const HamsterWheelContent = ({
  hamsterState,
  hamsterContext,
  onToggle,
}: HamsterWheelContentProps) => {
  const stateTag = hamsterState._tag;
  const isRunning = stateTag === "Running";
  const isStopping = stateTag === "Stopping";
  const isIdle = stateTag === "Idle";
  const hasElectricity = hamsterContext.electricityLevel > 0;

  return (
    <div className="flex flex-col items-center justify-center p-4 md:p-8">
      <h2
        className={cn(
          "text-xl md:text-2xl font-bold mb-4 md:mb-8 transition-colors duration-500 text-center",
          hasElectricity ? "text-gray-100" : "text-gray-300"
        )}
      >
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
            <ElectricityBolt active={hasElectricity} delay={0} />
            <ElectricityBolt active={hasElectricity} delay={100} />
            <ElectricityBolt active={hasElectricity} delay={200} />
          </>
        )}
      </div>

      {/* Hamster wheel container */}
      <div className="relative mb-4 md:mb-8 w-32 h-32 md:w-48 md:h-48">
        {/* Spinning wheel */}
        <div
          className={cn(
            "absolute inset-0 rounded-full border-4 md:border-8",
            hasElectricity ? "border-amber-700 bg-amber-100/80" : "border-gray-600 bg-gray-800"
          )}
          style={{
            transform: `rotate(${hamsterContext.wheelRotation}deg)`,
            transition: isRunning ? "none" : "transform 0.5s ease-out",
          }}
        >
          {/* Wheel spokes */}
          {[0, 45, 90, 135].map((angle) => (
            <div
              key={angle}
              className={cn(
                "absolute top-1/2 left-1/2 w-full h-1 origin-center",
                hasElectricity ? "bg-amber-700" : "bg-gray-600"
              )}
              style={{ transform: `translate(-50%, -50%) rotate(${angle}deg)` }}
            />
          ))}

          {/* Decorative circle on wheel edge */}
          <div
            className={cn(
              "absolute w-6 h-6 md:w-9 md:h-9 rounded-full left-1/2 -translate-x-1/2",
              hasElectricity ? "bg-amber-700" : "bg-gray-600"
            )}
            style={{ top: "-20px" }}
          />
        </div>

        {/* Center hub - stationary */}
        <div
          className={cn(
            "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-5 md:w-8 md:h-8 rounded-full z-10",
            hasElectricity ? "bg-amber-800" : "bg-gray-700"
          )}
        />

        {/* Hamster - stationary */}
        <div
          className={cn(
            "absolute text-3xl md:text-5xl z-20 transition-[top,left] duration-300",
            isRunning && "animate-bounce"
          )}
          style={{
            top: isRunning ? "55%" : "50%",
            left: isRunning ? "60%" : "50%",
            transform: "translate(-50%, -50%)",
            animation: isIdle ? "breathe 3s ease-in-out infinite" : undefined,
          }}
        >
          {isIdle ? "😴" : "🐹"}
        </div>
        <style>{`
          @keyframes breathe {
            0%, 100% { transform: translate(-50%, -50%) scale(0.9); }
            50% { transform: translate(-50%, -50%) scale(1); }
          }
        `}</style>

        {/* Running indicator */}
        {isRunning && (
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-xs md:text-sm text-gray-300 whitespace-nowrap flex z-20">
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
      <div
        className={cn(
          "w-24 h-12 md:w-32 md:h-16 rounded-lg flex items-center justify-center text-xl md:text-2xl mb-4 md:mb-8 transition-all duration-500",
          hasElectricity ? "bg-emerald-600 shadow-md shadow-emerald-600/30" : "bg-gray-700"
        )}
      >
        {hasElectricity ? "🔋" : "🪫"}
      </div>

      {/* Status Display */}
      <div
        className={cn(
          "text-center space-y-1 mb-4 md:mb-6",
          hasElectricity ? "text-gray-100" : "text-gray-300"
        )}
      >
        <div className="text-base md:text-lg font-medium">
          {getHamsterStateLabel(hamsterState)}
        </div>
        <div className="text-xs md:text-sm">Electricity: {hamsterContext.electricityLevel}%</div>
        {isStopping && (
          <div className="text-xs md:text-sm text-orange-500 animate-pulse">
            Power shutting down in 2 seconds...
          </div>
        )}
      </div>

      {/* Control Button */}
      <Button
        onClick={onToggle}
        size="lg"
        variant={isRunning ? "destructive" : isStopping ? "secondary" : "default"}
        className="min-w-[140px] md:min-w-[160px]"
      >
        {getHamsterButtonLabel(hamsterState)}
      </Button>

      {/* Debug Info */}
      <div className="text-[10px] md:text-xs mt-4 md:mt-8 p-3 md:p-4 rounded-lg font-mono bg-gray-800 text-gray-400 w-[200px] md:w-[225px]">
        <div>State: {stateTag}</div>
        <div>Wheel Rotation: {hamsterContext.wheelRotation.toFixed(0)}°</div>
        <div>Electricity: {hamsterContext.electricityLevel}%</div>
        <div className="mt-2 text-[10px]">
          State transitions:
          {isIdle && " → Toggle → Running"}
          {isRunning && " → Toggle → Stopping"}
          {isStopping && " → 2s delay → Idle (OR Toggle → Running)"}
        </div>
      </div>
    </div>
  );
};
