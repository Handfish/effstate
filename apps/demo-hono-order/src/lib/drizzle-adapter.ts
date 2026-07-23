/**
 * Drizzle/PostgreSQL Persistence Adapter
 *
 * Implements the PersistenceAdapter interface using Drizzle ORM with PostgreSQL.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { orders } from "./schema.js";
import type { PersistenceAdapter } from "./persistence.js";
import type { OrderContext } from "../machines/order.js";

// ============================================================================
// Types for DB storage (Date -> string conversion)
// ============================================================================

type StoredContext = Omit<OrderContext, "createdAt"> & { createdAt: string };

// ============================================================================
// Database Connection
// ============================================================================

const connectionString = process.env.DATABASE_URL ?? "postgres://localhost:5432/effstate_orders";

const client = postgres(connectionString);
export const db = drizzle(client);

// ============================================================================
// Conversion Helpers
// ============================================================================

function contextToDb(ctx: OrderContext): StoredContext {
  return {
    ...ctx,
    createdAt: ctx.createdAt.toISOString(),
  };
}

function contextFromDb(stored: StoredContext): OrderContext {
  return {
    ...stored,
    createdAt: new Date(stored.createdAt),
  };
}

// ============================================================================
// Drizzle Adapter
// ============================================================================

export function createDrizzleAdapter(): PersistenceAdapter<Record<string, unknown>, OrderContext> {
  return {
    async save(id, stateTag, stateData, context) {
      await db
        .insert(orders)
        .values({
          id,
          stateTag,
          stateData,
          context: contextToDb(context),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: orders.id,
          set: {
            stateTag,
            stateData,
            context: contextToDb(context),
            updatedAt: new Date(),
          },
        });
    },

    async load(id) {
      const result = await db.select().from(orders).where(eq(orders.id, id)).limit(1);

      if (result.length === 0) return null;

      const row = result[0];
      return {
        id: row.id,
        stateTag: row.stateTag,
        stateData: row.stateData,
        context: contextFromDb(row.context),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    },

    async loadAll() {
      const result = await db.select().from(orders);

      return result.map((row) => ({
        id: row.id,
        stateTag: row.stateTag,
        stateData: row.stateData,
        context: contextFromDb(row.context),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));
    },

    async delete(id) {
      await db.delete(orders).where(eq(orders.id, id));
    },

    async findByState(stateTag) {
      const result = await db.select().from(orders).where(eq(orders.stateTag, stateTag));

      return result.map((row) => ({
        id: row.id,
        stateTag: row.stateTag,
        stateData: row.stateData,
        context: contextFromDb(row.context),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));
    },
  };
}
