import { describe, it, expect } from "vitest";
import { Data, Effect, Exit, Ref } from "effect";
import { createMachine, interpret } from "./machine";
import { assign, effect, raise } from "./actions";
import { guard, guardEffect, and, or, not } from "./guards";

// ============================================================================
// Test Event Types
// ============================================================================

class Toggle extends Data.TaggedClass("TOGGLE")<{}> {}
class SetValue extends Data.TaggedClass("SET_VALUE")<{ readonly value: number }> {}
class Tick extends Data.TaggedClass("TICK")<{}> {}

type TestEvent = Toggle | SetValue | Tick;

interface TestContext {
  readonly count: number;
  readonly log: ReadonlyArray<string>;
}

// ============================================================================
// createMachine
// ============================================================================

describe("createMachine", () => {
  it("creates a machine definition with correct initial snapshot", () => {
    const machine = createMachine<"test", "inactive" | "active", TestContext, TestEvent>({
      id: "test",
      initial: "inactive",
      context: { count: 0, log: [] },
      states: {
        inactive: { on: { TOGGLE: { target: "active" } } },
        active: { on: { TOGGLE: { target: "inactive" } } },
      },
    });

    expect(machine._tag).toBe("MachineDefinition");
    expect(machine.id).toBe("test");
    expect(machine.initialSnapshot.value).toBe("inactive");
    expect(machine.initialSnapshot.context.count).toBe(0);
  });
});

// ============================================================================
// assign() - Context Updates
// ============================================================================

describe("assign()", () => {
  it("updates context with static values", async () => {
    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 0, log: [] },
      states: {
        a: {
          on: {
            TOGGLE: {
              target: "b",
              actions: [assign({ count: 42 })],
            },
          },
        },
        b: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = yield* interpret(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("10 millis");

          const snapshot = yield* actor.getSnapshot;
          expect(snapshot.context.count).toBe(42);
        }),
      ),
    );
  });

  it("updates context with function using previous context", async () => {
    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 5, log: [] },
      states: {
        a: {
          on: {
            TOGGLE: {
              target: "b",
              actions: [assign(({ context }) => ({ count: context.count * 2 }))],
            },
          },
        },
        b: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = yield* interpret(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("10 millis");

          const snapshot = yield* actor.getSnapshot;
          expect(snapshot.context.count).toBe(10);
        }),
      ),
    );
  });

  it("accesses event data with proper narrowing", async () => {
    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 0, log: [] },
      states: {
        a: {
          on: {
            SET_VALUE: {
              target: "b",
              actions: [assign(({ event }) => ({ count: event.value }))],
            },
          },
        },
        b: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = yield* interpret(machine);
          actor.send(new SetValue({ value: 123 }));
          yield* Effect.sleep("10 millis");

          const snapshot = yield* actor.getSnapshot;
          expect(snapshot.context.count).toBe(123);
        }),
      ),
    );
  });
});

// ============================================================================
// raise() - Self-sent Events
// ============================================================================

describe("raise()", () => {
  it("sends an event to self with static event", async () => {
    const machine = createMachine<"test", "a" | "b" | "c", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 0, log: [] },
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
          const actor = yield* interpret(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("20 millis");

          const snapshot = yield* actor.getSnapshot;
          expect(snapshot.value).toBe("c"); // Should have auto-transitioned via raised TICK
          expect(snapshot.context.count).toBe(99);
        }),
      ),
    );
  });

  it("sends an event to self with dynamic event", async () => {
    const machine = createMachine<"test", "a" | "b" | "c", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 5, log: [] },
      states: {
        a: {
          on: {
            TOGGLE: {
              target: "b",
              actions: [
                raise(({ context }) => new SetValue({ value: context.count * 10 })),
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
          const actor = yield* interpret(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("20 millis");

          const snapshot = yield* actor.getSnapshot;
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

    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 0, log: [] },
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
          const actor = yield* interpret(machine);
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

    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 0, log: [] },
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
          const actor = yield* interpret(machine);
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

    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 0, log: [] },
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
          const actor = yield* interpret(machine);
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

    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 0, log: [] },
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
          yield* interpret(machine);
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

    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 0, log: [] },
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
          const actor = yield* interpret(machine);
          yield* Effect.sleep("10 millis");

          // Clear the log after initial entry
          yield* Ref.set(actionLog, []);

          // Send TICK - should stay in state "a" with no entry/exit
          actor.send(new Tick());
          yield* Effect.sleep("10 millis");

          const log = yield* Ref.get(actionLog);
          expect(log).toEqual(["tick-action"]); // Only transition action, no entry/exit

          const snapshot = yield* actor.getSnapshot;
          expect(snapshot.value).toBe("a");
          expect(snapshot.context.count).toBe(1);
        }),
      ),
    );
  });

  it("explicit self-target also skips entry/exit", async () => {
    const actionLog = await Effect.runPromise(Ref.make<string[]>([]));

    const machine = createMachine<"test", "counting", TestContext, TestEvent>({
      id: "test",
      initial: "counting",
      context: { count: 0, log: [] },
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
          const actor = yield* interpret(machine);
          yield* Effect.sleep("10 millis");

          yield* Ref.set(actionLog, []); // Clear after initial entry

          actor.send(new Tick());
          yield* Effect.sleep("10 millis");

          const log = yield* Ref.get(actionLog);
          expect(log).toEqual([]); // No entry/exit for self-transition

          const snapshot = yield* actor.getSnapshot;
          expect(snapshot.context.count).toBe(1);
        }),
      ),
    );
  });
});

// ============================================================================
// activities - Long-running Effects
// ============================================================================

describe("activities", () => {
  it("starts activity when entering state", async () => {
    const activityStarted = await Effect.runPromise(Ref.make(false));

    const machine = createMachine<"test", "idle" | "running", TestContext, TestEvent>({
      id: "test",
      initial: "idle",
      context: { count: 0, log: [] },
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
          const actor = yield* interpret(machine);

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

    const machine = createMachine<"test", "idle" | "running", TestContext, TestEvent>({
      id: "test",
      initial: "idle",
      context: { count: 0, log: [] },
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
          const actor = yield* interpret(machine);

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
    const machine = createMachine<"test", "idle" | "counting", TestContext, TestEvent>({
      id: "test",
      initial: "idle",
      context: { count: 0, log: [] },
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
          const actor = yield* interpret(machine);

          actor.send(new Toggle());
          yield* Effect.sleep("50 millis");

          const snapshot = yield* actor.getSnapshot;
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
    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 10, log: [] },
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
          const actor = yield* interpret(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("10 millis");

          const snapshot = yield* actor.getSnapshot;
          expect(snapshot.value).toBe("b");
        }),
      ),
    );
  });

  it("blocks transition when sync guard returns false", async () => {
    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 3, log: [] },
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
          const actor = yield* interpret(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("10 millis");

          const snapshot = yield* actor.getSnapshot;
          expect(snapshot.value).toBe("a"); // Should NOT transition
        }),
      ),
    );
  });

  it("guard can access event data", async () => {
    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 0, log: [] },
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
          const actor = yield* interpret(machine);

          // Value too low - should not transition
          actor.send(new SetValue({ value: 30 }));
          yield* Effect.sleep("10 millis");
          let snapshot = yield* actor.getSnapshot;
          expect(snapshot.value).toBe("a");

          // Value high enough - should transition
          actor.send(new SetValue({ value: 100 }));
          yield* Effect.sleep("10 millis");
          snapshot = yield* actor.getSnapshot;
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
    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 10, log: [] },
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
          const actor = yield* interpret(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("10 millis");

          const snapshot = yield* actor.getSnapshot;
          expect(snapshot.value).toBe("b"); // Both conditions met
        }),
      ),
    );
  });

  it("and() blocks if any guard fails", async () => {
    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 25, log: [] }, // Fails second condition
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
          const actor = yield* interpret(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("10 millis");

          const snapshot = yield* actor.getSnapshot;
          expect(snapshot.value).toBe("a"); // Should NOT transition
        }),
      ),
    );
  });

  it("or() passes if any guard passes", async () => {
    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 3, log: [] }, // Only second condition passes
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
          const actor = yield* interpret(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("10 millis");

          const snapshot = yield* actor.getSnapshot;
          expect(snapshot.value).toBe("b"); // One condition met
        }),
      ),
    );
  });

  it("or() blocks if all guards fail", async () => {
    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 7, log: [] }, // Neither condition passes
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
          const actor = yield* interpret(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("10 millis");

          const snapshot = yield* actor.getSnapshot;
          expect(snapshot.value).toBe("a"); // Should NOT transition
        }),
      ),
    );
  });

  it("not() inverts a guard", async () => {
    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 3, log: [] },
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
          const actor = yield* interpret(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("10 millis");

          const snapshot = yield* actor.getSnapshot;
          expect(snapshot.value).toBe("b"); // NOT false = true
        }),
      ),
    );
  });

  it("not() blocks when inner guard passes", async () => {
    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 10, log: [] },
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
          const actor = yield* interpret(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("10 millis");

          const snapshot = yield* actor.getSnapshot;
          expect(snapshot.value).toBe("a"); // NOT true = false
        }),
      ),
    );
  });
});

// ============================================================================
// guardEffect - Async Guards
// ============================================================================

describe("guardEffect (async guards)", () => {
  it("allows transition when async guard resolves to true", async () => {
    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 10, log: [] },
      states: {
        a: {
          on: {
            TOGGLE: {
              target: "b",
              guard: guardEffect(({ context }) =>
                Effect.gen(function* () {
                  yield* Effect.sleep("5 millis"); // Simulate async check
                  return context.count > 5;
                }),
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
          const actor = yield* interpret(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("20 millis");

          const snapshot = yield* actor.getSnapshot;
          expect(snapshot.value).toBe("b");
        }),
      ),
    );
  });

  it("blocks transition when async guard resolves to false", async () => {
    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 3, log: [] },
      states: {
        a: {
          on: {
            TOGGLE: {
              target: "b",
              guard: guardEffect(({ context }) =>
                Effect.gen(function* () {
                  yield* Effect.sleep("5 millis");
                  return context.count > 5;
                }),
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
          const actor = yield* interpret(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("20 millis");

          const snapshot = yield* actor.getSnapshot;
          expect(snapshot.value).toBe("a"); // Should NOT transition
        }),
      ),
    );
  });

  it("blocks transition when async guard fails (error)", async () => {
    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 10, log: [] },
      states: {
        a: {
          on: {
            TOGGLE: {
              target: "b",
              guard: guardEffect(() => Effect.fail("async error")),
            },
          },
        },
        b: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = yield* interpret(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("10 millis");

          const snapshot = yield* actor.getSnapshot;
          expect(snapshot.value).toBe("a"); // Error = blocked
        }),
      ),
    );
  });
});

// ============================================================================
// after - Delayed Transitions
// ============================================================================

describe("after (delayed transitions)", () => {
  it("transitions after specified delay", async () => {
    const machine = createMachine<"test", "waiting" | "done", TestContext, TestEvent>({
      id: "test",
      initial: "waiting",
      context: { count: 0, log: [] },
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
          const actor = yield* interpret(machine);

          // Should still be waiting
          let snapshot = yield* actor.getSnapshot;
          expect(snapshot.value).toBe("waiting");

          // Wait for delay
          yield* Effect.sleep("70 millis");

          // Should have transitioned
          snapshot = yield* actor.getSnapshot;
          expect(snapshot.value).toBe("done");
        }),
      ),
    );
  });

  it("runs actions on delayed transition", async () => {
    const machine = createMachine<"test", "waiting" | "done", TestContext, TestEvent>({
      id: "test",
      initial: "waiting",
      context: { count: 0, log: [] },
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
          const actor = yield* interpret(machine);

          // Wait for delay
          yield* Effect.sleep("50 millis");

          const snapshot = yield* actor.getSnapshot;
          expect(snapshot.value).toBe("done");
          expect(snapshot.context.count).toBe(42); // Action ran
        }),
      ),
    );
  });

  it("runs entry/exit actions on delayed transition", async () => {
    const actionLog = await Effect.runPromise(Ref.make<string[]>([]));

    const machine = createMachine<"test", "waiting" | "done", TestContext, TestEvent>({
      id: "test",
      initial: "waiting",
      context: { count: 0, log: [] },
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
          const actor = yield* interpret(machine);

          yield* Effect.sleep("50 millis");

          const log = yield* Ref.get(actionLog);
          expect(log).toEqual(["exit-waiting", "entry-done"]);

          const snapshot = yield* actor.getSnapshot;
          expect(snapshot.value).toBe("done");
        }),
      ),
    );
  });
});
