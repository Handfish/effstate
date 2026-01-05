# Machine as Effect.Service Architecture

## Progress Summary

### Completed Steps

1. **Created `service.ts`** - Type utilities for extracting R, E, State, Context, Event from machine service tags
2. **Created `registry.ts`** - MachineRegistry Effect.Service for managing actor instances with spawn/get/stop operations
3. **Updated `types.ts`** - Added SpawnChildAction type for service-based spawning
4. **Updated `actions.ts`** - spawnChild now supports machine definitions (backwards compatible)
5. **Updated `machine.ts`** - Interpreter handles child spawning via registry when available
6. **Updated `index.ts`** - Exports new modules
7. **Migrated GarageDoorMachine** - Now has `GarageDoorMachineService` extending Effect.Service with `dependencies: [WeatherService.Default]`
8. **Migrated HamsterWheelMachine** - Now has `HamsterWheelMachineService` with `dependencies: [GarageDoorMachineService.Default]`
9. **Updated `app-runtime.ts`** - Added MachineRegistry to app layer
10. **Fixed build errors** - Application code compiles cleanly (test files have pre-existing errors)

### Architecture

```
Layer Dependency Chain:
========================
HamsterWheelMachineService.Default
    └── depends on: GarageDoorMachineService.Default
                        └── depends on: WeatherService.Default

Registry Pattern:
=================
MachineRegistry (Effect.Service)
    ├── spawn(machineService, instanceId, parentId?) → MachineActor
    ├── get(instanceId) → ActorInstance | undefined
    ├── getChildren(parentId) → ActorInstance[]
    ├── stop(instanceId) → void
    └── stopAll → void
```

---

## MemoMap Evaluation

### Background

Effect layers are memoized **by reference, not by tag**. If you construct a layer expression twice, you get two separate service instances:

```typescript
// These are TWO separate WeatherService instances
const layer1 = WeatherService.Default;
const layer2 = WeatherService.Default; // Same expression, different reference

const program = Effect.gen(function* () {
  const ws = yield* WeatherService;
  // ...
}).pipe(
  Effect.provide(layer1),
  Effect.provide(layer2), // Different instance!
);
```

**MemoMap** allows sharing layer instances across multiple runtimes by providing a shared memoization context:

```typescript
const memoMap = Layer.makeMemoMap();

const runtime1 = ManagedRuntime.make(AppLayer, memoMap);
const runtime2 = ManagedRuntime.make(AppLayer, memoMap); // Shares layers with runtime1
```

### Current Architecture Analysis

The current implementation uses a **single runtime** pattern:

```typescript
// app-runtime.ts
const AppLayer = Layer.mergeAll(ServicesLayer, MachineLayer);
export const appRuntime = Atom.runtime(AppLayer);

// hamster-wheel-operations.ts
const actorAtom = appRuntime.atom(interpret(HamsterWheelMachine)).pipe(Atom.keepAlive);
```

**Key observations:**

1. **Single runtime scope** - All atoms derive from `appRuntime`
2. **Natural memoization** - Within a single runtime, services are already shared
3. **MachineRegistry** - Already provides instance management for actors
4. **Layer composition** - Dependencies flow through `Effect.Service` dependencies

### Would MemoMap Be Helpful?

**For the current architecture: Not significantly**

The single `appRuntime` pattern already provides:
- Layer memoization within its scope
- Shared service instances for all atoms
- Consistent state across the application

**When MemoMap would add value:**

| Scenario | MemoMap Benefit |
|----------|-----------------|
| Multiple runtimes (e.g., per-route, per-feature) | Share services across runtimes |
| Micro-frontends / Plugin architecture | Share base services, isolate features |
| Testing with partial isolation | Share expensive services, mock others |
| Server-side rendering with client hydration | Share service state across environments |

### Recommendation

**Current State: No immediate need for MemoMap**

The architecture is sound with:
- Single `appRuntime` for natural memoization
- `MachineRegistry` for actor instance management
- `Effect.Service` dependencies for R channel composition

**Future Consideration: MemoMap for Testing**

If you want to:
1. Run tests with isolated atom state but shared services
2. Create feature-isolated contexts that share base services
3. Support multiple concurrent app instances (e.g., modal with different context)

Then consider using effect-atom's memoMap option:

```typescript
// Shared memoMap across test runs or isolated contexts
const sharedMemoMap = Layer.makeMemoMap();

// Testing: share services but isolate atom state
const testRuntime = Atom.runtime(AppLayer, { memoMap: sharedMemoMap });
```

### Alternative Pattern: Service-Based Actor Creation

Instead of using MemoMap, the current architecture could be enhanced with **service-based actor creation**:

```typescript
// Option A: Direct usage (current)
const actorAtom = appRuntime.atom(interpret(HamsterWheelMachine));

// Option B: Service-based (future enhancement)
const actorAtom = appRuntime.atom(
  Effect.gen(function* () {
    const service = yield* HamsterWheelMachineService;
    return yield* service.createActor();
  })
);
```

This keeps R channel composition explicit through the service layer without requiring MemoMap.

---

## Files Modified

| File | Changes |
|------|---------|
| `src/lib/state-machine/service.ts` | NEW - Type utilities for machine services |
| `src/lib/state-machine/registry.ts` | NEW - MachineRegistry Effect.Service |
| `src/lib/state-machine/types.ts` | Added SpawnChildAction with service support |
| `src/lib/state-machine/actions.ts` | Updated spawnChild for definition-based spawning |
| `src/lib/state-machine/machine.ts` | Interpreter handles service-based spawning |
| `src/lib/state-machine/index.ts` | Exports new modules |
| `src/data-access/garage-door-operations.ts` | Added GarageDoorMachineService |
| `src/data-access/hamster-wheel-operations.ts` | Added HamsterWheelMachineService |
| `src/lib/app-runtime.ts` | Added MachineRegistry to layer |

---

## Next Steps (Optional)

1. **Service-based actor creation** - Update atoms to use `service.createActor()` instead of direct `interpret()`
2. **Registry integration in interpreter** - Full integration when MachineRegistry is in scope
3. **Add MemoMap for testing** - If isolated test contexts are needed
4. **Type-safe child spawning** - Enhance `spawnChild` to accept service tags with full type inference
