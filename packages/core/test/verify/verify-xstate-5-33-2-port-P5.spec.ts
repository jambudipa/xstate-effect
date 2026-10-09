/**
 * P5: Restore validation is opt-in.
 *
 * T6.7, D11. XState 5.33.2 restores a persisted snapshot without a consistency check: a
 * snapshot with status `done` on a state that does not complete the machine restores as it
 * is, and `start` completes the actor at once (upstream `Actor.start`, case 'done'). No
 * upstream test covers it. The port follows XState by default and adds the actor option
 * `validateSnapshot`, modelled on eque2 `InvalidPersistedSnapshotError` (`src/Actor.ts`
 * 75-104): with it, such a persisted snapshot gives an `InvalidPersistedSnapshotError` that
 * names the machine, the state value (JSON when it is not a string) and the status. A machine
 * is complete as upstream sets status `done`: a final child of the root is active, or, for a
 * parallel root, every region is complete. `createActor` declares no failure channel (SD-8),
 * so the restored actor has status `error` with the error as `snapshot.error`, as a persisted
 * value the codec rejects gives status `error` with a `RestoreError`. The option reaches the
 * children the restore rehydrates.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { createActor, createMachine, Errors, isActorRef, Snapshot } from "../../src/index.js"

// ---------------------------------------------------------------- helpers

/** The JSON text of a value parsed back, as a stored snapshot comes back. */
const throughJson = (value: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(value)) as Record<string, unknown>

/** Lets every other ready fiber take a bounded number of turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 25; turn++) {
    yield* Effect.yieldNow
  }
})

/** The text of eque2's message for a done snapshot on a state that is not final. */
const invalidMessage = (stateValue: string, machineId: string) =>
  `[Actor] Invalid persisted snapshot: status is 'done' but state '${stateValue}' is not a final state. This actor cannot process any events. If you want to retry/reset this actor, change status to 'active' in the persisted snapshot. Machine: ${machineId}`

// ---------------------------------------------------------------- fixtures

/** `idle -GO-> busy -FINISH-> finished` (final, top level); `idle` has a nested region. */
const simple = createMachine({
  id: "simple",
  initial: "idle",
  states: {
    idle: { on: { GO: "busy" } },
    busy: {
      initial: "p",
      states: { p: { on: { NEST: "q" } }, q: { type: "final" } },
      on: { FINISH: "finished" },
    },
    finished: { type: "final" },
  },
})

/** A parallel root: complete only when both regions are in their final states. */
const regions = createMachine({
  id: "regions",
  type: "parallel",
  states: {
    r1: { initial: "a", states: { a: {}, f: { type: "final" } } },
    r2: { initial: "b", states: { b: {}, g: { type: "final" } } },
  },
})

/** The persisted snapshot of a started actor of `simple`, with its status and value replaced. */
const persistedSimple = (status: string, value: unknown) =>
  Effect.gen(function* () {
    const actor = yield* createActor(simple)
    yield* actor.start
    const persisted = throughJson(yield* actor.getPersistedSnapshot)
    yield* actor.stop
    return { ...persisted, status, value }
  })

// ---------------------------------------------------------------- P5

describe("P5 Restore validation is opt-in", () => {
  it.effect("[P5] by default a persisted snapshot with status done on a non-final state restores without error and completes at start, as in XState", () =>
    Effect.gen(function* () {
      const persisted = yield* persistedSimple("done", "idle")

      const actor = yield* createActor(simple, { snapshot: persisted })
      const restored = yield* actor.getSnapshot
      assert.strictEqual(restored.status, "done")
      assert.strictEqual(restored.value, "idle")
      assert.isTrue(Option.isNone(restored.error))

      yield* actor.start
      yield* actor.send({ type: "GO" })
      const after = yield* actor.getSnapshot
      assert.strictEqual(after.status, "done")
      assert.strictEqual(after.value, "idle")
    })
  )

  it.effect("[P5] with validateSnapshot the same restore gives status error with InvalidPersistedSnapshotError naming the machine, the state and the status", () =>
    Effect.gen(function* () {
      const persisted = yield* persistedSimple("done", "idle")

      const actor = yield* createActor(simple, { snapshot: persisted, validateSnapshot: true })
      const restored = yield* actor.getSnapshot
      assert.strictEqual(restored.status, "error")
      assert.isTrue(Option.isSome(restored.error))
      const error = Option.getOrThrow(restored.error)
      assert.instanceOf(error, Errors.InvalidPersistedSnapshotError)
      if (error instanceof Errors.InvalidPersistedSnapshotError) {
        assert.strictEqual(error._tag, "InvalidPersistedSnapshotError")
        assert.strictEqual(error.machineId, "simple")
        assert.strictEqual(error.stateValue, "idle")
        assert.strictEqual(error.status, "done")
        assert.deepStrictEqual(error.suggestedFix, { status: "active" })
        assert.strictEqual(error.message, invalidMessage("idle", "simple"))
      }

      // `start` errors the actor with it: no event is processed
      yield* actor.start
      yield* actor.send({ type: "GO" })
      const after = yield* actor.getSnapshot
      assert.strictEqual(after.status, "error")
      assert.strictEqual(Option.getOrUndefined(after.error), error)
    })
  )

  it.effect("[P5] a nested state value is named as JSON, and a nested final state does not complete the machine", () =>
    Effect.gen(function* () {
      const persisted = yield* persistedSimple("done", { busy: "q" })

      const actor = yield* createActor(simple, { snapshot: persisted, validateSnapshot: true })
      const error = Option.getOrUndefined((yield* actor.getSnapshot).error)
      assert.instanceOf(error, Errors.InvalidPersistedSnapshotError)
      if (error instanceof Errors.InvalidPersistedSnapshotError) {
        assert.strictEqual(error.stateValue, '{"busy":"q"}')
        assert.strictEqual(error.message, invalidMessage('{"busy":"q"}', "simple"))
      }
    })
  )

  it.effect("[P5] a consistent snapshot passes validation: done in a top-level final state, active anywhere, a parallel root with every region final", () =>
    Effect.gen(function* () {
      const done = yield* createActor(simple, { snapshot: yield* persistedSimple("done", "finished"), validateSnapshot: true })
      const doneSnapshot = yield* done.getSnapshot
      assert.strictEqual(doneSnapshot.status, "done")
      assert.isTrue(Option.isNone(doneSnapshot.error))

      const active = yield* createActor(simple, { snapshot: yield* persistedSimple("active", "idle"), validateSnapshot: true })
      assert.strictEqual((yield* active.getSnapshot).status, "active")
      yield* active.start
      yield* active.send({ type: "GO" })
      assert.deepStrictEqual((yield* active.getSnapshot).value, { busy: "p" })

      const first = yield* createActor(regions)
      yield* first.start
      const persistedRegions = throughJson(yield* first.getPersistedSnapshot)
      yield* first.stop

      const complete = yield* createActor(regions, {
        snapshot: { ...persistedRegions, status: "done", value: { r1: "f", r2: "g" } },
        validateSnapshot: true,
      })
      assert.strictEqual((yield* complete.getSnapshot).status, "done")

      const incomplete = yield* createActor(regions, {
        snapshot: { ...persistedRegions, status: "done", value: { r1: "f", r2: "b" } },
        validateSnapshot: true,
      })
      const error = Option.getOrUndefined((yield* incomplete.getSnapshot).error)
      assert.instanceOf(error, Errors.InvalidPersistedSnapshotError)
      if (error instanceof Errors.InvalidPersistedSnapshotError) {
        assert.strictEqual(error.machineId, "regions")
        assert.strictEqual(error.stateValue, '{"r1":"f","r2":"b"}')
      }
    })
  )

  it.effect("[P5] validation reaches the rehydrated children: an inconsistent child snapshot gives that child status error, the parent stays active", () =>
    Effect.gen(function* () {
      const parent = createMachine(
        {
          id: "parent",
          invoke: { id: "kid", src: "simple" },
        },
        { actors: { simple } }
      )
      const first = yield* createActor(parent)
      yield* first.start
      const persisted = throughJson(yield* first.getPersistedSnapshot)
      yield* first.stop
      const children = persisted["children"] as Record<string, Record<string, unknown>>
      const kidEntry = children["kid"]!
      const tampered = {
        ...persisted,
        children: { kid: { ...kidEntry, snapshot: { ...(kidEntry["snapshot"] as object), status: "done", value: "idle" } } },
      }

      // By default the child restores as it is
      const lenient = yield* createActor(parent, { snapshot: tampered })
      yield* lenient.start
      const lenientKid = (yield* lenient.getSnapshot).children["kid"]
      assert.isTrue(isActorRef(lenientKid))
      assert.strictEqual((yield* lenientKid!.getSnapshotUntyped).status, "done")

      // With the option the child errors, with the error that names its own machine
      const strict = yield* createActor(parent, { snapshot: tampered, validateSnapshot: true })
      yield* strict.start
      yield* settle
      assert.strictEqual((yield* strict.getSnapshot).status, "active")
      const strictKid = (yield* strict.getSnapshot).children["kid"]
      assert.isTrue(isActorRef(strictKid))
      const kidSnapshot = yield* strictKid!.getSnapshotUntyped
      assert.strictEqual(kidSnapshot.status, "error")
      const error = Option.getOrUndefined(kidSnapshot.error)
      assert.instanceOf(error, Errors.InvalidPersistedSnapshotError)
      if (error instanceof Errors.InvalidPersistedSnapshotError) {
        assert.strictEqual(error.machineId, "simple")
        assert.strictEqual(error.stateValue, "idle")
      }
    })
  )

  it.effect("[P5] malformed persisted JSON gives an actor in status error with a RestoreError, with or without validation", () =>
    Effect.gen(function* () {
      for (const validateSnapshot of [false, true]) {
        const actor = yield* createActor(simple, { snapshot: { status: "active", value: 42, children: {} }, validateSnapshot })
        const snapshot = yield* actor.getSnapshot
        assert.strictEqual(snapshot.status, "error")
        assert.instanceOf(Option.getOrUndefined(snapshot.error), Errors.RestoreError)
      }
    })
  )

  it.effect("[P5] a live snapshot is never validated, as eque2 checks only persisted ones", () =>
    Effect.gen(function* () {
      const live = Snapshot.withStatus((yield* simple.resolveState({ value: "idle" })), { status: "done" })
      const actor = yield* createActor(simple, { snapshot: live, validateSnapshot: true })
      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "done")
      assert.strictEqual(snapshot.value, "idle")
      assert.isTrue(Option.isNone(snapshot.error))
    })
  )
})
