# Effect-Native State Machine Refactor Plan

## Problem Statement

Currently our state machine library is "XState but faster." While performant, it doesn't leverage Effect's core strengths:

- **Dependency Injection**: Can't use `yield* MyService` inside actions
- **Resource Management**: Manual `actor.stop()` instead of automatic scope cleanup
- **Type Safety**: R (requirements) type parameter exists but isn't properly propagated

## Goals

1. **Services in Actions** - Use Effect's DI inside state machine actions
2. **Scoped Interpretation** - Auto-cleanup when Effect scope closes
3. **R Propagation** - Full type safety for Effect requirements

---

## Phase 1: Services in Actions

### Current State
```typescript
effect(({ context }) =>
  Effect.gen(function* () {
    // Can't do this - no way to provide ApiService
    const api = yield* ApiService
    yield* api.fetch(context.id)
  })
)
```

### Target State
```typescript
const machine = createMachine<...>()({
  // ... config with effects that use services
})

// Provide services at interpretation time
const actor = yield* interpret(machine).pipe(
  Effect.provideService(ApiService, liveApi)
)
```

### Implementation Steps

1. **Update `interpret` signature**
   ```typescript
   // From:
   interpret(machine): MachineActor

   // To:
   interpret(machine): Effect<MachineActor, never, R>
   ```

2. **Thread R through effect execution**
   - Effect actions already return `Effect<void, E, R>`
   - Need to capture R and require it at interpret time
   - Use `Effect.provideService` or `Effect.provide` with Layer

3. **Update activity execution**
   - Activities also return `Effect<void, E, R>`
   - Same R propagation needed

### Open Questions
- Should R be inferred from machine config or explicit?
- How to handle multiple services (union of R)?
- Performance impact of Effect.provide on hot path?

---

## Phase 2: Scoped Interpretation (Primary API)

### Current State
```typescript
const actor = interpret(machine)
// ... use actor
actor.stop() // Manual cleanup, easy to forget
```

### Target State
```typescript
const program = Effect.gen(function* () {
  const actor = yield* interpret(machine)
  // ... use actor
}) // Auto-stops when scope closes

Effect.runPromise(Effect.scoped(program))
```

### Implementation Steps

1. **Rename existing functions**
   ```typescript
   // Current interpretEffect -> interpret (primary)
   // Current interpret -> interpretSync (escape hatch)
   ```

2. **Update interpret to use acquireRelease**
   ```typescript
   export const interpret = <...>(machine) =>
     Effect.acquireRelease(
       Effect.sync(() => createActor(machine)),
       (actor) => Effect.sync(() => actor.stop())
     )
   ```

3. **Keep sync escape hatch for React**
   ```typescript
   // For React components that manage lifecycle themselves
   export const interpretSync = <...>(machine) => createActor(machine)
   ```

### Migration Path
- `interpret` -> `interpretSync` (for existing code)
- `interpretEffect` -> `interpret` (new primary API)
- Deprecation warnings in v1, remove in v2

---

## Phase 3: R Propagation & Type Safety

### Current State
```typescript
createMachine<TId, TState, TContext, TEvent, R, E>
// R exists but isn't enforced at interpret time
```

### Target State
```typescript
const machine = createMachine<...>()({
  states: {
    loading: {
      entry: [effect(() => ApiService.pipe(Effect.flatMap(api => api.fetch())))]
    }
  }
})
// Type: MachineDefinition<..., ApiService, ...>

// This errors - missing ApiService
interpret(machine) // Error: Effect<..., never, ApiService>

// This works
interpret(machine).pipe(Effect.provideService(ApiService, liveApi))
```

### Implementation Steps

1. **Infer R from config**
   - Collect R from all actions, activities, guards
   - Union type: `R1 | R2 | R3` -> single R

2. **Enforce at interpret**
   ```typescript
   interpret<..., R>(machine): Effect<MachineActor, never, R>
   ```

3. **Provide via Layer or direct**
   ```typescript
   // Direct
   interpret(machine).pipe(Effect.provideService(ApiService, liveApi))

   // Via Layer
   interpret(machine).pipe(Effect.provide(AppLayer))
   ```

---

## API Surface (Post-Refactor)

```typescript
// Primary API - Effect-native, scoped
const program = Effect.gen(function* () {
  const actor = yield* interpret(machine)
  actor.send(new MyEvent())
  const result = yield* actor.waitFor(s => s.value === "done")
})

Effect.runPromise(
  program.pipe(
    Effect.provide(AppLayer),
    Effect.scoped
  )
)

// React escape hatch - sync, manual cleanup
const actor = interpretSync(machine)
useEffect(() => () => actor.stop(), [])
```

---

## Non-Goals

- **Streams for snapshots** - Not ergonomic for React, adds overhead
- **Async guards** - Use state machine pattern instead (validate state -> event)
- **Full XState compatibility** - We're Effect-first, not XState-compatible

---

## Success Metrics

1. Can use `yield* MyService` inside effect actions
2. No manual `actor.stop()` needed in Effect code
3. TypeScript errors if services not provided
4. React usage remains simple and fast
5. Bundle size stays under 15kB minified

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking change for existing users | Keep `interpretSync` as escape hatch |
| Performance regression from Effect.provide | Benchmark before/after, optimize hot paths |
| Complexity in R inference | Start with explicit R, add inference later |
| React integration breaks | Maintain dedicated React API (`interpretSync` + hooks) |
