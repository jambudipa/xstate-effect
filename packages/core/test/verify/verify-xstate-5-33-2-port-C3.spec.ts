/**
 * C3: an invoked actor registers under its systemId.
 *
 * T5.5. Upstream (xstate@5.33.2): an invocation's `systemId` (`InvokeConfig.systemId`) goes
 * with the rest of the definition into the `spawnChild` that `enterStates` runs, so the child
 * is created with that `systemId` and registers under it in the constructor, before its own
 * snapshot is computed (`createActor.ts`). `exitStates` stops it, and `executeStop` /
 * `actorScope.stopChild` unregisters it and its descendants at once, so a reentering
 * transition registers the new child under the same `systemId`. A second actor under a
 * `systemId` in use throws `Actor with system ID '<id>' already exists.` from `_set`, which
 * the parent's transition turns into its error. A root invocation's child is created with the
 * root's initial snapshot, so `system.get` finds it before `start`.
 *
 * Every expectation below is what upstream gives for the same machine (a tsx probe of 5.33.2,
 * `packages/core/.upstream/measure/t55/probe-up.ts`), in Effect form: `system.get` gives an
 * Option (D7) and an error is the actor's status `error` (SD-4).
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { createActor, createMachine, setup, spawnChild, stopChild } from "../../src/index.js"
import { duplicateSystemId } from "./upstream-messages.js"

describe("C3 An invoked actor registers under its systemId", () => {
  it.effect("[C3] entering the state registers the invoked child under its systemId; after the state exits system.get gives None", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        initial: "a",
        states: {
          a: { invoke: { id: "child", src: createMachine({}), systemId: "sys" }, on: { NEXT: "b" } },
          b: {},
        },
      })

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      const found = yield* actor.system.get("sys")
      assert.isTrue(Option.isSome(found))
      assert.strictEqual(Option.getOrUndefined(found), (yield* actor.getSnapshot).children["child"])

      yield* actor.send({ type: "NEXT" })
      assert.isTrue(Option.isNone(yield* actor.system.get("sys")))
    }))

  it.effect("[C3] a reentering transition registers the new child under the same systemId", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        initial: "a",
        states: {
          a: { invoke: { src: createMachine({}), systemId: "sys" }, on: { AGAIN: { target: "a", reenter: true } } },
        },
      })

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      const first = Option.getOrUndefined(yield* actor.system.get("sys"))
      assert.isDefined(first)

      yield* actor.send({ type: "AGAIN" })
      const second = Option.getOrUndefined(yield* actor.system.get("sys"))
      assert.isDefined(second)
      assert.notStrictEqual(second, first)
      assert.strictEqual((yield* actor.getSnapshot).status, "active")
    }))

  it.effect("[C3] a root invocation's child is registered under its systemId when the actor is created, before start", () =>
    Effect.gen(function* () {
      const machine = createMachine({ invoke: { systemId: "someChild", src: createMachine({}) } })
      const actor = yield* createActor(machine)
      assert.isTrue(Option.isSome(yield* actor.system.get("someChild")))
    }))

  it.effect("[C3] two invocations under one systemId error the parent with the upstream message", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        initial: "inactive",
        states: {
          inactive: { on: { toggle: "active" } },
          active: {
            invoke: [
              { src: createMachine({}), systemId: "test" },
              { src: createMachine({}), systemId: "test" },
            ],
          },
        },
      })

      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      yield* actor.send({ type: "toggle" })
      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "error")
      assert.strictEqual(
        Option.match(snapshot.error, { onNone: () => "", onSome: (error) => (error as Error).message }),
        duplicateSystemId("test")
      )
    }))

  it.effect("[C3] stopping a child unregisters the systemId of the child it invokes, so spawning it again registers it again", () =>
    Effect.gen(function* () {
      const child = setup({ actors: { subchild: createMachine({}) } }).createMachine({
        id: "childSystem",
        invoke: { src: "subchild", systemId: "subchild" },
      })
      const parent = setup({ actors: { child } }).createMachine({
        entry: spawnChild("child", { id: "childId" }),
        on: { restart: { actions: [stopChild("childId"), spawnChild("child", { id: "childId" })] } },
      })

      const root = yield* Effect.tap(createActor(parent), (started) => started.start)
      const first = Option.getOrUndefined(yield* root.system.get("subchild"))
      assert.isDefined(first)

      yield* root.send({ type: "restart" })
      assert.strictEqual((yield* root.getSnapshot).status, "active")
      const second = Option.getOrUndefined(yield* root.system.get("subchild"))
      assert.isDefined(second)
      assert.notStrictEqual(second, first)
    }))
})
