/**
 * A21: spawn works in the context factory.
 *
 * T4.19. Upstream `StateMachine._getPreInitialState` at xstate@5.33.2 runs the context
 * factory as an `assign` on the pre-initial snapshot, so the factory receives the same
 * synchronous `spawn` an assigner does (`createSpawner`): a logic or a name of one of the
 * machine's actors, with `{ id, systemId, input }`. The reference it returns is the child's,
 * the pre-initial snapshot's `children` holds it under its id, a `systemId` registers it in
 * the system at once, and the child starts when the machine actor starts. Upstream types
 * the factory as `ContextFactory`: `spawn` is the typed `Spawner`, so the input of a logic is
 * checked and the reference has the logic's snapshot and event types.
 *
 * The port builds the child per parent (D12), into the reference `spawn` gave, when the
 * factory returns. The type-level cases are this file's own type check (`tsc -p
 * tsconfig.test.green.json`).
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import type { ActorRefBase } from "../../src/ActorRef.js"
import {
  type ActorType,
  createActor,
  createMachine,
  fromCallback,
  fromTransition,
  isActor,
  setup,
  type TransitionActorRef,
} from "../../src/index.js"
import type { StateMachine } from "../../src/StateMachine.js"

/** True when `A` and `B` are the same type. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

/** Compiles only for `true`. */
const typeHolds = <T extends true>(holds: T): T => holds

interface Count {
  readonly n: number
}

type AddEvent = { readonly type: "ADD" }

/** A child whose context starts from its input and adds one for each `ADD`. */
const counterLogic = fromTransition(
  (state: Count, _event: AddEvent): Count => ({ n: state.n + 1 }),
  ({ input }: { readonly input: Count }): Count => ({ n: input.n })
)

/** The child actor behind a reference; fails the test when the reference is not an actor. */
const asActor = (ref: ActorRefBase | undefined): ActorType.Any => {
  assert.isTrue(isActor(ref), "the reference is an actor")
  return ref as ActorType.Any
}

/** The `n` of a counter child's live snapshot. */
const countOf = (ref: ActorRefBase) =>
  Effect.map(ref.getSnapshotUntyped, (snapshot) => (snapshot as unknown as { readonly context: Count }).context.n)

describe("A21 spawn works in the context factory", () => {
  it.effect("[A21] a context factory that spawns a logic with input and a systemId stores the reference, snapshot.children holds it, and system.get finds it", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "a21-logic",
        context: ({ spawn }) => ({ ref: spawn(counterLogic, { id: "kid", systemId: "kid-system", input: { n: 5 } }) }),
      })
      const actor = yield* createActor(machine)

      // The pre-initial snapshot holds the reference, and the system knows it at creation
      const created = yield* actor.getSnapshot
      const ref = created.context.ref
      assert.isDefined(ref)
      assert.strictEqual(created.children["kid"], ref)
      assert.deepStrictEqual(Object.keys(created.children), ["kid"])
      assert.strictEqual(ref.id, "kid")
      const found = yield* actor.system.get<ActorRefBase>("kid-system")
      assert.isTrue(Option.isSome(found), "system.get finds the child by its systemId")
      assert.strictEqual(Option.getOrUndefined(found), ref)

      // The child belongs to the machine actor and runs once the actor starts
      yield* actor.start
      const child = asActor(ref)
      assert.isTrue(Option.isSome(child._parent) && child._parent.value === actor)
      assert.strictEqual(child._system, actor.system)
      assert.strictEqual(yield* countOf(child), 5, "the child's context starts from the input")
      yield* child.send({ type: "ADD" })
      assert.strictEqual(yield* countOf(child), 6)
      assert.strictEqual((yield* actor.getSnapshot).context.ref, ref)
    })
  )

  it.effect("[A21] a context factory that spawns by name uses the machine's actor, with its input and systemId", () =>
    Effect.gen(function* () {
      const machine = setup({
        types: { context: {} as { readonly ref: ActorRefBase } },
        actors: { counter: counterLogic },
      }).createMachine({
        id: "a21-name",
        context: ({ spawn }) => ({ ref: spawn("counter", { id: "named", systemId: "named-system", input: { n: 7 } }) }),
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      const snapshot = yield* actor.getSnapshot
      const ref = snapshot.context.ref
      assert.strictEqual(snapshot.children["named"], ref)
      assert.strictEqual(Option.getOrUndefined(yield* actor.system.get<ActorRefBase>("named-system")), ref)
      assert.strictEqual(yield* countOf(ref), 7)
    })
  )

  it.effect("[A21] a child spawned in the context factory starts when the actor starts, not when it is created", () =>
    Effect.gen(function* () {
      const calls: Array<string> = []
      const machine = createMachine({
        id: "a21-start",
        context: ({ spawn }) => ({
          ref: spawn(
            fromCallback(() => {
              calls.push("child started")
            }),
            { id: "cb" }
          ),
        }),
      })
      const actor = yield* createActor(machine)
      assert.deepStrictEqual(calls, [], "creating the actor does not start the child")
      yield* actor.start
      assert.deepStrictEqual(calls, ["child started"])
    })
  )

  it.effect("[A21] the test type-check types spawn in the context factory: the logic's input is checked and the reference has the logic's types", () =>
    Effect.sync(() => {
      // No actor is created, so the factories below are only type-checked
      const machine = createMachine({
        context: ({ spawn }) => {
          const ref = spawn(counterLogic, { input: { n: 1 } })
          typeHolds<Equals<typeof ref, TransitionActorRef<Count, AddEvent>>>(true)
          // @ts-expect-error the input of the logic is `{ n: number }`
          spawn(counterLogic, { input: { n: "one" } })
          // @ts-expect-error spawn takes a logic or the name of an actor, not a number
          spawn(42)
          return { ref }
        },
      })
      // With no `types`, the machine's context is what the factory returns
      typeHolds<Equals<StateMachine.ContextOf<typeof machine>, { ref: TransitionActorRef<Count, AddEvent> }>>(true)

      const declared = createMachine({
        types: {} as { context: { readonly ref: TransitionActorRef<Count, AddEvent> } },
        context: ({ spawn }) => ({ ref: spawn(counterLogic, { input: { n: 2 } }) }),
      })
      typeHolds<Equals<StateMachine.ContextOf<typeof declared>, { readonly ref: TransitionActorRef<Count, AddEvent> }>>(true)

      createMachine({
        types: {} as { context: { readonly ref: TransitionActorRef<Count, AddEvent> } },
        // @ts-expect-error the reference of another logic is not the declared context
        context: ({ spawn }) => ({ ref: spawn(fromCallback(() => {})) }),
      })
    })
  )
})
