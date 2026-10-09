#!/usr/bin/env tsx
/**
 * Code Cleanup Script (clean.ts)
 *
 * An automated code cleanup tool that identifies TypeScript and ESLint issues
 * across the package and repairs them using the Claude Agent SDK.
 *
 * Usage:
 *   npx tsx scripts/clean.ts                    # Full package analysis and repair
 *   npx tsx scripts/clean.ts --analyze-only    # Analysis only (no repairs)
 *   npx tsx scripts/clean.ts src/Actor.ts test # Target specific paths
 *   npx tsx scripts/clean.ts --verbose         # Show agent prompts and tool calls
 *   npx tsx scripts/clean.ts --quiet           # Statistics only
 *   npx tsx scripts/clean.ts --dry-run         # Preview changes without writing
 *   npx tsx scripts/clean.ts --max-files 10    # Limit files processed
 *   npx tsx scripts/clean.ts --fail-fast       # Stop on first unresolved file
 *   npx tsx scripts/clean.ts --json            # JSON output for CI integration
 *
 * Run it from the package root: it reads `tsconfig.json`, `clean.config.ts` and `code-style/`
 * from the working folder. The repair agent runs with `bypassPermissions` (except with
 * `--dry-run`), so it can edit any file and run any command without a prompt. Run it only on a
 * checkout you trust, with your own work committed, and review its diff.
 */

import * as ts from 'typescript';
import { ESLint, Rule } from 'eslint';
import { query } from '@anthropic-ai/claude-agent-sdk';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { program } from 'commander';
import cliProgress from 'cli-progress';

// Terminal color utilities (reusing existing patterns)
/**
 * ANSI reset: ends the color and weight that the codes below start.
 *
 * The script writes these codes whatever the output is: it does not check for a terminal or for
 * `NO_COLOR`, so redirected console output keeps them.
 */
const RESET = '\x1b[0m';
/** ANSI green foreground. */
const GREEN = '\x1b[32m';
/** ANSI yellow foreground. */
const YELLOW = '\x1b[33m';
/** ANSI red foreground. */
const RED = '\x1b[31m';
/** ANSI blue foreground. */
const BLUE = '\x1b[34m';
/** ANSI cyan foreground; also frames the report and the progress bar. */
const CYAN = '\x1b[36m';
/** ANSI bold weight. */
const BOLD = '\x1b[1m';
/** ANSI dim weight. */
const DIM = '\x1b[2m';
/** ANSI magenta foreground. Only the unused `_magenta` helper reads it. */
const MAGENTA = '\x1b[35m';

/** Green text: fixed files, zero counts and success messages. */
const success = (text: string): string => `${GREEN}${text}${RESET}`;
/** Yellow text: warning counts, issues that remain, and the permissive pass. */
const warning = (text: string): string => `${YELLOW}${text}${RESET}`;
/** Red text: error counts, failed repairs and fatal errors. */
const errorColor = (text: string): string => `${RED}${text}${RESET}`;
/** Blue text: progress messages. */
const info = (text: string): string => `${BLUE}${text}${RESET}`;
/** Bold cyan text: the scanned-file count and the banner of each later global iteration. */
const highlight = (text: string): string => `${BOLD}${CYAN}${text}${RESET}`;
/** Dim text: secondary detail such as prompts, rule names and paths. */
const dim = (text: string): string => `${DIM}${text}${RESET}`;
/** Bold text: section headings and file names. */
const bold = (text: string): string => `${BOLD}${text}${RESET}`;
/** Magenta text. Unused; the leading underscore keeps the unused-binding lint rule quiet. */
const _magenta = (text: string): string => `${MAGENTA}${text}${RESET}`;
/** Cyan text: the agent's tool calls in verbose mode. */
const cyan = (text: string): string => `${CYAN}${text}${RESET}`;

// ============================================================================
// Types
// ============================================================================

/**
 * One compiler diagnostic that `analyzeTypeScript` kept, in the form the repair prompt and the
 * reports use.
 */
interface TypeScriptDiagnostic {
  /**
   * Absolute path as the compiler reports it. `mergeIssues` groups by this string, so it equals
   * ESLint's path for the same file only where both use forward slashes (POSIX).
   */
  file: string;
  /** 1-based line. */
  line: number;
  /** 1-based column. */
  column: number;
  /** The TypeScript error number without the `TS` prefix; the prompt and the reports add it. */
  code: number;
  /** The message text, with a nested message chain flattened onto separate lines. */
  message: string;
  /**
   * `error` for a compiler error; every other category (warning, suggestion, message) becomes
   * `warning`.
   */
  severity: 'error' | 'warning';
}

/** One ESLint message, from the analysis or from the re-check after a repair. */
interface ESLintIssue {
  /** Absolute path as ESLint reports it. */
  file: string;
  /** 1-based line. */
  line: number;
  /** 1-based column. */
  column: number;
  /**
   * The rule that fired, or `unknown` for a message with no rule, such as a parse error.
   * `loadCodeStyleGuidance` derives a guidance file name from it.
   */
  ruleId: string;
  /** ESLint's message text. */
  message: string;
  /** `error` for ESLint severity 2, `warning` otherwise. */
  severity: 'error' | 'warning';
  /**
   * ESLint's autofix, when the rule offers one. Nothing applies it: the prompt leaves it out, and
   * only `repairs.json` carries it.
   */
  fix?: Rule.Fix;
}

/** All issues of one file, split by source. The repair prompt lists both kinds. */
interface FileIssues {
  /** Compiler diagnostics of the file. */
  typescript: TypeScriptDiagnostic[];
  /** ESLint messages of the file, warnings included. */
  eslint: ESLintIssue[];
}

/**
 * Issues keyed by absolute file path.
 *
 * The order is insertion order: files with compiler diagnostics first, then files with ESLint
 * messages only. `--max-files` takes the first entries in this order.
 */
type FileIssueMap = Map<string, FileIssues>;

/** The totals of one analysis pass, for the console report, the JSON report and `analysis.json`. */
interface AnalysisResult {
  /** Files that ESLint linted outside the excluded paths. The compiler pass adds no count. */
  filesScanned: number;
  /** Files with at least one compiler diagnostic or ESLint message. */
  filesWithIssues: number;
  /** Compiler diagnostics by severity. */
  typescript: {
    errors: number;
    warnings: number;
  };
  /** ESLint messages by severity. */
  eslint: {
    errors: number;
    warnings: number;
  };
  /** The ten most frequent ESLint rules and `TSnnnn` codes, most frequent first. */
  topViolations: Array<{ rule: string; count: number }>;
  /**
   * Every file with issues and its issue count, most issues first. Paths are absolute; the console
   * shows the first 15.
   */
  filesByIssueCount: Array<{ file: string; count: number }>;
}

/** The counts of the repair passes, and the files they could not fix. */
interface RepairResult {
  /** Files that the strict pass fixed, with no suppression comment. */
  success: number;
  /**
   * Files that only the permissive pass fixed; they may now hold suppression comments with a
   * reason.
   */
  partial: number;
  /**
   * Files that neither pass fixed. `main` keeps the count of the last global iteration, not a sum.
   */
  failed: number;
  /**
   * The unfixed files, each with the issues that the strict pass left. The permissive pass reports
   * no list, so these can be out of date.
   */
  unresolved: Array<{ file: string; issues: FileIssues }>;
}

/**
 * The settings that `clean.config.ts` can override: its default export, merged over
 * `DEFAULT_CONFIG`.
 *
 * No field takes effect yet. The repair loop ignores the config: it repairs one file at a time,
 * passes no model to the agent, applies no time limit, and filters paths with fixed rules instead
 * of `exclude`.
 */
interface CleanConfig {
  /** Glob patterns of paths to skip. Not applied. */
  exclude?: string[];
  /** The number of agents to run at once. Not applied: files are repaired one at a time. */
  maxConcurrentAgents?: number;
  /** Model id of the repair agent. Not applied: the agent uses the default model of the SDK. */
  agentModel?: string;
  /** Time limit for one file, in milliseconds. Not applied. */
  timeoutPerFile?: number;
}

/** The parsed command-line flags, as commander returns them from `program.opts()`. */
interface CliOptions {
  /** `--analyze-only`: report, then exit with code 0 without a repair, even when issues exist. */
  analyzeOnly: boolean;
  /**
   * `--verbose`: print each prompt, the agent's text and its tool calls. Turns off the progress
   * bar.
   */
  verbose: boolean;
  /**
   * `--quiet`: hide the banner, the progress messages, the file list and the progress bar. The
   * totals, the top rules and the repair status lines still print.
   */
  quiet: boolean;
  /**
   * `--dry-run`: run the agent in the SDK's `default` permission mode instead of
   * `bypassPermissions`, and skip the re-check, so every file counts as fixed. The script itself
   * does not block writes.
   */
  dryRun: boolean;
  /** `--max-files`: repair at most this many files in each global iteration. */
  maxFiles?: number;
  /**
   * `--fail-fast`: end the current iteration at the first file that neither pass fixes. The next
   * global iteration still runs, so this does not end the run.
   */
  failFast: boolean;
  /**
   * `--json`: print one JSON report instead of the console report.
   *
   * The repair status lines still go to stdout, so only the output of an analysis-only run (or one
   * that finds no issue) is pure JSON.
   */
  json: boolean;
  /**
   * `--report <dir>`: also write `analysis.json`, and after a repair `repairs.json` and
   * `unresolved.json`, to this folder.
   */
  report?: string;
  /**
   * `--timeout <ms>`: unused.
   *
   * Its parser `parseInt` receives the default `600_000` as its radix, so a value given on the
   * command line becomes `NaN`.
   */
  timeout: number;
  /** `--debug`: unused. */
  debug: boolean;
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * The working folder, not the script's folder. The CLI reads `tsconfig.json`, `clean.config.ts` and
 * `code-style/` from it and starts the agent in it, so run the CLI from the package root, as the
 * `pnpm clean` scripts do.
 */
const ROOT_DIR = process.cwd();

/**
 * The settings used when no `clean.config.ts` exists or it fails to load. None of them takes effect
 * yet (see `CleanConfig`).
 */
const DEFAULT_CONFIG: CleanConfig = {
  exclude: ['**/node_modules/**', '**/dist/**', '**/out-tsc/**', '**/.nx/**', '**/tmp/**'],
  maxConcurrentAgents: 1,
  agentModel: 'claude-opus-4-5-20251101',
  timeoutPerFile: 600_000, // 10 minutes
};

/**
 * Loads `clean.config.ts` from the working folder and merges its default export over
 * `DEFAULT_CONFIG`.
 *
 * A config that fails to import is ignored without a message, and the defaults apply. The import
 * takes a computed path that the static module walk of CONF-8 cannot follow, so
 * `test/verify/verify-xstate-5-33-2-port-CONF-8.spec.ts` allows this one dynamic import by its
 * line number: a change that moves that line must update the allowance there.
 */
async function loadConfig(): Promise<CleanConfig> {
  const configPath = path.join(ROOT_DIR, 'clean.config.ts');
  if (fs.existsSync(configPath)) {
    try {
      // Dynamic import for config file
      const config = await import(configPath);
      return { ...DEFAULT_CONFIG, ...config.default };
    } catch {
      return DEFAULT_CONFIG;
    }
  }
  return DEFAULT_CONFIG;
}

// ============================================================================
// TypeScript Compiler API Analysis
// ============================================================================

/**
 * Type-checks the program of `tsconfig.json` in the working folder and returns its file
 * diagnostics.
 *
 * The argument is ignored: every call checks the whole program, which in this package is `src/`
 * only, so the re-check after each repair costs a full type check. Diagnostics with no file (option
 * and config errors) and those in `node_modules`, `out-tsc` or a `/scripts/` path are dropped. A
 * missing or unreadable `tsconfig.json` prints an error and returns an empty list, so the run then
 * sees no compiler issue.
 */
function analyzeTypeScript(_targetPaths: string[]): TypeScriptDiagnostic[] {
  const diagnostics: TypeScriptDiagnostic[] = [];

  // Find tsconfig.json
  const tsconfigPath = path.join(ROOT_DIR, 'tsconfig.json');
  if (!fs.existsSync(tsconfigPath)) {
    console.error(errorColor('tsconfig.json not found'));
    return diagnostics;
  }

  // Parse the config
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error) {
    console.error(errorColor(`Error reading tsconfig: ${configFile.error.messageText}`));
    return diagnostics;
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    ROOT_DIR,
    {},
    tsconfigPath
  );

  // Create program
  const compilerProgram = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
  });

  // Get diagnostics
  const allDiagnostics = ts.getPreEmitDiagnostics(compilerProgram);

  for (const diagnostic of allDiagnostics) {
    if (diagnostic.file) {
      const { line, character } = ts.getLineAndCharacterOfPosition(
        diagnostic.file,
        diagnostic.start ?? 0
      );

      const filePath = diagnostic.file.fileName;

      // Skip if in excluded paths
      if (filePath.includes('node_modules') || filePath.includes('out-tsc') || filePath.includes('/scripts/')) {
        continue;
      }

      diagnostics.push({
        file: filePath,
        line: line + 1,
        column: character + 1,
        code: diagnostic.code,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
        severity: diagnostic.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
      });
    }
  }

  return diagnostics;
}

// ============================================================================
// ESLint Node.js API Analysis
// ============================================================================

/**
 * ESLint's issues and the number of files it linted, which the totals use as the scanned-file
 * count.
 */
interface ESLintAnalysisResult {
  /** Every ESLint message outside the excluded paths, warnings included. */
  issues: ESLintIssue[];
  /** Linted files outside the excluded paths, with or without messages. */
  filesScanned: number;
}

/**
 * Lints `targetPaths`, or `src` and `test` when the list is empty, with the package's ESLint
 * config.
 *
 * Results whose path contains `node_modules`, `out-tsc`, `dist` or `/scripts/` are dropped. The
 * `dist` test is a plain substring match, so it also drops a file such as `src/distance.ts`. ESLint
 * throws for a target that matches no file, and that error ends the run.
 */
async function analyzeESLint(targetPaths: string[]): Promise<ESLintAnalysisResult> {
  const issues: ESLintIssue[] = [];

  const eslint = new ESLint({
    cwd: ROOT_DIR,
  });

  // Determine paths to lint (exclude scripts folder)
  const lintPaths = targetPaths.length > 0 ? targetPaths : ['src', 'test'];

  const results = await eslint.lintFiles(lintPaths);

  // Count all files scanned (excluding node_modules, etc.)
  let filesScanned = 0;

  for (const result of results) {
    // Skip excluded paths
    if (
      result.filePath.includes('node_modules') ||
      result.filePath.includes('out-tsc') ||
      result.filePath.includes('dist') ||
      result.filePath.includes('/scripts/')
    ) {
      continue;
    }

    filesScanned++;

    // Skip files with no issues for issue collection
    if (result.messages.length === 0) continue;

    for (const message of result.messages) {
      issues.push({
        file: result.filePath,
        line: message.line,
        column: message.column,
        ruleId: message.ruleId ?? 'unknown',
        message: message.message,
        severity: message.severity === 2 ? 'error' : 'warning',
        fix: message.fix,
      });
    }
  }

  return { issues, filesScanned };
}

// ============================================================================
// Issue Merging and Statistics
// ============================================================================

/**
 * Groups compiler diagnostics and ESLint messages by file path into one map. The compiler's files
 * enter the map first, which sets the repair order.
 */
function mergeIssues(
  tsDiagnostics: TypeScriptDiagnostic[],
  eslintIssues: ESLintIssue[]
): FileIssueMap {
  const map: FileIssueMap = new Map();

  // Add TypeScript diagnostics
  for (const diag of tsDiagnostics) {
    const existing = map.get(diag.file) ?? { typescript: [], eslint: [] };
    existing.typescript.push(diag);
    map.set(diag.file, existing);
  }

  // Add ESLint issues
  for (const issue of eslintIssues) {
    const existing = map.get(issue.file) ?? { typescript: [], eslint: [] };
    existing.eslint.push(issue);
    map.set(issue.file, existing);
  }

  return map;
}

/**
 * Computes the report totals from the merged issues. `totalFiles` is ESLint's scanned-file count,
 * because the compiler pass reports no count of its own.
 */
function calculateStatistics(issueMap: FileIssueMap, totalFiles: number): AnalysisResult {
  let tsErrors = 0;
  let tsWarnings = 0;
  let eslintErrors = 0;
  let eslintWarnings = 0;

  const violationCounts = new Map<string, number>();
  const fileIssueCounts: Array<{ file: string; count: number }> = [];

  for (const [file, issues] of issueMap) {
    const totalIssues = issues.typescript.length + issues.eslint.length;
    fileIssueCounts.push({ file, count: totalIssues });

    // Count TypeScript issues
    for (const diag of issues.typescript) {
      if (diag.severity === 'error') tsErrors++;
      else tsWarnings++;

      const key = `TS${diag.code}`;
      violationCounts.set(key, (violationCounts.get(key) ?? 0) + 1);
    }

    // Count ESLint issues
    for (const issue of issues.eslint) {
      if (issue.severity === 'error') eslintErrors++;
      else eslintWarnings++;

      violationCounts.set(issue.ruleId, (violationCounts.get(issue.ruleId) ?? 0) + 1);
    }
  }

  // Sort violations by count (descending) and take top 10
  const topViolations = Array.from(violationCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([rule, count]) => ({ rule, count }));

  // Sort files by issue count (descending)
  fileIssueCounts.sort((a, b) => b.count - a.count);

  return {
    filesScanned: totalFiles,
    filesWithIssues: issueMap.size,
    typescript: { errors: tsErrors, warnings: tsWarnings },
    eslint: { errors: eslintErrors, warnings: eslintWarnings },
    topViolations,
    filesByIssueCount: fileIssueCounts,
  };
}

// ============================================================================
// Reporting
// ============================================================================

/**
 * Prints the boxed analysis summary: the totals, the top rules and, except with `--quiet`, up to 15
 * files by issue count. Prints nothing with `--json`.
 */
function displayAnalysisReport(result: AnalysisResult, options: CliOptions): void {
  if (options.json) return; // Skip console output in JSON mode

  const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const width = 60;
  const line = '═'.repeat(width);
  const thinLine = '─'.repeat(width);

  // Helper for right-aligned numbers
  const numWidth = 8;
  const rAlign = (n: number | string) => String(n).padStart(numWidth);

  // Header with date fitting inside
  const title = 'Code Cleanup Analysis';
  const headerPad = width - title.length - timestamp.length - 2;
  const header = ` ${title}${' '.repeat(headerPad)}${timestamp} `;

  console.log(`
${CYAN}${line}${RESET}
${CYAN}${header}${RESET}
${CYAN}${line}${RESET}

 ${bold('Analysis Results')}
${dim(thinLine)}
 Files scanned:       ${highlight(rAlign(result.filesScanned.toLocaleString()))}
 Files with issues:   ${result.filesWithIssues > 0 ? errorColor(rAlign(result.filesWithIssues)) : success(rAlign('0'))}

 TypeScript errors:   ${result.typescript.errors > 0 ? errorColor(rAlign(result.typescript.errors)) : success(rAlign('0'))}
 TypeScript warnings: ${result.typescript.warnings > 0 ? warning(rAlign(result.typescript.warnings)) : success(rAlign('0'))}
 ESLint errors:       ${result.eslint.errors > 0 ? errorColor(rAlign(result.eslint.errors)) : success(rAlign('0'))}
 ESLint warnings:     ${result.eslint.warnings > 0 ? warning(rAlign(result.eslint.warnings)) : success(rAlign('0'))}
`);

  if (result.topViolations.length > 0) {
    console.log(` ${bold('Top violations:')}`);
    for (const { rule, count } of result.topViolations) {
      const paddedRule = rule.padEnd(width - numWidth - 4);
      console.log(`   ${dim(paddedRule)}${rAlign(count)}`);
    }
    console.log();
  }

  if (!options.quiet && result.filesByIssueCount.length > 0) {
    console.log(` ${bold('Files by issue count:')}`);
    const filesToShow = result.filesByIssueCount.slice(0, 15);
    const pathWidth = width - numWidth - 4;
    for (const { file, count } of filesToShow) {
      const relPath = path.relative(ROOT_DIR, file);
      const paddedPath = relPath.length > pathWidth ? '...' + relPath.slice(-(pathWidth - 3)) : relPath.padEnd(pathWidth);
      console.log(`   ${dim(paddedPath)}${rAlign(count)}`);
    }
    if (result.filesByIssueCount.length > 15) {
      console.log(`   ${dim(`... and ${result.filesByIssueCount.length - 15} more files`)}`);
    }
    console.log();
  }
}

/**
 * Prints the machine-readable report as one JSON document on stdout: the totals and, after a
 * repair, the repair counts and the unresolved files with relative paths.
 */
function displayJsonReport(
  analysisResult: AnalysisResult,
  repairResult?: RepairResult
): void {
  const report = {
    timestamp: new Date().toISOString(),
    analysis: {
      filesScanned: analysisResult.filesScanned,
      filesWithIssues: analysisResult.filesWithIssues,
      typescript: analysisResult.typescript,
      eslint: analysisResult.eslint,
      topViolations: analysisResult.topViolations,
    },
    repairs: repairResult
      ? {
          success: repairResult.success,
          partial: repairResult.partial,
          failed: repairResult.failed,
        }
      : undefined,
    unresolved: repairResult?.unresolved.map(({ file, issues }) => ({
      file: path.relative(ROOT_DIR, file),
      typescript: issues.typescript.length,
      eslint: issues.eslint.length,
    })),
  };

  console.log(JSON.stringify(report, null, 2));
}


// ============================================================================
// Code Style Guidance Loading
// ============================================================================

/**
 * Collects the project's fix guidance for each ESLint rule and TypeScript code in `issues`, for the
 * repair prompt.
 *
 * A rule maps to `code-style/linting-recommendations/<file>.md`, where the file name is the rule id
 * with its first `@` removed and its first `/` turned into `_`
 * (`@typescript-eslint/no-explicit-any` becomes `typescript-eslint_no-explicit-any.md`). A
 * TypeScript code maps to `code-style/typecheck-recommendations/TS<code>.md`; this package has no
 * such folder yet. A missing file is skipped without a message. Each guide is added once.
 */
function loadCodeStyleGuidance(issues: FileIssues): string {
  const guidanceLines: string[] = [];
  const loadedRules = new Set<string>();

  // Load ESLint rule guidance
  for (const issue of issues.eslint) {
    const ruleId = issue.ruleId;

    // Skip if already loaded
    if (loadedRules.has(ruleId)) continue;
    loadedRules.add(ruleId);

    // Convert rule ID to file path: @foo/bar-baz -> foo_bar-baz.md (strip @, replace /)
    const fileName = ruleId.replace('@', '').replace('/', '_') + '.md';
    const guidancePath = path.join(ROOT_DIR, 'code-style', 'linting-recommendations', fileName);

    if (fs.existsSync(guidancePath)) {
      const content = fs.readFileSync(guidancePath, 'utf-8');
      guidanceLines.push(`\n## Guidance for ${ruleId}\n${content}`);
    }
  }

  // Load TypeScript error guidance
  for (const diag of issues.typescript) {
    const code = `TS${diag.code}`;

    // Skip if already loaded
    if (loadedRules.has(code)) continue;
    loadedRules.add(code);

    const fileName = `${code}.md`;
    const guidancePath = path.join(
      ROOT_DIR,
      'code-style',
      'typecheck-recommendations',
      fileName
    );

    if (fs.existsSync(guidancePath)) {
      const content = fs.readFileSync(guidancePath, 'utf-8');
      guidanceLines.push(`\n## Guidance for ${code}\n${content}`);
    }
  }

  return guidanceLines.join('\n');
}

// ============================================================================
// Agent Repair Functions
// ============================================================================

/**
 * Splits text into lines of at most `width` characters at single spaces, for the verbose console
 * output. A word longer than `width` gets a line of its own and is not split; leading spaces are
 * lost.
 */
function wrapText(text: string, width: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (currentLine.length + word.length + 1 <= width) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

/**
 * Asks a Claude agent to fix the issues of one file without suppressions, then re-checks the file.
 *
 * The prompt forbids `eslint-disable`, `@ts-ignore` and `@ts-expect-error` and adds the matching
 * `code-style/` guidance. The agent runs in the working folder with the project's Claude Code
 * settings and, except in a dry run, with `bypassPermissions`: it can edit any file and run any
 * command without a prompt, and no time limit applies. When the agent ends, ESLint and the compiler
 * re-check this file only; success means that no message remains, warnings included.
 * `remainingIssues` holds what the permissive pass must still fix, or the original issues when the
 * agent call throws. `fileIndex` and `totalFiles` only label the console line.
 */
async function repairFileStrict(
  filePath: string,
  issues: FileIssues,
  options: CliOptions,
  fileIndex?: number,
  totalFiles?: number
): Promise<{ success: boolean; remainingIssues?: FileIssues }> {
  const relPath = path.relative(ROOT_DIR, filePath);
  const fileCounter = fileIndex !== undefined && totalFiles !== undefined
    ? `(${fileIndex + 1}/${totalFiles}) `
    : '';

  // Build issue description
  const issueDescriptions: string[] = [];

  for (const diag of issues.typescript) {
    issueDescriptions.push(
      `- TypeScript TS${diag.code} at line ${diag.line}: ${diag.message}`
    );
  }

  for (const issue of issues.eslint) {
    issueDescriptions.push(
      `- ESLint ${issue.ruleId} at line ${issue.line}: ${issue.message}`
    );
  }

  // Load code style guidance
  const guidance = loadCodeStyleGuidance(issues);

  // TypeScript typecheck command
  const typecheckCmd = `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "${relPath.replace(/\./g, '\\.')}" || echo "No TypeScript errors"`;

  const prompt = `Fix the following issues in ${relPath}:

${issueDescriptions.join('\n\n')}

CONSTRAINTS:
- Do NOT use eslint-disable comments
- Do NOT use @ts-ignore or @ts-expect-error
- Fix the root cause of each issue
- Maintain the existing code style
- Keep changes minimal and focused

VALIDATION:
After making your edits, run these commands to verify your fixes:
  npx eslint ${relPath} --format stylish
  ${typecheckCmd}
If any issues remain, fix them before finishing.

${guidance ? `PROJECT-SPECIFIC GUIDANCE:\n${guidance}` : ''}

Read the file, make the necessary fixes, validate with linting, and fix any remaining issues.`;

  if (options.verbose) {
    console.log(`\n${cyan('─')} ${fileCounter}${bold(relPath)} ${dim('(strict)')}`);
    console.log(dim('  Prompt:'));
    for (const line of prompt.split('\n')) {
      if (line.trim() === '') {
        console.log(''); // Preserve blank lines
      } else {
        const wrapped = wrapText(line, 120);
        for (const wline of wrapped) {
          console.log(dim(`    ${wline}`));
        }
      }
    }
  }

  try {
    const stream = query({
      prompt,
      options: {
        cwd: ROOT_DIR,
        // All tools enabled without permission prompts
        permissionMode: options.dryRun ? 'default' : 'bypassPermissions',
        settingSources: ['project'],
      },
    });

    let toolCallCount = 0;
    let toolErrorCount = 0;
    let editCount = 0;
    const pendingToolCalls = new Map<string, { name: string; startTime: number }>();

    for await (const item of stream) {
      if (options.verbose) {
        if (item.type === 'assistant') {
          for (const block of item.message.content) {
            if (block.type === 'text') {
              // Wrap and display agent text in white, preserving blank lines
              for (const line of block.text.split('\n')) {
                if (line.trim() === '') {
                  console.log(''); // Preserve blank lines
                } else {
                  const wrapped = wrapText(line, 120);
                  for (const wline of wrapped) {
                    console.log(`    ${wline}`);
                  }
                }
              }
            } else if (block.type === 'tool_use') {
              toolCallCount++;
              pendingToolCalls.set(block.id, { name: block.name, startTime: Date.now() });
              const input = block.input as Record<string, unknown>;
              console.log(''); // Space before tool
              if (block.name === 'Read') {
                const fp = path.relative(ROOT_DIR, String(input.file_path || ''));
                console.log(cyan(`    ▶ Read: ${fp}`));
              } else if (block.name === 'Edit') {
                editCount++;
                const fp = path.relative(ROOT_DIR, String(input.file_path || ''));
                const oldStr = String(input.old_string || '');
                const newStr = String(input.new_string || '');
                const oldPreview = oldStr.slice(0, 50).replace(/\n/g, '↵');
                const newPreview = newStr.slice(0, 50).replace(/\n/g, '↵');
                console.log(cyan(`    ▶ Edit: ${fp}`));
                console.log(dim(`      - "${oldPreview}${oldStr.length > 50 ? '...' : ''}"`));
                console.log(dim(`      + "${newPreview}${newStr.length > 50 ? '...' : ''}"`));
              } else if (block.name === 'Bash') {
                const cmd = String(input.command || '');
                const cmdPreview = cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd;
                console.log(cyan(`    ▶ Bash: ${cmdPreview}`));
              } else if (block.name === 'Glob') {
                const pattern = String(input.pattern || '');
                const globPath = input.path ? path.relative(ROOT_DIR, String(input.path)) : '.';
                console.log(cyan(`    ▶ Glob: ${pattern} in ${globPath}`));
              } else if (block.name === 'Grep') {
                const pattern = String(input.pattern || '');
                const grepPath = input.path ? path.relative(ROOT_DIR, String(input.path)) : '.';
                console.log(cyan(`    ▶ Grep: "${pattern}" in ${grepPath}`));
              } else if (block.name === 'Write') {
                const fp = path.relative(ROOT_DIR, String(input.file_path || ''));
                console.log(cyan(`    ▶ Write: ${fp}`));
              } else if (block.name === 'Task') {
                const desc = String(input.description || input.prompt || '').slice(0, 60);
                console.log(cyan(`    ▶ Task: ${desc}...`));
              } else {
                // Any other tool - just show the name
                console.log(cyan(`    ▶ ${block.name}`));
              }
            }
          }
        } else if (item.type === 'user' && item.tool_use_result !== undefined) {
          // Tool result received - clear from pending
          const toolId = (item as { tool_use_id?: string }).tool_use_id;
          if (toolId) {
            pendingToolCalls.delete(toolId);
          }

          // Check for actual tool errors (not just strings containing "error")
          const result = item.tool_use_result;
          const isError = typeof result === 'object' && result !== null &&
            ('is_error' in result || 'error' in result);
          if (isError) {
            toolErrorCount++;
            const resultStr = JSON.stringify(result);
            const errorMatch = resultStr.match(/"message"\s*:\s*"([^"]+)"/);
            const errorMsg = errorMatch ? errorMatch[1] : resultStr.slice(0, 80);
            console.log(errorColor(`      ✗ ${errorMsg}`));
          }
        }
      }
    }

    if (options.verbose) {
      console.log('');
      console.log(dim(`    [${toolCallCount} tools, ${editCount} edits, ${toolErrorCount} errors]`));
    }

    // Re-analyze the file to check if issues are resolved
    if (!options.dryRun) {
      // Re-run ESLint
      const eslint = new ESLint({ cwd: ROOT_DIR });
      const results = await eslint.lintFiles([filePath]);
      const remainingEslintIssues = results[0]?.messages ?? [];

      // Re-run TypeScript checking for this file
      const remainingTsIssues: TypeScriptDiagnostic[] = [];
      try {
        const tsDiagnostics = analyzeTypeScript([relPath]);
        for (const diag of tsDiagnostics) {
          if (diag.file === filePath) {
            remainingTsIssues.push(diag);
          }
        }
      } catch {
        // TypeScript check failed, continue with ESLint results only
      }

      const totalRemaining = remainingEslintIssues.length + remainingTsIssues.length;

      if (totalRemaining === 0) {
        console.log(success(`  ✓ ${fileCounter}${relPath}: Fixed`));
        return { success: true };
      }

      // Build remaining issues
      const remaining: FileIssues = {
        typescript: remainingTsIssues,
        eslint: remainingEslintIssues.map((m) => ({
          file: filePath,
          line: m.line,
          column: m.column,
          ruleId: m.ruleId ?? 'unknown',
          message: m.message,
          severity: m.severity === 2 ? 'error' : 'warning',
          fix: m.fix,
        })),
      };

      const tsCount = remainingTsIssues.length;
      const eslintCount = remainingEslintIssues.length;
      const countMsg = tsCount > 0 && eslintCount > 0
        ? `${tsCount} TS + ${eslintCount} ESLint`
        : tsCount > 0 ? `${tsCount} TS` : `${eslintCount} ESLint`;
      console.log(warning(`  ⚠ ${fileCounter}${relPath}: ${countMsg} issues remain`));
      return { success: false, remainingIssues: remaining };
    }

    console.log(success(`  ✓ ${fileCounter}${relPath}: Fixed (dry-run)`));
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.log(errorColor(`  ✗ ${fileCounter}${relPath}: ${errorMsg.slice(0, 50)}`));
    return { success: false, remainingIssues: issues };
  }
}

/**
 * The second attempt at a file that the strict pass left unfixed: the same agent run, but the
 * prompt allows `eslint-disable` and `@ts-expect-error` comments that give a reason.
 *
 * It re-checks the file the same way but returns no remaining issues, so the caller keeps the list
 * of the strict pass. The permission and time-limit notes of `repairFileStrict` apply here too.
 */
async function repairFilePermissive(
  filePath: string,
  issues: FileIssues,
  options: CliOptions,
  fileIndex?: number,
  totalFiles?: number
): Promise<{ success: boolean }> {
  const relPath = path.relative(ROOT_DIR, filePath);
  const fileCounter = fileIndex !== undefined && totalFiles !== undefined
    ? `(${fileIndex + 1}/${totalFiles}) `
    : '';

  // Build issue description
  const issueDescriptions: string[] = [];

  for (const diag of issues.typescript) {
    issueDescriptions.push(
      `- TypeScript TS${diag.code} at line ${diag.line}: ${diag.message}`
    );
  }

  for (const issue of issues.eslint) {
    issueDescriptions.push(
      `- ESLint ${issue.ruleId} at line ${issue.line}: ${issue.message}`
    );
  }

  // Still load guidance - we want the model to try proper fixes first
  const guidance = loadCodeStyleGuidance(issues);

  // TypeScript typecheck command
  const typecheckCmd = `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "${relPath.replace(/\./g, '\\.')}" || echo "No TypeScript errors"`;

  const prompt = `Fix the following remaining issues in ${relPath}:

${issueDescriptions.join('\n\n')}

CONSTRAINTS (Permissive Pass):
- First, try to fix issues properly using the guidance below
- If you cannot fix an issue properly, you MAY use eslint-disable comments
- If you must use @ts-expect-error, include a justification comment
- Every disable comment MUST include a reason explaining why the fix is not possible
- Zero issues must remain after this pass

Example of acceptable disable:
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Third-party API returns untyped data

VALIDATION:
After making your edits, run these commands to verify your fixes:
  npx eslint ${relPath} --format stylish
  ${typecheckCmd}
If any issues remain, fix them before finishing.

${guidance ? `PROJECT-SPECIFIC GUIDANCE:\n${guidance}` : ''}

Read the file, make the necessary fixes, validate with linting and type checking, and fix any remaining issues.`;

  if (options.verbose) {
    console.log(`\n${warning('─')} ${fileCounter}${bold(relPath)} ${warning('(permissive)')}`);
    console.log(dim('  Prompt:'));
    for (const line of prompt.split('\n')) {
      if (line.trim() === '') {
        console.log(''); // Preserve blank lines
      } else {
        const wrapped = wrapText(line, 120);
        for (const wline of wrapped) {
          console.log(dim(`    ${wline}`));
        }
      }
    }
  }

  try {
    const stream = query({
      prompt,
      options: {
        cwd: ROOT_DIR,
        // All tools enabled without permission prompts
        permissionMode: options.dryRun ? 'default' : 'bypassPermissions',
        settingSources: ['project'],
      },
    });

    let toolCallCount = 0;
    let toolErrorCount = 0;
    let editCount = 0;

    for await (const item of stream) {
      if (options.verbose) {
        if (item.type === 'assistant') {
          for (const block of item.message.content) {
            if (block.type === 'text') {
              // Wrap and display agent text in white, preserving blank lines
              for (const line of block.text.split('\n')) {
                if (line.trim() === '') {
                  console.log(''); // Preserve blank lines
                } else {
                  const wrapped = wrapText(line, 120);
                  for (const wline of wrapped) {
                    console.log(`    ${wline}`);
                  }
                }
              }
            } else if (block.type === 'tool_use') {
              toolCallCount++;
              const input = block.input as Record<string, unknown>;
              console.log(''); // Space before tool
              if (block.name === 'Read') {
                const fp = path.relative(ROOT_DIR, String(input.file_path || ''));
                console.log(cyan(`    ▶ Read: ${fp}`));
              } else if (block.name === 'Edit') {
                editCount++;
                const fp = path.relative(ROOT_DIR, String(input.file_path || ''));
                const oldStr = String(input.old_string || '');
                const newStr = String(input.new_string || '');
                const oldPreview = oldStr.slice(0, 50).replace(/\n/g, '↵');
                const newPreview = newStr.slice(0, 50).replace(/\n/g, '↵');
                console.log(cyan(`    ▶ Edit: ${fp}`));
                console.log(dim(`      - "${oldPreview}${oldStr.length > 50 ? '...' : ''}"`));
                console.log(dim(`      + "${newPreview}${newStr.length > 50 ? '...' : ''}"`));
              } else if (block.name === 'Bash') {
                const cmd = String(input.command || '');
                const cmdPreview = cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd;
                console.log(cyan(`    ▶ Bash: ${cmdPreview}`));
              } else if (block.name === 'Glob') {
                const pattern = String(input.pattern || '');
                const globPath = input.path ? path.relative(ROOT_DIR, String(input.path)) : '.';
                console.log(cyan(`    ▶ Glob: ${pattern} in ${globPath}`));
              } else if (block.name === 'Grep') {
                const pattern = String(input.pattern || '');
                const grepPath = input.path ? path.relative(ROOT_DIR, String(input.path)) : '.';
                console.log(cyan(`    ▶ Grep: "${pattern}" in ${grepPath}`));
              } else if (block.name === 'Write') {
                const fp = path.relative(ROOT_DIR, String(input.file_path || ''));
                console.log(cyan(`    ▶ Write: ${fp}`));
              } else if (block.name === 'Task') {
                const desc = String(input.description || input.prompt || '').slice(0, 60);
                console.log(cyan(`    ▶ Task: ${desc}...`));
              } else {
                // Any other tool - just show the name
                console.log(cyan(`    ▶ ${block.name}`));
              }
            }
          }
        } else if (item.type === 'user' && item.tool_use_result !== undefined) {
          // Check for actual tool errors (not just strings containing "error")
          const result = item.tool_use_result;
          const isError = typeof result === 'object' && result !== null &&
            ('is_error' in result || 'error' in result);
          if (isError) {
            toolErrorCount++;
            const resultStr = JSON.stringify(result);
            const errorMatch = resultStr.match(/"message"\s*:\s*"([^"]+)"/);
            const errorMsg = errorMatch ? errorMatch[1] : resultStr.slice(0, 80);
            console.log(errorColor(`      ✗ ${errorMsg}`));
          }
        }
      }
    }

    if (options.verbose) {
      console.log('');
      console.log(dim(`    [${toolCallCount} tools, ${editCount} edits, ${toolErrorCount} errors]`));
    }

    // Re-check with ESLint and TypeScript
    if (!options.dryRun) {
      // Re-run ESLint
      const eslint = new ESLint({ cwd: ROOT_DIR });
      const results = await eslint.lintFiles([filePath]);
      const remainingEslint = results[0]?.messages.length ?? 0;

      // Re-run TypeScript checking for this file
      let remainingTs = 0;
      try {
        const tsDiagnostics = analyzeTypeScript([relPath]);
        remainingTs = tsDiagnostics.filter((d) => d.file === filePath).length;
      } catch {
        // TypeScript check failed, continue with ESLint results only
      }

      const totalRemaining = remainingEslint + remainingTs;

      if (totalRemaining === 0) {
        console.log(warning(`  ⚠ ${fileCounter}${relPath}: Fixed (permissive pass)`));
        return { success: true };
      }

      const countMsg = remainingTs > 0 && remainingEslint > 0
        ? `${remainingTs} TS + ${remainingEslint} ESLint`
        : remainingTs > 0 ? `${remainingTs} TS` : `${remainingEslint} ESLint`;
      console.log(errorColor(`  ✗ ${fileCounter}${relPath}: ${countMsg} issues remain after permissive pass`));
      return { success: false };
    }

    console.log(warning(`  ⚠ ${fileCounter}${relPath}: Fixed (permissive pass, dry-run)`));
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.log(errorColor(`  ✗ ${fileCounter}${relPath}: ${errorMsg.slice(0, 80)}`));
    return { success: false };
  }
}

// ============================================================================
// Main Repair Loop
// ============================================================================

/**
 * Repairs each file of `issueMap` in turn: the strict pass, then the permissive pass when the
 * strict pass leaves issues.
 *
 * Files are repaired one at a time. `--max-files` caps the count, and `--fail-fast` ends this
 * iteration at the first file that both passes leave unfixed. The config argument is ignored. A
 * progress bar shows unless `--quiet`, `--json` or `--verbose` is set.
 */
async function runRepairLoop(
  issueMap: FileIssueMap,
  options: CliOptions,
  _config: CleanConfig
): Promise<RepairResult> {
  const result: RepairResult = {
    success: 0,
    partial: 0,
    failed: 0,
    unresolved: [],
  };

  const files = Array.from(issueMap.entries());
  const filesToProcess = options.maxFiles ? files.slice(0, options.maxFiles) : files;

  // Create progress bar
  const progressBar = new cliProgress.SingleBar(
    {
      format: ` [${CYAN}{bar}${RESET}] {percentage}% | {value}/{total} files | ${GREEN}✓ {success}${RESET}  ${YELLOW}⚠ {partial}${RESET}  ${RED}✗ {failed}${RESET}`,
      barCompleteChar: '█',
      barIncompleteChar: '░',
      hideCursor: true,
    },
    cliProgress.Presets.shades_classic
  );

  // Don't use progress bar in verbose mode - it conflicts with output
  const useProgressBar = !options.quiet && !options.json && !options.verbose;

  if (useProgressBar) {
    console.log(`\n ${bold('Repair Progress')}`);
    console.log(dim('───────────────────────────────────────────────────────────'));
    progressBar.start(filesToProcess.length, 0, {
      success: 0,
      partial: 0,
      failed: 0,
    });
  }

  for (let i = 0; i < filesToProcess.length; i++) {
    const [filePath, issues] = filesToProcess[i];

    if (useProgressBar) {
      progressBar.update(i, {
        success: result.success,
        partial: result.partial,
        failed: result.failed,
      });
    }

    // Step 1: Try strict repair (no suppressions allowed)
    const strictResult = await repairFileStrict(filePath, issues, options, i, filesToProcess.length);

    if (strictResult.success) {
      result.success++;
      continue;
    }

    // Step 2: Strict failed - try permissive repair (suppressions allowed)
    const remainingIssues = strictResult.remainingIssues ?? issues;
    const permissiveResult = await repairFilePermissive(filePath, remainingIssues, options, i, filesToProcess.length);

    if (permissiveResult.success) {
      result.partial++;
      continue;
    }

    // Step 3: Both failed - mark as unresolved
    result.failed++;
    result.unresolved.push({ file: filePath, issues: remainingIssues });

    if (options.failFast) {
      if (useProgressBar) {
        progressBar.stop();
      }
      const relPath = path.relative(ROOT_DIR, filePath);
      console.log(errorColor(`\nFail-fast: stopping after ${relPath}`));
      break;
    }
  }

  if (useProgressBar) {
    progressBar.update(filesToProcess.length, {
      success: result.success,
      partial: result.partial,
      failed: result.failed,
    });
    progressBar.stop();
    console.log();
  }

  return result;
}

// ============================================================================
// Report Writing
// ============================================================================

/**
 * Writes the report files to `reportDir`, which it creates when needed, over any earlier files.
 *
 * `analysis.json` is always written; `repairs.json` after a repair, and `unresolved.json` when some
 * files stay unfixed. `analysis.json` and `repairs.json` hold absolute paths; `unresolved.json`
 * holds paths relative to the working folder.
 */
async function writeReport(
  reportDir: string,
  analysisResult: AnalysisResult,
  repairResult?: RepairResult
): Promise<void> {
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  // Write analysis report
  fs.writeFileSync(
    path.join(reportDir, 'analysis.json'),
    JSON.stringify(analysisResult, null, 2)
  );

  if (repairResult) {
    // Write repair report
    fs.writeFileSync(
      path.join(reportDir, 'repairs.json'),
      JSON.stringify(repairResult, null, 2)
    );

    // Write unresolved issues
    if (repairResult.unresolved.length > 0) {
      const unresolvedReport = repairResult.unresolved.map(({ file, issues }) => ({
        file: path.relative(ROOT_DIR, file),
        typescript: issues.typescript,
        eslint: issues.eslint.map((i) => ({
          line: i.line,
          ruleId: i.ruleId,
          message: i.message,
        })),
      }));

      fs.writeFileSync(
        path.join(reportDir, 'unresolved.json'),
        JSON.stringify(unresolvedReport, null, 2)
      );
    }
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * The CLI: parses the flags, analyses, then repairs in up to three global iterations, each followed
 * by a fresh analysis.
 *
 * The process exits with code 0 after an analysis-only run or when no issue exists, even if the
 * analysis found issues. After repairs it exits with code 1 when the last iteration left an unfixed
 * file, and with code 0 otherwise, even when the final analysis still finds issues. A thrown error
 * exits with code 1.
 *
 * Every analysis after the first checks the default scope (`src` and `test`), not the paths given
 * on the command line, so a targeted run can go on to repair other files. When a dry run writes
 * nothing, the same issues remain, so each file goes to the agent once in each of the three
 * iterations.
 */
async function main(): Promise<void> {
  // Parse CLI arguments
  program
    .name('clean')
    .description('Automated code cleanup using TypeScript, ESLint, and Claude Agent SDK')
    .argument('[paths...]', 'Specific paths to analyze/repair')
    .option('--analyze-only', 'Analysis only, no repairs', false)
    .option('-v, --verbose', 'Show agent prompts and tool calls', false)
    .option('-q, --quiet', 'Statistics only', false)
    .option('--dry-run', 'Preview changes without writing', false)
    .option('--max-files <n>', 'Limit files processed', parseInt)
    .option('--fail-fast', 'Stop on first unresolved file', false)
    .option('--json', 'JSON output for CI integration', false)
    .option('--report <dir>', 'Write detailed report files')
    .option('--timeout <ms>', 'Timeout per file in ms', parseInt, 600_000)
    .option('--debug', 'Enable debug logging', false)
    .parse();

  const options: CliOptions = program.opts();
  const targetPaths = program.args;

  // Load configuration
  const config = await loadConfig();

  // Display banner
  if (!options.quiet && !options.json) {
    if (options.dryRun) {
      const line = '═'.repeat(50);
      console.log(`
${YELLOW}${line}${RESET}
${YELLOW}${BOLD}  DRY RUN MODE - No changes will be written  ${RESET}
${YELLOW}${line}${RESET}
`);
    }

    console.log(info('Starting code analysis...'));
  }

  // Phase 1: Analysis
  if (!options.quiet && !options.json) {
    console.log(dim('  → Running TypeScript compiler...'));
  }
  const tsDiagnostics = analyzeTypeScript(targetPaths);

  if (!options.quiet && !options.json) {
    console.log(dim('  → Running ESLint...'));
  }
  const eslintResult = await analyzeESLint(targetPaths);

  // Merge results
  const issueMap = mergeIssues(tsDiagnostics, eslintResult.issues);

  // Calculate statistics using actual file count from ESLint
  const totalFiles = eslintResult.filesScanned;
  const analysisResult = calculateStatistics(issueMap, totalFiles);

  // Display analysis report
  displayAnalysisReport(analysisResult, options);

  // If analyze-only mode, stop here
  if (options.analyzeOnly || issueMap.size === 0) {
    if (options.json) {
      displayJsonReport(analysisResult);
    }

    if (options.report) {
      await writeReport(options.report, analysisResult);
      if (!options.quiet && !options.json) {
        console.log(success(`Report written to ${options.report}`));
      }
    }

    if (issueMap.size === 0) {
      if (!options.quiet && !options.json) {
        console.log(success('\n✓ No issues found!'));
      }
    }

    process.exit(0);
  }

  // Phase 2: Repair with global iteration
  const maxGlobalIterations = 3;
  let globalIteration = 0;
  let currentIssueMap = issueMap;
  const repairResult: RepairResult = { success: 0, partial: 0, failed: 0, unresolved: [] };

  while (globalIteration < maxGlobalIterations) {
    globalIteration++;

    if (globalIteration > 1 && !options.quiet && !options.json) {
      console.log();
      console.log(highlight(`═══ Global Iteration ${globalIteration}/${maxGlobalIterations} ═══`));
      console.log(dim('  Re-analyzing after previous repairs...'));
    }

    // Run repair on current issues
    const iterationResult = await runRepairLoop(currentIssueMap, options, config);

    // Accumulate results
    repairResult.success += iterationResult.success;
    repairResult.partial += iterationResult.partial;
    repairResult.failed = iterationResult.failed; // Only count final failed
    repairResult.unresolved = iterationResult.unresolved;

    // Re-run analysis to check for any remaining or new issues
    if (!options.quiet && !options.json && globalIteration < maxGlobalIterations) {
      console.log(dim('\n  → Re-running analysis to check for remaining issues...'));
    }

    const newTsDiagnostics = analyzeTypeScript([]);
    const newEslintResult = await analyzeESLint([]);
    const newIssueMap = mergeIssues(newTsDiagnostics, newEslintResult.issues);

    if (newIssueMap.size === 0) {
      // All issues resolved
      if (!options.quiet && !options.json && globalIteration > 1) {
        console.log(success('  ✓ All issues resolved!'));
      }
      repairResult.failed = 0;
      repairResult.unresolved = [];
      break;
    }

    // Check if we should continue
    if (globalIteration >= maxGlobalIterations) {
      if (!options.quiet && !options.json) {
        console.log(warning(`\n  ⚠ Max global iterations (${maxGlobalIterations}) reached with ${newIssueMap.size} files still having issues`));
      }
      break;
    }

    // Continue with remaining issues
    currentIssueMap = newIssueMap;
    if (!options.quiet && !options.json) {
      console.log(warning(`  → ${newIssueMap.size} files still have issues, starting iteration ${globalIteration + 1}...`));
    }
  }

  // Display final results
  if (!options.quiet && !options.json) {
    console.log();
    console.log(` ${bold('Final Results')}`);
    console.log(dim('───────────────────────────────────────────────────────────'));
    console.log(`   ${success(`✓ ${repairResult.success} files fixed completely`)}`);
    if (repairResult.partial > 0) {
      console.log(`   ${warning(`⚠ ${repairResult.partial} files fixed (permissive pass)`)}`);
    }
    if (repairResult.failed > 0) {
      console.log(`   ${errorColor(`✗ ${repairResult.failed} files could not be fixed`)}`);
    }
    if (globalIteration > 1) {
      console.log(dim(`   (completed in ${globalIteration} global iteration${globalIteration > 1 ? 's' : ''})`));
    }
    console.log();
  }

  if (options.json) {
    displayJsonReport(analysisResult, repairResult);
  }

  if (options.report) {
    await writeReport(options.report, analysisResult, repairResult);
    if (!options.quiet && !options.json) {
      console.log(success(`Report written to ${options.report}`));
    }
  }

  // Exit with error code if there are unresolved issues
  if (repairResult.failed > 0) {
    process.exit(1);
  }

  process.exit(0);
}

// Run main
main().catch((error) => {
  console.error(errorColor(`Fatal error: ${error}`));
  process.exit(1);
});
