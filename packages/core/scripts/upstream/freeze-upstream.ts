/**
 * Freezes the xstate@5.33.2 inventory into `test/upstream/upstream-manifest.json`
 * (SPEC task T1.2, decision SD-2).
 *
 * The manifest holds, per upstream test file, every test call site (describe path, title,
 * kind, expanded count, `expect(` count, inline-snapshot texts, `@ts-expect-error` count),
 * the `@ts-expect-error` count per file, the graph snapshot entries, the SCXML test table,
 * the six upstream export lists, every throw and console warning site of upstream `src/`,
 * and the port's own export list at the commit the baseline was taken (COMPAT-4). The
 * baseline is written once: a rerun keeps it byte-identical.
 *
 * Usage, from `packages/core`:
 *
 *   node --experimental-strip-types scripts/upstream/freeze-upstream.ts [--clone <dir>] [--out <file>]
 *
 * The default clone is `.upstream/xstate-5.33.2` (gitignored), made with
 *
 *   git clone --depth 1 --branch xstate@5.33.2 https://github.com/statelyai/xstate.git .upstream/xstate-5.33.2
 *
 * The script refuses a clone whose `packages/core/package.json` version is not 5.33.2 or
 * whose HEAD is not the tag commit.
 *
 * @since 0.1.0
 */
import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import ts from "typescript"

// ---------------------------------------------------------------- constants

/** @since 0.1.0 */
export const UPSTREAM_VERSION = "5.33.2"
/** @since 0.1.0 */
export const UPSTREAM_TAG = `xstate@${UPSTREAM_VERSION}`
/** @since 0.1.0 */
export const UPSTREAM_COMMIT = "fbee62e7c1586315ed478c2fedf530d7e0ff5a3e"
/** @since 0.1.0 */
export const MANIFEST_SCHEMA = "xstate-upstream-manifest@1"

const UPSTREAM_REPOSITORY = "https://github.com/statelyai/xstate.git"

/** Folders (relative to upstream `packages/core`) whose `*.test.ts` files are inventoried. */
const TEST_DIRS: ReadonlyArray<string> = ["test", "test/examples", "src/graph/test"]

/** The six upstream entry points (`package.json` exports → source entry). */
const UPSTREAM_ENTRY_POINTS: Readonly<Record<string, string>> = {
  ".": "src/index.ts",
  "./actions": "src/actions.ts",
  "./actors": "src/actors/index.ts",
  "./dev": "src/dev/index.ts",
  "./graph": "src/graph/index.ts",
  "./guards": "src/guards.ts"
}

/** The port's entry points at the baseline commit (one `.` export). */
const PORT_ENTRY_POINTS: Readonly<Record<string, string>> = { ".": "src/index.ts" }

const TEST_ROOTS = new Set(["it", "test"])
const INLINE_SNAPSHOT_MATCHERS = new Set(["toMatchInlineSnapshot", "toThrowErrorMatchingInlineSnapshot"])

// ---------------------------------------------------------------- manifest model

/** @since 0.1.0 */
export type TestKind = "it" | "it.each" | "generated" | "skip" | "todo"

/** @since 0.1.0 */
export interface InlineSnapshot {
  readonly matcher: string
  /** The source text between the backticks, or null when the matcher has no argument. */
  readonly text: string | null
}

/** @since 0.1.0 */
export interface ExpandedTest {
  readonly describePath: ReadonlyArray<string>
  readonly title: string
}

/** @since 0.1.0 */
export interface Expansion {
  /** The loops, `it.each` tables and generator helpers that multiply the call site. */
  readonly via: ReadonlyArray<string>
  /** The concrete tests, or null when a loop runs over values known only at run time. */
  readonly tests: ReadonlyArray<ExpandedTest> | null
}

/** @since 0.1.0 */
export interface UpstreamTest {
  /** The text after `// upstream: ` that a rewrite carries above its counterpart. */
  readonly annotation: string
  /** `expect(` calls inside the test function (lexical; comments and strings never count). */
  readonly assertionCount: number
  /** Describe titles; a title built at run time keeps its template form. */
  readonly describePath: ReadonlyArray<string>
  readonly expandedCount: number
  readonly expansion: Expansion | null
  /** The helper or alias that generates the tests, for kind `generated`. */
  readonly generator: string | null
  readonly inlineSnapshots: ReadonlyArray<InlineSnapshot>
  readonly kind: TestKind
  readonly line: number
  /** 1-based index among tests with the same describe path and title, else null. */
  readonly occurrence: number | null
  readonly title: string
  /**
   * `@ts-expect-error` directives (comments only) inside the call site in the test file. A
   * helper call that generates several call sites gives its count to the first of them.
   */
  readonly tsExpectErrorCount: number
}

/** @since 0.1.0 */
export interface UpstreamFile {
  readonly callSites: number
  readonly lines: number
  readonly path: string
  readonly runnable: number
  readonly skip: number
  readonly tests: ReadonlyArray<UpstreamTest>
  readonly todo: number
  readonly tsExpectErrorCount: number
}

/** @since 0.1.0 */
export interface ExportList {
  readonly entry: string
  readonly types: ReadonlyArray<string>
  readonly values: ReadonlyArray<string>
}

/** @since 0.1.0 */
export interface NamespaceExports {
  readonly types: ReadonlyArray<string>
  readonly values: ReadonlyArray<string>
}

/** @since 0.1.0 */
export interface PortExportList extends ExportList {
  /** Members of each `export * as Name` namespace, keyed by the namespace name. */
  readonly namespaces: Readonly<Record<string, NamespaceExports>>
}

/** @since 0.1.0 */
export interface PortBaseline {
  /** The port commit (HEAD) the list was taken at. */
  readonly commit: string
  readonly exports: Readonly<Record<string, PortExportList>>
  readonly package: string
}

/** @since 0.1.0 */
export type SourceSiteKind = "throw" | "rethrow" | "throw-other" | "console.warn" | "console.error"

/** @since 0.1.0 */
export interface SourceSite {
  readonly file: string
  readonly kind: SourceSiteKind
  readonly line: number
  readonly text: string
}

/** @since 0.1.0 */
export interface ManifestTotals {
  readonly assertions: number
  readonly callSites: number
  readonly files: number
  readonly inlineSnapshots: number
  readonly runnable: number
  readonly skip: number
  readonly todo: number
  readonly tsExpectError: number
}

/** @since 0.1.0 */
export interface UpstreamManifest {
  readonly exports: Readonly<Record<string, ExportList>>
  readonly files: ReadonlyArray<UpstreamFile>
  /** Upstream `__snapshots__/*.snap` entries, keyed by snap file then by snapshot name. */
  readonly graphSnapshots: Readonly<Record<string, Readonly<Record<string, string>>>>
  readonly portBaseline: PortBaseline
  readonly schema: string
  /** The `testGroups` table of upstream `test/scxml.test.ts`. */
  readonly scxmlGroups: Readonly<Record<string, ReadonlyArray<string>>>
  readonly sourceSites: ReadonlyArray<SourceSite>
  readonly totals: ManifestTotals
  readonly upstream: {
    readonly commit: string
    readonly package: string
    readonly tag: string
    readonly version: string
  }
}

// ---------------------------------------------------------------- canonical form

/** Code-point order, the order every name list and object key of the manifest uses. */
const compareCodePoints = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

const sortedNames = (names: Iterable<string>): Array<string> => [...new Set(names)].sort(compareCodePoints)

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype

const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value).sort(compareCodePoints).map((key) => [key, sortKeys(value[key])])
    )
  }
  return value
}

/**
 * The canonical byte form: keys sorted by code point at every level, two-space indent,
 * trailing newline. Two runs over the same clone produce the same bytes.
 *
 * @since 0.1.0
 */
export const serializeManifest = (manifest: UpstreamManifest): string =>
  `${JSON.stringify(sortKeys(manifest), null, 2)}\n`

// ---------------------------------------------------------------- annotations

/** @since 0.1.0 */
export const formatAnnotation = (
  path: string,
  describePath: ReadonlyArray<string>,
  title: string,
  occurrence: number | null
): string => [path, ...describePath, title].join(" > ") + (occurrence === null ? "" : ` #${occurrence}`)

/**
 * Reads `// upstream: <file> > <describe path> > <title>[ #<n>]`. The key is the text
 * without the occurrence suffix; no upstream title ends with ` #<n>`, so the suffix is
 * unambiguous.
 *
 * @since 0.1.0
 */
export const parseAnnotation = (line: string): { readonly key: string; readonly occurrence: number | null } | null => {
  const match = /^\s*\/\/\s*upstream:\s*(.+?)\s*$/.exec(line)
  const body = match?.[1]
  if (body === undefined) return null
  const indexed = /^(.*) #(\d+)$/.exec(body)
  return indexed?.[1] !== undefined && indexed[2] !== undefined
    ? { key: indexed[1], occurrence: Number(indexed[2]) }
    : { key: body, occurrence: null }
}

// ---------------------------------------------------------------- clone validation

const upstreamPackageDir = (cloneDir: string): string => join(cloneDir, "packages", "core")

const gitDirOf = (repoDir: string): string | null => {
  const dotGit = join(repoDir, ".git")
  if (!existsSync(dotGit)) return null
  if (statSync(dotGit).isDirectory()) return dotGit
  const pointer = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"))?.[1]
  return pointer === undefined ? null : resolve(repoDir, pointer.trim())
}

/**
 * Reads the commit the clone has checked out, from `.git/HEAD` (detached, a branch ref or
 * a packed ref), without running git.
 *
 * @since 0.1.0
 */
export const readCloneHead = (cloneDir: string): string | null => {
  const gitDir = gitDirOf(cloneDir)
  if (gitDir === null || !existsSync(join(gitDir, "HEAD"))) return null
  const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim()
  const ref = /^ref:\s*(.+)$/.exec(head)?.[1]
  if (ref === undefined) return head
  const refFile = join(gitDir, ref)
  if (existsSync(refFile)) return readFileSync(refFile, "utf8").trim()
  const packed = join(gitDir, "packed-refs")
  if (!existsSync(packed)) return null
  const line = readFileSync(packed, "utf8").split("\n").find((entry) => entry.endsWith(` ${ref}`))
  return line?.split(" ")[0] ?? null
}

/**
 * Lists why a clone cannot be frozen; an empty list means it is the tag commit of 5.33.2.
 *
 * @since 0.1.0
 */
export const validateClone = (cloneDir: string): ReadonlyArray<string> => {
  const packageFile = join(upstreamPackageDir(cloneDir), "package.json")
  if (!existsSync(packageFile)) {
    return [
      `no upstream package at ${packageFile}; clone it with: git clone --depth 1 --branch ${UPSTREAM_TAG} ${UPSTREAM_REPOSITORY} ${cloneDir}`
    ]
  }
  const problems: Array<string> = []
  const { version } = JSON.parse(readFileSync(packageFile, "utf8")) as { readonly version?: unknown }
  if (version !== UPSTREAM_VERSION) {
    problems.push(
      `upstream packages/core/package.json has version ${String(version)}; the manifest is frozen from version ${UPSTREAM_VERSION}`
    )
  }
  const head = readCloneHead(cloneDir)
  if (head !== UPSTREAM_COMMIT) {
    problems.push(`upstream clone HEAD is ${head ?? "unreadable"}; the tag ${UPSTREAM_TAG} is commit ${UPSTREAM_COMMIT}`)
  }
  return problems
}

// ---------------------------------------------------------------- small evaluator

/** A value the evaluator cannot know without running the code. */
const OPAQUE = Symbol("opaque")

/** The Vitest test function a callee resolves to (`it`, `it.only`, `it.skip`, ...). */
class TestFunction {
  readonly name: string
  constructor(name: string) {
    this.name = name
  }
}

type Env = ReadonlyMap<string, unknown>

interface Ctx {
  readonly sf: ts.SourceFile
  readonly env: Env
  readonly depth: number
}

const EMPTY_ENV: Env = new Map()

const printer = ts.createPrinter({ removeComments: true })

const printExpression = (node: ts.Node, sf: ts.SourceFile): string =>
  printer.printNode(ts.EmitHint.Expression, node, sf).replace(/\s+/g, " ").trim()

const lineOf = (node: ts.Node, sf: ts.SourceFile): number =>
  sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1

const where = (node: ts.Node, sf: ts.SourceFile): string => `${sf.fileName}:${lineOf(node, sf)}`

const unwrap = (node: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)
    ? unwrap(node.expression)
    : node

type Declaration =
  | { readonly kind: "variable"; readonly init: ts.Expression | undefined; readonly node: ts.VariableDeclaration }
  | { readonly kind: "function"; readonly node: ts.FunctionDeclaration }

/** Finds the nearest `const`/`let`/function declaration of a name in the enclosing blocks. */
const lexicalDeclaration = (name: string, from: ts.Node): Declaration | null => {
  for (let node: ts.Node | undefined = from.parent; node !== undefined; node = node.parent) {
    if (!ts.isBlock(node) && !ts.isSourceFile(node) && !ts.isModuleBlock(node)) continue
    for (const statement of node.statements) {
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
            return { kind: "variable", init: declaration.initializer, node: declaration }
          }
        }
      }
      if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
        return { kind: "function", node: statement }
      }
    }
  }
  return null
}

const containsOpaque = (value: unknown): boolean =>
  value === OPAQUE || value instanceof TestFunction ||
  (Array.isArray(value) && value.some(containsOpaque)) ||
  (isPlainObject(value) && Object.values(value).some(containsOpaque))

const propertyKey = (name: ts.PropertyName, ctx: Ctx): string | typeof OPAQUE => {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text
  if (ts.isNumericLiteral(name)) return String(Number(name.text))
  if (ts.isComputedPropertyName(name)) {
    const key = evaluate(name.expression, ctx)
    return typeof key === "string" || typeof key === "number" ? String(key) : OPAQUE
  }
  return OPAQUE
}

const EVALUATED_CALLS = new Set(["Object.keys", "Object.values", "Object.entries", "JSON.stringify"])

const evaluateCall = (node: ts.CallExpression, ctx: Ctx): unknown => {
  const callee = ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)
    ? `${node.expression.expression.text}.${node.expression.name.text}`
    : ""
  const argument = node.arguments[0]
  if (!EVALUATED_CALLS.has(callee) || argument === undefined) return OPAQUE
  const value = evaluate(argument, ctx)
  switch (callee) {
    case "Object.keys":
      return isPlainObject(value) || Array.isArray(value) ? Object.keys(value) : OPAQUE
    case "Object.values":
      return isPlainObject(value) ? Object.values(value) : OPAQUE
    case "Object.entries":
      return isPlainObject(value) ? Object.entries(value) : OPAQUE
    case "JSON.stringify":
      return containsOpaque(value) ? OPAQUE : JSON.stringify(value)
    default:
      return OPAQUE
  }
}

/**
 * Evaluates literal tables and the few expressions upstream tests build them with
 * (`Object.keys`, `JSON.stringify`, element access, templates). Anything else is OPAQUE.
 */
const evaluate = (input: ts.Expression, ctx: Ctx): unknown => {
  if (ctx.depth > 64) return OPAQUE
  const node = unwrap(input)
  const inner: Ctx = { ...ctx, depth: ctx.depth + 1 }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isNumericLiteral(node)) return Number(node.text)
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (node.kind === ts.SyntaxKind.NullKeyword) return null
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text
    for (const span of node.templateSpans) {
      const value = evaluate(span.expression, inner)
      if (containsOpaque(value)) return OPAQUE
      text += String(value) + span.literal.text
    }
    return text
  }
  if (ts.isIdentifier(node)) {
    if (node.text === "undefined") return undefined
    if (ctx.env.has(node.text)) return ctx.env.get(node.text)
    const declaration = lexicalDeclaration(node.text, node)
    if (declaration === null) return TEST_ROOTS.has(node.text) ? new TestFunction("it") : OPAQUE
    return declaration.kind === "variable" && declaration.init !== undefined ? evaluate(declaration.init, inner) : OPAQUE
  }
  if (ts.isArrayLiteralExpression(node)) {
    const items: Array<unknown> = []
    for (const element of node.elements) {
      if (ts.isSpreadElement(element)) {
        const spread = evaluate(element.expression, inner)
        if (!Array.isArray(spread)) return OPAQUE
        items.push(...(spread as Array<unknown>))
      } else if (ts.isOmittedExpression(element)) {
        items.push(undefined)
      } else {
        items.push(evaluate(element, inner))
      }
    }
    return items
  }
  if (ts.isObjectLiteralExpression(node)) {
    const object: Record<string, unknown> = {}
    for (const property of node.properties) {
      if (ts.isSpreadAssignment(property)) {
        const spread = evaluate(property.expression, inner)
        if (!isPlainObject(spread)) return OPAQUE
        Object.assign(object, spread)
        continue
      }
      if (ts.isShorthandPropertyAssignment(property)) {
        object[property.name.text] = evaluate(property.name, inner)
        continue
      }
      const key = propertyKey(property.name, inner)
      if (key === OPAQUE) return OPAQUE
      object[key] = ts.isPropertyAssignment(property) ? evaluate(property.initializer, inner) : OPAQUE
    }
    return object
  }
  if (ts.isPropertyAccessExpression(node)) {
    const target = evaluate(node.expression, inner)
    const name = node.name.text
    if (target instanceof TestFunction) return new TestFunction(`${target.name}.${name}`)
    if ((Array.isArray(target) || typeof target === "string") && name === "length") return target.length
    if (isPlainObject(target) && Object.hasOwn(target, name)) return target[name]
    return OPAQUE
  }
  if (ts.isElementAccessExpression(node)) {
    const target = evaluate(node.expression, inner)
    const key = evaluate(node.argumentExpression, inner)
    if (Array.isArray(target) && typeof key === "number") return key in target ? target[key] : OPAQUE
    if (isPlainObject(target) && (typeof key === "string" || typeof key === "number")) {
      return Object.hasOwn(target, String(key)) ? target[String(key)] : OPAQUE
    }
    return OPAQUE
  }
  if (ts.isCallExpression(node)) return evaluateCall(node, inner)
  if (ts.isConditionalExpression(node)) {
    const condition = evaluate(node.condition, inner)
    if (containsOpaque(condition)) return OPAQUE
    return evaluate(condition ? node.whenTrue : node.whenFalse, inner)
  }
  if (ts.isPrefixUnaryExpression(node)) {
    const operand = evaluate(node.operand, inner)
    if (containsOpaque(operand)) return OPAQUE
    if (node.operator === ts.SyntaxKind.MinusToken && typeof operand === "number") return -operand
    if (node.operator === ts.SyntaxKind.ExclamationToken) return !operand
    return OPAQUE
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = evaluate(node.left, inner)
    const right = evaluate(node.right, inner)
    if (typeof left === "string" || typeof right === "string") {
      return containsOpaque(left) || containsOpaque(right) ? OPAQUE : String(left) + String(right)
    }
    return typeof left === "number" && typeof right === "number" ? left + right : OPAQUE
  }
  return OPAQUE
}

/** The source form of a title: literal text, or a template with `${...}` placeholders kept. */
const templateText = (node: ts.Expression, sf: ts.SourceFile): string => {
  const expression = unwrap(node)
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text
  if (ts.isTemplateExpression(expression)) {
    return expression.head.text + expression.templateSpans
      .map((span) => `\${${printExpression(span.expression, sf)}}${span.literal.text}`)
      .join("")
  }
  return printExpression(expression, sf)
}

const titleText = (node: ts.Expression | undefined, ctx: Ctx): string => {
  if (node === undefined) return ""
  const value = evaluate(node, ctx)
  if (typeof value === "string") return value
  if (typeof value === "number") return String(value)
  return templateText(node, ctx.sf)
}

/** Vitest `it.each` title formatting for the `%s`/`%d`/`%i`/`%f`/`%j`/`%o` placeholders. */
const formatEachTitle = (title: string, row: unknown): string => {
  const args = Array.isArray(row) ? [...(row as Array<unknown>)] : [row]
  return title.replace(/%[sdifjo%]/g, (token) => {
    if (token === "%%") return "%"
    const arg = args.shift()
    if (typeof arg === "string" || typeof arg === "number") return String(arg)
    return containsOpaque(arg) || arg === undefined ? token : JSON.stringify(arg)
  })
}

// ---------------------------------------------------------------- frames and expansion

type Frame =
  | { readonly kind: "describe"; readonly title: ts.Expression | undefined }
  | {
    readonly kind: "loop"
    readonly iterable: ts.Expression
    readonly params: ReadonlyArray<ts.BindingName>
    readonly label: string
    readonly site: ts.Node
  }

const isFunctionNode = (
  node: ts.Node
): node is ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration | ts.MethodDeclaration =>
  ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node) ||
  ts.isMethodDeclaration(node)

/**
 * The describe and loop frames between a test call and its boundary (the file, or the
 * generator helper that contains it), outermost first.
 */
const framesOf = (call: ts.CallExpression, sf: ts.SourceFile, boundary: ts.Node): ReadonlyArray<Frame> => {
  const frames: Array<Frame> = []
  for (let node: ts.Node | undefined = call.parent; node !== undefined && node !== boundary; node = node.parent) {
    if (ts.isForOfStatement(node)) {
      const initializer = node.initializer
      const name = ts.isVariableDeclarationList(initializer) ? initializer.declarations[0]?.name : undefined
      if (name === undefined) throw new Error(`${where(node, sf)}: unsupported for-of binding around a test`)
      frames.unshift({
        kind: "loop",
        iterable: node.expression,
        params: [name],
        label: `for (... of ${printExpression(node.expression, sf)})`,
        site: node
      })
      continue
    }
    if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) {
      throw new Error(`${where(node, sf)}: unsupported loop around a test`)
    }
    if (!isFunctionNode(node)) continue
    const parent: ts.Node = node.parent
    if (!ts.isCallExpression(parent) || !parent.arguments.some((argument) => argument === node)) {
      throw new Error(`${where(call, sf)}: test call inside a function that is not a describe or loop callback`)
    }
    const callee = parent.expression
    if (ts.isIdentifier(callee) && callee.text === "describe") {
      frames.unshift({ kind: "describe", title: parent.arguments[0] })
      continue
    }
    if (
      ts.isPropertyAccessExpression(callee) && (callee.name.text === "forEach" || callee.name.text === "map") &&
      parent.arguments[0] === node
    ) {
      frames.unshift({
        kind: "loop",
        iterable: callee.expression,
        params: node.parameters.map((parameter) => parameter.name),
        label: `${printExpression(callee.expression, sf)}.${callee.name.text}`,
        site: parent
      })
      continue
    }
    throw new Error(`${where(call, sf)}: test call inside a ${printExpression(callee, sf)} callback`)
  }
  return frames
}

const bindName = (name: ts.BindingName, value: unknown, env: Map<string, unknown>): void => {
  if (ts.isIdentifier(name)) {
    env.set(name.text, value)
    return
  }
  if (ts.isObjectBindingPattern(name)) {
    for (const element of name.elements) {
      const key = element.propertyName === undefined
        ? (ts.isIdentifier(element.name) ? element.name.text : undefined)
        : (ts.isIdentifier(element.propertyName) || ts.isStringLiteral(element.propertyName)
          ? element.propertyName.text
          : undefined)
      const field = key !== undefined && isPlainObject(value) && Object.hasOwn(value, key) ? value[key] : OPAQUE
      bindName(element.name, field, env)
    }
    return
  }
  name.elements.forEach((element, index) => {
    if (ts.isBindingElement(element)) {
      bindName(element.name, Array.isArray(value) && index in value ? (value as Array<unknown>)[index] : OPAQUE, env)
    }
  })
}

const bindAll = (params: ReadonlyArray<ts.BindingName>, args: ReadonlyArray<unknown>, env: Env): Env => {
  const next = new Map(env)
  params.forEach((param, index) => bindName(param, index < args.length ? args[index] : OPAQUE, next))
  return next
}

/** Binds every loop parameter to OPAQUE: the static (template) view of a call site. */
const staticEnv = (frames: ReadonlyArray<Frame>, base: Env = EMPTY_ENV): Env =>
  frames.reduce<Env>(
    (env, frame) => (frame.kind === "loop" ? bindAll(frame.params, frame.params.map(() => OPAQUE), env) : env),
    base
  )

const isExpectCall = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "expect"

/**
 * A loop over values computed at run time (the dieHard paths): its count is the length
 * the file itself asserts, `expect(<iterable>.length).toEqual(n)` or `.toBe(n)`, inside the
 * function that holds the loop.
 */
const assertedLength = (frame: Extract<Frame, { kind: "loop" }>, sf: ts.SourceFile): number | null => {
  const iterable = unwrap(frame.iterable)
  if (!ts.isIdentifier(iterable)) return null
  let scope: ts.Node | undefined = frame.site.parent
  while (scope !== undefined && !isFunctionNode(scope) && !ts.isSourceFile(scope)) scope = scope.parent
  if (scope === undefined) return null
  const lengths = new Set<number>()
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      (node.expression.name.text === "toEqual" || node.expression.name.text === "toBe") &&
      isExpectCall(node.expression.expression)
    ) {
      const subject = node.expression.expression.arguments[0]
      const expected = node.arguments[0]
      if (
        subject !== undefined && expected !== undefined && ts.isPropertyAccessExpression(subject) &&
        subject.name.text === "length" && ts.isIdentifier(subject.expression) &&
        subject.expression.text === iterable.text && ts.isNumericLiteral(expected)
      ) {
        lengths.add(Number(expected.text))
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(scope)
  return lengths.size === 1 ? ([...lengths][0] ?? null) : null
}

interface Enumerated {
  readonly env: Env
  readonly describePath: ReadonlyArray<string>
}

interface Enumeration {
  readonly items: ReadonlyArray<Enumerated>
  /** False when a loop count came from an asserted length, so titles are unknown. */
  readonly exact: boolean
  readonly via: ReadonlyArray<string>
}

/** Runs the frames over every loop value: one item per test the frames produce. */
const enumerate = (frames: ReadonlyArray<Frame>, sf: ts.SourceFile, base: Env, prefix: ReadonlyArray<string>): Enumeration => {
  let exact = true
  const labels = new Map<Frame, string>()
  const walk = (index: number, env: Env, path: ReadonlyArray<string>): ReadonlyArray<Enumerated> => {
    const frame = frames[index]
    if (frame === undefined) return [{ env, describePath: path }]
    const ctx: Ctx = { sf, env, depth: 0 }
    if (frame.kind === "describe") return walk(index + 1, env, [...path, titleText(frame.title, ctx)])
    const values = evaluate(frame.iterable, ctx)
    if (Array.isArray(values)) {
      labels.set(frame, frame.label)
      return (values as Array<unknown>).flatMap((value, position) => walk(index + 1, bindAll(frame.params, [value, position], env), path))
    }
    const length = assertedLength(frame, sf)
    if (length === null) throw new Error(`${where(frame.site, sf)}: cannot count the values of ${frame.label}`)
    exact = false
    labels.set(frame, `${frame.label} (length asserted: ${length})`)
    return Array.from({ length }, (_, position) => position)
      .flatMap((position) => walk(index + 1, bindAll(frame.params, [OPAQUE, position], env), path))
  }
  const items = walk(0, base, prefix)
  const via = frames.flatMap((frame) => {
    const label = labels.get(frame)
    return label === undefined ? [] : [label]
  })
  return { items, exact, via }
}

const staticDescribePath = (frames: ReadonlyArray<Frame>, sf: ts.SourceFile, env: Env): Array<string> =>
  frames.flatMap((frame) => (frame.kind === "describe" ? [titleText(frame.title, { sf, env, depth: 0 })] : []))

// ---------------------------------------------------------------- test call discovery

interface TestBody {
  readonly assertionCount: number
  readonly inlineSnapshots: ReadonlyArray<InlineSnapshot>
}

const lastFunctionArgument = (call: ts.CallExpression): ts.Node | undefined =>
  [...call.arguments].reverse().find((argument) => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument))

const literalSource = (node: ts.Expression, sf: ts.SourceFile): string => {
  const text = node.getText(sf)
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)
    ? text.slice(1, -1)
    : text
}

/**
 * The inline snapshot of a `toMatchInlineSnapshot(...)` or
 * `toThrowErrorMatchingInlineSnapshot(...)` call, or null for any other node.
 *
 * @since 0.1.0
 */
export const inlineSnapshotOf = (node: ts.Node, sf: ts.SourceFile): InlineSnapshot | null => {
  if (
    !ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) ||
    !INLINE_SNAPSHOT_MATCHERS.has(node.expression.name.text)
  ) {
    return null
  }
  const argument = node.arguments[node.arguments.length - 1]
  return { matcher: node.expression.name.text, text: argument === undefined ? null : literalSource(argument, sf) }
}

const readTestBody = (fn: ts.Node | undefined, sf: ts.SourceFile): TestBody => {
  if (fn === undefined) return { assertionCount: 0, inlineSnapshots: [] }
  let assertionCount = 0
  const inlineSnapshots: Array<InlineSnapshot> = []
  const visit = (node: ts.Node): void => {
    if (isExpectCall(node)) assertionCount += 1
    const snapshot = inlineSnapshotOf(node, sf)
    if (snapshot !== null) inlineSnapshots.push(snapshot)
    ts.forEachChild(node, visit)
  }
  visit(fn)
  return { assertionCount, inlineSnapshots }
}

/** `it`, `test`, `it.only`, `it.skip`, ... written literally at the call. */
const syntacticTestName = (callee: ts.Expression): string | null => {
  if (ts.isIdentifier(callee) && TEST_ROOTS.has(callee.text)) return "it"
  if (
    ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) &&
    TEST_ROOTS.has(callee.expression.text)
  ) {
    return `it.${callee.name.text}`
  }
  return null
}

const kindOfTestFunction = (name: string, node: ts.Node, sf: ts.SourceFile): Exclude<TestKind, "it.each" | "generated"> => {
  if (name === "it" || name === "it.only") return "it"
  if (name === "it.skip") return "skip"
  if (name === "it.todo") return "todo"
  throw new Error(`${where(node, sf)}: unsupported test modifier ${name}`)
}

interface Helper {
  readonly name: string
  readonly sf: ts.SourceFile
  readonly fn: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression
  readonly calls: ReadonlyArray<ts.CallExpression>
}

const sourceFileCache = new Map<string, ts.SourceFile>()

const parseSource = (file: string, label: string): ts.SourceFile => {
  const text = readFileSync(file, "utf8")
  const cached = sourceFileCache.get(file)
  if (cached !== undefined && cached.text === text && cached.fileName === label) return cached
  const sf = ts.createSourceFile(label, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  sourceFileCache.set(file, sf)
  return sf
}

const mentionsTestRoot = (root: ts.Node): boolean => {
  let found = false
  const visit = (node: ts.Node): void => {
    if (found) return
    if (ts.isIdentifier(node) && TEST_ROOTS.has(node.text)) found = true
    else ts.forEachChild(node, visit)
  }
  visit(root)
  return found
}

const resolveRelativeModule = (fromFile: string, specifier: string): string | null => {
  const base = resolve(dirname(fromFile), specifier)
  const candidates = [base, `${base}.ts`, join(base, "index.ts"), base.replace(/\.js$/, ".ts")]
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null
}

/** Direct test calls (`it`, `test`, modifiers) inside a node, in source order. */
const directTestCalls = (root: ts.Node): ReadonlyArray<ts.CallExpression> => {
  const calls: Array<ts.CallExpression> = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && syntacticTestName(node.expression) !== null) calls.push(node)
    ts.forEachChild(node, visit)
  }
  visit(root)
  return calls
}

/**
 * A function imported from a relative module whose body calls `it`: a generator helper
 * such as `testAll` in upstream `test/utils.ts`.
 */
const helperCache = new Map<string, Helper | null>()

const importedHelper = (name: string, sf: ts.SourceFile, file: string, pkgDir: string): Helper | null => {
  const key = `${file}\0${name}\0${sf.text.length}`
  if (helperCache.has(key)) return helperCache.get(key) ?? null
  const helper = findImportedHelper(name, sf, file, pkgDir)
  helperCache.set(key, helper)
  return helper
}

const findImportedHelper = (name: string, sf: ts.SourceFile, file: string, pkgDir: string): Helper | null => {
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const bindings = statement.importClause?.namedBindings
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue
    const element = bindings.elements.find((candidate) => candidate.name.text === name)
    if (element === undefined || !statement.moduleSpecifier.text.startsWith(".")) continue
    const target = resolveRelativeModule(file, statement.moduleSpecifier.text)
    if (target === null) return null
    const helperSf = parseSource(target, relative(pkgDir, target))
    const exported = element.propertyName?.text ?? name
    for (const candidate of helperSf.statements) {
      let fn: Helper["fn"] | undefined
      if (ts.isFunctionDeclaration(candidate) && candidate.name?.text === exported) fn = candidate
      if (ts.isVariableStatement(candidate)) {
        const declaration = candidate.declarationList.declarations.find(
          (entry) => ts.isIdentifier(entry.name) && entry.name.text === exported
        )
        const init = declaration?.initializer
        if (init !== undefined && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) fn = init
      }
      if (fn === undefined) continue
      const calls = directTestCalls(fn)
      return calls.length === 0 ? null : { name, sf: helperSf, fn, calls }
    }
    return null
  }
  return null
}

type Classified =
  | { readonly kind: "plain"; readonly testKind: Exclude<TestKind, "it.each" | "generated"> }
  | { readonly kind: "alias"; readonly testKind: TestKind; readonly generator: string }
  | { readonly kind: "each"; readonly table: ts.Expression | undefined }
  | { readonly kind: "helper"; readonly helper: Helper }

const classifyCall = (call: ts.CallExpression, sf: ts.SourceFile, file: string, pkgDir: string): Classified | null => {
  const callee = call.expression
  if (ts.isCallExpression(callee) && syntacticTestName(callee.expression) === "it.each") {
    return { kind: "each", table: callee.arguments[0] }
  }
  const syntactic = syntacticTestName(callee)
  if (syntactic !== null) {
    return syntactic === "it.each" ? null : { kind: "plain", testKind: kindOfTestFunction(syntactic, call, sf) }
  }
  if (!ts.isIdentifier(callee)) return null
  const declaration = lexicalDeclaration(callee.text, call)
  if (declaration?.kind === "variable") {
    if (declaration.init === undefined || !mentionsTestRoot(declaration.init)) return null
    const value = evaluate(declaration.init, { sf, env: EMPTY_ENV, depth: 0 })
    if (!(value instanceof TestFunction)) return null
    const testKind = kindOfTestFunction(value.name, call, sf)
    return { kind: "alias", testKind: testKind === "it" ? "generated" : testKind, generator: callee.text }
  }
  if (declaration?.kind === "function") {
    if (directTestCalls(declaration.node).length > 0) {
      throw new Error(`${where(call, sf)}: local generator ${callee.text} is not supported`)
    }
    return null
  }
  if (declaration !== null) return null
  const helper = importedHelper(callee.text, sf, file, pkgDir)
  return helper === null ? null : { kind: "helper", helper }
}

interface DraftTest {
  readonly assertionCount: number
  readonly describePath: ReadonlyArray<string>
  readonly expandedCount: number
  readonly expansion: Expansion | null
  readonly generator: string | null
  readonly inlineSnapshots: ReadonlyArray<InlineSnapshot>
  readonly kind: TestKind
  readonly line: number
  readonly title: string
  readonly tsExpectErrorCount: number
}

const expansionOf =(enumeration: Enumeration, tests: ReadonlyArray<ExpandedTest>, extraVia: ReadonlyArray<string> = []): Expansion => ({
  via: [...enumeration.via, ...extraVia],
  tests: enumeration.exact ? tests : null
})

const draftPlainOrAlias = (
  call: ts.CallExpression,
  sf: ts.SourceFile,
  kind: TestKind,
  generator: string | null
): DraftTest => {
  const frames = framesOf(call, sf, sf)
  const titleNode = call.arguments[0]
  const fixed = staticEnv(frames)
  const body = readTestBody(lastFunctionArgument(call), sf)
  const hasLoop = frames.some((frame) => frame.kind === "loop")
  const enumeration = hasLoop ? enumerate(frames, sf, EMPTY_ENV, []) : null
  return {
    ...body,
    describePath: staticDescribePath(frames, sf, fixed),
    expandedCount: enumeration === null ? 1 : enumeration.items.length,
    expansion: enumeration === null ? null : expansionOf(
      enumeration,
      enumeration.items.map((item) => ({
        describePath: item.describePath,
        title: titleText(titleNode, { sf, env: item.env, depth: 0 })
      }))
    ),
    generator,
    kind,
    line: lineOf(call, sf),
    title: titleText(titleNode, { sf, env: fixed, depth: 0 }),
    tsExpectErrorCount: directivesWithin(call, sf)
  }
}

const draftEach = (call: ts.CallExpression, sf: ts.SourceFile, table: ts.Expression | undefined): DraftTest => {
  if (table === undefined) throw new Error(`${where(call, sf)}: it.each without a table`)
  const frames = framesOf(call, sf, sf)
  const titleNode = call.arguments[0]
  const fixed = staticEnv(frames)
  const enumeration = enumerate(frames, sf, EMPTY_ENV, [])
  const tests = enumeration.items.flatMap((item) => {
    const rows = evaluate(table, { sf, env: item.env, depth: 0 })
    if (!Array.isArray(rows)) throw new Error(`${where(call, sf)}: cannot read the it.each table`)
    const title = titleText(titleNode, { sf, env: item.env, depth: 0 })
    return (rows as Array<unknown>).map((row) => ({ describePath: item.describePath, title: formatEachTitle(title, row) }))
  })
  return {
    ...readTestBody(lastFunctionArgument(call), sf),
    describePath: staticDescribePath(frames, sf, fixed),
    expandedCount: tests.length,
    expansion: expansionOf(enumeration, tests, ["it.each"]),
    generator: null,
    kind: "it.each",
    line: lineOf(call, sf),
    title: titleText(titleNode, { sf, env: fixed, depth: 0 }),
    tsExpectErrorCount: directivesWithin(call, sf)
  }
}

const draftHelper = (call: ts.CallExpression, sf: ts.SourceFile, helper: Helper): ReadonlyArray<DraftTest> => {
  const outerFrames = framesOf(call, sf, sf)
  const outerFixed = staticEnv(outerFrames)
  const outer = enumerate(outerFrames, sf, EMPTY_ENV, [])
  const params = helper.fn.parameters.map((parameter) => parameter.name)
  const callDirectives = directivesWithin(call, sf)
  return helper.calls.map((inner, index) => {
    const innerFrames = framesOf(inner, helper.sf, helper.fn)
    const innerKind = syntacticTestName(inner.expression)
    if (innerKind !== "it") throw new Error(`${where(inner, helper.sf)}: generator helpers may only call it`)
    const titleNode = inner.arguments[0]
    let exact = outer.exact
    let innerVia: ReadonlyArray<string> = []
    const tests = outer.items.flatMap((item) => {
      const args = call.arguments.map((argument) => evaluate(argument, { sf, env: item.env, depth: 0 }))
      const bound = bindAll(params, args, EMPTY_ENV)
      const nested = enumerate(innerFrames, helper.sf, bound, item.describePath)
      exact = exact && nested.exact
      innerVia = nested.via
      return nested.items.map((entry) => ({
        describePath: entry.describePath,
        title: titleText(titleNode, { sf: helper.sf, env: entry.env, depth: 0 })
      }))
    })
    const helperFixed = staticEnv(innerFrames, bindAll(params, params.map(() => OPAQUE), EMPTY_ENV))
    return {
      ...readTestBody(lastFunctionArgument(inner), helper.sf),
      describePath: [
        ...staticDescribePath(outerFrames, sf, outerFixed),
        ...staticDescribePath(innerFrames, helper.sf, helperFixed)
      ],
      expandedCount: tests.length,
      expansion: { via: [...outer.via, helper.name, ...innerVia], tests: exact ? tests : null },
      generator: helper.name,
      kind: "generated" as const,
      line: lineOf(call, sf),
      title: titleText(titleNode, { sf: helper.sf, env: helperFixed, depth: 0 }),
      tsExpectErrorCount: index === 0 ? callDirectives : 0
    }
  })
}

// ---------------------------------------------------------------- comments

const isJsDocNode = (node: ts.Node): boolean =>
  node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode

/** @since 0.1.0 */
export interface CommentRange {
  readonly pos: number
  readonly end: number
  readonly text: string
}

/**
 * Every comment of a file (leading and trailing trivia of every token), each once, in
 * source order. Text inside a string or template literal is never a comment.
 *
 * @since 0.1.0
 */
export const commentRanges = (sf: ts.SourceFile): ReadonlyArray<CommentRange> => {
  const seen = new Set<number>()
  const ranges: Array<CommentRange> = []
  const add = (found: ReadonlyArray<ts.CommentRange> | undefined): void => {
    for (const range of found ?? []) {
      if (seen.has(range.pos)) continue
      seen.add(range.pos)
      ranges.push({ pos: range.pos, end: range.end, text: sf.text.slice(range.pos, range.end) })
    }
  }
  const visit = (node: ts.Node): void => {
    if (isJsDocNode(node)) return
    add(ts.getLeadingCommentRanges(sf.text, node.pos))
    const children = node.getChildren(sf)
    if (children.length === 0) add(ts.getTrailingCommentRanges(sf.text, node.end))
    for (const child of children) visit(child)
  }
  visit(sf)
  return ranges.sort((a, b) => a.pos - b.pos)
}

const commentTexts = (sf: ts.SourceFile): ReadonlyArray<string> => commentRanges(sf).map((range) => range.text)

/**
 * True for a comment that TypeScript reads as a `@ts-expect-error` directive.
 *
 * @since 0.1.0
 */
export const isTsExpectErrorDirective = (comment: string): boolean =>
  /^\/\/\/?\s*@ts-expect-error/.test(comment) || /^\/\*[\s*]*@ts-expect-error/.test(comment)

const directiveCache = new WeakMap<ts.SourceFile, ReadonlyArray<number>>()

/** The `@ts-expect-error` directives inside a node (from its first token to its end). */
const directivesWithin = (node: ts.Node, sf: ts.SourceFile): number => {
  const cached = directiveCache.get(sf)
  const positions = cached ??
    commentRanges(sf).filter((range) => isTsExpectErrorDirective(range.text)).map((range) => range.pos)
  if (cached === undefined) directiveCache.set(sf, positions)
  const start = node.getStart(sf)
  return positions.filter((pos) => pos >= start && pos < node.end).length
}

// ---------------------------------------------------------------- files

const countNewlines = (text: string): number => text.split("\n").length - 1

const listTestFiles = (pkgDir: string): ReadonlyArray<string> =>
  TEST_DIRS.flatMap((dir) => {
    const absolute = join(pkgDir, dir)
    if (!existsSync(absolute)) return []
    return readdirSync(absolute).filter((name) => name.endsWith(".test.ts")).map((name) => `${dir}/${name}`)
  }).sort(compareCodePoints)

const analyseTestFile = (pkgDir: string, path: string): UpstreamFile => {
  const file = join(pkgDir, path)
  const sf = parseSource(file, path)
  const drafts: Array<DraftTest> = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const classified = classifyCall(node, sf, file, pkgDir)
      if (classified?.kind === "plain") drafts.push(draftPlainOrAlias(node, sf, classified.testKind, null))
      if (classified?.kind === "alias") drafts.push(draftPlainOrAlias(node, sf, classified.testKind, classified.generator))
      if (classified?.kind === "each") drafts.push(draftEach(node, sf, classified.table))
      if (classified?.kind === "helper") drafts.push(...draftHelper(node, sf, classified.helper))
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  const groupKey = (draft: DraftTest): string => JSON.stringify([draft.describePath, draft.title])
  const groupSizes = new Map<string, number>()
  for (const draft of drafts) groupSizes.set(groupKey(draft), (groupSizes.get(groupKey(draft)) ?? 0) + 1)
  const seen = new Map<string, number>()
  const tests: Array<UpstreamTest> = drafts.map((draft) => {
    const key = groupKey(draft)
    const index = (seen.get(key) ?? 0) + 1
    seen.set(key, index)
    const occurrence = (groupSizes.get(key) ?? 1) > 1 ? index : null
    return { ...draft, occurrence, annotation: formatAnnotation(path, draft.describePath, draft.title, occurrence) }
  })

  const count = (kinds: ReadonlyArray<TestKind>): number =>
    tests.filter((test) => kinds.includes(test.kind)).reduce((total, test) => total + test.expandedCount, 0)
  return {
    callSites: tests.filter((test) => test.kind === "it").length,
    lines: countNewlines(sf.text),
    path,
    runnable: count(["it", "it.each", "generated"]),
    skip: count(["skip"]),
    tests,
    todo: count(["todo"]),
    tsExpectErrorCount: commentTexts(sf).filter(isTsExpectErrorDirective).length
  }
}

/**
 * Reads `exports[`<name>`] = `<value>`;` entries of a Vitest snapshot file (raw source text),
 * in file order. Throws on any other statement.
 *
 * @since 0.1.0
 */
export const readSnapshotFile = (file: string, label: string): Record<string, string> => {
  const sf = ts.createSourceFile(label, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const entries: Record<string, string> = {}
  for (const statement of sf.statements) {
    const expression = ts.isExpressionStatement(statement) ? statement.expression : undefined
    if (
      expression === undefined || !ts.isBinaryExpression(expression) ||
      expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken ||
      !ts.isElementAccessExpression(expression.left) || !ts.isIdentifier(expression.left.expression) ||
      expression.left.expression.text !== "exports"
    ) {
      throw new Error(`${where(statement, sf)}: unexpected statement in a snapshot file`)
    }
    const key = expression.left.argumentExpression
    const value = expression.right
    if (!ts.isNoSubstitutionTemplateLiteral(key) || !ts.isNoSubstitutionTemplateLiteral(value)) {
      throw new Error(`${where(statement, sf)}: snapshot key and value must be plain templates`)
    }
    entries[literalSource(key, sf)] = literalSource(value, sf)
  }
  return entries
}

const readSnapshots = (pkgDir: string): Record<string, Record<string, string>> => {
  const snapshots: Record<string, Record<string, string>> = {}
  for (const dir of TEST_DIRS) {
    const folder = join(pkgDir, dir, "__snapshots__")
    if (!existsSync(folder)) continue
    for (const name of readdirSync(folder).filter((entry) => entry.endsWith(".snap")).sort(compareCodePoints)) {
      const path = `${dir}/__snapshots__/${name}`
      snapshots[path] = readSnapshotFile(join(pkgDir, path), path)
    }
  }
  return snapshots
}

const readScxmlGroups = (pkgDir: string): Record<string, ReadonlyArray<string>> => {
  const file = join(pkgDir, "test", "scxml.test.ts")
  if (!existsSync(file)) return {}
  const sf = parseSource(file, "test/scxml.test.ts")
  for (const statement of sf.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "testGroups") continue
      const value = declaration.initializer === undefined
        ? OPAQUE
        : evaluate(declaration.initializer, { sf, env: EMPTY_ENV, depth: 0 })
      if (
        !isPlainObject(value) ||
        !Object.values(value).every((names) => Array.isArray(names) && names.every((name) => typeof name === "string"))
      ) {
        throw new Error(`${where(declaration, sf)}: testGroups is not a table of names`)
      }
      return value as Record<string, ReadonlyArray<string>>
    }
  }
  throw new Error("test/scxml.test.ts has no testGroups table")
}

// ---------------------------------------------------------------- source sites

const listSourceFiles = (dir: string, prefix: string): ReadonlyArray<string> =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      return entry.name === "test" || entry.name === "__snapshots__" ? [] : listSourceFiles(join(dir, entry.name), path)
    }
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") && !entry.name.endsWith(".test.ts") ? [path] : []
  })

const messageText = (args: ReadonlyArray<ts.Expression>, sf: ts.SourceFile): string => {
  const [first] = args
  if (first === undefined) return ""
  if (args.length === 1) return templateText(first, sf)
  return args.map((argument) => printExpression(argument, sf)).join(", ")
}

const readSourceSites = (pkgDir: string): ReadonlyArray<SourceSite> => {
  const sites: Array<SourceSite> = []
  for (const path of listSourceFiles(join(pkgDir, "src"), "src")) {
    const sf = parseSource(join(pkgDir, path), path)
    const visit = (node: ts.Node): void => {
      if (ts.isThrowStatement(node)) {
        const thrown = unwrap(node.expression)
        if (ts.isNewExpression(thrown) && ts.isIdentifier(thrown.expression) && thrown.expression.text === "Error") {
          sites.push({ file: path, kind: "throw", line: lineOf(node, sf), text: messageText(thrown.arguments ?? [], sf) })
        } else {
          sites.push({
            file: path,
            kind: ts.isIdentifier(thrown) ? "rethrow" : "throw-other",
            line: lineOf(node, sf),
            text: printExpression(thrown, sf)
          })
        }
      }
      if (
        ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "console" &&
        (node.expression.name.text === "warn" || node.expression.name.text === "error")
      ) {
        sites.push({
          file: path,
          kind: node.expression.name.text === "warn" ? "console.warn" : "console.error",
          line: lineOf(node, sf),
          text: messageText(node.arguments, sf)
        })
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return sites.sort((a, b) => compareCodePoints(a.file, b.file) || a.line - b.line || compareCodePoints(a.kind, b.kind))
}

// ---------------------------------------------------------------- exports

const EXPORT_COMPILER_OPTIONS: ts.CompilerOptions = {
  allowImportingTsExtensions: true,
  lib: ["lib.es2024.d.ts", "lib.dom.d.ts"],
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  noEmit: true,
  skipLibCheck: true,
  strict: true,
  target: ts.ScriptTarget.ESNext,
  types: []
}

interface ClassifiedExport {
  readonly name: string
  readonly isValue: boolean
  readonly target: ts.Symbol
}

/**
 * The checker method that follows an alias chain to an `export type` / `import type`
 * link. It is marked internal in the TypeScript declarations but is the one the export
 * research used (upstream-exports-and-src.md §0), so the lists match its counts.
 */
interface CheckerWithTypeOnlyAliases extends ts.TypeChecker {
  getTypeOnlyAliasDeclaration(symbol: ts.Symbol): ts.Node | undefined
}

const classifyExport = (checker: ts.TypeChecker, symbol: ts.Symbol): ClassifiedExport => {
  if ((symbol.flags & ts.SymbolFlags.Alias) === 0) {
    return { name: symbol.name, isValue: (symbol.flags & ts.SymbolFlags.Value) !== 0, target: symbol }
  }
  const typeOnly = (checker as CheckerWithTypeOnlyAliases).getTypeOnlyAliasDeclaration(symbol) !== undefined
  const target = checker.getAliasedSymbol(symbol)
  return { name: symbol.name, isValue: !typeOnly && (target.flags & ts.SymbolFlags.Value) !== 0, target }
}

const splitExports = (exports: ReadonlyArray<ClassifiedExport>): NamespaceExports => ({
  types: sortedNames(exports.filter((entry) => !entry.isValue).map((entry) => entry.name)),
  values: sortedNames(exports.filter((entry) => entry.isValue).map((entry) => entry.name))
})

const moduleExports = (checker: ts.TypeChecker, program: ts.Program, file: string): ReadonlyArray<ClassifiedExport> => {
  const sf = program.getSourceFile(file)
  if (sf === undefined) throw new Error(`cannot load the entry file ${file}`)
  const moduleSymbol = checker.getSymbolAtLocation(sf)
  return moduleSymbol === undefined
    ? []
    : checker.getExportsOfModule(moduleSymbol).map((symbol) => classifyExport(checker, symbol))
}

const isNamespaceModule = (symbol: ts.Symbol): boolean =>
  (symbol.flags & ts.SymbolFlags.ValueModule) !== 0 &&
  (symbol.declarations ?? []).some((declaration) => ts.isSourceFile(declaration))

const readExportLists = (rootDir: string, entries: Readonly<Record<string, string>>): Record<string, ExportList> => {
  const files = Object.values(entries).map((entry) => join(rootDir, entry))
  const program = ts.createProgram(files, EXPORT_COMPILER_OPTIONS)
  const checker = program.getTypeChecker()
  return Object.fromEntries(
    Object.entries(entries).map(([entryPoint, entry]) => [
      entryPoint,
      { entry, ...splitExports(moduleExports(checker, program, join(rootDir, entry))) }
    ])
  )
}

/**
 * The port's export list per entry point, with the members of each `export * as` namespace.
 *
 * @since 0.1.0
 */
export const readPortBaseline = (portDir: string, commit: string): PortBaseline => {
  const files = Object.values(PORT_ENTRY_POINTS).map((entry) => join(portDir, entry))
  const program = ts.createProgram(files, EXPORT_COMPILER_OPTIONS)
  const checker = program.getTypeChecker()
  const exports = Object.fromEntries(
    Object.entries(PORT_ENTRY_POINTS).map(([entryPoint, entry]): [string, PortExportList] => {
      const classified = moduleExports(checker, program, join(portDir, entry))
      const namespaces = Object.fromEntries(
        classified
          .filter((item) => item.isValue && isNamespaceModule(item.target))
          .map((item) => [
            item.name,
            splitExports(checker.getExportsOfModule(item.target).map((symbol) => classifyExport(checker, symbol)))
          ])
      )
      return [entryPoint, { entry, namespaces, ...splitExports(classified) }]
    })
  )
  const { name } = JSON.parse(readFileSync(join(portDir, "package.json"), "utf8")) as { readonly name: string }
  return { commit, exports, package: name }
}

// ---------------------------------------------------------------- manifest

/**
 * Builds the manifest from a validated clone and a port baseline.
 *
 * @since 0.1.0
 */
export const buildManifest = (cloneDir: string, portBaseline: PortBaseline): UpstreamManifest => {
  const pkgDir = upstreamPackageDir(cloneDir)
  const files = listTestFiles(pkgDir).map((path) => analyseTestFile(pkgDir, path))
  const tests = files.flatMap((file) => file.tests)
  const total = (pick: (file: UpstreamFile) => number): number => files.reduce((sum, file) => sum + pick(file), 0)
  return {
    exports: readExportLists(pkgDir, UPSTREAM_ENTRY_POINTS),
    files,
    graphSnapshots: readSnapshots(pkgDir),
    portBaseline,
    schema: MANIFEST_SCHEMA,
    scxmlGroups: readScxmlGroups(pkgDir),
    sourceSites: readSourceSites(pkgDir),
    totals: {
      assertions: tests.reduce((sum, test) => sum + test.assertionCount, 0),
      callSites: total((file) => file.callSites),
      files: files.length,
      inlineSnapshots: tests.reduce((sum, test) => sum + test.inlineSnapshots.length, 0),
      runnable: total((file) => file.runnable),
      skip: total((file) => file.skip),
      todo: total((file) => file.todo),
      tsExpectError: total((file) => file.tsExpectErrorCount)
    },
    upstream: { commit: UPSTREAM_COMMIT, package: "xstate", tag: UPSTREAM_TAG, version: UPSTREAM_VERSION }
  }
}

/** @since 0.1.0 */
export interface FreezeOptions {
  readonly cloneDir: string
  readonly outFile: string
  readonly portDir: string
  /** The port commit; asked for only when the output has no baseline yet. */
  readonly portCommit: () => string
}

/**
 * Validates the clone, builds the manifest and writes it. An existing port baseline in
 * the output file is kept as it is (written once, COMPAT-4).
 *
 * @since 0.1.0
 */
export const freeze = (options: FreezeOptions): UpstreamManifest => {
  const problems = validateClone(options.cloneDir)
  if (problems.length > 0) throw new Error(problems.join("\n"))
  const previous = existsSync(options.outFile)
    ? (JSON.parse(readFileSync(options.outFile, "utf8")) as Partial<UpstreamManifest>)
    : null
  const portBaseline = previous?.portBaseline ?? readPortBaseline(options.portDir, options.portCommit())
  const manifest = buildManifest(options.cloneDir, portBaseline)
  writeFileSync(options.outFile, serializeManifest(manifest))
  return manifest
}

// ---------------------------------------------------------------- command line

const git = (cwd: string, args: ReadonlyArray<string>): string =>
  execFileSync("git", [...args], { cwd, encoding: "utf8" }).trim()

/** HEAD of the port; refuses uncommitted `src/` changes, so the baseline names its commit. */
const portHead = (pkgDir: string): string => {
  const dirty = git(pkgDir, ["status", "--porcelain", "--", "src"])
  if (dirty !== "") throw new Error(`commit the src/ changes before the port baseline is taken:\n${dirty}`)
  return git(pkgDir, ["rev-parse", "HEAD"])
}

const main = (argv: ReadonlyArray<string>): number => {
  const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
  const { values } = parseArgs({
    args: [...argv],
    options: { clone: { type: "string" }, out: { type: "string" } }
  })
  const cloneDir = resolve(values.clone ?? join(pkgDir, ".upstream", `xstate-${UPSTREAM_VERSION}`))
  const outFile = resolve(values.out ?? join(pkgDir, "test", "upstream", "upstream-manifest.json"))
  const problems = validateClone(cloneDir)
  if (problems.length > 0) {
    for (const problem of problems) console.error(`freeze-upstream: ${problem}`)
    return 1
  }
  try {
    const manifest = freeze({ cloneDir, outFile, portDir: pkgDir, portCommit: () => portHead(pkgDir) })
    const { totals } = manifest
    console.log(
      `freeze-upstream: wrote ${relative(process.cwd(), outFile)}: ${totals.files} files, ${totals.callSites} call sites, ` +
        `${totals.runnable} runnable, ${totals.skip} skip, ${totals.todo} todo`
    )
    return 0
  } catch (error) {
    console.error(`freeze-upstream: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}

const invokedDirectly = (): boolean => {
  const script = process.argv[1]
  return script !== undefined && existsSync(script) &&
    realpathSync(script) === realpathSync(fileURLToPath(import.meta.url))
}

if (invokedDirectly()) process.exitCode = main(process.argv.slice(2))
