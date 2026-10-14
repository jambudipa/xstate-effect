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
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Logger } from "effect"
import { TestClock } from "effect/testing"
import { assignProperty, createActor, createMachine, enqueueActions } from "../../src/index.js"
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
