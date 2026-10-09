/**
 * CONF-7: the upstream graph files green at phase 7 pass (SD-1, SD-2).
 *
 * The file imports each rewrite whose ledger green phase is 7 (the 10 files of upstream
 * `src/graph/test/`) inside its own describe block titled `upstream/graph/<name>.test.ts`, so
 * every upstream test of the file runs once, inside the default run, and its evidence routes
 * to CONF-7. `conformancePhase` (`conformance.ts`) keeps the blocks and its checks in
 * declaration order, also under `--sequence.shuffle`:
 *
 * - the graduation check: each imported rewrite has left `pending.json` and the green
 *   type-check exclude (one commit, SD-1), and the ledger marks it `passes`;
 * - the import check: the file imports exactly graph/adjacency, graph/dieHard, graph/events,
 *   graph/forbiddenAttributes, graph/graph, graph/index, graph/paths, graph/shortestPaths,
 *   graph/states and graph/testModel (the ledger's green-phase 7 files), and no other CONF
 *   evidence file imports one of them;
 * - the count check, last: per file, `passed >= runnable - notPortedRunnable` and
 *   `passed >= 1`, no skipped test, and no test still to run (91 runnable upstream tests, a
 *   floor of 91).
 *
 * T7.15 to T7.24 imported the 10 files one block at a time under the graduation check
 * alone; T7.25 switched to `conformancePhase`, which keeps the suite title, so the keys of
 * the graph snapshot file below did not change. The describe block "the CONF-7 suite and its
 * count floor" pins the order of the checks and the count data of phase 7.
 *
 * graph/adjacency.test.ts builds the test model of a machine (`createTestModel`, an Effect,
 * DEV-50), reads its adjacency map (`getAdjacencyMap`, an Effect) and turns the map into an
 * array (`adjacencyMapToArray`); both tests compare the array with upstream's inline
 * snapshot, one row per state and event, in upstream's order.
 *
 * graph/dieHard.test.ts builds the paths of the die hard jugs machine while Vitest collects
 * the file (`createTestModel`, `getShortestPaths`, `getSimplePaths`, `getPathsFromEvents`, run
 * with `Effect.runSync`, so they must be synchronous Effects) and makes one test per path:
 * `testPath` runs the jug executors (`Effect.sync`) and the state tests along the path. The
 * last test compares the error trace of a failing state test with upstream's inline snapshot.
 *
 * graph/events.test.ts builds the test model of a two-state machine (`createTestModel`, an
 * Effect) and runs its shortest paths through the helper `graph/testUtils.ts`
 * (`testUtils.testModel`, an Effect that tests one path after another); both tests check that
 * the plain synchronous executor of `EVENT` ran. It is the first imported rewrite that uses
 * `graph/testUtils.ts`, so the helper left `pending.json` and the green type-check exclude
 * with it (a helper module is pending exactly while every rewrite that imports it is pending).
 *
 * graph/forbiddenAttributes.test.ts gives `createTestModel` a machine with an invocation, an
 * `after` transition and a delayed `raise`. Upstream throws at the call; the port fails the
 * Effect with `UnsupportedTestMachineError` (name `Error`, DEV-50), so each test flips the
 * Effect and checks that the failure's message contains upstream's text (DEV-8, SD-13).
 *
 * graph/graph.test.ts runs the traversals (`getShortestPaths`, `getSimplePaths`,
 * `getPathsFromEvents`, Effects, SD-13), `getStateNodes`, `toDirectedGraph` and `joinPaths`
 * (an Effect that fails with upstream's `Paths cannot be joined`, SD-3). Ten of its tests
 * compare their result with a file snapshot. Vitest reads a file snapshot beside the test
 * file that it runs, so these entries live in
 * `__snapshots__/verify-xstate-5-33-2-port-CONF-7.spec.ts.snap`, under keys that start with
 * this file's describe chain (`[CONF-7] upstream files green at phase 7 >
 * upstream/graph/graph.test.ts > `). Each value is upstream's `graph.test.ts.snap` entry
 * verbatim; no run with `-u` wrote it, and `pnpm test` runs with `CI=true`, so a difference
 * fails instead of rewriting the entry (SD-26).
 *
 * graph/index.test.ts builds test models (`createTestModel`, an Effect) with fixed, dynamic
 * and payload events, `stopWhen`, `toState` and `input`, and runs their paths through
 * `testUtils.ts`, `path.test` and `testPath` (Effects; the event executors and state tests
 * stay plain functions). Its limit test flips the traversal Effect and compares the failure
 * with upstream's inline snapshot `[Error: Traversal limit exceeded]` verbatim (SD-13, SD-26).
 *
 * graph/paths.test.ts reads the paths of test models (`getPaths` with a custom path generator,
 * `getShortestPaths`, `getSimplePaths`, `getShortestPathsFrom`, `getSimplePathsFrom`; Effects,
 * SD-13). The custom generator is itself an Effect built from `getInitialSnapshot` and
 * `getNextSnapshot`. Its `filterEvents` test passes `state.can(event)`, an Effect (SD-6), which
 * the graph's `filterEvents` accepts. The descriptions match upstream's text and inline
 * snapshots verbatim (SD-26).
 *
 * graph/shortestPaths.test.ts runs `getShortestPaths` (an Effect, SD-13) with `toState`,
 * `fromState`, payload `events`, `stopWhen` and an `after` delay. One test joins two shortest
 * paths with `joinPaths` (an Effect that fails with upstream's `Paths cannot be joined`, SD-3)
 * inside `Effect.forEach`, and compares the joined event types with upstream's inline
 * snapshot verbatim (SD-26).
 *
 * graph/states.test.ts builds the test model of a machine with a compound state
 * (`createTestModel`, an Effect, DEV-50) and runs its shortest paths through
 * `testUtils.testModel` (an Effect) with state tests keyed by state path (`b.b1`) and by
 * state id (`#state_b1`). Each state test is a plain function that records the state value;
 * the recorded values match upstream's inline snapshot verbatim (SD-26).
 *
 * graph/testModel.test.ts builds a `TestModel` directly (`new TestModel(logic, options)`,
 * synchronous, DEV-50) over transition logic that is not a machine (`fromTransition`, the
 * Collatz step from 15), with an `events` function and a `stateMatcher` for the state keys
 * `even` and `odd`. It reads the shortest paths to the context 1 (`getShortestPaths` with
 * `toState`, an Effect, SD-13) and runs them through `testUtils.testPaths` (an Effect); the
 * state tests are plain functions. It is the last rewrite of the phase, so after it
 * `pending.json` is empty.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { conformancePhase, greenFiles, requiredPassed, upstreamFileOptions } from "./conformance.js"
import { shortName } from "./ledger.js"
import { readLedger, readManifest } from "./parity.js"

// ---------------------------------------------------------------- the imported files

conformancePhase(7, () => {
  describe("upstream/graph/adjacency.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/graph/adjacency.test.js")
  })
  describe("upstream/graph/dieHard.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/graph/dieHard.test.js")
  })
  describe("upstream/graph/events.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/graph/events.test.js")
  })
  describe("upstream/graph/forbiddenAttributes.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/graph/forbiddenAttributes.test.js")
  })
  describe("upstream/graph/graph.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/graph/graph.test.js")
  })
  describe("upstream/graph/index.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/graph/index.test.js")
  })
  describe("upstream/graph/paths.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/graph/paths.test.js")
  })
  describe("upstream/graph/shortestPaths.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/graph/shortestPaths.test.js")
  })
  describe("upstream/graph/states.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/graph/states.test.js")
  })
  describe("upstream/graph/testModel.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/graph/testModel.test.js")
  })
})

// ---------------------------------------------------------------- the shape of the suite and its count floor

const SUITE_TITLE = "[CONF-7] upstream files green at phase 7"

/** The upstream files green at phase 7, in the order of the ledger and of the imported blocks. */
const PHASE_7_FILES = [
  "graph/adjacency",
  "graph/dieHard",
  "graph/events",
  "graph/forbiddenAttributes",
  "graph/graph",
  "graph/index",
  "graph/paths",
  "graph/shortestPaths",
  "graph/states",
  "graph/testModel"
] as const

describe("[CONF-7] the CONF-7 suite and its count floor", () => {
  it("[CONF-7] the suite imports the 10 files green at phase 7, then runs the graduation, import and count checks, the count check last, and never shuffles its own children", ({ task }) => {
    const suite = task.file.tasks.find((child) => child.name === SUITE_TITLE)
    assert.strictEqual(suite?.type, "suite")
    const children = suite?.type === "suite" ? suite.tasks : []
    assert.deepStrictEqual(children.map((child) => [child.type, child.name]), [
      ...PHASE_7_FILES.map((name) => ["suite", `upstream/${name}.test.ts`]),
      ["test", "[CONF-7] each imported rewrite has left pending.json and the green type-check exclude, and the ledger marks it passes"],
      ["test", "[CONF-7] the evidence file imports exactly the upstream files green at phase 7, and no other CONF evidence file imports them"],
      ["test", "[CONF-7] every imported file meets its count"]
    ])
    assert.strictEqual(suite?.type === "suite" ? suite.shuffle : undefined, false)
  })

  it.effect("[CONF-7] the files green at phase 7 have 91 runnable upstream tests and a floor of 91 passed: graph's 3 not-ported rows are for upstream skipped tests and lower nothing", () =>
    Effect.sync(() => {
      const { ledger, problems } = readLedger()
      assert.deepStrictEqual(problems, [])
      const manifest = readManifest()
      // [name, runnable, upstream skip + todo, "Tests not ported" rows, required passed]
      const floors = greenFiles(ledger.files, 7).map((row) => {
        const name = row["Name"] ?? ""
        const upstream = manifest.files.find((file) => shortName(file.path) === name)
        if (upstream === undefined) return [name]
        const rows = ledger.notPorted.filter((notPorted) => notPorted["File"] === upstream.path).length
        return [name, upstream.runnable, upstream.skip + upstream.todo, rows, requiredPassed(upstream, ledger.notPorted)]
      })
      // graph/graph: 3 rows, one for each test upstream skips (not runnable), so its floor
      // stays at its 22 runnable tests; no other phase-7 file has a row.
      assert.deepStrictEqual(floors, [
        ["graph/adjacency", 2, 0, 0, 2],
        ["graph/dieHard", 29, 0, 0, 29],
        ["graph/events", 2, 0, 0, 2],
        ["graph/forbiddenAttributes", 3, 0, 0, 3],
        ["graph/graph", 22, 3, 3, 22],
        ["graph/index", 12, 0, 0, 12],
        ["graph/paths", 13, 0, 0, 13],
        ["graph/shortestPaths", 4, 0, 0, 4],
        ["graph/states", 2, 0, 0, 2],
        ["graph/testModel", 2, 0, 0, 2]
      ])
      assert.deepStrictEqual(floors.map((floor) => floor[0]), [...PHASE_7_FILES])
      assert.strictEqual(floors.reduce((total, floor) => total + Number(floor[1]), 0), 91)
      assert.strictEqual(floors.reduce((total, floor) => total + Number(floor[4]), 0), 91)
    }))
})
