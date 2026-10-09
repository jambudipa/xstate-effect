import { describe, expect, it, vi } from "@effect/vitest"
import { Deferred, Effect, Exit, Option, Scope } from "effect"
import { of } from 'rxjs';
import { assign, createActor, spawnChild } from "../../src/index.js";
import { createMachine } from "../../src/index.js";
import {
  fromCallback,
  fromObservable,
  fromPromise,
  fromTransition
} from "../../src/index.js";

// Upstream runs an invoked or spawned child, and promise logic, inside `start`, or settles it
// within a few milliseconds of real time. Here each actor runs in its own fiber (D12), so a
// test yields its fiber, at most 100 times and never on wall-clock time, until the effect it
// needs has happened. The upstream assertion follows unchanged.
const yieldUntil = (done: () => boolean | Effect.Effect<boolean>) =>
  Effect.yieldNow.pipe(Effect.repeat({ until: done, times: 100 }));

describe('input', () => {
  // upstream: test/input.test.ts > input > should create a machine with input
  it.effect('should create a machine with input', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine({
      types: {} as {
        context: { count: number };
        input: { startCount: number };
      },
      context: ({ input }) => ({
        count: input.startCount
      }),
      entry: ({ context }) => {
        spy(context.count);
      }
    });

    (yield* Effect.tap(createActor(machine, { input: { startCount: 42 } }), (a) => a.start));

    expect(spy).toHaveBeenCalledWith(42);
  }));

  // upstream: test/input.test.ts > input > initial event should have input property
  it.effect('initial event should have input property', () => Effect.gen(function* () {
    // upstream returns a `Promise.withResolvers` promise that the entry action resolves; a
    // Deferred stands in for it, and `resolve` completes it from the entry action
    const promise = yield* Deferred.make<void>();
    const resolve = () => Deferred.doneUnsafe(promise, Effect.void);
    const machine = createMachine({
      entry: ({ event }) => {
        expect(event.input.greeting).toBe('hello');
        resolve();
      }
    });

    (yield* Effect.tap(createActor(machine, { input: { greeting: 'hello' } }), (a) => a.start));

    yield* Deferred.await(promise);
  }));

  // upstream: test/input.test.ts > input > should error if input is expected but not provided
  it.effect('should error if input is expected but not provided', () => Effect.gen(function* () {
    const machine = createMachine({
      types: {} as {
        input: { greeting: string };
        context: { message: string };
      },
      context: ({ input }) => {
        return { message: `Hello, ${input.greeting}` };
      }
    });

    // @ts-expect-error
    const snapshot = (yield* (yield* createActor(machine)).getSnapshot);

    expect(snapshot.status).toBe('error');
  }));

  // upstream: test/input.test.ts > input > should retain the machine snapshot interface when resolving input throws
  it.effect('should retain the machine snapshot interface when resolving input throws', () => Effect.gen(function* () {
    const machine = createMachine({
      types: {} as {
        input: { greeting: string };
        context: { message: string };
      },
      context: ({ input }) => ({
        message: `Hello, ${input.greeting}`
      }),
      initial: 'saving',
      states: {
        saving: {}
      }
    });

    // @ts-expect-error Missing input deliberately exercises initialization.
    const snapshot = (yield* (yield* createActor(machine)).getSnapshot);

    expect(snapshot.status).toBe('error');
    expect(snapshot.matches('saving')).toBe(true);
  }));

  // upstream: test/input.test.ts > input > should be a type error if input is not expected yet provided
  it.effect('should be a type error if input is not expected yet provided', () => Effect.gen(function* () {
    const machine = createMachine({
      context: { count: 42 }
    });

    // `createActor` and `start` are Effects, not synchronous throw sites (SD-3, DEV-8,
    // DEV-12): "does not throw" is an Exit that is a success
    const exit = yield* Effect.exit(
      // TODO: add ts-expect-errpr
      Effect.tap(createActor(machine), (a) => a.start)
    );
    expect(Exit.isSuccess(exit)).toBe(true);
  }));

  // upstream: test/input.test.ts > input > should provide input data to invoked machines
  it.effect('should provide input data to invoked machines', () => Effect.gen(function* () {
    // upstream returns a `Promise.withResolvers` promise that the child's entry action
    // resolves; a Deferred stands in for it, and `resolve` completes it from that action
    const promise = yield* Deferred.make<void>();
    const resolve = () => Deferred.doneUnsafe(promise, Effect.void);
    const invokedMachine = createMachine({
      types: {} as {
        input: { greeting: string };
        context: { greeting: string };
      },
      context: ({ input }) => input,
      entry: ({ context, event }) => {
        expect(context.greeting).toBe('hello');
        expect(event.input.greeting).toBe('hello');
        resolve();
      }
    });

    const machine = createMachine({
      invoke: {
        src: invokedMachine,
        input: { greeting: 'hello' }
      }
    });

    (yield* Effect.tap(createActor(machine), (a) => a.start));

    yield* Deferred.await(promise);
  }));

  // upstream: test/input.test.ts > input > should provide input data to spawned machines
  it.effect('should provide input data to spawned machines', () => Effect.gen(function* () {
    // upstream returns a `Promise.withResolvers` promise that the child's entry action
    // resolves; a Deferred stands in for it, and `resolve` completes it from that action
    const promise = yield* Deferred.make<void>();
    const resolve = () => Deferred.doneUnsafe(promise, Effect.void);
    const spawnedMachine = createMachine({
      types: {} as {
        input: { greeting: string };
        context: { greeting: string };
      },
      context({ input }) {
        return input;
      },
      entry: ({ context, event }) => {
        expect(context.greeting).toBe('hello');
        expect(event.input.greeting).toBe('hello');
        resolve();
      }
    });

    const machine = createMachine({
      entry: assign(({ spawn }) => {
        return {
          ref: spawn(spawnedMachine, { input: { greeting: 'hello' } })
        };
      })
    });

    (yield* Effect.tap(createActor(machine), (a) => a.start));

    yield* Deferred.await(promise);
  }));

  // upstream: test/input.test.ts > input > should create a promise with input
  it.effect('should create a promise with input', () => Effect.gen(function* () {
    const promiseLogic = fromPromise<{ count: number }, { count: number }>(
      ({ input }) => Promise.resolve(input)
    );

    const promiseActor = (yield* Effect.tap(createActor(promiseLogic, {
      input: { count: 42 }
    }), (a) => a.start));

    // upstream waits 5 ms of real time; here the test yields, bounded, until the actor has
    // taken the settled promise
    yield* yieldUntil(() =>
      Effect.map(promiseActor.getSnapshot, (snapshot) => snapshot.status !== 'active')
    );

    // `output` is an `Option` (D8, DEV-7)
    expect((yield* promiseActor.getSnapshot).output).toEqual(Option.some({ count: 42 }));
  }));

  // upstream: test/input.test.ts > input > should create a transition function actor with input
  it.effect('should create a transition function actor with input', () => Effect.gen(function* () {
    const transitionLogic = fromTransition(
      (state) => state,
      ({ input }) => input
    );

    const transitionActor = (yield* Effect.tap(createActor(transitionLogic, {
      input: { count: 42 }
    }), (a) => a.start));

    expect((yield* transitionActor.getSnapshot).context).toEqual({ count: 42 });
  }));

  // upstream: test/input.test.ts > input > should create an observable actor with input
  it.effect('should create an observable actor with input', () => Effect.gen(function* () {
    // upstream returns a `Promise.withResolvers` promise that the subscriber resolves; a
    // Deferred stands in for it, and `resolve` completes it from the subscriber
    const promise = yield* Deferred.make<void>();
    const resolve = () => Deferred.doneUnsafe(promise, Effect.void);
    const observableLogic = fromObservable<
      { count: number },
      { count: number }
    >(({ input }) => of(input));

    const observableActor = (yield* createActor(observableLogic, {
      input: { count: 42 }
    }));

    // there is no `Subscription` object (D6, DEV-4): the subscription runs in its own
    // scope, and closing that scope stands for `sub.unsubscribe()`. The subscriber cannot
    // close the scope it runs in, so the test closes it once the subscriber has resolved
    const sub = yield* Scope.make();
    yield* observableActor.subscribe((state) => Effect.sync(() => {
      // `snapshot.context` of observable logic is an `Option` (SD-17, DEV-19)
      if (!Option.exists(state.context, (context) => context.count === 42)) return;
      expect(state.context).toEqual(Option.some({ count: 42 }));
      resolve();
    })).pipe(Scope.provide(sub));

    (yield* observableActor.start);

    yield* Deferred.await(promise);
    yield* Scope.close(sub, Exit.void);
  }));

  // upstream: test/input.test.ts > input > should create a callback actor with input
  it.effect('should create a callback actor with input', () => Effect.gen(function* () {
    // upstream returns a `Promise.withResolvers` promise that the callback resolves; a
    // Deferred stands in for it, and `resolve` completes it from the callback
    const promise = yield* Deferred.make<void>();
    const resolve = () => Deferred.doneUnsafe(promise, Effect.void);
    const callbackLogic = fromCallback(({ input }) => {
      expect(input).toEqual({ count: 42 });
      resolve();
    });

    (yield* Effect.tap(createActor(callbackLogic, {
      input: { count: 42 }
    }), (a) => a.start));

    yield* Deferred.await(promise);
  }));

  // upstream: test/input.test.ts > input > should provide a static inline input to the referenced actor
  it.effect('should provide a static inline input to the referenced actor', () => Effect.gen(function* () {
    const spy = vi.fn();

    const child = createMachine({
      context: ({ input }: { input: number }) => {
        spy(input);
        return {};
      }
    });

    const machine = createMachine(
      {
        types: {} as {
          actors: { src: 'child'; logic: typeof child };
        },
        invoke: {
          src: 'child',
          input: 42
        }
      },
      {
        actors: {
          child
        }
      }
    );

    (yield* Effect.tap(createActor(machine), (a) => a.start));

    // upstream creates the invoked child inside `start`; here the child runs in its own
    // fiber (D12): yield, bounded, until the child has resolved its context
    yield* yieldUntil(() => spy.mock.calls.length > 0);

    expect(spy).toHaveBeenCalledWith(42);
  }));

  // upstream: test/input.test.ts > input > should provide a dynamic inline input to the referenced actor
  it.effect('should provide a dynamic inline input to the referenced actor', () => Effect.gen(function* () {
    const spy = vi.fn();

    const child = createMachine({
      context: ({ input }: { input: number }) => {
        spy(input);
        return {};
      }
    });

    const machine = createMachine(
      {
        types: {} as {
          actors: {
            src: 'child';
            logic: typeof child;
          };
          input: number;
          context: {
            count: number;
          };
        },
        context: ({ input }) => ({
          count: input
        }),
        invoke: {
          src: 'child',
          input: ({ context }) => {
            return context.count + 100;
          }
        }
      },
      {
        actors: {
          child
        }
      }
    );

    (yield* Effect.tap(createActor(machine, { input: 42 }), (a) => a.start));

    // upstream creates the invoked child inside `start`; here the child runs in its own
    // fiber (D12): yield, bounded, until the child has resolved its context
    yield* yieldUntil(() => spy.mock.calls.length > 0);

    expect(spy).toHaveBeenCalledWith(142);
  }));

  // upstream: test/input.test.ts > input > should call the input factory with self when invoking
  it.effect('should call the input factory with self when invoking', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine({
      invoke: {
        src: createMachine({}),
        input: ({ self }: any) => spy(self)
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(spy).toHaveBeenCalledWith(actor);
  }));

  // upstream: test/input.test.ts > input > should call the input factory with self when spawning
  it.effect('should call the input factory with self when spawning', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine(
      {
        entry: spawnChild('child', {
          input: ({ self }: any) => spy(self)
        })
      },
      {
        actors: {
          child: createMachine({})
        }
      }
    );

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(spy).toHaveBeenCalledWith(actor);
  }));
});
