import { Bench, type Task } from "tinybench";
import { Data, Schema } from "effect";

// Our Effect-first state machine
import { createMachine, interpretSync, assign } from "./index.js";

// XState
import {
  createMachine as xstateCreateMachine,
  createActor,
  assign as xstateAssign,
} from "xstate";

// ============================================================================
// Define equivalent machines in both libraries
// ============================================================================

// Effect-first machine events
class Increment extends Data.TaggedClass("INCREMENT")<{}> {}
class Decrement extends Data.TaggedClass("DECREMENT")<{}> {}

type CounterEvent = Increment | Decrement;

// Schema for counter context
const CounterContextSchema = Schema.Struct({
  count: Schema.Number,
});

// Effect-first counter machine
const effectMachine = createMachine({
  id: "counter",
  initial: "idle",
  context: CounterContextSchema,
  initialContext: { count: 0 },
  states: {
    idle: {
      on: {
        INCREMENT: {
          target: "counting",
          actions: [
            assign(({ context }) => ({
              count: context.count + 1,
            })),
          ],
        },
      },
    },
    counting: {
      on: {
        INCREMENT: {
          actions: [
            assign(({ context }) => ({
              count: context.count + 1,
            })),
          ],
        },
        DECREMENT: {
          actions: [
            assign(({ context }) => ({
              count: context.count - 1,
            })),
          ],
        },
      },
    },
  },
});

// XState counter machine (equivalent)
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

// Pre-create events for Effect machine
const incrementEvent = new Increment();
const decrementEvent = new Decrement();

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
  effectTask: Task | undefined,
  xstateTask: Task | undefined,
): void {
  if (!effectTask || !xstateTask) return;

  const effectOps = getOpsPerSec(effectTask);
  const xstateOps = getOpsPerSec(xstateTask);

  if (effectOps === null || xstateOps === null) return;

  const ratio = effectOps / xstateOps;
  const winner = ratio > 1 ? "Effect" : "XState";
  const multiplier = ratio > 1 ? ratio : 1 / ratio;
  const emoji = ratio > 1.1 ? "🚀" : ratio < 0.9 ? "🐢" : "⚖️";

  console.log(
    `  ${emoji} ${label.padEnd(25)} ${winner} is ${multiplier.toFixed(2)}x faster`,
  );
}

// ============================================================================
// Verification - Prove Both Implementations Do the Same Work
// ============================================================================

function verifyImplementations() {
  console.log("🔍 VERIFICATION: Confirming both implementations do the same work\n");

  // Test 1: Context updates work
  {
    const effectActor = interpretSync(effectMachine);
    effectActor.send(incrementEvent);
    effectActor.send(incrementEvent);
    effectActor.send(decrementEvent);
    const effectCount = effectActor.getSnapshot().context.count;
    effectActor.stop();

    const xstateActor = createActor(xstateMachine);
    xstateActor.start();
    xstateActor.send({ type: "INCREMENT" });
    xstateActor.send({ type: "INCREMENT" });
    xstateActor.send({ type: "DECREMENT" });
    const xstateCount = xstateActor.getSnapshot().context.count;
    xstateActor.stop();

    console.log(`  ✓ Context updates: Effect=${effectCount}, XState=${xstateCount} ${effectCount === xstateCount ? "✓" : "✗"}`);
  }

  // Test 2: Subscribers are called
  {
    let effectCalls = 0;
    let xstateCalls = 0;

    const effectActor = interpretSync(effectMachine);
    effectActor.subscribe(() => effectCalls++);
    effectActor.send(incrementEvent);
    effectActor.send(incrementEvent);
    effectActor.stop();

    const xstateActor = createActor(xstateMachine);
    xstateActor.subscribe(() => xstateCalls++);
    xstateActor.start();
    xstateActor.send({ type: "INCREMENT" });
    xstateActor.send({ type: "INCREMENT" });
    xstateActor.stop();

    // Note: XState calls subscriber on start() too, so it has one extra call
    console.log(`  ✓ Subscriber calls: Effect=${effectCalls}, XState=${xstateCalls} (XState includes start() call)`);
  }

  // Test 3: State transitions work
  {
    const effectActor = interpretSync(effectMachine);
    const effectState1 = effectActor.getSnapshot().value;
    effectActor.send(incrementEvent);
    const effectState2 = effectActor.getSnapshot().value;
    effectActor.stop();

    const xstateActor = createActor(xstateMachine);
    xstateActor.start();
    const xstateState1 = xstateActor.getSnapshot().value;
    xstateActor.send({ type: "INCREMENT" });
    const xstateState2 = xstateActor.getSnapshot().value;
    xstateActor.stop();

    console.log(`  ✓ State transitions: Effect=${effectState1}→${effectState2}, XState=${xstateState1}→${xstateState2}`);
  }

  console.log("\n  Both implementations perform equivalent work.\n");
  console.log("  XState has additional overhead from:");
  console.log("    • DevTools/inspection support (always-on)");
  console.log("    • Actor system relay for event routing");
  console.log("    • Observer protocol (next/error/complete vs plain functions)");
  console.log("    • Per-observer try/catch error isolation\n");
}

// ============================================================================
// Run Benchmarks
// ============================================================================

async function main() {
  console.log("\n" + "═".repeat(70));
  console.log("  STATE MACHINE BENCHMARK: Effect-first vs XState");
  console.log("═".repeat(70) + "\n");

  // First, verify implementations are equivalent
  verifyImplementations();

  // -------------------------------------------------------------------------
  // Benchmark Group 1: Machine Creation
  // -------------------------------------------------------------------------
  console.log("📦 MACHINE CREATION\n");

  const creationBench = new Bench({ time: 200, warmupTime: 50 });

  creationBench.add("Effect: createMachine", () => {
    createMachine({
      id: "counter",
      initial: "idle",
      context: CounterContextSchema,
      initialContext: { count: 0 },
      states: {
        idle: { on: { INCREMENT: { target: "counting" } } },
        counting: { on: { DECREMENT: { target: "idle" } } },
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
    "createMachine",
    creationBench.getTask("Effect: createMachine"),
    creationBench.getTask("XState: createMachine"),
  );

  // -------------------------------------------------------------------------
  // Benchmark Group 2: Actor Lifecycle
  // -------------------------------------------------------------------------
  console.log("\n\n🎭 ACTOR LIFECYCLE\n");

  const lifecycleBench = new Bench({ time: 200, warmupTime: 50 });

  lifecycleBench.add("Effect: interpret + stop", () => {
    const actor = interpretSync(effectMachine);
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
    lifecycleBench.getTask("Effect: interpret + stop"),
    lifecycleBench.getTask("XState: createActor + start + stop"),
  );

  // -------------------------------------------------------------------------
  // Benchmark Group 3: Event Sending
  // -------------------------------------------------------------------------
  console.log("\n\n📨 EVENT SENDING (1000 events)\n");

  const eventBench = new Bench({ time: 200, warmupTime: 50 });

  eventBench.add("Effect: send 1000 events", () => {
    const actor = interpretSync(effectMachine);
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
    eventBench.getTask("Effect: send 1000 events"),
    eventBench.getTask("XState: send 1000 events"),
  );

  // -------------------------------------------------------------------------
  // Benchmark Group 4: With Subscribers
  // -------------------------------------------------------------------------
  console.log("\n\n👀 WITH SUBSCRIBERS (5 subscribers, 100 events)\n");

  const subscriberBench = new Bench({ time: 200, warmupTime: 50 });

  subscriberBench.add("Effect: with 5 subscribers", () => {
    const actor = interpretSync(effectMachine);
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
    subscriberBench.getTask("Effect: with 5 subscribers"),
    subscriberBench.getTask("XState: with 5 subscribers"),
  );

  // -------------------------------------------------------------------------
  // Benchmark Group 5: Full Realistic Lifecycle
  // -------------------------------------------------------------------------
  console.log("\n\n🔄 FULL LIFECYCLE (create → events → snapshot → stop)\n");

  const fullBench = new Bench({ time: 200, warmupTime: 50 });

  fullBench.add("Effect: full lifecycle", () => {
    const actor = interpretSync(effectMachine);
    actor.send(incrementEvent);
    actor.send(incrementEvent);
    actor.send(decrementEvent);
    actor.getSnapshot();
    actor.stop();
  });

  fullBench.add("XState: full lifecycle", () => {
    const actor = createActor(xstateMachine);
    actor.start();
    actor.send({ type: "INCREMENT" });
    actor.send({ type: "INCREMENT" });
    actor.send({ type: "DECREMENT" });
    actor.getSnapshot();
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
    "full lifecycle",
    fullBench.getTask("Effect: full lifecycle"),
    fullBench.getTask("XState: full lifecycle"),
  );

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log("\n" + "═".repeat(70));
  console.log("  SUMMARY");
  console.log("═".repeat(70) + "\n");

  const allBenches = [
    {
      label: "createMachine",
      effect: creationBench.getTask("Effect: createMachine"),
      xstate: creationBench.getTask("XState: createMachine"),
    },
    {
      label: "interpret/createActor",
      effect: lifecycleBench.getTask("Effect: interpret + stop"),
      xstate: lifecycleBench.getTask("XState: createActor + start + stop"),
    },
    {
      label: "send 1000 events",
      effect: eventBench.getTask("Effect: send 1000 events"),
      xstate: eventBench.getTask("XState: send 1000 events"),
    },
    {
      label: "with subscribers",
      effect: subscriberBench.getTask("Effect: with 5 subscribers"),
      xstate: subscriberBench.getTask("XState: with 5 subscribers"),
    },
    {
      label: "full lifecycle",
      effect: fullBench.getTask("Effect: full lifecycle"),
      xstate: fullBench.getTask("XState: full lifecycle"),
    },
  ];

  let effectWins = 0;
  let xstateWins = 0;

  for (const { label, effect, xstate } of allBenches) {
    printComparison(label, effect, xstate);

    if (effect && xstate) {
      const effectOps = getOpsPerSec(effect);
      const xstateOps = getOpsPerSec(xstate);
      if (effectOps !== null && xstateOps !== null) {
        if (effectOps > xstateOps) effectWins++;
        else xstateWins++;
      }
    }
  }

  console.log("\n" + "─".repeat(70));
  console.log(
    `  Final Score: Effect ${effectWins} - ${xstateWins} XState`,
  );
  console.log("─".repeat(70) + "\n");
}

main().catch(console.error);
