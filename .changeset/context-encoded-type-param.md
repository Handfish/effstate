---
"@handfish/effstate-v4": minor
"@handfish/effstate-react": patch
---

Make `MachineConfig.context` accept a real schema

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
Note: because TypeScript can't infer `CI` while `S`/`C`/`E` are given explicitly, a
*transforming* context schema needs all six type args
(`defineMachine<S, C, E, never, never, EncodedContext>(…)`) or full inference; a
non-transforming schema (encoded type equals `C`) needs nothing extra.

`@handfish/effstate-react`'s `useActor` now accepts machines regardless of their
context-encoded type (`CI`), so a machine built with a transforming context schema
still works with the hook.
