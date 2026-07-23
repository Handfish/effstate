# EffState v2 vs v3 (Lean) API Comparison

## Side-by-Side: Opening State Handler

### v2 (Current)
```typescript
Opening: {
  entry: ({ startedAt }) =>
    Effect.log(`Opening started at ${startedAt.toISOString()}`),

  run: tickStream(1),

  on: (ctx, _state, { goto, update, stay }) => (event) =>
    Match.value(event).pipe(
      Match.tag("Click", () =>
        ctx.isPowered
          ? goto(GarageDoorState.PausedWhileOpening({
              pausedAt: new Date(),
              pausedPosition: ctx.position,
            }))
          : stay
      ),
      Match.tag("Tick", ({ delta }) => {
        const newPosition = Math.min(100, ctx.position + delta);
        if (newPosition >= 100) {
          return goto(GarageDoorState.Open({ openedAt: new Date() }))
            .update({ position: 100, weather: { status: "loading" } });
        }
        return update({ position: newPosition, lastUpdated: new Date() });
      }),
      Match.tag("PowerOff", () =>
        goto(GarageDoorState.PausedWhileOpening({
          pausedAt: new Date(),
          pausedPosition: ctx.position,
        })).update({ isPowered: false })
      ),
      Match.tag("PowerOn", () => stay.update({ isPowered: true })),
      Match.tag("AnimationComplete", () => stay),
      Match.tag("BangHammer", () => stay.emit(new WakeHamster())),
      Match.orElse(() => stay),
    ),
},
```
**Lines: ~35**

---

### v3 (Lean)
```typescript
Opening: {
  entry: (state) => Effect.log(`Opening started at ${state.startedAt}`),

  run: tickStream(1),

  on: {
    Click: (ctx) => goto(DoorState.PausedOpening({ pausedAt: new Date() })),

    Tick: (ctx) => {
      const newPos = Math.min(100, ctx.position + 1);
      return newPos >= 100
        ? goto(DoorState.Open({ openedAt: new Date() }))
            .with({ position: 100, weather: { status: "loading" } })
        : update({ position: newPos });
    },

    PowerOff: () => goto(DoorState.PausedOpening({ pausedAt: new Date() })),
    // PowerOn, BangHammer: handled in global
    // Unhandled events: implicit stay
  },
},
```
**Lines: ~18**

---

## What Changed

| Aspect | v2 | v3 |
|--------|-----|-----|
| Handler format | `(ctx, state, builders) => (event) => Match...` | `{ EventTag: (ctx, state) => ... }` |
| Unhandled events | Explicit `Match.orElse(() => stay)` | Implicit stay |
| Cross-cutting events | Copy to every state | `global: { PowerOn: ... }` |
| Builder syntax | `goto(...).update(...)` | `goto(...).with(...)` |
| Stay shorthand | `stay` constant | `null` or omit handler |

---

## LOC Comparison (Full Machine)

| Component | v2 LOC | v3 LOC | Savings |
|-----------|--------|--------|---------|
| Hamster machine | ~200 | ~80 | -60% |
| Garage door machine | ~250 | ~110 | -56% |
| Weather service | ~108 | ~108 | 0% |
| **Total state logic** | ~1,105 | ~500 | **-55%** |

---

## Type Safety Preserved

### Exhaustive Handlers (opt-in)
```typescript
// Use ExhaustiveHandlers to require all events handled
states: {
  Opening: {
    on: {
      Click: ...,
      Tick: ...,
      PowerOn: ...,
      PowerOff: ...,
      // TypeScript ERROR: missing WeatherLoaded, WeatherError
    } satisfies ExhaustiveHandlers<...>
  }
}
```

### Discriminated Union States (unchanged)
```typescript
// Still impossible to represent invalid states
DoorState.Opening({ startedAt: new Date() })
// NOT: { state: "opening", openedAt: new Date() } // wrong field
```

### Type-Safe Transitions (unchanged)
```typescript
// goto() is typed to accept only valid states
goto(DoorState.Opening({ startedAt: new Date() }))  // ✓
goto(DoorState.Opening({ wrongField: 123 }))        // TypeScript error
goto({ _tag: "Opening" })                            // TypeScript error
```

---

## Projected Total LOC

| Demo | Current | With v3 API |
|------|---------|-------------|
| EffState v2 | 2,148 | ~1,400 |
| Simple React | 1,223 | - |
| Redux Toolkit | 1,202 | - |

**v3 brings EffState within ~15% of simple React while keeping all guarantees.**

---

## Open Questions

1. **Should `global` handlers run before or after state handlers?**
   - Before = can intercept and prevent
   - After = state takes priority

2. **Should we support `ExhaustiveHandlers` by default?**
   - Pro: Catches missing handlers at compile time
   - Con: More verbose, must handle every event

3. **How to handle effects that need service dependencies?**
   - Option A: Pass services in `entry`/`on` args
   - Option B: Keep Effect.Service pattern
   - Option C: React-style hooks with context

4. **Should `run` streams be typed to only emit valid events?**
   - Currently: `Stream<Events>` (any event)
   - Stricter: `Stream<Tick | StopComplete>` (specific events)
