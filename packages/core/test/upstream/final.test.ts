import { describe, expect, it, vi } from "@effect/vitest"
import { Effect, Fiber, Option, Stream } from "effect"
import {
  createMachine,
  createActor,
  assign,
  AnyActorRef,
  sendParent
} from "../../src/index.js";
import { trackEntries } from "./trackEntries.js";

// Upstream delivers the events a child sends to its parent (`sendParent`, then
// `xstate.done.actor.*`) before the outer `send` returns. Here a send from inside an actor
// enqueues without waiting (SD-23), so a test yields its fiber, at most 100 times and never on
// wall-clock time, until the delivery it needs has happened.
const yieldUntil = (done: () => boolean | Effect.Effect<boolean>) =>
  Effect.yieldNow.pipe(Effect.repeat({ until: done, times: 100 }));

// Before an assertion that something did NOT happen: give every enqueued delivery the
// chance to run, so that the assertion is not vacuous.
const settle = yieldUntil(() => false);

describe('final states', () => {
  // upstream: test/final.test.ts > final states > status of a machine with a root state being final should be done
  it.effect('status of a machine with a root state being final should be done', () => Effect.gen(function* () {
    const machine = createMachine({ type: 'final' });
    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect((yield* actorRef.getSnapshot).status).toBe('done');
  }));
  // upstream: test/final.test.ts > final states > output of a machine with a root state being final should be called with a "xstate.done.state.ROOT_ID" event
  it.effect('output of a machine with a root state being final should be called with a "xstate.done.state.ROOT_ID" event', () => Effect.gen(function* () {
    const spy = vi.fn();
    const machine = createMachine({
      type: 'final',
      output: ({ event }) => {
        spy(event);
      }
    });
    (yield* Effect.tap(createActor(machine, { input: 42 }), (a) => a.start));

    // `event.output` of `xstate.done.state.*` is `Option.none()`, not `undefined` (D8, SD-5):
    // the snapshot prints the Option; a "Tests not ported" row names the difference (SD-26)
    expect(spy.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "output": {
              "_id": "Option",
              "_tag": "None",
            },
            "type": "xstate.done.state.(machine)",
          },
        ],
      ]
    `);
  }));
  // upstream: test/final.test.ts > final states > should emit the "xstate.done.state.*" event when all nested states are in their final states
  it.effect('should emit the "xstate.done.state.*" event when all nested states are in their final states', () => Effect.gen(function* () {
    const onDoneSpy = vi.fn();

    const machine = createMachine({
      id: 'm',
      initial: 'foo',
      states: {
        foo: {
          type: 'parallel',
          states: {
            first: {
              initial: 'a',
              states: {
                a: {
                  on: { NEXT_1: 'b' }
                },
                b: {
                  type: 'final'
                }
              }
            },
            second: {
              initial: 'a',
              states: {
                a: {
                  on: { NEXT_2: 'b' }
                },
                b: {
                  type: 'final'
                }
              }
            }
          },
          onDone: {
            target: 'bar',
            actions: ({ event }) => {
              onDoneSpy(event.type);
            }
          }
        },
        bar: {}
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actor.send({
      type: 'NEXT_1'
    }));
    (yield* actor.send({
      type: 'NEXT_2'
    }));

    expect((yield* actor.getSnapshot).value).toBe('bar');
    expect(onDoneSpy).toHaveBeenCalledWith('xstate.done.state.m.foo');
  }));

  // upstream: test/final.test.ts > final states > should execute final child state actions first
  it.effect('should execute final child state actions first', () => Effect.gen(function* () {
    const actual: string[] = [];
    const machine = createMachine({
      initial: 'foo',
      states: {
        foo: {
          initial: 'bar',
          onDone: { actions: () => actual.push('fooAction') },
          states: {
            bar: {
              initial: 'baz',
              onDone: 'barFinal',
              states: {
                baz: {
                  type: 'final',
                  entry: () => actual.push('bazAction')
                }
              }
            },
            barFinal: {
              type: 'final',
              entry: () => actual.push('barAction')
            }
          }
        }
      }
    });

    (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(actual).toEqual(['bazAction', 'barAction', 'fooAction']);
  }));

  // upstream: test/final.test.ts > final states > should call output expressions on nested final nodes
  it.effect('should call output expressions on nested final nodes', () => Effect.gen(function* () {
    interface Ctx {
      revealedSecret?: string;
    }

    const machine = createMachine({
      types: {} as { context: Ctx },
      initial: 'secret',
      context: {
        revealedSecret: undefined
      },
      states: {
        secret: {
          initial: 'wait',
          states: {
            wait: {
              on: {
                REQUEST_SECRET: 'reveal'
              }
            },
            reveal: {
              type: 'final',
              output: () => ({
                secret: 'the secret'
              })
            }
          },
          onDone: {
            target: 'success',
            actions: assign({
              revealedSecret: ({ event }) => {
                // `event.output` of `xstate.done.state.*` is an `Option` (D8, SD-5)
                return Option.getOrThrow(event.output as Option.Option<any>).secret;
              }
            })
          }
        },
        success: {
          type: 'final'
        }
      }
    });

    const service = (yield* createActor(machine));
    // the observer-object `subscribe` is not ported (D6, DEV-3): the `changes` stream ends
    // when the actor is done, so the end of the stream stands for the observer's `complete`,
    // and joining the fiber that drains it stands for the promise that `complete` resolves
    const completed = yield* service.changes.pipe(
      Stream.runDrain,
      Effect.andThen(Effect.gen(function* () {
        expect((yield* service.getSnapshot).context).toEqual({
          revealedSecret: 'the secret'
        });
      })),
      Effect.forkScoped({ startImmediately: true })
    );
    (yield* service.start);

    (yield* service.send({ type: 'REQUEST_SECRET' }));

    yield* Fiber.join(completed);
  }));

  // upstream: test/final.test.ts > final states > should only call data expression once when entering root's final state
  it.effect("should only call data expression once when entering root's final state", () => Effect.gen(function* () {
    const spy = vi.fn();
    const machine = createMachine({
      initial: 'start',
      states: {
        start: {
          on: {
            FINISH: 'end'
          }
        },
        end: {
          type: 'final'
        }
      },
      output: spy
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* service.send({ type: 'FINISH', value: 1 }));
    expect(spy).toBeCalledTimes(1);
  }));

  // upstream: test/final.test.ts > final states > output mapper should receive self
  it.effect('output mapper should receive self', () => Effect.gen(function* () {
    const machine = createMachine({
      types: {
        output: {} as {
          selfRef: AnyActorRef;
        }
      },
      initial: 'done',
      states: {
        done: {
          type: 'final'
        }
      },
      output: ({ self }) => ({ selfRef: self })
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
    // `snapshot.output` is an `Option` (D8): `getOrThrow` stands for upstream's `!`
    expect(Option.getOrThrow((yield* actor.getSnapshot).output).selfRef.send).toBeDefined();
  }));

  // upstream: test/final.test.ts > final states > state output should be able to use context updated by the entry action of the reached final state
  it.effect('state output should be able to use context updated by the entry action of the reached final state', () => Effect.gen(function* () {
    const spy = vi.fn();
    const machine = createMachine({
      context: {
        count: 0
      },
      initial: 'a',
      states: {
        a: {
          initial: 'a1',
          states: {
            a1: {
              on: {
                NEXT: 'a2'
              }
            },
            a2: {
              type: 'final',
              entry: assign({
                count: 1
              }),
              output: ({ context }) => context.count
            }
          },
          onDone: {
            actions: ({ event }) => {
              spy(event.output);
            }
          }
        }
      }
    });
    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'NEXT' }));

    // `event.output` of `xstate.done.state.*` is an `Option` (D8, SD-5)
    expect(spy).toHaveBeenCalledWith(Option.some(1));
  }));

  // upstream: test/final.test.ts > final states > should emit a done state event for a parallel state when its parallel children reach their final states
  it.effect('should emit a done state event for a parallel state when its parallel children reach their final states', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'first',
      states: {
        first: {
          type: 'parallel',
          states: {
            alpha: {
              type: 'parallel',
              states: {
                one: {
                  initial: 'start',
                  states: {
                    start: {
                      on: {
                        finish_one_alpha: 'finish'
                      }
                    },
                    finish: {
                      type: 'final'
                    }
                  }
                },
                two: {
                  initial: 'start',
                  states: {
                    start: {
                      on: {
                        finish_two_alpha: 'finish'
                      }
                    },
                    finish: {
                      type: 'final'
                    }
                  }
                }
              }
            },
            beta: {
              type: 'parallel',
              states: {
                third: {
                  initial: 'start',
                  states: {
                    start: {
                      on: {
                        finish_three_beta: 'finish'
                      }
                    },
                    finish: {
                      type: 'final'
                    }
                  }
                },
                fourth: {
                  initial: 'start',
                  states: {
                    start: {
                      on: {
                        finish_four_beta: 'finish'
                      }
                    },
                    finish: {
                      type: 'final'
                    }
                  }
                }
              }
            }
          },
          onDone: 'done'
        },
        done: {
          type: 'final'
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({
      type: 'finish_one_alpha'
    }));
    (yield* actorRef.send({
      type: 'finish_two_alpha'
    }));
    (yield* actorRef.send({
      type: 'finish_three_beta'
    }));
    (yield* actorRef.send({
      type: 'finish_four_beta'
    }));

    expect((yield* actorRef.getSnapshot).status).toBe('done');
  }));

  // upstream: test/final.test.ts > final states > should emit a done state event for a parallel state when its compound child reaches its final state when the other parallel child region is already in its final state
  it.effect('should emit a done state event for a parallel state when its compound child reaches its final state when the other parallel child region is already in its final state', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'first',
      states: {
        first: {
          type: 'parallel',
          states: {
            alpha: {
              type: 'parallel',
              states: {
                one: {
                  initial: 'start',
                  states: {
                    start: {
                      on: {
                        finish_one_alpha: 'finish'
                      }
                    },
                    finish: {
                      type: 'final'
                    }
                  }
                },
                two: {
                  initial: 'start',
                  states: {
                    start: {
                      on: {
                        finish_two_alpha: 'finish'
                      }
                    },
                    finish: {
                      type: 'final'
                    }
                  }
                }
              }
            },
            beta: {
              initial: 'three',
              states: {
                three: {
                  on: {
                    finish_beta: 'finish'
                  }
                },
                finish: {
                  type: 'final'
                }
              }
            }
          },
          onDone: 'done'
        },
        done: {
          type: 'final'
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    // reach final state of a parallel state
    (yield* actorRef.send({
      type: 'finish_one_alpha'
    }));
    (yield* actorRef.send({
      type: 'finish_two_alpha'
    }));

    // reach final state of a compound state
    (yield* actorRef.send({
      type: 'finish_beta'
    }));

    expect((yield* actorRef.getSnapshot).status).toBe('done');
  }));

  // upstream: test/final.test.ts > final states > should emit a done state event for a parallel state when its parallel child reaches its final state when the other compound child region is already in its final state
  it.effect('should emit a done state event for a parallel state when its parallel child reaches its final state when the other compound child region is already in its final state', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'first',
      states: {
        first: {
          type: 'parallel',
          states: {
            alpha: {
              type: 'parallel',
              states: {
                one: {
                  initial: 'start',
                  states: {
                    start: {
                      on: {
                        finish_one_alpha: 'finish'
                      }
                    },
                    finish: {
                      type: 'final'
                    }
                  }
                },
                two: {
                  initial: 'start',
                  states: {
                    start: {
                      on: {
                        finish_two_alpha: 'finish'
                      }
                    },
                    finish: {
                      type: 'final'
                    }
                  }
                }
              }
            },
            beta: {
              initial: 'three',
              states: {
                three: {
                  on: {
                    finish_beta: 'finish'
                  }
                },
                finish: {
                  type: 'final'
                }
              }
            }
          },
          onDone: 'done'
        },
        done: {
          type: 'final'
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    // reach final state of a compound state
    (yield* actorRef.send({
      type: 'finish_beta'
    }));

    // reach final state of a parallel state
    (yield* actorRef.send({
      type: 'finish_one_alpha'
    }));
    (yield* actorRef.send({
      type: 'finish_two_alpha'
    }));

    expect((yield* actorRef.getSnapshot).status).toBe('done');
  }));

  // upstream: test/final.test.ts > final states > should reach a final state when a parallel state reaches its final state and transitions to a top-level final state in response to that
  it.effect('should reach a final state when a parallel state reaches its final state and transitions to a top-level final state in response to that', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          type: 'parallel',
          onDone: 'b',
          states: {
            a1: {
              type: 'parallel',
              states: {
                a1a: { type: 'final' },
                a1b: { type: 'final' }
              }
            },
            a2: {
              initial: 'a2a',
              states: { a2a: { type: 'final' } }
            }
          }
        },
        b: {
          type: 'final'
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect((yield* actorRef.getSnapshot).status).toEqual('done');
  }));

  // upstream: test/final.test.ts > final states > should reach a final state when a parallel state nested in a parallel state reaches its final state and transitions to a top-level final state in response to that
  it.effect('should reach a final state when a parallel state nested in a parallel state reaches its final state and transitions to a top-level final state in response to that', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          type: 'parallel',
          onDone: 'b',
          states: {
            a1: {
              type: 'parallel',
              states: {
                a1a: { type: 'final' },
                a1b: { type: 'final' }
              }
            },
            a2: {
              initial: 'a2a',
              states: { a2a: { type: 'final' } }
            }
          }
        },
        b: {
          type: 'final'
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect((yield* actorRef.getSnapshot).status).toEqual('done');
  }));
  // upstream: test/final.test.ts > final states > root output should be called with a "xstate.done.state.*" event of the parallel root when a direct final child of that parallel root is reached
  it.effect('root output should be called with a "xstate.done.state.*" event of the parallel root when a direct final child of that parallel root is reached', () => Effect.gen(function* () {
    const spy = vi.fn();
    const machine = createMachine({
      type: 'parallel',
      states: {
        a: {
          type: 'final'
        }
      },
      output: ({ event }) => {
        spy(event);
      }
    });

    (yield* Effect.tap(createActor(machine), (a) => a.start));

    // `event.output` of `xstate.done.state.*` is `Option.none()`, not `undefined` (D8, SD-5):
    // the snapshot prints the Option; a "Tests not ported" row names the difference (SD-26)
    expect(spy.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "output": {
              "_id": "Option",
              "_tag": "None",
            },
            "type": "xstate.done.state.(machine)",
          },
        ],
      ]
    `);
  }));

  // upstream: test/final.test.ts > final states > root output should be called with a "xstate.done.state.*" event of the parallel root when a final child of its compound child is reached
  it.effect('root output should be called with a "xstate.done.state.*" event of the parallel root when a final child of its compound child is reached', () => Effect.gen(function* () {
    const spy = vi.fn();
    const machine = createMachine({
      type: 'parallel',
      states: {
        a: {
          initial: 'b',
          states: {
            b: {
              type: 'final'
            }
          }
        }
      },
      output: ({ event }) => {
        spy(event);
      }
    });

    (yield* Effect.tap(createActor(machine), (a) => a.start));

    // `event.output` of `xstate.done.state.*` is `Option.none()`, not `undefined` (D8, SD-5):
    // the snapshot prints the Option; a "Tests not ported" row names the difference (SD-26)
    expect(spy.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "output": {
              "_id": "Option",
              "_tag": "None",
            },
            "type": "xstate.done.state.(machine)",
          },
        ],
      ]
    `);
  }));

  // upstream: test/final.test.ts > final states > root output should be called with a "xstate.done.state.*" event of the parallel root when a final descendant is reached 2 parallel levels deep
  it.effect('root output should be called with a "xstate.done.state.*" event of the parallel root when a final descendant is reached 2 parallel levels deep', () => Effect.gen(function* () {
    const spy = vi.fn();
    const machine = createMachine({
      type: 'parallel',
      states: {
        a: {
          type: 'parallel',
          states: {
            b: {
              initial: 'c',
              states: {
                c: {
                  type: 'final'
                }
              }
            }
          }
        }
      },
      output: ({ event }) => {
        spy(event);
      }
    });

    (yield* Effect.tap(createActor(machine), (a) => a.start));

    // `event.output` of `xstate.done.state.*` is `Option.none()`, not `undefined` (D8, SD-5):
    // the snapshot prints the Option; a "Tests not ported" row names the difference (SD-26)
    expect(spy.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "output": {
              "_id": "Option",
              "_tag": "None",
            },
            "type": "xstate.done.state.(machine)",
          },
        ],
      ]
    `);
  }));

  // upstream: test/final.test.ts > final states > onDone of an outer parallel state should be called with its own "xstate.done.state.*" event when its direct parallel child completes
  it.effect('onDone of an outer parallel state should be called with its own "xstate.done.state.*" event when its direct parallel child completes', () => Effect.gen(function* () {
    const spy = vi.fn();
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          type: 'parallel',
          states: {
            b: {
              type: 'parallel',
              states: {
                c: {
                  initial: 'd',
                  states: {
                    d: {
                      type: 'final'
                    }
                  }
                }
              }
            }
          },
          onDone: {
            actions: ({ event }) => {
              spy(event);
            }
          }
        }
      }
    });
    (yield* Effect.tap(createActor(machine), (a) => a.start));

    // `event.output` of `xstate.done.state.*` is `Option.none()`, not `undefined` (D8, SD-5):
    // the snapshot prints the Option; a "Tests not ported" row names the difference (SD-26)
    expect(spy.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "output": {
              "_id": "Option",
              "_tag": "None",
            },
            "type": "xstate.done.state.(machine).a",
          },
        ],
      ]
    `);
  }));

  // upstream: test/final.test.ts > final states > onDone should not be called when the machine reaches its final state
  it.effect('onDone should not be called when the machine reaches its final state', () => Effect.gen(function* () {
    const spy = vi.fn();
    const machine = createMachine({
      type: 'parallel',
      states: {
        a: {
          type: 'parallel',
          states: {
            b: {
              initial: 'c',
              states: {
                c: {
                  type: 'final'
                }
              },
              onDone: {
                actions: spy
              }
            }
          },
          onDone: {
            actions: spy
          }
        }
      },
      onDone: {
        actions: spy
      }
    });
    (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(spy).not.toHaveBeenCalled();
  }));

  // upstream: test/final.test.ts > final states > machine should not complete when a parallel child of a compound state completes
  it.effect('machine should not complete when a parallel child of a compound state completes', () => Effect.gen(function* () {
    const spy = vi.fn();
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          type: 'parallel',
          states: {
            b: {
              initial: 'c',
              states: {
                c: {
                  type: 'final'
                }
              }
            }
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect((yield* actorRef.getSnapshot).status).toBe('active');
  }));

  // upstream: test/final.test.ts > final states > root output should only be called once when multiple parallel regions complete at once
  it.effect('root output should only be called once when multiple parallel regions complete at once', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine({
      type: 'parallel',
      states: {
        a: {
          type: 'final'
        },
        b: {
          type: 'final'
        }
      },
      output: spy
    });

    (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(spy).toBeCalledTimes(1);
  }));

  // upstream: test/final.test.ts > final states > onDone of a parallel state should only be called once when multiple parallel regions complete at once
  it.effect('onDone of a parallel state should only be called once when multiple parallel regions complete at once', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          type: 'parallel',
          states: {
            b: {
              type: 'final'
            },
            c: {
              type: 'final'
            }
          },
          onDone: {
            actions: spy
          }
        }
      }
    });

    (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(spy).toBeCalledTimes(1);
  }));

  // upstream: test/final.test.ts > final states > should call exit actions in reversed document order when the machines reaches its final state
  it.effect('should call exit actions in reversed document order when the machines reaches its final state', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            EV: 'b'
          }
        },
        b: {
          type: 'final'
        }
      }
    });

    const flushTracked = trackEntries(machine);

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    flushTracked();

    // it's important to send an event here that results in a transition that computes new `state._nodes`
    // and that could impact the order in which exit actions are called
    (yield* actorRef.send({ type: 'EV' }));

    expect(flushTracked()).toEqual([
      // result of the transition
      'exit: a',
      'enter: b',
      // result of reaching final states
      'exit: b',
      'exit: __root__'
    ]);
  }));

  // upstream: test/final.test.ts > final states > should call exit actions of parallel states in reversed document order when the machines reaches its final state after earlier region transition
  it.effect('should call exit actions of parallel states in reversed document order when the machines reaches its final state after earlier region transition', () => Effect.gen(function* () {
    const machine = createMachine({
      type: 'parallel',
      states: {
        a: {
          initial: 'child_a1',
          states: {
            child_a1: {
              on: {
                EV2: 'child_a2'
              }
            },
            child_a2: {
              type: 'final'
            }
          }
        },
        b: {
          initial: 'child_b1',
          states: {
            child_b1: {
              on: {
                EV1: 'child_b2'
              }
            },
            child_b2: {
              type: 'final'
            }
          }
        }
      }
    });

    const flushTracked = trackEntries(machine);

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    // it's important to send an event here that results in a transition as that computes new `state._nodes`
    // and that could impact the order in which exit actions are called
    (yield* actorRef.send({ type: 'EV1' }));
    flushTracked();
    (yield* actorRef.send({ type: 'EV2' }));

    expect(flushTracked()).toEqual([
      // result of the transition
      'exit: a.child_a1',
      'enter: a.child_a2',
      // result of reaching final states
      'exit: b.child_b2',
      'exit: b',
      'exit: a.child_a2',
      'exit: a',
      'exit: __root__'
    ]);
  }));

  // upstream: test/final.test.ts > final states > should call exit actions of parallel states in reversed document order when the machines reaches its final state after later region transition
  it.effect('should call exit actions of parallel states in reversed document order when the machines reaches its final state after later region transition', () => Effect.gen(function* () {
    const machine = createMachine({
      type: 'parallel',
      states: {
        a: {
          initial: 'child_a1',
          states: {
            child_a1: {
              on: {
                EV2: 'child_a2'
              }
            },
            child_a2: {
              type: 'final'
            }
          }
        },
        b: {
          initial: 'child_b1',
          states: {
            child_b1: {
              on: {
                EV1: 'child_b2'
              }
            },
            child_b2: {
              type: 'final'
            }
          }
        }
      }
    });

    const flushTracked = trackEntries(machine);

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    // it's important to send an event here that results in a transition as that computes new `state._nodes`
    // and that could impact the order in which exit actions are called
    (yield* actorRef.send({ type: 'EV1' }));
    flushTracked();
    (yield* actorRef.send({ type: 'EV2' }));

    expect(flushTracked()).toEqual([
      // result of the transition
      'exit: a.child_a1',
      'enter: a.child_a2',
      // result of reaching final states
      'exit: b.child_b2',
      'exit: b',
      'exit: a.child_a2',
      'exit: a',
      'exit: __root__'
    ]);
  }));

  // upstream: test/final.test.ts > final states > should call exit actions of parallel states in reversed document order when the machines reaches its final state after multiple regions transition
  it.effect('should call exit actions of parallel states in reversed document order when the machines reaches its final state after multiple regions transition', () => Effect.gen(function* () {
    const machine = createMachine({
      type: 'parallel',
      states: {
        a: {
          initial: 'child_a1',
          states: {
            child_a1: {
              on: {
                EV: 'child_a2'
              }
            },
            child_a2: {
              type: 'final'
            }
          }
        },
        b: {
          initial: 'child_b1',
          states: {
            child_b1: {
              on: {
                EV: 'child_b2'
              }
            },
            child_b2: {
              type: 'final'
            }
          }
        }
      }
    });

    const flushTracked = trackEntries(machine);

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    flushTracked();
    // it's important to send an event here that results in a transition as that computes new `state._nodes`
    // and that could impact the order in which exit actions are called
    (yield* actorRef.send({ type: 'EV' }));

    expect(flushTracked()).toEqual([
      // result of the transition
      'exit: b.child_b1',
      'exit: a.child_a1',
      'enter: a.child_a2',
      'enter: b.child_b2',
      // result of reaching final states
      'exit: b.child_b2',
      'exit: b',
      'exit: a.child_a2',
      'exit: a',
      'exit: __root__'
    ]);
  }));

  // upstream: test/final.test.ts > final states > should not complete a parallel root immediately when only some of its regions are in their final states (final state reached in a compound region)
  it.effect('should not complete a parallel root immediately when only some of its regions are in their final states (final state reached in a compound region)', () => Effect.gen(function* () {
    const machine = createMachine({
      type: 'parallel',
      states: {
        A: {
          initial: 'A1',
          states: {
            A1: {
              type: 'final'
            }
          }
        },
        B: {
          initial: 'B1',
          states: {
            B1: {},
            B2: {
              type: 'final'
            }
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect((yield* actorRef.getSnapshot).status).toBe('active');
  }));

  // upstream: test/final.test.ts > final states > should not complete a parallel root immediately when only some of its regions are in their final states (a direct final child state reached)
  it.effect('should not complete a parallel root immediately when only some of its regions are in their final states (a direct final child state reached)', () => Effect.gen(function* () {
    const machine = createMachine({
      type: 'parallel',
      states: {
        A: {
          type: 'final'
        },
        B: {
          initial: 'B1',
          states: {
            B1: {},
            B2: {
              type: 'final'
            }
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect((yield* actorRef.getSnapshot).status).toBe('active');
  }));

  // upstream: test/final.test.ts > final states > should not resolve output of a final state if its parent is a parallel state
  it.effect('should not resolve output of a final state if its parent is a parallel state', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine({
      initial: 'A',
      states: {
        A: {
          type: 'parallel',
          states: {
            B: {
              type: 'final',
              output: spy
            },
            C: {
              initial: 'C1',
              states: {
                C1: {}
              }
            }
          }
        }
      }
    });

    (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(spy).not.toHaveBeenCalled();
  }));

  // upstream: test/final.test.ts > final states > should only call exit actions once when a child machine reaches its final state and sends an event to its parent that ends up stopping that child
  it.effect('should only call exit actions once when a child machine reaches its final state and sends an event to its parent that ends up stopping that child', () => Effect.gen(function* () {
    const spy = vi.fn();

    const child = createMachine({
      initial: 'start',
      exit: spy,
      states: {
        start: {
          on: {
            CANCEL: 'canceled'
          }
        },
        canceled: {
          type: 'final',
          entry: sendParent({ type: 'CHILD_CANCELED' })
        }
      }
    });
    const parent = createMachine({
      initial: 'start',
      states: {
        start: {
          invoke: {
            id: 'child',
            src: child,
            onDone: 'completed'
          },
          on: {
            CHILD_CANCELED: 'canceled'
          }
        },
        canceled: {},
        completed: {}
      }
    });

    const actorRef = (yield* Effect.tap(createActor(parent), (a) => a.start));

    (yield* (yield* actorRef.getSnapshot).children.child!.send({
      type: 'CANCEL'
    }));

    // the child's `sendParent` and its `xstate.done.actor.*` event enqueue (SD-23): let the
    // parent leave `start` (which stops the child), then let every enqueued delivery run, so
    // that a second exit call would be counted
    yield* yieldUntil(() =>
      Effect.map(actorRef.getSnapshot, (snapshot) => snapshot.value !== 'start')
    );
    yield* settle;

    expect(spy).toHaveBeenCalledTimes(1);
  }));

  // upstream: test/final.test.ts > final states > should deliver final outgoing events (from final entry action) to the parent before delivering the `xstate.done.actor.*` event
  it.effect('should deliver final outgoing events (from final entry action) to the parent before delivering the `xstate.done.actor.*` event', () => Effect.gen(function* () {
    const child = createMachine({
      initial: 'start',
      states: {
        start: {
          on: {
            CANCEL: 'canceled'
          }
        },
        canceled: {
          type: 'final',
          entry: sendParent({ type: 'CHILD_CANCELED' })
        }
      }
    });
    const parent = createMachine({
      initial: 'start',
      states: {
        start: {
          invoke: {
            id: 'child',
            src: child,
            onDone: 'completed'
          },
          on: {
            CHILD_CANCELED: 'canceled'
          }
        },
        canceled: {},
        completed: {}
      }
    });

    const actorRef = (yield* Effect.tap(createActor(parent), (a) => a.start));

    (yield* (yield* actorRef.getSnapshot).children.child!.send({
      type: 'CANCEL'
    }));

    // the child's `sendParent` and its `xstate.done.actor.*` event enqueue (SD-23): let the
    // first of them reach the parent before reading its value
    yield* yieldUntil(() =>
      Effect.map(actorRef.getSnapshot, (snapshot) => snapshot.value !== 'start')
    );

    // if `xstate.done.actor.*` would be delivered first the value would be `completed`
    expect((yield* actorRef.getSnapshot).value).toBe('canceled');
  }));

  // upstream: test/final.test.ts > final states > should deliver final outgoing events (from root exit action) to the parent before delivering the `xstate.done.actor.*` event
  it.effect('should deliver final outgoing events (from root exit action) to the parent before delivering the `xstate.done.actor.*` event', () => Effect.gen(function* () {
    const child = createMachine({
      initial: 'start',
      states: {
        start: {
          on: {
            CANCEL: 'canceled'
          }
        },
        canceled: {
          type: 'final'
        }
      },
      exit: sendParent({ type: 'CHILD_CANCELED' })
    });
    const parent = createMachine({
      initial: 'start',
      states: {
        start: {
          invoke: {
            id: 'child',
            src: child,
            onDone: 'completed'
          },
          on: {
            CHILD_CANCELED: 'canceled'
          }
        },
        canceled: {},
        completed: {}
      }
    });

    const actorRef = (yield* Effect.tap(createActor(parent), (a) => a.start));

    (yield* (yield* actorRef.getSnapshot).children.child!.send({
      type: 'CANCEL'
    }));

    // the child's `sendParent` and its `xstate.done.actor.*` event enqueue (SD-23): let the
    // first of them reach the parent before reading its value
    yield* yieldUntil(() =>
      Effect.map(actorRef.getSnapshot, (snapshot) => snapshot.value !== 'start')
    );

    // if `xstate.done.actor.*` would be delivered first the value would be `completed`
    expect((yield* actorRef.getSnapshot).value).toBe('canceled');
  }));

  // upstream: test/final.test.ts > final states > should be possible to complete with a null output (directly on root)
  it.effect('should be possible to complete with a null output (directly on root)', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'start',
      states: {
        start: {
          on: {
            NEXT: 'end'
          }
        },
        end: {
          type: 'final'
        }
      },
      output: null
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'NEXT' }));

    // `snapshot.output` is an `Option` (D8): a `null` output is `Option.some(null)`, because only
    // an `undefined` output is `Option.none()` (SD-7)
    expect((yield* actorRef.getSnapshot).output).toEqual(Option.some(null));
  }));

  // upstream: test/final.test.ts > final states > should be possible to complete with a null output (resolving with final state's output)
  it.effect("should be possible to complete with a null output (resolving with final state's output)", () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'start',
      states: {
        start: {
          on: {
            NEXT: 'end'
          }
        },
        end: {
          type: 'final',
          output: null
        }
      },
      output: ({ event }) => event.output
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'NEXT' }));

    // `event.output` of `xstate.done.state.*` and `snapshot.output` are both `Option` (D8, SD-5):
    // the final state's `null` output reaches the root mapper as `Option.some(null)`, and the
    // machine output is Some of the mapper result (S5); only `undefined` is `Option.none()` (SD-7)
    expect((yield* actorRef.getSnapshot).output).toEqual(Option.some(Option.some(null)));
  }));
});
