/**
 * Convex Adapter Factory
 *
 * Creates type-safe adapters for EffState <-> Convex integration.
 * Handles serialization, document mapping, and plain object conversion.
 */

import type { MachineState, MachineContext } from "./types";
import type { SnapshotSerializer, SerializedState } from "./state-serializer";

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for creating a Convex adapter.
 */
export interface ConvexAdapterConfig<
  S extends MachineState,
  C extends MachineContext,
  TDocument extends { state: SerializedState },
> {
  /**
   * The snapshot serializer to use for state/context transforms.
   */
  serializer: SnapshotSerializer<S, C>;

  /**
   * Map context to document fields (excluding state).
   * Called when converting a snapshot to a Convex document.
   */
  contextToDocument: (context: C) => Omit<TDocument, "state">;

  /**
   * Map document fields to context.
   * Called when converting a Convex document to a snapshot.
   */
  documentToContext: (doc: TDocument) => C;
}

/**
 * A Convex adapter instance with type-safe serialization methods.
 */
export interface ConvexAdapter<
  S extends MachineState,
  C extends MachineContext,
  TDocument extends { state: SerializedState },
> {
  /**
   * Serialize state to a plain object for Convex.
   * Strips class prototypes that Convex client can't handle.
   */
  serializeState(state: S): SerializedState;

  /**
   * Deserialize Convex state data back to state class instance.
   */
  deserializeState(data: SerializedState): S;

  /**
   * Serialize context to plain object for Convex.
   */
  serializeContext(context: C): Record<string, unknown>;

  /**
   * Deserialize Convex context data back to context.
   */
  deserializeContext(data: Record<string, unknown>): C;

  /**
   * Convert a full snapshot to a Convex document.
   */
  toDocument(snapshot: { state: S; context: C }): TDocument;

  /**
   * Convert a Convex document to a full snapshot.
   */
  fromDocument(doc: TDocument): { state: S; context: C };

  /**
   * Create partial update data for state changes only.
   * Useful for mutations that only update state.
   */
  stateUpdate(state: S): { state: SerializedState };

  /**
   * Create partial update data for context changes.
   * Returns all context fields serialized (excludes state).
   */
  contextUpdate(context: C): Omit<TDocument, "state">;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a type-safe Convex adapter for an EffState machine.
 *
 * @example
 * ```ts
 * const orderAdapter = createConvexAdapter<OrderState, OrderContext, ConvexOrder>({
 *   serializer: orderSnapshotSerializer,
 *
 *   contextToDocument: (ctx) => ({
 *     _id: "",
 *     orderId: ctx.orderId,
 *     customerName: ctx.customerName,
 *     items: ctx.items,
 *     total: ctx.total,
 *     createdAt: ctx.createdAt.getTime(),
 *   }),
 *
 *   documentToContext: (doc) => ({
 *     orderId: doc.orderId,
 *     customerName: doc.customerName,
 *     items: doc.items,
 *     total: doc.total,
 *     createdAt: new Date(doc.createdAt),
 *   }),
 * });
 *
 * // Usage:
 * const state = adapter.serializeState(snapshot.state);
 * const doc = adapter.toDocument(snapshot);
 * const snapshot = adapter.fromDocument(convexDoc);
 * ```
 */
export function createConvexAdapter<
  S extends MachineState,
  C extends MachineContext,
  TDocument extends { state: SerializedState },
>(config: ConvexAdapterConfig<S, C, TDocument>): ConvexAdapter<S, C, TDocument> {
  const { serializer, contextToDocument, documentToContext } = config;

  return {
    serializeState(state: S): SerializedState {
      return serializer.serializeState(state);
    },

    deserializeState(data: SerializedState): S {
      return serializer.deserializeState(data);
    },

    serializeContext(context: C): Record<string, unknown> {
      return serializer.serializeContext(context);
    },

    deserializeContext(data: Record<string, unknown>): C {
      return serializer.deserializeContext(data);
    },

    toDocument(snapshot: { state: S; context: C }): TDocument {
      const serializedState = serializer.serializeState(snapshot.state);
      const docFields = contextToDocument(snapshot.context);

      return {
        ...docFields,
        state: serializedState,
      } as TDocument;
    },

    fromDocument(doc: TDocument): { state: S; context: C } {
      const state = serializer.deserializeState(doc.state);
      const context = documentToContext(doc);

      return { state, context };
    },

    stateUpdate(state: S): { state: SerializedState } {
      return {
        state: serializer.serializeState(state),
      };
    },

    contextUpdate(context: C): Omit<TDocument, "state"> {
      return contextToDocument(context);
    },
  };
}

// ============================================================================
// Helper Types
// ============================================================================

/**
 * Extract the document type from a ConvexAdapter.
 */
export type AdapterDocument<T> = T extends ConvexAdapter<
  MachineState,
  MachineContext,
  infer D
>
  ? D
  : never;

/**
 * Extract the state type from a ConvexAdapter.
 */
export type AdapterState<T> = T extends ConvexAdapter<
  infer S,
  MachineContext,
  { state: SerializedState }
>
  ? S
  : never;

/**
 * Extract the context type from a ConvexAdapter.
 */
export type AdapterContext<T> = T extends ConvexAdapter<
  MachineState,
  infer C,
  { state: SerializedState }
>
  ? C
  : never;
