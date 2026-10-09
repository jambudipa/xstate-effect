/**
 * C11: createEmptyActor creates an actor with an undefined snapshot.
 *
 * T5.7. Upstream `createEmptyActor()` (`src/actors/index.ts` at xstate@5.33.2) is
 * `createActor(fromTransition((_) => undefined, undefined))`, typed
 * `ActorRef<Snapshot<undefined>, AnyEventObject, AnyEventObject>`; the root and `./actors`
 * export the same function. A tsx probe of 5.33.2 (`packages/core/.upstream/measure/t57/`)
 * gives: the snapshot is `{ status: 'active', output: undefined, error: undefined, context:
 * undefined }` before and after `start`; every event leaves the context `undefined`; the actor
 * emits nothing; `start`, a second `start`, sends and `stop` log nothing; the persisted
 * snapshot is the same four fields with `undefined` values; each call creates a new root
 * actor with its own system.
 *
 * Effect form (D6, `journal/rewrite-api.md`): `yield* createEmptyActor()` in a scope, as
 * `createActor`; the result is the actor itself (it keeps `start` and `stop`, which the port's
 * `ActorRef` type lacks), and upstream's declared `ActorRef` type accepts it. `output` and `error` are `Option`
 * in the snapshot (D8) and `undefined` in the persisted form (SD-7). The type-level case is
 * this file's own type check (`tsc -p tsconfig.test.green.json`) and the types.test rewrite
 * "UnknownActorRef should return a Snapshot-typed value from getSnapshot()".
 *
 * Not checked here (T5.8 owns stop semantics): upstream keeps a transition actor's snapshot
 * status `active` after `stop`, and ends its observers.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Logger, Option, Predicate } from "effect"
import * as Actors from "../../src/actors/index.js"
import {
  type ActorRefType,
  type ActorType,
  type AnyEventObject,
  createEmptyActor,
  type EventObject,
  type SnapshotType,
  type TransitionSnapshot,
  type UnknownActorRef,
} from "../../src/index.js"

/** True when `A` and `B` are the same type. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

/** Compiles only for `true`. */
const typeHolds = <T extends true>(holds: T): T => holds

/** Runs `program` with a logger that keeps every message, with its level. */
const withLogsCaptured = <A, E, R>(program: Effect.Effect<A, E, R>) => {
  const logs: Array<string> = []
  return program.pipe(
    Effect.provide(
      Logger.layer([
        Logger.make((options) => {
          const parts: ReadonlyArray<unknown> = Array.isArray(options.message) ? options.message : [options.message]
          logs.push(`${options.logLevel}: ${parts.map(String).join(" ")}`)
        }),
      ])
    ),
    Effect.map((result) => ({ result, logs }))
  )
}

/** The snapshot's `context` member: whether it has one, and its value. */
const contextOf = (snapshot: SnapshotType): { readonly has: boolean; readonly value: unknown } =>
  Predicate.hasProperty(snapshot, "context") ? { has: true, value: snapshot.context } : { has: false, value: "absent" }

/** Asserts the empty snapshot: active, an own `context` that is `undefined`, no output, no error. */
const assertEmptySnapshot = (snapshot: SnapshotType, label: string) => {
  assert.strictEqual(snapshot.status, "active", `${label}: status`)
  assert.deepStrictEqual(contextOf(snapshot), { has: true, value: undefined }, `${label}: context`)
  assert.isTrue(Option.isNone(snapshot.output), `${label}: output`)
  assert.isTrue(Option.isNone(snapshot.error), `${label}: error`)
}

/** Upstream's persisted empty snapshot (probe E1). */
const persistedEmpty = { status: "active", output: undefined, error: undefined, context: undefined }

describe("C11 createEmptyActor creates an actor with an undefined snapshot", () => {
  it.effect("[C11] createEmptyActor gives an actor whose snapshot is active with an undefined context, before and after start", () =>
    Effect.gen(function* () {
      const actor = yield* createEmptyActor()
      assertEmptySnapshot(yield* actor.getSnapshot, "before start")

      yield* actor.start
      assertEmptySnapshot(yield* actor.getSnapshot, "after start")
    }))

  it.effect("[C11] an empty actor accepts events of any type and members, keeps its undefined context and emits nothing", () =>
    Effect.gen(function* () {
      const { result, logs } = yield* withLogsCaptured(
        Effect.gen(function* () {
          const actor = yield* createEmptyActor()
          const emitted: Array<AnyEventObject> = []
          yield* actor.on("*", (event) => Effect.sync(() => emitted.push(event)))

          // A send before `start` waits in the mailbox (upstream: no warning)
          yield* actor.send({ type: "BEFORE" })
          yield* actor.start
          yield* actor.send({ type: "ANY", payload: 1 })
          yield* actor.send({ type: "xstate.whatever", nested: { deep: [1, 2] } })
          return { snapshot: yield* actor.getSnapshot, emitted }
        })
      )

      assertEmptySnapshot(result.snapshot, "after the sends")
      assert.deepStrictEqual(result.emitted, [])
      assert.deepStrictEqual(logs, [])
    }))

  it.effect("[C11] start, a second start and stop on an empty actor log nothing and leave the context undefined", () =>
    Effect.gen(function* () {
      const { result, logs } = yield* withLogsCaptured(
        Effect.gen(function* () {
          const actor = yield* createEmptyActor()
          yield* actor.start
          yield* actor.start
          const started = yield* actor.getSnapshot
          yield* actor.stop
          return { started, stopped: yield* actor.getSnapshot }
        })
      )

      assertEmptySnapshot(result.started, "after two starts")
      assert.deepStrictEqual(contextOf(result.stopped), { has: true, value: undefined })
      assert.deepStrictEqual(logs, [])
    }))

  it.effect("[C11] getPersistedSnapshot of an empty actor gives upstream's empty form, before start and after events", () =>
    Effect.gen(function* () {
      const actor = yield* createEmptyActor()
      assert.deepStrictEqual(yield* actor.getPersistedSnapshot, persistedEmpty)

      yield* actor.start
      yield* actor.send({ type: "ANY" })
      assert.deepStrictEqual(yield* actor.getPersistedSnapshot, persistedEmpty)
    }))

  it.effect("[C11] each call creates a new, unstarted root actor with its own system", () =>
    Effect.gen(function* () {
      const first = yield* createEmptyActor()
      const second = yield* createEmptyActor()

      assert.notStrictEqual(first, second)
      assert.notStrictEqual(first.system, second.system)
      assert.isTrue(Option.isNone(first._parent))

      // Starting one leaves the other as it was
      yield* first.start
      yield* first.send({ type: "ONLY_FIRST" })
      assertEmptySnapshot(yield* second.getSnapshot, "the other actor")
    }))

  it("[C11] the root and the ./actors entry point export the same createEmptyActor", () => {
    assert.isFunction(createEmptyActor)
    assert.strictEqual(Actors.createEmptyActor, createEmptyActor)
  })

  it.effect("[C11] an empty actor is an UnknownActorRef whose getSnapshot gives a Snapshot-typed value", () =>
    Effect.gen(function* () {
      const actor = yield* createEmptyActor()
      const ref: UnknownActorRef = actor

      // The actor itself, whose snapshot also names the `undefined` context; upstream's declared
      // type, `ActorRef<Snapshot<undefined>, AnyEventObject, AnyEventObject>`, accepts it
      typeHolds<Equals<typeof actor, ActorType<TransitionSnapshot<undefined>, AnyEventObject, AnyEventObject>>>(true)
      const upstreamTyped: ActorRefType<SnapshotType<undefined>, AnyEventObject, AnyEventObject> = actor
      typeHolds<Equals<UnknownActorRef, ActorRefType<SnapshotType<unknown>, EventObject>>>(true)
      assert.strictEqual(upstreamTyped, ref)

      const snapshot = yield* ref.getSnapshot
      // @ts-expect-error a Snapshot's status is one of the snapshot statuses, never 'FOO'
      assert.isFalse(snapshot.status === "FOO")
      assert.strictEqual(snapshot.status, "active")
    }))
})
