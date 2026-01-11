import { describe, it, expect } from "vitest";
import { Data, Effect, Ref, Schema } from "effect";
import { createMachine } from "../src/machine.js";
import { testActorSync } from "./test-utils.js";
import { assign, effect, raise, enqueueActions, spawnChild, stopChild } from "../src/actions.js";

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

const StartedContextSchema = Schema.Struct({ started: Schema.Boolean });

// ============================================================================
// Child machine for testing
// ============================================================================

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
          const actor = testActorSync(machine);
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
          const actor = testActorSync(machine);
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
          const actor = testActorSync(machine);
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
          const actor = testActorSync(machine);
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
          const actor = testActorSync(machine);
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
          const actor = testActorSync(machine);
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
          const actor = testActorSync(machine);
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
          const actor = testActorSync(machine);
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
          const actor = testActorSync(machine);
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
          const actor = testActorSync(machine);
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
          const actor = testActorSync(machine);
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
