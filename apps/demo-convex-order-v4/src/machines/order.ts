/**
 * Order Processing State Machine - EffState v4
 *
 * Schema-first approach: ONE definition serves both EffState AND Confect.
 * No serialization layer needed!
 *
 * States: Cart -> Checkout -> Processing -> Shipped -> Delivered
 *         (can be Cancelled from Cart, Checkout, Processing)
 */

import { Match, pipe, Schema } from "effect";
import { State, Event, Union, defineMachine } from "effstate/v4";
import type { MachineActor, MachineSnapshot } from "effstate/v4";

// ============================================================================
// States (Single source of truth - works with both EffState AND Confect!)
// ============================================================================

export const Cart = State("Cart", {});
export const Checkout = State("Checkout", {});
export const Processing = State("Processing", {
  startedAt: Schema.Number, // Unix timestamp - Convex compatible!
});
export const Shipped = State("Shipped", {
  trackingNumber: Schema.String,
  shippedAt: Schema.Number,
});
export const Delivered = State("Delivered", {
  deliveredAt: Schema.Number,
});
export const Cancelled = State("Cancelled", {
  reason: Schema.String,
  cancelledAt: Schema.Number,
});

/** Union schema - use this with Confect! */
export const OrderStateSchema = Union(Cart, Checkout, Processing, Shipped, Delivered, Cancelled);
export type OrderState = Schema.Schema.Type<typeof OrderStateSchema>;

// ============================================================================
// Context (also schema-first)
// ============================================================================

export const OrderItemSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  quantity: Schema.Number,
  price: Schema.Number,
});
export type OrderItem = Schema.Schema.Type<typeof OrderItemSchema>;

export const OrderContextSchema = Schema.Struct({
  orderId: Schema.String,
  customerName: Schema.String,
  items: Schema.Array(OrderItemSchema),
  total: Schema.Number,
  createdAt: Schema.Number, // Unix timestamp
});
export type OrderContext = Schema.Schema.Type<typeof OrderContextSchema>;

// ============================================================================
// Events (schema-first)
// ============================================================================

export const AddItem = Event("AddItem", { item: OrderItemSchema });
export const RemoveItem = Event("RemoveItem", { itemId: Schema.String });
export const UpdateQuantity = Event("UpdateQuantity", {
  itemId: Schema.String,
  quantity: Schema.Number,
});
export const ProceedToCheckout = Event("ProceedToCheckout", {});
export const PlaceOrder = Event("PlaceOrder", {});
export const MarkShipped = Event("MarkShipped", { trackingNumber: Schema.String });
export const MarkDelivered = Event("MarkDelivered", {});
export const CancelOrder = Event("CancelOrder", { reason: Schema.String });
export const BackToCart = Event("BackToCart", {});

export const OrderEventSchema = Union(
  AddItem,
  RemoveItem,
  UpdateQuantity,
  ProceedToCheckout,
  PlaceOrder,
  MarkShipped,
  MarkDelivered,
  CancelOrder,
  BackToCart
);
export type OrderEvent = Schema.Schema.Type<typeof OrderEventSchema>;

// ============================================================================
// Helper Functions
// ============================================================================

function calculateTotal(items: readonly OrderItem[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

function addItemToList(items: readonly OrderItem[], newItem: OrderItem): OrderItem[] {
  const existingIndex = items.findIndex((i) => i.id === newItem.id);
  if (existingIndex >= 0) {
    return items.map((item, index) =>
      index === existingIndex ? { ...item, quantity: item.quantity + newItem.quantity } : item
    );
  }
  return [...items, newItem];
}

function removeItemFromList(items: readonly OrderItem[], itemId: string): OrderItem[] {
  return items.filter((item) => item.id !== itemId);
}

function updateItemQuantity(items: readonly OrderItem[], itemId: string, quantity: number): OrderItem[] {
  if (quantity <= 0) return removeItemFromList(items, itemId);
  return items.map((item) => (item.id === itemId ? { ...item, quantity } : item));
}

// ============================================================================
// Machine Definition
// ============================================================================

export function createOrderMachine(initialContext: OrderContext) {
  return defineMachine<OrderState, OrderContext, OrderEvent>({
    id: `order-${initialContext.orderId}`,
    initial: Cart.make(),
    context: initialContext,

    states: {
      Cart: {
        on: {
          AddItem: (ctx, event) => {
            const newItems = addItemToList(ctx.items, event.item);
            return { update: { items: newItems, total: calculateTotal(newItems) } };
          },
          RemoveItem: (ctx, event) => {
            const newItems = removeItemFromList(ctx.items, event.itemId);
            return { update: { items: newItems, total: calculateTotal(newItems) } };
          },
          UpdateQuantity: (ctx, event) => {
            const newItems = updateItemQuantity(ctx.items, event.itemId, event.quantity);
            return { update: { items: newItems, total: calculateTotal(newItems) } };
          },
          ProceedToCheckout: (ctx) =>
            ctx.items.length > 0 ? { goto: Checkout.make() } : null,
          CancelOrder: (_ctx, event) => ({
            goto: Cancelled.make({
              reason: event.reason ?? "Customer cancelled",
              cancelledAt: Date.now(),
            }),
          }),
        },
      },

      Checkout: {
        on: {
          BackToCart: () => ({ goto: Cart.make() }),
          PlaceOrder: () => ({ goto: Processing.make({ startedAt: Date.now() }) }),
          CancelOrder: (_ctx, event) => ({
            goto: Cancelled.make({
              reason: event.reason ?? "Customer cancelled",
              cancelledAt: Date.now(),
            }),
          }),
        },
      },

      Processing: {
        on: {
          MarkShipped: (_ctx, event) => ({
            goto: Shipped.make({
              trackingNumber: event.trackingNumber,
              shippedAt: Date.now(),
            }),
          }),
          CancelOrder: (_ctx, event) => ({
            goto: Cancelled.make({
              reason: event.reason ?? "Order cancelled",
              cancelledAt: Date.now(),
            }),
          }),
        },
      },

      Shipped: {
        on: {
          MarkDelivered: () => ({ goto: Delivered.make({ deliveredAt: Date.now() }) }),
        },
      },

      Delivered: { on: {} },
      Cancelled: { on: {} },
    },
  });
}

// ============================================================================
// Types
// ============================================================================

export type OrderMachine = ReturnType<typeof createOrderMachine>;
export type OrderActor = MachineActor<OrderState, OrderContext, OrderEvent>;
export type OrderSnapshot = MachineSnapshot<OrderState, OrderContext>;

// ============================================================================
// ID Generator
// ============================================================================

export const generateOrderId = (): string =>
  `ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

// ============================================================================
// State Helpers (Match-based)
// ============================================================================

export const getOrderStateLabel = (state: OrderState): string =>
  pipe(
    Match.value(state),
    Match.tag("Cart", () => "In Cart"),
    Match.tag("Checkout", () => "Checkout"),
    Match.tag("Processing", () => "Processing"),
    Match.tag("Shipped", () => "Shipped"),
    Match.tag("Delivered", () => "Delivered"),
    Match.tag("Cancelled", () => "Cancelled"),
    Match.exhaustive
  );

export const getOrderStateColor = (state: OrderState): string =>
  pipe(
    Match.value(state),
    Match.tag("Cart", () => "bg-gray-500"),
    Match.tag("Checkout", () => "bg-blue-500"),
    Match.tag("Processing", () => "bg-yellow-500"),
    Match.tag("Shipped", () => "bg-purple-500"),
    Match.tag("Delivered", () => "bg-green-500"),
    Match.tag("Cancelled", () => "bg-red-500"),
    Match.exhaustive
  );

const CancellableStates = ["Cart", "Checkout", "Processing"] as const;
export const canCancel = (state: OrderState): boolean =>
  (CancellableStates as readonly string[]).includes(state._tag);

const TerminalStates = ["Delivered", "Cancelled"] as const;
export const isTerminalState = (state: OrderState): boolean =>
  (TerminalStates as readonly string[]).includes(state._tag);
