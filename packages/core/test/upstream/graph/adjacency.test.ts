import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { createMachine } from "../../../src/index.js";
import { adjacencyMapToArray, createTestModel } from "../../../src/graph/index.js";

describe('adjacency maps', () => {
  // upstream: src/graph/test/adjacency.test.ts > adjacency maps > model generates an adjacency map (converted to an array)
  it.effect('model generates an adjacency map (converted to an array)', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'standing',
      states: {
        standing: {
          on: {
            left: 'walking',
            right: 'walking',
            down: 'crouching',
            up: 'jumping'
          }
        },
        walking: {
          on: {
            up: 'jumping',
            stop: 'standing'
          }
        },
        jumping: {
          on: {
            land: 'standing'
          }
        },
        crouching: {
          on: {
            release_down: 'standing'
          }
        }
      }
    });
    const model = yield* createTestModel(machine);

    expect(
      adjacencyMapToArray(yield* model.getAdjacencyMap()).map(
        ({ state, event, nextState }) =>
          `Given Mario is ${state.value}, when ${event.type}, then ${nextState.value}`
      )
    ).toMatchInlineSnapshot(`
      [
        "Given Mario is standing, when left, then walking",
        "Given Mario is standing, when right, then walking",
        "Given Mario is standing, when down, then crouching",
        "Given Mario is standing, when up, then jumping",
        "Given Mario is walking, when up, then jumping",
        "Given Mario is walking, when stop, then standing",
        "Given Mario is walking, when up, then jumping",
        "Given Mario is walking, when stop, then standing",
        "Given Mario is crouching, when release_down, then standing",
        "Given Mario is jumping, when land, then standing",
        "Given Mario is jumping, when land, then standing",
        "Given Mario is standing, when left, then walking",
        "Given Mario is standing, when right, then walking",
        "Given Mario is standing, when down, then crouching",
        "Given Mario is standing, when up, then jumping",
        "Given Mario is standing, when left, then walking",
        "Given Mario is standing, when right, then walking",
        "Given Mario is standing, when down, then crouching",
        "Given Mario is standing, when up, then jumping",
        "Given Mario is standing, when left, then walking",
        "Given Mario is standing, when right, then walking",
        "Given Mario is standing, when down, then crouching",
        "Given Mario is standing, when up, then jumping",
      ]
    `);
  }));

  // upstream: src/graph/test/adjacency.test.ts > adjacency maps > function generates an adjacency map (converted to an array)
  it.effect('function generates an adjacency map (converted to an array)', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'green',
      states: {
        green: {
          on: {
            TIMER: 'yellow'
          }
        },
        yellow: {
          on: {
            TIMER: 'red'
          }
        },
        red: {
          on: {
            TIMER: 'green'
          }
        }
      }
    });

    const arr = adjacencyMapToArray(
      yield* (yield* createTestModel(machine)).getAdjacencyMap()
    );

    expect(
      arr.map((x) => ({
        state: x.state.value,
        event: x.event.type,
        nextState: x.nextState.value
      }))
    ).toMatchInlineSnapshot(`
[
  {
    "event": "TIMER",
    "nextState": "yellow",
    "state": "green",
  },
  {
    "event": "TIMER",
    "nextState": "red",
    "state": "yellow",
  },
  {
    "event": "TIMER",
    "nextState": "green",
    "state": "red",
  },
  {
    "event": "TIMER",
    "nextState": "yellow",
    "state": "green",
  },
]
`);
  }));
});
