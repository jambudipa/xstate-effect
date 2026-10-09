/**
 * S9: every target form resolves relative to its source.
 *
 * T2.34. Upstream `resolveTarget`, `getStateNodeByPath` and `getStateNode` in
 * `src/stateUtils.ts`, and `StateMachine.getStateNodeById` in `src/StateMachine.ts`, at
 * xstate@5.33.2: a `#id` target (optionally followed by a key path) resolves by id; a
 * `.child` target resolves below the source; any other target resolves below the source's
 * parent; a target on the root must start with `.` or `#`. A target that does not resolve
 * is a `createMachine` definition error with the upstream message, a
 * `MachineDefinitionError` (SD-3, amended 2026-10-08; DEV-72): the machine keeps the first
 * one in upstream order, on any node, entered or not, and each Effect that computes a
 * snapshot of it fails with it. The machine follows eque2-reference §6.4.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import {
  ActorScope,
  type ActorLogicType,
  createActor,
  createMachine,
  Errors,
  type EventObject,
  getInitialSnapshot,
  getNextSnapshot,
  getTransitions,
  type MachineConfig,
  type MachineSnapshot,
} from "../../src/index.js"
import { createInertActorScope } from "../../src/testing/getNextSnapshot.js"
import {
  childStateDoesNotExist,
  childStateNodeDoesNotExist,
  invalidTargetFromRoot,
  invalidTransitionDefinition,
  legacyCond,
  noInitialState,
} from "./upstream-messages.js"

/** The initial snapshot through `getInitialSnapshot`, widened until T2.40 (as S2 and S3 do). */
const initialSnapshotOf = (machine: object): Effect.Effect<MachineSnapshot> =>
  getInitialSnapshot(machine as ActorLogicType.Any, undefined) as unknown as Effect.Effect<MachineSnapshot>

/** The next snapshot through `getNextSnapshot` (same widening). */
const nextSnapshotOf = (machine: object, snapshot: MachineSnapshot, event: EventObject): Effect.Effect<MachineSnapshot> =>
  getNextSnapshot(machine as ActorLogicType.Any, snapshot, event) as unknown as Effect.Effect<MachineSnapshot>

/**
 * The message of the definition error that `createMachine(config)` keeps (SD-3, amended
 * 2026-10-08), or none for a valid config: the machine's initial snapshot fails with an
 * `InitializationError` of the upstream message, whose cause is the `MachineDefinitionError`.
 */
const definitionErrorOf = (config: MachineConfig<object, EventObject>): Effect.Effect<Option.Option<string>> =>
  getInitialSnapshot(createMachine(config)).pipe(
    Effect.as(Option.none<string>()),
    Effect.catch((error) =>
      Effect.sync(() => {
        assert.instanceOf(error, Errors.InitializationError)
        assert.instanceOf(error.cause, Errors.MachineDefinitionError)
        return Option.some(error.message)
      })
    )
  )

/**
 * Machine `m` (eque2-reference §6.4): `p (initial q) › q (initial q1) › q1 | q2`, `p › r`,
 * and a root state `z` with the custom id `custom`.
 */
const targetsMachine = () =>
  createMachine({
    id: "m",
    initial: "p",
    context: {},
    on: { GO_Z: ".z" },
    states: {
      p: {
        initial: "q",
        states: {
          q: {
            initial: "q1",
            on: { PARENT_SIB: "r", TO_CHILD: ".q2" },
            states: {
              q1: {
                on: {
                  SIB: "q2",
                  BY_ID: "#m.z",
                  BY_ID_PATH: "#m.p.r",
                  CUSTOM: "#custom",
                  CUSTOM_PATH: "#custom.c2",
                },
              },
              q2: {},
            },
          },
          r: {},
        },
      },
      z: { id: "custom", initial: "c1", states: { c1: {}, c2: {} } },
    },
  })

/**
 * Machine `m`: `a` (initial, `GO` to `b`) and `b`, whose `on` record is `onB`. The initial
 * snapshot enters only `a`.
 */
const offPathConfig = (onB: Readonly<Record<string, string>>): MachineConfig<object, EventObject> => ({
  id: "m",
  initial: "a",
  context: {},
  states: { a: { on: { GO: "b" } }, b: { on: onB } },
})

describe("S9 every target form resolves relative to its source", () => {
  it.effect("[S9] a sibling from a nested state, .child, #id, #machine.path and a custom id each enter the intended state", () =>
    Effect.gen(function* () {
      const machine = targetsMachine()
      const initial = yield* initialSnapshotOf(machine)
      assert.deepStrictEqual(initial.value, { p: { q: "q1" } })

      const cases: ReadonlyArray<readonly [string, unknown]> = [
        ["SIB", { p: { q: "q2" } }],
        ["PARENT_SIB", { p: "r" }],
        ["TO_CHILD", { p: { q: "q2" } }],
        ["BY_ID", { z: "c1" }],
        ["BY_ID_PATH", { p: "r" }],
        ["CUSTOM", { z: "c1" }],
        ["CUSTOM_PATH", { z: "c2" }],
        ["GO_Z", { z: "c1" }],
      ]
      for (const [type, value] of cases) {
        const next = yield* nextSnapshotOf(machine, initial, { type })
        assert.deepStrictEqual(next.value, value, type)
      }
    })
  )

  it.effect("[S9] each target resolves to its node at createMachine", () =>
    Effect.sync(() => {
      const machine = targetsMachine()
      const q = machine.root.states["p"]!.states["q"]!
      const q1 = q.states["q1"]!
      const targetIds = (node: typeof q, eventType: string): ReadonlyArray<string> =>
        [...getTransitions(node, eventType)].flatMap((transition) =>
          (transition.target ?? []).map((target) => target.id)
        )

      assert.deepStrictEqual(targetIds(q1, "SIB"), ["m.p.q.q2"])
      assert.deepStrictEqual(targetIds(q, "PARENT_SIB"), ["m.p.r"])
      assert.deepStrictEqual(targetIds(q, "TO_CHILD"), ["m.p.q.q2"])
      assert.deepStrictEqual(targetIds(q1, "BY_ID"), ["custom"])
      assert.deepStrictEqual(targetIds(q1, "BY_ID_PATH"), ["m.p.r"])
      assert.deepStrictEqual(targetIds(q1, "CUSTOM"), ["custom"])
      assert.deepStrictEqual(targetIds(q1, "CUSTOM_PATH"), ["m.z.c2"])
      assert.deepStrictEqual(targetIds(machine.root, "GO_Z"), ["custom"])
    })
  )

  it.effect("[S9] getStateNodeById finds the node by its custom id", () =>
    Effect.gen(function* () {
      const machine = targetsMachine()
      const node = yield* machine.getStateNodeById("custom")
      assert.strictEqual(node, machine.root.states["z"])
      assert.deepStrictEqual(node.path, ["z"])

      const deep = yield* machine.getStateNodeById("m.p.q.q1")
      assert.strictEqual(deep.key, "q1")
    })
  )

  it.effect("[S9] a sibling target that names no state is a createMachine definition error with the recorded message", () =>
    Effect.gen(function* () {
      const unknownSibling = yield* definitionErrorOf({
        id: "m",
        initial: "p",
        context: {},
        states: { p: { initial: "q1", states: { q1: { on: { E: "nope" } }, q2: {} } } },
      })
      assert.deepStrictEqual(
        unknownSibling,
        Option.some(invalidTransitionDefinition("m.p.q1", childStateDoesNotExist("nope", "m.p")))
      )

      // A root key is not a sibling of a nested state: it needs `#m.z`.
      const rootKey = yield* definitionErrorOf({
        id: "m",
        initial: "p",
        context: {},
        states: { p: { initial: "q1", states: { q1: { on: { E: "z" } } } }, z: {} },
      })
      assert.deepStrictEqual(rootKey, Option.some(invalidTransitionDefinition("m.p.q1", childStateDoesNotExist("z", "m.p"))))

      // `.q2` is a child of the atomic source, which has none.
      const childOfAtomic = yield* definitionErrorOf({
        id: "m",
        initial: "p",
        context: {},
        states: { p: { initial: "q1", states: { q1: { on: { E: ".q2" } }, q2: {} } } },
      })
      assert.deepStrictEqual(
        childOfAtomic,
        Option.some(invalidTransitionDefinition("m.p.q1", childStateDoesNotExist("q2", "m.p.q1")))
      )

      // One bad target in a target list rejects the whole machine.
      const inList = yield* definitionErrorOf({
        id: "m",
        initial: "a",
        context: {},
        states: { a: { on: { E: { target: ["b", "nope"] } } }, b: {} },
      })
      assert.deepStrictEqual(inList, Option.some(invalidTransitionDefinition("m.a", childStateDoesNotExist("nope", "m"))))

      // Eventless targets resolve (and fail) the same way.
      const eventless = yield* definitionErrorOf({
        id: "m",
        initial: "a",
        context: {},
        states: { a: { always: { target: "nope" } } },
      })
      assert.deepStrictEqual(eventless, Option.some(invalidTransitionDefinition("m.a", childStateDoesNotExist("nope", "m"))))
    })
  )

  it.effect("[S9] an unknown #id is a createMachine definition error with the recorded message", () =>
    Effect.gen(function* () {
      const unknownId = yield* definitionErrorOf({
        id: "m",
        initial: "a",
        context: {},
        states: { a: { on: { E: "#missing" } }, b: {} },
      })
      assert.deepStrictEqual(unknownId, Option.some(childStateNodeDoesNotExist("missing", "m")))

      // A known id followed by a key that names no child.
      const badPath = yield* definitionErrorOf({
        id: "m",
        initial: "a",
        context: {},
        states: { a: { on: { E: "#m.nope" } }, b: {} },
      })
      assert.deepStrictEqual(badPath, Option.some(childStateDoesNotExist("nope", "m")))
    })
  )

  it.effect("[S9] an unknown target or #id on a state the initial snapshot does not enter is a createMachine definition error with the recorded message", () =>
    Effect.gen(function* () {
      // Upstream `createMachine` resolves the targets of every node, so a bad target on a state
      // that is never entered still rejects the machine; xstate 5.33.2 throws each message below
      const unknownSibling = yield* definitionErrorOf({
        id: "m",
        initial: "a",
        context: {},
        states: { a: {}, b: { on: { E: "nope" } } },
      })
      assert.deepStrictEqual(unknownSibling, Option.some(invalidTransitionDefinition("m.b", childStateDoesNotExist("nope", "m"))))

      const deepSibling = yield* definitionErrorOf({
        id: "m",
        initial: "a",
        context: {},
        states: { a: {}, b: { initial: "b1", states: { b1: {}, b2: { on: { E: "nope" } } } } },
      })
      assert.deepStrictEqual(
        deepSibling,
        Option.some(invalidTransitionDefinition("m.b.b2", childStateDoesNotExist("nope", "m.b")))
      )

      const deepUnknownId = yield* definitionErrorOf({
        id: "m",
        initial: "a",
        context: {},
        states: { a: {}, b: { initial: "b1", states: { b1: {}, b2: { on: { E: "#missing" } } } } },
      })
      assert.deepStrictEqual(deepUnknownId, Option.some(childStateNodeDoesNotExist("missing", "m")))

      const deepBadPath = yield* definitionErrorOf({
        id: "m",
        initial: "a",
        context: {},
        states: { a: {}, b: { initial: "b1", states: { b1: {}, b2: { on: { E: "#m.b.nope" } } } } },
      })
      assert.deepStrictEqual(deepBadPath, Option.some(childStateDoesNotExist("nope", "m.b")))
    })
  )

  it.effect("[S9] each Effect that computes a snapshot of a machine with a definition error fails with it, and its actor has status error", () =>
    Effect.gen(function* () {
      // The only bad target sits on `b`, which the initial snapshot does not enter; xstate
      // 5.33.2 `createMachine` throws this message for the config
      const message = invalidTransitionDefinition("m.b", childStateDoesNotExist("nope", "m"))
      const invalid = createMachine(offPathConfig({ E: "nope" }))
      // A snapshot of state `a` and its persisted form, from the same machine without the bad target
      const valid = createMachine(offPathConfig({}))
      const snapshot = yield* valid.resolveState({ value: "a" })
      const persisted = yield* valid.getPersistedSnapshot(snapshot)
      const inert = createInertActorScope(snapshot)
      const event: EventObject = { type: "GO" }

      // restoreSnapshot fails with a RestoreError
      const restoreError = yield* Effect.flip(invalid.restoreSnapshot(persisted).pipe(Effect.provideService(ActorScope, inert)))
      assert.instanceOf(restoreError, Errors.RestoreError)
      assert.strictEqual(restoreError.message, message)
      assert.instanceOf(restoreError.cause, Errors.MachineDefinitionError)
      assert.strictEqual(restoreError.cause.message, message)

      // transition and microstep fail with a TransitionError
      const transitionError = yield* Effect.flip(invalid.transition(snapshot, event).pipe(Effect.provideService(ActorScope, inert)))
      assert.instanceOf(transitionError, Errors.TransitionError)
      assert.strictEqual(transitionError.message, message)
      assert.instanceOf(transitionError.cause, Errors.MachineDefinitionError)
      assert.strictEqual(transitionError.cause.message, message)

      const microstepError = yield* Effect.flip(invalid.microstep(snapshot, event).pipe(Effect.provideService(ActorScope, inert)))
      assert.instanceOf(microstepError, Errors.TransitionError)
      assert.strictEqual(microstepError.message, message)
      assert.instanceOf(microstepError.cause, Errors.MachineDefinitionError)
      assert.strictEqual(microstepError.cause.message, message)

      // resolveState and getTransitionData fail with the MachineDefinitionError itself
      const resolveError = yield* Effect.flip(invalid.resolveState({ value: "a" }))
      assert.instanceOf(resolveError, Errors.MachineDefinitionError)
      assert.strictEqual(resolveError.message, message)

      const dataError = yield* Effect.flip(invalid.getTransitionData(snapshot, event))
      assert.instanceOf(dataError, Errors.MachineDefinitionError)
      assert.strictEqual(dataError.message, message)

      // createActor keeps its signature: the actor has status error with the InitializationError
      const actor = yield* createActor(invalid)
      const actorSnapshot = yield* actor.getSnapshot
      assert.strictEqual(actorSnapshot.status, "error")
      const actorError = Option.getOrUndefined(actorSnapshot.error)
      assert.instanceOf(actorError, Errors.InitializationError)
      assert.strictEqual(actorError.message, message)
      assert.instanceOf(actorError.cause, Errors.MachineDefinitionError)
      assert.strictEqual(actorError.cause.message, message)
    })
  )

  it.effect("[S9] of several definition errors the machine keeps the first in upstream order: missing initial states as upstream builds the nodes, each node's targets in document order, the route transitions, then history targets", () =>
    Effect.gen(function* () {
      // Each expected message is the one xstate 5.33.2 `createMachine` throws for the config.
      // A missing `initial` comes before any target, even one earlier in the document.
      const initialFirst = yield* definitionErrorOf({
        id: "m",
        initial: "a",
        context: {},
        states: { a: { on: { E: "nope" } }, b: { states: { b1: {} } } },
      })
      assert.deepStrictEqual(initialFirst, Option.some(noInitialState("m.b", "b1")))

      // Upstream checks a node after its children: the deepest of a branch comes first
      const deepestFirst = yield* definitionErrorOf({
        id: "m",
        initial: "a",
        context: {},
        states: { a: { states: { a1: { states: { x: {} } } } } },
      })
      assert.deepStrictEqual(deepestFirst, Option.some(noInitialState("m.a.a1", "x")))

      // ... and an earlier branch comes before a deeper node of a later one
      const earlierBranchFirst = yield* definitionErrorOf({
        id: "m",
        initial: "a",
        context: {},
        states: { a: { states: { a1: {} } }, b: { initial: "b1", states: { b1: { states: { x: {} } } } } },
      })
      assert.deepStrictEqual(earlierBranchFirst, Option.some(noInitialState("m.a", "a1")))

      // The targets of the nodes in document order: an earlier sibling first ...
      const earlierSiblingFirst = yield* definitionErrorOf({
        id: "m",
        initial: "a",
        context: {},
        states: { a: { on: { E: "nope1" } }, b: { on: { E: "nope2" } } },
      })
      assert.deepStrictEqual(
        earlierSiblingFirst,
        Option.some(invalidTransitionDefinition("m.a", childStateDoesNotExist("nope1", "m")))
      )

      // ... and a parent before its children
      const parentFirst = yield* definitionErrorOf({
        id: "m",
        initial: "a",
        context: {},
        states: { a: {}, b: { initial: "b1", on: { E: "nope2" }, states: { b1: { on: { E: "nope3" } } } } },
      })
      assert.deepStrictEqual(parentFirst, Option.some(invalidTransitionDefinition("m.b", childStateDoesNotExist("nope2", "m"))))

      // The route transitions come after every node's targets. A route targets its own node by
      // id, so only a legacy `cond` fails there; the type of a route config has no `cond`, and
      // upstream's run-time check reads it
      const targetsBeforeRoute = yield* definitionErrorOf({
        id: "m",
        initial: "a",
        context: {},
        states: { a: { id: "ra", route: { ...({ cond: "x" } as object) } }, b: { on: { E: "nope" } } },
      })
      assert.deepStrictEqual(
        targetsBeforeRoute,
        Option.some(invalidTransitionDefinition("m.b", childStateDoesNotExist("nope", "m")))
      )

      // A history target comes after every transition target and route, even ones later in the
      // document (upstream resolves it only when the history state is entered)
      const targetsBeforeHistory = yield* definitionErrorOf({
        id: "m",
        initial: "a",
        context: {},
        states: {
          a: { initial: "a1", states: { a1: {}, h: { type: "history", target: "missing" } } },
          b: { on: { E: "nope" } },
        },
      })
      assert.deepStrictEqual(
        targetsBeforeHistory,
        Option.some(invalidTransitionDefinition("m.b", childStateDoesNotExist("nope", "m")))
      )

      const routeBeforeHistory = yield* definitionErrorOf({
        id: "m",
        initial: "a",
        context: {},
        states: {
          a: { initial: "a1", states: { a1: {}, h: { type: "history", target: "missing" } } },
          b: { id: "rb", route: { ...({ cond: "x" } as object) } },
        },
      })
      assert.deepStrictEqual(routeBeforeHistory, Option.some(legacyCond("m")))
    })
  )

  it.effect("[S9] a root target without a leading dot or one that names no child is a createMachine definition error", () =>
    Effect.gen(function* () {
      const bare = yield* definitionErrorOf({
        id: "m",
        initial: "a",
        context: {},
        on: { E: "b" },
        states: { a: {}, b: {} },
      })
      assert.deepStrictEqual(bare, Option.some(invalidTargetFromRoot("b")))

      const unknownChild = yield* definitionErrorOf({
        id: "m",
        initial: "a",
        context: {},
        on: { E: ".nope" },
        states: { a: {}, b: {} },
      })
      assert.deepStrictEqual(unknownChild, Option.some(childStateDoesNotExist("nope", "m")))

      const valid = yield* definitionErrorOf({
        id: "m",
        initial: "a",
        context: {},
        on: { E: ".b", F: "#m.a" },
        states: { a: {}, b: {} },
      })
      assert.isTrue(Option.isNone(valid))
    })
  )
})
