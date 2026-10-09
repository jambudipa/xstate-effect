import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { StateValue, createMachine } from "../../../src/index.js";
import { createTestModel } from "../../../src/graph/index.js";
import { testUtils } from "./testUtils.js";

describe('states', () => {
  // upstream: src/graph/test/states.test.ts > states > should test states by key
  it.effect('should test states by key', () => Effect.gen(function* () {
    const testedStateValues: StateValue[] = [];
    const testModel = yield* createTestModel(
      createMachine({
        initial: 'a',
        states: {
          a: {
            on: {
              EVENT: 'b'
            }
          },
          b: {
            initial: 'b1',
            states: {
              b1: { on: { NEXT: 'b2' } },
              b2: {}
            }
          }
        }
      })
    );

    yield* testUtils.testModel(testModel, {
      states: {
        a: (state) => {
          testedStateValues.push(state.value);
        },
        b: (state) => {
          testedStateValues.push(state.value);
        },
        'b.b1': (state) => {
          testedStateValues.push(state.value);
        },
        'b.b2': (state) => {
          testedStateValues.push(state.value);
        }
      }
    });

    expect(testedStateValues).toMatchInlineSnapshot(`
      [
        "a",
        {
          "b": "b1",
        },
        {
          "b": "b1",
        },
        {
          "b": "b2",
        },
        {
          "b": "b2",
        },
      ]
    `);
  }));
  // upstream: src/graph/test/states.test.ts > states > should test states by ID
  it.effect('should test states by ID', () => Effect.gen(function* () {
    const testedStateValues: StateValue[] = [];
    const testModel = yield* createTestModel(
      createMachine({
        initial: 'a',
        states: {
          a: {
            id: 'state_a',
            on: {
              EVENT: 'b'
            }
          },
          b: {
            id: 'state_b',
            initial: 'b1',
            states: {
              b1: {
                id: 'state_b1',
                on: { NEXT: 'b2' }
              },
              b2: {
                id: 'state_b2'
              }
            }
          }
        }
      })
    );

    yield* testUtils.testModel(testModel, {
      states: {
        '#state_a': (state) => {
          testedStateValues.push(state.value);
        },
        '#state_b': (state) => {
          testedStateValues.push(state.value);
        },
        '#state_b1': (state) => {
          testedStateValues.push(state.value);
        },
        '#state_b2': (state) => {
          testedStateValues.push(state.value);
        }
      }
    });

    expect(testedStateValues).toMatchInlineSnapshot(`
      [
        "a",
        {
          "b": "b1",
        },
        {
          "b": "b1",
        },
        {
          "b": "b2",
        },
        {
          "b": "b2",
        },
      ]
    `);
  }));
});
