/**
 * CONF-3: the upstream files green at phase 3 pass (SD-1, SD-2).
 *
 * The file imports each rewrite whose ledger green phase is 3 inside its own describe block
 * titled `upstream/<name>.test.ts`, so every upstream test of the file runs once, inside the
 * default run, and its evidence routes to CONF-3. `conformancePhase` (`conformance.ts`)
 * keeps the blocks and its checks in declaration order, also under `--sequence.shuffle`:
 *
 * - the graduation check: each imported rewrite has left `pending.json` and the green
 *   type-check exclude (one commit, SD-1), and the ledger marks it `passes`;
 * - the import check: the file imports exactly definition, id, invalid, json, mapState,
 *   match, order, resolve, route, state, tags and examples 6.17, 6.6, 6.8, 6.9 and cd (the
 *   ledger's green-phase 3 files), and no other CONF evidence file imports one of them;
 * - the count check, last: per file, `passed >= runnable - notPortedRunnable` and
 *   `passed >= 1`, no skipped test, and no test still to run (186 runnable upstream tests).
 *
 * T3.26 to T3.41 imported the 16 files one block at a time under the graduation check
 * alone; T3.42 switched to `conformancePhase`. The describe block "the CONF-3 suite and its
 * count floor" pins the order of the checks and the count data of phase 3.
 *
 * definition.test.ts builds its machine with `createMachine({ types: {} as { actors: ... } })`,
 * as upstream does. The describe block "createMachine without setup and its types field" pins
 * that `createMachine` without `setup` takes XState's `types` member (`MachineTypes`): it
 * infers the machine's context, event, input, output, emitted and meta types from it, checks
 * the declared actors against XState's `ProvidedActor`, and holds no value at run time (the
 * `@ts-expect-error` lines prove the rejections under `pnpm typecheck`,
 * `tsconfig.test.green.json`).
 *
 * id.test.ts is the first green user of the ported upstream helpers `test/upstream/utils.ts`
 * (`testAll`, `testMultiTransition`), so utils.ts leaves `pending.json` with it. Both import
 * XState root names that the last describe blocks pin: `getInitialSnapshot` without an input
 * when the logic's input type admits `undefined`; the root `StateValue` as the XState state
 * value type, which stays the `StateValue` module as a value; and `AnyStateMachine` and
 * `AnyMachineSnapshot`, which every machine without Effect requirements and every machine
 * snapshot satisfy, and which `resolveState` and `getNextSnapshot` take.
 *
 * invalid.test.ts keeps upstream's bare `.toThrow()` for "should reject transitioning from bad
 * state configs" as `toBeInstanceOf(Error)` of the flipped failure. The describe block
 * "invalid.test.ts and its bad state config" pins the reason: `machine.resolveState` fails its
 * Effect by itself, before `getNextSnapshot` runs, with the upstream message for the region
 * value that names no state (SD-3, amended 2026-10-08; DEV-8).
 *
 * json.test.ts revives a machine from its JSON and counts the transitions of a node with an
 * invocation. The describe block "invoke ids and the invoke transitions of a node" pins the
 * definition-level parts that count needs, as upstream builds them: an invoke without an id
 * gets the id `<index>.<node id>` (upstream `createInvokeId`); each invoke's `onDone`,
 * `onError` and `onSnapshot` transitions join the node's `transitions` after its `onDone`
 * and before its delayed transitions (upstream `formatTransitions`), so the definition lists
 * them in `on` and `transitions`; the invoke JSON leaves out `onDone` and `onError`, so a
 * revived machine holds each transition once; and the selection takes them. Starting and
 * stopping the invoked actors is phase 5.
 *
 * mapState.test.ts checks the mapper's keys at the type level: a key that names no state of
 * the machine, at the root or nested, is an error (`@ts-expect-error`). The describe block
 * "mapState and the machine's state keys" pins where those keys come from, as upstream: a
 * `setup(...).createMachine(...)` machine carries its state keys in its type (upstream
 * `StateSchemaFrom`), so the snapshots of its actor, `resolveState` and `transition` carry
 * them too; a machine from `createMachine` without `setup` carries none (upstream gives it
 * an `any` schema), so mapState takes any key there and a key that names no state maps nothing.
 *
 * match.test.ts checks the root `matchesState` (pattern first, dotted paths) and
 * `snapshot.matches` on the snapshot of an actor that is not started. S26 pins every upstream
 * match case on the root `matchesState`, S23 pins `snapshot.matches` (dotted paths, parallel
 * regions, the XState argument order next to the port's own `StateValue.matches`, SD-20), and
 * C1 pins the snapshot before start. The describe block "matchesState and a machine snapshot"
 * pins one more upstream rule that no upstream test reaches: either side may be a machine
 * snapshot, read as its state value (upstream `toStateValue`), where a snapshot is any object
 * with both a `machine` and a `value` key (upstream `isMachineSnapshot`); the typed parameters
 * still take state values only, so a snapshot needs a cast, as upstream.
 *
 * order.test.ts walks the machine's nodes depth first and reads each node's `order`: the
 * document order, numbered from 0 at the root in pre-order. It needs no describe block of its
 * own here: the S13 evidence file pins the exit, transition and entry order that follows the
 * document order.
 *
 * resolve.test.ts calls `resolveStateValue` from the module `src/stateUtils.ts`, as upstream
 * imports it from its internal `src/stateUtils`: the function is not an XState root export
 * (upstream's root exports only `getStateNodes` from that module). The S25 evidence file pins
 * what it gives and the upstream message its Effect fails with (SD-3, amended 2026-10-08). The
 * describe block "resolveStateValue
 * and the root" pins that it stays off the root and is the resolution `machine.resolveState`
 * gives.
 *
 * route.test.ts sends `{ type: 'xstate.route', to: '#<id>' }` to machines from
 * `setup(...).createMachine(...)`, also to machines whose declared events are `never`, and
 * marks with `@ts-expect-error` each `to` that names no routable state. The describe block
 * "the route event of a setup machine" pins where that event type comes from, as upstream:
 * the machine's event type gains `{ type: 'xstate.route'; to: RoutableStateId<config> }`,
 * where `RoutableStateId` (a root type) gives `#<id>` for each node with both a `route` and an
 * `id`, as deep as the states go, the root included; a config with no routable node adds no
 * event, and `createMachine` without `setup` adds none. The S22 evidence file pins where a
 * route event goes at run time.
 *
 * state.test.ts reads `status`, `yield* snapshot.can(...)` and `hasTag` on the snapshots of
 * machines it builds inline, as in `createActor(createMachine({}))`. The S23 evidence file pins
 * what `can` and `hasTag` answer. The describe block "createMachine inside createActor" pins
 * that a machine built as the argument of `createActor` infers no Effect requirement from that
 * place, so its actor needs a `Scope` only, as the same machine built first; the port's own
 * constructor `StateMachine.make` (root `makeStateMachine`) does the same. The describe
 * block "snapshot.can and its GuardError" pins the deviation row DEV-10: `can` is an Effect
 * (SD-6) whose error channel is `GuardError`, which a guard that throws fails it with, where
 * upstream `can` throws that error.
 *
 * tags.test.ts reads `hasTag`, the native `Set` `snapshot.tags` and the tags array of
 * `toJSON()`. The S23 evidence file pins what `hasTag` answers and the exact tags of one
 * parallel machine, but its toJSON test sorts the `toJSON()` tags before it compares them,
 * and the upstream case "stringifies to an array" uses tags that are already in sorted
 * order. The describe block "the tags of a snapshot and their order" pins the order upstream
 * gives: each tag once, state node by state node in the order the nodes became active (an
 * ancestor before its descendants), and inside a node in its config order.
 *
 * examples/6.17.test.ts (also the 6.18 case) resolves a state value with
 * `machine.resolveState`, sends events with `getNextSnapshot` through the shared helper
 * `testMultiTransition`, and compares the state value it reaches: a `.child` path into one
 * region of a parallel node, a `history: true` node inside a region, and a `#id` target that
 * leaves every region. It needs no describe block of its own here: the S3 evidence file pins
 * the entry of every region, S8 pins `history: true` as shallow history and its restore, S9
 * pins the target forms, and S25 pins how `resolveState` completes a partial state value.
 *
 * examples/6.6.test.ts resolves a state value with `machine.resolveState`, sends one event
 * with `getNextSnapshot` through the shared helper `testAll`, and compares the state value it
 * reaches: numeric keys in `on` as event types, a `#id` target out of a nested state, a
 * `sibling.child` target (`A.D` from `B`), and an event that no active node handles, which
 * leaves the state value as it was. It needs no describe block of its own here: the S9
 * evidence file pins the target forms, S25 pins how `resolveState` completes a partial state
 * value, and the imported 6.6 cases pin the `sibling.child` target, which S9 does not use.
 *
 * examples/6.8.test.ts resolves a state value with `machine.resolveState`, sends one event
 * with `getNextSnapshot` through the shared helper `testAll`, and compares the state value it
 * reaches; its last case runs an actor through `1`, `6`, `5` and reads `{ A: 'C' }`: the
 * `history: true` node `A.hist`, entered from `F` with the `sibling.child` target `A.hist`,
 * restores the child that `A` left. It needs no describe block of its own here: the S8
 * evidence file pins `history: true` as shallow history, its restore, and the parent's
 * initial state for a history node never visited (`F` on `5` from a resolved `F`), S9 pins
 * the target forms, and S25 pins how `resolveState` completes a partial state value.
 *
 * examples/6.9.test.ts resolves a state value with `machine.resolveState`, sends events with
 * `getNextSnapshot` through the shared helper `testAll`, and compares the state value it
 * reaches: the `history: true` node `A.hist`, entered from `H` on `1`, restores the child of
 * `A` that was last active with that child's initial state (`3, 6, 1` from `{ A: 'B' }` gives
 * `{ A: { B: 'E' } }`, not `B.D`), and the parent's initial state when `A` was never left. Its
 * deep history node `A.deepHist` is in the machine, but the case that enters it is commented
 * out upstream. It needs no describe block of its own here: the S8 evidence file pins shallow
 * and deep history, their restore and the parent's initial state for a history node never
 * visited, S9 pins the target forms, and S25 pins how `resolveState` completes a partial
 * state value.
 *
 * examples/cd.test.ts resolves a state value with `machine.resolveState`, sends events with
 * `getNextSnapshot` through the shared helper `testAll`, and compares the state value it
 * reaches: a parent's initial state entered through a bare key (`loaded` gives
 * `{ loaded: 'stopped' }`), a nested initial state (`PAUSE` gives `loaded.paused.not_blank`),
 * a parent transition (`EJECT`) taken from every child, a transition to the state itself
 * (`EXPIRED_MID`), and an event that no active node handles (`FAKE`), which leaves the state
 * value as it was. It needs no describe block of its own here: the S2 evidence file pins the
 * full state value of a nested initial state, S9 pins the target forms, and S25 pins how
 * `resolveState` completes a partial state value.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option, type Scope } from "effect"
import * as Core from "../../src/index.js"
import {
  type AnyActorLogic,
  type AnyMachineSnapshot,
  type AnyStateMachine,
  createActor,
  createMachine,
  Errors,
  type EventObject,
  getInitialSnapshot,
  getNextSnapshot,
  mapState,
  matchesState,
  pathToStateValue,
  type RoutableStateId,
  setup,
  StateValue,
  type StateValueMap
} from "../../src/index.js"
import type { StateMachine } from "../../src/StateMachine.js"
import { resolveStateValue } from "../../src/stateUtils.js"
import * as StateValueModule from "../../src/StateValue.js"
import { conformancePhase, greenFiles, requiredPassed, upstreamFileOptions } from "./conformance.js"
import { shortName } from "./ledger.js"
import { readLedger, readManifest } from "./parity.js"
import { guardEvaluationFailed, stateDoesNotExist } from "./upstream-messages.js"

// ---------------------------------------------------------------- the imported files

conformancePhase(3, () => {
  describe("upstream/definition.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/definition.test.js")
  })
  describe("upstream/id.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/id.test.js")
  })
  describe("upstream/invalid.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/invalid.test.js")
  })
  describe("upstream/json.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/json.test.js")
  })
  describe("upstream/mapState.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/mapState.test.js")
  })
  describe("upstream/match.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/match.test.js")
  })
  describe("upstream/order.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/order.test.js")
  })
  describe("upstream/resolve.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/resolve.test.js")
  })
  describe("upstream/route.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/route.test.js")
  })
  describe("upstream/state.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/state.test.js")
  })
  describe("upstream/tags.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/tags.test.js")
  })
  describe("upstream/examples/6.17.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/examples/6.17.test.js")
  })
  describe("upstream/examples/6.6.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/examples/6.6.test.js")
  })
  describe("upstream/examples/6.8.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/examples/6.8.test.js")
  })
  describe("upstream/examples/6.9.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/examples/6.9.test.js")
  })
  describe("upstream/examples/cd.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/examples/cd.test.js")
  })
})

// ---------------------------------------------------------------- the shape of the suite and its count floor

const SUITE_TITLE = "[CONF-3] upstream files green at phase 3"

/** The upstream files green at phase 3, in the order of the ledger and of the imported blocks. */
const PHASE_3_FILES = [
  "definition",
  "id",
  "invalid",
  "json",
  "mapState",
  "match",
  "order",
  "resolve",
  "route",
  "state",
  "tags",
  "examples/6.17",
  "examples/6.6",
  "examples/6.8",
  "examples/6.9",
  "examples/cd"
] as const

describe("[CONF-3] the CONF-3 suite and its count floor", () => {
  it("[CONF-3] the suite imports the 16 files green at phase 3, then runs the graduation, import and count checks, the count check last, and never shuffles its own children", ({ task }) => {
    const suite = task.file.tasks.find((child) => child.name === SUITE_TITLE)
    assert.strictEqual(suite?.type, "suite")
    const children = suite?.type === "suite" ? suite.tasks : []
    assert.deepStrictEqual(children.map((child) => [child.type, child.name]), [
      ...PHASE_3_FILES.map((name) => ["suite", `upstream/${name}.test.ts`]),
      ["test", "[CONF-3] each imported rewrite has left pending.json and the green type-check exclude, and the ledger marks it passes"],
      ["test", "[CONF-3] the evidence file imports exactly the upstream files green at phase 3, and no other CONF evidence file imports them"],
      ["test", "[CONF-3] every imported file meets its count"]
    ])
    assert.strictEqual(suite?.type === "suite" ? suite.shuffle : undefined, false)
  })

  it.effect("[CONF-3] the files green at phase 3 have 186 runnable upstream tests and a floor of 186 passed: no upstream skip or todo and no not-ported row lowers it", () =>
    Effect.sync(() => {
      const { ledger, problems } = readLedger()
      assert.deepStrictEqual(problems, [])
      const manifest = readManifest()
      // [name, runnable, upstream skip + todo, "Tests not ported" rows, required passed]
      const floors = greenFiles(ledger.files, 3).map((row) => {
        const name = row["Name"] ?? ""
        const upstream = manifest.files.find((file) => shortName(file.path) === name)
        if (upstream === undefined) return [name]
        const rows = ledger.notPorted.filter((notPorted) => notPorted["File"] === upstream.path).length
        return [name, upstream.runnable, upstream.skip + upstream.todo, rows, requiredPassed(upstream, ledger.notPorted)]
      })
      assert.deepStrictEqual(floors, [
        ["definition", 1, 0, 0, 1],
        ["id", 10, 0, 0, 10],
        ["invalid", 6, 0, 0, 6],
        ["json", 3, 0, 0, 3],
        ["mapState", 15, 0, 0, 15],
        ["match", 13, 0, 0, 13],
        ["order", 1, 0, 0, 1],
        ["resolve", 1, 0, 0, 1],
        ["route", 13, 0, 0, 13],
        ["state", 21, 0, 0, 21],
        ["tags", 6, 0, 0, 6],
        ["examples/6.17", 8, 0, 0, 8],
        ["examples/6.6", 16, 0, 0, 16],
        ["examples/6.8", 17, 0, 0, 17],
        ["examples/6.9", 32, 0, 0, 32],
        ["examples/cd", 23, 0, 0, 23]
      ])
      assert.deepStrictEqual(floors.map((floor) => floor[0]), [...PHASE_3_FILES])
      assert.strictEqual(floors.reduce((total, floor) => total + Number(floor[4]), 0), 186)
    }))
})

// ---------------------------------------------------------------- createMachine and its types field

/** True when `A` and `B` are the same type. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

/** Compiles only for `true`. */
const typeHolds = <T extends true>(holds: T): T => holds

describe("[CONF-3] createMachine without setup and its types field", () => {
  it.effect("[CONF-3] createMachine reads the context, event, input, output and emitted types from the XState types field, which holds no value at run time", () =>
    Effect.gen(function* () {
      type Context = { readonly count: number; readonly label: string | null }
      type Event = { readonly type: "INC" } | { readonly type: "RESET" }
      const machine = createMachine({
        types: {} as {
          context: Context
          events: Event
          input: { readonly start: number }
          output: string
          emitted: { readonly type: "noticed" }
          meta: { readonly title: string }
          actors: { readonly src: "child"; readonly logic: AnyActorLogic }
        },
        id: "typed",
        context: { count: 0, label: null },
        initial: "a",
        states: { a: { meta: { title: "A" }, on: { INC: "b" } }, b: {} }
      })
      typeHolds<Equals<StateMachine.ContextOf<typeof machine>, Context>>(true)
      typeHolds<Equals<StateMachine.EventOf<typeof machine>, Event>>(true)
      typeHolds<Equals<StateMachine.InputOf<typeof machine>, { readonly start: number }>>(true)
      typeHolds<Equals<StateMachine.OutputOf<typeof machine>, string>>(true)
      typeHolds<Equals<StateMachine.EmittedOf<typeof machine>, { readonly type: "noticed" }>>(true)

      const actor = yield* Effect.tap(createActor(machine, { input: { start: 0 } }), (started) => started.start)
      yield* actor.send({ type: "INC" })
      assert.strictEqual((yield* actor.getSnapshot).value, "b")
      // @ts-expect-error the types field declares no STOP event
      const stop = () => actor.send({ type: "STOP" })
      assert.isFunction(stop)
      // the config keeps the member as written; it carries no value
      assert.deepStrictEqual((machine.config as { readonly types?: unknown }).types, {})
    }))

  it.effect("[CONF-3] the types field checks the state meta and the declared actors against their XState types", () =>
    Effect.sync(() => {
      const wrongMeta = () =>
        // @ts-expect-error the types field declares the state meta type: a number title is rejected
        createMachine({ types: {} as { meta: { readonly title: string } }, initial: "a", states: { a: { meta: { title: 1 } } } })
      const actorWithoutLogic = () =>
        // @ts-expect-error a declared actor needs its logic (XState ProvidedActor)
        createMachine({ types: {} as { actors: { readonly src: "child" } }, initial: "a", states: { a: {} } })
      const machine = createMachine({
        types: {} as { meta: { readonly title: string } },
        initial: "a",
        states: { a: { meta: { title: "A" } } }
      })
      assert.isFunction(wrongMeta)
      assert.isFunction(actorWithoutLogic)
      assert.deepStrictEqual(machine.root.states["a"]?.config.meta, { title: "A" })
    }))
})

// ---------------------------------------------------------------- the root names id.test.ts and utils.ts use

describe("[CONF-3] getInitialSnapshot without an input", () => {
  it.effect("[CONF-3] getInitialSnapshot takes no input when the logic's input type admits undefined, and requires one otherwise", () =>
    Effect.gen(function* () {
      const machine = createMachine({ initial: "a", states: { a: {} } })
      assert.strictEqual((yield* getInitialSnapshot(machine)).value, "a")

      const withInput = createMachine({
        types: {} as { context: { readonly count: number }; input: { readonly start: number } },
        context: { count: 0 },
        initial: "a",
        states: { a: {} }
      })
      assert.strictEqual((yield* getInitialSnapshot(withInput, { start: 3 })).value, "a")
      // @ts-expect-error the machine declares its input type, so the input is required (XState)
      const withoutInput = () => getInitialSnapshot(withInput)
      assert.isFunction(withoutInput)
    }))
})

describe("[CONF-3] the root StateValue", () => {
  it.effect("[CONF-3] the root StateValue is the XState state value type, and as a value it is still the StateValue module", () =>
    Effect.sync(() => {
      typeHolds<Equals<StateValue, string | StateValueMap>>(true)
      typeHolds<Equals<StateValue.StateValue, StateValue>>(true)
      typeHolds<Equals<StateValue.StateValueMap, StateValueMap>>(true)
      const value: StateValue = { a: { b: "c" } }
      // @ts-expect-error a number is not a state value
      const notAValue: StateValue = 1

      assert.strictEqual(StateValue, StateValueModule)
      assert.isTrue(StateValue.matchesState("a.b", value))
      assert.strictEqual(StateValue.pathToStateValue, pathToStateValue)
      assert.isNumber(notAValue)
    }))
})

/** A service that a machine's actions need: such a machine has Effect requirements. */
interface NeededService {
  readonly name: "NeededService"
}

describe("[CONF-3] AnyStateMachine and AnyMachineSnapshot", () => {
  it.effect("[CONF-3] every machine without Effect requirements is an AnyStateMachine, and resolveState and getNextSnapshot take one", () =>
    Effect.gen(function* () {
      const untyped = createMachine({ initial: "a", states: { a: { on: { GO: "b" } }, b: {} } })
      const typed = createMachine({
        types: {} as {
          context: { readonly count: number }
          events: { readonly type: "GO" }
          input: { readonly start: number }
          output: string
          meta: { readonly title: string }
        },
        context: { count: 0 },
        initial: "a",
        states: { a: { meta: { title: "A" }, on: { GO: "b" } }, b: {} }
      })
      const machines: ReadonlyArray<AnyStateMachine> = [untyped, typed]

      const reached: Array<AnyMachineSnapshot> = []
      for (const machine of machines) {
        const from = (yield* machine.resolveState({ value: "a", context: { count: 1 } }))
        const next = getNextSnapshot(machine, from, { type: "GO" })
        // It fails with what upstream throws: a macrostep past maxIterations, a throwing guard (P7)
        typeHolds<Equals<typeof next, Effect.Effect<AnyMachineSnapshot, Errors.TransitionError | Errors.GuardError>>>(true)
        reached.push(yield* next)
      }
      assert.deepStrictEqual(reached.map((snapshot) => [snapshot.value, snapshot.context]), [
        ["b", { count: 1 }],
        ["b", { count: 1 }]
      ])

      // every machine snapshot is an AnyMachineSnapshot
      const snapshots: ReadonlyArray<AnyMachineSnapshot> = [
        yield* getInitialSnapshot(untyped),
        yield* getInitialSnapshot(typed, { start: 0 })
      ]
      assert.deepStrictEqual(snapshots.map((snapshot) => snapshot.value), ["a", "a"])
    }))

  it.effect("[CONF-3] getNextSnapshot still checks a concrete machine's event and snapshot, and a machine with Effect requirements is no AnyStateMachine", () =>
    Effect.gen(function* () {
      const typed = createMachine({
        types: {} as { context: { readonly count: number }; events: { readonly type: "GO" } },
        context: { count: 0 },
        initial: "a",
        states: { a: { on: { GO: "b" } }, b: {} }
      })
      const initial = yield* getInitialSnapshot(typed)
      const next = getNextSnapshot(typed, initial, { type: "GO" })
      typeHolds<Equals<typeof next, Effect.Effect<typeof initial, Errors.TransitionError | Errors.GuardError>>>(true)
      assert.strictEqual((yield* next).value, "b")
      // @ts-expect-error the machine declares no STOP event
      const undeclared = () => getNextSnapshot(typed, initial, { type: "STOP" })
      const anySnapshot: AnyMachineSnapshot = initial
      // @ts-expect-error an AnyMachineSnapshot is not this machine's snapshot (its context type is unknown)
      const foreign = () => getNextSnapshot(typed, anySnapshot, { type: "GO" })
      assert.isFunction(undeclared)
      assert.isFunction(foreign)

      const needsService = (
        machine: StateMachine<string, unknown, EventObject, unknown, unknown, EventObject, NeededService>
      ): AnyStateMachine =>
        // @ts-expect-error an AnyStateMachine needs no Effect service: XState machines have none
        machine
      assert.isFunction(needsService)
    }))
})

// ---------------------------------------------------------------- the reason behind invalid.test.ts's flipped failure

describe("[CONF-3] invalid.test.ts and its bad state config", () => {
  it.effect("[CONF-3] resolveState fails by itself for a region value that names no state, with the upstream message, so getNextSnapshot never runs", () =>
    Effect.gen(function* () {
      // the machine of upstream invalid.test.ts
      const machine = createMachine({
        type: "parallel",
        states: {
          A: { initial: "A1", states: { A1: {}, A2: {} } },
          B: { initial: "B1", states: { B1: {}, B2: {} } }
        }
      })
      const resolveBad = yield* Effect.flip(machine.resolveState({ value: { A: "A3", B: "B3" } }))
      assert.instanceOf(resolveBad, Errors.MachineDefinitionError)
      // upstream: getStateNodes(A, 'A3') throws `State 'A3' does not exist on '(machine).A'`
      assert.strictEqual(resolveBad.message, stateDoesNotExist("A3", "(machine).A"))

      // the same call with the states that exist resolves, and getNextSnapshot takes it
      const valid = (yield* machine.resolveState({ value: { A: "A1", B: "B1" } }))
      assert.deepStrictEqual((yield* getNextSnapshot(machine, valid, { type: "E" })).value, { A: "A1", B: "B1" })
    }))
})

// ---------------------------------------------------------------- what json.test.ts counts on a revived machine

describe("[CONF-3] invoke ids and the invoke transitions of a node", () => {
  /** A node with `on`, `onDone`, `after` and three invocations, the second with its own id. */
  const invokingMachine = () =>
    createMachine({
      initial: "active",
      states: {
        active: {
          id: "active",
          initial: "working",
          states: { working: {}, finished: { type: "final" } },
          on: { EVENT: "foo" },
          onDone: "foo",
          after: { 100: "bar" },
          invoke: [
            { src: "first", onDone: "foo", onError: "bar", onSnapshot: "bar" },
            { id: "named", src: "second", onError: "bar" },
            { src: "third" }
          ]
        },
        foo: {},
        bar: {}
      }
    })

  /** The descriptors of the active node, in upstream `formatTransitions` order. */
  const descriptors = [
    "EVENT",
    "xstate.done.state.active",
    "xstate.done.actor.0.active",
    "xstate.error.actor.0.active",
    "xstate.snapshot.0.active",
    "xstate.error.actor.named",
    "xstate.after.100.active"
  ]

  it.effect("[CONF-3] an invoke without an id gets the upstream id <index>.<node id>, and its onDone, onError and onSnapshot transitions join the node's transitions after onDone and before the delayed ones", () =>
    Effect.sync(() => {
      const active = invokingMachine().states["active"]!
      assert.deepStrictEqual(active.invoke.map((invoke) => invoke.id), ["0.active", "named", "2.active"])
      assert.deepStrictEqual(active.transitions.map(([descriptor]) => descriptor), descriptors)
      const done = active.transitions.find(([descriptor]) => descriptor === "xstate.done.actor.0.active")![1]
      const targetIds = done.map((transition) => transition.target?.map((node) => node.id) ?? [])
      assert.deepStrictEqual(targetIds, [["(machine).foo"]])
      assert.deepStrictEqual(done.map((transition) => [transition.source, transition.eventType]), [
        ["active", "xstate.done.actor.0.active"]
      ])
    }))

  it.effect("[CONF-3] the definition lists the invoke transitions once: in on and transitions, never in the invoke JSON, which keeps onSnapshot as upstream does", () =>
    Effect.sync(() => {
      const json = JSON.parse(JSON.stringify(invokingMachine())) as {
        readonly states: {
          readonly active: {
            readonly on: Readonly<Record<string, unknown>>
            readonly transitions: ReadonlyArray<{ readonly eventType: string }>
            readonly invoke: ReadonlyArray<unknown>
          }
        }
      }
      const active = json.states.active
      assert.deepStrictEqual(Object.keys(active.on), descriptors)
      assert.deepStrictEqual(active.transitions.map((transition) => transition.eventType), descriptors)
      assert.deepStrictEqual(active.invoke, [
        { src: "first", onSnapshot: "bar", type: "xstate.invoke", id: "0.active" },
        { id: "named", src: "second", type: "xstate.invoke" },
        { src: "third", type: "xstate.invoke", id: "2.active" }
      ])
    }))

  it.effect("[CONF-3] the selection takes an invoke's done and error transitions by the invoke id", () =>
    Effect.gen(function* () {
      const machine = invokingMachine()
      const working = (yield* machine.resolveState({ value: { active: "working" } }))
      assert.strictEqual((yield* getNextSnapshot(machine, working, { type: "xstate.done.actor.0.active" })).value, "foo")
      assert.strictEqual((yield* getNextSnapshot(machine, working, { type: "xstate.error.actor.named" })).value, "bar")
      assert.strictEqual((yield* getNextSnapshot(machine, working, { type: "xstate.snapshot.0.active" })).value, "bar")
    }))
})

// ---------------------------------------------------------------- where mapState.test.ts's state keys come from

describe("[CONF-3] mapState and the machine's state keys", () => {
  /** A setup machine with a compound state: its keys are idle, parent, parent.child1, parent.child2. */
  const keyedMachine = () =>
    setup({ types: { context: {} as { readonly label: string } } }).createMachine({
      context: { label: "L" },
      initial: "idle",
      states: {
        idle: { on: { OPEN: "parent" } },
        parent: { initial: "child1", states: { child1: {}, child2: {} } }
      }
    })

  it.effect("[CONF-3] a setup machine carries its state keys, so mapState takes every key that names a state and rejects one that names none, at the root and nested", () =>
    Effect.gen(function* () {
      const machine = keyedMachine()
      // the state keys change nothing else of the machine's type
      typeHolds<Equals<StateMachine.ContextOf<typeof machine>, { readonly label: string }>>(true)
      const machines: ReadonlyArray<AnyStateMachine> = [machine]
      assert.strictEqual(machines.length, 1)

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* actor.send({ type: "OPEN" })
      const snapshot = yield* actor.getSnapshot
      const results = mapState(snapshot, {
        map: ({ context }) => `root:${context.label}`,
        states: {
          idle: { map: () => "idle" },
          parent: { map: () => "parent", states: { child1: { map: () => "child1" }, child2: { map: () => "child2" } } }
        }
      })
      assert.deepStrictEqual(results.map((result) => [result.stateNode.id, result.result]), [
        ["(machine).parent.child1", "child1"],
        ["(machine).parent", "parent"],
        ["(machine)", "root:L"]
      ])

      // a key that names no state is a type error; at run time it maps nothing
      const unknownRootKey = mapState(snapshot, {
        states: {
          // @ts-expect-error the machine has no state "nonexistent" (upstream mapState.test)
          nonexistent: { map: () => "nonexistent" }
        }
      })
      const unknownNestedKey = mapState(snapshot, {
        states: {
          parent: {
            states: {
              // @ts-expect-error the parent state has no child "invalidChild" (upstream mapState.test)
              invalidChild: { map: () => "invalidChild" }
            }
          }
        }
      })
      assert.deepStrictEqual(unknownRootKey, [])
      assert.deepStrictEqual(unknownNestedKey, [])
    }))

  it.effect("[CONF-3] the snapshots that resolveState and getNextSnapshot give for a setup machine carry the same state keys", () =>
    Effect.gen(function* () {
      const machine = keyedMachine()
      const resolved = (yield* machine.resolveState({ value: "idle", context: { label: "R" } }))
      const next = yield* getNextSnapshot(machine, resolved, { type: "OPEN" })
      assert.deepStrictEqual(mapState(resolved, { states: { idle: { map: () => "idle" } } }).map((result) => result.result), ["idle"])
      assert.deepStrictEqual(
        mapState(next, { states: { parent: { states: { child1: { map: () => "child1" } } } } }).map((result) => result.result),
        ["child1"]
      )
      const misspelled = () =>
        mapState(resolved, {
          states: {
            // @ts-expect-error the machine has no state "idel"
            idel: { map: () => "idel" }
          }
        })
      const misspelledNext = () =>
        mapState(next, {
          states: {
            // @ts-expect-error the machine has no state "parnet"
            parnet: { map: () => "parnet" }
          }
        })
      assert.deepStrictEqual(misspelled(), [])
      assert.deepStrictEqual(misspelledNext(), [])
    }))

  it.effect("[CONF-3] a machine from createMachine without setup carries no state keys, so mapState takes any key, and a key that names no state maps nothing", () =>
    Effect.gen(function* () {
      const machine = createMachine({ initial: "a", states: { a: {} } })
      const snapshot = yield* getInitialSnapshot(machine)
      const results = mapState(snapshot, {
        map: () => "root",
        states: { a: { map: () => "a" }, nonexistent: { map: () => "nonexistent" } }
      })
      assert.deepStrictEqual(results.map((result) => result.result), ["a", "root"])
    }))
})

// ---------------------------------------------------------------- matchesState and a machine snapshot

describe("[CONF-3] matchesState and a machine snapshot", () => {
  /** A machine whose initial snapshot is at `{ a: "b" }`. */
  const nestedMachine = () => createMachine({ initial: "a", states: { a: { initial: "b", states: { b: {} } }, c: {} } })

  /** The cast an upstream caller needs too: the typed parameters take state values only. */
  const asStateValue = (snapshot: AnyMachineSnapshot): StateValue => snapshot as unknown as StateValue

  it.effect("[CONF-3] matchesState types both parameters as state values, so a machine snapshot in either position is a type error, as upstream", () =>
    Effect.gen(function* () {
      const snapshot = yield* getInitialSnapshot(nestedMachine())
      // @ts-expect-error a machine snapshot is not a StateValue (upstream: TS2345, no string index signature)
      const snapshotAsValue = () => matchesState("a", snapshot)
      // @ts-expect-error a machine snapshot is not a StateValue (upstream: TS2345, no string index signature)
      const snapshotAsPattern = () => matchesState(snapshot, "a")
      assert.isTrue(snapshotAsValue())
      assert.isFalse(snapshotAsPattern())
    }))

  it.effect("[CONF-3] matchesState reads a machine snapshot on either side as its state value, as upstream toStateValue", () =>
    Effect.gen(function* () {
      const snapshot = asStateValue(yield* getInitialSnapshot(nestedMachine()))
      assert.isTrue(matchesState("a", snapshot))
      assert.isTrue(matchesState("a.b", snapshot))
      assert.isTrue(matchesState({ a: "b" }, snapshot))
      assert.isFalse(matchesState("c", snapshot))
      // as a pattern, the snapshot's value { a: "b" } is more specific than "a"
      assert.isFalse(matchesState(snapshot, "a"))
      assert.isTrue(matchesState(snapshot, { a: "b" }))
      assert.isTrue(matchesState(snapshot, snapshot))
    }))

  it.effect("[CONF-3] matchesState reads any object with both machine and value keys as a snapshot, at every level, as upstream isMachineSnapshot", () =>
    Effect.sync(() => {
      const lookAlike = { machine: "a", value: "b" }
      assert.isTrue(matchesState("b", lookAlike))
      assert.isFalse(matchesState("machine", lookAlike))
      assert.isTrue(matchesState({ p: "b" }, { p: lookAlike }))
      // with one of the two keys only, it stays a state value
      assert.isTrue(matchesState("machine", { machine: "a" }))
      assert.isTrue(matchesState("value", { value: "b" }))
    }))
})

// ---------------------------------------------------------------- where resolve.test.ts finds resolveStateValue

describe("[CONF-3] resolveStateValue and the root", () => {
  it.effect("[CONF-3] resolveStateValue is an export of the stateUtils module only, as upstream, and completes a partial value as machine.resolveState does", () =>
    Effect.gen(function* () {
      // upstream src/index.ts exports getStateNodes from stateUtils, not resolveStateValue
      assert.isFalse("resolveStateValue" in Core)
      assert.isFunction(Core.getStateNodes)

      const machine = createMachine({
        initial: "p",
        states: {
          p: {
            type: "parallel",
            states: {
              a: { initial: "a1", states: { a1: {}, a2: {} } },
              b: { initial: "b1", states: { b1: {}, b2: {} } }
            }
          },
          q: {}
        }
      })
      const partial = { p: { a: "a2" } }
      // the region the value leaves out enters its initial state
      assert.deepStrictEqual(yield* resolveStateValue(machine.root, partial), { p: { a: "a2", b: "b1" } })
      assert.deepStrictEqual((yield* machine.resolveState({ value: partial })).value, yield* resolveStateValue(machine.root, partial))
    }))
})

// ---------------------------------------------------------------- the route event type route.test.ts sends

describe("[CONF-3] the route event of a setup machine", () => {
  /** The machine's own event. */
  type Go = { readonly type: "GO" }

  it.effect("[CONF-3] a setup machine takes { type: 'xstate.route', to } for each routable id at any depth, besides its own events, and no other to", () =>
    Effect.gen(function* () {
      const machine = setup({ types: { events: {} as Go } }).createMachine({
        id: "app",
        initial: "home",
        states: {
          home: { id: "home", route: {}, on: { GO: "deep" } },
          plain: { id: "plain" },
          anonymous: { route: {} },
          deep: { initial: "inner", states: { inner: { id: "inner", route: { guard: () => true } } } }
        }
      })
      typeHolds<Equals<StateMachine.EventOf<typeof machine>, Go | { readonly type: "xstate.route"; readonly to: "#home" | "#inner" }>>(true)

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* actor.send({ type: "xstate.route", to: "#inner" })
      assert.deepStrictEqual((yield* actor.getSnapshot).value, { deep: "inner" })
      yield* actor.send({ type: "xstate.route", to: "#home" })
      assert.strictEqual((yield* actor.getSnapshot).value, "home")

      // an id without a route, a state key and a dot path are no route targets; none moves the actor
      yield* actor.send({
        type: "xstate.route",
        // @ts-expect-error "plain" has an id but no route
        to: "#plain"
      })
      yield* actor.send({
        type: "xstate.route",
        // @ts-expect-error a state key is not a route target
        to: "anonymous"
      })
      yield* actor.send({
        type: "xstate.route",
        // @ts-expect-error a dot path is not a route target
        to: "#app.deep.inner"
      })
      assert.strictEqual((yield* actor.getSnapshot).value, "home")
    }))

  it.effect("[CONF-3] a setup machine without a routable state keeps its event type: a route needs an id, and an id needs a route", () =>
    Effect.gen(function* () {
      const machine = setup({ types: { events: {} as Go } }).createMachine({
        initial: "a",
        states: { a: { id: "a" }, b: { route: {} } }
      })
      typeHolds<Equals<StateMachine.EventOf<typeof machine>, Go>>(true)
      assert.isUndefined(machine.root.on["xstate.route"])

      const silent = setup({ types: { events: {} as never } }).createMachine({
        initial: "a",
        states: { a: { route: {} } }
      })
      typeHolds<Equals<StateMachine.EventOf<typeof silent>, never>>(true)
      assert.isUndefined(silent.root.on["xstate.route"])
    }))

  it.effect("[CONF-3] the root with a route and an id is a route target in the type, as upstream RoutableStateId, though a route event to it moves nothing at run time", () =>
    Effect.gen(function* () {
      const machine = setup({ types: { events: {} as Go } }).createMachine({
        id: "top",
        route: {},
        initial: "a",
        states: { a: { on: { GO: "b" } }, b: {} }
      })
      typeHolds<Equals<StateMachine.EventOf<typeof machine>, Go | { readonly type: "xstate.route"; readonly to: "#top" }>>(true)

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* actor.send({ type: "GO" })
      yield* actor.send({ type: "xstate.route", to: "#top" })
      assert.strictEqual((yield* actor.getSnapshot).value, "b")
      assert.isUndefined(machine.root.on["xstate.route"])
    }))

  it.effect("[CONF-3] RoutableStateId gives #<id> for each node of a schema with both a route and an id, the given node included", () =>
    Effect.sync(() => {
      type Schema = {
        readonly id: "r"
        readonly route: { readonly description: "root" }
        readonly states: {
          readonly a: { readonly id: "a"; readonly route: { readonly description: "a" } }
          readonly b: { readonly route: { readonly description: "b" } }
          readonly c: {
            readonly id: "c"
            readonly states: { readonly d: { readonly id: "d"; readonly route: { readonly guard: "g" } } }
          }
        }
      }
      assert.isTrue(typeHolds<Equals<RoutableStateId<Schema>, "#r" | "#a" | "#d">>(true))
      assert.isTrue(typeHolds<Equals<RoutableStateId<{ readonly states: { readonly a: { readonly id: "a" } } }>, never>>(true))
    }))

  it.effect("[CONF-3] createMachine without setup adds no route event, as upstream", () =>
    Effect.sync(() => {
      const machine = createMachine({
        types: {} as { events: Go },
        initial: "a",
        states: { a: { id: "a", route: {} } }
      })
      typeHolds<Equals<StateMachine.EventOf<typeof machine>, Go>>(true)
      assert.isDefined(machine.root.on["xstate.route"])
    }))
})

// ---------------------------------------------------------------- the machines state.test.ts builds inside createActor

describe("[CONF-3] createMachine inside createActor", () => {
  it.effect("[CONF-3] a machine built as the argument of createActor infers no Effect requirement there, so its actor needs a Scope only, as the same machine built first", () =>
    Effect.gen(function* () {
      // the upstream state.test.ts form: createActor(createMachine({}))
      const empty = createActor(createMachine({}))
      typeHolds<Equals<Effect.Services<typeof empty>, Scope.Scope>>(true)
      const configured = createActor(
        createMachine({ context: { count: 0 }, initial: "a", states: { a: { on: { GO: "b" } }, b: {} } })
      )
      typeHolds<Equals<Effect.Services<typeof configured>, Scope.Scope>>(true)
      const builtFirst = createMachine({})
      const fromBuiltFirst = createActor(builtFirst)
      typeHolds<Equals<Effect.Services<typeof fromBuiltFirst>, Scope.Scope>>(true)

      const stopped = yield* empty.pipe(
        Effect.tap((actor) => actor.start),
        Effect.tap((actor) => actor.stop),
        Effect.flatMap((actor) => actor.getSnapshot)
      )
      assert.strictEqual(stopped.status, "stopped")
      const actor = yield* Effect.tap(configured, (started) => started.start)
      yield* actor.send({ type: "GO" })
      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.value, "b")
      assert.deepStrictEqual(snapshot.context, { count: 0 })
    }))

  it.effect("[CONF-3] an Effect requirement given to createMachine explicitly still reaches the actor", () =>
    Effect.sync(() => {
      const machine = createMachine<object, EventObject, unknown, unknown, EventObject, NeededService>({ context: {} })
      const needsService = () => createActor(machine)
      typeHolds<Equals<Effect.Services<ReturnType<typeof needsService>>, Scope.Scope | NeededService>>(true)
      assert.isFunction(needsService)
    }))

  it.effect("[CONF-3] the port's StateMachine.make, built as the argument of createActor, infers no Effect requirement there either, and an explicit one still reaches the actor", () =>
    Effect.gen(function* () {
      // the port's own constructor, under both root names: StateMachine.make and makeStateMachine
      const empty = createActor(Core.StateMachine.make({}))
      typeHolds<Equals<Effect.Services<typeof empty>, Scope.Scope>>(true)
      const configured = createActor(
        Core.makeStateMachine({ context: { count: 0 }, initial: "a", states: { a: { on: { GO: "b" } }, b: {} } })
      )
      typeHolds<Equals<Effect.Services<typeof configured>, Scope.Scope>>(true)
      const explicit = Core.StateMachine.make<object, EventObject, unknown, unknown, EventObject, NeededService>({ context: {} })
      const needsService = () => createActor(explicit)
      typeHolds<Equals<Effect.Services<ReturnType<typeof needsService>>, Scope.Scope | NeededService>>(true)

      const actor = yield* Effect.tap(configured, (started) => started.start)
      yield* actor.send({ type: "GO" })
      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.value, "b")
      assert.deepStrictEqual(snapshot.context, { count: 0 })
    }))
})

// ---------------------------------------------------------------- the Effect that snapshot.can returns (DEV-10)

describe("[CONF-3] snapshot.can and its GuardError", () => {
  it.effect("[CONF-3] snapshot.can returns Effect<boolean, GuardError>: a guard that throws fails it with a GuardError, where upstream can throws (DEV-10, SD-6)", () =>
    Effect.gen(function* () {
      typeHolds<Equals<ReturnType<AnyMachineSnapshot["can"]>, Effect.Effect<boolean, Errors.GuardError>>>(true)
      const machine = createMachine({
        initial: "a",
        states: {
          a: {
            on: {
              OPEN: "b",
              CHECK: {
                target: "b",
                guard: () => {
                  throw new Error("boom")
                }
              }
            }
          },
          b: {}
        }
      })
      const snapshot = yield* getInitialSnapshot(machine)
      typeHolds<Equals<ReturnType<typeof snapshot.can>, Effect.Effect<boolean, Errors.GuardError>>>(true)
      assert.isTrue(yield* snapshot.can({ type: "OPEN" }))
      const error = yield* Effect.flip(snapshot.can({ type: "CHECK" }))
      assert.instanceOf(error, Errors.GuardError)
      assert.strictEqual(error.message, guardEvaluationFailed("", "CHECK", "(machine).a", "boom"))
    }))
})

// ---------------------------------------------------------------- the order of the tags tags.test.ts stringifies

describe("[CONF-3] the tags of a snapshot and their order", () => {
  it.effect("[CONF-3] tags and toJSON().tags hold each tag once, node by node in the order the states became active and inside a node in its config order, as upstream", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        initial: "a",
        tags: ["root"],
        states: {
          a: {
            type: "parallel",
            tags: ["light", "go", "root"],
            states: {
              b: { tags: "stop" },
              c: { tags: ["go", "amber"] }
            },
            on: { NEXT: "d" }
          },
          d: { tags: ["zebra", "alpha"] }
        }
      })
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      // xstate 5.33.2 gives ["root", "light", "go", "stop", "amber"], then ["root", "zebra", "alpha"]
      const initial = yield* actor.getSnapshot
      assert.deepStrictEqual([...initial.tags], ["root", "light", "go", "stop", "amber"])
      const initialJson = initial.toJSON() as { readonly tags: ReadonlyArray<string> }
      assert.deepStrictEqual(initialJson.tags, ["root", "light", "go", "stop", "amber"])

      yield* actor.send({ type: "NEXT" })
      const next = yield* actor.getSnapshot
      assert.deepStrictEqual([...next.tags], ["root", "zebra", "alpha"])
      const stringified = JSON.parse(JSON.stringify(next)) as { readonly tags: ReadonlyArray<string> }
      assert.deepStrictEqual(stringified.tags, ["root", "zebra", "alpha"])
    }))
})
