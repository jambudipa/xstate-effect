import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { createMachine, createActor } from "../../src/index.js";
import { assign } from "../../src/index.js";
import { fromCallback } from "../../src/index.js";

type Events =
  | { type: 'BAR_EVENT' }
  | { type: 'DEEP_EVENT' }
  | { type: 'EXTERNAL' }
  | { type: 'FOO_EVENT' }
  | { type: 'FORBIDDEN_EVENT' }
  | { type: 'INERT' }
  | { type: 'INTERNAL' }
  | { type: 'MACHINE_EVENT' }
  | { type: 'P31' }
  | { type: 'P32' }
  | { type: 'THREE_EVENT' }
  | { type: 'TO_THREE' }
  | { type: 'TO_TWO'; foo: string }
  | { type: 'TO_TWO_MAYBE' }
  | { type: 'TO_FINAL' };

const exampleMachine = createMachine({
  types: {} as {
    events: Events;
  },
  initial: 'one',
  states: {
    one: {
      entry: ['enter'],
      on: {
        EXTERNAL: {
          target: 'one',
          reenter: true
        },
        INERT: {},
        INTERNAL: {
          actions: ['doSomething']
        },
        TO_TWO: 'two',
        TO_TWO_MAYBE: {
          target: 'two',
          guard: function maybe() {
            return true;
          }
        },
        TO_THREE: 'three',
        FORBIDDEN_EVENT: undefined,
        TO_FINAL: 'success'
      }
    },
    two: {
      initial: 'deep',
      states: {
        deep: {
          initial: 'foo',
          states: {
            foo: {
              on: {
                FOO_EVENT: 'bar',
                FORBIDDEN_EVENT: undefined
              }
            },
            bar: {
              on: {
                BAR_EVENT: 'foo'
              }
            }
          }
        }
      },
      on: {
        DEEP_EVENT: '.'
      }
    },
    three: {
      type: 'parallel',
      states: {
        first: {
          initial: 'p31',
          states: {
            p31: {
              on: { P31: '.' }
            }
          }
        },
        guarded: {
          initial: 'p32',
          states: {
            p32: {
              on: { P32: '.' }
            }
          }
        }
      },
      on: {
        THREE_EVENT: '.'
      }
    },
    success: {
      type: 'final'
    }
  },
  on: {
    MACHINE_EVENT: '.two'
  }
});

describe('State', () => {
  describe('status', () => {
    // upstream: test/state.test.ts > State > status > should show that a machine has not reached its final state
    it.effect('should show that a machine has not reached its final state', () => Effect.gen(function* () {
      expect((yield* (yield* createActor(exampleMachine)).getSnapshot).status).not.toBe('done');
    }));

    // upstream: test/state.test.ts > State > status > should show that a machine has reached its final state
    it.effect('should show that a machine has reached its final state', () => Effect.gen(function* () {
      const actorRef = (yield* Effect.tap(createActor(exampleMachine), (a) => a.start));
      (yield* actorRef.send({ type: 'TO_FINAL' }));
      expect((yield* actorRef.getSnapshot).status).toBe('done');
    }));
  });

  describe('.can', () => {
    // upstream: test/state.test.ts > State > .can > should return true for a simple event that results in a transition to a different state
    it.effect('should return true for a simple event that results in a transition to a different state', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'a',
        states: {
          a: {
            on: {
              NEXT: 'b'
            }
          },
          b: {}
        }
      });

      expect((yield* (yield* (yield* createActor(machine)).getSnapshot).can({ type: 'NEXT' }))).toBe(
        true
      );
    }));

    // upstream: test/state.test.ts > State > .can > should return true for an event object that results in a transition to a different state
    it.effect('should return true for an event object that results in a transition to a different state', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'a',
        states: {
          a: {
            on: {
              NEXT: 'b'
            }
          },
          b: {}
        }
      });

      expect((yield* (yield* (yield* createActor(machine)).getSnapshot).can({ type: 'NEXT' }))).toBe(
        true
      );
    }));

    // upstream: test/state.test.ts > State > .can > should return true for an event object that results in a new action
    it.effect('should return true for an event object that results in a new action', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'a',
        states: {
          a: {
            on: {
              NEXT: {
                actions: 'newAction'
              }
            }
          }
        }
      });

      expect((yield* (yield* (yield* createActor(machine)).getSnapshot).can({ type: 'NEXT' }))).toBe(
        true
      );
    }));

    // upstream: test/state.test.ts > State > .can > should return true for an event object that results in a context change
    it.effect('should return true for an event object that results in a context change', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'a',
        context: { count: 0 },
        states: {
          a: {
            on: {
              NEXT: {
                actions: assign({ count: 1 })
              }
            }
          }
        }
      });

      expect((yield* (yield* (yield* createActor(machine)).getSnapshot).can({ type: 'NEXT' }))).toBe(
        true
      );
    }));

    // upstream: test/state.test.ts > State > .can > should return true for a reentering self-transition without actions
    it.effect('should return true for a reentering self-transition without actions', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'a',
        states: {
          a: {
            on: {
              EV: 'a'
            }
          }
        }
      });

      expect((yield* (yield* (yield* createActor(machine)).getSnapshot).can({ type: 'EV' }))).toBe(true);
    }));

    // upstream: test/state.test.ts > State > .can > should return true for a reentering self-transition with reentry action
    it.effect('should return true for a reentering self-transition with reentry action', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'a',
        states: {
          a: {
            entry: () => {},
            on: {
              EV: 'a'
            }
          }
        }
      });

      expect((yield* (yield* (yield* createActor(machine)).getSnapshot).can({ type: 'EV' }))).toBe(true);
    }));

    // upstream: test/state.test.ts > State > .can > should return true for a reentering self-transition with transition action
    it.effect('should return true for a reentering self-transition with transition action', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'a',
        states: {
          a: {
            on: {
              EV: {
                target: 'a',
                actions: () => {}
              }
            }
          }
        }
      });

      expect((yield* (yield* (yield* createActor(machine)).getSnapshot).can({ type: 'EV' }))).toBe(true);
    }));

    // upstream: test/state.test.ts > State > .can > should return true for a targetless transition with actions
    it.effect('should return true for a targetless transition with actions', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'a',
        states: {
          a: {
            on: {
              EV: {
                actions: () => {}
              }
            }
          }
        }
      });

      expect((yield* (yield* (yield* createActor(machine)).getSnapshot).can({ type: 'EV' }))).toBe(true);
    }));

    // upstream: test/state.test.ts > State > .can > should return false for a forbidden transition
    it.effect('should return false for a forbidden transition', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'a',
        states: {
          a: {
            on: {
              EV: undefined
            }
          }
        }
      });

      expect((yield* (yield* (yield* createActor(machine)).getSnapshot).can({ type: 'EV' }))).toBe(
        false
      );
    }));

    // upstream: test/state.test.ts > State > .can > should return false for an unknown event
    it.effect('should return false for an unknown event', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'a',
        states: {
          a: {
            on: {
              NEXT: 'b'
            }
          },
          b: {}
        }
      });

      expect((yield* (yield* (yield* createActor(machine)).getSnapshot).can({ type: 'UNKNOWN' }))).toBe(
        false
      );
    }));

    // upstream: test/state.test.ts > State > .can > should return true when a guarded transition allows the transition
    it.effect('should return true when a guarded transition allows the transition', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'a',
        states: {
          a: {
            on: {
              CHECK: {
                target: 'b',
                guard: () => true
              }
            }
          },
          b: {}
        }
      });

      expect(
        (yield* (yield* (yield* createActor(machine)).getSnapshot).can({
          type: 'CHECK'
        }))
      ).toBe(true);
    }));

    // upstream: test/state.test.ts > State > .can > should return false when a guarded transition disallows the transition
    it.effect('should return false when a guarded transition disallows the transition', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'a',
        states: {
          a: {
            on: {
              CHECK: {
                target: 'b',
                guard: () => false
              }
            }
          },
          b: {}
        }
      });

      expect(
        (yield* (yield* (yield* createActor(machine)).getSnapshot).can({
          type: 'CHECK'
        }))
      ).toBe(false);
    }));

    // upstream: test/state.test.ts > State > .can > should not spawn actors when determining if an event is accepted
    it.effect('should not spawn actors when determining if an event is accepted', () => Effect.gen(function* () {
      let spawned = false;
      const machine = createMachine({
        context: {},
        initial: 'a',
        states: {
          a: {
            on: {
              SPAWN: {
                actions: assign(({ spawn }) => ({
                  ref: spawn(
                    fromCallback(() => {
                      spawned = true;
                    })
                  )
                }))
              }
            }
          },
          b: {}
        }
      });

      const service = (yield* Effect.tap(createActor(machine), (a) => a.start));
      (yield* (yield* service.getSnapshot).can({ type: 'SPAWN' }));
      expect(spawned).toBe(false);
    }));

    // upstream: test/state.test.ts > State > .can > should not execute assignments when used with non-started actor
    it.effect('should not execute assignments when used with non-started actor', () => Effect.gen(function* () {
      let executed = false;
      const machine = createMachine({
        context: {},
        on: {
          EVENT: {
            actions: assign((ctx) => {
              // Side-effect just for testing
              executed = true;
              return ctx;
            })
          }
        }
      });

      const actorRef = (yield* createActor(machine));

      expect((yield* (yield* actorRef.getSnapshot).can({ type: 'EVENT' }))).toBeTruthy();

      expect(executed).toBeFalsy();
    }));

    // upstream: test/state.test.ts > State > .can > should not execute assignments when used with started actor
    it.effect('should not execute assignments when used with started actor', () => Effect.gen(function* () {
      let executed = false;
      const machine = createMachine({
        context: {},
        on: {
          EVENT: {
            actions: assign((ctx) => {
              // Side-effect just for testing
              executed = true;
              return ctx;
            })
          }
        }
      });

      const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

      expect((yield* (yield* actorRef.getSnapshot).can({ type: 'EVENT' }))).toBeTruthy();

      expect(executed).toBeFalsy();
    }));

    // upstream: test/state.test.ts > State > .can > should return true when non-first parallel region changes value
    it.effect('should return true when non-first parallel region changes value', () => Effect.gen(function* () {
      const machine = createMachine({
        type: 'parallel',
        states: {
          a: {
            initial: 'a1',
            states: {
              a1: {
                id: 'foo',
                on: {
                  // first region doesn't change value here
                  EVENT: { target: ['#foo', '#bar'] }
                }
              }
            }
          },
          b: {
            initial: 'b1',
            states: {
              b1: {},
              b2: {
                id: 'bar'
              }
            }
          }
        }
      });

      expect(
        (yield* (yield* (yield* createActor(machine)).getSnapshot).can({ type: 'EVENT' }))
      ).toBeTruthy();
    }));

    // upstream: test/state.test.ts > State > .can > should return true when transition targets a state that is already part of the current configuration but the final state value changes
    it.effect('should return true when transition targets a state that is already part of the current configuration but the final state value changes', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'a',
        states: {
          a: {
            id: 'foo',
            initial: 'a1',
            states: {
              a1: {
                on: {
                  NEXT: 'a2'
                }
              },
              a2: {
                on: {
                  NEXT: '#foo'
                }
              }
            }
          }
        }
      });

      const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
      (yield* actorRef.send({ type: 'NEXT' }));

      expect((yield* (yield* actorRef.getSnapshot).can({ type: 'NEXT' }))).toBeTruthy();
    }));
  });

  describe('.hasTag', () => {
    // upstream: test/state.test.ts > State > .hasTag > should be able to check a tag after recreating a persisted state
    it.effect('should be able to check a tag after recreating a persisted state', () => Effect.gen(function* () {
      const machine = createMachine({
        initial: 'a',
        states: {
          a: {
            tags: 'foo'
          }
        }
      });

      const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
      const persistedState = (yield* actorRef.getPersistedSnapshot);
      (yield* actorRef.stop);
      const restoredSnapshot = (yield* (yield* createActor(machine, {
        snapshot: persistedState
      })).getSnapshot);

      expect(restoredSnapshot.hasTag('foo')).toBe(true);
    }));
  });

  describe('.status', () => {
    // upstream: test/state.test.ts > State > .status > should be 'stopped' after a running actor gets stopped
    it.effect("should be 'stopped' after a running actor gets stopped", () => Effect.gen(function* () {
      const snapshot = yield* createActor(createMachine({})).pipe(
        Effect.tap((a) => a.start),
        Effect.tap((a) => a.stop),
        Effect.flatMap((a) => a.getSnapshot)
      );
      expect(snapshot.status).toBe('stopped');
    }));
  });
});
