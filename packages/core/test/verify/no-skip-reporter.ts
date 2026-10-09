/**
 * The guard of the default run against skipped and todo tests (HARNESS-2, D19: the port
 * allows no skipped test), and against tests that expect to fail or retry (CONF-8, AC 28).
 *
 * `vitest.config.ts` lists this reporter beside the default reporter. At the end of each run
 * it reads the tests and suites that Vitest reports, not the source text, so the form that
 * skipped a test does not matter: a modifier (`.skip`, `.todo`, `.skipIf(true)`), an options
 * object (written in the call, held by a variable, imported, returned by a call or chosen by a
 * conditional), the test API under another name, a test context's `ctx.skip()`, a name
 * pattern, or a focused test elsewhere. The same holds for `fails`, which passes a test whose
 * body fails, and `retry`, which runs a failed test again: the guard reads the options Vitest
 * resolved, so a computed member (`it[k]`), a type-asserted test API or the test API of a
 * dynamic import sets them in its sight too. When any test or suite ends skipped or todo,
 * expects to fail or retries, the reporter names each one and sets the process exit code to 1,
 * so `vitest run` fails. It does the same for each access to the retrying helper of
 * `@effect/vitest` that the flakyTest guard of the default run blocked (`flaky-test-guard.ts`
 * records each one in the meta of its test module): that helper retries an Effect inside an
 * ordinary test, so no option shows it, and a test may catch the guard's error.
 */
import type { Reporter, TestCase, TestModule, TestSuite, Vitest } from "vitest/node"

/** The first line of the guard's report. HARNESS-2 and CONF-8 find the report by it. */
export const NO_SKIP_GUARD_HEADER =
  "[no-skip guard] The default run allows no skipped, todo, expected-to-fail or retried test or suite:"

/**
 * The key of a test module's meta under which the flakyTest guard of the default run
 * (`flaky-test-guard.ts`, CONF-8) records each access to `@effect/vitest`'s retrying helper that
 * it blocked. The guard's module holds the same text (CONF-8 asserts it).
 */
export const FLAKY_TEST_META = "conf8FlakyTestAccesses"

/** The first line of the report of blocked accesses to the retrying helper. CONF-8 finds the report by it. */
export const FLAKY_TEST_GUARD_HEADER =
  "[flaky-test guard] The default run allows no test to reach the retrying helper of @effect/vitest (AC 28):"

/** Why the guard names a test or suite. */
type Kind = "skipped" | "todo" | "fails" | "retry"

/** One line of the guard's report: `<kind> <type>: <module> > <full name>`. */
const line = (kind: Kind, entity: TestCase | TestSuite): string =>
  `${kind} ${entity.type}: ${entity.module.relativeModuleId} > ${entity.fullName}`

/** The number of retries of a `retry` option: the number, or the count of a retry object. */
const retries = (retry: TestCase["options"]["retry"]): number => (typeof retry === "number" ? retry : retry?.count ?? 0)

/**
 * Why the guard names one test or suite, as lines of the report: skipped or todo when its mode
 * is skip or todo, or when it ended skipped (`skipped`); fails when its `fails` option is set;
 * retry when its `retry` option allows a retry.
 */
const linesOf = (entity: TestCase | TestSuite, skipped: boolean): ReadonlyArray<string> => [
  ...(entity.options.mode === "todo"
    ? [line("todo", entity)]
    : entity.options.mode === "skip" || skipped
    ? [line("skipped", entity)]
    : []),
  ...(entity.options.fails === true ? [line("fails", entity)] : []),
  ...(retries(entity.options.retry) > 0 ? [line("retry", entity)] : [])
]

/**
 * Each test and suite of the modules that ended skipped or todo, expects to fail or retries, as
 * lines of the report. A test ended skipped when its result is skipped (a test context's
 * `ctx.skip()` skips a test whose mode is run); a suite when its state is skipped.
 */
export const notRunIn = (testModules: ReadonlyArray<TestModule>): ReadonlyArray<string> =>
  testModules.flatMap((testModule) => [
    ...[...testModule.children.allSuites()].flatMap((suite) => linesOf(suite, suite.state() === "skipped")),
    ...[...testModule.children.allTests()].flatMap((test) => linesOf(test, test.result().state === "skipped"))
  ])

/**
 * Each access to the retrying helper that the flakyTest guard blocked in a module, as
 * `<module>: <route>` (the route the guard's error names, `it.flakyTest`): the guard throws at
 * the access and records it in the meta of the test module (`FLAKY_TEST_META`), so the run fails
 * also when a test catches the error.
 */
export const blockedRetriesIn = (testModules: ReadonlyArray<TestModule>): ReadonlyArray<string> =>
  testModules.flatMap((testModule) => {
    const recorded = (testModule.meta() as Readonly<Record<string, unknown>>)[FLAKY_TEST_META]
    const routes = Array.isArray(recorded) ? recorded.filter((entry): entry is string => typeof entry === "string") : []
    return routes.map((route) => `${testModule.relativeModuleId}: ${route}`)
  })

/**
 * The reporter that fails a run in which any test or suite ends skipped or todo, expects to fail
 * or retries, or in which the flakyTest guard blocked an access to the retrying helper.
 */
export class NoSkipReporter implements Reporter {
  private vitest: Vitest | undefined = undefined

  onInit(vitest: Vitest): void {
    this.vitest = vitest
  }

  onTestRunEnd(testModules: ReadonlyArray<TestModule>): void {
    const reports = [
      [NO_SKIP_GUARD_HEADER, notRunIn(testModules)],
      [FLAKY_TEST_GUARD_HEADER, blockedRetriesIn(testModules)]
    ] as const
    for (const [header, found] of reports) {
      if (found.length === 0) continue
      process.exitCode = 1
      const report = [header, ...found.map((entry) => `  ${entry}`)].join("\n")
      if (this.vitest === undefined) console.error(report)
      else this.vitest.logger.error(report)
    }
  }
}
