# @jambudipa/xstate-effect

## 0.2.0

### Minor Changes

- b58adfd: Tighten `setup` typing and align two runtime details with XState 5.33.2:

  - `setup({ types })` takes `output`, as XState's does: a setup machine's snapshot output and done output are typed by it (they were `unknown`).
  - `createActor` of a `setup` machine now requires the services its actions' Effects and its actors need, so the compiler asks for them. This can make code that never provided them stop compiling; provide the services to the Effect that calls `createActor`. Initial entry actions now read those services too (they failed with "Service not found").
  - Stopping an actor no longer warns about an event a child's cleanup sends while stopping with it; XState drops it silently.

### Patch Changes

- 7ae2fe1: Fix five findings of the documentation pass:

  - An invoke with `input: null` now gives the invoked child `null`, as XState 5.33.2 does (it gave `undefined`).
  - `makeSimulatedClock` stays usable after a timeout callback throws; the throw still reaches the caller of `increment`/`set`. A nested `increment` inside a callback now fires the newly due timeouts inside that call (ledger row DEV-75).
  - The runtime ids (`TypeId` symbols, `Context.Reference` keys) use the published package name `@jambudipa/xstate-effect/` instead of the pre-release prefix.
  - The examples `toggleWithCountMachine`, `fetchMachine`, the MongoDB credit check and `mediaScannerMachine` now count, total retries, use the cached report and read their input.
  - The development scripts `clean.ts` and `check-markdown-code.ts` (not part of the published package) honour their configuration and flags and no longer drop failures.

- dde9879: Align three more behaviours with XState 5.33.2:

  - A state value that names no state fails with XState's message (`Child state '…' does not exist on '…'`): `transitionNode`, and `can`, `getTransitionData` and `microstep` of a snapshot built from such a value, no longer fall back to the node's own transitions.
  - `system.getSnapshot()._scheduledEvents` lists its keys in the order they were scheduled, and a rescheduled id keeps its place.
  - An event a child sends while the scope that owns its parent closes is dropped without a warning, whichever child sent it, as a stop drops it.

- 9d647d0: Fix three behaviours that differed from XState 5.33.2, found while raising the test coverage:

  - An actor that enters a state whose `initial` names no child now errors with XState's message (`Initial state node "…" not found on parent state node #…`) instead of `Transition failed`; the definition error stays the `cause` (ledger row DEV-72).
  - A `fromCallback` cleanup that calls `sendBack` while the actor stops now reaches the parent: the cleanup runs inside the stop transition, as in XState. It still runs once, also for an actor that errors.
  - An actor whose custom logic gives status `stopped` for an event, or that was restored from a stopped snapshot, now hands each later event to its logic, as XState does, instead of dropping it.

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
