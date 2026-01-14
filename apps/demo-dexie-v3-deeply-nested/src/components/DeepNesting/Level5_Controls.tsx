/**
 * Level 5 - Controls (Deepest Level)
 *
 * This is 5 levels deep! Yet it can:
 * 1. Dispatch events directly to Level 1 via EventBus
 * 2. No callback props were drilled through levels 2-4
 *
 * This demonstrates the power of React Context for event communication.
 */

import { useDispatch } from "@/context/EventBus";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Level5Props {
  hamsterIsPowered: boolean;
}

export function Level5_Controls({ hamsterIsPowered }: Level5Props) {
  // Get dispatch function from EventBus context
  // This works without any props passed through levels 2-4!
  const dispatch = useDispatch();

  const handleToggleHamster = () => {
    dispatch({ type: "TOGGLE_HAMSTER" });
    dispatch({
      type: "NOTIFICATION",
      message: "Hamster toggle requested from Level 5",
      level: "info",
    });
  };

  const handleClickDoor = (door: "left" | "right") => {
    if (!hamsterIsPowered) {
      // First wake the hamster, then the door will work
      dispatch({ type: "WAKE_HAMSTER_FOR_DOOR", door });
      dispatch({
        type: "NOTIFICATION",
        message: `Waking hamster for ${door} door`,
        level: "warning",
      });
    } else {
      dispatch({ type: "CLICK_DOOR", door });
    }
  };

  const handleCustomAction = () => {
    dispatch({
      type: "DEEP_COMPONENT_ACTION",
      action: "customButtonClick",
      payload: { timestamp: Date.now(), level: 5 },
    });
  };

  return (
    <div className="border-2 border-pink-500/50 rounded-lg p-3 bg-pink-500/5 mt-2">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-semibold text-pink-400">Level 5: Controls</h3>
        <span className="text-xs bg-pink-500/20 text-pink-300 px-2 py-0.5 rounded">
          DEEPEST LEVEL
        </span>
      </div>

      <p className="text-xs text-gray-400 mb-3">
        These buttons dispatch events via Context - no prop drilling through levels 2-4!
      </p>

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={handleToggleHamster}
          variant="outline"
          size="sm"
          className={cn(
            "text-xs",
            hamsterIsPowered ? "border-green-500 text-green-400" : "border-gray-500"
          )}
        >
          Toggle Hamster
        </Button>

        <Button
          onClick={() => handleClickDoor("left")}
          variant="outline"
          size="sm"
          className="text-xs"
          disabled={!hamsterIsPowered}
        >
          Left Door
        </Button>

        <Button
          onClick={() => handleClickDoor("right")}
          variant="outline"
          size="sm"
          className="text-xs"
          disabled={!hamsterIsPowered}
        >
          Right Door
        </Button>

        <Button
          onClick={handleCustomAction}
          variant="ghost"
          size="sm"
          className="text-xs text-gray-400"
        >
          Custom Event
        </Button>
      </div>

      {!hamsterIsPowered && (
        <p className="text-xs text-yellow-500 mt-2">
          Click "Toggle Hamster" to enable door controls
        </p>
      )}
    </div>
  );
}
