/**
 * A23: assertEvent narrows or throws.
 *
 * T4.20. Upstream `assertEvent(event, type)` (`src/assert.ts` at xstate@5.33.2) takes one
 * event descriptor or a list of them: an event type, a partial descriptor such as `a.*`, or
 * `*`. It returns when the event matches one of them (upstream `matchesEventDescriptor`), and
 * its assertion signature narrows the event to `ExtractEvent<TEvent, descriptor>`: the events
 * whose type the descriptor matches, or the event as it is when its type is a wide `string`.
 * When no descriptor matches, it throws `Expected event <the event as JSON> to have type
 * matching "<type>"` (or `one of types matching "<a>", "<b>"` for a list).
 *
 * SD-3 (amended 2026-10-08) makes it an Effect: it succeeds with the same event, narrowed to
 * `ExtractEvent<TEvent, descriptor>`, or fails with a tagged error (`EventAssertionError`) whose
 * `name` is `Error`, so it prints as `[Error: <message>]`, as the upstream inline snapshots
 * expect. Inside an action that returns the Effect, the failure is the actor's error (SD-4):
 * status `error`, and `snapshot.error` is `Option.some` of that same error.
 *
 * The type-level cases are this file's own type check (`tsc -p tsconfig.test.green.json`).
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import {
  assertEvent,
  createActor,
  createMachine,
  Errors,
  type EventDescriptor,
  type EventObject,
  type ExtractEvent,
} from "../../src/index.js"
import { expectedEventType } from "./upstream-messages.js"

/** True when `A` and `B` are the same type. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

/** Compiles only for `true`. */
const typeHolds = <T extends true>(holds: T): T => holds

type A = { readonly type: "a"; readonly a: string }
type B = { readonly type: "b"; readonly b: number }
type CX = { readonly type: "c.x"; readonly cx: boolean }
type CYZ = { readonly type: "c.y.z"; readonly cyz: string }
type D = { readonly type: "d" }
type Ev = A | B | CX | CYZ | D

/** The event as the union type, so nothing is narrowed before `assertEvent`. */
const eventOf = (event: Ev): Ev => event

describe("A23 assertEvent narrows or throws", () => {
  it.effect("[A23] assertEvent with one event type succeeds with that event and narrows it", () =>
    Effect.gen(function* () {
      const event = eventOf({ type: "a", a: "hello" })
      // @ts-expect-error before the assertion the event may be any event, and only `a` has `a`
      assert.isUndefined(event.b)

      const asserted = yield* assertEvent(event, "a")

      typeHolds<Equals<typeof asserted, A>>(true)
      assert.strictEqual(asserted, event)
      const text: string = asserted.a
      assert.strictEqual(text, "hello")
    }))

  it.effect("[A23] assertEvent with a list of event types succeeds for any listed type and narrows to their union", () =>
    Effect.gen(function* () {
      const first = yield* assertEvent(eventOf({ type: "a", a: "one" }), ["a", "b"])
      const second = yield* assertEvent(eventOf({ type: "b", b: 2 }), ["a", "b"])

      typeHolds<Equals<typeof first, A | B>>(true)
      typeHolds<Equals<typeof second, A | B>>(true)
      // @ts-expect-error after the assertion the event is `a` or `b`, so it has no `cx`
      assert.isUndefined(first.cx)
      assert.deepStrictEqual([first.type, second.type], ["a", "b"])
    }))

  it.effect("[A23] assertEvent with a partial descriptor succeeds for every event under it and narrows to them", () =>
    Effect.gen(function* () {
      const short = yield* assertEvent(eventOf({ type: "c.x", cx: true }), "c.*")
      const long = yield* assertEvent(eventOf({ type: "c.y.z", cyz: "deep" }), "c.*")
      const middle = yield* assertEvent(eventOf({ type: "c.y.z", cyz: "middle" }), "c.y.*")

      typeHolds<Equals<typeof short, CX | CYZ>>(true)
      typeHolds<Equals<typeof long, CX | CYZ>>(true)
      typeHolds<Equals<typeof middle, CYZ>>(true)
      const deep: string = middle.cyz
      assert.strictEqual(deep, "middle")
      assert.deepStrictEqual([short.type, long.type], ["c.x", "c.y.z"])
    }))

  it.effect("[A23] assertEvent with the wildcard succeeds for any event and an event of a wide type is not narrowed", () =>
    Effect.gen(function* () {
      const event = yield* assertEvent(eventOf({ type: "d" }), "*")
      typeHolds<Equals<typeof event, Ev>>(true)

      const anything: EventObject = { type: "anything" }
      const wide = yield* assertEvent(anything, "anything")
      typeHolds<Equals<typeof wide, EventObject>>(true)
      typeHolds<Equals<ExtractEvent<EventObject, "x">, EventObject>>(true)
      assert.strictEqual(wide.type, "anything")
    }))

  it.effect("[A23] the descriptors are the event types, their partial descriptors and the wildcard", () =>
    Effect.gen(function* () {
      typeHolds<Equals<EventDescriptor<Ev>, "a" | "b" | "c.x" | "c.y.z" | "d" | "c.*" | "c.y.*" | "*">>(true)
      typeHolds<Equals<ExtractEvent<Ev, "c.*" | "a">, A | CX | CYZ>>(true)
      typeHolds<Equals<ExtractEvent<Ev, "*">, Ev>>(true)

      const event = eventOf({ type: "b", b: 0 })
      const unknownType = assertEvent(
        event,
        // @ts-expect-error `e` is no event type of `Ev`
        "e"
      )
      const noPartial = assertEvent(
        event,
        // @ts-expect-error `a` has no `.`, so `a.*` is no partial descriptor of `Ev`
        "a.*"
      )
      assert.instanceOf(yield* Effect.flip(unknownType), Errors.EventAssertionError)
      assert.instanceOf(yield* Effect.flip(noPartial), Errors.EventAssertionError)
    }))

  it.effect("[A23] a mismatch fails the Effect with the recorded message, for one type, a list and a partial descriptor", () =>
    Effect.gen(function* () {
      const b = eventOf({ type: "b", b: 1 })
      const d = eventOf({ type: "d" })

      const one = yield* Effect.flip(assertEvent(b, "a"))
      const list = yield* Effect.flip(assertEvent(b, ["a", "c.x"]))
      const partial = yield* Effect.flip(assertEvent(d, "c.*"))

      assert.strictEqual(one.message, expectedEventType({ type: "b", b: 1 }, ["a"]))
      assert.strictEqual(
        one.message,
        `Expected event {"type":"b","b":1} to have type matching "a"`
      )
      assert.strictEqual(
        list.message,
        `Expected event {"type":"b","b":1} to have one of types matching "a", "c.x"`
      )
      assert.strictEqual(
        partial.message,
        `Expected event {"type":"d"} to have type matching "c.*"`
      )
    }))

  it.effect("[A23] the failure is a tagged EventAssertionError named Error, so it prints as [Error: <message>]", () =>
    Effect.gen(function* () {
      const error: unknown = yield* Effect.flip(assertEvent(eventOf({ type: "d" }), ["a", "b"]))
      const message = expectedEventType({ type: "d" }, ["a", "b"])

      assert.instanceOf(error, Errors.EventAssertionError)
      assert.instanceOf(error, Error)
      assert.strictEqual((error as Errors.EventAssertionError)._tag, "EventAssertionError")
      assert.strictEqual((error as Error).name, "Error")
      assert.strictEqual(Error.prototype.toString.call(error), `Error: ${message}`)
    }))

  it.effect("[A23] inside an action a mismatch is the actor's error, and a match lets the action run on", () =>
    Effect.gen(function* () {
      const seen: Array<string> = []
      const machine = createMachine(
        {
          id: "a23-actor",
          types: {} as { events: Ev },
          on: { a: { actions: "check" }, b: { actions: "check" } },
        },
        {
          actions: {
            check: ({ event }) =>
              Effect.map(assertEvent(event, "a"), (asserted) => {
                seen.push(asserted.a)
              }),
          },
        }
      )
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* actor.send({ type: "a", a: "first" })
      assert.deepStrictEqual(seen, ["first"])
      assert.strictEqual((yield* actor.getSnapshot).status, "active")

      yield* actor.send({ type: "b", b: 7 })
      const snapshot = yield* actor.getSnapshot
      assert.deepStrictEqual(seen, ["first"])
      assert.strictEqual(snapshot.status, "error")
      const error = Option.getOrUndefined(snapshot.error)
      assert.instanceOf(error, Errors.EventAssertionError)
      assert.strictEqual((error as Error).message, expectedEventType({ type: "b", b: 7 }, ["a"]))
    })
  )
})
