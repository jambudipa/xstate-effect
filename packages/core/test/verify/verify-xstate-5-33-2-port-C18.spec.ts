/**
 * C18: actor.toJSON and actor.src follow XState.
 *
 * T5.10. Upstream `Actor.toJSON()` in `src/createActor.ts` at xstate@5.33.2 returns
 * `{ xstate$$type: $$ACTOR_TYPE, id: this.id }` with `$$ACTOR_TYPE = 1`, so `JSON.stringify`
 * writes every actor, alone or inside a snapshot's `children` and `context`, as that marker and
 * never reads the actor's own state. `Actor.src` is `options.src ?? logic`: `createActor` and an
 * inline `spawn` give the logic; `spawn('<name>')`, `spawnChild('<name>')` and an invoke
 * `src: '<name>'` pass the name; an inline invoke passes its source name
 * `xstate.invoke.<index>.<state node id>` (`StateNode.invoke`). A tsx probe of 5.33.2
 * (`packages/core/.upstream/measure/t510/probe-up.ts`) gives: `{"xstate$$type":1,"id":"x:0"}`
 * for an actor without an id (its id is its session id), `{"xstate$$type":1,"id":"my-id"}` for
 * an actor with the id `my-id` and a systemId, the same form for promise and callback logic and
 * after stop, each child and each context ref of a snapshot as its marker, the sources above,
 * and the `self` of `getInitialSnapshot` and `getNextSnapshot` as the marker with its own id.
 *
 * Effect form: `createActor` is an Effect (D6); the pure helpers are Effects whose `self` is the
 * port's inert actor (its id is the port's own, so the case compares with the id `self` gives).
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import type { ActorRefBase } from "../../src/ActorRef.js"
import {
  assign,
  createActor,
  createMachine,
  fromCallback,
  fromPromise,
  fromTransition,
  getInitialSnapshot,
  getNextSnapshot,
  setup,
  spawnChild,
} from "../../src/index.js"

/** The JSON form XState writes for an actor (upstream `toJSON`). */
const marker = (id: string) => ({ xstate$$type: 1, id })

/** A machine that stays in its one state. */
const idleMachine = () => createMachine({ initial: "a", states: { a: {} } })

/** A child logic that keeps its number. */
const childLogic = fromTransition((state: number) => state, 0)

/** The child of `children` under `id`; fails the test when there is none. */
const childOf = (children: Readonly<Record<string, ActorRefBase | undefined>>, id: string): ActorRefBase => {
  const child = children[id]
  assert.isDefined(child, `the snapshot has the child ${id}`)
  return child as ActorRefBase
}

/**
 * A setup machine with five children: a context factory spawns `child` by name and the logic
 * inline, the root entry runs `spawnChild('child')`, and two parallel regions invoke `child` by
 * name (with a systemId) and the logic inline (a setup machine's inline invoke takes no id).
 */
const familyMachine = () =>
  setup({
    types: { context: {} as { readonly named: ActorRefBase; readonly inline: ActorRefBase } },
    actors: { child: childLogic },
  }).createMachine({
    context: ({ spawn }) => ({
      named: spawn("child", { id: "spawnedNamed" }),
      // @ts-expect-error -- upstream's Spawner of a setup's actors gives an inline logic no id;
      // the run time still takes one, which this fixture needs for a child whose src is a logic
      inline: spawn(childLogic, { id: "spawnedInline" }),
    }),
    entry: spawnChild("child", { id: "viaSpawnChild" }),
    type: "parallel",
    states: {
      a: { invoke: { src: "child", id: "invNamed", systemId: "invSys" } },
      b: { invoke: { src: childLogic } },
    },
  })

describe("C18 actor.toJSON and actor.src follow XState", () => {
  it.effect("[C18] JSON.stringify(actor) gives { xstate$$type: 1, id }, and an actor without an id has its session id as the id", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(idleMachine())

      assert.strictEqual(actor.id, actor.sessionId, "the default id is the session id")
      assert.deepStrictEqual(actor.toJSON(), marker(actor.id))
      assert.deepStrictEqual(Object.keys(actor.toJSON() as object), ["xstate$$type", "id"])
      assert.strictEqual(JSON.stringify(actor), `{"xstate$$type":1,"id":${JSON.stringify(actor.id)}}`)
    })
  )

  it.effect("[C18] an actor with an id and a systemId serialises the id only", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(idleMachine(), { id: "my-id", systemId: "sys" })

      assert.strictEqual(actor.systemId, "sys")
      assert.strictEqual(JSON.stringify(actor), '{"xstate$$type":1,"id":"my-id"}')
      assert.notInclude(JSON.stringify(actor), "sys", "no systemId and no session id")
    })
  )

  it.effect("[C18] actors of promise, callback and transition logic serialise the same way before start, while running and after stop", () =>
    Effect.gen(function* () {
      const promiseActor = yield* createActor(fromPromise(() => Promise.resolve(1)), { id: "promise" })
      const callbackActor = yield* createActor(fromCallback(() => undefined), { id: "callback" })
      const transitionActor = yield* createActor(childLogic, { id: "transition" })
      const actors = [promiseActor, callbackActor, transitionActor] as const

      const forms = () => actors.map((actor) => JSON.stringify(actor))
      const expected = [
        '{"xstate$$type":1,"id":"promise"}',
        '{"xstate$$type":1,"id":"callback"}',
        '{"xstate$$type":1,"id":"transition"}',
      ]
      assert.deepStrictEqual(forms(), expected, "before start")
      yield* Effect.forEach(actors, (actor) => actor.start, { discard: true })
      assert.deepStrictEqual(forms(), expected, "while running")
      yield* Effect.forEach(actors, (actor) => actor.stop, { discard: true })
      assert.deepStrictEqual(forms(), expected, "after stop")
    })
  )

  it.effect("[C18] a snapshot with children and actor refs in its context serialises each actor as its marker, without recursing into it", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(familyMachine(), { id: "root" })
      yield* actor.start
      const snapshot = yield* actor.getSnapshot

      const json = JSON.stringify(snapshot)
      assert.deepStrictEqual(JSON.parse(json), {
        status: "active",
        context: { named: marker("spawnedNamed"), inline: marker("spawnedInline") },
        value: { a: {}, b: {} },
        children: {
          spawnedNamed: marker("spawnedNamed"),
          spawnedInline: marker("spawnedInline"),
          viaSpawnChild: marker("viaSpawnChild"),
          invNamed: marker("invNamed"),
          "0.(machine).b": marker("0.(machine).b"),
        },
        historyValue: {},
        tags: [],
      })
      assert.notInclude(json, "sessionId", "no actor's own fields")
      assert.notInclude(json, "invSys", "no child's systemId")
      assert.strictEqual(JSON.stringify(actor), '{"xstate$$type":1,"id":"root"}')
      assert.strictEqual(
        JSON.stringify({ list: [actor], nested: { ref: actor } }),
        '{"list":[{"xstate$$type":1,"id":"root"}],"nested":{"ref":{"xstate$$type":1,"id":"root"}}}'
      )
    })
  )

  it.effect("[C18] actor.src is the logic for createActor and for an inline spawn", () =>
    Effect.gen(function* () {
      const machine = idleMachine()
      const promiseLogic = fromPromise(() => Promise.resolve(1))
      assert.strictEqual((yield* createActor(machine)).src, machine)
      assert.strictEqual((yield* createActor(promiseLogic)).src, promiseLogic)

      const actor = yield* createActor(familyMachine())
      yield* actor.start
      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.context.inline.src, childLogic)
      assert.strictEqual(childOf(snapshot.children, "spawnedInline").src, childLogic)
    })
  )

  it.effect("[C18] actor.src is the setup name for spawn, spawnChild and invoke by name, and the source name for an inline invoke", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(familyMachine())
      yield* actor.start
      const { children, context } = yield* actor.getSnapshot

      assert.strictEqual(context.named.src, "child")
      assert.strictEqual(childOf(children, "spawnedNamed").src, "child")
      assert.strictEqual(childOf(children, "viaSpawnChild").src, "child")
      assert.strictEqual(childOf(children, "invNamed").src, "child")
      assert.strictEqual(childOf(children, "0.(machine).b").src, "xstate.invoke.0.(machine).b")

      // A plain machine names an inline invoke, with or without an id, by its index in the
      // node's invoke list
      const listMachine = createMachine({
        id: "p",
        initial: "a",
        states: { a: { invoke: [{ src: childLogic, id: "x" }, { src: childLogic }] } },
      })
      const listActor = yield* createActor(listMachine)
      yield* listActor.start
      const listChildren = (yield* listActor.getSnapshot).children
      assert.strictEqual(childOf(listChildren, "x").src, "xstate.invoke.0.p.a")
      assert.strictEqual(childOf(listChildren, "1.p.a").src, "xstate.invoke.1.p.a")
    })
  )

  it.effect("[C18] the self of getInitialSnapshot and getNextSnapshot serialises as the marker with its own id", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        context: ({ self }) => ({ json: JSON.stringify(self), id: self.id }),
        on: {
          EV: { actions: assign({ json: ({ self }) => JSON.stringify(self), id: ({ self }) => self.id }) },
        },
      })

      const initial = yield* getInitialSnapshot(machine)
      assert.deepStrictEqual(JSON.parse(initial.context.json), marker(initial.context.id))
      const next = yield* getNextSnapshot(machine, initial, { type: "EV" })
      assert.deepStrictEqual(JSON.parse(next.context.json), marker(next.context.id))
    })
  )
})
