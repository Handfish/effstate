import { Effect, Schema, Option } from "effect";
import { query, mutation, ConfectQueryCtx, ConfectMutationCtx } from "../confect";

// ============================================================================
// Args & Return Schemas
// ============================================================================

const OrderItemSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  quantity: Schema.Number,
  price: Schema.Number,
});

const OrderStateSchema = Schema.Union(
  Schema.Struct({ _tag: Schema.Literal("Cart") }),
  Schema.Struct({ _tag: Schema.Literal("Checkout") }),
  Schema.Struct({
    _tag: Schema.Literal("Processing"),
    startedAt: Schema.Number,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Shipped"),
    trackingNumber: Schema.String,
    shippedAt: Schema.Number,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Delivered"),
    deliveredAt: Schema.Number,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Cancelled"),
    reason: Schema.String,
    cancelledAt: Schema.Number,
  })
);

// ============================================================================
// Queries
// ============================================================================

export const listOrders = query({
  args: Schema.Struct({}),
  returns: Schema.Array(
    Schema.Struct({
      _id: Schema.String,
      orderId: Schema.String,
      customerName: Schema.String,
      items: Schema.Array(OrderItemSchema),
      total: Schema.Number,
      createdAt: Schema.Number,
      state: OrderStateSchema,
    })
  ),
  handler: () =>
    Effect.gen(function* () {
      const { db } = yield* ConfectQueryCtx;
      const orders = yield* db.query("orders").order("desc").collect();
      return orders.map((order) => ({
        _id: order._id as unknown as string,
        orderId: order.orderId,
        customerName: order.customerName,
        items: [...order.items],
        total: order.total,
        createdAt: order.createdAt,
        state: order.state,
      }));
    }),
});

export const getOrder = query({
  args: Schema.Struct({ orderId: Schema.String }),
  returns: Schema.Union(
    Schema.Struct({
      _id: Schema.String,
      orderId: Schema.String,
      customerName: Schema.String,
      items: Schema.Array(OrderItemSchema),
      total: Schema.Number,
      createdAt: Schema.Number,
      state: OrderStateSchema,
    }),
    Schema.Null
  ),
  handler: ({ orderId }) =>
    Effect.gen(function* () {
      const { db } = yield* ConfectQueryCtx;
      const orderOption = yield* db
        .query("orders")
        .withIndex("by_orderId", (q) => q.eq("orderId", orderId))
        .first();

      if (Option.isNone(orderOption)) return null;

      const order = orderOption.value;
      return {
        _id: order._id as unknown as string,
        orderId: order.orderId,
        customerName: order.customerName,
        items: [...order.items],
        total: order.total,
        createdAt: order.createdAt,
        state: order.state,
      };
    }),
});

// ============================================================================
// Mutations
// ============================================================================

export const createOrder = mutation({
  args: Schema.Struct({
    orderId: Schema.String,
    customerName: Schema.String,
    items: Schema.Array(OrderItemSchema),
    total: Schema.Number,
  }),
  returns: Schema.String,
  handler: ({ orderId, customerName, items, total }) =>
    Effect.gen(function* () {
      const { db } = yield* ConfectMutationCtx;
      const docId = yield* db.insert("orders", {
        orderId,
        customerName,
        items: [...items],
        total,
        createdAt: Date.now(),
        state: { _tag: "Cart" as const },
      });
      return docId as unknown as string;
    }),
});

export const updateOrderState = mutation({
  args: Schema.Struct({
    orderId: Schema.String,
    state: OrderStateSchema,
  }),
  returns: Schema.Boolean,
  handler: ({ orderId, state }) =>
    Effect.gen(function* () {
      const { db } = yield* ConfectMutationCtx;
      const orderOption = yield* db
        .query("orders")
        .withIndex("by_orderId", (q) => q.eq("orderId", orderId))
        .first();

      if (Option.isNone(orderOption)) return false;

      const order = orderOption.value;

      // Validate transition
      if (!isValidTransition(order.state._tag, state._tag)) {
        return false;
      }

      yield* db.patch(order._id, { state });
      return true;
    }),
});

export const updateOrderItems = mutation({
  args: Schema.Struct({
    orderId: Schema.String,
    items: Schema.Array(OrderItemSchema),
    total: Schema.Number,
  }),
  returns: Schema.Boolean,
  handler: ({ orderId, items, total }) =>
    Effect.gen(function* () {
      const { db } = yield* ConfectMutationCtx;
      const orderOption = yield* db
        .query("orders")
        .withIndex("by_orderId", (q) => q.eq("orderId", orderId))
        .first();

      if (Option.isNone(orderOption)) return false;

      const order = orderOption.value;

      // Only allow item updates in Cart state
      if (order.state._tag !== "Cart") {
        return false;
      }

      yield* db.patch(order._id, { items: [...items], total });
      return true;
    }),
});

// ============================================================================
// Helpers
// ============================================================================

type StateTag = "Cart" | "Checkout" | "Processing" | "Shipped" | "Delivered" | "Cancelled";

const validTransitions: Record<StateTag, readonly StateTag[]> = {
  Cart: ["Checkout", "Cancelled"],
  Checkout: ["Cart", "Processing", "Cancelled"],
  Processing: ["Shipped", "Cancelled"],
  Shipped: ["Delivered"],
  Delivered: [],
  Cancelled: [],
};

function isValidTransition(from: StateTag, to: StateTag): boolean {
  return validTransitions[from].includes(to);
}
