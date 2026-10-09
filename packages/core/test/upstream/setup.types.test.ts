import { describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import {
  ActorRefFrom,
  and,
  assign,
  cancel,
  ContextFrom,
  createActor,
  createMachine,
  emit,
  enqueueActions,
  EventFrom,
  fromPromise,
  fromTransition,
  log,
  not,
  or,
  raise,
  sendParent,
  sendTo,
  setup,
  spawnChild,
  stopChild
} from "../../src/index.js";

describe('setup()', () => {
  // upstream: test/setup.types.test.ts > setup() > should be able to define a simple function guard
  it.effect('should be able to define a simple function guard', () => Effect.gen(function* () {
    setup({
      guards: {
        check: () => true
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should be able to define a function guard with params
  it.effect('should be able to define a function guard with params', () => Effect.gen(function* () {
    setup({
      guards: {
        check: (_, params: number) => true
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should be able to define a function guard that depends on context
  it.effect('should be able to define a function guard that depends on context', () => Effect.gen(function* () {
    setup({
      types: {} as {
        context: { enabled: boolean };
      },
      guards: {
        check: ({ context }) => context.enabled
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should be able to define a `not` guard referencing another defined simple function guard using a string
  it.effect('should be able to define a `not` guard referencing another defined simple function guard using a string', () => Effect.gen(function* () {
    setup({
      guards: {
        check: () => true,
        opposite: not('check')
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept a `not` guard referencing an unknown guard using a string
  it.effect('should not accept a `not` guard referencing an unknown guard using a string', () => Effect.gen(function* () {
    setup({
      guards: {
        check: () => true,
        // @ts-expect-error
        opposite: not('unknown')
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should be able to define a `not` guard referencing another defined simple function guard using an object
  it.effect('should be able to define a `not` guard referencing another defined simple function guard using an object', () => Effect.gen(function* () {
    setup({
      guards: {
        check: () => true,
        opposite: not({
          type: 'check'
        })
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept a `not` guard referencing an unknown guard using an object
  it.effect('should not accept a `not` guard referencing an unknown guard using an object', () => Effect.gen(function* () {
    setup({
      guards: {
        check: () => true,
        // @ts-expect-error
        opposite: not({
          type: 'unknown'
        })
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should be able to define a `not` guard referencing another guard with its required params
  it.effect('should be able to define a `not` guard referencing another guard with its required params', () => Effect.gen(function* () {
    setup({
      guards: {
        check: (_, params: string) => true,
        opposite: not({
          type: 'check',
          params: 'bar'
        })
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept a `not` guard referencing another guard using a string without its required params
  it.effect('should not accept a `not` guard referencing another guard using a string without its required params', () => Effect.gen(function* () {
    setup({
      guards: {
        check: (_, params: string) => true,
        // @ts-expect-error
        opposite: not('check')
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept a `not` guard referencing another guard using an object without its required params
  it.effect('should not accept a `not` guard referencing another guard using an object without its required params', () => Effect.gen(function* () {
    setup({
      guards: {
        check: (_, params: string) => true,
        // @ts-expect-error
        opposite: not({
          type: 'check'
        })
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should be able to define a `not` guard referencing another guard with a required mutable array params
  it.effect('should be able to define a `not` guard referencing another guard with a required mutable array params', () => Effect.gen(function* () {
    setup({
      guards: {
        check: (_, params: string[]) => true,
        opposite: not({
          type: 'check',
          params: ['bar', 'baz']
        })
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should be able to define a `not` guard that embeds an inline function guard
  it.effect('should be able to define a `not` guard that embeds an inline function guard', () => Effect.gen(function* () {
    setup({
      guards: {
        opposite: not(() => true)
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should be able to define a `not` guard that embeds an inline function guard that depends on context
  it.effect('should be able to define a `not` guard that embeds an inline function guard that depends on context', () => Effect.gen(function* () {
    setup({
      types: {} as {
        context: { enabled: boolean };
      },
      guards: {
        opposite: not(({ context }) => context.enabled)
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not be able to define a `not` guard that embeds an inline function guard with params
  it.effect('should not be able to define a `not` guard that embeds an inline function guard with params', () => Effect.gen(function* () {
    setup({
      types: {} as {
        // TODO: without TContext candidate here the `not` infers the outer `TContext` type variable
        // that looks like a bug in TypeScript, it should infer its constraint.
        // It would be great to create a repro case for this problem
        context: { counter: number };
      },
      guards: {
        opposite: not(
          // @ts-expect-error
          (_, params: string) => true
        )
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should be able to define an `and` guard that references multiple different guards using strings
  it.effect('should be able to define an `and` guard that references multiple different guards using strings', () => Effect.gen(function* () {
    setup({
      guards: {
        check1: () => true,
        check2: () => true,
        combinedCheck: and(['check1', 'check2'])
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept an `and` guard referencing an unknown guard using a string
  it.effect('should not accept an `and` guard referencing an unknown guard using a string', () => Effect.gen(function* () {
    setup({
      guards: {
        check1: () => true,
        check2: () => true,
        // @ts-expect-error
        combinedCheck: and(['check1', 'unknown'])
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should be able to define an `and` guard that references multiple different guards using objects
  it.effect('should be able to define an `and` guard that references multiple different guards using objects', () => Effect.gen(function* () {
    setup({
      guards: {
        check1: (_, params: string) => true,
        check2: (_, params: number) => true,
        combinedCheck: and([
          {
            type: 'check1',
            params: 'bar'
          },
          {
            type: 'check2',
            params: 42
          }
        ])
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should be able to define an `and` guard that references multiple different guards using both strings and objects
  it.effect('should be able to define an `and` guard that references multiple different guards using both strings and objects', () => Effect.gen(function* () {
    setup({
      guards: {
        check1: (_) => true,
        check2: (_, params: number) => true,
        combinedCheck: and([
          'check1',
          {
            type: 'check2',
            params: 42
          }
        ])
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept an `and` guard referencing another guard using a string without its required params
  it.effect('should not accept an `and` guard referencing another guard using a string without its required params', () => Effect.gen(function* () {
    setup({
      guards: {
        check1: (_) => true,
        check2: (_, params: number) => true,
        // @ts-expect-error
        combinedCheck: and(['check1', 'check2'])
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept an `and` guard referencing another guard using an object without its required params
  it.effect('should not accept an `and` guard referencing another guard using an object without its required params', () => Effect.gen(function* () {
    setup({
      guards: {
        check1: (_) => true,
        check2: (_, params: number) => true,
        // @ts-expect-error
        combinedCheck: and([
          'check1',
          {
            type: 'check2'
          }
        ])
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should be able to define an `and` guard that embeds an inline `not` guard referencing another guard using a string
  it.effect('should be able to define an `and` guard that embeds an inline `not` guard referencing another guard using a string', () => Effect.gen(function* () {
    setup({
      guards: {
        check1: (_) => true,
        check2: (_) => true,
        combinedCheck: and(['check1', not('check2')])
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept an `and` guard that embeds an inline `not` guard referencing an unknown guard using a string
  it.effect('should not accept an `and` guard that embeds an inline `not` guard referencing an unknown guard using a string', () => Effect.gen(function* () {
    setup({
      guards: {
        check1: (_) => true,
        check2: (_) => true,
        // @ts-expect-error
        combinedCheck: and(['check1', not('unknown')])
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should be able to define an `and` guard that embeds an inline `not` guard referencing another guard using an object
  it.effect('should be able to define an `and` guard that embeds an inline `not` guard referencing another guard using an object', () => Effect.gen(function* () {
    setup({
      guards: {
        check1: (_) => true,
        check2: (_) => true,
        combinedCheck: and([
          'check1',
          not({
            type: 'check2'
          })
        ])
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept an `and` guard that embeds an inline `not` guard referencing an unknown guard using an object
  it.effect('should not accept an `and` guard that embeds an inline `not` guard referencing an unknown guard using an object', () => Effect.gen(function* () {
    setup({
      guards: {
        check1: (_) => true,
        check2: (_) => true,
        // @ts-expect-error
        combinedCheck: and([
          'check1',
          not({
            type: 'unknown'
          })
        ])
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should be able to define an `and` guard that embeds an inline `not` guard embedding an inline function guard
  it.effect('should be able to define an `and` guard that embeds an inline `not` guard embedding an inline function guard', () => Effect.gen(function* () {
    setup({
      guards: {
        check1: (_) => true,
        check2: (_) => true,
        combinedCheck: and(['check1', not(() => true)])
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should be able to use a parameterized `assign` action with its required params in the machine
  it.effect('should be able to use a parameterized `assign` action with its required params in the machine', () => Effect.gen(function* () {
    setup({
      types: {} as {
        context: {
          count: number;
        };
      },
      actions: {
        resetTo: assign((_, params: number) => ({
          count: params
        }))
      }
    }).createMachine({
      context: {
        count: 0
      },
      entry: {
        type: 'resetTo',
        params: 0
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept a string reference to parameterized `assign` without its required params in the machine
  it.effect('should not accept a string reference to parameterized `assign` without its required params in the machine', () => Effect.gen(function* () {
    setup({
      types: {} as {
        context: {
          count: number;
        };
      },
      actions: {
        resetTo: assign((_, params: number) => ({
          count: params
        }))
      }
    }).createMachine({
      // @ts-expect-error
      entry: 'resetTo'
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept an object reference to parameterized `assign` without its required params in the machine #1
  it.effect('should not accept an object reference to parameterized `assign` without its required params in the machine', () => Effect.gen(function* () {
    setup({
      types: {} as {
        context: {
          count: number;
        };
      },
      actions: {
        resetTo: assign((_, params: number) => ({
          count: params
        }))
      }
    }).createMachine({
      // @ts-expect-error
      entry: {
        type: 'resetTo'
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept an object reference to parameterized `assign` without its required params in the machine #2
  it.effect('should not accept an object reference to parameterized `assign` without its required params in the machine', () => Effect.gen(function* () {
    setup({
      types: {} as {
        context: {
          count: number;
        };
      },
      actions: {
        resetTo: assign((_, params: number) => ({
          count: params
        }))
      }
    }).createMachine({
      // @ts-expect-error
      entry: {
        type: 'resetTo'
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept a reference to parameterized `assign` with wrong params in the machine
  it.effect('should not accept a reference to parameterized `assign` with wrong params in the machine', () => Effect.gen(function* () {
    setup({
      types: {} as {
        context: {
          count: number;
        };
      },
      actions: {
        resetTo: assign((_, params: number) => ({
          count: params
        }))
      }
    }).createMachine({
      // @ts-expect-error
      entry: {
        type: 'resetTo',
        params: 'foo'
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept a string reference to an unknown action in the machine when actions were configured
  it.effect('should not accept a string reference to an unknown action in the machine when actions were configured', () => Effect.gen(function* () {
    setup({
      actions: {
        doStuff: () => {}
      }
    }).createMachine({
      // @ts-expect-error
      entry: 'unknown'
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept a string reference to an unknown action in the machine when actions were not configured
  it.effect('should not accept a string reference to an unknown action in the machine when actions were not configured', () => Effect.gen(function* () {
    setup({}).createMachine({
      // @ts-expect-error
      entry: 'unknown'
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept an object reference to an unknown action in the machine when actions were configured
  it.effect('should not accept an object reference to an unknown action in the machine when actions were configured', () => Effect.gen(function* () {
    setup({
      actions: {
        doStuff: () => {}
      }
    }).createMachine({
      // @ts-expect-error
      entry: {
        type: 'unknown'
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept an object reference to an unknown action in the machine when actions were not configured
  it.effect('should not accept an object reference to an unknown action in the machine when actions were not configured', () => Effect.gen(function* () {
    setup({}).createMachine({
      // @ts-expect-error the port reports the unknown action object at `entry`, upstream at `type` (ledger DEV-35, D15)
      entry: {
        type: 'unknown'
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should accept an `assign` with a spawner that tries to spawn a known actor
  it.effect('should accept an `assign` with a spawner that tries to spawn a known actor', () => Effect.gen(function* () {
    setup({
      actors: {
        fetchUser: fromPromise(async () => ({ name: 'Andarist' }))
      },
      actions: {
        spawnFetcher: assign(({ spawn }) => {
          return {
            child: spawn('fetchUser')
          };
        })
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept an `assign` with a spawner that tries to spawn an unknown actor when actors are configured
  it.effect('should not accept an `assign` with a spawner that tries to spawn an unknown actor when actors are configured', () => Effect.gen(function* () {
    setup({
      actors: {
        fetchUser: fromPromise(async () => ({ name: 'Andarist' }))
      },
      actions: {
        spawnFetcher: assign(({ spawn }) => {
          return {
            child:
              // @ts-expect-error
              spawn('unknown')
          };
        })
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept an `assign` with a spawner that tries to spawn an unknown actor when actors are not configured
  it.effect('should not accept an `assign` with a spawner that tries to spawn an unknown actor when actors are not configured', () => Effect.gen(function* () {
    setup({
      actions: {
        spawnFetcher: assign(({ spawn }) => {
          return {
            child:
              // @ts-expect-error
              spawn('unknown')
          };
        })
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept an invoke that tries to invoke an unknown actor when actors are not configured
  it.effect('should not accept an invoke that tries to invoke an unknown actor when actors are not configured', () => Effect.gen(function* () {
    setup({}).createMachine({
      invoke: {
        // @ts-expect-error
        src: 'unknown'
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept a non-logic actor when children were not configured
  it.effect('should not accept a non-logic actor when children were not configured', () => Effect.gen(function* () {
    setup({
      actors: {
        // @ts-expect-error
        increment: 'bazinga'
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should accept a `spawnChild` action that tries to spawn a known actor
  it.effect('should accept a `spawnChild` action that tries to spawn a known actor', () => Effect.gen(function* () {
    setup({
      actors: {
        fetchUser: fromPromise(async () => ({ name: 'Andarist' }))
      },
      actions: {
        spawnFetcher: spawnChild('fetchUser')
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept a `spawnChild` action that tries to spawn an unknown actor when actors are configured
  it.effect('should not accept a `spawnChild` action that tries to spawn an unknown actor when actors are configured', () => Effect.gen(function* () {
    setup({
      actors: {
        fetchUser: fromPromise(async () => ({ name: 'Andarist' }))
      },
      actions: {
        spawnFetcher: spawnChild(
          // @ts-expect-error
          'unknown'
        )
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept a `spawnChild` action that tries to spawn an unknown actor when actors are not configured
  it.effect('should not accept a `spawnChild` action that tries to spawn an unknown actor when actors are not configured', () => Effect.gen(function* () {
    setup({
      actions: {
        spawnFetcher: spawnChild(
          // @ts-expect-error
          'unknown'
        )
      }
    });
  }));
  // upstream: test/setup.types.test.ts > setup() > should accept a `raise` action that raises a known event
  it.effect('should accept a `raise` action that raises a known event', () => Effect.gen(function* () {
    setup({
      types: {} as {
        events:
          | {
              type: 'FOO';
            }
          | {
              type: 'BAR';
            };
      },
      actions: {
        raiseFoo: raise({
          type: 'FOO'
        })
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept a `raise` action that raises an unknown event
  it.effect('should not accept a `raise` action that raises an unknown event', () => Effect.gen(function* () {
    setup({
      types: {} as {
        events:
          | {
              type: 'FOO';
            }
          | {
              type: 'BAR';
            };
      },
      actions: {
        raiseFoo: raise({
          // @ts-expect-error
          type: 'BAZ'
        })
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should accept a `raise` action that references a known delay
  it.effect('should accept a `raise` action that references a known delay', () => Effect.gen(function* () {
    setup({
      types: {} as {
        events:
          | {
              type: 'FOO';
            }
          | {
              type: 'BAR';
            };
      },
      actions: {
        raiseFoo: raise(
          {
            type: 'FOO'
          },
          {
            delay: 'hundred'
          }
        )
      },
      delays: {
        hundred: 100
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept a `raise` action that references an unknown delay when delays are configured
  it.effect('should not accept a `raise` action that references an unknown delay when delays are configured', () => Effect.gen(function* () {
    setup({
      types: {} as {
        events:
          | {
              type: 'FOO';
            }
          | {
              type: 'BAR';
            };
      },
      actions: {
        raiseFoo: raise(
          {
            type: 'FOO'
          },
          {
            // @ts-expect-error
            delay: 'hundred'
          }
        )
      },
      delays: {
        thousand: 1000
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept a `raise` action that references an unknown delay when delays are not configured
  it.effect('should not accept a `raise` action that references an unknown delay when delays are not configured', () => Effect.gen(function* () {
    setup({
      types: {} as {
        events:
          | {
              type: 'FOO';
            }
          | {
              type: 'BAR';
            };
      },
      actions: {
        raiseFoo: raise(
          {
            type: 'FOO'
          },
          {
            // @ts-expect-error
            delay: 'hundred'
          }
        )
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should accept a `sendTo` action that references a known delay
  it.effect('should accept a `sendTo` action that references a known delay', () => Effect.gen(function* () {
    setup({
      types: {} as {
        events:
          | {
              type: 'FOO';
            }
          | {
              type: 'BAR';
            };
      },
      actions: {
        sendFoo: sendTo(
          ({ self }) => self,
          {
            type: 'FOO'
          },
          {
            delay: 'hundred'
          }
        )
      },
      delays: {
        hundred: 100
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept a `sendTo` action that references an unknown delay when delays are configured
  it.effect('should not accept a `sendTo` action that references an unknown delay when delays are configured', () => Effect.gen(function* () {
    setup({
      types: {} as {
        events:
          | {
              type: 'FOO';
            }
          | {
              type: 'BAR';
            };
      },
      actions: {
        sendFoo: sendTo(
          ({ self }) => self,
          {
            type: 'FOO'
          },
          {
            // @ts-expect-error
            delay: 'hundred'
          }
        )
      },
      delays: {
        thousand: 1000
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept a `sendTo` action that references an unknown delay when delays are not configured
  it.effect('should not accept a `sendTo` action that references an unknown delay when delays are not configured', () => Effect.gen(function* () {
    setup({
      types: {} as {
        events:
          | {
              type: 'FOO';
            }
          | {
              type: 'BAR';
            };
      },
      actions: {
        sendFoo: sendTo(
          ({ self }) => self,
          {
            type: 'FOO'
          },
          {
            // @ts-expect-error
            delay: 'hundred'
          }
        )
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should accept a `sendTo` action that send an event to `self` when delays are not configured
  it.effect('should accept a `sendTo` action that send an event to `self` when delays are not configured', () => Effect.gen(function* () {
    setup({
      types: {} as {
        events:
          | {
              type: 'FOO';
            }
          | {
              type: 'BAR';
            };
      },
      actions: {
        sendFoo: sendTo(({ self }) => self, {
          type: 'FOO'
        })
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should accept a `sendParent` action when delays are not configured
  it.effect('should accept a `sendParent` action when delays are not configured', () => Effect.gen(function* () {
    setup({
      types: {} as {
        events:
          | {
              type: 'FOO';
            }
          | {
              type: 'BAR';
            };
      },
      actions: {
        sendFoo: sendParent({
          type: 'FOO'
        })
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should accept an `emit` action that emits a known event
  it.effect('should accept an `emit` action that emits a known event', () => Effect.gen(function* () {
    setup({
      types: {} as {
        emitted:
          | {
              type: 'FOO';
            }
          | {
              type: 'BAR';
            };
      },
      actions: {
        emitFoo: emit({
          type: 'FOO'
        })
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept an `emit` action that emits an unknown event
  it.effect('should not accept an `emit` action that emits an unknown event', () => Effect.gen(function* () {
    setup({
      types: {} as {
        emitted:
          | {
              type: 'FOO';
            }
          | {
              type: 'BAR';
            };
      },
      actions: {
        emitFoo: emit({
          // @ts-expect-error
          type: 'BAZ'
        })
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should be able to use an output of specific actor in the `assign` within `invoke`'s `onDone` in the machine
  it.effect("should be able to use an output of specific actor in the `assign` within `invoke`'s `onDone` in the machine", () => Effect.gen(function* () {
    setup({
      actors: {
        greet: fromPromise(async () => 'hello'),
        throwDice: fromPromise(async () => Math.random())
      }
    }).createMachine({
      invoke: {
        src: 'greet',
        onDone: {
          actions: assign({
            data: ({ event }) => {
              event.output satisfies Option.Option<string>;

              // @ts-expect-error
              event.output satisfies Option.Option<number>;
              return {};
            }
          })
        }
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should be able to use an output of specific actor in the custom action within `invoke`'s `onDone` in the machine
  it.effect("should be able to use an output of specific actor in the custom action within `invoke`'s `onDone` in the machine", () => Effect.gen(function* () {
    setup({
      actors: {
        greet: fromPromise(async () => 'hello'),
        throwDice: fromPromise(async () => Math.random())
      }
    }).createMachine({
      invoke: {
        src: 'greet',
        onDone: {
          actions: ({ event }) => {
            event.output satisfies Option.Option<string>;

            // @ts-expect-error
            event.output satisfies Option.Option<number>;
          }
        }
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should accept a compatible provided logic
  it.effect('should accept a compatible provided logic', () => Effect.gen(function* () {
    setup({
      actors: {
        reducer: fromTransition((s) => s, { count: 42 })
      }
    })
      .createMachine({})
      .provide({
        actors: {
          reducer: fromTransition((s) => s, { count: 100 })
        }
      });
  }));

  // upstream: test/setup.types.test.ts > setup() > should allow anonymous inline actor outside of the configured actors
  it.effect('should allow anonymous inline actor outside of the configured actors', () => Effect.gen(function* () {
    setup({
      actors: {
        known: fromPromise(async () => 'known')
      }
    }).createMachine({
      invoke: {
        src: fromPromise(async () => 'inline')
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should disallow anonymous inline actor with an id outside of the configured actors
  it.effect('should disallow anonymous inline actor with an id outside of the configured actors', () => Effect.gen(function* () {
    setup({
      actors: {
        known: fromPromise(async () => 'known')
      }
    }).createMachine({
      // @ts-expect-error
      invoke: {
        src: fromPromise(async () => 'inline'),
        id: 'myChild'
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept an incompatible provided logic
  it.effect('should not accept an incompatible provided logic', () => Effect.gen(function* () {
    setup({
      actors: {
        reducer: fromTransition((s) => s, { count: 42 })
      }
    })
      .createMachine({})
      .provide({
        actors: {
          // @ts-expect-error
          reducer: fromTransition((s) => s, '')
        }
      });
  }));

  // upstream: test/setup.types.test.ts > setup() > should allow actors to be defined without children
  it.effect('should allow actors to be defined without children', () => Effect.gen(function* () {
    setup({
      actors: {
        foo: createMachine({})
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should allow actors to be defined with children
  it.effect('should allow actors to be defined with children', () => Effect.gen(function* () {
    setup({
      types: {} as {
        children: {
          first: 'foo';
          second: 'bar';
        };
      },
      actors: {
        foo: createMachine({}),
        bar: createMachine({})
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not allow actors to be defined without all required children
  it.effect('should not allow actors to be defined without all required children', () => Effect.gen(function* () {
    setup({
      types: {} as {
        children: {
          first: 'foo';
          second: 'bar';
        };
      },
      // @ts-expect-error
      actors: {
        foo: createMachine({})
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should require actors to be defined when children are configured
  it.effect('should require actors to be defined when children are configured', () => Effect.gen(function* () {
    setup(
      // @ts-expect-error
      {
        types: {} as {
          children: {
            first: 'foo';
            second: 'bar';
          };
        }
      }
    );
  }));

  // upstream: test/setup.types.test.ts > setup() > should allow more actors to be defined than the ones required by children
  it.effect('should allow more actors to be defined than the ones required by children', () => Effect.gen(function* () {
    setup({
      types: {} as {
        children: {
          first: 'foo';
          second: 'bar';
        };
      },
      actors: {
        foo: createMachine({}),
        bar: createMachine({}),
        baz: createMachine({})
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should allow an actor with input to be provided
  it.effect('should allow an actor with input to be provided', () => Effect.gen(function* () {
    setup({
      actors: {
        fetchUser: fromPromise(
          async ({ input }: { input: { userId: string } }) => ({
            id: input.userId,
            name: 'Andarist'
          })
        )
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should reject static wrong input when invoking a provided actor
  it.effect(`should reject static wrong input when invoking a provided actor`, () => Effect.gen(function* () {
    setup({
      actors: {
        fetchUser: fromPromise(
          async ({ input }: { input: { userId: string } }) => ({
            id: input.userId,
            name: 'Andarist'
          })
        )
      }
    }).createMachine({
      // @ts-expect-error
      invoke: {
        src: 'fetchUser',
        input: 4157
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should allow static correct input when invoking a provided actor
  it.effect(`should allow static correct input when invoking a provided actor`, () => Effect.gen(function* () {
    setup({
      actors: {
        fetchUser: fromPromise(
          async ({ input }: { input: { userId: string } }) => ({
            id: input.userId,
            name: 'Andarist'
          })
        )
      }
    }).createMachine({
      invoke: {
        src: 'fetchUser',
        input: {
          userId: '4nd4r157'
        }
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should allow static input that is a subtype of the expected one when invoking a provided actor
  it.effect(`should allow static input that is a subtype of the expected one when invoking a provided actor`, () => Effect.gen(function* () {
    setup({
      actors: {
        child: fromPromise(({}: { input: number | string }) =>
          Promise.resolve('foo')
        )
      }
    }).createMachine({
      invoke: {
        src: 'child',
        input: 42
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should reject static input that is a supertype of the expected one when invoking a provided actor
  it.effect(`should reject static input that is a supertype of the expected one when invoking a provided actor`, () => Effect.gen(function* () {
    setup({
      actors: {
        fetchUser: fromPromise(
          async ({ input }: { input: { userId: string } }) => ({
            id: input.userId,
            name: 'Andarist'
          })
        )
      }
    }).createMachine({
      // @ts-expect-error
      invoke: {
        src: 'fetchUser',
        input:
          Math.random() > 0.5
            ? {
                userId: '4nd4r157'
              }
            : 42
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should reject dynamic wrong input when invoking a provided actor
  it.effect(`should reject dynamic wrong input when invoking a provided actor`, () => Effect.gen(function* () {
    setup({
      actors: {
        fetchUser: fromPromise(
          async ({ input }: { input: { userId: string } }) => ({
            id: input.userId,
            name: 'Andarist'
          })
        )
      }
    }).createMachine({
      // @ts-expect-error
      invoke: {
        src: 'fetchUser',
        input: () => 42
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should allow dynamic correct input when invoking a provided actor
  it.effect(`should allow dynamic correct input when invoking a provided actor`, () => Effect.gen(function* () {
    setup({
      actors: {
        fetchUser: fromPromise(
          async ({ input }: { input: { userId: string } }) => ({
            id: input.userId,
            name: 'Andarist'
          })
        )
      }
    }).createMachine({
      invoke: {
        src: 'fetchUser',
        input: () => ({
          userId: '4nd4r157'
        })
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should reject dynamic input that is a supertype of the expected one when invoking a provided actor
  it.effect(`should reject dynamic input that is a supertype of the expected one when invoking a provided actor`, () => Effect.gen(function* () {
    setup({
      actors: {
        fetchUser: fromPromise(
          async ({ input }: { input: { userId: string } }) => ({
            id: input.userId,
            name: 'Andarist'
          })
        )
      }
    }).createMachine({
      // @ts-expect-error
      invoke: {
        src: 'fetchUser',
        input: () =>
          Math.random() > 0.5
            ? {
                userId: '4nd4r157'
              }
            : 42
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should allow dynamic input that is a subtype of the expected one when invoking a provided actor
  it.effect(`should allow dynamic input that is a subtype of the expected one when invoking a provided actor`, () => Effect.gen(function* () {
    setup({
      actors: {
        child: fromPromise(({}: { input: number | string }) =>
          Promise.resolve('foo')
        )
      }
    }).createMachine({
      invoke: {
        src: 'child',
        input: () => 'hello'
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should reject a valid input of a different provided actor when invoking a provided actor
  it.effect(`should reject a valid input of a different provided actor when invoking a provided actor`, () => Effect.gen(function* () {
    setup({
      actors: {
        fetchUser: fromPromise(
          async ({ input }: { input: { userId: string } }) => ({
            id: input.userId,
            name: 'Andarist'
          })
        ),
        rollADie: fromPromise(async ({ input }: { input: number }) =>
          Math.min(Math.random(), input)
        )
      }
    }).createMachine({
      // @ts-expect-error
      invoke: {
        src: 'fetchUser',
        input: 0.31
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should require input to be specified when it is required by the invoked actor
  it.effect(`should require input to be specified when it is required by the invoked actor`, () => Effect.gen(function* () {
    setup({
      actors: {
        fetchUser: fromPromise(
          async ({ input }: { input: { userId: string } }) => ({
            id: input.userId,
            name: 'Andarist'
          })
        )
      }
    }).createMachine({
      // @ts-expect-error
      invoke: {
        src: 'fetchUser'
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not require input when it's optional in the invoked actor
  it.effect(`should not require input when it's optional in the invoked actor`, () => Effect.gen(function* () {
    setup({
      actors: {
        rollADie: fromPromise(
          async ({ input }: { input: number | undefined }) =>
            input ? Math.min(Math.random(), input) : Math.random()
        )
      }
    }).createMachine({
      invoke: {
        src: 'rollADie'
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should provide contextual parameters to input factory for an actor that doesn't specify any input
  it.effect(`should provide contextual parameters to input factory for an actor that doesn't specify any input`, () => Effect.gen(function* () {
    setup({
      types: {
        context: {} as { count: number }
      },
      actors: {
        child: fromPromise(() => Promise.resolve(1))
      }
    }).createMachine({
      context: { count: 1 },
      invoke: {
        src: 'child',
        input: ({ context }) => {
          // @ts-expect-error
          context.foo;

          return undefined;
        }
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should return the correct child type on the available snapshot when the child ID for the actor was configured
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

    const machine = setup({
      types: {} as {
        children: {
          someChild: 'child';
        };
      },
      actors: {
        child
      }
    }).createMachine({
      invoke: {
        id: 'someChild',
        src: 'child'
      }
    });

    const snapshot = (yield* (yield* createActor(machine)).getSnapshot);
    const childSnapshot = yield* snapshot.children.someChild!.getSnapshot;

    childSnapshot.context.foo satisfies string | undefined;
    childSnapshot.context.foo satisfies string;
    // @ts-expect-error
    childSnapshot.context.foo satisfies '';
    // @ts-expect-error
    childSnapshot.context.foo satisfies number | undefined;
  }));

  // upstream: test/setup.types.test.ts > setup() > should have an optional child on the available snapshot when the child ID for the actor was configured
  it.effect('should have an optional child on the available snapshot when the child ID for the actor was configured', () => Effect.gen(function* () {
    const child = createMachine({
      context: {
        counter: 0
      }
    });

    const machine = setup({
      types: {} as {
        children: {
          myChild: 'child';
        };
      },
      actors: {
        child
      }
    }).createMachine({});

    const childActor = (yield* (yield* createActor(machine)).getSnapshot).children.myChild;

    childActor satisfies ActorRefFrom<typeof child> | undefined;
    // @ts-expect-error
    childActor satisfies ActorRefFrom<typeof child>;
  }));

  // upstream: test/setup.types.test.ts > setup() > should have an optional child on the available snapshot when the child ID for the actor was not configured
  it.effect('should have an optional child on the available snapshot when the child ID for the actor was not configured', () => Effect.gen(function* () {
    const child = createMachine({
      context: {
        counter: 0
      }
    });

    const machine = setup({
      actors: {
        child
      }
    }).createMachine({});

    const childActor = (yield* (yield* createActor(machine)).getSnapshot).children.someChild;

    childActor satisfies ActorRefFrom<typeof child> | undefined;
    // @ts-expect-error
    childActor satisfies ActorRefFrom<typeof child>;
  }));

  // upstream: test/setup.types.test.ts > setup() > should not have an index signature on the available snapshot when child IDs were configured for all actors
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

    const machine = setup({
      types: {} as {
        children: {
          counter: 'child1';
          quiz: 'child2';
        };
      },
      actors: {
        child1,
        child2
      }
    }).createMachine({});

    (yield* (yield* createActor(machine)).getSnapshot).children.counter;
    (yield* (yield* createActor(machine)).getSnapshot).children.quiz;
    // @ts-expect-error
    (yield* (yield* createActor(machine)).getSnapshot).children.someChild;
  }));

  // upstream: test/setup.types.test.ts > setup() > should have an index signature on the available snapshot when child IDs were configured only for some actors
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

    const machine = setup({
      types: {} as {
        children: {
          counter: 'child1';
        };
      },
      actors: {
        child1,
        child2
      }
    }).createMachine({});

    const counterActor = (yield* (yield* createActor(machine)).getSnapshot).children.counter;
    counterActor satisfies ActorRefFrom<typeof child1> | undefined;

    const someActor = (yield* (yield* createActor(machine)).getSnapshot).children.someChild;
    someActor satisfies ActorRefFrom<typeof child2> | undefined;
    // @ts-expect-error - someChild can only be child2 (child1 has a literal id)
    someActor satisfies ActorRefFrom<typeof child1> | undefined;
  }));

  // upstream: test/setup.types.test.ts > setup() > should type the snapshot state value of a stateless machine as an empty object
  it.effect('should type the snapshot state value of a stateless machine as an empty object', () => Effect.gen(function* () {
    const machine = setup({}).createMachine({});

    const snapshot = (yield* (yield* createActor(machine)).getSnapshot);

    type ExpectedType = {};

    snapshot.value satisfies ExpectedType;
    ({}) as ExpectedType satisfies ExpectedType;

    // @ts-expect-error
    snapshot.value.unknown;
  }));

  // upstream: test/setup.types.test.ts > setup() > should type the snapshot state value of a simple FSM as a union of strings
  it.effect('should type the snapshot state value of a simple FSM as a union of strings', () => Effect.gen(function* () {
    const machine = setup({}).createMachine({
      initial: 'a',
      states: {
        a: {},
        b: {}
      }
    });

    const snapshot = (yield* (yield* createActor(machine)).getSnapshot);

    type ExpectedType = 'a' | 'b';

    snapshot.value satisfies ExpectedType;
    ({}) as ExpectedType satisfies ExpectedType;
  }));

  // upstream: test/setup.types.test.ts > setup() > should type the snapshot state value without including history state keys
  it.effect('should type the snapshot state value without including history state keys', () => Effect.gen(function* () {
    const machine = setup({}).createMachine({
      initial: 'a',
      states: {
        a: {},
        b: {},
        c: {
          type: 'history'
        }
      }
    });

    const snapshot = (yield* (yield* createActor(machine)).getSnapshot);

    type ExpectedType = 'a' | 'b';

    snapshot.value satisfies ExpectedType;
    ({}) as ExpectedType satisfies ExpectedType;
  }));

  // upstream: test/setup.types.test.ts > setup() > should type the snapshot state value of a nested statechart using optional properties for parent states keys
  it.effect('should type the snapshot state value of a nested statechart using optional properties for parent states keys', () => Effect.gen(function* () {
    const machine = setup({}).createMachine({
      initial: 'a',
      states: {
        a: {
          initial: 'a1',
          states: {
            a1: {},
            a2: {}
          }
        },
        b: {
          initial: 'b1',
          states: {
            b1: {},
            b2: {}
          }
        }
      }
    });

    const snapshot = (yield* (yield* createActor(machine)).getSnapshot);

    type ExpectedType =
      | {
          a: 'a1' | 'a2';
        }
      | {
          b: 'b1' | 'b2';
        };

    snapshot.value satisfies ExpectedType;
    ({}) as ExpectedType satisfies typeof snapshot.value;
  }));

  // upstream: test/setup.types.test.ts > setup() > should type the snapshot state value of a parallel state using required properties for its children
  it.effect('should type the snapshot state value of a parallel state using required properties for its children', () => Effect.gen(function* () {
    const machine = setup({}).createMachine({
      type: 'parallel',
      states: {
        a: {
          initial: 'a1',
          states: {
            a1: {},
            a2: {}
          }
        },
        b: {
          initial: 'b1',
          states: {
            b1: {},
            b2: {}
          }
        }
      }
    });

    const snapshot = (yield* (yield* createActor(machine)).getSnapshot);

    type ExpectedType = {
      a: 'a1' | 'a2';
      b: 'b1' | 'b2';
    };

    snapshot.value satisfies ExpectedType;
    ({}) as ExpectedType satisfies typeof snapshot.value;
  }));

  // upstream: test/setup.types.test.ts > setup() > should type the snapshot state value of an empty parallel region as an empty object
  it.effect('should type the snapshot state value of an empty parallel region as an empty object', () => Effect.gen(function* () {
    const machine = setup({}).createMachine({
      type: 'parallel',
      states: {
        a: {},
        b: {
          initial: 'b1',
          states: {
            b1: {},
            b2: {}
          }
        }
      }
    });

    const snapshot = (yield* (yield* createActor(machine)).getSnapshot);

    type ExpectedType = {
      a: {};
      b: 'b1' | 'b2';
    };

    snapshot.value satisfies ExpectedType;
    ({}) as ExpectedType satisfies typeof snapshot.value;
  }));

  // upstream: test/setup.types.test.ts > setup() > should type the snapshot state value of a statechart with nested compound states
  it.effect('should type the snapshot state value of a statechart with nested compound states', () => Effect.gen(function* () {
    const machine = setup({}).createMachine({
      initial: 'a',
      states: {
        a: {},
        b: {
          initial: 'b1',
          states: {
            b1: {
              initial: 'b11',
              states: {
                b11: {},
                b12: {}
              }
            },
            b2: {}
          }
        }
      }
    });

    const snapshot = (yield* (yield* createActor(machine)).getSnapshot);

    type ExpectedType =
      | 'a'
      | {
          b:
            | 'b2'
            | {
                b1: 'b11' | 'b12';
              };
        };

    snapshot.value satisfies ExpectedType;
    ({}) as ExpectedType satisfies typeof snapshot.value;
  }));

  // upstream: test/setup.types.test.ts > setup() > state.value from setup state machine actors should be strongly-typed
  it.effect('state.value from setup state machine actors should be strongly-typed', () => Effect.gen(function* () {
    const machine = setup({}).createMachine({
      initial: 'green',
      states: {
        green: {},
        yellow: {},
        red: {
          initial: 'walk',
          states: {
            walk: {},
            wait: {},
            stop: {}
          }
        },
        emergency: {
          type: 'parallel',
          states: {
            main: {
              initial: 'blinking',
              states: {
                blinking: {}
              }
            },
            cross: {
              initial: 'blinking',
              states: {
                blinking: {}
              }
            }
          }
        }
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));

    const stateValue = (yield* actor.getSnapshot).value;

    'green' satisfies typeof stateValue;

    'yellow' satisfies typeof stateValue;

    // @ts-expect-error compound state
    'red' satisfies typeof stateValue;

    // @ts-expect-error parallel state
    'emergency' satisfies typeof stateValue;

    const _redWalk = { red: 'walk' } satisfies typeof stateValue;
    const _redWait = { red: 'wait' } satisfies typeof stateValue;

    const _redUnknown = {
      // @ts-expect-error
      red: 'unknown'
    } satisfies typeof stateValue;

    const _emergency0 = {
      emergency: {
        main: 'blinking',
        cross: 'blinking'
      }
    } satisfies typeof stateValue;

    const _emergency1 = {
      // @ts-expect-error
      emergency: 'main'
    } satisfies typeof stateValue;

    const _emergency2 = {
      // @ts-expect-error
      emergency: {
        main: 'blinking'
      }
    } satisfies typeof stateValue;

    const _emergency3 = {
      emergency: {
        // @ts-expect-error
        main: 'unknown',
        cross: 'blinking'
      }
    } satisfies typeof stateValue;
  }));

  // upstream: test/setup.types.test.ts > setup() > state.value is exhaustive
  it.effect('state.value is exhaustive', () => Effect.gen(function* () {
    const machine = setup({}).createMachine({
      initial: 'green',
      states: {
        green: {},
        yellow: {},
        red: {
          initial: 'walk',
          states: {
            walk: {},
            wait: {},
            stop: {}
          }
        },
        emergency: {
          type: 'parallel',
          states: {
            main: {
              initial: 'blinking',
              states: {
                blinking: {}
              }
            },
            cross: {
              initial: 'blinking',
              states: {
                blinking: {}
              }
            }
          }
        }
      }
    });
    const actor = (yield* createActor(machine));
    const { value } = (yield* actor.getSnapshot);
    if (value === 'green') {
      // ...
    } else {
      value satisfies 'yellow' | { red: any } | { emergency: any };
      if (value === 'yellow') {
        // ...
      } else {
        value satisfies { red: any } | { emergency: any };
        if ('red' in value) {
          value.red satisfies 'walk' | 'wait' | 'stop';
          // @ts-expect-error
          value.red satisfies 'other';
        } else {
          value satisfies {
            emergency: {
              main: 'blinking';
              cross: 'blinking';
            };
          };
        }
      }
    }
    // Nested state exhaustiveness
    if (typeof value === 'object' && 'red' in value) {
      // @ts-expect-error
      value satisfies 'green';
      // @ts-expect-error
      value satisfies 'red';
      // @ts-expect-error
      value.emergency;
      value.red satisfies 'walk' | 'wait' | 'stop';
    }
    if (
      value !== 'green' &&
      value !== 'yellow' &&
      !('red' in value) &&
      !('emergency' in value)
    ) {
      // Exhaustive check
      value satisfies never;
    }
  }));

  // upstream: test/setup.types.test.ts > setup() > should accept `assign` when no actor and children types are provided
  it.effect('should accept `assign` when no actor and children types are provided', () => Effect.gen(function* () {
    setup({}).createMachine({
      on: {
        RESTART: {
          actions: assign({})
        }
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not allow matching against any value when the machine has no states
  it.effect('should not allow matching against any value when the machine has no states', () => Effect.gen(function* () {
    const machine = setup({}).createMachine({});

    const snapshot = yield* (yield* Effect.tap(createActor(machine), (a) => a.start)).getSnapshot;

    snapshot.matches(
      // @ts-expect-error
      {}
    );
    snapshot.matches(
      // @ts-expect-error
      'pending'
    );
    snapshot.matches(
      // @ts-expect-error
      {
        foo: 'pending'
      }
    );
  }));

  // upstream: test/setup.types.test.ts > setup() > should allow matching against a valid string value of a simple FSM
  it.effect('should allow matching against a valid string value of a simple FSM', () => Effect.gen(function* () {
    const machine = setup({}).createMachine({
      initial: 'green',
      states: {
        green: {},
        yellow: {},
        red: {}
      }
    });

    const snapshot = yield* (yield* Effect.tap(createActor(machine), (a) => a.start)).getSnapshot;

    snapshot.matches('green');
    snapshot.matches('yellow');
    snapshot.matches('red');
  }));

  // upstream: test/setup.types.test.ts > setup() > should not allow matching against a invalid string value of a simple FSM
  it.effect('should not allow matching against a invalid string value of a simple FSM', () => Effect.gen(function* () {
    const machine = setup({}).createMachine({
      initial: 'green',
      states: {
        green: {},
        yellow: {},
        red: {}
      }
    });

    const snapshot = yield* (yield* Effect.tap(createActor(machine), (a) => a.start)).getSnapshot;

    snapshot.matches(
      // @ts-expect-error
      'orange'
    );
  }));

  // upstream: test/setup.types.test.ts > setup() > should not allow matching against an empty object value of a simple FSM
  it.effect('should not allow matching against an empty object value of a simple FSM', () => Effect.gen(function* () {
    const machine = setup({}).createMachine({
      initial: 'green',
      states: {
        green: {},
        yellow: {},
        red: {}
      }
    });

    const snapshot = yield* (yield* Effect.tap(createActor(machine), (a) => a.start)).getSnapshot;

    snapshot.matches(
      // @ts-expect-error
      {}
    );
  }));

  // upstream: test/setup.types.test.ts > setup() > should not allow matching against an object value with a key that is a valid value of a simple FSM
  it.effect('should not allow matching against an object value with a key that is a valid value of a simple FSM', () => Effect.gen(function* () {
    const machine = setup({}).createMachine({
      initial: 'green',
      states: {
        green: {},
        yellow: {},
        red: {}
      }
    });

    const snapshot = yield* (yield* Effect.tap(createActor(machine), (a) => a.start)).getSnapshot;

    snapshot.matches(
      // @ts-expect-error
      {
        green: {}
      }
    );
  }));

  // upstream: test/setup.types.test.ts > setup() > should allow matching against valid top state keys of a statechart with nested compound states
  it.effect('should allow matching against valid top state keys of a statechart with nested compound states', () => Effect.gen(function* () {
    const machine = setup({}).createMachine({
      initial: 'green',
      states: {
        green: {
          initial: 'walk',
          states: {
            walk: {},
            wait: {}
          }
        },
        yellow: {},
        red: {}
      }
    });

    const snapshot = yield* (yield* Effect.tap(createActor(machine), (a) => a.start)).getSnapshot;

    snapshot.matches('green');
    snapshot.matches('yellow');
    snapshot.matches('red');
  }));

  // upstream: test/setup.types.test.ts > setup() > should not allow matching against an invalid top state key of a statechart with nested compound states
  it.effect('should not allow matching against an invalid top state key of a statechart with nested compound states', () => Effect.gen(function* () {
    const machine = setup({}).createMachine({
      initial: 'green',
      states: {
        green: {
          initial: 'walk',
          states: {
            walk: {},
            wait: {}
          }
        },
        yellow: {},
        red: {}
      }
    });

    const snapshot = yield* (yield* Effect.tap(createActor(machine), (a) => a.start)).getSnapshot;

    snapshot.matches(
      // @ts-expect-error
      'orange'
    );
  }));

  // upstream: test/setup.types.test.ts > setup() > should allow matching against a valid full object value of a statechart with nested compound states
  it.effect('should allow matching against a valid full object value of a statechart with nested compound states', () => Effect.gen(function* () {
    const machine = setup({}).createMachine({
      initial: 'green',
      states: {
        green: {
          initial: 'walk',
          states: {
            walk: {},
            wait: {}
          }
        },
        yellow: {},
        red: {}
      }
    });

    const snapshot = yield* (yield* Effect.tap(createActor(machine), (a) => a.start)).getSnapshot;

    snapshot.matches({
      green: 'wait'
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should allow matching against a valid non-full object value of a statechart with nested compound states
  it.effect('should allow matching against a valid non-full object value of a statechart with nested compound states', () => Effect.gen(function* () {
    const machine = setup({}).createMachine({
      initial: 'green',
      states: {
        green: {
          initial: 'walk',
          states: {
            walk: {
              initial: 'steady',
              states: {
                steady: {},
                slowingDown: {}
              }
            },
            wait: {}
          }
        },
        yellow: {},
        red: {}
      }
    });

    const snapshot = yield* (yield* Effect.tap(createActor(machine), (a) => a.start)).getSnapshot;

    snapshot.matches({
      green: 'wait'
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not allow matching against a invalid object value of a statechart with nested compound states
  it.effect('should not allow matching against a invalid object value of a statechart with nested compound states', () => Effect.gen(function* () {
    const machine = setup({}).createMachine({
      initial: 'green',
      states: {
        green: {
          initial: 'walk',
          states: {
            walk: {},
            wait: {}
          }
        },
        yellow: {},
        red: {}
      }
    });

    const snapshot = yield* (yield* Effect.tap(createActor(machine), (a) => a.start)).getSnapshot;

    snapshot.matches({
      // @ts-expect-error
      green: 'invalid'
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not allow matching against a invalid object value with self-key at value position
  it.effect('should not allow matching against a invalid object value with self-key at value position', () => Effect.gen(function* () {
    const machine = setup({}).createMachine({
      initial: 'green',
      states: {
        green: {
          initial: 'walk',
          states: {
            walk: {},
            wait: {}
          }
        },
        yellow: {},
        red: {}
      }
    });

    const snapshot = yield* (yield* Effect.tap(createActor(machine), (a) => a.start)).getSnapshot;

    snapshot.matches({
      // @ts-expect-error
      green: 'green'
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should accept an after transition that references a known delay
  it.effect('should accept an after transition that references a known delay', () => Effect.gen(function* () {
    setup({
      delays: {
        hundred: 100
      }
    }).createMachine({
      initial: 'a',
      states: {
        a: {
          after: {
            hundred: 'b'
          }
        },
        b: {}
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept an after transition that references an unknown delay when delays are configured
  it.effect('should not accept an after transition that references an unknown delay when delays are configured', () => Effect.gen(function* () {
    setup({
      delays: {
        thousand: 1000
      }
    }).createMachine({
      initial: 'a',
      states: {
        a: {
          after: {
            // @x-ts-expect-error https://github.com/microsoft/TypeScript/issues/55709
            // @ts-expect-error the port reports the unknown delay that TypeScript issue 55709 hides upstream (ledger DEV-36, A19)
            unknown: 'b'
          }
        },
        b: {}
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept an after transition that references an unknown delay when delays are not configured
  it.effect('should not accept an after transition that references an unknown delay when delays are not configured', () => Effect.gen(function* () {
    setup({}).createMachine({
      initial: 'a',
      states: {
        a: {
          after: {
            // @x-ts-expect-error https://github.com/microsoft/TypeScript/issues/55709
            // @ts-expect-error the port reports the unknown delay that TypeScript issue 55709 hides upstream (ledger DEV-36, A19)
            unknown: 'b'
          }
        },
        b: {}
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should accept a guarded transition that references a known guard
  it.effect('should accept a guarded transition that references a known guard', () => Effect.gen(function* () {
    setup({
      types: {} as {
        events: { type: 'NEXT' };
      },
      guards: {
        checkStuff: () => true
      }
    }).createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            NEXT: {
              guard: 'checkStuff',
              target: 'b'
            }
          }
        },
        b: {}
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept a guarded transition that references an unknown guard when guards are configured
  it.effect('should not accept a guarded transition that references an unknown guard when guards are configured', () => Effect.gen(function* () {
    setup({
      types: {} as {
        events: { type: 'NEXT' };
      },
      guards: {
        checkStuff: () => true
      }
    }).createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            // @ts-expect-error
            NEXT: {
              guard: 'unknown',
              target: 'b'
            }
          }
        },
        b: {}
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept a guarded transition that references an unknown guard when guards are not configured
  it.effect('should not accept a guarded transition that references an unknown guard when guards are not configured', () => Effect.gen(function* () {
    setup({
      types: {} as {
        events: { type: 'NEXT' };
      }
    }).createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            // @ts-expect-error
            NEXT: {
              guard: 'checkStuff',
              target: 'b'
            }
          }
        },
        b: {}
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should accept `enqueueActions` within the config when actions are not configured
  it.effect('should accept `enqueueActions` within the config when actions are not configured', () => Effect.gen(function* () {
    setup({
      types: {} as {
        events:
          | {
              type: 'SOMETHING';
            }
          | {
              type: 'SOMETHING_ELSE';
            };
      }
    }).createMachine({
      on: {
        SOMETHING: {
          actions: enqueueActions(({ enqueue }) => {
            enqueue.raise({ type: 'SOMETHING_ELSE' });
          })
        }
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should accept `enqueueActions` within the config when empty delays are configured
  it.effect('should accept `enqueueActions` within the config when empty delays are configured', () => Effect.gen(function* () {
    setup({
      delays: {}
    }).createMachine({
      entry: enqueueActions(() => {})
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should accept `enqueueActions` that doesn't use any other defined actions
  it.effect("should accept `enqueueActions` that doesn't use any other defined actions", () => Effect.gen(function* () {
    setup({
      types: {} as {
        events:
          | {
              type: 'SOMETHING';
            }
          | {
              type: 'SOMETHING_ELSE';
            };
      },
      actions: {
        doStuff: enqueueActions(({ enqueue }) => {
          enqueue.raise({ type: 'SOMETHING_ELSE' });
        })
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should accept `enqueueActions` that uses a known guard
  it.effect('should accept `enqueueActions` that uses a known guard', () => Effect.gen(function* () {
    setup({
      types: {} as {
        events:
          | {
              type: 'SOMETHING';
            }
          | {
              type: 'SOMETHING_ELSE';
            };
      },
      actions: {
        doStuff: enqueueActions(({ enqueue, check }) => {
          if (check('checkStuff')) {
            enqueue.raise({ type: 'SOMETHING_ELSE' });
          }
        })
      },
      guards: {
        checkStuff: () => true
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not allow `enqueueActions` to use an unknown guard (when guards are configured)
  it.effect('should not allow `enqueueActions` to use an unknown guard (when guards are configured)', () => Effect.gen(function* () {
    setup({
      types: {} as {
        events:
          | {
              type: 'SOMETHING';
            }
          | {
              type: 'SOMETHING_ELSE';
            };
      },
      actions: {
        doStuff: enqueueActions(({ enqueue, check }) => {
          if (
            check(
              // @ts-expect-error
              'unknown'
            )
          ) {
            enqueue.raise({ type: 'SOMETHING_ELSE' });
          }
        })
      },
      guards: {
        checkStuff: () => true
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not allow `enqueueActions` to use an unknown guard (when guards are not configured)
  it.effect('should not allow `enqueueActions` to use an unknown guard (when guards are not configured)', () => Effect.gen(function* () {
    setup({
      types: {} as {
        events:
          | {
              type: 'SOMETHING';
            }
          | {
              type: 'SOMETHING_ELSE';
            };
      },
      actions: {
        doStuff: enqueueActions(({ enqueue, check }) => {
          if (
            check(
              // @ts-expect-error
              'unknown'
            )
          ) {
            enqueue.raise({ type: 'SOMETHING_ELSE' });
          }
        })
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should be able to use a parameterized `enqueueActions` action with its required params in the machine
  it.effect('should be able to use a parameterized `enqueueActions` action with its required params in the machine', () => Effect.gen(function* () {
    setup({
      actions: {
        doStuff: enqueueActions((_, params: number) => {})
      }
    }).createMachine({
      entry: {
        type: 'doStuff',
        params: 0
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept a string reference to parameterized `enqueueActions` without its required params in the machine
  it.effect('should not accept a string reference to parameterized `enqueueActions` without its required params in the machine', () => Effect.gen(function* () {
    setup({
      actions: {
        doStuff: enqueueActions((_, params: number) => {})
      }
    }).createMachine({
      // @ts-expect-error
      entry: 'doStuff'
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept an object reference to parameterized `enqueueActions` without its required params in the machine #1
  it.effect('should not accept an object reference to parameterized `enqueueActions` without its required params in the machine', () => Effect.gen(function* () {
    setup({
      actions: {
        doStuff: enqueueActions((_, params: number) => {})
      }
    }).createMachine({
      // @ts-expect-error
      entry: {
        type: 'doStuff'
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept an object reference to parameterized `enqueueActions` without its required params in the machine #2
  it.effect('should not accept an object reference to parameterized `enqueueActions` without its required params in the machine', () => Effect.gen(function* () {
    setup({
      actions: {
        doStuff: enqueueActions((_, params: number) => {})
      }
    }).createMachine({
      // @ts-expect-error
      entry: {
        type: 'doStuff'
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should not accept a reference to parameterized `enqueueActions` with wrong params in the machine
  it.effect('should not accept a reference to parameterized `enqueueActions` with wrong params in the machine', () => Effect.gen(function* () {
    setup({
      actions: {
        doStuff: enqueueActions((_, params: number) => {})
      }
    }).createMachine({
      // @ts-expect-error
      entry: {
        type: 'doStuff',
        params: 'foo'
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should allow `log` action to be configured
  it.effect('should allow `log` action to be configured', () => Effect.gen(function* () {
    setup({
      actions: {
        writeDown: log('foo')
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should allow `cancel` action to be configured
  it.effect('should allow `cancel` action to be configured', () => Effect.gen(function* () {
    setup({
      actions: {
        revert: cancel('foo')
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > should allow `stopChild` action to be configured
  it.effect('should allow `stopChild` action to be configured', () => Effect.gen(function* () {
    setup({
      actions: {
        releaseFromDuty: stopChild('foo')
      }
    });
  }));

  // upstream: test/setup.types.test.ts > setup() > EventFrom should work with a machine that has transitions defined on a state
  it.effect('EventFrom should work with a machine that has transitions defined on a state', () => Effect.gen(function* () {
    // https://github.com/statelyai/xstate/issues/5031

    const machine = setup({
      types: {} as {
        events: {
          type: 'SOME_EVENT';
        };
      }
    }).createMachine({
      id: 'authorization',
      initial: 'loading',
      context: {
        myVar: 'foo'
      },
      states: {
        loaded: {},
        loading: {
          on: {
            SOME_EVENT: {
              target: 'loaded'
            }
          }
        }
      }
    });

    ((_accept: EventFrom<typeof machine>) => {})({ type: 'SOME_EVENT' });
  }));

  // upstream: test/setup.types.test.ts > setup() > ContextFrom should work with a machine that has transitions defined on a state
  it.effect('ContextFrom should work with a machine that has transitions defined on a state', () => Effect.gen(function* () {
    // https://github.com/statelyai/xstate/issues/5031

    const machine = setup({
      types: {} as {
        context: {
          myVar: string;
        };
      }
    }).createMachine({
      id: 'authorization',
      initial: 'loading',
      context: {
        myVar: 'foo'
      },
      states: {
        loaded: {},
        loading: {
          on: {
            SOME_EVENT: {
              target: 'loaded'
            }
          }
        }
      }
    });

    ((_accept: ContextFrom<typeof machine>) => {})({ myVar: 'whatever' });
  }));

  // upstream: test/setup.types.test.ts > setup() > should strongly type the state IDs in snapshot.getMeta()
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
});

describe('createStateConfig', () => {
  // upstream: test/setup.types.test.ts > createStateConfig > should be able to create a state config with a custom action
  it.effect('should be able to create a state config with a custom action', () => Effect.gen(function* () {
    const machineSetup = setup({
      types: {
        context: {} as {
          count: number;
        },
        events: {} as {
          type: 'timer';
          by: number;
        }
      },
      actions: {
        doSomething: () => {}
      },
      guards: {
        isLightActive: () => true
      }
    });

    const green = machineSetup.createStateConfig({
      on: {
        timer: {
          actions: 'doSomething',
          guard: 'isLightActive'
        }
      }
    });

    const yellow = machineSetup.createStateConfig({
      on: {
        timer: {
          actions: 'doSomething',
          guard: 'isLightActive'
        }
      }
    });

    const red = machineSetup.createStateConfig({
      on: {
        timer: {
          actions: 'doSomething',
          guard: 'isLightActive'
        }
      }
    });

    const invalidEvent = machineSetup.createStateConfig({
      on: {
        // @ts-expect-error
        nonsense: {}
      }
    });

    const invalidAction = machineSetup.createStateConfig({
      on: {
        // @ts-expect-error
        timer: {
          // TODO: why is the error not here?
          actions: 'nonexistent'
        }
      }
    });

    const invalidGuard = machineSetup.createStateConfig({
      on: {
        // @ts-expect-error
        timer: {
          // TODO: why is the error not here?
          guard: 'nonexistent'
        }
      }
    });

    machineSetup.createMachine({
      context: {
        count: 0
      },
      initial: 'green',
      states: {
        green,
        yellow,
        red,
        invalidEvent,
        invalidAction,
        invalidGuard
      }
    });
  }));

  // upstream: test/setup.types.test.ts > createStateConfig > should allow matching against valid top state keys of a statechart with nested compound states
  it.effect('should allow matching against valid top state keys of a statechart with nested compound states', () => Effect.gen(function* () {
    const machineSetup = setup({});
    const green = machineSetup.createStateConfig({
      initial: 'walk',
      states: {
        walk: {},
        wait: {}
      }
    });
    const machine = machineSetup.createMachine({
      initial: 'green',
      states: {
        green,
        yellow: {},
        red: {}
      }
    });

    const snapshot = yield* (yield* Effect.tap(createActor(machine), (a) => a.start)).getSnapshot;

    snapshot.matches('green');
    snapshot.matches('yellow');
    snapshot.matches('red');
  }));

  // upstream: test/setup.types.test.ts > createStateConfig > should not allow matching against an invalid top state key of a statechart with nested compound states
  it.effect('should not allow matching against an invalid top state key of a statechart with nested compound states', () => Effect.gen(function* () {
    const machineSetup = setup({});
    const green = machineSetup.createStateConfig({
      initial: 'walk',
      states: {
        walk: {},
        wait: {}
      }
    });
    const machine = machineSetup.createMachine({
      initial: 'green',
      states: {
        green,
        yellow: {},
        red: {}
      }
    });

    const snapshot = yield* (yield* Effect.tap(createActor(machine), (a) => a.start)).getSnapshot;

    snapshot.matches(
      // @ts-expect-error
      'orange'
    );
  }));

  // upstream: test/setup.types.test.ts > createStateConfig > should allow matching against a valid full object value of a statechart with nested compound states
  it.effect('should allow matching against a valid full object value of a statechart with nested compound states', () => Effect.gen(function* () {
    const machineSetup = setup({});
    const green = machineSetup.createStateConfig({
      initial: 'walk',
      states: {
        walk: {},
        wait: {}
      }
    });
    const machine = machineSetup.createMachine({
      initial: 'green',
      states: {
        green,
        yellow: {},
        red: {}
      }
    });

    const snapshot = yield* (yield* Effect.tap(createActor(machine), (a) => a.start)).getSnapshot;

    snapshot.matches({
      green: 'wait'
    });
  }));

  // upstream: test/setup.types.test.ts > createStateConfig > should allow matching against a valid non-full object value of a statechart with nested compound states
  it.effect('should allow matching against a valid non-full object value of a statechart with nested compound states', () => Effect.gen(function* () {
    const machineSetup = setup({});
    const green = machineSetup.createStateConfig({
      initial: 'walk',
      states: {
        walk: {
          initial: 'steady',
          states: {
            steady: {},
            slowingDown: {}
          }
        },
        wait: {}
      }
    });
    const machine = machineSetup.createMachine({
      initial: 'green',
      states: {
        green,
        yellow: {},
        red: {}
      }
    });

    const snapshot = yield* (yield* Effect.tap(createActor(machine), (a) => a.start)).getSnapshot;

    snapshot.matches({
      green: 'wait'
    });
  }));

  // upstream: test/setup.types.test.ts > createStateConfig > should not allow matching against a invalid object value of a statechart with nested compound states
  it.effect('should not allow matching against a invalid object value of a statechart with nested compound states', () => Effect.gen(function* () {
    const machineSetup = setup({});
    const green = machineSetup.createStateConfig({
      initial: 'walk',
      states: {
        walk: {},
        wait: {}
      }
    });
    const machine = machineSetup.createMachine({
      initial: 'green',
      states: {
        green,
        yellow: {},
        red: {}
      }
    });

    const snapshot = yield* (yield* Effect.tap(createActor(machine), (a) => a.start)).getSnapshot;

    snapshot.matches({
      // @ts-expect-error
      green: 'invalid'
    });
  }));

  // upstream: test/setup.types.test.ts > createStateConfig > should not allow matching against a invalid object value with self-key at value position
  it.effect('should not allow matching against a invalid object value with self-key at value position', () => Effect.gen(function* () {
    const machineSetup = setup({});
    const green = machineSetup.createStateConfig({
      initial: 'walk',
      states: {
        walk: {},
        wait: {}
      }
    });
    const machine = machineSetup.createMachine({
      initial: 'green',
      states: {
        green,
        yellow: {},
        red: {}
      }
    });

    const snapshot = yield* (yield* Effect.tap(createActor(machine), (a) => a.start)).getSnapshot;

    snapshot.matches({
      // @ts-expect-error
      green: 'green'
    });
  }));
});

describe('extend', () => {
  describe('undefined actions handling', () => {
    // upstream: test/setup.types.test.ts > extend > undefined actions handling > should error on undefined actions in createMachine without extend
    it.effect('should error on undefined actions in createMachine without extend', () => Effect.gen(function* () {
      setup({}).createMachine({
        // @ts-expect-error
        entry: 'nonexistent'
      });
    }));

    // upstream: test/setup.types.test.ts > extend > undefined actions handling > should error on undefined actions in createMachine with empty extend
    it.effect('should error on undefined actions in createMachine with empty extend', () => Effect.gen(function* () {
      setup({}).extend({}).createMachine({
        // @ts-expect-error
        entry: 'nonexistent'
      });
    }));

    // upstream: test/setup.types.test.ts > extend > undefined actions handling > should error on undefined actions in extend enqueueActions
    it.effect('should error on undefined actions in extend enqueueActions', () => Effect.gen(function* () {
      setup({}).extend({
        actions: {
          foo: enqueueActions(({ enqueue }) => {
            // @ts-expect-error
            enqueue('nonexistent');
          })
        }
      });
    }));
  });

  describe('actions', () => {
    // upstream: test/setup.types.test.ts > extend > actions > should allow extending actions
    it.effect('should allow extending actions', () => Effect.gen(function* () {
      setup({})
        .extend({
          actions: {
            foo: () => {}
          }
        })
        .createMachine({
          entry: 'foo'
        });
    }));

    // upstream: test/setup.types.test.ts > extend > actions > should allow referencing base actions in extended actions via enqueueActions
    it.effect('should allow referencing base actions in extended actions via enqueueActions', () => Effect.gen(function* () {
      setup({
        actions: {
          doSomething: () => {}
        }
      })
        .extend({
          actions: {
            foo: enqueueActions(({ enqueue }) => {
              // Using the setup's enqueueActions should work with proper types
              enqueue.raise({ type: 'SOMETHING' });
            })
          }
        })
        .createMachine({
          entry: 'foo'
        });
    }));
  });

  describe('guards', () => {
    // upstream: test/setup.types.test.ts > extend > guards > should allow extending guards
    it.effect('should allow extending guards', () => Effect.gen(function* () {
      setup({})
        .extend({
          guards: {
            truthy: () => true
          }
        })
        .createMachine({
          on: {
            EV: {
              guard: 'truthy'
            },
            // @ts-expect-error
            EV2: {
              guard: 'notTruthy'
            }
          }
        });
    }));

    // upstream: test/setup.types.test.ts > extend > guards > should allow referencing base guards in extended guards with not
    it.effect('should allow referencing base guards in extended guards with not', () => Effect.gen(function* () {
      setup({
        guards: {
          truthy: () => true
        }
      })
        .extend({
          guards: {
            notTruthy: not('truthy'),
            // @ts-expect-error
            nonexistent: not('existent')
          }
        })
        .createMachine({
          on: {
            EV: {
              guard: 'notTruthy'
            },
            // @ts-expect-error
            EV2: {
              guard: 'notNotNotTruthy'
            }
          }
        });
    }));

    // upstream: test/setup.types.test.ts > extend > guards > should allow referencing extended guards in further extended guards
    it.effect('should allow referencing extended guards in further extended guards', () => Effect.gen(function* () {
      setup({
        guards: {
          truthy: () => true
        }
      })
        .extend({
          guards: {
            alsoTruthy: () => true,
            notTruthy: not('truthy')
          }
        })
        .extend({
          guards: {
            combined: and(['truthy', 'alsoTruthy']),
            alt: or(['notTruthy', 'truthy']),
            // @ts-expect-error
            nonexistent: or(['existent', 'truthy'])
          }
        })
        .createMachine({
          on: {
            EV: [
              { guard: 'combined', actions: () => {} },
              { guard: 'alt', actions: () => {} },
              {
                // @ts-expect-error
                guard: 'fake',
                actions: () => {}
              }
            ]
          }
        });
    }));

    // upstream: test/setup.types.test.ts > extend > guards > should allow referencing extended guards in extended actions via check
    it.effect('should allow referencing extended guards in extended actions via check', () => Effect.gen(function* () {
      setup({
        guards: {
          truthy: () => true
        }
      })
        .extend({
          guards: {
            alsoTruthy: () => true
          },
          actions: {
            foo: enqueueActions(({ check }) => {
              check('truthy');
              check('alsoTruthy');
              // @ts-expect-error
              check('nonexistent');
            })
          }
        })
        .createMachine({
          entry: 'foo'
        });
    }));
  });

  describe('delays', () => {
    // upstream: test/setup.types.test.ts > extend > delays > should allow extending delays
    it.effect('should allow extending delays', () => Effect.gen(function* () {
      setup({})
        .extend({
          delays: {
            medium: 100
          }
        })
        .createMachine({
          initial: 'a',
          states: {
            a: {
              after: {
                medium: 'b'
              }
            },
            b: {}
          }
        });
    }));

    // upstream: test/setup.types.test.ts > extend > delays > should allow referencing base delays in extended delays
    it.effect('should allow referencing base delays in extended delays', () => Effect.gen(function* () {
      setup({
        delays: {
          short: 10
        }
      })
        .extend({
          delays: {
            medium: 100
          }
        })
        .createMachine({
          initial: 'a',
          states: {
            a: {
              entry: [
                raise({ type: 'GO' }, { delay: 'short' }),
                raise({ type: 'GO' }, { delay: 'medium' }),
                raise(
                  { type: 'GO' },
                  {
                    // @ts-expect-error
                    delay: 'nonexistent'
                  }
                )
              ],
              on: {
                GO: 'b'
              }
            },
            b: {}
          }
        });
    }));

    // upstream: test/setup.types.test.ts > extend > delays > should allow referencing extended delays in further extended delays
    it.effect('should allow referencing extended delays in further extended delays', () => Effect.gen(function* () {
      setup({
        delays: {
          short: 10
        }
      })
        .extend({
          delays: {
            medium: 100
          }
        })
        .extend({
          delays: {
            long: 1000
          }
        })
        .createMachine({
          initial: 'a',
          states: {
            a: {
              entry: [
                raise({ type: 'GO' }, { delay: 'short' }),
                raise({ type: 'GO' }, { delay: 'medium' }),
                raise({ type: 'GO' }, { delay: 'long' })
              ],
              on: {
                GO: 'b'
              }
            },
            b: {
              after: {
                medium: 'c'
              }
            },
            c: {
              after: {
                long: 'd',
                // @ts-expect-error
                nonexistent: 'd'
              }
            },
            d: {}
          }
        });
    }));
  });
});

describe('type-bound actions', () => {
  // upstream: test/setup.types.test.ts > type-bound actions > should be able to create a type-safe action action
  it.effect('should be able to create a type-safe action action', () => Effect.gen(function* () {
    const machineSetup = setup({
      types: {} as {
        context: {
          count: number;
        };
        events: {
          type: 'inc';
          value: number;
        };
      }
    });

    const action = machineSetup.createAction((args) => {
      args.context.count satisfies number;
      // @ts-expect-error
      args.context.text satisfies string;

      args.event.type satisfies 'inc';
      args.event.value satisfies number;
      // @ts-expect-error
      args.event.value satisfies string;
    });

    machineSetup.createMachine({
      context: {
        count: 0
      },
      entry: action
    });

    setup({}).createMachine({
      // @ts-expect-error
      entry: action
    });
  }));

  // upstream: test/setup.types.test.ts > type-bound actions > should be able to create a type-safe assign action
  it.effect('should be able to create a type-safe assign action', () => Effect.gen(function* () {
    const machineSetup = setup({
      types: {} as {
        context: {
          count: number;
        };
      }
    });
    const assignAction = machineSetup.assign({
      count: ({ context }) => {
        context.count satisfies number;
        // @ts-expect-error
        context.text satisfies string;

        return context.count + 1;
      }
    });

    machineSetup.createMachine({
      context: {
        count: 0
      },
      entry: assignAction
    });

    setup({}).createMachine({
      // @ts-expect-error
      entry: assignAction
    });
  }));

  // upstream: test/setup.types.test.ts > type-bound actions > should be able to create a type-safe raise action
  it.effect('should be able to create a type-safe raise action', () => Effect.gen(function* () {
    const machineSetup = setup({
      types: {} as {
        context: {
          count: number;
        };
        events: {
          type: 'TEST';
        };
      }
    });
    const raiseAction = machineSetup.raise(({ event }) => {
      event.type satisfies 'TEST';
      // @ts-expect-error
      event.type satisfies 'INVALID';

      return event;
    });

    machineSetup.createMachine({
      context: {
        count: 0
      },
      entry: raiseAction
    });

    setup({}).createMachine({
      // @ts-expect-error
      entry: raiseAction
    });
  }));

  // upstream: test/setup.types.test.ts > type-bound actions > should be able to create a type-safe sendTo action
  it.effect('should be able to create a type-safe sendTo action', () => Effect.gen(function* () {
    const machineSetup = setup({
      types: {} as {
        events: { type: 'TEST' };
      }
    });
    const sendToAction = machineSetup.sendTo(
      ({ self }) => self,
      ({ event }) => {
        event.type satisfies 'TEST';
        // @ts-expect-error
        event.type satisfies 'INVALID';

        return event;
      }
    );

    machineSetup.createMachine({
      context: {
        count: 0
      },
      entry: sendToAction
    });

    setup({}).createMachine({
      // @ts-expect-error
      entry: sendToAction
    });
  }));

  // upstream: test/setup.types.test.ts > type-bound actions > should be able to create a type-safe log action
  it.effect('should be able to create a type-safe log action', () => Effect.gen(function* () {
    const machineSetup = setup({
      types: {} as {
        context: { count: number };
        events: { type: 'TEST' };
      }
    });
    const logAction = machineSetup.log(({ context, event }) => {
      context.count satisfies number;
      event.type satisfies 'TEST';
      return { context, event };
    }, 'label');

    machineSetup.createMachine({
      context: { count: 0 },
      entry: logAction
    });
  }));

  // upstream: test/setup.types.test.ts > type-bound actions > should be able to create a type-safe cancel action
  it.effect('should be able to create a type-safe cancel action', () => Effect.gen(function* () {
    const machineSetup = setup({});
    const cancelAction = machineSetup.cancel('some-id');
    machineSetup.createMachine({ entry: cancelAction });
  }));

  // upstream: test/setup.types.test.ts > type-bound actions > should be able to create a type-safe stopChild action
  it.effect('should be able to create a type-safe stopChild action', () => Effect.gen(function* () {
    const machineSetup = setup({});
    const stopAction = machineSetup.stopChild('child');
    machineSetup.createMachine({ entry: stopAction });
  }));

  // upstream: test/setup.types.test.ts > type-bound actions > should be able to create a type-safe enqueueActions action
  it.effect('should be able to create a type-safe enqueueActions action', () => Effect.gen(function* () {
    const machineSetup = setup({
      types: {} as {
        context: { count: number };
        events: { type: 'INC'; value: number };
      },
      actions: {
        doing: () => {}
      },
      guards: {
        isOk: () => true
      }
    });

    const enq = machineSetup.enqueueActions(
      ({ context, event, check, enqueue }) => {
        context.count satisfies number;
        event.type satisfies 'INC';

        if (check('isOk')) {
          enqueue('doing');
        }

        enqueue.assign({
          count: ({ context }) => context.count + 1
        });
      }
    );

    machineSetup.createMachine({
      context: { count: 0 },
      entry: enq
    });

    setup({}).createMachine({
      // @ts-expect-error
      entry: enq
    });
  }));

  // upstream: test/setup.types.test.ts > type-bound actions > should be able to create a type-safe emit action
  it.effect('should be able to create a type-safe emit action', () => Effect.gen(function* () {
    const machineSetup = setup({
      types: {} as {
        emitted: { type: 'PING' };
        events: { type: 'TEST' };
      }
    });

    const emitAction = machineSetup.emit({ type: 'PING' });

    machineSetup.createMachine({ entry: emitAction });

    setup({}).createMachine({
      // @ts-expect-error
      entry: emitAction
    });
  }));

  // upstream: test/setup.types.test.ts > type-bound actions > should be able to create a type-safe spawnChild action
  it.effect('should be able to create a type-safe spawnChild action', () => Effect.gen(function* () {
    const child = createMachine({});
    const machineSetup = setup({
      actors: {
        child
      }
    });

    const spawn = machineSetup.spawnChild('child');

    machineSetup.createMachine({ entry: spawn });

    setup({}).createMachine({
      // @ts-expect-error
      entry: spawn
    });
  }));
});
