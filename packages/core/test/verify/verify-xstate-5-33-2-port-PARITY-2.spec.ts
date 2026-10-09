/**
 * PARITY-2: the upstream files that task phase 2 rewrites (SD-2).
 *
 * T1.5 adds the checks of the ported upstream test helpers (every name holds
 * "upstream/utils.ts"): `test/upstream/utils.ts` (`testAll`, `testMultiTransition`),
 * `test/upstream/trackEntries.ts` and `test/upstream/graph/testUtils.ts`. The rewrite tasks
 * of phase 2 add one check per rewritten file.
 *
 * `utils.ts` and `graph/testUtils.ts` are written against the target API and stay in
 * `pending.json` until their first green user (a rewrite that imports one and has left
 * `pending.json`; for utils.ts that is id.test.ts, T3.27). This file never imports them: it
 * checks them with the parity checker and runs them in a sandbox (the module transpiled to
 * CommonJS, with `@effect/vitest` and `src/index.js` replaced by recording stubs).
 * `trackEntries.ts` is not pending; it runs here against the real `createMachine`.
 *
 * Each rewrite check (`[PARITY-2] upstream/<file>`) runs the parity checker on the rewrite
 * with the real ledger, asserts that it reports no gap, and that the ledger no longer lists
 * the file as `not started`.
 */
import { assert, describe, expect, it } from "@effect/vitest"
import * as EffectModule from "effect"
import { Effect, Exit } from "effect"
import { existsSync, globSync, readFileSync } from "node:fs"
import { posix } from "node:path"
import { compileFunction } from "node:vm"
import ts from "typescript"
import { createMachine } from "../../src/index.js"
import { trackEntries } from "../upstream/trackEntries.js"
import { checkRewrite, formatGap, PKG_ROOT, readLedger, readManifest } from "./parity.js"

const UTILS = "test/upstream/utils.ts"
const TRACK_ENTRIES = "test/upstream/trackEntries.ts"
const GRAPH_UTILS = "test/upstream/graph/testUtils.ts"

const readText = (relative: string): string => readFileSync(posix.join(PKG_ROOT, relative), "utf8")

const readModule = (relative: string): string | null => {
  const absolute = posix.join(PKG_ROOT, relative)
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : null
}

const pendingRewrites = (): ReadonlyArray<string> =>
  JSON.parse(readText("test/upstream/pending.json")) as ReadonlyArray<string>

/** The rewrites under `test/upstream/` with an import declaration that names `helper`, sorted. */
const helperUsers = (helper: string): ReadonlyArray<string> =>
  globSync("test/upstream/**/*.test.ts", { cwd: PKG_ROOT })
    .filter((rewrite) => {
      const sf = ts.createSourceFile(rewrite, readText(rewrite), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
      return sf.statements
        .filter(ts.isImportDeclaration)
        .map((statement) => (statement.moduleSpecifier as ts.StringLiteral).text)
        .some((specifier) =>
          specifier.startsWith(".") &&
          posix.normalize(posix.join(posix.dirname(rewrite), specifier)).replace(/\.js$/, ".ts") === helper
        )
    })
    .sort()

// ---------------------------------------------------------------- the rewrites

/**
 * The parity of the rewrite of one upstream test file, checked against the frozen manifest
 * and the "Tests not ported" rows of the real ledger, with the file's ledger row.
 */
const rewriteParity = (upstreamPath: string) => {
  const upstream = readManifest().files.find((file) => file.path === upstreamPath)
  if (upstream === undefined) throw new Error(`${upstreamPath} is not in the manifest`)
  const { ledger, problems } = readLedger()
  assert.deepStrictEqual(problems, [], "the ledger parses")
  const row = ledger.files.find((candidate) => candidate["Upstream file"] === upstreamPath)
  if (row === undefined) throw new Error(`${upstreamPath} has no row in the ledger`)
  const rewritePath = row["Rewrite"] ?? ""
  const report = checkRewrite({
    upstream,
    rewritePath,
    source: readModule(rewritePath),
    notPorted: ledger.notPorted,
    readModule
  })
  return { report, row }
}

// ---------------------------------------------------------------- the sandbox

/** A test that a helper registered through the stubbed `it.effect`. */
interface Registered {
  readonly title: string
  readonly body: () => Effect.Effect<void>
}

interface Sandbox<Exports> {
  readonly exports: Exports
  readonly registered: ReadonlyArray<Registered>
}

/**
 * Runs a helper module in isolation: TypeScript transpiles it to CommonJS (type-only imports
 * vanish), `effect` is the real module, `@effect/vitest` gives the real `expect` and an
 * `it.effect` that records the test instead of registering it, and `modules` stands in for
 * the port's entry points. An import the sandbox does not provide fails the test by name.
 */
const loadHelper = <Exports>(relative: string, modules: Readonly<Record<string, unknown>>): Sandbox<Exports> => {
  const { outputText } = ts.transpileModule(readText(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: relative
  })
  const registered: Array<Registered> = []
  const provided: Readonly<Record<string, unknown>> = {
    effect: EffectModule,
    "@effect/vitest": {
      expect,
      it: {
        effect: (title: string, body: () => Effect.Effect<void>) => {
          registered.push({ title, body })
        }
      }
    },
    ...modules
  }
  const module = { exports: {} as Record<string, unknown> }
  const require = (specifier: string): unknown => {
    if (!(specifier in provided)) {
      throw new Error(`${relative} imports '${specifier}', which the sandbox does not provide`)
    }
    return provided[specifier]
  }
  compileFunction(outputText, ["require", "exports", "module"], { filename: relative })(require, module.exports, module)
  return { exports: module.exports as Exports, registered }
}

interface StubSnapshot {
  readonly value: unknown
}

interface UtilsExports {
  readonly testAll: (machine: unknown, expected: Record<string, Record<string, unknown>>) => void
  readonly testMultiTransition: (machine: unknown, fromState: string, eventTypes: string) => Effect.Effect<StubSnapshot>
}

/** The stub transition table: `E1` goes to `b`, `E2` to `{ c: 'd' }`, any other event stays. */
const NEXT: Readonly<Record<string, unknown>> = { E1: "b", E2: { c: "d" } }

/**
 * `utils.ts` in the sandbox, with a stub machine whose `resolveState` gives the value it is
 * given as an Effect (SD-3, amended 2026-10-08), and stubs of `getNextSnapshot` and
 * `matchesState` that record their calls.
 */
const utilsSandbox = () => {
  const resolved: Array<unknown> = []
  const steps: Array<{ readonly logic: unknown; readonly from: unknown; readonly event: unknown }> = []
  const matched: Array<readonly [unknown, unknown]> = []
  const machine = {
    resolveState: (config: { readonly value: unknown; readonly context: unknown }): Effect.Effect<StubSnapshot> =>
      Effect.sync(() => {
        resolved.push(config)
        return { value: config.value }
      })
  }
  const src = {
    getNextSnapshot: (logic: unknown, snapshot: StubSnapshot, event: { readonly type: string }) =>
      Effect.sync((): StubSnapshot => {
        steps.push({ logic, from: snapshot.value, event })
        return { value: event.type in NEXT ? NEXT[event.type] : snapshot.value }
      }),
    matchesState: (parent: unknown, child: unknown): boolean => {
      matched.push([parent, child])
      return parent === child
    }
  }
  const sandbox = loadHelper<UtilsExports>(UTILS, { "../../src/index.js": src })
  return { ...sandbox, machine, resolved, steps, matched }
}

// ---------------------------------------------------------------- the machine config walk

type NodeConfig = Readonly<Record<string, unknown>>

const asArray = (value: unknown): ReadonlyArray<unknown> =>
  Array.isArray(value) ? value : value === undefined ? [] : [value]

/** Every state node config in document order, with its upstream path description. */
const nodeConfigs = (root: unknown): ReadonlyArray<readonly [string, NodeConfig]> => {
  const walk = (config: NodeConfig, path: ReadonlyArray<string>): ReadonlyArray<readonly [string, NodeConfig]> => [
    [path.length === 0 ? "__root__" : path.join("."), config],
    ...Object.entries((config["states"] ?? {}) as Readonly<Record<string, NodeConfig>>).flatMap(([key, child]) =>
      walk(child, [...path, key])
    )
  ]
  return walk(root as NodeConfig, [])
}

const firstAction = (config: NodeConfig, kind: "entry" | "exit"): () => void => {
  const action = asArray(config[kind])[0]
  assert.isFunction(action, `the first ${kind} action must be the tracker`)
  return action as () => void
}

const sampleConfig = () => ({
  id: "m",
  context: {},
  initial: "a",
  states: {
    a: {
      initial: "b",
      entry: "own",
      states: {
        b: { exit: ["x", "y"] },
        hist: { type: "history" as const }
      }
    },
    p: {
      type: "parallel" as const,
      states: { x: {}, y: {} }
    }
  }
})

const SAMPLE_PATHS = ["__root__", "a", "a.b", "a.hist", "p", "p.x", "p.y"]

/**
 * `createMachine` over the sample config. The cast lets node `a` keep a single (non-array)
 * entry action, which XState accepts and the port's config type accepts from T2.32 on.
 */
const sampleMachine = (
  config: ReturnType<typeof sampleConfig> = sampleConfig(),
  implementations?: Parameters<typeof createMachine>[1]
) => createMachine(config as unknown as Parameters<typeof createMachine>[0], implementations)

// ---------------------------------------------------------------- the tests

describe("PARITY-2", () => {
  it.effect("[PARITY-2] upstream/utils.ts helpers carry their upstream annotation on the line above", () =>
    Effect.sync(() => {
      const helpers: ReadonlyArray<readonly [string, string, string]> = [
        [UTILS, "test/utils.ts", "resolveSerializedStateValue"],
        [UTILS, "test/utils.ts", "testMultiTransition"],
        [UTILS, "test/utils.ts", "testAll"],
        [TRACK_ENTRIES, "test/utils.ts", "trackEntries"],
        [GRAPH_UTILS, "src/graph/test/testUtils.ts", "testModel"],
        [GRAPH_UTILS, "src/graph/test/testUtils.ts", "testPaths"],
        [GRAPH_UTILS, "src/graph/test/testUtils.ts", "testUtils"]
      ]
      for (const [file, upstream, name] of helpers) {
        const declaration = new RegExp(
          `^// upstream: ${upstream.replace(/[.]/g, "\\.")} > ${name}\\n(export )?(function|const) ${name}\\b`,
          "m"
        )
        assert.match(readText(file), declaration, `${file}: ${name}`)
      }
    }))

  it.effect("[PARITY-2] upstream/utils.ts gives every testAll annotation its upstream assertion count", () =>
    Effect.sync(() => {
      const manifest = readManifest()
      const expanded: Readonly<Record<string, number>> = {
        "test/examples/6.16.test.ts": 9,
        "test/examples/6.6.test.ts": 16,
        "test/examples/6.8.test.ts": 16,
        "test/examples/6.9.test.ts": 32,
        "test/examples/cd.test.ts": 23,
        "test/id.test.ts": 6
      }
      const rewriteOf = (path: string, utils: string | null) => {
        const upstream = manifest.files.find((file) => file.path === path)
        assert.isDefined(upstream, path)
        if (upstream === undefined) throw new Error(path)
        const generated = upstream.tests.filter((test) => test.kind === "generated")
        assert.strictEqual(generated.length, 1, path)
        const test = generated[0]
        if (test === undefined) throw new Error(path)
        assert.strictEqual(test.generator, "testAll")
        const rewritePath = path.replace(/^test\//, "test/upstream/")
        const specifier = path.startsWith("test/examples/") ? "../utils.js" : "./utils.js"
        const source = [
          `import { testAll } from "${specifier}"`,
          `describe(${JSON.stringify(test.describePath[0])}, () => {`,
          `  // upstream: ${test.annotation}`,
          `  testAll(machine, expected)`,
          `})`,
          ``
        ].join("\n")
        const report = checkRewrite({
          upstream,
          rewritePath,
          source,
          notPorted: [],
          readModule: (relative) => (relative === UTILS && utils !== null ? utils : readModule(relative))
        })
        return { report, gaps: report.gaps.filter((gap) => gap.annotation === test.annotation) }
      }

      for (const [path, count] of Object.entries(expanded)) {
        const { report, gaps } = rewriteOf(path, null)
        assert.deepStrictEqual(gaps, [], path)
        assert.strictEqual(report.annotatedRunnable, count, path)
      }

      // The check is not vacuous: a testAll body with one assertion is an assertions gap.
      const real = readText(UTILS)
      let kept = 0
      const weakened = real.replace(/\bexpect\(/g, (match) => (kept++ === 0 ? match : "noAssert("))
      const { gaps } = rewriteOf("test/id.test.ts", weakened)
      assert.deepStrictEqual(gaps.map((gap) => gap.kind), ["assertions"])
    }))

  it.effect("[PARITY-2] upstream/utils.ts testAll makes one it.effect per inner key with the upstream title", () =>
    Effect.sync(() => {
      const manifest = readManifest()
      const title = manifest.files
        .flatMap((file) => file.tests)
        .find((test) => test.generator === "testAll")?.title
      assert.strictEqual(title, "should go from ${fromState} to ${JSON.stringify(toState)} on ${eventTypes}")

      const sf = ts.createSourceFile(UTILS, readText(UTILS), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
      const titles: Array<string> = []
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
          node.expression.getText(sf) === "it.effect"
        ) {
          const first = node.arguments[0]
          if (first !== undefined) titles.push(first.getText(sf).slice(1, -1).replace(/\s+/g, ""))
        }
        ts.forEachChild(node, visit)
      }
      visit(sf)
      assert.deepStrictEqual(titles, [(title ?? "").replace(/\s+/g, "")])

      const { exports, machine, registered } = utilsSandbox()
      exports.testAll(machine, {
        a: { E1: "b", "E1, E2": { c: "d" } },
        "{\"x\":\"y\"}": { E3: undefined }
      })
      assert.deepStrictEqual(registered.map((test) => test.title), [
        "should go from a to \"b\" on E1",
        "should go from a to {\"c\":\"d\"} on E1, E2",
        "should go from {\"x\":\"y\"} to undefined on E3"
      ])
    }))

  it.effect("[PARITY-2] upstream/utils.ts testMultiTransition resolves the from-state and steps with getNextSnapshot", () =>
    Effect.gen(function* () {
      const { exports, machine, resolved, steps } = utilsSandbox()

      const multi = exports.testMultiTransition(machine, "a", "E1,E2")
      assert.isTrue(Effect.isEffect(multi))
      assert.deepStrictEqual(steps, [], "testMultiTransition is lazy: nothing runs before the Effect")
      assert.deepStrictEqual((yield* multi).value, { c: "d" })
      assert.deepStrictEqual(resolved, [{ value: "a", context: {} }])
      assert.deepStrictEqual(steps, [
        { logic: machine, from: "a", event: { type: "E1" } },
        { logic: machine, from: "b", event: { type: "E2" } }
      ])

      const serialized = yield* exports.testMultiTransition(machine, "{\"x\":\"y\"}", "E3, E1")
      assert.deepStrictEqual(serialized.value, "b")
      assert.deepStrictEqual(resolved[1], { value: { x: "y" }, context: {} })
      assert.deepStrictEqual(steps.slice(2).map((step) => step.from), [{ x: "y" }, { x: "y" }])
    }))

  it.effect("[PARITY-2] upstream/utils.ts testAll compares with matchesState, toEqual and the resolved from-state", () =>
    Effect.gen(function* () {
      const passing = utilsSandbox()
      passing.exports.testAll(passing.machine, {
        a: { E1: "b", "E1, E2": { c: "d" } },
        "{\"x\":\"y\"}": { E3: undefined }
      })
      for (const test of passing.registered) {
        const exit = yield* Effect.exit(test.body())
        assert.isTrue(Exit.isSuccess(exit), test.title)
      }
      assert.deepStrictEqual(passing.matched, [["b", "b"]])

      const failing = utilsSandbox()
      failing.exports.testAll(failing.machine, {
        a: { E1: "c", "E1, E2": { c: "e" } },
        "{\"x\":\"y\"}": { E1: undefined }
      })
      assert.strictEqual(failing.registered.length, 3)
      for (const test of failing.registered) {
        const exit = yield* Effect.exit(test.body())
        assert.isTrue(Exit.isFailure(exit), `${test.title} must fail`)
      }
      assert.deepStrictEqual(failing.matched, [["c", "b"]])
    }))

  it.effect("[PARITY-2] upstream/utils.ts trackEntries logs enter and exit of every state node", () =>
    Effect.sync(() => {
      const machine = sampleMachine()
      const flushTracked = trackEntries(machine)
      const nodes = nodeConfigs(machine.config)
      assert.deepStrictEqual(nodes.map(([path]) => path), SAMPLE_PATHS)

      assert.deepStrictEqual(flushTracked(), [])
      for (const [, config] of nodes) firstAction(config, "entry")()
      for (const [, config] of [...nodes].reverse()) firstAction(config, "exit")()
      assert.deepStrictEqual(flushTracked(), [
        ...SAMPLE_PATHS.map((path) => `enter: ${path}`),
        ...[...SAMPLE_PATHS].reverse().map((path) => `exit: ${path}`)
      ])
      assert.deepStrictEqual(flushTracked(), [], "flushing empties the log")

      firstAction(nodes[2]?.[1] ?? {}, "exit")()
      assert.deepStrictEqual(flushTracked(), ["exit: a.b"])
      for (const [, config] of nodes) {
        assert.strictEqual(firstAction(config, "entry").name, "__testEntryTracker")
        assert.strictEqual(firstAction(config, "exit").name, "__testExitTracker")
      }
    }))

  it.effect("[PARITY-2] upstream/utils.ts trackEntries runs before the node's own actions and leaves the user config alone", () =>
    Effect.gen(function* () {
      const config = sampleConfig()
      const machine = sampleMachine(config, { delays: { short: 10 } })
      const implementations = machine.implementations
      trackEntries(machine)

      const byPath = new Map(nodeConfigs(machine.config))
      assert.deepStrictEqual(asArray(byPath.get("a")?.["entry"]).slice(1), ["own"])
      assert.deepStrictEqual(asArray(byPath.get("a.b")?.["exit"]).slice(1), ["x", "y"])
      assert.strictEqual(asArray(byPath.get("p.x")?.["entry"]).length, 1)

      assert.strictEqual(config.states.a.entry, "own", "the user's config object is not changed")
      assert.deepStrictEqual(config.states.a.states.b.exit, ["x", "y"])
      assert.strictEqual(machine.id, "m")
      assert.deepStrictEqual(machine.implementations, implementations)

      // The machine's own node tree, which the engine reads, carries the trackers.
      assert.strictEqual(Array.from((yield* machine.getStateNodeById("m.a")).entry).length, 2)
      assert.strictEqual(Array.from((yield* machine.getStateNodeById("m.a.b")).exit).length, 3)
      assert.strictEqual(Array.from((yield* machine.getStateNodeById("m.p.y")).exit).length, 1)
      assert.strictEqual(Array.from(machine.root.entry).length, 1)
    }))

  it.effect("[PARITY-2] upstream/utils.ts trackEntries accepts a machine only once", () =>
    Effect.sync(() => {
      const machine = sampleMachine()
      trackEntries(machine)
      assert.throws(() => trackEntries(machine), "This helper can't accept the same machine more than once")
      assert.isFunction(trackEntries(sampleMachine()))
    }))

  it.effect("[PARITY-2] upstream/utils.ts graph testUtils runs path.test(params) over the shortest or the given paths", () =>
    Effect.gen(function* () {
      interface GraphExports {
        readonly testUtils: {
          readonly testModel: (model: unknown, params: unknown) => Effect.Effect<void, string>
          readonly testPaths: (paths: ReadonlyArray<unknown>, params: unknown) => Effect.Effect<void, string>
        }
      }
      const { exports } = loadHelper<GraphExports>(GRAPH_UTILS, {})
      const calls: Array<string> = []
      const path = (name: string, fails = false) => ({
        test: (params: { readonly id: string }) =>
          Effect.suspend(() => {
            calls.push(`${name}:${params.id}`)
            return fails ? Effect.fail(`${name} failed`) : Effect.void
          })
      })
      const model = {
        getShortestPaths: () =>
          Effect.sync(() => {
            calls.push("shortest")
            return [path("p1"), path("p2")]
          })
      }

      const run = exports.testUtils.testModel(model, { id: "x" })
      assert.deepStrictEqual(calls, [], "testModel is lazy: nothing runs before the Effect")
      yield* run
      assert.deepStrictEqual(calls, ["shortest", "p1:x", "p2:x"])

      calls.length = 0
      yield* exports.testUtils.testPaths([path("p2"), path("p1")], { id: "y" })
      assert.deepStrictEqual(calls, ["p2:y", "p1:y"])

      calls.length = 0
      const error = yield* Effect.flip(exports.testUtils.testPaths([path("p1", true), path("p2")], { id: "z" }))
      assert.strictEqual(error, "p1 failed")
      assert.deepStrictEqual(calls, ["p1:z"], "a failing path stops the run, as upstream's await does")
    }))

  it.effect("[PARITY-2] upstream/utils.ts and graph/testUtils.ts are pending until their first green user; trackEntries.ts is not and imports only built modules", () =>
    Effect.sync(() => {
      const pending = pendingRewrites()
      const utilsUsers = helperUsers(UTILS)
      assert.include(utilsUsers, "test/upstream/id.test.ts", "id.test.ts is a user of utils.ts")
      assert.include(utilsUsers, "test/upstream/examples/6.6.test.ts", "examples import utils.ts from their sub-folder")
      for (const helper of [UTILS, GRAPH_UTILS]) {
        const users = helperUsers(helper)
        assert.strictEqual(
          pending.includes(helper),
          users.every((user) => pending.includes(user)),
          `${helper} is pending exactly while each of its users (${users.join(", ")}) is pending`
        )
      }
      assert.notInclude(pending, TRACK_ENTRIES)

      const sf = ts.createSourceFile(TRACK_ENTRIES, readText(TRACK_ENTRIES), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
      const relative = sf.statements
        .filter(ts.isImportDeclaration)
        .map((statement) => (statement.moduleSpecifier as ts.StringLiteral).text)
        .filter((specifier) => specifier.startsWith("."))
      assert.isAbove(relative.length, 0)
      for (const specifier of relative) {
        const target = posix.normalize(posix.join(posix.dirname(TRACK_ENTRIES), specifier)).replace(/\.js$/, ".ts")
        assert.isTrue(target.startsWith("src/"), `${specifier} must name a module of src/`)
        assert.isTrue(existsSync(posix.join(PKG_ROOT, target)), `${target} must exist now`)
        assert.notInclude(pending, target)
      }
    }))

  it.effect("[PARITY-2] upstream/order.test.ts rewrites test/order.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/order.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/order.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 1)
      assert.strictEqual(report.annotatedRunnable, 1)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-2] upstream/parallel.test.ts rewrites test/parallel.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/parallel.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/parallel.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 28)
      assert.strictEqual(report.annotatedRunnable, 28)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-2] upstream/examples/6.9.test.ts rewrites test/examples/6.9.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/examples/6.9.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/examples/6.9.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 32)
      assert.strictEqual(report.annotatedRunnable, 32)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-2] upstream/examples/6.8.test.ts rewrites test/examples/6.8.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/examples/6.8.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/examples/6.8.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 17)
      assert.strictEqual(report.annotatedRunnable, 17)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-2] upstream/examples/6.6.test.ts rewrites test/examples/6.6.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/examples/6.6.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/examples/6.6.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 16)
      assert.strictEqual(report.annotatedRunnable, 16)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-2] upstream/internalTransitions.test.ts rewrites test/internalTransitions.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/internalTransitions.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/internalTransitions.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 12)
      assert.strictEqual(report.annotatedRunnable, 12)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-2] upstream/initial.test.ts rewrites test/initial.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/initial.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/initial.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 3)
      assert.strictEqual(report.annotatedRunnable, 3)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-2] upstream/id.test.ts rewrites test/id.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/id.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/id.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 10)
      assert.strictEqual(report.annotatedRunnable, 10)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-2] upstream/deep.test.ts rewrites test/deep.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/deep.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/deep.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 9)
      assert.strictEqual(report.annotatedRunnable, 9)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-2] upstream/deterministic.test.ts rewrites test/deterministic.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/deterministic.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/deterministic.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 17)
      assert.strictEqual(report.annotatedRunnable, 17)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-2] upstream/event.test.ts rewrites test/event.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/event.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/event.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 2)
      assert.strictEqual(report.annotatedRunnable, 2)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-2] upstream/examples/6.17.test.ts rewrites test/examples/6.17.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/examples/6.17.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/examples/6.17.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 8)
      assert.strictEqual(report.annotatedRunnable, 8)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-2] upstream/examples/cd.test.ts rewrites test/examples/cd.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/examples/cd.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/examples/cd.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 23)
      assert.strictEqual(report.annotatedRunnable, 23)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-2] upstream/multiple.test.ts rewrites test/multiple.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/multiple.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/multiple.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 4)
      assert.strictEqual(report.annotatedRunnable, 4)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-2] upstream/examples/6.16.test.ts rewrites test/examples/6.16.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/examples/6.16.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/examples/6.16.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 9)
      assert.strictEqual(report.annotatedRunnable, 9)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-2] upstream/spawnChild.test.ts rewrites test/spawnChild.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/spawnChild.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/spawnChild.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 4)
      assert.strictEqual(report.annotatedRunnable, 4)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-2] upstream/transient.test.ts rewrites test/transient.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/transient.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/transient.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 24)
      assert.strictEqual(report.annotatedRunnable, 24)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-2] upstream/predictableExec.test.ts rewrites test/predictableExec.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/predictableExec.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/predictableExec.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 17)
      assert.strictEqual(report.annotatedRunnable, 17)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-2] upstream/rehydration.test.ts rewrites test/rehydration.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/rehydration.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/rehydration.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 18)
      assert.strictEqual(report.annotatedRunnable, 18)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-2] upstream/emit.test.ts rewrites test/emit.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/emit.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/emit.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 14)
      assert.strictEqual(report.annotatedRunnable, 14)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-2] upstream/system.test.ts rewrites test/system.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/system.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/system.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 22)
      assert.strictEqual(report.annotatedRunnable, 22)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-2] upstream/guards.test.ts rewrites test/guards.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/guards.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/guards.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 46)
      assert.strictEqual(report.annotatedRunnable, 46)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-2] upstream/history.test.ts rewrites test/history.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/history.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/history.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 35)
      assert.strictEqual(report.annotatedRunnable, 35)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-2] upstream/final.test.ts rewrites test/final.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/final.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/final.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 33)
      assert.strictEqual(report.annotatedRunnable, 33)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-2] upstream/errors.test.ts rewrites test/errors.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/errors.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/errors.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 26)
      assert.strictEqual(report.annotatedRunnable, 21)
      assert.strictEqual(report.notPortedRunnable, 5)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-2] upstream/actorLogic.test.ts rewrites test/actorLogic.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/actorLogic.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/actorLogic.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 49)
      assert.strictEqual(report.annotatedRunnable, 49)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-2] upstream/invoke.test.ts rewrites test/invoke.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/invoke.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/invoke.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 90)
      assert.strictEqual(report.annotatedRunnable, 89)
      assert.strictEqual(report.notPortedRunnable, 1)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-2] upstream/interpreter.test.ts rewrites test/interpreter.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/interpreter.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/interpreter.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 58)
      assert.strictEqual(report.annotatedRunnable, 57)
      assert.strictEqual(report.notPortedRunnable, 1)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-2] upstream/actions.test.ts rewrites test/actions.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/actions.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/actions.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 134)
      assert.strictEqual(report.annotatedRunnable, 134)
      assert.strictEqual(report.notPortedRunnable, 0)
      assert.notStrictEqual(row["Status"], "not started")
    }))

  it.effect("[PARITY-2] upstream/actor.test.ts rewrites test/actor.test.ts with no parity gap", () =>
    Effect.sync(() => {
      const { report, row } = rewriteParity("test/actor.test.ts")
      assert.strictEqual(report.rewritePath, "test/upstream/actor.test.ts")
      assert.deepStrictEqual(report.gaps.map(formatGap), [])
      assert.strictEqual(report.runnable, 41)
      assert.strictEqual(report.annotatedRunnable, 40)
      assert.strictEqual(report.notPortedRunnable, 1)
      assert.notStrictEqual(row["Status"], "not started")
    }))
})
