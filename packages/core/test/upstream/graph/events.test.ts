import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { createMachine } from "../../../src/index.js";
import { createTestModel } from "../../../src/graph/index.js";
import { testUtils } from "./testUtils.js";

// SD-13: `createTestModel` is an Effect (its machine validation fails the Effect, channel
// `effect-failure` for `src/graph/validateMachine.ts` in test/verify/upstream-messages.ts),
// and `testUtils.testModel` runs every shortest path as an Effect in place of upstream's
// `await`. The event executors stay plain synchronous functions, as upstream.

describe('events', () => {
  // upstream: src/graph/test/events.test.ts > events > should execute events (`exec` property)
  it.effect('should execute events (`exec` property)', () => Effect.gen(function* () {
    let executed = false;

    const testModel = yield* createTestModel(
      createMachine({
        initial: 'a',
        states: {
          a: {
            on: {
              EVENT: 'b'
            }
          },
          b: {}
        }
      })
    );

    yield* testUtils.testModel(testModel, {
      events: {
        EVENT: () => {
          executed = true;
        }
      }
    });

    expect(executed).toBe(true);
  }));

  // upstream: src/graph/test/events.test.ts > events > should execute events (function)
  it.effect('should execute events (function)', () => Effect.gen(function* () {
    let executed = false;

    const testModel = yield* createTestModel(
      createMachine({
        initial: 'a',
        states: {
          a: {
            on: {
              EVENT: 'b'
            }
          },
          b: {}
        }
      })
    );

    yield* testUtils.testModel(testModel, {
      events: {
        EVENT: () => {
          executed = true;
        }
      }
    });

    expect(executed).toBe(true);
  }));
});
