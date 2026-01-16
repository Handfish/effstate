import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

// ============================================================================
// In-Memory Server State
// ============================================================================

interface ServerState {
  leaderId: string | null;
  snapshot: string | null; // base64 encoded
  version: number;
  updatedAt: Date | null;
}

const state: ServerState = {
  leaderId: null,
  snapshot: null,
  version: 0,
  updatedAt: null,
};

// ============================================================================
// Hono App
// ============================================================================

const app = new Hono();

app.use("/*", cors());

// Health check
app.get("/", (c) => {
  return c.json({
    status: "ok",
    service: "loro-sync-server",
    leaderId: state.leaderId,
    version: state.version,
  });
});

/**
 * GET /sync/state
 *
 * Get current server state and leader info.
 * Followers poll this endpoint.
 *
 * Response: { leaderId, snapshot, version, isLeader }
 */
app.get("/sync/state", (c) => {
  const clientId = c.req.header("X-Client-Id") ?? "unknown";

  console.log(`[state] client=${clientId} polling, leader=${state.leaderId}, version=${state.version}`);

  return c.json({
    leaderId: state.leaderId,
    snapshot: state.snapshot,
    version: state.version,
    isLeader: state.leaderId === clientId,
  });
});

/**
 * POST /sync/claim
 *
 * Claim server leadership. This client becomes the source of truth.
 * Their state overwrites server state.
 *
 * Request: { snapshot: string (base64) }
 * Response: { success: true, version }
 */
app.post("/sync/claim", async (c) => {
  const clientId = c.req.header("X-Client-Id") ?? "unknown";
  const body = await c.req.json<{ snapshot: string }>();

  // Take leadership and set state
  state.leaderId = clientId;
  state.snapshot = body.snapshot;
  state.version++;
  state.updatedAt = new Date();

  console.log(`[claim] client=${clientId} claimed leadership, version=${state.version}`);

  return c.json({
    success: true,
    version: state.version,
  });
});

/**
 * POST /sync/push
 *
 * Push state update. Only works if you're the leader.
 *
 * Request: { snapshot: string (base64) }
 * Response: { success, version, error? }
 */
app.post("/sync/push", async (c) => {
  const clientId = c.req.header("X-Client-Id") ?? "unknown";
  const body = await c.req.json<{ snapshot: string }>();

  // Only leader can push
  if (state.leaderId !== clientId) {
    console.log(`[push] client=${clientId} rejected (not leader, leader=${state.leaderId})`);
    return c.json({
      success: false,
      error: "Not the leader",
      leaderId: state.leaderId,
    }, 403);
  }

  // Update state
  state.snapshot = body.snapshot;
  state.version++;
  state.updatedAt = new Date();

  console.log(`[push] client=${clientId} pushed, version=${state.version}`);

  return c.json({
    success: true,
    version: state.version,
  });
});

/**
 * POST /sync/release
 *
 * Release leadership voluntarily.
 *
 * Response: { success }
 */
app.post("/sync/release", async (c) => {
  const clientId = c.req.header("X-Client-Id") ?? "unknown";

  if (state.leaderId === clientId) {
    console.log(`[release] client=${clientId} released leadership`);
    state.leaderId = null;
    return c.json({ success: true });
  }

  return c.json({ success: false, error: "Not the leader" });
});

// ============================================================================
// Start Server
// ============================================================================

const port = 3001;
console.log(`Loro sync server running at http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});
