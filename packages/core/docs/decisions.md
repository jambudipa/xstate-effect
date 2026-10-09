# Decisions

The decisions that shape this port of XState 5.33.2 to Effect 4. The conformance ledger
([`test/upstream/CONFORMANCE.md`](../test/upstream/CONFORMANCE.md)), the test files and the source
comments cite them by ID:

- **D1–D20** — the approved decisions of the port's plan ([Approved decisions](#approved-decisions-d1d20)).
- **SD-1–SD-28** — the spec decisions that settle the forks the research surfaced, with their
  dated amendments ([Spec decisions](#spec-decisions-sd-1sd-28)).

The text is copied from the port's planning documents. Internal file paths and the wording of
the agent tooling that ran the port are left out; the meaning of each decision is unchanged.
Some decisions cite the port's input plan (section, row and phase IDs such as F1, S3, C2 and
Phase 2), its research notes and its acceptance criteria (AC n). Those documents are not
published. The gap rows (S1–S27, A1–A23, C1–C22, P1–P14) and every deviation are in the
ledger. A scenario ID (CONF-8, DELIVERY-1, HARNESS-2, …) names the evidence file
`test/verify/verify-xstate-5-33-2-port-<ID>.spec.ts`. "eque2" is a separate, private Effect-based
state-machine port that served as a reference.

## Approved decisions (D1–D20)

The input's own decisions D1–D3 appear here as D6, D8 and D9.

### Scope and acceptance

#### D1: the conformance set

**Choice** — Rewrite in Effect form every upstream test file at tag `xstate@5.33.2`:
the 58 `*.test.ts` files in `packages/core/test`, the 6 in `packages/core/test/examples`,
and the 10 in `packages/core/src/graph/test` (74 files), into
`packages/core/test/upstream/` with the upstream file names. Each rewritten test carries
the upstream file and test name in a comment above it. The four type-level files
(`types`, `setup.types`, `spawn.types`, `typeHelpers`) use `expectTypeOf` and are proved
by the test type-check (D19). Graph tests generate their own vitest snapshots.

**Justification** — The input defines "complete" as passing these files (Acceptance).
Research pinned the exact set: the input's "64 files" is right (58 + 6 examples), but its
graph count is wrong — it says 6, names 7, and the tag holds 10 (`shortestPaths`,
`states` and `testModel` were missing).

**Alternatives** — Differential probes that run each machine through the real `xstate`
runtime (the 2026-10-02 audit method). Rejected as the gate: it adds `xstate` as a
dependency and checks only what a probe author thought to write. Probes stay a debugging
aid.

**Verified by** — AC 6.

#### D2: one conformance ledger

**Choice** — Keep one file, `packages/core/test/upstream/CONFORMANCE.md`, with two
tables: every upstream test file and its status (passes, or the tests it does not port
and why), and every gap row (S1–S27, A1–A23, C1–C22, P1–P14) with the passing test(s)
that close it or a recorded deviation.

**Justification** — The input says "delete each gap row once its tests pass" and "every
upstream file passes or has a recorded, deliberate deviation". The input is kept
verbatim, so it cannot be edited; a ledger in the repo is the place to record both.
Several rows (S2, S4, S15, A1, C10) name only eque2 references, so only a ledger shows
which upstream test closes them.

**Alternatives** — A deviations list only. Rejected: it cannot show that a gap row with
no upstream reference is closed.

**Verified by** — AC 7.

#### D3: test-first per phase

**Choice** — Each of Phases 2–7 starts by rewriting the upstream files its gap rows name;
Phase 8 rewrites the files no earlier phase claimed and runs the whole set.

**Justification** — The input's Phase 2 is "done when the rows pass their upstream
tests", and Phase 3 is gated by the SCXML suite, so those tests must exist before Phase 8.
Writing them last repeats today's failure: a green suite that says nothing about runtime
behaviour.

**Alternatives** — All rewrites in Phase 8, the literal reading of the input's Phase 8.
Rejected for the reason above.

**Verified by** — none — a sequencing rule; its outcome is checked by AC 6 and AC 7.

#### D4: the SCXML conformance runner

**Choice** — Port upstream `src/scxml.ts` (`toMachine`, SCXML to machine config) as a
test-support module that is not exported, port `scxml.test.ts` on top of it, and add the
devDependencies `@scion-scxml/test-framework` and `xml-js`, as upstream does.

**Justification** — The input names SCXML as the strongest single check and the Phase 3
gate. The upstream runner cannot run without the converter: it reads W3C fixtures from
`@scion-scxml/test-framework` and converts them with `toMachine` (610 lines, uses
`xml-js`). Upstream does not export the converter, so it stays test-only here.

**Alternatives** — Hand-convert the SCXML fixtures to machine configs. Rejected: about 116
W3C cases, each a chance to mistranslate. Skip SCXML. Rejected: the input makes it a gate.

**Verified by** — AC 8.

#### D5: delta subscriptions (P15) are out of scope

**Choice** — Do not build P15 in this goal; record it in the ledger as out of scope.

**Justification** — The input marks it "optional", it is not XState behaviour, and none of
the input's phases claims it (Phase 6 closes P1–P12, Phase 7 P13–P14). Another project
(ai-workflows) uses its own eque2 copy, not this package.

**Alternatives** — Build it in Phase 6. Rejected: no consumer of this package needs it.

**Verified by** — none — not built.

### Public API

#### D6: Effect-native API only (input D1)

**Choice** — `createActor`, `getSnapshot`, `send`, `subscribe`, `system.get` and
`getStateNodeById` return Effects. There is no XState-compatible facade. `toObserver`,
`interpret`, the observer-object form of `subscribe` and returned `Subscription` objects
are not ported; scoped Effects and Streams replace them, and the ledger records each as a
deviation.

**Justification** — The user decided this on 2026-10-02 (input D1). Parity means the same
behaviour, not the same signatures.

**Alternatives** — A Promise-returning facade over the Effect core. Rejected by the user.

**Verified by** — AC 1, AC 9.

#### D7: actor identity and `system.get`

**Choice** — Key the system registry by `systemId`, wire `spawn` per parent (F6), and make
the public `system.get(systemId)` return `Effect<Option<ActorRef>>`. Inside a transition,
`sendTo` and `stopChild` resolve a target with a synchronous internal lookup.

**Justification** — The input contradicts itself: D1 keeps `system.get` returning an
Effect, while F6 says make it synchronous and return `ActorRef | undefined`. D1 is the
later, explicit user decision, so the public signature follows it, and `Option` follows
D2 and the project lint rule `effect/no-undefined-use-option`. F6's real need — a lookup
inside action execution (A5's defect) — is met by the internal synchronous lookup.

**Alternatives** — F6 as written (synchronous, `ActorRef | undefined`). Rejected: it
breaks D1. `Effect<ActorRef | undefined>`. Rejected: lint flags `undefined` for absence.

**Verified by** — AC 10.

#### D8: `Option` stays, with a Schema codec for persisted snapshots (input D2, F8)

**Choice** — `snapshot.output`, `snapshot.error`, `event.output` and the inspection
`sourceRef` stay `Option`. `getPersistedSnapshot` encodes through an Effect `Schema` codec
to JSON-safe data that includes children and tags; restore decodes through the same codec.

**Justification** — The user decided `Option` stays (input D2). Without a codec an `Option`
serialises as `{_id:'Option'}` and restore cannot rebuild it (P2).

**Alternatives** — Plain values (`undefined`) at the API edge. Rejected by the user.

**Verified by** — AC 11.

#### D9: `createMachine` stays (input D3)

**Choice** — Export `createMachine` beside `setup().createMachine`; the second stays the
typed, preferred path. This overrides recommendation 5 of the earlier refactoring review.

**Justification** — XState 5.33.2 exports both, the upstream tests use both, and
`createMachine` already works.

**Alternatives** — Remove it, as the refactoring review suggests. Rejected by the user.

**Verified by** — AC 12.

#### D10: subpath entry points mirror xstate

**Choice** — Add `package.json` exports `./actions`, `./actors`, `./guards`, `./graph` and
`./dev` beside `.`, matching the six entry points of `xstate@5.33.2`.

**Justification** — The input counts `xstate/graph` and `xstate/dev` as public API. The
other three are re-export files, so full parity costs three small files.

**Alternatives** — Root export only. Rejected: an import of `…/graph` would fail where
xstate succeeds.

**Verified by** — AC 13.

#### D11: snapshot validation on restore is opt-in (P5)

**Choice** — By default `createActor(machine, { snapshot })` accepts an inconsistent
snapshot, as XState 5.33.2 does. An opt-in actor option rejects it with
`InvalidPersistedSnapshotError`, modelled on eque2's snapshot validation.

**Justification** — The input says "match XState; offer validation as an option".

**Alternatives** — Always validate, as eque2 does. Rejected: it diverges from XState.

**Verified by** — AC 14.

### Runtime architecture

#### D12: one fiber and one scope per actor and per invocation (F1)

**Choice** — Each actor and each invocation runs in its own forked fiber with its own
closeable `Scope`. `stop` interrupts the fiber, closes the scope (finalizers run) and stops
the children; a `send` after stop is ignored with a warning. Spawned children live in a
per-parent `FiberMap`. Copy eque2's `FiberManager` behaviour and tests, not its structure.

**Justification** — Today logic runs in the caller's fiber, finalizers attach to the
caller's scope and `stop` only sets a flag; that one cause breaks C6–C14. Recommendation 8
of the earlier refactoring review and the eque2 port both choose this model, and eque2
passes its tests with it.

**Alternatives** — Keep inline execution and add explicit cleanup hooks. Rejected: every
logic type would need its own cleanup path, and interruption would still not propagate.

**Verified by** — AC 4, AC 15.

#### D13: a statechart engine on the XState algorithm (F3, F4)

**Choice** — Model the active state as a set of state nodes; compute the transition
domain (LCA), exit and entry sets in document order and source-relative targets; run a
macrostep engine with an internal event queue, an initial microstep, `always` and
`xstate.done.state.*` handling, one published snapshot per macrostep, and
`maxIterations`. Port the algorithm from XState `stateUtils.ts`.

**Justification** — Parallel states, history and correct exit/entry order cannot be
expressed on today's single leaf path. XState's algorithm is the SCXML algorithm the
conformance suite tests. eque2 has no parallel states, so it is no reference here.

**Alternatives** — Patch the leaf-path model row by row. Rejected: S3, S8 and S13 each
need the full configuration set.

**Verified by** — AC 8, AC 16.

#### D14: an error model (F5)

**Choice** — A failing action or guard sets status `'error'` and `snapshot.error`, ends
subscribed streams with that error, and escalates to the parent as
`xstate.error.actor.*`. Typed action failures are no longer swallowed.

**Justification** — Today defects pass through `catchAll`, the actor loop dies silently,
and typed failures become no-ops (S24, A17, C19).

**Alternatives** — None credible: XState's error semantics are the target.

**Verified by** — AC 17.

#### D15: every XState action and guard form (F7)

**Choice** — Accept inline functions that receive `({ context, event, self, system },
params)`, `{ type, params }` objects, and plain functions in `setup` and `provide`,
beside the port's existing definition objects.

**Justification** — Every XState form throws a `TypeError` today (A12–A15), so almost no
upstream test can run without this.

**Alternatives** — Accept port definition objects only. Rejected: it fails D1.

**Verified by** — AC 18.

### Toolchain and sequencing

#### D16: migrate to `effect@4.0.0` first

**Choice** — Migrate to `effect@4.0.0` as Phase 1, after Phase 0 and before any feature
work, with the Effect v3-to-v4 migration procedure. It decides the `@effect/vitest`, Vitest
and TypeScript versions and refreshes the lint rules from the canonical bundle.

**Justification** — New code is then written once, against v4. The owner's guidance
requires that procedure for a v3-to-v4 move. It needs a clean tree and a runtime smoke test,
which Phase 0 provides.

**Alternatives** — Build features on v3 and migrate last. Rejected: Phases 2–8 would be
written twice.

**Verified by** — AC 2, AC 19.

#### D17: settle the dirty main checkout before the worktree exists

**Choice** — Commit the uncommitted work on `main` before the port's branch is made, in four
commits: the 13-file `Variance` refactor with its refactoring review (input Phase 0 step 1),
the development-tooling install files, `.claude/worktrees/` added to `.gitignore`, and
removal of the stray `packages/core/xstate-effect-core-0.1.0.tgz` build artefact.

**Justification** — The worktree branches from `HEAD`, so uncommitted work does not reach
it. The `Variance` refactor implements recommendation 1 of the refactoring review, which
this plan builds on; on the dirty tree `tsc` and the tests pass (lint has 2 unused-symbol
errors in `Actor.ts` from it, fixed in Phase 1). `.claude/worktrees/` is not ignored today,
so without the entry the port's worktree shows as untracked in `main`.

**Alternatives** — Discard the refactor. Rejected: it loses work the refactoring review
plans on. Stash and bring it along. Rejected: it leaves the change uncommitted on two trees.

**Verified by** — AC 20.

#### D18: delete `packages/core/todo.md`

**Choice** — Delete the file (input Phase 0 step 6 offers "update or delete").

**Justification** — It is stale (it says transitions are stubbed), and the ledger (D2)
replaces it.

**Alternatives** — Rewrite it. Rejected: two trackers drift apart.

**Verified by** — AC 21.

#### D19: the quality gate

**Choice** — The gate is `pnpm lint`, `pnpm typecheck`, `tsc -p tsconfig.test.json
--noEmit` and `pnpm test`, all in `packages/core`, all exit 0, with zero skipped tests.
`pnpm check-docs` is not in the gate.

**Justification** — Lint, type-check and tests are the project's own checks. `pnpm
typecheck` covers `src/` only, so the type-level upstream files (D1) need the test config;
today it reports 625 errors, mostly examples on old action forms that D15 replaces.
`check-docs` fails today (95 of 165 blocks clean) and the input does not ask for a docs
refresh — that is a separate workstream.

**Alternatives** — A narrow tsconfig for `test/upstream/` only. Rejected: it leaves the
existing tests and examples type-broken while the gate reports clean.

**Verified by** — AC 22, AC 23, AC 24, AC 25.

#### D20: one goal, one worktree, one branch

**Choice** — Run all nine phases as one piece of work on the branch
`goal/xstate-5-33-2-port`, with a handover at each context change, and the user merges the
branch into `main` at the end.

**Justification** — The input is one contract with one finish line (D1). One approval
covers it, and the stop gate holds across contexts. The repo has no remote, so there is no
pull request to split.

**Alternatives** — One goal per phase. Rejected for now: nine approvals and nine
worktrees, for a solo branch with nothing to merge against. It is the better choice if
the user wants `main` updated after each phase.

**Verified by** — none — a process choice; AC 26 checks the branch is fully committed.

## Spec decisions (SD-1–SD-28)

The approved decisions D1–D20 bind the spec. The decisions below (SD-n) settle the forks the
research surfaced. Each follows the highest-fidelity default (XState 5.33.2 behaviour) and
records any deviation in `CONFORMANCE.md` (D2). None contradicts a D-decision. A dated
amendment changes its decision from that date on.

- **SD-1 Test layout.** Upstream rewrites live in `test/upstream/` under the upstream file
  names (D1). Evidence lives in one verify file per scenario,
  `test/verify/verify-xstate-5-33-2-port-<ID>.spec.ts`. The full suite reruns after every
  task, so the default suite must stay green: `vitest.config.ts` includes `test/*.test.ts`
  and `test/verify/**/*.spec.ts` and excludes `test/upstream/**`. Each `CONF-n` evidence
  file imports the rewrites that are green at phase n inside one `describe` per file, so
  every upstream test runs exactly once, inside `pnpm test`, and its evidence routes to
  `CONF-n`. A rewrite that is not green yet is listed in `test/upstream/pending.json`;
  `eslint.config.mjs` ignores the listed files, and the CONF task that imports a file
  removes it from the list. `vitest.upstream.config.ts` (script `test:upstream`) runs a
  named rewrite directly for red-phase work. No test spawns a child Vitest process. The
  `test` and `test:upstream` scripts run with `CI=true`, so a missing snapshot fails
  instead of being written. `pnpm typecheck` runs `tsc --noEmit` and
  `tsc -p tsconfig.test.green.json --noEmit`, whose `exclude` equals the `pending.json`
  entries plus `test/examples.test.ts` and `examples/**` (removed by COMPAT-1), so the
  per-task type-check proves every green test file (AC 24). Lint runs with
  `eslint --cache`. Each CONF import task times lint, test and typecheck against a 150 s
  budget and shards a command that exceeds it.
- **SD-2 Parity and conformance gates.** Two scenario families make "every upstream file
  passes" mechanically checkable:
  - `PARITY-<n>` (static): for every upstream test of the files rewritten in task phase n,
    the rewrite has an annotation `// upstream: <file> > <describe path> > <title>` directly
    above a test or generator call, with at least the upstream assertion count (`expect(` /
    `assert.` calls), the same inline-snapshot text, and the same number of
    `@ts-expect-error` lines in the file; otherwise a "Tests not ported" ledger row names
    the gap and its reason. The frozen manifest `test/upstream/upstream-manifest.json`
    holds titles, assertion counts, inline-snapshot texts, `@ts-expect-error` counts and
    generator expansions.
  - `CONF-<n>` (runtime): the evidence file imports its files; a final test walks the
    file's task tree and checks, per imported file, `passed >= runnable - notPortedRunnable`
    and `passed >= 1`, where `runnable` excludes upstream skip/todo tests and
    `notPortedRunnable` counts only ledger rows for runnable tests. The count check runs
    after every imported test even under `--sequence.shuffle`.

  A file is rewritten in the earliest phase whose gap rows it closes (D3, research §6) and
  is imported (must pass fully) in the phase where its last dependency lands (research
  "green" column, with `actor` moved to phase 6 because it uses `waitFor`). The schedule is
  the [task-phase plan](#task-phase-plan-sd-2) below.
- **SD-3 Synchronous throws.** XState throws synchronously in a few places that are part of
  its contract. The port keeps exactly these synchronous: `createMachine` definition errors
  (missing initial, invalid target, unknown `#id`, invalid history), `machine.resolveState`
  with an invalid state value, and `assertEvent`. They
  go through one module, `src/internal/invariant.ts`, which throws `Data.TaggedError`
  instances whose `message` equals the upstream text; `eslint.config.mjs` scopes the
  `no-throw`/`no-error-constructor` exceptions to that file. Every other upstream throw
  site fails its Effect (`transition`, `getStateNodeById`, pure helpers) or sets status
  `error` inside the actor (actions, guards, `sendTo`, `raise`, maxIterations); a string
  event passed to `send` is a defect with the upstream message (the type system already
  rejects it). `test/verify/upstream-messages.ts` lists every site, its message and its
  channel (INV-1). No inline disable comments (user guidance).
  Amendment (2026-10-08, owner): no synchronous throw remains in the package. `createMachine`
  never throws: the machine keeps its first definition error, in upstream order, and each
  Effect that computes a snapshot of it fails with it. `machine.resolveState` with an
  invalid state value and `assertEvent` fail their Effects. Each failure keeps the upstream
  message. `src/internal/invariant.ts` and its lint block are gone; only the SCXML converter
  (test support, D4) still throws synchronously. Ledger rows DEV-8 and DEV-72 to DEV-74
  (owner: "Every file ON. All rules.", "DON'T relax rules!").
- **SD-4 Errors inside user code.** A throw, a typed failure or a defect in an action,
  guard, assigner, context factory or logic sets `status: 'error'` with
  `snapshot.error = Option.some(<the original value>)` (D8 keeps `Option`), fails the
  subscribed streams with the original value, and relays
  `{ type: 'xstate.error.actor.<id>', error: <original value>, actorId }` to the parent (raw
  value, as XState). Guard throws are rewrapped exactly as upstream: `Unable to evaluate
  guard '<type>' in transition for event '<event>' in state node '<id>':\n<message>`.
  Upstream error texts are reused verbatim everywhere a rewritten test asserts them.
- **SD-5 Built-in events.** Built-in events (`xstate.init`, `xstate.done.actor.<id>`,
  `xstate.error.actor.<id>`, `xstate.done.state.<id>`, `xstate.after.<delay>.<id>`,
  `xstate.snapshot.<id>`, `xstate.route`, `xstate.stop`) are plain data with an own
  enumerable `type` and the XState fields, and no `_tag`, so `toEqual` against plain objects,
  spreads and JSON all match upstream. The exported classes stay as constructors that build
  such objects. `event.output` on done events is `Option` (D8); `event.error` is raw.
- **SD-6 Snapshot methods.** `MachineSnapshot` carries `matches`, `hasTag`, `can`, `getMeta`
  and `toJSON` as non-enumerable own properties attached by one constructor that every
  engine path uses, so spreads inside the engine cannot drop them; the `Snapshot.*`
  functions stay. `can(event)` returns `Effect<boolean>` because guards can be Effects;
  `matches`, `hasTag`, `getMeta`, `toJSON` are synchronous. `snapshot.machine` holds the
  machine object (XState), excluded from `toJSON` and from the persisted form. `matches`
  follows XState `matchesState`; the port function `StateValue.matches` keeps its current
  behaviour and a new `matchesState` export carries XState semantics.
- **SD-7 Persisted-snapshot codec.** `getPersistedSnapshot` encodes through one Effect
  `Schema` codec in `src/persistence.ts`; restore decodes through the same codec (D8).
  `Option` fields use `Schema.OptionFromOptional` so `None` encodes as an absent key, as
  XState JSON omits `undefined`. An `undefined` output or error value is `Option.none()`
  everywhere (live and persisted), so `Some(undefined)` never exists and a round trip is
  lossless. Children persist as `{ snapshot, src, systemId,
  syncSnapshot }`, history as state-node ids, context actor refs (also nested in arrays and
  objects) as `{ xstate$$type: 1, id }`, tags as an array. Context the codec cannot encode
  fails with `SerializationError`. A persisted child whose `src` has no implementation is
  skipped at restore (upstream).
- **SD-8 `createActor` signature.** `createActor(logic, options?)` returns
  `Effect<Actor, never, Scope | RequirementsOf<logic>>`, so an Effect-based logic's
  requirements reach the caller (C10b). A root actor creates its own system, even when an
  `ActorSystemLive` layer is in scope (SD-25); children share the parent's system (XState).
  The initial snapshot is computed at creation; initial actions run at `start` (XState).
  The actor's lifetime is a child scope of the caller's `Scope`: closing it stops the
  actor and its children. `start`, `stop`, `send` return `Effect<void>`. `ActorSystemLive`
  stays exported for existing users.
- **SD-9 Session ids.** `sessionId` uses the XState format `x:<n>` per system, and `id`
  defaults to `sessionId`, so rewritten inspection expectations compare unchanged.
- **SD-10 Machine id.** `MachineConfig.id` becomes optional with the XState default
  `'(machine)'`.
- **SD-11 Name clashes at the root.** Root `stop` becomes the deprecated alias of
  `stopChild` (XState); `Snapshot.stop` stays reachable as `Snapshot.stop`. `ContextFrom` and
  `EventFrom` accept a machine, an actor, a logic or a setup return. The graph
  `getStateNodes` lives only in `./graph`; the root one follows `stateUtils`. Each move is a
  ledger row.
- **SD-12 Generic parameter order.** `fromPromise<TOutput, TInput, TEmitted>`,
  `fromCallback<TEvent, TInput, TEmitted>`, `fromObservable<TContext, TInput, TEmitted>`
  and `fromTransition<TContext, TEvent, TSystem, TInput, TEmitted>` follow upstream so the
  type-level files compile. `fromTransition`'s factory becomes `({ input, self }) => context`;
  `fromTransitionWithInput` stays as a port extra.
- **SD-13 Effect-returning pure APIs.** Anything that can run a user guard or action returns
  an Effect: `machine.transition`, `machine.microstep`, `machine.getTransitionData`,
  `snapshot.can`, `transition`, `initialTransition`, `getNextSnapshot`,
  `getInitialSnapshot`, `getMicrosteps`, `getInitialMicrosteps`, `getNextTransitions`, and
  the graph traversal functions. `machine.resolveState` stays synchronous (no user code).
  Amendment (2026-10-08, owner): `machine.resolveState` is an Effect now. It fails with
  `MachineDefinitionError` and the upstream message for a value that names no state (SD-3
  amendment of 2026-10-08; ledger row DEV-73).
- **SD-14 SCXML.** The SCXML runner uses the `@scion-scxml/test-framework` fixtures, located
  with `createRequire(import.meta.url).resolve('@scion-scxml/test-framework/package.json')`
  (no `pkg-up`). The converter needs `enqueueActions` (A11), `stateIn` (A16) and named
  delays (A4), so the SCXML gate (SCXML-1) closes task phase 4, not phase 3 as the input
  prose suggests (research finding 4).
- **SD-15 Phase moves.** S15 moves into phase 2 (31 upstream files use a single entry/exit
  action); P11 (`SimulatedClock` through the `clock` option) moves into phase 3 beside
  `after` (S20), because both drive the same scheduler; C3 (invoke `systemId`) moves into
  phase 5 beside C2, because it needs state `invoke`; phase-2 scenarios that need a child
  (C13, C19, A5, A10) use spawned children, not invoked ones. No row leaves the spec. D7's
  `sendTo`/`stopChild` by systemId goes beyond XState (which resolves strings against
  children only) and is a ledger row.
- **SD-16 `enqueue.log`.** Upstream 5.33.2 has no `enqueue.log`; the port follows upstream
  (`enqueue(log(...))`). Gap row A11's mention of `enqueue.log` is an inventory error,
  recorded in the ledger.
- **SD-17 Observable context.** `fromObservable` keeps `snapshot.context` as `Option`
  (project lint `no-undefined-use-option`); D8 covers only output and error, so this is a
  ledger deviation.
- **SD-18 Inspection observers.** `system.inspect(fn)` and the `inspect` actor option take a
  function; the observer-object form is not ported (D6 consequence), recorded in the ledger.
- **SD-19 `toPromise`.** `toEffect(actor)` succeeds with the snapshot output as stored
  (`Option<TOutput>`, D8) and fails with the actor's raw error; the Promise form `toPromise`
  stays exported for parity and resolves the same value. It is a pre-existing port test
  helper, not a facade over the core API that D6 rejected; a ledger row records the
  tension with D6.
- **SD-20 Existing port tests.** The 10 existing test files stay. Assertions that contradict
  an approved decision (fromPromise/fromEffect resolving inside `getInitialSnapshot` — D12;
  unknown named guards defaulting to true/false — S16; `enqueue('name')` as NoOp — A11; the
  symmetric `StateValue.matches` rule stays because `StateValue.matches` is kept) are
  rewritten by the task that changes the behaviour.
- **SD-21 Unhandled errors and listener errors.** A root actor with no parent and no error
  subscriber reports an unhandled error once through its logger (`Effect.logError` by
  default, replaceable through the `logger` option); upstream rethrows asynchronously
  through `reportUnhandledError`, which an Effect library must not do (ledger row).
  Errors thrown by `actor.on` listeners and inspection functions are reported the same way
  and never change the actor status (upstream `createActor.ts`). Rewrites replace
  `vi.mock(reportUnhandledError)` and happy-dom with a test logger.
- **SD-22 Scoped lint exceptions.** Lint warnings count as errors. These files get
  scoped `eslint.config.mjs` exceptions, each with a comment naming this decision, and no
  other file may: `src/internal/invariant.ts` (throw, SD-3); `src/stateUtils.ts` (native
  `Set`/`Map` and local array mutation inside the pure engine, for algorithmic fidelity to
  upstream `stateUtils.ts`); `src/testing/SimulatedClock.ts` (mutable timer
  table); `src/dev/index.ts` (`globalThis` access); `src/actors/index.ts`
  (`createEmptyActor`'s `undefined` context, C11); `src/graph/**` (native `Map`/`Set` and
  local mutation in the ported traversal code). CONF-8 checks that no other exception
  exists, apart from the existing relaxed blocks for tests and scripts and the timer ban
  for `test/upstream/`.
  - Amendment (2026-10-06): `src/internal/anyEventObject.ts`
    (`@typescript-eslint/no-explicit-any` for upstream's `AnyEventObject` index signature, the
    only `any` in `src`).
  - Amendment (2026-10-07): the same file also declares `UpstreamAny`, upstream's `any` for an
    untyped invocation (the input and event of `AnyActorLogic`, the done output and the
    snapshot of an invocation where any actor name is taken), the only other `any` in `src`.
  - Amendment (2026-10-07): `AnyActorRef`'s snapshot (its `getSnapshot`, `changes` and the
    `subscribe` observer) is also `UpstreamAny`, upstream's `ActorRef<any, any, any>`; no new
    declaration.
  - Amendment (2026-10-07): `MachineContext` (a root type) is `Record<string, UpstreamAny>`,
    upstream's `Record<string, any>`, and constrains `createMachine`'s context type; no new
    declaration.
  - Amendment (2026-10-07): `AnyStateNode.meta` and `AnyStateNodeDefinition` (root types, the
    `definition` of an `AnyStateNode`: `StateNode.Definition` of four `UpstreamAny`) are
    upstream's `StateNode<any, any, any, any>` metadata; no new declaration.
  - Amendment (2026-10-07): the containers of state nodes keep upstream's `any` meta:
    `StateNode.Any`'s state and transition meta, `AnyStateConfig`'s context, `Transitions`'
    transition meta, `HistoryStateNode`'s metas, and the node and transition meta of
    `getStateValue`, `normalizeTarget`, `formatTransitions` and `getDelayedTransitions`; no new
    declaration.
  - Amendment (2026-10-07): the transitions that `getCandidates` and `transitionNode`
    (`stateUtils`) give keep upstream's `any` meta, and `getCandidates` takes a node of
    `UpstreamAny` metas; no new declaration.
  - Amendment (2026-10-07): the transition of a graph `DirectedGraphEdge`
    (`src/graph/types.ts`) is upstream's `AnyTransitionDefinition`, a `TransitionDefinition` of
    three `UpstreamAny`, so its meta is upstream's `any`; no new declaration (T7.11).
  - Amendment (2026-10-08, owner): no `src` file gets a scoped exception for any rule of the
    canonical Effect bundle. Where upstream uses a native `Set`, a native `Map` or local array
    mutation, the engine (`src/stateUtils.ts`) and the graph code (`src/graph/**`) use Effect
    collections (`HashMap`, `HashSet`, `MutableHashMap`, `MutableHashSet`, `Chunk`) or ordered
    immutable arrays. The blocks for `src/internal/invariant.ts`, `src/stateUtils.ts` and the
    five graph traversal files are removed; `src/testing/SimulatedClock.ts`, `src/dev/index.ts`
    and `src/actors/index.ts` need none. The only scoped block left in `src` is
    `@typescript-eslint/no-explicit-any` in `src/internal/anyEventObject.ts` (the amendments
    above), a rule outside the canonical bundle. CONF-8 checks that every `src` file resolves
    each rule of the canonical bundle at error. Ledger rows DEV-69 to DEV-71.
- **SD-23 Send semantics.** An external `actor.send(event)` completes after that event's
  macrostep commits (or after the event is dropped), so a test can read `getSnapshot`
  right after `send` (upstream processes synchronously). Sends made from inside an actor —
  `sendTo`, `sendParent`, `raise` with a delay, scheduler deliveries, `sendBack` — and any
  send made while the caller runs inside that actor's own processing or callbacks
  (subscribe callbacks, `actor.on` listeners, inspection functions, Effects returned by
  inline actions) enqueue without waiting, so nothing ever deadlocks (CONC-2, CONC-3); a
  fiber-local marker tells the two cases apart. An awaited send also completes when its
  macrostep sets status `error` or `done`, or when stop drops the event. Events sent before
  `start` are queued and processed at `start` (C23). `start` on a stopped, done or errored
  actor changes nothing.
- **SD-24 Subscription emission.** `actor.subscribe(fn)` follows XState: `fn` receives each
  published snapshot after subscription and nothing at subscription time (C16b). The port's
  `changes` stream keeps its documented "current, then each change" semantics; tests that
  count snapshots use `subscribe`.
- **SD-25 One system per root actor.** Each root actor owns its registry, scheduler and
  inspection observers; the v4 shared layer memo map never shares a system between root
  actors (SVC-06, C20b).
- **SD-26 Snapshot integrity.** No inline snapshot in a rewrite may be empty; each inline
  snapshot and each entry of the graph snapshot file equals the upstream text or has a
  ledger row naming the difference (for example `Option` fields, D8). Vitest stores file
  snapshots beside the file it runs, so the graph snapshots live in
  `test/verify/__snapshots__/verify-xstate-5-33-2-port-CONF-7.spec.ts.snap`, written once by
  the CONF-7 import task of `graph` (D1) and committed; every other run uses `CI=true`. The
  manifest stores the upstream snapshot entries for comparison (SNAP-1).
- **SD-27 Children of an actor that errors.** When an actor enters status `error` — through
  a throw in its own code or an unhandled child error event — its scope closes, so its
  spawned and invoked children stop and no fiber or timer of it stays alive (D12). Upstream
  stops children only when a macrostep ends non-active and leaves them running on the throw
  path (its own TODO notes possible orphans); that difference is a ledger row (C19b).
  A spawn resolved inside a macrostep that then errors never starts and leaves no systemId
  behind (A9b).
- **SD-28 SimulatedClock as Effects.** The exported `SimulatedClock` class keeps upstream's
  method names, but `increment(ms)` and `set(ms)` return Effects: they fire due timers one at
  a time in deadline order (ties in the upstream order) and wait for each delivered event's
  macrostep before firing the next, so a timer scheduled during the increment and due
  within it fires in the same increment (P11c). `set` to an earlier time fails its Effect
  with the recorded message. Rewrites use `yield* clock.increment(n)` (ledger row for the
  sync-to-Effect change). The port's existing synchronous `makeSimulatedClock` factory stays
  as a port extra (COMPAT-4). `waitFor` timeouts run on the Effect clock, not the
  SimulatedClock, as upstream uses the global timer.

## Task-phase plan (SD-2)

The schedule that SD-2 and the ledger's *Rewrite phase* and *Green phase* columns refer to.
Task phase n is input Phase n, plus task phase 1 for the conformance harness.

| Task phase | Input phase | Gap rows (scenarios) |
|---|---|---|
| T1 | — (harness) | HARNESS-1, HARNESS-2, LEDGER-1 (structure) |
| T2 | Phase 2 runtime foundation, F1–F8 | A9b, C19b, CONC-3, S10b, C1, C6, C7, C8, C9, C10, C10b, C12, C13, C13b, C14, C15, C16b, C19, C20, C20b, C23, C24, S1, S2, S3, S6, S7, S8, S9, S10, S11, S12, S13, S14, S15, S19, S21, S24, A2, A3, A5, A6, A9, A10, A12, A13, A14, A15, A17, P1, P2, P3, EVT-1, ERR-1, ERR-2, CONC-1, CONC-2 |
| T3 | Phase 3 statechart semantics | S4, S5, S16, S17, S18, S20, S22, S23, S25, S26, S27, P11, P11b, P11c |
| T4 | Phase 4 actions, guards, setup | A1, A4, A7, A8, A11, A16, A18, A19, A20, A21, A22, A23, COMPAT-3, SCXML-1 |
| T5 | Phase 5 actors, invoke, system | C2, C3, C4, C5, C5b, C11, C16, C17, C18, C21, C22 |
| T6 | Phase 6 persistence, inspection, pure functions, helpers | P4, P5, P6, P7, P8, P9, P10, P12 |
| T7 | Phase 7 graph and dev tools | P13, P14, DELIVERY-1, DELIVERY-2 |
| T8 | Phase 8 conformance | EXP-1, API-1, API-2, INV-1, SNAP-1, COMPAT-1, COMPAT-2, COMPAT-4, BASELINE-1, LEDGER-1, BUILD-1..4 |

Upstream rewrite schedule (PARITY) and full-pass schedule (CONF), from research §3a with
SD-14/SD-15 applied and `actor` moved to phase 6 (it uses `waitFor`, P9):

| Phase | Rewritten in this phase (PARITY-n) | Must pass fully at the end of this phase (CONF-n) |
|---|---|---|
| 2 | actions, actor, actorLogic, deep, deterministic, emit, errors, event, final, guards, history, id, initial, internalTransitions, interpreter, invoke, multiple, order, parallel, predictableExec, rehydration, spawnChild, system, transient, examples/6.16, examples/6.17, examples/6.6, examples/6.8, examples/6.9, examples/cd (30) | deep, initial, multiple (3) |
| 3 | after, clock, definition, eventDescriptors, invalid, json, machine, mapState, match, meta, microstep, resolve, route, state, tags (15) | definition, id, invalid, json, mapState, match, order, resolve, route, state, tags, examples/6.17, examples/6.6, examples/6.8, examples/6.9, examples/cd (16) |
| 4 | assert, assign, input, scxml, setup.types, spawn, spawn.types, stateIn, types (9) | assert, assign, eventDescriptors, guards, internalTransitions, machine, parallel, scxml, spawn, spawnChild, stateIn, examples/6.16 (12) |
| 5 | activities, inspect, logger, select (4) | actions, activities, clock, emit, errors, event, final, history, input, interpreter, invoke, logger, meta, predictableExec, select, setup.types, system, transient (18) |
| 6 | getNextSnapshot, issue5454, toPromise, transition, waitFor (5) | actor, actorLogic, after, deterministic, getNextSnapshot, inspect, issue5454, microstep, rehydration, spawn.types, toPromise, transition, types, waitFor (14) |
| 7 | graph/adjacency, graph/dieHard, graph/events, graph/forbiddenAttributes, graph/graph, graph/index, graph/paths, graph/shortestPaths, graph/states, graph/testModel (10) | the same 10 graph files |
| 8 | typeHelpers (1) | typeHelpers; CONF-8 also checks that all 74 files are imported exactly once |

Upstream counts: 74 files, 1,427 call sites, 1,744 tests that run (317 generated), 13
`it.skip` and 1 `it.todo` upstream. A rewrite keeps every generator (`testAll`,
`testMultiTransition`, the `invoke` promise loop, the `dieHard` path loops, the SCXML
group table), or the counts fall. Upstream-skipped tests are "not ported" rows, because
the port allows no skipped tests (D19).
