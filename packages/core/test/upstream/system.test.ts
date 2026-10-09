import { describe, expect, it, vi } from "@effect/vitest"
import { Deferred, Effect, Exit, Fiber, Option, Stream } from "effect"
import { of } from 'rxjs';
import { CallbackActorRef, fromCallback } from "../../src/index.js";
import {
  ActorRef,
  ActorRefFrom,
  AnyActorRef,
  AnyStateMachine,
  EventObject,
  Snapshot,
  assign,
  createActor,
  createMachine,
  fromEventObservable,
  fromObservable,
  fromPromise,
  fromTransition,
  sendTo,
  setup,
  spawnChild,
  stopChild
} from "../../src/index.js";
import { ActorSystem } from "../../src/index.js";

// Reading the system in Effect form (D7, DEV-6): `system.get(systemId)` gives
// `Effect<Option<ActorRef>>` and `system.getAll` is an Effect of a record keyed by systemId.
// - Test code and inline actions `yield*` them. An inline action that reads the system or
//   sends an event returns that Effect, and the actor runs it (SD-23, CONC-3).
// - A callback whose return value is data (a logic creator, a `receive` handler, an
//   assigner, a `sendTo` or `stopChild` target function) reads the registry synchronously
//   with `Effect.runSync` (D7: the lookup inside a transition is synchronous). A target
//   function returns `Option.getOrUndefined(...)` where upstream returns
//   `ActorRef | undefined`, so `None` targets self as upstream's `undefined` does.
// - Upstream "defined" is `Some`, "undefined" is `None`, and `get(id)!` is `Option.getOrThrow`.

describe('system', () => {
  // upstream: test/system.test.ts > system > should register an invoked actor
  it.effect('should register an invoked actor', () => Effect.gen(function* () {
    // upstream resolves a promise from the receive handler; a Deferred does the same
    const received = yield* Deferred.make<void>();
    type MySystem = ActorSystem<{
      actors: {
        receiver: ActorRef<Snapshot<unknown>, { type: 'HELLO' }>;
      };
    }>;

    const machine = createMachine({
      id: 'parent',
      initial: 'a',
      states: {
        a: {
          invoke: [
            {
              src: fromCallback(({ receive }) => {
                receive((event) => {
                  expect(event.type).toBe('HELLO');
                  Deferred.doneUnsafe(received, Effect.void);
                });
              }),
              systemId: 'receiver'
            },
            {
              src: createMachine({
                id: 'childmachine',
                entry: ({ system }) =>
                  Effect.gen(function* () {
                    const receiver = yield* (system as MySystem).get('receiver');

                    if (Option.isSome(receiver)) {
                      yield* receiver.value.send({ type: 'HELLO' });
                    }
                  })
              })
            }
          ]
        }
      }
    });

    (yield* Effect.tap(createActor(machine), (a) => a.start));

    yield* Deferred.await(received);
  }));

  // upstream: test/system.test.ts > system > should register a spawned actor
  it.effect('should register a spawned actor', () => Effect.gen(function* () {
    // upstream resolves a promise from the receive handler; a Deferred does the same
    const received = yield* Deferred.make<void>();
    type MySystem = ActorSystem<{
      actors: {
        receiver: ActorRef<Snapshot<unknown>, { type: 'HELLO' }>;
      };
    }>;

    const machine = createMachine({
      types: {} as {
        context: {
          ref: CallbackActorRef<EventObject, unknown>;
          machineRef?: ActorRefFrom<AnyStateMachine>;
        };
      },
      id: 'parent',
      context: ({ spawn }) => ({
        ref: spawn(
          fromCallback(({ receive }) => {
            receive((event) => {
              expect(event.type).toBe('HELLO');
              Deferred.doneUnsafe(received, Effect.void);
            });
          }),
          { systemId: 'receiver' }
        )
      }),
      on: {
        toggle: {
          actions: assign({
            machineRef: ({ spawn }) => {
              return spawn(
                createMachine({
                  id: 'childmachine',
                  entry: ({ system }) =>
                    Effect.gen(function* () {
                      const receiver = yield* (system as MySystem).get('receiver');

                      if (Option.isSome(receiver)) {
                        yield* receiver.value.send({ type: 'HELLO' });
                      } else {
                        throw new Error('no');
                      }
                    })
                })
              );
            }
          })
        }
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actor.send({ type: 'toggle' }));

    yield* Deferred.await(received);
  }));

  // upstream: test/system.test.ts > system > system can be immediately accessed outside the actor
  it.effect('system can be immediately accessed outside the actor', () => Effect.gen(function* () {
    const machine = createMachine({
      invoke: {
        systemId: 'someChild',
        src: createMachine({})
      }
    });

    // no .start() here is important for the test
    const actor = (yield* createActor(machine));

    expect(Option.isSome(yield* actor.system.get('someChild'))).toBe(true);
  }));

  // upstream: test/system.test.ts > system > root actor can be given the systemId
  it.effect('root actor can be given the systemId', () => Effect.gen(function* () {
    const machine = createMachine({});
    const actor = (yield* createActor(machine, { systemId: 'test' }));
    expect(Option.getOrUndefined(yield* actor.system.get('test'))).toBe(actor);
  }));

  // upstream: test/system.test.ts > system > should remove invoked actor from receptionist if stopped
  it.effect('should remove invoked actor from receptionist if stopped', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'active',
      states: {
        active: {
          invoke: {
            src: createMachine({}),
            systemId: 'test'
          },
          on: {
            toggle: 'inactive'
          }
        },
        inactive: {}
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(Option.isSome(yield* actor.system.get('test'))).toBe(true);

    (yield* actor.send({ type: 'toggle' }));

    expect(Option.isNone(yield* actor.system.get('test'))).toBe(true);
  }));

  // upstream: test/system.test.ts > system > should remove spawned actor from receptionist if stopped
  it.effect('should remove spawned actor from receptionist if stopped', () => Effect.gen(function* () {
    const childMachine = createMachine({});
    const machine = createMachine({
      types: {} as {
        context: {
          ref: ActorRefFrom<typeof childMachine>;
        };
      },
      context: ({ spawn }) => ({
        ref: spawn(childMachine, {
          systemId: 'test'
        })
      }),
      on: {
        toggle: {
          actions: stopChild(({ context }) => context.ref)
        }
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(Option.isSome(yield* actor.system.get('test'))).toBe(true);

    (yield* actor.send({ type: 'toggle' }));

    expect(Option.isNone(yield* actor.system.get('test'))).toBe(true);
  }));

  // upstream: test/system.test.ts > system > should throw an error if an actor with the system ID already exists
  it.effect('should throw an error if an actor with the system ID already exists', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'inactive',
      states: {
        inactive: {
          on: {
            toggle: 'active'
          }
        },
        active: {
          invoke: [
            {
              src: createMachine({}),
              systemId: 'test'
            },
            {
              src: createMachine({}),
              systemId: 'test'
            }
          ]
        }
      }
    });

    const errorSpy = vi.fn();

    const actorRef = (yield* createActor(machine, { systemId: 'test' }));
    // upstream subscribes an observer `error` callback (not ported, D6, DEV-3). The
    // `changes` stream fails with the actor's error, so a fiber subscribed before start
    // hands that error to the spy
    const errors = yield* actorRef.changes.pipe(
      Stream.runDrain,
      Effect.flip,
      Effect.flatMap((error) => Effect.sync(() => errorSpy(error))),
      Effect.forkScoped({ startImmediately: true })
    );
    (yield* actorRef.start);
    (yield* actorRef.send({ type: 'toggle' }));
    yield* Fiber.join(errors);

    expect(errorSpy.mock.calls).toMatchInlineSnapshot(`
      [
        [
          [Error: Actor with system ID 'test' already exists.],
        ],
      ]
    `);
  }));

  // upstream: test/system.test.ts > system > should cleanup stopped actors
  it.effect('should cleanup stopped actors', () => Effect.gen(function* () {
    const machine = createMachine({
      types: {
        context: {} as {
          ref: AnyActorRef;
        }
      },
      context: ({ spawn }) => ({
        ref: spawn(
          fromPromise(() => Promise.resolve()),
          {
            systemId: 'test'
          }
        )
      }),
      on: {
        stop: {
          actions: stopChild(({ context }) => context.ref)
        },
        start: {
          actions: spawnChild(
            fromPromise(() => Promise.resolve()),
            {
              systemId: 'test'
            }
          )
        }
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actor.send({ type: 'stop' }));

    // upstream asserts that the send does not throw; in Effect form a failure in the
    // transition would fail the send or set status 'error' (SD-4), and an unhandled actor
    // error does not fail the run as upstream's rethrow does (SD-21), so the status is
    // checked as well
    const exit = yield* Effect.exit(actor.send({ type: 'start' }));
    expect(Exit.isSuccess(exit)).toBe(true);
    expect((yield* actor.getSnapshot).status).toBe('active');
  }));

  // upstream: test/system.test.ts > system > should be accessible in inline custom actions
  it.effect('should be accessible in inline custom actions', () => Effect.gen(function* () {
    // the assertion runs inside the Effect the action returns; a dropped Effect fails here
    // upstream fails through the global rethrow of the action's error; that rethrow is not
    // ported (SD-21), so a failed assertion in the action only sets status 'error' (SD-4) and
    // the test reads that status after the step
    expect.assertions(2);
    const machine = createMachine({
      invoke: {
        src: createMachine({}),
        systemId: 'test'
      },
      entry: ({ system }) =>
        Effect.gen(function* () {
          expect(Option.isSome(yield* system.get('test'))).toBe(true);
        })
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
    expect((yield* actor.getSnapshot).status).toBe('active');
  }));

  // upstream: test/system.test.ts > system > should be accessible in referenced custom actions
  it.effect('should be accessible in referenced custom actions', () => Effect.gen(function* () {
    // the assertion runs inside the Effect the action returns; a dropped Effect fails here
    // upstream fails through the global rethrow of the action's error; that rethrow is not
    // ported (SD-21), so a failed assertion in the action only sets status 'error' (SD-4) and
    // the test reads that status after the step
    expect.assertions(2);
    const machine = createMachine(
      {
        invoke: {
          src: createMachine({}),
          systemId: 'test'
        },
        entry: 'myAction'
      },
      {
        actions: {
          myAction: ({ system }) =>
            Effect.gen(function* () {
              expect(Option.isSome(yield* system.get('test'))).toBe(true);
            })
        }
      }
    );

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
    expect((yield* actor.getSnapshot).status).toBe('active');
  }));

  // upstream: test/system.test.ts > system > should be accessible in assign actions
  it.effect('should be accessible in assign actions', () => Effect.gen(function* () {
    // upstream fails through the global rethrow of the action's error; that rethrow is not
    // ported (SD-21), so a failed assertion in the action only sets status 'error' (SD-4) and
    // the test reads that status after the step
    const machine = createMachine({
      invoke: {
        src: createMachine({}),
        systemId: 'test'
      },
      initial: 'a',
      states: {
        a: {
          entry: assign(({ system }) => {
            expect(Option.isSome(Effect.runSync(system.get('test')))).toBe(true);
          })
        }
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
    expect((yield* actor.getSnapshot).status).toBe('active');
  }));

  // upstream: test/system.test.ts > system > should be accessible in sendTo actions
  it.effect('should be accessible in sendTo actions', () => Effect.gen(function* () {
    // upstream fails through the global rethrow of the action's error; that rethrow is not
    // ported (SD-21), so a failed assertion in the action only sets status 'error' (SD-4) and
    // the test reads that status after the step
    const machine = createMachine({
      invoke: {
        src: createMachine({}),
        systemId: 'test'
      },
      initial: 'a',
      states: {
        a: {
          entry: sendTo(
            ({ system }) => {
              expect(Option.isSome(Effect.runSync(system.get('test')))).toBe(true);
              return Option.getOrUndefined(Effect.runSync(system.get('test')));
            },
            { type: 'FOO' }
          )
        }
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
    expect((yield* actor.getSnapshot).status).toBe('active');
  }));

  // upstream: test/system.test.ts > system > should be accessible in promise logic
  it.effect('should be accessible in promise logic', () => Effect.gen(function* () {
    expect.assertions(2);
    const machine = createMachine({
      invoke: [
        {
          src: createMachine({}),
          systemId: 'test'
        },
        {
          src: fromPromise(({ system }) => {
            expect(Option.isSome(Effect.runSync(system.get('test')))).toBe(true);
            return Promise.resolve();
          })
        }
      ]
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(Option.isSome(yield* actor.system.get('test'))).toBe(true);
  }));

  // upstream: test/system.test.ts > system > should be accessible in transition logic
  it.effect('should be accessible in transition logic', () => Effect.gen(function* () {
    // upstream fails through the global rethrow of the reducer's error; that rethrow is not
    // ported (SD-21), so a failed assertion in the transition function only sets status
    // 'error' (SD-4) and the test reads the status of the reducer and the parent after the
    // event. Upstream's 2 assertions plus the 2 status checks
    expect.assertions(4);
    const machine = createMachine({
      invoke: [
        {
          src: createMachine({}),
          systemId: 'test'
        },

        {
          src: fromTransition((_state, _event, { system }) => {
            expect(Option.isSome(Effect.runSync(system.get('test')))).toBe(true);
            return 0;
          }, 0),
          systemId: 'reducer'
        }
      ]
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(Option.isSome(yield* actor.system.get('test'))).toBe(true);

    // The assertion won't be checked until the transition function gets an event
    const reducer = Option.getOrThrow(yield* actor.system.get('reducer'));
    (yield* reducer.send({ type: 'a' }));
    expect((yield* reducer.getSnapshot).status).toBe('active');
    expect((yield* actor.getSnapshot).status).toBe('active');
  }));

  // upstream: test/system.test.ts > system > should be accessible in observable logic
  it.effect('should be accessible in observable logic', () => Effect.gen(function* () {
    expect.assertions(2);
    const machine = createMachine({
      invoke: [
        {
          src: createMachine({}),
          systemId: 'test'
        },

        {
          src: fromObservable(({ system }) => {
            expect(Option.isSome(Effect.runSync(system.get('test')))).toBe(true);
            return of(0);
          })
        }
      ]
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(Option.isSome(yield* actor.system.get('test'))).toBe(true);
  }));

  // upstream: test/system.test.ts > system > should be accessible in event observable logic
  it.effect('should be accessible in event observable logic', () => Effect.gen(function* () {
    expect.assertions(2);
    const machine = createMachine({
      invoke: [
        {
          src: createMachine({}),
          systemId: 'test'
        },

        {
          src: fromEventObservable(({ system }) => {
            expect(Option.isSome(Effect.runSync(system.get('test')))).toBe(true);
            return of({ type: 'a' });
          })
        }
      ]
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(Option.isSome(yield* actor.system.get('test'))).toBe(true);
  }));

  // upstream: test/system.test.ts > system > should be accessible in callback logic
  it.effect('should be accessible in callback logic', () => Effect.gen(function* () {
    expect.assertions(2);
    const machine = createMachine({
      invoke: [
        {
          src: createMachine({}),
          systemId: 'test'
        },
        {
          src: fromCallback(({ system }) => {
            expect(Option.isSome(Effect.runSync(system.get('test')))).toBe(true);
          })
        }
      ]
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(Option.isSome(yield* actor.system.get('test'))).toBe(true);
  }));

  // upstream: test/system.test.ts > system > should gracefully handle re-registration of a `systemId` during a reentering transition
  it.effect('should gracefully handle re-registration of a `systemId` during a reentering transition', () => Effect.gen(function* () {
    const spy = vi.fn();

    let counter = 0;

    const machine = createMachine({
      initial: 'listening',
      states: {
        listening: {
          invoke: {
            systemId: 'listener',
            src: fromCallback(({ receive }) => {
              const localId = counter++;

              receive((event) => {
                spy(localId, event);
              });

              return () => {};
            })
          }
        }
      },
      on: {
        RESTART: {
          target: '.listening'
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'RESTART' }));
    (yield* Option.getOrThrow(yield* actorRef.system.get('listener')).send({ type: 'a' }));

    expect(spy.mock.calls).toEqual([
      [
        1,
        {
          type: 'a'
        }
      ]
    ]);
  }));

  // upstream: test/system.test.ts > system > should be able to send an event to an ancestor with a registered `systemId` from an initial entry action
  it.effect('should be able to send an event to an ancestor with a registered `systemId` from an initial entry action', () => Effect.gen(function* () {
    const spy = vi.fn();

    const child = createMachine({
      entry: sendTo(({ system }) => Option.getOrUndefined(Effect.runSync(system.get('myRoot'))), {
        type: 'EV'
      })
    });

    const machine = createMachine({
      invoke: {
        src: child
      },
      on: {
        EV: {
          actions: spy
        }
      }
    });
    (yield* Effect.tap(createActor(machine, { systemId: 'myRoot' }), (a) => a.start));

    expect(spy).toHaveBeenCalledTimes(1);
  }));

  // upstream: test/system.test.ts > system > system ID should be accessible on the actor
  it.effect('system ID should be accessible on the actor', () => Effect.gen(function* () {
    const machine = createMachine({});
    const actor = (yield* createActor(machine, { systemId: 'test' }));
    expect(actor.systemId).toBe('test');
  }));

  // upstream: test/system.test.ts > system > should give a list of runnings actors
  it.effect('should give a list of runnings actors', () => Effect.gen(function* () {
    const machine = createMachine({
      id: 'root',
      initial: 'happy path',
      states: {
        'happy path': {
          entry: [spawnChild(createMachine({}), { systemId: 'child1' })],
          invoke: [
            {
              src: createMachine({
                id: 'machine'
              }),
              systemId: 'child2'
            }
          ],
          on: {
            stopChild1: 'sad path'
          }
        },
        'sad path': {
          entry: stopChild(({ system }) => Option.getOrUndefined(Effect.runSync(system.get('child1'))))
        }
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(yield* actor.system.getAll).toEqual({
      child1: Option.getOrUndefined(yield* actor.system.get('child1')),
      child2: Option.getOrUndefined(yield* actor.system.get('child2'))
    });

    (yield* actor.send({ type: 'stopChild1' }));

    expect(yield* actor.system.getAll).toEqual({});
  }));

  // upstream: test/system.test.ts > system > should unregister nested child systemIds when stopping a parent actor
  it.effect('should unregister nested child systemIds when stopping a parent actor', () => Effect.gen(function* () {
    const subchild = createMachine({});

    const child = setup({
      actors: {
        subchild
      }
    }).createMachine({
      id: 'childSystem',
      invoke: {
        src: 'subchild',
        systemId: 'subchild'
      }
    });

    const parent = setup({
      actors: { child }
    }).createMachine({
      entry: spawnChild('child', { id: 'childId' }),
      on: {
        restart: {
          actions: [
            stopChild('childId'),
            spawnChild('child', { id: 'childId' })
          ]
        }
      }
    });

    const root = (yield* Effect.tap(createActor(parent), (a) => a.start));

    expect(Option.isSome(yield* root.system.get('subchild'))).toBe(true);

    // This should not throw "Actor with system ID 'subchild' already exists"
    // upstream asserts that the send does not throw; in Effect form the duplicate systemId
    // would set status 'error' (SD-4) and an unhandled actor error does not fail the run
    // as upstream's rethrow does (SD-21), so the status is checked as well
    const exit = yield* Effect.exit(root.send({ type: 'restart' }));
    expect(Exit.isSuccess(exit)).toBe(true);
    expect((yield* root.getSnapshot).status).toBe('active');

    expect(Option.isSome(yield* root.system.get('subchild'))).toBe(true);
  }));
});
