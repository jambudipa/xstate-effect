import { describe, expect, it, vi } from "@effect/vitest"
import { Effect, Exit, Option, Stream } from "effect"
import { BehaviorSubject } from 'rxjs';
import {
  createMachine,
  createActor,
  fromPromise,
  fromObservable,
  assign,
  sendTo,
  type AnyActorRef
} from "../../src/index.js";

// Upstream delivers the events that actors send to each other (child snapshots, done and
// error notifications, `sendTo`) before the outer call returns. Here a send from inside an
// actor enqueues without waiting (SD-23), and a `changes` consumer runs in its own fiber,
// so a test yields its fiber, at most 100 times and never on wall-clock time, until the
// delivery it needs has happened.
const yieldUntil = (done: () => boolean | Effect.Effect<boolean>) =>
  Effect.yieldNow.pipe(Effect.repeat({ until: done, times: 100 }));

// Before an assertion that something did NOT happen: give every enqueued delivery the
// chance to run, so that the assertion is not vacuous.
const settle = yieldUntil(() => false);

describe('rehydration', () => {
  describe('using persisted state', () => {
    // upstream: test/rehydration.test.ts > rehydration > using persisted state > should be able to use `hasTag` immediately
    it.effect('should be able to use `hasTag` immediately', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'a',
        states: {
          a: {
            tags: 'foo'
          }
        }
      });

      const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
      const persistedState = JSON.stringify((yield* actorRef.getPersistedSnapshot));
      (yield* actorRef.stop);

      const service = (yield* Effect.tap(createActor(machine, {
        snapshot: JSON.parse(persistedState)
      }), (a) => a.start));

      expect((yield* service.getSnapshot).hasTag('foo')).toBe(true);
    }));

    // upstream: test/rehydration.test.ts > rehydration > using persisted state > should not call exit actions when machine gets stopped immediately
    it.effect('should not call exit actions when machine gets stopped immediately', () => Effect.gen(function* () {
      const actual: string[] = [];
      const machine = createMachine({
        exit: () => actual.push('root'),
        initial: 'a',
        states: {
          a: {
            exit: () => actual.push('a')
          }
        }
      });

      const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
      const persistedState = JSON.stringify((yield* actorRef.getPersistedSnapshot));
      (yield* actorRef.stop);

      const restored = (yield* Effect.tap(createActor(machine, { snapshot: JSON.parse(persistedState) }), (a) => a.start));
      (yield* restored.stop);

      expect(actual).toEqual([]);
    }));

    // upstream: test/rehydration.test.ts > rehydration > using persisted state > should get correct result back from `can` immediately
    it.effect('should get correct result back from `can` immediately', () => Effect.gen(function* () {
      const machine = createMachine({
        on: {
          FOO: {
            actions: () => {}
          }
        }
      });

      // as upstream, the snapshot itself (not the persisted snapshot) goes through JSON:
      // `JSON.stringify` reads its synchronous `toJSON` (SD-6)
      const persistedState = JSON.stringify(
        (yield* (yield* Effect.tap(createActor(machine), (a) => a.start)).getSnapshot)
      );
      const restoredState = JSON.parse(persistedState);
      const service = (yield* Effect.tap(createActor(machine, {
        snapshot: restoredState
      }), (a) => a.start));

      expect((yield* (yield* service.getSnapshot).can({ type: 'FOO' }))).toBe(true);
    }));
  });

  describe('using state value', () => {
    // upstream: test/rehydration.test.ts > rehydration > using state value > should be able to use `hasTag` immediately
    it.effect('should be able to use `hasTag` immediately', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'inactive',
        states: {
          inactive: {
            on: { NEXT: 'active' }
          },
          active: {
            tags: 'foo'
          }
        }
      });

      const activeState = (yield* machine.resolveState({ value: 'active' }));
      const service = (yield* createActor(machine, {
        snapshot: activeState
      }));

      (yield* service.start);

      expect((yield* service.getSnapshot).hasTag('foo')).toBe(true);
    }));

    // upstream: test/rehydration.test.ts > rehydration > using state value > should not call exit actions when machine gets stopped immediately
    it.effect('should not call exit actions when machine gets stopped immediately', () => Effect.gen(function* () {
      const actual: string[] = [];
      const machine = createMachine({
        exit: () => actual.push('root'),
        initial: 'inactive',
        states: {
          inactive: {
            on: { NEXT: 'active' }
          },
          active: {
            exit: () => actual.push('active')
          }
        }
      });

      const restored = (yield* Effect.tap(createActor(machine, {
        snapshot: (yield* machine.resolveState({ value: 'active' }))
      }), (a) => a.start));
      (yield* restored.stop);

      expect(actual).toEqual([]);
    }));

    // upstream: test/rehydration.test.ts > rehydration > using state value > should error on incompatible state value (shallow)
    it.effect('should error on incompatible state value (shallow)', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'valid',
        states: {
          valid: {}
        }
      });

      // SD-3 (amended 2026-10-08): `resolveState` with an invalid state value fails its Effect
      expect(
        (yield* Effect.flip(machine.resolveState({ value: 'invalid' }))).message
      ).toMatch(/invalid/);
    }));

    // upstream: test/rehydration.test.ts > rehydration > using state value > should error on incompatible state value (deep)
    it.effect('should error on incompatible state value (deep)', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'parent',
        states: {
          parent: {
            initial: 'valid',
            states: {
              valid: {}
            }
          }
        }
      });

      // SD-3 (amended 2026-10-08): `resolveState` with an invalid state value fails its Effect
      expect(
        (yield* Effect.flip(machine.resolveState({ value: { parent: 'invalid' } }))).message
      ).toMatch(/invalid/);
    }));
  });

  // upstream: test/rehydration.test.ts > rehydration > should not replay actions when starting from a persisted state
  it.effect('should not replay actions when starting from a persisted state', () => Effect.gen(function* () {
    const entrySpy = vi.fn();
    const machine = createMachine({
      entry: entrySpy
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(entrySpy).toHaveBeenCalledTimes(1);

    const persistedState = (yield* actor.getPersistedSnapshot);

    (yield* actor.stop);

    (yield* Effect.tap(createActor(machine, { snapshot: persistedState }), (a) => a.start));

    expect(entrySpy).toHaveBeenCalledTimes(1);
  }));

  // upstream: test/rehydration.test.ts > rehydration > should be able to stop a rehydrated child
  it.effect('should be able to stop a rehydrated child', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          invoke: {
            src: fromPromise(() => Promise.resolve(11)),
            onDone: 'b'
          },
          on: {
            NEXT: 'c'
          }
        },
        b: {},
        c: {}
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
    const persistedState = (yield* actor.getPersistedSnapshot);
    (yield* actor.stop);

    const rehydratedActor = (yield* Effect.tap(createActor(machine, {
      snapshot: persistedState
    }), (a) => a.start));

    // `send` is an Effect (D6): "does not throw" is an Exit that is a success, which also
    // excludes a defect raised while stopping the rehydrated child
    const sent = yield* Effect.exit(
      rehydratedActor.send({
        type: 'NEXT'
      })
    );
    expect(Exit.isSuccess(sent)).toBe(true);

    expect((yield* rehydratedActor.getSnapshot).value).toBe('c');
  }));

  // upstream: test/rehydration.test.ts > rehydration > a rehydrated active child should be registered in the system
  it.effect('a rehydrated active child should be registered in the system', () => Effect.gen(function* () {
    const machine = createMachine(
      {
        context: ({ spawn }) => {
          spawn('foo', {
            systemId: 'mySystemId'
          });
          return {};
        }
      },
      {
        actors: {
          foo: createMachine({})
        }
      }
    );

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
    const persistedState = (yield* actor.getPersistedSnapshot);
    (yield* actor.stop);

    const rehydratedActor = (yield* Effect.tap(createActor(machine, {
      snapshot: persistedState
    }), (a) => a.start));

    // `system.get` gives `Effect<Option<ActorRef>>` (D7, DEV-6): "defined" is `Some`
    expect(Option.isSome(yield* rehydratedActor.system.get('mySystemId'))).toBe(true);
  }));

  // upstream: test/rehydration.test.ts > rehydration > a rehydrated done child should not be registered in the system
  it.effect('a rehydrated done child should not be registered in the system', () => Effect.gen(function* () {
    const machine = createMachine(
      {
        context: ({ spawn }) => {
          spawn('foo', {
            systemId: 'mySystemId'
          });
          return {};
        }
      },
      {
        actors: {
          foo: createMachine({ type: 'final' })
        }
      }
    );

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
    const persistedState = (yield* actor.getPersistedSnapshot);
    (yield* actor.stop);

    const rehydratedActor = (yield* Effect.tap(createActor(machine, {
      snapshot: persistedState
    }), (a) => a.start));

    // `system.get` gives `Effect<Option<ActorRef>>` (D7, DEV-6): "undefined" is `None`
    expect(yield* rehydratedActor.system.get('mySystemId')).toEqual(Option.none());
  }));

  // upstream: test/rehydration.test.ts > rehydration > a rehydrated done child should not re-notify the parent about its completion
  it.effect('a rehydrated done child should not re-notify the parent about its completion', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine(
      {
        context: ({ spawn }) => {
          spawn('foo', {
            systemId: 'mySystemId'
          });
          return {};
        },
        on: {
          '*': {
            actions: spy
          }
        }
      },
      {
        actors: {
          foo: createMachine({ type: 'final' })
        }
      }
    );

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
    const persistedState = (yield* actor.getPersistedSnapshot);
    (yield* actor.stop);

    spy.mockClear();

    (yield* Effect.tap(createActor(machine, {
      snapshot: persistedState
    }), (a) => a.start));

    // a re-notification would be enqueued (SD-23): let it run before asserting its absence
    yield* settle;

    expect(spy).not.toHaveBeenCalled();
  }));

  // upstream: test/rehydration.test.ts > rehydration > should be possible to persist a rehydrated actor that got its children rehydrated
  it.effect('should be possible to persist a rehydrated actor that got its children rehydrated', () => Effect.gen(function* () {
    const machine = createMachine(
      {
        invoke: {
          src: 'foo'
        }
      },
      {
        actors: {
          foo: fromPromise(() => Promise.resolve(42))
        }
      }
    );

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    const rehydratedActor = (yield* Effect.tap(createActor(machine, {
      snapshot: (yield* actor.getPersistedSnapshot)
    }), (a) => a.start));

    const persistedChildren = ((yield* rehydratedActor.getPersistedSnapshot) as any)
      .children;
    expect(Object.keys(persistedChildren).length).toBe(1);
    expect((Object.values(persistedChildren)[0] as any).src).toBe('foo');
  }));

  // upstream: test/rehydration.test.ts > rehydration > should complete on a rehydrated final state
  it.effect('should complete on a rehydrated final state', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'foo',
      states: {
        foo: {
          on: { NEXT: 'bar' }
        },
        bar: {
          type: 'final'
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'NEXT' }));
    const persistedState = (yield* actorRef.getPersistedSnapshot);

    const spy = vi.fn();
    const actorRef2 = (yield* createActor(machine, { snapshot: persistedState }));
    // the observer-object `subscribe` is not ported (D6, DEV-3): the `changes` stream ends
    // when the actor is done, so the end of the stream stands for the observer's `complete`
    yield* actorRef2.changes.pipe(
      Stream.runDrain,
      Effect.andThen(Effect.sync(() => spy())),
      Effect.forkScoped({ startImmediately: true })
    );

    (yield* actorRef2.start);
    // the stream consumer runs in its own fiber: let it see the end of the stream
    yield* yieldUntil(() => spy.mock.calls.length > 0);
    expect(spy).toHaveBeenCalled();
  }));

  // upstream: test/rehydration.test.ts > rehydration > should error on a rehydrated error state
  it.effect('should error on a rehydrated error state', () => Effect.gen(function* () {
    const machine = createMachine(
      {
        invoke: {
          src: 'failure'
        }
      },
      {
        actors: {
          failure: fromPromise(() => Promise.reject(new Error('failure')))
        }
      }
    );

    const actorRef = (yield* createActor(machine));
    // the observer-object `subscribe` is not ported (D6, DEV-3): the `changes` stream fails
    // with the actor error, so consuming it and ignoring its failure stands for upstream's
    // error listener, which only keeps the error from being reported as unhandled (SD-21)
    yield* actorRef.changes.pipe(
      Stream.runDrain,
      Effect.ignore,
      Effect.forkScoped({ startImmediately: true })
    );
    (yield* actorRef.start);

    // wait a macrotask for the microtask related to the promise to be processed
    // (here: yield, bounded, until the rejection has put the actor in status 'error')
    yield* yieldUntil(() =>
      Effect.map(actorRef.getSnapshot, (snapshot) => snapshot.status === 'error')
    );

    const persistedState = (yield* actorRef.getPersistedSnapshot);

    const spy = vi.fn();
    const actorRef2 = (yield* createActor(machine, { snapshot: persistedState }));
    // the observer's `error` callback: called with the error the `changes` stream fails with
    yield* actorRef2.changes.pipe(
      Stream.runDrain,
      Effect.catch((error) => Effect.sync(() => spy(error))),
      Effect.forkScoped({ startImmediately: true })
    );
    (yield* actorRef2.start);

    // the stream consumer runs in its own fiber: let it see the failure of the stream
    yield* yieldUntil(() => spy.mock.calls.length > 0);
    expect(spy).toHaveBeenCalled();
  }));

  // upstream: test/rehydration.test.ts > rehydration > shouldn't re-notify the parent about the error when rehydrating
  it.effect(`shouldn't re-notify the parent about the error when rehydrating`, () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine(
      {
        invoke: {
          src: 'failure',
          onError: {
            actions: spy
          }
        }
      },
      {
        actors: {
          failure: fromPromise(() => Promise.reject(new Error('failure')))
        }
      }
    );

    const actorRef = (yield* createActor(machine));
    (yield* actorRef.start);

    // wait a macrotask for the microtask related to the promise to be processed
    // (here: yield, bounded, until the parent has run its `onError` action)
    yield* yieldUntil(() => spy.mock.calls.length > 0);

    const persistedState = (yield* actorRef.getPersistedSnapshot);
    spy.mockClear();

    const actorRef2 = (yield* createActor(machine, { snapshot: persistedState }));
    (yield* actorRef2.start);

    // a re-notification would be enqueued (SD-23): let it run before asserting its absence
    yield* settle;

    expect(spy).not.toHaveBeenCalled();
  }));

  // upstream: test/rehydration.test.ts > rehydration > should continue syncing snapshots
  it.effect('should continue syncing snapshots', () => Effect.gen(function* () {
    const subject = new BehaviorSubject(0);
    const subjectLogic = fromObservable(() => subject);

    const spy = vi.fn();

    const machine = createMachine(
      {
        types: {} as {
          actors: {
            src: 'service';
            logic: typeof subjectLogic;
          };
        },

        invoke: [
          {
            src: 'service',
            onSnapshot: {
              actions: [({ event }) => spy(event.snapshot.context)]
            }
          }
        ]
      },
      {
        actors: {
          service: subjectLogic
        }
      }
    );

    (yield* Effect.tap(createActor(machine, {
      snapshot: (yield* (yield* createActor(machine)).getPersistedSnapshot)
    }), (a) => a.start));

    // upstream syncs the subject's current value (0) to the parent inside `start`; here the
    // child's snapshot event is enqueued (SD-23): let it arrive before the spy is cleared
    yield* yieldUntil(() => spy.mock.calls.length > 0);

    spy.mockClear();

    subject.next(42);
    subject.next(100);

    // the two snapshot events are enqueued (SD-23): let both arrive
    yield* yieldUntil(() => spy.mock.calls.length >= 2);

    // `snapshot.context` of observable logic is an `Option` (SD-17, DEV-19)
    expect(spy.mock.calls).toEqual([[Option.some(42)], [Option.some(100)]]);
  }));

  // upstream: test/rehydration.test.ts > rehydration > should be able to rehydrate an actor deep in the tree
  it.effect('should be able to rehydrate an actor deep in the tree', () => Effect.gen(function* () {
    const grandchild = createMachine({
      context: {
        count: 0
      },
      on: {
        INC: {
          actions: assign({
            count: ({ context }) => context.count + 1
          })
        }
      }
    });
    const child = createMachine(
      {
        invoke: {
          src: 'grandchild',
          id: 'grandchild'
        },
        on: {
          INC: {
            actions: sendTo('grandchild', {
              type: 'INC'
            })
          }
        }
      },
      {
        actors: {
          grandchild
        }
      }
    );
    const machine = createMachine(
      {
        invoke: {
          src: 'child',
          id: 'child'
        },
        on: {
          INC: {
            actions: sendTo('child', {
              type: 'INC'
            })
          }
        }
      },
      {
        actors: {
          child
        }
      }
    );

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'INC' }));

    // upstream relays INC down to the grandchild before `send` returns; here each `sendTo`
    // from inside an actor enqueues (SD-23): let the grandchild count before persisting
    yield* yieldUntil(() =>
      Effect.gen(function* () {
        // upstream reads `.getSnapshot()` of an `any` grandchild; `getSnapshot` is an Effect
        // here (D6), and an `any` cannot be yielded, so the grandchild is named an `AnyActorRef`
        const childSnapshot = yield* (yield* actorRef.getSnapshot).children.child!.getSnapshot;
        return (yield* (childSnapshot.children.grandchild as AnyActorRef).getSnapshot).context.count === 1;
      })
    );

    const persistedState = (yield* actorRef.getPersistedSnapshot);
    const actorRef2 = (yield* createActor(machine, { snapshot: persistedState }));

    const childSnapshot2 = (yield* (yield* actorRef2.getSnapshot).children.child!.getSnapshot);
    expect(
      (yield* (childSnapshot2.children.grandchild as AnyActorRef).getSnapshot).context.count
    ).toBe(1);
  }));
});
