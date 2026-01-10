import { describe, it, expect } from "vitest";
import { Data, Effect, Ref, Schema } from "effect";
import { createMachine } from "../src/machine.js";
import { testActorSync } from "./test-utils.js";
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
          const actor = testActorSync(machine);

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
          const actor = testActorSync(machine);

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
          const actor = testActorSync(machine);

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
          const actor = testActorSync(machine);

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
          const actor = testActorSync(machine);

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
          const actor = testActorSync(machine);
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
          const actor = testActorSync(machine);

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

  it("auto-cancels delays on state exit without explicit cancel action", async () => {
    // This test verifies that delays are automatically cancelled when leaving
    // a state, even without an explicit id or cancel() action.
    // This prevents the "spam button" bug where delayed transitions would fire
    // even after leaving the originating state.
    const machine = createMachine({
      id: "test",
      initial: "stopping",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        stopping: {
          // No id on this transition - should still be auto-cancelled on exit
          after: {
            100: { target: "idle" },
          },
          on: {
            TOGGLE: { target: "running" },
          },
        },
        running: {
          on: {
            TOGGLE: { target: "stopping" },
          },
        },
        idle: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = testActorSync(machine);

          // Start in stopping, delay scheduled for 100ms
          expect(actor.getSnapshot().value).toBe("stopping");

          // Spam: immediately transition to running before delay fires
          yield* Effect.sleep("30 millis");
          actor.send(new Toggle()); // stopping -> running
          yield* Effect.sleep("10 millis");

          expect(actor.getSnapshot().value).toBe("running");

          // Wait past when the original delay would have fired
          yield* Effect.sleep("100 millis");

          // Should still be in running - the delay from stopping was auto-cancelled
          expect(actor.getSnapshot().value).toBe("running");
        }),
      ),
    );
  });
});

// ============================================================================
// persistent - Delays that survive state exits
// ============================================================================

describe("persistent delays", () => {
  it("persistent delay survives state exits and fires", async () => {
    const machine = createMachine({
      id: "test",
      initial: "a",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        a: {
          after: {
            delay: "100 millis",
            transition: { target: "timeout" },
            persistent: true, // This delay survives state exits
          },
          on: {
            TOGGLE: { target: "b" },
          },
        },
        b: {
          on: {
            TOGGLE: { target: "a" },
          },
        },
        timeout: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = testActorSync(machine);

          expect(actor.getSnapshot().value).toBe("a");

          // Quickly leave state a before delay fires
          yield* Effect.sleep("30 millis");
          actor.send(new Toggle()); // a -> b
          yield* Effect.sleep("10 millis");

          expect(actor.getSnapshot().value).toBe("b");

          // Wait for the persistent delay to fire
          yield* Effect.sleep("100 millis");

          // Persistent delay should have fired even though we left state a
          expect(actor.getSnapshot().value).toBe("timeout");
        }),
      ),
    );
  });

  it("persistent delay can still be explicitly cancelled", async () => {
    const machine = createMachine({
      id: "test",
      initial: "a",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        a: {
          after: {
            delay: "100 millis",
            transition: { target: "timeout", id: "myDelay" },
            persistent: true,
          },
          on: {
            TOGGLE: {
              target: "b",
              actions: [cancel("myDelay")], // Explicitly cancel the persistent delay
            },
          },
        },
        b: {},
        timeout: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = testActorSync(machine);

          yield* Effect.sleep("30 millis");
          actor.send(new Toggle()); // a -> b, cancels the delay
          yield* Effect.sleep("10 millis");

          expect(actor.getSnapshot().value).toBe("b");

          // Wait past when delay would have fired
          yield* Effect.sleep("100 millis");

          // Should still be in b - delay was explicitly cancelled
          expect(actor.getSnapshot().value).toBe("b");
        }),
      ),
    );
  });

  it("persistent delay is cleaned up on actor stop", async () => {
    let timeoutFired = false;

    const machine = createMachine({
      id: "test",
      initial: "a",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        a: {
          after: {
            delay: "100 millis",
            transition: { target: "timeout" },
            persistent: true,
          },
        },
        timeout: {
          entry: [effect(() => Effect.sync(() => { timeoutFired = true; }))],
        },
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = testActorSync(machine);

          yield* Effect.sleep("30 millis");
          actor.stop(); // Stop the actor

          // Wait past when delay would have fired
          yield* Effect.sleep("100 millis");

          // Delay should not fire after actor is stopped
          expect(timeoutFired).toBe(false);
        }),
      ),
    );
  });
});

// ============================================================================
// Effect-based delays - Full control with Effect
// ============================================================================

describe("Effect-based delays", () => {
  it("supports Effect as delay", async () => {
    const machine = createMachine({
      id: "test",
      initial: "waiting",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        waiting: {
          after: {
            delay: Effect.sleep("50 millis"),
            transition: { target: "done" },
          },
        },
        done: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = testActorSync(machine);

          expect(actor.getSnapshot().value).toBe("waiting");

          yield* Effect.sleep("70 millis");

          expect(actor.getSnapshot().value).toBe("done");
        }),
      ),
    );
  });

  it("Effect-based delay is auto-cancelled on state exit", async () => {
    const machine = createMachine({
      id: "test",
      initial: "a",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        a: {
          after: {
            delay: Effect.sleep("100 millis"),
            transition: { target: "timeout" },
          },
          on: {
            TOGGLE: { target: "b" },
          },
        },
        b: {},
        timeout: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = testActorSync(machine);

          yield* Effect.sleep("30 millis");
          actor.send(new Toggle()); // a -> b

          expect(actor.getSnapshot().value).toBe("b");

          // Wait past when Effect delay would have completed
          yield* Effect.sleep("100 millis");

          // Should still be in b - Effect was interrupted
          expect(actor.getSnapshot().value).toBe("b");
        }),
      ),
    );
  });

  it("Effect-based delay can use onInterrupt for cleanup", async () => {
    const interruptLog = await Effect.runPromise(Ref.make<string[]>([]));

    const machine = createMachine({
      id: "test",
      initial: "a",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        a: {
          after: {
            delay: Effect.sleep("100 millis").pipe(
              Effect.onInterrupt(() => Ref.update(interruptLog, (log) => [...log, "interrupted"]))
            ),
            transition: { target: "timeout" },
          },
          on: {
            TOGGLE: { target: "b" },
          },
        },
        b: {},
        timeout: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = testActorSync(machine);

          yield* Effect.sleep("30 millis");
          actor.send(new Toggle()); // a -> b, interrupts the delay Effect

          yield* Effect.sleep("20 millis"); // Give time for interrupt handler

          const log = yield* Ref.get(interruptLog);
          expect(log).toEqual(["interrupted"]);
        }),
      ),
    );
  });

  it("Effect-based delay with complex logic", async () => {
    const stepLog = await Effect.runPromise(Ref.make<string[]>([]));

    const machine = createMachine({
      id: "test",
      initial: "waiting",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        waiting: {
          after: {
            delay: Effect.gen(function* () {
              yield* Ref.update(stepLog, (log) => [...log, "step1"]);
              yield* Effect.sleep("25 millis");
              yield* Ref.update(stepLog, (log) => [...log, "step2"]);
              yield* Effect.sleep("25 millis");
              yield* Ref.update(stepLog, (log) => [...log, "step3"]);
            }),
            transition: { target: "done" },
          },
        },
        done: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = testActorSync(machine);

          yield* Effect.sleep("70 millis");

          expect(actor.getSnapshot().value).toBe("done");

          const log = yield* Ref.get(stepLog);
          expect(log).toEqual(["step1", "step2", "step3"]);
        }),
      ),
    );
  });

  it("persistent Effect-based delay survives state exits", async () => {
    const machine = createMachine({
      id: "test",
      initial: "a",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        a: {
          after: {
            delay: Effect.sleep("100 millis"),
            transition: { target: "timeout" },
            persistent: true, // Survives state exits
          },
          on: {
            TOGGLE: { target: "b" },
          },
        },
        b: {},
        timeout: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = testActorSync(machine);

          yield* Effect.sleep("30 millis");
          actor.send(new Toggle()); // a -> b

          expect(actor.getSnapshot().value).toBe("b");

          // Wait for persistent Effect to complete
          yield* Effect.sleep("100 millis");

          // Persistent Effect should have fired
          expect(actor.getSnapshot().value).toBe("timeout");
        }),
      ),
    );
  });
});
