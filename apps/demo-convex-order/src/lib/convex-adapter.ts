/**
 * Convex Adapter - Serialization helpers for EffState <-> Convex
 *
 * Types are derived from schemas in convex/schema.ts (single source of truth).
 * Uses the new EffState serialization utilities for cleaner code.
 */

import {
  createSnapshotSerializer,
  dateFieldsTransform,
} from "effstate/v3";
import type { OrderState, OrderContext, OrderSnapshot } from "@/machines/order";
import type {
  ConvexOrderItem,
  ConvexOrderState,
  ConvexOrder,
} from "../../convex/schema";

// ============================================================================
// Re-export types from schema (single source of truth)
// ============================================================================

export type { ConvexOrderItem, ConvexOrderState, ConvexOrder };

// ============================================================================
// Snapshot Serializer (using new library utilities)
// ============================================================================

/**
 * Snapshot serializer configured for Order state machine.
 *
 * Handles:
 * - State variants with Date fields (Processing, Shipped, Delivered, Cancelled)
 * - Context createdAt Date field
 */
const orderSnapshotSerializer = createSnapshotSerializer<OrderState, OrderContext>({
  state: {
    // States with Date fields need transforms
    Processing: dateFieldsTransform(["startedAt"]),
    Shipped: dateFieldsTransform(["shippedAt"]),
    Delivered: dateFieldsTransform(["deliveredAt"]),
    Cancelled: dateFieldsTransform(["cancelledAt"]),
    // Cart and Checkout have no special fields - no transform needed
  },
  context: {
    dateFields: ["createdAt"],
  },
});

// ============================================================================
// State Serialization (simplified exports)
// ============================================================================

export function serializeState(state: OrderState): ConvexOrderState {
  const serialized = orderSnapshotSerializer.serialize({ state, context: {} as OrderContext }).state;
  // Spread to plain object - Convex client can't serialize class instances
  return { ...serialized } as ConvexOrderState;
}

export function deserializeState(state: ConvexOrderState): OrderState {
  return orderSnapshotSerializer.deserialize({
    state: state as { _tag: OrderState["_tag"] },
    context: { createdAt: 0 } // Dummy context, only state is used
  }).state;
}

// ============================================================================
// Context Serialization (simplified exports)
// ============================================================================

export function serializeContext(
  context: OrderContext
): Omit<ConvexOrder, "_id" | "state"> {
  const serialized = orderSnapshotSerializer.serialize({
    state: { _tag: "Cart" } as OrderState, // Dummy state
    context,
  });

  const ctx = serialized.context as {
    orderId: string;
    customerName: string;
    items: ConvexOrderItem[];
    total: number;
    createdAt: number;
  };

  return {
    orderId: ctx.orderId,
    customerName: ctx.customerName,
    items: ctx.items,
    total: ctx.total,
    createdAt: ctx.createdAt,
  };
}

export function deserializeContext(order: ConvexOrder): OrderContext {
  const snapshot = orderSnapshotSerializer.deserialize({
    state: { _tag: "Cart" }, // Dummy state
    context: {
      orderId: order.orderId,
      customerName: order.customerName,
      items: order.items,
      total: order.total,
      createdAt: order.createdAt,
    },
  });
  return snapshot.context;
}

// ============================================================================
// Full Snapshot Conversion
// ============================================================================

export function convexOrderToSnapshot(order: ConvexOrder): OrderSnapshot {
  return orderSnapshotSerializer.deserialize({
    state: order.state as { _tag: OrderState["_tag"] },
    context: {
      orderId: order.orderId,
      customerName: order.customerName,
      items: order.items,
      total: order.total,
      createdAt: order.createdAt,
    },
  });
}

export function snapshotToConvexOrder(
  snapshot: OrderSnapshot,
  docId?: string
): ConvexOrder {
  const serialized = orderSnapshotSerializer.serialize(snapshot);
  const ctx = serialized.context as {
    orderId: string;
    customerName: string;
    items: ConvexOrderItem[];
    total: number;
    createdAt: number;
  };

  return {
    _id: docId ?? "",
    orderId: ctx.orderId,
    customerName: ctx.customerName,
    items: ctx.items,
    total: ctx.total,
    createdAt: ctx.createdAt,
    state: serialized.state as ConvexOrderState,
  };
}

// ============================================================================
// Create Order Data
// ============================================================================

export interface CreateOrderData {
  orderId: string;
  customerName: string;
  items: ConvexOrderItem[];
  total: number;
}

export function createInitialContext(data: CreateOrderData): OrderContext {
  return {
    orderId: data.orderId,
    customerName: data.customerName,
    items: data.items.map((item) => ({ ...item })),
    total: data.total,
    createdAt: new Date(),
  };
}
