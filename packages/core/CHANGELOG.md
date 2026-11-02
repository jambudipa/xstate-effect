# @jambudipa/xstate-effect

## 0.4.0

### Minor Changes

- Add agent logic and a settlement proof: `fromAgent` runs a model call that must move its state, and a machine that holds agent logic is proved at compile time and at run time.

  Changes that can break code that works on 0.3.0:

  - `setup(...).createMachine` has a new signature. Each transition target and `initial` must name a state, so a config with an unknown target now fails with `UnknownTarget` or `UnknownInitial`, in every setup. A setup with an agent actor or a certified child takes a second inference parameter, merges the wide config with the config as written, and must pass the settlement proof (`SettlementProof`, `SettlementCheck`, `MenuCheck`, `ChildSettlementCheck`). A config that the proof cannot read fails with `ConfigNotLiteral`, and an `any` config does not compile. Code that names the type arguments of `createMachine` can need a change.
  - In such a setup, a misspelt key on an agent invocation gets the missing-`onDone` error, not the excess-property error.
  - `AnyActorLogic` no longer takes agent logic. The root gains `AnyLogicSlot`, which takes every logic and whose methods need the runtime's capability, and `LogicTypes`, which reads the types a logic carries. The library's generics now read `AnyLogicSlot`, so a helper that passes a setup's `actors` to a parameter of type `AnyActorLogic` can need a change.
  - `ActorLogic` methods take an optional capability argument. A custom logic needs no change.
  - The certificate hash covers the library version, so each new version needs a new certificate.

  Rules of the new API, for code written against a prerelease build:

  - `fromAgent` requires `tools`. Each tool must be an event that the invoking state accepts.
  - A state that invokes an agent must accept at least one concrete event. A wildcard and an `xstate.` event do not count; `AgentStateAcceptsNoEvents` names the state.
  - Agent logic runs only as a declared `invoke`, with an `onDone` that leaves the state. `createActor`, a spawn and `provide` refuse it.

  Known limits:

  - The compiler does not refuse a spread into `states` with an explicit key: `states: { ...wideStates, done: { type: "final" } }` compiles with its hidden states unproved. Two other layers cover this form. An ESLint rule bans it in this repository, and `proveSettlement` refuses the machine with `AgentWithoutSettlement`. The rule does not ship with the package, so add the selector to your own config. The rule sees only the syntax of the call: it does not see a config or a `states` object built in a variable, a spread beside `states` that brings in `states`, an aliased `createMachine`, or a machine in a callback inside the `states` of another machine.
  - A deliberate cast (`as unknown as`) compiles. Only the run-time checks stop it: `proveSettlement` finds agent logic by its run-time brand, and agent methods die with `AgentRunError` without the runtime's capability.
  - Only `SettlementProof` refuses a wide config. `TargetCheck`, `SettlementCheck`, `MenuCheck` and `ChildSettlementCheck` each resolve to `unknown` on it when used directly.
  - A setup with no agent actor and no certified child compiles a wide config, as 0.3.0 does, and does not prove settlement. A plain `createMachine` has no proof and no target check.
  - The proof depends on the compiler. TypeScript 6.0.3 and tsgo 7.0.0-dev.20260707.2 pass the acceptance fixtures. tsgo 7.0.0-dev.20251207.1 refuses some valid machines. TypeScript 5.8.2 is not supported for this proof.
  - The type cost of a 35-state machine in an agent setup rose 6.71%.
  - Machine guards count as able to pass in the type proof and in `proveSettlement`. Only `explore` runs them, and a change to a guard body reaches a certificate only through its hash, so run `xstate-effect-certify-gate <config>` in CI.

  Other changes:

  - `./graph` adds `proveSettlement`, `explore`, `timerFirings`, `processRestart`, `certify`, `checkCertificate`, `moduleClosure` and `unresolvedImports`.
  - The new `xstate-effect-certify` bin writes and checks certificate modules, and a config target's optional `layer` provides a machine's services. The new `xstate-effect-certify-gate` bin runs that check under a time limit and fails unless it reads one passing report of that run, so use it in CI. The new `certified` function marks a child machine.
  - `pnpm check`, `prepublishOnly` and CI now run the settlement gate.

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
