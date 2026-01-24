/**
 * EffState v4 - Schema-First State Machines
 *
 * PhD-level type safety:
 * - Full R (Requirements) channel support for dependency injection
 * - Honest error handling (errors via callback, never silent failures)
 * - Schema-based runtime validation
 * - Proper type guards using Schema.is
 * - Minimal, documented casts (see state.ts header for details)
 *
 * v4 = v3 features + Schema-First Helpers:
 * - Object-based handlers (no Match boilerplate)
 * - Implicit stay for unhandled events
 * - Discriminated union states
 * - Effect/Stream integration (entry/exit/run)
 * - Global handlers
 * - Actions
 *
 * Plus schema-first helpers for Convex/Confect integration:
 * - State() - create states with bundled schema + constructor + type guard
 * - Event() - create events with bundled schema + constructor + type guard
 * - Union() - create union schemas from State/Event definitions
 *
 * Single source of truth: define once, use everywhere.
 */

// Schema-first helpers (NEW in v4)
export {
  State,
  Event,
  Union,
  unionDecoder,
  unionGuard,
} from "./state";

export type {
  SchemaFields,
  StateDefinition,
  StateType,
  EventType,
  UnionType,
} from "./state";

// Core types (with R and Err channels)
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
  ExhaustiveEventHandlers,
  StateConfig,
  MachineConfig,
  MachineSnapshot,
  MachineActor,
  MachineDefinition,
  // Type extractors
  MachineStateType,
  MachineContextType,
  MachineEventType,
  MachineRequirements,
  MachineError,
} from "./types";

export { strict } from "./types";

// Machine
export { defineMachine, define } from "./machine";
export type { MachineEffectError, InterpretOptions } from "./machine";

// Serialization utilities
export * from "./state-serializer";

// Transition analysis
export * from "./transitions";

// Schema utilities
export * from "./schema-utils";

// Convex adapter
export * from "./convex-adapter";

// Re-export Machine namespace for convenience
import * as Machine from "./machine";
export { Machine };

// Re-export namespaces for organization
import * as Serializer from "./state-serializer";
import * as Transitions from "./transitions";
import * as SchemaUtils from "./schema-utils";
import * as ConvexAdapterUtils from "./convex-adapter";
export { Serializer, Transitions, SchemaUtils, ConvexAdapterUtils };

// Re-export Effect types for convenience
import { Schema, Effect, Stream, Either } from "effect";
export { Schema, Effect, Stream, Either };
