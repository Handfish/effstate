# Entry Effect Lifecycle

This document explains how EffState v4 handles entry effects during state transitions and how to configure the behavior for your use case.

## The Problem

When a state machine transitions rapidly (A → B → C), what should happen to state B's entry effect if it hasn't finished yet?

```
Timeline:
  A ──entry──> B ──entry──> C
       │            │
       └── What happens to B's entry if we leave before it completes?
```

There are two valid approaches, and the right choice depends on your use case.

## Configuration

```typescript
const actor = Effect.runSync(
  machine.interpret({
    interruptEntryOnTransition: false, // default
  })
);
```

### `interruptEntryOnTransition: false` (Default)

Entry effects **run to completion** even if the machine transitions away.

**Best for:**
- UI animations that need cleanup
- Setup logic that must complete (registering handlers, initializing state)
- SDK operations that shouldn't be half-done

**Example problem it solves:**
```typescript
// Animation entry effect
entry: () => Effect.gen(function* () {
  yield* Effect.sync(() => element.classList.add('entering'));
  yield* Effect.sleep('300ms');
  yield* Effect.sync(() => element.classList.remove('entering'));
})

// With interruption: classList.remove() never runs → stuck UI!
// Without interruption: Animation completes cleanly ✓
```

### `interruptEntryOnTransition: true`

Entry effects are **interrupted** when transitioning away.

**Best for:**
- Expensive operations that shouldn't continue for abandoned states
- Entry effects that check current state (would be stale anyway)
- Resource-constrained environments

**Example use case:**
```typescript
// Expensive data fetch
entry: () => Effect.gen(function* () {
  const data = yield* fetchLargeDataset(); // expensive!
  yield* processData(data);
})

// If user navigated away, why continue fetching?
```

## Important Notes

### Entry effects are ALWAYS interrupted on `stop()`

Regardless of the `interruptEntryOnTransition` setting, calling `actor.stop()` will interrupt any running entry effect. The machine is shutting down, so all fibers must be cleaned up.

```typescript
// This always interrupts entry effects
actor.stop();
```

### Exit effects are always fire-and-forget

Exit effects run to completion and are never interrupted (except by `stop()`). They represent cleanup for the state you're leaving.

### Run streams are always interrupted on transition

The `run` stream for a state is always interrupted when leaving that state. The new state's stream only starts after the old one is fully interrupted.

## Recommended Patterns

### For animations: Use `acquireRelease`

This guarantees cleanup even on interruption (including `stop()`):

```typescript
entry: () => Effect.acquireRelease(
  // Acquire: runs first
  Effect.sync(() => {
    element.classList.add('entering');
    return element;
  }),
  // Release: always runs, even on interrupt
  (el) => Effect.sync(() => el.classList.remove('entering'))
)
```

### For setup/teardown: Use `acquireRelease`

```typescript
entry: () => Effect.acquireRelease(
  // Setup
  Effect.sync(() => {
    const handler = (e) => console.log(e);
    window.addEventListener('resize', handler);
    return handler;
  }),
  // Teardown (always runs)
  (handler) => Effect.sync(() => {
    window.removeEventListener('resize', handler);
  })
)
```

### For SDK connections: Keep default

```typescript
entry: (snap) => Effect.gen(function* () {
  const sdk = yield* MySDK;
  yield* sdk.connect(snap.state.uri);
  yield* sdk.subscribe();
})

// Default (no interruption) ensures connection completes
// before any disconnect/reconnect logic runs
```

## Summary

| Scenario | Recommended Setting |
|----------|---------------------|
| UI animations | `false` (default) |
| SDK/API connections | `false` (default) |
| Setup that must complete | `false` (default) |
| Expensive abandoned work | `true` |
| Resource-constrained | `true` |

When in doubt, use the default (`false`) and wrap critical setup/teardown in `Effect.acquireRelease`.
