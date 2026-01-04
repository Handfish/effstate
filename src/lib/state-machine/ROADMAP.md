# State Machine Library - Feature Roadmap

## Overview

This document tracks the implementation of XState-inspired actions for our Effect-based state machine library. Each feature includes implementation details, test requirements, and Effect-idiomatic approaches.

---

## Progress Summary

| Feature | Implementation | Tests | Notes |
|---------|---------------|-------|-------|
| `cancel` | [x] | [x] | Cancel delayed events by ID |
| `emit` | [x] | [x] | Emit to external listeners |
| `enqueueActions` | [x] | [x] | Dynamic action queuing |
| `sendTo` | [ ] | [ ] | Send to another actor |
| `sendParent` | [ ] | [ ] | Send to parent actor |
| `forwardTo` | [ ] | [ ] | Forward event to another actor |
| `spawnChild` | [ ] | [ ] | Spawn child actor |
| `stopChild` | [ ] | [ ] | Stop child actor |

---

## Feature Details

### 1. `cancel` - Cancel Delayed Events

**Purpose**: Cancel a pending delayed event (from `after` or delayed `raise`) by its ID.

**XState Behavior**:
```ts
// Schedule a delayed event with an ID
sendTo('actor', { type: 'ping' }, { id: 'myDelay', delay: 1000 })

// Cancel it before it fires
cancel('myDelay')
```

**Implementation Plan**:

1. **Add delay ID tracking**
   - Modify `handleAfterTransition` to accept optional `id` parameter
   - Store scheduled delays in a `Map<string, Fiber>` ref
   - When delay fires, remove from map

2. **Create `cancel` action**
   ```ts
   // actions.ts
   export function cancel<TContext, TEvent>(
     sendId: string | ((params: { context: TContext; event: TEvent }) => string)
   ): CancelAction<TContext, TEvent>
   ```

3. **Handle cancel in interpreter**
   - Look up fiber by ID in delays map
   - Call `Fiber.interrupt` on the fiber
   - Remove from map

**Types to add** (`types.ts`):
```ts
export interface CancelAction<TContext, TEvent> {
  readonly _tag: "cancel";
  readonly sendId: string | ((params: { context: TContext; event: TEvent }) => string);
}
```

**Tests required**:
- [x] Cancel prevents delayed transition from firing
- [x] Cancel with dynamic ID (function)
- [x] Cancel non-existent ID is a no-op
- [x] Multiple delays with different IDs, cancel only one

---

### 2. `emit` - Emit to External Listeners

**Purpose**: Emit events to external handlers registered via `actor.on(eventType, handler)`.

**XState Behavior**:
```ts
// In machine
actions: emit({ type: 'notification', message: 'Hello' })

// External listener
actor.on('notification', (event) => console.log(event.message))
```

**Implementation Plan**:

1. **Add event emitter to MachineActor**
   ```ts
   interface MachineActor<...> {
     // existing...
     on: <T extends string>(
       eventType: T,
       handler: (event: Extract<TEmitted, { type: T }>) => void
     ) => () => void; // returns unsubscribe
   }
   ```

2. **Track listeners in interpreter**
   - Use `Ref<Map<string, Set<(event: any) => void>>>`
   - `on()` adds to set, returns function to remove

3. **Create `emit` action**
   ```ts
   export function emit<TEmitted extends { type: string }>(
     event: TEmitted | ((params: { context: TContext; event: TEvent }) => TEmitted)
   ): EmitAction<TContext, TEvent, TEmitted>
   ```

4. **Handle emit in action runner**
   - Look up listeners for event type
   - Call each listener with the event

**Types to add**:
```ts
export interface EmitAction<TContext, TEvent, TEmitted> {
  readonly _tag: "emit";
  readonly event: TEmitted | ((params: { context: TContext; event: TEvent }) => TEmitted);
}

// Update MachineConfig to declare emitted event types
export interface MachineConfig<...TEmitted extends { type: string }> {
  // ...
}
```

**Tests required**:
- [x] Emit calls registered listener
- [x] Multiple listeners for same event type
- [x] Unsubscribe removes listener
- [x] Emit with dynamic event (function)
- [x] No listeners is a no-op

---

### 3. `enqueueActions` - Dynamic Action Queuing

**Purpose**: Dynamically queue actions at runtime based on conditions, with access to guards.

**XState Behavior**:
```ts
actions: enqueueActions(({ enqueue, check }) => {
  enqueue.assign({ count: 0 });

  if (check('someGuard')) {
    enqueue.assign({ count: 1 });
  }

  enqueue.raise({ type: 'DONE' });
})
```

**Implementation Plan**:

1. **Create enqueue action type**
   ```ts
   export interface EnqueueActionsAction<TContext, TEvent, R, E> {
     readonly _tag: "enqueueActions";
     readonly collect: (params: EnqueueParams<TContext, TEvent, R, E>) => void;
   }

   interface EnqueueParams<TContext, TEvent, R, E> {
     context: TContext;
     event: TEvent;
     enqueue: ActionEnqueuer<TContext, TEvent, R, E>;
     check: (guard: Guard<TContext, TEvent, R, E>) => Effect.Effect<boolean, E, R>;
   }

   interface ActionEnqueuer<TContext, TEvent, R, E> {
     (action: Action<TContext, TEvent, R, E>): void;
     assign: typeof assign;
     raise: typeof raise;
     effect: typeof effect;
     // ... other actions
   }
   ```

2. **Handle in action runner**
   - Create empty actions array
   - Create enqueuer that pushes to array
   - Call collect function
   - Execute collected actions in order

**Effect-idiomatic approach**:
Consider if this is needed - Effect's `Effect.gen` already provides dynamic control flow:
```ts
effect(({ context, event }) => Effect.gen(function* () {
  yield* someAction;
  if (someCondition) {
    yield* anotherAction;
  }
}))
```

**Tests required**:
- [x] Enqueue multiple actions
- [x] Conditional enqueueing based on context
- [x] Enqueue.assign, enqueue.raise, enqueue.effect shorthands
- [x] Actions execute in order
- [x] Access event data in enqueueActions

---

### 4-6. Actor Communication: `sendTo`, `sendParent`, `forwardTo`

**Purpose**: Send events between actors in a hierarchy.

**XState Behavior**:
```ts
// Send to specific actor
sendTo('childActor', { type: 'PING' })

// Send to parent
sendParent({ type: 'DONE', result: 42 })

// Forward current event
forwardTo('childActor')
```

**Implementation Plan**:

These require the actor hierarchy system (spawnChild/stopChild) to be meaningful. Implement together.

1. **Track actor references**
   - Parent reference: `_parent?: MachineActor`
   - Children map: `children: Map<string, MachineActor>`

2. **Create actions**
   ```ts
   export function sendTo<TTargetEvent>(
     target: string | ActorRef,
     event: TTargetEvent | ((params) => TTargetEvent),
     options?: { id?: string; delay?: number }
   ): SendToAction

   export function sendParent<TParentEvent>(
     event: TParentEvent | ((params) => TParentEvent)
   ): SendParentAction

   export function forwardTo(
     target: string | ActorRef
   ): ForwardToAction
   ```

3. **Handle in action runner**
   - Look up target actor
   - Call `target.send(event)`

**Effect-idiomatic consideration**:
Effect has its own actor model with `Effect.fork` and fibers. Consider whether to:
- A) Build XState-style actor hierarchy
- B) Integrate with Effect's native actor model
- C) Skip and rely on Effect's patterns

**Tests required**:
- [ ] sendTo delivers event to child actor
- [ ] sendTo with delay schedules event
- [ ] sendParent delivers to parent
- [ ] forwardTo passes current event unchanged
- [ ] sendTo non-existent actor throws/warns

---

### 7-8. Actor Lifecycle: `spawnChild`, `stopChild`

**Purpose**: Dynamically create and destroy child actors.

**XState Behavior**:
```ts
// Spawn
entry: spawnChild('childMachine', { id: 'myChild', input: { foo: 'bar' } })

// Stop
exit: stopChild('myChild')
```

**Implementation Plan**:

1. **Extend MachineActor interface**
   ```ts
   interface MachineActor<...> {
     // existing...
     children: ReadonlyMap<string, MachineActor<any, any, any>>;
     _parent?: MachineActor<any, any, any>;
   }
   ```

2. **Create spawn action**
   ```ts
   export function spawnChild<TChildMachine>(
     src: TChildMachine | string,
     options?: {
       id?: string | ((params) => string);
       input?: unknown;
       syncSnapshot?: boolean;
     }
   ): SpawnChildAction
   ```

3. **Create stop action**
   ```ts
   export function stopChild(
     childId: string | ((params) => string)
   ): StopChildAction
   ```

4. **Handle in interpreter**
   - Spawn: Create child actor, add to children map, start it
   - Stop: Look up child, call cleanup/scope finalizer, remove from map

5. **Automatic cleanup**
   - When parent scope closes, stop all children
   - Use Effect's `Scope` for automatic cleanup

**Types to add**:
```ts
export interface SpawnChildAction<TContext, TEvent> {
  readonly _tag: "spawnChild";
  readonly src: MachineDefinition<any, any, any, any, any> | string;
  readonly id?: string | ((params: { context: TContext; event: TEvent }) => string);
  readonly input?: unknown;
}

export interface StopChildAction<TContext, TEvent> {
  readonly _tag: "stopChild";
  readonly childId: string | ((params: { context: TContext; event: TEvent }) => string);
}
```

**Tests required**:
- [ ] spawnChild creates running child actor
- [ ] spawnChild with dynamic ID
- [ ] spawnChild with input
- [ ] stopChild stops the child
- [ ] Parent stopping stops all children
- [ ] Child can sendParent to parent

---

## Implementation Order

Recommended order based on dependencies:

1. **`cancel`** - Standalone, extends existing delay system
2. **`emit`** - Standalone, adds event emitter pattern
3. **`spawnChild` + `stopChild`** - Actor hierarchy foundation
4. **`sendTo` + `sendParent` + `forwardTo`** - Requires actor hierarchy
5. **`enqueueActions`** - Nice-to-have, Effect patterns may suffice

---

## Effect-Idiomatic Considerations

Some features may be redundant given Effect's capabilities:

| Feature | Effect Alternative |
|---------|-------------------|
| `enqueueActions` | `Effect.gen` with conditionals inside `effect()` |
| Actor hierarchy | `Effect.fork`, `Fiber`, `Scope` |
| `emit` | `SubscriptionRef`, `PubSub` |
| `cancel` | `Fiber.interrupt` |

**Decision needed**: Full XState compatibility vs. Effect-native patterns?

---

## Files to Modify

- `types.ts` - Add new action types, extend MachineActor
- `actions.ts` - Add action creators
- `machine.ts` - Handle new actions in interpreter
- `index.ts` - Export new actions
- `machine.test.ts` - Add comprehensive tests

---

## Prompt for Continuing

When resuming this work, use this prompt:

```
Continue implementing the state machine library roadmap from ROADMAP.md.
Current status: [CHECK PROGRESS SUMMARY ABOVE]
Next feature to implement: [FIRST UNCHECKED ITEM]

The library is at: src/lib/state-machine/
Key files:
- types.ts - Type definitions
- actions.ts - Action creators
- machine.ts - Interpreter
- machine.test.ts - Tests

Follow the implementation plan in ROADMAP.md for the next feature.
Write tests first (TDD), then implement.

Remember EffectTS is first-class in this library. Do everything to best DX for developers using Effect and @effect-atom.
```
