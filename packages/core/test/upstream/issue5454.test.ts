import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit } from "effect"
import {
  createMachine,
  initialTransition,
  transition,
  fromPromise,
  fromTransition
} from "../../src/index.js";

// `initialTransition` and `transition` return Effects (SD-13) that give `[snapshot, actions]`
// (P7), so they are not synchronous throw sites (SD-3): upstream's "does not throw" is an
// Exit that is a success.

/**
 * Regression tests for: Bug #5454
 * `initialTransition` fails when invoke has `systemId`
 *
 * Root cause: `createInertActorScope` called `createActor(logic)` which
 * eagerly ran `getInitialSnapshot` and registered child actors with `systemId`
 * in the system. Then `initialTransition` called `getInitialSnapshot` again on
 * the same system, causing "Actor with system ID '...' already exists".
 */
describe('initialTransition / transition with invoke systemId (issue #5454)', () => {
  // upstream: test/issue5454.test.ts > initialTransition / transition with invoke systemId (issue #5454) > does not throw when the initial state has an invoke with systemId
  it.effect('does not throw when the initial state has an invoke with systemId', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'idle',
      states: {
        idle: {
          invoke: {
            src: fromPromise(async () => 42),
            systemId: 'myActor'
          }
        }
      }
    });

    const exit = yield* Effect.exit(initialTransition(machine));
    expect(Exit.isSuccess(exit)).toBe(true);
  }));

  // upstream: test/issue5454.test.ts > initialTransition / transition with invoke systemId (issue #5454) > returns the correct initial snapshot when invoke has systemId
  it.effect('returns the correct initial snapshot when invoke has systemId', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'idle',
      states: {
        idle: {
          invoke: {
            src: fromPromise(async () => 42),
            systemId: 'myActor'
          }
        }
      }
    });

    const [snapshot, actions] = yield* initialTransition(machine);
    expect(snapshot.value).toBe('idle');
    expect(actions).toHaveLength(1); // the spawnChild action for the invoke
  }));

  // upstream: test/issue5454.test.ts > initialTransition / transition with invoke systemId (issue #5454) > is idempotent: repeated calls do not throw
  it.effect('is idempotent: repeated calls do not throw', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'idle',
      states: {
        idle: {
          invoke: {
            src: fromPromise(async () => 42),
            systemId: 'myActor'
          }
        }
      }
    });

    const exit = yield* Effect.exit(
      Effect.gen(function* () {
        yield* initialTransition(machine);
        yield* initialTransition(machine);
        yield* initialTransition(machine);
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
  }));

  // upstream: test/issue5454.test.ts > initialTransition / transition with invoke systemId (issue #5454) > transition() does not throw when the target state has an invoke with systemId
  it.effect('transition() does not throw when the target state has an invoke with systemId', () => Effect.gen(function* () {
    const countMachine = fromTransition(
      (s, e) => (e.type === 'INC' ? s + 1 : s),
      0
    );

    const machine = createMachine({
      initial: 'idle',
      states: {
        idle: {
          on: { START: 'running' }
        },
        running: {
          invoke: {
            src: countMachine,
            systemId: 'counter'
          }
        }
      }
    });

    const [initial] = yield* initialTransition(machine);

    const exit = yield* Effect.exit(transition(machine, initial, { type: 'START' }));
    expect(Exit.isSuccess(exit)).toBe(true);
  }));

  // upstream: test/issue5454.test.ts > initialTransition / transition with invoke systemId (issue #5454) > works with multiple invokes each having a distinct systemId
  it.effect('works with multiple invokes each having a distinct systemId', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'idle',
      states: {
        idle: {
          invoke: [
            {
              src: fromPromise(async () => 1),
              systemId: 'actorOne'
            },
            {
              src: fromPromise(async () => 2),
              systemId: 'actorTwo'
            }
          ]
        }
      }
    });

    const exit = yield* Effect.exit(initialTransition(machine));
    expect(Exit.isSuccess(exit)).toBe(true);
    const [snapshot] = yield* initialTransition(machine);
    expect(snapshot.value).toBe('idle');
  }));
});
