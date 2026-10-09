/**
 * The build of the package that the delivery evidence files read (DELIVERY-1, DELIVERY-2;
 * D10).
 *
 * Each evidence file builds the package once, in its `beforeAll`, into a folder that the run
 * makes under the gitignored `.delivery/<scenario>/`: the package's `package.json` and the
 * `dist/` that the package's `build` script (`tsc -p tsconfig.build.json`) emits there with
 * `--outDir`. Node resolves the `effect` peer of that build from `packages/core/node_modules`.
 * A consumer inside the folder imports the entry points by package name (a package
 * self-reference, which reads the `exports` field of `package.json` as a dependent package
 * does), so `dist/` need not exist in the checkout.
 *
 * The folder is new for each run (`mkdtemp`) and the file removes it after its tests, so a run
 * never reads a build that an earlier run left, and two runs of one file at the same time (a
 * verifier and a builder in one worktree) never delete or read each other's build.
 *
 * Every child process is Node itself (`process.execPath`), with a time limit.
 *
 * @since 0.1.0
 */
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

/** `packages/core`, with a trailing separator. */
export const PKG_ROOT = fileURLToPath(new URL("../../", import.meta.url))

/** The package name, as a consumer imports it. */
export const PACKAGE_NAME = "@jambudipa/xstate-effect"

/** The six entry points of xstate@5.33.2, by subpath (the manifest's `exports` keys). */
export const ENTRY_POINTS = [".", "./actions", "./actors", "./dev", "./graph", "./guards"] as const

/** One entry point subpath. */
export type EntryPoint = (typeof ENTRY_POINTS)[number]

/** The module specifier a consumer writes for an entry point: `.` → `@jambudipa/xstate-effect`. */
export const specifierOf = (entry: string): string =>
  entry === "." ? PACKAGE_NAME : `${PACKAGE_NAME}/${entry.replace(/^\.\//, "")}`

/** The TypeScript compiler of the package, run with Node. */
const TSC = join(PKG_ROOT, "node_modules", "typescript", "bin", "tsc")

/** The longest any one child process may run before it is killed. */
const PROCESS_LIMIT_MS = 120_000

/** The time limit of a `beforeAll` that builds the package, and of a test that runs Node. */
export const BUILD_TIMEOUT_MS = 150_000

/** The fields of `package.json` the delivery checks read. */
export interface PackageJson {
  readonly name: string
  readonly scripts: Readonly<Record<string, string>>
  readonly exports: Readonly<Record<string, unknown>>
  readonly dependencies?: Readonly<Record<string, string>>
  readonly devDependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
}

/** Reads the `package.json` of a folder (the package itself by default). */
export const readPackageJson = (folder: string = PKG_ROOT): PackageJson =>
  JSON.parse(readFileSync(join(folder, "package.json"), "utf8")) as PackageJson

/** What a child process did: its exit status (`null` when it was killed) and its output. */
export interface ProcessResult {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
}

/** Runs Node with `args` in `cwd` and waits for it. */
const runNode = (cwd: string, args: ReadonlyArray<string>): ProcessResult => {
  const result = spawnSync(process.execPath, args, { cwd, encoding: "utf8", timeout: PROCESS_LIMIT_MS })
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: `${result.stderr ?? ""}${result.error === undefined ? "" : String(result.error)}`
  }
}

/** One build of the package for one evidence file. */
export interface Build {
  /** The folder of this build: `package.json` and `dist/`. */
  readonly folder: string
  /** `Date.now()` just before the folder was made. */
  readonly startedAt: number
  /** The compiler arguments the build ran with. */
  readonly args: ReadonlyArray<string>
  /** What the compiler did. */
  readonly result: ProcessResult
}

/**
 * Builds the package into a new folder under `.delivery/<scenario>/`: the package's `build`
 * script, a `tsc` call, with `--outDir <folder>/dist` added, then a copy of `package.json`.
 */
export const buildPackage = (scenario: string): Build => {
  const parent = join(PKG_ROOT, ".delivery", scenario)
  mkdirSync(parent, { recursive: true })
  const startedAt = Date.now()
  const folder = mkdtempSync(join(parent, "run-"))
  const [tool, ...scriptArgs] = (readPackageJson().scripts["build"] ?? "").trim().split(/\s+/)
  if (tool !== "tsc") {
    return {
      folder,
      startedAt,
      args: [],
      result: { status: null, stdout: "", stderr: `the build script is not a tsc call: ${String(tool)}` }
    }
  }
  const args = [...scriptArgs, "--outDir", join(folder, "dist")]
  const result = runNode(PKG_ROOT, [TSC, ...args])
  copyFileSync(join(PKG_ROOT, "package.json"), join(folder, "package.json"))
  return { folder, startedAt, args, result }
}

/** Removes the folder of a build. */
export const removeBuild = (build: Build | undefined): void => {
  if (build !== undefined) rmSync(build.folder, { recursive: true, force: true })
}

/** Runs ES module source text with Node in `folder` (`--input-type=module --eval`). */
export const runModule = (folder: string, source: string): ProcessResult =>
  runNode(folder, ["--input-type=module", "--eval", source])

/** Runs CommonJS source text with Node in `folder` (`--input-type=commonjs --eval`). */
export const runCommonJs = (folder: string, source: string): ProcessResult =>
  runNode(folder, ["--input-type=commonjs", "--eval", source])

/** Runs the TypeScript compiler of the package in `folder`. */
export const runTsc = (folder: string, args: ReadonlyArray<string>): ProcessResult => runNode(folder, [TSC, ...args])

/**
 * Imports one module specifier alone in a fresh Node process, reads every export it has, and
 * prints the export names as JSON. An initialisation-order error (a binding read before its
 * module ran, through an import cycle) makes the process fail with a `ReferenceError`.
 */
export const loadAlone = (folder: string, specifier: string): ProcessResult =>
  runModule(
    folder,
    [
      `const entry = await import(${JSON.stringify(specifier)})`,
      "const names = Object.keys(entry)",
      "for (const name of names) void entry[name]",
      "process.stdout.write(JSON.stringify(names))"
    ].join("\n")
  )
