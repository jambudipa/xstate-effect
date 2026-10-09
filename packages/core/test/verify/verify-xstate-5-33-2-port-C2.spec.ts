/**
 * C2: a state invoke runs, routes its results and stops on exit.
 *
 * T5.5 (T4.30 built the spawn and the stop). Upstream (`src/stateUtils.ts` at xstate@5.33.2):
 * `enterStates` runs, for each entered node, its entry actions, then a `spawnChild` per
 * invocation (`{ ...invokeDef, syncSnapshot: !!invokeDef.onSnapshot }`), then its initial
 * actions, all in one action list whose `deferredActorIds` are the node's invoke ids: a
 * `sendTo` in that list that names one of them resolves after the list (`retryResolveSendTo`),
 * so an entry action reaches the child the same node invokes. `exitStates` runs each exited
 * node's exit actions, then a `stopChild` per invocation. The child's `xstate.done.actor.<id>`,
 * `xstate.error.actor.<id>` and `xstate.snapshot.<id>` events take the invocation's `onDone`,
 * `onError` and `onSnapshot` transitions through the normal selection. `macrostep` stops every
 * child once the snapshot is no longer active (`stopChildren`): a machine that reaches a
 * top-level final state stops its root invocations in the deferred phase, before its observers
 * receive the done snapshot, and the done snapshot keeps their references.
 *
 * Every expectation below is what upstream gives for the same machine (a tsx probe of 5.33.2,
 * `packages/core/.upstream/measure/t55/probe-up.ts`), in Effect form: `onDone`'s
 * `event.output` is an Option (D8), an unknown src warns and adds no `snapshot.children` entry
 * (DEV-31), an error is the actor's status `error` (SD-4), and the children run in their own
 * fibers (SD-23), so a test waits for their events with `settled`.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Logger, Option } from "effect"
import type { ActorRefBase } from "../../src/ActorRef.js"
import {
  type ActorType,
  assign,
  createActor,
  createMachine,
  type EventObject,
  fromCallback,
  fromEffect,
  fromPromise,
  isActor,
  sendTo,
  setup,
} from "../../src/index.js"
import { actorTypeNotFound } from "./upstream-messages.js"

/**
 * Yields the test's fiber until `holds` is true, at most 1000 times and never on wall-clock
 * time: the invoked children run in their own fibers and reach the parent through its mailbox.
 */
const settled = (holds: () => Effect.Effect<boolean>) => Effect.yieldNow.pipe(Effect.repeat({ until: holds, times: 1000 }))

/** Lets every other ready fiber take a hundred turns. */
const settle = Effect.yieldNow.pipe(Effect.repeat({ times: 100 }))

/** The child actor behind a reference; fails the test when the reference is not an actor. */
const asActor = (ref: ActorRefBase | undefined): ActorType.Any => {
  assert.isTrue(isActor(ref), "the reference is an actor")
  return ref as ActorType.Any
}

/** The status the actor's snapshot has now. */
const statusOf = (actor: Pick<ActorType.Any, "getSnapshotUntyped">) =>
  Effect.map(actor.getSnapshotUntyped, (snapshot) => snapshot.status)

/** A promise that the test settles by hand, as upstream tests use `Promise.withResolvers()`. */
const makeGate = <A>() => {
  const handles: { resolve: (value: A) => void; reject: (error: unknown) => void } = {
    resolve: () => {},
    reject: () => {},
  }
  const promise = new Promise<A>((resolve, reject) => {
    handles.resolve = resolve
    handles.reject = reject
  })
  return { promise, resolve: (value: A) => handles.resolve(value), reject: (error: unknown) => handles.reject(error) }
}

/** Runs `program` with a logger that keeps the text of every Warn-level entry in `warnings`. */
const withWarnings = <A, E, R>(warnings: Array<string>, program: Effect.Effect<A, E, R>) =>
  program.pipe(
    Effect.provide(
      Logger.layer([
        Logger.make((options) => {
          if (options.logLevel === "Warn") {
            warnings.push((Array.isArray(options.message) ? options.message : [options.message]).map(String).join(" "))
          }
        }),
      ])
    )
  )

describe("C2 State invoke runs, routes results and stops on exit", () => {
  it.effect("[C2] a state invokes a promise by name with an input function; onSnapshot takes the child's start snapshot and onDone receives event.output as Some of the value", () =>
    Effect.gen(function* () {
      const gate = makeGate<number>()
      const seen: Array<unknown> = []
      const machine = setup({
        types: {} as { context: { readonly n: number }; events: EventObject },
        actors: {
          fetch: fromPromise(({ input }: { input: unknown }) => {
            seen.push(["input", input])
            return gate.promise
          }),
        },
      }).createMachine({
        context: { n: 3 },
        initial: "a",
        states: {
          a: {
            invoke: {
              src: "fetch",
              input: ({ context }: { context: { readonly n: number } }) => context.n * 2,
              onDone: { target: "b", actions: ({ event }) => { seen.push(["done", event]) } },
              onError: { target: "c" },
              onSnapshot: {
                actions: ({ event }) => {
                  seen.push(["snapshot", event.type, (event as unknown as { snapshot: { status: string } }).snapshot.status])
                },
              },
            },
          },
          b: {},
          c: {},
        },
      })

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      const child = asActor((yield* actor.getSnapshot).children["0.(machine).a"])
      yield* settled(() => Effect.sync(() => seen.length >= 2))
      assert.deepStrictEqual(seen, [
        ["input", 6],
        ["snapshot", "xstate.snapshot.0.(machine).a", "active"],
      ])
      assert.strictEqual(yield* statusOf(child), "active")

      yield* Effect.sync(() => gate.resolve(5))
      yield* settled(() => Effect.map(actor.getSnapshot, (snapshot) => snapshot.value === "b"))
      assert.strictEqual((yield* actor.getSnapshot).value, "b")
      assert.deepStrictEqual(seen.slice(2), [
        ["done", { type: "xstate.done.actor.0.(machine).a", output: Option.some(5), actorId: "0.(machine).a" }],
      ])
      assert.deepStrictEqual(Object.keys((yield* actor.getSnapshot).children), [])
    }))

  it.effect("[C2] an onDone list is tried in order: the done event takes the first transition whose guard passes", () =>
    Effect.gen(function* () {
      const outputOf = (event: EventObject) => (event as unknown as { output: Option.Option<unknown> }).output
      const machineFor = (value: number) =>
        createMachine({
          initial: "active",
          states: {
            active: {
              invoke: {
                id: "childActor",
                src: fromPromise(() => Promise.resolve(value)),
                onDone: [
                  { target: "success", guard: ({ event }) => Option.contains(outputOf(event), 42) },
                  { target: "failure" },
                ],
              },
            },
            success: { type: "final" },
            failure: { type: "final" },
          },
        })

      const hit = yield* Effect.tap(createActor(machineFor(42)), (started) => started.start)
      yield* settled(() => Effect.map(hit.getSnapshot, (snapshot) => snapshot.status === "done"))
      assert.strictEqual((yield* hit.getSnapshot).value, "success")

      const miss = yield* Effect.tap(createActor(machineFor(7)), (started) => started.start)
      yield* settled(() => Effect.map(miss.getSnapshot, (snapshot) => snapshot.status === "done"))
      assert.strictEqual((yield* miss.getSnapshot).value, "failure")
    }))

  it.effect("[C2] a rejection takes onError with the raw error", () =>
    Effect.gen(function* () {
      const boom = new Error("rejected")
      const gate = makeGate<number>()
      const errors: Array<unknown> = []
      const machine = createMachine({
        initial: "a",
        states: {
          a: {
            invoke: {
              id: "job",
              src: fromPromise(() => gate.promise),
              onError: {
                target: "failed",
                actions: ({ event }) => {
                  errors.push((event as unknown as { error: unknown }).error)
                },
              },
            },
          },
          failed: {},
        },
      })

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* Effect.sync(() => gate.reject(boom))
      yield* settled(() => Effect.map(actor.getSnapshot, (snapshot) => snapshot.value === "failed"))
      assert.strictEqual((yield* actor.getSnapshot).value, "failed")
      assert.strictEqual(errors.length, 1)
      assert.strictEqual(errors[0], boom)
      assert.strictEqual((yield* actor.getSnapshot).status, "active")
    }))

  it.effect("[C2] the child is in snapshot.children while the state is active; leaving the state stops it, and its late result is ignored", () =>
    Effect.gen(function* () {
      const gate = makeGate<number>()
      const signals: Array<AbortSignal> = []
      const done: Array<unknown> = []
      const machine = createMachine({
        initial: "a",
        states: {
          a: {
            invoke: {
              id: "job",
              src: fromPromise(({ signal }) => {
                signals.push(signal)
                return gate.promise
              }),
              onDone: { target: "b", actions: ({ event }) => { done.push(event) } },
            },
            on: { CANCEL: "c" },
          },
          b: {},
          c: {},
        },
      })

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      const child = asActor((yield* actor.getSnapshot).children["job"])
      assert.strictEqual(yield* statusOf(child), "active")

      yield* actor.send({ type: "CANCEL" })
      assert.deepStrictEqual(Object.keys((yield* actor.getSnapshot).children), [])
      yield* settled(() => Effect.map(statusOf(child), (status) => status === "stopped"))
      assert.strictEqual(yield* statusOf(child), "stopped")
      assert.isTrue(signals[0]?.aborted)

      yield* Effect.sync(() => gate.resolve(5))
      yield* settle
      assert.deepStrictEqual(done, [])
      assert.strictEqual((yield* actor.getSnapshot).value, "c")
    }))

  it.effect("[C2] the invocations of a state get the ids <index>.<node id>; a root transition that does not reenter keeps the root invocation and restarts the target's; a reentering one restarts both", () =>
    Effect.gen(function* () {
      const starts: Array<string> = []
      const childOf = (name: string) => fromCallback(() => { starts.push(name) })
      const machine = createMachine({
        id: "m",
        invoke: { src: childOf("root") },
        initial: "a",
        states: {
          a: {
            invoke: [{ src: childOf("first") }, { id: "named", src: childOf("second") }, { src: childOf("third") }],
          },
        },
        on: { STAY: { actions: () => {} }, INNER: { target: ".a" }, AGAIN: { target: ".a", reenter: true } },
      })

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      assert.deepStrictEqual(Object.keys((yield* actor.getSnapshot).children), ["0.m", "0.m.a", "named", "2.m.a"])
      assert.deepStrictEqual(starts, ["root", "first", "second", "third"])
      const root = (yield* actor.getSnapshot).children["0.m"]

      yield* actor.send({ type: "STAY" })
      assert.strictEqual((yield* actor.getSnapshot).children["0.m"], root)
      assert.deepStrictEqual(starts, ["root", "first", "second", "third"])

      yield* actor.send({ type: "INNER" })
      assert.strictEqual((yield* actor.getSnapshot).children["0.m"], root)
      assert.deepStrictEqual(starts.slice(4), ["first", "second", "third"])

      // upstream: no domain for a reentering root transition, so the root exits and enters
      yield* actor.send({ type: "AGAIN" })
      assert.notStrictEqual((yield* actor.getSnapshot).children["0.m"], root)
      assert.deepStrictEqual(starts.slice(7), ["root", "first", "second", "third"])
    }))

  it.effect("[C2] an entry sendTo that names the invocation of the state it enters reaches the child, from the initial state and on a transition", () =>
    Effect.gen(function* () {
      const received: Array<string> = []
      const child = fromCallback(({ receive }) => {
        receive((event) => {
          received.push(event.type)
        })
      })
      const machine = createMachine({
        initial: "a",
        states: {
          a: { entry: sendTo("c", { type: "HELLO" }), invoke: { id: "c", src: child }, on: { NEXT: "b" } },
          b: { entry: sendTo("d", { type: "AGAIN" }), invoke: { id: "d", src: child } },
        },
      })

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* settled(() => Effect.sync(() => received.length >= 1))
      assert.deepStrictEqual(received, ["HELLO"])
      assert.strictEqual((yield* actor.getSnapshot).status, "active")

      yield* actor.send({ type: "NEXT" })
      yield* settled(() => Effect.sync(() => received.length >= 2))
      assert.deepStrictEqual(received, ["HELLO", "AGAIN"])
      assert.strictEqual((yield* actor.getSnapshot).status, "active")
    }))

  it.effect("[C2] a machine that reaches a top-level final state stops its root invocations before its observers receive the done snapshot; the done snapshot keeps their references", () =>
    Effect.gen(function* () {
      const order: Array<string> = []
      const child = fromCallback(() => () => {
        order.push("child cleanup")
      })
      const machine = createMachine({
        invoke: { id: "c", src: child },
        initial: "a",
        states: {
          a: { on: { FINISH: "z" }, exit: () => { order.push("exit a") } },
          z: { type: "final" },
        },
      })

      const actor = yield* createActor(machine)
      yield* actor.subscribe((snapshot) => Effect.sync(() => { order.push(`observer ${snapshot.status}`) }))
      yield* actor.start
      const invoked = asActor((yield* actor.getSnapshot).children["c"])
      yield* settle
      order.length = 0

      yield* actor.send({ type: "FINISH" })
      yield* settled(() => Effect.sync(() => order.length >= 3))
      assert.deepStrictEqual(order, ["exit a", "child cleanup", "observer done"])
      assert.deepStrictEqual(Object.keys((yield* actor.getSnapshot).children), ["c"])
      assert.strictEqual(yield* statusOf(invoked), "stopped")
    }))

  it.effect("[C2] an invoke with an unknown src warns and starts no child; an invoke whose input throws sets status error with the thrown value", () =>
    Effect.gen(function* () {
      const warnings: Array<string> = []
      const unknown = createMachine({ id: "p4", initial: "a", states: { a: { invoke: { id: "x", src: "nope" } } } })
      const first = yield* withWarnings(warnings, Effect.tap(createActor(unknown), (started) => started.start))
      assert.deepStrictEqual(Object.keys((yield* first.getSnapshot).children), [])
      assert.strictEqual((yield* first.getSnapshot).status, "active")
      assert.deepStrictEqual(warnings, [actorTypeNotFound("nope", first.id)])

      const boom = new Error("input boom")
      const throwing = createMachine({
        initial: "a",
        states: {
          a: { on: { GO: "b" } },
          b: {
            invoke: {
              src: fromPromise(() => Promise.resolve(1)),
              input: () => {
                throw boom
              },
            },
          },
        },
      })
      const second = yield* Effect.tap(createActor(throwing), (started) => started.start)
      yield* second.send({ type: "GO" })
      const snapshot = yield* second.getSnapshot
      assert.strictEqual(snapshot.status, "error")
      assert.deepStrictEqual(snapshot.error, Option.some(boom))
      assert.strictEqual(snapshot.value, "a")
    }))

  it.effect("[C2] stopping the parent while the invoke is active stops the invoked child and runs its cleanup", () =>
    Effect.gen(function* () {
      const order: Array<string> = []
      const child = fromCallback(() => () => {
        order.push("child cleanup")
      })
      const machine = createMachine({ initial: "a", states: { a: { invoke: { id: "c", src: child } } } })

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      const invoked = asActor((yield* actor.getSnapshot).children["c"])
      yield* actor.stop
      assert.deepStrictEqual(order, ["child cleanup"])
      assert.strictEqual(yield* statusOf(invoked), "stopped")
      assert.strictEqual((yield* actor.getSnapshot).status, "stopped")
    }))

  it.effect("[C2] an invoked fromEffect routes its success to onDone and its failure to onError, and leaving the state interrupts it and runs its finalizers", () =>
    Effect.gen(function* () {
      const order: Array<string> = []
      const outputs: Array<unknown> = []
      const errors: Array<unknown> = []
      const machine = createMachine({
        initial: "ok",
        states: {
          ok: {
            invoke: {
              src: fromEffect(() => Effect.succeed(42)),
              onDone: { target: "failing", actions: ({ event }) => { outputs.push((event as unknown as { output: unknown }).output) } },
            },
          },
          failing: {
            invoke: {
              src: fromEffect(() => Effect.fail("boom")),
              onError: { target: "waiting", actions: ({ event }) => { errors.push((event as unknown as { error: unknown }).error) } },
            },
          },
          waiting: {
            invoke: {
              src: fromEffect(() =>
                Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(() => { order.push("interrupted") })))
              ),
            },
            on: { LEAVE: "left" },
          },
          left: {},
        },
      })

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* settled(() => Effect.map(actor.getSnapshot, (snapshot) => snapshot.value === "waiting"))
      assert.deepStrictEqual(outputs, [Option.some(42)])
      assert.deepStrictEqual(errors, ["boom"])
      yield* settle
      assert.deepStrictEqual(order, [])

      yield* actor.send({ type: "LEAVE" })
      yield* settled(() => Effect.sync(() => order.length > 0))
      assert.deepStrictEqual(order, ["interrupted"])
      assert.strictEqual((yield* actor.getSnapshot).value, "left")
    }))

  it.effect("[C2] a state entered and left in one macrostep leaves no running child (#1180)", () =>
    Effect.gen(function* () {
      const starts: Array<string> = []
      const machine = createMachine({
        initial: "idle",
        states: {
          idle: { on: { GO: "passing" } },
          passing: {
            invoke: { id: "c", src: fromCallback(() => { starts.push("started") }) },
            always: "after",
          },
          after: {},
        },
      })

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* actor.send({ type: "GO" })
      yield* settle
      assert.strictEqual((yield* actor.getSnapshot).value, "after")
      assert.deepStrictEqual(Object.keys((yield* actor.getSnapshot).children), [])
      assert.deepStrictEqual(starts, [])
    }))

  it.effect("[C2] a function input is typed by the machine: its argument has the context, the event and self (upstream Mapper)", () =>
    Effect.gen(function* () {
      const seen: Array<unknown> = []
      const echo = fromPromise(({ input }: { input: unknown }) => {
        seen.push(input)
        return Promise.resolve(input)
      })
      const machine = createMachine({
        types: {} as { context: { readonly n: number }; events: { readonly type: "GO"; readonly by: number } },
        context: { n: 3 },
        initial: "idle",
        states: {
          idle: { on: { GO: "running" } },
          running: {
            invoke: {
              src: echo,
              input: ({ context, event, self }) => {
                const n: number = context.n
                const by: string = event.type
                return [n, by, typeof self.id]
              },
            },
          },
        },
      })

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* actor.send({ type: "GO", by: 2 })
      yield* settled(() => Effect.sync(() => seen.length >= 1))
      assert.deepStrictEqual(seen, [[3, "GO", "string"]])
    }))

  it.effect("[C2] an invocation id is a string, as upstream's InvokeConfig.id: a function id is a type error", () =>
    Effect.gen(function* () {
      const child = createMachine({})
      const machine = createMachine({
        initial: "a",
        states: {
          a: {
            // @ts-expect-error upstream `id?: string`; the done, error and snapshot descriptors need the id itself
            invoke: { id: () => "dynamic", src: child },
          },
        },
      })
      const named = createMachine({ initial: "a", states: { a: { invoke: { id: "fixed", src: child } } } })
      const actor = yield* Effect.tap(createActor(named), (started) => started.start)
      assert.deepStrictEqual(Object.keys((yield* actor.getSnapshot).children), ["fixed"])
      assert.strictEqual(machine.root.states["a"]?.invoke.length, 1)
    }))

  it.effect("[C2] in a setup machine an invocation names a setup actor with any id, or invokes inline logic without an id (upstream DistributeActors)", () =>
    Effect.gen(function* () {
      const known = fromPromise(() => Promise.resolve("known"))
      const inline = fromPromise(() => Promise.resolve("inline"))
      const declared = setup({ actors: { known } })
      const machine = declared.createMachine({
        initial: "a",
        states: {
          a: { invoke: [{ src: "known", id: "byName" }, { src: inline }] },
          b: {
            // @ts-expect-error upstream: inline logic outside the setup's actors takes no id
            invoke: { src: inline, id: "myChild" },
          },
        },
      })
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      assert.deepStrictEqual(Object.keys((yield* actor.getSnapshot).children), ["byName", "1.(machine).a"])
    }))

  it.effect("[C2] in a setup machine onDone types event.output from the named actor's logic, and onSnapshot event.snapshot from its snapshot (upstream DoneActorEvent<OutputFrom<logic>>)", () =>
    Effect.gen(function* () {
      const outputs: Array<Option.Option<string>> = []
      const machine = setup({
        actors: {
          greet: fromPromise(() => Promise.resolve("hello")),
          throwDice: fromPromise(() => Promise.resolve(Math.random())),
        },
      }).createMachine({
        initial: "a",
        states: {
          a: {
            invoke: {
              src: "greet",
              onDone: {
                target: "b",
                actions: ({ event }) => {
                  event.output satisfies Option.Option<string>
                  // @ts-expect-error the output of `greet` is a string
                  event.output satisfies Option.Option<number>
                  outputs.push(event.output)
                },
              },
              onSnapshot: {
                actions: ({ event }) => {
                  event.snapshot.status satisfies string
                  // @ts-expect-error a promise snapshot has no context
                  void event.snapshot.context
                },
              },
            },
          },
          b: {},
        },
      })

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* settled(() => Effect.map(actor.getSnapshot, (snapshot) => snapshot.value === "b"))
      assert.deepStrictEqual(outputs, [Option.some("hello")])
    }))

  it.effect("[C2] a context assigned by an onDone action reads the output Option", () =>
    Effect.gen(function* () {
      interface Ctx {
        readonly result: Option.Option<unknown>
      }
      const machine = createMachine<Ctx, EventObject>({
        context: { result: Option.none() },
        initial: "a",
        states: {
          a: {
            invoke: {
              src: fromPromise(() => Promise.resolve("value")),
              onDone: {
                target: "b",
                actions: assign<Ctx, EventObject>(({ event }) => ({ result: (event as unknown as { output: Option.Option<unknown> }).output })),
              },
            },
          },
          b: {},
        },
      })

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* settled(() => Effect.map(actor.getSnapshot, (snapshot) => snapshot.value === "b"))
      assert.deepStrictEqual((yield* actor.getSnapshot).context.result, Option.some("value"))
    }))
})
