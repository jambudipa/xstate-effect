import { describe, expect, it, vi } from "@effect/vitest"
import { Effect, Option } from "effect"
import { interval } from 'rxjs';
import {
  ActorRefFrom,
  createActor,
  createMachine,
  fromObservable,
  fromPromise,
  sendTo,
  spawnChild,
  toEffect
} from "../../src/index.js";

describe('spawnChild action', () => {
  // upstream: test/spawnChild.test.ts > spawnChild action > can spawn
  it.effect('can spawn', () => Effect.gen(function* () {
    const actor = (yield* createActor(
      createMachine({
        entry: spawnChild(
          fromPromise(() => Promise.resolve(42)),
          { id: 'child' }
        )
      })
    ));

    (yield* actor.start);

    expect((yield* actor.getSnapshot).children.child).toBeDefined();
  }));

  // upstream: test/spawnChild.test.ts > spawnChild action > can spawn from named actor
  it.effect('can spawn from named actor', () => Effect.gen(function* () {
    const fetchNum = fromPromise(({ input }: { input: number }) =>
      Promise.resolve(input * 2)
    );
    const actor = (yield* createActor(
      createMachine({
        types: {
          actors: {} as {
            src: 'fetchNum';
            logic: typeof fetchNum;
          }
        },
        entry: spawnChild('fetchNum', { id: 'child', input: 21 })
      }).provide({
        actors: { fetchNum }
      })
    ));

    (yield* actor.start);

    expect((yield* actor.getSnapshot).children.child).toBeDefined();
  }));

  // upstream: test/spawnChild.test.ts > spawnChild action > should accept `syncSnapshot` option
  it.effect('should accept `syncSnapshot` option', () => Effect.gen(function* () {
    const observableLogic = fromObservable(() => interval(10));
    const observableMachine = createMachine({
      id: 'observable',
      initial: 'idle',
      context: {
        observableRef: undefined! as ActorRefFrom<typeof observableLogic>
      },
      states: {
        idle: {
          entry: spawnChild(observableLogic, {
            id: 'int',
            syncSnapshot: true
          }),
          on: {
            'xstate.snapshot.int': {
              target: 'success',
              // `snapshot.context` of observable logic is an `Option` (SD-17, DEV-19)
              guard: ({ event }) => Option.contains(event.snapshot.context, 5)
            }
          }
        },
        success: {
          type: 'final'
        }
      }
    });

    const observableService = (yield* createActor(observableMachine));

    (yield* observableService.start);

    // upstream resolves on the observer's `complete`; toEffect waits for the actor to
    // finish (SD-19) and fails if it errors instead. The rxjs `interval(10)` source is
    // the user's observable on the host timer, not an actor timer, so the TestClock does
    // not drive it: the wait ends after the sixth emission, as upstream
    yield* toEffect(observableService);
  }));

  // upstream: test/spawnChild.test.ts > spawnChild action > should handle a dynamic id
  it.effect('should handle a dynamic id', () => Effect.gen(function* () {
    const spy = vi.fn();

    const child = createMachine({
      on: {
        FOO: {
          actions: spy
        }
      }
    });

    const machine = createMachine({
      context: {
        childId: 'myChild'
      },
      entry: [
        spawnChild(child, { id: ({ context }) => context.childId }),
        sendTo('myChild', {
          type: 'FOO'
        })
      ]
    });

    (yield* Effect.tap(createActor(machine), (a) => a.start));

    // upstream delivers FOO to the child before `start` returns; here a sendTo from inside
    // an actor enqueues without waiting (SD-23), so yield (bounded) until the child has
    // run its action, then make the upstream assertion
    yield* Effect.yieldNow.pipe(
      Effect.repeat({ until: () => spy.mock.calls.length > 0, times: 100 })
    );

    expect(spy).toHaveBeenCalledTimes(1);
  }));
});
