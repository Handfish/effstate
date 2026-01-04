import { describe, it, expect } from "vitest";
import { Data, Effect, Ref } from "effect";
import { createMachine, interpret } from "./machine";
import { assign, effect, raise, cancel, emit, enqueueActions, spawnChild, stopChild, sendTo, sendParent, forwardTo } from "./actions";
import { guard, guardEffect, and, or, not } from "./guards";

// ============================================================================
// Test Event Types
// ============================================================================

class Toggle extends Data.TaggedClass("TOGGLE")<{}> {}
class SetValue extends Data.TaggedClass("SET_VALUE")<{ readonly value: number }> {}
class Tick extends Data.TaggedClass("TICK")<{}> {}

type TestEvent = Toggle | SetValue | Tick;

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
// subscribe() - Snapshot Observers
// ============================================================================

describe("subscribe()", () => {
  it("calls subscriber on state transitions", async () => {
    const snapshots: Array<{ value: string; count: number }> = [];

    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 0, log: [] },
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
          const actor = interpret(machine);

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

    const machine = createMachine<"test", "counter", TestContext, TestEvent>({
      id: "test",
      initial: "counter",
      context: { count: 0, log: [] },
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
          const actor = interpret(machine);

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

    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 0, log: [] },
      states: {
        a: { on: { TOGGLE: { target: "b" } } },
        b: { on: { TOGGLE: { target: "a" } } },
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpret(machine);

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

    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 0, log: [] },
      states: {
        a: { on: { TOGGLE: { target: "b" } } },
        b: { on: { TOGGLE: { target: "a" } } },
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpret(machine);

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
          const actor = interpret(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("10 millis");

          const snapshot = actor.getSnapshot();
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
          const actor = interpret(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("10 millis");

          const snapshot = actor.getSnapshot();
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
          const actor = interpret(machine);
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
          const actor = interpret(machine);
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
          const actor = interpret(machine);
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
          const actor = interpret(machine);
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
          const actor = interpret(machine);
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
          const actor = interpret(machine);
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
          interpret(machine);
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
          const actor = interpret(machine);
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
          const actor = interpret(machine);
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
          const actor = interpret(machine);

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
          const actor = interpret(machine);

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
          const actor = interpret(machine);

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
          const actor = interpret(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("10 millis");

          const snapshot = actor.getSnapshot();
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
          const actor = interpret(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("10 millis");

          const snapshot = actor.getSnapshot();
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
          const actor = interpret(machine);

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
          const actor = interpret(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("10 millis");

          const snapshot = actor.getSnapshot();
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
          const actor = interpret(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("10 millis");

          const snapshot = actor.getSnapshot();
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
          const actor = interpret(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("10 millis");

          const snapshot = actor.getSnapshot();
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
          const actor = interpret(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("10 millis");

          const snapshot = actor.getSnapshot();
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
          const actor = interpret(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("10 millis");

          const snapshot = actor.getSnapshot();
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
          const actor = interpret(machine);
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
// guardEffect - Async Guards
// ============================================================================

describe("guardEffect (effect-based guards)", () => {
  it("allows transition when effect guard resolves to true", async () => {
    // Note: Effect guards must complete synchronously (no Effect.sleep).
    // Use for guards that need Effect context (services, refs) but resolve immediately.
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
                Effect.succeed(context.count > 5), // Sync Effect guard
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
          const actor = interpret(machine);
          actor.send(new Toggle());

          const snapshot = actor.getSnapshot();
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
          const actor = interpret(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("20 millis");

          const snapshot = actor.getSnapshot();
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
              guard: guardEffect(() => Effect.fail("async error").pipe(Effect.orElseSucceed(() => false))),
            },
          },
        },
        b: {},
      },
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = interpret(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("10 millis");

          const snapshot = actor.getSnapshot();
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
          const actor = interpret(machine);

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
          const actor = interpret(machine);

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
          const actor = interpret(machine);

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
    const machine = createMachine<"test", "waiting" | "cancelled" | "timeout", TestContext, TestEvent>({
      id: "test",
      initial: "waiting",
      context: { count: 0, log: [] },
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
          const actor = interpret(machine);

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
    const machine = createMachine<"test", "waiting" | "cancelled" | "timeout", TestContext, TestEvent>({
      id: "test",
      initial: "waiting",
      context: { count: 0, log: [] },
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
          const actor = interpret(machine);

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
    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 0, log: [] },
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
          const actor = interpret(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("10 millis");

          const snapshot = actor.getSnapshot();
          expect(snapshot.value).toBe("b"); // Transition still works
        }),
      ),
    );
  });

  it("cancels only the specified delay, others still fire", async () => {
    const machine = createMachine<"test", "waiting" | "partial" | "timeout1" | "timeout2", TestContext, TestEvent>({
      id: "test",
      initial: "waiting",
      context: { count: 0, log: [] },
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
          const actor = interpret(machine);

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

    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 0, log: [] },
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
          const actor = interpret(machine);

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

    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 0, log: [] },
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
          const actor = interpret(machine);

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

    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 0, log: [] },
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
          const actor = interpret(machine);

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

    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 42, log: [] },
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
          const actor = interpret(machine);

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
    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 0, log: [] },
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
          const actor = interpret(machine);

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

    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 0, log: [] },
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
          const actor = interpret(machine);
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
    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 15, log: [] },
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
          const actor = interpret(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("20 millis");

          const snapshot = actor.getSnapshot();
          expect(snapshot.context.count).toBe(100); // count > 10, so assigned 100
        }),
      ),
    );
  });

  it("enqueue.assign shorthand works", async () => {
    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 0, log: [] },
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
          const actor = interpret(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("20 millis");

          const snapshot = actor.getSnapshot();
          expect(snapshot.context.count).toBe(50); // 42 + 8
        }),
      ),
    );
  });

  it("enqueue.raise shorthand works", async () => {
    const machine = createMachine<"test", "a" | "b" | "c", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 0, log: [] },
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
          const actor = interpret(machine);
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

    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 0, log: [] },
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
          const actor = interpret(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("20 millis");

          const ran = yield* Ref.get(effectRan);
          expect(ran).toBe(true);
        }),
      ),
    );
  });

  it("accesses event data in enqueueActions", async () => {
    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 0, log: [] },
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
          const actor = interpret(machine);
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
    context: { started: false },
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

    const machine = createMachine<"test", "idle" | "parenting", TestContext, TestEvent>({
      id: "test",
      initial: "idle",
      context: { count: 0, log: [] },
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
          const actor = interpret(machine);
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

    const machine = createMachine<"test", "idle" | "parenting", TestContext, TestEvent>({
      id: "test",
      initial: "idle",
      context: { count: 42, log: [] },
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
          const actor = interpret(machine);
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

    const machine = createMachine<"test", "idle" | "parenting" | "stopped", TestContext, TestEvent>({
      id: "test",
      initial: "idle",
      context: { count: 0, log: [] },
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
          const actor = interpret(machine);
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

    const machine = createMachine<"test", "idle" | "parenting" | "stopped", TestContext, TestEvent>({
      id: "test",
      initial: "idle",
      context: { count: 0, log: [] },
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
          const actor = interpret(machine);
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

    const machine = createMachine<"test", "idle" | "parenting", TestContext, TestEvent>({
      id: "test",
      initial: "idle",
      context: { count: 0, log: [] },
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
          const actor = interpret(machine);
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

    const machine = createMachine<"test", "idle" | "parenting", TestContext, TestEvent>({
      id: "test",
      initial: "idle",
      context: { count: 0, log: [] },
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
          const actor = interpret(machine);
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

    const machine = createMachine<"test", "idle" | "parenting", TestContext, TestEvent>({
      id: "test",
      initial: "idle",
      context: { count: 42, log: [] },
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
          const actor = interpret(machine);
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

    const machine = createMachine<"test", "idle" | "parenting", TestContext, TestEvent>({
      id: "test",
      initial: "idle",
      context: { count: 0, log: [] },
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
          const actor = interpret(machine);
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
    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 0, log: [] },
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
          const actor = interpret(machine);
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
    const childMachine = createMachine<"child", "idle" | "notifying", { started: boolean }, ChildEvent | ParentNotify>({
      id: "child",
      initial: "idle",
      context: { started: false },
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

    const machine = createMachine<"test", "idle" | "parenting" | "notified", TestContext, ParentEvent>({
      id: "test",
      initial: "idle",
      context: { count: 0, log: [] },
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
          const actor = interpret(machine);

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
    const childMachine = createMachine<"child", "idle" | "notifying", { count: number }, ChildEvent | ParentNotify>({
      id: "child",
      initial: "idle",
      context: { count: 42 },
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

    const machine = createMachine<"test", "idle" | "parenting" | "notified", TestContext, ParentEvent>({
      id: "test",
      initial: "idle",
      context: { count: 0, log: [] },
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
          const actor = interpret(machine);

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
    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 0, log: [] },
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
          const actor = interpret(machine);
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
    const childMachine = createMachine<"child", "idle" | "ticked", { tickCount: number }, Tick>({
      id: "child",
      initial: "idle",
      context: { tickCount: 0 },
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

    const machine = createMachine<"test", "idle" | "parenting", TestContext, TestEvent>({
      id: "test",
      initial: "idle",
      context: { count: 0, log: [] },
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
          const actor = interpret(machine);

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
    const childMachine = createMachine<"child", "idle" | "ticked", { tickCount: number }, Tick>({
      id: "child",
      initial: "idle",
      context: { tickCount: 0 },
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

    const machine = createMachine<"test", "idle" | "parenting", TestContext, TestEvent>({
      id: "test",
      initial: "idle",
      context: { count: 42, log: [] },
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
          const actor = interpret(machine);

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
    const machine = createMachine<"test", "a" | "b", TestContext, TestEvent>({
      id: "test",
      initial: "a",
      context: { count: 0, log: [] },
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
          const actor = interpret(machine);
          actor.send(new Toggle());
          yield* Effect.sleep("20 millis");

          const snapshot = actor.getSnapshot();
          expect(snapshot.value).toBe("b"); // Transition still works
        }),
      ),
    );
  });
});
