import { describe, expect, it, vi } from "@effect/vitest"
import { Cause, Deferred, Effect, Logger } from "effect"
import { TestClock } from "effect/testing"
import {
  AnyEventObject,
  createActor,
  createMachine,
  emit,
  enqueueActions,
  fromCallback,
  fromEventObservable,
  fromObservable,
  fromPromise,
  fromTransition,
  setup
} from "../../src/index.js";

// Upstream mocks `reportUnhandledError` (`vi.mock('../src/reportUnhandledError.ts')`) so a
// throwing `actor.on` listener prints to the console instead of rethrowing globally. The
// port never rethrows: it reports the listener error through the actor's logger
// (`Effect.logError` by default) and leaves the actor status alone (SD-21). This test logger
// replaces the module mock; it keeps every log entry so a test can assert on the report.
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

// Upstream non-machine logic emits before `start` (or `send`) returns. Here that logic runs
// in the actor's own fiber (C6, C10) and its emissions reach the listeners from that fiber
// without another transition (A7), so yield, bounded, until the listener has run.
const untilCalled = (spy: { readonly mock: { readonly calls: ReadonlyArray<unknown> } }) =>
  Effect.yieldNow.pipe(Effect.repeat({ until: () => spy.mock.calls.length > 0, times: 100 }));

describe('event emitter', () => {
  // upstream: test/emit.test.ts > event emitter > only emits expected events if specified in setup
  it.effect('only emits expected events if specified in setup', () => Effect.gen(function* () {
    setup({
      types: {
        emitted: {} as { type: 'greet'; message: string }
      }
    }).createMachine({
      // @ts-expect-error
      entry: emit({ type: 'nonsense' }),
      // @ts-expect-error
      exit: emit({ type: 'greet', message: 1234 }),

      on: {
        someEvent: {
          actions: emit({ type: 'greet', message: 'hello' })
        }
      }
    });
  }));

  // upstream: test/emit.test.ts > event emitter > emits any events if not specified in setup (unsafe)
  it.effect('emits any events if not specified in setup (unsafe)', () => Effect.gen(function* () {
    createMachine({
      entry: emit({ type: 'nonsense' }),
      exit: emit({ type: 'greet', message: 1234 }),
      on: {
        someEvent: {
          actions: emit({ type: 'greet', message: 'hello' })
        }
      }
    });
  }));

  // upstream: test/emit.test.ts > event emitter > emits events that can be listened to on actorRef.on(…)
  it.effect('emits events that can be listened to on actorRef.on(…)', () => Effect.gen(function* () {
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

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
    // upstream resolves a promise from the listener and sends from a `setTimeout` once the
    // listener is registered; the Effect form completes a Deferred from the scoped listener,
    // sends after the listener is registered, then awaits the Deferred
    const received = yield* Deferred.make<AnyEventObject>();
    yield* actor.on('emitted', (ev) => Effect.asVoid(Deferred.succeed(received, ev)));
    (yield* actor.send({
      type: 'someEvent'
    }));
    const event = yield* Deferred.await(received);

    expect(event.foo).toBe('bar');
  }));

  // upstream: test/emit.test.ts > event emitter > enqueue.emit(…) emits events that can be listened to on actorRef.on(…)
  it.effect('enqueue.emit(…) emits events that can be listened to on actorRef.on(…)', () => Effect.gen(function* () {
    const machine = setup({
      types: {
        emitted: {} as { type: 'emitted'; foo: string }
      }
    }).createMachine({
      on: {
        someEvent: {
          actions: enqueueActions(({ enqueue }) => {
            enqueue.emit({ type: 'emitted', foo: 'bar' });

            enqueue.emit({
              // @ts-expect-error
              type: 'unknown'
            });
          })
        }
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
    // upstream resolves a promise from the listener and sends from a `setTimeout`; the
    // Effect form completes a Deferred from the scoped listener (see the test above)
    const received = yield* Deferred.make<AnyEventObject>();
    yield* actor.on('emitted', (ev) => Effect.asVoid(Deferred.succeed(received, ev)));
    (yield* actor.send({
      type: 'someEvent'
    }));
    const event = yield* Deferred.await(received);

    expect(event.foo).toBe('bar');
  }));

  // upstream: test/emit.test.ts > event emitter > handles errors
  it.effect('handles errors', () => {
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

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
      // the listener throws inside its Effect, as upstream's listener throws
      yield* actor.on('emitted', () => Effect.sync(() => {
        throw new Error('oops');
      }));
      // upstream sends from a `setTimeout` after the listener is registered
      (yield* actor.send({
        type: 'someEvent'
      }));

      // upstream waits 10 ms of real time; the Effect form advances the test clock
      yield* TestClock.adjust("10 millis");

      expect((yield* actor.getSnapshot).status).toEqual('active');

      // SD-21: the test logger, not a module mock, receives the listener error, once
      const reported = logged.filter((entry) => entry.logLevel === 'Error');
      expect(reported).toHaveLength(1);
      expect(reportedValues(reported[0]!)).toContainEqual(new Error('oops'));
    }).pipe(Effect.provide(testLogger(logged)));
  });

  // upstream: test/emit.test.ts > event emitter > dynamically emits events that can be listened to on actorRef.on(…)
  it.effect('dynamically emits events that can be listened to on actorRef.on(…)', () => Effect.gen(function* () {
    const machine = createMachine({
      context: { count: 10 },
      on: {
        someEvent: {
          actions: emit(({ context }) => ({
            type: 'emitted',
            count: context.count
          }))
        }
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
    // upstream resolves a promise from the listener and sends from a `setTimeout`; the
    // Effect form completes a Deferred from the scoped listener
    const received = yield* Deferred.make<AnyEventObject>();
    yield* actor.on('emitted', (ev) => Effect.asVoid(Deferred.succeed(received, ev)));
    (yield* actor.send({
      type: 'someEvent'
    }));
    const event = yield* Deferred.await(received);

    expect(event).toEqual({
      type: 'emitted',
      count: 10
    });
  }));

  // upstream: test/emit.test.ts > event emitter > listener should be able to read the updated snapshot of the emitting actor
  it.effect('listener should be able to read the updated snapshot of the emitting actor', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            ev: {
              actions: emit({ type: 'someEvent' }),
              target: 'b'
            }
          }
        },
        b: {}
      }
    });

    const actor = (yield* createActor(machine));
    yield* actor.on('someEvent', () => Effect.gen(function* () {
      spy((yield* actor.getSnapshot).value);
    }));

    (yield* actor.start);
    (yield* actor.send({ type: 'ev' }));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('b');
  }));

  // upstream: test/emit.test.ts > event emitter > wildcard listeners should be able to receive all emitted events
  it.effect('wildcard listeners should be able to receive all emitted events', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = setup({
      types: {
        events: {} as { type: 'event' },
        emitted: {} as { type: 'emitted' } | { type: 'anotherEmitted' }
      }
    }).createMachine({
      on: {
        event: {
          actions: emit({ type: 'emitted' })
        }
      }
    });

    const actor = (yield* createActor(machine));

    yield* actor.on('*', (ev) => Effect.sync(() => {
      ev.type satisfies 'emitted' | 'anotherEmitted';

      // @ts-expect-error
      ev.type satisfies 'whatever';
      spy(ev);
    }));

    (yield* actor.start);

    (yield* actor.send({ type: 'event' }));

    expect(spy).toHaveBeenCalledTimes(1);
  }));

  // upstream: test/emit.test.ts > event emitter > events can be emitted from promise logic
  it.effect('events can be emitted from promise logic', () => Effect.gen(function* () {
    const spy = vi.fn();

    const logic = fromPromise<any, any, { type: 'emitted'; msg: string }>(
      async ({ emit }) => {
        emit({
          type: 'emitted',
          msg: 'hello'
        });
      }
    );

    const actor = (yield* createActor(logic));

    yield* actor.on('emitted', (ev) => Effect.sync(() => {
      ev.type satisfies 'emitted';

      // @ts-expect-error
      ev.type satisfies 'whatever';

      ev satisfies { msg: string };

      spy(ev);
    }));

    (yield* actor.start);
    yield* untilCalled(spy);

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'emitted',
        msg: 'hello'
      })
    );
  }));

  // upstream: test/emit.test.ts > event emitter > events can be emitted from transition logic
  it.effect('events can be emitted from transition logic', () => Effect.gen(function* () {
    const spy = vi.fn();

    const logic = fromTransition<
      any,
      any,
      any,
      any,
      { type: 'emitted'; msg: string }
    >((s, e, { emit }) => {
      if (e.type === 'emit') {
        emit({
          type: 'emitted',
          msg: 'hello'
        });
      }
      return s;
    }, {});

    const actor = (yield* createActor(logic));

    yield* actor.on('emitted', (ev) => Effect.sync(() => {
      ev.type satisfies 'emitted';

      // @ts-expect-error
      ev.type satisfies 'whatever';

      ev satisfies { msg: string };

      spy(ev);
    }));

    (yield* actor.start);

    (yield* actor.send({ type: 'emit' }));
    yield* untilCalled(spy);

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'emitted',
        msg: 'hello'
      })
    );
  }));

  // upstream: test/emit.test.ts > event emitter > events can be emitted from observable logic
  it.effect('events can be emitted from observable logic', () => Effect.gen(function* () {
    const spy = vi.fn();

    const logic = fromObservable<any, any, { type: 'emitted'; msg: string }>(
      ({ emit }) => {
        emit({
          type: 'emitted',
          msg: 'hello'
        });

        return {
          subscribe: () => {
            return {
              unsubscribe: () => {}
            };
          }
        };
      }
    );

    const actor = (yield* createActor(logic));

    yield* actor.on('emitted', (ev) => Effect.sync(() => {
      ev.type satisfies 'emitted';

      // @ts-expect-error
      ev.type satisfies 'whatever';

      ev satisfies { msg: string };

      spy(ev);
    }));

    (yield* actor.start);
    yield* untilCalled(spy);

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'emitted',
        msg: 'hello'
      })
    );
  }));

  // upstream: test/emit.test.ts > event emitter > events can be emitted from event observable logic
  it.effect('events can be emitted from event observable logic', () => Effect.gen(function* () {
    const spy = vi.fn();

    const logic = fromEventObservable<
      any,
      any,
      { type: 'emitted'; msg: string }
    >(({ emit }) => {
      emit({
        type: 'emitted',
        msg: 'hello'
      });

      return {
        subscribe: () => {
          return {
            unsubscribe: () => {}
          };
        }
      };
    });

    const actor = (yield* createActor(logic));

    yield* actor.on('emitted', (ev) => Effect.sync(() => {
      ev.type satisfies 'emitted';

      // @ts-expect-error
      ev.type satisfies 'whatever';

      ev satisfies { msg: string };

      spy(ev);
    }));

    (yield* actor.start);
    yield* untilCalled(spy);

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'emitted',
        msg: 'hello'
      })
    );
  }));

  // upstream: test/emit.test.ts > event emitter > events can be emitted from callback logic
  it.effect('events can be emitted from callback logic', () => Effect.gen(function* () {
    const spy = vi.fn();

    const logic = fromCallback<any, any, { type: 'emitted'; msg: string }>(
      ({ emit }) => {
        emit({
          type: 'emitted',
          msg: 'hello'
        });
      }
    );

    const actor = (yield* createActor(logic));

    yield* actor.on('emitted', (ev) => Effect.sync(() => {
      ev.type satisfies 'emitted';

      // @ts-expect-error
      ev.type satisfies 'whatever';

      ev satisfies { msg: string };

      spy(ev);
    }));

    (yield* actor.start);
    yield* untilCalled(spy);

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'emitted',
        msg: 'hello'
      })
    );
  }));

  // upstream: test/emit.test.ts > event emitter > events can be emitted from callback logic (restored root)
  it.effect('events can be emitted from callback logic (restored root)', () => Effect.gen(function* () {
    const spy = vi.fn();

    const logic = fromCallback<any, any, { type: 'emitted'; msg: string }>(
      ({ emit }) => {
        emit({
          type: 'emitted',
          msg: 'hello'
        });
      }
    );

    const machine = setup({
      actors: { logic }
    }).createMachine({
      invoke: {
        id: 'cb',
        src: 'logic'
      }
    });

    const actor = (yield* createActor(machine));

    // Persist the root actor
    const persistedSnapshot = (yield* actor.getPersistedSnapshot);

    // Rehydrate a new instance of the root actor using the persisted snapshot
    const restoredActor = (yield* createActor(machine, {
      snapshot: persistedSnapshot
    }));

    yield* (yield* restoredActor.getSnapshot).children.cb!.on('emitted', (ev) => Effect.sync(() => {
      spy(ev);
    }));

    (yield* restoredActor.start);
    yield* untilCalled(spy);

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'emitted',
        msg: 'hello'
      })
    );
  }));
});
