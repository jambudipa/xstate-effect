import { describe, expect, it } from "@effect/vitest"
import { Deferred, Effect } from "effect"
import { assign, createActor, createMachine } from "../../src/index.js";

interface CounterContext {
  count: number;
  foo: string;
  maybe?: string;
}

const createCounterMachine = (context: Partial<CounterContext> = {}) =>
  createMachine({
    types: {} as { context: CounterContext },
    initial: 'counting',
    context: { count: 0, foo: 'bar', ...context },
    states: {
      counting: {
        on: {
          INC: [
            {
              target: 'counting',
              actions: assign(({ context }) => ({
                count: context.count + 1
              }))
            }
          ],
          DEC: [
            {
              target: 'counting',
              actions: [
                assign({
                  count: ({ context }) => context.count - 1
                })
              ]
            }
          ],
          WIN_PROP: [
            {
              target: 'counting',
              actions: [
                assign({
                  count: () => 100,
                  foo: () => 'win'
                })
              ]
            }
          ],
          WIN_STATIC: [
            {
              target: 'counting',
              actions: [
                assign({
                  count: 100,
                  foo: 'win'
                })
              ]
            }
          ],
          WIN_MIX: [
            {
              target: 'counting',
              actions: [
                assign({
                  count: () => 100,
                  foo: 'win'
                })
              ]
            }
          ],
          WIN: [
            {
              target: 'counting',
              actions: [
                assign(() => ({
                  count: 100,
                  foo: 'win'
                }))
              ]
            }
          ],
          SET_MAYBE: [
            {
              actions: [
                assign({
                  maybe: 'defined'
                })
              ]
            }
          ]
        }
      }
    }
  });

describe('assign', () => {
  // upstream: test/assign.test.ts > assign > applies the assignment to the external state (property assignment)
  it.effect('applies the assignment to the external state (property assignment)', () => Effect.gen(function* () {
    const counterMachine = createCounterMachine();

    const actorRef = (yield* Effect.tap(createActor(counterMachine), (a) => a.start));
    (yield* actorRef.send({
      type: 'DEC'
    }));
    const oneState = (yield* actorRef.getSnapshot);

    expect(oneState.value).toEqual('counting');
    expect(oneState.context).toEqual({ count: -1, foo: 'bar' });

    (yield* actorRef.send({ type: 'DEC' }));
    const twoState = (yield* actorRef.getSnapshot);

    expect(twoState.value).toEqual('counting');
    expect(twoState.context).toEqual({ count: -2, foo: 'bar' });
  }));

  // upstream: test/assign.test.ts > assign > applies the assignment to the external state
  it.effect('applies the assignment to the external state', () => Effect.gen(function* () {
    const counterMachine = createCounterMachine();

    const actorRef = (yield* Effect.tap(createActor(counterMachine), (a) => a.start));
    (yield* actorRef.send({
      type: 'INC'
    }));
    const oneState = (yield* actorRef.getSnapshot);

    expect(oneState.value).toEqual('counting');
    expect(oneState.context).toEqual({ count: 1, foo: 'bar' });

    (yield* actorRef.send({ type: 'INC' }));
    const twoState = (yield* actorRef.getSnapshot);

    expect(twoState.value).toEqual('counting');
    expect(twoState.context).toEqual({ count: 2, foo: 'bar' });
  }));

  // upstream: test/assign.test.ts > assign > applies the assignment to multiple properties (property assignment)
  it.effect('applies the assignment to multiple properties (property assignment)', () => Effect.gen(function* () {
    const counterMachine = createCounterMachine();
    const actorRef = (yield* Effect.tap(createActor(counterMachine), (a) => a.start));
    (yield* actorRef.send({
      type: 'WIN_PROP'
    }));

    expect((yield* actorRef.getSnapshot).context).toEqual({ count: 100, foo: 'win' });
  }));

  // upstream: test/assign.test.ts > assign > applies the assignment to multiple properties (static)
  it.effect('applies the assignment to multiple properties (static)', () => Effect.gen(function* () {
    const counterMachine = createCounterMachine();
    const actorRef = (yield* Effect.tap(createActor(counterMachine), (a) => a.start));
    (yield* actorRef.send({
      type: 'WIN_STATIC'
    }));

    expect((yield* actorRef.getSnapshot).context).toEqual({ count: 100, foo: 'win' });
  }));

  // upstream: test/assign.test.ts > assign > applies the assignment to multiple properties (static + prop assignment)
  it.effect('applies the assignment to multiple properties (static + prop assignment)', () => Effect.gen(function* () {
    const counterMachine = createCounterMachine();
    const actorRef = (yield* Effect.tap(createActor(counterMachine), (a) => a.start));
    (yield* actorRef.send({
      type: 'WIN_MIX'
    }));

    expect((yield* actorRef.getSnapshot).context).toEqual({ count: 100, foo: 'win' });
  }));

  // upstream: test/assign.test.ts > assign > applies the assignment to multiple properties
  it.effect('applies the assignment to multiple properties', () => Effect.gen(function* () {
    const counterMachine = createCounterMachine();
    const actorRef = (yield* Effect.tap(createActor(counterMachine), (a) => a.start));
    (yield* actorRef.send({
      type: 'WIN'
    }));

    expect((yield* actorRef.getSnapshot).context).toEqual({ count: 100, foo: 'win' });
  }));

  // upstream: test/assign.test.ts > assign > applies the assignment to the explicit external state (property assignment)
  it.effect('applies the assignment to the explicit external state (property assignment)', () => Effect.gen(function* () {
    const machine = createCounterMachine({ count: 50, foo: 'bar' });
    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'DEC' }));
    const oneState = (yield* actorRef.getSnapshot);

    expect(oneState.value).toEqual('counting');
    expect(oneState.context).toEqual({ count: 49, foo: 'bar' });

    (yield* actorRef.send({ type: 'DEC' }));
    const twoState = (yield* actorRef.getSnapshot);

    expect(twoState.value).toEqual('counting');
    expect(twoState.context).toEqual({ count: 48, foo: 'bar' });

    const machine2 = createCounterMachine({ count: 100, foo: 'bar' });

    const actorRef2 = (yield* Effect.tap(createActor(machine2), (a) => a.start));
    (yield* actorRef2.send({ type: 'DEC' }));
    const threeState = (yield* actorRef2.getSnapshot);

    expect(threeState.value).toEqual('counting');
    expect(threeState.context).toEqual({ count: 99, foo: 'bar' });
  }));

  // upstream: test/assign.test.ts > assign > applies the assignment to the explicit external state
  it.effect('applies the assignment to the explicit external state', () => Effect.gen(function* () {
    const machine = createCounterMachine({ count: 50, foo: 'bar' });
    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'INC' }));
    const oneState = (yield* actorRef.getSnapshot);

    expect(oneState.value).toEqual('counting');
    expect(oneState.context).toEqual({ count: 51, foo: 'bar' });

    (yield* actorRef.send({ type: 'INC' }));
    const twoState = (yield* actorRef.getSnapshot);

    expect(twoState.value).toEqual('counting');
    expect(twoState.context).toEqual({ count: 52, foo: 'bar' });

    const machine2 = createCounterMachine({ count: 102, foo: 'bar' });

    const actorRef2 = (yield* Effect.tap(createActor(machine2), (a) => a.start));
    (yield* actorRef2.send({ type: 'INC' }));
    const threeState = (yield* actorRef2.getSnapshot);

    expect(threeState.value).toEqual('counting');
    expect(threeState.context).toEqual({ count: 103, foo: 'bar' });
  }));

  // upstream: test/assign.test.ts > assign > should maintain state after unhandled event
  it.effect('should maintain state after unhandled event', () => Effect.gen(function* () {
    const counterMachine = createCounterMachine();
    const actorRef = (yield* Effect.tap(createActor(counterMachine), (a) => a.start));

    (yield* actorRef.send({
      type: 'FAKE_EVENT'
    }));
    const nextState = (yield* actorRef.getSnapshot);

    expect(nextState.context).toBeDefined();
    expect(nextState.context).toEqual({ count: 0, foo: 'bar' });
  }));

  // upstream: test/assign.test.ts > assign > sets undefined properties
  it.effect('sets undefined properties', () => Effect.gen(function* () {
    const counterMachine = createCounterMachine();
    const actorRef = (yield* Effect.tap(createActor(counterMachine), (a) => a.start));

    (yield* actorRef.send({
      type: 'SET_MAYBE'
    }));

    const nextState = (yield* actorRef.getSnapshot);

    expect(nextState.context.maybe).toBeDefined();
    expect(nextState.context).toEqual({
      count: 0,
      foo: 'bar',
      maybe: 'defined'
    });
  }));

  // upstream: test/assign.test.ts > assign > can assign from event
  it.effect('can assign from event', () => Effect.gen(function* () {
    const machine = createMachine({
      types: {} as {
        context: { count: number };
        events: { type: 'INC'; value: number };
      },
      initial: 'active',
      context: {
        count: 0
      },
      states: {
        active: {
          on: {
            INC: {
              actions: assign({
                count: ({ event }) => event.value
              })
            }
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'INC', value: 30 }));

    expect((yield* actorRef.getSnapshot).context.count).toEqual(30);
  }));
});

describe('assign meta', () => {
  // upstream: test/assign.test.ts > assign meta > should provide the parametrized action to the assigner
  it.effect('should provide the parametrized action to the assigner', () => Effect.gen(function* () {
    const machine = createMachine(
      {
        types: {} as {
          actions: { type: 'inc'; params: { by: number } };
        },
        context: { count: 1 },
        entry: {
          type: 'inc',
          params: { by: 10 }
        }
      },
      {
        actions: {
          inc: assign(({ context }, params) => ({
            count: context.count + params.by
          }))
        }
      }
    );

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect((yield* actor.getSnapshot).context.count).toEqual(11);
  }));

  // upstream: test/assign.test.ts > assign meta > should provide the action parameters to the partial assigner
  it.effect('should provide the action parameters to the partial assigner', () => Effect.gen(function* () {
    const machine = createMachine(
      {
        types: {} as {
          actions: { type: 'inc'; params: { by: number } };
        },
        context: { count: 1 },
        entry: {
          type: 'inc',
          params: { by: 10 }
        }
      },
      {
        actions: {
          inc: assign({
            count: ({ context }, params) => context.count + params.by
          })
        }
      }
    );

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect((yield* actor.getSnapshot).context.count).toEqual(11);
  }));

  // upstream: test/assign.test.ts > assign meta > a parameterized action that resolves to assign() should be provided the params
  it.effect('a parameterized action that resolves to assign() should be provided the params', () => Effect.gen(function* () {
    // upstream returns a `Promise.withResolvers` promise that the assigner resolves; a
    // Deferred stands in for it, and `resolve` completes it from the plain assigner
    const promise = yield* Deferred.make<void>();
    const resolve = () => Deferred.doneUnsafe(promise, Effect.void);
    const machine = createMachine(
      {
        on: {
          EVENT: {
            actions: {
              type: 'inc',
              params: { value: 5 }
            }
          }
        }
      },
      {
        actions: {
          inc: assign(({ context }, params) => {
            expect(params).toEqual({ value: 5 });
            resolve();
            return context;
          })
        }
      }
    );

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* service.send({ type: 'EVENT' }));

    yield* Deferred.await(promise);
  }));
});
