import { AtomHttpApi } from "@effect-atom/atom-react";
import { FetchHttpClient } from "@effect/platform";
import { MessagesApi } from "./messages-api";

export class MessagesClient extends AtomHttpApi.Tag<MessagesClient>()("MessagesClient", {
  api: MessagesApi,
  httpClient: FetchHttpClient.layer,
  baseUrl: "http://localhost:3001",
}) {}
