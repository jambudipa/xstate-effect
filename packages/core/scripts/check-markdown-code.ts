#!/usr/bin/env npx tsx

/**
 * Markdown TypeScript Code Block Checker
 *
 * Finds all TypeScript code blocks in markdown files, extracts them,
 * typechecks them, lints them, and produces a report.
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { execSync, spawnSync } from "node:child_process"

// ============================================
// TYPES
// ============================================

/** One fenced `ts` or `typescript` block that `extractCodeBlocks` found in a markdown file. */
interface CodeBlock {
  /**
   * Path of the markdown file that holds the block, absolute because the walk starts at `ROOT_DIR`.
   */
  file: string
  /** 1-based line of the first code line: the line after the opening fence. */
  lineStart: number
  /**
   * 1-based line of the last code line: the line before the closing fence. For an empty block it is
   * one less than `lineStart`.
   */
  lineEnd: number
  /** The lines between the fences, joined with `\n`; the fences are not included. */
  code: string
  /**
   * The fence tag in lower case, `ts` or `typescript`. No check reads it; only `report.json`
   * carries it.
   */
  language: string
}

/**
 * The outcome for one block. `main` creates it with empty lists and fills them after the type check
 * and the lint.
 */
interface CheckResult {
  /**
   * The block the result describes; its `file` and line range locate the result in the markdown.
   */
  block: CodeBlock
  /**
   * Absolute path of the `.ts` file that holds the block under `EXTRACTED_DIR`. `main` looks up the
   * findings of `runTypeCheck` and `runLint` by this path, so their keys must equal it exactly.
   */
  extractedFile: string
  /**
   * Compiler errors, each `Line l:c - TSnnnn: message`.
   *
   * The line refers to the extracted file, which starts with a four-line header, so the markdown
   * line is `lineStart + l - 5`.
   */
  typeErrors: string[]
  /**
   * ESLint findings, each `Line l:c - error|warning [rule]: message`, with the same extracted-file
   * line numbers as `typeErrors`. A warning counts as a finding.
   */
  lintErrors: string[]
}

/**
 * The result of one run. `formatReport` prints it, and `main` saves it as `report.txt` and
 * `report.json` in `TEMP_DIR`.
 */
interface Report {
  /** ISO 8601 time, in UTC, at which the run built the report. */
  timestamp: string
  /** Markdown files scanned, those with no TypeScript block included. */
  totalFiles: number
  /** TypeScript blocks found across all scanned files. */
  totalBlocks: number
  /** Blocks with at least one compiler error. */
  blocksWithTypeErrors: number
  /**
   * Blocks with at least one ESLint error or warning. A block can count here and in
   * `blocksWithTypeErrors`.
   */
  blocksWithLintErrors: number
  /** Blocks with no compiler error and no ESLint finding. */
  blocksClean: number
  /** One entry per block, in the order the walk found them. */
  results: CheckResult[]
}

// ============================================
// CONFIGURATION
// ============================================

/**
 * The package root, found from the script's own location, so the result does not depend on the
 * working folder.
 */
const ROOT_DIR = path.resolve(import.meta.dirname, "..")
/** The `docs/` folder. Unused: `main` scans all of `ROOT_DIR`, not only `docs/`. */
const DOCS_DIR = path.join(ROOT_DIR, "docs")
/**
 * Scratch folder of the run (gitignored). `main` deletes it and creates it again at the start of
 * every run, so keep nothing there.
 */
const TEMP_DIR = path.join(ROOT_DIR, ".markdown-code-check")
/**
 * Where each block becomes its own `.ts` file. The generated tsconfig and ESLint config cover only
 * this folder.
 */
const EXTRACTED_DIR = path.join(TEMP_DIR, "extracted")

// ============================================
// MARKDOWN PARSING
// ============================================

/**
 * Lists every `.md` file under `dir`, at any depth, as paths joined onto `dir`.
 *
 * Only folders named `node_modules` or `.git` are skipped. Gitignored folders such as `.upstream/`
 * are scanned too, so a markdown file there adds its blocks to the check. Symbolic links are not
 * followed. A folder that cannot be read throws, which ends the run.
 */
function findMarkdownFiles(dir: string): string[] {
  const files: string[] = []

  function walk(currentDir: string): void {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)

      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== ".git") {
          walk(fullPath)
        }
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(fullPath)
      }
    }
  }

  walk(dir)
  return files
}

/**
 * Finds the fenced blocks tagged `ts` or `typescript`, in any case, in one markdown file.
 *
 * An opening fence counts only at the start of a line, so a fence indented inside a list item is
 * not checked; nor is a `tsx` block or a `~~~` fence. Any later line that starts with three
 * backticks closes the block, whatever follows them. A block left open at the end of the file is
 * dropped.
 */
function extractCodeBlocks(filePath: string): CodeBlock[] {
  const content = fs.readFileSync(filePath, "utf-8")
  const lines = content.split("\n")
  const blocks: CodeBlock[] = []

  let inBlock = false
  let blockStart = 0
  let blockLanguage = ""
  let blockLines: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (!inBlock) {
      // Check for code block start
      const match = line.match(/^```(typescript|ts)(\s|$)/i)
      if (match) {
        inBlock = true
        blockStart = i + 1 // 1-indexed
        blockLanguage = match[1].toLowerCase()
        blockLines = []
      }
    } else {
      // Check for code block end
      if (line.startsWith("```")) {
        inBlock = false
        blocks.push({
          file: filePath,
          lineStart: blockStart + 1, // Line after the opening ```
          lineEnd: i, // Last code line (1-based): the closing fence's 0-based index
          code: blockLines.join("\n"),
          language: blockLanguage
        })
      } else {
        blockLines.push(line)
      }
    }
  }

  return blocks
}

// ============================================
// FILE GENERATION
// ============================================

/**
 * Builds a flat file name for one extracted block from its markdown path relative to the package
 * root.
 *
 * `blockIndex` is the block's index across the whole run, not within its file, which keeps the
 * names unique even when two markdown paths sanitize to the same text. `lineStart` only makes the
 * name readable.
 */
function sanitizeFilename(filePath: string, blockIndex: number, lineStart: number): string {
  const relativePath = path.relative(ROOT_DIR, filePath)
  const safePath = relativePath
    .replace(/[\/\\]/g, "_")
    .replace(/\.md$/, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")

  return `${safePath}_block${blockIndex + 1}_line${lineStart}.ts`
}

/**
 * Writes one block to `EXTRACTED_DIR` as a `.ts` file and returns its absolute path.
 *
 * The file starts with a four-line header that names the markdown source and the line range, so the
 * code begins on line 5. `EXTRACTED_DIR` must exist; `main` creates it.
 */
function generateExtractedFile(block: CodeBlock, blockIndex: number): string {
  const filename = sanitizeFilename(block.file, blockIndex, block.lineStart)
  const outputPath = path.join(EXTRACTED_DIR, filename)

  // Prepend source comment for traceability
  const sourceComment = [
    `// Source: ${path.relative(ROOT_DIR, block.file)}`,
    `// Lines: ${block.lineStart}-${block.lineEnd}`,
    `// This file was auto-generated for type checking`,
    "",
    ""
  ].join("\n")

  fs.writeFileSync(outputPath, sourceComment + block.code)
  return outputPath
}

/**
 * Writes the strict `tsconfig.json` that type-checks the extracted blocks.
 *
 * It maps `@jambudipa/xstate-effect` and the `@/*` alias onto `src/`, so the samples compile
 * against the source, not against a build. A subpath import such as
 * `@jambudipa/xstate-effect/graph` has no mapping here.
 */
function generateTsConfig(): void {
  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      lib: ["ES2022", "DOM"],
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
      baseUrl: "..",
      paths: {
        "@jambudipa/xstate-effect": ["./src/index.ts"],
        "@/*": ["./src/*"]
      }
    },
    include: ["extracted/**/*.ts"]
  }

  fs.writeFileSync(
    path.join(TEMP_DIR, "tsconfig.json"),
    JSON.stringify(tsconfig, null, 2)
  )
}

/**
 * Writes the ESLint flat config that lints the extracted blocks.
 *
 * The rule set is small on purpose, because samples are excerpts: floating promises and awaits of
 * non-thenables are errors, explicit `any` and unused bindings are warnings. ESLint finds this file
 * first from `TEMP_DIR`, so the package's own `eslint.config.mjs` does not apply to the samples.
 */
function generateEslintConfig(): void {
  const eslintConfig = `
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    files: ['extracted/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      // Only basic TypeScript rules for documentation code
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
    },
  }
);
`

  fs.writeFileSync(path.join(TEMP_DIR, "eslint.config.mjs"), eslintConfig)
}

// ============================================
// TYPE CHECKING
// ============================================

/**
 * Runs `tsc` over the extracted files and returns its errors keyed by extracted-file path.
 *
 * Only lines of the form `extracted/<file>(line,col): error TSnnnn: message` are kept. A failure
 * with no file position, such as a bad tsconfig or a missing `tsc`, matches nothing and leaves the
 * map empty, so the report shows every block as type-clean. Read the console output when the counts
 * look too good.
 */
function runTypeCheck(): Map<string, string[]> {
  const errors = new Map<string, string[]>()

  try {
    execSync(`npx tsc -p tsconfig.json --pretty false 2>&1`, {
      cwd: TEMP_DIR,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    })
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string }
    const output = (error.stdout ?? "") + (error.stderr ?? "")

    // Parse TypeScript errors
    // Format: filename(line,col): error TS####: message
    const lines = output.split("\n")
    for (const line of lines) {
      const match = line.match(/^extracted\/([^(]+)\((\d+),(\d+)\): error (TS\d+): (.+)$/)
      if (match) {
        const filename = match[1]
        const lineNum = match[2]
        const colNum = match[3]
        const code = match[4]
        const message = match[5]

        const fullPath = path.join(EXTRACTED_DIR, filename)
        if (!errors.has(fullPath)) {
          errors.set(fullPath, [])
        }
        errors.get(fullPath)!.push(`Line ${lineNum}:${colNum} - ${code}: ${message}`)
      }
    }
  }

  return errors
}

// ============================================
// LINTING
// ============================================

/**
 * Runs ESLint over the extracted files and returns its findings keyed by the absolute path that
 * ESLint reports.
 *
 * Warnings count as findings, the same as errors. When ESLint cannot run or prints something that
 * is not JSON, the function returns an empty map, and every block counts as lint-clean.
 */
function runLint(): Map<string, string[]> {
  const errors = new Map<string, string[]>()

  try {
    const result = spawnSync(
      "npx",
      ["eslint", "extracted", "--format", "json"],
      {
        cwd: TEMP_DIR,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"]
      }
    )

    if (result.stdout) {
      try {
        const lintResults = JSON.parse(result.stdout) as Array<{
          filePath: string
          messages: Array<{
            line: number
            column: number
            ruleId: string | null
            message: string
            severity: number
          }>
        }>

        for (const file of lintResults) {
          if (file.messages.length > 0) {
            const fileErrors: string[] = []
            for (const msg of file.messages) {
              if (msg.severity > 0) {
                const level = msg.severity === 2 ? "error" : "warning"
                fileErrors.push(
                  `Line ${msg.line}:${msg.column} - ${level} [${msg.ruleId ?? "unknown"}]: ${msg.message}`
                )
              }
            }
            if (fileErrors.length > 0) {
              errors.set(file.filePath, fileErrors)
            }
          }
        }
      } catch {
        // JSON parse error - likely no output
      }
    }
  } catch {
    // ESLint may not be configured properly for extracted files
  }

  return errors
}

// ============================================
// REPORTING
// ============================================

/**
 * Renders the plain-text report: the totals, then each file with findings and its failing blocks,
 * then the clean files with their block counts. Paths are relative to the package root.
 */
function formatReport(report: Report): string {
  const lines: string[] = []

  lines.push("=" .repeat(80))
  lines.push("MARKDOWN TYPESCRIPT CODE BLOCK CHECK REPORT")
  lines.push("=" .repeat(80))
  lines.push("")
  lines.push(`Timestamp: ${report.timestamp}`)
  lines.push(`Files scanned: ${report.totalFiles}`)
  lines.push(`Code blocks found: ${report.totalBlocks}`)
  lines.push("")
  lines.push("-".repeat(80))
  lines.push("SUMMARY")
  lines.push("-".repeat(80))
  lines.push(`  Clean blocks:          ${report.blocksClean}`)
  lines.push(`  Blocks with type errors: ${report.blocksWithTypeErrors}`)
  lines.push(`  Blocks with lint errors: ${report.blocksWithLintErrors}`)
  lines.push("")

  // Group results by file
  const byFile = new Map<string, CheckResult[]>()
  for (const result of report.results) {
    const key = result.block.file
    if (!byFile.has(key)) {
      byFile.set(key, [])
    }
    byFile.get(key)!.push(result)
  }

  // Show details for files with issues
  const filesWithIssues = [...byFile.entries()].filter(([, results]) =>
    results.some(r => r.typeErrors.length > 0 || r.lintErrors.length > 0)
  )

  if (filesWithIssues.length > 0) {
    lines.push("-".repeat(80))
    lines.push("ISSUES BY FILE")
    lines.push("-".repeat(80))
    lines.push("")

    for (const [file, results] of filesWithIssues) {
      const relativePath = path.relative(ROOT_DIR, file)
      lines.push(`FILE: ${relativePath}`)
      lines.push("")

      for (const result of results) {
        if (result.typeErrors.length > 0 || result.lintErrors.length > 0) {
          lines.push(`  Block at lines ${result.block.lineStart}-${result.block.lineEnd}:`)

          if (result.typeErrors.length > 0) {
            lines.push("    TYPE ERRORS:")
            for (const err of result.typeErrors) {
              lines.push(`      - ${err}`)
            }
          }

          if (result.lintErrors.length > 0) {
            lines.push("    LINT ISSUES:")
            for (const err of result.lintErrors) {
              lines.push(`      - ${err}`)
            }
          }

          lines.push("")
        }
      }
    }
  }

  // Show clean files
  const cleanFiles = [...byFile.entries()].filter(([, results]) =>
    results.every(r => r.typeErrors.length === 0 && r.lintErrors.length === 0)
  )

  if (cleanFiles.length > 0) {
    lines.push("-".repeat(80))
    lines.push("CLEAN FILES")
    lines.push("-".repeat(80))

    for (const [file] of cleanFiles) {
      const relativePath = path.relative(ROOT_DIR, file)
      const blockCount = byFile.get(file)!.length
      lines.push(`  ${relativePath} (${blockCount} block${blockCount === 1 ? "" : "s"})`)
    }
    lines.push("")
  }

  lines.push("=" .repeat(80))

  return lines.join("\n")
}

// ============================================
// MAIN
// ============================================

/**
 * Runs the whole check, as `pnpm check-docs`.
 *
 * It rebuilds `TEMP_DIR`, extracts every TypeScript block of every markdown file in the package,
 * type-checks and lints the blocks, prints the report and saves it as `report.txt` and
 * `report.json`. The process exits with code 1 when any block has a compiler error or any ESLint
 * finding (a warning included), and with code 0 when every block is clean or no block exists.
 */
async function main(): Promise<void> {
  console.log("Markdown TypeScript Code Block Checker")
  console.log("======================================")
  console.log("")

  // Clean up and create temp directory
  if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true })
  }
  fs.mkdirSync(EXTRACTED_DIR, { recursive: true })

  // Find all markdown files
  console.log("Scanning for markdown files...")
  const markdownFiles = findMarkdownFiles(ROOT_DIR)
  console.log(`Found ${markdownFiles.length} markdown files`)
  console.log("")

  // Extract all code blocks
  console.log("Extracting TypeScript code blocks...")
  const allBlocks: CodeBlock[] = []
  for (const file of markdownFiles) {
    const blocks = extractCodeBlocks(file)
    allBlocks.push(...blocks)
  }
  console.log(`Found ${allBlocks.length} TypeScript code blocks`)
  console.log("")

  if (allBlocks.length === 0) {
    console.log("No TypeScript code blocks found. Nothing to check.")
    return
  }

  // Generate extracted files
  console.log("Generating extracted files...")
  const results: CheckResult[] = []
  for (let i = 0; i < allBlocks.length; i++) {
    const block = allBlocks[i]
    const extractedFile = generateExtractedFile(block, i)
    results.push({
      block,
      extractedFile,
      typeErrors: [],
      lintErrors: []
    })
  }
  console.log(`Generated ${results.length} files in ${EXTRACTED_DIR}`)
  console.log("")

  // Generate tsconfig
  console.log("Generating tsconfig.json...")
  generateTsConfig()

  // Generate eslint config
  console.log("Generating eslint.config.mjs...")
  generateEslintConfig()
  console.log("")

  // Run type checking
  console.log("Running type check...")
  const typeErrors = runTypeCheck()
  for (const result of results) {
    const errors = typeErrors.get(result.extractedFile)
    if (errors) {
      result.typeErrors = errors
    }
  }
  console.log(`Found type errors in ${typeErrors.size} files`)
  console.log("")

  // Run linting
  console.log("Running linter...")
  const lintErrors = runLint()
  for (const result of results) {
    const errors = lintErrors.get(result.extractedFile)
    if (errors) {
      result.lintErrors = errors
    }
  }
  console.log(`Found lint issues in ${lintErrors.size} files`)
  console.log("")

  // Generate report
  const report: Report = {
    timestamp: new Date().toISOString(),
    totalFiles: markdownFiles.length,
    totalBlocks: allBlocks.length,
    blocksWithTypeErrors: results.filter(r => r.typeErrors.length > 0).length,
    blocksWithLintErrors: results.filter(r => r.lintErrors.length > 0).length,
    blocksClean: results.filter(r => r.typeErrors.length === 0 && r.lintErrors.length === 0).length,
    results
  }

  const reportText = formatReport(report)
  console.log("")
  console.log(reportText)

  // Save report to file
  const reportPath = path.join(TEMP_DIR, "report.txt")
  fs.writeFileSync(reportPath, reportText)
  console.log("")
  console.log(`Report saved to: ${reportPath}`)

  // Also save JSON report
  const jsonReportPath = path.join(TEMP_DIR, "report.json")
  fs.writeFileSync(jsonReportPath, JSON.stringify(report, null, 2))
  console.log(`JSON report saved to: ${jsonReportPath}`)

  // Exit with error code if there are issues
  if (report.blocksWithTypeErrors > 0 || report.blocksWithLintErrors > 0) {
    process.exit(1)
  }
}

main().catch(err => {
  console.error("Error:", err)
  process.exit(1)
})
