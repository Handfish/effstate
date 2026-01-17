/**
 * Convex Adapter - Serialization helpers for EffState <-> Convex
 */

import type { OrderState, OrderContext, OrderSnapshot } from "@/machines/order";
import { OrderState as OS } from "@/machines/order";

// ============================================================================
// Convex Types (matches schema.ts)
// ============================================================================

export interface ConvexOrderItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
}

export type ConvexOrderState =
  | { _tag: "Cart" }
  | { _tag: "Checkout" }
  | { _tag: "Processing"; startedAt: number }
  | { _tag: "Shipped"; trackingNumber: string; shippedAt: number }
  | { _tag: "Delivered"; deliveredAt: number }
  | { _tag: "Cancelled"; reason: string; cancelledAt: number };

export interface ConvexOrder {
  _id: string;
  orderId: string;
  customerName: string;
  items: ConvexOrderItem[];
  total: number;
  createdAt: number;
  state: ConvexOrderState;
}

// ============================================================================
// State Serialization
// ============================================================================

export function serializeState(state: OrderState): ConvexOrderState {
  switch (state._tag) {
    case "Cart":
      return { _tag: "Cart" };
    case "Checkout":
      return { _tag: "Checkout" };
    case "Processing":
      return { _tag: "Processing", startedAt: state.startedAt.getTime() };
    case "Shipped":
      return {
        _tag: "Shipped",
        trackingNumber: state.trackingNumber,
        shippedAt: state.shippedAt.getTime(),
      };
    case "Delivered":
      return { _tag: "Delivered", deliveredAt: state.deliveredAt.getTime() };
    case "Cancelled":
      return {
        _tag: "Cancelled",
        reason: state.reason,
        cancelledAt: state.cancelledAt.getTime(),
      };
  }
}

export function deserializeState(state: ConvexOrderState): OrderState {
  switch (state._tag) {
    case "Cart":
      return OS.Cart();
    case "Checkout":
      return OS.Checkout();
    case "Processing":
      return OS.Processing(new Date(state.startedAt));
    case "Shipped":
      return OS.Shipped(state.trackingNumber, new Date(state.shippedAt));
    case "Delivered":
      return OS.Delivered(new Date(state.deliveredAt));
    case "Cancelled":
      return OS.Cancelled(state.reason, new Date(state.cancelledAt));
  }
}

// ============================================================================
// Context Serialization
// ============================================================================

export function serializeContext(
  context: OrderContext
): Omit<ConvexOrder, "_id" | "state"> {
  return {
    orderId: context.orderId,
    customerName: context.customerName,
    items: context.items.map((item) => ({ ...item })),
    total: context.total,
    createdAt: context.createdAt.getTime(),
  };
}

export function deserializeContext(order: ConvexOrder): OrderContext {
  return {
    orderId: order.orderId,
    customerName: order.customerName,
    items: order.items.map((item) => ({ ...item })),
    total: order.total,
    createdAt: new Date(order.createdAt),
  };
}

// ============================================================================
// Full Snapshot Conversion
// ============================================================================

export function convexOrderToSnapshot(order: ConvexOrder): OrderSnapshot {
  return {
    state: deserializeState(order.state),
    context: deserializeContext(order),
  };
}

export function snapshotToConvexOrder(
  snapshot: OrderSnapshot,
  docId?: string
): ConvexOrder {
  return {
    _id: docId ?? "",
    ...serializeContext(snapshot.context),
    state: serializeState(snapshot.state),
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
