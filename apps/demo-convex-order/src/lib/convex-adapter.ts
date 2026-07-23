/**
 * Convex Adapter - Serialization helpers for EffState <-> Convex
 *
 * Uses the new EffState Convex adapter factory for minimal boilerplate.
 * Types are derived from schemas in convex/schema.ts (single source of truth).
 */

import { createSnapshotSerializer, createConvexAdapter, dateFieldsTransform } from "effstate/v3";
import type { OrderState, OrderContext, OrderSnapshot } from "@/machines/order";
import type { ConvexOrderItem, ConvexOrderState, ConvexOrder } from "../../convex/schema";

// ============================================================================
// Re-export types from schema (single source of truth)
// ============================================================================

export type { ConvexOrderItem, ConvexOrderState, ConvexOrder };

// ============================================================================
// Snapshot Serializer
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
    Processing: dateFieldsTransform(["startedAt"]),
    Shipped: dateFieldsTransform(["shippedAt"]),
    Delivered: dateFieldsTransform(["deliveredAt"]),
    Cancelled: dateFieldsTransform(["cancelledAt"]),
  },
  context: {
    dateFields: ["createdAt"],
  },
});

// ============================================================================
// Convex Adapter (using new factory!)
// ============================================================================

/**
 * Order adapter for Convex integration.
 *
 * Provides all serialization/deserialization methods in one object.
 */
export const orderAdapter = createConvexAdapter<OrderState, OrderContext, ConvexOrder>({
  serializer: orderSnapshotSerializer,

  contextToDocument: (ctx) => ({
    _id: "",
    orderId: ctx.orderId,
    customerName: ctx.customerName,
    items: ctx.items.map((item) => ({ ...item })),
    total: ctx.total,
    createdAt: ctx.createdAt instanceof Date ? ctx.createdAt.getTime() : (ctx.createdAt as number),
  }),

  documentToContext: (doc) => ({
    orderId: doc.orderId,
    customerName: doc.customerName,
    items: doc.items.map((item) => ({ ...item })),
    total: doc.total,
    createdAt: new Date(doc.createdAt),
  }),
});

// ============================================================================
// Convenience Exports
// ============================================================================

/** Serialize state to plain object for Convex */
export const serializeState = (state: OrderState): ConvexOrderState =>
  orderAdapter.serializeState(state) as ConvexOrderState;

/** Convert Convex document to snapshot */
export const convexOrderToSnapshot = (order: ConvexOrder): OrderSnapshot =>
  orderAdapter.fromDocument(order);

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
