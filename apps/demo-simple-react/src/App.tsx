import { HamsterWheelContent } from "@/components/HamsterWheel";
import { GarageDoor } from "@/components/GarageDoor";
import { useAppState } from "@/hooks/useAppState";
import { cn } from "@/lib/utils";

function App() {
  const { state, isLoading, toggleHamster, wakeHamster, clickDoor } = useAppState();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8 min-h-screen">
        <div className="text-muted-foreground">Initializing...</div>
      </div>
    );
  }

  const hasElectricity = state.hamster.electricityLevel > 0;

  return (
    <div
      className={cn(
        "min-h-screen w-full transition-all duration-1000 relative overflow-x-hidden",
        hasElectricity ? "bg-gray-600" : "bg-gray-800"
      )}
    >
      {/* Responsive layout: stacked on mobile, side by side on desktop */}
      <div className="flex flex-col lg:flex-row items-center justify-center min-h-screen gap-4 lg:gap-8 py-8 lg:py-0 px-4 lg:px-0">
        <div
          className={cn(
            "rounded-lg transition-colors duration-500 w-full max-w-sm lg:w-auto",
            hasElectricity ? "bg-gray-500/50" : "bg-gray-700/50"
          )}
        >
          <GarageDoor
            door={state.leftDoor}
            hasPower={hasElectricity}
            title="Left Garage"
            mobileTitle="Top Garage"
            onClick={() => clickDoor("left")}
            onWakeHamster={wakeHamster}
          />
        </div>

        <HamsterWheelContent
          hamsterState={state.hamster.state}
          wheelRotation={state.hamster.wheelRotation}
          electricityLevel={state.hamster.electricityLevel}
          onToggle={toggleHamster}
        />

        <div
          className={cn(
            "rounded-lg transition-colors duration-500 w-full max-w-sm lg:w-auto",
            hasElectricity ? "bg-gray-500/50" : "bg-gray-700/50"
          )}
        >
          <GarageDoor
            door={state.rightDoor}
            hasPower={hasElectricity}
            title="Right Garage"
            mobileTitle="Bottom Garage"
            onClick={() => clickDoor("right")}
            onWakeHamster={wakeHamster}
          />
        </div>
      </div>

      {/* Footer note */}
      <div className="relative lg:absolute bottom-0 lg:bottom-4 left-0 right-0 text-center pb-4 lg:pb-0">
        <p className="text-gray-400 text-xs md:text-sm px-4">
          Simple React (no state machine) with Dexie for persistence. Cross-tab sync via liveQuery!
        </p>
      </div>
    </div>
  );
}

export default App;
