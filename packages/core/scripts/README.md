# scripts

Maintenance tools for the package: checks and repair tools that a maintainer or CI runs over the
code and the docs. Only `certify.ts`, `gate.ts` and their `-core` modules ship, compiled into `dist/scripts/`. `package.json`
publishes `dist/`, `src/` and a few root files, and no module in `src/` imports from this folder.

## What belongs here

A tool that works on the package, run from `package.json` or by hand: a gate, a check, a
generator. A `node --test` file of a tool sits beside it (`docs-audit.test.mjs`); Vitest collects
only `test/`, so the test of a TypeScript tool's pure logic is `test/scripts.test.ts`. Library
code belongs in `src/`, and the package's tests belong in `test/`.

## Entry points

- **`certify.ts`** is the `xstate-effect-certify` bin: `xstate-effect-certify <config> [--check]`.
  It runs `explore` and `certify` over the machines a config module's default export names
  (`CertifyConfig`), and writes their certificate module; `--check` derives every certificate
  again and compares fields and bytes. It prints one JSON report, `{ passed, failures }`, and
  exits non-zero on any failure or crash. `postbuild` compiles it with `tsconfig.certify.json`,
  which reads the package's own `dist` through its `exports`, so it builds after `tsc -p
  tsconfig.build.json`. It is the one file here a consumer runs, so keep it free of dev
  dependencies; it serves `moduleClosure` from `node:fs`, as `effect` is the only peer.
- **`certify-core.ts`** holds the decode of a config, which refuses a `layer` that is no `Layer`.
  It names no package and spawns nothing, so `test/scripts.test.ts` can reach it.
- **`gate.ts`** is the `xstate-effect-certify-gate` bin, the fail-closed gate over `certify --check`:
  `xstate-effect-certify-gate <config> [--timeout-ms <ms>]`, run by `pnpm check:settlement`. Exit 0
  proves only that a process ended, so it kills the bin at a time limit and passes only on one
  report with `passed: true`, no failures, exit 0 and the nonce of the run, which the bin reads
  from stdin before it loads a config. It prints a report of the same form, whose checks add
  `usage`, `timeout`, `spawn`, `no-report`, `malformed-report`, `forged-report` and
  `inconsistent-report`. A config that prints a report of its own fails it. A config that attacks
  the bin's process, for example by patching `process.stdout.write`, can still pass: its header
  says what remains. It guards against a broken run, not a hostile config.
- **`gate-core.ts`** holds the gate's command line and `judge`, for the same reason as `certify-core.ts`.
- **`bins.test.mjs`** runs both bins end to end under `node --test`, as `pnpm test:bins`, which
  `pnpm check:settlement` runs. No Vitest test may spawn a process (CONF-8). It needs a build.
- **`settlement.config.mjs`** is the library's own settlement fixture, which `pnpm check:settlement`
  hands to the gate; `test/settlement/README.md` says how to regenerate its certificate.
- **`repro-wide-spread.mjs`** preserves the unresolved A5 counterexample as forensic evidence.
  A wide spread plus explicit state keys hides an invalid agent state from the inferred type.
  The CLI compares the unsafe machines with valid controls, including C1's root assign form.
  Run `node scripts/repro-wide-spread.mjs --tsgo /path/to/tsgo --report /tmp/wide-spread.json`.
  TypeScript diagnostics, optional tsgo output, complete argument/return types, and available
  `TConfig`/`TGraph` mapper details go into JSON. Exit zero means the counterexample reproduced;
  the report explicitly marks acceptance **failed**. An unexpected result exits nonzero and
  establishes no acceptance result. `--source-root` selects another package; `--keep-temp`
  retains generated files. This tool does not run machine code or join the acceptance suite.
- **`check-wide-config-gate.mjs`** compiles the committed settlement fixtures with the installed
  TypeScript and an external tsgo executable. It requires every manifest diagnostic, rejects
  every unexpected diagnostic, and compares the two compilers' codes and source lines. Run
  `node scripts/check-wide-config-gate.mjs --tsgo /path/to/tsgo --report /tmp/wide-config-report.json`.
  The report records exact compiler versions and complete diagnostics. `--source-root` selects
  another package directory containing `src/` and `node_modules/`; the fixture text always comes
  from this checkout. `--keep-temp` retains the temporary package layout for inspection. This
  CLI installs nothing, writes no source files, and stays outside the Vitest import graph.
- **`docs-audit.mjs`** is the documentation gate, run as `pnpm run docs:audit`. It fails while a
  declaration lacks JSDoc or a source folder lacks a `README.md`. `docs-audit.test.mjs` tests it
  with `node --test`. A change to either file changes the rule for the whole package, so make it
  a commit of its own.
- **`check-markdown-code.ts`** is `pnpm check-docs`. It copies every `ts` or `typescript` fenced
  block of every markdown file in the package (this file included) into `.markdown-code-check/`,
  then type-checks and lints the copies against `src/`. A lint warning fails it too. So a README
  holds no TypeScript block that is not meant to compile.
- **`check-markdown-core.ts`** holds the pure logic of `check-markdown-code.ts`: it reads the
  findings out of the output of `tsc` and ESLint and decides the exit code. It starts no process,
  so `test/scripts.test.ts` tests it.
- **`clean.ts`** is the dev-only repair CLI (`pnpm clean`, `clean:verbose`, `clean:analyze`). It
  collects compiler issues in `src/` and ESLint issues in `src/` and `test/`, then asks a Claude
  agent, through the Claude Agent SDK, to fix each file; paths on the command line narrow every
  analysis to them. The agent runs with `bypassPermissions`:
  it can edit any file and run any command without a prompt. Run it only on a clean checkout and
  review the diff. `clean.config.ts` in the working folder can set the `exclude` globs, the
  number of agents at once, the agent's model and the time limit of each agent run.
- **`clean-core.ts`** holds the pure logic of `clean.ts`: the issue types, the config merge, the
  flag parser, the path filter, the output channels and the repair iterations. It imports only
  `node:path` and never loads `clean.config.ts`, so `test/scripts.test.ts` tests it without the
  Agent SDK.
- **`upstream/`** holds the tools for the upstream XState reference clone and the frozen
  upstream test manifest. Its own `README.md` covers them.

## Constraints

- Run every tool from the package root (`packages/core`). `docs-audit.mjs` audits the working
  folder, and `clean.ts` reads `tsconfig.json`, `clean.config.ts` and `code-style/` from it.
  Only `check-markdown-code.ts` finds the package from its own location.
- No gate lints this folder, and only `tsconfig.certify.json` includes a file of `scripts/`: `pnpm lint` covers `src` and
  `test`, and the type check of the tests reaches only the `-core` modules, through `test/scripts.test.ts`. Lint a script by name with
  `pnpm exec eslint scripts/<file>`. The relaxed scripts block of `eslint.config.mjs` applies, so
  the Effect rules of `src/` do not.
- That block's `allowDefaultProject` names `scripts/*.ts` and `scripts/upstream/*.ts`. Add a glob
  there for a new subfolder of `.ts` scripts, or type-aware lint cannot parse its files.
- `check-docs` runs its script with `node --experimental-strip-types`, so that file and
  `check-markdown-core.ts`, which it imports by its `.ts` name, may use only erasable TypeScript
  syntax: no `enum`, no `namespace`, no parameter properties.
- CONF-8 (`test/verify/verify-xstate-5-33-2-port-CONF-8.spec.ts`) allows the one dynamic import
  of `clean.ts` by its line number. An edit that moves that line must update the allowance. No
  test may reach `clean.ts`, so a test imports `clean-core.ts` and never the CLI.
  It allows `certify.ts` the same way: its dynamic import of the config by line number, and its
  imports of the package by name, which only the compiled file resolves. No test may reach it.
