import { describe, expect, it, vi } from "@effect/vitest"
import { Effect, Logger } from "effect"
import { createActor, createMachine, fromCallback } from "../../src/index.js";
import { trackEntries } from "./trackEntries.js";
import { StateNode } from "../../src/index.js";

// An invoked actor runs its logic in its own fiber here, so a test yields its fiber, at most
// 100 times and never on wall-clock time, until the invocation it needs has happened.
const yieldUntil = (done: () => boolean | Effect.Effect<boolean>) =>
  Effect.yieldNow.pipe(Effect.repeat({ until: done, times: 100 }));

// Before an exact count: give every enqueued invocation the chance to run, so that the count
// is not vacuous.
const settle = yieldUntil(() => false);

// Upstream spies on `console.warn`. The port reports a warning through the actor's logger
// (`Effect.logWarning` by default, SD-21), never through the console. This test logger keeps
// every log entry so a test can assert on the warning.
const testLogger = (entries: Array<Logger.Options<unknown>>) =>
  Logger.layer([
    Logger.make((options) => {
      entries.push(options);
    })
  ]);

// The message parts of one log entry, as the arguments of one upstream `console.warn` call.
const messageParts = (entry: Logger.Options<unknown>): ReadonlyArray<unknown> =>
  Array.isArray(entry.message) ? entry.message : [entry.message];

describe('history states', () => {
  // upstream: test/history.test.ts > history states > should go to the most recently visited state (explicit shallow history type)
  it.effect('should go to the most recently visited state (explicit shallow history type)', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'on',
      states: {
        on: {
          initial: 'first',
          states: {
            first: {
              on: { SWITCH: 'second' }
            },
            second: {},
            hist: {
              type: 'history',
              history: 'shallow'
            }
          },
          on: {
            POWER: 'off'
          }
        },
        off: {
          on: { POWER: 'on.hist' }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'SWITCH' }));
    (yield* actorRef.send({ type: 'POWER' }));
    (yield* actorRef.send({ type: 'POWER' }));

    expect((yield* actorRef.getSnapshot).value).toEqual({ on: 'second' });
  }));

  // upstream: test/history.test.ts > history states > should go to the most recently visited state (no explicit history type)
  it.effect('should go to the most recently visited state (no explicit history type)', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'on',
      states: {
        on: {
          initial: 'first',
          states: {
            first: {
              on: { SWITCH: 'second' }
            },
            second: {},
            hist: {
              type: 'history'
            }
          },
          on: {
            POWER: 'off'
          }
        },
        off: {
          on: { POWER: 'on.hist' }
        }
      }
    });
    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'SWITCH' }));
    (yield* actorRef.send({ type: 'POWER' }));
    (yield* actorRef.send({ type: 'POWER' }));

    expect((yield* actorRef.getSnapshot).value).toEqual({ on: 'second' });
  }));

  // upstream: test/history.test.ts > history states > should go to the initial state when no history present (explicit shallow history type)
  it.effect('should go to the initial state when no history present (explicit shallow history type)', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'off',
      states: {
        off: {
          on: { POWER: 'on.hist' }
        },
        on: {
          initial: 'first',
          states: {
            first: {},
            second: {},
            hist: {
              type: 'history',
              history: 'shallow'
            }
          }
        }
      }
    });
    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'POWER' }));

    expect((yield* actorRef.getSnapshot).value).toEqual({ on: 'first' });
  }));

  // upstream: test/history.test.ts > history states > should go to the initial state when no history present (no explicit history type)
  it.effect('should go to the initial state when no history present (no explicit history type)', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'off',
      states: {
        off: {
          on: { POWER: 'on.hist' }
        },
        on: {
          initial: 'first',
          states: {
            first: {},
            second: {},
            hist: {
              type: 'history'
            }
          }
        }
      }
    });
    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'POWER' }));

    expect((yield* actorRef.getSnapshot).value).toEqual({ on: 'first' });
  }));

  // upstream: test/history.test.ts > history states > should go to the most recently visited state by a transient transition
  it.effect('should go to the most recently visited state by a transient transition', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'idle',
      states: {
        idle: {
          id: 'idle',
          initial: 'absent',
          states: {
            absent: {
              on: {
                DEPLOY: '#deploy'
              }
            },
            present: {
              on: {
                DEPLOY: '#deploy',
                DESTROY: '#destroy'
              }
            },
            hist: {
              type: 'history'
            }
          }
        },
        deploy: {
          id: 'deploy',
          on: {
            SUCCESS: 'idle.present',
            FAILURE: 'idle.hist'
          }
        },
        destroy: {
          id: 'destroy',
          always: [{ target: 'idle.absent' }]
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'DEPLOY' }));
    (yield* actorRef.send({ type: 'SUCCESS' }));
    (yield* actorRef.send({ type: 'DESTROY' }));
    (yield* actorRef.send({ type: 'DEPLOY' }));
    (yield* actorRef.send({ type: 'FAILURE' }));

    expect((yield* actorRef.getSnapshot).value).toEqual({ idle: 'absent' });
  }));

  // upstream: test/history.test.ts > history states > should reenter persisted state during reentering transition targeting a history state
  it.effect('should reenter persisted state during reentering transition targeting a history state', () => Effect.gen(function* () {
    const actual: string[] = [];

    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            REENTER: {
              target: '#b_hist',
              reenter: true
            }
          },
          initial: 'a1',
          states: {
            a1: {
              on: {
                NEXT: 'a2'
              }
            },
            a2: {
              entry: () => actual.push('a2 entered'),
              exit: () => actual.push('a2 exited')
            },
            a3: {
              type: 'history',
              id: 'b_hist'
            }
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'NEXT' }));

    actual.length = 0;
    (yield* actorRef.send({ type: 'REENTER' }));

    expect(actual).toEqual(['a2 exited', 'a2 entered']);
  }));

  // upstream: test/history.test.ts > history states > should go to the configured default target when a history state is the initial state of the machine
  it.effect('should go to the configured default target when a history state is the initial state of the machine', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'foo',
      states: {
        foo: {
          type: 'history',
          target: 'bar'
        },
        bar: {}
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect((yield* actorRef.getSnapshot).value).toBe('bar');
  }));

  // upstream: test/history.test.ts > history states > should go to the configured default target when a history state is the initial state of the transition's target
  it.effect(`should go to the configured default target when a history state is the initial state of the transition's target`, () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'foo',
      states: {
        foo: {
          on: {
            NEXT: 'bar'
          }
        },
        bar: {
          initial: 'baz',
          states: {
            baz: {
              type: 'history',
              target: 'qwe'
            },
            qwe: {}
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'NEXT' }));

    expect((yield* actorRef.getSnapshot).value).toEqual({
      bar: 'qwe'
    });
  }));

  // upstream: test/history.test.ts > history states > should execute actions of the initial transition when a history state without a default target is targeted and its parent state was never visited yet
  it.effect('should execute actions of the initial transition when a history state without a default target is targeted and its parent state was never visited yet', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: { NEXT: '#hist' }
        },
        b: {
          initial: {
            target: 'b1',
            actions: spy
          },
          states: {
            b1: {},
            b2: {
              id: 'hist',
              type: 'history'
            }
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'NEXT' }));

    expect(spy).toHaveBeenCalledTimes(1);
  }));

  // upstream: test/history.test.ts > history states > should enter the parallel default configuration when a deep history state without a default target is targeted and its parent parallel state was never visited yet
  it.effect('should enter the parallel default configuration when a deep history state without a default target is targeted and its parent parallel state was never visited yet', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'off',
      states: {
        off: {
          on: { GO: 'on.hist' }
        },
        on: {
          type: 'parallel',
          states: {
            regA: { initial: 'a1', states: { a1: {}, a2: {} } },
            regB: { initial: 'b1', states: { b1: {}, b2: {} } },
            hist: { type: 'history', history: 'deep' }
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'GO' }));

    expect((yield* actorRef.getSnapshot).value).toEqual({
      on: { regA: 'a1', regB: 'b1' }
    });
  }));

  // upstream: test/history.test.ts > history states > should enter the parallel default configuration when a shallow history state without a default target is targeted and its parent parallel state was never visited yet
  it.effect('should enter the parallel default configuration when a shallow history state without a default target is targeted and its parent parallel state was never visited yet', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'off',
      states: {
        off: {
          on: { GO: 'on.hist' }
        },
        on: {
          type: 'parallel',
          states: {
            regA: { initial: 'a1', states: { a1: {}, a2: {} } },
            regB: { initial: 'b1', states: { b1: {}, b2: {} } },
            hist: { type: 'history', history: 'shallow' }
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'GO' }));

    expect((yield* actorRef.getSnapshot).value).toEqual({
      on: { regA: 'a1', regB: 'b1' }
    });
  }));

  // upstream: test/history.test.ts > history states > should not execute actions of the initial transition when a history state with a default target is targeted and its parent state was never visited yet
  it.effect('should not execute actions of the initial transition when a history state with a default target is targeted and its parent state was never visited yet', () => Effect.gen(function* () {
    const spy = vi.fn();
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: { NEXT: '#hist' }
        },
        b: {
          initial: {
            target: 'b1',
            actions: spy
          },
          states: {
            b1: {},
            b2: {
              id: 'hist',
              type: 'history',
              target: 'b3'
            },
            b3: {}
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'NEXT' }));

    expect(spy).not.toHaveBeenCalled();
  }));

  // upstream: test/history.test.ts > history states > should execute entry actions of a parent of the targeted history state when its parent state was never visited yet
  it.effect('should execute entry actions of a parent of the targeted history state when its parent state was never visited yet', () => Effect.gen(function* () {
    const spy = vi.fn();
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: { NEXT: '#hist' }
        },
        b: {
          entry: spy,
          initial: 'b1',
          states: {
            b1: {},
            b2: {
              id: 'hist',
              type: 'history',
              target: 'b3'
            },
            b3: {}
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'NEXT' }));

    expect(spy).toHaveBeenCalledTimes(1);
  }));

  // upstream: test/history.test.ts > history states > should execute actions of the initial transition when it select a history state as the initial state of its parent
  it.effect('should execute actions of the initial transition when it select a history state as the initial state of its parent', () => Effect.gen(function* () {
    const spy = vi.fn();
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: { NEXT: 'b' }
        },
        b: {
          initial: {
            target: 'b1',
            actions: spy
          },
          states: {
            b1: {
              id: 'hist',
              type: 'history',
              target: 'b2'
            },
            b2: {}
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'NEXT' }));

    expect(spy).toHaveBeenCalledTimes(1);
  }));

  // upstream: test/history.test.ts > history states > should execute actions of the initial transition when a history state without a default target is targeted and its parent state was already visited
  it.effect('should execute actions of the initial transition when a history state without a default target is targeted and its parent state was already visited', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: { NEXT: '#hist' }
        },
        b: {
          initial: {
            target: 'b1',
            actions: spy
          },
          states: {
            b1: {},
            b2: {
              id: 'hist',
              type: 'history'
            }
          },
          on: {
            NEXT: 'a'
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'NEXT' }));
    spy.mockClear();

    (yield* actorRef.send({ type: 'NEXT' }));
    (yield* actorRef.send({ type: 'NEXT' }));

    expect(spy).toHaveBeenCalledTimes(0);
  }));

  // upstream: test/history.test.ts > history states > should not execute actions of the initial transition when a history state with a default target is targeted and its parent state was already visited
  it.effect('should not execute actions of the initial transition when a history state with a default target is targeted and its parent state was already visited', () => Effect.gen(function* () {
    const spy = vi.fn();
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: { NEXT: '#hist' }
        },
        b: {
          initial: {
            target: 'b1',
            actions: spy
          },
          states: {
            b1: {},
            b2: {
              id: 'hist',
              type: 'history',
              target: 'b3'
            },
            b3: {}
          },
          on: {
            NEXT: 'a'
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'NEXT' }));
    spy.mockClear();

    (yield* actorRef.send({ type: 'NEXT' }));
    (yield* actorRef.send({ type: 'NEXT' }));

    expect(spy).not.toHaveBeenCalled();
  }));

  // upstream: test/history.test.ts > history states > should execute entry actions of a parent of the targeted history state when its parent state was already visited
  it.effect('should execute entry actions of a parent of the targeted history state when its parent state was already visited', () => Effect.gen(function* () {
    const spy = vi.fn();
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: { NEXT: '#hist' }
        },
        b: {
          entry: spy,
          initial: 'b1',
          states: {
            b1: {},
            b2: {
              id: 'hist',
              type: 'history',
              target: 'b3'
            },
            b3: {}
          },
          on: {
            NEXT: 'a'
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'NEXT' }));
    spy.mockClear();

    (yield* actorRef.send({ type: 'NEXT' }));
    (yield* actorRef.send({ type: 'NEXT' }));

    expect(spy).toHaveBeenCalledTimes(1);
  }));

  // upstream: test/history.test.ts > history states > should invoke an actor when reentering the stored configuration through the history state
  it.effect('should invoke an actor when reentering the stored configuration through the history state', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine({
      initial: 'running',
      states: {
        running: {
          on: {
            PING: {
              target: 'refresh'
            }
          },
          invoke: {
            src: fromCallback(spy)
          }
        },
        refresh: {
          type: 'history'
        }
      }
    });
    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    // upstream starts the invoked callback inside `start`; here the child runs its logic in
    // its own fiber: let the first invocation happen before the spy is cleared
    yield* yieldUntil(() => spy.mock.calls.length > 0);
    spy.mockClear();

    (yield* actorRef.send({ type: 'PING' }));

    // the re-invoked child runs in its own fiber: let it (and any extra invocation) run
    yield* settle;

    expect(spy).toHaveBeenCalledTimes(1);
  }));

  // upstream: test/history.test.ts > history states > should not enter ancestors of the entered history state that lie outside of the transition domain when entering the default history configuration
  it.effect('should not enter ancestors of the entered history state that lie outside of the transition domain when entering the default history configuration', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'closed',
      states: {
        closed: {
          on: {
            'BUTTON.CLICK': 'open.hist'
          }
        },
        open: {
          on: {
            'BUTTON.CLICK': 'closed'
          },
          initial: 'first',
          states: {
            hist: { type: 'history' },
            first: {},
            second: {}
          }
        }
      }
    });

    const flushTracked = trackEntries(machine);

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    flushTracked();

    (yield* actorRef.send({ type: 'BUTTON.CLICK' }));
    expect(flushTracked()).toEqual([
      'exit: closed',
      'enter: open',
      'enter: open.first'
    ]);
  }));

  // upstream: test/history.test.ts > history states > should not enter ancestors of the entered history state that lie outside of the transition domain when restoring the stored history configuration
  it.effect('should not enter ancestors of the entered history state that lie outside of the transition domain when restoring the stored history configuration', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'closed',
      states: {
        closed: {
          id: 'closed',
          on: {
            'BUTTON.CLICK': 'open.hist'
          }
        },
        open: {
          on: {
            'BUTTON.CLICK': 'closed'
          },
          initial: 'first',
          states: {
            hist: { type: 'history' },
            first: {
              on: {
                NEXT: 'second'
              }
            },
            second: {
              on: {
                CLOSE: '#closed'
              }
            }
          }
        }
      }
    });

    const flushTracked = trackEntries(machine);

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'BUTTON.CLICK' }));
    (yield* actorRef.send({ type: 'NEXT' }));
    (yield* actorRef.send({ type: 'CLOSE' }));

    flushTracked();

    (yield* actorRef.send({ type: 'BUTTON.CLICK' }));
    expect(flushTracked()).toEqual([
      'exit: closed',
      'enter: open',
      'enter: open.second'
    ]);
  }));
});

describe('deep history states', () => {
  // upstream: test/history.test.ts > deep history states > should go to the shallow history
  it.effect('should go to the shallow history', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'on',
      states: {
        off: {
          on: {
            POWER: 'on.history'
          }
        },
        on: {
          initial: 'first',
          states: {
            first: {
              on: { SWITCH: 'second' }
            },
            second: {
              initial: 'A',
              states: {
                A: {
                  on: { INNER: 'B' }
                },
                B: {
                  initial: 'P',
                  states: {
                    P: {},
                    Q: {}
                  }
                }
              }
            },
            history: { history: 'shallow' }
          },
          on: {
            POWER: 'off'
          }
        }
      }
    });
    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'SWITCH' }));
    (yield* actorRef.send({ type: 'INNER' }));
    (yield* actorRef.send({ type: 'POWER' }));
    (yield* actorRef.send({ type: 'POWER' }));

    expect((yield* actorRef.getSnapshot).value).toEqual({
      on: {
        second: 'A'
      }
    });
  }));

  // upstream: test/history.test.ts > deep history states > should go to the deep history (explicit)
  it.effect('should go to the deep history (explicit)', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'on',
      states: {
        off: {
          on: {
            POWER: 'on.history'
          }
        },
        on: {
          initial: 'first',
          states: {
            first: {
              on: { SWITCH: 'second' }
            },
            second: {
              initial: 'A',
              states: {
                A: {
                  on: { INNER: 'B' }
                },
                B: {
                  initial: 'P',
                  states: {
                    P: {},
                    Q: {}
                  }
                }
              }
            },
            history: { history: 'deep' }
          },
          on: {
            POWER: 'off'
          }
        }
      }
    });
    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'SWITCH' }));
    (yield* actorRef.send({ type: 'INNER' }));
    (yield* actorRef.send({ type: 'POWER' }));
    (yield* actorRef.send({ type: 'POWER' }));

    expect((yield* actorRef.getSnapshot).value).toEqual({
      on: {
        second: {
          B: 'P'
        }
      }
    });
  }));

  // upstream: test/history.test.ts > deep history states > should go to the deepest history
  it.effect('should go to the deepest history', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'on',
      states: {
        off: {
          on: {
            POWER: 'on.history'
          }
        },
        on: {
          initial: 'first',
          states: {
            first: {
              on: { SWITCH: 'second' }
            },
            second: {
              initial: 'A',
              states: {
                A: {
                  on: { INNER: 'B' }
                },
                B: {
                  initial: 'P',
                  states: {
                    P: {
                      on: { INNER: 'Q' }
                    },
                    Q: {}
                  }
                }
              }
            },
            history: { history: 'deep' }
          },
          on: {
            POWER: 'off'
          }
        }
      }
    });
    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'SWITCH' }));
    (yield* actorRef.send({ type: 'INNER' }));
    (yield* actorRef.send({ type: 'INNER' }));
    (yield* actorRef.send({ type: 'POWER' }));
    (yield* actorRef.send({ type: 'POWER' }));

    expect((yield* actorRef.getSnapshot).value).toEqual({
      on: {
        second: {
          B: 'Q'
        }
      }
    });
  }));
});

describe('parallel history states', () => {
  // upstream: test/history.test.ts > parallel history states > should ignore parallel state history
  it.effect('should ignore parallel state history', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'off',
      states: {
        off: {
          on: {
            SWITCH: 'on',
            POWER: 'on.hist'
          }
        },
        on: {
          type: 'parallel',
          states: {
            A: {
              initial: 'B',
              states: {
                B: {
                  on: { INNER_A: 'C' }
                },
                C: {
                  initial: 'D',
                  states: {
                    D: {},
                    E: {}
                  }
                },
                hist: { history: true }
              }
            },
            K: {
              initial: 'L',
              states: {
                L: {},
                M: {},
                hist: { history: true },
                deepHistory: {
                  history: 'deep'
                }
              }
            },
            hist: {
              history: true
            }
          },
          on: {
            POWER: 'off'
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'SWITCH' }));
    (yield* actorRef.send({ type: 'INNER_A' }));
    (yield* actorRef.send({ type: 'POWER' }));
    (yield* actorRef.send({ type: 'POWER' }));

    expect((yield* actorRef.getSnapshot).value).toEqual({
      on: {
        A: 'B',
        K: 'L'
      }
    });
  }));

  // upstream: test/history.test.ts > parallel history states > should remember first level state history
  it.effect('should remember first level state history', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'off',
      states: {
        off: {
          on: {
            SWITCH: 'on',
            DEEP_POWER: 'on.deepHistory'
          }
        },
        on: {
          type: 'parallel',
          states: {
            A: {
              initial: 'B',
              states: {
                B: {
                  on: { INNER_A: 'C' }
                },
                C: {
                  initial: 'D',
                  states: {
                    D: {},
                    E: {}
                  }
                },
                hist: { history: true },
                deepHistory: {
                  history: 'deep'
                }
              }
            },
            K: {
              initial: 'L',
              states: {
                L: {},
                M: {},
                hist: { history: true },
                deepHistory: {
                  history: 'deep'
                }
              }
            },
            deepHistory: {
              history: 'deep'
            }
          },
          on: {
            POWER: 'off'
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'SWITCH' }));
    (yield* actorRef.send({ type: 'INNER_A' }));
    (yield* actorRef.send({ type: 'POWER' }));
    (yield* actorRef.send({ type: 'DEEP_POWER' }));

    expect((yield* actorRef.getSnapshot).value).toEqual({
      on: {
        A: {
          C: 'D'
        },
        K: 'L'
      }
    });
  }));

  // upstream: test/history.test.ts > parallel history states > should re-enter each regions of parallel state correctly
  it.effect('should re-enter each regions of parallel state correctly', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'off',
      states: {
        off: {
          on: {
            SWITCH: 'on',
            DEEP_POWER: 'on.deepHistory'
          }
        },
        on: {
          type: 'parallel',
          states: {
            A: {
              initial: 'B',
              states: {
                B: {
                  on: { INNER_A: 'C' }
                },
                C: {
                  initial: 'D',
                  states: {
                    D: {
                      on: { INNER_A: 'E' }
                    },
                    E: {}
                  }
                },
                hist: { history: true },
                deepHistory: {
                  history: 'deep'
                }
              }
            },
            K: {
              initial: 'L',
              states: {
                L: {
                  on: { INNER_K: 'M' }
                },
                M: {
                  initial: 'N',
                  states: {
                    N: {
                      on: { INNER_K: 'O' }
                    },
                    O: {}
                  }
                },
                hist: { history: true },
                deepHistory: {
                  history: 'deep'
                }
              }
            },
            hist: {
              history: true
            },
            shallowHistory: {
              history: 'shallow'
            },
            deepHistory: {
              history: 'deep'
            }
          },
          on: {
            POWER: 'off'
          }
        }
      }
    });
    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'SWITCH' }));
    (yield* actorRef.send({ type: 'INNER_A' }));
    (yield* actorRef.send({ type: 'INNER_A' }));
    (yield* actorRef.send({ type: 'INNER_K' }));
    (yield* actorRef.send({ type: 'INNER_K' }));
    (yield* actorRef.send({ type: 'POWER' }));
    (yield* actorRef.send({ type: 'DEEP_POWER' }));

    expect((yield* actorRef.getSnapshot).value).toEqual({
      on: {
        A: { C: 'E' },
        K: { M: 'O' }
      }
    });
  }));

  // upstream: test/history.test.ts > parallel history states > should re-enter multiple history states
  it.effect('should re-enter multiple history states', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'off',
      states: {
        off: {
          on: {
            SWITCH: 'on',
            PARALLEL_HISTORY: [{ target: ['on.A.hist', 'on.K.hist'] }]
          }
        },
        on: {
          type: 'parallel',
          states: {
            A: {
              initial: 'B',
              states: {
                B: {
                  on: { INNER_A: 'C' }
                },
                C: {
                  initial: 'D',
                  states: {
                    D: {
                      on: { INNER_A: 'E' }
                    },
                    E: {}
                  }
                },
                hist: { history: true },
                deepHistory: {
                  history: 'deep'
                }
              }
            },
            K: {
              initial: 'L',
              states: {
                L: {
                  on: { INNER_K: 'M' }
                },
                M: {
                  initial: 'N',
                  states: {
                    N: {
                      on: { INNER_K: 'O' }
                    },
                    O: {}
                  }
                },
                hist: { history: true },
                deepHistory: {
                  history: 'deep'
                }
              }
            },
            hist: {
              history: true
            },
            shallowHistory: {
              history: 'shallow'
            },
            deepHistory: {
              history: 'deep'
            }
          },
          on: {
            POWER: 'off'
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'SWITCH' }));
    (yield* actorRef.send({ type: 'INNER_A' }));
    (yield* actorRef.send({ type: 'INNER_A' }));
    (yield* actorRef.send({ type: 'INNER_K' }));
    (yield* actorRef.send({ type: 'INNER_K' }));
    (yield* actorRef.send({ type: 'POWER' }));
    (yield* actorRef.send({ type: 'PARALLEL_HISTORY' }));

    expect((yield* actorRef.getSnapshot).value).toEqual({
      on: {
        A: { C: 'D' },
        K: { M: 'N' }
      }
    });
  }));

  // upstream: test/history.test.ts > parallel history states > should re-enter a parallel with partial history
  it.effect('should re-enter a parallel with partial history', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'off',
      states: {
        off: {
          on: {
            SWITCH: 'on',
            PARALLEL_SOME_HISTORY: [{ target: ['on.A.C', 'on.K.hist'] }]
          }
        },
        on: {
          type: 'parallel',
          states: {
            A: {
              initial: 'B',
              states: {
                B: {
                  on: { INNER_A: 'C' }
                },
                C: {
                  initial: 'D',
                  states: {
                    D: {
                      on: { INNER_A: 'E' }
                    },
                    E: {}
                  }
                },
                hist: { history: true },
                deepHistory: {
                  history: 'deep'
                }
              }
            },
            K: {
              initial: 'L',
              states: {
                L: {
                  on: { INNER_K: 'M' }
                },
                M: {
                  initial: 'N',
                  states: {
                    N: {
                      on: { INNER_K: 'O' }
                    },
                    O: {}
                  }
                },
                hist: { history: true },
                deepHistory: {
                  history: 'deep'
                }
              }
            },
            hist: {
              history: true
            },
            shallowHistory: {
              history: 'shallow'
            },
            deepHistory: {
              history: 'deep'
            }
          },
          on: {
            POWER: 'off'
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'SWITCH' }));
    (yield* actorRef.send({ type: 'INNER_A' }));
    (yield* actorRef.send({ type: 'INNER_A' }));
    (yield* actorRef.send({ type: 'INNER_K' }));
    (yield* actorRef.send({ type: 'INNER_K' }));
    (yield* actorRef.send({ type: 'POWER' }));
    (yield* actorRef.send({ type: 'PARALLEL_SOME_HISTORY' }));

    expect((yield* actorRef.getSnapshot).value).toEqual({
      on: {
        A: { C: 'D' },
        K: { M: 'N' }
      }
    });
  }));

  // upstream: test/history.test.ts > parallel history states > should re-enter a parallel with full history
  it.effect('should re-enter a parallel with full history', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'off',
      states: {
        off: {
          on: {
            SWITCH: 'on',
            PARALLEL_DEEP_HISTORY: [
              { target: ['on.A.deepHistory', 'on.K.deepHistory'] }
            ]
          }
        },
        on: {
          type: 'parallel',
          states: {
            A: {
              initial: 'B',
              states: {
                B: {
                  on: { INNER_A: 'C' }
                },
                C: {
                  initial: 'D',
                  states: {
                    D: {
                      on: { INNER_A: 'E' }
                    },
                    E: {}
                  }
                },
                hist: { history: true },
                deepHistory: {
                  history: 'deep'
                }
              }
            },
            K: {
              initial: 'L',
              states: {
                L: {
                  on: { INNER_K: 'M' }
                },
                M: {
                  initial: 'N',
                  states: {
                    N: {
                      on: { INNER_K: 'O' }
                    },
                    O: {}
                  }
                },
                hist: { history: true },
                deepHistory: {
                  history: 'deep'
                }
              }
            },
            hist: {
              history: true
            },
            shallowHistory: {
              history: 'shallow'
            },
            deepHistory: {
              history: 'deep'
            }
          },
          on: {
            POWER: 'off'
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'SWITCH' }));
    (yield* actorRef.send({ type: 'INNER_A' }));
    (yield* actorRef.send({ type: 'INNER_A' }));
    (yield* actorRef.send({ type: 'INNER_K' }));
    (yield* actorRef.send({ type: 'INNER_K' }));
    (yield* actorRef.send({ type: 'POWER' }));
    (yield* actorRef.send({ type: 'PARALLEL_DEEP_HISTORY' }));

    expect((yield* actorRef.getSnapshot).value).toEqual({
      on: {
        A: { C: 'E' },
        K: { M: 'O' }
      }
    });
  }));
});

// upstream: test/history.test.ts > internal transition to a history state should enter default history state configuration if the containing state has never been exited yet
it.effect('internal transition to a history state should enter default history state configuration if the containing state has never been exited yet', () => Effect.gen(function* () {
  const service = (yield* Effect.tap(createActor(
    createMachine({
      initial: 'first',
      states: {
        first: {
          on: {
            NEXT: 'second.other'
          }
        },
        second: {
          initial: 'nested',
          states: {
            nested: {},
            other: {},
            hist: {
              history: true
            }
          },
          on: {
            NEXT: {
              target: '.hist'
            }
          }
        }
      }
    })
  ), (a) => a.start));

  (yield* service.send({ type: 'NEXT' }));
  (yield* service.send({ type: 'NEXT' }));

  expect((yield* service.getSnapshot).value).toEqual({
    second: 'nested'
  });
}));

describe('multistage history states', () => {
  // upstream: test/history.test.ts > multistage history states > should go to the most recently visited state
  it.effect('should go to the most recently visited state', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'running',
      states: {
        running: {
          initial: 'normal',
          states: {
            normal: {
              on: { SWITCH_TURBO: 'turbo' }
            },
            turbo: {
              on: { SWITCH_TURBO: 'normal' }
            },
            H: {
              history: true
            }
          },
          on: {
            POWER: 'off'
          }
        },
        starting: {
          on: { STARTED: 'running.H' }
        },
        off: {
          on: { POWER: 'starting' }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'SWITCH_TURBO' }));
    (yield* actorRef.send({ type: 'POWER' }));
    (yield* actorRef.send({ type: 'POWER' }));
    (yield* actorRef.send({ type: 'STARTED' }));

    expect((yield* actorRef.getSnapshot).value).toEqual({
      running: 'turbo'
    });
  }));
});

describe('revive history states', () => {
  const machine = createMachine({
    initial: 'on',
    states: {
      on: {
        initial: 'first',
        states: {
          first: {
            on: { SWITCH: 'second' }
          },
          second: {},
          hist: {
            type: 'history'
          }
        },
        on: {
          POWER: 'off'
        }
      },
      off: {
        on: { POWER: 'on.hist' }
      }
    }
  });

  // Upstream runs this setup once, in the describe body. An actor exists only inside an
  // Effect with a Scope here, so each test runs the same setup first. The setup is
  // deterministic, so every test receives the persisted snapshot and the snapshot that
  // upstream shares between its tests.
  const reviveSource = Effect.gen(function* () {
    const sourceRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* sourceRef.send({ type: 'SWITCH' }));
    (yield* sourceRef.send({ type: 'POWER' }));

    const persistedSnapshot = JSON.parse(
      JSON.stringify((yield* sourceRef.getPersistedSnapshot))
    );
    const snapshot = (yield* sourceRef.getSnapshot);

    (yield* sourceRef.stop);

    return { persistedSnapshot, snapshot };
  });

  // upstream: test/history.test.ts > revive history states > should restore from stringified snapshot
  it.effect('should restore from stringified snapshot', () => Effect.gen(function* () {
    const { persistedSnapshot } = yield* reviveSource;

    expect(persistedSnapshot.value).toBe('off');

    const actorRef = (yield* Effect.tap(createActor(machine, {
      snapshot: persistedSnapshot
    }), (a) => a.start));
    (yield* actorRef.send({ type: 'POWER' }));

    expect((yield* actorRef.getSnapshot).value).toEqual({ on: 'second' });
  }));

  // upstream: test/history.test.ts > revive history states > should ignore unresolved ids as-is and log a warning
  it.effect('should ignore unresolved ids as-is and log a warning', () => {
    // SD-21: the test logger, not a console spy, receives the warning
    const logged: Array<Logger.Options<unknown>> = [];
    return Effect.gen(function* () {
      const { persistedSnapshot } = yield* reviveSource;

      const fakeSnapshot = {
        ...persistedSnapshot,
        historyValue: { ['(machine).on.hist']: [{ id: 'nonexistent' }] }
      };
      expect(fakeSnapshot.value).toBe('off');

      const actorRef = (yield* Effect.tap(createActor(machine, {
        snapshot: fakeSnapshot
      }), (a) => a.start));
      (yield* actorRef.send({ type: 'POWER' }));

      // as `toHaveBeenCalledWith` on the `console.warn` spy: one warning entry carries
      // exactly this message
      const warnings = logged
        .filter((entry) => entry.logLevel === 'Warn')
        .map(messageParts);
      expect(warnings).toContainEqual([
        'Could not resolve StateNode for id: nonexistent'
      ]);
      expect((yield* actorRef.getSnapshot).value).toEqual({ on: 'first' });
      expect(((yield* actorRef.getPersistedSnapshot) as any).historyValue).toEqual({});
    }).pipe(Effect.provide(testLogger(logged)));
  });

  // upstream: test/history.test.ts > revive history states > should not re-resolve already-instantiated StateNode
  it.effect('should not re-resolve already-instantiated StateNode', () => Effect.gen(function* () {
    const { snapshot } = yield* reviveSource;

    expect(snapshot.value).toBe('off');
    expect(snapshot.historyValue['(machine).on.hist']![0]).toBeInstanceOf(
      StateNode
    );

    const actorRef = (yield* Effect.tap(createActor(machine, {
      snapshot
    }), (a) => a.start));
    (yield* actorRef.send({ type: 'POWER' }));

    expect((yield* actorRef.getSnapshot).value).toEqual({ on: 'second' });
  }));

  // upstream: test/history.test.ts > revive history states > should handle null, undefined, and primitive values
  it.effect('should handle null, undefined, and primitive values', () => Effect.gen(function* () {
    const { persistedSnapshot } = yield* reviveSource;

    // upstream's `forEach` over the same values, one value after the other
    yield* Effect.forEach([null, undefined, 42, 'foo', true, false], (val) => Effect.gen(function* () {
      const fakeSnapshot = { ...persistedSnapshot, historyValue: val };
      expect(fakeSnapshot.value).toBe('off');

      const actorRef = (yield* Effect.tap(createActor(machine, {
        snapshot: fakeSnapshot
      }), (a) => a.start));
      (yield* actorRef.send({ type: 'POWER' }));

      expect((yield* actorRef.getSnapshot).value).toEqual({ on: 'first' });
      expect(((yield* actorRef.getPersistedSnapshot) as any).historyValue).toEqual({});
    }));
  }));
});
