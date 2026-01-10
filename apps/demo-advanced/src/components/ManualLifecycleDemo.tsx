/**
 * Manual Lifecycle Demo Component
 *
 * This demonstrates the complexity required when using interpretManual().
 * Compare this to the simplicity of using interpret() with atoms!
 */

import { Button } from "./ui/button";
import { useManualActor, useLifecycleLogs, clearLogs, type LifecycleLog } from "../data-access/manual-actor";
import { cn } from "../lib/utils";

const LogPanel = ({ logs }: { logs: LifecycleLog[] }) => (
  <div className="bg-gray-950 rounded-lg p-4 font-mono text-xs">
    <div className="flex items-center justify-between mb-3">
      <span className="text-gray-400 font-bold">Lifecycle Log</span>
      <button onClick={clearLogs} className="text-gray-500 hover:text-gray-300 text-xs">
        Clear
      </button>
    </div>
    <div className="space-y-1 h-64 overflow-y-auto">
      {logs.length === 0 ? (
        <div className="text-gray-600">Logs will appear here...</div>
      ) : (
        logs.map((log, i) => (
          <div
            key={i}
            className={cn(
              "py-0.5",
              log.type === "info" && "text-blue-400",
              log.type === "warning" && "text-yellow-400",
              log.type === "error" && "text-red-400",
              log.type === "success" && "text-green-400",
              log.message.startsWith("  →") && "pl-4 text-gray-400"
            )}
          >
            <span className="text-gray-600 mr-2">
              {log.timestamp.toLocaleTimeString()}
            </span>
            {log.message}
          </div>
        ))
      )}
    </div>
  </div>
);

export const ManualLifecycleDemo = () => {
  const { count, tickCount, isStopped, increment, decrement, stop, restart } = useManualActor();
  const logs = useLifecycleLogs();

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-2">
        interpretManual() Demo
      </h1>
      <p className="text-gray-400 mb-6">
        This counter has an activity that ticks every 100ms. Watch what happens when you stop/restart.
      </p>

      {/* Counter Display */}
      <div className={cn(
        "rounded-xl p-8 mb-6 text-center transition-all",
        isStopped ? "bg-red-950 border-2 border-red-800" : "bg-slate-800"
      )}>
        {isStopped && (
          <div className="text-red-400 text-sm mb-4 font-bold">
            ACTOR STOPPED - Activity interrupted!
          </div>
        )}

        <div className="text-6xl font-bold text-white mb-2">{count}</div>
        <div className="text-gray-400 text-sm mb-6">
          Ticks: {tickCount} {!isStopped && <span className="text-green-400">(counting...)</span>}
        </div>

        <div className="flex gap-3 justify-center mb-6">
          <Button onClick={decrement} disabled={isStopped} variant="outline" size="lg">
            -1
          </Button>
          <Button onClick={increment} disabled={isStopped} variant="outline" size="lg">
            +1
          </Button>
        </div>

        <div className="flex gap-3 justify-center">
          <Button
            onClick={stop}
            disabled={isStopped}
            variant="destructive"
          >
            Stop Actor (actor.stop())
          </Button>
          <Button
            onClick={restart}
            variant="default"
            className="bg-green-700 hover:bg-green-600"
          >
            {isStopped ? "Start Actor" : "Restart Actor"}
          </Button>
        </div>
      </div>

      {/* Comparison Box */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-green-950 border border-green-800 rounded-lg p-4">
          <div className="text-green-400 font-bold mb-2">✅ interpret() (Recommended)</div>
          <ul className="text-green-300 text-sm space-y-1">
            <li>• Automatic cleanup via Scope</li>
            <li>• No risk of memory leaks</li>
            <li>• Works great with atoms</li>
            <li>• Simpler code</li>
          </ul>
        </div>
        <div className="bg-red-950 border border-red-800 rounded-lg p-4">
          <div className="text-red-400 font-bold mb-2">⚠️ interpretManual() (This demo)</div>
          <ul className="text-red-300 text-sm space-y-1">
            <li>• ~1.6x faster actor creation</li>
            <li>• YOU must call actor.stop()</li>
            <li>• Risk of memory leaks</li>
            <li>• Complex lifecycle code</li>
          </ul>
        </div>
      </div>

      {/* Lifecycle Log */}
      <LogPanel logs={logs} />

      {/* Code Example */}
      <div className="mt-6 bg-gray-950 rounded-lg p-4">
        <div className="text-gray-400 font-bold mb-2 text-sm">Required Cleanup Pattern:</div>
        <pre className="text-xs text-gray-300 overflow-x-auto">
{`// In your React component:
useEffect(() => {
  initializeActor();  // Create with interpretManual()
  return () => {
    cleanupActor();   // MUST call actor.stop() here!
  };
}, []);

// If you forget cleanupActor(), the actor LEAKS:
// - Activities keep running
// - Timers keep firing
// - Memory never freed`}
        </pre>
      </div>
    </div>
  );
};
