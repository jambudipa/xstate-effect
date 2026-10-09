import { describe, expect, it, vi } from "@effect/vitest"
import { Effect } from "effect"
import {
  createMachine,
  fromTransition,
  getNextSnapshot,
  getInitialSnapshot
} from "../../src/index.js";

// `getInitialSnapshot` and `getNextSnapshot` return Effects (SD-13), so each test is an
// `it.effect` that yields them. Neither creates an actor: both run the logic against an inert
// actor scope, as upstream does.

describe('getNextSnapshot', () => {
  // upstream: test/getNextSnapshot.test.ts > getNextSnapshot > should calculate the next snapshot for transition logic
  it.effect('should calculate the next snapshot for transition logic', () => Effect.gen(function* () {
    const logic = fromTransition(
      (state, event) => {
        if (event.type === 'next') {
          return { count: state.count + 1 };
        } else {
          return state;
        }
      },
      { count: 0 }
    );

    const init = yield* getInitialSnapshot(logic, undefined);
    const s1 = yield* getNextSnapshot(logic, init, { type: 'next' });
    expect(s1.context.count).toEqual(1);
    const s2 = yield* getNextSnapshot(logic, s1, { type: 'next' });
    expect(s2.context.count).toEqual(2);
  }));
  // upstream: test/getNextSnapshot.test.ts > getNextSnapshot > should calculate the next snapshot for machine logic
  it.effect('should calculate the next snapshot for machine logic', () => Effect.gen(function* () {
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
            NEXT: 'c'
          }
        },
        c: {}
      }
    });

    const init = yield* getInitialSnapshot(machine, undefined);
    const s1 = yield* getNextSnapshot(machine, init, { type: 'NEXT' });

    expect(s1.value).toEqual('b');

    const s2 = yield* getNextSnapshot(machine, s1, { type: 'NEXT' });

    expect(s2.value).toEqual('c');
  }));
  // upstream: test/getNextSnapshot.test.ts > getNextSnapshot > should not execute actions
  it.effect('should not execute actions', () => Effect.gen(function* () {
    const fn = vi.fn();

    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            event: {
              target: 'b',
              actions: fn
            }
          }
        },
        b: {}
      }
    });

    const init = yield* getInitialSnapshot(machine, undefined);
    const nextSnapshot = yield* getNextSnapshot(machine, init, { type: 'event' });

    expect(fn).not.toHaveBeenCalled();
    expect(nextSnapshot.value).toEqual('b');
  }));
});
