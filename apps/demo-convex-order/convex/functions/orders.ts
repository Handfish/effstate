import { Data, Effect, Schema, Option, pipe } from "effect";
import { query, mutation, ConfectQueryCtx, ConfectMutationCtx } from "../confect";

// ============================================================================
// Types
// ============================================================================

type StateTag = "Cart" | "Checkout" | "Processing" | "Shipped" | "Delivered" | "Cancelled";

// ============================================================================
// Tagged Errors (Structured error handling)
// ============================================================================

export class OrderNotFoundError extends Data.TaggedClass("OrderNotFoundError")<{
  readonly orderId: string;
}> {}

export class InvalidTransitionError extends Data.TaggedClass("InvalidTransitionError")<{
  readonly from: StateTag;
  readonly to: StateTag;
}> {}

export class InvalidStateForOperationError extends Data.TaggedClass("InvalidStateForOperationError")<{
  readonly currentState: StateTag;
  readonly operation: string;
}> {}

// ============================================================================
// Schemas (with refinements)
// ============================================================================

const NonEmptyString = Schema.String.pipe(
  Schema.minLength(1, { message: () => "String must not be empty" })
);

const PositiveNumber = Schema.Number.pipe(
  Schema.positive({ message: () => "Number must be positive" })
);

const NonNegativeNumber = Schema.Number.pipe(
  Schema.nonNegative({ message: () => "Number must not be negative" })
);

const OrderItemSchema = Schema.Struct({
  id: NonEmptyString,
  name: NonEmptyString,
  quantity: PositiveNumber,
  price: NonNegativeNumber,
});

/**
 * Order state schema - manual Schema.Union for Confect compatibility.
 *
 * Note: The EffState schema helpers (tagOnlyState, stateWithTimestamp, etc.)
 * are designed for general use. For Confect/Convex with stricter type requirements,
 * the manual approach below works better.
 */
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

// Common order return schema
const OrderReturnSchema = Schema.Struct({
  _id: Schema.String,
  orderId: Schema.String,
  customerName: Schema.String,
  items: Schema.Array(OrderItemSchema),
  total: Schema.Number,
  createdAt: Schema.Number,
  state: OrderStateSchema,
});

// ============================================================================
// Helpers (DRY order transformations)
// ============================================================================

// Type for order as stored in DB
// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface DbOrder {
  _id: any; // Convex Id type - complex internal type
  orderId: string;
  customerName: string;
  items: readonly { id: string; name: string; quantity: number; price: number }[];
  total: number;
  createdAt: number;
  state:
    | { _tag: "Cart" }
    | { _tag: "Checkout" }
    | { _tag: "Processing"; startedAt: number }
    | { _tag: "Shipped"; trackingNumber: string; shippedAt: number }
    | { _tag: "Delivered"; deliveredAt: number }
    | { _tag: "Cancelled"; reason: string; cancelledAt: number };
}

/** Transform DB order to API response format */
const toOrderResponse = (order: DbOrder) => ({
  _id: order._id as unknown as string,
  orderId: order.orderId,
  customerName: order.customerName,
  items: [...order.items],
  total: order.total,
  createdAt: order.createdAt,
  state: order.state,
});

/** Extract order from Option or fail with OrderNotFoundError */
const getOrderOrFail = (orderOption: Option.Option<DbOrder>, orderId: string) =>
  pipe(
    orderOption,
    Option.match({
      onNone: () => Effect.fail(new OrderNotFoundError({ orderId })),
      onSome: (order) => Effect.succeed(order),
    })
  );

// ============================================================================
// Queries
// ============================================================================

export const listOrders = query({
  args: Schema.Struct({}),
  returns: Schema.Array(OrderReturnSchema),
  handler: () =>
    Effect.gen(function* () {
      const { db } = yield* ConfectQueryCtx;
      const orders = yield* db.query("orders").order("desc").collect();
      return orders.map((order) => toOrderResponse(order as DbOrder));
    }),
});

export const getOrder = query({
  args: Schema.Struct({ orderId: Schema.String }),
  returns: Schema.Union(OrderReturnSchema, Schema.Null),
  handler: ({ orderId }) =>
    Effect.gen(function* () {
      const { db } = yield* ConfectQueryCtx;
      const orderOption = yield* db
        .query("orders")
        .withIndex("by_orderId", (q) => q.eq("orderId", orderId))
        .first();

      return pipe(
        orderOption as Option.Option<DbOrder>,
        Option.map(toOrderResponse),
        Option.getOrNull
      );
    }),
});

// ============================================================================
// Transition Validation
// ============================================================================

/**
 * Valid state transitions derived from the state machine.
 * Record-based for O(1) lookup.
 */
const validTransitions: Record<StateTag, readonly StateTag[]> = {
  Cart: ["Checkout", "Cancelled"],
  Checkout: ["Cart", "Processing", "Cancelled"],
  Processing: ["Shipped", "Cancelled"],
  Shipped: ["Delivered"],
  Delivered: [],
  Cancelled: [],
};

const isValidTransition = (from: StateTag, to: StateTag): boolean =>
  validTransitions[from].includes(to);

/** Effect-based transition validation that fails with structured error */
const validateTransition = (from: StateTag, to: StateTag) =>
  isValidTransition(from, to)
    ? Effect.succeed(true)
    : Effect.fail(new InvalidTransitionError({ from, to }));

/** Effect-based state check that fails with structured error */
const requireState = (currentState: StateTag, requiredState: StateTag, operation: string) =>
  currentState === requiredState
    ? Effect.succeed(true)
    : Effect.fail(new InvalidStateForOperationError({ currentState, operation }));

// ============================================================================
// Mutations
// ============================================================================

export const createOrder = mutation({
  args: Schema.Struct({
    orderId: NonEmptyString,
    customerName: NonEmptyString,
    items: Schema.Array(OrderItemSchema),
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
    state: OrderStateSchema,
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

        // Extract order or fail with structured error
        const order = yield* getOrderOrFail(orderOption as Option.Option<DbOrder>, orderId);

        // Validate transition with structured error
        yield* validateTransition(order.state._tag, state._tag);

        // Apply update
        yield* db.patch(order._id, { state });
        return true;
      }),
      // Convert structured errors back to boolean for API compatibility
      Effect.catchTags({
        OrderNotFoundError: () => Effect.succeed(false),
        InvalidTransitionError: () => Effect.succeed(false),
      })
    ),
});

export const updateOrderItems = mutation({
  args: Schema.Struct({
    orderId: NonEmptyString,
    items: Schema.Array(OrderItemSchema),
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

        // Extract order or fail with structured error
        const order = yield* getOrderOrFail(orderOption as Option.Option<DbOrder>, orderId);

        // Require Cart state for item updates
        yield* requireState(order.state._tag, "Cart", "updateItems");

        // Apply update
        yield* db.patch(order._id, { items: [...items], total });
        return true;
      }),
      // Convert structured errors back to boolean for API compatibility
      Effect.catchTags({
        OrderNotFoundError: () => Effect.succeed(false),
        InvalidStateForOperationError: () => Effect.succeed(false),
      })
    ),
});
