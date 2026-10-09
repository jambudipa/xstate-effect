import { describe, expect, it, vi } from "@effect/vitest"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { createActor, waitFor, createMachine } from "../../src/index.js";

// `waitFor` returns an Effect (D6): `await waitFor(...)` is `yield* waitFor(...)`, a
// rejection is a failure of that Effect (`Effect.flip` for `.rejects`, `Effect.catch` for a
// `catch` block), and its `timeout` runs on the Effect clock (SD-28). Upstream defers a call
// with `setTimeout(fn, 10)` on the host timer; the rewrite runs the same call in a fiber of
// the test's scope after 10 ms of Effect-clock time, and the test advances the `TestClock`
// in 10 ms steps while it waits, so nothing waits on wall-clock time. The 'abort' listener
// tests keep upstream's `AbortController` and its spied `addEventListener` and
// `removeEventListener`: the `signal` option takes the same `AbortSignal` (P9).
//
// The port's `Actor` has two ways to observe its snapshots: `subscribe` (upstream's) and the
// `changes` Stream that replaces the observer object (D6, DEV-3). `subscribe` is a readonly
// member of the `Actor` type, so `vi.spyOn` stands in for upstream's assignment, and the
// "should not subscribe" tests spy on the `changes` getter as well.

describe('waitFor', () => {
  // upstream: test/waitFor.test.ts > waitFor > should wait for a condition to be true and return the emitted value
  it.effect('should wait for a condition to be true and return the emitted value', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: { NEXT: 'b' }
        },
        b: {}
      }
    });

    const service = yield* Effect.tap(createActor(machine), (a) => a.start);

    yield* Effect.forkScoped(
      Effect.andThen(Effect.sleep("10 millis"), service.send({ type: 'NEXT' })),
      { startImmediately: true }
    );

    const state = yield* waitFor(service, (s) => s.matches('b')).pipe(
      Effect.raceFirst(Effect.forever(TestClock.adjust("10 millis")))
    );

    expect(state.value).toEqual('b');
  }));

  // upstream: test/waitFor.test.ts > waitFor > should throw an error after a timeout
  it.effect('should throw an error after a timeout', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: { NEXT: 'b' }
        },
        b: {
          on: { NEXT: 'c' }
        },
        c: {}
      }
    });

    const service = yield* Effect.tap(createActor(machine), (a) => a.start);

    yield* waitFor(service, (state) => state.matches('c'), { timeout: 10 }).pipe(
      Effect.raceFirst(Effect.forever(TestClock.adjust("10 millis"))),
      Effect.catch((e) =>
        Effect.sync(() => {
          expect(e).toBeInstanceOf(Error);
        })
      )
    );
  }));

  // upstream: test/waitFor.test.ts > waitFor > should not reject immediately when passing Infinity as timeout
  it.effect('should not reject immediately when passing Infinity as timeout', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: { NEXT: 'b' }
        },
        b: {
          on: { NEXT: 'c' }
        },
        c: {}
      }
    });
    const service = yield* Effect.tap(createActor(machine), (a) => a.start);
    // `Promise.race` is `Effect.raceFirst`, which also ends with the first failure
    const result = yield* Effect.raceFirst(
      waitFor(service, (state) => state.matches('c'), {
        timeout: Infinity
      }),
      Effect.sleep("10 millis").pipe(Effect.as('timeout'))
    ).pipe(Effect.raceFirst(Effect.forever(TestClock.adjust("10 millis"))));

    expect(result).toBe('timeout');
    yield* service.stop;
  }));

  // upstream: test/waitFor.test.ts > waitFor > should throw an error when reaching a final state that does not match the predicate
  it.effect('should throw an error when reaching a final state that does not match the predicate', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: { NEXT: 'b' }
        },
        b: {
          type: 'final'
        }
      }
    });

    const service = yield* Effect.tap(createActor(machine), (a) => a.start);

    yield* Effect.forkScoped(
      Effect.andThen(Effect.sleep("10 millis"), service.send({ type: 'NEXT' })),
      { startImmediately: true }
    );

    // the port fails with its `WaitForTerminatedError` (scenario P9), so the snapshot prints
    // that class name where upstream prints `Error` (ledger row; SD-26)
    expect(
      yield* Effect.flip(waitFor(service, (state) => state.matches('never'))).pipe(
        Effect.raceFirst(Effect.forever(TestClock.adjust("10 millis")))
      )
    ).toMatchInlineSnapshot(
      `[WaitForTerminatedError: Actor terminated without satisfying predicate]`
    );
  }));

  // upstream: test/waitFor.test.ts > waitFor > should resolve correctly when the predicate immediately matches the current state
  it.effect('should resolve correctly when the predicate immediately matches the current state', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {}
      }
    });

    const service = yield* Effect.tap(createActor(machine), (a) => a.start);

    expect(
      yield* waitFor(service, (state) => state.matches('a'))
    ).toHaveProperty('value', 'a');
  }));

  // upstream: test/waitFor.test.ts > waitFor > should not subscribe when the predicate immediately matches
  it.effect('should not subscribe when the predicate immediately matches', () => Effect.gen(function* () {
    const machine = createMachine({});

    const actorRef = yield* Effect.tap(createActor(machine), (a) => a.start);
    const spy = vi.spyOn(actorRef, 'subscribe');
    const changesSpy = vi.spyOn(actorRef, 'changes', 'get');

    yield* waitFor(actorRef, () => true);

    expect(spy).not.toHaveBeenCalled();
    expect(changesSpy).not.toHaveBeenCalled();
  }));

  // upstream: test/waitFor.test.ts > waitFor > should internally unsubscribe when the predicate immediately matches the current state
  it.effect('should internally unsubscribe when the predicate immediately matches the current state', () => Effect.gen(function* () {
    let count = 0;
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            NEXT: 'b'
          }
        },
        b: {}
      }
    });

    const service = yield* Effect.tap(createActor(machine), (a) => a.start);

    yield* waitFor(service, (state) => {
      count++;
      return state.matches('a');
    });

    yield* service.send({ type: 'NEXT' });

    expect(count).toBe(1);
  }));

  // upstream: test/waitFor.test.ts > waitFor > should immediately resolve for an actor in its final state that matches the predicate
  it.effect('should immediately resolve for an actor in its final state that matches the predicate', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            NEXT: 'b'
          }
        },
        b: {
          type: 'final'
        }
      }
    });

    const service = yield* Effect.tap(createActor(machine), (a) => a.start);
    yield* service.send({ type: 'NEXT' });

    expect(
      yield* waitFor(service, (state) => state.matches('b'))
    ).toHaveProperty('value', 'b');
  }));

  // upstream: test/waitFor.test.ts > waitFor > should immediately reject for an actor in its final state that does not match the predicate
  it.effect('should immediately reject for an actor in its final state that does not match the predicate', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            NEXT: 'b'
          }
        },
        b: {
          type: 'final'
        }
      }
    });

    const service = yield* Effect.tap(createActor(machine), (a) => a.start);
    yield* service.send({ type: 'NEXT' });

    // the port fails with its `WaitForTerminatedError` (scenario P9), so the snapshot prints
    // that class name where upstream prints `Error` (ledger row; SD-26)
    expect(
      yield* Effect.flip(waitFor(service, (state) => state.matches('a')))
    ).toMatchInlineSnapshot(
      `[WaitForTerminatedError: Actor terminated without satisfying predicate]`
    );
  }));

  // upstream: test/waitFor.test.ts > waitFor > should not subscribe to the actor when it receives an aborted signal
  it.effect('should not subscribe to the actor when it receives an aborted signal', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            NEXT: 'b'
          }
        },
        b: {
          type: 'final'
        }
      }
    });

    const service = yield* Effect.tap(createActor(machine), (a) => a.start);
    yield* service.send({ type: 'NEXT' });

    const controller = new AbortController();
    const { signal } = controller;
    controller.abort(new Error('Aborted!'));
    const spy = vi.spyOn(service, 'subscribe');
    const changesSpy = vi.spyOn(service, 'changes', 'get');
    yield* waitFor(service, (state) => state.matches('b'), { signal }).pipe(
      Effect.andThen(Effect.fail(new Error('Should not be reached'))),
      Effect.catch(() =>
        Effect.sync(() => {
          expect(spy).not.toHaveBeenCalled();
          expect(changesSpy).not.toHaveBeenCalled();
        })
      )
    );
  }));

  // upstream: test/waitFor.test.ts > waitFor > should not listen for the "abort" event when it receives an aborted signal
  it.effect('should not listen for the "abort" event when it receives an aborted signal', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            NEXT: 'b'
          }
        },
        b: {
          type: 'final'
        }
      }
    });

    const service = yield* Effect.tap(createActor(machine), (a) => a.start);
    yield* service.send({ type: 'NEXT' });

    const controller = new AbortController();
    const { signal } = controller;
    controller.abort(new Error('Aborted!'));

    const spy = vi.fn();
    signal.addEventListener = spy;

    yield* waitFor(service, (state) => state.matches('b'), { signal }).pipe(
      Effect.andThen(Effect.fail(new Error('Should not be reached'))),
      Effect.catch(() =>
        Effect.sync(() => {
          expect(spy).not.toHaveBeenCalled();
        })
      )
    );
  }));

  // upstream: test/waitFor.test.ts > waitFor > should not listen for the "abort" event for actor in its final state that matches the predicate
  it.effect('should not listen for the "abort" event for actor in its final state that matches the predicate', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            NEXT: 'b'
          }
        },
        b: {
          type: 'final'
        }
      }
    });

    const service = yield* Effect.tap(createActor(machine), (a) => a.start);
    yield* service.send({ type: 'NEXT' });

    const controller = new AbortController();
    const { signal } = controller;

    const spy = vi.fn();
    signal.addEventListener = spy;

    yield* waitFor(service, (state) => state.matches('b'), { signal });
    expect(spy).not.toHaveBeenCalled();
  }));

  // upstream: test/waitFor.test.ts > waitFor > should immediately reject when it receives an aborted signal
  it.effect('should immediately reject when it receives an aborted signal', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            NEXT: 'b'
          }
        },
        b: {
          type: 'final'
        }
      }
    });

    const service = yield* Effect.tap(createActor(machine), (a) => a.start);
    yield* service.send({ type: 'NEXT' });

    const controller = new AbortController();
    const { signal } = controller;
    controller.abort(new Error('Aborted!'));

    expect(
      yield* Effect.flip(waitFor(service, (state) => state.matches('b'), { signal }))
    ).toMatchInlineSnapshot(`[Error: Aborted!]`);
  }));

  // upstream: test/waitFor.test.ts > waitFor > should reject when the signal is aborted while waiting
  it.effect('should reject when the signal is aborted while waiting', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: { NEXT: 'b' }
        },
        b: {}
      }
    });

    const service = yield* Effect.tap(createActor(machine), (a) => a.start);
    const controller = new AbortController();
    const { signal } = controller;
    yield* Effect.forkScoped(
      Effect.andThen(
        Effect.sleep("10 millis"),
        Effect.sync(() => controller.abort(new Error('Aborted!')))
      ),
      { startImmediately: true }
    );

    expect(
      yield* Effect.flip(waitFor(service, (state) => state.matches('b'), { signal })).pipe(
        Effect.raceFirst(Effect.forever(TestClock.adjust("10 millis")))
      )
    ).toMatchInlineSnapshot(`[Error: Aborted!]`);
  }));

  // upstream: test/waitFor.test.ts > waitFor > should stop listening for the "abort" event upon successful completion
  it.effect('should stop listening for the "abort" event upon successful completion', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            NEXT: 'b'
          }
        },
        b: {
          type: 'final'
        }
      }
    });

    const service = yield* Effect.tap(createActor(machine), (a) => a.start);
    yield* Effect.forkScoped(
      Effect.andThen(Effect.sleep("10 millis"), service.send({ type: 'NEXT' })),
      { startImmediately: true }
    );

    const controller = new AbortController();
    const { signal } = controller;
    const spy = vi.fn();
    signal.removeEventListener = spy;

    yield* waitFor(service, (state) => state.matches('b'), { signal }).pipe(
      Effect.raceFirst(Effect.forever(TestClock.adjust("10 millis")))
    );

    expect(spy).toHaveBeenCalledTimes(1);
  }));

  // upstream: test/waitFor.test.ts > waitFor > should stop listening for the "abort" event upon failure
  it.effect('should stop listening for the "abort" event upon failure', () => Effect.gen(function* () {
    // upstream's test takes a context parameter (`ctx`) that it never reads
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: { NEXT: 'b' }
        },
        b: {
          type: 'final'
        }
      }
    });

    const service = yield* Effect.tap(createActor(machine), (a) => a.start);

    yield* Effect.forkScoped(
      Effect.andThen(Effect.sleep("10 millis"), service.send({ type: 'NEXT' })),
      { startImmediately: true }
    );

    const controller = new AbortController();
    const { signal } = controller;
    const spy = vi.fn();
    signal.removeEventListener = spy;

    yield* waitFor(service, (state) => state.matches('never'), { signal }).pipe(
      Effect.raceFirst(Effect.forever(TestClock.adjust("10 millis"))),
      Effect.andThen(Effect.fail(new Error('Should not be reached'))),
      Effect.catch(() =>
        Effect.sync(() => {
          expect(spy).toHaveBeenCalledTimes(1);
        })
      )
    );
  }));
});
