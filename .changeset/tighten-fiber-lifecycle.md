---
"@handfish/effstate-v4": patch
---

Fix memory leaks and tighten fiber lifecycle management

**Stream cleanup:**
- Stream interrupts are now properly awaited before starting new streams
- Prevents `runFoldEffect` accumulation when rapidly transitioning between states

**Entry/exit fiber tracking:**
- Entry fibers are now tracked and cancelled on rapid state transitions
- Exit fibers are tracked with automatic cleanup when complete
- Prevents orphaned fibers from accumulating

**Stop safety:**
- Added `stopped` flag to prevent operations after `stop()` is called
- `stop()` now properly interrupts all tracked fibers (run stream, entry effect)
- Events are ignored after stop
- `_syncSnapshot()` respects stopped state

**Applies to:** `send()`, `stop()`, and `_syncSnapshot()`
