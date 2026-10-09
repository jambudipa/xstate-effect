import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { createActor, createMachine, log, spawnChild } from "../../src/index.js";

// Upstream starts an invoked or spawned child, and runs its entry `log`, before the parent's
// `start()` returns. The port does the same: each child runs in its own fiber (D12), and the
// root's `start` starts its initial children before it returns (C22 pins the order). A test
// still yields its fiber, at most 100 times and never on wall-clock time, until the child has
// called the root `logger` (C22, SD-21); the wait ends at once.
const yieldUntil = (done: () => boolean | Effect.Effect<boolean>) =>
  Effect.yieldNow.pipe(Effect.repeat({ until: done, times: 100 }));

// Upstream's `expect.assertions(1)` holds only if the child logs exactly once (A8): give a
// second, late call the chance to run, so that the count is not vacuous.
const settle = yieldUntil(() => false);

describe('logger', () => {
  // upstream: test/logger.test.ts > logger > system logger should be default logger for actors (invoked from machine)
  it.effect('system logger should be default logger for actors (invoked from machine)', () => Effect.gen(function* () {
    // upstream fails through the global rethrow of the logger's error; that rethrow is not
    // ported (SD-21), so a failed assertion in the logger only sets the child and the root to
    // status 'error' (SD-4) and the test reads both statuses after the settle. Upstream's 1
    // assertion plus the 2 status checks
    expect.assertions(3);
    let calls = 0;
    const machine = createMachine({
      invoke: {
        src: createMachine({
          entry: log('hello')
        })
      }
    });

    const actor = (yield* Effect.tap(createActor(machine, {
      logger: (arg) => {
        calls++;
        expect(arg).toEqual('hello');
      }
    }), (a) => a.start));

    (yield* actor.start);

    yield* yieldUntil(() => calls > 0);
    yield* settle;
    const snapshot = yield* actor.getSnapshot;
    expect(snapshot.status).toBe('active');
    const children = yield* Effect.forEach(Object.values(snapshot.children), (child) => child.getSnapshotUntyped);
    expect(children.map((child) => child.status)).toEqual(['active']);
  }));

  // upstream: test/logger.test.ts > logger > system logger should be default logger for actors (spawned from machine)
  it.effect('system logger should be default logger for actors (spawned from machine)', () => Effect.gen(function* () {
    // upstream fails through the global rethrow of the logger's error; that rethrow is not
    // ported (SD-21), so a failed assertion in the logger only sets the child and the root to
    // status 'error' (SD-4) and the test reads both statuses after the settle. Upstream's 1
    // assertion plus the 2 status checks
    expect.assertions(3);
    let calls = 0;
    const machine = createMachine({
      entry: spawnChild(
        createMachine({
          entry: log('hello')
        })
      )
    });

    const actor = (yield* Effect.tap(createActor(machine, {
      logger: (arg) => {
        calls++;
        expect(arg).toEqual('hello');
      }
    }), (a) => a.start));

    (yield* actor.start);

    yield* yieldUntil(() => calls > 0);
    yield* settle;
    const snapshot = yield* actor.getSnapshot;
    expect(snapshot.status).toBe('active');
    const children = yield* Effect.forEach(Object.values(snapshot.children), (child) => child.getSnapshotUntyped);
    expect(children.map((child) => child.status)).toEqual(['active']);
  }));
});
