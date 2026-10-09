/**
 * A20: machine.provide accepts plain functions, actors and delays.
 *
 * T4.18. Upstream `StateMachine.provide` at xstate@5.33.2 gives a new machine of the same
 * config whose `actions`, `guards`, `actors` and `delays` are `{ ...old, ...provided }` each,
 * so a provided implementation replaces the one of the same name and the others stay; the
 * original machine is unchanged, and a lazy context still runs once for each actor. A plain
 * function is an action, a guard or a delay; a provided actor logic serves a string src.
 *
 * Its type (`InternalMachineImplementations`) is built from the machine's own names: an action
 * or a guard of the machine with the params of that action or guard, a delay of the machine,
 * and an actor src of the machine with the logic type of that src. A name the machine does
 * not have is a type error, so is a function that takes other params and a logic of another
 * type. A machine that names nothing (a plain `createMachine`) takes any name and any actor
 * logic. The type-level case is this file's own type check (`tsc -p
 * tsconfig.test.green.json`).
 *
 * Port: `invoke` with a string src is phase 5, so a provided actor is shown through
 * `spawnChild` and `spawn` inside `assign` here.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import {
  type ActorRef,
  createActor,
  createMachine,
  fromCallback,
  fromTransition,
  raise,
  sendTo,
  setup,
  spawnChild,
} from "../../src/index.js"

/** Lets every other ready fiber take a bounded number of turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 25; turn++) {
    yield* Effect.yieldNow
  }
})

/** Moves the test clock by `millis` and lets each delivery it caused run. */
const advance = (millis: number) => Effect.andThen(TestClock.adjust(`${millis} millis`), settle)

interface Ctx {
  readonly count: number
  readonly ref?: ActorRef.ActorRefBase
}

type Ev =
  | { readonly type: "GO" }
  | { readonly type: "FORCE" }
  | { readonly type: "SPAWN" }
  | { readonly type: "RAISED" }
  | { readonly type: "SENT" }

/**
 * A setup machine that tracks on entry, takes GO only when `allow` holds, spawns `worker` in
 * `working` and leaves it for `done` after the delay `soon`. FORCE enters `working` without
 * the guard, so the machine whose `allow` is the setup's (always false) still reaches its
 * actor and its delay. Every implementation records its call in `calls`.
 */
const setupMachine = (calls: Array<string>) =>
  setup({
    types: { context: {} as Ctx, events: {} as Ev },
    actors: {
      worker: fromCallback(() => {
        calls.push("setup worker")
      }),
    },
    actions: {
      track: (_, params: { readonly id: number }) => {
        calls.push(`setup track ${params.id}`)
      },
    },
    guards: { allow: () => false },
    delays: { soon: 1000 },
  }).createMachine({
    id: "a20",
    context: { count: 1 },
    initial: "idle",
    states: {
      idle: {
        entry: { type: "track", params: { id: 7 } },
        on: { GO: { guard: "allow", target: "working" }, FORCE: "working" },
      },
      working: {
        entry: spawnChild("worker", { id: "w" }),
        after: { soon: "done" },
      },
      done: {},
    },
  })

describe("A20 machine.provide accepts plain functions, actors and delays", () => {
  it.effect("[A20] provide replaces a setup's actions, guards, actors and delays with plain functions and logic", () =>
    Effect.gen(function* () {
      const calls: Array<string> = []
      const original = setupMachine(calls)
      // The original's four records and their entries, before the provide call
      const before = {
        actions: original.implementations.actions,
        guards: original.implementations.guards,
        actors: original.implementations.actors,
        delays: original.implementations.delays,
        track: original.implementations.actions?.["track"],
        allow: original.implementations.guards?.["allow"],
        worker: original.implementations.actors?.["worker"],
        soon: original.implementations.delays?.["soon"],
      }
      const provided = original.provide({
        actions: {
          track: ({ context }, params) => {
            calls.push(`provided track ${params.id} at ${context.count}`)
          },
        },
        guards: { allow: ({ context }) => context.count === 1 },
        actors: {
          worker: fromCallback(() => {
            calls.push("provided worker")
          }),
        },
        delays: { soon: ({ context }) => context.count * 100 },
      })

      const actor = yield* createActor(provided)
      yield* actor.start
      assert.deepStrictEqual(calls, ["provided track 7 at 1"])

      yield* actor.send({ type: "GO" })
      yield* settle
      assert.strictEqual((yield* actor.getSnapshot).value, "working", "the provided guard decides")
      assert.deepStrictEqual(calls, ["provided track 7 at 1", "provided worker"])

      yield* advance(99)
      assert.strictEqual((yield* actor.getSnapshot).value, "working")
      yield* advance(1)
      assert.strictEqual((yield* actor.getSnapshot).value, "done", "the provided delay function decides")

      // The original is unchanged by the four-record provide: the same records, the same
      // entries, and the provided machine holds other ones
      assert.notStrictEqual(provided, original)
      assert.strictEqual(original.implementations.actions, before.actions)
      assert.strictEqual(original.implementations.guards, before.guards)
      assert.strictEqual(original.implementations.actors, before.actors)
      assert.strictEqual(original.implementations.delays, before.delays)
      assert.strictEqual(original.implementations.actions?.["track"], before.track)
      assert.strictEqual(original.implementations.guards?.["allow"], before.allow)
      assert.strictEqual(original.implementations.actors?.["worker"], before.worker)
      assert.strictEqual(original.implementations.delays?.["soon"], before.soon)
      assert.strictEqual(before.soon, 1000)
      assert.deepStrictEqual(Object.keys(original.implementations.actors ?? {}), ["worker"])
      assert.deepStrictEqual(Object.keys(original.implementations.delays ?? {}), ["soon"])
      assert.notStrictEqual(provided.implementations.actors?.["worker"], before.worker)
      assert.notStrictEqual(provided.implementations.delays?.["soon"], before.soon)

      // At runtime the original uses its own action, guard, actor and delay
      calls.length = 0
      const originalActor = yield* createActor(original)
      yield* originalActor.start
      assert.deepStrictEqual(calls, ["setup track 7"])
      yield* originalActor.send({ type: "GO" })
      yield* settle
      assert.strictEqual((yield* originalActor.getSnapshot).value, "idle", "the setup guard still decides")
      yield* originalActor.send({ type: "FORCE" })
      yield* settle
      assert.strictEqual((yield* originalActor.getSnapshot).value, "working")
      assert.deepStrictEqual(calls, ["setup track 7", "setup worker"], "the original spawns the setup worker")
      yield* advance(999)
      assert.strictEqual((yield* originalActor.getSnapshot).value, "working", "not the provided 100 ms delay")
      yield* advance(1)
      assert.strictEqual((yield* originalActor.getSnapshot).value, "done", "the setup 1000 ms delay decides")
    })
  )

  it.effect("[A20] the original machine is unchanged: provide gives a new machine and the original runs its own implementations", () =>
    Effect.gen(function* () {
      const calls: Array<string> = []
      const original = setupMachine(calls)
      const originalActions = original.implementations.actions
      const originalTrack = original.implementations.actions?.["track"]
      const providedTrack = () => {
        calls.push("provided track")
      }
      const provided = original.provide({ actions: { track: providedTrack }, guards: { allow: () => true } })

      assert.notStrictEqual(provided, original)
      assert.strictEqual(provided.config, original.config, "the same config (upstream)")
      assert.strictEqual(original.implementations.actions, originalActions)
      assert.strictEqual(original.implementations.actions?.["track"], originalTrack)
      assert.strictEqual(provided.implementations.actions?.["track"], providedTrack)
      assert.deepStrictEqual(Object.keys(original.implementations.guards ?? {}), ["allow"])
      assert.deepStrictEqual(Object.keys(provided.implementations.actors ?? {}), ["worker"], "a record not given stays")

      const actor = yield* createActor(original)
      yield* actor.start
      yield* actor.send({ type: "GO" })
      yield* settle
      assert.deepStrictEqual(calls, ["setup track 7"])
      assert.strictEqual((yield* actor.getSnapshot).value, "idle", "the original guard still decides")
    })
  )

  it.effect("[A20] provide twice: the later call wins for a name both give, and the earlier call's other implementations stay", () =>
    Effect.gen(function* () {
      const calls: Array<string> = []
      const first = setupMachine(calls).provide({
        actions: {
          track: () => {
            calls.push("first track")
          },
        },
        guards: { allow: () => true },
        delays: { soon: 50 },
      })
      const second = first.provide({
        actions: {
          track: () => {
            calls.push("second track")
          },
        },
      })

      const actor = yield* createActor(second)
      yield* actor.start
      yield* actor.send({ type: "GO" })
      yield* settle
      assert.deepStrictEqual(calls, ["second track", "setup worker"])
      assert.strictEqual((yield* actor.getSnapshot).value, "working", "the first call's guard stays")
      yield* advance(50)
      assert.strictEqual((yield* actor.getSnapshot).value, "done", "the first call's delay stays")

      // The first provided machine keeps its own
      calls.length = 0
      const firstActor = yield* createActor(first)
      yield* firstActor.start
      assert.deepStrictEqual(calls, ["first track"])
    })
  )

  it.effect("[A20] a provided actor serves a string src in spawnChild and in spawn inside assign", () =>
    Effect.gen(function* () {
      const calls: Array<string> = []
      const base = setup({
        types: { context: {} as Ctx, events: {} as Ev },
        actors: {
          worker: fromCallback(() => {
            calls.push("setup worker")
          }),
        },
      })
      const machine = base
        .createMachine({
          id: "a20-spawn",
          context: { count: 0 },
          on: {
            SPAWN: {
              actions: [spawnChild("worker", { id: "byAction" }), base.assign({ ref: ({ spawn }) => spawn("worker", { id: "byAssign" }) })],
            },
          },
        })
        .provide({
          actors: {
            worker: fromCallback(() => {
              calls.push("provided worker")
            }),
          },
        })

      const actor = yield* createActor(machine)
      yield* actor.start
      yield* actor.send({ type: "SPAWN" })
      yield* settle
      const snapshot = yield* actor.getSnapshot
      assert.deepStrictEqual(Object.keys(snapshot.children).sort(), ["byAction", "byAssign"])
      assert.strictEqual(snapshot.context.ref, snapshot.children["byAssign"])
      assert.deepStrictEqual(calls, ["provided worker", "provided worker"])
    })
  )

  it.effect("[A20] provided delays are used by after, raise and sendTo", () =>
    Effect.gen(function* () {
      const arrivals: Array<string> = []
      const machine = setup({
        types: { context: {} as Ctx, events: {} as Ev },
        delays: { short: 1000 },
      })
        .createMachine({
          id: "a20-delays",
          context: { count: 2 },
          initial: "idle",
          on: {
            RAISED: { actions: () => void arrivals.push("RAISED") },
            SENT: { actions: () => void arrivals.push("SENT") },
          },
          states: {
            idle: { on: { GO: "waiting" } },
            waiting: {
              entry: [
                raise({ type: "RAISED" }, { delay: "short" }),
                sendTo(({ self }) => self, { type: "SENT" }, { delay: "short" }),
              ],
              after: { short: "done" },
            },
            done: {},
          },
        })
        .provide({ delays: { short: ({ context }) => context.count * 50 } })

      const actor = yield* createActor(machine)
      yield* actor.start
      yield* actor.send({ type: "GO" })
      yield* advance(99)
      assert.deepStrictEqual(arrivals, [])
      assert.strictEqual((yield* actor.getSnapshot).value, "waiting")
      yield* advance(1)
      assert.deepStrictEqual(arrivals, ["RAISED", "SENT"])
      assert.strictEqual((yield* actor.getSnapshot).value, "done")
    })
  )

  it.effect("[A20] a lazy context runs once for each actor of a provided machine", () =>
    Effect.gen(function* () {
      let made = 0
      const machine = createMachine({
        types: {} as { context: { readonly items: Array<number> } },
        context: () => {
          made++
          return { items: [] }
        },
      })
      const copied = machine.provide({})

      const a = yield* createActor(copied)
      yield* a.start
      const b = yield* createActor(copied)
      yield* b.start
      assert.strictEqual(made, 2)
      const contextA = (yield* a.getSnapshot).context
      const contextB = (yield* b.getSnapshot).context
      assert.notStrictEqual(contextA.items, contextB.items)
      assert.deepStrictEqual(contextA, { items: [] })
    })
  )

  it.effect("[A20] the test type-check types provide by the machine's names: plain functions take its types; unknown names, other params and another logic are rejected", () =>
    Effect.sync(() => {
      const typed = setup({
        types: { context: {} as Ctx, events: {} as Ev },
        actors: { reducer: fromTransition((state: { readonly total: number }) => state, { total: 0 }) },
        actions: {
          track: (_, params: { readonly id: number }) => {
            void params.id
          },
          plain: () => {},
        },
        guards: {
          isPositive: ({ context }) => context.count > 0,
          atLeast: ({ context }, params: { readonly min: number }) => context.count >= params.min,
        },
        delays: { soon: 100 },
      })
      const machine = typed.createMachine({ id: "a20-types", context: { count: 0 } })

      // The machine's names, with plain functions whose arguments it types
      machine.provide({
        actions: {
          track: ({ context }, params) => {
            const id: number = params.id
            const count: number = context.count
            void [id, count]
          },
          plain: ({ event }) => {
            const type: Ev["type"] = event.type
            void type
          },
        },
        guards: {
          isPositive: ({ context }) => context.count > 1,
          atLeast: (_, params) => params.min > 0,
        },
        delays: { soon: ({ context }) => context.count },
        actors: { reducer: fromTransition((state: { readonly total: number }) => state, { total: 5 }) },
      })

      // A guard implementation may name another guard of the machine, with its params
      machine.provide({ guards: { isPositive: { type: "atLeast", params: { min: 1 } } } })

      machine.provide({
        actions: {
          // @ts-expect-error an action name the machine does not have
          unknown: () => {},
        },
      })

      machine.provide({
        actions: {
          // @ts-expect-error a function that takes other params
          track: (_, params: { readonly id: string }) => void params.id,
        },
      })

      machine.provide({
        guards: {
          // @ts-expect-error a guard name the machine does not have
          unknown: () => true,
        },
      })

      machine.provide({
        guards: {
          // @ts-expect-error a guard that names a guard the machine does not have
          isPositive: "unknown",
        },
      })

      machine.provide({
        delays: {
          // @ts-expect-error a delay name the machine does not have
          never: 100,
        },
      })

      machine.provide({
        actors: {
          // @ts-expect-error an actor name the machine does not have
          other: fromTransition((state: { readonly total: number }) => state, { total: 0 }),
        },
      })

      machine.provide({
        actors: {
          // @ts-expect-error an actor logic of another type
          reducer: fromTransition((state: string) => state, ""),
        },
      })

      // A machine that names nothing takes any name and any actor logic
      createMachine({ types: {} as { context: Ctx; events: Ev }, context: { count: 0 } }).provide({
        actions: { anything: ({ context }) => void context.count },
        guards: { any: ({ event }) => event.type === "GO" },
        actors: { worker: fromCallback(() => {}) },
        delays: { later: ({ context }) => context.count },
      })
    })
  )
})
