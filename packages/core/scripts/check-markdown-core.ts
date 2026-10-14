/**
 * The pure logic of the docs-snippet check (`check-markdown-code.ts`): it reads the findings of
 * the compiler and of ESLint out of what they printed, and decides whether the run fails.
 *
 * It imports only `node:path`, and it starts no process, so the port test `test/scripts.test.ts`
 * imports it.
 * `check-markdown-code.ts` runs under `node --experimental-strip-types`, so this file, which it
 * imports by its `.ts` name, may use only erasable TypeScript syntax: no `enum`, no `namespace`,
 * no parameter properties.
 */

import * as path from "node:path"

/** What one run of a tool printed, and how it ended. */
export interface ToolRun {
  /** Standard output. */
  readonly stdout: string
  /** Standard error. */
  readonly stderr: string
  /** The exit status, or null when the process did not exit by itself (a signal, or no start). */
  readonly status: number | null
  /** The message of the error that kept the process from starting or finishing, when one did. */
  readonly error?: string
}

/** The findings of one tool over the extracted blocks. */
export interface Findings {
  /** The findings of each extracted file, by its absolute path. */
  readonly byFile: Map<string, string[]>
  /**
   * The failures that name no extracted file: an error of the tool's config or of a module outside
   * the extracted files, a tool that did not start or did not finish, or one that failed and named
   * no file. Each means that the tool did not check every block, so the run fails
   * (`hasFailures`).
   */
  readonly runErrors: string[]
}

/**
 * The `.md` files of a git file listing (`git ls-files --cached --others --exclude-standard`: one
 * path per line, relative to `root`), as paths joined onto `root`. Git lists no ignored path, so a
 * gitignored folder such as the optional `.upstream/` clone of upstream XState, whose READMEs
 * show XState's own API, adds no block to the check.
 */
export function markdownFilesOf(listing: string, root: string): string[] {
  return listing
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".md"))
    .map((line) => path.join(root, line))
}

/**
 * The tsconfig of the extracted blocks, which the check writes into its scratch folder, one level
 * below the package root. The `paths` resolve from that file, with no `baseUrl`: TypeScript 6
 * deprecates `baseUrl` (TS5101), a run error that stops every type check. `types` names `node`,
 * which TypeScript 6 no longer loads by default and `src/` needs (`global` in `src/dev`).
 *
 * `exclude` leaves out extracted files (absolute paths under `extractedDir`) for a second pass:
 * `tsc` reports no semantic error at all while any file has a syntax error, so the check
 * type-checks the files a first pass found no error in again, without the others.
 */
export function docsTsConfig(exclude: ReadonlyArray<string> = [], extractedDir = "") {
  const excluded = exclude.map((file) => `extracted/${path.relative(extractedDir, file).split(path.sep).join("/")}`)
  return {
    ...(excluded.length > 0 ? { exclude: excluded } : {}),
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      lib: ["ES2022", "DOM"],
      types: ["node"],
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      noEmit: true,
      noImplicitAny: true,
      strictNullChecks: true,
      noImplicitReturns: true,
      noFallthroughCasesInSwitch: true,
      noUncheckedIndexedAccess: true,
      // The root and the five subpath entry points of `package.json` `exports`, against the source
      paths: {
        "@jambudipa/xstate-effect": ["../src/index.ts"],
        "@jambudipa/xstate-effect/*": ["../src/*/index.ts"],
        "@/*": ["../src/*"]
      }
    },
    include: ["extracted/**/*.ts"]
  }
}

/** The findings of two passes of a tool together: each file's findings of both, and both passes' run errors. */
export function mergeFindings(first: Findings, second: Findings): Findings {
  const byFile = new Map(first.byFile)
  for (const [file, errors] of second.byFile) {
    byFile.set(file, [...(byFile.get(file) ?? []), ...errors])
  }
  return { byFile, runErrors: [...first.runErrors, ...second.runErrors] }
}

/** The first five non-empty lines of a tool's output, joined with ` | `, for a run error. */
function firstLines(output: string): string {
  const lines = output.split("\n").map((line) => line.trim()).filter((line) => line !== "")
  return lines.length === 0 ? "(no output)" : lines.slice(0, 5).join(" | ")
}

/**
 * Reads the compiler errors of the extracted blocks out of a `tsc --pretty false` run over the
 * generated tsconfig, keyed by extracted-file path under `extractedDir`.
 *
 * A line of the form `extracted/<file>(line,col): error TSnnnn: message` is kept under its file,
 * as `Line l:c - TSnnnn: message`. Every other `error TSnnnn:` line (a bad tsconfig, an error in a
 * module outside the extracted files) is a run error, as is a `tsc` that did not start or finish,
 * and one that exits with a failure and names no error (a missing `tsc`).
 */
export function collectTypeErrors(run: ToolRun, extractedDir: string): Findings {
  const byFile = new Map<string, string[]>()
  const runErrors: string[] = []
  if (run.error !== undefined) runErrors.push(`tsc did not run to its end: ${run.error}`)

  // Format: filename(line,col): error TS####: message
  for (const line of (run.stdout + run.stderr).split("\n")) {
    const match = line.match(/^extracted\/([^(]+)\((\d+),(\d+)\): error (TS\d+): (.+)$/)
    if (match) {
      const [, filename = "", lineNum, colNum, code, message] = match
      const fullPath = path.join(extractedDir, filename)
      const errors = byFile.get(fullPath) ?? []
      errors.push(`Line ${lineNum}:${colNum} - ${code}: ${message}`)
      byFile.set(fullPath, errors)
    } else if (/\berror TS\d+:/.test(line)) {
      runErrors.push(line.trim())
    }
  }

  if (run.status !== 0 && byFile.size === 0 && runErrors.length === 0) {
    runErrors.push(`tsc exited with status ${run.status ?? "none"} and named no error: ${firstLines(run.stdout + run.stderr)}`)
  }

  return { byFile, runErrors }
}

/** One file of ESLint's JSON report: its path and its messages. */
interface LintFileResult {
  /** Absolute path of the linted file. */
  filePath: string
  /** The messages of the file; `ruleId` is null for a parse error. */
  messages: Array<{
    line: number
    column: number
    ruleId: string | null
    message: string
    severity: number
  }>
}

/** The JSON report of ESLint, or null when the text is not one: a list of file results. */
function parseLintReport(text: string): LintFileResult[] | null {
  try {
    const parsed: unknown = JSON.parse(text)
    return Array.isArray(parsed) ? (parsed as LintFileResult[]) : null
  } catch {
    return null
  }
}

/**
 * Reads the findings out of an `eslint --format json` run, keyed by the absolute path that ESLint
 * reports, each as `Line l:c - error|warning [rule]: message`.
 *
 * Warnings count as findings, the same as errors. An ESLint that did not start or finish, one that
 * prints no JSON report (a config error or a crash, exit status 2), and one that exits with a
 * status other than 0 or 1 give a run error.
 */
export function collectLintErrors(run: ToolRun): Findings {
  const byFile = new Map<string, string[]>()
  const runErrors: string[] = []
  if (run.error !== undefined) runErrors.push(`eslint did not run to its end: ${run.error}`)

  const lintResults = parseLintReport(run.stdout)
  if (lintResults === null) {
    if (runErrors.length === 0) {
      runErrors.push(
        `eslint exited with status ${run.status ?? "none"} and printed no JSON report: ${firstLines(run.stderr || run.stdout)}`
      )
    }
    return { byFile, runErrors }
  }

  for (const file of lintResults) {
    const fileErrors: string[] = []
    for (const msg of file.messages) {
      if (msg.severity > 0) {
        const level = msg.severity === 2 ? "error" : "warning"
        fileErrors.push(`Line ${msg.line}:${msg.column} - ${level} [${msg.ruleId ?? "unknown"}]: ${msg.message}`)
      }
    }
    if (fileErrors.length > 0) {
      byFile.set(file.filePath, fileErrors)
    }
  }

  if (run.status !== 0 && run.status !== 1 && runErrors.length === 0) {
    runErrors.push(`eslint exited with status ${run.status ?? "none"}: ${firstLines(run.stderr)}`)
  }

  return { byFile, runErrors }
}

/** The counts of a report that decide its exit code. */
export interface ReportCounts {
  /** Blocks with at least one compiler error. */
  readonly blocksWithTypeErrors: number
  /** Blocks with at least one ESLint error or warning. */
  readonly blocksWithLintErrors: number
  /** The failures of the tools that name no block (`Findings.runErrors`). */
  readonly runErrors: ReadonlyArray<string>
}

/**
 * True when the run must exit with code 1: a block has a compiler error or an ESLint finding (a
 * warning included), or a tool failed in a way that names no block (a run error), so the blocks
 * were not all checked.
 */
export function hasFailures(report: ReportCounts): boolean {
  return report.blocksWithTypeErrors > 0 || report.blocksWithLintErrors > 0 || report.runErrors.length > 0
}
