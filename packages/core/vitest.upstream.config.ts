import { fileURLToPath } from "node:url"
import { configDefaults, defineConfig } from "vitest/config"
import { NoSkipReporter } from "./test/verify/no-skip-reporter.js"
import base, { flakyTestSetup } from "./vitest.config.js"

// Upstream rewrites (SD-1): `pnpm test:upstream test/upstream/<file>.test.ts` runs one
// rewrite directly, pending or not, for red-phase work. The pending-rewrite guard of the
// default run is left out (no plugin, and only the flakyTest guard's setup file), so a named
// pending rewrite loads here (HARNESS-2). The flakyTest guard is not (CONF-8, AC 28): every
// Vitest config of the package gives it, through the same alias and setup file as the default
// config, so no run of the package's configs reaches flakyTest of @effect/vitest.
export default defineConfig({
  ...base,
  plugins: [],
  resolve: {
    alias: [
      { find: "@", replacement: "./src" },
      // The exact specifier @effect/vitest, also with a query or hash suffix; never a subpath
      { find: /^@effect\/vitest(?=[?#]|$)/, replacement: fileURLToPath(new URL("./test/verify/flaky-test-guard.ts", import.meta.url)) },
    ],
  },
  test: {
    ...base.test,
    include: ["test/upstream/**/*.test.ts"],
    exclude: [...configDefaults.exclude],
    setupFiles: [flakyTestSetup],
    reporters: ["default", new NoSkipReporter()],
  },
})
