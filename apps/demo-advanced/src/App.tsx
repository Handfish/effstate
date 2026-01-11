/**
 * Advanced Demo: interpretManual() Lifecycle Management
 *
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 * !! WARNING: This demo shows an ADVANCED pattern that is NOT RECOMMENDED   !!
 * !! for most applications. Use interpret() instead for automatic cleanup.  !!
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 *
 * This demo exists to:
 * 1. Show HOW interpretManual() works
 * 2. Demonstrate the cleanup complexity required
 * 3. Explain the (small) performance gains
 *
 * Performance gains: ~1.6x faster actor creation
 * Complexity cost: Manual lifecycle management, risk of memory leaks
 *
 * RECOMMENDATION: Use interpret() unless you have measured a performance
 * bottleneck in actor creation AND you're creating thousands of actors.
 */

import { useEffect } from "react";
import { ManualLifecycleDemo } from "./components/ManualLifecycleDemo";
import {
  initializeActor,
  cleanupActor,
} from "./data-access/manual-actor";

function App() {
  // CRITICAL: This is the cleanup pattern required for interpretManual()
  // Without this useEffect, the actor would LEAK when the component unmounts
  useEffect(() => {
    initializeActor();
    return () => {
      cleanupActor();
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Warning banner */}
      <div className="bg-red-900/80 border-b-2 border-red-500 px-4 py-3 text-center">
        <div className="text-red-200 text-sm font-bold">
          ⚠️ ADVANCED DEMO - NOT RECOMMENDED FOR PRODUCTION ⚠️
        </div>
        <div className="text-red-300 text-xs mt-1">
          This demonstrates <code className="bg-red-800 px-1 rounded">interpretManual()</code> which requires manual cleanup.
          Use <code className="bg-green-800 px-1 rounded">interpret()</code> instead for automatic lifecycle management.
        </div>
      </div>

      <ManualLifecycleDemo />
    </div>
  );
}

export default App;
