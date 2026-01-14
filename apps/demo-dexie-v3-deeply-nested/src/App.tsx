/**
 * App - React Context EventBus for deep component communication
 *
 * Shows how Level 5 components can dispatch events to Level 1
 * using the same machine event classes (Toggle, Click, etc.)
 */

import { HamsterWheelContent } from "@/components/HamsterWheel";
import { GarageDoor } from "@/components/GarageDoor";
import { Level1_Dashboard } from "@/components/DeepNesting";
import { EventBusProvider, useEventSubscription, type AppEvent } from "@/context/EventBus";
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

  return (
    <EventBusProvider>
      <AppContent initialSnapshots={snapshots} />
    </EventBusProvider>
  );
}

function AppContent({ initialSnapshots }: { initialSnapshots: InitialSnapshots | null }) {
  const { state, isLeader, toggleHamster, clickDoor } = useAppState(initialSnapshots);

  // Handle events from deep components via EventBus
  useEventSubscription((appEvent: AppEvent) => {
    switch (appEvent.target) {
      case "hamster":
        if (appEvent.event._tag === "Toggle") toggleHamster();
        break;
      case "leftDoor":
        if (appEvent.event._tag === "Click") clickDoor("left");
        break;
      case "rightDoor":
        if (appEvent.event._tag === "Click") clickDoor("right");
        break;
    }
  });

  const hasElectricity = state.hamster.context.electricityLevel > 0;

  return (
    <div
      className={cn(
        "min-h-screen w-full transition-all duration-1000 relative overflow-x-hidden",
        hasElectricity ? "bg-gray-600" : "bg-gray-800"
      )}
    >
      {/* Leader indicator */}
      <div className="absolute top-2 right-2 text-xs text-gray-500">
        {isLeader ? "Leader" : "Follower"}
      </div>

      {/* Main content */}
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

      {/* Deep Nesting Demo */}
      <div className="px-4 pb-8 max-w-2xl mx-auto">
        <h2 className="text-lg font-semibold text-gray-300 mb-3">
          Deep Nesting Demo (5 Levels)
        </h2>
        <p className="text-sm text-gray-400 mb-4">
          Level 5 dispatches machine events (Toggle, Click) via Context - no prop drilling.
        </p>
        <Level1_Dashboard hamsterIsPowered={hasElectricity} />
      </div>

      {/* Footer */}
      <div className="text-center pb-4">
        <p className="text-gray-400 text-xs md:text-sm px-4">
          EffState v3 + React Context. Events use same Data.TaggedClass as machines.
        </p>
      </div>
    </div>
  );
}

export default App;
