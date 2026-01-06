<p align="center">
  <img src="assets/logo.png" alt="effstate logo" width="200" />
</p>

<h1 align="center">effstate</h1>

<p align="center">
  <strong>Effect-first state machine library for TypeScript</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/effstate"><img src="https://img.shields.io/npm/v/effstate.svg" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/effstate"><img src="https://img.shields.io/npm/dm/effstate.svg" alt="npm downloads" /></a>
  <a href="https://github.com/handfish/effstate/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/effstate.svg" alt="license" /></a>
</p>

---

**effstate** is a state machine library built on top of the [Effect](https://effect.website) ecosystem. It provides a type-safe, composable way to define and manage state machines with first-class support for effects, activities, and hierarchical (parent-child) machines.

## Features

- **Effect-first**: Built on Effect for robust error handling, dependency injection, and composability
- **Type-safe**: Full TypeScript support with inferred types for states, events, and context
- **Activities**: Long-running effects that start/stop with state transitions
- **Guards**: Conditional transitions based on context or event data
- **Invocations**: Async operations with automatic result handling
- **Parent-child machines**: Spawn child machines and communicate via events
- **Cross-tab sync**: Built-in support for synchronizing state across browser tabs
- **Schema validation**: Optional Effect Schema integration for context validation

## Why effstate over XState?

| Metric | effstate | XState |
|--------|----------|--------|
| **Bundle size (gzip)** | **~3.9 kB** | 13.7 kB |
| Event processing | **30x faster** | - |
| With subscribers | **14x faster** | - |

[See full comparison →](https://handfish.github.io/effstate/getting-started/comparison/)

## Live Demo

**[Try the Interactive Demo →](https://handfish.github.io/effstate/demo/)**

Watch state machines sync across browser tabs in real-time!

## Packages

| Package | Description |
|---------|-------------|
| [`effstate`](./packages/core) | Core state machine library |
| [`@effstate/react`](./packages/react) | React integration with hooks |

## Quick Start

```bash
npm install effstate effect
# or
pnpm add effstate effect
```

### Defining a Machine as an Effect.Service

The recommended pattern is to define your state machine inside an `Effect.Service`. This enables proper dependency injection, testability, and composition with other Effect services.

```typescript
import { createMachine, interpret, assign, effect } from "effstate";
import { Data, Effect, Schema, Scope } from "effect";

// =============================================================================
// 1. Define your events using Data.TaggedClass
// =============================================================================

class Connect extends Data.TaggedClass("CONNECT")<{}> {}
class Disconnect extends Data.TaggedClass("DISCONNECT")<{}> {}
class Retry extends Data.TaggedClass("RETRY")<{}> {}

type ConnectionEvent = Connect | Disconnect | Retry;

// =============================================================================
// 2. Define context schema (optional but recommended)
// =============================================================================

const ConnectionContextSchema = Schema.Struct({
  retryCount: Schema.Number,
  lastError: Schema.optionalWith(Schema.String, { as: "Option" }),
});

type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

// =============================================================================
// 3. Define your machine service with dependencies
// =============================================================================

// Example dependency: an API client service
class ApiClient extends Effect.Service<ApiClient>()("ApiClient", {
  succeed: {
    connect: () => Effect.tryPromise(() => fetch("/api/connect")),
  },
}) {}

// The machine service - captures dependencies at creation time
export class ConnectionMachineService extends Effect.Service<ConnectionMachineService>()(
  "ConnectionMachineService",
  {
    effect: Effect.gen(function* () {
      // Yield dependencies - they're captured in the closure
      const api = yield* ApiClient;

      // Define the machine with access to dependencies
      const machine = createMachine<
        ConnectionState,
        ConnectionEvent,
        typeof ConnectionContextSchema
      >({
        id: "connection",
        initial: "disconnected",
        context: ConnectionContextSchema,
        initialContext: {
          retryCount: 0,
          lastError: undefined,
        },
        states: {
          disconnected: {
            on: {
              CONNECT: { target: "connecting" },
            },
          },

          connecting: {
            entry: [effect(() => Effect.log("Attempting to connect..."))],
            invoke: {
              id: "connect",
              src: () => api.connect(), // Use the injected dependency
              onDone: { target: "connected" },
              onError: {
                target: "error",
                actions: [
                  assign(({ context }) => ({
                    retryCount: context.retryCount + 1,
                    lastError: "Connection failed",
                  })),
                ],
              },
            },
          },

          connected: {
            entry: [
              effect(() => Effect.log("Connected successfully!")),
              assign(() => ({ retryCount: 0, lastError: undefined })),
            ],
            on: {
              DISCONNECT: { target: "disconnected" },
            },
          },

          error: {
            on: {
              RETRY: {
                target: "connecting",
                guard: ({ context }) => context.retryCount < 3,
              },
              DISCONNECT: { target: "disconnected" },
            },
          },
        },
      });

      return {
        definition: machine,
        createActor: () => interpret(machine),
      };
    }),
    // Declare dependencies - they'll be automatically composed
    dependencies: [ApiClient.Default],
  }
) {}

// =============================================================================
// 4. Use the service
// =============================================================================

const program = Effect.gen(function* () {
  const connectionService = yield* ConnectionMachineService;
  const actor = yield* connectionService.createActor();

  // Subscribe to state changes
  actor.subscribe((snapshot) => {
    console.log(`State: ${snapshot.value}, Retries: ${snapshot.context.retryCount}`);
  });

  // Send events
  actor.send(new Connect());
});

// Run with all dependencies provided
Effect.runPromise(
  program.pipe(
    Effect.scoped,
    Effect.provide(ConnectionMachineService.Default)
  )
);
```

### Why Effect.Service?

1. **Dependency Injection**: Services can depend on other services (like `ApiClient` above)
2. **Testability**: Swap implementations for testing by providing different layers
3. **Composability**: Services automatically compose their dependency trees
4. **Type Safety**: Full type inference for dependencies and effects

## React Integration

```bash
npm install @effstate/react @effect-atom/atom-react
```

```typescript
import { createUseMachineHook } from "@effstate/react";
import { Atom } from "@effect-atom/atom-react";
import { Effect, Layer, SubscriptionRef } from "effect";

// Create your app runtime with all service layers
const AppLayer = Layer.mergeAll(
  ConnectionMachineService.Default,
  // ... other services
);

const appRuntime = Atom.runtime(AppLayer);

// Create atoms for the machine
const actorAtom = appRuntime.atom(
  Effect.gen(function* () {
    const service = yield* ConnectionMachineService;
    return yield* service.createActor();
  })
).pipe(Atom.keepAlive);

const snapshotAtom = appRuntime.subscriptionRef((get) =>
  Effect.gen(function* () {
    const actor = yield* get.result(actorAtom);
    const ref = yield* SubscriptionRef.make(actor.getSnapshot());
    actor.subscribe((snapshot) => {
      Effect.runSync(SubscriptionRef.set(ref, snapshot));
    });
    return ref;
  })
).pipe(Atom.keepAlive);

// Create the hook
const useConnectionMachine = createUseMachineHook(actorAtom, snapshotAtom, initialSnapshot);

// Use in component
function ConnectionStatus() {
  const { snapshot, send, context, isLoading } = useConnectionMachine();

  if (isLoading) return <div>Loading...</div>;

  return (
    <div>
      <p>Status: {snapshot.value}</p>
      {snapshot.value === "error" && (
        <p>Retries: {context.retryCount}/3</p>
      )}
      <button
        onClick={() => send(
          snapshot.value === "connected" ? new Disconnect() : new Connect()
        )}
      >
        {snapshot.value === "connected" ? "Disconnect" : "Connect"}
      </button>
    </div>
  );
}
```

## Documentation

Visit the [documentation site](https://handfish.github.io/effstate/) for:

- [Getting Started Guide](https://handfish.github.io/effstate/getting-started/introduction/)
- [Comparison with XState](https://handfish.github.io/effstate/getting-started/comparison/)
- [API Reference](https://handfish.github.io/effstate/api/create-machine/)
- [Interactive Demo](https://handfish.github.io/effstate/demo/)

## Development

This is a monorepo managed with [Turborepo](https://turbo.build/) and [pnpm](https://pnpm.io/).

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Run the demo app
pnpm --filter demo dev

# Run the docs site
pnpm --filter docs dev
```

## Project Structure

```
.
├── packages/
│   ├── core/          # effstate - core state machine library
│   └── react/         # @effstate/react - React integration
├── apps/
│   ├── demo/          # Interactive demo application
│   └── docs/          # Astro Starlight documentation site
└── assets/            # Shared assets (logo, etc.)
```

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting a PR.

## License

MIT
