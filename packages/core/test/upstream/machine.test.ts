import { describe, expect, it, vi } from "@effect/vitest"
import { Effect } from "effect"
import { createActor, createMachine, assign, setup, getInitialSnapshot } from "../../src/index.js";

const pedestrianStates = {
  initial: 'walk',
  states: {
    walk: {
      on: {
        PED_COUNTDOWN: 'wait'
      }
    },
    wait: {
      on: {
        PED_COUNTDOWN: 'stop'
      }
    },
    stop: {}
  }
};

const lightMachine = createMachine({
  initial: 'green',
  states: {
    green: {
      on: {
        TIMER: 'yellow',
        POWER_OUTAGE: 'red',
        FORBIDDEN_EVENT: undefined
      }
    },
    yellow: {
      on: {
        TIMER: 'red',
        POWER_OUTAGE: 'red'
      }
    },
    red: {
      on: {
        TIMER: 'green',
        POWER_OUTAGE: 'red'
      },
      ...pedestrianStates
    }
  }
});

describe('machine', () => {
  describe('machine.states', () => {
    // upstream: test/machine.test.ts > machine > machine.states > should properly register machine states
    it.effect('should properly register machine states', () => Effect.gen(function* () {
      expect(Object.keys(lightMachine.states)).toEqual([
        'green',
        'yellow',
        'red'
      ]);
    }));
  });

  describe('machine.events', () => {
    // upstream: test/machine.test.ts > machine > machine.events > should return the set of events accepted by machine
    it.effect('should return the set of events accepted by machine', () => Effect.gen(function* () {
      expect(lightMachine.events).toEqual([
        'TIMER',
        'POWER_OUTAGE',
        'PED_COUNTDOWN'
      ]);
    }));
  });

  describe('machine.config', () => {
    // upstream: test/machine.test.ts > machine > machine.config > state node config should reference original machine config
    it.effect('state node config should reference original machine config', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'one',
        states: {
          one: {
            initial: 'deep',
            states: {
              deep: {}
            }
          }
        }
      });

      const oneState = machine.states.one!;

      expect(oneState.config).toBe(machine.config.states!.one);

      const deepState = machine.states.one!.states.deep!;

      expect(deepState.config).toBe(machine.config.states!.one!.states!.deep);

      deepState.config.meta = 'testing meta';

      expect(machine.config.states!.one!.states!.deep!.meta).toEqual(
        'testing meta'
      );
    }));
  });

  describe('machine.provide', () => {
    // upstream: test/machine.test.ts > machine > machine.provide > should override an action
    it.effect('should override an action', () => Effect.gen(function* () {
      const originalEntry = vi.fn();
      const overridenEntry = vi.fn();

      const machine = createMachine(
        {
          entry: 'entryAction'
        },
        {
          actions: {
            entryAction: originalEntry
          }
        }
      );
      const differentMachine = machine.provide({
        actions: {
          entryAction: overridenEntry
        }
      });

      (yield* Effect.tap(createActor(differentMachine), (a) => a.start));

      expect(originalEntry).toHaveBeenCalledTimes(0);
      expect(overridenEntry).toHaveBeenCalledTimes(1);
    }));

    // upstream: test/machine.test.ts > machine > machine.provide > should override a guard
    it.effect('should override a guard', () => Effect.gen(function* () {
      const originalGuard = vi.fn().mockImplementation(() => true);
      const overridenGuard = vi.fn().mockImplementation(() => true);

      const machine = createMachine(
        {
          on: {
            EVENT: {
              guard: 'someCondition',
              actions: () => {}
            }
          }
        },
        {
          guards: {
            someCondition: originalGuard
          }
        }
      );

      const differentMachine = machine.provide({
        guards: { someCondition: overridenGuard }
      });

      const actorRef = (yield* Effect.tap(createActor(differentMachine), (a) => a.start));
      (yield* actorRef.send({ type: 'EVENT' }));

      expect(originalGuard).toHaveBeenCalledTimes(0);
      expect(overridenGuard).toHaveBeenCalledTimes(1);
    }));

    // upstream: test/machine.test.ts > machine > machine.provide > should not override context if not defined
    it.effect('should not override context if not defined', () => Effect.gen(function* () {
      const machine = createMachine({
        context: {
          foo: 'bar'
        }
      });
      const differentMachine = machine.provide({});
      const actorRef = (yield* Effect.tap(createActor(differentMachine), (a) => a.start));
      expect((yield* actorRef.getSnapshot).context).toEqual({ foo: 'bar' });
    }));

    // NOT PORTED (skipped upstream, ledger row): machine > machine.provide > should override context (second argument)

    // https://github.com/davidkpiano/xstate/issues/674
    // upstream: test/machine.test.ts > machine > machine.provide > should throw if initial state is missing in a compound state
    it.effect('should throw if initial state is missing in a compound state', () => Effect.gen(function* () {
      // SD-3 (amended 2026-10-08): `createMachine` keeps the definition error, and the Effect
      // that computes the machine's initial snapshot fails with it. The flipped failure is what
      // upstream's bare `toThrow()` checks.
      expect(
        yield* Effect.flip(getInitialSnapshot(
          createMachine({
            initial: 'first',
            states: {
              first: {
                states: {
                  second: {},
                  third: {}
                }
              }
            }
          })
        ))
      ).toBeInstanceOf(Error);
    }));

    // upstream: test/machine.test.ts > machine > machine.provide > machines defined without context should have a default empty object for context
    it.effect('machines defined without context should have a default empty object for context', () => Effect.gen(function* () {
      expect((yield* (yield* createActor(createMachine({}))).getSnapshot).context).toEqual({});
    }));

    // upstream: test/machine.test.ts > machine > machine.provide > should lazily create context for all interpreter instances created from the same machine template created by `provide`
    it.effect('should lazily create context for all interpreter instances created from the same machine template created by `provide`', () => Effect.gen(function* () {
      const machine = createMachine({
        types: {} as { context: { foo: { prop: string } } },
        context: () => ({
          foo: { prop: 'baz' }
        })
      });

      const copiedMachine = machine.provide({});

      const a = (yield* Effect.tap(createActor(copiedMachine), (a) => a.start));
      const b = (yield* Effect.tap(createActor(copiedMachine), (a) => a.start));

      expect((yield* a.getSnapshot).context.foo).not.toBe((yield* b.getSnapshot).context.foo);
    }));
  });

  describe('machine function context', () => {
    // upstream: test/machine.test.ts > machine > machine function context > context from a function should be lazily evaluated
    it.effect('context from a function should be lazily evaluated', () => Effect.gen(function* () {
      const config = {
        initial: 'active',
        context: () => ({
          foo: { bar: 'baz' }
        }),
        states: {
          active: {}
        }
      };
      const testMachine1 = createMachine(config);
      const testMachine2 = createMachine(config);

      const initialState1 = (yield* (yield* createActor(testMachine1)).getSnapshot);
      const initialState2 = (yield* (yield* createActor(testMachine2)).getSnapshot);

      expect(initialState1.context).not.toBe(initialState2.context);

      expect(initialState1.context).toEqual({
        foo: { bar: 'baz' }
      });

      expect(initialState2.context).toEqual({
        foo: { bar: 'baz' }
      });
    }));
  });

  describe('machine.resolveStateValue()', () => {
    const resolveMachine = createMachine({
      id: 'resolve',
      initial: 'foo',
      states: {
        foo: {
          initial: 'one',
          states: {
            one: {
              type: 'parallel',
              states: {
                a: {
                  initial: 'aa',
                  states: { aa: {} }
                },
                b: {
                  initial: 'bb',
                  states: { bb: {} }
                }
              },
              on: {
                TO_TWO: 'two'
              }
            },
            two: {
              on: { TO_ONE: 'one' }
            }
          },
          on: {
            TO_BAR: 'bar'
          }
        },
        bar: {
          on: {
            TO_FOO: 'foo'
          }
        }
      }
    });

    // upstream: test/machine.test.ts > machine > machine.resolveStateValue() > should resolve the state value
    it.effect('should resolve the state value', () => Effect.gen(function* () {
      const resolvedState = (yield* resolveMachine.resolveState({ value: 'foo' }));

      expect(resolvedState.value).toEqual({
        foo: { one: { a: 'aa', b: 'bb' } }
      });
    }));

    // upstream: test/machine.test.ts > machine > machine.resolveStateValue() > should resolve `status: done`
    it.effect('should resolve `status: done`', () => Effect.gen(function* () {
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

      const resolvedState = (yield* machine.resolveState({ value: 'bar' }));

      expect(resolvedState.status).toBe('done');
    }));
  });

  describe('initial state', () => {
    // upstream: test/machine.test.ts > machine > initial state > should follow always transition
    it.effect('should follow always transition', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'a',
        states: {
          a: {
            always: [{ target: 'b' }]
          },
          b: {}
        }
      });

      expect((yield* (yield* createActor(machine)).getSnapshot).value).toBe('b');
    }));
  });

  describe('versioning', () => {
    // upstream: test/machine.test.ts > machine > versioning > should allow a version to be specified
    it.effect('should allow a version to be specified', () => Effect.gen(function* () {
      const versionMachine = createMachine({
        id: 'version',
        version: '1.0.4',
        states: {}
      });

      expect(versionMachine.version).toEqual('1.0.4');
    }));
  });

  describe('id', () => {
    // upstream: test/machine.test.ts > machine > id > should represent the ID
    it.effect('should represent the ID', () => Effect.gen(function* () {
      const idMachine = createMachine({
        id: 'some-id',
        initial: 'idle',
        states: { idle: {} }
      });

      expect(idMachine.id).toEqual('some-id');
    }));

    // upstream: test/machine.test.ts > machine > id > should represent the ID (state node)
    it.effect('should represent the ID (state node)', () => Effect.gen(function* () {
      const idMachine = createMachine({
        id: 'some-id',
        initial: 'idle',
        states: {
          idle: {
            id: 'idle'
          }
        }
      });

      expect(idMachine.states.idle!.id).toEqual('idle');
    }));

    // upstream: test/machine.test.ts > machine > id > should use the key as the ID if no ID is provided (state node)
    it.effect('should use the key as the ID if no ID is provided (state node)', () => Effect.gen(function* () {
      const noStateNodeIDMachine = createMachine({
        id: 'some-id',
        initial: 'idle',
        states: { idle: {} }
      });

      expect(noStateNodeIDMachine.states.idle!.id).toEqual('some-id.idle');
    }));
  });

  describe('combinatorial machines', () => {
    // upstream: test/machine.test.ts > machine > combinatorial machines > should support combinatorial machines (single-state)
    it.effect('should support combinatorial machines (single-state)', () => Effect.gen(function* () {
      const testMachine = createMachine({
        types: {} as { context: { value: number } },
        context: { value: 42 },
        on: {
          INC: {
            actions: assign({ value: ({ context }) => context.value + 1 })
          }
        }
      });

      const actorRef = (yield* createActor(testMachine));
      expect((yield* actorRef.getSnapshot).value).toEqual({});

      (yield* actorRef.start);
      (yield* actorRef.send({ type: 'INC' }));

      expect((yield* actorRef.getSnapshot).context.value).toEqual(43);
    }));
  });

  // upstream: test/machine.test.ts > machine > should pass through schemas
  it.effect('should pass through schemas', () => Effect.gen(function* () {
    const machine = setup({
      schemas: {
        context: { count: { type: 'number' } }
      }
    }).createMachine({});

    expect(machine.schemas).toEqual({
      context: { count: { type: 'number' } }
    });
  }));
});

describe('StateNode', () => {
  // upstream: test/machine.test.ts > StateNode > should list transitions
  it.effect('should list transitions', () => Effect.gen(function* () {
    const greenNode = lightMachine.states.green!;

    const transitions = greenNode.transitions;

    // The port's transitions are the upstream Map's entries in its order (SD-22, amended 2026-10-08)
    expect(transitions.map(([descriptor]) => descriptor)).toEqual([
      'TIMER',
      'POWER_OUTAGE',
      'FORBIDDEN_EVENT'
    ]);
  }));
});
