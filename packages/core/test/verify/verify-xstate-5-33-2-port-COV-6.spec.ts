/**
 * COV-6: enqueue.sendSelf sends an event to the machine actor itself.
 *
 * Coverage layer #6 (`src/actions`, risk R-009, P1-019). `sendSelf` and `enqueue.sendSelf`
 * are port extras (COMPAT-3): `sendSelf(event, options)` is `sendTo("#_self", event,
 * options)`, and `#_self` is the machine actor itself (CONFORMANCE DEV-33). As every
 * `sendTo`, the event goes through the actor's mailbox after the macrostep that sent it, so a
 * raised event comes first; a `delay` schedules it under the send's `id`, which `cancel`
 * takes back.
 *
 * The A-series specs cover `sendSelf` as an action and every other helper of the enqueuer;
 * this spec covers `enqueue.sendSelf`. It also covers `assignProperty` written inline (its
 * types come from the machine) and called inside a custom action (upstream's assign warning).
 *
 * Agent settlement (NEG-3, NEG-3.1, NEG-9, a port addition): agent logic settles only through
 * an invocation's `onDone`, so `spawnChild` and `enqueue.spawnChild` refuse it by type, given
 * inline or by a declared name, and `stopChild` refuses the id `types.children` gives an
 * agent. A cast that hides the brand, and `spawnChildFromRegistry`, fail at run time with
 * `AgentSpawnError` before the agent's logic runs.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Logger, Option } from "effect"
import { TestClock } from "effect/testing"
import type { AnyActorLogic } from "../../src/ActorLogic.js"
import type { AnyStateMachine } from "../../src/index.js"
import { spawnChildFromRegistry } from "../../src/actions/spawnChild.js"
import { fromEffect } from "../../src/actors/fromEffect.js"
import { AgentSpawnError } from "../../src/Errors.js"
import { markAgentLogic } from "../../src/internal/agentBrand.js"
import { assignProperty, certified, createActor, createMachine, enqueueActions, setup, spawnChild, stopChild } from "../../src/index.js"
import { builtInCalledInCustomAction } from "./upstream-messages.js"

interface Ctx {
  readonly count: number
}

type Ev =
  | { readonly type: "GO" }
  | { readonly type: "LATER" }
  | { readonly type: "CANCEL" }
  | { readonly type: "PING"; readonly from: string }

/** Lets every other ready fiber take a bounded number of turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 25; turn++) {
    yield* Effect.yieldNow
  }
})

/** Moves the test clock by `millis` and lets each delivery it caused run. */
const advance = (millis: number) => Effect.andThen(TestClock.adjust(`${millis} millis`), settle)

/**
 * `GO` enqueues a `sendSelf` of `PING` before a `raise` of `PING`; `LATER` enqueues a
 * `sendSelf` of `PING` 100 ms later under the id `later`; `CANCEL` enqueues its cancel. Each
 * `PING` it handles is logged with its `from`.
 */
const pingMachine = (handled: Array<string>) =>
  createMachine<Ctx, Ev>({
    id: "cov6",
    context: { count: 0 },
    on: {
      GO: {
        actions: enqueueActions<Ctx, Ev>(({ enqueue }) => {
          enqueue.sendSelf({ type: "PING", from: "sendSelf" })
          enqueue.raise({ type: "PING", from: "raise" })
        }),
      },
      LATER: {
        actions: enqueueActions<Ctx, Ev>(({ enqueue }) => {
          enqueue.sendSelf({ type: "PING", from: "delayed sendSelf" }, { delay: 100, id: "later" })
        }),
      },
      CANCEL: { actions: enqueueActions<Ctx, Ev>(({ enqueue }) => enqueue.cancel("later")) },
      PING: {
        actions: ({ event }) => {
          handled.push(event.type === "PING" ? event.from : event.type)
        },
      },
    },
  })

describe("COV-6 enqueue.sendSelf sends an event to the machine actor itself", () => {
  it.effect("[COV-6] enqueue.sendSelf delivers the event to the actor itself, after the event that a later enqueue.raise raises", () =>
    Effect.gen(function* () {
      const handled: Array<string> = []
      const actor = yield* createActor(pingMachine(handled))
      yield* actor.start

      yield* actor.send({ type: "GO" })
      yield* settle

      // A send, not a raise: the raised PING ends GO's macrostep, the sent one comes after
      assert.deepStrictEqual(handled, ["raise", "sendSelf"])
      assert.strictEqual((yield* actor.getSnapshot).status, "active")
    }))

  it.effect("[COV-6] a delayed enqueue.sendSelf arrives after its delay, and enqueue.cancel by its id takes it back", () =>
    Effect.gen(function* () {
      const handled: Array<string> = []
      const actor = yield* createActor(pingMachine(handled))
      yield* actor.start

      yield* actor.send({ type: "LATER" })
      yield* advance(99)
      assert.deepStrictEqual(handled, [])
      yield* advance(1)
      assert.deepStrictEqual(handled, ["delayed sendSelf"])

      yield* actor.send({ type: "LATER" })
      yield* advance(50)
      yield* actor.send({ type: "CANCEL" })
      yield* advance(100)
      assert.deepStrictEqual(handled, ["delayed sendSelf"], "the cancelled send never arrives")
    }))
})

describe("COV-6 assignProperty reads its types from where it is written", () => {
  it.effect("[COV-6] assignProperty written inline types its assigner by the machine's context and events, and called inside a custom action gives upstream's assign warning", () =>
    Effect.gen(function* () {
      const warnings: Array<unknown> = []
      const counter = createMachine({
        types: {} as { context: { count: number; label: string }; events: { type: "INC"; by: number } | { type: "MISUSE" } },
        context: { count: 0, label: "start" },
        on: {
          INC: { actions: [assignProperty("count", ({ context, event }) => context.count + (event.type === "INC" ? event.by : 0)), assignProperty("label", "counted")] },
          MISUSE: {
            actions: () => {
              // Called, not written as an action: nothing gives it the machine's types
              assignProperty<{ count: number; label: string }, { type: "MISUSE" }, "count">("count", 99)
            },
          },
        },
      })
      // The actor logs with the services of its creation, so the test logger wraps it
      const context = yield* Effect.gen(function* () {
        const actor = yield* createActor(counter)
        yield* actor.start
        yield* actor.send({ type: "INC", by: 2 })
        yield* actor.send({ type: "MISUSE" })
        return (yield* actor.getSnapshot).context
      }).pipe(
        Effect.provide(
          Logger.layer([
            Logger.make((options) => {
              if (options.logLevel === "Warn") {
                warnings.push(...(Array.isArray(options.message) ? options.message : [options.message]))
              }
            }),
          ])
        )
      )

      assert.deepStrictEqual(context, { count: 2, label: "counted" })
      assert.deepStrictEqual(warnings, [builtInCalledInCustomAction("assign")])
    })
  )
})

/** Ordinary effect logic: spawnable everywhere. */
const ordinaryLogic = fromEffect(() => Effect.succeed(1))

/** Effect logic marked as agent logic, as `fromAgent` marks its own. */
const agentLogic = markAgentLogic(fromEffect(() => Effect.succeed(1)))

/** A setup with one agent actor, whose child id `types.children` declares, and one ordinary actor. */
const agentSetup = setup({
  types: {} as { children: { helper: "agent" } },
  actors: { agent: agentLogic, worker: ordinaryLogic },
})

/** Ordinary logic spawns as before, inline and by name; a stop of an ordinary child's id compiles. */
export const spawnsOrdinary = agentSetup.createMachine({
  // The settlement proof needs a state that reaches a final state in a setup with agent actors
  initial: "running", states: { running: { after: { 600000: "done" } }, done: { type: "final" } }, entry: [
    spawnChild(ordinaryLogic),
    spawnChild("worker"),
    enqueueActions(({ enqueue }) => {
      enqueue.spawnChild(ordinaryLogic)
      enqueue.spawnChild("worker")
      enqueue.stopChild("other")
    }),
    agentSetup.stopChild("other"),
    stopChild("other"),
    stopChild(({ children }) => children["other"]),
  ],
})

export const refusesAgentSpawns = agentSetup.createMachine({
  initial: "done", states: { done: { type: "final" } }, entry: [
    // @ts-expect-error agent logic given inline to spawnChild is refused ([AgentBrand] is not never)
    spawnChild(agentLogic),
    // @ts-expect-error the declared name of agent logic is not spawnable
    spawnChild("agent", { id: "helper" }),
    enqueueActions(({ enqueue }) => {
      // @ts-expect-error agent logic given inline to enqueue.spawnChild is refused
      enqueue.spawnChild(agentLogic)
      // @ts-expect-error the declared name of agent logic is not spawnable through enqueue either
      enqueue.spawnChild("agent", { id: "helper" })
      // @ts-expect-error the id types.children gives an agent is not stoppable
      enqueue.stopChild("helper")
    }),
    // @ts-expect-error the id types.children gives an agent is not stoppable through the module stopChild either
    stopChild("helper"),
  ],
})

/** A stop id typed as a union is refused when any member is an agent's id, at each of the three stop entry points. */
export const refusesAgentIdUnions = (cond: boolean, wide: string) => agentSetup.createMachine({
  initial: "done", states: { done: { type: "final" } }, entry: [
    // @ts-expect-error a union with an agent's id is refused through the module stopChild
    stopChild(cond ? "helper" : "other"),
    // @ts-expect-error nor through the setup's stopChild
    agentSetup.stopChild(cond ? "helper" : "other"),
    enqueueActions(({ enqueue }) => {
      // @ts-expect-error nor through enqueue.stopChild
      enqueue.stopChild(cond ? "helper" : "other")
      // A union of ids no agent has, and a wide string, still pass
      enqueue.stopChild(cond ? "other" : "another")
      enqueue.stopChild(wide)
    }),
    stopChild(cond ? "other" : "another"),
    agentSetup.stopChild(wide),
  ],
})

/** Runs `machine` until its first snapshot settles and gives that snapshot. */
const firstSnapshot = (machine: AnyStateMachine) =>
  Effect.gen(function* () {
    const actor = yield* createActor(machine)
    yield* actor.start
    return yield* actor.getSnapshot
  })

describe("COV-6 agent logic is not spawnable (NEG-3, NEG-3.1)", () => {
  it.effect("[COV-6] spawnChild of agent logic whose brand a cast hid fails with AgentSpawnError before the agent runs", () =>
    Effect.gen(function* () {
      let runs = 0
      const hidden = markAgentLogic(fromEffect(() => Effect.sync(() => runs++))) as unknown as AnyActorLogic
      const snapshot = yield* firstSnapshot(createMachine({ id: "parent", entry: spawnChild(hidden) }))
      assert.strictEqual(snapshot.status, "error")
      const error = Option.getOrUndefined(snapshot.error)
      assert.instanceOf(error, AgentSpawnError)
      assert.strictEqual(error.machineId, "parent")
      assert.strictEqual(runs, 0)
      assert.deepStrictEqual(snapshot.children, {})
    })
  )

  it.effect("[COV-6] spawnChild by a name that provide gave agent logic fails with AgentSpawnError naming that src", () =>
    Effect.gen(function* () {
      const hidden = agentLogic as unknown as AnyActorLogic
      const machine = createMachine({ id: "parent", entry: spawnChild("helper") }).provide({ actors: { helper: hidden } })
      const snapshot = yield* firstSnapshot(machine)
      const error = Option.getOrUndefined(snapshot.error)
      assert.instanceOf(error, AgentSpawnError)
      assert.strictEqual(error.src, "helper")
    })
  )

  it.effect("[COV-6] spawnChildFromRegistry of agent logic fails with AgentSpawnError and no agent turn runs", () =>
    Effect.gen(function* () {
      let runs = 0
      const agent = markAgentLogic(fromEffect(() => Effect.sync(() => runs++)))
      const machine = createMachine({ id: "parent", entry: spawnChildFromRegistry("agent", { actors: { agent } }) })
      const snapshot = yield* firstSnapshot(machine)
      assert.strictEqual(snapshot.status, "error")
      const error = Option.getOrUndefined(snapshot.error)
      assert.instanceOf(error, AgentSpawnError)
      assert.strictEqual(error.src, "agent")
      assert.strictEqual(runs, 0)
    })
  )

  it.effect("[COV-6] a spawnChild by a name of agent logic fails with AgentSpawnError before its input function runs", () =>
    Effect.gen(function* () {
      const runs = { input: 0, agent: 0 }
      const agent = markAgentLogic(fromEffect(() => Effect.sync(() => runs.agent++))) as unknown as AnyActorLogic
      const machine = createMachine({
        id: "parent",
        entry: spawnChild("helper", { input: () => runs.input++ }),
      }).provide({ actors: { helper: agent } })
      const error = Option.getOrUndefined((yield* firstSnapshot(machine)).error)
      assert.instanceOf(error, AgentSpawnError)
      assert.deepStrictEqual(runs, { input: 0, agent: 0 })
    })
  )

  it.effect("[COV-6] ordinary logic still spawns through spawnChild, enqueue.spawnChild and the registry", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        entry: [
          spawnChild(ordinaryLogic, { id: "inline" }),
          enqueueActions(({ enqueue }) => enqueue.spawnChild(ordinaryLogic, { id: "enqueued" })),
          spawnChildFromRegistry("worker", { actors: { worker: ordinaryLogic } }, { id: "registered" }),
        ],
      })
      const snapshot = yield* firstSnapshot(machine)
      assert.strictEqual(snapshot.status, "active")
      assert.deepStrictEqual(Object.keys(snapshot.children).sort(), ["enqueued", "inline", "registered"])
    })
  )

  it.effect("[COV-6] stopChild of an ordinary child's id still stops it", () =>
    Effect.gen(function* () {
      const machine = createMachine({ entry: [spawnChild(ordinaryLogic, { id: "kid" }), stopChild("kid")] })
      const snapshot = yield* firstSnapshot(machine)
      assert.deepStrictEqual(snapshot.children, {})
    })
  )
})

describe("COV-6 certified: binding a certificate to a machine", () => {
  it("returns the same machine, as the certificate is a type-level mark", () => {
    const machine = createMachine({ initial: "done", states: { done: { type: "final" } } })
    assert.strictEqual(certified(machine, { states: ["done"], edges: [], explored: 1, hash: "x", verdict: "proved" }), machine)
  })
})
