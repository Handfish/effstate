import { useVisibilityTracker } from "@/hooks/useVisibilityTracker";
import { MessagesClient } from "@/lib/api/messages-client";
import { appRuntime } from "@/lib/app-runtime";
import { NetworkMonitor } from "@/lib/services/network-monitor";
import { Message, MessageId } from "@/types/message";
import { Atom, Result, useAtom, useAtomRefresh, useAtomValue } from "@effect-atom/atom-react";
import { Chunk, Duration, Effect, Option, Queue, Schedule, Stream } from "effect";
import React from "react";
import { computeSkipIds, filterUnreadMessages, mergeReadStatus } from "./messages-utils";

// ============================================================================
// Messages Query with Infinite Scroll (using Atom.pull)
// ============================================================================

// Create a stream that fetches messages page by page using paginateEffect
const messagesStream = Stream.paginateEffect(undefined as string | undefined, (cursor) =>
  Effect.gen(function* () {
    const client = yield* MessagesClient;
    const response = yield* client.messages.getMessages({
      urlParams: cursor !== undefined ? { cursor } : {},
    });

    const nextState =
      response.nextCursor !== null ? Option.some(response.nextCursor) : Option.none();
    return [response.messages, nextState] as const;
  }),
);

// Use Atom.pull to create a pull-based atom for infinite scroll
export const messagesAtom = appRuntime.pull(messagesStream).pipe(Atom.keepAlive);

// React Hooks for message stream
export const useMessagesQuery = () => {
  const [result, pull] = useAtom(messagesAtom);
  const refresh = useAtomRefresh(messagesAtom);
  return { result, pull, refresh };
};

// ============================================================================
// Batch Processor Atom (handles the stream with batching)
// ============================================================================

// Track which message IDs have been queued to avoid duplicates
const queuedMessageIds = new Set<string>();

export type BatchError = { message: string; failedIds: readonly MessageId[] } | null;

// Callbacks for batch events (set by the hook)
let onBatchError: ((error: BatchError) => void) | null = null;
let onBatchSuccess: ((ids: readonly MessageId[]) => void) | null = null;

export const setBatchCallbacks = (callbacks: {
  onError: ((error: BatchError) => void) | null;
  onSuccess: ((ids: readonly MessageId[]) => void) | null;
}) => {
  onBatchError = callbacks.onError;
  onBatchSuccess = callbacks.onSuccess;
};

const batchProcessorAtom = appRuntime
  .atom(
    Effect.gen(function* () {
      const client = yield* MessagesClient;
      const networkMonitor = yield* NetworkMonitor;
      const markAsReadQueue = yield* Queue.unbounded<MessageId>();

      yield* Stream.fromQueue(markAsReadQueue).pipe(
        Stream.tap((value) => Effect.log(`Queued up ${value}`)),
        Stream.groupedWithin(25, Duration.seconds(5)),
        Stream.tap((batch) => Effect.log(`Batching: ${Chunk.join(batch, ", ")}`)),
        Stream.mapEffect(
          (batch) =>
            client.messages
              .markAsRead({
                payload: { messageIds: Chunk.toReadonlyArray(batch) as MessageId[] },
              })
              .pipe(
                networkMonitor.latch.whenOpen,
                Effect.retry({ times: 3, schedule: Schedule.exponential("500 millis", 2) }),
                Effect.tap(() =>
                  Effect.sync(() => {
                    const ids = Chunk.toReadonlyArray(batch) as MessageId[];
                    console.log(`Batched: ${ids.join(", ")}`);
                    onBatchSuccess?.(ids);
                  }),
                ),
                Effect.tapErrorCause(() =>
                  Effect.sync(() => {
                    const ids = Chunk.toReadonlyArray(batch) as MessageId[];
                    console.error("Batch failed:", ids.join(", "));
                    onBatchError?.({
                      message: "Failed to mark messages as read",
                      failedIds: ids,
                    });
                  }),
                ),
                Effect.catchAllCause((cause) => Effect.log(cause, "Error processing batch")),
              ),
          { concurrency: 1 },
        ),
        Stream.runDrain,
        Effect.forkScoped,
      );

      return { markAsReadQueue };
    }),
  )
  .pipe(Atom.keepAlive);

// ============================================================================
// React Hook for Batch Updating
// ============================================================================

export const useMarkMessagesAsRead = (messages: readonly Message[]) => {
  const processorResult = useAtomValue(batchProcessorAtom);
  const [readMessageIds, setReadMessageIds] = React.useState<Set<string>>(new Set());
  const [batchError, setBatchError] = React.useState<BatchError>(null);

  // Register batch callbacks
  React.useEffect(() => {
    setBatchCallbacks({
      onError: setBatchError,
      onSuccess: (ids) => {
        setReadMessageIds((prev) => {
          const next = new Set(prev);
          ids.forEach((id) => next.add(id));
          return next;
        });
      },
    });
    return () => setBatchCallbacks({ onError: null, onSuccess: null });
  }, []);

  // Clear error
  const clearError = React.useCallback(() => {
    setBatchError(null);
  }, []);

  // Mark a message as read: queue it for batching + optimistic update
  const markAsRead = React.useCallback(
    (id: Message["id"]) => {
      if (queuedMessageIds.has(id)) return;
      queuedMessageIds.add(id);

      if (Result.isSuccess(processorResult)) {
        processorResult.value.markAsReadQueue.unsafeOffer(id);
      }

      // Optimistic update
      setReadMessageIds((prev) => new Set(prev).add(id));
    },
    [processorResult],
  );

  // Combine server-side read IDs with locally marked read IDs
  const skipIds = React.useMemo(
    () => computeSkipIds(messages, readMessageIds),
    [messages, readMessageIds],
  );

  // Track visibility and mark as read when elements become visible
  const { setElementRef, getElement } = useVisibilityTracker({
    onVisible: markAsRead,
    skipIds,
  });

  // Handle focus events - mark visible unread messages as read
  const unreadMessages = React.useMemo(
    () => filterUnreadMessages(messages, readMessageIds),
    [messages, readMessageIds],
  );

  React.useEffect(() => {
    const handleFocus = () => {
      if (!document.hasFocus()) return;

      unreadMessages.forEach((message) => {
        const element = getElement(message.id);
        if (!element) return;

        const rect = element.getBoundingClientRect();
        const isFullyVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;

        if (isFullyVisible) {
          markAsRead(message.id);
        }
      });
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [unreadMessages, getElement, markAsRead]);

  // Merge read status for optimistic updates
  const messagesWithReadStatus = React.useMemo(
    () => mergeReadStatus(messages, readMessageIds),
    [messages, readMessageIds],
  );

  return { setElementRef, messages: messagesWithReadStatus, batchError, clearError };
};
