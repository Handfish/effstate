# Advanced Demo: `interpretManual()`

> ⚠️ **WARNING: This demo shows an advanced pattern that is NOT RECOMMENDED for most applications.**

## What is this?

This demo demonstrates `interpretManual()`, an alternative to `interpret()` that provides slightly faster actor creation at the cost of **manual lifecycle management**.

## Should I use `interpretManual()`?

**Almost certainly not.**

| Question | If Yes | If No |
|----------|--------|-------|
| Are you creating thousands of actors per second? | Maybe consider it | Use `interpret()` |
| Have you profiled and confirmed actor creation is a bottleneck? | Maybe consider it | Use `interpret()` |
| Are you comfortable managing cleanup manually? | Maybe consider it | Use `interpret()` |
| Is the 1.6x speedup significant for your use case? | Maybe consider it | Use `interpret()` |

## Performance Comparison

| Metric | `interpret()` | `interpretManual()` |
|--------|--------------|---------------------|
| Actor creation speed | Baseline | ~1.6x faster |
| Cleanup | Automatic (via Scope) | **Manual** (you call `stop()`) |
| Memory leak risk | None | **High if you forget cleanup** |
| Code complexity | Simple | Complex |
| Recommended | ✅ Yes | ❌ No (usually) |

## The Problem with `interpretManual()`

```typescript
// With interpret() - cleanup is automatic
const actor = yield* interpret(machine);
// When Scope closes → finalizer runs → actor.stop() called automatically

// With interpretManual() - YOU must cleanup
const actor = Effect.runSync(interpretManual(machine));
// If you forget to call actor.stop(), the actor LEAKS:
// - Activities keep running forever
// - Timers keep firing
// - Memory is never freed
```

## Required Cleanup Pattern

If you DO use `interpretManual()`, you MUST handle cleanup:

```tsx
// In React:
useEffect(() => {
  const actor = Effect.runSync(interpretManual(machine));

  return () => {
    actor.stop(); // CRITICAL! Without this, you leak!
  };
}, []);
```

## Why does `interpretManual()` exist?

For rare cases where:
1. You're creating many short-lived actors
2. Actor creation overhead is a measured bottleneck
3. You're managing lifecycle manually anyway
4. The ~1.6x speedup matters for your use case

## Running This Demo

```bash
pnpm --filter demo-advanced dev
```

Watch the lifecycle log to see:
- When actors are created
- When cleanup happens (or doesn't!)
- What gets logged when you stop/restart

## Files in This Demo

- `src/data-access/manual-actor.ts` - The complex lifecycle management code
- `src/components/ManualLifecycleDemo.tsx` - UI showing the pattern
- `src/App.tsx` - Entry point with cleanup in useEffect

## Compare to the Main Demo

The main demo (`apps/demo`) uses `interpret()` with Effect-Atom for a much simpler pattern:

```typescript
// Main demo approach - simple and safe
const actorAtom = appRuntime
  .atom(interpret(machine))
  .pipe(Atom.keepAlive);

// That's it! No manual cleanup needed.
```

## Conclusion

**Use `interpret()` unless you have a very specific, measured need for `interpretManual()`.**

The complexity and risk of memory leaks almost never justifies the small performance gain.
