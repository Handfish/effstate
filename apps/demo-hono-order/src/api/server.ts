/**
 * Hono Backend for Order Processing (Database-Centric)
 *
 * Stateless server - all state lives in the database.
 * Each request: load -> transition -> save
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  transition,
  serializeState,
  deserializeState,
  Pending,
  Submit,
  Cancel,
  MarkDelivered,
  ProcessingComplete,
  type OrderContext,
} from "../machines/order.js";
import { createMemoryAdapter, type PersistenceAdapter } from "../lib/persistence.js";

// ============================================================================
// Persistence Setup
// ============================================================================

const USE_POSTGRES = process.env.DATABASE_URL !== undefined;

let persistence: PersistenceAdapter<Record<string, unknown>, OrderContext>;

if (USE_POSTGRES) {
  const { createDrizzleAdapter } = await import("../lib/drizzle-adapter.js");
  persistence = createDrizzleAdapter();
  console.log("Using PostgreSQL persistence");
} else {
  persistence = createMemoryAdapter();
  console.log("Using in-memory persistence (set DATABASE_URL for PostgreSQL)");
}

// ============================================================================
// Background Processing (simulates async order fulfillment)
// ============================================================================

const PROCESSING_TIME_MS = 3000; // 3 seconds to "process" an order

async function processOrders() {
  const processing = await persistence.findByState("Processing");
  const now = Date.now();

  for (const order of processing) {
    const state = deserializeState(order.stateData);
    if (state._tag !== "Processing") continue;

    // Check if processing time has elapsed
    const elapsed = now - state.startedAt.getTime();
    if (elapsed >= PROCESSING_TIME_MS) {
      const trackingNumber = `TRK-${Date.now()}`;
      const result = transition(state, order.context, new ProcessingComplete(trackingNumber));

      if (result.changed) {
        await persistence.save(order.id, result.state._tag, serializeState(result.state), result.context);
        console.log(`[${order.id}] Auto-shipped: ${trackingNumber}`);
      }
    }
  }
}

// Run background processor every second
setInterval(processOrders, 1000);

// ============================================================================
// Hono App
// ============================================================================

const app = new Hono();

app.use("/*", cors({
  origin: "http://localhost:5173",
  allowMethods: ["GET", "POST", "PUT", "DELETE"],
}));

// ============================================================================
// Routes
// ============================================================================

// List all orders
app.get("/api/orders", async (c) => {
  const orders = await persistence.loadAll();

  return c.json(orders.map((o) => ({
    orderId: o.id,
    state: o.stateTag,
    stateData: o.stateData,
    context: o.context,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  })));
});

// Create new order
app.post("/api/orders", async (c) => {
  const body = await c.req.json<{
    customerName: string;
    items: Array<{ name: string; quantity: number; price: number }>;
  }>();

  const orderId = `ORD-${Date.now()}`;
  const total = body.items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const context: OrderContext = {
    orderId,
    customerName: body.customerName,
    items: body.items,
    total,
    createdAt: new Date(),
  };

  const state = new Pending();
  await persistence.save(orderId, state._tag, serializeState(state), context);

  console.log(`[${orderId}] Created`);

  return c.json({
    orderId,
    state: state._tag,
    stateData: serializeState(state),
    context,
  }, 201);
});

// Get single order
app.get("/api/orders/:id", async (c) => {
  const order = await persistence.load(c.req.param("id"));
  if (!order) {
    return c.json({ error: "Order not found" }, 404);
  }

  return c.json({
    orderId: order.id,
    state: order.stateTag,
    stateData: order.stateData,
    context: order.context,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  });
});

// Submit order (Pending -> Processing)
app.post("/api/orders/:id/submit", async (c) => {
  const orderId = c.req.param("id");

  // Load
  const order = await persistence.load(orderId);
  if (!order) {
    return c.json({ error: "Order not found" }, 404);
  }

  // Transition
  const state = deserializeState(order.stateData);
  const result = transition(state, order.context, new Submit());

  // Save if changed
  if (result.changed) {
    await persistence.save(orderId, result.state._tag, serializeState(result.state), result.context);
    console.log(`[${orderId}] ${state._tag} -> ${result.state._tag}`);
  }

  return c.json({
    orderId,
    state: result.state._tag,
    stateData: serializeState(result.state),
    changed: result.changed,
  });
});

// Cancel order
app.post("/api/orders/:id/cancel", async (c) => {
  const orderId = c.req.param("id");

  const order = await persistence.load(orderId);
  if (!order) {
    return c.json({ error: "Order not found" }, 404);
  }

  const body = await c.req.json<{ reason?: string }>().catch(() => ({ reason: undefined }));
  const state = deserializeState(order.stateData);
  const result = transition(state, order.context, new Cancel(body.reason || "Customer requested"));

  if (result.changed) {
    await persistence.save(orderId, result.state._tag, serializeState(result.state), result.context);
    console.log(`[${orderId}] ${state._tag} -> ${result.state._tag}`);
  }

  return c.json({
    orderId,
    state: result.state._tag,
    stateData: serializeState(result.state),
    changed: result.changed,
  });
});

// Mark delivered (Shipped -> Delivered)
app.post("/api/orders/:id/deliver", async (c) => {
  const orderId = c.req.param("id");

  const order = await persistence.load(orderId);
  if (!order) {
    return c.json({ error: "Order not found" }, 404);
  }

  const state = deserializeState(order.stateData);
  const result = transition(state, order.context, new MarkDelivered());

  if (result.changed) {
    await persistence.save(orderId, result.state._tag, serializeState(result.state), result.context);
    console.log(`[${orderId}] ${state._tag} -> ${result.state._tag}`);
  }

  return c.json({
    orderId,
    state: result.state._tag,
    stateData: serializeState(result.state),
    changed: result.changed,
  });
});

// ============================================================================
// Start Server
// ============================================================================

const port = 3001;
console.log(`Order API running at http://localhost:${port}`);
console.log(`Background processor running (auto-ships after ${PROCESSING_TIME_MS / 1000}s)`);

serve({ fetch: app.fetch, port });
