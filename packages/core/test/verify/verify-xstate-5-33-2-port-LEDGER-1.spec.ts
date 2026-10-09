/**
 * LEDGER-1: the conformance ledger `test/upstream/CONFORMANCE.md` (D2).
 *
 * T1.4 adds the structure tests. The ledger must list every upstream test file of the
 * frozen manifest with its rewrite phase and green phase (the PARITY-n / CONF-n schedule of
 * the SPEC, SD-2), every gap row S1–S27, A1–A23, C1–C22, P1–P14 with its phase, its closing
 * upstream files and its evidence file, the upstream skip and todo tests as "Tests not
 * ported" rows (D19), the deviations the SPEC decides, and P15 as out of scope (D5). Every
 * deviation, removed and not-ported row cites the decision that requires it, or a reason
 * only upstream can have (AC 35). The statuses are checked against the file system, so the
 * tasks that mark files `passes` keep these tests green.
 *
 * T8.8 closes the ledger and adds the "no row open" tests: no gap row is open, and each names
 * its closing test (or, for a deviation, its decision); each closing test is a passing test,
 * either a ported upstream test of a rewrite that a CONF evidence file imports and the ledger
 * marks `passes`, or a test of the row's own evidence file; every upstream file passes or
 * deviates, or is rewritten while `test/upstream/pending.json` still lists it (its CONF task
 * graduates it); and the count of each row kind is reported (AC 89).
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import type { UpstreamManifest, UpstreamTest } from "../../scripts/upstream/freeze-upstream.js"
import { formatAnnotation } from "../../scripts/upstream/freeze-upstream.js"
import { confEvidenceSources, importsOf } from "./conformance.js"
import { calleeRoot } from "./parity.js"
import {
  citedDecisions,
  DEVIATION_KINDS,
  evidenceFile,
  GAP_KINDS,
  isUpstreamOnlyReason,
  LEDGER_FILE,
  NONE,
  notPortedAnnotation,
  parseLedger,
  rewritePath,
  shortName,
  STATUSES,
  TABLES
} from "./ledger.js"

const pkgRoot = fileURLToPath(new URL("../../", import.meta.url))

const readManifest = Effect.sync(
  () => JSON.parse(readFileSync(join(pkgRoot, "test/upstream/upstream-manifest.json"), "utf8")) as UpstreamManifest
)

const readLedger = Effect.sync(() => parseLedger(readFileSync(join(pkgRoot, LEDGER_FILE), "utf8")))

/** The SPEC schedule (context.md, "Task-phase plan"): the phase that rewrites each file (PARITY-n). */
const REWRITE_PHASES: Readonly<Record<number, ReadonlyArray<string>>> = {
  2: [
    "actions", "actor", "actorLogic", "deep", "deterministic", "emit", "errors", "event", "final", "guards",
    "history", "id", "initial", "internalTransitions", "interpreter", "invoke", "multiple", "order", "parallel",
    "predictableExec", "rehydration", "spawnChild", "system", "transient", "examples/6.16", "examples/6.17",
    "examples/6.6", "examples/6.8", "examples/6.9", "examples/cd"
  ],
  3: [
    "after", "clock", "definition", "eventDescriptors", "invalid", "json", "machine", "mapState", "match", "meta",
    "microstep", "resolve", "route", "state", "tags"
  ],
  4: ["assert", "assign", "input", "scxml", "setup.types", "spawn", "spawn.types", "stateIn", "types"],
  5: ["activities", "inspect", "logger", "select"],
  6: ["getNextSnapshot", "issue5454", "toPromise", "transition", "waitFor"],
  7: [
    "graph/adjacency", "graph/dieHard", "graph/events", "graph/forbiddenAttributes", "graph/graph", "graph/index",
    "graph/paths", "graph/shortestPaths", "graph/states", "graph/testModel"
  ],
  8: ["typeHelpers"]
}

/** The SPEC schedule: the phase at whose end each file must pass in full (CONF-n). */
const GREEN_PHASES: Readonly<Record<number, ReadonlyArray<string>>> = {
  2: ["deep", "initial", "multiple"],
  3: [
    "definition", "id", "invalid", "json", "mapState", "match", "order", "resolve", "route", "state", "tags",
    "examples/6.17", "examples/6.6", "examples/6.8", "examples/6.9", "examples/cd"
  ],
  4: [
    "assert", "assign", "eventDescriptors", "guards", "internalTransitions", "machine", "parallel", "scxml", "spawn",
    "spawnChild", "stateIn", "examples/6.16"
  ],
  5: [
    "actions", "activities", "clock", "emit", "errors", "event", "final", "history", "input", "interpreter", "invoke",
    "logger", "meta", "predictableExec", "select", "setup.types", "system", "transient"
  ],
  6: [
    "actor", "actorLogic", "after", "deterministic", "getNextSnapshot", "inspect", "issue5454", "microstep",
    "rehydration", "spawn.types", "toPromise", "transition", "types", "waitFor"
  ],
  7: REWRITE_PHASES[7] ?? [],
  8: ["typeHelpers"]
}

const phaseOf = (schedule: Readonly<Record<number, ReadonlyArray<string>>>): ReadonlyMap<string, string> =>
  new Map(Object.entries(schedule).flatMap(([phase, names]) => names.map((name) => [name, phase] as const)))

/**
 * Each gap row with its phase (the scenario's `@phase-n` tag, SD-15 applied) and its closing
 * upstream files (the `# Closed by:` comment above the scenario, from research/upstream-tests.md §4).
 */
const GAP_ROWS: ReadonlyArray<readonly [string, number, string]> = [
  ["S1", 2, "verify file only"],
  ["S2", 2, "deterministic, initial, examples/cd"],
  ["S3", 2, "initial, parallel, scxml, examples/6.16, examples/6.17"],
  ["S4", 3, "final"],
  ["S5", 3, "final"],
  ["S6", 2, "final"],
  ["S7", 2, "final"],
  ["S8", 2, "history, scxml, examples/6.8, examples/6.9"],
  ["S9", 2, "deterministic, id, scxml, examples/6.17, examples/6.6, examples/cd"],
  ["S10", 2, "multiple"],
  ["S11", 2, "actions, event, internalTransitions, scxml"],
  ["S12", 2, "actions, internalTransitions, scxml"],
  ["S13", 2, "actions, deep, order, scxml"],
  ["S14", 2, "actions, predictableExec"],
  ["S15", 2, "verify file only"],
  ["S16", 3, "guards"],
  ["S17", 3, "eventDescriptors"],
  ["S18", 3, "deterministic"],
  ["S19", 2, "scxml, transient"],
  ["S20", 3, "after"],
  ["S21", 2, "transient"],
  ["S22", 3, "route"],
  ["S23", 3, "match, meta, state, tags"],
  ["S24", 2, "errors"],
  ["S25", 3, "definition, deterministic, invalid, json, machine, microstep, resolve"],
  ["S26", 3, "mapState, match"],
  ["S27", 3, "meta"],
  ["A1", 4, "assign"],
  ["A2", 2, "actor"],
  ["A3", 2, "actions, predictableExec"],
  ["A4", 4, "after"],
  ["A5", 2, "actions, event, system"],
  ["A6", 2, "emit"],
  ["A7", 4, "emit"],
  ["A8", 4, "actions"],
  ["A9", 2, "spawnChild"],
  ["A10", 2, "actor"],
  ["A11", 4, "actions"],
  ["A12", 2, "actions"],
  ["A13", 2, "actions"],
  ["A14", 2, "guards"],
  ["A15", 2, "guards"],
  ["A16", 4, "stateIn"],
  ["A17", 2, "errors"],
  ["A18", 4, "setup.types, types"],
  ["A19", 4, "setup.types"],
  ["A20", 4, "machine"],
  ["A21", 4, "actor, spawn, spawn.types"],
  ["A22", 4, "input, types"],
  ["A23", 4, "assert"],
  ["C1", 2, "interpreter"],
  ["C2", 5, "activities, invoke"],
  ["C3", 5, "system"],
  ["C4", 5, "invoke"],
  ["C5", 5, "actor"],
  ["C6", 2, "actorLogic"],
  ["C7", 2, "invoke"],
  ["C8", 2, "actor, actorLogic"],
  ["C9", 2, "actorLogic"],
  ["C10", 2, "verify file only"],
  ["C11", 5, "types"],
  ["C12", 2, "system"],
  ["C13", 2, "actions, interpreter"],
  ["C14", 2, "interpreter"],
  ["C15", 2, "interpreter"],
  ["C16", 5, "interpreter"],
  ["C17", 5, "select"],
  ["C18", 5, "verify file only"],
  ["C19", 2, "errors"],
  ["C20", 2, "system"],
  ["C21", 5, "inspect"],
  ["C22", 5, "clock, logger"],
  ["P1", 2, "actorLogic, rehydration"],
  ["P2", 2, "actorLogic, rehydration"],
  ["P3", 2, "actorLogic, rehydration"],
  ["P4", 6, "actorLogic, rehydration"],
  ["P5", 6, "verify file only"],
  ["P6", 6, "inspect"],
  ["P7", 6, "getNextSnapshot, issue5454, transition"],
  ["P8", 6, "microstep, transition"],
  ["P9", 6, "waitFor"],
  ["P10", 6, "toPromise"],
  ["P11", 3, "clock"],
  ["P12", 6, "spawn.types, types"],
  [
    "P13",
    7,
    "graph/adjacency, graph/dieHard, graph/events, graph/forbiddenAttributes, graph/graph, graph/index, graph/paths, graph/shortestPaths, graph/states, graph/testModel"
  ],
  ["P14", 7, "verify file only"]
]

const rowIds = (prefix: string, count: number): ReadonlyArray<string> =>
  Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`)

/** The decisions that each need a deviation row (T1.4; scenario LEDGER-1). */
const REQUIRED_DEVIATION_DECISIONS: ReadonlyArray<string> = [
  "D6", "D7", "D8", "SD-3", "SD-5", "SD-6", "SD-7", "SD-8", "SD-11", "SD-12", "SD-13", "SD-16", "SD-17", "SD-18",
  "SD-19", "SD-21", "SD-23", "SD-24", "SD-25", "SD-27", "SD-28"
]

/** The bridge APIs D6 does not port; each needs its own deviation row. */
const D6_SUBJECTS: ReadonlyArray<string> = ["interpret", "toObserver", "observer-object subscribe", "Subscription"]

/** Every `D<n>` and `SD-<n>` token of a cell, in range or not. */
const decisionTokens = (text: string): ReadonlyArray<string> => [...text.matchAll(/\b(?:SD-|D)\d+\b/g)].map((m) => m[0])

/** The annotations of every upstream test, including each test a generator expands to. */
const knownAnnotations = (manifest: UpstreamManifest): ReadonlySet<string> =>
  new Set(
    manifest.files.flatMap((file) =>
      file.tests.flatMap((test: UpstreamTest) => [
        test.annotation,
        ...(test.expansion?.tests ?? []).map((expanded) =>
          formatAnnotation(file.path, expanded.describePath, expanded.title, null)
        )
      ])
    )
  )

const readPending = Effect.sync(
  () => JSON.parse(readFileSync(join(pkgRoot, "test/upstream/pending.json"), "utf8")) as ReadonlyArray<string>
)

const readSource = (path: string) => Effect.sync(() => readFileSync(join(pkgRoot, path), "utf8"))

/**
 * The count of each row kind of the closed ledger (AC 89): deviation and removed rows, "Tests
 * not ported" rows by gap kind, and out-of-scope rows. A task that adds or removes a row
 * updates this record with the ledger.
 */
const ROW_COUNTS: Readonly<Record<string, number>> = {
  deviation: 73,
  removed: 1,
  "not ported: missing": 25,
  "not ported: assertions": 0,
  "not ported: inline snapshot": 16,
  "not ported: ts-expect-error": 0,
  "out of scope": 1
}

/** True for an upstream test that runs: not a skip or a todo. */
const isRunnable = (test: UpstreamTest): boolean => test.kind !== "skip" && test.kind !== "todo"

/** An annotation without its occurrence suffix (` #<n>`). */
const withoutOccurrence = (annotation: string): string => annotation.replace(/ #\d+$/, "")

/**
 * The manifest annotations that stand for a runnable upstream test in a rewrite: the test's
 * own annotation, or the annotation of the generator that expands to it.
 */
const annotationsFor = (
  manifest: UpstreamManifest,
  upstreamFile: string,
  annotation: string
): ReadonlyArray<string> =>
  manifest.files
    .filter((file) => file.path === upstreamFile)
    .flatMap((file) =>
      file.tests.filter(isRunnable).filter((test) =>
        withoutOccurrence(test.annotation) === annotation ||
        (test.expansion?.tests ?? []).some((expanded) =>
          formatAnnotation(file.path, expanded.describePath, expanded.title, null) === annotation
        )
      )
    )
    .map((test) => test.annotation)

/**
 * The full names (`<describe> > ... > <title>`) of the tests that a spec source declares with
 * literal titles (`describe`, `it`, `it.effect`, `test`).
 */
const testNamesOf = (source: string): ReadonlySet<string> => {
  const sf = ts.createSourceFile("evidence.spec.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const names = new Set<string>()
  const visit = (node: ts.Node, path: ReadonlyArray<string>): void => {
    if (ts.isCallExpression(node)) {
      const root = calleeRoot(node.expression)
      const title = node.arguments[0]
      if ((root === "describe" || root === "it" || root === "test") && title !== undefined && ts.isStringLiteralLike(title)) {
        const name = [...path, title.text]
        if (root === "describe") {
          for (const argument of node.arguments) visit(argument, name)
        } else {
          names.add(name.join(" > "))
        }
        return
      }
    }
    ts.forEachChild(node, (child) => visit(child, path))
  }
  visit(sf, [])
  return names
}

describe("LEDGER-1 conformance ledger (structure)", () => {
  it.effect("[LEDGER-1] the ledger has its five tables with the exact column headers", () =>
    Effect.gen(function* () {
      const { problems } = yield* readLedger
      assert.deepStrictEqual(problems, [])
    }))

  it.effect("[LEDGER-1] lists every upstream file and gap row", () =>
    Effect.gen(function* () {
      const manifest = yield* readManifest
      const { ledger } = yield* readLedger
      const files = ledger.files.map((row) => row["Upstream file"])
      assert.strictEqual(files.length, 74)
      assert.deepStrictEqual([...files].sort(), manifest.files.map((file) => file.path).sort())
      assert.strictEqual(new Set(files).size, files.length)
      const expectedRows = [...rowIds("S", 27), ...rowIds("A", 23), ...rowIds("C", 22), ...rowIds("P", 14)]
      assert.deepStrictEqual(
        ledger.gaps.map((row) => row["Row"]),
        expectedRows
      )
      assert.strictEqual(expectedRows.length, 86)
    }))

  it.effect("[LEDGER-1] each upstream file has its rewrite path and the rewrite and green phase of the SD-2 schedule", () =>
    Effect.gen(function* () {
      const { ledger } = yield* readLedger
      const rewritePhase = phaseOf(REWRITE_PHASES)
      const greenPhase = phaseOf(GREEN_PHASES)
      assert.strictEqual(rewritePhase.size, 74)
      assert.strictEqual(greenPhase.size, 74)
      for (const row of ledger.files) {
        const path = row["Upstream file"] ?? ""
        const name = shortName(path)
        assert.strictEqual(row["Name"], name, path)
        assert.strictEqual(row["Rewrite"], rewritePath(path), path)
        assert.strictEqual(row["Rewrite phase"], rewritePhase.get(name), `${name} rewrite phase`)
        assert.strictEqual(row["Green phase"], greenPhase.get(name), `${name} green phase`)
        assert.isTrue(Number(row["Rewrite phase"]) <= Number(row["Green phase"]), `${name} is rewritten before it is green`)
      }
      const count = (column: string, phase: string) => ledger.files.filter((row) => row[column] === phase).length
      assert.deepStrictEqual(
        ["2", "3", "4", "5", "6", "7", "8"].map((phase) => count("Rewrite phase", phase)),
        [30, 15, 9, 4, 5, 10, 1]
      )
      assert.deepStrictEqual(
        ["2", "3", "4", "5", "6", "7", "8"].map((phase) => count("Green phase", phase)),
        [3, 16, 12, 18, 14, 10, 1]
      )
    }))

  it.effect("[LEDGER-1] each gap row has its phase, its closing upstream files and its evidence file", () =>
    Effect.gen(function* () {
      const { ledger } = yield* readLedger
      const names = new Set(ledger.files.map((row) => row["Name"]))
      assert.deepStrictEqual(
        ledger.gaps.map((row) => [row["Row"], Number(row["Phase"]), row["Closing upstream files"]]),
        GAP_ROWS.map(([row, phase, files]) => [row, phase, files])
      )
      for (const row of ledger.gaps) {
        const id = row["Row"] ?? ""
        assert.strictEqual(row["Evidence file"], evidenceFile(id), id)
        assert.isTrue((row["Subject"] ?? "").length > 0, `${id} has a subject`)
        const closing = row["Closing upstream files"] ?? ""
        if (closing === "verify file only") continue
        for (const name of closing.split(", ")) assert.isTrue(names.has(name), `${id}: ${name} is an upstream file`)
      }
      assert.deepStrictEqual(
        ledger.gaps.filter((row) => row["Closing upstream files"] === "verify file only").map((row) => row["Row"]),
        ["S1", "S15", "C10", "C18", "P5", "P14"]
      )
    }))

  it.effect("[LEDGER-1] statuses come from the allowed set and a file with no rewrite yet is not started", () =>
    Effect.gen(function* () {
      const { ledger } = yield* readLedger
      const allowed: ReadonlyArray<string> = STATUSES
      for (const row of [...ledger.files, ...ledger.gaps]) {
        assert.include(allowed, row["Status"], row["Upstream file"] ?? row["Row"])
      }
      for (const row of ledger.files) {
        const rewrite = row["Rewrite"] ?? ""
        if (!existsSync(join(pkgRoot, rewrite))) assert.strictEqual(row["Status"], "not started", rewrite)
      }
      for (const row of ledger.gaps) {
        if (row["Status"] === "passes") assert.notStrictEqual(row["Closing test"], NONE, `${row["Row"]} names its test`)
      }
    }))

  it.effect("[LEDGER-1] P15 is out of scope citing D5 and never a gap row", () =>
    Effect.gen(function* () {
      const { ledger } = yield* readLedger
      const p15 = ledger.outOfScope.filter((row) => row["Row"] === "P15")
      assert.strictEqual(p15.length, 1)
      assert.include(citedDecisions(p15[0]?.["Decision"] ?? ""), "D5")
      assert.isFalse(ledger.gaps.some((row) => row["Row"] === "P15"))
    }))

  it.effect("[LEDGER-1] the tests-not-ported table holds the 14 upstream skip and todo tests", () =>
    Effect.gen(function* () {
      const manifest = yield* readManifest
      const { ledger } = yield* readLedger
      const skipped = manifest.files.flatMap((file) =>
        file.tests.filter((test) => test.kind === "skip" || test.kind === "todo")
      )
      assert.deepStrictEqual(
        [skipped.filter((test) => test.kind === "skip").length, skipped.filter((test) => test.kind === "todo").length],
        [13, 1]
      )
      for (const test of skipped) {
        const rows = ledger.notPorted.filter((row) => notPortedAnnotation(row) === test.annotation)
        assert.strictEqual(rows.length, 1, test.annotation)
        assert.strictEqual(rows[0]?.["Gap kind"], "missing", test.annotation)
        const expected = test.kind === "skip" ? "skipped upstream" : "todo upstream"
        assert.include(rows[0]?.["Reason"] ?? "", expected, test.annotation)
      }
    }))

  it.effect("[LEDGER-1] every not-ported row names an upstream test and a known gap kind", () =>
    Effect.gen(function* () {
      const manifest = yield* readManifest
      const { ledger } = yield* readLedger
      const known = knownAnnotations(manifest)
      const kinds: ReadonlyArray<string> = GAP_KINDS
      const keys = ledger.notPorted.map((row) => `${notPortedAnnotation(row)} | ${row["Gap kind"]}`)
      assert.strictEqual(new Set(keys).size, keys.length, "no row is listed twice")
      for (const row of ledger.notPorted) {
        assert.isTrue(known.has(notPortedAnnotation(row)), `${notPortedAnnotation(row)} is an upstream test`)
        assert.include(kinds, row["Gap kind"], notPortedAnnotation(row))
      }
    }))

  it.effect("[LEDGER-1] the deviation table holds a row for D6 (four APIs), D7, D8 and each SD the SPEC names", () =>
    Effect.gen(function* () {
      const { ledger } = yield* readLedger
      const kinds: ReadonlyArray<string> = DEVIATION_KINDS
      const ids = ledger.deviations.map((row) => row["ID"])
      assert.strictEqual(new Set(ids).size, ids.length, "deviation IDs are unique")
      for (const row of ledger.deviations) assert.include(kinds, row["Kind"], row["ID"])
      const cited = new Set(ledger.deviations.flatMap((row) => citedDecisions(row["Decision"] ?? "")))
      for (const decision of REQUIRED_DEVIATION_DECISIONS) assert.isTrue(cited.has(decision), `${decision} has a row`)
      const d6 = ledger.deviations.filter((row) => citedDecisions(row["Decision"] ?? "").includes("D6"))
      for (const subject of D6_SUBJECTS) {
        assert.isTrue(d6.some((row) => (row["Subject"] ?? "").includes(subject)), `D6 row for ${subject}`)
      }
    }))

  it.effect("[LEDGER-1] every deviation, removed, not-ported and out-of-scope row cites a decision or an upstream-only reason", () =>
    Effect.gen(function* () {
      const { ledger } = yield* readLedger
      const cells = [
        ...ledger.deviations.map((row) => [row["ID"], row["Decision"] ?? ""] as const),
        ...ledger.outOfScope.map((row) => [row["Row"], row["Decision"] ?? ""] as const),
        ...ledger.notPorted.map((row) => [notPortedAnnotation(row), row["Reason"] ?? ""] as const)
      ]
      for (const [label, text] of cells) {
        assert.deepStrictEqual(citedDecisions(text), decisionTokens(text), `${label}: every cited decision exists`)
        assert.isTrue(citedDecisions(text).length > 0 || isUpstreamOnlyReason(text), `${label} cites its reason`)
      }
    }))
})

describe("LEDGER-1 conformance ledger (closed)", () => {
  it.effect("[LEDGER-1] no gap row is open: each passes with its closing test or deviates with its decision", () =>
    Effect.gen(function* () {
      const { ledger } = yield* readLedger
      for (const row of ledger.gaps) {
        const id = row["Row"] ?? ""
        assert.include(["passes", "deviation"], row["Status"], `${id} is not open`)
        const closing = row["Closing test"] ?? NONE
        if (row["Status"] === "passes") {
          assert.notStrictEqual(closing, NONE, `${id} names its closing test`)
        } else {
          assert.isAbove(citedDecisions(closing).length, 0, `${id} cites the decision of its deviation`)
        }
      }
    }))

  it.effect("[LEDGER-1] each closing test is a passing test of a CONF-imported rewrite or of the row's own evidence file", () =>
    Effect.gen(function* () {
      const manifest = yield* readManifest
      const { ledger } = yield* readLedger
      const sources = yield* Effect.sync(() => confEvidenceSources(join(pkgRoot, "test/verify")))
      const imported = new Set(
        sources.flatMap(({ file, source }) => importsOf(source, file).flatMap((entry) => (entry.file === null ? [] : [entry.file])))
      )
      const missing = new Set(
        ledger.notPorted.filter((row) => row["Gap kind"] === "missing").map(notPortedAnnotation)
      )
      const fileByRewrite = new Map(ledger.files.map((row) => [row["Rewrite"] ?? "", row] as const))
      for (const row of ledger.gaps.filter((gap) => gap["Status"] === "passes")) {
        const id = row["Row"] ?? ""
        const [path = "", ...names] = (row["Closing test"] ?? NONE).split(" > ")
        if (path === evidenceFile(id)) {
          const tests = testNamesOf(yield* readSource(path))
          assert.isTrue(tests.has(names.join(" > ")), `${id}: ${path} has the test ${names.join(" > ")}`)
          continue
        }
        const file = fileByRewrite.get(path)
        assert.isDefined(file, `${id}: ${path} is a rewrite of the ledger or the row's own evidence file`)
        const name = file?.["Name"] ?? ""
        const upstreamFile = file?.["Upstream file"] ?? ""
        assert.include((row["Closing upstream files"] ?? "").split(", "), name, `${id}: ${name} is a closing upstream file`)
        assert.strictEqual(file?.["Status"], "passes", `${id}: ${name} passes`)
        assert.isTrue(imported.has(name), `${id}: a CONF evidence file imports ${path}`)
        const annotation = [upstreamFile, ...names].join(" > ")
        assert.isFalse(missing.has(annotation), `${id}: ${annotation} is not a "Tests not ported" missing row`)
        const annotations = annotationsFor(manifest, upstreamFile, annotation)
        assert.isAbove(annotations.length, 0, `${id}: ${annotation} is a runnable upstream test`)
        const lines = new Set((yield* readSource(path)).split("\n").map((line) => line.trim()))
        assert.isTrue(
          annotations.some((text) => lines.has(`// upstream: ${text}`)),
          `${id}: ${path} annotates ${annotation}`
        )
      }
    }))

  it.effect("[LEDGER-1] every upstream file passes or deviates, or is rewritten while pending.json still lists it", () =>
    Effect.gen(function* () {
      const { ledger } = yield* readLedger
      const pending = yield* readPending
      for (const row of ledger.files) {
        const status = row["Status"]
        if (status === "passes" || status === "deviation") continue
        assert.strictEqual(status, "rewritten", `${row["Name"]} passes, deviates or is rewritten`)
        assert.include(pending, row["Rewrite"], `${row["Name"]} is rewritten and still pending`)
      }
    }))

  it.effect("[LEDGER-1] the count of each row kind (deviation, removed, not ported by gap kind, out of scope)", () =>
    Effect.gen(function* () {
      const { ledger } = yield* readLedger
      const count = (rows: ReadonlyArray<Readonly<Record<string, string>>>, column: string, value: string) =>
        rows.filter((row) => row[column] === value).length
      const counts = {
        ...Object.fromEntries(DEVIATION_KINDS.map((kind) => [kind, count(ledger.deviations, "Kind", kind)])),
        ...Object.fromEntries(GAP_KINDS.map((kind) => [`not ported: ${kind}`, count(ledger.notPorted, "Gap kind", kind)])),
        "out of scope": ledger.outOfScope.length
      }
      assert.deepStrictEqual(counts, ROW_COUNTS)
      assert.strictEqual(
        Object.values(counts).reduce((total, value) => total + value, 0),
        ledger.deviations.length + ledger.notPorted.length + ledger.outOfScope.length,
        "every row has one of the counted kinds"
      )
    }))
})

describe("LEDGER-1 ledger reader", () => {
  const table = (section: string, header: string, rows: ReadonlyArray<string>) =>
    [`## ${section}`, "", header, header.replace(/[^|]+/g, " --- "), ...rows, ""].join("\n")

  const layout = (overrides: Partial<Record<keyof typeof TABLES, string>>): string =>
    (Object.keys(TABLES) as ReadonlyArray<keyof typeof TABLES>)
      .map((name) =>
        overrides[name] ?? table(TABLES[name].section, `| ${TABLES[name].columns.join(" | ")} |`, [])
      )
      .join("\n")

  it("[LEDGER-1] the reader reports a missing section, a changed header and a row with the wrong cell count", () => {
    assert.deepStrictEqual(parseLedger(layout({})).problems, [])
    const withoutScope = layout({ outOfScope: "## Notes\n" })
    assert.deepStrictEqual(parseLedger(withoutScope).problems, ['section "Out of scope" is missing'])
    const renamed = layout({ notPorted: table("Tests not ported", "| File | Describe | Title | Gap kind | Reason |", []) })
    assert.strictEqual(parseLedger(renamed).problems.length, 1)
    assert.include(parseLedger(renamed).problems[0] ?? "", "header")
    const short = layout({ outOfScope: table("Out of scope", "| Row | Subject | Decision |", ["| P15 | delta subscriptions |"]) })
    assert.deepStrictEqual(parseLedger(short).problems, ['section "Out of scope" row 1: 2 cells, the header has 3'])
  })

  it("[LEDGER-1] an escaped pipe stays inside its cell and the describe path splits on ' > '", () => {
    const text = layout({
      notPorted: table("Tests not ported", `| ${TABLES.notPorted.columns.join(" | ")} |`, [
        "| test/a.test.ts | outer > inner | maps a \\| b | missing | skipped upstream |",
        "| test/b.test.ts | — | top level | assertions | D6 |"
      ])
    })
    const { ledger, problems } = parseLedger(text)
    assert.deepStrictEqual(problems, [])
    assert.deepStrictEqual(ledger.notPorted.map(notPortedAnnotation), [
      "test/a.test.ts > outer > inner > maps a | b",
      "test/b.test.ts > top level"
    ])
  })

  it("[LEDGER-1] only D1–D20 and SD-1–SD-28 count as cited decisions", () => {
    assert.deepStrictEqual(citedDecisions("D6; SD-19 (tension with D6)"), ["D6", "SD-19", "D6"])
    assert.deepStrictEqual(citedDecisions("D21, SD-29, D0, SD-0"), [])
    assert.deepStrictEqual(decisionTokens("D21, SD-29"), ["D21", "SD-29"])
    // HARNESS-2 scans collected test files for skip modifiers, so the sample text names none.
    assert.isTrue(isUpstreamOnlyReason("skipped upstream at xstate@5.33.2"))
    assert.isTrue(isUpstreamOnlyReason("todo upstream, no body"))
    assert.isFalse(isUpstreamOnlyReason("too hard to port"))
  })
})
