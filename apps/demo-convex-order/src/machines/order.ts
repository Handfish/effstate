/**
 * Order Processing State Machine - EffState v3
 *
 * States: Cart -> Checkout -> Processing -> Shipped -> Delivered
 *         (can be Cancelled from Cart, Checkout, Processing)
 */

import { Data, Schema } from "effect";
import { defineMachine, type MachineActor, type MachineSnapshot } from "effstate/v3";

// ============================================================================
// State (Discriminated Union)
// ============================================================================

export type OrderState =
  | { readonly _tag: "Cart" }
  | { readonly _tag: "Checkout" }
  | { readonly _tag: "Processing"; readonly startedAt: Date }
  | { readonly _tag: "Shipped"; readonly trackingNumber: string; readonly shippedAt: Date }
  | { readonly _tag: "Delivered"; readonly deliveredAt: Date }
  | { readonly _tag: "Cancelled"; readonly reason: string; readonly cancelledAt: Date };

export const OrderState = {
  Cart: (): OrderState => ({ _tag: "Cart" }),
  Checkout: (): OrderState => ({ _tag: "Checkout" }),
  Processing: (startedAt: Date = new Date()): OrderState => ({ _tag: "Processing", startedAt }),
  Shipped: (trackingNumber: string, shippedAt: Date = new Date()): OrderState => ({
    _tag: "Shipped",
    trackingNumber,
    shippedAt,
  }),
  Delivered: (deliveredAt: Date = new Date()): OrderState => ({ _tag: "Delivered", deliveredAt }),
  Cancelled: (reason: string, cancelledAt: Date = new Date()): OrderState => ({
    _tag: "Cancelled",
    reason,
    cancelledAt,
  }),
};

// ============================================================================
// Context
// ============================================================================

export interface OrderItem {
  readonly id: string;
  readonly name: string;
  readonly quantity: number;
  readonly price: number;
}

export interface OrderContext {
  readonly orderId: string;
  readonly customerName: string;
  readonly items: readonly OrderItem[];
  readonly total: number;
  readonly createdAt: Date;
}

const OrderItemSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  quantity: Schema.Number,
  price: Schema.Number,
});

const OrderContextSchema = Schema.Struct({
  orderId: Schema.String,
  customerName: Schema.String,
  items: Schema.Array(OrderItemSchema),
  total: Schema.Number,
  createdAt: Schema.DateFromSelf,
});

// ============================================================================
// Events
// ============================================================================

export class AddItem extends Data.TaggedClass("AddItem")<{
  readonly item: OrderItem;
}> {}

export class RemoveItem extends Data.TaggedClass("RemoveItem")<{
  readonly itemId: string;
}> {}

export class UpdateQuantity extends Data.TaggedClass("UpdateQuantity")<{
  readonly itemId: string;
  readonly quantity: number;
}> {}

export class ProceedToCheckout extends Data.TaggedClass("ProceedToCheckout")<{}> {}

export class PlaceOrder extends Data.TaggedClass("PlaceOrder")<{}> {}

export class MarkShipped extends Data.TaggedClass("MarkShipped")<{
  readonly trackingNumber: string;
}> {}

export class MarkDelivered extends Data.TaggedClass("MarkDelivered")<{}> {}

export class CancelOrder extends Data.TaggedClass("CancelOrder")<{
  readonly reason?: string;
}> {}

export class BackToCart extends Data.TaggedClass("BackToCart")<{}> {}

export type OrderEvent =
  | AddItem
  | RemoveItem
  | UpdateQuantity
  | ProceedToCheckout
  | PlaceOrder
  | MarkShipped
  | MarkDelivered
  | CancelOrder
  | BackToCart;

// ============================================================================
// Helper Functions
// ============================================================================

function calculateTotal(items: readonly OrderItem[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

function addItemToList(items: readonly OrderItem[], newItem: OrderItem): readonly OrderItem[] {
  const existingIndex = items.findIndex((i) => i.id === newItem.id);
  if (existingIndex >= 0) {
    return items.map((item, index) =>
      index === existingIndex ? { ...item, quantity: item.quantity + newItem.quantity } : item
    );
  }
  return [...items, newItem];
}

function removeItemFromList(items: readonly OrderItem[], itemId: string): readonly OrderItem[] {
  return items.filter((item) => item.id !== itemId);
}

function updateItemQuantity(
  items: readonly OrderItem[],
  itemId: string,
  quantity: number
): readonly OrderItem[] {
  if (quantity <= 0) {
    return removeItemFromList(items, itemId);
  }
  return items.map((item) => (item.id === itemId ? { ...item, quantity } : item));
}

// ============================================================================
// Machine Definition
// ============================================================================

export function createOrderMachine(initialContext: OrderContext) {
  return defineMachine<OrderState, OrderContext, OrderEvent>({
    id: `order-${initialContext.orderId}`,
    context: OrderContextSchema,
    initialContext,
    initialState: OrderState.Cart(),

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
            ctx.items.length > 0 ? { goto: OrderState.Checkout() } : null,
          CancelOrder: (_ctx, event) => ({
            goto: OrderState.Cancelled(event.reason ?? "Customer cancelled", new Date()),
          }),
        },
      },

      Checkout: {
        on: {
          BackToCart: () => ({ goto: OrderState.Cart() }),
          PlaceOrder: () => ({ goto: OrderState.Processing(new Date()) }),
          CancelOrder: (_ctx, event) => ({
            goto: OrderState.Cancelled(event.reason ?? "Customer cancelled", new Date()),
          }),
        },
      },

      Processing: {
        on: {
          MarkShipped: (_ctx, event) => ({
            goto: OrderState.Shipped(event.trackingNumber, new Date()),
          }),
          CancelOrder: (_ctx, event) => ({
            goto: OrderState.Cancelled(event.reason ?? "Order cancelled", new Date()),
          }),
        },
      },

      Shipped: {
        on: {
          MarkDelivered: () => ({ goto: OrderState.Delivered(new Date()) }),
        },
      },

      Delivered: {
        on: {},
      },

      Cancelled: {
        on: {},
      },
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
// State Helpers
// ============================================================================

export function getOrderStateLabel(state: OrderState): string {
  switch (state._tag) {
    case "Cart":
      return "In Cart";
    case "Checkout":
      return "Checkout";
    case "Processing":
      return "Processing";
    case "Shipped":
      return "Shipped";
    case "Delivered":
      return "Delivered";
    case "Cancelled":
      return "Cancelled";
  }
}

export function getOrderStateColor(state: OrderState): string {
  switch (state._tag) {
    case "Cart":
      return "bg-gray-500";
    case "Checkout":
      return "bg-blue-500";
    case "Processing":
      return "bg-yellow-500";
    case "Shipped":
      return "bg-purple-500";
    case "Delivered":
      return "bg-green-500";
    case "Cancelled":
      return "bg-red-500";
  }
}

export function canCancel(state: OrderState): boolean {
  return state._tag === "Cart" || state._tag === "Checkout" || state._tag === "Processing";
}

export function isTerminalState(state: OrderState): boolean {
  return state._tag === "Delivered" || state._tag === "Cancelled";
}
