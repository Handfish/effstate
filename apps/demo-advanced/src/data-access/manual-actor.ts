/**
 * Manual Actor Lifecycle Management
 *
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 * !! This file demonstrates interpretManual() - an ADVANCED pattern.        !!
 * !! DO NOT use this pattern unless you have a specific performance need.   !!
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 *
 * Key differences from interpret():
 * - No Scope.Scope required
 * - No automatic finalizer registration
 * - YOU must call actor.stop() or you WILL leak memory
 *
 * Performance benefit: ~1.6x faster actor creation
 * Complexity cost: All the code in this file that manages lifecycle manually
 */

import {
  assign,
  createMachine,
  interpretManual,
  type MachineSnapshot,
  type MachineActor,
} from "effstate";
import { Data, Duration, Effect, Schedule, Schema, Stream } from "effect";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

// ============================================================================
// Simple Counter Machine (for demonstration)
// ============================================================================

const CounterContextSchema = Schema.Struct({
  count: Schema.Number,
  tickCount: Schema.Number,
});

class Increment extends Data.TaggedClass("INCREMENT")<{}> {}
class Decrement extends Data.TaggedClass("DECREMENT")<{}> {}
class Tick extends Data.TaggedClass("TICK")<{}> {}

type CounterEvent = Increment | Decrement | Tick;
type CounterState = "idle" | "counting";
type CounterContext = typeof CounterContextSchema.Type;
type CounterSnapshot = MachineSnapshot<CounterState, CounterContext>;

const initialSnapshot: CounterSnapshot = {
  value: "counting",
  context: { count: 0, tickCount: 0 },
  event: null,
};

const counterMachine = createMachine<CounterState, CounterEvent, typeof CounterContextSchema>({
  id: "manual-counter",
  initial: "counting",
  context: CounterContextSchema,
  initialContext: { count: 0, tickCount: 0 },
  states: {
    idle: {
      on: {
        INCREMENT: { actions: [assign(({ context }) => ({ count: context.count + 1 }))] },
        DECREMENT: { actions: [assign(({ context }) => ({ count: context.count - 1 }))] },
      },
    },
    counting: {
      // This activity demonstrates why cleanup matters - it runs forever until stopped
      activities: [
        {
          id: "ticker",
          src: ({ send }) =>
            Stream.fromSchedule(Schedule.spaced(Duration.millis(100))).pipe(
              Stream.runForEach(() => Effect.sync(() => send(new Tick()))),
            ),
        },
      ],
      on: {
        INCREMENT: { actions: [assign(({ context }) => ({ count: context.count + 1 }))] },
        DECREMENT: { actions: [assign(({ context }) => ({ count: context.count - 1 }))] },
        TICK: { actions: [assign(({ context }) => ({ tickCount: context.tickCount + 1 }))] },
      },
    },
  },
});

// ============================================================================
// Lifecycle Logging (to demonstrate what's happening)
// ============================================================================

export type LifecycleLog = { timestamp: Date; message: string; type: "info" | "warning" | "error" | "success" };
let lifecycleLogs: LifecycleLog[] = [];
const lifecycleLogSubscribers: Set<() => void> = new Set();

const addLog = (message: string, type: LifecycleLog["type"] = "info") => {
  const log = { timestamp: new Date(), message, type };
  lifecycleLogs = [...lifecycleLogs.slice(-29), log];
  console.log(`[${type.toUpperCase()}] ${message}`);
  lifecycleLogSubscribers.forEach((cb) => cb());
};

export const clearLogs = () => {
  lifecycleLogs = [];
  lifecycleLogSubscribers.forEach((cb) => cb());
};

// ============================================================================
// Actor Store (External Store Pattern for React)
// ============================================================================

type ActorStore = {
  actor: MachineActor<CounterState, CounterContext, CounterEvent> | null;
  snapshot: CounterSnapshot;
  isStopped: boolean;
};

let store: ActorStore = {
  actor: null,
  snapshot: initialSnapshot,
  isStopped: true,
};

const storeSubscribers: Set<() => void> = new Set();

const notifyChange = () => storeSubscribers.forEach((cb) => cb());

// ============================================================================
// Actor Lifecycle Management
// ============================================================================

/**
 * Create a new actor using interpretManual().
 *
 * IMPORTANT: This returns an Effect that does NOT require Scope.
 * The trade-off is that YOU must call actor.stop() when done.
 */
const createActor = () => {
  addLog("Creating actor with interpretManual()...", "info");
  addLog("  → No Scope.Scope in Effect type", "info");
  addLog("  → No finalizer registered", "warning");
  addLog("  → YOU must call actor.stop()!", "warning");

  // interpretManual returns Effect<Actor, never, never> - no Scope!
  const actor = Effect.runSync(interpretManual(counterMachine));

  addLog(`Actor created! Initial state: ${actor.getSnapshot().value}`, "success");
  addLog("Activity 'ticker' is now running (check tickCount)", "info");

  // Subscribe to state changes
  actor.subscribe((snapshot) => {
    store = { ...store, snapshot };
    notifyChange();
  });

  store = {
    actor,
    snapshot: actor.getSnapshot(),
    isStopped: false,
  };

  notifyChange();
  return actor;
};

/**
 * Stop the actor - THIS IS THE CRITICAL CLEANUP.
 *
 * If you forget to call this, the actor keeps running forever:
 * - Activities continue consuming resources
 * - Timers keep firing
 * - Memory is never freed
 *
 * With interpret() + Scope, this happens automatically.
 * With interpretManual(), YOU must do it.
 */
export const stopActor = () => {
  if (!store.actor || store.isStopped) {
    addLog("No actor to stop", "warning");
    return;
  }

  addLog("=== MANUAL CLEANUP ===", "warning");
  addLog("Calling actor.stop()...", "info");
  addLog("  → Activities will be interrupted", "info");
  addLog("  → Timers will be cancelled", "info");

  // THIS IS THE KEY LINE - manual cleanup!
  store.actor.stop();

  addLog("Actor stopped successfully!", "success");
  addLog("(With interpret(), this happens automatically via Scope)", "info");

  store = { ...store, isStopped: true, snapshot: initialSnapshot };
  notifyChange();
};

/**
 * Restart the actor (stop + create new).
 */
export const restartActor = () => {
  if (store.actor && !store.isStopped) {
    addLog("=== RESTART: Stopping old actor first ===", "warning");
    stopActor();
  }
  addLog("=== RESTART: Creating new actor ===", "info");
  createActor();
};

/**
 * Initialize actor - called when component mounts.
 */
let initialized = false;
export const initializeActor = () => {
  if (!initialized) {
    initialized = true;
    addLog("=== COMPONENT MOUNTED ===", "info");
    addLog("Initializing actor...", "info");
    createActor();
  }
};

/**
 * Cleanup actor - called when component unmounts.
 *
 * THIS IS CRITICAL! Without this, the actor would leak.
 */
export const cleanupActor = () => {
  addLog("=== COMPONENT UNMOUNTING ===", "warning");
  addLog("Must cleanup to prevent leak!", "warning");

  if (store.actor && !store.isStopped) {
    store.actor.stop();
    addLog("Actor stopped - no leak!", "success");
  }

  initialized = false;
  store = { actor: null, snapshot: initialSnapshot, isStopped: true };
};

// ============================================================================
// React Hooks
// ============================================================================

export const useManualActor = () => {
  const state = useSyncExternalStore(
    (cb) => { storeSubscribers.add(cb); return () => storeSubscribers.delete(cb); },
    () => store
  );

  const increment = useCallback(() => {
    if (state.actor && !state.isStopped) {
      state.actor.send(new Increment());
    }
  }, [state.actor, state.isStopped]);

  const decrement = useCallback(() => {
    if (state.actor && !state.isStopped) {
      state.actor.send(new Decrement());
    }
  }, [state.actor, state.isStopped]);

  return {
    count: state.snapshot.context.count,
    tickCount: state.snapshot.context.tickCount,
    isStopped: state.isStopped,
    increment,
    decrement,
    stop: stopActor,
    restart: restartActor,
  };
};

export const useLifecycleLogs = () => {
  const [logs, setLogs] = useState<LifecycleLog[]>(lifecycleLogs);

  useEffect(() => {
    const update = () => setLogs([...lifecycleLogs]);
    lifecycleLogSubscribers.add(update);
    return () => { lifecycleLogSubscribers.delete(update); };
  }, []);

  return logs;
};
