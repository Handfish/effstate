/**
 * Level 4 - Card
 *
 * Penultimate level. Shows power status received from Level 1.
 * Contains the deeply nested Level5_Controls.
 */

import { Level5_Controls } from "./Level5_Controls";
import { cn } from "@/lib/utils";

interface Level4Props {
  hamsterIsPowered: boolean;
}

export function Level4_Card({ hamsterIsPowered }: Level4Props) {
  return (
    <div className="border-2 border-teal-500/50 rounded-lg p-3 bg-teal-500/5 mt-2">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-teal-400">Level 4: Card</h3>
          <span className="text-xs text-gray-500">(still no event props)</span>
        </div>
        <div
          className={cn(
            "px-2 py-1 rounded text-xs font-medium",
            hamsterIsPowered
              ? "bg-green-500/20 text-green-400"
              : "bg-red-500/20 text-red-400"
          )}
        >
          Power: {hamsterIsPowered ? "ON" : "OFF"}
        </div>
      </div>
      <Level5_Controls hamsterIsPowered={hamsterIsPowered} />
    </div>
  );
}
