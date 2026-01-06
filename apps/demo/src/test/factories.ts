import { DateTime } from "effect";
import { Message, MessageId } from "@/types/message";

let messageIdCounter = 1;

export const createMessage = (overrides: Partial<Message> = {}): Message => ({
  id: `${messageIdCounter++}` as MessageId,
  body: "Test message",
  createdAt: DateTime.unsafeNow(),
  readAt: null,
  ...overrides,
});

export const createReadMessage = (overrides: Partial<Message> = {}): Message =>
  createMessage({ readAt: DateTime.unsafeNow(), ...overrides });

export const resetMessageIdCounter = () => {
  messageIdCounter = 1;
};
