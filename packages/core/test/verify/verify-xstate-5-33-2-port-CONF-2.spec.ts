/**
 * CONF-2: the upstream files green at phase 2 pass (SD-1, SD-2).
 *
 * The file imports each rewrite whose ledger green phase is 2 inside its own describe block
 * titled `upstream/<name>.test.ts`, so every upstream test of the file runs once, inside the
 * default run, and its evidence routes to CONF-2. `conformancePhase` (`conformance.ts`)
 * keeps the blocks and its checks in declaration order, also under `--sequence.shuffle`:
 *
 * - the graduation check: each imported rewrite has left `pending.json` and the green
 *   type-check exclude (one commit, SD-1), and the ledger marks it `passes`;
 * - the import check: the file imports exactly deep, initial and multiple (the ledger's
 *   green-phase 2 files), and no other CONF evidence file imports one of them;
 * - the count check, last: per file, `passed >= runnable - notPortedRunnable` and
 *   `passed >= 1`, no skipped test, and no test still to run (16 runnable upstream tests).
 *
 * T2.55 to T2.57 imported deep, initial and multiple under the graduation check alone;
 * T2.58 switched to `conformancePhase`. The shape case below pins the order of the checks
 * and the floor case pins the count data of phase 2.
 *
 * The rewrites of phase 2 build machines with no `context` and no `id`, as upstream does.
 * The last describe blocks pin what such a machine, or one with a falsy context, starts
 * with (XState's `{}`), that a context factory's result goes through an assign on that
 * `{}` (a falsy result gives `{}`, an object result a shallow copy), that a declared
 * context type still needs its context (the `@ts-expect-error` line proves it under
 * `pnpm typecheck`, `tsconfig.test.green.json`), and the XState default id `(machine)` of
 * a machine with no id (SD-10).
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { createActor, createMachine, type EventObject, type MachineContext } from "../../src/index.js"
import { conformancePhase, greenFiles, requiredPassed, upstreamFileOptions } from "./conformance.js"
import { shortName } from "./ledger.js"
import { readLedger, readManifest } from "./parity.js"

// ---------------------------------------------------------------- the imported files

conformancePhase(2, () => {
  describe("upstream/deep.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/deep.test.js")
  })
  describe("upstream/initial.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/initial.test.js")
  })
  describe("upstream/multiple.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/multiple.test.js")
  })
})

// ---------------------------------------------------------------- the shape of the suite and its count floor

const SUITE_TITLE = "[CONF-2] upstream files green at phase 2"

describe("[CONF-2] the CONF-2 suite and its count floor", () => {
  it("[CONF-2] the suite imports deep, initial and multiple, then runs the graduation, import and count checks, the count check last, and never shuffles its own children", ({ task }) => {
    const suite = task.file.tasks.find((child) => child.name === SUITE_TITLE)
    assert.strictEqual(suite?.type, "suite")
    const children = suite?.type === "suite" ? suite.tasks : []
    assert.deepStrictEqual(children.map((child) => [child.type, child.name]), [
      ["suite", "upstream/deep.test.ts"],
      ["suite", "upstream/initial.test.ts"],
      ["suite", "upstream/multiple.test.ts"],
      ["test", "[CONF-2] each imported rewrite has left pending.json and the green type-check exclude, and the ledger marks it passes"],
      ["test", "[CONF-2] the evidence file imports exactly the upstream files green at phase 2, and no other CONF evidence file imports them"],
      ["test", "[CONF-2] every imported file meets its count"]
    ])
    assert.strictEqual(suite?.type === "suite" ? suite.shuffle : undefined, false)
  })

  it.effect("[CONF-2] the files green at phase 2 are deep, initial and multiple, with 16 runnable upstream tests and a floor of 16 passed: the 6 skipped-upstream rows of multiple lower nothing", () =>
    Effect.sync(() => {
      const { ledger, problems } = readLedger()
      assert.deepStrictEqual(problems, [])
      const manifest = readManifest()
      // [name, runnable, upstream skip + todo, "Tests not ported" rows, required passed]
      const floors = greenFiles(ledger.files, 2).map((row) => {
        const name = row["Name"] ?? ""
        const upstream = manifest.files.find((file) => shortName(file.path) === name)
        if (upstream === undefined) return [name]
        const rows = ledger.notPorted.filter((notPorted) => notPorted["File"] === upstream.path).length
        return [name, upstream.runnable, upstream.skip + upstream.todo, rows, requiredPassed(upstream, ledger.notPorted)]
      })
      assert.deepStrictEqual(floors, [
        ["deep", 9, 0, 0, 9],
        ["initial", 3, 0, 0, 3],
        ["multiple", 4, 6, 6, 4]
      ])
      assert.strictEqual(floors.reduce((total, floor) => total + Number(floor[4]), 0), 16)
    }))
})

// ---------------------------------------------------------------- machines without context

describe("[CONF-2] a machine config without context", () => {
  it.effect("[CONF-2] a machine with no context starts with the empty context {}, live and persisted, as upstream", () =>
    Effect.gen(function* () {
      const machine = createMachine({ id: "noContext", initial: "a", states: { a: {} } })
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      const snapshot = yield* actor.getSnapshot
      assert.deepStrictEqual(snapshot.context, {})
      const persisted = (yield* actor.getPersistedSnapshot) as { readonly context: unknown }
      assert.deepStrictEqual(persisted.context, {})
    }))

  it.effect("[CONF-2] a falsy context (null, 0, \"\", false, NaN) also starts as {}, live and persisted, as upstream", () =>
    // upstream `_getPreInitialState`: `typeof context !== 'function' && context ? context : {}`
    Effect.forEach(
      [null, 0, "", false, Number.NaN] as ReadonlyArray<unknown>,
      (context) =>
        Effect.gen(function* () {
          // The falsy values are no MachineContext (upstream's type rejects them as well); the
          // cast reaches the run-time path that upstream's `_getPreInitialState` covers
          const machine = createMachine({ id: "falsyContext", initial: "a", context: context as MachineContext, states: { a: {} } })
          const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
          const snapshot = yield* actor.getSnapshot
          assert.deepStrictEqual(snapshot.context, {}, `context ${String(context)}`)
          const persisted = (yield* actor.getPersistedSnapshot) as { readonly context: unknown }
          assert.deepStrictEqual(persisted.context, {}, `persisted context ${String(context)}`)
        }),
      { discard: true }
    ))

  it.effect("[CONF-2] a context factory that returns a falsy value (null, undefined, 0, \"\", false, NaN) also starts as {}, live and persisted, as upstream", () =>
    // upstream `_getPreInitialState` runs the factory as an assign on the empty context:
    // `resolveAssign` gives `Object.assign({}, {}, result)`
    Effect.forEach(
      [null, undefined, 0, "", false, Number.NaN] as ReadonlyArray<unknown>,
      (result) =>
        Effect.gen(function* () {
          const machine = createMachine({ id: "falsyFactory", initial: "a", context: () => result, states: { a: {} } })
          const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
          const snapshot = yield* actor.getSnapshot
          assert.deepStrictEqual(snapshot.context, {}, `factory result ${String(result)}`)
          const persisted = (yield* actor.getPersistedSnapshot) as { readonly context: unknown }
          assert.deepStrictEqual(persisted.context, {}, `persisted factory result ${String(result)}`)
        }),
      { discard: true }
    ))

  it.effect("[CONF-2] a context factory's object result is a shallow copy (a new plain object with its own keys), as upstream", () =>
    // upstream `resolveAssign`: `Object.assign({}, {}, result)` copies the own enumerable
    // keys into a new plain object; the values keep their references
    Effect.gen(function* () {
      const shared = { items: [1, 2] }
      class Counter {
        readonly count = 1
        readonly shared = shared
      }
      const results: ReadonlyArray<object> = [{ count: 1, shared }, new Counter()]
      yield* Effect.forEach(
        results,
        (result) =>
          Effect.gen(function* () {
            const machine = createMachine({ id: "objectFactory", initial: "a", context: () => result, states: { a: {} } })
            const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
            const context = (yield* actor.getSnapshot).context as { readonly count: unknown; readonly shared: unknown }
            assert.notStrictEqual(context, result, "a new reference")
            assert.strictEqual(Object.getPrototypeOf(context), Object.prototype, "a plain object")
            assert.deepStrictEqual(Object.keys(context), ["count", "shared"])
            assert.strictEqual(context.count, 1)
            assert.strictEqual(context.shared, shared, "a shallow copy keeps the value references")
          }),
        { discard: true }
      )
    }))

  it.effect("[CONF-2] a declared context type still needs its context", () =>
    Effect.sync(() => {
      const missing = () =>
        // @ts-expect-error `context` is required once the context type is declared (XState MachineConfig)
        createMachine<{ readonly count: number }, EventObject>({ id: "declared", initial: "a", states: { a: {} } })
      const given = createMachine<{ readonly count: number }, EventObject>({
        id: "declared",
        initial: "a",
        context: { count: 0 },
        states: { a: {} }
      })
      assert.isFunction(missing)
      assert.deepStrictEqual(given.config.context, { count: 0 })
    }))
})

// ---------------------------------------------------------------- machines without id

describe("[CONF-2] a machine config without id", () => {
  it.effect("[CONF-2] a machine with no id has the id (machine), and its state ids start with it, as upstream (SD-10)", () =>
    Effect.gen(function* () {
      const machine = createMachine({ initial: "a", states: { a: {} } })
      assert.strictEqual(machine.id, "(machine)")
      assert.strictEqual(machine.root.id, "(machine)")
      assert.deepStrictEqual(machine.stateIds, ["(machine)", "(machine).a"])
      const actor = yield* Effect.tap(createActor(machine), (started) => started.start)
      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.machine.id, "(machine)")
    }))

  it.effect("[CONF-2] an empty id also gives the id (machine), as upstream (config.id || '(machine)')", () =>
    Effect.sync(() => {
      const machine = createMachine({ id: "", initial: "a", states: { a: {} } })
      assert.strictEqual(machine.id, "(machine)")
      assert.deepStrictEqual(machine.stateIds, ["(machine)", "(machine).a"])
    }))
})
