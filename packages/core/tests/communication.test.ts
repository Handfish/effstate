import { describe, it, expect } from "vitest";
import { Data, Effect, Schema } from "effect";
import { createMachine, interpretSync } from "../src/machine.js";
import { assign, effect, emit, spawnChild, sendTo, sendParent, forwardTo } from "../src/actions.js";

// ============================================================================
// Test Event Types
// ============================================================================

class Toggle extends Data.TaggedClass("TOGGLE")<{}> {}
class Tick extends Data.TaggedClass("TICK")<{}> {}

type TestEvent = Toggle | Tick;

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

// Child event types
class ChildStart extends Data.TaggedClass("CHILD_START")<{}> {}
class ChildDone extends Data.TaggedClass("CHILD_DONE")<{}> {}
type ChildEvent = ChildStart | ChildDone;

// Parent event types for testing parent communication
class ParentNotify extends Data.TaggedClass("PARENT_NOTIFY")<{ readonly message: string }> {}
type ParentEvent = TestEvent | ParentNotify;

// ============================================================================
// Test Context Schemas (Schema-based context required)
// ============================================================================

const TestContextSchema = Schema.Struct({
  count: Schema.Number,
  log: Schema.Array(Schema.String),
});
type TestContext = typeof TestContextSchema.Type;

const StartedContextSchema = Schema.Struct({ started: Schema.Boolean });
const CountOnlySchema = Schema.Struct({ count: Schema.Number });
const TickContextSchema = Schema.Struct({ tickCount: Schema.Number });

// ============================================================================
// Child machine for testing
// ============================================================================

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
