/**
 * CONF-4: the upstream files green at phase 4 pass (SD-1, SD-2).
 *
 * The file imports each rewrite whose ledger green phase is 4 inside its own describe block
 * titled `upstream/<name>.test.ts`, so every upstream test of the file runs once, inside the
 * default run, and its evidence routes to CONF-4. `conformancePhase` (`conformance.ts`)
 * keeps the blocks and its checks in declaration order, also under `--sequence.shuffle`:
 *
 * - the graduation check: each imported rewrite has left `pending.json` and the green
 *   type-check exclude (one commit, SD-1), and the ledger marks it `passes`;
 * - the import check: the file imports exactly assert, assign, eventDescriptors, guards,
 *   internalTransitions, machine, parallel, scxml, spawn, spawnChild, stateIn and
 *   examples 6.16 (the ledger's green-phase 4 files), and no other CONF evidence file imports
 *   one of them;
 * - the count check, last: per file, `passed >= runnable - notPortedRunnable` and
 *   `passed >= 1`, no skipped test, and no test still to run (329 runnable upstream tests).
 *
 * T4.23 to T4.34 imported the 12 files one block at a time under the graduation check
 * alone; T4.35 switched to `conformancePhase`. The describe block "the CONF-4 suite and its
 * count floor" pins the order of the checks and the count data of phase 4.
 *
 * assert.test.ts calls `assertEvent` with one event type and with a list of event types
 * inside an action that the machine takes as the second `createMachine` argument, on a
 * machine whose event type comes from the XState `types` field, and reads the error the
 * actor's `changes` stream fails with (upstream: the observer's `error` callback; D6, SD-4).
 * It needs no describe block of its own here: the A23 evidence file pins what `assertEvent`
 * succeeds with and how it narrows, the upstream message its Effect fails with for one type
 * and for a list (SD-3, amended 2026-10-08), that the error prints as `[Error: <message>]`,
 * and that a mismatch inside an action given that way is the actor's error; S24 pins that an
 * action that throws fails the subscribed `changes` stream with that error.
 *
 * assign.test.ts writes `assign` inline in a `createMachine` call that infers the context
 * and event types from its own `types` member and `context` value, and as an implementation
 * in the second argument of a machine whose `types.actions` declares the action's params.
 * A1 pins what the assigners compute at run time (property and function forms, the params
 * of the use, the pre-action context). The describe block "an inline assign and the types
 * of the machine it is written in" pins that both inline assigners are typed by the
 * machine's types, as upstream (the port's `assign` returns a definition object, D15, so
 * its type gives TypeScript the deferral upstream's function result gets; `Assign`). The
 * describe block "the implementations createMachine takes for the names its types member
 * declares" pins the second argument and `provide` of such a machine (upstream
 * `InternalMachineImplementations`): an assign there reads its action's params, and each
 * record takes only the declared action, guard, delay and actor names, with their params and
 * logic; an undeclared record still takes any name.
 *
 * eventDescriptors.test.ts sends events to machines whose `on` keys are an exact event type,
 * `*`, partial descriptors (`foo.*`, `foo.bar.*`) and invalid ones (`event*`, `event.*.bar.*`,
 * `*.event.*`, `*event.*`), reads the warnings through a test logger (upstream: a
 * `console.warn` spy; SD-21), and calls `assertEvent` with a partial descriptor in a setup
 * action and on its own. It needs no describe block of its own here: S17 pins how each
 * descriptor matches, the candidate order (the exact descriptor, then the longer partial one,
 * then `*`), the fallback when a candidate's guard fails, and the warnings an invalid
 * descriptor logs for each event; S25 pins that the invalid descriptors of one node warn in
 * declaration order; A23 pins that `assertEvent` with a partial descriptor narrows to the
 * events under it and otherwise fails with the upstream message, printed as
 * `[Error: <message>]`.
 *
 * guards.test.ts reads, in a guard under an `on` descriptor of a machine whose `types`
 * declare its events, the members of that descriptor's event (`event.isEmergency` under
 * `EMERGENCY`), and on machines without `types` it reads and sends event members no type
 * declares (`event.elapsed`, `event.secret`). The describe block "the event type of a machine
 * whose types declare no events" pins that `createMachine` and `setup` infer upstream's
 * `AnyEventObject` there (the one `any` in `src`, SD-22 amendment) and keep declared events
 * exact. The describe block "the event type each on descriptor gives its transitions"
 * pins upstream's `TransitionsConfig`: each descriptor's guard, actions and params read the
 * events it matches (its own event, the events under a partial descriptor, every event under
 * `*`), a key that is no descriptor of the declared events is a type error, an action typed
 * for the whole event union still fits under any descriptor and its `self` takes every event
 * of the machine, an inline `sendTo` or `sendParent` reads the descriptor's events, and an
 * inline `raise`, an inline `assign`'s `self` and `enqueue.raise` take every event. The
 * describe block "a guard that refers back to itself" pins how a guard cycle ends: with
 * upstream's guard-evaluation error around the stack-overflow message for a transition on an
 * event, and, for an eventless transition, with that message in a `GuardError` where the cycle
 * runs through a built-in guard (ledger DEV-30). S16, A14, A15 and A16 pin unknown names,
 * every guard form, the combinators and `stateIn`.
 *
 * internalTransitions.test.ts sends events to machines whose transitions target a child of
 * their source (`.b`, `foo.b`, `.a11.a111`), the source itself with `reenter: true`, or
 * nothing (an action list under an `on` key, as an object or in an array, on a child and on
 * the root), and reads the state value, the entry and exit order through `trackEntries`, and
 * the context that entry and exit assigners count. It needs no describe block of its own
 * here: S12 pins that a transition to the source or inside it has the source as its domain,
 * so the source is neither exited nor entered and only its active descendants are, and that
 * `reenter: true` exits and enters the source; S11 pins that a targetless transition on a
 * child or on the parent runs its actions, keeps the active child and runs no exit or entry
 * action; S9 pins the relative and absolute target forms.
 *
 * machine.test.ts reads a machine's `states` keys, its `events` (the forbidden event left
 * out), `version`, `id`, `schemas` and its nodes' ids, `transitions` keys (the forbidden
 * event kept) and `config`, which is the machine config's own object: the test writes
 * `config.meta` on a node and reads it back from the machine config, so `meta` is writable,
 * as upstream's `StateNodeConfig`. It provides plain-function actions and guards and an empty
 * record, resolves a partial and a final state value, and runs a machine without context, a
 * lazy context, an initial eventless transition and a root-only machine. It needs no
 * describe block of its own here: S25 pins the machine and node fields, `events` without and
 * `transitions` with the forbidden event, the original `config` object and `resolveState`;
 * A20 pins `provide` with plain functions and a lazy context once for each actor; S3 pins
 * that a states map without `initial` on a node that is not parallel fails at
 * `createMachine`. The rewrite's own `config.meta` write pins the writable type under the
 * green type-check.
 *
 * parallel.test.ts enters parallel roots and nested and flat-nested parallel states, sends
 * events that one, several or every region takes (`testMultiTransition` over the word
 * processor machine's expected transitions), raises events and takes eventless transitions
 * in several regions at once, targets a relative substate and another region, re-enters the
 * source region, runs each region's initial actions, completes a parallel state into its
 * `xstate.done.state.*` event (also with a history node directly under it), and checks that a
 * targetless transition enters and exits nothing. S3, S7, S8, S10, S10b, S11, S12 and S13 pin
 * what it uses. Its upstream cases pass whatever order the engine keeps the active nodes in,
 * so the describe block "the order of the active state nodes (upstream _nodes)" pins that
 * order: eventless transitions of two regions run in the order their nodes became active, a
 * snapshot's `_nodes`, `mapState`, tags, `getMeta` and the state value's keys follow it after
 * a move inside one region, after `resolveState` and a restore, and in a done snapshot
 * (reverse document order), and a history state records the nodes in that order.
 *
 * scxml.test.ts converts 169 SCION and W3C SCXML documents with the test-support converter
 * (D4, `test/upstream/support/scxml.ts`) and runs each machine to completion: a W3C case moves
 * the TestClock on one millisecond at a time until the machine is done in `pass` (or `final`);
 * a SCION case runs on a `SimulatedClock`, sends each event after its delay and checks the
 * configuration through `getStateNodes`. SCXML-1 pins that all 169 convert; S3, S8, S9, S11,
 * S12, S13 and S19 pin the parallel, history, target, targetless, `reenter`, action-order and
 * eventless semantics the documents exercise. Seven W3C cases (test191, 192, 220, 232, 235,
 * 247, 347) invoke a child machine: the describe block "the invocations of a state" pins the
 * part of upstream's invoke runtime they use: a state's invocations start when it is entered,
 * under their ids and source names, and stop when it is exited; the child's done event takes
 * the invocation's `onDone` or an `on` descriptor `xstate.done.actor.<id>` once; `#_parent`
 * and `#_<id>` reach the parent and the child; `onSnapshot` syncs the child's snapshots; a
 * function input reads the entering event. The describe block "the logger actor option"
 * pins the type of the `logger` option the W3C runner passes.
 *
 * spawn.test.ts spawns, in a context factory, a child machine whose `types` declare an input,
 * with that input and a `systemId`, into a context typed `ActorRefFrom<typeof childMachine>`,
 * starts the actor and finds the child through `actor.system.get` (an `Option`, D7). A21 pins
 * that the factory's spawn stores the reference, that `snapshot.children` holds it, that
 * `system.get` finds it by its `systemId`, and that the input is type-checked. The describe
 * block "the ActorRefFrom type" pins upstream's `ActorRefFrom`, which the file imports from
 * the root: the reference of a machine's snapshot, events and emitted events, which a
 * context factory's spawn returns, of a function's result, of a `Promise`'s promise logic and
 * of any other logic, and `never` for anything else.
 *
 * spawnChild.test.ts spawns, on the root's entry, a promise child given as logic and one given
 * by a name that the machine's `types.actors` declares and `provide` serves, with an input, and
 * finds each in `snapshot.children`; it spawns an observable child with `syncSnapshot` and
 * moves to a final state on its `xstate.snapshot.int` event whose context is 5 (an `Option`,
 * DEV-19), waiting with `toEffect` (upstream: the observer's `complete`; SD-19); and it spawns
 * a child machine under an id that a function of the context gives, then sends it an event by
 * that id in the same entry. A9 pins the spawn wiring, the `systemId`, `syncSnapshot`, a named
 * src and the warning for a src that names no actor. The describe block "the input of a
 * spawnChild with a named src" pins upstream's `SpawnArguments` input: the declared logic's
 * input, any input where nothing declares the name, and an input function that reads the
 * action context. The describe block "the input of a spawnChild with an inline logic src" pins
 * upstream's logic branch of `SpawnArguments`: a logic given inline takes any input, not its
 * own input type, in `spawnChild`, `enqueue.spawnChild`, a machine that declares its actors and
 * a setup's `spawnChild`. The describe block "a spawnChild src that names no actor" pins
 * DEV-31: the warning and no `snapshot.children` entry, at the initial entry and on an event.
 *
 * stateIn.test.ts sends events to parallel machines whose transitions are guarded by
 * `stateIn` of an object state value, a dotted path, an id (`#a_a2`, `#b_b2`, `#bar1`) and an id
 * with a key path (`#b.B1`), also deep in one region against a node of another region (the
 * "relative to grandparent" cases), uses `stateIn` as a guard implementation that the second
 * `createMachine` argument names, and forbids a parent's event until a child state is active
 * (the child's own transitions are tried first). It needs no describe block of its own here:
 * A16 pins each `stateIn` form, the grandparent case, `#id.path`, a named `stateIn`
 * implementation and the combinators; S3 pins that each region handles its own events, and S18
 * that a child state's entry for an event comes before its parent's.
 *
 * examples/6.16.test.ts resolves a state value of a parallel root with `machine.resolveState`,
 * sends one event or a list of events (`1, 5, 3`) with `getNextSnapshot` through the shared
 * helper `testAll`, and compares the state value it reaches: numeric keys in `on` as event
 * types, an event (`1`) that both regions take at once, a transition in one region guarded by
 * `stateIn('#E')` on a node of the other region, and events that no active node takes or whose
 * guard fails, which leave the state value as it was. It needs no describe block of its own
 * here: the S3 evidence file pins the entry of every region and that each region handles its
 * own events, the imported parallel.test.ts cases pin an event that several regions take at
 * once, A16 pins `stateIn("#id")` against a node of the other region, and S25 pins
 * `resolveState`.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Logger, Option } from "effect"
import type { ActorRefBase } from "../../src/ActorRef.js"
import {
  type ActorRefFrom,
  type ActorRefType,
  and,
  type AnyEventObject,
  assign,
  createActor,
  createMachine,
  enqueueActions,
  fromPromise,
  type GuardScope,
  guards,
  type MachineImplementations,
  mapState,
  not,
  type ObservableActorLogic,
  or,
  type PromiseActorLogic,
  raise,
  sendParent,
  sendTo,
  setup,
  spawnChild,
  stateIn,
  type TransitionActorLogic,
  waitFor
} from "../../src/index.js"
import type { ActorLogic } from "../../src/ActorLogic.js"
import type { StateMachine } from "../../src/StateMachine.js"
import { conformancePhase, greenFiles, requiredPassed, upstreamFileOptions } from "./conformance.js"
import { shortName } from "./ledger.js"
import { readLedger, readManifest } from "./parity.js"
import { actorTypeNotFound, guardEvaluationFailed } from "./upstream-messages.js"

// ---------------------------------------------------------------- the imported files

conformancePhase(4, () => {
  describe("upstream/assert.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/assert.test.js")
  })
  describe("upstream/assign.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/assign.test.js")
  })
  describe("upstream/eventDescriptors.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/eventDescriptors.test.js")
  })
  describe("upstream/guards.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/guards.test.js")
  })
  describe("upstream/internalTransitions.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/internalTransitions.test.js")
  })
  describe("upstream/machine.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/machine.test.js")
  })
  describe("upstream/parallel.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/parallel.test.js")
  })
  describe("upstream/scxml.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/scxml.test.js")
  })
  describe("upstream/spawn.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/spawn.test.js")
  })
  describe("upstream/spawnChild.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/spawnChild.test.js")
  })
  describe("upstream/stateIn.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/stateIn.test.js")
  })
  describe("upstream/examples/6.16.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/examples/6.16.test.js")
  })
})

// ---------------------------------------------------------------- the shape of the suite and its count floor

const SUITE_TITLE = "[CONF-4] upstream files green at phase 4"

/** The upstream files green at phase 4, in the order of the ledger and of the imported blocks. */
const PHASE_4_FILES = [
  "assert",
  "assign",
  "eventDescriptors",
  "guards",
  "internalTransitions",
  "machine",
  "parallel",
  "scxml",
  "spawn",
  "spawnChild",
  "stateIn",
  "examples/6.16"
] as const

describe("[CONF-4] the CONF-4 suite and its count floor", () => {
  it("[CONF-4] the suite imports the 12 files green at phase 4, then runs the graduation, import and count checks, the count check last, and never shuffles its own children", ({ task }) => {
    const suite = task.file.tasks.find((child) => child.name === SUITE_TITLE)
    assert.strictEqual(suite?.type, "suite")
    const children = suite?.type === "suite" ? suite.tasks : []
    assert.deepStrictEqual(children.map((child) => [child.type, child.name]), [
      ...PHASE_4_FILES.map((name) => ["suite", `upstream/${name}.test.ts`]),
      ["test", "[CONF-4] each imported rewrite has left pending.json and the green type-check exclude, and the ledger marks it passes"],
      ["test", "[CONF-4] the evidence file imports exactly the upstream files green at phase 4, and no other CONF evidence file imports them"],
      ["test", "[CONF-4] every imported file meets its count"]
    ])
    assert.strictEqual(suite?.type === "suite" ? suite.shuffle : undefined, false)
  })

  it.effect("[CONF-4] the files green at phase 4 have 329 runnable upstream tests and a floor of 329 passed: the skipped-upstream row of machine lowers nothing", () =>
    Effect.sync(() => {
      const { ledger, problems } = readLedger()
      assert.deepStrictEqual(problems, [])
      const manifest = readManifest()
      // [name, runnable, upstream skip + todo, "Tests not ported" rows, required passed]
      const floors = greenFiles(ledger.files, 4).map((row) => {
        const name = row["Name"] ?? ""
        const upstream = manifest.files.find((file) => shortName(file.path) === name)
        if (upstream === undefined) return [name]
        const rows = ledger.notPorted.filter((notPorted) => notPorted["File"] === upstream.path).length
        return [name, upstream.runnable, upstream.skip + upstream.todo, rows, requiredPassed(upstream, ledger.notPorted)]
      })
      assert.deepStrictEqual(floors, [
        ["assert", 2, 0, 0, 2],
        ["assign", 14, 0, 0, 14],
        ["eventDescriptors", 15, 0, 0, 15],
        ["guards", 46, 0, 0, 46],
        ["internalTransitions", 12, 0, 0, 12],
        ["machine", 20, 1, 1, 20],
        ["parallel", 28, 0, 0, 28],
        ["scxml", 169, 0, 0, 169],
        ["spawn", 1, 0, 0, 1],
        ["spawnChild", 4, 0, 0, 4],
        ["stateIn", 9, 0, 0, 9],
        ["examples/6.16", 9, 0, 0, 9]
      ])
      assert.deepStrictEqual(floors.map((floor) => floor[0]), [...PHASE_4_FILES])
      assert.strictEqual(floors.reduce((total, floor) => total + Number(floor[4]), 0), 329)
    }))
})

// ---------------------------------------------------------------- assign and the machine's types

/** True when `A` and `B` are the same type. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

/** Compiles only for `true`. */
const typeHolds = <T extends true>(holds: T): T => holds

describe("[CONF-4] an inline assign and the types of the machine it is written in", () => {
  it.effect("[CONF-4] an inline assign in a createMachine call reads the context and event types that the same call infers from its types member, so the machine keeps the declared event type", () =>
    Effect.gen(function* () {
      type Context = { readonly count: number; readonly label: string }
      type Event = { readonly type: "ADD"; readonly by: number } | { readonly type: "RENAME"; readonly label: string }
      const machine = createMachine({
        types: {} as { context: Context; events: Event },
        context: { count: 1, label: "a" },
        on: {
          ADD: { actions: assign(({ context, event }) => ({ count: context.count + (event.type === "ADD" ? event.by : 0) })) },
          RENAME: {
            actions: assign({ label: ({ event }) => (event.type === "RENAME" ? event.label : "none") })
          }
        }
      })
      typeHolds<Equals<StateMachine.ContextOf<typeof machine>, Context>>(true)
      typeHolds<Equals<StateMachine.EventOf<typeof machine>, Event>>(true)
      const wrongKeyType = () =>
        createMachine({
          types: {} as { context: Context },
          context: { count: 1, label: "a" },
          // @ts-expect-error the context declares count as a number
          entry: assign({ count: "two" })
        })

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* actor.send({ type: "ADD", by: 2 })
      yield* actor.send({ type: "RENAME", label: "b" })
      assert.deepStrictEqual((yield* actor.getSnapshot).context, { count: 3, label: "b" })
      assert.isFunction(wrongKeyType)
    }))

  it.effect("[CONF-4] an inline assign in a createMachine call without a types member reads the context type the call infers from its context value", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        context: { items: [] as ReadonlyArray<string> },
        entry: assign(({ context }) => ({ items: [...context.items, "first"] }))
      })
      typeHolds<Equals<StateMachine.ContextOf<typeof machine>, { items: ReadonlyArray<string> }>>(true)

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      assert.deepStrictEqual((yield* actor.getSnapshot).context, { items: ["first"] })
    }))

  it.effect("[CONF-4] an assign in the actions record of a setup call reads the context type the setup's types declare", () =>
    Effect.gen(function* () {
      const machine = setup({
        types: {} as { context: { readonly count: number } },
        actions: { increment: assign(({ context }) => ({ count: context.count + 1 })) }
      }).createMachine({ context: { count: 0 }, entry: "increment" })

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      assert.deepStrictEqual((yield* actor.getSnapshot).context, { count: 1 })
    }))
})

describe("[CONF-4] the implementations createMachine takes for the names its types member declares", () => {
  it.effect("[CONF-4] an assign that implements a declared action reads that action's params, in the second argument and in provide", () =>
    Effect.gen(function* () {
      const machine = createMachine(
        {
          types: {} as { actions: { type: "inc"; params: { by: number } } },
          context: { count: 1 },
          entry: { type: "inc", params: { by: 10 } }
        },
        {
          actions: { inc: assign(({ context }, params) => ({ count: context.count + params.by })) }
        }
      )
      const provided = machine.provide({
        actions: { inc: assign({ count: ({ context }, params) => context.count * params.by }) }
      })
      const plain = machine.provide({
        actions: {
          inc: (_, params) => {
            typeHolds<Equals<typeof params, { by: number }>>(true)
          }
        }
      })

      const first = yield* Effect.tap(createActor(machine), (started) => started.start)
      assert.strictEqual((yield* first.getSnapshot).context.count, 11)
      const second = yield* Effect.tap(createActor(provided), (started) => started.start)
      assert.strictEqual((yield* second.getSnapshot).context.count, 10)
      const third = yield* Effect.tap(createActor(plain), (started) => started.start)
      assert.strictEqual((yield* third.getSnapshot).context.count, 1)
    }))

  it.effect("[CONF-4] an assign provided for a setup action reads the params that the setup's implementation of that action declares", () =>
    Effect.gen(function* () {
      const machine = setup({
        types: {} as { context: { readonly count: number } },
        actions: { add: (_, _params: { readonly by: number }) => {} }
      }).createMachine({ context: { count: 1 }, entry: { type: "add", params: { by: 4 } } })
      const provided = machine.provide({
        actions: { add: assign(({ context }, params) => ({ count: context.count + params.by })) }
      })

      const actor = yield* Effect.tap(createActor(provided), (started) => started.start)
      assert.strictEqual((yield* actor.getSnapshot).context.count, 5)
    }))

  it.effect("[CONF-4] the second argument and provide take only the declared action, guard, delay and actor names, each guard with its params and each actor with its declared logic", () =>
    Effect.sync(() => {
      type Types = {
        context: { readonly count: number }
        actions: { type: "track" }
        guards: { type: "atLeast"; params: { min: number } }
        delays: "soon"
        actors: { src: "load"; logic: PromiseActorLogic<number, { readonly id: string }> }
      }
      const config = { types: {} as Types, context: { count: 0 } }
      const machine = createMachine(config, {
        actions: { track: () => {} },
        guards: { atLeast: ({ context }, params) => context.count >= params.min },
        delays: { soon: 100 },
        actors: { load: fromPromise(async ({ input }) => input.id.length) }
      })
      const unknownNames = () =>
        createMachine(config, {
          // @ts-expect-error the types member declares no action named other
          actions: { other: () => {} },
          // @ts-expect-error the types member declares no guard named other
          guards: { other: () => true },
          // @ts-expect-error the types member declares no delay named later
          delays: { later: 200 },
          // @ts-expect-error the types member declares no actor named other
          actors: { other: fromPromise(async () => 1) }
        })
      const provided = machine.provide({ guards: { atLeast: (_, params) => params.min > 0 } })
      const wrongParams = () =>
        // @ts-expect-error atLeast takes { min: number }, so a params.max read is an error
        machine.provide({ guards: { atLeast: (_, params) => params.max > 0 } })
      const wrongLogic = () =>
        // @ts-expect-error load is declared with a number output, not a string one
        machine.provide({ actors: { load: fromPromise(async () => "text") } })
      const unknownProvided = () =>
        // @ts-expect-error provide takes the declared names only
        machine.provide({ delays: { later: 200 } })
      assert.isFunction(unknownNames)
      assert.isFunction(wrongParams)
      assert.isFunction(wrongLogic)
      assert.isFunction(unknownProvided)
      assert.deepStrictEqual(Object.keys(machine.implementations.actors ?? {}), ["load"])
      assert.deepStrictEqual(Object.keys(provided.implementations.guards ?? {}), ["atLeast"])
    }))

  it.effect("[CONF-4] a record whose names the types member does not declare still takes any name and any params", () =>
    Effect.gen(function* () {
      const machine = createMachine(
        {
          types: {} as { actions: { type: "inc" } },
          context: { count: 0 },
          entry: "inc"
        },
        {
          actions: { inc: assign(({ context }) => ({ count: context.count + 1 })) },
          guards: { anyGuard: (_, params: { readonly min: number }) => params.min > 0 },
          delays: { anyDelay: 10 },
          actors: { anyActor: fromPromise(async () => "any") }
        }
      ).provide({ actions: {}, guards: { other: () => true } })

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      assert.strictEqual((yield* actor.getSnapshot).context.count, 1)
    }))
})

// ---------------------------------------------------------------- the event type of each on descriptor

describe("[CONF-4] the event type each on descriptor gives its transitions", () => {
  type LightEvent =
    | { readonly type: "TIMER" }
    | { readonly type: "EMERGENCY"; readonly isEmergency?: boolean }
    | { readonly type: "mouse.click"; readonly x: number }
    | { readonly type: "mouse.move"; readonly y: number }

  it.effect("[CONF-4] a guard, an action and dynamic params under an on descriptor read the events that descriptor matches: its own event, the events under a partial descriptor, every event under *", () =>
    Effect.gen(function* () {
      const machine = createMachine(
        {
          types: {} as { context: { readonly log: ReadonlyArray<string> }; events: LightEvent },
          context: { log: [] },
          initial: "green",
          states: {
            green: {
              on: {
                EMERGENCY: {
                  target: "red",
                  guard: ({ event }) => {
                    typeHolds<Equals<typeof event, { readonly type: "EMERGENCY"; readonly isEmergency?: boolean }>>(true)
                    return event.isEmergency === true
                  }
                },
                "mouse.*": {
                  actions: assign(({ context, event }) => {
                    typeHolds<Equals<typeof event, Extract<LightEvent, { readonly type: `mouse.${string}` }>>>(true)
                    return { log: [...context.log, event.type === "mouse.click" ? `click ${event.x}` : `move ${event.y}`] }
                  })
                },
                "*": {
                  guard: { type: "never", params: ({ event }) => ({ seen: event.type }) },
                  actions: ({ event }) => {
                    typeHolds<Equals<typeof event, LightEvent>>(true)
                  }
                }
              }
            },
            red: {}
          }
        },
        { guards: { never: () => false } }
      )

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* actor.send({ type: "mouse.click", x: 1 })
      yield* actor.send({ type: "mouse.move", y: 2 })
      yield* actor.send({ type: "EMERGENCY", isEmergency: false })
      assert.strictEqual((yield* actor.getSnapshot).value, "green")
      yield* actor.send({ type: "EMERGENCY", isEmergency: true })
      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.value, "red")
      assert.deepStrictEqual(snapshot.context.log, ["click 1", "move 2"])
    }))

  it.effect("[CONF-4] an on key that names no declared event, or a partial descriptor of an event type without a dot, is a type error", () =>
    Effect.sync(() => {
      const unknownKey = () =>
        createMachine({
          types: {} as { events: LightEvent },
          on: {
            TIMER: {},
            // @ts-expect-error the machine declares no event UNKNOWN
            UNKNOWN: {}
          }
        })
      const exactOnly = () =>
        createMachine({
          types: {} as { events: LightEvent },
          on: {
            // @ts-expect-error TIMER has no dot, so TIMER.* matches no declared event
            "TIMER.*": {}
          }
        })
      assert.isFunction(unknownKey)
      assert.isFunction(exactOnly)
    }))

  it.effect("[CONF-4] an action typed for the whole event union fits under any descriptor, and an action's self takes every event of the machine", () =>
    Effect.gen(function* () {
      type Context = { readonly count: number }
      const countAll = assign<Context, LightEvent>(({ context }) => ({ count: context.count + 1 }))
      const machine = createMachine({
        types: {} as { context: Context; events: LightEvent },
        context: { count: 0 },
        on: {
          TIMER: {
            actions: [
              countAll,
              ({ self }) => {
                typeHolds<Equals<Parameters<typeof self.send>[0], LightEvent>>(true)
              }
            ]
          },
          "mouse.*": { actions: countAll }
        }
      })

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* actor.send({ type: "TIMER" })
      yield* actor.send({ type: "mouse.move", y: 0 })
      assert.strictEqual((yield* actor.getSnapshot).context.count, 2)
    }))

  it.effect("[CONF-4] sendTo and sendParent written inline under a descriptor of a typed machine read that descriptor's events, and the machine keeps its declared event type", () =>
    Effect.gen(function* () {
      type CountEvent = { readonly type: "FORWARD"; readonly amount: number } | { readonly type: "ADD"; readonly by: number }
      const machine = createMachine({
        types: {} as { context: { readonly total: number }; events: CountEvent },
        context: { total: 0 },
        on: {
          FORWARD: {
            actions: sendTo(({ self }) => self, ({ event }) => {
              typeHolds<Equals<typeof event, { readonly type: "FORWARD"; readonly amount: number }>>(true)
              return { type: "ADD", by: event.amount }
            })
          },
          ADD: { actions: assign(({ context, event }) => ({ total: context.total + event.by })) }
        }
      })
      const child = createMachine({
        types: {} as { events: CountEvent },
        on: { FORWARD: { actions: sendParent({ type: "DONE" }) } }
      })
      typeHolds<Equals<StateMachine.EventOf<typeof machine>, CountEvent>>(true)
      typeHolds<Equals<StateMachine.EventOf<typeof child>, CountEvent>>(true)

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* actor.send({ type: "FORWARD", amount: 3 })
      const done = yield* waitFor(actor, (snapshot) => snapshot.context.total > 0)
      assert.strictEqual(done.context.total, 3)
    }))

  it.effect("[CONF-4] an inline raise, an inline assign's self and enqueue.raise under a descriptor take every event of the machine", () =>
    Effect.gen(function* () {
      type StepEvent = { readonly type: "START" } | { readonly type: "STEP" } | { readonly type: "STOP" }
      const machine = createMachine({
        types: {} as { context: { readonly steps: ReadonlyArray<string> }; events: StepEvent },
        context: { steps: [] },
        on: {
          START: {
            actions: [
              raise({ type: "STEP" }),
              assign(({ context, event, self }) => {
                typeHolds<Equals<typeof event, { readonly type: "START" }>>(true)
                typeHolds<Equals<Parameters<typeof self.send>[0], StepEvent>>(true)
                return { steps: [...context.steps, event.type] }
              })
            ]
          },
          STEP: {
            actions: enqueueActions(({ enqueue, event }) => {
              typeHolds<Equals<typeof event, { readonly type: "STEP" }>>(true)
              enqueue.assign(({ context }) => ({ steps: [...context.steps, "STEP"] }))
              enqueue.raise({ type: "STOP" })
            })
          },
          STOP: { actions: assign(({ context, event }) => ({ steps: [...context.steps, event.type] })) }
        }
      })

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* actor.send({ type: "START" })
      assert.deepStrictEqual((yield* actor.getSnapshot).context.steps, ["START", "STEP", "STOP"])
    }))
})

// ---------------------------------------------------------------- the event type without declared events

describe("[CONF-4] the event type of a machine whose types declare no events", () => {
  it.effect("[CONF-4] createMachine without declared events infers AnyEventObject: its guards and params read any member of the event, and its actor takes events with any members", () =>
    Effect.gen(function* () {
      const received: Array<unknown> = []
      const machine = createMachine(
        {
          initial: "a",
          states: {
            a: {
              on: {
                TIMER: [
                  { target: "b", guard: ({ event }) => event.elapsed > 200 },
                  { target: "c", guard: ({ event: { elapsed } }) => elapsed > 100 }
                ],
                SECRET: { guard: { type: "remember", params: ({ event }) => ({ secret: event.secret }) } }
              }
            },
            b: {},
            c: {}
          }
        },
        {
          guards: {
            remember: (_, params) => {
              received.push(params)
              return false
            }
          }
        }
      )
      typeHolds<Equals<StateMachine.EventOf<typeof machine>, AnyEventObject>>(true)

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* actor.send({ type: "SECRET", secret: 42 })
      yield* actor.send({ type: "TIMER", elapsed: 150 })
      assert.strictEqual((yield* actor.getSnapshot).value, "c")
      assert.deepStrictEqual(received, [{ secret: 42 }])
    }))

  it.effect("[CONF-4] setup without declared events infers AnyEventObject too, and declared events stay exact", () =>
    Effect.gen(function* () {
      const open = setup({}).createMachine({
        initial: "idle",
        states: { idle: { on: { GO: { target: "done", guard: ({ event }) => event.ready === true } } }, done: {} }
      })
      typeHolds<Equals<StateMachine.EventOf<typeof open>, AnyEventObject>>(true)
      const declared = createMachine({ types: {} as { events: { readonly type: "GO" } } })
      typeHolds<Equals<StateMachine.EventOf<typeof declared>, { readonly type: "GO" }>>(true)

      const actor = yield* Effect.tap(createActor(open), (started) => started.start)
      yield* actor.send({ type: "GO", ready: false })
      assert.strictEqual((yield* actor.getSnapshot).value, "idle")
      yield* actor.send({ type: "GO", ready: true })
      assert.strictEqual((yield* actor.getSnapshot).value, "done")
    }))
})

// ---------------------------------------------------------------- guards that refer to themselves

describe("[CONF-4] a guard that refers back to itself", () => {
  /** The message of the RangeError a JavaScript call stack overflow throws (V8, Node). */
  const stackOverflow = "Maximum call stack size exceeded"
  type CycleEvent = { readonly type: "EV" }
  type CycleGuards = MachineImplementations<unknown, CycleEvent>["guards"]

  /** A machine whose transition for EV is guarded by the guard named `a`. */
  const onEvent = (guards: CycleGuards) =>
    createMachine(
      {
        types: {} as { events: CycleEvent },
        id: "cycle",
        initial: "idle",
        states: { idle: { on: { EV: { target: "done", guard: "a" } } }, done: {} }
      },
      { guards }
    )

  /** A machine whose eventless transition from its initial state is guarded by `a`. */
  const eventless = (guards: CycleGuards) =>
    createMachine(
      {
        types: {} as { events: CycleEvent },
        id: "cycle",
        initial: "idle",
        states: { idle: { always: { target: "done", guard: "a" } }, done: {} }
      },
      { guards }
    )

  /** The error a machine actor ends with, by its message and its name. */
  const errorOf = (snapshot: { readonly status: string; readonly error: Option.Option<unknown> }) => {
    assert.strictEqual(snapshot.status, "error")
    const error = Option.getOrThrow(snapshot.error)
    assert.instanceOf(error, Error)
    return { name: error.name, message: error.message }
  }

  it.live("[CONF-4] guards.evaluateGuard fails with GuardError and the stack-overflow message for a name whose implementation refers back to it through not, and or or", () =>
    Effect.gen(function* () {
      const scope: GuardScope<unknown, CycleEvent> = {
        self: {} as GuardScope<unknown, CycleEvent>["self"],
        system: {} as GuardScope<unknown, CycleEvent>["system"],
        implementations: { guards: { a: not("a"), b: and([() => true, "c"]), c: or([() => false, "b"]) } }
      }
      for (const name of ["a", "b"]) {
        const outcome = yield* guards.evaluateGuard<unknown, CycleEvent>(name, {}, { type: "EV" }, scope).pipe(
          Effect.flip,
          Effect.timeoutOption("5 seconds")
        )
        const error = Option.getOrThrow(outcome)
        assert.strictEqual(error._tag, "GuardError")
        assert.strictEqual(error.message, stackOverflow)
      }
    }))

  it.effect("[CONF-4] a transition whose guard refers back to itself through a built-in guard ends the macrostep with the guard-evaluation error around the stack-overflow message, as a cycle of names does and as upstream does", () =>
    Effect.gen(function* () {
      const expected = guardEvaluationFailed("a", "EV", "cycle.idle", stackOverflow)
      const cycles: ReadonlyArray<CycleGuards> = [
        { a: "b", b: "a" },
        { a: not("a") },
        { a: and([() => true, "b"]), b: not(or(["a"])) }
      ]
      for (const cycle of cycles) {
        const actor = yield* Effect.tap(createActor(onEvent(cycle)), (started) => started.start)
        yield* actor.send({ type: "EV" })
        assert.deepStrictEqual(errorOf(yield* actor.getSnapshot), { name: "Error", message: expected })
      }
    }))

  it.effect("[CONF-4] an eventless guard that refers back to itself sets status error: a cycle of names with upstream's RangeError, a cycle through a built-in guard with a GuardError of the same message (DEV-30)", () =>
    Effect.gen(function* () {
      const names = yield* Effect.tap(createActor(eventless({ a: "b", b: "a" })), (started) => started.start)
      assert.deepStrictEqual(errorOf(yield* names.getSnapshot), { name: "RangeError", message: stackOverflow })
      const builtIn = yield* Effect.tap(createActor(eventless({ a: not("a") })), (started) => started.start)
      assert.deepStrictEqual(errorOf(yield* builtIn.getSnapshot), { name: "Error", message: stackOverflow })
    }))
})

// ---------------------------------------------------------------- the order of the active state nodes

describe("[CONF-4] the order of the active state nodes (upstream _nodes)", () => {
  /** The ids of a snapshot's active state nodes, in the order the snapshot holds them. */
  const nodeIds = (snapshot: { readonly _nodes: ReadonlyArray<{ readonly id: string }> }) =>
    snapshot._nodes.map((stateNode) => stateNode.id)

  /**
   * A parallel root whose regions A (a1 -GO-> a2) and B (b1, b2) both take X, with tags and
   * meta on most nodes. Each X action records its region in `log`.
   */
  const regions = (log: Array<string>) =>
    createMachine({
      id: "root",
      type: "parallel",
      tags: ["root"],
      meta: { at: "root" },
      states: {
        A: {
          tags: ["A"],
          meta: { at: "A" },
          initial: "a1",
          states: {
            a1: { tags: ["a1"], on: { GO: "a2", X: { actions: () => { log.push("A x") } } } },
            a2: { tags: ["a2"], meta: { at: "a2" }, on: { X: { actions: () => { log.push("A x") } } } }
          }
        },
        B: {
          tags: ["B"],
          meta: { at: "B" },
          initial: "b1",
          states: {
            b1: { tags: ["b1"], meta: { at: "b1" }, on: { X: { actions: () => { log.push("B x") } } } },
            b2: { tags: ["b2"], on: { X: { actions: () => { log.push("B x") } } } }
          }
        }
      }
    })

  it.effect("[CONF-4] eventless transitions of two regions selected in one microstep run in the order their atomic nodes became active, so the region entered last runs last", () =>
    Effect.gen(function* () {
      const order: Array<string> = []
      const machine = createMachine({
        id: "m",
        type: "parallel",
        states: {
          A: {
            initial: "a1",
            states: {
              a1: { on: { NEXT: "a2" } },
              a2: { always: { target: "a3", actions: () => { order.push("A always") } } },
              a3: {}
            }
          },
          B: {
            initial: "b1",
            states: {
              b1: { always: { guard: stateIn("#m.A.a2"), target: "b2", actions: () => { order.push("B always") } } },
              b2: {}
            }
          }
        }
      })

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      assert.deepStrictEqual(nodeIds(yield* actor.getSnapshot), ["m", "m.A", "m.A.a1", "m.B", "m.B.b1"])
      yield* actor.send({ type: "NEXT" })
      const snapshot = yield* actor.getSnapshot
      assert.deepStrictEqual(order, ["B always", "A always"])
      assert.deepStrictEqual(nodeIds(snapshot), ["m", "m.A", "m.B", "m.A.a3", "m.B.b2"])
      assert.strictEqual(JSON.stringify(snapshot.value), `{"A":"a3","B":"b2"}`)
    }))

  it.effect("[CONF-4] after a transition inside one region, mapState, the tags and getMeta list the nodes in the order they became active, and an event both regions take runs in state value key order", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const actor = yield* Effect.tap(createActor(regions(log)), (started) => started.start)
      yield* actor.send({ type: "GO" })
      const snapshot = yield* actor.getSnapshot
      assert.deepStrictEqual(nodeIds(snapshot), ["root", "root.A", "root.B", "root.B.b1", "root.A.a2"])
      assert.deepStrictEqual(
        mapState(snapshot, {
          map: () => "root",
          states: {
            A: { map: () => "A", states: { a2: { map: () => "a2" } } },
            B: { map: () => "B", states: { b1: { map: () => "b1" } } }
          }
        }).map((result) => result.stateNode.id),
        ["root.B.b1", "root.B", "root", "root.A.a2", "root.A"]
      )
      assert.deepStrictEqual(Array.from(snapshot.tags), ["root", "A", "B", "b1", "a2"])
      assert.deepStrictEqual(Object.keys(snapshot.getMeta()), ["root", "root.A", "root.B", "root.B.b1", "root.A.a2"])
      assert.strictEqual(JSON.stringify(snapshot.value), `{"A":"a2","B":"b1"}`)
      yield* actor.send({ type: "X" })
      assert.deepStrictEqual(log, ["A x", "B x"])

      const persisted = yield* actor.getPersistedSnapshot
      const restored = yield* Effect.tap(createActor(regions(log), { snapshot: persisted }), (started) => started.start)
      assert.deepStrictEqual(nodeIds(yield* restored.getSnapshot), ["root", "root.A", "root.B", "root.A.a2", "root.B.b1"])
    }))

  it.effect("[CONF-4] resolveState lists the nodes a partial value names in upstream getStateNodes order, so its value, its tags and the transitions an event selects follow the value's keys", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = regions(log)
      const resolved = (yield* machine.resolveState({ value: { B: "b2" } }))
      assert.deepStrictEqual(nodeIds(resolved), ["root", "root.B", "root.A", "root.B.b2", "root.A.a1"])
      assert.strictEqual(JSON.stringify(resolved.value), `{"B":"b2","A":"a1"}`)
      assert.deepStrictEqual(Array.from(resolved.tags), ["root", "B", "A", "b2", "a1"])

      const actor = yield* Effect.tap(createActor(machine, { snapshot: resolved }), (started) => started.start)
      assert.deepStrictEqual(nodeIds(yield* actor.getSnapshot), ["root", "root.B", "root.A", "root.B.b2", "root.A.a1"])
      yield* actor.send({ type: "X" })
      assert.deepStrictEqual(log, ["B x", "A x"])
    }))

  it.effect("[CONF-4] a microstep that completes the machine leaves the nodes in reverse document order, so the done value of a parallel root lists its regions last to first", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "root",
        type: "parallel",
        states: {
          A: { initial: "a1", states: { a1: { on: { GO: "a2" } }, a2: { type: "final" } } },
          B: { initial: "b1", states: { b1: { on: { GO: "b2" } }, b2: { type: "final" } } }
        }
      })

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* actor.send({ type: "GO" })
      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "done")
      assert.deepStrictEqual(nodeIds(snapshot), ["root.B.b2", "root.B", "root.A.a2", "root.A", "root"])
      assert.strictEqual(JSON.stringify(snapshot.value), `{"B":"b2","A":"a2"}`)
    }))

  it.effect("[CONF-4] a history state records the exited nodes in the order they became active", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "root",
        initial: "P",
        states: {
          P: {
            type: "parallel",
            states: {
              A: { initial: "a1", states: { a1: { on: { NA: "a2" } }, a2: {} } },
              B: { initial: "b1", states: { b1: { on: { NB: "b2" } }, b2: {} } },
              H: { type: "history", history: "deep" }
            },
            on: { OUT: "#root.O" }
          },
          O: { on: { BACK: "#root.P.H" } }
        }
      })

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* actor.send({ type: "NA" })
      yield* actor.send({ type: "OUT" })
      const out = yield* actor.getSnapshot
      assert.deepStrictEqual(
        Object.fromEntries(
          Object.entries(out.historyValue).map(([id, stateNodes]) => [id, stateNodes.map((stateNode) => stateNode.id)])
        ),
        { "root.P.H": ["root.P.B.b1", "root.P.A.a2"] }
      )
      yield* actor.send({ type: "BACK" })
      const back = yield* actor.getSnapshot
      assert.deepStrictEqual(nodeIds(back), ["root", "root.P", "root.P.A", "root.P.A.a2", "root.P.B", "root.P.B.b1"])
      assert.strictEqual(JSON.stringify(back.value), `{"P":{"A":"a2","B":"b1"}}`)
    }))
})

// ---------------------------------------------------------------- the invocations of a state

describe("[CONF-4] the invocations of a state (upstream enterStates and exitStates)", () => {
  /**
   * Yields the test's fiber until `holds` is true, at most 1000 times and never on wall-clock
   * time: the invoked children run in their own fibers and reach the parent through its
   * mailbox (SD-23), where upstream delivers their events inside the parent's own call.
   */
  const settled = (holds: () => Effect.Effect<boolean>) =>
    Effect.yieldNow.pipe(Effect.repeat({ until: holds, times: 1000 }))

  /** The status of each child of a snapshot, in `children` order. */
  const childStatuses = (
    children: Readonly<Record<string, { readonly getSnapshotUntyped: Effect.Effect<{ readonly status: string }> }>>
  ) => Effect.forEach(Object.values(children), (child) => Effect.map(child.getSnapshotUntyped, (snapshot) => snapshot.status))

  /** A child machine that stays active until it is stopped. */
  const idleChild = () => createMachine({ id: "child", initial: "idle", states: { idle: {} } })

  it.effect("[CONF-4] entering a state spawns each of its invocations under the invocation's id, `<index>.<node id>` by default, named by its source name; exiting the state stops them, and entering it again spawns new ones", () =>
    Effect.gen(function* () {
      const child = idleChild()
      const machine = createMachine({
        initial: "a",
        states: {
          a: { invoke: [{ src: child }, { id: "named", src: child }], on: { NEXT: "b" } },
          b: { on: { BACK: "a" } }
        }
      })

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      const first = (yield* actor.getSnapshot).children
      assert.deepStrictEqual(Object.keys(first), ["0.(machine).a", "named"])
      assert.deepStrictEqual(Object.values(first).map((invoked) => invoked.id), ["0.(machine).a", "named"])
      assert.deepStrictEqual(Object.values(first).map((invoked) => invoked.src), [
        "xstate.invoke.0.(machine).a",
        "xstate.invoke.1.(machine).a"
      ])
      assert.deepStrictEqual(yield* childStatuses(first), ["active", "active"])
      // the source name is what the persisted snapshot keeps, so a restore finds the logic
      const persisted = (yield* actor.getPersistedSnapshot) as {
        readonly children: Readonly<Record<string, { readonly src: unknown }>>
      }
      assert.deepStrictEqual(
        Object.entries(persisted.children).map(([id, entry]) => [id, entry.src]),
        [["0.(machine).a", "xstate.invoke.0.(machine).a"], ["named", "xstate.invoke.1.(machine).a"]]
      )

      yield* actor.send({ type: "NEXT" })
      assert.deepStrictEqual(Object.keys((yield* actor.getSnapshot).children), [])
      assert.deepStrictEqual(yield* childStatuses(first), ["stopped", "stopped"])

      yield* actor.send({ type: "BACK" })
      const again = (yield* actor.getSnapshot).children
      assert.deepStrictEqual(Object.keys(again), ["0.(machine).a", "named"])
      assert.notStrictEqual(again["0.(machine).a"], first["0.(machine).a"])
      assert.deepStrictEqual(yield* childStatuses(again), ["active", "active"])
    }))

  it.effect("[CONF-4] the done event of an invoked child takes the invocation's onDone transition once, with the child's output", () =>
    Effect.gen(function* () {
      const calls: Array<unknown> = []
      const child = createMachine({ initial: "done", states: { done: { type: "final" } }, output: 42 })
      const machine = createMachine({
        initial: "a",
        states: {
          a: { invoke: { src: child, onDone: { target: "b", actions: ({ event }) => { calls.push(event) } } } },
          b: {}
        }
      })

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* settled(() => Effect.map(actor.getSnapshot, (snapshot) => snapshot.value === "b"))
      assert.strictEqual((yield* actor.getSnapshot).value, "b")
      assert.deepStrictEqual(calls, [
        { type: "xstate.done.actor.0.(machine).a", output: Option.some(42), actorId: "0.(machine).a" }
      ])
    }))

  it.effect("[CONF-4] a child sends to `#_parent`, the parent sends to the child as `#_<id>`, and the child's done event takes an on descriptor `xstate.done.actor.<id>` (the SCXML I/O processor and `done.invoke.<id>`)", () =>
    Effect.gen(function* () {
      const calls: Array<string> = []
      const child = createMachine({
        initial: "sub0",
        states: {
          sub0: { entry: sendTo("#_parent", { type: "childToParent" }), on: { parentToChild: "subFinal" } },
          subFinal: { type: "final" }
        }
      })
      const machine = createMachine({
        initial: "s0",
        states: {
          s0: {
            initial: "s01",
            invoke: { id: "child", src: child },
            states: {
              s01: { on: { childToParent: "s02" } },
              s02: {
                entry: sendTo("#_child", { type: "parentToChild" }),
                on: { "xstate.done.actor.child": { target: "#pass", actions: () => { calls.push("done") } } }
              }
            }
          },
          pass: { id: "pass", type: "final" }
        }
      })

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* settled(() => Effect.map(actor.getSnapshot, (snapshot) => snapshot.status === "done"))
      const snapshot = yield* actor.getSnapshot
      assert.deepStrictEqual([snapshot.status, snapshot.value], ["done", "pass"])
      assert.deepStrictEqual(calls, ["done"])
    }))

  it.effect("[CONF-4] an invocation with onSnapshot syncs the child's snapshots: the one the child starts with, then each later one", () =>
    Effect.gen(function* () {
      const seen: Array<readonly [string, unknown]> = []
      const child = createMachine({ initial: "one", states: { one: { on: { NEXT: "two" } }, two: {} } })
      const machine = createMachine({
        initial: "a",
        states: {
          a: {
            invoke: {
              id: "c",
              src: child,
              onSnapshot: { actions: ({ event }) => { seen.push([event.type, event.snapshot.value]) } }
            },
            on: { FWD: { actions: sendTo("c", { type: "NEXT" }) } }
          }
        }
      })

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* settled(() => Effect.succeed(seen.length >= 1))
      assert.deepStrictEqual(seen, [["xstate.snapshot.c", "one"]])
      yield* actor.send({ type: "FWD" })
      yield* settled(() => Effect.succeed(seen.length >= 2))
      assert.deepStrictEqual(seen, [["xstate.snapshot.c", "one"], ["xstate.snapshot.c", "two"]])
    }))

  it.effect("[CONF-4] a function input of an invocation reads the parent's context and the event that enters the invoking state", () =>
    Effect.gen(function* () {
      const child = createMachine({
        types: {} as { context: { readonly got: unknown }; input: unknown },
        context: ({ input }) => ({ got: input }),
        initial: "idle",
        states: { idle: {} }
      })
      const machine = createMachine({
        context: { n: 7 },
        initial: "a",
        states: {
          a: { on: { GO: "b" } },
          b: {
            invoke: {
              id: "c",
              src: child,
              input: ({ context, event }) => ({
                n: context.n,
                by: event.type
              })
            }
          }
        }
      })

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* actor.send({ type: "GO" })
      const invoked = (yield* actor.getSnapshot).children["c"]
      assert.isDefined(invoked)
      const childSnapshot = (yield* invoked!.getSnapshotUntyped) as unknown as { readonly context: unknown }
      assert.deepStrictEqual(childSnapshot.context, { got: { n: 7, by: "GO" } })
    }))

  it.effect("[CONF-4] a transition to a top-level final state exits the invoking state, so the done snapshot has no children and the child is stopped", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        initial: "a",
        states: {
          a: { invoke: { id: "c", src: idleChild() }, on: { END: "end" } },
          end: { type: "final" }
        }
      })

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      const children = (yield* actor.getSnapshot).children
      assert.deepStrictEqual(Object.keys(children), ["c"])
      yield* actor.send({ type: "END" })
      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "done")
      assert.deepStrictEqual(Object.keys(snapshot.children), [])
      assert.deepStrictEqual(yield* childStatuses(children), ["stopped"])
    }))

  it.effect("[CONF-4] an invoked child of the initial state starts before the parent runs its initial entry and initial-transition actions", () =>
    Effect.gen(function* () {
      const order: Array<string> = []
      const child = createMachine({ entry: () => { order.push("child entry") }, initial: "idle", states: { idle: {} } })
      const machine = createMachine({
        initial: "a",
        states: {
          a: {
            entry: [() => { order.push("a entry") }],
            invoke: { id: "c", src: child },
            initial: { target: "a1", actions: () => { order.push("a initial") } },
            states: { a1: { entry: () => { order.push("a1 entry") } } }
          }
        }
      })

      yield* Effect.tap(createActor(machine), (started) => started.start)
      assert.deepStrictEqual(order, ["child entry", "a entry", "a initial", "a1 entry"])
    }))
})

// ---------------------------------------------------------------- the logger actor option

describe("[CONF-4] the logger actor option (its type)", () => {
  it.effect("[CONF-4] createActor takes a logger of any function form, as upstream types it (`(...args: any[]) => void`), and nothing else", () =>
    Effect.gen(function* () {
      const machine = createMachine({ initial: "idle", states: { idle: {} } })
      const lines: Array<string> = []
      yield* createActor(machine, { logger: () => void 0 })
      yield* createActor(machine, { logger: (line: string) => { lines.push(line) } })
      yield* createActor(machine, { logger: (...args: ReadonlyArray<unknown>) => { lines.push(String(args.length)) } })
      // @ts-expect-error a logger is a function
      yield* createActor(machine, { logger: "console" })
      // no log action ran, so no logger was called
      assert.deepStrictEqual(lines, [])
    }))
})

// ---------------------------------------------------------------- the ActorRefFrom type

/** The reference of a logic's snapshot, events and emitted events (upstream `ActorRefFromLogic`). */
type RefOfLogic<L> = ActorRefType<ActorLogic.SnapshotOf<L>, ActorLogic.EventOf<L>, ActorLogic.EmittedOf<L>>

describe("[CONF-4] the ActorRefFrom type (upstream ActorRefFrom)", () => {
  it.effect("[CONF-4] ActorRefFrom of a machine is the reference of its snapshot, its events and its emitted events, which a context factory's spawn gives for it", () =>
    Effect.gen(function* () {
      const child = createMachine({
        types: {} as { context: { n: number }; events: { type: "INC" } | { type: "DEC" }; emitted: { type: "PING" } },
        context: { n: 0 }
      })
      typeHolds<Equals<ActorRefFrom<typeof child>, ActorRefType<ActorLogic.SnapshotOf<typeof child>, { type: "INC" } | { type: "DEC" }, { type: "PING" }>>>(true)
      typeHolds<Equals<Parameters<ActorRefFrom<typeof child>["send"]>[0], { type: "INC" } | { type: "DEC" }>>(true)
      const other = createMachine({ types: {} as { events: { type: "OTHER" } } })
      // @ts-expect-error a machine with other events gives another reference
      typeHolds<Equals<ActorRefFrom<typeof other>, ActorRefFrom<typeof child>>>(true)
      const machine = createMachine({
        types: {} as { context: { ref: ActorRefFrom<typeof child> } },
        context: ({ spawn }) => {
          const ref = spawn(child, { id: "child" })
          typeHolds<Equals<typeof ref, ActorRefFrom<typeof child>>>(true)
          return { ref }
        }
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.context.ref, snapshot.children.child)
    }))

  it.effect("[CONF-4] ActorRefFrom of a function is the reference of what it returns, of a Promise the reference of a promise logic with that value, and of anything else never", () =>
    Effect.sync(() => {
      const child = createMachine({ types: {} as { events: { type: "INC" } } })
      typeHolds<Equals<ActorRefFrom<() => typeof child>, ActorRefFrom<typeof child>>>(true)
      typeHolds<Equals<ActorRefFrom<Promise<number>>, ActorRefFrom<PromiseActorLogic<number>>>>(true)
      typeHolds<Equals<ActorRefFrom<Promise<number>>, RefOfLogic<PromiseActorLogic<number>>>>(true)
      typeHolds<Equals<ActorRefFrom<string>, never>>(true)
      typeHolds<Equals<ActorRefFrom<{ readonly n: number }>, never>>(true)
    }))

  it.effect("[CONF-4] ActorRefFrom of a promise, observable or transition logic is the reference of that logic's snapshot, events and emitted events", () =>
    Effect.sync(() => {
      const double = fromPromise(({ input }: { input: number }) => Promise.resolve(input * 2))
      typeHolds<Equals<ActorRefFrom<typeof double>, RefOfLogic<typeof double>>>(true)
      typeHolds<Equals<ActorRefFrom<ObservableActorLogic<number>>, RefOfLogic<ObservableActorLogic<number>>>>(true)
      type Add = { readonly type: "ADD"; readonly n: number }
      typeHolds<Equals<ActorRefFrom<TransitionActorLogic<number, Add>>, RefOfLogic<TransitionActorLogic<number, Add>>>>(true)
      typeHolds<Equals<Parameters<ActorRefFrom<TransitionActorLogic<number, Add>>["send"]>[0], Add>>(true)
    }))
})

// ---------------------------------------------------------------- spawnChild with a named src

/** The input an active child holds in its snapshot (a promise child keeps it while active). */
const inputOf = (child: ActorRefBase | undefined) =>
  Effect.gen(function* () {
    assert.isDefined(child, "the child is in snapshot.children")
    const snapshot = yield* child!.getSnapshotUntyped
    assert.strictEqual(snapshot.status, "active")
    return Reflect.get(snapshot, "input")
  })

describe("[CONF-4] the input of a spawnChild with a named src (upstream SpawnArguments)", () => {
  it.effect("[CONF-4] a named src that the machine's types declare takes the declared logic's input, as a value or as a function of the action context, and the child starts with it (upstream spawnChild.test 40)", () =>
    Effect.gen(function* () {
      // never settles, so the child stays active and keeps its input
      const pending = fromPromise(({ input }: { input: number }) => new Promise<number>(() => void input))
      const machine = createMachine({
        types: {} as { context: { readonly n: number }; actors: { src: "pending"; logic: typeof pending } },
        context: { n: 4 },
        entry: [
          spawnChild("pending", { id: "value", input: 21 }),
          spawnChild("pending", {
            id: "fn",
            input: ({ context }) => {
              typeHolds<Equals<typeof context, { readonly n: number }>>(true)
              return context.n * 2
            }
          })
        ]
      }).provide({ actors: { pending } })
      const actor = yield* createActor(machine)
      yield* actor.start
      const children = (yield* actor.getSnapshot).children
      assert.strictEqual(yield* inputOf(children["value"]), 21)
      assert.strictEqual(yield* inputOf(children["fn"]), 8)
    }))

  it.effect("[CONF-4] a named src of a machine whose types declare no actors, and a spawnChild written outside a machine, take any input; an input function there gets no contextual type, so its unannotated parameter is an implicit any, and it reads the action context at run time (upstream input?: unknown)", () =>
    Effect.gen(function* () {
      const echo = fromPromise(({ input }: { input: unknown }) => new Promise<unknown>(() => void input))
      const machine = createMachine(
        {
          context: { n: 3 },
          on: {
            GO: {
              actions: [
                spawnChild("echo", { id: "value", input: "anything" }),
                spawnChild("echo", {
                  id: "fn",
                  // @ts-expect-error upstream's input?: unknown gives this function no contextual type (TS7031, an implicit any)
                  input: ({ context, event }) => ({ n: context.n, by: event.type })
                })
              ]
            }
          }
        },
        { actors: { echo } }
      )
      const actor = yield* createActor(machine)
      yield* actor.start
      yield* actor.send({ type: "GO" })
      const children = (yield* actor.getSnapshot).children
      assert.strictEqual(yield* inputOf(children["value"]), "anything")
      assert.deepStrictEqual(yield* inputOf(children["fn"]), { n: 3, by: "GO" })
      const outside = spawnChild("echo", { input: { any: ["shape"] } })
      assert.strictEqual(outside.type, "xstate.spawnChild")
    }))
})

describe("[CONF-4] the input of a spawnChild with an inline logic src (upstream SpawnArguments)", () => {
  it.effect("[CONF-4] an inline logic src takes any input, not its logic's input type, in spawnChild, enqueue.spawnChild, a machine that declares its actors and a setup's spawnChild; in a plain machine its input function gets no contextual type (upstream src: AnyActorLogic, input?: unknown)", () =>
    Effect.gen(function* () {
      // takes a number and never settles, so each child stays active and keeps its input
      const pending = fromPromise(({ input }: { input: number }) => new Promise<number>(() => void input))
      const plain = createMachine({
        context: { n: 4 },
        entry: [
          spawnChild(pending, { id: "value", input: "a string" }),
          spawnChild(pending, {
            id: "fn",
            // @ts-expect-error upstream's input?: unknown gives this function no contextual type (TS7031, an implicit any)
            input: ({ context }) => `n=${context.n}`
          }),
          enqueueActions(({ enqueue }) => {
            enqueue.spawnChild(pending, { id: "enqueued", input: { not: "a number" } })
          })
        ]
      })
      const declared = createMachine({
        types: {} as { actors: { src: "pending"; logic: typeof pending } },
        entry: spawnChild(pending, { input: "declared" })
      })
      const bound = setup({ actors: { pending } })
      const fromSetup = bound.createMachine({ entry: bound.spawnChild(pending, { input: "setup" }) })

      const plainChildren = (yield* (yield* Effect.tap(createActor(plain), (actor) => actor.start)).getSnapshot).children
      assert.strictEqual(yield* inputOf(plainChildren["value"]), "a string")
      assert.strictEqual(yield* inputOf(plainChildren["fn"]), "n=4")
      assert.deepStrictEqual(yield* inputOf(plainChildren["enqueued"]), { not: "a number" })
      const declaredChildren = (yield* (yield* Effect.tap(createActor(declared), (actor) => actor.start)).getSnapshot).children
      assert.strictEqual(yield* inputOf(declaredChildren["undefined"]), "declared")
      const setupChildren = (yield* (yield* Effect.tap(createActor(fromSetup), (actor) => actor.start)).getSnapshot).children
      assert.strictEqual(yield* inputOf(setupChildren["undefined"]), "setup")
    }))

  it.effect("[CONF-4] the input function of an inline logic gets the action context type only where the machine declares its actors; in a plain machine's enqueue.spawnChild and in a setup without actors (its spawnChild and the module spawnChild) it gets no contextual type, and it reads the action context at run time (upstream SpawnArguments)", () =>
    Effect.gen(function* () {
      // takes a number and never settles, so each child stays active and keeps its input
      const pending = fromPromise(({ input }: { input: number }) => new Promise<number>(() => void input))
      const declared = createMachine({
        types: {} as { context: { n: number }; actors: { src: "pending"; logic: typeof pending } },
        context: { n: 5 },
        entry: spawnChild(pending, {
          input: ({ context }) => {
            typeHolds<Equals<typeof context, { n: number }>>(true)
            return context.n
          }
        })
      })
      const enqueued = createMachine({
        context: { n: 6 },
        entry: enqueueActions(({ enqueue }) => {
          enqueue.spawnChild(pending, {
            // @ts-expect-error upstream's input?: unknown gives this function no contextual type (TS7031, an implicit any)
            input: ({ context }) => context.n
          })
        })
      })
      const bare = setup({ types: { context: {} as { n: number } } })
      const fromBound = bare.createMachine({
        context: { n: 7 },
        entry: bare.spawnChild(pending, {
          // @ts-expect-error upstream's DistributeActors of no actor leaves an any input, so this function has no contextual type (TS7031)
          input: ({ context }) => context.n
        })
      })
      const fromModule = bare.createMachine({
        context: { n: 8 },
        entry: spawnChild(pending, {
          // @ts-expect-error upstream's DistributeActors of no actor leaves an any input, so this function has no contextual type (TS7031)
          input: ({ context }) => context.n
        })
      })

      const declaredChildren = (yield* (yield* Effect.tap(createActor(declared), (actor) => actor.start)).getSnapshot).children
      assert.strictEqual(yield* inputOf(declaredChildren["undefined"]), 5)
      const enqueuedChildren = (yield* (yield* Effect.tap(createActor(enqueued), (actor) => actor.start)).getSnapshot).children
      assert.strictEqual(yield* inputOf(enqueuedChildren["undefined"]), 6)
      const boundChildren = (yield* (yield* Effect.tap(createActor(fromBound), (actor) => actor.start)).getSnapshot).children
      assert.strictEqual(yield* inputOf(boundChildren["undefined"]), 7)
      const moduleChildren = (yield* (yield* Effect.tap(createActor(fromModule), (actor) => actor.start)).getSnapshot).children
      assert.strictEqual(yield* inputOf(moduleChildren["undefined"]), 8)
    }))
})

/** Runs `program` with a logger that keeps the text of every warning in `warnings`. */
const keepingWarnings = (warnings: Array<string>) =>
  Effect.provide(
    Logger.layer([
      Logger.make((options) => {
        if (options.logLevel === "Warn") {
          const parts: ReadonlyArray<unknown> = Array.isArray(options.message) ? options.message : [options.message]
          warnings.push(parts.map(String).join(" "))
        }
      })
    ])
  )

describe("[CONF-4] a spawnChild src that names no actor (DEV-31)", () => {
  it.effect("[CONF-4] a src that names no actor warns with upstream's message and adds no entry to snapshot.children, at the initial entry and on an event; the actor stays active and its persisted snapshot holds no child (upstream stores undefined under the id)", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "conf4-missing",
        entry: spawnChild("missing", { id: "first" }),
        on: { GO: { actions: spawnChild("missing", { id: "second" }) } }
      })
      const warnings: Array<string> = []
      const { atStart, afterEvent, persisted } = yield* keepingWarnings(warnings)(
        Effect.gen(function* () {
          const actor = yield* createActor(machine, { id: "conf4-parent" })
          yield* actor.start
          const atStart = yield* actor.getSnapshot
          yield* actor.send({ type: "GO" })
          const afterEvent = yield* actor.getSnapshot
          const persisted = yield* actor.getPersistedSnapshot
          return { atStart, afterEvent, persisted }
        })
      )
      assert.strictEqual(atStart.status, "active")
      assert.deepStrictEqual(Object.keys(atStart.children), [])
      assert.strictEqual(afterEvent.status, "active")
      assert.deepStrictEqual(Object.keys(afterEvent.children), [])
      assert.deepStrictEqual(Reflect.get(Object(persisted), "children"), {})
      assert.deepStrictEqual(
        warnings.filter((warning) => warning.startsWith("Actor type")),
        [actorTypeNotFound("missing", "conf4-parent"), actorTypeNotFound("missing", "conf4-parent")]
      )
    }))
})
