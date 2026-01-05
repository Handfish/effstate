# Migration Guide: Effect-Native State Machine

## From v0.x to v1.0 (Effect-Native)

### Breaking Changes

#### 1. `interpret` now returns an Effect

**Before:**
```typescript
import { interpret } from "@your-lib/state-machine";

const actor = interpret(machine);
actor.send(new Toggle());
// Don't forget cleanup!
actor.stop();
```

**After:**
```typescript
import { interpret, interpretSync } from "@your-lib/state-machine";

// Option 1: Effect-native (recommended for Effect apps)
const program = Effect.gen(function* () {
  const actor = yield* interpret(machine);
  actor.send(new Toggle());
  // Auto-cleanup when scope closes!
});

Effect.runPromise(Effect.scoped(program));

// Option 2: Sync escape hatch (for React, simple cases)
const actor = interpretSync(machine);
actor.send(new Toggle());
actor.stop(); // Manual cleanup required
```

### Quick Migration

| Old Code | New Code |
|----------|----------|
| `interpret(machine)` | `interpretSync(machine)` |
| N/A | `yield* interpret(machine)` |

### Why the Change?

1. **Services in Actions**: You can now use `yield* MyService` inside effect actions
2. **Auto-Cleanup**: Actors stop automatically when the Effect scope closes
3. **Better DI**: Services are provided at interpret time, not inside actions

### Using Services in Actions

```typescript
// Define a service
class ApiService extends Context.Tag("ApiService")<
  ApiService,
  { fetch: (id: string) => Effect.Effect<Data> }
>() {}

// Use it in a machine
const machine = createMachine<..., ApiService>({
  states: {
    loading: {
      entry: [
        effect(({ context }) =>
          Effect.gen(function* () {
            const api = yield* ApiService;
            const data = yield* api.fetch(context.id);
            // ...
          })
        ),
      ],
    },
  },
});

// Provide the service at interpret time
const program = Effect.gen(function* () {
  const actor = yield* interpret(machine);
  // ...
}).pipe(
  Effect.provideService(ApiService, liveApiService),
  Effect.scoped
);
```

### React Integration

For React apps using `@effect-atom`, continue using `interpret` in your atom definitions (atoms run in Effect context):

```typescript
// This still works - atoms run in Effect context
const actorAtom = appRuntime
  .atom(interpret(myMachine))
  .pipe(Atom.keepAlive);
```

For simple React components without Effect-atom:

```typescript
// Use interpretSync for manual lifecycle management
function MyComponent() {
  const actorRef = useRef<MachineActor | null>(null);

  useEffect(() => {
    actorRef.current = interpretSync(machine);
    return () => actorRef.current?.stop();
  }, []);

  // ...
}
```

### Checklist

- [ ] Replace `interpret(machine)` with `interpretSync(machine)` for sync usage
- [ ] Use `yield* interpret(machine)` in Effect contexts for auto-cleanup
- [ ] Add service types to machine generic parameters if using services
- [ ] Provide services via `Effect.provideService` at interpret time
