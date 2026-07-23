import { HamsterWheelContent } from "@/components/HamsterWheel";
import { GarageDoor } from "@/components/GarageDoor";
import { useInitialSnapshots, useAppState, type InitialSnapshots } from "@/hooks/useAppState";
import { cn } from "@/lib/utils";

function App() {
  const { loaded, snapshots } = useInitialSnapshots();

  if (!loaded) {
    return (
      <div className="flex items-center justify-center p-8 min-h-screen bg-gray-800">
        <div className="text-muted-foreground">Initializing...</div>
      </div>
    );
  }

  // Only mount AppContent after load - actors created with correct initial state
  return <AppContent initialSnapshots={snapshots} />;
}

function AppContent({ initialSnapshots }: { initialSnapshots: InitialSnapshots | null }) {
  const { state, toggleHamster, clickDoor } = useAppState(initialSnapshots);

  const hasElectricity = state.hamster.context.electricityLevel > 0;

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
            doorState={state.leftDoor.state}
            doorContext={state.leftDoor.context}
            hasPower={hasElectricity}
            title="Left Garage"
            mobileTitle="Top Garage"
            onClick={() => clickDoor("left")}
            onWakeHamster={toggleHamster}
          />
        </div>

        <HamsterWheelContent
          hamsterState={state.hamster.state}
          hamsterContext={state.hamster.context}
          onToggle={toggleHamster}
        />

        <div
          className={cn(
            "rounded-lg transition-colors duration-500 w-full max-w-sm lg:w-auto",
            hasElectricity ? "bg-gray-500/50" : "bg-gray-700/50"
          )}
        >
          <GarageDoor
            doorState={state.rightDoor.state}
            doorContext={state.rightDoor.context}
            hasPower={hasElectricity}
            title="Right Garage"
            mobileTitle="Bottom Garage"
            onClick={() => clickDoor("right")}
            onWakeHamster={toggleHamster}
          />
        </div>
      </div>

      {/* Footer note */}
      <div className="relative lg:absolute bottom-0 lg:bottom-4 left-0 right-0 text-center pb-4 lg:pb-0">
        <p className="text-gray-400 text-xs md:text-sm px-4">
          EffState v3 with Dexie persistence. Discriminated union states with ~50% less code.
        </p>
      </div>
    </div>
  );
}

export default App;
