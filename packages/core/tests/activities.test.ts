import { describe, it, expect } from "vitest";
import { Data, Effect, Ref, Schema } from "effect";
import { createMachine, interpretSync } from "../src/machine.js";
import { assign } from "../src/actions.js";
import { guard, and, or, not } from "../src/guards.js";

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

// ============================================================================
// activities - Long-running Effects
// ============================================================================

describe("activities", () => {
  it("starts activity when entering state", async () => {
    const activityStarted = await Effect.runPromise(Ref.make(false));

    const machine = createMachine({
      id: "test",
      initial: "idle",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        idle: {
          on: { TOGGLE: { target: "running" } },
        },
        running: {
          activities: [
            {
              id: "ticker",
              src: () =>
                Effect.gen(function* () {
                  yield* Ref.set(activityStarted, true);
                  // Long-running effect
                  yield* Effect.never;
                }),
            },
          ],
          on: { TOGGLE: { target: "idle" } },
        },
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);

          // Activity should not be started yet
          let started = yield* Ref.get(activityStarted);
          expect(started).toBe(false);

          // Transition to running state
          actor.send(new Toggle());
          yield* Effect.sleep("20 millis");

          // Activity should be started
          started = yield* Ref.get(activityStarted);
          expect(started).toBe(true);
        }),
      ),
    );
  });

  it("stops activity when exiting state", async () => {
    const tickCount = await Effect.runPromise(Ref.make(0));

    const machine = createMachine({
      id: "test",
      initial: "idle",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        idle: {
          on: { TOGGLE: { target: "running" } },
        },
        running: {
          activities: [
            {
              id: "ticker",
              src: () =>
                Effect.gen(function* () {
                  // Tick every 5ms
                  while (true) {
                    yield* Ref.update(tickCount, (n) => n + 1);
                    yield* Effect.sleep("5 millis");
                  }
                }),
            },
          ],
          on: { TOGGLE: { target: "idle" } },
        },
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);

          // Start running
          actor.send(new Toggle());
          yield* Effect.sleep("25 millis");

          const ticksWhileRunning = yield* Ref.get(tickCount);
          expect(ticksWhileRunning).toBeGreaterThan(0);

          // Stop running
          actor.send(new Toggle());
          yield* Effect.sleep("10 millis");

          const ticksAfterStop = yield* Ref.get(tickCount);

          // Wait more - ticks should NOT increase
          yield* Effect.sleep("30 millis");
          const ticksLater = yield* Ref.get(tickCount);

          expect(ticksLater).toBe(ticksAfterStop);
        }),
      ),
    );
  });

  it("activity can send events to machine", async () => {
    const machine = createMachine({
      id: "test",
      initial: "idle",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        idle: {
          on: { TOGGLE: { target: "counting" } },
        },
        counting: {
          activities: [
            {
              id: "auto-ticker",
              src: ({ send }) =>
                Effect.gen(function* () {
                  // Send 3 ticks
                  for (let i = 0; i < 3; i++) {
                    yield* Effect.sleep("5 millis");
                    send(new Tick());
                  }
                }),
            },
          ],
          on: {
            TICK: {
              actions: [assign(({ context }) => ({ count: context.count + 1 }))],
            },
            TOGGLE: { target: "idle" },
          },
        },
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);

          actor.send(new Toggle());
          yield* Effect.sleep("50 millis");

          const snapshot = actor.getSnapshot();
          expect(snapshot.context.count).toBe(3);
        }),
      ),
    );
  });
});

// ============================================================================
// guards - Transition Conditions
// ============================================================================

describe("guards", () => {
  it("allows transition when sync guard returns true", async () => {
    const machine = createMachine({
      id: "test",
      initial: "a",
      context: TestContextSchema,
      initialContext: { count: 10, log: [] },
      states: {
        a: {
          on: {
            TOGGLE: {
              target: "b",
              guard: guard(({ context }) => context.count > 5),
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
          expect(snapshot.value).toBe("b");
        }),
      ),
    );
  });

  it("blocks transition when sync guard returns false", async () => {
    const machine = createMachine({
      id: "test",
      initial: "a",
      context: TestContextSchema,
      initialContext: { count: 3, log: [] },
      states: {
        a: {
          on: {
            TOGGLE: {
              target: "b",
              guard: guard(({ context }) => context.count > 5),
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
          expect(snapshot.value).toBe("a"); // Should NOT transition
        }),
      ),
    );
  });

  it("guard can access event data", async () => {
    const machine = createMachine({
      id: "test",
      initial: "a",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        a: {
          on: {
            SET_VALUE: {
              target: "b",
              guard: guard(({ event }) => event.value > 50),
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

          // Value too low - should not transition
          actor.send(new SetValue({ value: 30 }));
          yield* Effect.sleep("10 millis");
          let snapshot = actor.getSnapshot();
          expect(snapshot.value).toBe("a");

          // Value high enough - should transition
          actor.send(new SetValue({ value: 100 }));
          yield* Effect.sleep("10 millis");
          snapshot = actor.getSnapshot();
          expect(snapshot.value).toBe("b");
        }),
      ),
    );
  });
});

// ============================================================================
// Guard Combinators (and, or, not)
// ============================================================================

describe("guard combinators", () => {
  it("and() requires all guards to pass", async () => {
    const machine = createMachine({
      id: "test",
      initial: "a",
      context: TestContextSchema,
      initialContext: { count: 10, log: [] },
      states: {
        a: {
          on: {
            TOGGLE: {
              target: "b",
              guard: and(
                guard(({ context }) => context.count > 5),
                guard(({ context }) => context.count < 20),
              ),
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
          expect(snapshot.value).toBe("b"); // Both conditions met
        }),
      ),
    );
  });

  it("and() blocks if any guard fails", async () => {
    const machine = createMachine({
      id: "test",
      initial: "a",
      context: TestContextSchema,
      initialContext: { count: 25, log: [] }, // Fails second condition
      states: {
        a: {
          on: {
            TOGGLE: {
              target: "b",
              guard: and(
                guard(({ context }) => context.count > 5),
                guard(({ context }) => context.count < 20),
              ),
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
          expect(snapshot.value).toBe("a"); // Should NOT transition
        }),
      ),
    );
  });

  it("or() passes if any guard passes", async () => {
    const machine = createMachine({
      id: "test",
      initial: "a",
      context: TestContextSchema,
      initialContext: { count: 3, log: [] }, // Only second condition passes
      states: {
        a: {
          on: {
            TOGGLE: {
              target: "b",
              guard: or(
                guard(({ context }) => context.count > 10),
                guard(({ context }) => context.count < 5),
              ),
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
          expect(snapshot.value).toBe("b"); // One condition met
        }),
      ),
    );
  });

  it("or() blocks if all guards fail", async () => {
    const machine = createMachine({
      id: "test",
      initial: "a",
      context: TestContextSchema,
      initialContext: { count: 7, log: [] }, // Neither condition passes
      states: {
        a: {
          on: {
            TOGGLE: {
              target: "b",
              guard: or(
                guard(({ context }) => context.count > 10),
                guard(({ context }) => context.count < 5),
              ),
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
          expect(snapshot.value).toBe("a"); // Should NOT transition
        }),
      ),
    );
  });

  it("not() inverts a guard", async () => {
    const machine = createMachine({
      id: "test",
      initial: "a",
      context: TestContextSchema,
      initialContext: { count: 3, log: [] },
      states: {
        a: {
          on: {
            TOGGLE: {
              target: "b",
              guard: not(guard(({ context }) => context.count > 5)), // NOT (3 > 5) = true
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
          expect(snapshot.value).toBe("b"); // NOT false = true
        }),
      ),
    );
  });

  it("not() blocks when inner guard passes", async () => {
    const machine = createMachine({
      id: "test",
      initial: "a",
      context: TestContextSchema,
      initialContext: { count: 10, log: [] },
      states: {
        a: {
          on: {
            TOGGLE: {
              target: "b",
              guard: not(guard(({ context }) => context.count > 5)), // NOT (10 > 5) = false
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
          expect(snapshot.value).toBe("a"); // NOT true = false
        }),
      ),
    );
  });
});
