# effstate-v4

Lean, schema-first state machines for Effect.

## Features

- **Schema-first**: Define states and events with Effect Schema
- **Type-safe**: Full TypeScript inference, discriminated unions
- **Effect-native**: Entry/exit effects, run streams with R channel support
- **Auto-cleanup**: Run streams cancel automatically on state exit
- **Minimal**: ~500 lines of code, zero dependencies beyond Effect

## Installation

```bash
npm install effstate-v4 effect
```

## Quick Start

```typescript
import { State, Event, defineMachine, Effect, Stream, Schema } from "effstate-v4";
import { Duration, Schedule } from "effect";

// Define states (schema-first)
const Disconnected = State("Disconnected", {});
const Connecting = State("Connecting", { startedAt: Schema.DateFromSelf });
const Connected = State("Connected", { connectedAt: Schema.DateFromSelf });

type ConnectionState =
  | StateType<typeof Disconnected>
  | StateType<typeof Connecting>
  | StateType<typeof Connected>;

// Define events
const Connect = Event("Connect", { uri: Schema.String });
const ConnectSuccess = Event("ConnectSuccess", {});
const ConnectError = Event("ConnectError", { message: Schema.String });
const Ping = Event("Ping", {});

type ConnectionEvent =
  | EventType<typeof Connect>
  | EventType<typeof ConnectSuccess>
  | EventType<typeof ConnectError>
  | EventType<typeof Ping>;

// Define context
interface ConnectionContext {
  uri: string;
  lastPingAt: number;
}

// Health check stream (auto-cancels when leaving Connected state)
const healthCheckStream = Stream.fromSchedule(
  Schedule.spaced(Duration.seconds(5))
).pipe(Stream.map(() => Ping.make()));

// Define machine
const connectionMachine = defineMachine<ConnectionState, ConnectionContext, ConnectionEvent>({
  id: "connection",
  initialState: Disconnected.make(),
  initialContext: { uri: "", lastPingAt: 0 },

  states: {
    Disconnected: {
      on: {
        Connect: (_ctx, event) => ({
          goto: Connecting.make({ startedAt: new Date() }),
          update: { uri: event.uri },
        }),
      },
    },

    Connecting: {
      entry: (snap) => Effect.log(`Connecting to ${snap.context.uri}...`),
      on: {
        ConnectSuccess: () => ({
          goto: Connected.make({ connectedAt: new Date() }),
        }),
        ConnectError: () => ({
          goto: Disconnected.make(),
        }),
      },
    },

    Connected: {
      entry: () => Effect.log("Connected!"),
      exit: () => Effect.log("Disconnecting..."),
      run: healthCheckStream, // Auto-cancels on exit
      on: {
        Ping: () => ({
          update: { lastPingAt: Date.now() },
        }),
      },
    },
  },
});

// Use the machine
const actor = Effect.runSync(connectionMachine.interpret());

actor.subscribe((snap) => {
  console.log("State:", snap.state._tag);
});

actor.send(Connect.make({ uri: "ws://localhost:3000" }));
// Later...
actor.send(ConnectSuccess.make());
// Health checks start automatically
// When state changes, health check stream is cancelled
```

## API

### `State(tag, fields)`

Create a state definition with schema, constructor, and type guard.

```typescript
const Running = State("Running", { startedAt: Schema.DateFromSelf });

Running.make({ startedAt: new Date() }); // Create instance
Running.is(value); // Type guard
Running.schema; // Effect Schema
```

### `Event(tag, fields)`

Same as `State`, but semantically for events.

```typescript
const Click = Event("Click", {});
const SetValue = Event("SetValue", { value: Schema.Number });

actor.send(Click.make());
actor.send(SetValue.make({ value: 42 }));
```

### `defineMachine(config)`

Define a state machine.

```typescript
const machine = defineMachine<State, Context, Event>({
  id: "myMachine",
  initialState: Idle.make(),
  initialContext: { count: 0 },
  states: {
    Idle: {
      entry: (snap) => Effect.log("Entered Idle"),
      exit: (snap) => Effect.log("Exiting Idle"),
      on: {
        Start: () => ({ goto: Running.make() }),
      },
    },
    Running: {
      run: tickStream, // Stream<Event> - auto-cancels on exit
      on: {
        Stop: () => ({ goto: Idle.make() }),
        Tick: (ctx) => ({ update: { count: ctx.count + 1 } }),
      },
    },
  },
  global: {
    Reset: () => ({ goto: Idle.make(), update: { count: 0 } }),
  },
});
```

### Transitions

Event handlers return transitions:

```typescript
// Goto new state
{ goto: NewState.make() }

// Goto + update context
{ goto: NewState.make(), update: { count: 0 } }

// Stay, update context
{ update: { count: ctx.count + 1 } }

// Stay, run actions
{ actions: [() => console.log("clicked")] }

// Stay, no changes
null
```

### `machine.interpret(options?)`

Create an actor from a machine definition.

```typescript
const actor = Effect.runSync(machine.interpret({
  snapshot: savedSnapshot, // Optional: restore from saved state
  onError: (error) => {    // Optional: handle effect errors
    console.error(error.effectType, error.stateTag, error.cause);
  },
}));

actor.send(event);           // Send event
actor.getSnapshot();         // Get current state + context
actor.subscribe(callback);   // Subscribe to changes
actor.stop();                // Stop and cleanup
```

## License

MIT
