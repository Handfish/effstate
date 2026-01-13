import { useEffect, useState } from "react";
import { GarageDoorPersisted } from "@/components/GarageDoorPersisted";
import { HamsterWheelPersisted } from "@/components/HamsterWheelPersisted";
import { startLeaderElection, getTabId } from "@/lib/db";

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    startLeaderElection();
    setReady(true);
  }, []);

  if (!ready) {
    return <div className="p-8 text-gray-400">Initializing...</div>;
  }

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Zustand + Dexie + Leader Election</h1>
          <p className="text-gray-400 mb-2">
            Open in multiple tabs to see cross-tab sync and leader election
          </p>
          <p className="text-xs text-gray-500">
            Tab ID: {getTabId().slice(0, 8)}...
          </p>
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
                  <td className="py-2 px-4">Database setup</td>
                  <td className="text-right py-2 px-4 text-amber-400">db.ts: 130 lines</td>
                  <td className="text-right py-2 px-4 text-purple-400">dexie-adapter.ts: 80 lines</td>
                </tr>
                <tr className="border-b border-gray-800">
                  <td className="py-2 px-4">Door store/machine</td>
                  <td className="text-right py-2 px-4 text-amber-400">door-persisted.ts: 220 lines</td>
                  <td className="text-right py-2 px-4 text-purple-400">garage-door.ts: 125 lines</td>
                </tr>
                <tr className="border-b border-gray-800">
                  <td className="py-2 px-4">Hamster store/machine</td>
                  <td className="text-right py-2 px-4 text-amber-400">hamster-persisted.ts: 200 lines</td>
                  <td className="text-right py-2 px-4 text-purple-400">hamster-wheel.ts: 90 lines</td>
                </tr>
                <tr className="border-b border-gray-800">
                  <td className="py-2 px-4">Hook usage</td>
                  <td className="text-right py-2 px-4 text-amber-400">useDoorWithPersistence() custom hook</td>
                  <td className="text-right py-2 px-4 text-purple-400">useActor(machine, &#123; adapter &#125;)</td>
                </tr>
                <tr className="font-bold">
                  <td className="py-2 px-4">TOTAL</td>
                  <td className="text-right py-2 px-4 text-amber-400">~550 lines</td>
                  <td className="text-right py-2 px-4 text-purple-400">~295 lines</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Complexity Comparison */}
        <div className="grid lg:grid-cols-2 gap-6 mb-8">
          <div className="bg-gray-900 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-amber-400 mb-4">
              What Zustand requires:
            </h3>
            <ul className="space-y-2 text-sm text-gray-300">
              <li className="flex items-start gap-2">
                <span className="text-red-400">•</span>
                <span>Manual Dexie schema + leader election (130 lines)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-400">•</span>
                <span>_syncToDb() after every action</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-400">•</span>
                <span>_loadFromDb() + _applyDbRecord() for sync</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-400">•</span>
                <span>useLiveQuery() + conflict detection</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-400">•</span>
                <span>_isSyncing flag to prevent loops</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-400">•</span>
                <span>subscribeToLeadership() for animation control</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-400">•</span>
                <span>Refs to track leader state in useEffect</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-400">•</span>
                <span>Manual timer management per-store</span>
              </li>
            </ul>
          </div>

          <div className="bg-gray-900 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-purple-400 mb-4">
              What EffState v3 requires:
            </h3>
            <ul className="space-y-2 text-sm text-gray-300">
              <li className="flex items-start gap-2">
                <span className="text-green-400">•</span>
                <span>dexieAdapter(db, "tableName") - one line</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-400">•</span>
                <span>useActor(machine, &#123; adapter &#125;) - one line</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-400">•</span>
                <span>Leader election handled by adapter</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-400">•</span>
                <span>Cross-tab sync handled by adapter</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-400">•</span>
                <span>Animation streams auto-cancel on state change</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-400">•</span>
                <span>No manual conflict detection needed</span>
              </li>
            </ul>

            <div className="mt-4 p-3 bg-purple-900/30 rounded text-xs">
              <pre className="text-purple-300">
{`// That's it:
const actor = useActor(doorMachine, {
  adapter: dexieAdapter(db, "doors")
});`}
              </pre>
            </div>
          </div>
        </div>

        {/* The Point */}
        <div className="bg-gradient-to-r from-purple-900/50 to-amber-900/50 rounded-lg p-6">
          <h3 className="text-xl font-bold text-center mb-4">The Point</h3>
          <div className="text-center text-gray-300 max-w-2xl mx-auto space-y-4">
            <p>
              <strong className="text-amber-400">Without persistence:</strong> Zustand wins on simplicity.
              <br />
              48 lines vs 45 lines. Both readable. Pick what your team knows.
            </p>
            <p>
              <strong className="text-purple-400">With persistence + cross-tab sync:</strong> EffState v3 wins.
              <br />
              The adapter pattern absorbs 300+ lines of complexity.
            </p>
            <p className="text-sm text-gray-500">
              The question isn't "which is better" - it's "what does your app need?"
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
