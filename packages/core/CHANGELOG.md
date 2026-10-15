# @jambudipa/xstate-effect

## 0.3.0

### Minor Changes

- Check `setupWithSchema` machines at run time, infer the services of inline actions, and align observer and stream timing with XState 5.33.2.

  Changes that can break code that works on 0.2.0:

  - A `setupWithSchema` machine now checks, against the decoded type of each schema, every event it takes except the built-in `xstate.*` events, the context of each snapshot, its input, and the output of a done snapshot. A mismatch in a transition dies; in the initial snapshot it gives an error snapshot; in a restored snapshot it gives a `RestoreError`. `setupWithSchema` takes optional `input` and `output` schemas that type the machines' input and output.
  - A `setup` machine's requirements now include the services that its inline actions and inline invoke logic read: entry, exit, transition, `initial: { actions }` and `route` actions, in every state. `machine.provide` adds the services of the implementations it gets. Code that never provided them stops compiling; it failed at run time with "Service not found" before.
  - In a `setup` machine with named guards, an inline `and`, `or` or `not` must name guards that the setup declares, with params of their type. A missing name is now a type error, not a `GuardError` at run time.
  - `subscribe` observers are called in the processing that publishes a snapshot, before `send` returns, as XState calls them. Each observer still gets its calls one at a time, in order. An observer that waits runs in its own fiber, so the actor does not wait for it.
  - `actor.emissions` ends when the actor stops, is done or errors. A stream that starts after the actor ended ends at once.

  Other changes:

  - With `makeSimulatedClock`, `increment` and `set` return after the actor system settles: a child's done event that a delayed event causes reaches its parent before the call returns.
  - `transition`, `initialTransition`, `getMicrosteps` and `getInitialMicrosteps` type the machine's named actions in their results, so `action.type === "track"` compiles.
  - `machine.withContext` types its factory as the machine calls it, with `{ input, spawn, self }`.
  - `makeActorLogic`'s `start` can use `Scope` without adding it to the requirements.
  - `ActorLogic.SnapshotOf`, `EventOf`, `InputOf`, `EmittedOf` and `RequirementsOf`, and the `ActorRef` helpers, resolve at the root namespace.
  - `assignProperty` reads its context type from the config it is written in, and warns in a custom action, as `assign` does.
  - The JSON type of a directed graph node names its `edges`.

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
