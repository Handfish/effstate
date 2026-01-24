/**
 * EffState v4 Machine Definition
 *
 * PhD-level type safety:
 * - Full R (Requirements) channel - effects can require services
 * - Full E (Error) channel - errors are tracked, not swallowed
 * - Proper Effect composition
 */

import { Cause, Effect, Fiber, Runtime, Stream } from "effect";
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
// Internal Helpers (with proper typing)
// ============================================================================

/**
 * Call an event handler with proper typing.
 *
 * The handler lookup by event._tag guarantees type alignment,
 * making this cast sound.
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
  const handler = handlers[event._tag as E["_tag"]];
  if (!handler) return null;

  // Sound cast: we looked up handler by event._tag, so types align
  type Handler = (ctx: C, event: E) => Transition<S, C>;
  return (handler as Handler)(ctx, event);
}

/**
 * Narrow a state to a specific variant.
 *
 * Sound because we verify state._tag === tag before calling.
 */
function narrowState<S extends MachineState, K extends S["_tag"]>(
  state: S,
  _expectedTag: K
): StateByTag<S, K> {
  // Sound: caller guarantees state._tag === _expectedTag
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
 * @typeParam R - Requirements for entry/exit/run effects (default: never)
 * @typeParam Err - Error type for effects (default: never)
 *
 * @example
 * ```ts
 * // Simple machine (no requirements)
 * const machine = defineMachine<MyState, MyContext, MyEvent>({
 *   id: "simple",
 *   initialState: Idle.make(),
 *   initialContext: { count: 0 },
 *   states: { ... }
 * });
 *
 * // Machine with service requirements
 * const machine = defineMachine<MyState, MyContext, MyEvent, Logger, never>({
 *   id: "with-logger",
 *   initialState: Idle.make(),
 *   initialContext: { count: 0 },
 *   states: {
 *     Idle: {
 *       entry: (state, ctx) => Effect.gen(function* () {
 *         const logger = yield* Logger;
 *         yield* logger.info("Entered Idle");
 *       }),
 *       on: { ... }
 *     }
 *   }
 * });
 * ```
 */
export function defineMachine<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
  R = never,
  Err = never,
>(config: MachineConfig<S, C, E, R, Err>): MachineDefinition<S, C, E, R, Err> {
  return {
    id: config.id,
    config,
    contextSchema: config.context,
    interpret: (options) => interpret(config, options),
  };
}

// ============================================================================
// Interpret (with R channel support)
// ============================================================================

/**
 * Create and run a machine actor.
 *
 * Returns an Effect that requires R (for entry/exit/run effects).
 */
function interpret<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
  R,
  Err,
>(
  config: MachineConfig<S, C, E, R, Err>,
  options?: { snapshot?: MachineSnapshot<S, C> }
): Effect.Effect<MachineActor<S, C, E>, Err, R> {
  return Effect.gen(function* () {
    // Get runtime for forking effects with proper R context
    const runtime = yield* Effect.runtime<R>();

    // Current snapshot (mutable)
    let snapshot: MachineSnapshot<S, C> = options?.snapshot ?? {
      state: config.initialState,
      context: config.initialContext,
    };

    // Subscribers
    const subscribers = new Set<(snap: MachineSnapshot<S, C>) => void>();

    // Active stream fiber
    let runFiber: Fiber.RuntimeFiber<void, Err> | null = null;

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
     * Run an effect with proper error handling.
     * Errors are logged but don't crash the machine.
     */
    const runEffect = (effect: Effect.Effect<void, Err, R>, description: string) => {
      const program = effect.pipe(
        Effect.catchAllCause((cause) =>
          Effect.logError(`EffState: ${description} failed`, Cause.pretty(cause))
        )
      );
      Runtime.runFork(runtime)(program);
    };

    /**
     * Start a stream and return its fiber.
     */
    const runStream = (stream: Stream.Stream<E, Err, R>): Fiber.RuntimeFiber<void, Err> => {
      const program = Stream.runForEach(stream, (event) =>
        Effect.sync(() => processEvent(event))
      ).pipe(
        Effect.catchAllCause((cause) =>
          Effect.logError("EffState: run stream failed", Cause.pretty(cause))
        )
      );
      return Runtime.runFork(runtime)(program);
    };

    // Handle exiting a state
    const exitState = (stateTag: S["_tag"]) => {
      const stateConfig = config.states[stateTag];

      // Run exit effect
      if (stateConfig?.exit) {
        runEffect(
          stateConfig.exit(narrowState(snapshot.state, stateTag), snapshot.context),
          `exit(${stateTag})`
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
          `entry(${stateTag})`
        );
      }

      // Start run stream
      if (stateConfig?.run) {
        const stream = typeof stateConfig.run === "function"
          ? stateConfig.run(snapshot)
          : stateConfig.run;
        runFiber = runStream(stream);
      }
    };

    // Apply a transition
    const applyTransition = (transition: Transition<S, C>) => {
      if (transition === null) return;

      // State transition (goto)
      if (hasGoto(transition)) {
        const oldStateTag = snapshot.state._tag as S["_tag"];
        const newStateTag = transition.goto._tag as S["_tag"];

        // Exit old state if changing
        if (oldStateTag !== newStateTag) {
          exitState(oldStateTag);
        }

        // Update snapshot
        snapshot = {
          state: transition.goto,
          context: transition.update
            ? { ...snapshot.context, ...transition.update }
            : snapshot.context,
        };
        notify();

        // Run transition actions
        runActions(transition);

        // Enter new state if changing
        if (oldStateTag !== newStateTag) {
          enterState(newStateTag);
        }
        return;
      }

      // Update only (stay in current state)
      if ("update" in transition) {
        snapshot = {
          ...snapshot,
          context: { ...snapshot.context, ...transition.update },
        };
        notify();
        runActions(transition);
        return;
      }

      // Actions only
      if ("actions" in transition) {
        runActions(transition);
      }
    };

    // Process an event
    const processEvent = (event: E) => {
      const stateTag = snapshot.state._tag as S["_tag"];

      // Try state handlers first
      const stateConfig = config.states[stateTag];
      const stateResult = callHandler(stateConfig.on, snapshot.context, event);
      if (stateResult !== null) {
        applyTransition(stateResult);
        return;
      }

      // Fall back to global handlers
      if (config.global) {
        const globalResult = callHandler(config.global, snapshot.context, event);
        if (globalResult !== null) {
          applyTransition(globalResult);
        }
      }
      // No handler = implicit stay
    };

    // Initialize: run entry for initial state
    const initialStateTag = snapshot.state._tag as S["_tag"];
    enterState(initialStateTag);

    // Build and return actor
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

        // Handle exit if state changed
        if (oldStateTag !== newStateTag) {
          exitState(oldStateTag);
        }

        // Update snapshot
        snapshot = newSnapshot;
        notify();

        // Handle entry if state changed
        if (oldStateTag !== newStateTag) {
          enterState(newStateTag);
        }
      },
    };

    return actor;
  });
}

export { defineMachine as define };
