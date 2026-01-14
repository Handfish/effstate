/**
 * Level 3 - Panel
 *
 * Another intermediate component.
 * Still no event handlers - they're handled via EventBus context.
 */

import { Level4_Card } from "./Level4_Card";

interface Level3Props {
  hamsterIsPowered: boolean;
}

export function Level3_Panel({ hamsterIsPowered }: Level3Props) {
  return (
    <div className="border-2 border-orange-500/50 rounded-lg p-3 bg-orange-500/5 mt-2">
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-sm font-semibold text-orange-400">Level 3: Panel</h3>
        <span className="text-xs text-gray-500">(no event handlers here either)</span>
      </div>
      <Level4_Card hamsterIsPowered={hamsterIsPowered} />
    </div>
  );
}
