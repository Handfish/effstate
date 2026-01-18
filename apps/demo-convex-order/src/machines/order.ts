/**
 * Order Processing State Machine - EffState v3
 *
 * States: Cart -> Checkout -> Processing -> Shipped -> Delivered
 *         (can be Cancelled from Cart, Checkout, Processing)
 */

import { Brand, Data, Match, pipe, Schema } from "effect";
import { defineMachine, type MachineActor, type MachineSnapshot } from "effstate/v3";

// ============================================================================
// Branded Types (Type-safe domain primitives)
// ============================================================================

export type OrderId = string & Brand.Brand<"OrderId">;
export type ItemId = string & Brand.Brand<"ItemId">;
export type Price = number & Brand.Brand<"Price">;
export type Quantity = number & Brand.Brand<"Quantity">;

export const OrderId = Brand.nominal<OrderId>();
export const ItemId = Brand.nominal<ItemId>();
export const Price = Brand.nominal<Price>();
export const Quantity = Brand.nominal<Quantity>();

/** Generate a new OrderId */
export const generateOrderId = (): OrderId =>
  OrderId(
    `ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
  );

// ============================================================================
// State (Data.TaggedClass - symmetric with Events)
// ============================================================================

export class Cart extends Data.TaggedClass("Cart")<{}> {}

export class Checkout extends Data.TaggedClass("Checkout")<{}> {}

export class Processing extends Data.TaggedClass("Processing")<{
  readonly startedAt: Date;
}> {}

export class Shipped extends Data.TaggedClass("Shipped")<{
  readonly trackingNumber: string;
  readonly shippedAt: Date;
}> {}

export class Delivered extends Data.TaggedClass("Delivered")<{
  readonly deliveredAt: Date;
}> {}

export class Cancelled extends Data.TaggedClass("Cancelled")<{
  readonly reason: string;
  readonly cancelledAt: Date;
}> {}

export type OrderState = Cart | Checkout | Processing | Shipped | Delivered | Cancelled;

/** Factory functions for backward compatibility */
export const OrderState = {
  Cart: () => new Cart(),
  Checkout: () => new Checkout(),
  Processing: (startedAt: Date = new Date()) => new Processing({ startedAt }),
  Shipped: (trackingNumber: string, shippedAt: Date = new Date()) =>
    new Shipped({ trackingNumber, shippedAt }),
  Delivered: (deliveredAt: Date = new Date()) => new Delivered({ deliveredAt }),
  Cancelled: (reason: string, cancelledAt: Date = new Date()) =>
    new Cancelled({ reason, cancelledAt }),
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
      index === existingIndex ? { ...item, quantity: item.quantity + newItem.quantity } : item,
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
  quantity: number,
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
// State Helpers (Match-based for exhaustive pattern matching)
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
    Match.exhaustive,
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
    Match.exhaustive,
  );

/** States that can be cancelled */
const CancellableStates = ["Cart", "Checkout", "Processing"] as const;
const isCancellable = (tag: string): tag is (typeof CancellableStates)[number] =>
  (CancellableStates as readonly string[]).includes(tag);

export const canCancel = (state: OrderState): boolean => isCancellable(state._tag);

/** Terminal states (no further transitions) */
const TerminalStates = ["Delivered", "Cancelled"] as const;
const isTerminal = (tag: string): tag is (typeof TerminalStates)[number] =>
  (TerminalStates as readonly string[]).includes(tag);

export const isTerminalState = (state: OrderState): boolean => isTerminal(state._tag);
