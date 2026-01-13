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

// Re-export Machine namespace for convenience
import * as Machine from "./machine";
export { Machine };
