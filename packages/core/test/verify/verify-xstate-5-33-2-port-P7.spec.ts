/**
 * P7: pure transition functions return actions without running them.
 *
 * T6.9. Upstream `transition(logic, snapshot, event)` and `initialTransition(logic, input?)`
 * in `src/transition.ts` at xstate@5.33.2 run the logic against `createInertActorScope`
 * (`src/getNextSnapshot.ts`) with an action executor that pushes each action it receives and
 * runs none, and return `[nextSnapshot, actions]`: the custom actions, and the built-in actions
 * that have an `execute` (raise, sendTo, cancel, emit, log, spawnChild, stopChild) with their
 * resolved params; `assign` resolves and is not among them. `getNextSnapshot` and
 * `getInitialSnapshot` use the inert scope as it is, whose `actionExecutor` is `() => {}`, so
 * they run no action either. A guard that throws is thrown from the call (the port fails the
 * Effect with the guard-evaluation `GuardError`, SD-3, SD-13). Issue #5454: the inert scope
 * gives each call a fresh system, so an invoke with a `systemId` never collides with an
 * earlier call.
 *
 * T8.8, as upstream: each executable action carries `info` (`{ context, event, self, system }`
 * of its point of the list); a spawn's params hold the `id` option as given (a function stays a
 * function) and no input when the src names no actor; a send to an actor the same entry list
 * invokes holds that actor in `params.to` once the list has run (`retryResolveSendTo`).
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Logger } from "effect"
import {
  type AnyActorRef,
  assign,
  cancel,
  createActor,
  createMachine,
  emit,
  enqueueActions,
  type EventObject,
  fromTransition,
  getInitialSnapshot,
  getNextSnapshot,
  initialTransition,
  log,
  raise,
  sendTo,
  spawnChild,
  transition,
} from "../../src/index.js"
import { guardEvaluationFailed } from "./upstream-messages.js"

/** The log entries a test logger kept. */
type Entries = Array<Logger.Options<unknown>>

/** Runs `program` with a logger that keeps every log entry in `entries`. */
const withLogger = <A, E, R>(entries: Entries, program: Effect.Effect<A, E, R>) =>
  program.pipe(
    Effect.provide(
      Logger.layer([
        Logger.make((options) => {
          entries.push(options)
        }),
      ])
    )
  )

/** Lets every other ready fiber take a bounded number of turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 50; turn++) {
    yield* Effect.yieldNow
  }
})

/** The type of each action, in order. */
const typesOf = (actions: ReadonlyArray<{ readonly type: string }>): ReadonlyArray<string> => actions.map((action) => action.type)

/** The params of the first action of `type`. */
const paramsOf = (actions: ReadonlyArray<{ readonly type: string; readonly params: unknown }>, type: string): unknown =>
  actions.find((action) => action.type === type)?.params

/** An actor that counts the events it receives. */
const counter = fromTransition((count: number, _event: EventObject) => count + 1, 0)

interface Ctx {
  readonly count: number
}

/**
 * Entry: a custom action, a log, an assign, a delayed raise, an enqueued custom action; an
 * invoked child `child`. On `GO`: a send to `receiver`, an emit, a cancel of the delayed raise
 * and a custom action, to `b`.
 */
const pureMachine = (ran: Array<string>, receiver: AnyActorRef) =>
  createMachine<Ctx, { readonly type: "GO" } | { readonly type: "LATER" }>({
    id: "p7",
    context: { count: 0 },
    initial: "a",
    entry: [
      function enter() {
        ran.push("entry")
      },
      log("hello", "p7"),
      assign<Ctx, { readonly type: "GO" } | { readonly type: "LATER" }>({ count: 5 }),
      raise({ type: "LATER" }, { delay: 100, id: "later" }),
      enqueueActions(({ enqueue }) => {
        enqueue(function enqueued() {
          ran.push("enqueued")
        })
      }),
    ],
    invoke: { id: "child", src: counter },
    states: {
      a: {
        on: {
          GO: {
            target: "b",
            actions: [
              sendTo(() => receiver, { type: "PING" }),
              emit({ type: "EMITTED" }),
              cancel("later"),
              function go() {
                ran.push("go")
              },
            ],
          },
        },
      },
      b: {},
    },
  })

describe("P7 Pure transition functions return actions without running them", () => {
  it.effect("[P7] initialTransition and transition return the next snapshot and the actions in order, with resolved params, and run none of them", () =>
    Effect.gen(function* () {
      const ran: Array<string> = []
      const entries: Entries = []
      const receiver = yield* createActor(counter)
      yield* receiver.start
      const machine = pureMachine(ran, receiver)

      const [initial, initialActions] = yield* withLogger(entries, initialTransition(machine))
      assert.strictEqual(initial.value, "a")
      // assign resolves and is not an action
      assert.strictEqual(initial.context.count, 5)
      assert.deepStrictEqual(typesOf(initialActions), ["enter", "xstate.log", "xstate.raise", "enqueued", "xstate.spawnChild"])
      assert.deepStrictEqual(paramsOf(initialActions, "xstate.log"), { value: "hello", label: "p7" })
      assert.deepStrictEqual(paramsOf(initialActions, "xstate.raise"), { event: { type: "LATER" }, id: "later", delay: 100 })
      assert.deepInclude(paramsOf(initialActions, "xstate.spawnChild") as object, { id: "child", src: "xstate.invoke.0.p7" })

      const [next, actions] = yield* withLogger(entries, transition(machine, initial, { type: "GO" }))
      assert.strictEqual(next.value, "b")
      assert.deepStrictEqual(typesOf(actions), ["xstate.sendTo", "xstate.emit", "xstate.cancel", "go"])
      assert.deepInclude(paramsOf(actions, "xstate.sendTo") as object, { event: { type: "PING" }, to: receiver, delay: undefined })
      assert.deepStrictEqual(paramsOf(actions, "xstate.emit"), { event: { type: "EMITTED" } })
      assert.deepStrictEqual(paramsOf(actions, "xstate.cancel"), { sendId: "later" })

      // Nothing ran: no custom action, no log, no send
      yield* settle
      assert.deepStrictEqual(ran, [])
      assert.deepStrictEqual(
        entries.filter((entry) => JSON.stringify(entry.message).includes("hello")),
        []
      )
      assert.strictEqual((yield* receiver.getSnapshot).context, 0)
    })
  )

  it.effect("[P7] the same machine in an actor runs those actions, so the pure calls skip real work", () =>
    Effect.gen(function* () {
      const ran: Array<string> = []
      const receiver = yield* createActor(counter)
      yield* receiver.start
      const actor = yield* createActor(pureMachine(ran, receiver))
      yield* actor.start
      yield* actor.send({ type: "GO" })
      yield* settle
      assert.deepStrictEqual(ran, ["entry", "enqueued", "go"])
      assert.strictEqual((yield* receiver.getSnapshot).context, 1)
    })
  )

  it.effect("[P7] getNextSnapshot and getInitialSnapshot run no custom action but apply assign", () =>
    Effect.gen(function* () {
      const ran: Array<string> = []
      const machine = createMachine<Ctx, { readonly type: "INC" }>({
        id: "p7-assign",
        context: { count: 0 },
        entry: [
          function entered() {
            ran.push("entry")
          },
          assign<Ctx, { readonly type: "INC" }>({ count: 1 }),
        ],
        on: {
          INC: {
            actions: [
              assign<Ctx, { readonly type: "INC" }>({ count: ({ context }) => context.count + 1 }),
              function incremented() {
                ran.push("inc")
              },
            ],
          },
        },
      })
      const initial = yield* getInitialSnapshot(machine)
      assert.strictEqual(initial.context.count, 1)
      const next = yield* getNextSnapshot(machine, initial, { type: "INC" })
      assert.strictEqual(next.context.count, 2)
      assert.deepStrictEqual(ran, [])
    })
  )

  it.effect("[P7] a throwing guard fails transition and getNextSnapshot with the guard-evaluation error, never the previous snapshot", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "p7-guard",
        initial: "a",
        states: {
          a: {
            on: {
              GO: {
                target: "b",
                guard: () => {
                  throw new Error("guard broke")
                },
              },
            },
          },
          b: {},
        },
      })
      const [initial] = yield* initialTransition(machine)
      const message = guardEvaluationFailed("", "GO", "p7-guard.a", "guard broke")
      const fromTransition = yield* Effect.flip(transition(machine, initial, { type: "GO" }))
      assert.strictEqual(fromTransition.message, message)
      const fromGetNextSnapshot = yield* Effect.flip(getNextSnapshot(machine, initial, { type: "GO" }))
      assert.strictEqual(fromGetNextSnapshot.message, message)
    })
  )

  it.effect("[P7] initialTransition stays idempotent for invoked actors with systemIds (issue #5454)", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "p7-system",
        initial: "idle",
        states: {
          idle: {
            invoke: [
              { src: counter, systemId: "one" },
              { src: counter, systemId: "two" },
            ],
          },
        },
      })
      for (let call = 0; call < 3; call++) {
        const [snapshot, actions] = yield* initialTransition(machine)
        assert.strictEqual(snapshot.value, "idle")
        assert.strictEqual(snapshot.status, "active")
        assert.deepStrictEqual(
          actions.map((action) => (action.params as { readonly systemId?: string }).systemId),
          ["one", "two"]
        )
      }
    })
  )

  it.effect("[P7] each child a pure call creates gets its own id from the call's fresh system, as in an actor", () =>
    Effect.gen(function* () {
      // Upstream: the fresh system of the inert scope books a session id for each child from a
      // global counter, so two anonymous spawns are two children, and a later call never reuses
      // the id of a child its snapshot holds (the port's numbers follow SD-9)
      const machine = createMachine({
        id: "p7-ids",
        context: ({ spawn }) => ({ first: spawn(counter), second: spawn(counter) }),
        on: {
          MORE: {
            actions: assign(({ spawn }) => ({ first: spawn(counter), second: spawn(counter) })),
          },
        },
      })
      const initial = yield* getInitialSnapshot(machine)
      assert.strictEqual(Object.keys(initial.children).length, 2)
      const [again] = yield* initialTransition(machine)
      assert.strictEqual(Object.keys(again.children).length, 2)
      // A transition adds two more children, each with its own id
      const next = yield* getNextSnapshot(machine, initial, { type: "MORE" })
      assert.strictEqual(new Set(Object.keys(next.children)).size, 4)
      // The same machine in an actor has two children too
      const actor = yield* createActor(machine)
      yield* actor.start
      assert.strictEqual(Object.keys((yield* actor.getSnapshot).children).length, 2)
    })
  )

  it.effect("[P7] each executable action carries info: the context at its point of the list, the event, self and system (upstream ExecutableActionObject.info)", () =>
    Effect.gen(function* () {
      type Ev = { readonly type: "GO" }
      const machine = createMachine<Ctx, Ev>({
        id: "p7-info",
        context: { count: 0 },
        initial: "a",
        entry: function entered() {},
        states: {
          a: {
            on: {
              GO: {
                target: "b",
                actions: [function before() {}, assign<Ctx, Ev>({ count: 1 }), log("after"), function last() {}],
              },
            },
          },
          b: {},
        },
      })
      const [initial, initialActions] = yield* initialTransition(machine)
      assert.deepStrictEqual(initialActions[0]!.info.context, { count: 0 })
      assert.deepStrictEqual<unknown>(initialActions[0]!.info.event, { type: "xstate.init", input: undefined })

      const [, actions] = yield* transition(machine, initial, { type: "GO" })
      assert.deepStrictEqual(typesOf(actions), ["before", "xstate.log", "last"])
      // Upstream `actionArgs`: the context the earlier actions of the list left
      assert.deepStrictEqual(
        actions.map((action) => action.info.context),
        [{ count: 0 }, { count: 1 }, { count: 1 }]
      )
      for (const action of actions) {
        assert.deepStrictEqual(action.info.event, { type: "GO" })
        assert.isDefined(action.info.self)
        assert.isDefined(action.info.system)
      }
      // One actor and one system for the whole call
      assert.strictEqual(actions[0]!.info.self, actions[2]!.info.self)
      assert.strictEqual(actions[0]!.info.system, actions[2]!.info.system)
    })
  )

  it.effect("[P7] a spawnChild's executable params hold its id option as given and no input for a src that names no actor (upstream resolveSpawn)", () =>
    Effect.gen(function* () {
      type Ev = { readonly type: "GO" }
      const idOf = ({ context }: { readonly context: Ctx }) => `child-${context.count}`
      const machine = createMachine<Ctx, Ev>({
        id: "p7-spawn",
        context: { count: 3 },
        on: {
          GO: {
            actions: [spawnChild(counter, { id: idOf }), spawnChild("missing", { id: "lost", input: 42 })],
          },
        },
      })
      const initial = yield* getInitialSnapshot(machine)
      const [next, actions] = yield* withLogger([], transition(machine, initial, { type: "GO" }))
      const spawns = actions.filter((action) => action.type === "xstate.spawnChild").map((action) => action.params)
      assert.strictEqual(spawns.length, 2)
      // The id function itself, while the child has the id it resolved to
      const [byFunction, missing] = spawns as ReadonlyArray<{ readonly [key: string]: unknown }>
      assert.strictEqual(byFunction!["id"], idOf)
      assert.strictEqual(byFunction!["actorRef"], next.children["child-3"])
      assert.strictEqual(missing!["id"], "lost")
      assert.strictEqual(missing!["actorRef"], undefined)
      assert.strictEqual(missing!["src"], "missing")
      assert.strictEqual(missing!["input"], undefined)
    })
  )

  it.effect("[P7] a send to a child the same entry list invokes holds the child in its params once the call returns (upstream retryResolveSendTo)", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "p7-deferred",
        initial: "a",
        states: {
          a: { on: { GO: "b" } },
          b: { entry: sendTo("child", { type: "PING" }), invoke: { id: "child", src: counter } },
        },
      })
      const [initial] = yield* initialTransition(machine)
      const [next, actions] = yield* transition(machine, initial, { type: "GO" })
      const sent = paramsOf(actions, "xstate.sendTo") as { readonly to: unknown; readonly targetId: unknown }
      assert.strictEqual(sent.targetId, "child")
      assert.isDefined(next.children["child"])
      assert.strictEqual(sent.to, next.children["child"])
    })
  )
})
