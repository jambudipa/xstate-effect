import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import {
  assign,
  createMachine,
  getInitialSnapshot,
  getNextSnapshot
} from "../../../src/index.js";
import { createTestModel } from "../../../src/graph/index.js";
import { testUtils } from "./testUtils.js";

const multiPathMachine = createMachine({
  initial: 'a',
  states: {
    a: {
      on: {
        EVENT: 'b'
      }
    },
    b: {
      on: {
        EVENT: 'c'
      }
    },
    c: {
      on: {
        EVENT: 'd',
        EVENT_2: 'e'
      }
    },
    d: {},
    e: {}
  }
});

describe('testModel.testPaths(...)', () => {
  // upstream: src/graph/test/paths.test.ts > testModel.testPaths(...) > custom path generators can be provided
  it.effect('custom path generators can be provided', () => Effect.gen(function* () {
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

    const paths = yield* testModel.getPaths((logic, options) => Effect.gen(function* () {
      const initialState = yield* getInitialSnapshot(logic);
      const events =
        typeof options.events === 'function'
          ? options.events(initialState)
          : (options.events ?? []);

      // (`!` here and below: the port's `noUncheckedIndexedAccess`; upstream reads the first
      // event unchecked too)
      const nextState = yield* getNextSnapshot(logic, initialState, events[0]!);
      return [
        {
          state: nextState,
          steps: [
            {
              state: initialState,
              event: events[0]!
            }
          ],
          weight: 1
        }
      ];
    }));

    yield* testUtils.testPaths(paths, {});
  }));

  describe('When the machine only has one path', () => {
    // upstream: src/graph/test/paths.test.ts > testModel.testPaths(...) > When the machine only has one path > Should only follow that path
    it.effect('Should only follow that path', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'a',
        states: {
          a: {
            on: {
              EVENT: 'b'
            }
          },
          b: {
            on: {
              EVENT: 'c'
            }
          },
          c: {}
        }
      });

      const model = yield* createTestModel(machine);

      const paths = yield* model.getShortestPaths();

      expect(paths).toHaveLength(1);
    }));
  });

  describe('getSimplePaths', () => {
    // upstream: src/graph/test/paths.test.ts > testModel.testPaths(...) > getSimplePaths > Should dedup simple path paths
    it.effect('Should dedup simple path paths', () => Effect.gen(function* () {
      const model = yield* createTestModel(multiPathMachine);

      const paths = yield* model.getSimplePaths();

      expect(paths).toHaveLength(2);
    }));

    // upstream: src/graph/test/paths.test.ts > testModel.testPaths(...) > getSimplePaths > Should not dedup simple path paths if deduplicate: false
    it.effect('Should not dedup simple path paths if deduplicate: false', () => Effect.gen(function* () {
      const model = yield* createTestModel(multiPathMachine);

      const paths = yield* model.getSimplePaths({
        allowDuplicatePaths: true
      });

      expect(paths).toHaveLength(5);
    }));

    // upstream: src/graph/test/paths.test.ts > testModel.testPaths(...) > getSimplePaths > should support filtering disabled events
    it.effect('should support filtering disabled events', () => Effect.gen(function* () {
      const machine = createMachine({
        id: 'guarded-test-model',
        initial: 'start',
        context: { allowed: false },
        states: {
          start: {
            on: { NEXT: 'idle' }
          },
          idle: {
            on: {
              PROCEED: {
                target: 'done',
                guard: ({ context }) => context.allowed
              },
              ALLOW: {
                actions: assign({
                  allowed: true
                })
              }
            }
          },
          done: {
            type: 'final'
          }
        }
      });

      const model = yield* createTestModel(machine);

      const paths = yield* model.getSimplePaths({
        filterEvents: (state, event) => state.can(event),
        toState: (state) => state.status === 'done'
      });

      expect(paths.map((path) => path.description)).toEqual([
        'Reaches state "done"({"allowed":true}): xstate.init → NEXT → ALLOW → PROCEED'
      ]);
    }));
  });
});

describe('path.description', () => {
  // upstream: src/graph/test/paths.test.ts > path.description > Should write a readable description including the target state and the path
  it.effect('Should write a readable description including the target state and the path', () => Effect.gen(function* () {
    const model = yield* createTestModel(multiPathMachine);

    const paths = yield* model.getShortestPaths();

    expect(paths.map((path) => path.description)).toEqual([
      'Reaches state "d": xstate.init → EVENT → EVENT → EVENT',
      'Reaches state "e": xstate.init → EVENT → EVENT → EVENT_2'
    ]);
  }));
});

describe('transition coverage', () => {
  // upstream: src/graph/test/paths.test.ts > transition coverage > path generation should cover all transitions by default
  it.effect('path generation should cover all transitions by default', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            NEXT: 'b',
            END: 'b'
          }
        },
        b: {
          on: {
            PREV: 'a',
            RESTART: 'a'
          }
        }
      }
    });

    const model = yield* createTestModel(machine);

    const paths = yield* model.getShortestPaths();

    expect(paths.map((path) => path.description)).toMatchInlineSnapshot(`
      [
        "Reaches state "a": xstate.init → NEXT → PREV",
        "Reaches state "a": xstate.init → NEXT → RESTART",
        "Reaches state "b": xstate.init → END",
      ]
    `);
  }));

  // upstream: src/graph/test/paths.test.ts > transition coverage > transition coverage should consider guarded transitions
  it.effect('transition coverage should consider guarded transitions', () => Effect.gen(function* () {
    const machine = createMachine(
      {
        initial: 'a',
        states: {
          a: {
            on: {
              NEXT: [{ guard: 'valid', target: 'b' }, { target: 'b' }]
            }
          },
          b: {}
        }
      },
      {
        guards: {
          valid: ({ event }) => {
            return event.value > 10;
          }
        }
      }
    );

    const model = yield* createTestModel(machine);

    const paths = yield* model.getShortestPaths({
      events: [
        { type: 'NEXT', value: 0 },
        { type: 'NEXT', value: 100 },
        { type: 'NEXT', value: 1000 }
      ]
    });

    // { value: 1000 } already covered by first guarded transition
    expect(paths.map((path) => path.description)).toMatchInlineSnapshot(`
      [
        "Reaches state "b": xstate.init → NEXT ({"value":0}) → NEXT ({"value":0})",
        "Reaches state "b": xstate.init → NEXT ({"value":100})",
        "Reaches state "b": xstate.init → NEXT ({"value":1000})",
      ]
    `);
  }));

  // upstream: src/graph/test/paths.test.ts > transition coverage > transition coverage should consider multiple transitions with the same target
  it.effect('transition coverage should consider multiple transitions with the same target', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            GO_TO_B: 'b',
            GO_TO_C: 'c'
          }
        },
        b: {
          on: {
            GO_TO_A: 'a'
          }
        },
        c: {
          on: {
            GO_TO_A: 'a'
          }
        }
      }
    });

    const model = yield* createTestModel(machine);

    const paths = yield* model.getShortestPaths();

    expect(paths.map((p) => p.description)).toEqual([
      `Reaches state "a": xstate.init → GO_TO_B → GO_TO_A`,
      `Reaches state "a": xstate.init → GO_TO_C → GO_TO_A`
    ]);
  }));
});

describe('getShortestPathsTo', () => {
  const machine = createMachine({
    initial: 'open',
    states: {
      open: {
        on: {
          CLOSE: 'closed'
        }
      },
      closed: {
        on: {
          OPEN: 'open'
        }
      }
    }
  });
  // upstream: src/graph/test/paths.test.ts > getShortestPathsTo > Should find a path to a non-initial target state
  it.effect('Should find a path to a non-initial target state', () => Effect.gen(function* () {
    const closedPaths = yield* (yield* createTestModel(machine)).getShortestPaths({
      toState: (state) => state.matches('closed')
    });

    expect(closedPaths).toHaveLength(1);
  }));

  // upstream: src/graph/test/paths.test.ts > getShortestPathsTo > Should find a path to an initial target state
  it.effect('Should find a path to an initial target state', () => Effect.gen(function* () {
    const openPaths = yield* (yield* createTestModel(machine)).getShortestPaths({
      toState: (state) => state.matches('open')
    });

    expect(openPaths).toHaveLength(1);
  }));
});

describe('getShortestPathsFrom', () => {
  // upstream: src/graph/test/paths.test.ts > getShortestPathsFrom > should get shortest paths from array of paths
  it.effect('should get shortest paths from array of paths', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: { NEXT: 'b', OTHER: 'b', TO_C: 'c', TO_D: 'd', TO_E: 'e' }
        },
        b: {
          on: {
            TO_C: 'c',
            TO_D: 'd'
          }
        },
        c: {},
        d: {},
        e: {}
      }
    });
    const model = yield* createTestModel(machine);
    const pathsToB = yield* model.getShortestPaths({
      toState: (state) => state.matches('b')
    });

    // a (NEXT) -> b
    // a (OTHER) -> b
    expect(pathsToB).toHaveLength(2);

    const shortestPaths = yield* model.getShortestPathsFrom(pathsToB);

    // a (NEXT) -> b (TO_C) -> c
    // a (OTHER) -> b (TO_C) -> c
    // a (NEXT) -> b (TO_D) -> d
    // a (OTHER) -> b (TO_D) -> d
    expect(shortestPaths).toHaveLength(4);

    expect(shortestPaths.every((path) => path.steps.length === 3)).toBeTruthy();
  }));

  describe('getSimplePathsFrom', () => {
    // upstream: src/graph/test/paths.test.ts > getShortestPathsFrom > getSimplePathsFrom > should get simple paths from array of paths
    it.effect('should get simple paths from array of paths', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'a',
        states: {
          a: {
            on: { NEXT: 'b', OTHER: 'b', TO_C: 'c', TO_D: 'd', TO_E: 'e' }
          },
          b: {
            on: {
              TO_C: 'c',
              TO_D: 'd'
            }
          },
          c: {},
          d: {},
          e: {}
        }
      });
      const model = yield* createTestModel(machine);
      const pathsToB = yield* model.getSimplePaths({
        toState: (state) => state.matches('b')
      });

      // a (NEXT) -> b
      // a (OTHER) -> b
      expect(pathsToB).toHaveLength(2);

      const simplePaths = yield* model.getSimplePathsFrom(pathsToB);

      // a (NEXT) -> b (TO_C) -> c
      // a (OTHER) -> b (TO_C) -> c
      // a (NEXT) -> b (TO_D) -> d
      // a (OTHER) -> b (TO_D) -> d
      expect(simplePaths).toHaveLength(4);

      expect(simplePaths.every((path) => path.steps.length === 3)).toBeTruthy();
    }));
  });
});
