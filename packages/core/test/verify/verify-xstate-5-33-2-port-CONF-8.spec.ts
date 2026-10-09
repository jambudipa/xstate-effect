/**
 * CONF-8: all 74 upstream files are imported and pass, and no test is skipped (SD-1, SD-2,
 * SD-3, SD-22, D1, D19; goal ACs 6, 28 and 37).
 *
 * The file imports the one rewrite whose ledger green phase is 8, typeHelpers, inside its
 * describe block `upstream/typeHelpers.test.ts`, so every upstream test of the file runs once,
 * inside the default run, and its evidence routes to CONF-8. `conformancePhase`
 * (`conformance.ts`) keeps the block and its checks in declaration order, also under
 * `--sequence.shuffle`:
 *
 * - the graduation check: typeHelpers has left `pending.json` and the green type-check exclude
 *   (one commit, SD-1), and the ledger marks it `passes`;
 * - the import check: the file imports exactly typeHelpers (the ledger's one green-phase 8
 *   file), and no other CONF evidence file imports it;
 * - the count check, last: `passed >= runnable - notPortedRunnable` and `passed >= 1`, no
 *   skipped test, and no test still to run (10 runnable upstream tests, a floor of 10).
 *
 * typeHelpers.test.ts checks the type helpers (`ContextFrom`, `EventFrom` with and without
 * its event-type argument, `MachineImplementationsFrom`, `StateValueFrom`, `SnapshotFrom`,
 * `ActorRefFrom`, the tags of a machine). Its assignability checks and its 8
 * `@ts-expect-error` lines are proved by the green type check (`tsconfig.test.green.json`),
 * which reads the file from its graduation on; its 10 tests run here.
 *
 * The block "all 74 upstream files run once, and no test is skipped" checks the whole port
 * (AC 28):
 *
 * - the CONF-2 to CONF-8 evidence files together import each of the 74 files of the frozen
 *   manifest (58 core, 6 examples, 10 graph) exactly once, matched by name, and no other file
 *   under `test/` imports one of the 74 rewrites, so each upstream test runs once;
 * - `test/upstream/pending.json` is empty and the green type check excludes no file;
 * - the scan's list holds every TypeScript or JavaScript file under `test/`, in dot folders, dot
 *   files and `test/verify/fixtures/` too (whose text fixtures are no script modules), and so
 *   every file that the default config's include collects: Vitest itself names those files
 *   (its node API, no run), and a collected file that the list does not hold fails CONF-8.
 *   Fixtures prove it on a package root with a dot folder, a dot file and a spec under
 *   `test/verify/fixtures/`, and prove that a list without them fails the check;
 * - the list holds every script module of the repository checkout that holds the package,
 *   whatever reaches it (`repositoryModuleList` of `skip-scan.ts`; the sixth Layer-3 review): each
 *   one of git's file list from the repository root (the tracked files, and the untracked files
 *   that git does not ignore), each one of the package folder, also one that git ignores, but for
 *   the folders of `UNLISTED_FOLDERS` (the git-ignored `.upstream`, `.delivery`, `dist` and
 *   `.markdown-code-check`, which hold no source of the package), each one of a `node_modules`
 *   folder that is no installed dependency (pnpm's store holds the dependencies), and every module
 *   that one of them reaches by import outside that set (through the import walk that HARNESS-2
 *   runs): a module outside the repository or in an ignored folder, reached by a static or
 *   dynamic import, a re-export, a require, `vi.mock`, an absolute specifier, or a bare specifier
 *   that names a package outside the dependency store. A copy without git fails. The walk reads
 *   every import on the way: an import whose specifier is not a string literal, an
 *   `import.meta.glob`, a `#` specifier, a URL specifier, a package that no `node_modules` folder
 *   holds or that lies outside the repository, each reference to a loader that is not a direct
 *   call with a literal specifier (a destructuring, an element access, an alias, `.call` /
 *   `.apply` / `.bind`, `Reflect.apply`, a loader or a holder of one passed on), and each
 *   reference to an API that loads or runs code (`node:vm`, `eval`, the `Function` constructor,
 *   Vite's and Vitest's module runners, the module system's hooks) fail CONF-8, but for the
 *   allowed problems of the cleanup CLI, two hook and drafting scripts, and the generated
 *   programs of the eque2-code skills, which no test module reaches, and the pinned uses of
 *   `skip-scan.ts` (`PINNED_LOADERS`). Each of those allowances names its file by exact path and
 *   applies only where the list holds the file (not where the file merely exists on disk: a file
 *   that git ignores is in the list only when a module of the list reaches it), and a file that
 *   the list holds must show exactly its allowed problems: a fixture repository without
 *   `.claude/`, `.agents/` and `_bmad-output/` (a public clone) passes with the cleanup CLI's
 *   allowance alone, and so does one whose `.gitignore` ignores those folders while their files
 *   exist on disk. Fixtures prove it with the fourth
 *   Layer-3 review's helper in `scripts/` that holds `Reflect.get(it, "flakyTest")` for a spec to
 *   retry with, a helper on each other route, the fifth review's N1, N2, N3, N5 and N4b and the
 *   other shapes of a loader reference, and the sixth review's B1, B3, V1 and K1 with the module
 *   outside the package folder or outside the repository;
 * - the syntax-tree scan of `skip-scan.ts` reads every file of that list and finds no skip, skipIf,
 *   runIf, todo, only, fails or flakyTest member on any chain of the test API (`it`, `test`,
 *   `describe`, `suite`, `it.effect`, `it.live`, `it.prop`, `it.layer`, `it.each`,
 *   `it.concurrent`) or of an alias of it (a require from `createRequire` and an object that
 *   wraps the test API too), no import of `flakyTest`, no re-export of a modifier and no
 *   `export *` of `vitest` or `@effect/vitest`, no call of a test context's skip, and no skip,
 *   todo, only, fails or retry option. A case of fixtures proves that the scan finds each form
 *   on each chain;
 * - no module of that list names `flakyTest`, which no run-time check sees (it retries an Effect
 *   inside an ordinary test): no identifier has the name, whatever route reaches it (a member,
 *   an import, a re-export, a destructuring), and only the scan's own source and this file, by
 *   exact path, hold it in a string or a template. Fixtures prove that the check finds the
 *   name on each route of the Layer-3 reviews, and not in a longer name or a comment. The same
 *   two files alone hold a string whose whole text is the name of a loader (`createRequire`,
 *   `importActual`, a name of the runner's own loaders): a key that reaches it at run time;
 * - the default run blocks every access to flakyTest at run time: the default config gives the
 *   flakyTest guard (`flaky-test-guard.ts`) in place of `@effect/vitest`, through Vite's alias of
 *   the exact specifier and the Node resolve hook of its setup file, so a key assembled at run
 *   time, a helper that the scan cannot read or a load through Node's own loader meets a
 *   `flakyTest` and an `it.flakyTest` that throw; the guard records each access, and the no-skip
 *   guard's reporter names it and fails the run, also when a test catches the error. Fixture
 *   runs through the default config prove it for each route (directly, an assembled key, an
 *   extensionless helper, a `?query` import, `createRequire`, the entry module's path, a layer
 *   block's methods), and the one run without the guards (`runUnguarded` of `vitest-runs.ts`,
 *   which CONF-8 alone may take) proves each route live;
 * - every Vitest config of the repository (the package's two configs) gives the flakyTest guard:
 *   its alias, and its setup file (`flaky-test-setup.ts`), whose Node resolve hook passes on only
 *   the guard's own ES import of the package's entry module and the package's own relative
 *   imports (never a require, whatever base a test gives it), refuses a builtin that loads or
 *   spawns code to each importer outside the dependency store, and puts guards on the members of
 *   `process` that load or spawn code. Fixture runs prove it for the eighth Layer-3 review's G14,
 *   G22 and G23, a nested run through the upstream config (G16r) and two builtin refusals;
 * - default deny (the eighth Layer-3 review): a module that a test module or a Vitest config
 *   reaches imports only allowlisted modules (a path, effect, the test API, the package itself,
 *   the pure builtins, and the libraries that `ALLOWED_PACKAGES` of `skip-scan.ts` names), and
 *   only a harness module of `CAPABILITY_HOLDERS`, by exact path and pinned by its whole source
 *   (`capability-pins.json`, whose every pin this file checks with a hash of its own), holds a
 *   capability: a builtin that loads or spawns code (`node:child_process`,
 *   `node:worker_threads`, `node:vm`, a hook of `node:module`, ...), Vitest's node API, ESLint, a
 *   member of `process` that loads or spawns code, or the module loaders of TypeScript; a value
 *   import of a holder whose exports run git, a nested Vitest run or a child Node process is a
 *   capability too. A `createRequire` takes only the module's own `import.meta.url` (or
 *   `import.meta.filename`) as its base; BASELINE-1's resolver from the package folder holds by
 *   its exact text while its whole source holds. Fixtures prove it with G14, G16r, G17r, G18r,
 *   G22 and G23, each form of a capability, and plants inside pinned harness modules;
 * - no Vitest configuration of the package sets `retry`, no package script passes it, and the
 *   default config runs the no-skip guard (`no-skip-reporter.ts`) beside the default reporter,
 *   so the default run fails when any test or suite ends skipped or todo: its summary shows 0
 *   skipped and 0 todo whenever it passes (HARNESS-2 proves the guard on fixture runs);
 * - the same guard fails the default run when any test expects to fail (`fails`) or retries
 *   (`retry`), whatever form set it, since it reads the options Vitest resolved: a test whose
 *   body fails never passes the default run. Fixture runs through the default config, in worker
 *   threads (SD-1, `vitest-runs.ts`), prove it for the routes that a source scan cannot read
 *   (`it[k]`, `(it as any).fails`, the test API of `await import("vitest")`), the options, the
 *   `@effect/vitest` API and a suite's retry; without the guard Vitest passes each of them;
 * - no file of `src/` relaxes a rule of the canonical Effect bundle, and the one lint exception
 *   of `src/` is SD-22's (AC 37; owner, 2026-10-08: "Every file ON. All rules."). ESLint
 *   resolves the config of each file: every file of `src/` resolves each rule of the canonical
 *   bundle (the keys of `effectRulesPlugin.rules` in `eslint-rules/effect-rules.mjs`) at error,
 *   and the strict rules of the `src/` probe in all else, but for one pinned difference:
 *   `@typescript-eslint/no-explicit-any`, a rule outside the canonical bundle, is off in
 *   `src/internal/anyEventObject.ts` (upstream's `any`, SD-22 amendments of 2026-10-06 and
 *   2026-10-07). A test file resolves the relaxed test block (plus the timer ban in
 *   `test/upstream/`); a script resolves the relaxed scripts block; and the config ignores no
 *   file of `src/`, `test/` or `scripts/`. The lint checks read the same kind of list as the
 *   scan: every script module of the three folders, in dot folders and `test/verify/fixtures/`
 *   too. A case of fixture blocks proves that the check names each kind of exception, a
 *   canonical rule relaxed in the pinned file or in a file that an earlier SD-3 or SD-22 block
 *   named among them, also for a file in a dot folder or under `test/verify/fixtures/`;
 * - no comment can make a lint exception (SD-3: no inline disable comments). Each file of
 *   `src/`, `test/` and `scripts/` resolves `linterOptions.noInlineConfig`, so ESLint ignores
 *   every directive comment in it (and warns about it), and no such file holds one: ESLint
 *   itself finds the directive comments (`eslint-disable`, `eslint-disable-line`,
 *   `eslint-disable-next-line`, `eslint-enable`, `eslint <rule>: ...`, `eslint-env`, `global`,
 *   `globals`, `exported`). Fixtures prove that the check finds each directive form and no
 *   such text in a string, a template or a JSDoc comment, also in a file in a dot folder or
 *   under `test/verify/fixtures/`, and that a planted `eslint-disable-next-line` above a throw
 *   in a `src/` file leaves both lint errors.
 */
import { assert, describe, it, vi } from "@effect/vitest"
import { Effect, Exit } from "effect"
import { ESLint, Linter } from "eslint"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import tseslint from "typescript-eslint"
import { pathToFileURL } from "node:url"
import defaultConfig from "../../vitest.config.js"
import upstreamConfig from "../../vitest.upstream.config.js"
import { checkImportedOnce, confEvidenceSources, conformancePhase, greenFiles, requiredPassed, upstreamFileOptions } from "./conformance.js"
import { shortName } from "./ledger.js"
import { FLAKY_TEST_META, NoSkipReporter } from "./no-skip-reporter.js"
import { PKG_ROOT, readLedger, readManifest } from "./parity.js"
import {
  CAPABILITY_HOLDERS,
  capabilityProblems,
  CONFIG_FILE,
  configAliasProblems,
  fixtureGit,
  isAliasInPackage,
  moduleFacts,
  type ModuleList,
  modulesReachedByTests,
  PINNED_LOADERS,
  PINS_FILE,
  repositoryModuleList,
  repositoryScriptModules,
  SCRIPT_EXTENSIONS,
  scanModules,
  scriptModules,
  walkCandidates,
  walkImports
} from "./skip-scan.js"
import { collectedFiles, fixtureRoot, PACKAGE_CONFIGS, resolvedAliases, runUnguarded, runWithConfig } from "./vitest-runs.js"

// ---------------------------------------------------------------- the imported file

conformancePhase(8, () => {
  describe("upstream/typeHelpers.test.ts", upstreamFileOptions(), async () => {
    await import("../upstream/typeHelpers.test.js")
  })
})

// ---------------------------------------------------------------- the shape of the suite and its count floor

const SUITE_TITLE = "[CONF-8] upstream files green at phase 8"

describe("[CONF-8] the CONF-8 suite and its count floor", () => {
  it("[CONF-8] the suite imports typeHelpers, the one file green at phase 8, then runs the graduation, import and count checks, the count check last, and never shuffles its own children", ({ task }) => {
    const suite = task.file.tasks.find((child) => child.name === SUITE_TITLE)
    assert.strictEqual(suite?.type, "suite")
    const children = suite?.type === "suite" ? suite.tasks : []
    assert.deepStrictEqual(children.map((child) => [child.type, child.name]), [
      ["suite", "upstream/typeHelpers.test.ts"],
      ["test", "[CONF-8] each imported rewrite has left pending.json and the green type-check exclude, and the ledger marks it passes"],
      ["test", "[CONF-8] the evidence file imports exactly the upstream files green at phase 8, and no other CONF evidence file imports them"],
      ["test", "[CONF-8] every imported file meets its count"]
    ])
    assert.strictEqual(suite?.type === "suite" ? suite.shuffle : undefined, false)
  })

  it.effect("[CONF-8] typeHelpers, the one file green at phase 8, has 10 runnable upstream tests and a floor of 10 passed", () =>
    Effect.sync(() => {
      const { ledger, problems } = readLedger()
      assert.deepStrictEqual(problems, [])
      const manifest = readManifest()
      // [name, runnable, upstream skip + todo, "Tests not ported" rows, required passed]
      const floors = greenFiles(ledger.files, 8).map((row) => {
        const name = row["Name"] ?? ""
        const upstream = manifest.files.find((file) => shortName(file.path) === name)
        if (upstream === undefined) return [name]
        const rows = ledger.notPorted.filter((notPorted) => notPorted["File"] === upstream.path).length
        return [name, upstream.runnable, upstream.skip + upstream.todo, rows, requiredPassed(upstream, ledger.notPorted)]
      })
      assert.deepStrictEqual(floors, [["typeHelpers", 10, 0, 0, 10]])
    }))
})

// ---------------------------------------------------------------- the whole port (AC 28)

/** The CONF evidence files, one per green phase. */
const CONF_FILES = [2, 3, 4, 5, 6, 7, 8].map((phase) => `verify-xstate-5-33-2-port-CONF-${phase}.spec.ts`)

/**
 * The folder of the text fixtures (`*.ts.txt`, `*.json`): source text that the checks read as
 * data. No name there ends in a script extension, so the lists below hold none of them; a script
 * module there is listed like any other, since the default config collects a spec there.
 */
const FIXTURES = "test/verify/fixtures/"

/** A file exists at the absolute path (a link to a file counts). */
const isFile = (absolute: string): boolean => existsSync(absolute) && statSync(absolute).isFile()

/**
 * The script modules under `test/` of a package root (`scriptModules` of `skip-scan.ts`: dot
 * folders, dot files, `test/verify/fixtures/` and linked folders too). A file that it would still
 * miss, the check that the list holds every file the default config collects names.
 */
const testModules = (root: string = PKG_ROOT): ReadonlyArray<string> => scriptModules("test", root)

/** The source of a file of a package root, or undefined when no such file exists. */
const readPackageFile = (path: string, root: string = PKG_ROOT): string | undefined => {
  const absolute = join(root, path)
  return isFile(absolute) ? readFileSync(absolute, "utf8") : undefined
}

/**
 * The list that the scan, the name checks and the importer check read (`paths`, relative to the
 * package root), and each import or loader reference that the list cannot follow (`problems`):
 * every script module of the repository checkout that holds the package, whatever reaches it,
 * and every module outside it that one of them reaches by import (`repositoryModuleList` of
 * `skip-scan.ts`, through the import walk that HARNESS-2 runs).
 */
const scanList = (root: string = PKG_ROOT): ModuleList => repositoryModuleList(root, (path) => readPackageFile(path, root))

/**
 * The files that the default config's include collects in a package root, as `vitest run`
 * collects them (`collectedFiles` of `vitest-runs.ts`: Vitest's own glob of the include and
 * exclude globs, through Vitest's node API in this process, SD-1). Paths relative to the root,
 * sorted. No test runs.
 */
const collectedByDefaultConfig = (root: string) => collectedFiles(root)

/** Each collected file that a list of the scan does not hold, as a problem. */
const notListed = (collected: ReadonlyArray<string>, listed: ReadonlyArray<string>): ReadonlyArray<string> =>
  collected.filter((path) => !listed.includes(path)).map((path) => `${path}: the default config collects it, and the scan does not read it`)

/** A spec in a dot folder and one under `test/verify/fixtures/`: the default config collects both (the third Layer-3 review). */
const DOT_FOLDER_SPEC = "test/verify/.probe/zz-probe.spec.ts"
const FIXTURES_SPEC = "test/verify/fixtures/zz-probe.spec.ts"

/** A spec that retries with a helper outside test/ (the fourth Layer-3 review). */
const ZZ_USER_SPEC = "test/verify/zz-user.spec.ts"

/** A test file that skips nothing and names no modifier. */
const CLEAN_SPEC = `import { assert, it } from "@effect/vitest"\nit("x", () => {\n  assert.isTrue(true)\n})\n`

const readJson = <A>(relative: string): A => JSON.parse(readFileSync(join(PKG_ROOT, relative), "utf8")) as A

/**
 * The files that may hold the name flakyTest in a string or a template, or a string that is the
 * name of a loader, by exact path: the flakyTest guard of the default run (the key it blocks, and
 * the name under which it exports its throwing stand-in, a string so that no identifier has the
 * name), the scan's own source (its lists of modifiers and loaders) and this file (its fixtures
 * and test names). No file may name flakyTest in code.
 */
const FLAKY_TEST_TEXT_FILES: ReadonlyArray<string> = [
  "test/verify/flaky-test-guard.ts",
  "test/verify/skip-scan.ts",
  "test/verify/verify-xstate-5-33-2-port-CONF-8.spec.ts"
]

/**
 * The strings beyond those files whose whole text is the name of a loader, by exact text:
 * DELIVERY-1 checks that no built file of the package calls `eval` or the `Function` constructor,
 * and names the two in that check (`name === "eval" || name === "Function"`); it reads them from
 * a built file's syntax tree, and calls neither.
 */
const ALLOWED_LOADER_TEXTS: ReadonlyArray<string> = [
  `test/verify/verify-xstate-5-33-2-port-DELIVERY-1.spec.ts:126 "eval"`,
  `test/verify/verify-xstate-5-33-2-port-DELIVERY-1.spec.ts:126 "Function"`
]

/**
 * The walk problems of the repository that CONF-8 allows, by exact text, each in a module that no
 * test module reaches (`assertAllowedWalkProblems` asserts it), so the default run never runs it:
 * - the cleanup CLI (`pnpm clean`, `scripts/clean.ts`) loads the user's `clean.config.ts` from
 *   the working folder by a path it builds, so no literal can name it;
 * - the docs gate (`pnpm run docs:audit`, `scripts/docs-audit.mjs`, a byte-identical copy of the
 *   enforce-code-docs skill's asset) loads the audited repository's own TypeScript through a
 *   `createRequire` of that repository's `package.json`, a path it builds from its root argument,
 *   so no literal can name it; only its own `node --test` file (`scripts/docs-audit.test.mjs`)
 *   imports it, and Vitest collects neither;
 * - the TEA enforcement hook of the BMad skills (`tea-enforce.cjs`, in `.claude/skills/` and its
 *   copy in `.agents/skills/`) runs its main function only when Node runs it as the main module
 *   (`require.main === module`), as Claude Code runs a hook;
 * - the goal's drafting script for upstream rewrites (`draft-rewrite.mts`, run by hand with
 *   `node`) loads TypeScript from the package by an absolute path (`createRequire` of the
 *   package's `package.json`), so no `node_modules` folder above it holds `typescript`.
 *
 * Each allowance names its file by exact path and applies only where the list that the scan
 * reads holds that file (`allowedWalkProblems`), not where the file merely exists on disk: git's
 * file list leaves out a file that git ignores, so the walk reads it only when a module of the
 * list reaches it. A public clone holds no `.claude/`, `.agents/` or `_bmad-output/` folder, and
 * a checkout whose `.gitignore` ignores them lists none of their files, so there the allowances
 * of the package's own scripts (the cleanup CLI's and the docs gate's) are the only ones. A file
 * that the list holds must show exactly its allowed problems, and no allowance covers a file it
 * does not name.
 */
const CLEAN_CLI = "scripts/clean.ts"
const DOCS_GATE = "scripts/docs-audit.mjs"
const TEA_HOOKS = [".claude", ".agents"].map((folder) => `../../${folder}/skills/bmad-testarch-framework/resources/hooks/tea-enforce.cjs`)
const DRAFT_SCRIPT = "../../_bmad-output/goals/xstate-5-33-2-port.goal/orchestrator/draft-rewrite.mts"
const WALK_PROBLEM_ALLOWANCES: ReadonlyArray<readonly [file: string, problems: ReadonlyArray<string>]> = [
  ...TEA_HOOKS.map((hook) => [hook, [
    `${hook}:1073 require is a loader reference that the walk cannot follow`,
    `${hook}:1073 module is a loader reference that the walk cannot follow`
  ]] as const),
  [DRAFT_SCRIPT, [
    `${DRAFT_SCRIPT}:14 createRequire(ROOT + "/package.json") is a loader reference that the walk cannot follow`,
    `${DRAFT_SCRIPT}: "typescript" names a package that no node_modules folder holds`
  ]],
  [CLEAN_CLI, [`${CLEAN_CLI}:296 import(configPath) names a module the walk cannot read`]],
  [DOCS_GATE, [`${DOCS_GATE}:77 createRequire(join(root, 'package.json')) is a loader reference that the walk cannot follow`]]
]

/** The allowed walk problems of a list: the allowances whose files the list holds. */
const allowedWalkProblems = (list: ModuleList): ReadonlyArray<string> =>
  WALK_PROBLEM_ALLOWANCES.filter(([file]) => list.paths.includes(file)).flatMap(([, problems]) => problems)

/**
 * The generated programs of the repository, by exact path: the bundled scripts of the eque2-code
 * skills (`.claude/skills/` and its copy in `.agents/skills/`): the state, tests and Xray CLIs,
 * the Xray server and the slide-deck tool. Each is one esbuild bundle of its program with its
 * libraries inlined (effect, ajv, a YAML and a Markdown parser), which the agents run from the
 * command line, never a test module. Their libraries' local functions named `test` or `it` read
 * as the test API to the scan, and their own uses of `eval`, `Function` and a function's
 * `constructor` (ajv compiles a schema with `new Function`) read as loaders. Their skip forms,
 * walk problems and loader-name strings are allowed, while no test module reaches one of them
 * (`assertAllowedWalkProblems`); the name check reads them like every module. Like the walk
 * allowances, each path applies only where the list holds its file (a public clone holds none,
 * and git's file list leaves out each one that git ignores).
 */
const GENERATED_PROGRAMS: ReadonlyArray<string> = [".claude", ".agents"].flatMap((folder) => [
  ...["state", "tests-cli", "xray-cli", "xray-server"].map((name) => `../../${folder}/skills/eque2-code-setup/scripts/${name}.mjs`),
  `../../${folder}/skills/eque2-code-slidedeck/scripts/slidedeck.mjs`
])

/** The finding (`<file>:<line> <code>` or `<file>: ...`) is one of a generated program. */
const inGeneratedProgram = (found: string): boolean =>
  GENERATED_PROGRAMS.some((path) => found.startsWith(`${path}:`))

/**
 * The list's walk problems are the allowed ones of the files it holds (`allowedWalkProblems`, and
 * those of the generated programs), each allowed file and generated program that the
 * repository's script-module list holds (`repositoryScriptModules`: git's file list, which leaves
 * out a file that git ignores) is in the list, and no test module or Vitest config file reaches a
 * module that holds an allowed problem or a generated program.
 */
const assertAllowedWalkProblems = (list: ModuleList, root: string = PKG_ROOT): void => {
  const allowedFiles = [...GENERATED_PROGRAMS, ...TEA_HOOKS, DRAFT_SCRIPT, CLEAN_CLI, DOCS_GATE]
  assert.deepStrictEqual(list.problems.filter((problem) => !inGeneratedProgram(problem)).sort(), [...allowedWalkProblems(list)].sort())
  const repository = repositoryScriptModules(root).paths
  assert.includeMembers([...list.paths], allowedFiles.filter((path) => repository.includes(path)))
  const reached = walkImports([...testModules(root), "vitest.config.ts", "vitest.upstream.config.ts"], [], (path) => readPackageFile(path, root), root).visited
  for (const path of allowedFiles) {
    assert.notInclude(reached, path, `a test module reaches ${path}`)
  }
}

/** The code of a found form, without its `<file>:<line> ` prefix. */
const codeOf = (found: string): string => found.slice(found.indexOf(" ") + 1)

/**
 * Runs git in a fixture folder (`fixtureGit` of `skip-scan.ts`: without the caller's `GIT_*`
 * variables, so git finds the repository from the folder, and with no fsmonitor and no hooks),
 * and fails the test when git fails: `git init -q` makes a fixture folder the root of a
 * repository checkout, `git add` tracks a file in it.
 */
const git = (cwd: string, args: readonly ["init", "-q"] | readonly ["add", string]): void => {
  const result = fixtureGit(cwd, args)
  assert.strictEqual(result.status, 0, `git ${args.join(" ")} in a fixture folder: ${result.stderr}`)
}

/** The cleanup CLI's walk problem, which its allowance names by exact text. */
const CLEAN_ALLOWANCE = `${CLEAN_CLI}:296 import(configPath) names a module the walk cannot read`

/**
 * A fixture repository with the layout of the public repository: the package in packages/core/
 * with the real cleanup CLI and a clean spec, the packages the CLI imports (links to this
 * package's installed dependencies), the repository's `.gitignore` (by default, `node_modules/`
 * alone), and no .claude/, .agents/ or _bmad-output/ folder but for the files that a case plants
 * (paths from the package root). Each call makes a fresh copy, and returns its package root.
 */
const publicClone = (planted: ReadonlyArray<readonly [string, string]>, gitignore: string = "node_modules/\n") =>
  Effect.gen(function* () {
    const base = yield* fixtureRoot([
      ["repo/.gitignore", gitignore],
      [`repo/packages/core/${CLEAN_CLI}`, readFileSync(join(PKG_ROOT, CLEAN_CLI), "utf8")],
      ["repo/packages/core/test/verify/zz-public.spec.ts", CLEAN_SPEC],
      ...planted.map(([path, source]) => [`repo/packages/core/${path}`, source] as const)
    ])
    const root = join(base, "repo", "packages", "core")
    mkdirSync(join(root, "node_modules", "@anthropic-ai"), { recursive: true })
    for (const dependency of ["typescript", "eslint", "@anthropic-ai/claude-agent-sdk", "commander", "cli-progress"]) {
      symlinkSync(join(PKG_ROOT, "node_modules", dependency), join(root, "node_modules", dependency), "dir")
    }
    git(join(base, "repo"), ["init", "-q"])
    return root
  })

/**
 * The walk problems of one in-memory module (its path `test/verify/zz-probe.spec.ts`; each other
 * module it names by a path is an empty module): the code of each loader reference, and each other
 * problem as it is.
 */
const LOADER_PROBE = "test/verify/zz-probe.spec.ts"
const loaderProblems = (source: string): ReadonlyArray<string> => {
  const suffix = " is a loader reference that the walk cannot follow"
  return walkImports([LOADER_PROBE], [], (path) => (path === LOADER_PROBE ? source : "")).problems
    .map((problem) => (problem.endsWith(suffix) ? codeOf(problem.slice(0, -suffix.length)) : problem))
}

/** The skip forms of one fixture module, by code. */
const formsIn = (source: string): ReadonlyArray<string> => {
  const path = "test/verify/conf-8-fixture.spec.ts"
  return scanModules([path], (candidate) => (candidate === path ? source : undefined)).flatMap((scan) => scan.forms.map(codeOf))
}

/**
 * Each import of one of the manifest's rewrites by a module that is not a CONF evidence file,
 * as `<importer> imports <rewrite>`. The module specifiers of each scanned module are resolved
 * as the import walk of HARNESS-2 resolves them (`walkCandidates`).
 */
const otherImporters = (
  scans: ReadonlyArray<{ readonly path: string; readonly specifiers: ReadonlyArray<string> }>,
  rewrites: ReadonlySet<string>
): ReadonlyArray<string> =>
  scans
    .filter((scan) => !CONF_FILES.some((file) => scan.path === `test/verify/${file}`))
    .flatMap((scan) =>
      scan.specifiers.flatMap((specifier) =>
        (walkCandidates(scan.path, specifier, PKG_ROOT) ?? [])
          .filter((candidate) => rewrites.has(candidate))
          .slice(0, 1)
          .map((rewrite) => `${scan.path} imports ${rewrite}`)
      )
    )

/**
 * Each rewrite that the modules of a list import more than once in all, the CONF evidence files
 * among them, as `<rewrite>: imported <n> times, by <importers>`. Each specifier is resolved as
 * the import walk of HARNESS-2 resolves it (`walkCandidates`, which strips a query or hash suffix),
 * so a second import with a suffix counts too.
 */
const repeatedImports = (
  scans: ReadonlyArray<{ readonly path: string; readonly specifiers: ReadonlyArray<string> }>,
  rewrites: ReadonlySet<string>
): ReadonlyArray<string> => {
  const importers = new Map<string, Array<string>>()
  for (const scan of scans) {
    for (const specifier of scan.specifiers) {
      const [rewrite] = (walkCandidates(scan.path, specifier, PKG_ROOT) ?? []).filter((candidate) => rewrites.has(candidate))
      if (rewrite !== undefined) importers.set(rewrite, [...(importers.get(rewrite) ?? []), scan.path])
    }
  }
  return [...importers]
    .filter(([, by]) => by.length > 1)
    .map(([rewrite, by]) => `${rewrite}: imported ${by.length} times, by ${by.join(" and ")}`)
    .sort()
}

describe("[CONF-8] all 74 upstream files run once, and no test is skipped", () => {
  it.effect("[CONF-8] the CONF-2 to CONF-8 evidence files together import each of the 74 files of the frozen manifest exactly once, matched by name, and no other file under test/ imports one of their rewrites", () =>
    Effect.sync(() => {
      const manifest = readManifest()
      const names = manifest.files.map((file) => shortName(file.path))
      assert.strictEqual(names.length, 74)
      assert.strictEqual(new Set(names).size, 74, "each manifest file has its own name")
      // 58 core files, 6 examples, 10 graph files (D1)
      assert.deepStrictEqual(
        [
          names.filter((name) => !name.includes("/")).length,
          names.filter((name) => name.startsWith("examples/")).length,
          names.filter((name) => name.startsWith("graph/")).length
        ],
        [58, 6, 10]
      )

      const sources = confEvidenceSources(join(PKG_ROOT, "test/verify"))
      assert.deepStrictEqual(sources.map((source) => source.file), [...CONF_FILES].sort())
      assert.deepStrictEqual(checkImportedOnce(sources, names.map((name) => ({ Name: name }))), [])

      // A rewrite that another file imports would run a second time in the default run
      const rewrites = new Set(names.map((name) => `test/upstream/${name}.test.ts`))
      const scans = scanModules(scanList().paths, readPackageFile)
      assert.deepStrictEqual(otherImporters(scans, rewrites), [])
      // Negative fixtures: a second importer is named, in each import form
      const probe = (source: string) =>
        otherImporters(
          scanModules(["test/verify/verify-probe.spec.ts"], (path) => (path === "test/verify/verify-probe.spec.ts" ? source : undefined)),
          rewrites
        )
      assert.deepStrictEqual(probe(`describe("x", async () => {\n  await import("../upstream/deep.test.js")\n})\n`), [
        "test/verify/verify-probe.spec.ts imports test/upstream/deep.test.ts"
      ])
      assert.deepStrictEqual(probe(`export { machine } from "../upstream/graph/paths.test.js"\n`), [
        "test/verify/verify-probe.spec.ts imports test/upstream/graph/paths.test.ts"
      ])
      assert.deepStrictEqual(probe(`import "../upstream/utils.js"\nimport "../upstream/exports.test.js"\n`), [])
      // Negative fixtures (the seventh Layer-3 review's S3c): a rewrite imported with a query or
      // hash suffix, which Vite strips before it reads the file, is an import of that rewrite
      assert.deepStrictEqual(probe(`describe("x", async () => {\n  await import("../upstream/deep.test.ts?again")\n})\n`), [
        "test/verify/verify-probe.spec.ts imports test/upstream/deep.test.ts"
      ])
      assert.deepStrictEqual(probe(`import "../upstream/graph/paths.test.js#again"\n`), [
        "test/verify/verify-probe.spec.ts imports test/upstream/graph/paths.test.ts"
      ])
      // Every module of the list, the CONF evidence files among them, imports each rewrite once
      // in all, whatever suffix an import adds: a CONF file that imports its rewrite a second
      // time with a suffix runs its tests twice
      assert.deepStrictEqual(repeatedImports(scans, rewrites), [])
      const twiceWithSuffix = `describe("upstream/deep.test.ts", async () => {\n  await import("../upstream/deep.test.js")\n  await import("../upstream/deep.test.js?again")\n})\n`
      assert.deepStrictEqual(
        repeatedImports(scanModules([`test/verify/${CONF_FILES[0] ?? ""}`], () => twiceWithSuffix), rewrites),
        [`test/upstream/deep.test.ts: imported 2 times, by test/verify/${CONF_FILES[0] ?? ""} and test/verify/${CONF_FILES[0] ?? ""}`]
      )
      // A CONF file that drops a rewrite, or two that import the same one, fail the check
      const [first, second] = sources
      if (first === undefined || second === undefined) return assert.fail("two CONF evidence files")
      const twice = checkImportedOnce([first, { ...second, source: first.source }, ...sources.slice(2)], names.map((name) => ({ Name: name })))
      assert.include(twice, `upstream/deep.test.ts: imported by ${first.file} and ${second.file}`)
      assert.isTrue(twice.some((problem) => problem.endsWith(": imported by no CONF evidence file")))
    }), 60_000)

  it.effect("[CONF-8] test/upstream/pending.json is empty, and the green type check excludes no file", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(readJson<ReadonlyArray<string>>("test/upstream/pending.json"), [])
      assert.deepStrictEqual(readJson<{ readonly exclude?: ReadonlyArray<string> }>("tsconfig.test.green.json").exclude ?? [], [])
    }))

  it.effect("[CONF-8] no file under test/ skips, marks todo, focuses, expects to fail or retries a test: the syntax-tree scan finds no skip, skipIf, runIf, todo, only, fails or flakyTest form on any chain or alias, no call of a test context's skip, and no skip, todo, only, fails or retry option", () =>
    Effect.sync(() => {
      const modules = scanList().paths
      for (const path of [
        "test/smoke.test.ts",
        "test/upstream/scxml.test.ts",
        "test/upstream/typeHelpers.test.ts",
        "test/upstream/graph/testUtils.ts",
        "test/verify/conformance.ts",
        "test/verify/skip-scan.ts",
        "test/verify/verify-xstate-5-33-2-port-CONF-8.spec.ts"
      ]) {
        assert.include(modules, path)
      }
      assert.isAbove(modules.length, 200)
      const scans = scanModules(modules, readPackageFile)
      assert.deepStrictEqual(scans.map((scan) => scan.path), modules, "the scan reads every module")
      // The generated programs of the repository, which no test module reaches, hold the forms of
      // their bundled libraries (GENERATED_PROGRAMS)
      assert.deepStrictEqual(scans.filter((scan) => !GENERATED_PROGRAMS.includes(scan.path)).flatMap((scan) => scan.forms), [])
    }), 60_000)

  it.effect("[CONF-8] no code under test/ names flakyTest, which no run-time check sees: no identifier has the name, and only the scan's own source and this file, by exact path, hold it in a string or template", () =>
    Effect.sync(() => {
      const scans = scanModules(scanList().paths, readPackageFile)
      assert.isAbove(scans.length, 200)
      assert.deepStrictEqual(scans.flatMap((scan) => scan.flakyTestNames), [])
      assert.deepStrictEqual(
        scans.filter((scan) => !FLAKY_TEST_TEXT_FILES.includes(scan.path)).flatMap((scan) => scan.flakyTestTexts),
        []
      )
      // Each allowed file exists and holds the name in text, so the list names no stale path
      for (const path of FLAKY_TEST_TEXT_FILES) {
        assert.isAbove(scans.find((scan) => scan.path === path)?.flakyTestTexts.length ?? 0, 0, path)
      }

      // Negative fixtures: the four routes of the second Layer-3 review and the earlier routes, each
      // as [source, the names found, the texts found]
      const namesIn = (source: string): readonly [ReadonlyArray<string>, ReadonlyArray<string>] => {
        const path = "test/verify/conf-8-fixture.spec.ts"
        const [scan] = scanModules([path], (candidate) => (candidate === path ? source : undefined))
        return [(scan?.flakyTestNames ?? []).map(codeOf), (scan?.flakyTestTexts ?? []).map(codeOf)]
      }
      const flagged: ReadonlyArray<readonly [string, ReadonlyArray<string>, ReadonlyArray<string>]> = [
        [`export { flakyTest } from "@effect/vitest"`, ["flakyTest"], []],
        [`export * from "@effect/vitest"\n`, [], []],
        [`import { flakyTest as probeFlaky } from "./probe-helpers.js"\nit.effect("x", () => probeFlaky(Effect.void))`, ["flakyTest"], []],
        [`import { createRequire } from "node:module"\nconst { flakyTest } = createRequire(import.meta.url)("@effect/vitest")`, ["flakyTest"], []],
        [`const api = { it }\nconst run = api.it.flakyTest`, ["flakyTest"], []],
        [`import { flakyTest } from "@effect/vitest"\nconst run = flakyTest(Effect.void)`, ["flakyTest", "flakyTest"], []],
        [`const run = (it as any).flakyTest`, ["flakyTest"], []],
        [`const run = it.flaky\\u0054est`, ["flaky\\u0054est"], []],
        [`const k = "flakyTest"\nconst run = helper[k]`, [], [`"flakyTest"`]],
        [`const { "flakyTest": run } = helper`, [], [`"flakyTest"`]],
        ["const run = helpers[`${prefix}flakyTest`]", [], ["}flakyTest`"]]
      ]
      for (const [source, names, texts] of flagged) {
        assert.deepStrictEqual(namesIn(source), [names, texts], source)
      }
      // `export *` hides the name from the helper: its importer names it, and the scan flags the
      // helper itself (see the fixtures of the scan below)
      assert.deepStrictEqual(formsIn(`export * from "@effect/vitest"\n`), [`export * from "@effect/vitest"`])
      // A longer name, a comment and a JSDoc comment are not the name
      for (const source of [`const flakyTestCount = 0`, `const flakyTests = [] // flakyTest\n`, `/** No test uses flakyTest. */\nexport const x = 1\n`]) {
        assert.deepStrictEqual(namesIn(source), [[], []], source)
      }
    }), 60_000)

  it.effect("[CONF-8] the scan and the name check read each module that a test module reaches by import, in test/ or outside it: a helper in scripts/ that holds Reflect.get(it, \"flakyTest\") is named, so are helpers in src/, examples/, the package folder and outside it, and each import that the list cannot follow", () =>
    Effect.gen(function* () {
      // Negative fixtures (the fourth Layer-3 review): a spec under test/ retries with a helper of
      // scripts/ that takes flakyTest from the test API by a literal key. The package root is
      // core/ of the fixture folder, so shared/ lies outside the package folder
      const user = `import { assert, it, vi } from "@effect/vitest"
import { Effect } from "effect"
import { createRequire } from "node:module"
import { retryUntil } from "../../scripts/probe-retry.js"
import { retrying } from "@/probe.js"
import "../../probe-root.js"
import { shared } from "../../../shared/probe.js"
import "/scripts/absolute.js"
import "#probe"
vi.mock("../../scripts/mocked.js")
createRequire(import.meta.url)("../../scripts/required.cjs")
const loaded = await import("../../examples/probe.mjs")
const target = "../../scripts/computed.js"
const computed = await import(target)
const globbed = import.meta.glob("../../scripts/globbed-*.ts", { eager: true })
it.effect("x", () => retryUntil(Effect.void))
`
      const base = yield* fixtureRoot([
        [`core/${ZZ_USER_SPEC}`, user],
        ["core/scripts/probe-retry.ts", `import { it } from "@effect/vitest"\nexport const retryUntil = Reflect.get(it, "flakyTest")\n`],
        ["core/src/probe.ts", `export { flakyTest as retrying } from "@effect/vitest"\n`],
        ["core/probe-root.ts", `export * from "./scripts/hop.js"\n`],
        ["core/scripts/hop.ts", "export const hop = `flakyTest`\n"],
        ["shared/probe.ts", `import { it } from "@effect/vitest"\nexport const shared = (it as any).flakyTest\n`],
        ["core/scripts/mocked.ts", `export const key = "flakyTest"\n`],
        ["core/scripts/required.cjs", `module.exports = { retry: "flakyTest" }\n`],
        ["core/examples/probe.mjs", `const { flakyTest } = await import("@effect/vitest")\nexport default flakyTest\n`],
        ["core/scripts/absolute.ts", `import { it } from "vitest"\nexport const absolute = it.flakyTest\n`],
        ["core/scripts/computed.ts", `export const key = "flakyTest"\n`],
        ["core/scripts/globbed-a.ts", `export const key = "flakyTest"\n`]
      ])
      const root = join(base, "core")
      // The package folder is the root of its repository checkout, so shared/ lies outside it
      git(root, ["init", "-q"])
      const list = scanList(root)
      // The list holds every script module of the package folder, so the modules that only the
      // computed specifier and the glob name are in it too (the fifth Layer-3 review)
      assert.deepStrictEqual(list.paths, [
        "../shared/probe.ts",
        "examples/probe.mjs",
        "probe-root.ts",
        "scripts/absolute.ts",
        "scripts/computed.ts",
        "scripts/globbed-a.ts",
        "scripts/hop.ts",
        "scripts/mocked.ts",
        "scripts/probe-retry.ts",
        "scripts/required.cjs",
        "src/probe.ts",
        ZZ_USER_SPEC
      ])
      // A computed specifier, a glob (it names modules by a pattern) and a subpath import of
      // package.json name modules that the list cannot follow
      assert.deepStrictEqual(list.problems, [
        `${ZZ_USER_SPEC}:14 import(target) names a module the walk cannot read`,
        `${ZZ_USER_SPEC}:15 import.meta.glob("../../scripts/globbed-*.ts", { eager: true }) names a module the walk cannot read`,
        `${ZZ_USER_SPEC}: "#probe" names a module the walk cannot read`
      ])
      const scans = scanModules(list.paths, (path) => readPackageFile(path, root))
      assert.deepStrictEqual(scans.flatMap((scan) => scan.flakyTestTexts), [
        `scripts/computed.ts:1 "flakyTest"`,
        `scripts/globbed-a.ts:1 "flakyTest"`,
        "scripts/hop.ts:1 `flakyTest`",
        `scripts/mocked.ts:1 "flakyTest"`,
        `scripts/probe-retry.ts:2 "flakyTest"`,
        `scripts/required.cjs:1 "flakyTest"`
      ])
      assert.deepStrictEqual(scans.flatMap((scan) => scan.flakyTestNames), [
        "../shared/probe.ts:2 flakyTest",
        "examples/probe.mjs:1 flakyTest",
        "examples/probe.mjs:2 flakyTest",
        "scripts/absolute.ts:2 flakyTest",
        "src/probe.ts:1 flakyTest"
      ])
      assert.deepStrictEqual(scans.flatMap((scan) => scan.forms), [
        "../shared/probe.ts:2 (it as any).flakyTest",
        "examples/probe.mjs:1 flakyTest",
        "scripts/absolute.ts:2 it.flakyTest",
        "src/probe.ts:1 flakyTest as retrying"
      ])
      // An absolute specifier names a module as a path from the root (above) or of the disk, and a
      // file: URL names one of the disk
      for (const specifier of [join(PKG_ROOT, "scripts/clean.ts"), pathToFileURL(join(PKG_ROOT, "scripts/clean.ts")).href]) {
        assert.include(walkCandidates(ZZ_USER_SPEC, specifier, PKG_ROOT) ?? [], "scripts/clean.ts", specifier)
      }

      // The package: the list reaches modules outside test/, and reads every import on the way
      const real = scanList()
      assertAllowedWalkProblems(real)
      for (const path of ["src/index.ts", "scripts/upstream/freeze-upstream.ts", "eslint-rules/effect-rules.mjs", "vitest.config.ts", "test/verify/skip-scan.ts"]) {
        assert.include(real.paths, path)
      }
    }), 60_000)

  it.effect("[CONF-8] each reference to a loader that is not a direct call with a literal specifier is a walk problem, and the list holds every script module of the package folder, whatever reaches it: the fifth Layer-3 review's N1, N2, N3, N5 and N4b fail CONF-8", () =>
    Effect.gen(function* () {
      // Negative fixtures (the fifth Layer-3 review): specs under test/ load the fourth review's
      // helper in scripts/ through vi.importActual in another call shape (N1 a destructuring, N2
      // an element access, N3 an alias variable, N5 `.call`), or read the key from an
      // examples/*.cjs module through Reflect.apply on a createRequire result (N4b); a spec loads a
      // module outside the package folder through `.bind`. No literal specifier reaches the helper,
      // the key module, scripts/unreached.ts or .probe/zz.ts, and the list holds each of them, and
      // node_modules/zz-dep/ (a folder there that pnpm's store does not hold is no installed
      // dependency: the sixth Layer-3 review); it leaves out the unreached files of dist/,
      // .upstream/, .delivery/ and .markdown-code-check/, which git ignores, and walks into dist/
      // where a literal specifier reaches it. The package root is core/ of the fixture folder, the
      // root of its repository, so shared/ lies outside both
      const header = `import { it, vi } from "@effect/vitest"\nimport { createRequire } from "node:module"\n`
      const helper = "../../scripts/probe-retry.js"
      const specs: ReadonlyArray<readonly [path: string, body: string, codes: ReadonlyArray<string>]> = [
        ["test/verify/zz-n1.spec.ts", `const { importActual } = vi\nexport const { retryUntil } = await importActual<{ retryUntil: unknown }>("${helper}")\n`, ["importActual"]],
        ["test/verify/zz-n2.spec.ts", `export const { retryUntil } = await vi["importActual"]<{ retryUntil: unknown }>("${helper}")\n`, [`vi["importActual"]`]],
        ["test/verify/zz-n3.spec.ts", `const ia = vi.importActual\nexport const { retryUntil } = await ia<{ retryUntil: unknown }>("${helper}")\n`, ["vi.importActual"]],
        [
          "test/verify/zz-n4b.spec.ts",
          `const { key } = Reflect.apply(createRequire(import.meta.url), undefined, ["../../examples/zz-key.cjs"])\nexport const retryUntil = Reflect.get(it, key)\n`,
          ["createRequire(import.meta.url)"]
        ],
        [
          "test/verify/zz-n5.spec.ts",
          `export const { retryUntil } = await (vi.importActual as (path: string) => Promise<{ retryUntil: unknown }>).call(vi, "${helper}")\n`,
          ["vi.importActual", "vi"]
        ],
        ["test/verify/zz-outside.spec.ts", `const load = vi.importActual.bind(vi)\nexport const outside = await load("../../../shared/outside.js")\n`, ["vi.importActual", "vi"]]
      ]
      const base = yield* fixtureRoot([
        ...specs.map(([path, body]) => [`core/${path}`, `${header}${body}`] as const),
        ["core/test/verify/zz-reach.spec.ts", `import "../../dist/reached.js"\n`],
        ["core/scripts/probe-retry.ts", `import { it } from "@effect/vitest"\nexport const retryUntil = Reflect.get(it, "flakyTest")\n`],
        ["core/examples/zz-key.cjs", `module.exports = { key: "flakyTest" }\n`],
        ["core/scripts/unreached.ts", `export const unreached = "flakyTest"\n`],
        ["core/.probe/zz.ts", `export const hidden = "flakyTest"\n`],
        ["core/dist/reached.js", `export const reached = "flakyTest"\n`],
        ["core/dist/unreached.js", `export const unreached = "flakyTest"\n`],
        ["core/node_modules/zz-dep/index.js", `export const dependency = "flakyTest"\n`],
        ["core/.upstream/zz.ts", `export const upstream = "flakyTest"\n`],
        ["core/.delivery/zz.ts", `export const delivery = "flakyTest"\n`],
        ["core/.markdown-code-check/zz.ts", `export const snippet = "flakyTest"\n`],
        ["core/.gitignore", ".upstream/\n.delivery/\ndist/\n.markdown-code-check/\nnode_modules/\n"],
        ["shared/outside.ts", `export const outside = "flakyTest"\n`]
      ])
      const root = join(base, "core")
      // The package folder is the root of its repository checkout, which ignores the folders the
      // package's own .gitignore files ignore, so shared/ lies outside it
      git(root, ["init", "-q"])
      const list = scanList(root)
      assert.deepStrictEqual(list.paths, [
        ".probe/zz.ts",
        "dist/reached.js",
        "examples/zz-key.cjs",
        "node_modules/zz-dep/index.js",
        "scripts/probe-retry.ts",
        "scripts/unreached.ts",
        ...specs.map(([path]) => path),
        "test/verify/zz-reach.spec.ts"
      ])
      assert.deepStrictEqual(
        list.problems,
        specs.flatMap(([path, , codes]) => codes.map((code) => `${path}:3 ${code} is a loader reference that the walk cannot follow`))
      )
      const scans = scanModules(list.paths, (path) => readPackageFile(path, root))
      assert.deepStrictEqual(scans.flatMap((scan) => scan.flakyTestTexts), [
        `.probe/zz.ts:1 "flakyTest"`,
        `dist/reached.js:1 "flakyTest"`,
        `examples/zz-key.cjs:1 "flakyTest"`,
        `node_modules/zz-dep/index.js:1 "flakyTest"`,
        `scripts/probe-retry.ts:2 "flakyTest"`,
        `scripts/unreached.ts:1 "flakyTest"`
      ])

      // Each other shape of a loader reference is a walk problem: a member of the test API module's
      // vi, require, a createRequire result or the factory itself passed on, stored, bound or taken
      // apart, a holder of a loader (vi, the module object, import.meta, the test-API module, a
      // builtin module) passed on, and a loader of the runner
      const probe = "test/verify/zz-probe.spec.ts"
      const loaderCodes = (body: string): ReadonlyArray<string> => {
        const suffix = " is a loader reference that the walk cannot follow"
        // Each other module the probe names by a path is an empty module
        return walkImports([probe], [], (path) => (path === probe ? `${header}${body}` : "")).problems
          .map((problem) => (problem.endsWith(suffix) ? codeOf(problem.slice(0, -suffix.length)) : problem))
      }
      const flagged: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
        [`await [vi.importActual][0]("../x.js")\n`, ["vi.importActual"]],
        [`await Function.prototype.call.call(vi.importActual, vi, "../x.js")\n`, ["vi.importActual", "vi"]],
        [`await (0, vi.importActual)("../x.js")\n`, ["vi.importActual"]],
        [`const f = (load: unknown) => load\nf(vi.importMock)\n`, ["vi.importMock"]],
        [`const loaders = { load: vi.importActual, mock: vi.mock }\n`, ["vi.importActual", "vi.mock"]],
        [`const { importActual: load } = vi\n`, ["importActual: load"]],
        [`const { ...all } = vi\n`, ["...all"]],
        [`import { importActual } from "./helpers.js"\n`, ["importActual"]],
        [`vi.doMock("../x.js")\nconst mock = vi.mock\n`, ["vi.mock"]],
        [`const { mock } = vi\nmock("../x.js")\n`, ["mock"]],
        [`const { vi: { doMock: later } } = await import("vitest")\n`, ["doMock: later"]],
        [`import V = require("vitest")\nconst w = V.vi\n`, ["V.vi"]],
        [`Reflect.get(vi, "importActual")\n`, ["vi"]],
        [`const v = vi\n`, ["vi"]],
        [`const key = "importActual"\nvi[key]\n`, ["vi"]],
        [`const { vi: v } = await import("vitest")\nconst w = v\n`, ["v"]],
        [`import * as V from "vitest"\nReflect.get(V, "vi")\n`, ["V"]],
        [`const V = await import("vitest")\nconst w = V.vi\n`, ["V.vi"]],
        [`void import("vitest").then((m) => m.vi)\n`, [`import("vitest")`]],
        [`export { vi } from "vitest"\n`, ["vi"]],
        [`export * from "node:module"\n`, [`export * from "node:module"`]],
        [`export * as M from "node:module"\n`, [`export * as M from "node:module"`]],
        [`export * as v from "vitest"\n`, [`export * as v from "vitest"`]],
        [`const loaders = { require }\n`, ["require"]],
        [`Reflect.apply(require, undefined, ["../x.cjs"])\n`, ["require"]],
        [`const load = require\nload("../x.cjs")\n`, ["require"]],
        ["require`../x.cjs`\n", ["require"]],
        [`(globalThis as any).require("../x.cjs")\n`, ["(globalThis as any).require"]],
        [`module.require("../x.cjs")\n`, ["module.require"]],
        [`module.constructor._load("../x.cjs", null)\n`, ["module.constructor._load"]],
        [`import { Module } from "node:module"\nconst load = Module.prototype.require\n`, ["Module.prototype.require"]],
        [`const make = createRequire\nmake(import.meta.url)("../x.cjs")\n`, ["createRequire"]],
        [`export { createRequire as make } from "node:module"\n`, ["createRequire as make"]],
        [`const load = createRequire(import.meta.url)\nload("../x.cjs")\n`, ["createRequire(import.meta.url)"]],
        [`const resolver = createRequire(import.meta.url)\nresolver.resolve("effect")\nresolver("../x.cjs")\n`, ["createRequire(import.meta.url)"]],
        [`let resolver = createRequire(import.meta.url)\nresolver.resolve("effect")\n`, ["createRequire(import.meta.url)"]],
        [`const builtin = process.getBuiltinModule("node:module")\nReflect.get(builtin, "createRequire")\n`, ["builtin"]],
        [`__vite_ssr_dynamic_import__("../x.js")\n`, ["__vite_ssr_dynamic_import__"]],
        [`const meta = import.meta\n`, ["import.meta"]],
        [`const glob = import.meta.glob\n`, ["import.meta.glob"]]
      ]
      for (const [body, codes] of flagged) {
        assert.deepStrictEqual(loaderCodes(body), codes, body)
      }
      // A direct call with a literal specifier, a resolver that loads nothing, and a name that only
      // looks alike are no loader reference
      const clean = [
        `await vi.importActual("../x.js")\nawait vi.importMock("../y.js")\n`,
        `vi.mock("../x.js")\nvi.doMock("../y.js", () => ({}))\nvi.mock(import("../z.js"))\n`,
        `vi.mock("../x.js", async (importOriginal) => ({ ...(await importOriginal<object>()) }))\n`,
        `require("../x.cjs")\nconst kind = typeof require\n`,
        `createRequire(import.meta.url)("../x.cjs")\nconst path = createRequire(import.meta.url).resolve("effect")\n`,
        `const resolver = createRequire(import.meta.url)\nconst path = resolver.resolve("effect")\n`,
        `const run = () => {\n  const require = (specifier: string) => specifier\n  const module = { exports: {} }\n  return [require, module]\n}\n`,
        `const spy = vi.fn()\nconst calls = spy.mock.calls\n`,
        `const url = new URL(".", import.meta.url)\n`,
        `const { it: t, vi: v } = await import("vitest")\nv.fn()\n`,
        `import * as V from "vitest"\nV.vi.fn()\n`,
        `process.getBuiltinModule("node:module").createRequire(import.meta.url)("../x.cjs")\n`,
        `export { expect, it } from "vitest"\n`
      ]
      for (const body of clean) {
        assert.deepStrictEqual(loaderCodes(body), [], body)
      }

      // A string whose whole text is the name of a loader is a key that reaches it at run time
      // (`Reflect.get(builtin, "createRequire")`): the scan names it, and no module of the list
      // holds one but the scan's own source and this file, by exact path, and DELIVERY-1's check
      // of built files, by exact text
      const loaderTextsIn = (body: string): ReadonlyArray<string> =>
        scanModules([probe], (path) => (path === probe ? body : undefined)).flatMap((scan) => scan.loaderTexts.map(codeOf))
      assert.deepStrictEqual(
        loaderTextsIn(`Reflect.get(process.getBuiltinModule("node:module"), "createRequire")\nconst key = \`importActual\`\nconst internal = "__vite_ssr_dynamic_import__"\n`),
        [`"createRequire"`, "`importActual`", `"__vite_ssr_dynamic_import__"`]
      )
      assert.deepStrictEqual(loaderTextsIn(`const names = ["require", "exports", "module"]\nconst code = "createRequire(import.meta.url)"\n`), [])
      const real = scanList()
      assertAllowedWalkProblems(real)
      assert.deepStrictEqual(
        scanModules(real.paths, readPackageFile)
          .filter((scan) => !FLAKY_TEST_TEXT_FILES.includes(scan.path) && !GENERATED_PROGRAMS.includes(scan.path))
          .flatMap((scan) => scan.loaderTexts),
        ALLOWED_LOADER_TEXTS
      )
    }), 60_000)

  it.effect("[CONF-8] each walk allowance by exact path applies only where its file exists: a fixture repository without .claude/, .agents/ and _bmad-output/ (a public clone) passes with the cleanup CLI's allowance alone, a hook file that exists there must show exactly its allowed problems, and a walk problem that no allowance names fails", () =>
    Effect.gen(function* () {
      // Each case plants its own files in a fresh public clone (`publicClone`)
      const cleanAllowance = CLEAN_ALLOWANCE

      // The public clone: no hook, drafting script or generated program exists, so the cleanup
      // CLI's allowance is the only one, and its list passes
      const root = yield* publicClone([])
      for (const path of [...TEA_HOOKS, DRAFT_SCRIPT, ...GENERATED_PROGRAMS]) {
        assert.isFalse(existsSync(join(root, path)), `${path} is absent from the public clone`)
      }
      const list = scanList(root)
      assert.deepStrictEqual(allowedWalkProblems(list), [cleanAllowance])
      assert.include(list.paths, CLEAN_CLI)
      assert.deepStrictEqual(list.problems, [cleanAllowance])
      assertAllowedWalkProblems(list, root)

      // A hook file that exists, and that git does not ignore, is in the list: it brings its
      // allowance back, and must show exactly its allowed problems, so a hook without them fails
      const hook = TEA_HOOKS[0] ?? ""
      const withHook = yield* publicClone([[hook, "module.exports = {}\n"]])
      const hookList = scanList(withHook)
      assert.include(hookList.paths, hook)
      assert.deepStrictEqual(allowedWalkProblems(hookList), [
        `${hook}:1073 require is a loader reference that the walk cannot follow`,
        `${hook}:1073 module is a loader reference that the walk cannot follow`,
        cleanAllowance
      ])
      assert.throws(() => assertAllowedWalkProblems(hookList, withHook))

      // A walk problem that no allowance names fails
      const withExtra = yield* publicClone([["scripts/zz-extra.ts", `const target = "./x.js"\nexport const loaded = await import(target)\n`]])
      const extraList = scanList(withExtra)
      assert.deepStrictEqual([...extraList.problems].sort(), [cleanAllowance, "scripts/zz-extra.ts:2 import(target) names a module the walk cannot read"])
      assert.throws(() => assertAllowedWalkProblems(extraList, withExtra))
    }), 60_000)

  it.effect("[CONF-8] a walk allowance by exact path does not apply where git ignores its file: a fixture repository whose .gitignore ignores .claude/, .agents/ and _bmad-output/, with both hooks, the drafting script and a generated program on disk there, passes with the cleanup CLI's allowance alone", () =>
    Effect.gen(function* () {
      // Each planted file holds a walk problem that no allowance names, so a list that held one
      // would show it
      const loads = `const target = "./x.js"\nexport const loaded = await import(target)\n`
      const planted = [...TEA_HOOKS, DRAFT_SCRIPT, GENERATED_PROGRAMS[0] ?? ""]
      const root = yield* publicClone(planted.map((path) => [path, loads] as const), "node_modules/\n/.claude\n/.agents\n/_bmad-output\n")
      const list = scanList(root)
      for (const path of planted) {
        assert.isTrue(isFile(join(root, path)), `${path} exists on disk`)
        assert.notInclude(list.paths, path, `git ignores ${path}, so the list does not hold it`)
      }
      assert.deepStrictEqual(list.problems, [CLEAN_ALLOWANCE])
      assert.deepStrictEqual(allowedWalkProblems(list), [CLEAN_ALLOWANCE])
      assertAllowedWalkProblems(list, root)
    }), 60_000)

  it.effect("[CONF-8] each reference to an API that loads or runs code the walk cannot read is a walk problem: node:vm and the other evaluating builtins, eval, the Function constructor, Vite's and Vitest's module runners, the module system's hooks and internals, process.dlopen and a URL specifier", () =>
    Effect.sync(() => {
      // Negative fixtures (the sixth Layer-3 review's B1, B3 and V1, and their neighbours): each
      // route that loads or runs code which no literal specifier names
      const header = `import { it } from "@effect/vitest"\nimport { createRequire } from "node:module"\n`
      const flagged: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
        // node:vm (V1) and the other builtins that run code: any import or load of one
        [`import { runInThisContext } from "node:vm"\nrunInThisContext("1")\n`, [`import { runInThisContext } from "node:vm"`]],
        [`import * as vm from "vm"\n`, [`import * as vm from "vm"`]],
        [`export { runInNewContext } from "node:vm"\n`, [`export { runInNewContext } from "node:vm"`]],
        [`const vm = await import("node:vm")\n`, [`import("node:vm")`]],
        [`const vm = createRequire(import.meta.url)("vm")\n`, [`createRequire(import.meta.url)("vm")`]],
        [`const vm = process.getBuiltinModule("node:vm")\n`, [`process.getBuiltinModule("node:vm")`]],
        [`const name = ["node", "vm"].join(":")\nconst vm = process.getBuiltinModule(name)\n`, ["process.getBuiltinModule(name)"]],
        [`import { Worker } from "node:worker_threads"\n`, [`import { Worker } from "node:worker_threads"`]],
        [`import { Session } from "node:inspector/promises"\n`, [`import { Session } from "node:inspector/promises"`]],
        // eval and the Function constructor, under their own names, through the global object and
        // through the constructor of a function
        [`eval("1")\n`, ["eval"]],
        [`const run = (0, eval)\n`, ["eval"]],
        [`globalThis.eval("1")\n`, ["globalThis.eval"]],
        [`new Function("return 1")\n`, ["Function"]],
        [`Reflect.construct(Function, ["return 1"])\n`, ["Function"]],
        [`const F = (globalThis as any)["Function"]\n`, [`(globalThis as any)["Function"]`]],
        [`const F = (() => {}).constructor\n`, ["(() => {}).constructor"]],
        [`Object.getPrototypeOf(async () => {}).constructor("return 1")\n`, ["Object.getPrototypeOf(async () => {}).constructor"]],
        [`const make = (x: object) => x.constructor\n`, ["x.constructor"]],
        [`const F = Object.constructor\n`, ["Object.constructor"]],
        [`Reflect.get(Object, "constructor")\n`, [`"constructor"`]],
        [`const { constructor: F } = Object\n`, ["constructor: F"]],
        // Vite's and Vitest's module runners (B1, B3) and config loader
        [`import { runnerImport } from "vite"\nawait runnerImport("../../x.ts")\n`, [`import { runnerImport } from "vite"`, "runnerImport"]],
        [
          `import { createServer } from "vite"\nconst server = await createServer()\nawait server.ssrLoadModule("../../x.ts")\n`,
          [`import { createServer } from "vite"`, "server.ssrLoadModule"]
        ],
        [`const { createServer } = await import("vite")\n`, [`import("vite")`]],
        [`import { ModuleRunner } from "vite/module-runner"\n`, [`import { ModuleRunner } from "vite/module-runner"`]],
        // (vite-node is no dependency of the package, so its bare specifier names a package that
        // no node_modules folder holds: a walk problem of its own)
        [
          `import { ViteNodeRunner } from "vite-node/client"\n`,
          [`import { ViteNodeRunner } from "vite-node/client"`, `${LOADER_PROBE}: "vite-node/client" names a package that no node_modules folder holds`]
        ],
        [`import { VitestModuleEvaluator } from "vitest/module-evaluator"\n`, [`import { VitestModuleEvaluator } from "vitest/module-evaluator"`]],
        [`import { createViteServer } from "vitest/node"\n`, ["createViteServer"]],
        [`import * as node from "vitest/node"\n`, [`import * as node from "vitest/node"`]],
        [`import { createVitest } from "vitest/node"\nconst vitest = await createVitest("test", {})\nawait vitest.import("../../x.ts")\n`, ["vitest.import"]],
        [`const { ssrLoadModule: load } = server\n`, ["ssrLoadModule: load"]],
        // The module system's hooks and internals, and the addon loader
        [`import { registerHooks } from "node:module"\n`, ["registerHooks"]],
        [`import { register } from "node:module"\nregister("./hooks.mjs", import.meta.url)\n`, ["register"]],
        [`import * as M from "node:module"\nM.register("./hooks.mjs", import.meta.url)\n`, ["M.register"]],
        [`const { registerHooks: hooks } = await import("node:module")\n`, ["registerHooks: hooks"]],
        [`module.constructor._compile("code", "x.js")\n`, ["module.constructor._compile"]],
        [`import { Module } from "node:module"\nconst compile = Module.prototype._compile\n`, ["Module.prototype._compile"]],
        [`const cache = require.cache\n`, ["require"]],
        [`process.dlopen({ exports: {} }, "./x.node")\n`, ["process.dlopen"]],
        [`const binding = process.binding("contextify")\n`, ["process.binding"]],
        // A specifier with a URL scheme holds or fetches code that no module of the disk holds
        [`await import("data:text/javascript,export default 1")\n`, [`${LOADER_PROBE}: "data:text/javascript,export default 1" names a module the walk cannot read`]],
        [`import "https://example.com/x.js"\n`, [`${LOADER_PROBE}: "https://example.com/x.js" names a module the walk cannot read`]]
      ]
      for (const [body, codes] of flagged) {
        assert.deepStrictEqual(loaderProblems(`${header}${body}`), codes, body)
      }
      // Types, Vitest's own run, the module system's resolvers, a check of a value's kind, the
      // Function module of effect and a key named eval are no such reference
      const clean = [
        `import type { Plugin } from "vite"\nimport type { ModuleRunner } from "vite/module-runner"\n`,
        `import { createVitest, startVitest, type Vitest } from "vitest/node"\n`,
        `import { createRequire as make, isBuiltin } from "node:module"\nconst builtin = isBuiltin("node:fs")\n`,
        `const ok = (value: unknown) => value instanceof Function || typeof value === "function"\nconst kind = typeof Function\n`,
        `import { Function } from "effect"\nconst nothing = Function.constUndefined()\n`,
        `const name = (value: object) => value.constructor.name\nconst same = (a: object, b: object) => a.constructor === b.constructor\n`,
        `import { Predicate } from "effect"\nconst plain = (prototype: object) => Predicate.isFunction(prototype.constructor)\n`,
        `const options = { eval: false }\nconst evaluate = (x: { readonly evaluate: () => void }) => x.evaluate()\n`,
        `import { readFileSync } from "node:fs"\nconst text = readFileSync(new URL("./x.ts", import.meta.url), "utf8")\n`,
        `import "node:fs"\nconst url = "https://example.com/x.js"\n`
      ]
      for (const body of clean) {
        assert.deepStrictEqual(loaderProblems(`${header}${body}`), [], body)
      }
      // A string whose whole text names such an API is a key that reaches it at run time
      // (`Reflect.get(globalThis, "eval")`): the scan names it
      const texts = scanModules([LOADER_PROBE], (path) =>
        path === LOADER_PROBE ? `const run = Reflect.get(globalThis, "eval")\nconst load = server["ssrLoadModule"]\nconst F = "Function"\n` : undefined
      ).flatMap((scan) => scan.loaderTexts.map(codeOf))
      assert.deepStrictEqual(texts, [`"eval"`, `"ssrLoadModule"`, `"Function"`])

      // The pinned uses of such an API (PINNED_LOADERS of skip-scan.ts) hold on the real files:
      // PARITY-2's sandbox (node:vm), the pending-rewrite guard's load hook (registerHooks) and
      // upstream's SCXML converter (Function, eval) give no walk problem, and the walk reads the
      // upstream helpers that the sandbox runs
      const parity = "test/verify/verify-xstate-5-33-2-port-PARITY-2.spec.ts"
      const setup = "test/verify/pending-rewrite-setup.ts"
      const flakySetup = FLAKY_TEST_SETUP
      const scxml = "test/upstream/support/scxml.ts"
      const baseline = "test/verify/verify-xstate-5-33-2-port-BASELINE-1.spec.ts"
      const realSource = (path: string): string => readPackageFile(path) ?? ""
      const loaderCodesOf = (source: string, path: string): ReadonlyArray<string> => moduleFacts(source, path).loaderReferences.map(codeOf)
      for (const path of [parity, setup, flakySetup, scxml, baseline]) {
        assert.isAbove(realSource(path).length, 0, path)
        assert.deepStrictEqual(loaderCodesOf(realSource(path), path), [], path)
      }
      assert.includeMembers([...moduleFacts(realSource(parity), parity).specifiers], ["../upstream/utils.ts", "../upstream/graph/testUtils.ts"])
      // Negative fixtures: a changed pinned text, another use of the pinned loader, and a sandbox
      // call whose path the walk cannot read each end the pin, so the walk reports the loader again
      const vmImport = `import { compileFunction } from "node:vm"`
      const changed: ReadonlyArray<readonly [string, string, ReadonlyArray<string>]> = [
        [parity, realSource(parity).replace(`readFileSync(posix.join(PKG_ROOT, relative), "utf8")`, `readFileSync(relative, "utf8")`), [vmImport]],
        [parity, realSource(parity).replace(`{ filename: relative })`, `{ filename: relative, contextExtensions: [] })`), [vmImport]],
        [parity, `${realSource(parity)}\nexport const outside = compileFunction("return 1")\n`, [vmImport]],
        [parity, `${realSource(parity)}\nconst target = ["..", "x.ts"].join("/")\nexport const helper = loadHelper(target, {})\n`, [vmImport]],
        [parity, `${realSource(parity)}\nexport const load = loadHelper\n`, [vmImport]],
        [setup, realSource(setup).replace("return nextLoad(url, context)", `return nextLoad(url.replace("x", "y"), context)`), ["registerHooks", "registerHooks"]],
        [setup, `${realSource(setup)}\nregisterHooks({})\n`, ["registerHooks", "registerHooks", "registerHooks"]],
        [flakySetup, realSource(flakySetup).replace("if (passes(specifier, parent, context.conditions)) return nextResolve(specifier, context)", "return nextResolve(specifier, context)"), FLAKY_SETUP_REFERENCES],
        [flakySetup, realSource(flakySetup).replace("const allowed = (parent ?? \"\").startsWith(storeUrl)", "const allowed = true"), FLAKY_SETUP_REFERENCES],
        [scxml, `${realSource(scxml)}\n// one more line\n`, ["Function", "eval"]]
      ]
      for (const [path, source, codes] of changed) {
        assert.notStrictEqual(source, realSource(path), `the fixture changes ${path}`)
        assert.deepStrictEqual(loaderCodesOf(source, path), codes, path)
      }
    }))

  it.effect("[CONF-8] the list holds every script module of the repository checkout, whatever reaches it: git's file list from the repository root (tracked files, and untracked files that git does not ignore), each script module of a node_modules folder that is no installed dependency, and each package outside the dependency store that a bare specifier names; the sixth Layer-3 review's B1, B3, V1 and K1 fail CONF-8, with the module outside the package folder or outside the repository", () =>
    Effect.gen(function* () {
      // Negative fixtures (the sixth Layer-3 review): specs of the package core/ take
      // `retryWith = (api) => Reflect.get(api, "flakyTest")` from a module outside the package
      // folder, shared/ of the repository, through vite's runnerImport (B1) and a dev server's
      // ssrLoadModule (B3), node:vm (V1), and a link: dependency named by a bare specifier (K1);
      // and from outside/, outside the repository, through runnerImport and a link: dependency.
      // The repository also holds a tracked module, an untracked one in a dot folder, an ignored
      // one (not listed: only a literal specifier reaches it), a nested repository, an ignored
      // module of the package folder, and a module in a node_modules folder of test/
      const retry = `export const retryWith = (api: object) => Reflect.get(api, "flakyTest")\n`
      const runner = (target: string) =>
        `import { assert, it } from "@effect/vitest"\nimport { runnerImport } from "vite"\nconst { module } = await runnerImport<{ readonly retryWith: (api: object) => unknown }>("${target}")\nit("x", () => assert.isDefined(module.retryWith(it)))\n`
      const linked = (name: string) => `import { it } from "@effect/vitest"\nimport { retryWith } from "${name}/zz-retry.ts"\nexport const retry = retryWith(it)\n`
      const base = yield* fixtureRoot([
        ["repo/.gitignore", "node_modules/\nignored/\ncoverage/\n"],
        ["repo/core/package.json", `${JSON.stringify({ name: "core", type: "module", dependencies: { "zz-shared": "link:../shared", "zz-outside": "link:../../outside" } })}\n`],
        ["repo/core/test/verify/zz-b1.spec.ts", runner("../../../shared/zz-retry.ts")],
        ["repo/core/test/verify/zz-b1-outside.spec.ts", runner("../../../../outside/zz-retry.ts")],
        [
          "repo/core/test/verify/zz-b3.spec.ts",
          `import { it } from "@effect/vitest"\nimport { createServer } from "vite"\nconst server = await createServer({ server: { middlewareMode: true } })\nconst { retryWith } = await server.ssrLoadModule("../../../shared/zz-retry.ts")\nexport const retry = retryWith(it)\n`
        ],
        [
          "repo/core/test/verify/zz-v1.spec.ts",
          `import { readFileSync } from "node:fs"\nimport { it } from "@effect/vitest"\nimport { runInThisContext } from "node:vm"\nconst retryWith = runInThisContext(readFileSync(new URL("../../../shared/zz-retry.js", import.meta.url), "utf8"))\nexport const retry = retryWith(it)\n`
        ],
        ["repo/core/test/verify/zz-k1.spec.ts", linked("zz-shared")],
        ["repo/core/test/verify/zz-k1-outside.spec.ts", linked("zz-outside")],
        ["repo/core/test/verify/node_modules/zz-helper.ts", `export const helper = "flakyTest"\n`],
        // An installed dependency (its folder in pnpm's store, node_modules/.pnpm/) is no module of
        // the repository, and the caches of the install folder hold none; a folder planted beside
        // the dependencies is listed
        ["repo/core/test/verify/zz-real.spec.ts", `import { real } from "zz-real"\nexport const value = real\n`],
        ["repo/core/node_modules/.pnpm/zz-real@1.0.0/node_modules/zz-real/index.js", `export const real = "flakyTest"\n`],
        ["repo/core/node_modules/.vite/deps/zz-cache.js", `export const cache = "flakyTest"\n`],
        ["repo/core/node_modules/zz-planted/index.js", `export const planted = "flakyTest"\n`],
        ["repo/core/coverage/zz-ignored.ts", `export const ignored = "flakyTest"\n`],
        ["repo/shared/zz-retry.ts", retry],
        ["repo/shared/zz-retry.js", `(api) => Reflect.get(api, "flakyTest")\n`],
        ["repo/tools/zz-tracked.ts", `export const tracked = "flakyTest"\n`],
        ["repo/tools/.hidden/zz-untracked.ts", `export const untracked = "flakyTest"\n`],
        ["repo/ignored/zz-ignored.ts", `export const ignored = "flakyTest"\n`],
        ["repo/nested/zz-nested.ts", `export const nested = "flakyTest"\n`],
        ["outside/zz-retry.ts", retry]
      ])
      const root = join(base, "repo", "core")
      // vite, which B1 and B3 import, is a dependency of this package: the fixture links it as it
      // links the packages its fixtures import
      symlinkSync(join(PKG_ROOT, "node_modules", "vite"), join(base, "node_modules", "vite"), "dir")
      mkdirSync(join(root, "node_modules"), { recursive: true })
      symlinkSync(join(".pnpm", "zz-real@1.0.0", "node_modules", "zz-real"), join(root, "node_modules", "zz-real"), "dir")
      symlinkSync(join("..", "..", "shared"), join(root, "node_modules", "zz-shared"), "dir")
      symlinkSync(join("..", "..", "..", "outside"), join(root, "node_modules", "zz-outside"), "dir")
      git(join(base, "repo", "nested"), ["init", "-q"])
      git(join(base, "repo"), ["init", "-q"])
      git(join(base, "repo"), ["add", "tools/zz-tracked.ts"])

      const list = scanList(root)
      assert.deepStrictEqual(list.paths, [
        "../nested/zz-nested.ts",
        "../shared/zz-retry.js",
        "../shared/zz-retry.ts",
        "../tools/.hidden/zz-untracked.ts",
        "../tools/zz-tracked.ts",
        "coverage/zz-ignored.ts",
        "node_modules/zz-planted/index.js",
        "test/verify/node_modules/zz-helper.ts",
        "test/verify/zz-b1-outside.spec.ts",
        "test/verify/zz-b1.spec.ts",
        "test/verify/zz-b3.spec.ts",
        "test/verify/zz-k1-outside.spec.ts",
        "test/verify/zz-k1.spec.ts",
        "test/verify/zz-real.spec.ts",
        "test/verify/zz-v1.spec.ts"
      ])
      // The module outside the repository is a walk problem on each route to it, and so is each
      // loader that no literal specifier names
      const loader = (path: string, line: number, code: string) => `${path}:${line} ${code} is a loader reference that the walk cannot follow`
      // ... and each spec takes a capability that only a pinned harness module may hold (CONF-8's
      // default deny): Vite, node:vm, and a package that no allowlist names
      const uses = (path: string, line: number, code: string, capability: string) =>
        `${path}:${line} ${code} uses ${capability}, which only a pinned harness module may hold`
      assert.deepStrictEqual([...list.problems].sort(), [
        uses("test/verify/zz-b1-outside.spec.ts", 2, `import { runnerImport } from "vite"`, "vite"),
        uses("test/verify/zz-b1.spec.ts", 2, `import { runnerImport } from "vite"`, "vite"),
        uses("test/verify/zz-b3.spec.ts", 2, `import { createServer } from "vite"`, "vite"),
        uses("test/verify/zz-k1-outside.spec.ts", 2, `import { retryWith } from "zz-outside/zz-retry.ts"`, "zz-outside/zz-retry.ts"),
        uses("test/verify/zz-k1.spec.ts", 2, `import { retryWith } from "zz-shared/zz-retry.ts"`, "zz-shared/zz-retry.ts"),
        uses("test/verify/zz-real.spec.ts", 1, `import { real } from "zz-real"`, "zz-real"),
        uses("test/verify/zz-v1.spec.ts", 3, `import { runInThisContext } from "node:vm"`, "node:vm"),
        "node_modules/zz-outside: a folder outside the repository and the dependency store",
        loader("test/verify/zz-b1-outside.spec.ts", 2, `import { runnerImport } from "vite"`),
        loader("test/verify/zz-b1-outside.spec.ts", 3, "runnerImport"),
        loader("test/verify/zz-b1.spec.ts", 2, `import { runnerImport } from "vite"`),
        loader("test/verify/zz-b1.spec.ts", 3, "runnerImport"),
        loader("test/verify/zz-b3.spec.ts", 2, `import { createServer } from "vite"`),
        loader("test/verify/zz-b3.spec.ts", 4, "server.ssrLoadModule"),
        `test/verify/zz-k1-outside.spec.ts: "zz-outside/zz-retry.ts" names a package outside the repository and the dependency store`,
        loader("test/verify/zz-v1.spec.ts", 3, `import { runInThisContext } from "node:vm"`)
      ].sort())
      // The name check finds the key in every listed module that holds it: the module that B1, B3,
      // V1 and K1 reach in shared/, and the modules that nothing reaches
      const scans = scanModules(list.paths, (path) => readPackageFile(path, root))
      assert.deepStrictEqual(scans.flatMap((scan) => scan.flakyTestTexts), [
        `../nested/zz-nested.ts:1 "flakyTest"`,
        `../shared/zz-retry.js:1 "flakyTest"`,
        `../shared/zz-retry.ts:1 "flakyTest"`,
        `../tools/.hidden/zz-untracked.ts:1 "flakyTest"`,
        `../tools/zz-tracked.ts:1 "flakyTest"`,
        `coverage/zz-ignored.ts:1 "flakyTest"`,
        `node_modules/zz-planted/index.js:1 "flakyTest"`,
        `test/verify/node_modules/zz-helper.ts:1 "flakyTest"`
      ])

      // A package folder that is no git checkout fails the check, so a copy without git cannot
      // pass it with the package folder alone
      const bare = yield* fixtureRoot([["core/test/verify/zz.spec.ts", CLEAN_SPEC]])
      assert.include(scanList(join(bare, "core")).problems, "the package folder: no git repository holds it")
    }), 60_000)

  it.effect("[CONF-8] the walk reads the file that each literal specifier loads, whatever its name or suffix, and names each one it cannot read: the seventh Layer-3 review's Y1, Y3, Y4, Y5, K1f, Y6 and PIN1 fail CONF-8", () =>
    Effect.gen(function* () {
      // Negative fixtures (the seventh Layer-3 review): specs of the package core/ take
      // `retryWith = (api) => Reflect.get(api, "flakyTest")` from a module of the repository whose
      // name has no script extension (Y1, Y2), from a module outside the repository by a specifier
      // with a query or hash suffix (Y3, Y3b, Y3c) or by Vite's /@fs/ prefix (Y4), from a folder
      // outside the repository whose package.json names its entry (Y5), and from a file:
      // dependency whose folder lies outside the repository, which pnpm copies into its store
      // (K1f). A spec names a module that no file holds, and one names a module of an installed
      // dependency by its path
      const retry = `export const retryWith = (api) => Reflect.get(api, "flakyTest")\n`
      const user = (specifier: string): string =>
        `import { it } from "@effect/vitest"\n// @ts-expect-error a module without types\nimport { retryWith } from "${specifier}"\nexport const retry = retryWith(it)\n`
      const dynamicUser = (specifier: string): string =>
        `import { it } from "@effect/vitest"\nconst { retryWith } = (await import("${specifier}")) as { retryWith: (api: object) => unknown }\nexport const retry = retryWith(it)\n`
      const outside = "../../../../outside"
      const fileDependency = "node_modules/.pnpm/zz-outside@file+..+..+outside+zz-dep/node_modules/zz-outside"
      // A path install of the store that no manifest names
      const unnamedDependency = "node_modules/.pnpm/zz-unnamed@file+..+zz-unnamed/node_modules/zz-unnamed"
      const base = yield* fixtureRoot([
        ["repo/.gitignore", "node_modules/\n"],
        ["repo/core/package.json", `${JSON.stringify({ name: "core", type: "module", devDependencies: { "zz-outside": "file:../../outside/zz-dep" } })}\n`],
        ["repo/core/test/verify/zz-y1.spec.ts", user("./zz-retry")],
        ["repo/core/test/verify/zz-retry", retry],
        ["repo/core/test/verify/zz-y2.spec.ts", user("./zz-retry.es")],
        ["repo/core/test/verify/zz-retry.es", retry],
        ["repo/core/test/verify/zz-y3.spec.ts", user(`${outside}/zz-retry.ts?v=1`)],
        ["repo/core/test/verify/zz-y3b.spec.ts", dynamicUser(`${outside}/zz-retry-b.ts?x`)],
        ["repo/core/test/verify/zz-y3c.spec.ts", user(`${outside}/zz-retry-c.ts#x`)],
        ["repo/core/test/verify/zz-y5.spec.ts", user(`${outside}/zz-pkg`)],
        ["repo/core/test/verify/zz-k1f.spec.ts", user("zz-outside/zz-retry.js")],
        ["repo/core/test/verify/zz-k1u.spec.ts", user("zz-unnamed/zz-retry.js")],
        ["repo/core/test/verify/zz-missing.spec.ts", user("./zz-missing")],
        ["repo/core/test/verify/zz-store.spec.ts", user("../../node_modules/zz-real/index.js")],
        [`repo/core/${fileDependency}/package.json`, `${JSON.stringify({ name: "zz-outside", type: "module" })}\n`],
        [`repo/core/${fileDependency}/zz-retry.js`, retry],
        [`repo/core/${unnamedDependency}/zz-retry.js`, retry],
        ["repo/core/node_modules/.pnpm/zz-real@1.0.0/node_modules/zz-real/index.js", `export const real = 1\n`],
        ["outside/zz-retry.ts", retry],
        ["outside/zz-retry-b.ts", retry],
        ["outside/zz-retry-c.ts", retry],
        ["outside/zz-retry-d.ts", retry],
        ["outside/zz-pkg/package.json", `${JSON.stringify({ name: "zz-pkg", type: "module", main: "lib.js" })}\n`],
        ["outside/zz-pkg/lib.js", retry],
        ["outside/zz-dep/package.json", `${JSON.stringify({ name: "zz-outside", type: "module" })}\n`],
        ["outside/zz-dep/zz-retry.js", retry]
      ])
      const root = join(base, "repo", "core")
      // Y4: Vite's /@fs/ prefix names a file by its absolute path
      writeFileSync(join(root, "test/verify/zz-y4.spec.ts"), user(`/@fs${join(realpathSync(base), "outside", "zz-retry-d.ts")}`))
      symlinkSync(join(".pnpm", "zz-outside@file+..+..+outside+zz-dep", "node_modules", "zz-outside"), join(root, "node_modules", "zz-outside"), "dir")
      symlinkSync(join(".pnpm", "zz-real@1.0.0", "node_modules", "zz-real"), join(root, "node_modules", "zz-real"), "dir")
      git(join(base, "repo"), ["init", "-q"])
      symlinkSync(join(".pnpm", "zz-unnamed@file+..+zz-unnamed", "node_modules", "zz-unnamed"), join(root, "node_modules", "zz-unnamed"), "dir")

      const list = scanList(root)
      // The walk reads each module that a suffixed, a /@fs/ or an extensionless specifier loads
      assert.deepStrictEqual(list.paths, [
        "../../outside/zz-retry-b.ts",
        "../../outside/zz-retry-c.ts",
        "../../outside/zz-retry-d.ts",
        "../../outside/zz-retry.ts",
        "test/verify/zz-k1f.spec.ts",
        "test/verify/zz-k1u.spec.ts",
        "test/verify/zz-missing.spec.ts",
        "test/verify/zz-retry",
        "test/verify/zz-retry.es",
        "test/verify/zz-store.spec.ts",
        "test/verify/zz-y1.spec.ts",
        "test/verify/zz-y2.spec.ts",
        "test/verify/zz-y3.spec.ts",
        "test/verify/zz-y3b.spec.ts",
        "test/verify/zz-y3c.spec.ts",
        "test/verify/zz-y4.spec.ts",
        "test/verify/zz-y5.spec.ts"
      ])
      // A folder with a package.json, a file: dependency outside the repository, a specifier that
      // names no file and a path into the dependency store are walk problems
      // ... and a spec that names a package which no allowlist names takes a capability (CONF-8's default deny)
      assert.deepStrictEqual([...list.problems].sort(), [
        `test/verify/zz-k1f.spec.ts:3 import { retryWith } from "zz-outside/zz-retry.js" uses zz-outside/zz-retry.js, which only a pinned harness module may hold`,
        `test/verify/zz-k1u.spec.ts:3 import { retryWith } from "zz-unnamed/zz-retry.js" uses zz-unnamed/zz-retry.js, which only a pinned harness module may hold`,
        `test/verify/zz-k1f.spec.ts: "zz-outside/zz-retry.js" names a file: dependency outside the repository, which pnpm copies into its dependency store`,
        `test/verify/zz-k1u.spec.ts: "zz-unnamed/zz-retry.js" names a file: dependency of the dependency store that no manifest names`,
        `test/verify/zz-missing.spec.ts: "./zz-missing" names no file that the walk can read`,
        `test/verify/zz-store.spec.ts: "../../node_modules/zz-real/index.js" names a module of an installed dependency by its path`,
        `test/verify/zz-y5.spec.ts: "${outside}/zz-pkg" names a folder with a package.json, whose entry the walk does not read`
      ].sort())
      // The name check reads each module the walk reached, whatever its name
      const scans = scanModules(list.paths, (path) => readPackageFile(path, root))
      assert.deepStrictEqual(scans.flatMap((scan) => scan.flakyTestTexts), [
        `../../outside/zz-retry-b.ts:1 "flakyTest"`,
        `../../outside/zz-retry-c.ts:1 "flakyTest"`,
        `../../outside/zz-retry-d.ts:1 "flakyTest"`,
        `../../outside/zz-retry.ts:1 "flakyTest"`,
        `test/verify/zz-retry:1 "flakyTest"`,
        `test/verify/zz-retry.es:1 "flakyTest"`
      ])
      // The walk strips the suffix and maps /@fs/ as Vite does
      assert.include(walkCandidates("test/verify/zz.spec.ts", "../../scripts/clean.ts?raw", PKG_ROOT) ?? [], "scripts/clean.ts")
      assert.include(walkCandidates("test/verify/zz.spec.ts", "../../scripts/clean.ts#x", PKG_ROOT) ?? [], "scripts/clean.ts")
      assert.include(walkCandidates("test/verify/zz.spec.ts", `/@fs${join(PKG_ROOT, "scripts/clean.ts")}`, PKG_ROOT) ?? [], "scripts/clean.ts")

      // Y6 (the seventh review): the Function constructor through a map of property descriptors.
      // A constructor member is read only for its name, and a descriptor map is taken only to copy
      // the properties of a value that is no function onto another value
      const flagged: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
        [
          `const F = Object.getOwnPropertyDescriptors(Function.prototype).constructor.value\n`,
          ["Object.getOwnPropertyDescriptors(Function.prototype).constructor", "Object.getOwnPropertyDescriptors"]
        ],
        [
          `const F = Object.getOwnPropertyDescriptors(Object.getPrototypeOf(() => 0)).constructor.value\n`,
          ["Object.getOwnPropertyDescriptors(Object.getPrototypeOf(() => 0)).constructor", "Object.getOwnPropertyDescriptors"]
        ],
        [`const [first] = Object.values(Object.getOwnPropertyDescriptors(Function.prototype))\n`, ["Object.getOwnPropertyDescriptors"]],
        [`const target = {}\nObject.defineProperties(target, Object.getOwnPropertyDescriptors(Function.prototype))\n`, ["Object.getOwnPropertyDescriptors"]],
        [`const take = Object.getOwnPropertyDescriptors\n`, ["Object.getOwnPropertyDescriptors"]],
        [`const { getOwnPropertyDescriptors: take } = Object\n`, ["getOwnPropertyDescriptors: take"]],
        [`const make = (value: object) => value.constructor.prototype\n`, ["value.constructor"]]
      ]
      for (const [body, codes] of flagged) {
        assert.deepStrictEqual(loaderProblems(`import { it } from "@effect/vitest"\n${body}`), codes, body)
      }
      // A string whose whole text is that name is a key that reaches it at run time
      assert.deepStrictEqual(
        scanModules([LOADER_PROBE], (path) => (path === LOADER_PROBE ? `const take = Reflect.get(Object, "getOwnPropertyDescriptors")\n` : undefined))
          .flatMap((scan) => scan.loaderTexts.map(codeOf)),
        [`"getOwnPropertyDescriptors"`]
      )
      // The copies of src/Actor.ts and test/upstream/trackEntries.ts, and a constructor's name, are no such reference
      for (const body of [
        `const members = { a: 1 }\nconst target = {}\nexport const copy = Object.defineProperties(target, Object.getOwnPropertyDescriptors(members))\n`,
        `const name = (value: object) => value.constructor.name\n`
      ]) {
        assert.deepStrictEqual(loaderProblems(body), [], body)
      }

      // PIN1 (the seventh review): PARITY-2's pinned sandbox runs only its own two upstream
      // helpers; a call that hands it another file, a data file or an extensionless module of the
      // repository, ends the pin, so the walk reports the sandbox's loader again
      const parity = "test/verify/verify-xstate-5-33-2-port-PARITY-2.spec.ts"
      const paritySource = readPackageFile(parity) ?? ""
      assert.isAbove(paritySource.length, 0)
      assert.deepStrictEqual(moduleFacts(paritySource, parity).loaderReferences, [], "the pin holds on the real file")
      for (const helper of ["test/upstream/zz-helper.txt", "test/upstream/zz-helper", "test/upstream/zz-helper.ts"]) {
        const planted = `${paritySource}\nexport const zzSandbox = loadHelper("${helper}", { "@effect/vitest": { it } })\n`
        assert.deepStrictEqual(moduleFacts(planted, parity).loaderReferences.map(codeOf), [`import { compileFunction } from "node:vm"`], helper)
      }
    }), 60_000)

  it.effect("[CONF-8] a resolve alias of a Vite or Vitest config of the package that names a folder outside the package folder, or that the walk cannot read, fails CONF-8", () =>
    Effect.gen(function* () {
      const base = yield* fixtureRoot([
        [
          "core/vitest.config.ts",
          `import { defineConfig } from "vitest/config"\nexport default defineConfig({\n  resolve: {\n    alias: {\n      "@": "./src",\n      "~shared": "../shared"\n    }\n  },\n  test: {\n    alias: [\n      { find: /^zz$/, replacement: "/zz-outside/zz.ts" },\n      { find: "ok", replacement: "./src/ok.ts" }\n    ]\n  }\n})\n`
        ],
        ["core/vite.config.mts", `const aliases = { "~shared": "../shared" }\nexport default { resolve: { alias: aliases, tsconfigPaths: true } }\n`],
        // The form of the default config's flakyTest guard: a path from the config file's own folder
        [
          "core/vitest.guard.config.ts",
          `import { fileURLToPath } from "node:url"\nexport default {\n  resolve: {\n    alias: [\n      { find: "in", replacement: fileURLToPath(new URL("./src/ok.ts", import.meta.url)) },\n      { find: "out", replacement: fileURLToPath(new URL("../shared/zz.ts", import.meta.url)) },\n      { find: "base", replacement: fileURLToPath(new URL("./src/ok.ts", "file:///elsewhere/")) }\n    ]\n  }\n}\n`
        ],
        ["core/src/ok.ts", "export const ok = 1\n"],
        ["shared/zz.ts", "export const shared = 1\n"]
      ])
      const root = join(base, "core")
      git(root, ["init", "-q"])
      assert.deepStrictEqual([...scanList(root).problems].sort(), [
        "vite.config.mts:2 alias: aliases is an alias that the walk cannot read",
        "vite.config.mts:2 tsconfigPaths: true is an alias that the walk cannot read",
        `vitest.config.ts:6 "~shared": "../shared" names ../shared, outside the package folder`,
        `vitest.config.ts:11 { find: /^zz$/, replacement: "/zz-outside/zz.ts" } names /zz-outside/zz.ts, outside the package folder`,
        `vitest.guard.config.ts:6 { find: "out", replacement: fileURLToPath(new URL("../shared/zz.ts", import.meta.url)) } names ../shared/zz.ts, outside the package folder`,
        `vitest.guard.config.ts:7 { find: "base", replacement: fileURLToPath(new URL("./src/ok.ts", "file:///elsewhere/")) } is an alias that the walk cannot read`
      ].sort())

      // The package's own config files name no such alias, also as Vitest resolves them (a plugin
      // may add one): each alias names the package folder (the default config's `@`) or Vite's own
      // client modules in the dependency store, none has a resolver of its own, and no config
      // resolves the paths of a tsconfig
      assert.deepStrictEqual(configAliasProblems(PKG_ROOT, readPackageFile), [])
      for (const config of PACKAGE_CONFIGS) {
        const resolved = yield* resolvedAliases(config)
        assert.include(resolved.replacements, "./src", config)
        assert.deepStrictEqual(resolved.replacements.filter((target) => !isAliasInPackage(target)), [], config)
        assert.strictEqual(resolved.customResolvers, 0, config)
        assert.isNotOk(resolved.tsconfigPaths, config)
      }
      // Negative fixtures of the check of a resolved alias: a folder outside the package folder and
      // a URL fail it
      assert.isFalse(isAliasInPackage("../shared"))
      assert.isFalse(isAliasInPackage("/zz-outside/zz.ts"))
      assert.isFalse(isAliasInPackage("data:text/javascript,1"))
      assert.isTrue(isAliasInPackage("./src/index.ts"))
    }), 60_000)

  it.effect("[CONF-8] the scan reads every script module under test/, in dot folders and in test/verify/fixtures/ too, so it reads every file that the default config collects", () =>
    Effect.gen(function* () {
      // The package: the list that the scan and the lint checks read holds each file that the
      // default config's include collects, so a blind spot of the list fails here
      const collected = yield* collectedByDefaultConfig(PKG_ROOT)
      assert.isAbove(collected.length, 100)
      for (const path of ["test/smoke.test.ts", "test/verify/verify-xstate-5-33-2-port-CONF-8.spec.ts"]) {
        assert.include(collected, path)
      }
      assert.deepStrictEqual(notListed(collected, scanList().paths), [])
      assert.deepStrictEqual(notListed(collected, lintedFiles()), [])

      // Negative fixtures (the third Layer-3 review): a package root with a spec in a dot folder,
      // a helper beside it, a dot file, a spec and a text fixture under test/verify/fixtures/
      const root = yield* fixtureRoot([
        [DOT_FOLDER_SPEC, `import { it } from "@effect/vitest"\nconst retry = it.flakyTest\n`],
        ["test/verify/.probe/helpers.ts", `export { flakyTest as retryUntil } from "@effect/vitest"\n`],
        [FIXTURES_SPEC, `import { it } from "@effect/vitest"\nconst retry = Reflect.get(it, "flakyTest")\n`],
        ["test/verify/fixtures/source.ts.txt", `it.flakyTest(Effect.void)\n`],
        ["test/.zz-probe.test.ts", `import { it } from "vitest"\nit.fails("x", () => {})\n`],
        ["test/verify/visible.spec.ts", CLEAN_SPEC]
      ])
      git(root, ["init", "-q"])
      // Vitest's include collects the dot folder, the dot file and the fixtures folder
      const fixtureCollected = yield* collectedByDefaultConfig(root)
      assert.deepStrictEqual(fixtureCollected, ["test/.zz-probe.test.ts", DOT_FOLDER_SPEC, FIXTURES_SPEC, "test/verify/visible.spec.ts"])
      // The list holds each of them and the helper; a text fixture is not a script module
      const listed = scanList(root).paths
      assert.deepStrictEqual(listed, [
        "test/.zz-probe.test.ts",
        "test/verify/.probe/helpers.ts",
        DOT_FOLDER_SPEC,
        FIXTURES_SPEC,
        "test/verify/visible.spec.ts"
      ])
      assert.deepStrictEqual(notListed(fixtureCollected, listed), [])
      // A list with either blind spot of the review fails the check: no dot folder or dot file,
      // or no file under test/verify/fixtures/
      assert.deepStrictEqual(
        notListed(fixtureCollected, listed.filter((path) => !path.split("/").some((name) => name.startsWith(".")))),
        [
          "test/.zz-probe.test.ts: the default config collects it, and the scan does not read it",
          `${DOT_FOLDER_SPEC}: the default config collects it, and the scan does not read it`
        ]
      )
      assert.deepStrictEqual(notListed(fixtureCollected, listed.filter((path) => !path.startsWith(FIXTURES))), [
        `${FIXTURES_SPEC}: the default config collects it, and the scan does not read it`
      ])
      // The scan and the name check find each plant through the list
      const scans = scanModules(listed, (path) => readPackageFile(path, root))
      assert.deepStrictEqual(scans.flatMap((scan) => scan.forms), [
        "test/.zz-probe.test.ts:2 it.fails",
        "test/verify/.probe/helpers.ts:1 flakyTest as retryUntil",
        `${DOT_FOLDER_SPEC}:2 it.flakyTest`
      ])
      assert.deepStrictEqual(scans.flatMap((scan) => scan.flakyTestNames), [
        "test/verify/.probe/helpers.ts:1 flakyTest",
        `${DOT_FOLDER_SPEC}:2 flakyTest`
      ])
      assert.deepStrictEqual(scans.flatMap((scan) => scan.flakyTestTexts), [`${FIXTURES_SPEC}:2 "flakyTest"`])
    }), 60_000)

  it.effect("[CONF-8] the scan finds each AC 28 form on every chain of the test API: it, test, describe, suite, it.effect, it.live, it.prop, it.layer, it.each, it.concurrent and an alias", () =>
    Effect.sync(() => {
      // Each chain, with the lines that declare it, and the code of the chain in a found form
      const chains: ReadonlyArray<readonly [setup: string, chain: string]> = [
        ["", "it"],
        ["", "test"],
        ["", "describe"],
        ["", "suite"],
        ["", "it.effect"],
        ["", "it.live"],
        ["", "it.prop"],
        ["", "it.layer(TestLayer)"],
        ["", "it.each([1, 2])"],
        ["", "it.concurrent"],
        ["", "describe.concurrent"],
        ["const check = it.effect\n", "check"],
        [`import { it as spec } from "@effect/vitest"\n`, "spec.live"],
        [`import * as vitest from "vitest"\n`, "vitest.test"]
      ]
      // Each modifier, with the call that uses it
      const modifiers: ReadonlyArray<readonly [name: string, call: string]> = [
        ["skip", `("x", () => {})`],
        ["skipIf", `(true)("x", () => {})`],
        ["runIf", `(false)("x", () => {})`],
        ["todo", `("x")`],
        ["only", `("x", () => {})`],
        ["fails", `("x", () => {})`],
        ["flakyTest", `(Effect.void)`]
      ]
      for (const [setup, chain] of chains) {
        for (const [name, call] of modifiers) {
          const fixture = `${setup}${chain}.${name}${call}\n`
          assert.deepStrictEqual(formsIn(fixture), [`${chain}.${name}`], `the scan must find ${chain}.${name} in: ${fixture}`)
        }
      }
      // A modifier on the test API that it.layer passes to its body, under any name
      for (const [name, call] of modifiers) {
        const fixture = `it.layer(TestLayer)("group", (t) => {\n  t.effect.${name}${call}\n})\n`
        assert.deepStrictEqual(formsIn(fixture), [`t.effect.${name}`], `the scan must find t.effect.${name} in: ${fixture}`)
      }
      // flakyTest imported by name, the test context's skip, a modifier taken apart, and the options
      const flaggedAs: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
        [`import { flakyTest } from "@effect/vitest"\nconst run = flakyTest(Effect.void)`, ["flakyTest"]],
        [`import { flakyTest as retried } from "@effect/vitest"\nconst run = retried(Effect.void)`, ["flakyTest as retried"]],
        [`import { assert, flakyTest } from "vitest"`, ["flakyTest"]],
        [`it.effect("x", (ctx) => {\n  ctx.skip()\n  return Effect.void\n})`, ["ctx.skip"]],
        [`it("x", (context) => {\n  context.skip(true, "note")\n})`, ["context.skip"]],
        [`it("x", ({ skip }) => {\n  skip()\n})`, ["skip()"]],
        [`const { fails } = it\nfails("x", () => {})`, [`fails("x", () => {})`]],
        [`it("x", { fails: true }, () => {})`, ["fails: true"]],
        [`it.effect("x", () => Effect.void, { fails: true })`, ["fails: true"]],
        [`describe("d", { retry: 3 }, () => {})`, ["retry: 3"]],
        [`test("x", () => {}, { retry: 2 })`, ["retry: 2"]],
        [`it.effect("x", () => Effect.void, { retry: { count: 2 } })`, ["retry: { count: 2 }"]],
        [`const options = { timeout: 5, retry: 1 }\nit.live("x", () => Effect.void, options)`, ["retry: 1"]],
        [`it.prop("x", [Schema.Number], () => {}, { fails: true })`, ["fails: true"]],
        // The routes of the Layer-3 review, each for fails and for flakyTest, which no test option
        // shows at run time: a member the scan cannot read, a type-asserted test API, and the
        // test API of a dynamic import or a require
        [`const k = "fails"\nit[k]("x", () => {})`, ["it[k]"]],
        [`const k = "flakyTest"\nconst run = it.effect[k](Effect.void)`, ["it.effect[k]"]],
        [`const t2 = it.extend({})\nconst f = t2[k]`, ["t2[k]"]],
        [`const { [k]: pick } = it\npick("x", () => {})`, ["[k]: pick"]],
        [`const f = (it as any).fails\nf("x", () => {})`, ["(it as any).fails"]],
        [`const f = (<any>it).flakyTest`, ["(<any>it).flakyTest"]],
        [`const flaky = (it satisfies object as any).flakyTest`, ["(it satisfies object as any).flakyTest"]],
        [`const { it: t } = await import("vitest")\nconst f = t.fails\nf("x", () => {})`, ["t.fails"]],
        [`const { it: t } = await import("@effect/vitest")\nconst run = t.flakyTest`, ["t.flakyTest"]],
        [`const { flakyTest: retried } = await import("@effect/vitest")\nconst run = Effect.void.pipe(retried)`, ["flakyTest: retried"]],
        [`const { flakyTest } = require("@effect/vitest")`, ["flakyTest"]],
        [`const v = await import("vitest")\nconst f = v.it.fails`, ["v.it.fails"]],
        [`const f = (await import("@effect/vitest")).it.flakyTest`, [`(await import("@effect/vitest")).it.flakyTest`]],
        [`const { describe: d } = require("vitest")\nconst o = d.only`, ["d.only"]],
        // The routes of the second Layer-3 review: a test helper that re-exports a modifier or the
        // whole test-API module, a require from createRequire, and an object that wraps the test API
        [`export { flakyTest } from "@effect/vitest"`, ["flakyTest"]],
        [`export { assert, flakyTest as probeFlaky } from "@effect/vitest"`, ["flakyTest as probeFlaky"]],
        [`export { fails as expectFailure, it } from "vitest"`, ["fails as expectFailure"]],
        [`export * from "@effect/vitest"`, [`export * from "@effect/vitest"`]],
        [`export * as v from "vitest"`, [`export * as v from "vitest"`]],
        [`import { createRequire } from "node:module"\nconst { flakyTest } = createRequire(import.meta.url)("@effect/vitest")`, ["flakyTest"]],
        [`import { createRequire } from "node:module"\nconst load = createRequire(import.meta.url)\nconst { it: t } = load("vitest")\nconst f = t.fails`, ["t.fails"]],
        [`import { createRequire as cr } from "node:module"\nconst run = cr(import.meta.url)("@effect/vitest").it.flakyTest`, [`cr(import.meta.url)("@effect/vitest").it.flakyTest`]],
        [`const { createRequire: make } = await import("node:module")\nconst load = make(import.meta.url)\nconst api = load("@effect/vitest")\nconst f = api.it[k]`, ["api.it[k]"]],
        [`const load = module.createRequire(import.meta.url)\nconst { flakyTest: retried } = load("@effect/vitest")`, ["flakyTest: retried"]],
        [`import v = require("vitest")\nconst f = v.it.fails`, ["v.it.fails"]],
        [`const api = { it }\nconst run = api.it.flakyTest`, ["api.it.flakyTest"]],
        [`const api = { spec: it.effect }\nconst f = api.spec[k]`, ["api.spec[k]"]],
        [`const all = [describe, ...[test]]\nconst o = all[0].only`, ["all[0].only"]]
      ]
      for (const [fixture, codes] of flaggedAs) {
        assert.deepStrictEqual(formsIn(fixture), codes, `the scan must find ${codes.join(", ")} in: ${fixture}`)
      }
      // Code that only looks alike is not found
      const clean = [
        `const run = Effect.retry(task, Schedule.recurs(2))`,
        `const retried = Stream.retry(stream, schedule)`,
        `it.effect("x", () => Effect.void, { timeout: 5, fails: false })`,
        `const expected = task.options.fails !== true`,
        `const kinds = ["fails", "flakyTest", "retry"]`,
        `const flakyTestCount = 0`,
        `const options = { retryCount: 1 }\nit.live("x", () => Effect.void, { timeout: 5 })`,
        `it.effect("x", () => Effect.retry(Effect.void, { times: 2 }))`,
        `it.effect("x", () => Effect.sync(() => rows[index]))`,
        `const cases = it.each([1, 2])[0]`,
        `const witnesses = tests.map((test) => (test.meta() as Readonly<Record<string, unknown>>)[WITNESS_KEY])`,
        `const { expect } = await import("vitest")\nexpect({ skip: true }).toEqual({ skip: true })`,
        `const { it: helper } = await import("./helpers.js")\nconst f = helper.fails`,
        `const module = await import("node:path")\nconst key = module[name]`,
        `export { assert, expect, it } from "@effect/vitest"`,
        `export * from "./helpers.js"`,
        `import { createRequire } from "node:module"\nconst load = createRequire(import.meta.url)\nconst path = load.resolve("@effect/vitest")\nconst { fails } = load("./helpers.js")`,
        `const api = { name: "x", retries: 2 }\nconst value = api[key]`
      ]
      for (const fixture of clean) {
        assert.deepStrictEqual(formsIn(fixture), [], fixture)
      }
    }))

  it.effect("[CONF-8] no Vitest configuration of the package sets retry, no package script passes it, and the default config runs the no-skip guard beside the default reporter, so a default run with a skipped or todo test fails", () =>
    Effect.sync(() => {
      // Every Vitest or Vite configuration file of the package folder, where a run looks for one
      const configs = readdirSync(PKG_ROOT)
        .filter((name) => /^(vite|vitest)\b.*\.(config|workspace|projects)\.[cm]?[jt]s$/.test(name))
        .sort()
      assert.deepStrictEqual(configs, ["vitest.config.ts", "vitest.upstream.config.ts"])
      assert.isUndefined(defaultConfig.test?.retry)
      assert.isUndefined(upstreamConfig.test?.retry)

      const scripts = readJson<{ readonly scripts: Readonly<Record<string, string>> }>("package.json").scripts
      for (const [name, script] of Object.entries(scripts)) {
        assert.notMatch(script, /--retry\b/, `the ${name} script passes no retry`)
      }
      // A --reporter flag would replace the config's reporters, the guard among them
      assert.strictEqual(scripts["test"], "CI=true vitest run")

      const reporters = defaultConfig.test?.reporters
      const list = Array.isArray(reporters) ? reporters : []
      assert.strictEqual(list[0], "default")
      assert.isTrue(list.some((reporter) => reporter instanceof NoSkipReporter), "the default config runs the no-skip guard")
      // A name pattern skips each test whose name it does not match
      assert.isUndefined(defaultConfig.test?.testNamePattern)
    }))

  it.effect("[CONF-8] a default run with a test that expects to fail or retries fails, whatever form set it: the no-skip guard names each one, so a test whose body fails never passes the default run", () =>
    Effect.gen(function* () {
      const root = yield* fixtureRoot(FAILS_GUARD_CASES.map(({ file, source }) => [file, source] as const))
      const files = FAILS_GUARD_CASES.map(({ file }) => file).sort()
      const run = yield* runWithConfig("vitest.config.ts", root, files)
      assert.deepStrictEqual(run.modules, files, "the run collects each fixture")
      assert.isTrue(run.ok, "Vitest itself fails no fixture test, so the guard alone fails the run")
      assert.strictEqual(run.exitCode, 1, "the run must fail")
      assert.deepStrictEqual([...run.report].sort(), FAILS_GUARD_CASES.flatMap(({ report }) => report).sort())

      // Control: without the guard, Vitest passes each test whose body fails under fails, and
      // each test that retries, so the guard is what fails the run above
      const unguarded = yield* runWithConfig("vitest.config.ts", root, files, { reporters: ["default"] })
      assert.isTrue(unguarded.ok)
      assert.include([undefined, 0], unguarded.exitCode, "Vitest alone passes these tests")
      assert.deepStrictEqual(unguarded.report, [])
    }), 60_000)

  it.effect("[CONF-8] the default run blocks every route to flakyTest at run time: the default config gives the flakyTest guard in place of @effect/vitest, through Vite's alias and the setup file's Node resolve hook, so a spec that reaches flakyTest directly, by a key assembled at run time, through an extensionless helper, a ?query import or a createRequire load fails the run, and a run without the guards passes the same specs", () =>
    Effect.gen(function* () {
      // Negative fixtures: a spec on each route to flakyTest retries an Effect that fails twice
      // and asserts three attempts. Through the default config each one fails the run, and the
      // guard names it, also the spec that catches the guard's error; a spec of every other API
      // passes. In the one run without the guards (`runUnguarded`, no config file; every config of
      // the package gives the guard) every spec passes, so each route is live without the guard
      const guarded = FLAKY_TEST_ROUTES.map(({ file, source }) => [`test/${file}`, source("../")] as const)
      const control = FLAKY_TEST_ROUTES.map(({ file, source }) => [`test/upstream/${file}`, source("../../")] as const)
      const root = yield* fixtureRoot([
        ...guarded,
        ...control,
        ["test/zz-retry", FLAKY_TEST_HELPER],
        ["test/upstream/zz-retry", FLAKY_TEST_HELPER],
        ["zz-helpers/zz-retry.ts", FLAKY_TEST_HELPER]
      ])
      const run = yield* runWithConfig("vitest.config.ts", root, guarded.map(([file]) => file))
      assert.deepStrictEqual(run.modules, guarded.map(([file]) => file).sort(), "the run collects each spec")
      assert.strictEqual(run.exitCode, 1, "the run must fail")
      assert.deepStrictEqual(run.passed, ["test/zz-caught.test.ts", "test/zz-clean.test.ts"], "each spec that reaches flakyTest fails")
      assert.deepStrictEqual(
        [...run.flakyTestReport].sort(),
        FLAKY_TEST_ROUTES.flatMap(({ file, route }) => (route === null ? [] : [`test/${file}: ${route}`])).sort()
      )
      const unguarded = yield* runUnguarded(root, control.map(([file]) => file))
      assert.deepStrictEqual(unguarded.modules, control.map(([file]) => file).sort())
      assert.deepStrictEqual(unguarded.passed, unguarded.modules, "without the guard, each route reaches flakyTest and retries")
      assert.isTrue(unguarded.ok)
      assert.include([undefined, 0], unguarded.exitCode)
      assert.deepStrictEqual(unguarded.flakyTestReport, [])

      // The wiring: each config of the package (the default config, and the upstream config: the
      // eighth Layer-3 review's G16r) aliases the exact specifier @effect/vitest, also with a query
      // or hash suffix but never a subpath, to the guard's module
      const guardModule = join(PKG_ROOT, FLAKY_TEST_GUARD)
      const guardAliases = (config: typeof defaultConfig) => aliasEntries(config).filter((entry) => entry.replacement === guardModule)
      for (const config of [defaultConfig, upstreamConfig]) {
        const [alias, ...more] = guardAliases(config)
        assert.isDefined(alias, "the config aliases @effect/vitest to the guard")
        assert.deepStrictEqual(more, [])
        for (const specifier of ["@effect/vitest", "@effect/vitest?x", "@effect/vitest#x"]) {
          assert.isTrue(aliasMatches(alias?.find, specifier), specifier)
        }
        for (const specifier of ["@effect/vitest/utils", "@effect/vitestx", "x/@effect/vitest", "vitest"]) {
          assert.isFalse(aliasMatches(alias?.find, specifier), specifier)
        }
      }
      // The guard's module records each blocked access under the key that the no-skip guard's reporter reads
      const guard = yield* Effect.promise(() => vi.importActual<{ readonly FLAKY_TEST_META: unknown }>("./flaky-test-guard.js"))
      assert.strictEqual(guard.FLAKY_TEST_META, FLAKY_TEST_META)
    }), 60_000)

  it.effect("[CONF-8] a createRequire whose base is not the module's own import.meta.url is a walk problem: the eighth Layer-3 review's G14, G22 and G23 fail CONF-8, and BASELINE-1's resolver from the package folder holds by its exact text while its whole source holds", () =>
    Effect.sync(() => {
      // Negative fixtures (the eighth Layer-3 review): a require based at the flakyTest guard's
      // module (G14), at the real package's package.json (G22), and the createRequire of
      // process.getBuiltinModule("node:module") based at the guard's module (G23); each other base
      const guardBase = `new URL("./flaky-test-guard.ts", import.meta.url)`
      const flagged: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
        [`import { createRequire } from "node:module"\nconst api = createRequire(${guardBase})("@effect/vitest")\n`, [`createRequire(${guardBase})`]],
        [
          `import { realpathSync } from "node:fs"\nimport { createRequire } from "node:module"\nconst base = realpathSync("../../node_modules/@effect/vitest/package.json")\nconst api = createRequire(base)("@effect/vitest")\n`,
          ["createRequire(base)"]
        ],
        [
          `const api = process.getBuiltinModule("node:module").createRequire(${guardBase})("@effect/vitest")\n`,
          [`process.getBuiltinModule("node:module").createRequire(${guardBase})`]
        ],
        [`import { createRequire } from "node:module"\nconst load = createRequire("/tmp/zz.js")\n`, [`createRequire("/tmp/zz.js")`]],
        [`import { createRequire } from "node:module"\nconst load = createRequire(import.meta.dirname)\n`, ["createRequire(import.meta.dirname)"]],
        [`import { createRequire as make } from "node:module"\nmake(new URL("../zz/", import.meta.url))("./zz.cjs")\n`, [`make(new URL("../zz/", import.meta.url))`]],
        [`import * as M from "node:module"\nM.createRequire(import.meta.resolve("./zz.cjs"))("./zz.cjs")\n`, [`M.createRequire(import.meta.resolve("./zz.cjs"))`]],
        [`import { createRequire } from "node:module"\ncreateRequire(import.meta.url, "zz")("./zz.cjs")\n`, [`createRequire(import.meta.url, "zz")`]]
      ]
      for (const [body, codes] of flagged) {
        assert.deepStrictEqual(loaderProblems(body), codes, body)
      }
      // The module's own base: a direct call with a literal specifier, and a resolver
      for (const body of [
        `import { createRequire } from "node:module"\ncreateRequire(import.meta.url)("../zz.cjs")\nconst path = createRequire(import.meta.filename).resolve("effect")\n`,
        `import { createRequire } from "node:module"\nconst resolver = createRequire((import.meta.url))\nconst path = resolver.resolve("effect")\n`
      ]) {
        assert.deepStrictEqual(loaderProblems(body), [], body)
      }
      // BASELINE-1's resolver from the package folder, read only through .resolve, holds by its
      // exact text while its whole source holds; one more line ends it
      const baseline = "test/verify/verify-xstate-5-33-2-port-BASELINE-1.spec.ts"
      const baselineSource = readPackageFile(baseline) ?? ""
      assert.include(baselineSource, `createRequire(join(pkgRoot, "package.json"))`)
      assert.deepStrictEqual(moduleFacts(baselineSource, baseline).loaderReferences, [])
      assert.deepStrictEqual(
        moduleFacts(`${baselineSource}\n// one more line\n`, baseline).loaderReferences.map(codeOf),
        [`createRequire(join(pkgRoot, "package.json"))`]
      )
    }))

  it.effect("[CONF-8] default deny: a module that a test module or a Vitest config reaches imports only allowlisted modules, and only a pinned harness module holds a capability (a child process, a worker, node:vm, a hook of node:module, Vitest's node API, ESLint, the loaders of process and of TypeScript); the eighth Layer-3 review's G16r, G17r and G18r, a planted capability and a plant inside a pinned harness module fail CONF-8", () =>
    Effect.gen(function* () {
      // Negative fixtures (the eighth Layer-3 review): a spec that takes the nested runs of the
      // package's helper (G16r), Vitest's node API (G17r), a child process (G18r) or the delivery
      // helper's child processes; a planted capability in a helper of test/ and in a module of
      // scripts/ that a spec reaches; each other form of a capability; and a plant inside a pinned
      // harness module. The holders are copies of the real ones
      const holderCopy = (path: string, plant = ""): readonly [string, string] => [`core/${path}`, `${readPackageFile(path) ?? ""}${plant}`]
      const base = yield* fixtureRoot([
        ["core/test/verify/zz-g16r.spec.ts", `import { fixtureRoot, runUnguarded, runWithConfig } from "./vitest-runs.js"\nexport const nested = [fixtureRoot, runUnguarded, runWithConfig]\n`],
        holderCopy("test/verify/vitest-runs.ts"),
        ["core/test/verify/zz-g17r.spec.ts", `import { startVitest } from "vitest/node"\nexport const nested = startVitest\n`],
        ["core/test/verify/zz-g18r.spec.ts", `import { spawnSync } from "node:child_process"\nexport const child = spawnSync\n`],
        ["core/test/verify/zz-delivery.spec.ts", `import { runModule } from "./delivery.js"\nexport const child = runModule\n`],
        holderCopy("test/verify/delivery.ts"),
        ["core/test/verify/zz-helper.ts", `import { Worker } from "node:worker_threads"\nexport const worker = Worker\n`],
        ["core/test/verify/zz-reach.spec.ts", `import "./zz-helper.js"\nimport "../../scripts/zz-run.js"\n`],
        ["core/scripts/zz-run.ts", `export { execFileSync as run } from "node:child_process"\n`],
        ["core/test/verify/zz-forms.spec.ts", CAPABILITY_FORMS],
        ["core/test/verify/zz-imports.spec.ts", CAPABILITY_IMPORTS],
        holderCopy("test/verify/pending-rewrite-setup.ts", "\nexport const zzPlant = 1\n"),
        holderCopy("test/verify/skip-scan.ts", "\nexport const zzPlant = 1\n"),
        ["core/test/verify/zz-clean.spec.ts", CAPABILITY_CLEAN]
      ])
      const root = join(base, "core")
      git(root, ["init", "-q"])
      const problems = scanList(root).problems
      const only = ", which only a pinned harness module may"
      const uses = (path: string, line: number, code: string, capability: string) => `${path}:${line} ${code} uses ${capability}${only} hold`
      const forms = "test/verify/zz-forms.spec.ts"
      const imports = "test/verify/zz-imports.spec.ts"
      const expected = [
        `test/verify/zz-g16r.spec.ts imports test/verify/vitest-runs.ts${only} import`,
        `test/verify/zz-g16r.spec.ts takes runUnguarded of test/verify/vitest-runs.ts${only} take`,
        uses("test/verify/zz-g17r.spec.ts", 1, `import { startVitest } from "vitest/node"`, "vitest/node"),
        uses("test/verify/zz-g18r.spec.ts", 1, `import { spawnSync } from "node:child_process"`, "node:child_process"),
        `test/verify/zz-delivery.spec.ts imports test/verify/delivery.ts${only} import`,
        uses("test/verify/zz-helper.ts", 1, `import { Worker } from "node:worker_threads"`, "node:worker_threads"),
        uses("scripts/zz-run.ts", 1, `export { execFileSync as run } from "node:child_process"`, "node:child_process"),
        uses(forms, 4, `import("node:child_process")`, "node:child_process"),
        uses(forms, 5, `createRequire(import.meta.url)("child_process")`, "node:child_process"),
        uses(forms, 6, `vi.importActual("node:vm")`, "node:vm"),
        uses(forms, 7, "process.getBuiltinModule", "process.getBuiltinModule"),
        uses(forms, 9, "process", "process"),
        uses(forms, 10, "process.binding", "process.binding"),
        uses(forms, 11, "dlopen", "process.dlopen"),
        uses(forms, 12, "ts.sys", "typescript.sys"),
        uses(forms, 13, "ts", "typescript"),
        uses(forms, 14, `import("typescript")`, "typescript"),
        uses(forms, 15, "loadTypeScriptPlugins: true", "typescript-eslint loadTypeScriptPlugins"),
        uses(imports, 1, `import { ESLint } from "eslint"`, "eslint"),
        uses(imports, 2, `import { createServer } from "vite"`, "vite"),
        uses(imports, 3, `import * as M from "node:module"`, "node:module"),
        uses(imports, 4, `import { registerHooks } from "node:module"`, "node:module"),
        uses(imports, 5, `import cp = require("node:child_process")`, "node:child_process"),
        uses(imports, 6, `export * from "node:vm"`, "node:vm")
      ]
      assert.includeMembers([...problems], expected)
      // A plant inside a pinned harness module changes its whole source, so its pin no longer holds
      for (const path of ["test/verify/pending-rewrite-setup.ts", "test/verify/skip-scan.ts"]) {
        assert.isTrue(problems.some((problem) => problem.startsWith(`${path}: a harness module whose source does not match its pin (sha256 `)), path)
      }
      // The allowlisted modules, a resolver of the module's own base and plain members of
      // process and TypeScript are no capability; the unplanted copies of the holders hold theirs
      for (const path of ["test/verify/zz-clean.spec.ts", "test/verify/vitest-runs.ts", "test/verify/delivery.ts"]) {
        assert.isFalse(problems.some((problem) => problem.startsWith(`${path}:`) && problem.includes(only)), path)
      }
      // The check itself names exactly these problems and the two plants
      const pinned = (path: string) => `${path}: a harness module whose source does not match its pin (sha256 <hash>)`
      assert.deepStrictEqual(
        capabilityProblems(root, (path) => readPackageFile(path, root)).map((problem) => problem.replace(/\(sha256 [0-9a-f]{64}\)$/, "(sha256 <hash>)")),
        [...expected, pinned("test/verify/pending-rewrite-setup.ts"), pinned("test/verify/skip-scan.ts")].sort()
      )
      // A holder whose entry lists other capabilities than it uses is named too
      const lister = holderCopy("test/verify/delivery.ts", `\nexport { Worker } from "node:worker_threads"\n`)
      const listed = yield* fixtureRoot([lister])
      git(join(listed, "core"), ["init", "-q"])
      assert.includeMembers([...capabilityProblems(join(listed, "core"), (path) => readPackageFile(path, join(listed, "core")))], [
        "test/verify/delivery.ts: a harness module that uses node:child_process, node:worker_threads, and its entry lists node:child_process"
      ])

      // The real package: no module that a test module or a Vitest config reaches uses a
      // capability but a pinned harness module; each holder is reached; and the pins file pins
      // exactly the holders and the whole-source pins of PINNED_LOADERS, each by the SHA-256 of
      // its module, which this file computes itself (so a plant in the scan cannot hide a plant in
      // the scan's own pin)
      assert.deepStrictEqual(capabilityProblems(PKG_ROOT, readPackageFile), [])
      const reached = modulesReachedByTests(PKG_ROOT, readPackageFile)
      for (const holder of CAPABILITY_HOLDERS) {
        assert.include(reached, holder.file)
      }
      const pins = readJson<Readonly<Record<string, string>>>(PINS_FILE)
      assert.deepStrictEqual(
        Object.keys(pins).sort(),
        [...new Set([...CAPABILITY_HOLDERS.map((holder) => holder.file), ...PINNED_LOADERS.filter((pin) => pin.wholeSource).map((pin) => pin.file)])].sort()
      )
      for (const [path, pin] of Object.entries(pins)) {
        assert.strictEqual(createHash("sha256").update(readFileSync(join(PKG_ROOT, path), "utf8")).digest("hex"), pin, `${path} matches its pin`)
      }
    }), 60_000)

  it.effect("[CONF-8] every Vitest config of the repository gives the flakyTest guard, and its Node hook passes on only the guard's own import of the package: a createRequire based at the guard's module or at the package folder (G14, G22, G23), a nested run through the upstream config (G16r), and a builtin that loads or spawns code taken by a test module fail the run", () =>
    Effect.gen(function* () {
      const guardModule = join(PKG_ROOT, FLAKY_TEST_GUARD)
      // Negative fixtures (the eighth Layer-3 review): through the default config, each spec
      // that requires @effect/vitest from the guard's module (G14) or from the real package folder
      // (G22, also its entry module by a relative path) meets the guard; process.getBuiltinModule
      // gives node:module to Vite's module runner alone, so G23 is refused before its createRequire;
      // a test module that takes a builtin which loads or spawns code is refused, also when it
      // catches the error
      const realPackageJson = realpathSync(join(PKG_ROOT, "node_modules/@effect/vitest/package.json"))
      const key = `["flaky", "Test"].join("")`
      const required = (load: string) => `${RETRY_HEADER}import { createRequire } from "node:module"\nconst retry = Reflect.get(${load}.it, ${key})\n${RETRIES_TWICE}`
      const specs: ReadonlyArray<readonly [string, string]> = [
        ["test/zz-g14.test.ts", required(`createRequire(${JSON.stringify(guardModule)})("@effect/vitest")`)],
        ["test/zz-g22.test.ts", required(`createRequire(${JSON.stringify(realPackageJson)})("@effect/vitest")`)],
        ["test/zz-g22-entry.test.ts", required(`createRequire(${JSON.stringify(realPackageJson)})("./dist/index.js")`)],
        ["test/zz-g23.test.ts", required(`process.getBuiltinModule("node:module").createRequire(${JSON.stringify(guardModule)})("@effect/vitest")`)],
        [
          "test/zz-builtin.test.ts",
          `import { assert, it } from "@effect/vitest"\nimport { createRequire } from "node:module"\nit("x", () => {\n  try {\n    createRequire(import.meta.url)("node:child_process")\n  } catch {\n    // the guard records the refusal before it throws\n  }\n  assert.isTrue(true)\n})\n`
        ],
        [
          "test/zz-getbuiltin.test.ts",
          `import { assert, it } from "@effect/vitest"\nit("x", () => {\n  try {\n    process.getBuiltinModule("node:worker_threads")\n  } catch {\n    // the guard records the refusal before it throws\n  }\n  assert.isTrue(true)\n})\n`
        ]
      ]
      // G16r: a spec of the upstream folder that a nested run through the upstream config runs
      const inner = `${RETRY_HEADER}const retry = Reflect.get(it, ${key})\n${RETRIES_TWICE}`
      const root = yield* fixtureRoot([...specs, ["test/upstream/zz-g16r.test.ts", inner]])
      const files = specs.map(([file]) => file)
      const run = yield* runWithConfig("vitest.config.ts", root, files)
      assert.deepStrictEqual(run.modules, [...files].sort())
      assert.strictEqual(run.exitCode, 1, "the run must fail")
      assert.deepStrictEqual(run.passed, ["test/zz-builtin.test.ts", "test/zz-getbuiltin.test.ts"], "each spec that reaches flakyTest fails")
      const report = [...run.flakyTestReport].sort()
      assert.includeMembers(report, ["test/zz-g14.test.ts: it.flakyTest", "test/zz-g22.test.ts: it.flakyTest", "test/zz-g22-entry.test.ts: it.flakyTest"])
      const refused = (file: string, id: string) =>
        report.some((line) => line.startsWith(`${file}: process.getBuiltinModule(${JSON.stringify(id)}) from `) && line.endsWith(`/${file}`))
      assert.isTrue(refused("test/zz-g23.test.ts", "node:module"), report.join("\n"))
      assert.isTrue(report.some((line) => /^test\/zz-builtin\.test\.ts: node:child_process from \S*\/test\/zz-builtin\.test\.ts$/.test(line)), report.join("\n"))
      assert.isTrue(refused("test/zz-getbuiltin.test.ts", "node:worker_threads"), report.join("\n"))
      assert.lengthOf(report, 6, report.join("\n"))
      const nested = yield* runWithConfig("vitest.upstream.config.ts", root, ["test/upstream/zz-g16r.test.ts"])
      assert.deepStrictEqual(nested.modules, ["test/upstream/zz-g16r.test.ts"])
      assert.strictEqual(nested.exitCode, 1, "the nested run through the upstream config must fail")
      assert.deepStrictEqual(nested.passed, [])
      assert.deepStrictEqual(nested.flakyTestReport, ["test/upstream/zz-g16r.test.ts: it.flakyTest"])
      // Control: without the guards each route reaches flakyTest and retries, so the guards are
      // what fail the runs above (the one unguarded run, which CONF-8 alone may take)
      const routes = ["test/zz-g14.test.ts", "test/zz-g22.test.ts", "test/zz-g22-entry.test.ts", "test/zz-g23.test.ts", "test/upstream/zz-g16r.test.ts"]
      const unguarded = yield* runUnguarded(root, routes)
      assert.deepStrictEqual(unguarded.modules, [...routes].sort())
      assert.deepStrictEqual(unguarded.passed, unguarded.modules, "without the guards, each route reaches flakyTest and retries")
      // The helper runs a config of the package alone, and changes nothing of it but its reporters
      for (const attempt of [
        runWithConfig("vitest.zz.config.ts" as never, root, routes),
        runWithConfig("vitest.config.ts", root, routes, { setupFiles: [] } as never),
        runWithConfig("vitest.upstream.config.ts", root, routes, { reporters: [{}] } as never)
      ]) {
        assert.isTrue(Exit.isFailure(yield* Effect.exit(attempt)))
      }

      // The Vitest config files of the repository checkout are the package's two configs; each
      // aliases @effect/vitest to the guard's module and lists the guard's setup file
      const configs = repositoryScriptModules(PKG_ROOT).paths.filter((path) => CONFIG_FILE.test(path.split("/").at(-1) ?? ""))
      assert.deepStrictEqual(configs, ["vitest.config.ts", "vitest.upstream.config.ts"])
      for (const config of [defaultConfig, upstreamConfig]) {
        assert.lengthOf(aliasEntries(config).filter((entry) => entry.replacement === guardModule), 1)
        assert.include(config.test?.setupFiles ?? [], join(PKG_ROOT, FLAKY_TEST_SETUP))
        // No global setup runs in the run's main process, beside the scan's reach
        assert.isUndefined(config.test?.globalSetup)
      }
      // Each setup file of a config is one of the two guards' setup files under test/, which the
      // scan and the default deny read, so a setup file outside test/ (a scripts/ module that no
      // import reaches) runs nothing in a run (the fifth Layer-3 review's N6)
      assert.deepStrictEqual(defaultConfig.test?.setupFiles, [join(PKG_ROOT, "test/verify/pending-rewrite-setup.ts"), join(PKG_ROOT, FLAKY_TEST_SETUP)])
      assert.deepStrictEqual(upstreamConfig.test?.setupFiles, [join(PKG_ROOT, FLAKY_TEST_SETUP)])
    }), 60_000)

  it.effect("[CONF-8] no src file relaxes a rule of the canonical Effect bundle, and the one lint exception of src is SD-22's no-explicit-any in src/internal/anyEventObject.ts: every test file resolves the relaxed test block (with the timer ban in test/upstream), every script the relaxed scripts block, and the config ignores none of them", () =>
    Effect.gen(function* () {
      const canonical = yield* canonicalRules
      assert.isAbove(canonical.length, 0, "the canonical bundle holds rules")
      const files = lintedFiles()
      assert.isAbove(files.filter((path) => path.startsWith("src/")).length, 50)
      assert.include(files, PINNED_EXCEPTION.path)
      // The docs gate's .mjs scripts are in the list, so each must resolve the relaxed scripts block
      assert.includeMembers([...files], [DOCS_GATE, "scripts/docs-audit.test.mjs"])
      const eslint = new ESLint({ cwd: PKG_ROOT })
      assert.deepStrictEqual(yield* lintExceptions(eslint, files, canonical), [])

      // The strict src rules hold exactly the canonical rules of the bundle, each at error, and
      // the pinned file differs from them in exactly the pinned rule, which is off: the pin names
      // no stale path or rule
      const strict = yield* rulesOf(eslint, "src/conf-8-probe.ts")
      assert.deepStrictEqual(Object.keys(strict).filter((rule) => rule.startsWith("effect/")).sort(), canonical)
      assert.deepStrictEqual(canonical.filter((rule) => severityOf(strict, rule) !== 2), [])
      const pinned = yield* rulesOf(eslint, PINNED_EXCEPTION.path)
      assert.deepStrictEqual(differingRules(strict, pinned), [PINNED_EXCEPTION.rule])
      assert.strictEqual(severityOf(pinned, PINNED_EXCEPTION.rule), 0)

      // Negative fixtures: blocks added after the package config. Each kind of exception is named:
      // a canonical rule relaxed for every src file (named for the strict rules and for each src
      // file), a canonical rule relaxed for one src file (also for the files the removed SD-3 and
      // SD-22 blocks named, and for the pinned file), another rule relaxed in the pinned file, the
      // pinned rule relaxed in another file, an ignored src file, a scoped block for one test file
      // and for one script, and inline directives allowed again for one src file and for one test
      // file
      const planted = new ESLint({
        cwd: PKG_ROOT,
        overrideConfig: [
          { files: ["src/**/*.ts"], rules: { "effect/no-throw-use-effect": "warn" } },
          { files: ["src/Actor.ts"], rules: { "effect/no-error-constructor": "off", "@typescript-eslint/no-explicit-any": "off" } },
          { files: ["src/stateUtils.ts"], rules: { "effect/no-set-use-hashset": "off" } },
          { files: ["src/graph/utils.ts"], rules: { "effect/no-array-mutation-use-chunk": "off" } },
          { files: ["src/internal/invariant.ts"], rules: { "effect/no-throw-use-effect": "off" } },
          { files: [PINNED_EXCEPTION.path], rules: { "effect/no-map-use-hashmap": "off", "@typescript-eslint/no-unused-vars": "off" } },
          { ignores: ["src/Snapshot.ts"] },
          { files: ["test/smoke.test.ts"], rules: { "no-console": "error" } },
          { files: ["test/upstream/deep.test.ts"], rules: { "no-restricted-syntax": "off" } },
          { files: ["scripts/clean.ts"], rules: { "no-console": "off" } },
          { files: ["src/index.ts", "test/upstream/initial.test.ts"], linterOptions: { noInlineConfig: false } }
        ]
      })
      assert.deepStrictEqual(
        yield* lintExceptions(planted, [
          "scripts/clean.ts",
          "src/Actor.ts",
          "src/Snapshot.ts",
          "src/graph/utils.ts",
          "src/index.ts",
          PINNED_EXCEPTION.path,
          "src/internal/invariant.ts",
          "src/stateUtils.ts",
          "test/smoke.test.ts",
          "test/upstream/deep.test.ts",
          "test/upstream/initial.test.ts"
        ], canonical),
        [
          "the strict src rules: effect/no-throw-use-effect is not at error",
          "scripts/clean.ts: a scoped lint block (no-console)",
          "src/Actor.ts: a lint exception (@typescript-eslint/no-explicit-any, effect/no-error-constructor, effect/no-throw-use-effect)",
          "src/Snapshot.ts: ignored by the lint config",
          "src/graph/utils.ts: a lint exception (effect/no-array-mutation-use-chunk, effect/no-throw-use-effect)",
          "src/index.ts: inline directives take effect (linterOptions.noInlineConfig is not true)",
          "src/index.ts: a lint exception (effect/no-throw-use-effect)",
          `${PINNED_EXCEPTION.path}: a lint exception (@typescript-eslint/no-unused-vars, effect/no-map-use-hashmap, effect/no-throw-use-effect)`,
          "src/internal/invariant.ts: a lint exception (effect/no-throw-use-effect)",
          "src/stateUtils.ts: a lint exception (effect/no-set-use-hashset, effect/no-throw-use-effect)",
          "test/smoke.test.ts: a scoped lint block (no-console)",
          "test/upstream/deep.test.ts: a scoped lint block (no-restricted-syntax)",
          "test/upstream/initial.test.ts: inline directives take effect (linterOptions.noInlineConfig is not true)"
        ]
      )
      // A canonical rule that the strict rules lack, or a rule beside the canonical ones, is named
      assert.deepStrictEqual(
        yield* lintExceptions(eslint, [], [...canonical.slice(1), "effect/conf-8-probe-rule"].sort()),
        [
          `the strict src rules: the Effect rules differ from the canonical bundle (lacks effect/conf-8-probe-rule; adds ${canonical[0] ?? ""})`,
          "the strict src rules: effect/conf-8-probe-rule is not at error"
        ]
      )

      // Negative fixtures (the third Layer-3 review): the list holds the files of dot folders and
      // of test/verify/fixtures/, so a scoped block for, or an ignore of, one of them is named
      const root = yield* fixtureRoot([
        [DOT_FOLDER_SPEC, CLEAN_SPEC],
        ["test/verify/.probe/ignored.spec.ts", CLEAN_SPEC],
        [FIXTURES_SPEC, CLEAN_SPEC],
        ["test/verify/fixtures/ignored.spec.ts", CLEAN_SPEC],
        ["src/.probe/relaxed.ts", "export const relaxed = 1\n"],
        ["scripts/.probe/ignored.ts", "export const ignored = 1\n"]
      ])
      const hidden = lintedFiles(root)
      assert.deepStrictEqual(hidden, [
        "scripts/.probe/ignored.ts",
        "src/.probe/relaxed.ts",
        "test/verify/.probe/ignored.spec.ts",
        DOT_FOLDER_SPEC,
        "test/verify/fixtures/ignored.spec.ts",
        FIXTURES_SPEC
      ])
      const plantedHidden = new ESLint({
        cwd: PKG_ROOT,
        overrideConfig: [
          { files: [DOT_FOLDER_SPEC], rules: { "no-console": "error" } },
          { ignores: ["test/verify/.probe/ignored.spec.ts"] },
          { files: [FIXTURES_SPEC], rules: { "no-console": "error" } },
          { ignores: ["test/verify/fixtures/ignored.spec.ts"] },
          { files: ["src/.probe/relaxed.ts"], rules: { "effect/no-throw-use-effect": "off" } },
          { ignores: ["scripts/.probe/ignored.ts"] }
        ]
      })
      assert.deepStrictEqual(yield* lintExceptions(plantedHidden, hidden, canonical), [
        "scripts/.probe/ignored.ts: ignored by the lint config",
        "src/.probe/relaxed.ts: a lint exception (effect/no-throw-use-effect)",
        "test/verify/.probe/ignored.spec.ts: ignored by the lint config",
        `${DOT_FOLDER_SPEC}: a scoped lint block (no-console)`,
        "test/verify/fixtures/ignored.spec.ts: ignored by the lint config",
        `${FIXTURES_SPEC}: a scoped lint block (no-console)`
      ])
      // Control: with the package config alone, the same files hold no exception
      assert.deepStrictEqual(yield* lintExceptions(eslint, hidden, canonical), [])
    }), 60_000)

  it.effect("[CONF-8] no comment makes a lint exception: every file of src, test and scripts resolves noInlineConfig, so ESLint ignores each directive comment, and none of them holds one", () =>
    Effect.gen(function* () {
      const files = lintedFiles()
      const readSource = (path: string) => readPackageFile(path)
      assert.deepStrictEqual(inlineDirectives(files, readSource), [])

      // Negative fixtures: ESLint's own reading finds each directive form, the one the Layer-3
      // review planted in src/Snapshot.ts among them, and no such text in a string, a template or
      // a JSDoc comment
      const fixture = "src/conf-8-fixture.ts"
      const directivesIn = (source: string) => inlineDirectives([fixture], (path) => (path === fixture ? source : undefined))
      const planted: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
        [`/* eslint-disable */\nexport const x = 1\n`, ["1 /* eslint-disable */"]],
        [`/*eslint-disable effect/no-throw-use-effect*/\n`, ["1 /*eslint-disable effect/no-throw-use-effect*/"]],
        [
          `export const f = () => {\n  // eslint-disable-next-line effect/no-throw-use-effect, effect/no-error-constructor\n  throw new Error("x")\n}\n`,
          ["2 // eslint-disable-next-line effect/no-throw-use-effect, effect/no-error-constructor"]
        ],
        [`export const y = 1 // eslint-disable-line\n`, ["1 // eslint-disable-line"]],
        [`/* eslint-disable-next-line no-console -- a reason */\n/* eslint-enable */\n`, [
          "1 /* eslint-disable-next-line no-console -- a reason */",
          "2 /* eslint-enable */"
        ]],
        [`/* eslint no-console: "off" */\n/* eslint-env node */\n`, [`1 /* eslint no-console: "off" */`, "2 /* eslint-env node */"]],
        [`/* global window */\n/* globals document */\n/* exported z */\n`, ["1 /* global window */", "2 /* globals document */", "3 /* exported z */"]]
      ]
      for (const [source, found] of planted) {
        assert.deepStrictEqual(directivesIn(source), found.map((entry) => `${fixture}:${entry}`), source)
      }
      const clean = [
        "export const a = `\n// eslint-disable-next-line effect/no-throw-use-effect\n${1}\n/* eslint-disable */\n`\n",
        `export const b = "/* eslint-disable */"\n`,
        `/** Never write an eslint-disable comment. */\nexport const c = 1\n`,
        `// The lint config names each exception; no comment disables a rule.\nexport const d = 1\n`
      ]
      for (const source of clean) {
        assert.deepStrictEqual(directivesIn(source), [], source)
      }
      // A file the parser cannot read is a problem, not a pass
      assert.deepStrictEqual(directivesIn(`/* eslint-disable */\nexport const = \n`).map((entry) => entry.split(" ")[1]), ["not"])

      // Negative fixtures (the third Layer-3 review): the list holds the files of dot folders and
      // of test/verify/fixtures/, so a directive comment in one of them is named
      const root = yield* fixtureRoot([
        [DOT_FOLDER_SPEC, `/* eslint-disable */\n${CLEAN_SPEC}`],
        [FIXTURES_SPEC, `// eslint-disable-next-line no-console\n${CLEAN_SPEC}`],
        ["src/.probe/directive.ts", `export const directive = 1 // eslint-disable-line\n`]
      ])
      assert.deepStrictEqual(inlineDirectives(lintedFiles(root), (path) => readPackageFile(path, root)), [
        "src/.probe/directive.ts:1 // eslint-disable-line",
        `${DOT_FOLDER_SPEC}:1 /* eslint-disable */`,
        `${FIXTURES_SPEC}:1 // eslint-disable-next-line no-console`
      ])

      // With the package config, the directive the review planted silences nothing: a throw in a
      // src file under an eslint-disable-next-line comment still gives both lint errors
      const snapshot = readPackageFile("src/Snapshot.ts") ?? ""
      assert.isAbove(snapshot.length, 0)
      const [result] = yield* Effect.promise(() =>
        new ESLint({ cwd: PKG_ROOT }).lintText(
          `${snapshot}\nexport const conf8Probe = (): never => {\n  // eslint-disable-next-line effect/no-throw-use-effect, effect/no-error-constructor\n  throw new Error("conf-8 probe")\n}\n`,
          { filePath: join(PKG_ROOT, "src/Snapshot.ts") }
        )
      )
      assert.deepStrictEqual(
        (result?.messages ?? []).map((message) => [message.ruleId, message.severity]),
        [[null, 1], ["effect/no-throw-use-effect", 2], ["effect/no-error-constructor", 2]]
      )
    }), 60_000)
})

// ---------------------------------------------------------------- the guard against fails and retry

/** A fixture test file of the no-skip guard, and the lines its report must hold for the file. */
interface FailsGuardCase {
  readonly file: string
  readonly source: string
  readonly report: ReadonlyArray<string>
}

/** The body of a fixture test that fails: under `fails`, Vitest passes it. */
const FAILING_BODY = `() => {\n  throw new Error("the body fails")\n}`

/**
 * One fixture for each route to `fails` that the Layer-3 review found past the source scan (a
 * computed member, a type-asserted test API, the test API of a dynamic import), the `fails`
 * option, `fails` on the `@effect/vitest` API, and the `retry` option on a test and on a suite.
 * The last fixture sets fails and retry to values that change nothing, and the guard names
 * nothing in it.
 */
const FAILS_GUARD_CASES: ReadonlyArray<FailsGuardCase> = [
  {
    file: "test/fails-computed-member.test.ts",
    source: `import { it } from "vitest"\nconst k = "fails"\nit[k]("x", ${FAILING_BODY})\n`,
    report: ["fails test: test/fails-computed-member.test.ts > x"]
  },
  {
    file: "test/fails-type-asserted.test.ts",
    source: `import { it } from "vitest"\nconst f = (it as any).fails\nf("x", ${FAILING_BODY})\n`,
    report: ["fails test: test/fails-type-asserted.test.ts > x"]
  },
  {
    file: "test/fails-dynamic-import.test.ts",
    source: `const { it: t } = await import("vitest")\nt.fails("x", ${FAILING_BODY})\n`,
    report: ["fails test: test/fails-dynamic-import.test.ts > x"]
  },
  {
    file: "test/fails-option.test.ts",
    source: `import { describe, it } from "vitest"\ndescribe("d", () => {\n  it("x", { fails: true }, ${FAILING_BODY})\n})\n`,
    report: ["fails test: test/fails-option.test.ts > d > x"]
  },
  {
    file: "test/fails-effect.test.ts",
    source: `import { it } from "@effect/vitest"\nimport { Effect } from "effect"\nconst k = "fails"\nit.effect[k]("x", () => Effect.fail("the body fails"))\n`,
    report: ["fails test: test/fails-effect.test.ts > x"]
  },
  {
    file: "test/retry-option.test.ts",
    source: `import { describe, it } from "vitest"\nit("x", { retry: 2 }, () => {})\ndescribe("d", { retry: { count: 1 } }, () => {\n  it("y", () => {})\n})\n`,
    // A suite passes its retry option to its tests: the guard names the test
    report: ["retry test: test/retry-option.test.ts > x", "retry test: test/retry-option.test.ts > d > y"]
  },
  {
    file: "test/clean.test.ts",
    source: `import { it } from "vitest"\nit("x", { fails: false, retry: 0 }, () => {})\n`,
    report: []
  }
]

// ---------------------------------------------------------------- the guard against flakyTest

/** The flakyTest guard's module (`flaky-test-guard.ts`), relative to the package root. */
const FLAKY_TEST_GUARD = "test/verify/flaky-test-guard.ts"

/** The flakyTest guard's setup file (`flaky-test-setup.ts`), relative to the package root: every Vitest config of the package lists it. */
const FLAKY_TEST_SETUP = "test/verify/flaky-test-setup.ts"

/** The loader references of the flakyTest guard's setup file, which its pin holds (`PINNED_LOADERS`): the hook and the guards on process. */
const FLAKY_SETUP_REFERENCES: ReadonlyArray<string> = PINNED_LOADERS.find((pin) => pin.file === FLAKY_TEST_SETUP)?.references ?? []

/** The resolve aliases of a config, as entries (`{ find, replacement }`), from either form Vite takes. */
const aliasEntries = (config: { readonly resolve?: { readonly alias?: unknown } | undefined }): ReadonlyArray<{ readonly find: unknown; readonly replacement: unknown }> => {
  const alias = config.resolve?.alias
  if (Array.isArray(alias)) return alias as ReadonlyArray<{ readonly find: unknown; readonly replacement: unknown }>
  return typeof alias === "object" && alias !== null ? Object.entries(alias).map(([find, replacement]) => ({ find, replacement })) : []
}

/** An alias's find takes a specifier, as Vite matches it: a pattern, or a name and its subpaths. */
const aliasMatches = (find: unknown, specifier: string): boolean =>
  find instanceof RegExp ? find.test(specifier) : typeof find === "string" && (specifier === find || specifier.startsWith(`${find}/`))

/** A helper that takes flakyTest from the test API it is given, by a literal key. */
const FLAKY_TEST_HELPER = `export const retryWith = (api) => Reflect.get(api, "flakyTest")\n`

/** The tests of a spec that retries with `retry`: an Effect that fails twice, and a check of its three attempts. */
const RETRIES_TWICE = `
let attempts = 0
const failsTwice = Effect.suspend(() => {
  attempts += 1
  return attempts < 3 ? Effect.fail("boom") : Effect.void
})
it.effect("retries an Effect that fails twice", () => (retry as (self: Effect.Effect<void, string>) => Effect.Effect<void>)(failsTwice))
it("ran three attempts", () => {
  assert.strictEqual(attempts, 3)
})
`

const RETRY_HEADER = `import { assert, it } from "@effect/vitest"\nimport { Effect } from "effect"\n`

/**
 * One spec for each route to flakyTest (the source takes the path from its folder to the fixture
 * root), with the route that the guard names for it, or null for the control spec of the other
 * APIs: directly, by a key assembled at run time, through an extensionless helper, through a
 * module named with a query suffix, through createRequire, by its named import, by the path of
 * the package's entry module, through the methods a layer block gives, and once caught.
 */
const FLAKY_TEST_ROUTES: ReadonlyArray<{ readonly file: string; readonly source: (up: string) => string; readonly route: string | null }> = [
  { file: "zz-direct.test.ts", source: () => `${RETRY_HEADER}const retry = it.flakyTest\n${RETRIES_TWICE}`, route: "it.flakyTest" },
  { file: "zz-assembled.test.ts", source: () => `${RETRY_HEADER}const retry = Reflect.get(it, "flaky" + "Test")\n${RETRIES_TWICE}`, route: "it.flakyTest" },
  {
    file: "zz-extensionless.test.ts",
    source: () => `${RETRY_HEADER}// @ts-expect-error a module without an extension\nimport { retryWith } from "./zz-retry"\nconst retry = retryWith(it)\n${RETRIES_TWICE}`,
    route: "it.flakyTest"
  },
  {
    file: "zz-query.test.ts",
    source: (up) => `${RETRY_HEADER}// @ts-expect-error a query suffix\nimport { retryWith } from "${up}zz-helpers/zz-retry.ts?v=1"\nconst retry = retryWith(it)\n${RETRIES_TWICE}`,
    route: "it.flakyTest"
  },
  {
    file: "zz-require.test.ts",
    source: () => `${RETRY_HEADER}import { createRequire } from "node:module"\nconst retry = createRequire(import.meta.url)("@effect/vitest").it["flaky" + "Test"]\n${RETRIES_TWICE}`,
    route: "it.flakyTest"
  },
  {
    file: "zz-named.test.ts",
    source: () => `${RETRY_HEADER}import * as api from "@effect/vitest"\nconst retry = Reflect.get(api, "flaky" + "Test")\n${RETRIES_TWICE}`,
    route: "flakyTest"
  },
  {
    file: "zz-path.test.ts",
    source: (up) => `${RETRY_HEADER}import * as api from "${up}node_modules/@effect/vitest/dist/index.js"\nconst retry = Reflect.get(api.it, "flaky" + "Test")\n${RETRIES_TWICE}`,
    route: "it.flakyTest"
  },
  {
    file: "zz-layer.test.ts",
    source: () =>
      `import { assert, it, layer } from "@effect/vitest"\nimport { Effect, Layer } from "effect"\nlet attempts = 0\nconst failsTwice = Effect.suspend(() => {\n  attempts += 1\n  return attempts < 3 ? Effect.fail("boom") : Effect.void\n})\nlayer(Layer.empty)("l", (t) => {\n  t.effect("retries an Effect that fails twice", () => (Reflect.get(t, "flaky" + "Test") as (self: Effect.Effect<void, string>) => Effect.Effect<void>)(failsTwice))\n})\nit("ran three attempts", () => {\n  assert.strictEqual(attempts, 3)\n})\n`,
    route: "layer(...) methods.flakyTest"
  },
  {
    file: "zz-caught.test.ts",
    source: () => `import { assert, it } from "@effect/vitest"\nit("x", () => {\n  try {\n    Reflect.get(it, "flaky" + "Test")\n  } catch {\n    // the guard records the access before it throws\n  }\n  assert.isTrue(true)\n})\n`,
    route: "it.flakyTest"
  },
  {
    file: "zz-clean.test.ts",
    source: () => `import { assert, describe, expect, it, layer } from "@effect/vitest"
import { Effect, Layer, Schema } from "effect"
describe("the other APIs", () => {
  it("a plain test", () => {
    expect(1).toBe(1)
  })
  it.effect("it.effect", () => Effect.sync(() => assert.isTrue(true)))
  it.live("it.live", () => Effect.sync(() => assert.isTrue(true)))
  it.effect.each([1, 2])("it.effect.each %s", (n) => Effect.sync(() => assert.isAbove(n, 0)))
  it.each([1, 2])("it.each %s", (n) => {
    assert.isAbove(n, 0)
  })
  it.prop("it.prop", [Schema.Number], ([n]) => typeof n === "number")
  it.layer(Layer.empty)("it.layer", (t) => {
    t.effect("its effect", () => Effect.void)
    t.layer(Layer.empty)("a nested layer", (u) => {
      u.effect("its effect", () => Effect.void)
    })
  })
  layer(Layer.empty)((t) => {
    t.effect("layer", () => Effect.void)
  })
})
`,
    route: null
  }
]

// ---------------------------------------------------------------- the default deny of capabilities

/**
 * A spec that uses a capability in each form of a call or a member (the eighth Layer-3 review's
 * routes and their neighbours), one form per line from line 4: a dynamic import and a require of
 * a builtin that spawns, `vi.importActual` of `node:vm`, `process.getBuiltinModule`, `process`
 * passed to `Reflect.get` with a key assembled at run time, `process.binding`, a destructured
 * `process.dlopen`, `ts.sys`, the TypeScript module passed to `Reflect.get`, a dynamic import of
 * TypeScript, and typescript-eslint's option that loads the plugins of a tsconfig.
 */
const CAPABILITY_FORMS = `import { createRequire } from "node:module"
import ts from "typescript"
import { vi } from "vitest"
const a = await import("node:child_process")
const b = createRequire(import.meta.url)("child_process")
const c = await vi.importActual("node:vm")
const d = process.getBuiltinModule("node:child_process")
const key = ["getBuiltin", "Module"].join("")
const e = Reflect.get(process, key)
const f = process.binding("spawn_sync")
const { dlopen } = process
const host = { ...ts.sys }
const g = Reflect.get(ts, ["sy", "s"].join(""))
const h = await import("typescript")
const options = { loadTypeScriptPlugins: true }
export { a, b, c, d, e, f, dlopen, host, g, h, options }
`

/**
 * A spec that uses a capability in each form of a static import or export, one per line: ESLint,
 * Vite, the namespace of node:module, a hook of node:module, an `import = require` of a builtin
 * that spawns, and an `export *` of node:vm.
 */
const CAPABILITY_IMPORTS = `import { ESLint } from "eslint"
import { createServer } from "vite"
import * as M from "node:module"
import { registerHooks } from "node:module"
import cp = require("node:child_process")
export * from "node:vm"
export const all = [ESLint, createServer, M, registerHooks, cp]
`

/**
 * A spec of the allowlisted modules and the plain members that use no capability: the test API,
 * effect and a subpath of it, pure builtins, createRequire and isBuiltin of node:module with a
 * resolver of the module's own base, rxjs, a static import of TypeScript and a plain member of it,
 * a type import of Vitest's node API, and plain members of process.
 */
const CAPABILITY_CLEAN = `import { assert, it } from "@effect/vitest"
import { Effect } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire, isBuiltin } from "node:module"
import { of } from "rxjs"
import ts from "typescript"
import type { Vitest } from "vitest/node"
import { describe } from "vitest"
const resolved = createRequire(import.meta.url).resolve("effect")
const home = process.env["HOME"]
const kind = typeof process
process.exitCode = 0
const sf = ts.createSourceFile("zz.ts", "", ts.ScriptTarget.Latest)
export const values = [assert, it, Effect, TestClock, readFileSync, join, fileURLToPath, isBuiltin, of, describe, resolved, home, kind, sf] as const
export type Run = Vitest
`

// ---------------------------------------------------------------- the lint exception check

/**
 * The script modules of `src/`, `test/` and `scripts/` of a package root that the lint checks
 * read, sorted: the same enumeration as the scan's list (`scriptModules`), so a file in a dot
 * folder or under `test/verify/fixtures/` is read too.
 */
const lintedFiles = (root: string = PKG_ROOT): ReadonlyArray<string> =>
  [...scriptModules("src", root), ...testModules(root), ...scriptModules("scripts", root)].sort()

/** ESLint's warning for a directive comment that `noInlineConfig` ignores; its group is the comment. */
const IGNORED_DIRECTIVE = /^'([\s\S]*)' has no effect because you have 'noInlineConfig' setting in your config\.$/

/**
 * The inline ESLint directives of a set of files (paths relative to the package folder), each as
 * `<file>:<line> <comment>`, read through `readSource`. ESLint itself reads them: a linter with
 * no rules and `noInlineConfig` warns about each comment that it would read as a directive
 * (`IGNORED_DIRECTIVE`), never about a string or a template that holds such text. A file the
 * parser cannot read is named as `<file>:<line> not parsed: <message>`, and a missing file as
 * `<file>: not found`. A directive comment names `eslint`, `global` or `exported`, so a file
 * whose text names none of them holds none and is not parsed.
 */
const inlineDirectives = (files: ReadonlyArray<string>, readSource: (path: string) => string | undefined): ReadonlyArray<string> => {
  const linter = new Linter()
  const config: Array<Linter.Config> = [{
    files: SCRIPT_EXTENSIONS.map((extension) => `**/*${extension}`),
    languageOptions: { parser: tseslint.parser },
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" }
  }]
  return files.flatMap((path) => {
    const source = readSource(path)
    if (source === undefined) return [`${path}: not found`]
    if (!/eslint|global|exported/.test(source)) return []
    return linter.verify(source, config, path).map((message) =>
      message.fatal === true
        ? `${path}:${message.line} not parsed: ${message.message}`
        : `${path}:${message.line} ${IGNORED_DIRECTIVE.exec(message.message)?.[1] ?? message.message}`
    )
  })
}

/**
 * The one scoped lint block of `src` (AC 37; SD-22, amendments of 2026-10-06 and 2026-10-07):
 * upstream's `any` in `src/internal/anyEventObject.ts`, under `@typescript-eslint/no-explicit-any`,
 * a rule outside the canonical Effect bundle. Path relative to the package folder. No file of
 * `src` relaxes a canonical rule, this one included (owner, 2026-10-08: "Every file ON. All
 * rules.", "DON'T relax rules!").
 */
const PINNED_EXCEPTION = { path: "src/internal/anyEventObject.ts", rule: "@typescript-eslint/no-explicit-any" } as const

/** The canonical rule module, `eslint-rules/effect-rules.mjs` (byte-equal to the guidance copy, BASELINE-1). */
interface EffectRulesModule {
  readonly effectRulesPlugin: { readonly rules: Readonly<Record<string, unknown>> }
}

/**
 * The rules of the canonical Effect bundle as the lint config names them (`effect/<name>`),
 * sorted: the keys of `effectRulesPlugin.rules` in `eslint-rules/effect-rules.mjs`, which
 * `effectLintConfig` enables at error. Vitest loads the module (`vi.importActual`, a literal
 * specifier that the import walk of HARNESS-2 reads).
 */
const canonicalRules = Effect.map(
  Effect.promise(() => vi.importActual<EffectRulesModule>("../../eslint-rules/effect-rules.mjs")),
  (module) => Object.keys(module.effectRulesPlugin.rules).map((name) => `effect/${name}`).sort()
)

/** The rules that the relaxed blocks for tests and scripts turn off (`TYPE_AWARE_EXEMPTIONS`). */
const RELAXED_RULES: ReadonlyArray<string> = [
  "@typescript-eslint/await-thenable",
  "@typescript-eslint/no-floating-promises",
  "@typescript-eslint/no-misused-promises",
  "@typescript-eslint/no-unsafe-call",
  "@typescript-eslint/no-unsafe-member-access",
  "@typescript-eslint/no-unsafe-return",
  "@typescript-eslint/require-await"
]

/** The rules of the T1.1 timer ban in `test/upstream/`. */
const TIMER_BAN_RULES: ReadonlyArray<string> = ["no-restricted-imports", "no-restricted-syntax"]

type ResolvedRules = Readonly<Record<string, ReadonlyArray<unknown>>>

/** What ESLint resolves for a path of the package: its rules, and whether it ignores directive comments. */
interface Resolved {
  /** Each rule's entry, `[severity, ...options]`. */
  readonly rules: ResolvedRules
  /** `linterOptions.noInlineConfig`: true when ESLint ignores each directive comment of the file. */
  readonly noInlineConfig: unknown
}

const resolvedOf = (eslint: ESLint, path: string) =>
  Effect.promise(async (): Promise<Resolved> => {
    const config = (await eslint.calculateConfigForFile(path)) as
      | { readonly rules?: ResolvedRules; readonly linterOptions?: { readonly noInlineConfig?: unknown } }
      | undefined
    return { rules: config?.rules ?? {}, noInlineConfig: config?.linterOptions?.noInlineConfig }
  })

/** The rules ESLint resolves for a path of the package (each entry `[severity, ...options]`). */
const rulesOf = (eslint: ESLint, path: string) => Effect.map(resolvedOf(eslint, path), (resolved) => resolved.rules)

const severityOf = (rules: ResolvedRules, rule: string): unknown => rules[rule]?.[0]

/** The rules whose entries differ between two resolved configs, or that only one of them holds, sorted. */
const differingRules = (expected: ResolvedRules, actual: ResolvedRules): ReadonlyArray<string> =>
  [...new Set([...Object.keys(expected), ...Object.keys(actual)])]
    .filter((rule) => JSON.stringify(expected[rule]) !== JSON.stringify(actual[rule]))
    .sort()

/**
 * The lint exceptions of a set of files (paths relative to the package folder), as problems.
 *
 * The strict rules are those of a probe path in `src/` that no block names: their Effect rules
 * must be exactly the `canonical` rules (`canonicalRules`), each at error. A file of `src/`
 * holds an exception when it resolves a canonical rule at another severity, or when a rule of
 * the strict rules differs; the one allowed difference is `PINNED_EXCEPTION`, its rule off in
 * its file. The relaxed test block turns off exactly `RELAXED_RULES`, and the timer ban adds its
 * two rules at error in `test/upstream/`; a test file whose rules differ from its probe's holds
 * a scoped block. The same for the scripts block. A file that the config ignores holds the
 * widest exception. A file for which ESLint reads directive comments
 * (`linterOptions.noInlineConfig` is not true) lets a comment make an exception (SD-3: no
 * inline disable comments).
 */
const lintExceptions = (eslint: ESLint, files: ReadonlyArray<string>, canonical: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const problems: Array<string> = []
    const strict = yield* rulesOf(eslint, "src/conf-8-probe.ts")
    const effectRules = Object.keys(strict).filter((rule) => rule.startsWith("effect/")).sort()
    const lacks = canonical.filter((rule) => !effectRules.includes(rule))
    const adds = effectRules.filter((rule) => !canonical.includes(rule))
    if (lacks.length > 0 || adds.length > 0) {
      problems.push(`the strict src rules: the Effect rules differ from the canonical bundle (lacks ${lacks.join(", ")}; adds ${adds.join(", ")})`)
    }
    for (const rule of canonical) {
      if (severityOf(strict, rule) !== 2) problems.push(`the strict src rules: ${rule} is not at error`)
    }

    const relaxed = yield* rulesOf(eslint, "test/conf-8-probe.ts")
    const upstream = yield* rulesOf(eslint, "test/upstream/conf-8-probe.ts")
    const scripts = yield* rulesOf(eslint, "scripts/conf-8-probe.ts")
    const severities = (rules: ResolvedRules): ReadonlyArray<readonly [string, unknown]> =>
      Object.keys(rules).sort().map((rule) => [rule, severityOf(rules, rule)])
    const expectedRelaxed = RELAXED_RULES.map((rule) => [rule, 0] as const)
    if (JSON.stringify(severities(relaxed)) !== JSON.stringify(expectedRelaxed)) {
      problems.push("the relaxed test block turns off other rules than the type-aware exemptions")
    }
    if (JSON.stringify(severities(scripts)) !== JSON.stringify(expectedRelaxed)) {
      problems.push("the relaxed scripts block turns off other rules than the type-aware exemptions")
    }
    const timerBan = differingRules(relaxed, upstream)
    if (
      JSON.stringify(timerBan) !== JSON.stringify(TIMER_BAN_RULES) ||
      timerBan.some((rule) => severityOf(upstream, rule) !== 2)
    ) {
      problems.push(`the timer ban of test/upstream/ changes ${timerBan.join(", ")}`)
    }

    for (const path of files) {
      if (yield* Effect.promise(() => eslint.isPathIgnored(path))) {
        problems.push(`${path}: ignored by the lint config`)
        continue
      }
      const { noInlineConfig, rules } = yield* resolvedOf(eslint, path)
      if (noInlineConfig !== true) {
        problems.push(`${path}: inline directives take effect (linterOptions.noInlineConfig is not true)`)
      }
      if (path.startsWith("src/")) {
        const isPinned = (rule: string) =>
          path === PINNED_EXCEPTION.path && rule === PINNED_EXCEPTION.rule && severityOf(rules, rule) === 0
        const differing = differingRules(strict, rules).filter((rule) => rule in strict && !isPinned(rule))
        const relaxed = canonical.filter((rule) => severityOf(rules, rule) !== 2)
        const exception = [...new Set([...differing, ...relaxed])].sort()
        if (exception.length > 0) problems.push(`${path}: a lint exception (${exception.join(", ")})`)
      } else {
        const probe = path.startsWith("test/upstream/") ? upstream : path.startsWith("test/") ? relaxed : scripts
        const block = differingRules(probe, rules)
        if (block.length > 0) problems.push(`${path}: a scoped lint block (${block.join(", ")})`)
      }
    }
    return problems
  })
