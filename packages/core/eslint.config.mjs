import { readFileSync } from 'node:fs';
import tseslint from 'typescript-eslint';
import { effectLintConfig } from './eslint-rules/effect-eslint-config.mjs';

// ============================================
// SHARED CONSTANTS
// ============================================

/**
 * Upstream rewrites whose green phase is still ahead (SD-1). Paths are relative to
 * this package. The listed files are not linted; the CONF task that imports a
 * rewrite removes it from the list, and from then on the file is linted.
 */
const PENDING_REWRITES_FILE = new URL('./test/upstream/pending.json', import.meta.url);

/**
 * The entries of `test/upstream/pending.json`, read at each call: the paths, relative to this
 * package, that the default export passes to `eslintConfigFor` as ignores. Throws when the file
 * is missing or is not valid JSON, so ESLint fails to load its config rather than lint a
 * pending rewrite.
 */
export const readPendingRewrites = () => JSON.parse(readFileSync(PENDING_REWRITES_FILE, 'utf8'));

/**
 * Real-time and fake-timer waits banned inside test/upstream/ (SD-1, SD-22). The
 * rewrites drive time with TestClock or SimulatedClock, never with wall-clock waits.
 */
const TIMER_BAN_MESSAGE =
  'Upstream rewrites control time with TestClock or SimulatedClock, not with real or fake timers.';

/**
 * Type-aware rule exemptions for files where typed linting should be relaxed.
 */
const TYPE_AWARE_EXEMPTIONS = {
  '@typescript-eslint/await-thenable': 'off',
  '@typescript-eslint/no-floating-promises': 'off',
  '@typescript-eslint/require-await': 'off',
  '@typescript-eslint/no-misused-promises': 'off',
  '@typescript-eslint/no-unsafe-call': 'off',
  '@typescript-eslint/no-unsafe-member-access': 'off',
  '@typescript-eslint/no-unsafe-return': 'off',
};

// ============================================
// MAIN CONFIGURATION
// ============================================

/**
 * Builds the flat config with the given pending upstream rewrites ignored. The default
 * export reads `test/upstream/pending.json`; HARNESS-2 calls this with its own lists.
 */
export const eslintConfigFor = (pendingRewrites) => tseslint.config(
  // Global ignores, plus the upstream rewrites that are not green yet (SD-1)
  {
    ignores: ['**/dist', '**/out-tsc', '**/node_modules', '**/*.d.ts', ...pendingRewrites],
  },

  // No comment changes the lint config of a file (SD-3: no inline disable comments). ESLint
  // ignores each directive comment (eslint-disable, eslint-enable, eslint <rule>, global,
  // exported, ...) and warns about it, so the scoped blocks below are the only exceptions.
  {
    linterOptions: { noInlineConfig: true },
  },

  // ============================================
  // SECTION: TypeScript + Effect Idiomatic Rules
  // ============================================
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        // Enable typed linting with project service
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      // ----------------------------------------
      // TypeScript Rules (Non-Type-Aware)
      // ----------------------------------------

      // Disallow explicit any types - forces proper typing
      '@typescript-eslint/no-explicit-any': 'error',

      // Disallow CommonJS require in this ESM package (it fails at runtime)
      '@typescript-eslint/no-require-imports': 'error',

      // Forbid @ts-ignore and other TS suppression comments
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-expect-error': 'allow-with-description',
          minimumDescriptionLength: 10,
        },
      ],

      // Disallow unused variables (with underscore prefix exception)
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // ----------------------------------------
      // Type-Aware TypeScript Rules
      // ----------------------------------------

      // Warn on deprecated APIs
      '@typescript-eslint/no-deprecated': 'warn',

      // Disallow awaiting non-Promise values
      '@typescript-eslint/await-thenable': 'error',

      // Require Promises to be handled
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          ignoreVoid: true,
          ignoreIIFE: true,
        },
      ],

      // Disallow async functions with no await
      '@typescript-eslint/require-await': 'error',

      // Require consistent return types in async functions
      '@typescript-eslint/no-misused-promises': [
        'error',
        {
          checksConditionals: true,
          checksVoidReturn: {
            arguments: false,
            attributes: false,
          },
        },
      ],

      // Prevent unnecessary type assertions
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',

      // Disallow type assertions that don't change the type
      '@typescript-eslint/no-unnecessary-type-arguments': 'warn',

      // Enforce using type parameter when calling Array#reduce
      '@typescript-eslint/prefer-reduce-type-parameter': 'warn',

      // Prefer nullish coalescing over logical OR
      '@typescript-eslint/prefer-nullish-coalescing': [
        'warn',
        {
          ignorePrimitives: { string: true, boolean: true },
        },
      ],

      // Prefer optional chain expressions
      '@typescript-eslint/prefer-optional-chain': 'warn',

      // Require switch statements to be exhaustive
      '@typescript-eslint/switch-exhaustiveness-check': [
        'warn',
        {
          requireDefaultForNonUnion: false,
          allowDefaultCaseForExhaustiveSwitch: true,
        },
      ],

      // Disallow calling functions without type safety
      '@typescript-eslint/no-unsafe-call': 'warn',

      // Disallow member access on any typed values
      '@typescript-eslint/no-unsafe-member-access': 'warn',

      // Disallow returning any from functions
      '@typescript-eslint/no-unsafe-return': 'warn',
    },
  },

  // ============================================
  // SECTION: Canonical Effect lint bundle (every rule at error)
  // ============================================
  // eslint-rules/effect-rules.mjs and effect-eslint-config.mjs are byte-identical
  // copies of ~/.agents/guidance/typescript-effect/eslint/. Do not edit them here.
  effectLintConfig(['src/**/*.ts']),

  // ============================================
  // SECTION: The one scoped block of src (SD-22). It relaxes no canonical Effect rule.
  // ============================================
  // Every src file resolves every rule of the canonical Effect bundle at error (AC 37; owner,
  // 2026-10-08, goal journal/2026-10-08-15-no-src-lint-exceptions.md: "Every file ON. All
  // rules."). The block below turns off @typescript-eslint/no-explicit-any, a rule of the
  // TypeScript section above and not of the canonical bundle, in one file; CONF-8 pins that
  // file and that rule.
  //
  // SD-22 (amendment 2026-10-06, goal journal/2026-10-06-08-any-event.md): upstream's
  // AnyEventObject, the default event type of a machine without declared events, has an
  // `any` index signature. SD-22 (amendment 2026-10-07, goal
  // journal/2026-10-07-09-upstream-any.md): `UpstreamAny`, upstream's `any` for an untyped
  // invocation (done output, snapshot, AnyActorLogic input and event), and (amendment
  // 2026-10-07, goal journal/2026-10-07-10-anyactorref-any.md) for an AnyActorRef snapshot.
  // This file holds only those two declarations; no other `any` in src.
  {
    files: ['src/internal/anyEventObject.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // ============================================
  // SECTION: Test Files - Relaxed Rules
  // ============================================
  {
    files: ['test/**/*.ts', '**/*.test.ts', '**/*.spec.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.test.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      ...TYPE_AWARE_EXEMPTIONS,
    },
  },

  // ============================================
  // SECTION: Upstream rewrites - timer ban (SD-1, SD-22)
  // ============================================
  {
    files: ['test/upstream/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='vi'][callee.property.name='useFakeTimers']",
          message: TIMER_BAN_MESSAGE,
        },
        {
          selector: "NewExpression[callee.name='Promise'] CallExpression[callee.name='setTimeout']",
          message: TIMER_BAN_MESSAGE,
        },
        {
          selector: "ImportExpression[source.value=/^(node:)?timers\\u002Fpromises$/]",
          message: TIMER_BAN_MESSAGE,
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'node:timers/promises', message: TIMER_BAN_MESSAGE },
            { name: 'timers/promises', message: TIMER_BAN_MESSAGE },
          ],
        },
      ],
    },
  },

  // ============================================
  // SECTION: Scripts - Relaxed Rules
  // ============================================
  {
    files: ['scripts/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: {
          // scripts/upstream/ holds the T1.2 freeze script (the glob may not use **)
          allowDefaultProject: ['scripts/*.ts', 'scripts/upstream/*.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      ...TYPE_AWARE_EXEMPTIONS,
    },
  },
);

export default eslintConfigFor(readPendingRewrites());
