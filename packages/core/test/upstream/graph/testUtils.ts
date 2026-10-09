/**
 * Port of upstream `packages/core/src/graph/test/testUtils.ts` (xstate@5.33.2) in Effect form.
 *
 * Written against the target graph API (SD-13): the traversals return Effects, so
 * `model.getShortestPaths()` and `path.test(params)` are Effects and the helpers run the
 * paths one after another, stopping at the first failure as upstream's `await` does.
 *
 * This file stays in `test/upstream/pending.json` until the first CONF-7 import task that
 * uses it (it needs `src/graph`). Upstream users: graph/events, graph/index, graph/paths,
 * graph/states, graph/testModel.
 */
import { Effect } from "effect"
import type { EventObject, Snapshot } from "../../../src/index.js"
import type { TestModel, TestParam, TestPath } from "../../../src/graph/index.js"

// upstream: src/graph/test/testUtils.ts > testModel
function testModel<TSnapshot extends Snapshot<unknown>, TEvent extends EventObject, TInput>(
  model: TestModel<TSnapshot, TEvent, TInput>,
  params: TestParam<TSnapshot, TEvent>
) {
  return Effect.gen(function* () {
    for (const path of yield* model.getShortestPaths()) {
      yield* path.test(params)
    }
  })
}

// upstream: src/graph/test/testUtils.ts > testPaths
function testPaths<TSnapshot extends Snapshot<unknown>, TEvent extends EventObject>(
  paths: Array<TestPath<TSnapshot, TEvent>>,
  params: TestParam<TSnapshot, TEvent>
) {
  return Effect.gen(function* () {
    for (const path of paths) {
      yield* path.test(params)
    }
  })
}

// upstream: src/graph/test/testUtils.ts > testUtils
export const testUtils = {
  testPaths,
  testModel
}
