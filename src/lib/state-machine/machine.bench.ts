import { Bench } from "tinybench";
import { Effect, Scope, Logger, LogLevel } from "effect";
import { Data } from "effect";

// Our Effect-first state machine
import { createMachine, interpret, assign } from "./index.js";

// XState
import { createMachine as xstateCreateMachine, createActor, assign as xstateAssign } from "xstate";

// ============================================================================
// Define equivalent machines in both libraries
// ============================================================================

// Effect-first machine events
class Increment extends Data.TaggedClass("INCREMENT")<{}> {}
class Decrement extends Data.TaggedClass("DECREMENT")<{}> {}

type CounterEvent = Increment | Decrement;

// Effect-first counter machine
const effectMachine = createMachine<
  "counter",
  "idle" | "counting",
  { count: number },
  CounterEvent
>({
  id: "counter",
  initial: "idle",
  context: { count: 0 },
  states: {
    idle: {
      on: {
        INCREMENT: {
          target: "counting",
          actions: [assign<{ count: number }, Increment>(({ context }) => ({ count: context.count + 1 }))],
        },
      },
    },
    counting: {
      on: {
        INCREMENT: {
          actions: [assign<{ count: number }, Increment>(({ context }) => ({ count: context.count + 1 }))],
        },
        DECREMENT: {
          actions: [assign<{ count: number }, Decrement>(({ context }) => ({ count: context.count - 1 }))],
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
// Run Benchmarks
// ============================================================================

async function main() {
  console.log("=".repeat(70));
  console.log("State Machine Benchmark: Effect-first vs XState");
  console.log("=".repeat(70));
  console.log();

  const bench = new Bench({ time: 200, warmupTime: 50 });

  // Benchmark: Machine Creation
  bench.add("Effect: createMachine", () => {
    createMachine<"counter", "idle" | "counting", { count: number }, CounterEvent>({
      id: "counter",
      initial: "idle",
      context: { count: 0 },
      states: {
        idle: { on: { INCREMENT: { target: "counting" } } },
        counting: { on: { DECREMENT: { target: "idle" } } },
      },
    });
  });

  bench.add("XState: createMachine", () => {
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

  // Benchmark: Actor Creation
  bench.add("Effect: interpret", () => {
    const program = Effect.gen(function* () {
      const scope = yield* Scope.make();
      const actor = yield* Effect.provideService(interpret(effectMachine), Scope.Scope, scope);
      return actor;
    }).pipe(Logger.withMinimumLogLevel(LogLevel.None));
    Effect.runSync(program);
  });

  bench.add("XState: createActor+start", () => {
    const actor = createActor(xstateMachine);
    actor.start();
    actor.stop();
  });

  // Benchmark: Full Lifecycle
  bench.add("Effect: full lifecycle", () => {
    const program = Effect.gen(function* () {
      const scope = yield* Scope.make();
      const actor = yield* Effect.provideService(interpret(effectMachine), Scope.Scope, scope);
      actor.send(incrementEvent);
      actor.send(incrementEvent);
      actor.send(decrementEvent);
      actor.getSnapshot(); // getSnapshot is now synchronous!
      yield* Scope.close(scope, Effect.void);
    }).pipe(Logger.withMinimumLogLevel(LogLevel.None));
    Effect.runSync(program);
  });

  bench.add("XState: full lifecycle", () => {
    const actor = createActor(xstateMachine);
    actor.start();
    actor.send({ type: "INCREMENT" });
    actor.send({ type: "INCREMENT" });
    actor.send({ type: "DECREMENT" });
    actor.getSnapshot();
    actor.stop();
  });

  console.log("Running benchmarks (6 tests, ~200ms each)...\n");

  await bench.run();

  // Print results - tinybench v6 uses throughput.mean for ops/sec and latency.mean for mean time
  console.table(
    bench.tasks.map((task) => {
      const r = task.result;
      if (!r || r.state === "errored") {
        return {
          "Task": task.name,
          "ops/sec": r?.state === "errored" ? "ERROR" : "N/A",
          "Mean (μs)": "N/A",
        };
      }
      const opsPerSec = 1000 / r.period; // period is in ms
      return {
        "Task": task.name,
        "ops/sec": opsPerSec.toLocaleString(undefined, { maximumFractionDigits: 0 }),
        "Mean (μs)": (r.period * 1000).toFixed(2),
      };
    }),
  );

  // Print summary
  console.log("\n" + "=".repeat(70));
  console.log("Summary");
  console.log("=".repeat(70) + "\n");

  const tasks = bench.tasks;
  const pairs: [string, string][] = [
    ["Effect: createMachine", "XState: createMachine"],
    ["Effect: interpret", "XState: createActor+start"],
    ["Effect: full lifecycle", "XState: full lifecycle"],
  ];

  for (const [effectName, xstateName] of pairs) {
    const effectTask = tasks.find((t) => t.name === effectName);
    const xstateTask = tasks.find((t) => t.name === xstateName);

    const effectResult = effectTask?.result;
    const xstateResult = xstateTask?.result;

    if (effectResult?.state === "completed" && xstateResult?.state === "completed") {
      const effectOps = 1000 / effectResult.period;
      const xstateOps = 1000 / xstateResult.period;
      const ratio = effectOps / xstateOps;
      const winner = ratio > 1 ? "Effect" : "XState";
      const multiplier = ratio > 1 ? ratio : 1 / ratio;
      const operation = effectName.replace("Effect: ", "");
      console.log(`${operation.padEnd(20)} → ${winner} is ${multiplier.toFixed(2)}x faster`);
    }
  }

  console.log();
}

main().catch(console.error);
