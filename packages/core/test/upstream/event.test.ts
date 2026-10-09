import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import {
  createMachine,
  createActor,
  assign,
  AnyActorRef,
  toEffect
} from "../../src/index.js";
import { sendTo } from "../../src/index.js";

describe('events', () => {
  // upstream: test/event.test.ts > events > should be able to respond to sender by sending self
  it.effect('should be able to respond to sender by sending self', () => Effect.gen(function* () {
    const authServerMachine = createMachine({
      types: {
        events: {} as { type: 'CODE'; sender: AnyActorRef }
      },
      id: 'authServer',
      initial: 'waitingForCode',
      states: {
        waitingForCode: {
          on: {
            CODE: {
              actions: sendTo(
                ({ event }) => {
                  expect(event.sender).toBeDefined();
                  return event.sender;
                },
                { type: 'TOKEN' },
                { delay: 10 }
              )
            }
          }
        }
      }
    });

    const authClientMachine = createMachine({
      id: 'authClient',
      initial: 'idle',
      states: {
        idle: {
          on: { AUTH: 'authorizing' }
        },
        authorizing: {
          invoke: {
            id: 'auth-server',
            src: authServerMachine
          },
          entry: sendTo('auth-server', ({ self }) => ({
            type: 'CODE',
            sender: self
          })),
          on: {
            TOKEN: 'authorized'
          }
        },
        authorized: {
          type: 'final'
        }
      }
    });

    const service = (yield* createActor(authClientMachine));
    (yield* service.start);

    (yield* service.send({ type: 'AUTH' }));

    // upstream resolves on the observer's `complete`; toEffect waits for the actor to
    // finish (SD-19) and fails if it errors instead. The auth server replies after
    // `delay: 10` on the Effect clock; it schedules that reply when it processes CODE,
    // which the awaited send does not wait for (SD-23), so the TestClock advances in
    // 10 ms steps until the client completes rather than in one step that could run
    // before the reply is scheduled
    yield* toEffect(service).pipe(
      Effect.raceFirst(Effect.forever(TestClock.adjust("10 millis")))
    );
  }));
});

describe('nested transitions', () => {
  // upstream: test/event.test.ts > nested transitions > only take the transition of the most inner matching event
  it.effect('only take the transition of the most inner matching event', () => Effect.gen(function* () {
    interface SignInContext {
      email: string;
      password: string;
    }

    interface ChangePassword {
      type: 'changePassword';
      password: string;
    }

    const authMachine = createMachine(
      {
        types: {} as { context: SignInContext; events: ChangePassword },
        context: { email: '', password: '' },
        initial: 'passwordField',
        states: {
          passwordField: {
            initial: 'hidden',
            states: {
              hidden: {
                on: {
                  // We want to assign the new password but remain in the hidden
                  // state
                  changePassword: {
                    actions: 'assignPassword'
                  }
                }
              },
              valid: {},
              invalid: {}
            },
            on: {
              changePassword: [
                {
                  guard: ({ event }) => event.password.length >= 10,
                  target: '.invalid',
                  actions: ['assignPassword']
                },
                {
                  target: '.valid',
                  actions: ['assignPassword']
                }
              ]
            }
          }
        }
      },
      {
        actions: {
          assignPassword: assign({
            password: ({ event }) => event.password
          })
        }
      }
    );
    const password = 'xstate123';
    const actorRef = (yield* Effect.tap(createActor(authMachine), (a) => a.start));
    (yield* actorRef.send({ type: 'changePassword', password }));

    const snapshot = (yield* actorRef.getSnapshot);
    expect(snapshot.value).toEqual({ passwordField: 'hidden' });
    expect(snapshot.context).toEqual({ password, email: '' });
  }));
});
