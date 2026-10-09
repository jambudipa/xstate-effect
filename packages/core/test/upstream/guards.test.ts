import { describe, expect, it, vi } from "@effect/vitest"
import { Effect, Stream } from "effect"
import { createActor, createMachine } from "../../src/index.js";
import { and, not, or, stateIn } from "../../src/index.js";
import { trackEntries } from "./trackEntries.js";

// Upstream observes an actor error with an observer-object `subscribe({ error })`, which is
// not ported (D6, DEV-3): the `changes` stream fails with the actor's error (SD-4). A
// `changes` consumer runs in its own fiber, so a test yields its fiber, at most 100 times and
// never on wall-clock time, until the consumer has seen the failure.
const yieldUntil = (done: () => boolean | Effect.Effect<boolean>) =>
  Effect.yieldNow.pipe(Effect.repeat({ until: done, times: 100 }));

describe('guard conditions', () => {
  interface LightMachineCtx {
    elapsed: number;
  }
  type LightMachineEvents =
    | { type: 'TIMER' }
    | {
        type: 'EMERGENCY';
        isEmergency?: boolean;
      }
    | { type: 'TIMER_COND_OBJ' }
    | { type: 'BAD_COND' };

  const lightMachine = createMachine(
    {
      types: {} as {
        input: { elapsed?: number };
        context: LightMachineCtx;
        events: LightMachineEvents;
      },
      context: ({ input = {} }) => ({
        elapsed: input.elapsed ?? 0
      }),
      initial: 'green',
      states: {
        green: {
          on: {
            TIMER: [
              {
                target: 'green',
                guard: ({ context: { elapsed } }) => elapsed < 100
              },
              {
                target: 'yellow',
                guard: ({ context: { elapsed } }) =>
                  elapsed >= 100 && elapsed < 200
              }
            ],
            EMERGENCY: {
              target: 'red',
              guard: ({ event }) => !!event.isEmergency
            }
          }
        },
        yellow: {
          on: {
            TIMER: {
              target: 'red',
              guard: 'minTimeElapsed'
            },
            TIMER_COND_OBJ: {
              target: 'red',
              guard: {
                type: 'minTimeElapsed'
              }
            }
          }
        },
        red: {
          on: {
            BAD_COND: {
              target: 'red',
              guard: 'doesNotExist'
            }
          }
        }
      }
    },
    {
      guards: {
        minTimeElapsed: ({ context: { elapsed } }) =>
          elapsed >= 100 && elapsed < 200
      }
    }
  );

  // upstream: test/guards.test.ts > guard conditions > should transition only if condition is met
  it.effect('should transition only if condition is met', () => Effect.gen(function* () {
    const actorRef1 = (yield* Effect.tap(createActor(lightMachine, {
      input: { elapsed: 50 }
    }), (a) => a.start));
    (yield* actorRef1.send({ type: 'TIMER' }));
    expect((yield* actorRef1.getSnapshot).value).toEqual('green');

    const actorRef2 = (yield* Effect.tap(createActor(lightMachine, {
      input: { elapsed: 120 }
    }), (a) => a.start));
    (yield* actorRef2.send({ type: 'TIMER' }));
    expect((yield* actorRef2.getSnapshot).value).toEqual('yellow');
  }));

  // upstream: test/guards.test.ts > guard conditions > should transition if condition based on event is met
  it.effect('should transition if condition based on event is met', () => Effect.gen(function* () {
    const actorRef = (yield* Effect.tap(createActor(lightMachine, { input: {} }), (a) => a.start));
    (yield* actorRef.send({
      type: 'EMERGENCY',
      isEmergency: true
    }));
    expect((yield* actorRef.getSnapshot).value).toEqual('red');
  }));

  // upstream: test/guards.test.ts > guard conditions > should not transition if condition based on event is not met
  it.effect('should not transition if condition based on event is not met', () => Effect.gen(function* () {
    const actorRef = (yield* Effect.tap(createActor(lightMachine, { input: {} }), (a) => a.start));
    (yield* actorRef.send({
      type: 'EMERGENCY'
    }));
    expect((yield* actorRef.getSnapshot).value).toEqual('green');
  }));

  // upstream: test/guards.test.ts > guard conditions > should not transition if no condition is met
  it.effect('should not transition if no condition is met', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            TIMER: [
              {
                target: 'b',
                guard: ({ event: { elapsed } }) => elapsed > 200
              },
              {
                target: 'c',
                guard: ({ event: { elapsed } }) => elapsed > 100
              }
            ]
          }
        },
        b: {},
        c: {}
      }
    });

    const flushTracked = trackEntries(machine);
    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
    flushTracked();

    (yield* actor.send({ type: 'TIMER', elapsed: 10 }));

    expect((yield* actor.getSnapshot).value).toBe('a');
    expect(flushTracked()).toEqual([]);
  }));

  // upstream: test/guards.test.ts > guard conditions > should work with defined string transitions
  it.effect('should work with defined string transitions', () => Effect.gen(function* () {
    const actorRef = (yield* Effect.tap(createActor(lightMachine, {
      input: { elapsed: 120 }
    }), (a) => a.start));
    (yield* actorRef.send({
      type: 'TIMER'
    }));
    expect((yield* actorRef.getSnapshot).value).toEqual('yellow');
    (yield* actorRef.send({
      type: 'TIMER'
    }));
    expect((yield* actorRef.getSnapshot).value).toEqual('red');
  }));

  // upstream: test/guards.test.ts > guard conditions > should work with guard objects
  it.effect('should work with guard objects', () => Effect.gen(function* () {
    const actorRef = (yield* Effect.tap(createActor(lightMachine, {
      input: { elapsed: 150 }
    }), (a) => a.start));
    (yield* actorRef.send({
      type: 'TIMER'
    }));
    expect((yield* actorRef.getSnapshot).value).toEqual('yellow');
    (yield* actorRef.send({
      type: 'TIMER_COND_OBJ'
    }));
    expect((yield* actorRef.getSnapshot).value).toEqual('red');
  }));

  // upstream: test/guards.test.ts > guard conditions > should work with defined string transitions (condition not met)
  it.effect('should work with defined string transitions (condition not met)', () => Effect.gen(function* () {
    const machine = createMachine(
      {
        types: {} as { context: LightMachineCtx; events: LightMachineEvents },
        context: {
          elapsed: 10
        },
        initial: 'yellow',
        states: {
          green: {
            on: {
              TIMER: [
                {
                  target: 'green',
                  guard: ({ context: { elapsed } }) => elapsed < 100
                },
                {
                  target: 'yellow',
                  guard: ({ context: { elapsed } }) =>
                    elapsed >= 100 && elapsed < 200
                }
              ],
              EMERGENCY: {
                target: 'red',
                guard: ({ event }) => !!event.isEmergency
              }
            }
          },
          yellow: {
            on: {
              TIMER: {
                target: 'red',
                guard: 'minTimeElapsed'
              }
            }
          },
          red: {}
        }
      },
      {
        guards: {
          minTimeElapsed: ({ context: { elapsed } }) =>
            elapsed >= 100 && elapsed < 200
        }
      }
    );

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({
      type: 'TIMER'
    }));

    expect((yield* actorRef.getSnapshot).value).toEqual('yellow');
  }));

  // upstream: test/guards.test.ts > guard conditions > should throw if string transition is not defined
  it.effect('should throw if string transition is not defined', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'foo',
      states: {
        foo: {
          on: {
            BAD_COND: {
              guard: 'doesNotExist'
            }
          }
        }
      }
    });

    const errorSpy = vi.fn();

    const actorRef = (yield* createActor(machine));
    // the observer's `error` callback: called with the error the `changes` stream fails with
    yield* actorRef.changes.pipe(
      Stream.runDrain,
      Effect.catch((error) => Effect.sync(() => errorSpy(error))),
      Effect.forkScoped({ startImmediately: true })
    );
    (yield* actorRef.start);

    (yield* actorRef.send({ type: 'BAD_COND' }));

    // the stream consumer runs in its own fiber: let it see the failure of the stream
    yield* yieldUntil(() => errorSpy.mock.calls.length > 0);
    expect(errorSpy.mock.calls).toMatchInlineSnapshot(`
      [
        [
          [Error: Unable to evaluate guard 'doesNotExist' in transition for event 'BAD_COND' in state node '(machine).foo':
      Guard 'doesNotExist' is not implemented.'.],
        ],
      ]
    `);
  }));
});

describe('guard conditions', () => {
  // upstream: test/guards.test.ts > guard conditions > should guard against transition
  it.effect('should guard against transition', () => Effect.gen(function* () {
    const machine = createMachine({
      type: 'parallel',
      states: {
        A: {
          initial: 'A2',
          states: {
            A0: {},
            A2: {}
          }
        },
        B: {
          initial: 'B0',
          states: {
            B0: {
              always: [
                {
                  target: 'B4',
                  guard: () => false
                }
              ],
              on: {
                T1: [
                  {
                    target: 'B1',
                    guard: () => false
                  }
                ]
              }
            },
            B1: {},
            B4: {}
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'T1' }));

    expect((yield* actorRef.getSnapshot).value).toEqual({
      A: 'A2',
      B: 'B0'
    });
  }));

  // upstream: test/guards.test.ts > guard conditions > should allow a matching transition
  it.effect('should allow a matching transition', () => Effect.gen(function* () {
    const machine = createMachine({
      type: 'parallel',
      states: {
        A: {
          initial: 'A2',
          states: {
            A0: {},
            A2: {}
          }
        },
        B: {
          initial: 'B0',
          states: {
            B0: {
              always: [
                {
                  target: 'B4',
                  guard: () => false
                }
              ],
              on: {
                T2: [
                  {
                    target: 'B2',
                    guard: stateIn('A.A2')
                  }
                ]
              }
            },
            B1: {},
            B2: {},
            B4: {}
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'T2' }));

    expect((yield* actorRef.getSnapshot).value).toEqual({
      A: 'A2',
      B: 'B2'
    });
  }));

  // upstream: test/guards.test.ts > guard conditions > should check guards with interim states
  it.effect('should check guards with interim states', () => Effect.gen(function* () {
    const machine = createMachine({
      type: 'parallel',
      states: {
        A: {
          initial: 'A2',
          states: {
            A2: {
              on: {
                A: 'A3'
              }
            },
            A3: {
              always: 'A4'
            },
            A4: {
              always: 'A5'
            },
            A5: {}
          }
        },
        B: {
          initial: 'B0',
          states: {
            B0: {
              always: [
                {
                  target: 'B4',
                  guard: stateIn('A.A4')
                }
              ]
            },
            B4: {}
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'A' }));

    expect((yield* actorRef.getSnapshot).value).toEqual({
      A: 'A5',
      B: 'B4'
    });
  }));
});

describe('custom guards', () => {
  // upstream: test/guards.test.ts > custom guards > should evaluate custom guards
  it.effect('should evaluate custom guards', () => Effect.gen(function* () {
    interface Ctx {
      count: number;
    }
    interface Events {
      type: 'EVENT';
      value: number;
    }
    const machine = createMachine(
      {
        types: {} as {
          context: Ctx;
          events: Events;
          guards: {
            type: 'custom';
            params: {
              prop: keyof Ctx;
              op: 'greaterThan';
              compare: number;
            };
          };
        },
        initial: 'inactive',
        context: {
          count: 0
        },
        states: {
          inactive: {
            on: {
              EVENT: {
                target: 'active',
                guard: {
                  type: 'custom',
                  params: { prop: 'count', op: 'greaterThan', compare: 3 }
                }
              }
            }
          },
          active: {}
        }
      },
      {
        guards: {
          custom: ({ context, event }, params) => {
            const { prop, compare, op } = params;
            if (op === 'greaterThan') {
              return context[prop] + event.value > compare;
            }

            return false;
          }
        }
      }
    );

    const actorRef1 = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef1.send({ type: 'EVENT', value: 4 }));
    const passState = (yield* actorRef1.getSnapshot);

    expect(passState.value).toEqual('active');

    const actorRef2 = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef2.send({ type: 'EVENT', value: 3 }));
    const failState = (yield* actorRef2.getSnapshot);

    expect(failState.value).toEqual('inactive');
  }));

  // upstream: test/guards.test.ts > custom guards > should provide the undefined params if a guard was configured using a string
  it.effect('should provide the undefined params if a guard was configured using a string', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine(
      {
        on: {
          FOO: {
            guard: 'myGuard'
          }
        }
      },
      {
        guards: {
          myGuard: (_, params) => {
            spy(params);
            return true;
          }
        }
      }
    );

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'FOO' }));

    expect(spy).toHaveBeenCalledWith(undefined);
  }));

  // upstream: test/guards.test.ts > custom guards > should provide the guard with resolved params when they are dynamic
  it.effect('should provide the guard with resolved params when they are dynamic', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine(
      {
        on: {
          FOO: {
            guard: { type: 'myGuard', params: () => ({ stuff: 100 }) }
          }
        }
      },
      {
        guards: {
          myGuard: (_, params) => {
            spy(params);
            return true;
          }
        }
      }
    );

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'FOO' }));

    expect(spy).toHaveBeenCalledWith({
      stuff: 100
    });
  }));

  // upstream: test/guards.test.ts > custom guards > should resolve dynamic params using context value
  it.effect('should resolve dynamic params using context value', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine(
      {
        context: {
          secret: 42
        },
        on: {
          FOO: {
            guard: {
              type: 'myGuard',
              params: ({ context }) => ({ secret: context.secret })
            }
          }
        }
      },
      {
        guards: {
          myGuard: (_, params) => {
            spy(params);
            return true;
          }
        }
      }
    );

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'FOO' }));

    expect(spy).toHaveBeenCalledWith({
      secret: 42
    });
  }));

  // upstream: test/guards.test.ts > custom guards > should resolve dynamic params using event value
  it.effect('should resolve dynamic params using event value', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine(
      {
        on: {
          FOO: {
            guard: {
              type: 'myGuard',
              params: ({ event }) => ({ secret: event.secret })
            }
          }
        }
      },
      {
        guards: {
          myGuard: (_, params) => {
            spy(params);
            return true;
          }
        }
      }
    );

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'FOO', secret: 77 }));

    expect(spy).toHaveBeenCalledWith({
      secret: 77
    });
  }));

  // upstream: test/guards.test.ts > custom guards > should call a referenced `not` guard that embeds an inline function guard with undefined params
  it.effect('should call a referenced `not` guard that embeds an inline function guard with undefined params', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine(
      {
        context: {
          counter: 0
        },
        on: {
          FOO: {
            guard: {
              type: 'myGuard',
              params: 'foo'
            }
          }
        }
      },
      {
        guards: {
          myGuard: not((_, params) => {
            spy(params);
            return true;
          })
        }
      }
    );

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'FOO' }));

    expect(spy).toHaveBeenCalledWith(undefined);
  }));

  // upstream: test/guards.test.ts > custom guards > should call a string guard referenced by referenced `not` with undefined params
  it.effect('should call a string guard referenced by referenced `not` with undefined params', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine(
      {
        on: {
          FOO: {
            guard: {
              type: 'myGuard',
              params: 'foo'
            }
          }
        }
      },
      {
        guards: {
          other: (_, params) => {
            spy(params);
            return true;
          },
          myGuard: not('other')
        }
      }
    );

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'FOO' }));

    expect(spy).toHaveBeenCalledWith(undefined);
  }));

  // upstream: test/guards.test.ts > custom guards > should call an object guard referenced by referenced `not` with its own params
  it.effect('should call an object guard referenced by referenced `not` with its own params', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine(
      {
        on: {
          FOO: {
            guard: {
              type: 'myGuard',
              params: 'foo'
            }
          }
        }
      },
      {
        guards: {
          other: (_, params) => {
            spy(params);
            return true;
          },
          myGuard: not({
            type: 'other',
            params: 42
          })
        }
      }
    );

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'FOO' }));

    expect(spy).toHaveBeenCalledWith(42);
  }));

  // upstream: test/guards.test.ts > custom guards > should call an inline function guard embedded in referenced `and` with undefined params
  it.effect('should call an inline function guard embedded in referenced `and` with undefined params', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine(
      {
        on: {
          FOO: {
            guard: {
              type: 'myGuard',
              params: 'foo'
            }
          }
        }
      },
      {
        guards: {
          other: () => true,
          myGuard: and([
            'other',
            (_, params) => {
              spy(params);
              return true;
            }
          ])
        }
      }
    );

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'FOO' }));

    expect(spy).toHaveBeenCalledWith(undefined);
  }));

  // upstream: test/guards.test.ts > custom guards > should call a string guard referenced by referenced `and` with undefined params
  it.effect('should call a string guard referenced by referenced `and` with undefined params', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine(
      {
        on: {
          FOO: {
            guard: {
              type: 'myGuard',
              params: 'foo'
            }
          }
        }
      },
      {
        guards: {
          other: (_, params) => {
            spy(params);
            return true;
          },
          myGuard: and(['other', (_, params) => true])
        }
      }
    );

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'FOO' }));

    expect(spy).toHaveBeenCalledWith(undefined);
  }));

  // upstream: test/guards.test.ts > custom guards > should call an object guard referenced by referenced `and` with its own params
  it.effect('should call an object guard referenced by referenced `and` with its own params', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine(
      {
        on: {
          FOO: {
            guard: {
              type: 'myGuard',
              params: 'foo'
            }
          }
        }
      },
      {
        guards: {
          other: (_, params) => {
            spy(params);
            return true;
          },
          myGuard: and([
            {
              type: 'other',
              params: 42
            },
            (_, params) => true
          ])
        }
      }
    );

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'FOO' }));

    expect(spy).toHaveBeenCalledWith(42);
  }));
});

describe('referencing guards', () => {
  // upstream: test/guards.test.ts > referencing guards > guard should be checked when referenced by a string
  it.effect('guard should be checked when referenced by a string', () => Effect.gen(function* () {
    const spy = vi.fn();
    const machine = createMachine(
      {
        on: {
          EV: {
            guard: 'checkStuff'
          }
        }
      },
      {
        guards: {
          checkStuff: spy
        }
      }
    );

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(spy).not.toHaveBeenCalled();

    (yield* actorRef.send({
      type: 'EV'
    }));

    expect(spy).toHaveBeenCalledTimes(1);
  }));

  // upstream: test/guards.test.ts > referencing guards > guard should be checked when referenced by a parametrized guard object
  it.effect('guard should be checked when referenced by a parametrized guard object', () => Effect.gen(function* () {
    const spy = vi.fn();
    const machine = createMachine(
      {
        on: {
          EV: {
            guard: {
              type: 'checkStuff'
            }
          }
        }
      },
      {
        guards: {
          checkStuff: spy
        }
      }
    );

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(spy).not.toHaveBeenCalled();

    (yield* actorRef.send({
      type: 'EV'
    }));

    expect(spy).toHaveBeenCalledTimes(1);
  }));

  // upstream: test/guards.test.ts > referencing guards > should throw for guards with missing predicates
  it.effect('should throw for guards with missing predicates', () => Effect.gen(function* () {
    const machine = createMachine({
      id: 'invalid-predicate',
      initial: 'active',
      states: {
        active: {
          on: {
            EVENT: { target: 'inactive', guard: 'missing-predicate' }
          }
        },
        inactive: {}
      }
    });

    const errorSpy = vi.fn();

    const actorRef = (yield* createActor(machine));
    // the observer's `error` callback: called with the error the `changes` stream fails with
    yield* actorRef.changes.pipe(
      Stream.runDrain,
      Effect.catch((error) => Effect.sync(() => errorSpy(error))),
      Effect.forkScoped({ startImmediately: true })
    );
    (yield* actorRef.start);
    (yield* actorRef.send({ type: 'EVENT' }));

    // the stream consumer runs in its own fiber: let it see the failure of the stream
    yield* yieldUntil(() => errorSpy.mock.calls.length > 0);
    expect(errorSpy.mock.calls).toMatchInlineSnapshot(`
      [
        [
          [Error: Unable to evaluate guard 'missing-predicate' in transition for event 'EVENT' in state node 'invalid-predicate.active':
      Guard 'missing-predicate' is not implemented.'.],
        ],
      ]
    `);
  }));

  // upstream: test/guards.test.ts > referencing guards > should be possible to reference a composite guard that only uses inline predicates
  it.effect('should be possible to reference a composite guard that only uses inline predicates', () => Effect.gen(function* () {
    const machine = createMachine(
      {
        initial: 'a',
        states: {
          a: {
            on: {
              EVENT: {
                target: 'b',
                guard: 'referenced'
              }
            }
          },
          b: {}
        }
      },
      {
        guards: {
          referenced: not(() => false)
        }
      }
    );

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'EVENT' }));

    expect((yield* actorRef.getSnapshot).matches('b')).toBeTruthy();
  }));

  // upstream: test/guards.test.ts > referencing guards > should be possible to reference a composite guard that references other guards recursively
  it.effect('should be possible to reference a composite guard that references other guards recursively', () => Effect.gen(function* () {
    const machine = createMachine(
      {
        initial: 'a',
        states: {
          a: {
            on: {
              EVENT: {
                target: 'b',
                guard: 'referenced'
              }
            }
          },
          b: {}
        }
      },
      {
        guards: {
          truthy: () => true,
          falsy: () => false,
          referenced: or([
            () => false,
            not('truthy'),
            and([not('falsy'), 'truthy'])
          ])
        }
      }
    );

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'EVENT' }));

    expect((yield* actorRef.getSnapshot).matches('b')).toBeTruthy();
  }));

  // upstream: test/guards.test.ts > referencing guards > should be possible to resolve referenced guards recursively
  it.effect('should be possible to resolve referenced guards recursively', () => Effect.gen(function* () {
    const machine = createMachine(
      {
        initial: 'a',
        states: {
          a: {
            on: {
              EVENT: {
                target: 'b',
                guard: 'ref1'
              }
            }
          },
          b: {}
        }
      },
      {
        guards: {
          ref1: 'ref2',
          ref2: 'ref3',
          ref3: () => true
        }
      }
    );

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'EVENT' }));

    expect((yield* actorRef.getSnapshot).matches('b')).toBeTruthy();
  }));
});

describe('guards - other', () => {
  // upstream: test/guards.test.ts > guards - other > should allow for a fallback target to be a simple string
  it.effect('should allow for a fallback target to be a simple string', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            EVENT: [{ target: 'b', guard: () => false }, 'c']
          }
        },
        b: {},
        c: {}
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* service.send({ type: 'EVENT' }));

    expect((yield* service.getSnapshot).value).toBe('c');
  }));

  // upstream: test/guards.test.ts > guards - other > inline function guard should not leak into provided guards object
  it.effect('inline function guard should not leak into provided guards object', () => Effect.gen(function* () {
    const guards = {};

    const machine = createMachine(
      {
        on: {
          FOO: {
            guard: () => false,
            actions: () => {}
          }
        }
      },
      { guards }
    );

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'FOO' }));

    expect(guards).toEqual({});
  }));

  // upstream: test/guards.test.ts > guards - other > inline builtin guard should not leak into provided guards object
  it.effect('inline builtin guard should not leak into provided guards object', () => Effect.gen(function* () {
    const guards = {};

    const machine = createMachine(
      {
        on: {
          FOO: {
            guard: not(() => false),
            actions: () => {}
          }
        }
      },
      { guards }
    );

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'FOO' }));

    expect(guards).toEqual({});
  }));
});

describe('not() guard', () => {
  // upstream: test/guards.test.ts > not() guard > should guard with inline function
  it.effect('should guard with inline function', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            EVENT: {
              target: 'b',
              guard: not(() => false)
            }
          }
        },
        b: {}
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'EVENT' }));

    expect((yield* actorRef.getSnapshot).matches('b')).toBeTruthy();
  }));

  // upstream: test/guards.test.ts > not() guard > should guard with string
  it.effect('should guard with string', () => Effect.gen(function* () {
    const machine = createMachine(
      {
        initial: 'a',
        states: {
          a: {
            on: {
              EVENT: {
                target: 'b',
                guard: not('falsy')
              }
            }
          },
          b: {}
        }
      },
      {
        guards: {
          falsy: () => false
        }
      }
    );

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'EVENT' }));

    expect((yield* actorRef.getSnapshot).matches('b')).toBeTruthy();
  }));

  // upstream: test/guards.test.ts > not() guard > should guard with object
  it.effect('should guard with object', () => Effect.gen(function* () {
    const machine = createMachine(
      {
        types: {} as {
          guards: { type: 'greaterThan10'; params: { value: number } };
        },
        initial: 'a',
        states: {
          a: {
            on: {
              EVENT: {
                target: 'b',
                guard: not({ type: 'greaterThan10', params: { value: 5 } })
              }
            }
          },
          b: {}
        }
      },
      {
        guards: {
          greaterThan10: (_, params) => {
            return params.value > 10;
          }
        }
      }
    );

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'EVENT' }));

    expect((yield* actorRef.getSnapshot).matches('b')).toBeTruthy();
  }));

  // upstream: test/guards.test.ts > not() guard > should guard with nested built-in guards
  it.effect('should guard with nested built-in guards', () => Effect.gen(function* () {
    const machine = createMachine(
      {
        initial: 'a',
        states: {
          a: {
            on: {
              EVENT: {
                target: 'b',
                guard: not(and([not('truthy'), 'truthy']))
              }
            }
          },
          b: {}
        }
      },
      {
        guards: {
          truthy: () => true,
          falsy: () => false
        }
      }
    );

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'EVENT' }));

    expect((yield* actorRef.getSnapshot).matches('b')).toBeTruthy();
  }));

  // upstream: test/guards.test.ts > not() guard > should evaluate dynamic params of the referenced guard
  it.effect('should evaluate dynamic params of the referenced guard', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine(
      {
        on: {
          EV: {
            guard: not({
              type: 'myGuard',
              // TODO: fix contextual typing here
              params: ({ event }: any) => ({ secret: event.secret })
            }),
            actions: () => {}
          }
        }
      },
      {
        guards: {
          myGuard: (_, params) => {
            spy(params);
            return true;
          }
        }
      }
    );

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'EV', secret: 42 }));

    expect(spy.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "secret": 42,
          },
        ],
      ]
    `);
  }));
});

describe('and() guard', () => {
  // upstream: test/guards.test.ts > and() guard > should guard with inline function
  it.effect('should guard with inline function', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            EVENT: {
              target: 'b',
              guard: and([() => true, () => 1 + 1 === 2])
            }
          }
        },
        b: {}
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'EVENT' }));

    expect((yield* actorRef.getSnapshot).matches('b')).toBeTruthy();
  }));

  // upstream: test/guards.test.ts > and() guard > should guard with string
  it.effect('should guard with string', () => Effect.gen(function* () {
    const machine = createMachine(
      {
        initial: 'a',
        states: {
          a: {
            on: {
              EVENT: {
                target: 'b',
                guard: and(['truthy', 'truthy'])
              }
            }
          },
          b: {}
        }
      },
      {
        guards: {
          truthy: () => true
        }
      }
    );

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'EVENT' }));

    expect((yield* actorRef.getSnapshot).matches('b')).toBeTruthy();
  }));

  // upstream: test/guards.test.ts > and() guard > should guard with object
  it.effect('should guard with object', () => Effect.gen(function* () {
    const machine = createMachine(
      {
        types: {} as {
          guards: {
            type: 'greaterThan10';
            params: { value: number };
          };
        },
        initial: 'a',
        states: {
          a: {
            on: {
              EVENT: {
                target: 'b',
                guard: and([
                  { type: 'greaterThan10', params: { value: 11 } },
                  { type: 'greaterThan10', params: { value: 50 } }
                ])
              }
            }
          },
          b: {}
        }
      },
      {
        guards: {
          greaterThan10: (_, params) => {
            return params.value > 10;
          }
        }
      }
    );

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'EVENT' }));

    expect((yield* actorRef.getSnapshot).matches('b')).toBeTruthy();
  }));

  // upstream: test/guards.test.ts > and() guard > should guard with nested built-in guards
  it.effect('should guard with nested built-in guards', () => Effect.gen(function* () {
    const machine = createMachine(
      {
        initial: 'a',
        states: {
          a: {
            on: {
              EVENT: {
                target: 'b',
                guard: and([
                  () => true,
                  not('falsy'),
                  and([not('falsy'), 'truthy'])
                ])
              }
            }
          },
          b: {}
        }
      },
      {
        guards: {
          truthy: () => true,
          falsy: () => false
        }
      }
    );

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'EVENT' }));

    expect((yield* actorRef.getSnapshot).matches('b')).toBeTruthy();
  }));

  // upstream: test/guards.test.ts > and() guard > should evaluate dynamic params of the referenced guard
  it.effect('should evaluate dynamic params of the referenced guard', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine(
      {
        on: {
          EV: {
            guard: and([
              {
                type: 'myGuard',
                // TODO: fix contextual typing here
                params: ({ event }: any) => ({ secret: event.secret })
              },
              () => true
            ]),
            actions: () => {}
          }
        }
      },
      {
        guards: {
          myGuard: (_, params) => {
            spy(params);
            return true;
          }
        }
      }
    );

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'EV', secret: 42 }));

    expect(spy.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "secret": 42,
          },
        ],
      ]
    `);
  }));
});

describe('or() guard', () => {
  // upstream: test/guards.test.ts > or() guard > should guard with inline function
  it.effect('should guard with inline function', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            EVENT: {
              target: 'b',
              guard: or([() => false, () => 1 + 1 === 2])
            }
          }
        },
        b: {}
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'EVENT' }));

    expect((yield* actorRef.getSnapshot).matches('b')).toBeTruthy();
  }));

  // upstream: test/guards.test.ts > or() guard > should guard with string
  it.effect('should guard with string', () => Effect.gen(function* () {
    const machine = createMachine(
      {
        initial: 'a',
        states: {
          a: {
            on: {
              EVENT: {
                target: 'b',
                guard: or(['falsy', 'truthy'])
              }
            }
          },
          b: {}
        }
      },
      {
        guards: {
          falsy: () => false,
          truthy: () => true
        }
      }
    );

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'EVENT' }));

    expect((yield* actorRef.getSnapshot).matches('b')).toBeTruthy();
  }));

  // upstream: test/guards.test.ts > or() guard > should guard with object
  it.effect('should guard with object', () => Effect.gen(function* () {
    const machine = createMachine(
      {
        types: {} as {
          guards: {
            type: 'greaterThan10';
            params: { value: number };
          };
        },
        initial: 'a',
        states: {
          a: {
            on: {
              EVENT: {
                target: 'b',
                guard: or([
                  { type: 'greaterThan10', params: { value: 4 } },
                  { type: 'greaterThan10', params: { value: 50 } }
                ])
              }
            }
          },
          b: {}
        }
      },
      {
        guards: {
          greaterThan10: (_, params) => {
            return params.value > 10;
          }
        }
      }
    );

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'EVENT' }));

    expect((yield* actorRef.getSnapshot).matches('b')).toBeTruthy();
  }));

  // upstream: test/guards.test.ts > or() guard > should guard with nested built-in guards
  it.effect('should guard with nested built-in guards', () => Effect.gen(function* () {
    const machine = createMachine(
      {
        initial: 'a',
        states: {
          a: {
            on: {
              EVENT: {
                target: 'b',
                guard: or([
                  () => false,
                  not('truthy'),
                  and([not('falsy'), 'truthy'])
                ])
              }
            }
          },
          b: {}
        }
      },
      {
        guards: {
          truthy: () => true,
          falsy: () => false
        }
      }
    );

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'EVENT' }));

    expect((yield* actorRef.getSnapshot).matches('b')).toBeTruthy();
  }));

  // upstream: test/guards.test.ts > or() guard > should evaluate dynamic params of the referenced guard
  it.effect('should evaluate dynamic params of the referenced guard', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine(
      {
        on: {
          EV: {
            guard: or([
              {
                type: 'myGuard',
                // TODO: fix contextual typing here
                params: ({ event }: any) => ({ secret: event.secret })
              },
              () => true
            ]),
            actions: () => {}
          }
        }
      },
      {
        guards: {
          myGuard: (_, params) => {
            spy(params);
            return true;
          }
        }
      }
    );

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'EV', secret: 42 }));

    expect(spy.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "secret": 42,
          },
        ],
      ]
    `);
  }));
});
