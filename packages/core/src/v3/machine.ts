/**
 * EffState v3 Machine Definition
 */

import { Effect, Fiber, Stream } from "effect";
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
} from "./types";

/**
 * Call an event handler with proper typing.
 * The cast is safe because we look up the handler by event._tag,
 * so the event type matches what the handler expects.
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
  // Safe cast: event._tag was used to look up handler, so types align
  return (handler as (ctx: C, event: E) => Transition<S, C>)(ctx, event);
}

/**
 * Define a state machine with the v3 API
 */
export function defineMachine<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
>(config: MachineConfig<S, C, E>): MachineDefinition<S, C, E> {
  return {
    id: config.id,
    config,
    contextSchema: config.context,
    interpret: (options) => interpret(config, options),
  };
}

/**
 * Interpret (run) a machine
 */
function interpret<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
>(
  config: MachineConfig<S, C, E>,
  options?: { snapshot?: MachineSnapshot<S, C> }
): Effect.Effect<MachineActor<S, C, E>> {
  return Effect.gen(function* () {
    // Current state
    let snapshot: MachineSnapshot<S, C> = options?.snapshot ?? {
      state: config.initialState,
      context: config.initialContext as C,
    };

    // Subscribers
    const subscribers = new Set<(snap: MachineSnapshot<S, C>) => void>();

    // Active stream fiber
    let runFiber: Fiber.RuntimeFiber<void, never> | null = null;

    // Notify subscribers
    const notify = () => {
      for (const sub of subscribers) {
        sub(snapshot);
      }
    };

    // Helper to check if transition has goto
    const hasGoto = (t: NonNullable<Transition<S, C>>): t is { readonly goto: S; readonly update?: Partial<C>; readonly actions?: readonly (() => void)[] } =>
      "goto" in t;

    // Run transition actions
    const runActions = (transition: NonNullable<Transition<S, C>>) => {
      if ("actions" in transition && transition.actions) {
        for (const action of transition.actions) {
          action();
        }
      }
    };

    // Apply a transition
    const applyTransition = (transition: Transition<S, C>) => {
      if (transition === null) {
        return;
      }

      // State transition
      if (hasGoto(transition)) {
        const oldStateTag = snapshot.state._tag;
        const newStateTag = transition.goto._tag;

        // Exit old state
        if (oldStateTag !== newStateTag) {
          const oldStateConfig = config.states[oldStateTag as S["_tag"]];

          // Run exit effect
          if (oldStateConfig?.exit) {
            Effect.runFork(oldStateConfig.exit(snapshot.state as any, snapshot.context));
          }

          // Cancel any running stream
          if (runFiber) {
            Effect.runFork(Fiber.interrupt(runFiber));
            runFiber = null;
          }
        }

        // Update state
        snapshot = {
          state: transition.goto,
          context: transition.update
            ? { ...snapshot.context, ...transition.update }
            : snapshot.context,
        };
        notify();

        // Run transition actions
        runActions(transition);

        // Enter new state
        if (oldStateTag !== newStateTag) {
          const stateConfig = config.states[newStateTag as S["_tag"]];

          // Run entry effect
          if (stateConfig?.entry) {
            Effect.runFork(stateConfig.entry(snapshot.state as any, snapshot.context));
          }

          // Start run stream if defined
          if (stateConfig?.run) {
            const stream = typeof stateConfig.run === "function"
              ? stateConfig.run(snapshot)
              : stateConfig.run;
            runFiber = Effect.runFork(
              Stream.runForEach(stream, (event) =>
                Effect.sync(() => processEvent(event))
              )
            );
          }
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

      // Actions only (stay in current state, no update)
      if ("actions" in transition) {
        runActions(transition);
      }
    };

    // Process an event
    const processEvent = (event: E) => {
      const stateTag = snapshot.state._tag as S["_tag"];

      // Try state handlers first (more specific takes precedence)
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
      // No handler = implicit stay (do nothing)
    };

    // Initialize initial state
    const initialStateConfig = config.states[snapshot.state._tag as S["_tag"]];

    // Run entry effect for initial state
    if (initialStateConfig?.entry) {
      Effect.runFork(initialStateConfig.entry(snapshot.state as any, snapshot.context));
    }

    // Start run stream for initial state
    if (initialStateConfig?.run) {
      const stream = typeof initialStateConfig.run === "function"
        ? initialStateConfig.run(snapshot)
        : initialStateConfig.run;
      runFiber = Effect.runFork(
        Stream.runForEach(stream, (event) =>
          Effect.sync(() => processEvent(event))
        )
      );
    }

    // Return actor
    const actor: MachineActor<S, C, E> = {
      send: processEvent,
      getSnapshot: () => snapshot,
      subscribe: (observer) => {
        subscribers.add(observer);
        return () => subscribers.delete(observer);
      },
      stop: () => {
        if (runFiber) {
          Effect.runFork(Fiber.interrupt(runFiber));
          runFiber = null;
        }
        subscribers.clear();
      },
      _syncSnapshot: (newSnapshot) => {
        const oldStateTag = snapshot.state._tag;
        const newStateTag = newSnapshot.state._tag;

        // If state changed, handle exit
        if (oldStateTag !== newStateTag) {
          const oldStateConfig = config.states[oldStateTag as S["_tag"]];

          // Run exit effect
          if (oldStateConfig?.exit) {
            Effect.runFork(oldStateConfig.exit(snapshot.state as any, snapshot.context));
          }

          // Cancel old state's run stream
          if (runFiber) {
            Effect.runFork(Fiber.interrupt(runFiber));
            runFiber = null;
          }
        }

        // Update snapshot
        snapshot = newSnapshot;
        notify();

        // If state changed, handle entry
        if (oldStateTag !== newStateTag) {
          const stateConfig = config.states[newStateTag as S["_tag"]];

          // Run entry effect
          if (stateConfig?.entry) {
            Effect.runFork(stateConfig.entry(snapshot.state as any, snapshot.context));
          }

          // Start run stream
          if (stateConfig?.run) {
            const stream = typeof stateConfig.run === "function"
              ? stateConfig.run(snapshot)
              : stateConfig.run;
            runFiber = Effect.runFork(
              Stream.runForEach(stream, (event) =>
                Effect.sync(() => processEvent(event))
              )
            );
          }
        }
      },
    };

    return actor;
  });
}

export { defineMachine as define };
