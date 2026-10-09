/**
 * API-1: the public API is Effect-native and the bridge APIs are absent (D6, AC 9).
 *
 * T8.4. Upstream xstate@5.33.2 calls `createActor`, `actor.getSnapshot()`, `actor.send()`,
 * `actor.subscribe()`, `system.get()` and `machine.getStateNodeById()` synchronously. D6 makes
 * each of them an Effect in the port (no XState-compatible facade): `createActor` and
 * `getStateNodeById` return Effects, `getSnapshot` is an Effect, and `send`, `subscribe` and
 * `system.get` return Effects. Each test checks `Effect.isEffect` and that the work happens
 * only when the Effect runs: a `createActor` Effect creates a new actor on each run, and a
 * `send` or `subscribe` that is built and never run changes nothing. The actor references
 * that `system.get` gives have the same Effect-native `getSnapshot`, `send` and `subscribe`
 * (the reference types carry `subscribe` since T6.14).
 *
 * `interpret`, `toObserver`, the observer-object `subscribe` and `Subscription` are not
 * ported (D6): `createActor` is the only constructor (the root `Actor` class has no `new`,
 * DEV-56), `subscribe` takes one observer function and gives no `Subscription` (the
 * observer ends with the `Scope` it ran in), the root has no `interpret`, `toObserver` or
 * `Subscription` value, the export-parity types file imports `interpret`, `toObserver` and
 * `Subscription` from the root under `@ts-expect-error` (EXP-1 proves the type half under the
 * test type-check, AC 9), and the ledger records each as a deviation that cites D6 (DEV-1 to
 * DEV-4). The type-level cases are this file's own type check (`tsc -p
 * tsconfig.test.green.json`).
 */
import { assert, describe, it } from "@effect/vitest"
import type { Scope } from "effect"
import { Effect, Option } from "effect"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import * as Core from "../../src/index.js"
import { createActor, createMachine, Errors, setup } from "../../src/index.js"
import type { LedgerRow } from "./ledger.js"
import { citedDecisions } from "./ledger.js"
import { PKG_ROOT, readLedger } from "./parity.js"

// ---------------------------------------------------------------- fixtures

type Ev = { readonly type: "NEXT" }

/** `a -NEXT-> b -NEXT-> c`; `b` has the custom id `bee`. */
const machine = createMachine({
  id: "api1",
  types: {} as { events: Ev },
  initial: "a",
  states: {
    a: { on: { NEXT: "b" } },
    b: { id: "bee", on: { NEXT: "c" } },
    c: {}
  }
})

/** Lets every other ready fiber take ten turns, so a subscriber takes what it was sent (as C16b). */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 10; turn++) {
    yield* Effect.yieldNow
  }
})

/** `true` when `A` and `B` are the same type. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

/** Compiles only for `true`. */
const typeHolds = <T extends true>(holds: T): T => holds

/** The deviation rows whose `Subject` names `name` in backticks. */
const deviationsNaming = (name: string): ReadonlyArray<LedgerRow> => {
  const { ledger, problems } = readLedger()
  assert.deepStrictEqual(problems, [], "the ledger parses")
  return ledger.deviations.filter(
    (row) => row["Kind"] === "deviation" && [...(row["Subject"] ?? "").matchAll(/`([^`]+)`/g)].some((m) => m[1] === name)
  )
}

describe("API-1 the public API is Effect-native and the bridge APIs are absent", () => {
  // ---------------------------------------------------------------- Effect-native calls

  it.effect("[API-1] createActor returns an Effect, and each run of that Effect creates a new actor", () =>
    Effect.gen(function* () {
      const created = createActor(machine)
      assert.isTrue(Effect.isEffect(created), "createActor(...) is an Effect")
      const actor = yield* created
      assert.isTrue(Core.isActor(actor))
      assert.isTrue(actor instanceof Core.Actor, "the actor is an instance of the root Actor class")
      // An Effect describes the work: running the same value again creates a second actor
      const other = yield* created
      assert.isTrue(Core.isActor(other))
      assert.notStrictEqual(other, actor)
      // each root actor has its own system (SD-25), so both have the session id x:0
      assert.notStrictEqual(other.system, actor.system)
      yield* actor.start
      yield* actor.send({ type: "NEXT" })
      yield* other.start
      assert.strictEqual((yield* actor.getSnapshot).value, "b")
      assert.strictEqual((yield* other.getSnapshot).value, "a")
    }))

  it.effect("[API-1] createActor is the only constructor: the root Actor class has no new (DEV-1, DEV-56)", () =>
    Effect.sync(() => {
      // an abstract construct signature only: `new Actor(logic)` does not compile
      typeHolds<Equals<typeof Core.Actor extends new(...args: never) => unknown ? true : false, false>>(true)
      typeHolds<Equals<typeof Core.Actor extends abstract new(...args: never) => unknown ? true : false, true>>(true)
      // `createActor` gives an Effect that needs the caller's Scope, not an actor
      const created = createActor(machine)
      typeHolds<Equals<Effect.Services<typeof created>, Scope.Scope>>(true)
      assert.isTrue(Effect.isEffect(created))
      assert.isFalse(Core.isActor(created), "createActor(...) is not an actor")
    }))

  it.effect("[API-1] createEmptyActor returns an Effect, and each run of that Effect creates a new actor", () =>
    Effect.gen(function* () {
      const created = Core.createEmptyActor()
      assert.isTrue(Effect.isEffect(created), "createEmptyActor() is an Effect")
      const actor = yield* created
      const other = yield* created
      assert.isTrue(Core.isActor(actor))
      assert.isTrue(Core.isActor(other))
      assert.notStrictEqual(other, actor)
    }))

  it.effect("[API-1] getSnapshot is an Effect that reads the current snapshot each time it runs", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(machine)
      yield* actor.start
      const read = actor.getSnapshot
      assert.isTrue(Effect.isEffect(read), "actor.getSnapshot is an Effect")
      assert.strictEqual((yield* read).value, "a")
      yield* actor.send({ type: "NEXT" })
      // the same Effect value reads the live snapshot (no cached result)
      assert.strictEqual((yield* read).value, "b")
    }))

  it.effect("[API-1] send returns an Effect, and the event is processed only when it runs", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(machine)
      yield* actor.start
      const sending = actor.send({ type: "NEXT" })
      assert.isTrue(Effect.isEffect(sending), "actor.send(event) is an Effect")
      // built but not run: nothing is sent
      assert.strictEqual((yield* actor.getSnapshot).value, "a")
      yield* sending
      assert.strictEqual((yield* actor.getSnapshot).value, "b")
    }))

  it.effect("[API-1] subscribe returns an Effect, and the observer is registered only when it runs", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(machine)
      yield* actor.start
      const seen: Array<unknown> = []
      const subscribing = actor.subscribe((snapshot) => Effect.sync(() => seen.push(snapshot.value)))
      assert.isTrue(Effect.isEffect(subscribing), "actor.subscribe(fn) is an Effect")
      yield* actor.send({ type: "NEXT" })
      yield* settle
      assert.deepStrictEqual(seen, [], "an unrun subscribe registers no observer")
      yield* subscribing
      yield* actor.send({ type: "NEXT" })
      yield* settle
      assert.deepStrictEqual(seen, ["c"])
    }))

  it.effect("[API-1] subscribe takes one observer function and gives no Subscription: the observer ends with the Scope it ran in (DEV-3, DEV-4)", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(machine)
      yield* actor.start
      // DEV-3: no observer object; DEV-4: the Effect succeeds with nothing, no Subscription
      typeHolds<Equals<{ readonly next: (snapshot: unknown) => Effect.Effect<void> } extends Parameters<typeof actor.subscribe>[0] ? true : false, false>>(true)
      typeHolds<Equals<ReturnType<typeof actor.subscribe>, Effect.Effect<void, never, Scope.Scope>>>(true)
      const seen: Array<unknown> = []
      const subscribed: unknown = yield* Effect.scoped(
        Effect.gen(function* () {
          const result: unknown = yield* actor.subscribe((snapshot) => Effect.sync(() => seen.push(snapshot.value)))
          yield* actor.send({ type: "NEXT" })
          yield* settle
          return result
        })
      )
      assert.isUndefined(subscribed, "subscribe gives no Subscription object")
      assert.deepStrictEqual(seen, ["b"])
      // the Scope closed: the observer takes nothing more
      yield* actor.send({ type: "NEXT" })
      yield* settle
      assert.strictEqual((yield* actor.getSnapshot).value, "c")
      assert.deepStrictEqual(seen, ["b"])
    }))

  it.effect("[API-1] system.get returns an Effect of an Option of the actor ref", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(machine, { systemId: "api1-root" })
      yield* actor.start
      const lookup = actor.system.get("api1-root")
      assert.isTrue(Effect.isEffect(lookup), "system.get(systemId) is an Effect")
      const found = yield* lookup
      assert.isTrue(Option.isSome(found))
      if (Option.isSome(found)) assert.strictEqual(found.value.id, actor.id)
      const missing = yield* actor.system.get("no-such-actor")
      assert.isTrue(Option.isNone(missing))
    }))

  it.effect("[API-1] a reference that system.get gives has an Effect getSnapshot, send and subscribe", () =>
    Effect.gen(function* () {
      const child = createMachine({
        id: "api1-child",
        types: {} as { events: { readonly type: "PING" } },
        initial: "idle",
        states: { idle: { on: { PING: "pinged" } }, pinged: {} }
      })
      const parent = yield* createActor(
        setup({ actors: { child } }).createMachine({ id: "api1-parent", invoke: { src: "child", systemId: "api1-child" } })
      )
      yield* parent.start
      const found = yield* parent.system.get("api1-child")
      assert.isTrue(Option.isSome(found), "system.get finds the invoked child")
      if (Option.isNone(found)) return
      const ref = found.value
      const read = ref.getSnapshot
      const sending = ref.send({ type: "PING" })
      const seen: Array<unknown> = []
      const subscribing = ref.subscribe((snapshot) => Effect.sync(() => seen.push(snapshot.value)))
      assert.isTrue(Effect.isEffect(read), "ref.getSnapshot is an Effect")
      assert.isTrue(Effect.isEffect(sending), "ref.send(event) is an Effect")
      assert.isTrue(Effect.isEffect(subscribing), "ref.subscribe(fn) is an Effect")
      yield* settle
      // built but not run: nothing is sent
      assert.strictEqual((yield* read).value, "idle")
      yield* subscribing
      yield* sending
      yield* settle
      assert.strictEqual((yield* read).value, "pinged")
      assert.deepStrictEqual(seen, ["pinged"])
    }))

  it.effect("[API-1] getStateNodeById returns an Effect that succeeds with the node or fails with StateNodeNotFoundError", () =>
    Effect.gen(function* () {
      const lookup = machine.getStateNodeById("bee")
      assert.isTrue(Effect.isEffect(lookup), "machine.getStateNodeById(id) is an Effect")
      const node = yield* lookup
      assert.deepStrictEqual(node.path, ["b"])
      const failure = yield* Effect.flip(machine.getStateNodeById("no-such-node"))
      assert.instanceOf(failure, Errors.StateNodeNotFoundError)
    }))

  it.effect("[API-1] the same calls are Effects on a setup().createMachine machine", () =>
    Effect.gen(function* () {
      const typed = setup({ types: {} as { events: Ev } }).createMachine({
        id: "api1-setup",
        initial: "a",
        states: { a: { id: "ay", on: { NEXT: "b" } }, b: {} }
      })
      const created = createActor(typed, { systemId: "api1-setup-root" })
      assert.isTrue(Effect.isEffect(created))
      const actor = yield* created
      yield* actor.start
      assert.isTrue(Effect.isEffect(actor.getSnapshot))
      assert.isTrue(Effect.isEffect(actor.send({ type: "NEXT" })))
      assert.isTrue(Effect.isEffect(actor.subscribe(() => Effect.void)))
      assert.isTrue(Effect.isEffect(actor.system.get("api1-setup-root")))
      assert.isTrue(Effect.isEffect(typed.getStateNodeById("ay")))
    }))

  // ---------------------------------------------------------------- the bridge APIs

  it.effect("[API-1] the root exports no interpret, toObserver or Subscription value", () =>
    Effect.sync(() => {
      const root: Readonly<Record<string, unknown>> = Core
      for (const name of ["interpret", "toObserver", "Subscription"]) {
        assert.isFalse(Object.prototype.hasOwnProperty.call(root, name), `the root exports no ${name}`)
        assert.isUndefined(root[name])
      }
    }))

  it.effect("[API-1] interpret, toObserver and Subscription are imported under @ts-expect-error by the export-parity types file", () =>
    Effect.sync(() => {
      const lines = readFileSync(join(PKG_ROOT, "test/upstream/exports.types.ts"), "utf8").split(/\r?\n/)
      for (const name of ["interpret", "toObserver", "Subscription"]) {
        const at = lines.findIndex((line) => line.trim() === `import type { ${name} } from "../../src/index.js"`)
        assert.isAbove(at, 0, `exports.types.ts imports ${name} from the root`)
        assert.match(lines[at - 1] ?? "", /^\s*\/\/\s*@ts-expect-error\b/, `${name}: the line above is @ts-expect-error`)
      }
    }))

  it.effect("[API-1] interpret, toObserver, the observer-object subscribe and Subscription each have a deviation row citing D6", () =>
    Effect.sync(() => {
      for (const subject of ["interpret", "toObserver", "Subscription"]) {
        const rows = deviationsNaming(subject)
        assert.isAbove(rows.length, 0, `a deviation row names ${subject}`)
        assert.isTrue(rows.some((row) => citedDecisions(row["Decision"] ?? "").includes("D6")), `${subject}: the row cites D6`)
      }
      const { ledger } = readLedger()
      const observer = ledger.deviations.filter((row) => /observer-object subscribe/.test(row["Subject"] ?? ""))
      assert.strictEqual(observer.length, 1, "one deviation row covers the observer-object subscribe")
      assert.include(citedDecisions(observer[0]?.["Decision"] ?? ""), "D6")
    }))
})
