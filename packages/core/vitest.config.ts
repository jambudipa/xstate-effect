import { fileURLToPath } from "node:url"
import { configDefaults, defineConfig } from "vitest/config"
import { NoSkipReporter } from "./test/verify/no-skip-reporter.js"
import { PendingRewriteGuard } from "./test/verify/pending-rewrite-guard.js"

// Default run (SD-1): the existing port tests and the scenario evidence files.
// Upstream rewrites under test/upstream/ never run here directly; a CONF-n evidence
// file imports them once they are green. vitest.upstream.config.ts runs one by name.
// The no-skip guard fails the run when any test or suite ends skipped or todo (HARNESS-2),
// or when any test expects to fail or retries (CONF-8).
// The pending-rewrite guard blocks each load of a rewrite that test/upstream/pending.json
// lists, whatever form the import takes, and fails the run (HARNESS-2): its plugin covers
// the loads through Vite, its setup file the loads through Node's own loader.
// The flakyTest guard (CONF-8, AC 28) gives test/verify/flaky-test-guard.ts in place of
// @effect/vitest, whose flakyTest and it.flakyTest throw: its alias covers the loads through
// Vite, its setup file the loads through Node's own loader (and refuses the builtins that load
// or spawn code to each importer outside the dependency store). Every Vitest config of the
// package gives the flakyTest guard (vitest.upstream.config.ts too).
const pendingRewriteGuard = new PendingRewriteGuard()

/** The guard's setup file, by absolute path, so a run with another root finds it too. */
export const pendingRewriteSetup = fileURLToPath(new URL("./test/verify/pending-rewrite-setup.ts", import.meta.url))

/** The flakyTest guard's setup file (CONF-8), by absolute path; every Vitest config of the package lists it. */
export const flakyTestSetup = fileURLToPath(new URL("./test/verify/flaky-test-setup.ts", import.meta.url))

export default defineConfig({
  plugins: [pendingRewriteGuard.plugin],
  test: {
    include: ["test/*.test.ts", "test/verify/**/*.spec.ts"],
    exclude: [...configDefaults.exclude, "test/upstream/**"],
    setupFiles: [pendingRewriteSetup, flakyTestSetup],
    reporters: ["default", new NoSkipReporter(), pendingRewriteGuard],
    globals: false,
    environment: "node",
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: [
      { find: "@", replacement: "./src" },
      // The exact specifier @effect/vitest, also with a query or hash suffix; never a subpath
      { find: /^@effect\/vitest(?=[?#]|$)/, replacement: fileURLToPath(new URL("./test/verify/flaky-test-guard.ts", import.meta.url)) },
    ],
  },
})
