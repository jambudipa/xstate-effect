import { describe, expect, it, vi } from "@effect/vitest"
import { Deferred, Duration, Effect, Scope, Stream } from "effect"
import { TestClock } from "effect/testing"
import { createMachine, createActor } from "../../src/index.js";

const lightMachine = createMachine({
  id: 'light',
  initial: 'green',
  context: {
    canTurnGreen: true
  },
  states: {
    green: {
      after: {
        1000: 'yellow'
      }
    },
    yellow: {
      after: {
        1000: [{ target: 'red' }]
      }
    },
    red: {
      after: {
        1000: 'green'
      }
    }
  }
});

// Upstream switches to vitest fake timers per test (`vi.useFakeTimers()`) and restores the
// real timers in an `afterEach`. The rewrites never use fake or real timers: the actor's
// default clock is the Effect clock, and `it.effect` provides a fresh `TestClock` to each
// test, so `vi.advanceTimersByTime(n)` is `TestClock.adjust` by the same amount and nothing
// needs restoring.

// A delivery from the scheduler enqueues without waiting (SD-23), and a `changes` consumer
// runs in its own fiber, so a test yields its fiber, at most 100 times and never on
// wall-clock time, until what it needs has happened.
const yieldUntil = (done: () => boolean | Effect.Effect<boolean>) =>
  Effect.yieldNow.pipe(Effect.repeat({ until: done, times: 100 }));

// Before an assertion that something did NOT happen: give every enqueued delivery the
// chance to run, so that the assertion is not vacuous.
const settle = yieldUntil(() => false);

// Upstream observes completion with an observer-object `subscribe({ complete })`, which is not
// ported (D6, DEV-3): the `changes` stream ends when the actor is done or stopped, and fails
// with the actor's error (SD-4). `onComplete` forks, before the next step runs, a fiber that
// drains the stream and then completes the returned Deferred with the stream's exit, so
// `Deferred.await` stands for the promise that upstream resolves in `complete` (and fails
// the test with the actor's error instead of hanging).
const onComplete = <E>(actor: { readonly changes: Stream.Stream<unknown, E> }) =>
  Effect.gen(function* () {
    const completed = yield* Deferred.make<void, E>();
    yield* actor.changes.pipe(
      Stream.runDrain,
      Effect.exit,
      Effect.flatMap((exit) => Deferred.done(completed, exit)),
      Effect.forkScoped({ startImmediately: true })
    );
    return completed;
  });

// Upstream gives the actor a clock whose `setTimeout` is the host timer, and then waits 5 ms
// of real time. The rewrites never wait on wall-clock time: `effectSetTimeout` gives that
// clock a `setTimeout` stand-in that runs `fn` after `ms` of Effect-clock time, in a fiber of
// the test's scope, and returns a fresh timer id as the host timer does, so the test fires
// the timer by advancing the TestClock.
const effectSetTimeout = Effect.map(Effect.context<Scope.Scope>(), (context) => {
  const runFork = Effect.runForkWith(context);
  let nextId = 0;
  return (fn: () => void, ms = 0): number => {
    runFork(
      Effect.forkScoped(
        Effect.sleep(Duration.millis(ms)).pipe(Effect.andThen(Effect.sync(fn))),
        { startImmediately: true }
      )
    );
    nextId += 1;
    return nextId;
  };
});

describe('delayed transitions', () => {
  // upstream: test/after.test.ts > delayed transitions > should transition after delay
  it.effect('should transition after delay', () => Effect.gen(function* () {
    // upstream calls `vi.useFakeTimers()` here; `it.effect` already runs on the TestClock

    const actorRef = (yield* Effect.tap(createActor(lightMachine), (a) => a.start));
    expect((yield* actorRef.getSnapshot).value).toBe('green');

    yield* TestClock.adjust("500 millis");
    expect((yield* actorRef.getSnapshot).value).toBe('green');

    yield* TestClock.adjust("510 millis");
    expect((yield* actorRef.getSnapshot).value).toBe('yellow');
  }));

  // upstream: test/after.test.ts > delayed transitions > should not try to clear an undefined timeout when exiting source state of a delayed transition
  it.effect('should not try to clear an undefined timeout when exiting source state of a delayed transition', () => Effect.gen(function* () {
    // https://github.com/statelyai/xstate/issues/5001
    const spy = vi.fn();

    const machine = createMachine({
      initial: 'green',
      states: {
        green: {
          after: {
            1: 'yellow'
          }
        },
        yellow: {}
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine, {
      clock: {
        // upstream passes the host `setTimeout` (see `effectSetTimeout`)
        setTimeout: yield* effectSetTimeout,
        clearTimeout: spy
      }
    }), (a) => a.start));

    // when the after transition gets executed it tries to clear its own timer when exiting its source state
    // upstream runs `await sleep(5)` of real time; the Effect form advances the test clock by the
    // same amount, then lets the delivered event's macrostep run before the assertions
    yield* TestClock.adjust("5 millis");
    yield* settle;
    expect((yield* actorRef.getSnapshot).value).toBe('yellow');
    expect(spy.mock.calls.length).toBe(0);
  }));

  // upstream: test/after.test.ts > delayed transitions > should format transitions properly
  it.effect('should format transitions properly', () => Effect.gen(function* () {
    const greenNode = lightMachine.states.green!;

    const transitions = greenNode.transitions;

    // The port's transitions are the upstream Map's entries in its order (SD-22, amended 2026-10-08)
    expect(transitions.map(([descriptor]) => descriptor)).toMatchInlineSnapshot(`
      [
        "xstate.after.1000.light.green",
      ]
    `);
  }));

  // upstream: test/after.test.ts > delayed transitions > should be able to transition with delay from nested initial state
  it.effect('should be able to transition with delay from nested initial state', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'nested',
      states: {
        nested: {
          initial: 'wait',
          states: {
            wait: {
              after: {
                10: '#end'
              }
            }
          }
        },
        end: {
          id: 'end',
          type: 'final'
        }
      }
    });

    const actor = (yield* createActor(machine));
    // the observer's `complete` resolves the promise upstream returns (see `onComplete`)
    const completed = yield* onComplete(actor);
    (yield* actor.start);

    // upstream lets the host timer run; the Effect form advances the test clock past the
    // 10 ms delay and returns when the actor is done
    yield* TestClock.adjust("10 millis");
    yield* Deferred.await(completed);
  }));

  // upstream: test/after.test.ts > delayed transitions > parent state should enter child state without re-entering self (relative target)
  it.effect('parent state should enter child state without re-entering self (relative target)', () => Effect.gen(function* () {
    const actual: string[] = [];

    const machine = createMachine({
      initial: 'one',
      states: {
        one: {
          initial: 'two',
          entry: () => actual.push('entered one'),
          states: {
            two: {
              entry: () => actual.push('entered two')
            },
            three: {
              entry: () => actual.push('entered three'),
              always: '#end'
            }
          },
          after: {
            10: '.three'
          }
        },
        end: {
          id: 'end',
          type: 'final'
        }
      }
    });

    const actor = (yield* createActor(machine));
    // the observer's `complete` resolves the promise upstream returns (see `onComplete`)
    const completed = yield* onComplete(actor);
    (yield* actor.start);

    // upstream lets the host timer run; the Effect form advances the test clock past the
    // 10 ms delay and waits until the actor is done
    yield* TestClock.adjust("10 millis");
    yield* Deferred.await(completed);

    // the body of the observer's `complete` callback
    expect(actual).toEqual(['entered one', 'entered two', 'entered three']);
  }));

  // upstream: test/after.test.ts > delayed transitions > should defer a single send event for a delayed conditional transition (#886)
  it.effect('should defer a single send event for a delayed conditional transition (#886)', () => Effect.gen(function* () {
    // upstream calls `vi.useFakeTimers()` here; `it.effect` already runs on the TestClock
    const spy = vi.fn();
    const machine = createMachine({
      initial: 'X',
      states: {
        X: {
          after: {
            1: [
              {
                target: 'Y',
                guard: () => true
              },
              {
                target: 'Z'
              }
            ]
          }
        },
        Y: {
          on: {
            '*': {
              actions: spy
            }
          }
        },
        Z: {}
      }
    });

    (yield* Effect.tap(createActor(machine), (a) => a.start));

    yield* TestClock.adjust("10 millis");
    // let every enqueued delivery run, so that a second deferred event would reach `Y`
    yield* settle;
    expect(spy).not.toHaveBeenCalled();
  }));

  // TODO: figure out correct behavior for restoring delayed transitions
  // NOT PORTED (skipped upstream, ledger row): delayed transitions > should execute an after transition after starting from a state resolved using `.getPersistedSnapshot`

  // upstream: test/after.test.ts > delayed transitions > should execute an after transition after starting from a persisted state
  it.effect('should execute an after transition after starting from a persisted state', () => Effect.gen(function* () {
    const createMyMachine = () =>
      createMachine({
        initial: 'A',
        states: {
          A: {
            on: {
              NEXT: 'B'
            }
          },
          B: {
            after: {
              1: 'C'
            }
          },
          C: {
            type: 'final'
          }
        }
      });

    let service = (yield* Effect.tap(createActor(createMyMachine()), (a) => a.start));

    const persistedSnapshot = JSON.parse(JSON.stringify((yield* service.getSnapshot)));

    service = (yield* Effect.tap(createActor(createMyMachine(), {
      snapshot: persistedSnapshot
    }), (a) => a.start));

    (yield* service.send({ type: 'NEXT' }));

    // the observer's `complete` resolves the promise upstream returns (see `onComplete`)
    const completed = yield* onComplete(service);

    // upstream lets the host timer run; the Effect form advances the test clock past the
    // 1 ms delay and returns when the actor is done
    yield* TestClock.adjust("1 millis");
    yield* Deferred.await(completed);
  }));

  describe('delay expressions', () => {
    // upstream: test/after.test.ts > delayed transitions > delay expressions > should evaluate the expression (function) to determine the delay
    it.effect('should evaluate the expression (function) to determine the delay', () => Effect.gen(function* () {
      // upstream calls `vi.useFakeTimers()` here; `it.effect` already runs on the TestClock
      const spy = vi.fn();
      const context = {
        delay: 500
      };
      const machine = createMachine(
        {
          initial: 'inactive',
          context,
          states: {
            inactive: {
              after: { myDelay: 'active' }
            },
            active: {}
          }
        },
        {
          delays: {
            myDelay: ({ context }) => {
              spy(context);
              return context.delay;
            }
          }
        }
      );

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

      expect(spy).toBeCalledWith(context);
      expect((yield* actor.getSnapshot).value).toBe('inactive');

      yield* TestClock.adjust("300 millis");
      expect((yield* actor.getSnapshot).value).toBe('inactive');

      yield* TestClock.adjust("200 millis");
      expect((yield* actor.getSnapshot).value).toBe('active');
    }));

    // upstream: test/after.test.ts > delayed transitions > delay expressions > should evaluate the expression (string) to determine the delay
    it.effect('should evaluate the expression (string) to determine the delay', () => Effect.gen(function* () {
      // upstream calls `vi.useFakeTimers()` here; `it.effect` already runs on the TestClock
      const spy = vi.fn();
      const machine = createMachine(
        {
          initial: 'inactive',
          states: {
            inactive: {
              on: {
                ACTIVATE: 'active'
              }
            },
            active: {
              after: {
                someDelay: 'inactive'
              }
            }
          }
        },
        {
          delays: {
            someDelay: ({ event }) => {
              spy(event);
              return event.delay;
            }
          }
        }
      );

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

      const event = {
        type: 'ACTIVATE',
        delay: 500
      } as const;
      (yield* actor.send(event));

      expect(spy).toBeCalledWith(event);
      expect((yield* actor.getSnapshot).value).toBe('active');

      yield* TestClock.adjust("300 millis");
      expect((yield* actor.getSnapshot).value).toBe('active');

      yield* TestClock.adjust("200 millis");
      expect((yield* actor.getSnapshot).value).toBe('inactive');
    }));
  });
});
