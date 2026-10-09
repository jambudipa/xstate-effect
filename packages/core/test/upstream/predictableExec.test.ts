import { describe, expect, it } from "@effect/vitest"
import { Deferred, Effect } from "effect"
import { TestClock } from "effect/testing"
import {
  AnyActor,
  assign,
  createMachine,
  createActor,
  sendTo,
  toEffect
} from "../../src/index.js";
import { raise, sendParent } from "../../src/index.js";
import { fromCallback, fromPromise } from "../../src/index.js";

// Upstream delivers the events that actors send to each other before `start` and `send`
// return. Here a send from inside an actor (`sendTo`, `sendParent`) enqueues without waiting
// (SD-23), so a test yields its fiber, at most 100 times and never on wall-clock time, until
// the delivery it needs has happened.
const yieldUntil = (done: () => boolean | Effect.Effect<boolean>) =>
  Effect.yieldNow.pipe(Effect.repeat({ until: done, times: 100 }));

describe('predictableExec', () => {
  // upstream: test/predictableExec.test.ts > predictableExec > should call mixed custom and builtin actions in the definitions order
  it.effect('should call mixed custom and builtin actions in the definitions order', () => Effect.gen(function* () {
    const actual: string[] = [];

    const machine = createMachine({
      initial: 'a',
      context: {},
      states: {
        a: {
          on: { NEXT: 'b' }
        },
        b: {
          entry: [
            () => {
              actual.push('custom');
            },
            assign(() => {
              actual.push('assign');
              return {};
            })
          ]
        }
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* service.send({ type: 'NEXT' }));

    expect(actual).toEqual(['custom', 'assign']);
  }));

  // upstream: test/predictableExec.test.ts > predictableExec > should call initial custom actions when starting a service
  it.effect('should call initial custom actions when starting a service', () => Effect.gen(function* () {
    let called = false;
    const machine = createMachine({
      entry: () => {
        called = true;
      }
    });

    expect(called).toBe(false);

    (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(called).toBe(true);
  }));

  // upstream: test/predictableExec.test.ts > predictableExec > should resolve initial assign actions before starting a service
  it.effect('should resolve initial assign actions before starting a service', () => Effect.gen(function* () {
    const machine = createMachine({
      context: {
        called: false
      },
      entry: [
        assign({
          called: true
        })
      ]
    });

    expect((yield* (yield* createActor(machine)).getSnapshot).context.called).toBe(true);
  }));

  // upstream: test/predictableExec.test.ts > predictableExec > should call raised transition custom actions with raised event
  it.effect('should call raised transition custom actions with raised event', () => Effect.gen(function* () {
    let eventArg: any;
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            NEXT: 'b'
          }
        },
        b: {
          on: {
            RAISED: {
              target: 'c',
              actions: ({ event }) => (eventArg = event)
            }
          },
          entry: raise({ type: 'RAISED' })
        },
        c: {}
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* service.send({ type: 'NEXT' }));

    expect(eventArg.type).toBe('RAISED');
  }));

  // upstream: test/predictableExec.test.ts > predictableExec > should call raised transition builtin actions with raised event
  it.effect('should call raised transition builtin actions with raised event', () => Effect.gen(function* () {
    let eventArg: any;
    const machine = createMachine({
      context: {},
      initial: 'a',
      states: {
        a: {
          on: {
            NEXT: 'b'
          }
        },
        b: {
          on: {
            RAISED: {
              target: 'c',
              actions: assign(({ event }) => {
                eventArg = event;
                return {};
              })
            }
          },
          entry: raise({ type: 'RAISED' })
        },
        c: {}
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* service.send({ type: 'NEXT' }));

    expect(eventArg.type).toBe('RAISED');
  }));

  // upstream: test/predictableExec.test.ts > predictableExec > should call invoke creator with raised event
  it.effect('should call invoke creator with raised event', () => Effect.gen(function* () {
    let eventArg: any;
    const machine = createMachine({
      context: {},
      initial: 'a',
      states: {
        a: {
          on: {
            NEXT: 'b'
          }
        },
        b: {
          on: {
            RAISED: 'c'
          },
          entry: raise({ type: 'RAISED' })
        },
        c: {
          invoke: {
            src: fromCallback(({ input }) => {
              eventArg = input.event;
            }),
            input: ({ event }: any) => ({ event })
          }
        }
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* service.send({ type: 'NEXT' }));

    expect(eventArg.type).toBe('RAISED');
  }));

  // upstream: test/predictableExec.test.ts > predictableExec > invoked child should be available on the new state
  it.effect('invoked child should be available on the new state', () => Effect.gen(function* () {
    const machine = createMachine({
      context: {},
      initial: 'a',
      states: {
        a: {
          on: {
            NEXT: 'b'
          }
        },
        b: {
          invoke: {
            id: 'myChild',
            src: fromCallback(() => {})
          }
        }
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* service.send({ type: 'NEXT' }));

    expect((yield* service.getSnapshot).children.myChild).toBeDefined();
  }));

  // upstream: test/predictableExec.test.ts > predictableExec > invoked child should not be available on the state after leaving invoking state
  it.effect('invoked child should not be available on the state after leaving invoking state', () => Effect.gen(function* () {
    const machine = createMachine({
      context: {},
      initial: 'a',
      states: {
        a: {
          on: {
            NEXT: 'b'
          }
        },
        b: {
          invoke: {
            id: 'myChild',
            src: fromCallback(() => {})
          },
          on: {
            NEXT: 'c'
          }
        },
        c: {}
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* service.send({ type: 'NEXT' }));
    (yield* service.send({ type: 'NEXT' }));

    expect((yield* service.getSnapshot).children.myChild).not.toBeDefined();
  }));

  // upstream: test/predictableExec.test.ts > predictableExec > should correctly provide intermediate context value to a custom action executed in between assign actions
  it.effect('should correctly provide intermediate context value to a custom action executed in between assign actions', () => Effect.gen(function* () {
    let calledWith = 0;
    const machine = createMachine({
      context: {
        counter: 0
      },
      initial: 'a',
      states: {
        a: {
          on: {
            NEXT: 'b'
          }
        },
        b: {
          entry: [
            assign({ counter: 1 }),
            ({ context }) => (calledWith = context.counter),
            assign({ counter: 2 })
          ]
        }
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* service.send({ type: 'NEXT' }));

    expect(calledWith).toBe(1);
  }));

  // upstream: test/predictableExec.test.ts > predictableExec > initial actions should receive context updated only by preceding assign actions
  it.effect('initial actions should receive context updated only by preceding assign actions', () => Effect.gen(function* () {
    const actual: number[] = [];

    const machine = createMachine({
      context: { count: 0 },
      entry: [
        ({ context }) => actual.push(context.count),
        assign({ count: 1 }),
        ({ context }) => actual.push(context.count),
        assign({ count: 2 }),
        ({ context }) => actual.push(context.count)
      ]
    });

    (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(actual).toEqual([0, 1, 2]);
  }));

  // upstream: test/predictableExec.test.ts > predictableExec > parent should be able to read the updated state of a child when receiving an event from it #1
  it.effect('parent should be able to read the updated state of a child when receiving an event from it', () => Effect.gen(function* () {
    const child = createMachine({
      initial: 'a',
      states: {
        a: {
          // we need to clear the call stack before we send the event to the parent
          after: {
            1: 'b'
          }
        },
        b: {
          entry: sendParent({ type: 'CHILD_UPDATED' })
        }
      }
    });

    let service: AnyActor;

    const machine = createMachine({
      invoke: {
        id: 'myChild',
        src: child
      },
      initial: 'initial',
      states: {
        initial: {
          on: {
            CHILD_UPDATED: [
              {
                guard: () => {
                  // `getSnapshot` is an Effect (D6) and a guard is a synchronous
                  // function (D15): the guard reads both live snapshots with
                  // Effect.runSync, as upstream reads them with getSnapshot()
                  return (
                    Effect.runSync(Effect.runSync(service.getSnapshot).children!.myChild!.getSnapshot)
                      .value === 'b'
                  );
                },
                target: 'success'
              },
              {
                target: 'fail'
              }
            ]
          }
        },
        success: {
          type: 'final'
        },
        fail: {
          type: 'final'
        }
      }
    });

    service = (yield* createActor(machine));
    (yield* service.start);

    // upstream asserts in the observer's `complete` and resolves its promise there;
    // toEffect waits for the actor to finish (SD-19) and fails if it errors instead.
    // The child's `after: { 1: 'b' }` timer runs on the Effect clock, so the TestClock
    // advances in 1 ms steps until the parent completes
    yield* toEffect(service).pipe(
      Effect.raceFirst(Effect.forever(TestClock.adjust("1 millis")))
    );
    expect((yield* service.getSnapshot).value).toBe('success');
  }));

  // upstream: test/predictableExec.test.ts > predictableExec > should be possible to send immediate events to initially invoked actors #1
  it.effect('should be possible to send immediate events to initially invoked actors', () => Effect.gen(function* () {
    const child = createMachine({
      on: {
        PING: {
          actions: sendParent({ type: 'PONG' })
        }
      }
    });

    const machine = createMachine({
      initial: 'waiting',
      states: {
        waiting: {
          invoke: {
            id: 'ponger',
            src: child
          },
          entry: sendTo('ponger', { type: 'PING' }),
          on: {
            PONG: 'done'
          }
        },
        done: {
          type: 'final'
        }
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

    // the entry `sendTo` the child and the child's `sendParent` enqueue without waiting
    // (SD-23): let the PING and the PONG be delivered
    yield* yieldUntil(() => Effect.map(service.getSnapshot, (snapshot) => snapshot.value === 'done'));

    expect((yield* service.getSnapshot).value).toBe('done');
  }));

  // upstream: test/predictableExec.test.ts > predictableExec > should create invoke based on context updated by entry actions of the same state
  it.effect('should create invoke based on context updated by entry actions of the same state', () => Effect.gen(function* () {
    // upstream returns a `Promise.withResolvers` promise that the invoke creator resolves;
    // a Deferred stands in for it, and `resolve` completes it from the plain creator
    const promise = yield* Deferred.make<void>();
    const resolve = () => Deferred.doneUnsafe(promise, Effect.void);

    const machine = createMachine({
      context: {
        updated: false
      },
      initial: 'a',
      states: {
        a: {
          on: {
            NEXT: 'b'
          }
        },
        b: {
          entry: assign({ updated: true }),
          invoke: {
            src: fromPromise(({ input }) => {
              expect(input.updated).toBe(true);
              resolve();
              return Promise.resolve();
            }),
            input: ({ context }: any) => ({
              updated: context.updated
            })
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'NEXT' }));

    yield* Deferred.await(promise);
  }));

  // upstream: test/predictableExec.test.ts > predictableExec > should deliver events sent from the entry actions to a service invoked in the same state
  it.effect('should deliver events sent from the entry actions to a service invoked in the same state', () => Effect.gen(function* () {
    let received: any;

    const machine = createMachine({
      context: {
        updated: false
      },
      initial: 'a',
      states: {
        a: {
          on: {
            NEXT: 'b'
          }
        },
        b: {
          entry: sendTo('myChild', { type: 'KNOCK_KNOCK' }),
          invoke: {
            id: 'myChild',
            src: createMachine({
              on: {
                '*': {
                  actions: ({ event }) => {
                    received = event;
                  }
                }
              }
            })
          }
        }
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* service.send({ type: 'NEXT' }));

    // the entry `sendTo` the child enqueues without waiting (SD-23): let it be delivered
    yield* yieldUntil(() => received !== undefined);

    expect(received).toEqual({ type: 'KNOCK_KNOCK' });
  }));

  // upstream: test/predictableExec.test.ts > predictableExec > parent should be able to read the updated state of a child when receiving an event from it #2
  it.effect('parent should be able to read the updated state of a child when receiving an event from it', () => Effect.gen(function* () {
    const child = createMachine({
      initial: 'a',
      states: {
        a: {
          // we need to clear the call stack before we send the event to the parent
          after: {
            1: 'b'
          }
        },
        b: {
          entry: sendParent({ type: 'CHILD_UPDATED' })
        }
      }
    });

    let service: AnyActor;

    const machine = createMachine({
      invoke: {
        id: 'myChild',
        src: child
      },
      initial: 'initial',
      states: {
        initial: {
          on: {
            CHILD_UPDATED: [
              {
                // `getSnapshot` is an Effect (D6) and a guard is a synchronous
                // function (D15): the guard reads both live snapshots with
                // Effect.runSync, as upstream reads them with getSnapshot()
                guard: () =>
                  Effect.runSync(Effect.runSync(service.getSnapshot).children!.myChild!.getSnapshot).value ===
                  'b',
                target: 'success'
              },
              {
                target: 'fail'
              }
            ]
          }
        },
        success: {
          type: 'final'
        },
        fail: {
          type: 'final'
        }
      }
    });

    service = (yield* createActor(machine));
    (yield* service.start);

    // upstream asserts in the observer's `complete` and resolves its promise there;
    // toEffect waits for the actor to finish (SD-19) and fails if it errors instead.
    // The child's `after: { 1: 'b' }` timer runs on the Effect clock, so the TestClock
    // advances in 1 ms steps until the parent completes
    yield* toEffect(service).pipe(
      Effect.raceFirst(Effect.forever(TestClock.adjust("1 millis")))
    );
    expect((yield* service.getSnapshot).value).toBe('success');
  }));

  // upstream: test/predictableExec.test.ts > predictableExec > should be possible to send immediate events to initially invoked actors #2
  it.effect('should be possible to send immediate events to initially invoked actors', () => Effect.gen(function* () {
    const child = createMachine({
      on: {
        PING: {
          actions: sendParent({ type: 'PONG' })
        }
      }
    });

    const machine = createMachine({
      initial: 'waiting',
      states: {
        waiting: {
          invoke: {
            id: 'ponger',
            src: child
          },
          entry: sendTo('ponger', { type: 'PING' }),
          on: {
            PONG: 'done'
          }
        },
        done: {
          type: 'final'
        }
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

    // the entry `sendTo` the child and the child's `sendParent` enqueue without waiting
    // (SD-23): let the PING and the PONG be delivered
    yield* yieldUntil(() => Effect.map(service.getSnapshot, (snapshot) => snapshot.value === 'done'));

    expect((yield* service.getSnapshot).value).toBe('done');
  }));

  // https://github.com/statelyai/xstate/issues/3617
  // upstream: test/predictableExec.test.ts > predictableExec > should deliver events sent from the exit actions to a service invoked in the same state
  it.effect('should deliver events sent from the exit actions to a service invoked in the same state', () => Effect.gen(function* () {
    // upstream returns a `Promise.withResolvers` promise that the receive listener
    // resolves; a Deferred stands in for it, and `resolve` completes it from the listener
    const promise = yield* Deferred.make<void>();
    const resolve = () => Deferred.doneUnsafe(promise, Effect.void);

    const machine = createMachine({
      initial: 'active',
      states: {
        active: {
          invoke: {
            id: 'my-service',
            src: fromCallback(({ receive }) => {
              receive((event) => {
                if (event.type === 'MY_EVENT') {
                  resolve();
                }
              });
            })
          },
          exit: sendTo('my-service', { type: 'MY_EVENT' }),
          on: {
            TOGGLE: 'inactive'
          }
        },
        inactive: {}
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actor.send({ type: 'TOGGLE' }));

    yield* Deferred.await(promise);
  }));
});
