/**
 * The pure logic of the cleanup CLI (`clean.ts`): its issue types, the config and its merge, the
 * parse of its integer flags, the path filter, the output channels, the repair pool and the
 * global repair iterations.
 *
 * It imports only `node:path`, so the port test `test/scripts.test.ts` imports it without the
 * Agent SDK, ESLint, the compiler or commander. It never loads `clean.config.ts`: that dynamic
 * import stays in `clean.ts`, which CONF-8 allows only in a module that no test reaches.
 */

import * as path from 'node:path';

// ============================================================================
// Types
// ============================================================================

/**
 * One compiler diagnostic that `analyzeTypeScript` kept, in the form the repair prompt and the
 * reports use.
 */
export interface TypeScriptDiagnostic {
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
export interface ESLintIssue {
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
   * ESLint's autofix (its `Rule.Fix` shape), when the rule offers one. Nothing applies it: the
   * prompt leaves it out, and only `repairs.json` carries it.
   */
  fix?: { range: [number, number]; text: string };
}

/** All issues of one file, split by source. The repair prompt lists both kinds. */
export interface FileIssues {
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
export type FileIssueMap = Map<string, FileIssues>;

/** The counts of the repair passes, and the files they could not fix. */
export interface RepairResult {
  /** Files that the strict pass fixed, with no suppression comment. */
  success: number;
  /**
   * Files that only the permissive pass fixed; they may now hold suppression comments with a
   * reason.
   */
  partial: number;
  /**
   * Files that neither pass fixed. `repairUntilClean` keeps the count of the last global
   * iteration, not a sum.
   */
  failed: number;
  /**
   * The unfixed files, each with the issues that the strict pass left. The permissive pass reports
   * no list, so these can be out of date.
   */
  unresolved: Array<{ file: string; issues: FileIssues }>;
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * The settings that `clean.config.ts` can override: its default export, merged over
 * `DEFAULT_CONFIG`. `resolveSettings` turns them into the `Settings` of a run.
 */
export interface CleanConfig {
  /**
   * Glob patterns of paths to skip, relative to the working folder (`isExcludedPath`). A list here
   * replaces the default list; `node_modules` and `scripts` folders stay skipped.
   */
  exclude?: string[];
  /**
   * The number of files repaired at once (`runPool`), each by its own agent. Agents that run at
   * once may edit the same file, and each re-check type-checks the whole program; 1 by default.
   */
  maxConcurrentAgents?: number;
  /** Model id of the repair agent (`agentOptions`); without one, the SDK's default model. */
  agentModel?: string;
  /**
   * Time limit of one agent run, in milliseconds (`withTimeout`); `--timeout` replaces it. Each
   * file gets up to two runs, the strict and the permissive pass.
   */
  timeoutPerFile?: number;
}

/** The time limit of one agent run when neither `--timeout` nor the config gives one: 10 minutes. */
const DEFAULT_TIMEOUT_PER_FILE = 600_000;

/**
 * The settings used when no `clean.config.ts` exists or it fails to load. It names no
 * `agentModel`, so the agent keeps the SDK's default model.
 */
export const DEFAULT_CONFIG: CleanConfig = {
  exclude: ['**/node_modules/**', '**/dist/**', '**/out-tsc/**', '**/.nx/**', '**/tmp/**'],
  maxConcurrentAgents: 1,
  timeoutPerFile: DEFAULT_TIMEOUT_PER_FILE,
};

/**
 * Merges the default export of a loaded `clean.config.ts` module over `DEFAULT_CONFIG`, field by
 * field: a field of the config replaces the default whole (an `exclude` list replaces the default
 * list). A module with no default export gives the defaults.
 */
export function mergeConfig(loaded: { default?: CleanConfig }): CleanConfig {
  return { ...DEFAULT_CONFIG, ...loaded.default };
}

/** The settings of one run, from `resolveSettings`. */
export interface Settings {
  /** Glob patterns of paths to skip, relative to the working folder. */
  exclude: ReadonlyArray<string>;
  /** The number of agents to run at once: a whole number of at least 1. */
  maxConcurrentAgents: number;
  /** Model id of the repair agent; `undefined` keeps the SDK's default model. */
  agentModel: string | undefined;
  /** Time limit of one agent run, in milliseconds. */
  timeoutPerFile: number;
}

/** True for a whole number of at least 1. */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/**
 * The settings of a run: the merged config, with `--timeout` (when given) over `timeoutPerFile`.
 *
 * A field of the config with a value of the wrong kind gives the default: an `exclude` that is no
 * list gives the default list (strings only are kept from a list), a `maxConcurrentAgents` or
 * `timeoutPerFile` that is no whole number of at least 1 gives 1 or ten minutes, and an empty or
 * missing `agentModel` gives the SDK's default model.
 */
export function resolveSettings(config: CleanConfig, flags: { timeout?: number | undefined }): Settings {
  return {
    exclude: Array.isArray(config.exclude)
      ? config.exclude.filter((pattern): pattern is string => typeof pattern === 'string')
      : [...(DEFAULT_CONFIG.exclude ?? [])],
    maxConcurrentAgents: isCount(config.maxConcurrentAgents) ? config.maxConcurrentAgents : 1,
    agentModel: typeof config.agentModel === 'string' && config.agentModel !== '' ? config.agentModel : undefined,
    timeoutPerFile: flags.timeout ?? (isCount(config.timeoutPerFile) ? config.timeoutPerFile : DEFAULT_TIMEOUT_PER_FILE),
  };
}

// ============================================================================
// Agent runs
// ============================================================================

/**
 * The options of one repair-agent run, in the shape that `query` of the Claude Agent SDK takes
 * (its `Options`).
 */
export interface AgentRunOptions {
  /** The folder the agent starts in: the working folder. */
  cwd: string;
  /**
   * `dontAsk`: no prompt, and every tool outside `allowedTools` is denied; `default` in a dry
   * run. Never `bypassPermissions`, which would let the agent run any command.
   */
  permissionMode: 'default' | 'dontAsk';
  /** The tools the agent may use without a prompt (`REPAIR_TOOLS`). */
  allowedTools: Array<string>;
  /** The Claude Code settings the agent loads: the project's (`.claude/settings.json`, `CLAUDE.md`). */
  settingSources: Array<'project'>;
  /** The controller that `withTimeout` aborts when the run outlasts `timeoutPerFile`. */
  abortController: AbortController;
  /** The model of `agentModel`; absent, so the SDK's default model, when the config names none. */
  model?: string;
  /** Receives what the agent's Claude Code process writes to standard error (`--debug` only). */
  stderr?: (data: string) => void;
}

/**
 * What the repair agent may do without a prompt: read and search the files, edit them, and run
 * ESLint and the compiler to check its fix. No other command: the agent runs unattended, so a
 * shell it could use freely would let a bad fix, or text in a file it reads, run anything.
 */
export const REPAIR_TOOLS: ReadonlyArray<string> = [
  'Read',
  'Glob',
  'Grep',
  'Edit',
  'Write',
  'Bash(npx eslint:*)',
  'Bash(npx tsc:*)',
  'Bash(pnpm exec eslint:*)',
  'Bash(pnpm exec tsc:*)',
];

/**
 * Builds the options of one agent run from the settings: the model and the time-limit controller,
 * and, when given (with `--debug`), the receiver of the agent process's standard error.
 */
export function agentOptions(
  settings: Settings,
  run: { dryRun: boolean; cwd: string; abortController: AbortController; stderr?: (data: string) => void }
): AgentRunOptions {
  return {
    cwd: run.cwd,
    // Only the repair tools, without a prompt; anything else is denied
    permissionMode: run.dryRun ? 'default' : 'dontAsk',
    allowedTools: [...REPAIR_TOOLS],
    settingSources: ['project'],
    abortController: run.abortController,
    ...(settings.agentModel === undefined ? {} : { model: settings.agentModel }),
    ...(run.stderr === undefined ? {} : { stderr: run.stderr }),
  };
}

/**
 * Runs `run` with a fresh `AbortController`, and aborts it after `ms` milliseconds.
 *
 * A run that ends in time keeps its result, and the timer is cleared. A run that fails after the
 * abort fails with `timed out after <ms> ms` in place of the abort error; any other failure is
 * kept as it is.
 */
export async function withTimeout<T>(ms: number, run: (controller: AbortController) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);
  try {
    return await run(controller);
  } catch (error) {
    throw timedOut ? new Error(`timed out after ${ms} ms`) : error;
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================================
// Command-line flags
// ============================================================================

/**
 * The parser of the integer flags `--max-files` and `--timeout`: the value of a text of decimal
 * digits that is at least 1, else `undefined` (`abc`, `0`, `-5`, `10ms`, `1.5`).
 *
 * Commander calls a parser with the text of the flag and the previous value (the default, or the
 * value of an earlier copy of the flag); the previous value is ignored. `parseInt` read it as its
 * radix, so a given `--timeout` became `NaN`.
 */
export function parseIntegerOption(value: string, _previous?: unknown): number | undefined {
  return /^\d+$/.test(value) && Number(value) >= 1 ? Number(value) : undefined;
}

// ============================================================================
// Path filter
// ============================================================================

/**
 * The folders that every run skips, whatever the config says: installed dependencies, and the
 * dev scripts themselves, which no gate type-checks or lints.
 */
const ALWAYS_EXCLUDED: ReadonlyArray<string> = ['**/node_modules/**', '**/scripts/**'];

/** The path of `file` from `root`, with `/` between names, as the glob patterns read it. */
function relativePosix(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/');
}

/**
 * The regular expression of a glob pattern over a `/`-separated path: `**` followed by `/`
 * matches any number of folders (none included), any other `**` matches any text, `*` matches
 * any text within one name, and `?` one character of a name. Every other character matches
 * itself; brace and bracket forms are not read.
 */
function globToRegExp(pattern: string): RegExp {
  let source = '';
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern.charAt(index);
    if (char === '*' && pattern.charAt(index + 1) === '*') {
      const folders = pattern.charAt(index + 2) === '/';
      source += folders ? '(?:.*/)?' : '.*';
      index += folders ? 2 : 1;
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

/**
 * True for a file that the analysis drops: its path from `root` matches one of the `exclude` globs
 * of the config (`Settings.exclude`) or of `ALWAYS_EXCLUDED`.
 *
 * The defaults match whole folder names at any depth, so `src/distance.ts` is kept, while
 * `dist/index.js` and `src/out-tsc/a.ts` are dropped.
 */
export function isExcludedPath(file: string, root: string, exclude: ReadonlyArray<string>): boolean {
  const relative = relativePosix(root, file);
  return [...exclude, ...ALWAYS_EXCLUDED].some((pattern) => globToRegExp(pattern).test(relative));
}

/**
 * True for a file in the scope of the run: one of the `targets` given on the command line (paths
 * from `root`) is the file or a folder that holds it. With no target, every file is in scope.
 *
 * The compiler checks the whole program whatever the targets, so the analysis keeps only the
 * diagnostics of the files in scope; ESLint lints the targets themselves.
 */
export function isWithinTargets(file: string, root: string, targets: ReadonlyArray<string>): boolean {
  if (targets.length === 0) return true;
  const resolved = path.resolve(file);
  return targets.some((target) => {
    const base = path.resolve(root, target);
    return resolved === base || resolved.startsWith(`${base}${path.sep}`);
  });
}

// ============================================================================
// Output
// ============================================================================

/** Where the output goes: the two streams of the process, or a test's collectors. */
export interface Writers {
  /** Writes text, its line ending included, to standard output. */
  stdout: (text: string) => void;
  /** Writes text, its line ending included, to standard error. */
  stderr: (text: string) => void;
}

/** The output channels of a run. */
export interface Output {
  /**
   * One line for a person: a progress message, a repair status line, the console report or the
   * verbose trace. It goes to standard output, or to standard error with `--json`, so that
   * standard output then holds the JSON report alone.
   */
  line: (text?: string) => void;
  /** The machine-readable report of `--json`, on standard output. */
  report: (text: string) => void;
  /**
   * One `--debug` line, prefixed `[debug]`, on standard error; nothing without `--debug`. It names
   * the config that loaded (or why none did), the settings, each analysis and each agent run.
   */
  debug: (text: string) => void;
}

/**
 * Builds the output channels of a run. The JSON report writes to standard output; the lines for a
 * person write to standard output, or to standard error with `--json`; the debug lines write to
 * standard error.
 */
export function createOutput(flags: { json: boolean; debug: boolean }, writers: Writers): Output {
  return {
    line: (text = '') => (flags.json ? writers.stderr : writers.stdout)(`${text}\n`),
    report: (text) => writers.stdout(`${text}\n`),
    debug: (text) => {
      if (flags.debug) writers.stderr(`[debug] ${text}\n`);
    },
  };
}

// ============================================================================
// Repair scheduling
// ============================================================================

/**
 * Runs `work` on each item, in order of start, with up to `concurrency` items at once (the
 * `maxConcurrentAgents` of the config, at least 1).
 *
 * After an item for which `work` returns `stop` (`--fail-fast`), no further item starts; the items
 * already running finish. `work` must not throw: a failure would end the pool while the other
 * items still run.
 */
export async function runPool<T>(
  items: ReadonlyArray<T>,
  concurrency: number,
  work: (item: T, index: number) => Promise<'continue' | 'stop'>
): Promise<void> {
  let next = 0;
  let stopped = false;
  const worker = async (): Promise<void> => {
    while (!stopped && next < items.length) {
      const index = next++;
      if ((await work(items[index] as T, index)) === 'stop') stopped = true;
    }
  };
  const workers = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
}

/** A step of `repairUntilClean` that the CLI reports to a person. */
export type IterationEvent =
  | { kind: 'iteration-start'; iteration: number; max: number }
  | { kind: 'reanalysing' }
  | { kind: 'all-resolved'; iteration: number }
  | { kind: 'max-reached'; remaining: number; max: number }
  | { kind: 'continuing'; remaining: number; next: number }
  | { kind: 'fail-fast'; iteration: number };

/** The work that `repairUntilClean` drives: the analysis, the repair and the progress report. */
export interface GlobalRepairSteps {
  /**
   * Analyses `targets`, the paths given on the command line (the default scope, `src` and `test`,
   * when empty), and returns the files with issues.
   */
  analyze: (targets: ReadonlyArray<string>) => Promise<FileIssueMap>;
  /** Repairs the files of one global iteration (`runRepairLoop`). */
  repair: (issues: FileIssueMap) => Promise<RepairResult>;
  /** Reports one step to a person. */
  progress: (event: IterationEvent) => void;
}

/**
 * Repairs `first`, then analyses again and repairs what remains, for up to `maxIterations` global
 * iterations, and returns the summed counts and the number of iterations run.
 *
 * `success` and `partial` add up across iterations; `failed` and `unresolved` are those of the
 * last iteration, and are cleared when an analysis finds no issue. Every analysis after the first
 * checks `targets` again, so a targeted run repairs no file outside them. With `failFast`
 * (`--fail-fast`), an iteration that leaves a file unfixed is the last one: no analysis and no
 * iteration follow it, and its `failed` count stands.
 */
export async function repairUntilClean(
  first: FileIssueMap,
  targets: ReadonlyArray<string>,
  failFast: boolean,
  steps: GlobalRepairSteps,
  maxIterations = 3
): Promise<{ result: RepairResult; iterations: number }> {
  const result: RepairResult = { success: 0, partial: 0, failed: 0, unresolved: [] };
  let iteration = 0;
  let current = first;

  while (iteration < maxIterations) {
    iteration++;
    if (iteration > 1) steps.progress({ kind: 'iteration-start', iteration, max: maxIterations });

    const iterationResult = await steps.repair(current);
    result.success += iterationResult.success;
    result.partial += iterationResult.partial;
    result.failed = iterationResult.failed; // Only count final failed
    result.unresolved = iterationResult.unresolved;

    if (failFast && iterationResult.failed > 0) {
      steps.progress({ kind: 'fail-fast', iteration });
      break;
    }

    if (iteration < maxIterations) steps.progress({ kind: 'reanalysing' });
    const next = await steps.analyze(targets);

    if (next.size === 0) {
      steps.progress({ kind: 'all-resolved', iteration });
      result.failed = 0;
      result.unresolved = [];
      break;
    }

    if (iteration >= maxIterations) {
      steps.progress({ kind: 'max-reached', remaining: next.size, max: maxIterations });
      break;
    }

    current = next;
    steps.progress({ kind: 'continuing', remaining: next.size, next: iteration + 1 });
  }

  return { result, iterations: iteration };
}
