/**
 * EffState v4 - Schema-First State Definitions
 *
 * Helpers that bundle Effect Schema + constructor for seamless
 * integration with both EffState AND Confect/Convex.
 *
 * Single source of truth: define once, use everywhere.
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
 * const OrderState = Union(Cart, Processing);
 *
 * // Use with v4 machine (full features!)
 * defineMachine({
 *   initialState: Cart.make(),
 *   states: {
 *     Cart: { on: { ... } },
 *     Processing: { run: tickStream, on: { ... } },  // streams work!
 *   }
 * });
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

  // Infer the type from schema
  type StateType = Schema.Schema.Type<typeof schema>;
  type FieldsOnly = Omit<StateType, "_tag">;

  // Constructor - handles empty fields case
  // Uses conditional tuple for clean API: Cart.make() vs Processing.make({ startedAt: 123 })
  const make = (
    ...[data]: keyof FieldsOnly extends never ? [] : [data: FieldsOnly]
  ): StateType => {
    // The cast is safe: we're constructing exactly what the schema describes
    // TypeScript can't infer this because of the spread over generic TFields
    return {
      _tag: tag,
      ...(data ?? {}),
    } as unknown as StateType;
  };

  // Type guard
  const is = (value: unknown): value is StateType => {
    if (typeof value !== "object" || value === null) return false;
    return "_tag" in value && value._tag === tag;
  };

  return {
    /** Effect Schema for this state (use with Confect) */
    schema,
    /** Create an instance of this state */
    make,
    /** The tag string */
    _tag: tag as TTag,
    /** Type guard */
    is,
  };
}

/**
 * Infer the state type from a State definition.
 *
 * @example
 * ```ts
 * const Cart = State("Cart", {});
 * type CartState = StateType<typeof Cart>;
 * // { readonly _tag: "Cart" }
 * ```
 */
export type StateType<T> = T extends { schema: infer S }
  ? S extends Schema.Schema<infer A, infer _I, infer _R>
    ? A
    : never
  : never;

// ============================================================================
// Event Helper (same pattern as State)
// ============================================================================

/**
 * Create a tagged event with schema and constructor.
 *
 * Same API as State - events are just tagged objects.
 *
 * @example
 * ```ts
 * const AddItem = Event("AddItem", { item: ItemSchema });
 * const ProceedToCheckout = Event("ProceedToCheckout", {});
 *
 * // Create events
 * const event = AddItem.make({ item: { id: "1", name: "Widget", quantity: 1, price: 10 } });
 *
 * // Use with machine
 * actor.send(ProceedToCheckout.make());
 * ```
 */
export const Event = State;

/**
 * Infer the event type from an Event definition.
 */
export type EventType<T> = StateType<T>;

// ============================================================================
// Union Helper
// ============================================================================

/**
 * Create a union schema from State/Event definitions.
 *
 * @example
 * ```ts
 * const Cart = State("Cart", {});
 * const Checkout = State("Checkout", {});
 * const Processing = State("Processing", { startedAt: Schema.Number });
 *
 * // Create union schema for Confect
 * const OrderStateSchema = Union(Cart, Checkout, Processing);
 * type OrderState = Schema.Schema.Type<typeof OrderStateSchema>;
 *
 * // Use in Convex table definition
 * defineTable(Schema.Struct({
 *   state: OrderStateSchema,
 * }))
 * ```
 */
export function Union<
  T extends readonly { schema: Schema.Schema.Any }[]
>(...members: T): Schema.Union<UnionMemberSchemas<T>> {
  const schemas = members.map((m) => m.schema);
  if (schemas.length < 2) {
    throw new Error("Union requires at least 2 members");
  }
  return Schema.Union(
    ...(schemas as unknown as readonly [Schema.Schema.Any, Schema.Schema.Any, ...Schema.Schema.Any[]])
  ) as unknown as Schema.Union<UnionMemberSchemas<T>>;
}

// Helper type to extract schema array from members
type UnionMemberSchemas<T extends readonly { schema: Schema.Schema.Any }[]> = {
  -readonly [K in keyof T]: T[K] extends { schema: infer S } ? S : never;
} extends infer U
  ? U extends readonly [Schema.Schema.Any, Schema.Schema.Any, ...Schema.Schema.Any[]]
    ? U
    : never
  : never;

/**
 * Infer the union type from a Union schema.
 *
 * @example
 * ```ts
 * const OrderStateSchema = Union(Cart, Checkout, Processing);
 * type OrderState = UnionType<typeof OrderStateSchema>;
 * ```
 */
export type UnionType<T> = T extends Schema.Schema<infer A, infer _I, infer _R> ? A : never;
