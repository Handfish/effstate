/**
 * EffState v4 - Schema-First State Machines
 *
 * Unified API for EffState and Confect:
 * - Single source of truth (Effect Schema)
 * - No serialization layer
 * - Plain objects throughout
 * - Works directly with Convex
 */

// State/Event helpers
export { State, Event, Union } from "./state";
export type { StateType, EventType, UnionType } from "./state";

// Machine
export { defineMachine } from "./machine";
export type {
  MachineState,
  MachineContext,
  MachineEvent,
  MachineSnapshot,
  MachineActor,
  MachineDefinition,
  MachineConfig,
  StateConfig,
  EventHandler,
  EventHandlers,
  HandlerResult,
  UpdateResult,
  GotoResult,
  GotoWithUpdateResult,
} from "./machine";

// Re-export Schema for convenience
import { Schema } from "effect";
export { Schema };
