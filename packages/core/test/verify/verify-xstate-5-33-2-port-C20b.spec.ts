/**
 * C20b: each root actor owns its system.
 *
 * T2.40. Upstream `Actor` constructor in `src/createActor.ts` and `createSystem` in
 * `src/system.ts` at xstate@5.33.2: an actor without a parent creates its own system, and
 * an actor with a parent joins the parent's system. The port does the same even when an
 * `ActorSystemLive` layer is in scope: `createActor` never reads the layer's service, so
 * the shared layer memo map never shares a system between root actors (SD-8, SD-25,
 * SVC-06). Each system books its own session ids from `x:0` (SD-9).
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Exit, Option } from "effect"
import {
  type ActorSystemService,
  ActorSystemLiveFull,
  ActorSystemTag,
  createActor,
  createMachine,
  type EventObject,
  fromCallback,
} from "../../src/index.js"

const rootMachine = () =>
  createMachine<object, EventObject>({
    id: "c20b",
    initial: "idle",
    context: {},
    states: { idle: {} },
  })

/** Whether `system.get(key)` finds exactly `ref`. */
const finds = (system: ActorSystemService, key: string, ref: object) =>
  Effect.map(system.get(key), (found) => Option.isSome(found) && found.value === ref)

describe("C20b each root actor owns its system", () => {
  it.effect("[C20b] two root actors with one systemId under one ActorSystemLive layer each own a system and both start", () =>
    Effect.gen(function* () {
      const layerSystem = yield* ActorSystemTag
      const first = yield* createActor(rootMachine(), { systemId: "root" })
      const second = yield* createActor(rootMachine(), { systemId: "root" })

      assert.isTrue(Exit.isSuccess(yield* Effect.exit(first.start)))
      assert.isTrue(Exit.isSuccess(yield* Effect.exit(second.start)))

      assert.notStrictEqual(first.system, second.system)
      assert.notStrictEqual(first.system, layerSystem)
      assert.notStrictEqual(second.system, layerSystem)
      // Each system books its own session ids, so both roots are `x:0`
      assert.strictEqual(first.sessionId, "x:0")
      assert.strictEqual(second.sessionId, "x:0")
    }).pipe(Effect.provide(ActorSystemLiveFull))
  )

  it.effect("[C20b] system.get in one root's system never finds the other root's actors", () =>
    Effect.gen(function* () {
      const first = yield* createActor(rootMachine(), { systemId: "root" })
      const second = yield* createActor(rootMachine(), { systemId: "root" })
      yield* first.start
      yield* second.start
      const firstChild = yield* createActor(fromCallback(() => undefined), { id: "child", parent: first.ref })
      yield* firstChild.start

      for (const key of ["root", "child", first.sessionId, second.sessionId, firstChild.sessionId]) {
        assert.isFalse(yield* finds(first.system, key, second.ref), `first system, ${key}`)
        assert.isFalse(yield* finds(second.system, key, first.ref), `second system, ${key}`)
        assert.isFalse(yield* finds(second.system, key, firstChild.ref), `second system, child ${key}`)
      }
    }).pipe(Effect.provide(ActorSystemLiveFull))
  )

  it.effect("[C20b] a child shares its parent's system and books the next session id there", () =>
    Effect.gen(function* () {
      const parent = yield* createActor(rootMachine())
      const other = yield* createActor(rootMachine())
      const child = yield* createActor(fromCallback(() => undefined), { parent: parent.ref })

      assert.strictEqual(child.system, parent.system)
      assert.notStrictEqual(child.system, other.system)
      assert.strictEqual(parent.sessionId, "x:0")
      assert.strictEqual(child.sessionId, "x:1")
      assert.strictEqual(child.id, "x:1")
      assert.strictEqual(other.sessionId, "x:0")
    })
  )
})
