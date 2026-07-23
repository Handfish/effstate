# @handfish/effstate-react

## 1.0.0

### Patch Changes

- 081a86b: Make `MachineConfig.context` accept a real schema

  The optional `context` schema was typed `Schema.Schema<C, unknown, never>`. Because
  `Schema` is invariant in its encoded type, that slot was uninhabitable by any
  concrete schema (a `Schema.Struct<…>` has a real encoded type, not `unknown`), so
  passing a context schema errored without a cast.

  `MachineConfig` / `MachineDefinition` / `defineMachine` now carry a `CI = C`
  (context-encoded) type parameter and type the field as `Schema.Schema<C, CI, never>`.
  Concrete context schemas are accepted with no cast, and the encoded type is
  preserved — exposed via the new `MachineContextEncoded<T>` extractor — so
  transforming schemas (e.g. `Schema.DateFromString`, where `C` holds a `Date` but the
  encoded form is a `string`) round-trip with full type information.

  `CI` defaults to `C`, so existing `defineMachine<S, C, E>(…)` calls are unaffected.

  `defineMachine` also gains a **curried** overload for transforming context schemas.
  Because TypeScript can't infer `CI` while `S`/`C`/`E` are given explicitly, calling
  `defineMachine<S, C, E>()(config)` (type args, then config in a second call) infers
  `R`/`Err`/`CI` from the config — so a transforming schema (e.g. `Schema.DateFromString`)
  keeps its encoded type with no extra type arguments. The direct
  `defineMachine<S, C, E>(config)` call is unchanged and remains the norm for
  non-transforming schemas.

  `@handfish/effstate-react`'s `useActor` now accepts machines regardless of their
  context-encoded type (`CI`), so a machine built with a transforming context schema
  still works with the hook.

- 587c310: bump version
- Updated dependencies [081a86b]
- Updated dependencies [587c310]
- Updated dependencies [8118a47]
  - @handfish/effstate-v4@1.0.0

## 1.0.0

### Minor Changes

- Initial release of lean EffState v4 packages:
  - `@handfish/effstate-v4`: Schema-first state machines for Effect (~6KB)
    - `State()`, `Event()`, `Union()` helpers with Effect Schema
    - Full Effect R (Requirements) channel support
    - Auto-canceling run streams on state exit
    - Entry/exit effects
  - `@handfish/effstate-react`: React hooks for effstate-v4 (~3KB)
    - `useActor` - Create and manage machine actors
    - `useActorEffect` - Side effects on snapshot changes
    - `useActorWatch` - Watch derived values
    - `useActorSync` - Persistence/cross-tab sync
    - `useActorBridge` - Cross-actor communication

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @handfish/effstate-v4@1.0.0
