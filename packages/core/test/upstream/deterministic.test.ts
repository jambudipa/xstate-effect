import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import {
  fromCallback,
  createActor,
  transition,
  createMachine,
  getInitialSnapshot
} from "../../src/index.js";

describe('deterministic machine', () => {
  const lightMachine = createMachine({
    initial: 'green',
    states: {
      green: {
        on: {
          TIMER: 'yellow',
          POWER_OUTAGE: 'red'
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
        initial: 'walk',
        states: {
          walk: {
            on: {
              PED_COUNTDOWN: 'wait',
              TIMER: undefined // forbidden event
            }
          },
          wait: {
            on: {
              PED_COUNTDOWN: 'stop',
              TIMER: undefined // forbidden event
            }
          },
          stop: {}
        }
      }
    }
  });

  const testMachine = createMachine({
    initial: 'a',
    states: {
      a: {
        on: {
          T: 'b.b1',
          F: 'c'
        }
      },
      b: {
        initial: 'b1',
        states: {
          b1: {}
        }
      },
      c: {}
    }
  });

  describe('machine transitions', () => {
    // upstream: test/deterministic.test.ts > deterministic machine > machine transitions > should properly transition states based on event-like object
    it.effect('should properly transition states based on event-like object', () => Effect.gen(function* () {
      expect(
        (yield* transition(
          lightMachine,
          (yield* lightMachine.resolveState({ value: 'green' })),
          {
            type: 'TIMER'
          }
        ))[0].value
      ).toEqual('yellow');
    }));

    // upstream: test/deterministic.test.ts > deterministic machine > machine transitions > should not transition states for illegal transitions
    it.effect('should not transition states for illegal transitions', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'a',
        states: {
          a: {
            on: { NEXT: 'b' }
          },
          b: {}
        }
      });

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

      const previousSnapshot = (yield* actor.getSnapshot);

      (yield* actor.send({
        type: 'FAKE'
      }));

      expect((yield* actor.getSnapshot).value).toBe('a');
      expect((yield* actor.getSnapshot)).toBe(previousSnapshot);
    }));

    // upstream: test/deterministic.test.ts > deterministic machine > machine transitions > should throw an error if not given an event
    it.effect('should throw an error if not given an event', () => Effect.gen(function* () {
      // SD-3 (amended 2026-10-08): as upstream, the failure comes from
      // `testMachine.resolveState` ('red' is not a state of testMachine): its Effect fails, so
      // `transition` never runs. The flipped failure is what upstream's bare `toThrow()` checks.
      expect(
        yield* Effect.flip(
          testMachine.resolveState({ value: 'red' }).pipe(
            Effect.flatMap((snapshot) => transition(lightMachine, snapshot, undefined as any))
          )
        )
      ).toBeInstanceOf(Error);
    }));

    // upstream: test/deterministic.test.ts > deterministic machine > machine transitions > should transition to nested states as target
    it.effect('should transition to nested states as target', () => Effect.gen(function* () {
      expect(
        (yield* transition(testMachine, (yield* testMachine.resolveState({ value: 'a' })), {
          type: 'T'
        }))[0].value
      ).toEqual({
        b: 'b1'
      });
    }));

    // upstream: test/deterministic.test.ts > deterministic machine > machine transitions > should throw an error for transitions from invalid states
    it.effect('should throw an error for transitions from invalid states', () => Effect.gen(function* () {
      // SD-3 (amended 2026-10-08): `resolveState` with an invalid state value fails its Effect.
      expect(
        yield* Effect.flip(
          testMachine.resolveState({ value: 'fake' }).pipe(
            Effect.flatMap((snapshot) => transition(testMachine, snapshot, {
              type: 'T'
            }))
          )
        )
      ).toBeInstanceOf(Error);
    }));

    // upstream: test/deterministic.test.ts > deterministic machine > machine transitions > should throw an error for transitions from invalid substates
    it.effect('should throw an error for transitions from invalid substates', () => Effect.gen(function* () {
      // SD-3 (amended 2026-10-08): `resolveState` with an invalid state value fails its Effect.
      expect(
        yield* Effect.flip(
          testMachine.resolveState({ value: 'a.fake' }).pipe(
            Effect.flatMap((snapshot) => transition(testMachine, snapshot, {
              type: 'T'
            }))
          )
        )
      ).toBeInstanceOf(Error);
    }));

    // upstream: test/deterministic.test.ts > deterministic machine > machine transitions > should use the machine.initialState when an undefined state is given
    it.effect('should use the machine.initialState when an undefined state is given', () => Effect.gen(function* () {
      const init = (yield* getInitialSnapshot(lightMachine, undefined));
      expect(
        (yield* transition(lightMachine, init, { type: 'TIMER' }))[0].value
      ).toEqual('yellow');
    }));

    // upstream: test/deterministic.test.ts > deterministic machine > machine transitions > should use the machine.initialState when an undefined state is given (unhandled event)
    it.effect('should use the machine.initialState when an undefined state is given (unhandled event)', () => Effect.gen(function* () {
      const init = (yield* getInitialSnapshot(lightMachine, undefined));
      expect(
        (yield* transition(lightMachine, init, { type: 'TIMER' }))[0].value
      ).toEqual('yellow');
    }));
  });

  describe('machine transition with nested states', () => {
    // upstream: test/deterministic.test.ts > deterministic machine > machine transition with nested states > should properly transition a nested state
    it.effect('should properly transition a nested state', () => Effect.gen(function* () {
      expect(
        (yield* transition(
          lightMachine,
          (yield* lightMachine.resolveState({ value: { red: 'walk' } })),
          { type: 'PED_COUNTDOWN' }
        ))[0].value
      ).toEqual({ red: 'wait' });
    }));

    // upstream: test/deterministic.test.ts > deterministic machine > machine transition with nested states > should transition from initial nested states
    it.effect('should transition from initial nested states', () => Effect.gen(function* () {
      expect(
        (yield* transition(lightMachine, (yield* lightMachine.resolveState({ value: 'red' })), {
          type: 'PED_COUNTDOWN'
        }))[0].value
      ).toEqual({
        red: 'wait'
      });
    }));

    // upstream: test/deterministic.test.ts > deterministic machine > machine transition with nested states > should transition from deep initial nested states
    it.effect('should transition from deep initial nested states', () => Effect.gen(function* () {
      expect(
        (yield* transition(lightMachine, (yield* lightMachine.resolveState({ value: 'red' })), {
          type: 'PED_COUNTDOWN'
        }))[0].value
      ).toEqual({
        red: 'wait'
      });
    }));

    // upstream: test/deterministic.test.ts > deterministic machine > machine transition with nested states > should bubble up events that nested states cannot handle
    it.effect('should bubble up events that nested states cannot handle', () => Effect.gen(function* () {
      expect(
        (yield* transition(
          lightMachine,
          (yield* lightMachine.resolveState({ value: { red: 'stop' } })),
          { type: 'TIMER' }
        ))[0].value
      ).toEqual('green');
    }));

    // upstream: test/deterministic.test.ts > deterministic machine > machine transition with nested states > should not transition from illegal events
    it.effect('should not transition from illegal events', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'a',
        states: {
          a: {
            initial: 'b',
            states: {
              b: {
                on: { NEXT: 'c' }
              },
              c: {}
            }
          }
        }
      });

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

      const previousSnapshot = (yield* actor.getSnapshot);

      (yield* actor.send({
        type: 'FAKE'
      }));

      expect((yield* actor.getSnapshot).value).toEqual({ a: 'b' });
      expect((yield* actor.getSnapshot)).toBe(previousSnapshot);
    }));

    // upstream: test/deterministic.test.ts > deterministic machine > machine transition with nested states > should transition to the deepest initial state
    it.effect('should transition to the deepest initial state', () => Effect.gen(function* () {
      expect(
        (yield* transition(
          lightMachine,
          (yield* lightMachine.resolveState({ value: 'yellow' })),
          {
            type: 'TIMER'
          }
        ))[0].value
      ).toEqual({
        red: 'walk'
      });
    }));

    // upstream: test/deterministic.test.ts > deterministic machine > machine transition with nested states > should return the same state if no transition occurs
    it.effect('should return the same state if no transition occurs', () => Effect.gen(function* () {
      const init = (yield* getInitialSnapshot(lightMachine, undefined));
      const [initialState] = (yield* transition(lightMachine, init, {
        type: 'NOTHING'
      }));
      const [nextState] = (yield* transition(lightMachine, initialState, {
        type: 'NOTHING'
      }));

      expect(initialState.value).toEqual(nextState.value);
      expect(nextState).toBe(initialState);
    }));
  });

  describe('state key names', () => {
    const machine = createMachine(
      {
        initial: 'test',
        states: {
          test: {
            invoke: [{ src: 'activity' }],
            entry: ['onEntry'],
            on: {
              NEXT: 'test'
            },
            exit: ['onExit']
          }
        }
      },
      {
        actors: {
          activity: fromCallback(() => () => {})
        }
      }
    );

    // upstream: test/deterministic.test.ts > deterministic machine > state key names > should work with substate nodes that have the same key
    it.effect('should work with substate nodes that have the same key', () => Effect.gen(function* () {
      const init = (yield* getInitialSnapshot(machine, undefined));
      expect((yield* transition(machine, init, { type: 'NEXT' }))[0].value).toEqual(
        'test'
      );
    }));
  });

  describe('forbidden events', () => {
    // upstream: test/deterministic.test.ts > deterministic machine > forbidden events > undefined transitions should forbid events
    it.effect('undefined transitions should forbid events', () => Effect.gen(function* () {
      const [walkState] = (yield* transition(
        lightMachine,
        (yield* lightMachine.resolveState({ value: { red: 'walk' } })),
        { type: 'TIMER' }
      ));

      expect(walkState.value).toEqual({ red: 'walk' });
    }));
  });
});
