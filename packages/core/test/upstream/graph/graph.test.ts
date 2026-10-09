import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import {
  type EventObject,
  type Snapshot,
  StateNode,
  assign,
  createMachine,
  fromTransition,
  getInitialSnapshot,
  isMachineSnapshot
} from "../../../src/index.js";
import {
  type StatePath,
  getPathsFromEvents,
  getShortestPaths,
  getSimplePaths,
  getStateNodes,
  joinPaths,
  toDirectedGraph
} from "../../../src/graph/index.js";

// The graph module comes with T7.11 (`src/graph/index.ts`).
// SD-13: the traversals (`getShortestPaths`, `getSimplePaths`, `getPathsFromEvents`) return
// Effects, and `joinPaths` fails its Effect with `Paths cannot be joined` (SD-3,
// `test/verify/upstream-messages.ts`); `getStateNodes` and `toDirectedGraph` only walk the
// state node tree and stay synchronous. `filterEvents` returns an `Effect<boolean>` because
// `snapshot.can` is an Effect (SD-6).
//
// Upstream calls `machine.getInitialSnapshot(createMockActorScope())` (an inert scope from
// the graph's internal `actorScope.ts`). The port's machine reads its actor scope from the
// Effect context, and the root `getInitialSnapshot(machine)` (SD-13) runs it with an inert
// scope, so it stands in for that call.

function getPathsSnapshot(
  paths: Array<StatePath<Snapshot<unknown>, EventObject>>
) {
  return paths.map((path) => getPathSnapshot(path));
}

function getPathSnapshot(path: StatePath<Snapshot<unknown>, any>): {
  state: unknown;
  steps: Array<{ state: unknown; eventType: string }>;
} {
  return {
    state: isMachineSnapshot(path.state)
      ? path.state.value
      : 'context' in path.state
        ? path.state.context
        : path.state,
    steps: path.steps.map((step) => ({
      state: isMachineSnapshot(step.state)
        ? step.state.value
        : 'context' in step.state
          ? step.state.context
          : step.state,
      eventType: step.event.type
    }))
  };
}

describe('@xstate/graph', () => {
  const pedestrianStates = {
    initial: 'walk',
    states: {
      walk: {
        on: {
          PED_COUNTDOWN: {
            target: 'wait',
            actions: ['startCountdown']
          }
        }
      },
      wait: {
        on: {
          PED_COUNTDOWN: 'stop'
        }
      },
      stop: {},
      flashing: {}
    }
  };

  const lightMachine = createMachine({
    id: 'light',
    initial: 'green',
    states: {
      green: {
        on: {
          TIMER: 'yellow',
          POWER_OUTAGE: 'red.flashing',
          PUSH_BUTTON: [
            {
              actions: ['doNothing'] // pushing the walk button never does anything
            }
          ]
        }
      },
      yellow: {
        on: {
          TIMER: 'red',
          POWER_OUTAGE: 'red.flashing'
        }
      },
      red: {
        on: {
          TIMER: 'green',
          POWER_OUTAGE: 'red.flashing'
        },
        ...pedestrianStates
      }
    }
  });

  interface CondMachineCtx {
    id?: string;
  }
  type CondMachineEvents = { type: 'EVENT'; id: string } | { type: 'STATE' };

  const condMachine = createMachine({
    types: {} as { context: CondMachineCtx; events: CondMachineEvents },
    initial: 'pending',
    context: {
      id: undefined
    },
    states: {
      pending: {
        on: {
          EVENT: [
            {
              target: 'foo',
              guard: ({ event }) => event.id === 'foo'
            },
            { target: 'bar' }
          ],
          STATE: [
            {
              target: 'foo',
              guard: ({ context }) => context.id === 'foo'
            },
            { target: 'bar' }
          ]
        }
      },
      foo: {},
      bar: {}
    }
  });

  const parallelMachine = createMachine({
    type: 'parallel',
    id: 'p',
    states: {
      a: {
        initial: 'a1',
        states: {
          a1: {
            on: { 2: 'a2', 3: 'a3' }
          },
          a2: {
            on: { 3: 'a3', 1: 'a1' }
          },
          a3: {}
        }
      },
      b: {
        initial: 'b1',
        states: {
          b1: {
            on: { 2: 'b2', 3: 'b3' }
          },
          b2: {
            on: { 3: 'b3', 1: 'b1' }
          },
          b3: {}
        }
      }
    }
  });

  describe('getStateNodes()', () => {
    // upstream: src/graph/test/graph.test.ts > @xstate/graph > getStateNodes() > should return an array of all nodes
    it.effect('should return an array of all nodes', () => Effect.gen(function* () {
      const nodes = getStateNodes(lightMachine);
      expect(nodes.every((node) => node instanceof StateNode)).toBe(true);
      expect(nodes.map((node) => node.id).sort()).toEqual([
        'light.green',
        'light.red',
        'light.red.flashing',
        'light.red.stop',
        'light.red.wait',
        'light.red.walk',
        'light.yellow'
      ]);
    }));

    // upstream: src/graph/test/graph.test.ts > @xstate/graph > getStateNodes() > should return an array of all nodes (parallel)
    it.effect('should return an array of all nodes (parallel)', () => Effect.gen(function* () {
      const nodes = getStateNodes(parallelMachine);
      expect(nodes.every((node) => node instanceof StateNode)).toBe(true);
      expect(nodes.map((node) => node.id).sort()).toEqual([
        'p.a',
        'p.a.a1',
        'p.a.a2',
        'p.a.a3',
        'p.b',
        'p.b.b1',
        'p.b.b2',
        'p.b.b3'
      ]);
    }));
  });

  describe('getShortestPaths()', () => {
    // upstream: src/graph/test/graph.test.ts > @xstate/graph > getShortestPaths() > should return a mapping of shortest paths to all states
    it.effect('should return a mapping of shortest paths to all states', () => Effect.gen(function* () {
      const paths = yield* getShortestPaths(lightMachine);

      expect(getPathsSnapshot(paths)).toMatchSnapshot('shortest paths');
    }));

    // upstream: src/graph/test/graph.test.ts > @xstate/graph > getShortestPaths() > should return a mapping of shortest paths to all states (parallel)
    it.effect('should return a mapping of shortest paths to all states (parallel)', () => Effect.gen(function* () {
      const paths = yield* getShortestPaths(parallelMachine);
      expect(getPathsSnapshot(paths)).toMatchSnapshot(
        'shortest paths parallel'
      );
    }));

    // upstream: src/graph/test/graph.test.ts > @xstate/graph > getShortestPaths() > the initial state should have a single-length path
    it.effect('the initial state should have a single-length path', () => Effect.gen(function* () {
      const shortestPaths = yield* getShortestPaths(lightMachine);
      const initialSnapshot = yield* getInitialSnapshot(lightMachine);

      expect(
        shortestPaths.find((path) =>
          path.state.matches(
            initialSnapshot.value
          )
        )!.steps
      ).toHaveLength(1);
    }));

    // NOT PORTED (skipped upstream, ledger row): @xstate/graph > getShortestPaths() > should not throw when a condition is present

    // NOT PORTED (skipped upstream, ledger row): @xstate/graph > getShortestPaths() > should represent conditional paths based on context
  });

  describe('getSimplePaths()', () => {
    // upstream: src/graph/test/graph.test.ts > @xstate/graph > getSimplePaths() > should return a mapping of arrays of simple paths to all states
    it.effect('should return a mapping of arrays of simple paths to all states', () => Effect.gen(function* () {
      const paths = yield* getSimplePaths(lightMachine);

      // Multiple different ways to get to flashing (from any other state)
      expect(paths.map((path) => path.state.value)).toMatchInlineSnapshot(`
        [
          "green",
          "yellow",
          {
            "red": "flashing",
          },
          {
            "red": "flashing",
          },
          {
            "red": "flashing",
          },
          {
            "red": "flashing",
          },
          {
            "red": "flashing",
          },
          {
            "red": "walk",
          },
          {
            "red": "wait",
          },
          {
            "red": "stop",
          },
        ]
      `);

      expect(getPathsSnapshot(paths)).toMatchSnapshot();
    }));

    const equivMachine = createMachine({
      initial: 'a',
      states: {
        a: { on: { FOO: 'b', BAR: 'b' } },
        b: { on: { FOO: 'a', BAR: 'a' } }
      }
    });

    // upstream: src/graph/test/graph.test.ts > @xstate/graph > getSimplePaths() > should return a mapping of simple paths to all states (parallel)
    it.effect('should return a mapping of simple paths to all states (parallel)', () => Effect.gen(function* () {
      const paths = yield* getSimplePaths(parallelMachine);

      expect(paths.map((p) => p.state.value)).toMatchInlineSnapshot(`
        [
          {
            "a": "a1",
            "b": "b1",
          },
          {
            "a": "a2",
            "b": "b2",
          },
          {
            "a": "a3",
            "b": "b3",
          },
          {
            "a": "a3",
            "b": "b3",
          },
        ]
      `);
      expect(getPathsSnapshot(paths)).toMatchSnapshot('simple paths parallel');
    }));

    // upstream: src/graph/test/graph.test.ts > @xstate/graph > getSimplePaths() > should return multiple paths for equivalent transitions
    it.effect('should return multiple paths for equivalent transitions', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'a',
        states: {
          a: { on: { FOO: 'b', BAR: 'b' } },
          b: { on: { FOO: 'a', BAR: 'a' } }
        }
      });

      const paths = yield* getSimplePaths(machine);

      expect(paths.map((p) => p.state.value)).toMatchInlineSnapshot(`
        [
          "a",
          "b",
          "b",
        ]
      `);
      expect(getPathsSnapshot(paths)).toMatchSnapshot(
        'simple paths equal transitions'
      );
    }));

    // upstream: src/graph/test/graph.test.ts > @xstate/graph > getSimplePaths() > should return a single-length path for the initial state
    it.effect('should return a single-length path for the initial state', () => Effect.gen(function* () {
      const lightInitial = yield* getInitialSnapshot(lightMachine);
      const equivInitial = yield* getInitialSnapshot(equivMachine);
      expect(
        (yield* getSimplePaths(lightMachine)).find((p) =>
          p.state.matches(
            lightInitial.value
          )
        )
      ).toBeDefined();
      expect(
        (yield* getSimplePaths(lightMachine)).find((p) =>
          p.state.matches(
            lightInitial.value
          )
        )!.steps
      ).toHaveLength(1);
      expect(
        (yield* getSimplePaths(equivMachine)).find((p) =>
          p.state.matches(
            equivInitial.value
          )
        )!
      ).toBeDefined();
      expect(
        (yield* getSimplePaths(equivMachine)).find((p) =>
          p.state.matches(
            equivInitial.value
          )
        )!.steps
      ).toHaveLength(1);
    }));

    // upstream: src/graph/test/graph.test.ts > @xstate/graph > getSimplePaths() > should return value-based paths
    it.effect('should return value-based paths', () => Effect.gen(function* () {
      interface Ctx {
        count: number;
      }
      interface Events {
        type: 'INC';
        value: number;
      }
      const countMachine = createMachine({
        types: {} as { context: Ctx; events: Events },
        id: 'count',
        initial: 'start',
        context: {
          count: 0
        },
        states: {
          start: {
            always: {
              target: 'finish',
              guard: ({ context }) => context.count === 3
            },
            on: {
              INC: {
                actions: assign({
                  count: ({ context }) => context.count + 1
                })
              }
            }
          },
          finish: {}
        }
      });

      const paths = yield* getSimplePaths(countMachine, {
        events: [{ type: 'INC', value: 1 } as const]
      });

      expect(paths.map((p) => p.state.value)).toMatchInlineSnapshot(`
        [
          "start",
          "start",
          "start",
          "finish",
        ]
      `);
      expect(getPathsSnapshot(paths)).toMatchSnapshot('simple paths context');
    }));

    // upstream: src/graph/test/graph.test.ts > @xstate/graph > getSimplePaths() > should support filtering disabled events
    it.effect('should support filtering disabled events', () => Effect.gen(function* () {
      const machine = createMachine({
        id: 'guarded-default-events',
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

      const paths = yield* getSimplePaths(machine, {
        filterEvents: (state, event) =>
          !isMachineSnapshot(state) ? Effect.succeed(true) : state.can(event),
        toState: (state) => state.status === 'done'
      });

      expect(paths.map((path) => path.steps.map((step) => step.event.type)))
        .toMatchInlineSnapshot(`
        [
          [
            "xstate.init",
            "NEXT",
            "ALLOW",
            "PROCEED",
          ],
        ]
      `);
    }));
  });

  describe('getPathFromEvents()', () => {
    // upstream: src/graph/test/graph.test.ts > @xstate/graph > getPathFromEvents() > should return a path to the last entered state by the event sequence
    it.effect('should return a path to the last entered state by the event sequence', () => Effect.gen(function* () {
      const paths = yield* getPathsFromEvents(lightMachine, [
        { type: 'TIMER' },
        { type: 'TIMER' },
        { type: 'TIMER' },
        { type: 'POWER_OUTAGE' }
      ]);

      expect(paths.length).toEqual(1);

      // (`!`: the port's `noUncheckedIndexedAccess`; the length is asserted above)
      expect(getPathSnapshot(paths[0]!)).toMatchSnapshot('path from events');
    }));

    // NOT PORTED (skipped upstream, ledger row): @xstate/graph > getPathFromEvents() > should throw when an invalid event sequence is provided

    // upstream: src/graph/test/graph.test.ts > @xstate/graph > getPathFromEvents() > should return a path from a specified from-state
    it.effect('should return a path from a specified from-state', () => Effect.gen(function* () {
      // (`!`: the port's `noUncheckedIndexedAccess`; `toBeDefined` below checks it)
      const path = (yield* getPathsFromEvents(lightMachine, [{ type: 'TIMER' }], {
        fromState: (yield* lightMachine.resolveState({ value: 'yellow' }))
      }))[0]!;

      expect(path).toBeDefined();

      expect(path.state.matches('red')).toBeTruthy();
    }));
  });

  describe('toDirectedGraph', () => {
    // upstream: src/graph/test/graph.test.ts > @xstate/graph > toDirectedGraph > should represent a statechart as a directed graph
    it.effect('should represent a statechart as a directed graph', () => Effect.gen(function* () {
      const machine = createMachine({
        id: 'light',
        initial: 'green',
        states: {
          green: { on: { TIMER: 'yellow' } },
          yellow: { on: { TIMER: 'red' } },
          red: {
            initial: 'walk',
            states: {
              walk: { on: { COUNTDOWN: 'wait' } },
              wait: { on: { COUNTDOWN: 'stop' } },
              stop: { on: { COUNTDOWN: 'finished' } },
              finished: { type: 'final' }
            },
            onDone: 'green'
          }
        }
      });

      const digraph = toDirectedGraph(machine);

      expect(digraph).toMatchSnapshot();
    }));
  });
});

// upstream: src/graph/test/graph.test.ts > simple paths for transition functions
it.effect('simple paths for transition functions', () => Effect.gen(function* () {
  const transition = fromTransition((s, e) => {
    if (e.type === 'a') {
      return 1;
    }
    if (e.type === 'b' && s === 1) {
      return 2;
    }
    if (e.type === 'reset') {
      return 0;
    }
    return s;
  }, 0);
  const a = yield* getShortestPaths(transition, {
    events: [{ type: 'a' }, { type: 'b' }, { type: 'reset' }],
    serializeState: (v, e) => JSON.stringify(v) + ' | ' + JSON.stringify(e)
  });

  expect(getPathsSnapshot(a)).toMatchSnapshot();
}));

// upstream: src/graph/test/graph.test.ts > shortest paths for transition functions
it.effect('shortest paths for transition functions', () => Effect.gen(function* () {
  const transition = fromTransition((s, e) => {
    if (e.type === 'a') {
      return 1;
    }
    if (e.type === 'b' && s === 1) {
      return 2;
    }
    if (e.type === 'reset') {
      return 0;
    }
    return s;
  }, 0);
  const a = yield* getSimplePaths(transition, {
    events: [{ type: 'a' }, { type: 'b' }, { type: 'reset' }],
    serializeState: (v, e) => JSON.stringify(v) + ' | ' + JSON.stringify(e)
  });

  expect(getPathsSnapshot(a)).toMatchSnapshot();
}));

describe('filtering', () => {
  // upstream: src/graph/test/graph.test.ts > filtering > should not traverse past filtered states
  it.effect('should not traverse past filtered states', () => Effect.gen(function* () {
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

    const shortestPaths = yield* getShortestPaths(machine, {
      events: [{ type: 'INC' }],
      stopWhen: (state) => state.context.count === 5
    });

    expect(shortestPaths.map((p) => p.state.context)).toMatchInlineSnapshot(`
[
  {
    "count": 0,
  },
  {
    "count": 1,
  },
  {
    "count": 2,
  },
  {
    "count": 3,
  },
  {
    "count": 4,
  },
  {
    "count": 5,
  },
]
`);
  }));
});

// upstream: src/graph/test/graph.test.ts > should provide previous state for serializeState()
it.effect('should provide previous state for serializeState()', () => Effect.gen(function* () {
  const machine = createMachine({
    initial: 'a',
    states: {
      a: {
        on: { toB: 'b' }
      },
      b: {
        on: { toC: 'c' }
      },
      c: {
        on: { toA: 'a' }
      }
    }
  });

  const shortestPaths = yield* getShortestPaths(machine, {
    serializeState: (state, event, prevState) => {
      return `${JSON.stringify(state.value)} via ${event?.type}${
        prevState ? ` via ${JSON.stringify(prevState.value)}` : ''
      }`;
    }
  });

  // Should be [1, 4]:
  // 1 (a)
  // 4 (a -> b -> c -> a)
  expect(
    shortestPaths
      .filter((path) => path.state.matches('a'))
      .map((path) => path.steps.length)
  ).toEqual([1, 4]);
}));

// upstream: src/graph/test/graph.test.ts > from-state can be specified
it.effect.each([getShortestPaths, getSimplePaths])(
  'from-state can be specified',
  (pathGetter) => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: { toB: 'b' }
        },
        b: {
          on: { toC: 'c' }
        },
        c: {
          on: { toA: 'a' }
        }
      }
    });

    const paths = yield* pathGetter(machine, {
      fromState: (yield* machine.resolveState({ value: 'b' }))
    });

    // Instead of taking 2 steps to reach state 'b' (A, B),
    // there should exist a path that takes 1 step
    expect(
      paths.find((path) => path.state.matches('b') && path.steps.length === 1)
    ).toBeTruthy();

    // Instead of starting at state 'a', it should take > 0 steps to reach 'a'
    expect(
      paths.find((path) => path.state.matches('a') && path.steps.length > 0)
    ).toBeTruthy();
  })
);

describe('joinPaths()', () => {
  // upstream: src/graph/test/graph.test.ts > joinPaths() > should join two paths
  it.effect('should join two paths', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: { NEXT: 'b' }
        },
        b: {
          on: {
            TO_C: 'c'
          }
        },
        c: {}
      }
    });

    // (`!`: the port's `noUncheckedIndexedAccess`; `toBeDefined` below checks both)
    const pathToB = (yield* getPathsFromEvents(machine, [{ type: 'NEXT' }]))[0]!;
    const pathToC = (yield* getPathsFromEvents(machine, [{ type: 'TO_C' }], {
      fromState: pathToB.state
    }))[0]!;

    expect(pathToB).toBeDefined();
    expect(pathToC).toBeDefined();

    const pathToBAndC = yield* joinPaths(pathToB, pathToC);

    expect(pathToBAndC.steps.map((step) => step.event.type))
      .toMatchInlineSnapshot(`
      [
        "xstate.init",
        "NEXT",
        "TO_C",
      ]
    `);

    expect(pathToBAndC.state.matches('c')).toBeTruthy();
  }));

  // upstream: src/graph/test/graph.test.ts > joinPaths() > should not join two paths with mismatched source/target states
  it.effect('should not join two paths with mismatched source/target states', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: { NEXT: 'b' }
        },
        b: {
          on: {
            TO_C: 'c'
          }
        },
        c: {}
      }
    });

    // (`!`: the port's `noUncheckedIndexedAccess`; `toBeDefined` below checks both)
    const pathToB = (yield* getPathsFromEvents(machine, [{ type: 'NEXT' }]))[0]!;
    const pathToCFromA = (yield* getPathsFromEvents(machine, [{ type: 'TO_C' }]))[0]!;

    expect(pathToB).toBeDefined();
    expect(pathToCFromA).toBeDefined();

    // upstream asserts a synchronous throw; the port's `joinPaths` fails its Effect (SD-3)
    const error = yield* Effect.flip(joinPaths(pathToB, pathToCFromA));
    expect(error.message).toMatch(/Paths cannot be joined/);
  }));
});
