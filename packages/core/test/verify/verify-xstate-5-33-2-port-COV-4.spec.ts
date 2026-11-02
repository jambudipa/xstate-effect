/**
 * COV-4: the shared private helpers of `src/internal`, in the cases the baseline left unhit.
 *
 * init-testing layer 4 (test design R-008, P1-014, P1-015). The outbox is on the delivery path
 * of every `emit`, `sendBack` and observer call: a delivery posted from inside a delivery of
 * the same outbox runs at once, inside it (upstream's plain call, depth first); one that waits
 * goes on in its own fiber, which the close of the outbox's scope interrupts; after the close
 * every post is dropped. `isolateCallback` reports what a callback fails or dies with once
 * through the logger and swallows it (SD-21), and keeps an interruption an interruption. The
 * delivery guards find the drain of an actor and the settle of a system (SD-28) only where the
 * `Actor` and `ActorSystem` modules put them.
 */
import { assert, describe, it, vi } from "@effect/vitest"
import { Cause, Deferred, Effect, Exit, Logger, Option, Scope } from "effect"
import { makeActorSystem } from "../../src/ActorSystem.js"
import { DrainKey, hasDrain, hasSettle, SettleKey } from "../../src/internal/delivery.js"
import * as Outbox from "../../src/internal/outbox.js"
import type { ActorLogic, AnyActorLogic, AnyLogicSlot } from "../../src/ActorLogic.js"
import { raise } from "../../src/actions/raise.js"
import { stopChild } from "../../src/actions/stopChild.js"
import { fromAgent } from "../../src/actors/fromAgent.js"
import { fromEffect } from "../../src/actors/fromEffect.js"
import { createActor, createMachine } from "../../src/index.js"
import {
  AgentBrand,
  hasAgentBrand,
  type IsAgentLogic,
  markAgentLogic,
  type NotAgentLogic,
} from "../../src/internal/agentBrand.js"
import { delayOf } from "../../src/internal/actionDelay.js"
import { isolateCallback, reportUnhandledError } from "../../src/internal/reportError.js"

/** Lets every other ready fiber take twenty turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 20; turn++) {
    yield* Effect.yieldNow
  }
})

/** One log entry as a test logger saw it. */
interface Entry {
  readonly logLevel: string
  readonly message: ReadonlyArray<unknown>
}

/** Runs `program` with a logger that keeps every log entry in `entries`. */
const withLogger = <A, E, R>(entries: Array<Entry>, program: Effect.Effect<A, E, R>) =>
  program.pipe(
    Effect.provide(
      Logger.layer([
        Logger.make((options) => {
          entries.push({
            logLevel: options.logLevel,
            message: Array.isArray(options.message) ? options.message : [options.message],
          })
        }),
      ])
    )
  )

/** Ordinary effect logic: it carries no agent brand. */
const ordinaryLogic = fromEffect(({ input }: { input: number }) => Effect.succeed(input + 1))

/** Effect logic marked as agent logic, as `fromAgent` marks its own. */
const agentLogic = markAgentLogic(fromEffect(({ input }: { input: number }) => Effect.succeed(input + 1)))

/** `true` only when `A` and `B` are the same type, so a `boolean` result does not pass for `true`. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false

/** Accepts only `true`: a brand case below that does not hold fails `pnpm typecheck`. */
type Holds<T extends true> = T

/** The brand cases of `IsAgentLogic` (TS-115: a union is checked whole, never distributed). */
export type AgentBrandCases = [
  Holds<Equals<IsAgentLogic<typeof agentLogic>, true>>,
  Holds<Equals<IsAgentLogic<typeof ordinaryLogic>, false>>,
  Holds<Equals<IsAgentLogic<typeof agentLogic | typeof ordinaryLogic>, true>>,
  Holds<Equals<IsAgentLogic<never>, false>>,
  Holds<Equals<IsAgentLogic<AnyActorLogic>, false>>,
]

/** Ordinary logic fits a slot that refuses agent logic. */
export const acceptedOrdinary: AnyActorLogic & NotAgentLogic = ordinaryLogic

// @ts-expect-error agent logic does not fit a slot that refuses it ([AgentBrand] is not never)
export const refusedAgent: AnyActorLogic & NotAgentLogic = agentLogic

// @ts-expect-error agent logic does not widen to a declared AnyActorLogic, which keeps the capability optional
export const widenedAgent: AnyActorLogic = agentLogic

// @ts-expect-error agent logic does not widen to a declared ActorLogic, which keeps the capability optional
export const widenedTyped: ActorLogic<any, any, any> = agentLogic

/** Agent logic fits the slot the library's generics read. */
const slot: AnyLogicSlot = agentLogic

// @ts-expect-error the slot does not widen on to AnyActorLogic, so two steps are no way round the refusal
export const widenedTwice: AnyActorLogic = slot

describe("COV-4 shared private helpers (src/internal)", () => {
  it("[COV-4] agentBrand: the run-time marker is a non-enumerable symbol property that survives structural copies", () => {
    const descriptor = Object.getOwnPropertyDescriptor(agentLogic, AgentBrand)
    assert.isDefined(descriptor)
    assert.isFalse(descriptor?.enumerable)
    assert.isFalse(descriptor?.writable)
    assert.isFalse(Object.keys(agentLogic).includes(String(AgentBrand)))
    assert.isFalse(JSON.stringify(Object.keys(agentLogic)).includes("AgentBrand"))
    assert.strictEqual(AgentBrand, Symbol.for("@jambudipa/xstate-effect/AgentBrand"))

    assert.isTrue(hasAgentBrand(agentLogic))
    assert.isTrue(hasAgentBrand({ ...agentLogic }))
    assert.isTrue(hasAgentBrand(Object.assign({}, agentLogic)))
    const hidden = agentLogic as unknown as AnyActorLogic
    assert.isTrue(hasAgentBrand(hidden))

    assert.isFalse(hasAgentBrand(ordinaryLogic))
    assert.isFalse(hasAgentBrand({ ...ordinaryLogic }))
    assert.isFalse(hasAgentBrand(undefined))
    assert.isFalse(hasAgentBrand(null))
    assert.isFalse(hasAgentBrand("agent"))
    assert.isFalse(hasAgentBrand({ [AgentBrand]: "yes" }))
  })

  it("[COV-4] agentBrand: marking returns the same logic and leaves other logic of the same kind unmarked", () => {
    const logic = fromEffect(() => Effect.void)
    const marked = markAgentLogic(logic)
    assert.strictEqual<unknown>(marked, logic)
    assert.strictEqual<unknown>(markAgentLogic(marked), logic)
    assert.isTrue(hasAgentBrand(logic))
    assert.isFalse(hasAgentBrand(fromEffect(() => Effect.void)))
  })

  it.effect("[COV-4] agentBrand: the marker survives a provide in place of a declared actor", () =>
    Effect.sync(() => {
      const hidden = agentLogic as unknown as AnyActorLogic
      const machine = createMachine({ invoke: { src: "worker" } })
      const provided = machine.provide({ actors: { worker: hidden } })
      assert.isTrue(hasAgentBrand(provided.implementations.actors?.["worker"]))
      assert.isFalse(hasAgentBrand(machine.implementations.actors?.["worker"]))
    })
  )

  it.effect("[COV-4] outbox: a delivery posted inside a delivery runs at once, depth first; one that waits goes on in its own fiber without holding later posts", () =>
    Effect.gen(function* () {
      const order: Array<string> = []
      const gate = yield* Deferred.make<void>()
      const scope = yield* Scope.make()
      const outbox = yield* Outbox.make.pipe(Scope.provide(scope))

      outbox.post(
        Effect.sync(() => {
          order.push("outer start")
          outbox.post(
            Effect.gen(function* () {
              order.push("inner start")
              yield* Deferred.await(gate)
              order.push("inner end")
            })
          )
          order.push("outer end")
        })
      )
      outbox.post(
        Effect.sync(() => {
          order.push("next")
        })
      )
      // Each post ran its delivery before it returned; the inner one waits in its own fiber
      assert.deepStrictEqual(order, ["outer start", "inner start", "outer end", "next"])

      yield* Deferred.succeed(gate, undefined)
      yield* settle
      assert.deepStrictEqual(order, ["outer start", "inner start", "outer end", "next", "inner end"])
      yield* Scope.close(scope, Exit.void)
    })
  )

  it.effect("[COV-4] outbox: the close interrupts a nested delivery that still waits, and drops every later post", () =>
    Effect.gen(function* () {
      const order: Array<string> = []
      const scope = yield* Scope.make()
      const outbox = yield* Outbox.make.pipe(Scope.provide(scope))

      outbox.post(
        Effect.sync(() => {
          outbox.post(
            Effect.never.pipe(
              Effect.onInterrupt(() =>
                Effect.sync(() => {
                  order.push("inner interrupted")
                })
              )
            )
          )
          order.push("outer end")
        })
      )
      assert.deepStrictEqual(order, ["outer end"])

      yield* Scope.close(scope, Exit.void)
      assert.deepStrictEqual(order, ["outer end", "inner interrupted"])

      outbox.post(
        Effect.sync(() => {
          order.push("after close")
        })
      )
      yield* settle
      assert.deepStrictEqual(order, ["outer end", "inner interrupted"])
    })
  )

  it.effect("[COV-4] outbox: deliveries posted from outside run one at a time in post order, and one that dies is reported and the next runs", () =>
    Effect.gen(function* () {
      const order: Array<string> = []
      const entries: Array<Entry> = []
      const gate = yield* Deferred.make<void>()
      yield* withLogger(
        entries,
        Effect.gen(function* () {
          const scope = yield* Scope.make()
          const outbox = yield* Outbox.make.pipe(Scope.provide(scope))
          outbox.post(
            Effect.gen(function* () {
              order.push("first start")
              yield* Deferred.await(gate)
              order.push("first end")
            })
          )
          outbox.post(Effect.die("dead delivery"))
          outbox.post(
            Effect.sync(() => {
              order.push("last")
            })
          )
          // The first delivery waits, so the others wait behind it
          assert.deepStrictEqual(order, ["first start"])

          yield* Deferred.succeed(gate, undefined)
          yield* settle
          yield* Scope.close(scope, Exit.void)
        })
      )

      assert.deepStrictEqual(order, ["first start", "first end", "last"])
      assert.deepStrictEqual(
        entries.map((entry) => [entry.logLevel, entry.message]),
        [["Error", ["dead delivery"]]]
      )
    })
  )

  it.effect("[COV-4] isolateCallback: a failure or a defect is reported once with the original value and goes no further; an interruption stays an interruption", () =>
    Effect.gen(function* () {
      const entries: Array<Entry> = []
      const original = new Error("listener failed")

      const failed = yield* withLogger(entries, Effect.exit(isolateCallback(() => Effect.fail(original))))
      const died = yield* withLogger(entries, Effect.exit(isolateCallback(() => Effect.die("listener died"))))
      assert.isTrue(Exit.isSuccess(failed))
      assert.isTrue(Exit.isSuccess(died))
      assert.deepStrictEqual(
        entries.map((entry) => [entry.logLevel, entry.message]),
        [
          ["Error", [original]],
          ["Error", ["listener died"]],
        ]
      )

      const interrupted = yield* withLogger(entries, Effect.exit(isolateCallback(() => Effect.interrupt)))
      assert.isTrue(Exit.isFailure(interrupted))
      assert.isTrue(Exit.isFailure(interrupted) && Cause.hasInterruptsOnly(interrupted.cause))
      assert.strictEqual(entries.length, 2, "an interruption is not reported")
    })
  )

  it.effect("[COV-4] reportUnhandledError: logs the original value once at level Error", () =>
    Effect.gen(function* () {
      const entries: Array<Entry> = []
      const original = { reason: "unhandled" }
      yield* withLogger(entries, reportUnhandledError(original))
      assert.deepStrictEqual(
        entries.map((entry) => [entry.logLevel, entry.message]),
        [["Error", [original]]]
      )
    })
  )

  it.effect("[COV-4] delivery guards: an actor keeps a drain that gives its processed count, a system keeps a settle; other objects keep neither", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(
        createMachine({ types: {} as { events: { type: "PING" } }, on: { PING: {} } })
      )
      yield* actor.start
      yield* actor.send({ type: "PING" })
      yield* actor.send({ type: "PING" })
      const system = yield* makeActorSystem()

      assert.isTrue(hasDrain(actor))
      assert.strictEqual(hasDrain(actor) ? yield* actor[DrainKey] : -1, 2)
      assert.isTrue(hasSettle(actor._system))
      assert.isTrue(hasSettle(system))
      assert.isFalse(Object.keys(system).includes(String(SettleKey)))
      assert.isFalse(hasSettle({}))
      assert.isFalse(hasSettle({ [SettleKey]: "not an effect" }))
      const notADrain = { ...actor, [DrainKey]: 0 }
      assert.isFalse(hasDrain(notADrain))
      if (hasSettle(system)) {
        yield* system[SettleKey]
      }
    })
  )
})

// ---------------------------------------------------------------- two copies of the library (F14)

/** The modules of a second copy of the library, as a duplicate install gives a program. */
const secondCopy = Effect.promise(() => {
  vi.resetModules()
  return Promise.all([
    import("../../src/index.js"),
    import("../../src/graph/settlement.js"),
    import("../../src/actors/fromAgent.js"),
    import("../../src/internal/actionDelay.js"),
    import("../../src/internal/stopTarget.js"),
  ]).then(([root, settlement, agents, actionDelay, stopTarget]) => ({ root, settlement, agents, actionDelay, stopTarget }))
})

describe("COV-4 two copies of the library in one program", () => {
  it.effect("[COV-4] a stop target and an action delay written by one copy read in the other", () =>
    Effect.gen(function* () {
      const copy = yield* secondCopy
      assert.isTrue(Option.contains(copy.stopTarget.stopTargetOf(stopChild("agent")), "agent"))
      assert.isTrue(Option.contains(delayOf(copy.root.raise({ type: "LATER" }, { delay: 10 })), 10))
      assert.isTrue(Option.contains(copy.actionDelay.delayOf(raise({ type: "LATER" }, { delay: 10 })), 10))
      // Each stays out of the definition's enumerable form, as a WeakMap entry was
      assert.deepStrictEqual(Object.keys(stopChild("agent")).sort(), ["exec", "type"])
      assert.deepStrictEqual(Object.getOwnPropertySymbols({ ...stopChild("agent") }), [])
    })
  )

  it.effect("[COV-4] the proof of one copy finds a stop of an invoked agent that the other copy's stopChild wrote", () =>
    Effect.gen(function* () {
      const copy = yield* secondCopy
      const agent = copy.agents.fromAgent({ budget: 1, deadline: 1000, tools: {}, turn: () => Effect.void })
      const machine = copy.root.createMachine({
        id: "stopped",
        initial: "asking",
        states: {
          asking: { invoke: { src: "agent", id: "agent", onDone: "done" }, on: { STOP: { actions: stopChild("agent") } } },
          done: { type: "final" },
        },
      } as never, { actors: { agent } } as never)
      const exit = yield* Effect.exit(copy.settlement.proveSettlement(machine))
      const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined
      assert.deepInclude(JSON.stringify(error), "StopsInvokedAgent")
    })
  )

  it.effect("[COV-4] agent logic of one copy under the runtime of the other fails closed: the actor errors, and no turn runs", () =>
    Effect.gen(function* () {
      const copy = yield* secondCopy
      const runs = { count: 0 }
      const turn = () => Effect.sync(() => runs.count++)
      const ownAgent = fromAgent({ budget: 1, deadline: 1000, tools: {}, turn })
      const otherAgent = copy.agents.fromAgent({ budget: 1, deadline: 1000, tools: {}, turn })
      const config = {
        id: "crossed",
        initial: "asking",
        states: {
          asking: { invoke: { src: "agent", id: "agent", input: undefined, onDone: "done" } },
          done: { type: "final" as const },
        },
      }
      // This copy's machine and agent under the other copy's actor runtime
      const underOther = yield* copy.root.createActor(createMachine(config as never, { actors: { agent: ownAgent } } as never))
      yield* underOther.start
      assert.strictEqual((yield* underOther.getSnapshotUntyped).status, "error")
      // The other copy's agent in this copy's machine and runtime
      const inOwn = yield* createActor(createMachine(config as never, { actors: { agent: otherAgent } } as never))
      yield* inOwn.start
      assert.strictEqual((yield* inOwn.getSnapshotUntyped).status, "error")
      yield* settle
      assert.strictEqual(runs.count, 0)
    })
  )
})
