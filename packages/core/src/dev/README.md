# src/dev

The `./dev` entry point (upstream `xstate/dev`): `getGlobal`, `registerService`,
`devToolsAdapter`, the `XStateDevInterface` hook type and `DevToolsError`. `Actor.ts` calls
`devToolsAdapter` when an actor starts with the `devTools: true` option.

## What belongs here

Interop with a dev tools extension through the global `__xstate__` hook. Inspection (the
`inspect` option and the inspection events) does not belong here; it lives with the actor and
its system.

## Constraints

- Read the global object only inside an Effect, through `Predicate` guards, never at import
  time. The candidate lookup lives in `src/internal/globalObject.ts`, so a test can reach the
  warning for an environment without a global object.
- The port calls only the hook's `register`, and only where a `window` object exists. A throw
  from the hook becomes a `DevToolsError`; an actor's `start` dies with it.
- A difference from upstream's `xstate/dev` needs a decision in `docs/decisions.md` and a row in
  `test/upstream/CONFORMANCE.md`, as everywhere in `src`.
