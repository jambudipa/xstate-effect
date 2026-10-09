/**
 * A18: setup actors and delays reach the actions.
 *
 * T4.12. Upstream `setup` (`src/setup.ts` at xstate@5.33.2) passes its `actors` and `delays`
 * to `createMachine` as the machine's implementations, so the actions resolve names against
 * them while the transition runs: `spawnChild('<name>')` spawns the setup actor of that name
 * (`resolveSpawn`), and a delay name of `raise` and `sendTo` reads the setup delay
 * (`resolveRaise`, `resolveSendTo`). A setup delay is a `DelayConfig`: a number of
 * milliseconds, or a function called as `(args, actionParams)` that gives one. The port also
 * takes a `Duration`, in setup and in the function's result.
 *
 * The type-level cases are the file's own type check (`tsc -p tsconfig.test.green.json`): a
 * setup or provide delay function receives typed action arguments and declares its params;
 * a delay function that gives no number is rejected (`@ts-expect-error`).
 */
import { assert, describe, it } from "@effect/vitest"
import { Duration, Effect } from "effect"
import { TestClock } from "effect/testing"
import {
  type AnyActorLogic,
  createActor,
  fromCallback,
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

/** A callback logic that records the type of each event it receives. */
const recorder = (log: Array<string>) =>
  fromCallback(({ receive }) => {
    receive((event) => {
      log.push(event.type)
    })
  })

interface Ctx {
  readonly base: number
}

type Ev = { readonly type: "GO" } | { readonly type: "FIRE" } | { readonly type: "PING" }

describe("A18 setup actors and delays reach the actions", () => {
  it.effect("[A18] spawnChild('worker') spawns the setup actor worker, and a sendTo with a setup delay name reaches it after that delay", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = setup({
        types: { context: {} as Ctx, events: {} as Ev },
        actors: { worker: recorder(log) },
        delays: { later: 200 },
      }).createMachine({
        id: "a18-worker",
        context: { base: 0 },
        entry: [
          spawnChild<Ctx, Ev, AnyActorLogic>("worker", { id: "w" }),
          sendTo<Ctx, Ev>("w", { type: "PING" }, { delay: "later" }),
        ],
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      const child = (yield* actor.getSnapshot).children["w"]
      assert.isDefined(child)
      assert.strictEqual(child?.src, "worker")

      yield* advance(199)
      assert.deepStrictEqual(log, [])
      yield* advance(1)
      assert.deepStrictEqual(log, ["PING"])
    })
  )

  it.effect("[A18] raise uses a setup delay that is a function of the action arguments and the params of the use", () =>
    Effect.gen(function* () {
      const machine = setup({
        types: { context: {} as Ctx, events: {} as Ev },
        actions: {
          fireLater: raise<Ctx, Ev>({ type: "FIRE" }, { delay: "fromContext" }),
        },
        delays: {
          fromContext: ({ context }, params: { readonly extra: number }) => context.base + params.extra,
        },
      }).createMachine({
        id: "a18-function-delay",
        context: { base: 100 },
        initial: "waiting",
        states: {
          waiting: {
            entry: { type: "fireLater", params: { extra: 50 } },
            on: { FIRE: "fired" },
          },
          fired: {},
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      assert.strictEqual((yield* actor.getSnapshot).status, "active")

      yield* advance(149)
      assert.strictEqual((yield* actor.getSnapshot).value, "waiting")
      yield* advance(1)
      assert.strictEqual((yield* actor.getSnapshot).value, "fired")
    })
  )

  it.effect("[A18] setup and provide type a delay as a number, a Duration or a function of the typed action arguments", () =>
    Effect.gen(function* () {
      const typed = setup({
        types: { context: {} as Ctx, events: {} as Ev },
        delays: {
          fixed: 10,
          span: Duration.millis(20),
          computed: ({ context, event }) => context.base + (event.type === "GO" ? 5 : 0),
        },
      })

      setup({
        types: { context: {} as Ctx, events: {} as Ev },
        // @ts-expect-error a delay function gives milliseconds or a Duration, not a string
        delays: { bad: () => "soon" },
      })

      const machine = typed.createMachine({
        id: "a18-typed",
        context: { base: 30 },
        initial: "a",
        states: {
          a: { after: { fixed: "b" } },
          b: { after: { span: "c" } },
          c: { after: { computed: "d" } },
          d: {},
        },
      })
      // A provided delay function receives the same typed arguments
      const provided = machine.provide({ delays: { computed: ({ context }) => context.base * 2 } })

      const actor = yield* createActor(machine)
      yield* actor.start
      yield* advance(10)
      assert.strictEqual((yield* actor.getSnapshot).value, "b")
      yield* advance(20)
      assert.strictEqual((yield* actor.getSnapshot).value, "c")
      yield* advance(29)
      assert.strictEqual((yield* actor.getSnapshot).value, "c")
      yield* advance(1)
      assert.strictEqual((yield* actor.getSnapshot).value, "d")

      // One step per timer: a timer that a delivery starts counts from the end of the step
      const providedActor = yield* createActor(provided)
      yield* providedActor.start
      yield* advance(10)
      assert.strictEqual((yield* providedActor.getSnapshot).value, "b")
      yield* advance(20)
      assert.strictEqual((yield* providedActor.getSnapshot).value, "c")
      yield* advance(59)
      assert.strictEqual((yield* providedActor.getSnapshot).value, "c")
      yield* advance(1)
      assert.strictEqual((yield* providedActor.getSnapshot).value, "d")
    })
  )
})
