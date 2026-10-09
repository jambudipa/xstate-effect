/**
 * The reader of the conformance ledger `test/upstream/CONFORMANCE.md` (D2, LEDGER-1).
 *
 * The ledger is a Markdown file with one table under each of five `## ` sections. The
 * checkers (LEDGER-1, the parity checker of SD-2, the CONF import and count checks) read
 * it through this module, so the section names and the column headers have one source.
 *
 * Machine-read cells hold plain text, with no backticks around paths. A `|` inside a cell
 * is written `\|`. An empty describe path and a closing test that is not named yet are
 * written `—`.
 *
 * @since 0.1.0
 */

// ---------------------------------------------------------------- layout

/**
 * The ledger file, relative to `packages/core`.
 *
 * @since 0.1.0
 */
export const LEDGER_FILE = "test/upstream/CONFORMANCE.md"

/**
 * The cell that stands for "nothing": an empty describe path, or a closing test that is not
 * named yet.
 *
 * @since 0.1.0
 */
export const NONE = "—"

/**
 * The section heading and the exact column headers of each ledger table.
 *
 * @since 0.1.0
 */
export const TABLES = {
  files: {
    section: "Upstream files",
    columns: ["Name", "Upstream file", "Rewrite", "Rewrite phase", "Green phase", "Status"]
  },
  gaps: {
    section: "Gap rows",
    columns: ["Row", "Phase", "Subject", "Closing upstream files", "Evidence file", "Closing test", "Status"]
  },
  notPorted: {
    section: "Tests not ported",
    columns: ["File", "Describe path", "Title", "Gap kind", "Reason"]
  },
  deviations: {
    section: "Deviations",
    columns: ["ID", "Kind", "Subject", "Upstream", "Port", "Decision"]
  },
  outOfScope: {
    section: "Out of scope",
    columns: ["Row", "Subject", "Decision"]
  }
} as const

/**
 * The name of one ledger table.
 *
 * @since 0.1.0
 */
export type TableName = keyof typeof TABLES

/**
 * The status of an upstream file or a gap row. A file goes `not started` → `rewritten` →
 * `passes` (or `deviation`); a gap row goes `open` → `passes` (or `deviation`).
 *
 * @since 0.1.0
 */
export const STATUSES = ["not started", "rewritten", "passes", "deviation", "open"] as const

/**
 * Why a test of a rewrite falls short of its upstream counterpart (SD-2): it is absent, it
 * has fewer assertions, an inline snapshot differs, or a `@ts-expect-error` line is absent.
 *
 * @since 0.1.0
 */
export const GAP_KINDS = ["missing", "assertions", "inline snapshot", "ts-expect-error"] as const

/**
 * The kind of a row of the deviation table: a behaviour that differs from upstream, or a
 * baseline port export that no longer exists (COMPAT-4).
 *
 * @since 0.1.0
 */
export const DEVIATION_KINDS = ["deviation", "removed"] as const

// ---------------------------------------------------------------- rows

/**
 * One row of a ledger table, keyed by column header.
 *
 * @since 0.1.0
 */
export type LedgerRow = Readonly<Record<string, string>>

/**
 * The tables of the ledger, by table name.
 *
 * @since 0.1.0
 */
export type Ledger = { readonly [K in TableName]: ReadonlyArray<LedgerRow> }

/**
 * The parsed ledger and the layout problems found while parsing it. A missing section, a
 * header that differs from `TABLES`, or a row with the wrong number of cells is a problem;
 * the affected table is then empty.
 *
 * @since 0.1.0
 */
export interface ParsedLedger {
  readonly ledger: Ledger
  readonly problems: ReadonlyArray<string>
}

/** Splits a table line into cells at each `|` that is not escaped, and unescapes `\|`. */
const splitRow = (line: string): ReadonlyArray<string> => {
  const body = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "")
  return body.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"))
}

const isSeparator = (cells: ReadonlyArray<string>): boolean => cells.every((cell) => /^:?-+:?$/.test(cell))

/** The lines of each `## ` section, by heading. */
const sectionsOf = (markdown: string): ReadonlyMap<string, ReadonlyArray<string>> => {
  const sections = new Map<string, Array<string>>()
  let current: Array<string> | null = null
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^## (.+?)\s*$/.exec(line)?.[1]
    if (heading !== undefined) {
      current = []
      sections.set(heading, current)
    } else if (/^#{1,2} /.test(line)) {
      current = null
    } else {
      current?.push(line)
    }
  }
  return sections
}

/** The first table of a section: the header cells and the data rows, each as cells. */
const firstTable = (
  lines: ReadonlyArray<string>
): { readonly header: ReadonlyArray<string>; readonly rows: ReadonlyArray<ReadonlyArray<string>> } | null => {
  const start = lines.findIndex((line) => line.trimStart().startsWith("|"))
  if (start < 0) return null
  const block: Array<string> = []
  for (const line of lines.slice(start)) {
    if (!line.trimStart().startsWith("|")) break
    block.push(line)
  }
  const [headerLine, separatorLine, ...rowLines] = block
  if (headerLine === undefined || separatorLine === undefined || !isSeparator(splitRow(separatorLine))) return null
  return { header: splitRow(headerLine), rows: rowLines.map(splitRow) }
}

/**
 * Parses the ledger text into its five tables and reports every layout problem.
 *
 * @since 0.1.0
 */
export const parseLedger = (markdown: string): ParsedLedger => {
  const sections = sectionsOf(markdown)
  const problems: Array<string> = []
  const readTable = (name: TableName): ReadonlyArray<LedgerRow> => {
    const { section, columns } = TABLES[name]
    const lines = sections.get(section)
    if (lines === undefined) {
      problems.push(`section "${section}" is missing`)
      return []
    }
    const table = firstTable(lines)
    if (table === null) {
      problems.push(`section "${section}" has no table`)
      return []
    }
    if (table.header.join(" | ") !== columns.join(" | ")) {
      problems.push(`section "${section}": header "${table.header.join(" | ")}" differs from "${columns.join(" | ")}"`)
      return []
    }
    const rows: Array<LedgerRow> = []
    table.rows.forEach((cells, index) => {
      if (cells.length !== columns.length) {
        problems.push(`section "${section}" row ${index + 1}: ${cells.length} cells, the header has ${columns.length}`)
        return
      }
      rows.push(Object.fromEntries(columns.map((column, at) => [column, cells[at] ?? ""])))
    })
    return rows
  }
  const ledger: Ledger = {
    files: readTable("files"),
    gaps: readTable("gaps"),
    notPorted: readTable("notPorted"),
    deviations: readTable("deviations"),
    outOfScope: readTable("outOfScope")
  }
  return { ledger, problems }
}

// ---------------------------------------------------------------- names and keys

/**
 * The short name of an upstream test file, as the SPEC tasks and the gap-row table use it:
 * `test/deep.test.ts` → `deep`, `test/examples/cd.test.ts` → `examples/cd`,
 * `src/graph/test/paths.test.ts` → `graph/paths`.
 *
 * @since 0.1.0
 */
export const shortName = (upstreamPath: string): string =>
  upstreamPath
    .replace(/^src\/graph\/test\//, "graph/")
    .replace(/^test\//, "")
    .replace(/\.test\.ts$/, "")

/**
 * The path of the rewrite of an upstream test file, relative to `packages/core` (D1):
 * `test/upstream/<short name>.test.ts`.
 *
 * @since 0.1.0
 */
export const rewritePath = (upstreamPath: string): string => `test/upstream/${shortName(upstreamPath)}.test.ts`

/**
 * The scenario evidence file of a gap row (SD-1).
 *
 * @since 0.1.0
 */
export const evidenceFile = (row: string): string => `test/verify/verify-xstate-5-33-2-port-${row}.spec.ts`

/**
 * The describe titles of a "Tests not ported" row, outermost first; `—` stands for none.
 *
 * @since 0.1.0
 */
export const describePathOf = (row: LedgerRow): ReadonlyArray<string> => {
  const cell = row["Describe path"] ?? NONE
  return cell === NONE ? [] : cell.split(" > ")
}

/**
 * The annotation text (`<file> > <describe path> > <title>[ #<n>]`) of the upstream test
 * that a "Tests not ported" row stands for. It equals the manifest's `annotation` field.
 *
 * @since 0.1.0
 */
export const notPortedAnnotation = (row: LedgerRow): string =>
  [row["File"] ?? "", ...describePathOf(row), row["Title"] ?? ""].join(" > ")

/**
 * The decisions a cell cites: approved decisions `D1`–`D20` and spec decisions
 * `SD-1`–`SD-28`, in order of appearance. An ID outside these ranges is not returned.
 *
 * @since 0.1.0
 */
export const citedDecisions = (text: string): ReadonlyArray<string> =>
  [...text.matchAll(/\b(SD-|D)(\d+)\b/g)].flatMap((match) => {
    const number = Number(match[2])
    const inRange = match[1] === "D" ? number >= 1 && number <= 20 : number >= 1 && number <= 28
    return inRange ? [`${match[1]}${number}`] : []
  })

/**
 * True when a reason names a cause that only upstream can have: the test is skipped or a
 * todo upstream (AC 35).
 *
 * @since 0.1.0
 */
export const isUpstreamOnlyReason = (text: string): boolean => /\b(skipped|todo) upstream\b/.test(text)
