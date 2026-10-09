import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { fromTransition } from "../../../src/index.js";
import { TestModel } from "../../../src/graph/index.js";
import { testUtils } from "./testUtils.js";

describe('custom test models', () => {
  // upstream: src/graph/test/testModel.test.ts > custom test models > tests any logic
  it.effect('tests any logic', () => Effect.gen(function* () {
    const transition = fromTransition((value, event) => {
      if (event.type === 'even') {
        return value / 2;
      } else {
        return value * 3 + 1;
      }
    }, 15);

    const model = new TestModel(transition, {
      events: (state) => {
        if (state.context % 2 === 0) {
          return [{ type: 'even' }];
        }
        return [{ type: 'odd' }];
      }
    });

    const paths = yield* model.getShortestPaths({
      toState: (state) => state.context === 1
    });

    expect(paths.length).toBeGreaterThan(0);
  }));

  // upstream: src/graph/test/testModel.test.ts > custom test models > tests states for any logic
  it.effect('tests states for any logic', () => Effect.gen(function* () {
    const testedStateKeys: string[] = [];

    const transition = fromTransition((value, event) => {
      if (event.type === 'even') {
        return value / 2;
      } else {
        return value * 3 + 1;
      }
    }, 15);

    const model = new TestModel(transition, {
      events: (state) => {
        if (state.context % 2 === 0) {
          return [{ type: 'even' }];
        }
        return [{ type: 'odd' }];
      },
      stateMatcher: (state, key) => {
        if (key === 'even') {
          return state.context % 2 === 0;
        }
        if (key === 'odd') {
          return state.context % 2 === 1;
        }
        return false;
      }
    });

    const paths = yield* model.getShortestPaths({
      toState: (state) => state.context === 1
    });

    yield* testUtils.testPaths(paths, {
      states: {
        even: (state) => {
          testedStateKeys.push('even');
          expect(state.context % 2).toBe(0);
        },
        odd: (state) => {
          testedStateKeys.push('odd');
          expect(state.context % 2).toBe(1);
        }
      }
    });

    expect(testedStateKeys).toContain('even');
    expect(testedStateKeys).toContain('odd');
  }));
});
