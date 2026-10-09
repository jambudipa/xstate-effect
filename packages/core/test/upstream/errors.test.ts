import { describe, expect, it, vi } from "@effect/vitest"
import { Cause, Deferred, Effect, Fiber, Logger, Option, Stream } from "effect"
import { TestClock } from "effect/testing"
import {
  AnyEventObject,
  assign,
  createActor,
  createMachine,
  emit,
  fromCallback,
  fromPromise,
  fromTransition,
  setup
} from "../../src/index.js";

// Upstream runs under happy-dom and mocks `reportUnhandledError`
// (`vi.mock('../src/reportUnhandledError.ts')`) so that an unhandled error reaches a global
// `window` 'error' handler. The port never rethrows: a root actor with no parent and no error
// consumer, and a subscriber or `actor.on` listener that throws, report the error once through
// the actor's logger (`Effect.logError` by default, SD-21). This test logger replaces the module
// mock and the global handler; it keeps every log entry so a test can assert on the reports.
const testLogger = (entries: Array<Logger.Options<unknown>>) =>
  Logger.layer([
    Logger.make((options) => {
      entries.push(options);
    })
  ]);

// The values one log entry carries: its message parts, then the errors and defects of its cause.
const reportedValues = (entry: Logger.Options<unknown>): ReadonlyArray<unknown> => [
  ...(Array.isArray(entry.message) ? entry.message : [entry.message]),
  ...entry.cause.reasons.flatMap((reason) =>
    Cause.isDieReason(reason) ? [reason.defect] : Cause.isFailReason(reason) ? [reason.error] : []
  )
];

// The message of the error that each Error-level log entry reports, in report order: what
// upstream's global handler reads as `ev.error.message`.
const reportedMessages = (entries: ReadonlyArray<Logger.Options<unknown>>): ReadonlyArray<string> =>
  entries
    .filter((entry) => entry.logLevel === 'Error')
    .map((entry) => {
      const values = reportedValues(entry);
      const error = values.find((value) => value instanceof Error);
      return error instanceof Error ? error.message : String(values[0]);
    });

// Upstream observes an actor error with an observer-object `subscribe({ error })`, which is not
// ported (D6, DEV-3): the `changes` stream fails with the actor's error (SD-4) and ends when the
// actor is done or stopped. `onError` forks, before the next step runs, a fiber that drains the
// stream and hands its failure to `listener`. That consumer is the actor's error consumer, so the
// actor reports nothing through its logger (SD-21). Join the fiber to wait until the stream has
// failed or ended.
const onError = <E>(
  actor: { readonly changes: Stream.Stream<unknown, E> },
  listener: (error: E) => void
) =>
  actor.changes.pipe(
    Stream.runDrain,
    Effect.catch((error) => Effect.sync(() => listener(error))),
    Effect.forkScoped({ startImmediately: true })
  );

// Upstream awaits a promise that its global error handler resolves. Here the logic of a child
// runs in its own fiber (D12), the events it sends to its parent enqueue without waiting
// (SD-23), and the logger receives a report from the actor's fiber, so a test yields its fiber,
// at most 100 times and never on wall-clock time, until what it waits for has happened.
const yieldUntil = (done: () => boolean | Effect.Effect<boolean>) =>
  Effect.yieldNow.pipe(Effect.repeat({ until: done, times: 100 }));

// Before an assertion that something did NOT happen: upstream waits 10 ms of real time. Here the
// test clock moves 10 ms and every enqueued delivery gets the chance to run, so that the
// assertion is not vacuous.
const settle = Effect.andThen(TestClock.adjust("10 millis"), yieldUntil(() => false));

describe('error handling', () => {
  // https://github.com/statelyai/xstate/issues/4004
  // upstream: test/errors.test.ts > error handling > does not cause an infinite loop when an error is thrown in subscribe
  it.effect('does not cause an infinite loop when an error is thrown in subscribe', () => {
    const logged: Array<Logger.Options<unknown>> = [];
    return Effect.gen(function* () {
      const machine = createMachine({
        id: 'machine',
        initial: 'initial',
        context: {
          count: 0
        },
        states: {
          initial: {
            on: { activate: 'active' }
          },
          active: {}
        }
      });

      const spy = vi.fn().mockImplementation(() => {
        throw new Error('no_infinite_loop_when_error_is_thrown_in_subscribe');
      });

      const actor = yield* Effect.tap(createActor(machine), (a) => a.start);

      // the subscriber throws inside its Effect, as upstream's subscriber throws
      yield* actor.subscribe((snapshot) => Effect.sync(() => spy(snapshot)));
      yield* actor.send({ type: 'activate' });

      // upstream counts the calls at once and then awaits its global error handler; here the
      // test waits for the logger report first, so the count also shows that the throw caused
      // no further call
      yield* yieldUntil(() => reportedMessages(logged).length > 0);

      expect(spy).toHaveBeenCalledTimes(1);

      // SD-21: the test logger, not a global handler, receives the subscriber's error, once
      expect(reportedMessages(logged)).toEqual([
        'no_infinite_loop_when_error_is_thrown_in_subscribe'
      ]);
    }).pipe(Effect.provide(testLogger(logged)));
  });

  // upstream: test/errors.test.ts > error handling > doesn't crash the actor when an error is thrown in subscribe
  it.effect(`doesn't crash the actor when an error is thrown in subscribe`, () => {
    const logged: Array<Logger.Options<unknown>> = [];
    return Effect.gen(function* () {
      const spy = vi.fn();

      const machine = createMachine({
        id: 'machine',
        initial: 'initial',
        context: {
          count: 0
        },
        states: {
          initial: {
            on: { activate: 'active' }
          },
          active: {
            on: {
              do: {
                actions: spy
              }
            }
          }
        }
      });

      const subscriber = vi.fn().mockImplementationOnce(() => {
        throw new Error('doesnt_crash_actor_when_error_is_thrown_in_subscribe');
      });

      const actor = yield* Effect.tap(createActor(machine), (a) => a.start);

      // the subscriber throws inside its Effect, as upstream's subscriber throws
      yield* actor.subscribe((snapshot) => Effect.sync(() => subscriber(snapshot)));
      yield* actor.send({ type: 'activate' });

      // wait for the logger report (see the test above)
      yield* yieldUntil(() => reportedMessages(logged).length > 0);

      expect(subscriber).toHaveBeenCalledTimes(1);
      expect((yield* actor.getSnapshot).status).toEqual('active');

      // upstream's global error handler checks the error, then sends `do`; SD-21: the test
      // logger receives the subscriber's error, once
      expect(reportedMessages(logged)).toEqual([
        'doesnt_crash_actor_when_error_is_thrown_in_subscribe'
      ]);

      yield* actor.send({ type: 'do' });
      expect(spy).toHaveBeenCalledTimes(1);
    }).pipe(Effect.provide(testLogger(logged)));
  });

  // upstream: test/errors.test.ts > error handling > doesn't notify error listener when an error is thrown in subscribe
  it.effect(`doesn't notify error listener when an error is thrown in subscribe`, () => {
    const logged: Array<Logger.Options<unknown>> = [];
    return Effect.gen(function* () {
      const machine = createMachine({
        id: 'machine',
        initial: 'initial',
        context: {
          count: 0
        },
        states: {
          initial: {
            on: { activate: 'active' }
          },
          active: {}
        }
      });

      const nextSpy = vi.fn().mockImplementation(() => {
        throw new Error(
          'doesnt_notify_error_listener_when_error_is_thrown_in_subscribe'
        );
      });
      const errorSpy = vi.fn();

      const actor = yield* Effect.tap(createActor(machine), (a) => a.start);

      // upstream subscribes one observer object with `next` and `error`: here `next` is a
      // subscriber and `error` receives the failure of the `changes` stream
      yield* actor.subscribe((snapshot) => Effect.sync(() => nextSpy(snapshot)));
      yield* onError(actor, errorSpy);
      yield* actor.send({ type: 'activate' });

      // wait for the logger report (see the first test), then let the `changes` consumer run
      // so that the `errorSpy` count is not vacuous
      yield* yieldUntil(() => reportedMessages(logged).length > 0);
      yield* settle;

      expect(nextSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(0);

      // SD-21: a listener error is reported although the actor has an error consumer
      expect(reportedMessages(logged)).toEqual([
        'doesnt_notify_error_listener_when_error_is_thrown_in_subscribe'
      ]);
    }).pipe(Effect.provide(testLogger(logged)));
  });

  // upstream: test/errors.test.ts > error handling > unhandled sync errors thrown when starting a child actor should be reported globally
  it.effect('unhandled sync errors thrown when starting a child actor should be reported globally', () => {
    const logged: Array<Logger.Options<unknown>> = [];
    return Effect.gen(function* () {
      const machine = createMachine({
        initial: 'pending',
        states: {
          pending: {
            invoke: {
              src: fromCallback(() => {
                throw new Error('unhandled_sync_error_in_actor_start');
              }),
              onDone: 'success'
            }
          },
          success: {
            type: 'final'
          }
        }
      });

      yield* Effect.tap(createActor(machine), (a) => a.start);

      // upstream's global error handler receives the error; here the root actor, which has no
      // parent and no error consumer, reports it through the test logger, once (SD-21)
      yield* yieldUntil(() => reportedMessages(logged).length > 0);
      expect(reportedMessages(logged)).toEqual(['unhandled_sync_error_in_actor_start']);
    }).pipe(Effect.provide(testLogger(logged)));
  });

  // upstream: test/errors.test.ts > error handling > unhandled rejection of a promise actor should be reported globally in absence of error listener
  it.effect('unhandled rejection of a promise actor should be reported globally in absence of error listener', () => {
    const logged: Array<Logger.Options<unknown>> = [];
    return Effect.gen(function* () {
      const machine = createMachine({
        initial: 'pending',
        states: {
          pending: {
            invoke: {
              src: fromPromise(() =>
                Promise.reject(
                  new Error(
                    'unhandled_rejection_in_promise_actor_without_error_listener'
                  )
                )
              ),
              onDone: 'success'
            }
          },
          success: {
            type: 'final'
          }
        }
      });

      yield* Effect.tap(createActor(machine), (a) => a.start);

      // upstream's global error handler receives the error; here the root actor, which has no
      // parent and no error consumer, reports it through the test logger, once (SD-21)
      yield* yieldUntil(() => reportedMessages(logged).length > 0);
      expect(reportedMessages(logged)).toEqual([
        'unhandled_rejection_in_promise_actor_without_error_listener'
      ]);
    }).pipe(Effect.provide(testLogger(logged)));
  });

  // upstream: test/errors.test.ts > error handling > unhandled rejection of a promise actor should be reported to the existing error listener of its parent
  it.effect('unhandled rejection of a promise actor should be reported to the existing error listener of its parent', () => Effect.gen(function* () {
    const errorSpy = vi.fn();

    const machine = createMachine({
      initial: 'pending',
      states: {
        pending: {
          invoke: {
            src: fromPromise(() =>
              Promise.reject(
                new Error(
                  'unhandled_rejection_in_promise_actor_with_parent_listener'
                )
              )
            ),
            onDone: 'success'
          }
        },
        success: {
          type: 'final'
        }
      }
    });

    const actorRef = yield* createActor(machine);
    const errors = yield* onError(actorRef, errorSpy);
    yield* actorRef.start;

    // upstream waits a macrotask (`await sleep(0)`); here the test waits until the `changes`
    // stream has failed and the consumer has called the spy
    yield* Fiber.join(errors);

    expect(errorSpy.mock.calls).toMatchInlineSnapshot(`
      [
        [
          [Error: unhandled_rejection_in_promise_actor_with_parent_listener],
        ],
      ]
    `);
  }));

  // upstream: test/errors.test.ts > error handling > unhandled rejection of a promise actor should be reported to the existing error listener of its grandparent
  it.effect('unhandled rejection of a promise actor should be reported to the existing error listener of its grandparent', () => Effect.gen(function* () {
    const errorSpy = vi.fn();

    const child = createMachine({
      initial: 'pending',
      states: {
        pending: {
          invoke: {
            src: fromPromise(() =>
              Promise.reject(
                new Error(
                  'unhandled_rejection_in_promise_actor_with_grandparent_listener'
                )
              )
            ),
            onDone: 'success'
          }
        },
        success: {
          type: 'final'
        }
      }
    });

    const machine = createMachine({
      initial: 'pending',
      states: {
        pending: {
          invoke: {
            src: child,
            onDone: 'success'
          }
        },
        success: {
          type: 'final'
        }
      }
    });

    const actorRef = yield* createActor(machine);
    const errors = yield* onError(actorRef, errorSpy);
    yield* actorRef.start;

    // upstream waits a macrotask (`await sleep(0)`); here the test waits until the `changes`
    // stream has failed and the consumer has called the spy
    yield* Fiber.join(errors);

    expect(errorSpy.mock.calls).toMatchInlineSnapshot(`
      [
        [
          [Error: unhandled_rejection_in_promise_actor_with_grandparent_listener],
        ],
      ]
    `);
  }));

  // upstream: test/errors.test.ts > error handling > handled sync errors thrown when starting a child actor should not be reported globally
  it.effect('handled sync errors thrown when starting a child actor should not be reported globally', () => {
    const logged: Array<Logger.Options<unknown>> = [];
    return Effect.gen(function* () {
      const machine = createMachine({
        initial: 'pending',
        states: {
          pending: {
            invoke: {
              src: fromCallback(() => {
                throw new Error('handled_sync_error_in_actor_start');
              }),
              onError: 'failed'
            }
          },
          failed: {
            type: 'final'
          }
        }
      });

      yield* Effect.tap(createActor(machine), (a) => a.start);

      // upstream fails if its global error handler runs within 10 ms; here the test logger
      // must hold no error report: the child's parent handles the error (SD-21)
      yield* settle;
      expect(reportedMessages(logged)).toEqual([]);
    }).pipe(Effect.provide(testLogger(logged)));
  });

  // Not ported: "handled sync errors thrown when starting a child actor should be reported
  // globally when not all of its own observers come with an error listener". It exercises the
  // observer-object form of subscribe and the global rethrow; see the "Tests not ported" table
  // of CONFORMANCE.md (D6, SD-21).

  // upstream: test/errors.test.ts > error handling > handled sync errors thrown when starting a child actor should not be reported globally when all of its own observers come with an error listener
  it.effect('handled sync errors thrown when starting a child actor should not be reported globally when all of its own observers come with an error listener', () => {
    const logged: Array<Logger.Options<unknown>> = [];
    return Effect.gen(function* () {
      const machine = createMachine({
        initial: 'pending',
        states: {
          pending: {
            invoke: {
              src: fromCallback(() => {
                throw new Error('handled_sync_error_in_actor_start');
              }),
              onError: 'failed'
            }
          },
          failed: {
            type: 'final'
          }
        }
      });

      const actorRef = yield* createActor(machine);
      const childActorRef = Object.values((yield* actorRef.getSnapshot).children)[0]!;
      // two observer objects, each with an `error` callback: two `changes` consumers
      yield* onError(childActorRef, function preventUnhandledErrorListener() {});
      yield* onError(childActorRef, function preventUnhandledErrorListener() {});
      yield* actorRef.start;

      // upstream fails if its global error handler runs within 10 ms; here the test logger
      // must hold no error report (SD-21)
      yield* settle;
      expect(reportedMessages(logged)).toEqual([]);
    }).pipe(Effect.provide(testLogger(logged)));
  });

  // Not ported: "unhandled sync errors thrown when starting a child actor should be reported
  // twice globally when not all of its own observers come with an error listener and when the
  // root has no error listener of its own". It exercises the observer-object form of subscribe
  // and the global rethrow; see the "Tests not ported" table of CONFORMANCE.md (D6, SD-21).

  // upstream: test/errors.test.ts > error handling > handled sync errors shouldn't notify the error listener
  it.effect(`handled sync errors shouldn't notify the error listener`, () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'pending',
      states: {
        pending: {
          invoke: {
            src: fromCallback(() => {
              throw new Error('handled_sync_error_in_actor_start');
            }),
            onError: 'failed'
          }
        },
        failed: {
          type: 'final'
        }
      }
    });

    const errorSpy = vi.fn();

    const actorRef = yield* createActor(machine);
    const errors = yield* onError(actorRef, errorSpy);
    yield* actorRef.start;

    // the parent handles the error and reaches its final state, so its `changes` stream ends
    // without a failure: wait until it has ended, so that the count is not vacuous
    yield* Fiber.join(errors);

    expect(errorSpy).toHaveBeenCalledTimes(0);
  }));

  // upstream: test/errors.test.ts > error handling > unhandled sync errors should notify the root error listener
  it.effect(`unhandled sync errors should notify the root error listener`, () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'pending',
      states: {
        pending: {
          invoke: {
            src: fromCallback(() => {
              throw new Error(
                'unhandled_sync_error_in_actor_start_with_root_error_listener'
              );
            }),
            onDone: 'success'
          }
        },
        success: {
          type: 'final'
        }
      }
    });

    const errorSpy = vi.fn();

    const actorRef = yield* createActor(machine);
    const errors = yield* onError(actorRef, errorSpy);
    yield* actorRef.start;

    // the `changes` consumer runs in its own fiber: wait until it has seen the failure
    yield* Fiber.join(errors);

    expect(errorSpy.mock.calls).toMatchInlineSnapshot(`
      [
        [
          [Error: unhandled_sync_error_in_actor_start_with_root_error_listener],
        ],
      ]
    `);
  }));

  // upstream: test/errors.test.ts > error handling > unhandled sync errors should not notify the global listener when the root error listener is present
  it.effect(`unhandled sync errors should not notify the global listener when the root error listener is present`, () => {
    const logged: Array<Logger.Options<unknown>> = [];
    return Effect.gen(function* () {
      const machine = createMachine({
        initial: 'pending',
        states: {
          pending: {
            invoke: {
              src: fromCallback(() => {
                throw new Error(
                  'unhandled_sync_error_in_actor_start_with_root_error_listener'
                );
              }),
              onDone: 'success'
            }
          },
          success: {
            type: 'final'
          }
        }
      });

      const errorSpy = vi.fn();

      const actorRef = yield* createActor(machine);
      const errors = yield* onError(actorRef, errorSpy);
      yield* actorRef.start;

      // the `changes` consumer runs in its own fiber: wait until it has seen the failure
      yield* Fiber.join(errors);

      expect(errorSpy).toHaveBeenCalledTimes(1);

      // upstream fails if its global error handler runs within 10 ms; here the root has an
      // error consumer, so the test logger must hold no error report (SD-21)
      yield* settle;
      expect(reportedMessages(logged)).toEqual([]);
    }).pipe(Effect.provide(testLogger(logged)));
  });

  // upstream: test/errors.test.ts > error handling > handled sync errors thrown when starting an actor shouldn't crash the parent
  it.effect(`handled sync errors thrown when starting an actor shouldn't crash the parent`, () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine({
      initial: 'pending',
      states: {
        pending: {
          invoke: {
            src: fromCallback(() => {
              throw new Error('handled_sync_error_in_actor_start');
            }),
            onError: 'failed'
          }
        },
        failed: {
          on: {
            do: {
              actions: spy
            }
          }
        }
      }
    });

    const actorRef = yield* createActor(machine);
    yield* actorRef.start;

    // the callback logic runs in its own fiber (D12) and its error reaches the parent as an
    // event that enqueues without waiting (SD-23): wait until the parent has handled it
    yield* yieldUntil(() =>
      Effect.map(actorRef.getSnapshot, (snapshot) => snapshot.matches('failed'))
    );

    expect((yield* actorRef.getSnapshot).status).toBe('active');

    yield* actorRef.send({ type: 'do' });
    expect(spy).toHaveBeenCalledTimes(1);
  }));

  // upstream: test/errors.test.ts > error handling > unhandled sync errors thrown when starting an actor should crash the parent
  it.effect(`unhandled sync errors thrown when starting an actor should crash the parent`, () => {
    const logged: Array<Logger.Options<unknown>> = [];
    return Effect.gen(function* () {
      const machine = createMachine({
        initial: 'pending',
        states: {
          pending: {
            invoke: {
              src: fromCallback(() => {
                throw new Error('unhandled_sync_error_in_actor_start');
              })
            }
          }
        }
      });

      const actorRef = yield* createActor(machine);
      yield* actorRef.start;

      // the callback logic runs in its own fiber (D12) and its error reaches the parent as an
      // event that enqueues without waiting (SD-23): wait until the parent has processed it
      yield* yieldUntil(() =>
        Effect.map(actorRef.getSnapshot, (snapshot) => snapshot.status === 'error')
      );

      expect((yield* actorRef.getSnapshot).status).toBe('error');

      // upstream's global error handler receives the error; here the root actor, which has no
      // parent and no error consumer, reports it through the test logger, once (SD-21)
      yield* yieldUntil(() => reportedMessages(logged).length > 0);
      expect(reportedMessages(logged)).toEqual(['unhandled_sync_error_in_actor_start']);
    }).pipe(Effect.provide(testLogger(logged)));
  });

  // Not ported: "error thrown by the error listener should be reported globally", "error should
  // be reported globally if not every observer comes with an error listener" and "uncaught error
  // and an error thrown by the error listener should both be reported globally when not every
  // observer comes with an error listener". They exercise the observer-object form of subscribe
  // and the global rethrow; see the "Tests not ported" table of CONFORMANCE.md (D6, SD-21).

  // upstream: test/errors.test.ts > error handling > error thrown in initial custom entry action should error the actor
  it.effect('error thrown in initial custom entry action should error the actor', () => Effect.gen(function* () {
    const machine = createMachine({
      entry: () => {
        throw new Error('error_thrown_in_initial_entry_action');
      }
    });

    const errorSpy = vi.fn();

    const actorRef = yield* createActor(machine);
    const errors = yield* onError(actorRef, errorSpy);
    yield* actorRef.start;

    const snapshot = yield* actorRef.getSnapshot;
    expect(snapshot.status).toBe('error');
    // `snapshot.error` is an Option (D8): the inline snapshot reads the error it holds
    expect(Option.getOrUndefined(snapshot.error)).toMatchInlineSnapshot(
      `[Error: error_thrown_in_initial_entry_action]`
    );
    // the `changes` consumer runs in its own fiber: wait until it has seen the failure
    yield* Fiber.join(errors);
    expect(errorSpy.mock.calls).toMatchInlineSnapshot(`
      [
        [
          [Error: error_thrown_in_initial_entry_action],
        ],
      ]
    `);
  }));

  // upstream: test/errors.test.ts > error handling > error thrown when resolving initial builtin entry action should error the actor immediately
  it.effect('error thrown when resolving initial builtin entry action should error the actor immediately', () => Effect.gen(function* () {
    const machine = createMachine({
      entry: assign(() => {
        throw new Error('error_thrown_when_resolving_initial_entry_action');
      })
    });

    const errorSpy = vi.fn();

    const actorRef = yield* createActor(machine);

    const snapshot = yield* actorRef.getSnapshot;
    expect(snapshot.status).toBe('error');
    // `snapshot.error` is an Option (D8): the inline snapshot reads the error it holds
    expect(Option.getOrUndefined(snapshot.error)).toMatchInlineSnapshot(
      `[Error: error_thrown_when_resolving_initial_entry_action]`
    );

    const errors = yield* onError(actorRef, errorSpy);
    yield* actorRef.start;

    // the `changes` consumer runs in its own fiber: wait until it has seen the failure
    yield* Fiber.join(errors);
    expect(errorSpy.mock.calls).toMatchInlineSnapshot(`
      [
        [
          [Error: error_thrown_when_resolving_initial_entry_action],
        ],
      ]
    `);
  }));

  // upstream: test/errors.test.ts > error handling > error thrown by a custom entry action when transitioning should error the actor
  it.effect('error thrown by a custom entry action when transitioning should error the actor', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            NEXT: 'b'
          }
        },
        b: {
          entry: () => {
            throw new Error(
              'error_thrown_in_a_custom_entry_action_when_transitioning'
            );
          }
        }
      }
    });

    const errorSpy = vi.fn();

    const actorRef = yield* createActor(machine);
    const errors = yield* onError(actorRef, errorSpy);
    yield* actorRef.start;
    yield* actorRef.send({ type: 'NEXT' });

    const snapshot = yield* actorRef.getSnapshot;
    expect(snapshot.status).toBe('error');
    // `snapshot.error` is an Option (D8): the inline snapshot reads the error it holds
    expect(Option.getOrUndefined(snapshot.error)).toMatchInlineSnapshot(
      `[Error: error_thrown_in_a_custom_entry_action_when_transitioning]`
    );
    // the `changes` consumer runs in its own fiber: wait until it has seen the failure
    yield* Fiber.join(errors);
    expect(errorSpy.mock.calls).toMatchInlineSnapshot(`
      [
        [
          [Error: error_thrown_in_a_custom_entry_action_when_transitioning],
        ],
      ]
    `);
  }));

  // upstream: test/errors.test.ts > error handling > shouldn't execute deferred initial actions that come after an action that errors
  it.effect(`shouldn't execute deferred initial actions that come after an action that errors`, () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine({
      entry: [
        () => {
          throw new Error('error_thrown_in_initial_entry_action');
        },
        spy
      ]
    });

    const actorRef = yield* createActor(machine);
    const errors = yield* onError(actorRef, function preventUnhandledErrorListener() {});
    yield* actorRef.start;

    // wait until the actor's error has failed the `changes` stream, so that the count is not
    // vacuous
    yield* Fiber.join(errors);

    expect(spy).toHaveBeenCalledTimes(0);
  }));

  // upstream: test/errors.test.ts > error handling > should error the parent on errored initial state of a child
  it.effect('should error the parent on errored initial state of a child', () => Effect.gen(function* () {
    const transitionLogic = fromTransition((_) => undefined, undefined);
    // upstream assigns `getInitialSnapshot` on the logic in place. The port's logic is readonly
    // and its methods return Effects, so the Effect form copies the logic with a
    // `getInitialSnapshot` that returns the initial snapshot in status 'error'; `output` and
    // `error` are Options (D8, SD-7: an undefined output is `Option.none()`)
    const immediateFailure = {
      ...transitionLogic,
      getInitialSnapshot: (
        ...args: Parameters<typeof transitionLogic.getInitialSnapshot>
      ) =>
        Effect.map(transitionLogic.getInitialSnapshot(...args), (snapshot) => ({
          ...snapshot,
          status: 'error' as const,
          output: Option.none(),
          error: Option.some('immediate error!'),
          context: undefined
        }))
    };

    const machine = createMachine(
      {
        invoke: {
          src: 'failure'
        }
      },
      {
        actors: {
          failure: immediateFailure
        }
      }
    );

    const actorRef = yield* createActor(machine);
    const errors = yield* onError(actorRef, function preventUnhandledErrorListener() {});
    yield* actorRef.start;

    // the child's error reaches the parent as an event that enqueues without waiting (SD-23):
    // wait until the parent's `changes` stream has failed
    yield* Fiber.join(errors);

    const snapshot = yield* actorRef.getSnapshot;

    expect(snapshot.status).toBe('error');
    // `snapshot.error` is an Option (D8) that holds the child's raw error (SD-4)
    expect(snapshot.error).toEqual(Option.some('immediate error!'));
  }));

  // upstream: test/errors.test.ts > error handling > should error when a guard throws when transitioning
  it.effect('should error when a guard throws when transitioning', () => Effect.gen(function* () {
    const spy = vi.fn();
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            NEXT: {
              guard: () => {
                throw new Error('error_thrown_in_guard_when_transitioning');
              },
              target: 'b'
            }
          }
        },
        b: {}
      }
    });

    const actorRef = yield* createActor(machine);
    yield* onError(actorRef, spy);
    yield* actorRef.start;
    yield* actorRef.send({ type: 'NEXT' });

    const snapshot = yield* actorRef.getSnapshot;
    expect(snapshot.status).toBe('error');
    // `snapshot.error` is an Option (D8): the inline snapshot reads the error it holds
    expect(Option.getOrUndefined(snapshot.error)).toMatchInlineSnapshot(`
      [Error: Unable to evaluate guard in transition for event 'NEXT' in state node '(machine).a':
      error_thrown_in_guard_when_transitioning]
    `);
  }));

  // upstream: test/errors.test.ts > error handling > actor continues to work normally after emit callback errors
  it.effect('actor continues to work normally after emit callback errors', () => {
    const logged: Array<Logger.Options<unknown>> = [];
    return Effect.gen(function* () {
      const machine = setup({
        types: {
          emitted: {} as { type: 'emitted'; foo: string }
        }
      }).createMachine({
        on: {
          someEvent: {
            actions: emit({ type: 'emitted', foo: 'bar' })
          }
        }
      });

      const actor = yield* Effect.tap(createActor(machine), (a) => a.start);
      let errorThrown = false;

      // the listener throws inside its Effect, as upstream's listener throws; the actor reports
      // the error through the test logger and keeps its status (SD-21)
      yield* actor.on('emitted', () => Effect.sync(() => {
        errorThrown = true;
        throw new Error('oops');
      }));

      // Send first event - should trigger error but actor should remain active
      yield* actor.send({ type: 'someEvent' });
      // upstream waits 10 ms of real time; the Effect form advances the test clock
      yield* TestClock.adjust("10 millis");

      expect(errorThrown).toBe(true);
      expect((yield* actor.getSnapshot).status).toEqual('active');

      // Send second event - should work normally without error
      // upstream resolves a promise from a second listener; the Effect form completes a
      // Deferred from the scoped listener, sends after the listener is registered, then awaits
      // the Deferred
      const received = yield* Deferred.make<AnyEventObject>();
      yield* actor.on('emitted', (ev) => Effect.asVoid(Deferred.succeed(received, ev)));
      yield* actor.send({ type: 'someEvent' });
      const event = yield* Deferred.await(received);

      expect(event.foo).toBe('bar');
      expect((yield* actor.getSnapshot).status).toEqual('active');
    }).pipe(Effect.provide(testLogger(logged)));
  });
});
