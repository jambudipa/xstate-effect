/**
 * S5: the machine output comes from the root output mapper.
 *
 * T3.16. Upstream `getMachineOutput` in `src/stateUtils.ts` at xstate@5.33.2: when a top-level
 * final state completes the machine, the machine output is the root `output` resolved with
 * `{ context, event, self }`, where `event` is the done-state event of the completion node:
 * `xstate.done.state.<final node id>` carrying that node's own output for a final child of a
 * compound root, `xstate.done.state.<root id>` with no output for a parallel root or a root
 * that is itself final. The context is the one the final state's entry actions produced. A
 * final child's own `output` only feeds that event, never the machine output: a root without
 * `output` gives none.
 *
 * The port keeps every output as an Option (D8): `snapshot.output` is `Option.some` of the
 * mapper result and `Option.none()` without a root `output`; the done-state event is a plain
 * object with its `output` as an Option (SD-5).
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import type { ActorRefBase } from "../../src/ActorRef.js"
import { assign, createActor, createMachine, type EventObject } from "../../src/index.js"

/** A captured event: any event, with the `output` field a done-state event carries. */
type Captured = EventObject & { readonly output?: unknown }

/** What a root output mapper receives (upstream `resolveOutput`). */
interface MapperArgs<TContext> {
  readonly context: TContext
  readonly event: Captured
  readonly self: ActorRefBase
}

interface Counter {
  readonly count: number
}

describe("S5 The machine output comes from the root output mapper", () => {
  it.effect("[S5] reaching the top-level final state sets snapshot.output to Some of the root mapper result", () =>
    Effect.gen(function* () {
      const machine = createMachine<Counter, EventObject>({
        id: "s5-result",
        initial: "working",
        context: { count: 2 },
        output: ({ context }: MapperArgs<Counter>) => ({ total: context.count * 10 }),
        states: {
          working: { on: { FINISH: "finished" } },
          finished: { type: "final" },
        },
      })

      const actor = yield* createActor(machine)
      yield* actor.start
      assert.deepStrictEqual((yield* actor.getSnapshot).output, Option.none())

      yield* actor.send({ type: "FINISH" })

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "done")
      assert.deepStrictEqual(snapshot.output, Option.some({ total: 20 }))
    })
  )

  it.effect("[S5] the root mapper receives the xstate.done.state event of the final node, with that node's own output as an Option", () =>
    Effect.gen(function* () {
      const events: Array<Captured> = []
      const machine = createMachine<Counter, EventObject>({
        id: "s5-event",
        initial: "working",
        context: { count: 3 },
        output: ({ event }: MapperArgs<Counter>) => {
          events.push(event)
          return event.output
        },
        states: {
          working: { on: { FINISH: "finished" } },
          finished: {
            type: "final",
            output: ({ context }: { readonly context: Counter }) => `final ${context.count}`,
          },
        },
      })

      const actor = yield* createActor(machine)
      yield* actor.start
      yield* actor.send({ type: "FINISH" })

      assert.deepStrictEqual(events, [{ type: "xstate.done.state.s5-event.finished", output: Option.some("final 3") }])
      // The final node's output reaches the machine output only through the mapper
      assert.deepStrictEqual((yield* actor.getSnapshot).output, Option.some(Option.some("final 3")))
    })
  )

  it.effect("[S5] a parallel root and a root that is itself final give the mapper xstate.done.state.<root id> with Option.none() as its output", () =>
    Effect.gen(function* () {
      const events: Array<Captured> = []
      const keep = ({ event }: MapperArgs<object>) => {
        events.push(event)
        return event.type
      }
      const parallel = createMachine<object, EventObject>({
        id: "s5-parallel",
        type: "parallel",
        context: {},
        output: keep,
        states: {
          left: { initial: "l1", states: { l1: { on: { FINISH: "l2" } }, l2: { type: "final", output: "left" } } },
          right: { initial: "r1", states: { r1: { type: "final", output: "right" } } },
        },
      })
      // upstream: output of a machine with a root state being final should be called with a
      // "xstate.done.state.ROOT_ID" event
      const rootFinal = createMachine<object, EventObject>({ id: "s5-root", type: "final", context: {}, output: keep })

      const parallelActor = yield* createActor(parallel)
      yield* parallelActor.start
      yield* parallelActor.send({ type: "FINISH" })
      const rootActor = yield* createActor(rootFinal)
      yield* rootActor.start

      assert.deepStrictEqual(events, [
        { type: "xstate.done.state.s5-parallel", output: Option.none() },
        { type: "xstate.done.state.s5-root", output: Option.none() },
      ])
      assert.deepStrictEqual((yield* parallelActor.getSnapshot).output, Option.some("xstate.done.state.s5-parallel"))
      assert.deepStrictEqual((yield* rootActor.getSnapshot).output, Option.some("xstate.done.state.s5-root"))
    })
  )

  it.effect("[S5] the root mapper receives self and the context that the final state's entry actions produced", () =>
    Effect.gen(function* () {
      const seen: Array<{ readonly self: ActorRefBase; readonly context: Counter }> = []
      const machine = createMachine<Counter, EventObject>({
        id: "s5-self",
        initial: "working",
        context: { count: 0 },
        output: ({ context, self }: MapperArgs<Counter>) => {
          seen.push({ self, context })
          return context.count
        },
        states: {
          working: { on: { FINISH: "finished" } },
          finished: {
            type: "final",
            entry: assign<Counter, EventObject>(({ context }) => ({ count: context.count + 5 })),
          },
        },
      })

      const actor = yield* createActor(machine)
      yield* actor.start
      yield* actor.send({ type: "FINISH" })

      assert.strictEqual(seen.length, 1)
      assert.strictEqual(seen[0]?.self, actor)
      assert.deepStrictEqual(seen[0]?.context, { count: 5 })
      assert.deepStrictEqual((yield* actor.getSnapshot).output, Option.some(5))
    })
  )

  it.effect("[S5] a final child's own output never becomes the machine output: a root without output gives Option.none()", () =>
    Effect.gen(function* () {
      const machine = createMachine<object, EventObject>({
        id: "s5-no-root-output",
        initial: "working",
        context: {},
        states: {
          working: { on: { FINISH: "finished" } },
          finished: { type: "final", output: { result: "child only" } },
        },
      })

      const actor = yield* createActor(machine)
      yield* actor.start
      yield* actor.send({ type: "FINISH" })

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "done")
      assert.deepStrictEqual(snapshot.output, Option.none())
    })
  )

  it.effect("[S5] a machine whose initial state is final has the root mapper result as its output from creation on", () =>
    Effect.gen(function* () {
      let calls = 0
      const machine = createMachine<Counter, EventObject>({
        id: "s5-initial",
        initial: "finished",
        context: { count: 7 },
        output: ({ context }: MapperArgs<Counter>) => {
          calls++
          return context.count
        },
        states: { finished: { type: "final" } },
      })

      const actor = yield* createActor(machine)
      assert.deepStrictEqual((yield* actor.getSnapshot).output, Option.some(7))
      yield* actor.start

      // upstream: should only call data expression once when entering root's final state
      assert.strictEqual(calls, 1)
      assert.deepStrictEqual((yield* actor.getSnapshot).output, Option.some(7))
    })
  )
})
