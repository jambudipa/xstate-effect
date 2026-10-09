import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { createMachine, createActor } from "../../../src/index.js";
import { testAll } from "../utils.js";

describe('Example 6.8', () => {
  const machine = createMachine({
    initial: 'A',
    states: {
      A: {
        on: {
          6: 'F'
        },
        initial: 'B',
        states: {
          B: {
            on: { 1: 'C' }
          },
          C: {
            on: { 2: 'E' }
          },
          D: {
            on: { 3: 'B' }
          },
          E: {
            on: { 4: 'B', 5: 'D' }
          },
          hist: { history: true }
        }
      },
      F: {
        on: {
          5: 'A.hist'
        }
      }
    }
  });

  const expected = {
    A: {
      1: 'A.C',
      6: 'F'
    },
    '{"A":"B"}': {
      1: 'A.C',
      6: 'F',
      FAKE: undefined
    },
    '{"A":"C"}': {
      2: 'A.E',
      6: 'F',
      FAKE: undefined
    },
    '{"A":"D"}': {
      3: 'A.B',
      6: 'F',
      FAKE: undefined
    },
    '{"A":"E"}': {
      4: 'A.B',
      5: 'A.D',
      6: 'F',
      FAKE: undefined
    },
    F: {
      5: 'A.B'
    }
  };

  // upstream: test/examples/6.8.test.ts > Example 6.8 > should go from ${fromState} to ${JSON.stringify(toState)} on ${eventTypes}
  testAll(machine, expected);

  // upstream: test/examples/6.8.test.ts > Example 6.8 > should respect the history mechanism
  it.effect('should respect the history mechanism', () => Effect.gen(function* () {
    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: '1' }));
    (yield* actorRef.send({ type: '6' }));
    (yield* actorRef.send({ type: '5' }));

    expect((yield* actorRef.getSnapshot).value).toEqual({ A: 'C' });
  }));
});
