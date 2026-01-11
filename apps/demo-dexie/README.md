# EffState + Dexie Demo

This demo showcases integrating EffState with [Dexie](https://dexie.org/) for IndexedDB-based persistence.

## Why Dexie over localStorage?

| Feature | localStorage | Dexie (IndexedDB) |
|---------|-------------|-------------------|
| Storage limit | ~5MB | ~50% of disk |
| Cross-tab sync | Manual (BroadcastChannel) | Built-in via liveQuery |
| Async | No (blocks main thread) | Yes |
| Querying | None | Full query support |
| Schema | None | Typed tables |
| Transactions | None | ACID transactions |

## Architecture

This demo follows the Effect.Service pattern from the sync-engine-web reference:

```
src/lib/services/
├── dexie.ts           # Dexie service (Effect.Service pattern)
└── state-persistence.ts  # Persistence operations
```

### Key Patterns

**1. Dexie wrapped in Effect.Service**

```typescript
export class DexieService extends Effect.Service<DexieService>()(
  "DexieService",
  {
    effect: Effect.sync(() => {
      const db = new EffStateDexie();
      return {
        db,
        query: <T>(execute: (db) => Promise<T>) =>
          Effect.tryPromise({
            try: () => execute(db),
            catch: (cause) => new DexieQueryError({ cause }),
          }),
      };
    }),
  }
) {}
```

**2. Cross-tab sync via liveQuery**

```typescript
// Dexie's liveQuery detects IndexedDB changes across tabs
const persistedState = useLiveQuery(
  () => db?.machineStates.get(MACHINE_ID),
  [db]
);

useEffect(() => {
  if (!persistedState || crossTabSync.isLeader()) return;
  // Sync from other tab's changes
  currentActor._syncSnapshot(snapshot, childSnapshots);
}, [persistedState]);
```

**3. Leader election for write coordination**

Only the leader writes to Dexie, preventing race conditions:

```typescript
const crossTabSync = createCrossTabSync({
  storageKey: LEADER_KEY,
  onSave: () => {
    if (currentActor) saveStateToDexie(currentActor);
  },
});

// On state change
actor.subscribe(() => crossTabSync.saveIfLeader());
```

## Running the Demo

```bash
# From repo root
pnpm install
pnpm --filter demo-dexie dev
```

## Verification

1. Open the app in a browser
2. Toggle the hamster to change state
3. Open DevTools > Application > IndexedDB > effstate
4. Verify `machineStates` table contains the state
5. Open a second tab - changes sync via liveQuery
6. Refresh - state persists from IndexedDB

## Comparison with localStorage Demo

The main differences from `apps/demo`:

| Aspect | demo (localStorage) | demo-dexie (IndexedDB) |
|--------|---------------------|------------------------|
| Persistence | `localStorage.getItem/setItem` | `db.machineStates.get/put` |
| Cross-tab sync | BroadcastChannel + storage event | Dexie liveQuery |
| Async | Sync (blocks) | Async (non-blocking) |
| Type safety | Manual JSON parsing | Schema-validated |

## Future Extensions

This pattern can be extended for:

- **Server sync**: Add sync-engine-web patterns for remote persistence
- **CRDT conflict resolution**: Add Loro for offline-first collaboration
- **Offline queue**: Buffer changes when offline, sync when online
- **Schema migrations**: Handle data model evolution
