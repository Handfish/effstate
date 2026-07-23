# @handfish/effstate-react

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
