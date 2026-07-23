import { useAppState } from "@/stores/useAppState";
import { GarageDoor } from "@/components/GarageDoor";
import { HamsterWheel } from "@/components/HamsterWheel";
import { cn } from "@/lib/utils";

export default function App() {
  const { loaded, state, toggleHamster, clickDoor } = useAppState();

  if (!loaded) {
    return (
      <div className="flex items-center justify-center p-8 min-h-screen bg-gray-800">
        <div className="text-gray-400">Initializing...</div>
      </div>
    );
  }

  const hasElectricity = state.hamster.electricityLevel > 0;

  return (
    <div className={cn(
      "min-h-screen w-full transition-all duration-1000 relative overflow-x-hidden",
      hasElectricity ? "bg-gray-600" : "bg-gray-800"
    )}>
      <div className="flex flex-col lg:flex-row items-center justify-center min-h-screen gap-4 lg:gap-8 py-8 lg:py-0 px-4 lg:px-0">
        <div className={cn(
          "rounded-lg transition-colors duration-500 w-full max-w-sm lg:w-auto",
          hasElectricity ? "bg-gray-500/50" : "bg-gray-700/50"
        )}>
          <GarageDoor
            stateTag={state.leftDoor.stateTag}
            position={state.leftDoor.position}
            weather={state.leftDoor.weather}
            hasPower={hasElectricity}
            title="Left Garage"
            onClick={() => clickDoor("left")}
            onWakeHamster={toggleHamster}
          />
        </div>

        <HamsterWheel
          stateTag={state.hamster.stateTag}
          wheelRotation={state.hamster.wheelRotation}
          electricityLevel={state.hamster.electricityLevel}
          onToggle={toggleHamster}
        />

        <div className={cn(
          "rounded-lg transition-colors duration-500 w-full max-w-sm lg:w-auto",
          hasElectricity ? "bg-gray-500/50" : "bg-gray-700/50"
        )}>
          <GarageDoor
            stateTag={state.rightDoor.stateTag}
            position={state.rightDoor.position}
            weather={state.rightDoor.weather}
            hasPower={hasElectricity}
            title="Right Garage"
            onClick={() => clickDoor("right")}
            onWakeHamster={toggleHamster}
          />
        </div>
      </div>

      <div className="relative lg:absolute bottom-0 lg:bottom-4 left-0 right-0 text-center pb-4 lg:pb-0">
        <p className="text-gray-400 text-xs md:text-sm px-4">
          Zustand + Dexie persistence. Clean implementation for fair comparison.
        </p>
      </div>
    </div>
  );
}
