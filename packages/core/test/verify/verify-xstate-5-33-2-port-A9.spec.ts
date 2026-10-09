/**
 * A9: spawnChild spawns with default wiring, systemId, syncSnapshot and a named src.
 *
 * T2.44. Upstream `spawnChild` in `src/actions/spawnChild.ts` at xstate@5.33.2: `resolveSpawn`
 * resolves a string src against the machine's actor implementations (`setup({ actors })`,
 * `provide`), creates the child with the machine actor as its parent, the `systemId`, the
 * `syncSnapshot` flag and the input (an input function receives `{ context, event, self }`;
 * an id function receives the action arguments), and adds it to `snapshot.children` under
 * its id; without an id option the key is "undefined" while the child's own id is its session
 * id, so a second such spawn replaces the entry (an upstream probe at xstate@5.33.2 showed
 * both; the replaced child stops with its parent here, ledger row DEV-64: D12);
 * `executeSpawn` starts it after the macrostep. An unknown src warns
 * `Actor type '<src>' not found in machine '<actor id>'.` and stores `undefined` under the id;
 * the port adds no entry (ledger row DEV-31: D7, D8, SD-22; CONF-4 pins it), so the cases
 * here pin no key. A child with `syncSnapshot` relays
 * each active snapshot to its parent as `{ type: 'xstate.snapshot.<id>', snapshot }`,
 * starting with the snapshot it starts from (`createActor.ts` `start`).
 *
 * The port registers the systemId when the child is created (T2.42), so `system.get` finds it
 * by systemId (D7); the start runs after the macrostep's actions (@ASSUMPTION:AS2.a: the order
 * is asserted, not assumed).
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Logger, Option, Stream } from "effect"
import type { ActorRefBase } from "../../src/ActorRef.js"
import {
  type ActorType,
  type AnyActorLogic,
  assign,
  createActor,
  createMachine,
  type EventObject,
  fromCallback,
  isActor,
  sendParent,
  setup,
  spawnChild,
} from "../../src/index.js"
import { actorTypeNotFound } from "./upstream-messages.js"

interface Counter {
  readonly count: number
}

type CounterEvent = { readonly type: "INC" }

/** A child that counts its `INC` events. */
const counterLogic = () =>
  createMachine<Counter, CounterEvent>({
    id: "counter",
    initial: "on",
    context: { count: 0 },
    states: {
      on: { on: { INC: { actions: assign<Counter, CounterEvent>(({ context }) => ({ count: context.count + 1 })) } } },
    },
  })

/** The child actor behind a reference; fails the test when the reference is not an actor. */
const asActor = (ref: ActorRefBase | undefined): ActorType.Any => {
  assert.isTrue(isActor(ref), "the reference is an actor")
  return ref as ActorType.Any
}

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

/** Runs `program` with a logger that keeps the text of every warning. */
const withWarningsCaptured = <A, E, R>(program: Effect.Effect<A, E, R>) => {
  const warnings: Array<string> = []
  return program.pipe(
    Effect.provide(
      Logger.layer([
        Logger.make((options) => {
          if (options.logLevel === "Warn") {
            const parts: ReadonlyArray<unknown> = Array.isArray(options.message) ? options.message : [options.message]
            warnings.push(parts.map(String).join(" "))
          }
        }),
      ])
    ),
    Effect.map((result) => ({ result, warnings }))
  )
}

type GoEvent = { readonly type: "GO" }

describe("A9 spawnChild spawns with default wiring, systemId, syncSnapshot and a named src", () => {
  it.effect("[A9] spawnChild with a setup actor name and a systemId starts the child after the macrostep; snapshot.children holds it and system.get finds it", () =>
    Effect.gen(function* () {
      const order: Array<string> = []
      const worker = fromCallback(() => {
        order.push("child started")
      })
      const machine = setup({
        types: {} as { context: object; events: GoEvent },
        actors: { worker },
      }).createMachine({
        id: "a9-named",
        context: {},
        on: {
          GO: {
            actions: [
              spawnChild<object, GoEvent, AnyActorLogic>("worker", { id: "w", systemId: "worker-sys" }),
              () => {
                order.push("parent action after spawnChild")
              },
            ],
          },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      assert.deepStrictEqual(Object.keys((yield* actor.getSnapshot).children), [])

      yield* actor.send({ type: "GO" })

      // The child starts after the macrostep: after the action that follows spawnChild
      assert.deepStrictEqual(order, ["parent action after spawnChild", "child started"])
      const snapshot = yield* actor.getSnapshot
      const child = snapshot.children["w"]
      assert.isDefined(child)
      assert.strictEqual(child?.id, "w")
      assert.strictEqual(child?.src, "worker")
      const found = yield* actor.system.get("worker-sys")
      assert.isTrue(Option.isSome(found) && found.value === child)
      assert.strictEqual(asActor(child).systemId, "worker-sys")
    })
  )

  it.effect("[A9] the logic of a child spawned in the initial state runs only when the parent starts", () =>
    Effect.gen(function* () {
      const order: Array<string> = []
      const worker = fromCallback(() => {
        order.push("child started")
      })
      const machine = createMachine<object, GoEvent>({
        id: "a9-initial",
        context: {},
        entry: spawnChild<object, GoEvent, typeof worker>(worker, { id: "early" }),
      })
      const actor = yield* createActor(machine)

      // Created with the parent's initial snapshot, not started
      assert.isDefined((yield* actor.getSnapshot).children["early"])
      assert.deepStrictEqual(order, [])

      yield* actor.start

      assert.deepStrictEqual(order, ["child started"])
    })
  )

  it.effect("[A9] with syncSnapshot, each active snapshot of the child reaches the parent as xstate.snapshot.<id>, from the snapshot it starts with", () =>
    Effect.gen(function* () {
      interface Seen {
        readonly synced: ReadonlyArray<number>
        readonly quiet: number
      }
      type SeenEvent = {
        readonly type: "xstate.snapshot.synced" | "xstate.snapshot.quiet"
        readonly snapshot: { readonly context: Counter }
      }
      const machine = createMachine<Seen, SeenEvent>({
        id: "a9-sync",
        context: { synced: [], quiet: 0 },
        entry: [
          spawnChild<Seen, SeenEvent, ReturnType<typeof counterLogic>>(counterLogic(), { id: "synced", syncSnapshot: true }),
          spawnChild<Seen, SeenEvent, ReturnType<typeof counterLogic>>(counterLogic(), { id: "quiet" }),
        ],
        on: {
          "xstate.snapshot.synced": {
            actions: assign<Seen, SeenEvent>(({ context, event }) => ({ synced: [...context.synced, event.snapshot.context.count] })),
          },
          "xstate.snapshot.quiet": {
            actions: assign<Seen, SeenEvent>(({ context }) => ({ quiet: context.quiet + 1 })),
          },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      const children = (yield* actor.getSnapshot).children

      yield* asActor(children["synced"]).send({ type: "INC" })
      yield* asActor(children["synced"]).send({ type: "INC" })
      yield* asActor(children["quiet"]).send({ type: "INC" })

      const seen = actor.getSnapshot.pipe(Effect.map((snapshot) => snapshot.context.synced.length >= 3))
      assert.isTrue(yield* eventually(seen))
      yield* settle
      const snapshot = yield* actor.getSnapshot
      assert.deepStrictEqual(snapshot.context.synced, [0, 1, 2])
      assert.strictEqual(snapshot.context.quiet, 0)
    })
  )

  it.effect("[A9] spawnChild takes the id and the input from functions of the context", () =>
    Effect.gen(function* () {
      interface Numbered {
        readonly n: number
      }
      const inputs: Array<string> = []
      const greeter = fromCallback<EventObject, { readonly name: string }>(({ input }) => {
        inputs.push(input.name)
      })
      const machine = createMachine<Numbered, GoEvent>({
        id: "a9-dynamic",
        context: { n: 7 },
        entry: spawnChild<Numbered, GoEvent, typeof greeter>(greeter, {
          id: ({ context }) => `child-${context.n}`,
          // A machine without declared actors gives an input function no contextual type
          // (upstream SpawnArguments: input?: unknown), so its parameter is annotated
          input: ({ context }: { readonly context: Numbered }) => ({ name: `n${context.n}` }),
        }),
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      assert.deepStrictEqual(Object.keys((yield* actor.getSnapshot).children), ["child-7"])
      assert.deepStrictEqual(inputs, ["n7"])
    })
  )

  it.effect("[A9] the spawned child has the machine actor as its parent: its sendParent reaches the parent", () =>
    Effect.gen(function* () {
      interface Greeted {
        readonly hello: boolean
      }
      type HelloEvent = { readonly type: "HELLO" }
      const greeter = createMachine<object, EventObject>({
        id: "greeter",
        context: {},
        entry: sendParent<object, EventObject>({ type: "HELLO" }),
      })
      const machine = createMachine<Greeted, HelloEvent>({
        id: "a9-parent",
        context: { hello: false },
        entry: spawnChild<Greeted, HelloEvent, typeof greeter>(greeter, { id: "greeter" }),
        on: { HELLO: { actions: assign<Greeted, HelloEvent>({ hello: true }) } },
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      const child = asActor((yield* actor.getSnapshot).children["greeter"])
      assert.isTrue(Option.isSome(child._parent) && child._parent.value === actor)
      assert.strictEqual(child._system, actor.system)
      assert.isTrue(yield* eventually(Effect.map(actor.getSnapshot, (snapshot) => snapshot.context.hello)))
    })
  )

  it.effect("[A9] spawnChild with a src that names no implementation warns with the recorded message and changes no status", () =>
    Effect.gen(function* () {
      const machine = createMachine<object, GoEvent>({
        id: "a9-missing",
        context: {},
        on: { GO: { actions: spawnChild<object, GoEvent, AnyActorLogic>("missing", { id: "m" }) } },
      })

      const { result, warnings } = yield* withWarningsCaptured(
        Effect.gen(function* () {
          const actor = yield* createActor(machine, { id: "a9-parent-actor" })
          yield* actor.start
          yield* actor.send({ type: "GO" })
          return yield* actor.getSnapshot
        })
      )

      assert.strictEqual(result.status, "active")
      // Upstream's keys are ["m"] (its value `undefined`); the port adds no entry (DEV-31)
      assert.deepStrictEqual(Object.keys(result.children), [])
      assert.deepStrictEqual(
        warnings.filter((warning) => warning.startsWith("Actor type")),
        [actorTypeNotFound("missing", "a9-parent-actor")]
      )
    })
  )

  it.effect("[A9] spawnChild with a src that names no implementation never calls its input function, and with a known src calls it once", () =>
    Effect.gen(function* () {
      // Upstream `resolveSpawn` resolves the input only for a logic it found
      const inputs: Array<string> = []
      const machine = setup({ actors: { counter: counterLogic() } }).createMachine({
        id: "a9-input",
        context: {},
        on: {
          MISSING: {
            actions: spawnChild("missing" as "counter", {
              id: "m",
              input: () => {
                inputs.push("missing")
                throw new Error("the input of an unknown src")
              },
            }),
          },
          KNOWN: {
            actions: spawnChild("counter", {
              id: "k",
              input: () => {
                inputs.push("counter")
                return undefined
              },
            }),
          },
        },
      })

      const { result, warnings } = yield* withWarningsCaptured(
        Effect.gen(function* () {
          const actor = yield* createActor(machine, { id: "a9-input-actor" })
          yield* actor.start
          yield* actor.send({ type: "MISSING" })
          const afterMissing = yield* actor.getSnapshot
          yield* actor.send({ type: "KNOWN" })
          return { afterMissing, afterKnown: yield* actor.getSnapshot }
        })
      )

      assert.strictEqual(result.afterMissing.status, "active")
      // Upstream's keys are ["m"] (its value `undefined`); the port adds no entry (DEV-31)
      assert.deepStrictEqual(Object.keys(result.afterMissing.children), [])
      assert.deepStrictEqual(
        warnings.filter((warning) => warning.startsWith("Actor type")),
        [actorTypeNotFound("missing", "a9-input-actor")]
      )
      assert.strictEqual(result.afterKnown.status, "active")
      assert.deepStrictEqual(Object.keys(result.afterKnown.children), ["k"])
      assert.deepStrictEqual(inputs, ["counter"])
    })
  )

  it.effect("[A9] spawnChild without an id keeps the child under the key \"undefined\", and the child's id is its session id", () =>
    Effect.gen(function* () {
      // Upstream `resolveSpawn` keys `snapshot.children` by the resolved id option, which is
      // `undefined` without an id, while `createActor` gives the child its session id as its id
      const worker = fromCallback(() => {})
      const machine = setup({ actors: { worker } }).createMachine({
        id: "a9-anonymous",
        context: {},
        entry: spawnChild("worker"),
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      const snapshot = yield* actor.getSnapshot
      assert.deepStrictEqual(Object.keys(snapshot.children), ["undefined"])
      const child = asActor(snapshot.children["undefined"])
      // The root is x:0 and its first child x:1 (SD-9)
      assert.strictEqual(child.id, "x:1")
      assert.strictEqual(child.sessionId, "x:1")
      const persisted = (yield* actor.getPersistedSnapshot) as { readonly children: object }
      assert.deepStrictEqual(Object.keys(persisted.children), ["undefined"])
    })
  )

  it.effect("[A9] a second spawnChild without an id replaces the first child under the key \"undefined\"; an inline logic is keyed the same", () =>
    Effect.gen(function* () {
      const worker = fromCallback(() => {})
      const machine = createMachine<object, GoEvent>({
        id: "a9-anonymous-twice",
        context: {},
        entry: [
          spawnChild<object, GoEvent, typeof worker>(worker),
          spawnChild<object, GoEvent, typeof worker>(worker),
        ],
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      const snapshot = yield* actor.getSnapshot
      assert.deepStrictEqual(Object.keys(snapshot.children), ["undefined"])
      assert.strictEqual(asActor(snapshot.children["undefined"]).id, "x:2")
    })
  )

  it.effect("[A9] a child that a later spawnChild replaced in snapshot.children stops with its parent, at stop and at a final state (DEV-64)", () =>
    Effect.gen(function* () {
      // Upstream stops only the children its snapshot holds, so the replaced child keeps
      // running; here every child lives in the parent's scope (D12, ledger row DEV-64)
      const cleanups: Array<string> = []
      let started = 0
      const worker = fromCallback(() => {
        started += 1
        const n = started
        return () => {
          cleanups.push(`child ${n}`)
        }
      })
      const anonymous = createMachine<object, GoEvent>({
        id: "a9-replaced-stop",
        context: {},
        entry: [
          spawnChild<object, GoEvent, typeof worker>(worker),
          spawnChild<object, GoEvent, typeof worker>(worker),
        ],
      })
      const stopped = yield* createActor(anonymous)
      yield* stopped.start
      yield* stopped.stop
      assert.deepStrictEqual([...cleanups].sort(), ["child 1", "child 2"])

      cleanups.length = 0
      started = 0
      const sameId = createMachine<object, GoEvent>({
        id: "a9-replaced-final",
        context: {},
        initial: "running",
        entry: [
          spawnChild<object, GoEvent, typeof worker>(worker, { id: "same" }),
          spawnChild<object, GoEvent, typeof worker>(worker, { id: "same" }),
        ],
        states: { running: { on: { GO: "done" } }, done: { type: "final" } },
      })
      const finished = yield* createActor(sameId)
      yield* finished.start
      assert.deepStrictEqual(Object.keys((yield* finished.getSnapshot).children), ["same"])
      yield* finished.send({ type: "GO" })
      assert.strictEqual((yield* finished.getSnapshot).status, "done")
      assert.isTrue(yield* eventually(Effect.sync(() => cleanups.length === 2)))
      assert.deepStrictEqual([...cleanups].sort(), ["child 1", "child 2"])
    })
  )
})
