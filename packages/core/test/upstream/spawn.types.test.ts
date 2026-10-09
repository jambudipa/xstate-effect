import { describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { ActorRefFrom, assign, createMachine } from "../../src/index.js";

describe('spawn inside machine', () => {
  // upstream: test/spawn.types.test.ts > spawn inside machine > input is required when defined in actor
  it.effect('input is required when defined in actor', () => Effect.gen(function* () {
    const childMachine = createMachine({
      types: { input: {} as { value: number } }
    });
    createMachine({
      types: {} as { context: { ref: ActorRefFrom<typeof childMachine> } },
      context: ({ spawn }) => ({
        ref: spawn(childMachine, { input: { value: 42 } })
      }),
      initial: 'idle',
      states: {
        Idle: {
          on: {
            event: {
              actions: assign(({ spawn }) => ({
                ref: spawn(childMachine, { input: { value: 42 } })
              }))
            }
          }
        }
      }
    });
  }));

  // upstream: test/spawn.types.test.ts > spawn inside machine > input is not required when not defined in actor
  it.effect('input is not required when not defined in actor', () => Effect.gen(function* () {
    const childMachine = createMachine({});
    createMachine({
      types: {} as { context: { ref: ActorRefFrom<typeof childMachine> } },
      context: ({ spawn }) => ({
        ref: spawn(childMachine)
      }),
      initial: 'idle',
      states: {
        Idle: {
          on: {
            some: {
              actions: assign(({ spawn }) => ({
                ref: spawn(childMachine)
              }))
            }
          }
        }
      }
    });
  }));
});
