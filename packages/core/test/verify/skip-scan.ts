/**
 * The syntax-tree skip scan of the test sources (HARNESS-2, CONF-8; D19: the port allows no
 * skipped test).
 *
 * `treeFacts` reads one module's syntax tree in one pass: the module specifiers it names (for
 * the import walk) and the forms that skip a test, mark it todo or focus it, through the test
 * API under any name. `readImportedOptions` reads an options value that a module imports in the
 * module that exports it. `moduleFacts` parses each module once for the walk and the scan, and
 * `walkImports` is the one import walk: from a set of entry modules through every module they
 * reach, in `test/` or outside it. It reports each import it cannot read and each reference to a
 * loader that is not a direct call with a literal specifier, or to an API that loads or runs code
 * (`TreeFacts.loaderReferences`), since it cannot follow the module such a reference loads; it
 * reads the folder of a package that a bare specifier names outside the dependency store
 * (`dependencyStores`). HARNESS-2 runs the scan over every module that the files of the default
 * run reach; CONF-8 runs the scan and the name checks over every script module of the repository
 * checkout that holds the package, whatever reaches it (git's file list from the repository
 * root, the package folder, and the `node_modules` content that is no installed dependency), and
 * every module outside it that one of them reaches (`repositoryModuleList`, AC 28).
 *
 * Strings and comments are not code, so the scan never finds a form in them. A source scan
 * cannot read every form; the no-skip guard of the default run (`no-skip-reporter.ts`) is the
 * closure at run time. No test option shows `flakyTest`, so the scan's closure for it is a plain
 * name check (each identifier with that name, and each string or template that holds it), and the
 * closure at run time is the flakyTest guard of the default run (`flaky-test-guard.ts`), which the
 * default config gives in place of `@effect/vitest`.
 *
 * CONF-8's default deny (`capabilityProblems`, the eighth Layer-3 review): a module that a test
 * module or a Vitest config reaches imports only allowlisted modules and uses no capability (a
 * builtin or a package that loads, runs or spawns code, a member of `process` that does, the
 * module loaders of TypeScript), but a harness module of `CAPABILITY_HOLDERS`, pinned by its
 * whole source (`PINS_FILE`). A `createRequire` takes only the module's own `import.meta.url` as
 * its base.
 */
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import { isBuiltin } from "node:module"
import { dirname, join, posix, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"
import typescript from "typescript"
import { canonicalPath } from "./pending-rewrite-guard.js"

/**
 * A plain copy of the TypeScript API. The module object reads each export through a getter, and
 * the scan below calls the API for each node of every module the default run reaches (some
 * hundreds of thousands): through the copy that pass took a seventh of the time.
 */
const ts: typeof typescript = { ...typescript }

// ---------------------------------------------------------------- the syntax-tree skip scan

/** The names of the Vitest test API whose modifiers skip, mark todo or focus a test. */
export const TEST_API_ROOTS: ReadonlySet<string> = new Set(["it", "test", "describe", "suite"])

/** The modules that export the test API. */
export const TEST_API_MODULES: ReadonlySet<string> = new Set(["vitest", "@effect/vitest"])

/**
 * The modifiers that keep a test from running, keep the other tests from running, or let a test
 * pass that does not run as written (AC 28): `fails` passes a test whose body fails, and
 * `flakyTest` (`@effect/vitest`) retries an Effect until it succeeds.
 */
export const SKIP_MODIFIERS: ReadonlySet<string> = new Set(["skip", "skipIf", "runIf", "todo", "only", "fails", "flakyTest"])

/**
 * The name of `@effect/vitest`'s retrying helper. No test option shows it: it retries an Effect
 * inside an ordinary test until the Effect succeeds, so a test that fails at first passes and its
 * options show nothing (AC 28). In the source a plain name check (`TreeFacts.flakyTestNames`,
 * `TreeFacts.flakyTestTexts`) finds it under any route to the test API; at run time the flakyTest
 * guard of the default run (`flaky-test-guard.ts`) blocks each access, a key assembled at run time
 * too.
 */
export const FLAKY_TEST = "flakyTest"

/**
 * The test and suite options that skip a test, mark it todo or focus it, or let it pass that
 * does not run as written: `fails`, and `retry`, which runs a failed test again (AC 28).
 */
export const SKIP_OPTIONS: ReadonlySet<string> = new Set(["skip", "todo", "only", "fails", "retry"])

/**
 * The syntax tree of a module, parsed as TypeScript (a JavaScript module parses too). JSDoc
 * comments are not parsed: no check reads them, and the parse is faster without them.
 */
export const parseSource = (source: string, fileName: string): typescript.SourceFile =>
  ts.createSourceFile(
    fileName,
    source,
    { languageVersion: ts.ScriptTarget.Latest, jsDocParsingMode: ts.JSDocParsingMode.ParseNone },
    true,
    ts.ScriptKind.TS
  )

/** The member name of a property access or a string-keyed element access, else null. */
const memberName = (node: typescript.Node): string | null =>
  ts.isPropertyAccessExpression(node)
    ? node.name.text
    : ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)
    ? node.argumentExpression.text
    : null

/** An expression without the parentheses, type assertions and non-null marks around it. */
export const unwrapped = (node: typescript.Expression): typescript.Expression =>
  ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)
    ? unwrapped(node.expression)
    : node

/**
 * The root of a chain that is the test-API module itself: a dynamic import, a require or a
 * `vi.importActual` / `vi.importMock` of `vitest` or `@effect/vitest` (`(await
 * import("vitest")).it`). No identifier has this name.
 */
const MODULE_ROOT = "\u0000test-api-module"

/**
 * A call that loads `vitest` or `@effect/vitest` by a string literal: `import(...)`, a require
 * (`isRequire` of the callee: `require(...)`, or a function that `createRequire` returns),
 * `vi.importActual(...)`, `vi.importMock(...)`.
 */
const loadsTestApiModule = (node: typescript.Expression, isRequire: (callee: typescript.Expression) => boolean): boolean => {
  if (!ts.isCallExpression(node)) return false
  const callee = node.expression
  const [specifier] = node.arguments
  const loads = callee.kind === ts.SyntaxKind.ImportKeyword || isRequire(callee) ||
    (ts.isPropertyAccessExpression(callee) && ["importActual", "importMock"].includes(callee.name.text))
  return loads && specifier !== undefined && ts.isStringLiteralLike(specifier) && TEST_API_MODULES.has(specifier.text)
}

/**
 * The root of a chain of members, calls, element accesses and awaits: its leftmost name, read
 * through parentheses, type assertions (`as`, `<T>`, `satisfies`) and non-null marks, or
 * `MODULE_ROOT` for a load of the test-API module (`isRequire` names the module's require
 * functions); else null (`(it as any).fails` has the root `it`). With `throughCalls` false a
 * chain that passes through a call has no root: its value is what the call returns
 * (`test.meta()[key]`, where `test` is a test case, is not the test API).
 */
const chainRoot = (
  expression: typescript.Expression,
  isRequire: (callee: typescript.Expression) => boolean,
  throughCalls = true
): string | null => {
  let node: typescript.Expression = expression
  for (;;) {
    if (ts.isIdentifier(node)) return node.text
    if (loadsTestApiModule(node, isRequire)) return MODULE_ROOT
    if (
      ts.isPropertyAccessExpression(node) || (throughCalls && ts.isCallExpression(node)) || ts.isElementAccessExpression(node) ||
      ts.isNonNullExpression(node) || ts.isParenthesizedExpression(node) || ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node) || ts.isAwaitExpression(node)
    ) {
      node = node.expression
    } else {
      return null
    }
  }
}

/** The text of a property name, or of a computed name that is a string literal; else null. */
const propertyKey = (name: typescript.PropertyName): string | null =>
  ts.isComputedPropertyName(name)
    ? ts.isStringLiteralLike(name.expression) ? name.expression.text : null
    : name.text

/**
 * The member that an element of an object binding pattern reads: its property name, or its own
 * name without one; null when the scan cannot read it (a computed name that is not a string
 * literal, `{ [k]: f }`).
 */
const bindingKey = (element: typescript.BindingElement): string | null =>
  element.propertyName !== undefined
    ? propertyKey(element.propertyName)
    : ts.isIdentifier(element.name) ? element.name.text : null

/**
 * The members of a test or suite options object that skip the test, mark it todo or focus it, or
 * let it pass that does not run as written: a skip, todo, only, fails or retry member whose value
 * is not the literal false (a shorthand, a method and an accessor too); and each member whose
 * name the scan cannot read: a spread, or a computed name that is not a string literal.
 */
const skipOptionsIn = (options: typescript.ObjectLiteralExpression): ReadonlyArray<typescript.ObjectLiteralElementLike> =>
  options.properties.filter((property) => {
    if (ts.isSpreadAssignment(property)) return true
    const key = propertyKey(property.name)
    if (key === null) return true
    const isFalse = ts.isPropertyAssignment(property) && unwrapped(property.initializer).kind === ts.SyntaxKind.FalseKeyword
    return SKIP_OPTIONS.has(key) && !isFalse
  })

/** A skip form the scan found: its node, and its text as `<file>:<line> <code>`. */
export interface SkipForm {
  readonly node: typescript.Node
  readonly text: string
}

/**
 * An options value that a module imports (`describe("d", opts, body)` or
 * `describe("d", opts(), body)`, `opts` imported): the scan reads it in the module that
 * exports it (`importedOptionForms`).
 */
export interface ImportedOptions {
  /** The argument of the test-API call, as `<file>:<line> <code>`. */
  readonly text: string
  readonly specifier: string
  /** The exported name, `default` for a default import. */
  readonly name: string
  /** The argument calls the imported value (`opts()`), else names it (`opts`). */
  readonly call: boolean
}

/**
 * A call that loads a module the walk cannot read: an `import()`, a require, a `vi.importActual`
 * / `vi.importMock` or a `vi.mock` / `vi.doMock` whose specifier is not a string literal, and
 * each `import.meta.glob` (it names modules by a pattern, not by a specifier).
 */
export interface UnreadableImport {
  readonly call: typescript.CallExpression
  /** The call as `<file>:<line> <code>`. */
  readonly text: string
}

/** What one pass over a module's syntax tree finds. */
export interface TreeFacts {
  /** The module specifiers the module names, for the import walk below. */
  readonly specifiers: ReadonlyArray<string>
  /** Each import call whose specifier the walk cannot read, in source order. */
  readonly unreadableImports: ReadonlyArray<UnreadableImport>
  /** The skip, todo and focus forms of the module, and each options value it cannot read, in source order. */
  readonly forms: ReadonlyArray<SkipForm>
  /** The imported options values of the module's test-API calls. */
  readonly importedOptions: ReadonlyArray<ImportedOptions>
  /**
   * What the module exports under a name, read as options (`call`: the values the exported
   * function returns): the forms found in it, or null when the scan cannot read it (no such
   * export, a value that is not a function when called, or a value from yet another module).
   */
  readonly exportedOptions: (name: string, call: boolean) => ReadonlyArray<string> | null
  /**
   * Each identifier in the code whose name is `FLAKY_TEST`, in source order: a member
   * (`api.it.flakyTest`), an import or export name (`export { flakyTest } from ...`), a binding
   * (`const { flakyTest } = ...`) or a declaration. A longer name (`flakyTestCount`) is not one.
   */
  readonly flakyTestNames: ReadonlyArray<SkipForm>
  /**
   * Each string literal or template part whose text holds `FLAKY_TEST`, in source order: a key
   * (`const k = "flakyTest"`, then `api[k]`), or text a module may run. A comment is not code.
   */
  readonly flakyTestTexts: ReadonlyArray<SkipForm>
  /**
   * Each reference to a loader that is not a direct call with a literal specifier, in source
   * order (`loaderReferences`): the walk cannot follow the module such a reference loads.
   */
  readonly loaderReferences: ReadonlyArray<SkipForm>
  /**
   * Each string literal whose whole text is the name of a loader (`LOADER_NAMES`), in source
   * order: a key that reaches a loader at run time (`Reflect.get(builtin, "createRequire")`).
   */
  readonly loaderTexts: ReadonlyArray<SkipForm>
  /**
   * Each use of a capability, in source order (`capabilityOfSpecifier`, the default deny of CONF-8):
   * a value import, export or load of a module that is not allowlisted, a use of `process` but a
   * plain member, a member of `process` that loads or spawns code, and a use of the TypeScript
   * module but a plain member (its `sys` and `server` load modules).
   */
  readonly capabilities: ReadonlyArray<CapabilityForm>
  /** Each value import, export or load of a module by a literal specifier, in source order. */
  readonly valueLoads: ReadonlyArray<ValueLoad>
}

/** A use of a capability: its node and text, and the capability it uses (`node:child_process`, `process.getBuiltinModule`). */
export interface CapabilityForm extends SkipForm {
  readonly capability: string
}

/** A value import, export or load of a module: its specifier, and the names it takes (null for the whole module). */
export interface ValueLoad {
  readonly specifier: string
  readonly names: ReadonlyArray<string> | null
}

// ---------------------------------------------------------------- the default deny of capabilities

/**
 * Node's builtin modules that any module may import (CONF-8's default deny): each loads, runs
 * and spawns no code. Every other builtin is a capability (`node:child_process`,
 * `node:worker_threads`, `node:vm`, `node:inspector`, `node:repl`, `node:cluster`, `node:wasi`,
 * `node:net`, ...), but `node:module`, whose `createRequire` and `isBuiltin` any module may take
 * (`MODULE_PURE_NAMES`).
 */
export const PURE_BUILTINS: ReadonlySet<string> = new Set(["assert", "crypto", "fs", "os", "path", "stream", "url", "util"])

/**
 * The value imports of Node's `module` that any module may take: `createRequire`, whose call the
 * walk reads (only with the module's own `import.meta.url` as its base, and its require only as a
 * direct call with a literal specifier or through `.resolve`), and `isBuiltin`.
 */
export const MODULE_PURE_NAMES: ReadonlySet<string> = new Set(["createRequire", "isBuiltin"])

/**
 * The packages that any module may import, each with the reason it loads, runs and spawns no
 * code of its own choosing: the port's own runtime and test API, and the libraries the upstream
 * tests and the harness read data with.
 */
export const ALLOWED_PACKAGES: Readonly<Record<string, string>> = {
  effect: "the port's runtime (and each subpath of it)",
  "@effect/vitest": "the test API; the default run gives the flakyTest guard in its place",
  vitest: "the test API",
  "vitest/config": "the config helpers of the Vitest config files (defineConfig, configDefaults)",
  "@jambudipa/xstate-effect": "the package itself, by its name (and each subpath of it)",
  rxjs: "observables of the upstream tests (and rxjs/operators)",
  "rxjs/operators": "operators of the upstream tests",
  "xml-js": "the XML parser of upstream's SCXML converter",
  ajv: "the JSON-schema validator of the upstream JSON test",
  typescript:
    "the parser and checker of the harness; a static import only, and its `sys` and `server`, which load modules, are capabilities of their own",
  "typescript-eslint": "the parser and config helpers of the lint config; ESLint, which loads config files, is `eslint`'s"
}

/**
 * The members of `process` that load or spawn code, or reach the runner: `getBuiltinModule` (any
 * builtin, `node:child_process` among them), `binding` and `_linkedBinding` (Node's internal
 * bindings, `spawn_sync` among them), `dlopen` (a native addon), `execve` (another program in
 * place of this process), `mainModule` (its `require`), and `send` and `channel` (the IPC channel
 * to the run's main process).
 */
export const PROCESS_CAPABILITIES: ReadonlySet<string> = new Set([
  "getBuiltinModule", "binding", "_linkedBinding", "dlopen", "execve", "mainModule", "send", "channel"
])

/**
 * The capability that a value import, export or load of a module by a literal specifier uses, or
 * null when any module may load it: a path (the walk reads its module), a pure builtin, `node:module`
 * for `MODULE_PURE_NAMES` alone, and an allowlisted package (`ALLOWED_PACKAGES`; `typescript` by a
 * static import only). `names` are the names a static import takes (null for the whole module or
 * a load by a call); `call` is a load by a call (`import()`, a require, `vi.importActual`).
 */
export const capabilityOfSpecifier = (specifier: string, names: ReadonlyArray<string> | null, call: boolean): string | null => {
  if (isBuiltin(specifier)) {
    const name = specifier.replace(/^node:/, "")
    if (PURE_BUILTINS.has(name)) return null
    if (name === "module" && names !== null && names.every((entry) => MODULE_PURE_NAMES.has(entry))) return null
    return `node:${name}`
  }
  if (specifier.startsWith("node:")) return specifier
  if (!isBareSpecifier(specifier)) return null
  if (specifier === "typescript") return call ? "typescript" : null
  if (specifier in ALLOWED_PACKAGES) return null
  if (specifier.startsWith("effect/") || specifier.startsWith("@jambudipa/xstate-effect/")) return null
  return specifier
}

// ---------------------------------------------------------------- loaders

/**
 * The modules whose namespace holds a loader: `vitest` and `@effect/vitest` (their `vi`), and
 * Node's `module` (its `createRequire`, `Module` and `_load`).
 */
export const HOLDER_MODULES: ReadonlySet<string> = new Set([...TEST_API_MODULES, "node:module", "module"])

/**
 * The members of a holder that hold a loader in turn: `vi` of a test-API module, `Module` and
 * `default` of Node's `module`, and `constructor` of the module object (`module.constructor` is
 * `Module`).
 */
const HOLDER_MEMBERS: ReadonlySet<string> = new Set(["vi", "Module", "default", "constructor"])

/**
 * The members that load a module, or make a loader, when called directly: `vi.importActual(...)`
 * and `vi.importMock(...)` (the walk reads a literal specifier), `createRequire(...)` (a require)
 * and `process.getBuiltinModule(...)` (a builtin module, `module` among them).
 */
const CALLED_LOADER_MEMBERS: ReadonlySet<string> = new Set(["importActual", "importMock", "createRequire", "getBuiltinModule"])

/** `vi.mock` and `vi.doMock`: loaders on a holder only (a spy's `mock` is a record of its calls). */
const VI_LOADER_MEMBERS: ReadonlySet<string> = new Set(["mock", "doMock"])

/**
 * The members that load a module from another importer than the module itself
 * (`module.require`, `Module.prototype.require`, `Module._load`): the walk cannot follow them.
 */
const UNFOLLOWED_LOADER_MEMBERS: ReadonlySet<string> = new Set(["require", "_load"])

/** The names that a destructuring or an import may not take: each is a loader that the walk cannot follow under another name. */
const LOADER_BINDING_KEYS: ReadonlySet<string> = new Set(["importActual", "importMock", "require", "_load", "getBuiltinModule"])

/**
 * A name of the runner's own loaders and state: `__vite_ssr_import__` and
 * `__vite_ssr_dynamic_import__` (each module of a run sees them as names), `__vitest_mocker__`,
 * `__vitest_worker__`.
 */
const RUNNER_INTERNAL = /^__vite(?:st)?_/

// ---------------------------------------------------------------- code loaders and evaluators

/**
 * Node's builtin modules that run code which the walk cannot read: `vm` (a script, a function or
 * a module from a string), `worker_threads` (a worker from a file or a string), `inspector`
 * (`Runtime.evaluate` in this process) and `repl`, each with and without `node:`. Every import,
 * export or load of one is a loader reference (the sixth Layer-3 review's V1).
 */
export const EVALUATOR_MODULES: ReadonlySet<string> = new Set(
  ["vm", "worker_threads", "inspector", "inspector/promises", "repl"].flatMap((name) => [name, `node:${name}`])
)

/**
 * A module of Vite's or Vitest's own API that loads or runs a module the walk cannot follow: Vite
 * (`createServer` and its `ssrLoadModule`, `runnerImport`, a module runner, a config loader; the
 * sixth Layer-3 review's B1 and B3), vite-node, and each subpath of Vitest but `vitest/config`
 * and `vitest/node` (`VITEST_NODE_RUNS`). Every value import, export or load of one is a loader
 * reference; a type-only import loads nothing.
 */
export const isRunnerModule = (specifier: string): boolean =>
  /^(?:vite|vite-node|rolldown-vite)(?:\/|$)/.test(specifier) ||
  (specifier.startsWith("vitest/") && specifier !== "vitest/config" && specifier !== "vitest/node")

/**
 * The value imports of `vitest/node` that a module may take: Vitest's own runs (a module of the
 * package runs test files in worker threads with them, SD-1). The `import` member of what
 * `createVitest` gives is a loader reference (`CODE_LOADER_NAMES`).
 */
const VITEST_NODE_RUNS: ReadonlySet<string> = new Set(["createVitest", "startVitest"])

/**
 * The value imports of Node's `module` that load nothing (`createRequire` is the loader that the
 * walk reads; `Module` and `default` are holders whose members the walk reads). Each other one is
 * a loader or a hook of the module system (`register`, `registerHooks`, `runMain`, `_load`).
 */
const MODULE_SAFE_IMPORTS: ReadonlySet<string> = new Set([
  "createRequire", "builtinModules", "isBuiltin", "findPackageJSON", "findSourceMap", "SourceMap", "stripTypeScriptTypes",
  "enableCompileCache", "getCompileCacheDir", "flushCompileCache", "constants", "syncBuiltinESMExports", "Module", "default"
])

/**
 * The names of APIs that load or run code, wherever code names them (a reference, a member, an
 * import or export name, a destructured key): the module runners, dev-server loader and config
 * loader of Vite and Vitest (`runnerImport`, `ssrLoadModule`, `ModuleRunner`, ...), Node's addon
 * loader `dlopen`, and the module system's hooks and internals (`registerHooks`, `runMain`,
 * `_compile`, `_extensions`, `_resolveFilename`, `_linkedBinding`). `eval` and `Function` are
 * global names, so the walk reads them as free names and as members of a value that no import
 * binds (`EVALUATING_GLOBALS`).
 */
export const CODE_LOADER_NAMES: ReadonlySet<string> = new Set([
  "runnerImport", "ssrLoadModule", "createViteServer", "createServerModuleRunner", "ViteNodeRunner", "ViteNodeServer",
  "ModuleRunner", "ESModulesEvaluator", "VitestModuleEvaluator", "loadConfigFromFile", "runInlinedModule", "runExternalModule",
  "dlopen", "registerHooks", "runMain", "_compile", "_extensions", "_resolveFilename", "_linkedBinding"
])

/** The global functions that run a string as code: `eval` and the `Function` constructor. */
export const EVALUATING_GLOBALS: ReadonlySet<string> = new Set(["eval", "Function"])

/**
 * The member that gives a map of a value's property descriptors, whose values reach every
 * property, the `constructor` of a function's prototype among them (the seventh Layer-3 review's
 * Y6): a reference to it is a loader reference but for a copy onto another value
 * (`copiesDescriptors` in `treeFacts`).
 */
export const DESCRIPTOR_MAP = "getOwnPropertyDescriptors"

/**
 * The names of a loader that a string may hold as a key: `importActual`, `importMock`,
 * `createRequire`, `getBuiltinModule`, `_load`, each name of `CODE_LOADER_NAMES` and
 * `EVALUATING_GLOBALS` (`Reflect.get(globalThis, "eval")`), `DESCRIPTOR_MAP`, and each name of the
 * runner's own loaders. The name `require` is not one: no global holds the module's require (it is a name of
 * the module itself), and the module object that holds it is a holder whose every reference the
 * walk reads.
 */
export const LOADER_NAMES: ReadonlySet<string> = new Set([...CALLED_LOADER_MEMBERS, "_load", ...CODE_LOADER_NAMES, ...EVALUATING_GLOBALS, DESCRIPTOR_MAP])

/** The text is the name of a loader (`LOADER_NAMES`, or a name of the runner's own loaders). */
const isLoaderName = (text: string): boolean => LOADER_NAMES.has(text) || /^__vite(?:st)?_\w*$/.test(text)

/** The outermost of the parentheses, type assertions and non-null marks around an expression (the expression itself without them). */
const outer = (node: typescript.Node): typescript.Node => {
  let current = node
  for (;;) {
    const parent = current.parent
    const wraps = parent !== undefined &&
      (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent) ||
        ts.isTypeAssertionExpression(parent) || ts.isNonNullExpression(parent)) &&
      parent.expression === current
    if (!wraps) return current
    current = parent
  }
}

/** The expression is the callee of a call (through parentheses and type assertions). */
const isDirectCallee = (node: typescript.Node): boolean => {
  const wrapped = outer(node)
  return ts.isCallExpression(wrapped.parent) && wrapped.parent.expression === wrapped
}

/** The expression is the object of a member access by a name the scan reads: `x.name`, `x["name"]`, `x[0]`. */
const isStaticMemberObject = (wrapped: typescript.Node, parent: typescript.Node): boolean =>
  (ts.isPropertyAccessExpression(parent) && parent.expression === wrapped) ||
  (ts.isElementAccessExpression(parent) && parent.expression === wrapped &&
    (ts.isStringLiteralLike(parent.argumentExpression) || ts.isNumericLiteral(parent.argumentExpression)))

/**
 * The identifier names a binding in an expression (a reference), not a name a declaration, a
 * member or a key gives: `require` in `f(require)` and `{ require }` is one; in `x.require`,
 * `const require = ...`, `{ require: x }` and `import { require }` it is not. The local name of
 * `export { x }` without a module specifier is one.
 */
const isReference = (identifier: typescript.Identifier): boolean => {
  const parent = identifier.parent
  if (ts.isPropertyAccessExpression(parent)) return parent.name !== identifier
  if (ts.isExportSpecifier(parent)) {
    return (parent.propertyName ?? parent.name) === identifier && parent.parent.parent.moduleSpecifier === undefined
  }
  if (ts.isBindingElement(parent)) return parent.initializer === identifier
  if (
    ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent) ||
    ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent) || ts.isPropertySignature(parent) ||
    ts.isMethodSignature(parent) || ts.isEnumMember(parent) || ts.isVariableDeclaration(parent) || ts.isParameter(parent) ||
    ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isClassDeclaration(parent) ||
    ts.isClassExpression(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent) ||
    ts.isImportEqualsDeclaration(parent) || ts.isImportSpecifier(parent) || ts.isTypeAliasDeclaration(parent) ||
    ts.isInterfaceDeclaration(parent) || ts.isEnumDeclaration(parent) || ts.isModuleDeclaration(parent) ||
    ts.isTypeParameterDeclaration(parent) || ts.isNamespaceExport(parent)
  ) {
    return parent.name !== identifier
  }
  return !(ts.isQualifiedName(parent) || ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent) || ts.isMetaProperty(parent))
}

/** The names a binding name declares: the name itself, or each name of a destructuring. */
const bindingNames = (name: typescript.BindingName): ReadonlyArray<string> =>
  ts.isIdentifier(name)
    ? [name.text]
    : name.elements.flatMap((element) => (ts.isOmittedExpression(element) ? [] : bindingNames(element.name)))

/**
 * The scope declares the name: a variable, function, class or import of a block or of the
 * module, a parameter or the own name of a function, a variable of a `for` or of a `catch`. A
 * `var` in a nested block counts in that block only, so its name in an outer block counts as the
 * free name (the check then reads more, never less).
 */
const declaresIn = (scope: typescript.Node, name: string): boolean => {
  const statements = ts.isSourceFile(scope) || ts.isBlock(scope) || ts.isModuleBlock(scope) || ts.isCaseClause(scope) || ts.isDefaultClause(scope)
    ? scope.statements
    : []
  for (const statement of statements) {
    if (ts.isVariableStatement(statement) && statement.declarationList.declarations.some((declaration) => bindingNames(declaration.name).includes(name))) return true
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name?.text === name) return true
    if (ts.isImportEqualsDeclaration(statement) && statement.name.text === name) return true
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause
      const bindings = clause?.namedBindings
      if (clause?.name?.text === name) return true
      if (bindings !== undefined && ts.isNamespaceImport(bindings) && bindings.name.text === name) return true
      if (bindings !== undefined && ts.isNamedImports(bindings) && bindings.elements.some((element) => element.name.text === name)) return true
    }
  }
  if (ts.isFunctionLike(scope)) {
    if (scope.parameters.some((parameter) => bindingNames(parameter.name).includes(name))) return true
    if ((ts.isFunctionExpression(scope) || ts.isClassExpression(scope)) && scope.name?.text === name) return true
  }
  if ((ts.isForStatement(scope) || ts.isForInStatement(scope) || ts.isForOfStatement(scope)) && scope.initializer !== undefined && ts.isVariableDeclarationList(scope.initializer)) {
    return scope.initializer.declarations.some((declaration) => bindingNames(declaration.name).includes(name))
  }
  return ts.isCatchClause(scope) && scope.variableDeclaration !== undefined && bindingNames(scope.variableDeclaration.name).includes(name)
}

/** No scope around the identifier declares its name: it names the module's own binding (`require`, `module`). */
const isFree = (identifier: typescript.Identifier): boolean => {
  for (let scope = identifier.parent; scope !== undefined; scope = scope.parent) {
    if (declaresIn(scope, identifier.text)) return false
  }
  return true
}

/** A value that cannot hold a skip option: a function (a test body), a number, a string, an array (a table), null or undefined. */
const isPlainValue = (node: typescript.Expression): boolean =>
  ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isNumericLiteral(node) ||
  ts.isStringLiteralLike(node) || ts.isTemplateExpression(node) || ts.isArrayLiteralExpression(node) ||
  node.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(node) && node.text === "undefined") ||
  (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand))

/** A function: an arrow function, a function expression or a function declaration. */
const isFunction = (node: typescript.Node): node is typescript.ArrowFunction | typescript.FunctionExpression | typescript.FunctionDeclaration =>
  ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)

/** The values a function returns: its expression body, or the expression of each of its return statements (not those of the functions inside it). */
const returnsOf = (fn: typescript.ArrowFunction | typescript.FunctionExpression | typescript.FunctionDeclaration): ReadonlyArray<typescript.Expression> => {
  if (fn.body === undefined) return []
  if (!ts.isBlock(fn.body)) return [fn.body]
  const values: Array<typescript.Expression> = []
  const visit = (node: typescript.Node): void => {
    if (ts.isReturnStatement(node)) {
      if (node.expression !== undefined) values.push(node.expression)
    } else if (!ts.isFunctionLike(node)) {
      ts.forEachChild(node, visit)
    }
  }
  ts.forEachChild(fn.body, visit)
  return values
}

/** The node is a top-level statement with an `export` modifier. */
const isExported = (node: typescript.Node, sf: typescript.SourceFile): boolean =>
  node.parent === sf && ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)

/**
 * One pass over a module's syntax tree: the module specifiers it names and its skip forms.
 *
 * The specifiers: static imports and re-exports, `import x = require(...)`, `import(...)`,
 * a require, `vi.importActual` / `vi.importMock`, and `vi.mock` / `vi.doMock` (a mock without a
 * factory loads the module to mock its exports, and a factory's `importOriginal` loads it). A
 * require is a call of `require`, or of a function that `createRequire` returns:
 * `createRequire(import.meta.url)(...)`, or a call of a variable that holds one
 * (`const load = createRequire(import.meta.url)`, then `load(...)`), with `createRequire` under
 * any name an import or a destructuring binds to it, or as a member (`module.createRequire`). A
 * call of the last four whose specifier is not a string literal (a variable, a parameter, a
 * `new URL(...)`, a template with a substitution) goes to `unreadableImports`: the walk cannot
 * read the module it names. So does each `import.meta.glob(...)`, which loads the modules that
 * match a pattern. A `vi.mock(import("./x.js"))` names its module through the `import(...)`.
 *
 * The skip, todo and focus forms. The test API is `it`, `test`, `describe` and `suite`, the
 * local name of each of them, or of the whole module, that an import from `vitest` or
 * `@effect/vitest` binds (`import v = require("vitest")` too), a dynamic import, a require or
 * `vi.importActual` of either module, and each variable whose value is rooted at the test API
 * (`const t = it`, `const t2 = it.extend({})`, `const v = await import("vitest")`), that holds an
 * object or array literal with a value rooted there (`const api = { it }`, `const all = [describe]`),
 * or that a destructuring of it binds to `it`, `test`, `describe`, `suite` or the rest
 * (`const { it: t } = await import("vitest")`). A chain is read through parentheses, type
 * assertions and awaits (`(it as any).fails`). The scan finds:
 * - a member named skip, skipIf, runIf, todo, only, fails or flakyTest on a chain rooted at the
 *   test API, called or not (`it.effect.skip`, `it.effect.skipIf(cond)`, `it.live.skip`,
 *   `it["skip"]`, `it.flakyTest(effect)`, `api.it.flakyTest`);
 * - a member of the test API whose name the scan cannot read: an element access with a key that
 *   is not a string or number literal (`it[k]`, `it.effect[k]`), on a chain that passes through
 *   no call, and a destructuring of the test API with such a key (`const { [k]: f } = it`);
 * - an import of one of those names from `vitest` or `@effect/vitest` (`flakyTest`, which the
 *   module also exports on its own), and a destructuring that takes one of them from a dynamic
 *   import or a require of either module (`const { flakyTest } = await import("@effect/vitest")`,
 *   `const { flakyTest } = createRequire(import.meta.url)("@effect/vitest")`);
 * - a re-export from `vitest` or `@effect/vitest` that names one of those names
 *   (`export { flakyTest } from "@effect/vitest"`), and each `export *` of either module
 *   (`export * from "@effect/vitest"`, `export * as v from "vitest"`): the importer reaches the
 *   modifier through a module of the package, under a name the scan of the importer cannot tie
 *   to the test API;
 * - a call of a member of one of those names on any other value: a test context's
 *   `ctx.skip()`, or the test API under another name (`const t = it`, then `t.only(...)`);
 * - a call of a name that a destructuring binds to one of those members
 *   (`({ skip }) => skip()`, `const { skip: pass } = ctx`, then `pass()`);
 * - in each argument after the name of a call of the test API (`optionsFindings`): the members
 *   `skipOptionsIn` names of each options object the argument may be, read through
 *   parentheses and type assertions, both branches of a conditional, the variables of the
 *   module and the values its local functions return (`describe("d", { skip: true }, body)`,
 *   `it.effect("x", body, flag ? { todo: true } : {})`, `describe("d", opts(), body)`); and the
 *   argument itself when the scan cannot read it (a parameter, a member, another call). An
 *   imported value goes to `importedOptions`; the module that exports it reads it.
 * Strings and comments are not code, so they are never found. The pass collects the imports,
 * variables, functions, destructured names, modifier members and calls of the whole module
 * first, and judges the members and calls after it, so a name declared below its use still
 * counts.
 *
 * The loader references (the fifth Layer-3 review of CONF-8). The walk reads a loader only in a
 * direct call with a literal specifier, so a second pass over the code (types load nothing)
 * names each other reference to one:
 * - `vi.importActual`, `vi.importMock` (as a member of any value), `vi.mock` and `vi.doMock` (on a
 *   holder), `createRequire` and `getBuiltinModule` that are not the callee of a direct call: an
 *   alias (`const ia = vi.importActual`), `.call` / `.apply` / `.bind`, a value passed on or
 *   stored (`f(vi.importMock)`, `{ load: vi.importActual }`, `[vi.importActual][0]`), and each
 *   element access by one of these names (`vi["importActual"]`);
 * - a destructuring or an import that takes `importActual`, `importMock`, `require`, `_load` or
 *   `getBuiltinModule` (`const { importActual } = vi`), and that takes `mock` or `doMock`, the
 *   rest or a computed name from a holder;
 * - `require` where no scope declares the name, and each `createRequire(...)` result, that is not
 *   the callee of a direct call, the object of `.resolve` (the resolver loads nothing), the
 *   operand of `typeof`, or the value of a `const` that the module reads only through `.resolve`:
 *   `Reflect.apply(createRequire(import.meta.url), undefined, [...])`, `f(require)`,
 *   `const load = createRequire(import.meta.url)`;
 * - each member `require` or `_load` (`module.require`, `Module.prototype.require`,
 *   `Module._load`), which loads from another importer, and each name of the runner's own
 *   loaders (`__vite_ssr_dynamic_import__`);
 * - a holder of a loader that is not the object of a member access by a name the scan reads, the
 *   operand of `typeof`, or the value of a destructuring: `vi` and each name an import or a
 *   variable binds to a holder, the module object `module`, `import.meta`, and the namespace of
 *   `vitest`, `@effect/vitest` or Node's `module` (`Reflect.get(vi, ...)`, `const v = vi`,
 *   `vi[k]`, `Reflect.get(V, "vi")`). A load of such a namespace may be bound to a name, and an
 *   `import()` of one must be awaited first (`import("vitest").then(...)` is a reference);
 * - an export of one of these names (`export { vi } from "vitest"`), and each `export *` or
 *   `export * as` of a holder module (`export * as M from "node:module"`);
 * - each API that loads or runs code which no literal specifier names (the sixth Layer-3 review
 *   of CONF-8: B1, B3, V1): an import, export or load of a builtin that runs code
 *   (`EVALUATOR_MODULES`: `node:vm`, `worker_threads`, `inspector`, `repl`) or of Vite's or
 *   Vitest's runner API (`isRunnerModule`, and a value of `vitest/node` but its runs); a name of
 *   `CODE_LOADER_NAMES` (`runnerImport`, `ssrLoadModule`, `ModuleRunner`, `registerHooks`,
 *   `dlopen`, `_compile`) as a reference, a member, an import, an export or a key; `eval` and
 *   `Function` where no scope declares them, but in a check of a value's kind (`typeof`,
 *   `instanceof`, `Function.prototype`), and as a member of a value that no import binds
 *   (`globalThis.eval`); the `import` member of a module runner or a Vitest instance; a value of
 *   Node's `module` that is no resolver (`register`); `process.binding`; a `constructor` that may
 *   be the `Function` constructor (`isConstructorReference`: but its `.name`) and the key
 *   `"constructor"` of a `Reflect` call; `getOwnPropertyDescriptors` (`DESCRIPTOR_MAP`) as a
 *   reference, a member or a key, but a copy of the properties of a value that is no function onto
 *   another value (the seventh Layer-3 review's Y6); and `getBuiltinModule` with a key the walk
 *   cannot read.
 */
export const treeFacts = (sf: typescript.SourceFile): TreeFacts => {
  const specifiers: Array<string> = []
  const roots = new Set([...TEST_API_ROOTS, MODULE_ROOT])
  const variables = new Map<string, Array<typescript.Expression>>()
  const destructurings: Array<{ readonly pattern: typescript.ObjectBindingPattern; readonly initializer: typescript.Expression }> = []
  const computedMembers: Array<typescript.ElementAccessExpression> = []
  const functions = new Map<string, Array<typescript.FunctionDeclaration>>()
  const imports = new Map<string, { readonly specifier: string; readonly name: string }>()
  const exported = new Set<string>()
  const modifierNames = new Set<string>()
  const modifierMembers: Array<typescript.PropertyAccessExpression | typescript.ElementAccessExpression> = []
  const modifierImports: Array<typescript.ImportSpecifier> = []
  const reExports: Array<typescript.ExportDeclaration | typescript.ExportSpecifier> = []
  const createRequireNames = new Set(["createRequire"])
  const requireNames = new Set(["require"])
  const calls: Array<typescript.CallExpression> = []
  const importCalls: Array<typescript.CallExpression> = []
  const flakyTestNames: Array<typescript.Node> = []
  const flakyTestTexts: Array<typescript.Node> = []
  const loaderTexts: Array<typescript.Node> = []
  // `vi` is a holder under its own name too (a run with globals)
  const holderNames = new Set(["vi"])
  const addSpecifier = (node: typescript.Node | undefined): void => {
    if (node !== undefined && ts.isStringLiteralLike(node)) specifiers.push(node.text)
  }
  const visit = (node: typescript.Node): void => {
    if (ts.isIdentifier(node) && node.text === FLAKY_TEST) flakyTestNames.push(node)
    if (
      (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) &&
      node.text.includes(FLAKY_TEST)
    ) {
      flakyTestTexts.push(node)
    }
    if (ts.isStringLiteralLike(node) && isLoaderName(node.text)) loaderTexts.push(node)
    // A holder of a loader that an import binds: the namespace or default of a holder module, and
    // its vi, Module or default by name
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier) && HOLDER_MODULES.has(node.moduleSpecifier.text)) {
      const clause = node.importClause
      const bindings = clause?.namedBindings
      if (clause?.name !== undefined) holderNames.add(clause.name.text)
      if (bindings !== undefined && ts.isNamespaceImport(bindings)) holderNames.add(bindings.name.text)
      if (bindings !== undefined && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (HOLDER_MEMBERS.has((element.propertyName ?? element.name).text)) holderNames.add(element.name.text)
        }
      }
    }
    if (
      ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteralLike(node.moduleReference.expression) && HOLDER_MODULES.has(node.moduleReference.expression.text)
    ) {
      holderNames.add(node.name.text)
    }
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) addSpecifier(node.moduleSpecifier)
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text
      const clause = node.importClause
      const bindings = clause?.namedBindings
      if (clause?.name !== undefined) imports.set(clause.name.text, { specifier, name: "default" })
      if (bindings !== undefined && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          const imported = (element.propertyName ?? element.name).text
          imports.set(element.name.text, { specifier, name: imported })
          if (imported === "createRequire") createRequireNames.add(element.name.text)
        }
      }
      if (TEST_API_MODULES.has(specifier)) {
        if (bindings !== undefined && ts.isNamespaceImport(bindings)) roots.add(bindings.name.text)
        if (bindings !== undefined && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            const imported = (element.propertyName ?? element.name).text
            if (TEST_API_ROOTS.has(imported)) roots.add(element.name.text)
            if (SKIP_MODIFIERS.has(imported)) modifierImports.push(element)
          }
        }
      }
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const reference = node.moduleReference.expression
      addSpecifier(reference)
      if (ts.isStringLiteralLike(reference) && TEST_API_MODULES.has(reference.text)) roots.add(node.name.text)
    }
    // A re-export of a modifier from the test-API module, or of the whole module
    if (
      ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteralLike(node.moduleSpecifier) &&
      TEST_API_MODULES.has(node.moduleSpecifier.text)
    ) {
      const clause = node.exportClause
      if (clause === undefined || ts.isNamespaceExport(clause)) reExports.push(node)
      else reExports.push(...clause.elements.filter((element) => SKIP_MODIFIERS.has((element.propertyName ?? element.name).text)))
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      variables.set(node.name.text, [...(variables.get(node.name.text) ?? []), unwrapped(node.initializer)])
    }
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer !== undefined) {
      destructurings.push({ pattern: node.name, initializer: node.initializer })
    }
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      functions.set(node.name.text, [...(functions.get(node.name.text) ?? []), node])
    }
    if (ts.isVariableStatement(node) && isExported(node, sf)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) exported.add(declaration.name.text)
      }
    }
    if (ts.isFunctionDeclaration(node) && node.name !== undefined && isExported(node, sf)) exported.add(node.name.text)
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent) && ts.isIdentifier(node.name)) {
      const key = propertyKey(node.propertyName ?? node.name)
      if (key !== null && SKIP_MODIFIERS.has(key)) modifierNames.add(node.name.text)
      if (key === "createRequire") createRequireNames.add(node.name.text)
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = memberName(node)
      if (name !== null && SKIP_MODIFIERS.has(name)) modifierMembers.push(node)
      if (ts.isElementAccessExpression(node) && name === null && !ts.isNumericLiteral(node.argumentExpression)) {
        computedMembers.push(node)
      }
    }
    if (ts.isCallExpression(node)) {
      calls.push(node)
      const callee = node.expression
      const dynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword
      const require = ts.isIdentifier(callee) && callee.text === "require"
      const viImport = ts.isPropertyAccessExpression(callee) && ["importActual", "importMock"].includes(callee.name.text)
      const viMock = ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "vi" &&
        ["mock", "doMock"].includes(callee.name.text)
      const metaGlob = ts.isPropertyAccessExpression(callee) && ts.isMetaProperty(callee.expression) &&
        callee.expression.keywordToken === ts.SyntaxKind.ImportKeyword && callee.name.text.startsWith("glob")
      const [specifier] = node.arguments
      // `vi.mock(import("./x.js"))`: the import names the module, and the pass reads it on its own
      const mocksImport = viMock && specifier !== undefined && ts.isCallExpression(specifier) &&
        specifier.expression.kind === ts.SyntaxKind.ImportKeyword
      if ((dynamicImport || require || viImport || viMock) && specifier !== undefined && !mocksImport) {
        if (ts.isStringLiteralLike(specifier)) addSpecifier(specifier)
        else importCalls.push(node)
      }
      if (metaGlob) importCalls.push(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  /** `createRequire` under a name an import, a destructuring or a variable binds to it, or as a member (`module.createRequire`). */
  const isCreateRequire = (expression: typescript.Expression): boolean => {
    const node = unwrapped(expression)
    return (ts.isIdentifier(node) && createRequireNames.has(node.text)) || memberName(node) === "createRequire"
  }
  /** A require function: `require`, a call of `createRequire`, or a variable that holds one of them. */
  const isRequire = (expression: typescript.Expression): boolean => {
    const node = unwrapped(expression)
    return (ts.isIdentifier(node) && requireNames.has(node.text)) || (ts.isCallExpression(node) && isCreateRequire(node.expression))
  }
  for (let grown = true; grown;) {
    grown = false
    for (const [name, initializers] of variables) {
      for (const [names, holds] of [[createRequireNames, isCreateRequire], [requireNames, isRequire]] as const) {
        if (!names.has(name) && initializers.some(holds)) {
          names.add(name)
          grown = true
        }
      }
    }
  }
  // The specifier of each call of a require function that the pass did not read (it reads `require(...)`)
  for (const call of calls) {
    const [specifier] = call.arguments
    const plainRequire = ts.isIdentifier(call.expression) && call.expression.text === "require"
    if (plainRequire || specifier === undefined || !isRequire(call.expression)) continue
    if (ts.isStringLiteralLike(specifier)) addSpecifier(specifier)
    else importCalls.push(call)
  }

  /**
   * A load of a holder module (`import("vitest")`, a require or `vi.importActual` of `node:module`,
   * by a literal specifier), and a call of `getBuiltinModule` (`process.getBuiltinModule("module")`).
   */
  const isHolderLoad = (expression: typescript.Node): expression is typescript.CallExpression => {
    if (!ts.isCallExpression(expression)) return false
    const callee = unwrapped(expression.expression)
    if (memberName(callee) === "getBuiltinModule" || (ts.isIdentifier(callee) && callee.text === "getBuiltinModule")) return true
    const [specifier] = expression.arguments
    const loads = expression.expression.kind === ts.SyntaxKind.ImportKeyword || isRequire(expression.expression) ||
      ["importActual", "importMock"].includes(memberName(callee) ?? "")
    return loads && specifier !== undefined && ts.isStringLiteralLike(specifier) && HOLDER_MODULES.has(specifier.text)
  }
  /**
   * A holder of a loader: a name an import or a variable binds to one (`vi`, `import * as V from
   * "vitest"`, `const M = await import("node:module")`), the module object `module` where no scope
   * declares the name, `import.meta`, a load of a holder module, and a member `vi`, `Module`,
   * `default` or `constructor` of a holder (`V.vi`, `module.constructor`).
   */
  const isHolder = (expression: typescript.Expression): boolean => {
    let node = unwrapped(expression)
    while (ts.isAwaitExpression(node)) node = unwrapped(node.expression)
    if (ts.isIdentifier(node)) return holderNames.has(node.text) || (node.text === "module" && isFree(node))
    if (ts.isMetaProperty(node)) return node.keywordToken === ts.SyntaxKind.ImportKeyword
    if (isHolderLoad(node)) return true
    const name = memberName(node)
    return name !== null && HOLDER_MEMBERS.has(name) &&
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && isHolder(node.expression)
  }
  // The holders under other names: each variable whose value is a holder, and each name that a
  // destructuring of a holder binds to vi, Module, default or constructor, until no name is added
  for (let grown = true; grown;) {
    grown = false
    const named = [
      ...[...variables].filter(([, initializers]) => initializers.some(isHolder)).map(([name]) => name),
      ...destructurings.filter(({ initializer }) => isHolder(initializer)).flatMap(({ pattern }) =>
        pattern.elements.flatMap((element) => {
          const key = bindingKey(element)
          return key !== null && HOLDER_MEMBERS.has(key) && ts.isIdentifier(element.name) ? [element.name.text] : []
        })
      )
    ]
    for (const name of named) {
      if (!holderNames.has(name)) {
        holderNames.add(name)
        grown = true
      }
    }
  }
  // The specifier of `vi.mock` / `vi.doMock` on a holder under another name than vi (`v.mock(...)`, `V.vi.mock(...)`)
  for (const call of calls) {
    const callee = call.expression
    const [specifier] = call.arguments
    if (
      !ts.isPropertyAccessExpression(callee) || !VI_LOADER_MEMBERS.has(callee.name.text) || specifier === undefined ||
      (ts.isIdentifier(callee.expression) && callee.expression.text === "vi") || !isHolder(callee.expression)
    ) {
      continue
    }
    if (ts.isStringLiteralLike(specifier)) addSpecifier(specifier)
    else if (!(ts.isCallExpression(specifier) && specifier.expression.kind === ts.SyntaxKind.ImportKeyword)) importCalls.push(call)
  }
  importCalls.sort((a, b) => a.getStart(sf) - b.getStart(sf))

  // ---- loader references: each reference to a loader that is not a direct call with a literal specifier
  const loaderReferences: Array<typescript.Node> = []
  /** Each identifier of the module with the name that is a reference (`isReference`). */
  const referencesOf = (name: string): ReadonlyArray<typescript.Identifier> => {
    const found: Array<typescript.Identifier> = []
    const visitNames = (node: typescript.Node): void => {
      if (ts.isIdentifier(node) && node.text === name && isReference(node)) found.push(node)
      ts.forEachChild(node, visitNames)
    }
    visitNames(sf)
    return found
  }
  /**
   * A `const` that holds a resolver only: a loader value that the module reads only as
   * `<name>.resolve` (and `typeof <name>`), never calls, passes on or exports. `resolve` loads nothing.
   */
  const isResolverConst = (declaration: typescript.VariableDeclaration): boolean => {
    if (!ts.isIdentifier(declaration.name) || !ts.isVariableDeclarationList(declaration.parent)) return false
    if ((declaration.parent.flags & ts.NodeFlags.Const) === 0) return false
    return referencesOf(declaration.name.text).every((reference) => {
      const wrapped = outer(reference)
      const parent = wrapped.parent
      return ts.isTypeOfExpression(parent) ||
        (ts.isPropertyAccessExpression(parent) && parent.expression === wrapped && parent.name.text === "resolve")
    })
  }
  /**
   * A `createRequire(...)` call whose one argument is the module's own `import.meta.url` or
   * `import.meta.filename`: its require resolves from the module itself.
   */
  const hasOwnBase = (call: typescript.CallExpression): boolean => {
    const [base, ...rest] = call.arguments
    const node = base === undefined ? undefined : unwrapped(base)
    return rest.length === 0 && node !== undefined && ts.isPropertyAccessExpression(node) && ts.isMetaProperty(node.expression) &&
      node.expression.keywordToken === ts.SyntaxKind.ImportKeyword && ["url", "filename"].includes(node.name.text)
  }
  /** A loader value (`require`, a `createRequire(...)` result): a direct call, `.resolve`, `typeof`, or a resolver `const`. */
  const checkLoaderValue = (node: typescript.Expression): void => {
    const wrapped = outer(node)
    const parent = wrapped.parent
    if (isDirectCallee(node) || ts.isTypeOfExpression(parent)) return
    if (ts.isPropertyAccessExpression(parent) && parent.expression === wrapped && parent.name.text === "resolve") return
    if (ts.isVariableDeclaration(parent) && parent.initializer === wrapped && isResolverConst(parent)) return
    loaderReferences.push(node)
  }
  /**
   * A holder: the object of a member access by a name the scan reads, `typeof`, or the value of a
   * destructuring (whose names the binding check reads). A load of a holder module may also be
   * bound to a name (a holder in turn), or stand alone; an `import()` or `vi.importActual` of one
   * must be awaited first.
   */
  const checkHolder = (node: typescript.Expression, load: boolean): void => {
    let wrapped = outer(node)
    let parent = wrapped.parent
    const bindsName = (declaration: typescript.Node): boolean =>
      ts.isVariableDeclaration(declaration) && declaration.initializer === wrapped && ts.isIdentifier(declaration.name)
    const asyncLoad = load && ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword || ["importActual", "importMock"].includes(memberName(unwrapped(node.expression)) ?? ""))
    if (asyncLoad && !ts.isAwaitExpression(parent)) {
      if (!(ts.isExpressionStatement(parent) || ts.isVoidExpression(parent) || bindsName(parent))) loaderReferences.push(node)
      return
    }
    while (ts.isAwaitExpression(parent)) {
      wrapped = outer(parent)
      parent = wrapped.parent
    }
    if (ts.isTypeOfExpression(parent) || isStaticMemberObject(wrapped, parent)) return
    if (ts.isVariableDeclaration(parent) && parent.initializer === wrapped && ts.isObjectBindingPattern(parent.name)) return
    if (load && (ts.isExpressionStatement(parent) || ts.isVoidExpression(parent) || bindsName(parent))) return
    loaderReferences.push(node)
  }
  /** The object binding pattern takes apart a holder: the value of its declaration, or a holder member of an outer one. */
  const takesHolderApart = (pattern: typescript.ObjectBindingPattern): boolean => {
    const parent = pattern.parent
    if (ts.isVariableDeclaration(parent)) return parent.initializer !== undefined && isHolder(parent.initializer)
    if (!ts.isBindingElement(parent) || !ts.isObjectBindingPattern(parent.parent)) return false
    const key = bindingKey(parent)
    return key !== null && HOLDER_MEMBERS.has(key) && takesHolderApart(parent.parent)
  }
  const exportedLoader = (name: string): boolean =>
    LOADER_BINDING_KEYS.has(name) || RUNNER_INTERNAL.test(name) || ["createRequire", "vi", "module", "Module"].includes(name) ||
    holderNames.has(name) || createRequireNames.has(name) || requireNames.has(name)
  /**
   * A name that an import or an export takes from a module, that loads or runs code: a name of
   * `CODE_LOADER_NAMES`, a value of `vitest/node` but Vitest's own runs, and a value of Node's
   * `module` that is no resolver (`register`, `registerHooks`). A type loads nothing.
   */
  const takesCodeLoader = (name: string, from: string | undefined, typeOnly: boolean): boolean =>
    !typeOnly && (
      CODE_LOADER_NAMES.has(name) ||
      (from === "vitest/node" && !VITEST_NODE_RUNS.has(name)) ||
      (from !== undefined && ["node:module", "module"].includes(from) && !MODULE_SAFE_IMPORTS.has(name))
    )
  /** The text of a string-literal module specifier, else undefined. */
  const specifierText = (specifier: typescript.Expression | undefined): string | undefined =>
    specifier !== undefined && ts.isStringLiteralLike(specifier) ? specifier.text : undefined
  /**
   * An import or export declaration that takes code loaders as a whole: a value import, export or
   * side-effect import of a module of `EVALUATOR_MODULES` or a runner module (`isRunnerModule`), and
   * a namespace or default import, or an `export *`, of `vitest/node`. A declaration of types only
   * loads nothing.
   */
  const loadsCodeModule = (node: typescript.ImportDeclaration | typescript.ExportDeclaration): boolean => {
    const from = specifierText(node.moduleSpecifier)
    if (from === undefined) return false
    if (ts.isExportDeclaration(node)) {
      if (node.isTypeOnly) return false
      const all = node.exportClause === undefined || ts.isNamespaceExport(node.exportClause)
      return EVALUATOR_MODULES.has(from) || isRunnerModule(from) || (from === "vitest/node" && all)
    }
    const clause = node.importClause
    if (clause?.phaseModifier === ts.SyntaxKind.TypeKeyword) return false
    const bindings = clause?.namedBindings
    const whole = clause?.name !== undefined || (bindings !== undefined && ts.isNamespaceImport(bindings))
    const values = clause === undefined || whole ||
      (bindings !== undefined && ts.isNamedImports(bindings) && (bindings.elements.length === 0 || bindings.elements.some((element) => !element.isTypeOnly)))
    return values && (EVALUATOR_MODULES.has(from) || isRunnerModule(from) || (from === "vitest/node" && whole))
  }
  /** The expression is bound by an import (a namespace, a default or a named import): `Effect.Function` is no global. */
  const isImportBound = (expression: typescript.Expression): boolean => {
    const node = unwrapped(expression)
    return ts.isIdentifier(node) && imports.has(node.text)
  }
  /** The expression is the free name `name` (no scope declares it). */
  const isFreeName = (expression: typescript.Expression, name: string): boolean => {
    const node = unwrapped(expression)
    return ts.isIdentifier(node) && node.text === name && isFree(node)
  }
  /**
   * The identifier is an operand of `typeof` or of `instanceof` (a check of a value's kind), or
   * the object of `.prototype` (`Function.prototype.toString`; its `constructor` is a member that
   * `isConstructorReference` reads): it runs nothing.
   */
  const isKindCheck = (node: typescript.Node): boolean => {
    const wrapped = outer(node)
    const parent = wrapped.parent
    return ts.isTypeOfExpression(parent) ||
      (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword) ||
      (ts.isPropertyAccessExpression(parent) && parent.expression === wrapped && parent.name.text === "prototype")
  }
  /**
   * A member `constructor` that may give the `Function` constructor (the constructor of a function
   * is `Function`): one of a function, a class, a prototype, another constructor or a
   * `getPrototypeOf(...)` result; and any other one but the object of `.name` (`x.constructor.name`,
   * the one member it may give; not `.value` of a descriptor map, `.call`, `.apply`, `.bind`; the
   * seventh Layer-3 review's Y6), an operand of a comparison, of `typeof` or of `instanceof`, and
   * the argument of `Predicate.isFunction(...)` (a check of its kind): a call, a `new`, a variable,
   * an argument, a return value.
   */
  const isConstructorReference = (access: typescript.PropertyAccessExpression | typescript.ElementAccessExpression): boolean => {
    const object = unwrapped(access.expression)
    if (ts.isArrowFunction(object) || ts.isFunctionExpression(object) || ts.isClassExpression(object)) return true
    if (ts.isCallExpression(object) && memberName(unwrapped(object.expression)) === "getPrototypeOf") return true
    if (["constructor", "prototype"].includes(memberName(object) ?? "")) return true
    const wrapped = outer(access)
    const parent = wrapped.parent
    if (isStaticMemberObject(wrapped, parent)) return memberName(parent) !== "name"
    if (ts.isTypeOfExpression(parent)) return false
    const comparisons = [
      ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.InstanceOfKeyword
    ]
    if (ts.isBinaryExpression(parent) && comparisons.includes(parent.operatorToken.kind)) return false
    const callee = ts.isCallExpression(parent) && parent.arguments.some((argument) => argument === wrapped) ? unwrapped(parent.expression) : null
    return !(callee !== null && ts.isPropertyAccessExpression(callee) && callee.name.text === "isFunction" && isEffectPredicate(callee.expression))
  }
  /**
   * A value that may be a function or its prototype, whose property descriptors hold the
   * `Function` constructor: a function or class literal, a member `prototype` or `constructor`, a
   * `getPrototypeOf(...)` result, or `Function` where no scope declares it.
   */
  const mayBeFunction = (expression: typescript.Expression): boolean => {
    const node = unwrapped(expression)
    return ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isClassExpression(node) ||
      ["prototype", "constructor"].includes(memberName(node) ?? "") ||
      (ts.isCallExpression(node) && memberName(unwrapped(node.expression)) === "getPrototypeOf") ||
      isFreeName(node, "Function")
  }
  /**
   * A member `getOwnPropertyDescriptors` that copies the properties of a value that is no function
   * onto another value: the direct callee of a call, with an argument that `mayBeFunction` does
   * not take, that is the second argument of `Object.defineProperties(...)` or `Object.create(...)`
   * (`src/Actor.ts` and `test/upstream/trackEntries.ts` copy getters so). Each other one gives a
   * map whose values reach every property, the `constructor` of a prototype among them (the
   * seventh Layer-3 review's Y6: `Object.getOwnPropertyDescriptors(Function.prototype)`).
   */
  const copiesDescriptors = (access: typescript.PropertyAccessExpression | typescript.ElementAccessExpression): boolean => {
    if (ts.isElementAccessExpression(access) || !isDirectCallee(access)) return false
    const call = outer(access).parent
    if (!ts.isCallExpression(call)) return false
    const [value] = call.arguments
    if (value === undefined || mayBeFunction(value)) return false
    const wrapped = outer(call)
    const copy = wrapped.parent
    if (!ts.isCallExpression(copy) || copy.arguments[1] !== wrapped) return false
    const callee = unwrapped(copy.expression)
    return ts.isPropertyAccessExpression(callee) && ["defineProperties", "create"].includes(callee.name.text) && isFreeName(callee.expression, "Object")
  }
  /** The expression is effect's `Predicate` module, by the name a named import of `effect` binds (`import { Predicate } from "effect"`). */
  const isEffectPredicate = (expression: typescript.Expression): boolean => {
    const node = unwrapped(expression)
    const binding = ts.isIdentifier(node) ? imports.get(node.text) : undefined
    return binding?.specifier === "effect" && binding.name === "Predicate"
  }
  const visitLoaders = (node: typescript.Node): void => {
    // A type loads nothing (`typeof vi.importActual` in a type); a class's `extends` is code
    if (ts.isTypeNode(node) && !ts.isExpressionWithTypeArguments(node)) return
    // An import, export or side-effect import of a module that runs code (node:vm) or of Vite's or
    // Vitest's runner API (vite's runnerImport, createServer): the whole declaration
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && loadsCodeModule(node)) {
      loaderReferences.push(node)
      return
    }
    if (
      ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && !node.isTypeOnly &&
      ((from) => from !== undefined && (EVALUATOR_MODULES.has(from) || isRunnerModule(from) || from === "vitest/node"))(specifierText(node.moduleReference.expression))
    ) {
      loaderReferences.push(node)
      return
    }
    if (ts.isImportSpecifier(node)) {
      const imported = (node.propertyName ?? node.name).text
      const declaration = node.parent.parent.parent
      const typeOnly = node.isTypeOnly || declaration.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword
      if (LOADER_BINDING_KEYS.has(imported) || RUNNER_INTERNAL.test(imported) || takesCodeLoader(imported, specifierText(declaration.moduleSpecifier), typeOnly)) {
        loaderReferences.push(node)
      }
      return
    }
    if (ts.isExportSpecifier(node)) {
      const exported = (node.propertyName ?? node.name).text
      const declaration = node.parent.parent
      const typeOnly = node.isTypeOnly || declaration.isTypeOnly
      if (exportedLoader(exported) || takesCodeLoader(exported, specifierText(declaration.moduleSpecifier), typeOnly)) loaderReferences.push(node)
      return
    }
    // `export *` or `export * as` of a holder module passes its loaders on under names that the
    // importer cannot tie to it (`export * as M from "node:module"`, then `M.createRequire`)
    if (
      ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteralLike(node.moduleSpecifier) &&
      HOLDER_MODULES.has(node.moduleSpecifier.text) && (node.exportClause === undefined || ts.isNamespaceExport(node.exportClause))
    ) {
      loaderReferences.push(node)
    }
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const key = bindingKey(node)
      const codeLoader = key !== null && (CODE_LOADER_NAMES.has(key) || EVALUATING_GLOBALS.has(key) || key === "constructor" || key === DESCRIPTOR_MAP)
      if (key !== null && (LOADER_BINDING_KEYS.has(key) || RUNNER_INTERNAL.test(key) || codeLoader)) {
        loaderReferences.push(node)
      } else if (
        takesHolderApart(node.parent) && (node.dotDotDotToken !== undefined || key === null || VI_LOADER_MEMBERS.has(key) || key === "register")
      ) {
        loaderReferences.push(node)
      }
    }
    if (ts.isIdentifier(node)) {
      const text = node.text
      const watched = text === "require" || text === "module" || text.startsWith("__vite") || createRequireNames.has(text) || holderNames.has(text)
      if (watched && isReference(node)) {
        if (RUNNER_INTERNAL.test(text)) loaderReferences.push(node)
        else if (text === "require" && isFree(node)) checkLoaderValue(node)
        else if (createRequireNames.has(text)) {
          if (!isDirectCallee(node)) loaderReferences.push(node)
        } else if (holderNames.has(text) || (text === "module" && isFree(node))) checkHolder(node, false)
      }
      // A code loader under its own name (`runnerImport(...)`), and `eval` or the `Function`
      // constructor where no scope declares the name, but in a check of a value's kind
      if (isReference(node)) {
        if (CODE_LOADER_NAMES.has(text)) loaderReferences.push(node)
        else if (EVALUATING_GLOBALS.has(text) && isFree(node) && !isKindCheck(node)) loaderReferences.push(node)
      }
    }
    if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) checkHolder(node, false)
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = memberName(node)
      const element = ts.isElementAccessExpression(node)
      if (name !== null) {
        if (CALLED_LOADER_MEMBERS.has(name)) {
          if (element || !isDirectCallee(node)) loaderReferences.push(node)
        } else if (UNFOLLOWED_LOADER_MEMBERS.has(name) || RUNNER_INTERNAL.test(name)) {
          loaderReferences.push(node)
        } else if (ts.isMetaProperty(unwrapped(node.expression)) && name.startsWith("glob")) {
          if (element || !isDirectCallee(node)) loaderReferences.push(node)
        } else if (VI_LOADER_MEMBERS.has(name) && isHolder(node.expression)) {
          if (element || !isDirectCallee(node)) loaderReferences.push(node)
        } else if (HOLDER_MEMBERS.has(name) && isHolder(node.expression)) {
          checkHolder(node, false)
        } else if (
          // A code loader as a member (`server.ssrLoadModule`, `process.dlopen`), the `import` of a
          // module runner or a Vitest instance (`vitest.import(...)`), `eval` or `Function` of a
          // value no import binds (`globalThis.eval`), `process.binding`, a holder's `register`
          // (Node's `module.register` hook), and a `constructor` that may be `Function`
          CODE_LOADER_NAMES.has(name) || name === "import" ||
          (EVALUATING_GLOBALS.has(name) && !isImportBound(node.expression)) ||
          (name === "binding" && isFreeName(node.expression, "process")) ||
          (name === "register" && isHolder(node.expression)) ||
          (name === "constructor" && isConstructorReference(node)) ||
          (name === DESCRIPTOR_MAP && !copiesDescriptors(node))
        ) {
          loaderReferences.push(node)
        }
      }
    }
    if (ts.isCallExpression(node)) {
      // A require from another base than the module itself (the eighth Layer-3 review's G14,
      // G22, G23): its loads run as loads of that base, so a hook that trusts a parent, and the
      // walk, which reads a require specifier from the module itself, see another importer
      if (isCreateRequire(node.expression)) {
        if (hasOwnBase(node)) checkLoaderValue(node)
        else loaderReferences.push(node)
      }
      if (isHolderLoad(node)) checkHolder(node, true)
      // A load of a module that runs code, or of Vite's or Vitest's runner API, by any loader
      // (`import("node:vm")`, `require("vm")`, `process.getBuiltinModule("node:vm")`), and a
      // builtin module that a key the walk cannot read names (`process.getBuiltinModule(name)`)
      const [first] = node.arguments
      const literal = specifierText(first)
      const callee = unwrapped(node.expression)
      const getsBuiltin = memberName(callee) === "getBuiltinModule" || (ts.isIdentifier(callee) && callee.text === "getBuiltinModule")
      const loads = getsBuiltin || node.expression.kind === ts.SyntaxKind.ImportKeyword || isRequire(node.expression) ||
        ["importActual", "importMock"].includes(memberName(callee) ?? "") ||
        (ts.isPropertyAccessExpression(callee) && VI_LOADER_MEMBERS.has(callee.name.text) && isHolder(callee.expression))
      if (
        (loads && literal !== undefined && (EVALUATOR_MODULES.has(literal) || isRunnerModule(literal) || literal === "vitest/node")) ||
        (getsBuiltin && literal === undefined)
      ) {
        loaderReferences.push(node)
      }
    }
    // A key that reaches the Function constructor at run time (`Reflect.get(f, "constructor")`)
    if (ts.isStringLiteralLike(node) && node.text === "constructor") {
      const wrapped = outer(node)
      const call = wrapped.parent
      const callee = ts.isCallExpression(call) && call.arguments.some((argument) => argument === wrapped) ? unwrapped(call.expression) : null
      const reflects = callee !== null && ts.isPropertyAccessExpression(callee) &&
        (isFreeName(callee.expression, "Reflect") || (isFreeName(callee.expression, "Object") && callee.name.text.startsWith("getOwnPropertyDescriptor")))
      if (reflects) loaderReferences.push(node)
    }
    ts.forEachChild(node, visitLoaders)
  }
  visitLoaders(sf)
  loaderReferences.sort((a, b) => a.getStart(sf) - b.getStart(sf))

  // ---- capabilities (the default deny of CONF-8): each value load of a module that is not
  // allowlisted, and each use of `process` or of the TypeScript module but a plain member
  const capabilityNodes = new Map<typescript.Node, string>()
  const valueLoads: Array<ValueLoad> = []
  const capability = (node: typescript.Node, name: string): void => {
    if (!capabilityNodes.has(node)) capabilityNodes.set(node, name)
  }
  const load = (node: typescript.Node, specifier: string, names: ReadonlyArray<string> | null, call: boolean): void => {
    valueLoads.push({ specifier, names })
    const used = capabilityOfSpecifier(specifier, names, call)
    if (used !== null) capability(node, used)
  }
  /** The names a static import or a static re-export takes as values: null for the whole module (a default, a namespace, `export *`). */
  const valueNames = (node: typescript.ImportDeclaration | typescript.ExportDeclaration): ReadonlyArray<string> | null | "types" => {
    if (ts.isExportDeclaration(node)) {
      if (node.isTypeOnly) return "types"
      const clause = node.exportClause
      if (clause === undefined || ts.isNamespaceExport(clause)) return null
      const values = clause.elements.filter((element) => !element.isTypeOnly)
      return values.length === 0 && clause.elements.length > 0 ? "types" : values.map((element) => (element.propertyName ?? element.name).text)
    }
    const clause = node.importClause
    if (clause === undefined) return null
    if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return "types"
    const bindings = clause.namedBindings
    if (clause.name !== undefined || (bindings !== undefined && ts.isNamespaceImport(bindings))) return null
    const elements = bindings !== undefined && ts.isNamedImports(bindings) ? bindings.elements : []
    const values = elements.filter((element) => !element.isTypeOnly)
    return values.length === 0 && elements.length > 0 ? "types" : values.map((element) => (element.propertyName ?? element.name).text)
  }
  /** The names that a static import binds to the TypeScript module as a whole (a default or a namespace import). */
  const typescriptNames = new Set<string>()
  /** The identifier names the binding of the module scope (an import), not a name a nested scope declares. */
  const bindsModuleScope = (identifier: typescript.Identifier): boolean => {
    for (let scope = identifier.parent; scope !== undefined; scope = scope.parent) {
      if (declaresIn(scope, identifier.text)) return ts.isSourceFile(scope)
    }
    return false
  }
  /**
   * A use of a holder of capabilities (`process`, the TypeScript module): the object of a member
   * access by a name the scan reads, whose member is a capability when `members` holds its name; a
   * `typeof` operand; a destructuring with names the scan reads. Each other use (passed on, stored,
   * spread, a computed member, `Reflect.get`) is the capability `whole`.
   */
  const checkCapabilityHolder = (node: typescript.Identifier, whole: string, members: ReadonlySet<string>, prefix: string): void => {
    const wrapped = outer(node)
    const parent = wrapped.parent
    if (ts.isTypeOfExpression(parent)) return
    if (isStaticMemberObject(wrapped, parent)) {
      const name = memberName(parent)
      if (name !== null && members.has(name)) capability(parent, `${prefix}.${name}`)
      return
    }
    if (ts.isVariableDeclaration(parent) && parent.initializer === wrapped && ts.isObjectBindingPattern(parent.name)) {
      for (const element of parent.name.elements) {
        const key = bindingKey(element)
        if (element.dotDotDotToken !== undefined || key === null) capability(element, whole)
        else if (members.has(key)) capability(element, `${prefix}.${key}`)
      }
      return
    }
    capability(node, whole)
  }
  const TYPESCRIPT_LOADERS: ReadonlySet<string> = new Set(["sys", "server"])
  const visitCapabilities = (node: typescript.Node): void => {
    // A type loads nothing; a class's `extends` is code
    if (ts.isTypeNode(node) && !ts.isExpressionWithTypeArguments(node)) return
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const names = valueNames(node)
      if (names !== "types") load(node, node.moduleSpecifier.text, names, false)
      if (ts.isImportDeclaration(node) && node.moduleSpecifier.text === "typescript" && names !== "types") {
        const clause = node.importClause
        const bindings = clause?.namedBindings
        if (clause?.name !== undefined) typescriptNames.add(clause.name.text)
        if (bindings !== undefined && ts.isNamespaceImport(bindings)) typescriptNames.add(bindings.name.text)
        if (bindings !== undefined && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            const imported = (element.propertyName ?? element.name).text
            if (TYPESCRIPT_LOADERS.has(imported)) capability(element, `typescript.${imported}`)
          }
        }
      }
    }
    if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)) {
      const reference = node.moduleReference.expression
      if (ts.isStringLiteralLike(reference)) load(node, reference.text, null, true)
    }
    if (ts.isCallExpression(node)) {
      const callee = unwrapped(node.expression)
      const [first] = node.arguments
      const loads = node.expression.kind === ts.SyntaxKind.ImportKeyword || isRequire(node.expression) ||
        ["importActual", "importMock"].includes(memberName(callee) ?? "") ||
        (ts.isPropertyAccessExpression(callee) && VI_LOADER_MEMBERS.has(callee.name.text) && isHolder(callee.expression))
      if (loads && first !== undefined && ts.isStringLiteralLike(first)) load(node, first.text, null, true)
    }
    if (ts.isIdentifier(node) && isReference(node)) {
      if (node.text === "process" && isFree(node)) checkCapabilityHolder(node, "process", PROCESS_CAPABILITIES, "process")
      else if (typescriptNames.has(node.text) && bindsModuleScope(node)) checkCapabilityHolder(node, "typescript", TYPESCRIPT_LOADERS, "typescript")
      if (node.text === "getBuiltinModule") capability(node, "process.getBuiltinModule")
    }
    // `getBuiltinModule` of any value (`globalThis.process.getBuiltinModule`), and as a destructured name
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && memberName(node) === "getBuiltinModule") {
      capability(node, "process.getBuiltinModule")
    }
    if (ts.isBindingElement(node) && bindingKey(node) === "getBuiltinModule") capability(node, "process.getBuiltinModule")
    // The project service of typescript-eslint's parser loads the plugins a tsconfig names when
    // this option is on
    if (
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && propertyKey(node.name) === "loadTypeScriptPlugins" &&
      !(ts.isPropertyAssignment(node) && unwrapped(node.initializer).kind === ts.SyntaxKind.FalseKeyword)
    ) {
      capability(node, "typescript-eslint loadTypeScriptPlugins")
    }
    ts.forEachChild(node, visitCapabilities)
  }
  // The TypeScript names first: an import below its first use still binds it
  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier) && statement.moduleSpecifier.text === "typescript") {
      const clause = statement.importClause
      const bindings = clause?.namedBindings
      if (clause !== undefined && clause.phaseModifier !== ts.SyntaxKind.TypeKeyword) {
        if (clause.name !== undefined) typescriptNames.add(clause.name.text)
        if (bindings !== undefined && ts.isNamespaceImport(bindings)) typescriptNames.add(bindings.name.text)
      }
    }
  }
  visitCapabilities(sf)

  const isRooted = (expression: typescript.Expression): boolean => {
    const root = chainRoot(expression, isRequire)
    return root !== null && roots.has(root)
  }

  /** An object or array literal that holds a value rooted at the test API: `{ it }`, `{ api: it.effect }`, `[describe]`, `{ ...vitest }`. */
  const holdsRoot = (expression: typescript.Expression): boolean => {
    const node = unwrapped(expression)
    const holds = (value: typescript.Expression): boolean => isRooted(value) || holdsRoot(value)
    if (ts.isObjectLiteralExpression(node)) {
      return node.properties.some((property) =>
        ts.isShorthandPropertyAssignment(property)
          ? holds(property.name)
          : ts.isPropertyAssignment(property)
          ? holds(property.initializer)
          : ts.isSpreadAssignment(property) && holds(property.expression)
      )
    }
    return ts.isArrayLiteralExpression(node) &&
      node.elements.some((element) => holds(ts.isSpreadElement(element) ? element.expression : element))
  }

  // The test API under another name: each variable whose value is rooted at a root or is a literal
  // that holds one (`const api = { it }`), and each name that a destructuring of a root binds to
  // `it`, `test`, `describe` or `suite`, or to the rest (`const { it: t } = await
  // import("vitest")`), until no root is added
  for (let grown = true; grown;) {
    grown = false
    const named = [
      ...[...variables].filter(([, initializers]) => initializers.some((value) => isRooted(value) || holdsRoot(value))).map(([name]) => name),
      ...destructurings.filter(({ initializer }) => isRooted(initializer)).flatMap(({ pattern }) =>
        pattern.elements.flatMap((element) => {
          const key = bindingKey(element)
          const api = element.dotDotDotToken !== undefined || (key !== null && TEST_API_ROOTS.has(key))
          return ts.isIdentifier(element.name) && api ? [element.name.text] : []
        })
      )
    ]
    for (const name of named) {
      if (!roots.has(name)) {
        roots.add(name)
        grown = true
      }
    }
  }

  /** The values the local function `name` returns, or null when `name` is not a local function. */
  const localReturns = (name: string): ReadonlyArray<typescript.Expression> | null => {
    const declared: ReadonlyArray<typescript.Node> = [...(variables.get(name) ?? []), ...(functions.get(name) ?? [])]
    return declared.length > 0 && declared.every(isFunction) ? declared.filter(isFunction).flatMap(returnsOf) : null
  }

  /**
   * What an options argument may hold that skips a test: the skip members of each object
   * literal it may be, and each value the scan cannot read. A value imported by name goes to
   * `imported`. `seen` holds the names read for the argument: each name is read once, since the
   * findings are the union over every route to it, and a cycle of names ends.
   */
  const optionsFindings = (
    argument: typescript.Expression,
    seen: Set<string>,
    imported: Array<{ readonly specifier: string; readonly name: string; readonly call: boolean }>
  ): ReadonlyArray<typescript.Node> => {
    const value = unwrapped(argument)
    if (ts.isObjectLiteralExpression(value)) return skipOptionsIn(value)
    if (ts.isConditionalExpression(value)) {
      return [...optionsFindings(value.whenTrue, seen, imported), ...optionsFindings(value.whenFalse, seen, imported)]
    }
    if (isPlainValue(value)) return []
    const call = ts.isCallExpression(value)
    const callee = call ? unwrapped(value.expression) : value
    if (!ts.isIdentifier(callee)) return [value]
    const name = callee.text
    // Each name (as a value, or as a function called) is read once for the argument: the findings
    // are the union over every route to it, so a second route adds nothing, and a cycle ends
    const key = `${call ? "call" : "value"}:${name}`
    if (seen.has(key)) return []
    seen.add(key)
    const local = call ? localReturns(name) : functions.has(name) ? [] : variables.get(name)
    if (local !== null && local !== undefined) return local.flatMap((entry) => optionsFindings(entry, seen, imported))
    const binding = imports.get(name)
    if (binding === undefined) return [value]
    imported.push({ ...binding, call })
    return []
  }

  const textOf = (node: typescript.Node): string =>
    `${sf.fileName}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1} ${node.getText(sf)}`

  // Each form once, whatever number of routes finds it (a module of some thousand calls, a bundle,
  // reaches the same options value from many of them)
  const found = new Set<typescript.Node>([...modifierImports, ...reExports])
  const addAll = (nodes: ReadonlyArray<typescript.Node>): void => {
    for (const node of nodes) found.add(node)
  }
  const importedOptions: Array<ImportedOptions> = []
  for (const access of modifierMembers) {
    const called = ts.isCallExpression(access.parent) && access.parent.expression === access
    if (called || isRooted(access.expression)) found.add(access)
  }
  // A member of the test API that the scan cannot read: `it[k]`, `it.effect[name]`. A chain
  // through a call is left out (`test.meta()[key]` on a test case named test); an alias of a
  // call's result is a root of its own (`const t2 = it.extend({})`, then `t2[k]`)
  addAll(computedMembers.filter((access) => {
    const root = chainRoot(access.expression, isRequire, false)
    return root !== null && roots.has(root)
  }))
  // A destructuring of the test API: each member it reads that the scan cannot read
  // (`const { [k]: f } = it`), and each modifier it takes from the test-API module itself
  // (`const { flakyTest } = await import("@effect/vitest")`), as a named import does
  for (const { pattern, initializer } of destructurings) {
    if (!isRooted(initializer)) continue
    const fromModule = chainRoot(initializer, isRequire) === MODULE_ROOT
    addAll(pattern.elements.filter((element) => {
      if (element.dotDotDotToken !== undefined) return false
      const key = bindingKey(element)
      return key === null || (fromModule && SKIP_MODIFIERS.has(key))
    }))
  }
  const optionsObjects = (argument: typescript.Expression): ReadonlyArray<typescript.ObjectLiteralExpression> => {
    const value = unwrapped(argument)
    return (ts.isIdentifier(value) ? variables.get(value.text) ?? [] : [value]).filter(ts.isObjectLiteralExpression)
  }
  for (const call of calls) {
    if (isRooted(call.expression)) {
      const [name, ...rest] = call.arguments
      // The name: only an options object written there or held by a variable counts
      if (name !== undefined) addAll(optionsObjects(name).flatMap(skipOptionsIn))
      for (const argument of rest) {
        const imported: Array<{ readonly specifier: string; readonly name: string; readonly call: boolean }> = []
        addAll(optionsFindings(argument, new Set(), imported))
        importedOptions.push(...imported.map((entry) => ({ ...entry, text: textOf(argument) })))
      }
    }
    const callee = unwrapped(call.expression)
    if (ts.isIdentifier(callee) && modifierNames.has(callee.text)) found.add(call)
  }
  const forms = [...found]
    .map((node) => ({ node, start: node.getStart(sf) }))
    .sort((a, b) => a.start - b.start)
    .map(({ node }) => ({ node, text: textOf(node) }))

  const exportedOptions = (name: string, call: boolean): ReadonlyArray<string> | null => {
    const values = !exported.has(name) ? null : call ? localReturns(name) : functions.has(name) ? [] : variables.get(name) ?? null
    if (values === null) return null
    const imported: Array<{ readonly specifier: string; readonly name: string; readonly call: boolean }> = []
    const seen = new Set([`${call ? "call" : "value"}:${name}`])
    const findings = values.flatMap((value) => optionsFindings(value, seen, imported))
    return imported.length > 0 ? null : findings.map(textOf)
  }
  const unreadableImports = importCalls.map((call) => ({ call, text: textOf(call) }))
  const asForms = (nodes: ReadonlyArray<typescript.Node>): ReadonlyArray<SkipForm> => nodes.map((node) => ({ node, text: textOf(node) }))
  return {
    specifiers,
    unreadableImports,
    forms,
    importedOptions,
    exportedOptions,
    flakyTestNames: asForms(flakyTestNames),
    flakyTestTexts: asForms(flakyTestTexts),
    loaderReferences: asForms(loaderReferences),
    loaderTexts: asForms(loaderTexts),
    capabilities: [...capabilityNodes]
      .sort(([a], [b]) => a.getStart(sf) - b.getStart(sf))
      .map(([node, capability]) => ({ node, text: textOf(node), capability })),
    valueLoads
  }
}

// ---------------------------------------------------------------- module paths

/** The script extensions a module of the package may have. */
export const SCRIPT_EXTENSIONS: ReadonlyArray<string> = [".ts", ".mts", ".cts", ".tsx", ".js", ".mjs", ".cjs", ".jsx"]

/**
 * The package paths a specifier may name: a relative specifier, or one through the default
 * config's `@` alias (`./src`). Vite takes a relative alias value as it is, so `@/x` may name
 * `src/x` or `<importer folder>/src/x`; both are tried. For each target: the TypeScript source
 * of a `.js` path, as `parity.ts` resolves one (the source writes `.js` for a `.ts` module), and
 * of a `.mjs`, `.cjs` or `.jsx` path; the path with each script extension; its index module;
 * and the path itself. None for a package specifier.
 */
export const specifierCandidates = (fromPath: string, specifier: string): ReadonlyArray<string> => {
  const folder = posix.dirname(fromPath)
  const targets = specifier.startsWith(".")
    ? [posix.join(folder, specifier)]
    : specifier === "@" || specifier.startsWith("@/")
    ? [posix.join("src", specifier.slice(1)), posix.join(folder, "src", specifier.slice(1))]
    : []
  return [
    ...new Set(targets.flatMap((target) => {
      const base = posix.normalize(target)
      return [
        base.replace(/\.js$/, ".ts"),
        `${base}.ts`,
        posix.join(base, "index.ts"),
        base,
        base.replace(/\.([cm]?)js(x?)$/, ".$1ts$2"),
        ...SCRIPT_EXTENSIONS.flatMap((extension) => [`${base}${extension}`, posix.join(base, `index${extension}`)])
      ]
    }))
  ]
}

/** A script module of the package itself: not a dependency, and not outside the package. */
export const isPackageModule = (path: string): boolean => {
  const segments = path.split("/")
  return !segments.includes("..") && !segments.includes("node_modules") &&
    SCRIPT_EXTENSIONS.some((extension) => path.endsWith(extension))
}

// ---------------------------------------------------------------- imported options values

/**
 * The imported options values of a module, each read in the module of the package that exports
 * it: nothing when it holds no skip option; else the argument, followed by the forms found in
 * the exporting module. The argument alone when the scan cannot read the value there (a
 * dependency, a missing module or export, or a value from yet another module).
 * `exportedOptionsOf` gives the `exportedOptions` of a module from its source and path.
 */
export const readImportedOptions = (
  path: string,
  importedOptions: ReadonlyArray<ImportedOptions>,
  readSource: (path: string) => string | undefined,
  exportedOptionsOf: (source: string, path: string) => TreeFacts["exportedOptions"]
): ReadonlyArray<string> =>
  importedOptions.flatMap((entry) => {
    const target = specifierCandidates(path, entry.specifier).find((candidate) =>
      isPackageModule(candidate) && readSource(candidate) !== undefined
    )
    const source = target === undefined ? undefined : readSource(target)
    const read = target === undefined || source === undefined ? null : exportedOptionsOf(source, target)(entry.name, entry.call)
    return read === null ? [entry.text] : read.length === 0 ? [] : [entry.text, ...read]
  })


// ---------------------------------------------------------------- one parse per module

/** The node is the container, or lies inside it. */
const isInside = (node: typescript.Node, container: typescript.Node): boolean =>
  node === container || (node.parent !== undefined && isInside(node.parent, container))

/**
 * The one named exemption of the import walk: HARNESS-2's own `importModule`, which loads a
 * config file of the package (`vitest.config.ts`, `vitest.upstream.config.ts`,
 * `eslint.config.mjs`) by a path it builds from its argument,
 *
 *     Effect.promise(() => import(pathToFileURL(join(pkgRoot, relative)).href) as Promise<A>)
 *
 * The exemption covers that one `import(...)` in the body of `importModule`, and holds only
 * while that file declares `importModule` once and uses the name nowhere else but as the callee
 * of a call with one string literal. The walk then reads each such literal as a path from the
 * package root (`importModuleExemption`), as it reads a specifier, so a config file that
 * `importModule` loads is walked, and a pending path given to it is found. In any other state
 * of the file the walk reports the import.
 */
export const IMPORT_MODULE = {
  file: "test/verify/verify-xstate-5-33-2-port-HARNESS-2.spec.ts",
  name: "importModule",
  code: "import(pathToFileURL(join(pkgRoot, relative)).href)"
} as const

/**
 * The exemption of a module's unreadable imports (see `IMPORT_MODULE`): the exempted import,
 * and the specifier of each path that the calls of `importModule` name; nothing in any other
 * module, or when the exemption does not hold.
 */
const importModuleExemption = (
  sf: typescript.SourceFile,
  unreadable: ReadonlyArray<UnreadableImport>
): { readonly exempted: UnreadableImport | null; readonly specifiers: ReadonlyArray<string> } => {
  const none = { exempted: null, specifiers: [] }
  if (sf.fileName !== IMPORT_MODULE.file) return none
  const declarations: Array<typescript.VariableDeclaration> = []
  const references: Array<typescript.Identifier> = []
  const visit = (node: typescript.Node): void => {
    if (ts.isIdentifier(node) && node.text === IMPORT_MODULE.name) {
      if (ts.isVariableDeclaration(node.parent) && node.parent.name === node) declarations.push(node.parent)
      else references.push(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  const [declaration] = declarations
  if (declarations.length !== 1 || declaration === undefined) return none
  const inBody = unreadable.filter((entry) => isInside(entry.call, declaration))
  const [exempted] = inBody
  if (inBody.length !== 1 || exempted === undefined || exempted.call.getText(sf) !== IMPORT_MODULE.code) return none
  const paths = references.map((reference) => {
    const call = reference.parent
    const [path] = ts.isCallExpression(call) && call.expression === reference && call.arguments.length === 1 ? call.arguments : []
    return path !== undefined && ts.isStringLiteralLike(path) ? path.text : null
  })
  return paths.every((path) => path !== null)
    ? { exempted, specifiers: paths.map((path) => posix.relative(posix.dirname(sf.fileName), path)) }
    : none
}

/**
 * A use of an API that runs code, pinned to its text (the sixth Layer-3 review of CONF-8): the
 * loader references of one module that the walk does not report while the pin holds. It holds
 * only while the module's loader references are exactly `references` (their code, in source
 * order); the whole source has the SHA-256 that `PINS_FILE` names for the module, when the pin is
 * `wholeSource`; each pinned declaration is declared once at the top level of the module and its
 * statement has the pinned SHA-256; without a whole-source pin, each reference that is no import
 * lies inside a pinned declaration, and each name that a pinned import binds is used only there;
 * and, for `reads`, each other reference to that function is a direct call whose first argument
 * names a path from the package root by a string, or by a top-level `const` that holds one, and
 * that path is one of `paths` when the pin names them; the walk then reads each such path as a
 * specifier of the module (so the module whose code runs is walked and scanned). In any other
 * state of the module the walk reports each reference.
 */
export interface PinnedLoader {
  readonly file: string
  readonly references: ReadonlyArray<string>
  /** The whole source is pinned: `PINS_FILE` names its SHA-256. */
  readonly wholeSource: boolean
  /** The SHA-256 of the statement that declares each name, by name. */
  readonly declarations: Readonly<Record<string, string>>
  /** The function whose calls name each module whose code runs, or null when the pinned code runs no module. */
  readonly reads: string | null
  /**
   * The paths from the package root that a call of `reads` may name, or null when it may name any
   * path: the pinned code runs only these modules, so a call cannot hand it another file (a data
   * file or an extensionless module that holds `Reflect.get(it, "flakyTest")`; the seventh
   * Layer-3 review's PIN1).
   */
  readonly paths: ReadonlyArray<string> | null
  readonly reason: string
}

/**
 * The file that pins the whole source of each pinned module (the harness modules that hold a
 * capability, `CAPABILITY_HOLDERS`, and the whole-source pins of `PINNED_LOADERS`): a JSON object
 * of the SHA-256 of each module's text, by its path from the package root. It is data, so it pins
 * this module too, and CONF-8 checks each pin with a hash of its own.
 */
export const PINS_FILE = "test/verify/capability-pins.json"

/** The pins of `PINS_FILE` of each package root asked for. */
const pinsOfRoots = new Map<string, Readonly<Record<string, string>>>()

/** The whole-source pins of a package root (`PINS_FILE`), by path; none when the file is missing or holds no JSON object. */
export const readPins = (root: string = PACKAGE_ROOT): Readonly<Record<string, string>> => {
  const known = pinsOfRoots.get(root)
  if (known !== undefined) return known
  const path = join(root, PINS_FILE)
  const text = existsSync(path) ? readFileSync(path, "utf8") : "{}"
  const parsed: unknown = isJson(text) ? JSON.parse(text) : {}
  const pins: Readonly<Record<string, string>> = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : {}
  pinsOfRoots.set(root, pins)
  return pins
}

/**
 * The pinned uses of an API that runs code, each in a module that a test module reaches (the
 * walk from the files of the default run reaches each one):
 * - PARITY-2 runs the upstream helpers `test/upstream/utils.ts` and
 *   `test/upstream/graph/testUtils.ts` in a sandbox: `loadHelper` reads the helper's source by its
 *   path from the package root (`readText`), transpiles it to CommonJS and runs it with
 *   `compileFunction` of `node:vm`, with a local `require` that gives only the stubs it is given;
 * - the pending-rewrite guard's setup file registers a Node load hook (`registerHooks`) that
 *   fails the load of a pending rewrite and passes every other load on unchanged;
 * - the flakyTest guard's setup file (CONF-8) registers a Node resolve hook that gives the
 *   flakyTest guard's module in place of `@effect/vitest`, its entry module and its internal
 *   modules, but for the guard's own import of the entry module and the package's own relative
 *   imports, and refuses the builtins that load or spawn code to each importer outside the
 *   dependency store; and it puts guards on the members of `process` that load or spawn code;
 * - upstream's SCXML converter (test support of the SCXML rewrite, D4) runs the ecmascript of an
 *   SCXML document, which is test data (the cases of `@scion-scxml/test-framework` and the
 *   documents the tests write), with `new Function` and `eval`; the pin holds its whole source;
 * - BASELINE-1 resolves package specifiers from the package folder with a require based at the
 *   package's `package.json` (`createRequire(join(pkgRoot, "package.json"))`), read only through
 *   `.resolve`; the pin holds its whole source (the eighth Layer-3 review's fix ask: allow
 *   BASELINE-1:97 by exact text).
 */
export const PINNED_LOADERS: ReadonlyArray<PinnedLoader> = [
  {
    file: "test/verify/verify-xstate-5-33-2-port-PARITY-2.spec.ts",
    references: [`import { compileFunction } from "node:vm"`],
    wholeSource: false,
    declarations: {
      readText: "49483be0708949588dae9e931843196a58de90f9e86274d3d94f9eae83ef77cf",
      loadHelper: "41e78e06ddeed1473fbd730889a31370c50d7ea8f5adecd301a6ba290711979d"
    },
    reads: "loadHelper",
    paths: ["test/upstream/utils.ts", "test/upstream/graph/testUtils.ts"],
    reason: "runs one of the two upstream helpers of the package, which the walk reads, in a sandbox whose require gives only the stubs it is given"
  },
  {
    file: "test/verify/pending-rewrite-setup.ts",
    references: ["registerHooks", "registerHooks"],
    wholeSource: true,
    declarations: {},
    reads: null,
    paths: null,
    reason: "a load hook that fails the load of a pending rewrite and passes every other load on unchanged"
  },
  {
    file: "test/verify/flaky-test-setup.ts",
    references: [
      "registerHooks",
      "registerHooks",
      "process.getBuiltinModule",
      "(process as unknown as { binding: (name: string) => unknown }).binding",
      "process.dlopen",
      "getBuiltinModule(id)",
      "getBuiltinModule(id)",
      "getBuiltinModule(id)",
      "getBuiltinModule(id)",
      "dlopen"
    ],
    wholeSource: true,
    declarations: {},
    reads: null,
    paths: null,
    reason:
      "a resolve hook that gives the flakyTest guard in place of @effect/vitest and refuses the builtins that load or spawn code outside the dependency store, and guards on the members of process that load or spawn code"
  },
  {
    file: "test/upstream/support/scxml.ts",
    references: ["Function", "eval"],
    wholeSource: true,
    declarations: {},
    reads: null,
    paths: null,
    reason: "upstream's SCXML converter runs the ecmascript of an SCXML document, which is test data"
  },
  {
    file: "test/verify/verify-xstate-5-33-2-port-BASELINE-1.spec.ts",
    references: [`createRequire(join(pkgRoot, "package.json"))`],
    wholeSource: true,
    declarations: {},
    reads: null,
    paths: null,
    reason: "a resolver from the package folder, read only through .resolve"
  }
]

/** The SHA-256 of a text, in hexadecimal. */
export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex")

/** The one top-level statement that declares a name (a variable statement or a function declaration), else null. */
export const topLevelDeclaration = (sf: typescript.SourceFile, name: string): typescript.Statement | null => {
  const found = sf.statements.filter((statement) =>
    (ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name)) ||
    (ts.isFunctionDeclaration(statement) && statement.name?.text === name)
  )
  const [statement] = found
  return found.length === 1 && statement !== undefined ? statement : null
}

/** Each identifier of a module with the name that is a reference (`isReference`). */
const referencesIn = (sf: typescript.SourceFile, name: string): ReadonlyArray<typescript.Identifier> => {
  const found: Array<typescript.Identifier> = []
  const visit = (node: typescript.Node): void => {
    if (ts.isIdentifier(node) && node.text === name && isReference(node)) found.push(node)
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

/** The local names that an import declaration, or one import specifier, binds. */
const importedLocalNames = (node: typescript.ImportDeclaration | typescript.ImportSpecifier): ReadonlyArray<string> => {
  if (ts.isImportSpecifier(node)) return [node.name.text]
  const clause = node.importClause
  const bindings = clause?.namedBindings
  return [
    ...(clause?.name !== undefined ? [clause.name.text] : []),
    ...(bindings !== undefined && ts.isNamespaceImport(bindings) ? [bindings.name.text] : []),
    ...(bindings !== undefined && ts.isNamedImports(bindings) ? bindings.elements.map((element) => element.name.text) : [])
  ]
}

/**
 * The exemption of a module's loader references by its pin (`PINNED_LOADERS`): the exempted
 * references, and the specifier of each path that the calls of the pinned reading function name;
 * nothing when the module has no pin or the pin does not hold.
 */
const pinnedLoaderExemption = (
  sf: typescript.SourceFile,
  loaderReferences: ReadonlyArray<SkipForm>
): { readonly exempted: ReadonlySet<SkipForm>; readonly specifiers: ReadonlyArray<string> } => {
  const none = { exempted: new Set<SkipForm>(), specifiers: [] }
  const pin = PINNED_LOADERS.find((entry) => entry.file === sf.fileName)
  if (pin === undefined) return none
  const codes = loaderReferences.map((form) => form.node.getText(sf))
  if (codes.length !== pin.references.length || codes.some((code, index) => code !== pin.references[index])) return none
  if (pin.wholeSource && sha256(sf.text) !== readPins()[pin.file]) return none
  const declarations: Array<typescript.Statement> = []
  for (const [name, hash] of Object.entries(pin.declarations)) {
    const statement = topLevelDeclaration(sf, name)
    if (statement === null || sha256(statement.getText(sf)) !== hash) return none
    declarations.push(statement)
  }
  const inPinned = (node: typescript.Node): boolean => pin.wholeSource || declarations.some((statement) => isInside(node, statement))
  for (const { node } of loaderReferences) {
    const imported = ts.isImportDeclaration(node) || ts.isImportSpecifier(node) ? node : null
    if (imported === null && !inPinned(node)) return none
    if (imported !== null && !importedLocalNames(imported).every((name) => referencesIn(sf, name).every(inPinned))) return none
  }
  const specifiers: Array<string> = []
  if (pin.reads !== null) {
    /** A path from the package root: a string, or a top-level `const` that holds one. */
    const pathOf = (argument: typescript.Expression | undefined): string | null => {
      if (argument === undefined) return null
      if (ts.isStringLiteralLike(argument)) return argument.text
      if (!ts.isIdentifier(argument)) return null
      const statement = topLevelDeclaration(sf, argument.text)
      const declaration = statement !== null && ts.isVariableStatement(statement) && (statement.declarationList.flags & ts.NodeFlags.Const) !== 0
        ? statement.declarationList.declarations.find((entry) => ts.isIdentifier(entry.name) && entry.name.text === argument.text)
        : undefined
      return declaration?.initializer !== undefined && ts.isStringLiteralLike(declaration.initializer) ? declaration.initializer.text : null
    }
    for (const reference of referencesIn(sf, pin.reads)) {
      const call = reference.parent
      const path = ts.isCallExpression(call) && call.expression === reference ? pathOf(call.arguments[0]) : null
      if (path === null || (pin.paths !== null && !pin.paths.includes(path))) return none
      specifiers.push(posix.relative(posix.dirname(sf.fileName), path))
    }
  }
  return { exempted: new Set(loaderReferences), specifiers }
}

/**
 * What one parse of a module gives: its specifiers and the imports the walk cannot read, its
 * skip forms, and where it names `flakyTest`. Each found item is `<file>:<line> <code>`.
 */
export interface ModuleFacts {
  /** The specifiers of the module (`TreeFacts.specifiers`), with those of the named exemption of the walk. */
  readonly specifiers: ReadonlyArray<string>
  /** Each import whose specifier the walk cannot read (`TreeFacts.unreadableImports`), less the named exemption. */
  readonly unreadableImports: ReadonlyArray<string>
  /** Every skip form (`TreeFacts.forms`). */
  readonly forms: ReadonlyArray<string>
  readonly importedOptions: TreeFacts["importedOptions"]
  readonly exportedOptions: TreeFacts["exportedOptions"]
  /** Each identifier named `flakyTest` (`TreeFacts.flakyTestNames`). */
  readonly flakyTestNames: ReadonlyArray<string>
  /** Each string or template part whose text holds `flakyTest` (`TreeFacts.flakyTestTexts`). */
  readonly flakyTestTexts: ReadonlyArray<string>
  /** Each reference to a loader that is not a direct call with a literal specifier (`TreeFacts.loaderReferences`). */
  readonly loaderReferences: ReadonlyArray<string>
  /** Each string whose whole text is the name of a loader (`TreeFacts.loaderTexts`). */
  readonly loaderTexts: ReadonlyArray<string>
  /** Each use of a capability (`TreeFacts.capabilities`), as its text and the capability. */
  readonly capabilities: ReadonlyArray<{ readonly text: string; readonly capability: string }>
  /** Each value import, export or load of a module by a literal specifier (`TreeFacts.valueLoads`). */
  readonly valueLoads: ReadonlyArray<ValueLoad>
}

/** The facts of the last source seen at each path, with that source. */
const moduleFactsCache = new Map<string, { readonly source: string; readonly facts: ModuleFacts }>()

/**
 * The facts of a module, from one parse of its source (`treeFacts`, and the named exemption of
 * the walk). The import walk and the scans share them, so each module is parsed once in a test
 * file. A different source at the same path (an in-memory fixture) is parsed again.
 */
export const moduleFacts = (source: string, path: string): ModuleFacts => {
  const cached = moduleFactsCache.get(path)
  if (cached !== undefined && cached.source === source) return cached.facts
  const sf = parseSource(source, path)
  const tree = treeFacts(sf)
  const exemption = importModuleExemption(sf, tree.unreadableImports)
  const pinned = pinnedLoaderExemption(sf, tree.loaderReferences)
  const texts = (found: ReadonlyArray<SkipForm>): ReadonlyArray<string> => found.map((form) => form.text)
  const facts: ModuleFacts = {
    specifiers: [...tree.specifiers, ...exemption.specifiers, ...pinned.specifiers],
    unreadableImports: tree.unreadableImports.filter((entry) => entry !== exemption.exempted).map((entry) => entry.text),
    forms: texts(tree.forms),
    importedOptions: tree.importedOptions,
    exportedOptions: tree.exportedOptions,
    flakyTestNames: texts(tree.flakyTestNames),
    flakyTestTexts: texts(tree.flakyTestTexts),
    loaderReferences: texts(tree.loaderReferences.filter((form) => !pinned.exempted.has(form))),
    loaderTexts: texts(tree.loaderTexts),
    capabilities: tree.capabilities.map((form) => ({ text: form.text, capability: form.capability })),
    valueLoads: tree.valueLoads
  }
  moduleFactsCache.set(path, { source, facts })
  return facts
}

// ---------------------------------------------------------------- the scan of a set of modules

/**
 * What the scan of one module gives: the module specifiers it names, its skip forms, and where
 * it names `flakyTest`.
 */
export interface ScannedModule {
  /** The path of the module, relative to the package folder. */
  readonly path: string
  /** The module specifiers it names (`ModuleFacts.specifiers`). */
  readonly specifiers: ReadonlyArray<string>
  /** Its skip forms, then those of its imported options values, each as `<file>:<line> <code>`. */
  readonly forms: ReadonlyArray<string>
  /** Each identifier named `flakyTest` (`TreeFacts.flakyTestNames`), as `<file>:<line> <code>`. */
  readonly flakyTestNames: ReadonlyArray<string>
  /** Each string or template part whose text holds `flakyTest` (`TreeFacts.flakyTestTexts`), as `<file>:<line> <code>`. */
  readonly flakyTestTexts: ReadonlyArray<string>
  /** Each string whose whole text is the name of a loader (`TreeFacts.loaderTexts`), as `<file>:<line> <code>`. */
  readonly loaderTexts: ReadonlyArray<string>
}

/**
 * Scans each module (paths relative to the package folder), reading each source through
 * `readSource`: the specifiers and the skip forms of its syntax tree (`moduleFacts`), then the
 * forms of its imported options values, read in the module that exports each one
 * (`readImportedOptions`). Each module is parsed once, an exporting module too. A path with no
 * source gives no entry.
 */
export const scanModules = (
  paths: ReadonlyArray<string>,
  readSource: (path: string) => string | undefined
): ReadonlyArray<ScannedModule> =>
  paths.flatMap((path) => {
    const source = readSource(path)
    if (source === undefined) return []
    const facts = moduleFacts(source, path)
    const imported = readImportedOptions(
      path,
      facts.importedOptions,
      readSource,
      (exporting, target) => moduleFacts(exporting, target).exportedOptions
    )
    return [{
      path,
      specifiers: facts.specifiers,
      forms: [...facts.forms, ...imported],
      flakyTestNames: facts.flakyTestNames,
      flakyTestTexts: facts.flakyTestTexts,
      loaderTexts: facts.loaderTexts
    }]
  })

// ---------------------------------------------------------------- the import walk

/** The package folder `packages/core`: the default root of the walk. */
const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url))

/** An absolute path of the disk as a path from a folder, with `/` between names (`../x` outside the folder). */
const pathFrom = (folder: string, absolute: string): string => relative(folder, absolute).split(sep).join(posix.sep)

/** The canonical form of each root the walk used. */
const canonicalRoots = new Map<string, string>()

/** The canonical form of each path the walk looked up, by root and path. */
const canonicalPaths = new Map<string, string>()

/**
 * A path from a root in the form the disk stores it: the path from the root's canonical path to
 * the file's canonical path (`canonicalPath` of the pending-rewrite guard: links resolved, each
 * name in the letter case on the disk); the path itself when no such file exists (an in-memory
 * fixture, or a candidate that names nothing). On a disk that ignores letter case,
 * `test/upstream/Clock.test.ts` becomes `test/upstream/clock.test.ts`. A file outside the root
 * gives a path that starts with `../`. Each path is looked up once.
 */
export const canonicalPackagePath = (path: string, root: string = PACKAGE_ROOT): string => {
  const key = `${root}\u0000${path}`
  const known = canonicalPaths.get(key)
  if (known !== undefined) return known
  const canonicalRoot = canonicalRoots.get(root) ?? canonicalPath(join(root, "."))
  canonicalRoots.set(root, canonicalRoot)
  const absolute = join(root, path)
  const canonical = canonicalPath(absolute)
  // A file of the disk, by its path from the canonical root (an absolute candidate of a root that
  // is no canonical path, `/@fs/<path>`, gives the same path as a relative one)
  const found = existsSync(absolute) ? pathFrom(canonicalRoot, canonical) : path
  canonicalPaths.set(key, found)
  return found
}

// ---------------------------------------------------------------- the repository and the dependency store

/**
 * Runs git in a folder, without the caller's `GIT_*` variables (so git finds the repository from
 * the folder) and without the user's global excludes file (so the list does not depend on a
 * setting outside the repository): its output, or null when git fails.
 */
const gitOutput = (cwd: string, args: ReadonlyArray<string>): string | null => {
  const result = runGit(cwd, ["-c", "core.excludesFile=/dev/null", ...args])
  return result.status === 0 ? result.stdout : null
}

/**
 * Runs git in a folder: without the caller's `GIT_*` variables, and with no fsmonitor and no
 * hooks, so a folder's own git config runs no program of its choosing.
 */
const runGit = (cwd: string, args: ReadonlyArray<string>) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")))
  return spawnSync("git", ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024
  })
}

/**
 * The two git commands that CONF-8's fixture repositories need, in a fixture folder:
 * `["init", "-q"]` (the folder becomes the root of a repository checkout) and `["add", <path>]`
 * (git tracks the file, `git add -- <path>`), run as `gitOutput` runs git. Any other command is
 * refused, so the module that takes this function holds no git of its own choosing. Its exit
 * status and its error output.
 */
export const fixtureGit = (
  folder: string,
  args: readonly ["init", "-q"] | readonly ["add", string]
): { readonly status: number | null; readonly stderr: string } => {
  const [command, operand] = args
  const known = (command === "init" && operand === "-q" && args.length === 2) || (command === "add" && args.length === 2)
  if (!known) return { status: null, stderr: `fixtureGit runs git init -q and git add -- <path> only: ${JSON.stringify(args)}` }
  const result = runGit(folder, command === "init" ? ["init", "-q"] : ["add", "--", operand])
  return { status: result.status, stderr: result.stderr }
}

/** The repository root of each folder asked for. */
const repositoryRoots = new Map<string, string | null>()

/**
 * The canonical path of the root of the git repository checkout that holds a folder (`git
 * rev-parse --show-toplevel` from it), or null when no repository holds it.
 */
export const repositoryRoot = (folder: string): string | null => {
  const known = repositoryRoots.get(folder)
  if (known !== undefined) return known
  const top = gitOutput(folder, ["rev-parse", "--show-toplevel"])?.trim() ?? ""
  const found = top === "" ? null : realpathSync(top)
  repositoryRoots.set(folder, found)
  return found
}

/** The canonical path lies in the canonical folder, or is it. */
const isWithin = (path: string, folder: string): boolean => path === folder || path.startsWith(`${folder}${sep}`)

/**
 * The install folders of the dependencies, each canonical, where they exist: `node_modules` of the
 * package root, of the repository root that holds it, and of this package (the folder of this
 * file's package, whose dependencies a fixture package root links to).
 */
export const installFolders = (root: string = PACKAGE_ROOT): ReadonlyArray<string> =>
  [...new Set([root, repositoryRoot(root), PACKAGE_ROOT].flatMap((folder) => {
    const modules = folder === null ? null : join(folder, "node_modules")
    return modules !== null && existsSync(modules) ? [realpathSync(modules)] : []
  }))]

/**
 * The dependency stores, each canonical: pnpm's store `.pnpm` of each install folder. A file or a
 * folder whose canonical path lies in one is an installed dependency (pnpm links each package of
 * `node_modules/<name>` into it); a module elsewhere, in a `node_modules` folder or not, is none.
 */
export const dependencyStores = (root: string = PACKAGE_ROOT): ReadonlyArray<string> => {
  const known = storesOfRoots.get(root)
  if (known !== undefined) return known
  const stores = installFolders(root).flatMap((folder) => {
    const store = join(folder, ".pnpm")
    return existsSync(store) ? [realpathSync(store)] : []
  })
  storesOfRoots.set(root, stores)
  return stores
}

/** The dependency stores of each root asked for. */
const storesOfRoots = new Map<string, ReadonlyArray<string>>()

/** The file or folder at the absolute path is an installed dependency: its canonical path lies in a dependency store. */
const isDependency = (absolute: string, stores: ReadonlyArray<string>): boolean =>
  existsSync(absolute) && stores.some((store) => isWithin(realpathSync(absolute), store))

/** The package that a bare specifier names: `@scope/name` or `name`. */
const packageName = (specifier: string): string => {
  const parts = specifier.split("/")
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier)
}

/** A specifier that names a package: no path, no alias of the default config (`@/x`), no `#` import and no URL. */
export const isBareSpecifier = (specifier: string): boolean =>
  !specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.startsWith("#") && specifier !== "@" &&
  !specifier.startsWith("@/") && !/^[a-z][a-z\d+.-]*:/i.test(specifier)

/**
 * What a bare specifier names, from a module's folder: a builtin module of Node; else the folder
 * `node_modules/<name>` in the module's folder or the nearest folder above it that holds one, as
 * Node finds a package (`node_modules/@types/<name>` for a package of types alone), canonical; or
 * null when no such folder exists.
 */
const packageFolder = (fromFolder: string, specifier: string): "builtin" | string | null => {
  if (isBuiltin(specifier)) return "builtin"
  const name = packageName(specifier)
  const types = `@types/${name.startsWith("@") ? name.slice(1).replace("/", "__") : name}`
  for (const candidate of [name, types]) {
    for (let folder = fromFolder; ; folder = dirname(folder)) {
      const path = join(folder, "node_modules", candidate)
      if (existsSync(path)) return realpathSync(path)
      if (dirname(folder) === folder) break
    }
  }
  return null
}

/** The dependency fields of a `package.json` that name a package and how to install it. */
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const

/** The text parses as JSON. */
const isJson = (text: string): boolean => {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

/** The `package.json` of each folder asked for, parsed, or null when the folder holds none. */
const manifests = new Map<string, Readonly<Record<string, unknown>> | null>()

const manifestOf = (folder: string): Readonly<Record<string, unknown>> | null => {
  const known = manifests.get(folder)
  if (known !== undefined) return known
  const path = join(folder, "package.json")
  const text = existsSync(path) && statSync(path).isFile() ? readFileSync(path, "utf8") : null
  // A manifest that does not parse installs nothing (pnpm refuses it)
  const parsed: unknown = text === null || !isJson(text) ? null : JSON.parse(text)
  const manifest = typeof parsed === "object" && parsed !== null ? (parsed as Readonly<Record<string, unknown>>) : null
  manifests.set(folder, manifest)
  return manifest
}

/**
 * The source folder of a package that a manifest installs from a path (the seventh Layer-3
 * review's K1f): the absolute path of the `file:`, `link:` or `portal:` specification under which
 * the `package.json` of the module's folder, or of the nearest folder above it that names the
 * package, names it; else null. pnpm copies a `file:` folder into its dependency store, so the
 * store holds such a package although no registry gave it.
 */
const localSourceOf = (fromFolder: string, name: string): string | null => {
  for (let folder = fromFolder; ; folder = dirname(folder)) {
    const manifest = manifestOf(folder)
    for (const field of DEPENDENCY_FIELDS) {
      const dependencies = manifest?.[field]
      const specification = typeof dependencies === "object" && dependencies !== null ? (dependencies as Readonly<Record<string, unknown>>)[name] : undefined
      if (typeof specification === "string") {
        const local = /^(?:file|link|portal):(.*)$/.exec(specification)
        return local === null ? null : join(folder, local[1] ?? "")
      }
    }
    if (dirname(folder) === folder) return null
  }
}

/**
 * The folder lies in a dependency store under an entry of a package that pnpm installs from a
 * path: `.pnpm/<name>@file+<path>/...` or `.pnpm/<name>@link+<path>/...`.
 */
const isPathInstall = (folder: string): boolean =>
  folder.split(sep).some((name, index, names) => names[index - 1] === ".pnpm" && /@(?:file|link)\+/.test(name))

/** The folder holds a `package.json`: a package, whose entry its manifest names. */
const holdsManifest = (absolute: string): boolean =>
  existsSync(absolute) && statSync(absolute).isDirectory() && existsSync(join(absolute, "package.json"))

/**
 * The script modules in a folder (an absolute path), as paths from the canonical root: each file
 * whose name ends in a script extension, at any depth, in dot folders and through links too (each
 * real folder once), but in an installed dependency (`dependencyStores`).
 */
const folderScriptModules = (folder: string, canonicalRoot: string, stores: ReadonlyArray<string>): ReadonlyArray<string> => {
  const found: Array<string> = []
  const seen = new Set<string>()
  const visit = (absolute: string): void => {
    const real = realpathSync(absolute)
    if (seen.has(real) || stores.some((store) => isWithin(real, store))) return
    seen.add(real)
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const path = join(absolute, entry.name)
      const target = entry.isSymbolicLink() ? (existsSync(path) ? statSync(path) : undefined) : entry
      if (target?.isDirectory() === true) visit(path)
      else if (target?.isFile() === true && SCRIPT_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
        if (!isDependency(path, stores)) found.push(pathFrom(canonicalRoot, realpathSync(path)))
      }
    }
  }
  if (existsSync(folder)) visit(folder)
  return found.sort()
}

/**
 * A specifier without the query or hash suffix that Vite strips before it reads the file
 * (`./x.ts?raw`, `./x.ts?v=1`, `./x.ts#y`; the seventh Layer-3 review's Y3): the text before the
 * first `?` or `#` after its first character, so a `#x` specifier (a subpath import) stays whole.
 */
export const withoutSuffix = (specifier: string): string => {
  const index = specifier.slice(1).search(/[?#]/)
  return index === -1 ? specifier : specifier.slice(0, index + 1)
}

/**
 * The paths from the root that a specifier of a module may name, without its query or hash suffix
 * (`withoutSuffix`), as Vite reads it: those of `specifierCandidates`; for Vite's `/@fs/<path>`,
 * those of the absolute path of the disk (the seventh Layer-3 review's Y4); for another absolute
 * specifier, those of `/x` as a path from the root and as a path of the disk; and those of a
 * `file:` URL. Null for a specifier that names a module through a map the walk does not read
 * (`#x`, a subpath import of `package.json`), for a `file:` URL it cannot read, and for a URL of
 * another scheme (`data:`, `https:`), whose code no module of the disk holds. A package specifier
 * names a package (`walkImports` finds its folder), and `node:x` a builtin module: none.
 */
export const walkCandidates = (
  fromPath: string,
  specifier: string,
  root: string = PACKAGE_ROOT
): ReadonlyArray<string> | null => {
  // A specifier from the root folder: `./scripts/x.js` names `scripts/x.ts`
  const fromRoot = (target: string): ReadonlyArray<string> => specifierCandidates("index.ts", `./${target}`)
  if (specifier.startsWith("#")) return null
  if (specifier.startsWith("file:")) {
    const url = URL.canParse(specifier) ? new URL(specifier) : null
    if (url === null || url.host !== "") return null
    url.search = ""
    url.hash = ""
    return fromRoot(pathFrom(root, fileURLToPath(url)))
  }
  // A URL of another scheme than file: and node: holds or fetches code that no module of the
  // disk holds (`data:text/javascript,...`, `https://...`)
  if (/^[a-z][a-z\d+.-]*:/i.test(specifier) && !specifier.startsWith("node:")) return null
  const path = withoutSuffix(specifier)
  if (path.startsWith("/@fs/")) return fromRoot(pathFrom(root, path.slice("/@fs".length)))
  if (path.startsWith("/")) return [...new Set([...fromRoot(path.slice(1)), ...fromRoot(pathFrom(root, path))])]
  return specifierCandidates(fromPath, path)
}

/**
 * The one import of a module of an installed dependency by its path that the walk allows: the
 * flakyTest guard of the default run (`flaky-test-guard.ts`, CONF-8) imports the real
 * `@effect/vitest` by the path of its entry module, since the default config's alias gives the
 * guard itself for the package's name. The walk reports every other specifier that names a module
 * of the dependency store by a path, and this one in any other module.
 */
export const FLAKY_TEST_GUARD_ENTRY = {
  file: "test/verify/flaky-test-guard.ts",
  specifier: "../../node_modules/@effect/vitest/dist/index.js"
} as const

/** What the import walk gives. */
export interface ImportWalk {
  /**
   * `<importer> imports <pending path>`, for each import that names a pending path;
   * `<file>:<line> <code> names a module the walk cannot read`, for each import whose specifier
   * is not a string literal (less the named exemption) and each `import.meta.glob`; and
   * `<file>: "<specifier>" names a module the walk cannot read`, for a specifier that
   * `walkCandidates` cannot read; `<file>:<line> <code> is a loader reference that the walk
   * cannot follow`, for each reference to a loader that is not a direct call with a literal
   * specifier (`TreeFacts.loaderReferences`); `<file>: "<specifier>" names a package that no
   * node_modules folder holds`, `<file>: "<specifier>" names a package outside the repository
   * and the dependency store`, `... names a file: dependency outside the repository, which pnpm
   * copies into its dependency store` and `... names a file: dependency of the dependency store
   * that no manifest names`, for a bare specifier whose package the walk cannot read; and, for a
   * path specifier whose file the walk does not read, `... names a folder with a package.json,
   * whose entry the walk does not read`, `... names no file that the walk can read` and `... names
   * a module of an installed dependency by its path` (less `FLAKY_TEST_GUARD_ENTRY`).
   */
  readonly problems: ReadonlyArray<string>
  /** Every module the walk read, the entry modules included, sorted. */
  readonly visited: ReadonlyArray<string>
}

/**
 * The import walk (HARNESS-2, CONF-8). Walks the imports from each entry module (paths from
 * `root`, the package folder by default) through every module that they reach, in the package
 * or outside its folder (a test helper, a green rewrite, a module of `src/`, `examples/` or
 * `scripts/`, a config file, a module that a relative or absolute specifier names outside the
 * package folder), and names each import of a path that `pending` lists, each import it
 * cannot read, and each loader reference it cannot follow. Each path a specifier may name
 * (`walkCandidates`: without a query or hash suffix, and `/@fs/` mapped to the disk, as Vite
 * reads it), and each path of `pending`, is taken in the form the disk stores it
 * (`canonicalPackagePath`), so an import that names a pending rewrite in another letter case, or
 * through a link, or with a suffix, is found and named by its canonical path. A pending path is
 * not walked into.
 *
 * A path specifier loads a file whatever its name (the seventh Layer-3 review): the walk reads
 * each of its candidates that holds a file, a module without a script extension (`./zz-retry`,
 * `./x.es`) or a data file too, and scans it like any module. A specifier whose candidates hold
 * no file, one that names a folder with a `package.json` (Vite loads the entry its manifest
 * names), and one that names a module of the dependency store by its path (a dependency is
 * named by its package) are problems.
 *
 * An installed dependency (a package whose folder lies in a dependency store, `dependencyStores`)
 * and a builtin module are not walked, but a package that a manifest installs from a path (a
 * `file:` dependency, which pnpm copies into its store; the seventh review's K1f): its source
 * folder is walked when it lies in the repository checkout, and it is a problem when it lies
 * outside. A bare specifier whose package folder lies elsewhere (a `link:` or workspace
 * dependency, a folder planted in `node_modules`; the sixth Layer-3 review's K1) is read as a
 * module of the repository: every script module of the folder is walked when the folder lies in
 * the repository checkout, and it is a problem when it lies outside the repository, or when no
 * `node_modules` folder holds the package (an alias the walk does not read, the package's own
 * name). Each module is parsed once (`moduleFacts`).
 */
export const walkImports = (
  entries: ReadonlyArray<string>,
  pending: ReadonlyArray<string>,
  readSource: (path: string) => string | undefined,
  root: string = PACKAGE_ROOT
): ImportWalk => {
  const pendingPaths = new Set(pending.map((path) => canonicalPackagePath(path, root)))
  const problems: Array<string> = []
  const visited = new Set<string>()
  const queue = [...entries]
  const stores = dependencyStores(root)
  const repository = repositoryRoot(root)
  const canonicalRoot = realpathSync(root)
  const packages = new Map<string, "builtin" | string | null>()
  for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
    if (visited.has(path)) continue
    const source = readSource(path)
    if (source === undefined) continue
    visited.add(path)
    const facts = moduleFacts(source, path)
    problems.push(
      ...facts.unreadableImports.map((text) => `${text} names a module the walk cannot read`),
      ...facts.loaderReferences.map((text) => `${text} is a loader reference that the walk cannot follow`)
    )
    for (const specifier of facts.specifiers) {
      const names = (what: string): string => `${path}: ${JSON.stringify(specifier)} ${what}`
      if (isBareSpecifier(specifier)) {
        const fromFolder = dirname(join(root, path))
        const key = `${fromFolder}\u0000${packageName(specifier)}`
        const folder = packages.get(key) ?? packageFolder(fromFolder, specifier)
        packages.set(key, folder)
        if (folder === null) {
          problems.push(names("names a package that no node_modules folder holds"))
        } else if (folder !== "builtin" && !stores.some((store) => isWithin(folder, store))) {
          if (repository === null || !isWithin(folder, repository)) {
            problems.push(names("names a package outside the repository and the dependency store"))
          } else {
            queue.push(...folderScriptModules(folder, canonicalRoot, stores))
          }
        } else if (folder !== "builtin") {
          // A package of the store that a manifest installs from a path is no dependency: its
          // source folder is a module folder of the repository, or a folder outside it
          const source = localSourceOf(fromFolder, packageName(specifier))
          if (source !== null) {
            const real = existsSync(source) ? realpathSync(source) : source
            if (repository !== null && isWithin(real, repository) && existsSync(real)) queue.push(...folderScriptModules(real, canonicalRoot, stores))
            else problems.push(names("names a file: dependency outside the repository, which pnpm copies into its dependency store"))
          } else if (isPathInstall(folder)) {
            problems.push(names("names a file: dependency of the dependency store that no manifest names"))
          }
        }
        continue
      }
      const named = walkCandidates(path, specifier, root)
      if (named === null) {
        problems.push(names("names a module the walk cannot read"))
        continue
      }
      // A builtin module (`node:fs`)
      if (named.length === 0) continue
      const candidates = named.map((candidate) => canonicalPackagePath(candidate, root))
      const hit = candidates.find((candidate) => pendingPaths.has(candidate))
      if (hit !== undefined) {
        problems.push(`${path} imports ${hit}`)
        continue
      }
      // What Vite loads, whatever its name (the seventh Layer-3 review's Y1, Y2): each candidate
      // that holds a file. A folder with a package.json loads the entry its manifest names (Y5),
      // a module of the dependency store is named by its package, and a specifier whose
      // candidates hold no file names a module the walk cannot read
      if (candidates.some((candidate) => holdsManifest(join(root, candidate)))) {
        problems.push(names("names a folder with a package.json, whose entry the walk does not read"))
        continue
      }
      const files = candidates.filter((candidate) => readSource(candidate) !== undefined)
      const installed = files.filter((candidate) => isDependency(join(root, candidate), stores))
      const guardEntry = path === FLAKY_TEST_GUARD_ENTRY.file && specifier === FLAKY_TEST_GUARD_ENTRY.specifier
      if (files.length === 0) problems.push(names("names no file that the walk can read"))
      else if (installed.length > 0 && !guardEntry) problems.push(names("names a module of an installed dependency by its path"))
      queue.push(...files.filter((candidate) => !installed.includes(candidate)))
    }
  }
  return { problems, visited: [...visited].sort() }
}

// ---------------------------------------------------------------- the module list of CONF-8

/** A file exists at the absolute path (a link to a file counts). */
const isFile = (absolute: string): boolean => existsSync(absolute) && statSync(absolute).isFile()

/**
 * The script modules under a folder of a package root (paths relative to the root, sorted):
 * each file whose name ends in a script extension, at any depth, in dot folders and dot files
 * too (`test/verify/.probe/x.spec.ts`, `test/.x.test.ts`), and under `test/verify/fixtures/`
 * too. `readdirSync` with `recursive` lists the dot entries that a node:fs `globSync` of
 * `test/**` skips and that the default config's include collects; it lists the files of a
 * linked folder too, as Vitest's glob does.
 */
export const scriptModules = (folder: string, root: string = PACKAGE_ROOT): ReadonlyArray<string> => {
  const base = join(root, folder)
  if (!existsSync(base)) return []
  return readdirSync(base, { recursive: true, encoding: "utf8" })
    .map((entry) => `${folder}/${entry.split(sep).join(posix.sep)}`)
    .filter((path) => SCRIPT_EXTENSIONS.some((extension) => path.endsWith(extension)) && isFile(join(root, path)))
    .sort()
}

/** A list of modules (paths from the package root, sorted), and each import that the walk which built it cannot read. */
export interface ModuleList {
  readonly paths: ReadonlyArray<string>
  readonly problems: ReadonlyArray<string>
}

/**
 * The folders of a package root that `packageScriptModules` does not list. Each holds no source
 * of the package, and git ignores each; the walk still reads a module there that a listed module
 * reaches by a literal specifier, and names each other load of one as a walk problem:
 * - `node_modules`, at any depth: dependencies; the repository list reads each `node_modules`
 *   folder that git lists or ignores, and lists each module there that is no installed dependency
 *   (`repositoryScriptModules`), and the walk enters one only for such a module (`isWalkedModule`);
 * - at the top, `.upstream`: the reference clone of upstream XState (T1.2), the parity-check copy
 *   and the goal's measurement scratch;
 * - at the top, `.delivery`: the builds that DELIVERY-1 and DELIVERY-2 write into it and remove
 *   while the default run runs (`tsc` output of `src/`; a list of it would race those writes);
 * - at the top, `dist`: the `tsc` output of `src/` (`pnpm build`);
 * - at the top, `.markdown-code-check`: the snippets that `pnpm check-docs` extracts from the
 *   Markdown documents.
 */
export const UNLISTED_FOLDERS: { readonly anyDepth: ReadonlyArray<string>; readonly top: ReadonlyArray<string> } = {
  anyDepth: ["node_modules"],
  top: [".upstream", ".delivery", "dist", ".markdown-code-check"]
}

/**
 * Every script module of a package root (paths relative to the root, sorted), whatever reaches
 * it: each file whose name ends in a script extension, at any depth, in dot folders and dot
 * files too, and through a linked folder (each real folder once), but for `UNLISTED_FOLDERS`.
 */
export const packageScriptModules = (root: string = PACKAGE_ROOT): ReadonlyArray<string> => {
  const found: Array<string> = []
  const seen = new Set<string>()
  const visit = (folder: string): void => {
    const absolute = folder === "" ? root : join(root, folder)
    const real = realpathSync(absolute)
    if (seen.has(real)) return
    seen.add(real)
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (UNLISTED_FOLDERS.anyDepth.includes(entry.name) || (folder === "" && UNLISTED_FOLDERS.top.includes(entry.name))) continue
      const path = folder === "" ? entry.name : `${folder}/${entry.name}`
      const target = entry.isSymbolicLink() ? (existsSync(join(root, path)) ? statSync(join(root, path)) : undefined) : entry
      if (target?.isDirectory() === true) visit(path)
      else if (target?.isFile() === true && SCRIPT_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) found.push(path)
    }
  }
  visit("")
  return found.sort()
}

/**
 * Every script module of the repository checkout that holds a package root, whatever reaches it
 * (the sixth Layer-3 review of CONF-8), as paths from the root's canonical path (`../x` outside
 * the package folder), sorted:
 * - each file of git's file list from the repository root (`git ls-files --cached --others
 *   --exclude-standard`: the tracked files, and the untracked files that git does not ignore)
 *   whose name ends in a script extension; a folder of the list (a nested repository, a
 *   submodule, a linked folder) is read whole, through dot folders and links (each real folder
 *   once);
 * - each script module of a `node_modules` folder of the repository (one of the list, or one that
 *   git ignores) that is no installed dependency (`dependencyStores`): a package folder planted
 *   beside the dependencies, a `link:` or `file:` dependency whose folder lies in the repository
 *   (the sixth review's K1), a module in `test/verify/node_modules/`. At the top of an install
 *   folder (`installFolders`) the dot entries hold pnpm's store and its own files and the caches
 *   of Vite and ESLint, and are left out.
 * `problems` names a `node_modules` entry whose folder lies outside the repository and the
 * dependency store, and a package root that no git repository holds (a copy without git cannot
 * pass with the package folder alone).
 */
export const repositoryScriptModules = (root: string = PACKAGE_ROOT): ModuleList => {
  const repository = repositoryRoot(root)
  if (repository === null) return { paths: [], problems: ["the package folder: no git repository holds it"] }
  const canonicalRoot = realpathSync(root)
  const stores = dependencyStores(root)
  const installs = installFolders(root)
  const found = new Set<string>()
  const problems: Array<string> = []
  const seen = new Set<string>()
  const inStore = (real: string): boolean => stores.some((store) => isWithin(real, store))
  const addFile = (absolute: string): void => {
    const real = realpathSync(absolute)
    if (SCRIPT_EXTENSIONS.some((extension) => absolute.endsWith(extension)) && !inStore(real)) found.add(pathFrom(canonicalRoot, real))
  }
  /** The target of an entry: the entry itself, or the file or folder a link names (none for a broken link). */
  const targetOf = (absolute: string, entry: { isSymbolicLink(): boolean; isDirectory(): boolean; isFile(): boolean }) =>
    entry.isSymbolicLink() ? (existsSync(absolute) ? statSync(absolute) : undefined) : entry
  const visitFolder = (absolute: string): void => {
    const real = realpathSync(absolute)
    if (seen.has(real) || inStore(real)) return
    seen.add(real)
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      // A nested repository's own git folder holds no module of the checkout
      if (entry.name === ".git") continue
      const child = join(absolute, entry.name)
      const target = targetOf(child, entry)
      if (entry.name === "node_modules" && target?.isDirectory() === true) visitNodeModules(child)
      else if (target?.isDirectory() === true) visitFolder(child)
      else if (target?.isFile() === true) addFile(child)
    }
  }
  /** The entries of a `node_modules` folder or of a scope folder in it (`@scope`). */
  const visitPackages = (absolute: string, install: boolean): void => {
    const parent = realpathSync(absolute)
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (install && entry.name.startsWith(".")) continue
      const child = join(absolute, entry.name)
      const target = targetOf(child, entry)
      if (target?.isDirectory() === true) {
        const real = realpathSync(child)
        if (inStore(real) || seen.has(real)) continue
        if (entry.name.startsWith("@")) {
          seen.add(real)
          visitPackages(child, install)
        } else if (!isWithin(real, repository)) {
          problems.push(`${pathFrom(canonicalRoot, join(parent, entry.name))}: a folder outside the repository and the dependency store`)
        } else {
          visitFolder(child)
        }
      } else if (target?.isFile() === true) {
        addFile(child)
      }
    }
  }
  const visitNodeModules = (absolute: string): void => {
    if (!existsSync(absolute)) return
    const real = realpathSync(absolute)
    if (seen.has(real) || inStore(real)) return
    const install = installs.includes(real)
    if (!install && !isWithin(real, repository)) {
      problems.push(`${pathFrom(canonicalRoot, join(realpathSync(dirname(absolute)), "node_modules"))}: a folder outside the repository and the dependency store`)
      return
    }
    seen.add(real)
    visitPackages(absolute, install)
  }
  const entriesOf = (output: string | null): ReadonlyArray<string> =>
    (output ?? "").split("\0").filter((entry) => entry !== "").map((entry) => entry.replace(/\/$/, ""))
  const listing = gitOutput(repository, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
  if (listing === null) problems.push("the repository checkout: git cannot list its files")
  for (const entry of entriesOf(listing)) {
    const absolute = join(repository, entry)
    if (!existsSync(absolute)) continue
    if (entry.split("/").at(-1) === "node_modules") visitNodeModules(absolute)
    else if (statSync(absolute).isDirectory()) visitFolder(absolute)
    else addFile(absolute)
  }
  // The node_modules folders that git ignores (`--directory` names an ignored folder once)
  const ignored = gitOutput(repository, ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"])
  if (ignored === null) problems.push("the repository checkout: git cannot list its ignored files")
  for (const entry of entriesOf(ignored)) {
    const segments = entry.split("/")
    const index = segments.indexOf("node_modules")
    if (index !== -1) visitNodeModules(join(repository, ...segments.slice(0, index + 1)))
  }
  return { paths: [...found].sort(), problems }
}

// ---------------------------------------------------------------- the aliases of the configs

/** The name of a Vite or Vitest configuration file at a package root, where a run looks for one. */
export const CONFIG_FILE = /^(vite|vitest)\b.*\.(config|workspace|projects)\.[cm]?[jt]s$/

/**
 * Whether an alias's target names a path in the package folder (a relative path that stays in it,
 * or an absolute path in it) or in a dependency store (Vite's own aliases of its client modules,
 * `/@fs/<path>`). The walk reads the default config's `@` alias only (`specifierCandidates`); an
 * alias elsewhere loads a module that the walk does not follow.
 */
export const isAliasInPackage = (target: string, root: string = PACKAGE_ROOT): boolean => {
  const canonicalRoot = realpathSync(root)
  const path = target.startsWith("/@fs/") ? target.slice("/@fs".length) : target
  if (/^[a-z][a-z\d+.-]*:/i.test(path)) return false
  const absolute = join(path.startsWith("/") ? "/" : canonicalRoot, path)
  const real = existsSync(absolute) ? realpathSync(absolute) : absolute
  return isWithin(real, canonicalRoot) || dependencyStores(root).some((store) => isWithin(real, store))
}

/**
 * The resolve aliases of the Vite and Vitest configuration files of a package root (`CONFIG_FILE`),
 * as problems (the sixth Layer-3 review of CONF-8: an alias to a folder outside the package folder
 * loads a module there that no specifier of the walk names). In each config file each property
 * `alias` (of `resolve`, of `test`, or of a plugin's config) must be an object literal of string
 * values or an array literal of objects with a string `replacement` and no `customResolver` (a
 * string, or `fileURLToPath(new URL("<path>", import.meta.url))` of an import of Node's `url`,
 * the path from the config file's own folder), and each value or replacement must name a path in
 * the package folder (`isAliasInPackage`); each other
 * alias, and a `tsconfigPaths` setting that is not `false` (Vite then resolves the `paths` of a
 * tsconfig), is a problem: `<file>:<line> <code> names <target>, outside the package folder`, or
 * `<file>:<line> <code> is an alias that the walk cannot read`.
 */
export const configAliasProblems = (root: string, readSource: (path: string) => string | undefined): ReadonlyArray<string> =>
  readdirSync(root).filter((name) => CONFIG_FILE.test(name)).sort().flatMap((file) => {
    const source = readSource(file)
    if (source === undefined) return []
    const sf = parseSource(source, file)
    const problems: Array<string> = []
    const textOf = (node: typescript.Node): string =>
      `${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1} ${node.getText(sf)}`
    const unreadable = (node: typescript.Node): void => {
      problems.push(`${textOf(node)} is an alias that the walk cannot read`)
    }
    // `fileURLToPath` as an import of Node's `url` module binds it
    const fileUrlToPath = sf.statements.some((statement) =>
      ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier) &&
      ["node:url", "url"].includes(statement.moduleSpecifier.text) && statement.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(statement.importClause.namedBindings) &&
      statement.importClause.namedBindings.elements.some((element) => element.propertyName === undefined && element.name.text === "fileURLToPath")
    )
    /**
     * The path an alias target names: a string, or the path of a string from the config file's
     * own folder, `fileURLToPath(new URL("<path>", import.meta.url))` (the default config's
     * flakyTest guard: an absolute path, so that each importer gets the same module); else null.
     */
    const targetOf = (value: typescript.Expression): { readonly text: string; readonly path: string } | null => {
      if (ts.isStringLiteralLike(value)) return { text: value.text, path: value.text }
      const [url] = ts.isCallExpression(value) && ts.isIdentifier(value.expression) && value.expression.text === "fileURLToPath" && fileUrlToPath && value.arguments.length === 1
        ? value.arguments
        : []
      const [path, base] = url !== undefined && ts.isNewExpression(url) && ts.isIdentifier(url.expression) && url.expression.text === "URL" ? url.arguments ?? [] : []
      const fromConfig = base !== undefined && ts.isPropertyAccessExpression(base) && base.name.text === "url" && ts.isMetaProperty(base.expression) &&
        base.expression.keywordToken === ts.SyntaxKind.ImportKeyword
      return path !== undefined && ts.isStringLiteralLike(path) && fromConfig ? { text: path.text, path: join(realpathSync(root), path.text) } : null
    }
    const check = (node: typescript.Node, target: typescript.Expression | undefined): void => {
      const value = target === undefined ? null : targetOf(unwrapped(target))
      if (value === null) unreadable(node)
      else if (!isAliasInPackage(value.path, root)) problems.push(`${textOf(node)} names ${value.text}, outside the package folder`)
    }
    const checkAlias = (property: typescript.PropertyAssignment | typescript.ShorthandPropertyAssignment): void => {
      const value = ts.isPropertyAssignment(property) ? unwrapped(property.initializer) : undefined
      if (value !== undefined && ts.isObjectLiteralExpression(value)) {
        for (const entry of value.properties) {
          if (ts.isPropertyAssignment(entry)) check(entry, entry.initializer)
          else unreadable(entry)
        }
      } else if (value !== undefined && ts.isArrayLiteralExpression(value)) {
        for (const element of value.elements) {
          const entry = unwrapped(element)
          const members = ts.isObjectLiteralExpression(entry) ? entry.properties : undefined
          const named = (name: string): typescript.PropertyAssignment | undefined =>
            members?.find((member): member is typescript.PropertyAssignment => ts.isPropertyAssignment(member) && propertyKey(member.name) === name)
          const replacement = named("replacement")
          const readable = members !== undefined && members.every((member) => ts.isPropertyAssignment(member)) && named("customResolver") === undefined
          if (!readable || replacement === undefined) unreadable(element)
          else check(element, replacement.initializer)
        }
      } else {
        unreadable(property)
      }
    }
    const visit = (node: typescript.Node): void => {
      if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
        const key = propertyKey(node.name)
        if (key === "alias") checkAlias(node)
        if (key === "tsconfigPaths" && !(ts.isPropertyAssignment(node) && unwrapped(node.initializer).kind === ts.SyntaxKind.FalseKeyword)) {
          unreadable(node)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
    return problems
  })

// ---------------------------------------------------------------- the capabilities of the modules a test reaches

/**
 * A harness module that holds a capability (CONF-8's default deny; the eighth Layer-3 review's
 * G14 to G18r): a module that a test reaches may use a capability (`TreeFacts.capabilities`: a
 * builtin or a package that loads, runs or spawns code, a member of `process` that does, or the
 * module loaders of TypeScript) only when it is one of these, by exact path, and its whole source
 * matches its pin (`PINS_FILE`), so a plant inside it changes the pin. `capabilities` lists exactly
 * the capabilities it uses, so the list stays true. A holder whose exports give a capability on
 * (`restricted`: they run git, a nested Vitest run or a child Node process with an argument of the
 * importer's choosing) is a capability itself: a value import of it uses the capability `<file>`,
 * and of an export of `restrictedExports` also `<file> <name>` (a whole or namespace import takes
 * every one).
 */
export interface CapabilityHolder {
  readonly file: string
  readonly capabilities: ReadonlyArray<string>
  readonly restricted: boolean
  readonly restrictedExports: ReadonlyArray<string>
  readonly reason: string
}

const SKIP_SCAN = "test/verify/skip-scan.ts"
const VITEST_RUNS = "test/verify/vitest-runs.ts"
const DELIVERY = "test/verify/delivery.ts"

/**
 * The harness modules that hold a capability today, each with its reason. Every other module that
 * a test module or a Vitest config reaches holds none.
 */
export const CAPABILITY_HOLDERS: ReadonlyArray<CapabilityHolder> = [
  {
    file: SKIP_SCAN,
    capabilities: ["node:child_process", "typescript"],
    restricted: true,
    restrictedExports: [],
    reason:
      "this scan: git lists the repository's files (rev-parse, ls-files) and makes CONF-8's fixture repositories (fixtureGit: init and add only), and a plain copy of the TypeScript API speeds the parse"
  },
  {
    file: VITEST_RUNS,
    capabilities: ["vitest/node"],
    restricted: true,
    restrictedExports: ["runUnguarded"],
    reason:
      "the nested Vitest runs of CONF-8 and HARNESS-2: through a guarded config of the package only (runWithConfig), its file collection and its resolved aliases; and one run without the guards, the liveness control of CONF-8's flakyTest routes (runUnguarded, CONF-8 only)"
  },
  {
    file: DELIVERY,
    capabilities: ["node:child_process"],
    restricted: true,
    restrictedExports: [],
    reason: "the build of the package and the consumers that DELIVERY-1 and DELIVERY-2 run in child Node processes"
  },
  {
    file: "test/verify/pending-rewrite-setup.ts",
    capabilities: ["node:module"],
    restricted: false,
    restrictedExports: [],
    reason: "the default run's setup file: the Node load hook that fails each load of a pending rewrite (HARNESS-2)"
  },
  {
    file: "test/verify/flaky-test-setup.ts",
    capabilities: ["node:module", "process", "process.binding", "process.dlopen", "process.getBuiltinModule"],
    restricted: false,
    restrictedExports: [],
    reason:
      "the setup file of every Vitest config: the Node resolve hook of the flakyTest guard and of the builtins that load or spawn code, and the guards on the members of process that do (CONF-8)"
  },
  {
    file: "scripts/upstream/freeze-upstream.ts",
    capabilities: ["node:child_process"],
    restricted: false,
    restrictedExports: [],
    reason: "the freeze CLI reads the port's HEAD with git when Node runs it as the main module; no export runs a process"
  },
  {
    file: "test/upstream/exports.test.ts",
    capabilities: ["typescript.sys"],
    restricted: false,
    restrictedExports: [],
    reason: "the upstream exports test type-checks the package's entry points with a compiler host over ts.sys"
  },
  {
    file: "test/verify/verify-xstate-5-33-2-port-PARITY-2.spec.ts",
    capabilities: ["node:vm"],
    restricted: false,
    restrictedExports: [],
    reason: "the sandbox of the two upstream helpers (PINNED_LOADERS)"
  },
  {
    file: "test/verify/verify-xstate-5-33-2-port-CONF-8.spec.ts",
    capabilities: ["eslint", SKIP_SCAN, VITEST_RUNS, `${VITEST_RUNS} runUnguarded`],
    restricted: false,
    restrictedExports: [],
    reason: "CONF-8: the lint checks (ESLint of the package config), this scan, and the fixture runs of its guards with their unguarded control"
  },
  {
    file: "test/verify/verify-xstate-5-33-2-port-HARNESS-2.spec.ts",
    capabilities: ["eslint", SKIP_SCAN, VITEST_RUNS],
    restricted: false,
    restrictedExports: [],
    reason: "HARNESS-2: the lint checks of the pending rewrites, the shared scan and walk, and the fixture runs of its guards"
  },
  {
    file: "test/verify/verify-xstate-5-33-2-port-HARNESS-1.spec.ts",
    capabilities: ["node:child_process"],
    restricted: false,
    restrictedExports: [],
    reason: "HARNESS-1 runs the freeze CLI (scripts/upstream/freeze-upstream.ts) in a child Node process"
  },
  {
    file: "test/verify/verify-xstate-5-33-2-port-BASELINE-1.spec.ts",
    capabilities: ["vitest/node"],
    restricted: false,
    restrictedExports: [],
    reason: "BASELINE-1 runs the smoke test through the default config (startVitest)"
  },
  {
    file: "test/verify/verify-xstate-5-33-2-port-COMPAT-1.spec.ts",
    capabilities: ["typescript.sys", "vitest/node"],
    restricted: false,
    restrictedExports: [],
    reason: "COMPAT-1 runs the existing tests through the default config (startVitest) and type-checks them with a compiler host over ts.sys"
  },
  {
    file: "test/verify/verify-xstate-5-33-2-port-DELIVERY-1.spec.ts",
    capabilities: [DELIVERY],
    restricted: false,
    restrictedExports: [],
    reason: "DELIVERY-1 builds the package and runs its consumers in child Node processes (delivery.ts)"
  },
  {
    file: "test/verify/verify-xstate-5-33-2-port-DELIVERY-2.spec.ts",
    capabilities: [DELIVERY],
    restricted: false,
    restrictedExports: [],
    reason: "DELIVERY-2 builds the package and runs its consumers in child Node processes (delivery.ts)"
  }
]

/**
 * The modules that the test modules and the Vitest configs of a package root reach (the walk from
 * every script module under `test/` and every config file at the root, `CONFIG_FILE`), sorted:
 * the modules that may run in a run of the package's tests.
 */
export const modulesReachedByTests = (root: string, readSource: (path: string) => string | undefined): ReadonlyArray<string> => {
  const configs = readdirSync(root).filter((name) => CONFIG_FILE.test(name)).sort()
  return walkImports([...scriptModules("test", root), ...configs], [], readSource, root).visited
}

/**
 * The capability problems of a package root (CONF-8's default deny), sorted: in each module that a
 * test module or a Vitest config reaches (`modulesReachedByTests`), each use of a capability
 * (`TreeFacts.capabilities`, and a value import of a restricted holder) unless the module is a
 * holder (`CAPABILITY_HOLDERS`) whose whole source matches its pin (`readPins`) and whose entry
 * lists exactly the capabilities it uses:
 * - `<file>:<line> <code> uses <capability>, which only a pinned harness module may hold`;
 * - `<file> imports <holder>, which only a pinned harness module may import` (and `... takes <name>
 *   of <holder>, ...` for a restricted export);
 * - `<file>: a harness module whose source does not match its pin (sha256 <actual>)`;
 * - `<file>: a harness module that uses <capabilities>, and its entry lists <capabilities>`.
 * A holder that the root does not hold is no problem here; CONF-8 asserts that each one exists.
 */
export const capabilityProblems = (root: string, readSource: (path: string) => string | undefined): ReadonlyArray<string> => {
  const pins = readPins()
  const problems: Array<string> = []
  for (const path of modulesReachedByTests(root, readSource)) {
    const source = readSource(path)
    if (source === undefined) continue
    const facts = moduleFacts(source, path)
    const holder = CAPABILITY_HOLDERS.find((entry) => entry.file === path)
    const uses: Array<{ readonly text: string; readonly capability: string; readonly holder: boolean }> = facts.capabilities.map((use) => ({ ...use, holder: false }))
    for (const load of facts.valueLoads) {
      if (isBareSpecifier(load.specifier) || load.specifier.startsWith("node:")) continue
      const targets = (walkCandidates(path, load.specifier, root) ?? []).map((candidate) => canonicalPackagePath(candidate, root))
      for (const target of CAPABILITY_HOLDERS.filter((entry) => entry.restricted && targets.includes(entry.file))) {
        uses.push({ text: path, capability: target.file, holder: true })
        for (const name of target.restrictedExports.filter((entry) => load.names === null || load.names.includes(entry))) {
          uses.push({ text: path, capability: `${target.file} ${name}`, holder: true })
        }
      }
    }
    if (holder === undefined) {
      problems.push(...uses.map((use) =>
        !use.holder
          ? `${use.text} uses ${use.capability}, which only a pinned harness module may hold`
          : use.capability.includes(" ")
          ? `${use.text} takes ${use.capability.split(" ")[1] ?? ""} of ${use.capability.split(" ")[0] ?? ""}, which only a pinned harness module may take`
          : `${use.text} imports ${use.capability}, which only a pinned harness module may import`
      ))
      continue
    }
    const actual = sha256(source)
    if (pins[path] !== actual) problems.push(`${path}: a harness module whose source does not match its pin (sha256 ${actual})`)
    const used = [...new Set(uses.map((use) => use.capability))].sort()
    const listed = [...holder.capabilities].sort()
    if (JSON.stringify(used) !== JSON.stringify(listed)) {
      problems.push(`${path}: a harness module that uses ${used.join(", ") || "no capability"}, and its entry lists ${listed.join(", ") || "none"}`)
    }
  }
  return [...new Set(problems)].sort()
}

/**
 * The modules that CONF-8's scan and name checks read (AC 28): every script module of the
 * repository checkout that holds the package root, whatever reaches it
 * (`repositoryScriptModules`), every script module of the package root, whatever reaches it,
 * also one that git ignores (`packageScriptModules`), and every module outside them that one of
 * them reaches by import (`walkImports`, the walk of HARNESS-2): a module outside the
 * repository, or in a folder that git ignores. `problems` names each problem of the list, each
 * import the walk cannot read and each loader reference it cannot follow, in any module of the
 * list, and each alias of a config file of the package root that the walk cannot follow
 * (`configAliasProblems`).
 */
export const repositoryModuleList = (root: string, readSource: (path: string) => string | undefined): ModuleList => {
  const repository = repositoryScriptModules(root)
  const modules = [...new Set([...repository.paths, ...packageScriptModules(root)])].sort()
  const walk = walkImports(modules, [], readSource, root)
  return {
    paths: [...new Set([...modules, ...walk.visited])].sort(),
    problems: [...repository.problems, ...walk.problems, ...configAliasProblems(root, readSource), ...capabilityProblems(root, readSource)]
  }
}
