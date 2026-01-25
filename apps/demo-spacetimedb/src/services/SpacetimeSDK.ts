/**
 * SpacetimeSDK Service
 *
 * Effect.Service wrapper around the SpacetimeDB TypeScript SDK.
 * This handles the raw connection; the state machine manages transitions.
 */

import { Context, Effect, Layer } from "effect";
import { ConnectionError, DisconnectedError, SubscriptionError } from "../lib/errors";

// ============================================================================
// Service Interface
// ============================================================================

export interface SpacetimeSDKService {
  /**
   * Attempt to connect to SpacetimeDB.
   * Returns identity on success.
   */
  readonly connect: (uri: string, moduleName: string) => Effect.Effect<string, ConnectionError>;

  /**
   * Disconnect from SpacetimeDB.
   */
  readonly disconnect: () => Effect.Effect<void>;

  /**
   * Subscribe to all tables.
   * Resolves when subscription is applied.
   */
  readonly subscribeAll: () => Effect.Effect<void, SubscriptionError>;

  /**
   * Clear local cached state.
   */
  readonly clearLocalState: () => Effect.Effect<void>;

  /**
   * Call a reducer.
   */
  readonly callReducer: <Args extends unknown[]>(
    name: string,
    ...args: Args
  ) => Effect.Effect<void, DisconnectedError>;

  /**
   * Check if currently connected.
   */
  readonly isConnected: () => Effect.Effect<boolean>;
}

// ============================================================================
// Service Tag
// ============================================================================

export class SpacetimeSDK extends Context.Tag("SpacetimeSDK")<
  SpacetimeSDK,
  SpacetimeSDKService
>() {}

// ============================================================================
// Mock Implementation (for demo)
// ============================================================================

const createMockService = (): SpacetimeSDKService => {
  let connected = false;
  let identity: string | null = null;

  return {
    connect: (uri, moduleName) =>
      Effect.gen(function* () {
        yield* Effect.log(`[SDK] Connecting to ${uri}/${moduleName}...`);
        yield* Effect.sleep("1 second");

        // Simulate 80% success rate
        if (Math.random() > 0.2) {
          connected = true;
          identity = `identity-${Math.random().toString(36).slice(2, 10)}`;
          yield* Effect.log(`[SDK] Connected as ${identity}`);
          return identity;
        } else {
          return yield* Effect.fail(new ConnectionError({ message: "Connection refused (mock)" }));
        }
      }),

    disconnect: () =>
      Effect.sync(() => {
        console.log("[SDK] Disconnected");
        connected = false;
        identity = null;
      }),

    subscribeAll: () =>
      Effect.gen(function* () {
        yield* Effect.log("[SDK] Subscribing to all tables...");
        yield* Effect.sleep("500 millis");

        // Simulate 90% success rate
        if (Math.random() > 0.1) {
          yield* Effect.log("[SDK] Subscription applied");
        } else {
          return yield* Effect.fail(new SubscriptionError({ cause: "Subscription failed (mock)" }));
        }
      }),

    clearLocalState: () =>
      Effect.sync(() => {
        console.log("[SDK] Local state cleared");
      }),

    callReducer: (name, ...args) =>
      Effect.gen(function* () {
        if (!connected) {
          return yield* Effect.fail(new DisconnectedError({ reason: "Not connected" }));
        }
        yield* Effect.log(`[SDK] Calling reducer: ${name}`, { args });
      }),

    isConnected: () => Effect.succeed(connected),
  };
};

// ============================================================================
// Layer
// ============================================================================

export const MockSpacetimeSDKLayer = Layer.succeed(SpacetimeSDK, createMockService());

// For real implementation, you'd create:
// export const LiveSpacetimeSDKLayer = Layer.effect(SpacetimeSDK, makeRealService)
