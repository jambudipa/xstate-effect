import { describe, expect, it, vi } from "@effect/vitest"
import { Deferred, Duration, Effect, Fiber, Option, Scope, Stream } from "effect"
import { TestClock } from "effect/testing"
import { interval, of, VirtualAction, VirtualTimeScheduler } from 'rxjs';
import { map, take } from 'rxjs/operators';
import { forwardTo, raise, sendTo } from "../../src/index.js";
import {
  PromiseActorLogic,
  TransitionActorScope,
  fromCallback,
  fromEventObservable,
  fromObservable,
  fromPromise,
  fromTransition
} from "../../src/index.js";
import {
  ActorLogic,
  ActorScope,
  EventObject,
  StateValue,
  assign,
  createMachine,
  createActor,
  makeActorLogic,
  sendParent,
  Snapshot,
  ActorRef,
  AnyEventObject
} from "../../src/index.js";

// Upstream delivers the events that actors send to each other (`sendTo`, `sendParent`,
// `sendBack`, child snapshots, done and error notifications) before the outer call returns.
// Here a send from inside an actor enqueues without waiting (SD-23), and a `changes`
// consumer runs in its own fiber, so a test yields its fiber, at most 100 times and never on
// wall-clock time, until the delivery it needs has happened.
const yieldUntil = (done: () => boolean | Effect.Effect<boolean>) =>
  Effect.yieldNow.pipe(Effect.repeat({ until: done, times: 100 }));

// Before an assertion that something did NOT happen: give every enqueued delivery the
// chance to run, so that the assertion is not vacuous.
const settle = yieldUntil(() => false);

// The observer-object `subscribe` is not ported (D6, DEV-3): the `changes` stream ends when
// the actor is done or stopped, so the end of the stream stands for the observer's
// `complete`, and joining the fiber that drains it stands for the promise that `complete`
// resolves. Fork it before `start`, as upstream subscribes before `start`.
const completion = (actor: { readonly changes: Stream.Stream<unknown, unknown> }) =>
  actor.changes.pipe(Stream.runDrain, Effect.forkScoped({ startImmediately: true }));

// The observer's `error` callback (D6, DEV-3): the `changes` stream fails with the actor's
// raw error (SD-4), so the flipped drain succeeds with that error, and joining it stands
// for the promise that `error` resolves. A stream that ends without an error fails the join.
const failure = (actor: { readonly changes: Stream.Stream<unknown, unknown> }) =>
  actor.changes.pipe(Stream.runDrain, Effect.flip, Effect.forkScoped({ startImmediately: true }));

// Advance the Effect clock in 1 ms steps until `effect` completes: delayed events (`after`,
// `sendTo` with `delay`) fire on the Effect clock, never on wall-clock time.
const withClock = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.raceFirst(Effect.forever(TestClock.adjust("1 millis"))));

// Upstream user code (a promise executor, a callback actor) defers work with the host
// `setTimeout` and `setInterval`. The rewrites never wait on wall-clock time: `effectTimers`
// gives that code stand-ins that run `fn` after `ms` of Effect-clock time, in fibers of the
// test's scope, so the test fires them with `TestClock.adjust`.
const effectTimers = Effect.map(Effect.context<Scope.Scope>(), (context) => {
  const runFork = Effect.runForkWith(context);
  const setEffectTimeout = (fn: () => void, ms = 0): void => {
    runFork(
      Effect.forkScoped(
        Effect.sleep(Duration.millis(ms)).pipe(Effect.andThen(Effect.sync(fn))),
        { startImmediately: true }
      )
    );
  };
  const setEffectInterval = (fn: () => void, ms: number): { cleared: boolean } => {
    const handle = { cleared: false };
    runFork(
      Effect.forkScoped(
        Effect.sleep(Duration.millis(ms)).pipe(
          Effect.andThen(Effect.sync(() => {
            if (!handle.cleared) {
              fn();
            }
          })),
          Effect.repeat({ until: () => handle.cleared })
        ),
        { startImmediately: true }
      )
    );
    return handle;
  };
  const clearEffectInterval = (handle: { cleared: boolean }): void => {
    handle.cleared = true;
  };
  return { setEffectTimeout, setEffectInterval, clearEffectInterval };
});

// Upstream's rxjs `interval(10)` runs on the host timer, so those tests wait on real time.
// Here the interval runs on an rxjs `VirtualTimeScheduler` whose `maxFrames` starts at 0, and
// `virtualTick` advances its virtual time by one 10 ms period (`flush` runs the actions due
// by then) and yields, so the actor takes each emission (SD-23). A test ticks until the
// actor completes.
const virtualScheduler = () => new VirtualTimeScheduler(VirtualAction, 0);
const virtualTick = (scheduler: VirtualTimeScheduler) =>
  Effect.andThen(
    Effect.sync(() => {
      scheduler.maxFrames += 10;
      scheduler.flush();
    }),
    Effect.yieldNow
  );
const withVirtualTime = <A, E, R>(
  scheduler: VirtualTimeScheduler,
  effect: Effect.Effect<A, E, R>
) => effect.pipe(Effect.raceFirst(Effect.forever(virtualTick(scheduler))));

const user = { name: 'David' };

describe('invoke', () => {
  // upstream: test/invoke.test.ts > invoke > child can immediately respond to the parent with multiple events
  it.effect('child can immediately respond to the parent with multiple events', () => Effect.gen(function* () {
    const childMachine = createMachine({
      types: {} as {
        events: { type: 'FORWARD_DEC' };
      },
      id: 'child',
      initial: 'init',
      states: {
        init: {
          on: {
            FORWARD_DEC: {
              actions: [
                sendParent({ type: 'DEC' }),
                sendParent({ type: 'DEC' }),
                sendParent({ type: 'DEC' })
              ]
            }
          }
        }
      }
    });

    const someParentMachine = createMachine(
      {
        id: 'parent',
        types: {} as {
          context: { count: number };
          actors: {
            src: 'child';
            id: 'someService';
            logic: typeof childMachine;
          };
        },
        context: { count: 0 },
        initial: 'start',
        states: {
          start: {
            invoke: {
              src: 'child',
              id: 'someService'
            },
            always: {
              target: 'stop',
              guard: ({ context }) => context.count === -3
            },
            on: {
              DEC: {
                actions: assign({ count: ({ context }) => context.count - 1 })
              },
              FORWARD_DEC: {
                actions: sendTo('someService', { type: 'FORWARD_DEC' })
              }
            }
          },
          stop: {
            type: 'final'
          }
        }
      },
      {
        actors: {
          child: childMachine
        }
      }
    );

    const actorRef = (yield* Effect.tap(createActor(someParentMachine), (a) => a.start));
    (yield* actorRef.send({ type: 'FORWARD_DEC' }));

    // 1. The 'parent' machine will not do anything (inert transition)
    // 2. The 'FORWARD_DEC' event will be "forwarded" to the child machine
    // 3. On the child machine, the 'FORWARD_DEC' event sends the 'DEC' action to the parent thrice
    // 4. The context of the 'parent' machine will be updated from 0 to -3
    // (here steps 2 and 3 enqueue (SD-23): yield, bounded, until the three DECs have arrived)
    yield* yieldUntil(() =>
      Effect.map(actorRef.getSnapshot, (snapshot) => snapshot.context.count === -3)
    );
    expect((yield* actorRef.getSnapshot).context).toEqual({ count: -3 });
  }));

  // upstream: test/invoke.test.ts > invoke > should start services (explicit machine, invoke = config)
  it.effect('should start services (explicit machine, invoke = config)', () => Effect.gen(function* () {
    const childMachine = createMachine({
      id: 'fetch',
      types: {} as {
        context: { userId: string | undefined; user?: typeof user | undefined };
        events: {
          type: 'RESOLVE';
          user: typeof user;
        };
        input: { userId: string };
      },
      context: ({ input }) => ({
        userId: input.userId
      }),
      initial: 'pending',
      states: {
        pending: {
          entry: raise({ type: 'RESOLVE', user }),
          on: {
            RESOLVE: {
              target: 'success',
              guard: ({ context }) => {
                return context.userId !== undefined;
              }
            }
          }
        },
        success: {
          type: 'final',
          entry: assign({
            user: ({ event }) => event.user
          })
        },
        failure: {
          entry: sendParent({ type: 'REJECT' })
        }
      },
      output: ({ context }) => ({ user: context.user })
    });

    const machine = createMachine({
      types: {} as {
        context: {
          selectedUserId: string;
          user?: typeof user;
        };
      },
      id: 'fetcher',
      initial: 'idle',
      context: {
        selectedUserId: '42',
        user: undefined
      },
      states: {
        idle: {
          on: {
            GO_TO_WAITING: 'waiting'
          }
        },
        waiting: {
          invoke: {
            src: childMachine,
            input: ({ context }: any) => ({
              userId: context.selectedUserId
            }),
            onDone: {
              target: 'received',
              guard: ({ event }) => {
                // Should receive { user: { name: 'David' } } as event data
                // (`event.output` of `xstate.done.actor.*` is an `Option`, D8, SD-5)
                return Option.getOrThrow(event.output as Option.Option<any>).user.name === 'David';
              }
            }
          }
        },
        received: {
          type: 'final'
        }
      }
    });

    const actor = (yield* createActor(machine));
    const completed = yield* completion(actor);
    (yield* actor.start);
    (yield* actor.send({ type: 'GO_TO_WAITING' }));
    yield* Fiber.join(completed);
  }));

  // upstream: test/invoke.test.ts > invoke > should start services (explicit machine, invoke = machine)
  it.effect('should start services (explicit machine, invoke = machine)', () => Effect.gen(function* () {
    const childMachine = createMachine({
      types: {} as {
        events: { type: 'RESOLVE' };
        input: { userId: string };
      },
      initial: 'pending',
      states: {
        pending: {
          entry: raise({ type: 'RESOLVE' }),
          on: {
            RESOLVE: {
              target: 'success'
            }
          }
        },
        success: {
          type: 'final'
        }
      }
    });

    const machine = createMachine({
      initial: 'idle',
      states: {
        idle: {
          on: {
            GO_TO_WAITING: 'waiting'
          }
        },
        waiting: {
          invoke: {
            src: childMachine,
            onDone: 'received'
          }
        },
        received: {
          type: 'final'
        }
      }
    });
    const actor = (yield* createActor(machine));
    const completed = yield* completion(actor);
    (yield* actor.start);
    (yield* actor.send({ type: 'GO_TO_WAITING' }));
    yield* Fiber.join(completed);
  }));

  // upstream: test/invoke.test.ts > invoke > should start services (machine as invoke config)
  it.effect('should start services (machine as invoke config)', () => Effect.gen(function* () {
    const machineInvokeMachine = createMachine({
      types: {} as {
        events: {
          type: 'SUCCESS';
          data: number;
        };
      },
      id: 'machine-invoke',
      initial: 'pending',
      states: {
        pending: {
          invoke: {
            src: createMachine({
              id: 'child',
              initial: 'sending',
              states: {
                sending: {
                  entry: sendParent({ type: 'SUCCESS', data: 42 })
                }
              }
            })
          },
          on: {
            SUCCESS: {
              target: 'success',
              guard: ({ event }) => {
                return event.data === 42;
              }
            }
          }
        },
        success: {
          type: 'final'
        }
      }
    });
    const actor = (yield* createActor(machineInvokeMachine));
    const completed = yield* completion(actor);
    (yield* actor.start);
    yield* Fiber.join(completed);
  }));

  // upstream: test/invoke.test.ts > invoke > should start deeply nested service (machine as invoke config)
  it.effect('should start deeply nested service (machine as invoke config)', () => Effect.gen(function* () {
    const machineInvokeMachine = createMachine({
      types: {} as {
        events: {
          type: 'SUCCESS';
          data: number;
        };
      },
      id: 'parent',
      initial: 'a',
      states: {
        a: {
          initial: 'b',
          states: {
            b: {
              invoke: {
                src: createMachine({
                  id: 'child',
                  initial: 'sending',
                  states: {
                    sending: {
                      entry: sendParent({ type: 'SUCCESS', data: 42 })
                    }
                  }
                })
              }
            }
          }
        },
        success: {
          id: 'success',
          type: 'final'
        }
      },
      on: {
        SUCCESS: {
          target: '.success',
          guard: ({ event }) => {
            return event.data === 42;
          }
        }
      }
    });
    const actor = (yield* createActor(machineInvokeMachine));
    const completed = yield* completion(actor);
    (yield* actor.start);
    yield* Fiber.join(completed);
  }));

  // upstream: test/invoke.test.ts > invoke > should use the service overwritten by .provide(...)
  it.effect('should use the service overwritten by .provide(...)', () => Effect.gen(function* () {
    const childMachine = createMachine({
      id: 'child',
      initial: 'init',
      states: {
        init: {}
      }
    });

    const someParentMachine = createMachine(
      {
        id: 'parent',
        types: {} as {
          context: { count: number };
          actors: {
            src: 'child';
            id: 'someService';
            logic: typeof childMachine;
          };
        },
        context: { count: 0 },
        initial: 'start',
        states: {
          start: {
            invoke: {
              src: 'child',
              id: 'someService'
            },
            on: {
              STOP: 'stop'
            }
          },
          stop: {
            type: 'final'
          }
        }
      },
      {
        actors: {
          child: childMachine
        }
      }
    );

    const actor = (yield* createActor(
      someParentMachine.provide({
        actors: {
          child: createMachine({
            id: 'child',
            initial: 'init',
            states: {
              init: {
                entry: [sendParent({ type: 'STOP' })]
              }
            }
          })
        }
      })
    ));
    const completed = yield* completion(actor);
    (yield* actor.start);
    yield* Fiber.join(completed);
  }));

  describe('parent to child', () => {
    const subMachine = createMachine({
      id: 'child',
      initial: 'one',
      states: {
        one: {
          on: { NEXT: 'two' }
        },
        two: {
          entry: sendParent({ type: 'NEXT' })
        }
      }
    });

    // upstream: test/invoke.test.ts > invoke > parent to child > should communicate with the child machine (invoke on machine)
    it.effect('should communicate with the child machine (invoke on machine)', () => Effect.gen(function* () {
      const mainMachine = createMachine({
        id: 'parent',
        initial: 'one',
        invoke: {
          id: 'foo-child',
          src: subMachine
        },
        states: {
          one: {
            entry: sendTo('foo-child', { type: 'NEXT' }),
            on: { NEXT: 'two' }
          },
          two: {
            type: 'final'
          }
        }
      });

      const actor = (yield* createActor(mainMachine));
      const completed = yield* completion(actor);
      (yield* actor.start);
      yield* Fiber.join(completed);
    }));

    // upstream: test/invoke.test.ts > invoke > parent to child > should communicate with the child machine (invoke on state)
    it.effect('should communicate with the child machine (invoke on state)', () => Effect.gen(function* () {
      const mainMachine = createMachine({
        id: 'parent',
        initial: 'one',
        states: {
          one: {
            invoke: {
              id: 'foo-child',
              src: subMachine
            },
            entry: sendTo('foo-child', { type: 'NEXT' }),
            on: { NEXT: 'two' }
          },
          two: {
            type: 'final'
          }
        }
      });

      const actor = (yield* createActor(mainMachine));
      const completed = yield* completion(actor);
      (yield* actor.start);
      yield* Fiber.join(completed);
    }));

    // upstream: test/invoke.test.ts > invoke > parent to child > should transition correctly if child invocation causes it to directly go to final state
    it.effect('should transition correctly if child invocation causes it to directly go to final state', () => Effect.gen(function* () {
      const doneSubMachine = createMachine({
        id: 'child',
        initial: 'one',
        states: {
          one: {
            on: { NEXT: 'two' }
          },
          two: {
            type: 'final'
          }
        }
      });

      const mainMachine = createMachine({
        id: 'parent',
        initial: 'one',
        states: {
          one: {
            invoke: {
              id: 'foo-child',
              src: doneSubMachine,
              onDone: 'two'
            },
            entry: sendTo('foo-child', { type: 'NEXT' })
          },
          two: {
            on: { NEXT: 'three' }
          },
          three: {
            type: 'final'
          }
        }
      });

      const actor = (yield* Effect.tap(createActor(mainMachine), (a) => a.start));

      // the `sendTo` of the entry action and the child's done event are enqueued (SD-23):
      // yield, bounded, until the parent has taken its `onDone` transition
      yield* yieldUntil(() =>
        Effect.map(actor.getSnapshot, (snapshot) => snapshot.value === 'two')
      );
      expect((yield* actor.getSnapshot).value).toBe('two');
    }));

    // upstream: test/invoke.test.ts > invoke > parent to child > should work with invocations defined in orthogonal state nodes
    it.effect('should work with invocations defined in orthogonal state nodes', () => Effect.gen(function* () {
      const pongMachine = createMachine({
        id: 'pong',
        initial: 'active',
        states: {
          active: {
            type: 'final'
          }
        },
        output: { secret: 'pingpong' }
      });

      const pingMachine = createMachine({
        id: 'ping',
        type: 'parallel',
        states: {
          one: {
            initial: 'active',
            states: {
              active: {
                invoke: {
                  id: 'pong',
                  src: pongMachine,
                  onDone: {
                    target: 'success',
                    // `event.output` of `xstate.done.actor.*` is an `Option` (D8, SD-5)
                    guard: ({ event }) => Option.getOrThrow(event.output).secret === 'pingpong'
                  }
                }
              },
              success: {
                type: 'final'
              }
            }
          }
        }
      });

      const actor = (yield* createActor(pingMachine));
      const completed = yield* completion(actor);
      (yield* actor.start);
      yield* Fiber.join(completed);
    }));

    // upstream: test/invoke.test.ts > invoke > parent to child > should not reinvoke root-level invocations on root non-reentering transitions
    it.effect('should not reinvoke root-level invocations on root non-reentering transitions', () => Effect.gen(function* () {
      // https://github.com/statelyai/xstate/issues/2147

      let invokeCount = 0;
      let invokeDisposeCount = 0;
      let actionsCount = 0;
      let entryActionsCount = 0;

      const machine = createMachine({
        invoke: {
          src: fromCallback(() => {
            invokeCount++;

            return () => {
              invokeDisposeCount++;
            };
          })
        },
        entry: () => entryActionsCount++,
        on: {
          UPDATE: {
            actions: () => {
              actionsCount++;
            }
          }
        }
      });

      const service = (yield* Effect.tap(createActor(machine), (a) => a.start));
      // upstream runs the callback inside `start`; here it runs in its own fiber: let it run
      // (and let any extra invocation show) before counting
      yield* settle;
      expect(entryActionsCount).toEqual(1);
      expect(invokeCount).toEqual(1);
      expect(invokeDisposeCount).toEqual(0);
      expect(actionsCount).toEqual(0);

      (yield* service.send({ type: 'UPDATE' }));
      // a re-invocation or a disposal would run in a child fiber: let it show
      yield* settle;
      expect(entryActionsCount).toEqual(1);
      expect(invokeCount).toEqual(1);
      expect(invokeDisposeCount).toEqual(0);
      expect(actionsCount).toEqual(1);

      (yield* service.send({ type: 'UPDATE' }));
      yield* settle;
      expect(entryActionsCount).toEqual(1);
      expect(invokeCount).toEqual(1);
      expect(invokeDisposeCount).toEqual(0);
      expect(actionsCount).toEqual(2);
    }));

    // upstream: test/invoke.test.ts > invoke > parent to child > should stop a child actor when reaching a final state
    it.effect('should stop a child actor when reaching a final state', () => Effect.gen(function* () {
      let actorStopped = false;

      const machine = createMachine({
        id: 'machine',
        invoke: {
          src: fromCallback(() => () => (actorStopped = true))
        },
        initial: 'running',
        states: {
          running: {
            on: {
              finished: 'complete'
            }
          },
          complete: { type: 'final' }
        }
      });

      const service = (yield* Effect.tap(createActor(machine), (a) => a.start));
      // upstream runs the callback inside `start`; here it runs in its own fiber: let it
      // return its cleanup function before the machine finishes
      yield* settle;

      (yield* service.send({
        type: 'finished'
      }));

      expect(actorStopped).toBe(true);
    }));
  });

  type PromiseExecutor = (
    resolve: (value?: any) => void,
    reject: (reason?: any) => void
  ) => void;

  const promiseTypes = [
    {
      type: 'Promise',
      createPromise(executor: PromiseExecutor): Promise<any> {
        return new Promise(executor);
      }
    },
    {
      type: 'PromiseLike',
      createPromise(executor: PromiseExecutor): PromiseLike<any> {
        // Simulate a Promise/A+ thenable / polyfilled Promise.
        function createThenable(promise: Promise<any>): PromiseLike<any> {
          return {
            then(onfulfilled, onrejected) {
              return createThenable(promise.then(onfulfilled, onrejected));
            }
          };
        }
        return createThenable(new Promise(executor));
      }
    }
  ];

  promiseTypes.forEach(({ type, createPromise }) => {
    describe(`with promises (${type})`, () => {
      const invokePromiseMachine = createMachine({
        types: {} as { context: { id: number; succeed: boolean } },
        id: 'invokePromise',
        initial: 'pending',
        context: ({
          input
        }: {
          input: { id?: number; succeed?: boolean };
        }) => ({
          id: 42,
          succeed: true,
          ...input
        }),
        states: {
          pending: {
            invoke: {
              src: fromPromise(({ input }) =>
                createPromise((resolve) => {
                  if (input.succeed) {
                    resolve(input.id);
                  } else {
                    throw new Error(`failed on purpose for: ${input.id}`);
                  }
                })
              ),
              input: ({ context }: any) => context,
              onDone: {
                target: 'success',
                guard: ({ context, event }) => {
                  // `event.output` of `xstate.done.actor.*` is an `Option` (D8, SD-5)
                  return Option.contains(event.output, context.id);
                }
              },
              onError: 'failure'
            }
          },
          success: {
            type: 'final'
          },
          failure: {
            type: 'final'
          }
        }
      });

      // upstream: test/invoke.test.ts > invoke > with promises (${type}) > should be invoked with a promise factory and resolve through onDone
      it.effect('should be invoked with a promise factory and resolve through onDone', () => Effect.gen(function* () {
        const machine = createMachine({
          initial: 'pending',
          states: {
            pending: {
              invoke: {
                src: fromPromise(() =>
                  createPromise((resolve) => {
                    resolve();
                  })
                ),
                onDone: 'success'
              }
            },
            success: {
              type: 'final'
            }
          }
        });
        const service = (yield* createActor(machine));
        const completed = yield* completion(service);
        (yield* service.start);
        yield* Fiber.join(completed);
      }));

      // upstream: test/invoke.test.ts > invoke > with promises (${type}) > should be invoked with a promise factory and reject with ErrorExecution
      it.effect('should be invoked with a promise factory and reject with ErrorExecution', () => Effect.gen(function* () {
        const actor = (yield* createActor(invokePromiseMachine, {
          input: { id: 31, succeed: false }
        }));
        const completed = yield* completion(actor);
        (yield* actor.start);
        yield* Fiber.join(completed);
      }));

      // upstream: test/invoke.test.ts > invoke > with promises (${type}) > should be invoked with a promise factory and surface any unhandled errors
      it.effect('should be invoked with a promise factory and surface any unhandled errors', () => Effect.gen(function* () {
        const promiseMachine = createMachine({
          id: 'invokePromise',
          initial: 'pending',
          states: {
            pending: {
              invoke: {
                src: fromPromise(() =>
                  createPromise(() => {
                    throw new Error('test');
                  })
                ),
                onDone: 'success'
              }
            },
            success: {
              type: 'final'
            }
          }
        });

        const service = (yield* createActor(promiseMachine));
        const errored = yield* failure(service);

        (yield* service.start);
        // the observer's `error` callback, called with the error the stream fails with
        const err = yield* Fiber.join(errored);
        expect((err as any).message).toEqual(expect.stringMatching(/test/));
      }));

      // upstream: test/invoke.test.ts > invoke > with promises (${type}) > should be invoked with a promise factory and stop on unhandled onError target
      it.effect('should be invoked with a promise factory and stop on unhandled onError target', () => Effect.gen(function* () {
        const completeSpy = vi.fn();

        const promiseMachine = createMachine({
          id: 'invokePromise',
          initial: 'pending',
          states: {
            pending: {
              invoke: {
                src: fromPromise(() =>
                  createPromise(() => {
                    throw new Error('test');
                  })
                ),
                onDone: 'success'
              }
            },
            success: {
              type: 'final'
            }
          }
        });

        const actor = (yield* createActor(promiseMachine));

        // the observer's `complete` is the end of the `changes` stream and its `error` is
        // the failure of the stream (D6, DEV-3)
        const errored = yield* actor.changes.pipe(
          Stream.runDrain,
          Effect.andThen(Effect.sync(() => completeSpy())),
          Effect.flip,
          Effect.forkScoped({ startImmediately: true })
        );
        (yield* actor.start);
        const err = yield* Fiber.join(errored);
        expect(err).toBeInstanceOf(Error);
        expect((err as any).message).toBe('test');
        expect(completeSpy).not.toHaveBeenCalled();
      }));

      // upstream: test/invoke.test.ts > invoke > with promises (${type}) > should be invoked with a promise factory and resolve through onDone for compound state nodes
      it.effect('should be invoked with a promise factory and resolve through onDone for compound state nodes', () => Effect.gen(function* () {
        const promiseMachine = createMachine({
          id: 'promise',
          initial: 'parent',
          states: {
            parent: {
              initial: 'pending',
              states: {
                pending: {
                  invoke: {
                    src: fromPromise(() =>
                      createPromise((resolve) => resolve())
                    ),
                    onDone: 'success'
                  }
                },
                success: {
                  type: 'final'
                }
              },
              onDone: 'success'
            },
            success: {
              type: 'final'
            }
          }
        });
        const actor = (yield* createActor(promiseMachine));
        const completed = yield* completion(actor);
        (yield* actor.start);
        yield* Fiber.join(completed);
      }));

      // upstream: test/invoke.test.ts > invoke > with promises (${type}) > should be invoked with a promise service and resolve through onDone for compound state nodes
      it.effect('should be invoked with a promise service and resolve through onDone for compound state nodes', () => Effect.gen(function* () {
        const promiseMachine = createMachine(
          {
            id: 'promise',
            initial: 'parent',
            states: {
              parent: {
                initial: 'pending',
                states: {
                  pending: {
                    invoke: {
                      src: 'somePromise',
                      onDone: 'success'
                    }
                  },
                  success: {
                    type: 'final'
                  }
                },
                onDone: 'success'
              },
              success: {
                type: 'final'
              }
            }
          },
          {
            actors: {
              somePromise: fromPromise(() =>
                createPromise((resolve) => resolve())
              )
            }
          }
        );
        const actor = (yield* createActor(promiseMachine));
        const completed = yield* completion(actor);
        (yield* actor.start);
        yield* Fiber.join(completed);
      }));
      // upstream: test/invoke.test.ts > invoke > with promises (${type}) > should assign the resolved data when invoked with a promise factory
      it.effect('should assign the resolved data when invoked with a promise factory', () => Effect.gen(function* () {
        const promiseMachine = createMachine({
          types: {} as { context: { count: number } },
          id: 'promise',
          context: { count: 0 },
          initial: 'pending',
          states: {
            pending: {
              invoke: {
                src: fromPromise(() =>
                  createPromise((resolve) => resolve({ count: 1 }))
                ),
                onDone: {
                  target: 'success',
                  actions: assign({
                    // `event.output` of `xstate.done.actor.*` is an `Option` (D8, SD-5)
                    count: ({ event }) => Option.getOrThrow(event.output).count
                  })
                }
              }
            },
            success: {
              type: 'final'
            }
          }
        });

        const actor = (yield* createActor(promiseMachine));
        const completed = yield* actor.changes.pipe(
          Stream.runDrain,
          Effect.andThen(Effect.gen(function* () {
            expect((yield* actor.getSnapshot).context.count).toEqual(1);
          })),
          Effect.forkScoped({ startImmediately: true })
        );
        (yield* actor.start);
        yield* Fiber.join(completed);
      }));

      // upstream: test/invoke.test.ts > invoke > with promises (${type}) > should assign the resolved data when invoked with a promise service
      it.effect('should assign the resolved data when invoked with a promise service', () => Effect.gen(function* () {
        const promiseMachine = createMachine(
          {
            types: {} as { context: { count: number } },
            id: 'promise',
            context: { count: 0 },
            initial: 'pending',
            states: {
              pending: {
                invoke: {
                  src: 'somePromise',
                  onDone: {
                    target: 'success',
                    actions: assign({
                      // `event.output` of `xstate.done.actor.*` is an `Option` (D8, SD-5)
                      count: ({ event }) => Option.getOrThrow(event.output).count
                    })
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
              somePromise: fromPromise(() =>
                createPromise((resolve) => resolve({ count: 1 }))
              )
            }
          }
        );

        const actor = (yield* createActor(promiseMachine));
        const completed = yield* actor.changes.pipe(
          Stream.runDrain,
          Effect.andThen(Effect.gen(function* () {
            expect((yield* actor.getSnapshot).context.count).toEqual(1);
          })),
          Effect.forkScoped({ startImmediately: true })
        );
        (yield* actor.start);
        yield* Fiber.join(completed);
      }));

      // upstream: test/invoke.test.ts > invoke > with promises (${type}) > should provide the resolved data when invoked with a promise factory
      it.effect('should provide the resolved data when invoked with a promise factory', () => Effect.gen(function* () {
        let count = 0;

        const promiseMachine = createMachine({
          id: 'promise',
          context: { count: 0 },
          initial: 'pending',
          states: {
            pending: {
              invoke: {
                src: fromPromise(() =>
                  createPromise((resolve) => resolve({ count: 1 }))
                ),
                onDone: {
                  target: 'success',
                  actions: ({ event }) => {
                    // `event.output` of `xstate.done.actor.*` is an `Option` (D8, SD-5)
                    count = Option.getOrThrow(event.output as Option.Option<any>).count;
                  }
                }
              }
            },
            success: {
              type: 'final'
            }
          }
        });

        const actor = (yield* createActor(promiseMachine));
        const completed = yield* actor.changes.pipe(
          Stream.runDrain,
          Effect.andThen(Effect.sync(() => {
            expect(count).toEqual(1);
          })),
          Effect.forkScoped({ startImmediately: true })
        );
        (yield* actor.start);
        yield* Fiber.join(completed);
      }));

      // upstream: test/invoke.test.ts > invoke > with promises (${type}) > should provide the resolved data when invoked with a promise service
      it.effect('should provide the resolved data when invoked with a promise service', () => Effect.gen(function* () {
        let count = 0;

        const promiseMachine = createMachine(
          {
            id: 'promise',
            initial: 'pending',
            states: {
              pending: {
                invoke: {
                  src: 'somePromise',
                  onDone: {
                    target: 'success',
                    actions: ({ event }) => {
                      // `event.output` of `xstate.done.actor.*` is an `Option` (D8, SD-5)
                      count = Option.getOrThrow(event.output).count;
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
              somePromise: fromPromise(() =>
                createPromise((resolve) => resolve({ count: 1 }))
              )
            }
          }
        );

        const actor = (yield* createActor(promiseMachine));
        const completed = yield* actor.changes.pipe(
          Stream.runDrain,
          Effect.andThen(Effect.sync(() => {
            expect(count).toEqual(1);
          })),
          Effect.forkScoped({ startImmediately: true })
        );
        (yield* actor.start);
        yield* Fiber.join(completed);
      }));

      // upstream: test/invoke.test.ts > invoke > with promises (${type}) > should be able to specify a Promise as a service
      it.effect('should be able to specify a Promise as a service', () => Effect.gen(function* () {
        interface BeginEvent {
          type: 'BEGIN';
          payload: boolean;
        }

        const promiseActor = fromPromise(
          ({ input }: { input: { foo: boolean; event: { payload: any } } }) => {
            return createPromise((resolve, reject) => {
              input.foo && input.event.payload ? resolve() : reject();
            });
          }
        );

        const promiseMachine = createMachine(
          {
            id: 'promise',
            types: {} as {
              context: { foo: boolean };
              events: BeginEvent;
              actors: {
                src: 'somePromise';
                logic: typeof promiseActor;
              };
            },
            initial: 'pending',
            context: {
              foo: true
            },
            states: {
              pending: {
                on: {
                  BEGIN: 'first'
                }
              },
              first: {
                invoke: {
                  src: 'somePromise',
                  input: ({ context, event }) => ({
                    foo: context.foo,
                    event: event
                  }),
                  onDone: 'last'
                }
              },
              last: {
                type: 'final'
              }
            }
          },
          {
            actors: {
              somePromise: promiseActor
            }
          }
        );

        const actor = (yield* createActor(promiseMachine));
        const completed = yield* completion(actor);
        (yield* actor.start);
        (yield* actor.send({
          type: 'BEGIN',
          payload: true
        }));
        yield* Fiber.join(completed);
      }));

      // upstream: test/invoke.test.ts > invoke > with promises (${type}) > should be able to reuse the same promise logic multiple times and create unique promise for each created actor
      it.effect('should be able to reuse the same promise logic multiple times and create unique promise for each created actor', () => Effect.gen(function* () {
        const machine = createMachine(
          {
            types: {} as {
              context: {
                result1: number | null;
                result2: number | null;
              };
              actors: {
                src: 'getRandomNumber';
                logic: PromiseActorLogic<{ result: number }>;
              };
            },
            context: {
              result1: null,
              result2: null
            },
            initial: 'pending',
            states: {
              pending: {
                type: 'parallel',
                states: {
                  state1: {
                    initial: 'active',
                    states: {
                      active: {
                        invoke: {
                          src: 'getRandomNumber',
                          onDone: {
                            target: 'success',
                            // TODO: we get DoneInvokeEvent<any> here, this gets fixed with https://github.com/microsoft/TypeScript/pull/48838
                            // `event.output` of `xstate.done.actor.*` is an `Option` (D8, SD-5)
                            actions: assign(({ event }) => ({
                              result1: Option.getOrThrow(event.output).result
                            }))
                          }
                        }
                      },
                      success: {
                        type: 'final'
                      }
                    }
                  },
                  state2: {
                    initial: 'active',
                    states: {
                      active: {
                        invoke: {
                          src: 'getRandomNumber',
                          onDone: {
                            target: 'success',
                            // `event.output` of `xstate.done.actor.*` is an `Option` (D8, SD-5)
                            actions: assign(({ event }) => ({
                              result2: Option.getOrThrow(event.output).result
                            }))
                          }
                        }
                      },
                      success: {
                        type: 'final'
                      }
                    }
                  }
                },
                onDone: 'done'
              },
              done: {
                type: 'final'
              }
            }
          },
          {
            actors: {
              // it's important for this actor to be reused, this test shouldn't use a factory or anything like that
              getRandomNumber: fromPromise(() => {
                return createPromise((resolve) =>
                  resolve({ result: Math.random() })
                );
              })
            }
          }
        );

        const service = (yield* createActor(machine));
        const completed = yield* service.changes.pipe(
          Stream.runDrain,
          Effect.andThen(Effect.gen(function* () {
            const snapshot = (yield* service.getSnapshot);
            expect(typeof snapshot.context.result1).toBe('number');
            expect(typeof snapshot.context.result2).toBe('number');
            expect(snapshot.context.result1).not.toBe(snapshot.context.result2);
          })),
          Effect.forkScoped({ startImmediately: true })
        );
        (yield* service.start);
        yield* Fiber.join(completed);
      }));

      // upstream: test/invoke.test.ts > invoke > with promises (${type}) > should not emit onSnapshot if stopped
      it.effect('should not emit onSnapshot if stopped', () => Effect.gen(function* () {
        // upstream resolves the promise from the host `setTimeout`; it runs on the Effect clock
        // here (see `effectTimers`)
        const { setEffectTimeout } = yield* effectTimers;
        const machine = createMachine({
          initial: 'active',
          states: {
            active: {
              invoke: {
                src: fromPromise(() =>
                  createPromise((res) => {
                    setEffectTimeout(() => res(42), 5);
                  })
                ),
                onSnapshot: {}
              },
              on: {
                deactivate: 'inactive'
              }
            },
            inactive: {
              on: {
                '*': {
                  actions: ({ event }) => {
                    if (event.snapshot) {
                      throw new Error(
                        `Received unexpected event: ${event.type}`
                      );
                    }
                  }
                }
              }
            }
          }
        });

        const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
        // upstream creates the promise inside `start`; here the child runs in its own fiber:
        // let it create the promise (and start its timer) before `deactivate`
        yield* settle;
        (yield* actor.send({ type: 'deactivate' }));

        // upstream waits 10 ms of real time; the Effect clock advances 10 ms here (the
        // promise resolves at 5 ms), then every enqueued delivery gets the chance to run
        yield* TestClock.adjust("10 millis");
        yield* settle;
        // upstream fails through the global rethrow of the action's error; that rethrow is
        // not ported (SD-21), so the test reads the status the error would set (SD-4)
        expect((yield* actor.getSnapshot).status).toBe('active');
      }));
    });
  });

  describe('with callbacks', () => {
    // upstream: test/invoke.test.ts > invoke > with callbacks > should be able to specify a callback as a service
    it.effect('should be able to specify a callback as a service', () => Effect.gen(function* () {
      interface BeginEvent {
        type: 'BEGIN';
        payload: boolean;
      }
      interface CallbackEvent {
        type: 'CALLBACK';
        data: number;
      }

      const someCallback = fromCallback(
        ({
          sendBack,
          input
        }: {
          sendBack: (event: BeginEvent | CallbackEvent) => void;
          input: { foo: boolean; event: BeginEvent | CallbackEvent };
        }) => {
          if (input.foo && input.event.type === 'BEGIN') {
            sendBack({
              type: 'CALLBACK',
              data: 40
            });
            sendBack({
              type: 'CALLBACK',
              data: 41
            });
            sendBack({
              type: 'CALLBACK',
              data: 42
            });
          }
        }
      );

      const callbackMachine = createMachine(
        {
          id: 'callback',
          types: {} as {
            context: { foo: boolean };
            events: BeginEvent | CallbackEvent;
            actors: {
              src: 'someCallback';
              logic: typeof someCallback;
            };
          },
          initial: 'pending',
          context: {
            foo: true
          },
          states: {
            pending: {
              on: {
                BEGIN: 'first'
              }
            },
            first: {
              invoke: {
                src: 'someCallback',
                input: ({ context, event }) => ({
                  foo: context.foo,
                  event: event
                })
              },
              on: {
                CALLBACK: {
                  target: 'last',
                  guard: ({ event }) => event.data === 42
                }
              }
            },
            last: {
              type: 'final'
            }
          }
        },
        {
          actors: {
            someCallback
          }
        }
      );

      const actor = (yield* createActor(callbackMachine));
      const completed = yield* completion(actor);
      (yield* actor.start);
      (yield* actor.send({
        type: 'BEGIN',
        payload: true
      }));
      yield* Fiber.join(completed);
    }));

    // upstream: test/invoke.test.ts > invoke > with callbacks > should transition correctly if callback function sends an event
    it.effect('should transition correctly if callback function sends an event', () => Effect.gen(function* () {
      const callbackMachine = createMachine(
        {
          id: 'callback',
          initial: 'pending',
          context: { foo: true },
          states: {
            pending: {
              on: { BEGIN: 'first' }
            },
            first: {
              invoke: {
                src: 'someCallback'
              },
              on: { CALLBACK: 'intermediate' }
            },
            intermediate: {
              on: { NEXT: 'last' }
            },
            last: {
              type: 'final'
            }
          }
        },
        {
          actors: {
            someCallback: fromCallback(({ sendBack }) => {
              sendBack({ type: 'CALLBACK' });
            })
          }
        }
      );

      const expectedStateValues = ['pending', 'first', 'intermediate'];
      const stateValues: StateValue[] = [];
      const actor = (yield* createActor(callbackMachine));
      yield* actor.subscribe((current) => Effect.sync(() => stateValues.push(current.value)));
      (yield* actor.start);
      (yield* actor.send({ type: 'BEGIN' }));
      // upstream takes the callback's CALLBACK inside `send`; `sendBack` enqueues here
      // (SD-23): yield, bounded, until the snapshot of that event has been published
      yield* yieldUntil(() => stateValues.length >= expectedStateValues.length);
      for (let i = 0; i < expectedStateValues.length; i++) {
        expect(stateValues[i]).toEqual(expectedStateValues[i]);
      }
    }));

    // upstream: test/invoke.test.ts > invoke > with callbacks > should transition correctly if callback function invoked from start and sends an event
    it.effect('should transition correctly if callback function invoked from start and sends an event', () => Effect.gen(function* () {
      const callbackMachine = createMachine(
        {
          id: 'callback',
          initial: 'idle',
          context: { foo: true },
          states: {
            idle: {
              invoke: {
                src: 'someCallback'
              },
              on: { CALLBACK: 'intermediate' }
            },
            intermediate: {
              on: { NEXT: 'last' }
            },
            last: {
              type: 'final'
            }
          }
        },
        {
          actors: {
            someCallback: fromCallback(({ sendBack }) => {
              sendBack({ type: 'CALLBACK' });
            })
          }
        }
      );

      const expectedStateValues = ['idle', 'intermediate'];
      const stateValues: StateValue[] = [];
      const actor = (yield* createActor(callbackMachine));
      yield* actor.subscribe((current) => Effect.sync(() => stateValues.push(current.value)));
      (yield* actor.start);
      // upstream takes the callback's CALLBACK inside `start`, before BEGIN; `sendBack`
      // enqueues here (SD-23): yield, bounded, until the snapshot of that event has been
      // published, then send BEGIN as upstream does
      yield* yieldUntil(() => stateValues.length >= expectedStateValues.length);
      (yield* actor.send({ type: 'BEGIN' }));
      for (let i = 0; i < expectedStateValues.length; i++) {
        expect(stateValues[i]).toEqual(expectedStateValues[i]);
      }
    }));

    // tslint:disable-next-line:max-line-length
    // upstream: test/invoke.test.ts > invoke > with callbacks > should transition correctly if transient transition happens before current state invokes callback function and sends an event
    it.effect('should transition correctly if transient transition happens before current state invokes callback function and sends an event', () => Effect.gen(function* () {
      const callbackMachine = createMachine(
        {
          id: 'callback',
          initial: 'pending',
          context: { foo: true },
          states: {
            pending: {
              on: { BEGIN: 'first' }
            },
            first: {
              always: 'second'
            },
            second: {
              invoke: {
                src: 'someCallback'
              },
              on: { CALLBACK: 'third' }
            },
            third: {
              on: { NEXT: 'last' }
            },
            last: {
              type: 'final'
            }
          }
        },
        {
          actors: {
            someCallback: fromCallback(({ sendBack }) => {
              sendBack({ type: 'CALLBACK' });
            })
          }
        }
      );

      const expectedStateValues = ['pending', 'second', 'third'];
      const stateValues: StateValue[] = [];
      const actor = (yield* createActor(callbackMachine));
      yield* actor.subscribe((current) => Effect.sync(() => {
        stateValues.push(current.value);
      }));
      (yield* actor.start);
      (yield* actor.send({ type: 'BEGIN' }));
      // upstream takes the callback's CALLBACK inside `send`; `sendBack` enqueues here
      // (SD-23): yield, bounded, until the snapshot of that event has been published
      yield* yieldUntil(() => stateValues.length >= expectedStateValues.length);

      for (let i = 0; i < expectedStateValues.length; i++) {
        expect(stateValues[i]).toEqual(expectedStateValues[i]);
      }
    }));

    // upstream: test/invoke.test.ts > invoke > with callbacks > should treat a callback source as an event stream
    it.effect('should treat a callback source as an event stream', () => Effect.gen(function* () {
      // upstream's interval runs on the host `setInterval`; it runs on the Effect clock here
      // (see `effectTimers`)
      const { setEffectInterval, clearEffectInterval } = yield* effectTimers;
      const intervalMachine = createMachine({
        types: {} as { context: { count: number } },
        id: 'interval',
        initial: 'counting',
        context: {
          count: 0
        },
        states: {
          counting: {
            invoke: {
              id: 'intervalService',
              src: fromCallback(({ sendBack }) => {
                const ivl = setEffectInterval(() => {
                  sendBack({ type: 'INC' });
                }, 10);

                return () => clearEffectInterval(ivl);
              })
            },
            always: {
              target: 'finished',
              guard: ({ context }) => context.count === 3
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
      const actor = (yield* createActor(intervalMachine));
      const completed = yield* completion(actor);
      (yield* actor.start);
      // the Effect clock advances in 1 ms steps until the actor completes
      yield* withClock(Fiber.join(completed));
    }));

    // upstream: test/invoke.test.ts > invoke > with callbacks > should dispose of the callback (if disposal function provided)
    it.effect('should dispose of the callback (if disposal function provided)', () => Effect.gen(function* () {
      const spy = vi.fn();
      const intervalMachine = createMachine({
        id: 'interval',
        initial: 'counting',
        states: {
          counting: {
            invoke: {
              id: 'intervalService',
              src: fromCallback(() => spy)
            },
            on: {
              NEXT: 'idle'
            }
          },
          idle: {}
        }
      });
      const actorRef = (yield* Effect.tap(createActor(intervalMachine), (a) => a.start));
      // upstream runs the callback inside `start`; here it runs in its own fiber: let it
      // return its disposal function before NEXT
      yield* settle;

      (yield* actorRef.send({ type: 'NEXT' }));

      expect(spy).toHaveBeenCalled();
    }));

    // upstream: test/invoke.test.ts > invoke > with callbacks > callback should be able to receive messages from parent
    it.effect('callback should be able to receive messages from parent', () => Effect.gen(function* () {
      const pingPongMachine = createMachine({
        id: 'ping-pong',
        initial: 'active',
        states: {
          active: {
            invoke: {
              id: 'child',
              src: fromCallback(({ sendBack, receive }) => {
                receive((e) => {
                  if (e.type === 'PING') {
                    sendBack({ type: 'PONG' });
                  }
                });
              })
            },
            entry: sendTo('child', { type: 'PING' }),
            on: {
              PONG: 'done'
            }
          },
          done: {
            type: 'final'
          }
        }
      });
      const actor = (yield* createActor(pingPongMachine));
      const completed = yield* completion(actor);
      (yield* actor.start);
      yield* Fiber.join(completed);
    }));

    // upstream: test/invoke.test.ts > invoke > with callbacks > should call onError upon error (sync)
    it.effect('should call onError upon error (sync)', () => Effect.gen(function* () {
      const errorMachine = createMachine({
        id: 'error',
        initial: 'safe',
        states: {
          safe: {
            invoke: {
              src: fromCallback(() => {
                throw new Error('test');
              }),
              onError: {
                target: 'failed',
                guard: ({ event }) => {
                  return (
                    event.error instanceof Error &&
                    event.error.message === 'test'
                  );
                }
              }
            }
          },
          failed: {
            type: 'final'
          }
        }
      });
      const actor = (yield* createActor(errorMachine));
      const completed = yield* completion(actor);
      (yield* actor.start);
      yield* Fiber.join(completed);
    }));

    // upstream: test/invoke.test.ts > invoke > with callbacks > should transition correctly upon error (sync)
    it.effect('should transition correctly upon error (sync)', () => Effect.gen(function* () {
      const errorMachine = createMachine({
        id: 'error',
        initial: 'safe',
        states: {
          safe: {
            invoke: {
              src: fromCallback(() => {
                throw new Error('test');
              }),
              onError: 'failed'
            }
          },
          failed: {
            on: { RETRY: 'safe' }
          }
        }
      });

      const expectedStateValue = 'failed';
      const service = (yield* Effect.tap(createActor(errorMachine), (a) => a.start));
      // upstream takes the child's error event inside `start`; the relay to the parent
      // enqueues here (SD-4, SD-23): yield, bounded, until the parent has taken it
      yield* yieldUntil(() =>
        Effect.map(service.getSnapshot, (snapshot) => snapshot.value === expectedStateValue)
      );
      expect((yield* service.getSnapshot).value).toEqual(expectedStateValue);
    }));

    // upstream: test/invoke.test.ts > invoke > with callbacks > should call onError only on the state which has invoked failed service
    it.effect('should call onError only on the state which has invoked failed service', () => Effect.gen(function* () {
      const errorMachine = createMachine({
        initial: 'start',
        states: {
          start: {
            on: {
              FETCH: 'fetch'
            }
          },
          fetch: {
            type: 'parallel',
            states: {
              first: {
                initial: 'waiting',
                states: {
                  waiting: {
                    invoke: {
                      src: fromCallback(() => {
                        throw new Error('test');
                      }),
                      onError: {
                        target: 'failed'
                      }
                    }
                  },
                  failed: {}
                }
              },
              second: {
                initial: 'waiting',
                states: {
                  waiting: {
                    invoke: {
                      src: fromCallback(() => {
                        // empty
                        return () => {};
                      }),
                      onError: {
                        target: 'failed'
                      }
                    }
                  },
                  failed: {}
                }
              }
            }
          }
        }
      });

      const actorRef = (yield* Effect.tap(createActor(errorMachine), (a) => a.start));
      (yield* actorRef.send({ type: 'FETCH' }));

      // upstream takes the child's error event inside `send`; the relay to the parent
      // enqueues here (SD-4, SD-23): yield, bounded, until the parent has taken it, and let
      // any wrong `onError` show
      yield* yieldUntil(() =>
        Effect.map(actorRef.getSnapshot, (snapshot) =>
          snapshot.matches({ fetch: { first: 'failed' } })
        )
      );
      yield* settle;
      expect((yield* actorRef.getSnapshot).value).toEqual({
        fetch: { first: 'failed', second: 'waiting' }
      });
    }));

    // upstream: test/invoke.test.ts > invoke > with callbacks > should be able to be stringified
    it.effect('should be able to be stringified', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'idle',
        states: {
          idle: {
            on: {
              GO_TO_WAITING: 'waiting'
            }
          },
          waiting: {
            invoke: {
              src: fromCallback(() => {})
            }
          }
        }
      });
      const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
      (yield* actorRef.send({ type: 'GO_TO_WAITING' }));
      const waitingState = (yield* actorRef.getSnapshot);

      expect(() => {
        JSON.stringify(waitingState);
      }).not.toThrow();
    }));

    // upstream: test/invoke.test.ts > invoke > with callbacks > should result in an error notification if callback actor throws when it starts and the error stays unhandled by the machine
    it.effect('should result in an error notification if callback actor throws when it starts and the error stays unhandled by the machine', () => Effect.gen(function* () {
      const errorMachine = createMachine({
        initial: 'safe',
        states: {
          safe: {
            invoke: {
              src: fromCallback(() => {
                throw new Error('test');
              })
            }
          },
          failed: {
            type: 'final'
          }
        }
      });
      const spy = vi.fn();

      const actorRef = (yield* createActor(errorMachine));
      // the observer's `error` callback (D6, DEV-3): called with the error the `changes`
      // stream fails with
      yield* actorRef.changes.pipe(
        Stream.runDrain,
        Effect.catch((error) => Effect.sync(() => spy(error))),
        Effect.forkScoped({ startImmediately: true })
      );
      (yield* actorRef.start);
      // upstream notifies the observer inside `start`; the error reaches the stream consumer
      // in its own fiber here: yield, bounded, until it has
      yield* yieldUntil(() => spy.mock.calls.length > 0);
      expect(spy.mock.calls).toMatchInlineSnapshot(`
        [
          [
            [Error: test],
          ],
        ]
      `);
    }));

    // upstream: test/invoke.test.ts > invoke > with callbacks > should work with input
    it.effect('should work with input', () => Effect.gen(function* () {
      // upstream asserts inside the callback and resolves a promise; here the callback hands
      // its input to the test through a Deferred, and the test makes the same assertion (a
      // throw inside the callback would only set the actor's error status, SD-4)
      const received = yield* Deferred.make<unknown>();
      const machine = createMachine({
        types: {} as {
          context: { foo: string };
        },
        initial: 'start',
        context: { foo: 'bar' },
        states: {
          start: {
            invoke: {
              src: fromCallback(({ input }) => {
                Deferred.doneUnsafe(received, Effect.succeed(input));
              }),
              input: ({ context }: any) => context
            }
          }
        }
      });

      (yield* Effect.tap(createActor(machine), (a) => a.start));
      const input = yield* Deferred.await(received);
      expect(input).toEqual({ foo: 'bar' });
    }));

    // upstream: test/invoke.test.ts > invoke > with callbacks > sub invoke race condition ends on the completed state
    it.effect('sub invoke race condition ends on the completed state', () => Effect.gen(function* () {
      const anotherChildMachine = createMachine({
        id: 'child',
        initial: 'start',
        states: {
          start: {
            on: { STOP: 'end' }
          },
          end: {
            type: 'final'
          }
        }
      });

      const anotherParentMachine = createMachine({
        id: 'parent',
        initial: 'begin',
        states: {
          begin: {
            invoke: {
              src: anotherChildMachine,
              id: 'invoked.child',
              onDone: 'completed'
            },
            on: {
              STOPCHILD: {
                actions: sendTo('invoked.child', { type: 'STOP' })
              }
            }
          },
          completed: {
            type: 'final'
          }
        }
      });

      const actorRef = (yield* Effect.tap(createActor(anotherParentMachine), (a) => a.start));
      (yield* actorRef.send({ type: 'STOPCHILD' }));

      // the `sendTo` and the child's done event are enqueued (SD-23): yield, bounded, until
      // the parent has taken its `onDone` transition
      yield* yieldUntil(() =>
        Effect.map(actorRef.getSnapshot, (snapshot) => snapshot.value === 'completed')
      );
      expect((yield* actorRef.getSnapshot).value).toEqual('completed');
    }));
  });

  describe('with observables', () => {
    // upstream: test/invoke.test.ts > invoke > with observables > should work with an infinite observable
    it.effect('should work with an infinite observable', () => Effect.gen(function* () {
      const scheduler = virtualScheduler();
      interface Events {
        type: 'COUNT';
        value: number;
      }
      const obsMachine = createMachine({
        types: {} as { context: { count: number | undefined }; events: Events },
        id: 'infiniteObs',
        initial: 'counting',
        context: { count: undefined },
        states: {
          counting: {
            invoke: {
              src: fromObservable(() => interval(10, scheduler)),
              onSnapshot: {
                actions: assign({
                  // `snapshot.context` of observable logic is an `Option` (SD-17, DEV-19)
                  count: ({ event }) => Option.getOrUndefined(event.snapshot.context)
                })
              }
            },
            always: {
              target: 'counted',
              guard: ({ context }) => context.count === 5
            }
          },
          counted: {
            type: 'final'
          }
        }
      });

      const service = (yield* createActor(obsMachine));
      const completed = yield* completion(service);
      (yield* service.start);
      yield* withVirtualTime(scheduler, Fiber.join(completed));
    }));

    // upstream: test/invoke.test.ts > invoke > with observables > should work with a finite observable
    it.effect('should work with a finite observable', () => Effect.gen(function* () {
      const scheduler = virtualScheduler();
      interface Ctx {
        count: number | undefined;
      }
      interface Events {
        type: 'COUNT';
        value: number;
      }
      const obsMachine = createMachine({
        types: {} as { context: Ctx; events: Events },
        id: 'obs',
        initial: 'counting',
        context: {
          count: undefined
        },
        states: {
          counting: {
            invoke: {
              src: fromObservable(() => interval(10, scheduler).pipe(take(5))),
              onSnapshot: {
                actions: assign({
                  // `snapshot.context` of observable logic is an `Option` (SD-17, DEV-19)
                  count: ({ event }) => Option.getOrUndefined(event.snapshot.context)
                })
              },
              onDone: {
                target: 'counted',
                guard: ({ context }) => context.count === 4
              }
            }
          },
          counted: {
            type: 'final'
          }
        }
      });

      const actor = (yield* createActor(obsMachine));
      const completed = yield* completion(actor);
      (yield* actor.start);
      yield* withVirtualTime(scheduler, Fiber.join(completed));
    }));

    // upstream: test/invoke.test.ts > invoke > with observables > should receive an emitted error
    it.effect('should receive an emitted error', () => Effect.gen(function* () {
      const scheduler = virtualScheduler();
      interface Ctx {
        count: number | undefined;
      }
      interface Events {
        type: 'COUNT';
        value: number;
      }
      const obsMachine = createMachine({
        types: {} as { context: Ctx; events: Events },
        id: 'obs',
        initial: 'counting',
        context: { count: undefined },
        states: {
          counting: {
            invoke: {
              src: fromObservable(() =>
                interval(10, scheduler).pipe(
                  map((value) => {
                    if (value === 5) {
                      throw new Error('some error');
                    }

                    return value;
                  })
                )
              ),
              onSnapshot: {
                actions: assign({
                  // `snapshot.context` of observable logic is an `Option` (SD-17, DEV-19)
                  count: ({ event }) => Option.getOrUndefined(event.snapshot.context)
                })
              },
              onError: {
                target: 'success',
                guard: ({ context, event }) => {
                  expect((event.error as any).message).toEqual('some error');
                  return (
                    context.count === 4 &&
                    (event.error as any).message === 'some error'
                  );
                }
              }
            }
          },
          success: {
            type: 'final'
          }
        }
      });

      const actor = (yield* createActor(obsMachine));
      const completed = yield* completion(actor);
      (yield* actor.start);
      yield* withVirtualTime(scheduler, Fiber.join(completed));
    }));

    // upstream: test/invoke.test.ts > invoke > with observables > should work with input
    it.effect('should work with input', () => Effect.gen(function* () {
      // upstream resolves a promise from the action; here the action completes a Deferred
      const resolved = yield* Deferred.make<void>();
      const childLogic = fromObservable(({ input }: { input: number }) =>
        of(input)
      );

      const machine = createMachine(
        {
          types: {} as {
            actors: {
              src: 'childLogic';
              logic: typeof childLogic;
            };
          },
          context: { received: undefined },
          invoke: {
            src: 'childLogic',
            input: 42,
            onSnapshot: {
              actions: ({ event }) => {
                if (
                  event.snapshot.status === 'active' &&
                  // `snapshot.context` of observable logic is an `Option` (SD-17, DEV-19)
                  Option.contains(event.snapshot.context, 42)
                ) {
                  Deferred.doneUnsafe(resolved, Effect.void);
                }
              }
            }
          }
        },
        {
          actors: {
            childLogic
          }
        }
      );

      (yield* Effect.tap(createActor(machine), (a) => a.start));
      yield* Deferred.await(resolved);
    }));
  });

  describe('with event observables', () => {
    // upstream: test/invoke.test.ts > invoke > with event observables > should work with an infinite event observable
    it.effect('should work with an infinite event observable', () => Effect.gen(function* () {
      const scheduler = virtualScheduler();
      interface Events {
        type: 'COUNT';
        value: number;
      }
      const obsMachine = createMachine({
        types: {} as { context: { count: number | undefined }; events: Events },
        id: 'obs',
        initial: 'counting',
        context: { count: undefined },
        states: {
          counting: {
            invoke: {
              src: fromEventObservable(() =>
                interval(10, scheduler).pipe(map((value) => ({ type: 'COUNT', value })))
              )
            },
            on: {
              COUNT: {
                actions: assign({ count: ({ event }) => event.value })
              }
            },
            always: {
              target: 'counted',
              guard: ({ context }) => context.count === 5
            }
          },
          counted: {
            type: 'final'
          }
        }
      });

      const service = (yield* createActor(obsMachine));
      const completed = yield* completion(service);
      (yield* service.start);
      yield* withVirtualTime(scheduler, Fiber.join(completed));
    }));

    // upstream: test/invoke.test.ts > invoke > with event observables > should work with a finite event observable
    it.effect('should work with a finite event observable', () => Effect.gen(function* () {
      const scheduler = virtualScheduler();
      interface Ctx {
        count: number | undefined;
      }
      interface Events {
        type: 'COUNT';
        value: number;
      }
      const obsMachine = createMachine({
        types: {} as { context: Ctx; events: Events },
        id: 'obs',
        initial: 'counting',
        context: {
          count: undefined
        },
        states: {
          counting: {
            invoke: {
              src: fromEventObservable(() =>
                interval(10, scheduler).pipe(
                  take(5),
                  map((value) => ({ type: 'COUNT', value }))
                )
              ),
              onDone: {
                target: 'counted',
                guard: ({ context }) => context.count === 4
              }
            },
            on: {
              COUNT: {
                actions: assign({
                  count: ({ event }) => event.value
                })
              }
            }
          },
          counted: {
            type: 'final'
          }
        }
      });

      const actor = (yield* createActor(obsMachine));
      const completed = yield* completion(actor);
      (yield* actor.start);
      yield* withVirtualTime(scheduler, Fiber.join(completed));
    }));

    // upstream: test/invoke.test.ts > invoke > with event observables > should receive an emitted error
    it.effect('should receive an emitted error', () => Effect.gen(function* () {
      const scheduler = virtualScheduler();
      interface Ctx {
        count: number | undefined;
      }
      interface Events {
        type: 'COUNT';
        value: number;
      }
      const obsMachine = createMachine({
        types: {} as { context: Ctx; events: Events },
        id: 'obs',
        initial: 'counting',
        context: { count: undefined },
        states: {
          counting: {
            invoke: {
              src: fromEventObservable(() =>
                interval(10, scheduler).pipe(
                  map((value) => {
                    if (value === 5) {
                      throw new Error('some error');
                    }

                    return { type: 'COUNT', value };
                  })
                )
              ),
              onError: {
                target: 'success',
                guard: ({ context, event }) => {
                  expect((event.error as any).message).toEqual('some error');
                  return (
                    context.count === 4 &&
                    (event.error as any).message === 'some error'
                  );
                }
              }
            },
            on: {
              COUNT: {
                actions: assign({ count: ({ event }) => event.value })
              }
            }
          },
          success: {
            type: 'final'
          }
        }
      });

      const actor = (yield* createActor(obsMachine));
      const completed = yield* completion(actor);
      (yield* actor.start);
      yield* withVirtualTime(scheduler, Fiber.join(completed));
    }));

    // upstream: test/invoke.test.ts > invoke > with event observables > should work with input
    it.effect('should work with input', () => Effect.gen(function* () {
      // upstream asserts inside the action and resolves a promise; here the action hands the
      // event value to the test through a Deferred, and the test makes the same assertion (a
      // throw inside the action would only set the actor's error status, SD-4)
      const received = yield* Deferred.make<unknown>();
      const machine = createMachine({
        invoke: {
          src: fromEventObservable(({ input }) =>
            of({
              type: 'obs.event',
              value: input
            })
          ),
          input: 42
        },
        on: {
          'obs.event': {
            actions: ({ event }) => {
              Deferred.doneUnsafe(received, Effect.succeed(event.value));
            }
          }
        }
      });

      (yield* Effect.tap(createActor(machine), (a) => a.start));
      expect(yield* Deferred.await(received)).toEqual(42);
    }));
  });

  describe('with logic', () => {
    // upstream: test/invoke.test.ts > invoke > with logic > should work with actor logic
    it.effect('should work with actor logic', () => Effect.gen(function* () {
      // Upstream writes the logic as an object whose methods return values. The port's logic
      // interface returns Effects and `makeActorLogic` builds it (SPEC context.md, API
      // patterns), with the snapshot type as its type argument (the annotation alone does not
      // reach the factory's parameters); a snapshot carries the port's `SnapshotTypeId`, so
      // the initial one starts from `Snapshot.active()`, whose `output` and `error` are
      // Options (D8)
      const countLogic: ActorLogic<
        Snapshot<undefined> & { context: number },
        EventObject
      > = makeActorLogic<Snapshot<undefined> & { context: number }, EventObject, unknown>({
        transition: (state, event) =>
          Effect.sync(() => {
            if (event.type === 'INC') {
              return {
                ...state,
                context: state.context + 1
              };
            } else if (event.type === 'DEC') {
              return {
                ...state,
                context: state.context - 1
              };
            }
            return state;
          }),
        getInitialSnapshot: () =>
          Effect.succeed({
            ...Snapshot.active(),
            context: 0
          }),
        getPersistedSnapshot: (s) => Effect.succeed(s)
      });

      const countMachine = createMachine({
        invoke: {
          id: 'count',
          src: countLogic
        },
        on: {
          INC: {
            actions: forwardTo('count')
          }
        }
      });

      const countService = (yield* createActor(countMachine));
      (yield* countService.start);

      (yield* countService.send({ type: 'INC' }));
      (yield* countService.send({ type: 'INC' }));

      // upstream resolves from a subscriber of the parent once the child's context is 2: it
      // delivers the forwarded INC to the child before it publishes the parent snapshot.
      // `forwardTo` enqueues here (SD-23), so the parent can publish first and never again;
      // the test reads the child's snapshot instead, yielding (bounded) until it is 2
      const childContext = Effect.gen(function* () {
        const child = (yield* countService.getSnapshot).children['count'];
        return child === undefined ? undefined : (yield* child.getSnapshot).context;
      });
      yield* yieldUntil(() => Effect.map(childContext, (context) => context === 2));
      expect(yield* childContext).toBe(2);
    }));

    // upstream: test/invoke.test.ts > invoke > with logic > logic should have reference to the parent
    it.effect('logic should have reference to the parent', () => Effect.gen(function* () {
      // Upstream writes the logic as an object whose methods return values and receive the
      // actor scope as an argument. The port's logic interface returns Effects and reads its
      // actor scope from the Effect context (`ActorScope`), and `makeActorLogic` builds it
      // (SPEC context.md, API patterns), with the snapshot type as its type argument and the
      // snapshot from `Snapshot.active()` (see "should work with actor logic");
      // `self._parent` is an `Option`, and the send from inside the actor enqueues (SD-23)
      const pongLogic: ActorLogic<Snapshot<undefined>, EventObject> = makeActorLogic<Snapshot<undefined>, EventObject, unknown>({
        transition: (state, event) =>
          Effect.gen(function* () {
            const { self } = yield* ActorScope;
            if (event.type === 'PING') {
              yield* Option.match(self._parent, {
                onNone: () => Effect.void,
                onSome: (parent) => parent.send({ type: 'PONG' })
              });
            }

            return state;
          }),
        getInitialSnapshot: () =>
          Effect.succeed(Snapshot.active()),
        getPersistedSnapshot: (s) => Effect.succeed(s)
      });

      const pingMachine = createMachine({
        initial: 'waiting',
        states: {
          waiting: {
            entry: sendTo('ponger', { type: 'PING' }),
            invoke: {
              id: 'ponger',
              src: pongLogic
            },
            on: {
              PONG: 'success'
            }
          },
          success: {
            type: 'final'
          }
        }
      });

      const pingService = (yield* createActor(pingMachine));
      const completed = yield* completion(pingService);
      (yield* pingService.start);
      yield* Fiber.join(completed);
    }));
  });

  describe('with transition functions', () => {
    // upstream: test/invoke.test.ts > invoke > with transition functions > should work with a transition function
    it.effect('should work with a transition function', () => Effect.gen(function* () {
      const countReducer = (
        count: number,
        event: { type: 'INC' } | { type: 'DEC' }
      ): number => {
        if (event.type === 'INC') {
          return count + 1;
        } else if (event.type === 'DEC') {
          return count - 1;
        }
        return count;
      };

      const countMachine = createMachine({
        invoke: {
          id: 'count',
          src: fromTransition(countReducer, 0)
        },
        on: {
          INC: {
            actions: forwardTo('count')
          }
        }
      });

      const countService = (yield* createActor(countMachine));
      (yield* countService.start);

      (yield* countService.send({ type: 'INC' }));
      (yield* countService.send({ type: 'INC' }));

      // upstream resolves from a subscriber of the parent once the child's context is 2: it
      // delivers the forwarded INC to the child before it publishes the parent snapshot.
      // `forwardTo` enqueues here (SD-23), so the parent can publish first and never again;
      // the test reads the child's snapshot instead, yielding (bounded) until it is 2
      const childContext = Effect.gen(function* () {
        const child = (yield* countService.getSnapshot).children['count'];
        return child === undefined ? undefined : (yield* child.getSnapshot).context;
      });
      yield* yieldUntil(() => Effect.map(childContext, (context) => context === 2));
      expect(yield* childContext).toBe(2);
    }));

    // upstream: test/invoke.test.ts > invoke > with transition functions > should schedule events in a FIFO queue
    it.effect('should schedule events in a FIFO queue', () => Effect.gen(function* () {
      type CountEvents = { type: 'INC' } | { type: 'DOUBLE' };

      const countReducer = (
        count: number,
        event: CountEvents,
        // the reducer's third argument is the port's `TransitionActorScope`: the root
        // `ActorScope` is the Effect service that carries an actor's scope (SPEC context.md,
        // API patterns), not upstream's generic type
        { self }: TransitionActorScope<any, CountEvents>
      ): number => {
        if (event.type === 'INC') {
          // `self.send` returns an Effect (D6) and the reducer is synchronous, so the reducer
          // forks the send; a send from inside the actor enqueues (SD-23)
          Effect.runFork(self.send({ type: 'DOUBLE' }));
          return count + 1;
        }
        if (event.type === 'DOUBLE') {
          return count * 2;
        }

        return count;
      };

      const countMachine = createMachine({
        invoke: {
          id: 'count',
          src: fromTransition(countReducer, 0)
        },
        on: {
          INC: {
            actions: forwardTo('count')
          }
        }
      });

      const countService = (yield* createActor(countMachine));
      (yield* countService.start);

      (yield* countService.send({ type: 'INC' }));

      // upstream resolves from a subscriber of the parent once the child's context is 2; the
      // forwarded INC and the child's own DOUBLE are enqueued here (SD-23), so the test reads
      // the child's snapshot instead, yielding (bounded) until it is 2
      const childContext = Effect.gen(function* () {
        const child = (yield* countService.getSnapshot).children['count'];
        return child === undefined ? undefined : (yield* child.getSnapshot).context;
      });
      yield* yieldUntil(() => Effect.map(childContext, (context) => context === 2));
      expect(yield* childContext).toBe(2);
    }));

    // upstream: test/invoke.test.ts > invoke > with transition functions > should emit onSnapshot
    it.effect('should emit onSnapshot', () => Effect.gen(function* () {
      // upstream resolves a promise from the action; here the action completes a Deferred
      const resolved = yield* Deferred.make<void>();
      const doublerLogic = fromTransition(
        (_, event: { type: 'update'; value: number }) => event.value * 2,
        0
      );
      const machine = createMachine(
        {
          types: {} as {
            actors: { src: 'doublerLogic'; logic: typeof doublerLogic };
          },
          invoke: {
            id: 'doubler',
            src: 'doublerLogic',
            onSnapshot: {
              actions: ({ event }) => {
                if (event.snapshot.context === 42) {
                  Deferred.doneUnsafe(resolved, Effect.void);
                }
              }
            }
          },
          entry: sendTo('doubler', { type: 'update', value: 21 }, { delay: 10 })
        },
        {
          actors: {
            doublerLogic
          }
        }
      );

      (yield* Effect.tap(createActor(machine), (a) => a.start));
      // the delayed `sendTo` fires on the Effect clock (1 ms steps until resolved)
      yield* withClock(Deferred.await(resolved));
    }));
  });

  describe('with machines', () => {
    const pongMachine = createMachine({
      id: 'pong',
      initial: 'active',
      states: {
        active: {
          on: {
            PING: {
              // Sends 'PONG' event to parent machine
              actions: sendParent({ type: 'PONG' })
            }
          }
        }
      }
    });

    // Parent machine
    const pingMachine = createMachine({
      id: 'ping',
      initial: 'innerMachine',
      states: {
        innerMachine: {
          initial: 'active',
          states: {
            active: {
              invoke: {
                id: 'pong',
                src: pongMachine
              },
              // Sends 'PING' event to child machine with ID 'pong'
              entry: sendTo('pong', { type: 'PING' }),
              on: {
                PONG: 'innerSuccess'
              }
            },
            innerSuccess: {
              type: 'final'
            }
          },
          onDone: 'success'
        },
        success: { type: 'final' }
      }
    });

    // upstream: test/invoke.test.ts > invoke > with machines > should create invocations from machines in nested states
    it.effect('should create invocations from machines in nested states', () => Effect.gen(function* () {
      const actor = (yield* createActor(pingMachine));
      const completed = yield* completion(actor);
      (yield* actor.start);
      yield* Fiber.join(completed);
    }));

    // upstream: test/invoke.test.ts > invoke > with machines > should emit onSnapshot
    it.effect('should emit onSnapshot', () => Effect.gen(function* () {
      // upstream resolves a promise from the action; here the action completes a Deferred
      const resolved = yield* Deferred.make<void>();
      const childMachine = createMachine({
        initial: 'a',
        states: {
          a: {
            after: {
              10: 'b'
            }
          },
          b: {}
        }
      });
      const machine = createMachine(
        {
          types: {} as {
            actors: { src: 'childMachine'; logic: typeof childMachine };
          },
          invoke: {
            src: 'childMachine',
            onSnapshot: {
              actions: ({ event }) => {
                if (event.snapshot.value === 'b') {
                  Deferred.doneUnsafe(resolved, Effect.void);
                }
              }
            }
          }
        },
        {
          actors: {
            childMachine
          }
        }
      );

      (yield* Effect.tap(createActor(machine), (a) => a.start));
      // the child's `after` fires on the Effect clock (1 ms steps until resolved)
      yield* withClock(Deferred.await(resolved));
    }));
  });

  describe('multiple simultaneous services', () => {
    const multiple = createMachine({
      types: {} as { context: { one?: string; two?: string } },
      id: 'machine',
      initial: 'one',

      context: {},

      on: {
        ONE: {
          actions: assign({
            one: 'one'
          })
        },

        TWO: {
          actions: assign({
            two: 'two'
          }),
          target: '.three'
        }
      },

      states: {
        one: {
          initial: 'two',
          states: {
            two: {
              invoke: [
                {
                  id: 'child',
                  src: fromCallback(({ sendBack }) => sendBack({ type: 'ONE' }))
                },
                {
                  id: 'child2',
                  src: fromCallback(({ sendBack }) => sendBack({ type: 'TWO' }))
                }
              ]
            }
          }
        },
        three: {
          type: 'final'
        }
      }
    });

    // upstream: test/invoke.test.ts > invoke > multiple simultaneous services > should start all services at once
    it.effect('should start all services at once', () => Effect.gen(function* () {
      const service = (yield* createActor(multiple));
      // the end of the `changes` stream stands for the observer's `complete` (D6, DEV-3)
      const completed = yield* service.changes.pipe(
        Stream.runDrain,
        Effect.andThen(Effect.gen(function* () {
          expect((yield* service.getSnapshot).context).toEqual({
            one: 'one',
            two: 'two'
          });
        })),
        Effect.forkScoped({ startImmediately: true })
      );

      (yield* service.start);
      yield* Fiber.join(completed);
    }));

    const parallel = createMachine({
      types: {} as { context: { one?: string; two?: string } },
      id: 'machine',
      initial: 'one',

      context: {},

      on: {
        ONE: {
          actions: assign({
            one: 'one'
          })
        },

        TWO: {
          actions: assign({
            two: 'two'
          })
        }
      },

      after: {
        // allow both invoked services to get a chance to send their events
        // and don't depend on a potential race condition (with an immediate transition)
        10: '.three'
      },

      states: {
        one: {
          initial: 'two',
          states: {
            two: {
              type: 'parallel',
              states: {
                a: {
                  invoke: {
                    id: 'child',
                    src: fromCallback(({ sendBack }) =>
                      sendBack({ type: 'ONE' })
                    )
                  }
                },
                b: {
                  invoke: {
                    id: 'child2',
                    src: fromCallback(({ sendBack }) =>
                      sendBack({ type: 'TWO' })
                    )
                  }
                }
              }
            }
          }
        },
        three: {
          type: 'final'
        }
      }
    });

    // upstream: test/invoke.test.ts > invoke > multiple simultaneous services > should run services in parallel
    it.effect('should run services in parallel', () => Effect.gen(function* () {
      const service = (yield* createActor(parallel));
      // the end of the `changes` stream stands for the observer's `complete` (D6, DEV-3)
      const completed = yield* service.changes.pipe(
        Stream.runDrain,
        Effect.andThen(Effect.gen(function* () {
          expect((yield* service.getSnapshot).context).toEqual({
            one: 'one',
            two: 'two'
          });
        })),
        Effect.forkScoped({ startImmediately: true })
      );

      (yield* service.start);
      // as upstream's 10 ms `after` intends, both callbacks get their chance to send (their
      // events enqueue, SD-23) before the delay elapses on the Effect clock
      yield* settle;
      yield* TestClock.adjust("10 millis");
      yield* Fiber.join(completed);
    }));

    // upstream: test/invoke.test.ts > invoke > multiple simultaneous services > should not invoke an actor if it gets stopped immediately by transitioning away in immediate microstep
    it.effect('should not invoke an actor if it gets stopped immediately by transitioning away in immediate microstep', () => Effect.gen(function* () {
      // Since an actor will be canceled when the state machine leaves the invoking state
      // it does not make sense to start an actor in a state that will be exited immediately
      let actorStarted = false;

      const transientMachine = createMachine({
        id: 'transient',
        initial: 'active',
        states: {
          active: {
            invoke: {
              id: 'doNotInvoke',
              src: fromCallback(() => {
                actorStarted = true;
              })
            },
            always: 'inactive'
          },
          inactive: {}
        }
      });

      const service = (yield* createActor(transientMachine));

      (yield* service.start);
      // a started callback would run in its own fiber: let it show before the assertion
      yield* settle;

      expect(actorStarted).toBe(false);
    }));

    // tslint:disable-next-line: max-line-length
    // upstream: test/invoke.test.ts > invoke > multiple simultaneous services > should not invoke an actor if it gets stopped immediately by transitioning away in subsequent microstep
    it.effect('should not invoke an actor if it gets stopped immediately by transitioning away in subsequent microstep', () => Effect.gen(function* () {
      // Since an actor will be canceled when the state machine leaves the invoking state
      // it does not make sense to start an actor in a state that will be exited immediately
      let actorStarted = false;

      const transientMachine = createMachine({
        initial: 'withNonLeafInvoke',
        states: {
          withNonLeafInvoke: {
            invoke: {
              id: 'doNotInvoke',
              src: fromCallback(() => {
                actorStarted = true;
              })
            },
            initial: 'first',
            states: {
              first: {
                always: 'second'
              },
              second: {
                always: '#inactive'
              }
            }
          },
          inactive: {
            id: 'inactive'
          }
        }
      });

      const service = (yield* createActor(transientMachine));

      (yield* service.start);
      // a started callback would run in its own fiber: let it show before the assertion
      yield* settle;

      expect(actorStarted).toBe(false);
    }));

    // upstream: test/invoke.test.ts > invoke > multiple simultaneous services > should invoke a service if other service gets stopped in subsequent microstep (#1180)
    it.effect('should invoke a service if other service gets stopped in subsequent microstep (#1180)', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'running',
        states: {
          running: {
            type: 'parallel',
            states: {
              one: {
                initial: 'active',
                on: {
                  STOP_ONE: '.idle'
                },
                states: {
                  idle: {},
                  active: {
                    invoke: {
                      id: 'active',
                      src: fromCallback(() => {
                        /* ... */
                      })
                    },
                    on: {
                      NEXT: {
                        actions: raise({ type: 'STOP_ONE' })
                      }
                    }
                  }
                }
              },
              two: {
                initial: 'idle',
                on: {
                  NEXT: '.active'
                },
                states: {
                  idle: {},
                  active: {
                    invoke: {
                      id: 'post',
                      src: fromPromise(() => Promise.resolve(42)),
                      onDone: '#done'
                    }
                  }
                }
              }
            }
          },
          done: {
            id: 'done',
            type: 'final'
          }
        }
      });

      const service = (yield* createActor(machine));
      const completed = yield* completion(service);
      (yield* service.start);

      (yield* service.send({ type: 'NEXT' }));
      yield* Fiber.join(completed);
    }));

    // upstream: test/invoke.test.ts > invoke > multiple simultaneous services > should invoke an actor when reentering invoking state within a single macrostep
    it.effect('should invoke an actor when reentering invoking state within a single macrostep', () => Effect.gen(function* () {
      let actorStartedCount = 0;

      const transientMachine = createMachine({
        types: {} as { context: { counter: number } },
        initial: 'active',
        context: { counter: 0 },
        states: {
          active: {
            invoke: {
              src: fromCallback(() => {
                actorStartedCount++;
              })
            },
            always: [
              {
                guard: ({ context }) => context.counter === 0,
                target: 'inactive'
              }
            ]
          },
          inactive: {
            entry: assign({ counter: ({ context }) => ++context.counter }),
            always: 'active'
          }
        }
      });

      const service = (yield* createActor(transientMachine));

      (yield* service.start);
      // each started callback runs in its own fiber: let them all show before counting
      yield* settle;

      expect(actorStartedCount).toBe(1);
    }));
  });

  // upstream: test/invoke.test.ts > invoke > invoke `src` can be used with invoke `input`
  it.effect('invoke `src` can be used with invoke `input`', () => Effect.gen(function* () {
    const machine = createMachine(
      {
        types: {} as {
          actors: {
            src: 'search';
            logic: PromiseActorLogic<
              number,
              {
                endpoint: string;
              }
            >;
          };
        },
        initial: 'searching',
        states: {
          searching: {
            invoke: {
              src: 'search',
              input: {
                endpoint: 'example.com'
              },
              onDone: 'success'
            }
          },
          success: {
            type: 'final'
          }
        }
      },
      {
        actors: {
          search: fromPromise(async ({ input }) => {
            expect(input.endpoint).toEqual('example.com');

            return 42;
          })
        }
      }
    );
    const actor = (yield* createActor(machine));
    const completed = yield* completion(actor);
    (yield* actor.start);
    yield* Fiber.join(completed);
  }));

  // upstream: test/invoke.test.ts > invoke > invoke `src` can be used with dynamic invoke `input`
  it.effect('invoke `src` can be used with dynamic invoke `input`', () => Effect.gen(function* () {
    const machine = createMachine(
      {
        types: {} as {
          context: { url: string };
          actors: {
            src: 'search';
            logic: PromiseActorLogic<
              number,
              {
                endpoint: string;
              }
            >;
          };
        },
        initial: 'searching',
        context: {
          url: 'example.com'
        },
        states: {
          searching: {
            invoke: {
              src: 'search',
              input: ({ context }) => ({ endpoint: context.url }),
              onDone: 'success'
            }
          },
          success: {
            type: 'final'
          }
        }
      },
      {
        actors: {
          search: fromPromise(async ({ input }) => {
            expect(input.endpoint).toEqual('example.com');

            return 42;
          })
        }
      }
    );

    const actor = (yield* createActor(machine));
    const completed = yield* completion(actor);
    (yield* actor.start);
    yield* Fiber.join(completed);
  }));

  // upstream: test/invoke.test.ts > invoke > invoke generated ID should be predictable based on the state node where it is defined
  it.effect('invoke generated ID should be predictable based on the state node where it is defined', () => Effect.gen(function* () {
    const machine = createMachine(
      {
        initial: 'a',
        states: {
          a: {
            invoke: {
              src: 'someSrc',
              onDone: {
                guard: ({ event }) => {
                  // invoke ID should not be 'someSrc'
                  const expectedType = 'xstate.done.actor.0.(machine).a';
                  expect(event.type).toEqual(expectedType);
                  return event.type === expectedType;
                },
                target: 'b'
              }
            }
          },
          b: {
            type: 'final'
          }
        }
      },
      {
        actors: {
          someSrc: fromPromise(() => Promise.resolve())
        }
      }
    );

    const actor = (yield* createActor(machine));
    const completed = yield* completion(actor);
    (yield* actor.start);
    yield* Fiber.join(completed);
  }));

  // upstream: test/invoke.test.ts > invoke > invoke config defined as %s should register unique and predictable child in state
  it.effect.each<[string, any]>([
    ['src with string reference', { src: 'someSrc' }],
    // ['machine', createMachine({ id: 'someId' })],
    [
      'src containing a machine directly',
      { src: createMachine({ id: 'someId' }) }
    ],
    [
      'src containing a callback actor directly',
      {
        src: fromCallback(() => {
          /* ... */
        })
      }
    ]
  ])(
    'invoke config defined as %s should register unique and predictable child in state',
    ([_type, invokeConfig]) => Effect.gen(function* () {
      const machine = createMachine(
        {
          id: 'machine',
          initial: 'a',
          states: {
            a: {
              invoke: invokeConfig
            }
          }
        },
        {
          actors: {
            someSrc: fromCallback(() => {
              /* ... */
            })
          }
        }
      );

      expect(
        (yield* (yield* createActor(machine)).getSnapshot).children['0.machine.a']
      ).toBeDefined();
    })
  );

  // https://github.com/statelyai/xstate/issues/464
  // upstream: test/invoke.test.ts > invoke > xstate.done.actor events should only select onDone transition on the invoking state when invokee is referenced using a string
  it.effect('xstate.done.actor events should only select onDone transition on the invoking state when invokee is referenced using a string', () => Effect.gen(function* () {
    let counter = 0;
    let invoked = false;

    const createSingleState = (): any => ({
      initial: 'fetch',
      states: {
        fetch: {
          invoke: {
            src: 'fetchSmth',
            onDone: {
              actions: 'handleSuccess'
            }
          }
        }
      }
    });

    const testMachine = createMachine(
      {
        type: 'parallel',
        states: {
          first: createSingleState(),
          second: createSingleState()
        }
      },
      {
        actions: {
          handleSuccess: () => {
            ++counter;
          }
        },
        actors: {
          fetchSmth: fromPromise(() => {
            if (invoked) {
              // create a promise that won't ever resolve for the second invoking state
              return new Promise(() => {
                /* ... */
              });
            }
            invoked = true;
            return Promise.resolve(42);
          })
        }
      }
    );

    (yield* Effect.tap(createActor(testMachine), (a) => a.start));

    // check within a macrotask so all promise-induced microtasks have a chance to resolve first
    // (here: give every enqueued delivery the chance to run, never on wall-clock time)
    yield* settle;
    expect(counter).toEqual(1);
  }));

  // upstream: test/invoke.test.ts > invoke > xstate.done.actor events should have unique names when invokee is a machine with an id property
  it.effect('xstate.done.actor events should have unique names when invokee is a machine with an id property', () => Effect.gen(function* () {
    const actual: AnyEventObject[] = [];

    const childMachine = createMachine({
      id: 'child',
      initial: 'a',
      states: {
        a: {
          invoke: {
            src: fromPromise(() => {
              return Promise.resolve(42);
            }),
            onDone: 'b'
          }
        },
        b: {
          type: 'final'
        }
      }
    });

    const createSingleState = (): any => ({
      initial: 'fetch',
      states: {
        fetch: {
          invoke: {
            src: childMachine
          }
        }
      }
    });

    const testMachine = createMachine({
      type: 'parallel',
      states: {
        first: createSingleState(),
        second: createSingleState()
      },
      on: {
        '*': {
          actions: ({ event }) => {
            actual.push(event);
          }
        }
      }
    });

    (yield* Effect.tap(createActor(testMachine), (a) => a.start));

    // check within a macrotask so all promise-induced microtasks have a chance to resolve first
    // (here: give every enqueued delivery the chance to run, never on wall-clock time)
    yield* settle;
    // `event.output` of `xstate.done.actor.*` is an `Option`: the child machine has no
    // output, which is `Option.none()` (D8, SD-5, SD-7)
    expect(actual).toEqual([
      {
        type: 'xstate.done.actor.0.(machine).first.fetch',
        output: Option.none(),
        actorId: '0.(machine).first.fetch'
      },
      {
        type: 'xstate.done.actor.0.(machine).second.fetch',
        output: Option.none(),
        actorId: '0.(machine).second.fetch'
      }
    ]);
  }));

  // upstream: test/invoke.test.ts > invoke > should get reinstantiated after reentering the invoking state in a microstep
  it.effect('should get reinstantiated after reentering the invoking state in a microstep', () => Effect.gen(function* () {
    let invokeCount = 0;

    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          invoke: {
            src: fromCallback(() => {
              invokeCount++;
            })
          },
          on: {
            GO_AWAY_AND_REENTER: 'b'
          }
        },
        b: {
          always: 'a'
        }
      }
    });
    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* service.send({ type: 'GO_AWAY_AND_REENTER' }));
    // each started callback runs in its own fiber: let them all show before counting
    yield* settle;

    expect(invokeCount).toBe(2);
  }));

  // upstream: test/invoke.test.ts > invoke > invocations should be stopped when the machine reaches done state
  it.effect('invocations should be stopped when the machine reaches done state', () => Effect.gen(function* () {
    let disposed = false;
    const machine = createMachine({
      initial: 'a',
      invoke: {
        src: fromCallback(() => {
          return () => {
            disposed = true;
          };
        })
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
      }
    });
    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));
    // upstream runs the callback inside `start`; here it runs in its own fiber: let it
    // return its disposal function before FINISH
    yield* settle;

    (yield* service.send({ type: 'FINISH' }));
    expect(disposed).toBe(true);
  }));

  // upstream: test/invoke.test.ts > invoke > deep invocations should be stopped when the machine reaches done state
  it.effect('deep invocations should be stopped when the machine reaches done state', () => Effect.gen(function* () {
    let disposed = false;
    const childMachine = createMachine({
      invoke: {
        src: fromCallback(() => {
          return () => {
            disposed = true;
          };
        })
      }
    });

    const machine = createMachine({
      initial: 'a',
      invoke: {
        src: childMachine
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
      }
    });
    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));
    // upstream runs the callback inside `start`; here it runs in its own fiber: let it
    // return its disposal function before FINISH
    yield* settle;

    (yield* service.send({ type: 'FINISH' }));
    expect(disposed).toBe(true);
  }));

  // upstream: test/invoke.test.ts > invoke > root invocations should restart on root reentering transitions
  it.effect('root invocations should restart on root reentering transitions', () => Effect.gen(function* () {
    let count = 0;

    const machine = createMachine({
      id: 'root',
      invoke: {
        src: fromPromise(() => {
          count++;
          return Promise.resolve(42);
        })
      },
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

    (yield* service.send({ type: 'EVENT' }));
    // each promise creator runs in its child's own fiber: let them all show before counting
    yield* settle;

    expect(count).toEqual(2);
  }));

  // upstream: test/invoke.test.ts > invoke > should be able to restart an invoke when reentering the invoking state
  it.effect('should be able to restart an invoke when reentering the invoking state', () => Effect.gen(function* () {
    const actual: string[] = [];
    let invokeCounter = 0;

    const machine = createMachine({
      initial: 'inactive',
      states: {
        inactive: {
          on: { ACTIVATE: 'active' }
        },
        active: {
          invoke: {
            src: fromCallback(() => {
              const localId = ++invokeCounter;
              actual.push(`start ${localId}`);
              return () => {
                actual.push(`stop ${localId}`);
              };
            })
          },
          on: {
            REENTER: {
              target: 'active',
              reenter: true
            }
          }
        }
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* service.send({
      type: 'ACTIVATE'
    }));
    // upstream starts the callback inside `send`; here it runs in its own fiber: let it
    // start before the log is cleared
    yield* settle;

    actual.length = 0;

    (yield* service.send({
      type: 'REENTER'
    }));
    // the new callback starts in its own fiber: let it show
    yield* settle;

    expect(actual).toEqual(['stop 1', 'start 2']);
  }));

  // upstream: test/invoke.test.ts > invoke > should be able to receive a delayed event sent by the entry action of the invoking state
  it.effect('should be able to receive a delayed event sent by the entry action of the invoking state', () => Effect.gen(function* () {
    const child = createMachine({
      types: {} as {
        events: {
          type: 'PING';
          origin: ActorRef<Snapshot<unknown>, { type: 'PONG' }>;
        };
      },
      on: {
        PING: {
          actions: sendTo(({ event }) => event.origin, { type: 'PONG' })
        }
      }
    });
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            NEXT: 'b'
          }
        },
        b: {
          invoke: {
            id: 'foo',
            src: child
          },
          entry: sendTo('foo', ({ self }) => ({ type: 'PING', origin: self }), {
            delay: 1
          }),
          on: {
            PONG: 'c'
          }
        },
        c: {
          type: 'final'
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'NEXT' }));
    // upstream sleeps 3 ms of real time; the Effect clock advances 3 ms here, then the PING
    // and PONG deliveries (enqueued, SD-23) get their chance to run (bounded yields)
    yield* TestClock.adjust("3 millis");
    yield* yieldUntil(() =>
      Effect.map(actorRef.getSnapshot, (snapshot) => snapshot.status === 'done')
    );
    expect((yield* actorRef.getSnapshot).status).toBe('done');
  }));
});

describe('invoke input', () => {
  // upstream: test/invoke.test.ts > invoke input > should provide input to an actor creator
  it.effect('should provide input to an actor creator', () => Effect.gen(function* () {
    const machine = createMachine(
      {
        types: {} as {
          context: { count: number };
          actors: {
            src: 'stringService';
            logic: PromiseActorLogic<
              boolean,
              {
                staticVal: string;
                newCount: number;
              }
            >;
          };
        },
        initial: 'pending',
        context: {
          count: 42
        },
        states: {
          pending: {
            invoke: {
              src: 'stringService',
              input: ({ context }) => ({
                staticVal: 'hello',
                newCount: context.count * 2
              }),
              onDone: 'success'
            }
          },
          success: {
            type: 'final'
          }
        }
      },
      {
        actors: {
          stringService: fromPromise(({ input }) => {
            expect(input).toEqual({ newCount: 84, staticVal: 'hello' });

            return Promise.resolve(true);
          })
        }
      }
    );

    const service = (yield* createActor(machine));
    const completed = yield* completion(service);

    (yield* service.start);
    yield* Fiber.join(completed);
  }));

  // upstream: test/invoke.test.ts > invoke input > should provide self to input mapper
  it.effect('should provide self to input mapper', () => Effect.gen(function* () {
    // upstream asserts inside the callback and resolves a promise; here the callback hands
    // its input to the test through a Deferred, and the test makes the same assertion (a
    // throw inside the callback would only set the actor's error status, SD-4)
    const received = yield* Deferred.make<any>();
    const machine = createMachine({
      invoke: {
        src: fromCallback(({ input }) => {
          Deferred.doneUnsafe(received, Effect.succeed(input));
        }),
        input: ({ self }) => ({
          responder: self
        })
      }
    });

    (yield* Effect.tap(createActor(machine), (a) => a.start));
    const input = yield* Deferred.await(received);
    expect(input.responder.send).toBeDefined();
  }));
});
