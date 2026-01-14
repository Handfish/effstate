/**
 * App - Demonstrating modular hooks + React Context for deep component communication
 *
 * Key improvements over the original single-hook approach:
 *
 * 1. MODULAR HOOKS: Instead of one giant useAppState hook, we have:
 *    - useHamster: manages hamster state machine
 *    - useDoor: manages a single door (reusable for left/right)
 *    - usePersistenceCoordinator: ties them together for Dexie
 *
 * 2. REACT CONTEXT (EventBus): Components 5 levels deep can:
 *    - Dispatch events UP to the top level
 *    - Receive state changes DOWN from the top level
 *    - No prop drilling through intermediate levels!
 */

import { HamsterWheelContent } from "@/components/HamsterWheel";
import { GarageDoor } from "@/components/GarageDoor";
import { Level1_Dashboard } from "@/components/DeepNesting";
import { EventBusProvider } from "@/context/EventBus";
import {
  useInitialSnapshots,
  useHamster,
  useDoor,
  usePersistenceCoordinator,
  isLeader,
  type InitialSnapshots,
} from "@/hooks";
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

  // Wrap with EventBusProvider for deep component communication
  return (
    <EventBusProvider>
      <AppContent initialSnapshots={snapshots} />
    </EventBusProvider>
  );
}

function AppContent({ initialSnapshots }: { initialSnapshots: InitialSnapshots | null }) {
  // Use MODULAR HOOKS instead of one giant useAppState
  const hamster = useHamster(initialSnapshots?.hamster ?? null);
  const leftDoor = useDoor(initialSnapshots?.leftDoor ?? null);
  const rightDoor = useDoor(initialSnapshots?.rightDoor ?? null);

  // Coordinate persistence between all hooks
  usePersistenceCoordinator({ hamster, leftDoor, rightDoor });

  return (
    <div
      className={cn(
        "min-h-screen w-full transition-all duration-1000 relative overflow-x-hidden",
        hamster.isPowered ? "bg-gray-600" : "bg-gray-800"
      )}
    >
      {/* Leader indicator */}
      <div className="absolute top-2 right-2 text-xs text-gray-500">
        {isLeader() ? "Leader" : "Follower"}
      </div>

      {/* Main content */}
      <div className="flex flex-col lg:flex-row items-center justify-center min-h-screen gap-4 lg:gap-8 py-8 lg:py-0 px-4 lg:px-0">
        <div
          className={cn(
            "rounded-lg transition-colors duration-500 w-full max-w-sm lg:w-auto",
            hamster.isPowered ? "bg-gray-500/50" : "bg-gray-700/50"
          )}
        >
          <GarageDoor
            doorState={leftDoor.state}
            doorContext={leftDoor.context}
            hasPower={hamster.isPowered}
            title="Left Garage"
            mobileTitle="Top Garage"
            onClick={leftDoor.click}
            onWakeHamster={hamster.toggle}
          />
        </div>

        <HamsterWheelContent
          hamsterState={hamster.state}
          hamsterContext={hamster.context}
          onToggle={hamster.toggle}
        />

        <div
          className={cn(
            "rounded-lg transition-colors duration-500 w-full max-w-sm lg:w-auto",
            hamster.isPowered ? "bg-gray-500/50" : "bg-gray-700/50"
          )}
        >
          <GarageDoor
            doorState={rightDoor.state}
            doorContext={rightDoor.context}
            hasPower={hamster.isPowered}
            title="Right Garage"
            mobileTitle="Bottom Garage"
            onClick={rightDoor.click}
            onWakeHamster={hamster.toggle}
          />
        </div>
      </div>

      {/* Deep Nesting Demo - Shows 5-level deep context communication */}
      <div className="px-4 pb-8 max-w-2xl mx-auto">
        <h2 className="text-lg font-semibold text-gray-300 mb-3">
          Deep Nesting Demo (5 Levels)
        </h2>
        <p className="text-sm text-gray-400 mb-4">
          The controls below are 5 levels deep. They use React Context (EventBus)
          to send events UP without prop drilling.
        </p>
        <Level1_Dashboard
          hamsterIsPowered={hamster.isPowered}
          onToggleHamster={hamster.toggle}
          onClickDoor={(door) => (door === "left" ? leftDoor : rightDoor).click()}
        />
      </div>

      {/* Footer */}
      <div className="text-center pb-4">
        <p className="text-gray-400 text-xs md:text-sm px-4">
          EffState v3 + React Context + Modular Hooks. Events flow both UP and DOWN.
        </p>
      </div>
    </div>
  );
}

export default App;
