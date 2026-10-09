/**
 * P3: A persisted snapshot restores to an equal snapshot.
 *
 * T2.54. Upstream `StateMachine.restoreSnapshot` in `src/StateMachine.ts` at xstate@5.33.2
 * creates each persisted child with `createActor(logic, { id, parent, syncSnapshot,
 * snapshot, src, systemId })` and skips a child whose `src` names no implementation, revives
 * the history value by state-node id (an unknown id warns `Could not resolve StateNode for
 * id: <id>`; a value that is not an object is no history), reads the configuration from the
 * state value (`getStateNodes` throws `State '<value>' does not exist on '<id>'`), and
 * revives each `{ xstate$$type: 1, id }` marker of the context to the child with that id
 * (`undefined` when there is none). `StateMachine.start` starts each active child; a done
 * child is never started, so it does not notify its parent again. `Actor._initState` turns a
 * throw of the restore into `{ status: 'error', error }`. Upstream promise and observable logic
 * set `input` to `undefined` once done or errored, so the persisted form of such a child keeps
 * the key with `undefined` (the port's effect logic follows promise logic).
 *
 * The port decodes the persisted form through the snapshot codec (SD-7, `src/persistence.ts`).
 * `createActor` declares no failure channel (SD-8): a persisted value that the codec rejects,
 * or a state value that names no state, gives an actor in status `error` whose `error` is
 * `Some(RestoreError)`. The warning goes through the actor's logger (SD-21).
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Logger, Option } from "effect"
import type { ActorRefBase } from "../../src/ActorRef.js"
import {
  assign,
  createActor,
  createMachine,
  type EventObject,
  fromEffect,
  fromObservable,
  fromPromise,
  fromTransition,
  isActorRef,
  Errors,
  StateNode,
} from "../../src/index.js"
import { childStateDoesNotExist, stateDoesNotExist, unresolvedHistoryStateNode } from "./upstream-messages.js"

// ---------------------------------------------------------------- fixtures

interface Ctx {
  readonly ref?: ActorRefBase
  readonly refs?: ReadonlyArray<ActorRefBase | number>
  readonly nested?: { readonly deep: { readonly ref: ActorRefBase | undefined; readonly label: string } }
  readonly count: number
}

type Ev =
  | { readonly type: "SWITCH" }
  | { readonly type: "POWER" }
  | { readonly type: "INC" }
  | { readonly type: "FINISH" }

/** A child whose state never changes. */
const counter = fromTransition((state: { readonly count: number }, _event: EventObject) => state, { count: 7 })

/**
 * `on (first -SWITCH-> second, hist) -POWER-> off -POWER-> on.hist`, `off -FINISH-> done`.
 * The root entry spawns `counter` (systemId and `syncSnapshot`) and `plain`, and keeps the
 * reference to `counter` in the context, also inside an array and a nested object. `log`
 * records every entry action and every spawn.
 */
const powerMachine = (log: Array<string>) =>
  createMachine<Ctx, Ev>(
    {
      id: "p3",
      context: { count: 0 },
      initial: "on",
      entry: [
        () => {
          log.push("entry root")
        },
        assign<Ctx, Ev>({
          ref: ({ spawn }) => {
            log.push("spawn")
            return spawn("counter", { id: "counter", systemId: "counter-sys", syncSnapshot: true })
          },
        }),
        assign<Ctx, Ev>(({ context, spawn }) => {
          spawn("counter", { id: "plain" })
          return {
            refs: [1, context.ref!],
            nested: { deep: { ref: context.ref, label: "kept" } },
          }
        }),
      ],
      on: { INC: { actions: assign<Ctx, Ev>({ count: ({ context }) => context.count + 1 }) } },
      states: {
        on: {
          initial: "first",
          tags: ["powered"],
          entry: () => {
            log.push("entry on")
          },
          exit: () => {
            log.push("exit on")
          },
          states: {
            first: { on: { SWITCH: "second" } },
            second: { tags: ["switched"] },
            hist: { type: "history" },
          },
          on: { POWER: "off" },
        },
        off: {
          tags: ["dark"],
          entry: () => {
            log.push("entry off")
          },
          on: { POWER: "on.hist", FINISH: "done" },
        },
        done: { type: "final" },
      },
      output: ({ context }: { readonly context: Ctx }) => ({ total: context.count }),
    },
    { actors: { counter } }
  )

/** The JSON text of a value parsed back, as a stored snapshot comes back. */
const throughJson = (value: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(value)) as Record<string, unknown>

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

/** The machine after SWITCH, INC and POWER: state `off`, the history of `on` holds `second`. */
const persistedPowerMachine = (log: Array<string>) =>
  Effect.gen(function* () {
    const actor = yield* createActor(powerMachine(log))
    yield* actor.start
    yield* actor.send({ type: "SWITCH" })
    yield* actor.send({ type: "INC" })
    yield* actor.send({ type: "POWER" })
    const persisted = yield* actor.getPersistedSnapshot
    yield* actor.stop
    return throughJson(persisted)
  })

/** Runs `program` with a logger that keeps the message of every warning. */
const withWarnings = <A, E, R>(program: Effect.Effect<A, E, R>) => {
  const warnings: Array<unknown> = []
  return Effect.map(
    program.pipe(
      Effect.provide(
        Logger.layer([
          Logger.make((options) => {
            if (options.logLevel === "Warn") {
              warnings.push(Array.isArray(options.message) ? options.message[0] : options.message)
            }
          }),
        ])
      )
    ),
    (result) => ({ result, warnings })
  )
}

// ---------------------------------------------------------------- P3

describe("P3 A persisted snapshot restores to an equal snapshot", () => {
  it.effect("[P3] a persisted snapshot parsed back from JSON restores to a snapshot whose persisted form equals the original", () =>
    Effect.gen(function* () {
      const persisted = yield* persistedPowerMachine([])

      const restored = yield* createActor(powerMachine([]), { snapshot: persisted })

      assert.deepStrictEqual(throughJson(yield* restored.getPersistedSnapshot), persisted)
      // The fields themselves, as the persisted form names them
      assert.strictEqual(persisted["value"], "off")
      assert.deepStrictEqual(persisted["tags"], ["dark"])
      assert.deepStrictEqual(persisted["historyValue"], { "p3.on.hist": [{ id: "p3.on.second" }] })
      assert.deepStrictEqual(Object.keys(persisted["children"] as object).sort(), ["counter", "plain"])
    })
  )

  it.effect("[P3] the restored snapshot has the live forms: Option fields, the tags as a list, state nodes in the history, actors as children", () =>
    Effect.gen(function* () {
      const persisted = yield* persistedPowerMachine([])

      const restored = yield* createActor(powerMachine([]), { snapshot: persisted })
      const snapshot = yield* restored.getSnapshot

      assert.strictEqual(snapshot.status, "active")
      assert.strictEqual(snapshot.value, "off")
      assert.strictEqual(snapshot.context.count, 1)
      assert.deepStrictEqual(snapshot.output, Option.none())
      assert.deepStrictEqual(snapshot.error, Option.none())
      assert.isTrue(snapshot.tags.includes("dark"))
      assert.strictEqual(snapshot.tags.length, 1)
      const recorded = snapshot.historyValue["p3.on.hist"] ?? []
      assert.strictEqual(recorded.length, 1)
      assert.instanceOf(recorded[0], StateNode)
      assert.strictEqual(recorded[0]?.id, "p3.on.second")
      const counterChild = snapshot.children["counter"]
      assert.isTrue(isActorRef(counterChild))
      assert.strictEqual(counterChild?.id, "counter")
      assert.deepStrictEqual(throughJson(yield* counterChild!.getPersistedSnapshot), {
        status: "active",
        context: { count: 7 },
      })
    })
  )

  it.effect("[P3] the restored history state enters the recorded configuration", () =>
    Effect.gen(function* () {
      const persisted = yield* persistedPowerMachine([])

      const restored = yield* createActor(powerMachine([]), { snapshot: persisted })
      yield* restored.start
      yield* restored.send({ type: "POWER" })

      const snapshot = yield* restored.getSnapshot
      assert.deepStrictEqual(snapshot.value, { on: "second" })
      assert.isTrue(snapshot.tags.includes("switched"))
    })
  )

  it.effect("[P3] context markers revive to the restored children, also inside arrays and nested objects", () =>
    Effect.gen(function* () {
      const persisted = yield* persistedPowerMachine([])
      assert.deepStrictEqual((persisted["context"] as Record<string, unknown>)["ref"], { xstate$$type: 1, id: "counter" })

      const restored = yield* createActor(powerMachine([]), { snapshot: persisted })
      const snapshot = yield* restored.getSnapshot

      const child = snapshot.children["counter"]
      assert.isDefined(child)
      assert.strictEqual(snapshot.context.ref, child)
      assert.strictEqual(snapshot.context.refs?.[1], child)
      assert.strictEqual(snapshot.context.refs?.[0], 1)
      assert.strictEqual(snapshot.context.nested?.deep.ref, child)
      assert.strictEqual(snapshot.context.nested?.deep.label, "kept")
    })
  )

  it.effect("[P3] no entry action of the restored state runs again, the spawns do not run again, and a stop runs no exit action", () =>
    Effect.gen(function* () {
      const persisted = yield* persistedPowerMachine([])
      const log: Array<string> = []

      const restored = yield* createActor(powerMachine(log), { snapshot: persisted })
      yield* restored.start
      yield* settle
      yield* restored.stop

      assert.deepStrictEqual(log, [])
    })
  )

  it.effect("[P3] the restored children are the parent's: they join its system, start with it and stop with it", () =>
    Effect.gen(function* () {
      const persisted = yield* persistedPowerMachine([])

      const restored = yield* createActor(powerMachine([]), { snapshot: persisted })
      const child = (yield* restored.getSnapshot).children["counter"]!
      assert.strictEqual(child._parent.pipe(Option.getOrUndefined), restored)
      assert.strictEqual(Option.getOrUndefined(yield* restored.system.get("counter-sys")), child)

      yield* restored.start
      const started = yield* child.getSnapshotUntyped
      assert.strictEqual(started.status, "active")

      // The child stops with its parent: its reducer takes `xstate.stop`, so a transition
      // child keeps the status `active` (upstream), and it takes no event any more
      yield* restored.stop
      assert.strictEqual((yield* child.getSnapshotUntyped).status, "active")
      const { warnings } = yield* withWarnings(child.sendUntyped({ type: "LATE" }))
      assert.strictEqual(warnings.length, 1)
      assert.include(String(warnings[0]), 'Event "LATE" was sent to stopped actor')
    })
  )

  it.effect("[P3] Option fields survive the round trip: Some(output) of a done machine, and None for an output mapper that gives undefined", () =>
    Effect.gen(function* () {
      const persisted = yield* Effect.gen(function* () {
        const actor = yield* createActor(powerMachine([]))
        yield* actor.start
        yield* actor.send({ type: "INC" })
        yield* actor.send({ type: "POWER" })
        yield* actor.send({ type: "FINISH" })
        return throughJson(yield* actor.getPersistedSnapshot)
      })
      const restored = yield* createActor(powerMachine([]), { snapshot: persisted })
      const snapshot = yield* restored.getSnapshot
      assert.strictEqual(snapshot.status, "done")
      assert.deepStrictEqual(snapshot.output, Option.some({ total: 1 }))
      assert.deepStrictEqual(snapshot.error, Option.none())

      const silent = createMachine<object, EventObject>({
        id: "p3-silent",
        context: {},
        initial: "end",
        states: { end: { type: "final" } },
        output: () => undefined,
      })
      const silentPersisted = throughJson(yield* (yield* createActor(silent)).getPersistedSnapshot)
      assert.isFalse(Object.hasOwn(silentPersisted, "output"))
      const silentRestored = yield* (yield* createActor(silent, { snapshot: silentPersisted })).getSnapshot
      assert.strictEqual(silentRestored.status, "done")
      assert.deepStrictEqual(silentRestored.output, Option.none())
    })
  )

  it.effect("[P3] a persisted child whose src has no implementation is skipped without failing the restore, and its marker revives to undefined", () =>
    Effect.gen(function* () {
      const persisted = yield* persistedPowerMachine([])
      const children = persisted["children"] as Record<string, Record<string, unknown>>
      const changed = { ...persisted, children: { ...children, counter: { ...children["counter"], src: "missing" } } }

      const restored = yield* createActor(powerMachine([]), { snapshot: changed })
      const snapshot = yield* restored.getSnapshot

      assert.strictEqual(snapshot.status, "active")
      assert.deepStrictEqual(Object.keys(snapshot.children), ["plain"])
      assert.isUndefined(snapshot.context.ref)
      assert.isTrue(Object.hasOwn(snapshot.context, "ref"))
      assert.isUndefined(snapshot.context.nested?.deep.ref)
      assert.isTrue(Option.isNone(yield* restored.system.get("counter-sys")))
    })
  )

  it.effect("[P3] a context marker whose id names no persisted child revives to undefined", () =>
    Effect.gen(function* () {
      const persisted = yield* persistedPowerMachine([])
      const context = persisted["context"] as Record<string, unknown>
      const changed = { ...persisted, context: { ...context, ref: { xstate$$type: 1, id: "ghost" } } }

      const snapshot = yield* (yield* createActor(powerMachine([]), { snapshot: changed })).getSnapshot

      assert.isTrue(Object.hasOwn(snapshot.context, "ref"))
      assert.isUndefined(snapshot.context.ref)
      assert.strictEqual(snapshot.context.nested?.deep.ref, snapshot.children["counter"])
    })
  )

  it.effect("[P3] a restored done child is not started and does not notify its parent again", () =>
    Effect.gen(function* () {
      const heard: Array<string> = []
      const finished = createMachine<object, EventObject>({ id: "p3-finished", context: {}, type: "final" })
      const machine = createMachine<{ readonly child?: ActorRefBase }, EventObject>(
        {
          id: "p3-parent",
          context: {},
          entry: assign<{ readonly child?: ActorRefBase }, EventObject>({
            child: ({ spawn }) => spawn("finished", { id: "child", systemId: "finished-sys" }),
          }),
          on: {
            "*": {
              actions: ({ event }) => {
                heard.push(event.type)
              },
            },
          },
        },
        { actors: { finished } }
      )
      const actor = yield* createActor(machine)
      yield* actor.start
      yield* settle
      const persisted = throughJson(yield* actor.getPersistedSnapshot)
      yield* actor.stop
      assert.strictEqual(
        ((persisted["children"] as Record<string, { readonly snapshot: { readonly status: string } }>)["child"])?.snapshot.status,
        "done"
      )
      heard.length = 0

      const restored = yield* createActor(machine, { snapshot: persisted })
      yield* restored.start
      yield* settle

      assert.deepStrictEqual(heard, [])
      assert.strictEqual((yield* (yield* restored.getSnapshot).children["child"]!.getSnapshotUntyped).status, "done")
      assert.isTrue(Option.isNone(yield* restored.system.get("finished-sys")))
    })
  )

  it.effect("[P3] a restored promise child that was active runs its promise again; one that was done does not", () =>
    Effect.gen(function* () {
      const calls = { pending: 0, settled: 0 }
      const pending = fromPromise<number>(() => {
        calls.pending++
        return new Promise<number>(() => {})
      })
      const settled = fromPromise<number>(() => {
        calls.settled++
        return Promise.resolve(42)
      })
      const machine = createMachine<object, EventObject>(
        {
          id: "p3-promises",
          context: {},
          entry: assign<object, EventObject>(({ spawn }) => {
            spawn("pending", { id: "pending" })
            spawn("settled", { id: "settled" })
            return {}
          }),
        },
        { actors: { pending, settled } }
      )
      const actor = yield* createActor(machine)
      yield* actor.start
      const settledChild = (yield* actor.getSnapshot).children["settled"]!
      assert.isTrue(yield* eventually(Effect.map(settledChild.getSnapshotUntyped, (snapshot) => snapshot.status === "done")))
      const persisted = throughJson(yield* actor.getPersistedSnapshot)
      yield* actor.stop
      assert.deepStrictEqual(calls, { pending: 1, settled: 1 })

      const restored = yield* createActor(machine, { snapshot: persisted })
      yield* restored.start
      yield* settle

      assert.deepStrictEqual(calls, { pending: 2, settled: 1 })
      const children = (yield* restored.getSnapshot).children
      assert.strictEqual((yield* children["pending"]!.getSnapshotUntyped).status, "active")
      const restoredSettled = yield* children["settled"]!.getSnapshotUntyped
      assert.strictEqual(restoredSettled.status, "done")
      assert.deepStrictEqual(restoredSettled.output, Option.some(42))
    })
  )

  it.effect("[P3] a persisted value that the codec rejects gives an actor in status error with Some(RestoreError)", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(powerMachine([]), { snapshot: { status: "active", value: 42, children: {} } })
      const snapshot = yield* actor.getSnapshot

      assert.strictEqual(snapshot.status, "error")
      const error = Option.getOrUndefined(snapshot.error)
      assert.instanceOf(error, Errors.RestoreError)

      // The actor errors at start with that error, as upstream starts an errored snapshot
      yield* actor.start
      assert.strictEqual((yield* actor.getSnapshot).status, "error")
    })
  )

  it.effect("[P3] a state value that names no state gives status error with a RestoreError that carries the upstream message", () =>
    Effect.gen(function* () {
      const persisted = yield* persistedPowerMachine([])

      const errorOf = (value: unknown) =>
        Effect.map(
          Effect.flatMap(createActor(powerMachine([]), { snapshot: { ...persisted, value } }), (actor) => actor.getSnapshot),
          (snapshot) => ({ status: snapshot.status, error: Option.getOrUndefined(snapshot.error) })
        )

      const shallow = yield* errorOf("nope")
      assert.strictEqual(shallow.status, "error")
      assert.instanceOf(shallow.error, Errors.RestoreError)
      assert.strictEqual((shallow.error as Errors.RestoreError).message, stateDoesNotExist("nope", "p3"))

      const deep = yield* errorOf({ on: "nope" })
      assert.strictEqual((deep.error as Errors.RestoreError).message, stateDoesNotExist("nope", "p3.on"))

      const key = yield* errorOf({ nope: "first" })
      assert.strictEqual((key.error as Errors.RestoreError).message, childStateDoesNotExist("nope", "p3"))
    })
  )

  it.effect("[P3] a history entry whose id names no state node is dropped with the upstream warning", () =>
    Effect.gen(function* () {
      const persisted = yield* persistedPowerMachine([])
      const changed = { ...persisted, historyValue: { "p3.on.hist": [{ id: "nonexistent" }] } }

      const { result: restored, warnings } = yield* withWarnings(createActor(powerMachine([]), { snapshot: changed }))

      assert.deepStrictEqual(warnings, [unresolvedHistoryStateNode("nonexistent")])
      assert.deepStrictEqual((yield* restored.getSnapshot).historyValue, {})
      yield* restored.start
      yield* restored.send({ type: "POWER" })
      assert.deepStrictEqual((yield* restored.getSnapshot).value, { on: "first" })
      assert.deepStrictEqual(throughJson(yield* restored.getPersistedSnapshot)["historyValue"], {})
    })
  )

  it.effect("[P3] a history value that is not an object restores as no history", () =>
    Effect.gen(function* () {
      const persisted = yield* persistedPowerMachine([])

      yield* Effect.forEach([null, 42, "foo", true, false], (historyValue) =>
        Effect.gen(function* () {
          const restored = yield* createActor(powerMachine([]), { snapshot: { ...persisted, historyValue } })
          const snapshot = yield* restored.getSnapshot
          assert.strictEqual(snapshot.status, "active")
          assert.deepStrictEqual(snapshot.historyValue, {})
          yield* restored.start
          yield* restored.send({ type: "POWER" })
          assert.deepStrictEqual((yield* restored.getSnapshot).value, { on: "first" })
        })
      )
      const { historyValue: _dropped, ...withoutHistory } = persisted
      const restored = yield* createActor(powerMachine([]), { snapshot: withoutHistory })
      assert.deepStrictEqual((yield* restored.getSnapshot).historyValue, {})
    })
  )

  it.effect("[P3] a done or errored promise, observable or effect actor clears its input, live and persisted, as upstream", () =>
    Effect.gen(function* () {
      interface Ended {
        readonly start: Effect.Effect<void>
        readonly getSnapshot: Effect.Effect<{ readonly status: string; readonly input: unknown }>
        readonly getPersistedSnapshot: Effect.Effect<unknown, unknown>
      }
      // The status the actor ends with, and its input in the live and the persisted snapshot
      // ("absent" when the key is missing: upstream keeps the key, with `undefined`)
      const inputAtEnd = (actor: Ended) =>
        Effect.gen(function* () {
          yield* actor.start
          assert.isTrue(yield* eventually(Effect.map(actor.getSnapshot, (snapshot) => snapshot.status !== "active")))
          const snapshot = yield* actor.getSnapshot
          const persisted = (yield* actor.getPersistedSnapshot) as Record<string, unknown>
          return {
            status: snapshot.status,
            live: Object.hasOwn(snapshot, "input") ? snapshot.input : "absent",
            persisted: Object.hasOwn(persisted, "input") ? persisted["input"] : "absent",
          }
        })
      type Input = { readonly n: number }
      const input: Input = { n: 3 }
      const emitting = (end: "complete" | "error") =>
        fromObservable<number, Input>(({ input: given }) => ({
          subscribe: (observer) => {
            observer.next?.(given.n)
            if (end === "complete") {
              observer.complete?.()
            } else {
              observer.error?.("broken")
            }
            return { unsubscribe: () => {} }
          },
        }))

      const results = [
        yield* inputAtEnd(yield* createActor(fromPromise<number, Input>(({ input: given }) => Promise.resolve(given.n)), { input })),
        yield* inputAtEnd(yield* createActor(fromPromise<number, Input>(() => Promise.reject(new Error("rejected"))), { input })),
        yield* inputAtEnd(yield* createActor(emitting("complete"), { input })),
        yield* inputAtEnd(yield* createActor(emitting("error"), { input })),
        yield* inputAtEnd(yield* createActor(fromEffect(({ input: given }: { readonly input: Input }) => Effect.succeed(given.n)), { input })),
        yield* inputAtEnd(yield* createActor(fromEffect((_: { readonly input: Input }) => Effect.fail("failed")), { input })),
      ]

      assert.deepStrictEqual(
        results.map((result) => result.status),
        ["done", "error", "done", "error", "done", "error"]
      )
      for (const result of results) {
        assert.isUndefined(result.live)
        assert.isUndefined(result.persisted)
      }
    })
  )

  it.effect("[P3] a live snapshot restores as it is: its history state nodes are kept", () =>
    Effect.gen(function* () {
      const source = yield* createActor(powerMachine([]))
      yield* source.start
      yield* source.send({ type: "SWITCH" })
      yield* source.send({ type: "POWER" })
      const live = yield* source.getSnapshot
      yield* source.stop

      const restored = yield* createActor(powerMachine([]), { snapshot: live })
      const snapshot = yield* restored.getSnapshot
      assert.strictEqual(snapshot.value, "off")
      assert.strictEqual(snapshot.historyValue["p3.on.hist"]?.[0], live.historyValue["p3.on.hist"]?.[0])

      yield* restored.start
      yield* restored.send({ type: "POWER" })
      assert.deepStrictEqual((yield* restored.getSnapshot).value, { on: "second" })
    })
  )
})
