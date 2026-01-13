/**
 * EffState v2 Machine Definition
 *
 * The `Machine` namespace provides the main API for defining state machines:
 * - `Machine.define(config)` - create a machine definition
 *
 * @example
 * ```ts
 * import { Machine, goto, update, stay } from "effstate/v2";
 * import { Data, Effect, Match, Schema } from "effect";
 *
 * // Define states as a tagged enum
 * type MyState = Data.TaggedEnum<{
 *   Idle: {};
 *   Loading: { startedAt: Date };
 *   Done: { result: string };
 * }>;
 * const MyState = Data.taggedEnum<MyState>();
 *
 * // Define events
 * class Start extends Data.TaggedClass("Start")<{}> {}
 * class Loaded extends Data.TaggedClass("Loaded")<{ data: string }> {}
 * type MyEvent = Start | Loaded;
 *
 * // Define the machine
 * const machine = Machine.define({
 *   id: "myMachine",
 *   context: Schema.Struct({ count: Schema.Number }),
 *   initialContext: { count: 0 },
 *   initialState: MyState.Idle({}),
 *
 *   states: {
 *     Idle: {
 *       on: (ctx, state) => (event) =>
 *         Match.value(event).pipe(
 *           Match.tag("Start", () => goto(MyState.Loading({ startedAt: new Date() }))),
 *           Match.tag("Loaded", () => stay),
 *           Match.exhaustive,
 *         ),
 *     },
 *     Loading: {
 *       entry: (state) => Effect.log(`Started at ${state.startedAt}`),
 *       run: fetchData().pipe(
 *         Effect.map((data) => goto(MyState.Done({ result: data }))),
 *       ),
 *       on: (ctx, state) => (event) =>
 *         Match.value(event).pipe(
 *           Match.tag("Start", () => stay),
 *           Match.tag("Loaded", ({ data }) => goto(MyState.Done({ result: data }))),
 *           Match.exhaustive,
 *         ),
 *     },
 *     Done: {
 *       on: (ctx, state) => (event) =>
 *         Match.value(event).pipe(
 *           Match.tag("Start", () => goto(MyState.Loading({ startedAt: new Date() }))),
 *           Match.tag("Loaded", () => stay),
 *           Match.exhaustive,
 *         ),
 *     },
 *   },
 * });
 *
 * // Create an actor
 * const actor = yield* machine.interpret();
 * actor.send(new Start());
 * ```
 */

import { Effect, Scope } from "effect";
import type { Schema } from "effect";
import type {
  MachineState,
  MachineContext,
  MachineEvent,
  MachineConfig,
  MachineDefinition,
  MachineSnapshot,
  MachineActor,
  ChildrenConfig,
  InterpretOptions,
} from "./types.js";
import { createInterpreter } from "./interpreter.js";

// ============================================================================
// Machine.define()
// ============================================================================

/**
 * Define a state machine.
 *
 * @param config - Machine configuration
 * @returns A machine definition with an interpret method
 *
 * @example
 * ```ts
 * const machine = Machine.define({
 *   id: "counter",
 *   context: Schema.Struct({ count: Schema.Number }),
 *   initialContext: { count: 0 },
 *   initialState: CounterState.Idle({}),
 *   states: { ... },
 * });
 *
 * const actor = yield* machine.interpret();
 * ```
 */
export function define<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
  TContextSchema extends Schema.Schema.Any,
  TEmits extends MachineEvent = never,
  TChildren extends ChildrenConfig = Record<string, never>,
  R = never,
>(
  config: MachineConfig<S, C, E, TContextSchema, TEmits, TChildren, R>
): MachineDefinition<S, C, E, TContextSchema, TEmits, TChildren, R> {
  // Create initial snapshot
  const initialSnapshot: MachineSnapshot<S, C> = {
    state: config.initialState,
    context: config.initialContext as C,
    event: null,
  };

  // Create the interpret function
  const interpret = (
    options?: InterpretOptions<S, C>
  ): Effect.Effect<MachineActor<S, C, E, TChildren>, never, R | Scope.Scope> => {
    return createInterpreter(definition, options);
  };

  // Build the definition
  const definition: MachineDefinition<S, C, E, TContextSchema, TEmits, TChildren, R> = {
    _tag: "MachineDefinition",
    _version: 2,
    id: config.id,
    config,
    initialSnapshot,
    contextSchema: config.context,
    interpret,
  };

  return definition;
}

// ============================================================================
// Machine Namespace
// ============================================================================

/**
 * Machine namespace - main API for defining state machines.
 */
export const Machine = {
  /**
   * Define a state machine.
   *
   * @see {@link define}
   */
  define,
} as const;

// ============================================================================
// Type Exports
// ============================================================================

export type {
  MachineState,
  MachineContext,
  MachineEvent,
  MachineConfig,
  MachineDefinition,
  MachineSnapshot,
  MachineActor,
  ChildrenConfig,
  InterpretOptions,
} from "./types.js";
