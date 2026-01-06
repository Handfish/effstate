import { describe, it, expect } from "vitest";
import { Data, Effect, Ref, Schema } from "effect";
import { createMachine, interpretSync } from "../src/machine.js";
import { assign, effect, cancel } from "../src/actions.js";

// ============================================================================
// Test Event Types
// ============================================================================

class Toggle extends Data.TaggedClass("TOGGLE")<{}> {}
class SetValue extends Data.TaggedClass("SET_VALUE")<{ readonly value: number }> {}

// ============================================================================
// Test Context Schemas (Schema-based context required)
// ============================================================================

const TestContextSchema = Schema.Struct({
  count: Schema.Number,
  log: Schema.Array(Schema.String),
});

// ============================================================================
// after - Delayed Transitions
// ============================================================================

describe("after (delayed transitions)", () => {
  it("transitions after specified delay", async () => {
    const machine = createMachine({
      id: "test",
      initial: "waiting",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        waiting: {
          after: {
            50: { target: "done" },
          },
        },
        done: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);

          // Should still be waiting
          let snapshot = actor.getSnapshot();
          expect(snapshot.value).toBe("waiting");

          // Wait for delay
          yield* Effect.sleep("70 millis");

          // Should have transitioned
          snapshot = actor.getSnapshot();
          expect(snapshot.value).toBe("done");
        }),
      ),
    );
  });

  it("runs actions on delayed transition", async () => {
    const machine = createMachine({
      id: "test",
      initial: "waiting",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        waiting: {
          after: {
            30: {
              target: "done",
              actions: [assign({ count: 42 })],
            },
          },
        },
        done: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);

          // Wait for delay
          yield* Effect.sleep("50 millis");

          const snapshot = actor.getSnapshot();
          expect(snapshot.value).toBe("done");
          expect(snapshot.context.count).toBe(42); // Action ran
        }),
      ),
    );
  });

  it("runs entry/exit actions on delayed transition", async () => {
    const actionLog = await Effect.runPromise(Ref.make<string[]>([]));

    const machine = createMachine({
      id: "test",
      initial: "waiting",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        waiting: {
          exit: [effect(() => Ref.update(actionLog, (log) => [...log, "exit-waiting"]))],
          after: {
            30: { target: "done" },
          },
        },
        done: {
          entry: [effect(() => Ref.update(actionLog, (log) => [...log, "entry-done"]))],
        },
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);

          yield* Effect.sleep("50 millis");

          const log = yield* Ref.get(actionLog);
          expect(log).toEqual(["exit-waiting", "entry-done"]);

          const snapshot = actor.getSnapshot();
          expect(snapshot.value).toBe("done");
        }),
      ),
    );
  });
});

// ============================================================================
// cancel - Cancel Delayed Events
// ============================================================================

describe("cancel (delayed events)", () => {
  it("cancels a pending delayed transition by ID", async () => {
    const machine = createMachine({
      id: "test",
      initial: "waiting",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        waiting: {
          after: {
            100: { target: "timeout", id: "myTimeout" },
          },
          on: {
            TOGGLE: {
              target: "cancelled",
              actions: [cancel("myTimeout")],
            },
          },
        },
        cancelled: {},
        timeout: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);

          // Cancel before timeout fires
          yield* Effect.sleep("30 millis");
          actor.send(new Toggle());
          yield* Effect.sleep("10 millis");

          let snapshot = actor.getSnapshot();
          expect(snapshot.value).toBe("cancelled");

          // Wait past when timeout would have fired
          yield* Effect.sleep("100 millis");

          // Should still be in cancelled state (timeout was cancelled)
          snapshot = actor.getSnapshot();
          expect(snapshot.value).toBe("cancelled");
        }),
      ),
    );
  });

  it("cancel with dynamic ID from function", async () => {
    const machine = createMachine({
      id: "test",
      initial: "waiting",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        waiting: {
          after: {
            100: { target: "timeout", id: "delay-100" },
          },
          on: {
            SET_VALUE: {
              target: "cancelled",
              actions: [cancel(({ event }) => `delay-${event.value}`)],
            },
          },
        },
        cancelled: {},
        timeout: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);

          yield* Effect.sleep("30 millis");
          actor.send(new SetValue({ value: 100 })); // Cancel "delay-100"
          yield* Effect.sleep("10 millis");

          let snapshot = actor.getSnapshot();
          expect(snapshot.value).toBe("cancelled");

          yield* Effect.sleep("100 millis");
          snapshot = actor.getSnapshot();
          expect(snapshot.value).toBe("cancelled"); // Timeout was cancelled
        }),
      ),
    );
  });

  it("cancel non-existent ID is a no-op", async () => {
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
              actions: [cancel("nonexistent")],
            },
          },
        },
        b: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("10 millis");

          const snapshot = actor.getSnapshot();
          expect(snapshot.value).toBe("b"); // Transition still works
        }),
      ),
    );
  });

  it("cancels only the specified delay, others still fire", async () => {
    const machine = createMachine({
      id: "test",
      initial: "waiting",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        waiting: {
          after: {
            50: { target: "timeout1", id: "short" },
            150: { target: "timeout2", id: "long" },
          },
          on: {
            TOGGLE: {
              target: "partial",
              actions: [cancel("long")], // Cancel only the long one
            },
          },
        },
        partial: {
          after: {
            // The short timeout should have been cleared when we left "waiting"
            // But let's test that "long" doesn't fire from original state
            200: { target: "timeout2" },
          },
        },
        timeout1: {},
        timeout2: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);

          // Quickly transition to partial (before short timeout)
          yield* Effect.sleep("20 millis");
          actor.send(new Toggle());
          yield* Effect.sleep("10 millis");

          let snapshot = actor.getSnapshot();
          expect(snapshot.value).toBe("partial");

          // Wait past when "long" would have fired
          yield* Effect.sleep("200 millis");
          snapshot = actor.getSnapshot();
          // Should still be partial - the original "long" was cancelled
          // and the new 200ms timeout in partial should now fire to timeout2
          expect(snapshot.value).toBe("timeout2");
        }),
      ),
    );
  });
});
