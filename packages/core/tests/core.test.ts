import { describe, it, expect } from "vitest";
import { Data, Effect, Schema } from "effect";
import { createMachine, interpretSync } from "../src/machine.js";
import { assign } from "../src/actions.js";

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
type TestContext = typeof TestContextSchema.Type;

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

          actor.send(new Toggle()); // a -> b
          actor.send(new Toggle()); // b -> a

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
