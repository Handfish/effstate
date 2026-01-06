import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Schema } from "effect";
import { Message, MessageId } from "@/types/message";

// Request/Response schemas
const MarkAsReadRequest = Schema.Struct({
  messageIds: Schema.Array(MessageId),
});

const GetMessagesParams = Schema.Struct({
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString),
});

const GetMessagesResponse = Schema.Struct({
  messages: Schema.Array(Message),
  nextCursor: Schema.NullOr(Schema.String),
});

// API definition
export class MessagesApi extends HttpApi.make("messages-api").add(
  HttpApiGroup.make("messages")
    .add(
      HttpApiEndpoint.get("getMessages", "/messages")
        .setUrlParams(GetMessagesParams)
        .addSuccess(GetMessagesResponse),
    )
    .add(
      HttpApiEndpoint.post("markAsRead", "/messages/mark-read")
        .setPayload(MarkAsReadRequest)
        .addSuccess(Schema.Void),
    ),
) {}
