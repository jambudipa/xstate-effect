/**
 * Export parity with xstate@5.33.2 (AC 1, scenario EXP-1; D6, D10, SD-11).
 *
 * The frozen manifest (`test/upstream/upstream-manifest.json`, `exports`) holds the value and
 * type names of the six upstream entry points: `.`, `./actions`, `./actors`, `./guards`,
 * `./graph` and `./dev`. Each port entry point is the source file that the package export of
 * the same name builds from (D10, T7.14: `./<name>` is `dist/<name>/index.js`).
 *
 * - Every upstream value name is a runtime export of the matching port entry point, or a row of
 *   the ledger's deviation table records its absence: the row's `Subject` holds the name in
 *   backticks and its `Port` cell starts `Not exported` or `Not ported`, or says
 *   `No `<name>`` (DEV-1, DEV-2, DEV-4). A row about how an exported name behaves (DEV-13, the
 *   root `stop`) does not excuse an absence.
 * - `exports.types.ts` imports every upstream type name from the matching port entry point;
 *   the test type-check (`tsconfig.test.green.json`, part of `pnpm typecheck`) proves that each
 *   import resolves. This test also type-checks the file with the options of
 *   `tsconfig.test.json`: no diagnostic, and each imported name has a type meaning (an import
 *   of a namespace or a value only compiles too). A type name it leaves out needs such a row.
 * - `interpret`, `toObserver` and `Subscription` are not ported (D6): the root has no such
 *   runtime export, `exports.types.ts` imports each from the root under `@ts-expect-error`, so
 *   a surviving type export fails the test type-check (AC 9), and a deviation row citing D6
 *   records each.
 * - Each upstream class export (`Actor`, `StateMachine`, `StateNode`, `SimulatedClock`, and the
 *   graph `TestModel`) is a class in the port, or a deviation row records that it is not (its
 *   `Port` cell starts `Not a class`, or the absence rule above). The root `StateMachine` and
 *   `Actor` are the classes of the port's machines and actors; `Actor` has no `new` (DEV-56).
 * - The root `stop` and the `./actions` `stop` are the deprecated alias of `stopChild` (SD-11).
 *
 * This file is not an upstream rewrite: the parity checker and the CONF-8 file count skip it
 * (`NON_TEST_FILES` in `test/verify/parity.ts`). The EXP-1 evidence file imports it.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { readFileSync } from "node:fs"
import { join, posix } from "node:path"
import ts from "typescript"
import type { LedgerRow } from "../verify/ledger.js"
import { Actor, createActor, createMachine, makeActor, makeStateMachine, StateMachine } from "../../src/index.js"
import { citedDecisions } from "../verify/ledger.js"
import { PKG_ROOT, readLedger, readManifest } from "../verify/parity.js"

// ---------------------------------------------------------------- the entry points

/** A module namespace object of a port entry point. */
type EntryModule = Readonly<Record<string, unknown>>

/** One port entry point: the upstream entry point it mirrors, its source file and its loader. */
interface PortEntry {
  readonly entry: string
  readonly source: string
  readonly load: () => Promise<EntryModule>
}

/**
 * The port entry point of each upstream entry point (D10). The loaders import the source
 * files, so the check needs no build; DELIVERY-1 checks the built package.
 */
const PORT_ENTRIES: ReadonlyArray<PortEntry> = [
  { entry: ".", source: "src/index.ts", load: () => import("../../src/index.js") },
  { entry: "./actions", source: "src/actions/index.ts", load: () => import("../../src/actions/index.js") },
  { entry: "./actors", source: "src/actors/index.ts", load: () => import("../../src/actors/index.js") },
  { entry: "./dev", source: "src/dev/index.ts", load: () => import("../../src/dev/index.js") },
  { entry: "./graph", source: "src/graph/index.ts", load: () => import("../../src/graph/index.js") },
  { entry: "./guards", source: "src/guards/index.ts", load: () => import("../../src/guards/index.js") }
]

/** The port entry point of an upstream entry point. */
const portEntry = (entry: string): PortEntry => {
  const found = PORT_ENTRIES.find((port) => port.entry === entry)
  assert.isDefined(found, `${entry} has a port entry point`)
  return found
}

/** The module of a port entry point, or none when its source file cannot be loaded. */
const loadEntry = (port: PortEntry): Effect.Effect<Option.Option<EntryModule>> =>
  Effect.tryPromise(port.load).pipe(Effect.map(Option.some), Effect.orElseSucceed(Option.none))

/** True when the module has a runtime export of that name. */
const hasValue = (module: Option.Option<EntryModule>, name: string): boolean =>
  Option.isSome(module) && Object.prototype.hasOwnProperty.call(module.value, name)

/** The upstream export lists of an entry point, from the frozen manifest. */
const upstreamExports = (entry: string) => {
  const list = readManifest().exports[entry]
  assert.isDefined(list, `the manifest holds the export lists of ${entry}`)
  return list
}

// ---------------------------------------------------------------- the ledger

/** The deviation rows of the ledger (kind `deviation`). */
const deviationRows = (): ReadonlyArray<LedgerRow> => {
  const { ledger, problems } = readLedger()
  assert.deepStrictEqual(problems, [], "the ledger parses")
  return ledger.deviations.filter((row) => row["Kind"] === "deviation")
}

/** The names a deviation row's `Subject` holds in backticks (`` `interpret` `` → `interpret`). */
const subjectNames = (row: LedgerRow): ReadonlyArray<string> =>
  [...(row["Subject"] ?? "").matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "")

/** The deviation rows whose `Subject` names `name`. */
const rowsNaming = (name: string): ReadonlyArray<LedgerRow> =>
  deviationRows().filter((row) => subjectNames(row).includes(name))

/**
 * True when the port is not exporting `name` on purpose: a deviation row names it in its
 * `Subject`, and its `Port` cell says so, starting `Not exported` or `Not ported`, or saying
 * `No `<name>``. A row about how an exported name behaves (DEV-13, root `stop`) does not
 * excuse its absence.
 */
const isLedgeredAbsent = (name: string): boolean =>
  rowsNaming(name).some((row) => {
    const port = row["Port"] ?? ""
    return /^Not (exported|ported)\b/.test(port) || port.includes(`No \`${name}\``)
  })

/**
 * True when a deviation row records that the port's `name` is not a class: its `Subject`
 * names it and its `Port` cell starts `Not a class`, or the row records that the name is not
 * exported. A row about how a class behaves (DEV-56, the `Actor` constructor) does not
 * excuse a value that is not a class.
 */
const isLedgeredNotAClass = (name: string): boolean =>
  isLedgeredAbsent(name) || rowsNaming(name).some((row) => /^Not a class\b/.test(row["Port"] ?? ""))

// ---------------------------------------------------------------- exports.types.ts

const TYPES_FILE = "test/upstream/exports.types.ts"

/** One import declaration of `exports.types.ts`: its port entry point and the names it imports. */
interface TypeImport {
  readonly entry: string | null
  readonly names: ReadonlyArray<string>
  readonly typeOnly: boolean
  readonly expectsError: boolean
}

/** The port entry point (`.`, `./actions`, ...) of a module specifier of `exports.types.ts`. */
const entryOfSpecifier = (specifier: string): string | null => {
  const source = posix.normalize(posix.join("test/upstream", specifier)).replace(/\.js$/, ".ts")
  return PORT_ENTRIES.find((port) => port.source === source)?.entry ?? null
}

/**
 * The import declarations of `exports.types.ts`. An import expects an error when the line
 * directly above it is a `// @ts-expect-error` comment.
 */
const typeImports = (): ReadonlyArray<TypeImport> => {
  const text = readFileSync(join(PKG_ROOT, TYPES_FILE), "utf8")
  const sf = ts.createSourceFile(TYPES_FILE, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  return sf.statements.filter(ts.isImportDeclaration).map((statement) => {
    const clause = statement.importClause
    const bindings = clause?.namedBindings
    const elements = bindings !== undefined && ts.isNamedImports(bindings) ? bindings.elements : []
    const above = text.slice(statement.getFullStart(), statement.getStart(sf)).trimEnd().split(/\r?\n/).at(-1) ?? ""
    return {
      entry: entryOfSpecifier((statement.moduleSpecifier as ts.StringLiteral).text),
      names: elements.map((element) => (element.propertyName ?? element.name).text),
      typeOnly: clause?.isTypeOnly === true || (elements.length > 0 && elements.every((element) => element.isTypeOnly)),
      expectsError: /^\s*\/\/\s*@ts-expect-error\b/.test(above)
    }
  })
}

/** The compiler options of the test type-check (`tsconfig.test.json`). */
const testCompilerOptions = (): ts.CompilerOptions => {
  const parsed = ts.getParsedCommandLineOfConfigFile(join(PKG_ROOT, "tsconfig.test.json"), {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: () => undefined
  })
  assert.isDefined(parsed, "tsconfig.test.json parses")
  return parsed.options
}

/** What the test type-check reports for `exports.types.ts`. */
interface TypesFileCheck {
  /** The diagnostics of the file, one `<line>: <message>` each. */
  readonly diagnostics: ReadonlyArray<string>
  /** The imported names that resolve to a symbol with no type meaning (a namespace or a value only). */
  readonly withoutType: ReadonlyArray<string>
}

/**
 * Type-checks `exports.types.ts` with the options of the test type-check. A name that does not
 * resolve, and an unused `@ts-expect-error`, is a diagnostic. An import of a name that resolves
 * to a namespace or a value only compiles too, so each imported name must also have a type
 * meaning.
 */
const checkTypesFile = (): TypesFileCheck => {
  const file = join(PKG_ROOT, TYPES_FILE)
  const program = ts.createProgram([file], testCompilerOptions())
  const source = program.getSourceFile(file)
  assert.isDefined(source, `${TYPES_FILE} is part of the program`)
  const diagnostics = [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)].map((diagnostic) => {
    const line = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1
    return `${line}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`
  })
  const checker = program.getTypeChecker()
  const withoutType = source.statements.filter(ts.isImportDeclaration).flatMap((statement) => {
    const bindings = statement.importClause?.namedBindings
    const elements = bindings !== undefined && ts.isNamedImports(bindings) ? bindings.elements : []
    return elements.flatMap((element) => {
      const local = checker.getSymbolAtLocation(element.name)
      const target = local === undefined ? undefined : checker.getAliasedSymbol(local)
      // An unresolved name is a diagnostic already
      if (target === undefined || target.escapedName === "unknown") return []
      return (target.flags & ts.SymbolFlags.Type) === 0 ? [(element.propertyName ?? element.name).text] : []
    })
  })
  return { diagnostics, withoutType }
}

// ---------------------------------------------------------------- the checks

/** The names that D6 leaves unported: two root values and one root type. */
const NOT_PORTED = ["Subscription", "interpret", "toObserver"] as const

/** The upstream class exports, by entry point (`export class` in the upstream source). */
const UPSTREAM_CLASSES: ReadonlyArray<{ readonly entry: string; readonly name: string }> = [
  { entry: ".", name: "Actor" },
  { entry: ".", name: "SimulatedClock" },
  { entry: ".", name: "StateMachine" },
  { entry: ".", name: "StateNode" },
  { entry: "./graph", name: "TestModel" }
]

/** True for a class constructor (an ES `class`, not a plain function or a namespace). */
const isClass = (value: unknown): boolean =>
  typeof value === "function" && /^class\b/.test(Function.prototype.toString.call(value))

describe("export parity with xstate@5.33.2", () => {
  it.effect("the manifest holds the export lists of the six upstream entry points, and each has a port entry point", () =>
    Effect.sync(() => {
      const entries = Object.keys(readManifest().exports).sort()
      assert.deepStrictEqual(entries, PORT_ENTRIES.map((port) => port.entry).sort())
      for (const entry of entries) {
        const list = upstreamExports(entry)
        assert.isAbove(list.values.length + list.types.length, 0, `${entry} exports names upstream`)
      }
    }))

  for (const { entry, source } of PORT_ENTRIES) {
    it.effect(`${entry}: every upstream value name is a runtime export of ${source}, or a deviation row records its absence`, () =>
      Effect.gen(function* () {
        const module = yield* loadEntry(portEntry(entry))
        const missing = upstreamExports(entry).values.filter((name) => !hasValue(module, name) && !isLedgeredAbsent(name))
        assert.deepStrictEqual(missing, [], `${entry}: upstream value names with no export in ${source} and no deviation row`)
      }))
  }

  for (const { entry, source } of PORT_ENTRIES) {
    it.effect(`${entry}: exports.types.ts imports every upstream type name from ${source}, or a deviation row records its absence`, () =>
      Effect.sync(() => {
        const imported = new Set(
          typeImports().filter((found) => found.entry === entry && !found.expectsError).flatMap((found) => found.names)
        )
        const missing = upstreamExports(entry).types.filter((name) => !imported.has(name) && !isLedgeredAbsent(name))
        assert.deepStrictEqual(missing, [], `${entry}: upstream type names that exports.types.ts does not import and no deviation row names`)
        const unknown = [...imported].filter((name) => !upstreamExports(entry).types.includes(name))
        assert.deepStrictEqual(unknown, [], `${entry}: exports.types.ts imports only upstream type names`)
      }))
  }

  it.effect(
    "the test type-check accepts exports.types.ts: every imported name resolves to a type, and every @ts-expect-error is used",
    () =>
      Effect.sync(() => {
        const { diagnostics, withoutType } = checkTypesFile()
        assert.deepStrictEqual(diagnostics, [], `${TYPES_FILE} has no type error`)
        assert.deepStrictEqual(withoutType, [], `${TYPES_FILE} imports only names with a type meaning`)
      }),
    60_000
  )

  it.effect("interpret and toObserver are absent from the root at runtime, and a deviation row citing D6 records each of interpret, toObserver and Subscription", () =>
    Effect.gen(function* () {
      const root = yield* loadEntry(portEntry("."))
      assert.isTrue(Option.isSome(root), "the root entry point loads")
      for (const name of ["interpret", "toObserver"]) {
        assert.isFalse(hasValue(root, name), `the root exports no ${name} (D6)`)
      }
      for (const name of NOT_PORTED) {
        const rows = rowsNaming(name)
        assert.isTrue(isLedgeredAbsent(name), `a deviation row records that ${name} is not exported`)
        assert.isTrue(
          rows.some((row) => citedDecisions(row["Decision"] ?? "").includes("D6")),
          `a deviation row of ${name} cites D6`
        )
      }
    }))

  it.effect("exports.types.ts imports interpret, toObserver and Subscription as types from the root, each under its own @ts-expect-error line", () =>
    Effect.sync(() => {
      const expected = typeImports().filter((found) => found.expectsError)
      for (const found of expected) {
        assert.strictEqual(found.entry, ".", "an expected-error import reads the root")
        assert.isTrue(found.typeOnly, `the import of ${found.names.join(", ")} is type-only`)
        assert.strictEqual(found.names.length, 1, "each expected-error import names one name")
      }
      assert.deepStrictEqual(expected.flatMap((found) => found.names).sort(), [...NOT_PORTED])
    }))

  for (const { entry, name } of UPSTREAM_CLASSES) {
    it.effect(`${entry}: the upstream class ${name} is a class in the port, or a deviation row records that it is not`, () =>
      Effect.gen(function* () {
        const module = yield* loadEntry(portEntry(entry))
        const value = Option.isSome(module) ? module.value[name] : undefined
        assert.isTrue(isClass(value) || isLedgeredNotAClass(name), `${entry} ${name} is a class or a deviation row records that it is not`)
      }))
  }

  it.effect("the root stop and the ./actions stop are the deprecated alias of stopChild (SD-11)", () =>
    Effect.gen(function* () {
      for (const entry of [".", "./actions"]) {
        const module = yield* loadEntry(portEntry(entry))
        assert.isTrue(Option.isSome(module), `${entry} loads`)
        if (Option.isSome(module)) {
          assert.isFunction(module.value["stopChild"], `${entry} exports stopChild`)
          assert.strictEqual(module.value["stop"], module.value["stopChild"], `${entry} stop is stopChild`)
        }
      }
    }))

  it.effect("the root StateMachine and Actor are the classes of the port's machines and actors, with the module functions as static members", () =>
    Effect.gen(function* () {
      const machine = createMachine({ id: "light", initial: "green", states: { green: { on: { NEXT: "yellow" } }, yellow: {} } })
      assert.instanceOf(machine, StateMachine)
      // upstream createMachine is new StateMachine(config, implementations): both build the same machine
      const built = new StateMachine({ id: "light", initial: "green", states: { green: { on: { NEXT: "yellow" } }, yellow: {} } })
      assert.instanceOf(built, StateMachine)
      assert.isTrue(StateMachine.isStateMachine(built))
      assert.strictEqual(JSON.stringify(built.toJSON()), JSON.stringify(machine.toJSON()))
      assert.deepStrictEqual(built.events, machine.events)
      assert.strictEqual(StateMachine.createMachine, createMachine)
      assert.strictEqual(StateMachine.make, makeStateMachine)

      const actor = yield* createActor(machine)
      assert.isTrue(actor instanceof Actor, "an actor is an instance of the root Actor")
      assert.isTrue(Actor.isActor(actor))
      assert.strictEqual(Actor.createActor, createActor)
      assert.strictEqual(Actor.make, makeActor)
      // DEV-56: an actor exists only inside the createActor Effect (D6, SD-8), so Actor has no new
      assert.isTrue(rowsNaming("Actor").some((row) => citedDecisions(row["Decision"] ?? "").includes("D6")))
    }))

  it.effect("SimulatedClock is a class value of the root, and new SimulatedClock() starts at time 0", () =>
    Effect.gen(function* () {
      const root = yield* loadEntry(portEntry("."))
      const SimulatedClock = Option.isSome(root) ? root.value["SimulatedClock"] : undefined
      assert.isTrue(isClass(SimulatedClock), "SimulatedClock is a class")
      if (isClass(SimulatedClock)) {
        const clock = new (SimulatedClock as new () => { readonly now: () => number })()
        assert.strictEqual(clock.now(), 0)
      }
    }))
})
