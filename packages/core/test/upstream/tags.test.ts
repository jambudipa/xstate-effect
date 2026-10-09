import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { createMachine, createActor } from "../../src/index.js";

describe('tags', () => {
  // upstream: test/tags.test.ts > tags > supports tagging states
  it.effect('supports tagging states', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'green',
      states: {
        green: {
          tags: ['go'],
          on: {
            TIMER: 'yellow'
          }
        },
        yellow: {
          tags: ['go'],
          on: {
            TIMER: 'red'
          }
        },
        red: {
          tags: ['stop']
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    expect((yield* actorRef.getSnapshot).hasTag('go')).toBeTruthy();
    (yield* actorRef.send({ type: 'TIMER' }));
    expect((yield* actorRef.getSnapshot).hasTag('go')).toBeTruthy();
    (yield* actorRef.send({ type: 'TIMER' }));
    expect((yield* actorRef.getSnapshot).hasTag('go')).toBeFalsy();
  }));

  // upstream: test/tags.test.ts > tags > supports tags in compound states
  it.effect('supports tags in compound states', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'red',
      states: {
        green: {
          tags: ['go']
        },
        yellow: {},
        red: {
          tags: ['stop'],
          initial: 'walk',
          states: {
            walk: {
              tags: ['crosswalkLight']
            },
            wait: {
              tags: ['crosswalkLight']
            }
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    const initialState = (yield* actorRef.getSnapshot);

    expect(initialState.hasTag('go')).toBeFalsy();
    expect(initialState.hasTag('stop')).toBeTruthy();
    expect(initialState.hasTag('crosswalkLight')).toBeTruthy();
  }));

  // upstream: test/tags.test.ts > tags > supports tags in parallel states
  it.effect('supports tags in parallel states', () => Effect.gen(function* () {
    const machine = createMachine({
      type: 'parallel',
      states: {
        foo: {
          initial: 'active',
          states: {
            active: {
              tags: 'yes'
            },
            inactive: {
              tags: 'no'
            }
          }
        },
        bar: {
          initial: 'active',
          states: {
            active: {
              tags: 'yes',
              on: {
                DEACTIVATE: 'inactive'
              }
            },
            inactive: {
              tags: 'no'
            }
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    // The port's tags are the upstream Set's members, in its order (SD-22, amended 2026-10-08)
    expect(new Set((yield* actorRef.getSnapshot).tags)).toEqual(new Set(['yes']));
    (yield* actorRef.send({ type: 'DEACTIVATE' }));
    expect(new Set((yield* actorRef.getSnapshot).tags)).toEqual(new Set(['yes', 'no']));
  }));

  // upstream: test/tags.test.ts > tags > sets tags correctly after not selecting any transition
  it.effect('sets tags correctly after not selecting any transition', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          tags: 'myTag'
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({
      type: 'UNMATCHED'
    }));
    expect((yield* actorRef.getSnapshot).hasTag('myTag')).toBeTruthy();
  }));

  // upstream: test/tags.test.ts > tags > tags can be single (not array)
  it.effect('tags can be single (not array)', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'green',
      states: {
        green: {
          tags: 'go'
        }
      }
    });

    expect((yield* (yield* createActor(machine)).getSnapshot).hasTag('go')).toBeTruthy();
  }));

  // upstream: test/tags.test.ts > tags > stringifies to an array
  it.effect('stringifies to an array', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'green',
      states: {
        green: {
          tags: ['go', 'light']
        }
      }
    });

    const jsonState = (yield* (yield* createActor(machine)).getSnapshot).toJSON();

    expect((jsonState as any).tags).toEqual(['go', 'light']);
  }));
});
