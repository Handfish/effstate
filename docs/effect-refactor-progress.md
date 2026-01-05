# Effect-Native Refactor Progress

## Current Status: Planning Complete

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

## Phase 1: Services in Actions

### Tasks
- [ ] Design R propagation through machine config
- [ ] Update `effect()` action to properly type R
- [ ] Update `interpret` to return `Effect<MachineActor, never, R>`
- [ ] Thread R through effect action execution
- [ ] Thread R through activity execution
- [ ] Add tests for service injection
- [ ] Benchmark performance impact

### Files to Modify
- `src/lib/state-machine/types.ts` - Update action types for R
- `src/lib/state-machine/actions.ts` - Update effect() creator
- `src/lib/state-machine/machine.ts` - Update interpret, effect execution
- `src/lib/state-machine/machine.test.ts` - Add service injection tests

### Blockers
- None

---

## Phase 2: Scoped Interpretation

### Tasks
- [ ] Rename `interpret` -> `interpretSync`
- [ ] Rename `interpretEffect` -> `interpret`
- [ ] Update `interpret` to use `Effect.acquireRelease`
- [ ] Update all internal usages
- [ ] Update tests
- [ ] Update React integration (`atom.ts`)
- [ ] Add migration guide to docs

### Files to Modify
- `src/lib/state-machine/machine.ts` - Rename functions
- `src/lib/state-machine/index.ts` - Update exports
- `src/lib/state-machine/atom.ts` - Use interpretSync for React
- `src/lib/state-machine/machine.test.ts` - Update all tests

### Blockers
- Phase 1 should complete first (interpret needs R parameter)

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
| createMachine | 49x faster | - | - | - |
| send 1000 events | 30x faster | - | - | - |
| with subscribers | 16x faster | - | - | - |
| full lifecycle | 2.5x faster | - | - | - |
| Bundle (min) | 13.7kB | - | - | - |
| Bundle (gzip) | 5.4kB | - | - | - |

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
