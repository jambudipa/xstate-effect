#!/usr/bin/env tsx
/**
 * Code Cleanup Script (clean.ts)
 *
 * An automated code cleanup tool that identifies TypeScript and ESLint issues
 * across the monorepo and repairs them using the Claude Agent SDK.
 *
 * Usage:
 *   npx tsx scripts/clean.ts                    # Full repo analysis and repair
 *   npx tsx scripts/clean.ts --analyze-only    # Analysis only (no repairs)
 *   npx tsx scripts/clean.ts apps/api libs/database  # Target specific paths
 *   npx tsx scripts/clean.ts --verbose         # Show agent prompts and tool calls
 *   npx tsx scripts/clean.ts --quiet           # Statistics only
 *   npx tsx scripts/clean.ts --dry-run         # Preview changes without writing
 *   npx tsx scripts/clean.ts --max-files 10    # Limit files processed
 *   npx tsx scripts/clean.ts --fail-fast       # Stop on first unresolved file
 *   npx tsx scripts/clean.ts --json            # JSON output for CI integration
 */

import * as ts from 'typescript';
import { ESLint, Rule } from 'eslint';
import { query } from '@anthropic-ai/claude-agent-sdk';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { program } from 'commander';
import cliProgress from 'cli-progress';

// Terminal color utilities (reusing existing patterns)
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const MAGENTA = '\x1b[35m';

const success = (text: string): string => `${GREEN}${text}${RESET}`;
const warning = (text: string): string => `${YELLOW}${text}${RESET}`;
const errorColor = (text: string): string => `${RED}${text}${RESET}`;
const info = (text: string): string => `${BLUE}${text}${RESET}`;
const highlight = (text: string): string => `${BOLD}${CYAN}${text}${RESET}`;
const dim = (text: string): string => `${DIM}${text}${RESET}`;
const bold = (text: string): string => `${BOLD}${text}${RESET}`;
const _magenta = (text: string): string => `${MAGENTA}${text}${RESET}`;
const cyan = (text: string): string => `${CYAN}${text}${RESET}`;

// ============================================================================
// Types
// ============================================================================

interface TypeScriptDiagnostic {
  file: string;
  line: number;
  column: number;
  code: number;
  message: string;
  severity: 'error' | 'warning';
}

interface ESLintIssue {
  file: string;
  line: number;
  column: number;
  ruleId: string;
  message: string;
  severity: 'error' | 'warning';
  fix?: Rule.Fix;
}

interface FileIssues {
  typescript: TypeScriptDiagnostic[];
  eslint: ESLintIssue[];
}

type FileIssueMap = Map<string, FileIssues>;

interface AnalysisResult {
  filesScanned: number;
  filesWithIssues: number;
  typescript: {
    errors: number;
    warnings: number;
  };
  eslint: {
    errors: number;
    warnings: number;
  };
  topViolations: Array<{ rule: string; count: number }>;
  filesByIssueCount: Array<{ file: string; count: number }>;
}

interface RepairResult {
  success: number;
  partial: number;
  failed: number;
  unresolved: Array<{ file: string; issues: FileIssues }>;
}

interface CleanConfig {
  exclude?: string[];
  maxConcurrentAgents?: number;
  agentModel?: string;
  timeoutPerFile?: number;
}

interface CliOptions {
  analyzeOnly: boolean;
  verbose: boolean;
  quiet: boolean;
  dryRun: boolean;
  maxFiles?: number;
  failFast: boolean;
  json: boolean;
  report?: string;
  timeout: number;
  debug: boolean;
}

// ============================================================================
// Configuration
// ============================================================================

const ROOT_DIR = process.cwd();

const DEFAULT_CONFIG: CleanConfig = {
  exclude: ['**/node_modules/**', '**/dist/**', '**/out-tsc/**', '**/.nx/**', '**/tmp/**'],
  maxConcurrentAgents: 1,
  agentModel: 'claude-opus-4-5-20251101',
  timeoutPerFile: 600_000, // 10 minutes
};

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

interface ESLintAnalysisResult {
  issues: ESLintIssue[];
  filesScanned: number;
}

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

// Wrap text at specified width
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
