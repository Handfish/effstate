/**
 * EffState v4 - Schema-First State Definitions
 *
 * Single source of truth for both EffState and Confect.
 * No serialization needed - plain objects throughout.
 */

import { Schema } from "effect";

// ============================================================================
// State Helper
// ============================================================================

/**
 * Create a tagged state with schema and constructor.
 *
 * Returns an object with:
 * - `schema`: Effect Schema for Confect/validation
 * - `make`: Constructor function for creating instances
 * - `_tag`: The tag string (for pattern matching helpers)
 * - `is`: Type guard function
 *
 * @example
 * ```ts
 * const Cart = State("Cart", {});
 * const Processing = State("Processing", { startedAt: Schema.Number });
 *
 * // Create instances (plain objects - Convex-compatible!)
 * const cart = Cart.make();
 * const processing = Processing.make({ startedAt: Date.now() });
 *
 * // Use schema with Confect
 * const OrderState = Schema.Union(Cart.schema, Processing.schema);
 * ```
 */
export function State<
  TTag extends string,
  TFields extends Record<string, Schema.Schema.Any>
>(tag: TTag, fields: TFields) {
  // Build the schema
  const schema = Schema.Struct({
    _tag: Schema.Literal(tag),
    ...fields,
  });

  // Infer the type
  type StateType = Schema.Schema.Type<typeof schema>;
  type FieldsOnly = Omit<StateType, "_tag">;

  // Constructor - handles empty fields case
  const make = (
    ...[data]: keyof FieldsOnly extends never ? [] : [data: FieldsOnly]
  ): StateType => {
    const result = {
      _tag: tag,
      ...(data ?? {}),
    };
    return result as unknown as StateType;
  };

  // Type guard
  const is = (state: unknown): state is StateType => {
    if (typeof state !== "object" || state === null) return false;
    return "_tag" in state && (state as { _tag: unknown })._tag === tag;
  };

  return {
    schema,
    make,
    _tag: tag as TTag,
    is,
  };
}

/**
 * Infer the state type from a State definition.
 */
export type StateType<T> = T extends { schema: infer S }
  ? S extends Schema.Schema.Any
    ? Schema.Schema.Type<S>
    : never
  : never;

// ============================================================================
// Event Helper (same pattern)
// ============================================================================

/**
 * Create a tagged event with schema and constructor.
 *
 * @example
 * ```ts
 * const AddItem = Event("AddItem", { item: ItemSchema });
 * const ProceedToCheckout = Event("ProceedToCheckout", {});
 *
 * // Create events
 * const event = AddItem.make({ item: { id: "1", name: "Widget", quantity: 1, price: 10 } });
 * ```
 */
export const Event = State; // Same implementation, different semantic name

/**
 * Infer the event type from an Event definition.
 */
export type EventType<T> = StateType<T>;

// ============================================================================
// Union Helpers
// ============================================================================

/**
 * Create a union schema from State/Event definitions.
 *
 * @example
 * ```ts
 * const OrderState = Union(Cart, Checkout, Processing, Shipped, Delivered, Cancelled);
 * type OrderState = UnionType<typeof OrderState>;
 * ```
 */
export function Union<T extends { schema: Schema.Schema.Any }[]>(
  ...members: T
): Schema.Schema<StateType<T[number]>> {
  const schemas = members.map((m) => m.schema);
  if (schemas.length < 2) {
    throw new Error("Union requires at least 2 members");
  }
  const [first, second, ...rest] = schemas as [Schema.Schema.Any, Schema.Schema.Any, ...Schema.Schema.Any[]];
  return Schema.Union(first, second, ...rest) as unknown as Schema.Schema<StateType<T[number]>>;
}

/**
 * Infer the union type.
 */
export type UnionType<T> = T extends Schema.Schema.Any ? Schema.Schema.Type<T> : never;
