/**
 * TD-2: the P1 scenarios of the test design (`skills/test-artifacts/test-design-qa.md`) that the
 * trace (`skills/test-artifacts/traceability/traceability-matrix.md`) found below FULL, each
 * proved as the one combined scenario the design states, and P1-005 in its corrected wording.
 *
 * Where upstream and the port agree, the expected values come from xstate@5.33.2 itself: the
 * orders and results below were read from its source and checked by running that source.
 *
 * - P1-001 (R-001, SD-27): an error in the macrostep that invokes children under systemIds. The
 *   children are created (upstream sends `@xstate.actor` in the constructor) but never start,
 *   never run and deliver nothing; their systemIds are free again. Upstream leaves them
 *   registered (its `_error` stops only the children of the snapshot it keeps); the port closes
 *   the errored actor's scope (ledger DEV-26).
 * - P1-005 (R-002): `transitionNode` selects the deepest enabled transitions; when the active
 *   child selects nothing it falls back to the node's own transitions (atomic, compound and
 *   parallel), a region whose value is `""` is skipped, and nothing at all gives `undefined`.
 *   Upstream's other half, a value key that names no child, throws in `getStateNode` before any
 *   fallback; the port falls back there instead, so that half is reported, not asserted.
 * - P1-006 (R-002): deep and shallow history nodes under a compound state, under the parallel
 *   state and inside its regions record the configuration as upstream does (deep: the atomic
 *   nodes in activation order; shallow: the children) and restore it in document order: the
 *   entry actions, `_nodes` and the key order of `value`.
 * - P1-013 (R-005, SD-21, DEV-46): a callback cleanup and an observable or event-observable
 *   `unsubscribe` that throw are each reported once through the logger with the thrown value;
 *   the stop succeeds whether a parent's exit, `actor.stop` or the close of the caller's scope
 *   stops them; the actor ends `stopped`, the parent hears nothing, other finalizers still run.
 * - P1-015 (R-008): `reportUnhandledError` and `isolateCallback` (upstream
 *   `reportUnhandledError`, SD-21), `delay.ts` (upstream `resolveRaise` / `resolveSendTo`, with
 *   the port's `Duration`) and `actionDelay.ts` (upstream `raise.delay` / `sendTo.delay`, which
 *   the graph's `validateMachine` reads), each imported directly and through the actions.
 * - P1-016 (R-007): every member of `ActorScopeService`, `ActorSystemService` and
 *   `SchedulerService`, enumerated against the interfaces at compile time, is present on
 *   `createInertActorScope` and does nothing to a live actor, its system, the clock or the logger.
 * - P1-018 (R-007): a `waitFor` timeout on the TestClock fails with upstream's text and leaves
 *   nothing behind: later snapshots reach no predicate, the 'abort' listener is removed once, and
 *   the actor has no observer left, so its later error is reported as unhandled (upstream
 *   `_reportError` with no observer), where a wait still running receives it.
 * - P1-020 (R-010, DEV-30): `stateNotIn` negates `stateIn`; guards nest at most 10,000
 *   evaluations: a chain of exactly 10,000 decides, a chain of 10,001 fails with `GuardError`
 *   (`Maximum call stack size exceeded`), and a self-referring guard stops after 10,000 nested
 *   evaluations, which a transition reports with upstream's guard-evaluation error.
 *
 * Timers run on TestClock; every other wait is a bounded number of yields.
 */
import { assert, describe, it, vi } from "@effect/vitest"
import { Duration, Effect, Exit, Fiber, Logger, Option, Predicate } from "effect"
import { TestClock } from "effect/testing"
import type { ActorScopeService, ActorSystemService, SchedulerService } from "../../src/ActorLogic.js"
import type { ActorRefBase } from "../../src/ActorRef.js"
import { GuardError } from "../../src/Errors.js"
import { createTestModel } from "../../src/graph/index.js"
import { evaluateGuard, guardScopeOf } from "../../src/guards/evaluateGuard.js"
import { delayOf, withDelay } from "../../src/internal/actionDelay.js"
import { lookupDelay, resolveDelay, toDelayMillis } from "../../src/internal/delay.js"
import { isolateCallback, reportUnhandledError } from "../../src/internal/reportError.js"
import {
  type ActionArgs,
  assign,
  createActor,
  createMachine,
  type EventObject,
  forwardTo,
  fromCallback,
  fromEffect,
  fromEventObservable,
  fromObservable,
  getInitialSnapshot,
  type Guard,
  type GuardScope,
  isActorRef,
  not,
  raise,
  sendTo,
  spawnChild,
  stateIn,
  stateNotIn,
  waitFor,
  WaitForTimeoutError,
} from "../../src/index.js"
import * as Snap from "../../src/Snapshot.js"
import * as StateUtils from "../../src/stateUtils.js"
import type { StateValue } from "../../src/StateValue.js"
import { createInertActorScope } from "../../src/testing/getNextSnapshot.js"
import { guardEvaluationFailed, waitForTimeout } from "./upstream-messages.js"

// ---------------------------------------------------------------- shared helpers

/** Lets every other ready fiber take a bounded number of turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 50; turn++) {
    yield* Effect.yieldNow
  }
})

/** What a test logger kept: the raw message values of each entry, by level. */
interface Logged {
  readonly warnings: Array<ReadonlyArray<unknown>>
  readonly errors: Array<ReadonlyArray<unknown>>
  readonly all: Array<ReadonlyArray<unknown>>
}

/** Runs `program` with a logger that keeps the raw message values of every entry. */
const withLogged = <A, E, R>(program: (logged: Logged) => Effect.Effect<A, E, R>) => {
  const logged: Logged = { warnings: [], errors: [], all: [] }
  return program(logged).pipe(
    Effect.provide(
      Logger.layer([
        Logger.make((options) => {
          const parts: ReadonlyArray<unknown> = Array.isArray(options.message) ? options.message : [options.message]
          logged.all.push(parts)
          if (options.logLevel === "Warn") {
            logged.warnings.push(parts)
          }
          if (options.logLevel === "Error" || options.logLevel === "Fatal") {
            logged.errors.push(parts)
          }
        }),
      ])
    )
  )
}

/** The own fields of an object value; the test fails for any other value. */
const recordOf = (value: unknown): Readonly<Record<string, unknown>> => {
  if (!Predicate.isObject(value) || Array.isArray(value)) {
    return assert.fail(`not an object: ${String(value)}`)
  }
  return Object.fromEntries(Object.entries(value))
}

/** The child `id` of a snapshot; the test fails when there is no such actor reference. */
const childOf = (snapshot: unknown, id: string): ActorRefBase => {
  const children = Predicate.hasProperty(snapshot, "children") ? recordOf(snapshot.children) : {}
  const child = children[id]
  if (!isActorRef(child)) {
    return assert.fail(`no child "${id}"`)
  }
  return child
}

/** The status of the snapshot an actor reference holds now. */
const statusOf = (ref: ActorRefBase) => Effect.map(ref.getSnapshotUntyped, (snapshot) => snapshot.status)

/** A function action that pushes `name` to `log` when it runs. */
const named = (name: string, log: Array<string>): (() => void) => () => {
  log.push(name)
}

/** The ids of state nodes, in order. */
const idsOf = (nodes: Iterable<{ readonly id: string }>): ReadonlyArray<string> => Array.from(nodes, (node) => node.id)

/** A history value as the state-node ids of each record, in the record's key order. */
const historyIds = (history: Readonly<Record<string, ReadonlyArray<{ readonly id: string }>>>) =>
  Object.entries(history).map(([id, nodes]) => [id, idsOf(nodes)] as const)

/** The message of an error value, or its text. */
const messageOf = (error: unknown): string => (Predicate.hasProperty(error, "message") ? String(error.message) : String(error))

// ---------------------------------------------------------------- P1-006 fixtures

/** Entry and exit actions of node `key` that log `enter <key>` and `exit <key>`. */
const traced = (key: string, log: Array<string>) => ({ entry: named(`enter ${key}`, log), exit: named(`exit ${key}`, log) })

/**
 * `h`: `work` (compound) holds `setup` and the parallel `par` (regions A, B, C in document
 * order), a shallow `ws` and a deep `wd` history; `par` holds a shallow `ps` and a deep `pd`
 * history; region A holds a deep `ah`, region B a shallow `bh`. `away` goes back through each.
 */
const historyMachine = (log: Array<string>) =>
  createMachine({
    id: "h",
    initial: "work",
    states: {
      work: {
        ...traced("work", log),
        initial: "setup",
        on: { LEAVE: "#h.away" },
        states: {
          setup: { ...traced("setup", log), on: { GO: "par" } },
          par: {
            type: "parallel",
            ...traced("par", log),
            states: {
              A: {
                initial: "a1",
                ...traced("A", log),
                states: {
                  a1: { ...traced("a1", log), on: { NA: "a2" } },
                  a2: { ...traced("a2", log), initial: "x", states: { x: { ...traced("x", log), on: { NX: "y" } }, y: traced("y", log) } },
                  ah: { type: "history", history: "deep" },
                },
              },
              B: {
                initial: "b1",
                ...traced("B", log),
                states: {
                  b1: { ...traced("b1", log), on: { NB: "b2" } },
                  b2: { ...traced("b2", log), initial: "u", states: { u: { ...traced("u", log), on: { NU: "v" } }, v: traced("v", log) } },
                  bh: { type: "history" },
                },
              },
              C: { initial: "c1", ...traced("C", log), states: { c1: { ...traced("c1", log), on: { NC: "c2" } }, c2: traced("c2", log) } },
              ps: { type: "history" },
              pd: { type: "history", history: "deep" },
            },
          },
          ws: { type: "history" },
          wd: { type: "history", history: "deep" },
        },
      },
      away: {
        ...traced("away", log),
        on: {
          WS: "#h.work.ws",
          WD: "#h.work.wd",
          PS: "#h.work.par.ps",
          PD: "#h.work.par.pd",
          REGIONS: { target: ["#h.work.par.A.ah", "#h.work.par.B.bh"] },
        },
      },
    },
  })

/** Region C, then B (into b2.v), then A (into a2.y): the activation order is not document order. */
const visitOutOfOrder = ["GO", "NC", "NB", "NU", "NA", "NX"] as const

/** The deep restore of every region (xstate@5.33.2): entries in document order. */
const deepEntries = ["exit away", "enter work", "enter par", "enter A", "enter a2", "enter y", "enter B", "enter b2", "enter v", "enter C", "enter c2"]
const deepValue = `{"work":{"par":{"A":{"a2":"y"},"B":{"b2":"v"},"C":"c2"}}}`
const deepNodes = ["h", "h.work", "h.work.par", "h.work.par.A", "h.work.par.A.a2", "h.work.par.A.a2.y", "h.work.par.B", "h.work.par.B.b2", "h.work.par.B.b2.v", "h.work.par.C", "h.work.par.C.c2"]

/** The shallow restore of `par` or of its regions (xstate@5.33.2): every region's default, in document order. */
const shallowEntries = ["exit away", "enter work", "enter par", "enter A", "enter a1", "enter B", "enter b1", "enter C", "enter c1"]
const shallowValue = `{"work":{"par":{"A":"a1","B":"b1","C":"c1"}}}`
const shallowNodes = ["h", "h.work", "h.work.par", "h.work.par.A", "h.work.par.A.a1", "h.work.par.B", "h.work.par.B.b1", "h.work.par.C", "h.work.par.C.c1"]

// ---------------------------------------------------------------- P1-020 fixtures

/** The message of upstream's guard cycle (a V8 call-stack overflow), which the port's limit keeps. */
const stackOverflow = "Maximum call stack size exceeded"

/** `inner` inside `depth` nested `not` guards: `depth + 1` nested evaluations. */
const notChain = (depth: number, inner: Guard<unknown, EventObject>): Guard<unknown, EventObject> => {
  let guard = inner
  for (let level = 0; level < depth; level++) {
    guard = not<unknown, EventObject>(guard)
  }
  return guard
}

// ---------------------------------------------------------------- the scenarios

describe("TD-2 the P1 scenarios of the test design", () => {
  it.effect("[TD-2] P1-001: an error in the macrostep that invokes children under systemIds: the children are created but never start, never run, deliver nothing, and their systemIds are free", () =>
    withLogged((logged) =>
      Effect.gen(function* () {
        const boom = new Error("td2 boom")
        const ran: Array<string> = []
        // The machine child's entry runs a custom action at its start and schedules a delayed
        // LATE to the root by systemId; the callback child's body would run at its start
        const workerMachine = createMachine<object, EventObject>({
          id: "td2-worker",
          context: {},
          entry: [named("worker entry", ran), sendTo<object, EventObject>("td2-root", { type: "LATE" }, { delay: 100, id: "late" })],
        })
        const listener = fromCallback(() => {
          ran.push("listener started")
          return () => {
            ran.push("listener cleanup")
          }
        })
        // `busy` invokes both; its initial child's entry throws in the same macrostep
        const invoker = createMachine<object, EventObject>({
          id: "td2-invoker",
          context: {},
          initial: "idle",
          states: {
            idle: { on: { GO: "busy" } },
            busy: {
              invoke: [
                { src: workerMachine, id: "worker", systemId: "worker" },
                { src: listener, id: "listener", systemId: "listener" },
              ],
              initial: "first",
              states: {
                first: {
                  entry: () => {
                    throw boom
                  },
                },
              },
            },
          },
        })
        interface RootContext {
          readonly late: number
          readonly errors: ReadonlyArray<unknown>
        }
        const spare = fromCallback(() => undefined)
        const root = createMachine<RootContext, EventObject>({
          id: "td2-root",
          context: { late: 0, errors: [] },
          invoke: {
            src: invoker,
            id: "invoker",
            onError: { actions: assign<RootContext, EventObject>(({ context, event }) => ({ errors: [...context.errors, Predicate.hasProperty(event, "error") ? event.error : undefined] })) },
          },
          on: {
            LATE: { actions: assign<RootContext, EventObject>(({ context }) => ({ late: context.late + 1 })) },
            AGAIN: {
              actions: [
                spawnChild<RootContext, EventObject, typeof spare>(spare, { id: "worker2", systemId: "worker" }),
                spawnChild<RootContext, EventObject, typeof spare>(spare, { id: "listener2", systemId: "listener" }),
              ],
            },
          },
        })

        const actor = yield* createActor(root, { systemId: "td2-root" })
        const created: Array<string> = []
        const started: Array<string> = []
        const published: Array<string> = []
        yield* actor.system.inspect((event) =>
          Effect.sync(() => {
            if (event.type === "@xstate.actor") {
              created.push(event.actorRef.id)
            }
            if (event.type === "@xstate.event" && event.event.type === "xstate.init") {
              started.push(event.actorRef.id)
            }
            if (event.type === "@xstate.snapshot") {
              published.push(event.actorRef.id)
            }
          })
        )
        yield* actor.start
        const invokerRef = childOf(yield* actor.getSnapshot, "invoker")

        yield* invokerRef.sendUntyped({ type: "GO" })
        yield* settle

        // The invoker errors with the raw value and keeps the snapshot it had before the event
        const failed = yield* invokerRef.getSnapshotUntyped
        assert.strictEqual(failed.status, "error")
        assert.strictEqual(Option.getOrUndefined(failed.error), boom)
        assert.isTrue(Predicate.hasProperty(failed, "value") && failed.value === "idle")
        assert.deepStrictEqual(Object.keys(Predicate.hasProperty(failed, "children") ? recordOf(failed.children) : {}), [])
        // Both children were created (upstream's constructor reports them) and neither started:
        // no init event, no snapshot, no entry action, no callback body, no cleanup
        assert.deepStrictEqual(created.filter((id) => id === "worker" || id === "listener"), ["worker", "listener"])
        assert.deepStrictEqual(started.filter((id) => id === "worker" || id === "listener"), [])
        assert.deepStrictEqual(published.filter((id) => id === "worker" || id === "listener"), [])
        assert.deepStrictEqual(ran, [])
        // Their systemIds are free (DEV-26; upstream leaves both registered)
        assert.isTrue(Option.isNone(yield* actor.system.get("worker")))
        assert.isTrue(Option.isNone(yield* actor.system.get("listener")))
        assert.deepStrictEqual(Object.keys(yield* actor.system.getAll), ["td2-root"])
        // The parent took the one error event, with the raw value
        assert.deepStrictEqual((yield* actor.getSnapshot).context.errors, [boom])

        // No delayed event of the worker fires, and the system holds none
        yield* TestClock.adjust("1 minute")
        yield* settle
        assert.strictEqual((yield* actor.getSnapshot).context.late, 0)
        assert.deepStrictEqual((yield* actor.system.getSnapshot)._scheduledEvents, {})
        assert.deepStrictEqual(ran, [])

        // The root registers two new actors under the freed systemIds
        yield* actor.send({ type: "AGAIN" })
        const after = yield* actor.getSnapshot
        assert.strictEqual(after.status, "active")
        const worker2 = yield* actor.system.get("worker")
        const listener2 = yield* actor.system.get("listener")
        assert.isTrue(Option.isSome(worker2) && worker2.value === childOf(after, "worker2"))
        assert.isTrue(Option.isSome(listener2) && listener2.value === childOf(after, "listener2"))
        // The parent handled the error, so nothing was reported through the logger
        assert.deepStrictEqual(logged.errors, [])
        assert.deepStrictEqual(logged.warnings, [])
      })
    )
  )

  it.effect("[TD-2] P1-005: transitionNode selects the deepest enabled transitions and falls back to the node's own when the active child selects nothing: atomic, compound and parallel; an empty region value is skipped; nothing gives undefined", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "sel",
        initial: "a",
        on: { GO: ".b" },
        states: {
          a: { on: { GO: { guard: () => false, target: "b" } } },
          b: { initial: "b1", on: { GO: "#sel.a" }, states: { b1: { on: { NEXT: "b2" } }, b2: {} } },
          p: {
            type: "parallel",
            on: { GO: "#sel.a" },
            states: {
              r1: { initial: "x", states: { x: { on: { GO: "y" } }, y: {} } },
              r2: { initial: "z", states: { z: {} } },
            },
          },
        },
      })
      const snapshot = yield* getInitialSnapshot(machine)
      const parallel = machine.root.states["p"] ?? assert.fail("no state p")
      /** The source and targets of each selected transition, or `undefined` when none is selected. */
      const select = (node: typeof machine.root, value: Parameters<typeof StateUtils.transitionNode>[1], type: string) =>
        Effect.map(
          StateUtils.transitionNode(node, value, { machine, snapshot, event: { type }, actorScope: createInertActorScope(snapshot) }),
          (selected) => (selected === undefined ? undefined : selected.map((transition) => [transition.source, idsOf(transition.target ?? [])]))
        )

      // Each expected value is what xstate@5.33.2's transitionNode gives for the same call
      // An atomic child whose guard fails: the node's own transition
      assert.deepStrictEqual(yield* select(machine.root, "a", "GO"), [["sel", ["sel.b"]]])
      // A compound child whose active child has no GO: the compound child's own
      assert.deepStrictEqual(yield* select(machine.root, { b: "b1" }, "GO"), [["sel.b", ["sel.a"]]])
      // The deepest enabled transition wins over its ancestors'
      assert.deepStrictEqual(yield* select(machine.root, { b: "b1" }, "NEXT"), [["sel.b.b1", ["sel.b.b2"]]])
      // Nothing at any level: undefined
      assert.isUndefined(yield* select(machine.root, { b: "b1" }, "NOPE"))
      // A parallel node: the regions' selections, else its own
      assert.deepStrictEqual(yield* select(parallel, { r1: "x", r2: "z" }, "GO"), [["sel.p.r1.x", ["sel.p.r1.y"]]])
      assert.deepStrictEqual(yield* select(parallel, { r1: "y", r2: "z" }, "GO"), [["sel.p", ["sel.a"]]])
      // A region whose value is empty is skipped (upstream `if (!subStateValue) continue`)
      assert.deepStrictEqual(yield* select(parallel, { r1: "", r2: "z" }, "GO"), [["sel.p", ["sel.a"]]])
      // From the root, through the parallel node
      assert.deepStrictEqual(yield* select(machine.root, { p: { r1: "x", r2: "z" } }, "GO"), [["sel.p.r1.x", ["sel.p.r1.y"]]])
      assert.deepStrictEqual(yield* select(machine.root, { p: { r1: "y", r2: "z" } }, "GO"), [["sel.p", ["sel.a"]]])
    })
  )

  it.effect("[TD-2] P1-006: deep and shallow history under a compound state, under a parallel state and inside its regions record as upstream and restore in document order", () =>
    Effect.gen(function* () {
      const routes = [
        { event: "WS", entries: shallowEntries, value: shallowValue, nodes: shallowNodes },
        { event: "WD", entries: deepEntries, value: deepValue, nodes: deepNodes },
        { event: "PS", entries: shallowEntries, value: shallowValue, nodes: shallowNodes },
        { event: "PD", entries: deepEntries, value: deepValue, nodes: deepNodes },
        {
          // Region A through its deep history, region B through its shallow one, region C by default
          event: "REGIONS",
          entries: ["exit away", "enter work", "enter par", "enter A", "enter a2", "enter y", "enter B", "enter b2", "enter u", "enter C", "enter c1"],
          value: `{"work":{"par":{"A":{"a2":"y"},"B":{"b2":"u"},"C":"c1"}}}`,
          nodes: ["h", "h.work", "h.work.par", "h.work.par.A", "h.work.par.A.a2", "h.work.par.A.a2.y", "h.work.par.B", "h.work.par.B.b2", "h.work.par.B.b2.u", "h.work.par.C", "h.work.par.C.c1"],
        },
      ]
      for (const route of routes) {
        const log: Array<string> = []
        const actor = yield* createActor(historyMachine(log))
        yield* actor.start
        for (const type of visitOutOfOrder) {
          yield* actor.send({ type })
        }
        // The nodes in the order they became active: C's leaf, then B's, then A's
        const visited = yield* actor.getSnapshot
        assert.deepStrictEqual(idsOf(visited._nodes), [
          "h",
          "h.work",
          "h.work.par",
          "h.work.par.A",
          "h.work.par.B",
          "h.work.par.C",
          "h.work.par.C.c2",
          "h.work.par.B.b2",
          "h.work.par.B.b2.v",
          "h.work.par.A.a2",
          "h.work.par.A.a2.y",
        ])

        yield* actor.send({ type: "LEAVE" })
        // Each history node records as upstream's `exitStates`: deep, the atomic descendants in
        // activation order; shallow, the children; the records in exit order
        assert.deepStrictEqual(historyIds((yield* actor.getSnapshot).historyValue), [
          ["h.work.par.B.bh", ["h.work.par.B.b2"]],
          ["h.work.par.A.ah", ["h.work.par.A.a2.y"]],
          ["h.work.par.ps", ["h.work.par.A", "h.work.par.B", "h.work.par.C"]],
          ["h.work.par.pd", ["h.work.par.C.c2", "h.work.par.B.b2.v", "h.work.par.A.a2.y"]],
          ["h.work.ws", ["h.work.par"]],
          ["h.work.wd", ["h.work.par.C.c2", "h.work.par.B.b2.v", "h.work.par.A.a2.y"]],
        ])

        log.length = 0
        yield* actor.send({ type: route.event })
        const back = yield* actor.getSnapshot
        assert.deepStrictEqual(log, route.entries, route.event)
        assert.strictEqual(JSON.stringify(back.value), route.value, route.event)
        assert.deepStrictEqual(idsOf(back._nodes), route.nodes, route.event)
        yield* actor.stop
      }
    })
  )

  it.effect("[TD-2] P1-013: a callback cleanup and an observable or event-observable unsubscribe that throw are each reported once and the stop succeeds, through a parent's exit, actor.stop and the close of the caller's scope", () =>
    withLogged((logged) =>
      Effect.gen(function* () {
        const cleanupError = new Error("cleanup failed")
        const unsubscribeError = new Error("unsubscribe failed")
        const eventUnsubscribeError = new Error("event unsubscribe failed")
        const finalised: Array<string> = []
        const throwingCallback = fromCallback(() => () => {
          finalised.push("callback cleanup")
          throw cleanupError
        })
        const throwingObservable = fromObservable<number>(() => ({
          subscribe: () => ({
            unsubscribe: () => {
              finalised.push("observable unsubscribe")
              throw unsubscribeError
            },
          }),
        }))
        const throwingEvents = fromEventObservable<EventObject>(() => ({
          subscribe: () => ({
            unsubscribe: () => {
              finalised.push("event observable unsubscribe")
              throw eventUnsubscribeError
            },
          }),
        }))
        const quiet = fromEffect(() =>
          Effect.never.pipe(
            Effect.ensuring(
              Effect.sync(() => {
                finalised.push("effect finalizer")
              })
            )
          )
        )
        interface Heard {
          readonly heard: ReadonlyArray<string>
        }
        const parent = createMachine<Heard, EventObject>({
          id: "td2-p1013",
          context: { heard: [] },
          initial: "running",
          // Every event the parent takes but LEAVE, an error event of a child included
          on: { "*": { actions: assign<Heard, EventObject>(({ context, event }) => ({ heard: [...context.heard, event.type] })) } },
          states: {
            running: {
              invoke: [
                { src: throwingCallback, id: "callback" },
                { src: throwingObservable, id: "observable" },
                { src: throwingEvents, id: "events" },
                { src: quiet, id: "quiet" },
              ],
              on: { LEAVE: "idle" },
            },
            idle: {},
          },
        })
        /** The first value of each error entry, after checking that each entry holds one value. */
        const reported = () => {
          assert.isTrue(logged.errors.every((parts) => parts.length === 1))
          return logged.errors.map((parts) => parts[0])
        }

        // 1. The parent leaves the state that invokes them
        const actor = yield* createActor(parent)
        yield* actor.start
        const running = yield* actor.getSnapshot
        const children = ["callback", "observable", "events", "quiet"].map((id) => childOf(running, id))
        const leave = yield* Effect.exit(actor.send({ type: "LEAVE" }))
        yield* settle
        assert.isTrue(Exit.isSuccess(leave))
        const left = yield* actor.getSnapshot
        assert.strictEqual(left.status, "active")
        assert.strictEqual(left.value, "idle")
        assert.deepStrictEqual(left.context.heard, [])
        assert.deepStrictEqual(Object.keys(left.children), [])
        assert.deepStrictEqual(yield* Effect.forEach(children, statusOf), ["stopped", "stopped", "stopped", "stopped"])
        assert.deepStrictEqual([...finalised].sort(), ["callback cleanup", "effect finalizer", "event observable unsubscribe", "observable unsubscribe"])
        assert.sameMembers(reported(), [cleanupError, unsubscribeError, eventUnsubscribeError])
        assert.strictEqual(logged.errors.length, 3)

        // 2. actor.stop on a root callback actor, twice
        finalised.length = 0
        logged.errors.length = 0
        const callbackActor = yield* createActor(throwingCallback)
        yield* callbackActor.start
        const stopped = yield* Effect.exit(callbackActor.stop)
        assert.isTrue(Exit.isSuccess(stopped))
        assert.strictEqual(yield* statusOf(callbackActor), "stopped")
        assert.isTrue(Exit.isSuccess(yield* Effect.exit(callbackActor.stop)))
        yield* settle
        assert.deepStrictEqual(finalised, ["callback cleanup"])
        assert.deepStrictEqual(reported(), [cleanupError])

        // 3. The close of the caller's scope stops two root observable actors
        finalised.length = 0
        logged.errors.length = 0
        const closed = yield* Effect.exit(
          Effect.scoped(
            Effect.gen(function* () {
              const observableActor = yield* createActor(throwingObservable)
              yield* observableActor.start
              const eventsActor = yield* createActor(throwingEvents)
              yield* eventsActor.start
              return [observableActor, eventsActor]
            })
          )
        )
        assert.isTrue(Exit.isSuccess(closed))
        const roots = Exit.isSuccess(closed) ? closed.value : []
        yield* settle
        assert.deepStrictEqual(yield* Effect.forEach(roots, statusOf), ["stopped", "stopped"])
        assert.deepStrictEqual([...finalised].sort(), ["event observable unsubscribe", "observable unsubscribe"])
        assert.sameMembers(reported(), [unsubscribeError, eventUnsubscribeError])
        assert.strictEqual(logged.errors.length, 2)
        assert.deepStrictEqual(logged.warnings, [])
      })
    )
  )

  it.effect("[TD-2] P1-015: reportError, delay and actionDelay behave as their upstream source: an error reported once, delays resolved as resolveRaise and resolveSendTo resolve them (with the port's Duration), and each action keeps its delay as written", () =>
    withLogged((logged) =>
      Effect.gen(function* () {
        // reportError: upstream rethrows asynchronously; the port logs the value once at Error (SD-21)
        const original = new Error("unhandled")
        yield* reportUnhandledError(original)
        assert.deepStrictEqual(logged.errors, [[original]])
        // A callback that throws, fails or dies is reported once with the value and goes no further
        const thrown = new Error("thrown")
        const failed = new Error("failed")
        const died = new Error("died")
        const callbacks: ReadonlyArray<() => Effect.Effect<void, unknown>> = [
          () => {
            throw thrown
          },
          () => Effect.fail(failed),
          () => Effect.die(died),
          () => Effect.void,
        ]
        const exits = yield* Effect.forEach(callbacks, (callback) => Effect.exit(isolateCallback(callback)))
        assert.isTrue(exits.every(Exit.isSuccess))
        assert.deepStrictEqual(logged.errors, [[original], [thrown], [failed], [died]])
        // An interruption stays an interruption and is not reported
        const interrupted = yield* Effect.exit(isolateCallback(() => Effect.interrupt))
        assert.isTrue(Exit.isFailure(interrupted) && Exit.hasInterrupts(interrupted))
        assert.strictEqual(logged.errors.length, 4)

        // delay.ts: a number as it is, a Duration in milliseconds (port), anything else no delay
        assert.deepStrictEqual(toDelayMillis(250), Option.some(250))
        assert.deepStrictEqual(toDelayMillis(0), Option.some(0))
        assert.deepStrictEqual(toDelayMillis(Duration.seconds(2)), Option.some(2000))
        for (const notADelay of ["250", undefined, null, {}, true]) {
          assert.isTrue(Option.isNone(toDelayMillis(notADelay)), String(notADelay))
        }
        // A name reads the machine's delays, as own properties; a function gets the action
        // arguments and the params of the use (upstream `configDelay(args, actionParams)`)
        interface DelayContext {
          readonly fired: ReadonlyArray<string>
        }
        const seen: Array<{ readonly args: ActionArgs<DelayContext, EventObject>; readonly params: unknown }> = []
        const implementations = {
          delays: {
            short: 100,
            half: Duration.millis(500),
            slow: Duration.millis(1500),
            inHalf: () => Duration.millis(500),
            byParams: (args: ActionArgs<DelayContext, EventObject>, params: { readonly ms: number }) => {
              seen.push({ args, params })
              return params.ms
            },
          },
        }
        assert.deepStrictEqual(lookupDelay(implementations, "short"), Option.some(100))
        assert.isTrue(Option.isNone(lookupDelay(implementations, "missing")))
        // `toString` is no own property: no delay (upstream finds Object.prototype.toString,
        // whose result is no number, so it is no delay there either)
        assert.isTrue(Option.isNone(lookupDelay(implementations, "toString")))
        assert.isTrue(Option.isNone(lookupDelay({}, "short")))

        const delayMachine = createMachine<DelayContext, EventObject>(
          {
            id: "td2-delays",
            context: { fired: [] },
            entry: [
              // An inline function; a name whose function gives a Duration; an inline function; a
              // name that is a Duration
              raise<DelayContext, EventObject>({ type: "RAISED_FN" }, { delay: () => 300, id: "raised-fn" }),
              raise<DelayContext, EventObject>({ type: "RAISED_NAMED" }, { delay: "inHalf", id: "raised-named" }),
              sendTo<DelayContext, EventObject>("td2-delays-self", { type: "SENT_FN" }, { delay: () => 1000, id: "sent-fn" }),
              sendTo<DelayContext, EventObject>("td2-delays-self", { type: "SENT_NAMED" }, { delay: "slow", id: "sent-named" }),
            ],
            on: { "*": { actions: assign<DelayContext, EventObject>(({ context, event }) => ({ fired: [...context.fired, event.type] })) } },
          },
          implementations
        )
        const actor = yield* createActor(delayMachine, { systemId: "td2-delays-self" })
        yield* actor.start
        // Each pending event with the milliseconds its delay resolved to, sorted by delay: the
        // port's record keeps the keys in its store's order, where upstream's keeps the order
        // of scheduling (the order of firing is upstream's either way)
        const scheduled = Object.values((yield* actor.system.getSnapshot)._scheduledEvents)
        assert.deepStrictEqual(
          scheduled.map((event) => [event.id, event.delay]).sort(([, left], [, right]) => Number(left) - Number(right)),
          [
            ["raised-fn", 300],
            ["raised-named", 500],
            ["sent-fn", 1000],
            ["sent-named", 1500],
          ]
        )
        const firedAfter = (millis: number) =>
          Effect.gen(function* () {
            yield* TestClock.adjust(Duration.millis(millis))
            yield* settle
            return (yield* actor.getSnapshot).context.fired
          })
        assert.deepStrictEqual(yield* firedAfter(299), [])
        assert.deepStrictEqual(yield* firedAfter(1), ["RAISED_FN"])
        assert.deepStrictEqual(yield* firedAfter(200), ["RAISED_FN", "RAISED_NAMED"])
        assert.deepStrictEqual(yield* firedAfter(500), ["RAISED_FN", "RAISED_NAMED", "SENT_FN"])
        assert.deepStrictEqual(yield* firedAfter(500), ["RAISED_FN", "RAISED_NAMED", "SENT_FN", "SENT_NAMED"])

        // resolveDelay with the action arguments a delay function receives in that machine
        const probe = createMachine<DelayContext, EventObject>(
          { id: "td2-probe", context: { fired: [] }, entry: raise<DelayContext, EventObject>({ type: "PROBED" }, { delay: "byParams" }) },
          {
            delays: {
              byParams: (args, params: { readonly ms: number } | undefined) => {
                seen.push({ args, params })
                return params?.ms ?? 5
              },
            },
          }
        )
        const probeActor = yield* createActor(probe)
        yield* probeActor.start
        // A name used without params: the function gets the action arguments and undefined
        const captured = seen[0] ?? assert.fail("the delay function never ran")
        assert.isUndefined(captured.params)
        assert.isTrue(Predicate.hasProperty(captured.args, "context") && Predicate.hasProperty(captured.args, "event"))
        seen.length = 0
        assert.deepStrictEqual(resolveDelay(implementations, 42, captured.args, undefined), Option.some(42))
        assert.deepStrictEqual(resolveDelay(implementations, "short", captured.args, undefined), Option.some(100))
        assert.deepStrictEqual(resolveDelay(implementations, "half", captured.args, undefined), Option.some(500))
        assert.deepStrictEqual(resolveDelay(implementations, "inHalf", captured.args, undefined), Option.some(500))
        assert.deepStrictEqual(resolveDelay(implementations, "byParams", captured.args, { ms: 7 }), Option.some(7))
        assert.deepStrictEqual(seen, [{ args: captured.args, params: { ms: 7 } }])
        assert.isTrue(Option.isNone(resolveDelay(implementations, "missing", captured.args, undefined)))

        // actionDelay.ts: the delay as written, kept beside the action (upstream `raise.delay`, `sendTo.delay`)
        const marker = {}
        assert.strictEqual(withDelay(marker, 250), marker)
        assert.deepStrictEqual(delayOf(marker), Option.some(250))
        assert.isTrue(Option.isNone(delayOf({})))
        assert.isTrue(Option.isNone(delayOf(withDelay({}, undefined))))
        const delayFunction = () => 10
        assert.deepStrictEqual(delayOf(raise<DelayContext, EventObject>({ type: "A" }, { delay: 100 })), Option.some(100))
        assert.deepStrictEqual(delayOf(raise<DelayContext, EventObject>({ type: "A" }, { delay: "half" })), Option.some("half"))
        assert.deepStrictEqual(delayOf(sendTo<DelayContext, EventObject>("x", { type: "A" }, { delay: delayFunction })), Option.some(delayFunction))
        assert.deepStrictEqual(delayOf(forwardTo<DelayContext, EventObject>("x", { delay: 5 })), Option.some(5))
        assert.isTrue(Option.isNone(delayOf(raise<DelayContext, EventObject>({ type: "A" }))))
        // The graph's test model reads it: only a numeric delay is rejected, as upstream's
        // `typeof action.delay === 'number'`; a name or a function passes
        const testMachine = (delay: number | string | (() => number)) =>
          createMachine<DelayContext, EventObject>(
            { id: "td2-test-model", context: { fired: [] }, initial: "a", states: { a: { on: { GO: { target: "b", actions: raise<DelayContext, EventObject>({ type: "LATER" }, { delay }) } } }, b: {} } },
            implementations
          )
        assert.isTrue(Exit.isSuccess(yield* Effect.exit(createTestModel(testMachine("half")))))
        assert.isTrue(Exit.isSuccess(yield* Effect.exit(createTestModel(testMachine(delayFunction)))))
        const rejected = yield* Effect.flip(createTestModel(testMachine(100)))
        assert.strictEqual(rejected.message, "Delayed actions on test machines are not supported")
      })
    )
  )

  it.effect("[TD-2] P1-016: createInertActorScope has every member of ActorScopeService, ActorSystemService and SchedulerService, and none of them acts on a live actor, its system, the clock or the logger", () =>
    withLogged((logged) =>
      Effect.gen(function* () {
        // The members of each interface, checked against it at compile time: a member added to
        // an interface and missing here, or listed here and not in it, fails the type check
        const scopeMembers = {
          self: true,
          id: true,
          sessionId: true,
          system: true,
          logger: true,
          defer: true,
          emit: true,
          stopChild: true,
          actionExecutor: true,
          allocateChild: true,
          spawnChild: true,
          restoreChild: true,
          startChild: true,
        } satisfies Record<keyof ActorScopeService, true>
        const systemMembers = {
          generateId: true,
          register: true,
          unregister: true,
          _set: true,
          get: true,
          _lookup: true,
          getAll: true,
          relay: true,
          scheduler: true,
          getSnapshot: true,
          _clock: true,
          _logger: true,
          inspect: true,
          _sendInspectionEvent: true,
        } satisfies Record<keyof ActorSystemService, true>
        const schedulerMembers = { schedule: true, cancel: true, cancelAll: true, resume: true, scheduledEvents: true } satisfies Record<keyof SchedulerService, true>

        const snapshot = Snap.active()
        const scope = createInertActorScope(snapshot)
        const { self, system } = scope
        assert.deepStrictEqual(Object.keys(scope).sort(), Object.keys(scopeMembers).sort())
        assert.deepStrictEqual(Object.keys(system).sort(), Object.keys(systemMembers).sort())
        assert.deepStrictEqual(Object.keys(system.scheduler).sort(), Object.keys(schedulerMembers).sort())

        // A live actor in a live system, and an actor that has not started: no inert member may reach them
        const ran: Array<string> = []
        const record = (name: string) =>
          Effect.sync(() => {
            ran.push(name)
          })
        interface LiveContext {
          readonly pings: number
        }
        const live = yield* createActor(
          createMachine<LiveContext, EventObject>({
            id: "td2-live",
            context: { pings: 0 },
            on: { PING: { actions: assign<LiveContext, EventObject>(({ context }) => ({ pings: context.pings + 1 })) } },
          }),
          { systemId: "live" }
        )
        yield* live.start
        const unstarted = yield* createActor(createMachine({ id: "td2-unstarted", entry: named("unstarted entry", ran) }))
        const liveInspected: Array<string> = []
        yield* live.system.inspect((event) =>
          Effect.sync(() => {
            liveInspected.push(event.type)
          })
        )

        // ActorSystemService and SchedulerService
        // generateId books x:0, x:1, … from the scope's own counter (SD-9), apart from any other system
        assert.deepStrictEqual([yield* system.generateId, yield* system.generateId], ["x:0", "x:1"])
        assert.strictEqual(yield* createInertActorScope(Snap.active()).system.generateId, "x:0")
        assert.strictEqual(yield* system.register("x:7", live), "inert-session")
        yield* system._set("live", live)
        yield* system.unregister(live)
        assert.isTrue(Option.isNone(yield* system.get("live")))
        assert.isTrue(Option.isNone(system._lookup("live")))
        assert.deepStrictEqual(yield* system.getAll, {})
        yield* system.relay(self, live, { type: "PING" })
        yield* system.scheduler.schedule(self, live, { type: "PING" }, 10, Option.some("ping"))
        yield* system.scheduler.resume({ source: self, target: live, event: { type: "PING" }, delay: 10, id: "resumed", startedAt: 0 })
        assert.deepStrictEqual(yield* system.scheduler.scheduledEvents, {})
        assert.deepStrictEqual(yield* system.getSnapshot, { _scheduledEvents: {} })
        yield* system.scheduler.cancel(live, "ping")
        yield* system.scheduler.cancelAll(live)
        const timeout = system._clock.setTimeout(() => {
          ran.push("timeout")
        }, 10)
        system._clock.clearTimeout(timeout)
        assert.isTrue(Option.isNone(system._logger))
        yield* Effect.scoped(
          Effect.andThen(system.inspect(() => record("inert inspected")), system._sendInspectionEvent({ type: "@xstate.actor", actorRef: live }))
        )
        yield* system._sendInspectionEvent({ type: "@xstate.event", actorRef: live, sourceRef: Option.none(), event: { type: "PING" } })

        // ActorScopeService
        assert.strictEqual(scope.id, self.id)
        assert.strictEqual(scope.sessionId, self.sessionId)
        assert.strictEqual(scope.system, system)
        Option.match(scope.logger, { onNone: () => assert.fail("the inert logger is missing"), onSome: (logger) => logger("inert log") })
        yield* scope.defer(record("deferred"))
        yield* scope.emit({ type: "EMITTED" })
        yield* scope.stopChild(live)
        yield* scope.startChild(unstarted)
        yield* scope.actionExecutor({ type: "custom", params: undefined, info: { context: undefined, event: { type: "PING" }, self: live, system }, exec: record("exec") })
        // spawnChild builds the child that allocateChild gave, registers nothing and starts nothing
        const childLogic = fromCallback(() => {
          ran.push("child started")
        })
        const spawned = scope.allocateChild()
        yield* scope.spawnChild(spawned, { logic: childLogic, src: "job", id: Option.some("job"), systemId: Option.some("job"), input: undefined, syncSnapshot: false })
        const restored = yield* scope.restoreChild({ logic: childLogic, src: "job", id: "restored", systemId: Option.some("restored"), syncSnapshot: false, snapshot: Option.none() })
        yield* scope.startChild(spawned)
        yield* scope.startChild(restored)
        assert.deepStrictEqual([spawned.id, restored.id], ["job", "restored"])
        // self
        yield* self.sendUntyped({ type: "PING" })
        assert.strictEqual(yield* self.getSnapshotUntyped, snapshot)

        yield* TestClock.adjust("1 minute")
        yield* settle

        // Nothing ran, nothing reached the live actors or their systems, nothing was logged
        assert.deepStrictEqual(ran, [])
        const liveSnapshot = yield* live.getSnapshot
        assert.deepStrictEqual([liveSnapshot.status, liveSnapshot.context.pings], ["active", 0])
        const registered = yield* live.system.get("live")
        assert.isTrue(Option.isSome(registered) && registered.value === live)
        assert.deepStrictEqual((yield* live.system.getSnapshot)._scheduledEvents, {})
        assert.deepStrictEqual(liveInspected, [])
        assert.isTrue(Option.isNone(yield* system.get("job")))
        assert.isTrue(Option.isNone(yield* system.get("restored")))
        assert.deepStrictEqual(logged.all, [])
      })
    )
  )

  it.effect("[TD-2] P1-018: a waitFor timeout on the TestClock fails with upstream's text and leaves no subscription behind: later snapshots reach no predicate, the abort listener is removed once, and the actor's later error finds no observer", () =>
    withLogged((logged) =>
      Effect.gen(function* () {
        const boom = new Error("td2 late error")
        const machine = createMachine({
          id: "td2-p1018",
          initial: "a",
          on: {
            BOOM: {
              actions: () => {
                throw boom
              },
            },
          },
          states: { a: { on: { NEXT: "b" } }, b: { on: { NEXT: "c" } }, c: {} },
        })

        const actor = yield* createActor(machine)
        yield* actor.start
        const controller = new AbortController()
        const added = vi.spyOn(controller.signal, "addEventListener")
        const removed = vi.spyOn(controller.signal, "removeEventListener")
        const predicate = vi.fn((snapshot: { readonly matches: (value: string) => boolean }) => snapshot.matches("c"))

        const waiting = yield* Effect.forkScoped(Effect.flip(waitFor(actor, predicate, { timeout: 100, signal: controller.signal })), { startImmediately: true })
        yield* actor.send({ type: "NEXT" })
        yield* TestClock.adjust("99 millis")
        yield* settle
        assert.isUndefined(waiting.pollUnsafe())
        yield* TestClock.adjust("1 millis")
        const error = yield* Fiber.join(waiting)
        assert.instanceOf(error, WaitForTimeoutError)
        assert.strictEqual(Predicate.hasProperty(error, "timeout") ? error.timeout : undefined, 100)
        assert.strictEqual(messageOf(error), waitForTimeout(100))
        // The predicate saw the current snapshot (a) and the next (b), as upstream's waitFor
        assert.strictEqual(predicate.mock.calls.length, 2)

        // Nothing of the wait remains: c would satisfy the predicate, which no longer runs
        yield* actor.send({ type: "NEXT" })
        yield* settle
        assert.strictEqual((yield* actor.getSnapshot).value, "c")
        assert.strictEqual(predicate.mock.calls.length, 2)
        assert.strictEqual(added.mock.calls.length, 1)
        assert.strictEqual(removed.mock.calls.length, 1)
        assert.strictEqual(removed.mock.calls[0]?.[1], added.mock.calls[0]?.[1])
        // The actor has no observer left, so its error is reported as unhandled (upstream
        // `_reportError` with no observer and no parent)
        yield* actor.send({ type: "BOOM" })
        yield* settle
        assert.strictEqual((yield* actor.getSnapshot).status, "error")
        assert.deepStrictEqual(logged.errors, [[boom]])

        // The same error reaches a wait that still runs, and is then not reported
        const other = yield* createActor(machine)
        yield* other.start
        const stillWaiting = yield* Effect.forkScoped(Effect.flip(waitFor(other, (snapshot) => snapshot.matches("c"), { timeout: 100 })), { startImmediately: true })
        yield* settle
        yield* other.send({ type: "BOOM" })
        assert.strictEqual(yield* Fiber.join(stillWaiting), boom)
        yield* settle
        assert.deepStrictEqual(logged.errors, [[boom]])
      })
    )
  )

  it.effect("[TD-2] P1-020: stateNotIn negates stateIn, and guards nest at most 10,000 evaluations: 10,000 decide, the 10,001st fails with GuardError, and a self-referring guard stops there", () =>
    Effect.gen(function* () {
      // stateNotIn (port extra) in a transition: taken only while the other region is not in r2
      const machine = createMachine({
        id: "td2-p1020",
        type: "parallel",
        states: {
          left: {
            initial: "l1",
            states: { l1: { on: { TRY: { target: "l2", guard: stateNotIn("#td2-p1020.right.r2") } } }, l2: { on: { BACK: "l1" } } },
          },
          right: { initial: "r1", states: { r1: { on: { FLIP: "r2" } }, r2: { on: { FLIP: "r1" } } } },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      assert.isTrue(yield* (yield* actor.getSnapshot).can({ type: "TRY" }))
      yield* actor.send({ type: "TRY" })
      assert.deepStrictEqual((yield* actor.getSnapshot).value, { left: "l2", right: "r1" })
      yield* actor.send({ type: "BACK" })
      yield* actor.send({ type: "FLIP" })
      assert.isFalse(yield* (yield* actor.getSnapshot).can({ type: "TRY" }))
      yield* actor.send({ type: "TRY" })
      assert.deepStrictEqual((yield* actor.getSnapshot).value, { left: "l1", right: "r2" })
      // On one snapshot, stateNotIn is the negation of stateIn for an id, an object value and a key
      const snapshot = yield* actor.getSnapshot
      const inSnapshot: GuardScope<unknown, EventObject> = { self: actor, system: actor.system, snapshot }
      const values: ReadonlyArray<StateValue> = ["#td2-p1020.right.r1", "#td2-p1020.right.r2", { right: "r2" }, { left: "l2" }, "left"]
      for (const value of values) {
        const isIn = yield* evaluateGuard<unknown, EventObject>(stateIn(value), {}, { type: "EV" }, inSnapshot)
        const isNotIn = yield* evaluateGuard<unknown, EventObject>(stateNotIn(value), {}, { type: "EV" }, inSnapshot)
        assert.strictEqual(isNotIn, !isIn, JSON.stringify(value))
      }

      // The limit: 9,999 `not` around a function are 10,000 nested evaluations, which decide
      const scope: GuardScope<unknown, EventObject> = { self: actor, system: actor.system }
      let calls = 0
      const counting = () => {
        calls++
        return true
      }
      assert.isFalse(yield* evaluateGuard(notChain(9_999, counting), {}, { type: "EV" }, scope))
      assert.strictEqual(calls, 1)
      // One `not` more: the 10,001st evaluation, the function's, is refused
      const deeper = yield* Effect.flip(evaluateGuard(notChain(10_000, counting), {}, { type: "EV" }, scope))
      assert.instanceOf(deeper, GuardError)
      assert.deepStrictEqual([deeper.message, deeper.guard], [stackOverflow, ""])
      assert.strictEqual(calls, 1)

      // A guard that refers back to itself through `not`: `a` counts its evaluations, so `a` and
      // `not` alternate; 5,000 of each run, and the 10,001st evaluation, an `a`, is refused
      let evaluationsOfA = 0
      const selfReferring: GuardScope<unknown, EventObject> = {
        self: actor,
        system: actor.system,
        implementations: {
          guards: {
            a: {
              type: "a",
              predicate: (ctx) =>
                Effect.suspend(() => {
                  evaluationsOfA++
                  return evaluateGuard(not<unknown, EventObject>("a"), ctx.context, ctx.event, guardScopeOf(ctx))
                }),
            },
          },
        },
      }
      const cycle = yield* Effect.flip(evaluateGuard<unknown, EventObject>("a", {}, { type: "EV" }, selfReferring))
      assert.instanceOf(cycle, GuardError)
      assert.deepStrictEqual([cycle.message, cycle.guard], [stackOverflow, "a"])
      assert.strictEqual(evaluationsOfA, 5_000)

      // `a: not("a")` in a transition: upstream's guard-evaluation error around that message (DEV-30)
      const cyclic = createMachine(
        { id: "td2-cycle", initial: "idle", states: { idle: { on: { EV: { target: "done", guard: "a" } } }, done: {} } },
        { guards: { a: not("a") } }
      )
      const cyclicActor = yield* createActor(cyclic)
      yield* cyclicActor.start
      yield* cyclicActor.send({ type: "EV" })
      const failed = yield* cyclicActor.getSnapshot
      assert.strictEqual(failed.status, "error")
      assert.strictEqual(failed.value, "idle")
      assert.strictEqual(messageOf(Option.getOrUndefined(failed.error)), guardEvaluationFailed("a", "EV", "td2-cycle.idle", stackOverflow))
    })
  )
})
