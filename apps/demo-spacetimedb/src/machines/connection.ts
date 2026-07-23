/**
 * SpacetimeDB Connection State Machine (Hybrid Architecture)
 *
 * This machine uses:
 * - EffState v4 for state machine logic (transitions, entry/exit, auto-canceling streams)
 * - Effect.Service (SpacetimeSDK) for SDK operations via the R channel
 *
 * Benefits:
 * - Type-safe discriminated union states (each state has its own data)
 * - Auto-canceling health checks and retry timers (run streams)
 * - Entry/exit effects declared in config, not scattered
 * - SDK operations properly abstracted for testing
 */

import {
  State,
  Event,
  defineMachine,
  Schema,
  Effect,
  Stream,
} from "@handfish/effstate-v4";
import { Duration, Schedule } from "effect";
import { SpacetimeSDK } from "../services/SpacetimeSDK";
import { ConnectionError, SubscriptionError } from "../lib/errors";

// ============================================================================
// Configuration
// ============================================================================

export const RECONNECT_CONFIG = {
  maxRetries: 5,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  staleTimeoutMs: 30000,
  healthCheckIntervalMs: 5000,
} as const;

// ============================================================================
// States - Each state carries its own typed data
// ============================================================================

export const Disconnected = State("Disconnected", {});

export const Connecting = State("Connecting", {
  uri: Schema.String,
  moduleName: Schema.String,
});

export const Connected = State("Connected", {
  uri: Schema.String,
  moduleName: Schema.String,
  identity: Schema.String,
});

export const Reconnecting = State("Reconnecting", {
  uri: Schema.String,
  moduleName: Schema.String,
  attempt: Schema.Number,
});

export const Syncing = State("Syncing", {
  uri: Schema.String,
  moduleName: Schema.String,
  identity: Schema.String,
});

export const ErrorState = State("Error", {
  message: Schema.String,
  canRetry: Schema.Boolean,
  lastUri: Schema.optional(Schema.String),
  lastModuleName: Schema.optional(Schema.String),
});

export type ConnectionState =
  | typeof Disconnected.schema.Type
  | typeof Connecting.schema.Type
  | typeof Connected.schema.Type
  | typeof Reconnecting.schema.Type
  | typeof Syncing.schema.Type
  | typeof ErrorState.schema.Type;

// ============================================================================
// Events
// ============================================================================

export const Connect = Event("Connect", {
  uri: Schema.String,
  moduleName: Schema.String,
});

export const ConnectionSuccess = Event("ConnectionSuccess", {
  identity: Schema.String,
});

export const ConnectionFailed = Event("ConnectionFailed", {
  error: Schema.String,
});

export const Disconnect = Event("Disconnect", {});

export const SyncComplete = Event("SyncComplete", {});

export const SyncFailed = Event("SyncFailed", {
  error: Schema.String,
});

export const HealthCheck = Event("HealthCheck", {});

export const StaleDetected = Event("StaleDetected", {});

export const RetryNow = Event("RetryNow", {});

export const Reset = Event("Reset", {});

// New: Message received (for health tracking)
export const MessageReceived = Event("MessageReceived", {});

export type ConnectionEvent =
  | typeof Connect.schema.Type
  | typeof ConnectionSuccess.schema.Type
  | typeof ConnectionFailed.schema.Type
  | typeof Disconnect.schema.Type
  | typeof SyncComplete.schema.Type
  | typeof SyncFailed.schema.Type
  | typeof HealthCheck.schema.Type
  | typeof StaleDetected.schema.Type
  | typeof RetryNow.schema.Type
  | typeof Reset.schema.Type
  | typeof MessageReceived.schema.Type;

// ============================================================================
// Context
// ============================================================================

export interface ConnectionContext {
  lastMessageAt: number;
  totalReconnects: number;
  currentUri: string | null;
  currentModuleName: string | null;
  currentIdentity: string | null;
  currentAttempt: number; // Track attempt in context for handlers
}

// ============================================================================
// Streams (auto-cancel on state exit)
// ============================================================================

// Health check stream - runs while Connected
const healthCheckStream = Stream.fromSchedule(
  Schedule.spaced(Duration.millis(RECONNECT_CONFIG.healthCheckIntervalMs))
).pipe(Stream.map(() => HealthCheck.make()));

// Retry timer stream - calculates backoff and emits RetryNow
const createRetryStream = (attempt: number) => {
  const delay = Math.min(
    RECONNECT_CONFIG.initialDelayMs *
      Math.pow(RECONNECT_CONFIG.backoffMultiplier, attempt - 1),
    RECONNECT_CONFIG.maxDelayMs
  );

  // Add jitter (0-30%)
  const jitter = Math.random() * 0.3 * delay;
  const finalDelay = delay + jitter;

  console.log(
    `[Reconnect] Waiting ${Math.round(finalDelay)}ms before attempt ${attempt}`
  );

  return Stream.fromEffect(Effect.sleep(Duration.millis(finalDelay))).pipe(
    Stream.map(() => RetryNow.make())
  );
};

// ============================================================================
// Machine Definition with SpacetimeSDK Service
// ============================================================================

export const connectionMachine = defineMachine<
  ConnectionState,
  ConnectionContext,
  ConnectionEvent,
  SpacetimeSDK, // R: requires SpacetimeSDK service
  ConnectionError | SubscriptionError // Err: possible effect errors
>({
  id: "spacetimedb-connection",

  initialState: Disconnected.make(),

  initialContext: {
    lastMessageAt: Date.now(),
    totalReconnects: 0,
    currentUri: null,
    currentModuleName: null,
    currentIdentity: null,
    currentAttempt: 0,
  },

  states: {
    Disconnected: {
      entry: () => Effect.log("[Machine] → Disconnected"),

      on: {
        Connect: (_ctx, event) => ({
          goto: Connecting.make({
            uri: event.uri,
            moduleName: event.moduleName,
          }),
          update: {
            currentUri: event.uri,
            currentModuleName: event.moduleName,
            currentAttempt: 0,
          },
        }),
      },
    },

    Connecting: {
      // Entry effect uses SpacetimeSDK service via R channel
      entry: (snap) =>
        Effect.gen(function* () {
          const sdk = yield* SpacetimeSDK;
          const { currentUri, currentModuleName } = snap.context;

          yield* Effect.log(`[Machine] → Connecting to ${currentUri}`);

          // Actually attempt connection via SDK
          // Note: The result will be sent back as an event
          // In real impl, you'd wire SDK callbacks to send these events
          const result = yield* sdk.connect(currentUri!, currentModuleName!).pipe(
            Effect.either
          );

          // For demo, we're simulating - in real impl, SDK callbacks would send events
          if (result._tag === "Right") {
            yield* Effect.log(`[Machine] SDK connected: ${result.right}`);
            // Would trigger: send(ConnectionSuccess.make({ identity: result.right }))
          } else {
            yield* Effect.log(`[Machine] SDK connect failed: ${result.left.message}`);
            // Would trigger: send(ConnectionFailed.make({ error: result.left.message }))
          }
        }),

      on: {
        ConnectionSuccess: (ctx, event) => ({
          goto: Syncing.make({
            uri: ctx.currentUri!,
            moduleName: ctx.currentModuleName!,
            identity: event.identity,
          }),
          update: {
            currentIdentity: event.identity,
          },
        }),

        ConnectionFailed: (ctx, event) => {
          // If we were in a reconnection cycle, bump attempt
          const nextAttempt = ctx.currentAttempt + 1;

          if (nextAttempt < RECONNECT_CONFIG.maxRetries) {
            return {
              goto: Reconnecting.make({
                uri: ctx.currentUri!,
                moduleName: ctx.currentModuleName!,
                attempt: nextAttempt,
              }),
              update: { currentAttempt: nextAttempt },
            };
          }

          return {
            goto: ErrorState.make({
              message: event.error,
              canRetry: true,
              lastUri: ctx.currentUri ?? undefined,
              lastModuleName: ctx.currentModuleName ?? undefined,
            }),
          };
        },
      },
    },

    Syncing: {
      entry: () =>
        Effect.gen(function* () {
          const sdk = yield* SpacetimeSDK;

          yield* Effect.log("[Machine] → Syncing (clearing + subscribing)");

          // Clear stale local state
          yield* sdk.clearLocalState();

          // Subscribe to all tables
          const result = yield* sdk.subscribeAll().pipe(Effect.either);

          if (result._tag === "Left") {
            yield* Effect.log(`[Machine] Sync failed: ${result.left._tag}`);
            // Would trigger: send(SyncFailed.make({ error: ... }))
          } else {
            yield* Effect.log("[Machine] Sync complete");
            // Would trigger: send(SyncComplete.make())
          }
        }),

      on: {
        SyncComplete: (ctx) => ({
          goto: Connected.make({
            uri: ctx.currentUri!,
            moduleName: ctx.currentModuleName!,
            identity: ctx.currentIdentity!,
          }),
          update: {
            lastMessageAt: Date.now(),
            currentAttempt: 0, // Reset attempt counter on success
          },
        }),

        SyncFailed: (ctx, event) => ({
          goto: ErrorState.make({
            message: `Sync failed: ${event.error}`,
            canRetry: true,
            lastUri: ctx.currentUri ?? undefined,
            lastModuleName: ctx.currentModuleName ?? undefined,
          }),
        }),
      },
    },

    Connected: {
      entry: () => Effect.log("[Machine] → Connected! ✓"),
      exit: () =>
        Effect.gen(function* () {
          const sdk = yield* SpacetimeSDK;
          yield* Effect.log("[Machine] ← Leaving Connected");
          yield* sdk.disconnect();
        }),

      // Health check stream: auto-starts on entry, auto-cancels on exit
      run: healthCheckStream,

      on: {
        // Health check evaluates staleness
        HealthCheck: (ctx) => {
          const elapsed = Date.now() - ctx.lastMessageAt;

          if (elapsed > RECONNECT_CONFIG.staleTimeoutMs) {
            console.warn(
              `[Health] Connection stale (${elapsed}ms > ${RECONNECT_CONFIG.staleTimeoutMs}ms)`
            );
            // Return StaleDetected transition - but we handle it below
            // For now, just log. In real impl, this would trigger reconnect.
            return {
              actions: [
                () =>
                  console.log(
                    "[Health] Would trigger StaleDetected → Reconnecting"
                  ),
              ],
            };
          }

          // Healthy - no transition
          return null;
        },

        // Track received messages
        MessageReceived: () => ({
          update: { lastMessageAt: Date.now() },
        }),

        StaleDetected: (ctx) => ({
          goto: Reconnecting.make({
            uri: ctx.currentUri!,
            moduleName: ctx.currentModuleName!,
            attempt: 1,
          }),
          update: {
            currentAttempt: 1,
            totalReconnects: ctx.totalReconnects + 1,
          },
        }),

        Disconnect: (ctx) => ({
          goto: Reconnecting.make({
            uri: ctx.currentUri!,
            moduleName: ctx.currentModuleName!,
            attempt: 1,
          }),
          update: {
            currentAttempt: 1,
            totalReconnects: ctx.totalReconnects + 1,
          },
        }),
      },
    },

    Reconnecting: {
      entry: (snap) => {
        const state = snap.state as typeof Reconnecting.schema.Type;
        return Effect.log(
          `[Machine] → Reconnecting (attempt ${state.attempt}/${RECONNECT_CONFIG.maxRetries})`
        );
      },

      // Retry timer stream: emits RetryNow after backoff delay, auto-cancels on exit
      run: (snap) => {
        const state = snap.state as typeof Reconnecting.schema.Type;
        return createRetryStream(state.attempt);
      },

      on: {
        RetryNow: (ctx) => {
          if (ctx.currentAttempt >= RECONNECT_CONFIG.maxRetries) {
            return {
              goto: ErrorState.make({
                message: `Max retries (${RECONNECT_CONFIG.maxRetries}) exceeded`,
                canRetry: true,
                lastUri: ctx.currentUri ?? undefined,
                lastModuleName: ctx.currentModuleName ?? undefined,
              }),
            };
          }

          return {
            goto: Connecting.make({
              uri: ctx.currentUri!,
              moduleName: ctx.currentModuleName!,
            }),
          };
        },

        // Can receive success/failure during reconnecting too
        ConnectionSuccess: (ctx, event) => ({
          goto: Syncing.make({
            uri: ctx.currentUri!,
            moduleName: ctx.currentModuleName!,
            identity: event.identity,
          }),
          update: { currentIdentity: event.identity },
        }),

        ConnectionFailed: (ctx, event) => {
          const nextAttempt = ctx.currentAttempt + 1;

          if (nextAttempt >= RECONNECT_CONFIG.maxRetries) {
            return {
              goto: ErrorState.make({
                message: event.error,
                canRetry: true,
                lastUri: ctx.currentUri ?? undefined,
                lastModuleName: ctx.currentModuleName ?? undefined,
              }),
            };
          }

          return {
            goto: Reconnecting.make({
              uri: ctx.currentUri!,
              moduleName: ctx.currentModuleName!,
              attempt: nextAttempt,
            }),
            update: { currentAttempt: nextAttempt },
          };
        },
      },
    },

    Error: {
      entry: (snap) => {
        const state = snap.state as typeof ErrorState.schema.Type;
        return Effect.log(`[Machine] → Error: ${state.message}`);
      },

      on: {
        Reset: () => ({
          goto: Disconnected.make(),
          update: {
            currentUri: null,
            currentModuleName: null,
            currentIdentity: null,
            currentAttempt: 0,
          },
        }),

        Connect: (_ctx, event) => ({
          goto: Connecting.make({
            uri: event.uri,
            moduleName: event.moduleName,
          }),
          update: {
            currentUri: event.uri,
            currentModuleName: event.moduleName,
            currentAttempt: 0,
          },
        }),
      },
    },
  },

  // Global handlers (work in any state)
  global: {
    Reset: () => ({
      goto: Disconnected.make(),
      update: {
        lastMessageAt: Date.now(),
        currentUri: null,
        currentModuleName: null,
        currentIdentity: null,
        currentAttempt: 0,
      },
    }),
  },
});

// ============================================================================
// Type exports
// ============================================================================

export type ConnectionMachine = typeof connectionMachine;
