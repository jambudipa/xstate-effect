/**
 * A22: the context factory receives input, spawn and self.
 *
 * T4.19. Upstream `StateMachine` at xstate@5.33.2 calls a context factory with
 * `{ spawn, input, self }` (`_getPreInitialState`): `input` is the actor's input, which the
 * `xstate.init` event also carries to the initial actions, and `self` is the machine actor.
 * Its type is `ContextFactory<TContext, TActor, TInput, TEvent>`, in upstream's order: `input`
 * has the machine's input type (from `types.input`, or inferred from an annotated factory of
 * `createMachine`; a setup machine's is the setup's `types.input`), `self` is the machine
 * actor, and the result is checked against the context.
 * `createActor` requires `input` when the logic's input type does not include `undefined`
 * (`RequiredActorOptionsKeys`).
 *
 * `getInitialSnapshot` catches what the factory throws: the snapshot keeps the machine
 * snapshot interface (only the root active, so the value is the root's initial value; the
 * empty context; no children) with status `error` and the thrown value as its error. A
 * missing required input is such a throw. The port keeps the error as an `Option` (D8), and a
 * spawn by a name the machine lacks fails the same way.
 *
 * The type-level cases are this file's own type check (`tsc -p tsconfig.test.green.json`).
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import type { ActorRefBase } from "../../src/ActorRef.js"
import {
  type ActorRef,
  type AnyActorRef,
  type AnyEventObject,
  type ContextFactory,
  createActor,
  createMachine,
  type EventObject,
  fromPromise,
  type MachineContext,
  type MachineSnapshot,
  type NonReducibleUnknown,
  type ProvidedActor,
  setup,
  type Spawner,
  type StateSchema,
  type StateValue,
} from "../../src/index.js"
import type { StateMachine } from "../../src/StateMachine.js"
import type * as Types from "../../src/Types.js"
import { actorLogicNotImplemented } from "./upstream-messages.js"

/** True when `A` and `B` are the same type. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

/**
 * The `self` of a context factory, as upstream `ContextFactory` types it: the machine actor,
 * whose snapshot is the machine snapshot of the context and events (children
 * `Record<string, AnyActorRef | undefined>`, any state value, tags and output), which takes
 * the machine's events and emits any event. Upstream leaves the meta and the state schema of
 * that snapshot as `TODO` (`any`); the port spells them with its widest types (ledger DEV-66).
 * The type arguments are in upstream's order (`MachineSnapshot<TContext, TEvent, TChildren,
 * TStateValue, TTag, TOutput, TMeta, TStateSchema>`, `src/State.ts:240`).
 */
type FactorySelf<TContext extends MachineContext, TEvent extends EventObject> = ActorRef<
  MachineSnapshot<TContext, TEvent, Record<string, AnyActorRef | undefined>, StateValue, string, unknown, unknown, StateSchema>,
  TEvent,
  AnyEventObject
>

/** Compiles only for `true`. */
const typeHolds = <T extends true>(holds: T): T => holds

/** The message of an error value. */
const messageOf = (error: unknown): string => String((error as { readonly message?: unknown }).message)

interface Greeting {
  readonly greeting: string
}

/** A machine that needs a greeting to build its context, in state `saving` from the start. */
const greetingMachine = () =>
  createMachine({
    id: "a22-greeting",
    types: {} as { input: Greeting; context: { readonly message: string } },
    context: ({ input }) => ({ message: `Hello, ${input.greeting}` }),
    initial: "saving",
    states: { saving: {} },
  })

describe("A22 The context factory receives input, spawn and self", () => {
  it.effect("[A22] the context factory receives the input, spawn and self, and the context is built from the input", () =>
    Effect.gen(function* () {
      const seen: Array<unknown> = []
      const machine = createMachine({
        id: "a22-args",
        types: {} as {
          context: { readonly count: number; readonly label: string }
          input: { readonly start: number; readonly label: string }
        },
        context: ({ input, spawn, self }) => {
          seen.push(typeof spawn, self)
          return { count: input.start, label: input.label }
        },
      })
      const actor = yield* createActor(machine, { input: { start: 3, label: "three" } })

      assert.deepStrictEqual((yield* actor.getSnapshot).context, { count: 3, label: "three" })
      assert.strictEqual(seen.length, 2, "the factory runs once, when the actor is created")
      assert.strictEqual(seen[0], "function")
      assert.strictEqual(seen[1], actor, "self is the machine actor")

      // The actor starts with that input: the context built from it stays, and the factory
      // does not run again at start
      yield* actor.start
      const started = yield* actor.getSnapshot
      assert.strictEqual(started.status, "active")
      assert.deepStrictEqual(started.context, { count: 3, label: "three" })
      assert.strictEqual(seen.length, 2, "the factory does not run again at start")
    })
  )

  it.effect("[A22] the xstate.init event carries the input to the initial actions", () =>
    Effect.gen(function* () {
      const events: Array<unknown> = []
      const machine = createMachine({
        id: "a22-init",
        types: {} as { context: { readonly count: number }; input: { readonly start: number } },
        context: ({ input }) => ({ count: input.start }),
        entry: ({ event }) => {
          events.push(event)
        },
      })
      const actor = yield* createActor(machine, { input: { start: 9 } })
      yield* actor.start

      assert.strictEqual(events.length, 1)
      const init = events[0] as { readonly type: string; readonly input: unknown }
      assert.strictEqual(init.type, "xstate.init")
      assert.deepStrictEqual(init.input, { start: 9 })
    })
  )

  it.effect("[A22] a missing required input gives the machine snapshot with status error, as upstream", () =>
    Effect.gen(function* () {
      // @ts-expect-error the machine declares an input, and none is given
      const actor = yield* createActor(greetingMachine())
      const snapshot = yield* actor.getSnapshot

      assert.strictEqual(snapshot.status, "error")
      assert.isTrue(Option.isSome(snapshot.error))
      assert.instanceOf(Option.getOrUndefined(snapshot.error), TypeError, "reading the missing input throws")
      // The machine snapshot interface stays (upstream "should retain the machine snapshot
      // interface when resolving input throws")
      assert.strictEqual(snapshot.value, "saving")
      assert.isTrue(snapshot.matches("saving"))
      // The context type is the declared one; the value is the empty pre-initial context
      assert.deepStrictEqual<unknown>(snapshot.context, {})
      assert.deepStrictEqual(snapshot.children, {})
    })
  )

  it.effect("[A22] a throwing context factory keeps the machine snapshot with status error and the thrown value as its error", () =>
    Effect.gen(function* () {
      const thrown = new Error("no context")
      const machine = createMachine({
        id: "a22-throw",
        types: {} as { context: { readonly ref: ActorRefBase } },
        context: ({ spawn }) => {
          spawn(createMachine({ id: "never-kept" }), { id: "early" })
          throw thrown
        },
        initial: "a",
        states: { a: { initial: "a1", states: { a1: {} } }, b: {} },
      })
      const actor = yield* createActor(machine)
      const snapshot = yield* actor.getSnapshot

      assert.strictEqual(snapshot.status, "error")
      assert.strictEqual(Option.getOrUndefined(snapshot.error), thrown)
      assert.deepStrictEqual(snapshot.value, { a: "a1" })
      assert.isTrue(snapshot.matches("a.a1"))
      assert.deepStrictEqual<unknown>(snapshot.context, {})
      assert.deepStrictEqual(snapshot.children, {}, "a child spawned before the throw is not in the snapshot")
    })
  )

  it.effect("[A22] a spawn by a name the machine lacks in the context factory gives the machine snapshot with status error and the upstream message", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "a22-unknown",
        types: {} as { context: { readonly ref: ActorRefBase } },
        context: ({ spawn }) => ({ ref: spawn("nope") }),
        initial: "idle",
        states: { idle: {} },
      })
      const actor = yield* createActor(machine)
      const snapshot = yield* actor.getSnapshot

      assert.strictEqual(snapshot.status, "error")
      assert.strictEqual(messageOf(Option.getOrUndefined(snapshot.error)), actorLogicNotImplemented("nope", "a22-unknown"))
      assert.isTrue(snapshot.matches("idle"))
    })
  )

  it.effect("[A22] the test type-check accepts the factory signature ({ input, spawn, self }) => TContext and requires a declared input in createActor", () =>
    Effect.sync(() => {
      type Event = { readonly type: "GO" }
      // No actor is run, so the factories below are only type-checked
      const typed = createMachine({
        types: {} as {
          context: { readonly count: number }
          events: Event
          input: { readonly start: number }
        },
        context: ({ input, spawn, self }) => {
          typeHolds<Equals<typeof input, { readonly start: number }>>(true)
          typeHolds<Equals<typeof spawn, Types.Spawner>>(true)
          // self is the machine actor (upstream `ContextFactory`'s `self`)
          typeHolds<Equals<typeof self, FactorySelf<{ readonly count: number }, Event>>>(true)
          const base: ActorRefBase = self
          void base
          self.send({ type: "GO" })
          // @ts-expect-error self takes the machine's events
          self.send({ type: "STOP" })
          return { count: input.start }
        },
      })

      createMachine({
        types: {} as { context: { readonly count: number }; input: { readonly start: number } },
        // @ts-expect-error the factory's result is checked against the declared context
        context: ({ input }) => ({ count: `${input.start}` }),
      })

      // An annotated factory gives the machine its input type
      const annotated = createMachine({ context: ({ input }: { readonly input: number }) => ({ value: input }) })
      typeHolds<Equals<StateMachine.InputOf<typeof annotated>, number>>(true)
      typeHolds<Equals<StateMachine.ContextOf<typeof annotated>, { value: number }>>(true)

      // The root type of the factory, in upstream's order: `ContextFactory<TContext, TActor,
      // TInput, TEvent = EventObject>`
      const factory: ContextFactory<{ readonly count: number }, ProvidedActor, { readonly start: number }> = ({ input }) => ({
        count: input.start,
      })
      createMachine({
        types: {} as { context: { readonly count: number }; input: { readonly start: number } },
        context: factory,
      })
      type FactoryArgs = Parameters<ContextFactory<{ readonly count: number }, ProvidedActor, { readonly start: number }, Event>>[0]
      typeHolds<Equals<FactoryArgs["input"], { readonly start: number }>>(true)
      typeHolds<Equals<FactoryArgs["spawn"], Spawner<ProvidedActor>>>(true)
      typeHolds<Equals<FactoryArgs["self"], FactorySelf<{ readonly count: number }, Event>>>(true)
      typeHolds<
        Equals<
          Parameters<ContextFactory<{ readonly count: number }, ProvidedActor, number>>[0]["self"],
          FactorySelf<{ readonly count: number }, EventObject>
        >
      >(true)
      // @ts-expect-error the context of a factory is a machine context (an object), as upstream constrains it
      const notObject: ContextFactory<number, ProvidedActor, unknown> = () => 1
      void notObject

      // A setup machine's input type is the setup's `types.input` (upstream
      // `SetupReturn.createMachine`), which an annotated factory does not change
      const fromSetup = setup({ types: {} as { input: { readonly start: number } } }).createMachine({
        context: ({ input }) => ({ count: input.start }),
      })
      typeHolds<Equals<StateMachine.InputOf<typeof fromSetup>, { readonly start: number }>>(true)
      setup({ types: {} as { context: { readonly count: number }; input: { readonly start: number } } }).createMachine({
        // @ts-expect-error the factory's input is the setup's `types.input`, not a string
        context: ({ input }: { readonly input: string }) => ({ count: input.length }),
      })
      // While the context is undeclared, a function is also a context value, so an annotated
      // factory compiles (upstream's `MachineContext` takes it too), but the input type stays
      const annotatedSetup = setup({ types: {} as { input: { readonly start: number } } }).createMachine({
        context: ({ input }: { readonly input: string }) => ({ value: input }),
      })
      typeHolds<Equals<StateMachine.InputOf<typeof annotatedSetup>, { readonly start: number }>>(true)
      // Without `types.input`, the input type is upstream's default for it
      const noInput = setup({}).createMachine({ context: ({ input }: { readonly input: number }) => ({ value: input }) })
      typeHolds<Equals<StateMachine.InputOf<typeof noInput>, NonReducibleUnknown>>(true)

      // createActor requires the input a logic declares (upstream `RequiredActorOptionsKeys`)
      createActor(typed, { input: { start: 1 } })
      // @ts-expect-error the machine declares an input, and none is given
      createActor(typed)
      // @ts-expect-error the input does not have the declared type
      createActor(typed, { input: { start: "1" } })
      createActor(createMachine({ id: "no-input" }))
      // An input type that takes `undefined` is optional (upstream types.test "createActor")
      createActor(fromPromise(({ input }: { readonly input: number | undefined }) => Promise.resolve(input)))
      // @ts-expect-error promise logic that declares an input needs it
      createActor(fromPromise(({ input }: { readonly input: number }) => Promise.resolve(input)))
    })
  )
})
