import { describe, expect, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { ActorRefFrom, createActor, createMachine } from "../../src/index.js";

describe('spawn inside machine', () => {
  // upstream: test/spawn.test.ts > spawn inside machine > input is required when defined in actor
  it.effect('input is required when defined in actor', () => Effect.gen(function* () {
    const childMachine = createMachine({
      types: { input: {} as { value: number } }
    });
    const machine = createMachine({
      types: {} as { context: { ref: ActorRefFrom<typeof childMachine> } },
      context: ({ spawn }) => ({
        ref: spawn(childMachine, { input: { value: 42 }, systemId: 'test' })
      })
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
    expect(Option.isSome(yield* actor.system.get('test'))).toBe(true);
  }));
});
