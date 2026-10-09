/**
 * CONF-5: the upstream files green at phase 5 pass (SD-1, SD-2).
 *
 * The file imports each rewrite whose ledger green phase is 5 inside its own describe block
 * titled `upstream/<name>.test.ts`, so every upstream test of the file runs once, inside the
 * default run, and its evidence routes to CONF-5. `conformancePhase` (`conformance.ts`)
 * keeps the blocks and its checks in declaration order, also under `--sequence.shuffle`:
 *
 * - the graduation check: each imported rewrite has left `pending.json` and the green
 *   type-check exclude (one commit, SD-1), and the ledger marks it `passes`;
 * - the import check: the file imports exactly actions, activities, clock, emit, errors,
 *   event, final, history, input, interpreter, invoke, logger, meta, predictableExec, select,
 *   setup.types, system and transient (the ledger's green-phase 5 files), and no other CONF
 *   evidence file imports one of them;
 * - the count check, last: per file, `passed >= runnable - notPortedRunnable` and
 *   `passed >= 1`, no skipped test, and no test still to run (669 runnable upstream tests, a
 *   floor of 662).
 *
 * T5.13 to T5.30 imported the 18 files one block at a time under the graduation check
 * alone; T5.31 switched to `conformancePhase`. The describe block "the CONF-5 suite and its
 * count floor" pins the order of the checks and the count data of phase 5.
 *
 * actions.test.ts runs entry, exit and transition actions in XState order, stops actors from
 * inside their own actions, and uses every built-in action: `raise` (also delayed, by id, and
 * a string event, which is an error), `sendTo` (by id, by reference, delayed, to a stopped
 * child, a string event), `sendParent`, `forwardTo`, `cancel`, `log`, `stopChild`,
 * `spawnChild`, `emit`, `assign` and `enqueueActions` with every `enqueue` member, with
 * params, in `setup` records and inline; it reads warnings through a test logger (upstream: a
 * `console.warn` spy; SD-21). The scenario evidence pins most of it: S11, S12, S13 and S14
 * the targetless, reentering, ordered and initial actions; A3 a raised event before the next
 * external one; A4 and A18 named delays (A4 also sendTo's `implementations` option, DEV-32);
 * A5 sendTo by id and systemId; A6 emit after the transition; A8 log; A9 spawnChild; A10
 * stopChild; A11 enqueueActions; A12 per-use params; A13 inline functions and plain
 * functions in setup and provide; C13 a stop from inside an action; C14 the warning for an
 * event sent to a stopped child. Two of its inline snapshots print the stopped child's
 * session id as the port numbers it, per system (SD-9, ledger "Tests not ported").
 *
 * activities.test.ts checks which state invocations (upstream's former "activities") run: the
 * initial ones at the root, in a child and deep down; the ones a transition starts and stops,
 * for child and parent states; the ones kept across an ignored event, a blocked `always` and
 * a transition inside the invoking state; a new actor when an invoking state is left and
 * entered again or reentered by a self transition; and none after automatic transitions leave
 * the state. Gap row C2 (with invoke) names its stop test. It needed no change beyond its
 * graduation.
 *
 * clock.test.ts passes a `SimulatedClock` as the root's `clock` option and checks that an
 * invoked child's `after` timer runs on it: the child is still in its first state until
 * `clock.increment` fires the timer (an Effect, SD-28, DEV-27). Gap row P11 names its test;
 * C22 (with logger) names it too.
 *
 * emit.test.ts emits events from a machine's `emit` and `enqueue.emit` (static and from the
 * context), from promise, transition, observable, event observable and callback logic, and
 * from a callback invoked by a restored root, to `actor.on` listeners of one type and to `'*'`
 * listeners; a setup's `types.emitted` limits the events `emit` and `enqueue.emit` take
 * (`@ts-expect-error`); a listener reads the snapshot the emitting transition committed; a
 * listener that throws is reported through a test logger and the actor stays active (upstream:
 * a `reportUnhandledError` mock; SD-21). Gap rows A6 and A7 name its tests.
 *
 * errors.test.ts checks where an error goes: a subscriber that throws neither loops, crashes
 * the actor nor reaches its error consumers; a child that throws at start, a promise that
 * rejects and a child whose initial snapshot is an error, unhandled, error the parent (and
 * its parent) with the original error, and are reported once when no error consumer is there;
 * handled with `onError`, they report nothing and leave the parent running; a throwing entry
 * action (custom, or a built-in assigner at creation) and a throwing guard error the actor
 * with the original error or the guard-evaluation message, and the entry actions after the
 * throwing one never run; a throwing `on` listener leaves the actor active. Upstream reads
 * errors with observer-object subscribers and a global handler; the rewrite drains `changes`
 * streams (D6) and reads a test logger (SD-21). Five upstream tests of observer objects
 * without an error callback are "Tests not ported" rows (D6, DEV-3). Gap rows S24, A17 and C19
 * name its tests.
 *
 * event.test.ts checks two things about events. A parent's entry action sends its own `self`
 * inside an event to an invoked child, and the child replies to that sender with a delayed
 * `sendTo`, so the parent completes (the rewrite advances the TestClock until it does; SD-19,
 * SD-23). A nested state's targetless transition takes an event before its parent's
 * transition for the same event, so the actor stays in the nested state and the action
 * assigns the context. It needed no change beyond its graduation. Gap rows S11 (with actions,
 * internalTransitions and scxml) and A5 (with actions and system) list it as a closing file.
 *
 * final.test.ts completes machines and states: a final root is done at once; a compound
 * parent's `xstate.done.state.*` event carries its final child's output (resolved with the
 * context the final state's entry actions left), a parallel parent's carries none
 * (`Option.none()`, D8, SD-5), and a parallel ancestor completes once, when every region is
 * final; the root `output` mapper reads the done event that completes the machine and `self`;
 * a completed machine runs the exit actions of every active node in reverse document order,
 * while a nested final or a final region does not complete it; an invoked child's events
 * from its final entry and root exit reach the parent before its `xstate.done.actor.*` event.
 * Five of its inline snapshots print `Option.none()` where upstream prints `undefined` (D8,
 * SD-5, SD-26; ledger "Tests not ported"). It needed the output and `onDone` types below and
 * a rewrite fix (`children.child!`, `noUncheckedIndexedAccess`). Gap rows S4, S5, S6 and S7
 * name its tests.
 *
 * history.test.ts enters history states: shallow (`history: 'shallow'` or no kind) and deep
 * history go to the most recently visited configuration, also after a transient transition,
 * a reentering transition and several stages; with no history recorded they go to the
 * default target or the parent's initial state, and run the initial transition's actions
 * only when no default target is set; parallel history re-enters each region, partly or
 * fully recorded; an invocation of the stored configuration starts again; ancestors outside
 * the transition domain are not entered. A restored snapshot revives `{ id }` history
 * entries, keeps a `StateNode` entry, and drops an unknown id with upstream's warning
 * through a test logger (SD-21). It needed one rewrite fix (`historyValue[...]!`,
 * `noUncheckedIndexedAccess`). Gap row S8 (with scxml, examples/6.8 and examples/6.9) lists
 * it as a closing file.
 *
 * input.test.ts gives actors their input: a machine's context factory reads the `input` of
 * `createActor`, and the initial event carries it as `event.input`; a machine that declares
 * an input and gets none is a type error and errors at creation, its snapshot still a machine
 * snapshot (`matches`); a machine that declares none starts without one; an invoked or
 * spawned machine gets a static input, an input mapper of the parent's context, and the
 * parent as `self` in the mapper; promise, transition, observable and callback logic get
 * theirs. It needed no change beyond its graduation. Gap row A22 (with types) names its test.
 *
 * interpreter.test.ts drives actors through their life: the snapshot before and after `start`
 * (also from a restored or a custom initial state, without running the actions of the
 * snapshot read before start), events sent before start, as objects, with a payload and many
 * at once, a delayed `raise` (an expression delay, `cancel` by id, a `SimulatedClock`), `log`,
 * `sendParent`, invocations started and stopped by transitions and by `stop`, transient
 * states, `subscribe` and the `changes` stream (ended by a final state and by `stop`, failed by
 * an error even for a late subscriber), the children a snapshot references, and the warning
 * for an event sent to a stopped actor (through a test logger, SD-21). An invalid `initial`
 * key errors the actor at creation with upstream's plain `Error`, and a string event given to
 * `send` dies with upstream's message (SD-3). Two of its inline snapshots print the stopped
 * root's session id as the port numbers it, per system (SD-9, ledger "Tests not ported"); the
 * RxJS interop test is a `missing` row (D6, DEV-3). It needed two rewrite fixes
 * (`childActor!`, `noUncheckedIndexedAccess`; an `Effect<void>` entry return type against a
 * circular inference). Gap rows C1, C14, C15 and C16 name its tests; C13 (with actions) lists
 * it as a closing file.
 *
 * invoke.test.ts invokes child machines, promises, callbacks, observables, event observables,
 * custom actor logic and transition functions from the root and from state nodes: a child
 * machine that its parent sends to, that sends back, and whose final state and output reach
 * the parent's `onDone` (an `Option`, D8); invocations in orthogonal and nested states and a
 * service replaced by `.provide(...)`; promises that resolve through `onDone` and reject
 * through `onError`; callbacks that send back, receive from the parent, are disposed when their
 * state exits and error through `onError`; observables whose values reach `onSnapshot`;
 * several services started at once, none started when a microstep leaves its state at once;
 * generated invoke ids, invoke `input`, the done-event names, and restarts on re-entry.
 * Upstream's host timers run on the Effect clock, and deliveries between actors are awaited
 * with bounded yields (SD-23). It needed the root `ActorLogic` type, `AnyActorRef` parent
 * references, upstream's `any` for an invocation of a machine without typed actors (SD-22
 * amendment 2026-10-07), and two rewrite fixes (custom logic snapshots from `Snapshot.active()`
 * with the snapshot type as a type argument; `TransitionActorScope` for a reducer's scope).
 * One test is a `missing` row: a child stopped by its parent while it re-enters an invoking
 * state starts that invocation before the parent completes (SD-23, DEV-23). Gap rows C4 and C7
 * name its tests; C2 (with activities) lists it as a closing file.
 *
 * logger.test.ts passes a `logger` function as the root's option and checks that the entry
 * `log('hello')` of an invoked and of a spawned child machine calls it, once: the root's
 * logger is the default logger of every actor in its system (upstream `system._logger`). Both
 * children log before the root's `start` returns, as upstream. It needed no change beyond its
 * graduation and a corrected comment in the rewrite. Gap row C22 (with clock) lists it as a
 * closing file.
 *
 * meta.test.ts reads the meta of states and transitions: a snapshot's `getMeta()` gives the
 * meta of each active node that has one, by state id, also for nested states and for a
 * snapshot that `resolveState` gave; a `setup` machine types it by `types.meta` and keys it by
 * the machine's state ids (upstream `StateId`: a node's own `id`, else the key path after the
 * root's id), so another meta type or an id the machine does not have is a type error;
 * `types.transitionMeta` types the meta of every transition, separately from the state meta,
 * with `setup` and with `createMachine({ types })`; the meta of `on`, `always`, `after`,
 * `initial` (also in the definition and the JSON form) and the invocations' `onDone`,
 * `onError` and `onSnapshot` transitions is kept at run time, and so is a transition's
 * `description`; a node's own `description` and `meta` are the config values. It needed a node's `description` and `meta` plain and its
 * `initial` as upstream's initial transition definition (the DEV-28 text), the invocations'
 * `onDone`, `onError` and `onSnapshot` as the config writes them, `getMeta` keyed by state
 * id, and one rewrite fix (`!` on 14 index reads, `noUncheckedIndexedAccess`). Gap row S27
 * names its test; S23 (with match, state and tags) lists it as a closing file.
 *
 * predictableExec.test.ts checks that actions run in a predictable order and with the right
 * data: custom and built-in actions in definition order, initial custom actions at `start`
 * and initial assigns before it, a raised event given to the actions and the invoke creator
 * it reaches, an invoked child on the new snapshot and gone after its state is left, the
 * intermediate context between assigns, a parent guard that reads a child's updated
 * snapshot, an invocation created from the context its state's entry assigned, and events
 * sent from entry and exit actions to a child invoked in the same state (also at start,
 * where the child replies). A send from inside an actor enqueues without waiting, so the
 * rewrite waits with bounded yields for the replies (SD-23, DEV-23). It needed the root
 * `AnyActor` type, `toEffect` and `toPromise` of any actor's snapshot stream, and two rewrite
 * fixes (`children!.myChild!`; the bounded waits). Gap rows S14 and A3 (with actions) list it
 * as a closing file.
 *
 * select.test.ts derives values from an actor's snapshot with `actor.select`: `get` gives the
 * selected value of the live snapshot, before and after an event; `subscribe` gives nothing at
 * subscription time, then each selected value that differs from the last one given, by
 * `Object.is` or by a custom equality function, so an event that keeps the value notifies no
 * subscriber; two selections of one actor each get only their own changes; and a
 * subscription whose scope has closed gets nothing (upstream `unsubscribe`, DEV-4). `get` is
 * an Effect and `subscribe` is scoped (D6, DEV-34). A subscriber runs in its own fiber, so the
 * rewrite yields with bounded waits before it counts calls. It needed no change beyond its
 * graduation. Gap row C17 names its test.
 *
 * setup.types.test.ts is type level (D1): the test type-check proves it, and its 156 tests
 * also run. A setup's names check every built-in written in its machine config and in its own
 * `actions`, `guards` and `extend` records (an unknown action, guard, delay, actor, emitted
 * event or raised event is a type error); `types.children` types the snapshot's children by
 * the setup's actors; an invocation's `input` is of the invoked actor's input type; a setup
 * machine's snapshot types `value`, `matches` and the `getMeta` keys by the config's states and
 * ids; `ContextFrom` and `EventFrom` read a machine; the bound helpers carry the setup's types.
 * One of its errors sits one line above upstream's directive (an unknown action object at
 * `entry:`, DEV-35, D15), and two unknown `after` delays are errors that upstream's TypeScript
 * issue 55709 hides (DEV-36). As upstream, a setup without actors takes no invocation, so an
 * invoke object there is an error at its `src`. Gap row A19 names its test; A18 (with types)
 * names one too.
 *
 * system.test.ts registers actors under a `systemId`: invoked and spawned actors (found from
 * a sibling's entry action and from a spawned machine), a root given the option, at once at
 * creation and before `start`; an invoked or spawned actor leaves the registry when it stops,
 * also a parent's nested children; a second actor under a `systemId` in use errors the actor
 * with upstream's message; a reentering transition registers the new invocation; the system
 * is read in inline and named custom actions, assigners, `sendTo` and `stopChild` targets,
 * and in promise, transition, observable, event observable and callback logic; `getAll`
 * gives the registered actors; an initial entry `sendTo` of a child to its root, found by
 * `systemId`, is processed before the root's `start` returns. `system.get` and `getAll` are
 * Effects of an `Option` and a record (D7, DEV-6), read synchronously with `Effect.runSync`
 * where upstream's callback returns data. It needed `start` to process its mailbox before it
 * returns, the root `ActorSystem<T>` and `ActorSystemInfo` types, an `AnyActorRef` from
 * `system.get` without a type argument, `ActorRefFrom` of `AnyStateMachine`, and a `stopChild`
 * target function that may give `undefined`. Gap rows C3, C12 and C20 name its tests; A5
 * (with actions and event) lists it as a closing file.
 *
 * transient.test.ts takes eventless (`always`) transitions: the first candidate whose guard
 * passes, else the last one without a guard, with the actions of every transition in the
 * step; raised events one after the other and eventless transitions in the same microstep,
 * checked again after each microstep and before a raised event; a resolved initial state
 * from a transient initial state, also on the root and in an invoked machine whose guard
 * reads its input; no wildcard for an eventless transition; the event that started the
 * step kept in later guards and actions; and `maxIterations`, which errors the actor with
 * upstream's "Infinite loop detected" message (its `start` succeeds, status `error`, and the
 * `changes` stream fails with it; SD-4) while a fallback or guarded target, a
 * fire-and-forget action and a bounded assign loop end. It needed one rewrite fix (two
 * `expect.assertions` counts). Gap row S21 names its test; S19 (with scxml) lists it as a
 * closing file.
 *
 * The describe blocks after the imports pin what actions.test.ts, clock.test.ts, emit.test.ts,
 * errors.test.ts, final.test.ts, interpreter.test.ts, invoke.test.ts, meta.test.ts,
 * predictableExec.test.ts, setup.types.test.ts and system.test.ts needed beyond their
 * evidence: the
 * warning a built-in action creator logs when a custom action calls it (upstream
 * `executingCustomAction`); the root
 * `ActorRef`, `Snapshot`, `AnyActorRef` and `ActorRefFromLogic` types; a machine written inline
 * as an invocation's src, which keeps the event type of its own config; the events `sendTo`
 * takes for its target (upstream `EventFrom` of the target, a string for a name or an untyped
 * target); the machine snapshot an action's `self` gives; the children of a machine snapshot,
 * which are `AnyActorRef` by id (upstream `ToChildren` without typed actors), whose snapshot
 * gives a machine's `value` and `context` as `unknown`, and whose `changes` stream fails with
 * the child's error (upstream `subscribe({ error })`); the emitted events a setup declares,
 * which `emit`, `enqueue.emit` and the setup's own `emit` take, and an `AnyActorRef`'s `on`;
 * the order upstream's `emit` calls its listeners in: one at a time, the event type's listeners
 * and then the `'*'` ones, each in the order they were added, and an emit a listener makes
 * delivered inside that listener (depth first); the types an output mapper and `onDone` read
 * (upstream `Mapper` of `DoneStateEvent` for the root output and `onDone`, `self` on the
 * machine's events); upstream's deprecation warning for an output object whose values are
 * functions, which stays the output as it is; the two errors interpreter.test.ts reads as
 * upstream's plain `Error`: an invalid `initial` key's `InitializationError` (named `Error`,
 * `_tag` kept) and the defect of a string event given to `send`, with upstream's message, on a
 * running and on a stopped actor, before the event reaches it; the root `ActorLogic` type and
 * an actor's parent reference, an `AnyActorRef` (upstream `_parent`); upstream's `any` for an
 * invocation of a machine without typed actors: inline logic's input and received events, the
 * done output, the snapshot and the error event its result transitions read; and the order in
 * which a child stopped by its parent while it re-enters an invoking state starts that
 * invocation (SD-23: before the parent completes, upstream after; twice in both); every
 * state node's initial transition definition (upstream `StateNode.initial`; no target for a
 * key that names no child, where upstream's getter throws, SD-3); a `null` node meta in
 * `getMeta`; `getMeta` keyed by the state ids of a `setup` machine, whose snapshot is
 * still a `MachineSnapshot` of any schema, and by any string without `setup`; and the root
 * `AnyActor` type (upstream `Actor<any>`), which every actor fits and whose snapshot gives a
 * machine's `value`, `context` and `children`, with `toEffect` and `toPromise` of it; the
 * events the setup-bound `sendTo` and `enqueue.sendTo` take for their target (upstream
 * `sendTo<TTargetActor>`), as the free `sendTo` does; the events `start` processes before it
 * returns (upstream `mailbox.start()`): those sent before `start`, those a child's initial
 * entry sends to its root, and none after one that ends the actor; and the system types
 * system.test.ts reads: `ActorSystem<T>` typed by its declared actors, `system.get` without a
 * type argument as an `AnyActorRef`, `ActorRefFrom` of `AnyStateMachine` and `AnyActorLogic`
 * as an `AnyActorRef`, and a `stopChild` target function that gives `undefined` and stops
 * nothing; `stopChild` of an actor that is not a child (upstream `executeStop`): it gives its
 * systemId up first, and the error comes inside the transition for an actor that has not
 * started and after the commit for a running one; and `spawn` with a src that names no actor,
 * whose error comes after the assigner returns (SD-3, DEV-37).
 */
import { assert, describe, it } from "@effect/vitest"
import { Cause, Effect, Exit, Fiber, Logger, Option, type Scope, Stream } from "effect"
import { TestClock } from "effect/testing"
import type { ActorRefBase } from "../../src/ActorRef.js"
import type { UpstreamAny } from "../../src/internal/anyEventObject.js"
import { InitializationError } from "../../src/Errors.js"
import {
  type ActorLogic,
  ActorLogic as ActorLogicModule,
  type ActorLogicType,
  ActorScope,
  type ActorRef,
  ActorRef as ActorRefModule,
  type ActorRefFrom,
  type ActorRefFromLogic,
  type ActorSystem,
  type ActorSystemInfo,
  type AnyActor,
  type AnyActorLogic,
  type AnyActorRef,
  type AnyEventObject,
  type AnyStateMachine,
  assign,
  type DoneStateEvent,
  cancel,
  createActor,
  createEmptyActor,
  createMachine,
  emit,
  enqueueActions,
  type EventObject,
  forwardTo,
  fromCallback,
  fromPromise,
  fromTransition,
  getInitialSnapshot,
  getNextSnapshot,
  log,
  type MachineSnapshot,
  makeActorLogic,
  raise,
  sendParent,
  sendTo,
  setup,
  type Snapshot,
  Snapshot as SnapshotModule,
  spawnChild,
  SpecialTargets,
  stopChild,
  toEffect,
  toPromise
} from "../../src/index.js"
import { conformancePhase, greenFiles, requiredPassed, upstreamFileOptions } from "./conformance.js"
import { shortName } from "./ledger.js"
import { readLedger, readManifest } from "./parity.js"
import {
  actorLogicNotImplemented,
  builtInCalledInCustomAction,
  dynamicMappingDeprecated,
  initialStateNotFound,
  notAChild,
  onlyEventObjectsSend,
  onlyEventObjectsSendTo
} from "./upstream-messages.js"

// ---------------------------------------------------------------- the imported files

conformancePhase(5, () => {
  describe("upstream/actions.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/actions.test.js")
  })
  describe("upstream/activities.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/activities.test.js")
  })
  describe("upstream/clock.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/clock.test.js")
  })
  describe("upstream/emit.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/emit.test.js")
  })
  describe("upstream/errors.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/errors.test.js")
  })
  describe("upstream/event.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/event.test.js")
  })
  describe("upstream/final.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/final.test.js")
  })
  describe("upstream/history.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/history.test.js")
  })
  describe("upstream/input.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/input.test.js")
  })
  describe("upstream/interpreter.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/interpreter.test.js")
  })
  describe("upstream/invoke.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/invoke.test.js")
  })
  describe("upstream/logger.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/logger.test.js")
  })
  describe("upstream/meta.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/meta.test.js")
  })
  describe("upstream/predictableExec.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/predictableExec.test.js")
  })
  describe("upstream/select.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/select.test.js")
  })
  describe("upstream/setup.types.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/setup.types.test.js")
  })
  describe("upstream/system.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/system.test.js")
  })
  describe("upstream/transient.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/transient.test.js")
  })
})

// ---------------------------------------------------------------- the shape of the suite and its count floor

const SUITE_TITLE = "[CONF-5] upstream files green at phase 5"

/** The upstream files green at phase 5, in the order of the ledger and of the imported blocks. */
const PHASE_5_FILES = [
  "actions",
  "activities",
  "clock",
  "emit",
  "errors",
  "event",
  "final",
  "history",
  "input",
  "interpreter",
  "invoke",
  "logger",
  "meta",
  "predictableExec",
  "select",
  "setup.types",
  "system",
  "transient"
] as const

describe("[CONF-5] the CONF-5 suite and its count floor", () => {
  it("[CONF-5] the suite imports the 18 files green at phase 5, then runs the graduation, import and count checks, the count check last, and never shuffles its own children", ({ task }) => {
    const suite = task.file.tasks.find((child) => child.name === SUITE_TITLE)
    assert.strictEqual(suite?.type, "suite")
    const children = suite?.type === "suite" ? suite.tasks : []
    assert.deepStrictEqual(children.map((child) => [child.type, child.name]), [
      ...PHASE_5_FILES.map((name) => ["suite", `upstream/${name}.test.ts`]),
      ["test", "[CONF-5] each imported rewrite has left pending.json and the green type-check exclude, and the ledger marks it passes"],
      ["test", "[CONF-5] the evidence file imports exactly the upstream files green at phase 5, and no other CONF evidence file imports them"],
      ["test", "[CONF-5] every imported file meets its count"]
    ])
    assert.strictEqual(suite?.type === "suite" ? suite.shuffle : undefined, false)
  })

  it.effect("[CONF-5] the files green at phase 5 have 669 runnable upstream tests and a floor of 662 passed: only the 7 runnable missing rows of errors, interpreter and invoke lower it", () =>
    Effect.sync(() => {
      const { ledger, problems } = readLedger()
      assert.deepStrictEqual(problems, [])
      const manifest = readManifest()
      // [name, runnable, upstream skip + todo, "Tests not ported" rows, required passed]
      const floors = greenFiles(ledger.files, 5).map((row) => {
        const name = row["Name"] ?? ""
        const upstream = manifest.files.find((file) => shortName(file.path) === name)
        if (upstream === undefined) return [name]
        const rows = ledger.notPorted.filter((notPorted) => notPorted["File"] === upstream.path).length
        return [name, upstream.runnable, upstream.skip + upstream.todo, rows, requiredPassed(upstream, ledger.notPorted)]
      })
      // actions: 2 rows for its upstream skipped and todo tests (not runnable) and 2 inline-snapshot
      // rows (the tests run); final: 5 inline-snapshot rows; interpreter: 2 inline-snapshot rows
      // and 1 missing row; errors: 5 missing rows; invoke: 1 missing row (SD-23).
      assert.deepStrictEqual(floors, [
        ["actions", 134, 2, 4, 134],
        ["activities", 13, 0, 0, 13],
        ["clock", 1, 0, 0, 1],
        ["emit", 14, 0, 0, 14],
        ["errors", 26, 0, 5, 21],
        ["event", 2, 0, 0, 2],
        ["final", 33, 0, 5, 33],
        ["history", 35, 0, 0, 35],
        ["input", 15, 0, 0, 15],
        ["interpreter", 58, 0, 3, 57],
        ["invoke", 90, 0, 1, 89],
        ["logger", 2, 0, 0, 2],
        ["meta", 21, 0, 0, 21],
        ["predictableExec", 17, 0, 0, 17],
        ["select", 6, 0, 0, 6],
        ["setup.types", 156, 0, 0, 156],
        ["system", 22, 0, 0, 22],
        ["transient", 24, 0, 0, 24]
      ])
      assert.deepStrictEqual(floors.map((floor) => floor[0]), [...PHASE_5_FILES])
      assert.strictEqual(floors.reduce((total, floor) => total + Number(floor[1]), 0), 669)
      assert.strictEqual(floors.reduce((total, floor) => total + Number(floor[4]), 0), 662)
    }))
})

// ---------------------------------------------------------------- built-in action creators called inside a custom action

/** Runs `body` with a logger that keeps the text of each warning, and gives those texts. */
const warningsOf = <E>(body: Effect.Effect<unknown, E, Scope.Scope>) =>
  Effect.suspend(() => {
    const warnings: Array<unknown> = []
    const logger = Logger.make((options) => {
      if (options.logLevel === "Warn") {
        warnings.push(...(Array.isArray(options.message) ? options.message : [options.message]))
      }
    })
    return body.pipe(Effect.provide(Logger.layer([logger])), Effect.as(warnings))
  })

describe("[CONF-5] a built-in action creator called inside a custom action", () => {
  it.effect("[CONF-5] assign, raise, sendTo and emit called in an inline custom action, a named implementation or an enqueued custom action log upstream's warning once per call, in call order", () =>
    Effect.gen(function* () {
      const machine = createMachine(
        {
          entry: [
            () => {
              raise({ type: "a" })
              raise({ type: "b" })
            },
            () => {
              assign({})
            },
            "named",
            enqueueActions(({ enqueue }) => {
              enqueue(() => {
                sendTo("nobody", { type: "c" })
              })
            })
          ]
        },
        {
          actions: {
            named: () => {
              emit({ type: "d" })
            }
          }
        }
      )
      const warnings = yield* warningsOf(Effect.tap(createActor(machine), (actor) => actor.start))
      assert.deepStrictEqual(warnings, [
        builtInCalledInCustomAction("raise"),
        builtInCalledInCustomAction("raise"),
        builtInCalledInCustomAction("assign"),
        builtInCalledInCustomAction("emit"),
        builtInCalledInCustomAction("sendTo")
      ])
    }))

  it.effect("[CONF-5] sendParent and forwardTo in a custom action warn as sendTo, as upstream builds both with sendTo; log, cancel, stopChild, spawnChild and enqueueActions do not warn", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        entry: () => {
          sendParent({ type: "a" })
          forwardTo("nobody")
          log("text")
          cancel("id")
          stopChild("nobody")
          spawnChild("nobody")
          enqueueActions(() => {})
        }
      })
      const warnings = yield* warningsOf(Effect.tap(createActor(machine), (actor) => actor.start))
      assert.deepStrictEqual(warnings, [builtInCalledInCustomAction("sendTo"), builtInCalledInCustomAction("sendTo")])
    }))

  it.effect("[CONF-5] no warning where no custom action runs: in an enqueueActions callback, in an assigner, in a guard, and outside every actor", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        context: { count: 0 },
        entry: [
          enqueueActions(() => {
            assign({})
            raise({ type: "a" })
          }),
          assign(({ context }) => {
            emit({ type: "b" })
            return { count: context.count + 1 }
          })
        ],
        on: {
          GO: {
            guard: () => {
              sendTo("nobody", { type: "c" })
              return true
            }
          }
        }
      })
      const warnings = yield* warningsOf(
        Effect.gen(function* () {
          assign({})
          const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
          yield* actor.send({ type: "GO" })
          assert.strictEqual((yield* actor.getSnapshot).context.count, 1)
        })
      )
      assert.deepStrictEqual(warnings, [])
    }))

  it.effect("[CONF-5] a custom action that throws after the call still logs the warning before the actor takes the thrown value as its error, and a spawned child machine's custom action warns through the logger its parent runs with", () =>
    Effect.gen(function* () {
      const boom = new Error("boom")
      const throwing = createMachine({
        entry: () => {
          assign({})
          throw boom
        }
      })
      const parent = createMachine({
        entry: spawnChild(
          createMachine({
            entry: () => {
              sendTo("nobody", { type: "x" })
            }
          })
        )
      })
      const warnings = yield* warningsOf(
        Effect.gen(function* () {
          const actor = yield* Effect.tap(createActor(throwing), (started) => started.start)
          const snapshot = yield* actor.getSnapshot
          assert.strictEqual(snapshot.status, "error")
          assert.strictEqual(Option.getOrThrow(snapshot.error), boom)
          yield* Effect.tap(createActor(parent), (started) => started.start)
        })
      )
      assert.deepStrictEqual(warnings, [builtInCalledInCustomAction("assign"), builtInCalledInCustomAction("sendTo")])
    }))
})

// ---------------------------------------------------------------- the root actor reference and snapshot types

/** True when `A` and `B` are the same type. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

/** Compiles only for `true`. */
const typeHolds = <T extends true>(holds: T): T => holds

describe("[CONF-5] the root ActorRef, Snapshot, AnyActorRef and ActorRefFromLogic types", () => {
  type Ping = { readonly type: "PING" }
  const child = createMachine({ types: {} as { context: { n: number }; events: Ping }, context: { n: 0 } })

  it.effect("[CONF-5] ActorRef and Snapshot are root types under the names of the root ActorRef and Snapshot modules, whose members stay values", () =>
    Effect.gen(function* () {
      type ParentRef = ActorRef<Snapshot<unknown>, Ping>
      typeHolds<Equals<Parameters<ParentRef["send"]>[0], Ping>>(true)
      typeHolds<Equals<Snapshot<number>["output"], Option.Option<number>>>(true)
      const actor = yield* Effect.tap(createActor(child), (started) => started.start)
      const ref: ParentRef = actor
      assert.isTrue(ActorRefModule.isActorRef(ref))
      assert.isTrue(SnapshotModule.isSnapshot(yield* ref.getSnapshot))
    }))

  it.effect("[CONF-5] ActorRefFromLogic of a logic is the reference ActorRefFrom gives for it, and every actor reference fits AnyActorRef, whose send takes any event object", () =>
    Effect.gen(function* () {
      typeHolds<Equals<ActorRefFromLogic<typeof child>, ActorRefFrom<typeof child>>>(true)
      typeHolds<Equals<Parameters<ActorRefFromLogic<typeof child>["send"]>[0], Ping>>(true)
      const received: Array<string> = []
      const target = createMachine({
        on: {
          "*": {
            actions: ({ event }) => {
              received.push(event.type)
            }
          }
        }
      })
      const typed = yield* Effect.tap(createActor(child), (started) => started.start)
      const open = yield* Effect.tap(createActor(target), (started) => started.start)
      const refs: ReadonlyArray<AnyActorRef> = [typed, open]
      const anyRef: AnyActorRef = open
      // @ts-expect-error a reference that takes any event is no reference of the child's events
      const narrowed: ActorRefFromLogic<typeof child> = anyRef
      yield* open.send({ type: "BEFORE" })
      for (const ref of refs) yield* ref.send({ type: "ANY", extra: 1 })
      assert.deepStrictEqual(received, ["BEFORE", "ANY"])
      assert.strictEqual((yield* refs[0]!.getSnapshot).status, "active")
      assert.isDefined(narrowed)
    }))
})

// ---------------------------------------------------------------- a machine written inline as an invocation's src

describe("[CONF-5] a machine written inline as an invocation's src", () => {
  it.effect("[CONF-5] keeps the event type of its own config, so its on keys and inline actions type-check and run as when the machine is built first", () =>
    Effect.gen(function* () {
      const seen: Array<string> = []
      const machine = createMachine({
        invoke: {
          id: "child",
          src: createMachine({
            entry: raise({ type: "ping" }, { id: "ping", delay: 10 }),
            on: {
              ping: {
                actions: ({ event }) => {
                  seen.push(event.type)
                }
              },
              cancelPing: { actions: cancel("ping") }
            }
          })
        }
      })

      yield* Effect.tap(createActor(machine), (actor) => actor.start)
      yield* TestClock.adjust("10 millis")
      yield* Effect.yieldNow.pipe(Effect.repeat({ until: () => seen.length > 0, times: 100 }))
      assert.deepStrictEqual(seen, ["ping"])
    }))
})

// ---------------------------------------------------------------- the event type of a sendTo target

describe("[CONF-5] the events sendTo takes for its target (upstream EventFrom of the target)", () => {
  type ChildEvent = { readonly type: "EVENT"; readonly n: number }
  const childMachine = createMachine({ types: {} as { events: ChildEvent }, on: { EVENT: {} } })

  it.effect("[CONF-5] a target typed by its logic takes that logic's events only, written as an object or given by a function, also when a target function gives the reference", () =>
    Effect.sync(() => {
      const fromContext = () =>
        createMachine({
          types: {} as { context: { child: ActorRefFromLogic<typeof childMachine> } },
          context: ({ spawn }) => ({ child: spawn(childMachine) }),
          entry: [
            sendTo(({ context }) => context.child, { type: "EVENT", n: 1 }),
            sendTo(({ context }) => context.child, () => ({ type: "EVENT" as const, n: 2 })),
            sendTo(({ context }) => context.child, {
              // @ts-expect-error the child takes EVENT only
              type: "UNKNOWN"
            })
          ]
        })
      const byReference = (child: ActorRefFromLogic<typeof childMachine>) => [
        sendTo(child, { type: "EVENT", n: 3 }),
        // @ts-expect-error EVENT needs its n
        sendTo(child, { type: "EVENT" })
      ]
      assert.isFunction(fromContext)
      assert.isFunction(byReference)
    }))

  it.effect("[CONF-5] a target given by name or as an untyped reference takes any event object, and a string event, which the type allows as upstream's any does, is the sending actor's error at run time", () =>
    Effect.gen(function* () {
      const untyped = (child: ActorRefBase) => [
        sendTo(child, { type: "ANY", extra: 1 }),
        sendTo(child, "a string"),
        sendTo("child", ({ context }) => ({ type: "ANY", context }))
      ]
      assert.isFunction(untyped)
      const machine = createMachine({
        invoke: { id: "child", src: childMachine },
        entry: sendTo("child", "a string")
      })
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "error")
      const error = Option.getOrThrow(snapshot.error)
      assert.instanceOf(error, Error)
      assert.strictEqual(error.message, onlyEventObjectsSendTo("a string"))
    }))
})

// ---------------------------------------------------------------- the snapshot an action's self gives

describe("[CONF-5] the snapshot an action's self gives (upstream ActionArgs self)", () => {
  it.effect("[CONF-5] self.getSnapshot in an inline action, an assigner and a sendTo function gives the machine snapshot of the machine's context, the snapshot after the earlier actions of the step", () =>
    Effect.gen(function* () {
      const seen: Array<number> = []
      const machine = createMachine({
        types: {} as { context: { readonly count: number }; events: { readonly type: "GO" } | { readonly type: "SEEN" } },
        context: { count: 0 },
        on: {
          GO: {
            actions: [
              assign(({ context }) => ({ count: context.count + 1 })),
              sendTo(({ self }) => self, { type: "SEEN" }),
              assign(({ context, self }) => {
                typeHolds<Equals<Effect.Success<typeof self.getSnapshot>["context"], { readonly count: number }>>(true)
                return { count: context.count + 1 }
              })
            ]
          },
          SEEN: {
            actions: ({ self }) =>
              Effect.map(self.getSnapshot, (snapshot) => {
                seen.push(snapshot.context.count)
              })
          }
        }
      })

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* actor.send({ type: "GO" })
      yield* Effect.yieldNow.pipe(Effect.repeat({ until: () => seen.length > 0, times: 100 }))
      assert.deepStrictEqual(seen, [2])
    }))
})

// ---------------------------------------------------------------- the children of a machine snapshot

describe("[CONF-5] the children of a machine snapshot (upstream ToChildren of a machine without typed actors)", () => {
  it.effect("[CONF-5] are AnyActorRef by id, so an invoked child's send and snapshot are called and read through snapshot.children", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        invoke: {
          id: "child",
          src: createMachine({ initial: "a", states: { a: { on: { NEXT: "b" } }, b: {} } })
        }
      })
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      const { children } = yield* actor.getSnapshot
      typeHolds<Equals<typeof children, Record<string, AnyActorRef>>>(true)
      const child = children.child!
      yield* child.send({ type: "NEXT" })
      assert.strictEqual((yield* child.getSnapshot).value, "b")
    }))

  it.effect("[CONF-5] an AnyActorRef's snapshot is upstream's any (SD-22 amendment), and a reference whose snapshot has no value and no context still fits AnyActorRef", () =>
    Effect.gen(function* () {
      type AnySnapshot = Effect.Success<AnyActorRef["getSnapshot"]>
      typeHolds<Equals<AnySnapshot, UpstreamAny>>(true)
      const empty: AnyActorRef = yield* createEmptyActor()
      const snapshot = yield* empty.getSnapshot
      assert.isUndefined(snapshot.context)
      assert.isUndefined(snapshot.value)
    }))

  it.effect("[CONF-5] an AnyActorRef's changes stream gives the child's snapshots and fails with its error (upstream subscribe with an error callback)", () =>
    Effect.gen(function* () {
      type AnySnapshot = Effect.Success<AnyActorRef["getSnapshot"]>
      typeHolds<Equals<AnyActorRef["changes"], Stream.Stream<AnySnapshot, unknown>>>(true)
      const failure = new Error("child_failed")
      const machine = createMachine({
        initial: "running",
        states: {
          running: {
            invoke: {
              id: "child",
              src: createMachine({
                initial: "a",
                states: {
                  a: {
                    on: {
                      FAIL: {
                        actions: () => {
                          throw failure
                        }
                      }
                    }
                  }
                }
              }),
              onError: "handled"
            }
          },
          handled: {}
        }
      })
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      const child = (yield* actor.getSnapshot).children.child!
      const values: Array<unknown> = []
      const consumer = yield* child.changes.pipe(
        Stream.runForEach((snapshot) => Effect.sync(() => values.push(snapshot.value))),
        Effect.flip,
        Effect.forkScoped({ startImmediately: true })
      )
      yield* child.send({ type: "FAIL" })
      assert.strictEqual(yield* Fiber.join(consumer), failure)
      assert.deepStrictEqual(values, ["a"])
      assert.strictEqual((yield* child.getSnapshot).status, "error")
    }))
})

// ---------------------------------------------------------------- the emitted events a setup declares

describe("[CONF-5] the emitted events a setup declares (upstream types.emitted)", () => {
  type Greet = { readonly type: "greet"; readonly message: string }

  it.effect("[CONF-5] emit, enqueue.emit and the setup's bound emit in a setup machine take only the declared events, and the machine's on listeners get them", () =>
    Effect.gen(function* () {
      const greeter = setup({ types: { events: {} as { type: "GO" }, emitted: {} as Greet } })
      // Type checks only: the machine never runs
      greeter.createMachine({
        // @ts-expect-error an event type the setup does not declare
        entry: emit({ type: "nonsense" }),
        on: {
          GO: {
            actions: [
              // @ts-expect-error a message that is not a string
              emit({ type: "greet", message: 1234 }),
              enqueueActions(({ enqueue }) => {
                // @ts-expect-error an event type the setup does not declare
                enqueue.emit({ type: "other" })
              }),
              // @ts-expect-error an event type the setup does not declare
              greeter.emit({ type: "other" })
            ]
          }
        }
      })

      const machine = greeter.createMachine({
        on: {
          GO: {
            actions: [
              emit({ type: "greet", message: "inline" }),
              enqueueActions(({ enqueue }) => {
                enqueue.emit({ type: "greet", message: "enqueued" })
              }),
              greeter.emit(({ event }) => ({ type: "greet", message: `bound ${event.type}` }))
            ]
          }
        }
      })
      const messages: Array<string> = []
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* actor.on("greet", (event) =>
        Effect.sync(() => {
          typeHolds<Equals<typeof event, Greet>>(true)
          messages.push(event.message)
        }))
      yield* actor.send({ type: "GO" })
      assert.deepStrictEqual(messages, ["inline", "enqueued", "bound GO"])
    }))

  it.effect("[CONF-5] without types.emitted, emit in a setup or createMachine config takes any event object", () =>
    Effect.gen(function* () {
      const machine = setup({}).createMachine({
        entry: [emit({ type: "greet", message: 1234 }), setup({}).emit({ type: "other", extra: true })],
        exit: emit({ type: "nonsense" })
      })
      const plain = createMachine({ entry: emit({ type: "greet", message: 1234 }) })
      const seen: Array<string> = []
      const actor = yield* createActor(machine)
      yield* actor.on("*", (event) => Effect.sync(() => seen.push(event.type)))
      yield* actor.start
      yield* Effect.tap(createActor(plain), (started) => started.start)
      assert.deepStrictEqual(seen, ["greet", "other"])
    }))

  it.effect("[CONF-5] an AnyActorRef from snapshot.children listens to the child's emitted events through on (upstream actorRef.on)", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        invoke: {
          id: "cb",
          src: fromCallback<{ readonly type: "PING" }, unknown, { readonly type: "echo"; readonly of: string }>(({ emit, receive }) => {
            receive((event) => emit({ type: "echo", of: event.type }))
          })
        }
      })
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      const child = (yield* actor.getSnapshot).children.cb!
      const seen: Array<unknown> = []
      yield* child.on("echo", (event) =>
        Effect.sync(() => {
          typeHolds<Equals<typeof event, AnyEventObject>>(true)
          seen.push(event.of)
        }))
      yield* child.send({ type: "PING" })
      yield* Effect.yieldNow.pipe(Effect.repeat({ until: () => seen.length > 0, times: 100 }))
      assert.deepStrictEqual(seen, ["PING"])
    }))
})

// ---------------------------------------------------------------- the order the listeners of an emit run in

describe("[CONF-5] the order the listeners of an emitted event run in (upstream actorScope.emit)", () => {
  it.effect("[CONF-5] the listeners of one emit run one at a time, each to its end: the listeners of the event's type, then the '*' listeners, each in the order they were added, and a handler added twice runs twice", () =>
    Effect.gen(function* () {
      const machine = createMachine({ on: { GO: { actions: emit({ type: "ping" }) } } })
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      const order: Array<string> = []
      const shared = () => Effect.sync(() => order.push("shared"))
      yield* actor.on("*", () => Effect.sync(() => order.push("any 1")))
      yield* actor.on("ping", () =>
        Effect.gen(function* () {
          order.push("ping 1 start")
          yield* Effect.yieldNow
          order.push("ping 1 end")
        }))
      for (const n of [2, 3, 4, 5, 6, 7, 8, 9]) {
        yield* actor.on("ping", () => Effect.sync(() => order.push(`ping ${n}`)))
      }
      yield* actor.on("ping", shared)
      yield* actor.on("*", () => Effect.sync(() => order.push("any 2")))
      yield* actor.on("ping", shared)
      // A listener whose scope has closed is gone; the others keep their order
      yield* Effect.scoped(actor.on("ping", () => Effect.sync(() => order.push("removed"))))

      yield* actor.send({ type: "GO" })

      assert.deepStrictEqual(order, [
        "ping 1 start",
        "ping 1 end",
        "ping 2",
        "ping 3",
        "ping 4",
        "ping 5",
        "ping 6",
        "ping 7",
        "ping 8",
        "ping 9",
        "shared",
        "shared",
        "any 1",
        "any 2"
      ])
    }))

  it.effect("[CONF-5] an emit a listener makes while the same actor delivers another emit reaches its listeners at once, inside that listener, before the next listener of the first emit (upstream: depth first)", () =>
    Effect.gen(function* () {
      const order: Array<string> = []
      let emitNow: ((event: { readonly type: "first" } | { readonly type: "second" }) => void) | undefined
      const logic = fromCallback<{ readonly type: "NONE" }, unknown, { readonly type: "first" } | { readonly type: "second" }>(
        ({ emit }) => {
          emitNow = emit
        }
      )
      const actor = yield* Effect.tap(createActor(logic), (started) => started.start)
      yield* Effect.yieldNow.pipe(Effect.repeat({ until: () => emitNow !== undefined, times: 100 }))
      yield* actor.on("first", () =>
        Effect.sync(() => {
          order.push("first 1 start")
          emitNow?.({ type: "second" })
          order.push("first 1 end")
        }))
      yield* actor.on("first", () => Effect.sync(() => order.push("first 2")))
      yield* actor.on("second", () => Effect.sync(() => order.push("second")))

      yield* Effect.sync(() => emitNow?.({ type: "first" }))
      yield* Effect.yieldNow.pipe(Effect.repeat({ until: () => order.length >= 4, times: 100 }))

      assert.deepStrictEqual(order, ["first 1 start", "second", "first 1 end", "first 2"])
    }))
})

// ---------------------------------------------------------------- the types an output mapper and onDone read

describe("[CONF-5] the types an output mapper and onDone read (upstream Mapper and StateNodeConfig.onDone)", () => {
  type Go = { readonly type: "GO" }

  it.effect("[CONF-5] a root output mapper written inline reads the xstate.done.state.* event that completes the machine (upstream Mapper<TContext, DoneStateEvent, TOutput, TEvent>), a final state's mapper the context, and self takes the machine's events", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        types: {} as { context: { readonly count: number }; events: Go },
        id: "m",
        context: { count: 2 },
        initial: "a",
        states: {
          a: { on: { GO: "done" } },
          done: { type: "final", output: ({ context }) => context.count * 10 }
        },
        output: ({ context, event, self }) => {
          typeHolds<Equals<typeof event, DoneStateEvent>>(true)
          typeHolds<Equals<Parameters<typeof self.send>[0], Go>>(true)
          return { count: context.count, type: event.type, output: event.output }
        }
      })

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* actor.send({ type: "GO" })

      assert.deepStrictEqual(
        (yield* actor.getSnapshot).output,
        Option.some({ count: 2, type: "xstate.done.state.m.done", output: Option.some(20) })
      )
    }))

  it.effect("[CONF-5] a state's onDone guard and actions read the xstate.done.state.* event of the state, whose output is the final child's output, and self takes the machine's events", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        types: {} as { context: { readonly seen: Option.Option<unknown> }; events: Go },
        id: "m",
        context: { seen: Option.none() },
        initial: "a",
        states: {
          a: {
            initial: "a1",
            states: {
              a1: { on: { GO: "a2" } },
              a2: { type: "final", output: { secret: 42 } }
            },
            onDone: {
              target: "b",
              guard: ({ event }) => {
                typeHolds<Equals<typeof event, DoneStateEvent>>(true)
                return Option.isSome(event.output)
              },
              actions: [
                assign({ seen: ({ event }) => event.output }),
                ({ self }) => {
                  typeHolds<Equals<Parameters<typeof self.send>[0], Go>>(true)
                }
              ]
            }
          },
          b: {}
        }
      })

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* actor.send({ type: "GO" })

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.value, "b")
      assert.deepStrictEqual(snapshot.context.seen, Option.some({ secret: 42 }))
    }))
})

// ---------------------------------------------------------------- an output object whose values are functions

describe("[CONF-5] an output object whose property values are functions (upstream resolveOutput warning)", () => {
  /** A mapping function that must never be called: the object is the output as it is. */
  const calls: Array<string> = []
  const count = ({ context }: { readonly context: { readonly n: number } }) => {
    calls.push("count")
    return context.n
  }

  it.effect("[CONF-5] a final state's output object logs upstream's deprecation warning once, when the done event of its parent is made, and the object itself is that event's output", () =>
    Effect.gen(function* () {
      calls.length = 0
      const output = { count, label: "fixed" }
      const seen: Array<Option.Option<unknown>> = []
      const machine = createMachine({
        context: { n: 3 },
        initial: "a",
        states: {
          a: {
            initial: "a1",
            states: {
              a1: { on: { GO: "a2" } },
              a2: { type: "final", output }
            },
            onDone: {
              target: "b",
              actions: ({ event }) => {
                seen.push(event.output)
              }
            }
          },
          b: {}
        }
      })

      const warnings = yield* warningsOf(
        Effect.gen(function* () {
          const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
          yield* actor.send({ type: "GO" })
          assert.strictEqual((yield* actor.getSnapshot).value, "b")
        })
      )

      assert.deepStrictEqual(warnings, [dynamicMappingDeprecated(output)])
      assert.strictEqual(seen.length, 1)
      assert.strictEqual(Option.getOrThrow(seen[0]!), output)
      assert.deepStrictEqual(calls, [])
    }))

  it.effect("[CONF-5] a root output object logs the warning once when the machine completes, in an actor and in getNextSnapshot, and the object itself is the machine output; a final child of the root with an output object and a root mapper logs it twice (the root's done event, then the machine output)", () =>
    Effect.gen(function* () {
      calls.length = 0
      const rootOutput = { count, label: "fixed" }
      const rootObject = createMachine({
        context: { n: 3 },
        initial: "a",
        states: { a: { on: { GO: "b" } }, b: { type: "final" } },
        output: rootOutput
      })
      const finalOutput = { count }
      const finalObject = createMachine({
        context: { n: 3 },
        initial: "a",
        states: { a: { on: { GO: "b" } }, b: { type: "final", output: finalOutput } },
        output: ({ event }) => event.output
      })
      const outputs: Array<Option.Option<unknown>> = []

      const rootWarnings = yield* warningsOf(
        Effect.gen(function* () {
          const actor = yield* Effect.tap(createActor(rootObject), (started) => started.start)
          yield* actor.send({ type: "GO" })
          const snapshot = yield* actor.getSnapshot
          assert.strictEqual(snapshot.status, "done")
          outputs.push(snapshot.output)
        })
      )
      const pureWarnings = yield* warningsOf(
        Effect.gen(function* () {
          const next = yield* getNextSnapshot(rootObject, yield* getInitialSnapshot(rootObject), { type: "GO" })
          assert.strictEqual(next.status, "done")
          outputs.push(next.output)
        })
      )
      const finalWarnings = yield* warningsOf(
        Effect.gen(function* () {
          const actor = yield* Effect.tap(createActor(finalObject), (started) => started.start)
          yield* actor.send({ type: "GO" })
          const snapshot = yield* actor.getSnapshot
          assert.strictEqual(snapshot.status, "done")
          outputs.push(snapshot.output)
        })
      )

      assert.deepStrictEqual(rootWarnings, [dynamicMappingDeprecated(rootOutput)])
      assert.deepStrictEqual(pureWarnings, [dynamicMappingDeprecated(rootOutput)])
      assert.deepStrictEqual(finalWarnings, [dynamicMappingDeprecated(finalOutput), dynamicMappingDeprecated(finalOutput)])
      assert.strictEqual(Option.getOrThrow(outputs[0]!), rootOutput)
      assert.strictEqual(Option.getOrThrow(outputs[1]!), rootOutput)
      assert.deepStrictEqual(outputs[2], Option.some(Option.some(finalOutput)))
      assert.deepStrictEqual(calls, [])
    }))

  it.effect("[CONF-5] no warning for an output object without function values, null, a number or an output mapper (whose result is not checked); an array that holds a function warns, as upstream reads Object.values", () =>
    Effect.gen(function* () {
      const finishing = (stateOutput: object | number | null | undefined, rootOutput: object | number) =>
        createMachine({
          context: { n: 3 },
          initial: "a",
          states: { a: { type: "final", output: stateOutput } },
          output: rootOutput
        })
      const startAll = (machines: ReadonlyArray<ReturnType<typeof finishing>>) =>
        Effect.forEach(machines, (machine) => Effect.tap(createActor(machine), (started) => started.start), { discard: true })

      const quiet = yield* warningsOf(
        startAll([
          finishing({ a: 1 }, { b: 2 }),
          finishing(null, 5),
          finishing(() => ({ f: count }), () => ({ g: count }))
        ])
      )
      const array = [count]
      const loud = yield* warningsOf(startAll([finishing(undefined, array)]))

      assert.deepStrictEqual(quiet, [])
      // An array's entries are its indexes and values, as for the object of the same entries
      assert.deepStrictEqual(loud, [dynamicMappingDeprecated({ ...array })])
    }))
})

// ---------------------------------------------------------------- the errors interpreter.test.ts reads

describe("[CONF-5] the errors interpreter.test.ts reads (upstream throws a plain Error)", () => {
  it.effect("[CONF-5] an initial key that names no child errors the actor at creation with an InitializationError named Error, so it prints as upstream's [Error: <message>]", () =>
    Effect.gen(function* () {
      const config = { id: "m", initial: "nope", states: { a: {} } }
      const snapshot = yield* (yield* createActor(createMachine(config))).getSnapshot

      assert.strictEqual(snapshot.status, "error")
      const error = Option.getOrUndefined(snapshot.error)
      assert.instanceOf(error, InitializationError)
      assert.strictEqual((error as InitializationError)._tag, "InitializationError")
      assert.strictEqual((error as InitializationError).name, "Error")
      assert.strictEqual(String(error), `Error: ${initialStateNotFound("nope", "m")}`)
    }))

  it.effect("[CONF-5] a string event given to send dies with upstream's message, an Error named Error, on a running and on a stopped actor, before the event reaches the actor (no stopped-actor warning)", () =>
    Effect.gen(function* () {
      const machine = createMachine({ initial: "a", states: { a: { on: { EVENT: "b" } }, b: {} } })
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      // The type system rejects a string event (upstream `EventFromLogic`); a cast reaches the
      // run-time check, as the rewrite's `@ts-ignore` does
      const sendAny = actor.send as unknown as (event: unknown) => Effect.Effect<void>
      const exits: Array<Exit.Exit<void>> = []

      exits.push(yield* Effect.exit(sendAny("EVENT")))
      const afterRunning = yield* actor.getSnapshot
      yield* actor.stop
      const warnings = yield* warningsOf(
        Effect.flatMap(Effect.exit(sendAny("EVENT")), (stopped) => Effect.sync(() => exits.push(stopped)))
      )

      assert.strictEqual(afterRunning.status, "active")
      assert.strictEqual(afterRunning.value, "a")
      assert.deepStrictEqual(warnings, [])
      assert.strictEqual(exits.length, 2)
      for (const exit of exits) {
        assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause))
        const defect = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined
        assert.instanceOf(defect, Error)
        assert.strictEqual((defect as Error).name, "Error")
        assert.strictEqual((defect as Error).message, onlyEventObjectsSend("EVENT"))
      }
    }))
})

// ---------------------------------------------------------------- the logic and parent types invoke.test.ts reads

describe("[CONF-5] the root ActorLogic type and an actor's parent reference (upstream ActorLogic, _parent: AnyActorRef)", () => {
  type Count = Snapshot<undefined> & { readonly context: number }

  it.effect("[CONF-5] ActorLogic is a root type under the name of the root ActorLogic module, whose members stay values", () =>
    Effect.gen(function* () {
      const countLogic: ActorLogic<Count, EventObject> = makeActorLogic<Count, EventObject, unknown>({
        transition: (snapshot, event) =>
          Effect.succeed(event.type === "INC" ? { ...snapshot, context: snapshot.context + 1 } : snapshot),
        getInitialSnapshot: () => Effect.succeed({ ...SnapshotModule.active(), context: 0 }),
        getPersistedSnapshot: (snapshot) => Effect.succeed(snapshot)
      })
      typeHolds<Equals<ActorLogic<Count, EventObject>, ActorLogicType<Count, EventObject, unknown>>>(true)

      const actor = yield* Effect.tap(createActor(countLogic), (started) => started.start)
      yield* actor.send({ type: "INC" })

      assert.isTrue(ActorLogicModule.isActorLogic(countLogic))
      assert.strictEqual((yield* actor.getSnapshot).context, 1)
    }))

  it.effect("[CONF-5] an actor's parent is an AnyActorRef, so an invoked logic sends to its parent through self._parent", () =>
    Effect.gen(function* () {
      const pongLogic: ActorLogic<Snapshot<undefined>, EventObject> = makeActorLogic<Snapshot<undefined>, EventObject, unknown>({
        transition: (snapshot, event) =>
          Effect.gen(function* () {
            const { self } = yield* ActorScope
            typeHolds<Equals<typeof self._parent, Option.Option<AnyActorRef>>>(true)
            if (event.type === "PING") {
              yield* Option.match(self._parent, {
                onNone: () => Effect.void,
                onSome: (parent) => parent.send({ type: "PONG" })
              })
            }
            return snapshot
          }),
        getInitialSnapshot: () => Effect.succeed(SnapshotModule.active()),
        getPersistedSnapshot: (snapshot) => Effect.succeed(snapshot)
      })
      const machine = createMachine({
        initial: "waiting",
        states: {
          waiting: {
            entry: sendTo("ponger", { type: "PING" }),
            invoke: { id: "ponger", src: pongLogic },
            on: { PONG: "success" }
          },
          success: { type: "final" }
        }
      })

      const actor = yield* createActor(machine)
      typeHolds<Equals<typeof actor._parent, Option.Option<AnyActorRef>>>(true)
      const completed = yield* actor.changes.pipe(Stream.runDrain, Effect.forkScoped({ startImmediately: true }))
      yield* actor.start
      yield* Fiber.join(completed)

      assert.strictEqual((yield* actor.getSnapshot).value, "success")
      assert.isTrue(Option.isNone(actor._parent))
    }))
})

// ---------------------------------------------------------------- an invocation of a machine without typed actors

describe("[CONF-5] an invocation of a machine without typed actors (upstream any; SD-22 amendment 2026-10-07)", () => {
  /** Yields the fiber, at most 100 times, until `done` holds (SD-23 deliveries). */
  const yieldUntil = (done: () => boolean) => Effect.yieldNow.pipe(Effect.repeat({ until: done, times: 100 }))

  it.effect("[CONF-5] inline logic as an invoke src reads any member of its input and of the events it receives, and onDone reads any member of the done output (an Option, D8)", () =>
    Effect.gen(function* () {
      typeHolds<Equals<Parameters<AnyActorLogic["getInitialSnapshot"]>[0], any>>(true)
      typeHolds<Equals<Parameters<AnyActorLogic["transition"]>[1], any>>(true)
      const seen: Array<unknown> = []
      const child = createMachine({
        initial: "working",
        states: { working: { on: { FINISH: "finished" } }, finished: { type: "final" } },
        output: { count: 3 }
      })
      const machine = createMachine({
        initial: "running",
        states: {
          running: {
            invoke: [
              {
                id: "callback",
                input: { label: "from input" },
                src: fromCallback(({ input, receive }) => {
                  seen.push(input.label)
                  receive((event) => {
                    seen.push(event.payload)
                  })
                })
              },
              {
                id: "child",
                src: child,
                onDone: {
                  target: "done",
                  actions: ({ event }) => {
                    seen.push(Option.getOrThrow(event.output).count)
                  }
                }
              }
            ],
            on: {
              PING: { actions: sendTo("callback", { type: "PING", payload: "from event" }) },
              FINISH: { actions: sendTo("child", { type: "FINISH" }) }
            }
          },
          done: { type: "final" }
        }
      })

      const actor = yield* createActor(machine)
      const completed = yield* actor.changes.pipe(Stream.runDrain, Effect.forkScoped({ startImmediately: true }))
      yield* actor.start
      yield* actor.send({ type: "PING" })
      yield* yieldUntil(() => seen.length === 2)
      yield* actor.send({ type: "FINISH" })
      yield* Fiber.join(completed)

      assert.deepStrictEqual(seen, ["from input", "from event", 3])
    }))

  it.effect("[CONF-5] in a machine that declares its events, onSnapshot reads any member of the invoked actor's snapshot and onError reads the error event, not the machine's events", () =>
    Effect.gen(function* () {
      const seen: Array<unknown> = []
      const child = createMachine({
        context: { count: 0 },
        on: { INC: { actions: assign({ count: ({ context }) => context.count + 1 }) } }
      })
      const machine = createMachine({
        types: {} as { events: { readonly type: "INC" } },
        invoke: {
          id: "child",
          src: child,
          onSnapshot: {
            actions: ({ event }) => {
              seen.push(event.snapshot.context.count)
            }
          },
          onError: {
            actions: ({ event }) => {
              seen.push(event.error)
            }
          }
        },
        on: { INC: { actions: sendTo("child", { type: "INC" }) } }
      })

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* actor.send({ type: "INC" })
      yield* yieldUntil(() => seen.includes(1))

      assert.deepStrictEqual(seen.slice(-1), [1])
      assert.isFalse(seen.some((value) => typeof value !== "number"))
    }))
})

// ---------------------------------------------------------------- a child stopped by its parent while it re-enters an invoking state

describe("[CONF-5] a child stopped by its parent while it re-enters an invoking state (upstream invoke.test.ts, SD-23)", () => {
  it.effect("[CONF-5] the parent completes on the forwarded event, and the child starts the invocation of the state it re-enters once, as upstream does after the parent's completion, and never again", () =>
    Effect.gen(function* () {
      let invokeCount = 0
      const child = createMachine({
        id: "child",
        initial: "idle",
        states: {
          idle: {
            invoke: {
              src: fromCallback(({ sendBack }) => {
                invokeCount++
                if (invokeCount === 1) {
                  // STARTED arrives when the parent is not processing an event
                  Effect.runFork(Effect.andThen(Effect.yieldNow, Effect.sync(() => sendBack({ type: "STARTED" }))))
                }
              })
            },
            on: { STARTED: "active" }
          },
          active: {
            invoke: {
              src: fromCallback(({ sendBack }) => {
                sendBack({ type: "STOPPED" })
              })
            },
            on: { STOPPED: { target: "idle", actions: forwardTo(SpecialTargets.Parent) } }
          }
        }
      })
      const parent = createMachine({
        id: "parent",
        initial: "idle",
        states: {
          idle: { on: { START: "active" } },
          active: { invoke: { src: child }, on: { STOPPED: "done" } },
          done: { type: "final" }
        }
      })

      const actor = yield* createActor(parent)
      const completed = yield* actor.changes.pipe(Stream.runDrain, Effect.forkScoped({ startImmediately: true }))
      yield* actor.start
      yield* actor.send({ type: "START" })
      // The changes stream ends without a failure: the parent is done, not errored
      yield* Fiber.join(completed)
      const status = (yield* actor.getSnapshot).status
      // The forwarded STOPPED is enqueued (SD-23), so the child's next deferred effect, the
      // start of the idle invocation, runs before the parent takes it; upstream starts it too,
      // after the parent's completion (probe trace: idle 1, active, complete, idle 2)
      yield* Effect.yieldNow.pipe(Effect.repeat({ times: 100 }))

      assert.strictEqual(status, "done")
      assert.strictEqual(invokeCount, 2)
    }))
})

// ---------------------------------------------------------------- a state node's initial transition and getMeta

describe("[CONF-5] a state node's initial transition and getMeta (upstream StateNode.initial and StateId)", () => {
  it.effect("[CONF-5] every node has upstream's initial transition definition: the target child, the node as source, the object form's actions, meta and description, no event type, no re-entry; no target for an atomic node or a key that names no child", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "m",
        initial: { target: "a", actions: log("start"), meta: { source: "initial" }, description: "start" },
        states: { a: {} }
      })
      const initial = machine.root.initial
      const json = initial.toJSON() as { readonly source: unknown; readonly target: unknown; readonly meta: unknown }
      const atomic = machine.states["a"]!.initial
      // Upstream's getter throws for a key that names no child; the port's gives no target, and
      // the message errors the actor at creation (SD-3; the interpreter errors block above)
      const unknownKey = createMachine({ id: "m", initial: "nope", states: { a: {} } }).root.initial

      assert.deepStrictEqual(initial.target, [machine.states["a"]!])
      assert.strictEqual(initial.source, machine.root)
      assert.strictEqual(initial.actions.length, 1)
      assert.strictEqual(initial.eventType, null)
      assert.strictEqual(initial.reenter, false)
      assert.deepStrictEqual(initial.meta, { source: "initial" })
      assert.strictEqual(initial.description, "start")
      assert.strictEqual(json.source, "#m")
      assert.deepStrictEqual(json.target, ["#m.a"])
      assert.deepStrictEqual(json.meta, { source: "initial" })
      assert.deepStrictEqual(atomic.target, [])
      assert.strictEqual(atomic.source, machine.states["a"])
      assert.deepStrictEqual(atomic.actions, [])
      assert.strictEqual(atomic.meta, undefined)
      assert.deepStrictEqual(unknownKey.target, [])
    }))

  it.effect("[CONF-5] getMeta keeps a node meta that is not undefined, null included (upstream `meta !== undefined`), and leaves out a node without meta", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "m",
        meta: null,
        initial: "a",
        states: { a: { initial: "b", states: { b: { meta: { b: 1 } } } } }
      })
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)

      assert.deepStrictEqual((yield* actor.getSnapshot).getMeta(), { m: null, "m.a.b": { b: 1 } })
      assert.strictEqual(machine.root.meta, null)
      assert.strictEqual(machine.states["a"]!.meta, undefined)
    }))

  it.effect("[CONF-5] a setup machine's getMeta takes only its state ids, and its snapshot is still a MachineSnapshot of any schema; a machine without setup takes any key", () =>
    Effect.gen(function* () {
      const typed = setup({ types: { meta: {} as { title: string } } }).createMachine({
        id: "root",
        initial: "a",
        states: { a: { meta: { title: "A" }, initial: "one", states: { one: { id: "first" }, two: {} } } }
      })
      const plain = createMachine({ initial: "a", states: { a: { meta: { title: "A" } } } })
      const typedMeta = (yield* (yield* Effect.tap(createActor(typed), (started) => started.start)).getSnapshot).getMeta()
      const plainMeta = (yield* (yield* Effect.tap(createActor(plain), (started) => started.start)).getSnapshot).getMeta()
      const wide: MachineSnapshot<unknown> = yield* (yield* createActor(typed)).getSnapshot

      typeHolds<Equals<keyof typeof typedMeta, "root" | "root.a" | "first" | "root.a.two">>(true)
      typedMeta["first"] satisfies { title: string } | undefined
      // @ts-expect-error a key path that skips a node's own id is not a state id
      assert.strictEqual(typedMeta["root.a.one"], undefined)
      typeHolds<Equals<keyof typeof plainMeta, string>>(true)
      assert.deepStrictEqual(typedMeta, { "root.a": { title: "A" } })
      assert.deepStrictEqual(plainMeta["(machine).a"], { title: "A" })
      assert.deepStrictEqual(wide.getMeta(), { "root.a": { title: "A" } })
    }))
})

// ---------------------------------------------------------------- the root AnyActor type and toEffect of any actor

describe("[CONF-5] the root AnyActor type and toEffect of any actor (upstream AnyActor, toPromise of any actor reference)", () => {
  it.effect("[CONF-5] every actor that createActor returns fits AnyActor, an AnyActorRef whose snapshot gives a machine's value, context and children", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        context: { n: 1 },
        invoke: { id: "myChild", src: fromCallback(() => {}) },
        initial: "a",
        states: { a: {} }
      })
      const service: AnyActor = yield* Effect.tap(createActor(machine), (started) => started.start)
      const promised: AnyActor = yield* createActor(fromPromise(() => Promise.resolve(1)))
      const refs: ReadonlyArray<AnyActorRef> = [service, promised]
      const snapshot = yield* service.getSnapshot

      typeHolds<Equals<AnyActor["start"], Effect.Effect<void>>>(true)
      typeHolds<Equals<AnyActor["stop"], Effect.Effect<void>>>(true)
      assert.strictEqual(snapshot.value, "a")
      assert.deepStrictEqual(snapshot.context, { n: 1 })
      assert.isDefined(snapshot.children?.["myChild"])
      // Session ids are numbered per system (SD-9): both roots may have `x:0`
      assert.strictEqual(typeof promised.sessionId, "string")
      assert.notStrictEqual(refs[0], refs[1])
    }))

  it.effect("[CONF-5] toEffect and toPromise take an AnyActor and give its output once it is done", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        initial: "a",
        states: { a: { on: { FINISH: "b" } }, b: { type: "final" } },
        output: () => 42
      })
      const service: AnyActor = yield* Effect.tap(createActor(machine), (started) => started.start)
      const waiting = yield* toEffect(service).pipe(Effect.forkScoped({ startImmediately: true }))
      yield* service.send({ type: "FINISH" })
      const output = yield* Fiber.join(waiting)
      const promisedOutput = yield* Effect.promise(() => toPromise(service))

      typeHolds<Equals<typeof output, Option.Option<unknown>>>(true)
      assert.deepStrictEqual(output, Option.some(42))
      assert.deepStrictEqual(promisedOutput, Option.some(42))
    }))
})

// ---------------------------------------------------------------- the setup-bound sendTo and enqueue.sendTo by target

describe("[CONF-5] the events the setup-bound sendTo and enqueue.sendTo take for their target (upstream sendTo<TTargetActor>)", () => {
  type ChildEvent = { readonly type: "EVENT"; readonly n: number }
  const childMachine = setup({ types: {} as { context: { total: number }; events: ChildEvent } }).createMachine({
    context: { total: 0 },
    on: { EVENT: { actions: assign(({ context, event }) => ({ total: context.total + event.n })) } }
  })
  type Child = ActorRefFromLogic<typeof childMachine>
  const parentSetup = setup({ types: {} as { context: { child: Child }; events: { type: "GO" } } })

  it.effect("[CONF-5] a target typed by its logic takes that logic's events only, and the events reach it; a name takes any event object", () =>
    Effect.gen(function* () {
      const machine = parentSetup.createMachine({
        context: ({ spawn }) => ({ child: spawn(childMachine) }),
        entry: parentSetup.sendTo(({ context }) => context.child, { type: "EVENT", n: 1 }),
        on: {
          GO: {
            actions: parentSetup.enqueueActions(({ context, enqueue }) => {
              enqueue.sendTo(context.child, { type: "EVENT", n: 2 })
              enqueue.sendTo(context.child, () => ({ type: "EVENT" as const, n: 4 }))
            })
          }
        }
      })
      const typedOnly = (child: Child) => [
        parentSetup.sendTo(child, { type: "EVENT", n: 1 }),
        // @ts-expect-error the child takes EVENT only
        parentSetup.sendTo(child, { type: "UNKNOWN" }),
        parentSetup.enqueueActions(({ enqueue }) => {
          // @ts-expect-error EVENT needs its n
          enqueue.sendTo(child, { type: "EVENT" })
          enqueue.sendTo("byName", { type: "ANY", extra: 1 })
        }),
        parentSetup.sendTo("byName", { type: "ANY", extra: 1 })
      ]

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* actor.send({ type: "GO" })
      const child = (yield* actor.getSnapshot).context.child
      // The sends of GO go out after its macrostep (SD-23); the child takes them in its own fiber
      const childTotal = Effect.yieldNow.pipe(Effect.andThen(child.getSnapshot), Effect.map((snapshot) => snapshot.context.total))
      const total = yield* childTotal.pipe(Effect.repeat({ until: (n) => n === 7, times: 100 }))
      assert.strictEqual(total, 7)
      assert.strictEqual(typedOnly(child).length, 4)
    }))
})

// ---------------------------------------------------------------- the events start processes before it returns

describe("[CONF-5] the events an actor's start processes before it returns (upstream start ends with mailbox.start())", () => {
  const counter = () =>
    createMachine({
      types: {} as { context: { n: number }; events: { type: "INC" } },
      context: { n: 0 },
      on: { INC: { actions: assign(({ context }) => ({ n: context.n + 1 })) } }
    })

  it.effect("[CONF-5] the events sent before start are processed when start returns", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(counter())
      yield* actor.send({ type: "INC" })
      yield* actor.send({ type: "INC" })
      yield* actor.start

      assert.strictEqual((yield* actor.getSnapshot).context.n, 2)
    }))

  it.effect("[CONF-5] an event a child's initial entry action sends to its root is processed before the root's start returns", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        types: {} as { context: { pings: number }; events: { type: "PING" } },
        context: { pings: 0 },
        invoke: { src: createMachine({ entry: sendParent({ type: "PING" }) }) },
        on: { PING: { actions: assign(({ context }) => ({ pings: context.pings + 1 })) } }
      })
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)

      assert.strictEqual((yield* actor.getSnapshot).context.pings, 1)
    }))

  it.effect("[CONF-5] start returns when an event sent before it ends the actor, and the events after that one are dropped", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        types: {} as { context: { n: number }; events: { type: "INC" } | { type: "FINISH" } },
        context: { n: 0 },
        initial: "a",
        states: {
          a: { on: { FINISH: "b", INC: { actions: assign(({ context }) => ({ n: context.n + 1 })) } } },
          b: { type: "final" }
        }
      })
      const actor = yield* createActor(machine)
      yield* actor.send({ type: "FINISH" })
      yield* actor.send({ type: "INC" })
      yield* actor.start

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "done")
      assert.strictEqual(snapshot.context.n, 0)
    }))
})

// ---------------------------------------------------------------- the system types system.test.ts reads

describe("[CONF-5] the system types system.test.ts reads (upstream ActorSystem<T>, system.get, ActorRefFrom of any machine, stopChild)", () => {
  type Receiver = ActorRef<Snapshot<unknown>, { readonly type: "HELLO" }>

  it.effect("[CONF-5] ActorSystem<T> types get and getAll by the actors it declares", () =>
    Effect.gen(function* () {
      type Info = { readonly actors: { readonly receiver: Receiver } }
      type MySystem = ActorSystem<Info>
      const machine = createMachine({ invoke: { src: fromCallback(() => {}), systemId: "receiver" } })
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      const system = actor.system as MySystem
      const receiver = yield* system.get("receiver")
      const all = yield* system.getAll
      const undeclared = () =>
        // @ts-expect-error the system declares no actor under this systemId
        system.get("other")

      typeHolds<Equals<Info extends ActorSystemInfo ? true : false, true>>(true)
      typeHolds<Equals<typeof receiver, Option.Option<Receiver>>>(true)
      typeHolds<Equals<typeof all, Partial<Info["actors"]>>>(true)
      assert.isTrue(Option.isSome(receiver))
      assert.deepStrictEqual(Object.keys(all), ["receiver"])
      assert.strictEqual(typeof undeclared, "function")
    }))

  it.effect("[CONF-5] system.get without a type argument gives an AnyActorRef, which takes any event object", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        invoke: { src: fromTransition((count: number, _event: AnyEventObject) => count + 1, 0), systemId: "reducer" }
      })
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      const reducer = yield* actor.system.get("reducer")
      const ref = Option.getOrThrow(reducer)
      yield* ref.send({ type: "a" })

      typeHolds<Equals<typeof reducer, Option.Option<AnyActorRef>>>(true)
      assert.strictEqual((yield* ref.getSnapshot).context, 1)
    }))

  it.effect("[CONF-5] ActorRefFrom of AnyStateMachine or AnyActorLogic is an AnyActorRef, which a spawned machine's reference fits", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        types: {} as { context: { machineRef?: ActorRefFrom<AnyStateMachine> }; events: { type: "SPAWN" } },
        context: {},
        on: { SPAWN: { actions: assign({ machineRef: ({ spawn }) => spawn(createMachine({ id: "child" })) }) } }
      })
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* actor.send({ type: "SPAWN" })
      const machineRef = Option.getOrThrow(Option.fromNullishOr((yield* actor.getSnapshot).context.machineRef))

      typeHolds<Equals<ActorRefFrom<AnyStateMachine>, AnyActorRef>>(true)
      typeHolds<Equals<ActorRefFrom<AnyActorLogic>, AnyActorRef>>(true)
      assert.isTrue(Object.values((yield* actor.getSnapshot).children).includes(machineRef))
      assert.strictEqual((yield* machineRef.getSnapshot).status, "active")
    }))

  it.effect("[CONF-5] a stopChild target function that gives undefined stops nothing (upstream executeStop of no actor)", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        types: {} as { events: { type: "STOP" } },
        invoke: { src: createMachine({}), id: "child", systemId: "child" },
        on: { STOP: { actions: stopChild(({ system }) => Option.getOrUndefined(Effect.runSync(system.get("missing")))) } }
      })
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* actor.send({ type: "STOP" })
      const snapshot = yield* actor.getSnapshot

      assert.strictEqual(snapshot.status, "active")
      assert.deepStrictEqual(Object.keys(snapshot.children), ["child"])
      assert.isTrue(Option.isSome(yield* actor.system.get("child")))
    }))
})

// ---------------------------------------------------------------- stopChild of an actor that is not a child

/** The message of the error a snapshot holds. */
const errorMessage = (error: Option.Option<unknown>) =>
  Option.getOrUndefined(Option.map(error, (value) => (value instanceof Error ? value.message : String(value))))

describe("[CONF-5] stopChild of an actor that is not a child (upstream executeStop and actorScope.stopChild)", () => {
  /** Yields until `done` holds, at most 100 turns (a send between actors enqueues, SD-23). */
  const yieldUntil = (done: () => boolean) => Effect.yieldNow.pipe(Effect.repeat({ until: done, times: 100 }))

  it.effect("[CONF-5] a running actor that is not a child errors the machine after its macrostep commits: the actions before the stop take effect, the ones after it do not", () =>
    Effect.gen(function* () {
      const received: Array<string> = []
      const stranger = yield* Effect.tap(
        createActor(
          fromCallback<AnyEventObject>(({ receive }) => {
            receive((event) => {
              received.push(event.type)
            })
          }),
          { id: "stranger" }
        ),
        (started) => started.start
      )
      const machine = createMachine({
        types: {} as { context: { n: number }; events: { type: "GO" } },
        context: { n: 0 },
        initial: "a",
        states: {
          a: {
            on: {
              GO: {
                target: "b",
                actions: [
                  assign({ n: 1 }),
                  sendTo(() => stranger, { type: "HI" }),
                  stopChild(() => stranger),
                  sendTo(() => stranger, { type: "BYE" })
                ]
              }
            }
          },
          b: {}
        }
      })
      const actor = yield* Effect.tap(createActor(machine, { id: "parent" }), (started) => started.start)
      yield* actor.send({ type: "GO" })
      const snapshot = yield* actor.getSnapshot
      yield* yieldUntil(() => received.length > 0)
      yield* Effect.yieldNow.pipe(Effect.repeat({ times: 20 }))

      assert.strictEqual(snapshot.status, "error")
      assert.strictEqual(snapshot.value, "b")
      assert.deepStrictEqual(snapshot.context, { n: 1 })
      assert.strictEqual(errorMessage(snapshot.error), notAChild("stranger", "parent"))
      assert.deepStrictEqual(received, ["HI"])
      assert.strictEqual((yield* stranger.getSnapshot).status, "active")
    }))

  it.effect("[CONF-5] an actor that has not started and is not a child errors the machine inside the transition, with the snapshot before the event", () =>
    Effect.gen(function* () {
      const stranger = yield* createActor(fromCallback(() => {}), { id: "stranger" })
      const machine = createMachine({
        types: {} as { context: { n: number }; events: { type: "GO" } },
        context: { n: 0 },
        initial: "a",
        states: { a: { on: { GO: { target: "b", actions: [assign({ n: 1 }), stopChild(() => stranger)] } } }, b: {} }
      })
      const actor = yield* Effect.tap(createActor(machine, { id: "parent" }), (started) => started.start)
      yield* actor.send({ type: "GO" })
      const snapshot = yield* actor.getSnapshot

      assert.strictEqual(snapshot.status, "error")
      assert.strictEqual(snapshot.value, "a")
      assert.deepStrictEqual(snapshot.context, { n: 0 })
      assert.strictEqual(errorMessage(snapshot.error), notAChild("stranger", "parent"))
    }))

  it.effect("[CONF-5] a sibling found by its systemId gives its systemId up before the stop errors, and keeps running", () =>
    Effect.gen(function* () {
      const child = createMachine({
        types: {} as { events: { type: "STOP_SIBLING" } },
        on: {
          STOP_SIBLING: { actions: stopChild(({ system }) => Option.getOrUndefined(Effect.runSync(system.get("sibling")))) }
        }
      })
      const machine = createMachine({
        invoke: [
          { src: fromCallback(() => {}), id: "sib", systemId: "sibling" },
          { src: child, id: "child", systemId: "child", onError: { actions: () => {} } }
        ]
      })
      const actor = yield* Effect.tap(createActor(machine, { id: "parent" }), (started) => started.start)
      const childRef = Option.getOrThrow(yield* actor.system.get("child"))
      yield* childRef.send({ type: "STOP_SIBLING" })
      const childSnapshot = yield* childRef.getSnapshot
      const sibling = (yield* actor.getSnapshot).children["sib"]

      assert.strictEqual(childSnapshot.status, "error")
      assert.strictEqual(errorMessage(childSnapshot.error), notAChild("sib", "child"))
      assert.isTrue(Option.isNone(yield* actor.system.get("sibling")))
      assert.strictEqual((yield* actor.getSnapshot).status, "active")
      assert.strictEqual(sibling === undefined ? undefined : (yield* sibling.getSnapshot).status, "active")
    }))
})

// ---------------------------------------------------------------- spawn with a src that names no actor

describe("[CONF-5] spawn with a src that names no actor (upstream createSpawner throws; SD-3, DEV-37)", () => {
  const machineOf = (assigner: (spawn: (src: string) => unknown) => Record<string, never>) =>
    createMachine({
      id: "parent",
      types: {} as { context: { n: number }; events: { type: "GO" } },
      context: { n: 0 },
      initial: "a",
      states: {
        a: { on: { GO: { target: "b", actions: [assign({ n: 1 }), assign(({ spawn }) => assigner(spawn))] } } },
        b: {}
      }
    })

  it.effect("[CONF-5] the assigner goes on after the call, and once it returns the actor errors with upstream's message and the snapshot before the event", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = machineOf((spawn) => {
        spawn("child")
        log.push("after spawn")
        return {}
      })
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* actor.send({ type: "GO" })
      const snapshot = yield* actor.getSnapshot

      assert.strictEqual(snapshot.status, "error")
      assert.strictEqual(snapshot.value, "a")
      assert.deepStrictEqual(snapshot.context, { n: 0 })
      assert.strictEqual(errorMessage(snapshot.error), actorLogicNotImplemented("child", "parent"))
      // Upstream throws inside the call, so its assigner stops there (SD-3: the port does not)
      assert.deepStrictEqual(log, ["after spawn"])
    }))

  it.effect("[CONF-5] a try/catch around the call catches nothing: the error comes after the assigner returns", () =>
    Effect.gen(function* () {
      const caught: Array<unknown> = []
      const machine = machineOf((spawn) => {
        try {
          spawn("child")
        } catch (error) {
          caught.push(error)
        }
        return {}
      })
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* actor.send({ type: "GO" })
      const snapshot = yield* actor.getSnapshot

      // Upstream catches its throw there and the actor stays active (SD-3: the port does not throw)
      assert.deepStrictEqual(caught, [])
      assert.strictEqual(snapshot.status, "error")
      assert.strictEqual(errorMessage(snapshot.error), actorLogicNotImplemented("child", "parent"))
    }))
})

// ---------------------------------------------------------------- the invocations a setup machine takes

describe("[CONF-5] the invocations a setup machine takes (upstream DistributeActors over the declared actors)", () => {
  it.effect("[CONF-5] a setup without actors takes no invocation: a name and inline logic are both type errors at src, as upstream; at run time the inline logic still runs", () =>
    Effect.gen(function* () {
      const unknownName = setup({}).createMachine({
        invoke: {
          // @ts-expect-error a setup without actors takes no invocation (upstream: 'src' does not exist in type 'readonly never[]')
          src: "unknown"
        }
      })
      const inline = setup({}).createMachine({
        initial: "running",
        states: {
          running: {
            invoke: {
              // @ts-expect-error a setup without actors takes no invocation, not even inline logic (upstream: the same error)
              src: fromPromise(() => Promise.resolve(1)),
              onDone: "done"
            }
          },
          done: { type: "final" }
        }
      })

      const actor = yield* Effect.tap(createActor(inline), (started) => started.start)
      const status = actor.getSnapshot.pipe(Effect.map((snapshot) => snapshot.status), Effect.tap(() => Effect.yieldNow))
      assert.strictEqual(yield* status.pipe(Effect.repeat({ until: (value) => value === "done", times: 100 })), "done")
      assert.deepStrictEqual([unknownName.root.invoke.length, inline.root.states["running"]?.invoke.length], [1, 1])
    }))

  it.effect("[CONF-5] a setup with actors takes their names and inline logic, and an unknown name is a type error at invoke, as upstream", () =>
    Effect.gen(function* () {
      const actors = setup({
        types: {} as { context: { known: number } },
        actors: { known: fromPromise(() => Promise.resolve(2)) }
      })
      const machine = actors.createMachine({
        context: { known: 0 },
        invoke: { src: "known", onDone: { actions: assign({ known: ({ event }) => Option.getOrElse(event.output, () => -1) }) } },
        initial: "running",
        states: {
          running: { invoke: { src: fromPromise(() => Promise.resolve(3)), onDone: "done" } },
          done: {}
        }
      })
      const unknownName = actors.createMachine({
        context: { known: 0 },
        // @ts-expect-error the name is not a declared actor (upstream reports it here too, not at src)
        invoke: {
          src: "unknown"
        }
      })

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      const read = actor.getSnapshot.pipe(Effect.map((snapshot) => [snapshot.value, snapshot.context.known] as const), Effect.tap(() => Effect.yieldNow))
      const ended = yield* read.pipe(Effect.repeat({ until: ([value, known]) => value === "done" && known === 2, times: 100 }))
      assert.deepStrictEqual(ended, ["done", 2])
      assert.strictEqual(unknownName.root.invoke.length, 1)
    }))
})
