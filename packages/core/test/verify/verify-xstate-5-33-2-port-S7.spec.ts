/**
 * S7: xstate.done.state events are raised for completed parents.
 *
 * T2.37. Upstream `enterStates` and `isInFinalState` in `src/stateUtils.ts` at
 * xstate@5.33.2: a parallel state is complete when every region is complete. When the
 * entry of a final node completes a parallel ancestor, the engine raises
 * `xstate.done.state.<parallel id>` once, then walks up while the next parallel ancestor is
 * complete too, so nested parallel states complete bottom-up. Regions that finish in the
 * same microstep raise one done event for the parallel state. The done event of a compound
 * region carries its final state's output; the done event of a parallel state carries none
 * (`Option.none()`, D8), as XState raises it without output.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import {
  type ActorLogicType,
  createMachine,
  type EventObject,
  getInitialSnapshot,
  getNextSnapshot,
  type MachineSnapshot,
  Types,
} from "../../src/index.js"

/** The initial snapshot through `getInitialSnapshot`, widened until T2.40 (as S2 and S3 do). */
const initialSnapshotOf = (machine: object): Effect.Effect<MachineSnapshot> =>
  getInitialSnapshot(machine as ActorLogicType.Any, undefined) as unknown as Effect.Effect<MachineSnapshot>

/** The next snapshot through `getNextSnapshot` (same widening). */
const nextSnapshotOf = (machine: object, snapshot: MachineSnapshot, event: EventObject): Effect.Effect<MachineSnapshot> =>
  getNextSnapshot(machine as ActorLogicType.Any, snapshot, event) as unknown as Effect.Effect<MachineSnapshot>

/** The snapshot after each event in turn, from the initial snapshot. */
const afterEvents = (machine: object, types: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    let snapshot = yield* initialSnapshotOf(machine)
    for (const type of types) {
      snapshot = yield* nextSnapshotOf(machine, snapshot, { type })
    }
    return snapshot
  })

/** A captured event: any event, with the `output` field a done event carries. */
type Captured = EventObject & { readonly output?: unknown }

/** An action definition that appends the event it runs with to `events`. */
const capture = (events: Array<Captured>) => ({
  type: "capture",
  exec: ({ event }: { readonly event: EventObject }) =>
    Effect.sync(() => {
      events.push(event)
      return Types.ActionResult.NoOp()
    }),
})

/**
 * `foo` is a parallel state with regions `first` (`NEXT_1` → final `b`, output `"one"`) and
 * `second` (`NEXT_2` → final `b`, output `"two"`). Each region's `onDone` captures into
 * `regionEvents`; the parallel's `onDone` captures into `parallelEvents` and goes to `bar`.
 */
const parallelMachine = (parallelEvents: Array<Captured>, regionEvents: Array<Captured>) =>
  createMachine<object, EventObject>({
    id: "m",
    initial: "foo",
    context: {},
    states: {
      foo: {
        type: "parallel",
        states: {
          first: {
            initial: "a",
            states: {
              a: { on: { NEXT_1: "b" } },
              b: { type: "final", output: "one" },
            },
            onDone: { actions: capture(regionEvents) },
          },
          second: {
            initial: "a",
            states: {
              a: { on: { NEXT_2: "b" } },
              b: { type: "final", output: "two" },
            },
            onDone: { actions: capture(regionEvents) },
          },
        },
        onDone: { target: "bar", actions: capture(parallelEvents) },
      },
      bar: {},
    },
  })

const eventTypes = (events: ReadonlyArray<EventObject>): ReadonlyArray<string> => events.map((event) => event.type)

describe("S7 xstate.done.state events are raised for completed parents", () => {
  it.effect("[S7] a parallel state whose regions complete in either order runs its onDone once with xstate.done.state.<parallel id>", () =>
    Effect.gen(function* () {
      for (const order of [
        ["NEXT_1", "NEXT_2"],
        ["NEXT_2", "NEXT_1"],
      ]) {
        const parallelEvents: Array<Captured> = []
        const machine = parallelMachine(parallelEvents, [])
        const [firstEvent = "", lastEvent = ""] = order

        const partial = yield* afterEvents(machine, [firstEvent])
        assert.strictEqual(partial.status, "active")
        assert.deepStrictEqual(parallelEvents, [])

        const complete = yield* nextSnapshotOf(machine, partial, { type: lastEvent })
        assert.strictEqual(complete.value, "bar")
        assert.strictEqual(complete.status, "active")
        // XState raises a parallel state's done event without output (D8: Option.none())
        assert.deepStrictEqual(parallelEvents, [{ type: "xstate.done.state.m.foo", output: Option.none() }])
      }
    })
  )

  it.effect("[S7] each region's done event carries its final state's output", () =>
    Effect.gen(function* () {
      const parallelEvents: Array<Captured> = []
      const regionEvents: Array<Captured> = []
      yield* afterEvents(parallelMachine(parallelEvents, regionEvents), ["NEXT_2", "NEXT_1"])

      assert.deepStrictEqual(regionEvents, [
        { type: "xstate.done.state.m.foo.second", output: Option.some("two") },
        { type: "xstate.done.state.m.foo.first", output: Option.some("one") },
      ])
      assert.deepStrictEqual(eventTypes(parallelEvents), ["xstate.done.state.m.foo"])
    })
  )

  it.effect("[S7] regions that complete in the same microstep raise one done event for the parallel state", () =>
    Effect.gen(function* () {
      const together: Array<Captured> = []
      const sameEvent = createMachine<object, EventObject>({
        id: "together",
        initial: "p",
        context: {},
        states: {
          p: {
            type: "parallel",
            states: {
              r1: { initial: "a", states: { a: { on: { FINISH: "b" } }, b: { type: "final" } } },
              r2: { initial: "a", states: { a: { on: { FINISH: "b" } }, b: { type: "final" } } },
            },
            onDone: { actions: capture(together) },
          },
        },
      })
      yield* afterEvents(sameEvent, ["FINISH"])
      assert.deepStrictEqual(eventTypes(together), ["xstate.done.state.together.p"])

      // upstream: onDone of a parallel state should only be called once when multiple parallel
      // regions complete at once
      const atStart: Array<Captured> = []
      const initiallyComplete = createMachine<object, EventObject>({
        id: "start",
        initial: "a",
        context: {},
        states: {
          a: {
            type: "parallel",
            states: {
              b: { type: "final" },
              c: { type: "final" },
            },
            onDone: { actions: capture(atStart) },
          },
        },
      })
      const initial = yield* initialSnapshotOf(initiallyComplete)
      assert.strictEqual(initial.status, "active")
      assert.deepStrictEqual(eventTypes(atStart), ["xstate.done.state.start.a"])
    })
  )

  it.effect("[S7] a region that is a final state completes the parallel state once the other region completes", () =>
    Effect.gen(function* () {
      // upstream: should emit a done state event for a parallel state when its compound child
      // reaches its final state when the other parallel child region is already in its final state
      const events: Array<Captured> = []
      const machine = createMachine<object, EventObject>({
        id: "mixed",
        initial: "p",
        context: {},
        states: {
          p: {
            type: "parallel",
            states: {
              done: { type: "final" },
              work: { initial: "busy", states: { busy: { on: { FINISH: "idle" } }, idle: { type: "final" } } },
            },
            onDone: { target: "after", actions: capture(events) },
          },
          after: {},
        },
      })

      const initial = yield* initialSnapshotOf(machine)
      assert.deepStrictEqual(initial.value, { p: { done: {}, work: "busy" } })
      assert.deepStrictEqual(events, [])

      const next = yield* nextSnapshotOf(machine, initial, { type: "FINISH" })
      assert.strictEqual(next.value, "after")
      assert.deepStrictEqual(eventTypes(events), ["xstate.done.state.mixed.p"])
    })
  )

  it.effect("[S7] nested parallel states complete bottom-up, each onDone with its own event", () =>
    Effect.gen(function* () {
      // upstream: onDone of an outer parallel state should be called with its own
      // "xstate.done.state.*" event when its direct parallel child completes
      const events: Array<Captured> = []
      const machine = createMachine<object, EventObject>({
        id: "nest",
        initial: "a",
        context: {},
        states: {
          a: {
            type: "parallel",
            onDone: { actions: capture(events) },
            states: {
              b: {
                type: "parallel",
                onDone: { actions: capture(events) },
                states: {
                  c: {
                    initial: "d1",
                    onDone: { actions: capture(events) },
                    states: {
                      d1: { on: { FINISH: "d2" } },
                      d2: { type: "final" },
                    },
                  },
                },
              },
            },
          },
        },
      })

      const next = yield* afterEvents(machine, ["FINISH"])
      assert.strictEqual(next.status, "active")
      assert.deepStrictEqual(events, [
        { type: "xstate.done.state.nest.a.b.c", output: Option.none() },
        { type: "xstate.done.state.nest.a.b", output: Option.none() },
        { type: "xstate.done.state.nest.a", output: Option.none() },
      ])
    })
  )
})
