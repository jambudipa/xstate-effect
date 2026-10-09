import { describe, expect, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { log } from "../../src/index.js";
import { raise } from "../../src/index.js";
import { stopChild } from "../../src/index.js";
import {
  PromiseActorLogic,
  createEmptyActor,
  fromCallback,
  fromPromise
} from "../../src/index.js";
import {
  ActorRefFrom,
  ActorRefFromLogic,
  AnyActorLogic,
  AnyStateMachine,
  AnyStateNode,
  AnyStateNodeDefinition,
  MachineContext,
  ProvidedActor,
  Spawner,
  StateMachine,
  UnknownActorRef,
  assign,
  createActor,
  createMachine,
  enqueueActions,
  getInitialSnapshot,
  not,
  sendTo,
  setup,
  spawnChild,
  stateIn,
  toEffect
} from "../../src/index.js";

function noop(_x: unknown) {
  return;
}

describe('Raise events', () => {
  // upstream: test/types.test.ts > Raise events > should accept a valid event type
  it.effect('should accept a valid event type', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        events: { type: 'FOO' } | { type: 'BAR' };
      },
      entry: raise({
        type: 'FOO'
      })
    });
  }));

  // upstream: test/types.test.ts > Raise events > should reject an invalid event type
  it.effect('should reject an invalid event type', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        events: { type: 'FOO' } | { type: 'BAR' };
      },
      entry: raise({
        // @ts-expect-error
        type: 'UNKNOWN'
      })
    });
  }));

  // upstream: test/types.test.ts > Raise events > should reject a string event type
  it.effect('should reject a string event type', () => Effect.gen(function* () {
    const event: { type: string } = { type: 'something' };

    createMachine({
      types: {
        events: {} as { type: 'FOO' } | { type: 'BAR' }
      },
      // @ts-expect-error
      entry: raise(event)
    });
  }));

  // upstream: test/types.test.ts > Raise events > should provide a narrowed down expression event type when used as a transition action
  it.effect('should provide a narrowed down expression event type when used as a transition action', () => Effect.gen(function* () {
    createMachine({
      types: {
        events: {} as { type: 'FOO' } | { type: 'BAR' }
      },
      on: {
        FOO: {
          actions: raise(({ event }) => {
            ((_arg: 'FOO') => {})(event.type);
            // @ts-expect-error
            ((_arg: 'BAR') => {})(event.type);

            return {
              type: 'BAR' as const
            };
          })
        }
      }
    });
  }));

  // upstream: test/types.test.ts > Raise events > should accept a valid event type returned from an expression
  it.effect('should accept a valid event type returned from an expression', () => Effect.gen(function* () {
    createMachine({
      types: {
        events: {} as { type: 'FOO' } | { type: 'BAR' }
      },
      entry: raise(() => ({
        type: 'BAR' as const
      }))
    });
  }));

  // upstream: test/types.test.ts > Raise events > should reject an invalid event type returned from an expression
  it.effect('should reject an invalid event type returned from an expression', () => Effect.gen(function* () {
    createMachine({
      types: {
        events: {} as { type: 'FOO' } | { type: 'BAR' }
      },
      // @ts-expect-error
      entry: raise(() => ({
        type: 'UNKNOWN'
      }))
    });
  }));

  // upstream: test/types.test.ts > Raise events > should reject a string event type returned from an expression
  it.effect('should reject a string event type returned from an expression', () => Effect.gen(function* () {
    const event: { type: string } = { type: 'something' };

    createMachine({
      types: {
        events: {} as { type: 'FOO' } | { type: 'BAR' }
      },
      // @ts-expect-error
      entry: raise(() => event)
    });
  }));
});

describe('log', () => {
  // upstream: test/types.test.ts > log > should narrow down the event type in the expression
  it.effect('should narrow down the event type in the expression', () => Effect.gen(function* () {
    createMachine({
      types: {
        events: {} as { type: 'FOO' } | { type: 'BAR' }
      },
      on: {
        FOO: {
          actions: log(({ event }) => {
            ((_arg: 'FOO') => {})(event.type);
            // @ts-expect-error
            ((_arg: 'BAR') => {})(event.type);
          })
        }
      }
    });
  }));
});

describe('stop', () => {
  // upstream: test/types.test.ts > stop > should narrow down the event type in the expression
  it.effect('should narrow down the event type in the expression', () => Effect.gen(function* () {
    createMachine({
      types: {
        events: {} as { type: 'FOO' } | { type: 'BAR' }
      },
      on: {
        FOO: {
          actions: stopChild(({ event }) => {
            ((_arg: 'FOO') => {})(event.type);
            // @ts-expect-error
            ((_arg: 'BAR') => {})(event.type);

            return 'fakeId';
          })
        }
      }
    });
  }));
});

describe('context', () => {
  // upstream: test/types.test.ts > context > defined context in createMachine() should be an object
  it.effect('defined context in createMachine() should be an object', () => Effect.gen(function* () {
    createMachine({
      // @ts-expect-error
      context: 'string'
    });
  }));

  // upstream: test/types.test.ts > context > context should be required if present in types
  it.effect('context should be required if present in types', () => Effect.gen(function* () {
    createMachine(
      // @ts-expect-error
      {
        types: {} as {
          context: { count: number };
        }
      }
    );

    createMachine({
      types: {} as {
        context: { count: number };
      },
      context: {
        count: 0
      }
    });

    createMachine({
      types: {} as {
        context: { count: number };
      },
      context: () => ({
        count: 0
      })
    });
  }));
});

describe('output', () => {
  // upstream: test/types.test.ts > output > output type should be represented in state
  it.effect('output type should be represented in state', () => Effect.gen(function* () {
    const machine = createMachine({
      types: {} as {
        output: number;
      }
    });

    // Upstream: `machine.getInitialSnapshot({} as any)`. The port's logic reads its actor scope
    // from the Effect context, so `getInitialSnapshot(machine)` supplies an inert one, as in the
    // microstep rewrite (SD-13)
    const state = (yield* getInitialSnapshot(machine));

    // `snapshot.output` is an Option (D8, DEV-7): upstream's `number | undefined` is
    // `Option<number>`
    ((_accept: Option.Option<number>) => {})(state.output);
    // @ts-expect-error
    ((_accept: number) => {})(state.output);
    // @ts-expect-error
    ((_accept: string) => {})(state.output);
  }));

  // upstream: test/types.test.ts > output > should accept valid static output
  it.effect('should accept valid static output', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        output: number;
      },
      output: 42
    });
  }));

  // upstream: test/types.test.ts > output > should reject invalid static output
  it.effect('should reject invalid static output', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        output: number;
      },
      // @ts-expect-error
      output: 'a string'
    });
  }));

  // upstream: test/types.test.ts > output > should accept valid dynamic output
  it.effect('should accept valid dynamic output', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        output: number;
      },
      output: () => 42
    });
  }));

  // upstream: test/types.test.ts > output > should reject invalid dynamic output
  it.effect('should reject invalid dynamic output', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        output: number;
      },
      // @ts-expect-error
      output: () => 'a string'
    });
  }));

  // upstream: test/types.test.ts > output > should provide the context type to the dynamic top-level output
  it.effect('should provide the context type to the dynamic top-level output', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        context: { password: string };
        output: {
          secret: string;
        };
      },
      context: { password: 'okoń' },
      output: ({ context }) => {
        ((_accept: string) => {})(context.password);
        // @ts-expect-error
        ((_accept: number) => {})(context.password);
        return {
          secret: 'the secret'
        };
      }
    });
  }));

  // upstream: test/types.test.ts > output > should provide the context type to the dynamic nested output
  it.effect('should provide the context type to the dynamic nested output', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        context: { password: string };
        output: {
          secret: string;
        };
      },
      context: { password: 'okoń' },
      initial: 'secret',
      states: {
        secret: {
          initial: 'reveal',
          states: {
            reveal: {
              type: 'final',
              output: ({ context }) => {
                ((_accept: string) => {})(context.password);
                // @ts-expect-error
                ((_accept: number) => {})(context.password);
                return {
                  secret: 'the secret'
                };
              }
            }
          }
        },
        success: {
          type: 'final'
        }
      }
    });
  }));
});

describe('emitted', () => {
  // upstream: test/types.test.ts > emitted > emitted type should be represented in actor.on(…)
  it.effect('emitted type should be represented in actor.on(…)', () => Effect.gen(function* () {
    const m = setup({
      types: {
        emitted: {} as
          | { type: 'onClick'; x: number; y: number }
          | { type: 'onChange' }
      }
    }).createMachine({});

    const actor = (yield* createActor(m));

    yield* actor.on('onClick', (ev) => Effect.sync(() => {
      ev.x satisfies number;

      // @ts-expect-error
      ev.x satisfies string;
    }));

    yield* actor.on('onChange', () => Effect.void);

    // @ts-expect-error
    yield* actor.on('unknown', () => Effect.void);
  }));
});

// upstream: test/types.test.ts > should infer context type from `config.context` when there is no `schema.context`
it.effect('should infer context type from `config.context` when there is no `schema.context`', () => Effect.gen(function* () {
  createMachine(
    {
      context: {
        foo: 'test'
      }
    },
    {
      actions: {
        someAction: ({ context }) => {
          ((_accept: string) => {})(context.foo);
          // @ts-expect-error
          ((_accept: number) => {})(context.foo);
        }
      }
    }
  );
}));

// upstream: test/types.test.ts > should not use actions as possible inference sites
it.effect('should not use actions as possible inference sites', () => Effect.gen(function* () {
  createMachine(
    {
      types: {
        context: {} as {
          count: number;
        }
      },
      context: {
        count: 0
      },
      entry: () => {}
    },
    {
      actions: {
        someAction: ({ context }) => {
          ((_accept: number) => {})(context.count);
          // @ts-expect-error
          ((_accept: string) => {})(context.count);
        }
      }
    }
  );
}));

// upstream: test/types.test.ts > should work with generic context
it.effect('should work with generic context', () => Effect.gen(function* () {
  function createMachineWithExtras<TContext extends MachineContext>(
    context: TContext
  ): StateMachine<
    TContext,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any, // TMeta
    any
  > {
    return createMachine({ context });
  }

  createMachineWithExtras({ counter: 42 });
}));

// upstream: test/types.test.ts > should not widen literal types defined in `schema.context` based on `config.context`
it.effect('should not widen literal types defined in `schema.context` based on `config.context`', () => Effect.gen(function* () {
  createMachine({
    types: {
      context: {} as {
        literalTest: 'foo' | 'bar';
      }
    },
    context: {
      // @ts-expect-error
      literalTest: 'anything'
    }
  });
}));

describe('states', () => {
  // upstream: test/types.test.ts > states > should accept a state handling subset of events as part of the whole config handling superset of those events
  it.effect('should accept a state handling subset of events as part of the whole config handling superset of those events', () => Effect.gen(function* () {
    const italicState = {
      on: {
        TOGGLE_BOLD: {
          actions: () => {}
        }
      }
    };

    const boldState = {
      on: {
        TOGGLE_BOLD: {
          actions: () => {}
        }
      }
    };

    createMachine({
      types: {} as {
        events: { type: 'TOGGLE_ITALIC' } | { type: 'TOGGLE_BOLD' };
      },
      type: 'parallel',
      states: {
        italic: italicState,
        bold: boldState
      }
    });
  }));

  // technically it wouldn't be a big problem accepting this, such transitions would just never be selected
  // it's not worth complicating our types to support this though unless a strong argument is made in favor for this
  // upstream: test/types.test.ts > states > should not accept a state handling an event type outside of the events accepted by the machine
  it.effect('should not accept a state handling an event type outside of the events accepted by the machine', () => Effect.gen(function* () {
    const underlineState = {
      on: {
        TOGGLE_UNDERLINE: {
          actions: () => {}
        }
      }
    };

    createMachine({
      types: {} as {
        events: { type: 'TOGGLE_ITALIC' } | { type: 'TOGGLE_BOLD' };
      },
      type: 'parallel',
      states: {
        // @ts-expect-error
        underline: underlineState
      }
    });
  }));
});

describe('events', () => {
  // upstream: test/types.test.ts > events > should not use actions as possible inference sites 1
  it.effect('should not use actions as possible inference sites 1', () => Effect.gen(function* () {
    const machine = createMachine({
      types: {
        events: {} as {
          type: 'FOO';
        }
      },
      entry: raise<any, any, any, any, any, any>({ type: 'FOO' })
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* service.send({ type: 'FOO' }));
    // @ts-expect-error
    (yield* service.send({ type: 'UNKNOWN' }));
  }));

  // upstream: test/types.test.ts > events > should not use actions as possible inference sites 2
  it.effect('should not use actions as possible inference sites 2', () => Effect.gen(function* () {
    const machine = createMachine({
      types: {
        events: {} as {
          type: 'FOO';
        }
      },
      entry: () => {}
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* service.send({ type: 'FOO' }));
    // @ts-expect-error
    (yield* service.send({ type: 'UNKNOWN' }));
  }));

  // upstream: test/types.test.ts > events > event type should be inferable from a simple state machine type
  it.effect('event type should be inferable from a simple state machine type', () => Effect.gen(function* () {
    const toggleMachine = createMachine({
      types: {} as {
        context: {
          count: number;
        };
        events: {
          type: 'TOGGLE';
        };
      },
      context: {
        count: 0
      }
    });

    function acceptMachine<
      TContext extends {},
      TEvent extends { type: string }
    >(
      _machine: StateMachine<
        TContext,
        TEvent,
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any, // TMeta
        any
      >
    ) {}

    acceptMachine(toggleMachine);
  }));

  // upstream: test/types.test.ts > events > should infer inline function parameters when narrowing transition actions based on the event type
  it.effect('should infer inline function parameters when narrowing transition actions based on the event type', () => Effect.gen(function* () {
    createMachine({
      types: {
        context: {} as {
          count: number;
        },
        events: {} as
          | { type: 'EVENT_WITH_FLAG'; flag: boolean }
          | {
              type: 'EVENT_WITHOUT_FLAG';
            }
      },
      context: {
        count: 0
      },
      on: {
        EVENT_WITH_FLAG: {
          actions: ({ event }) => {
            ((_accept: 'EVENT_WITH_FLAG') => {})(event.type);
            ((_accept: boolean) => {})(event.flag);
            // @ts-expect-error
            ((_accept: 'is not any') => {})(event);
          }
        }
      }
    });
  }));

  // upstream: test/types.test.ts > events > should infer inline function parameters when for a wildcard transition
  it.effect('should infer inline function parameters when for a wildcard transition', () => Effect.gen(function* () {
    createMachine({
      types: {
        context: {} as {
          count: number;
        },
        events: {} as
          | { type: 'EVENT_WITH_FLAG'; flag: boolean }
          | {
              type: 'EVENT_WITHOUT_FLAG';
            }
      },
      context: {
        count: 0
      },
      on: {
        '*': {
          actions: ({ event }) => {
            ((_accept: 'EVENT_WITH_FLAG' | 'EVENT_WITHOUT_FLAG') => {})(
              event.type
            );
            // @ts-expect-error
            ((_accept: 'is not any') => {})(event);
          }
        }
      }
    });
  }));

  // upstream: test/types.test.ts > events > should infer inline function parameter with a partial transition descriptor matching multiple events with the matching count of segments
  it.effect('should infer inline function parameter with a partial transition descriptor matching multiple events with the matching count of segments', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        events:
          | { type: 'mouse.click.up'; direction: 'up' }
          | { type: 'mouse.click.down'; direction: 'down' }
          | { type: 'mouse.move' }
          | { type: 'mouse' }
          | { type: 'keypress' };
      },
      on: {
        'mouse.click.*': {
          actions: ({ event }) => {
            ((_accept: 'mouse.click.up' | 'mouse.click.down') => {})(
              event.type
            );
            ((_accept: 'up' | 'down') => {})(event.direction);
            // @ts-expect-error
            ((_accept: 'not any') => {})(event.type);
          }
        }
      }
    });
  }));

  // upstream: test/types.test.ts > events > should infer inline function parameter with a partial transition descriptor matching multiple events with the same count of segments or more
  it.effect('should infer inline function parameter with a partial transition descriptor matching multiple events with the same count of segments or more', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        events:
          | { type: 'mouse.click.up'; direction: 'up' }
          | { type: 'mouse.click.down'; direction: 'down' }
          | { type: 'mouse.move' }
          | { type: 'mouse' }
          | { type: 'keypress' };
      },
      on: {
        'mouse.*': {
          actions: ({ event }) => {
            ((
              _accept: 'mouse.click.up' | 'mouse.click.down' | 'mouse.move'
            ) => {})(event.type);
            // @ts-expect-error
            ((_accept: 'not any') => {})(event.type);
          }
        }
      }
    });
  }));

  // upstream: test/types.test.ts > events > should not allow a transition using an event type matching the possible prefix but one that is outside of the defines ones #1
  it.effect('should not allow a transition using an event type matching the possible prefix but one that is outside of the defines ones', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        events:
          | { type: 'mouse.click.up'; direction: 'up' }
          | { type: 'mouse.click.down'; direction: 'down' }
          | { type: 'mouse.move' }
          | { type: 'mouse' }
          | { type: 'keypress' };
      },
      on: {
        // @ts-expect-error
        'mouse.doubleClick': {}
      }
    });
  }));

  // upstream: test/types.test.ts > events > should not allow a transition using an event type matching the possible prefix but one that is outside of the defines ones #2
  it.effect('should not allow a transition using an event type matching the possible prefix but one that is outside of the defines ones', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        events:
          | { type: 'mouse.click.up'; direction: 'up' }
          | { type: 'mouse.click.down'; direction: 'down' }
          | { type: 'mouse.move' }
          | { type: 'mouse' }
          | { type: 'keypress' };
      },
      on: {
        // @ts-expect-error
        'mouse.doubleClick': {}
      }
    });
  }));

  // upstream: test/types.test.ts > events > should infer inline function parameter only using a direct match when the transition descriptor doesn't has a trailing wildcard
  it.effect(`should infer inline function parameter only using a direct match when the transition descriptor doesn't has a trailing wildcard`, () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        events:
          | { type: 'mouse.click.up'; direction: 'up' }
          | { type: 'mouse.click.down'; direction: 'down' }
          | { type: 'mouse.move' }
          | { type: 'mouse' }
          | { type: 'keypress' };
      },
      on: {
        mouse: {
          actions: ({ event }) => {
            ((_accept: 'mouse') => {})(event.type);
            // @ts-expect-error
            ((_accept: 'not any') => {})(event.type);
          }
        }
      }
    });
  }));

  // upstream: test/types.test.ts > events > should not allow a transition using a partial descriptor related to an event type that is only defined exxactly
  it.effect('should not allow a transition using a partial descriptor related to an event type that is only defined exxactly', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        events:
          | { type: 'mouse.click.up'; direction: 'up' }
          | { type: 'mouse.click.down'; direction: 'down' }
          | { type: 'mouse.move' }
          | { type: 'mouse' }
          | { type: 'keypress' };
      },
      on: {
        // @ts-expect-error
        'keypress.*': {}
      }
    });
  }));

  // upstream: test/types.test.ts > events > action objects used within implementations parameter should get access to the provided event type
  it.effect('action objects used within implementations parameter should get access to the provided event type', () => Effect.gen(function* () {
    createMachine(
      {
        types: {
          context: {} as { numbers: number[] },
          events: {} as { type: 'ADD'; number: number }
        },
        context: {
          numbers: []
        }
      },
      {
        actions: {
          addNumber: assign({
            numbers: ({ context, event }) => {
              ((_accept: number) => {})(event.number);
              // @ts-expect-error
              ((_accept: string) => {})(event.number);
              return context.numbers.concat(event.number);
            }
          })
        }
      }
    );
  }));

  // upstream: test/types.test.ts > events > should provide the default TEvent to transition actions when there is no specific TEvent configured
  it.effect('should provide the default TEvent to transition actions when there is no specific TEvent configured', () => Effect.gen(function* () {
    createMachine({
      types: {
        context: {} as {
          count: number;
        }
      },
      context: {
        count: 0
      },
      on: {
        FOO: {
          actions: ({ event }) => {
            ((_accept: string) => {})(event.type);
          }
        }
      }
    });
  }));

  // upstream: test/types.test.ts > events > should provide contextual `event` type in transition actions when the matching event has a union `.type`
  it.effect('should provide contextual `event` type in transition actions when the matching event has a union `.type`', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        events:
          | {
              type: 'FOO' | 'BAR';
              value: string;
            }
          | {
              type: 'OTHER';
            };
      },
      on: {
        FOO: {
          actions: ({ event }) => {
            event.type satisfies 'FOO' | 'BAR'; // it could be narrowed down to `FOO` but it's not worth the effort/complexity
            event.value satisfies string;
            // @ts-expect-error
            event.value satisfies number;
          }
        }
      }
    });
  }));
});

// NOT PORTED: test/types.test.ts > interpreter > should be convertible to Rx observable, the
// only test of upstream's `interpreter` describe (Vitest fails an empty suite, so the describe
// is not kept). rxjs `from(actor)` reads `actor[Symbol.observable]` and subscribes an observer
// object; the port has no XState-compatible facade and no observer-object `subscribe` (D6,
// DEV-3), so an actor is not an interop observable. See the "Tests not ported" table of
// CONFORMANCE.md.

describe('spawnChild action', () => {
  // upstream: test/types.test.ts > spawnChild action > should reject actor outside of the defined ones at usage site
  it.effect('should reject actor outside of the defined ones at usage site', () => Effect.gen(function* () {
    const child = fromPromise(() => Promise.resolve('foo'));

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      entry:
        // @ts-expect-error
        spawnChild('other')
    });
  }));

  // upstream: test/types.test.ts > spawnChild action > should accept a defined actor at usage site
  it.effect('should accept a defined actor at usage site', () => Effect.gen(function* () {
    const child = fromPromise(() => Promise.resolve('foo'));

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      entry: spawnChild('child')
    });
  }));

  // upstream: test/types.test.ts > spawnChild action > should allow valid configured actor id
  it.effect('should allow valid configured actor id', () => Effect.gen(function* () {
    const child = createMachine({});

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          id: 'ok1' | 'ok2';
          logic: typeof child;
        };
      },
      entry: spawnChild('child', { id: 'ok1' })
    });
  }));

  // upstream: test/types.test.ts > spawnChild action > should disallow invalid actor id
  it.effect('should disallow invalid actor id', () => Effect.gen(function* () {
    const child = createMachine({});

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          id: 'ok1' | 'ok2';
          logic: typeof child;
        };
      },
      entry: spawnChild(
        // @ts-expect-error
        'child',
        {
          id: 'child'
        }
      )
    });
  }));

  // upstream: test/types.test.ts > spawnChild action > should require id to be specified when it was configured
  it.effect('should require id to be specified when it was configured', () => Effect.gen(function* () {
    const child = createMachine({});

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          id: 'ok1' | 'ok2';
          logic: typeof child;
        };
      },
      entry:
        // @ts-expect-error
        spawnChild('child')
    });
  }));

  // upstream: test/types.test.ts > spawnChild action > shouldn't require id to be specified when it was not configured
  it.effect(`shouldn't require id to be specified when it was not configured`, () => Effect.gen(function* () {
    const child = createMachine({});

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      entry: spawnChild('child')
    });
  }));

  // upstream: test/types.test.ts > spawnChild action > should allow id to be specified when it was not configured
  it.effect(`should allow id to be specified when it was not configured`, () => Effect.gen(function* () {
    const child = createMachine({});

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      entry: spawnChild('child', { id: 'someId' })
    });
  }));

  // upstream: test/types.test.ts > spawnChild action > should allow anonymous inline actor outside of the configured actors
  it.effect(`should allow anonymous inline actor outside of the configured actors`, () => Effect.gen(function* () {
    const child1 = createMachine({
      context: {
        counter: 0
      }
    });

    const child2 = createMachine({
      context: {
        answer: ''
      }
    });

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child1;
        };
      },
      entry: spawnChild(child2)
    });
  }));

  // upstream: test/types.test.ts > spawnChild action > should disallow anonymous inline actor with an id outside of the configured actors
  it.effect(`should disallow anonymous inline actor with an id outside of the configured actors`, () => Effect.gen(function* () {
    const child1 = createMachine({
      context: {
        counter: 0
      }
    });

    const child2 = createMachine({
      context: {
        answer: ''
      }
    });

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child1;
          id: 'myChild';
        };
      },
      entry: spawnChild(
        // @ts-expect-error
        child2,
        { id: 'myChild' }
      )
    });
  }));

  // upstream: test/types.test.ts > spawnChild action > should reject static wrong input
  it.effect(`should reject static wrong input`, () => Effect.gen(function* () {
    const child = fromPromise(({}: { input: number }) =>
      Promise.resolve('foo')
    );

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      entry: spawnChild(
        // @ts-expect-error
        'child',
        {
          input: 'hello'
        }
      )
    });
  }));

  // upstream: test/types.test.ts > spawnChild action > should allow static correct input
  it.effect(`should allow static correct input`, () => Effect.gen(function* () {
    const child = fromPromise(({}: { input: number }) =>
      Promise.resolve('foo')
    );

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      entry: spawnChild('child', {
        input: 42
      })
    });
  }));

  // upstream: test/types.test.ts > spawnChild action > should allow static input that is a subtype of the expected one
  it.effect(`should allow static input that is a subtype of the expected one`, () => Effect.gen(function* () {
    const child = fromPromise(({}: { input: number | string }) =>
      Promise.resolve('foo')
    );

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      entry: spawnChild('child', {
        input: 42
      })
    });
  }));

  // upstream: test/types.test.ts > spawnChild action > should reject static input that is a supertype of the expected one
  it.effect(`should reject static input that is a supertype of the expected one`, () => Effect.gen(function* () {
    const child = fromPromise(({}: { input: number }) =>
      Promise.resolve('foo')
    );

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      entry: spawnChild(
        // @ts-expect-error
        'child',
        {
          input: Math.random() > 0.5 ? 'string' : 42
        }
      )
    });
  }));

  // upstream: test/types.test.ts > spawnChild action > should reject dynamic wrong input
  it.effect(`should reject dynamic wrong input`, () => Effect.gen(function* () {
    const child = fromPromise(({}: { input: number }) =>
      Promise.resolve('foo')
    );

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      entry: spawnChild(
        // @ts-expect-error
        'child',
        {
          input: () => 'hello'
        }
      )
    });
  }));

  // upstream: test/types.test.ts > spawnChild action > should allow dynamic correct input
  it.effect(`should allow dynamic correct input`, () => Effect.gen(function* () {
    const child = fromPromise(({}: { input: number }) =>
      Promise.resolve('foo')
    );

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      entry: spawnChild('child', {
        input: () => 42
      })
    });
  }));

  // upstream: test/types.test.ts > spawnChild action > should reject dynamic input that is a supertype of the expected one
  it.effect(`should reject dynamic input that is a supertype of the expected one`, () => Effect.gen(function* () {
    const child = fromPromise(({}: { input: number }) =>
      Promise.resolve('foo')
    );

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      entry: spawnChild(
        // @ts-expect-error
        'child',
        {
          input: () => (Math.random() > 0.5 ? 42 : 'hello')
        }
      )
    });
  }));

  // upstream: test/types.test.ts > spawnChild action > should allow dynamic input that is a subtype of the expected one
  it.effect(`should allow dynamic input that is a subtype of the expected one`, () => Effect.gen(function* () {
    const child = fromPromise(({}: { input: number | string }) =>
      Promise.resolve('foo')
    );

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      entry: spawnChild('child', {
        input: () => 'hello'
      })
    });
  }));

  // upstream: test/types.test.ts > spawnChild action > should reject a valid input of a different provided actor
  it.effect(`should reject a valid input of a different provided actor`, () => Effect.gen(function* () {
    const child1 = fromPromise(({}: { input: number }) => Promise.resolve(100));

    const child2 = fromPromise(({}: { input: string }) =>
      Promise.resolve('foo')
    );

    createMachine({
      types: {} as {
        actors:
          | {
              src: 'child1';
              logic: typeof child1;
            }
          | {
              src: 'child2';
              logic: typeof child2;
            };
      },
      entry:
        // @ts-expect-error
        spawnChild('child1', {
          input: 'hello'
        })
    });
  }));

  // upstream: test/types.test.ts > spawnChild action > should require input to be specified when it is required
  it.effect(`should require input to be specified when it is required`, () => Effect.gen(function* () {
    const child = fromPromise(({}: { input: number }) => Promise.resolve(100));

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      entry:
        // @ts-expect-error
        spawnChild('child')
    });
  }));

  // upstream: test/types.test.ts > spawnChild action > should not require input when it's optional
  it.effect(`should not require input when it's optional`, () => Effect.gen(function* () {
    const child = fromPromise(({}: { input: number | undefined }) =>
      Promise.resolve(100)
    );

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      entry: spawnChild('child')
    });
  }));
});

describe('spawner in assign', () => {
  // upstream: test/types.test.ts > spawner in assign > spawned actor ref should be compatible with the result of ActorRefFrom
  it.effect('spawned actor ref should be compatible with the result of ActorRefFrom', () => Effect.gen(function* () {
    const createChild = () => createMachine({});

    function createParent(_deps: {
      spawnChild: (
        spawn: Spawner<ProvidedActor>
      ) => ActorRefFrom<ReturnType<typeof createChild>>;
    }) {}

    createParent({
      spawnChild: (spawn) => spawn(createChild())
    });
  }));

  // upstream: test/types.test.ts > spawner in assign > should reject actor outside of the defined ones at usage site
  it.effect('should reject actor outside of the defined ones at usage site', () => Effect.gen(function* () {
    const child = fromPromise(() => Promise.resolve('foo'));

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      entry: assign(({ spawn }) => {
        // @ts-expect-error
        spawn('other');
        return {};
      })
    });
  }));

  // upstream: test/types.test.ts > spawner in assign > should accept a defined actor at usage site
  it.effect('should accept a defined actor at usage site', () => Effect.gen(function* () {
    const child = fromPromise(() => Promise.resolve('foo'));

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      entry: assign(({ spawn }) => {
        spawn('child');
        return {};
      })
    });
  }));

  // upstream: test/types.test.ts > spawner in assign > should allow valid configured actor id
  it.effect('should allow valid configured actor id', () => Effect.gen(function* () {
    const child = createMachine({});

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          id: 'ok1' | 'ok2';
          logic: typeof child;
        };
      },
      entry: assign(({ spawn }) => {
        spawn('child', { id: 'ok1' });
        return {};
      })
    });
  }));

  // upstream: test/types.test.ts > spawner in assign > should disallow invalid actor id
  it.effect('should disallow invalid actor id', () => Effect.gen(function* () {
    const child = createMachine({});

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          id: 'ok1' | 'ok2';
          logic: typeof child;
        };
      },
      entry: assign(({ spawn }) => {
        // @ts-expect-error
        spawn('child', {
          id: 'child'
        });
        return {};
      })
    });
  }));

  // upstream: test/types.test.ts > spawner in assign > should require id to be specified when it was configured
  it.effect('should require id to be specified when it was configured', () => Effect.gen(function* () {
    const child = createMachine({});

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          id: 'ok1' | 'ok2';
          logic: typeof child;
        };
      },
      entry: assign(({ spawn }) => {
        // @ts-expect-error
        spawn('child');
        return {};
      })
    });
  }));

  // upstream: test/types.test.ts > spawner in assign > shouldn't require id to be specified when it was not configured
  it.effect(`shouldn't require id to be specified when it was not configured`, () => Effect.gen(function* () {
    const child = createMachine({});

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      entry: assign(({ spawn }) => {
        spawn('child');
        return {};
      })
    });
  }));

  // upstream: test/types.test.ts > spawner in assign > should allow id to be specified when it was not configured
  it.effect(`should allow id to be specified when it was not configured`, () => Effect.gen(function* () {
    const child = createMachine({});

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      entry: assign(({ spawn }) => {
        spawn('child', { id: 'someId' });
        return {};
      })
    });
  }));

  // upstream: test/types.test.ts > spawner in assign > should allow anonymous inline actor outside of the configured actors
  it.effect(`should allow anonymous inline actor outside of the configured actors`, () => Effect.gen(function* () {
    const child1 = createMachine({
      context: {
        counter: 0
      }
    });

    const child2 = createMachine({
      context: {
        answer: ''
      }
    });

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child1;
        };
      },
      entry: assign(({ spawn }) => {
        spawn(child2);
        return {};
      })
    });
  }));

  // upstream: test/types.test.ts > spawner in assign > should no allow anonymous inline actor with an id outside of the configured ones
  it.effect(`should no allow anonymous inline actor with an id outside of the configured ones`, () => Effect.gen(function* () {
    const child1 = createMachine({
      context: {
        counter: 0
      }
    });

    const child2 = createMachine({
      context: {
        answer: ''
      }
    });

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child1;
          id: 'myChild';
        };
      },
      entry: assign(({ spawn }) => {
        // @ts-expect-error
        spawn(child2, { id: 'myChild' });
        return {};
      })
    });
  }));

  // upstream: test/types.test.ts > spawner in assign > should reject static wrong input
  it.effect(`should reject static wrong input`, () => Effect.gen(function* () {
    const child = fromPromise(({}: { input: number }) =>
      Promise.resolve('foo')
    );

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      entry: assign(({ spawn }) => {
        // @ts-expect-error
        spawn('child', {
          input: 'hello'
        });
        return {};
      })
    });
  }));

  // upstream: test/types.test.ts > spawner in assign > should allow static correct input
  it.effect(`should allow static correct input`, () => Effect.gen(function* () {
    const child = fromPromise(({}: { input: number }) =>
      Promise.resolve('foo')
    );

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      entry: assign(({ spawn }) => {
        spawn('child', {
          input: 42
        });
        return {};
      })
    });
  }));

  // upstream: test/types.test.ts > spawner in assign > should allow static input that is a subtype of the expected one
  it.effect(`should allow static input that is a subtype of the expected one`, () => Effect.gen(function* () {
    const child = fromPromise(({}: { input: number | string }) =>
      Promise.resolve('foo')
    );

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      entry: assign(({ spawn }) => {
        spawn('child', {
          input: 42
        });
        return {};
      })
    });
  }));

  // upstream: test/types.test.ts > spawner in assign > should reject static input that is a supertype of the expected one
  it.effect(`should reject static input that is a supertype of the expected one`, () => Effect.gen(function* () {
    const child = fromPromise(({}: { input: number }) =>
      Promise.resolve('foo')
    );

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      entry: assign(({ spawn }) => {
        // @ts-expect-error
        spawn('child', {
          input: Math.random() > 0.5 ? 'string' : 42
        });
        return {};
      })
    });
  }));

  // upstream: test/types.test.ts > spawner in assign > should reject an attempt to provide dynamic input
  it.effect(`should reject an attempt to provide dynamic input`, () => Effect.gen(function* () {
    const child = fromPromise(({}: { input: number }) =>
      Promise.resolve('foo')
    );

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      entry: assign(({ spawn }) => {
        // @ts-expect-error
        spawn('child', {
          input: () => 42
        });
        return {};
      })
    });
  }));

  // upstream: test/types.test.ts > spawner in assign > should return a concrete actor ref type based on actor logic argument, one that is assignable to a location expecting that concrete actor ref type
  it.effect(`should return a concrete actor ref type based on actor logic argument, one that is assignable to a location expecting that concrete actor ref type`, () => Effect.gen(function* () {
    const child = createMachine({
      types: {} as {
        context: {
          counter: number;
        };
      },
      context: {
        counter: 100
      }
    });

    createMachine({
      types: {} as {
        context: {
          myChild?: ActorRefFrom<typeof child>;
        };
      },
      context: {},
      entry: assign({
        myChild: ({ spawn }) => {
          return spawn(child);
        }
      })
    });
  }));

  // upstream: test/types.test.ts > spawner in assign > should return a concrete actor ref type based on actor logic argument, one that isn't assignable to a location expecting a different concrete actor ref type
  it.effect(`should return a concrete actor ref type based on actor logic argument, one that isn't assignable to a location expecting a different concrete actor ref type`, () => Effect.gen(function* () {
    const child = createMachine({
      types: {} as {
        context: {
          counter: number;
        };
      },
      context: {
        counter: 100
      }
    });

    const otherChild = createMachine({
      types: {} as {
        context: {
          title: string;
        };
      },
      context: {
        title: 'The Answer'
      }
    });

    createMachine({
      types: {} as {
        context: {
          myChild?: ActorRefFrom<typeof child>;
        };
      },
      context: {},
      entry: assign({
        // @ts-expect-error
        myChild: ({ spawn }) => {
          return spawn(otherChild);
        }
      })
    });
  }));

  // upstream: test/types.test.ts > spawner in assign > should require input to be specified when it is required
  it.effect(`should require input to be specified when it is required`, () => Effect.gen(function* () {
    const child = fromPromise(({}: { input: number }) => Promise.resolve(100));

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      entry: assign(({ spawn }) => {
        // @ts-expect-error
        spawn('child');
        return {};
      })
    });
  }));

  // upstream: test/types.test.ts > spawner in assign > should not require input when it's optional
  it.effect(`should not require input when it's optional`, () => Effect.gen(function* () {
    const child = fromPromise(({}: { input: number | undefined }) =>
      Promise.resolve(100)
    );

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      entry: assign(({ spawn }) => {
        spawn('child');
        return {};
      })
    });
  }));

  // upstream: test/types.test.ts > spawner in assign > should return a concrete actor ref type based on the used string reference
  it.effect(`should return a concrete actor ref type based on the used string reference`, () => Effect.gen(function* () {
    const child = createMachine({
      types: {} as {
        context: {
          counter: number;
        };
      },
      context: {
        counter: 100
      }
    });

    const otherChild = createMachine({
      types: {} as {
        context: {
          title: string;
        };
      },
      context: {
        title: 'The Answer'
      }
    });

    createMachine({
      types: {} as {
        context: {
          myChild?: ActorRefFrom<typeof child>;
        };
        actors:
          | {
              src: 'child';
              logic: typeof child;
            }
          | {
              src: 'other';
              logic: typeof otherChild;
            };
      },
      context: {},
      entry: assign({
        myChild: ({ spawn }) => {
          return spawn('child');
        }
      })
    });
  }));
});

describe('invoke', () => {
  // upstream: test/types.test.ts > invoke > should reject actor outside of the defined ones at usage site
  it.effect('should reject actor outside of the defined ones at usage site', () => Effect.gen(function* () {
    const child = fromPromise(() => Promise.resolve('foo'));

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      // @ts-expect-error
      invoke: {
        src: 'other'
      }
    });
  }));

  // upstream: test/types.test.ts > invoke > should accept a defined actor at usage site
  it.effect('should accept a defined actor at usage site', () => Effect.gen(function* () {
    const child = fromPromise(() => Promise.resolve('foo'));

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      invoke: {
        src: 'child'
      }
    });
  }));

  // upstream: test/types.test.ts > invoke > should allow valid configured actor id
  it.effect('should allow valid configured actor id', () => Effect.gen(function* () {
    const child = createMachine({});

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          id: 'ok1' | 'ok2';
          logic: typeof child;
        };
      },
      invoke: {
        id: 'ok1',
        src: 'child'
      }
    });
  }));

  // upstream: test/types.test.ts > invoke > should disallow invalid actor id
  it.effect('should disallow invalid actor id', () => Effect.gen(function* () {
    const child = createMachine({});

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          id: 'ok1' | 'ok2';
          logic: typeof child;
        };
      },
      // @ts-expect-error
      invoke: {
        id: 'child',
        src: 'child'
      }
    });
  }));

  // upstream: test/types.test.ts > invoke > should require id to be specified when it was configured
  it.effect('should require id to be specified when it was configured', () => Effect.gen(function* () {
    const child = createMachine({});

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          id: 'ok1' | 'ok2';
          logic: typeof child;
        };
      },
      // @ts-expect-error
      invoke: {
        src: 'child'
      }
    });
  }));

  // upstream: test/types.test.ts > invoke > shouldn't require id to be specified when it was not configured
  it.effect(`shouldn't require id to be specified when it was not configured`, () => Effect.gen(function* () {
    const child = createMachine({});

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      invoke: {
        src: 'child'
      }
    });
  }));

  // upstream: test/types.test.ts > invoke > should allow id to be specified when it was not configured
  it.effect(`should allow id to be specified when it was not configured`, () => Effect.gen(function* () {
    const child = createMachine({});

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      invoke: {
        id: 'someId',
        src: 'child'
      }
    });
  }));

  // upstream: test/types.test.ts > invoke > should allow anonymous inline actor outside of the configured actors
  it.effect(`should allow anonymous inline actor outside of the configured actors`, () => Effect.gen(function* () {
    const child1 = createMachine({
      context: {
        counter: 0
      }
    });

    const child2 = createMachine({
      context: {
        answer: ''
      }
    });

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child1;
        };
      },
      invoke: {
        src: child2
      }
    });
  }));

  // upstream: test/types.test.ts > invoke > should diallow anonymous inline actor with an id outside of the configured actors
  it.effect(`should diallow anonymous inline actor with an id outside of the configured actors`, () => Effect.gen(function* () {
    const child1 = createMachine({
      context: {
        counter: 0
      }
    });

    const child2 = createMachine({
      context: {
        answer: ''
      }
    });

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child1;
          id: 'myChild';
        };
      },
      // @ts-expect-error
      invoke: {
        src: child2,
        id: 'myChild'
      }
    });
  }));

  // upstream: test/types.test.ts > invoke > should reject static wrong input
  it.effect(`should reject static wrong input`, () => Effect.gen(function* () {
    const child = fromPromise(({}: { input: number }) =>
      Promise.resolve('foo')
    );

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      // @ts-expect-error
      invoke: {
        src: 'child',
        input: 'hello'
      }
    });
  }));

  // upstream: test/types.test.ts > invoke > should allow static correct input
  it.effect(`should allow static correct input`, () => Effect.gen(function* () {
    const child = fromPromise(({}: { input: number }) =>
      Promise.resolve('foo')
    );

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      invoke: {
        src: 'child',
        input: 42
      }
    });
  }));

  // upstream: test/types.test.ts > invoke > should allow static input that is a subtype of the expected one
  it.effect(`should allow static input that is a subtype of the expected one`, () => Effect.gen(function* () {
    const child = fromPromise(({}: { input: number | string }) =>
      Promise.resolve('foo')
    );

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      invoke: {
        src: 'child',
        input: 42
      }
    });
  }));

  // upstream: test/types.test.ts > invoke > should reject static input that is a supertype of the expected one
  it.effect(`should reject static input that is a supertype of the expected one`, () => Effect.gen(function* () {
    const child = fromPromise(({}: { input: number }) =>
      Promise.resolve('foo')
    );

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      // @ts-expect-error
      invoke: {
        src: 'child',
        input: Math.random() > 0.5 ? 'string' : 42
      }
    });
  }));

  // upstream: test/types.test.ts > invoke > should reject dynamic wrong input
  it.effect(`should reject dynamic wrong input`, () => Effect.gen(function* () {
    const child = fromPromise(({}: { input: number }) =>
      Promise.resolve('foo')
    );

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      // @ts-expect-error
      invoke: {
        src: 'child',
        input: () => 'hello'
      }
    });
  }));

  // upstream: test/types.test.ts > invoke > should allow dynamic correct input
  it.effect(`should allow dynamic correct input`, () => Effect.gen(function* () {
    const child = fromPromise(({}: { input: number }) =>
      Promise.resolve('foo')
    );

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      invoke: {
        src: 'child',
        input: () => 42
      }
    });
  }));

  // upstream: test/types.test.ts > invoke > should reject dynamic input that is a supertype of the expected one
  it.effect(`should reject dynamic input that is a supertype of the expected one`, () => Effect.gen(function* () {
    const child = fromPromise(({}: { input: number }) =>
      Promise.resolve('foo')
    );

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      // @ts-expect-error
      invoke: {
        src: 'child',
        input: () => (Math.random() > 0.5 ? 42 : 'hello')
      }
    });
  }));

  // upstream: test/types.test.ts > invoke > should allow dynamic input that is a subtype of the expected one
  it.effect(`should allow dynamic input that is a subtype of the expected one`, () => Effect.gen(function* () {
    const child = fromPromise(({}: { input: number | string }) =>
      Promise.resolve('foo')
    );

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      invoke: {
        src: 'child',
        input: () => 'hello'
      }
    });
  }));

  // upstream: test/types.test.ts > invoke > onDone should work with a service that uses strings for both targets
  it.effect('onDone should work with a service that uses strings for both targets', () => Effect.gen(function* () {
    const machine = createMachine({
      invoke: {
        src: fromPromise(() => new Promise((resolve) => resolve(1))),
        onDone: ['.a', '.b']
      },
      initial: 'a',
      states: {
        a: {},
        b: {}
      }
    });
    noop(machine);
    expect(true).toBeTruthy();
  }));

  // upstream: test/types.test.ts > invoke > onDone should work with a service that uses transition objects for both targets
  it.effect('onDone should work with a service that uses transition objects for both targets', () => Effect.gen(function* () {
    const machine = createMachine({
      invoke: {
        src: fromPromise(() => new Promise((resolve) => resolve(1))),
        onDone: [{ target: '.a' }, { target: '.b' }]
      },
      initial: 'a',
      states: {
        a: {},
        b: {}
      }
    });
    noop(machine);
    expect(true).toBeTruthy();
  }));

  // upstream: test/types.test.ts > invoke > onDone should work with a service that uses a string for one target and a transition object for another
  it.effect('onDone should work with a service that uses a string for one target and a transition object for another', () => Effect.gen(function* () {
    const machine = createMachine({
      invoke: {
        src: fromPromise(() => new Promise((resolve) => resolve(1))),
        onDone: [{ target: '.a' }, '.b']
      },
      initial: 'a',
      states: {
        a: {},
        b: {}
      }
    });
    noop(machine);
    expect(true).toBeTruthy();
  }));

  // upstream: test/types.test.ts > invoke > should require input to be specified when it is required
  it.effect(`should require input to be specified when it is required`, () => Effect.gen(function* () {
    const child = fromPromise(({}: { input: number }) => Promise.resolve(100));

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      // @ts-expect-error
      invoke: {
        src: 'child'
      }
    });
  }));

  // upstream: test/types.test.ts > invoke > should not require input when it's optional
  it.effect(`should not require input when it's optional`, () => Effect.gen(function* () {
    const child = fromPromise(({}: { input: number | undefined }) =>
      Promise.resolve(100)
    );

    createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      },
      invoke: {
        src: 'child'
      }
    });
  }));
});

describe('actor implementations', () => {
  // upstream: test/types.test.ts > actor implementations > should reject actor outside of the defined ones in provided implementations
  it.effect('should reject actor outside of the defined ones in provided implementations', () => Effect.gen(function* () {
    const child = fromPromise(() => Promise.resolve('foo'));

    createMachine(
      {
        types: {} as {
          actors: {
            src: 'child';
            logic: typeof child;
          };
        }
      },
      {
        actors: {
          // @ts-expect-error
          other: child
        }
      }
    );
  }));

  // upstream: test/types.test.ts > actor implementations > should accept a defined actor in provided implementations
  it.effect('should accept a defined actor in provided implementations', () => Effect.gen(function* () {
    const child = fromPromise(() => Promise.resolve('foo'));

    createMachine(
      {
        types: {} as {
          actors: {
            src: 'child';
            logic: typeof child;
          };
        }
      },
      {
        actors: {
          child
        }
      }
    );
  }));

  // upstream: test/types.test.ts > actor implementations > should reject the provided actor when the output doesn't match
  it.effect(`should reject the provided actor when the output doesn't match`, () => Effect.gen(function* () {
    const child = fromPromise(() => Promise.resolve('foo'));

    createMachine(
      {
        types: {} as {
          actors: {
            src: 'child';
            logic: typeof child;
          };
        }
      },
      {
        actors: {
          // @ts-expect-error
          child: fromPromise(() => Promise.resolve(42))
        }
      }
    );
  }));

  // upstream: test/types.test.ts > actor implementations > should reject the provided actor when its output is a super type of the expected one
  it.effect(`should reject the provided actor when its output is a super type of the expected one`, () => Effect.gen(function* () {
    const child = fromPromise(() => Promise.resolve('foo'));

    createMachine(
      {
        types: {} as {
          actors: {
            src: 'child';
            logic: typeof child;
          };
        }
      },
      {
        actors: {
          // @ts-expect-error
          child: fromPromise(() =>
            Promise.resolve(Math.random() > 0.5 ? 'foo' : 42)
          )
        }
      }
    );
  }));

  // upstream: test/types.test.ts > actor implementations > should accept the provided actor when its output is a sub type of the expected one
  it.effect(`should accept the provided actor when its output is a sub type of the expected one`, () => Effect.gen(function* () {
    const child = fromPromise(() =>
      Promise.resolve(Math.random() > 0.5 ? 'foo' : 42)
    );

    createMachine(
      {
        types: {} as {
          actors: {
            src: 'child';
            logic: typeof child;
          };
        }
      },
      {
        actors: {
          // TODO: ideally this shouldn't error
          // @ts-expect-error
          child: fromPromise(() => Promise.resolve('foo'))
        }
      }
    );
  }));

  // upstream: test/types.test.ts > actor implementations > should allow an actor with the expected snapshot type
  it.effect('should allow an actor with the expected snapshot type', () => Effect.gen(function* () {
    const child = createMachine({
      types: {} as {
        context: {
          foo: string;
        };
      },
      context: {
        foo: 'bar'
      }
    });

    createMachine(
      {
        types: {} as {
          actors: {
            src: 'child';
            logic: typeof child;
          };
        }
      },
      {
        actors: {
          child
        }
      }
    );
  }));

  // upstream: test/types.test.ts > actor implementations > should reject an actor with an incorrect snapshot type
  it.effect('should reject an actor with an incorrect snapshot type', () => Effect.gen(function* () {
    const child = createMachine({
      types: {} as {
        context: {
          foo: string;
        };
      },
      context: {
        foo: 'bar'
      }
    });

    createMachine(
      {
        types: {} as {
          actors: {
            src: 'child';
            logic: typeof child;
          };
        }
      },
      {
        actors: {
          // @ts-expect-error
          child: createMachine({
            types: {} as {
              context: {
                foo: number;
              };
            },
            context: {
              foo: 100
            }
          })
        }
      }
    );
  }));

  // upstream: test/types.test.ts > actor implementations > should allow an actor with a snapshot type that is a subtype of the expected one
  it.effect('should allow an actor with a snapshot type that is a subtype of the expected one', () => Effect.gen(function* () {
    const child = createMachine({
      types: {} as {
        context: {
          foo: string | number;
        };
      },
      context: {
        foo: 'bar'
      }
    });

    createMachine(
      {
        types: {} as {
          actors: {
            src: 'child';
            logic: typeof child;
          };
        }
      },
      {
        actors: {
          // TODO: ideally this should be allowed
          // @ts-expect-error
          child: createMachine({
            types: {} as {
              context: {
                foo: string;
              };
            },
            context: {
              foo: 'bar'
            }
          })
        }
      }
    );
  }));

  // upstream: test/types.test.ts > actor implementations > should reject an actor with a snapshot type that is a supertype of the expected one
  it.effect('should reject an actor with a snapshot type that is a supertype of the expected one', () => Effect.gen(function* () {
    const child = createMachine({
      types: {} as {
        context: {
          foo: string;
        };
      },
      context: {
        foo: 'bar'
      }
    });

    createMachine(
      {
        types: {} as {
          actors: {
            src: 'child';
            logic: typeof child;
          };
        }
      },
      {
        actors: {
          // @ts-expect-error
          child: createMachine({
            types: {} as {
              context: {
                foo: string | number;
              };
            },
            context: {
              foo: 'bar'
            }
          })
        }
      }
    );
  }));

  // upstream: test/types.test.ts > actor implementations > should allow an actor with the expected event types
  it.effect('should allow an actor with the expected event types', () => Effect.gen(function* () {
    const child = createMachine({
      types: {} as {
        events: {
          type: 'EV_1';
        };
      }
    });

    createMachine(
      {
        types: {} as {
          actors: {
            src: 'child';
            logic: typeof child;
          };
        }
      },
      {
        actors: {
          child
        }
      }
    );
  }));

  // upstream: test/types.test.ts > actor implementations > should reject an actor with wrong event types
  it.effect('should reject an actor with wrong event types', () => Effect.gen(function* () {
    const child = createMachine({
      types: {} as {
        events: {
          type: 'EV_1';
        };
      }
    });

    createMachine(
      {
        types: {} as {
          actors: {
            src: 'child';
            logic: typeof child;
          };
        }
      },
      {
        actors: {
          // @ts-expect-error
          child: createMachine({
            types: {} as {
              events: {
                type: 'OTHER';
              };
            }
          })
        }
      }
    );
  }));

  // upstream: test/types.test.ts > actor implementations > should reject an actor with an event type that is a subtype of the expected one
  it.effect('should reject an actor with an event type that is a subtype of the expected one', () => Effect.gen(function* () {
    const child = createMachine({
      types: {} as {
        events:
          | {
              type: 'EV_1';
            }
          | {
              type: 'EV_2';
            };
      }
    });

    createMachine(
      {
        types: {} as {
          actors: {
            src: 'child';
            logic: typeof child;
          };
        }
      },
      {
        actors: {
          // the provided actor has to be able to handle all the event types that it might receive from the parent here
          // @ts-expect-error
          child: createMachine({
            types: {} as {
              events: {
                type: 'EV_1';
              };
            }
          })
        }
      }
    );
  }));

  // upstream: test/types.test.ts > actor implementations > should allow an actor with a snapshot type that is a supertype of the expected one
  it.effect('should allow an actor with a snapshot type that is a supertype of the expected one', () => Effect.gen(function* () {
    const child = createMachine({
      types: {} as {
        events: {
          type: 'EV_1';
        };
      }
    });

    createMachine(
      {
        types: {} as {
          actors: {
            src: 'child';
            logic: typeof child;
          };
        }
      },
      {
        actors: {
          // TODO: ideally this should be allowed since the provided actor is capable of handling all the event types that it might receive from the parent here
          // @ts-expect-error
          child: createMachine({
            types: {} as {
              events:
                | {
                    type: 'EV_1';
                  }
                | {
                    type: 'EV_2';
                  };
            }
          })
        }
      }
    );
  }));
});

describe('state.children without setup', () => {
  // upstream: test/types.test.ts > state.children without setup > should return the correct child type on the available snapshot when the child ID for the actor was configured
  it.effect('should return the correct child type on the available snapshot when the child ID for the actor was configured', () => Effect.gen(function* () {
    const child = createMachine({
      types: {} as {
        context: {
          foo: string;
        };
      },
      context: {
        foo: ''
      }
    });

    const machine = createMachine(
      {
        types: {} as {
          actors: {
            src: 'child';
            id: 'someChild';
            logic: typeof child;
          };
        },
        invoke: {
          id: 'someChild',
          src: 'child'
        }
      },
      {
        actors: { child }
      }
    );

    const snapshot = (yield* (yield* createActor(machine)).getSnapshot);
    const childSnapshot = (yield* snapshot.children.someChild!.getSnapshot);

    childSnapshot.context.foo satisfies string | undefined;
    childSnapshot.context.foo satisfies string;
    // @ts-expect-error
    childSnapshot.context.foo satisfies '';
    // @ts-expect-error
    childSnapshot.context.foo satisfies number | undefined;
  }));

  // upstream: test/types.test.ts > state.children without setup > should have an optional child on the available snapshot when the child ID for the actor was configured
  it.effect('should have an optional child on the available snapshot when the child ID for the actor was configured', () => Effect.gen(function* () {
    const child = createMachine({
      context: {
        counter: 0
      }
    });

    const machine = createMachine({
      types: {} as {
        actors: {
          src: 'child';
          id: 'myChild';
          logic: typeof child;
        };
      }
    });

    const childActor = (yield* (yield* createActor(machine)).getSnapshot).children.myChild;

    childActor satisfies ActorRefFrom<typeof child> | undefined;
    // @ts-expect-error
    childActor satisfies ActorRefFrom<typeof child>;
  }));

  // upstream: test/types.test.ts > state.children without setup > should have an optional child on the available snapshot when the child ID for the actor was not configured
  it.effect('should have an optional child on the available snapshot when the child ID for the actor was not configured', () => Effect.gen(function* () {
    const child = createMachine({
      context: {
        counter: 0
      }
    });

    const machine = createMachine({
      types: {} as {
        actors: {
          src: 'child';
          logic: typeof child;
        };
      }
    });

    const childActor = (yield* (yield* createActor(machine)).getSnapshot).children.someChild;

    childActor satisfies ActorRefFrom<typeof child> | undefined;
    // @ts-expect-error
    childActor satisfies ActorRefFrom<typeof child>;
  }));

  // upstream: test/types.test.ts > state.children without setup > should not have an index signature on the available snapshot when child IDs were configured for all actors
  it.effect('should not have an index signature on the available snapshot when child IDs were configured for all actors', () => Effect.gen(function* () {
    const child1 = createMachine({
      context: {
        counter: 0
      }
    });

    const child2 = createMachine({
      context: {
        answer: ''
      }
    });

    const machine = createMachine({
      types: {} as {
        actors:
          | {
              src: 'child1';
              id: 'counter';
              logic: typeof child1;
            }
          | {
              src: 'child2';
              id: 'quiz';
              logic: typeof child2;
            };
      }
    });

    (yield* (yield* createActor(machine)).getSnapshot).children.counter;
    (yield* (yield* createActor(machine)).getSnapshot).children.quiz;
    // @ts-expect-error
    (yield* (yield* createActor(machine)).getSnapshot).children.someChild;
  }));

  // upstream: test/types.test.ts > state.children without setup > should have an index signature on the available snapshot when child IDs were configured only for some actors
  it.effect('should have an index signature on the available snapshot when child IDs were configured only for some actors', () => Effect.gen(function* () {
    const child1 = createMachine({
      context: {
        counter: 0
      }
    });

    const child2 = createMachine({
      context: {
        answer: ''
      }
    });

    const machine = createMachine({
      types: {} as {
        actors:
          | {
              src: 'child1';
              id: 'counter';
              logic: typeof child1;
            }
          | {
              src: 'child2';
              logic: typeof child2;
            };
      }
    });

    const counterActor = (yield* (yield* createActor(machine)).getSnapshot).children.counter;
    counterActor satisfies ActorRefFrom<typeof child1> | undefined;

    const someActor = (yield* (yield* createActor(machine)).getSnapshot).children.someChild;
    someActor satisfies ActorRefFrom<typeof child2> | undefined;
    // @ts-expect-error - someChild can only be child2 (child1 has a literal id)
    someActor satisfies ActorRefFrom<typeof child1> | undefined;
  }));
});

describe('state.children with setup and multiple invoke', () => {
  // upstream: test/types.test.ts > state.children with setup and multiple invoke > should type children by their specific actor when using setup with an invoke array
  it.effect('should type children by their specific actor when using setup with an invoke array', () => Effect.gen(function* () {
    const authLogic = setup({
      types: {
        context: {} as { token: string | null },
        events: {} as { type: 'auth.logout' }
      },
      actors: {
        authState: fromPromise(async () => ({ token: 'tok' }))
      }
    }).createMachine({
      id: 'auth',
      context: { token: null },
      initial: 'idle',
      invoke: {
        src: 'authState',
        onDone: {
          // `event.output` of `xstate.done.actor.*` is an Option (D8, DEV-7)
          actions: assign({
            token: ({ event }) =>
              Option.match(event.output, {
                onNone: () => null,
                onSome: (output) => output.token
              })
          })
        }
      },
      states: { idle: {} }
    });

    const telemetryLogic = setup({
      types: {
        context: {} as { store: string | null },
        events: {} as { type: 'telemetry.start' }
      },
      actors: {
        checkConsent: fromPromise(async () => ({ status: 'granted' }))
      }
    }).createMachine({
      id: 'telemetry',
      context: { store: null },
      initial: 'idle',
      states: { idle: {} }
    });

    const rootMachine = setup({
      types: {
        context: {} as { value: number }
      },
      actors: {
        auth: authLogic,
        telemetry: telemetryLogic
      }
    }).createMachine({
      context: { value: 0 },
      invoke: [
        { id: 'auth', systemId: 'auth', src: 'auth' },
        { id: 'telemetry', systemId: 'telemetry', src: 'telemetry' }
      ]
    });

    const snapshot = (yield* (yield* createActor(rootMachine)).getSnapshot);

    const authChild = snapshot.children.auth;
    (yield* authChild!.getSnapshot).context.token satisfies string | null;
    // @ts-expect-error - token is string | null, not number
    (yield* authChild!.getSnapshot).context.token satisfies number;

    const telemetryChild = snapshot.children.telemetry;
    (yield* telemetryChild!.getSnapshot).context.store satisfies string | null;
    // @ts-expect-error - store is string | null, not number
    (yield* telemetryChild!.getSnapshot).context.store satisfies number;
  }));
});

describe('actions', () => {
  // upstream: test/types.test.ts > actions > context should get inferred for builtin actions used as an entry action
  it.effect('context should get inferred for builtin actions used as an entry action', () => Effect.gen(function* () {
    createMachine({
      types: {
        context: {} as { count: number }
      },
      context: {
        count: 0
      },
      entry: assign(({ context }) => {
        ((_accept: number) => {})(context.count);
        // @ts-expect-error
        ((_accept: "ain't any") => {})(context.count);
        return {};
      })
    });
  }));

  // upstream: test/types.test.ts > actions > context should get inferred for builtin actions used as a transition action
  it.effect('context should get inferred for builtin actions used as a transition action', () => Effect.gen(function* () {
    createMachine({
      types: {
        context: {} as { count: number },
        events: {} as { type: 'FOO' } | { type: 'BAR' }
      },
      context: {
        count: 0
      },
      on: {
        FOO: {
          actions: assign(({ context }) => {
            ((_accept: number) => {})(context.count);
            // @ts-expect-error
            ((_accept: "ain't any") => {})(context.count);
            return {};
          })
        }
      }
    });
  }));

  // upstream: test/types.test.ts > actions > context should get inferred for a builtin action within an array of entry actions
  it.effect('context should get inferred for a builtin action within an array of entry actions', () => Effect.gen(function* () {
    createMachine({
      types: {
        context: {} as { count: number }
      },
      context: {
        count: 0
      },
      entry: [
        'foo',
        assign(({ context }) => {
          ((_accept: number) => {})(context.count);
          // @ts-expect-error
          ((_accept: "ain't any") => {})(context.count);
          return {};
        })
      ]
    });
  }));

  // upstream: test/types.test.ts > actions > context should get inferred for a builtin action within an array of transition actions
  it.effect('context should get inferred for a builtin action within an array of transition actions', () => Effect.gen(function* () {
    createMachine({
      types: {
        context: {} as { count: number }
      },
      context: {
        count: 0
      },
      on: {
        FOO: {
          actions: [
            'foo',
            assign(({ context }) => {
              ((_accept: number) => {})(context.count);
              // @ts-expect-error
              ((_accept: "ain't any") => {})(context.count);
              return {};
            })
          ]
        }
      }
    });
  }));

  // upstream: test/types.test.ts > actions > context should get inferred for a stop action used as an entry action
  it.effect('context should get inferred for a stop action used as an entry action', () => Effect.gen(function* () {
    const childMachine = createMachine({
      initial: 'idle',
      states: {
        idle: {}
      }
    });

    createMachine({
      types: {
        context: {} as {
          count: number;
          childRef: ActorRefFrom<typeof childMachine>;
        }
      },
      context: ({ spawn }) => ({
        count: 0,
        childRef: spawn(childMachine)
      }),
      entry: stopChild(({ context }) => {
        ((_accept: number) => {})(context.count);
        // @ts-expect-error
        ((_accept: "ain't any") => {})(context.count);
        return context.childRef;
      })
    });
  }));

  // upstream: test/types.test.ts > actions > context should get inferred for a stop action used as a transition action
  it.effect('context should get inferred for a stop action used as a transition action', () => Effect.gen(function* () {
    const childMachine = createMachine({
      initial: 'idle',
      states: {
        idle: {}
      }
    });

    createMachine({
      types: {
        context: {} as {
          count: number;
          childRef: ActorRefFrom<typeof childMachine>;
        }
      },
      context: ({ spawn }) => ({
        count: 0,
        childRef: spawn(childMachine)
      }),
      on: {
        FOO: {
          actions: stopChild(({ context }) => {
            ((_accept: number) => {})(context.count);
            // @ts-expect-error
            ((_accept: "ain't any") => {})(context.count);
            return context.childRef;
          })
        }
      }
    });
  }));

  // upstream: test/types.test.ts > actions > should report an error when the stop action returns an invalid actor ref
  it.effect('should report an error when the stop action returns an invalid actor ref', () => Effect.gen(function* () {
    createMachine({
      types: {
        context: {} as {
          count: number;
        }
      },
      context: {
        count: 0
      },
      entry: stopChild(
        // @ts-expect-error
        ({ context }) => {
          return context.count;
        }
      )
    });
  }));

  // upstream: test/types.test.ts > actions > context should get inferred for a stop actions within an array of entry actions
  it.effect('context should get inferred for a stop actions within an array of entry actions', () => Effect.gen(function* () {
    const childMachine = createMachine({});

    createMachine({
      types: {
        context: {} as {
          count: number;
          childRef: ActorRefFrom<typeof childMachine>;
          promiseRef: ActorRefFrom<PromiseActorLogic<string>>;
        }
      },
      context: ({ spawn }) => ({
        count: 0,
        childRef: spawn(childMachine),
        promiseRef: spawn(fromPromise(() => Promise.resolve('foo')))
      }),
      entry: [
        stopChild(({ context }) => {
          ((_accept: number) => {})(context.count);
          // @ts-expect-error
          ((_accept: "ain't any") => {})(context.count);
          return context.childRef;
        }),
        stopChild(({ context }) => {
          ((_accept: number) => {})(context.count);
          // @ts-expect-error
          ((_accept: "ain't any") => {})(context.count);
          return context.promiseRef;
        })
      ]
    });
  }));

  // upstream: test/types.test.ts > actions > should accept assign with partial static object
  it.effect('should accept assign with partial static object', () => Effect.gen(function* () {
    createMachine({
      types: {
        events: {} as {
          type: 'TOGGLE';
        },
        context: {} as {
          count: number;
          mode: 'foo' | 'bar' | null;
        }
      },
      context: {
        count: 0,
        mode: null
      },
      entry: assign({ mode: 'foo' })
    });
  }));

  // upstream: test/types.test.ts > actions > should provide context to single prop updater in assign when it's mixed with a static value for another prop
  it.effect("should provide context to single prop updater in assign when it's mixed with a static value for another prop", () => Effect.gen(function* () {
    createMachine({
      types: {
        context: {} as {
          count: number;
          skip: boolean;
        },
        events: {} as {
          type: 'TOGGLE';
        }
      },
      context: {
        count: 0,
        skip: true
      },
      entry: assign({
        count: ({ context }) => context.count + 1,
        skip: true
      })
    });
  }));

  // upstream: test/types.test.ts > actions > should allow a defined parameterized action with params
  it.effect('should allow a defined parameterized action with params', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        actions: { type: 'greet'; params: { name: string } } | { type: 'poke' };
      },
      entry: {
        type: 'greet',
        params: {
          name: 'David'
        }
      }
    });
  }));

  // upstream: test/types.test.ts > actions > should disallow a non-defined parameterized action
  it.effect('should disallow a non-defined parameterized action', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        actions: { type: 'greet'; params: { name: string } } | { type: 'poke' };
      },
      // @ts-expect-error
      entry: {
        type: 'other',
        params: {
          foo: 'bar'
        }
      }
    });
  }));

  // upstream: test/types.test.ts > actions > should disallow a defined parameterized action with invalid params
  it.effect('should disallow a defined parameterized action with invalid params', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        actions: { type: 'greet'; params: { name: string } } | { type: 'poke' };
      },
      entry: {
        type: 'greet',
        params: {
          // @ts-expect-error
          kick: 'start'
        }
      }
    });
  }));

  // upstream: test/types.test.ts > actions > should disallow a defined parameterized action when it lacks required params
  it.effect('should disallow a defined parameterized action when it lacks required params', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        actions: { type: 'greet'; params: { name: string } } | { type: 'poke' };
      },
      // @ts-expect-error
      entry: {
        type: 'greet',
        params: {}
      }
    });
  }));

  // upstream: test/types.test.ts > actions > should disallow a defined parameterized action with required params when it's referenced using a string
  it.effect("should disallow a defined parameterized action with required params when it's referenced using a string", () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        actions: { type: 'greet'; params: { name: string } } | { type: 'poke' };
      },
      // @ts-expect-error
      entry: 'greet'
    });
  }));

  // upstream: test/types.test.ts > actions > should allow a defined action when it has no params when it's referenced using a string
  it.effect("should allow a defined action when it has no params when it's referenced using a string", () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        actions: { type: 'greet'; params: { name: string } } | { type: 'poke' };
      },
      entry: 'poke'
    });
  }));

  // upstream: test/types.test.ts > actions > should allow a defined action when it has no params when it's referenced using an object
  it.effect("should allow a defined action when it has no params when it's referenced using an object", () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        actions: { type: 'greet'; params: { name: string } } | { type: 'poke' };
      },
      entry: {
        type: 'poke'
      }
    });
  }));

  // upstream: test/types.test.ts > actions > should allow a defined action without params when it only has optional params when it's referenced using a string
  it.effect("should allow a defined action without params when it only has optional params when it's referenced using a string", () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        actions:
          | { type: 'greet'; params: { name: string } }
          | { type: 'poke'; params?: { target: string } };
      },
      entry: {
        type: 'poke'
      }
    });
  }));

  // upstream: test/types.test.ts > actions > should allow a defined action without params when it only has optional params when it's referenced using an object
  it.effect("should allow a defined action without params when it only has optional params when it's referenced using an object", () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        actions:
          | { type: 'greet'; params: { name: string } }
          | { type: 'poke'; params?: { target: string } };
      },
      entry: {
        type: 'poke'
      }
    });
  }));

  // upstream: test/types.test.ts > actions > should type action params as undefined in inline custom action
  it.effect('should type action params as undefined in inline custom action', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        actions: { type: 'greet'; params: { name: string } } | { type: 'poke' };
      },
      entry: (_, params) => {
        ((_accept: undefined) => {})(params);
        // @ts-expect-error
        ((_accept: 'not any') => {})(params);
      }
    });
  }));

  // upstream: test/types.test.ts > actions > should type action params as undefined in inline builtin action
  it.effect('should type action params as undefined in inline builtin action', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        actions: { type: 'greet'; params: { name: string } } | { type: 'poke' };
      },
      entry: assign((_, params) => {
        ((_accept: undefined) => {})(params);
        // @ts-expect-error
        ((_accept: 'not any') => {})(params);
        return {};
      })
    });
  }));

  // upstream: test/types.test.ts > actions > should type action params as the specific defined params in the provided custom action
  it.effect('should type action params as the specific defined params in the provided custom action', () => Effect.gen(function* () {
    createMachine(
      {
        types: {} as {
          actions:
            | { type: 'greet'; params: { name: string } }
            | { type: 'poke' };
        }
      },
      {
        actions: {
          greet: (_, params) => {
            ((_accept: string) => {})(params.name);
            // @ts-expect-error
            ((_accept: 'not any') => {})(params.name);
          }
        }
      }
    );
  }));

  // upstream: test/types.test.ts > actions > should type action params as the specific defined params in the provided builtin action
  it.effect('should type action params as the specific defined params in the provided builtin action', () => Effect.gen(function* () {
    createMachine(
      {
        types: {} as {
          actions:
            | { type: 'greet'; params: { name: string } }
            | { type: 'poke' };
        }
      },
      {
        actions: {
          greet: assign((_, params) => {
            ((_accept: string) => {})(params.name);
            // @ts-expect-error
            ((_accept: 'not any') => {})(params.name);
            return {};
          })
        }
      }
    );
  }));

  // upstream: test/types.test.ts > actions > should not allow a provided action outside of the defined ones
  it.effect('should not allow a provided action outside of the defined ones', () => Effect.gen(function* () {
    createMachine(
      {
        types: {} as {
          actions:
            | { type: 'greet'; params: { name: string } }
            | { type: 'poke' };
        }
      },
      {
        actions: {
          // @ts-expect-error
          other: () => {}
        }
      }
    );
  }));

  // upstream: test/types.test.ts > actions > should allow dynamic params that return correct params type
  it.effect('should allow dynamic params that return correct params type', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        actions: { type: 'greet'; params: { name: string } } | { type: 'poke' };
      },
      entry: {
        type: 'greet',
        params: () => ({
          name: 'Anders'
        })
      }
    });
  }));

  // upstream: test/types.test.ts > actions > should disallow dynamic params that return invalid params type
  it.effect('should disallow dynamic params that return invalid params type', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        actions:
          | { type: 'greet'; params: { surname: string } }
          | { type: 'poke' };
      },
      // @ts-expect-error
      entry: {
        type: 'greet',
        params: () => ({
          surname: 100
        })
      }
    });
  }));

  // upstream: test/types.test.ts > actions > should provide context type to dynamic params
  it.effect('should provide context type to dynamic params', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        context: {
          count: number;
        };
        actions: { type: 'greet'; params: { name: string } } | { type: 'poke' };
      },
      context: { count: 1 },
      entry: {
        type: 'greet',
        params: ({ context }) => {
          ((_accept: number) => {})(context.count);
          // @ts-expect-error
          ((_accept: 'not any') => {})(context.count);
          return {
            name: 'Anders'
          };
        }
      }
    });
  }));

  // upstream: test/types.test.ts > actions > should provide narrowed down event type to dynamic params
  it.effect('should provide narrowed down event type to dynamic params', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        events: { type: 'FOO' } | { type: 'BAR' };
        actions: { type: 'greet'; params: { name: string } } | { type: 'poke' };
      },
      on: {
        FOO: {
          actions: {
            type: 'greet',
            params: ({ event }) => {
              ((_accept: 'FOO') => {})(event.type);
              // @ts-expect-error
              ((_accept: 'not any') => {})(event.type);
              return {
                name: 'Anders'
              };
            }
          }
        }
      }
    });
  }));
});

describe('enqueueActions', () => {
  // upstream: test/types.test.ts > enqueueActions > should be able to enqueue a defined parameterized action with required params
  it.effect('should be able to enqueue a defined parameterized action with required params', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        actions: { type: 'greet'; params: { name: string } } | { type: 'poke' };
      },
      entry: enqueueActions(({ enqueue }) => {
        enqueue({
          type: 'greet',
          params: {
            name: 'Anders'
          }
        });
      })
    });
  }));

  // upstream: test/types.test.ts > enqueueActions > should not allow to enqueue a defined parameterized action without all of its required params
  it.effect('should not allow to enqueue a defined parameterized action without all of its required params', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        actions: { type: 'greet'; params: { name: string } } | { type: 'poke' };
      },
      entry: enqueueActions(({ enqueue }) => {
        // @ts-expect-error
        enqueue({
          type: 'greet',
          params: {}
        });
      })
    });
  }));

  // upstream: test/types.test.ts > enqueueActions > should not be possible to enqueue a parameterized action outside of the defined ones
  it.effect('should not be possible to enqueue a parameterized action outside of the defined ones', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        actions: { type: 'greet'; params: { name: string } } | { type: 'poke' };
      },
      entry: enqueueActions(({ enqueue }) => {
        enqueue(
          // @ts-expect-error
          {
            type: 'other'
          }
        );
      })
    });
  }));

  // upstream: test/types.test.ts > enqueueActions > should be possible to enqueue a parameterized action with no required params using a string
  it.effect('should be possible to enqueue a parameterized action with no required params using a string', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        actions: { type: 'greet'; params: { name: string } } | { type: 'poke' };
      },
      entry: enqueueActions(({ enqueue }) => {
        enqueue('poke');
      })
    });
  }));

  // upstream: test/types.test.ts > enqueueActions > should be possible to enqueue a parameterized action with no required params using an object
  it.effect('should be possible to enqueue a parameterized action with no required params using an object', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        actions: { type: 'greet'; params: { name: string } } | { type: 'poke' };
      },
      entry: enqueueActions(({ enqueue }) => {
        enqueue({ type: 'poke' });
      })
    });
  }));

  // upstream: test/types.test.ts > enqueueActions > should be able to enqueue an inline custom action
  it.effect('should be able to enqueue an inline custom action', () => Effect.gen(function* () {
    createMachine(
      {
        types: {
          actions: {} as { type: 'foo' } | { type: 'bar' }
        }
      },
      {
        actions: {
          foo: enqueueActions(({ enqueue }) => {
            enqueue(() => {});
          })
        }
      }
    );
  }));

  // upstream: test/types.test.ts > enqueueActions > should allow a defined simple guard to be checked
  it.effect('should allow a defined simple guard to be checked', () => Effect.gen(function* () {
    createMachine(
      {
        types: {
          guards: {} as
            | {
                type: 'isGreaterThan';
                params: {
                  count: number;
                };
              }
            | { type: 'plainGuard' }
        }
      },
      {
        actions: {
          foo: enqueueActions(({ check }) => {
            check('plainGuard');
          })
        }
      }
    );
  }));

  // upstream: test/types.test.ts > enqueueActions > should allow a defined parameterized guard to be checked
  it.effect('should allow a defined parameterized guard to be checked', () => Effect.gen(function* () {
    createMachine(
      {
        types: {
          guards: {} as
            | {
                type: 'isGreaterThan';
                params: {
                  count: number;
                };
              }
            | { type: 'plainGuard' }
        }
      },
      {
        actions: {
          foo: enqueueActions(({ check }) => {
            check({
              type: 'isGreaterThan',
              params: {
                count: 10
              }
            });
          })
        }
      }
    );
  }));

  // upstream: test/types.test.ts > enqueueActions > should not allow a guard outside of the defined ones to be checked
  it.effect('should not allow a guard outside of the defined ones to be checked', () => Effect.gen(function* () {
    createMachine(
      {
        types: {
          guards: {} as
            | {
                type: 'isGreaterThan';
                params: {
                  count: number;
                };
              }
            | { type: 'plainGuard' }
        }
      },
      {
        actions: {
          foo: enqueueActions(({ check }) => {
            check(
              // @ts-expect-error
              'other'
            );
          })
        }
      }
    );
  }));

  // upstream: test/types.test.ts > enqueueActions > should type guard params as undefined in inline custom guard when enqueueActions is used in the config
  it.effect('should type guard params as undefined in inline custom guard when enqueueActions is used in the config', () => Effect.gen(function* () {
    createMachine({
      types: {
        guards: {} as
          | {
              type: 'isGreaterThan';
              params: {
                count: number;
              };
            }
          | { type: 'plainGuard' }
      },
      entry: enqueueActions(({ check }) => {
        check((_, params) => {
          params satisfies undefined;
          undefined satisfies typeof params;
          // @ts-expect-error
          params satisfies 'not any';

          return true;
        });
      })
    });
  }));

  // upstream: test/types.test.ts > enqueueActions > should type guard params as undefined in inline custom guard when enqueueActions is used in the implementations
  it.effect('should type guard params as undefined in inline custom guard when enqueueActions is used in the implementations', () => Effect.gen(function* () {
    createMachine(
      {
        types: {
          guards: {} as
            | {
                type: 'isGreaterThan';
                params: {
                  count: number;
                };
              }
            | { type: 'plainGuard' }
        }
      },
      {
        actions: {
          someGuard: enqueueActions(({ check }) => {
            check((_, params) => {
              params satisfies undefined;
              undefined satisfies typeof params;
              // @ts-expect-error
              params satisfies 'not any';

              return true;
            });
          })
        }
      }
    );
  }));

  // upstream: test/types.test.ts > enqueueActions > should be able to enqueue `raise` using its own action creator in a transition with one of the other accepted event types
  it.effect('should be able to enqueue `raise` using its own action creator in a transition with one of the other accepted event types', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        events:
          | {
              type: 'SOMETHING';
            }
          | {
              type: 'SOMETHING_ELSE';
            };
      },
      on: {
        SOMETHING: {
          actions: enqueueActions(({ enqueue }) => {
            enqueue(raise({ type: 'SOMETHING_ELSE' }));
          })
        }
      }
    });
  }));

  // upstream: test/types.test.ts > enqueueActions > should be able to enqueue `raise` using its bound action creator in a transition with one of the other accepted event types
  it.effect('should be able to enqueue `raise` using its bound action creator in a transition with one of the other accepted event types', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        events:
          | {
              type: 'SOMETHING';
            }
          | {
              type: 'SOMETHING_ELSE';
            };
      },
      on: {
        SOMETHING: {
          actions: enqueueActions(({ enqueue }) => {
            enqueue.raise({ type: 'SOMETHING_ELSE' });
          })
        }
      }
    });
  }));

  // upstream: test/types.test.ts > enqueueActions > should not be able to enqueue `raise` using its own action creator in a transition with an event type that is not defined
  it.effect('should not be able to enqueue `raise` using its own action creator in a transition with an event type that is not defined', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        events:
          | {
              type: 'SOMETHING';
            }
          | {
              type: 'SOMETHING_ELSE';
            };
      },
      on: {
        SOMETHING: {
          actions: enqueueActions(({ enqueue }) => {
            enqueue(
              raise({
                // @ts-expect-error
                type: 'OTHER'
              })
            );
          })
        }
      }
    });
  }));

  // upstream: test/types.test.ts > enqueueActions > should not be able to enqueue `raise` using its bound action creator in a transition with an event type that is not defined
  it.effect('should not be able to enqueue `raise` using its bound action creator in a transition with an event type that is not defined', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        events:
          | {
              type: 'SOMETHING';
            }
          | {
              type: 'SOMETHING_ELSE';
            };
      },
      on: {
        SOMETHING: {
          actions: enqueueActions(({ enqueue }) => {
            enqueue.raise({
              // @ts-expect-error
              type: 'OTHER'
            });
          })
        }
      }
    });
  }));
});

describe('input', () => {
  // upstream: test/types.test.ts > input > should provide the input type to the context factory
  it.effect('should provide the input type to the context factory', () => Effect.gen(function* () {
    createMachine({
      types: {
        input: {} as {
          count: number;
        }
      },
      context: ({ input }) => {
        ((_accept: number) => {})(input.count);
        // @ts-expect-error
        ((_accept: string) => {})(input.count);
        return {};
      }
    });
  }));

  // upstream: test/types.test.ts > input > should accept valid input type when interpreting an actor
  it.effect('should accept valid input type when interpreting an actor', () => Effect.gen(function* () {
    const machine = createMachine({
      types: {
        input: {} as {
          count: number;
        }
      }
    });

    (yield* createActor(machine, { input: { count: 100 } }));
  }));

  // upstream: test/types.test.ts > input > should reject invalid input type when interpreting an actor
  it.effect('should reject invalid input type when interpreting an actor', () => Effect.gen(function* () {
    const machine = createMachine({
      types: {
        input: {} as {
          count: number;
        }
      }
    });

    (yield* createActor(machine, {
      input: {
        // @ts-expect-error
        count: ''
      }
    }));
  }));

  // upstream: test/types.test.ts > input > should require input to be specified when defined
  it.effect('should require input to be specified when defined', () => Effect.gen(function* () {
    const machine = createMachine({
      types: {
        input: {} as {
          count: number;
        }
      }
    });

    // @ts-expect-error
    (yield* createActor(machine));
  }));

  // upstream: test/types.test.ts > input > should not require input when not defined
  it.effect('should not require input when not defined', () => Effect.gen(function* () {
    const machine = createMachine({
      types: {}
    });

    (yield* createActor(machine));
  }));
});

describe('guards', () => {
  // upstream: test/types.test.ts > guards > `not` guard should be accepted when it references another guard using a string
  it.effect('`not` guard should be accepted when it references another guard using a string', () => Effect.gen(function* () {
    createMachine(
      {
        id: 'b',
        types: {} as {
          events: { type: 'EVENT' };
        },
        on: {
          EVENT: {
            target: '#b',
            guard: not('falsy')
          }
        }
      },
      {
        guards: {
          falsy: () => false
        }
      }
    );
  }));

  // upstream: test/types.test.ts > guards > should allow a defined parameterized guard with params
  it.effect('should allow a defined parameterized guard with params', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        guards:
          | {
              type: 'isGreaterThan';
              params: {
                count: number;
              };
            }
          | { type: 'plainGuard' };
      },
      on: {
        EV: {
          guard: {
            type: 'isGreaterThan',
            params: {
              count: 10
            }
          }
        }
      }
    });
  }));

  // upstream: test/types.test.ts > guards > should disallow a non-defined parameterized guard
  it.effect('should disallow a non-defined parameterized guard', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        guards:
          | {
              type: 'isGreaterThan';
              params: {
                count: number;
              };
            }
          | { type: 'plainGuard' };
      },
      on: {
        EV: {
          guard: {
            type: 'other',
            // @ts-expect-error the port reports the unknown guard object at `params`, upstream at `EV` (ledger DEV-47, D15)
            params: {
              foo: 'bar'
            }
          }
        }
      }
    });
  }));

  // upstream: test/types.test.ts > guards > should disallow a defined parameterized guard with invalid params
  it.effect('should disallow a defined parameterized guard with invalid params', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        guards:
          | {
              type: 'isGreaterThan';
              params: {
                count: number;
              };
            }
          | { type: 'plainGuard' };
      },
      on: {
        // @ts-expect-error
        EV: {
          guard: {
            type: 'isGreaterThan',
            params: {
              count: 'bar'
            }
          }
        }
      }
    });
  }));

  // upstream: test/types.test.ts > guards > should disallow a defined parameterized guard when it lacks required params
  it.effect('should disallow a defined parameterized guard when it lacks required params', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        guards:
          | {
              type: 'isGreaterThan';
              params: {
                count: number;
              };
            }
          | { type: 'plainGuard' };
      },
      on: {
        // @ts-expect-error
        EV: {
          guard: {
            type: 'isGreaterThan',
            params: {}
          }
        }
      }
    });
  }));

  // upstream: test/types.test.ts > guards > should disallow a defined parameterized guard with required params when it's referenced using a string
  it.effect("should disallow a defined parameterized guard with required params when it's referenced using a string", () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        guards:
          | {
              type: 'isGreaterThan';
              params: {
                count: number;
              };
            }
          | { type: 'plainGuard' };
      },
      on: {
        // @ts-expect-error
        EV: {
          guard: 'isGreaterThan'
        }
      }
    });
  }));

  // upstream: test/types.test.ts > guards > should allow a defined guard when it has no params when it's referenced using a string
  it.effect("should allow a defined guard when it has no params when it's referenced using a string", () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        guards:
          | {
              type: 'isGreaterThan';
              params: {
                count: number;
              };
            }
          | { type: 'plainGuard' };
      },
      on: {
        EV: {
          guard: 'plainGuard'
        }
      }
    });
  }));

  // upstream: test/types.test.ts > guards > should allow a defined guard when it has no params when it's referenced using an object
  it.effect("should allow a defined guard when it has no params when it's referenced using an object", () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        guards:
          | {
              type: 'isGreaterThan';
              params: {
                count: number;
              };
            }
          | { type: 'plainGuard' };
      },
      on: {
        EV: {
          guard: {
            type: 'plainGuard'
          }
        }
      }
    });
  }));

  // upstream: test/types.test.ts > guards > should allow a defined guard without params when it only has optional params when it's referenced using a string
  it.effect("should allow a defined guard without params when it only has optional params when it's referenced using a string", () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        guards:
          | {
              type: 'isGreaterThan';
              params: {
                count: number;
              };
            }
          | { type: 'plainGuard'; params?: { foo: string } };
      },
      on: {
        EV: {
          guard: 'plainGuard'
        }
      }
    });
  }));

  // upstream: test/types.test.ts > guards > should allow a defined guard without params when it only has optional params when it's referenced using an object
  it.effect("should allow a defined guard without params when it only has optional params when it's referenced using an object", () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        guards:
          | {
              type: 'isGreaterThan';
              params: {
                count: number;
              };
            }
          | { type: 'plainGuard'; params?: { foo: string } };
      },
      on: {
        EV: {
          guard: {
            type: 'plainGuard'
          }
        }
      }
    });
  }));

  // upstream: test/types.test.ts > guards > should type guard params as undefined in inline custom guard
  it.effect('should type guard params as undefined in inline custom guard', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        guards:
          | {
              type: 'isGreaterThan';
              params: {
                count: number;
              };
            }
          | { type: 'plainGuard' };
      },
      on: {
        EV: {
          guard: (_, params) => {
            ((_accept: undefined) => {})(params);
            // @ts-expect-error
            ((_accept: 'not any') => {})(params);
            return true;
          }
        }
      }
    });
  }));

  // upstream: test/types.test.ts > guards > should type guard param as unknown in inline composite guard
  it.effect('should type guard param as unknown in inline composite guard', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        guards:
          | {
              type: 'isGreaterThan';
              params: {
                count: number;
              };
            }
          | { type: 'plainGuard' };
      },
      context: {
        counter: 0
      },
      on: {
        EV: {
          guard: not((_, params) => {
            params satisfies unknown;
            // @ts-expect-error
            params satisfies undefined;
            // @ts-expect-error
            params satisfies 'not any';
            return true;
          })
        }
      }
    });
  }));

  // upstream: test/types.test.ts > guards > should type guard params as the specific params in the provided custom guard
  it.effect('should type guard params as the specific params in the provided custom guard', () => Effect.gen(function* () {
    createMachine(
      {
        types: {} as {
          guards:
            | {
                type: 'isGreaterThan';
                params: {
                  count: number;
                };
              }
            | { type: 'plainGuard' };
        }
      },
      {
        guards: {
          isGreaterThan: (_, params) => {
            ((_accept: number) => {})(params.count);
            // @ts-expect-error
            ((_accept: 'not any') => {})(params);
            return true;
          }
        }
      }
    );
  }));

  // upstream: test/types.test.ts > guards > should not type guard params as the specific params in the provided composite guard
  it.effect('should not type guard params as the specific params in the provided composite guard', () => Effect.gen(function* () {
    createMachine(
      {
        types: {} as {
          guards:
            | {
                type: 'isGreaterThan';
                params: {
                  count: number;
                };
              }
            | { type: 'plainGuard' };
        },
        context: {
          count: 0
        }
      },
      {
        guards: {
          isGreaterThan: not((_, params) => {
            params satisfies unknown;
            // @ts-expect-error
            params satisfies undefined;
            // @ts-expect-error
            params satisfies { count: number };
            return true;
          })
        }
      }
    );
  }));

  // upstream: test/types.test.ts > guards > should not allow a provided guard outside of the defined ones
  it.effect('should not allow a provided guard outside of the defined ones', () => Effect.gen(function* () {
    createMachine(
      {
        types: {} as {
          guards:
            | {
                type: 'isGreaterThan';
                params: {
                  count: number;
                };
              }
            | { type: 'plainGuard' };
        }
      },
      {
        guards: {
          // @ts-expect-error
          other: () => true
        }
      }
    );
  }));

  // upstream: test/types.test.ts > guards > `not` should be allowed in the config argument when inline function gets passed to it
  it.effect('`not` should be allowed in the config argument when inline function gets passed to it', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        guards:
          | {
              type: 'isGreaterThan';
              params: {
                count: number;
              };
            }
          | { type: 'plainGuard' };
      },
      on: {
        EV: {
          guard: not(() => {
            return true;
          })
        }
      }
    });
  }));

  // upstream: test/types.test.ts > guards > `not` should be allowed in the implementations argument when inline function gets passed to it
  it.effect('`not` should be allowed in the implementations argument when inline function gets passed to it', () => Effect.gen(function* () {
    createMachine(
      {
        types: {} as {
          guards:
            | {
                type: 'isGreaterThan';
                params: {
                  count: number;
                };
              }
            | { type: 'plainGuard' };
        }
      },
      {
        guards: {
          isGreaterThan: not(() => {
            return true;
          })
        }
      }
    );
  }));

  // upstream: test/types.test.ts > guards > `stateIn` should be allowed in the config argument
  it.effect('`stateIn` should be allowed in the config argument', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        guards:
          | {
              type: 'isGreaterThan';
              params: {
                count: number;
              };
            }
          | { type: 'plainGuard' };
      },
      on: {
        EV: {
          guard: stateIn('foo')
        }
      }
    });
  }));

  // upstream: test/types.test.ts > guards > `stateIn` should be allowed in the implementations argument
  it.effect('`stateIn` should be allowed in the implementations argument', () => Effect.gen(function* () {
    createMachine(
      {
        types: {} as {
          guards:
            | {
                type: 'isGreaterThan';
                params: {
                  count: number;
                };
              }
            | { type: 'plainGuard' };
        }
      },
      {
        guards: {
          plainGuard: stateIn('foo')
        }
      }
    );
  }));

  // upstream: test/types.test.ts > guards > should allow dynamic params that return correct params type
  it.effect('should allow dynamic params that return correct params type', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        guards:
          | {
              type: 'isGreaterThan';
              params: {
                count: number;
              };
            }
          | { type: 'plainGuard' };
      },
      on: {
        FOO: {
          guard: {
            type: 'isGreaterThan',
            params: () => ({ count: 100 })
          }
        }
      }
    });
  }));

  // upstream: test/types.test.ts > guards > should disallow dynamic params that return invalid params type
  it.effect('should disallow dynamic params that return invalid params type', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        guards:
          | {
              type: 'isGreaterThan';
              params: {
                count: number;
              };
            }
          | { type: 'plainGuard' };
      },
      on: {
        // @ts-expect-error
        FOO: {
          guard: {
            type: 'isGreaterThan',
            params: () => ({ count: 'bazinga' })
          }
        }
      }
    });
  }));

  // upstream: test/types.test.ts > guards > should provide context type to dynamic params
  it.effect('should provide context type to dynamic params', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        context: {
          count: number;
        };
        guards:
          | {
              type: 'isGreaterThan';
              params: {
                count: number;
              };
            }
          | { type: 'plainGuard' };
      },
      context: { count: 1 },
      on: {
        FOO: {
          guard: {
            type: 'isGreaterThan',
            params: ({ context }) => {
              ((_accept: number) => {})(context.count);
              // @ts-expect-error
              ((_accept: 'not any') => {})(context.count);
              return {
                count: context.count
              };
            }
          }
        }
      }
    });
  }));

  // upstream: test/types.test.ts > guards > should provide narrowed down event type to dynamic params
  it.effect('should provide narrowed down event type to dynamic params', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        events: { type: 'FOO' } | { type: 'BAR' };
        guards:
          | {
              type: 'isGreaterThan';
              params: {
                count: number;
              };
            }
          | { type: 'plainGuard' };
      },
      on: {
        FOO: {
          guard: {
            type: 'isGreaterThan',
            params: ({ event }) => {
              ((_accept: 'FOO') => {})(event.type);
              // @ts-expect-error
              ((_accept: 'not any') => {})(event.type);
              return {
                count: 100
              };
            }
          }
        }
      }
    });
  }));
});

describe('delays', () => {
  // upstream: test/types.test.ts > delays > should accept a plain number as key of an after transitions object when delays are declared
  it.effect('should accept a plain number as key of an after transitions object when delays are declared', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        delays: 'one second' | 'one minute';
      },
      after: {
        100: {}
      }
    });
  }));

  // upstream: test/types.test.ts > delays > should accept a defined delay type as key of an after transitions object when delays are declared
  it.effect('should accept a defined delay type as key of an after transitions object when delays are declared', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        delays: 'one second' | 'one minute';
      },
      after: {
        'one second': {}
      }
    });
  }));

  // upstream: test/types.test.ts > delays > should reject delay as key of an after transitions object if it's outside of the defined ones
  it.effect(`should reject delay as key of an after transitions object if it's outside of the defined ones`, () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        delays: 'one second' | 'one minute';
      },
      after: {
        // @ts-expect-error
        'unknown delay': {}
      }
    });
  }));

  // upstream: test/types.test.ts > delays > should accept a plain number as delay in `raise` when delays are declared
  it.effect('should accept a plain number as delay in `raise` when delays are declared', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        delays: 'one second' | 'one minute';
      },
      entry: raise({ type: 'FOO' }, { delay: 100 })
    });
  }));

  // upstream: test/types.test.ts > delays > should accept a defined delay in `raise`
  it.effect('should accept a defined delay in `raise`', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        delays: 'one second' | 'one minute';
      },
      entry: raise({ type: 'FOO' }, { delay: 'one minute' })
    });
  }));

  // upstream: test/types.test.ts > delays > should reject a delay outside of the defined ones in `raise`
  it.effect('should reject a delay outside of the defined ones in `raise`', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        delays: 'one second' | 'one minute';
      },

      entry: raise(
        { type: 'FOO' },
        {
          // @ts-expect-error
          delay: 'unknown delay'
        }
      )
    });
  }));

  // upstream: test/types.test.ts > delays > should accept a plain number as delay in `sendTo` when delays are declared
  it.effect('should accept a plain number as delay in `sendTo` when delays are declared', () => Effect.gen(function* () {
    const otherActor = (yield* createActor(createMachine({})));

    createMachine({
      types: {} as {
        delays: 'one second' | 'one minute';
      },
      entry: sendTo(otherActor, { type: 'FOO' }, { delay: 100 })
    });
  }));

  // upstream: test/types.test.ts > delays > should accept a defined delay in `sendTo`
  it.effect('should accept a defined delay in `sendTo`', () => Effect.gen(function* () {
    const otherActor = (yield* createActor(createMachine({})));

    createMachine({
      types: {} as {
        delays: 'one second' | 'one minute';
      },
      entry: sendTo(otherActor, { type: 'FOO' }, { delay: 'one minute' })
    });
  }));

  // upstream: test/types.test.ts > delays > should reject a delay outside of the defined ones in `sendTo`
  it.effect('should reject a delay outside of the defined ones in `sendTo`', () => Effect.gen(function* () {
    const otherActor = (yield* createActor(createMachine({})));

    createMachine({
      types: {} as {
        delays: 'one second' | 'one minute';
      },

      entry: sendTo(
        otherActor,
        { type: 'FOO' },
        {
          // @ts-expect-error
          delay: 'unknown delay'
        }
      )
    });
  }));

  // upstream: test/types.test.ts > delays > should accept a plain number as delay in `raise` in `enqueueActions` when delays are declared
  it.effect('should accept a plain number as delay in `raise` in `enqueueActions` when delays are declared', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        delays: 'one second' | 'one minute';
      },
      entry: enqueueActions(({ enqueue }) => {
        enqueue.raise({ type: 'FOO' }, { delay: 100 });
      })
    });
  }));

  // upstream: test/types.test.ts > delays > should accept a defined delay in `raise` in `enqueueActions`
  it.effect('should accept a defined delay in `raise` in `enqueueActions`', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        delays: 'one second' | 'one minute';
      },
      entry: enqueueActions(({ enqueue }) => {
        enqueue.raise({ type: 'FOO' }, { delay: 'one minute' });
      })
    });
  }));

  // upstream: test/types.test.ts > delays > should reject a delay outside of the defined ones in `raise` in `enqueueActions`
  it.effect('should reject a delay outside of the defined ones in `raise` in `enqueueActions`', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        delays: 'one second' | 'one minute';
      },
      entry: enqueueActions(({ enqueue }) => {
        enqueue.raise(
          { type: 'FOO' },
          {
            // @ts-expect-error
            delay: 'unknown delay'
          }
        );
      })
    });
  }));

  // upstream: test/types.test.ts > delays > should accept any delay string when no explicit delays are defined
  it.effect('should accept any delay string when no explicit delays are defined', () => Effect.gen(function* () {
    createMachine({
      after: {
        just_any_delay: {}
      }
    });
  }));
});

describe('tags', () => {
  // upstream: test/types.test.ts > tags > should allow a defined tag when it's set using a string
  it.effect(`should allow a defined tag when it's set using a string`, () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        tags: 'pending' | 'success' | 'error';
      },
      tags: 'pending'
    });
  }));

  // upstream: test/types.test.ts > tags > should allow a defined tag when it's set using an array
  it.effect(`should allow a defined tag when it's set using an array`, () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        tags: 'pending' | 'success' | 'error';
      },
      tags: ['pending']
    });
  }));

  // upstream: test/types.test.ts > tags > should not allow a tag outside of the defined ones when it's set using a string
  it.effect(`should not allow a tag outside of the defined ones when it's set using a string`, () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        tags: 'pending' | 'success' | 'error';
      },
      // @ts-expect-error
      tags: 'other'
    });
  }));

  // upstream: test/types.test.ts > tags > should not allow a tag outside of the defined ones when it's set using an array
  it.effect(`should not allow a tag outside of the defined ones when it's set using an array`, () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        tags: 'pending' | 'success' | 'error';
      },
      tags: [
        // @ts-expect-error
        'other'
      ]
    });
  }));

  // upstream: test/types.test.ts > tags > `hasTag` should allow checking a defined tag
  it.effect('`hasTag` should allow checking a defined tag', () => Effect.gen(function* () {
    const machine = createMachine({
      types: {} as {
        tags: 'a' | 'b' | 'c';
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actor.getSnapshot).hasTag('a');
  }));

  // upstream: test/types.test.ts > tags > `hasTag` should not allow checking a tag outside of the defined ones
  it.effect('`hasTag` should not allow checking a tag outside of the defined ones', () => Effect.gen(function* () {
    const machine = createMachine({
      types: {} as {
        tags: 'a' | 'b' | 'c';
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    // @ts-expect-error
    (yield* actor.getSnapshot).hasTag('other');
  }));
});

describe('fromCallback', () => {
  // upstream: test/types.test.ts > fromCallback > should reject a start callback that returns an explicit promise
  it.effect('should reject a start callback that returns an explicit promise', () => Effect.gen(function* () {
    createMachine({
      invoke: {
        src: fromCallback(
          // @ts-ignore
          () => {
            return new Promise(() => {});
          }
        )
      }
    });
  }));

  // upstream: test/types.test.ts > fromCallback > should reject a start callback that is an async function
  it.effect('should reject a start callback that is an async function', () => Effect.gen(function* () {
    // it's important to not give a false impression that we support returning promises from this setup as we supported that in the past
    // the problem is that people could accidentally~ use an async function for convenience purposes
    // then we'd listen for the promise to resolve and cleanup that actor, closing the communication channel between parent and the child
    //
    // fromCallback(async ({ sendBack }) => {
    //   const api = await getSomeWebApi(); // async function was used to conveniently use `await` here
    //
    //   // this didn't work as expected because this promise was completing almost asap
    //   // so the parent was never able to receive those events sent to it
    //   api.addEventListener('some_event', () => sendBack({ type: 'EV' }))
    //
    //   // implicit completion
    // })
    createMachine({
      invoke: {
        src: fromCallback(
          // @ts-ignore
          async () => {}
        )
      }
    });
  }));

  // upstream: test/types.test.ts > fromCallback > should reject a start callback that returns a non-function and non-undefined value
  it.effect('should reject a start callback that returns a non-function and non-undefined value', () => Effect.gen(function* () {
    createMachine({
      invoke: {
        src: fromCallback(
          // @ts-ignore
          () => {
            return 42;
          }
        )
      }
    });
  }));

  // upstream: test/types.test.ts > fromCallback > should allow returning an implicit undefined from the start callback
  it.effect('should allow returning an implicit undefined from the start callback', () => Effect.gen(function* () {
    createMachine({
      invoke: {
        src: fromCallback(() => {})
      }
    });
  }));

  // upstream: test/types.test.ts > fromCallback > should allow returning an explicit undefined from the start callback
  it.effect('should allow returning an explicit undefined from the start callback', () => Effect.gen(function* () {
    createMachine({
      invoke: {
        src: fromCallback(() => {
          return undefined;
        })
      }
    });
  }));

  // upstream: test/types.test.ts > fromCallback > should allow returning a cleanup function the start callback
  it.effect('should allow returning a cleanup function the start callback', () => Effect.gen(function* () {
    createMachine({
      invoke: {
        src: fromCallback(() => {
          return undefined;
        })
      }
    });
  }));
});

describe('self', () => {
  // `self.send` and `self.getSnapshot` are Effects (D6) and these actions are synchronous, so
  // an action forks the send (a send from inside the actor enqueues, SD-23) and reads the
  // snapshot with `Effect.runSync`, as the invoke rewrite does.

  // upstream: test/types.test.ts > self > should accept correct event types in an inline entry custom action
  it.effect('should accept correct event types in an inline entry custom action', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        events: { type: 'FOO' } | { type: 'BAR' };
      },
      entry: ({ self }) => {
        Effect.runFork(self.send({ type: 'FOO' }));
        Effect.runFork(self.send({ type: 'BAR' }));
        // @ts-expect-error
        Effect.runFork(self.send({ type: 'BAZ' }));
      }
    });
  }));

  // upstream: test/types.test.ts > self > should accept correct event types in an inline entry builtin action
  it.effect('should accept correct event types in an inline entry builtin action', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        events: { type: 'FOO' } | { type: 'BAR' };
      },
      entry: assign(({ self }) => {
        Effect.runFork(self.send({ type: 'FOO' }));
        Effect.runFork(self.send({ type: 'BAR' }));
        // @ts-expect-error
        Effect.runFork(self.send({ type: 'BAZ' }));
        return {};
      })
    });
  }));

  // upstream: test/types.test.ts > self > should accept correct event types in an inline transition custom action
  it.effect('should accept correct event types in an inline transition custom action', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        events: { type: 'FOO' } | { type: 'BAR' };
      },
      on: {
        FOO: {
          actions: ({ self }) => {
            Effect.runFork(self.send({ type: 'FOO' }));
            Effect.runFork(self.send({ type: 'BAR' }));
            // @ts-expect-error
            Effect.runFork(self.send({ type: 'BAZ' }));
          }
        }
      }
    });
  }));

  // upstream: test/types.test.ts > self > should accept correct event types in an inline transition builtin action
  it.effect('should accept correct event types in an inline transition builtin action', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        events: { type: 'FOO' } | { type: 'BAR' };
      },
      on: {
        FOO: {
          actions: assign(({ self }) => {
            Effect.runFork(self.send({ type: 'FOO' }));
            Effect.runFork(self.send({ type: 'BAR' }));
            // @ts-expect-error
            Effect.runFork(self.send({ type: 'BAZ' }));
            return {};
          })
        }
      }
    });
  }));

  // upstream: test/types.test.ts > self > should return correct snapshot in an inline entry custom action
  it.effect('should return correct snapshot in an inline entry custom action', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        context: { count: number };
      },
      context: { count: 0 },
      entry: ({ self }) => {
        ((_accept: number) => {})(Effect.runSync(self.getSnapshot).context.count);
        // @ts-expect-error
        ((_accept: string) => {})(Effect.runSync(self.getSnapshot).context.count);
      }
    });
  }));

  // upstream: test/types.test.ts > self > should return correct snapshot in an inline entry builtin action
  it.effect('should return correct snapshot in an inline entry builtin action', () => Effect.gen(function* () {
    createMachine({
      types: {} as {
        context: { count: number };
      },
      context: { count: 0 },
      entry: assign(({ self }) => {
        ((_accept: number) => {})(Effect.runSync(self.getSnapshot).context.count);
        // @ts-expect-error
        ((_accept: string) => {})(Effect.runSync(self.getSnapshot).context.count);
        return {};
      })
    });
  }));
});

describe('createActor', () => {
  // upstream: test/types.test.ts > createActor > should require input to be specified when it is required
  it.effect(`should require input to be specified when it is required`, () => Effect.gen(function* () {
    const logic = fromPromise(({}: { input: number }) => Promise.resolve(100));

    // @ts-expect-error
    (yield* createActor(logic));
  }));

  // upstream: test/types.test.ts > createActor > should not require input when it's optional
  it.effect(`should not require input when it's optional`, () => Effect.gen(function* () {
    const logic = fromPromise(({}: { input: number | undefined }) =>
      Promise.resolve(100)
    );

    (yield* createActor(logic));
  }));
});

describe('snapshot methods', () => {
  // upstream: test/types.test.ts > snapshot methods > should type infer actor union snapshot methods
  it.effect('should type infer actor union snapshot methods', () => Effect.gen(function* () {
    const typeOne = setup({
      types: {} as {
        events: { type: 'one' };
        tags: 'one';
      }
    }).createMachine({
      initial: 'one',
      states: {
        one: {}
      }
    });
    type TypeOneRef = ActorRefFrom<typeof typeOne>;

    const typeTwo = setup({
      types: {} as {
        events: { type: 'one' } | { type: 'two' };
        tags: 'one' | 'two';
      }
    }).createMachine({
      initial: 'one',
      states: {
        one: {},
        two: {}
      }
    });
    type TypeTwoRef = ActorRefFrom<typeof typeTwo>;

    const ref = (yield* createActor(typeTwo)) as TypeOneRef | TypeTwoRef;
    const snapshot = (yield* ref.getSnapshot);

    (yield* snapshot.can({ type: 'one' }));
    // @ts-expect-error
    (yield* snapshot.can({ type: 'two' }));
    // @ts-expect-error
    (yield* snapshot.can({ type: 'three' }));

    snapshot.hasTag('one');
    // @ts-expect-error
    snapshot.hasTag('two');
    // @ts-expect-error
    snapshot.hasTag('three');

    snapshot.matches('one');
    // @ts-expect-error
    snapshot.matches('two');
    // @ts-expect-error
    snapshot.matches('three');

    snapshot.getMeta();
    snapshot.toJSON();
  }));
});

// https://github.com/statelyai/xstate/issues/4931
// upstream: test/types.test.ts > fromPromise should not have issues with actors with emitted types
it.effect('fromPromise should not have issues with actors with emitted types', () => Effect.gen(function* () {
  const machine = setup({
    types: {
      emitted: {} as { type: 'FOO' }
    }
  }).createMachine({});

  const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

  // `toPromise` is `toEffect` (DEV-21). Upstream never awaits the promise and the machine never
  // finishes, so the wait runs in a fiber that the test's scope interrupts
  yield* Effect.forkScoped(toEffect(actor));
}));

// upstream: test/types.test.ts > UnknownActorRef should return a Snapshot-typed value from getSnapshot()
it.effect('UnknownActorRef should return a Snapshot-typed value from getSnapshot()', () => Effect.gen(function* () {
  const actor: UnknownActorRef = (yield* createEmptyActor());

  // @ts-expect-error
  (yield* actor.getSnapshot).status === 'FOO';
}));

// upstream: test/types.test.ts > Actor<T> should be assignable to ActorRefFromLogic<T>
it.effect('Actor<T> should be assignable to ActorRefFromLogic<T>', () => Effect.gen(function* () {
  const logic = createMachine({});

  // `createActor` returns an Effect (D6) and a constructor cannot run one, so the class gets a
  // static factory that creates the actor, keeps the upstream assignability check and then
  // calls the constructor
  class ActorThing<T extends AnyActorLogic> {
    actorRef: ActorRefFromLogic<T>;
    constructor(actorRef: ActorRefFromLogic<T>) {
      this.actorRef = actorRef;
    }

    static make<T extends AnyActorLogic>(actorLogic: T) {
      return Effect.gen(function* () {
        const actor = yield* createActor(actorLogic);

        actor satisfies ActorRefFromLogic<typeof actorLogic>;
        return new ActorThing<T>(actor);
      });
    }
  }

  yield* ActorThing.make(logic);
}));

// upstream: test/types.test.ts > AnyStateNode should keep the state nodes of an AnyStateMachine unwidened
it.effect('AnyStateNode should keep the state nodes of an AnyStateMachine unwidened', () => Effect.gen(function* () {
  // Assignability cannot express this: `any` assigns in both directions, so a state node
  // read off an `AnyStateMachine` satisfies `AnyStateNode` either way. What differs is
  // whether the meta parameters stay `any` — if they fall back to their `MetaObject`
  // default, tooling that tracks `any` (such as `@typescript-eslint`) reports every such
  // node as an unsafe argument.
  type IsAny<T> = 0 extends 1 & T ? true : false;
  type MetaOf<T> = T extends { meta?: infer TMeta } ? TMeta : never;

  const machineNodeMetaIsAny: IsAny<MetaOf<AnyStateMachine['root']>> = true;
  const anyStateNodeMetaIsAny: IsAny<MetaOf<AnyStateNode>> = true;
  const anyStateNodeDefinitionMetaIsAny: IsAny<MetaOf<AnyStateNodeDefinition>> =
    true;

  // Both aliases pass `any` to the transition metadata parameter as well, which is a
  // separate slot rather than a fallback to `TStateMeta` once it is written explicitly.
  const anyStateNodeTransitionMetaIsAny: IsAny<
    MetaOf<AnyStateNode['definition']['transitions'][number]>
  > = true;
  const anyStateNodeDefinitionTransitionMetaIsAny: IsAny<
    MetaOf<AnyStateNodeDefinition['transitions'][number]>
  > = true;

  machineNodeMetaIsAny satisfies true;
  anyStateNodeMetaIsAny satisfies true;
  anyStateNodeDefinitionMetaIsAny satisfies true;
  anyStateNodeTransitionMetaIsAny satisfies true;
  anyStateNodeDefinitionTransitionMetaIsAny satisfies true;
}));

// upstream: test/types.test.ts > generic graph and snapshot containers preserve any metadata
it.effect('generic graph and snapshot containers preserve any metadata', () => Effect.gen(function* () {
  // The type imports name the port's modules: `../src` is the root entry, `../src/graph` the
  // `./graph` entry (D10), `../src/stateUtils` the port's `stateUtils`, and `../src/utils`
  // `StateMachine`, the module that holds the port's `normalizeTarget`
  type IsAny<T> = 0 extends 1 & T ? true : false;
  type NodeMetaIsAny<T extends import('../../src/index.js').AnyStateNode> = [
    IsAny<T['meta']>,
    IsAny<T['definition']['transitions'][number]['meta']>
  ];

  // Ordinary assignability cannot catch this regression: any assigns both ways.
  const history: NodeMetaIsAny<
    import('../../src/index.js').AnyHistoryValue[string][number]
  > = [true, true];
  const config: NodeMetaIsAny<
    import('../../src/index.js').AnyStateConfig['_nodes'][number]
  > = [true, true];
  const snapshot: NodeMetaIsAny<
    import('../../src/index.js').AnyMachineSnapshot['_nodes'][number]
  > = [true, true];
  const graphNode: NodeMetaIsAny<
    import('../../src/graph/index.js').DirectedGraphNode['stateNode']
  > = [true, true];
  const graphTransition: IsAny<
    import('../../src/graph/index.js').DirectedGraphEdge['transition']['meta']
  > = true;
  const transitions: IsAny<
    import('../../src/index.js').Transitions<any, any>[number]['meta']
  > = true;
  const iterable: NodeMetaIsAny<
    Parameters<
      typeof import('../../src/stateUtils.js').getStateValue
    >[1] extends Iterable<infer T>
      ? T
      : never
  > = [true, true];
  const historyNode: NodeMetaIsAny<import('../../src/index.js').HistoryStateNode<any>> = [
    true,
    true
  ];
  const normalized: NodeMetaIsAny<
    Exclude<
      NonNullable<
        ReturnType<typeof import('../../src/StateMachine.js').normalizeTarget>
      >[number],
      string
    >
  > = [true, true];
  const formatted: IsAny<
    // The port's formatTransitions gives the upstream Map's entries in its order (SD-22,
    // amended 2026-10-08): the check reads the transitions of an entry
    ReturnType<
      typeof import('../../src/stateUtils.js').formatTransitions
    > extends Array<[string, (infer T)[]]>
      ? T extends { meta?: infer M }
        ? M
        : never
      : never
  > = true;
  const transitioned: IsAny<
    NonNullable<
      // The port's transitionNode gives an Effect of upstream's result, as it runs the guards
      // that select the transitions (SD-13; ledger DEV-48): the check reads the result inside it
      Effect.Success<ReturnType<typeof import('../../src/stateUtils.js').transitionNode>>
    >[number]['meta']
  > = true;
  const candidates: IsAny<
    ReturnType<typeof import('../../src/stateUtils.js').getCandidates>[number]['meta']
  > = true;
  const delayed: IsAny<
    ReturnType<
      typeof import('../../src/stateUtils.js').getDelayedTransitions
    >[number]['meta']
  > = true;

  expect(
    [
      history,
      config,
      snapshot,
      graphNode,
      graphTransition,
      transitions,
      iterable,
      historyNode,
      normalized,
      formatted,
      transitioned,
      candidates,
      delayed
    ]
      .flat()
      .every(Boolean)
  ).toBe(true);
}));
