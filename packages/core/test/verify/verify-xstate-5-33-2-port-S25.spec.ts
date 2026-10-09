/**
 * S25: the machine object exposes the XState API.
 *
 * T3.23, SD-3, SD-10, SD-13, D6, D8. Upstream `StateMachine` and `StateNode` (`src/StateMachine.ts`,
 * `src/StateNode.ts` at xstate@5.33.2) give a machine:
 *
 * - `states` (the root's states object), `events` (the root's `events`: the event types of
 *   every node with a transition that is not inert, once each, in document order), `version`
 *   and `schemas` from the config, `definition` (the root's) and `toJSON()` (the definition).
 * - `resolveState({ value, context, ... })`: the snapshot of a state value, completed to a full
 *   configuration (`resolveStateValue`), status `done` when the value is final; a value that
 *   names no state throws the upstream message.
 * - `microstep(snapshot, event)`: the snapshot after each microstep of the macrostep.
 * - `getTransitionData(snapshot, event)`: the transition definitions the event selects.
 * - `getStateNodeById(id)`: a custom id, `#id`, `#id.path` or a full id.
 *
 * and a state node `transitions` (a `Map` in declaration order, the forbidden events
 * included; the port keeps that `Map`'s entries as a list in its order, SD-22 amended
 * 2026-10-08), `on` (the same transitions as a plain record), `entry`, `exit`, `always`,
 * `invoke` and `tags` as arrays, `config` (the object it was built from, not a copy),
 * `events`, `ownEvents` and `definition`.
 *
 * The port: `microstep` and `getTransitionData` return Effects (SD-13); `microstep` reads the
 * actor scope from the Effect context, as `transition` does; `getTransitionData` runs the
 * guards with an inert actor scope and fails with the guard-evaluation error (SD-3).
 * `resolveState` returns an Effect that fails with `MachineDefinitionError` and the upstream
 * message (SD-3, amended 2026-10-08).
 * `getStateNodeById` returns an Effect (D6) that fails with `StateNodeNotFoundError`, whose
 * message is the upstream one. `parent`, `machine`, `output` and `target` of a node are
 * `Option` (DEV-28); the definition gives them plain, as upstream. T8.8: a node keeps the
 * config's output only when it is a final node or the root, as upstream's.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Logger, Option } from "effect"
import {
  ActorScope,
  createMachine,
  Errors,
  getInitialSnapshot,
  raise,
  setup,
  type ActorLogicType,
  type MachineSnapshot,
} from "../../src/index.js"
import { resolveStateValue } from "../../src/stateUtils.js"
import { createInertActorScope } from "../../src/testing/getNextSnapshot.js"
import {
  childStateDoesNotExist,
  childStateNodeDoesNotExist,
  invalidTargetFromRoot,
  stateDoesNotExist,
  wildcardNotLast,
} from "./upstream-messages.js"

/** A test logger that keeps every log entry (SD-21), as the upstream rewrites capture warnings. */
const testLogger = (entries: Array<Logger.Options<unknown>>) =>
  Logger.layer([
    Logger.make((options) => {
      entries.push(options)
    }),
  ])

/** The text of each captured warning. */
const warnings = (logged: ReadonlyArray<Logger.Options<unknown>>): ReadonlyArray<string> =>
  logged
    .filter((entry) => entry.logLevel === "Warn")
    .map((entry) => String(Array.isArray(entry.message) ? entry.message[0] : entry.message))

/** The initial snapshot of `machine` through `getInitialSnapshot`, widened as S23 widens it. */
const initialSnapshotOf = (machine: object): Effect.Effect<MachineSnapshot> =>
  getInitialSnapshot(machine as ActorLogicType.Any, undefined) as unknown as Effect.Effect<MachineSnapshot>

// ---------------------------------------------------------------- fixtures

/** The traffic light of upstream machine.test, with a custom id, a reenter-only and a forbidden transition. */
const lightConfig = () => ({
  id: "light",
  version: "2.1.0",
  initial: "green",
  states: {
    green: {
      tags: ["go", "bright"],
      entry: ["enterGreen"],
      on: { TIMER: "yellow", POWER_OUTAGE: "red", FORBIDDEN: undefined },
    },
    yellow: { on: { TIMER: "red", POWER_OUTAGE: "red", HOLD: { reenter: true } } },
    red: {
      id: "redLight",
      initial: "walk",
      on: { TIMER: "green", POWER_OUTAGE: "red" },
      onDone: "green",
      states: {
        walk: { on: { COUNTDOWN: "wait" } },
        wait: { on: { COUNTDOWN: "stop" } },
        stop: { type: "final" as const },
      },
    },
  },
})

/** The upstream `machine.resolveStateValue()` machine, with a final state. */
const resolveMachine = () =>
  createMachine({
    id: "resolve",
    initial: "foo",
    states: {
      foo: {
        initial: "one",
        states: {
          one: {
            type: "parallel",
            states: {
              a: { initial: "aa", states: { aa: {}, ab: {} } },
              b: { initial: "bb", states: { bb: {} } },
            },
          },
          two: {},
        },
      },
      bar: { type: "final" },
    },
  })

/**
 * `JSON.stringify(machine)` of xstate@5.33.2 for the machine `definitionMachine` builds,
 * recorded from the upstream source.
 */
const UPSTREAM_DEFINITION_JSON = {
  id: "def",
  key: "def",
  version: "1.0.0",
  type: "compound",
  initial: { target: ["#def.idle"], source: "#def", actions: [], eventType: null },
  history: false,
  states: {
    idle: {
      id: "def.idle",
      key: "idle",
      version: "1.0.0",
      type: "atomic",
      initial: { target: [], source: "#def.idle", actions: [], eventType: null },
      history: false,
      states: {},
      on: {
        GO: [
          {
            target: ["#def.busy"],
            actions: ["go"],
            guard: "canGo",
            description: "go on",
            meta: { t: 1 },
            source: "#def.idle",
            reenter: false,
            eventType: "GO",
          },
        ],
        STOP: [{ actions: [], source: "#def.idle", reenter: false, eventType: "STOP" }],
      },
      transitions: [
        {
          target: ["#def.busy"],
          actions: ["go"],
          guard: "canGo",
          description: "go on",
          meta: { t: 1 },
          source: "#def.idle",
          reenter: false,
          eventType: "GO",
        },
        { actions: [], source: "#def.idle", reenter: false, eventType: "STOP" },
      ],
      entry: [{ type: "named", params: { n: 1 } }],
      exit: [{ type: "leave" }],
      meta: { m: 1 },
      order: 1,
      invoke: [],
      description: "waiting",
      tags: ["ready"],
    },
    busy: {
      id: "def.busy",
      key: "busy",
      version: "1.0.0",
      type: "final",
      initial: { target: [], source: "#def.busy", actions: [], eventType: null },
      history: false,
      states: {},
      on: {},
      transitions: [],
      entry: [],
      exit: [],
      order: 2,
      output: { done: true },
      invoke: [],
      tags: [],
    },
    hist: {
      id: "def.hist",
      key: "hist",
      version: "1.0.0",
      type: "history",
      initial: { target: [], source: "#def.hist", actions: [], eventType: null },
      history: "deep",
      states: {},
      on: {},
      transitions: [],
      entry: [],
      exit: [],
      order: 3,
      invoke: [],
      tags: [],
    },
  },
  on: {},
  transitions: [],
  entry: [{ type: "start" }],
  exit: [],
  order: -1,
  invoke: [{ id: "inv", src: "someSrc", type: "xstate.invoke" }],
  tags: [],
}

/** A machine whose definition covers every definition field. */
const definitionMachine = () =>
  createMachine({
    id: "def",
    version: "1.0.0",
    initial: "idle",
    invoke: [{ id: "inv", src: "someSrc" }],
    entry: ["start"],
    states: {
      idle: {
        tags: "ready",
        description: "waiting",
        meta: { m: 1 },
        entry: [{ type: "named", params: { n: 1 } }],
        exit: [function leave() {}],
        on: {
          GO: { target: "busy", actions: ["go"], guard: "canGo", description: "go on", meta: { t: 1 } },
          STOP: undefined,
        },
      },
      busy: { type: "final", output: { done: true } },
      hist: { type: "history", history: "deep" },
    },
  })

describe("S25 The machine object exposes the XState API", () => {
  it.effect("[S25] machine.states is the root's plain states object; version and schemas come from the config", () =>
    Effect.sync(() => {
      const machine = createMachine(lightConfig())
      assert.strictEqual(machine.states, machine.root.states)
      assert.deepStrictEqual(Object.keys(machine.states), ["green", "yellow", "red"])
      assert.strictEqual(Object.getPrototypeOf(machine.states), Object.prototype)
      assert.strictEqual(machine.states["red"]?.states["walk"]?.id, "light.red.walk")
      assert.strictEqual(machine.states["red"]?.id, "redLight")
      assert.strictEqual(machine.version, "2.1.0")
      assert.isUndefined(createMachine({ initial: "a", states: { a: {} } }).version)

      const schemas = { context: { count: { type: "number" } } }
      assert.deepStrictEqual(setup({ schemas }).createMachine({}).schemas, schemas)
    })
  )

  it.effect("[S25] machine.events lists each accepted event type once, in document order, without forbidden events", () =>
    Effect.sync(() => {
      const machine = createMachine(lightConfig())
      const red = machine.states["red"]!
      assert.deepStrictEqual(machine.events, ["TIMER", "POWER_OUTAGE", "HOLD", "xstate.done.state.redLight", "COUNTDOWN"])
      assert.deepStrictEqual(machine.events, machine.root.events)
      assert.deepStrictEqual(red.events, ["TIMER", "POWER_OUTAGE", "xstate.done.state.redLight", "COUNTDOWN"])
      assert.deepStrictEqual(red.ownEvents, ["TIMER", "POWER_OUTAGE", "xstate.done.state.redLight"])
      assert.deepStrictEqual(machine.states["green"]!.ownEvents, ["TIMER", "POWER_OUTAGE"])
      assert.deepStrictEqual(machine.states["yellow"]!.ownEvents, ["TIMER", "POWER_OUTAGE", "HOLD"])
    })
  )

  it.effect("[S25] a node's transitions map and on record keep declaration order and the forbidden event", () =>
    Effect.sync(() => {
      const machine = createMachine({
        id: "m",
        initial: "a",
        states: {
          a: {
            on: { Z: "b", A: "b", FORBIDDEN: undefined, M: ["b", "c"] },
            onDone: "c",
            after: { 100: "c" },
            initial: "x",
            states: { x: {} },
          },
          b: {},
          c: {},
        },
      })
      const a = machine.states["a"]!
      // The port keeps upstream's Map as its entries, in its order (SD-22, amended 2026-10-08)
      assert.isTrue(Array.isArray(a.transitions))
      assert.deepStrictEqual(
        a.transitions.map(([descriptor]) => descriptor),
        ["Z", "A", "FORBIDDEN", "M", "xstate.done.state.m.a", "xstate.after.100.m.a"]
      )
      assert.deepStrictEqual(
        Object.keys(a.on),
        a.transitions.map(([descriptor]) => descriptor)
      )
      assert.strictEqual(Object.getPrototypeOf(a.on), Object.prototype)
      for (const [descriptor, transitions] of a.transitions) {
        assert.isTrue(Array.isArray(a.on[descriptor]), descriptor)
        assert.deepStrictEqual(a.on[descriptor], transitions, descriptor)
        transitions.forEach((transition, index) => assert.strictEqual(a.on[descriptor]![index], transition, descriptor))
      }
      assert.strictEqual(a.transitions.find(([descriptor]) => descriptor === "M")![1].length, 2)
      const forbidden = a.on["FORBIDDEN"]![0]!
      assert.isUndefined(forbidden.target)
      assert.strictEqual(Array.from(forbidden.actions).length, 0)
      assert.strictEqual(forbidden.eventType, "FORBIDDEN")
    })
  )

  it.effect("[S25] entry, exit, always, invoke and tags are arrays, and config is the object the node was built from", () =>
    Effect.sync(() => {
      const config = lightConfig()
      const machine = createMachine(config)
      const green = machine.states["green"]!
      assert.isTrue(Array.isArray(green.entry))
      assert.deepStrictEqual(green.entry, ["enterGreen"])
      assert.isTrue(Array.isArray(green.exit))
      assert.deepStrictEqual(green.exit, [])
      assert.isTrue(Array.isArray(green.always))
      assert.isTrue(Array.isArray(green.invoke))
      assert.isTrue(Array.isArray(green.tags))
      assert.deepStrictEqual(green.tags, ["go", "bright"])

      const eventless = createMachine({
        initial: "a",
        invoke: { src: "child" },
        states: { a: { tags: "one", always: [{ guard: () => false, target: "b" }, "b"] }, b: {} },
      })
      assert.strictEqual(eventless.states["a"]!.always.length, 2)
      assert.deepStrictEqual(eventless.states["a"]!.tags, ["one"])
      assert.strictEqual(eventless.root.invoke.length, 1)
      assert.strictEqual(eventless.root.invoke[0]!.src, "child")

      // The config is the original object (upstream machine.test "should reference original machine config")
      assert.strictEqual(machine.root.config, config)
      assert.strictEqual(green.config, config.states.green)
      const walk = machine.states["red"]!.states["walk"]!
      assert.strictEqual(walk.config, config.states.red.states.walk)
      ;(walk.config as { meta?: unknown }).meta = "testing meta"
      assert.strictEqual((config.states.red.states.walk as { meta?: unknown }).meta, "testing meta")
    })
  )

  it.effect("[S25] a node keeps the config's output only when it is a final node or the root, as upstream's output field", () =>
    Effect.sync(() => {
      // Upstream: `this.output = this.type === 'final' || !this.parent ? this.config.output : undefined`
      const machine = createMachine({
        initial: "a",
        output: "root",
        states: {
          a: { output: "not final", on: { GO: "b" }, initial: "inner", states: { inner: { output: "not final either" } } },
          b: { type: "final", output: "final" },
        },
      })
      assert.deepStrictEqual(machine.root.output, Option.some("root"))
      assert.deepStrictEqual(machine.states["b"]!.output, Option.some("final"))
      assert.deepStrictEqual(machine.states["a"]!.output, Option.none())
      assert.deepStrictEqual(machine.states["a"]!.states["inner"]!.output, Option.none())
      assert.strictEqual(machine.states["a"]!.definition.output, undefined)
    })
  )

  it.effect("[S25] the candidate descriptors are matched in declaration order, so their warnings come in that order", () => {
    const logged: Array<Logger.Options<unknown>> = []
    return Effect.gen(function* () {
      const machine = createMachine({
        initial: "start",
        states: {
          start: { on: { "event.*.bar.*": "done", "*.event.*": "done", "a.*.b.*": "done", "x.*.y.*": "done" } },
          done: {},
        },
      })
      const snapshot = (yield* machine.resolveState({ value: "start" }))
      const selected = yield* machine.getTransitionData(snapshot, { type: "whatever.event" })
      assert.deepStrictEqual(selected, [])
      assert.deepStrictEqual(
        warnings(logged).filter((text) => text.startsWith("Wildcards can only be")),
        [wildcardNotLast("event.*.bar.*"), wildcardNotLast("*.event.*"), wildcardNotLast("a.*.b.*"), wildcardNotLast("x.*.y.*")]
      )
    }).pipe(Effect.provide(testLogger(logged)))
  })

  it.effect("[S25] resolveState expands a partial state value, sets status done for a final value and keeps the given fields", () =>
    Effect.gen(function* () {
      const machine = resolveMachine()
      const resolved = (yield* machine.resolveState({ value: "foo" }))
      assert.deepStrictEqual(resolved.value, { foo: { one: { a: "aa", b: "bb" } } })
      assert.strictEqual(resolved.status, "active")
      assert.deepStrictEqual(resolved.context, {})
      assert.deepStrictEqual(resolved.children, {})
      assert.deepStrictEqual(resolved.historyValue, {})
      assert.isTrue(Option.isNone(resolved.output))
      assert.isTrue(Option.isNone(resolved.error))
      // A machine snapshot: its machine and its methods
      assert.strictEqual(resolved.machine, machine)
      assert.isTrue(resolved.matches({ foo: { one: "a" } }))

      assert.deepStrictEqual((yield* machine.resolveState({ value: { foo: { one: { a: "ab" } } } })).value, {
        foo: { one: { a: "ab", b: "bb" } },
      })
      assert.deepStrictEqual((yield* machine.resolveState({ value: { "#resolve.foo": "two" } })).value, { foo: "two" })
      assert.deepStrictEqual((yield* machine.resolveState({ value: {} })).value, { foo: { one: { a: "aa", b: "bb" } } })

      const done = (yield* machine.resolveState({ value: "bar", context: { n: 1 } }))
      assert.strictEqual(done.status, "done")
      assert.deepStrictEqual(done.context, { n: 1 })

      const given = (yield* machine.resolveState({ value: "foo", status: "stopped", output: 5, error: "e" }))
      assert.strictEqual(given.status, "stopped")
      assert.deepStrictEqual(given.output, Option.some(5))
      assert.deepStrictEqual(given.error, Option.some("e"))

      assert.deepStrictEqual(yield* resolveStateValue(machine.root, { foo: "one" }), { foo: { one: { a: "aa", b: "bb" } } })
    })
  )

  it.effect("[S25] resolveState fails its Effect with the upstream message for a value that names no state", () =>
    Effect.gen(function* () {
      const machine = resolveMachine()
      const nope = yield* Effect.flip(machine.resolveState({ value: "nope" }))
      assert.instanceOf(nope, Errors.MachineDefinitionError)
      assert.strictEqual(nope.message, stateDoesNotExist("nope", "resolve"))
      assert.strictEqual(
        (yield* Effect.flip(machine.resolveState({ value: { foo: "three" } }))).message,
        stateDoesNotExist("three", "resolve.foo")
      )
      assert.strictEqual(
        (yield* Effect.flip(machine.resolveState({ value: { foo: { one: { c: "x" } } } }))).message,
        childStateDoesNotExist("c", "resolve.foo.one")
      )
      assert.strictEqual(
        (yield* Effect.flip(resolveStateValue(machine.root, "nope"))).message,
        stateDoesNotExist("nope", "resolve")
      )
    })
  )

  it.effect("[S25] microstep returns the snapshot of each microstep, with the actor scope from the Effect context", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        initial: "start",
        states: {
          start: { on: { GO: "a" } },
          a: { entry: raise({ type: "NEXT" }), on: { NEXT: "b" } },
          b: { always: "c" },
          c: {},
        },
      })
      const snapshot = (yield* machine.resolveState({ value: "start" }))
      const inert = createInertActorScope(snapshot)
      const states = yield* machine.microstep(snapshot, { type: "GO" }).pipe(Effect.provideService(ActorScope, inert))
      assert.deepStrictEqual(
        states.map((state) => state.value),
        ["a", "b", "c"]
      )
      // The last microstep's snapshot is the transition's result
      const next = yield* machine.transition(snapshot, { type: "GO" }).pipe(Effect.provideService(ActorScope, inert))
      assert.deepStrictEqual(next.value, states[2]!.value)

      // An event that selects no transition is one microstep that changes nothing (upstream)
      const unchanged = yield* machine.microstep(snapshot, { type: "NOPE" }).pipe(Effect.provideService(ActorScope, inert))
      assert.strictEqual(unchanged.length, 1)
      assert.strictEqual(unchanged[0], snapshot)

      const initial = yield* initialSnapshotOf(machine)
      assert.strictEqual(initial.value, "start")
    })
  )

  it.effect("[S25] getTransitionData gives the transition definitions the event selects; guards run, actions do not", () =>
    Effect.gen(function* () {
      const ran: Array<string> = []
      const machine = createMachine({
        type: "parallel",
        context: { ok: false },
        states: {
          r1: {
            initial: "a",
            states: {
              a: {
                on: {
                  GO: [
                    { guard: ({ context }) => context.ok, target: "b" },
                    { target: "c", actions: () => void ran.push("action") },
                  ],
                  STOP: undefined,
                },
              },
              b: {},
              c: { entry: () => void ran.push("entry") },
            },
          },
          r2: { initial: "x", states: { x: { on: { GO: "y" } }, y: {} } },
        },
      })
      const snapshot = (yield* machine.resolveState({ value: { r1: "a", r2: "x" }, context: { ok: false } }))
      const go = yield* machine.getTransitionData(snapshot, { type: "GO" })
      assert.strictEqual(go.length, 2)
      const goOfA = machine.states["r1"]!.states["a"]!.transitions.find(([descriptor]) => descriptor === "GO")![1]
      const goOfX = machine.states["r2"]!.states["x"]!.transitions.find(([descriptor]) => descriptor === "GO")![1]
      assert.strictEqual(go[0], goOfA[1])
      assert.strictEqual(go[1], goOfX[0])
      assert.deepStrictEqual(ran, [])

      const passing = (yield* machine.resolveState({ value: { r1: "a", r2: "y" }, context: { ok: true } }))
      const guarded = yield* machine.getTransitionData(passing, { type: "GO" })
      assert.deepStrictEqual(guarded, [goOfA[0]!])

      const forbidden = yield* machine.getTransitionData(snapshot, { type: "STOP" })
      assert.strictEqual(forbidden.length, 1)
      assert.isUndefined(forbidden[0]!.target)

      assert.deepStrictEqual(yield* machine.getTransitionData(snapshot, { type: "NOPE" }), [])
    })
  )

  it.effect("[S25] getStateNodeById finds a node by custom id, #id, #id with a path and full id; an unknown id fails", () =>
    Effect.gen(function* () {
      const machine = createMachine(lightConfig())
      const red = machine.states["red"]!
      assert.strictEqual(yield* machine.getStateNodeById("redLight"), red)
      assert.strictEqual(yield* machine.getStateNodeById("#redLight"), red)
      assert.strictEqual(yield* machine.getStateNodeById("#redLight.walk"), red.states["walk"])
      assert.strictEqual(yield* machine.getStateNodeById("light.red.walk"), red.states["walk"])
      assert.strictEqual(yield* machine.getStateNodeById("light"), machine.root)

      const missing = yield* Effect.flip(machine.getStateNodeById("#missing"))
      assert.instanceOf(missing, Errors.StateNodeNotFoundError)
      assert.strictEqual(missing.id, "#missing")
      assert.strictEqual(missing.message, childStateNodeDoesNotExist("missing", "light"))
      const bare = yield* Effect.flip(machine.getStateNodeById("missing"))
      assert.strictEqual(bare.message, childStateNodeDoesNotExist("missing", "light"))
      const path = yield* Effect.flip(machine.getStateNodeById("#redLight.nope"))
      assert.strictEqual(path.message, childStateDoesNotExist("nope", "redLight"))
    })
  )

  it.effect("[S25] machine.toJSON() is the root definition, in upstream's JSON form", () =>
    Effect.sync(() => {
      const machine = definitionMachine()
      const json: unknown = JSON.parse(JSON.stringify(machine))
      assert.deepStrictEqual(json, UPSTREAM_DEFINITION_JSON)
      assert.deepStrictEqual(JSON.parse(JSON.stringify(machine.definition)), UPSTREAM_DEFINITION_JSON)
      assert.deepStrictEqual(JSON.parse(JSON.stringify(machine.root.definition)), UPSTREAM_DEFINITION_JSON)
      assert.strictEqual(machine.toJSON().id, "def")

      // The definition object: plain fields, the node's transitions, serializable actions
      const definition = machine.root.definition
      const idle = definition.states["idle"]!
      assert.strictEqual(idle.description, "waiting")
      assert.deepStrictEqual(idle.meta, { m: 1 })
      assert.strictEqual(idle.on["GO"]![0], machine.states["idle"]!.transitions.find(([descriptor]) => descriptor === "GO")![1][0])
      assert.deepStrictEqual(idle.transitions[0]!.actions, [{ type: "go" }])
      assert.deepStrictEqual(idle.exit, [{ type: "leave" }])
      assert.strictEqual(definition.initial.target[0], machine.states["idle"])
      assert.strictEqual(definition.initial.source, machine.root)
      assert.strictEqual(definition.invoke.length, 1)
      assert.strictEqual(definition.states["hist"]!.history, "deep")
      assert.strictEqual(definition.history, false)
    })
  )

  it.effect("[S25] MachineConfig.id is optional with the default (machine), and a sibling target on the root is a definition error", () =>
    Effect.gen(function* () {
      const machine = createMachine({ initial: "a", states: { a: { id: "custom" }, b: {} } })
      assert.strictEqual(machine.id, "(machine)")
      assert.strictEqual(machine.root.id, "(machine)")
      assert.strictEqual(machine.states["b"]!.id, "(machine).b")
      assert.strictEqual(machine.states["a"]!.id, "custom")

      // upstream invalid.test: a root target must start with "." or "#" (SD-3); the machine
      // keeps the definition error and its initial snapshot fails with it (amended 2026-10-08)
      const direction = createMachine({
        id: "direction",
        initial: "left",
        states: { left: {}, right: {} },
        on: { LEFT_CLICK: "left" },
      })
      const failure = yield* Effect.flip(getInitialSnapshot(direction))
      assert.strictEqual(failure.message, invalidTargetFromRoot("left"))
    })
  )
})
