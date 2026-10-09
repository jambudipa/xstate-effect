# scripts

Maintenance tools for the package: checks and repair tools that a maintainer or CI runs over the
code and the docs. Nothing here ships. `package.json` publishes `dist/`, `src/` and a few root
files, and no module in `src/` imports from this folder.

## What belongs here

A tool that works on the package, run from `package.json` or by hand: a gate, a check, a
generator. A tool's own test sits beside it. Library code belongs in `src/`, and the package's
tests belong in `test/`.

## Entry points

- **`docs-audit.mjs`** is the documentation gate, run as `pnpm run docs:audit`. It fails while a
  declaration lacks JSDoc or a source folder lacks a `README.md`. `docs-audit.test.mjs` tests it
  with `node --test`. A change to either file changes the rule for the whole package, so make it
  a commit of its own.
- **`check-markdown-code.ts`** is `pnpm check-docs`. It copies every `ts` or `typescript` fenced
  block of every markdown file in the package (this file included) into `.markdown-code-check/`,
  then type-checks and lints the copies against `src/`. A lint warning fails it too. So a README
  holds no TypeScript block that is not meant to compile.
- **`clean.ts`** is the dev-only repair CLI (`pnpm clean`, `clean:verbose`, `clean:analyze`). It
  collects compiler issues in `src/` and ESLint issues in `src/` and `test/`, then asks a Claude
  agent, through the Claude Agent SDK, to fix each file. The agent runs with `bypassPermissions`:
  it can edit any file and run any command without a prompt. Run it only on a clean checkout and
  review the diff. The settings of `clean.config.ts` do not take effect yet.
- **`upstream/`** holds the tools for the upstream XState reference clone and the frozen
  upstream test manifest. Its own `README.md` covers them.

## Constraints

- Run every tool from the package root (`packages/core`). `docs-audit.mjs` audits the working
  folder, and `clean.ts` reads `tsconfig.json`, `clean.config.ts` and `code-style/` from it.
  Only `check-markdown-code.ts` finds the package from its own location.
- No gate type-checks or lints this folder: `pnpm lint` covers `src` and `test`, and no tsconfig
  includes `scripts/`. Lint a script by name with `pnpm exec eslint scripts/<file>`. The relaxed
  scripts block of `eslint.config.mjs` applies, so the Effect rules of `src/` do not.
- That block's `allowDefaultProject` names `scripts/*.ts` and `scripts/upstream/*.ts`. Add a glob
  there for a new subfolder of `.ts` scripts, or type-aware lint cannot parse its files.
- `check-docs` runs its script with `node --experimental-strip-types`, so that file may use only
  erasable TypeScript syntax: no `enum`, no `namespace`, no parameter properties.
- CONF-8 (`test/verify/verify-xstate-5-33-2-port-CONF-8.spec.ts`) allows the one dynamic import
  of `clean.ts` by its line number. An edit that moves that line must update the allowance.
