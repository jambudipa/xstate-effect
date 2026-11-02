/**
 * @since 0.4.0
 * @module graph/importScan
 *
 * Reads the imports of one source file for `moduleClosure` (decision 16), a port addition, in two
 * passes that err in opposite directions, as the package may depend on no parser:
 *
 * - A small lexer over comments, strings, template literals and regular expressions gives the
 *   `loads`: the names that a real import statement or call holds, which `moduleClosure` holds a
 *   build to.
 * - One pattern over the whole text gives the `mentions`: every name after an import form,
 *   whatever surrounds it, a comment and a string included. These only add inputs to the hash, so
 *   a lexer that loses its place can demote an import from a load to a mention, and can never
 *   drop its file from the hash.
 *
 * The lexer has no grammar. After a `)` or a `}` it reads a `/` as a division, and JSX text as
 * code, so a quote in such a place can hide what follows on that line from the first pass. It
 * ends a string at the end of its line, which holds the damage to that line.
 *
 * Neither pass sees a computed name, or a loader under another name: `import(name)`,
 * `require("./" + name)`, `const load = require`, `createRequire(url)("./x")`,
 * `import.meta.glob("./*.ts")` and `new URL("./x", import.meta.url)`.
 */
import { Option, Predicate } from "effect"

/** What one source file imports. */
export interface ScannedImports {
  /** The names of real imports, in source order: an erased import is none. */
  readonly loads: ReadonlyArray<string>
  /** Every name after an import form, in a comment, a string or a type-only import too. */
  readonly mentions: ReadonlyArray<string>
}

/** One lexical token: a name or number, a string with no substitution, or any other mark. */
interface Token {
  /** The kind of the token. */
  readonly kind: "word" | "string" | "mark"
  /** A word or mark as written; a string's text without its quotes. */
  readonly text: string
}

/** Finds a name after each import form, past white space, comments and a parenthesis. */
const mentionPattern =
  /(?:\bfrom|\bimport(?:\s*\.\s*(?:defer|source))?|\brequire(?:\s*\.\s*resolve)?|\bmeta\s*\.\s*resolve)(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*\n|\()*["'`]([^"'`\n]+)["'`]/g

/** A declaration file, which no runtime loads, so no import in it is a load. */
const declarationFile = /\.d\.[cm]?ts$/

/** A run of name characters, at the lexer's place. */
const wordPattern = /[\p{ID_Continue}$]+/uy

/** The keywords after which a `/` starts a regular expression, not a division. */
const regexKeywords = "await case delete do else in instanceof new of return throw typeof void yield".split(" ")

/** The word that stands for a template literal with a substitution: it reads as a value. */
const templateEnd: Token = { kind: "word", text: "`...`" }

/** The index past the string that opens at `start`, or `-1` when no quote closes it on its line. */
const stringEnd = (source: string, start: number): number => {
  const quote = source[start]
  let at = start + 1
  while (at < source.length && source[at] !== "\n") {
    if (source[at] === quote) return at + 1
    at += source[at] === "\\" ? 2 : 1
  }
  return -1
}

/** Where one part of a template literal ends; `hole` is `true` at a `${`. */
const templatePartEnd = (source: string, start: number): Option.Option<{ readonly end: number; readonly hole: boolean }> => {
  let at = start
  while (at < source.length) {
    if (source[at] === "`") return Option.some({ end: at + 1, hole: false })
    if (source[at] === "$" && source[at + 1] === "{") return Option.some({ end: at + 2, hole: true })
    at += source[at] === "\\" ? 2 : 1
  }
  return Option.none()
}

/** The index past the regular expression that opens at `start`, or `-1` when none closes on its line. */
const regexEnd = (source: string, start: number): number => {
  let at = start + 1
  let inClass = false
  while (at < source.length && source[at] !== "\n") {
    if (source[at] === "/" && !inClass) return at + 1
    if (source[at] === "[") inClass = true
    if (source[at] === "]") inClass = false
    at += source[at] === "\\" ? 2 : 1
  }
  return -1
}

/** `true` when a `/` after this token starts a regular expression. */
const regexMayFollow = (previous: Token | undefined): boolean => {
  if (Predicate.isUndefined(previous)) return true
  if (previous.kind === "string") return false
  if (previous.kind === "word") return regexKeywords.includes(previous.text)
  return ![")", "]", "}"].includes(previous.text)
}

/** The tokens of a source text, without its comments. A quote that nothing closes is a mark. */
function* tokensOf(source: string): Generator<Token> {
  let at = source.startsWith("#!") ? Math.max(source.indexOf("\n"), 0) : 0
  let braces = 0
  let holes: ReadonlyArray<number> = []
  let previous: Token | undefined
  while (at < source.length) {
    const char = source.charAt(at)
    const next = source[at + 1]
    if (/\s/.test(char)) {
      at += 1
      continue
    }
    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", at)
      at = end < 0 ? source.length : end
      continue
    }
    const commentEnd = char === "/" && next === "*" ? source.indexOf("*/", at + 2) : -1
    if (commentEnd >= 0) {
      at = commentEnd + 2
      continue
    }
    const end = char === '"' || char === "'" ? stringEnd(source, at) : -1
    if (end >= 0) {
      previous = { kind: "string", text: source.slice(at + 1, end - 1) }
      yield previous
      at = end
      continue
    }
    const closesHole = char === "}" && holes[holes.length - 1] === braces
    if (char === "`" || closesHole) {
      const part = templatePartEnd(source, at + 1)
      if (closesHole) holes = holes.slice(0, -1)
      if (Option.isSome(part)) {
        const { end: partEnd, hole } = part.value
        previous = char === "`" && !hole ? { kind: "string", text: source.slice(at + 1, partEnd - 1) } : templateEnd
        yield previous
        if (hole) holes = [...holes, braces]
        at = partEnd
        continue
      }
    }
    const regex = char === "/" && regexMayFollow(previous) ? regexEnd(source, at) : -1
    if (regex >= 0) {
      previous = { kind: "word", text: source.slice(at, regex) }
      yield previous
      at = regex
      continue
    }
    wordPattern.lastIndex = at
    const word = wordPattern.exec(source)?.[0]
    if (Predicate.isString(word)) {
      previous = { kind: "word", text: word }
      yield previous
      at += word.length
      continue
    }
    if (char === "{") braces += 1
    if (char === "}") braces -= 1
    previous = { kind: "mark", text: char }
    yield previous
    at += 1
  }
}

/** `true` for the word `text`. */
const isWord = (token: Token | undefined, text: string): boolean => token?.kind === "word" && token.text === text

/** `true` for the mark `text`. */
const isMark = (token: Token | undefined, text: string): boolean => token?.kind === "mark" && token.text === text

/** `true` for a token an import or export clause holds. */
const inClause = (token: Token | undefined): boolean =>
  !Predicate.isUndefined(token) &&
  !isWord(token, "import") &&
  !isWord(token, "export") &&
  (token.kind !== "mark" || ["{", "}", ",", "*"].includes(token.text))

/** `true` for `{ type A, type B as C }`, which a compiler erases. An empty clause keeps its load. */
const isAllTypes = (clause: ReadonlyArray<Token>): boolean => {
  if (!isMark(clause[0], "{") || !isMark(clause[clause.length - 1], "}") || clause.length < 3) return false
  const entries = splitEntries(clause.slice(1, -1))
  return entries.every((entry) => isWord(entry[0], "type") && entry.length > 1 && !isWord(entry[1], "as"))
}

/** The entries of a named clause, without a trailing comma's empty one. */
const splitEntries = (tokens: ReadonlyArray<Token>): ReadonlyArray<ReadonlyArray<Token>> => {
  const comma = tokens.findIndex((token) => isMark(token, ","))
  if (comma < 0) return tokens.length === 0 ? [] : [tokens]
  return [tokens.slice(0, comma), ...splitEntries(tokens.slice(comma + 1))]
}

/**
 * `true` when the statement that ends in `from` at `index` is erased: `import type`, `export type`
 * or a clause of type names. `import type from "x"` and `import type, { a } from "x"` hold a
 * binding named `type`, so each of them loads.
 */
const isErasedStatement = (tokens: ReadonlyArray<Token>, index: number): boolean => {
  let head = index - 1
  while (inClause(tokens[head])) head -= 1
  if (!isWord(tokens[head], "import") && !isWord(tokens[head], "export")) return false
  const typed = isWord(tokens[head + 1], "type") && head + 2 < index && !isMark(tokens[head + 2], ",")
  return typed || isAllTypes(tokens.slice(head + 1, index))
}

/** `true` when the string at `index` is the one argument that a loader call starts with. */
const isLoaderArgument = (tokens: ReadonlyArray<Token>, index: number): boolean => {
  if (!isMark(tokens[index - 1], "(")) return false
  if (!isMark(tokens[index + 1], ")") && !isMark(tokens[index + 1], ",")) return false
  const callee = tokens[index - 2]
  const member = isMark(tokens[index - 3], ".")
  if (isWord(callee, "import") || isWord(callee, "require")) {
    if (member) return false
    const typeAlias = isMark(tokens[index - 3], "=") && isWord(tokens[index - 5], "type") && isWord(tokens[index - 6], "import")
    return !typeAlias
  }
  if (!member) return false
  if (isWord(callee, "defer") || isWord(callee, "source")) return isWord(tokens[index - 4], "import")
  if (!isWord(callee, "resolve")) return false
  if (isWord(tokens[index - 4], "require")) return !isMark(tokens[index - 5], ".")
  return isWord(tokens[index - 4], "meta") && isMark(tokens[index - 5], ".") && isWord(tokens[index - 6], "import")
}

/** `true` when the string at `index` names a module that a run loads. */
const isLoad = (tokens: ReadonlyArray<Token>, index: number): boolean => {
  const before = tokens[index - 1]
  const outsideMember = !isMark(tokens[index - 2], ".")
  if (isWord(before, "from")) return outsideMember && !isErasedStatement(tokens, index - 1)
  if (isWord(before, "import")) return outsideMember
  return isLoaderArgument(tokens, index)
}

/**
 * The imports of one file. A declaration file loads nothing, as no runtime reads it. A file with
 * no import gives two empty lists.
 *
 * @since 0.4.0
 * @category Settlement
 */
export const scanImports = (source: string, file: string): ScannedImports => {
  const mentions = Array.from(source.matchAll(mentionPattern), (match) => match[1]).filter(Predicate.isString)
  if (declarationFile.test(file)) return { loads: [], mentions }
  const tokens = Array.from(tokensOf(source))
  const loads = tokens.flatMap((token, index) => (token.kind === "string" && isLoad(tokens, index) ? [token.text] : []))
  return { loads, mentions }
}
