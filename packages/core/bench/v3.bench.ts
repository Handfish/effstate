import { Bench, type Task } from "tinybench";
import { Data, Effect } from "effect";

// v3 state machine
import { defineMachine } from "../src/v3/index.js";

// XState for comparison
import {
  createMachine as xstateCreateMachine,
  createActor,
  assign as xstateAssign,
} from "xstate";

// ============================================================================
// v3 Machine Definition
// ============================================================================

type CounterState =
  | { readonly _tag: "idle" }
  | { readonly _tag: "counting" };

const CounterState = {
  idle: (): CounterState => ({ _tag: "idle" }),
  counting: (): CounterState => ({ _tag: "counting" }),
};

interface CounterContext {
  readonly count: number;
  readonly [key: string]: unknown;
}

class Increment extends Data.TaggedClass("Increment")<{}> {}
class Decrement extends Data.TaggedClass("Decrement")<{}> {}

type CounterEvent = Increment | Decrement;

const v3Machine = defineMachine<CounterState, CounterContext, CounterEvent>({
  id: "counter",
  initialState: CounterState.idle(),
  initialContext: { count: 0 },

  states: {
    idle: {
      on: {
        Increment: (ctx) => ({
          goto: CounterState.counting(),
          update: { count: ctx.count + 1 },
        }),
      },
    },
    counting: {
      on: {
        Increment: (ctx) => ({ update: { count: ctx.count + 1 } }),
        Decrement: (ctx) => ({ update: { count: ctx.count - 1 } }),
      },
    },
  },
});

// Pre-create events
const incrementEvent = new Increment();
const decrementEvent = new Decrement();

// ============================================================================
// XState Machine Definition (equivalent)
// ============================================================================

const xstateMachine = xstateCreateMachine({
  id: "counter",
  initial: "idle",
  context: { count: 0 },
  states: {
    idle: {
      on: {
        INCREMENT: {
          target: "counting",
          actions: [xstateAssign({ count: ({ context }) => context.count + 1 })],
        },
      },
    },
    counting: {
      on: {
        INCREMENT: {
          actions: [xstateAssign({ count: ({ context }) => context.count + 1 })],
        },
        DECREMENT: {
          actions: [xstateAssign({ count: ({ context }) => context.count - 1 })],
        },
      },
    },
  },
});

// ============================================================================
// Helper Functions
// ============================================================================

function getOpsPerSec(task: Task): number | null {
  const result = task.result;
  if (result.state === "completed") {
    return 1000 / result.period;
  }
  return null;
}

function getMeanMicroseconds(task: Task): number | null {
  const result = task.result;
  if (result.state === "completed") {
    return result.period * 1000;
  }
  return null;
}

function formatOps(ops: number | null): string {
  if (ops === null) return "N/A";
  return ops.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatMean(mean: number | null): string {
  if (mean === null) return "N/A";
  return mean.toFixed(3);
}

function printComparison(
  label: string,
  v3Task: Task | undefined,
  xstateTask: Task | undefined,
): void {
  if (!v3Task || !xstateTask) return;

  const v3Ops = getOpsPerSec(v3Task);
  const xstateOps = getOpsPerSec(xstateTask);

  if (v3Ops === null || xstateOps === null) return;

  const ratio = v3Ops / xstateOps;
  const winner = ratio > 1 ? "v3" : "XState";
  const multiplier = ratio > 1 ? ratio : 1 / ratio;
  const emoji = ratio > 1.1 ? "🚀" : ratio < 0.9 ? "🐢" : "⚖️";

  console.log(
    `  ${emoji} ${label.padEnd(25)} ${winner} is ${multiplier.toFixed(2)}x faster`,
  );
}

// ============================================================================
// Verification
// ============================================================================

function verifyImplementations() {
  console.log("🔍 VERIFICATION: Confirming both implementations do the same work\n");

  // Test context updates
  {
    const v3Actor = Effect.runSync(v3Machine.interpret());
    v3Actor.send(incrementEvent);
    v3Actor.send(incrementEvent);
    v3Actor.send(decrementEvent);
    const v3Count = v3Actor.getSnapshot().context.count;
    v3Actor.stop();

    const xstateActor = createActor(xstateMachine);
    xstateActor.start();
    xstateActor.send({ type: "INCREMENT" });
    xstateActor.send({ type: "INCREMENT" });
    xstateActor.send({ type: "DECREMENT" });
    const xstateCount = xstateActor.getSnapshot().context.count;
    xstateActor.stop();

    console.log(`  ✓ Context updates: v3=${v3Count}, XState=${xstateCount} ${v3Count === xstateCount ? "✓" : "✗"}`);
  }

  // Test state transitions
  {
    const v3Actor = Effect.runSync(v3Machine.interpret());
    const v3State1 = v3Actor.getSnapshot().state._tag;
    v3Actor.send(incrementEvent);
    const v3State2 = v3Actor.getSnapshot().state._tag;
    v3Actor.stop();

    const xstateActor = createActor(xstateMachine);
    xstateActor.start();
    const xstateState1 = xstateActor.getSnapshot().value;
    xstateActor.send({ type: "INCREMENT" });
    const xstateState2 = xstateActor.getSnapshot().value;
    xstateActor.stop();

    console.log(`  ✓ State transitions: v3=${v3State1}→${v3State2}, XState=${xstateState1}→${xstateState2}`);
  }

  console.log("\n  Both implementations perform equivalent work.\n");
}

// ============================================================================
// Run Benchmarks
// ============================================================================

async function main() {
  console.log("\n" + "═".repeat(70));
  console.log("  STATE MACHINE BENCHMARK: EffState v3 vs XState");
  console.log("═".repeat(70) + "\n");

  verifyImplementations();

  // -------------------------------------------------------------------------
  // Benchmark 1: Machine Creation
  // -------------------------------------------------------------------------
  console.log("📦 MACHINE CREATION (definition only)\n");

  const creationBench = new Bench({ time: 200, warmupTime: 50 });

  creationBench.add("v3: defineMachine", () => {
    defineMachine<CounterState, CounterContext, CounterEvent>({
      id: "counter",
      initialState: CounterState.idle(),
      initialContext: { count: 0 },
      states: {
        idle: { on: { Increment: () => ({ goto: CounterState.counting() }) } },
        counting: { on: { Decrement: () => ({ goto: CounterState.idle() }) } },
      },
    });
  });

  creationBench.add("XState: createMachine", () => {
    xstateCreateMachine({
      id: "counter",
      initial: "idle",
      context: { count: 0 },
      states: {
        idle: { on: { INCREMENT: { target: "counting" } } },
        counting: { on: { DECREMENT: { target: "idle" } } },
      },
    });
  });

  await creationBench.run();

  console.table(
    creationBench.tasks.map((task) => ({
      Task: task.name,
      "ops/sec": formatOps(getOpsPerSec(task)),
      "Mean (μs)": formatMean(getMeanMicroseconds(task)),
    })),
  );

  printComparison(
    "defineMachine/createMachine",
    creationBench.getTask("v3: defineMachine"),
    creationBench.getTask("XState: createMachine"),
  );

  // -------------------------------------------------------------------------
  // Benchmark 2: Actor Lifecycle
  // -------------------------------------------------------------------------
  console.log("\n\n🎭 ACTOR LIFECYCLE (interpret + stop)\n");

  const lifecycleBench = new Bench({ time: 200, warmupTime: 50 });

  lifecycleBench.add("v3: interpret + stop", () => {
    const actor = Effect.runSync(v3Machine.interpret());
    actor.stop();
  });

  lifecycleBench.add("XState: createActor + start + stop", () => {
    const actor = createActor(xstateMachine);
    actor.start();
    actor.stop();
  });

  await lifecycleBench.run();

  console.table(
    lifecycleBench.tasks.map((task) => ({
      Task: task.name,
      "ops/sec": formatOps(getOpsPerSec(task)),
      "Mean (μs)": formatMean(getMeanMicroseconds(task)),
    })),
  );

  printComparison(
    "interpret/createActor",
    lifecycleBench.getTask("v3: interpret + stop"),
    lifecycleBench.getTask("XState: createActor + start + stop"),
  );

  // -------------------------------------------------------------------------
  // Benchmark 3: Event Sending
  // -------------------------------------------------------------------------
  console.log("\n\n📨 EVENT SENDING (1000 events)\n");

  const eventBench = new Bench({ time: 200, warmupTime: 50 });

  eventBench.add("v3: send 1000 events", () => {
    const actor = Effect.runSync(v3Machine.interpret());
    for (let i = 0; i < 500; i++) {
      actor.send(incrementEvent);
      actor.send(decrementEvent);
    }
    actor.stop();
  });

  eventBench.add("XState: send 1000 events", () => {
    const actor = createActor(xstateMachine);
    actor.start();
    for (let i = 0; i < 500; i++) {
      actor.send({ type: "INCREMENT" });
      actor.send({ type: "DECREMENT" });
    }
    actor.stop();
  });

  await eventBench.run();

  console.table(
    eventBench.tasks.map((task) => ({
      Task: task.name,
      "ops/sec": formatOps(getOpsPerSec(task)),
      "Mean (μs)": formatMean(getMeanMicroseconds(task)),
    })),
  );

  printComparison(
    "send 1000 events",
    eventBench.getTask("v3: send 1000 events"),
    eventBench.getTask("XState: send 1000 events"),
  );

  // -------------------------------------------------------------------------
  // Benchmark 4: With Subscribers
  // -------------------------------------------------------------------------
  console.log("\n\n👀 WITH SUBSCRIBERS (5 subscribers, 100 events)\n");

  const subscriberBench = new Bench({ time: 200, warmupTime: 50 });

  subscriberBench.add("v3: with 5 subscribers", () => {
    const actor = Effect.runSync(v3Machine.interpret());
    const unsubs: Array<() => void> = [];
    for (let i = 0; i < 5; i++) {
      unsubs.push(actor.subscribe(() => {}));
    }
    for (let i = 0; i < 50; i++) {
      actor.send(incrementEvent);
      actor.send(decrementEvent);
    }
    unsubs.forEach((unsub) => unsub());
    actor.stop();
  });

  subscriberBench.add("XState: with 5 subscribers", () => {
    const actor = createActor(xstateMachine);
    const unsubs: Array<{ unsubscribe: () => void }> = [];
    for (let i = 0; i < 5; i++) {
      unsubs.push(actor.subscribe(() => {}));
    }
    actor.start();
    for (let i = 0; i < 50; i++) {
      actor.send({ type: "INCREMENT" });
      actor.send({ type: "DECREMENT" });
    }
    unsubs.forEach((sub) => sub.unsubscribe());
    actor.stop();
  });

  await subscriberBench.run();

  console.table(
    subscriberBench.tasks.map((task) => ({
      Task: task.name,
      "ops/sec": formatOps(getOpsPerSec(task)),
      "Mean (μs)": formatMean(getMeanMicroseconds(task)),
    })),
  );

  printComparison(
    "with 5 subscribers",
    subscriberBench.getTask("v3: with 5 subscribers"),
    subscriberBench.getTask("XState: with 5 subscribers"),
  );

  // -------------------------------------------------------------------------
  // Benchmark 5: Transition Actions (v3 only - compare with/without)
  // -------------------------------------------------------------------------
  console.log("\n\n⚡ TRANSITION ACTIONS (v3 feature)\n");

  const actionsMachine = defineMachine<CounterState, CounterContext, CounterEvent>({
    id: "counter-with-actions",
    initialState: CounterState.idle(),
    initialContext: { count: 0 },
    states: {
      idle: {
        on: {
          Increment: (ctx) => ({
            goto: CounterState.counting(),
            update: { count: ctx.count + 1 },
            actions: [() => {}, () => {}], // 2 no-op actions
          }),
        },
      },
      counting: {
        on: {
          Increment: (ctx) => ({
            update: { count: ctx.count + 1 },
            actions: [() => {}],
          }),
          Decrement: (ctx) => ({
            update: { count: ctx.count - 1 },
            actions: [() => {}],
          }),
        },
      },
    },
  });

  const actionsBench = new Bench({ time: 200, warmupTime: 50 });

  actionsBench.add("v3: without actions (1000 events)", () => {
    const actor = Effect.runSync(v3Machine.interpret());
    for (let i = 0; i < 500; i++) {
      actor.send(incrementEvent);
      actor.send(decrementEvent);
    }
    actor.stop();
  });

  actionsBench.add("v3: with actions (1000 events)", () => {
    const actor = Effect.runSync(actionsMachine.interpret());
    for (let i = 0; i < 500; i++) {
      actor.send(incrementEvent);
      actor.send(decrementEvent);
    }
    actor.stop();
  });

  await actionsBench.run();

  console.table(
    actionsBench.tasks.map((task) => ({
      Task: task.name,
      "ops/sec": formatOps(getOpsPerSec(task)),
      "Mean (μs)": formatMean(getMeanMicroseconds(task)),
    })),
  );

  const withoutActions = actionsBench.getTask("v3: without actions (1000 events)");
  const withActions = actionsBench.getTask("v3: with actions (1000 events)");
  if (withoutActions && withActions) {
    const withoutOps = getOpsPerSec(withoutActions);
    const withOps = getOpsPerSec(withActions);
    if (withoutOps && withOps) {
      const overhead = ((withoutOps - withOps) / withoutOps) * 100;
      console.log(`  Actions overhead: ${overhead.toFixed(1)}%`);
    }
  }

  // -------------------------------------------------------------------------
  // Benchmark 6: Realistic App Lifecycle
  // -------------------------------------------------------------------------
  console.log("\n\n🔄 REALISTIC APP LIFECYCLE\n");
  console.log("  Simulates: create → subscribe → 50 user interactions → unsubscribe → stop\n");

  const fullBench = new Bench({ time: 200, warmupTime: 50 });

  fullBench.add("v3: realistic lifecycle", () => {
    const actor = Effect.runSync(v3Machine.interpret());
    let lastSnapshot = actor.getSnapshot();
    const unsub = actor.subscribe((s) => { lastSnapshot = s; });

    for (let i = 0; i < 25; i++) {
      actor.send(incrementEvent);
      actor.send(decrementEvent);
    }

    void lastSnapshot.context.count;
    unsub();
    actor.stop();
  });

  fullBench.add("XState: realistic lifecycle", () => {
    const actor = createActor(xstateMachine);
    actor.start();
    let lastSnapshot = actor.getSnapshot();
    const sub = actor.subscribe((s) => { lastSnapshot = s; });

    for (let i = 0; i < 25; i++) {
      actor.send({ type: "INCREMENT" });
      actor.send({ type: "DECREMENT" });
    }

    void lastSnapshot.context.count;
    sub.unsubscribe();
    actor.stop();
  });

  await fullBench.run();

  console.table(
    fullBench.tasks.map((task) => ({
      Task: task.name,
      "ops/sec": formatOps(getOpsPerSec(task)),
      "Mean (μs)": formatMean(getMeanMicroseconds(task)),
    })),
  );

  printComparison(
    "realistic lifecycle",
    fullBench.getTask("v3: realistic lifecycle"),
    fullBench.getTask("XState: realistic lifecycle"),
  );

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log("\n" + "═".repeat(70));
  console.log("  SUMMARY");
  console.log("═".repeat(70) + "\n");

  const allBenches = [
    {
      label: "defineMachine/createMachine",
      v3: creationBench.getTask("v3: defineMachine"),
      xstate: creationBench.getTask("XState: createMachine"),
    },
    {
      label: "interpret/createActor",
      v3: lifecycleBench.getTask("v3: interpret + stop"),
      xstate: lifecycleBench.getTask("XState: createActor + start + stop"),
    },
    {
      label: "send 1000 events",
      v3: eventBench.getTask("v3: send 1000 events"),
      xstate: eventBench.getTask("XState: send 1000 events"),
    },
    {
      label: "with subscribers",
      v3: subscriberBench.getTask("v3: with 5 subscribers"),
      xstate: subscriberBench.getTask("XState: with 5 subscribers"),
    },
    {
      label: "realistic lifecycle",
      v3: fullBench.getTask("v3: realistic lifecycle"),
      xstate: fullBench.getTask("XState: realistic lifecycle"),
    },
  ];

  let v3Wins = 0;
  let xstateWins = 0;

  for (const { label, v3, xstate } of allBenches) {
    printComparison(label, v3, xstate);

    if (v3 && xstate) {
      const v3Ops = getOpsPerSec(v3);
      const xstateOps = getOpsPerSec(xstate);
      if (v3Ops !== null && xstateOps !== null) {
        if (v3Ops > xstateOps) v3Wins++;
        else xstateWins++;
      }
    }
  }

  console.log("\n" + "─".repeat(70));
  console.log(`  Final Score: v3 ${v3Wins} - ${xstateWins} XState`);
  console.log("─".repeat(70) + "\n");
}

main().catch(console.error);
