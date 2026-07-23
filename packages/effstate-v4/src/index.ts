/**
 * EffState v4 - Lean Schema-First State Machines
 *
 * A minimal, type-safe state machine library built on Effect.
 *
 * Features:
 * - Schema-first state/event definitions
 * - Full Effect R (Requirements) channel support
 * - Honest error handling via callbacks
 * - Entry/exit effects and run streams
 * - Auto-canceling streams on state exit
 *
 * @example
 * ```ts
 * import { State, Event, Union, defineMachine } from "effstate-v4";
 * import { Schema, Effect, Stream, Duration } from "effect";
 *
 * // Define states
 * const Idle = State("Idle", {});
 * const Running = State("Running", { startedAt: Schema.DateFromSelf });
 *
 * // Define events
 * const Start = Event("Start", {});
 * const Stop = Event("Stop", {});
 * const Tick = Event("Tick", {});
 *
 * // Define machine
 * const machine = defineMachine({
 *   initialState: Idle.make(),
 *   initialContext: { count: 0 },
 *   states: {
 *     Idle: {
 *       on: { Start: () => ({ goto: Running.make({ startedAt: new Date() }) }) },
 *     },
 *     Running: {
 *       run: Stream.fromSchedule(Schedule.spaced(Duration.seconds(1))).pipe(
 *         Stream.map(() => Tick.make())
 *       ),
 *       on: {
 *         Stop: () => ({ goto: Idle.make() }),
 *         Tick: (ctx) => ({ update: { count: ctx.count + 1 } }),
 *       },
 *     },
 *   },
 * });
 *
 * // Use with React
 * const actor = Effect.runSync(machine.interpret());
 * actor.send(Start.make());
 * ```
 */

// Schema-first helpers
export { State, Event, Union } from "./state";
export type { StateDefinition, StateType, EventType, UnionType, SchemaFields } from "./state";

// Core types
export type {
  MachineState,
  MachineEvent,
  MachineContext,
  StateTag,
  StateByTag,
  EventByTag,
  TransitionAction,
  Transition,
  EventHandler,
  EventHandlers,
  StateConfig,
  MachineConfig,
  MachineSnapshot,
  MachineActor,
  MachineDefinition,
  MachineStateType,
  MachineContextType,
  MachineEventType,
  MachineRequirements,
  MachineError,
  MachineContextEncoded,
} from "./types";

// Machine
export { defineMachine, define } from "./machine";
export type { MachineEffectError, InterpretOptions } from "./machine";

// Re-export commonly used Effect types for convenience
import { Schema, Effect, Stream, Either } from "effect";
export { Schema, Effect, Stream, Either };
