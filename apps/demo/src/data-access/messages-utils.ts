import { DateTime } from "effect";
import { Message } from "@/types/message";

/**
 * Computes the set of message IDs that should be skipped for read tracking.
 * Combines messages already read on server with locally optimistic reads.
 */
export const computeSkipIds = (
  messages: readonly Message[],
  localReadIds: Set<string>,
): Set<string> => {
  const ids = new Set<string>(localReadIds);
  messages.forEach((msg) => {
    if (msg.readAt !== null) ids.add(msg.id);
  });
  return ids;
};

/**
 * Merges optimistic read status into messages.
 * Returns messages with readAt updated for locally marked messages.
 */
export const mergeReadStatus = (
  messages: readonly Message[],
  localReadIds: Set<string>,
): Message[] =>
  messages.map((msg) =>
    localReadIds.has(msg.id) && msg.readAt === null
      ? { ...msg, readAt: DateTime.unsafeNow() }
      : msg,
  );

/**
 * Filters messages to only those that are unread (not on server, not locally marked).
 */
export const filterUnreadMessages = (
  messages: readonly Message[],
  localReadIds: Set<string>,
): Message[] =>
  messages.filter((msg) => msg.readAt === null && !localReadIds.has(msg.id));
