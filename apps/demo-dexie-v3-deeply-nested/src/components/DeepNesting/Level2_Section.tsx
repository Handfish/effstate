/**
 * Level 2 - Section
 *
 * Intermediate component that just passes props down.
 * Notice: NO event handlers are passed through this level!
 * The EventBus context handles all event communication.
 */

import { Level3_Panel } from "./Level3_Panel";

interface Level2Props {
  hamsterIsPowered: boolean;
}

export function Level2_Section({ hamsterIsPowered }: Level2Props) {
  return (
    <div className="border-2 border-purple-500/50 rounded-lg p-3 bg-purple-500/5 mt-2">
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-sm font-semibold text-purple-400">Level 2: Section</h3>
        <span className="text-xs text-gray-500">(no event handlers passed here)</span>
      </div>
      <Level3_Panel hamsterIsPowered={hamsterIsPowered} />
    </div>
  );
}
