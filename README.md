<p align="center">
  <img src="assets/logo.png" alt="effstate logo" width="200" />
</p>

<h1 align="center">effstate</h1>

<p align="center">
  <strong>Lean, schema-first state machines for Effect</strong>
</p>

<p align="center">
  <a href="https://handfish.github.io/effstate/"><img src="https://img.shields.io/badge/docs-website-blue.svg" alt="documentation" /></a>
  <a href="https://www.npmjs.com/package/@handfish/effstate-v4"><img src="https://img.shields.io/npm/v/@handfish/effstate-v4.svg" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@handfish/effstate-v4"><img src="https://img.shields.io/npm/dm/@handfish/effstate-v4.svg" alt="npm downloads" /></a>
  <a href="https://github.com/handfish/effstate/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@handfish/effstate-v4.svg" alt="license" /></a>
</p>

---

**effstate** is a state machine library built on top of the [Effect](https://effect.website) ecosystem. The v4 API is schema-first: you define states and events once with [Effect Schema](https://effect.website/docs/schema/introduction/) and get constructors, type guards, discriminated-union types, and serialization for free. Entry/exit logic and long-running work are plain Effects and Streams, complete with the requirements (`R`) and error (`Err`) channels — so dependency injection, resource safety, and honest error handling come along for the ride.

## Features

- **Schema-first**: Define states and events with `State()` / `Event()` — one source of truth for types, runtime validation, and serialization
- **Type-safe**: Full TypeScript inference over discriminated unions of states, events, and context
- **Effect-native**: Entry/exit effects and run streams carry the full Effect `R` (requirements) and `Err` (error) channels
- **Auto-cleanup**: `run` streams cancel automatically when the machine leaves a state
- **Honest errors**: Effect failures surface through an `onError` callback instead of being swallowed
- **Minimal**: ~500 lines, zero dependencies beyond Effect
- **React-ready**: Imperative actor API with first-class hooks for React

## Why effstate over XState?

| Metric | effstate | XState |
|--------|----------|--------|
| **Bundle size (gzip)** | **~6 kB** | 13.7 kB |
| Event processing | **25x faster** | - |
| Realistic app lifecycle | **5x faster** | - |

[See full comparison →](https://handfish.github.io/effstate/getting-started/comparison/)

## Live Demo

**[Try the Interactive Demo →](https://handfish.github.io/effstate/demo/)**

Watch state machines sync across browser tabs in real-time!

## Packages

| Package | Description |
|---------|-------------|
| [`@handfish/effstate-v4`](./packages/effstate-v4) | Core schema-first state machine library |
| [`@handfish/effstate-react`](./packages/effstate-react) | React hooks for effstate-v4 |

## Quick Start

```bash
npm install @handfish/effstate-v4 effect
# or
pnpm add @handfish/effstate-v4 effect
```

### Defining a Machine

States and events are defined with `State()` and `Event()`. Each definition bundles an Effect Schema, a `.make()` constructor, and an `.is()` type guard. Event handlers are pure functions `(context, event) => Transition`.

```typescript
import {
  State,
  Event,
  Union,
  defineMachine,
  type StateType,
  type EventType,
} from "@handfish/effstate-v4";
import { Duration, Effect, Schedule, Schema, Stream } from "effect";

// =============================================================================
// 1. Define states (schema-first discriminated union)
// =============================================================================

const Disconnected = State("Disconnected", {});
const Connecting = State("Connecting", { startedAt: Schema.DateFromSelf });
const Connected = State("Connected", { connectedAt: Schema.DateFromSelf });

const ConnectionStateSchema = Union(Disconnected, Connecting, Connected);
type ConnectionState =
  | StateType<typeof Disconnected>
  | StateType<typeof Connecting>
  | StateType<typeof Connected>;

// =============================================================================
// 2. Define events
// =============================================================================

const Connect = Event("Connect", { uri: Schema.String });
const ConnectSuccess = Event("ConnectSuccess", {});
const ConnectError = Event("ConnectError", { message: Schema.String });
const Ping = Event("Ping", {});
const Disconnect = Event("Disconnect", {});

type ConnectionEvent =
  | EventType<typeof Connect>
  | EventType<typeof ConnectSuccess>
  | EventType<typeof ConnectError>
  | EventType<typeof Ping>
  | EventType<typeof Disconnect>;

// =============================================================================
// 3. Define context (a plain type; add a Schema for serialization/sync)
// =============================================================================

interface ConnectionContext {
  readonly uri: string;
  readonly retryCount: number;
  readonly lastPingAt: number;
}

const ConnectionContextSchema = Schema.Struct({
  uri: Schema.String,
  retryCount: Schema.Number,
  lastPingAt: Schema.Number,
});

// A `run` stream produces events while in a state and auto-cancels on exit.
const healthCheckStream = Stream.fromSchedule(
  Schedule.spaced(Duration.seconds(5))
).pipe(Stream.map(() => Ping.make()));

// =============================================================================
// 4. Define the machine
// =============================================================================

const connectionMachine = defineMachine<
  ConnectionState,
  ConnectionContext,
  ConnectionEvent
>({
  id: "connection",
  initialState: Disconnected.make(),
  initialContext: { uri: "", retryCount: 0, lastPingAt: 0 },
  context: ConnectionContextSchema, // optional — enables serialization & cross-tab sync

  states: {
    Disconnected: {
      on: {
        // Transition to a new state and update context in one step.
        Connect: (_ctx, event) => ({
          goto: Connecting.make({ startedAt: new Date() }),
          update: { uri: event.uri },
        }),
      },
    },

    Connecting: {
      // Entry effects have full access to the requirements & error channels.
      entry: (snap) => Effect.log(`Connecting to ${snap.context.uri}...`),
      on: {
        ConnectSuccess: () => ({
          goto: Connected.make({ connectedAt: new Date() }),
        }),
        // A guard is just a handler that returns `null` to stay put.
        ConnectError: (ctx) =>
          ctx.retryCount < 3
            ? {
                goto: Connecting.make({ startedAt: new Date() }),
                update: { retryCount: ctx.retryCount + 1 },
              }
            : { goto: Disconnected.make() },
      },
    },

    Connected: {
      entry: () => Effect.log("Connected!"),
      exit: () => Effect.log("Disconnecting..."),
      run: healthCheckStream, // starts on entry, cancels on exit
      on: {
        // Stay in the current state, only update context.
        Ping: (ctx) => ({ update: { lastPingAt: ctx.lastPingAt + 1 } }),
        Disconnect: () => ({ goto: Disconnected.make() }),
      },
    },
  },

  // Global handlers run in any state.
  global: {
    Disconnect: () => ({ goto: Disconnected.make() }),
  },
});

// =============================================================================
// 5. Interpret and use
// =============================================================================

// `interpret()` returns an Effect that requires the machine's R services.
// With no dependencies, run it synchronously.
const actor = Effect.runSync(connectionMachine.interpret());

actor.subscribe((snap) => {
  console.log(`State: ${snap.state._tag}, retries: ${snap.context.retryCount}`);
});

actor.send(Connect.make({ uri: "ws://localhost:3000" }));
actor.send(ConnectSuccess.make());
// Health checks now run automatically until the state changes.

actor.send(Disconnect.make()); // health-check stream is cancelled on exit
actor.stop(); // stop the actor and clean up all resources
```

### Transitions

Event handlers return a transition describing what should happen:

```typescript
{ goto: NewState.make() }                        // move to a new state
{ goto: NewState.make(), update: { count: 0 } }  // move + update context
{ update: { count: ctx.count + 1 } }             // stay, update context
{ actions: [() => console.log("clicked")] }      // stay, run side-effect actions
null                                             // stay, no changes (acts as a guard)
```

### Effects, dependencies, and errors

`entry`, `exit`, and `run` are Effects/Streams, so they can require services and fail. Provide the services when you interpret the machine, and pass `onError` to observe failures:

```typescript
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const actor = yield* machine.interpret({
    snapshot: savedSnapshot, // optional: restore from a saved snapshot
    onError: (error) => {
      // error.effectType: "entry" | "exit" | "run"
      console.error(error.effectType, error.stateTag, error.cause);
    },
    interruptEntryOnTransition: false, // default: entry effects run to completion
  });

  actor.send(SomeEvent.make());
});

// Provide the R services the entry/exit/run effects require, then run.
Effect.runPromise(program.pipe(Effect.provide(SomeService.Default)));
```

## React Integration

```bash
npm install @handfish/effstate-react @handfish/effstate-v4 effect react
```

`useActor` creates and manages the actor for a machine definition, re-rendering on every snapshot change:

```tsx
import { State, Event, defineMachine, type StateType, type EventType } from "@handfish/effstate-v4";
import { useActor } from "@handfish/effstate-react";
import { Schema } from "effect";

const Idle = State("Idle", {});
const Running = State("Running", {});
type CounterState = StateType<typeof Idle> | StateType<typeof Running>;

const Start = Event("Start", {});
const Stop = Event("Stop", {});
const Tick = Event("Tick", {});
type CounterEvent = EventType<typeof Start> | EventType<typeof Stop> | EventType<typeof Tick>;

interface CounterContext {
  count: number;
}

const counterMachine = defineMachine<CounterState, CounterContext, CounterEvent>({
  initialState: Idle.make(),
  initialContext: { count: 0 },
  states: {
    Idle: {
      on: { Start: () => ({ goto: Running.make() }) },
    },
    Running: {
      on: {
        Stop: () => ({ goto: Idle.make() }),
        Tick: (ctx) => ({ update: { count: ctx.count + 1 } }),
      },
    },
  },
});

function Counter() {
  const { state, context, send } = useActor(counterMachine);

  return (
    <div>
      <p>State: {state._tag} — Count: {context.count}</p>
      {Idle.is(state) ? (
        <button onClick={() => send(Start.make())}>Start</button>
      ) : (
        <>
          <button onClick={() => send(Tick.make())}>Tick</button>
          <button onClick={() => send(Stop.make())}>Stop</button>
        </>
      )}
    </div>
  );
}
```

### Hooks

| Hook | Purpose |
|------|---------|
| `useActor(definition, options?)` | Create and manage an actor; returns `{ state, context, stateTag, send, actor, snapshot }` |
| `useActorEffect(actor, effect, deps?)` | Run a side effect whenever the snapshot changes |
| `useActorWatch(actor, selector, onChange, deps?)` | Fire a callback when a derived value changes |
| `useActorSync(actor, externalSnapshot, options)` | Sync with an external source (persistence, cross-tab sync) |
| `useActorBridge(source, target, selector, toEvent, deps?)` | Send events to a target actor when a source actor changes |

See the [`@handfish/effstate-react` README](./packages/effstate-react/README.md) for full hook signatures.

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

# Run a demo app
pnpm --filter demo-dexie-v4 dev

# Run the docs site
pnpm --filter docs dev
```

## Project Structure

```
.
├── packages/
│   ├── effstate-v4/       # @handfish/effstate-v4 - core state machine library
│   └── effstate-react/    # @handfish/effstate-react - React integration
├── apps/
│   ├── demo-dexie-v4/     # v4 demo with Dexie persistence & cross-tab sync
│   ├── demo-convex-order-v4/ # v4 demo backed by Convex
│   └── docs/              # Astro Starlight documentation site
└── assets/                # Shared assets (logo, etc.)
```

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting a PR.

## License

MIT
