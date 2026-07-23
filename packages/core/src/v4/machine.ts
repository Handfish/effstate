/**
 * EffState v4 Machine Definition
 *
 * PhD-level type safety:
 * - Full R (Requirements) channel - effects can require services
 * - Honest error handling - errors propagate, not swallowed
 * - Proper Effect composition
 */

import { Cause, Effect, Fiber, Queue, Runtime, Stream } from "effect";
import type {
  MachineState,
  MachineContext,
  MachineEvent,
  MachineConfig,
  MachineDefinition,
  MachineSnapshot,
  MachineActor,
  Transition,
  EventHandlers,
  StateByTag,
} from "./types";

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Call an event handler with proper typing.
 *
 * The casts here are unavoidable due to TypeScript's "correlated union" limitation:
 * TypeScript can't express that `handlers[event._tag]` returns a handler specifically
 * typed for `event`. This is a known limitation (see TypeScript #30581).
 *
 * Soundness argument:
 * - handlers has type { [K in E["_tag"]]?: EventHandler<S, C, EventByTag<E, K>> }
 * - event._tag is one of E["_tag"] union members
 * - Therefore handlers[event._tag] returns EventHandler<S, C, EventByTag<E, typeof event._tag>>
 * - Since event: E and event._tag matches, event IS EventByTag<E, typeof event._tag>
 * - The cast from EventHandler<S, C, EventByTag<E, K>> to (ctx: C, event: E) => ... is sound
 */
function callHandler<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
>(
  handlers: EventHandlers<S, C, E>,
  ctx: C,
  event: E
): Transition<S, C> | null {
  // Cast 1: event._tag is string at runtime, but we know it's E["_tag"]
  const handler = handlers[event._tag as E["_tag"]];
  if (!handler) return null;
  // Cast 2: handler is for EventByTag<E, K>, event is E, but they're the same
  type Handler = (ctx: C, event: E) => Transition<S, C>;
  return (handler as Handler)(ctx, event);
}

/**
 * Narrow a state to a specific variant.
 *
 * This cast is necessary because TypeScript can't narrow a generic S to StateByTag<S, K>
 * even when we've verified state._tag === expectedTag at runtime.
 *
 * Soundness argument:
 * - Caller verifies state._tag === expectedTag before calling
 * - StateByTag<S, K> = Extract<S, { _tag: K }>
 * - Since state._tag === expectedTag === K, state IS StateByTag<S, K>
 * - The cast is just telling TypeScript what we've verified at runtime
 *
 * Note: _expectedTag parameter exists only for type inference, not used at runtime.
 */
function narrowState<S extends MachineState, K extends S["_tag"]>(
  state: S,
  _expectedTag: K
): StateByTag<S, K> {
  return state as StateByTag<S, K>;
}

// ============================================================================
// Machine Definition
// ============================================================================

/**
 * Define a state machine with full type safety.
 *
 * @typeParam S - State discriminated union
 * @typeParam C - Context type
 * @typeParam E - Event discriminated union
 * @typeParam R - Requirements for entry/exit/run effects
 *
 * Note: Error handling is honest. If entry/exit/run effects can fail,
 * those errors will be reported via the onError callback. The machine
 * itself returns Effect<MachineActor, never, R> because actor creation
 * cannot fail - only the effects running inside can.
 */
export function defineMachine<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
  R = never,
>(config: MachineConfig<S, C, E, R>): MachineDefinition<S, C, E, R> {
  return {
    id: config.id,
    config,
    contextSchema: config.context,
    interpret: (options) => interpret(config, options),
  };
}

// ============================================================================
// Interpret
// ============================================================================

/**
 * Error reported when an entry/exit/run effect fails.
 */
export interface MachineEffectError<Err> {
  readonly _tag: "MachineEffectError";
  readonly effectType: "entry" | "exit" | "run";
  readonly stateTag: string;
  readonly cause: Cause.Cause<Err>;
}

/**
 * Options for interpreting a machine.
 */
export interface InterpretOptions<S extends MachineState, C extends MachineContext, Err> {
  /** Initial snapshot to restore from */
  readonly snapshot?: MachineSnapshot<S, C>;

  /**
   * Error handler for entry/exit/run effect failures.
   *
   * If not provided, errors are logged to Effect's default logger.
   * If provided, you can handle errors however you want (log, report, etc.)
   *
   * This is the honest approach: errors happen, you decide what to do.
   */
  readonly onError?: (error: MachineEffectError<Err>) => void;
}

function interpret<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
  R,
  Err,
>(
  config: MachineConfig<S, C, E, R, Err>,
  options?: InterpretOptions<S, C, Err>
): Effect.Effect<MachineActor<S, C, E>, never, R> {
  return Effect.gen(function* () {
    // Get runtime for forking effects with proper R context
    const runtime = yield* Effect.runtime<R>();

    // Error handler
    const handleError = (effectType: "entry" | "exit" | "run", stateTag: string, cause: Cause.Cause<Err>) => {
      const error: MachineEffectError<Err> = {
        _tag: "MachineEffectError",
        effectType,
        stateTag,
        cause,
      };

      if (options?.onError) {
        options.onError(error);
      } else {
        // Default: log to console
        // Note: We use console.error here instead of Effect.logError because:
        // 1. handleError is called from forked fibers, outside the main Effect.gen
        // 2. Using Effect.logError would require another runFork just for logging
        // 3. Users who want Effect-based logging can provide their own onError
        console.error(`EffState: ${effectType}(${stateTag}) failed:`, Cause.pretty(cause));
      }
    };

    // Internal mutable state
    //
    // Design decision: Why `let` instead of `Ref`?
    //
    // A fully pure implementation would use:
    //   const snapshotRef = yield* Ref.make(initialSnapshot)
    //   const subscribersRef = yield* SubscriptionRef.make(...)
    //   const fiberRef = yield* Ref.make<Option<Fiber>>(Option.none())
    //
    // We chose mutable variables because:
    // 1. All mutations happen within the actor's closure - no external access
    // 2. The MachineActor interface is already imperative (see design note above)
    // 3. Using Refs would require Effect composition for every state access
    // 4. Performance: direct mutation is faster than Ref.get/Ref.set
    //
    // The trade-off: internal implementation is imperative, but the boundaries
    // (interpret requiring R, entry/exit/run being Effects) maintain purity
    // where it matters for composition and testing.
    let snapshot: MachineSnapshot<S, C> = options?.snapshot ?? {
      state: config.initialState,
      context: config.initialContext,
    };
    const subscribers = new Set<(snap: MachineSnapshot<S, C>) => void>();
    let runFiber: Fiber.RuntimeFiber<void, never> | null = null;

    // Notify all subscribers
    const notify = () => {
      for (const sub of subscribers) {
        sub(snapshot);
      }
    };

    // Check if transition has goto
    const hasGoto = (
      t: NonNullable<Transition<S, C>>
    ): t is { readonly goto: S; readonly update?: Partial<C>; readonly actions?: readonly (() => void)[] } =>
      "goto" in t;

    // Run transition actions
    const runActions = (transition: NonNullable<Transition<S, C>>) => {
      if ("actions" in transition && transition.actions) {
        for (const action of transition.actions) {
          action();
        }
      }
    };

    /**
     * Run an effect and handle errors honestly.
     *
     * Errors are caught and reported via handleError, but the effect
     * completes (with void) so the machine can continue operating.
     * This is a design choice: effects failing shouldn't crash the machine.
     */
    const runEffect = (
      effect: Effect.Effect<void, Err, R>,
      effectType: "entry" | "exit",
      stateTag: string
    ) => {
      const program = effect.pipe(
        Effect.catchAllCause((cause) =>
          Effect.sync(() => handleError(effectType, stateTag, cause))
        )
      );
      // Fork returns Fiber<void, never> because we caught all errors
      Runtime.runFork(runtime)(program);
    };

    /**
     * Start a stream and return its fiber.
     *
     * Stream errors are reported via handleError.
     */
    const runStream = (stream: Stream.Stream<E, Err, R>, stateTag: string): Fiber.RuntimeFiber<void, never> => {
      const program = Stream.runForEach(stream, (event) =>
        Effect.sync(() => processEvent(event))
      ).pipe(
        Effect.catchAllCause((cause) =>
          Effect.sync(() => handleError("run", stateTag, cause))
        )
      );
      // After catchAllCause, error type is never - this is honest
      return Runtime.runFork(runtime)(program);
    };

    // Handle exiting a state
    const exitState = (stateTag: S["_tag"]) => {
      const stateConfig = config.states[stateTag];

      // Run exit effect
      if (stateConfig?.exit) {
        runEffect(
          stateConfig.exit(narrowState(snapshot.state, stateTag), snapshot.context),
          "exit",
          stateTag
        );
      }

      // Cancel running stream
      if (runFiber) {
        Runtime.runFork(runtime)(Fiber.interrupt(runFiber));
        runFiber = null;
      }
    };

    // Handle entering a state
    const enterState = (stateTag: S["_tag"]) => {
      const stateConfig = config.states[stateTag];

      // Run entry effect
      if (stateConfig?.entry) {
        runEffect(
          stateConfig.entry(narrowState(snapshot.state, stateTag), snapshot.context),
          "entry",
          stateTag
        );
      }

      // Start run stream
      if (stateConfig?.run) {
        const stream = typeof stateConfig.run === "function"
          ? stateConfig.run(snapshot)
          : stateConfig.run;
        // runStream returns Fiber<void, never> - honest type (errors caught before fork)
        runFiber = runStream(stream, stateTag);
      }
    };

    // Apply a transition
    const applyTransition = (transition: Transition<S, C>) => {
      if (transition === null) return;

      if (hasGoto(transition)) {
        const oldStateTag = snapshot.state._tag as S["_tag"];
        const newStateTag = transition.goto._tag as S["_tag"];

        if (oldStateTag !== newStateTag) {
          exitState(oldStateTag);
        }

        snapshot = {
          state: transition.goto,
          context: transition.update
            ? { ...snapshot.context, ...transition.update }
            : snapshot.context,
        };
        notify();
        runActions(transition);

        if (oldStateTag !== newStateTag) {
          enterState(newStateTag);
        }
        return;
      }

      if ("update" in transition) {
        snapshot = {
          ...snapshot,
          context: { ...snapshot.context, ...transition.update },
        };
        notify();
        runActions(transition);
        return;
      }

      if ("actions" in transition) {
        runActions(transition);
      }
    };

    // Process an event
    const processEvent = (event: E) => {
      const stateTag = snapshot.state._tag as S["_tag"];
      const stateConfig = config.states[stateTag];

      const stateResult = callHandler(stateConfig.on, snapshot.context, event);
      if (stateResult !== null) {
        applyTransition(stateResult);
        return;
      }

      if (config.global) {
        const globalResult = callHandler(config.global, snapshot.context, event);
        if (globalResult !== null) {
          applyTransition(globalResult);
        }
      }
    };

    // Initialize
    const initialStateTag = snapshot.state._tag as S["_tag"];
    enterState(initialStateTag);

    // Build actor
    const actor: MachineActor<S, C, E> = {
      send: processEvent,
      getSnapshot: () => snapshot,
      subscribe: (observer) => {
        subscribers.add(observer);
        return () => subscribers.delete(observer);
      },
      stop: () => {
        if (runFiber) {
          Runtime.runFork(runtime)(Fiber.interrupt(runFiber));
          runFiber = null;
        }
        subscribers.clear();
      },
      _syncSnapshot: (newSnapshot) => {
        const oldStateTag = snapshot.state._tag as S["_tag"];
        const newStateTag = newSnapshot.state._tag as S["_tag"];

        if (oldStateTag !== newStateTag) {
          exitState(oldStateTag);
        }

        snapshot = newSnapshot;
        notify();

        if (oldStateTag !== newStateTag) {
          enterState(newStateTag);
        }
      },
    };

    return actor;
  });
}

export { defineMachine as define };
