# test/upstream/graph

The rewrites of the 10 graph test files of upstream (`packages/core/src/graph/test/` at
`xstate@5.33.2`), which test the `./graph` entry point (`src/graph/`): the traversals, the
adjacency map, the directed graph and model-based testing with `createTestModel`.

The port's traversals return Effects (SD-13), so `model.getShortestPaths()` and
`path.test(params)` are Effects here, and `testUtils.ts` runs the paths one after another and
stops at the first failure, as upstream's `await` does. The describe titles stay the upstream
ones (`@xstate/graph` in `graph.test.ts`), because the snapshot keys and the annotations carry
them.

## Snapshots

The file snapshots of `graph.test.ts` live in two places, and both must stay equal to the
upstream entries (SD-26, SNAP-1):

- In the default run, Vitest reads a file snapshot beside the file it runs, which is the CONF-7
  evidence file. The entries live in
  `test/verify/__snapshots__/verify-xstate-5-33-2-port-CONF-7.spec.ts.snap`, each key prefixed
  with the describe chain of the import block.
- `__snapshots__/graph.test.ts.snap` here is the upstream file, byte for byte. Only a direct
  run of the rewrite (`pnpm test:upstream`) reads it.

No run writes a snapshot: the test scripts set `CI=true`, so a missing entry fails the run. A
snapshot that differs from upstream needs a deviation row in `../CONFORMANCE.md` that names the
upstream key and cites a decision.
