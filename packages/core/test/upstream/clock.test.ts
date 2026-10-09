import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { createActor, createMachine, SimulatedClock } from "../../src/index.js";

describe('clock', () => {
  // upstream: test/clock.test.ts > clock > system clock should be default clock for actors (invoked from machine)
  it.effect('system clock should be default clock for actors (invoked from machine)', () => Effect.gen(function* () {
    const clock = new SimulatedClock();

    const machine = createMachine({
      invoke: {
        id: 'child',
        src: createMachine({
          initial: 'a',
          states: {
            a: {
              after: {
                10_000: 'b'
              }
            },
            b: {}
          }
        })
      }
    });

    const actor = (yield* Effect.tap(createActor(machine, {
      clock
    }), (a) => a.start));

    expect((yield* (yield* actor.getSnapshot).children.child!.getSnapshot).value).toEqual('a');

    // SimulatedClock is Effects (SD-28, DEV-27): the increment fires the child's due timer
    // and waits for its macrostep before it completes
    yield* clock.increment(10_000);

    expect((yield* (yield* actor.getSnapshot).children.child!.getSnapshot).value).toEqual('b');
  }));
});
