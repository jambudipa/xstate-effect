/**
 * COMPAT-1: the existing port tests and the examples keep working on the finished port.
 *
 * T8.6. SD-20 keeps the existing port test files, D15 has the examples use the XState action
 * and guard forms, and SD-8 gives `createActor` its Effect signature. This file proves:
 *
 * - the existing port test files are the twelve the port had when this SPEC started (the ten
 *   of the first implementation, `actor.test.ts` and `smoke.test.ts` of Phase 0), and the
 *   default suite collects them;
 * - every existing test passes: the file runs each `test/*.test.ts` file on the disk through
 *   the default config with Vitest's node API in this process, in worker threads (SD-1 bans a
 *   child Vitest process, as HARNESS-2 does), and asserts on the result: each file is
 *   collected and has at least one test, every test passed, no test or suite is skipped, todo,
 *   `only` or `fails`, no file or run error, and the guards of the default config report
 *   nothing. The default run also runs these files itself (SD-1 includes `test/*.test.ts`), so
 *   they run twice there; a second run of the twelve files takes a few seconds;
 * - the type check covers them and every example: `tsconfig.test.green.json` excludes no
 *   existing test file and no example (the COMPAT-1 legacy list is empty), the examples index
 *   re-exports every example module and `test/examples.test.ts` imports the index, and a
 *   TypeScript program over the examples and the existing test files has no error;
 * - every example machine runs: the root `getInitialSnapshot` gives its initial snapshot, and
 *   a live actor made by `createActor` (SD-8) starts and stops; each actor the machine invokes
 *   is replaced by a logic that never settles, so the run reaches no network, timer or console;
 * - the examples use the XState forms (D15): each name an example imports from the port is an
 *   upstream root export of the frozen manifest, so no example uses a port definition helper
 *   (`action`, `guard`, `when`) or another port extra.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { Writable } from "node:stream"
import ts from "typescript"
import { startVitest } from "vitest/node"
import * as Examples from "../../examples/index.js"
import type {
  ApplicantRequestInput,
  CollegeAppInput,
  CreditCheckInput,
  MonitorJobInput,
  PatientMonitorInput,
  ProvisionOrdersInput,
  SendCloudEventInput,
} from "../../examples/index.js"
import type { UpstreamManifest } from "../../scripts/upstream/freeze-upstream.js"
import {
  createActor,
  type EventObject,
  fromPromise,
  getInitialSnapshot,
  isStateMachine,
  type StateMachine,
} from "../../src/index.js"
import { PKG_ROOT } from "./parity.js"

/** The existing port test files (SD-20): the first implementation's ten, then Phase 0's two. */
const EXISTING_TEST_FILES: ReadonlyArray<string> = [
  "actions.test.ts",
  "actor.test.ts",
  "actorRef.test.ts",
  "actors.test.ts",
  "event.test.ts",
  "examples.test.ts",
  "guards.test.ts",
  "machine.test.ts",
  "smoke.test.ts",
  "snapshot.test.ts",
  "stateValue.test.ts",
  "testing.test.ts",
]

/** The input of each example machine whose context factory reads one. */
const INPUTS: Readonly<Record<string, unknown>> = {
  applicantRequestMachine: {
    applicant: { fname: "Ada", lname: "Lovelace", age: 36, email: "ada@example.com" },
  } satisfies ApplicantRequestInput,
  workflowCreditCheckMachine: {
    customer: {
      id: "customer-1",
      name: "Ada Lovelace",
      SSN: 123456789,
      yearlyIncome: 50000,
      address: "1 Main Street",
      employer: "Analytical Engines",
    },
  } satisfies CreditCheckInput,
  monitorJobMachine: { job: { name: "nightly-report" } } satisfies MonitorJobInput,
  patientMonitorMachine: { patientId: "patient-1" } satisfies PatientMonitorInput,
  provisionOrdersMachine: { order: { id: "order-1", item: "laptop", quantity: "1" } } satisfies ProvisionOrdersInput,
  collegeAppMachine: { applicantId: "applicant-1" } satisfies CollegeAppInput,
  sendCloudEventMachine: {
    orders: [{ id: "order-1", item: "laptop", quantity: "1" }],
  } satisfies SendCloudEventInput,
}

/** The status and state value of the initial snapshot of each machine the examples index exports. */
const INITIAL: Readonly<Record<string, readonly ["active" | "done", unknown]>> = {
  counterMachine: ["active", "active"],
  toggleMachine: ["active", "inactive"],
  toggleWithCountMachine: ["active", "inactive"],
  stopwatchMachine: ["active", "stopped"],
  simpleStopwatchMachine: ["active", "stopped"],
  fetchMachine: ["active", "idle"],
  simpleFetchMachine: ["active", "idle"],
  guisCounterMachine: ["active", {}],
  temperatureMachine: ["active", {}],
  flightBookerMachine: ["active", { scheduling: "oneWay" }],
  ticTacToeMachine: ["active", "playing"],
  snakeMachine: ["active", "New Game"],
  tilesMachine: ["active", "start"],
  triviaMachine: ["active", { homepage: "loadingData" }],
  timerMachine: ["active", "stopped"],
  todosMachine: ["active", {}],
  trafficLightMachine: ["active", "green"],
  donutMachine: ["active", "ingredients"],
  friendsListMachine: ["active", "idle"],
  creditCheckMachine: ["active", { creditCheck: "Entering Information" }],
  helloWorldMachine: ["done", "Hello State"],
  greetingMachine: ["active", "Greet"],
  mathProblemMachine: ["active", "Solve"],
  parallelExecutionMachine: ["active", { ParallelExec: { ShortDelayBranch: "active", LongDelayBranch: "active" } }],
  asyncFunctionMachine: ["active", "Send email"],
  eventGreetingMachine: ["active", "Waiting"],
  eventBasedMachine: ["active", "CheckVisaStatus"],
  asyncSubflowMachine: ["active", "Onboard"],
  onboardingMachine: ["active", "Welcome"],
  applicantRequestMachine: ["active", "CheckApplication"],
  workflowCreditCheckMachine: ["active", "CheckCredit"],
  monitorJobMachine: ["active", "SubmitJob"],
  bookLendingMachine: ["active", "Book Lending Request"],
  checkInboxMachine: ["active", "Idle"],
  carVitalsMachine: ["active", "WhenCarIsOn"],
  vitalsCheckMachine: ["active", "CheckVitals"],
  fillingWaterMachine: ["active", "AddWater"],
  autoFillingWaterMachine: ["done", "GlassFull"],
  patientMonitorMachine: ["active", "MonitorVitals"],
  roomReadingsMachine: ["active", "ConsumeReading"],
  carAuctionMachine: ["active", "StoreCarAuctionBid"],
  provisionOrdersMachine: ["active", "ProvisionOrder"],
  patientOnboardingMachine: ["active", "Idle"],
  paymentConfirmationMachine: ["active", "Pending"],
  parentPaymentMachine: ["active", "Active"],
  collegeAppMachine: ["active", "FinalizeApplication"],
  sendCloudEventMachine: ["active", "ProvisionOrdersState"],
  purchaseOrderMachine: ["active", "StartNewOrder"],
  vetAppointmentMachine: ["active", "Idle"],
  mediaScannerMachine: ["active", "idle"],
}

/**
 * One example machine: the port's widest machine type (what `isStateMachine` checks) with no
 * service requirement, as no example machine needs one.
 */
type ExampleMachine = StateMachine.StateMachine<string, unknown, EventObject, unknown, unknown, EventObject, never>

/** Every machine the examples index exports, by export name. */
const exampleMachines: ReadonlyArray<readonly [string, ExampleMachine]> = Object.entries(
  Examples as Record<string, unknown>
).flatMap(([name, value]) => (isStateMachine(value) ? [[name, value as ExampleMachine] as const] : []))

/** A logic that starts and never settles; it stands in for each actor an example invokes. */
const idleLogic = fromPromise(() => new Promise<never>(() => undefined))

/** The machine with every actor implementation it names replaced by {@link idleLogic}. */
const withIdleActors = (machine: ExampleMachine): ExampleMachine => {
  const names = Object.keys(machine.implementations.actors ?? {})
  return machine.provide({ actors: Object.fromEntries(names.map((name) => [name, idleLogic])) })
}

const readText = (path: string): string => readFileSync(join(PKG_ROOT, path), "utf8")

/** The example modules, as file names under `examples/`, without the index. */
const exampleFiles = (): ReadonlyArray<string> =>
  readdirSync(join(PKG_ROOT, "examples"))
    .filter((file) => file.endsWith(".ts") && file !== "index.ts")
    .sort()

/** The module specifiers a source file imports or re-exports. */
const specifiersOf = (path: string): ReadonlyArray<string> =>
  ts.preProcessFile(readText(path), true, true).importedFiles.map((file) => file.fileName)

/** The names one source file imports from a module specifier (type-only names included). */
const importedNames = (path: string, specifier: string): ReadonlyArray<string> => {
  const source = ts.createSourceFile(path, readText(path), ts.ScriptTarget.ES2022, false)
  return source.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return []
    if (statement.moduleSpecifier.text !== specifier) return []
    const bindings = statement.importClause?.namedBindings
    if (bindings === undefined) return ["<default or side effect>"]
    if (ts.isNamespaceImport(bindings)) return ["* as " + bindings.name.text]
    return bindings.elements.map((element) => (element.propertyName ?? element.name).text)
  })
}

/**
 * The existing port test files on the disk now, as paths from the package root
 * (`test/<name>.test.ts`), sorted: the files the default include `test/*.test.ts` collects. A
 * new file is in the list as soon as it exists.
 */
const existingTestFiles = (): ReadonlyArray<string> =>
  readdirSync(join(PKG_ROOT, "test"))
    .filter((file) => file.endsWith(".test.ts"))
    .sort()
    .map((file) => `test/${file}`)

/** What one Vitest run of the existing port test files reported. */
interface ExistingRun {
  /** The process exit code the run set: Vitest and the guards of the default config set 1. */
  readonly exitCode: string | number | null | undefined
  /** The output of the run (its reporters), for the failure messages. */
  readonly output: string
  /** The test files the run collected, as paths from the package root, sorted. */
  readonly modules: ReadonlyArray<string>
  /** The errors of a file outside its tests (an import or a collection error), as `<file>: <message>`. */
  readonly moduleErrors: ReadonlyArray<string>
  /** The errors the run reported outside every file, by message. */
  readonly unhandledErrors: ReadonlyArray<string>
  /** The number of tests the run collected in each file, by file. */
  readonly testsPerFile: Readonly<Record<string, number>>
  /** Each test that did not pass, as `<file> > <full name>: <state>` and the first line of its first error. */
  readonly notPassed: ReadonlyArray<string>
  /** Each test or suite with a mode other than `run` or with `fails`, as `<file> > <full name>: <mode>`. */
  readonly notPlain: ReadonlyArray<string>
}

/** The first line of an error message. */
const firstLine = (message: string | undefined): string => (message ?? "").split("\n")[0] ?? ""

/**
 * Runs the existing port test files as `vitest run` does (`startVitest`), with this package's
 * default config (`vitest.config.ts`: its include globs, plugins, setup file and reporters, so
 * the no-skip and pending-rewrite guards too) and the package root. As in HARNESS-2, the run
 * uses Vitest's node API in this process and worker threads instead of child processes (SD-1);
 * it writes no results cache. The process exit code is cleared before the run and restored
 * after it, so the exit code is read from this run alone and never reaches the run of this file.
 */
const runExistingTests = (files: ReadonlyArray<string>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const saved = process.exitCode
      process.exitCode = undefined
      return saved
    }),
    () =>
      Effect.promise(async (): Promise<ExistingRun> => {
        const output: Array<string> = []
        const sink = new Writable({
          write(chunk: unknown, _encoding, done) {
            output.push(String(chunk))
            done()
          }
        })
        const vitest = await startVitest(
          [...files],
          {
            config: join(PKG_ROOT, "vitest.config.ts"),
            root: PKG_ROOT,
            run: true,
            watch: false,
            pool: "threads",
            maxWorkers: 2,
            cache: false
          },
          {},
          { stdout: sink, stderr: sink }
        )
        const testModules = vitest.state.getTestModules()
        const tests = testModules.flatMap((testModule) => [...testModule.children.allTests()])
        const suites = testModules.flatMap((testModule) => [...testModule.children.allSuites()])
        return {
          exitCode: process.exitCode,
          output: output.join(""),
          modules: testModules.map((testModule) => testModule.relativeModuleId).sort(),
          moduleErrors: testModules.flatMap((testModule) =>
            testModule.errors().map((error) => `${testModule.relativeModuleId}: ${firstLine(error.message)}`)
          ),
          unhandledErrors: vitest.state.getUnhandledErrors().map((error) => firstLine(String(error))),
          testsPerFile: Object.fromEntries(
            testModules.map((testModule) => [testModule.relativeModuleId, [...testModule.children.allTests()].length])
          ),
          notPassed: tests.flatMap((test) => {
            const result = test.result()
            return result.state === "passed"
              ? []
              : [`${test.module.relativeModuleId} > ${test.fullName}: ${result.state} ${firstLine(result.errors?.[0]?.message)}`.trim()]
          }),
          notPlain: [...tests, ...suites].flatMap((task) =>
            task.options.mode === "run" && task.options.fails !== true
              ? []
              : [`${task.module.relativeModuleId} > ${task.fullName}: ${task.options.fails === true ? "fails" : task.options.mode}`]
          )
        }
      }),
    (saved) =>
      Effect.sync(() => {
        process.exitCode = saved
      })
  )

describe("COMPAT-1 The existing port tests and examples keep working", () => {
  it.effect("[COMPAT-1] the existing port test files are all present and the default suite collects them", () =>
    Effect.sync(() => {
      const present = readdirSync(join(PKG_ROOT, "test"))
        .filter((file) => file.endsWith(".test.ts"))
        .sort()
      assert.deepStrictEqual(present, [...EXISTING_TEST_FILES])
      assert.include(readText("vitest.config.ts"), `include: ["test/*.test.ts", "test/verify/**/*.spec.ts"]`)
    }))

  it.effect("[COMPAT-1] the type check excludes no existing test file and no example", () =>
    Effect.sync(() => {
      const green = JSON.parse(readText("tsconfig.test.green.json")) as { readonly exclude: ReadonlyArray<string> }
      const legacy = JSON.parse(readText("test/verify/fixtures/green-exclude-compat-1.json")) as ReadonlyArray<unknown>
      assert.deepStrictEqual(legacy, [])
      for (const path of green.exclude) {
        assert.isFalse(path.startsWith("examples"), `${path} hides an example from the type check`)
        assert.isFalse(/^test\/[^/]+\.test\.ts$/.test(path), `${path} hides an existing test file from the type check`)
      }
      // tsc reaches the examples through the imports of the test files: the index re-exports
      // every example module, and the examples test imports the index.
      const reExported = specifiersOf("examples/index.ts")
        .map((specifier) => specifier.replace(/^\.\//, "").replace(/\.js$/, ".ts"))
        .sort()
      assert.deepStrictEqual(reExported, [...exampleFiles()])
      assert.include(specifiersOf("test/examples.test.ts"), "../examples/index.js")
    }))

  it.effect("[COMPAT-1] a TypeScript program over the examples and the existing test files has no error", () =>
    Effect.sync(() => {
      const parsed = ts.getParsedCommandLineOfConfigFile(join(PKG_ROOT, "tsconfig.test.json"), {}, {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: () => undefined,
      })
      assert.isDefined(parsed)
      const rootNames = [
        ...exampleFiles().map((file) => join(PKG_ROOT, "examples", file)),
        join(PKG_ROOT, "examples", "index.ts"),
        ...EXISTING_TEST_FILES.map((file) => join(PKG_ROOT, "test", file)),
      ]
      // The options of the gate's type check (`declaration` stays on, so a type of an exported
      // example that cannot be named, TS4023, is an error here as it is in `pnpm typecheck`).
      const program = ts.createProgram({ rootNames, options: { ...parsed?.options, noEmit: true } })
      const errors = ts
        .getPreEmitDiagnostics(program)
        .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
        .map((diagnostic) => {
          const where = diagnostic.file?.fileName.replace(PKG_ROOT, "") ?? "<config>"
          return `${where}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n").split("\n")[0]}`
        })
      assert.deepStrictEqual(errors, [])
    }), 60_000)

  it.effect("[COMPAT-1] every example machine gives its initial snapshot through the root getInitialSnapshot", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(exampleMachines.map(([name]) => name).sort(), Object.keys(INITIAL).sort())
      for (const [name, machine] of exampleMachines) {
        const [status, value] = INITIAL[name] ?? ["active", undefined]
        const snapshot = yield* getInitialSnapshot(machine, INPUTS[name])
        assert.strictEqual(snapshot.status, status, name)
        assert.deepStrictEqual(snapshot.value, value, name)
      }
    }))

  it.effect("[COMPAT-1] every example machine starts and stops in a live actor made by createActor (SD-8)", () =>
    Effect.gen(function* () {
      for (const [name, machine] of exampleMachines) {
        const [status, value] = INITIAL[name] ?? ["active", undefined]
        const [started, stopped] = yield* Effect.scoped(
          Effect.gen(function* () {
            const actor = yield* createActor(withIdleActors(machine), { input: INPUTS[name] })
            yield* actor.start
            const afterStart = yield* actor.getSnapshot
            yield* actor.stop
            const afterStop = yield* actor.getSnapshot
            return [afterStart, afterStop] as const
          })
        )
        assert.strictEqual(started.status, status, `${name} after start`)
        assert.deepStrictEqual(started.value, value, `${name} after start`)
        assert.strictEqual(stopped.status, status === "done" ? "done" : "stopped", `${name} after stop`)
      }
    }))

  it.effect("[COMPAT-1] the examples import only upstream root exports from the port (D15)", () =>
    Effect.sync(() => {
      const manifest = JSON.parse(readText("test/upstream/upstream-manifest.json")) as UpstreamManifest
      const root = manifest.exports["."]
      assert.isDefined(root)
      const upstream = new Set([...(root?.values ?? []), ...(root?.types ?? [])])
      for (const file of exampleFiles()) {
        const path = `examples/${file}`
        for (const specifier of specifiersOf(path)) {
          assert.include(["effect", "../src/index.js"], specifier, `${path} imports ${specifier}`)
        }
        for (const name of importedNames(path, "../src/index.js")) {
          assert.isTrue(upstream.has(name), `${path} imports ${name}, which is not an upstream root export`)
        }
      }
    }))

  it.effect("[COMPAT-1] every existing port test passes: a run of each test/*.test.ts file through the default config passes every test, skips none, and finds at least one test in each file", () =>
    Effect.gen(function* () {
      const files = existingTestFiles()
      assert.isAbove(files.length, 0, "the package has existing port test files")
      const run = yield* runExistingTests(files)
      assert.deepStrictEqual(run.modules, files, `the run collects each existing test file and no other\n${run.output}`)
      assert.deepStrictEqual(run.moduleErrors, [], "no existing test file fails outside its tests")
      assert.deepStrictEqual(run.unhandledErrors, [], "the run reports no unhandled error")
      assert.deepStrictEqual(
        files.filter((file) => (run.testsPerFile[file] ?? 0) < 1),
        [],
        "each existing test file has at least one test"
      )
      assert.deepStrictEqual(run.notPassed, [], "every existing test passes")
      assert.deepStrictEqual(run.notPlain, [], "no existing test or suite is skipped, todo, only or fails")
      assert.include([undefined, 0], run.exitCode, `the run exits 0 and the guards of the default config report nothing\n${run.output}`)
    }), 60_000)
})
