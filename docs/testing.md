# Testing

How the test suite of `@jambudipa/xstate-effect` is run, gated and kept current. The package
lives in `packages/core`; run every command there. `packages/core/test/README.md` explains the
three kinds of test and the guards of the default run.

## Commands

| Purpose | Command (from `packages/core`) |
|---|---|
| The whole suite | `pnpm test` |
| The suite with the coverage gate (the pre-push hook and CI run this) | `pnpm test:coverage` |
| Type-check the source, then the source and the tests | `pnpm typecheck` |
| The type check of the tests that CI runs | `pnpm exec tsc -p tsconfig.test.json --noEmit` |
| One upstream rewrite | `pnpm test:upstream test/upstream/<file>.test.ts` |

`pnpm test:coverage` prints a summary and writes `coverage/lcov.info` (gitignored).

## The coverage gate

- **Thresholds:** 90 % lines and 85 % branches over `src/**/*.ts`. They live in one place,
  `test.coverage.thresholds` in `packages/core/vitest.config.ts`, so the same command fails
  below them on a laptop, in the hook and in CI.
- **Scope:** `src/` is the published library. `scripts/` is maintainer tooling: each script
  that spawns a process or loads code is out of reach of the tests, because CONF-8 refuses any
  module a test reaches that holds such a capability. `scripts.test.ts` covers their pure logic
  and `scripts/docs-audit.test.mjs` runs under `node --test` in CI. `examples/` are
  documentation programs: COMPAT-1 type-checks them and `examples.test.ts` imports them.
- **Per layer:** each folder of `src/` is held at 80 % lines or more. The gate checks only the
  totals; keep the layers there by hand.
- **At the time of writing (2026-10-13):** 98.61 % lines, 97.76 % branches.

## The pre-push hook

`.githooks/pre-push` runs `pnpm test:coverage` and blocks the push when it fails. Git runs it
once `core.hooksPath` points at `.githooks`:

- `pnpm install` in `packages/core` sets it (the `prepare` script).
- Or run it yourself from the repository root: `git config core.hooksPath .githooks`.

The hook runs the whole suite with coverage, about 90 seconds on a busy laptop. Each test has 60
seconds by default (`testTimeout` in `vitest.config.ts`), so a load average of 40 to 50 no longer
fails it; a test that hangs still fails, after 60 seconds. On a far busier machine (load above about
100) the heaviest harness specs (COMPAT-1, HARNESS-2), which set their own 60-second limit, can still
time out; rerun when the machine is quieter rather than skip the hook.

## Where a test goes

- `test/*.test.ts` is a closed list: COMPAT-1 pins its files and the include globs of
  `vitest.config.ts`. Do not add a file there.
- `test/upstream/` holds the upstream rewrites; `test/verify/README.md` says how a CONF
  evidence file imports them.
- A new scenario or gap row gets its own spec, `test/verify/verify-xstate-5-33-2-port-<ID>.spec.ts`.
- Coverage of a `src/` folder goes in that folder's COV spec:

  | Folder | Spec |
  |---|---|
  | `src/` (root modules) | `test/verify/verify-xstate-5-33-2-port-COV-1.spec.ts` |
  | `src/actors/` | `...-COV-2.spec.ts` |
  | `src/testing/` | `...-COV-3.spec.ts` |
  | `src/internal/` | `...-COV-4.spec.ts` |
  | `src/graph/` | `...-COV-5.spec.ts` |
  | `src/actions/` | `...-COV-6.spec.ts` |
  | `src/guards/` | `...-COV-7.spec.ts` |
  | `src/dev/` | `...-COV-8.spec.ts` |

- A test imports only relative paths, `effect`, `@effect/vitest`, the package itself and the
  pure Node builtins (CONF-8).
- No skip, todo, `fails`, retry, `.only` or `flakyTest`: the run fails on each. A bug a test
  exposes is reported and fixed, not asserted as an expected failure.
- No real sleeps or wall clock: use `TestClock` or `SimulatedClock`.

## Keeping the tests current

| When | Run |
| --- | --- |
| A story or feature is about to be built | `bmad-testarch-atdd` — acceptance tests first, failing |
| Code changes in a covered layer | `bmad-testarch-automate`, scoped to the changed paths |
| Before a pull request or a release | `bmad-testarch-test-review`, then `bmad-testarch-trace` |
| The CI pipeline changes | `bmad-testarch-ci` |
| The coverage gate fails | Add tests. A threshold change or a new exclusion needs a named reason in this file |

## Troubleshooting

- **BASELINE-1 fails with "expected 2 to equal 1"** after a dependency change: pnpm left an old
  `@effect+vitest` folder in `node_modules/.pnpm`. Run `pnpm prune` in `packages/core`.
