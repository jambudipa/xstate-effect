/**
 * HARNESS-1: the frozen manifest of xstate@5.33.2 (T1.2) and the parity checker with the
 * CONF import and count checks (T1.3).
 *
 * The committed manifest `test/upstream/upstream-manifest.json` is checked against the
 * counts of the upstream inventory (research upstream-tests.md §1 and §3a, and
 * upstream-exports-and-src.md §1). The freeze script's own behaviour (version and HEAD
 * refusal, idempotence, write-once baseline, generator expansion) is checked on a small
 * synthetic clone in a temporary folder, so no test reads the gitignored clone.
 *
 * The parity tests (every name holds "parity") freeze the upstream-style fixture
 * `fixtures/parity/upstream.test.ts.txt` in such a clone and check the fixture rewrites of
 * `fixtures/parity/` against it (SD-2). The fixtures are `.ts.txt` data files, so neither
 * the type-check nor the linter reads them. The CONF tests check `conformance.ts` on the
 * fixtures of `fixtures/conformance/`, on task trees and on a CONF-shaped suite in this file.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { RunnerTestCase, RunnerTestSuite } from "vitest"
import {
  freeze,
  parseAnnotation,
  serializeManifest,
  UPSTREAM_COMMIT,
  UPSTREAM_VERSION,
  type UpstreamFile,
  type UpstreamManifest,
  type UpstreamTest
} from "../../scripts/upstream/freeze-upstream.js"
import {
  checkCounts,
  checkImportedElsewhere,
  checkImportedOnce,
  checkImports,
  confEvidenceSources,
  conformanceSuite,
  countUpstreamBlocks,
  graduationProblems,
  importsOf,
  requiredPassed,
  type TaskNode,
  upstreamFileOptions
} from "./conformance.js"
import { LEDGER_FILE, type LedgerRow, parseLedger, TABLES } from "./ledger.js"
import {
  checkPhase,
  checkRewrite,
  isNonTestFile,
  listRewriteFiles,
  notPortedRunnable,
  type ParityGap,
  type ParityReport,
  unknownRewriteFiles
} from "./parity.js"

const pkgRoot = fileURLToPath(new URL("../../", import.meta.url))
const MANIFEST_PATH = join(pkgRoot, "test/upstream/upstream-manifest.json")
const FREEZE_SCRIPT = join(pkgRoot, "scripts/upstream/freeze-upstream.ts")

const readManifestText = Effect.sync(() => readFileSync(MANIFEST_PATH, "utf8"))
const readManifest = Effect.map(readManifestText, (text) => JSON.parse(text) as UpstreamManifest)

const fileOf = (manifest: UpstreamManifest, path: string): UpstreamFile => {
  const file = manifest.files.find((candidate) => candidate.path === path)
  assert.isDefined(file, `manifest has no entry for ${path}`)
  return file as UpstreamFile
}

const isSorted = (names: ReadonlyArray<string>): boolean =>
  names.every((name, index) => index === 0 || (names[index - 1] as string) < name)

const sum = (values: ReadonlyArray<number>): number => values.reduce((total, value) => total + value, 0)

const RUNNABLE_KINDS: ReadonlyArray<UpstreamTest["kind"]> = ["it", "it.each", "generated"]

// The two upstream test modifiers, spelled without the literal source form so that the
// HARNESS-2 "no skipped test" scan of the default run does not flag this file.
const SKIP = ["it", "skip"].join(".")
const TODO = ["it", "todo"].join(".")
const ONLY = ["it", "only"].join(".")

/**
 * Research upstream-tests.md §3a: path, `it` call sites, tests that run, skip, todo.
 */
const RESEARCH_FILES: ReadonlyArray<readonly [string, number, number, number, number]> = [
  ["test/actions.test.ts", 134, 134, 1, 1],
  ["test/activities.test.ts", 13, 13, 0, 0],
  ["test/actor.test.ts", 41, 41, 0, 0],
  ["test/actorLogic.test.ts", 49, 49, 0, 0],
  ["test/after.test.ts", 9, 9, 1, 0],
  ["test/assert.test.ts", 2, 2, 0, 0],
  ["test/assign.test.ts", 14, 14, 0, 0],
  ["test/clock.test.ts", 1, 1, 0, 0],
  ["test/deep.test.ts", 9, 9, 0, 0],
  ["test/definition.test.ts", 1, 1, 0, 0],
  ["test/deterministic.test.ts", 17, 17, 0, 0],
  ["test/emit.test.ts", 14, 14, 0, 0],
  ["test/errors.test.ts", 26, 26, 0, 0],
  ["test/event.test.ts", 2, 2, 0, 0],
  ["test/eventDescriptors.test.ts", 15, 15, 0, 0],
  ["test/final.test.ts", 33, 33, 0, 0],
  ["test/getNextSnapshot.test.ts", 3, 3, 0, 0],
  ["test/guards.test.ts", 46, 46, 0, 0],
  ["test/history.test.ts", 35, 35, 0, 0],
  ["test/id.test.ts", 4, 10, 0, 0],
  ["test/initial.test.ts", 3, 3, 0, 0],
  ["test/input.test.ts", 15, 15, 0, 0],
  ["test/inspect.test.ts", 12, 12, 0, 0],
  ["test/internalTransitions.test.ts", 12, 12, 0, 0],
  ["test/interpreter.test.ts", 58, 58, 0, 0],
  ["test/invalid.test.ts", 6, 6, 0, 0],
  ["test/invoke.test.ts", 74, 90, 0, 0],
  ["test/issue5454.test.ts", 5, 5, 0, 0],
  ["test/json.test.ts", 3, 3, 0, 0],
  ["test/logger.test.ts", 2, 2, 0, 0],
  ["test/machine.test.ts", 20, 20, 1, 0],
  ["test/mapState.test.ts", 15, 15, 0, 0],
  ["test/match.test.ts", 13, 13, 0, 0],
  ["test/meta.test.ts", 21, 21, 0, 0],
  ["test/microstep.test.ts", 11, 11, 0, 0],
  ["test/multiple.test.ts", 4, 4, 6, 0],
  ["test/order.test.ts", 1, 1, 0, 0],
  ["test/parallel.test.ts", 25, 28, 0, 0],
  ["test/predictableExec.test.ts", 17, 17, 0, 0],
  ["test/rehydration.test.ts", 18, 18, 0, 0],
  ["test/resolve.test.ts", 1, 1, 0, 0],
  ["test/route.test.ts", 13, 13, 0, 0],
  ["test/scxml.test.ts", 0, 169, 0, 0],
  ["test/select.test.ts", 6, 6, 0, 0],
  ["test/setup.types.test.ts", 156, 156, 0, 0],
  ["test/spawn.test.ts", 1, 1, 0, 0],
  ["test/spawn.types.test.ts", 2, 2, 0, 0],
  ["test/spawnChild.test.ts", 4, 4, 0, 0],
  ["test/state.test.ts", 21, 21, 0, 0],
  ["test/stateIn.test.ts", 9, 9, 0, 0],
  ["test/system.test.ts", 22, 22, 0, 0],
  ["test/tags.test.ts", 6, 6, 0, 0],
  ["test/toPromise.test.ts", 5, 5, 1, 0],
  ["test/transient.test.ts", 24, 24, 0, 0],
  ["test/transition.test.ts", 24, 24, 0, 0],
  ["test/typeHelpers.test.ts", 10, 10, 0, 0],
  ["test/types.test.ts", 231, 231, 0, 0],
  ["test/waitFor.test.ts", 16, 16, 0, 0],
  ["test/examples/6.16.test.ts", 0, 9, 0, 0],
  ["test/examples/6.17.test.ts", 2, 8, 0, 0],
  ["test/examples/6.6.test.ts", 0, 16, 0, 0],
  ["test/examples/6.8.test.ts", 1, 17, 0, 0],
  ["test/examples/6.9.test.ts", 0, 32, 0, 0],
  ["test/examples/cd.test.ts", 0, 23, 0, 0],
  ["src/graph/test/adjacency.test.ts", 2, 2, 0, 0],
  ["src/graph/test/dieHard.test.ts", 10, 29, 0, 0],
  ["src/graph/test/events.test.ts", 2, 2, 0, 0],
  ["src/graph/test/forbiddenAttributes.test.ts", 3, 3, 0, 0],
  ["src/graph/test/graph.test.ts", 20, 22, 3, 0],
  ["src/graph/test/index.test.ts", 12, 12, 0, 0],
  ["src/graph/test/paths.test.ts", 13, 13, 0, 0],
  ["src/graph/test/shortestPaths.test.ts", 4, 4, 0, 0],
  ["src/graph/test/states.test.ts", 2, 2, 0, 0],
  ["src/graph/test/testModel.test.ts", 2, 2, 0, 0]
]

/**
 * Research upstream-exports-and-src.md §1: the value names and the type count of each
 * upstream entry point.
 */
const RESEARCH_EXPORTS: Readonly<Record<string, { readonly values: ReadonlyArray<string>; readonly types: number }>> = {
  ".": {
    values: [
      "Actor", "SimulatedClock", "SpecialTargets", "StateMachine", "StateNode",
      "__unsafe_getAllOwnEventDescriptors", "and", "assertEvent", "assign", "cancel", "createActor",
      "createEmptyActor", "createMachine", "emit", "enqueueActions", "forwardTo", "fromCallback",
      "fromEventObservable", "fromObservable", "fromPromise", "fromTransition", "getInitialMicrosteps",
      "getInitialSnapshot", "getMicrosteps", "getNextSnapshot", "getNextTransitions", "getStateNodes",
      "initialTransition", "interpret", "isMachineSnapshot", "log", "mapState", "matchesState", "not",
      "or", "pathToStateValue", "raise", "sendParent", "sendTo", "setup", "spawnChild", "stateIn",
      "stop", "stopChild", "toObserver", "toPromise", "transition", "waitFor"
    ],
    types: 211
  },
  "./actions": {
    values: [
      "assign", "cancel", "emit", "enqueueActions", "forwardTo", "log", "raise", "sendParent", "sendTo",
      "spawnChild", "stop", "stopChild"
    ],
    types: 11
  },
  "./actors": {
    values: [
      "createEmptyActor", "fromCallback", "fromEventObservable", "fromObservable", "fromPromise",
      "fromTransition"
    ],
    types: 13
  },
  "./guards": { values: ["and", "evaluateGuard", "not", "or", "stateIn"], types: 4 },
  "./graph": {
    values: [
      "TestModel", "adjacencyMapToArray", "createShortestPathsGen", "createSimplePathsGen",
      "createTestModel", "getAdjacencyMap", "getPathsFromEvents", "getShortestPaths", "getSimplePaths",
      "getStateNodes", "joinPaths", "serializeSnapshot", "toDirectedGraph"
    ],
    types: 23
  },
  "./dev": { values: ["devToolsAdapter", "getGlobal", "registerService"], types: 1 }
}

// ---------------------------------------------------------------- synthetic clone

const writeTree = (root: string, files: Readonly<Record<string, string>>): void => {
  for (const [relative, content] of Object.entries(files)) {
    const target = join(root, relative)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
}

const syntheticCloneFiles = (version: string, head: string): Readonly<Record<string, string>> => ({
  ".git/HEAD": `${head}\n`,
  "packages/core/package.json": JSON.stringify({ name: "xstate", version }, null, 2),
  "packages/core/src/index.ts": [
    "export * from './actions.ts';",
    "export { createMachine } from './createMachine.ts';",
    "export type { MachineConfig } from './createMachine.ts';",
    "export class SimulatedClock {}",
    "export interface SimulatedClock { now(): number }",
    ""
  ].join("\n"),
  "packages/core/src/createMachine.ts": [
    "export interface MachineConfig { id: string }",
    "export function createMachine(config: MachineConfig) {",
    "  if (!config.id) {",
    "    throw new Error(`Machine needs an id, got ${config.id}`);",
    "  }",
    "  console.warn('creating', config.id);",
    "  // throw new Error('only a comment');",
    "  return config;",
    "}",
    ""
  ].join("\n"),
  "packages/core/src/actions.ts": "export const assign = () => 1;\nexport type AssignAction = { type: 'assign' };\n",
  "packages/core/src/actors/index.ts": "export const fromPromise = () => 1;\n",
  "packages/core/src/guards.ts": "export const and = () => true;\nexport type Guard = () => boolean;\n",
  "packages/core/src/graph/index.ts": "export const getShortestPaths = () => [];\n",
  "packages/core/src/dev/index.ts":
    "export const getGlobal = () => globalThis;\nexport interface XStateDevInterface { register(): void }\n",
  "packages/core/test/utils.ts": [
    "export function testAll(machine: string, expected: Record<string, Record<string, string | undefined>>): void {",
    "  Object.keys(expected).forEach((fromState) => {",
    "    Object.keys(expected[fromState]).forEach((eventTypes) => {",
    "      const toState = expected[fromState][eventTypes];",
    "      it(`should go from ${fromState} to ${JSON.stringify(",
    "        toState",
    "      )} on ${eventTypes}`, () => {",
    "        expect(machine).toBeDefined();",
    "      });",
    "    });",
    "  });",
    "}",
    ""
  ].join("\n"),
  "packages/core/test/alpha.test.ts": [
    "import { createMachine } from '../src/index.ts';",
    "",
    "describe('alpha', () => {",
    "  it('counts code assertions only', () => {",
    "    // expect(commented).toBe(1)",
    "    const text = 'expect(inString)';",
    "    expect(text).toBe('expect(inString)');",
    "    expect(createMachine({ id: 'a' })).toBeDefined();",
    "    // @ts-expect-error a real directive",
    "    createMachine({});",
    "  });",
    "  it('is duplicated', () => {",
    "    expect(1).toBe(1);",
    "  });",
    "  it('is duplicated', () => {",
    "    expect(2).toBe(2);",
    "  });",
    "  it('has an inline snapshot', () => {",
    "    expect({ a: 1 }).toMatchInlineSnapshot(`",
    "      {",
    "        \"a\": 1,",
    "      }",
    "    `);",
    "  });",
    "  const notADirective = '// @ts-expect-error inside a string';",
    `  ${SKIP}('is skipped upstream', () => {});`,
    `  ${TODO}('is a todo upstream');`,
    "});",
    "",
    "const groups: Record<string, string[]> = { g1: ['a', 'b'], g2: [] };",
    "describe('aliased', () => {",
    "  const onlyTests: string[] = [];",
    "  Object.keys(groups).forEach((group) => {",
    "    const names = groups[group];",
    "    names.forEach((name) => {",
    `      const execTest = onlyTests.length ? ${ONLY} : it;`,
    "      execTest(`${group}/${name}`, () => {});",
    "    });",
    "  });",
    "});",
    ""
  ].join("\n"),
  "packages/core/test/examples/beta.test.ts": [
    "import { testAll } from '../utils.ts';",
    "",
    "describe('beta', () => {",
    "  const expected = { a: { x: 'b', y: undefined }, b: { 1: 'a' } };",
    "  testAll('machine', expected);",
    "  const kinds = ['one', 'two'];",
    "  kinds.forEach((kind) => {",
    "    describe(`kind ${kind}`, () => {",
    "      it('runs per kind', () => {",
    "        expect(kind).toBeTruthy();",
    "      });",
    "    });",
    "  });",
    "});",
    ""
  ].join("\n"),
  "packages/core/src/graph/test/gamma.test.ts": [
    "describe('gamma', () => {",
    "  it('snap', () => {",
    "    expect({ a: 1 }).toMatchSnapshot();",
    "  });",
    "  describe('paths', () => {",
    "    const paths = getPaths();",
    "    it('should generate the right number of paths', () => {",
    "      expect(paths.length).toEqual(3);",
    "    });",
    "    paths.forEach((path) => {",
    "      it(`path ${describePath(path)}`, () => {",
    "        expect(path).toBeDefined();",
    "      });",
    "    });",
    "  });",
    "});",
    "",
    "it.each([1, 2])('top-level each %s', (n) => {",
    "  expect(n).toBeGreaterThan(0);",
    "});",
    ""
  ].join("\n"),
  "packages/core/src/graph/test/__snapshots__/gamma.test.ts.snap": [
    "// Vitest Snapshot v1, https://vitest.dev/guide/snapshot.html",
    "",
    "exports[`gamma > snap 1`] = `",
    "{",
    "  \"a\": 1,",
    "}",
    "`;",
    ""
  ].join("\n")
})

const syntheticPortFiles = (extraExport: boolean): Readonly<Record<string, string>> => ({
  "package.json": JSON.stringify({ name: "port-fixture", type: "module" }),
  "src/index.ts": [
    "export const a = 1",
    "export type B = string",
    "export * as Ns from './ns.js'",
    extraExport ? "export const added = 2" : "",
    ""
  ].join("\n"),
  "src/ns.ts": "export const inner = 1\nexport type InnerT = number\n"
})

interface Fixture {
  readonly root: string
  readonly clone: string
  readonly port: string
}

const makeFixture = (version: string, head: string) =>
  Effect.acquireRelease(
    Effect.sync((): Fixture => {
      const root = mkdtempSync(join(tmpdir(), "harness-1-"))
      const clone = join(root, "clone")
      const port = join(root, "port")
      writeTree(clone, syntheticCloneFiles(version, head))
      writeTree(port, syntheticPortFiles(false))
      return { root, clone, port }
    }),
    (fixture) => Effect.sync(() => rmSync(fixture.root, { recursive: true, force: true }))
  )

const freezeInto = (fixture: Fixture, outFile: string, portCommit: string) =>
  Effect.sync(() =>
    freeze({ cloneDir: fixture.clone, outFile, portDir: fixture.port, portCommit: () => portCommit })
  )

const runFreezeCli = (fixture: Fixture, outFile: string) =>
  Effect.sync(() =>
    spawnSync(
      process.execPath,
      ["--experimental-strip-types", FREEZE_SCRIPT, "--clone", fixture.clone, "--out", outFile],
      { encoding: "utf8" }
    )
  )

const PORT_COMMIT_A = "a".repeat(40)
const PORT_COMMIT_B = "b".repeat(40)

const syntheticTest = (manifest: UpstreamManifest, path: string, title: string): UpstreamTest => {
  const found = fileOf(manifest, path).tests.find((test) => test.title === title)
  assert.isDefined(found, `${path} has no test titled ${title}`)
  return found as UpstreamTest
}

// ---------------------------------------------------------------- tests

describe("HARNESS-1 frozen upstream manifest", () => {
  it.effect("[HARNESS-1] the manifest lists 74 files with 1427 call sites, 1744 runnable, 13 skipped and 1 todo tests", () =>
    Effect.gen(function* () {
      const manifest = yield* readManifest
      assert.deepStrictEqual(manifest.upstream, {
        commit: UPSTREAM_COMMIT,
        package: "xstate",
        tag: `xstate@${UPSTREAM_VERSION}`,
        version: "5.33.2"
      })
      assert.strictEqual(manifest.totals.files, 74)
      assert.strictEqual(manifest.totals.callSites, 1427)
      assert.strictEqual(manifest.totals.runnable, 1744)
      assert.strictEqual(manifest.totals.skip, 13)
      assert.strictEqual(manifest.totals.todo, 1)

      assert.strictEqual(manifest.files.length, 74)
      assert.strictEqual(manifest.files.filter((file) => /^test\/[^/]+\.test\.ts$/.test(file.path)).length, 58)
      assert.strictEqual(manifest.files.filter((file) => file.path.startsWith("test/examples/")).length, 6)
      assert.strictEqual(manifest.files.filter((file) => file.path.startsWith("src/graph/test/")).length, 10)
      assert.isTrue(isSorted(manifest.files.map((file) => file.path)))

      for (const [path, callSites, runnable, skip, todo] of RESEARCH_FILES) {
        const file = fileOf(manifest, path)
        assert.deepStrictEqual(
          [file.callSites, file.runnable, file.skip, file.todo],
          [callSites, runnable, skip, todo],
          `${path}: [callSites, runnable, skip, todo]`
        )
        const ofKind = (kinds: ReadonlyArray<UpstreamTest["kind"]>) =>
          sum(file.tests.filter((test) => kinds.includes(test.kind)).map((test) => test.expandedCount))
        assert.strictEqual(file.tests.filter((test) => test.kind === "it").length, file.callSites, path)
        assert.strictEqual(ofKind(RUNNABLE_KINDS), file.runnable, path)
        assert.strictEqual(ofKind(["skip"]), file.skip, path)
        assert.strictEqual(ofKind(["todo"]), file.todo, path)
      }
      assert.strictEqual(sum(manifest.files.map((file) => file.callSites)), 1427)
      assert.strictEqual(sum(manifest.files.map((file) => file.runnable)), 1744)
    }))

  it.effect("[HARNESS-1] the manifest records describe path, title, kind, counts and inline snapshots per call site", () =>
    Effect.gen(function* () {
      const manifest = yield* readManifest
      const kinds = new Set(["it", "it.each", "generated", "skip", "todo"])
      for (const file of manifest.files) {
        assert.isTrue(Number.isInteger(file.tsExpectErrorCount) && file.tsExpectErrorCount >= 0, file.path)
        assert.isTrue(file.lines > 0, file.path)
        for (const test of file.tests) {
          const where = `${file.path}:${test.line}`
          assert.isTrue(kinds.has(test.kind), where)
          assert.isTrue(test.describePath.every((segment) => typeof segment === "string"), where)
          assert.isTrue(test.title.length > 0, where)
          assert.isTrue(Number.isInteger(test.expandedCount) && test.expandedCount >= 1, where)
          assert.isTrue(Number.isInteger(test.assertionCount) && test.assertionCount >= 0, where)
          assert.isTrue(test.line >= 1, where)
          assert.isTrue(Array.isArray(test.inlineSnapshots), where)
          assert.strictEqual(
            test.annotation,
            [file.path, ...test.describePath, test.title].join(" > ") +
              (test.occurrence === null ? "" : ` #${test.occurrence}`),
            where
          )
        }
      }

      const actions = fileOf(manifest, "test/actions.test.ts")
      assert.strictEqual(actions.tsExpectErrorCount, 8)
      assert.strictEqual(sum(actions.tests.map((test) => test.inlineSnapshots.length)), 13)
      assert.isTrue(
        actions.tests.every((test) => test.inlineSnapshots.every((snapshot) => snapshot.text !== null && snapshot.text.trim() !== ""))
      )
      assert.isTrue(actions.tests.some((test) => test.inlineSnapshots.some((snapshot) => snapshot.matcher === "toMatchInlineSnapshot")))
      const todo = actions.tests.filter((test) => test.kind === "todo")
      assert.strictEqual(todo.length, 1)
      assert.strictEqual(manifest.totals.assertions, sum(manifest.files.flatMap((file) => file.tests.map((test) => test.assertionCount))))
      assert.strictEqual(manifest.totals.tsExpectError, sum(manifest.files.map((file) => file.tsExpectErrorCount)))
    }))

  it.effect("[HARNESS-1] the manifest records generator expansions with their counts", () =>
    Effect.gen(function* () {
      const manifest = yield* readManifest
      const generatedCount = (path: string): number => {
        const generated = fileOf(manifest, path).tests.filter((test) => test.kind === "generated")
        assert.strictEqual(generated.length, 1, `${path} has one generator call`)
        return (generated[0] as UpstreamTest).expandedCount
      }
      assert.strictEqual(generatedCount("test/examples/6.16.test.ts"), 9)
      assert.strictEqual(generatedCount("test/examples/6.6.test.ts"), 16)
      assert.strictEqual(generatedCount("test/examples/6.8.test.ts"), 16)
      assert.strictEqual(generatedCount("test/examples/6.9.test.ts"), 32)
      assert.strictEqual(generatedCount("test/examples/cd.test.ts"), 23)
      assert.strictEqual(generatedCount("test/id.test.ts"), 6)
      assert.strictEqual(generatedCount("test/scxml.test.ts"), 169)

      const looped = (path: string) =>
        fileOf(manifest, path).tests.filter((test) => test.kind === "it" && test.expansion !== null)
      const invokeLoop = looped("test/invoke.test.ts")
      assert.strictEqual(invokeLoop.length, 13)
      assert.isTrue(invokeLoop.every((test) => test.expandedCount === 2))
      assert.isTrue(invokeLoop.every((test) => test.expansion?.via.join(" ").includes("promiseTypes.forEach") === true))
      assert.deepStrictEqual(looped("src/graph/test/dieHard.test.ts").map((test) => test.expandedCount), [2, 14, 6])
      assert.deepStrictEqual(looped("test/examples/6.17.test.ts").map((test) => test.expandedCount), [6, 2])
      assert.deepStrictEqual(looped("test/parallel.test.ts").map((test) => test.expandedCount), [4])

      const each = (path: string) =>
        fileOf(manifest, path).tests.filter((test) => test.kind === "it.each").map((test) => test.expandedCount)
      assert.deepStrictEqual(each("test/invoke.test.ts"), [3])
      assert.deepStrictEqual(each("src/graph/test/graph.test.ts"), [2])

      const groups = manifest.scxmlGroups
      assert.strictEqual(Object.keys(groups).length, 24)
      assert.strictEqual(sum(Object.values(groups).map((names) => names.length)), 169)
      assert.strictEqual(Object.values(groups).filter((names) => names.length === 0).length, 5)
      const scxml = fileOf(manifest, "test/scxml.test.ts").tests[0] as UpstreamTest
      assert.deepStrictEqual(
        scxml.expansion?.tests?.map((test) => test.title),
        Object.entries(groups).flatMap(([group, names]) => names.map((name) => `${group}/${name}`))
      )
    }))

  it.effect("[HARNESS-1] the manifest holds the six upstream export lists and the port baseline", () =>
    Effect.gen(function* () {
      const manifest = yield* readManifest
      assert.deepStrictEqual(Object.keys(manifest.exports), [".", "./actions", "./actors", "./dev", "./graph", "./guards"])
      for (const [entryPoint, expected] of Object.entries(RESEARCH_EXPORTS)) {
        const actual = manifest.exports[entryPoint]
        assert.isDefined(actual, entryPoint)
        assert.deepStrictEqual(actual?.values, expected.values, `${entryPoint} values`)
        assert.strictEqual(actual?.types.length, expected.types, `${entryPoint} types`)
        assert.isTrue(isSorted(actual?.values ?? []) && isSorted(actual?.types ?? []), `${entryPoint} sorted`)
      }

      const baseline = manifest.portBaseline
      assert.match(baseline.commit, /^[0-9a-f]{40}$/)
      assert.strictEqual(baseline.package, "@xstate-effect/core")
      const root = baseline.exports["."]
      assert.isDefined(root)
      assert.isTrue(isSorted(root?.values ?? []) && isSorted(root?.types ?? []))
      for (const name of ["createActor", "createMachine", "setup", "Snapshot", "StateValue", "makeSimulatedClock"]) {
        assert.include(root?.values ?? [], name)
      }
      assert.include(root?.namespaces["Snapshot"]?.values ?? [], "updateContext")
    }))

  it.effect("[HARNESS-1] the manifest stores the upstream graph snapshot entries", () =>
    Effect.gen(function* () {
      const manifest = yield* readManifest
      const entries = manifest.graphSnapshots["src/graph/test/__snapshots__/graph.test.ts.snap"]
      assert.isDefined(entries)
      const keys = Object.keys(entries ?? {})
      assert.strictEqual(keys.length, 10)
      assert.isTrue(isSorted(keys))
      assert.isTrue(Object.values(entries ?? {}).every((value) => value.trim().length > 0))
    }))

  it.effect("[HARNESS-1] the manifest lists every upstream throw and console warning site in src", () =>
    Effect.gen(function* () {
      const manifest = yield* readManifest
      const ofKind = (kind: string) => manifest.sourceSites.filter((site) => site.kind === kind)
      assert.strictEqual(ofKind("throw").length, 54)
      assert.strictEqual(ofKind("console.warn").length + ofKind("console.error").length, 14)
      assert.strictEqual(ofKind("rethrow").length, 5)
      for (const site of manifest.sourceSites) {
        assert.match(site.file, /^src\//)
        assert.notMatch(site.file, /\/test\//)
        assert.isTrue(site.line >= 1 && site.text.length > 0, `${site.file}:${site.line}`)
      }
      assert.isTrue(
        manifest.sourceSites.some((site) => site.kind === "console.error" && site.file === "src/waitFor.ts")
      )
    }))

  it.effect("[HARNESS-1] duplicate upstream tests get an occurrence index in the manifest", () =>
    Effect.gen(function* () {
      const manifest = yield* readManifest
      const duplicates = manifest.files.flatMap((file) => file.tests.filter((test) => test.occurrence !== null))
      assert.strictEqual(duplicates.length, 12)
      const groups = new Map<string, Array<number>>()
      for (const test of duplicates) {
        const parsed = parseAnnotation(`// upstream: ${test.annotation}`)
        assert.isNotNull(parsed)
        assert.strictEqual(parsed?.occurrence, test.occurrence)
        const key = parsed?.key ?? ""
        groups.set(key, [...(groups.get(key) ?? []), test.occurrence ?? 0])
      }
      assert.strictEqual(groups.size, 6)
      assert.isTrue([...groups.values()].every((occurrences) => occurrences.join(",") === "1,2"))
      assert.isTrue(
        manifest.files.every((file) => file.tests.every((test) => !/ #\d+$/.test(test.title))),
        "no upstream title ends with an occurrence suffix"
      )
      assert.deepStrictEqual(parseAnnotation("// upstream: test/a.test.ts > a > b"), {
        key: "test/a.test.ts > a > b",
        occurrence: null
      })
      assert.deepStrictEqual(parseAnnotation("  // upstream: test/a.test.ts > a > b #2"), {
        key: "test/a.test.ts > a > b",
        occurrence: 2
      })
      assert.isNull(parseAnnotation("// not an annotation"))
    }))

  it.effect("[HARNESS-1] the committed manifest is in the canonical byte form of the freeze script", () =>
    Effect.gen(function* () {
      const text = yield* readManifestText
      assert.strictEqual(serializeManifest(JSON.parse(text) as UpstreamManifest), text)
    }))

  it.effect("[HARNESS-1] the freeze script refuses a clone whose version is not 5.33.2 and writes no manifest", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture("5.33.1", UPSTREAM_COMMIT)
      const outFile = join(fixture.root, "manifest.json")
      const result = yield* runFreezeCli(fixture, outFile)
      assert.notStrictEqual(result.status, 0)
      assert.include(result.stderr, "5.33.1")
      assert.isFalse(existsSync(outFile))
    }))

  it.effect("[HARNESS-1] the freeze script refuses a clone whose HEAD is not the tag commit of the manifest", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture(UPSTREAM_VERSION, "c".repeat(40))
      const outFile = join(fixture.root, "manifest.json")
      const result = yield* runFreezeCli(fixture, outFile)
      assert.notStrictEqual(result.status, 0)
      assert.include(result.stderr, "c".repeat(40))
      assert.isFalse(existsSync(outFile))
    }))

  it.effect("[HARNESS-1] two freeze runs produce a byte-identical manifest with sorted keys and names", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture(UPSTREAM_VERSION, UPSTREAM_COMMIT)
      const first = join(fixture.root, "first.json")
      const second = join(fixture.root, "second.json")
      yield* freezeInto(fixture, first, PORT_COMMIT_A)
      yield* freezeInto(fixture, second, PORT_COMMIT_A)
      const text = readFileSync(first, "utf8")
      assert.strictEqual(readFileSync(second, "utf8"), text)
      assert.strictEqual(serializeManifest(JSON.parse(text) as UpstreamManifest), text)

      const manifest = JSON.parse(text) as UpstreamManifest
      assert.deepStrictEqual(manifest.exports["."], {
        entry: "src/index.ts",
        types: ["AssignAction", "MachineConfig"],
        values: ["SimulatedClock", "assign", "createMachine"]
      })
      assert.deepStrictEqual(manifest.portBaseline, {
        commit: PORT_COMMIT_A,
        exports: {
          ".": {
            entry: "src/index.ts",
            namespaces: { Ns: { types: ["InnerT"], values: ["inner"] } },
            types: ["B"],
            values: ["Ns", "a"]
          }
        },
        package: "port-fixture"
      })
    }))

  it.effect("[HARNESS-1] a manifest rerun keeps the port baseline section byte-identical", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture(UPSTREAM_VERSION, UPSTREAM_COMMIT)
      const outFile = join(fixture.root, "manifest.json")
      yield* freezeInto(fixture, outFile, PORT_COMMIT_A)
      const before = readFileSync(outFile, "utf8")

      writeTree(fixture.port, syntheticPortFiles(true))
      yield* freezeInto(fixture, outFile, PORT_COMMIT_B)
      const after = readFileSync(outFile, "utf8")
      assert.strictEqual(after, before)
      const baseline = (JSON.parse(after) as UpstreamManifest).portBaseline
      assert.strictEqual(baseline.commit, PORT_COMMIT_A)
      assert.notInclude(baseline.exports["."]?.values ?? [], "added")
    }))

  it.effect("[HARNESS-1] the manifest counts code assertions, directives, duplicates and generators of a clone", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture(UPSTREAM_VERSION, UPSTREAM_COMMIT)
      const outFile = join(fixture.root, "manifest.json")
      yield* freezeInto(fixture, outFile, PORT_COMMIT_A)
      const manifest = JSON.parse(readFileSync(outFile, "utf8")) as UpstreamManifest

      const alpha = fileOf(manifest, "test/alpha.test.ts")
      assert.strictEqual(alpha.tsExpectErrorCount, 1)
      assert.deepStrictEqual([alpha.callSites, alpha.runnable, alpha.skip, alpha.todo], [4, 6, 1, 1])
      assert.strictEqual(syntheticTest(manifest, "test/alpha.test.ts", "counts code assertions only").assertionCount, 2)
      const duplicated = alpha.tests.filter((test) => test.title === "is duplicated")
      assert.deepStrictEqual(duplicated.map((test) => test.occurrence), [1, 2])
      assert.deepStrictEqual(duplicated.map((test) => test.annotation), [
        "test/alpha.test.ts > alpha > is duplicated #1",
        "test/alpha.test.ts > alpha > is duplicated #2"
      ])
      assert.deepStrictEqual(syntheticTest(manifest, "test/alpha.test.ts", "has an inline snapshot").inlineSnapshots, [
        { matcher: "toMatchInlineSnapshot", text: "\n      {\n        \"a\": 1,\n      }\n    " }
      ])
      const aliased = syntheticTest(manifest, "test/alpha.test.ts", "${group}/${name}")
      assert.strictEqual(aliased.kind, "generated")
      assert.strictEqual(aliased.generator, "execTest")
      assert.deepStrictEqual(aliased.expansion?.tests?.map((test) => test.title), ["g1/a", "g1/b"])

      const beta = fileOf(manifest, "test/examples/beta.test.ts")
      assert.deepStrictEqual([beta.callSites, beta.runnable], [1, 5])
      const generated = syntheticTest(
        manifest,
        "test/examples/beta.test.ts",
        "should go from ${fromState} to ${JSON.stringify(toState)} on ${eventTypes}"
      )
      assert.strictEqual(generated.kind, "generated")
      assert.strictEqual(generated.generator, "testAll")
      assert.strictEqual(generated.assertionCount, 1)
      assert.deepStrictEqual(generated.expansion?.tests?.map((test) => test.title), [
        "should go from a to \"b\" on x",
        "should go from a to undefined on y",
        "should go from b to \"a\" on 1"
      ])
      const perKind = syntheticTest(manifest, "test/examples/beta.test.ts", "runs per kind")
      assert.deepStrictEqual(perKind.describePath, ["beta", "kind ${kind}"])
      assert.deepStrictEqual(perKind.expansion?.tests, [
        { describePath: ["beta", "kind one"], title: "runs per kind" },
        { describePath: ["beta", "kind two"], title: "runs per kind" }
      ])

      const gamma = fileOf(manifest, "src/graph/test/gamma.test.ts")
      assert.deepStrictEqual([gamma.callSites, gamma.runnable], [3, 7])
      const pathLoop = syntheticTest(manifest, "src/graph/test/gamma.test.ts", "path ${describePath(path)}")
      assert.strictEqual(pathLoop.expandedCount, 3)
      assert.isNull(pathLoop.expansion?.tests ?? null)
      const each = syntheticTest(manifest, "src/graph/test/gamma.test.ts", "top-level each %s")
      assert.deepStrictEqual([each.kind, each.expandedCount], ["it.each", 2])
      assert.deepStrictEqual(each.expansion?.tests?.map((test) => test.title), ["top-level each 1", "top-level each 2"])
      assert.deepStrictEqual(manifest.graphSnapshots, {
        "src/graph/test/__snapshots__/gamma.test.ts.snap": { "gamma > snap 1": "\n{\n  \"a\": 1,\n}\n" }
      })

      assert.deepStrictEqual(
        manifest.sourceSites.map((site) => [site.file, site.line, site.kind, site.text]),
        [
          ["src/createMachine.ts", 4, "throw", "Machine needs an id, got ${config.id}"],
          ["src/createMachine.ts", 6, "console.warn", "'creating', config.id"]
        ]
      )
      assert.deepStrictEqual(manifest.totals, {
        assertions: 11,
        callSites: 8,
        files: 3,
        inlineSnapshots: 1,
        runnable: 18,
        skip: 1,
        todo: 1,
        tsExpectError: 1
      })
    }))
})

// ---------------------------------------------------------------- parity fixtures (T1.3)

const FIXTURES = join(pkgRoot, "test/verify/fixtures")
const readFixture = (relative: string): string => readFileSync(join(FIXTURES, relative), "utf8")

const PARITY_PATH = "test/parity.test.ts"
const PARITY_REWRITE = "test/upstream/parity.test.ts"
const GENERATED_TITLE = "should go from ${fromState} to ${JSON.stringify(toState)} on ${eventTypes}"
const UTILS = readFixture("parity/utils.ts.txt")
const COMPLETE = readFixture("parity/complete.test.ts.txt")

/** The annotation text of a parity fixture test: `test/parity.test.ts > parity > ...`. */
const annotationOf = (...segments: ReadonlyArray<string>): string => [PARITY_PATH, "parity", ...segments].join(" > ")

let frozenParity: UpstreamFile | undefined

/**
 * The inventory entry of `fixtures/parity/upstream.test.ts.txt`, made by the real freeze
 * script on a synthetic clone (once per run).
 */
const parityUpstream = Effect.suspend(() =>
  frozenParity !== undefined
    ? Effect.succeed(frozenParity)
    : Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture(UPSTREAM_VERSION, UPSTREAM_COMMIT)
        writeTree(fixture.clone, { "packages/core/test/parity.test.ts": readFixture("parity/upstream.test.ts.txt") })
        const outFile = join(fixture.root, "frozen.json")
        yield* freezeInto(fixture, outFile, PORT_COMMIT_A)
        const frozen = fileOf(JSON.parse(readFileSync(outFile, "utf8")) as UpstreamManifest, PARITY_PATH)
        frozenParity = frozen
        return frozen
      })
    )
)

const notPortedRow = (describePath: string, title: string, kind: string, file = PARITY_PATH): LedgerRow => ({
  File: file,
  "Describe path": describePath,
  Title: title,
  "Gap kind": kind,
  Reason: "fixture row (SD-2)"
})

const SKIP_ROW = notPortedRow("parity", "is skipped upstream", "missing")

/** Module reader for the fixture rewrites: only the helper module `test/upstream/utils.ts` exists. */
const helperModules = (utils: string | null) => (path: string): string | null =>
  path === "test/upstream/utils.ts" ? utils : null

const checkParityFixture = (
  upstream: UpstreamFile,
  source: string | null,
  notPorted: ReadonlyArray<LedgerRow> = [SKIP_ROW],
  utils: string | null = UTILS
): ParityReport => checkRewrite({ upstream, rewritePath: PARITY_REWRITE, source, notPorted, readModule: helperModules(utils) })

const gapsOf = (report: ParityReport): ReadonlyArray<readonly [ParityGap["kind"], string, string]> =>
  report.gaps.map((gap) => [gap.kind, gap.title, gap.annotation] as const)

const realLedger = Effect.sync(() => {
  const parsed = parseLedger(readFileSync(join(pkgRoot, LEDGER_FILE), "utf8"))
  assert.deepStrictEqual(parsed.problems, [])
  return parsed.ledger
})

/** A ledger with the exact headers of `TABLES` and the given file and not-ported rows. */
const ledgerText = (
  files: ReadonlyArray<ReadonlyArray<string>>,
  notPorted: ReadonlyArray<ReadonlyArray<string>>
): string =>
  (Object.keys(TABLES) as Array<keyof typeof TABLES>).map((name) => {
    const { columns, section } = TABLES[name]
    const rows = name === "files" ? files : name === "notPorted" ? notPorted : []
    return [
      `## ${section}`,
      "",
      `| ${columns.join(" | ")} |`,
      `| ${columns.map(() => "---").join(" | ")} |`,
      ...rows.map((row) => `| ${row.join(" | ")} |`),
      ""
    ].join("\n")
  }).join("\n")

const makeTempDir = (prefix: string) =>
  Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), prefix))),
    (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true }))
  )

// ---------------------------------------------------------------- task trees (CONF count check)

const testTask = (name: string, state: "pass" | "fail" | "skip" | null, mode = "run"): TaskNode =>
  state === null ? { type: "test", name, mode } : { type: "test", name, mode, result: { state } }

const passing = (count: number, prefix = "passes"): ReadonlyArray<TaskNode> =>
  Array.from({ length: count }, (_, index) => testTask(`${prefix} ${index + 1}`, "pass"))

const suiteTask = (name: string, tasks: ReadonlyArray<TaskNode>): TaskNode => ({ type: "suite", name, mode: "run", tasks })

/** A CONF-2 evidence file task tree: the blocks, then the count test that is running now. */
const confFile = (blocks: ReadonlyArray<TaskNode>): TaskNode =>
  suiteTask("verify-xstate-5-33-2-port-CONF-2.spec.ts", [
    suiteTask("[CONF-2] upstream files green at phase 2", [
      ...blocks,
      testTask("[CONF-2] every imported file meets its count", null)
    ])
  ])

/** The ordering facts of the CONF-shaped suite below, as a list of problems. */
const orderProblems = (task: Readonly<RunnerTestCase>): ReadonlyArray<string> => {
  const suite: RunnerTestSuite | undefined = task.suite
  if (suite === undefined) return ["the count test has no suite"]
  const problems: Array<string> = []
  if (suite.shuffle !== false) problems.push("the CONF suite shuffles its own children")
  if (suite.tasks.at(-1) !== task) problems.push("the count test is not the last task of the CONF suite")
  for (const child of suite.tasks) {
    if (child.type === "suite" && (child.shuffle === true) !== (task.file.shuffle === true)) {
      problems.push(`${child.name} does not follow the run's shuffle setting`)
    }
  }
  const counted = countUpstreamBlocks(suite).map((block) => [block.title, block.passed, block.notRun].join(" "))
  if (counted.join(", ") !== "upstream/alpha.test.ts 3 0, upstream/beta.test.ts 2 0") {
    problems.push(`blocks when the count test ran: ${counted.join(", ")}`)
  }
  return problems
}

// ---------------------------------------------------------------- parity tests

describe("HARNESS-1 parity checker and CONF checks", () => {
  it.effect("[HARNESS-1] parity: each upstream @ts-expect-error line belongs to one test, so per-test counts sum to the file count", () =>
    Effect.gen(function* () {
      const manifest = yield* readManifest
      for (const file of manifest.files) {
        assert.strictEqual(sum(file.tests.map((test) => test.tsExpectErrorCount)), file.tsExpectErrorCount, file.path)
      }
      const types = fileOf(manifest, "test/types.test.ts")
      assert.strictEqual(types.tsExpectErrorCount, 146)
      assert.isAbove(types.tests.filter((test) => test.tsExpectErrorCount > 0).length, 1)
      assert.isTrue(manifest.files.every((file) => file.tests.every((test) => Number.isInteger(test.tsExpectErrorCount))))
    }))

  it.effect("[HARNESS-1] parity: a complete fixture rewrite has no gap and its generator annotation counts its expanded tests", () =>
    Effect.gen(function* () {
      const upstream = yield* parityUpstream
      assert.deepStrictEqual(
        upstream.tests.map((test) => [
          test.kind,
          test.title,
          test.occurrence,
          test.assertionCount,
          test.inlineSnapshots.length,
          test.tsExpectErrorCount,
          test.expandedCount
        ]),
        [
          ["it", "keeps its annotation", null, 1, 0, 0, 1],
          ["it", "counts two assertions", null, 2, 0, 0, 1],
          ["it", "keeps its inline snapshot", null, 1, 1, 0, 1],
          ["it", "keeps its directive", null, 1, 0, 1, 1],
          ["it", "is duplicated", 1, 1, 0, 0, 1],
          ["it", "is duplicated", 2, 1, 0, 0, 1],
          ["generated", GENERATED_TITLE, null, 1, 0, 0, 3],
          ["skip", "is skipped upstream", null, 0, 0, 0, 1]
        ]
      )
      const report = checkParityFixture(upstream, COMPLETE)
      assert.deepStrictEqual(report.gaps, [])
      assert.deepStrictEqual(
        [report.file, report.rewritePath, report.runnable, report.annotatedRunnable, report.notPortedRunnable],
        [PARITY_PATH, PARITY_REWRITE, 9, 9, 0]
      )
    }))

  it.effect("[HARNESS-1] parity: a rewrite missing an annotation, an assertion, an inline snapshot and a @ts-expect-error yields exactly those four gaps", () =>
    Effect.gen(function* () {
      const upstream = yield* parityUpstream
      const report = checkParityFixture(upstream, readFixture("parity/gaps.test.ts.txt"))
      assert.deepStrictEqual(gapsOf(report), [
        ["missing", "keeps its annotation", annotationOf("keeps its annotation")],
        ["assertions", "counts two assertions", annotationOf("counts two assertions")],
        ["inline snapshot", "keeps its inline snapshot", annotationOf("keeps its inline snapshot")],
        ["ts-expect-error", "keeps its directive", annotationOf("keeps its directive")]
      ])
      assert.deepStrictEqual(report.gaps.map((gap) => [gap.file, gap.describePath]), [
        [PARITY_PATH, ["parity"]],
        [PARITY_PATH, ["parity"]],
        [PARITY_PATH, ["parity"]],
        [PARITY_PATH, ["parity"]]
      ])
      assert.deepStrictEqual(report.gaps.map((gap) => gap.detail), [
        "no annotated counterpart and no 'Tests not ported' row",
        "1 assertion, upstream has 2",
        "1 of 1 upstream inline snapshot not kept",
        "0 @ts-expect-error lines, upstream has 1"
      ])
      assert.strictEqual(report.annotatedRunnable, 8)
    }))

  it.effect("[HARNESS-1] parity: 'Tests not ported' rows for the four gaps leave no gap, and a row excuses only its own gap kind", () =>
    Effect.gen(function* () {
      const upstream = yield* parityUpstream
      const source = readFixture("parity/gaps.test.ts.txt")
      const rows = [
        SKIP_ROW,
        notPortedRow("parity", "keeps its annotation", "missing"),
        notPortedRow("parity", "counts two assertions", "assertions"),
        notPortedRow("parity", "keeps its inline snapshot", "inline snapshot"),
        notPortedRow("parity", "keeps its directive", "ts-expect-error")
      ]
      const report = checkParityFixture(upstream, source, rows)
      assert.deepStrictEqual(report.gaps, [])
      assert.deepStrictEqual([report.runnable, report.annotatedRunnable, report.notPortedRunnable], [9, 8, 1])

      const wrongKind = checkParityFixture(upstream, source, [
        ...rows.filter((row) => row["Title"] !== "counts two assertions"),
        notPortedRow("parity", "counts two assertions", "inline snapshot")
      ])
      assert.deepStrictEqual(gapsOf(wrongKind), [
        ["assertions", "counts two assertions", annotationOf("counts two assertions")],
        ["stale ledger row", "counts two assertions", annotationOf("counts two assertions")]
      ])
    }))

  it.effect("[HARNESS-1] parity: an unknown annotation and an annotation not directly above a test or generator call are gaps", () =>
    Effect.gen(function* () {
      const upstream = yield* parityUpstream
      const report = checkParityFixture(upstream, readFixture("parity/annotations.test.ts.txt"))
      assert.deepStrictEqual(gapsOf(report), [
        ["dangling annotation", "above a declaration", annotationOf("generated", "above a declaration")],
        ["unknown annotation", "was never upstream", annotationOf("was never upstream")],
        ["dangling annotation", "above a describe", annotationOf("above a describe")],
        ["dangling annotation", "after a blank line", annotationOf("extra", "after a blank line")]
      ])
      assert.isTrue(report.gaps.every((gap) => gap.line !== null && gap.line > 0))
      assert.strictEqual(report.annotatedRunnable, 9)
    }))

  it.effect("[HARNESS-1] parity: rewriting one of two upstream tests with the same describe path and title leaves a gap", () =>
    Effect.gen(function* () {
      const upstream = yield* parityUpstream
      const onlyFirst = checkParityFixture(upstream, readFixture("parity/duplicates.test.ts.txt"))
      assert.deepStrictEqual(gapsOf(onlyFirst), [["missing", "is duplicated", annotationOf("is duplicated #2")]])

      const firstTwice = checkParityFixture(upstream, COMPLETE.replace("> is duplicated #2", "> is duplicated #1"))
      assert.deepStrictEqual(gapsOf(firstTwice), [
        ["missing", "is duplicated", annotationOf("is duplicated #2")],
        ["duplicate annotation", "is duplicated", annotationOf("is duplicated #1")]
      ])

      const noIndex = checkParityFixture(upstream, COMPLETE.replace("> is duplicated #1", "> is duplicated"))
      assert.deepStrictEqual(gapsOf(noIndex), [
        ["missing", "is duplicated", annotationOf("is duplicated #1")],
        ["unknown annotation", "is duplicated", annotationOf("is duplicated")]
      ])
    }))

  it.effect("[HARNESS-1] parity: assertions and @ts-expect-error lines found only in comments or strings do not count", () =>
    Effect.gen(function* () {
      const upstream = yield* parityUpstream
      const report = checkParityFixture(upstream, readFixture("parity/comments-and-strings.test.ts.txt"))
      assert.deepStrictEqual(gapsOf(report), [
        ["assertions", "counts two assertions", annotationOf("counts two assertions")],
        ["ts-expect-error", "keeps its directive", annotationOf("keeps its directive")]
      ])
    }))

  it.effect("[HARNESS-1] parity: a generator call counts the assertions of the imported helper it calls", () =>
    Effect.gen(function* () {
      const upstream = yield* parityUpstream
      const expected: ReturnType<typeof gapsOf> = [["assertions", GENERATED_TITLE, annotationOf("generated", GENERATED_TITLE)]]
      const weakHelper = checkParityFixture(upstream, COMPLETE, [SKIP_ROW], readFixture("parity/utils-no-assertion.ts.txt"))
      assert.deepStrictEqual(gapsOf(weakHelper), expected)
      assert.deepStrictEqual(weakHelper.gaps.map((gap) => gap.detail), ["0 assertions, upstream has 1"])
      const noHelper = checkParityFixture(upstream, COMPLETE, [SKIP_ROW], null)
      assert.deepStrictEqual(gapsOf(noHelper), expected)
    }))

  it.effect("[HARNESS-1] parity: the testAll annotation of an examples/6.16 rewrite stands for its 9 upstream tests", () =>
    Effect.gen(function* () {
      const manifest = yield* readManifest
      const upstream = fileOf(manifest, "test/examples/6.16.test.ts")
      const rewritePath = "test/upstream/examples/6.16.test.ts"
      const report = checkRewrite({
        upstream,
        rewritePath,
        source: readFixture("parity/examples-6.16.test.ts.txt"),
        notPorted: [],
        readModule: helperModules(UTILS)
      })
      assert.deepStrictEqual(report.gaps, [])
      assert.deepStrictEqual([report.runnable, report.annotatedRunnable, report.notPortedRunnable], [9, 9, 0])

      const generated = upstream.tests[0] as UpstreamTest
      const row = notPortedRow("Example 6.16", generated.title, "missing", upstream.path)
      assert.strictEqual(notPortedRunnable(upstream, [row]), 9)
      const absent = checkRewrite({ upstream, rewritePath, source: null, notPorted: [row] })
      assert.deepStrictEqual(absent.gaps, [])
      assert.deepStrictEqual([absent.annotatedRunnable, absent.notPortedRunnable], [0, 9])
    }))

  it.effect("[HARNESS-1] parity: an upstream title that ends in whitespace matches its annotation", () =>
    Effect.gen(function* () {
      const manifest = yield* readManifest
      const actions = fileOf(manifest, "test/actions.test.ts")
      const padded = actions.tests.find((test) => test.title !== test.title.trimEnd()) as UpstreamTest
      const source = [
        `import { it } from "@effect/vitest"`,
        `// upstream: ${padded.annotation.trimEnd()}`,
        `it("padded", () => {})`
      ].join("\n")
      const report = checkRewrite({
        upstream: { ...actions, tests: [padded] },
        rewritePath: "test/upstream/actions.test.ts",
        source,
        notPorted: []
      })
      assert.deepStrictEqual(
        report.gaps.filter((gap) => gap.kind === "missing" || gap.kind === "unknown annotation").map((gap) => gap.kind),
        []
      )
      assert.strictEqual(report.annotatedRunnable, 1)
    }))

  it.effect("[HARNESS-1] parity: a ledger row for a test without that gap, or for no upstream test, is a gap", () =>
    Effect.gen(function* () {
      const upstream = yield* parityUpstream
      const report = checkParityFixture(upstream, COMPLETE, [
        SKIP_ROW,
        notPortedRow("parity", "was never upstream", "missing"),
        notPortedRow("parity", "counts two assertions", "assertions"),
        notPortedRow("parity", "keeps its annotation", "missing")
      ])
      assert.deepStrictEqual(gapsOf(report), [
        ["stale ledger row", "keeps its annotation", annotationOf("keeps its annotation")],
        ["stale ledger row", "counts two assertions", annotationOf("counts two assertions")],
        ["unknown ledger row", "was never upstream", annotationOf("was never upstream")]
      ])
      assert.deepStrictEqual(report.gaps.map((gap) => gap.detail), [
        "a 'missing' row, but the test has an annotated counterpart",
        "an 'assertions' row, but the counterpart has no such gap",
        "a 'missing' row for a test the upstream file does not have"
      ])
    }))

  it.effect("[HARNESS-1] parity: a missing rewrite file makes every test without a ledger row a missing gap", () =>
    Effect.gen(function* () {
      const upstream = yield* parityUpstream
      const report = checkParityFixture(upstream, null)
      assert.deepStrictEqual(report.gaps.map((gap) => [gap.kind, gap.annotation]), [
        ["missing", annotationOf("keeps its annotation")],
        ["missing", annotationOf("counts two assertions")],
        ["missing", annotationOf("keeps its inline snapshot")],
        ["missing", annotationOf("keeps its directive")],
        ["missing", annotationOf("is duplicated #1")],
        ["missing", annotationOf("is duplicated #2")],
        ["missing", annotationOf("generated", GENERATED_TITLE)]
      ])
      assert.deepStrictEqual([report.runnable, report.annotatedRunnable, report.notPortedRunnable], [9, 0, 0])
    }))

  it.effect("[HARNESS-1] parity: the check of a phase reads the inventory, the ledger and the rewrites of a package folder", () =>
    Effect.gen(function* () {
      const upstream = yield* parityUpstream
      const root = yield* makeTempDir("parity-phase-")
      writeTree(root, {
        "test/upstream/upstream-manifest.json": JSON.stringify({ files: [upstream] }),
        "test/upstream/CONFORMANCE.md": ledgerText(
          [["parity", PARITY_PATH, PARITY_REWRITE, "2", "3", "rewritten"]],
          [[PARITY_PATH, "parity", "is skipped upstream", "missing", "skipped upstream"]]
        ),
        "test/upstream/parity.test.ts": COMPLETE,
        "test/upstream/utils.ts": UTILS
      })
      const phase2 = checkPhase(2, root)
      assert.deepStrictEqual(phase2.problems, [])
      assert.deepStrictEqual(phase2.reports.map((report) => [report.file, report.gaps.length, report.annotatedRunnable]), [
        [PARITY_PATH, 0, 9]
      ])
      assert.deepStrictEqual(checkPhase(3, root).reports, [])

      rmSync(join(root, "test/upstream/parity.test.ts"))
      const absent = checkPhase(2, root)
      assert.strictEqual(absent.reports[0]?.gaps.filter((gap) => gap.kind === "missing").length, 7)

      writeFileSync(join(root, "test/upstream/CONFORMANCE.md"), "## Upstream files\n\nno table\n")
      assert.include(checkPhase(2, root).problems, "section \"Upstream files\" has no table")
    }))

  it.effect("[HARNESS-1] parity: the parity check and the CONF-8 file count skip the non-test files of test/upstream", () =>
    Effect.gen(function* () {
      const manifest = yield* readManifest
      const dir = yield* makeTempDir("parity-files-")
      const files = [
        "deep.test.ts", "examples/cd.test.ts", "graph/paths.test.ts", "utils.ts", "trackEntries.ts",
        "graph/testUtils.ts", "support/scxml.ts", "support/scxml/convert.ts", "exports.test.ts", "exports.types.ts",
        "fixtures/sample.test.ts", "CONFORMANCE.md", "pending.json", "stray.test.ts", "helper.ts"
      ]
      writeTree(dir, Object.fromEntries(files.map((file) => [file, "export {}\n"])))
      const listed = listRewriteFiles(dir)
      assert.deepStrictEqual(listed, [
        "deep.test.ts", "examples/cd.test.ts", "graph/paths.test.ts", "helper.ts", "stray.test.ts"
      ])
      assert.deepStrictEqual(unknownRewriteFiles(listed, manifest.files), ["helper.ts", "stray.test.ts"])
      for (const file of [
        "utils.ts", "trackEntries.ts", "graph/testUtils.ts", "support/scxml.ts", "exports.test.ts", "exports.types.ts",
        "fixtures/sample.test.ts"
      ]) {
        assert.isTrue(isNonTestFile(file), file)
      }
      for (const file of ["deep.test.ts", "testUtils.ts", "graph/utils.ts", "examples/cd.test.ts"]) {
        assert.isFalse(isNonTestFile(file), file)
      }
    }))

  it.effect("[HARNESS-1] parity harness: the CONF import check lists the imported files and compares them with the green-phase column", () =>
    Effect.gen(function* () {
      const ledger = yield* realLedger
      const source = readFixture("conformance/CONF-2.spec.ts.txt")
      assert.deepStrictEqual(importsOf(source).map((entry) => [entry.file, entry.describe, entry.specifier]), [
        ["deep", "upstream/deep.test.ts", "../upstream/deep.test.js"],
        ["initial", "upstream/initial.test.ts", "../upstream/initial.test.js"],
        ["multiple", "upstream/multiple.test.ts", "../upstream/multiple.test.js"]
      ])
      assert.deepStrictEqual(checkImports({ source, phase: 2, files: ledger.files }), [])

      const wrong = readFixture("conformance/CONF-2-wrong.spec.ts.txt")
      assert.deepStrictEqual(checkImports({ source: wrong, phase: 2, files: ledger.files }), [
        "upstream/deep.test.ts: imported more than once",
        "upstream/initial.test.ts: its describe block is titled \"upstream/final.test.ts\"",
        "upstream/id.test.ts: green at phase 3, not 2",
        "../upstream/utils.js: not an upstream test file",
        "upstream/multiple.test.ts: green at phase 2 but not imported"
      ])
    }))

  it.effect("[HARNESS-1] parity harness: the CONF-8 check finds a file imported by two evidence files or by none", () =>
    Effect.gen(function* () {
      const ledger = yield* realLedger
      const source = readFixture("conformance/CONF-2.spec.ts.txt")
      const problems = checkImportedOnce(
        [{ file: "a.spec.ts", source }, { file: "b.spec.ts", source }],
        ledger.files
      )
      assert.strictEqual(problems.length, 74)
      assert.deepStrictEqual(problems.slice(0, 3), [
        "upstream/deep.test.ts: imported by a.spec.ts and b.spec.ts",
        "upstream/initial.test.ts: imported by a.spec.ts and b.spec.ts",
        "upstream/multiple.test.ts: imported by a.spec.ts and b.spec.ts"
      ])
      assert.include(problems, "upstream/actions.test.ts: imported by no CONF evidence file")
      assert.include(problems, "upstream/graph/paths.test.ts: imported by no CONF evidence file")
    }))

  it.effect("[HARNESS-1] parity harness: the CONF import check finds a file of the evidence file that another CONF evidence file also imports", () =>
    Effect.sync(() => {
      const source = readFixture("conformance/CONF-2.spec.ts.txt")
      // the faulty fixture imports deep (twice), initial, id and a helper module
      const wrong = readFixture("conformance/CONF-2-wrong.spec.ts.txt")
      assert.deepStrictEqual(checkImportedElsewhere({ source, others: [] }), [])
      assert.deepStrictEqual(checkImportedElsewhere({ source, others: [{ file: "a.spec.ts", source: wrong }] }), [
        "upstream/deep.test.ts: also imported by a.spec.ts",
        "upstream/initial.test.ts: also imported by a.spec.ts"
      ])
      assert.deepStrictEqual(
        checkImportedElsewhere({ source, others: [{ file: "a.spec.ts", source: wrong }, { file: "b.spec.ts", source }] }),
        [
          "upstream/deep.test.ts: also imported by a.spec.ts and b.spec.ts",
          "upstream/initial.test.ts: also imported by a.spec.ts and b.spec.ts",
          "upstream/multiple.test.ts: also imported by b.spec.ts"
        ]
      )
    }))

  it.effect("[HARNESS-1] parity harness: the other CONF evidence files are the *-CONF-<n>.spec.ts files of the evidence file's folder", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const dir = yield* makeTempDir("conf-evidence-")
        writeTree(dir, {
          "verify-x-CONF-2.spec.ts": "// two",
          "verify-x-CONF-10.spec.ts": "// ten",
          "verify-x-CONC-1.spec.ts": "// a near miss",
          "verify-x-CONF-3.spec.ts.txt": "// a fixture",
          "CONF-4.ts": "// not a spec"
        })
        assert.deepStrictEqual(confEvidenceSources(dir), [
          { file: "verify-x-CONF-10.spec.ts", source: "// ten" },
          { file: "verify-x-CONF-2.spec.ts", source: "// two" }
        ])
        const real = confEvidenceSources(join(pkgRoot, "test/verify")).map((entry) => entry.file)
        assert.include(real, "verify-xstate-5-33-2-port-CONF-2.spec.ts")
        assert.notInclude(real, "verify-xstate-5-33-2-port-CONC-1.spec.ts")
      })
    ))

  it.effect("[HARNESS-1] parity harness: the CONF graduation check finds a rewrite still pending, still in the green type-check exclude, or not marked passes", () =>
    Effect.sync(() => {
      const ledgerFiles: ReadonlyArray<LedgerRow> = [
        { Name: "deep", Status: "passes" },
        { Name: "initial", Status: "passes" },
        { Name: "id", Status: "rewritten" }
      ]
      assert.deepStrictEqual(
        graduationProblems({ files: ["deep", "initial"], pending: ["test/upstream/id.test.ts"], greenExclude: [], ledgerFiles }),
        []
      )
      assert.deepStrictEqual(
        graduationProblems({
          files: ["deep", "id", "nowhere"],
          pending: ["test/upstream/id.test.ts"],
          greenExclude: ["test/upstream/deep.test.ts", "test/upstream/id.test.ts"],
          ledgerFiles
        }),
        [
          "test/upstream/deep.test.ts: still in the tsconfig.test.green.json exclude",
          "test/upstream/id.test.ts: still listed in test/upstream/pending.json",
          "test/upstream/id.test.ts: still in the tsconfig.test.green.json exclude",
          "upstream/id.test.ts: ledger status \"rewritten\", not \"passes\"",
          "upstream/nowhere.test.ts: ledger status \"no ledger row\", not \"passes\""
        ]
      )
      assert.deepStrictEqual(graduationProblems({ files: [], pending: [], greenExclude: [], ledgerFiles }), [
        "the evidence file imports no upstream test file"
      ])
    }))

  it.effect("[HARNESS-1] parity harness: upstream skip and todo rows never reduce the runnable count of the CONF check", () =>
    Effect.gen(function* () {
      const manifest = yield* readManifest
      const ledger = yield* realLedger
      const multiple = fileOf(manifest, "test/multiple.test.ts")
      assert.deepStrictEqual([multiple.runnable, multiple.skip], [4, 6])
      assert.strictEqual(ledger.notPorted.filter((row) => row["File"] === multiple.path).length, 6)
      assert.strictEqual(notPortedRunnable(multiple, ledger.notPorted), 0)
      assert.strictEqual(requiredPassed(multiple, ledger.notPorted), 4)
      const skipAndTodo = ledger.notPorted.filter((row) => /^(skipped|todo) upstream /.test(row["Reason"] ?? ""))
      for (const file of manifest.files) {
        assert.strictEqual(requiredPassed(file, skipAndTodo), file.runnable, file.path)
      }
    }))

  it.effect("[HARNESS-1] parity harness: the CONF count check fails a file below runnable minus not-ported rows, and a file with no passed test", () =>
    Effect.gen(function* () {
      const manifest = yield* readManifest
      const ledger = yield* realLedger
      const check = (tree: TaskNode, expected: ReadonlyArray<string>, notPorted = ledger.notPorted) =>
        checkCounts({ blocks: countUpstreamBlocks(tree), expected, files: manifest.files, notPorted })

      assert.deepStrictEqual(check(confFile([suiteTask("upstream/multiple.test.ts", passing(4))]), ["multiple"]), [])
      assert.deepStrictEqual(
        check(confFile([suiteTask("upstream/multiple.test.ts", [...passing(3), testTask("fails", "fail")])]), ["multiple"]),
        ["upstream/multiple.test.ts: 3 passed, at least 4 required (4 runnable, 0 not ported)"]
      )
      assert.deepStrictEqual(check(confFile([suiteTask("upstream/multiple.test.ts", [])]), ["multiple"]), [
        "upstream/multiple.test.ts: 0 passed, at least 4 required (4 runnable, 0 not ported)",
        "upstream/multiple.test.ts: no test passed"
      ])

      // Tests in nested describe blocks count; a missing block and an unexpected block are problems.
      const nested = suiteTask("upstream/deep.test.ts", [suiteTask("deep", [...passing(5), suiteTask("inner", passing(4))])])
      assert.deepStrictEqual(check(confFile([nested]), ["deep"]), [])
      assert.deepStrictEqual(check(confFile([nested]), ["deep", "initial"]), [
        "upstream/initial.test.ts: no describe block in the evidence file"
      ])
      assert.deepStrictEqual(check(confFile([nested]), []), ["upstream/deep.test.ts: not a file of this check"])

      // A not-ported generator lowers the requirement by its expanded count; one passed test is still required.
      const sixteen = fileOf(manifest, "test/examples/6.16.test.ts")
      const generatorRow = notPortedRow("Example 6.16", (sixteen.tests[0] as UpstreamTest).title, "missing", sixteen.path)
      assert.strictEqual(requiredPassed(sixteen, [generatorRow]), 0)
      assert.deepStrictEqual(
        check(confFile([suiteTask("upstream/examples/6.16.test.ts", [])]), ["examples/6.16"], [generatorRow]),
        ["upstream/examples/6.16.test.ts: no test passed"]
      )
      assert.deepStrictEqual(
        check(confFile([suiteTask("upstream/examples/6.16.test.ts", passing(1))]), ["examples/6.16"], [generatorRow]),
        []
      )
    }))

  it.effect("[HARNESS-1] parity harness: the CONF count check reports skipped tests and tests that had not run yet", () =>
    Effect.gen(function* () {
      const manifest = yield* readManifest
      const ledger = yield* realLedger
      const tree = confFile([
        suiteTask("upstream/multiple.test.ts", [
          ...passing(4),
          testTask("skipped", "skip", "skip"),
          testTask("todo", null, "todo"),
          testTask("not run yet", null)
        ])
      ])
      assert.deepStrictEqual(countUpstreamBlocks(tree), [
        { title: "upstream/multiple.test.ts", passed: 4, failed: 0, skipped: 2, notRun: 1 }
      ])
      assert.deepStrictEqual(
        checkCounts({ blocks: countUpstreamBlocks(tree), expected: ["multiple"], files: manifest.files, notPorted: ledger.notPorted }),
        [
          "upstream/multiple.test.ts: 2 skipped or todo tests",
          "upstream/multiple.test.ts: 1 test had not run when the count check ran"
        ]
      )
    }))
})

describe("[HARNESS-1] parity harness: a CONF-shaped suite inside a shuffled parent", { shuffle: true }, () => {
  it("[HARNESS-1] parity harness: a sibling test of the CONF-shaped suite", () => {
    assert.isTrue(true)
  })

  conformanceSuite(
    {
      title: "[HARNESS-1] parity harness: imported blocks, then the count test",
      checks: [
        {
          name: "[HARNESS-1] parity harness: the count test runs after every test of every imported block",
          check: orderProblems
        }
      ]
    },
    () => {
      describe("upstream/alpha.test.ts", upstreamFileOptions(), () => {
        it("alpha one", () => assert.isTrue(true))
        it("alpha two", () => assert.isTrue(true))
        it("alpha three", () => assert.isTrue(true))
      })
      describe("upstream/beta.test.ts", upstreamFileOptions(), () => {
        it("beta one", () => assert.isTrue(true))
        it("beta two", () => assert.isTrue(true))
      })
    }
  )
})
