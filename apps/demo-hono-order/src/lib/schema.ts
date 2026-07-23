/**
 * Drizzle Schema for Order State Machine Persistence
 */

import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

// ============================================================================
// Orders Table
// ============================================================================

export const orders = pgTable("orders", {
  // Primary key - the order ID
  id: text("id").primaryKey(),

  // State machine state
  stateTag: text("state_tag").notNull(),
  stateData: jsonb("state_data").notNull().$type<Record<string, unknown>>(),

  // Context (order details) - stored as JSON with ISO date string
  context: jsonb("context").notNull().$type<{
    orderId: string;
    customerName: string;
    items: Array<{ name: string; quantity: number; price: number }>;
    total: number;
    createdAt: string; // ISO string in DB
  }>(),

  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
