import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { AnyActorLogic, createMachine } from "../../src/index.js";

describe('definition', () => {
  // upstream: test/definition.test.ts > definition > should provide invoke definitions
  it.effect('should provide invoke definitions', () => Effect.gen(function* () {
    const invokeMachine = createMachine({
      types: {} as {
        actors:
          | {
              src: 'foo';
              logic: AnyActorLogic;
            }
          | {
              src: 'bar';
              logic: AnyActorLogic;
            };
      },
      id: 'invoke',
      invoke: [{ src: 'foo' }, { src: 'bar' }],
      initial: 'idle',
      states: {
        idle: {}
      }
    });

    expect(invokeMachine.root.definition.invoke.length).toBe(2);
  }));
});
