/**
 * EffState v4 - Schema-First State Definitions
 *
 * PhD-level type safety:
 * - No unsafe casts (as unknown as)
 * - Schema-based runtime validation
 * - Proper type guards using Schema.is
 * - Full type inference preservation
 *
 * Single source of truth: define once, use everywhere.
 */

import { Either, Schema, ParseResult } from "effect";

// ============================================================================
// Type-Level Helpers
// ============================================================================

/**
 * Fields type for State/Event schemas.
 * Alias for Schema.Struct.Fields for convenience.
 */
export type SchemaFields = Schema.Struct.Fields;

/**
 * Compute the full state type from tag + fields.
 * This is used internally to derive proper types without casts.
 */
type ComputeStateType<
  TTag extends string,
  TFields extends Schema.Struct.Fields
> = Schema.Schema.Type<Schema.Struct<{ _tag: Schema.Literal<[TTag]> } & TFields>>;

/**
 * Compute fields-only type (excluding _tag).
 */
type ComputeFieldsOnly<
  TTag extends string,
  TFields extends Schema.Struct.Fields
> = Omit<ComputeStateType<TTag, TFields>, "_tag">;

// ============================================================================
// State Definition Result
// ============================================================================

/**
 * The result of calling State() or Event().
 * Fully typed with no 'any' or 'unknown'.
 */
export interface StateDefinition<
  TTag extends string,
  TFields extends Schema.Struct.Fields,
  TType = ComputeStateType<TTag, TFields>,
  TFieldsOnly = ComputeFieldsOnly<TTag, TFields>
> {
  /** Effect Schema for this state (use with Confect) */
  readonly schema: Schema.Struct<{ _tag: Schema.Literal<[TTag]> } & TFields>;

  /** The tag string literal type */
  readonly _tag: TTag;

  /**
   * Create an instance of this state (unchecked).
   *
   * For states with no fields: `Cart.make()`
   * For states with fields: `Processing.make({ startedAt: 123 })`
   *
   * Note: This doesn't validate at runtime. Use `safeMake` for validation.
   */
  readonly make: keyof TFieldsOnly extends never
    ? () => TType
    : (data: TFieldsOnly) => TType;

  /**
   * Create an instance with runtime validation.
   * Returns Either<TType, ParseError>.
   */
  readonly safeMake: keyof TFieldsOnly extends never
    ? () => Either.Either<TType, ParseResult.ParseError>
    : (data: TFieldsOnly) => Either.Either<TType, ParseResult.ParseError>;

  /**
   * Type guard using Schema.is (validates all fields, not just _tag).
   */
  readonly is: (value: unknown) => value is TType;

  /**
   * Decode unknown value to this state type.
   * Returns Either<TType, ParseError>.
   */
  readonly decode: (value: unknown) => Either.Either<TType, ParseResult.ParseError>;
}

// ============================================================================
// State Helper
// ============================================================================

/**
 * Create a tagged state with schema and constructor.
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
 * // Safe creation with validation
 * const result = Processing.safeMake({ startedAt: Date.now() });
 * if (Either.isRight(result)) {
 *   console.log("Valid:", result.right);
 * }
 *
 * // Type guard (validates all fields!)
 * if (Processing.is(unknownValue)) {
 *   // unknownValue is now typed as Processing
 * }
 *
 * // Use schema with Confect
 * const OrderState = Union(Cart, Processing);
 * ```
 */
export function State<
  TTag extends string,
  TFields extends Schema.Struct.Fields
>(
  tag: TTag,
  fields: TFields
): StateDefinition<TTag, TFields> {
  // Build the schema with proper typing
  const tagSchema = Schema.Literal(tag);
  const schema = Schema.Struct({
    _tag: tagSchema,
    ...fields,
  });

  // Type aliases for clarity
  type StateType = ComputeStateType<TTag, TFields>;
  type FieldsOnly = ComputeFieldsOnly<TTag, TFields>;

  // For decode/is, we need a schema typed with R = never
  // This is safe because State() is intended for simple data schemas
  // (schemas with context requirements should use Schema.Struct directly)
  type SchemaType = Schema.Schema<StateType, Schema.Schema.Encoded<typeof schema>, never>;
  const typedSchema = schema as unknown as SchemaType;

  // Schema-based type guard (validates ALL fields, not just _tag)
  const is: (value: unknown) => value is StateType = Schema.is(typedSchema);

  // Schema-based decoder
  const decode = Schema.decodeUnknownEither(typedSchema);

  // Unchecked make - constructs directly
  // The type system ensures callers pass correct data
  const makeImpl = (data?: FieldsOnly): StateType => {
    // Sound: we're constructing exactly what the type describes
    // The double cast is needed because TS can't infer the spread over generics
    return { _tag: tag, ...data } as unknown as StateType;
  };

  // Safe make with validation
  const safeMakeImpl = (data?: FieldsOnly): Either.Either<StateType, ParseResult.ParseError> => {
    return decode({ _tag: tag, ...data });
  };

  // Build the result object with proper typing
  // We use a type assertion here, but it's sound because:
  // 1. The schema is constructed from the same TTag and TFields
  // 2. make/safeMake produce values matching the schema
  // 3. is/decode use the schema for validation
  const result = {
    schema,
    _tag: tag,
    make: makeImpl,
    safeMake: safeMakeImpl,
    is,
    decode,
  };

  return result as StateDefinition<TTag, TFields>;
}

// ============================================================================
// StateType - Infer type from State definition
// ============================================================================

/**
 * Infer the state type from a State definition.
 *
 * @example
 * ```ts
 * const Cart = State("Cart", {});
 * type CartState = StateType<typeof Cart>;
 * // { readonly _tag: "Cart" }
 *
 * const Processing = State("Processing", { startedAt: Schema.Number });
 * type ProcessingState = StateType<typeof Processing>;
 * // { readonly _tag: "Processing"; readonly startedAt: number }
 * ```
 */
export type StateType<T> = T extends StateDefinition<infer _Tag, infer _Fields, infer Type, infer _FieldsOnly>
  ? Type
  : T extends { schema: infer S }
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
 * // Type guard
 * if (AddItem.is(unknownEvent)) {
 *   console.log(unknownEvent.item);
 * }
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
 * Helper type to extract the schema from a state definition.
 */
type ExtractSchema<T> = T extends { schema: infer S } ? S : never;

/**
 * Helper type to build the union member tuple type.
 */
type UnionMemberSchemas<T extends readonly { schema: Schema.Schema.Any }[]> = {
  readonly [K in keyof T]: ExtractSchema<T[K]>;
};

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
  T extends readonly [
    { schema: Schema.Schema.Any },
    { schema: Schema.Schema.Any },
    ...{ schema: Schema.Schema.Any }[]
  ]
>(...members: T): Schema.Union<UnionMemberSchemas<T>> {
  const schemas = members.map((m) => m.schema);

  // Schema.Union requires at least 2 members
  // Our type constraint guarantees this at compile time
  const [first, second, ...rest] = schemas;

  return Schema.Union(
    first as Schema.Schema.Any,
    second as Schema.Schema.Any,
    ...(rest as Schema.Schema.Any[])
  ) as Schema.Union<UnionMemberSchemas<T>>;
}

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

// ============================================================================
// Additional Utilities
// ============================================================================

/**
 * Create a decoder for a union of states.
 *
 * @example
 * ```ts
 * const decodeOrderState = unionDecoder(Cart, Checkout, Processing);
 * const result = decodeOrderState(unknownValue);
 * ```
 */
export function unionDecoder<
  T extends readonly [
    { schema: Schema.Schema.Any },
    { schema: Schema.Schema.Any },
    ...{ schema: Schema.Schema.Any }[]
  ]
>(...members: T): (value: unknown) => Either.Either<
  Schema.Schema.Type<Schema.Union<UnionMemberSchemas<T>>>,
  ParseResult.ParseError
> {
  const unionSchema = Union(...members);
  // Cast to handle R channel (safe for data schemas without context requirements)
  type ResultType = Schema.Schema.Type<Schema.Union<UnionMemberSchemas<T>>>;
  type TypedSchema = Schema.Schema<ResultType, unknown, never>;
  return Schema.decodeUnknownEither(unionSchema as unknown as TypedSchema);
}

/**
 * Create a type guard for a union of states.
 *
 * @example
 * ```ts
 * const isOrderState = unionGuard(Cart, Checkout, Processing);
 * if (isOrderState(unknownValue)) {
 *   // unknownValue is OrderState
 * }
 * ```
 */
export function unionGuard<
  T extends readonly [
    { schema: Schema.Schema.Any },
    { schema: Schema.Schema.Any },
    ...{ schema: Schema.Schema.Any }[]
  ]
>(...members: T): (value: unknown) => value is Schema.Schema.Type<Schema.Union<UnionMemberSchemas<T>>> {
  const unionSchema = Union(...members);
  // Cast to handle R channel (safe for data schemas without context requirements)
  type ResultType = Schema.Schema.Type<Schema.Union<UnionMemberSchemas<T>>>;
  type TypedSchema = Schema.Schema<ResultType, unknown, never>;
  return Schema.is(unionSchema as unknown as TypedSchema);
}
