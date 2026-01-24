/**
 * EffState v4 - Schema-First State Definitions
 *
 * Define states and events with bundled schemas, constructors, and type guards.
 * Single source of truth: define once, use everywhere.
 *
 * Note on type casts: This file contains minimal `as unknown as` casts that are
 * sound but unavoidable due to TypeScript limitations (see inline comments).
 */

import { Either, Schema, ParseResult } from "effect";

// ============================================================================
// Type Utilities
// ============================================================================

/** Fields that can be used in State/Event schemas */
export type SchemaFields = Schema.Struct.Fields;

/** Compute the runtime type from a tag and fields */
type ComputeStateType<TTag extends string, TFields extends SchemaFields> =
  { readonly _tag: TTag } & Schema.Schema.Type<Schema.Struct<TFields>>;

/** Compute fields-only type (without _tag) */
type ComputeFieldsOnly<TTag extends string, TFields extends SchemaFields> =
  TFields extends Record<string, never>
    ? void
    : Omit<ComputeStateType<TTag, TFields>, "_tag">;

// ============================================================================
// State Definition
// ============================================================================

/** A state definition with schema, constructor, and type guard */
export interface StateDefinition<TTag extends string, TFields extends SchemaFields> {
  /** The state tag */
  readonly tag: TTag;

  /**
   * The Effect Schema for this state.
   *
   * Use Schema.Schema.Type<typeof MyState.schema> to extract the type,
   * or simply use StateType<typeof MyState> for convenience.
   */
  readonly schema: Schema.Schema<ComputeStateType<TTag, TFields>, unknown, never>;

  /** Create a state instance (unchecked) */
  readonly make: TFields extends Record<string, never>
    ? () => ComputeStateType<TTag, TFields>
    : (data: ComputeFieldsOnly<TTag, TFields>) => ComputeStateType<TTag, TFields>;

  /** Create a state instance with validation */
  readonly safeMake: TFields extends Record<string, never>
    ? () => Either.Either<ComputeStateType<TTag, TFields>, ParseResult.ParseError>
    : (data: ComputeFieldsOnly<TTag, TFields>) => Either.Either<ComputeStateType<TTag, TFields>, ParseResult.ParseError>;

  /** Type guard for this state */
  readonly is: (value: unknown) => value is ComputeStateType<TTag, TFields>;
}

/** Extract the type from a StateDefinition */
export type StateType<T> = T extends StateDefinition<infer TTag, infer TFields>
  ? ComputeStateType<TTag, TFields>
  : never;

/**
 * Create a schema-first state definition.
 *
 * @example
 * ```ts
 * const Idle = State("Idle", {});
 * const Running = State("Running", { startedAt: Schema.DateFromSelf });
 *
 * type MyState = StateType<typeof Idle> | StateType<typeof Running>;
 *
 * const idle = Idle.make();
 * const running = Running.make({ startedAt: new Date() });
 *
 * if (Idle.is(someValue)) {
 *   // someValue is narrowed to { _tag: "Idle" }
 * }
 * ```
 */
export function State<TTag extends string, TFields extends SchemaFields>(
  tag: TTag,
  fields: TFields
): StateDefinition<TTag, TFields> {
  // Build the schema
  const schema = Schema.Struct({
    _tag: Schema.Literal(tag),
    ...fields,
  });

  // Type aliases for cleaner code
  type StateType = ComputeStateType<TTag, TFields>;
  type FieldsOnly = ComputeFieldsOnly<TTag, TFields>;

  // Cast to interface schema type (safe: data schemas have no R requirements)
  // The Encoded type is erased to `unknown` in the interface for simpler generics,
  // but the runtime schema retains full Encoded information for serialization.
  type InterfaceSchemaType = Schema.Schema<StateType, unknown, never>;
  const typedSchema = schema as unknown as InterfaceSchemaType;

  // Type guard using Schema.is (validates ALL fields)
  const is: (value: unknown) => value is StateType = Schema.is(typedSchema);

  // Decoder for validation
  const decode = Schema.decodeUnknownEither(typedSchema);

  // Unchecked constructor
  const makeImpl = (data?: FieldsOnly): StateType => {
    // Sound: constructing exactly what the type describes
    return { _tag: tag, ...data } as unknown as StateType;
  };

  // Validated constructor
  const safeMakeImpl = (data?: FieldsOnly): Either.Either<StateType, ParseResult.ParseError> => {
    return decode({ _tag: tag, ...data });
  };

  // Build result with proper typing
  const hasFields = Object.keys(fields).length > 0;

  if (hasFields) {
    return {
      tag,
      schema: typedSchema,
      make: makeImpl as StateDefinition<TTag, TFields>["make"],
      safeMake: safeMakeImpl as StateDefinition<TTag, TFields>["safeMake"],
      is,
    };
  } else {
    return {
      tag,
      schema: typedSchema,
      make: (() => makeImpl()) as StateDefinition<TTag, TFields>["make"],
      safeMake: (() => safeMakeImpl()) as StateDefinition<TTag, TFields>["safeMake"],
      is,
    };
  }
}

// ============================================================================
// Event Definition (alias for State)
// ============================================================================

/** Extract the type from an EventDefinition */
export type EventType<T> = StateType<T>;

/**
 * Create a schema-first event definition.
 * (Same as State, but semantically for events)
 *
 * @example
 * ```ts
 * const Click = Event("Click", {});
 * const SetValue = Event("SetValue", { value: Schema.Number });
 *
 * type MyEvent = EventType<typeof Click> | EventType<typeof SetValue>;
 *
 * actor.send(Click.make());
 * actor.send(SetValue.make({ value: 42 }));
 * ```
 */
export const Event = State;

// ============================================================================
// Union Helpers
// ============================================================================

/** Extract schema types from an array of state definitions */
type UnionMemberSchemas<T extends readonly { schema: Schema.Schema.Any }[]> = {
  [K in keyof T]: T[K] extends { schema: infer S } ? S : never;
};

/**
 * Create a union schema from state/event definitions.
 *
 * @example
 * ```ts
 * const Idle = State("Idle", {});
 * const Running = State("Running", { startedAt: Schema.DateFromSelf });
 *
 * const MyStateSchema = Union(Idle, Running);
 * // Schema for: { _tag: "Idle" } | { _tag: "Running", startedAt: Date }
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
  const [first, second, ...rest] = schemas;

  return Schema.Union(
    first as Schema.Schema.Any,
    second as Schema.Schema.Any,
    ...(rest as Schema.Schema.Any[])
  ) as Schema.Union<UnionMemberSchemas<T>>;
}

/** Compute the union type from state/event definitions */
export type UnionType<T extends readonly { schema: Schema.Schema.Any }[]> =
  Schema.Schema.Type<Schema.Union<UnionMemberSchemas<T>>>;
