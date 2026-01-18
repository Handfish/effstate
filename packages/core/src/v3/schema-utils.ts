/**
 * Schema Utilities
 *
 * Helpers for working with Effect Schemas for state machine types.
 */

import { Schema } from "effect";

// ============================================================================
// Common Field Schemas
// ============================================================================

/**
 * Schema for a timestamp field (stored as number, represents Date).
 */
export const TimestampSchema = Schema.Number.annotations({
  description: "Unix timestamp in milliseconds",
});

/**
 * Schema for an optional timestamp field.
 */
export const OptionalTimestampSchema = Schema.optional(TimestampSchema);

// ============================================================================
// Date Transform Schemas
// ============================================================================

/**
 * Schema that transforms Date to/from number (Unix timestamp).
 * Use this when you want automatic Date <-> number conversion.
 *
 * @example
 * ```ts
 * const MySchema = Schema.Struct({
 *   createdAt: DateToNumber,
 * });
 *
 * // Encoding: { createdAt: new Date() } -> { createdAt: 1234567890 }
 * // Decoding: { createdAt: 1234567890 } -> { createdAt: Date }
 * ```
 */
export const DateToNumber = Schema.transform(Schema.Number, Schema.DateFromSelf, {
  strict: true,
  decode: (n) => new Date(n),
  encode: (d) => d.getTime(),
});

/**
 * Schema for optional Date stored as number.
 */
export const OptionalDateToNumber = Schema.optional(DateToNumber);

// ============================================================================
// State Tag Extraction
// ============================================================================

/**
 * Extract state tags from a machine config at runtime.
 *
 * @example
 * ```ts
 * const tags = extractStateTags(orderMachine.config);
 * // ["Cart", "Checkout", "Processing", "Shipped", "Delivered", "Cancelled"]
 * ```
 */
export function extractStateTags<TTag extends string>(config: {
  states: Record<TTag, unknown>;
}): readonly TTag[] {
  return Object.keys(config.states) as TTag[];
}
