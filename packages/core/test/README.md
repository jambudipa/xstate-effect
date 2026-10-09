# test

The test suite of the package. Three kinds of test live here, and each reaches the run by a
different path.

- **The port's own tests** — `test/*.test.ts`, the tests the package had before the upstream
  rewrites (SD-20). The default run collects them by that glob. COMPAT-1 holds the exact list
  of these files, so a file added here or removed from here needs that list changed too (and
  the pin of the COMPAT-1 spec, see `verify/README.md`).
- **The upstream rewrites** — `upstream/`, the 74 test files of `xstate@5.33.2` in Effect form
  (D1). No glob collects them: each `CONF-n` evidence file in `verify/` imports the rewrites
  that are green at phase n, each exactly once, and checks their pass counts against the
  frozen upstream inventory (SD-1, SD-2). Start with `upstream/README.md`.
- **The scenario evidence** — `verify/`, one spec per scenario
  (`verify-xstate-5-33-2-port-<ID>.spec.ts`) and the harness modules they share. Start with
  `verify/README.md`.

## Running

- `pnpm test` runs the default config (`vitest.config.ts`): the port's tests and the evidence
  specs, and through the CONF evidence files every upstream rewrite. It runs with `CI=true`,
  so a missing snapshot fails the run instead of being written. It needs a git checkout: one
  check lists the repository's files with git.
- `pnpm test:upstream test/upstream/<file>.test.ts` runs one rewrite directly
  (`vitest.upstream.config.ts`), pending or not, for red-phase work. That config keeps the
  no-skip guard and the flakyTest guard and leaves out the pending-rewrite guard.
- The type-level rewrites are proved by the type check of the tests (`pnpm typecheck`, and
  `tsc -p tsconfig.test.json --noEmit` in CI), not at run time.

## The guards of the default run

The default run fails, even when every test passes, in each of these cases:

- **A test that does not run as written.** A test or suite that ends skipped or todo, that
  expects to fail (`fails`) or that retries (`retry`), and a `.only` that skips the rest. The
  no-skip reporter (`verify/no-skip-reporter.ts`) reads what Vitest reports, not the source,
  so the form that set the option does not matter (D19, HARNESS-2, CONF-8).
- **`flakyTest`.** The configs give `verify/flaky-test-guard.ts` in place of `@effect/vitest`,
  through Vite's alias and through a Node resolve hook, and each access to `flakyTest` throws
  and is reported at the end of the run, also when the test catches the error (CONF-8).
- **A pending rewrite.** A load of a file that `upstream/pending.json` lists is blocked and
  named at the end of the run, whatever form the import takes (HARNESS-2).

Static checks stand behind these guards. HARNESS-2 and CONF-8 parse every module that the
default run reaches: they refuse each skip, todo, focus and `flakyTest` form, each import
outside the allowlist of `verify/skip-scan.ts`, and each use of an API that loads, runs or
spawns code outside a pinned harness module. So a new test or helper imports only relative
paths, `effect`, the test API, the package itself, the pure Node builtins and the allowlisted
libraries. No test spawns a child Vitest process (SD-1).

An upstream test that is skipped or todo upstream is never ported as a skipped test: it is a
"Tests not ported" row of the ledger (`upstream/CONFORMANCE.md`).
