import { useEffect, useState } from "react";
import { GarageDoorPersisted } from "@/components/GarageDoorPersisted";
import { HamsterWheelPersisted } from "@/components/HamsterWheelPersisted";
import { startLeaderElection, getTabId, subscribeToLeadership } from "@/lib/db";
import { useHamsterStore } from "@/stores/hamster-persisted";
import { useDoorStore } from "@/stores/door-persisted";
import { cn } from "@/lib/utils";

export default function App() {
  const [ready, setReady] = useState(false);
  const [isLeader, setIsLeader] = useState(false);

  // Get hamster electricity to power the door
  const electricityLevel = useHamsterStore((s) => s.electricityLevel);
  const doorSetPower = useDoorStore((s) => s.setPower);

  // Connect hamster electricity to door power
  useEffect(() => {
    const hasPower = electricityLevel > 0;
    doorSetPower(hasPower);
  }, [electricityLevel, doorSetPower]);

  // Subscribe to leadership changes for UI
  useEffect(() => {
    return subscribeToLeadership(setIsLeader);
  }, []);

  useEffect(() => {
    startLeaderElection();
    setReady(true);
  }, []);

  if (!ready) {
    return <div className="p-8 text-gray-400">Initializing...</div>;
  }

  const hasPower = electricityLevel > 0;

  return (
    <div className={cn(
      "min-h-screen p-8 transition-colors duration-500",
      hasPower ? "bg-gray-800" : "bg-gray-950"
    )}>
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Zustand + Dexie + Leader Election</h1>
          <p className="text-gray-400 mb-2">
            Open in multiple tabs to see cross-tab sync and leader election
          </p>
          <div className="flex items-center justify-center gap-4 text-xs">
            <span className="text-gray-500">Tab: {getTabId().slice(0, 8)}...</span>
            <span className={cn(
              "px-2 py-1 rounded font-medium",
              isLeader ? "bg-yellow-600 text-white" : "bg-gray-700 text-gray-400"
            )}>
              {isLeader ? "LEADER" : "FOLLOWER"}
            </span>
          </div>
        </div>

        {/* Power Status */}
        <div className={cn(
          "text-center mb-8 py-3 rounded-lg transition-colors",
          hasPower ? "bg-green-900/50" : "bg-red-900/50"
        )}>
          <span className="text-lg font-medium">
            {hasPower ? "⚡ Power ON - Hamster is running!" : "🔌 No Power - Wake the hamster!"}
          </span>
        </div>

        {/* Demos */}
        <div className="grid md:grid-cols-2 gap-8 mb-12">
          <GarageDoorPersisted />
          <HamsterWheelPersisted />
        </div>

        {/* Line Count Comparison */}
        <div className="bg-gray-900 rounded-lg p-6 mb-8">
          <h2 className="text-2xl font-bold text-center mb-6">Line Count Comparison</h2>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left py-2 px-4">File</th>
                  <th className="text-right py-2 px-4 text-amber-400">Zustand</th>
                  <th className="text-right py-2 px-4 text-purple-400">EffState v3</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-gray-800">
                  <td className="py-2 px-4">Database + Leader Election</td>
                  <td className="text-right py-2 px-4 text-amber-400">db.ts: ~190 lines</td>
                  <td className="text-right py-2 px-4 text-purple-400">dexie-adapter.ts: ~80 lines</td>
                </tr>
                <tr className="border-b border-gray-800">
                  <td className="py-2 px-4">Door store/machine</td>
                  <td className="text-right py-2 px-4 text-amber-400">~220 lines</td>
                  <td className="text-right py-2 px-4 text-purple-400">~125 lines</td>
                </tr>
                <tr className="border-b border-gray-800">
                  <td className="py-2 px-4">Hamster store/machine</td>
                  <td className="text-right py-2 px-4 text-amber-400">~200 lines</td>
                  <td className="text-right py-2 px-4 text-purple-400">~90 lines</td>
                </tr>
                <tr className="font-bold">
                  <td className="py-2 px-4">TOTAL</td>
                  <td className="text-right py-2 px-4 text-amber-400">~610 lines</td>
                  <td className="text-right py-2 px-4 text-purple-400">~295 lines</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* The Point */}
        <div className="bg-gradient-to-r from-purple-900/50 to-amber-900/50 rounded-lg p-6">
          <h3 className="text-xl font-bold text-center mb-4">The Complexity</h3>
          <div className="grid md:grid-cols-2 gap-6 text-sm">
            <div>
              <h4 className="font-medium text-amber-400 mb-2">Zustand needs:</h4>
              <ul className="space-y-1 text-gray-300">
                <li>• Manual _syncToDb() after every action</li>
                <li>• _isSyncing flag to prevent loops</li>
                <li>• useLiveQuery for cross-tab</li>
                <li>• localStorage + BroadcastChannel for leader</li>
                <li>• subscribeToLeadership in every animated store</li>
                <li>• Refs to track leader state in effects</li>
                <li>• Connect stores manually (electricity → power)</li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium text-purple-400 mb-2">v3 needs:</h4>
              <pre className="text-xs text-purple-300 bg-purple-900/30 p-3 rounded">
{`const actor = useActor(machine, {
  adapter: dexieAdapter(db, "table")
});

// That's it. Cross-tab sync,
// leader election, persistence
// all handled by adapter.`}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
