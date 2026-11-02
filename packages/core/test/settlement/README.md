# test/settlement

The library's own settlement fixtures, which `pnpm check` runs (decision 21 of the agent-settlement
spec). Vitest does not collect this folder: `pnpm check:settlement` is its runner.

## What belongs here

- `types.ts`: the compile-time rules, as `@ts-expect-error` cases, compiled by `tsconfig.settlement.json`.
- `certificate.ts`: generated from `scripts/settlement.config.mjs`, the config the gate (`scripts/gate.ts`) runs
  through `xstate-effect-certify --check`. The certificate's verdict runs both `proveSettlement` and the explorer.
  The config holds real `fromAgent` logic, a small case, and a case with a timer, a process restart, a context read
  and a ranking. Each environment drives every event its machine handles.
  The config imports the package by its own name, so the module closure walks `dist/`. A change to
  the config, to `src/`, or to `libraryVersion` makes it stale.

## Regenerate

Run `pnpm build`, then `node dist/scripts/certify.js scripts/settlement.config.mjs`. Do this last on a
branch that changes `src/`, as `pnpm check:settlement` fails until the certificate matches the build.
