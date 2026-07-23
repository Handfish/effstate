/**
 * Order Convex Functions - v4 Style
 *
 * Much simpler than v3 - no schema duplication!
 */

import { Effect, Schema, Option, pipe } from "effect";
import { query, mutation, ConfectQueryCtx, ConfectMutationCtx } from "../confect";
import { OrderStateSchema } from "../../src/machines/order";
import { OrderDocumentSchema } from "../schema";

// ============================================================================
// Validation Schemas (refinements for mutations)
// ============================================================================

const NonEmptyString = Schema.String.pipe(
  Schema.filter((s) => s.length > 0, { message: () => "String must not be empty" })
);

const NonNegativeNumber = Schema.Number.pipe(
  Schema.filter((n) => n >= 0, { message: () => "Number must be non-negative" })
);

const PositiveNumber = Schema.Number.pipe(
  Schema.filter((n) => n > 0, { message: () => "Number must be positive" })
);

const ValidatedOrderItemSchema = Schema.Struct({
  id: NonEmptyString,
  name: NonEmptyString,
  quantity: PositiveNumber,
  price: NonNegativeNumber,
});

// ============================================================================
// Queries
// ============================================================================

export const listOrders = query({
  args: Schema.Struct({}),
  returns: Schema.Array(OrderDocumentSchema),
  handler: () =>
    Effect.gen(function* () {
      const { db } = yield* ConfectQueryCtx;
      const orders = yield* db.query("orders").collect();
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
  returns: Schema.Union(OrderDocumentSchema, Schema.Null),
  handler: ({ orderId }) =>
    Effect.gen(function* () {
      const { db } = yield* ConfectQueryCtx;
      const orderOption = yield* db
        .query("orders")
        .withIndex("by_orderId", (q) => q.eq("orderId", orderId))
        .first();

      return pipe(
        orderOption,
        Option.map((order) => ({
          _id: order._id as unknown as string,
          orderId: order.orderId,
          customerName: order.customerName,
          items: [...order.items],
          total: order.total,
          createdAt: order.createdAt,
          state: order.state,
        })),
        Option.getOrNull
      );
    }),
});

// ============================================================================
// Mutations
// ============================================================================

export const createOrder = mutation({
  args: Schema.Struct({
    orderId: NonEmptyString,
    customerName: NonEmptyString,
    items: Schema.Array(ValidatedOrderItemSchema),
    total: NonNegativeNumber,
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
    orderId: NonEmptyString,
    state: OrderStateSchema, // Direct use! No conversion!
  }),
  returns: Schema.Boolean,
  handler: ({ orderId, state }) =>
    pipe(
      Effect.gen(function* () {
        const { db } = yield* ConfectMutationCtx;
        const orderOption = yield* db
          .query("orders")
          .withIndex("by_orderId", (q) => q.eq("orderId", orderId))
          .first();

        if (Option.isNone(orderOption)) return false;

        yield* db.patch(orderOption.value._id, { state });
        return true;
      }),
      Effect.catchAll(() => Effect.succeed(false))
    ),
});

export const updateOrderItems = mutation({
  args: Schema.Struct({
    orderId: NonEmptyString,
    items: Schema.Array(ValidatedOrderItemSchema),
    total: NonNegativeNumber,
  }),
  returns: Schema.Boolean,
  handler: ({ orderId, items, total }) =>
    pipe(
      Effect.gen(function* () {
        const { db } = yield* ConfectMutationCtx;
        const orderOption = yield* db
          .query("orders")
          .withIndex("by_orderId", (q) => q.eq("orderId", orderId))
          .first();

        if (Option.isNone(orderOption)) return false;

        yield* db.patch(orderOption.value._id, {
          items: [...items],
          total,
        });
        return true;
      }),
      Effect.catchAll(() => Effect.succeed(false))
    ),
});
