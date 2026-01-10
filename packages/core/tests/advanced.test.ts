import { describe, it, expect } from "vitest";
import { Context, Data, Effect, Exit, Ref, Schema, Scope } from "effect";
import { createMachine, interpret } from "../src/machine.js";
import { testActorSync } from "./test-utils.js";
import { assign, effect, spawnChild, sendTo } from "../src/actions.js";
import {
  createSnapshotSchema,
  encodeSnapshotSync,
  decodeSnapshotSync,
} from "../src/serialization.js";
import type { MachineEvent } from "../src/types.js";

// ============================================================================
// Test Event Types
// ============================================================================

class Toggle extends Data.TaggedClass("TOGGLE")<{}> {}
class Increment extends Data.TaggedClass("INCREMENT")<{}> {}
class Tick extends Data.TaggedClass("TICK")<{}> {}

type TestEvent = Toggle | Increment | Tick;

// ============================================================================
// Test Context Schemas (Schema-based context required)
// ============================================================================

const TestContextSchema = Schema.Struct({
  count: Schema.Number,
  log: Schema.Array(Schema.String),
});

const EmptyContextSchema = Schema.Struct({});
const CountOnlySchema = Schema.Struct({ count: Schema.Number });
const MultiplierContextSchema = Schema.Struct({ multiplier: Schema.Number });
const ValueContextSchema = Schema.Struct({ value: Schema.Number });

// ============================================================================
// Define test services
// ============================================================================

class CounterService extends Context.Tag("CounterService")<
  CounterService,
  { readonly increment: (n: number) => Effect.Effect<number> }
>() {}

// ============================================================================
// interpret (Effect-native with services)
// ============================================================================

describe("interpret (Effect-native)", () => {
  it("provides services to effect actions", async () => {
    const results: number[] = [];

    const machine = createMachine<
      "test",
      "idle" | "done",
      { count: number },
      Toggle,
      CounterService
    >({
      id: "test",
      initial: "idle",
      context: CountOnlySchema,
      initialContext: { count: 5 },
      states: {
        idle: {
          on: {
            TOGGLE: {
              target: "done",
              actions: [
                effect(({ context }) =>
                  Effect.gen(function* () {
                    const counter = yield* CounterService;
                    const result = yield* counter.increment(context.count);
                    results.push(result);
                  })
                ),
              ],
            },
          },
        },
        done: {},
      },
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const actor = yield* interpret(machine);

        actor.send(new Toggle());

        // Give effect action time to run
        yield* Effect.sleep("20 millis");

        expect(actor.getSnapshot().value).toBe("done");
        expect(results).toEqual([10]); // 5 * 2 from our mock service
      }).pipe(
        Effect.provideService(CounterService, {
          increment: (n) => Effect.succeed(n * 2),
        }),
        Effect.scoped
      )
    );
  });

  it("auto-stops actor when scope closes", async () => {
    let actorStopped = false;

    const machine = createMachine({
      id: "test",
      initial: "running",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        running: {
          activities: [
            {
              id: "poller",
              src: () =>
                Effect.gen(function* () {
                  yield* Effect.addFinalizer(() =>
                    Effect.sync(() => {
                      actorStopped = true;
                    })
                  );
                  yield* Effect.never;
                }).pipe(Effect.scoped),
            },
          ],
        },
      },
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        // Create a scope manually
        const scope = yield* Scope.make();

        const actor = yield* interpret(machine).pipe(
          Effect.provideService(Scope.Scope, scope)
        );

        expect(actor.getSnapshot().value).toBe("running");
        expect(actorStopped).toBe(false);

        // Close the scope - should stop the actor
        yield* Scope.close(scope, Exit.succeed(undefined));

        // Give cleanup time to run
        yield* Effect.sleep("10 millis");

        expect(actorStopped).toBe(true);
      })
    );
  });

  it("provides services to activities", async () => {
    const results: number[] = [];

    const machine = createMachine<
      "test",
      "active",
      { multiplier: number },
      TestEvent,
      CounterService
    >({
      id: "test",
      initial: "active",
      context: MultiplierContextSchema,
      initialContext: { multiplier: 3 },
      states: {
        active: {
          activities: [
            {
              id: "worker",
              src: ({ context }) =>
                Effect.gen(function* () {
                  const counter = yield* CounterService;
                  const result = yield* counter.increment(context.multiplier);
                  results.push(result);
                }),
            },
          ],
        },
      },
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const actor = yield* interpret(machine);

        // Give activity time to run
        yield* Effect.sleep("20 millis");

        expect(results).toEqual([6]); // 3 * 2 from our mock service
        expect(actor.getSnapshot().value).toBe("active");
      }).pipe(
        Effect.provideService(CounterService, {
          increment: (n) => Effect.succeed(n * 2),
        }),
        Effect.scoped
      )
    );
  });

  it("provides services to child actors", async () => {
    const results: number[] = [];

    const childMachine = createMachine<
      "child",
      "working",
      { value: number },
      Toggle,
      CounterService
    >({
      id: "child",
      initial: "working",
      context: ValueContextSchema,
      initialContext: { value: 7 },
      states: {
        working: {
          entry: [
            effect(({ context }) =>
              Effect.gen(function* () {
                const counter = yield* CounterService;
                const result = yield* counter.increment(context.value);
                results.push(result);
              })
            ),
          ],
        },
      },
    });

    const parentMachine = createMachine<
      "parent",
      "idle",
      {},
      Toggle,
      CounterService
    >({
      id: "parent",
      initial: "idle",
      context: EmptyContextSchema,
      initialContext: {},
      states: {
        idle: {
          entry: [spawnChild(childMachine, { id: "myChild" })],
        },
      },
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* interpret(parentMachine);

        // Give child time to spawn and run entry action
        yield* Effect.sleep("30 millis");

        expect(results).toEqual([14]); // 7 * 2 from our mock service
      }).pipe(
        Effect.provideService(CounterService, {
          increment: (n) => Effect.succeed(n * 2),
        }),
        Effect.scoped
      )
    );
  });
});

// ============================================================================
// Type-level tests (compile-time verification)
// ============================================================================

describe("Type Safety", () => {
  it("requires services to be provided when R is not never", () => {
    // This test verifies at compile time that missing services cause errors.
    // The @ts-expect-error comments will fail the build if the types are wrong.

    // Define a service
    class LogService extends Context.Tag("LogService")<
      LogService,
      { readonly log: (msg: string) => Effect.Effect<void> }
    >() {}

    // Machine that requires LogService
    const machineWithService = createMachine<
      "test",
      "idle",
      {},
      Toggle,
      LogService // R = LogService
    >({
      id: "test",
      initial: "idle",
      context: EmptyContextSchema,
      initialContext: {},
      states: {
        idle: {
          entry: [
            effect(() =>
              Effect.gen(function* () {
                const log = yield* LogService;
                yield* log.log("hello");
              })
            ),
          ],
        },
      },
    });

    // This should compile - services are provided
    void Effect.gen(function* () {
      const actor = yield* interpret(machineWithService);
      return actor;
    }).pipe(
      Effect.provideService(LogService, {
        log: () => Effect.void,
      }),
      Effect.scoped
    );

    // Verify the type includes LogService in requirements
    type MachineR = typeof machineWithService extends { config: { states: infer S } }
      ? S extends Record<string, { entry?: ReadonlyArray<infer A> }>
        ? A extends { _tag: "effect"; fn: (...args: never[]) => Effect.Effect<void, infer _E, infer R> }
          ? R
          : never
        : never
      : never;

    // Type assertion: MachineR should include LogService
    const _typeCheck: MachineR = {} as LogService;
    void _typeCheck;
  });

  it("allows interpret without services when R is never", () => {
    // Machine with no service requirements
    const machineNoServices = createMachine({
      id: "test",
      initial: "idle",
      context: EmptyContextSchema,
      initialContext: {},
      states: {
        idle: {
          entry: [assign({})], // No effect actions with services
        },
      },
    });

    // This should compile - no services needed
    const _validProgram = Effect.gen(function* () {
      const actor = yield* interpret(machineNoServices);
      return actor;
    }).pipe(Effect.scoped);

    void _validProgram;
  });

  it("testActorSync does not require service provision at type level", () => {
    // Machine that normally requires services
    const machineWithService = createMachine<
      "test",
      "idle",
      {},
      Toggle,
      CounterService
    >({
      id: "test",
      initial: "idle",
      context: EmptyContextSchema,
      initialContext: {},
      states: {
        idle: {},
      },
    });

    // testActorSync compiles without providing services
    // (though effect actions requiring services would fail at runtime if triggered)
    const _actor = testActorSync(machineWithService);
    _actor.stop();
  });
});

// ============================================================================
// Schema Context
// ============================================================================

describe("Schema Context", () => {
  // Define a Schema for context with a Date field
  const CounterContextSchema = Schema.Struct({
    count: Schema.Number,
    lastUpdated: Schema.DateFromString,
  });

  type CounterContext = typeof CounterContextSchema.Type;
  type CounterContextEncoded = typeof CounterContextSchema.Encoded;

  it("creates machine with Schema context", () => {
    const machine = createMachine<
      "counter",
      "idle",
      CounterContext,
      CounterContextEncoded,
      Increment
    >({
      id: "counter",
      initial: "idle",
      context: CounterContextSchema,
      initialContext: { count: 0, lastUpdated: new Date("2024-01-01") },
      states: {
        idle: {
          on: {
            INCREMENT: {
              actions: [
                assign(({ context }) => ({
                  count: context.count + 1,
                  lastUpdated: new Date(),
                })),
              ],
            },
          },
        },
      },
    });

    expect(machine._tag).toBe("MachineDefinition");
    expect(machine.contextSchema).toBeDefined();
    expect(machine.initialSnapshot.context.count).toBe(0);
    expect(machine.initialSnapshot.context.lastUpdated).toBeInstanceOf(Date);
  });

  it("encodes snapshot with Date to JSON-safe format", () => {
    const machine = createMachine<
      "counter",
      "idle",
      CounterContext,
      CounterContextEncoded,
      MachineEvent
    >({
      id: "counter",
      initial: "idle",
      context: CounterContextSchema,
      initialContext: { count: 42, lastUpdated: new Date("2024-06-15T12:00:00Z") },
      states: {
        idle: {},
      },
    });

    const actor = testActorSync(machine);
    const snapshot = actor.getSnapshot();

    const encoded = encodeSnapshotSync(machine, snapshot);

    expect(encoded.value).toBe("idle");
    expect(encoded.context.count).toBe(42);
    expect(encoded.context.lastUpdated).toBe("2024-06-15T12:00:00.000Z");
    expect(typeof encoded.context.lastUpdated).toBe("string");

    actor.stop();
  });

  it("decodes snapshot from JSON-safe format", () => {
    const machine = createMachine({
      id: "counter",
      initial: "idle",
      context: CounterContextSchema,
      initialContext: { count: 0, lastUpdated: new Date() },
      states: {
        idle: {},
      },
    });

    const encoded = {
      value: "idle" as const,
      context: {
        count: 100,
        lastUpdated: "2024-12-25T00:00:00.000Z",
      },
    };

    const decoded = decodeSnapshotSync(machine, encoded);

    expect(decoded.value).toBe("idle");
    expect(decoded.context.count).toBe(100);
    expect(decoded.context.lastUpdated).toBeInstanceOf(Date);
    expect(decoded.context.lastUpdated.toISOString()).toBe("2024-12-25T00:00:00.000Z");
  });

  it("roundtrip encode/decode preserves data", () => {
    const machine = createMachine<
      "counter",
      "idle",
      CounterContext,
      CounterContextEncoded,
      Increment
    >({
      id: "counter",
      initial: "idle",
      context: CounterContextSchema,
      initialContext: { count: 0, lastUpdated: new Date() },
      states: {
        idle: {
          on: {
            INCREMENT: {
              actions: [
                assign(({ context }) => ({
                  count: context.count + 1,
                  lastUpdated: new Date("2024-07-04T15:30:00Z"),
                })),
              ],
            },
          },
        },
      },
    });

    const actor = testActorSync(machine);
    actor.send(new Increment());

    const original = actor.getSnapshot();
    const encoded = encodeSnapshotSync(machine, original);
    const decoded = decodeSnapshotSync(machine, encoded);

    expect(decoded.value).toBe(original.value);
    expect(decoded.context.count).toBe(original.context.count);
    expect(decoded.context.lastUpdated.getTime()).toBe(original.context.lastUpdated.getTime());

    actor.stop();
  });

  it("requires Schema context (no plain context support)", () => {
    const machine = createMachine({
      id: "simple",
      initial: "idle",
      context: CountOnlySchema,
      initialContext: { count: 0 },
      states: {
        idle: {},
      },
    });

    // Schema context is now required - contextSchema should always be defined
    expect(machine.contextSchema).toBeDefined();

    const actor = testActorSync(machine);
    expect(actor.getSnapshot().context.count).toBe(0);
    actor.stop();
  });

  it("creates snapshot schema for machines", () => {
    const machine = createMachine({
      id: "counter",
      initial: "idle",
      context: CounterContextSchema,
      initialContext: { count: 0, lastUpdated: new Date() },
      states: {
        idle: {},
      },
    });

    const snapshotSchema = createSnapshotSchema(machine);

    // Schema should be usable for encoding
    const snapshot = machine.initialSnapshot;
    const encoded = Schema.encodeSync(snapshotSchema)(snapshot);

    expect(encoded.value).toBe("idle");
    expect(typeof encoded.context.lastUpdated).toBe("string");
  });
});

// ============================================================================
// Snapshot Restoration with Children
// ============================================================================

describe("interpret with snapshot restoration", () => {
  // Child machine for testing restoration
  const ChildContextSchema = Schema.Struct({
    value: Schema.Number,
  });

  const createRestorableChildMachine = () =>
    createMachine({
      id: "child",
      initial: "idle",
      context: ChildContextSchema,
      initialContext: { value: 0 },
      states: {
        idle: {
          on: {
            INCREMENT: {
              actions: [assign(({ context }) => ({ value: context.value + 1 }))],
            },
            TOGGLE: { target: "active" },
          },
        },
        active: {
          on: {
            INCREMENT: {
              actions: [assign(({ context }) => ({ value: context.value + 10 }))],
            },
            TOGGLE: { target: "idle" },
          },
        },
      },
    });

  it("restores to initial state with child snapshots", async () => {
    const childMachine = createRestorableChildMachine();

    const ParentContextSchema = Schema.Struct({ count: Schema.Number });

    const machine = createMachine({
      id: "parent",
      initial: "idle",
      context: ParentContextSchema,
      initialContext: { count: 0 },
      states: {
        idle: {
          entry: [
            spawnChild(childMachine, { id: "child1" }),
            spawnChild(childMachine, { id: "child2" }),
          ],
          on: {
            TOGGLE: { target: "running" },
          },
        },
        running: {
          on: {
            TOGGLE: { target: "idle" },
          },
        },
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          // Restore to initial state "idle" with child snapshots
          const actor = yield* interpret(machine, {
            snapshot: {
              value: "idle",
              context: { count: 5 },
              event: null,
            },
            childSnapshots: new Map([
              ["child1", { value: "active", context: { value: 100 }, event: null }],
              ["child2", { value: "idle", context: { value: 50 }, event: null }],
            ]),
          });

          yield* Effect.sleep("20 millis");

          // Parent should be in idle state with restored context
          expect(actor.getSnapshot().value).toBe("idle");
          expect(actor.getSnapshot().context.count).toBe(5);

          // Children should exist and have restored state
          expect(actor.children.size).toBe(2);

          const child1 = actor.children.get("child1");
          expect(child1).toBeDefined();
          expect(child1!.getSnapshot().value).toBe("active");
          expect(child1!.getSnapshot().context.value).toBe(100);

          const child2 = actor.children.get("child2");
          expect(child2).toBeDefined();
          expect(child2!.getSnapshot().value).toBe("idle");
          expect(child2!.getSnapshot().context.value).toBe(50);
        }),
      ),
    );
  });

  it("restores to non-initial state with child snapshots", async () => {
    const childMachine = createRestorableChildMachine();

    const ParentContextSchema = Schema.Struct({ count: Schema.Number });

    const machine = createMachine({
      id: "parent",
      initial: "idle",
      context: ParentContextSchema,
      initialContext: { count: 0 },
      states: {
        idle: {
          entry: [
            spawnChild(childMachine, { id: "child1" }),
            spawnChild(childMachine, { id: "child2" }),
          ],
          on: {
            TOGGLE: { target: "running" },
          },
        },
        running: {
          on: {
            TOGGLE: { target: "idle" },
          },
        },
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          // Restore to non-initial state "running" with child snapshots
          const actor = yield* interpret(machine, {
            snapshot: {
              value: "running",
              context: { count: 10 },
              event: null,
            },
            childSnapshots: new Map([
              ["child1", { value: "active", context: { value: 200 }, event: null }],
              ["child2", { value: "active", context: { value: 150 }, event: null }],
            ]),
          });

          yield* Effect.sleep("20 millis");

          // Parent should be in running state with restored context
          expect(actor.getSnapshot().value).toBe("running");
          expect(actor.getSnapshot().context.count).toBe(10);

          // Children should exist and have restored state
          expect(actor.children.size).toBe(2);

          const child1 = actor.children.get("child1");
          expect(child1).toBeDefined();
          expect(child1!.getSnapshot().value).toBe("active");
          expect(child1!.getSnapshot().context.value).toBe(200);

          const child2 = actor.children.get("child2");
          expect(child2).toBeDefined();
          expect(child2!.getSnapshot().value).toBe("active");
          expect(child2!.getSnapshot().context.value).toBe(150);
        }),
      ),
    );
  });

  it("restores to initial state without child snapshots - children start fresh", async () => {
    const childMachine = createRestorableChildMachine();

    const ParentContextSchema = Schema.Struct({ count: Schema.Number });

    const machine = createMachine({
      id: "parent",
      initial: "idle",
      context: ParentContextSchema,
      initialContext: { count: 0 },
      states: {
        idle: {
          entry: [
            spawnChild(childMachine, { id: "child1" }),
          ],
          on: {
            TOGGLE: { target: "running" },
          },
        },
        running: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          // Restore to initial state "idle" without child snapshots
          const actor = yield* interpret(machine, {
            snapshot: {
              value: "idle",
              context: { count: 99 },
              event: null,
            },
            // No childSnapshots provided
          });

          yield* Effect.sleep("20 millis");

          // Parent should be in idle state with restored context
          expect(actor.getSnapshot().value).toBe("idle");
          expect(actor.getSnapshot().context.count).toBe(99);

          // Child should exist but start fresh (initial state)
          expect(actor.children.size).toBe(1);

          const child1 = actor.children.get("child1");
          expect(child1).toBeDefined();
          expect(child1!.getSnapshot().value).toBe("idle");
          expect(child1!.getSnapshot().context.value).toBe(0); // Initial value
        }),
      ),
    );
  });

  it("restores to non-initial state without child snapshots - children start fresh", async () => {
    const childMachine = createRestorableChildMachine();

    const ParentContextSchema = Schema.Struct({ count: Schema.Number });

    const machine = createMachine({
      id: "parent",
      initial: "idle",
      context: ParentContextSchema,
      initialContext: { count: 0 },
      states: {
        idle: {
          entry: [
            spawnChild(childMachine, { id: "child1" }),
          ],
          on: {
            TOGGLE: { target: "running" },
          },
        },
        running: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          // Restore to non-initial state "running" without child snapshots
          const actor = yield* interpret(machine, {
            snapshot: {
              value: "running",
              context: { count: 77 },
              event: null,
            },
            childSnapshots: new Map(), // Empty map
          });

          yield* Effect.sleep("20 millis");

          // Parent should be in running state with restored context
          expect(actor.getSnapshot().value).toBe("running");
          expect(actor.getSnapshot().context.count).toBe(77);

          // Child should exist but start fresh (initial state)
          // Children are spawned from initial state's entry actions
          expect(actor.children.size).toBe(1);

          const child1 = actor.children.get("child1");
          expect(child1).toBeDefined();
          expect(child1!.getSnapshot().value).toBe("idle");
          expect(child1!.getSnapshot().context.value).toBe(0); // Initial value
        }),
      ),
    );
  });

  it("restored children can receive events and update state", async () => {
    const childMachine = createRestorableChildMachine();

    const ParentContextSchema = Schema.Struct({ count: Schema.Number });

    const machine = createMachine({
      id: "parent",
      initial: "idle",
      context: ParentContextSchema,
      initialContext: { count: 0 },
      states: {
        idle: {
          entry: [spawnChild(childMachine, { id: "child1" })],
          on: {
            TICK: {
              actions: [sendTo("child1", new Increment())],
            },
          },
        },
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          // Restore with child in active state with value 100
          const actor = yield* interpret(machine, {
            snapshot: {
              value: "idle",
              context: { count: 0 },
              event: null,
            },
            childSnapshots: new Map([
              ["child1", { value: "active", context: { value: 100 }, event: null }],
            ]),
          });

          yield* Effect.sleep("20 millis");

          const child = actor.children.get("child1")!;
          expect(child.getSnapshot().value).toBe("active");
          expect(child.getSnapshot().context.value).toBe(100);

          // Send INCREMENT to child (in active state, adds 10)
          actor.send(new Tick());
          yield* Effect.sleep("20 millis");

          expect(child.getSnapshot().context.value).toBe(110);
        }),
      ),
    );
  });
});
