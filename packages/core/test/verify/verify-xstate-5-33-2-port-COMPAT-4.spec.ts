/**
 * COMPAT-4: every baseline port export survives or has a ledger row.
 *
 * T8.11 (Amelia's finding). T1.2 froze the port's own export list into the manifest
 * (`portBaseline` of `test/upstream/upstream-manifest.json`) before any port code changed: the
 * root values and types, and the members of each `export * as` namespace. The freeze script
 * keeps that section byte-identical on a rerun (HARNESS-1); this file pins its SHA-256 as T1.2
 * first committed it (commit e6196f4), so an edit of the list itself fails here (AC 31).
 *
 * Each baseline name must still exist in the finished port, or the ledger's deviation table
 * must hold a `removed` row whose Subject names it (`name` for a root export, `Ns.member` for a
 * namespace member; backticks and a list separated by `,` or `and` allowed):
 *
 * - a value name is checked at run time, through the root module and its namespace objects
 *   (a namespace may now be a class with static members, as `StateNode` is, or a constant, as
 *   `StateValue` is);
 * - a type name is checked with the TypeScript checker on `src/index.ts`: the export (or the
 *   namespace member) must still have a type or namespace meaning, so a type that became a
 *   value only counts as gone.
 *
 * The port extras that the baseline offered keep working: the StateNode builders (`atomic`,
 * `withTransitions`, `getLeafStates`), `fromTransitionWithInput`, `waitForPromise` and
 * `ActorRef.isChildOf`; the output of `Snapshot.updateContext` keeps `matches`, `hasTag`,
 * `can`, `getMeta` and `toJSON` (SD-6).
 */
import { assert, describe, it } from "@effect/vitest"
import { Chunk, Effect, Option } from "effect"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import type { PortBaseline, UpstreamManifest } from "../../scripts/upstream/freeze-upstream.js"
import * as Root from "../../src/index.js"
import {
  ActorRef,
  atomic,
  compound,
  createActor,
  createMachine,
  type EventObject,
  fromCallback,
  fromTransitionWithInput,
  getLeafStates,
  getTransitions,
  Snapshot,
  spawnChild,
  StateNode,
  waitForPromise,
  withTransitions,
} from "../../src/index.js"
import { citedDecisions, LEDGER_FILE, type LedgerRow, parseLedger } from "./ledger.js"

const pkgRoot = fileURLToPath(new URL("../../", import.meta.url))

/** The commit that first committed the manifest with its port baseline (T1.2). */
const FIRST_MANIFEST_COMMIT = "e6196f4"

/**
 * SHA-256 of `JSON.stringify(manifest.portBaseline)` (compact, the manifest's key order) at
 * {@link FIRST_MANIFEST_COMMIT}. The section is unchanged at every later commit of the file.
 */
const BASELINE_SHA256 = "5fea9c99b482f1082d434f838a4d65abeb3f4165cec9f3927ef6193b42011658"

/** The port commit the baseline list was read at. */
const BASELINE_PORT_COMMIT = "fb2f060d5689a1d6ab6a740ac5554d6b5b968e68"

const readBaseline = Effect.sync(
  () =>
    (JSON.parse(readFileSync(join(pkgRoot, "test/upstream/upstream-manifest.json"), "utf8")) as UpstreamManifest)
      .portBaseline
)

const readLedger = Effect.sync(() => parseLedger(readFileSync(join(pkgRoot, LEDGER_FILE), "utf8")))

/** The root entry point of the baseline list (the port had only `.` at the baseline). */
const rootListOf = (baseline: PortBaseline) => {
  const root = baseline.exports["."]
  assert.isDefined(root, "the baseline lists the root entry point")
  return root!
}

/** The qualified names a `removed` row names: its Subject without backticks, split into a list. */
const namesOfRemovedRow = (row: LedgerRow): ReadonlyArray<string> =>
  (row["Subject"] ?? "")
    .replace(/`/g, "")
    .split(/\s*,\s*|\s+and\s+/)
    .map((name) => name.trim())
    .filter((name) => name !== "")

/** The `removed` rows of the ledger's deviation table. */
const removedRowsOf = (rows: ReadonlyArray<LedgerRow>): ReadonlyArray<LedgerRow> =>
  rows.filter((row) => row["Kind"] === "removed")

/** Every qualified name that a `removed` row covers. */
const removedNames = Effect.map(readLedger, ({ ledger }) => new Set(removedRowsOf(ledger.deviations).flatMap(namesOfRemovedRow)))

/** True when `container` holds a defined member `name`: an object, a module or a function (a class's statics). */
const hasMember = (container: unknown, name: string): boolean =>
  (typeof container === "object" || typeof container === "function") &&
  container !== null &&
  name in container &&
  (container as Record<string, unknown>)[name] !== undefined

/** The root module as a record, for lookups by name. */
const rootRecord: Readonly<Record<string, unknown>> = Root

// ---------------------------------------------------------------- the TypeScript view of the root

const COMPILER_OPTIONS: ts.CompilerOptions = {
  allowImportingTsExtensions: true,
  lib: ["lib.es2024.d.ts", "lib.dom.d.ts"],
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  noEmit: true,
  skipLibCheck: true,
  strict: true,
  target: ts.ScriptTarget.ESNext,
  types: [],
}

/** Whether a symbol has a meaning of the given kind once its alias chain is followed. */
interface Meanings {
  readonly value: boolean
  readonly type: boolean
}

/** The root's exports and each export's members, by name, with their meanings. */
interface RootTypes {
  readonly exports: ReadonlyMap<string, Meanings>
  readonly membersOf: (name: string) => ReadonlyMap<string, Meanings>
}

/** The checker's view of the root, read once for the file (a program over `src/` takes about half a second). */
let rootTypesCache: RootTypes | undefined = undefined

/** Reads the root entry point with the TypeScript checker (the freeze script's options). */
const readRootTypes = Effect.sync((): RootTypes => {
  rootTypesCache ??= checkRootTypes()
  return rootTypesCache
})

const checkRootTypes = (): RootTypes => {
  const entry = join(pkgRoot, "src/index.ts")
  const program = ts.createProgram([entry], COMPILER_OPTIONS)
  const checker = program.getTypeChecker()
  const source = program.getSourceFile(entry)
  assert.isDefined(source, "the checker loads src/index.ts")
  const moduleSymbol = checker.getSymbolAtLocation(source!)
  assert.isDefined(moduleSymbol, "src/index.ts is a module")
  const resolve = (symbol: ts.Symbol): ts.Symbol =>
    (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol
  const meaningsOf = (symbol: ts.Symbol): Meanings => {
    const target = resolve(symbol)
    return {
      value: (target.flags & ts.SymbolFlags.Value) !== 0,
      // A namespace that holds only types (the baseline's `Types.Variance`) is a type name too
      type: (target.flags & (ts.SymbolFlags.Type | ts.SymbolFlags.Namespace)) !== 0,
    }
  }
  const rootSymbols = new Map(checker.getExportsOfModule(moduleSymbol!).map((symbol) => [symbol.name, symbol] as const))
  return {
    exports: new Map([...rootSymbols].map(([name, symbol]) => [name, meaningsOf(symbol)] as const)),
    membersOf: (name) => {
      const members = new Map<string, Meanings>()
      const symbol = rootSymbols.get(name)
      if (symbol === undefined) return members
      const target = resolve(symbol)
      // A module namespace (`export * as`), and the members a class or a namespace declares
      if ((target.flags & ts.SymbolFlags.Module) !== 0) {
        for (const member of checker.getExportsOfModule(target)) members.set(member.name, meaningsOf(member))
      }
      target.exports?.forEach((member, key) => {
        members.set(String(key), meaningsOf(member))
      })
      return members
    },
  }
}

// ---------------------------------------------------------------- fixtures for the extras

interface Count {
  readonly count: number
}

type CountEvent = { readonly type: "inc" } | { readonly type: "GO" } | { readonly type: "DONE" }

/** `a -GO-> b` (tag `at-b`, meta `{ note: "b" }`) `-DONE-> c`. */
const tagMachine = () =>
  createMachine<Count, CountEvent>({
    id: "compat4",
    context: { count: 0 },
    initial: "a",
    states: {
      a: { on: { GO: "b" } },
      b: { tags: ["at-b"], meta: { note: "b" }, on: { DONE: "c" } },
      c: {},
    },
  })

describe("COMPAT-4 Every baseline port export survives or has a ledger row", () => {
  it.effect("[COMPAT-4] the baseline export list is the one T1.2 first committed, unchanged since (SHA-256 pinned at commit e6196f4)", () =>
    Effect.gen(function* () {
      const baseline = yield* readBaseline
      const digest = createHash("sha256").update(JSON.stringify(baseline)).digest("hex")
      assert.strictEqual(digest, BASELINE_SHA256, `the baseline section differs from the one committed at ${FIRST_MANIFEST_COMMIT}`)
      assert.strictEqual(baseline.commit, BASELINE_PORT_COMMIT)
      assert.strictEqual(baseline.package, "@xstate-effect/core")
      assert.deepStrictEqual(Object.keys(baseline.exports), ["."])
      const root = rootListOf(baseline)
      assert.isAbove(root.values.length, 100)
      assert.isAbove(root.types.length, 50)
      assert.strictEqual(Object.keys(root.namespaces).length, 15)
    })
  )

  it.effect("[COMPAT-4] every baseline root value is a runtime export of the root entry point, or has a removed ledger row", () =>
    Effect.gen(function* () {
      const root = rootListOf(yield* readBaseline)
      const removed = yield* removedNames
      const gone = root.values.filter((name) => !hasMember(rootRecord, name) && !removed.has(name))
      assert.deepStrictEqual(gone, [], "root values missing at run time with no removed row")
    })
  )

  it.effect("[COMPAT-4] every baseline namespace value is reachable through its root namespace at run time, or has a removed ledger row", () =>
    Effect.gen(function* () {
      const root = rootListOf(yield* readBaseline)
      const removed = yield* removedNames
      const gone = Object.entries(root.namespaces).flatMap(([namespace, members]) =>
        members.values
          .map((member) => `${namespace}.${member}`)
          .filter((qualified) => {
            const [, member = ""] = qualified.split(".")
            return !hasMember(rootRecord[namespace], member) && !removed.has(qualified) && !removed.has(namespace)
          })
      )
      assert.deepStrictEqual(gone, [], "namespace values missing at run time with no removed row")
    })
  )

  it.effect("[COMPAT-4] every baseline type name still names a type at the root or inside its root namespace, or has a removed ledger row", () =>
    Effect.gen(function* () {
      const root = rootListOf(yield* readBaseline)
      const removed = yield* removedNames
      const types = yield* readRootTypes
      const rootGone = root.types.filter((name) => types.exports.get(name)?.type !== true && !removed.has(name))
      const memberGone = Object.entries(root.namespaces).flatMap(([namespace, members]) => {
        const current = types.membersOf(namespace)
        return members.types
          .map((member) => `${namespace}.${member}`)
          .filter((qualified) => {
            const [, member = ""] = qualified.split(".")
            return current.get(member)?.type !== true && !removed.has(qualified) && !removed.has(namespace)
          })
      })
      assert.deepStrictEqual([...rootGone, ...memberGone], [], "type names gone with no removed row")
    })
  )

  it.effect("[COMPAT-4] each removed ledger row names only baseline exports that are gone, and cites the decision that removed them", () =>
    Effect.gen(function* () {
      const root = rootListOf(yield* readBaseline)
      const { ledger, problems } = yield* readLedger
      assert.deepStrictEqual(problems, [])
      const types = yield* readRootTypes
      const baselineNames = new Set([
        ...root.values,
        ...root.types,
        ...Object.entries(root.namespaces).flatMap(([namespace, members]) => [
          namespace,
          ...[...members.values, ...members.types].map((member) => `${namespace}.${member}`),
        ]),
      ])
      /** Whether a baseline name still exists in each of its baseline meanings. */
      const stillExists = (qualified: string): boolean => {
        const [first = "", member] = qualified.split(".")
        if (member === undefined) {
          const isValue = root.values.includes(first)
          return isValue ? hasMember(rootRecord, first) : types.exports.get(first)?.type === true
        }
        const members = root.namespaces[first]
        const isValue = members?.values.includes(member) ?? false
        return isValue ? hasMember(rootRecord[first], member) : types.membersOf(first).get(member)?.type === true
      }
      const faults = removedRowsOf(ledger.deviations).flatMap((row) => {
        const id = row["ID"] ?? ""
        const names = namesOfRemovedRow(row)
        return [
          ...(names.length === 0 ? [`${id}: the Subject names no export`] : []),
          ...names.filter((name) => !baselineNames.has(name)).map((name) => `${id}: ${name} is not a baseline export`),
          ...names.filter((name) => baselineNames.has(name) && stillExists(name)).map((name) => `${id}: ${name} still exists`),
          ...(citedDecisions(row["Decision"] ?? "").length === 0 ? [`${id}: cites no decision`] : []),
        ]
      })
      assert.deepStrictEqual(faults, [])
    })
  )

  it.effect("[COMPAT-4] the StateNode builders atomic, withTransitions and getLeafStates keep working, as flat exports and as StateNode statics", () =>
    Effect.gen(function* () {
      const machine = tagMachine()
      const goTransitions = machine.root.states["a"]?.transitions
      assert.isDefined(goTransitions)

      const red = atomic<Count, CountEvent>("red", "light", 0)
      assert.strictEqual(red.type, "atomic")
      assert.strictEqual(red.key, "red")
      assert.strictEqual(red.id, "light.red")
      assert.strictEqual(red.order, 0)

      const wired = withTransitions(red, goTransitions!)
      assert.strictEqual(Chunk.size(getTransitions(wired, "GO")), 1)
      assert.strictEqual(Chunk.size(getTransitions(red, "GO")), 0, "withTransitions leaves the original node unchanged")

      const green = StateNode.atomic<Count, CountEvent>("green", "light", 1)
      const light = compound<Count, CountEvent>("light", "", 0, { red: wired, green }, { target: ["red"], actions: Chunk.empty() })
      assert.deepStrictEqual(Chunk.toReadonlyArray(getLeafStates(light)).map((node) => node.key), ["red", "green"])
      assert.deepStrictEqual(Chunk.toReadonlyArray(StateNode.getLeafStates(light)).map((node) => node.key), ["red", "green"])
      assert.strictEqual(StateNode.withTransitions, withTransitions)
      assert.deepStrictEqual(Chunk.toReadonlyArray(getLeafStates(machine.root)).map((node) => node.key), ["a", "b", "c"])
    })
  )

  it.effect("[COMPAT-4] fromTransitionWithInput keeps working: the initial state comes from the raw input, and the reducer runs on each event", () =>
    Effect.gen(function* () {
      const logic = fromTransitionWithInput<{ readonly start: number }>()(
        (state: Count, event: CountEvent) => (event.type === "inc" ? { count: state.count + 1 } : state),
        ({ start }) => ({ count: start })
      )
      const actor = yield* createActor(logic, { input: { start: 41 } })
      yield* actor.start

      yield* actor.send({ type: "inc" })

      assert.deepStrictEqual((yield* actor.getSnapshot).context, { count: 42 })
    })
  )

  it.effect("[COMPAT-4] waitForPromise keeps working: it resolves with the first snapshot that meets the predicate", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(tagMachine())
      yield* actor.start

      const pending = waitForPromise(actor, (snapshot) => snapshot.matches("b"))
      yield* actor.send({ type: "GO" })
      const reached = yield* Effect.promise(() => pending)

      assert.strictEqual(reached.value, "b")
      assert.isTrue(reached.hasTag("at-b"))
    })
  )

  it.effect("[COMPAT-4] ActorRef.isChildOf keeps working: true for a spawned child and its parent, false otherwise", () =>
    Effect.gen(function* () {
      const machine = createMachine<object, EventObject>({
        id: "compat4-parent",
        context: {},
        entry: spawnChild<object, EventObject, ReturnType<typeof fromCallback>>(fromCallback(() => undefined), { id: "child" }),
      })
      const parent = yield* createActor(machine)
      yield* parent.start
      const other = yield* createActor(createMachine<object, EventObject>({ id: "compat4-other", context: {} }))
      const child = (yield* parent.getSnapshot).children["child"]
      assert.isDefined(child)

      assert.isTrue(yield* ActorRef.isChildOf(child!, parent))
      assert.isTrue(ActorRef.equals(parent, parent))
      assert.isTrue(Option.exists(child!._parent, (ref) => ActorRef.equals(ref, parent)), "the child's parent reference is the parent")
      assert.isFalse(ActorRef.equals(child!, parent))
      // Each root owns its system and numbers its session ids from x:0 (SD-9, SD-25), so a
      // root of another system shares the parent's session id and is still not the parent
      assert.strictEqual(other.sessionId, parent.sessionId, "the two roots share a session id, each in its own system")
      assert.isFalse(ActorRef.equals(parent, other), "two roots of two systems are two actors")
      assert.isFalse(ActorRef.equals(other, parent))
      assert.isFalse(yield* ActorRef.isChildOf(child!, other))
      assert.isFalse(yield* ActorRef.isChildOf(parent, child!))
      assert.isFalse(yield* ActorRef.isChildOf(other, parent))
    })
  )

  it.effect("[COMPAT-4] the output of Snapshot.updateContext keeps matches, hasTag, can, getMeta and toJSON as working non-enumerable own properties (SD-6)", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(tagMachine())
      yield* actor.start
      yield* actor.send({ type: "GO" })
      const updated = Snapshot.updateContext(yield* actor.getSnapshot, { count: 7 })

      for (const method of ["matches", "hasTag", "can", "getMeta", "toJSON"] as const) {
        const descriptor = Object.getOwnPropertyDescriptor(updated, method)
        assert.isDefined(descriptor, `${method} is an own property`)
        assert.isFalse(descriptor?.enumerable ?? true, `${method} is not enumerable`)
        assert.strictEqual(typeof descriptor?.value, "function", `${method} is a function`)
      }
      assert.deepStrictEqual(updated.context, { count: 7 })
      assert.isTrue(updated.matches("b"))
      assert.isFalse(updated.matches("a"))
      assert.isTrue(updated.hasTag("at-b"))
      assert.isTrue(yield* updated.can({ type: "DONE" }))
      assert.isFalse(yield* updated.can({ type: "GO" }))
      assert.deepStrictEqual(updated.getMeta(), { "compat4.b": { note: "b" } })
      const json = updated.toJSON() as { readonly context: unknown; readonly value: unknown }
      assert.deepStrictEqual(json.context, { count: 7 })
      assert.strictEqual(json.value, "b")
      assert.isTrue(Option.isNone(updated.output))
    })
  )
})
