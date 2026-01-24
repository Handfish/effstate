/**
 * Convex Schema - v4 Style
 *
 * LOOK HOW SIMPLE THIS IS!
 * We just import the schemas from the machine definition.
 * No duplication, no conversion.
 */

import { defineSchema, defineTable } from "@rjdellecese/confect/server";
import { Schema } from "effect";
import { OrderStateSchema, OrderContextSchema } from "../src/machines/order";

// ============================================================================
// Order Document Schema (Context + State + Convex ID)
// ============================================================================

export const OrderDocumentSchema = Schema.Struct({
  _id: Schema.String,
  ...OrderContextSchema.fields,
  state: OrderStateSchema,
});

export type OrderDocument = Schema.Schema.Type<typeof OrderDocumentSchema>;

// Re-export machine types for convenience
export type { OrderItem, OrderState, OrderContext } from "../src/machines/order";

// ============================================================================
// Convex Schema Definition
// ============================================================================

const schemaDefinition = defineSchema({
  orders: defineTable(
    Schema.Struct({
      ...OrderContextSchema.fields,
      state: OrderStateSchema,
    })
  ).index("by_orderId", ["orderId"]),
});

export const confectSchema = schemaDefinition;
export default schemaDefinition.convexSchemaDefinition;
