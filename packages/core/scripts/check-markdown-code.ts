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

interface CodeBlock {
  file: string
  lineStart: number
  lineEnd: number
  code: string
  language: string
}

interface CheckResult {
  block: CodeBlock
  extractedFile: string
  typeErrors: string[]
  lintErrors: string[]
}

interface Report {
  timestamp: string
  totalFiles: number
  totalBlocks: number
  blocksWithTypeErrors: number
  blocksWithLintErrors: number
  blocksClean: number
  results: CheckResult[]
}

// ============================================
// CONFIGURATION
// ============================================

const ROOT_DIR = path.resolve(import.meta.dirname, "..")
const DOCS_DIR = path.join(ROOT_DIR, "docs")
const TEMP_DIR = path.join(ROOT_DIR, ".markdown-code-check")
const EXTRACTED_DIR = path.join(TEMP_DIR, "extracted")

// ============================================
// MARKDOWN PARSING
// ============================================

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
          lineEnd: i, // Line of the closing ```
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

function sanitizeFilename(filePath: string, blockIndex: number, lineStart: number): string {
  const relativePath = path.relative(ROOT_DIR, filePath)
  const safePath = relativePath
    .replace(/[\/\\]/g, "_")
    .replace(/\.md$/, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")

  return `${safePath}_block${blockIndex + 1}_line${lineStart}.ts`
}

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
