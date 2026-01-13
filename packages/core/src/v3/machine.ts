/**
 * EffState v3 Machine Definition
 */

import { Effect, Fiber, Stream } from "effect";
import type { Schema } from "effect";
import type {
  MachineState,
  MachineContext,
  MachineEvent,
  MachineConfig,
  MachineDefinition,
  MachineSnapshot,
  MachineActor,
  Transition,
  TransitionBuilders,
} from "./types";
import { createBuilders } from "./types";

/**
 * Define a state machine with the v3 API
 */
export function defineMachine<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
  TContextSchema extends Schema.Schema.Any,
>(config: MachineConfig<S, C, E, TContextSchema>): MachineDefinition<S, C, E, TContextSchema> {
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
  TContextSchema extends Schema.Schema.Any,
>(
  config: MachineConfig<S, C, E, TContextSchema>,
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

    // Builders for transitions
    const builders: TransitionBuilders<S, C> = createBuilders();

    // Notify subscribers
    const notify = () => {
      for (const sub of subscribers) {
        sub(snapshot);
      }
    };

    // Apply a transition
    const applyTransition = (transition: Transition<S, C> | null) => {
      if (transition === null || transition.type === "stay") {
        return;
      }

      if (transition.type === "update") {
        snapshot = {
          ...snapshot,
          context: { ...snapshot.context, ...transition.updates },
        };
        notify();
        return;
      }

      if (transition.type === "goto") {
        const oldStateTag = snapshot.state._tag;
        const newStateTag = transition.state._tag;

        // Exit old state
        if (oldStateTag !== newStateTag) {
          // Cancel any running stream
          if (runFiber) {
            Effect.runFork(Fiber.interrupt(runFiber));
            runFiber = null;
          }
        }

        // Update state
        snapshot = {
          state: transition.state,
          context: transition.updates
            ? { ...snapshot.context, ...transition.updates }
            : snapshot.context,
        };
        notify();

        // Enter new state (start run stream if defined)
        if (oldStateTag !== newStateTag) {
          const stateConfig = config.states[newStateTag as S["_tag"]];
          if (stateConfig?.run) {
            runFiber = Effect.runFork(
              Stream.runForEach(stateConfig.run, (event) =>
                Effect.sync(() => processEvent(event))
              )
            );
          }
        }
      }
    };

    // Process an event
    const processEvent = (event: E) => {
      const stateTag = snapshot.state._tag as S["_tag"];

      // Try global handlers first
      if (config.global) {
        const globalHandler = config.global[event._tag as E["_tag"]];
        if (globalHandler) {
          const result = globalHandler(snapshot.context, event as any, builders);
          if (result !== null) {
            applyTransition(result);
            return;
          }
        }
      }

      // Try state handler
      const stateConfig = config.states[stateTag];
      const handler = stateConfig?.on[event._tag as E["_tag"]];
      if (handler) {
        const result = handler(snapshot.context, event as any, builders);
        applyTransition(result);
      }
      // No handler = implicit stay (do nothing)
    };

    // Start initial state's run stream
    const initialStateConfig = config.states[snapshot.state._tag as S["_tag"]];
    if (initialStateConfig?.run) {
      runFiber = Effect.runFork(
        Stream.runForEach(initialStateConfig.run, (event) =>
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
        snapshot = newSnapshot;
        notify();
      },
    };

    return actor;
  });
}

export { defineMachine as define };
