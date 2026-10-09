/**
 * CONF-6: the upstream files green at phase 6 pass (SD-1, SD-2).
 *
 * The file imports each rewrite whose ledger green phase is 6 inside its own describe block
 * titled `upstream/<name>.test.ts`, so every upstream test of the file runs once, inside the
 * default run, and its evidence routes to CONF-6. `conformancePhase` (`conformance.ts`)
 * keeps the blocks and its checks in declaration order, also under `--sequence.shuffle`:
 *
 * - the graduation check: each imported rewrite has left `pending.json` and the green
 *   type-check exclude (one commit, SD-1), and the ledger marks it `passes`;
 * - the import check: the file imports exactly actor, actorLogic, after, deterministic,
 *   getNextSnapshot, inspect, issue5454, microstep, rehydration, spawn.types, toPromise,
 *   transition, types and waitFor (the ledger's green-phase 6 files), and no other CONF
 *   evidence file imports one of them;
 * - the count check, last: per file, `passed >= runnable - notPortedRunnable` and
 *   `passed >= 1`, no skipped test, and no test still to run (443 runnable upstream tests, a
 *   floor of 439).
 *
 * T6.14 to T6.27 imported the 14 files one block at a time under the graduation check
 * alone; T6.28 switched to `conformancePhase`. The describe block "the CONF-6 suite and its
 * count floor" pins the order of the checks and the count data of phase 6.
 *
 * actor.test.ts spawns machines, promises, callbacks, observables, event observables and
 * transition logic, by reference and by name, from `assign` and the context factory; it
 * stops them with `stopChild`, reads their snapshots through `snapshot.children` and a
 * child's `subscribe` (upstream `ActorRef.subscribe`, function form, D6), and waits with
 * `waitFor` and `toEffect`. A child that its parent's macrostep stops is stopped before the
 * parent's `changes` streams and `subscribe` observers see the snapshot (upstream `update`:
 * the deferred effects first). One test is a "Tests not ported" row (SD-23): the parent's
 * observer cannot read the child's count 2, and this file pins the port's order with the same
 * machines. A read of `self.getSnapshot` while the initial snapshot is computed is ledger row
 * DEV-44, pinned here too.
 *
 * actorLogic.test.ts runs promise, transition, observable, event-observable, callback and
 * machine logic as root actors and as children, persists and restores them, and wraps any
 * logic in a logic of its own ("composable actor logic"). A promise creator that throws
 * synchronously errors the actor inside `start` (upstream `start` catch). A callback's
 * `sendBack` takes an event with any other members, a machine written inline as an
 * invocation's `src` reads any member of its input, and `AnyActorLogic`'s `transition` takes
 * the snapshot of any logic (upstream types). The actor scope that a logic and a transition
 * reducer receive (DEV-45) and a callback actor that errors (DEV-46) are ledger rows, pinned
 * here.
 *
 * after.test.ts fires `after` transitions on the test clock, by number and by named delay
 * (a function of the context or of the event), from a nested initial state, to a relative
 * target, and after a restore from a JSON copy of the snapshot; it lists a state node's
 * delayed transitions. With a `clock` option, a timer that has fired is not cleared again
 * when its state exits (issue #5001: the option's `clearTimeout` is never called). The
 * upstream test skipped at xstate@5.33.2 is a "Tests not ported" row (D19).
 *
 * deterministic.test.ts runs the pure `transition` and `getInitialSnapshot` helpers on a
 * traffic-light machine: flat, nested and deep initial targets, events that bubble up from a
 * child state, an event that a child forbids (`TIMER: undefined`), and the same snapshot
 * object when no transition is enabled. A state value that the machine does not have fails
 * the Effect of `resolveState` with the upstream message, where upstream throws it (SD-3,
 * amended 2026-10-08; DEV-73); an actor keeps its snapshot object for an unknown event.
 *
 * getNextSnapshot.test.ts computes the next snapshot of transition logic and of a machine
 * with the pure `getInitialSnapshot` and `getNextSnapshot` helpers, which give Effects
 * (SD-13). The helpers create no actor, and the inert actor scope runs no action: a custom
 * action of the transition taken is never called.
 *
 * inspect.test.ts observes the inspection events of a root actor through the `inspect`
 * option and `system.inspect` (function form, SD-18): actor creation, events with their
 * source, snapshots, microsteps of always, raised and normal transitions, and executed
 * actions with their params, each with the root's session id as `rootId`. The port numbers
 * session ids per system (SD-9), so a snapshot that upstream prints with the number its
 * module-global counter reached prints the port's own number; and an event that one actor
 * sends to another is queued (SD-23), so the communications snapshot lists upstream's events
 * in the port's order. Each such snapshot is an "inline snapshot" ledger row (SD-26).
 *
 * issue5454.test.ts runs the pure `initialTransition` and `transition` helpers on machines
 * whose states invoke children with a `systemId` (issue #5454: the inert scope registered the
 * child twice and threw). Each call succeeds, again and again on the same machine, with one
 * or two invocations, and the initial snapshot gives the invocation's one `xstate.spawnChild`
 * action. The helpers give Effects (SD-13), so upstream's "does not throw" is an Exit that
 * is a success (SD-3).
 *
 * microstep.test.ts lists the microsteps of one event with `machine.microstep` (the snapshot
 * after each microstep: the first one, the eventless ones and those of raised events, each
 * with its own internal queue) and with `getMicrosteps` and `getInitialMicrosteps` (each
 * microstep's snapshot with the actions it executed: transition, entry and eventless
 * actions, the initial entry actions of nested states, and the input of the context
 * factory). `machine.microstep` reads its actor scope from the Effect context (DEV-45).
 *
 * rehydration.test.ts restores machines from a persisted snapshot and from a state value
 * (`resolveState`): tags and `can` work at once, a restored actor replays no entry action and
 * runs no exit action when it stops, an unknown state value is an error, and a restored done,
 * final or error state completes or errors without notifying the parent again. Restored
 * children are registered in the system while active, can be stopped, persist again, keep
 * syncing their snapshots, and a grandchild deep in the tree keeps its context. The persisted
 * form and the restore order are ledger row DEV-11. A restore from the JSON of a live
 * snapshot skips the children's actor markers, as upstream skips a child with no `src`
 * (SD-7), pinned here.
 *
 * spawn.types.test.ts spawns a machine from the context factory and from `assign`: with the
 * input that the child's `types.input` declares, and with no input when the child declares
 * none. The reference fits the context's `ActorRefFrom` of the child machine (upstream
 * `Spawner`, P12). The two tests hold no runtime assertion, so the green type-check that
 * includes the file is their evidence.
 *
 * toPromise.test.ts waits for the output of a promise actor and of a machine, one that
 * finishes while the wait runs and one that is done already, with `toEffect` (upstream
 * `toPromise`, SD-19): the output comes as stored, an `Option` (D8), and an actor that had an
 * error fails the wait with its raw error (DEV-21, P10). The upstream test skipped at
 * xstate@5.33.2 is a "Tests not ported" row (D19).
 *
 * transition.test.ts runs the pure `transition` and `initialTransition` helpers (Effects,
 * SD-13) on machines and on transition logic: the `[snapshot, actions]` pair with the
 * actions captured and not run (custom, enqueued, delayed raise, cancel, sendTo, emit and
 * log actions; entry and transition actions), and delayed raises and spawned promise actors
 * that a caller runs itself (two "workflow" examples on the test clock, one of which creates
 * an actor of `AnyActorLogic` from a spawn action's `src`). `getNextTransitions` lists the
 * transitions in upstream order, each with a plain `target` array: guarded ones whatever the
 * guard gives, always and after transitions, from parent states depth first, guarded ones of
 * the same event, and parallel and deeply nested states in document order. A transition
 * reducer's actor scope holds upstream's `logger`, `defer`, `stopChild` and `actionExecutor`
 * beside `self`, `id`, `sessionId`, `system` and `emit`, pinned here; `createActor` of an
 * `AnyActorLogic` gives the root `AnyActor` (upstream `Actor<any>`).
 *
 * types.test.ts is a type test: most of its tests hold no runtime assertion, so the green
 * type-check that includes the file is their evidence, each `@ts-expect-error` used. It checks
 * what a plain `createMachine` derives from its `types` member: the events of `raise`, `log`
 * and `stopChild`, the context and output, the emitted events of `actor.on`, the action,
 * guard, delay, actor and tag names a config may use with their params, the src, id and input
 * of an invocation, of `spawnChild` and of the `spawn` of `assign`, and the children of a
 * snapshot per id; then setup machines, `enqueueActions`, `fromCallback`, `self`,
 * `createActor` of a generic logic, the snapshot methods, and the `any` metadata of the
 * state-node, history and snapshot containers. The type pins below hold each group the port
 * builds for it.
 *
 * waitFor.test.ts waits for a snapshot that matches a predicate with `waitFor`, an Effect
 * (D6) whose timeout runs on the Effect clock (SD-28): it gives the matching snapshot, fails
 * with upstream's "Timeout of <n> ms exceeded" text, never fails with an `Infinity` timeout,
 * and checks the current snapshot before it observes the actor. An actor that ends without a
 * match, while the wait runs or before it, fails the wait with `WaitForTerminatedError` and
 * upstream's message; the class name prints where upstream prints `Error` (two "inline
 * snapshot" rows, D6; SD-26). The `signal` option takes upstream's `AbortSignal`: an aborted
 * signal fails the wait with its reason before anything is observed, and the 'abort' listener
 * is removed when the wait ends (P9).
 */
import { assert, describe, it } from "@effect/vitest"
import { Cause, Effect, Exit, Fiber, Logger, Option, Stream } from "effect"
import {
  type ActorRefFrom,
  type ActorRefFromLogic,
  ActorScope,
  and,
  type AnyActor,
  type AnyActorLogic,
  type AnyActorRef,
  type AnyHistoryValue,
  type AnyMachineSnapshot,
  type AnyStateConfig,
  type AnyStateMachine,
  type AnyStateNode,
  type AnyStateNodeDefinition,
  assign,
  createActor,
  createMachine,
  emit,
  enqueueActions,
  type EventObject,
  forwardTo,
  fromCallback,
  fromPromise,
  fromTransition,
  getMicrosteps,
  getNextSnapshot,
  type HistoryStateNode,
  initialTransition,
  type MachineContext,
  not,
  type Observer,
  or,
  raise,
  setup,
  type Snapshot,
  spawnChild,
  StateMachine,
  type Subscribable,
  toEffect,
  transition,
  type Transitions,
} from "../../src/index.js"
import * as StateUtils from "../../src/stateUtils.js"
import { createInertActorScope } from "../../src/testing/getNextSnapshot.js"
import { conformancePhase, greenFiles, requiredPassed, upstreamFileOptions } from "./conformance.js"
import { shortName } from "./ledger.js"
import { readLedger, readManifest } from "./parity.js"

// ---------------------------------------------------------------- the imported files

conformancePhase(6, () => {
  describe("upstream/actor.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/actor.test.js")
  })
  describe("upstream/actorLogic.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/actorLogic.test.js")
  })
  describe("upstream/after.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/after.test.js")
  })
  describe("upstream/deterministic.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/deterministic.test.js")
  })
  describe("upstream/getNextSnapshot.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/getNextSnapshot.test.js")
  })
  describe("upstream/inspect.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/inspect.test.js")
  })
  describe("upstream/issue5454.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/issue5454.test.js")
  })
  describe("upstream/microstep.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/microstep.test.js")
  })
  describe("upstream/rehydration.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/rehydration.test.js")
  })
  describe("upstream/spawn.types.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/spawn.types.test.js")
  })
  describe("upstream/toPromise.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/toPromise.test.js")
  })
  describe("upstream/transition.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/transition.test.js")
  })
  describe("upstream/types.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/types.test.js")
  })
  describe("upstream/waitFor.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/waitFor.test.js")
  })
})

// ---------------------------------------------------------------- the shape of the suite and its count floor

const SUITE_TITLE = "[CONF-6] upstream files green at phase 6"

/** The upstream files green at phase 6, in the order of the ledger and of the imported blocks. */
const PHASE_6_FILES = [
  "actor",
  "actorLogic",
  "after",
  "deterministic",
  "getNextSnapshot",
  "inspect",
  "issue5454",
  "microstep",
  "rehydration",
  "spawn.types",
  "toPromise",
  "transition",
  "types",
  "waitFor"
] as const

describe("[CONF-6] the CONF-6 suite and its count floor", () => {
  it("[CONF-6] the suite imports the 14 files green at phase 6, then runs the graduation, import and count checks, the count check last, and never shuffles its own children", ({ task }) => {
    const suite = task.file.tasks.find((child) => child.name === SUITE_TITLE)
    assert.strictEqual(suite?.type, "suite")
    const children = suite?.type === "suite" ? suite.tasks : []
    assert.deepStrictEqual(children.map((child) => [child.type, child.name]), [
      ...PHASE_6_FILES.map((name) => ["suite", `upstream/${name}.test.ts`]),
      ["test", "[CONF-6] each imported rewrite has left pending.json and the green type-check exclude, and the ledger marks it passes"],
      ["test", "[CONF-6] the evidence file imports exactly the upstream files green at phase 6, and no other CONF evidence file imports them"],
      ["test", "[CONF-6] every imported file meets its count"]
    ])
    assert.strictEqual(suite?.type === "suite" ? suite.shuffle : undefined, false)
  })

  it.effect("[CONF-6] the files green at phase 6 have 443 runnable upstream tests and a floor of 439 passed: only the 4 runnable missing rows of actor, inspect and types lower it", () =>
    Effect.sync(() => {
      const { ledger, problems } = readLedger()
      assert.deepStrictEqual(problems, [])
      const manifest = readManifest()
      // [name, runnable, upstream skip + todo, "Tests not ported" rows, required passed]
      const floors = greenFiles(ledger.files, 6).map((row) => {
        const name = row["Name"] ?? ""
        const upstream = manifest.files.find((file) => shortName(file.path) === name)
        if (upstream === undefined) return [name]
        const rows = ledger.notPorted.filter((notPorted) => notPorted["File"] === upstream.path).length
        return [name, upstream.runnable, upstream.skip + upstream.todo, rows, requiredPassed(upstream, ledger.notPorted)]
      })
      // after and toPromise: 1 row each for their upstream skipped test (not runnable); inspect:
      // 5 inline-snapshot rows (the tests run) and 2 missing rows (the observer-object forms);
      // waitFor: 2 inline-snapshot rows; actor: 1 missing row (SD-23); types: 1 missing row
      // (the Rx observable).
      assert.deepStrictEqual(floors, [
        ["actor", 41, 0, 1, 40],
        ["actorLogic", 49, 0, 0, 49],
        ["after", 9, 1, 1, 9],
        ["deterministic", 17, 0, 0, 17],
        ["getNextSnapshot", 3, 0, 0, 3],
        ["inspect", 12, 0, 7, 10],
        ["issue5454", 5, 0, 0, 5],
        ["microstep", 11, 0, 0, 11],
        ["rehydration", 18, 0, 0, 18],
        ["spawn.types", 2, 0, 0, 2],
        ["toPromise", 5, 1, 1, 5],
        ["transition", 24, 0, 0, 24],
        ["types", 231, 0, 1, 230],
        ["waitFor", 16, 0, 2, 16]
      ])
      assert.deepStrictEqual(floors.map((floor) => floor[0]), [...PHASE_6_FILES])
      assert.strictEqual(floors.reduce((total, floor) => total + Number(floor[1]), 0), 443)
      assert.strictEqual(floors.reduce((total, floor) => total + Number(floor[4]), 0), 439)
    }))
})

// ---------------------------------------------------------------- type helpers

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

/** Holds only when its type argument is `true`: a type check that the test type-check runs. */
const typeHolds = <T extends true>(holds: T): T => holds

// ---------------------------------------------------------------- the changes streams after the deferred effects

describe("[CONF-6] the changes streams after a macrostep's deferred effects (upstream update: deferred effects, then observer.next)", () => {
  it.effect("[CONF-6] a child that the parent's macrostep stops is stopped when the parent's changes stream gives that snapshot", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        initial: "running",
        states: {
          running: {
            invoke: { id: "child", src: fromCallback(() => () => {}) },
            on: { LEAVE: "idle" },
          },
          idle: {},
        },
      })
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      const child = (yield* actor.getSnapshot).children.child!
      const statuses: Array<string> = []
      const reader = yield* actor.changes.pipe(
        Stream.filter((snapshot) => snapshot.matches("idle")),
        Stream.take(1),
        Stream.runForEach(() =>
          Effect.map(child.getSnapshot, (snapshot) => {
            statuses.push(snapshot.status)
          })
        ),
        Effect.forkScoped({ startImmediately: true })
      )
      yield* actor.send({ type: "LEAVE" })
      yield* Fiber.join(reader)

      // Upstream `update` stops the child (a deferred effect of the exit) before `observer.next`
      assert.deepStrictEqual(statuses, ["stopped"])
    }))
})

// ---------------------------------------------------------------- the root Observer type and subscribe on every reference

describe("[CONF-6] the root Observer type and subscribe on every actor reference (upstream Observer and ActorRef.subscribe)", () => {
  it.effect("[CONF-6] Observer is the observer object an interop observable takes, its three callbacks optional", () =>
    Effect.gen(function* () {
      typeHolds<Equals<Parameters<Subscribable<number>["subscribe"]>[0], Observer<number>>>(true)
      typeHolds<Equals<Observer<number>["next"], ((value: number) => void) | undefined>>(true)
      const seen: Array<number> = []
      const source: Subscribable<number> = {
        subscribe: (observer) => {
          observer.next?.(1)
          observer.complete?.()
          return { unsubscribe: () => {} }
        },
      }
      const observer: Observer<number> = { next: (value) => seen.push(value) }
      source.subscribe(observer).unsubscribe()
      assert.deepStrictEqual(seen, [1])
    }))

  it.effect("[CONF-6] a typed reference and an AnyActorRef from snapshot.children take a subscribe observer, which receives each later snapshot and none at subscription time", () =>
    Effect.gen(function* () {
      const childMachine = createMachine({ initial: "a", states: { a: { on: { NEXT: "b" } }, b: {} } })
      type ChildRef = ActorRefFrom<typeof childMachine>
      typeHolds<Equals<Parameters<Parameters<ChildRef["subscribe"]>[0]>[0], Effect.Success<ChildRef["getSnapshot"]>>>(true)
      typeHolds<Equals<Parameters<Parameters<AnyActorRef["subscribe"]>[0]>[0], Effect.Success<AnyActorRef["getSnapshot"]>>>(true)
      const parent = createMachine({ invoke: { id: "child", src: childMachine } })
      const actor = yield* Effect.tap(createActor(parent), (started) => started.start)
      const child: AnyActorRef = (yield* actor.getSnapshot).children.child!
      const values: Array<unknown> = []
      yield* child.subscribe((snapshot) =>
        Effect.sync(() => {
          values.push(snapshot.value)
        })
      )
      assert.deepStrictEqual(values, [])
      yield* child.send({ type: "NEXT" })
      yield* Effect.yieldNow.pipe(Effect.repeat({ until: () => values.length > 0, times: 100 }))
      assert.deepStrictEqual(values, ["b"])
    }))
})

// ---------------------------------------------------------------- a parent's subscriber and a child a forwardTo feeds

describe("[CONF-6] a parent's subscriber and a child that a forwardTo feeds (upstream actor.test.ts, SD-23)", () => {
  it.effect("[CONF-6] the parent's subscriber reads the child's count before the child takes each forwarded event, and the child counts 2 once it takes both, as upstream ends", () =>
    Effect.gen(function* () {
      const countLogic = fromTransition(
        (count: number, event: EventObject) => (event.type === "INC" ? count + 1 : event.type === "DEC" ? count - 1 : count),
        0
      )
      const countMachine = createMachine({
        types: {} as { context: { count: ActorRefFrom<typeof countLogic> | undefined } },
        context: { count: undefined },
        entry: assign({ count: ({ spawn }) => spawn(countLogic) }),
        on: { INC: { actions: forwardTo(({ context }) => context.count!) } },
      })
      const seen: Array<number | undefined> = []
      const countService = yield* createActor(countMachine)
      yield* countService.subscribe((state) =>
        Effect.gen(function* () {
          seen.push(state.context.count === undefined ? undefined : (yield* state.context.count.getSnapshot).context)
        })
      )
      yield* countService.start
      yield* countService.send({ type: "INC" })
      yield* countService.send({ type: "INC" })
      // The forwarded events are enqueued at the child (SD-23): let it take them
      yield* Effect.yieldNow.pipe(Effect.repeat({ times: 100 }))

      // Upstream's observer reads 0, 1, 2: the child takes each INC inside the parent's macrostep
      assert.deepStrictEqual(seen, [0, 0, 0])
      const child = (yield* countService.getSnapshot).context.count
      assert.isDefined(child)
      assert.strictEqual((yield* child!.getSnapshot).context, 2)
    }))
})

// ---------------------------------------------------------------- self.getSnapshot while the initial snapshot is computed

describe("[CONF-6] self.getSnapshot while the initial snapshot is computed (upstream gives undefined; DEV-44)", () => {
  it.effect("[CONF-6] the read fails as a defect: an initial-entry assigner that catches it gives its context and the actor is active", () =>
    Effect.gen(function* () {
      const reads: Array<boolean> = []
      const machine = createMachine({
        context: { n: 0 },
        entry: assign(({ self }) =>
          Effect.map(Effect.exit(self.getSnapshot), (exit) => {
            reads.push(Exit.isFailure(exit) && Cause.hasDies(exit.cause))
            return { n: 1 }
          })
        ),
      })
      const actor = yield* createActor(machine)
      const snapshot = yield* actor.getSnapshot
      assert.deepStrictEqual(reads, [true])
      assert.strictEqual(snapshot.status, "active")
      assert.deepStrictEqual(snapshot.context, { n: 1 })
    }))

  it.effect("[CONF-6] an initial-entry assigner that does not catch the read errors the actor at creation, and the same read in an inline action of the initial entry, which runs at start, gives the snapshot", () =>
    Effect.gen(function* () {
      const uncaught = createMachine({
        context: { n: 0 },
        entry: assign(({ self }) => Effect.map(self.getSnapshot, (snapshot) => ({ n: snapshot.context.n + 1 }))),
      })
      const errored = yield* createActor(uncaught)
      assert.strictEqual((yield* errored.getSnapshot).status, "error")

      const statuses: Array<string> = []
      const deferred = createMachine({
        context: { n: 0 },
        entry: ({ self }) =>
          Effect.map(self.getSnapshot, (snapshot) => {
            statuses.push(snapshot.status)
          }),
      })
      const actor = yield* createActor(deferred)
      assert.deepStrictEqual(statuses, [])
      yield* actor.start
      assert.deepStrictEqual(statuses, ["active"])
    }))
})

// ---------------------------------------------------------------- a promise creator that throws synchronously

describe("[CONF-6] a promise creator that throws synchronously errors the actor inside start (upstream start: what logic.start throws is the actor's error)", () => {
  it.effect("[CONF-6] the actor has status error with the thrown value when start returns, and keeps its input", () =>
    Effect.gen(function* () {
      const boom = new Error("boom")
      const logic = fromPromise<number, { readonly x: number }>(() => {
        throw boom
      })
      const actor = yield* createActor(logic, { input: { x: 1 } })
      yield* actor.start
      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "error")
      assert.strictEqual(Option.getOrUndefined(snapshot.error), boom)
      // Upstream's `start` catch spreads the snapshot, so the input stays (a rejection clears it)
      assert.deepStrictEqual(snapshot.input, { x: 1 })
    }))

  it.effect("[CONF-6] a parent that invokes it takes its onError transition before the parent's start returns", () =>
    Effect.gen(function* () {
      const errors: Array<string> = []
      const machine = createMachine({
        initial: "pending",
        states: {
          pending: {
            invoke: {
              id: "promise",
              src: fromPromise(() => {
                throw new Error("boom")
              }),
              onError: {
                target: "failed",
                actions: ({ event }) => {
                  errors.push(event.type)
                },
              },
            },
          },
          failed: {},
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.value, "failed")
      assert.deepStrictEqual(errors, ["xstate.error.actor.promise"])
      assert.isUndefined(snapshot.children.promise)
    }))
})

// ---------------------------------------------------------------- the types of fromCallback, createMachine and AnyActorLogic

describe("[CONF-6] the upstream types that actorLogic.test.ts needs: sendBack, an inline machine's input, AnyActorLogic's transition", () => {
  it.effect("[CONF-6] a callback's sendBack takes an event with any other members (upstream AnyEventObject), and the parent receives it as sent", () =>
    Effect.gen(function* () {
      const refs: Array<number> = []
      const machine = createMachine({
        types: {} as { events: { type: "PING"; ref: number } },
        invoke: {
          src: fromCallback(({ sendBack }) => {
            sendBack({ type: "PING", ref: 7 })
          }),
        },
        on: {
          PING: {
            actions: ({ event }) => {
              refs.push(event.ref)
            },
          },
        },
      })
      yield* Effect.tap(createActor(machine), (actor) => actor.start)
      yield* Effect.yieldNow.pipe(Effect.repeat({ until: () => refs.length > 0, times: 100 }))
      assert.deepStrictEqual(refs, [7])
    }))

  it.effect("[CONF-6] a machine written inline as an invocation's src reads any member of its input in its context factory (upstream infers any there)", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        invoke: {
          id: "child",
          src: createMachine({ context: ({ input }) => ({ value: input.deep.prop }) }),
          input: { deep: { prop: "value" } },
        },
      })
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      const child = (yield* actor.getSnapshot).children.child!
      assert.deepStrictEqual((yield* child.getSnapshot).context, { value: "value" })
    }))

  it.effect("[CONF-6] AnyActorLogic's transition takes the snapshot of any logic and gives its value and context as optional unknown, so a wrapper of any logic reads the context", () =>
    Effect.gen(function* () {
      type Next = Effect.Success<ReturnType<AnyActorLogic["transition"]>>
      typeHolds<Equals<Next, Snapshot & { readonly value?: unknown; readonly context?: unknown }>>(true)
      const contexts: Array<unknown> = []
      const withLogs = <T extends AnyActorLogic>(logic: T): T => ({
        ...logic,
        transition: (snapshot: Snapshot, event) =>
          Effect.map(logic.transition(snapshot, event), (next) => {
            contexts.push(next.context)
            return next
          }),
      })
      const counter = withLogs(fromTransition((count: number, event: EventObject) => (event.type === "INC" ? count + 1 : count), 0))
      const actor = yield* Effect.tap(createActor(counter), (started) => started.start)
      yield* actor.send({ type: "INC" })
      yield* actor.send({ type: "INC" })
      assert.deepStrictEqual(contexts, [1, 2])
    }))
})

// ---------------------------------------------------------------- the actor scope of a transition reducer (DEV-45)

describe("[CONF-6] the actor scope that a transition reducer receives (upstream ActorScope; DEV-45)", () => {
  it.effect("[CONF-6] the reducer's third argument holds upstream's members, and the initial-state factory receives the actor itself", () =>
    Effect.gen(function* () {
      const keys: Array<ReadonlyArray<string>> = []
      const selves: Array<unknown> = []
      const logic = fromTransition(
        (count: number, _event: EventObject, actorScope) => {
          keys.push(Object.keys(actorScope).sort())
          selves.push(actorScope.self)
          return count + 1
        },
        ({ self }) => {
          selves.push(self)
          return 0
        }
      )
      const actor = yield* Effect.tap(createActor(logic), (started) => started.start)
      yield* actor.send({ type: "INC" })
      // Upstream's factory receives `{ input }` only at run time (DEV-45, SD-12)
      assert.deepStrictEqual(keys, [
        ["actionExecutor", "defer", "emit", "id", "logger", "self", "sessionId", "stopChild", "system"],
      ])
      assert.deepStrictEqual(selves.length, 2)
      assert.strictEqual(selves[0], selves[1])
      assert.strictEqual((yield* actor.getSnapshot).context, 1)
    }))

  // Probe `.upstream/measure/t625/probe-up.ts` gives the upstream facts these cases pin
  it.effect("[CONF-6] its logger is the actor's logger option (upstream actorScope.logger)", () =>
    Effect.gen(function* () {
      const logged: Array<ReadonlyArray<unknown>> = []
      const logic = fromTransition((count: number, _event: EventObject, { logger }) => {
        logger("hello", count)
        return count + 1
      }, 0)
      const actor = yield* createActor(logic, { logger: (...args) => logged.push(args) })
      yield* actor.start
      yield* actor.send({ type: "GO" })
      assert.deepStrictEqual(logged, [["hello", 0]])
    }))

  it.effect("[CONF-6] its defer runs the function after the reducer returns and the next state commits, before the observers see it (upstream update)", () =>
    Effect.gen(function* () {
      const order: Array<string> = []
      const logic = fromTransition((count: number, _event: EventObject, { defer }) => {
        order.push("reduce-start")
        defer(() => order.push("deferred"))
        order.push("reduce-end")
        return count + 1
      }, 0)
      const actor = yield* createActor(logic)
      yield* actor.subscribe((snapshot) => Effect.sync(() => order.push(`observed:${snapshot.context}`)))
      yield* actor.start
      yield* actor.send({ type: "GO" })
      // The observer added before `start` sees the snapshot the actor starts with first
      assert.deepStrictEqual(order, ["observed:0", "reduce-start", "reduce-end", "deferred", "observed:1"])
    }))

  it.effect("[CONF-6] its stopChild of an actor that is not a child errors the actor with upstream's message and the snapshot from before the event", () =>
    Effect.gen(function* () {
      const other = yield* createActor(fromTransition((count: number) => count, 0), { id: "other" })
      yield* other.start
      const logic = fromTransition((count: number, event: EventObject, { stopChild }) => {
        if (event.type === "STOP") {
          stopChild(other)
        }
        return count + 1
      }, 0)
      const actor = yield* createActor(logic, { id: "reducer", logger: () => undefined })
      yield* actor.start
      yield* actor.send({ type: "GO" })
      yield* actor.send({ type: "STOP" })
      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "error")
      assert.strictEqual(snapshot.context, 1)
      const error = Option.getOrThrow(snapshot.error)
      assert.instanceOf(error, Error)
      assert.strictEqual((error as Error).message, "Cannot stop child actor other of reducer because it is not a child")
      assert.strictEqual((yield* other.getSnapshot).status, "active")
    }))

  it.effect("[CONF-6] its actionExecutor runs the action inside the call, after the @xstate.action inspection event (upstream actionExecutor)", () =>
    Effect.gen(function* () {
      const order: Array<string> = []
      const inspected: Array<unknown> = []
      const logic = fromTransition((count: number, event: EventObject, { actionExecutor, self, system }) => {
        actionExecutor({
          type: "custom",
          info: { context: count, event, self, system },
          params: { count },
          exec: Effect.sync(() => order.push(`exec:${count}`)),
        })
        order.push("after-call")
        return count + 1
      }, 0)
      const actor = yield* createActor(logic, {
        inspect: (event) =>
          Effect.sync(() => {
            if (event.type === "@xstate.action") {
              inspected.push(event.action)
            }
          }),
      })
      yield* actor.start
      yield* actor.send({ type: "GO" })
      assert.deepStrictEqual(order, ["exec:0", "after-call"])
      assert.deepStrictEqual(inspected, [{ type: "custom", params: { count: 0 } }])
    }))

  it.effect("[CONF-6] in the pure transition helper its actionExecutor adds the action to the list, and logger, defer and stopChild do nothing (upstream inert scope)", () =>
    Effect.gen(function* () {
      const order: Array<string> = []
      const nobody = yield* createActor(fromTransition((count: number) => count, 0))
      const logic = fromTransition((count: number, event: EventObject, { actionExecutor, defer, logger, self, stopChild, system }) => {
        logger("pure")
        defer(() => order.push("deferred"))
        stopChild(nobody)
        actionExecutor({ type: "custom", info: { context: count, event, self, system }, params: { count }, exec: Effect.sync(() => order.push("exec")) })
        return count + 1
      }, 3)
      const logs: Array<unknown> = []
      const [initial] = yield* initialTransition(logic)
      const [next, actions] = yield* transition(logic, initial, { type: "GO" }).pipe(
        Effect.provide(
          Logger.layer([
            Logger.make(({ message }) => {
              logs.push(message)
            }),
          ])
        )
      )
      assert.strictEqual(next.context, 4)
      assert.deepStrictEqual(
        (actions as ReadonlyArray<{ readonly type: string; readonly params: unknown }>).map(({ params, type }) => ({ type, params })),
        [{ type: "custom", params: { count: 3 } }]
      )
      assert.deepStrictEqual(order, [])
      assert.deepStrictEqual(logs, [])
    }))

  it.effect("[CONF-6] a call from code the reducer leaves behind: actionExecutor runs at once, defer at the next event's commit (upstream)", () =>
    Effect.gen(function* () {
      const order: Array<string> = []
      const later: Array<() => void> = []
      const logic = fromTransition((count: number, event: EventObject, { actionExecutor, defer, self, system }) => {
        if (event.type === "GO") {
          later.push(() => {
            defer(() => order.push("late-deferred"))
            actionExecutor({
              type: "late",
              info: { context: count, event, self, system },
              params: undefined,
              exec: Effect.sync(() => order.push("late-exec")),
            })
          })
        }
        return count + 1
      }, 0)
      const actor = yield* createActor(logic)
      yield* actor.start
      yield* actor.send({ type: "GO" })
      later[0]!()
      order.push("after-late-call")
      yield* actor.send({ type: "NEXT" })
      assert.deepStrictEqual(order, ["late-exec", "after-late-call", "late-deferred"])
    }))
})

// ---------------------------------------------------------------- createActor of a logic of unknown types

describe("[CONF-6] createActor takes a logic whose types the caller does not know (upstream createActor<TLogic extends AnyActorLogic>)", () => {
  it.effect("[CONF-6] an AnyActorLogic gives the root AnyActor (upstream Actor<any>), which runs the logic", () =>
    Effect.gen(function* () {
      const logic: AnyActorLogic = fromPromise(() => Promise.resolve(42))
      const actor = yield* createActor(logic, { input: undefined })
      typeHolds<Equals<typeof actor, AnyActor>>(true)
      yield* actor.start
      assert.deepStrictEqual(yield* toEffect(actor), Option.some(42))
    }))
})

// ---------------------------------------------------------------- a callback actor that errors (DEV-46)

describe("[CONF-6] a callback actor that errors (upstream disposes only on xstate.stop; DEV-46)", () => {
  it.effect("[CONF-6] its cleanup runs once when it errors, and a sendBack after the error does not reach its parent", () =>
    Effect.gen(function* () {
      const cleanups: Array<string> = []
      const received: Array<string> = []
      const sendLater: Array<() => void> = []
      const machine = createMachine({
        invoke: {
          id: "callback",
          src: fromCallback(({ sendBack, receive }) => {
            sendLater.push(() => sendBack({ type: "LATE" }))
            receive(() => {
              throw new Error("listener")
            })
            return () => {
              cleanups.push("cleanup")
            }
          }),
        },
        on: {
          "*": {
            actions: ({ event }) => {
              received.push(event.type)
            },
          },
        },
      })
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      const child = (yield* actor.getSnapshot).children.callback!
      yield* child.send({ type: "X" })
      yield* Effect.yieldNow.pipe(Effect.repeat({ until: () => received.length > 0, times: 100 }))
      assert.strictEqual((yield* child.getSnapshot).status, "error")
      assert.deepStrictEqual(cleanups, ["cleanup"])
      sendLater[0]!()
      yield* Effect.yieldNow.pipe(Effect.repeat({ times: 100 }))
      // Upstream relays LATE and never calls the cleanup
      assert.deepStrictEqual(received, ["xstate.error.actor.callback"])
      yield* actor.stop
      assert.deepStrictEqual(cleanups, ["cleanup"])
    }))
})

// ---------------------------------------------------------------- the pure helpers on a snapshot that is not active

/**
 * Upstream `macrostep` (`src/stateUtils.ts:1675`) reads no status before the first microstep:
 * on a `done`, `error` or `stopped` snapshot it takes the microstep for the event, and only the
 * loop of eventless and raised events needs status `active`. After the entry phase, a snapshot
 * whose status is `done` runs the exit actions of every active node (upstream `microstep`,
 * `nextState.status === 'done'`). Facts from the probe `.upstream/measure/t621/probe-up.ts`.
 */
describe("[CONF-6] the pure helpers on a snapshot that is not active take the event's microstep (upstream macrostep)", () => {
  const finalMachine = () =>
    createMachine({
      id: "m",
      initial: "a",
      exit: () => {},
      output: () => "out",
      states: {
        a: {
          entry: () => {},
          exit: () => {},
          on: { DONE: "end" },
          always: { guard: () => false, target: "end" },
        },
        end: {
          type: "final",
          entry: () => {},
          exit: () => {},
          on: {
            BACK: { target: "a", actions: [() => {}, raise({ type: "R" })] },
            SELF: { actions: () => {} },
          },
        },
      },
    })

  const doneSnapshotOf = (machine: ReturnType<typeof finalMachine>) =>
    Effect.gen(function* () {
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* actor.send({ type: "DONE" })
      const done = yield* actor.getSnapshot
      assert.strictEqual(done.status, "done")
      return done
    })

  it.effect("[CONF-6] getMicrosteps on a done snapshot gives one microstep: the status stays done, the raised event is dropped, and the exit actions of every active node follow", () =>
    Effect.gen(function* () {
      const machine = finalMachine()
      const done = yield* doneSnapshotOf(machine)

      const back = yield* getMicrosteps(machine, done, { type: "BACK" })
      assert.deepStrictEqual(
        back.map(([snapshot, actions]) => [snapshot.value, snapshot.status, snapshot.output, actions.map((action): string => action.type)]),
        [["a", "done", Option.some("out"), ["exit", "(anonymous)", "xstate.raise", "entry", "exit", "exit"]]]
      )

      const self = yield* getMicrosteps(machine, done, { type: "SELF" })
      assert.deepStrictEqual(
        self.map(([snapshot, actions]) => [snapshot.value, snapshot.status, actions.map((action): string => action.type)]),
        [["end", "done", ["actions", "exit", "exit"]]]
      )

      // An event that no transition takes: one microstep, the same snapshot, no action
      const nope = yield* getMicrosteps(machine, done, { type: "NOPE" })
      assert.strictEqual(nope.length, 1)
      assert.strictEqual(nope[0]![0], done)
      assert.deepStrictEqual(nope[0]![1], [])
    }))

  it.effect("[CONF-6] getNextSnapshot, transition, machine.transition and machine.microstep take the same microstep on a done snapshot", () =>
    Effect.gen(function* () {
      const machine = finalMachine()
      const done = yield* doneSnapshotOf(machine)

      const next = yield* getNextSnapshot(machine, done, { type: "BACK" })
      assert.deepStrictEqual([next.value, next.status, next.output], ["a", "done", Option.some("out")])
      assert.strictEqual(yield* getNextSnapshot(machine, done, { type: "NOPE" }), done)

      const [transitioned, actions] = yield* transition(machine, done, { type: "BACK" })
      assert.deepStrictEqual([transitioned.value, transitioned.status], ["a", "done"])
      assert.deepStrictEqual(
        actions.map((action): string => action.type),
        ["exit", "(anonymous)", "xstate.raise", "entry", "exit", "exit"]
      )

      const inert = Effect.provideService(ActorScope, createInertActorScope(done))
      const viaMachine = yield* machine.transition(done, { type: "BACK" }).pipe(inert)
      assert.deepStrictEqual([viaMachine.value, viaMachine.status], ["a", "done"])
      const microsteps = yield* machine.microstep(done, { type: "BACK" }).pipe(inert)
      assert.deepStrictEqual(
        microsteps.map((snapshot) => [snapshot.value, snapshot.status]),
        [["a", "done"]]
      )
      const unhandled = yield* machine.microstep(done, { type: "NOPE" }).pipe(inert)
      assert.strictEqual(unhandled.length, 1)
      assert.strictEqual(unhandled[0], done)
    }))

  it.effect("[CONF-6] the stop event on a done snapshot gives status stopped", () =>
    Effect.gen(function* () {
      const machine = finalMachine()
      const done = yield* doneSnapshotOf(machine)
      // The internal stop event, which no machine declares (upstream `XSTATE_STOP`)
      const stopEvent = { type: "xstate.stop" } as unknown as { readonly type: "NOPE" }

      const steps = yield* getMicrosteps(machine, done, stopEvent)
      assert.deepStrictEqual(
        steps.map(([snapshot, actions]) => [snapshot.value, snapshot.status, actions.length]),
        [["end", "stopped", 0]]
      )
      assert.strictEqual((yield* getNextSnapshot(machine, done, stopEvent)).status, "stopped")
    }))

  it.effect("[CONF-6] an error or a stopped snapshot takes the microstep too: reaching the top-level final state makes it done, and the error stays", () =>
    Effect.gen(function* () {
      const machine = finalMachine()
      const errored = (yield* machine.resolveState({ value: "a", status: "error", error: "boom" }))
      const stopped = (yield* machine.resolveState({ value: "a", status: "stopped" }))
      assert.deepStrictEqual([errored.status, stopped.status], ["error", "stopped"])

      const fromError = yield* getMicrosteps(machine, errored, { type: "DONE" })
      assert.deepStrictEqual(
        fromError.map(([snapshot, actions]) => [
          snapshot.value,
          snapshot.status,
          snapshot.output,
          snapshot.error,
          actions.map((action): string => action.type),
        ]),
        [["end", "done", Option.some("out"), Option.some("boom"), ["exit", "entry", "exit", "exit"]]]
      )
      const fromStopped = yield* getMicrosteps(machine, stopped, { type: "DONE" })
      assert.deepStrictEqual(
        fromStopped.map(([snapshot, actions]) => [snapshot.value, snapshot.status, actions.map((action): string => action.type)]),
        [["end", "done", ["exit", "entry", "exit", "exit"]]]
      )

      for (const snapshot of [errored, stopped]) {
        const nope = yield* getMicrosteps(machine, snapshot, { type: "NOPE" })
        assert.strictEqual(nope.length, 1)
        assert.strictEqual(nope[0]![0], snapshot)
      }
    }))

  it.effect("[CONF-6] a done snapshot keeps its children after the microstep (upstream drops the snapshot that stopChildren resolves)", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        initial: "a",
        invoke: { id: "child", src: fromCallback(() => () => {}) },
        states: {
          a: { on: { DONE: "end" } },
          end: { type: "final", on: { BACK: "a" } },
        },
      })
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* actor.send({ type: "DONE" })
      const done = yield* actor.getSnapshot
      assert.deepStrictEqual([done.status, Object.keys(done.children)], ["done", ["child"]])

      const steps = yield* getMicrosteps(machine, done, { type: "BACK" })
      assert.deepStrictEqual(
        steps.map(([snapshot, actions]) => [snapshot.value, snapshot.status, actions.length, Object.keys(snapshot.children)]),
        [["a", "done", 0, ["child"]]]
      )
    }))
})

// ---------------------------------------------------------------- a restore from the JSON of a live snapshot

describe("[CONF-6] a restore from the JSON of a live machine snapshot with children (upstream rehydration, SD-7)", () => {
  it.effect("[CONF-6] the children's actor markers are skipped, as upstream skips a child with no src, and the rest of the snapshot restores", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        initial: "a",
        states: { a: { invoke: { id: "child", src: fromPromise(() => new Promise<number>(() => {})) } } },
      })
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      // `JSON.stringify` of a live snapshot writes each child as its marker `{ xstate$$type: 1, id }`
      const json = JSON.stringify(yield* actor.getSnapshot)
      assert.include(json, '"child":{"xstate$$type":1,"id":"child"}')

      const restored = yield* Effect.tap(createActor(machine, { snapshot: JSON.parse(json) }), (started) => started.start)
      const snapshot = yield* restored.getSnapshot
      assert.strictEqual(snapshot.status, "active")
      assert.isTrue(Option.isNone(snapshot.error))
      assert.strictEqual(snapshot.value, "a")
      assert.deepStrictEqual(Object.keys(snapshot.children), [])
    }))

  it.effect("[CONF-6] only the entries with no src are skipped: a persisted child beside a marker restores", () =>
    Effect.gen(function* () {
      const machine = createMachine(
        {
          initial: "a",
          states: {
            a: {
              invoke: [
                { id: "kept", src: "pending" },
                { id: "marker", src: "pending" },
              ],
            },
          },
        },
        { actors: { pending: fromPromise(() => new Promise<number>(() => {})) } }
      )
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      // `getPersistedSnapshot` gives `unknown`; the persisted form of a machine has `children`
      const persisted = (yield* actor.getPersistedSnapshot) as { readonly children: Readonly<Record<string, unknown>> }
      assert.deepStrictEqual(Object.keys(persisted.children), ["kept", "marker"])
      // the persisted form with one child entry replaced by the marker of a live snapshot's JSON
      const withMarker: unknown = {
        ...persisted,
        children: { ...persisted.children, marker: { xstate$$type: 1, id: "marker" } },
      }

      const restored = yield* Effect.tap(createActor(machine, { snapshot: withMarker }), (started) => started.start)
      const snapshot = yield* restored.getSnapshot
      assert.strictEqual(snapshot.status, "active")
      assert.deepStrictEqual(Object.keys(snapshot.children), ["kept"])
      assert.strictEqual((yield* snapshot.children.kept!.getSnapshot).status, "active")
    }))
})

// ---------------------------------------------------------------- types.test.ts: the names a plain createMachine declares

describe("[CONF-6] the names a plain createMachine's types member declares type its config (upstream MachineConfig of TActor, TAction, TGuard, TDelay, TTag)", () => {
  it.effect("[CONF-6] the config takes the declared action, guard, delay, actor and tag names, and an action implementation gets its declared params", () =>
    Effect.gen(function* () {
      const child = fromPromise(() => Promise.resolve(1))
      const greeted: Array<string> = []
      const machine = createMachine(
        {
          types: {} as {
            actions: { type: "greet"; params: { readonly name: string } } | { type: "poke" }
            guards: { type: "ready" }
            delays: "short"
            actors: { src: "child"; logic: typeof child }
            tags: "busy"
          },
          initial: "a",
          states: {
            a: {
              tags: "busy",
              entry: { type: "greet", params: { name: "Ann" } },
              invoke: { src: "child" },
              after: { short: { target: "b", guard: "ready" } },
            },
            b: {},
          },
        },
        {
          actions: { greet: (_, params) => Effect.sync(() => greeted.push(params.name)), poke: () => Effect.void },
          guards: { ready: () => true },
          delays: { short: 10 },
          actors: { child },
        }
      )
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      assert.deepStrictEqual(greeted, ["Ann"])
      assert.isTrue((yield* actor.getSnapshot).hasTag("busy"))
    }))

  it("[CONF-6] a name the types member does not declare is a type error in the config", () => {
    const child = fromPromise(() => Promise.resolve(1))
    type Declared = {
      actions: { type: "greet" }
      guards: { type: "ready" }
      delays: "short"
      actors: { src: "child"; logic: typeof child }
      tags: "busy"
    }
    const machines = [
      createMachine({
        types: {} as Declared,
        // @ts-expect-error -- an action name the types member does not declare
        entry: "unknown",
      }),
      createMachine({
        types: {} as Declared,
        on: { GO: { guard: "ready" } },
        // @ts-expect-error -- a tag the types member does not declare
        tags: "idle",
      }),
      createMachine({
        types: {} as Declared,
        // @ts-expect-error -- an actor src the types member does not declare
        invoke: { src: "other" },
      }),
      createMachine({
        types: {} as Declared,
        after: {
          // @ts-expect-error -- a delay the types member does not declare
          long: {},
        },
      }),
    ]
    assert.strictEqual(machines.length, 4)
  })
})

// ---------------------------------------------------------------- types.test.ts: the root output a plain createMachine declares

describe("[CONF-6] the root output of a plain createMachine is typed by its types.output (upstream Mapper<..., TOutput, ...> | TOutput)", () => {
  it.effect("[CONF-6] a value or a mapper of the declared output type is the machine's output; another type is a type error", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        types: {} as { output: number },
        initial: "done",
        states: { done: { type: "final" } },
        output: () => 42,
      })
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      assert.deepStrictEqual((yield* actor.getSnapshot).output, Option.some(42))
      const rejected = [
        createMachine({
          types: {} as { output: number },
          // @ts-expect-error -- a static output of another type
          output: "a string",
        }),
        createMachine({
          types: {} as { output: number },
          // @ts-expect-error -- a mapper that gives another type
          output: () => "a string",
        }),
      ]
      assert.strictEqual(rejected.length, 2)
    }))
})

// ---------------------------------------------------------------- types.test.ts: an on handler of one emitted type

describe("[CONF-6] actor.on(type, handler) gives the handler the emitted event of that type (upstream EmittedFrom<TLogic> & { type: TType })", () => {
  it.effect("[CONF-6] the handler of 'onClick' reads the members of the onClick event; the handler of '*' gets every emitted event", () =>
    Effect.gen(function* () {
      const machine = setup({
        types: { emitted: {} as { type: "onClick"; x: number } | { type: "onChange" } },
      }).createMachine({
        on: { CLICK: { actions: emit({ type: "onClick", x: 3 }) } },
      })
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      const clicks: Array<number> = []
      const types: Array<string> = []
      yield* actor.on("onClick", (event) => Effect.sync(() => clicks.push(event.x)))
      yield* actor.on("*", (event) =>
        Effect.sync(() => {
          typeHolds<Equals<typeof event, { type: "onClick"; x: number } | { type: "onChange" }>>(true)
          types.push(event.type)
        }))
      yield* actor.send({ type: "CLICK" })
      assert.deepStrictEqual(clicks, [3])
      assert.deepStrictEqual(types, ["onClick"])
    }))
})

// ---------------------------------------------------------------- types.test.ts: entry and exit actions infer no event type

describe("[CONF-6] the entry and exit actions of a config are no inference site of the machine's events (upstream NoInfer)", () => {
  it.effect("[CONF-6] a raise typed with any events in entry and exit leaves the declared events: the actor takes FOO and rejects another event", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        types: { events: {} as { type: "FOO" } },
        entry: raise<any, any, any, any, any, any>({ type: "FOO" }),
        exit: raise<any, any, any, any, any, any>({ type: "FOO" }),
      })
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* actor.send({ type: "FOO" })
      // @ts-expect-error -- an event the machine does not declare
      yield* actor.send({ type: "UNKNOWN" })
      assert.strictEqual((yield* actor.getSnapshot).status, "active")
    }))
})

// ---------------------------------------------------------------- types.test.ts: the ids of a declared actor in assign's spawn

describe("[CONF-6] the spawn of an assigner takes the ids a plain createMachine declares for an actor (upstream Spawner of TActor)", () => {
  it.effect("[CONF-6] spawn('child', { id }) takes a declared id, and a missing or another id is a type error", () =>
    Effect.gen(function* () {
      const child = createMachine({})
      type Declared = { actors: { src: "child"; id: "ok1" | "ok2"; logic: typeof child } }
      const machine = createMachine(
        {
          types: {} as Declared,
          entry: assign(({ spawn }) => {
            spawn("child", { id: "ok1" })
            return {}
          }),
        },
        { actors: { child } }
      )
      const rejected = [
        createMachine({
          types: {} as Declared,
          entry: assign(({ spawn }) => {
            // @ts-expect-error -- an id the actor does not declare
            spawn("child", { id: "child" })
            return {}
          }),
        }),
        createMachine({
          types: {} as Declared,
          entry: assign(({ spawn }) => {
            // @ts-expect-error -- the actor declares its ids, so the id is required
            spawn("child")
            return {}
          }),
        }),
      ]
      assert.strictEqual(rejected.length, 2)
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      assert.deepStrictEqual(Object.keys((yield* actor.getSnapshot).children), ["ok1"])
    }))
})

// ---------------------------------------------------------------- types.test.ts: the ids of a declared actor in an invocation

describe("[CONF-6] an invocation takes the ids a plain createMachine declares for an actor (upstream DistributeActors)", () => {
  it.effect("[CONF-6] invoke { src: 'child', id } takes a declared id, and a missing or another id is a type error", () =>
    Effect.gen(function* () {
      const child = createMachine({})
      type Declared = { actors: { src: "child"; id: "ok1" | "ok2"; logic: typeof child } }
      const machine = createMachine(
        {
          types: {} as Declared,
          invoke: { id: "ok2", src: "child" },
        },
        { actors: { child } }
      )
      const rejected = [
        createMachine({
          types: {} as Declared,
          // @ts-expect-error -- an id the actor does not declare
          invoke: { id: "child", src: "child" },
        }),
        createMachine({
          types: {} as Declared,
          // @ts-expect-error -- the actor declares its ids, so the id is required
          invoke: { src: "child" },
        }),
      ]
      assert.strictEqual(rejected.length, 2)
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      assert.deepStrictEqual(Object.keys((yield* actor.getSnapshot).children), ["ok2"])
    }))
})

// ---------------------------------------------------------------- types.test.ts: spawnChild of a declared actor

describe("[CONF-6] spawnChild takes the ids and the input of an actor a plain createMachine declares (upstream SpawnArguments)", () => {
  it.effect("[CONF-6] spawnChild('child', { id, input }) takes a declared id and the logic's input; a wrong or missing one, or an inline logic with an id, is a type error", () =>
    Effect.gen(function* () {
      const child = fromPromise(({ input }: { input: number }) => Promise.resolve(input))
      type Declared = { actors: { src: "child"; id: "ok1" | "ok2"; logic: typeof child } }
      const machine = createMachine(
        {
          types: {} as Declared,
          entry: [spawnChild("child", { id: "ok1", input: 1 }), spawnChild("child", { id: "ok2", input: () => 2 })],
        },
        { actors: { child } }
      )
      const rejected = [
        createMachine({
          types: {} as Declared,
          // @ts-expect-error -- an id the actor does not declare
          entry: spawnChild("child", { id: "child", input: 1 }),
        }),
        createMachine({
          types: {} as Declared,
          // @ts-expect-error -- the actor declares its ids and its logic requires an input
          entry: spawnChild("child"),
        }),
        createMachine({
          types: {} as Declared,
          // @ts-expect-error -- an input of another type
          entry: spawnChild("child", { id: "ok1", input: "hello" }),
        }),
        createMachine({
          types: {} as Declared,
          // @ts-expect-error -- an input function of another type
          entry: spawnChild("child", { id: "ok1", input: () => "hello" }),
        }),
        createMachine({
          types: {} as Declared,
          // @ts-expect-error -- an inline logic takes no id where the actors are declared
          entry: spawnChild(fromPromise(() => Promise.resolve(0)), { id: "ok1" }),
        }),
      ]
      assert.strictEqual(rejected.length, 5)
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      assert.deepStrictEqual(Object.keys((yield* actor.getSnapshot).children), ["ok1", "ok2"])
    }))
})

// ---------------------------------------------------------------- enqueue.spawnChild of a declared actor

describe("[CONF-6] enqueue.spawnChild takes the ids and the input of a declared actor (upstream ActionEnqueuer: Parameters of spawnChild, SpawnArguments)", () => {
  it.effect("[CONF-6] enqueue.spawnChild('child', { id, input }) takes a declared id and the logic's input, an inline logic any input; a wrong or missing one, an unknown src, or an inline logic with an id, is a type error", () =>
    Effect.gen(function* () {
      const child = fromPromise(({ input }: { input: number }) => Promise.resolve(input))
      // takes a number and never settles, so the inline child stays in snapshot.children
      const pending = fromPromise(({ input }: { input: number }) => new Promise<number>(() => void input))
      type Declared = { actors: { src: "child"; id: "ok1" | "ok2"; logic: typeof child } }
      const machine = createMachine(
        {
          types: {} as Declared,
          entry: enqueueActions(({ enqueue }) => {
            enqueue.spawnChild("child", { id: "ok1", input: 1 })
            enqueue.spawnChild("child", { id: "ok2", input: () => 2 })
            // an inline logic takes any input (upstream InputFrom<ProvidedActor["logic"]>, any)
            enqueue.spawnChild(pending, { input: "not a number" })
          }),
        },
        { actors: { child } }
      )
      const rejected = [
        createMachine({
          types: {} as Declared,
          entry: enqueueActions(({ enqueue }) => {
            // @ts-expect-error -- an id the actor does not declare
            enqueue.spawnChild("child", { id: "child", input: 1 })
            // @ts-expect-error -- the actor declares its ids and its logic requires an input
            enqueue.spawnChild("child")
            // @ts-expect-error -- an input of another type
            enqueue.spawnChild("child", { id: "ok1", input: "hello" })
            // @ts-expect-error -- an input function of another type
            enqueue.spawnChild("child", { id: "ok1", input: () => "hello" })
            // @ts-expect-error -- a src the machine does not declare
            enqueue.spawnChild("other", { id: "ok1", input: 1 })
            // @ts-expect-error -- an inline logic takes no id where the actors are declared
            enqueue.spawnChild(pending, { id: "ok1" })
          }),
        }),
      ]
      const bound = setup({ actors: { child } })
      const fromSetup = [
        bound.createMachine({
          entry: bound.enqueueActions(({ enqueue }) => {
            enqueue.spawnChild("child", { input: 1 })
            // @ts-expect-error -- the setup actor's logic requires an input
            enqueue.spawnChild("child")
            // @ts-expect-error -- an input of another type
            enqueue.spawnChild("child", { input: "hello" })
          }),
        }),
        bound.createMachine({
          entry: enqueueActions(({ enqueue }) => {
            enqueue.spawnChild("child", { input: () => 1 })
            // @ts-expect-error -- an input function of another type
            enqueue.spawnChild("child", { input: () => "hello" })
          }),
        }),
      ]
      assert.strictEqual(rejected.length + fromSetup.length, 3)
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      assert.deepStrictEqual(Object.keys((yield* actor.getSnapshot).children), ["ok1", "ok2", "undefined"])
    }))
})

// ---------------------------------------------------------------- a setup's spawnChild of a setup actor

describe("[CONF-6] a setup's spawnChild takes the ids and the input of a setup actor, and an inline logic no id (upstream setup spawnChild: SpawnArguments of ToProvidedActor)", () => {
  it.effect("[CONF-6] bound.spawnChild takes a setup actor's input and an id that types.children gives it, and an inline logic with no id, with or without setup actors; a missing input or id, an id the map does not give, or an inline logic with an id, is a type error", () =>
    Effect.gen(function* () {
      const child = fromPromise(({ input }: { input: number }) => Promise.resolve(input))
      // takes a number and never settles, so each inline child stays in snapshot.children
      const pending = fromPromise(({ input }: { input: number }) => new Promise<number>(() => void input))
      const bare = setup({})
      const withActors = setup({ actors: { child } })
      const withChildren = setup({ types: { children: {} as { ok1: "child" } }, actors: { child } })
      const rejected = [
        // @ts-expect-error -- an inline logic takes no id in a setup without actors (upstream DistributeActors: id?: never)
        bare.spawnChild(pending, { id: "inline" }),
        // @ts-expect-error -- nor an id function
        bare.spawnChild(pending, { id: () => "inline" }),
        // @ts-expect-error -- an inline logic takes no id beside setup actors
        withActors.spawnChild(pending, { id: "inline" }),
        // @ts-expect-error -- the setup actor's logic requires an input
        withActors.spawnChild("child"),
        // @ts-expect-error -- the setup actor's logic requires an input
        withActors.spawnChild("child", {}),
        // @ts-expect-error -- types.children gives the actor its id, so the spawn requires one
        withChildren.spawnChild("child", { input: 1 }),
        // @ts-expect-error -- an id types.children does not give the actor
        withChildren.spawnChild("child", { id: "other", input: 1 }),
        // @ts-expect-error -- an inline logic takes no id beside a children map
        withChildren.spawnChild(pending, { id: "ok1" }),
      ]
      assert.strictEqual(rejected.length, 8)
      const childrenOf = (machine: AnyStateMachine) =>
        Effect.gen(function* () {
          const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
          return Object.keys((yield* actor.getSnapshot).children)
        })
      assert.deepStrictEqual(yield* childrenOf(bare.createMachine({ entry: bare.spawnChild(pending, { input: 1 }) })), ["undefined"])
      assert.deepStrictEqual(
        yield* childrenOf(
          withActors.createMachine({
            entry: [withActors.spawnChild("child", { id: "c", input: 1 }), withActors.spawnChild(pending, { input: "any" })],
          })
        ),
        ["c", "undefined"]
      )
      assert.deepStrictEqual(
        yield* childrenOf(withChildren.createMachine({ entry: withChildren.spawnChild("child", { id: "ok1", input: 1 }) })),
        ["ok1"]
      )
    }))
})

// ---------------------------------------------------------------- types.test.ts: the children of a plain createMachine per id

describe("[CONF-6] the snapshot children of a plain createMachine are typed per declared id (upstream ToChildren of TActor)", () => {
  it.effect("[CONF-6] a child under its declared id is an optional reference of its logic, and a key no actor declares is a type error", () =>
    Effect.gen(function* () {
      const counter = createMachine({ types: {} as { context: { count: number } }, context: { count: 7 } })
      const machine = createMachine(
        {
          types: {} as { actors: { src: "counter"; id: "first"; logic: typeof counter } },
          invoke: { id: "first", src: "counter" },
        },
        { actors: { counter } }
      )
      const snapshot = yield* (yield* Effect.tap(createActor(machine), (started) => started.start)).getSnapshot
      const first = snapshot.children.first
      typeHolds<Equals<typeof first, ActorRefFrom<typeof counter> | undefined>>(true)
      const childSnapshot = yield* first!.getSnapshot
      childSnapshot.context.count satisfies number
      assert.strictEqual(childSnapshot.context.count, 7)
      // @ts-expect-error -- no actor declares this id
      assert.isUndefined(snapshot.children.other)
    }))
})

// ---------------------------------------------------------------- types.test.ts: hasTag and can typed by the machine

describe("[CONF-6] a machine snapshot's hasTag takes the machine's tags and can takes its events (upstream MachineSnapshot of TTag and TEvent)", () => {
  it.effect("[CONF-6] a plain machine's hasTag takes a tag its types declare; another tag is a type error", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        types: {} as { tags: "a" | "b" },
        initial: "on",
        states: { on: { tags: "a" } },
      })
      const snapshot = yield* (yield* Effect.tap(createActor(machine), (started) => started.start)).getSnapshot
      assert.isTrue(snapshot.hasTag("a"))
      assert.isFalse(snapshot.hasTag("b"))
      // @ts-expect-error -- a tag the machine does not declare
      assert.isFalse(snapshot.hasTag("other"))
    }))

  it.effect("[CONF-6] a setup machine's hasTag takes the setup's tags and can its events; others are type errors", () =>
    Effect.gen(function* () {
      const machine = setup({
        types: {} as { events: { type: "one" } | { type: "two" }; tags: "one" | "two" },
      }).createMachine({
        initial: "one",
        states: { one: { tags: "one", on: { two: "two" } }, two: {} },
      })
      const snapshot = yield* (yield* Effect.tap(createActor(machine), (started) => started.start)).getSnapshot
      assert.isTrue(snapshot.hasTag("one"))
      assert.isTrue(yield* snapshot.can({ type: "two" }))
      assert.isFalse(yield* snapshot.can({ type: "one" }))
      // @ts-expect-error -- a tag the setup does not declare
      assert.isFalse(snapshot.hasTag("three"))
      // @ts-expect-error -- an event the setup does not declare
      assert.isFalse(yield* snapshot.can({ type: "three" }))
    }))
})

// ---------------------------------------------------------------- types.test.ts: createActor of a generic logic

describe("[CONF-6] createActor takes a logic of a generic type and gives an actor that is its ActorRefFromLogic (upstream createActor<TLogic>: Actor<TLogic>)", () => {
  it.effect("[CONF-6] a helper generic in its logic creates the actor and keeps it as the logic's reference", () =>
    Effect.gen(function* () {
      const referenceOf = <T extends AnyActorLogic>(logic: T) =>
        Effect.gen(function* () {
          const actor = yield* createActor(logic)
          actor satisfies ActorRefFromLogic<T>
          yield* actor.start
          const ref: ActorRefFromLogic<T> = actor
          return ref
        })
      const machine = createMachine({ context: { count: 3 } })
      const ref = yield* referenceOf(machine)
      typeHolds<Equals<typeof ref, ActorRefFromLogic<typeof machine>>>(true)
      assert.strictEqual((yield* ref.getSnapshot).context.count, 3)
    }))
})

// ---------------------------------------------------------------- types.test.ts: the params of an inline guard in not, and, or

describe("[CONF-6] an inline function guard inside not, and or or gets params of type unknown (upstream SingleGuardArg with TParams unknown)", () => {
  it.effect("[CONF-6] the inline guard's params are unknown, not undefined, in not, and and or; the composite guard still decides", () =>
    Effect.gen(function* () {
      const seen: Array<unknown> = []
      const machine = createMachine({
        initial: "a",
        states: {
          a: {
            on: {
              GO: {
                target: "b",
                guard: and([
                  not((_, params) => {
                    typeHolds<Equals<typeof params, unknown>>(true)
                    seen.push(params)
                    return false
                  }),
                  or([
                    (_, params) => {
                      typeHolds<Equals<typeof params, unknown>>(true)
                      return true
                    },
                  ]),
                ]),
              },
            },
          },
          b: {},
        },
      })
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* actor.send({ type: "GO" })
      assert.strictEqual((yield* actor.getSnapshot).value, "b")
      assert.deepStrictEqual(seen, [undefined])
    }))
})

// ---------------------------------------------------------------- types.test.ts: the params of an inline assign

describe("[CONF-6] an assign written inline in a config gets params of type undefined (upstream inline builtin action)", () => {
  it.effect("[CONF-6] the inline assigner's params are undefined, as an inline custom action's, and it runs with undefined", () =>
    Effect.gen(function* () {
      const seen: Array<unknown> = []
      const machine = createMachine({
        types: {} as { context: { count: number }; actions: { type: "greet"; params: { name: string } } | { type: "poke" } },
        context: { count: 0 },
        entry: assign(({ context }, params) => {
          typeHolds<Equals<typeof params, undefined>>(true)
          seen.push(params)
          return { count: context.count + 1 }
        }),
      })
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      assert.strictEqual((yield* actor.getSnapshot).context.count, 1)
      assert.deepStrictEqual(seen, [undefined])
    }))
})

// ---------------------------------------------------------------- types.test.ts: enqueueActions in the implementations

describe("[CONF-6] an enqueueActions written in createMachine's implementations checks the guards the types member declares (upstream MachineImplementations of TGuard)", () => {
  it.effect("[CONF-6] check takes a declared guard there; another name is a type error", () =>
    Effect.gen(function* () {
      const checked: Array<boolean> = []
      const machine = createMachine(
        {
          types: {} as { guards: { type: "ready" } | { type: "atLeast"; params: { min: number } } },
          entry: "track",
        },
        {
          actions: {
            track: enqueueActions(({ check, enqueue }) => {
              const ready = check("ready")
              checked.push(ready)
              if (ready) {
                enqueue(() => Effect.void)
              }
            }),
            other: enqueueActions(({ check }) => {
              // @ts-expect-error -- a guard the types member does not declare
              check("other")
            }),
          },
          guards: { ready: () => true, atLeast: () => false },
        }
      )
      yield* Effect.tap(createActor(machine), (started) => started.start)
      assert.deepStrictEqual(checked, [true])
    }))
})

// ---------------------------------------------------------------- types.test.ts: the declared context wins over the context value

describe("[CONF-6] the context type types.context declares is not widened by the context value (upstream LowInfer)", () => {
  it.effect("[CONF-6] a context value of the declared literal types is taken; one outside them is a type error", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        types: {} as { context: { mode: "foo" | "bar" } },
        context: { mode: "foo" },
      })
      const snapshot = yield* (yield* Effect.tap(createActor(machine), (started) => started.start)).getSnapshot
      typeHolds<Equals<typeof snapshot.context, { mode: "foo" | "bar" }>>(true)
      assert.strictEqual(snapshot.context.mode, "foo")
      const rejected = createMachine({
        types: {} as { context: { mode: "foo" | "bar" } },
        context: {
          // @ts-expect-error -- a value outside the declared literal types
          mode: "anything",
        },
      })
      assert.isDefined(rejected)
    }))
})

// ---------------------------------------------------------------- types.test.ts: the event a raise function gives

describe("[CONF-6] the event a raise function gives is one of the machine's events (upstream raise of DoNotInfer<TEvent>)", () => {
  it.effect("[CONF-6] a function giving a declared event raises it; one giving another event, or any string type, is a type error", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        types: {} as { context: { next: "BAR" }; events: { type: "FOO" } | { type: "BAR" } },
        context: { next: "BAR" },
        initial: "a",
        states: { a: { entry: raise(({ context }) => ({ type: context.next })), on: { BAR: "b" } }, b: {} },
      })
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      assert.strictEqual((yield* actor.getSnapshot).value, "b")
      const event: { type: string } = { type: "something" }
      const rejected = [
        createMachine({
          types: {} as { events: { type: "FOO" } | { type: "BAR" } },
          // @ts-expect-error -- an event the machine does not declare
          entry: raise(() => ({ type: "UNKNOWN" })),
        }),
        createMachine({
          types: {} as { events: { type: "FOO" } | { type: "BAR" } },
          // @ts-expect-error -- an event of any type
          entry: raise(() => event),
        }),
      ]
      assert.strictEqual(rejected.length, 2)
    }))
})

// ---------------------------------------------------------------- types.test.ts: the root MachineContext

describe("[CONF-6] a machine's context is a MachineContext, an object with any members (upstream MachineContext = Record<string, any>; SD-22 amendment)", () => {
  it.effect("[CONF-6] the root MachineContext is upstream's record of any members; a context that is no object is a type error; a machine without context starts with {}", () =>
    Effect.gen(function* () {
      typeHolds<Equals<MachineContext, Record<string, any>>>(true)
      const machine = createMachine({ initial: "a", states: { a: {} } })
      const snapshot = yield* (yield* Effect.tap(createActor(machine), (started) => started.start)).getSnapshot
      assert.deepStrictEqual(snapshot.context, {})
      const rejected = createMachine({
        // @ts-expect-error -- a context that is no object
        context: "string",
      })
      assert.isDefined(rejected)
    }))
})

// ---------------------------------------------------------------- types.test.ts: the root StateMachine type

describe("[CONF-6] the root StateMachine is also a type with upstream's parameters, the context first (upstream class StateMachine<TContext, TEvent, ...>)", () => {
  it.effect("[CONF-6] a machine fits StateMachine<TContext, TEvent, any, ...>, which infers its context and events; the root StateMachine module stays", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        types: {} as { context: { count: number }; events: { type: "TOGGLE" } },
        context: { count: 0 },
      })
      const accept = <TContext extends MachineContext, TEvent extends EventObject>(
        given: StateMachine<TContext, TEvent, any, any, any, any, any, any, any, any, any, any, any, any>
      ) => given
      const accepted = accept(machine)
      typeHolds<Equals<StateMachine.StateMachine.ContextOf<typeof accepted>, { count: number }>>(true)
      typeHolds<Equals<StateMachine.StateMachine.EventOf<typeof accepted>, { type: "TOGGLE" }>>(true)
      assert.isTrue(StateMachine.isStateMachine(accepted))
      const snapshot = yield* (yield* Effect.tap(createActor(accepted), (started) => started.start)).getSnapshot
      assert.strictEqual(snapshot.context.count, 0)
    }))
})

// ---------------------------------------------------------------- types.test.ts: AnyStateNode keeps any metadata

describe("[CONF-6] AnyStateNode and AnyStateNodeDefinition keep upstream's any metadata (upstream StateNode<any, any, any, any>; SD-22 amendment)", () => {
  it("[CONF-6] the meta of AnyStateNode, of its definition's transitions and of AnyStateMachine['root'] is any; a machine's root node is an AnyStateNode with its definition", () => {
    type IsAny<T> = 0 extends 1 & T ? true : false
    type MetaOf<T> = T extends { readonly meta?: infer TMeta } ? TMeta : never
    typeHolds<IsAny<MetaOf<AnyStateNode>>>(true)
    typeHolds<IsAny<MetaOf<AnyStateMachine["root"]>>>(true)
    typeHolds<IsAny<MetaOf<AnyStateNodeDefinition>>>(true)
    typeHolds<IsAny<MetaOf<AnyStateNode["definition"]["transitions"][number]>>>(true)
    const machine = createMachine({
      initial: "a",
      states: { a: { meta: { label: "A" }, on: { GO: { target: "b", meta: { weight: 1 } } } }, b: {} },
    })
    const root: AnyStateNode = machine.root
    const definition: AnyStateNodeDefinition = root.definition
    assert.deepStrictEqual(definition.states.a?.meta, { label: "A" })
    assert.deepStrictEqual(definition.states.a?.transitions.map((transition) => transition.meta), [{ weight: 1 }])
  })
})

// ---------------------------------------------------------------- the context factory's spawn of declared actors

describe("[CONF-6] the context factory's spawn takes the actors a plain createMachine declares (upstream InitialContext with Spawner<TActor>)", () => {
  it.effect("[CONF-6] spawn('child', { id, input }) in the context factory takes a declared actor with its ids and input; another src is a type error", () =>
    Effect.gen(function* () {
      const child = fromPromise(({ input }: { input: number }) => Promise.resolve(input))
      type Declared = { context: { ref: ActorRefFrom<typeof child> }; actors: { src: "child"; id: "first"; logic: typeof child } }
      const machine = createMachine(
        {
          types: {} as Declared,
          context: ({ spawn }) => ({ ref: spawn("child", { id: "first", input: 1 }) }),
        },
        { actors: { child } }
      )
      const rejected = createMachine({
        types: {} as Declared,
        // @ts-expect-error -- an actor the types member does not declare
        context: ({ spawn }) => ({ ref: spawn("other") }),
      })
      assert.isDefined(rejected)
      const snapshot = yield* (yield* Effect.tap(createActor(machine), (started) => started.start)).getSnapshot
      assert.deepStrictEqual(Object.keys(snapshot.children), ["first"])
    }))
})

// ---------------------------------------------------------------- types.test.ts: the containers of state nodes keep any metadata

/** Whether a node's meta and its definition's transition meta are both `any` (types.test `NodeMetaIsAny`). */
type IsAnyType<T> = 0 extends 1 & T ? true : false
type NodeMetaIsAny<T extends AnyStateNode> = [IsAnyType<T["meta"]>, IsAnyType<T["definition"]["transitions"][number]["meta"]>]

describe("[CONF-6] the snapshot, history and config containers of state nodes keep upstream's any metadata (upstream StateNode<..., any, any>; SD-22 amendment)", () => {
  it.effect("[CONF-6] AnyMachineSnapshot's _nodes, AnyHistoryValue, AnyStateConfig's _nodes, Transitions and HistoryStateNode have any meta; a history value holds the machine's own nodes", () =>
    Effect.gen(function* () {
      typeHolds<Equals<NodeMetaIsAny<AnyMachineSnapshot["_nodes"][number]>, [true, true]>>(true)
      typeHolds<Equals<NodeMetaIsAny<AnyHistoryValue[string][number]>, [true, true]>>(true)
      typeHolds<Equals<NodeMetaIsAny<AnyStateConfig["_nodes"][number]>, [true, true]>>(true)
      typeHolds<IsAnyType<Transitions<MachineContext, EventObject>[number]["meta"]>>(true)
      typeHolds<Equals<NodeMetaIsAny<HistoryStateNode<MachineContext>>, [true, true]>>(true)
      const machine = createMachine({
        id: "m",
        initial: "a",
        states: {
          a: { initial: "a1", states: { a1: { meta: { label: "a1" } }, hist: { type: "history" } }, on: { OUT: "b" } },
          b: {},
        },
      })
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* actor.send({ type: "OUT" })
      const recorded = (yield* actor.getSnapshot).historyValue["m.a.hist"] ?? []
      assert.deepStrictEqual(recorded.map((node) => [node.id, node.meta]), [["m.a.a1", { label: "a1" }]])
      assert.strictEqual(recorded[0], machine.root.states.a?.states.a1)
    }))
})

describe("[CONF-6] the engine helpers named after upstream's take and give nodes and transitions of any meta (upstream normalizeTarget, getStateValue, formatTransitions, getDelayedTransitions)", () => {
  it.effect("[CONF-6] normalizeTarget gives a target list or undefined, getStateValue a state value, formatTransitions and getDelayedTransitions a node's transitions, all of any meta", () =>
    Effect.gen(function* () {
      typeHolds<
        Equals<NodeMetaIsAny<Exclude<NonNullable<ReturnType<typeof StateMachine.normalizeTarget>>[number], string>>, [true, true]>
      >(true)
      typeHolds<
        Equals<
          NodeMetaIsAny<Parameters<typeof StateUtils.getStateValue>[1] extends Iterable<infer TNode> ? TNode : never>,
          [true, true]
        >
      >(true)
      typeHolds<
        IsAnyType<
          ReturnType<typeof StateUtils.formatTransitions> extends Array<[string, Array<infer TTransition>]>
            ? TTransition extends { readonly meta?: infer TMeta } ? TMeta : never
            : never
        >
      >(true)
      typeHolds<IsAnyType<ReturnType<typeof StateUtils.getDelayedTransitions>[number]["meta"]>>(true)

      assert.deepStrictEqual(StateMachine.normalizeTarget("a"), ["a"])
      assert.deepStrictEqual(StateMachine.normalizeTarget(["a", "b"]), ["a", "b"])
      assert.isUndefined(StateMachine.normalizeTarget(""))
      assert.isUndefined(StateMachine.normalizeTarget(undefined))

      const machine = createMachine({
        id: "m",
        initial: "a",
        states: { a: { on: { GO: "b" }, after: { 100: "b" } }, b: {} },
      })
      const a = machine.root.states.a!
      assert.deepStrictEqual(StateUtils.getStateValue(machine.root, [machine.root, a]), "a")
      assert.deepStrictEqual(
        StateUtils.formatTransitions(a).map(([descriptor]) => descriptor),
        a.transitions.map(([descriptor]) => descriptor)
      )
      assert.deepStrictEqual(
        StateUtils.getDelayedTransitions(a).map((transition) => [transition.delay, transition.eventType]),
        [[100, "xstate.after.100.m.a"]]
      )
    }))
})
