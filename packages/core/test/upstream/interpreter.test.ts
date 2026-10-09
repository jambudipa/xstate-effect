import { describe, expect, it, vi } from "@effect/vitest"
import { Deferred, Duration, Effect, Exit, Logger, Option, Scope, Stream } from "effect"
import { TestClock } from "effect/testing"
import { SimulatedClock } from "../../src/index.js";
import {
  createActor,
  assign,
  sendParent,
  StateValue,
  createMachine,
  ActorRefFrom,
  cancel,
  raise,
  stopChild,
  log,
  AnyActorRef,
  SnapshotFrom
} from "../../src/index.js";
import { interval, VirtualTimeScheduler } from 'rxjs';
import { fromObservable } from "../../src/index.js";
import { PromiseActorLogic, fromPromise } from "../../src/index.js";
import { fromCallback } from "../../src/index.js";

// Upstream reads snapshots, observer callbacks and invoked or spawned logic before the outer
// call returns. Here invoked and spawned logic runs in the child's own fiber (D12), a send
// from inside an actor enqueues without waiting (SD-23), and a `subscribe` callback or a
// `changes` consumer runs in its own fiber, so a test yields its fiber, at most 100 times and
// never on wall-clock time, until what it needs has happened.
const yieldUntil = (done: () => boolean | Effect.Effect<boolean>) =>
  Effect.yieldNow.pipe(Effect.repeat({ until: done, times: 100 }));

// Before an assertion that something did NOT happen (or happened an exact number of times):
// give every enqueued delivery the chance to run, so that the assertion is not vacuous.
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

// Upstream spies on `console.warn`. The port reports a warning through the actor's logger
// (`Effect.logWarning` by default, SD-21), never through the console. This test logger keeps
// every log entry so a test can assert on the warnings.
const testLogger = (entries: Array<Logger.Options<unknown>>) =>
  Logger.layer([
    Logger.make((options) => {
      entries.push(options);
    })
  ]);

// The message parts of each warning entry, as the arguments of each upstream `console.warn`
// call (what `warnSpy.mock.calls` holds upstream).
const warnCalls = (entries: ReadonlyArray<Logger.Options<unknown>>): ReadonlyArray<ReadonlyArray<unknown>> =>
  entries
    .filter((entry) => entry.logLevel === 'Warn')
    .map((entry) => (Array.isArray(entry.message) ? entry.message : [entry.message]));

// Upstream user code (a promise executor) defers work with `setTimeout(fn, ms)` on the host
// timer. The rewrites never wait on wall-clock time: `effectTimers` gives that code a
// `setTimeout` stand-in that runs `fn` after `ms` of Effect-clock time, in a fiber of the
// test's scope, so the test fires it by advancing the TestClock.
const effectTimers = Effect.map(Effect.context<Scope.Scope>(), (context) => {
  const runFork = Effect.runForkWith(context);
  return (fn: () => void, ms = 0): void => {
    runFork(
      Effect.forkScoped(
        Effect.sleep(Duration.millis(ms)).pipe(Effect.andThen(Effect.sync(fn))),
        { startImmediately: true }
      )
    );
  };
});

// Upstream's rxjs `interval(10)` source runs on the host timer, so its test waits tens of
// milliseconds of real time. Here the interval runs on an rxjs `VirtualTimeScheduler`, and
// `virtualTime(scheduler)` gives the test an `advance(ms)` that moves that clock forward,
// runs the emissions due by then, and lets every actor take them (`settle`) before the next
// step, as the 10 ms gaps of the host timer do upstream.
const virtualTime = (scheduler: VirtualTimeScheduler) => {
  let now = 0;
  return (ms: number) =>
    Effect.andThen(
      Effect.sync(() => {
        now += ms;
        scheduler.maxFrames = now;
        scheduler.flush();
        scheduler.frame = now;
      }),
      settle
    );
};

const lightMachine = createMachine({
  id: 'light',
  initial: 'green',
  states: {
    green: {
      entry: [raise({ type: 'TIMER' }, { id: 'TIMER1', delay: 10 })],
      on: {
        TIMER: 'yellow',
        KEEP_GOING: {
          actions: [cancel('TIMER1')]
        }
      }
    },
    yellow: {
      entry: [raise({ type: 'TIMER' }, { delay: 10 })],
      on: {
        TIMER: 'red'
      }
    },
    red: {
      after: {
        10: 'green'
      }
    }
  }
});

describe('interpreter', () => {
  describe('initial state', () => {
    // upstream: test/interpreter.test.ts > interpreter > initial state > .getSnapshot returns the initial state
    it.effect('.getSnapshot returns the initial state', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'foo',
        states: {
          bar: {},
          foo: {}
        }
      });
      const service = (yield* createActor(machine));

      expect((yield* service.getSnapshot).value).toEqual('foo');
    }));

    // upstream: test/interpreter.test.ts > interpreter > initial state > initially spawned actors should not be spawned when reading initial state
    it.effect('initially spawned actors should not be spawned when reading initial state', () => Effect.gen(function* () {
      let promiseSpawned = 0;

      const machine = createMachine({
        initial: 'idle',
        context: {
          actor: undefined! as ActorRefFrom<PromiseActorLogic<unknown>>
        },
        states: {
          idle: {
            entry: assign({
              actor: ({ spawn }) => {
                return spawn(
                  fromPromise(
                    () =>
                      new Promise(() => {
                        promiseSpawned++;
                      })
                  )
                );
              }
            })
          }
        }
      });

      const service = (yield* createActor(machine));

      expect(promiseSpawned).toEqual(0);

      (yield* service.getSnapshot);
      (yield* service.getSnapshot);
      (yield* service.getSnapshot);

      expect(promiseSpawned).toEqual(0);

      (yield* service.start);

      // upstream checks from a 100 ms `setTimeout`; the Effect form advances the test clock
      // and lets the spawned promise actor start in its own fiber before the exact count
      yield* TestClock.adjust("100 millis");
      yield* settle;
      expect(promiseSpawned).toEqual(1);
    }));

    // upstream: test/interpreter.test.ts > interpreter > initial state > does not execute actions from a restored state
    it.effect('does not execute actions from a restored state', () => Effect.gen(function* () {
      let called = false;
      const machine = createMachine({
        initial: 'green',
        states: {
          green: {
            on: {
              TIMER: {
                target: 'yellow',
                actions: () => (called = true)
              }
            }
          },
          yellow: {
            on: {
              TIMER: {
                target: 'red'
              }
            }
          },
          red: {
            on: {
              TIMER: 'green'
            }
          }
        }
      });

      let actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

      (yield* actorRef.send({ type: 'TIMER' }));
      called = false;
      const persisted = (yield* actorRef.getPersistedSnapshot);
      actorRef = (yield* Effect.tap(createActor(machine, { snapshot: persisted }), (a) => a.start));

      expect(called).toBe(false);
    }));

    // upstream: test/interpreter.test.ts > interpreter > initial state > should not execute actions that are not part of the actual persisted state
    it.effect('should not execute actions that are not part of the actual persisted state', () => Effect.gen(function* () {
      let called = false;
      const machine = createMachine({
        initial: 'a',
        states: {
          a: {
            entry: () => {
              // this should not be called when starting from a different state
              called = true;
            },
            always: 'b'
          },
          b: {}
        }
      });

      const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
      called = false;
      expect((yield* actorRef.getSnapshot).value).toEqual('b');
      const persisted = (yield* actorRef.getPersistedSnapshot);

      (yield* Effect.tap(createActor(machine, { snapshot: persisted }), (a) => a.start));

      expect(called).toBe(false);
    }));
  });

  describe('subscribing', () => {
    const machine = createMachine({
      initial: 'active',
      states: {
        active: {}
      }
    });

    // upstream: test/interpreter.test.ts > interpreter > subscribing > should not notify subscribers of the current state upon subscription (subscribe)
    it.effect('should not notify subscribers of the current state upon subscription (subscribe)', () => Effect.gen(function* () {
      const spy = vi.fn();
      const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

      yield* service.subscribe((s) => Effect.sync(() => spy(s)));

      // give a delivery at subscription time the chance to run, so the assertion is not vacuous
      yield* settle;
      expect(spy).not.toHaveBeenCalled();
    }));
  });

  describe('send with delay', () => {
    // upstream: test/interpreter.test.ts > interpreter > send with delay > can send an event after a delay
    it.effect('can send an event after a delay', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'foo',
        states: {
          foo: {
            entry: [raise({ type: 'TIMER' }, { delay: 10 })],
            on: {
              TIMER: 'bar'
            }
          },
          bar: {}
        }
      });
      const actorRef = (yield* createActor(machine));
      expect((yield* actorRef.getSnapshot).value).toBe('foo');

      // upstream waits on real timers; the actor's default clock is the Effect clock, so the
      // Effect form advances the test clock by the same amounts
      yield* TestClock.adjust("10 millis");
      expect((yield* actorRef.getSnapshot).value).toBe('foo');

      (yield* actorRef.start);
      expect((yield* actorRef.getSnapshot).value).toBe('foo');

      yield* TestClock.adjust("5 millis");
      expect((yield* actorRef.getSnapshot).value).toBe('foo');

      yield* TestClock.adjust("10 millis");
      expect((yield* actorRef.getSnapshot).value).toBe('bar');
    }));

    // upstream: test/interpreter.test.ts > interpreter > send with delay > can send an event after a delay (expression)
    it.effect('can send an event after a delay (expression)', () => Effect.gen(function* () {
      interface DelayExprMachineCtx {
        initialDelay: number;
      }

      type DelayExpMachineEvents =
        | { type: 'ACTIVATE'; wait: number }
        | { type: 'FINISH' };

      const delayExprMachine = createMachine({
        types: {} as {
          context: DelayExprMachineCtx;
          events: DelayExpMachineEvents;
        },
        id: 'delayExpr',
        context: {
          initialDelay: 100
        },
        initial: 'idle',
        states: {
          idle: {
            on: {
              ACTIVATE: 'pending'
            }
          },
          pending: {
            entry: raise(
              { type: 'FINISH' },
              {
                delay: ({ context, event }) =>
                  context.initialDelay + ('wait' in event ? event.wait : 0)
              }
            ),
            on: {
              FINISH: 'finished'
            }
          },
          finished: { type: 'final' }
        }
      });

      let stopped = false;

      const clock = new SimulatedClock();

      const delayExprService = (yield* createActor(delayExprMachine, {
        clock
      }));
      // the observer-object `subscribe` is not ported (D6, DEV-3): the `changes` stream ends
      // when the actor is done, so the end of the stream stands for the observer's `complete`
      yield* delayExprService.changes.pipe(
        Stream.runDrain,
        Effect.andThen(Effect.sync(() => {
          stopped = true;
        })),
        Effect.forkScoped({ startImmediately: true })
      );
      (yield* delayExprService.start);

      (yield* delayExprService.send({
        type: 'ACTIVATE',
        wait: 50
      }));

      yield* clock.increment(101);

      yield* settle;
      expect(stopped).toBe(false);

      yield* clock.increment(50);

      // the stream consumer runs in its own fiber: let it see the end of the stream
      yield* yieldUntil(() => stopped);
      expect(stopped).toBe(true);
    }));

    // upstream: test/interpreter.test.ts > interpreter > send with delay > can send an event after a delay (expression using _event)
    it.effect('can send an event after a delay (expression using _event)', () => Effect.gen(function* () {
      interface DelayExprMachineCtx {
        initialDelay: number;
      }

      type DelayExpMachineEvents =
        | {
            type: 'ACTIVATE';
            wait: number;
          }
        | {
            type: 'FINISH';
          };

      const delayExprMachine = createMachine({
        types: {} as {
          context: DelayExprMachineCtx;
          events: DelayExpMachineEvents;
        },
        id: 'delayExpr',
        context: {
          initialDelay: 100
        },
        initial: 'idle',
        states: {
          idle: {
            on: {
              ACTIVATE: 'pending'
            }
          },
          pending: {
            entry: raise(
              { type: 'FINISH' },
              {
                delay: ({ context, event }) => {
                  // SD-3 (amended 2026-10-08): `assertEvent` is an Effect, which a delay
                  // function (it gives a number) cannot run. Only ACTIVATE enters `pending`,
                  // so a type test narrows the event as the assertion did.
                  return context.initialDelay + (event.type === 'ACTIVATE' ? event.wait : 0);
                }
              }
            ),
            on: {
              FINISH: 'finished'
            }
          },
          finished: {
            type: 'final'
          }
        }
      });

      let stopped = false;

      const clock = new SimulatedClock();

      const delayExprService = (yield* createActor(delayExprMachine, {
        clock
      }));
      // the end of the `changes` stream stands for the observer's `complete` (D6, DEV-3)
      yield* delayExprService.changes.pipe(
        Stream.runDrain,
        Effect.andThen(Effect.sync(() => {
          stopped = true;
        })),
        Effect.forkScoped({ startImmediately: true })
      );
      (yield* delayExprService.start);

      (yield* delayExprService.send({
        type: 'ACTIVATE',
        wait: 50
      }));

      yield* clock.increment(101);

      yield* settle;
      expect(stopped).toBe(false);

      yield* clock.increment(50);

      // the stream consumer runs in its own fiber: let it see the end of the stream
      yield* yieldUntil(() => stopped);
      expect(stopped).toBe(true);
    }));

    // upstream: test/interpreter.test.ts > interpreter > send with delay > can send an event after a delay (delayed transitions)
    it.effect('can send an event after a delay (delayed transitions)', () => Effect.gen(function* () {
      const clock = new SimulatedClock();
      const letterMachine = createMachine(
        {
          types: {} as {
            events: { type: 'FIRE_DELAY'; value: number };
          },
          id: 'letter',
          context: {
            delay: 100
          },
          initial: 'a',
          states: {
            a: {
              after: {
                delayA: 'b'
              }
            },
            b: {
              after: {
                someDelay: 'c'
              }
            },
            c: {
              entry: raise({ type: 'FIRE_DELAY', value: 200 }, { delay: 20 }),
              on: {
                FIRE_DELAY: 'd'
              }
            },
            d: {
              after: {
                delayD: 'e'
              }
            },
            e: {
              after: { someDelay: 'f' }
            },
            f: {
              type: 'final'
            }
          }
        },
        {
          delays: {
            someDelay: ({ context }) => {
              return context.delay + 50;
            },
            delayA: ({ context }) => context.delay,
            delayD: ({ context, event }) => context.delay + event.value
          }
        }
      );

      const actor = (yield* createActor(letterMachine, { clock }));
      // the observer's `complete` resolves the promise upstream returns (see `onComplete`)
      const completed = yield* onComplete(actor);
      (yield* actor.start);

      expect((yield* actor.getSnapshot).value).toEqual('a');
      yield* clock.increment(100);
      expect((yield* actor.getSnapshot).value).toEqual('b');
      yield* clock.increment(100 + 50);
      expect((yield* actor.getSnapshot).value).toEqual('c');
      yield* clock.increment(20);
      expect((yield* actor.getSnapshot).value).toEqual('d');
      yield* clock.increment(100 + 200);
      expect((yield* actor.getSnapshot).value).toEqual('e');
      yield* clock.increment(100 + 50);

      yield* Deferred.await(completed);
    }));
  });

  describe('activities (deprecated)', () => {
    // upstream: test/interpreter.test.ts > interpreter > activities (deprecated) > should start activities
    it.effect('should start activities', () => Effect.gen(function* () {
      const spy = vi.fn();

      const activityMachine = createMachine(
        {
          id: 'activity',
          initial: 'on',
          states: {
            on: {
              invoke: {
                src: 'myActivity'
              },
              on: {
                TURN_OFF: 'off'
              }
            },
            off: {}
          }
        },
        {
          actors: {
            myActivity: fromCallback(spy)
          }
        }
      );
      const service = (yield* createActor(activityMachine));

      (yield* service.start);

      // the invoked callback logic starts in its own fiber
      yield* yieldUntil(() => spy.mock.calls.length > 0);
      expect(spy).toHaveBeenCalled();
    }));

    // upstream: test/interpreter.test.ts > interpreter > activities (deprecated) > should stop activities
    it.effect('should stop activities', () => Effect.gen(function* () {
      const spy = vi.fn();

      const activityMachine = createMachine(
        {
          id: 'activity',
          initial: 'on',
          states: {
            on: {
              invoke: {
                src: 'myActivity'
              },
              on: {
                TURN_OFF: 'off'
              }
            },
            off: {}
          }
        },
        {
          actors: {
            myActivity: fromCallback(() => spy)
          }
        }
      );
      const service = (yield* createActor(activityMachine));

      (yield* service.start);

      yield* settle;
      expect(spy).not.toHaveBeenCalled();

      (yield* service.send({ type: 'TURN_OFF' }));

      // the cleanup of the invoked callback logic runs when the child's scope closes
      yield* yieldUntil(() => spy.mock.calls.length > 0);
      expect(spy).toHaveBeenCalled();
    }));

    // upstream: test/interpreter.test.ts > interpreter > activities (deprecated) > should stop activities upon stopping the service
    it.effect('should stop activities upon stopping the service', () => Effect.gen(function* () {
      const spy = vi.fn();

      const stopActivityMachine = createMachine(
        {
          id: 'stopActivity',
          initial: 'on',
          states: {
            on: {
              invoke: {
                src: 'myActivity'
              },
              on: {
                TURN_OFF: 'off'
              }
            },
            off: {}
          }
        },
        {
          actors: {
            myActivity: fromCallback(() => spy)
          }
        }
      );

      const stopActivityService = (yield* Effect.tap(createActor(stopActivityMachine), (a) => a.start));

      yield* settle;
      expect(spy).not.toHaveBeenCalled();

      (yield* stopActivityService.stop);

      // the cleanup of the invoked callback logic runs when the child's scope closes
      yield* yieldUntil(() => spy.mock.calls.length > 0);
      expect(spy).toHaveBeenCalled();
    }));

    // upstream: test/interpreter.test.ts > interpreter > activities (deprecated) > should restart activities from a compound state
    it.effect('should restart activities from a compound state', () => Effect.gen(function* () {
      let activityActive = false;

      const machine = createMachine(
        {
          initial: 'inactive',
          states: {
            inactive: {
              on: { TOGGLE: 'active' }
            },
            active: {
              invoke: { src: 'blink' },
              on: { TOGGLE: 'inactive' },
              initial: 'A',
              states: {
                A: { on: { SWITCH: 'B' } },
                B: { on: { SWITCH: 'A' } }
              }
            }
          }
        },
        {
          actors: {
            blink: fromCallback(() => {
              activityActive = true;
              return () => {
                activityActive = false;
              };
            })
          }
        }
      );

      const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
      (yield* actorRef.send({ type: 'TOGGLE' }));
      (yield* actorRef.send({ type: 'SWITCH' }));
      const bState = (yield* actorRef.getPersistedSnapshot);
      (yield* actorRef.stop);
      // let the first actor's invoked logic finish its cleanup before the flag is reset
      yield* settle;
      activityActive = false;

      (yield* Effect.tap(createActor(machine, { snapshot: bState }), (a) => a.start));

      // the restored actor's invoked callback logic starts in its own fiber
      yield* yieldUntil(() => activityActive);
      expect(activityActive).toBeTruthy();
    }));
  });

  // upstream: test/interpreter.test.ts > interpreter > can cancel a delayed event
  it.effect('can cancel a delayed event', () => Effect.gen(function* () {
    const service = (yield* createActor(lightMachine, {
      clock: new SimulatedClock()
    }));
    const clock = service.clock as SimulatedClock;
    (yield* service.start);

    yield* clock.increment(5);
    (yield* service.send({ type: 'KEEP_GOING' }));

    expect((yield* service.getSnapshot).value).toEqual('green');
    yield* clock.increment(10);
    expect((yield* service.getSnapshot).value).toEqual('green');
  }));

  // upstream: test/interpreter.test.ts > interpreter > can cancel a delayed event using expression to resolve send id
  it.effect('can cancel a delayed event using expression to resolve send id', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'first',
      states: {
        first: {
          entry: [
            raise(
              { type: 'FOO' },
              {
                id: 'foo',
                delay: 100
              }
            ),
            raise(
              { type: 'BAR' },
              {
                delay: 200
              }
            ),
            cancel(() => 'foo')
          ],
          on: {
            FOO: 'fail',
            BAR: 'pass'
          }
        },
        fail: {
          type: 'final'
        },
        pass: {
          type: 'final'
        }
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

    // the observer's `complete` resolves the promise upstream returns (see `onComplete`)
    const completed = yield* onComplete(service);
    // upstream lets the host timers run; the actor's default clock is the Effect clock, so
    // the Effect form advances the test clock past both delays
    yield* TestClock.adjust("200 millis");
    yield* Deferred.await(completed);

    // the body of the observer's `complete` callback
    expect((yield* service.getSnapshot).value).toBe('pass');
  }));

  // upstream: test/interpreter.test.ts > interpreter > should not throw an error if an event is sent to an uninitialized interpreter
  it.effect('should not throw an error if an event is sent to an uninitialized interpreter', () => Effect.gen(function* () {
    const actorRef = (yield* createActor(lightMachine));

    // `send` is not a synchronous throw site (SD-3): "does not throw" is a send Effect that
    // succeeds; the event is queued until `start` (SD-23)
    const exit = yield* Effect.exit(actorRef.send({ type: 'SOME_EVENT' }));
    expect(Exit.isSuccess(exit)).toBe(true);
  }));

  // upstream: test/interpreter.test.ts > interpreter > should defer events sent to an uninitialized service
  it.effect('should defer events sent to an uninitialized service', () => Effect.gen(function* () {
    const deferMachine = createMachine({
      id: 'defer',
      initial: 'a',
      states: {
        a: {
          on: { NEXT_A: 'b' }
        },
        b: {
          on: { NEXT_B: 'c' }
        },
        c: {
          type: 'final'
        }
      }
    });

    let state: any;
    const deferService = (yield* createActor(deferMachine));

    // upstream subscribes one observer object: here `next` is a subscriber, which receives
    // nothing at subscription time (SD-24), and `complete` is the end of the `changes`
    // stream (see `onComplete`)
    yield* deferService.subscribe((nextState) => Effect.sync(() => {
      state = nextState;
    }));
    const completed = yield* onComplete(deferService);

    // uninitialized
    (yield* deferService.send({ type: 'NEXT_A' }));
    (yield* deferService.send({ type: 'NEXT_B' }));

    yield* settle;
    expect(state).not.toBeDefined();

    // initialized
    (yield* deferService.start);
    yield* Deferred.await(completed);
  }));

  // upstream: test/interpreter.test.ts > interpreter > should throw an error if initial state sent to interpreter is invalid
  it.effect('should throw an error if initial state sent to interpreter is invalid', () => Effect.gen(function* () {
    const invalidMachine = {
      id: 'fetchMachine',
      initial: 'create',
      states: {
        edit: {
          initial: 'idle',
          states: {
            idle: {
              on: {
                FETCH: 'pending'
              }
            },
            pending: {}
          }
        }
      }
    };

    const snapshot = (yield* (yield* createActor(createMachine(invalidMachine))).getSnapshot);

    expect(snapshot.status).toBe('error');
    // `snapshot.error` is an Option (D8): the inline snapshot reads the error it holds
    expect(Option.getOrUndefined(snapshot.error)).toMatchInlineSnapshot(
      `[Error: Initial state node "create" not found on parent state node #fetchMachine]`
    );
  }));

  // upstream: test/interpreter.test.ts > interpreter > should not update when stopped
  it.effect('should not update when stopped', () => {
    // SD-21: the test logger, not a console spy, receives the warning
    const logged: Array<Logger.Options<unknown>> = [];
    return Effect.gen(function* () {
      const service = (yield* createActor(lightMachine, {
        clock: new SimulatedClock()
      }));

      (yield* service.start);
      (yield* service.send({ type: 'TIMER' })); // yellow
      expect((yield* service.getSnapshot).value).toEqual('yellow');

      (yield* service.stop);
      // upstream's `try`/`catch`: any failure or defect of the send Effect reaches the handler
      yield* service.send({ type: 'TIMER' }).pipe( // red if interpreter is not stopped
        Effect.catchCause(() => Effect.gen(function* () {
          expect((yield* service.getSnapshot).value).toEqual('yellow');
        }))
      );

      // the warning may be logged from the actor's fiber: let it run before the exact check
      yield* settle;
      expect(warnCalls(logged)).toMatchInlineSnapshot(`
        [
          [
            "Event "TIMER" was sent to stopped actor "x:0 (x:0)". This actor has already reached its final state, and will not transition.
        Event: {"type":"TIMER"}",
          ],
        ]
      `);
    }).pipe(Effect.provide(testLogger(logged)));
  });

  // upstream: test/interpreter.test.ts > interpreter > should be able to log (log action)
  it.effect('should be able to log (log action)', () => Effect.gen(function* () {
    const logs: any[] = [];

    const logMachine = createMachine({
      types: {} as { context: { count: number } },
      id: 'log',
      initial: 'x',
      context: { count: 0 },
      states: {
        x: {
          on: {
            LOG: {
              actions: [
                assign({ count: ({ context }) => context.count + 1 }),
                log(({ context }) => context)
              ]
            }
          }
        }
      }
    });

    const service = (yield* Effect.tap(createActor(logMachine, {
      logger: (msg) => logs.push(msg)
    }), (a) => a.start));

    (yield* service.send({ type: 'LOG' }));
    (yield* service.send({ type: 'LOG' }));

    expect(logs.length).toBe(2);
    expect(logs).toEqual([{ count: 1 }, { count: 2 }]);
  }));

  // upstream: test/interpreter.test.ts > interpreter > should receive correct event (log action)
  it.effect('should receive correct event (log action)', () => Effect.gen(function* () {
    const logs: any[] = [];
    const logAction = log(({ event }) => event.type);

    const parentMachine = createMachine({
      initial: 'foo',
      states: {
        foo: {
          on: {
            EXTERNAL_EVENT: {
              actions: [raise({ type: 'RAISED_EVENT' }), logAction]
            }
          }
        }
      },
      on: {
        '*': {
          actions: [logAction]
        }
      }
    });

    const service = (yield* Effect.tap(createActor(parentMachine, {
      logger: (msg) => logs.push(msg)
    }), (a) => a.start));

    (yield* service.send({ type: 'EXTERNAL_EVENT' }));

    expect(logs.length).toBe(2);
    expect(logs).toEqual(['EXTERNAL_EVENT', 'RAISED_EVENT']);
  }));

  describe('send() event expressions', () => {
    interface Ctx {
      password: string;
    }
    interface Events {
      type: 'NEXT';
      password: string;
    }
    const machine = createMachine({
      types: {} as { context: Ctx; events: Events },
      id: 'sendexpr',
      initial: 'start',
      context: {
        password: 'foo'
      },
      states: {
        start: {
          entry: raise(({ context }) => ({
            type: 'NEXT' as const,
            password: context.password
          })),
          on: {
            NEXT: {
              target: 'finish',
              guard: ({ event }) => event.password === 'foo'
            }
          }
        },
        finish: {
          type: 'final'
        }
      }
    });

    // upstream: test/interpreter.test.ts > interpreter > send() event expressions > should resolve send event expressions
    it.effect('should resolve send event expressions', () => Effect.gen(function* () {
      const actor = (yield* createActor(machine));
      // the observer's `complete` resolves the promise upstream returns (see `onComplete`)
      const completed = yield* onComplete(actor);
      (yield* actor.start);
      yield* Deferred.await(completed);
    }));
  });

  describe('sendParent() event expressions', () => {
    // upstream: test/interpreter.test.ts > interpreter > sendParent() event expressions > should resolve sendParent event expressions
    it.effect('should resolve sendParent event expressions', () => Effect.gen(function* () {
      const childMachine = createMachine({
        types: {} as {
          context: { password: string };
          input: { password: string };
        },
        id: 'child',
        initial: 'start',
        context: ({ input }) => ({
          password: input.password
        }),
        states: {
          start: {
            entry: sendParent(({ context }) => {
              return { type: 'NEXT', password: context.password };
            })
          }
        }
      });

      const parentMachine = createMachine({
        types: {} as {
          events: {
            type: 'NEXT';
            password: string;
          };
        },
        id: 'parent',
        initial: 'start',
        states: {
          start: {
            invoke: {
              id: 'child',
              src: childMachine,
              input: { password: 'foo' }
            },
            on: {
              NEXT: {
                target: 'finish',
                guard: ({ event }) => event.password === 'foo'
              }
            }
          },
          finish: {
            type: 'final'
          }
        }
      });

      const actor = (yield* createActor(parentMachine));
      // upstream subscribes one observer object. Here `next` is a subscriber that records each
      // snapshot (nothing at subscription time, SD-24); the test fiber runs the `next` body on
      // them, because a throw inside a subscriber is only reported through the logger (SD-21)
      // and would not fail the test. `complete` is the end of the `changes` stream.
      const next = (state: SnapshotFrom<typeof parentMachine>) => {
        if (state.matches('start')) {
          const childActor = state.children.child;

          expect(typeof childActor!.send).toBe('function');
        }
      };
      const received: Array<SnapshotFrom<typeof parentMachine>> = [];
      yield* actor.subscribe((state) => Effect.sync(() => {
        received.push(state);
      }));
      const completed = yield* onComplete(actor);
      (yield* actor.start);
      yield* Deferred.await(completed);
      // let the subscriber take the last snapshot, then run the `next` body on each one
      yield* settle;
      received.forEach(next);
    }));
  });

  describe('.send()', () => {
    const sendMachine = createMachine({
      id: 'send',
      initial: 'inactive',
      states: {
        inactive: {
          on: {
            EVENT: {
              target: 'active',
              guard: ({ event }) => event.id === 42 // TODO: fix unknown event type
            },
            ACTIVATE: 'active'
          }
        },
        active: {
          type: 'final'
        }
      }
    });

    // upstream: test/interpreter.test.ts > interpreter > .send() > can send events with a string
    it.effect('can send events with a string', () => Effect.gen(function* () {
      const service = (yield* createActor(sendMachine));
      // the observer's `complete` resolves the promise upstream returns (see `onComplete`)
      const completed = yield* onComplete(service);
      (yield* service.start);

      (yield* service.send({ type: 'ACTIVATE' }));
      yield* Deferred.await(completed);
    }));

    // upstream: test/interpreter.test.ts > interpreter > .send() > can send events with an object
    it.effect('can send events with an object', () => Effect.gen(function* () {
      const service = (yield* createActor(sendMachine));
      // the observer's `complete` resolves the promise upstream returns (see `onComplete`)
      const completed = yield* onComplete(service);
      (yield* service.start);

      (yield* service.send({ type: 'ACTIVATE' }));
      yield* Deferred.await(completed);
    }));

    // upstream: test/interpreter.test.ts > interpreter > .send() > can send events with an object with payload
    it.effect('can send events with an object with payload', () => Effect.gen(function* () {
      const service = (yield* createActor(sendMachine));
      // the observer's `complete` resolves the promise upstream returns (see `onComplete`)
      const completed = yield* onComplete(service);
      (yield* service.start);

      (yield* service.send({ type: 'EVENT', id: 42 }));
      yield* Deferred.await(completed);
    }));

    // upstream: test/interpreter.test.ts > interpreter > .send() > should receive and process all events sent simultaneously
    it.effect('should receive and process all events sent simultaneously', () => Effect.gen(function* () {
      const toggleMachine = createMachine({
        id: 'toggle',
        initial: 'inactive',
        states: {
          fail: {},
          inactive: {
            on: {
              INACTIVATE: 'fail',
              ACTIVATE: 'active'
            }
          },
          active: {
            on: {
              INACTIVATE: 'success'
            }
          },
          success: {
            type: 'final'
          }
        }
      });

      const toggleService = (yield* createActor(toggleMachine));
      // the observer's `complete` resolves the promise upstream returns (see `onComplete`)
      const completed = yield* onComplete(toggleService);
      (yield* toggleService.start);

      (yield* toggleService.send({ type: 'ACTIVATE' }));
      (yield* toggleService.send({ type: 'INACTIVATE' }));
      yield* Deferred.await(completed);
    }));
  });

  describe('.start()', () => {
    // upstream: test/interpreter.test.ts > interpreter > .start() > should initialize the service
    it.effect('should initialize the service', () => Effect.gen(function* () {
      const contextSpy = vi.fn();
      const entrySpy = vi.fn();

      const machine = createMachine({
        context: contextSpy,
        entry: entrySpy,
        initial: 'foo',
        states: {
          foo: {}
        }
      });
      const actor = (yield* createActor(machine));
      (yield* actor.start);

      expect(contextSpy).toHaveBeenCalled();
      expect(entrySpy).toHaveBeenCalled();
      expect((yield* actor.getSnapshot)).toBeDefined();
      expect((yield* actor.getSnapshot).matches('foo')).toBeTruthy();
    }));

    // upstream: test/interpreter.test.ts > interpreter > .start() > should not reinitialize a started service
    it.effect('should not reinitialize a started service', () => Effect.gen(function* () {
      const contextSpy = vi.fn();
      const entrySpy = vi.fn();

      const machine = createMachine({
        context: contextSpy,
        entry: entrySpy
      });
      const actor = (yield* createActor(machine));
      (yield* actor.start);
      (yield* actor.start);

      expect(contextSpy).toHaveBeenCalledTimes(1);
      expect(entrySpy).toHaveBeenCalledTimes(1);
    }));

    // upstream: test/interpreter.test.ts > interpreter > .start() > should be able to be initialized at a custom state
    it.effect('should be able to be initialized at a custom state', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'foo',
        states: {
          foo: {},
          bar: {}
        }
      });
      const actor = (yield* createActor(machine, {
        snapshot: (yield* machine.resolveState({ value: 'bar' }))
      }));

      expect((yield* actor.getSnapshot).matches('bar')).toBeTruthy();
      (yield* actor.start);
      expect((yield* actor.getSnapshot).matches('bar')).toBeTruthy();
    }));

    // upstream: test/interpreter.test.ts > interpreter > .start() > should be able to be initialized at a custom state value
    it.effect('should be able to be initialized at a custom state value', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'foo',
        states: {
          foo: {},
          bar: {}
        }
      });
      const actor = (yield* createActor(machine, {
        snapshot: (yield* machine.resolveState({ value: 'bar' }))
      }));

      expect((yield* actor.getSnapshot).matches('bar')).toBeTruthy();
      (yield* actor.start);
      expect((yield* actor.getSnapshot).matches('bar')).toBeTruthy();
    }));

    // upstream: test/interpreter.test.ts > interpreter > .start() > should be able to resolve a custom initialized state
    it.effect('should be able to resolve a custom initialized state', () => Effect.gen(function* () {
      const machine = createMachine({
        id: 'start',
        initial: 'foo',
        states: {
          foo: {
            initial: 'one',
            states: {
              one: {}
            }
          },
          bar: {}
        }
      });
      const actor = (yield* createActor(machine, {
        snapshot: (yield* machine.resolveState({ value: 'foo' }))
      }));

      expect((yield* actor.getSnapshot).matches({ foo: 'one' })).toBeTruthy();
      (yield* actor.start);
      expect((yield* actor.getSnapshot).matches({ foo: 'one' })).toBeTruthy();
    }));
  });

  describe('.stop()', () => {
    // upstream: test/interpreter.test.ts > interpreter > .stop() > should cancel delayed events
    it.effect('should cancel delayed events', () => Effect.gen(function* () {
      let called = false;
      const delayedMachine = createMachine({
        id: 'delayed',
        initial: 'foo',
        states: {
          foo: {
            after: {
              50: {
                target: 'bar',
                actions: () => {
                  called = true;
                }
              }
            }
          },
          bar: {}
        }
      });

      const delayedService = (yield* Effect.tap(createActor(delayedMachine), (a) => a.start));

      (yield* delayedService.stop);

      // upstream checks from a 60 ms `setTimeout`; the actor's default clock is the Effect
      // clock, so the Effect form advances the test clock past the 50 ms delay
      yield* TestClock.adjust("60 millis");
      expect(called).toBe(false);
    }));

    // upstream: test/interpreter.test.ts > interpreter > .stop() > should not execute transitions after being stopped
    it.effect('should not execute transitions after being stopped', () => {
      // SD-21: the test logger, not a console spy, receives the warning
      const logged: Array<Logger.Options<unknown>> = [];
      return Effect.gen(function* () {
        let called = false;

        const testMachine = createMachine({
          initial: 'waiting',
          states: {
            waiting: {
              on: {
                TRIGGER: 'active'
              }
            },
            active: {
              entry: () => {
                called = true;
              }
            }
          }
        });

        const service = (yield* Effect.tap(createActor(testMachine), (a) => a.start));

        (yield* service.stop);

        (yield* service.send({ type: 'TRIGGER' }));

        // upstream checks from a 10 ms `setTimeout`; the Effect form advances the test clock
        // and lets every enqueued delivery run
        yield* TestClock.adjust("10 millis");
        yield* settle;
        expect(called).toBeFalsy();
        expect(warnCalls(logged)).toMatchInlineSnapshot(`
          [
            [
              "Event "TRIGGER" was sent to stopped actor "x:0 (x:0)". This actor has already reached its final state, and will not transition.
          Event: {"type":"TRIGGER"}",
            ],
          ]
        `);
      }).pipe(Effect.provide(testLogger(logged)));
    });

    // upstream: test/interpreter.test.ts > interpreter > .stop() > should not throw when sending an unserializable event to a stopped actor
    it.effect('should not throw when sending an unserializable event to a stopped actor', () => {
      // SD-21: the test logger, not a silenced console spy, receives the warning
      const logged: Array<Logger.Options<unknown>> = [];
      return Effect.gen(function* () {
        const testMachine = createMachine({
          initial: 'waiting',
          states: {
            waiting: {
              on: {
                TRIGGER: 'active'
              }
            },
            active: {}
          }
        });

        const service = (yield* Effect.tap(createActor(testMachine), (a) => a.start));

        (yield* service.stop);

        // event with a circular reference cannot be JSON.stringify'd
        const circular: any = { type: 'TRIGGER' };
        circular.self = circular;

        // `send` is not a synchronous throw site (SD-3): "does not throw" is a send Effect
        // that succeeds
        const exit = yield* Effect.exit(service.send(circular));
        expect(Exit.isSuccess(exit)).toBe(true);

        // as `toHaveBeenCalledTimes(1)` on the `console.warn` spy
        yield* settle;
        expect(warnCalls(logged)).toHaveLength(1);
      }).pipe(Effect.provide(testLogger(logged)));
    });

    // upstream: test/interpreter.test.ts > interpreter > .stop() > stopping a not-started interpreter should not crash
    it.effect('stopping a not-started interpreter should not crash', () => Effect.gen(function* () {
      const service = (yield* createActor(
        createMachine({
          initial: 'a',
          states: { a: {} }
        })
      ));

      // `stop` is not a synchronous throw site (SD-3): "does not throw" is a stop Effect that
      // succeeds
      const exit = yield* Effect.exit(service.stop);
      expect(Exit.isSuccess(exit)).toBe(true);
    }));
  });

  describe('.unsubscribe()', () => {
    // upstream: test/interpreter.test.ts > interpreter > .unsubscribe() > should remove transition listeners
    it.effect('should remove transition listeners', () => Effect.gen(function* () {
      const toggleMachine = createMachine({
        id: 'toggle',
        initial: 'inactive',
        states: {
          inactive: {
            on: { TOGGLE: 'active' }
          },
          active: {
            on: { TOGGLE: 'inactive' }
          }
        }
      });

      const toggleService = (yield* Effect.tap(createActor(toggleMachine), (a) => a.start));

      let stateCount = 0;

      const listener = () => stateCount++;

      // there is no `Subscription` object (D6, DEV-4): the subscription runs in its own
      // scope, and closing that scope stands for `sub.unsubscribe()`
      const sub = yield* Scope.make();
      yield* toggleService.subscribe(() => Effect.sync(listener)).pipe(Scope.provide(sub));

      yield* settle;
      expect(stateCount).toEqual(0);

      (yield* toggleService.send({ type: 'TOGGLE' }));

      // the subscriber runs in its own fiber: let it take the snapshot before the exact count
      yield* settle;
      expect(stateCount).toEqual(1);

      (yield* toggleService.send({ type: 'TOGGLE' }));

      yield* settle;
      expect(stateCount).toEqual(2);

      yield* Scope.close(sub, Exit.void);
      (yield* toggleService.send({ type: 'TOGGLE' }));

      yield* settle;
      expect(stateCount).toEqual(2);
    }));
  });

  describe('transient states', () => {
    // upstream: test/interpreter.test.ts > interpreter > transient states > should transition in correct order
    it.effect('should transition in correct order', () => Effect.gen(function* () {
      const stateMachine = createMachine({
        id: 'transient',
        initial: 'idle',
        states: {
          idle: { on: { START: 'transient' } },
          transient: { always: 'next' },
          next: { on: { FINISH: 'end' } },
          end: { type: 'final' }
        }
      });

      const stateValues: StateValue[] = [];
      const service = (yield* createActor(stateMachine));
      yield* service.subscribe((current) => Effect.sync(() => {
        stateValues.push(current.value);
      }));
      (yield* service.start);
      (yield* service.send({ type: 'START' }));

      // the subscriber runs in its own fiber: let it take every snapshot before the exact count
      yield* settle;
      const expectedStateValues = ['idle', 'next'];
      expect(stateValues.length).toEqual(expectedStateValues.length);
      for (let i = 0; i < expectedStateValues.length; i++) {
        expect(stateValues[i]).toEqual(expectedStateValues[i]);
      }
    }));

    // upstream: test/interpreter.test.ts > interpreter > transient states > should transition in correct order when there is a condition
    it.effect('should transition in correct order when there is a condition', () => Effect.gen(function* () {
      const stateMachine = createMachine(
        {
          id: 'transient',
          initial: 'idle',
          states: {
            idle: { on: { START: 'transient' } },
            transient: {
              always: [
                { target: 'end', guard: 'alwaysFalse' },
                { target: 'next' }
              ]
            },
            next: { on: { FINISH: 'end' } },
            end: { type: 'final' }
          }
        },
        {
          guards: {
            alwaysFalse: () => false
          }
        }
      );

      const stateValues: StateValue[] = [];
      const service = (yield* createActor(stateMachine));
      yield* service.subscribe((current) => Effect.sync(() => {
        stateValues.push(current.value);
      }));
      (yield* service.start);
      (yield* service.send({ type: 'START' }));

      // the subscriber runs in its own fiber: let it take every snapshot before the exact count
      yield* settle;
      const expectedStateValues = ['idle', 'next'];
      expect(stateValues.length).toEqual(expectedStateValues.length);
      for (let i = 0; i < expectedStateValues.length; i++) {
        expect(stateValues[i]).toEqual(expectedStateValues[i]);
      }
    }));
  });

  describe('observable', () => {
    const context = { count: 0 };
    const intervalMachine = createMachine({
      id: 'interval',
      types: {} as { context: typeof context },
      context,
      initial: 'active',
      states: {
        active: {
          after: {
            10: {
              target: 'active',
              reenter: true,
              actions: assign({
                count: ({ context }) => context.count + 1
              })
            }
          },
          always: {
            target: 'finished',
            guard: ({ context }) => context.count >= 5
          }
        },
        finished: {
          type: 'final'
        }
      }
    });

    // upstream: test/interpreter.test.ts > interpreter > observable > should be subscribable
    it.effect('should be subscribable', () => Effect.gen(function* () {
      let count: number;
      const intervalService = (yield* Effect.tap(createActor(intervalMachine), (a) => a.start));

      expect(typeof intervalService.subscribe === 'function').toBeTruthy();

      // upstream passes three callbacks (D6, DEV-3): the first is a subscriber; the third,
      // `complete`, is the end of the `changes` stream (see `onComplete`)
      yield* intervalService.subscribe((state) => Effect.sync(() => {
        count = state.context.count;
      }));
      const completed = yield* onComplete(intervalService);
      // the `after: { 10 }` timer runs on the Effect clock: the test clock advances in 10 ms
      // steps, as the host timer does upstream, until the actor is done
      yield* Deferred.await(completed).pipe(
        Effect.raceFirst(Effect.forever(TestClock.adjust("10 millis")))
      );

      // the body of the `complete` callback; the subscriber runs in its own fiber, so let it
      // take the last snapshot first
      yield* settle;
      expect(count!).toEqual(5);
    }));

    // NOT PORTED: test/interpreter.test.ts > interpreter > observable > should be
    // interoperable with RxJS, etc. via Symbol.observable. rxjs `from(actor)` reads
    // `actor[Symbol.observable]` and subscribes an observer object; the port has no
    // XState-compatible facade and no observer-object `subscribe` (D6, DEV-3). See the
    // "Tests not ported" table of CONFORMANCE.md.

    // upstream: test/interpreter.test.ts > interpreter > observable > should be unsubscribable
    it.effect('should be unsubscribable', () => Effect.gen(function* () {
      const countContext = { count: 0 };
      const machine = createMachine({
        types: {} as { context: typeof countContext },
        context: countContext,
        initial: 'active',
        states: {
          active: {
            always: {
              target: 'finished',
              guard: ({ context }) => context.count >= 5
            },
            on: {
              INC: {
                actions: assign({ count: ({ context }) => context.count + 1 })
              }
            }
          },
          finished: {
            type: 'final'
          }
        }
      });

      let count: number;
      const service = (yield* createActor(machine));
      // the observer's `complete` resolves the promise upstream returns (see `onComplete`)
      const completed = yield* onComplete(service);
      (yield* service.start);

      // there is no `Subscription` object (D6, DEV-4): the subscription runs in its own
      // scope, and closing that scope stands for `subscription.unsubscribe()`
      const subscription = yield* Scope.make();
      yield* service.subscribe(
        (state) => Effect.sync(() => (count = state.context.count))
      ).pipe(Scope.provide(subscription));

      (yield* service.send({ type: 'INC' }));
      (yield* service.send({ type: 'INC' }));
      // the subscriber runs in its own fiber: let it take both snapshots before it stops
      yield* settle;
      yield* Scope.close(subscription, Exit.void);
      (yield* service.send({ type: 'INC' }));
      (yield* service.send({ type: 'INC' }));
      (yield* service.send({ type: 'INC' }));
      yield* Deferred.await(completed);

      // the body of the observer's `complete` callback
      yield* settle;
      expect(count!).toEqual(2);
    }));

    // upstream: test/interpreter.test.ts > interpreter > observable > should call complete() once a final state is reached
    it.effect('should call complete() once a final state is reached', () => Effect.gen(function* () {
      const completeCb = vi.fn();

      const service = (yield* Effect.tap(createActor(
        createMachine({
          initial: 'idle',
          states: {
            idle: {
              on: {
                NEXT: 'done'
              }
            },
            done: { type: 'final' }
          }
        })
      ), (a) => a.start));

      // the observer-object `subscribe` is not ported (D6, DEV-3): the `changes` stream ends
      // when the actor is done, so the end of the stream stands for the observer's `complete`
      yield* service.changes.pipe(
        Stream.runDrain,
        Effect.andThen(Effect.sync(() => completeCb())),
        Effect.forkScoped({ startImmediately: true })
      );

      (yield* service.send({ type: 'NEXT' }));

      // the stream consumer runs in its own fiber: let it see the end of the stream
      yield* yieldUntil(() => completeCb.mock.calls.length > 0);
      yield* settle;
      expect(completeCb).toHaveBeenCalledTimes(1);
    }));

    // upstream: test/interpreter.test.ts > interpreter > observable > should call complete() once the interpreter is stopped
    it.effect('should call complete() once the interpreter is stopped', () => Effect.gen(function* () {
      const completeCb = vi.fn();

      const service = (yield* Effect.tap(createActor(createMachine({})), (a) => a.start));

      // the `changes` stream ends when the actor is stopped, so the end of the stream stands
      // for the observer's `complete` (D6, DEV-3)
      yield* service.changes.pipe(
        Stream.runDrain,
        Effect.andThen(Effect.sync(() => {
          completeCb();
        })),
        Effect.forkScoped({ startImmediately: true })
      );

      (yield* service.stop);

      // the stream consumer runs in its own fiber: let it see the end of the stream
      yield* yieldUntil(() => completeCb.mock.calls.length > 0);
      yield* settle;
      expect(completeCb).toHaveBeenCalledTimes(1);
    }));
  });

  describe('actors', () => {
    // upstream: test/interpreter.test.ts > interpreter > actors > doesn't crash cryptically on undefined return from the actor creator
    it.effect("doesn't crash cryptically on undefined return from the actor creator", () => Effect.gen(function* () {
      const child = fromCallback(() => {
        // nothing
      });
      const machine = createMachine(
        {
          types: {} as {
            actors: {
              src: 'testService';
              logic: typeof child;
            };
          },
          initial: 'initial',
          states: {
            initial: {
              invoke: {
                src: 'testService'
              }
            }
          }
        },
        {
          actors: {
            testService: child
          }
        }
      );

      const service = (yield* createActor(machine));
      // `start` is not a synchronous throw site (SD-3): "does not throw" is a start Effect
      // that succeeds
      const exit = yield* Effect.exit(service.start);
      expect(Exit.isSuccess(exit)).toBe(true);
    }));
  });

  describe('children', () => {
    // upstream: test/interpreter.test.ts > interpreter > children > state.children should reference invoked child actors (machine)
    it.effect('state.children should reference invoked child actors (machine)', () => Effect.gen(function* () {
      const childMachine = createMachine({
        initial: 'active',
        states: {
          active: {
            on: {
              FIRE: {
                actions: sendParent({ type: 'FIRED' })
              }
            }
          }
        }
      });
      const parentMachine = createMachine({
        initial: 'active',
        states: {
          active: {
            invoke: {
              id: 'childActor',
              src: childMachine
            },
            on: {
              FIRED: 'success'
            }
          },
          success: {
            type: 'final'
          }
        }
      });

      const actor = (yield* createActor(parentMachine));
      (yield* actor.start);
      (yield* (yield* actor.getSnapshot).children.childActor!.send({ type: 'FIRE' }));

      // the actor should be done by now (here: the child's `sendParent` enqueues without
      // waiting, SD-23, so yield, bounded, until the parent has taken `FIRED`)
      yield* yieldUntil(() =>
        Effect.map(actor.getSnapshot, (snapshot) => snapshot.status === 'done')
      );
      expect((yield* actor.getSnapshot).children).not.toHaveProperty('childActor');
    }));

    // upstream: test/interpreter.test.ts > interpreter > children > state.children should reference invoked child actors (promise)
    it.effect('state.children should reference invoked child actors (promise)', () => Effect.gen(function* () {
      // the promise executor's `setTimeout` runs on the Effect clock here (see `effectTimers`)
      const setEffectTimeout = yield* effectTimers;
      const parentMachine = createMachine(
        {
          initial: 'active',
          types: {} as {
            actors: {
              src: 'num';
              logic: PromiseActorLogic<number>;
            };
          },
          states: {
            active: {
              invoke: {
                id: 'childActor',
                src: 'num',
                onDone: [
                  {
                    target: 'success',
                    guard: ({ event }) => {
                      // `event.output` of `xstate.done.actor.*` is an Option (D8, DEV-7)
                      return Option.contains(event.output, 42);
                    }
                  },
                  { target: 'failure' }
                ]
              }
            },
            success: {
              type: 'final'
            },
            failure: {
              type: 'final'
            }
          }
        },
        {
          actors: {
            num: fromPromise(
              () =>
                new Promise<number>((res) => {
                  setEffectTimeout(() => {
                    res(42);
                  }, 100);
                })
            )
          }
        }
      );

      const service = (yield* createActor(parentMachine));

      // upstream subscribes one observer object. Here `next` is a subscriber that records each
      // snapshot (nothing at subscription time, SD-24); the test fiber runs the `next` body on
      // them, because a throw inside a subscriber is only reported through the logger (SD-21)
      // and would not fail the test. `complete` is the end of the `changes` stream.
      const next = (state: SnapshotFrom<typeof parentMachine>) => {
        if (state.matches('active')) {
          const childActor = state.children.childActor;

          expect(childActor).toHaveProperty('send');
        }
      };
      const received: Array<SnapshotFrom<typeof parentMachine>> = [];
      yield* service.subscribe((state) => Effect.sync(() => {
        received.push(state);
      }));
      const completed = yield* onComplete(service);

      (yield* service.start);
      // the 100 ms timer runs on the Effect clock: the test clock advances in 10 ms steps
      // until the parent is done
      yield* Deferred.await(completed).pipe(
        Effect.raceFirst(Effect.forever(TestClock.adjust("10 millis")))
      );

      // the `next` body on each snapshot the subscriber took, then the `complete` body
      yield* settle;
      received.forEach(next);
      expect((yield* service.getSnapshot).matches('success')).toBeTruthy();
      expect((yield* service.getSnapshot).children).not.toHaveProperty(
        'childActor'
      );
    }));

    // upstream: test/interpreter.test.ts > interpreter > children > state.children should reference invoked child actors (observable)
    it.effect('state.children should reference invoked child actors (observable)', () => Effect.gen(function* () {
      // the interval runs on virtual time (see `virtualTime`)
      const scheduler = new VirtualTimeScheduler();
      const advance = virtualTime(scheduler);
      const interval$ = interval(10, scheduler);
      const intervalLogic = fromObservable(() => interval$);

      const parentMachine = createMachine(
        {
          types: {} as {
            actors: {
              src: 'intervalLogic';
              logic: typeof intervalLogic;
            };
          },
          initial: 'active',
          states: {
            active: {
              invoke: {
                id: 'childActor',
                src: 'intervalLogic',
                onSnapshot: {
                  target: 'success',
                  guard: ({ event }) => {
                    // `snapshot.context` of observable logic is an `Option` (SD-17, DEV-19)
                    return Option.contains(event.snapshot.context, 3);
                  }
                }
              }
            },
            success: {
              type: 'final'
            }
          }
        },
        {
          actors: {
            intervalLogic
          }
        }
      );

      const service = (yield* createActor(parentMachine));
      // the observer's `complete` resolves the promise upstream returns (see `onComplete`)
      const completed = yield* onComplete(service);

      // the subscriber records each snapshot; the test fiber runs its body on them, because a
      // throw inside a subscriber is only reported through the logger (SD-21)
      const received: Array<SnapshotFrom<typeof parentMachine>> = [];
      yield* service.subscribe((state) => Effect.sync(() => {
        received.push(state);
      }));

      (yield* service.start);
      // the interval's virtual clock advances in 10 ms steps until the parent is done
      yield* Deferred.await(completed).pipe(
        Effect.raceFirst(Effect.forever(advance(10)))
      );

      // the body of the observer's `complete` callback
      expect((yield* service.getSnapshot).children).not.toHaveProperty(
        'childActor'
      );

      // the body of the subscriber, on each snapshot it took
      yield* settle;
      received.forEach((state) => {
        if (state.matches('active')) {
          expect(state.children['childActor']).not.toBeUndefined();
        }
      });
    }));

    // upstream: test/interpreter.test.ts > interpreter > children > state.children should reference spawned actors
    it.effect('state.children should reference spawned actors', () => Effect.gen(function* () {
      const childMachine = createMachine({
        initial: 'idle',
        states: {
          idle: {}
        }
      });
      const formMachine = createMachine({
        id: 'form',
        initial: 'idle',
        context: {},
        entry: assign({
          firstNameRef: ({ spawn }) => spawn(childMachine, { id: 'child' })
        }),
        states: {
          idle: {}
        }
      });

      const actor = (yield* createActor(formMachine));
      (yield* actor.start);
      expect((yield* actor.getSnapshot).children).toHaveProperty('child');
    }));

    // upstream: test/interpreter.test.ts > interpreter > children > stopped spawned actors should be cleaned up in parent
    it.effect('stopped spawned actors should be cleaned up in parent', () => Effect.gen(function* () {
      const childMachine = createMachine({
        initial: 'idle',
        states: {
          idle: {}
        }
      });

      const parentMachine = createMachine({
        id: 'form',
        initial: 'present',
        context: {} as {
          machineRef: ActorRefFrom<typeof childMachine>;
          promiseRef: ActorRefFrom<typeof fromPromise>;
          observableRef: AnyActorRef;
        },
        entry: assign({
          machineRef: ({ spawn }) =>
            spawn(childMachine, { id: 'machineChild' }),
          promiseRef: ({ spawn }) =>
            spawn(
              fromPromise(
                () =>
                  new Promise(() => {
                    // ...
                  })
              ),
              { id: 'promiseChild' }
            ),
          observableRef: ({ spawn }) =>
            spawn(
              fromObservable(() => interval(1000)),
              { id: 'observableChild' }
            )
        }),
        states: {
          present: {
            on: {
              NEXT: {
                target: 'gone',
                actions: [
                  stopChild(({ context }) => context.machineRef),
                  stopChild(({ context }) => context.promiseRef),
                  stopChild(({ context }) => context.observableRef)
                ]
              }
            }
          },
          gone: {
            type: 'final'
          }
        }
      });

      const service = (yield* Effect.tap(createActor(parentMachine), (a) => a.start));

      expect((yield* service.getSnapshot).children).toHaveProperty('machineChild');
      expect((yield* service.getSnapshot).children).toHaveProperty('promiseChild');
      expect((yield* service.getSnapshot).children).toHaveProperty('observableChild');

      (yield* service.send({ type: 'NEXT' }));

      expect((yield* service.getSnapshot).children.machineChild).toBeUndefined();
      expect((yield* service.getSnapshot).children.promiseChild).toBeUndefined();
      expect((yield* service.getSnapshot).children.observableChild).toBeUndefined();
    }));
  });

  // upstream: test/interpreter.test.ts > interpreter > shouldn't execute actions when reading a snapshot of not started actor
  it.effect("shouldn't execute actions when reading a snapshot of not started actor", () => Effect.gen(function* () {
    const spy = vi.fn();
    const actorRef = (yield* createActor(
      createMachine({
        entry: () => {
          spy();
        }
      })
    ));

    (yield* actorRef.getSnapshot);

    expect(spy).not.toHaveBeenCalled();
  }));

  // upstream: test/interpreter.test.ts > interpreter > should execute entry actions when starting the actor after reading its snapshot first
  it.effect(`should execute entry actions when starting the actor after reading its snapshot first`, () => Effect.gen(function* () {
    const spy = vi.fn();

    const actorRef = (yield* createActor(
      createMachine({
        entry: spy
      })
    ));

    (yield* actorRef.getSnapshot);
    expect(spy).not.toHaveBeenCalled();

    (yield* actorRef.start);

    expect(spy).toHaveBeenCalled();
  }));

  // upstream: test/interpreter.test.ts > interpreter > the first state of an actor should be its initial state
  it.effect('the first state of an actor should be its initial state', () => Effect.gen(function* () {
    const machine = createMachine({});
    const actor = (yield* createActor(machine));
    const initialState = (yield* actor.getSnapshot);

    (yield* actor.start);

    expect((yield* actor.getSnapshot)).toBe(initialState);
  }));

  // upstream: test/interpreter.test.ts > interpreter > should call an onDone callback immediately if the service is already done
  it.effect('should call an onDone callback immediately if the service is already done', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          type: 'final'
        }
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect((yield* service.getSnapshot).status).toBe('done');

    // the observer's `complete` resolves the promise upstream returns (see `onComplete`): the
    // `changes` stream of a done actor ends after its final snapshot (C16)
    const completed = yield* onComplete(service);
    yield* Deferred.await(completed);
  }));
});

// upstream: test/interpreter.test.ts > should throw if an event is received
it.effect('should throw if an event is received', () => Effect.gen(function* () {
  const machine = createMachine({});

  const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

  // `send` is not a synchronous throw site (SD-3): a string event is a defect of the send
  // Effect, so "throws" is a send Effect that dies
  const exit = yield* Effect.exit(
    actor.send(
      // @ts-ignore
      'EVENT'
    )
  );
  expect(Exit.hasDies(exit)).toBe(true);
}));

// upstream: test/interpreter.test.ts > should not process events sent directly to own actor ref before initial entry actions are processed
it.effect('should not process events sent directly to own actor ref before initial entry actions are processed', () => Effect.gen(function* () {
  const actual: string[] = [];
  const machine = createMachine({
    // `actorRef.send` is an Effect (D6): the inline action returns an Effect, and a send
    // made inside the actor's own processing enqueues without waiting (SD-23)
    entry: (): Effect.Effect<void> =>
      Effect.gen(function* () {
        actual.push('initial root entry start');
        yield* actorRef.send({
          type: 'EV'
        });
        actual.push('initial root entry end');
      }),
    on: {
      EV: {
        actions: () => {
          actual.push('EV transition');
        }
      }
    },
    initial: 'a',
    states: {
      a: {
        entry: () => {
          actual.push('initial nested entry');
        }
      }
    }
  });

  const actorRef = (yield* createActor(machine));
  (yield* actorRef.start);

  // `EV` waits in the actor's queue until the initial macrostep has committed
  yield* yieldUntil(() => actual.length >= 4);
  expect(actual).toEqual([
    'initial root entry start',
    'initial root entry end',
    'initial nested entry',
    'EV transition'
  ]);
}));

// upstream: test/interpreter.test.ts > should not notify the completion observer for an active logic when it gets subscribed before starting
it.effect('should not notify the completion observer for an active logic when it gets subscribed before starting', () => Effect.gen(function* () {
  const spy = vi.fn();

  const machine = createMachine({});
  // the observer-object `subscribe` is not ported (D6, DEV-3): the end of the `changes`
  // stream stands for the observer's `complete`
  yield* (yield* createActor(machine)).changes.pipe(
    Stream.runDrain,
    Effect.andThen(Effect.sync(() => spy())),
    Effect.forkScoped({ startImmediately: true })
  );

  yield* settle;
  expect(spy).not.toHaveBeenCalled();
}));

// upstream: test/interpreter.test.ts > should notify the error observer for an errored logic when it gets subscribed after it errors
it.effect('should notify the error observer for an errored logic when it gets subscribed after it errors', () => Effect.gen(function* () {
  const spy = vi.fn();

  const machine = createMachine({
    entry: () => {
      throw new Error('error');
    }
  });
  const actorRef = (yield* createActor(machine));
  // the observer-object `subscribe` is not ported (D6, DEV-3): the `changes` stream fails
  // with the actor error, so consuming it and ignoring its failure stands for the first
  // observer's empty `error` callback (it keeps the error from being reported, SD-21)
  yield* actorRef.changes.pipe(
    Stream.runDrain,
    Effect.ignore,
    Effect.forkScoped({ startImmediately: true })
  );
  (yield* actorRef.start);

  // the second observer's `error` callback, subscribed after the error: called with the
  // error the `changes` stream fails with (C16)
  yield* actorRef.changes.pipe(
    Stream.runDrain,
    Effect.catch((error) => Effect.sync(() => spy(error))),
    Effect.forkScoped({ startImmediately: true })
  );

  // the stream consumer runs in its own fiber: let it see the failure of the stream
  yield* yieldUntil(() => spy.mock.calls.length > 0);
  expect(spy.mock.calls).toMatchInlineSnapshot(`
    [
      [
        [Error: error],
      ],
    ]
  `);
}));
