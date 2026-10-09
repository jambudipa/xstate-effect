import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { createMachine, createActor, setup } from "../../src/index.js";

describe('state meta data', () => {
  const pedestrianStates = {
    initial: 'walk',
    states: {
      walk: {
        meta: { walkData: 'walk data' },
        on: {
          PED_COUNTDOWN: 'wait'
        },
        entry: 'enter_walk',
        exit: 'exit_walk'
      },
      wait: {
        meta: { waitData: 'wait data' },
        on: {
          PED_COUNTDOWN: 'stop'
        },
        entry: 'enter_wait',
        exit: 'exit_wait'
      },
      stop: {
        meta: { stopData: 'stop data' },
        entry: 'enter_stop',
        exit: 'exit_stop'
      }
    }
  };

  const lightMachine = createMachine({
    id: 'light',
    initial: 'green',
    states: {
      green: {
        meta: ['green', 'array', 'data'],
        on: {
          TIMER: 'yellow',
          POWER_OUTAGE: 'red',
          NOTHING: 'green'
        },
        entry: 'enter_green',
        exit: 'exit_green'
      },
      yellow: {
        meta: { yellowData: 'yellow data' },
        on: {
          TIMER: 'red',
          POWER_OUTAGE: 'red'
        },
        entry: 'enter_yellow',
        exit: 'exit_yellow'
      },
      red: {
        meta: {
          redData: {
            nested: {
              red: 'data',
              array: [1, 2, 3]
            }
          }
        },
        on: {
          TIMER: 'green',
          POWER_OUTAGE: 'red',
          NOTHING: 'red'
        },
        entry: 'enter_red',
        exit: 'exit_red',
        ...pedestrianStates
      }
    }
  });

  // upstream: test/meta.test.ts > state meta data > states should aggregate meta data
  it.effect('states should aggregate meta data', () => Effect.gen(function* () {
    const actorRef = (yield* Effect.tap(createActor(lightMachine), (a) => a.start));
    (yield* actorRef.send({ type: 'TIMER' }));
    const yellowState = (yield* actorRef.getSnapshot);

    expect(yellowState.getMeta()).toEqual({
      'light.yellow': {
        yellowData: 'yellow data'
      }
    });
    expect('light.green' in yellowState.getMeta()).toBeFalsy();
    expect('light' in yellowState.getMeta()).toBeFalsy();
  }));

  // upstream: test/meta.test.ts > state meta data > states should aggregate meta data (deep)
  it.effect('states should aggregate meta data (deep)', () => Effect.gen(function* () {
    const actorRef = (yield* Effect.tap(createActor(lightMachine), (a) => a.start));
    (yield* actorRef.send({ type: 'TIMER' }));
    (yield* actorRef.send({ type: 'TIMER' }));
    expect((yield* actorRef.getSnapshot).getMeta()).toEqual({
      'light.red': {
        redData: {
          nested: {
            array: [1, 2, 3],
            red: 'data'
          }
        }
      },
      'light.red.walk': {
        walkData: 'walk data'
      }
    });
  }));

  // https://github.com/statelyai/xstate/issues/1105
  // upstream: test/meta.test.ts > state meta data > services started from a persisted state should calculate meta data
  it.effect('services started from a persisted state should calculate meta data', () => Effect.gen(function* () {
    const machine = createMachine({
      id: 'test',
      initial: 'first',
      states: {
        first: {
          meta: {
            name: 'first state'
          }
        },
        second: {
          meta: {
            name: 'second state'
          }
        }
      }
    });

    const actor = (yield* createActor(machine, {
      snapshot: (yield* machine.resolveState({ value: 'second' }))
    }));
    (yield* actor.start);

    expect((yield* actor.getSnapshot).getMeta()).toEqual({
      'test.second': {
        name: 'second state'
      }
    });
  }));

  // upstream: test/meta.test.ts > state meta data > meta keys are strongly-typed
  it.effect('meta keys are strongly-typed', () => Effect.gen(function* () {
    const machine = setup({
      types: {
        meta: {} as { template: string }
      }
    }).createMachine({
      id: 'root',
      initial: 'a',
      states: {
        a: {},
        b: {},
        c: {
          initial: 'one',
          states: {
            one: {
              id: 'one'
            },
            two: {},
            three: {}
          }
        }
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    const snapshot = (yield* actor.getSnapshot);
    const meta = snapshot.getMeta();

    meta['root'];
    meta['root.c'];
    meta['one'] satisfies { template: string } | undefined;
    // @ts-expect-error
    meta['one'] satisfies { template: number } | undefined;
    // @ts-expect-error
    meta['one'] satisfies { template: string };

    // @ts-expect-error
    meta['(machine)'];

    // @ts-expect-error
    meta['c'];

    // @ts-expect-error
    meta['root.c.one'];
  }));

  // upstream: test/meta.test.ts > state meta data > TS should error with unexpected meta property
  it.effect('TS should error with unexpected meta property', () => Effect.gen(function* () {
    setup({
      types: {
        meta: {} as {
          layout: string;
        }
      }
    }).createMachine({
      initial: 'a',
      states: {
        a: {
          meta: {
            layout: 'a-layout'
          }
        },
        b: {
          meta: {
            // @ts-expect-error
            notLayout: 'uh oh'
          }
        }
      }
    });
  }));

  // upstream: test/meta.test.ts > state meta data > TS should error with wrong meta value type
  it.effect('TS should error with wrong meta value type', () => Effect.gen(function* () {
    setup({
      types: {
        meta: {} as {
          layout: string;
        }
      }
    }).createMachine({
      initial: 'a',
      states: {
        a: {
          meta: {
            layout: 'a-layout'
          }
        },
        d: {
          meta: {
            // @ts-expect-error
            layout: 42
          }
        }
      }
    });
  }));

  // upstream: test/meta.test.ts > state meta data > should allow states to omit meta
  it.effect('should allow states to omit meta', () => Effect.gen(function* () {
    setup({
      types: {
        meta: {} as {
          layout: string;
        }
      }
    }).createMachine({
      initial: 'a',
      states: {
        a: {
          meta: {
            layout: 'a-layout'
          }
        },
        c: {} // no meta
      }
    });
  }));

  // upstream: test/meta.test.ts > state meta data > TS should error with unexpected transition meta property
  it.effect('TS should error with unexpected transition meta property', () => Effect.gen(function* () {
    setup({
      types: {
        meta: {} as {
          layout: string;
        }
      }
    }).createMachine({
      on: {
        e1: {
          meta: {
            layout: 'event-layout'
          }
        },
        e2: {
          meta: {
            // @ts-expect-error
            notLayout: 'uh oh'
          }
        }
      }
    });
  }));

  // upstream: test/meta.test.ts > state meta data > TS should error with wrong transition meta value type
  it.effect('TS should error with wrong transition meta value type', () => Effect.gen(function* () {
    setup({
      types: {
        meta: {} as {
          layout: string;
        }
      }
    }).createMachine({
      on: {
        e1: {
          meta: {
            layout: 'event-layout'
          }
        },
        // @ts-expect-error (error is here for some reason...)
        e2: {
          meta: {
            layout: 42
          }
        }
      }
    });
  }));

  // upstream: test/meta.test.ts > state meta data > should support typing meta properties (no ts-expected errors)
  it.effect('should support typing meta properties (no ts-expected errors)', () => Effect.gen(function* () {
    const machine = setup({
      types: {
        meta: {} as {
          layout: string;
        }
      }
    }).createMachine({
      initial: 'a',
      states: {
        a: {
          meta: {
            layout: 'a-layout'
          }
        },
        b: {},
        c: {},
        d: {}
      },
      on: {
        e1: {
          meta: {
            layout: 'event-layout'
          }
        },
        e2: {},
        e3: {},
        e4: {}
      }
    });

    const actor = (yield* createActor(machine));

    (yield* actor.getSnapshot).getMeta()['(machine)'] satisfies
      | { layout: string }
      | undefined;

    (yield* actor.getSnapshot).getMeta()['(machine).a'];
  }));

  // upstream: test/meta.test.ts > state meta data > should strongly type the state IDs in snapshot.getMeta()
  it.effect('should strongly type the state IDs in snapshot.getMeta()', () => Effect.gen(function* () {
    const machine = setup({}).createMachine({
      id: 'root',
      initial: 'parentState',
      states: {
        parentState: {
          meta: {},
          initial: 'childState',
          states: {
            childState: {
              meta: {}
            },
            stateWithId: {
              id: 'state with id',
              meta: {}
            }
          }
        }
      }
    });

    const actor = (yield* createActor(machine));

    const metaValues = (yield* actor.getSnapshot).getMeta();

    metaValues.root;
    metaValues['root.parentState'];
    metaValues['root.parentState.childState'];
    metaValues['state with id'];

    // @ts-expect-error
    metaValues['root.parentState.stateWithId'];

    // @ts-expect-error
    metaValues['unknown state'];
  }));

  // upstream: test/meta.test.ts > state meta data > should strongly type the state IDs in snapshot.getMeta() (no root ID)
  it.effect('should strongly type the state IDs in snapshot.getMeta() (no root ID)', () => Effect.gen(function* () {
    const machine = setup({}).createMachine({
      // id is (machine)
      initial: 'parentState',
      states: {
        parentState: {
          meta: {},
          initial: 'childState',
          states: {
            childState: {
              meta: {}
            },
            stateWithId: {
              id: 'state with id',
              meta: {}
            }
          }
        }
      }
    });

    const actor = (yield* createActor(machine));

    const metaValues = (yield* actor.getSnapshot).getMeta();

    metaValues['(machine)'];
    metaValues['(machine).parentState'];
    metaValues['(machine).parentState.childState'];
    metaValues['state with id'];

    // @ts-expect-error
    metaValues['(machine).parentState.stateWithId'];

    // @ts-expect-error
    metaValues['unknown state'];
  }));
});

describe('transition meta data', () => {
  // upstream: test/meta.test.ts > transition meta data > infers distinct metadata types with createMachine
  it.effect('infers distinct metadata types with createMachine', () => Effect.gen(function* () {
    const machine = createMachine({
      types: {
        meta: {} as { label: string },
        transitionMeta: {} as { trackingId: number }
      },
      meta: { label: 'root' },
      on: {
        NEXT: { meta: { trackingId: 42 } }
      }
    });

    machine.root.meta satisfies { label: string } | undefined;
    // The port's transitions are the upstream Map's entries in its order (SD-22, amended 2026-10-08)
    machine.root.transitions.find(([descriptor]) => descriptor === 'NEXT')![1][0]!.meta satisfies
      | { trackingId: number }
      | undefined;
  }));

  // upstream: test/meta.test.ts > transition meta data > supports distinct state and transition meta types
  it.effect('supports distinct state and transition meta types', () => Effect.gen(function* () {
    const machine = setup({
      types: {
        meta: {} as { view: 'compact' | 'full' },
        transitionMeta: {} as { analyticsEvent: string }
      }
    }).createMachine({
      initial: 'idle',
      states: {
        idle: {
          meta: { view: 'compact' },
          on: {
            NEXT: {
              target: 'done',
              meta: { analyticsEvent: 'next' }
            }
          }
        },
        done: {}
      }
    });

    (yield* (yield* createActor(machine)).getSnapshot).getMeta()['(machine).idle'] satisfies
      | { view: 'compact' | 'full' }
      | undefined;

    // The port's transitions are the upstream Map's entries in its order (SD-22, amended 2026-10-08)
    machine.states.idle!.transitions.find(([descriptor]) => descriptor === 'NEXT')![1][0]!.meta satisfies
      | { analyticsEvent: string }
      | undefined;
    machine.definition.states.idle!.transitions[0]!.meta satisfies
      | { analyticsEvent: string }
      | undefined;

    // @ts-expect-error state metadata is not transition metadata
    machine.states.idle!.transitions.find(([descriptor]) => descriptor === 'NEXT')![1][0]!.meta satisfies
      | { view: 'compact' | 'full' }
      | undefined;
  }));

  // upstream: test/meta.test.ts > transition meta data > rejects state and transition metadata in the wrong positions
  it.effect('rejects state and transition metadata in the wrong positions', () => Effect.gen(function* () {
    setup({
      types: {
        meta: {} as { state: string },
        transitionMeta: {} as { transition: string }
      }
    }).createMachine({
      initial: 'idle',
      states: {
        idle: {
          // @ts-expect-error transition metadata is invalid on a state node
          meta: { transition: 'idle' },
          on: {
            NEXT: {
              // @ts-expect-error state metadata is invalid on a transition
              meta: { state: 'next' }
            }
          }
        }
      }
    });
  }));

  // upstream: test/meta.test.ts > transition meta data > keeps types.meta as the shared metadata type for compatibility
  it.effect('keeps types.meta as the shared metadata type for compatibility', () => Effect.gen(function* () {
    const machine = setup({
      types: {
        meta: {} as { legacy: string }
      }
    }).createMachine({
      meta: { legacy: 'state' },
      on: {
        NEXT: { meta: { legacy: 'transition' } }
      }
    });

    machine.root.meta satisfies { legacy: string } | undefined;
    // The port's transitions are the upstream Map's entries in its order (SD-22, amended 2026-10-08)
    machine.root.transitions.find(([descriptor]) => descriptor === 'NEXT')![1][0]!.meta satisfies
      | { legacy: string }
      | undefined;
  }));

  // upstream: test/meta.test.ts > transition meta data > preserves transition meta on all transition definitions
  it.effect('preserves transition meta on all transition definitions', () => Effect.gen(function* () {
    const machine = setup({
      types: {
        transitionMeta: {} as { source: string }
      },
      actors: {
        child: createMachine({})
      }
    }).createMachine({
      initial: {
        target: 'idle',
        meta: { source: 'initial' }
      },
      states: {
        idle: {
          always: { meta: { source: 'always' } },
          after: {
            100: { meta: { source: 'after' } }
          },
          invoke: {
            src: 'child',
            onDone: { meta: { source: 'invoke.done' } },
            onError: { meta: { source: 'invoke.error' } },
            onSnapshot: { meta: { source: 'invoke.snapshot' } }
          }
        }
      }
    });

    machine.root.initial.meta satisfies { source: string } | undefined;
    machine.states.idle!.always![0]!.meta satisfies
      | { source: string }
      | undefined;
    machine.states.idle!.after[0]!.meta satisfies { source: string } | undefined;
    // The port's transitions are the upstream Map's entries in its order (SD-22, amended 2026-10-08)
    machine.states.idle!.transitions.flatMap(([, transitions]) => transitions)[0]!.meta satisfies
      | { source: string }
      | undefined;

    type InvokeDefinition = NonNullable<typeof machine.definition.states.idle>['invoke'][0];
    type SingleTransition<T> = Exclude<
      NonNullable<T>,
      string | readonly unknown[]
    >;

    (({}) as SingleTransition<InvokeDefinition['onDone']>).meta satisfies
      | { source: string }
      | undefined;
    (({}) as SingleTransition<InvokeDefinition['onError']>).meta satisfies
      | { source: string }
      | undefined;
    (({}) as SingleTransition<InvokeDefinition['onSnapshot']>).meta satisfies
      | { source: string }
      | undefined;

    // @ts-expect-error invoke callback metadata is transition metadata
    (({}) as SingleTransition<InvokeDefinition['onDone']>).meta satisfies
      | { unknown: string }
      | undefined;

    expect(machine.root.initial.meta).toEqual({ source: 'initial' });
    expect(machine.definition.initial?.meta).toEqual({ source: 'initial' });
    expect(JSON.parse(JSON.stringify(machine)).initial.meta).toEqual({
      source: 'initial'
    });
    expect(machine.states.idle!.always![0]!.meta).toEqual({ source: 'always' });
    expect(machine.states.idle!.after[0]!.meta).toEqual({ source: 'after' });
    expect(
      machine.states.idle!.transitions
        .flatMap(([, transitions]) => transitions)
        .map((transition) => transition.meta)
    ).toEqual(
      expect.arrayContaining([
        { source: 'invoke.done' },
        { source: 'invoke.error' },
        { source: 'invoke.snapshot' }
      ])
    );
  }));

  // upstream: test/meta.test.ts > transition meta data > TS should error with unexpected transition meta property
  it.effect('TS should error with unexpected transition meta property', () => Effect.gen(function* () {
    setup({
      types: {
        meta: {} as {
          layout: string;
        }
      }
    }).createMachine({
      on: {
        e1: {
          meta: {
            layout: 'event-layout'
          }
        },
        e2: {
          meta: {
            // @ts-expect-error
            notLayout: 'uh oh'
          }
        }
      }
    });
  }));

  // upstream: test/meta.test.ts > transition meta data > TS should error with wrong transition meta value type
  it.effect('TS should error with wrong transition meta value type', () => Effect.gen(function* () {
    setup({
      types: {
        meta: {} as {
          layout: string;
        }
      }
    }).createMachine({
      on: {
        e1: {
          meta: {
            layout: 'event-layout'
          }
        },
        // @ts-expect-error (error is here for some reason...)
        e2: {
          meta: {
            layout: 42
          }
        }
      }
    });
  }));
});

describe('state description', () => {
  // upstream: test/meta.test.ts > state description > state node should have its description
  it.effect('state node should have its description', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'test',
      states: {
        test: {
          description: 'This is a test'
        }
      }
    });

    expect(machine.states.test!.description).toEqual('This is a test');
  }));
});

describe('transition description', () => {
  // upstream: test/meta.test.ts > transition description > state node should have its description
  it.effect('state node should have its description', () => Effect.gen(function* () {
    const machine = createMachine({
      on: {
        EVENT: {
          description: 'This is a test'
        }
      }
    });

    expect(machine.root.on['EVENT']![0]!.description).toEqual('This is a test');
  }));
});
