import { Effect, ParseResult, Schema } from "effect";
import type { MachineContext, MachineDefinition, MachineSnapshot } from "./types.js";

// ============================================================================
// Encoded Snapshot Type
// ============================================================================

/**
 * The JSON-safe encoded format of a snapshot.
 */
export interface EncodedSnapshot<TStateValue extends string, TContextEncoded> {
  readonly value: TStateValue;
  readonly context: TContextEncoded;
}

// ============================================================================
// Encoding/Decoding Utilities
// ============================================================================

/**
 * Encode a snapshot to a JSON-safe format.
 *
 * @example
 * ```ts
 * const encoded = yield* encodeSnapshot(machine, actor.getSnapshot());
 * localStorage.setItem("state", JSON.stringify(encoded));
 * ```
 */
export const encodeSnapshot = <
  TStateValue extends string,
  TContext extends MachineContext,
  TContextEncoded,
>(
  machine: MachineDefinition<string, TStateValue, TContext, any, any, any, TContextEncoded>,
  snapshot: MachineSnapshot<TStateValue, TContext>,
): Effect.Effect<EncodedSnapshot<TStateValue, TContextEncoded>, ParseResult.ParseError> =>
  Effect.map(
    Schema.encode(machine.contextSchema)(snapshot.context),
    (context) => ({
      value: snapshot.value,
      context,
    }),
  );

/**
 * Encode a snapshot to a JSON-safe format (sync, throws on error).
 */
export const encodeSnapshotSync = <
  TStateValue extends string,
  TContext extends MachineContext,
  TContextEncoded,
>(
  machine: MachineDefinition<string, TStateValue, TContext, any, any, any, TContextEncoded>,
  snapshot: MachineSnapshot<TStateValue, TContext>,
): EncodedSnapshot<TStateValue, TContextEncoded> => ({
  value: snapshot.value,
  context: Schema.encodeSync(machine.contextSchema)(snapshot.context),
});

/**
 * Decode a snapshot from a JSON-safe format.
 *
 * @example
 * ```ts
 * const stored = JSON.parse(localStorage.getItem("state")!);
 * const snapshot = yield* decodeSnapshot(machine, stored);
 * const actor = yield* interpret(machine, { snapshot });
 * ```
 */
export const decodeSnapshot = <
  TStateValue extends string,
  TContext extends MachineContext,
  TContextEncoded,
>(
  machine: MachineDefinition<string, TStateValue, TContext, any, any, any, TContextEncoded>,
  encoded: EncodedSnapshot<TStateValue, TContextEncoded>,
): Effect.Effect<MachineSnapshot<TStateValue, TContext>, ParseResult.ParseError> =>
  Effect.map(
    Schema.decode(machine.contextSchema)(encoded.context),
    (context) => ({
      value: encoded.value,
      context,
      event: null,
    }),
  );

/**
 * Decode a snapshot from a JSON-safe format (sync, throws on error).
 */
export const decodeSnapshotSync = <
  TStateValue extends string,
  TContext extends MachineContext,
  TContextEncoded,
>(
  machine: MachineDefinition<string, TStateValue, TContext, any, any, any, TContextEncoded>,
  encoded: EncodedSnapshot<TStateValue, TContextEncoded>,
): MachineSnapshot<TStateValue, TContext> => ({
  value: encoded.value,
  context: Schema.decodeSync(machine.contextSchema)(encoded.context),
  event: null,
});

// ============================================================================
// Snapshot Schema Builder (for advanced use)
// ============================================================================

/**
 * Get the context schema from a machine definition.
 */
export const getContextSchema = <
  TContext extends MachineContext,
  TContextEncoded,
>(
  machine: MachineDefinition<string, string, TContext, any, any, any, TContextEncoded>,
): Schema.Schema<TContext, TContextEncoded> => machine.contextSchema;

/**
 * Create a Schema for the encoded snapshot format.
 * Useful for validation when loading from external sources.
 *
 * @example
 * ```ts
 * const schema = createSnapshotSchema(machine);
 * const validated = Schema.decodeUnknownSync(schema)(untrustedData);
 * ```
 */
export const createSnapshotSchema = <
  TStateValue extends string,
  TContext extends MachineContext,
  TContextEncoded,
>(
  machine: MachineDefinition<string, TStateValue, TContext, any, any, any, TContextEncoded>,
): Schema.Schema<
  MachineSnapshot<TStateValue, TContext>,
  EncodedSnapshot<TStateValue, TContextEncoded>
> => {
  const contextSchema = machine.contextSchema;
  const encodedContextSchema = Schema.encodedSchema(contextSchema);

  return Schema.transform(
    Schema.Struct({
      value: Schema.String,
      context: encodedContextSchema,
    }),
    Schema.Struct({
      value: Schema.String,
      context: contextSchema,
      event: Schema.NullOr(Schema.Unknown),
    }),
    {
      strict: true,
      decode: (encoded) => ({ ...encoded, event: null }),
      encode: (snapshot) => ({ value: snapshot.value, context: snapshot.context }),
    },
  ) as unknown as Schema.Schema<
    MachineSnapshot<TStateValue, TContext>,
    EncodedSnapshot<TStateValue, TContextEncoded>
  >;
};
