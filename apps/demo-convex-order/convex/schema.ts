import { defineSchema, defineTable } from "@rjdellecese/confect/server";
import { Schema } from "effect";

// ============================================================================
// Schemas (Single source of truth)
// ============================================================================

/** Order item schema */
export const OrderItemSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  quantity: Schema.Number,
  price: Schema.Number,
});

/** Order state - discriminated union stored as JSON-compatible object */
export const OrderStateSchema = Schema.Union(
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

/** Full order record schema (without Convex _id) */
export const OrderRecordSchema = Schema.Struct({
  orderId: Schema.String,
  customerName: Schema.String,
  items: Schema.Array(OrderItemSchema),
  total: Schema.Number,
  createdAt: Schema.Number, // timestamp
  state: OrderStateSchema,
});

/** Order with Convex document ID */
export const OrderDocumentSchema = Schema.Struct({
  _id: Schema.String,
  ...OrderRecordSchema.fields,
});

// ============================================================================
// Derived Types (No manual duplication!)
// ============================================================================

export type ConvexOrderItem = Schema.Schema.Type<typeof OrderItemSchema>;
export type ConvexOrderState = Schema.Schema.Type<typeof OrderStateSchema>;
export type ConvexOrderRecord = Schema.Schema.Type<typeof OrderRecordSchema>;
export type ConvexOrder = Schema.Schema.Type<typeof OrderDocumentSchema>;

// ============================================================================
// Convex Schema Definition
// ============================================================================

const schemaDefinition = defineSchema({
  orders: defineTable(OrderRecordSchema).index("by_orderId", ["orderId"]),
});

// Export the confect schema for use in confect.ts
export const confectSchema = schemaDefinition;

// Export the Convex schema definition as default
export default schemaDefinition.convexSchemaDefinition;
