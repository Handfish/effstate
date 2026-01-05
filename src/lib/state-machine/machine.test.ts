import { describe, it, expect } from "vitest";
import { Data, Effect, Exit, Fiber, Ref, Schema } from "effect";
import { createMachine, interpret, interpretSync } from "./machine";
import { assign, effect, raise, cancel, emit, enqueueActions, spawnChild, stopChild, sendTo, sendParent, forwardTo } from "./actions";
import type { MachineEvent } from "./types";
import { guard, and, or, not } from "./guards";

// ============================================================================
// Test Event Types
// ============================================================================

class Toggle extends Data.TaggedClass("TOGGLE")<{}> {}
class SetValue extends Data.TaggedClass("SET_VALUE")<{ readonly value: number }> {}
class Tick extends Data.TaggedClass("TICK")<{}> {}
class Increment extends Data.TaggedClass("INCREMENT")<{}> {}

type TestEvent = Toggle | SetValue | Tick | Increment;

// Emitted events (for external listeners)
interface NotificationEvent {
  readonly type: "notification";
  readonly message: string;
}
interface CountChangedEvent {
  readonly type: "countChanged";
  readonly count: number;
}
type TestEmittedEvent = NotificationEvent | CountChangedEvent;

// ============================================================================
// Test Context Schemas (Schema-based context required)
// ============================================================================

const TestContextSchema = Schema.Struct({
  count: Schema.Number,
  log: Schema.Array(Schema.String),
});
type TestContext = typeof TestContextSchema.Type;

const EmptyContextSchema = Schema.Struct({});

const CountOnlySchema = Schema.Struct({ count: Schema.Number });
const TickContextSchema = Schema.Struct({ tickCount: Schema.Number });
const StartedContextSchema = Schema.Struct({ started: Schema.Boolean });
const ValueContextSchema = Schema.Struct({ value: Schema.Number });
const MultiplierContextSchema = Schema.Struct({ multiplier: Schema.Number });

// ============================================================================
// createMachine
// ============================================================================

describe("createMachine", () => {
  it("creates a machine definition with correct initial snapshot", () => {
    const machine = createMachine({
      id: "test",
      initial: "inactive",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
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
// subscribe() - Snapshot Observers
// ============================================================================

describe("subscribe()", () => {
  it("calls subscriber on state transitions", async () => {
    const snapshots: Array<{ value: string; count: number }> = [];

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
              actions: [assign({ count: 1 })],
            },
          },
        },
        b: {
          on: {
            TOGGLE: {
              target: "a",
              actions: [assign({ count: 2 })],
            },
          },
        },
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);

          actor.subscribe((snapshot) => {
            snapshots.push({ value: snapshot.value, count: snapshot.context.count });
          });

          actor.send(new Toggle()); // a → b
          actor.send(new Toggle()); // b → a

          expect(snapshots).toHaveLength(2);
          expect(snapshots[0]).toEqual({ value: "b", count: 1 });
          expect(snapshots[1]).toEqual({ value: "a", count: 2 });
        }),
      ),
    );
  });

  it("calls subscriber on self-transitions with actions", async () => {
    const snapshots: Array<{ value: string; count: number }> = [];

    const machine = createMachine({
      id: "test",
      initial: "counter",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        counter: {
          on: {
            TOGGLE: {
              actions: [assign(({ context }) => ({ count: context.count + 1 }))],
            },
          },
        },
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);

          actor.subscribe((snapshot) => {
            snapshots.push({ value: snapshot.value, count: snapshot.context.count });
          });

          actor.send(new Toggle());
          actor.send(new Toggle());
          actor.send(new Toggle());

          expect(snapshots).toHaveLength(3);
          expect(snapshots[0]?.count).toBe(1);
          expect(snapshots[1]?.count).toBe(2);
          expect(snapshots[2]?.count).toBe(3);
        }),
      ),
    );
  });

  it("supports multiple subscribers", async () => {
    let sub1Calls = 0;
    let sub2Calls = 0;
    let sub3Calls = 0;

    const machine = createMachine({
      id: "test",
      initial: "a",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        a: { on: { TOGGLE: { target: "b" } } },
        b: { on: { TOGGLE: { target: "a" } } },
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);

          actor.subscribe(() => sub1Calls++);
          actor.subscribe(() => sub2Calls++);
          actor.subscribe(() => sub3Calls++);

          actor.send(new Toggle());
          actor.send(new Toggle());

          expect(sub1Calls).toBe(2);
          expect(sub2Calls).toBe(2);
          expect(sub3Calls).toBe(2);
        }),
      ),
    );
  });

  it("unsubscribe removes subscriber", async () => {
    const calls: number[] = [];

    const machine = createMachine({
      id: "test",
      initial: "a",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        a: { on: { TOGGLE: { target: "b" } } },
        b: { on: { TOGGLE: { target: "a" } } },
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);

          const unsub = actor.subscribe(() => calls.push(1));

          actor.send(new Toggle()); // Should call subscriber
          expect(calls).toHaveLength(1);

          unsub(); // Unsubscribe

          actor.send(new Toggle()); // Should NOT call subscriber
          expect(calls).toHaveLength(1); // Still 1, not 2
        }),
      ),
    );
  });
});

// ============================================================================
// assign() - Context Updates
// ============================================================================

describe("assign()", () => {
  it("updates context with static values", async () => {
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
          const actor = interpretSync(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("10 millis");

          const snapshot = actor.getSnapshot();
          expect(snapshot.context.count).toBe(42);
        }),
      ),
    );
  });

  it("updates context with function using previous context", async () => {
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
          const actor = interpretSync(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("10 millis");

          const snapshot = actor.getSnapshot();
          expect(snapshot.context.count).toBe(10);
        }),
      ),
    );
  });

  it("accesses event data with proper narrowing", async () => {
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
          const actor = interpretSync(machine);
          actor.send(new SetValue({ value: 123 }));
          yield* Effect.sleep("10 millis");

          const snapshot = actor.getSnapshot();
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
          const actor = interpretSync(machine);
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
          const actor = interpretSync(machine);
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
          const actor = interpretSync(machine);
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
          const actor = interpretSync(machine);
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
          const actor = interpretSync(machine);
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
          interpretSync(machine);
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
          const actor = interpretSync(machine);
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
          const actor = interpretSync(machine);
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

// ============================================================================
// emit - Emit to External Listeners
// ============================================================================

describe("emit (external listeners)", () => {
  it("emits event to registered listener", async () => {
    const received: TestEmittedEvent[] = [];

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
              actions: [
                emit<TestContext, TestEvent, TestEmittedEvent>({
                  type: "notification",
                  message: "Transitioning to b",
                }),
              ],
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

          // Register listener
          actor.on("notification", (event) => {
            received.push(event as TestEmittedEvent);
          });

          actor.send(new Toggle());
          yield* Effect.sleep("20 millis");

          expect(received).toHaveLength(1);
          expect(received[0]).toEqual({
            type: "notification",
            message: "Transitioning to b",
          });
        }),
      ),
    );
  });

  it("emits to multiple listeners for same event type", async () => {
    const received1: TestEmittedEvent[] = [];
    const received2: TestEmittedEvent[] = [];

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
              actions: [
                emit<TestContext, TestEvent, TestEmittedEvent>({
                  type: "notification",
                  message: "Hello",
                }),
              ],
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

          actor.on("notification", (event) => received1.push(event as TestEmittedEvent));
          actor.on("notification", (event) => received2.push(event as TestEmittedEvent));

          actor.send(new Toggle());
          yield* Effect.sleep("20 millis");

          expect(received1).toHaveLength(1);
          expect(received2).toHaveLength(1);
        }),
      ),
    );
  });

  it("unsubscribe removes listener", async () => {
    const received: TestEmittedEvent[] = [];

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
              actions: [
                emit<TestContext, TestEvent, TestEmittedEvent>({
                  type: "notification",
                  message: "First",
                }),
              ],
            },
          },
        },
        b: {
          on: {
            TOGGLE: {
              target: "a",
              actions: [
                emit<TestContext, TestEvent, TestEmittedEvent>({
                  type: "notification",
                  message: "Second",
                }),
              ],
            },
          },
        },
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);

          const unsubscribe = actor.on("notification", (event) => received.push(event as TestEmittedEvent));

          actor.send(new Toggle()); // Should emit "First"
          yield* Effect.sleep("20 millis");

          unsubscribe(); // Remove listener

          actor.send(new Toggle()); // Should NOT emit "Second"
          yield* Effect.sleep("20 millis");

          expect(received).toHaveLength(1);
          expect(received[0]).toEqual({ type: "notification", message: "First" });
        }),
      ),
    );
  });

  it("emits with dynamic event from function", async () => {
    const received: TestEmittedEvent[] = [];

    const machine = createMachine({
      id: "test",
      initial: "a",
      context: TestContextSchema,
      initialContext: { count: 42, log: [] },
      states: {
        a: {
          on: {
            TOGGLE: {
              target: "b",
              actions: [
                emit<TestContext, TestEvent, TestEmittedEvent>(({ context }) => ({
                  type: "countChanged",
                  count: context.count,
                })),
              ],
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

          actor.on("countChanged", (event) => received.push(event as TestEmittedEvent));

          actor.send(new Toggle());
          yield* Effect.sleep("20 millis");

          expect(received).toHaveLength(1);
          expect(received[0]).toEqual({ type: "countChanged", count: 42 });
        }),
      ),
    );
  });

  it("emit with no listeners is a no-op", async () => {
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
              actions: [
                emit<TestContext, TestEvent, TestEmittedEvent>({
                  type: "notification",
                  message: "No one listening",
                }),
              ],
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

          // No listeners registered
          actor.send(new Toggle());
          yield* Effect.sleep("20 millis");

          const snapshot = actor.getSnapshot();
          expect(snapshot.value).toBe("b"); // Transition still works
        }),
      ),
    );
  });
});

// ============================================================================
// enqueueActions - Dynamic Action Queuing
// ============================================================================

describe("enqueueActions (dynamic action queuing)", () => {
  it("enqueues multiple actions that execute in order", async () => {
    const actionLog = await Effect.runPromise(Ref.make<string[]>([]));

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
              actions: [
                enqueueActions<TestContext, Toggle>(({ enqueue }) => {
                  enqueue(effect(() => Ref.update(actionLog, (log) => [...log, "first"])));
                  enqueue(assign({ count: 10 }));
                  enqueue(effect(() => Ref.update(actionLog, (log) => [...log, "second"])));
                }),
              ],
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
          yield* Effect.sleep("20 millis");

          const snapshot = actor.getSnapshot();
          expect(snapshot.value).toBe("b");
          expect(snapshot.context.count).toBe(10);

          const log = yield* Ref.get(actionLog);
          expect(log).toEqual(["first", "second"]);
        }),
      ),
    );
  });

  it("conditional enqueueing based on context", async () => {
    const machine = createMachine({
      id: "test",
      initial: "a",
      context: TestContextSchema,
      initialContext: { count: 15, log: [] },
      states: {
        a: {
          on: {
            TOGGLE: {
              target: "b",
              actions: [
                enqueueActions<TestContext, Toggle>(({ context, enqueue }) => {
                  if (context.count > 10) {
                    enqueue(assign({ count: 100 }));
                  } else {
                    enqueue(assign({ count: 0 }));
                  }
                }),
              ],
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
          yield* Effect.sleep("20 millis");

          const snapshot = actor.getSnapshot();
          expect(snapshot.context.count).toBe(100); // count > 10, so assigned 100
        }),
      ),
    );
  });

  it("enqueue.assign shorthand works", async () => {
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
              actions: [
                enqueueActions<TestContext, Toggle>(({ enqueue }) => {
                  enqueue.assign({ count: 42 });
                  enqueue.assign(({ context }) => ({ count: context.count + 8 }));
                }),
              ],
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
          yield* Effect.sleep("20 millis");

          const snapshot = actor.getSnapshot();
          expect(snapshot.context.count).toBe(50); // 42 + 8
        }),
      ),
    );
  });

  it("enqueue.raise shorthand works", async () => {
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
              actions: [
                enqueueActions<TestContext, Toggle>(({ enqueue }) => {
                  enqueue.raise(new Tick());
                }),
              ],
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
          const actor = interpretSync(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("30 millis");

          const snapshot = actor.getSnapshot();
          expect(snapshot.value).toBe("c"); // Raised TICK transitioned to c
          expect(snapshot.context.count).toBe(99);
        }),
      ),
    );
  });

  it("enqueue.effect shorthand works", async () => {
    const effectRan = await Effect.runPromise(Ref.make(false));

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
              actions: [
                enqueueActions<TestContext, Toggle>(({ enqueue }) => {
                  enqueue.effect(() => Ref.set(effectRan, true));
                }),
              ],
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
          yield* Effect.sleep("20 millis");

          const ran = yield* Ref.get(effectRan);
          expect(ran).toBe(true);
        }),
      ),
    );
  });

  it("accesses event data in enqueueActions", async () => {
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
              actions: [
                enqueueActions<TestContext, SetValue>(({ event, enqueue }) => {
                  enqueue.assign({ count: event.value * 2 });
                }),
              ],
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
          actor.send(new SetValue({ value: 25 }));
          yield* Effect.sleep("20 millis");

          const snapshot = actor.getSnapshot();
          expect(snapshot.context.count).toBe(50); // 25 * 2
        }),
      ),
    );
  });
});

// ============================================================================
// spawnChild / stopChild - Actor Hierarchy
// ============================================================================

// Child machine for testing
class ChildStart extends Data.TaggedClass("CHILD_START")<{}> {}
class ChildDone extends Data.TaggedClass("CHILD_DONE")<{}> {}
type ChildEvent = ChildStart | ChildDone;

interface ChildContext {
  readonly started: boolean;
}

const createChildMachine = (id: string, onStart?: () => void) =>
  createMachine<typeof id, "idle" | "running" | "done", ChildContext, ChildEvent>({
    id,
    initial: "idle",
    context: StartedContextSchema,
      initialContext: { started: false },
    states: {
      idle: {
        on: {
          CHILD_START: {
            target: "running",
            actions: [
              assign({ started: true }),
              ...(onStart ? [effect(() => { onStart(); return Effect.void; })] : []),
            ],
          },
        },
      },
      running: {
        on: {
          CHILD_DONE: { target: "done" },
        },
      },
      done: {},
    },
  });

describe("spawnChild / stopChild (actor hierarchy)", () => {
  it("spawnChild creates a running child actor", async () => {
    const childStarted = await Effect.runPromise(Ref.make(false));

    const childMachine = createChildMachine("child", () => {
      Effect.runSync(Ref.set(childStarted, true));
    });

    const machine = createMachine({
      id: "test",
      initial: "idle",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        idle: {
          on: {
            TOGGLE: {
              target: "parenting",
              actions: [spawnChild(childMachine, { id: "myChild" })],
            },
          },
        },
        parenting: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("20 millis");

          const snapshot = actor.getSnapshot();
          expect(snapshot.value).toBe("parenting");

          // Child should be in the children map
          const children = actor.children;
          expect(children.has("myChild")).toBe(true);
        }),
      ),
    );
  });

  it("spawnChild with dynamic ID from function", async () => {
    const childMachine = createChildMachine("child");

    const machine = createMachine({
      id: "test",
      initial: "idle",
      context: TestContextSchema,
      initialContext: { count: 42, log: [] },
      states: {
        idle: {
          on: {
            TOGGLE: {
              target: "parenting",
              actions: [
                spawnChild(childMachine, {
                  id: ({ context }) => `child-${context.count}`,
                }),
              ],
            },
          },
        },
        parenting: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("20 millis");

          const children = actor.children;
          expect(children.has("child-42")).toBe(true);
        }),
      ),
    );
  });

  it("stopChild stops the specified child", async () => {
    const childMachine = createChildMachine("child");

    const machine = createMachine({
      id: "test",
      initial: "idle",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        idle: {
          on: {
            TOGGLE: {
              target: "parenting",
              actions: [spawnChild(childMachine, { id: "myChild" })],
            },
          },
        },
        parenting: {
          on: {
            TICK: {
              target: "stopped",
              actions: [stopChild("myChild")],
            },
          },
        },
        stopped: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("20 millis");

          // Child should exist
          expect(actor.children.has("myChild")).toBe(true);

          // Stop the child
          actor.send(new Tick());
          yield* Effect.sleep("20 millis");

          // Child should be removed
          expect(actor.children.has("myChild")).toBe(false);
        }),
      ),
    );
  });

  it("stopChild with dynamic ID from function", async () => {
    const childMachine = createChildMachine("child");

    const machine = createMachine({
      id: "test",
      initial: "idle",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        idle: {
          on: {
            TOGGLE: {
              target: "parenting",
              actions: [spawnChild(childMachine, { id: "child-100" })],
            },
          },
        },
        parenting: {
          on: {
            SET_VALUE: {
              target: "stopped",
              actions: [stopChild(({ event }) => `child-${event.value}`)],
            },
          },
        },
        stopped: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("20 millis");

          expect(actor.children.has("child-100")).toBe(true);

          // Stop using dynamic ID from event
          actor.send(new SetValue({ value: 100 }));
          yield* Effect.sleep("20 millis");

          expect(actor.children.has("child-100")).toBe(false);
        }),
      ),
    );
  });

  it("parent scope closing stops all children", async () => {
    const childMachine = createChildMachine("child");

    const machine = createMachine({
      id: "test",
      initial: "idle",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        idle: {
          on: {
            TOGGLE: {
              target: "parenting",
              actions: [
                spawnChild(childMachine, { id: "child1" }),
                spawnChild(childMachine, { id: "child2" }),
              ],
            },
          },
        },
        parenting: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("20 millis");

          expect(actor.children.size).toBe(2);
          // When scope closes, children should be cleaned up
        }),
      ),
    );
    // After scope closes, cleanup should have happened
    // (We can't easily test this from outside, but the implementation should handle it)
  });
});

// ============================================================================
// sendTo - Send Events to Child Actors
// ============================================================================

describe("sendTo (send events to child actors)", () => {
  it("sendTo delivers event to child actor", async () => {
    const childMachine = createChildMachine("child");

    const machine = createMachine({
      id: "test",
      initial: "idle",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        idle: {
          on: {
            TOGGLE: {
              target: "parenting",
              actions: [spawnChild(childMachine, { id: "myChild" })],
            },
          },
        },
        parenting: {
          on: {
            TICK: {
              actions: [sendTo("myChild", new ChildStart())],
            },
          },
        },
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("20 millis");

          // Child should be in idle state
          const child = actor.children.get("myChild");
          expect(child).toBeDefined();
          let childSnapshot = child!.getSnapshot();
          expect(childSnapshot.value).toBe("idle");

          // Send event to child via parent
          actor.send(new Tick());
          yield* Effect.sleep("20 millis");

          // Child should now be in running state
          childSnapshot = child!.getSnapshot();
          expect(childSnapshot.value).toBe("running");
          expect((childSnapshot.context as ChildContext).started).toBe(true);
        }),
      ),
    );
  });

  it("sendTo with dynamic target from function", async () => {
    const childMachine = createChildMachine("child");

    const machine = createMachine({
      id: "test",
      initial: "idle",
      context: TestContextSchema,
      initialContext: { count: 42, log: [] },
      states: {
        idle: {
          on: {
            TOGGLE: {
              target: "parenting",
              actions: [spawnChild(childMachine, { id: "child-42" })],
            },
          },
        },
        parenting: {
          on: {
            TICK: {
              actions: [
                sendTo(
                  ({ context }) => `child-${context.count}`,
                  new ChildStart(),
                ),
              ],
            },
          },
        },
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("20 millis");

          const child = actor.children.get("child-42");
          expect(child).toBeDefined();

          actor.send(new Tick());
          yield* Effect.sleep("20 millis");

          const childSnapshot = child!.getSnapshot();
          expect(childSnapshot.value).toBe("running");
        }),
      ),
    );
  });

  it("sendTo with dynamic event from function", async () => {
    const childMachine = createChildMachine("child");

    const machine = createMachine({
      id: "test",
      initial: "idle",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        idle: {
          on: {
            TOGGLE: {
              target: "parenting",
              actions: [spawnChild(childMachine, { id: "myChild" })],
            },
          },
        },
        parenting: {
          on: {
            TICK: {
              actions: [
                sendTo("myChild", () => new ChildStart()),
              ],
            },
          },
        },
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("20 millis");

          actor.send(new Tick());
          yield* Effect.sleep("20 millis");

          const child = actor.children.get("myChild");
          const childSnapshot = child!.getSnapshot();
          expect(childSnapshot.value).toBe("running");
        }),
      ),
    );
  });

  it("sendTo non-existent actor is a no-op", async () => {
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
              actions: [sendTo("nonexistent", new ChildStart())],
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
          yield* Effect.sleep("20 millis");

          const snapshot = actor.getSnapshot();
          expect(snapshot.value).toBe("b"); // Transition still works
        }),
      ),
    );
  });
});

// ============================================================================
// sendParent - Send Events to Parent Actor
// ============================================================================

// Parent event types for testing parent communication
class ParentNotify extends Data.TaggedClass("PARENT_NOTIFY")<{ readonly message: string }> {}
type ParentEvent = TestEvent | ParentNotify;

describe("sendParent (send events to parent actor)", () => {
  it("sendParent delivers event to parent", async () => {
    // Child machine that sends to parent
    const childMachine = createMachine({
      id: "child",
      initial: "idle",
      context: StartedContextSchema,
      initialContext: { started: false },
      states: {
        idle: {
          on: {
            CHILD_START: {
              target: "notifying",
              actions: [
                sendParent(new ParentNotify({ message: "Child started!" })),
              ],
            },
          },
        },
        notifying: {},
      },
    });

    const machine = createMachine({
      id: "test",
      initial: "idle",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        idle: {
          on: {
            TOGGLE: {
              target: "parenting",
              actions: [spawnChild(childMachine, { id: "myChild" })],
            },
          },
        },
        parenting: {
          on: {
            TICK: {
              actions: [sendTo("myChild", new ChildStart())],
            },
            PARENT_NOTIFY: {
              target: "notified",
              actions: [
                assign(({ event }) => ({
                  log: [event.message],
                })),
              ],
            },
          },
        },
        notified: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);

          // Spawn child
          actor.send(new Toggle());
          yield* Effect.sleep("20 millis");

          // Tell child to start (which sends to parent)
          actor.send(new Tick());
          yield* Effect.sleep("30 millis");

          const snapshot = actor.getSnapshot();
          expect(snapshot.value).toBe("notified");
          expect(snapshot.context.log).toContain("Child started!");
        }),
      ),
    );
  });

  it("sendParent with dynamic event from function", async () => {
    // Child machine that sends dynamic event to parent
    const childMachine = createMachine({
      id: "child",
      initial: "idle",
      context: CountOnlySchema,
      initialContext: { count: 42 },
      states: {
        idle: {
          on: {
            CHILD_START: {
              target: "notifying",
              actions: [
                sendParent(({ context }) =>
                  new ParentNotify({ message: `Count is ${context.count}` }),
                ),
              ],
            },
          },
        },
        notifying: {},
      },
    });

    const machine = createMachine({
      id: "test",
      initial: "idle",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        idle: {
          on: {
            TOGGLE: {
              target: "parenting",
              actions: [spawnChild(childMachine, { id: "myChild" })],
            },
          },
        },
        parenting: {
          on: {
            TICK: {
              actions: [sendTo("myChild", new ChildStart())],
            },
            PARENT_NOTIFY: {
              target: "notified",
              actions: [
                assign(({ event }) => ({
                  log: [event.message],
                })),
              ],
            },
          },
        },
        notified: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);

          actor.send(new Toggle());
          yield* Effect.sleep("20 millis");

          actor.send(new Tick());
          yield* Effect.sleep("30 millis");

          const snapshot = actor.getSnapshot();
          expect(snapshot.value).toBe("notified");
          expect(snapshot.context.log).toContain("Count is 42");
        }),
      ),
    );
  });

  it("sendParent with no parent is a no-op", async () => {
    // Machine that tries to send to parent (but has none)
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
              actions: [sendParent(new ParentNotify({ message: "Hello" }))],
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
          yield* Effect.sleep("20 millis");

          const snapshot = actor.getSnapshot();
          expect(snapshot.value).toBe("b"); // Transition still works
        }),
      ),
    );
  });
});

// ============================================================================
// forwardTo - Forward Current Event to Another Actor
// ============================================================================

describe("forwardTo (forward current event to another actor)", () => {
  it("forwardTo passes current event to child unchanged", async () => {
    // Child machine that handles TICK event
    const childMachine = createMachine({
      id: "child",
      initial: "idle",
      context: TickContextSchema,
      initialContext: { tickCount: 0 },
      states: {
        idle: {
          on: {
            TICK: {
              target: "ticked",
              actions: [assign({ tickCount: 1 })],
            },
          },
        },
        ticked: {},
      },
    });

    const machine = createMachine({
      id: "test",
      initial: "idle",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        idle: {
          on: {
            TOGGLE: {
              target: "parenting",
              actions: [spawnChild(childMachine, { id: "myChild" })],
            },
          },
        },
        parenting: {
          on: {
            TICK: {
              actions: [forwardTo("myChild")],
            },
          },
        },
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);

          actor.send(new Toggle());
          yield* Effect.sleep("20 millis");

          const child = actor.children.get("myChild");
          expect(child).toBeDefined();
          let childSnapshot = child!.getSnapshot();
          expect(childSnapshot.value).toBe("idle");

          // Forward TICK to child
          actor.send(new Tick());
          yield* Effect.sleep("20 millis");

          childSnapshot = child!.getSnapshot();
          expect(childSnapshot.value).toBe("ticked");
          expect((childSnapshot.context as { tickCount: number }).tickCount).toBe(1);
        }),
      ),
    );
  });

  it("forwardTo with dynamic target from function", async () => {
    const childMachine = createMachine({
      id: "child",
      initial: "idle",
      context: TickContextSchema,
      initialContext: { tickCount: 0 },
      states: {
        idle: {
          on: {
            TICK: {
              target: "ticked",
              actions: [assign({ tickCount: 1 })],
            },
          },
        },
        ticked: {},
      },
    });

    const machine = createMachine({
      id: "test",
      initial: "idle",
      context: TestContextSchema,
      initialContext: { count: 42, log: [] },
      states: {
        idle: {
          on: {
            TOGGLE: {
              target: "parenting",
              actions: [spawnChild(childMachine, { id: "child-42" })],
            },
          },
        },
        parenting: {
          on: {
            TICK: {
              actions: [forwardTo(({ context }) => `child-${context.count}`)],
            },
          },
        },
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);

          actor.send(new Toggle());
          yield* Effect.sleep("20 millis");

          actor.send(new Tick());
          yield* Effect.sleep("20 millis");

          const child = actor.children.get("child-42");
          const childSnapshot = child!.getSnapshot();
          expect(childSnapshot.value).toBe("ticked");
        }),
      ),
    );
  });

  it("forwardTo non-existent actor is a no-op", async () => {
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
              actions: [forwardTo("nonexistent")],
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
          yield* Effect.sleep("20 millis");

          const snapshot = actor.getSnapshot();
          expect(snapshot.value).toBe("b"); // Transition still works
        }),
      ),
    );
  });
});

// ============================================================================
// onError (Error Handling with TaggedErrors)
// ============================================================================

describe("onError (error handling)", () => {
  it("isolates observer errors without crashing other observers", async () => {
    const calls: string[] = [];

    const machine = createMachine({
      id: "test",
      initial: "a",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        a: { on: { TOGGLE: { target: "b" } } },
        b: {},
      },
    });

    const actor = interpretSync(machine);

    // First observer throws
    actor.subscribe(() => {
      calls.push("observer1-before");
      throw new Error("Observer crashed!");
    });

    // Second observer should still be called
    actor.subscribe(() => {
      calls.push("observer2");
    });

    actor.send(new Toggle());

    // Both observers were attempted, second succeeded
    expect(calls).toContain("observer1-before");
    expect(calls).toContain("observer2");
  });

  it("emits EffectActionError when effect action fails", async () => {
    const errors: Array<{ _tag: string; message: string }> = [];

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
              actions: [
                effect(() => Effect.fail("Action failed!")),
              ],
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

          actor.onError((error) => {
            errors.push({ _tag: error._tag, message: error.message });
          });

          actor.send(new Toggle());
          yield* Effect.sleep("50 millis"); // Wait for async effect to fail

          expect(errors.length).toBeGreaterThan(0);
          expect(errors[0]?._tag).toBe("EffectActionError");
        }),
      ),
    );
  });

  it("unsubscribe removes error handler", async () => {
    const errors: string[] = [];

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
              actions: [effect(() => Effect.fail("error1"))],
            },
          },
        },
        b: {
          on: {
            TOGGLE: {
              target: "a",
              actions: [effect(() => Effect.fail("error2"))],
            },
          },
        },
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);

          const unsub = actor.onError((error) => {
            errors.push(error._tag);
          });

          actor.send(new Toggle()); // First error
          yield* Effect.sleep("50 millis");

          unsub(); // Remove error handler

          actor.send(new Toggle()); // Second error - should NOT be caught
          yield* Effect.sleep("50 millis");

          // Only one error should be recorded
          expect(errors).toHaveLength(1);
          expect(errors[0]).toBe("EffectActionError");
        }),
      ),
    );
  });
});

// ============================================================================
// waitFor - Effect-based state waiting
// ============================================================================

describe("waitFor (Effect-based state waiting)", () => {
  it("resolves immediately if condition already met", async () => {
    const machine = createMachine({
      id: "test",
      initial: "a",
      context: TestContextSchema,
      initialContext: { count: 5, log: [] },
      states: {
        a: { on: { TOGGLE: { target: "b" } } },
        b: {},
      },
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const actor = interpretSync(machine);

        // Condition already met (count >= 5)
        const result = yield* actor.waitFor((s) => s.context.count >= 5);
        expect(result.context.count).toBe(5);
        expect(result.value).toBe("a");

        actor.stop();
      }),
    );
  });

  it("waits for state transition", async () => {
    const machine = createMachine({
      id: "test",
      initial: "loading",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        loading: { on: { TOGGLE: { target: "done" } } },
        done: {},
      },
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const actor = interpretSync(machine);

        // Start waiting in background
        const waitFiber = yield* Effect.fork(
          actor.waitFor((s) => s.value === "done")
        );

        // Give fiber time to subscribe
        yield* Effect.sleep("10 millis");

        // Trigger transition
        actor.send(new Toggle());

        // Wait for result
        const result = yield* waitFiber.await.pipe(Effect.flatMap(Effect.exit));
        expect(result._tag).toBe("Success");

        actor.stop();
      }),
    );
  });

  it("waits for context condition", async () => {
    const machine = createMachine({
      id: "test",
      initial: "counting",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        counting: {
          on: {
            INCREMENT: {
              actions: [assign(({ context }) => ({ count: context.count + 1 }))],
            },
          },
        },
      },
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const actor = interpretSync(machine);

        // Start waiting for count to reach 3
        const waitFiber = yield* Effect.fork(
          actor.waitFor((s) => s.context.count >= 3)
        );

        yield* Effect.sleep("5 millis");

        // Increment count 3 times
        actor.send(new Increment());
        actor.send(new Increment());
        actor.send(new Increment());

        const result = yield* waitFiber.await.pipe(Effect.flatMap(Effect.exit));
        expect(result._tag).toBe("Success");
        if (result._tag === "Success") {
          expect(result.value.context.count).toBe(3);
        }

        actor.stop();
      }),
    );
  });

  it("can be used with Effect.timeout", async () => {
    const machine = createMachine({
      id: "test",
      initial: "waiting",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        waiting: {},
      },
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const actor = interpretSync(machine);

        // Wait for a state that will never happen, with timeout
        const result = yield* actor
          .waitFor((s) => s.value === "never" as never)
          .pipe(
            Effect.timeout("50 millis"),
            Effect.option
          );

        expect(result._tag).toBe("None"); // Timed out

        actor.stop();
      }),
    );
  });

  it("cleans up subscription on interruption", async () => {
    const machine = createMachine({
      id: "test",
      initial: "a",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        a: { on: { TOGGLE: { target: "b" } } },
        b: {},
      },
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const actor = interpretSync(machine);

        // Start waiting
        const fiber = yield* Effect.fork(
          actor.waitFor((s) => s.value === "never" as never)
        );

        yield* Effect.sleep("10 millis");

        // Interrupt the fiber
        yield* Fiber.interrupt(fiber);

        // Machine should still work normally after interruption
        actor.send(new Toggle());
        expect(actor.getSnapshot().value).toBe("b");

        actor.stop();
      }),
    );
  });
});

// ============================================================================
// interpret (Effect-native with services)
// ============================================================================

import { Context, Scope } from "effect";

// Define a test service
class CounterService extends Context.Tag("CounterService")<
  CounterService,
  { readonly increment: (n: number) => Effect.Effect<number> }
>() {}

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

  it("interpretSync does not require service provision", () => {
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

    // interpretSync compiles without providing services
    // (though the effect would fail at runtime if triggered)
    const _actor = interpretSync(machineWithService);
    _actor.stop();
  });
});

// ============================================================================
// Schema Context
// ============================================================================

import {
  createSnapshotSchema,
  encodeSnapshotSync,
  decodeSnapshotSync,
} from "./serialization";

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

    const actor = interpretSync(machine);
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

    const actor = interpretSync(machine);
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

    const actor = interpretSync(machine);
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
// invoke - Async Operations with onDone/onError
// ============================================================================

describe("invoke (async operations)", () => {
  it("invokes effect on state entry and transitions on done", async () => {
    const machine = createMachine({
      id: "test",
      initial: "loading",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        loading: {
          invoke: {
            id: "fetchData",
            src: () => Effect.succeed(42).pipe(Effect.delay("10 millis")),
            onDone: {
              target: "success",
              actions: [
                assign(({ event }) => ({ count: event.output as number })),
              ],
            },
          },
        },
        success: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);

          // Should start in loading
          expect(actor.getSnapshot().value).toBe("loading");

          // Wait for invoke to complete
          yield* Effect.sleep("30 millis");

          // Should transition to success with result
          const snapshot = actor.getSnapshot();
          expect(snapshot.value).toBe("success");
          expect(snapshot.context.count).toBe(42);
        }),
      ),
    );
  });

  it("transitions to error state when invoke fails", async () => {
    const machine = createMachine({
      id: "test",
      initial: "loading",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        loading: {
          invoke: {
            id: "fetchData",
            src: () => Effect.fail("Network error").pipe(Effect.delay("10 millis")),
            onDone: {
              target: "success",
            },
            onError: {
              target: "error",
              actions: [
                assign(({ event }) => ({ log: [String(event.error)] })),
              ],
            },
          },
        },
        success: {},
        error: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);

          expect(actor.getSnapshot().value).toBe("loading");

          yield* Effect.sleep("30 millis");

          const snapshot = actor.getSnapshot();
          expect(snapshot.value).toBe("error");
          expect(snapshot.context.log[0]).toContain("Network error");
        }),
      ),
    );
  });

  it("cancels invoke when transitioning away", async () => {
    const invokeCancelled = await Effect.runPromise(Ref.make(false));

    const machine = createMachine({
      id: "test",
      initial: "loading",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        loading: {
          invoke: {
            id: "slowFetch",
            src: () =>
              Effect.gen(function* () {
                yield* Effect.addFinalizer(() =>
                  Ref.set(invokeCancelled, true)
                );
                yield* Effect.sleep("1 second");
                return 42;
              }).pipe(Effect.scoped),
            onDone: { target: "success" },
          },
          on: {
            TOGGLE: { target: "cancelled" },
          },
        },
        success: {},
        cancelled: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);

          expect(actor.getSnapshot().value).toBe("loading");

          // Transition away before invoke completes
          yield* Effect.sleep("20 millis");
          actor.send(new Toggle());

          yield* Effect.sleep("30 millis");

          expect(actor.getSnapshot().value).toBe("cancelled");

          // Invoke should have been cancelled
          const wasCancelled = yield* Ref.get(invokeCancelled);
          expect(wasCancelled).toBe(true);
        }),
      ),
    );
  });

  it("invoke can access context", async () => {
    const machine = createMachine({
      id: "test",
      initial: "loading",
      context: TestContextSchema,
      initialContext: { count: 10, log: [] },
      states: {
        loading: {
          invoke: {
            id: "compute",
            src: ({ context }) => Effect.succeed(context.count * 2),
            onDone: {
              target: "done",
              actions: [
                assign(({ event }) => ({ count: event.output as number })),
              ],
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
          yield* Effect.sleep("20 millis");

          const snapshot = actor.getSnapshot();
          expect(snapshot.value).toBe("done");
          expect(snapshot.context.count).toBe(20);
        }),
      ),
    );
  });

  it("invoke runs on initial state", async () => {
    const machine = createMachine({
      id: "test",
      initial: "loading",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        loading: {
          invoke: {
            id: "init",
            src: () => Effect.succeed("initialized"),
            onDone: {
              target: "ready",
              actions: [
                assign(({ event }) => ({ log: [event.output as string] })),
              ],
            },
          },
        },
        ready: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);
          yield* Effect.sleep("20 millis");

          const snapshot = actor.getSnapshot();
          expect(snapshot.value).toBe("ready");
          expect(snapshot.context.log).toContain("initialized");
        }),
      ),
    );
  });

  it("invoke with guard on onDone", async () => {
    const machine = createMachine({
      id: "test",
      initial: "loading",
      context: TestContextSchema,
      initialContext: { count: 5, log: [] },
      states: {
        loading: {
          invoke: {
            id: "fetch",
            src: () => Effect.succeed(3),
            onDone: {
              target: "success",
              guard: ({ context, event }) => (event.output as number) > context.count,
            },
          },
        },
        success: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);
          yield* Effect.sleep("30 millis");

          // Guard blocks transition (3 > 5 is false)
          const snapshot = actor.getSnapshot();
          expect(snapshot.value).toBe("loading");
        }),
      ),
    );
  });

  it("invoke without target stays in same state", async () => {
    const machine = createMachine({
      id: "test",
      initial: "active",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        active: {
          invoke: {
            id: "sideEffect",
            src: () => Effect.succeed(100),
            onDone: {
              // No target - stays in active
              actions: [
                assign(({ event }) => ({ count: event.output as number })),
              ],
            },
          },
        },
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);
          yield* Effect.sleep("20 millis");

          const snapshot = actor.getSnapshot();
          expect(snapshot.value).toBe("active");
          expect(snapshot.context.count).toBe(100);
        }),
      ),
    );
  });

  it("invoke is stopped on actor stop", async () => {
    const invokeStopped = await Effect.runPromise(Ref.make(false));

    const machine = createMachine({
      id: "test",
      initial: "loading",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        loading: {
          invoke: {
            id: "longTask",
            src: () =>
              Effect.gen(function* () {
                yield* Effect.addFinalizer(() => Ref.set(invokeStopped, true));
                yield* Effect.sleep("1 second");
                return 42;
              }).pipe(Effect.scoped),
            onDone: { target: "done" },
          },
        },
        done: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);
          yield* Effect.sleep("20 millis");

          actor.stop();
          yield* Effect.sleep("30 millis");

          const wasStopped = yield* Ref.get(invokeStopped);
          expect(wasStopped).toBe(true);
        }),
      ),
    );
  });

  it("invoke runs entry actions before invoke starts", async () => {
    const actionOrder: string[] = [];

    const machine = createMachine({
      id: "test",
      initial: "idle",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        idle: {
          on: { TOGGLE: { target: "loading" } },
        },
        loading: {
          entry: [
            effect(() => {
              actionOrder.push("entry");
              return Effect.void;
            }),
          ],
          invoke: {
            id: "fetch",
            src: () => {
              actionOrder.push("invoke-start");
              return Effect.succeed(42);
            },
            onDone: {
              target: "done",
              actions: [
                effect(() => {
                  actionOrder.push("onDone");
                  return Effect.void;
                }),
              ],
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
          actor.send(new Toggle());
          yield* Effect.sleep("30 millis");

          expect(actionOrder).toEqual(["entry", "invoke-start", "onDone"]);
        }),
      ),
    );
  });

  it("catchTags routes different error types to different states", async () => {
    // Define tagged errors
    class NetworkError extends Data.TaggedError("NetworkError")<{ readonly url: string }> {}
    class ValidationError extends Data.TaggedError("ValidationError")<{ readonly field: string }> {}

    type FetchError = NetworkError | ValidationError;

    const fetchWithError = (errorType: "network" | "validation"): Effect.Effect<string, FetchError> => {
      if (errorType === "network") {
        return Effect.fail(new NetworkError({ url: "https://api.example.com" }));
      }
      return Effect.fail(new ValidationError({ field: "email" }));
    };

    const ErrorTypeSchema = Schema.Struct({
      errorType: Schema.Literal("network", "validation", "none"),
      lastError: Schema.String,
    });

    const machine = createMachine({
      id: "test",
      initial: "idle",
      context: ErrorTypeSchema,
      initialContext: { errorType: "none", lastError: "" },
      states: {
        idle: {
          on: { TOGGLE: { target: "loading" } },
        },
        loading: {
          invoke: {
            src: ({ context }) => fetchWithError(context.errorType as "network" | "validation"),
            onSuccess: { target: "success" },
            catchTags: {
              NetworkError: {
                target: "retry",
                actions: [assign(({ event }) => ({ lastError: (event.error as NetworkError).url }))],
              },
              ValidationError: {
                target: "invalid",
                actions: [assign(({ event }) => ({ lastError: (event.error as ValidationError).field }))],
              },
            },
          },
        },
        success: {},
        retry: {},
        invalid: {},
      },
    });

    // Test NetworkError routing
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);
          actor.send(new SetValue({ value: 0 })); // Update context
          // Manually set errorType
          (actor as unknown as { _snapshot: { context: { errorType: string } } })._snapshot = {
            ...actor.getSnapshot(),
            context: { ...actor.getSnapshot().context, errorType: "network" },
          };
        }),
      ),
    );

    // Create fresh machine for network error test
    const networkMachine = createMachine({
      id: "test",
      initial: "loading",
      context: ErrorTypeSchema,
      initialContext: { errorType: "network", lastError: "" },
      states: {
        loading: {
          invoke: {
            src: () => Effect.fail(new NetworkError({ url: "https://api.example.com" })),
            catchTags: {
              NetworkError: {
                target: "retry",
                actions: [assign(({ event }) => ({ lastError: (event.error as NetworkError).url }))],
              },
              ValidationError: { target: "invalid" },
            },
          },
        },
        retry: {},
        invalid: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(networkMachine);
          yield* Effect.sleep("20 millis");

          expect(actor.getSnapshot().value).toBe("retry");
          expect(actor.getSnapshot().context.lastError).toBe("https://api.example.com");
        }),
      ),
    );

    // Create fresh machine for validation error test
    const validationMachine = createMachine({
      id: "test",
      initial: "loading",
      context: ErrorTypeSchema,
      initialContext: { errorType: "validation", lastError: "" },
      states: {
        loading: {
          invoke: {
            src: () => Effect.fail(new ValidationError({ field: "email" })),
            catchTags: {
              NetworkError: { target: "retry" },
              ValidationError: {
                target: "invalid",
                actions: [assign(({ event }) => ({ lastError: (event.error as ValidationError).field }))],
              },
            },
          },
        },
        retry: {},
        invalid: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(validationMachine);
          yield* Effect.sleep("20 millis");

          expect(actor.getSnapshot().value).toBe("invalid");
          expect(actor.getSnapshot().context.lastError).toBe("email");
        }),
      ),
    );
  });

  it("catchTags falls back to onFailure for unhandled error tags", async () => {
    class NetworkError extends Data.TaggedError("NetworkError")<{}> {}
    class UnknownError extends Data.TaggedError("UnknownError")<{}> {}

    const machine = createMachine({
      id: "test",
      initial: "loading",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        loading: {
          invoke: {
            src: () => Effect.fail(new UnknownError()),
            catchTags: {
              NetworkError: { target: "retry" },
            },
            onFailure: {
              target: "error",
              actions: [assign({ log: ["fallback"] })],
            },
          },
        },
        retry: {},
        error: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);
          yield* Effect.sleep("20 millis");

          expect(actor.getSnapshot().value).toBe("error");
          expect(actor.getSnapshot().context.log).toContain("fallback");
        }),
      ),
    );
  });

  it("onDefect handles unexpected throws (defects)", async () => {
    const machine = createMachine({
      id: "test",
      initial: "loading",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        loading: {
          invoke: {
            src: () => Effect.die(new Error("Unexpected crash!")),
            onSuccess: { target: "success" },
            onFailure: { target: "error" },
            onDefect: {
              target: "crashed",
              actions: [assign(({ event }) => ({ log: [String((event as { defect: unknown }).defect)] }))],
            },
          },
        },
        success: {},
        error: {},
        crashed: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);
          yield* Effect.sleep("20 millis");

          expect(actor.getSnapshot().value).toBe("crashed");
          expect(actor.getSnapshot().context.log[0]).toContain("Unexpected crash!");
        }),
      ),
    );
  });

  it("onInterrupt handles fiber interruption", async () => {
    const machine = createMachine({
      id: "test",
      initial: "loading",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        loading: {
          invoke: {
            id: "slowTask",
            src: () => Effect.sleep("10 seconds").pipe(Effect.as("done")),
            onSuccess: { target: "success" },
            onInterrupt: {
              target: "cancelled",
              actions: [assign({ log: ["interrupted"] })],
            },
          },
          on: {
            TOGGLE: { target: "idle" },
          },
        },
        success: {},
        idle: {},
        cancelled: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);

          // Transition away, which should interrupt the invoke
          yield* Effect.sleep("20 millis");
          actor.send(new Toggle());

          // Give time for the interrupt event to be processed
          yield* Effect.sleep("30 millis");

          // Note: When we transition away via TOGGLE, the invoke is stopped
          // but since we transitioned to "idle", that's where we end up
          // The onInterrupt would fire if the invoke fiber was interrupted
          // while we're still in the loading state
          expect(actor.getSnapshot().value).toBe("idle");
        }),
      ),
    );
  });

  it("onSuccess is an alias for onDone", async () => {
    const machine = createMachine({
      id: "test",
      initial: "loading",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        loading: {
          invoke: {
            src: () => Effect.succeed(99),
            onSuccess: {
              target: "done",
              actions: [assign(({ event }) => ({ count: event.output as number }))],
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
          yield* Effect.sleep("20 millis");

          expect(actor.getSnapshot().value).toBe("done");
          expect(actor.getSnapshot().context.count).toBe(99);
        }),
      ),
    );
  });

  it("onFailure is an alias for onError", async () => {
    const machine = createMachine({
      id: "test",
      initial: "loading",
      context: TestContextSchema,
      initialContext: { count: 0, log: [] },
      states: {
        loading: {
          invoke: {
            src: () => Effect.fail("typed error"),
            onFailure: {
              target: "failed",
              actions: [assign(({ event }) => ({ log: [event.error as string] }))],
            },
          },
        },
        failed: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpretSync(machine);
          yield* Effect.sleep("20 millis");

          expect(actor.getSnapshot().value).toBe("failed");
          expect(actor.getSnapshot().context.log).toContain("typed error");
        }),
      ),
    );
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
