# xstate-effect

[![CI](https://github.com/jambudipa/xstate-effect/actions/workflows/ci.yml/badge.svg)](https://github.com/jambudipa/xstate-effect/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@jambudipa/xstate-effect.svg)](https://www.npmjs.com/package/@jambudipa/xstate-effect)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

The runtime behaviour of [XState](https://github.com/statelyai/xstate) 5.33.2, in Effect-native
form, on [`effect`](https://effect.website) 4.0.0, published as
[`@jambudipa/xstate-effect`](https://www.npmjs.com/package/@jambudipa/xstate-effect).

```bash
pnpm add @jambudipa/xstate-effect effect
```

The package lives in [`packages/core`](./packages/core). Its
[README](./packages/core/README.md) covers the quick start, the entry points, the differences
from XState, the tests and the development commands. Run every command in `packages/core`,
which holds the package's own lockfile.

## Documentation

The [documentation](./packages/core/docs/index.md) of the package is in four parts:

- [Tutorials](./packages/core/docs/tutorials/index.md) — learn the package step by step, from a
  first machine to child actors and tests.
- [How-to guides](./packages/core/docs/how-to/index.md) — get a task done: persist an actor, give
  a machine Effect services, test delayed transitions, port XState code, and more.
- [Reference](./packages/core/docs/reference/index.md) — every entry point, function, option and
  type.
- [Explanation](./packages/core/docs/explanation/index.md) — the design: actors and scopes, how
  events are processed, how failures surface, and how the package differs from XState.

## License

MIT — see [LICENSE](./LICENSE), which also reproduces the MIT notice of XState, from which the
port derives.
