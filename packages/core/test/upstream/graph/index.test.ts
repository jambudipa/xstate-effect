import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit } from "effect"
import { assign, createMachine, setup } from "../../../src/index.js";
import { createTestModel } from "../../../src/graph/index.js";
import { testUtils } from "./testUtils.js";

// The graph module comes with T7.11/T7.12 (`src/graph/index.ts`, `src/graph/TestModel.ts`).
// SD-13: `createTestModel` returns an Effect (it fails with the `validateMachine` errors,
// `test/verify/upstream-messages.ts`), and `model.getShortestPaths`, `model.testPath` and
// `path.test` return Effects, as `testUtils.ts` already assumes. The event and state test
// callbacks stay plain functions; `expect` inside them runs as upstream.

describe('events', () => {
  // upstream: src/graph/test/index.test.ts > events > should allow for representing many cases
  it.effect('should allow for representing many cases', () => Effect.gen(function* () {
    type Events =
      | { type: 'CLICK_BAD' }
      | { type: 'CLICK_GOOD' }
      | { type: 'CLOSE' }
      | { type: 'ESC' }
      | { type: 'SUBMIT'; value: string };
    const feedbackMachine = createMachine({
      id: 'feedback',
      types: {
        events: {} as Events
      },
      initial: 'question',
      states: {
        question: {
          on: {
            CLICK_GOOD: 'thanks',
            CLICK_BAD: 'form',
            CLOSE: 'closed',
            ESC: 'closed'
          }
        },
        form: {
          on: {
            SUBMIT: [
              {
                target: 'thanks',
                guard: ({ event }) => !!event.value.length
              },
              {
                target: '.invalid'
              }
            ],
            CLOSE: 'closed',
            ESC: 'closed'
          },
          initial: 'valid',
          states: {
            valid: {},
            invalid: {}
          }
        },
        thanks: {
          on: {
            CLOSE: 'closed',
            ESC: 'closed'
          }
        },
        closed: {
          type: 'final'
        }
      }
    });

    const testModel = yield* createTestModel(feedbackMachine, {
      events: [
        { type: 'SUBMIT', value: 'something' },
        { type: 'SUBMIT', value: '' }
      ]
    });

    yield* testUtils.testModel(testModel, {});
  }));

  // upstream: src/graph/test/index.test.ts > events > should not throw an error for unimplemented events
  it.effect('should not throw an error for unimplemented events', () => Effect.gen(function* () {
    const testMachine = createMachine({
      initial: 'idle',
      states: {
        idle: {
          on: { ACTIVATE: 'active' }
        },
        active: {}
      }
    });

    const testModel = yield* createTestModel(testMachine);

    // upstream checks that an async function does not throw synchronously; the Effect form
    // checks that running the model's paths does not fail
    const exit = yield* Effect.exit(testUtils.testModel(testModel, {}));
    expect(Exit.isSuccess(exit)).toBe(true);
  }));

  // upstream: src/graph/test/index.test.ts > events > should allow for dynamic generation of cases based on state
  it.effect('should allow for dynamic generation of cases based on state', () => Effect.gen(function* () {
    const values = [1, 2, 3];
    const testMachine = createMachine({
      types: {} as {
        context: { values: number[] };
        events: { type: 'EVENT'; value: number };
      },
      initial: 'a',
      context: {
        values // to be read by generator
      },
      states: {
        a: {
          on: {
            EVENT: [
              { guard: ({ event }) => event.value === 1, target: 'b' },
              { guard: ({ event }) => event.value === 2, target: 'c' },
              { guard: ({ event }) => event.value === 3, target: 'd' }
            ]
          }
        },
        b: {},
        c: {},
        d: {}
      }
    });

    const testedEvents: any[] = [];

    const testModel = yield* createTestModel(testMachine, {
      events: (state) =>
        state.context.values.map((value) => ({ type: 'EVENT', value }) as const)
    });

    const paths = yield* testModel.getShortestPaths();

    expect(paths.length).toBe(3);

    yield* testUtils.testPaths(paths, {
      events: {
        EVENT: ({ event }) => {
          testedEvents.push(event);
        }
      }
    });

    expect(testedEvents).toMatchInlineSnapshot(`
      [
        {
          "type": "EVENT",
          "value": 1,
        },
        {
          "type": "EVENT",
          "value": 2,
        },
        {
          "type": "EVENT",
          "value": 3,
        },
      ]
    `);
  }));
});

describe('state limiting', () => {
  // upstream: src/graph/test/index.test.ts > state limiting > should limit states with filter option
  it.effect('should limit states with filter option', () => Effect.gen(function* () {
    const machine = createMachine({
      types: {} as { context: { count: number } },
      initial: 'counting',
      context: { count: 0 },
      states: {
        counting: {
          on: {
            INC: {
              actions: assign({
                count: ({ context }) => context.count + 1
              })
            }
          }
        }
      }
    });

    const testModel = yield* createTestModel(machine);

    const testPaths = yield* testModel.getShortestPaths({
      stopWhen: (state) => {
        return state.context.count >= 5;
      }
    });

    expect(testPaths).toHaveLength(1);
  }));
});

// https://github.com/statelyai/xstate/issues/1935
// upstream: src/graph/test/index.test.ts > prevents infinite recursion based on a provided limit
it.effect('prevents infinite recursion based on a provided limit', () => Effect.gen(function* () {
  const machine = createMachine({
    types: {} as { context: { count: number } },
    id: 'machine',
    context: {
      count: 0
    },
    on: {
      TOGGLE: {
        actions: assign({ count: ({ context }) => context.count + 1 })
      }
    }
  });

  const model = yield* createTestModel(machine);

  // upstream asserts a synchronous throw; the port's traversal fails its Effect (SD-13, T7.11)
  expect(
    yield* Effect.flip(model.getShortestPaths({ limit: 100 }))
  ).toMatchInlineSnapshot(`[Error: Traversal limit exceeded]`);
}));

describe('test model options', () => {
  // upstream: src/graph/test/index.test.ts > test model options > options.testState(...) should test state
  it.effect('options.testState(...) should test state', () => Effect.gen(function* () {
    const testedStates: any[] = [];

    const model = yield* createTestModel(
      createMachine({
        initial: 'inactive',
        states: {
          inactive: {
            on: {
              NEXT: 'active'
            }
          },
          active: {}
        }
      })
    );

    yield* testUtils.testModel(model, {
      states: {
        '*': (state) => {
          testedStates.push(state.value);
        }
      }
    });

    expect(testedStates).toEqual(['inactive', 'active']);
  }));
});

// https://github.com/statelyai/xstate/issues/1538
// upstream: src/graph/test/index.test.ts > tests transitions
it.effect('tests transitions', () => Effect.gen(function* () {
  expect.assertions(2);
  const machine = createMachine({
    initial: 'first',
    states: {
      first: {
        on: { NEXT: 'second' }
      },
      second: {}
    }
  });

  const model = yield* createTestModel(machine);

  const paths = yield* model.getShortestPaths({
    toState: (state) => state.matches('second')
  });

  // (`!`: the port's `noUncheckedIndexedAccess`; upstream reads the first path unchecked too)
  yield* paths[0]!.test({
    events: {
      NEXT: (step) => {
        expect(step).toHaveProperty('event');
        expect(step).toHaveProperty('state');
      }
    }
  });
}));

// https://github.com/statelyai/xstate/issues/982
// upstream: src/graph/test/index.test.ts > Event in event executor should contain payload from case
it.effect('Event in event executor should contain payload from case', () => Effect.gen(function* () {
  const machine = createMachine({
    initial: 'first',
    states: {
      first: {
        on: { NEXT: 'second' }
      },
      second: {}
    }
  });

  const obj = {};

  const nonSerializableData = () => 42;

  const model = yield* createTestModel(machine, {
    events: [{ type: 'NEXT', payload: 10, fn: nonSerializableData }]
  });

  const paths = yield* model.getShortestPaths({
    toState: (state) => state.matches('second')
  });

  // (`!`: the port's `noUncheckedIndexedAccess`; upstream reads the first path unchecked too)
  yield* model.testPath(
    paths[0]!,
    {
      events: {
        NEXT: (step) => {
          expect(step.event).toEqual({
            type: 'NEXT',
            payload: 10,
            fn: nonSerializableData
          });
        }
      }
    },
    obj
  );
}));

describe('state tests', () => {
  // upstream: src/graph/test/index.test.ts > state tests > should test states
  it.effect('should test states', () => Effect.gen(function* () {
    // a (1)
    // a -> b (2)
    expect.assertions(2);

    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: { NEXT: 'b' }
        },
        b: {}
      }
    });

    const model = yield* createTestModel(machine);

    yield* testUtils.testModel(model, {
      states: {
        a: (state) => {
          expect(state.value).toEqual('a');
        },
        b: (state) => {
          expect(state.value).toEqual('b');
        }
      }
    });
  }));

  // upstream: src/graph/test/index.test.ts > state tests > should test wildcard state for non-matching states
  it.effect('should test wildcard state for non-matching states', () => Effect.gen(function* () {
    // a (1)
    // a -> b (2)
    // a -> c (2)
    expect.assertions(4);

    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: { NEXT: 'b', OTHER: 'c' }
        },
        b: {},
        c: {}
      }
    });

    const model = yield* createTestModel(machine);

    yield* testUtils.testModel(model, {
      states: {
        a: (state) => {
          expect(state.value).toEqual('a');
        },
        b: (state) => {
          expect(state.value).toEqual('b');
        },
        '*': (state) => {
          expect(state.value).toEqual('c');
        }
      }
    });
  }));

  // upstream: src/graph/test/index.test.ts > state tests > should test nested states
  it.effect('should test nested states', () => Effect.gen(function* () {
    const testedStateValues: any[] = [];

    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: { NEXT: 'b' }
        },
        b: {
          initial: 'b1',
          states: {
            b1: {}
          }
        }
      }
    });

    const model = yield* createTestModel(machine);

    yield* testUtils.testModel(model, {
      states: {
        a: (state) => {
          testedStateValues.push('a');
          expect(state.value).toEqual('a');
        },
        b: (state) => {
          testedStateValues.push('b');
          expect(state.matches('b')).toBe(true);
        },
        'b.b1': (state) => {
          testedStateValues.push('b.b1');
          expect(state.value).toEqual({ b: 'b1' });
        }
      }
    });
    expect(testedStateValues).toMatchInlineSnapshot(`
      [
        "a",
        "b",
        "b.b1",
      ]
    `);
  }));

  // upstream: src/graph/test/index.test.ts > state tests > should test with input
  it.effect('should test with input', () => Effect.gen(function* () {
    const machine = setup({
      types: {
        input: {} as {
          name: string;
        },
        context: {} as {
          name: string;
        }
      }
    }).createMachine({
      context: (x) => ({
        name: x.input.name
      }),
      initial: 'checking',
      states: {
        checking: {
          always: [
            { guard: (x) => x.context.name.length > 3, target: 'longName' },
            { target: 'shortName' }
          ]
        },
        longName: {},
        shortName: {}
      }
    });

    const model = yield* createTestModel(machine);

    const path1 = yield* model.getShortestPaths({
      input: { name: 'ed' }
    });

    // (`!` here and below: the port's `noUncheckedIndexedAccess`; upstream reads the first
    // path unchecked too)
    expect(path1[0]!.steps.map((s) => s.state.value)).toEqual(['shortName']);

    const path2 = yield* model.getShortestPaths({
      input: { name: 'edward' }
    });

    expect(path2[0]!.steps.map((s) => s.state.value)).toEqual(['longName']);
  }));
});
