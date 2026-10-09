/**
 * P12: the Spawner type is exported.
 *
 * T6.13. Upstream exports `Spawner<TActor extends ProvidedActor>` from its root
 * (`src/spawn.ts` at xstate@5.33.2): the type of the `spawn` that an assigner and the context
 * factory receive. A logic whose input type does not take `undefined` needs its `input`
 * (`ConditionalRequired`); with literal source names (the actors a machine declares), it
 * takes only those names, with each actor's ids and input, or an inline logic with no id. The
 * port exports the same type from its root; `Spawner<ProvidedActor>` is the spawn an assigner
 * and the context factory of `createMachine` receive (T8.8: its parameter has no default, as
 * upstream's has none, so `Spawner` alone is a type error), and an assigner of a
 * setup machine receives the `Spawner` of the setup's actors (upstream `ToProvidedActor`). The
 * type-level cases are this file's own type check (`tsc -p tsconfig.test.green.json`; an unused
 * `@ts-expect-error` fails as TS2578); each expectation holds for the 5.33.2 source
 * (`packages/core/.upstream/measure/t613/probe-up.ts`). Typing an assigner's `spawn` by the
 * actors a `createMachine` declares in `types.actors` is the `types.test.ts` import's work
 * (T6.26). T8.8: a setup's `types.children` gives its actors their ids (upstream
 * `ToProvidedActor`), so the spawn of such an actor requires one of them.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import {
  type ActorRefFrom,
  type ActorRefFromLogic,
  assign,
  createActor,
  createMachine,
  fromPromise,
  type ProvidedActor,
  setup,
  type Spawner,
} from "../../src/index.js"

/** True when `A` and `B` are the same type. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

/** Compiles only for `true`. */
const typeHolds = <T extends true>(holds: T): T => holds

/** A child machine whose input is required; its context is the input's value. */
const childWithInput = createMachine({
  id: "p12-child",
  types: {} as { input: { readonly value: number }; context: { readonly value: number } },
  context: ({ input }) => ({ value: input.value }),
})

/** A child whose input may be left out. */
const childWithOptionalInput = fromPromise(({ input }: { readonly input: number | undefined }) =>
  Promise.resolve(input ?? 0)
)

/** A child machine with no input. */
const plainChild = createMachine({ id: "p12-plain" })

/** The actors a machine declares: `child` (input required) and `other` (ids `ok1`, `ok2`). */
type Declared =
  | { readonly src: "child"; readonly logic: typeof childWithInput }
  | { readonly src: "other"; readonly logic: typeof plainChild; readonly id: "ok1" | "ok2" }

describe("P12 The Spawner type is exported", () => {
  // upstream: test/spawn.types.test.ts > spawn inside machine > input is required when defined in actor
  it.effect("[P12] Spawner types the spawn argument of assign and of the context factory", () =>
    Effect.sync(() => {
      const machine = createMachine({
        types: {} as { context: { ref?: ActorRefFrom<typeof childWithInput> } },
        context: ({ spawn }) => {
          typeHolds<Equals<typeof spawn, Spawner<ProvidedActor>>>(true)
          return {}
        },
        on: {
          GO: {
            actions: assign(({ spawn }) => {
              typeHolds<Equals<typeof spawn, Spawner<ProvidedActor>>>(true)
              const ref = spawn(childWithInput, { input: { value: 42 } })
              typeHolds<Equals<typeof ref, ActorRefFromLogic<typeof childWithInput>>>(true)
              return { ref }
            }),
          },
        },
      })
      assert.isDefined(machine)
    })
  )

  // upstream: test/types.test.ts > spawner in assign > should require input to be specified when it is required
  it.effect("[P12] the test type-check rejects a spawn that leaves out a required input", () =>
    Effect.sync(() => {
      const machine = createMachine({
        context: ({ spawn }) => {
          // @ts-expect-error the input of `childWithInput` is required
          spawn(childWithInput)
          return {}
        },
        entry: assign(({ spawn }) => {
          // @ts-expect-error the input of `childWithInput` is required
          spawn(childWithInput)
          // @ts-expect-error options without the required input
          spawn(childWithInput, { id: "child" })
          // @ts-expect-error the input has the logic's input type
          spawn(childWithInput, { input: { value: "42" } })
          spawn(childWithInput, { input: { value: 42 } })
          // An input that takes `undefined`, and no input at all, may be left out
          spawn(childWithOptionalInput)
          spawn(plainChild)
          return {}
        }),
      })
      assert.isDefined(machine)
    })
  )

  // upstream: test/types.test.ts > spawner in assign > spawned actor ref should be compatible with the result of ActorRefFrom
  it.effect("[P12] a function typed by Spawner<ProvidedActor> gives the reference ActorRefFrom names", () =>
    Effect.sync(() => {
      const spawnPlain = (spawn: Spawner<ProvidedActor>): ActorRefFrom<typeof plainChild> => spawn(plainChild)
      const spawnWithInput = (spawn: Spawner<ProvidedActor>): ActorRefFrom<typeof childWithInput> =>
        spawn(childWithInput, { input: { value: 1 } })
      // Upstream's `Spawner<TActor extends ProvidedActor>` has no default type argument
      // @ts-expect-error Spawner names its actors
      const spawnBare = (spawn: Spawner) => spawn
      assert.isFunction(spawnPlain)
      assert.isFunction(spawnWithInput)
      assert.isFunction(spawnBare)
    })
  )

  it.effect("[P12] Spawner of declared actors takes only their names, with their ids and their required input", () =>
    Effect.sync(() => {
      // Never called: the body is only type-checked
      const declared = (spawn: Spawner<Declared>) => {
        const child = spawn("child", { input: { value: 1 } })
        typeHolds<Equals<typeof child, ActorRefFromLogic<typeof childWithInput>>>(true)
        spawn("other", { id: "ok1" })
        // @ts-expect-error the input of the declared `child` is required
        spawn("child")
        // @ts-expect-error `missing` is no declared actor
        spawn("missing")
        // @ts-expect-error `other` declares its ids, so the id is required
        spawn("other")
        // @ts-expect-error `nope` is no declared id of `other`
        spawn("other", { id: "nope" })
        // @ts-expect-error the input of a declared actor is static, not a function
        spawn("child", { input: () => ({ value: 1 }) })
        // An inline logic may be spawned, without an id
        spawn(plainChild)
        // @ts-expect-error an inline logic takes no id when the actors are declared
        spawn(plainChild, { id: "ok1" })
      }
      assert.isFunction(declared)
    })
  )

  // upstream: test/setup.types.test.ts > setup() > should not accept an `assign` with a spawner that tries to spawn an unknown actor when actors are configured
  it.effect("[P12] the spawn of a setup machine's assign is the Spawner of the setup's actors", () =>
    Effect.sync(() => {
      const withActors = setup({ actors: { child: childWithInput } }).createMachine({
        entry: assign(({ spawn }) => {
          const ref = spawn("child", { input: { value: 1 } })
          typeHolds<Equals<typeof ref, ActorRefFromLogic<typeof childWithInput>>>(true)
          // A declared actor takes any id when the setup gives it no child id
          spawn("child", { id: "anything", input: { value: 1 } })
          // @ts-expect-error the input of the setup's `child` is required
          spawn("child")
          // @ts-expect-error the input has the logic's input type
          spawn("child", { input: { value: "1" } })
          // @ts-expect-error the input of a setup's actor is static, not a function
          spawn("child", { input: () => ({ value: 1 }) })
          // @ts-expect-error `unknown` is no actor of the setup
          spawn("unknown")
          spawn(plainChild)
          // @ts-expect-error an inline logic takes no id when the setup declares its actors
          spawn(plainChild, { id: "inline" })
          return {}
        }),
      })
      const withoutActors = setup({}).createMachine({
        entry: assign(({ spawn }) => {
          spawn(plainChild)
          // @ts-expect-error a setup without actors names none
          spawn("child")
          // @ts-expect-error an inline logic takes no id in a setup machine either
          spawn(plainChild, { id: "inline" })
          return {}
        }),
      })
      assert.isDefined(withActors)
      assert.isDefined(withoutActors)
    })
  )

  it.effect("[P12] the spawn of a setup machine requires the child id that the setup's types.children gives an actor", () =>
    Effect.sync(() => {
      // Upstream `ToProvidedActor<TChildrenMap, TActors>`: an actor that `types.children` names
      // has those ids, so its spawn requires one; any other actor takes any id
      const withChildren = setup({
        types: {} as { children: { myId: "child" } },
        actors: { child: childWithInput, other: plainChild },
      }).createMachine({
        context: ({ spawn }) => {
          spawn("child", { id: "myId", input: { value: 1 } })
          // @ts-expect-error the context factory's spawn of `child` requires its id `myId`
          spawn("child", { input: { value: 1 } })
          return {}
        },
        entry: assign(({ spawn }) => {
          spawn("child", { id: "myId", input: { value: 1 } })
          // @ts-expect-error types.children gives `child` the id `myId`, so the id is required
          spawn("child", { input: { value: 1 } })
          // @ts-expect-error `elsewhere` is not an id types.children gives `child`
          spawn("child", { id: "elsewhere", input: { value: 1 } })
          spawn("other", { id: "anything" })
          spawn("other")
          return {}
        }),
      })
      assert.isDefined(withChildren)
    })
  )

  it.effect("[P12] a runtime spawn through the typed spawner builds the child with its input", () =>
    Effect.gen(function* () {
      const spawnChild = (spawn: Spawner<ProvidedActor>) => spawn(childWithInput, { input: { value: 42 } })
      const parent = createMachine({
        id: "p12-parent",
        types: {} as { context: { ref?: ActorRefFrom<typeof childWithInput> } },
        context: {},
        on: { SPAWN: { actions: assign(({ spawn }) => ({ ref: spawnChild(spawn) })) } },
      })

      const actor = yield* createActor(parent)
      yield* actor.start
      yield* actor.send({ type: "SPAWN" })
      const ref = Option.fromNullishOr((yield* actor.getSnapshot).context.ref)
      assert.isTrue(Option.isSome(ref), "the child is in the context")
      const child = Option.getOrThrow(ref)

      assert.strictEqual((yield* child.getSnapshot).context.value, 42)
      assert.strictEqual((yield* actor.getSnapshot).children[child.id], child)
    })
  )

  it.effect("[P12] a runtime spawn of a setup's actor by name builds the child with its input", () =>
    Effect.gen(function* () {
      const parent = setup({
        types: { context: {} as { readonly ref?: ActorRefFrom<typeof childWithInput> } },
        actors: { child: childWithInput },
      }).createMachine({
        id: "p12-setup-parent",
        context: {},
        on: { SPAWN: { actions: assign(({ spawn }) => ({ ref: spawn("child", { id: "named", input: { value: 7 } }) })) } },
      })

      const actor = yield* createActor(parent)
      yield* actor.start
      yield* actor.send({ type: "SPAWN" })
      const ref = Option.fromNullishOr((yield* actor.getSnapshot).context.ref)
      assert.isTrue(Option.isSome(ref), "the child is in the context")
      const child = Option.getOrThrow(ref)

      assert.strictEqual(child.id, "named")
      assert.strictEqual((yield* child.getSnapshot).context.value, 7)
      assert.strictEqual((yield* actor.getSnapshot).children["named"], child)
    })
  )
})
