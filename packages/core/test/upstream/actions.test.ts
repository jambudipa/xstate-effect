import { describe, expect, it, vi } from "@effect/vitest"
import { Deferred, Effect, Exit, Fiber, Logger, Stream } from "effect"
import { TestClock } from "effect/testing"
import {
  cancel,
  emit,
  enqueueActions,
  log,
  raise,
  sendParent,
  sendTo,
  spawnChild,
  stopChild
} from "../../src/index.js";
import { CallbackActorRef, fromCallback } from "../../src/index.js";
import {
  ActorRef,
  ActorRefFromLogic,
  AnyActorRef,
  EventObject,
  Snapshot,
  assign,
  createActor,
  createMachine,
  forwardTo,
  setup
} from "../../src/index.js";
import { trackEntries } from "./trackEntries.js";

// Upstream replaces `console.log` in the `log()` tests and restores it after each test. The
// port never logs to the console (SD-21): those tests pass their spy through the `logger`
// actor option only, so there is no global to restore.

// Upstream spies on `console.warn`. The port reports a warning through the actor's logger
// (`Effect.logWarning` by default, SD-21), never through the console. This test logger keeps
// every log entry so a test can assert on the warnings.
const testLogger = (entries: Array<Logger.Options<unknown>>) =>
  Logger.layer([
    Logger.make((options) => {
      entries.push(options);
    })
  ]);

// Runs a test body with the test logger and hands the body the captured entries.
const withTestLogger = <A, E, R>(
  body: (logged: ReadonlyArray<Logger.Options<unknown>>) => Effect.Effect<A, E, R>
) => {
  const logged: Array<Logger.Options<unknown>> = [];
  return body(logged).pipe(Effect.provide(testLogger(logged)));
};

// The warnings the test logger captured, each as the argument list that upstream's
// `console.warn` spy records, so the upstream inline snapshots compare unchanged.
const warnCalls = (logged: ReadonlyArray<Logger.Options<unknown>>) =>
  logged
    .filter((entry) => entry.logLevel === 'Warn')
    .map((entry) => (Array.isArray(entry.message) ? entry.message : [entry.message]));

// Upstream delivers the events one actor sends to another (`sendTo`, `sendParent`,
// `forwardTo`, scheduled deliveries) before the outer `send` or `start` returns. Here a send
// from inside an actor enqueues without waiting (SD-23), and a `changes` consumer (the
// stand-in for an observer-object `subscribe({ error })`, not ported: D6, DEV-3) runs in its
// own fiber. So a test yields its fiber, at most 100 times and never on wall-clock time,
// until the delivery or the stream failure it needs has happened.
const yieldUntil = (done: () => boolean | Effect.Effect<boolean>) =>
  Effect.yieldNow.pipe(Effect.repeat({ until: done, times: 100 }));

// Before an assertion that something did NOT happen (or happened exactly once): give every
// enqueued delivery the chance to run, so that the assertion is not vacuous.
const settle = yieldUntil(() => false);

describe('entry/exit actions', () => {
  describe('State.actions', () => {
    // upstream: test/actions.test.ts > entry/exit actions > State.actions > should return the entry actions of an initial state
    it.effect('should return the entry actions of an initial state', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'green',
        states: {
          green: {}
        }
      });
      const flushTracked = trackEntries(machine);
      (yield* Effect.tap(createActor(machine), (a) => a.start));

      expect(flushTracked()).toEqual(['enter: __root__', 'enter: green']);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > State.actions > should return the entry actions of an initial state (deep)
    it.effect('should return the entry actions of an initial state (deep)', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'a',
        states: {
          a: {
            initial: 'a1',
            states: {
              a1: {
                on: {
                  NEXT: 'a2'
                }
              },
              a2: {}
            },
            on: { CHANGE: 'b' }
          },
          b: {}
        }
      });

      const flushTracked = trackEntries(machine);
      (yield* Effect.tap(createActor(machine), (a) => a.start));

      expect(flushTracked()).toEqual([
        'enter: __root__',
        'enter: a',
        'enter: a.a1'
      ]);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > State.actions > should return the entry actions of an initial state (parallel)
    it.effect('should return the entry actions of an initial state (parallel)', () => Effect.gen(function* () {
      const machine = createMachine({
        type: 'parallel',
        states: {
          a: {
            initial: 'a1',
            states: {
              a1: {}
            }
          },
          b: {
            initial: 'b1',
            states: {
              b1: {}
            }
          }
        }
      });

      const flushTracked = trackEntries(machine);
      (yield* Effect.tap(createActor(machine), (a) => a.start));

      expect(flushTracked()).toEqual([
        'enter: __root__',
        'enter: a',
        'enter: a.a1',
        'enter: b',
        'enter: b.b1'
      ]);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > State.actions > should return the entry and exit actions of a transition
    it.effect('should return the entry and exit actions of a transition', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'green',
        states: {
          green: {
            on: {
              TIMER: 'yellow'
            }
          },
          yellow: {}
        }
      });

      const flushTracked = trackEntries(machine);

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
      flushTracked();

      (yield* actor.send({ type: 'TIMER' }));

      expect(flushTracked()).toEqual(['exit: green', 'enter: yellow']);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > State.actions > should return the entry and exit actions of a deep transition
    it.effect('should return the entry and exit actions of a deep transition', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'green',
        states: {
          green: {
            on: {
              TIMER: 'yellow'
            }
          },
          yellow: {
            initial: 'speed_up',
            states: {
              speed_up: {}
            }
          }
        }
      });

      const flushTracked = trackEntries(machine);

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
      flushTracked();

      (yield* actor.send({ type: 'TIMER' }));

      expect(flushTracked()).toEqual([
        'exit: green',
        'enter: yellow',
        'enter: yellow.speed_up'
      ]);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > State.actions > should return the entry and exit actions of a nested transition
    it.effect('should return the entry and exit actions of a nested transition', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'green',
        states: {
          green: {
            initial: 'walk',
            states: {
              walk: {
                on: {
                  PED_COUNTDOWN: 'wait'
                }
              },
              wait: {}
            }
          }
        }
      });

      const flushTracked = trackEntries(machine);

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
      flushTracked();

      (yield* actor.send({ type: 'PED_COUNTDOWN' }));

      expect(flushTracked()).toEqual(['exit: green.walk', 'enter: green.wait']);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > State.actions > should not have actions for unhandled events (shallow)
    it.effect('should not have actions for unhandled events (shallow)', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'green',
        states: {
          green: {}
        }
      });
      const flushTracked = trackEntries(machine);

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
      flushTracked();

      (yield* actor.send({ type: 'FAKE' }));

      expect(flushTracked()).toEqual([]);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > State.actions > should not have actions for unhandled events (deep)
    it.effect('should not have actions for unhandled events (deep)', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'green',
        states: {
          green: {
            initial: 'walk',
            states: {
              walk: {},
              wait: {},
              stop: {}
            }
          }
        }
      });

      const flushTracked = trackEntries(machine);

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
      flushTracked();

      (yield* actor.send({ type: 'FAKE' }));

      expect(flushTracked()).toEqual([]);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > State.actions > should exit and enter the state for reentering self-transitions (shallow)
    it.effect('should exit and enter the state for reentering self-transitions (shallow)', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'green',
        states: {
          green: {
            on: {
              RESTART: {
                target: 'green',
                reenter: true
              }
            }
          }
        }
      });

      const flushTracked = trackEntries(machine);

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
      flushTracked();

      (yield* actor.send({ type: 'RESTART' }));

      expect(flushTracked()).toEqual(['exit: green', 'enter: green']);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > State.actions > should exit and enter the state for reentering self-transitions (deep)
    it.effect('should exit and enter the state for reentering self-transitions (deep)', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'green',
        states: {
          green: {
            on: {
              RESTART: {
                target: 'green',
                reenter: true
              }
            },
            initial: 'walk',
            states: {
              walk: {},
              wait: {},
              stop: {}
            }
          }
        }
      });
      const flushTracked = trackEntries(machine);

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

      flushTracked();
      (yield* actor.send({ type: 'RESTART' }));

      expect(flushTracked()).toEqual([
        'exit: green.walk',
        'exit: green',
        'enter: green',
        'enter: green.walk'
      ]);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > State.actions > should return actions for parallel machines
    it.effect('should return actions for parallel machines', () => Effect.gen(function* () {
      const actual: string[] = [];
      const machine = createMachine({
        type: 'parallel',
        states: {
          a: {
            initial: 'a1',
            states: {
              a1: {
                on: {
                  CHANGE: {
                    target: 'a2',
                    actions: [
                      () => actual.push('do_a2'),
                      () => actual.push('another_do_a2')
                    ]
                  }
                },
                entry: () => actual.push('enter_a1'),
                exit: () => actual.push('exit_a1')
              },
              a2: {
                entry: () => actual.push('enter_a2'),
                exit: () => actual.push('exit_a2')
              }
            },
            entry: () => actual.push('enter_a'),
            exit: () => actual.push('exit_a')
          },
          b: {
            initial: 'b1',
            states: {
              b1: {
                on: {
                  CHANGE: { target: 'b2', actions: () => actual.push('do_b2') }
                },
                entry: () => actual.push('enter_b1'),
                exit: () => actual.push('exit_b1')
              },
              b2: {
                entry: () => actual.push('enter_b2'),
                exit: () => actual.push('exit_b2')
              }
            },
            entry: () => actual.push('enter_b'),
            exit: () => actual.push('exit_b')
          }
        }
      });

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
      actual.length = 0;

      (yield* actor.send({ type: 'CHANGE' }));

      expect(actual).toEqual([
        'exit_b1', // reverse document order
        'exit_a1',
        'do_a2',
        'another_do_a2',
        'do_b2',
        'enter_a2',
        'enter_b2'
      ]);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > State.actions > should return nested actions in the correct (child to parent) order
    it.effect('should return nested actions in the correct (child to parent) order', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'a',
        states: {
          a: {
            initial: 'a1',
            states: {
              a1: {}
            },
            on: { CHANGE: 'b' }
          },
          b: {
            initial: 'b1',
            states: {
              b1: {}
            }
          }
        }
      });

      const flushTracked = trackEntries(machine);

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

      flushTracked();
      (yield* actor.send({ type: 'CHANGE' }));

      expect(flushTracked()).toEqual([
        'exit: a.a1',
        'exit: a',
        'enter: b',
        'enter: b.b1'
      ]);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > State.actions > should ignore parent state actions for same-parent substates
    it.effect('should ignore parent state actions for same-parent substates', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'a',
        states: {
          a: {
            initial: 'a1',
            states: {
              a1: {
                on: {
                  NEXT: 'a2'
                }
              },
              a2: {}
            }
          }
        }
      });

      const flushTracked = trackEntries(machine);

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

      flushTracked();
      (yield* actor.send({ type: 'NEXT' }));

      expect(flushTracked()).toEqual(['exit: a.a1', 'enter: a.a2']);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > State.actions > should work with function actions
    it.effect('should work with function actions', () => Effect.gen(function* () {
      const entrySpy = vi.fn();
      const exitSpy = vi.fn();
      const transitionSpy = vi.fn();

      const machine = createMachine({
        initial: 'a',
        states: {
          a: {
            initial: 'a1',
            states: {
              a1: {
                on: {
                  NEXT_FN: 'a3'
                }
              },
              a2: {},
              a3: {
                on: {
                  NEXT: {
                    target: 'a2',
                    actions: [transitionSpy]
                  }
                },
                entry: entrySpy,
                exit: exitSpy
              }
            }
          }
        }
      });

      const flushTracked = trackEntries(machine);

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
      flushTracked();

      (yield* actor.send({ type: 'NEXT_FN' }));

      expect(flushTracked()).toEqual(['exit: a.a1', 'enter: a.a3']);
      expect(entrySpy).toHaveBeenCalled();

      (yield* actor.send({ type: 'NEXT' }));

      expect(flushTracked()).toEqual(['exit: a.a3', 'enter: a.a2']);
      expect(exitSpy).toHaveBeenCalled();
      expect(transitionSpy).toHaveBeenCalled();
    }));

    // upstream: test/actions.test.ts > entry/exit actions > State.actions > should exit children of parallel state nodes
    it.effect('should exit children of parallel state nodes', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'B',
        states: {
          A: {
            on: {
              'to-B': 'B'
            }
          },
          B: {
            type: 'parallel',
            on: {
              'to-A': 'A'
            },
            states: {
              C: {
                initial: 'C1',
                states: {
                  C1: {}
                }
              },
              D: {
                initial: 'D1',
                states: {
                  D1: {}
                }
              }
            }
          }
        }
      });

      const flushTracked = trackEntries(machine);

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

      flushTracked();
      (yield* actor.send({ type: 'to-A' }));

      expect(flushTracked()).toEqual([
        'exit: B.D.D1',
        'exit: B.D',
        'exit: B.C.C1',
        'exit: B.C',
        'exit: B',
        'enter: A'
      ]);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > State.actions > should reenter targeted ancestor (as it's a descendant of the transition domain)
    it.effect("should reenter targeted ancestor (as it's a descendant of the transition domain)", () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'loaded',
        states: {
          loaded: {
            id: 'loaded',
            initial: 'idle',
            states: {
              idle: {
                on: {
                  UPDATE: '#loaded'
                }
              }
            }
          }
        }
      });

      const flushTracked = trackEntries(machine);

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

      flushTracked();
      (yield* actor.send({ type: 'UPDATE' }));

      expect(flushTracked()).toEqual([
        'exit: loaded.idle',
        'exit: loaded',
        'enter: loaded',
        'enter: loaded.idle'
      ]);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > State.actions > shouldn't use a referenced custom action over a builtin one when there is a naming conflict
    it.effect("shouldn't use a referenced custom action over a builtin one when there is a naming conflict", () => Effect.gen(function* () {
      const spy = vi.fn();
      const machine = createMachine(
        {
          context: {
            assigned: false
          },
          on: {
            EV: {
              actions: assign({ assigned: true })
            }
          }
        },
        {
          actions: {
            'xstate.assign': spy
          }
        }
      );

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
      (yield* actor.send({ type: 'EV' }));

      expect(spy).not.toHaveBeenCalled();
      expect((yield* actor.getSnapshot).context.assigned).toBe(true);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > State.actions > shouldn't use a referenced custom action over an inline one when there is a naming conflict
    it.effect("shouldn't use a referenced custom action over an inline one when there is a naming conflict", () => Effect.gen(function* () {
      const spy = vi.fn();
      let called = false;

      const machine = createMachine(
        {
          on: {
            EV: {
              // it's important for this test to use a named function
              actions: function myFn() {
                called = true;
              }
            }
          }
        },
        {
          actions: {
            myFn: spy
          }
        }
      );

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
      (yield* actor.send({ type: 'EV' }));

      expect(spy).not.toHaveBeenCalled();
      expect(called).toBe(true);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > State.actions > root entry/exit actions should be called on root reentering transitions
    it.effect('root entry/exit actions should be called on root reentering transitions', () => Effect.gen(function* () {
      let entrySpy = vi.fn();
      let exitSpy = vi.fn();

      const machine = createMachine({
        id: 'root',
        entry: entrySpy,
        exit: exitSpy,
        on: {
          EVENT: {
            target: '#two',
            reenter: true
          }
        },
        initial: 'one',
        states: {
          one: {},
          two: {
            id: 'two'
          }
        }
      });

      const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

      entrySpy.mockClear();
      exitSpy.mockClear();

      (yield* service.send({ type: 'EVENT' }));

      expect(entrySpy).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalled();
    }));

    describe('should ignore same-parent state actions (sparse)', () => {
      // upstream: test/actions.test.ts > entry/exit actions > State.actions > should ignore same-parent state actions (sparse) > with a relative transition
      it.effect('with a relative transition', () => Effect.gen(function* () {
        const machine = createMachine({
          initial: 'ping',
          states: {
            ping: {
              initial: 'foo',
              states: {
                foo: {
                  on: {
                    TACK: 'bar'
                  }
                },
                bar: {}
              }
            }
          }
        });

        const flushTracked = trackEntries(machine);

        const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
        flushTracked();

        (yield* actor.send({ type: 'TACK' }));

        expect(flushTracked()).toEqual(['exit: ping.foo', 'enter: ping.bar']);
      }));

      // upstream: test/actions.test.ts > entry/exit actions > State.actions > should ignore same-parent state actions (sparse) > with an absolute transition
      it.effect('with an absolute transition', () => Effect.gen(function* () {
        const machine = createMachine({
          id: 'root',
          initial: 'ping',
          states: {
            ping: {
              initial: 'foo',
              states: {
                foo: {
                  on: {
                    ABSOLUTE_TACK: '#root.ping.bar'
                  }
                },
                bar: {}
              }
            },
            pong: {}
          }
        });

        const flushTracked = trackEntries(machine);

        const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
        flushTracked();

        (yield* actor.send({ type: 'ABSOLUTE_TACK' }));

        expect(flushTracked()).toEqual(['exit: ping.foo', 'enter: ping.bar']);
      }));
    });
  });

  describe('entry/exit actions', () => {
    // upstream: test/actions.test.ts > entry/exit actions > entry/exit actions > should return the entry actions of an initial state
    it.effect('should return the entry actions of an initial state', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'green',
        states: {
          green: {}
        }
      });
      const flushTracked = trackEntries(machine);
      (yield* Effect.tap(createActor(machine), (a) => a.start));

      expect(flushTracked()).toEqual(['enter: __root__', 'enter: green']);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > entry/exit actions > should return the entry and exit actions of a transition
    it.effect('should return the entry and exit actions of a transition', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'green',
        states: {
          green: {
            on: {
              TIMER: 'yellow'
            }
          },
          yellow: {}
        }
      });

      const flushTracked = trackEntries(machine);

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
      flushTracked();

      (yield* actor.send({ type: 'TIMER' }));

      expect(flushTracked()).toEqual(['exit: green', 'enter: yellow']);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > entry/exit actions > should return the entry and exit actions of a deep transition
    it.effect('should return the entry and exit actions of a deep transition', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'green',
        states: {
          green: {
            on: {
              TIMER: 'yellow'
            }
          },
          yellow: {
            initial: 'speed_up',
            states: {
              speed_up: {}
            }
          }
        }
      });
      const flushTracked = trackEntries(machine);

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
      flushTracked();

      (yield* actor.send({ type: 'TIMER' }));

      expect(flushTracked()).toEqual([
        'exit: green',
        'enter: yellow',
        'enter: yellow.speed_up'
      ]);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > entry/exit actions > should return the entry and exit actions of a nested transition
    it.effect('should return the entry and exit actions of a nested transition', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'green',
        states: {
          green: {
            initial: 'walk',
            states: {
              walk: {
                on: {
                  PED_COUNTDOWN: 'wait'
                }
              },
              wait: {}
            }
          }
        }
      });
      const flushTracked = trackEntries(machine);

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
      flushTracked();

      (yield* actor.send({ type: 'PED_COUNTDOWN' }));

      expect(flushTracked()).toEqual(['exit: green.walk', 'enter: green.wait']);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > entry/exit actions > should keep the same state for unhandled events (shallow)
    it.effect('should keep the same state for unhandled events (shallow)', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'green',
        states: {
          green: {}
        }
      });
      const flushTracked = trackEntries(machine);

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
      flushTracked();

      (yield* actor.send({ type: 'FAKE' }));

      expect(flushTracked()).toEqual([]);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > entry/exit actions > should keep the same state for unhandled events (deep)
    it.effect('should keep the same state for unhandled events (deep)', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'green',
        states: {
          green: {
            initial: 'walk',
            states: {
              walk: {}
            }
          }
        }
      });
      const flushTracked = trackEntries(machine);

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
      flushTracked();

      (yield* actor.send({ type: 'FAKE' }));

      expect(flushTracked()).toEqual([]);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > entry/exit actions > should exit and enter the state for reentering self-transitions (shallow)
    it.effect('should exit and enter the state for reentering self-transitions (shallow)', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'green',
        states: {
          green: {
            on: {
              RESTART: {
                target: 'green',
                reenter: true
              }
            }
          }
        }
      });

      const flushTracked = trackEntries(machine);

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
      flushTracked();

      (yield* actor.send({ type: 'RESTART' }));

      expect(flushTracked()).toEqual(['exit: green', 'enter: green']);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > entry/exit actions > should exit and enter the state for reentering self-transitions (deep)
    it.effect('should exit and enter the state for reentering self-transitions (deep)', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'green',
        states: {
          green: {
            on: {
              RESTART: {
                target: 'green',
                reenter: true
              }
            },
            initial: 'walk',
            states: {
              walk: {}
            }
          }
        }
      });

      const flushTracked = trackEntries(machine);

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
      flushTracked();

      (yield* actor.send({ type: 'RESTART' }));
      expect(flushTracked()).toEqual([
        'exit: green.walk',
        'exit: green',
        'enter: green',
        'enter: green.walk'
      ]);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > entry/exit actions > should exit current node and enter target node when target is not a descendent or ancestor of current
    it.effect('should exit current node and enter target node when target is not a descendent or ancestor of current', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'A',
        states: {
          A: {
            initial: 'A1',
            states: {
              A1: {
                on: {
                  NEXT: '#sibling_descendant'
                }
              },
              A2: {
                initial: 'A2_child',
                states: {
                  A2_child: {
                    id: 'sibling_descendant'
                  }
                }
              }
            }
          }
        }
      });

      const flushTracked = trackEntries(machine);

      const service = (yield* Effect.tap(createActor(machine), (a) => a.start));
      flushTracked();
      (yield* service.send({ type: 'NEXT' }));

      expect(flushTracked()).toEqual([
        'exit: A.A1',
        'enter: A.A2',
        'enter: A.A2.A2_child'
      ]);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > entry/exit actions > should exit current node and reenter target node when target is ancestor of current
    it.effect('should exit current node and reenter target node when target is ancestor of current', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'A',
        states: {
          A: {
            id: 'ancestor',
            initial: 'A1',
            states: {
              A1: {
                on: {
                  NEXT: 'A2'
                }
              },
              A2: {
                initial: 'A2_child',
                states: {
                  A2_child: {
                    on: {
                      NEXT: '#ancestor'
                    }
                  }
                }
              }
            }
          }
        }
      });

      const flushTracked = trackEntries(machine);

      const service = (yield* Effect.tap(createActor(machine), (a) => a.start));
      (yield* service.send({ type: 'NEXT' }));

      flushTracked();
      (yield* service.send({ type: 'NEXT' }));

      expect(flushTracked()).toEqual([
        'exit: A.A2.A2_child',
        'exit: A.A2',
        'exit: A',
        'enter: A',
        'enter: A.A1'
      ]);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > entry/exit actions > should enter all descendents when target is a descendent of the source when using an reentering transition
    it.effect('should enter all descendents when target is a descendent of the source when using an reentering transition', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'A',
        states: {
          A: {
            initial: 'A1',
            on: {
              NEXT: {
                reenter: true,
                target: '.A2'
              }
            },
            states: {
              A1: {},
              A2: {
                initial: 'A2a',
                states: {
                  A2a: {}
                }
              }
            }
          }
        }
      });

      const flushTracked = trackEntries(machine);

      const service = (yield* Effect.tap(createActor(machine), (a) => a.start));
      flushTracked();
      (yield* service.send({ type: 'NEXT' }));

      expect(flushTracked()).toEqual([
        'exit: A.A1',
        'exit: A',
        'enter: A',
        'enter: A.A2',
        'enter: A.A2.A2a'
      ]);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > entry/exit actions > should exit deep descendant during a default self-transition
    it.effect('should exit deep descendant during a default self-transition', () => Effect.gen(function* () {
      const m = createMachine({
        initial: 'a',
        states: {
          a: {
            on: {
              EV: 'a'
            },
            initial: 'a1',
            states: {
              a1: {
                initial: 'a11',
                states: {
                  a11: {}
                }
              }
            }
          }
        }
      });

      const flushTracked = trackEntries(m);

      const service = (yield* Effect.tap(createActor(m), (a) => a.start));

      flushTracked();
      (yield* service.send({ type: 'EV' }));

      expect(flushTracked()).toEqual([
        'exit: a.a1.a11',
        'exit: a.a1',
        'enter: a.a1',
        'enter: a.a1.a11'
      ]);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > entry/exit actions > should exit deep descendant during a reentering self-transition
    it.effect('should exit deep descendant during a reentering self-transition', () => Effect.gen(function* () {
      const m = createMachine({
        initial: 'a',
        states: {
          a: {
            on: {
              EV: {
                target: 'a',
                reenter: true
              }
            },
            initial: 'a1',
            states: {
              a1: {
                initial: 'a11',
                states: {
                  a11: {}
                }
              }
            }
          }
        }
      });

      const flushTracked = trackEntries(m);

      const service = (yield* Effect.tap(createActor(m), (a) => a.start));

      flushTracked();
      (yield* service.send({ type: 'EV' }));

      expect(flushTracked()).toEqual([
        'exit: a.a1.a11',
        'exit: a.a1',
        'exit: a',
        'enter: a',
        'enter: a.a1',
        'enter: a.a1.a11'
      ]);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > entry/exit actions > should not reenter leaf state during its default self-transition
    it.effect('should not reenter leaf state during its default self-transition', () => Effect.gen(function* () {
      const m = createMachine({
        initial: 'a',
        states: {
          a: {
            initial: 'a1',
            states: {
              a1: {
                on: {
                  EV: 'a1'
                }
              }
            }
          }
        }
      });

      const flushTracked = trackEntries(m);

      const service = (yield* Effect.tap(createActor(m), (a) => a.start));

      flushTracked();
      (yield* service.send({ type: 'EV' }));

      expect(flushTracked()).toEqual([]);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > entry/exit actions > should reenter leaf state during its reentering self-transition
    it.effect('should reenter leaf state during its reentering self-transition', () => Effect.gen(function* () {
      const m = createMachine({
        initial: 'a',
        states: {
          a: {
            initial: 'a1',
            states: {
              a1: {
                on: {
                  EV: {
                    target: 'a1',
                    reenter: true
                  }
                }
              }
            }
          }
        }
      });

      const flushTracked = trackEntries(m);

      const service = (yield* Effect.tap(createActor(m), (a) => a.start));

      flushTracked();
      (yield* service.send({ type: 'EV' }));

      expect(flushTracked()).toEqual(['exit: a.a1', 'enter: a.a1']);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > entry/exit actions > should not enter exited state when targeting its ancestor and when its former descendant gets selected through initial state
    it.effect('should not enter exited state when targeting its ancestor and when its former descendant gets selected through initial state', () => Effect.gen(function* () {
      const m = createMachine({
        initial: 'a',
        states: {
          a: {
            id: 'parent',
            initial: 'a1',
            states: {
              a1: {
                on: {
                  EV: 'a2'
                }
              },
              a2: {
                on: {
                  EV: '#parent'
                }
              }
            }
          }
        }
      });

      const flushTracked = trackEntries(m);

      const service = (yield* Effect.tap(createActor(m), (a) => a.start));
      (yield* service.send({ type: 'EV' }));

      flushTracked();
      (yield* service.send({ type: 'EV' }));

      expect(flushTracked()).toEqual([
        'exit: a.a2',
        'exit: a',
        'enter: a',
        'enter: a.a1'
      ]);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > entry/exit actions > should not enter exited state when targeting its ancestor and when its latter descendant gets selected through initial state
    it.effect('should not enter exited state when targeting its ancestor and when its latter descendant gets selected through initial state', () => Effect.gen(function* () {
      const m = createMachine({
        initial: 'a',
        states: {
          a: {
            id: 'parent',
            initial: 'a2',
            states: {
              a1: {
                on: {
                  EV: '#parent'
                }
              },
              a2: {
                on: {
                  EV: 'a1'
                }
              }
            }
          }
        }
      });

      const flushTracked = trackEntries(m);

      const service = (yield* Effect.tap(createActor(m), (a) => a.start));
      (yield* service.send({ type: 'EV' }));

      flushTracked();
      (yield* service.send({ type: 'EV' }));

      expect(flushTracked()).toEqual([
        'exit: a.a1',
        'exit: a',
        'enter: a',
        'enter: a.a2'
      ]);
    }));
  });

  describe('parallel states', () => {
    // upstream: test/actions.test.ts > entry/exit actions > parallel states > should return entry action defined on parallel state
    it.effect('should return entry action defined on parallel state', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'start',
        states: {
          start: {
            on: { ENTER_PARALLEL: 'p1' }
          },
          p1: {
            type: 'parallel',
            states: {
              nested: {
                initial: 'inner',
                states: {
                  inner: {}
                }
              }
            }
          }
        }
      });

      const flushTracked = trackEntries(machine);

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

      flushTracked();
      (yield* actor.send({ type: 'ENTER_PARALLEL' }));

      expect(flushTracked()).toEqual([
        'exit: start',
        'enter: p1',
        'enter: p1.nested',
        'enter: p1.nested.inner'
      ]);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > parallel states > should reenter parallel region when a parallel state gets reentered while targeting another region
    it.effect('should reenter parallel region when a parallel state gets reentered while targeting another region', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'ready',
        states: {
          ready: {
            type: 'parallel',
            on: {
              FOO: {
                target: '#cameraOff',
                reenter: true
              }
            },
            states: {
              devicesInfo: {},
              camera: {
                initial: 'on',
                states: {
                  on: {},
                  off: {
                    id: 'cameraOff'
                  }
                }
              }
            }
          }
        }
      });

      const flushTracked = trackEntries(machine);

      const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

      flushTracked();
      (yield* service.send({ type: 'FOO' }));

      expect(flushTracked()).toEqual([
        'exit: ready.camera.on',
        'exit: ready.camera',
        'exit: ready.devicesInfo',
        'exit: ready',
        'enter: ready',
        'enter: ready.devicesInfo',
        'enter: ready.camera',
        'enter: ready.camera.off'
      ]);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > parallel states > should reenter parallel region when a parallel state is reentered while targeting another region
    it.effect('should reenter parallel region when a parallel state is reentered while targeting another region', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'ready',
        states: {
          ready: {
            type: 'parallel',
            on: {
              FOO: {
                target: '#cameraOff',
                reenter: true
              }
            },
            states: {
              devicesInfo: {},
              camera: {
                initial: 'on',
                states: {
                  on: {},
                  off: {
                    id: 'cameraOff'
                  }
                }
              }
            }
          }
        }
      });

      const flushTracked = trackEntries(machine);

      const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

      flushTracked();
      (yield* service.send({ type: 'FOO' }));

      expect(flushTracked()).toEqual([
        'exit: ready.camera.on',
        'exit: ready.camera',
        'exit: ready.devicesInfo',
        'exit: ready',
        'enter: ready',
        'enter: ready.devicesInfo',
        'enter: ready.camera',
        'enter: ready.camera.off'
      ]);
    }));
  });

  describe('targetless transitions', () => {
    // upstream: test/actions.test.ts > entry/exit actions > targetless transitions > shouldn't exit a state on a parent's targetless transition
    it.effect("shouldn't exit a state on a parent's targetless transition", () => Effect.gen(function* () {
      const parent = createMachine({
        initial: 'one',
        on: {
          WHATEVER: {
            actions: () => {}
          }
        },
        states: {
          one: {}
        }
      });

      const flushTracked = trackEntries(parent);

      const service = (yield* Effect.tap(createActor(parent), (a) => a.start));

      flushTracked();
      (yield* service.send({ type: 'WHATEVER' }));

      expect(flushTracked()).toEqual([]);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > targetless transitions > shouldn't exit (and reenter) state on targetless delayed transition
    it.effect("shouldn't exit (and reenter) state on targetless delayed transition", () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'one',
        states: {
          one: {
            after: {
              10: {
                actions: () => {
                  // do smth
                }
              }
            }
          }
        }
      });

      const flushTracked = trackEntries(machine);

      (yield* Effect.tap(createActor(machine), (a) => a.start));
      flushTracked();

      // upstream waits 50 ms of real time; the Effect form advances the test clock
      yield* TestClock.adjust("50 millis");

      expect(flushTracked()).toEqual([]);
    }));
  });

  describe('when reaching a final state', () => {
    // https://github.com/statelyai/xstate/issues/1109
    // upstream: test/actions.test.ts > entry/exit actions > when reaching a final state > exit actions should be called when invoked machine reaches its final state
    it.effect('exit actions should be called when invoked machine reaches its final state', () => Effect.gen(function* () {
      let exitCalled = false;
      let childExitCalled = false;
      const childMachine = createMachine({
        exit: () => {
          exitCalled = true;
        },
        initial: 'a',
        states: {
          a: {
            type: 'final',
            exit: () => {
              childExitCalled = true;
            }
          }
        }
      });

      const parentMachine = createMachine({
        initial: 'active',
        states: {
          active: {
            invoke: {
              src: childMachine,
              onDone: 'finished'
            }
          },
          finished: {
            type: 'final'
          }
        }
      });

      const actor = (yield* createActor(parentMachine));
      // the observer-object `subscribe` is not ported (D6, DEV-3): the `changes` stream ends
      // when the actor is done, so the end of the stream stands for the observer's `complete`,
      // and joining the fiber that drains it stands for the promise that `complete` resolves
      const completed = yield* actor.changes.pipe(
        Stream.runDrain,
        Effect.andThen(Effect.sync(() => {
          expect(exitCalled).toBeTruthy();
          expect(childExitCalled).toBeTruthy();
        })),
        Effect.forkScoped({ startImmediately: true })
      );
      (yield* actor.start);
      yield* Fiber.join(completed);
    }));
  });

  describe('when stopped', () => {
    // upstream: test/actions.test.ts > entry/exit actions > when stopped > exit actions should not be called when stopping a machine
    it.effect('exit actions should not be called when stopping a machine', () => Effect.gen(function* () {
      const rootSpy = vi.fn();
      const childSpy = vi.fn();

      const machine = createMachine({
        exit: rootSpy,
        initial: 'a',
        states: {
          a: {
            exit: childSpy
          }
        }
      });

      const service = (yield* Effect.tap(createActor(machine), (a) => a.start));
      (yield* service.stop);

      expect(rootSpy).not.toHaveBeenCalled();
      expect(childSpy).not.toHaveBeenCalled();
    }));

    // upstream: test/actions.test.ts > entry/exit actions > when stopped > an exit action executed when an interpreter reaches its final state should be called with the last received event
    it.effect('an exit action executed when an interpreter reaches its final state should be called with the last received event', () => Effect.gen(function* () {
      let receivedEvent;
      const machine = createMachine({
        initial: 'a',
        states: {
          a: {
            on: {
              NEXT: 'b'
            }
          },
          b: {
            type: 'final'
          }
        },
        exit: ({ event }) => {
          receivedEvent = event;
        }
      });

      const service = (yield* Effect.tap(createActor(machine), (a) => a.start));
      (yield* service.send({ type: 'NEXT' }));

      expect(receivedEvent).toEqual({ type: 'NEXT' });
    }));

    // https://github.com/statelyai/xstate/issues/2880
    // upstream: test/actions.test.ts > entry/exit actions > when stopped > stopping an interpreter that receives events from its children exit handlers should not throw
    it.effect('stopping an interpreter that receives events from its children exit handlers should not throw', () => Effect.gen(function* () {
      const child = createMachine({
        id: 'child',
        initial: 'idle',
        states: {
          idle: {
            exit: sendParent({ type: 'EXIT' })
          }
        }
      });

      const parent = createMachine({
        id: 'parent',
        invoke: {
          src: child
        }
      });

      const interpreter = (yield* createActor(parent));
      (yield* interpreter.start);

      // `stop` is an Effect (D6): "does not throw" is an Exit that is a success, which also
      // excludes a defect raised by the child's exit-handler `sendParent` while stopping
      const stopped = yield* Effect.exit(interpreter.stop);
      expect(Exit.isSuccess(stopped)).toBe(true);
    }));

    // TODO: determine if the sendParent action should execute when the child actor is stopped.
    // If it shouldn't be, we need to clarify whether exit actions in general should be executed on machine stop,
    // since this is contradictory to other tests.
    // NOT PORTED (skipped upstream, ledger row): entry/exit actions > when stopped > sent events from exit handlers of a stopped child should not be received by the parent

    // upstream: test/actions.test.ts > entry/exit actions > when stopped > sent events from exit handlers of a done child should be received by the parent 
    it.effect('sent events from exit handlers of a done child should be received by the parent ', () => Effect.gen(function* () {
      let eventReceived = false;

      const child = createMachine({
        id: 'child',
        initial: 'active',
        states: {
          active: {
            on: {
              FINISH: 'done'
            }
          },
          done: {
            type: 'final'
          }
        },
        exit: sendParent({ type: 'CHILD_DONE' })
      });

      const parent = createMachine({
        types: {} as {
          context: {
            child: ActorRefFromLogic<typeof child>;
          };
        },
        id: 'parent',
        context: ({ spawn }) => ({
          child: spawn(child)
        }),
        on: {
          FINISH_CHILD: {
            actions: sendTo(({ context }) => context.child, { type: 'FINISH' })
          },
          CHILD_DONE: {
            actions: () => {
              eventReceived = true;
            }
          }
        }
      });

      const interpreter = (yield* Effect.tap(createActor(parent), (a) => a.start));
      (yield* interpreter.send({ type: 'FINISH_CHILD' }));

      // `sendTo` the child and the child's exit-handler `sendParent` enqueue without waiting
      // (SD-23): let both be delivered
      yield* yieldUntil(() => eventReceived);

      expect(eventReceived).toBe(true);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > when stopped > sent events from exit handlers of a stopped child should not be received by its children
    it.effect('sent events from exit handlers of a stopped child should not be received by its children', () => Effect.gen(function* () {
      const spy = vi.fn();

      const grandchild = createMachine({
        id: 'grandchild',
        on: {
          STOPPED: {
            actions: spy
          }
        }
      });

      const child = createMachine({
        id: 'child',
        invoke: {
          id: 'myChild',
          src: grandchild
        },
        exit: sendTo('myChild', { type: 'STOPPED' })
      });

      const parent = createMachine({
        id: 'parent',
        initial: 'a',
        states: {
          a: {
            invoke: {
              src: child
            },
            on: {
              NEXT: 'b'
            }
          },
          b: {}
        }
      });

      const interpreter = (yield* Effect.tap(createActor(parent), (a) => a.start));
      (yield* interpreter.send({ type: 'NEXT' }));

      // a send from inside an actor enqueues without waiting (SD-23): let every enqueued
      // delivery run, so that the assertion is not vacuous
      yield* settle;

      expect(spy).not.toHaveBeenCalled();
    }));

    // upstream: test/actions.test.ts > entry/exit actions > when stopped > sent events from exit handlers of a done child should be received by its children
    it.effect('sent events from exit handlers of a done child should be received by its children', () => Effect.gen(function* () {
      const spy = vi.fn();

      const grandchild = createMachine({
        id: 'grandchild',
        on: {
          STOPPED: {
            actions: spy
          }
        }
      });

      const child = createMachine({
        id: 'child',
        initial: 'a',
        invoke: {
          id: 'myChild',
          src: grandchild
        },
        states: {
          a: {
            on: {
              FINISH: 'b'
            }
          },
          b: {
            type: 'final'
          }
        },
        exit: sendTo('myChild', { type: 'STOPPED' })
      });

      const parent = createMachine({
        id: 'parent',
        invoke: {
          id: 'myChild',
          src: child
        },
        on: {
          NEXT: {
            actions: sendTo('myChild', { type: 'FINISH' })
          }
        }
      });

      const interpreter = (yield* Effect.tap(createActor(parent), (a) => a.start));
      (yield* interpreter.send({ type: 'NEXT' }));

      // `sendTo` the child and the child's exit-handler `sendTo` the grandchild enqueue without
      // waiting (SD-23): let them be delivered, then let every other delivery run, so that a
      // second call would be counted
      yield* yieldUntil(() => spy.mock.calls.length > 0);
      yield* settle;

      expect(spy).toHaveBeenCalledTimes(1);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > when stopped > actors spawned in exit handlers of a stopped child should not be started
    it.effect('actors spawned in exit handlers of a stopped child should not be started', () => Effect.gen(function* () {
      const grandchild = createMachine({
        id: 'grandchild',
        entry: () => {
          throw new Error('This should not be called.');
        }
      });

      const parent = createMachine({
        id: 'parent',
        context: {},
        exit: assign({
          actorRef: ({ spawn }) => spawn(grandchild)
        })
      });

      const interpreter = (yield* Effect.tap(createActor(parent), (a) => a.start));
      (yield* interpreter.stop);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > when stopped > should note execute referenced custom actions correctly when stopping an interpreter
    it.effect('should note execute referenced custom actions correctly when stopping an interpreter', () => Effect.gen(function* () {
      const spy = vi.fn();
      const parent = createMachine(
        {
          id: 'parent',
          context: {},
          exit: 'referencedAction'
        },
        {
          actions: {
            referencedAction: spy
          }
        }
      );

      const interpreter = (yield* Effect.tap(createActor(parent), (a) => a.start));
      (yield* interpreter.stop);

      expect(spy).not.toHaveBeenCalled();
    }));

    // upstream: test/actions.test.ts > entry/exit actions > when stopped > should not execute builtin actions when stopping an interpreter
    it.effect('should not execute builtin actions when stopping an interpreter', () => Effect.gen(function* () {
      const machine = createMachine(
        {
          context: {
            executedAssigns: [] as string[]
          },
          exit: [
            'referencedAction',
            assign({
              executedAssigns: ({ context }) => [
                ...context.executedAssigns,
                'inline'
              ]
            })
          ]
        },
        {
          actions: {
            referencedAction: assign({
              executedAssigns: ({ context }) => [
                ...context.executedAssigns,
                'referenced'
              ]
            })
          }
        }
      );

      const interpreter = (yield* Effect.tap(createActor(machine), (a) => a.start));
      (yield* interpreter.stop);

      expect((yield* interpreter.getSnapshot).context.executedAssigns).toEqual([]);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > when stopped > should clear all scheduled events when the interpreter gets stopped
    it.effect('should clear all scheduled events when the interpreter gets stopped', () => Effect.gen(function* () {
      const machine = createMachine({
        on: {
          INITIALIZE_SYNC_SEQUENCE: {
            // `send` and `stop` are Effects (D6): the inline action returns the Effect and the
            // actor runs it; sends made inside the actor's own processing enqueue without
            // waiting (SD-23)
            actions: (): Effect.Effect<void> => Effect.gen(function* () {
              // schedule those 2 events
              yield* service.send({ type: 'SOME_EVENT' });
              yield* service.send({ type: 'SOME_EVENT' });
              // but also immediately stop *while* the `INITIALIZE_SYNC_SEQUENCE` is still being processed
              yield* service.stop;
            })
          },
          SOME_EVENT: {
            actions: () => {
              throw new Error('This should not be called.');
            }
          }
        }
      });

      const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

      (yield* service.send({ type: 'INITIALIZE_SYNC_SEQUENCE' }));

      // upstream fails through the global rethrow if a `SOME_EVENT` action runs; the port
      // reports an unhandled error through the logger and sets status 'error' (SD-4, SD-21),
      // so the status is checked as well
      expect((yield* service.getSnapshot).status).toBe('stopped');
    }));

    // upstream: test/actions.test.ts > entry/exit actions > when stopped > should execute exit actions of the settled state of the last initiated microstep
    it.effect('should execute exit actions of the settled state of the last initiated microstep', () => Effect.gen(function* () {
      const exitActions: string[] = [];
      const machine = createMachine({
        initial: 'foo',
        states: {
          foo: {
            exit: () => {
              exitActions.push('foo action');
            },
            on: {
              INITIALIZE_SYNC_SEQUENCE: {
                target: 'bar',
                actions: [
                  // `stop` is an Effect (D6): the inline action returns it and the actor runs it
                  (): Effect.Effect<void> =>
                    // immediately stop *while* the `INITIALIZE_SYNC_SEQUENCE` is still being processed
                    service.stop,
                  () => {}
                ]
              }
            }
          },
          bar: {
            exit: () => {
              exitActions.push('bar action');
            }
          }
        }
      });

      const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

      (yield* service.send({ type: 'INITIALIZE_SYNC_SEQUENCE' }));

      expect(exitActions).toEqual(['foo action']);
    }));

    // upstream: test/actions.test.ts > entry/exit actions > when stopped > should not execute exit actions of the settled state of the last initiated microstep after executing all actions from that microstep
    it.effect('should not execute exit actions of the settled state of the last initiated microstep after executing all actions from that microstep', () => Effect.gen(function* () {
      const executedActions: string[] = [];
      const machine = createMachine({
        initial: 'foo',
        states: {
          foo: {
            exit: () => {
              executedActions.push('foo exit action');
            },
            on: {
              INITIALIZE_SYNC_SEQUENCE: {
                target: 'bar',
                actions: [
                  // `stop` is an Effect (D6): the inline action returns it and the actor runs it
                  (): Effect.Effect<void> =>
                    // immediately stop *while* the `INITIALIZE_SYNC_SEQUENCE` is still being processed
                    service.stop,
                  () => {
                    executedActions.push('foo transition action');
                  }
                ]
              }
            }
          },
          bar: {
            exit: () => {
              executedActions.push('bar exit action');
            }
          }
        }
      });

      const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

      (yield* service.send({ type: 'INITIALIZE_SYNC_SEQUENCE' }));

      expect(executedActions).toEqual([
        'foo exit action',
        'foo transition action'
      ]);
    }));
  });
});

describe('initial actions', () => {
  // upstream: test/actions.test.ts > initial actions > should support initial actions
  it.effect('should support initial actions', () => Effect.gen(function* () {
    const actual: string[] = [];
    const machine = createMachine({
      initial: {
        target: 'a',
        actions: () => actual.push('initialA')
      },
      states: {
        a: {
          entry: () => actual.push('entryA')
        }
      }
    });
    (yield* Effect.tap(createActor(machine), (a) => a.start));
    expect(actual).toEqual(['initialA', 'entryA']);
  }));

  // upstream: test/actions.test.ts > initial actions > should support initial actions from transition
  it.effect('should support initial actions from transition', () => Effect.gen(function* () {
    const actual: string[] = [];
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            NEXT: 'b'
          }
        },
        b: {
          entry: () => actual.push('entryB'),
          initial: {
            target: 'foo',
            actions: () => actual.push('initialFoo')
          },
          states: {
            foo: {
              entry: () => actual.push('entryFoo')
            }
          }
        }
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actor.send({ type: 'NEXT' }));

    expect(actual).toEqual(['entryB', 'initialFoo', 'entryFoo']);
  }));

  // upstream: test/actions.test.ts > initial actions > should execute actions of initial transitions only once when taking an explicit transition
  it.effect('should execute actions of initial transitions only once when taking an explicit transition', () => Effect.gen(function* () {
    const spy = vi.fn();
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            NEXT: 'b'
          }
        },
        b: {
          initial: {
            target: 'b_child',
            actions: () => spy('initial in b')
          },
          states: {
            b_child: {
              initial: {
                target: 'b_granchild',
                actions: () => spy('initial in b_child')
              },
              states: {
                b_granchild: {}
              }
            }
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({
      type: 'NEXT'
    }));

    expect(spy.mock.calls).toMatchInlineSnapshot(`
      [
        [
          "initial in b",
        ],
        [
          "initial in b_child",
        ],
      ]
    `);
  }));

  // upstream: test/actions.test.ts > initial actions > should execute actions of all initial transitions resolving to the initial state value
  it.effect('should execute actions of all initial transitions resolving to the initial state value', () => Effect.gen(function* () {
    const spy = vi.fn();
    const machine = createMachine({
      initial: {
        target: 'a',
        actions: () => spy('root')
      },
      states: {
        a: {
          initial: {
            target: 'a1',
            actions: () => spy('inner')
          },
          states: {
            a1: {}
          }
        }
      }
    });

    (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(spy.mock.calls).toMatchInlineSnapshot(`
      [
        [
          "root",
        ],
        [
          "inner",
        ],
      ]
    `);
  }));

  // upstream: test/actions.test.ts > initial actions > should execute actions of the initial transition when taking a root reentering self-transition
  it.effect('should execute actions of the initial transition when taking a root reentering self-transition', () => Effect.gen(function* () {
    const spy = vi.fn();
    const machine = createMachine({
      id: 'root',
      initial: {
        target: 'a',
        actions: spy
      },
      states: {
        a: {
          on: {
            NEXT: 'b'
          }
        },
        b: {}
      },
      on: {
        REENTER: {
          target: '#root',
          reenter: true
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'NEXT' }));
    spy.mockClear();

    (yield* actorRef.send({ type: 'REENTER' }));

    expect(spy).toHaveBeenCalledTimes(1);
    expect((yield* actorRef.getSnapshot).value).toEqual('a');
  }));
});

describe('actions on invalid transition', () => {
  // upstream: test/actions.test.ts > actions on invalid transition > should not recall previous actions
  it.effect('should not recall previous actions', () => Effect.gen(function* () {
    const spy = vi.fn();
    const machine = createMachine({
      initial: 'idle',
      states: {
        idle: {
          on: {
            STOP: {
              target: 'stop',
              actions: [spy]
            }
          }
        },
        stop: {}
      }
    });
    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actor.send({ type: 'STOP' }));
    expect(spy).toHaveBeenCalledTimes(1);

    (yield* actor.send({ type: 'INVALID' }));
    expect(spy).toHaveBeenCalledTimes(1);
  }));
});

describe('actions config', () => {
  type EventType =
    | { type: 'definedAction' }
    | { type: 'updateContext' }
    | { type: 'EVENT' }
    | { type: 'E' };
  interface Context {
    count: number;
  }

  const definedAction = () => {};

  // upstream: test/actions.test.ts > actions config > should reference actions defined in actions parameter of machine options (entry actions)
  it.effect('should reference actions defined in actions parameter of machine options (entry actions)', () => Effect.gen(function* () {
    const spy = vi.fn();
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            EVENT: 'b'
          }
        },
        b: {
          entry: ['definedAction', { type: 'definedAction' }, 'undefinedAction']
        }
      },
      on: {
        E: '.a'
      }
    }).provide({
      actions: {
        definedAction: spy
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actor.send({ type: 'EVENT' }));

    expect(spy).toHaveBeenCalledTimes(2);
  }));

  // upstream: test/actions.test.ts > actions config > should reference actions defined in actions parameter of machine options (initial state)
  it.effect('should reference actions defined in actions parameter of machine options (initial state)', () => Effect.gen(function* () {
    const spy = vi.fn();
    const machine = createMachine(
      {
        entry: ['definedAction', { type: 'definedAction' }, 'undefinedAction']
      },
      {
        actions: {
          definedAction: spy
        }
      }
    );

    (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(spy).toHaveBeenCalledTimes(2);
  }));

  // upstream: test/actions.test.ts > actions config > should be able to reference action implementations from action objects
  it.effect('should be able to reference action implementations from action objects', () => Effect.gen(function* () {
    const machine = createMachine(
      {
        types: {} as { context: Context; events: EventType },
        initial: 'a',
        context: {
          count: 0
        },
        states: {
          a: {
            entry: [
              'definedAction',
              { type: 'definedAction' },
              'undefinedAction'
            ],
            on: {
              EVENT: {
                target: 'b',
                actions: [{ type: 'definedAction' }, { type: 'updateContext' }]
              }
            }
          },
          b: {}
        }
      },
      {
        actions: {
          definedAction,
          updateContext: assign({ count: 10 })
        }
      }
    );
    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'EVENT' }));
    const snapshot = (yield* actorRef.getSnapshot);

    // expect(snapshot.actions).toEqual([
    //   expect.objectContaining({
    //     type: 'definedAction'
    //   }),
    //   expect.objectContaining({
    //     type: 'updateContext'
    //   })
    // ]);
    // TODO: specify which actions other actions came from

    expect(snapshot.context).toEqual({ count: 10 });
  }));

  // upstream: test/actions.test.ts > actions config > should work with anonymous functions (with warning)
  it.effect('should work with anonymous functions (with warning)', () => Effect.gen(function* () {
    let entryCalled = false;
    let actionCalled = false;
    let exitCalled = false;

    const anonMachine = createMachine({
      id: 'anon',
      initial: 'active',
      states: {
        active: {
          entry: () => (entryCalled = true),
          exit: () => (exitCalled = true),
          on: {
            EVENT: {
              target: 'inactive',
              actions: [() => (actionCalled = true)]
            }
          }
        },
        inactive: {}
      }
    });

    const actor = (yield* Effect.tap(createActor(anonMachine), (a) => a.start));

    expect(entryCalled).toBe(true);

    (yield* actor.send({ type: 'EVENT' }));

    expect(exitCalled).toBe(true);
    expect(actionCalled).toBe(true);
  }));
});

describe('action meta', () => {
  // upstream: test/actions.test.ts > action meta > should provide the original params
  it.effect('should provide the original params', () => Effect.gen(function* () {
    const spy = vi.fn();

    const testMachine = createMachine(
      {
        id: 'test',
        initial: 'foo',
        states: {
          foo: {
            entry: {
              type: 'entryAction',
              params: {
                value: 'something'
              }
            }
          }
        }
      },
      {
        actions: {
          entryAction: (_, params) => {
            spy(params);
          }
        }
      }
    );

    (yield* Effect.tap(createActor(testMachine), (a) => a.start));

    expect(spy).toHaveBeenCalledWith({
      value: 'something'
    });
  }));

  // upstream: test/actions.test.ts > action meta > should provide undefined params when it was configured as string
  it.effect('should provide undefined params when it was configured as string', () => Effect.gen(function* () {
    const spy = vi.fn();

    const testMachine = createMachine(
      {
        id: 'test',
        initial: 'foo',
        states: {
          foo: {
            entry: 'entryAction'
          }
        }
      },
      {
        actions: {
          entryAction: (_, params) => {
            spy(params);
          }
        }
      }
    );

    (yield* Effect.tap(createActor(testMachine), (a) => a.start));

    expect(spy).toHaveBeenCalledWith(undefined);
  }));

  // upstream: test/actions.test.ts > action meta > should provide the action with resolved params when they are dynamic
  it.effect('should provide the action with resolved params when they are dynamic', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine(
      {
        entry: {
          type: 'entryAction',
          params: () => ({ stuff: 100 })
        }
      },
      {
        actions: {
          entryAction: (_, params) => {
            spy(params);
          }
        }
      }
    );

    (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(spy).toHaveBeenCalledWith({
      stuff: 100
    });
  }));

  // upstream: test/actions.test.ts > action meta > should resolve dynamic params using context value
  it.effect('should resolve dynamic params using context value', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine(
      {
        context: {
          secret: 42
        },
        entry: {
          type: 'entryAction',
          params: ({ context }) => ({ secret: context.secret })
        }
      },
      {
        actions: {
          entryAction: (_, params) => {
            spy(params);
          }
        }
      }
    );

    (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(spy).toHaveBeenCalledWith({
      secret: 42
    });
  }));

  // upstream: test/actions.test.ts > action meta > should resolve dynamic params using event value
  it.effect('should resolve dynamic params using event value', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine(
      {
        on: {
          FOO: {
            actions: {
              type: 'myAction',
              params: ({ event }) => ({ secret: event.secret })
            }
          }
        }
      },
      {
        actions: {
          myAction: (_, params) => {
            spy(params);
          }
        }
      }
    );

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'FOO', secret: 77 }));

    expect(spy).toHaveBeenCalledWith({
      secret: 77
    });
  }));
});

describe('forwardTo()', () => {
  // upstream: test/actions.test.ts > forwardTo() > should forward an event to a service
  it.effect('should forward an event to a service', () => Effect.gen(function* () {
    const child = createMachine({
      types: {} as {
        events: {
          type: 'EVENT';
          value: number;
        };
      },
      id: 'child',
      initial: 'active',
      states: {
        active: {
          on: {
            EVENT: {
              actions: sendParent({ type: 'SUCCESS' }),
              guard: ({ event }) => event.value === 42
            }
          }
        }
      }
    });

    const parent = createMachine({
      types: {} as {
        events:
          | {
              type: 'EVENT';
              value: number;
            }
          | {
              type: 'SUCCESS';
            };
      },
      id: 'parent',
      initial: 'first',
      states: {
        first: {
          invoke: { src: child, id: 'myChild' },
          on: {
            EVENT: {
              actions: forwardTo('myChild')
            },
            SUCCESS: 'last'
          }
        },
        last: {
          type: 'final'
        }
      }
    });

    const service = (yield* createActor(parent));
    // the observer-object `subscribe` is not ported (D6, DEV-3): the `changes` stream ends
    // when the actor is done, so joining the fiber that drains it stands for the promise
    // that the observer's `complete` resolves
    const completed = yield* service.changes.pipe(
      Stream.runDrain,
      Effect.forkScoped({ startImmediately: true })
    );
    (yield* service.start);

    (yield* service.send({ type: 'EVENT', value: 42 }));
    yield* Fiber.join(completed);
  }));

  // upstream: test/actions.test.ts > forwardTo() > should forward an event to a service (dynamic)
  it.effect('should forward an event to a service (dynamic)', () => Effect.gen(function* () {
    const child = createMachine({
      types: {} as {
        events: {
          type: 'EVENT';
          value: number;
        };
      },
      id: 'child',
      initial: 'active',
      states: {
        active: {
          on: {
            EVENT: {
              actions: sendParent({ type: 'SUCCESS' }),
              guard: ({ event }) => event.value === 42
            }
          }
        }
      }
    });

    const parent = createMachine({
      types: {} as {
        context: { child?: AnyActorRef };
        events: { type: 'EVENT'; value: number } | { type: 'SUCCESS' };
      },
      id: 'parent',
      initial: 'first',
      context: {
        child: undefined
      },
      states: {
        first: {
          entry: assign({
            child: ({ spawn }) => spawn(child, { id: 'x' })
          }),
          on: {
            EVENT: {
              actions: forwardTo(({ context }) => context.child!)
            },
            SUCCESS: 'last'
          }
        },
        last: {
          type: 'final'
        }
      }
    });

    const service = (yield* createActor(parent));
    // the observer-object `subscribe` is not ported (D6, DEV-3): the `changes` stream ends
    // when the actor is done, so joining the fiber that drains it stands for the promise
    // that the observer's `complete` resolves
    const completed = yield* service.changes.pipe(
      Stream.runDrain,
      Effect.forkScoped({ startImmediately: true })
    );
    (yield* service.start);

    (yield* service.send({ type: 'EVENT', value: 42 }));
    yield* Fiber.join(completed);
  }));

  // upstream: test/actions.test.ts > forwardTo() > should not cause an infinite loop when forwarding to undefined
  it.effect('should not cause an infinite loop when forwarding to undefined', () => Effect.gen(function* () {
    const machine = createMachine({
      on: {
        '*': { guard: () => true, actions: forwardTo(undefined as any) }
      }
    });

    const errorSpy = vi.fn();

    const actorRef = (yield* createActor(machine));
    // the observer's `error` callback: called with the error the `changes` stream fails with
    yield* actorRef.changes.pipe(
      Stream.runDrain,
      Effect.catch((error) => Effect.sync(() => errorSpy(error))),
      Effect.forkScoped({ startImmediately: true })
    );
    (yield* actorRef.start);
    (yield* actorRef.send({ type: 'TEST' }));

    // the stream consumer runs in its own fiber: let it see the failure of the stream
    yield* yieldUntil(() => errorSpy.mock.calls.length > 0);
    expect(errorSpy.mock.calls).toMatchInlineSnapshot(`
      [
        [
          [Error: Attempted to forward event to undefined actor. This risks an infinite loop in the sender.],
        ],
      ]
    `);
  }));
});

describe('log()', () => {
  // upstream: test/actions.test.ts > log() > should log a string
  it.effect('should log a string', () => Effect.gen(function* () {
    const consoleSpy = vi.fn();
    // upstream also replaces `console.log`; the port's default logger is the Effect logger,
    // never the console (SD-21), so the `logger` option alone carries the spy
    const machine = createMachine({
      entry: log('some string', 'string label')
    });
    (yield* Effect.tap(createActor(machine, { logger: consoleSpy }), (a) => a.start));

    expect(consoleSpy.mock.calls).toMatchInlineSnapshot(`
      [
        [
          "string label",
          "some string",
        ],
      ]
    `);
  }));

  // upstream: test/actions.test.ts > log() > should log an expression
  it.effect('should log an expression', () => Effect.gen(function* () {
    const consoleSpy = vi.fn();
    // upstream also replaces `console.log`; the port's default logger is the Effect logger,
    // never the console (SD-21), so the `logger` option alone carries the spy
    const machine = createMachine({
      context: {
        count: 42
      },
      entry: log(({ context }) => `expr ${context.count}`, 'expr label')
    });
    (yield* Effect.tap(createActor(machine, { logger: consoleSpy }), (a) => a.start));

    expect(consoleSpy.mock.calls).toMatchInlineSnapshot(`
      [
        [
          "expr label",
          "expr 42",
        ],
      ]
    `);
  }));
});

describe('enqueueActions', () => {
  // upstream: test/actions.test.ts > enqueueActions > should execute a simple referenced action
  it.effect('should execute a simple referenced action', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine(
      {
        entry: enqueueActions(({ enqueue }) => {
          enqueue('someAction');
        })
      },
      {
        actions: {
          someAction: spy
        }
      }
    );

    (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(spy).toHaveBeenCalledTimes(1);
  }));

  // upstream: test/actions.test.ts > enqueueActions > should execute multiple different referenced actions
  it.effect('should execute multiple different referenced actions', () => Effect.gen(function* () {
    const spy1 = vi.fn();
    const spy2 = vi.fn();

    const machine = createMachine(
      {
        entry: enqueueActions(({ enqueue }) => {
          enqueue('someAction');
          enqueue('otherAction');
        })
      },
      {
        actions: {
          someAction: spy1,
          otherAction: spy2
        }
      }
    );

    (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(spy1).toHaveBeenCalledTimes(1);
    expect(spy2).toHaveBeenCalledTimes(1);
  }));

  // upstream: test/actions.test.ts > enqueueActions > should execute multiple same referenced actions
  it.effect('should execute multiple same referenced actions', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine(
      {
        entry: enqueueActions(({ enqueue }) => {
          enqueue('someAction');
          enqueue('someAction');
        })
      },
      {
        actions: {
          someAction: spy
        }
      }
    );

    (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(spy).toHaveBeenCalledTimes(2);
  }));

  // upstream: test/actions.test.ts > enqueueActions > should execute a parameterized action
  it.effect('should execute a parameterized action', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine(
      {
        entry: enqueueActions(({ enqueue }) => {
          enqueue({
            type: 'someAction',
            params: { answer: 42 }
          });
        })
      },
      {
        actions: {
          someAction: (_, params) => spy(params)
        }
      }
    );

    (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(spy.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "answer": 42,
          },
        ],
      ]
    `);
  }));

  // upstream: test/actions.test.ts > enqueueActions > should execute a function
  it.effect('should execute a function', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine({
      entry: enqueueActions(({ enqueue }) => {
        enqueue(spy);
      })
    });

    (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(spy).toHaveBeenCalledTimes(1);
  }));

  // upstream: test/actions.test.ts > enqueueActions > should execute a builtin action using its own action creator
  it.effect('should execute a builtin action using its own action creator', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine({
      on: {
        FOO: {
          actions: enqueueActions(({ enqueue }) => {
            enqueue(
              raise({
                type: 'RAISED'
              })
            );
          })
        },
        RAISED: {
          actions: spy
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'FOO' }));

    expect(spy).toHaveBeenCalledTimes(1);
  }));

  // upstream: test/actions.test.ts > enqueueActions > should execute a builtin action using its bound action creator
  it.effect('should execute a builtin action using its bound action creator', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine({
      on: {
        FOO: {
          actions: enqueueActions(({ enqueue }) => {
            enqueue.raise({
              type: 'RAISED'
            });
          })
        },
        RAISED: {
          actions: spy
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'FOO' }));

    expect(spy).toHaveBeenCalledTimes(1);
  }));

  // upstream: test/actions.test.ts > enqueueActions > should execute assigns when resolving the initial snapshot
  it.effect('should execute assigns when resolving the initial snapshot', () => Effect.gen(function* () {
    const machine = createMachine({
      context: {
        count: 0
      },
      entry: enqueueActions(({ enqueue }) => {
        enqueue.assign({
          count: 42
        });
      })
    });

    const snapshot = (yield* (yield* createActor(machine)).getSnapshot);

    expect(snapshot.context).toEqual({ count: 42 });
  }));

  // upstream: test/actions.test.ts > enqueueActions > should be able to check a simple referenced guard
  it.effect('should be able to check a simple referenced guard', () => Effect.gen(function* () {
    const spy = vi.fn().mockImplementation(() => true);
    const machine = createMachine(
      {
        context: {
          count: 0
        },
        entry: enqueueActions(({ check }) => {
          check('alwaysTrue');
        })
      },
      {
        guards: {
          alwaysTrue: spy
        }
      }
    );

    (yield* createActor(machine));

    expect(spy).toHaveBeenCalledTimes(1);
  }));

  // upstream: test/actions.test.ts > enqueueActions > should be able to check a parameterized guard
  it.effect('should be able to check a parameterized guard', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine(
      {
        context: {
          count: 0
        },
        entry: enqueueActions(({ check }) => {
          check({
            type: 'alwaysTrue',
            params: {
              max: 100
            }
          });
        })
      },
      {
        guards: {
          alwaysTrue: (_, params) => {
            spy(params);
            return true;
          }
        }
      }
    );

    (yield* createActor(machine));

    expect(spy.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "max": 100,
          },
        ],
      ]
    `);
  }));

  // upstream: test/actions.test.ts > enqueueActions > should provide self
  it.effect('should provide self', () => Effect.gen(function* () {
    expect.assertions(1);
    const machine = createMachine({
      entry: enqueueActions(({ self }) => {
        expect(self.send).toBeDefined();
      })
    });

    (yield* Effect.tap(createActor(machine), (a) => a.start));
  }));

  // upstream: test/actions.test.ts > enqueueActions > should be able to communicate with the parent using params
  it.effect('should be able to communicate with the parent using params', () => Effect.gen(function* () {
    type ParentEvent = { type: 'FOO' };

    const childMachine = setup({
      types: {} as {
        input: {
          parent?: ActorRef<Snapshot<unknown>, ParentEvent>;
        };
        context: {
          parent?: ActorRef<Snapshot<unknown>, ParentEvent>;
        };
      },
      actions: {
        mySendParent: enqueueActions(
          ({ context, enqueue }, event: ParentEvent) => {
            if (!context.parent) {
              // it's here just for illustration purposes
              console.log(
                'WARN: an attempt to send an event to a non-existent parent'
              );
              return;
            }
            enqueue.sendTo(context.parent, event);
          }
        )
      }
    }).createMachine({
      context: ({ input }) => ({ parent: input.parent }),
      entry: {
        type: 'mySendParent',
        params: {
          type: 'FOO'
        }
      }
    });

    const spy = vi.fn();

    const parentMachine = setup({
      types: {} as { events: ParentEvent },
      actors: {
        child: childMachine
      }
    }).createMachine({
      on: {
        FOO: {
          actions: spy
        }
      },
      invoke: {
        src: 'child',
        input: ({ self }) => ({ parent: self })
      }
    });

    const actorRef = (yield* Effect.tap(createActor(parentMachine), (a) => a.start));

    // the child's `sendTo` its parent enqueues without waiting (SD-23): let it be delivered,
    // then let every other delivery run, so that a second call would be counted
    yield* yieldUntil(() => spy.mock.calls.length > 0);
    yield* settle;

    expect(spy).toHaveBeenCalledTimes(1);
  }));

  // upstream: test/actions.test.ts > enqueueActions > should enqueue.sendParent
  it.effect('should enqueue.sendParent', () => Effect.gen(function* () {
    interface ChildEvent {
      type: 'CHILD_EVENT';
    }

    interface ParentEvent {
      type: 'PARENT_EVENT';
    }

    const childMachine = setup({
      types: {} as {
        events: ChildEvent;
      },
      actions: {
        sendToParent: enqueueActions(({ context, enqueue }) => {
          enqueue.sendParent({ type: 'PARENT_EVENT' });
        })
      }
    }).createMachine({
      entry: 'sendToParent'
    });

    const parentSpy = vi.fn();

    const parentMachine = setup({
      types: {} as { events: ParentEvent },
      actors: {
        child: childMachine
      }
    }).createMachine({
      on: {
        PARENT_EVENT: {
          actions: parentSpy
        }
      },
      invoke: {
        src: 'child'
      }
    });

    const actorRef = (yield* Effect.tap(createActor(parentMachine), (a) => a.start));

    // the child's `sendParent` enqueues without waiting (SD-23): let it be delivered, then
    // let every other delivery run, so that a second call would be counted
    yield* yieldUntil(() => parentSpy.mock.calls.length > 0);
    yield* settle;

    expect(parentSpy).toHaveBeenCalledTimes(1);
  }));
});

describe('sendParent', () => {
  // https://github.com/statelyai/xstate/issues/711
  // upstream: test/actions.test.ts > sendParent > TS: should compile for any event
  it.effect('TS: should compile for any event', () => Effect.gen(function* () {
    interface ChildEvent {
      type: 'CHILD';
    }

    const child = createMachine({
      types: {} as {
        events: ChildEvent;
      },
      id: 'child',
      initial: 'start',
      states: {
        start: {
          // This should not be a TypeScript error
          entry: [sendParent({ type: 'PARENT' })]
        }
      }
    });

    expect(child).toBeTruthy();
  }));
});

describe('sendTo', () => {
  // upstream: test/actions.test.ts > sendTo > should be able to send an event to an actor
  it.effect('should be able to send an event to an actor', () => Effect.gen(function* () {
    // upstream resolves a promise from inside the child; a Deferred does the same
    const promise = yield* Deferred.make<void>();
    const resolve = () => {
      Deferred.doneUnsafe(promise, Effect.void);
    };
    const childMachine = createMachine({
      types: {} as {
        events: { type: 'EVENT' };
      },
      initial: 'waiting',
      states: {
        waiting: {
          on: {
            EVENT: {
              actions: () => resolve()
            }
          }
        }
      }
    });

    const parentMachine = createMachine({
      types: {} as {
        context: {
          child: ActorRefFromLogic<typeof childMachine>;
        };
      },
      context: ({ spawn }) => ({
        child: spawn(childMachine)
      }),
      entry: sendTo(({ context }) => context.child, { type: 'EVENT' })
    });

    (yield* Effect.tap(createActor(parentMachine), (a) => a.start));
    yield* Deferred.await(promise);
  }));

  // upstream: test/actions.test.ts > sendTo > should be able to send an event from expression to an actor
  it.effect('should be able to send an event from expression to an actor', () => Effect.gen(function* () {
    // upstream resolves a promise from inside the child; a Deferred does the same
    const promise = yield* Deferred.make<void>();
    const resolve = () => {
      Deferred.doneUnsafe(promise, Effect.void);
    };
    const childMachine = createMachine({
      types: {} as {
        events: { type: 'EVENT'; count: number };
      },
      initial: 'waiting',
      states: {
        waiting: {
          on: {
            EVENT: {
              actions: () => resolve()
            }
          }
        }
      }
    });

    const parentMachine = createMachine({
      types: {} as {
        context: {
          child: ActorRefFromLogic<typeof childMachine>;
          count: number;
        };
      },
      context: ({ spawn }) => {
        return {
          child: spawn(childMachine, { id: 'child' }),
          count: 42
        };
      },
      entry: sendTo(
        ({ context }) => context.child,
        ({ context }) => ({ type: 'EVENT', count: context.count })
      )
    });

    (yield* Effect.tap(createActor(parentMachine), (a) => a.start));
    yield* Deferred.await(promise);
  }));

  // upstream: test/actions.test.ts > sendTo > should report a type error for an invalid event
  it.effect('should report a type error for an invalid event', () => Effect.gen(function* () {
    const childMachine = createMachine({
      types: {} as {
        events: { type: 'EVENT' };
      },
      initial: 'waiting',
      states: {
        waiting: {
          on: {
            EVENT: {}
          }
        }
      }
    });

    createMachine({
      types: {} as {
        context: {
          child: ActorRefFromLogic<typeof childMachine>;
        };
      },
      context: ({ spawn }) => ({
        child: spawn(childMachine)
      }),
      entry: sendTo(({ context }) => context.child, {
        // @ts-expect-error
        type: 'UNKNOWN'
      })
    });
  }));

  // upstream: test/actions.test.ts > sendTo > should be able to send an event to a named actor
  it.effect('should be able to send an event to a named actor', () => Effect.gen(function* () {
    // upstream resolves a promise from inside the child; a Deferred does the same
    const promise = yield* Deferred.make<void>();
    const resolve = () => {
      Deferred.doneUnsafe(promise, Effect.void);
    };
    const childMachine = createMachine({
      types: {} as {
        events: { type: 'EVENT' };
      },
      initial: 'waiting',
      states: {
        waiting: {
          on: {
            EVENT: {
              actions: () => resolve()
            }
          }
        }
      }
    });

    const parentMachine = createMachine({
      types: {} as {
        context: { child: ActorRefFromLogic<typeof childMachine> };
      },
      context: ({ spawn }) => ({
        child: spawn(childMachine, { id: 'child' })
      }),
      // No type-safety for the event yet
      entry: sendTo('child', { type: 'EVENT' })
    });

    (yield* Effect.tap(createActor(parentMachine), (a) => a.start));
    yield* Deferred.await(promise);
  }));

  // upstream: test/actions.test.ts > sendTo > should be able to send an event directly to an ActorRef
  it.effect('should be able to send an event directly to an ActorRef', () => Effect.gen(function* () {
    // upstream resolves a promise from inside the child; a Deferred does the same
    const promise = yield* Deferred.make<void>();
    const resolve = () => {
      Deferred.doneUnsafe(promise, Effect.void);
    };
    const childMachine = createMachine({
      types: {} as {
        events: { type: 'EVENT' };
      },
      initial: 'waiting',
      states: {
        waiting: {
          on: {
            EVENT: {
              actions: () => resolve()
            }
          }
        }
      }
    });

    const parentMachine = createMachine({
      types: {} as {
        context: { child: ActorRefFromLogic<typeof childMachine> };
      },
      context: ({ spawn }) => ({
        child: spawn(childMachine)
      }),
      entry: sendTo(({ context }) => context.child, { type: 'EVENT' })
    });

    (yield* Effect.tap(createActor(parentMachine), (a) => a.start));
    yield* Deferred.await(promise);
  }));

  // upstream: test/actions.test.ts > sendTo > should be able to read from event
  it.effect('should be able to read from event', () => Effect.gen(function* () {
    expect.assertions(1);
    // counts the events the callback child received (see below)
    let received = 0;
    const machine = createMachine({
      types: {} as {
        context: Record<string, CallbackActorRef<EventObject>>;
        events: { type: 'EVENT'; value: string };
      },
      initial: 'a',
      context: ({ spawn }) => ({
        foo: spawn(
          fromCallback(({ receive }) => {
            receive((event) => {
              received++;
              expect(event).toEqual({ type: 'EVENT' });
            });
          })
        )
      }),
      states: {
        a: {
          on: {
            EVENT: {
              actions: sendTo(({ context, event }) => context[event.value], {
                type: 'EVENT'
              })
            }
          }
        }
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* service.send({ type: 'EVENT', value: 'foo' }));

    // `sendTo` enqueues without waiting (SD-23) and the callback child runs in its own fiber:
    // yield, bounded and never on wall-clock time, until its `receive` handler has run
    yield* yieldUntil(() => received > 0);
  }));

  // upstream: test/actions.test.ts > sendTo > should error if given a string
  it.effect('should error if given a string', () => Effect.gen(function* () {
    const machine = createMachine({
      invoke: {
        id: 'child',
        src: fromCallback(() => {})
      },
      entry: sendTo('child', 'a string')
    });

    const errorSpy = vi.fn();

    const actorRef = (yield* createActor(machine));
    // the observer's `error` callback: called with the error the `changes` stream fails with
    yield* actorRef.changes.pipe(
      Stream.runDrain,
      Effect.catch((error) => Effect.sync(() => errorSpy(error))),
      Effect.forkScoped({ startImmediately: true })
    );
    (yield* actorRef.start);

    // the stream consumer runs in its own fiber: let it see the failure of the stream
    yield* yieldUntil(() => errorSpy.mock.calls.length > 0);
    expect(errorSpy.mock.calls).toMatchInlineSnapshot(`
      [
        [
          [Error: Only event objects may be used with sendTo; use sendTo({ type: "a string" }) instead],
        ],
      ]
    `);
  }));

  // upstream: test/actions.test.ts > sendTo > a self-event "handler" of an event sent using sendTo should be able to read updated snapshot of self
  it.effect('a self-event "handler" of an event sent using sendTo should be able to read updated snapshot of self', () => Effect.gen(function* () {
    const spy = vi.fn();
    const machine = createMachine({
      context: {
        counter: 0
      },
      initial: 'a',
      states: {
        a: {
          on: { NEXT: 'b' }
        },
        b: {
          entry: [
            assign({ counter: 1 }),
            sendTo(({ self }) => self, { type: 'EVENT' })
          ],
          on: {
            EVENT: {
              // `getSnapshot` is an Effect (D6): the inline action returns the Effect that reads
              // it and the actor runs it (SD-23)
              actions: ({ self }) => Effect.map(self.getSnapshot, (snapshot) => spy(snapshot.context)),
              target: 'c'
            }
          }
        },
        c: {}
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'NEXT' }));
    (yield* actorRef.send({ type: 'EVENT' }));

    expect(spy.mock.calls).toMatchInlineSnapshot(`
[
  [
    {
      "counter": 1,
    },
  ],
]
`);
  }));

  // upstream: test/actions.test.ts > sendTo > should not attempt to deliver a delayed event to the spawned actor's ID that was stopped since the event was scheduled
  it.effect("should not attempt to deliver a delayed event to the spawned actor's ID that was stopped since the event was scheduled", () => withTestLogger((logged) => Effect.gen(function* () {
    // SD-21: the test logger, not a console spy, receives the warnings
    const spy1 = vi.fn();

    const child1 = createMachine({
      on: {
        PING: {
          actions: spy1
        }
      }
    });

    const spy2 = vi.fn();

    const child2 = createMachine({
      on: {
        PING: {
          actions: spy2
        }
      }
    });

    const machine = setup({
      actors: {
        child1,
        child2
      }
    }).createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            START: 'b'
          }
        },
        b: {
          entry: [
            spawnChild('child1', {
              id: 'myChild'
            }),
            sendTo('myChild', { type: 'PING' }, { delay: 1 }),
            stopChild('myChild'),
            spawnChild('child2', {
              id: 'myChild'
            })
          ]
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'START' }));

    // upstream waits 10 ms of real time; the Effect form advances the test clock
    yield* TestClock.adjust("10 millis");
    // the scheduled delivery enqueues without waiting (SD-23): let the stopped child report
    // the dropped event, then let every other delivery run, so that the spies are not
    // checked vacuously
    yield* yieldUntil(() => warnCalls(logged).length > 0);
    yield* settle;

    expect(spy1).toHaveBeenCalledTimes(0);
    expect(spy2).toHaveBeenCalledTimes(0);

    expect(warnCalls(logged)).toMatchInlineSnapshot(`
[
  [
    "Event "PING" was sent to stopped actor "myChild (x:1)". This actor has already reached its final state, and will not transition.
Event: {"type":"PING"}",
  ],
]
`);
  })));

  // upstream: test/actions.test.ts > sendTo > should not attempt to deliver a delayed event to the invoked actor's ID that was stopped since the event was scheduled
  it.effect("should not attempt to deliver a delayed event to the invoked actor's ID that was stopped since the event was scheduled", () => withTestLogger((logged) => Effect.gen(function* () {
    // SD-21: the test logger, not a console spy, receives the warnings
    const spy1 = vi.fn();

    const child1 = createMachine({
      on: {
        PING: {
          actions: spy1
        }
      }
    });

    const spy2 = vi.fn();

    const child2 = createMachine({
      on: {
        PING: {
          actions: spy2
        }
      }
    });

    const machine = setup({
      actors: {
        child1,
        child2
      }
    }).createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            START: 'b'
          }
        },
        b: {
          entry: sendTo('myChild', { type: 'PING' }, { delay: 1 }),
          invoke: {
            src: 'child1',
            id: 'myChild'
          },
          on: {
            NEXT: 'c'
          }
        },
        c: {
          invoke: {
            src: 'child2',
            id: 'myChild'
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'START' }));
    (yield* actorRef.send({ type: 'NEXT' }));

    // upstream waits 10 ms of real time; the Effect form advances the test clock
    yield* TestClock.adjust("10 millis");
    // the scheduled delivery enqueues without waiting (SD-23): let the stopped child report
    // the dropped event, then let every other delivery run, so that the spies are not
    // checked vacuously
    yield* yieldUntil(() => warnCalls(logged).length > 0);
    yield* settle;

    expect(spy1).toHaveBeenCalledTimes(0);
    expect(spy2).toHaveBeenCalledTimes(0);

    expect(warnCalls(logged)).toMatchInlineSnapshot(`
[
  [
    "Event "PING" was sent to stopped actor "myChild (x:1)". This actor has already reached its final state, and will not transition.
Event: {"type":"PING"}",
  ],
]
`);
  })));
});

describe('raise', () => {
  // upstream: test/actions.test.ts > raise > should be able to send a delayed event to itself
  it.effect('should be able to send a delayed event to itself', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          entry: raise(
            { type: 'EVENT' },
            {
              delay: 1
            }
          ),
          on: {
            TO_B: 'b'
          }
        },
        b: {
          on: {
            EVENT: 'c'
          }
        },
        c: {
          type: 'final'
        }
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

    // the observer-object `subscribe` is not ported (D6, DEV-3): the `changes` stream ends
    // when the actor is done, so joining the fiber that drains it stands for the promise
    // that the observer's `complete` resolves
    const completed = yield* service.changes.pipe(
      Stream.runDrain,
      Effect.forkScoped({ startImmediately: true })
    );

    // Ensures that the delayed self-event is sent when in the `b` state
    (yield* service.send({ type: 'TO_B' }));
    // upstream's 1 ms delay elapses in real time; the Effect form advances the test clock
    yield* TestClock.adjust("1 millis");
    yield* Fiber.join(completed);
  }));

  // upstream: test/actions.test.ts > raise > should be able to send a delayed event to itself with delay = 0
  it.effect('should be able to send a delayed event to itself with delay = 0', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          entry: raise(
            { type: 'EVENT' },
            {
              delay: 0
            }
          ),
          on: {
            EVENT: 'b'
          }
        },
        b: {}
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

    // The state should not be changed yet; `delay: 0` is equivalent to `setTimeout(..., 0)`
    expect((yield* service.getSnapshot).value).toEqual('a');

    // upstream waits one `setTimeout(..., 0)` turn; the Effect form runs the test clock's
    // timers that are due now
    yield* TestClock.adjust("0 millis");
    // The state should be changed now
    expect((yield* service.getSnapshot).value).toEqual('b');
  }));

  // upstream: test/actions.test.ts > raise > should be able to raise an event and respond to it in the same state
  it.effect('should be able to raise an event and respond to it in the same state', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          entry: raise({ type: 'TO_B' }),
          on: {
            TO_B: 'b'
          }
        },
        b: {
          type: 'final'
        }
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect((yield* service.getSnapshot).value).toEqual('b');
  }));

  // upstream: test/actions.test.ts > raise > should be able to raise a delayed event and respond to it in the same state
  it.effect('should be able to raise a delayed event and respond to it in the same state', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          entry: raise(
            { type: 'TO_B' },
            {
              delay: 100
            }
          ),
          on: {
            TO_B: 'b'
          }
        },
        b: {
          type: 'final'
        }
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

    // the observer-object `subscribe` is not ported (D6, DEV-3): the `changes` stream ends
    // when the actor is done, so joining the fiber that drains it stands for the promise
    // that the observer's `complete` resolves
    const completed = yield* service.changes.pipe(
      Stream.runDrain,
      Effect.forkScoped({ startImmediately: true })
    );

    // upstream waits 50 ms of real time; the Effect form advances the test clock
    yield* TestClock.adjust("50 millis");

    // didn't transition yet
    expect((yield* service.getSnapshot).value).toEqual('a');

    // upstream's promise resolves when the 100 ms delay elapses in real time; the Effect
    // form advances the test clock by the remaining 50 ms
    yield* TestClock.adjust("50 millis");
    yield* Fiber.join(completed);
  }));

  // upstream: test/actions.test.ts > raise > should accept event expression
  it.effect('should accept event expression', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            NEXT: {
              actions: raise(() => ({ type: 'RAISED' }))
            },
            RAISED: 'b'
          }
        },
        b: {}
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actor.send({ type: 'NEXT' }));

    expect((yield* actor.getSnapshot).value).toBe('b');
  }));

  // upstream: test/actions.test.ts > raise > should be possible to access context in the event expression
  it.effect('should be possible to access context in the event expression', () => Effect.gen(function* () {
    type MachineEvent =
      | {
          type: 'RAISED';
        }
      | {
          type: 'NEXT';
        };
    interface MachineContext {
      eventType: MachineEvent['type'];
    }
    const machine = createMachine({
      types: {} as { context: MachineContext; events: MachineEvent },
      initial: 'a',
      context: {
        eventType: 'RAISED'
      },
      states: {
        a: {
          on: {
            NEXT: {
              actions: raise(({ context }) => ({
                type: context.eventType
              }))
            },
            RAISED: 'b'
          }
        },
        b: {}
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actor.send({ type: 'NEXT' }));

    expect((yield* actor.getSnapshot).value).toBe('b');
  }));

  // upstream: test/actions.test.ts > raise > should error if given a string
  it.effect('should error if given a string', () => Effect.gen(function* () {
    const machine = createMachine({
      entry: raise(
        // @ts-ignore
        'a string'
      )
    });

    const errorSpy = vi.fn();

    const actorRef = (yield* createActor(machine));
    // the observer's `error` callback: called with the error the `changes` stream fails with
    yield* actorRef.changes.pipe(
      Stream.runDrain,
      Effect.catch((error) => Effect.sync(() => errorSpy(error))),
      Effect.forkScoped({ startImmediately: true })
    );
    (yield* actorRef.start);

    // the stream consumer runs in its own fiber: let it see the failure of the stream
    yield* yieldUntil(() => errorSpy.mock.calls.length > 0);
    expect(errorSpy.mock.calls).toMatchInlineSnapshot(`
      [
        [
          [Error: Only event objects may be used with raise; use raise({ type: "a string" }) instead],
        ],
      ]
    `);
  }));
});

describe('cancel', () => {
  // upstream: test/actions.test.ts > cancel > should be possible to cancel a raised delayed event
  it.effect('should be possible to cancel a raised delayed event', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            NEXT: {
              actions: raise({ type: 'RAISED' }, { delay: 1, id: 'myId' })
            },
            RAISED: 'b',
            CANCEL: {
              actions: cancel('myId')
            }
          }
        },
        b: {}
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    // This should raise the 'RAISED' event after 1ms
    (yield* actor.send({ type: 'NEXT' }));

    // This should cancel the 'RAISED' event
    (yield* actor.send({ type: 'CANCEL' }));

    // upstream waits 10 ms of real time; the Effect form advances the test clock

    yield* TestClock.adjust("10 millis");
    expect((yield* actor.getSnapshot).value).toBe('a');
  }));

  // upstream: test/actions.test.ts > cancel > should cancel only the delayed event in the machine that scheduled it when canceling the event with the same ID in the machine that sent it first
  it.effect('should cancel only the delayed event in the machine that scheduled it when canceling the event with the same ID in the machine that sent it first', () => Effect.gen(function* () {
    const fooSpy = vi.fn();
    const barSpy = vi.fn();

    const machine = createMachine({
      invoke: [
        {
          id: 'foo',
          src: createMachine({
            id: 'foo',
            entry: raise({ type: 'event' }, { id: 'sameId', delay: 100 }),
            on: {
              event: { actions: fooSpy },
              cancel: { actions: cancel('sameId') }
            }
          })
        },
        {
          id: 'bar',
          src: createMachine({
            id: 'bar',
            entry: raise({ type: 'event' }, { id: 'sameId', delay: 100 }),
            on: {
              event: { actions: barSpy }
            }
          })
        }
      ],
      on: {
        cancelFoo: {
          actions: sendTo('foo', { type: 'cancel' })
        }
      }
    });
    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    // upstream waits 50 ms of real time; the Effect form advances the test clock

    yield* TestClock.adjust("50 millis");

    // This will cause the foo actor to cancel its 'sameId' delayed event
    // This should NOT cancel the 'sameId' delayed event in the other actor
    (yield* actor.send({ type: 'cancelFoo' }));
    // the parent's `sendTo` the child enqueues without waiting (SD-23): let the child
    // process `cancel` before the clock moves on, as upstream does before its sleep
    yield* settle;

    // upstream waits 55 ms of real time; the Effect form advances the test clock

    yield* TestClock.adjust("55 millis");
    // each child processes its own due event in its own fiber: let it run, then let every
    // other delivery run, so that a call to `fooSpy` would be counted
    yield* yieldUntil(() => barSpy.mock.calls.length > 0);
    yield* settle;

    expect(fooSpy).not.toHaveBeenCalled();
    expect(barSpy).toHaveBeenCalledTimes(1);
  }));

  // upstream: test/actions.test.ts > cancel > should cancel only the delayed event in the machine that scheduled it when canceling the event with the same ID in the machine that sent it second
  it.effect('should cancel only the delayed event in the machine that scheduled it when canceling the event with the same ID in the machine that sent it second', () => Effect.gen(function* () {
    const fooSpy = vi.fn();
    const barSpy = vi.fn();

    const machine = createMachine({
      invoke: [
        {
          id: 'foo',
          src: createMachine({
            id: 'foo',
            entry: raise({ type: 'event' }, { id: 'sameId', delay: 100 }),
            on: {
              event: { actions: fooSpy }
            }
          })
        },
        {
          id: 'bar',
          src: createMachine({
            id: 'bar',
            entry: raise({ type: 'event' }, { id: 'sameId', delay: 100 }),
            on: {
              event: { actions: barSpy },
              cancel: { actions: cancel('sameId') }
            }
          })
        }
      ],
      on: {
        cancelBar: {
          actions: sendTo('bar', { type: 'cancel' })
        }
      }
    });
    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    // upstream waits 50 ms of real time; the Effect form advances the test clock

    yield* TestClock.adjust("50 millis");

    // This will cause the bar actor to cancel its 'sameId' delayed event
    // This should NOT cancel the 'sameId' delayed event in the other actor
    (yield* actor.send({ type: 'cancelBar' }));
    // the parent's `sendTo` the child enqueues without waiting (SD-23): let the child
    // process `cancel` before the clock moves on, as upstream does before its sleep
    yield* settle;

    // upstream waits 55 ms of real time; the Effect form advances the test clock

    yield* TestClock.adjust("55 millis");
    // each child processes its own due event in its own fiber: let it run, then let every
    // other delivery run, so that a call to `barSpy` would be counted
    yield* yieldUntil(() => fooSpy.mock.calls.length > 0);
    yield* settle;

    expect(fooSpy).toHaveBeenCalledTimes(1);
    expect(barSpy).not.toHaveBeenCalled();
  }));

  // upstream: test/actions.test.ts > cancel > should not try to clear an undefined timeout when canceling an unscheduled timer
  it.effect('should not try to clear an undefined timeout when canceling an unscheduled timer', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine({
      on: {
        FOO: {
          actions: cancel('foo')
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine, {
      clock: {
        setTimeout,
        clearTimeout: spy
      }
    }), (a) => a.start));

    (yield* actorRef.send({
      type: 'FOO'
    }));

    expect(spy.mock.calls.length).toBe(0);
  }));

  // upstream: test/actions.test.ts > cancel > should be able to cancel a just scheduled delayed event to a just invoked child
  it.effect('should be able to cancel a just scheduled delayed event to a just invoked child', () => Effect.gen(function* () {
    const spy = vi.fn();

    const child = createMachine({
      on: {
        PING: {
          actions: spy
        }
      }
    });

    const machine = setup({
      actors: {
        child
      }
    }).createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            START: 'b'
          }
        },
        b: {
          entry: [
            sendTo('myChild', { type: 'PING' }, { id: 'myEvent', delay: 0 }),
            cancel('myEvent')
          ],
          invoke: {
            src: 'child',
            id: 'myChild'
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({
      type: 'START'
    }));

    // upstream waits 10 ms of real time; the Effect form advances the test clock

    yield* TestClock.adjust("10 millis");
    // let every enqueued delivery run, so that the assertion is not vacuous (SD-23)
    yield* settle;
    expect(spy.mock.calls.length).toBe(0);
  }));

  // upstream: test/actions.test.ts > cancel > should not be able to cancel a just scheduled non-delayed event to a just invoked child
  it.effect('should not be able to cancel a just scheduled non-delayed event to a just invoked child', () => Effect.gen(function* () {
    const spy = vi.fn();

    const child = createMachine({
      on: {
        PING: {
          actions: spy
        }
      }
    });

    const machine = setup({
      actors: {
        child
      }
    }).createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            START: 'b'
          }
        },
        b: {
          entry: [
            sendTo('myChild', { type: 'PING' }, { id: 'myEvent' }),
            cancel('myEvent')
          ],
          invoke: {
            src: 'child',
            id: 'myChild'
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({
      type: 'START'
    }));

    // the parent's `sendTo` the child enqueues without waiting (SD-23): let it be delivered,
    // then let every other delivery run, so that a second call would be counted
    yield* yieldUntil(() => spy.mock.calls.length > 0);
    yield* settle;

    expect(spy.mock.calls.length).toBe(1);
  }));
});

describe('assign action order', () => {
  // upstream: test/actions.test.ts > assign action order > should preserve action order
  it.effect('should preserve action order', () => Effect.gen(function* () {
    const captured: number[] = [];

    const machine = createMachine({
      types: {} as {
        context: { count: number };
      },
      context: { count: 0 },
      entry: [
        ({ context }) => captured.push(context.count), // 0
        assign({ count: ({ context }) => context.count + 1 }),
        ({ context }) => captured.push(context.count), // 1
        assign({ count: ({ context }) => context.count + 1 }),
        ({ context }) => captured.push(context.count) // 2
      ]
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect((yield* actor.getSnapshot).context).toEqual({ count: 2 });

    expect(captured).toEqual([0, 1, 2]);
  }));

  // upstream: test/actions.test.ts > assign action order > should deeply preserve action order
  it.effect('should deeply preserve action order', () => Effect.gen(function* () {
    const captured: number[] = [];

    interface CountCtx {
      count: number;
    }

    const machine = createMachine(
      {
        types: {} as {
          context: CountCtx;
        },
        context: { count: 0 },
        entry: [
          ({ context }) => captured.push(context.count), // 0
          enqueueActions(({ enqueue }) => {
            enqueue(assign({ count: ({ context }) => context.count + 1 }));
            enqueue({ type: 'capture' });
            enqueue(assign({ count: ({ context }) => context.count + 1 }));
          }),
          ({ context }) => captured.push(context.count) // 2
        ]
      },
      {
        actions: {
          capture: ({ context }) => captured.push(context.count)
        }
      }
    );

    (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(captured).toEqual([0, 1, 2]);
  }));

  // upstream: test/actions.test.ts > assign action order > should capture correct context values on subsequent transitions
  it.effect('should capture correct context values on subsequent transitions', () => Effect.gen(function* () {
    let captured: number[] = [];

    const machine = createMachine({
      types: {} as {
        context: { counter: number };
      },
      context: {
        counter: 0
      },
      on: {
        EV: {
          actions: [
            assign({ counter: ({ context }) => context.counter + 1 }),
            ({ context }) => captured.push(context.counter)
          ]
        }
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* service.send({ type: 'EV' }));
    (yield* service.send({ type: 'EV' }));

    expect(captured).toEqual([1, 2]);
  }));
});

describe('types', () => {
  // upstream: test/actions.test.ts > types > assign actions should be inferred correctly
  it.effect('assign actions should be inferred correctly', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        context: { count: number; text: string };
        events: { type: 'inc'; value: number } | { type: 'say'; value: string };
      },
      context: {
        count: 0,
        text: 'hello'
      },
      entry: [
        assign({ count: 31 }),
        // @ts-expect-error
        assign({ count: 'string' }),

        assign({ count: () => 31 }),
        // @ts-expect-error
        assign({ count: () => 'string' }),

        assign({ count: ({ context }) => context.count + 31 }),
        // @ts-expect-error
        assign({ count: ({ context }) => context.text + 31 }),

        assign(() => ({ count: 31 })),
        // @ts-expect-error
        assign(() => ({ count: 'string' })),

        assign(({ context }) => ({ count: context.count + 31 })),
        // @ts-expect-error
        assign(({ context }) => ({ count: context.text + 31 }))
      ],
      on: {
        say: {
          actions: [
            assign({ text: ({ event }) => event.value }),
            // @ts-expect-error
            assign({ count: ({ event }) => event.value }),

            assign(({ event }) => ({ text: event.value })),
            // @ts-expect-error
            assign(({ event }) => ({ count: event.value }))
          ]
        }
      }
    });
  }));
});

describe('action meta', () => {
  // NOT PORTED (todo upstream, ledger row): action meta > base action objects should have meta.action as the same base action object

  // upstream: test/actions.test.ts > action meta > should provide self
  it.effect('should provide self', () => Effect.gen(function* () {
    expect.assertions(1);

    const machine = createMachine({
      entry: ({ self }) => {
        expect(self.send).toBeDefined();
      }
    });

    (yield* Effect.tap(createActor(machine), (a) => a.start));
  }));
});

describe('actions', () => {
  // upstream: test/actions.test.ts > actions > should call transition actions in document order for same-level parallel regions
  it.effect('should call transition actions in document order for same-level parallel regions', () => Effect.gen(function* () {
    const actual: string[] = [];

    const machine = createMachine({
      type: 'parallel',
      states: {
        a: {
          on: {
            FOO: {
              actions: () => actual.push('a')
            }
          }
        },
        b: {
          on: {
            FOO: {
              actions: () => actual.push('b')
            }
          }
        }
      }
    });
    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* service.send({ type: 'FOO' }));

    expect(actual).toEqual(['a', 'b']);
  }));

  // upstream: test/actions.test.ts > actions > should call transition actions in document order for states at different levels of parallel regions
  it.effect('should call transition actions in document order for states at different levels of parallel regions', () => Effect.gen(function* () {
    const actual: string[] = [];

    const machine = createMachine({
      type: 'parallel',
      states: {
        a: {
          initial: 'a1',
          states: {
            a1: {
              on: {
                FOO: {
                  actions: () => actual.push('a1')
                }
              }
            }
          }
        },
        b: {
          on: {
            FOO: {
              actions: () => actual.push('b')
            }
          }
        }
      }
    });
    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* service.send({ type: 'FOO' }));

    expect(actual).toEqual(['a1', 'b']);
  }));

  // upstream: test/actions.test.ts > actions > should call an inline action responding to an initial raise with the raised event
  it.effect('should call an inline action responding to an initial raise with the raised event', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine({
      entry: raise({ type: 'HELLO' }),
      on: {
        HELLO: {
          actions: ({ event }) => {
            spy(event);
          }
        }
      }
    });

    (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(spy).toHaveBeenCalledWith({ type: 'HELLO' });
  }));

  // upstream: test/actions.test.ts > actions > should call a referenced action responding to an initial raise with the raised event
  it.effect('should call a referenced action responding to an initial raise with the raised event', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine(
      {
        entry: raise({ type: 'HELLO' }),
        on: {
          HELLO: {
            actions: 'foo'
          }
        }
      },
      {
        actions: {
          foo: ({ event }) => {
            spy(event);
          }
        }
      }
    );

    (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(spy).toHaveBeenCalledWith({ type: 'HELLO' });
  }));

  // upstream: test/actions.test.ts > actions > should call an inline action responding to an initial raise with updated (non-initial) context
  it.effect('should call an inline action responding to an initial raise with updated (non-initial) context', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine({
      context: { count: 0 },
      entry: [assign({ count: 42 }), raise({ type: 'HELLO' })],
      on: {
        HELLO: {
          actions: ({ context }) => {
            spy(context);
          }
        }
      }
    });

    (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(spy).toHaveBeenCalledWith({ count: 42 });
  }));

  // upstream: test/actions.test.ts > actions > should call a referenced action responding to an initial raise with updated (non-initial) context
  it.effect('should call a referenced action responding to an initial raise with updated (non-initial) context', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine(
      {
        context: { count: 0 },
        entry: [assign({ count: 42 }), raise({ type: 'HELLO' })],
        on: {
          HELLO: {
            actions: 'foo'
          }
        }
      },
      {
        actions: {
          foo: ({ context }) => {
            spy(context);
          }
        }
      }
    );

    (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(spy).toHaveBeenCalledWith({ count: 42 });
  }));

  // upstream: test/actions.test.ts > actions > should call inline entry custom action with undefined parametrized action object
  it.effect('should call inline entry custom action with undefined parametrized action object', () => Effect.gen(function* () {
    const spy = vi.fn();
    (yield* Effect.tap(createActor(
      createMachine({
        entry: (_, params) => {
          spy(params);
        }
      })
    ), (a) => a.start));

    expect(spy).toHaveBeenCalledWith(undefined);
  }));

  // upstream: test/actions.test.ts > actions > should call inline entry builtin action with undefined parametrized action object
  it.effect('should call inline entry builtin action with undefined parametrized action object', () => Effect.gen(function* () {
    const spy = vi.fn();
    (yield* Effect.tap(createActor(
      createMachine({
        entry: assign((_, params) => {
          spy(params);
          return {};
        })
      })
    ), (a) => a.start));

    expect(spy).toHaveBeenCalledWith(undefined);
  }));

  // upstream: test/actions.test.ts > actions > should call inline transition custom action with undefined parametrized action object
  it.effect('should call inline transition custom action with undefined parametrized action object', () => Effect.gen(function* () {
    const spy = vi.fn();

    const actorRef = (yield* Effect.tap(createActor(
      createMachine({
        on: {
          FOO: {
            actions: (_, params) => {
              spy(params);
            }
          }
        }
      })
    ), (a) => a.start));
    (yield* actorRef.send({ type: 'FOO' }));

    expect(spy).toHaveBeenCalledWith(undefined);
  }));

  // upstream: test/actions.test.ts > actions > should call inline transition builtin action with undefined parameters
  it.effect('should call inline transition builtin action with undefined parameters', () => Effect.gen(function* () {
    const spy = vi.fn();

    const actorRef = (yield* Effect.tap(createActor(
      createMachine({
        on: {
          FOO: {
            actions: assign((_, params) => {
              spy(params);
              return {};
            })
          }
        }
      })
    ), (a) => a.start));
    (yield* actorRef.send({ type: 'FOO' }));

    expect(spy).toHaveBeenCalledWith(undefined);
  }));

  // upstream: test/actions.test.ts > actions > should call a referenced custom action with undefined params when it has no params and it is referenced using a string
  it.effect('should call a referenced custom action with undefined params when it has no params and it is referenced using a string', () => Effect.gen(function* () {
    const spy = vi.fn();

    (yield* Effect.tap(createActor(
      createMachine(
        {
          entry: 'myAction'
        },
        {
          actions: {
            myAction: (_, params) => {
              spy(params);
            }
          }
        }
      )
    ), (a) => a.start));

    expect(spy).toHaveBeenCalledWith(undefined);
  }));

  // upstream: test/actions.test.ts > actions > should call a referenced builtin action with undefined params when it has no params and it is referenced using a string
  it.effect('should call a referenced builtin action with undefined params when it has no params and it is referenced using a string', () => Effect.gen(function* () {
    const spy = vi.fn();

    (yield* Effect.tap(createActor(
      createMachine(
        {
          entry: 'myAction'
        },
        {
          actions: {
            myAction: assign((_, params) => {
              spy(params);
              return {};
            })
          }
        }
      )
    ), (a) => a.start));

    expect(spy).toHaveBeenCalledWith(undefined);
  }));

  // upstream: test/actions.test.ts > actions > should call a referenced custom action with the provided parametrized action object
  it.effect('should call a referenced custom action with the provided parametrized action object', () => Effect.gen(function* () {
    const spy = vi.fn();

    (yield* Effect.tap(createActor(
      createMachine(
        {
          entry: {
            type: 'myAction',
            params: {
              foo: 'bar'
            }
          }
        },
        {
          actions: {
            myAction: (_, params) => {
              spy(params);
            }
          }
        }
      )
    ), (a) => a.start));

    expect(spy).toHaveBeenCalledWith({
      foo: 'bar'
    });
  }));

  // upstream: test/actions.test.ts > actions > should call a referenced builtin action with the provided parametrized action object
  it.effect('should call a referenced builtin action with the provided parametrized action object', () => Effect.gen(function* () {
    const spy = vi.fn();

    (yield* Effect.tap(createActor(
      createMachine(
        {
          entry: {
            type: 'myAction',
            params: {
              foo: 'bar'
            }
          }
        },
        {
          actions: {
            myAction: assign((_, params) => {
              spy(params);
              return {};
            })
          }
        }
      )
    ), (a) => a.start));

    expect(spy).toHaveBeenCalledWith({
      foo: 'bar'
    });
  }));

  // upstream: test/actions.test.ts > actions > should warn if called in custom action
  it.effect('should warn if called in custom action', () => withTestLogger((logged) => Effect.gen(function* () {
    // SD-21: the test logger, not a console spy, receives the warnings
    const machine = createMachine({
      entry: () => {
        assign({});
        raise({ type: '' });
        sendTo('', { type: '' });
        emit({ type: '' });
      }
    });

    (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(warnCalls(logged)).toMatchInlineSnapshot(`
[
  [
    "Custom actions should not call \`assign()\` directly, as it is not imperative. See https://stately.ai/docs/actions#built-in-actions for more details.",
  ],
  [
    "Custom actions should not call \`raise()\` directly, as it is not imperative. See https://stately.ai/docs/actions#built-in-actions for more details.",
  ],
  [
    "Custom actions should not call \`sendTo()\` directly, as it is not imperative. See https://stately.ai/docs/actions#built-in-actions for more details.",
  ],
  [
    "Custom actions should not call \`emit()\` directly, as it is not imperative. See https://stately.ai/docs/actions#built-in-actions for more details.",
  ],
]
`);
  })));

  // upstream: test/actions.test.ts > actions > inline actions should not leak into provided actions object
  it.effect('inline actions should not leak into provided actions object', () => Effect.gen(function* () {
    const actions = {};

    const machine = createMachine(
      {
        entry: () => {}
      },
      { actions }
    );

    (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(actions).toEqual({});
  }));
});
