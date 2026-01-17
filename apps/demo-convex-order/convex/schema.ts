import { defineSchema, defineTable } from "@rjdellecese/confect/server";
import { Schema } from "effect";

// Order item schema
const OrderItemSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  quantity: Schema.Number,
  price: Schema.Number,
});

// Order state - discriminated union stored as JSON-compatible object
const OrderStateSchema = Schema.Union(
  Schema.Struct({ _tag: Schema.Literal("Cart") }),
  Schema.Struct({ _tag: Schema.Literal("Checkout") }),
  Schema.Struct({
    _tag: Schema.Literal("Processing"),
    startedAt: Schema.Number, // timestamp
  }),
  Schema.Struct({
    _tag: Schema.Literal("Shipped"),
    trackingNumber: Schema.String,
    shippedAt: Schema.Number, // timestamp
  }),
  Schema.Struct({
    _tag: Schema.Literal("Delivered"),
    deliveredAt: Schema.Number, // timestamp
  }),
  Schema.Struct({
    _tag: Schema.Literal("Cancelled"),
    reason: Schema.String,
    cancelledAt: Schema.Number, // timestamp
  })
);

const schemaDefinition = defineSchema({
  orders: defineTable(
    Schema.Struct({
      orderId: Schema.String,
      customerName: Schema.String,
      items: Schema.Array(OrderItemSchema),
      total: Schema.Number,
      createdAt: Schema.Number, // timestamp
      state: OrderStateSchema,
    })
  ).index("by_orderId", ["orderId"]),
});

// Export the confect schema for use in confect.ts
export const confectSchema = schemaDefinition;

// Export the Convex schema definition as default
export default schemaDefinition.convexSchemaDefinition;
