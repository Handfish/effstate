import { describe, it, expect, beforeEach } from "vitest";
import { MessageId } from "@/types/message";
import {
  createMessage,
  createReadMessage,
  resetMessageIdCounter,
} from "@/test/factories";
import {
  computeSkipIds,
  filterUnreadMessages,
  mergeReadStatus,
} from "./messages-utils";

beforeEach(() => {
  resetMessageIdCounter();
});

describe("computeSkipIds", () => {
  it("returns empty set when no messages and no local reads", () => {
    const result = computeSkipIds([], new Set());
    expect(result.size).toBe(0);
  });

  it("includes messages already read on server", () => {
    const messages = [
      createReadMessage({ id: "1" as MessageId }),
      createMessage({ id: "2" as MessageId }),
      createReadMessage({ id: "3" as MessageId }),
    ];

    const result = computeSkipIds(messages, new Set());

    expect(result.has("1")).toBe(true);
    expect(result.has("2")).toBe(false);
    expect(result.has("3")).toBe(true);
  });

  it("includes locally marked read IDs", () => {
    const messages = [createMessage({ id: "1" as MessageId })];
    const localReadIds = new Set(["2", "3"]);

    const result = computeSkipIds(messages, localReadIds);

    expect(result.has("2")).toBe(true);
    expect(result.has("3")).toBe(true);
  });

  it("combines server and local read IDs without duplicates", () => {
    const messages = [
      createReadMessage({ id: "1" as MessageId }),
      createMessage({ id: "2" as MessageId }),
    ];
    const localReadIds = new Set(["1", "3"]); // "1" is both server and local

    const result = computeSkipIds(messages, localReadIds);

    expect(result.size).toBe(2); // "1" and "3", not "1", "1", "3"
    expect(result.has("1")).toBe(true);
    expect(result.has("3")).toBe(true);
  });
});

describe("mergeReadStatus", () => {
  it("returns messages unchanged when no local reads", () => {
    const messages = [
      createMessage({ id: "1" as MessageId }),
      createMessage({ id: "2" as MessageId }),
    ];

    const result = mergeReadStatus(messages, new Set());

    expect(result[0].readAt).toBeNull();
    expect(result[1].readAt).toBeNull();
  });

  it("updates readAt for locally marked messages", () => {
    const messages = [
      createMessage({ id: "1" as MessageId }),
      createMessage({ id: "2" as MessageId }),
    ];
    const localReadIds = new Set(["1"]);

    const result = mergeReadStatus(messages, localReadIds);

    expect(result[0].readAt).not.toBeNull();
    expect(result[1].readAt).toBeNull();
  });

  it("does not double-update already read messages", () => {
    const originalReadAt = { _tag: "Utc" as const, epochMillis: 1000 };
    const messages = [
      createReadMessage({
        id: "1" as MessageId,
        readAt: originalReadAt as any,
      }),
    ];
    const localReadIds = new Set(["1"]);

    const result = mergeReadStatus(messages, localReadIds);

    // Should keep original readAt, not create a new one
    expect(result[0].readAt).toBe(originalReadAt);
  });
});

describe("filterUnreadMessages", () => {
  it("returns all messages when none are read", () => {
    const messages = [
      createMessage({ id: "1" as MessageId }),
      createMessage({ id: "2" as MessageId }),
    ];

    const result = filterUnreadMessages(messages, new Set());

    expect(result).toHaveLength(2);
  });

  it("excludes messages read on server", () => {
    const messages = [
      createReadMessage({ id: "1" as MessageId }),
      createMessage({ id: "2" as MessageId }),
    ];

    const result = filterUnreadMessages(messages, new Set());

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("2");
  });

  it("excludes messages marked locally", () => {
    const messages = [
      createMessage({ id: "1" as MessageId }),
      createMessage({ id: "2" as MessageId }),
    ];
    const localReadIds = new Set(["1"]);

    const result = filterUnreadMessages(messages, localReadIds);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("2");
  });

  it("returns empty when all messages are read", () => {
    const messages = [
      createReadMessage({ id: "1" as MessageId }),
      createMessage({ id: "2" as MessageId }),
    ];
    const localReadIds = new Set(["2"]);

    const result = filterUnreadMessages(messages, localReadIds);

    expect(result).toHaveLength(0);
  });
});
