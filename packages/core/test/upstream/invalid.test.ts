import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { createMachine, getInitialSnapshot, getNextSnapshot } from "../../src/index.js";

describe('invalid or resolved states', () => {
  // upstream: test/invalid.test.ts > invalid or resolved states > should resolve a String state
  it.effect('should resolve a String state', () => Effect.gen(function* () {
    const machine = createMachine({
      type: 'parallel',
      states: {
        A: {
          initial: 'A1',
          states: {
            A1: {},
            A2: {}
          }
        },
        B: {
          initial: 'B1',
          states: {
            B1: {},
            B2: {}
          }
        }
      }
    });
    expect(
      (yield* getNextSnapshot(machine, (yield* machine.resolveState({ value: 'A' })), {
        type: 'E'
      })).value
    ).toEqual({
      A: 'A1',
      B: 'B1'
    });
  }));

  // upstream: test/invalid.test.ts > invalid or resolved states > should resolve transitions from empty states
  it.effect('should resolve transitions from empty states', () => Effect.gen(function* () {
    const machine = createMachine({
      type: 'parallel',
      states: {
        A: {
          initial: 'A1',
          states: {
            A1: {},
            A2: {}
          }
        },
        B: {
          initial: 'B1',
          states: {
            B1: {},
            B2: {}
          }
        }
      }
    });
    expect(
      (yield* getNextSnapshot(
        machine,
        (yield* machine.resolveState({ value: { A: {}, B: {} } })),
        { type: 'E' }
      )).value
    ).toEqual({
      A: 'A1',
      B: 'B1'
    });
  }));

  // upstream: test/invalid.test.ts > invalid or resolved states > should allow transitioning from valid states
  it.effect('should allow transitioning from valid states', () => Effect.gen(function* () {
    const machine = createMachine({
      type: 'parallel',
      states: {
        A: {
          initial: 'A1',
          states: {
            A1: {},
            A2: {}
          }
        },
        B: {
          initial: 'B1',
          states: {
            B1: {},
            B2: {}
          }
        }
      }
    });
    yield* getNextSnapshot(
      machine,
      (yield* machine.resolveState({ value: { A: 'A1', B: 'B1' } })),
      { type: 'E' }
    );
  }));

  // upstream: test/invalid.test.ts > invalid or resolved states > should reject transitioning from bad state configs
  it.effect('should reject transitioning from bad state configs', () => Effect.gen(function* () {
    const machine = createMachine({
      type: 'parallel',
      states: {
        A: {
          initial: 'A1',
          states: {
            A1: {},
            A2: {}
          }
        },
        B: {
          initial: 'B1',
          states: {
            B1: {},
            B2: {}
          }
        }
      }
    });
    // SD-3 (amended 2026-10-08): as upstream, the failure comes from `machine.resolveState`
    // ('A3' and 'B3' are not states of the machine): its Effect fails, so `getNextSnapshot`
    // never runs. The flipped failure is what upstream's bare `toThrow()` checks.
    expect(
      yield* Effect.flip(
        machine.resolveState({ value: { A: 'A3', B: 'B3' } }).pipe(
          Effect.flatMap((snapshot) => getNextSnapshot(machine, snapshot, { type: 'E' }))
        )
      )
    ).toBeInstanceOf(Error);
  }));

  // upstream: test/invalid.test.ts > invalid or resolved states > should resolve transitioning from partially valid states
  it.effect('should resolve transitioning from partially valid states', () => Effect.gen(function* () {
    const machine = createMachine({
      type: 'parallel',
      states: {
        A: {
          initial: 'A1',
          states: {
            A1: {},
            A2: {}
          }
        },
        B: {
          initial: 'B1',
          states: {
            B1: {},
            B2: {}
          }
        }
      }
    });
    expect(
      (yield* getNextSnapshot(
        machine,
        (yield* machine.resolveState({ value: { A: 'A1', B: {} } })),
        { type: 'E' }
      )).value
    ).toEqual({
      A: 'A1',
      B: 'B1'
    });
  }));
});

describe('invalid transition', () => {
  // upstream: test/invalid.test.ts > invalid transition > should throw when attempting to create a machine with a sibling target on the root node
  it.effect('should throw when attempting to create a machine with a sibling target on the root node', () => Effect.gen(function* () {
    // SD-3 (amended 2026-10-08): an invalid target is a `createMachine` definition error,
    // which the machine keeps; the Effect that computes its initial snapshot fails with the
    // upstream message.
    expect(
      (yield* Effect.flip(getInitialSnapshot(
        createMachine({
          id: 'direction',
          initial: 'left',
          states: {
            left: {},
            right: {}
          },
          on: {
            LEFT_CLICK: 'left',
            RIGHT_CLICK: 'right'
          }
        })
      ))).message
    ).toMatch(/invalid target/i);
  }));
});
