import { Result } from "@effect-atom/atom-react";
import {
  useMessagesQuery,
  useMarkMessagesAsRead,
} from "@/data-access/messages-operations";
import { Message } from "@/types/message";
import { MessageList } from "./message-list";
import { MessageListSkeleton } from "./message-list-skeleton";
import React from "react";

export const ChatContainer = () => {
  const { result, pull, refresh } = useMessagesQuery();

  return (
    <div className="flex h-full flex-col rounded-lg border bg-card">
      <div className="border-b p-4">
        <h2 className="text-lg font-semibold">Messages</h2>
      </div>

      <div className="flex-1 overflow-y-auto">
        {Result.builder(result)
          .onInitial(() => <MessageListSkeleton />)
          .onFailure(() => (
            <div className="flex flex-col items-center justify-center gap-4 p-8 text-center">
              <div className="text-destructive">Failed to load messages</div>
              <button
                onClick={refresh}
                className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
              >
                Retry
              </button>
            </div>
          ))
          .onSuccess(({ items, done }, { waiting }) => {
            const messages = items.flat();
            return (
              <MessageListWithReadTracking
                messages={messages}
                done={done}
                loading={waiting}
                onLoadMore={pull}
              />
            );
          })
          .render()}
      </div>
    </div>
  );
};

// Separate component to use the hook with messages
const MessageListWithReadTracking = ({
  messages: initialMessages,
  done,
  loading,
  onLoadMore,
}: {
  messages: readonly Message[];
  done: boolean;
  loading: boolean;
  onLoadMore: () => void;
}) => {
  const { setElementRef, messages, batchError, clearError } =
    useMarkMessagesAsRead(initialMessages);
  const loadMoreRef = React.useRef<HTMLDivElement>(null);

  // Observe the load more sentinel to trigger infinite scroll
  React.useEffect(() => {
    if (done || loading) return;

    const sentinel = loadMoreRef.current;
    if (!sentinel) return;

    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          onLoadMore();
        }
      },
      { threshold: 0.1 },
    );

    intersectionObserver.observe(sentinel);
    return () => intersectionObserver.disconnect();
  }, [done, loading, onLoadMore]);

  return (
    <>
      {batchError && (
        <div className="mx-4 mt-4 flex items-center justify-between rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <span>{batchError.message}</span>
          <button
            onClick={clearError}
            className="ml-4 text-destructive hover:text-destructive/80"
          >
            Dismiss
          </button>
        </div>
      )}
      <MessageList messages={messages} setElementRef={setElementRef} />
      {!done && (
        <div ref={loadMoreRef} className="flex justify-center p-4">
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading more...</div>
          ) : (
            <button
              onClick={onLoadMore}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Load more messages
            </button>
          )}
        </div>
      )}
    </>
  );
};
