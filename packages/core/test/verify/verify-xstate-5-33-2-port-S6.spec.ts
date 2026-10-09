/**
 * S6: onDone fires on a compound or parallel parent, and a nested final does not finish the
 * machine.
 *
 * T2.37. Upstream `enterStates`, `getMachineOutput` and the completion exit phase of
 * `microstep` in `src/stateUtils.ts`, and `formatTransitions` in `src/StateNode.ts`, at
 * xstate@5.33.2: a node's `onDone` is its transition on `xstate.done.state.<node id>`.
 * Entering a final child of a compound node raises that event into the internal queue,
 * after the entry actions of the final node, carrying the final node's `output` resolved
 * with the context those actions left. The output is an `Option` (D8): `Option.none()` for
 * no output or an `undefined` result, `Option.some(null)` for `null` (SD-5, SD-7). Only a
 * final node with no ancestor left to complete finishes the machine: status `done`, the
 * root `output` as the machine output, the exit actions of every active node in reverse
 * document order, and no `onDone` runs.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import {
  type ActorLogicType,
  assign,
  createMachine,
  type DoneStateEvent,
  type EventObject,
  getInitialSnapshot,
  getNextSnapshot,
  type MachineSnapshot,
  type OutputDefinition,
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

/** An action definition that appends `label` to `log` each time it runs. */
const recorder = (log: Array<string>, label: string) => ({
  type: label,
  exec: () =>
    Effect.sync(() => {
      log.push(label)
      return Types.ActionResult.NoOp()
    }),
})

/** Entry and exit recorders for a state named `name`. */
const tracked = (log: Array<string>, name: string) => ({
  entry: recorder(log, `en ${name}`),
  exit: recorder(log, `ex ${name}`),
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

interface Counter {
  readonly count: number
}

describe("S6 onDone fires on a compound or parallel parent and a nested final does not finish the machine", () => {
  it.effect("[S6] a compound child reaching its final state takes the parent's onDone and the machine stays active", () =>
    Effect.gen(function* () {
      const machine = createMachine<object, EventObject>({
        id: "s6",
        initial: "task",
        context: {},
        states: {
          task: {
            initial: "working",
            states: {
              working: { on: { FINISH: "finished" } },
              finished: { type: "final" },
            },
            onDone: "review",
          },
          review: { on: { AGAIN: "task" } },
        },
      })

      const initial = yield* initialSnapshotOf(machine)
      assert.deepStrictEqual(initial.value, { task: "working" })

      const next = yield* nextSnapshotOf(machine, initial, { type: "FINISH" })
      assert.strictEqual(next.value, "review")
      assert.strictEqual(next.status, "active")
      assert.deepStrictEqual(next.output, Option.none())
    })
  )

  it.effect("[S6] a final state nested in a compound or parallel state does not finish the machine", () =>
    Effect.gen(function* () {
      const compound = createMachine<object, EventObject>({
        id: "s6-nested",
        initial: "task",
        context: {},
        states: {
          task: {
            initial: "working",
            states: {
              working: { on: { FINISH: "finished" } },
              finished: { type: "final" },
            },
          },
        },
      })
      const nested = yield* afterEvents(compound, ["FINISH"])
      assert.deepStrictEqual(nested.value, { task: "finished" })
      assert.strictEqual(nested.status, "active")
      assert.deepStrictEqual(nested.output, Option.none())

      // upstream: machine should not complete when a parallel child of a compound state completes
      const parallel = createMachine<object, EventObject>({
        id: "s6-parallel",
        initial: "a",
        context: {},
        states: {
          a: {
            type: "parallel",
            states: {
              b: { initial: "c", states: { c: { type: "final" } } },
            },
          },
        },
      })
      const initial = yield* initialSnapshotOf(parallel)
      assert.deepStrictEqual(initial.value, { a: { b: "c" } })
      assert.strictEqual(initial.status, "active")
    })
  )

  it.effect("[S6] the onDone event is xstate.done.state.<parent id> with the final state's output as an Option", () =>
    Effect.gen(function* () {
      const events: Array<Captured> = []
      const machine = createMachine<Counter, EventObject>({
        id: "s6-event",
        initial: "task",
        context: { count: 1 },
        states: {
          task: {
            initial: "working",
            states: {
              working: { on: { FINISH: "finished" } },
              finished: {
                type: "final",
                output: ({ context }: { readonly context: Counter }) => ({ total: context.count }),
              },
            },
            onDone: { target: "review", actions: capture(events) },
          },
          review: {},
        },
      })

      const next = yield* afterEvents(machine, ["FINISH"])
      assert.strictEqual(next.value, "review")
      // A plain object with the XState fields (SD-5); the output is an Option (D8)
      assert.deepStrictEqual(events, [{ type: "xstate.done.state.s6-event.task", output: Option.some({ total: 1 }) }])
    })
  )

  it.effect("[S6] a final state's output reads the context its own entry actions assigned", () =>
    Effect.gen(function* () {
      const events: Array<Captured> = []
      const machine = createMachine<Counter, EventObject>({
        id: "s6-entry",
        initial: "task",
        context: { count: 0 },
        states: {
          task: {
            initial: "working",
            states: {
              working: { on: { FINISH: "finished" } },
              finished: {
                type: "final",
                entry: assign<Counter, EventObject>(() => ({ count: 42 })),
                output: ({ context }: { readonly context: Counter }) => context.count,
              },
            },
            onDone: { actions: capture(events) },
          },
        },
      })

      const next = yield* afterEvents(machine, ["FINISH"])
      assert.deepStrictEqual(next.context, { count: 42 })
      assert.deepStrictEqual(
        events.map((event) => event.output),
        [Option.some(42)]
      )
    })
  )

  it.effect("[S6] a final state with no output or an undefined output gives Option.none(), and a null output Option.some(null)", () =>
    Effect.gen(function* () {
      const events: Array<Captured> = []
      const machine = createMachine<object, EventObject>({
        id: "s6-empty",
        initial: "task",
        context: {},
        states: {
          task: {
            initial: "working",
            states: {
              working: { on: { NONE: "noOutput", UNDEFINED: "undefinedOutput", NULL: "nullOutput" } },
              noOutput: { type: "final" },
              undefinedOutput: { type: "final", output: () => undefined },
              nullOutput: { type: "final", output: null },
            },
            onDone: { actions: capture(events) },
          },
        },
      })

      for (const type of ["NONE", "UNDEFINED", "NULL"]) {
        yield* afterEvents(machine, [type])
      }
      assert.deepStrictEqual(events, [
        { type: "xstate.done.state.s6-empty.task", output: Option.none() },
        { type: "xstate.done.state.s6-empty.task", output: Option.none() },
        { type: "xstate.done.state.s6-empty.task", output: Option.some(null) },
      ])
    })
  )

  it.effect("[S6] final child actions run first, then each completed parent's onDone, bottom-up", () =>
    Effect.gen(function* () {
      // upstream: should execute final child state actions first
      const log: Array<string> = []
      const machine = createMachine<object, EventObject>({
        id: "s6-order",
        initial: "foo",
        context: {},
        states: {
          foo: {
            initial: "bar",
            onDone: { actions: recorder(log, "fooAction") },
            states: {
              bar: {
                initial: "baz",
                onDone: "barFinal",
                states: {
                  baz: { type: "final", entry: recorder(log, "bazAction") },
                },
              },
              barFinal: { type: "final", entry: recorder(log, "barAction") },
            },
          },
        },
      })

      const initial = yield* initialSnapshotOf(machine)
      assert.deepStrictEqual(initial.value, { foo: "barFinal" })
      assert.strictEqual(initial.status, "active")
      assert.deepStrictEqual(log, ["bazAction", "barAction", "fooAction"])
    })
  )

  it.effect("[S6] reaching a top-level final state sets status done and runs every remaining exit action in reverse document order", () =>
    Effect.gen(function* () {
      // upstream: should call exit actions in reversed document order when the machines reaches its final state
      const log: Array<string> = []
      const machine = createMachine<object, EventObject>({
        id: "s6-exit",
        initial: "a",
        context: {},
        ...tracked(log, "__root__"),
        states: {
          a: { ...tracked(log, "a"), on: { EV: "b" } },
          b: { ...tracked(log, "b"), type: "final" },
        },
      })

      const initial = yield* initialSnapshotOf(machine)
      log.length = 0
      const done = yield* nextSnapshotOf(machine, initial, { type: "EV" })
      assert.strictEqual(done.status, "done")
      assert.strictEqual(done.value, "b")
      assert.deepStrictEqual(log, ["ex a", "en b", "ex b", "ex __root__"])
    })
  )

  it.effect("[S6] a parallel root that completes runs the exit actions of every region in reverse document order", () =>
    Effect.gen(function* () {
      // upstream: should call exit actions of parallel states in reversed document order when the
      // machines reaches its final state after earlier region transition
      const log: Array<string> = []
      const machine = createMachine<object, EventObject>({
        id: "s6-parallel-exit",
        type: "parallel",
        context: {},
        ...tracked(log, "__root__"),
        states: {
          a: {
            ...tracked(log, "a"),
            initial: "child_a1",
            states: {
              child_a1: { ...tracked(log, "a.child_a1"), on: { EV2: "child_a2" } },
              child_a2: { ...tracked(log, "a.child_a2"), type: "final" },
            },
          },
          b: {
            ...tracked(log, "b"),
            initial: "child_b1",
            states: {
              child_b1: { ...tracked(log, "b.child_b1"), on: { EV1: "child_b2" } },
              child_b2: { ...tracked(log, "b.child_b2"), type: "final" },
            },
          },
        },
      })

      const afterEv1 = yield* afterEvents(machine, ["EV1"])
      assert.strictEqual(afterEv1.status, "active")
      log.length = 0
      const done = yield* nextSnapshotOf(machine, afterEv1, { type: "EV2" })
      assert.strictEqual(done.status, "done")
      assert.deepStrictEqual(log, [
        "ex a.child_a1",
        "en a.child_a2",
        "ex b.child_b2",
        "ex b",
        "ex a.child_a2",
        "ex a",
        "ex __root__",
      ])
    })
  )

  it.effect("[S6] no onDone runs when the machine reaches its final state", () =>
    Effect.gen(function* () {
      // upstream: onDone should not be called when the machine reaches its final state
      const log: Array<string> = []
      const machine = createMachine<object, EventObject>({
        id: "s6-machine-done",
        type: "parallel",
        context: {},
        onDone: { actions: recorder(log, "root onDone") },
        states: {
          a: {
            type: "parallel",
            onDone: { actions: recorder(log, "a onDone") },
            states: {
              b: {
                initial: "c1",
                onDone: { actions: recorder(log, "b onDone") },
                states: {
                  c1: { on: { FINISH: "c2" } },
                  c2: { type: "final" },
                },
              },
            },
          },
        },
      })

      const done = yield* afterEvents(machine, ["FINISH"])
      assert.strictEqual(done.status, "done")
      assert.deepStrictEqual(log, [])
    })
  )

  it.effect("[S6] a root output mapper that returns undefined gives Option.none(), and a null root output Option.some(null)", () =>
    Effect.gen(function* () {
      const finishing = (output: OutputDefinition<object, DoneStateEvent, EventObject>) =>
        createMachine<object, EventObject>({
          id: "s6-root-output",
          initial: "start",
          context: {},
          output,
          states: {
            start: { on: { NEXT: "end" } },
            end: { type: "final" },
          },
        })

      const undefinedMapper = yield* afterEvents(
        finishing(() => undefined),
        ["NEXT"]
      )
      assert.strictEqual(undefinedMapper.status, "done")
      assert.deepStrictEqual(undefinedMapper.output, Option.none())

      // upstream: should be possible to complete with a null output (directly on root)
      const nullOutput = yield* afterEvents(finishing(null), ["NEXT"])
      assert.strictEqual(nullOutput.status, "done")
      assert.deepStrictEqual(nullOutput.output, Option.some(null))
    })
  )
})
