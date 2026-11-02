/**
 * @since 0.4.0
 * @module graph/moduleClosure
 *
 * The module closure a certificate's hash covers (decision 16): every file an entry module
 * reaches by import, so a change to a guard or an action in any of them changes the hash. A
 * port addition, for the settlement certificate.
 *
 * It reads the files through the `FileSystem` and `Path` services, so the graph entry point
 * itself stays free of a platform. `importScan.ts` finds the imports without a parser. The walk
 * follows the real imports first, then every other name of an import form (a comment, a string,
 * a type-only import), so such a name is an extra input to the hash and never a missing import.
 * A computed name and a loader under another name stay unseen: `importScan.ts` lists them.
 */
import { Array as Arr, Effect, FileSystem, MutableHashMap, Option, Order, Path, Predicate, Schema } from "effect"
import type { PlatformError } from "effect/PlatformError"
import { scanImports } from "./importScan.js"

/**
 * One input to a certificate's hash: a file with its text, or a dependency by name with no text.
 *
 * @since 0.4.0
 * @category Settlement
 */
export interface CertificateModule {
  /**
   * The file's path relative to the entry's folder, or a name that is no file:
   * `package:<name>@<version>` (an installed package), `builtin:<name>` (a `node:` or `bun:`
   * module), `unresolved:<name>` (a real import that names nothing found) or `mentioned:<name>`
   * (a comment, a string or a type-only import that names nothing found, or a real import of a
   * file that only such a name reaches). No run depends on a `mentioned:` name.
   */
  readonly path: string
  /** The file's text; empty for a name. */
  readonly source: string
}

/** A target of an `exports` or `imports` map: a string, a list, a map of conditions, or `null`. */
type Target = string | null | ReadonlyArray<Target> | { readonly [key: string]: Target }

/** The schema of a {@link Target}. */
const Target: Schema.Codec<Target> = Schema.Union([
  Schema.String,
  Schema.Null,
  Schema.Array(Schema.suspend((): Schema.Codec<Target> => Target)),
  Schema.Record(Schema.String, Schema.suspend((): Schema.Codec<Target> => Target)),
])

/** The fields of a `package.json` the walk reads. */
const Manifest = Schema.fromJsonString(
  Schema.Struct({
    name: Schema.optional(Schema.String),
    version: Schema.optional(Schema.String),
    main: Schema.optional(Schema.String),
    exports: Schema.optional(Target),
    imports: Schema.optional(Target),
  })
)

/** The fields of a `package.json` the walk reads. */
type Manifest = typeof Manifest.Type

/** Reads a `package.json`'s text; a file that does not decode has none of the fields. */
const readManifest = (text: string): Manifest =>
  Option.getOrElse(Schema.decodeUnknownOption(Manifest)(text), (): Manifest => ({}))

/** The extensions of a file the walk reads for imports. */
const codeFile = /\.[cm]?[jt]sx?$/

/** The extensions tried on a path with none. */
const extensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".d.ts", ".d.mts", ".d.cts"]

/** The source files a compiled extension stands for, in the order a compiler tries them. */
const compiledFrom: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
  [".js", [".ts", ".tsx", ".jsx", ".d.ts"]],
  [".jsx", [".tsx", ".d.ts"]],
  [".mjs", [".mts", ".d.mts"]],
  [".cjs", [".cts", ".d.cts"]],
]

/** Node's builtin modules, which a file can name with no `node:` prefix. */
const nodeBuiltins = `assert assert/strict async_hooks buffer child_process cluster console constants crypto dgram
  diagnostics_channel dns dns/promises domain events fs fs/promises http http2 https inspector inspector/promises
  module net os path path/posix path/win32 perf_hooks process punycode querystring readline readline/promises repl
  stream stream/consumers stream/promises stream/web string_decoder sys timers timers/promises tls trace_events tty
  url util util/types v8 vm wasi worker_threads zlib`.split(/\s+/)

/** The fields of a `tsconfig.json` the walk reads. */
const TsConfig = Schema.fromJsonString(
  Schema.Struct({
    extends: Schema.optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
    compilerOptions: Schema.optional(
      Schema.Struct({
        baseUrl: Schema.optional(Schema.String),
        paths: Schema.optional(Schema.Record(Schema.String, Schema.Array(Schema.String))),
      })
    ),
  })
)

/** What a `tsconfig.json` and the configs it extends say about a bare name. */
interface Aliases {
  /** The folder `baseUrl` names, absolute. */
  readonly baseUrl: Option.Option<string>
  /** The folder a `paths` target is relative to when no `baseUrl` is set: the config that holds them. */
  readonly pathsBase: string
  /** The `paths` map. */
  readonly paths: Readonly<Record<string, ReadonlyArray<string>>>
}

/** Which prefix the walk gives a name that resolves to nothing. */
type MissingLabel = "unresolved" | "mentioned"

/** The prefix of a real import that resolves to nothing. */
const unresolvedPrefix = "unresolved:"

/**
 * The module closure of `entry`: every file it reaches, itself included, and every package and
 * builtin they import by name, sorted by path in code-unit order, each once. It follows relative
 * imports (`./x.js` finds `x.ts`, `./x.jsx` finds `x.tsx`, `./x.cjs` finds `x.cts`), a package's
 * `imports` map, the `paths` and `baseUrl` of the nearest `tsconfig.json` or `jsconfig.json`
 * through its `extends`, a package's import of its own name, and a workspace package through its
 * `exports` map, taking every condition's target, as any of them can run. An installed package
 * counts by name and version, as its files cannot change under that version; a package is a
 * workspace package when its real path is outside `node_modules`.
 *
 * A real import that resolves to nothing gives a module `unresolved:<name>`, with no text, so no
 * edit to that file can reach the hash: read them with {@link unresolvedImports}, as `certify`
 * does, and treat one as a failure. A type-only import, a declaration file's import, and a name
 * in a comment or a string run nothing: each adds its file to the hash when it finds one, and
 * gives `mentioned:<name>` when it does not. So a real import that a lexer loses in a place it
 * cannot read keeps its file in the hash, and only its failure can be lost (`importScan.ts`).
 *
 * @example
 * ```ts
 * // Provide the platform's FileSystem and Path layers.
 * const modules = moduleClosure("src/machine.ts")
 * ```
 *
 * @since 0.4.0
 * @category Settlement
 */
export const moduleClosure = (
  entry: string
): Effect.Effect<Arr.NonEmptyReadonlyArray<CertificateModule>, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const start = path.resolve(entry)
    const root = path.dirname(start)
    const found = MutableHashMap.empty<string, string>()

    const isFile = (file: string) =>
      fs.stat(file).pipe(Effect.map((info) => info.type === "File"), Effect.orElseSucceed(() => false))

    const firstFile = (candidates: ReadonlyArray<string>) => Effect.findFirst(candidates, isFile)

    const fileOf = (base: string) =>
      firstFile([
        base,
        ...extensions.map((extension) => `${base}${extension}`),
        ...compiledFrom.flatMap(([compiled, sources]) =>
          base.endsWith(compiled) ? sources.map((each) => `${base.slice(0, -compiled.length)}${each}`) : []
        ),
        ...extensions.map((extension) => path.join(base, `index${extension}`)),
      ])

    /** The file of the first base that has one. */
    const firstFileOf = (bases: ReadonlyArray<string>) =>
      Effect.map(Effect.forEach(bases, fileOf), (files) => Arr.head(files.flatMap(Option.toArray)))

    /** The folder and each folder above it. */
    const foldersFrom = (folder: string): ReadonlyArray<string> =>
      path.dirname(folder) === folder ? [folder] : [folder, ...foldersFrom(path.dirname(folder))]

    const note = (name: string) =>
      Effect.sync(() => {
        MutableHashMap.set(found, name, "")
      })

    /** Records a name that resolves to nothing; a real import of the name outranks a mention. */
    const noteMissing = (specifier: string, label: MissingLabel) =>
      Effect.suspend(() =>
        label === "mentioned" && MutableHashMap.has(found, `${unresolvedPrefix}${specifier}`)
          ? Effect.void
          : note(`${label}:${specifier}`)
      )

    /** The `tsconfig.json` at `file` over the configs it extends; `seen` stops a cycle. */
    const readAliases = (
      file: string,
      configDir: string,
      seen: ReadonlyArray<string>
    ): Effect.Effect<Aliases, PlatformError> =>
      Effect.gen(function*() {
        const folder = path.dirname(file)
        const config = readTsConfig(yield* fs.readFileString(file))
        const parents = yield* Effect.forEach(Arr.ensure(config.extends ?? []), (each) =>
          extendedConfig(each, folder).pipe(
            Effect.flatMap(Option.match({
              onNone: () => Effect.succeed(noAliases(folder)),
              onSome: (parent) =>
                seen.includes(parent) ? Effect.succeed(noAliases(folder)) : readAliases(parent, configDir, [...seen, parent]),
            }))
          ))
        const inherited = Arr.reduce(parents, noAliases(folder), (merged, parent) => ({
          baseUrl: Option.orElse(parent.baseUrl, () => merged.baseUrl),
          pathsBase: Object.keys(parent.paths).length > 0 ? parent.pathsBase : merged.pathsBase,
          paths: Object.keys(parent.paths).length > 0 ? parent.paths : merged.paths,
        }))
        const options = config.compilerOptions
        const expand = (value: string) => path.resolve(folder, value.replaceAll("${configDir}", configDir))
        return {
          baseUrl: Option.orElse(Option.map(Option.fromUndefinedOr(options?.baseUrl), expand), () => inherited.baseUrl),
          pathsBase: Predicate.isUndefined(options?.paths) ? inherited.pathsBase : folder,
          paths: options?.paths ?? inherited.paths,
        }
      })

    /** The file an `extends` entry names: a relative path, or a package's config. */
    const extendedConfig = (name: string, folder: string) =>
      firstFile(
        name.startsWith(".") || path.isAbsolute(name)
          ? [path.resolve(folder, name), path.resolve(folder, `${name}.json`)]
          : foldersFrom(folder).flatMap((each) => {
            const base = path.join(each, "node_modules", name)
            return [base, `${base}.json`, path.join(base, "tsconfig.json")]
          })
      )

    const aliasesByFolder = MutableHashMap.empty<string, Aliases>()

    /** The aliases of the nearest config above a folder, read once per folder. */
    const aliasesOf = (folder: string) =>
      Effect.gen(function*() {
        const known = MutableHashMap.get(aliasesByFolder, folder)
        if (Option.isSome(known)) return known.value
        const configs = foldersFrom(folder).flatMap((each) => configNames.map((name) => path.join(each, name)))
        const file = yield* firstFile(configs)
        const aliases = Option.isNone(file)
          ? noAliases(folder)
          : yield* readAliases(file.value, path.dirname(file.value), [file.value])
        MutableHashMap.set(aliasesByFolder, folder, aliases)
        return aliases
      })

    /** Follows a bare name through `paths` and `baseUrl`; `false` when neither finds a file. */
    const followAlias = (specifier: string, folder: string, label: MissingLabel) =>
      Effect.gen(function*() {
        const aliases = yield* aliasesOf(folder)
        const target = yield* firstFileOf([
          ...aliasTargets(aliases.paths, specifier).map((each) =>
            path.resolve(Option.getOrElse(aliases.baseUrl, () => aliases.pathsBase), each)
          ),
          ...Option.toArray(Option.map(aliases.baseUrl, (base) => path.resolve(base, specifier))),
        ])
        if (Option.isNone(target)) return false
        yield* visit(target.value, label)
        return true
      })

    /** Walks each target of an `exports` or `imports` map, relative to the package's folder. */
    const followTargets = (specifier: string, folder: string, targets: ReadonlyArray<string>, label: MissingLabel) =>
      Effect.gen(function*() {
        const files = yield* Effect.forEach(targets, (target) => fileOf(path.resolve(folder, target)))
        const known = files.flatMap(Option.toArray)
        if (known.length === 0) return yield* noteMissing(specifier, label)
        yield* Effect.forEach(known, (each) => visit(each, label), { discard: true })
      })

    /** The nearest `package.json` above a folder, with its parsed fields. */
    const nearestManifest = (folder: string) =>
      Effect.gen(function*() {
        const file = yield* firstFile(foldersFrom(folder).map((each) => path.join(each, "package.json")))
        if (Option.isNone(file)) return Option.none()
        return Option.some({ file: file.value, manifest: readManifest(yield* fs.readFileString(file.value)) })
      })

    /** Follows a package name, or records it, from the folder of the file that imports it. */
    const followPackage = (specifier: string, folder: string, label: MissingLabel) =>
      Effect.gen(function*() {
        const name = packageName(specifier)
        const subpath = `.${specifier.slice(name.length)}`
        const own = yield* nearestManifest(folder)
        if (Option.isSome(own) && own.value.manifest.name === name) {
          const targets = packageTargets(own.value.manifest, subpath)
          return yield* followTargets(specifier, path.dirname(own.value.file), targets, label)
        }
        const manifests = foldersFrom(folder).map((each) => path.join(each, "node_modules", name, "package.json"))
        const manifestFile = yield* firstFile(manifests)
        if (Option.isNone(manifestFile)) return yield* noteMissing(specifier, label)
        const manifest = readManifest(yield* fs.readFileString(manifestFile.value))
        const home = yield* fs.realPath(path.dirname(manifestFile.value))
        if (home.split(path.sep).includes("node_modules")) return yield* note(`package:${name}@${manifest.version ?? ""}`)
        yield* followTargets(specifier, home, packageTargets(manifest, subpath), label)
      })

    /** Follows a `#` import through the nearest `package.json` above the file. */
    const followImports = (specifier: string, folder: string, label: MissingLabel) =>
      Effect.gen(function*() {
        const own = yield* nearestManifest(folder)
        if (Option.isNone(own)) return yield* noteMissing(specifier, label)
        const targets = mapTargets(own.value.manifest.imports, specifier)
        yield* followTargets(specifier, path.dirname(own.value.file), targets, label)
      })

    const follow = (specifier: string, file: string, label: MissingLabel): Effect.Effect<void, PlatformError> =>
      Effect.gen(function*() {
        const folder = path.dirname(file)
        if (specifier.startsWith(".") || specifier.startsWith("/")) {
          const target = yield* fileOf(path.resolve(folder, specifier))
          return yield* Option.match(target, {
            onNone: () => noteMissing(specifier, label),
            onSome: (each) => visit(each, label),
          })
        }
        if (specifier.startsWith("#")) return yield* followImports(specifier, folder, label)
        if (yield* followAlias(specifier, folder, label)) return
        if (/^[a-z]+:/.test(specifier) || nodeBuiltins.includes(specifier)) return yield* note(`builtin:${specifier}`)
        yield* followPackage(specifier, folder, label)
      })

    /** Follows a file's names: a mentioned file's real imports are only mentions, as it never loads. */
    const visit = (file: string, label: MissingLabel): Effect.Effect<void, PlatformError> =>
      Effect.gen(function*() {
        const name = path.relative(root, file)
        if (MutableHashMap.has(found, name)) return
        const source = yield* fs.readFileString(file)
        MutableHashMap.set(found, name, source)
        if (!codeFile.test(file)) return
        const { loads, mentions } = scanImports(source, file)
        const names = label === "unresolved" ? loads : [...loads, ...mentions]
        yield* Effect.forEach(names, (each) => follow(withoutQuery(each), file, label), { discard: true })
      })

    yield* visit(start, "unresolved")
    // Every load is known here, so a name that is both a load and a mention stays `unresolved`
    const loaded = Array.from(found)
    yield* Effect.forEach(loaded, ([each, source]) =>
      codeFile.test(each)
        ? Effect.forEach(
          scanImports(source, each).mentions,
          (mention) => follow(withoutQuery(mention), path.resolve(root, each), "mentioned"),
          { discard: true }
        )
        : Effect.void, { discard: true })
    const name = path.relative(root, start)
    const modules = Array.from(found, ([each, source]): CertificateModule => ({ path: each, source }))
    const first: CertificateModule = { path: name, source: Option.getOrElse(MutableHashMap.get(found, name), () => "") }
    return Arr.sort(
      Arr.prepend(modules.filter((each) => each.path !== name), first),
      Order.mapInput(Order.String, (each: CertificateModule) => each.path)
    )
  })

/**
 * The names of the real imports a closure could not find, each once. A hash cannot cover such a
 * file, so `certify` gives a `"failed"` verdict and the `xstate-effect-certify` bin names each.
 *
 * @since 0.4.0
 * @category Settlement
 */
export const unresolvedImports = (modules: ReadonlyArray<CertificateModule>): ReadonlyArray<string> =>
  modules.flatMap((each) => (each.path.startsWith(unresolvedPrefix) ? [each.path.slice(unresolvedPrefix.length)] : []))

/** The names of a config file, nearest first in each folder. */
const configNames = ["tsconfig.json", "jsconfig.json"]

/** No aliases, relative to `folder`. */
const noAliases = (folder: string): Aliases => ({ baseUrl: Option.none(), pathsBase: folder, paths: {} })

/** A specifier without the query a bundler reads. */
const withoutQuery = (specifier: string): string => specifier.split("?")[0] ?? specifier

/** A replacement that keeps a matched string and drops all else. */
const keepString = (_match: string, kept: string | undefined): string => kept ?? ""

/** Reads a config's text, which may hold comments and trailing commas; one that does not decode has no fields. */
const readTsConfig = (text: string): typeof TsConfig.Type => {
  const uncommented = text.replace(/("(?:[^"\\\n]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, keepString)
  const strict = uncommented.replace(/("(?:[^"\\\n]|\\.)*")|,(?=\s*[}\]])/g, keepString)
  return Option.getOrElse(Schema.decodeUnknownOption(TsConfig)(strict), (): typeof TsConfig.Type => ({}))
}

/** The targets of a `paths` map for a name, as a compiler picks them: an exact key, else the longest prefix. */
const aliasTargets = (
  paths: Readonly<Record<string, ReadonlyArray<string>>>,
  specifier: string
): ReadonlyArray<string> => {
  const exact = Object.hasOwn(paths, specifier) ? paths[specifier] ?? [] : []
  if (exact.length > 0) return exact
  const matches = Object.keys(paths).filter((key) => {
    const star = key.indexOf("*")
    const prefix = key.slice(0, star)
    const suffix = key.slice(star + 1)
    return star >= 0 && specifier.length >= prefix.length + suffix.length &&
      specifier.startsWith(prefix) && specifier.endsWith(suffix)
  })
  const best = Arr.head(Arr.sort(matches, Order.mapInput(Order.Number, (key: string) => -key.indexOf("*"))))
  return Option.match(best, {
    onNone: () => [],
    onSome: (key) => {
      const star = key.indexOf("*")
      const part = specifier.slice(star, specifier.length - (key.length - star - 1))
      return (paths[key] ?? []).map((target) => target.replace("*", part))
    },
  })
}

/** The package name of a bare specifier: its first segment, or its first two when scoped. */
const packageName = (specifier: string): string =>
  specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/")

/** The targets of a package's subpath, through its `exports` map, else its `main` or the path itself. */
const packageTargets = (manifest: Manifest, subpath: string): ReadonlyArray<string> => {
  if (Predicate.isUndefined(manifest.exports)) return subpath === "." ? [manifest.main ?? "index"] : [subpath]
  return mapTargets(isSubpathMap(manifest.exports) ? manifest.exports : { ".": manifest.exports }, subpath)
}

/** `true` for an `exports` map keyed by subpath, not by condition. */
const isSubpathMap = (value: unknown): value is Readonly<Record<string, unknown>> =>
  Predicate.isObject(value) && Object.keys(value).some((key) => key.startsWith("."))

/** The targets `specifier` gets from a map of exact keys and `*` patterns; every condition's, as any can run. */
const mapTargets = (map: unknown, specifier: string): ReadonlyArray<string> => {
  if (!Predicate.isObject(map)) return []
  return Object.entries(map).flatMap(([key, value]) => {
    if (key === specifier) return leaves(value)
    const star = key.indexOf("*")
    if (star < 0) return []
    const prefix = key.slice(0, star)
    const suffix = key.slice(star + 1)
    if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) return []
    const part = specifier.slice(prefix.length, specifier.length - suffix.length)
    return leaves(value).map((leaf) => leaf.replaceAll("*", part))
  })
}

/** Every string below a target: a target is a string, a list, or a map of conditions. */
const leaves = (target: unknown): ReadonlyArray<string> => {
  if (Predicate.isString(target)) return [target]
  if (Array.isArray(target)) return target.flatMap(leaves)
  return Predicate.isObject(target) ? Object.values(target).flatMap(leaves) : []
}
