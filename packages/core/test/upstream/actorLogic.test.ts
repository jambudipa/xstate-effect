import { describe, expect, it, vi } from "@effect/vitest"
import type { Mock } from "@effect/vitest"
import { Deferred, Effect, Exit, Fiber, Option, Stream } from "effect"
import { EMPTY, interval, of, throwError, VirtualTimeScheduler } from 'rxjs';
import { take } from 'rxjs/operators';
import {
  AnyActorRef,
  createMachine,
  createActor,
  AnyActorLogic,
  Snapshot,
  ActorLogic
} from "../../src/index.js";
import {
  fromCallback,
  fromEventObservable,
  fromObservable,
  fromPromise,
  fromTransition
} from "../../src/index.js";
import { waitFor } from "../../src/index.js";
import { raise, sendTo } from "../../src/index.js";

// Upstream runs actor logic inside `start` and `send`, and delivers the events that actors
// send to each other before the outer call returns. Here non-machine logic and children run
// in their own fibers (D12), and a send from inside an actor enqueues without waiting
// (SD-23), so a test yields its fiber, at most 100 times and never on wall-clock time, until
// the effect it needs has happened.
const yieldUntil = (done: () => boolean | Effect.Effect<boolean>) =>
  Effect.yieldNow.pipe(Effect.repeat({ until: done, times: 100 }));

// Before an assertion that something did NOT happen: give every enqueued delivery the
// chance to run, so that the assertion is not vacuous.
const settle = yieldUntil(() => false);

// The tests whose `expect` runs inside a creator, a reducer, a listener or an action: upstream
// rethrows an error raised there globally, so a failing `expect` fails the test. Here that
// error becomes the actor error, which a root actor only logs (SD-4, SD-21). `settleLogic`
// lets the logic run, then fails the test with the actor error if there is one.
const settleLogic = (actor: {
  readonly getSnapshot: Effect.Effect<{ readonly status: string; readonly error: Option.Option<unknown> }>;
}) =>
  Effect.andThen(
    settle,
    Effect.flatMap(actor.getSnapshot, (snapshot) =>
      snapshot.status === 'error' ? Effect.die(Option.getOrUndefined(snapshot.error)) : Effect.void
    )
  );

// Upstream promise creators settle from a host `setTimeout` (the test then waits with real
// sleeps) or from a `Promise.withResolvers()` that the test resolves. No test here waits on
// wall-clock time, and `Promise.withResolvers` is outside the package's ES2022 `lib`: such a
// creator returns `promiseOf(gate)`, a Promise that settles when the test completes (or
// fails) the `gate` Deferred. For a timer, the handshake stands for the timer firing.
const promiseOf = <A, E>(gate: Deferred.Deferred<A, E>): Promise<A> =>
  Effect.runPromise(Deferred.await(gate));

// Upstream's rxjs `interval(10)` runs on the host timer, so those tests wait 40 ms of real
// time. Here the interval runs on an rxjs `VirtualTimeScheduler`: once the actor has
// subscribed to the observable (bounded yields), `flush` runs the virtual ticks at once.
const flushOnceSubscribed = (scheduler: VirtualTimeScheduler) =>
  Effect.andThen(
    yieldUntil(() => scheduler.actions.length > 0),
    Effect.sync(() => scheduler.flush())
  );

describe('promise logic (fromPromise)', () => {
  // upstream: test/actorLogic.test.ts > promise logic (fromPromise) > should interpret a promise
  it.effect('should interpret a promise', () => Effect.gen(function* () {
    // upstream resolves 'hello' from a 10 ms host `setTimeout`
    const timer = yield* Deferred.make<string>();
    const promiseLogic = fromPromise(
      () => promiseOf(timer)
    );

    const actor = (yield* Effect.tap(createActor(promiseLogic), (a) => a.start));

    // the 10 ms timer fires
    yield* Deferred.succeed(timer, 'hello');

    // `output` is an `Option` (D8, DEV-7)
    const snapshot = yield* waitFor(actor, (s) => Option.contains(s.output, 'hello'));

    expect(snapshot.output).toEqual(Option.some('hello'));
  }));
  // upstream: test/actorLogic.test.ts > promise logic (fromPromise) > should resolve
  it.effect('should resolve', () => Effect.gen(function* () {
    // upstream resolves a promise from the subscriber; here the subscriber completes a Deferred
    const resolved = yield* Deferred.make<void>();
    const actor = (yield* createActor(fromPromise(() => Promise.resolve(42))));

    yield* actor.subscribe((state) => {
      if (Option.contains(state.output, 42)) {
        return Effect.asVoid(Deferred.succeed(resolved, undefined));
      }
      return Effect.void;
    });

    (yield* actor.start);
    yield* Deferred.await(resolved);
  }));

  // upstream: test/actorLogic.test.ts > promise logic (fromPromise) > should resolve (observer .next)
  it.effect('should resolve (observer .next)', () => Effect.gen(function* () {
    const resolved = yield* Deferred.make<void>();
    const actor = (yield* createActor(fromPromise(() => Promise.resolve(42))));

    // the observer-object `subscribe` is not ported (D6, DEV-3): each element of the
    // `changes` stream stands for a call of the observer's `next`
    yield* actor.changes.pipe(
      Stream.runForEach((state) => {
        if (Option.contains(state.output, 42)) {
          return Effect.asVoid(Deferred.succeed(resolved, undefined));
        }
        return Effect.void;
      }),
      Effect.forkScoped({ startImmediately: true })
    );

    (yield* actor.start);
    yield* Deferred.await(resolved);
  }));

  // upstream: test/actorLogic.test.ts > promise logic (fromPromise) > should reject (observer .error)
  it.effect('should reject (observer .error)', () => Effect.gen(function* () {
    const actor = (yield* createActor(fromPromise(() => Promise.reject('Error'))));

    // the observer-object `subscribe` is not ported (D6, DEV-3): the `changes` stream fails
    // with the actor error, which stands for the observer's `error` argument. The fiber
    // fails instead if the stream ends without an error.
    const observer = yield* actor.changes.pipe(
      Stream.runDrain,
      Effect.flip,
      Effect.forkScoped({ startImmediately: true })
    );

    (yield* actor.start);
    const data = yield* Fiber.join(observer);
    expect(data).toBe('Error');
  }));

  // upstream: test/actorLogic.test.ts > promise logic (fromPromise) > should complete (observer .complete)
  it.effect('should complete (observer .complete)', () => Effect.gen(function* () {
    const actor = (yield* createActor(fromPromise(() => Promise.resolve(42))));
    (yield* actor.start);

    // `output` is an `Option` (D8, DEV-7)
    const snapshot = yield* waitFor(actor, (s) => Option.contains(s.output, 42));

    expect(snapshot.output).toEqual(Option.some(42));
  }));

  // upstream: test/actorLogic.test.ts > promise logic (fromPromise) > should not execute when reading initial state
  it.effect('should not execute when reading initial state', () => Effect.gen(function* () {
    let called = false;
    const logic = fromPromise(() => {
      called = true;
      return Promise.resolve(42);
    });

    const actor = (yield* createActor(logic));

    (yield* actor.getSnapshot);

    expect(called).toBe(false);
  }));

  // upstream: test/actorLogic.test.ts > promise logic (fromPromise) > should persist an unresolved promise
  it.effect('should persist an unresolved promise', () => Effect.gen(function* () {
    // upstream resolves 42 from a 10 ms host `setTimeout`
    const timer = yield* Deferred.make<number>();
    const promiseLogic = fromPromise(
      () => promiseOf(timer)
    );

    const actor = (yield* createActor(promiseLogic));
    (yield* actor.start);

    const resolvedPersistedState = (yield* actor.getPersistedSnapshot);
    (yield* actor.stop);

    const restoredActor = (yield* Effect.tap(createActor(promiseLogic, {
      snapshot: resolvedPersistedState
    }), (a) => a.start));

    // upstream sleeps 20 ms of real time, past the 10 ms timer: the timer fires, then the
    // test yields, bounded, until the restored actor has taken the settled promise
    yield* Deferred.succeed(timer, 42);
    yield* yieldUntil(() =>
      Effect.map(restoredActor.getSnapshot, (snapshot) => snapshot.status !== 'active')
    );
    // `output` is an `Option` (D8, DEV-7)
    expect((yield* restoredActor.getSnapshot).output).toEqual(Option.some(42));
  }));

  // upstream: test/actorLogic.test.ts > promise logic (fromPromise) > should persist a resolved promise
  it.effect('should persist a resolved promise', () => Effect.gen(function* () {
    const promiseLogic = fromPromise(
      () =>
        new Promise<number>((res) => {
          res(42);
        })
    );

    const actor = (yield* createActor(promiseLogic));
    (yield* actor.start);

    // upstream runs the rest from a 5 ms host `setTimeout`, after the promise has settled;
    // here the test yields, bounded, until the actor has taken the settled promise
    yield* yieldUntil(() =>
      Effect.map(actor.getSnapshot, (snapshot) => snapshot.status !== 'active')
    );

    const resolvedPersistedState = (yield* actor.getPersistedSnapshot);

    expect(resolvedPersistedState).toMatchInlineSnapshot(`
      {
        "error": undefined,
        "input": undefined,
        "output": 42,
        "status": "done",
      }
    `);

    const restoredActor = (yield* Effect.tap(createActor(promiseLogic, {
      snapshot: resolvedPersistedState
    }), (a) => a.start));
    // `output` is an `Option` (D8, DEV-7)
    expect((yield* restoredActor.getSnapshot).output).toEqual(Option.some(42));
  }));

  // upstream: test/actorLogic.test.ts > promise logic (fromPromise) > should not invoke a resolved promise again
  it.effect('should not invoke a resolved promise again', () => Effect.gen(function* () {
    let createdPromises = 0;
    const promiseLogic = fromPromise(() => {
      createdPromises++;
      return Promise.resolve(createdPromises);
    });
    const actor = (yield* createActor(promiseLogic));
    (yield* actor.start);

    // upstream waits 5 ms of real time; here the test yields, bounded, until the actor has
    // taken the settled promise
    yield* yieldUntil(() =>
      Effect.map(actor.getSnapshot, (snapshot) => snapshot.status !== 'active')
    );

    const resolvedPersistedState = (yield* actor.getPersistedSnapshot);
    expect(resolvedPersistedState).toMatchInlineSnapshot(`
      {
        "error": undefined,
        "input": undefined,
        "output": 1,
        "status": "done",
      }
    `);
    expect(createdPromises).toBe(1);

    const restoredActor = (yield* Effect.tap(createActor(promiseLogic, {
      snapshot: resolvedPersistedState
    }), (a) => a.start));

    // a second creator call would run in the actor's own fiber (C6): let it run before
    // asserting its absence
    yield* settle;

    // `output` is an `Option` (D8, DEV-7)
    expect((yield* restoredActor.getSnapshot).output).toEqual(Option.some(1));
    expect(createdPromises).toBe(1);
  }));

  // upstream: test/actorLogic.test.ts > promise logic (fromPromise) > should not invoke a rejected promise again
  it.effect('should not invoke a rejected promise again', () => Effect.gen(function* () {
    let createdPromises = 0;
    const promiseLogic = fromPromise(() => {
      createdPromises++;
      return Promise.reject(createdPromises);
    });
    const actorRef = (yield* createActor(promiseLogic));
    // the observer-object `subscribe` is not ported (D6, DEV-3): the `changes` stream fails
    // with the actor error, so consuming it and ignoring its failure stands for upstream's
    // error listener, which only keeps the error from being reported as unhandled (SD-21)
    yield* actorRef.changes.pipe(
      Stream.runDrain,
      Effect.ignore,
      Effect.forkScoped({ startImmediately: true })
    );
    (yield* actorRef.start);

    // upstream waits 5 ms of real time; here the test yields, bounded, until the actor has
    // taken the rejected promise
    yield* yieldUntil(() =>
      Effect.map(actorRef.getSnapshot, (snapshot) => snapshot.status !== 'active')
    );

    const rejectedPersistedState = (yield* actorRef.getPersistedSnapshot);
    expect(rejectedPersistedState).toMatchInlineSnapshot(`
      {
        "error": 1,
        "input": undefined,
        "output": undefined,
        "status": "error",
      }
    `);
    expect(createdPromises).toBe(1);

    const actorRef2 = (yield* createActor(promiseLogic, {
      snapshot: rejectedPersistedState
    }));
    // the error listener of upstream (see above)
    yield* actorRef2.changes.pipe(
      Stream.runDrain,
      Effect.ignore,
      Effect.forkScoped({ startImmediately: true })
    );
    (yield* actorRef2.start);

    // a second creator call would run in the actor's own fiber (C6): let it run before
    // asserting its absence
    yield* settle;

    expect(createdPromises).toBe(1);
  }));

  // upstream: test/actorLogic.test.ts > promise logic (fromPromise) > should have access to the system
  it.effect('should have access to the system', () => Effect.gen(function* () {
    expect.assertions(1);
    const promiseLogic = fromPromise(({ system }) => {
      expect(system).toBeDefined();
      return Promise.resolve(42);
    });

    const actor = (yield* Effect.tap(createActor(promiseLogic), (a) => a.start));
    yield* settleLogic(actor);
  }));

  // upstream: test/actorLogic.test.ts > promise logic (fromPromise) > should have reference to self
  it.effect('should have reference to self', () => Effect.gen(function* () {
    expect.assertions(1);

    const promiseLogic = fromPromise(({ self }) => {
      expect(self.send).toBeDefined();
      return Promise.resolve(42);
    });

    const actor = (yield* Effect.tap(createActor(promiseLogic), (a) => a.start));
    yield* settleLogic(actor);
  }));

  // upstream: test/actorLogic.test.ts > promise logic (fromPromise) > should abort when stopping
  it.effect('should abort when stopping', () => Effect.gen(function* () {
    const fn = vi.fn();
    const promiseLogic = fromPromise((ctx) => {
      return new Promise((res) => {
        ctx.signal.addEventListener('abort', fn);
      });
    });

    const actor = (yield* Effect.tap(createActor(promiseLogic), (a) => a.start));

    // upstream runs the creator inside `start`; here it runs in the actor's own fiber (C6):
    // let it register its abort listener before the actor stops
    yield* settle;

    (yield* actor.stop);

    // upstream awaits one more promise after `stop`; here the test yields, bounded, until
    // the abort listener has run
    yield* yieldUntil(() => fn.mock.calls.length > 0);
    expect(fn).toHaveBeenCalled();
  }));

  // upstream: test/actorLogic.test.ts > promise logic (fromPromise) > should not abort when stopped if promise is resolved/rejected
  it.effect('should not abort when stopped if promise is resolved/rejected', () => Effect.gen(function* () {
    // the `Promise.withResolvers` pairs of upstream become Deferred gates (see `promiseOf`)
    const resolvedDeferred = yield* Deferred.make<number>();
    const resolvedSignalListener = vi.fn();
    const resolvedPromiseLogic = fromPromise((ctx) => {
      ctx.signal.addEventListener('abort', resolvedSignalListener);
      return promiseOf(resolvedDeferred);
    });

    const rejectedDeferred = yield* Deferred.make<number, number>();
    const rejectedSignalListener = vi.fn();
    const rejectedPromiseLogic = fromPromise((ctx) => {
      ctx.signal.addEventListener('abort', rejectedSignalListener);
      return promiseOf(rejectedDeferred).catch(() => {});
    });

    const actor = (yield* Effect.tap(createActor(resolvedPromiseLogic), (a) => a.start));
    yield* Deferred.succeed(resolvedDeferred, 42);
    yield* waitFor(actor, (s) => s.status === 'done');
    (yield* actor.stop);
    // an abort would come from stopping the actor: let it run before asserting its absence
    yield* settle;
    expect(resolvedSignalListener).not.toHaveBeenCalled();

    const actor2 = (yield* Effect.tap(createActor(rejectedPromiseLogic), (a) => a.start));

    yield* Deferred.fail(rejectedDeferred, 50);
    yield* Effect.promise(() => promiseOf(rejectedDeferred).catch(() => {}));
    yield* waitFor(actor2, (s) => s.status === 'done');
    (yield* actor2.stop);
    // an abort would come from stopping the actor: let it run before asserting its absence
    yield* settle;
    expect(rejectedSignalListener).not.toHaveBeenCalled();
  }));

  // upstream: test/actorLogic.test.ts > promise logic (fromPromise) > should not reuse the same signal for different actors with same logic
  it.effect('should not reuse the same signal for different actors with same logic', () => Effect.gen(function* () {
    // the `Promise.withResolvers` pairs of upstream become Deferred gates (see `promiseOf`)
    let deferredMap: Map<string, Deferred.Deferred<number>> = new Map();
    let signalListenerMap: Map<string, Mock> = new Map();
    const p = fromPromise(({ self, signal }) => {
      const deferred = Deferred.makeUnsafe<number>();
      const signalListener = vi.fn();
      deferredMap.set(self.id, deferred);
      signalListenerMap.set(self.id, signalListener);
      signal.addEventListener('abort', signalListener);
      return promiseOf(deferred);
    });
    const machine = createMachine({
      type: 'parallel',
      states: {
        p1: {
          initial: 'running',
          states: {
            running: {
              invoke: {
                src: p,
                id: 'p1'
              },
              on: {
                CANCEL_1: 'canceled'
              }
            },
            canceled: {}
          }
        },
        p2: {
          initial: 'running',
          states: {
            running: {
              invoke: {
                src: p,
                id: 'p2',
                onDone: 'done'
              }
            },
            done: {}
          }
        }
      }
    });
    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    // upstream runs both invoked creators inside `start`; here each child runs in its own
    // fiber (D12): yield, bounded, until both creators have run
    yield* yieldUntil(() => deferredMap.size === 2);

    const p1Deferred = deferredMap.get('p1')!;
    const p2Deferred = deferredMap.get('p2')!;

    (yield* actor.send({ type: 'CANCEL_1' }));
    yield* Deferred.succeed(p1Deferred, 42);
    yield* Deferred.succeed(p2Deferred, 42);
    yield* Effect.all([
      waitFor(actor, (s) => s.matches('p1.canceled')),
      waitFor(actor, (s) => s.matches('p2.done'))
    ]);
    // the stop of child p1 and the end of child p2 run in the children's fibers: let both
    // finish before asserting (also before asserting that p2 was not aborted)
    yield* settle;
    expect(signalListenerMap.get('p1')).toHaveBeenCalled();
    expect(signalListenerMap.get('p2')).not.toHaveBeenCalled();
  }));

  // upstream: test/actorLogic.test.ts > promise logic (fromPromise) > should not reuse the same signal for different actors with same logic and id
  it.effect('should not reuse the same signal for different actors with same logic and id', () => Effect.gen(function* () {
    // the `Promise.withResolvers` pairs of upstream become Deferred gates (see `promiseOf`)
    let deferredList: Deferred.Deferred<number>[] = [];
    let signalListenerList: Mock[] = [];
    const p = fromPromise(({ signal }) => {
      const deferred = Deferred.makeUnsafe<number>();
      const fn = vi.fn();
      deferredList.push(deferred);
      signalListenerList.push(fn);
      signal.addEventListener('abort', fn);
      return promiseOf(deferred);
    });
    const machine = createMachine({
      type: 'parallel',
      states: {
        p1: {
          initial: 'running',
          states: {
            running: {
              invoke: {
                src: p,
                id: 'p'
              },
              on: {
                CANCEL_1: 'canceled'
              }
            },
            canceled: {}
          }
        },
        p2: {
          initial: 'running',
          states: {
            running: {
              invoke: {
                src: p,
                id: 'p',
                onDone: 'done'
              }
            },
            done: {}
          }
        }
      }
    });
    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    // upstream runs both invoked creators inside `start`; here each child runs in its own
    // fiber (D12): yield, bounded, until both creators have run
    yield* yieldUntil(() => deferredList.length === 2);

    const p1Deferred = deferredList[0]!;
    const p2Deferred = deferredList[1]!;
    const p1Fn = signalListenerList[0];
    const p2Fn = signalListenerList[1];

    (yield* actor.send({ type: 'CANCEL_1' }));
    yield* Deferred.succeed(p1Deferred, 42);
    yield* Deferred.succeed(p2Deferred, 42);

    yield* Effect.all([
      waitFor(actor, (s) => s.matches('p1.canceled')),
      waitFor(actor, (s) => s.matches('p2.done'))
    ]);

    // the stop of the first child and the end of the second run in the children's fibers:
    // let both finish before asserting (also before asserting that p2Fn was not called)
    yield* settle;
    expect(p1Fn).toHaveBeenCalled();
    expect(p2Fn).not.toHaveBeenCalled();
  }));

  // upstream: test/actorLogic.test.ts > promise logic (fromPromise) > should not reuse the same signal for the same actor when restarted
  it.effect('should not reuse the same signal for the same actor when restarted', () => Effect.gen(function* () {
    // the `Promise.withResolvers` pairs of upstream become Deferred gates (see `promiseOf`)
    let deferredList: Deferred.Deferred<number>[] = [];
    let signalListenerList: Mock[] = [];
    const p = fromPromise(({ signal }) => {
      const deferred = Deferred.makeUnsafe<number>();
      const fn = vi.fn();
      deferredList.push(deferred);
      signalListenerList.push(fn);
      signal.addEventListener('abort', fn);
      return promiseOf(deferred);
    });
    const machine = createMachine({
      initial: 'running',
      states: {
        running: {
          invoke: {
            src: p,
            id: 'p',
            onDone: 'done'
          },
          on: {
            cancel: 'canceled'
          }
        },
        done: {
          on: {
            restart: 'running'
          }
        },
        canceled: {
          on: {
            restart: 'running'
          }
        }
      }
    });
    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    // resolve the first promise and no canceling
    yield* waitFor(actor, (s) => s.matches('running'));
    // the invoked child runs its creator in its own fiber (D12): yield, bounded, until it has
    yield* yieldUntil(() => deferredList.length === 1);
    const deferred1 = deferredList[0]!;
    const fn1 = signalListenerList[0];
    yield* Deferred.succeed(deferred1, 42);
    yield* waitFor(actor, (s) => s.matches('done'));
    // an abort would come from stopping the done child: let it run before asserting its absence
    yield* settle;
    expect(fn1).not.toHaveBeenCalled();

    (yield* actor.send({ type: 'restart' }));

    // cancel while running
    yield* waitFor(actor, (s) => s.matches('running'));
    // the second child runs its creator in its own fiber (D12): yield, bounded, until it has
    yield* yieldUntil(() => deferredList.length === 2);
    (yield* actor.send({ type: 'cancel' }));
    yield* waitFor(actor, (s) => s.matches('canceled'));

    const deferred2 = deferredList[1]!;
    yield* Deferred.succeed(deferred2, 42);
    yield* Deferred.await(deferred2);
    // the stop of the canceled child runs in its fiber: let it finish before asserting
    yield* settle;
    const fn2 = signalListenerList[1];
    expect(fn2).toHaveBeenCalled();
  }));
});

describe('transition function logic (fromTransition)', () => {
  // upstream: test/actorLogic.test.ts > transition function logic (fromTransition) > should interpret a transition function
  it.effect('should interpret a transition function', () => Effect.gen(function* () {
    const transitionLogic = fromTransition(
      (state, event) => {
        if (event.type === 'toggle') {
          return {
            ...state,
            enabled: state.enabled === 'on' ? ('off' as const) : ('on' as const)
          };
        }

        return state;
      },
      { enabled: 'on' as 'off' | 'on' }
    );

    const actor = (yield* Effect.tap(createActor(transitionLogic), (a) => a.start));

    expect((yield* actor.getSnapshot).context.enabled).toBe('on');

    (yield* actor.send({ type: 'toggle' }));

    expect((yield* actor.getSnapshot).context.enabled).toBe('off');
  }));

  // upstream: test/actorLogic.test.ts > transition function logic (fromTransition) > should persist a transition function
  it.effect('should persist a transition function', () => Effect.gen(function* () {
    const logic = fromTransition(
      (state, event) => {
        if (event.type === 'activate') {
          return { enabled: 'on' as const };
        }
        return state;
      },
      {
        enabled: 'off' as 'off' | 'on'
      }
    );
    const actor = (yield* Effect.tap(createActor(logic), (a) => a.start));
    (yield* actor.send({ type: 'activate' }));
    const persistedSnapshot = (yield* actor.getPersistedSnapshot);

    expect(persistedSnapshot).toEqual({
      status: 'active',
      output: undefined,
      error: undefined,
      context: {
        enabled: 'on'
      }
    });

    const restoredActor = (yield* createActor(logic, { snapshot: persistedSnapshot }));

    (yield* restoredActor.start);

    expect((yield* restoredActor.getSnapshot).context.enabled).toBe('on');
  }));

  // upstream: test/actorLogic.test.ts > transition function logic (fromTransition) > should have access to the system
  it.effect('should have access to the system', () => Effect.gen(function* () {
    expect.assertions(1);
    const transitionLogic = fromTransition((_state, _event, { system }) => {
      expect(system).toBeDefined();
      return 42;
    }, 0);

    const actor = (yield* Effect.tap(createActor(transitionLogic), (a) => a.start));

    (yield* actor.send({ type: 'a' }));
    yield* settleLogic(actor);
  }));

  // upstream: test/actorLogic.test.ts > transition function logic (fromTransition) > should have reference to self
  it.effect('should have reference to self', () => Effect.gen(function* () {
    expect.assertions(1);
    const transitionLogic = fromTransition((_state, _event, { self }) => {
      expect(self.send).toBeDefined();
      return 42;
    }, 0);

    const actor = (yield* Effect.tap(createActor(transitionLogic), (a) => a.start));

    (yield* actor.send({ type: 'a' }));
    yield* settleLogic(actor);
  }));
});

describe('observable logic (fromObservable)', () => {
  // upstream: test/actorLogic.test.ts > observable logic (fromObservable) > should interpret an observable
  it.effect('should interpret an observable', () => Effect.gen(function* () {
    const scheduler = new VirtualTimeScheduler();
    const observableLogic = fromObservable(() => interval(10, scheduler).pipe(take(4)));

    const actor = (yield* Effect.tap(createActor(observableLogic), (a) => a.start));

    yield* flushOnceSubscribed(scheduler);
    const snapshot = yield* waitFor(actor, (s) => s.status === 'done');

    // `snapshot.context` of observable logic is an `Option` (SD-17, DEV-19)
    expect(snapshot.context).toEqual(Option.some(3));
  }));

  // upstream: test/actorLogic.test.ts > observable logic (fromObservable) > should resolve
  it.effect('should resolve', () => Effect.gen(function* () {
    const actor = (yield* createActor(fromObservable(() => of(42))));
    const spy = vi.fn();

    yield* actor.subscribe((snapshot) => Effect.sync(() => spy(snapshot.context)));

    (yield* actor.start);

    // upstream's `of(42)` emits inside `start`; here the observable runs in the actor's own
    // fiber (C8): yield, bounded, until the subscriber has received the value
    yield* yieldUntil(() =>
      spy.mock.calls.some(([context]) => Option.contains(context, 42))
    );

    // `snapshot.context` of observable logic is an `Option` (SD-17, DEV-19)
    expect(spy).toHaveBeenCalledWith(Option.some(42));
  }));

  // upstream: test/actorLogic.test.ts > observable logic (fromObservable) > should resolve (observer .next)
  it.effect('should resolve (observer .next)', () => Effect.gen(function* () {
    const actor = (yield* createActor(fromObservable(() => of(42))));
    const spy = vi.fn();

    // the observer-object `subscribe` is not ported (D6, DEV-3): each element of the
    // `changes` stream stands for a call of the observer's `next`; the stream ends when
    // the actor is done
    const observer = yield* actor.changes.pipe(
      Stream.runForEach((snapshot) => Effect.sync(() => spy(snapshot.context))),
      Effect.forkScoped({ startImmediately: true })
    );

    (yield* actor.start);
    yield* Fiber.join(observer);
    // `snapshot.context` of observable logic is an `Option` (SD-17, DEV-19)
    expect(spy).toHaveBeenCalledWith(Option.some(42));
  }));

  // upstream: test/actorLogic.test.ts > observable logic (fromObservable) > should reject (observer .error)
  it.effect('should reject (observer .error)', () => Effect.gen(function* () {
    const actor = (yield* createActor(
      fromObservable(() => throwError(() => 'Observable error.'))
    ));
    const spy = vi.fn();

    // the observer-object `subscribe` is not ported (D6, DEV-3): the `changes` stream fails
    // with the actor error, which the observer's `error` (the spy) receives
    const observer = yield* actor.changes.pipe(
      Stream.runDrain,
      Effect.catch((error) => Effect.sync(() => spy(error))),
      Effect.forkScoped({ startImmediately: true })
    );

    (yield* actor.start);
    yield* Fiber.join(observer);
    expect(spy.mock.calls).toMatchInlineSnapshot(`
      [
        [
          "Observable error.",
        ],
      ]
    `);
  }));

  // upstream: test/actorLogic.test.ts > observable logic (fromObservable) > should complete (observer .complete)
  it.effect('should complete (observer .complete)', () => Effect.gen(function* () {
    const actor = (yield* createActor(fromObservable(() => EMPTY)));
    const spy = vi.fn();

    // the observer-object `subscribe` is not ported (D6, DEV-3): the end of the `changes`
    // stream stands for the observer's `complete` (the spy)
    const observer = yield* actor.changes.pipe(
      Stream.runDrain,
      Effect.andThen(Effect.sync(() => spy())),
      Effect.forkScoped({ startImmediately: true })
    );

    (yield* actor.start);
    yield* Fiber.join(observer);

    expect(spy).toHaveBeenCalled();
  }));

  // upstream: test/actorLogic.test.ts > observable logic (fromObservable) > should not execute when reading initial state
  it.effect('should not execute when reading initial state', () => Effect.gen(function* () {
    let called = false;
    const logic = fromObservable(() => {
      called = true;
      return EMPTY;
    });

    const actor = (yield* createActor(logic));

    (yield* actor.getSnapshot);

    expect(called).toBe(false);
  }));

  // upstream: test/actorLogic.test.ts > observable logic (fromObservable) > should have access to the system
  it.effect('should have access to the system', () => Effect.gen(function* () {
    expect.assertions(1);
    const observableLogic = fromObservable(({ system }) => {
      expect(system).toBeDefined();
      return of(42);
    });

    const actor = (yield* Effect.tap(createActor(observableLogic), (a) => a.start));
    yield* settleLogic(actor);
  }));

  // upstream: test/actorLogic.test.ts > observable logic (fromObservable) > should have reference to self
  it.effect('should have reference to self', () => Effect.gen(function* () {
    expect.assertions(1);
    const observableLogic = fromObservable(({ self }) => {
      expect(self.send).toBeDefined();
      return of(42);
    });

    const actor = (yield* Effect.tap(createActor(observableLogic), (a) => a.start));
    yield* settleLogic(actor);
  }));
});

describe('eventObservable logic (fromEventObservable)', () => {
  // upstream: test/actorLogic.test.ts > eventObservable logic (fromEventObservable) > should have access to the system
  it.effect('should have access to the system', () => Effect.gen(function* () {
    expect.assertions(1);
    const observableLogic = fromEventObservable(({ system }) => {
      expect(system).toBeDefined();
      return of({ type: 'a' });
    });

    const actor = (yield* Effect.tap(createActor(observableLogic), (a) => a.start));
    yield* settleLogic(actor);
  }));

  // upstream: test/actorLogic.test.ts > eventObservable logic (fromEventObservable) > should have reference to self
  it.effect('should have reference to self', () => Effect.gen(function* () {
    expect.assertions(1);
    const observableLogic = fromEventObservable(({ self }) => {
      expect(self.send).toBeDefined();
      return of({ type: 'a' });
    });

    const actor = (yield* Effect.tap(createActor(observableLogic), (a) => a.start));
    yield* settleLogic(actor);
  }));
});

describe('callback logic (fromCallback)', () => {
  // upstream: test/actorLogic.test.ts > callback logic (fromCallback) > should interpret a callback
  it.effect('should interpret a callback', () => Effect.gen(function* () {
    expect.assertions(1);

    const callbackLogic = fromCallback(({ receive }) => {
      receive((event) => {
        expect(event).toEqual({ type: 'a' });
      });
    });

    const actor = (yield* Effect.tap(createActor(callbackLogic), (a) => a.start));

    (yield* actor.send({ type: 'a' }));
    yield* settleLogic(actor);
  }));

  // upstream: test/actorLogic.test.ts > callback logic (fromCallback) > should have access to the system
  it.effect('should have access to the system', () => Effect.gen(function* () {
    expect.assertions(1);
    const callbackLogic = fromCallback(({ system }) => {
      expect(system).toBeDefined();
    });

    const actor = (yield* Effect.tap(createActor(callbackLogic), (a) => a.start));
    yield* settleLogic(actor);
  }));

  // upstream: test/actorLogic.test.ts > callback logic (fromCallback) > should have reference to self
  it.effect('should have reference to self', () => Effect.gen(function* () {
    expect.assertions(1);
    const callbackLogic = fromCallback(({ self }) => {
      expect(self.send).toBeDefined();
    });

    const actor = (yield* Effect.tap(createActor(callbackLogic), (a) => a.start));
    yield* settleLogic(actor);
  }));

  // upstream: test/actorLogic.test.ts > callback logic (fromCallback) > can send self reference in an event to parent
  it.effect('can send self reference in an event to parent', () => Effect.gen(function* () {
    // upstream resolves a promise from the receive listener; here the listener (a plain
    // callback) completes a Deferred, and the test awaits it
    const ponged = yield* Deferred.make<void>();
    const machine = createMachine({
      types: {} as {
        events: { type: 'PING'; ref: AnyActorRef };
      },
      invoke: {
        src: fromCallback(({ self, sendBack, receive }) => {
          receive((event) => {
            switch (event.type) {
              case 'PONG': {
                Deferred.doneUnsafe(ponged, Effect.void);
              }
            }
          });

          sendBack({
            type: 'PING',
            ref: self
          });
        })
      },
      on: {
        PING: {
          actions: sendTo(
            ({ event }) => event.ref,
            () => ({ type: 'PONG' })
          )
        }
      }
    });

    (yield* Effect.tap(createActor(machine), (a) => a.start));
    yield* Deferred.await(ponged);
  }));

  // upstream: test/actorLogic.test.ts > callback logic (fromCallback) > should persist the input of a callback
  it.effect('should persist the input of a callback', () => Effect.gen(function* () {
    const spy = vi.fn();
    const machine = createMachine(
      {
        types: {} as { events: { type: 'EV'; data: number } },
        initial: 'a',
        states: {
          a: {
            on: {
              EV: 'b'
            }
          },
          b: {
            invoke: {
              src: 'cb',
              input: ({ event }) => event.data
            }
          }
        }
      },
      {
        actors: {
          cb: fromCallback(({ input }) => {
            spy(input);
          })
        }
      }
    );

    const actor = (yield* createActor(machine));
    (yield* actor.start);
    (yield* actor.send({
      type: 'EV',
      data: 13
    }));

    // upstream runs the invoked callback inside `send`; here the child runs in its own fiber
    // (D12): yield, bounded, until it has run, so that `mockClear` below clears its call
    yield* yieldUntil(() => spy.mock.calls.length > 0);

    const snapshot = (yield* actor.getPersistedSnapshot);

    (yield* actor.stop);

    spy.mockClear();

    const restoredActor = (yield* createActor(machine, { snapshot }));

    (yield* restoredActor.start);

    // the restored child runs its callback in its own fiber: let it run (and let a second
    // call show up) before counting the calls
    yield* settle;

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(13);
  }));
});

describe('machine logic', () => {
  // upstream: test/actorLogic.test.ts > machine logic > should persist a machine
  it.effect('should persist a machine', () => Effect.gen(function* () {
    const childMachine = createMachine({
      context: {
        count: 55
      },
      initial: 'start',
      states: {
        start: {
          invoke: {
            id: 'reducer',
            src: fromTransition((s) => s, undefined)
          }
        }
      }
    });

    const machine = createMachine({
      initial: 'waiting',
      invoke: [
        {
          id: 'a',
          src: fromPromise(() => Promise.resolve(42)),
          onDone: {
            actions: raise({ type: 'done' })
          }
        },
        {
          id: 'b',
          src: childMachine
        }
      ],
      states: {
        waiting: {
          on: {
            done: 'success'
          }
        },
        success: {}
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    yield* waitFor(actor, (s) => s.matches('success'));

    const persistedState = (yield* actor.getPersistedSnapshot)!;

    expect((persistedState as any).children.a.snapshot).toMatchInlineSnapshot(`
      {
        "error": undefined,
        "input": undefined,
        "output": 42,
        "status": "done",
      }
    `);

    expect((persistedState as any).children.b.snapshot).toEqual(
      expect.objectContaining({
        context: {
          count: 55
        },
        value: 'start',
        children: {
          reducer: expect.objectContaining({
            snapshot: {
              status: 'active'
            }
          })
        }
      })
    );
  }));

  // upstream: test/actorLogic.test.ts > machine logic > should persist and restore a nested machine
  it.effect('should persist and restore a nested machine', () => Effect.gen(function* () {
    const childMachine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            NEXT: 'b'
          }
        },
        b: {
          on: {
            LAST: 'c'
          }
        },
        c: {}
      }
    });

    const parentMachine = createMachine({
      initial: 'idle',
      states: {
        idle: {
          on: {
            START: 'invoked'
          }
        },
        invoked: {
          invoke: {
            id: 'child',
            src: childMachine
          },
          on: {
            NEXT: {
              actions: sendTo('child', { type: 'NEXT' })
            },
            LAST: {
              actions: sendTo('child', { type: 'LAST' })
            }
          }
        }
      }
    });

    const actor = (yield* Effect.tap(createActor(parentMachine), (a) => a.start));

    // parent is at 'idle'
    // ...
    (yield* actor.send({ type: 'START' }));
    // parent is at 'invoked'
    // child is at 'a'
    // ...
    (yield* actor.send({ type: 'NEXT' }));
    // child is at 'b'
    // (upstream relays NEXT to the child before `send` returns; here the `sendTo` from inside
    // the parent enqueues (SD-23): yield, bounded, until the child is at 'b')
    yield* yieldUntil(() =>
      Effect.gen(function* () {
        const childSnapshot = yield* (yield* actor.getSnapshot).children.child!.getSnapshot;
        return childSnapshot.value === 'b';
      })
    );

    const persistedSnapshot = (yield* actor.getPersistedSnapshot)!;
    const newActor = (yield* Effect.tap(createActor(parentMachine, {
      snapshot: persistedSnapshot
    }), (a) => a.start));
    const newSnapshot = (yield* newActor.getSnapshot);

    expect((yield* newSnapshot.children.child!.getSnapshot).value).toBe('b');

    // Ensure that the child actor is started
    // LAST is sent to parent which sends LAST to child
    (yield* newActor.send({ type: 'LAST' }));
    // child is at 'c'
    // (the `sendTo` enqueues (SD-23): yield, bounded, until the child is at 'c')
    yield* yieldUntil(() =>
      Effect.gen(function* () {
        const childSnapshot = yield* (yield* newActor.getSnapshot).children.child!.getSnapshot;
        return childSnapshot.value === 'c';
      })
    );

    expect((yield* (yield* newActor.getSnapshot).children.child!.getSnapshot).value).toBe('c');
  }));

  // upstream: test/actorLogic.test.ts > machine logic > should return the initial persisted state of a non-started actor
  it.effect('should return the initial persisted state of a non-started actor', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'idle',
      states: {
        idle: {}
      }
    });

    const actor = (yield* createActor(machine));

    expect((yield* actor.getPersistedSnapshot)).toEqual(
      expect.objectContaining({
        value: 'idle'
      })
    );
  }));

  // upstream: test/actorLogic.test.ts > machine logic > the initial state of a child is available before starting the parent
  it.effect('the initial state of a child is available before starting the parent', () => Effect.gen(function* () {
    const machine = createMachine({
      invoke: {
        id: 'child',
        src: createMachine({
          initial: 'inner',
          states: { inner: {} }
        })
      }
    });

    const actor = (yield* createActor(machine));

    expect(
      ((yield* actor.getPersistedSnapshot) as any).children['child'].snapshot
    ).toEqual(
      expect.objectContaining({
        value: 'inner'
      })
    );
  }));

  // upstream: test/actorLogic.test.ts > machine logic > should not invoke an actor if it is missing in persisted state
  it.effect('should not invoke an actor if it is missing in persisted state', () => Effect.gen(function* () {
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
            id: 'child',
            src: createMachine({
              context: ({ input }) => ({
                // this is only meant to showcase why we can't invoke this actor when it's missing in the persisted state
                // because we don't have access to the right input as it depends on the event that was used to enter state `b`
                value: input.deep.prop
              })
            }),
            input: ({ event }) => event.data
          }
        }
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actor.send({
      type: 'NEXT',
      data: {
        deep: {
          prop: 'value'
        }
      }
    }));

    expect((yield* actor.getSnapshot).children.child).not.toBe(undefined);
    expect((yield* (yield* actor.getSnapshot).children.child!.getSnapshot).context).toEqual({
      value: 'value'
    });

    const persisted: any = (yield* actor.getPersistedSnapshot);

    delete persisted.children['child'];

    const rehydratedActor = (yield* Effect.tap(createActor(machine, {
      snapshot: persisted
    }), (a) => a.start));

    expect((yield* rehydratedActor.getSnapshot).children.child).toBe(undefined);
  }));

  // upstream: test/actorLogic.test.ts > machine logic > should persist a spawned actor with referenced src
  it.effect('should persist a spawned actor with referenced src', () => Effect.gen(function* () {
    const reducer = fromTransition((s) => s, { count: 42 });
    const machine = createMachine({
      types: {
        context: {} as {
          ref: AnyActorRef;
        },
        actors: {} as {
          src: 'reducer';
          logic: typeof reducer;
          ids: 'child';
        }
      },
      context: ({ spawn }) => ({
        ref: spawn('reducer', { id: 'child' })
      })
    }).provide({
      actors: {
        reducer
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    const persistedSnapshot = (yield* actor.getPersistedSnapshot)!;

    expect((persistedSnapshot as any).children.child.snapshot.context).toEqual({
      count: 42
    });

    const newActor = (yield* Effect.tap(createActor(machine, {
      snapshot: persistedSnapshot
    }), (a) => a.start));

    const snapshot = (yield* newActor.getSnapshot);

    expect(snapshot.context.ref).toBe(snapshot.children.child);

    expect((yield* snapshot.context.ref.getSnapshot).context.count).toBe(42);
  }));

  // upstream: test/actorLogic.test.ts > machine logic > should not persist a spawned actor with inline src
  it.effect('should not persist a spawned actor with inline src', () => Effect.gen(function* () {
    const machine = createMachine({
      context: ({ spawn }) => {
        return {
          childRef: spawn(createMachine({}))
        };
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    // SD-3: `getPersistedSnapshot` fails its Effect with the upstream message (channel
    // `effect-failure` in test/verify/upstream-messages.ts), so the snapshot is of the
    // failure; the Effect.flip fails the test if the persist succeeds
    expect(
      yield* Effect.flip(actorRef.getPersistedSnapshot)
    ).toMatchInlineSnapshot(
      `[Error: An inline child actor cannot be persisted.]`
    );
  }));

  // upstream: test/actorLogic.test.ts > machine logic > should have access to the system
  it.effect('should have access to the system', () => Effect.gen(function* () {
    expect.assertions(1);
    const machine = createMachine({
      entry: ({ system }) => {
        expect(system).toBeDefined();
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
    yield* settleLogic(actor);
  }));
});

// `transition` of actor logic returns an Effect (SD-13; the port's `ActorLogic`), so a
// wrapper that reads the next snapshot maps over that Effect; a wrapper that only passes the
// call through stays as upstream. The port's `transition` takes the snapshot and the event
// only: the actor scope comes from the Effect context (`ActorScope`; SPEC context.md, API
// patterns), so a wrapper passes no third argument.
describe('composable actor logic', () => {
  // upstream: test/actorLogic.test.ts > composable actor logic > should work with machines
  it.effect('should work with machines', () => Effect.gen(function* () {
    const logs: string[] = [];

    function withLogs<T extends AnyActorLogic>(actorLogic: T): T {
      return {
        ...actorLogic,
        transition: (state, event) => {
          logs.push(event.type);

          return actorLogic.transition(state, event);
        }
      };
    }

    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: { to_b: 'b' }
        },
        b: {
          on: { to_c: 'c' }
        },
        c: {
          on: { to_a: 'a' }
        }
      }
    });

    const actor = (yield* Effect.tap(createActor(withLogs(machine)), (a) => a.start));

    (yield* actor.send({ type: 'to_b' }));
    (yield* actor.send({ type: 'to_c' }));
    (yield* actor.send({ type: 'to_a' }));

    expect(logs).toEqual(['to_b', 'to_c', 'to_a']);
  }));

  // upstream: test/actorLogic.test.ts > composable actor logic > should work with promises
  it.effect('should work with promises', () => Effect.gen(function* () {
    const logs: any[] = [];

    function withLogs<T extends AnyActorLogic>(actorLogic: T): T {
      return {
        ...actorLogic,
        transition: (state: Snapshot<unknown>, event) =>
          Effect.map(actorLogic.transition(state, event), (s) => {
            logs.push(s.output);

            return s;
          })
      };
    }

    const promiseLogic = fromPromise(() => Promise.resolve(42));

    const actor = (yield* Effect.tap(createActor(withLogs(promiseLogic)), (a) => a.start));

    yield* waitFor(actor, (s) => s.status === 'done');

    // `output` is an `Option` (D8, DEV-7)
    expect(logs).toEqual([Option.some(42)]);
  }));

  // upstream: test/actorLogic.test.ts > composable actor logic > should work with functions
  it.effect('should work with functions', () => Effect.gen(function* () {
    const logs: any[] = [];

    function withLogs<T extends AnyActorLogic>(actorLogic: T): T {
      return {
        ...actorLogic,
        transition: (state: Snapshot<unknown>, event) =>
          Effect.map(actorLogic.transition(state, event), (s) => {
            logs.push(s.context);

            return s;
          })
      };
    }

    const transitionLogic = fromTransition(
      (_, ev: { type: string; value: number }) => ev.value,
      0
    );

    const actor = (yield* Effect.tap(createActor(withLogs(transitionLogic)), (a) => a.start));

    (yield* actor.send({ type: 'a', value: 42 }));

    expect(logs).toEqual([42]);
  }));

  // upstream: test/actorLogic.test.ts > composable actor logic > should work with observables
  it.effect('should work with observables', () => Effect.gen(function* () {
    const logs: any[] = [];

    function withLogs<T extends AnyActorLogic>(actorLogic: T): T {
      return {
        ...actorLogic,
        transition: (state: Snapshot<unknown>, event) =>
          Effect.map(actorLogic.transition(state, event), (s) => {
            if (s.status === 'active') {
              logs.push(s.context);
            }

            return s;
          })
      };
    }

    const scheduler = new VirtualTimeScheduler();
    const observableLogic = fromObservable(() => interval(10, scheduler).pipe(take(4)));

    const actor = (yield* Effect.tap(createActor(withLogs(observableLogic)), (a) => a.start));

    // the observer-object `subscribe` is not ported (D6, DEV-3): the end of the `changes`
    // stream stands for the observer's `complete`; upstream asserts inside `complete`, here
    // the test asserts once the stream has ended
    const observer = yield* actor.changes.pipe(
      Stream.runDrain,
      Effect.forkScoped({ startImmediately: true })
    );
    yield* flushOnceSubscribed(scheduler);
    yield* Fiber.join(observer);
    // `snapshot.context` of observable logic is an `Option` (SD-17, DEV-19)
    expect(logs).toEqual([Option.some(0), Option.some(1), Option.some(2), Option.some(3)]);
  }));

  // upstream: test/actorLogic.test.ts > composable actor logic > higher-level logic wrapping a machine should be able to persist a snapshot
  it.effect('higher-level logic wrapping a machine should be able to persist a snapshot', () => Effect.gen(function* () {
    const logged: any[] = [];
    function withLogging<T extends ActorLogic<any, any>>(actorLogic: T) {
      const enhancedLogic: T = {
        ...actorLogic,
        transition: (state, event) => {
          logged.push(event.type);
          return actorLogic.transition(state, event);
        }
      };

      return enhancedLogic;
    }

    const machine = createMachine({
      initial: 'start',
      states: {
        start: {
          on: { next: 'working' }
        },
        working: {
          on: { more: 'done' }
        },
        done: {}
      }
    });

    const actor = (yield* Effect.tap(createActor(withLogging(machine)), (a) => a.start));

    (yield* actor.send({ type: 'next' }));
    (yield* actor.send({ type: 'more' }));

    expect(logged).toEqual(['next', 'more']);

    expect((yield* actor.getSnapshot).value).toBe('done');

    // `getPersistedSnapshot` is an Effect (D6): "does not throw" is an Exit that is a success
    const persisted = yield* Effect.exit(actor.getPersistedSnapshot);
    expect(Exit.isSuccess(persisted)).toBe(true);

    expect((yield* actor.getPersistedSnapshot)).toEqual(
      expect.objectContaining({
        status: 'active',
        value: 'done'
      })
    );
  }));
});
