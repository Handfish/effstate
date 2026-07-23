---
"@handfish/effstate-v4": minor
---

Fix memory leaks, tighten fiber lifecycle, add `interruptEntryOnTransition` option

**New feature: `interruptEntryOnTransition` option**
- `false` (default): Entry effects run to completion even on rapid transitions. Safer for animations and setup logic.
- `true`: Entry effects are interrupted when transitioning away. Use for expensive operations that shouldn't continue.
- Entry effects are always interrupted on `stop()` regardless of this setting.
- See `docs/entry-effect-lifecycle.md` for detailed guidance.

**Stream cleanup:**
- Stream interrupts are now properly awaited before starting new streams
- Prevents `runFoldEffect` accumulation when rapidly transitioning between states
- New stream only starts after old stream is fully interrupted

**Fiber lifecycle:**
- Exit effects remain fire-and-forget (cleanup for old state)
- Removed unnecessary fiber tracking overhead

**Stop safety:**
- Added `stopped` flag to prevent operations after `stop()` is called
- `stop()` interrupts run stream and entry effect
- Events are ignored after stop
- `_syncSnapshot()` respects stopped state
- Deferred stream starts check `stopped` before running

**Applies to:** `send()`, `stop()`, and `_syncSnapshot()`
