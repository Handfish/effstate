import { describe, it, expect } from "vitest";
import { Data, Effect, Ref, Schema } from "effect";
import { createMachine } from "../src/machine.js";
import { testActorSync } from "./test-utils.js";
import { assign, effect, raise } from "../src/actions.js";

// ============================================================================
// Test Event Types
// ============================================================================

class Toggle extends Data.TaggedClass("TOGGLE")<{}> {}
class SetValue extends Data.TaggedClass("SET_VALUE")<{ readonly value: number }> {}
class Tick extends Data.TaggedClass("TICK")<{}> {}

// ============================================================================
// Test Context Schemas (Schema-based context required)
// ============================================================================

const TestContextSchema = Schema.Struct({
  count: Schema.Number,
  log: Schema.Array(Schema.String),
});
type TestContext = typeof TestContextSchema.Type;

// ============================================================================
// raise() - Self-sent Events
// ============================================================================

describe("raise()", () => {
  it("sends an event to self with static event", async () => {
    const machine = createMachine({
      id: "test",
      initial: "a",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        a: {
          on: {
            TOGGLE: {
              target: "b",
              actions: [raise(new Tick())], // Raise TICK after transitioning to b
            },
          },
        },
        b: {
          on: {
            TICK: {
              target: "c",
              actions: [assign({ count: 99 })],
            },
          },
        },
        c: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = testActorSync(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("20 millis");

          const snapshot = actor.getSnapshot();
          expect(snapshot.value).toBe("c"); // Should have auto-transitioned via raised TICK
          expect(snapshot.context.count).toBe(99);
        }),
      ),
    );
  });

  it("sends an event to self with dynamic event", async () => {
    const machine = createMachine({
      id: "test",
      initial: "a",
      context: TestContextSchema,
      initialContext: { count: 5, log: [] },
      states: {
        a: {
          on: {
            TOGGLE: {
              target: "b",
              actions: [
                raise(({ context }) => new SetValue({ value: (context as TestContext).count * 10 })),
              ],
            },
          },
        },
        b: {
          on: {
            SET_VALUE: {
              target: "c",
              actions: [assign(({ event }) => ({ count: event.value }))],
            },
          },
        },
        c: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = testActorSync(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("20 millis");

          const snapshot = actor.getSnapshot();
          expect(snapshot.value).toBe("c");
          expect(snapshot.context.count).toBe(50); // 5 * 10
        }),
      ),
    );
  });
});

// ============================================================================
// entry/exit - Lifecycle Actions
// ============================================================================

describe("entry/exit actions", () => {
  it("runs entry actions when entering a state", async () => {
    const entryLog = await Effect.runPromise(Ref.make<string[]>([]));

    const machine = createMachine({
      id: "test",
      initial: "a",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        a: {
          on: { TOGGLE: { target: "b" } },
        },
        b: {
          entry: [
            effect(() =>
              Ref.update(entryLog, (log) => [...log, "entered-b"]),
            ),
          ],
        },
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = testActorSync(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("10 millis");

          const log = yield* Ref.get(entryLog);
          expect(log).toContain("entered-b");
        }),
      ),
    );
  });

  it("runs exit actions when leaving a state", async () => {
    const exitLog = await Effect.runPromise(Ref.make<string[]>([]));

    const machine = createMachine({
      id: "test",
      initial: "a",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        a: {
          exit: [
            effect(() =>
              Ref.update(exitLog, (log) => [...log, "exited-a"]),
            ),
          ],
          on: { TOGGLE: { target: "b" } },
        },
        b: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = testActorSync(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("10 millis");

          const log = yield* Ref.get(exitLog);
          expect(log).toContain("exited-a");
        }),
      ),
    );
  });

  it("runs exit before entry on transition", async () => {
    const actionLog = await Effect.runPromise(Ref.make<string[]>([]));

    const machine = createMachine({
      id: "test",
      initial: "a",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        a: {
          exit: [effect(() => Ref.update(actionLog, (log) => [...log, "exit-a"]))],
          on: { TOGGLE: { target: "b" } },
        },
        b: {
          entry: [effect(() => Ref.update(actionLog, (log) => [...log, "entry-b"]))],
        },
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = testActorSync(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("10 millis");

          const log = yield* Ref.get(actionLog);
          expect(log).toEqual(["exit-a", "entry-b"]);
        }),
      ),
    );
  });

  it("runs entry actions for initial state", async () => {
    const entryLog = await Effect.runPromise(Ref.make<string[]>([]));

    const machine = createMachine({
      id: "test",
      initial: "a",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        a: {
          entry: [effect(() => Ref.update(entryLog, (log) => [...log, "entered-a"]))],
          on: { TOGGLE: { target: "b" } },
        },
        b: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          testActorSync(machine);
          yield* Effect.sleep("10 millis");

          const log = yield* Ref.get(entryLog);
          expect(log).toContain("entered-a");
        }),
      ),
    );
  });
});

// ============================================================================
// Self-transitions
// ============================================================================

describe("self-transitions", () => {
  it("runs transition actions but not entry/exit on self-transition", async () => {
    const actionLog = await Effect.runPromise(Ref.make<string[]>([]));

    const machine = createMachine({
      id: "test",
      initial: "a",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        a: {
          entry: [effect(() => Ref.update(actionLog, (log) => [...log, "entry-a"]))],
          exit: [effect(() => Ref.update(actionLog, (log) => [...log, "exit-a"]))],
          on: {
            TICK: {
              // No target = self-transition (stay in same state)
              actions: [
                effect(() => Ref.update(actionLog, (log) => [...log, "tick-action"])),
                assign(({ context }) => ({ count: context.count + 1 })),
              ],
            },
            TOGGLE: { target: "b" },
          },
        },
        b: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = testActorSync(machine);
          yield* Effect.sleep("10 millis");

          // Clear the log after initial entry
          yield* Ref.set(actionLog, []);

          // Send TICK - should stay in state "a" with no entry/exit
          actor.send(new Tick());
          yield* Effect.sleep("10 millis");

          const log = yield* Ref.get(actionLog);
          expect(log).toEqual(["tick-action"]); // Only transition action, no entry/exit

          const snapshot = actor.getSnapshot();
          expect(snapshot.value).toBe("a");
          expect(snapshot.context.count).toBe(1);
        }),
      ),
    );
  });

  it("explicit self-target also skips entry/exit", async () => {
    const actionLog = await Effect.runPromise(Ref.make<string[]>([]));

    const machine = createMachine({
      id: "test",
      initial: "counting",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        counting: {
          entry: [effect(() => Ref.update(actionLog, (log) => [...log, "entry"]))],
          exit: [effect(() => Ref.update(actionLog, (log) => [...log, "exit"]))],
          on: {
            TICK: {
              target: "counting", // Explicit self-target
              actions: [assign(({ context }) => ({ count: context.count + 1 }))],
            },
          },
        },
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = testActorSync(machine);
          yield* Effect.sleep("10 millis");

          yield* Ref.set(actionLog, []); // Clear after initial entry

          actor.send(new Tick());
          yield* Effect.sleep("10 millis");

          const log = yield* Ref.get(actionLog);
          expect(log).toEqual([]); // No entry/exit for self-transition

          const snapshot = actor.getSnapshot();
          expect(snapshot.context.count).toBe(1);
        }),
      ),
    );
  });
});
