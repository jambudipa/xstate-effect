import { describe, expect, it } from "@effect/vitest"
import { Effect, Fiber, Option, Stream } from "effect"
import { TestClock } from "effect/testing"
import { createActor, createMachine, fromPromise, toEffect } from "../../src/index.js";

// Upstream awaits `toPromise(actor)`. The Effect form is `yield* toEffect(actor)` (SD-19,
// DEV-21): it succeeds with the snapshot output as stored, an `Option` (D8, DEV-7), and fails
// with the actor's raw error. So `output` and `error` are asserted with `Option.some(...)`, and
// the `satisfies` checks name the `Option` of upstream's output type.

describe('toPromise', () => {
  // upstream: test/toPromise.test.ts > toPromise > should be awaitable
  it.effect('should be awaitable', () => Effect.gen(function* () {
    const promiseActor = (yield* Effect.tap(createActor(
      fromPromise(() => Promise.resolve(42))
    ), (a) => a.start));

    const result = yield* toEffect(promiseActor);

    result satisfies Option.Option<number>;

    expect(result).toEqual(Option.some(42));
  }));

  // upstream: test/toPromise.test.ts > toPromise > should await actors
  it.effect('should await actors', () => Effect.gen(function* () {
    const machine = createMachine({
      types: {} as {
        output: { count: 42 };
      },
      initial: 'pending',
      states: {
        pending: {
          on: {
            RESOLVE: 'done'
          }
        },
        done: {
          type: 'final'
        }
      },
      output: { count: 42 }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    // upstream sends RESOLVE from a 1 ms host `setTimeout` while it awaits `toPromise`. Here
    // the timer is a fiber of the test's scope that sleeps 1 ms of Effect-clock time and then
    // sends; `toEffect` waits in its own fiber, and the test moves the clock 1 ms (no
    // wall-clock wait) and joins that fiber.
    yield* Effect.sleep("1 millis").pipe(
      Effect.andThen(actor.send({ type: 'RESOLVE' })),
      Effect.forkScoped({ startImmediately: true })
    );

    const waiting = yield* toEffect(actor).pipe(Effect.forkScoped({ startImmediately: true }));
    yield* TestClock.adjust("1 millis");
    const data = yield* Fiber.join(waiting);

    data satisfies Option.Option<{ count: number }>;

    expect(data).toEqual(Option.some({ count: 42 }));
  }));

  // upstream: test/toPromise.test.ts > toPromise > should await already done actors
  it.effect('should await already done actors', () => Effect.gen(function* () {
    const machine = createMachine({
      types: {} as {
        output: { count: 42 };
      },
      initial: 'done',
      states: {
        done: {
          type: 'final'
        }
      },
      output: { count: 42 }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    const data = yield* toEffect(actor);

    data satisfies Option.Option<{ count: number }>;

    expect(data).toEqual(Option.some({ count: 42 }));
  }));

  // NOT PORTED (skipped upstream, ledger row): toPromise > should handle errors

  // upstream: test/toPromise.test.ts > toPromise > should immediately resolve for a done actor
  it.effect('should immediately resolve for a done actor', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'done',
      states: {
        done: {
          type: 'final'
        }
      },
      output: {
        count: 100
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect((yield* actor.getSnapshot).status).toBe('done');
    expect((yield* actor.getSnapshot).output).toEqual(Option.some({ count: 100 }));

    const output = yield* toEffect(actor);

    expect(output).toEqual(Option.some({ count: 100 }));
  }));

  // upstream: test/toPromise.test.ts > toPromise > should immediately reject for an actor that had an error
  it.effect('should immediately reject for an actor that had an error', () => Effect.gen(function* () {
    const machine = createMachine({
      entry: () => {
        throw new Error('oh noes');
      }
    });

    const actor = (yield* createActor(machine));
    // the observer-object `subscribe({ error })` is not ported (D6, DEV-3): a fiber drains the
    // `changes` stream, which fails with the actor error (SD-4), and ignores that failure as
    // upstream's `error: (_) => {}` does. It is the actor's error consumer, so the actor
    // reports nothing through its logger (SD-21).
    yield* actor.changes.pipe(
      Stream.runDrain,
      Effect.catch((_) => Effect.void),
      Effect.forkScoped({ startImmediately: true })
    );
    (yield* actor.start);

    expect((yield* actor.getSnapshot).status).toBe('error');
    expect((yield* actor.getSnapshot).error).toEqual(Option.some(new Error('oh noes')));

    // `toEffect` fails with the raw actor error (SD-19, DEV-21)
    expect(yield* Effect.flip(toEffect(actor))).toEqual(new Error('oh noes'));
  }));
});
