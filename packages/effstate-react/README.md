# effstate-react

React hooks for [effstate-v4](https://www.npmjs.com/package/effstate-v4) state machines.

## Installation

```bash
npm install effstate-react effstate-v4 effect react
```

## Quick Start

```tsx
import { State, Event, defineMachine } from "effstate-v4";
import { useActor } from "effstate-react";
import { Schema } from "effect";

// Define states
const Idle = State("Idle", {});
const Running = State("Running", { count: Schema.Number });

type MyState = StateType<typeof Idle> | StateType<typeof Running>;

// Define events
const Start = Event("Start", {});
const Stop = Event("Stop", {});
const Tick = Event("Tick", {});

type MyEvent = EventType<typeof Start> | EventType<typeof Stop> | EventType<typeof Tick>;

// Define machine
const counterMachine = defineMachine<MyState, {}, MyEvent>({
  initialState: Idle.make(),
  initialContext: {},
  states: {
    Idle: {
      on: {
        Start: () => ({ goto: Running.make({ count: 0 }) }),
      },
    },
    Running: {
      on: {
        Stop: () => ({ goto: Idle.make() }),
        Tick: (ctx, event, state) => ({
          goto: Running.make({ count: state.count + 1 })
        }),
      },
    },
  },
});

// Use in React
function Counter() {
  const { state, send } = useActor(counterMachine);

  return (
    <div>
      <p>State: {state._tag}</p>
      {Running.is(state) && <p>Count: {state.count}</p>}
      <button onClick={() => send(state._tag === "Idle" ? Start.make() : Tick.make())}>
        {state._tag === "Idle" ? "Start" : "Tick"}
      </button>
      {state._tag === "Running" && (
        <button onClick={() => send(Stop.make())}>Stop</button>
      )}
    </div>
  );
}
```

## API

### `useActor(definition, options?)`

Create and manage a machine actor.

```tsx
const { state, context, stateTag, send, actor, snapshot } = useActor(myMachine);
```

Returns:
- `state` - Current state object
- `context` - Current context
- `stateTag` - Current state's `_tag` for easy switch/match
- `send` - Function to send events
- `actor` - The underlying actor (for advanced use)
- `snapshot` - Combined state + context

### `useActorEffect(actor, effect, deps?)`

Run a side effect whenever the actor's snapshot changes.

```tsx
useActorEffect(actor, (snapshot) => {
  console.log("State changed to:", snapshot.state._tag);
});
```

### `useActorWatch(actor, selector, onChange, deps?)`

Watch a derived value and trigger callback when it changes.

```tsx
useActorWatch(
  actor,
  (snap) => snap.context.count,
  (count, prevCount) => {
    console.log(`Count: ${prevCount} → ${count}`);
  }
);
```

### `useActorSync(actor, externalSnapshot, options)`

Sync an actor with an external source (persistence, cross-tab sync).

```tsx
useActorSync(actor, savedState, {
  isLeader: isTabLeader,
  serialize: (snap) => JSON.stringify(snap),
  deserialize: (json) => JSON.parse(json),
  onSave: (json) => localStorage.setItem("state", json),
  saveDebounce: 100, // optional, default 100ms
});
```

### `useActorBridge(source, target, selector, toEvent, deps?)`

Bridge two actors - send events to target when source changes.

```tsx
// When hamster generates power, notify the garage door
useActorBridge(
  hamsterActor,
  garageDoorActor,
  (snap) => snap.context.power > 0,
  (hasPower) => hasPower ? PowerOn.make() : PowerOff.make()
);
```

## License

MIT
