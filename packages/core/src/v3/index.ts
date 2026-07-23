/**
 * EffState v3 - Lean API
 *
 * Same type safety guarantees with ~50% less code:
 * - Object-based handlers (no Match boilerplate)
 * - Implicit stay for unhandled events
 * - Discriminated union states
 * - Effect/Stream integration
 */

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
