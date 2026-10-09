import { describe, expect, it, vi } from "@effect/vitest"
import { Effect, Exit, Scope } from "effect"
import { assign, SnapshotFrom } from "../../src/index.js";
import { createMachine } from "../../src/index.js";
import { createActor } from "../../src/index.js";

// `actor.select(selector, equalityFn?)` keeps the upstream `Readable` shape in Effect form (C17,
// D6). `select` itself only builds the selection. `get` is an Effect value that applies the
// selector to the live snapshot (as `actor.getSnapshot`). `subscribe(fn)` is scoped like
// `actor.subscribe` (SD-24): `fn` gets nothing at subscription time, then each selected value
// that differs, by `equalityFn` (default `Object.is`), from the last one it saw, starting from
// the value selected when it subscribed. The subscription ends when its scope closes (DEV-4).
//
// A `subscribe` callback runs in its own fiber, so a test yields its fiber, at most 100 times
// and never on wall-clock time, before it asserts how often a callback ran.
const yieldUntil = (done: () => boolean | Effect.Effect<boolean>) =>
  Effect.yieldNow.pipe(Effect.repeat({ until: done, times: 100 }));

// Before an assertion that something did NOT happen (or happened an exact number of times):
// give every enqueued delivery the chance to run, so that the assertion is not vacuous.
const settle = yieldUntil(() => false);

describe('select', () => {
  // upstream: test/select.test.ts > select > should get current value
  it.effect('should get current value', () => Effect.gen(function* () {
    const machine = createMachine({
      types: {} as { context: { data: number } },
      context: { data: 42 },
      initial: 'G',
      states: {
        G: {
          on: {
            INC: {
              actions: assign({ data: ({ context }) => context.data + 1 })
            }
          }
        }
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));
    const selection = service.select(({ context }) => context.data);

    expect(yield* selection.get).toBe(42);

    (yield* service.send({ type: 'INC' }));

    expect(yield* selection.get).toBe(43);
  }));

  // upstream: test/select.test.ts > select > should subscribe to changes
  it.effect('should subscribe to changes', () => Effect.gen(function* () {
    const machine = createMachine({
      types: {} as { context: { data: number } },
      context: { data: 42 },
      initial: 'G',
      states: {
        G: {
          on: {
            INC: {
              actions: assign({ data: ({ context }) => context.data + 1 })
            }
          }
        }
      }
    });

    const callback = vi.fn();
    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));
    const selection = service.select(({ context }) => context.data);
    yield* selection.subscribe((value) => Effect.sync(() => callback(value)));

    (yield* service.send({ type: 'INC' }));

    // the subscriber runs in its own fiber: let it take the value before the exact count
    yield* settle;
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(43);
  }));

  // upstream: test/select.test.ts > select > should not notify if selected value has not changed
  it.effect('should not notify if selected value has not changed', () => Effect.gen(function* () {
    const machine = createMachine({
      types: {} as { context: { data: number; other: string } },
      context: { data: 42, other: 'foo' },
      initial: 'G',
      states: {
        G: {
          on: {
            INC: {
              actions: assign({ data: ({ context }) => context.data + 1 })
            }
          }
        }
      }
    });

    const callback = vi.fn();
    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));
    const selection = service.select(({ context }) => context.other);
    yield* selection.subscribe((value) => Effect.sync(() => callback(value)));

    (yield* service.send({ type: 'INC' }));

    yield* settle;
    expect(callback).not.toHaveBeenCalled();
  }));

  // upstream: test/select.test.ts > select > should support custom equality function
  it.effect('should support custom equality function', () => Effect.gen(function* () {
    const machine = createMachine({
      types: {} as {
        context: { age: number; name: string };
        events:
          | {
              type: 'UPDATE_NAME';
              name: string;
            }
          | {
              type: 'UPDATE_AGE';
              age: number;
            };
      },
      context: { age: 42, name: 'John' },
      initial: 'G',
      states: {
        G: {
          on: {
            UPDATE_NAME: {
              actions: assign({ name: ({ event }) => event.name })
            },
            UPDATE_AGE: {
              actions: assign({ age: ({ event }) => event.age })
            }
          }
        }
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

    const callback = vi.fn();
    const selector = ({ context }: SnapshotFrom<typeof machine>) => ({
      name: context.name,
      age: context.age
    });
    const equalityFn = (a: { name: string }, b: { name: string }) =>
      a.name === b.name; // Only compare names

    yield* service
      .select(selector, equalityFn)
      .subscribe((value) => Effect.sync(() => callback(value)));

    (yield* service.send({ type: 'UPDATE_AGE', age: 66 }));
    yield* settle;
    expect(callback).not.toHaveBeenCalled();

    (yield* service.send({ type: 'UPDATE_NAME', name: 'Jane' }));
    yield* settle;
    expect(callback).toHaveBeenCalledTimes(1);
  }));

  // upstream: test/select.test.ts > select > should unsubscribe correctly
  it.effect('should unsubscribe correctly', () => Effect.gen(function* () {
    const machine = createMachine({
      types: {} as { context: { data: number } },
      context: { data: 42 },
      initial: 'G',
      states: {
        G: {
          on: {
            INC: {
              actions: assign({ data: ({ context }) => context.data + 1 })
            }
          }
        }
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

    const callback = vi.fn();
    const selection = service.select(({ context }) => context.data);
    // there is no `Subscription` object (D6, DEV-4): the subscription runs in its own
    // scope, and closing that scope stands for `subscription.unsubscribe()`
    const subscription = yield* Scope.make();
    yield* selection
      .subscribe((value) => Effect.sync(() => callback(value)))
      .pipe(Scope.provide(subscription));

    yield* Scope.close(subscription, Exit.void);
    (yield* service.send({ type: 'INC' }));

    yield* settle;
    expect(callback).not.toHaveBeenCalled();
  }));

  // upstream: test/select.test.ts > select > should handle updates with multiple subscribers
  it.effect('should handle updates with multiple subscribers', () => Effect.gen(function* () {
    interface PositionContext {
      position: {
        x: number;
        y: number;
      };
    }

    const machine = createMachine({
      types: {} as {
        context: {
          user: { age: number; name: string };
          position: {
            x: number;
            y: number;
          };
        };
        events:
          | {
              type: 'UPDATE_USER';
              user: { age: number; name: string };
            }
          | {
              type: 'UPDATE_POSITION';
              position: {
                x: number;
                y: number;
              };
            };
      },
      context: { position: { x: 0, y: 0 }, user: { name: 'John', age: 30 } },
      initial: 'G',
      states: {
        G: {
          on: {
            UPDATE_USER: {
              actions: assign({ user: ({ event }) => event.user })
            },
            UPDATE_POSITION: {
              actions: assign({ position: ({ event }) => event.position })
            }
          }
        }
      }
    });

    const store = (yield* Effect.tap(createActor(machine), (a) => a.start));

    // Mock DOM manipulation callback
    const renderCallback = vi.fn();
    yield* store
      .select(({ context }) => context.position)
      .subscribe((position) => Effect.sync(() => {
        renderCallback(position);
      }));

    // Mock logger callback for x position only
    const loggerCallback = vi.fn();
    yield* store
      .select(({ context }) => context.position.x)
      .subscribe((x) => Effect.sync(() => {
        loggerCallback(x);
      }));

    // Simulate position update
    (yield* store.send({
      type: 'UPDATE_POSITION',
      position: { x: 100, y: 200 }
    }));

    // the subscribers run in their own fibers: let them take the values before the counts
    yield* settle;

    // Verify render callback received full position update
    expect(renderCallback).toHaveBeenCalledTimes(1);
    expect(renderCallback).toHaveBeenCalledWith({ x: 100, y: 200 });

    // Verify logger callback received only x position
    expect(loggerCallback).toHaveBeenCalledTimes(1);
    expect(loggerCallback).toHaveBeenCalledWith(100);

    // Simulate another update
    (yield* store.send({
      type: 'UPDATE_POSITION',
      position: { x: 150, y: 300 }
    }));

    yield* settle;
    expect(renderCallback).toHaveBeenCalledTimes(2);
    expect(renderCallback).toHaveBeenLastCalledWith({ x: 150, y: 300 });
    expect(loggerCallback).toHaveBeenCalledTimes(2);
    expect(loggerCallback).toHaveBeenLastCalledWith(150);

    // Simulate changing only the y position
    (yield* store.send({
      type: 'UPDATE_POSITION',
      position: { x: 150, y: 400 }
    }));

    yield* settle;
    expect(renderCallback).toHaveBeenCalledTimes(3);
    expect(renderCallback).toHaveBeenLastCalledWith({ x: 150, y: 400 });

    // loggerCallback should not have been called
    expect(loggerCallback).toHaveBeenCalledTimes(2);

    // Simulate changing only the user
    (yield* store.send({
      type: 'UPDATE_USER',
      user: { name: 'Jane', age: 25 }
    }));

    yield* settle;
    // renderCallback should not have been called
    expect(renderCallback).toHaveBeenCalledTimes(3);

    // loggerCallback should not have been called
    expect(loggerCallback).toHaveBeenCalledTimes(2);
  }));
});
