/**
 * State Serializer Utility
 *
 * Provides type-safe serialization/deserialization for discriminated union states.
 * Handles common transforms like Date <-> number automatically when configured.
 */

import type { MachineState, MachineContext, StateByTag } from "./types";

// ============================================================================
// Types
// ============================================================================

/**
 * Transform functions for a specific state variant.
 * Only needed for states with non-JSON-safe fields (Date, Map, Set, etc.)
 */
export interface StateTransform<TState, TSerialized> {
  serialize: (state: TState) => TSerialized;
  deserialize: (data: TSerialized) => TState;
}

/**
 * Configuration for state serializer.
 * Map state tags to their transform functions.
 */
export type StateSerializerConfig<S extends MachineState> = {
  [K in S["_tag"]]?: StateTransform<StateByTag<S, K>, SerializedState>;
};

/**
 * Serialized state format - preserves _tag for deserialization routing
 */
export interface SerializedState {
  readonly _tag: string;
  readonly [key: string]: unknown;
}

/**
 * State serializer instance
 */
export interface StateSerializer<S extends MachineState> {
  serialize(state: S): SerializedState;
  deserialize(data: SerializedState): S;
  hasTransform(tag: S["_tag"]): boolean;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a type-safe state serializer.
 *
 * States without explicit transforms are passed through as-is (identity transform).
 * Only provide transforms for states with non-JSON-safe fields like Date.
 *
 * @example
 * ```ts
 * type OrderState =
 *   | { _tag: "Cart" }
 *   | { _tag: "Processing"; startedAt: Date }
 *   | { _tag: "Shipped"; trackingNumber: string; shippedAt: Date };
 *
 * const serializer = createStateSerializer<OrderState>({
 *   Processing: {
 *     serialize: (s) => ({ _tag: "Processing", startedAt: s.startedAt.getTime() }),
 *     deserialize: (d) => ({ _tag: "Processing", startedAt: new Date(d.startedAt as number) }),
 *   },
 *   Shipped: {
 *     serialize: (s) => ({ _tag: "Shipped", trackingNumber: s.trackingNumber, shippedAt: s.shippedAt.getTime() }),
 *     deserialize: (d) => ({ _tag: "Shipped", trackingNumber: d.trackingNumber as string, shippedAt: new Date(d.shippedAt as number) }),
 *   },
 * });
 * ```
 */
export function createStateSerializer<S extends MachineState>(
  config: StateSerializerConfig<S> = {}
): StateSerializer<S> {
  const transforms = config as Record<string, StateTransform<S, SerializedState> | undefined>;

  return {
    serialize(state: S): SerializedState {
      const transform = transforms[state._tag];
      if (transform) {
        return transform.serialize(state);
      }
      // Identity transform - state is already JSON-safe
      return state as SerializedState;
    },

    deserialize(data: SerializedState): S {
      const transform = transforms[data._tag];
      if (transform) {
        return transform.deserialize(data);
      }
      // Identity transform
      return data as S;
    },

    hasTransform(tag: S["_tag"]): boolean {
      return tag in transforms;
    },
  };
}

// ============================================================================
// Common Transform Helpers
// ============================================================================

/**
 * Create transforms for multiple Date fields in a state.
 *
 * @example
 * ```ts
 * const serializer = createStateSerializer<OrderState>({
 *   Shipped: dateFieldsTransform(["shippedAt"]),
 *   Processing: dateFieldsTransform(["startedAt"]),
 * });
 * ```
 */
export function dateFieldsTransform<S extends MachineState>(
  fields: readonly string[]
): StateTransform<S, SerializedState> {
  return {
    serialize: (state: S): SerializedState => {
      const result: Record<string, unknown> = { ...state };
      for (const field of fields) {
        const value = result[field];
        if (value instanceof Date) {
          result[field] = value.getTime();
        }
      }
      return result as SerializedState;
    },
    deserialize: (data: SerializedState): S => {
      const result: Record<string, unknown> = { ...data };
      for (const field of fields) {
        const value = result[field];
        if (typeof value === "number") {
          result[field] = new Date(value);
        }
      }
      return result as S;
    },
  };
}

// ============================================================================
// Context Serializer
// ============================================================================

/**
 * Transform for a context field.
 */
export interface FieldTransform<T> {
  serialize: (value: T) => unknown;
  deserialize: (data: unknown) => T;
}

/**
 * Configuration for context serializer.
 */
export interface ContextSerializerConfig<C extends MachineContext> {
  dateFields?: readonly (keyof C)[];
  transforms?: Partial<Record<keyof C, FieldTransform<C[keyof C]>>>;
}

/**
 * Context serializer instance
 */
export interface ContextSerializer<C extends MachineContext> {
  serialize(context: C): Record<string, unknown>;
  deserialize(data: Record<string, unknown>): C;
}

/**
 * Create a context serializer with common transforms.
 *
 * @example
 * ```ts
 * const contextSerializer = createContextSerializer<OrderContext>({
 *   dateFields: ["createdAt"],
 * });
 * ```
 */
export function createContextSerializer<C extends MachineContext>(
  config: ContextSerializerConfig<C> = {}
): ContextSerializer<C> {
  const { dateFields = [], transforms = {} } = config;
  const dateFieldSet = new Set(dateFields as unknown[]);
  const transformMap = transforms as Record<string, FieldTransform<unknown> | undefined>;

  return {
    serialize(context: C): Record<string, unknown> {
      const result: Record<string, unknown> = { ...(context as Record<string, unknown>) };

      for (const field of Object.keys(result)) {
        if (dateFieldSet.has(field)) {
          const value = result[field];
          if (value instanceof Date) {
            result[field] = value.getTime();
          }
        }
        const transform = transformMap[field];
        if (transform) {
          result[field] = transform.serialize(result[field]);
        }
      }

      return result;
    },

    deserialize(data: Record<string, unknown>): C {
      const result: Record<string, unknown> = { ...data };

      for (const field of Object.keys(result)) {
        if (dateFieldSet.has(field)) {
          const value = result[field];
          if (typeof value === "number") {
            result[field] = new Date(value);
          }
        }
        const transform = transformMap[field];
        if (transform) {
          result[field] = transform.deserialize(result[field]);
        }
      }

      return result as C;
    },
  };
}

// ============================================================================
// Combined Snapshot Serializer
// ============================================================================

/**
 * Serialized snapshot format
 */
export interface SerializedSnapshot {
  readonly state: SerializedState;
  readonly context: Record<string, unknown>;
}

/**
 * Snapshot serializer combining state and context serialization
 */
export interface SnapshotSerializer<S extends MachineState, C extends MachineContext> {
  serialize(snapshot: { state: S; context: C }): SerializedSnapshot;
  deserialize(data: SerializedSnapshot): { state: S; context: C };
}

/**
 * Create a combined snapshot serializer.
 *
 * @example
 * ```ts
 * const snapshotSerializer = createSnapshotSerializer<OrderState, OrderContext>({
 *   state: {
 *     Processing: dateFieldsTransform(["startedAt"]),
 *     Shipped: dateFieldsTransform(["shippedAt"]),
 *   },
 *   context: {
 *     dateFields: ["createdAt"],
 *   },
 * });
 * ```
 */
export function createSnapshotSerializer<S extends MachineState, C extends MachineContext>(config: {
  state?: StateSerializerConfig<S>;
  context?: ContextSerializerConfig<C>;
}): SnapshotSerializer<S, C> {
  const stateSerializer = createStateSerializer<S>(config.state ?? {});
  const contextSerializer = createContextSerializer<C>(config.context ?? {});

  return {
    serialize(snapshot): SerializedSnapshot {
      return {
        state: stateSerializer.serialize(snapshot.state),
        context: contextSerializer.serialize(snapshot.context),
      };
    },
    deserialize(data): { state: S; context: C } {
      return {
        state: stateSerializer.deserialize(data.state),
        context: contextSerializer.deserialize(data.context),
      };
    },
  };
}
