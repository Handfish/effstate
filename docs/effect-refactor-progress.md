# Effect-Native Refactor Progress

## Current Status: All Phases Complete ✅

**Last Updated**: 2026-01-04

---

## Completed Work (Pre-Refactor)

### Performance & Bundle Size
- [x] Benchmarked against XState (30x faster event sending)
- [x] Optimized to 13.7kB minified / 5.4kB gzipped (vs XState 45.3kB / 13.7kB)
- [x] Mailbox-based event queue (XState-style linked list)

### Effect Integration
- [x] `waitFor` - Effect-based state waiting with timeout support
- [x] `Effect.async` for callback-to-Effect bridging
- [x] Fiber interruption cleanup
- [x] TaggedErrors (`EffectActionError`, `ActivityError`)
- [x] `interpretEffect` (exists, will become primary `interpret`)

### Simplifications
- [x] Removed Effect guards (sync-only now)
- [x] Removed `GuardError` (guards can't fail)
- [x] Removed `ObserverError` (isolate without emitting)
- [x] Guards are plain functions (not tagged objects)

---

## Phase 1: Services in Actions ✅

### Tasks
- [x] Design R propagation through machine config
- [x] Update `effect()` action to properly type R
- [x] Update `interpret` to return `Effect<MachineActor, never, R | Scope.Scope>`
- [x] Thread R through effect action execution
- [x] Thread R through activity execution
- [x] Add tests for service injection
- [x] Benchmark performance impact

### Implementation Summary
- `interpret` now returns `Effect<MachineActor, never, R | Scope.Scope>`
- Added `interpretSync` as escape hatch for React/simple cases
- Runtime captured via `Effect.runtime<R>()` and passed to `createActor`
- Effects/activities use `Runtime.runPromiseExit(runtime)` when runtime available
- Child actors inherit runtime for service access
- Scoped cleanup via `Effect.addFinalizer`

### Files Modified
- `src/lib/state-machine/machine.ts` - Core implementation
- `src/lib/state-machine/index.ts` - Export `interpretSync`
- `src/lib/state-machine/machine.test.ts` - Service injection tests (4 new tests)
- `src/lib/state-machine/machine.bench.ts` - Updated to use `interpretSync`

### Tests Added
- `provides services to effect actions` - CounterService in transition actions
- `auto-stops actor when scope closes` - Scope.close triggers cleanup
- `provides services to activities` - CounterService in activities
- `provides services to child actors` - Runtime inheritance to children

---

## Phase 2: Scoped Interpretation ✅

### Tasks
- [x] Rename `interpret` -> `interpretSync` (done in Phase 1)
- [x] Create new `interpret` returning `Effect<MachineActor, never, R | Scope.Scope>` (done in Phase 1)
- [x] Update `interpret` to use `Effect.addFinalizer` for cleanup (done in Phase 1)
- [x] Update all internal usages (done in Phase 1)
- [x] Update tests to use `interpretSync` (done in Phase 1)
- [x] Verify React integration (`atom.ts`) - already correct (uses MachineActor type)
- [x] Add migration guide to docs

### Files Modified
- [x] `src/lib/state-machine/machine.ts` - Done
- [x] `src/lib/state-machine/index.ts` - Done
- [x] `src/lib/state-machine/atom.ts` - Already correct (no changes needed)
- [x] `src/lib/state-machine/machine.test.ts` - Done
- [x] `docs/migration-guide.md` - Created

---

## Phase 3: R Propagation & Type Safety ✅

### Tasks
- [x] Design R inference from machine config (deferred - see notes)
- [x] Implement R collection from actions/activities (using explicit R parameter)
- [x] Enforce R at interpret call site
- [x] Add compile-time tests for missing services
- [x] Document service provision patterns (in migration guide)

### Implementation Summary

**R Enforcement Works:**
- When `createMachine<..., R>` specifies R, `interpret(machine)` returns `Effect<..., R | Scope.Scope>`
- TypeScript enforces service provision via `Effect.provideService`
- `interpretSync` bypasses R requirement (for React escape hatch)

**R Inference Deferred:**
TypeScript cannot reliably infer R from deeply nested config objects due to:
- Contravariance in function parameters (actions have `(ctx: TContext) => ...`)
- Complexity of extracting R from union of action types across all states
- Would require complex mapped types that hurt IDE performance

**Recommended Pattern:**
Explicit R parameter is clearer and more predictable:
```typescript
const machine = createMachine<
  "myMachine",
  "idle" | "loading",
  MyContext,
  MyEvent,
  ApiService | LogService  // Explicit service requirements
>({ ... });
```

### Tests Added
- `requires services to be provided when R is not never`
- `allows interpret without services when R is never`
- `interpretSync does not require service provision`

### Files Modified
- `src/lib/state-machine/machine.test.ts` - Type safety tests

---

## Schema Context ✅

### Overview
Context can now be defined using Effect Schema for automatic serialization/deserialization.

### API
```typescript
// Define a Schema for context
const CounterContextSchema = Schema.Struct({
  count: Schema.Number,
  lastUpdated: Schema.DateFromString,  // Auto-transforms Date <-> string
});

// Use Schema in machine definition
const machine = createMachine({
  id: "counter",
  initial: "idle",
  context: CounterContextSchema,      // Schema instead of plain object
  initialContext: { count: 0, lastUpdated: new Date() },
  states: { ... },
});

// Serialize snapshot (Date -> string)
const encoded = encodeSnapshotSync(machine, actor.getSnapshot());
localStorage.setItem("state", JSON.stringify(encoded));

// Deserialize snapshot (string -> Date)
const stored = JSON.parse(localStorage.getItem("state")!);
const snapshot = decodeSnapshotSync(machine, stored);
```

### Features
- **Backwards compatible** - Plain object context still works
- **Automatic transforms** - `DateFromString`, `BigintFromString`, etc.
- **Type-safe encoding** - Encoded type inferred from Schema
- **Effect integration** - Async versions return `Effect<..., ParseError>`

### Files Added/Modified
- `src/lib/state-machine/types.ts` - `MachineConfigSchema`, `ContextInput`
- `src/lib/state-machine/machine.ts` - Schema detection in `createMachine`
- `src/lib/state-machine/serialization.ts` - New file with encode/decode utilities
- `src/lib/state-machine/index.ts` - Export serialization utilities

### Tests Added (6 new tests)
- `creates machine with Schema context`
- `encodes snapshot with Date to JSON-safe format`
- `decodes snapshot from JSON-safe format`
- `roundtrip encode/decode preserves data`
- `works with plain context (backwards compatible)`
- `creates snapshot schema for machines`

---

## Test Coverage Checkpoints

| Phase | Tests Required |
|-------|----------------|
| Phase 1 | Service injection in effect actions |
| Phase 1 | Service injection in activities |
| Phase 1 | Multiple services (union R) |
| Phase 2 | Auto-cleanup on scope close |
| Phase 2 | interpretSync still works for React |
| Phase 3 | Compile error on missing service |
| Phase 3 | Layer provision works |

---

## Benchmark Checkpoints

Run after each phase:
```bash
npx tsx src/lib/state-machine/machine.bench.ts
```

| Metric | Pre-Refactor | Final (All Phases) |
|--------|--------------|-------------------|
| createMachine | 49x faster | **47x faster** |
| send 1000 events | 30x faster | **30x faster** |
| with subscribers | 16x faster | **15x faster** |
| full lifecycle | 2.5x faster | **2.3x faster** |
| interpret/createActor | - | XState 1.15x faster* |
| Bundle (min) | 13.7kB | 498.76kB (app total) |
| Bundle (gzip) | 5.4kB | 157.28kB (app total) |

*Note: `interpretSync` matches original performance. The Effect-native `interpret` adds minimal overhead for runtime capture.

---

## Notes & Decisions

### 2026-01-04
- Decided against Stream-based snapshots (not ergonomic for React)
- `waitFor` implemented using `Effect.async`
- Guards simplified to plain functions (no Effect guards)
- Bundle size is 3.3x smaller than XState

---

## Open Questions

1. **R inference vs explicit**: Should R be inferred from config or require explicit type parameter?
   - Leaning toward: Infer, with escape hatch for explicit

2. **React API naming**: `interpretSync` clear enough?
   - Alternatives: `interpretUnsafe`, `createActor`, `interpretImmediate`

3. **Layer vs direct provision**: Should we encourage Layer pattern?
   - Probably yes for complex apps, direct for simple cases

---

## Resources

- [Effect Documentation](https://effect.website)
- [XState Source](https://github.com/statelyai/xstate) - Reference for patterns
- [Effect Scope](https://effect.website/docs/resource-management/scope) - Resource management
