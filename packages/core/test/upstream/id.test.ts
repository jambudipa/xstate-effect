import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { testAll } from "./utils.js";
import {
  createMachine,
  createActor,
  getNextSnapshot,
  getInitialSnapshot
} from "../../src/index.js";

const idMachine = createMachine({
  initial: 'A',
  states: {
    A: {
      id: 'A',
      initial: 'foo',
      states: {
        foo: {
          id: 'A_foo',
          on: {
            NEXT: '#A_bar'
          }
        },
        bar: {
          id: 'A_bar',
          on: {
            NEXT: '#B_foo'
          }
        }
      },
      on: {
        NEXT_DOT_RESOLVE: '#B.bar'
      }
    },
    B: {
      id: 'B',
      initial: 'foo',
      states: {
        foo: {
          id: 'B_foo',
          on: {
            NEXT: '#B_bar',
            NEXT_DOT: '#B.dot'
          }
        },
        bar: {
          id: 'B_bar',
          on: {
            NEXT: '#A_foo'
          }
        },
        dot: {}
      }
    }
  }
});

describe('State node IDs', () => {
  const expected = {
    A: {
      NEXT: { A: 'bar' },
      NEXT_DOT_RESOLVE: { B: 'bar' }
    },
    '{"A":"foo"}': {
      NEXT: { A: 'bar' }
    },
    '{"A":"bar"}': {
      NEXT: { B: 'foo' }
    },
    '{"B":"foo"}': {
      'NEXT,NEXT': { A: 'foo' },
      NEXT_DOT: { B: 'dot' }
    }
  };

  // upstream: test/id.test.ts > State node IDs > should go from ${fromState} to ${JSON.stringify(toState)} on ${eventTypes}
  testAll(idMachine, expected);

  // upstream: test/id.test.ts > State node IDs > should work with ID + relative path
  it.effect('should work with ID + relative path', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'foo',
      on: {
        ACTION: '#bar.qux.quux'
      },
      states: {
        foo: {
          id: 'foo'
        },
        bar: {
          id: 'bar',
          initial: 'baz',
          states: {
            baz: {},
            qux: {
              initial: 'quux',
              states: {
                quux: {
                  id: '#bar.qux.quux'
                }
              }
            }
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({
      type: 'ACTION'
    }));

    expect((yield* actorRef.getSnapshot).value).toEqual({
      bar: {
        qux: 'quux'
      }
    });
  }));

  // upstream: test/id.test.ts > State node IDs > should work with keys that have escaped periods
  it.effect('should work with keys that have escaped periods', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'start',
      states: {
        start: {
          on: {
            escaped: 'foo\\.bar',
            unescaped: 'foo.bar'
          }
        },
        'foo.bar': {},
        foo: {
          initial: 'bar',
          states: {
            bar: {}
          }
        }
      }
    });

    const initialState = (yield* getInitialSnapshot(machine));
    const escapedState = (yield* getNextSnapshot(machine, initialState, {
      type: 'escaped'
    }));

    expect(escapedState.value).toEqual('foo.bar');

    const unescapedState = (yield* getNextSnapshot(machine, initialState, {
      type: 'unescaped'
    }));
    expect(unescapedState.value).toEqual({ foo: 'bar' });
  }));

  // upstream: test/id.test.ts > State node IDs > should work with IDs that have escaped periods
  it.effect('should work with IDs that have escaped periods', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'start',
      states: {
        start: {
          on: {
            escaped: '#foo\\.bar',
            unescaped: '#foo.bar'
          }
        },
        stateWithDot: {
          id: 'foo.bar'
        },
        foo: {
          id: 'foo',
          initial: 'bar',
          states: {
            bar: {}
          }
        }
      }
    });

    const initialState = (yield* getInitialSnapshot(machine));
    const escapedState = (yield* getNextSnapshot(machine, initialState, {
      type: 'escaped'
    }));

    expect(escapedState.value).toEqual('stateWithDot');

    const unescapedState = (yield* getNextSnapshot(machine, initialState, {
      type: 'unescaped'
    }));
    expect(unescapedState.value).toEqual({ foo: 'bar' });
  }));

  // upstream: test/id.test.ts > State node IDs > should not treat escaped backslash as period's escape
  it.effect("should not treat escaped backslash as period's escape", () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'start',
      states: {
        start: {
          on: {
            EV: '#some\\\\.thing'
          }
        },
        foo: {
          id: 'some\\.thing'
        },
        bar: {
          id: 'some\\',
          initial: 'baz',
          states: {
            baz: {},
            thing: {}
          }
        }
      }
    });

    const initialState = (yield* getInitialSnapshot(machine));
    const escapedState = (yield* getNextSnapshot(machine, initialState, {
      type: 'EV'
    }));

    expect(escapedState.value).toEqual({ bar: 'thing' });
  }));
});
