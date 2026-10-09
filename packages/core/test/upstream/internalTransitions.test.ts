import { describe, expect, it, vi } from "@effect/vitest"
import { Effect } from "effect"
import { createMachine, createActor, assign } from "../../src/index.js";
import { trackEntries } from "./trackEntries.js";

describe('internal transitions', () => {
  // upstream: test/internalTransitions.test.ts > internal transitions > parent state should enter child state without re-entering self
  it.effect('parent state should enter child state without re-entering self', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'foo',
      states: {
        foo: {
          initial: 'a',
          states: {
            a: {},
            b: {}
          },
          on: {
            CLICK: '.b'
          }
        }
      }
    });

    const flushTracked = trackEntries(machine);
    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
    flushTracked();

    (yield* actor.send({
      type: 'CLICK'
    }));

    expect((yield* actor.getSnapshot).value).toEqual({ foo: 'b' });
    expect(flushTracked()).toEqual(['exit: foo.a', 'enter: foo.b']);
  }));

  // upstream: test/internalTransitions.test.ts > internal transitions > parent state should re-enter self upon transitioning to child state if transition is reentering
  it.effect('parent state should re-enter self upon transitioning to child state if transition is reentering', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'foo',
      states: {
        foo: {
          initial: 'left',
          states: {
            left: {},
            right: {}
          },
          on: {
            NEXT: {
              target: '.right',
              reenter: true
            }
          }
        }
      }
    });

    const flushTracked = trackEntries(machine);
    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
    flushTracked();

    (yield* actor.send({
      type: 'NEXT'
    }));

    expect((yield* actor.getSnapshot).value).toEqual({ foo: 'right' });
    expect(flushTracked()).toEqual([
      'exit: foo.left',
      'exit: foo',
      'enter: foo',
      'enter: foo.right'
    ]);
  }));

  // upstream: test/internalTransitions.test.ts > internal transitions > parent state should only exit/reenter if there is an explicit self-transition
  it.effect('parent state should only exit/reenter if there is an explicit self-transition', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'foo',
      states: {
        foo: {
          initial: 'a',
          states: {
            a: {
              on: {
                NEXT: 'b'
              }
            },
            b: {}
          },
          on: {
            RESET: {
              target: 'foo',
              reenter: true
            }
          }
        }
      }
    });

    const flushTracked = trackEntries(machine);
    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actor.send({
      type: 'NEXT'
    }));
    flushTracked();

    (yield* actor.send({
      type: 'RESET'
    }));

    expect((yield* actor.getSnapshot).value).toEqual({ foo: 'a' });
    expect(flushTracked()).toEqual([
      'exit: foo.b',
      'exit: foo',
      'enter: foo',
      'enter: foo.a'
    ]);
  }));

  // upstream: test/internalTransitions.test.ts > internal transitions > parent state should only exit/reenter if there is an explicit self-transition (to child)
  it.effect('parent state should only exit/reenter if there is an explicit self-transition (to child)', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'foo',
      states: {
        foo: {
          initial: 'a',
          states: {
            a: {},
            b: {}
          },
          on: {
            RESET_TO_B: {
              target: 'foo.b',
              reenter: true
            }
          }
        }
      }
    });

    const flushTracked = trackEntries(machine);
    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
    flushTracked();

    (yield* actor.send({
      type: 'RESET_TO_B'
    }));

    expect((yield* actor.getSnapshot).value).toEqual({ foo: 'b' });
    expect(flushTracked()).toEqual([
      'exit: foo.a',
      'exit: foo',
      'enter: foo',
      'enter: foo.b'
    ]);
  }));

  // upstream: test/internalTransitions.test.ts > internal transitions > should listen to events declared at top state
  it.effect('should listen to events declared at top state', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'foo',
      on: {
        CLICKED: '.bar'
      },
      states: {
        foo: {},
        bar: {}
      }
    });
    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actor.send({
      type: 'CLICKED'
    }));

    expect((yield* actor.getSnapshot).value).toEqual('bar');
  }));

  // upstream: test/internalTransitions.test.ts > internal transitions > should work with targetless transitions (in conditional array)
  it.effect('should work with targetless transitions (in conditional array)', () => Effect.gen(function* () {
    const spy = vi.fn();
    const machine = createMachine({
      initial: 'foo',
      states: {
        foo: {
          on: {
            TARGETLESS_ARRAY: [{ actions: [spy] }]
          }
        }
      }
    });
    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actor.send({
      type: 'TARGETLESS_ARRAY'
    }));
    expect(spy).toHaveBeenCalled();
  }));

  // upstream: test/internalTransitions.test.ts > internal transitions > should work with targetless transitions (in object)
  it.effect('should work with targetless transitions (in object)', () => Effect.gen(function* () {
    const spy = vi.fn();
    const machine = createMachine({
      initial: 'foo',
      states: {
        foo: {
          on: {
            TARGETLESS_OBJECT: { actions: [spy] }
          }
        }
      }
    });
    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actor.send({
      type: 'TARGETLESS_OBJECT'
    }));
    expect(spy).toHaveBeenCalled();
  }));

  // upstream: test/internalTransitions.test.ts > internal transitions > should work on parent with targetless transitions (in conditional array)
  it.effect('should work on parent with targetless transitions (in conditional array)', () => Effect.gen(function* () {
    const spy = vi.fn();
    const machine = createMachine({
      on: {
        TARGETLESS_ARRAY: [{ actions: [spy] }]
      },
      initial: 'foo',
      states: { foo: {} }
    });
    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actor.send({
      type: 'TARGETLESS_ARRAY'
    }));
    expect(spy).toHaveBeenCalled();
  }));

  // upstream: test/internalTransitions.test.ts > internal transitions > should work on parent with targetless transitions (in object)
  it.effect('should work on parent with targetless transitions (in object)', () => Effect.gen(function* () {
    const spy = vi.fn();
    const machine = createMachine({
      on: {
        TARGETLESS_OBJECT: { actions: [spy] }
      },
      initial: 'foo',
      states: { foo: {} }
    });
    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actor.send({
      type: 'TARGETLESS_OBJECT'
    }));
    expect(spy).toHaveBeenCalled();
  }));

  // upstream: test/internalTransitions.test.ts > internal transitions > should maintain the child state when targetless transition is handled by parent
  it.effect('should maintain the child state when targetless transition is handled by parent', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'foo',
      on: {
        PARENT_EVENT: { actions: () => {} }
      },
      states: {
        foo: {}
      }
    });
    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actor.send({
      type: 'PARENT_EVENT'
    }));

    expect((yield* actor.getSnapshot).value).toEqual('foo');
  }));

  // upstream: test/internalTransitions.test.ts > internal transitions > should reenter proper descendants of a source state of an internal transition
  it.effect('should reenter proper descendants of a source state of an internal transition', () => Effect.gen(function* () {
    const machine = createMachine({
      types: {} as {
        context: {
          sourceStateEntries: number;
          directDescendantEntries: number;
          deepDescendantEntries: number;
        };
      },
      context: {
        sourceStateEntries: 0,
        directDescendantEntries: 0,
        deepDescendantEntries: 0
      },
      initial: 'a1',
      states: {
        a1: {
          initial: 'a11',
          entry: assign({
            sourceStateEntries: ({ context }) => context.sourceStateEntries + 1
          }),
          states: {
            a11: {
              initial: 'a111',
              entry: assign({
                directDescendantEntries: ({ context }) =>
                  context.directDescendantEntries + 1
              }),
              states: {
                a111: {
                  entry: assign({
                    deepDescendantEntries: ({ context }) =>
                      context.deepDescendantEntries + 1
                  })
                }
              }
            }
          },
          on: {
            REENTER: '.a11.a111'
          }
        }
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* service.send({ type: 'REENTER' }));

    expect((yield* service.getSnapshot).context).toEqual({
      sourceStateEntries: 1,
      directDescendantEntries: 2,
      deepDescendantEntries: 2
    });
  }));

  // upstream: test/internalTransitions.test.ts > internal transitions > should exit proper descendants of a source state of an internal transition
  it.effect('should exit proper descendants of a source state of an internal transition', () => Effect.gen(function* () {
    const machine = createMachine({
      types: {} as {
        context: {
          sourceStateExits: number;
          directDescendantExits: number;
          deepDescendantExits: number;
        };
      },
      context: {
        sourceStateExits: 0,
        directDescendantExits: 0,
        deepDescendantExits: 0
      },
      initial: 'a1',
      states: {
        a1: {
          initial: 'a11',
          exit: assign({
            sourceStateExits: ({ context }) => context.sourceStateExits + 1
          }),
          states: {
            a11: {
              initial: 'a111',
              exit: assign({
                directDescendantExits: ({ context }) =>
                  context.directDescendantExits + 1
              }),
              states: {
                a111: {
                  exit: assign({
                    deepDescendantExits: ({ context }) =>
                      context.deepDescendantExits + 1
                  })
                }
              }
            }
          },
          on: {
            REENTER: '.a11.a111'
          }
        }
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* service.send({ type: 'REENTER' }));

    expect((yield* service.getSnapshot).context).toEqual({
      sourceStateExits: 0,
      directDescendantExits: 1,
      deepDescendantExits: 1
    });
  }));
});
