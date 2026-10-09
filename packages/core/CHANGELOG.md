# @jambudipa/xstate-effect

## 0.1.0

### Minor Changes

- First public release: the runtime behaviour of XState 5.33.2 in Effect-native form, on `effect` 4.0.0.
  - The public API of the `xstate` package, behind the same six entry points: `.`, `./actions`, `./actors`, `./guards`, `./graph` and `./dev`. ESM only. The few names the port leaves out, such as `interpret` and `toObserver`, each have a deviation row in the ledger.
  - Effect-native signatures: `createActor` returns an `Effect` that needs a `Scope`, and `start`, `stop`, `send` and `getSnapshot` are Effects. There is no Promise facade.
  - The statechart engine follows XState's own algorithm: parallel and history states, eventless (`always`) and delayed transitions, final states, and one published snapshot per macrostep.
  - Errors in actions, guards and actor logic set the actor's status to `error` and reach the parent as `xstate.error.actor.*` events. `snapshot.output` and `snapshot.error` are `Option` values.
  - Persisted snapshots encode and decode through an Effect `Schema` codec, children and tags included.
  - The 74 upstream test files of `xstate@5.33.2` are rewritten in Effect form and run in the default test suite. Each deviation from upstream is recorded, with the decision that requires it, in `test/upstream/CONFORMANCE.md`.
  - `effect` is a peer dependency (`^4.0.0`).
