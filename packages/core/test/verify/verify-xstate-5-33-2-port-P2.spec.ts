/**
 * P2: The persisted snapshot is JSON-safe and complete.
 *
 * T2.53. Upstream `getPersistedSnapshot` in `src/State.ts` at xstate@5.33.2 copies the
 * snapshot without its methods, its machine and its tags, persists each child as
 * `{ snapshot, src, systemId, syncSnapshot }` (an inline child throws `An inline child actor
 * cannot be persisted.`), the history value as `{ id }` lists, and every actor reference in
 * the context (also nested in arrays and objects) as `{ xstate$$type: 1, id }`. The other
 * logics persist their snapshot as it is, so the keys `output`, `error` and `input` hold
 * `undefined` when there is no value.
 *
 * The port keeps `Option` for `output` and `error` (D8) and encodes the persisted form
 * through one Schema codec in `src/persistence.ts` (SD-7): `None` is `undefined` in the
 * persisted object, as upstream, so the JSON has no key for it; the tags persist as an array;
 * context that the codec cannot encode fails with `SerializationError`. Restore decodes
 * through the same codec (the machine's `restoreSnapshot` is T2.54; these tests decode the
 * machine form with the codec itself).
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, HashSet, Option, Schema, Stream } from "effect"
import type { ActorRefBase } from "../../src/ActorRef.js"
import * as Persistence from "../../src/persistence.js"
import {
  assign,
  createActor,
  createMachine,
  type EventObject,
  fromCallback,
  fromEffect,
  fromObservable,
  fromPromise,
  fromTransition,
  makeMachineSnapshot,
  type MachineSnapshot,
  SnapshotTypeId,
} from "../../src/index.js"
import { inlineChildCannotBePersisted } from "./upstream-messages.js"

// ---------------------------------------------------------------- fixtures

interface Refs {
  readonly ref?: ActorRefBase
  readonly plain?: ActorRefBase
}

type FinishEvent = { readonly type: "FINISH" }

/** A child whose state never changes. */
const counter = fromTransition((state: { readonly count: number }, _event: EventObject) => state, { count: 7 })

/**
 * `working -FINISH-> finished` (final, with output). The entry spawns two named children:
 * `counter` with a systemId and `syncSnapshot`, `plain` without either.
 */
const parentMachine = () =>
  createMachine<Refs, FinishEvent>(
    {
      id: "p2",
      context: {},
      initial: "working",
      entry: assign<Refs, FinishEvent>({
        ref: ({ spawn }) => spawn("counter", { id: "counter", systemId: "counter-sys", syncSnapshot: true }),
        plain: ({ spawn }) => spawn("counter", { id: "plain" }),
      }),
      states: {
        working: { tags: ["busy"], on: { FINISH: "finished" } },
        finished: { type: "final", tags: ["sealed", "archived"] },
      },
      output: () => ({ total: 3 }),
    },
    { actors: { counter } }
  )

/** The JSON text of a value, then the value that text parses back to. */
const throughJson = (value: unknown): { readonly json: string; readonly parsed: Record<string, unknown> } => {
  const json = JSON.stringify(value)
  return { json, parsed: JSON.parse(json) as Record<string, unknown> }
}

/** The persisted form of a live snapshot through the machine's own `getPersistedSnapshot`. */
const persistedOf = (machine: { readonly getPersistedSnapshot: (snapshot: never) => Effect.Effect<unknown, unknown> }, snapshot: MachineSnapshot) =>
  machine.getPersistedSnapshot(snapshot as never)

/** Lets every other ready fiber take ten turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 10; turn++) {
    yield* Effect.yieldNow
  }
})

/** Yields until `condition` holds, at most 200 turns; gives whether it holds. */
const eventually = (condition: Effect.Effect<boolean>) =>
  Effect.gen(function* () {
    for (let turn = 0; turn < 200; turn++) {
      if (yield* condition) {
        return true
      }
      yield* Effect.yieldNow
    }
    return yield* condition
  })

/** A class whose instances the codec cannot encode. */
class Point {
  constructor(readonly x: number) {}
}

// ---------------------------------------------------------------- P2

describe("P2 The persisted snapshot is JSON-safe and complete", () => {
  it.effect("[P2] the JSON of a persisted machine snapshot with an output, tags and a child has no Option object form", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(parentMachine())
      yield* actor.start
      yield* actor.send({ type: "FINISH" })
      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "done")
      assert.deepStrictEqual(snapshot.output, Option.some({ total: 3 }))

      const { json, parsed } = throughJson(yield* actor.getPersistedSnapshot)

      // No `{"_id":"Option",...}` (and no `{"_id":"HashSet",...}`) anywhere in the JSON
      assert.notInclude(json, "\"_id\"")
      assert.strictEqual(parsed["status"], "done")
      assert.strictEqual(parsed["value"], "finished")
      assert.deepStrictEqual(parsed["output"], { total: 3 })
      // `error` is `None`: the JSON has no key for it (SD-7)
      assert.isFalse(Object.hasOwn(parsed, "error"))
    })
  )

  it.effect("[P2] the persisted snapshot includes the tags as an array and each child as { snapshot, src, systemId, syncSnapshot }", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(parentMachine())
      yield* actor.start
      yield* actor.send({ type: "FINISH" })
      const snapshot = yield* actor.getSnapshot

      const { parsed } = throughJson(yield* actor.getPersistedSnapshot)

      assert.deepStrictEqual(parsed["tags"], ["archived", "sealed"])
      const children = parsed["children"] as Record<string, unknown>
      assert.deepStrictEqual(Object.keys(children).sort(), ["counter", "plain"])
      const counterChild = snapshot.children["counter"]
      const plainChild = snapshot.children["plain"]
      assert.isDefined(counterChild)
      assert.isDefined(plainChild)
      // Each child's snapshot is its own persisted form
      assert.deepStrictEqual(children["counter"], {
        snapshot: throughJson(yield* counterChild!.getPersistedSnapshot).parsed,
        src: "counter",
        systemId: "counter-sys",
        syncSnapshot: true,
      })
      // A child without a systemId has no systemId key in the JSON
      assert.deepStrictEqual(children["plain"], {
        snapshot: throughJson(yield* plainChild!.getPersistedSnapshot).parsed,
        src: "counter",
        syncSnapshot: false,
      })
      // The done parent stopped its transition child, whose reducer took `xstate.stop` and
      // kept the status `active` (upstream: `{ status: 'active', context: { count: 7 } }`)
      assert.deepStrictEqual((children["plain"] as { readonly snapshot: unknown }).snapshot, {
        status: "active",
        context: { count: 7 },
      })
    })
  )

  it.effect("[P2] a None field is undefined in the persisted object, as upstream, and has no key in the JSON", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(parentMachine())
      yield* actor.start

      const persisted = (yield* actor.getPersistedSnapshot) as Record<string, unknown>

      assert.isTrue(Object.hasOwn(persisted, "output"))
      assert.isTrue(Object.hasOwn(persisted, "error"))
      assert.strictEqual(persisted["output"], undefined)
      assert.strictEqual(persisted["error"], undefined)
      assert.deepStrictEqual(persisted["tags"], ["busy"])
      const { parsed } = throughJson(persisted)
      assert.isFalse(Object.hasOwn(parsed, "output"))
      assert.isFalse(Object.hasOwn(parsed, "error"))
    })
  )

  it.effect("[P2] actor refs in the context, also nested in arrays and objects, persist as { xstate$$type: 1, id }", () =>
    Effect.gen(function* () {
      interface Nested {
        readonly ref?: ActorRefBase
        readonly list?: ReadonlyArray<ActorRefBase | number>
        readonly nested?: { readonly deep: { readonly ref: ActorRefBase | undefined; readonly label: string } }
      }
      const machine = createMachine<Nested, EventObject>(
        {
          id: "p2-refs",
          context: {},
          entry: [
            assign<Nested, EventObject>({ ref: ({ spawn }) => spawn("counter", { id: "child" }) }),
            assign<Nested, EventObject>(({ context }) => ({
              list: [1, context.ref!],
              nested: { deep: { ref: context.ref, label: "kept" } },
            })),
          ],
        },
        { actors: { counter } }
      )
      const actor = yield* createActor(machine)
      yield* actor.start

      const { parsed } = throughJson(yield* actor.getPersistedSnapshot)

      const reference = { xstate$$type: 1, id: "child" }
      assert.deepStrictEqual(parsed["context"], {
        ref: reference,
        list: [1, reference],
        nested: { deep: { ref: reference, label: "kept" } },
      })
      // The live context still holds the actor itself
      assert.strictEqual((yield* actor.getSnapshot).context.ref, (yield* actor.getSnapshot).children["child"])
    })
  )

  it.effect("[P2] the history value persists as state-node ids", () =>
    Effect.gen(function* () {
      type Toggle = { readonly type: "NEXT" } | { readonly type: "OFF" }
      const machine = createMachine<object, Toggle>({
        id: "p2-history",
        context: {},
        initial: "on",
        states: {
          on: {
            initial: "first",
            states: {
              first: { on: { NEXT: "second" } },
              second: {},
              hist: { type: "history" },
            },
            on: { OFF: "off" },
          },
          off: {},
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      yield* actor.send({ type: "NEXT" })
      yield* actor.send({ type: "OFF" })

      const { parsed } = throughJson(yield* actor.getPersistedSnapshot)

      assert.deepStrictEqual(parsed["historyValue"], { "p2-history.on.hist": [{ id: "p2-history.on.second" }] })
    })
  )

  it.effect("[P2] an inline child cannot be persisted: getPersistedSnapshot fails with the upstream message", () =>
    Effect.gen(function* () {
      const machine = createMachine<Refs, EventObject>({
        id: "p2-inline",
        context: {},
        entry: assign<Refs, EventObject>({ ref: ({ spawn }) => spawn(counter) }),
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      const error = yield* Effect.flip(actor.getPersistedSnapshot)

      assert.strictEqual(error._tag, "SerializationError")
      assert.strictEqual(error.message, inlineChildCannotBePersisted)
      // It prints as upstream's plain `Error` (the rewrite's inline snapshot)
      assert.strictEqual(String(error), `Error: ${inlineChildCannotBePersisted}`)
    })
  )

  it.effect("[P2] Some(undefined) encodes to no JSON key and decodes to None", () =>
    Effect.gen(function* () {
      const machine = createMachine<object, EventObject>({ id: "p2-boundary", context: {} })
      const actor = yield* createActor(machine)
      const live = yield* actor.getSnapshot
      const withUndefinedOutput = makeMachineSnapshot({ ...live, status: "done", output: Option.some(undefined) })

      const { parsed } = throughJson(yield* persistedOf(machine, withUndefinedOutput))
      assert.isFalse(Object.hasOwn(parsed, "output"))

      const decoded = yield* Persistence.decodeMachineSnapshot(parsed)
      assert.strictEqual(decoded.status, "done")
      assert.deepStrictEqual(decoded.output, Option.none())
    })
  )

  it.effect("[P2] a context holding a function, a bigint or a class instance makes getPersistedSnapshot fail with SerializationError", () =>
    Effect.gen(function* () {
      const contexts: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
        ["function", { nested: { callback: () => 1 } }],
        ["bigint", { list: [1, 10n] }],
        ["class instance", { at: new Point(1) }],
      ]
      for (const [label, context] of contexts) {
        const machine = createMachine<Record<string, unknown>, EventObject>({ id: "p2-context", context })
        const actor = yield* createActor(machine)

        const error = yield* Effect.flip(actor.getPersistedSnapshot)

        assert.strictEqual(error._tag, "SerializationError", label)
      }
    })
  )

  it.effect("[P2] a snapshot in status error with an Error value persists and decodes to status error", () =>
    Effect.gen(function* () {
      const failure = new Error("broken")
      const machine = createMachine<object, { readonly type: "BREAK" }>({
        id: "p2-error",
        context: {},
        on: {
          BREAK: {
            actions: () => {
              throw failure
            },
          },
        },
      })
      const actor = yield* createActor(machine)
      // An error listener, so the error is not reported as unhandled (SD-21)
      yield* actor.changes.pipe(Stream.runDrain, Effect.ignore, Effect.forkScoped({ startImmediately: true }))
      yield* actor.start
      yield* actor.send({ type: "BREAK" })
      assert.strictEqual((yield* actor.getSnapshot).status, "error")

      const persisted = (yield* actor.getPersistedSnapshot) as Record<string, unknown>
      assert.strictEqual(persisted["status"], "error")
      assert.strictEqual(persisted["error"], failure)

      const decoded = yield* Persistence.decodeMachineSnapshot(throughJson(persisted).parsed)
      assert.strictEqual(decoded.status, "error")
      assert.isTrue(Option.isSome(decoded.error))
    })
  )

  it.effect("[P2] every other logic persists its snapshot without Option objects, with the upstream keys", () =>
    Effect.gen(function* () {
      const base = { [SnapshotTypeId]: SnapshotTypeId } as const
      const promise = fromPromise<number>(() => Promise.resolve(42))
      const callback = fromCallback(() => {})
      const effect = fromEffect(() => Effect.succeed("ok"))
      const observable = fromObservable<number>(() => ({ subscribe: () => ({ unsubscribe: () => {} }) }))
      const transition = fromTransition((state: { readonly n: number }) => state, { n: 0 })

      assert.deepStrictEqual(
        yield* promise.getPersistedSnapshot({ ...base, status: "done", output: Option.some(42), error: Option.none(), input: undefined }),
        { status: "done", output: 42, error: undefined, input: undefined }
      )
      assert.deepStrictEqual(
        yield* callback.getPersistedSnapshot({ ...base, status: "active", output: Option.none(), error: Option.none(), input: { id: 1 } }),
        { status: "active", output: undefined, error: undefined, input: { id: 1 } }
      )
      assert.deepStrictEqual(
        yield* effect.getPersistedSnapshot({ ...base, status: "error", output: Option.none(), error: Option.some("bad"), input: 5 }),
        { status: "error", output: undefined, error: "bad", input: 5 }
      )
      assert.deepStrictEqual(
        yield* observable.getPersistedSnapshot({ ...base, status: "active", output: Option.none(), error: Option.none(), context: Option.some(3), input: undefined }),
        { status: "active", output: undefined, error: undefined, context: 3, input: undefined }
      )
      assert.deepStrictEqual(
        yield* transition.getPersistedSnapshot({ ...base, status: "active", output: Option.none(), error: Option.none(), context: { n: 2 } }),
        { status: "active", output: undefined, error: undefined, context: { n: 2 } }
      )
      // A logic's context goes through the same context codec as a machine's
      const failed = yield* Effect.flip(
        transition.getPersistedSnapshot({ ...base, status: "active", output: Option.none(), error: Option.none(), context: { n: 1, f: () => 1 } as never })
      )
      assert.strictEqual(failed._tag, "SerializationError")
    })
  )

  it.effect("[P2] the JSON of a persisted machine snapshot decodes back through the same codec to the same snapshot fields", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(parentMachine())
      yield* actor.start
      yield* actor.send({ type: "FINISH" })
      const live = yield* actor.getSnapshot
      const { json, parsed } = throughJson(yield* actor.getPersistedSnapshot)

      const decoded = yield* Persistence.decodeMachineSnapshot(parsed)

      assert.strictEqual(decoded.status, live.status)
      assert.deepStrictEqual(decoded.value, live.value)
      assert.deepStrictEqual(decoded.output, live.output)
      assert.deepStrictEqual(decoded.error, Option.none())
      assert.isTrue(HashSet.has(decoded.tags, "sealed") && HashSet.has(decoded.tags, "archived") && HashSet.size(decoded.tags) === 2)
      assert.deepStrictEqual(decoded.historyValue, {})
      assert.deepStrictEqual(Object.keys(decoded.children).sort(), ["counter", "plain"])
      assert.deepStrictEqual(decoded.children["counter"]?.systemId, Option.some("counter-sys"))
      assert.deepStrictEqual(decoded.children["plain"]?.systemId, Option.none())
      assert.strictEqual(decoded.children["plain"]?.syncSnapshot, false)
      // Encoding the decoded form again gives the same JSON
      const encodedAgain = yield* Schema.encodeEffect(Persistence.MachineSnapshotCodec)(decoded)
      assert.strictEqual(JSON.stringify(encodedAgain), json)
    })
  )

  it.effect("[P2] an actor of another logic restored from the JSON of its persisted snapshot has its Option fields back", () =>
    Effect.gen(function* () {
      let calls = 0
      const logic = fromPromise<number>(() => {
        calls++
        return Promise.resolve(42)
      })
      const actor = yield* createActor(logic)
      yield* actor.start
      assert.isTrue(yield* eventually(Effect.map(actor.getSnapshot, (snapshot) => snapshot.status === "done")), "the actor is done")

      const { parsed } = throughJson(yield* actor.getPersistedSnapshot)
      const restored = yield* createActor(logic, { snapshot: parsed })
      yield* restored.start
      yield* settle

      const snapshot = yield* restored.getSnapshot
      assert.strictEqual(snapshot.status, "done")
      assert.deepStrictEqual(snapshot.output, Option.some(42))
      assert.deepStrictEqual(snapshot.error, Option.none())
      assert.strictEqual(calls, 1)
    })
  )
})
