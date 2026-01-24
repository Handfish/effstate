/**
 * EffState v4 - Schema-First State Machines
 *
 * v4 = v3 + Schema-First Helpers
 *
 * Everything from v3:
 * - Object-based handlers (no Match boilerplate)
 * - Implicit stay for unhandled events
 * - Discriminated union states
 * - Effect/Stream integration (entry/exit/run)
 * - Global handlers
 * - Actions
 *
 * Plus schema-first helpers for Convex/Confect integration:
 * - State() - create states with bundled schema + constructor
 * - Event() - create events with bundled schema + constructor
 * - Union() - create union schemas from State/Event definitions
 *
 * Single source of truth: define once, use everywhere.
 */

// Schema-first helpers (NEW in v4)
export { State, Event, Union } from "./state";
export type { StateType, EventType, UnionType } from "./state";

// Everything from v3
export * from "./types";
export * from "./machine";
export * from "./state-serializer";
export * from "./transitions";
export * from "./schema-utils";
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

// Re-export Schema for convenience
import { Schema } from "effect";
export { Schema };
