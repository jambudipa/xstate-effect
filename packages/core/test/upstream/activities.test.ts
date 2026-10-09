import { describe, expect, it, vi } from "@effect/vitest"
import { Effect } from "effect"
import { fromCallback } from "../../src/index.js";
import { createActor, createMachine, assign } from "../../src/index.js";
import { setup } from "../../src/index.js";

// TODO: remove this file but before doing that ensure that things tested here are covered by other tests

describe('invocations (activities)', () => {
  // upstream: test/activities.test.ts > invocations (activities) > identifies initial root invocations
  it.effect('identifies initial root invocations', () => Effect.gen(function* () {
    let active = false;
    const machine = createMachine({
      invoke: {
        src: fromCallback(() => {
          active = true;
        })
      }
    });
    (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(active).toBe(true);
  }));

  // upstream: test/activities.test.ts > invocations (activities) > identifies initial invocations
  it.effect('identifies initial invocations', () => Effect.gen(function* () {
    let active = false;
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          invoke: {
            src: fromCallback(() => {
              active = true;
            })
          }
        }
      }
    });
    (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(active).toBe(true);
  }));

  // upstream: test/activities.test.ts > invocations (activities) > identifies initial deep invocations
  it.effect('identifies initial deep invocations', () => Effect.gen(function* () {
    let active = false;
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          initial: 'a1',
          states: {
            a1: {
              invoke: {
                src: fromCallback(() => {
                  active = true;
                })
              }
            }
          }
        }
      }
    });
    (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(active).toBe(true);
  }));

  // upstream: test/activities.test.ts > invocations (activities) > identifies start invocations
  it.effect('identifies start invocations', () => Effect.gen(function* () {
    let active = false;
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            TIMER: 'b'
          }
        },
        b: {
          invoke: {
            src: fromCallback(() => {
              active = true;
            })
          }
        }
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* service.send({ type: 'TIMER' }));

    expect(active).toBe(true);
  }));

  // upstream: test/activities.test.ts > invocations (activities) > identifies start invocations for child states and active invocations
  it.effect('identifies start invocations for child states and active invocations', () => Effect.gen(function* () {
    let active = false;
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            TIMER: 'b'
          }
        },
        b: {
          initial: 'b1',
          states: {
            b1: {
              on: {
                TIMER: 'b2'
              }
            },
            b2: {
              invoke: {
                src: fromCallback(() => {
                  active = true;
                })
              }
            }
          }
        }
      }
    });
    const service = (yield* createActor(machine));

    (yield* service.start);
    (yield* service.send({ type: 'TIMER' }));
    (yield* service.send({ type: 'TIMER' }));

    expect(active).toBe(true);
  }));

  // upstream: test/activities.test.ts > invocations (activities) > identifies stop invocations for child states
  it.effect('identifies stop invocations for child states', () => Effect.gen(function* () {
    let active = false;
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            TIMER: 'b'
          }
        },
        b: {
          initial: 'b1',
          states: {
            b1: {
              on: {
                TIMER: 'b2'
              }
            },
            b2: {
              invoke: {
                src: fromCallback(() => {
                  active = true;
                  return () => (active = false);
                })
              },
              on: {
                TIMER: 'b3'
              }
            },
            b3: {}
          }
        }
      }
    });
    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* service.send({ type: 'TIMER' }));
    (yield* service.send({ type: 'TIMER' }));
    (yield* service.send({ type: 'TIMER' }));

    expect(active).toBe(false);
  }));

  // upstream: test/activities.test.ts > invocations (activities) > identifies multiple stop invocations for child and parent states
  it.effect('identifies multiple stop invocations for child and parent states', () => Effect.gen(function* () {
    let active1 = false;
    let active2 = false;

    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            TIMER: 'b'
          }
        },
        b: {
          initial: 'b1',
          invoke: {
            src: fromCallback(() => {
              active1 = true;
              return () => (active1 = false);
            })
          },
          states: {
            b1: {
              invoke: {
                src: fromCallback(() => {
                  active2 = true;
                  return () => (active2 = false);
                })
              }
            }
          },
          on: {
            TIMER: 'a'
          }
        }
      }
    });
    const service = (yield* createActor(machine));

    (yield* service.start);
    (yield* service.send({ type: 'TIMER' }));
    (yield* service.send({ type: 'TIMER' }));

    expect(active1).toBe(false);
    expect(active2).toBe(false);
  }));

  // upstream: test/activities.test.ts > invocations (activities) > should activate even if there are subsequent always but blocked transition
  it.effect('should activate even if there are subsequent always but blocked transition', () => Effect.gen(function* () {
    let active = false;
    const machine = createMachine({
      initial: 'A',
      states: {
        A: {
          on: {
            E: 'B'
          }
        },
        B: {
          invoke: {
            src: fromCallback(() => {
              active = true;
              return () => (active = false);
            })
          },
          always: [{ guard: () => false, target: 'A' }]
        }
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* service.send({ type: 'E' }));

    expect(active).toBe(true);
  }));

  // upstream: test/activities.test.ts > invocations (activities) > should remember the invocations even after an ignored event
  it.effect('should remember the invocations even after an ignored event', () => Effect.gen(function* () {
    let cleanupSpy = vi.fn();
    let active = false;
    const machine = createMachine({
      initial: 'A',
      states: {
        A: {
          on: {
            E: 'B'
          }
        },
        B: {
          invoke: {
            src: fromCallback(() => {
              active = true;
              return () => {
                active = false;
                cleanupSpy();
              };
            })
          }
        }
      }
    });
    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* service.send({ type: 'E' }));
    (yield* service.send({ type: 'IGNORE' }));

    expect(active).toBe(true);
    expect(cleanupSpy).not.toBeCalled();
  }));

  // upstream: test/activities.test.ts > invocations (activities) > should remember the invocations when transitioning within the invoking state
  it.effect('should remember the invocations when transitioning within the invoking state', () => Effect.gen(function* () {
    let cleanupSpy = vi.fn();
    let active = false;
    const machine = createMachine({
      initial: 'A',
      states: {
        A: {
          invoke: {
            src: fromCallback(() => {
              active = true;
              return () => {
                active = false;
                cleanupSpy();
              };
            })
          },
          initial: 'A1',
          states: {
            A1: {
              on: {
                E: 'A2'
              }
            },
            A2: {}
          }
        }
      }
    });
    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* service.send({ type: 'E' }));

    expect(active).toBe(true);
    expect(cleanupSpy).not.toBeCalled();
  }));

  // upstream: test/activities.test.ts > invocations (activities) > should start a new actor when leaving an invoking state and entering a new one that invokes the same actor type
  it.effect('should start a new actor when leaving an invoking state and entering a new one that invokes the same actor type', () => Effect.gen(function* () {
    let counter = 0;
    const actual: string[] = [];

    const fooActor = fromCallback(() => {
      let localId = counter;
      counter++;

      actual.push(`start ${localId}`);

      return () => {
        actual.push(`stop ${localId}`);
      };
    });

    const machine = setup({
      actors: {
        fooActor
      }
    }).createMachine({
      initial: 'a',
      states: {
        a: {
          invoke: {
            src: 'fooActor'
          },
          on: {
            NEXT: 'b'
          }
        },
        b: {
          invoke: {
            src: 'fooActor'
          }
        }
      }
    });
    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* service.send({ type: 'NEXT' }));

    expect(actual).toEqual(['start 0', 'stop 0', 'start 1']);
  }));

  // upstream: test/activities.test.ts > invocations (activities) > should start a new actor when reentering the invoking state during a reentering self transition
  it.effect('should start a new actor when reentering the invoking state during a reentering self transition', () => Effect.gen(function* () {
    let counter = 0;
    const actual: string[] = [];

    const fooActor = fromCallback(() => {
      let localId = counter;
      counter++;

      actual.push(`start ${localId}`);

      return () => {
        actual.push(`stop ${localId}`);
      };
    });

    const machine = setup({
      actors: {
        fooActor
      }
    }).createMachine({
      initial: 'a',
      states: {
        a: {
          invoke: {
            src: 'fooActor'
          },
          on: {
            NEXT: {
              target: 'a',
              reenter: true
            }
          }
        }
      }
    });
    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* service.send({ type: 'NEXT' }));

    expect(actual).toEqual(['start 0', 'stop 0', 'start 1']);
  }));

  // upstream: test/activities.test.ts > invocations (activities) > should have stopped after automatic transitions
  it.effect('should have stopped after automatic transitions', () => Effect.gen(function* () {
    let active = false;
    const machine = createMachine({
      context: {
        counter: 0
      },
      initial: 'a',
      states: {
        a: {
          invoke: {
            src: fromCallback(() => {
              active = true;
              return () => (active = false);
            })
          },
          always: {
            guard: ({ context }) => context.counter !== 0,
            target: 'b'
          },
          on: {
            INC: {
              actions: assign(({ context }) => ({
                counter: context.counter + 1
              }))
            }
          }
        },
        b: {}
      }
    });
    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(active).toBe(true);

    (yield* service.send({ type: 'INC' }));

    expect(active).toBe(false);
  }));
});
