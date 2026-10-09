import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import {
  ActorScope,
  createMachine,
  getInitialSnapshot,
  getMicrosteps,
  getInitialMicrosteps
} from "../../src/index.js";
import { raise } from "../../src/index.js";
import { createInertActorScope } from "../../src/testing/getNextSnapshot.js";

// Upstream passes an inert actor scope as an argument to `machine.getInitialSnapshot` and
// `machine.microstep`. The port's logic reads its actor scope from the Effect context
// (`ActorScope`, SPEC context.md, API patterns), so the inert scope is provided with
// `Effect.provideService`, and the port's `createInertActorScope` takes the snapshot that the
// scope's `self` reports. `getInitialSnapshot(machine)` is upstream's
// `machine.getInitialSnapshot(createInertActorScope(machine))`. `machine.microstep`,
// `getMicrosteps`, `getInitialMicrosteps` and `getInitialSnapshot` return Effects (SD-13);
// `machine.resolveState` stays synchronous.

describe('machine.microstep()', () => {
  // upstream: test/microstep.test.ts > machine.microstep() > should return an array of states from all microsteps
  it.effect('should return an array of states from all microsteps', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'start',
      states: {
        start: {
          on: {
            GO: 'a'
          }
        },
        a: {
          entry: raise({ type: 'NEXT' }),
          on: {
            NEXT: 'b'
          }
        },
        b: {
          always: 'c'
        },
        c: {
          entry: raise({ type: 'NEXT' }),
          on: {
            NEXT: 'd'
          }
        },
        d: {}
      }
    });

    const initialSnapshot = yield* getInitialSnapshot(machine);
    const actorScope = createInertActorScope(initialSnapshot);
    const states = yield* machine
      .microstep(initialSnapshot, { type: 'GO' })
      .pipe(Effect.provideService(ActorScope, actorScope));

    expect(states.map((s) => s.value)).toEqual(['a', 'b', 'c', 'd']);
  }));

  // upstream: test/microstep.test.ts > machine.microstep() > should return the states from microstep (transient)
  it.effect('should return the states from microstep (transient)', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'first',
      states: {
        first: {
          on: {
            TRIGGER: 'second'
          }
        },
        second: {
          always: 'third'
        },
        third: {}
      }
    });

    const snapshot = (yield* machine.resolveState({ value: 'first' }));
    const actorScope = createInertActorScope(snapshot);
    const states = yield* machine
      .microstep(snapshot, { type: 'TRIGGER' })
      .pipe(Effect.provideService(ActorScope, actorScope));

    expect(states.map((s) => s.value)).toEqual(['second', 'third']);
  }));

  // upstream: test/microstep.test.ts > machine.microstep() > should return the states from microstep (raised event)
  it.effect('should return the states from microstep (raised event)', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'first',
      states: {
        first: {
          on: {
            TRIGGER: {
              target: 'second',
              actions: raise({ type: 'RAISED' })
            }
          }
        },
        second: {
          on: {
            RAISED: 'third'
          }
        },
        third: {}
      }
    });

    const snapshot = (yield* machine.resolveState({ value: 'first' }));
    const actorScope = createInertActorScope(snapshot);
    const states = yield* machine
      .microstep(snapshot, { type: 'TRIGGER' })
      .pipe(Effect.provideService(ActorScope, actorScope));

    expect(states.map((s) => s.value)).toEqual(['second', 'third']);
  }));

  // upstream: test/microstep.test.ts > machine.microstep() > should return a single-item array for normal transitions
  it.effect('should return a single-item array for normal transitions', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'first',
      states: {
        first: {
          on: {
            TRIGGER: 'second'
          }
        },
        second: {}
      }
    });

    const initialSnapshot = yield* getInitialSnapshot(machine);
    const actorScope = createInertActorScope(initialSnapshot);
    const states = yield* machine
      .microstep(initialSnapshot, { type: 'TRIGGER' })
      .pipe(Effect.provideService(ActorScope, actorScope));

    expect(states.map((s) => s.value)).toEqual(['second']);
  }));

  // upstream: test/microstep.test.ts > machine.microstep() > each state should preserve their internal queue
  it.effect('each state should preserve their internal queue', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'first',
      states: {
        first: {
          on: {
            TRIGGER: {
              target: 'second',
              actions: [raise({ type: 'FOO' }), raise({ type: 'BAR' })]
            }
          }
        },
        second: {
          on: {
            FOO: {
              target: 'third'
            }
          }
        },
        third: {
          on: {
            BAR: {
              target: 'fourth'
            }
          }
        },
        fourth: {
          always: 'fifth'
        },
        fifth: {}
      }
    });

    const initialSnapshot = yield* getInitialSnapshot(machine);
    const actorScope = createInertActorScope(initialSnapshot);
    const states = yield* machine
      .microstep(initialSnapshot, { type: 'TRIGGER' })
      .pipe(Effect.provideService(ActorScope, actorScope));

    expect(states.map((s) => s.value)).toEqual([
      'second',
      'third',
      'fourth',
      'fifth'
    ]);
  }));
});

describe('getMicrosteps', () => {
  // upstream: test/microstep.test.ts > getMicrosteps > should return microsteps with actions
  it.effect('should return microsteps with actions', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            GO: {
              target: 'b',
              actions: () => {}
            }
          }
        },
        b: {
          entry: () => {},
          always: {
            target: 'c',
            actions: () => {}
          }
        },
        c: {}
      }
    });

    // Upstream: `machine.getInitialSnapshot(createInertActorScope(machine))`
    const initialSnapshot = yield* getInitialSnapshot(machine);

    const microsteps = yield* getMicrosteps(machine, initialSnapshot, { type: 'GO' });

    expect(microsteps).toHaveLength(2);

    // First microstep: a -> b
    expect(microsteps[0]![0].value).toEqual('b');
    expect(microsteps[0]![1]).toHaveLength(2); // transition action + entry action

    // Second microstep: b -> c (always)
    expect(microsteps[1]![0].value).toEqual('c');
    expect(microsteps[1]![1]).toHaveLength(1); // always transition action
  }));

  // upstream: test/microstep.test.ts > getMicrosteps > should capture actions from raised events
  it.effect('should capture actions from raised events', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            GO: {
              target: 'b',
              actions: [() => {}, raise({ type: 'NEXT' })]
            }
          }
        },
        b: {
          on: {
            NEXT: {
              target: 'c',
              actions: () => {}
            }
          }
        },
        c: {}
      }
    });

    // Upstream: `machine.getInitialSnapshot(createInertActorScope(machine))`
    const initialSnapshot = yield* getInitialSnapshot(machine);

    const microsteps = yield* getMicrosteps(machine, initialSnapshot, { type: 'GO' });

    expect(microsteps).toHaveLength(2);
    expect(microsteps[0]![0].value).toEqual('b');
    expect(microsteps[1]![0].value).toEqual('c');
  }));
});

describe('getInitialMicrosteps', () => {
  // upstream: test/microstep.test.ts > getInitialMicrosteps > should return initial microsteps with entry actions
  it.effect('should return initial microsteps with entry actions', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          entry: () => {}
        }
      }
    });

    const microsteps = yield* getInitialMicrosteps(machine);

    expect(microsteps).toHaveLength(1);
    expect(microsteps[0]![0].value).toEqual('a');
    expect(microsteps[0]![1]).toHaveLength(1); // entry action
  }));

  // upstream: test/microstep.test.ts > getInitialMicrosteps > should capture actions from initial always transitions
  it.effect('should capture actions from initial always transitions', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          entry: () => {},
          always: {
            target: 'b',
            actions: () => {}
          }
        },
        b: {
          entry: () => {}
        }
      }
    });

    const microsteps = yield* getInitialMicrosteps(machine);

    expect(microsteps).toHaveLength(2);
    expect(microsteps[0]![0].value).toEqual('a');
    expect(microsteps[0]![1]).toHaveLength(1); // entry action for 'a'
    expect(microsteps[1]![0].value).toEqual('b');
    expect(microsteps[1]![1]).toHaveLength(2); // always action + entry action for 'b'
  }));

  // upstream: test/microstep.test.ts > getInitialMicrosteps > should work with nested initial states
  it.effect('should work with nested initial states', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'parent',
      states: {
        parent: {
          entry: () => {},
          initial: 'child',
          states: {
            child: {
              entry: () => {}
            }
          }
        }
      }
    });

    const microsteps = yield* getInitialMicrosteps(machine);

    expect(microsteps).toHaveLength(1);
    expect(microsteps[0]![0].value).toEqual({ parent: 'child' });
    expect(microsteps[0]![1]).toHaveLength(2); // parent entry + child entry
  }));

  // upstream: test/microstep.test.ts > getInitialMicrosteps > should pass input to context function
  it.effect('should pass input to context function', () => Effect.gen(function* () {
    const machine = createMachine({
      context: ({ input }: { input: { value: number } }) => ({
        count: input.value
      }),
      initial: 'a',
      states: {
        a: {}
      }
    });

    const microsteps = yield* getInitialMicrosteps(machine, { value: 42 });

    expect(microsteps[0]![0].context).toEqual({ count: 42 });
  }));
});
