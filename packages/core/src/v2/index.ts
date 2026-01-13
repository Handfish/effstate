/**
 * EffState v2 API
 *
 * A fully Effect-native state machine library with:
 * - Discriminated union states (Rust-style enums with data)
 * - Exhaustive event handling via Match
 * - Type-safe parent-child relationships
 * - Simplified transition syntax (goto, update, stay)
 * - Unified `run` for effects/streams
 *
 * @example
 * ```ts
 * import { Machine, goto, update, stay } from "effstate/v2";
 * import { Data, Effect, Match, Schema } from "effect";
 *
 * // Define states
 * type MyState = Data.TaggedEnum<{
 *   Idle: {};
 *   Loading: { startedAt: Date };
 * }>;
 * const MyState = Data.taggedEnum<MyState>();
 *
 * // Define events
 * class Start extends Data.TaggedClass("Start")<{}> {}
 * type MyEvent = Start;
 *
 * // Define machine
 * const machine = Machine.define({
 *   id: "example",
 *   context: Schema.Struct({ count: Schema.Number }),
 *   initialContext: { count: 0 },
 *   initialState: MyState.Idle({}),
 *   states: {
 *     Idle: {
 *       on: (ctx) => (event) =>
 *         Match.value(event).pipe(
 *           Match.tag("Start", () => goto(MyState.Loading({ startedAt: new Date() }))),
 *           Match.exhaustive,
 *         ),
 *     },
 *     Loading: {
 *       on: (ctx) => (event) =>
 *         Match.value(event).pipe(
 *           Match.tag("Start", () => stay),
 *           Match.exhaustive,
 *         ),
 *     },
 *   },
 * });
 *
 * // Use the machine
 * const program = Effect.gen(function* () {
 *   const actor = yield* machine.interpret();
 *   actor.send(new Start());
 *   const result = yield* actor.waitFor((s) => s.state._tag === "Loading");
 *   return result;
 * });
 * ```
 *
 * @packageDocumentation
 */

// ============================================================================
// Machine Definition
// ============================================================================

export { Machine, define } from "./machine.js";

// ============================================================================
// Transition Builders
// ============================================================================

export { goto, update, stay, isGoto, isUpdate, isStay } from "./transitions.js";

// ============================================================================
// Types
// ============================================================================

export type {
  // State types
  MachineState,
  StateTag,
  StateData,
  StateByTag,

  // Event types
  MachineEvent,
  EventData,
  EventByTag,

  // Context types
  MachineContext,

  // Type hints
  MachineTypes,

  // Transition types
  TransitionResult,
  GotoTransition,
  UpdateTransition,
  StayTransition,
  SpawnAction,
  SendAction,

  // Transition builder types
  GotoBuilder,
  UpdateBuilder,
  StayBuilder,
  TransitionBuilders,

  // Handler types
  StateEventHandler,
  StateConfig,

  // Children types
  ChildrenConfig,
  ChildEventType,
  ChildStateType,
  ChildContextType,
  ChildEventsConfig,
  ChildEmitType,

  // Machine types
  MachineConfig,
  MachineDefinition,
  AnyMachineDefinition,

  // Snapshot types
  MachineSnapshot,

  // Actor types
  InterpretOptions,
  MachineActor,
  ChildActor,
  AnyMachineActor,

  // Utility types
  MachineStateType,
  MachineContextType,
  MachineEventType,
  MachineRequirements,
  MachineChildrenType,
} from "./types.js";

// ============================================================================
// Transition Builder Factory
// ============================================================================

export { createTransitionBuilders } from "./transitions.js";
