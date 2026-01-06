import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { Array, DateTime } from "effect";

// Sample data
const sampleMessageBodies = [
  "Hey there! How are you doing today?",
  "I'm doing great, thanks for asking! How about you?",
  "Pretty good! Just finished my morning coffee.",
  "Nice! I'm still working on mine. Did you see the weather forecast?",
  "Yeah, looks like rain later today.",
  "Perfect weather for staying in and coding!",
  "Absolutely! What are you working on these days?",
  "Building a chat application with React and TypeScript",
  "That sounds interesting! How's it going so far?",
  "Pretty well! Just working on the UI components now.",
  "Are you using any UI libraries?",
  "Yeah, I'm using Tailwind CSS for styling",
  "Nice choice! I love Tailwind's utility-first approach",
  "Me too! It makes styling so much faster",
  "Have you tried any component libraries with it?",
  "I've been looking at shadcn/ui actually",
  "That's a great choice! Very customizable",
  "Yeah, I like how it's not a dependency",
  "Are you planning to add any real-time features?",
  "Definitely! Thinking about using WebSocket",
  "Have you worked with WebSocket before?",
  "A little bit, but I'm excited to learn more",
  "That's the best way to learn - by doing!",
  "Exactly! It's been fun so far",
  "Oh, looks like it started raining",
  "Perfect timing for coding, just like we said!",
  "Absolutely! Time to grab another coffee",
  "Good idea! I should do the same",
  "Talk to you later then?",
  "Definitely! Enjoy your coffee!",
];

type Message = {
  id: string;
  body: string;
  createdAt: string;
  readAt: string | null;
};

// Generate 30 messages for infinite scroll testing
const messages: Message[] = Array.makeBy(30, (i) => ({
  id: `${i + 1}`,
  body: sampleMessageBodies[i % sampleMessageBodies.length],
  createdAt: DateTime.unsafeMake("2024-03-20T10:00:00Z").pipe(
    DateTime.add({ minutes: i * 2 }),
    DateTime.formatIso,
  ),
  readAt: null,
}));

const DEFAULT_LIMIT = 10;

const app = new Hono();

// Enable CORS for local development
app.use("/*", cors());

// GET /messages - return paginated messages
app.get("/messages", async (c) => {
  const cursor = c.req.query("cursor");
  const limit = parseInt(c.req.query("limit") || `${DEFAULT_LIMIT}`, 10);

  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 500));

  // Find starting index based on cursor
  let startIndex = 0;
  if (cursor) {
    const cursorIndex = messages.findIndex((m) => m.id === cursor);
    if (cursorIndex !== -1) {
      startIndex = cursorIndex + 1;
    }
  }

  // Get page of messages
  const pageMessages = messages.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < messages.length;
  const nextCursor = hasMore ? pageMessages[pageMessages.length - 1]?.id : null;

  console.log(`Fetching messages: cursor=${cursor}, limit=${limit}, returned=${pageMessages.length}, nextCursor=${nextCursor}`);

  return c.json({
    messages: pageMessages,
    nextCursor,
  });
});

// POST /messages/mark-read - mark messages as read
app.post("/messages/mark-read", async (c) => {
  const body = await c.req.json<{ messageIds: string[] }>();

  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 1000));

  const now = DateTime.formatIso(DateTime.unsafeNow());

  body.messageIds.forEach((id) => {
    const message = messages.find((m) => m.id === id);
    if (message && message.readAt === null) {
      message.readAt = now;
    }
  });

  console.log(`Marked ${body.messageIds.length} messages as read:`, body.messageIds);

  return c.body(null, 204);
});

const port = 3001;
console.log(`Server running at http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});
