import { describe, expect, it, vi } from "@effect/vitest"
import { Duration, Effect, Equal, Exit, Fiber, Option, Scope, Stream } from "effect"
import { TestClock } from "effect/testing"
import { EMPTY, VirtualTimeScheduler, interval, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { sendParent } from "../../src/index.js";
import { assign } from "../../src/index.js";
import { raise } from "../../src/index.js";
import { sendTo } from "../../src/index.js";
import { CallbackActorRef, fromCallback } from "../../src/index.js";
import {
  fromEventObservable,
  fromObservable
} from "../../src/index.js";
import {
  PromiseActorLogic,
  PromiseActorRef,
  fromPromise
} from "../../src/index.js";
import {
  ActorLogic,
  ActorRef,
  ActorRefFrom,
  ActorScope,
  AnyActorRef,
  EventObject,
  Observer,
  Snapshot,
  Subscribable,
  createActor,
  createMachine,
  makeActorLogic,
  toEffect,
  waitFor,
  stopChild
} from "../../src/index.js";
import { setup } from "../../src/index.js";

// Upstream delivers the events that actors send to each other (`sendParent`, `sendTo`,
// `forwardTo`, done and error notifications, `sendBack`) before the outer call returns. Here a
// send from inside an actor enqueues without waiting (SD-23), and each child runs in its own
// fiber (D12), so a test yields its fiber, at most 100 times and never on wall-clock time,
// until the delivery it needs has happened.
const yieldUntil = (done: () => boolean | Effect.Effect<boolean>) =>
  Effect.yieldNow.pipe(Effect.repeat({ until: done, times: 100 }));

// Before an assertion that something did NOT happen (or happened exactly once): give every
// enqueued delivery the chance to run, so that the assertion is not vacuous.
const settle = yieldUntil(() => false);

// Upstream's rxjs `interval(10)` sources run on the host timer, so those tests wait tens of
// milliseconds of real time (and one sleeps 15 ms). The rewrites never wait on wall-clock
// time: each interval runs on an rxjs `VirtualTimeScheduler`, and `virtualTime(scheduler)`
// gives the test an `advance(ms)` that moves that clock forward, runs the emissions due by
// then, and lets every actor take them (`settle`) before the next step, as the 10 ms gaps of
// the host timer do upstream. A wait races `Effect.forever(advance(10))`.
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

// Upstream user code (a promise executor, a callback actor's `receive` handler) defers work
// with `setTimeout(fn, ms)` on the host timer. The rewrites never wait on wall-clock time:
// `effectTimers` gives that code a `setTimeout` stand-in that runs `fn` after `ms` of
// Effect-clock time, in a fiber of the test's scope, so the test fires it with
// `TestClock.adjust`.
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

describe('spawning machines', () => {
  const context = {
    todoRefs: {} as Record<string, AnyActorRef>
  };

  type TodoEvent =
    | {
        type: 'ADD';
        id: number;
      }
    | {
        type: 'SET_COMPLETE';
        id: number;
      }
    | {
        type: 'TODO_COMPLETED';
      };

  // Adaptation: https://github.com/p-org/P/wiki/PingPong-program
  type PingPongEvent =
    | { type: 'PING' }
    | { type: 'PONG' }
    | { type: 'SUCCESS' };

  const serverMachine = createMachine({
    types: {} as {
      events: PingPongEvent;
    },
    id: 'server',
    initial: 'waitPing',
    states: {
      waitPing: {
        on: {
          PING: 'sendPong'
        }
      },
      sendPong: {
        entry: [sendParent({ type: 'PONG' }), raise({ type: 'SUCCESS' })],
        on: {
          SUCCESS: 'waitPing'
        }
      }
    }
  });

  interface ClientContext {
    server?: ActorRef<Snapshot<unknown>, PingPongEvent>;
  }

  const clientMachine = createMachine({
    types: {} as { context: ClientContext; events: PingPongEvent },
    id: 'client',
    initial: 'init',
    context: {
      server: undefined
    },
    states: {
      init: {
        entry: [
          assign({
            server: ({ spawn }) => spawn(serverMachine)
          }),
          raise({ type: 'SUCCESS' })
        ],
        on: {
          SUCCESS: 'sendPing'
        }
      },
      sendPing: {
        entry: [
          sendTo(({ context }) => context.server!, { type: 'PING' }),
          raise({ type: 'SUCCESS' })
        ],
        on: {
          SUCCESS: 'waitPong'
        }
      },
      waitPong: {
        on: {
          PONG: 'complete'
        }
      },
      complete: {
        type: 'final'
      }
    }
  });

  // upstream: test/actor.test.ts > spawning machines > should spawn machines
  it.effect('should spawn machines', () => Effect.gen(function* () {
    const todoMachine = createMachine({
      id: 'todo',
      initial: 'incomplete',
      states: {
        incomplete: {
          on: { SET_COMPLETE: 'complete' }
        },
        complete: {
          entry: sendParent({ type: 'TODO_COMPLETED' })
        }
      }
    });

    const todosMachine = createMachine({
      types: {} as {
        context: typeof context;
        events: TodoEvent;
      },
      id: 'todos',
      context,
      initial: 'active',
      states: {
        active: {
          on: {
            TODO_COMPLETED: 'success'
          }
        },
        success: {
          type: 'final'
        }
      },
      on: {
        ADD: {
          actions: assign({
            todoRefs: ({ context, event, spawn }) => ({
              ...context.todoRefs,
              [event.id]: spawn(todoMachine)
            })
          })
        },
        SET_COMPLETE: {
          actions: sendTo(
            ({ context, event }) => {
              return context.todoRefs[event.id];
            },
            { type: 'SET_COMPLETE' }
          )
        }
      }
    });
    const service = (yield* createActor(todosMachine));
    (yield* service.start);

    (yield* service.send({ type: 'ADD', id: 42 }));
    (yield* service.send({ type: 'SET_COMPLETE', id: 42 }));
    // upstream resolves on the observer's `complete` (observer objects are not ported, D6,
    // DEV-3); toEffect waits for the actor to finish (SD-19) and fails if it errors instead
    yield* toEffect(service);
  }));

  // upstream: test/actor.test.ts > spawning machines > should spawn referenced machines
  it.effect('should spawn referenced machines', () => Effect.gen(function* () {
    const childMachine = createMachine({
      entry: sendParent({ type: 'DONE' })
    });

    const parentMachine = createMachine(
      {
        context: {
          ref: null! as AnyActorRef
        },
        initial: 'waiting',
        states: {
          waiting: {
            entry: assign({
              ref: ({ spawn }) => spawn('child')
            }),
            on: {
              DONE: 'success'
            }
          },
          success: {
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

    const actor = (yield* createActor(parentMachine));
    (yield* actor.start);
    // upstream takes the child's `sendParent` inside `start`; here it enqueues (SD-23): let
    // the parent take DONE before the upstream assertion
    yield* yieldUntil(() =>
      Effect.map(actor.getSnapshot, (snapshot) => snapshot.value === 'success')
    );
    expect((yield* actor.getSnapshot).value).toBe('success');
  }));

  // upstream: test/actor.test.ts > spawning machines > should allow bidirectional communication between parent/child actors
  it.effect('should allow bidirectional communication between parent/child actors', () => Effect.gen(function* () {
    const actor = (yield* createActor(clientMachine));
    (yield* actor.start);
    // upstream resolves on the observer's `complete`; toEffect waits for the actor to
    // finish (SD-19) and fails if it errors instead
    yield* toEffect(actor);
  }));
});

const aaa = 'dadasda';

describe('spawning promises', () => {
  // upstream: test/actor.test.ts > spawning promises > should be able to spawn a promise
  it.effect('should be able to spawn a promise', () => Effect.gen(function* () {
    const promiseMachine = createMachine({
      types: {} as {
        context: { promiseRef?: PromiseActorRef<string> };
      },
      id: 'promise',
      initial: 'idle',
      context: {
        promiseRef: undefined
      },
      states: {
        idle: {
          entry: assign({
            promiseRef: ({ spawn }) => {
              const ref = spawn(
                fromPromise(
                  () =>
                    new Promise<string>((res) => {
                      res('response');
                    })
                ),
                { id: 'my-promise' }
              );

              return ref;
            }
          }),
          on: {
            'xstate.done.actor.my-promise': {
              target: 'success',
              // `event.output` is an `Option` (D8, DEV-7)
              guard: ({ event }) => Option.contains(event.output, 'response')
            }
          }
        },
        success: {
          type: 'final'
        }
      }
    });

    const promiseService = (yield* createActor(promiseMachine));

    (yield* promiseService.start);
    // upstream resolves on the observer's `complete`; toEffect waits for the actor to
    // finish (SD-19) and fails if it errors instead
    yield* toEffect(promiseService);
  }));

  // upstream: test/actor.test.ts > spawning promises > should be able to spawn a referenced promise
  it.effect('should be able to spawn a referenced promise', () => Effect.gen(function* () {
    const promiseMachine = setup({
      actors: {
        somePromise: fromPromise(() => Promise.resolve('response'))
      }
    }).createMachine({
      types: {} as {
        context: { promiseRef?: PromiseActorRef<string> };
      },
      id: 'promise',
      initial: 'idle',
      context: {
        promiseRef: undefined
      },
      states: {
        idle: {
          entry: assign({
            promiseRef: ({ spawn }) =>
              spawn('somePromise', { id: 'my-promise' })
          }),
          on: {
            'xstate.done.actor.my-promise': {
              target: 'success',
              // `event.output` is an `Option` (D8, DEV-7)
              guard: ({ event }) => Option.contains(event.output, 'response')
            }
          }
        },
        success: {
          type: 'final'
        }
      }
    });

    const promiseService = (yield* createActor(promiseMachine));

    (yield* promiseService.start);
    // upstream resolves on the observer's `complete`; toEffect waits for the actor to
    // finish (SD-19) and fails if it errors instead
    yield* toEffect(promiseService);
  }));
});

describe('spawning callbacks', () => {
  // upstream: test/actor.test.ts > spawning callbacks > should be able to spawn an actor from a callback
  it.effect('should be able to spawn an actor from a callback', () => Effect.gen(function* () {
    // upstream's callback defers `sendBack` with a 10 ms host `setTimeout`; the same delay
    // runs on the Effect clock here (see `effectTimers`)
    const setEffectTimeout = yield* effectTimers;
    const callbackMachine = createMachine({
      types: {} as {
        context: {
          callbackRef?: CallbackActorRef<{ type: 'START' }>;
        };
      },
      id: 'callback',
      initial: 'idle',
      context: {
        callbackRef: undefined
      },
      states: {
        idle: {
          entry: assign({
            callbackRef: ({ spawn }) =>
              spawn(
                fromCallback<{ type: 'START' }>(({ sendBack, receive }) => {
                  receive((event) => {
                    if (event.type === 'START') {
                      setEffectTimeout(() => {
                        sendBack({ type: 'SEND_BACK' });
                      }, 10);
                    }
                  });
                })
              )
          }),
          on: {
            START_CB: {
              actions: sendTo(({ context }) => context.callbackRef!, {
                type: 'START'
              })
            },
            SEND_BACK: 'success'
          }
        },
        success: {
          type: 'final'
        }
      }
    });

    const callbackService = (yield* createActor(callbackMachine));

    (yield* callbackService.start);
    (yield* callbackService.send({ type: 'START_CB' }));
    // upstream resolves on the observer's `complete`; toEffect waits for the actor to
    // finish (SD-19) and fails if it errors instead. START reaches the callback through an
    // enqueued `sendTo` (SD-23), so the TestClock advances in 10 ms steps until the parent
    // completes rather than in one step that could run before the timer is set
    yield* toEffect(callbackService).pipe(
      Effect.raceFirst(Effect.forever(TestClock.adjust("10 millis")))
    );
  }));

  // upstream: test/actor.test.ts > spawning callbacks > should not deliver events sent to the parent after the callback actor gets stopped
  it.effect('should not deliver events sent to the parent after the callback actor gets stopped', () => Effect.gen(function* () {
    const spy = vi.fn();

    let sendToParent: () => void;

    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          invoke: {
            src: fromCallback(({ sendBack }) => {
              sendToParent = () =>
                sendBack({
                  type: 'FROM_CALLBACK'
                });
            })
          },
          on: {
            NEXT: 'b'
          }
        },
        b: {}
      },
      on: {
        FROM_CALLBACK: {
          actions: spy
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    // upstream runs the callback inside `start`; here it runs in the child's own fiber (C7):
    // let it capture `sendBack` before the state that invokes it is left
    yield* yieldUntil(() => typeof sendToParent === 'function');
    (yield* actorRef.send({ type: 'NEXT' }));

    sendToParent!();

    // a delivery would be enqueued (SD-23): let it run before asserting its absence
    yield* settle;

    expect(spy).not.toHaveBeenCalled();
  }));
});

describe('spawning observables', () => {
  // upstream: test/actor.test.ts > spawning observables > should spawn an observable
  it.effect('should spawn an observable', () => Effect.gen(function* () {
    // the interval runs on virtual time (see `virtualTime`)
    const scheduler = new VirtualTimeScheduler();
    const advance = virtualTime(scheduler);
    const observableLogic = fromObservable(() => interval(10, scheduler));
    const observableMachine = createMachine({
      id: 'observable',
      initial: 'idle',
      context: {
        observableRef: undefined! as ActorRefFrom<typeof observableLogic>
      },
      states: {
        idle: {
          entry: assign({
            observableRef: ({ spawn }) => {
              const ref = spawn(observableLogic, {
                id: 'int',
                syncSnapshot: true
              });

              return ref;
            }
          }),
          on: {
            'xstate.snapshot.int': {
              target: 'success',
              // `snapshot.context` of observable logic is an `Option` (SD-17, DEV-19)
              guard: ({ event }) => Option.contains(event.snapshot.context, 5)
            }
          }
        },
        success: {
          type: 'final'
        }
      }
    });

    const observableService = (yield* createActor(observableMachine));

    (yield* observableService.start);
    // upstream resolves on the observer's `complete`; toEffect waits for the actor to
    // finish (SD-19) and fails if it errors instead, while the interval's virtual clock
    // advances in 10 ms steps: the wait ends after the sixth emission, as upstream
    yield* toEffect(observableService).pipe(
      Effect.raceFirst(Effect.forever(advance(10)))
    );
  }));

  // upstream: test/actor.test.ts > spawning observables > should spawn a referenced observable
  it.effect('should spawn a referenced observable', () => Effect.gen(function* () {
    // the interval runs on virtual time (see `virtualTime`)
    const scheduler = new VirtualTimeScheduler();
    const advance = virtualTime(scheduler);
    const observableMachine = createMachine(
      {
        id: 'observable',
        initial: 'idle',
        context: {
          observableRef: undefined! as AnyActorRef
        },
        states: {
          idle: {
            entry: assign({
              observableRef: ({ spawn }) =>
                spawn('interval', { id: 'int', syncSnapshot: true })
            }),
            on: {
              'xstate.snapshot.int': {
                target: 'success',
                // `snapshot.context` of observable logic is an `Option` (SD-17, DEV-19)
                guard: ({ event }) => Option.contains(event.snapshot.context, 5)
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
          interval: fromObservable(() => interval(10, scheduler))
        }
      }
    );

    const observableService = (yield* createActor(observableMachine));

    (yield* observableService.start);
    // upstream resolves on the observer's `complete`; toEffect waits for the actor to
    // finish (SD-19) while the interval's virtual clock advances in 10 ms steps
    yield* toEffect(observableService).pipe(
      Effect.raceFirst(Effect.forever(advance(10)))
    );
  }));

  // upstream: test/actor.test.ts > spawning observables > should read the latest snapshot of the event's origin while handling that event
  it.effect(`should read the latest snapshot of the event's origin while handling that event`, () => Effect.gen(function* () {
    // the interval runs on virtual time (see `virtualTime`)
    const scheduler = new VirtualTimeScheduler();
    const advance = virtualTime(scheduler);
    const observableLogic = fromObservable(() => interval(10, scheduler));
    const observableMachine = createMachine({
      id: 'observable',
      initial: 'idle',
      context: {
        observableRef: undefined! as ActorRefFrom<typeof observableLogic>
      },
      states: {
        idle: {
          entry: assign({
            observableRef: ({ spawn }) => {
              const ref = spawn(observableLogic, {
                id: 'int',
                syncSnapshot: true
              });

              return ref;
            }
          }),
          on: {
            'xstate.snapshot.int': {
              target: 'success',
              // the child's `getSnapshot` is an Effect (D6), so the guard returns an Effect
              // (D15); `snapshot.context` of observable logic is an `Option` (SD-17, DEV-19)
              guard: ({ context, event }) =>
                Effect.gen(function* () {
                  return (
                    Option.contains(event.snapshot.context, 1) &&
                    Option.contains((yield* context.observableRef.getSnapshot).context, 1)
                  );
                })
            }
          }
        },
        success: {
          type: 'final'
        }
      }
    });

    const observableService = (yield* createActor(observableMachine));

    (yield* observableService.start);
    // upstream resolves on the observer's `complete`; toEffect waits for the actor to
    // finish (SD-19) while the interval's virtual clock advances in 10 ms steps, and every
    // actor takes each emission before the next one (see `virtualTime`)
    yield* toEffect(observableService).pipe(
      Effect.raceFirst(Effect.forever(advance(10)))
    );
  }));

  // upstream: test/actor.test.ts > spawning observables > should notify direct child listeners with final snapshot before it gets stopped
  it.effect('should notify direct child listeners with final snapshot before it gets stopped', () => Effect.gen(function* () {
    // the interval runs on virtual time (see `virtualTime`)
    const scheduler = new VirtualTimeScheduler();
    const advance = virtualTime(scheduler);
    const intervalActor = fromObservable(() => interval(10, scheduler));

    const parentMachine = createMachine(
      {
        types: {} as {
          actors: {
            src: 'interval';
            id: 'childActor';
            logic: typeof intervalActor;
          };
        },
        initial: 'active',
        states: {
          active: {
            invoke: {
              id: 'childActor',
              src: 'interval',
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
          interval: intervalActor
        }
      }
    );

    const actorRef = (yield* createActor(parentMachine));
    (yield* actorRef.start);

    yield* waitFor(actorRef, (state) => state.matches('active'));

    const spy = vi.fn();

    // the child's `subscribe` is scoped and its listener returns an Effect (D6)
    yield* (yield* actorRef.getSnapshot).children.childActor!.subscribe((data) =>
      Effect.sync(() => {
        spy(data.context);
      })
    );

    // the interval emits as its virtual clock advances in 10 ms steps
    yield* waitFor(actorRef, (state) => state.status !== 'active').pipe(
      Effect.raceFirst(Effect.forever(advance(10)))
    );

    // the listener may run in its own fiber: let it see the final snapshot
    yield* yieldUntil(() =>
      spy.mock.calls.some(([data]) => Equal.equals(data, Option.some(3)))
    );

    // `snapshot.context` of observable logic is an `Option` (SD-17, DEV-19)
    expect(spy).toHaveBeenCalledWith(Option.some(3));
  }));

  // upstream: test/actor.test.ts > spawning observables > should not notify direct child listeners after it gets stopped
  it.effect('should not notify direct child listeners after it gets stopped', () => Effect.gen(function* () {
    // the interval runs on virtual time (see `virtualTime`), so the 15 ms that upstream
    // sleeps for a potential next event is a 15 ms step of that virtual clock
    const scheduler = new VirtualTimeScheduler();
    const advance = virtualTime(scheduler);
    const intervalActor = fromObservable(() => interval(10, scheduler));

    const parentMachine = createMachine(
      {
        types: {} as {
          actors: {
            src: 'interval';
            id: 'childActor';
            logic: typeof intervalActor;
          };
        },
        initial: 'active',
        states: {
          active: {
            invoke: {
              id: 'childActor',
              src: 'interval',
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
          interval: intervalActor
        }
      }
    );

    const actorRef = (yield* createActor(parentMachine));
    (yield* actorRef.start);

    yield* waitFor(actorRef, (state) => state.matches('active'));

    const spy = vi.fn();

    // the child's `subscribe` is scoped and its listener returns an Effect (D6)
    yield* (yield* actorRef.getSnapshot).children.childActor!.subscribe((data) =>
      Effect.sync(() => {
        spy(data);
      })
    );

    // the interval emits as its virtual clock advances in 10 ms steps
    yield* waitFor(actorRef, (state) => state.status !== 'active').pipe(
      Effect.raceFirst(Effect.forever(advance(10)))
    );
    spy.mockClear();

    // wait for potential next event from the interval actor
    // (here: advance the interval's virtual clock by 15 ms; `advance` lets any delivery run)
    yield* advance(15);

    expect(spy).not.toHaveBeenCalled();
  }));
});

describe('spawning event observables', () => {
  // upstream: test/actor.test.ts > spawning event observables > should spawn an event observable
  it.effect('should spawn an event observable', () => Effect.gen(function* () {
    // the interval runs on virtual time (see `virtualTime`)
    const scheduler = new VirtualTimeScheduler();
    const advance = virtualTime(scheduler);
    const eventObservableLogic = fromEventObservable(() =>
      interval(10, scheduler).pipe(map((val) => ({ type: 'COUNT', val })))
    );
    const observableMachine = createMachine({
      id: 'observable',
      initial: 'idle',
      context: {
        observableRef: undefined! as ActorRefFrom<typeof eventObservableLogic>
      },
      states: {
        idle: {
          entry: assign({
            observableRef: ({ spawn }) => {
              const ref = spawn(eventObservableLogic, { id: 'int' });

              return ref;
            }
          }),
          on: {
            COUNT: {
              target: 'success',
              guard: ({ event }) => event.val === 5
            }
          }
        },
        success: {
          type: 'final'
        }
      }
    });

    const observableService = (yield* createActor(observableMachine));

    (yield* observableService.start);
    // upstream resolves on the observer's `complete`; toEffect waits for the actor to
    // finish (SD-19) while the interval's virtual clock advances in 10 ms steps
    yield* toEffect(observableService).pipe(
      Effect.raceFirst(Effect.forever(advance(10)))
    );
  }));

  // upstream: test/actor.test.ts > spawning event observables > should spawn a referenced event observable
  it.effect('should spawn a referenced event observable', () => Effect.gen(function* () {
    // the interval runs on virtual time (see `virtualTime`)
    const scheduler = new VirtualTimeScheduler();
    const advance = virtualTime(scheduler);
    const observableMachine = createMachine(
      {
        id: 'observable',
        initial: 'idle',
        context: {
          observableRef: undefined! as AnyActorRef
        },
        states: {
          idle: {
            entry: assign({
              observableRef: ({ spawn }) => spawn('interval', { id: 'int' })
            }),
            on: {
              COUNT: {
                target: 'success',
                guard: ({ event }) => event.val === 5
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
          interval: fromEventObservable(() =>
            interval(10, scheduler).pipe(map((val) => ({ type: 'COUNT', val })))
          )
        }
      }
    );

    const observableService = (yield* createActor(observableMachine));

    (yield* observableService.start);
    // upstream resolves on the observer's `complete`; toEffect waits for the actor to
    // finish (SD-19) while the interval's virtual clock advances in 10 ms steps
    yield* toEffect(observableService).pipe(
      Effect.raceFirst(Effect.forever(advance(10)))
    );
  }));
});

describe('communicating with spawned actors', () => {
  // upstream: test/actor.test.ts > communicating with spawned actors > should treat an interpreter as an actor
  it.effect('should treat an interpreter as an actor', () => Effect.gen(function* () {
    const existingMachine = createMachine({
      types: {
        events: {} as {
          type: 'ACTIVATE';
          origin: AnyActorRef;
        }
      },
      initial: 'inactive',
      states: {
        inactive: {
          on: { ACTIVATE: 'active' }
        },
        active: {
          entry: sendTo(({ event }) => event.origin, { type: 'EXISTING.DONE' })
        }
      }
    });

    const existingService = (yield* Effect.tap(createActor(existingMachine), (a) => a.start));

    const parentMachine = createMachine({
      types: {} as {
        context: { existingRef?: typeof existingService };
      },
      initial: 'pending',
      context: {
        existingRef: undefined
      },
      states: {
        pending: {
          entry: assign({
            // No need to spawn an existing service:
            existingRef: existingService
          }),
          on: {
            'EXISTING.DONE': 'success'
          },
          after: {
            100: {
              actions: sendTo(
                ({ context }) => context.existingRef!,
                ({ self }) => ({
                  type: 'ACTIVATE',
                  origin: self
                })
              )
            }
          }
        },
        success: {
          type: 'final'
        }
      }
    });

    const parentService = (yield* createActor(parentMachine));

    (yield* parentService.start);
    // upstream resolves on the observer's `complete`; toEffect waits for the actor to
    // finish (SD-19) and fails if it errors instead. The `after: { 100: … }` timer runs on
    // the Effect clock, so the TestClock advances in 10 ms steps until the parent completes
    yield* toEffect(parentService).pipe(
      Effect.raceFirst(Effect.forever(TestClock.adjust("10 millis")))
    );
  }));
});

describe('actors', () => {
  // upstream: test/actor.test.ts > actors > should only spawn actors defined on initial state once
  it.effect('should only spawn actors defined on initial state once', () => Effect.gen(function* () {
    let count = 0;

    const startMachine = createMachine({
      types: {} as { context: { items: number[]; refs: any[] } },
      id: 'start',
      initial: 'start',
      context: {
        items: [0, 1, 2, 3],
        refs: []
      },
      states: {
        start: {
          entry: assign({
            refs: ({ context, spawn }) => {
              count++;
              const c = context.items.map((item) =>
                spawn(fromPromise(() => new Promise((res) => res(item))))
              );

              return c;
            }
          })
        }
      }
    });

    const actor = (yield* createActor(startMachine));
    // the listener is scoped and returns an Effect (D6, SD-24)
    yield* actor.subscribe(() =>
      Effect.sync(() => {
        expect(count).toEqual(1);
      })
    );
    (yield* actor.start);

    // the listener runs inside the actor's processing, where a failing `expect` is reported
    // through the logger (SD-21) instead of failing the test, so once the spawned promises
    // have settled (C6) the test fiber makes the same check
    yield* settle;
    expect(count).toEqual(1);
  }));

  // upstream: test/actor.test.ts > actors > should spawn an actor in an initial state of a child that gets invoked in the initial state of a parent when the parent gets started
  it.effect('should spawn an actor in an initial state of a child that gets invoked in the initial state of a parent when the parent gets started', () => Effect.gen(function* () {
    let spawnCounter = 0;

    interface TestContext {
      promise?: ActorRefFrom<PromiseActorLogic<string>>;
    }

    const child = createMachine({
      types: {} as { context: TestContext },
      initial: 'bar',
      context: {},
      states: {
        bar: {
          entry: assign({
            promise: ({ spawn }) => {
              return spawn(
                fromPromise(() => {
                  spawnCounter++;
                  return Promise.resolve('answer');
                })
              );
            }
          })
        }
      }
    });

    const parent = createMachine({
      initial: 'foo',
      states: {
        foo: {
          invoke: {
            src: child,
            onDone: 'end'
          }
        },
        end: { type: 'final' }
      }
    });
    (yield* Effect.tap(createActor(parent), (a) => a.start));
    // upstream runs the promise creator inside `start`; here the promise actor starts in its
    // own fiber (C6): let every start run, then check that the creator ran exactly once
    yield* settle;
    expect(spawnCounter).toBe(1);
  }));

  // https://github.com/statelyai/xstate/issues/2565
  // upstream: test/actor.test.ts > actors > should only spawn an initial actor once when it synchronously responds with an event
  it.effect('should only spawn an initial actor once when it synchronously responds with an event', () => Effect.gen(function* () {
    let spawnCalled = 0;
    const anotherMachine = createMachine({
      initial: 'hello',
      states: {
        hello: {
          entry: sendParent({ type: 'ping' })
        }
      }
    });

    const testMachine = createMachine({
      types: {} as { context: { ref?: ActorRefFrom<typeof anotherMachine> } },
      initial: 'testing',
      context: ({ spawn }) => {
        spawnCalled++;
        // throw in case of an infinite loop
        expect(spawnCalled).toBe(1);
        return {
          ref: spawn(anotherMachine)
        };
      },
      states: {
        testing: {
          on: {
            ping: {
              target: 'done'
            }
          }
        },
        done: {}
      }
    });

    const service = (yield* Effect.tap(createActor(testMachine), (a) => a.start));
    // the child's `sendParent` enqueues (SD-23): let the parent take `ping`
    yield* yieldUntil(() =>
      Effect.map(service.getSnapshot, (snapshot) => snapshot.value === 'done')
    );
    expect((yield* service.getSnapshot).value).toEqual('done');
  }));

  // upstream: test/actor.test.ts > actors > should spawn null actors if not used within a service
  it.effect('should spawn null actors if not used within a service', () => Effect.gen(function* () {
    const nullActorMachine = createMachine({
      types: {} as { context: { ref?: PromiseActorRef<number> } },
      initial: 'foo',
      context: { ref: undefined },
      states: {
        foo: {
          entry: assign({
            ref: ({ spawn }) => spawn(fromPromise(() => Promise.resolve(42)))
          })
        }
      }
    });

    // expect(createActor(nullActorMachine).getSnapshot().context.ref!.id).toBe('null'); // TODO: identify null actors
    expect(
      (yield* (yield* createActor(nullActorMachine)).getSnapshot).context.ref!.send
    ).toBeDefined();
  }));

  // upstream: test/actor.test.ts > actors > should stop multiple inline spawned actors that have no explicit ids
  it.effect('should stop multiple inline spawned actors that have no explicit ids', () => Effect.gen(function* () {
    const cleanup1 = vi.fn();
    const cleanup2 = vi.fn();

    const parent = createMachine({
      context: ({ spawn }) => ({
        ref1: spawn(fromCallback(() => cleanup1)),
        ref2: spawn(fromCallback(() => cleanup2))
      })
    });
    const actorRef = (yield* Effect.tap(createActor(parent), (a) => a.start));

    expect(Object.keys((yield* actorRef.getSnapshot).children).length).toBe(2);

    // upstream runs both callbacks inside `start`; here each runs in its own fiber (C7):
    // let them return their cleanup functions before the parent stops
    yield* settle;

    (yield* actorRef.stop);

    expect(cleanup1).toBeCalledTimes(1);
    expect(cleanup2).toBeCalledTimes(1);
  }));

  // upstream: test/actor.test.ts > actors > should stop multiple referenced spawned actors that have no explicit ids
  it.effect('should stop multiple referenced spawned actors that have no explicit ids', () => Effect.gen(function* () {
    const cleanup1 = vi.fn();
    const cleanup2 = vi.fn();

    const parent = createMachine(
      {
        context: ({ spawn }) => ({
          ref1: spawn('child1'),
          ref2: spawn('child2')
        })
      },
      {
        actors: {
          child1: fromCallback(() => cleanup1),
          child2: fromCallback(() => cleanup2)
        }
      }
    );
    const actorRef = (yield* Effect.tap(createActor(parent), (a) => a.start));

    expect(Object.keys((yield* actorRef.getSnapshot).children).length).toBe(2);

    // upstream runs both callbacks inside `start`; here each runs in its own fiber (C7):
    // let them return their cleanup functions before the parent stops
    yield* settle;

    (yield* actorRef.stop);

    expect(cleanup1).toBeCalledTimes(1);
    expect(cleanup2).toBeCalledTimes(1);
  }));

  describe('with actor logic', () => {
    // upstream: test/actor.test.ts > actors > with actor logic > should work with a promise logic (fulfill)
    it.effect('should work with a promise logic (fulfill)', () => Effect.gen(function* () {
      // upstream's promise resolves from a host `setTimeout`; the same delay runs on the
      // Effect clock here (see `effectTimers`)
      const setEffectTimeout = yield* effectTimers;
      const countMachine = createMachine({
        types: {} as {
          context: {
            count: ActorRefFrom<PromiseActorLogic<number>> | undefined;
          };
        },
        context: {
          count: undefined
        },
        entry: assign({
          count: ({ spawn }) =>
            spawn(
              fromPromise(
                () =>
                  new Promise<number>((res) => {
                    setEffectTimeout(() => res(42));
                  })
              ),
              { id: 'test' }
            )
        }),
        initial: 'pending',
        states: {
          pending: {
            on: {
              'xstate.done.actor.test': {
                target: 'success',
                // `event.output` is an `Option` (D8, DEV-7)
                guard: ({ event }) => Option.contains(event.output, 42)
              }
            }
          },
          success: {
            type: 'final'
          }
        }
      });

      const countService = (yield* createActor(countMachine));
      (yield* countService.start);
      // upstream resolves on the observer's `complete`; toEffect waits for the actor to
      // finish (SD-19) and fails if it errors instead. The promise actor starts in its own
      // fiber (C6), so the TestClock advances in 1 ms steps until the parent completes
      yield* toEffect(countService).pipe(
        Effect.raceFirst(Effect.forever(TestClock.adjust("1 millis")))
      );
    }));

    // upstream: test/actor.test.ts > actors > with actor logic > should work with a promise logic (reject)
    it.effect('should work with a promise logic (reject)', () => Effect.gen(function* () {
      // upstream's promise rejects from a 1 ms host `setTimeout`; the same delay runs on the
      // Effect clock here (see `effectTimers`)
      const setEffectTimeout = yield* effectTimers;
      const errorMessage = 'An error occurred';
      const countMachine = createMachine({
        types: {} as {
          context: { count: ActorRefFrom<PromiseActorLogic<number>> };
        },
        context: ({ spawn }) => ({
          count: spawn(
            fromPromise(
              () =>
                new Promise<number>((_, rej) => {
                  setEffectTimeout(() => rej(errorMessage), 1);
                })
            ),
            { id: 'test' }
          )
        }),
        initial: 'pending',
        states: {
          pending: {
            on: {
              'xstate.error.actor.test': {
                target: 'success',
                guard: ({ event }) => {
                  return event.error === errorMessage;
                }
              }
            }
          },
          success: {
            type: 'final'
          }
        }
      });

      const countService = (yield* createActor(countMachine));
      (yield* countService.start);
      // upstream resolves on the observer's `complete`; toEffect waits for the actor to
      // finish (SD-19) and fails if it errors instead. The TestClock advances in 1 ms steps
      // until the parent completes
      yield* toEffect(countService).pipe(
        Effect.raceFirst(Effect.forever(TestClock.adjust("1 millis")))
      );
    }));

    // upstream: test/actor.test.ts > actors > with actor logic > actor logic should have reference to the parent
    it.effect('actor logic should have reference to the parent', () => Effect.gen(function* () {
      // Upstream writes the logic as an object whose methods return values and receive the
      // actor scope as an argument. The port's logic interface returns Effects and reads its
      // actor scope from the Effect context (`ActorScope`), and `makeActorLogic` builds it
      // (SPEC context.md, API patterns), with the snapshot type as its type argument and the
      // snapshot from `Snapshot.active()`, whose `output` and `error` are Options (D8);
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
        types: {} as {
          context: { ponger: ActorRefFrom<typeof pongLogic> | undefined };
        },
        initial: 'waiting',
        context: {
          ponger: undefined
        },
        entry: assign({
          ponger: ({ spawn }) => spawn(pongLogic)
        }),
        states: {
          waiting: {
            entry: sendTo(({ context }) => context.ponger!, { type: 'PING' }),
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
      (yield* pingService.start);
      // upstream resolves on the observer's `complete`; toEffect waits for the actor to
      // finish (SD-19) and fails if it errors instead
      yield* toEffect(pingService);
    }));
  });

  // upstream: test/actor.test.ts > actors > should be able to spawn callback actors in (lazy) initial context
  it.effect('should be able to spawn callback actors in (lazy) initial context', () => Effect.gen(function* () {
    const machine = createMachine({
      types: {} as { context: { ref: CallbackActorRef<EventObject> } },
      context: ({ spawn }) => ({
        ref: spawn(
          fromCallback(({ sendBack }) => {
            sendBack({ type: 'TEST' });
          })
        )
      }),
      initial: 'waiting',
      states: {
        waiting: {
          on: { TEST: 'success' }
        },
        success: {
          type: 'final'
        }
      }
    });

    const actor = (yield* createActor(machine));
    (yield* actor.start);
    // upstream resolves on the observer's `complete`; toEffect waits for the actor to
    // finish (SD-19) and fails if it errors instead
    yield* toEffect(actor);
  }));

  // upstream: test/actor.test.ts > actors > should be able to spawn machines in (lazy) initial context
  it.effect('should be able to spawn machines in (lazy) initial context', () => Effect.gen(function* () {
    const childMachine = createMachine({
      entry: sendParent({ type: 'TEST' })
    });

    const machine = createMachine({
      types: {} as { context: { ref: ActorRefFrom<typeof childMachine> } },
      context: ({ spawn }) => ({
        ref: spawn(childMachine)
      }),
      initial: 'waiting',
      states: {
        waiting: {
          on: { TEST: 'success' }
        },
        success: {
          type: 'final'
        }
      }
    });

    const actor = (yield* createActor(machine));
    (yield* actor.start);
    // upstream resolves on the observer's `complete`; toEffect waits for the actor to
    // finish (SD-19) and fails if it errors instead
    yield* toEffect(actor);
  }));

  // https://github.com/statelyai/xstate/issues/2507
  // upstream: test/actor.test.ts > actors > should not crash on child machine sync completion during self-initialization
  it.effect('should not crash on child machine sync completion during self-initialization', () => Effect.gen(function* () {
    const childMachine = createMachine({
      initial: 'idle',
      states: {
        idle: {
          always: [
            {
              target: 'stopped'
            }
          ]
        },
        stopped: {
          type: 'final'
        }
      }
    });

    const parentMachine = createMachine(
      {
        types: {} as {
          context: { child: ActorRefFrom<typeof childMachine> | null };
        },
        context: {
          child: null
        },
        entry: 'setup'
      },
      {
        actions: {
          setup: assign({
            child: ({ spawn }) => spawn(childMachine)
          })
        }
      }
    );
    const service = (yield* createActor(parentMachine));
    // SD-3: `start` is an Effect, not a synchronous throw site: "does not throw" is an Exit
    // that is a success
    const started = yield* Effect.exit(service.start);
    expect(Exit.isSuccess(started)).toBe(true);
  }));

  // upstream: test/actor.test.ts > actors > should not crash on child promise-like sync completion during self-initialization
  it.effect('should not crash on child promise-like sync completion during self-initialization', () => Effect.gen(function* () {
    const promiseLogic = fromPromise(
      () => ({ then: (fn: any) => fn(null) }) as any
    );
    const parentMachine = createMachine({
      types: {} as {
        context: { child: ActorRefFrom<typeof promiseLogic> | null };
      },
      context: {
        child: null
      },
      entry: assign({
        child: ({ spawn }) => spawn(promiseLogic)
      })
    });
    const service = (yield* createActor(parentMachine));
    // SD-3: `start` is an Effect, not a synchronous throw site: "does not throw" is an Exit
    // that is a success
    const started = yield* Effect.exit(service.start);
    expect(Exit.isSuccess(started)).toBe(true);
  }));

  // upstream: test/actor.test.ts > actors > should not crash on child observable sync completion during self-initialization
  it.effect('should not crash on child observable sync completion during self-initialization', () => Effect.gen(function* () {
    const createEmptyObservable = (): Subscribable<any> => ({
      subscribe(observer) {
        (observer as Observer<any>).complete?.();

        return { unsubscribe: () => {} };
      }
    });

    const emptyObservableLogic = fromObservable(createEmptyObservable);

    const parentMachine = createMachine({
      types: {} as {
        context: { child: ActorRefFrom<typeof emptyObservableLogic> | null };
      },
      context: {
        child: null
      },
      entry: assign({
        child: ({ spawn }) => spawn(emptyObservableLogic)
      })
    });
    const service = (yield* createActor(parentMachine));
    // SD-3: `start` is an Effect, not a synchronous throw site: "does not throw" is an Exit
    // that is a success
    const started = yield* Effect.exit(service.start);
    expect(Exit.isSuccess(started)).toBe(true);
  }));

  // upstream: test/actor.test.ts > actors > should receive done event from an immediately completed observable when self-initializing
  it.effect('should receive done event from an immediately completed observable when self-initializing', () => Effect.gen(function* () {
    const emptyObservable = fromObservable(() => EMPTY);

    const parentMachine = createMachine({
      types: {
        context: {} as {
          child: ActorRefFrom<typeof emptyObservable> | null;
        }
      },
      context: {
        child: null
      },
      entry: assign({
        child: ({ spawn }) => spawn(emptyObservable, { id: 'myactor' })
      }),
      initial: 'init',
      states: {
        init: {
          on: {
            'xstate.done.actor.myactor': 'done'
          }
        },
        done: {}
      }
    });
    const service = (yield* createActor(parentMachine));

    (yield* service.start);

    // the child's done event is enqueued at the parent (SD-23): let the parent take it
    yield* yieldUntil(() =>
      Effect.map(service.getSnapshot, (snapshot) => snapshot.value === 'done')
    );

    expect((yield* service.getSnapshot).value).toBe('done');
  }));

  // upstream: test/actor.test.ts > actors > should not restart a completed observable
  it.effect('should not restart a completed observable', () => Effect.gen(function* () {
    let subscriptionCount = 0;
    const machine = createMachine({
      invoke: {
        id: 'observable',
        src: fromObservable(() => {
          subscriptionCount++;
          return of(42);
        })
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
    // upstream's `of(42)` completes inside `start`; here the observable runs in the child's
    // own fiber (C8): let the child finish before persisting
    yield* yieldUntil(() =>
      Effect.gen(function* () {
        const child = (yield* actor.getSnapshot).children.observable;
        return child === undefined || (yield* child.getSnapshot).status === 'done';
      })
    );
    const persistedState = (yield* actor.getPersistedSnapshot);

    (yield* Effect.tap(createActor(machine, {
      snapshot: persistedState
    }), (a) => a.start));

    // a resubscription would run in the restored child's own fiber: let it run first
    yield* settle;

    // Will be 2 if the observable is resubscribed
    expect(subscriptionCount).toBe(1);
  }));

  // upstream: test/actor.test.ts > actors > should not restart a completed event observable
  it.effect('should not restart a completed event observable', () => Effect.gen(function* () {
    let subscriptionCount = 0;
    const machine = createMachine({
      invoke: {
        id: 'observable',
        src: fromEventObservable(() => {
          subscriptionCount++;
          return of({ type: 'TEST' });
        })
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
    // upstream's `of(...)` completes inside `start`; here the observable runs in the
    // child's own fiber (C8): let the child finish before persisting
    yield* yieldUntil(() =>
      Effect.gen(function* () {
        const child = (yield* actor.getSnapshot).children.observable;
        return child === undefined || (yield* child.getSnapshot).status === 'done';
      })
    );
    const persistedState = (yield* actor.getPersistedSnapshot);

    (yield* Effect.tap(createActor(machine, {
      snapshot: persistedState
    }), (a) => a.start));

    // a resubscription would run in the restored child's own fiber: let it run first
    yield* settle;

    // Will be 2 if the event observable is resubscribed
    expect(subscriptionCount).toBe(1);
  }));

  // upstream: test/actor.test.ts > actors > should be able to restart a spawned actor within a single macrostep
  it.effect('should be able to restart a spawned actor within a single macrostep', () => Effect.gen(function* () {
    const actual: string[] = [];
    let invokeCounter = 0;

    const machine = createMachine({
      types: {} as {
        context: {
          actorRef: CallbackActorRef<EventObject>;
        };
      },
      initial: 'active',
      context: ({ spawn }) => {
        const localId = ++invokeCounter;

        return {
          actorRef: spawn(
            fromCallback(() => {
              actual.push(`start ${localId}`);
              return () => {
                actual.push(`stop ${localId}`);
              };
            }),
            { id: 'callback-1' }
          )
        };
      },
      states: {
        active: {
          on: {
            update: {
              actions: [
                stopChild(({ context }) => {
                  return context.actorRef;
                }),
                assign({
                  actorRef: ({ spawn }) => {
                    const localId = ++invokeCounter;

                    return spawn(
                      fromCallback(() => {
                        actual.push(`start ${localId}`);
                        return () => {
                          actual.push(`stop ${localId}`);
                        };
                      }),
                      { id: 'callback-2' }
                    );
                  }
                })
              ]
            }
          }
        }
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

    // upstream runs the first callback inside `start`; here it runs in its own fiber (C7):
    // let it start before the log is cleared
    yield* settle;

    actual.length = 0;

    (yield* service.send({
      type: 'update'
    }));

    // the restarted callback runs in its own fiber (C7): let it start
    yield* yieldUntil(() => actual.length >= 2);

    expect(actual).toEqual(['stop 1', 'start 2']);
  }));

  // upstream: test/actor.test.ts > actors > should be able to restart a named spawned actor within a single macrostep when stopping by a ref
  it.effect('should be able to restart a named spawned actor within a single macrostep when stopping by a ref', () => Effect.gen(function* () {
    const actual: string[] = [];
    let invokeCounter = 0;

    const machine = createMachine({
      types: {} as {
        context: {
          actorRef: CallbackActorRef<EventObject>;
        };
      },
      initial: 'active',
      context: ({ spawn }) => {
        const localId = ++invokeCounter;

        return {
          actorRef: spawn(
            fromCallback(() => {
              actual.push(`start ${localId}`);
              return () => {
                actual.push(`stop ${localId}`);
              };
            }),
            { id: 'my_name' }
          )
        };
      },
      states: {
        active: {
          on: {
            update: {
              actions: [
                stopChild(({ context }) => context.actorRef),
                assign({
                  actorRef: ({ spawn }) => {
                    const localId = ++invokeCounter;

                    return spawn(
                      fromCallback(() => {
                        actual.push(`start ${localId}`);
                        return () => {
                          actual.push(`stop ${localId}`);
                        };
                      }),
                      { id: 'my_name' }
                    );
                  }
                })
              ]
            }
          }
        }
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

    // upstream runs the first callback inside `start`; here it runs in its own fiber (C7):
    // let it start before the log is cleared
    yield* settle;

    actual.length = 0;

    (yield* service.send({
      type: 'update'
    }));

    // the restarted callback runs in its own fiber (C7): let it start
    yield* yieldUntil(() => actual.length >= 2);

    expect(actual).toEqual(['stop 1', 'start 2']);
  }));

  // upstream: test/actor.test.ts > actors > should be able to restart a named spawned actor within a single macrostep when stopping by static name
  it.effect('should be able to restart a named spawned actor within a single macrostep when stopping by static name', () => Effect.gen(function* () {
    const actual: string[] = [];
    let invokeCounter = 0;

    const machine = createMachine({
      types: {} as {
        context: {
          actorRef: CallbackActorRef<EventObject>;
        };
      },
      initial: 'active',
      context: ({ spawn }) => {
        const localId = ++invokeCounter;

        return {
          actorRef: spawn(
            fromCallback(() => {
              actual.push(`start ${localId}`);
              return () => {
                actual.push(`stop ${localId}`);
              };
            }),
            { id: 'my_name' }
          )
        };
      },
      states: {
        active: {
          on: {
            update: {
              actions: [
                stopChild('my_name'),
                assign({
                  actorRef: ({ spawn }) => {
                    const localId = ++invokeCounter;

                    return spawn(
                      fromCallback(() => {
                        actual.push(`start ${localId}`);
                        return () => {
                          actual.push(`stop ${localId}`);
                        };
                      }),
                      { id: 'my_name' }
                    );
                  }
                })
              ]
            }
          }
        }
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

    // upstream runs the first callback inside `start`; here it runs in its own fiber (C7):
    // let it start before the log is cleared
    yield* settle;

    actual.length = 0;

    (yield* service.send({
      type: 'update'
    }));

    // the restarted callback runs in its own fiber (C7): let it start
    yield* yieldUntil(() => actual.length >= 2);

    expect(actual).toEqual(['stop 1', 'start 2']);
  }));

  // upstream: test/actor.test.ts > actors > should be able to restart a named spawned actor within a single macrostep when stopping by resolved name
  it.effect('should be able to restart a named spawned actor within a single macrostep when stopping by resolved name', () => Effect.gen(function* () {
    const actual: string[] = [];
    let invokeCounter = 0;

    const machine = createMachine({
      types: {} as {
        context: {
          actorRef: CallbackActorRef<EventObject>;
        };
      },
      initial: 'active',
      context: ({ spawn }) => {
        const localId = ++invokeCounter;
        actual.push(`start ${localId}`);

        return {
          actorRef: spawn(
            fromCallback(() => {
              return () => {
                actual.push(`stop ${localId}`);
              };
            }),
            { id: 'my_name' }
          )
        };
      },
      states: {
        active: {
          on: {
            update: {
              actions: [
                stopChild(() => 'my_name'),
                assign({
                  actorRef: ({ spawn }) => {
                    const localId = ++invokeCounter;

                    return spawn(
                      fromCallback(() => {
                        actual.push(`start ${localId}`);
                        return () => {
                          actual.push(`stop ${localId}`);
                        };
                      }),
                      { id: 'my_name' }
                    );
                  }
                })
              ]
            }
          }
        }
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

    // the first callback runs in its own fiber (C7): let it return its cleanup function
    // before the log is cleared
    yield* settle;

    actual.length = 0;

    (yield* service.send({
      type: 'update'
    }));

    // the restarted callback runs in its own fiber (C7): let it start
    yield* yieldUntil(() => actual.length >= 2);

    expect(actual).toEqual(['stop 1', 'start 2']);
  }));

  // upstream: test/actor.test.ts > actors > should be possible to pass `self` as input to a child machine from within the context factory
  it.effect('should be possible to pass `self` as input to a child machine from within the context factory', () => Effect.gen(function* () {
    const spy = vi.fn();

    const child = createMachine({
      types: {} as {
        context: {
          parent: AnyActorRef;
        };
        input: {
          parent: AnyActorRef;
        };
      },
      context: ({ input }) => ({
        parent: input.parent
      }),
      entry: sendTo(({ context }) => context.parent, { type: 'GREET' })
    });

    const machine = createMachine({
      context: ({ spawn, self }) => {
        return {
          childRef: spawn(child, { input: { parent: self } })
        };
      },
      on: {
        GREET: {
          actions: spy
        }
      }
    });

    (yield* Effect.tap(createActor(machine), (a) => a.start));

    // the child's `sendTo` enqueues at the parent (SD-23): let the parent take GREET
    yield* yieldUntil(() => spy.mock.calls.length > 0);

    expect(spy).toHaveBeenCalledTimes(1);
  }));

  // upstream: test/actor.test.ts > actors > catches errors from spawned promise actors
  it.effect('catches errors from spawned promise actors', () => Effect.gen(function* () {
    expect.assertions(1);
    const machine = createMachine({
      on: {
        event: {
          actions: assign(({ spawn }) => {
            spawn(
              fromPromise(async () => {
                throw new Error('uh oh');
              })
            );
          })
        }
      }
    });

    const actor = (yield* createActor(machine));
    // the observer-object `subscribe({ error })` is not ported (D6, DEV-3): the `changes`
    // stream fails with the actor's error (SD-4), so the consumer's failure handler stands
    // for the observer's `error` callback
    const observer = yield* actor.changes.pipe(
      Stream.runDrain,
      Effect.catch((err) =>
        Effect.sync(() => {
          expect((err as Error).message).toBe('uh oh');
        })
      ),
      Effect.forkScoped({ startImmediately: true })
    );
    (yield* actor.start);
    (yield* actor.send({ type: 'event' }));

    // the rejection reaches the parent from the promise actor's own fiber (C6): wait for the
    // consumer, so that `expect.assertions(1)` counts its assertion
    yield* Fiber.join(observer);
  }));

  // upstream: test/actor.test.ts > actors > same-position invokes should not leak between machines
  it.effect('same-position invokes should not leak between machines', () => Effect.gen(function* () {
    const spy = vi.fn();

    const sharedActors = {};

    const m1 = createMachine(
      {
        invoke: {
          src: fromPromise(async () => 'foo'),
          onDone: {
            actions: ({ event }) => spy(event.output)
          }
        }
      },
      { actors: sharedActors }
    );

    createMachine(
      {
        invoke: { src: fromPromise(async () => 100) }
      },
      { actors: sharedActors }
    );

    (yield* Effect.tap(createActor(m1), (a) => a.start));

    // upstream sleeps 1 ms of real time for the promise to settle; here: yield, bounded,
    // until the parent has run its `onDone` action
    yield* yieldUntil(() => spy.mock.calls.length > 0);

    expect(spy).toHaveBeenCalledTimes(1);
    // `event.output` is an `Option` (D8, DEV-7)
    expect(spy).toHaveBeenCalledWith(Option.some('foo'));
  }));

  // upstream: test/actor.test.ts > actors > inline invokes should not leak into provided actors object
  it.effect('inline invokes should not leak into provided actors object', () => Effect.gen(function* () {
    const actors = {};

    const machine = createMachine(
      {
        invoke: {
          src: fromPromise(async () => 'foo')
        }
      },
      { actors }
    );

    (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(actors).toEqual({});
  }));
});
