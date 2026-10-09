/**
 * C12: createActor honours the systemId and snapshot options.
 *
 * T2.42 (the `systemId` option). The upstream `Actor` constructor in `src/createActor.ts` at
 * xstate@5.33.2 keeps `systemId` as a plain field and registers the actor under it with
 * `system._set(systemId, this)` before `_initState` computes the initial snapshot; `start`
 * registers it again. `this.ref = this`, so `system.get(systemId)` returns the object that
 * `createActor` returned. The port reads the system through Effects (D7): `system.get` gives
 * `Effect<Option<ActorRef>>`.
 *
 * T2.54 (the `snapshot` option). Upstream `_initState` restores the snapshot through
 * `logic.restoreSnapshot` instead of computing the initial snapshot, so the actor starts from
 * the persisted state and runs no initial action. The port decodes a persisted machine
 * snapshot through the snapshot codec (SD-7), so a snapshot parsed back from JSON gives the
 * live forms again (D8).
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { assign, createActor, createMachine, type EventObject } from "../../src/index.js"

interface Probe {
  /** Whether `system.get('probe')` found the actor itself while its initial snapshot was computed. */
  readonly foundSelf: boolean
}

const plainMachine = () =>
  createMachine<object, EventObject>({
    id: "c12",
    initial: "idle",
    context: {},
    states: { idle: {} },
  })

/**
 * Looks itself up under the systemId `probe` in an initial entry `assign`, which runs at
 * creation. An assigner returns data, so it reads the system synchronously (D7), as the
 * upstream rewrites do.
 */
const probeMachine = () =>
  createMachine<Probe, EventObject>({
    id: "c12-probe",
    initial: "idle",
    context: { foundSelf: false },
    states: {
      idle: {
        entry: assign<Probe, EventObject>(({ self, system }) => {
          const found = Effect.runSync(system.get("probe"))
          return { foundSelf: Option.isSome(found) && found.value === self }
        }),
      },
    },
  })

describe("C12 createActor honours the systemId and snapshot options", () => {
  it.effect("[C12] a root machine created with a systemId option is found by system.get under that systemId once it starts", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(plainMachine(), { systemId: "test" })
      yield* actor.start

      const found = yield* actor.system.get("test")

      assert.isTrue(Option.isSome(found))
      assert.strictEqual(Option.getOrUndefined(found), actor)
      assert.strictEqual(Option.getOrUndefined(found), actor.ref)
    })
  )

  it.effect("[C12] the systemId option registers the root at creation, before start, as the object createActor returned", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(plainMachine(), { systemId: "test" })

      assert.strictEqual(Option.getOrUndefined(yield* actor.system.get("test")), actor)
      assert.deepStrictEqual(Object.keys(yield* actor.system.getAll), ["test"])
    })
  )

  it.effect("[C12] the actor is registered under its systemId before its initial snapshot is computed", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(probeMachine(), { systemId: "probe" })

      // The initial entry assign ran at creation and found the actor under its systemId
      assert.isTrue((yield* actor.getSnapshot).context.foundSelf)
    })
  )

  it.effect("[C12] actor.systemId is the systemId option as a plain string, and undefined without one", () =>
    Effect.gen(function* () {
      const named = yield* createActor(plainMachine(), { systemId: "test" })
      const unnamed = yield* createActor(plainMachine())

      assert.strictEqual(named.systemId, "test")
      assert.isUndefined(unnamed.systemId)
    })
  )

  it.effect("[C12] an actor created with a persisted snapshot option starts from that snapshot", () =>
    Effect.gen(function* () {
      const entered: Array<string> = []
      type Step = { readonly type: "NEXT" }
      const steps = () =>
        createMachine<{ readonly visits: number }, Step>({
          id: "c12-steps",
          context: { visits: 0 },
          initial: "one",
          states: {
            one: {
              entry: () => {
                entered.push("one")
              },
              on: { NEXT: "two" },
            },
            two: {
              tags: ["middle"],
              entry: [
                () => {
                  entered.push("two")
                },
                assign<{ readonly visits: number }, Step>({ visits: ({ context }) => context.visits + 1 }),
              ],
              on: { NEXT: "three" },
            },
            three: {
              entry: () => {
                entered.push("three")
              },
            },
          },
        })
      const source = yield* createActor(steps())
      yield* source.start
      yield* source.send({ type: "NEXT" })
      const stored = JSON.stringify(yield* source.getPersistedSnapshot)
      yield* source.stop
      entered.length = 0

      const actor = yield* createActor(steps(), { snapshot: JSON.parse(stored) })
      const restored = yield* actor.getSnapshot

      // The snapshot option, read back through the machine's codec, not the initial snapshot
      assert.strictEqual(restored.value, "two")
      assert.deepStrictEqual(restored.context, { visits: 1 })
      assert.isTrue(restored.tags.includes("middle"))
      assert.deepStrictEqual(restored.output, Option.none())

      // It starts from there: no initial action runs, and the next event leaves `two`
      yield* actor.start
      assert.deepStrictEqual(entered, [])
      yield* actor.send({ type: "NEXT" })
      assert.strictEqual((yield* actor.getSnapshot).value, "three")
      assert.deepStrictEqual(entered, ["three"])
    })
  )

  it.effect("[C12] a systemId option and a snapshot option together register the restored actor under that systemId", () =>
    Effect.gen(function* () {
      const source = yield* createActor(plainMachine())
      yield* source.start
      const persisted = yield* source.getPersistedSnapshot
      yield* source.stop

      const actor = yield* createActor(plainMachine(), { systemId: "restored", snapshot: persisted })
      yield* actor.start

      assert.strictEqual(Option.getOrUndefined(yield* actor.system.get("restored")), actor)
      assert.strictEqual((yield* actor.getSnapshot).value, "idle")
    })
  )
})
