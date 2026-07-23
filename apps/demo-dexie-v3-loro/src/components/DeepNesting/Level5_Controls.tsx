/**
 * Level 5 - Controls (Deepest Level)
 *
 * 5 levels deep, dispatches machine events via Context.
 * Uses the same Toggle/Click classes as the machines.
 */

import { useDispatch, AppEvents } from "@/context/EventBus";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Level5Props {
  hamsterIsPowered: boolean;
}

export function Level5_Controls({ hamsterIsPowered }: Level5Props) {
  const dispatch = useDispatch();

  return (
    <div className="border-2 border-pink-500/50 rounded-lg p-3 bg-pink-500/5 mt-2">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-semibold text-pink-400">Level 5: Controls</h3>
        <span className="text-xs bg-pink-500/20 text-pink-300 px-2 py-0.5 rounded">
          DEEPEST
        </span>
      </div>

      <p className="text-xs text-gray-400 mb-3">
        Dispatches Toggle/Click events via Context - no props drilled through levels 2-4.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => dispatch(AppEvents.toggleHamster())}
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
          onClick={() => dispatch(AppEvents.clickLeftDoor())}
          variant="outline"
          size="sm"
          className="text-xs"
          disabled={!hamsterIsPowered}
        >
          Left Door
        </Button>

        <Button
          onClick={() => dispatch(AppEvents.clickRightDoor())}
          variant="outline"
          size="sm"
          className="text-xs"
          disabled={!hamsterIsPowered}
        >
          Right Door
        </Button>
      </div>

      {!hamsterIsPowered && (
        <p className="text-xs text-yellow-500 mt-2">
          Toggle hamster first to enable doors
        </p>
      )}
    </div>
  );
}
