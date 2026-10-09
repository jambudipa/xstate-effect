import { describe, expect, it, vi } from "@effect/vitest"
import { Effect, Logger } from "effect"
import { createMachine, createActor, setup, assertEvent } from "../../src/index.js";

// Upstream spies on `console.warn`. The port reports a warning through the actor's logger
// (`Effect.logWarning` by default, SD-21), never through the console. This test logger keeps
// every log entry so a test can assert on the warnings.
const testLogger = (entries: Array<Logger.Options<unknown>>) =>
  Logger.layer([
    Logger.make((options) => {
      entries.push(options);
    })
  ]);

// The warnings the test logger captured, each as the argument list that upstream's
// `console.warn` spy records, so the upstream inline snapshots compare unchanged.
const warnCalls = (logged: ReadonlyArray<Logger.Options<unknown>>) =>
  logged
    .filter((entry) => entry.logLevel === 'Warn')
    .map((entry) => (Array.isArray(entry.message) ? entry.message : [entry.message]));

describe('event descriptors', () => {
  // upstream: test/eventDescriptors.test.ts > event descriptors > should fallback to using wildcard transition definition (if specified)
  it.effect('should fallback to using wildcard transition definition (if specified)', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'A',
      states: {
        A: {
          on: {
            FOO: 'B',
            '*': 'C'
          }
        },
        B: {},
        C: {}
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* service.send({ type: 'BAR' }));
    expect((yield* service.getSnapshot).value).toBe('C');
  }));

  // upstream: test/eventDescriptors.test.ts > event descriptors > should prioritize explicit descriptor even if wildcard comes first
  it.effect('should prioritize explicit descriptor even if wildcard comes first', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'A',
      states: {
        A: {
          on: {
            '*': 'fail',
            NEXT: 'pass'
          }
        },
        fail: {},
        pass: {}
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* service.send({ type: 'NEXT' }));
    expect((yield* service.getSnapshot).value).toBe('pass');
  }));

  // upstream: test/eventDescriptors.test.ts > event descriptors > should prioritize explicit descriptor even if a partial one comes first
  it.effect('should prioritize explicit descriptor even if a partial one comes first', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'A',
      states: {
        A: {
          on: {
            'foo.*': 'fail',
            'foo.bar': 'pass'
          }
        },
        fail: {},
        pass: {}
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* service.send({ type: 'foo.bar' }));
    expect((yield* service.getSnapshot).value).toBe('pass');
  }));

  // upstream: test/eventDescriptors.test.ts > event descriptors > should prioritize a longer descriptor even if the shorter one comes first
  it.effect('should prioritize a longer descriptor even if the shorter one comes first', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'A',
      states: {
        A: {
          on: {
            'foo.*': 'fail',
            'foo.bar.*': 'pass'
          }
        },
        fail: {},
        pass: {}
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* service.send({ type: 'foo.bar.baz' }));
    expect((yield* service.getSnapshot).value).toBe('pass');
  }));

  // upstream: test/eventDescriptors.test.ts > event descriptors > should use a shorter descriptor if the longer one doesn't match
  it.effect(`should use a shorter descriptor if the longer one doesn't match`, () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'A',
      states: {
        A: {
          on: {
            'foo.bar.*': {
              target: 'fail',
              guard: () => false
            },
            'foo.*': 'pass'
          }
        },
        fail: {},
        pass: {}
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* service.send({ type: 'foo.bar.baz' }));
    expect((yield* service.getSnapshot).value).toBe('pass');
  }));

  // upstream: test/eventDescriptors.test.ts > event descriptors > should fall back to wildcard descriptor when exact descriptor guard fails
  it.effect('should fall back to wildcard descriptor when exact descriptor guard fails', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'A',
      states: {
        A: {
          on: {
            'foo.bar': {
              guard: () => false,
              target: 'fail'
            },
            'foo.*': 'pass'
          }
        },
        fail: {},
        pass: {}
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* service.send({ type: 'foo.bar' }));
    expect((yield* service.getSnapshot).value).toBe('pass');
  }));

  // upstream: test/eventDescriptors.test.ts > event descriptors > should NOT support non-tokenized wildcards
  it.effect('should NOT support non-tokenized wildcards', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'start',
      states: {
        start: {
          on: {
            'event*': 'success'
          }
        },
        success: {
          type: 'final'
        }
      }
    });

    const actorRef1 = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef1.send({ type: 'event' }));

    expect((yield* actorRef1.getSnapshot).matches('success')).toBeFalsy();

    const actorRef2 = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef2.send({ type: 'eventually' }));

    expect((yield* actorRef2.getSnapshot).matches('success')).toBeFalsy();
  }));

  // upstream: test/eventDescriptors.test.ts > event descriptors > should support prefix matching with wildcards (+0)
  it.effect('should support prefix matching with wildcards (+0)', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'start',
      states: {
        start: {
          on: {
            'event.*': 'success'
          }
        },
        success: {
          type: 'final'
        }
      }
    });

    const actorRef1 = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef1.send({ type: 'event' }));

    expect((yield* actorRef1.getSnapshot).matches('success')).toBeTruthy();

    const actorRef2 = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef2.send({ type: 'eventually' }));

    expect((yield* actorRef2.getSnapshot).matches('success')).toBeFalsy();
  }));

  // upstream: test/eventDescriptors.test.ts > event descriptors > should support prefix matching with wildcards (+1)
  it.effect('should support prefix matching with wildcards (+1)', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'start',
      states: {
        start: {
          on: {
            'event.*': 'success'
          }
        },
        success: {
          type: 'final'
        }
      }
    });

    const actorRef1 = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef1.send({ type: 'event.whatever' }));

    expect((yield* actorRef1.getSnapshot).matches('success')).toBeTruthy();

    const actorRef2 = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef2.send({ type: 'eventually' }));

    expect((yield* actorRef2.getSnapshot).matches('success')).toBeFalsy();

    const actorRef3 = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef3.send({ type: 'eventually.event' }));

    expect((yield* actorRef3.getSnapshot).matches('success')).toBeFalsy();
  }));

  // upstream: test/eventDescriptors.test.ts > event descriptors > should support prefix matching with wildcards (+n)
  it.effect('should support prefix matching with wildcards (+n)', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'start',
      states: {
        start: {
          on: {
            'event.*': 'success'
          }
        },
        success: {
          type: 'final'
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'event.first.second' }));

    expect((yield* actorRef.getSnapshot).matches('success')).toBeTruthy();
  }));

  // upstream: test/eventDescriptors.test.ts > event descriptors > should support prefix matching with wildcards (+n, multi-prefix)
  it.effect('should support prefix matching with wildcards (+n, multi-prefix)', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'start',
      states: {
        start: {
          on: {
            'event.foo.bar.*': 'success'
          }
        },
        success: {
          type: 'final'
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'event.foo.bar.first.second' }));

    expect((yield* actorRef.getSnapshot).matches('success')).toBeTruthy();
  }));

  // upstream: test/eventDescriptors.test.ts > event descriptors > should not match infix wildcards
  it.effect('should not match infix wildcards', () => {
    // SD-21: the test logger, not a console spy, receives the warnings
    const logged: Array<Logger.Options<unknown>> = [];
    return Effect.gen(function* () {
      const machine = createMachine({
        initial: 'start',
        states: {
          start: {
            on: {
              'event.*.bar.*': 'success',
              '*.event.*': 'success'
            }
          },
          success: {
            type: 'final'
          }
        }
      });

      const actorRef1 = (yield* Effect.tap(createActor(machine), (a) => a.start));

      (yield* actorRef1.send({ type: 'event.foo.bar.first.second' }));

      expect((yield* actorRef1.getSnapshot).matches('success')).toBeFalsy();

      expect(warnCalls(logged)).toMatchInlineSnapshot(`
        [
          [
            "Wildcards can only be the last token of an event descriptor (e.g., "event.*") or the entire event descriptor ("*"). Check the "event.*.bar.*" event.",
          ],
          [
            "Infix wildcards in transition events are not allowed. Check the "event.*.bar.*" transition.",
          ],
          [
            "Wildcards can only be the last token of an event descriptor (e.g., "event.*") or the entire event descriptor ("*"). Check the "*.event.*" event.",
          ],
          [
            "Infix wildcards in transition events are not allowed. Check the "*.event.*" transition.",
          ],
        ]
      `);
      // as `mockClear` on the `console.warn` spy: forget the warnings captured so far
      logged.length = 0;

      const actorRef2 = (yield* Effect.tap(createActor(machine), (a) => a.start));

      (yield* actorRef2.send({ type: 'whatever.event' }));

      expect((yield* actorRef2.getSnapshot).matches('success')).toBeFalsy();

      expect(warnCalls(logged)).toMatchInlineSnapshot(`
        [
          [
            "Wildcards can only be the last token of an event descriptor (e.g., "event.*") or the entire event descriptor ("*"). Check the "event.*.bar.*" event.",
          ],
          [
            "Wildcards can only be the last token of an event descriptor (e.g., "event.*") or the entire event descriptor ("*"). Check the "*.event.*" event.",
          ],
          [
            "Infix wildcards in transition events are not allowed. Check the "*.event.*" transition.",
          ],
        ]
      `);
    }).pipe(Effect.provide(testLogger(logged)));
  });

  // upstream: test/eventDescriptors.test.ts > event descriptors > should not match wildcards as part of tokens
  it.effect('should not match wildcards as part of tokens', () => {
    // SD-21: the test logger, not a console spy, receives the warnings
    const logged: Array<Logger.Options<unknown>> = [];
    return Effect.gen(function* () {
      const machine = createMachine({
        initial: 'start',
        states: {
          start: {
            on: {
              'event*.bar.*': 'success',
              '*event.*': 'success'
            }
          },
          success: {
            type: 'final'
          }
        }
      });

      const actorRef1 = (yield* Effect.tap(createActor(machine), (a) => a.start));

      (yield* actorRef1.send({ type: 'eventually.bar.baz' }));

      expect((yield* actorRef1.getSnapshot).matches('success')).toBeFalsy();

      expect(warnCalls(logged)).toMatchInlineSnapshot(`
        [
          [
            "Wildcards can only be the last token of an event descriptor (e.g., "event.*") or the entire event descriptor ("*"). Check the "event*.bar.*" event.",
          ],
          [
            "Wildcards can only be the last token of an event descriptor (e.g., "event.*") or the entire event descriptor ("*"). Check the "*event.*" event.",
          ],
        ]
      `);
      // as `mockClear` on the `console.warn` spy: forget the warnings captured so far
      logged.length = 0;

      const actorRef2 = (yield* Effect.tap(createActor(machine), (a) => a.start));

      (yield* actorRef2.send({ type: 'prevent.whatever' }));

      expect((yield* actorRef2.getSnapshot).matches('success')).toBeFalsy();

      expect(warnCalls(logged)).toMatchInlineSnapshot(`
        [
          [
            "Wildcards can only be the last token of an event descriptor (e.g., "event.*") or the entire event descriptor ("*"). Check the "event*.bar.*" event.",
          ],
          [
            "Wildcards can only be the last token of an event descriptor (e.g., "event.*") or the entire event descriptor ("*"). Check the "*event.*" event.",
          ],
        ]
      `);
    }).pipe(Effect.provide(testLogger(logged)));
  });

  // upstream: test/eventDescriptors.test.ts > event descriptors > should allow assertEvent to use partial descriptors
  it.effect('should allow assertEvent to use partial descriptors', () => Effect.gen(function* () {
    type FeedbackEvents =
      | {
          type: 'FEEDBACK.MESSAGE';
          message: string;
        }
      | {
          type: 'FEEDBACK.RATE';
          rate: number;
        }
      | { type: 'OTHER' };

    const handleEventSpy = vi.fn();
    const machine = setup({
      types: {
        events: {} as FeedbackEvents
      },
      actions: {
        // SD-3 (amended 2026-10-08): `assertEvent` is an Effect that gives the narrowed event,
        // so the action returns an Effect
        handleEvent: ({ event }: { event: FeedbackEvents }) => Effect.gen(function* () {
          const feedback = yield* assertEvent(event, 'FEEDBACK.*');

          if (feedback.type === 'FEEDBACK.MESSAGE') {
            feedback.message satisfies string;
          } else {
            feedback.rate satisfies number;
          }

          handleEventSpy(feedback);
        })
      }
    }).createMachine({
      initial: 'listening',
      states: {
        listening: {
          on: {
            'FEEDBACK.*': {
              actions: 'handleEvent'
            }
          }
        }
      }
    });

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actor.send({ type: 'FEEDBACK.MESSAGE', message: 'hello' }));
    (yield* actor.send({ type: 'FEEDBACK.RATE', rate: 5 }));

    expect(handleEventSpy).toHaveBeenCalledTimes(2);
    expect(handleEventSpy).toHaveBeenNthCalledWith(1, {
      type: 'FEEDBACK.MESSAGE',
      message: 'hello'
    });
    expect(handleEventSpy).toHaveBeenNthCalledWith(2, {
      type: 'FEEDBACK.RATE',
      rate: 5
    });
  }));

  // upstream: test/eventDescriptors.test.ts > event descriptors > should throw if assertEvent partial descriptor does not match
  it.effect('should throw if assertEvent partial descriptor does not match', () => Effect.gen(function* () {
    type FeedbackEvents =
      | {
          type: 'FEEDBACK.MESSAGE';
          message: string;
        }
      | {
          type: 'FEEDBACK.RATE';
          rate: number;
        }
      | { type: 'OTHER' };

    const nonFeedbackEvent = { type: 'OTHER' } as FeedbackEvents;

    // SD-3 (amended 2026-10-08): `assertEvent` fails its Effect with the upstream message
    expect(
      yield* Effect.flip(assertEvent(nonFeedbackEvent, 'FEEDBACK.*'))
    ).toMatchInlineSnapshot(
      `[Error: Expected event {"type":"OTHER"} to have type matching "FEEDBACK.*"]`
    );
  }));
});
