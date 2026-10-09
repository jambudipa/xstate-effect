import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { createMachine, raise } from "../../../src/index.js";
import { createTestModel } from "../../../src/graph/index.js";

// SD-3 / DEV-8: `createTestModel` is not a synchronous throw site. Its machine validation
// fails the Effect with the upstream message (channel `effect-failure` for
// `src/graph/validateMachine.ts` in test/verify/upstream-messages.ts, SD-13), so each
// upstream `expect(() => createTestModel(machine)).toThrow(text)` becomes a check that the
// failure's message contains `text` (what `toThrow(string)` checks). The Effect.flip fails
// the test if the model is created.

describe('Forbidden attributes', () => {
  // upstream: src/graph/test/forbiddenAttributes.test.ts > Forbidden attributes > Should not let you declare invocations on your test machine
  it.effect('Should not let you declare invocations on your test machine', () => Effect.gen(function* () {
    const machine = createMachine({
      invoke: {
        src: 'myInvoke'
      }
    });

    expect(
      (yield* Effect.flip(createTestModel(machine))).message
    ).toContain('Invocations on test machines are not supported');
  }));

  // upstream: src/graph/test/forbiddenAttributes.test.ts > Forbidden attributes > Should not let you declare after on your test machine
  it.effect('Should not let you declare after on your test machine', () => Effect.gen(function* () {
    const machine = createMachine({
      after: {
        5000: {
          actions: () => {}
        }
      }
    });

    expect(
      (yield* Effect.flip(createTestModel(machine))).message
    ).toContain('After events on test machines are not supported');
  }));

  // upstream: src/graph/test/forbiddenAttributes.test.ts > Forbidden attributes > Should not let you delayed actions on your machine
  it.effect('Should not let you delayed actions on your machine', () => Effect.gen(function* () {
    const machine = createMachine({
      entry: [
        raise(
          {
            type: 'EVENT'
          },
          {
            delay: 1000
          }
        )
      ]
    });

    expect(
      (yield* Effect.flip(createTestModel(machine))).message
    ).toContain('Delayed actions on test machines are not supported');
  }));
});
