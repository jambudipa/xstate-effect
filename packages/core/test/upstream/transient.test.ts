import { describe, expect, it, vi } from "@effect/vitest"
import { Effect, Exit, Stream } from "effect"
import { createMachine, createActor } from "../../src/index.js";
import { raise } from "../../src/index.js";
import { assign } from "../../src/index.js";
import { stateIn } from "../../src/index.js";

const greetingContext = { hour: 10 };
const greetingMachine = createMachine({
  types: {} as { context: typeof greetingContext },
  id: 'greeting',
  initial: 'pending',
  context: greetingContext,
  states: {
    pending: {
      always: [
        { target: 'morning', guard: ({ context }) => context.hour < 12 },
        { target: 'afternoon', guard: ({ context }) => context.hour < 18 },
        { target: 'evening' }
      ]
    },
    morning: {},
    afternoon: {},
    evening: {}
  },
  on: {
    CHANGE: { actions: assign({ hour: 20 }) },
    RECHECK: '#greeting'
  }
});

describe('transient states (eventless transitions)', () => {
  // upstream: test/transient.test.ts > transient states (eventless transitions) > should choose the first candidate target that matches the guard 1
  it.effect('should choose the first candidate target that matches the guard 1', () => Effect.gen(function* () {
    const machine = createMachine({
      types: {} as { context: { data: boolean } },
      context: { data: false },
      initial: 'G',
      states: {
        G: {
          on: { UPDATE_BUTTON_CLICKED: 'E' }
        },
        E: {
          always: [
            { target: 'D', guard: ({ context: { data } }) => !data },
            { target: 'F' }
          ]
        },
        D: {},
        F: {}
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'UPDATE_BUTTON_CLICKED' }));

    expect((yield* actorRef.getSnapshot).value).toEqual('D');
  }));

  // upstream: test/transient.test.ts > transient states (eventless transitions) > should choose the first candidate target that matches the guard 2
  it.effect('should choose the first candidate target that matches the guard 2', () => Effect.gen(function* () {
    const machine = createMachine({
      types: {} as { context: { data: boolean; status?: string } },
      context: { data: false },
      initial: 'G',
      states: {
        G: {
          on: { UPDATE_BUTTON_CLICKED: 'E' }
        },
        E: {
          always: [
            { target: 'D', guard: ({ context: { data } }) => !data },
            { target: 'F', guard: () => true }
          ]
        },
        D: {},
        F: {}
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'UPDATE_BUTTON_CLICKED' }));

    expect((yield* actorRef.getSnapshot).value).toEqual('D');
  }));

  // upstream: test/transient.test.ts > transient states (eventless transitions) > should choose the final candidate without a guard if none others match
  it.effect('should choose the final candidate without a guard if none others match', () => Effect.gen(function* () {
    const machine = createMachine({
      types: {} as { context: { data: boolean; status?: string } },
      context: { data: true },
      initial: 'G',
      states: {
        G: {
          on: { UPDATE_BUTTON_CLICKED: 'E' }
        },
        E: {
          always: [
            { target: 'D', guard: ({ context: { data } }) => !data },
            { target: 'F' }
          ]
        },
        D: {},
        F: {}
      }
    });
    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'UPDATE_BUTTON_CLICKED' }));

    expect((yield* actorRef.getSnapshot).value).toEqual('F');
  }));

  // upstream: test/transient.test.ts > transient states (eventless transitions) > should carry actions from previous transitions within same step
  it.effect('should carry actions from previous transitions within same step', () => Effect.gen(function* () {
    const actual: string[] = [];
    const machine = createMachine({
      initial: 'A',
      states: {
        A: {
          exit: () => actual.push('exit_A'),
          on: {
            TIMER: {
              target: 'T',
              actions: () => actual.push('timer')
            }
          }
        },
        T: {
          always: [{ target: 'B' }]
        },
        B: {
          entry: () => actual.push('enter_B')
        }
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actor.send({ type: 'TIMER' }));

    expect(actual).toEqual(['exit_A', 'timer', 'enter_B']);
  }));

  // upstream: test/transient.test.ts > transient states (eventless transitions) > should execute all internal events one after the other
  it.effect('should execute all internal events one after the other', () => Effect.gen(function* () {
    const machine = createMachine({
      type: 'parallel',
      states: {
        A: {
          initial: 'A1',
          states: {
            A1: {
              on: {
                E: 'A2'
              }
            },
            A2: {
              entry: raise({ type: 'INT1' })
            }
          }
        },

        B: {
          initial: 'B1',
          states: {
            B1: {
              on: {
                E: 'B2'
              }
            },
            B2: {
              entry: raise({ type: 'INT2' })
            }
          }
        },

        C: {
          initial: 'C1',
          states: {
            C1: {
              on: {
                INT1: 'C2',
                INT2: 'C3'
              }
            },
            C2: {
              on: {
                INT2: 'C4'
              }
            },
            C3: {
              on: {
                INT1: 'C4'
              }
            },
            C4: {}
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'E' }));

    expect((yield* actorRef.getSnapshot).value).toEqual({ A: 'A2', B: 'B2', C: 'C4' });
  }));

  // upstream: test/transient.test.ts > transient states (eventless transitions) > should execute all eventless transitions in the same microstep
  it.effect('should execute all eventless transitions in the same microstep', () => Effect.gen(function* () {
    const machine = createMachine({
      type: 'parallel',
      states: {
        A: {
          initial: 'A1',
          states: {
            A1: {
              on: {
                E: 'A2' // the external event
              }
            },
            A2: {
              always: 'A3'
            },
            A3: {
              always: {
                target: 'A4',
                guard: stateIn({ B: 'B3' })
              }
            },
            A4: {}
          }
        },

        B: {
          initial: 'B1',
          states: {
            B1: {
              on: {
                E: 'B2'
              }
            },
            B2: {
              always: {
                target: 'B3',
                guard: stateIn({ A: 'A2' })
              }
            },
            B3: {
              always: {
                target: 'B4',
                guard: stateIn({ A: 'A3' })
              }
            },
            B4: {}
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'E' }));

    expect((yield* actorRef.getSnapshot).value).toEqual({ A: 'A4', B: 'B4' });
  }));

  // upstream: test/transient.test.ts > transient states (eventless transitions) > should check for automatic transitions even after microsteps are done
  it.effect('should check for automatic transitions even after microsteps are done', () => Effect.gen(function* () {
    const machine = createMachine({
      type: 'parallel',
      states: {
        A: {
          initial: 'A1',
          states: {
            A1: {
              on: {
                A: 'A2'
              }
            },
            A2: {}
          }
        },
        B: {
          initial: 'B1',
          states: {
            B1: {
              always: {
                target: 'B2',
                guard: stateIn({ A: 'A2' })
              }
            },
            B2: {}
          }
        },
        C: {
          initial: 'C1',
          states: {
            C1: {
              always: {
                target: 'C2',
                guard: stateIn({ A: 'A2' })
              }
            },
            C2: {}
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'A' }));

    expect((yield* actorRef.getSnapshot).value).toEqual({ A: 'A2', B: 'B2', C: 'C2' });
  }));

  // upstream: test/transient.test.ts > transient states (eventless transitions) > should determine the resolved initial state from the transient state
  it.effect('should determine the resolved initial state from the transient state', () => Effect.gen(function* () {
    expect((yield* (yield* createActor(greetingMachine)).getSnapshot).value).toEqual('morning');
  }));

  // upstream: test/transient.test.ts > transient states (eventless transitions) > should determine the resolved state from an initial transient state
  it.effect('should determine the resolved state from an initial transient state', () => Effect.gen(function* () {
    const actorRef = (yield* Effect.tap(createActor(greetingMachine), (a) => a.start));

    (yield* actorRef.send({ type: 'CHANGE' }));
    expect((yield* actorRef.getSnapshot).value).toEqual('morning');

    (yield* actorRef.send({ type: 'RECHECK' }));
    expect((yield* actorRef.getSnapshot).value).toEqual('evening');
  }));

  // upstream: test/transient.test.ts > transient states (eventless transitions) > should select eventless transition before processing raised events
  it.effect('should select eventless transition before processing raised events', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            FOO: 'b'
          }
        },
        b: {
          entry: raise({ type: 'BAR' }),
          always: 'c',
          on: {
            BAR: 'd'
          }
        },
        c: {
          on: {
            BAR: 'e'
          }
        },
        d: {},
        e: {}
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'FOO' }));

    expect((yield* actorRef.getSnapshot).value).toBe('e');
  }));

  // upstream: test/transient.test.ts > transient states (eventless transitions) > should not select wildcard for eventless transition
  it.effect('should not select wildcard for eventless transition', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: { FOO: 'b' }
        },
        b: {
          always: 'pass',
          on: {
            '*': 'fail'
          }
        },
        fail: {},
        pass: {}
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'FOO' }));

    expect((yield* actorRef.getSnapshot).value).toBe('pass');
  }));

  // upstream: test/transient.test.ts > transient states (eventless transitions) > should work with transient transition on root
  it.effect('should work with transient transition on root', () => Effect.gen(function* () {
    const machine = createMachine({
      types: {} as { context: { count: number } },
      id: 'machine',
      initial: 'first',
      context: { count: 0 },
      states: {
        first: {
          on: {
            ADD: {
              actions: assign({ count: ({ context }) => context.count + 1 })
            }
          }
        },
        success: {
          type: 'final'
        }
      },
      always: [
        {
          target: '.success',
          guard: ({ context }) => {
            return context.count > 0;
          }
        }
      ]
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'ADD' }));

    expect((yield* actorRef.getSnapshot).status).toBe('done');
  }));

  // upstream: test/transient.test.ts > transient states (eventless transitions) > shouldn't crash when invoking a machine with initial transient transition depending on custom data
  it.effect("shouldn't crash when invoking a machine with initial transient transition depending on custom data", () => Effect.gen(function* () {
    const timerMachine = createMachine({
      initial: 'initial',
      context: ({ input }: { input: { duration: number } }) => ({
        duration: input.duration
      }),
      types: {
        context: {} as { duration: number }
      },
      states: {
        initial: {
          always: [
            {
              target: `finished`,
              guard: ({ context }) => context.duration < 1000
            },
            {
              target: `active`
            }
          ]
        },
        active: {},
        finished: { type: 'final' }
      }
    });

    const machine = createMachine({
      initial: 'active',
      context: {
        customDuration: 3000
      },
      states: {
        active: {
          invoke: {
            src: timerMachine,
            input: ({ context }) => ({
              duration: context.customDuration
            })
          }
        }
      }
    });

    const actorRef = (yield* createActor(machine));
    // upstream asserts that start does not throw; in Effect form a failure while starting
    // would fail the start Effect or set status 'error' (SD-4)
    const exit = yield* Effect.exit(actorRef.start);
    expect(Exit.isSuccess(exit)).toBe(true);
    expect((yield* actorRef.getSnapshot).status).toBe('active');
  }));

  // upstream: test/transient.test.ts > transient states (eventless transitions) > should be taken even in absence of other transitions
  it.effect('should be taken even in absence of other transitions', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          always: {
            target: 'b',
            guard: ({ event }) => event.type === 'WHATEVER'
          }
        },
        b: {}
      }
    });
    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'WHATEVER' }));

    expect((yield* actorRef.getSnapshot).value).toBe('b');
  }));

  // upstream: test/transient.test.ts > transient states (eventless transitions) > should select subsequent transient transitions even in absence of other transitions
  it.effect('should select subsequent transient transitions even in absence of other transitions', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          always: {
            target: 'b',
            guard: ({ event }) => event.type === 'WHATEVER'
          }
        },
        b: {
          always: {
            target: 'c',
            guard: () => true
          }
        },
        c: {}
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'WHATEVER' }));

    expect((yield* actorRef.getSnapshot).value).toBe('c');
  }));

  // upstream: test/transient.test.ts > transient states (eventless transitions) > events that trigger eventless transitions should be preserved in guards
  it.effect('events that trigger eventless transitions should be preserved in guards', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            EVENT: 'b'
          }
        },
        b: {
          always: 'c'
        },
        c: {
          always: {
            guard: ({ event }) => {
              expect(event.type).toEqual('EVENT');
              return event.type === 'EVENT';
            },
            target: 'd'
          }
        },
        d: { type: 'final' }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'EVENT' }));

    expect((yield* actorRef.getSnapshot).status).toBe('done');
  }));

  // upstream: test/transient.test.ts > transient states (eventless transitions) > events that trigger eventless transitions should be preserved in actions
  it.effect('events that trigger eventless transitions should be preserved in actions', () => Effect.gen(function* () {
    // upstream fails through the global rethrow of an action's error; that rethrow is not
    // ported (SD-21), so a failed assertion in an action only sets status 'error' (SD-4) and
    // the test reads that status after the send. Upstream's 3 assertions plus the status check
    expect.assertions(4);

    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            EVENT: 'b'
          }
        },
        b: {
          always: {
            target: 'c',
            actions: ({ event }) => {
              expect(event).toEqual({ type: 'EVENT', value: 42 });
            }
          },
          exit: ({ event }) => {
            expect(event).toEqual({ type: 'EVENT', value: 42 });
          }
        },
        c: {
          entry: ({ event }) => {
            expect(event).toEqual({ type: 'EVENT', value: 42 });
          }
        }
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* service.send({ type: 'EVENT', value: 42 }));
    expect((yield* service.getSnapshot).status).toBe('active');
  }));

  // upstream: test/transient.test.ts > transient states (eventless transitions) > should avoid infinite loops with eventless transitions
  it.effect('should avoid infinite loops with eventless transitions', () => Effect.gen(function* () {
    // Upstream has expect.assertions(1) for the observer error callback; the Effect form adds
    // the start exit and the status checks (SD-4)
    expect.assertions(3);
    const machine = createMachine({
      initial: 'a',
      options: {
        maxIterations: 100
      },
      states: {
        a: {
          always: {
            target: 'b'
          }
        },
        b: {
          always: {
            target: 'c'
          }
        },
        c: {
          always: {
            target: 'a'
          }
        }
      }
    });
    const actor = (yield* createActor(machine));

    // upstream observes the error with an observer `error` callback. In Effect form the
    // exceeded maxIterations sets status 'error' and does not fail start (SD-4, 5.31), and
    // the `changes` stream fails with the actor's error (an errored actor fails a stream
    // consumed after start, as an XState observer subscribed after the error is called)
    expect(Exit.isSuccess(yield* Effect.exit(actor.start))).toBe(true);
    expect((yield* actor.getSnapshot).status).toBe('error');
    const err = yield* Effect.flip(Stream.runDrain(actor.changes));
    expect((err as any).message).toMatch(/infinite loop/i);
  }));

  // upstream: test/transient.test.ts > transient states (eventless transitions) > should avoid infinite loops with raised events
  it.effect('should avoid infinite loops with raised events', () => Effect.gen(function* () {
    // Upstream has expect.assertions(1); the Effect form adds the start exit and status checks
    expect.assertions(3);
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          always: {
            target: 'b'
          }
        },
        b: {
          entry: raise({ type: 'EVENT' }),
          on: {
            EVENT: {
              target: 'c'
            }
          }
        },
        c: {
          always: {
            target: 'a'
          }
        }
      },
      options: {
        maxIterations: 100
      }
    });
    const actor = (yield* createActor(machine));

    // upstream observes the error with an observer `error` callback; in Effect form see the
    // test above (SD-4, 5.31)
    expect(Exit.isSuccess(yield* Effect.exit(actor.start))).toBe(true);
    expect((yield* actor.getSnapshot).status).toBe('error');
    const err = yield* Effect.flip(Stream.runDrain(actor.changes));
    expect((err as any).message).toMatch(/infinite loop/i);
  }));

  // upstream: test/transient.test.ts > transient states (eventless transitions) > shouldn't end up in an infinite loop when selecting the fallback target
  it.effect("shouldn't end up in an infinite loop when selecting the fallback target", () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'idle',
      states: {
        idle: {
          on: {
            event: 'active'
          }
        },
        active: {
          initial: 'a',
          states: {
            a: {},
            b: {}
          },
          always: [
            {
              guard: () => false,
              target: '.a'
            },
            {
              target: '.b'
            }
          ]
        }
      }
    });
    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({
      type: 'event'
    }));

    expect((yield* actorRef.getSnapshot).value).toEqual({ active: 'b' });
  }));

  // upstream: test/transient.test.ts > transient states (eventless transitions) > shouldn't end up in an infinite loop when selecting a guarded target
  it.effect("shouldn't end up in an infinite loop when selecting a guarded target", () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'idle',
      states: {
        idle: {
          on: {
            event: 'active'
          }
        },
        active: {
          initial: 'a',
          states: {
            a: {},
            b: {}
          },
          always: [
            {
              guard: () => true,
              target: '.a'
            },
            {
              target: '.b'
            }
          ]
        }
      }
    });
    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({
      type: 'event'
    }));

    expect((yield* actorRef.getSnapshot).value).toEqual({ active: 'a' });
  }));

  // upstream: test/transient.test.ts > transient states (eventless transitions) > shouldn't end up in an infinite loop when executing a fire-and-forget action that doesn't change state
  it.effect("shouldn't end up in an infinite loop when executing a fire-and-forget action that doesn't change state", () => Effect.gen(function* () {
    let count = 0;
    const machine = createMachine({
      initial: 'idle',
      states: {
        idle: {
          on: {
            event: 'active'
          }
        },
        active: {
          initial: 'a',
          states: {
            a: {}
          },
          always: [
            {
              actions: () => {
                count++;
                if (count > 5) {
                  throw new Error('Infinite loop detected');
                }
              },
              target: '.a'
            }
          ]
        }
      }
    });

    const actorRef = (yield* createActor(machine));

    (yield* actorRef.start);
    (yield* actorRef.send({
      type: 'event'
    }));

    expect((yield* actorRef.getSnapshot).value).toEqual({ active: 'a' });
    expect(count).toBe(1);
  }));

  // upstream: test/transient.test.ts > transient states (eventless transitions) > should loop (but not infinitely) for assign actions
  it.effect('should loop (but not infinitely) for assign actions', () => Effect.gen(function* () {
    const machine = createMachine({
      context: { count: 0 },
      initial: 'counting',
      states: {
        counting: {
          always: {
            guard: ({ context }) => context.count < 5,
            actions: assign({ count: ({ context }) => context.count + 1 })
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect((yield* actorRef.getSnapshot).context.count).toEqual(5);
  }));

  // upstream: test/transient.test.ts > transient states (eventless transitions) > should execute an always transition after a raised transition even if that raised transition doesn't change the state
  it.effect("should execute an always transition after a raised transition even if that raised transition doesn't change the state", () => Effect.gen(function* () {
    const spy = vi.fn();
    let counter = 0;
    const machine = createMachine({
      always: {
        actions: () => spy(counter)
      },
      on: {
        EV: {
          actions: raise({ type: 'RAISED' })
        },
        RAISED: {
          actions: () => {
            ++counter;
          }
        }
      }
    });
    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    spy.mockClear();
    (yield* actorRef.send({ type: 'EV' }));

    expect(spy.mock.calls).toEqual([
      // called in response to the `EV` event
      [0],
      // called in response to the `RAISED` event
      [1]
    ]);
  }));
});
