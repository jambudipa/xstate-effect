# @jambudipa/xstate-effect

[![CI](https://github.com/jambudipa/xstate-effect/actions/workflows/ci.yml/badge.svg)](https://github.com/jambudipa/xstate-effect/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@jambudipa/xstate-effect.svg)](https://www.npmjs.com/package/@jambudipa/xstate-effect)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

The runtime behaviour of [XState](https://github.com/statelyai/xstate) 5.33.2, in Effect-native
form, on [`effect`](https://effect.website) 4.0.0. State machines, statecharts and actors run as
Effects: each actor lives in a `Scope`, failures are typed, and snapshots arrive as `Stream`s.
The 74 test files of `xstate@5.33.2` are rewritten in Effect form and run in this package's test
suite, and every deliberate difference from upstream is recorded with the decision behind it.

> **Pre-release API**: the package is at v0.x. A minor version may change the API. Read the
> [changelog](./CHANGELOG.md) before you upgrade.

## Key features

- **XState 5.33.2 behaviour** — the statechart algorithm is ported from XState's own: parallel
  and history states, eventless (`always`) and delayed (`after`) transitions, final states,
  `invoke` and `spawnChild`, and one published snapshot per macrostep.
- **Effect-native API** — `createActor`, `start`, `stop`, `send` and `getSnapshot` are Effects;
  there is no Promise facade. Actor logic can be an `Effect` (`fromEffect`) or a `Stream`
  (`fromStream`) beside upstream's `fromPromise`, `fromCallback`, `fromObservable` and
  `fromTransition`.
- **Scoped lifetimes** — an actor is a child of the caller's `Scope`: closing the scope stops
  the actor and its children, and their finalizers run.
- **Errors as XState reports them** — a failure in an action, guard or actor logic sets the
  actor's status to `error` and reaches the parent as an `xstate.error.actor.*` event;
  `snapshot.output` and `snapshot.error` are `Option` values.
- **Persistence** — `getPersistedSnapshot` encodes through an Effect `Schema` codec, children and
  tags included, and restore decodes through the same codec.
- **Same entry points as xstate** — `.`, `./actions`, `./actors`, `./guards`, `./graph` and
  `./dev`, with model-based testing in `./graph`.

## Getting started

### Installation

```bash
pnpm add @jambudipa/xstate-effect effect
```

`effect` is a peer dependency (`^4.0.0`). The package is ESM only and needs Node.js 20 or later.

### Quick start

The counter machine of [`examples/counter.ts`](./examples/counter.ts), run through `createActor`:

```ts
import { Effect } from "effect"
import { assign, createActor, createMachine } from "@jambudipa/xstate-effect"

type CounterEvent =
  | { type: "increment" }
  | { type: "decrement" }
  | { type: "reset" }
  | { type: "set"; value: number }

const counterMachine = createMachine({
  types: {} as { context: { count: number }; events: CounterEvent },
  id: "counter",
  initial: "active",
  context: { count: 0 },
  states: {
    active: {
      on: {
        increment: { actions: assign(({ context }) => ({ count: context.count + 1 })) },
        decrement: { actions: assign(({ context }) => ({ count: context.count - 1 })) },
        reset: { actions: assign({ count: 0 }) },
        set: { actions: assign(({ event }) => ({ count: event.type === "set" ? event.value : 0 })) }
      }
    }
  }
})

const program = Effect.gen(function* () {
  // The actor lives in the scope of this program: closing the scope stops it
  const actor = yield* createActor(counterMachine)
  yield* actor.start

  // An external send completes after the event's macrostep, so each read sees it
  yield* actor.send({ type: "increment" })
  yield* actor.send({ type: "set", value: 42 })
  yield* actor.send({ type: "decrement" })

  const snapshot = yield* actor.getSnapshot
  console.log(snapshot.value, snapshot.context.count) // active 41
})

void Effect.runPromise(Effect.scoped(program))
```

To follow every change, read the actor's `changes` stream (the current snapshot, then each new
one), or pass `subscribe` a function that returns an Effect: it receives each snapshot published
after the call, as in XState, until the caller's scope closes. `waitFor(actor, predicate)` waits
for a snapshot that matches. The [`examples/`](./examples) folder holds more machines ported from
XState's examples.

## Entry points

| Import | What it holds |
|---|---|
| `@jambudipa/xstate-effect` | `createMachine`, `setup`, `createActor`, the actions, guards and actor logic creators, the pure functions (`transition`, `initialTransition`, `getNextSnapshot`, `getInitialSnapshot`, `getMicrosteps`, `getNextTransitions`), `waitFor`, `toEffect`, `toPromise`, `SimulatedClock`, the built-in events and the types |
| `@jambudipa/xstate-effect/actions` | `assign`, `sendTo`, `sendParent`, `raise`, `forwardTo`, `emit`, `cancel`, `log`, `spawnChild`, `stopChild`, `enqueueActions` and the port's extras |
| `@jambudipa/xstate-effect/actors` | `fromPromise`, `fromCallback`, `fromObservable`, `fromEventObservable`, `fromTransition`, `createEmptyActor`, and the Effect-based `fromEffect` and `fromStream` |
| `@jambudipa/xstate-effect/guards` | `stateIn`, `and`, `or`, `not`, `evaluateGuard` |
| `@jambudipa/xstate-effect/graph` | `createTestModel`, `TestModel`, `getShortestPaths`, `getSimplePaths`, `getPathsFromEvents`, `getAdjacencyMap`, `toDirectedGraph`, `joinPaths`, `serializeSnapshot` |
| `@jambudipa/xstate-effect/dev` | `devToolsAdapter`, `registerService`, `getGlobal` |

## How it differs from XState

Parity means the same behaviour, not the same signatures. The
[conformance ledger](./test/upstream/CONFORMANCE.md) lists each upstream test file with its
status, each upstream test that is not ported and why, and 74 deviation rows, each with the
decision that requires it. The decisions are in [`docs/decisions.md`](./docs/decisions.md). The
main differences:

- **Effects in place of synchronous calls and Promises** — `createActor` returns
  `Effect<Actor, never, Scope | …>`, and every API that can run a user guard or action returns an
  Effect: `machine.transition`, `snapshot.can`, `getNextSnapshot`, the graph traversals
  (D6, SD-8, SD-13). The package never throws synchronously (SD-3): a definition error of
  `createMachine` fails each Effect that computes a snapshot of the machine, and
  `machine.resolveState` and `assertEvent` fail their Effects, each with the upstream message.
- **Left out** — `interpret`, `toObserver`, the observer-object form of `subscribe` and
  `Subscription` objects; scoped Effects and Streams replace them (D6, SD-18).
- **`Option` for absent values** — `snapshot.output`, `snapshot.error`, `event.output` of done
  events and the context of `fromObservable` (D8, SD-17).
- **Unhandled errors** go to the actor's logger (`Effect.logError` by default) instead of being
  rethrown asynchronously (SD-21).
- **`SimulatedClock`** keeps upstream's method names, but `increment` and `set` return Effects
  (SD-28).
- **An actor that errors** closes its scope, so its children stop too (SD-27).
- **ESM only** — each entry point has a `types`, an `import` and a `default` condition, and
  `import` and `default` name the same ES module file; upstream also ships CommonJS.

## Testing

- `test/upstream/` holds the 74 upstream test files of `xstate@5.33.2` (58 core files, 6
  examples, 10 graph files), rewritten in Effect form under their upstream names (D1). Each
  rewritten test carries a `// upstream: <file> > <describe path> > <title>` line.
- The default `pnpm test` runs them: the evidence files `CONF-2` to `CONF-8` under
  `test/verify/` import each rewrite exactly once and check its pass count against the frozen
  upstream inventory (`test/upstream/upstream-manifest.json`). Static `PARITY` checks compare
  each rewrite with upstream: at least the upstream assertion count, the same inline-snapshot
  text and the same number of `@ts-expect-error` lines (SD-2).
- No test may be skipped: the run fails when a test or suite ends skipped or todo, expects to
  fail, or retries.
- The type-level files (`types`, `setup.types`, `spawn.types`, `typeHelpers`) are proved by the
  type check of the tests (`pnpm typecheck`).
- `test/*.test.ts` and the other `test/verify/*.spec.ts` files are the port's own tests.

The suite needs a git checkout: one check lists the repository's files with git.

## Documentation

- [`docs/`](./docs/README.md) — tutorials, how-to guides, reference and explanation pages. Some
  code samples there predate the port; `pnpm check-docs` type-checks and lints them and reports
  the ones that fail.
- [`test/upstream/CONFORMANCE.md`](./test/upstream/CONFORMANCE.md) — the conformance ledger.
- [`docs/decisions.md`](./docs/decisions.md) — the decisions D1–D20 and SD-1–SD-28.
- [`llms.txt`](./llms.txt) — a short summary of the package for language models.

## Development

You need Node.js 22 (22.13 or later) or 24, as Vitest 5 and ESLint 10 require, and pnpm 10.
The package lives in `packages/core`, which holds its own lockfile, so install and run
everything there:

```bash
git clone https://github.com/jambudipa/xstate-effect.git
cd xstate-effect/packages/core
pnpm install

pnpm lint                                    # ESLint over src/ and test/
pnpm typecheck                               # src/, then src/ and test/ together
pnpm exec tsc -p tsconfig.test.json --noEmit # the type check of the tests that CI runs
pnpm test                                    # the whole suite, upstream rewrites included
pnpm build                                   # dist/
```

CI runs these five commands on Node 22 and 24 for every push and pull request to `main`.

`pnpm test:upstream test/upstream/<file>.test.ts` runs one rewrite directly.

The reference clone of upstream XState is optional: no test reads it. `pnpm upstream:fetch`
clones `https://github.com/statelyai/xstate.git` at the tag `xstate@5.33.2` (commit
`fbee62e7c1586315ed478c2fedf530d7e0ff5a3e`) into `.upstream/xstate-5.33.2`, and skips the step
when that folder exists. `node --experimental-strip-types scripts/upstream/freeze-upstream.ts`
then rebuilds `test/upstream/upstream-manifest.json` from it.

Releases use [Changesets](https://github.com/changesets/changesets): `pnpm changeset` records a
change, and `pnpm run version` applies the changesets to `package.json` and `CHANGELOG.md`.

## License

MIT — see [LICENSE](./LICENSE). The ported state-machine semantics and the rewritten upstream
tests derive from [XState](https://github.com/statelyai/xstate), © 2015 David Khourshid, under
the MIT licence; its notice is reproduced in [LICENSE](./LICENSE).
