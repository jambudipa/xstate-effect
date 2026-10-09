import { describe, expect, it } from "@effect/vitest"
import { Effect, Fiber, Stream } from "effect"
import { createActor, createMachine, assertEvent } from "../../src/index.js";

// Upstream observes the actor error with an observer-object `subscribe({ error })` and awaits a
// promise that the `error` callback resolves. The observer object is not ported (D6): the
// `changes` stream fails with the actor's error (SD-4). `actorError` forks, before the next step
// runs, a fiber that drains the stream; joining the fiber returns the error the stream failed
// with (a stream that ends without an error fails the join, where upstream's promise never
// settles). That consumer is the actor's error consumer, so the actor reports nothing through
// its logger (SD-21).
const actorError = <E>(actor: { readonly changes: Stream.Stream<unknown, E> }) =>
  actor.changes.pipe(
    Stream.runDrain,
    Effect.flip,
    Effect.forkScoped({ startImmediately: true })
  );

describe('assertion helpers', () => {
  // upstream: test/assert.test.ts > assertion helpers > assertEvent asserts the correct event type
  it.effect('assertEvent asserts the correct event type', () => Effect.gen(function* () {
    const machine = createMachine(
      {
        types: {
          events: {} as
            | { type: 'greet'; message: string }
            | { type: 'count'; value: number }
        },
        on: {
          greet: { actions: 'greet' },
          count: { actions: 'greet' }
        }
      },
      {
        actions: {
          // SD-3 (amended 2026-10-08): `assertEvent` is an Effect that gives the narrowed
          // event, so the action returns an Effect
          greet: ({ event }) => Effect.gen(function* () {
            // @ts-expect-error
            event.message;

            const greeted = yield* assertEvent(event, 'greet');
            greeted.message satisfies string;

            // @ts-expect-error
            greeted.count;
          })
        }
      }
    );

    const actor = yield* createActor(machine);

    const errors = yield* actorError(actor);

    yield* actor.start;

    yield* actor.send({ type: 'count', value: 42 });

    // SD-3 (amended 2026-10-08): the failure of `assertEvent`'s Effect inside the action sets
    // status `error` and fails the `changes` stream with the original error (SD-4)
    const err = yield* Fiber.join(errors);
    expect(err).toMatchInlineSnapshot(
      `[Error: Expected event {"type":"count","value":42} to have type matching "greet"]`
    );
  }));

  // upstream: test/assert.test.ts > assertion helpers > assertEvent asserts multiple event types
  it.effect('assertEvent asserts multiple event types', () => Effect.gen(function* () {
    const machine = createMachine(
      {
        types: {
          events: {} as
            | { type: 'greet'; message: string }
            | { type: 'notify'; message: string; level: 'info' | 'error' }
            | { type: 'count'; value: number }
        },
        on: {
          greet: { actions: 'greet' },
          count: { actions: 'greet' }
        }
      },
      {
        actions: {
          // SD-3 (amended 2026-10-08): `assertEvent` is an Effect that gives the narrowed
          // event, so the action returns an Effect
          greet: ({ event }) => Effect.gen(function* () {
            // @ts-expect-error
            event.message;

            const greeting = yield* assertEvent(event, ['greet', 'notify']);
            greeting.message satisfies string;

            // @ts-expect-error
            greeting.level;

            const notification = yield* assertEvent(greeting, ['notify']);
            notification.level satisfies 'info' | 'error';

            // @ts-expect-error
            notification.count;
          })
        }
      }
    );

    const actor = yield* createActor(machine);

    const errors = yield* actorError(actor);

    yield* actor.start;

    yield* actor.send({ type: 'count', value: 42 });

    // SD-3 (amended 2026-10-08): the failure of `assertEvent`'s Effect inside the action sets
    // status `error` and fails the `changes` stream with the original error (SD-4)
    const err = yield* Fiber.join(errors);
    expect(err).toMatchInlineSnapshot(
      `[Error: Expected event {"type":"count","value":42} to have one of types matching "greet", "notify"]`
    );
  }));
});
