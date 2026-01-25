/**
 * Tagged Error Definitions
 *
 * Using Effect's Data.TaggedError for discriminated error unions.
 */

import { Data } from "effect";

// --- Connection Errors ---
export class ConnectionError extends Data.TaggedError("ConnectionError")<{
  cause?: unknown;
  message: string;
}> {}

export class DisconnectedError extends Data.TaggedError("DisconnectedError")<{
  reason?: string;
}> {}

export class TimeoutError extends Data.TaggedError("TimeoutError")<{
  operation: string;
  durationMs: number;
}> {}

// --- Sync Errors ---
export class SyncError extends Data.TaggedError("SyncError")<{
  cause?: unknown;
  message: string;
}> {}

export class SubscriptionError extends Data.TaggedError("SubscriptionError")<{
  table?: string;
  cause?: unknown;
}> {}

// --- Reducer Errors ---
export class ReducerError extends Data.TaggedError("ReducerError")<{
  reducer: string;
  cause?: unknown;
  status?: "Failed" | "OutOfEnergy";
}> {}

// --- Union type ---
export type ConnectionServiceError =
  | ConnectionError
  | DisconnectedError
  | TimeoutError
  | SyncError
  | SubscriptionError
  | ReducerError;

// --- Helper to check if error is retryable ---
export const isRetryableError = (error: ConnectionServiceError): boolean => {
  switch (error._tag) {
    case "ConnectionError":
    case "DisconnectedError":
    case "TimeoutError":
    case "SubscriptionError":
    case "SyncError":
      return true;
    case "ReducerError":
      return false; // Server rejected - don't retry
    default:
      return false;
  }
};
