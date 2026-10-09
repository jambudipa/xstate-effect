import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { createActor, mapState, setup } from "../../src/index.js";

describe('mapState', () => {
  // upstream: test/mapState.test.ts > mapState > should map context from root state
  it.effect('should map context from root state', () => Effect.gen(function* () {
    const machine = setup({
      types: {
        context: {} as { count: number }
      }
    }).createMachine({
      context: { count: 42 },
      initial: 'a',
      states: {
        a: {}
      }
    });

    const snapshot = (yield* (yield* createActor(machine)).getSnapshot);

    const results = mapState(snapshot, {
      map: ({ context }) => context.count
    });

    expect(results.map((r) => r.result)).toContain(42);
  }));

  // upstream: test/mapState.test.ts > mapState > should map context from nested states
  it.effect('should map context from nested states', () => Effect.gen(function* () {
    const machine = setup({
      types: {
        context: {} as { value: string }
      }
    }).createMachine({
      context: { value: 'test' },
      initial: 'a',
      states: {
        a: {
          initial: 'one',
          states: {
            one: {},
            two: {}
          }
        }
      }
    });

    const snapshot = (yield* (yield* createActor(machine)).getSnapshot);

    const results = mapState(snapshot, {
      map: ({ context }) => `root:${context.value}`,
      states: {
        a: {
          map: ({ context }) => `a:${context.value}`,
          states: {
            one: {
              map: ({ context }) => `one:${context.value}`
            }
          }
        }
      }
    });

    const mapped = results.map((r) => r.result);
    expect(mapped).toContain('root:test');
    expect(results.find((r) => r.stateNode.key === '(machine)')?.result).toBe(
      'root:test'
    );
    expect(results.find((r) => r.stateNode.key === 'a')?.result).toBe('a:test');
    expect(results.find((r) => r.stateNode.key === 'one')?.result).toBe(
      'one:test'
    );
  }));

  // upstream: test/mapState.test.ts > mapState > should only call mappers for active states
  it.effect('should only call mappers for active states', () => Effect.gen(function* () {
    const machine = setup({
      types: {
        context: {} as { x: number }
      }
    }).createMachine({
      context: { x: 1 },
      initial: 'a',
      states: {
        a: {},
        b: {}
      }
    });

    const snapshot = (yield* (yield* createActor(machine)).getSnapshot);

    const results = mapState(snapshot, {
      map: () => 'root',
      states: {
        a: {
          map: () => 'a'
        },
        b: {
          map: () => 'b'
        }
      }
    });

    const mapped = results.map((r) => r.result);
    expect(mapped).toContain('root');
    expect(mapped).toContain('a');
    expect(mapped).not.toContain('b');
  }));

  // upstream: test/mapState.test.ts > mapState > should work with parallel states
  it.effect('should work with parallel states', () => Effect.gen(function* () {
    const machine = setup({
      types: {
        context: {} as { val: number }
      }
    }).createMachine({
      context: { val: 100 },
      type: 'parallel',
      states: {
        region1: {
          initial: 'x',
          states: {
            x: {},
            y: {}
          }
        },
        region2: {
          initial: 'p',
          states: {
            p: {},
            q: {}
          }
        }
      }
    });

    const snapshot = (yield* (yield* createActor(machine)).getSnapshot);

    const results = mapState(snapshot, {
      map: () => 'root',
      states: {
        region1: {
          map: () => 'region1',
          states: {
            x: {
              map: () => 'x'
            }
          }
        },
        region2: {
          map: () => 'region2',
          states: {
            p: {
              map: () => 'p'
            }
          }
        }
      }
    });

    const mapped = results.map((r) => r.result);
    expect(mapped).toContain('root');
    expect(mapped).toContain('region1');
    expect(mapped).toContain('x');
    expect(mapped).toContain('region2');
    expect(mapped).toContain('p');
    expect(results).toHaveLength(5);
  }));

  // upstream: test/mapState.test.ts > mapState > should handle states without mappers
  it.effect('should handle states without mappers', () => Effect.gen(function* () {
    const machine = setup({
      types: {
        context: {} as { n: number }
      }
    }).createMachine({
      context: { n: 5 },
      initial: 'a',
      states: {
        a: {
          initial: 'one',
          states: {
            one: {}
          }
        }
      }
    });

    const snapshot = (yield* (yield* createActor(machine)).getSnapshot);

    const results = mapState(snapshot, {
      map: () => 'root',
      states: {
        a: {
          map: () => 'a',
          states: {
            one: {
              map: () => 'one'
            }
          }
        }
      }
    });

    const mapped = results.map((r) => r.result);
    expect(mapped).toContain('root');
    expect(mapped).toContain('a');
    expect(mapped).toContain('one');
    expect(results).toHaveLength(3);
  }));

  // upstream: test/mapState.test.ts > mapState > should work with final states
  it.effect('should work with final states', () => Effect.gen(function* () {
    const machine = setup({}).createMachine({
      initial: 'active',
      states: {
        active: {
          on: { DONE: 'finished' }
        },
        finished: {
          type: 'final'
        }
      }
    });

    const actor = (yield* createActor(machine));
    (yield* actor.start);
    (yield* actor.send({ type: 'DONE' }));
    const snapshot = (yield* actor.getSnapshot);

    const results = mapState(snapshot, {
      map: () => 'root',
      states: {
        finished: {
          map: () => 'finished'
        }
      }
    });

    const mapped = results.map((r) => r.result);
    expect(mapped).toContain('root');
    expect(mapped).toContain('finished');
  }));

  // upstream: test/mapState.test.ts > mapState > should include stateNode in results
  it.effect('should include stateNode in results', () => Effect.gen(function* () {
    const machine = setup({}).createMachine({
      initial: 'a',
      states: {
        a: {
          initial: 'one',
          states: {
            one: {}
          }
        }
      }
    });

    const snapshot = (yield* (yield* createActor(machine)).getSnapshot);

    const results = mapState(snapshot, {
      map: () => 'root',
      states: {
        a: {
          map: () => 'a',
          states: {
            one: {
              map: () => 'one'
            }
          }
        }
      }
    });

    expect(results[0]!.stateNode.key).toBe('one');
    expect(results[0]!.result).toBe('one');
    expect(results[1]!.stateNode.key).toBe('a');
    expect(results[1]!.result).toBe('a');
    expect(results[2]!.stateNode.path).toEqual([]);
    expect(results[2]!.result).toBe('root');
  }));

  describe('type safety', () => {
    // upstream: test/mapState.test.ts > mapState > type safety > should accept valid state keys
    it.effect('should accept valid state keys', () => Effect.gen(function* () {
      const machine = setup({
        types: {
          context: {} as { foo: string }
        }
      }).createMachine({
        context: { foo: 'bar' },
        initial: 'idle',
        states: {
          idle: {},
          loading: {},
          success: {}
        }
      });

      const snapshot = (yield* (yield* createActor(machine)).getSnapshot);

      // This should compile without errors
      mapState(snapshot, {
        map: ({ context }) => context.foo,
        states: {
          idle: {
            map: ({ context }) => context.foo
          },
          loading: {
            map: ({ context }) => context.foo
          },
          success: {
            map: ({ context }) => context.foo
          }
        }
      });
    }));

    // upstream: test/mapState.test.ts > mapState > type safety > should error on invalid state keys
    it.effect('should error on invalid state keys', () => Effect.gen(function* () {
      const machine = setup({
        types: {
          context: {} as { foo: string }
        }
      }).createMachine({
        context: { foo: 'bar' },
        initial: 'idle',
        states: {
          idle: {},
          loading: {}
        }
      });

      const snapshot = (yield* (yield* createActor(machine)).getSnapshot);

      mapState(snapshot, {
        map: ({ context }) => context.foo,
        states: {
          idle: {
            map: ({ context }) => context.foo
          },
          // @ts-expect-error - 'nonexistent' is not a valid state key
          nonexistent: {
            map: (_snapshot: any) => _snapshot.context.foo
          }
        }
      });
    }));

    // upstream: test/mapState.test.ts > mapState > type safety > should error on invalid nested state keys
    it.effect('should error on invalid nested state keys', () => Effect.gen(function* () {
      const machine = setup({
        types: {
          context: {} as { val: number }
        }
      }).createMachine({
        context: { val: 0 },
        initial: 'parent',
        states: {
          parent: {
            initial: 'child1',
            states: {
              child1: {},
              child2: {}
            }
          }
        }
      });

      const snapshot = (yield* (yield* createActor(machine)).getSnapshot);

      mapState(snapshot, {
        map: ({ context }) => context.val,
        states: {
          parent: {
            map: ({ context }) => context.val,
            states: {
              child1: {
                map: ({ context }) => context.val
              },
              // @ts-expect-error - 'invalidChild' is not a valid nested state key
              invalidChild: {
                map: (_snapshot: any) => _snapshot.context.val
              }
            }
          }
        }
      });
    }));

    // upstream: test/mapState.test.ts > mapState > type safety > should infer snapshot type in map function
    it.effect('should infer snapshot type in map function', () => Effect.gen(function* () {
      const machine = setup({
        types: {
          context: {} as { count: number; name: string }
        }
      }).createMachine({
        context: { count: 0, name: 'test' },
        initial: 'idle',
        states: {
          idle: {}
        }
      });

      const snapshot = (yield* (yield* createActor(machine)).getSnapshot);

      mapState(snapshot, {
        map: ({ context }) => {
          // These should all be valid
          const n: number = context.count;
          const s: string = context.name;
          return { n, s };
        }
      });
    }));

    // upstream: test/mapState.test.ts > mapState > type safety > should enforce consistent TResult type across all map functions
    it.effect('should enforce consistent TResult type across all map functions', () => Effect.gen(function* () {
      const machine = setup({
        types: {
          context: {} as { count: number }
        }
      }).createMachine({
        context: { count: 0 },
        initial: 'a',
        states: {
          a: {
            initial: 'one',
            states: {
              one: {}
            }
          }
        }
      });

      const snapshot = (yield* (yield* createActor(machine)).getSnapshot);

      // All returning number - should work
      mapState<typeof snapshot, number>(snapshot, {
        map: () => 42,
        states: {
          a: {
            map: () => 100,
            states: {
              one: {
                map: () => 200
              }
            }
          }
        }
      });
    }));

    // upstream: test/mapState.test.ts > mapState > type safety > should error when nested map returns wrong type
    it.effect('should error when nested map returns wrong type', () => Effect.gen(function* () {
      const machine = setup({
        types: {
          context: {} as { count: number }
        }
      }).createMachine({
        context: { count: 0 },
        initial: 'a',
        states: {
          a: {}
        }
      });

      const snapshot = (yield* (yield* createActor(machine)).getSnapshot);

      mapState<typeof snapshot, number>(snapshot, {
        map: () => 42,
        states: {
          a: {
            // @ts-expect-error - boolean is not assignable to number
            map: () => true
          }
        }
      });
    }));

    // upstream: test/mapState.test.ts > mapState > type safety > should error when deeply nested map returns wrong type
    it.effect('should error when deeply nested map returns wrong type', () => Effect.gen(function* () {
      const machine = setup({
        types: {
          context: {} as { val: string }
        }
      }).createMachine({
        context: { val: 'test' },
        initial: 'parent',
        states: {
          parent: {
            initial: 'child',
            states: {
              child: {}
            }
          }
        }
      });

      const snapshot = (yield* (yield* createActor(machine)).getSnapshot);

      mapState<typeof snapshot, string>(snapshot, {
        map: () => 'root',
        states: {
          parent: {
            map: () => 'parent',
            states: {
              child: {
                // @ts-expect-error - number is not assignable to string
                map: () => 123
              }
            }
          }
        }
      });
    }));

    // upstream: test/mapState.test.ts > mapState > type safety > should infer result type in return value
    it.effect('should infer result type in return value', () => Effect.gen(function* () {
      const machine = setup({}).createMachine({
        initial: 'idle',
        states: {
          idle: {}
        }
      });

      const snapshot = (yield* (yield* createActor(machine)).getSnapshot);

      const results = mapState<typeof snapshot, number>(snapshot, {
        map: () => 42
      });

      // result should be typed as number, not unknown
      results[0]!.result satisfies number;
      // @ts-expect-error
      results[0]!.result satisfies string;
    }));
  });
});
