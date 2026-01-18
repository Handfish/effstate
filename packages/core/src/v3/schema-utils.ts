/**
 * Schema Utilities
 *
 * Helpers for working with Effect Schemas for state machine types.
 */

import { Schema } from "effect";

// ============================================================================
// Type Inference Helper
// ============================================================================

/**
 * Derive TypeScript type from an Effect Schema.
 * Re-exported for discoverability - same as Schema.Schema.Type.
 *
 * @example
 * ```ts
 * import { InferType } from 'effstate/v3';
 *
 * const OrderStateSchema = Schema.Union(...);
 * export type OrderState = InferType<typeof OrderStateSchema>;
 * ```
 */
export type InferType<S extends Schema.Schema.Any> = Schema.Schema.Type<S>;

/**
 * Derive the encoded type from an Effect Schema.
 * Useful for understanding what gets serialized.
 */
export type InferEncoded<S extends Schema.Schema.Any> = Schema.Schema.Encoded<S>;

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

// ============================================================================
// State Schema Helpers
// ============================================================================

/**
 * Create a tagged state schema variant.
 *
 * This is a convenience wrapper around Schema.Struct that adds a _tag literal.
 * For most cases, you can use Schema.Struct directly:
 *
 * @example
 * ```ts
 * // Using taggedState helper:
 * const Cart = taggedState("Cart", {});
 * const Processing = taggedState("Processing", { startedAt: Schema.Number });
 *
 * // Equivalent to:
 * const Cart = Schema.Struct({ _tag: Schema.Literal("Cart") });
 * const Processing = Schema.Struct({
 *   _tag: Schema.Literal("Processing"),
 *   startedAt: Schema.Number,
 * });
 *
 * const OrderStateSchema = Schema.Union(Cart, Processing);
 * ```
 */
export function taggedState<
  TTag extends string,
  TFields extends Record<string, Schema.Schema.Any>
>(
  tag: TTag,
  fields: TFields
) {
  return Schema.Struct({
    _tag: Schema.Literal(tag),
    ...fields,
  });
}

// ============================================================================
// Common Validation Schemas
// ============================================================================

/**
 * Common validation schemas that can be used directly in struct definitions.
 *
 * @example
 * ```ts
 * const OrderItemSchema = Schema.Struct({
 *   id: Validation.NonEmptyString,
 *   name: Validation.NonEmptyString,
 *   quantity: Validation.PositiveInt,
 *   price: Validation.NonNegativeNumber,
 * });
 * ```
 */
export const Validation = {
  /** Non-empty string */
  NonEmptyString: Schema.String.pipe(
    Schema.filter((s) => s.length > 0, {
      message: () => "String must not be empty",
    })
  ),

  /** Positive number (> 0) */
  PositiveNumber: Schema.Number.pipe(
    Schema.filter((n) => n > 0, {
      message: () => "Number must be positive",
    })
  ),

  /** Non-negative number (>= 0) */
  NonNegativeNumber: Schema.Number.pipe(
    Schema.filter((n) => n >= 0, {
      message: () => "Number must be non-negative",
    })
  ),

  /** Positive integer (> 0, whole number) */
  PositiveInt: Schema.Number.pipe(
    Schema.filter((n) => n > 0 && Number.isInteger(n), {
      message: () => "Number must be a positive integer",
    })
  ),

  /** Non-negative integer (>= 0, whole number) */
  NonNegativeInt: Schema.Number.pipe(
    Schema.filter((n) => n >= 0 && Number.isInteger(n), {
      message: () => "Number must be a non-negative integer",
    })
  ),
} as const;
