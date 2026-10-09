import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { assign, createActor, setup } from "../../src/index.js";

describe('route', () => {
  // upstream: test/route.test.ts > route > should transition directly to a route if route is an empty transition config
  it.effect('should transition directly to a route if route is an empty transition config', () => Effect.gen(function* () {
    const machine = setup({}).createMachine({
      id: 'test',
      initial: 'a',
      states: {
        a: {},
        b: {
          id: 'b',
          route: {}
        },
        c: {}
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actor.send({
      type: 'xstate.route',
      to: '#b'
    }));

    expect((yield* actor.getSnapshot).value).toEqual('b');

    // c has no route, so this should not transition
    (yield* actor.send({
      type: 'xstate.route',
      to: '#c'
    } as any));

    expect((yield* actor.getSnapshot).value).toEqual('b');
  }));

  // upstream: test/route.test.ts > route > should transition directly to a route if guard passes
  it.effect('should transition directly to a route if guard passes', () => Effect.gen(function* () {
    const machine = setup({}).createMachine({
      id: 'test',
      initial: 'a',
      states: {
        a: {},
        b: {
          id: 'b',
          route: {
            guard: () => false
          }
        },
        c: {
          id: 'c',
          route: {
            guard: () => true
          }
        }
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect((yield* actor.getSnapshot).value).toEqual('a');

    (yield* actor.send({
      type: 'xstate.route',
      to: '#b'
    }));

    expect((yield* actor.getSnapshot).value).toEqual('a');

    (yield* actor.send({
      type: 'xstate.route',
      to: '#c'
    }));

    expect((yield* actor.getSnapshot).value).toEqual('c');
  }));

  // upstream: test/route.test.ts > route > should resolve setup-registered string guards on route transitions
  it.effect('should resolve setup-registered string guards on route transitions', () => Effect.gen(function* () {
    const machine = setup({
      types: {
        context: {} as { ready: boolean }
      },
      guards: {
        isReady: ({ context }) => context.ready
      }
    }).createMachine({
      id: 'flow',
      initial: 'amount',
      context: {
        ready: false
      },
      states: {
        amount: {
          id: 'amount',
          route: {},
          on: {
            READY: {
              actions: assign({ ready: true })
            }
          }
        },
        review: {
          id: 'review',
          route: {
            guard: 'isReady'
          }
        }
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actor.send({
      type: 'xstate.route',
      to: '#review'
    }));

    expect((yield* actor.getSnapshot).value).toEqual('amount');

    (yield* actor.send({ type: 'READY' }));
    (yield* actor.send({
      type: 'xstate.route',
      to: '#review'
    }));

    expect((yield* actor.getSnapshot).value).toEqual('review');
  }));

  // upstream: test/route.test.ts > route > should work with parallel states
  it.effect('should work with parallel states', () => Effect.gen(function* () {
    const todoMachine = setup({}).createMachine({
      id: 'todos',
      type: 'parallel',
      states: {
        todo: {
          initial: 'new',
          states: {
            new: {},
            editing: {}
          }
        },
        filter: {
          initial: 'all',
          states: {
            all: {
              id: 'filter-all',
              route: {}
            },
            active: {
              id: 'filter-active',
              route: {}
            },
            completed: {
              id: 'filter-completed',
              route: {}
            }
          }
        }
      }
    });

    const todoActor = (yield* Effect.tap(createActor(todoMachine), (a) => a.start));

    expect((yield* todoActor.getSnapshot).value).toEqual({
      todo: 'new',
      filter: 'all'
    });

    (yield* todoActor.send({
      type: 'xstate.route',
      to: '#filter-active'
    }));

    expect((yield* todoActor.getSnapshot).value).toEqual({
      todo: 'new',
      filter: 'active'
    });
  }));

  // upstream: test/route.test.ts > route > route events are strongly typed
  it.effect('route events are strongly typed', () => Effect.gen(function* () {
    const machine = setup({
      types: {
        events: {} as never
      }
    }).createMachine({
      id: 'root',
      initial: 'aRoute',
      states: {
        aRoute: {
          id: 'aRoute',
          route: {}
        },
        notARoute: {
          initial: 'childRoute',
          states: {
            childRoute: {
              id: 'childRoute',
              route: {}
            }
          }
        }
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actor.send({
      type: 'xstate.route',
      to: '#aRoute'
    }));

    (yield* actor.send({
      type: 'xstate.route',
      to: '#childRoute'
    }));

    (yield* actor.send({
      type: 'xstate.route',
      // @ts-expect-error - 'notARoute' has no route config
      to: 'notARoute'
    }));

    (yield* actor.send({
      type: 'xstate.route',
      // @ts-expect-error - 'root' is not routable
      to: 'root'
    }));

    (yield* actor.send({
      type: 'xstate.route',
      // @ts-expect-error - 'blahblah' does not exist
      to: 'blahblah'
    }));
  }));

  // upstream: test/route.test.ts > route > route config without id should not generate route events
  it.effect('route config without id should not generate route events', () => Effect.gen(function* () {
    const machine = setup({
      types: {
        events: {} as never
      }
    }).createMachine({
      id: 'test',
      initial: 'a',
      states: {
        a: {
          // route without id — should NOT be routable
          route: {}
        },
        b: {
          id: 'b',
          route: {}
        }
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    // Only 'b' should be a valid route target
    (yield* actor.send({
      type: 'xstate.route',
      to: '#b'
    }));

    expect((yield* actor.getSnapshot).value).toEqual('b');
  }));

  // upstream: test/route.test.ts > route > machine.root.on should include route events
  it.effect('machine.root.on should include route events', () => Effect.gen(function* () {
    const machine = setup({}).createMachine({
      id: 'test',
      initial: 'a',
      states: {
        a: {},
        b: {
          id: 'b',
          route: {}
        },
        c: {
          id: 'c',
          route: {
            guard: () => true
          }
        }
      }
    });

    expect(machine.root.on['xstate.route']).toBeDefined();
  }));

  // upstream: test/route.test.ts > route > nested state on should include route events for child routes
  it.effect('nested state on should include route events for child routes', () => Effect.gen(function* () {
    const machine = setup({}).createMachine({
      id: 'app',
      initial: 'home',
      states: {
        home: {
          id: 'home',
          route: {}
        },
        dashboard: {
          id: 'dashboard',
          initial: 'overview',
          route: {},
          states: {
            overview: {
              id: 'overview',
              route: {}
            },
            settings: {
              id: 'settings',
              route: {}
            }
          }
        }
      }
    });

    const a = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* a.send({
      type: 'xstate.route',
      to: '#overview'
    }));

    expect((yield* a.getSnapshot).value).toEqual({ dashboard: 'overview' });

    // All routes should be accessible via 'xstate.route'
    expect(machine.root.on['xstate.route']).toBeDefined();
  }));

  // upstream: test/route.test.ts > route > parallel state on should include route events
  it.effect('parallel state on should include route events', () => Effect.gen(function* () {
    const machine = setup({}).createMachine({
      id: 'todos',
      type: 'parallel',
      states: {
        list: {
          initial: 'idle',
          states: {
            idle: {},
            loading: {}
          }
        },
        filter: {
          initial: 'all',
          states: {
            all: {
              id: 'filter-all',
              route: {}
            },
            active: {
              id: 'filter-active',
              route: {}
            },
            completed: {
              id: 'filter-completed',
              route: {}
            }
          }
        }
      }
    });

    // Routes should be accessible
    expect(machine.root.on['xstate.route']).toBeDefined();
  }));

  // upstream: test/route.test.ts > route > should route to deeply nested state from anywhere
  it.effect('should route to deeply nested state from anywhere', () => Effect.gen(function* () {
    const machine = setup({}).createMachine({
      id: 'app',
      initial: 'home',
      states: {
        home: {
          id: 'home',
          route: {}
        },
        dashboard: {
          initial: 'overview',
          states: {
            overview: {
              id: 'overview',
              route: {}
            }
          }
        }
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    // Should be able to route to deeply nested state from root
    expect((yield* actor.getSnapshot).value).toEqual('home');

    (yield* actor.send({ type: 'xstate.route', to: '#overview' }));

    expect((yield* actor.getSnapshot).value).toEqual({ dashboard: 'overview' });
  }));

  // upstream: test/route.test.ts > route > should re-enter when routing to the current state
  it.effect('should re-enter when routing to the current state', () => Effect.gen(function* () {
    let entries = 0;
    const machine = setup({}).createMachine({
      id: 'test',
      initial: 'a',
      states: {
        a: {
          id: 'a',
          route: {},
          entry: () => {
            entries++;
          }
        }
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
    expect((yield* actor.getSnapshot).value).toEqual('a');
    entries = 0;

    (yield* actor.send({ type: 'xstate.route', to: '#a' }));

    expect((yield* actor.getSnapshot).value).toEqual('a');
    expect(entries).toEqual(1);
  }));

  // upstream: test/route.test.ts > route > should route to self with guard
  it.effect('should route to self with guard', () => Effect.gen(function* () {
    let allowed = false;
    let entries = 0;
    const machine = setup({}).createMachine({
      id: 'test',
      initial: 'a',
      states: {
        a: {
          id: 'a',
          route: {
            guard: () => allowed
          },
          entry: () => {
            entries++;
          }
        },
        b: { id: 'b', route: {} }
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
    entries = 0;

    (yield* actor.send({ type: 'xstate.route', to: '#a' }));
    expect(entries).toEqual(0);

    allowed = true;
    (yield* actor.send({ type: 'xstate.route', to: '#a' }));
    expect(entries).toEqual(1);
  }));

  // upstream: test/route.test.ts > route > should not route using dot-separated nested id like #id.nested
  it.effect('should not route using dot-separated nested id like #id.nested', () => Effect.gen(function* () {
    const machine = setup({
      types: {
        // needed to avoid AnyEventObject widening
        events: {} as never
      }
    }).createMachine({
      id: 'app',
      initial: 'home',
      states: {
        home: {
          id: 'home',
          route: {}
        },
        dashboard: {
          id: 'dashboard',
          initial: 'overview',
          route: {},
          states: {
            overview: {
              id: 'overview',
              route: {}
            }
          }
        }
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect((yield* actor.getSnapshot).value).toEqual('home');

    // Dot-separated ids should not work as route targets
    (yield* actor.send({
      type: 'xstate.route',
      // @ts-expect-error - dot-separated ids are not valid route targets
      to: '#dashboard.overview'
    }));

    expect((yield* actor.getSnapshot).value).toEqual('home');
  }));
});
