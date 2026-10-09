import { describe, expect, it, beforeEach } from "@effect/vitest"
import { Effect } from "effect"
import { assign, createMachine } from "../../../src/index.js";
import { createTestModel } from "../../../src/graph/index.js";
import { getDescription } from "../../../src/graph/utils.js";

// Vitest collects the generated tests synchronously, and upstream computes their paths at
// collection time. The graph functions return Effects (SD-13), so the collection-time calls
// run them with `Effect.runSync`; inside a test they are `yield*`ed.

describe('die hard example', () => {
  interface DieHardContext {
    three: number;
    five: number;
  }

  class Jugs {
    public version = 0;
    public three = 0;
    public five = 0;

    public fillThree() {
      this.three = 3;
    }
    public fillFive() {
      this.five = 5;
    }
    public emptyThree() {
      this.three = 0;
    }
    public emptyFive() {
      this.five = 0;
    }
    public transferThree() {
      const poured = Math.min(5 - this.five, this.three);

      this.three = this.three - poured;
      this.five = this.five + poured;
    }
    public transferFive() {
      const poured = Math.min(3 - this.three, this.five);

      this.three = this.three + poured;
      this.five = this.five - poured;
    }
  }
  let jugs: Jugs;

  const createDieHardModel = () => {
    const dieHardMachine = createMachine(
      {
        types: {} as { context: DieHardContext },
        id: 'dieHard',
        initial: 'pending',
        context: { three: 0, five: 0 },
        states: {
          pending: {
            always: {
              target: 'success',
              guard: 'weHave4Gallons'
            },
            on: {
              POUR_3_TO_5: {
                actions: assign(({ context }) => {
                  const poured = Math.min(5 - context.five, context.three);

                  return {
                    three: context.three - poured,
                    five: context.five + poured
                  };
                })
              },
              POUR_5_TO_3: {
                actions: assign(({ context }) => {
                  const poured = Math.min(3 - context.three, context.five);

                  const res = {
                    three: context.three + poured,
                    five: context.five - poured
                  };

                  return res;
                })
              },
              FILL_3: {
                actions: assign({ three: 3 })
              },
              FILL_5: {
                actions: assign({ five: 5 })
              },
              EMPTY_3: {
                actions: assign({ three: 0 })
              },
              EMPTY_5: {
                actions: assign({ five: 0 })
              }
            }
          },
          success: {
            type: 'final'
          }
        }
      },
      {
        guards: {
          weHave4Gallons: ({ context }) => context.five === 4
        }
      }
    );

    return {
      model: Effect.runSync(createTestModel(dieHardMachine)),
      options: {
        states: {
          pending: (
            state: Effect.Success<ReturnType<(typeof dieHardMachine)['transition']>>
          ) => {
            expect(jugs.five).not.toEqual(4);
            expect(jugs.three).toEqual(state.context.three);
            expect(jugs.five).toEqual(state.context.five);
          },
          success: () => {
            expect(jugs.five).toEqual(4);
          }
        },
        events: {
          POUR_3_TO_5: () =>
            Effect.sync(() => {
              jugs.transferThree();
            }),
          POUR_5_TO_3: () =>
            Effect.sync(() => {
              jugs.transferFive();
            }),
          EMPTY_3: () =>
            Effect.sync(() => {
              jugs.emptyThree();
            }),
          EMPTY_5: () =>
            Effect.sync(() => {
              jugs.emptyFive();
            }),
          FILL_3: () =>
            Effect.sync(() => {
              jugs.fillThree();
            }),
          FILL_5: () =>
            Effect.sync(() => {
              jugs.fillFive();
            })
        }
      }
    };
  };

  beforeEach(() => {
    jugs = new Jugs();
    jugs.version = Math.random();
  });

  describe('testing a model (shortestPathsTo)', () => {
    const dieHardModel = createDieHardModel();

    const paths = Effect.runSync(
      dieHardModel.model.getShortestPaths({
        toState: (state) => state.matches('success')
      })
    );

    // upstream: src/graph/test/dieHard.test.ts > die hard example > testing a model (shortestPathsTo) > should generate the right number of paths
    it.effect('should generate the right number of paths', () => Effect.gen(function* () {
      expect(paths.length).toEqual(2);
    }));

    paths.forEach((path) => {
      describe(`path ${getDescription(path.state)}`, () => {
        // upstream: src/graph/test/dieHard.test.ts > die hard example > testing a model (shortestPathsTo) > path ${getDescription(path.state)} > path ${getDescription(path.state)}
        it.effect(`path ${getDescription(path.state)}`, () => Effect.gen(function* () {
          yield* dieHardModel.model.testPath(path, dieHardModel.options);
        }));
      });
    });
  });

  describe('testing a model (simplePathsTo)', () => {
    const dieHardModel = createDieHardModel();
    const paths = Effect.runSync(
      dieHardModel.model.getSimplePaths({
        toState: (state) => state.matches('success')
      })
    );

    // upstream: src/graph/test/dieHard.test.ts > die hard example > testing a model (simplePathsTo) > should generate the right number of paths
    it.effect('should generate the right number of paths', () => Effect.gen(function* () {
      expect(paths.length).toEqual(14);
    }));

    paths.forEach((path) => {
      describe(`reaches state ${JSON.stringify(
        path.state.value
      )} (${JSON.stringify(path.state.context)})`, () => {
        // upstream: src/graph/test/dieHard.test.ts > die hard example > testing a model (simplePathsTo) > reaches state ${JSON.stringify(path.state.value)} (${JSON.stringify(path.state.context)}) > path ${getDescription(path.state)}
        it.effect(`path ${getDescription(path.state)}`, () => Effect.gen(function* () {
          yield* dieHardModel.model.testPath(path, dieHardModel.options);
        }));
      });
    });
  });

  describe('testing a model (getPathFromEvents)', () => {
    const dieHardModel = createDieHardModel();

    const path = Effect.runSync(
      dieHardModel.model.getPathsFromEvents(
        [
          { type: 'FILL_5' },
          { type: 'POUR_5_TO_3' },
          { type: 'EMPTY_3' },
          { type: 'POUR_5_TO_3' },
          { type: 'FILL_5' },
          { type: 'POUR_5_TO_3' }
        ],
        { toState: (state) => state.matches('success') }
      )
    )[0]!;

    describe(`reaches state ${JSON.stringify(
      path.state.value
    )} (${JSON.stringify(path.state.context)})`, () => {
      // upstream: src/graph/test/dieHard.test.ts > die hard example > testing a model (getPathFromEvents) > reaches state ${JSON.stringify(path.state.value)} (${JSON.stringify(path.state.context)}) > path ${getDescription(path.state)}
      it.effect(`path ${getDescription(path.state)}`, () => Effect.gen(function* () {
        yield* dieHardModel.model.testPath(path, dieHardModel.options);
      }));
    });

    // upstream: src/graph/test/dieHard.test.ts > die hard example > testing a model (getPathFromEvents) > should return no paths if the target does not match the last entered state
    it.effect('should return no paths if the target does not match the last entered state', () => Effect.gen(function* () {
      const paths = yield* dieHardModel.model.getPathsFromEvents(
        [{ type: 'FILL_5' }],
        {
          toState: (state) => state.matches('success')
        }
      );

      expect(paths).toHaveLength(0);
    }));
  });

  describe('.testPath(path)', () => {
    const dieHardModel = createDieHardModel();
    const paths = Effect.runSync(
      dieHardModel.model.getSimplePaths({
        toState: (state) => {
          return state.matches('success') && state.context.three === 0;
        }
      })
    );

    // upstream: src/graph/test/dieHard.test.ts > die hard example > .testPath(path) > should generate the right number of paths
    it.effect('should generate the right number of paths', () => Effect.gen(function* () {
      expect(paths.length).toEqual(6);
    }));

    paths.forEach((path) => {
      describe(`reaches state ${JSON.stringify(
        path.state.value
      )} (${JSON.stringify(path.state.context)})`, () => {
        describe(`path ${getDescription(path.state)}`, () => {
          // upstream: src/graph/test/dieHard.test.ts > die hard example > .testPath(path) > reaches state ${JSON.stringify(path.state.value)} (${JSON.stringify(path.state.context)}) > path ${getDescription(path.state)} > reaches the target state
          it.effect(`reaches the target state`, () => Effect.gen(function* () {
            yield* dieHardModel.model.testPath(path, dieHardModel.options);
          }));
        });
      });
    });
  });
});
describe('error path trace', () => {
  describe('should return trace for failed state', () => {
    const machine = createMachine({
      initial: 'first',
      states: {
        first: {
          on: { NEXT_1: 'second' }
        },
        second: {
          on: { NEXT_2: 'third' }
        },
        third: {}
      }
    });

    const testModel = Effect.runSync(createTestModel(machine));

    // upstream: src/graph/test/dieHard.test.ts > error path trace > should return trace for failed state > should generate the right number of paths
    it.effect('should generate the right number of paths', () => Effect.gen(function* () {
      expect(
        (yield* testModel.getShortestPaths({
          toState: (state) => state.matches('third')
        })).length
      ).toEqual(1);
    }));

    // upstream: src/graph/test/dieHard.test.ts > error path trace > should return trace for failed state > should show an error path trace
    it.effect('should show an error path trace', () => Effect.gen(function* () {
      const path = (yield* testModel.getShortestPaths({
        toState: (state) => state.matches('third')
      }))[0]!;
      // Upstream catches the rejected promise and throws 'Should have failed' when it
      // resolves. Effect.flip gives the path test's failure, and fails this test if the
      // path test succeeds.
      const err: any = yield* Effect.flip(
        testModel.testPath(path, {
          states: {
            third: () => {
              throw new Error('test error');
            }
          }
        })
      );
      expect(err.message).toEqual(expect.stringContaining('test error'));
      expect(err.message).toMatchInlineSnapshot(`
          "test error
          Path:
          	State: {"value":"first"}
          	Event: {"type":"xstate.init"}

          	State: {"value":"second"} via {"type":"xstate.init"}
          	Event: {"type":"NEXT_1"}

          	State: {"value":"third"} via {"type":"NEXT_1"}
          	Event: {"type":"NEXT_2"}

          	State: {"value":"third"} via {"type":"NEXT_2"}"
        `);
    }));
  });
});
