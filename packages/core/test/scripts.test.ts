/**
 * The pure logic of the package's dev scripts: the cleanup CLI (`scripts/clean-core.ts`, for
 * `scripts/clean.ts`) and the docs-snippet check (`scripts/check-markdown-core.ts`, for
 * `scripts/check-markdown-code.ts`).
 *
 * Neither module starts a process or loads the Agent SDK, ESLint or the compiler, so these tests
 * run neither tool: they feed each function what the tool would give it. No test reaches
 * `clean.ts`, whose dynamic import of `clean.config.ts` CONF-8 allows only outside the tests.
 */
import { describe, expect, it } from "vitest"
import * as path from "node:path"
import {
  agentOptions,
  createOutput,
  DEFAULT_CONFIG,
  type FileIssueMap,
  type FileIssues,
  isExcludedPath,
  isWithinTargets,
  mergeConfig,
  parseIntegerOption,
  repairUntilClean,
  type RepairResult,
  resolveSettings,
  runPool,
  withTimeout
} from "../scripts/clean-core.js"
import {
  collectLintErrors,
  collectTypeErrors,
  docsTsConfig,
  hasFailures,
  markdownFilesOf,
  mergeFindings
} from "../scripts/check-markdown-core.js"

/** A package root for the path checks; no file under it is read. */
const ROOT = path.join(path.sep, "repo", "packages", "core")

/** The absolute path of a file of `ROOT`, from its path relative to the root. */
const at = (relative: string): string => path.join(ROOT, ...relative.split("/"))

/** Resolves after `ms` milliseconds. */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** A file issue map with one ESLint issue in each named file. */
const issuesIn = (...files: ReadonlyArray<string>): FileIssueMap =>
  new Map(
    files.map((file): [string, FileIssues] => [
      at(file),
      {
        typescript: [],
        eslint: [{ file: at(file), line: 1, column: 1, ruleId: "no-var", message: "m", severity: "error" }]
      }
    ])
  )

/** The repair counts of one iteration in which every file of `issues` stayed unfixed. */
const allFailed = (issues: FileIssueMap): RepairResult => ({
  success: 0,
  partial: 0,
  failed: issues.size,
  unresolved: [...issues].map(([file, fileIssues]) => ({ file, issues: fileIssues }))
})

/** Collectors that stand in for standard output and standard error. */
const collectors = () => {
  const stdout: Array<string> = []
  const stderr: Array<string> = []
  return {
    stdout,
    stderr,
    writers: { stdout: (text: string) => void stdout.push(text), stderr: (text: string) => void stderr.push(text) }
  }
}

describe("clean.ts: the integer flags", () => {
  it("--timeout keeps its value when commander passes the default as the second argument", () => {
    // Commander calls a flag's parser as parser(value, previous); the default of --timeout is
    // 600000, which parseInt read as its radix
    expect(parseIntegerOption("1200", 600_000)).toBe(1200)
    expect(parseIntegerOption("5", 3)).toBe(5)
    expect(parseIntegerOption("7")).toBe(7)
  })

  it("a value that is not a positive whole number is refused", () => {
    for (const value of ["abc", "0", "-5", "10ms", "1.5", ""]) {
      expect(parseIntegerOption(value), value).toBeUndefined()
    }
  })
})

describe("clean.ts: the path filter", () => {
  it("a file whose name merely contains dist is kept", () => {
    const exclude = DEFAULT_CONFIG.exclude ?? []
    for (const file of ["src/distance.ts", "src/distribute/index.ts", "test/redistribute.test.ts"]) {
      expect(isExcludedPath(at(file), ROOT, exclude), file).toBe(false)
    }
  })

  it("dist, node_modules, out-tsc and scripts folders are dropped at any depth, by folder name", () => {
    const exclude = DEFAULT_CONFIG.exclude ?? []
    for (const file of ["dist/index.js", "node_modules/x/index.ts", "src/out-tsc/a.ts", "scripts/clean.ts", "test/scripts/x.ts"]) {
      expect(isExcludedPath(at(file), ROOT, exclude), file).toBe(true)
    }
  })

  it("the exclude globs of clean.config.ts apply", () => {
    expect(isExcludedPath(at("src/generated/a.ts"), ROOT, ["src/generated/**"])).toBe(true)
    expect(isExcludedPath(at("src/generated/a.ts"), ROOT, DEFAULT_CONFIG.exclude ?? [])).toBe(false)
    expect(isExcludedPath(at("test/fixtures/a.ts"), ROOT, ["**/fixtures/*.ts"])).toBe(true)
    expect(isExcludedPath(at("test/fixtures/deep/a.ts"), ROOT, ["**/fixtures/*.ts"])).toBe(false)
    // node_modules and scripts stay dropped when the config replaces the default list
    expect(isExcludedPath(at("node_modules/x/index.ts"), ROOT, ["src/generated/**"])).toBe(true)
    expect(isExcludedPath(at("scripts/clean.ts"), ROOT, [])).toBe(true)
  })

  it("a file is in the run's scope when it lies in a target path, or when no target is given", () => {
    expect(isWithinTargets(at("src/Actor.ts"), ROOT, [])).toBe(true)
    expect(isWithinTargets(at("src/Actor.ts"), ROOT, ["src/Actor.ts"])).toBe(true)
    expect(isWithinTargets(at("src/actions/assign.ts"), ROOT, ["test", "src/actions"])).toBe(true)
    expect(isWithinTargets(at("src/Machine.ts"), ROOT, ["src/Actor.ts"])).toBe(false)
    expect(isWithinTargets(at("src/actionsExtra.ts"), ROOT, ["src/actions"])).toBe(false)
  })
})

describe("clean.ts: the settings of clean.config.ts", () => {
  it("the default export of clean.config.ts is merged over the defaults", () => {
    expect(mergeConfig({ default: { timeoutPerFile: 5000 } })).toEqual({ ...DEFAULT_CONFIG, timeoutPerFile: 5000 })
    expect(mergeConfig({})).toEqual(DEFAULT_CONFIG)
  })

  it("a run uses the config's values, and --timeout over timeoutPerFile", () => {
    const config = mergeConfig({
      default: { exclude: ["gen/**"], maxConcurrentAgents: 3, agentModel: "claude-test-model", timeoutPerFile: 5000 }
    })
    expect(resolveSettings(config, {})).toEqual({
      exclude: ["gen/**"],
      maxConcurrentAgents: 3,
      agentModel: "claude-test-model",
      timeoutPerFile: 5000
    })
    expect(resolveSettings(config, { timeout: 100 }).timeoutPerFile).toBe(100)
    // The defaults: no model, so the agent keeps the SDK's default model, and ten minutes a file
    expect(resolveSettings(DEFAULT_CONFIG, {})).toEqual({
      exclude: DEFAULT_CONFIG.exclude,
      maxConcurrentAgents: 1,
      agentModel: undefined,
      timeoutPerFile: 600_000
    })
  })

  it("the agent gets the config's model and the controller of the time limit", () => {
    const abortController = new AbortController()
    const settings = resolveSettings(mergeConfig({ default: { agentModel: "claude-test-model" } }), {})
    const options = agentOptions(settings, { dryRun: false, cwd: ROOT, abortController })
    expect(options).toMatchObject({
      cwd: ROOT,
      model: "claude-test-model",
      abortController,
      // No prompt, and every tool outside allowedTools is denied: never bypassPermissions
      permissionMode: "dontAsk",
      settingSources: ["project"]
    })
    // The agent reads and edits files and runs only ESLint and the compiler: no other command
    expect(options.allowedTools).toEqual([
      "Read",
      "Glob",
      "Grep",
      "Edit",
      "Write",
      "Bash(npx eslint:*)",
      "Bash(npx tsc:*)",
      "Bash(pnpm exec eslint:*)",
      "Bash(pnpm exec tsc:*)"
    ])
    const defaults = agentOptions(resolveSettings(DEFAULT_CONFIG, {}), { dryRun: true, cwd: ROOT, abortController })
    expect(defaults).not.toHaveProperty("model")
    expect(defaults.permissionMode).toBe("default")
  })

  it("an agent run that outlasts timeoutPerFile is aborted, and one within it is not", async () => {
    const slow = withTimeout(20, (controller) =>
      new Promise((_resolve, reject) => controller.signal.addEventListener("abort", () => reject(new Error("aborted"))))
    )
    await expect(slow).rejects.toThrow("timed out after 20 ms")

    let seen: AbortController | undefined
    const fast = await withTimeout(20, async (controller) => {
      seen = controller
      return "done"
    })
    await sleep(60)
    expect(fast).toBe("done")
    expect(seen?.signal.aborted).toBe(false)
  })

  it("maxConcurrentAgents files are repaired at once", async () => {
    let running = 0
    let most = 0
    const done: Array<number> = []
    await runPool([1, 2, 3, 4, 5], 2, async (item) => {
      running++
      most = Math.max(most, running)
      await sleep(10)
      running--
      done.push(item)
      return "continue"
    })
    expect(most).toBe(2)
    expect([...done].sort()).toEqual([1, 2, 3, 4, 5])
  })

  it("no file starts after one that returns stop (--fail-fast in one pass)", async () => {
    const started: Array<number> = []
    await runPool([1, 2, 3], 1, async (item) => {
      started.push(item)
      return "stop"
    })
    expect(started).toEqual([1])
  })
})

describe("clean.ts: the global repair iterations", () => {
  it("every analysis after the first checks the paths given on the command line", async () => {
    const analysed: Array<ReadonlyArray<string>> = []
    const remaining = [issuesIn("src/Actor.ts"), new Map()]
    await repairUntilClean(issuesIn("src/Actor.ts"), ["src/Actor.ts"], false, {
      analyze: async (targets) => {
        analysed.push(targets)
        return remaining.shift() ?? new Map()
      },
      repair: async () => ({ success: 1, partial: 0, failed: 0, unresolved: [] }),
      progress: () => undefined
    })
    expect(analysed).toEqual([["src/Actor.ts"], ["src/Actor.ts"]])
  })

  it("--fail-fast ends the run after the pass that leaves a file unfixed", async () => {
    let repairs = 0
    const { result, iterations } = await repairUntilClean(issuesIn("src/a.ts"), [], true, {
      analyze: async () => issuesIn("src/a.ts"),
      repair: async (issues) => {
        repairs++
        return allFailed(issues)
      },
      progress: () => undefined
    })
    expect(repairs).toBe(1)
    expect(iterations).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.unresolved.map(({ file }) => file)).toEqual([at("src/a.ts")])
  })

  it("without --fail-fast, a pass that leaves a file unfixed is followed by another, up to three", async () => {
    let repairs = 0
    const { result, iterations } = await repairUntilClean(issuesIn("src/a.ts"), [], false, {
      analyze: async () => issuesIn("src/a.ts"),
      repair: async (issues) => {
        repairs++
        return allFailed(issues)
      },
      progress: () => undefined
    })
    expect(repairs).toBe(3)
    expect(iterations).toBe(3)
    expect(result.failed).toBe(1)
  })
})

describe("clean.ts: the output channels", () => {
  it("with --json, standard output holds the JSON report alone, and the status lines go to standard error", () => {
    const { stdout, stderr, writers } = collectors()
    const out = createOutput({ json: true, debug: false }, writers)
    out.line("  ✓ (1/1) src/a.ts: Fixed")
    out.report(JSON.stringify({ repairs: { success: 1 } }, null, 2))
    expect(JSON.parse(stdout.join(""))).toEqual({ repairs: { success: 1 } })
    expect(stderr.join("")).toContain("src/a.ts: Fixed")
  })

  it("without --json, the status lines go to standard output", () => {
    const { stdout, stderr, writers } = collectors()
    createOutput({ json: false, debug: false }, writers).line("  ✓ (1/1) src/a.ts: Fixed")
    expect(stdout.join("")).toBe("  ✓ (1/1) src/a.ts: Fixed\n")
    expect(stderr).toEqual([])
  })

  it("--debug writes the debug lines to standard error, and without it they go nowhere", () => {
    const shown = collectors()
    createOutput({ json: false, debug: true }, shown.writers).debug("settings: 1 agent")
    expect(shown.stdout).toEqual([])
    expect(shown.stderr.join("")).toContain("settings: 1 agent")

    const hidden = collectors()
    createOutput({ json: false, debug: false }, hidden.writers).debug("settings: 1 agent")
    expect([...hidden.stdout, ...hidden.stderr]).toEqual([])
  })
})

describe("check-markdown-code.ts: the markdown files", () => {
  it("takes the .md paths of a git file listing, joined onto the root, so a gitignored folder such as .upstream/ adds none", () => {
    // `git ls-files --cached --others --exclude-standard` lists no ignored path, one path per line
    const listing = "README.md\ndocs/how-to/invoke-async.md\nsrc/index.ts\nexamples/NOTES.md\n\n"
    expect(markdownFilesOf(listing, ROOT)).toEqual([
      path.join(ROOT, "README.md"),
      path.join(ROOT, "docs/how-to/invoke-async.md"),
      path.join(ROOT, "examples/NOTES.md")
    ])
  })
})

describe("check-markdown-code.ts: the tsconfig of the extracted blocks", () => {
  it("has no baseUrl (TS5101 under TypeScript 6, a run error), loads the node types and maps the package to src/ from the scratch folder", () => {
    const { compilerOptions, include } = docsTsConfig()
    expect(compilerOptions).not.toHaveProperty("baseUrl")
    expect(compilerOptions.types).toEqual(["node"])
    expect(compilerOptions.paths).toEqual({
      "@jambudipa/xstate-effect": ["../src/index.ts"],
      "@jambudipa/xstate-effect/*": ["../src/*/index.ts"],
      "@/*": ["../src/*"]
    })
    expect(compilerOptions.strict).toBe(true)
    expect(include).toEqual(["extracted/**/*.ts"])
  })

  it("leaves out the files a first pass found errors in, so a second pass type-checks the rest", () => {
    const extracted = path.join(ROOT, ".markdown-code-check", "extracted")
    const config = docsTsConfig([path.join(extracted, "a_block1_line3.ts")], extracted)
    expect(config.exclude).toEqual(["extracted/a_block1_line3.ts"])
    expect(docsTsConfig()).not.toHaveProperty("exclude")
  })

  it("merges two passes: the findings of both, by file, and the run errors of both", () => {
    const first = { byFile: new Map([["/x/a.ts", ["Line 1:1 - TS1005: ';' expected."]]]), runErrors: [] }
    const second = { byFile: new Map([["/x/b.ts", ["Line 2:3 - TS2322: Type 'string' is not assignable to type 'number'."]]]), runErrors: ["e"] }
    const merged = mergeFindings(first, second)
    expect([...merged.byFile]).toEqual([...first.byFile, ...second.byFile])
    expect(merged.runErrors).toEqual(["e"])
  })
})

describe("check-markdown-code.ts: the error collection", () => {
  /** The folder of the extracted blocks. */
  const EXTRACTED = path.join(ROOT, ".markdown-code-check", "extracted")

  it("a compiler error of an extracted file is kept under that file", () => {
    const findings = collectTypeErrors(
      {
        stdout: "extracted/README_block1_line3.ts(5,7): error TS2322: Type 'string' is not assignable to type 'number'.\n",
        stderr: "",
        status: 2
      },
      EXTRACTED
    )
    expect([...findings.byFile]).toEqual([
      [path.join(EXTRACTED, "README_block1_line3.ts"), ["Line 5:7 - TS2322: Type 'string' is not assignable to type 'number'."]]
    ])
    expect(findings.runErrors).toEqual([])
  })

  it("a compiler failure that names no extracted file is a run error", () => {
    const badConfig = collectTypeErrors(
      { stdout: "error TS5058: The specified path does not exist: 'tsconfig.json'.\n", stderr: "", status: 1 },
      EXTRACTED
    )
    expect(badConfig.byFile.size).toBe(0)
    expect(badConfig.runErrors).toHaveLength(1)
    expect(badConfig.runErrors[0]).toContain("TS5058")

    const missing = collectTypeErrors({ stdout: "", stderr: "sh: tsc: command not found\n", status: 127 }, EXTRACTED)
    expect(missing.runErrors).toHaveLength(1)
    expect(missing.runErrors[0]).toContain("127")
    expect(missing.runErrors[0]).toContain("tsc: command not found")

    const noStart = collectTypeErrors({ stdout: "", stderr: "", status: null, error: "spawnSync npx ENOENT" }, EXTRACTED)
    expect(noStart.runErrors).toHaveLength(1)
    expect(noStart.runErrors[0]).toContain("ENOENT")
  })

  it("an ESLint finding of an extracted file is kept under that file", () => {
    const file = path.join(EXTRACTED, "a.ts")
    const findings = collectLintErrors({
      stdout: JSON.stringify([
        { filePath: file, messages: [{ line: 1, column: 2, ruleId: "no-var", message: "Unexpected var.", severity: 1 }] }
      ]),
      stderr: "",
      status: 1
    })
    expect([...findings.byFile]).toEqual([[file, ["Line 1:2 - warning [no-var]: Unexpected var."]]])
    expect(findings.runErrors).toEqual([])
  })

  it("an ESLint run that prints no JSON report, or cannot start, is a run error", () => {
    const crashed = collectLintErrors({
      stdout: "",
      stderr: "Oops! Something went wrong! :(\nError: Cannot find package 'typescript-eslint'\n",
      status: 2
    })
    expect(crashed.byFile.size).toBe(0)
    expect(crashed.runErrors).toHaveLength(1)
    expect(crashed.runErrors[0]).toContain("Cannot find package 'typescript-eslint'")

    const noStart = collectLintErrors({ stdout: "", stderr: "", status: null, error: "spawnSync npx ENOENT" })
    expect(noStart.runErrors).toHaveLength(1)
    expect(noStart.runErrors[0]).toContain("ENOENT")
  })

  it("a run error fails the check even when no block has a finding", () => {
    expect(hasFailures({ blocksWithTypeErrors: 0, blocksWithLintErrors: 0, runErrors: ["tsc exited with status 127"] })).toBe(true)
    expect(hasFailures({ blocksWithTypeErrors: 0, blocksWithLintErrors: 0, runErrors: [] })).toBe(false)
    expect(hasFailures({ blocksWithTypeErrors: 1, blocksWithLintErrors: 0, runErrors: [] })).toBe(true)
  })
})
