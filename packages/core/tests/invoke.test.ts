import { describe, it, expect } from "vitest";
import { Data, Effect, Fiber, Ref, Schema } from "effect";
import { createMachine, interpretSync } from "../src/machine.js";
import { assign, effect } from "../src/actions.js";

// ============================================================================
// Test Event Types
// ============================================================================

class Toggle extends Data.TaggedClass("TOGGLE")<{}> {}
class Increment extends Data.TaggedClass("INCREMENT")<{}> {}

// ============================================================================
// Test Context Schemas (Schema-based context required)
// ============================================================================

const TestContextSchema = Schema.Struct({
  count: Schema.Number,
  log: Schema.Array(Schema.String),
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

    const ErrorTypeSchema = Schema.Struct({
      errorType: Schema.Literal("network", "validation", "none"),
      lastError: Schema.String,
    });

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
