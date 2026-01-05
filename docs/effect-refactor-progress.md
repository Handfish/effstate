# Effect-Native Refactor Progress

## Current Status: Phase 1 Complete ✅

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

## Phase 2: Scoped Interpretation (Mostly Complete)

### Tasks
- [x] Rename `interpret` -> `interpretSync` (done in Phase 1)
- [x] Create new `interpret` returning `Effect<MachineActor, never, R | Scope.Scope>` (done in Phase 1)
- [x] Update `interpret` to use `Effect.addFinalizer` for cleanup (done in Phase 1)
- [x] Update all internal usages (done in Phase 1)
- [x] Update tests to use `interpretSync` (done in Phase 1)
- [ ] Update React integration (`atom.ts`) to use `interpretSync`
- [ ] Add migration guide to docs

### Files to Modify
- [x] `src/lib/state-machine/machine.ts` - Done
- [x] `src/lib/state-machine/index.ts` - Done
- [ ] `src/lib/state-machine/atom.ts` - Use interpretSync for React
- [x] `src/lib/state-machine/machine.test.ts` - Done

### Blockers
- None (Phase 1 completed)

---

## Phase 3: R Propagation & Type Safety

### Tasks
- [ ] Design R inference from machine config
- [ ] Implement R collection from actions/activities
- [ ] Enforce R at interpret call site
- [ ] Add compile-time tests for missing services
- [ ] Document service provision patterns

### Files to Modify
- `src/lib/state-machine/types.ts` - R inference types
- `src/lib/state-machine/machine.ts` - R enforcement

### Blockers
- Phase 1 & 2 should complete first

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

| Metric | Pre-Refactor | Phase 1 | Phase 2 | Phase 3 |
|--------|--------------|---------|---------|---------|
| createMachine | 49x faster | 38x faster | - | - |
| send 1000 events | 30x faster | 30x faster | - | - |
| with subscribers | 16x faster | 15x faster | - | - |
| full lifecycle | 2.5x faster | 2.3x faster | - | - |
| interpret/createActor | - | XState 1.2x faster* | - | - |
| Bundle (min) | 13.7kB | TBD | - | - |
| Bundle (gzip) | 5.4kB | TBD | - | - |

*Note: `interpret` now captures Effect runtime, adding slight overhead. `interpretSync` matches original performance.

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
