import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit, Option, Scope } from "effect"
import {
  createActor,
  createMachine,
  fromPromise,
  sendParent,
  sendTo,
  waitFor,
  InspectionEvent,
  isMachineSnapshot,
  assign,
  raise,
  setup
} from "../../src/index.js";
import type { InspectedActionEvent } from "../../src/index.js";

// The port keeps `output`, `error` and the inspection `sourceRef` as `Option` (D8, DEV-7), and
// `Option.some(undefined)` never exists. So each `Option` field read as its value or
// `undefined` gives the upstream form of an event or a non-machine snapshot, which the
// upstream inline snapshots print.
const withPlainOptions = (value: unknown): unknown =>
  typeof value === 'object' && value !== null
    ? Object.fromEntries(
        Object.entries(value).map(([key, field]) => [
          key,
          Option.isOption(field) ? Option.getOrUndefined(field) : field
        ])
      )
    : value;

// Upstream delivers the events that actors send to each other before `waitFor` resolves.
// Here a send from inside an actor enqueues without waiting (SD-23), so a test yields its
// fiber, at most 100 times and never on wall-clock time, before it reads what was inspected.
const settle = Effect.yieldNow.pipe(Effect.repeat({ until: () => false, times: 100 }));

function simplifyEvents(
  inspectionEvents: InspectionEvent[],
  filter?: (ev: InspectionEvent) => boolean
) {
  return inspectionEvents
    .filter(filter ?? (() => true))
    .map((inspectionEvent) => {
      if (inspectionEvent.type === '@xstate.event') {
        return {
          type: inspectionEvent.type,
          sourceId: Option.getOrUndefined(
            Option.map(inspectionEvent.sourceRef, (sourceRef) => sourceRef.sessionId)
          ),
          targetId: inspectionEvent.actorRef.sessionId,
          event: withPlainOptions(inspectionEvent.event)
        };
      }
      if (inspectionEvent.type === '@xstate.actor') {
        return {
          type: inspectionEvent.type,
          actorId: inspectionEvent.actorRef.sessionId
        };
      }

      if (inspectionEvent.type === '@xstate.snapshot') {
        return {
          type: inspectionEvent.type,
          actorId: inspectionEvent.actorRef.sessionId,
          snapshot: isMachineSnapshot(inspectionEvent.snapshot)
            ? { value: inspectionEvent.snapshot.value }
            : withPlainOptions(inspectionEvent.snapshot),
          event: withPlainOptions(inspectionEvent.event),
          status: inspectionEvent.snapshot.status
        };
      }

      if (inspectionEvent.type === '@xstate.microstep') {
        return {
          type: inspectionEvent.type,
          value: (inspectionEvent.snapshot as any).value,
          event: withPlainOptions(inspectionEvent.event),
          transitions: inspectionEvent._transitions.map((t) => ({
            eventType: t.eventType,
            target: t.target?.map((target) => target.id) ?? []
          }))
        };
      }

      if (inspectionEvent.type === '@xstate.action') {
        return {
          type: inspectionEvent.type,
          action: inspectionEvent.action
        };
      }

      // Upstream falls through to an implicit `undefined`; the port's compiler options
      // (`noImplicitReturns`) need it written
      return undefined;
    });
}

describe('inspect', () => {
  // upstream: test/inspect.test.ts > inspect > the .inspect option can observe inspection events
  it.effect('the .inspect option can observe inspection events', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            NEXT: 'b'
          }
        },
        b: {
          on: {
            NEXT: 'c'
          }
        },
        c: {}
      }
    });

    const events: InspectionEvent[] = [];

    const actor = (yield* createActor(machine, {
      inspect: (ev) => Effect.sync(() => { events.push(ev); })
    }));
    (yield* actor.start);

    (yield* actor.send({ type: 'NEXT' }));
    (yield* actor.send({ type: 'NEXT' }));

    expect(
      simplifyEvents(events, (ev) =>
        ['@xstate.actor', '@xstate.event', '@xstate.snapshot'].includes(ev.type)
      )
    ).toMatchInlineSnapshot(`
      [
        {
          "actorId": "x:0",
          "type": "@xstate.actor",
        },
        {
          "event": {
            "input": undefined,
            "type": "xstate.init",
          },
          "sourceId": undefined,
          "targetId": "x:0",
          "type": "@xstate.event",
        },
        {
          "actorId": "x:0",
          "event": {
            "input": undefined,
            "type": "xstate.init",
          },
          "snapshot": {
            "value": "a",
          },
          "status": "active",
          "type": "@xstate.snapshot",
        },
        {
          "event": {
            "type": "NEXT",
          },
          "sourceId": undefined,
          "targetId": "x:0",
          "type": "@xstate.event",
        },
        {
          "actorId": "x:0",
          "event": {
            "type": "NEXT",
          },
          "snapshot": {
            "value": "b",
          },
          "status": "active",
          "type": "@xstate.snapshot",
        },
        {
          "event": {
            "type": "NEXT",
          },
          "sourceId": undefined,
          "targetId": "x:0",
          "type": "@xstate.event",
        },
        {
          "actorId": "x:0",
          "event": {
            "type": "NEXT",
          },
          "snapshot": {
            "value": "c",
          },
          "status": "active",
          "type": "@xstate.snapshot",
        },
      ]
    `);
  }));

  // upstream: test/inspect.test.ts > inspect > can inspect communications between actors
  it.effect('can inspect communications between actors', () => Effect.gen(function* () {
    const parentMachine = createMachine({
      initial: 'waiting',
      states: {
        waiting: {},
        success: {}
      },
      invoke: {
        src: createMachine({
          initial: 'start',
          states: {
            start: {
              on: {
                loadChild: 'loading'
              }
            },
            loading: {
              invoke: {
                src: fromPromise(() => {
                  return Promise.resolve(42);
                }),
                onDone: {
                  target: 'loaded',
                  actions: sendParent({ type: 'toParent' })
                }
              }
            },
            loaded: {
              type: 'final'
            }
          }
        }),
        id: 'child',
        onDone: {
          target: '.success',
          actions: () => {
            events;
          }
        }
      },
      on: {
        load: {
          actions: sendTo('child', { type: 'loadChild' })
        }
      }
    });

    const events: InspectionEvent[] = [];

    // Upstream passes an observer object here; the port's `inspect` option takes the function
    // form only (SD-18, DEV-20), and this test is about the inspected communication
    const actor = (yield* createActor(parentMachine, {
      inspect: (event) => Effect.sync(() => {
        events.push(event);
      })
    }));

    (yield* actor.start);
    (yield* actor.send({ type: 'load' }));

    yield* waitFor(actor, (state) => state.value === 'success');
    yield* settle;

    // Two differences from the upstream text, named by a "Tests not ported" ledger row (SD-26):
    // the session ids are the port's, x:0 to x:2 per system where upstream's module-global
    // counter gives x:1 to x:3 (SD-9); and upstream's 21 entries come in the port's order,
    // because an event that one actor sends to another is queued, not processed inside the
    // sender's macrostep (SD-23, DEV-23). Each entry is the upstream text.
    expect(
      simplifyEvents(events, (ev) =>
        ['@xstate.actor', '@xstate.event', '@xstate.snapshot'].includes(ev.type)
      )
    ).toMatchInlineSnapshot(`
      [
        {
          "actorId": "x:0",
          "type": "@xstate.actor",
        },
        {
          "actorId": "x:1",
          "type": "@xstate.actor",
        },
        {
          "event": {
            "input": undefined,
            "type": "xstate.init",
          },
          "sourceId": undefined,
          "targetId": "x:0",
          "type": "@xstate.event",
        },
        {
          "event": {
            "input": undefined,
            "type": "xstate.init",
          },
          "sourceId": "x:0",
          "targetId": "x:1",
          "type": "@xstate.event",
        },
        {
          "actorId": "x:1",
          "event": {
            "input": undefined,
            "type": "xstate.init",
          },
          "snapshot": {
            "value": "start",
          },
          "status": "active",
          "type": "@xstate.snapshot",
        },
        {
          "actorId": "x:0",
          "event": {
            "input": undefined,
            "type": "xstate.init",
          },
          "snapshot": {
            "value": "waiting",
          },
          "status": "active",
          "type": "@xstate.snapshot",
        },
        {
          "event": {
            "type": "load",
          },
          "sourceId": undefined,
          "targetId": "x:0",
          "type": "@xstate.event",
        },
        {
          "event": {
            "type": "loadChild",
          },
          "sourceId": "x:0",
          "targetId": "x:1",
          "type": "@xstate.event",
        },
        {
          "actorId": "x:0",
          "event": {
            "type": "load",
          },
          "snapshot": {
            "value": "waiting",
          },
          "status": "active",
          "type": "@xstate.snapshot",
        },
        {
          "actorId": "x:2",
          "type": "@xstate.actor",
        },
        {
          "event": {
            "input": undefined,
            "type": "xstate.init",
          },
          "sourceId": "x:1",
          "targetId": "x:2",
          "type": "@xstate.event",
        },
        {
          "actorId": "x:2",
          "event": {
            "input": undefined,
            "type": "xstate.init",
          },
          "snapshot": {
            "error": undefined,
            "input": undefined,
            "output": undefined,
            "status": "active",
          },
          "status": "active",
          "type": "@xstate.snapshot",
        },
        {
          "actorId": "x:1",
          "event": {
            "type": "loadChild",
          },
          "snapshot": {
            "value": "loading",
          },
          "status": "active",
          "type": "@xstate.snapshot",
        },
        {
          "event": {
            "data": 42,
            "type": "xstate.promise.resolve",
          },
          "sourceId": "x:2",
          "targetId": "x:2",
          "type": "@xstate.event",
        },
        {
          "event": {
            "actorId": "0.(machine).loading",
            "output": 42,
            "type": "xstate.done.actor.0.(machine).loading",
          },
          "sourceId": "x:2",
          "targetId": "x:1",
          "type": "@xstate.event",
        },
        {
          "actorId": "x:2",
          "event": {
            "data": 42,
            "type": "xstate.promise.resolve",
          },
          "snapshot": {
            "error": undefined,
            "input": undefined,
            "output": 42,
            "status": "done",
          },
          "status": "done",
          "type": "@xstate.snapshot",
        },
        {
          "event": {
            "type": "toParent",
          },
          "sourceId": "x:1",
          "targetId": "x:0",
          "type": "@xstate.event",
        },
        {
          "event": {
            "actorId": "child",
            "output": undefined,
            "type": "xstate.done.actor.child",
          },
          "sourceId": "x:1",
          "targetId": "x:0",
          "type": "@xstate.event",
        },
        {
          "actorId": "x:1",
          "event": {
            "actorId": "0.(machine).loading",
            "output": 42,
            "type": "xstate.done.actor.0.(machine).loading",
          },
          "snapshot": {
            "value": "loaded",
          },
          "status": "done",
          "type": "@xstate.snapshot",
        },
        {
          "actorId": "x:0",
          "event": {
            "type": "toParent",
          },
          "snapshot": {
            "value": "waiting",
          },
          "status": "active",
          "type": "@xstate.snapshot",
        },
        {
          "actorId": "x:0",
          "event": {
            "actorId": "child",
            "output": undefined,
            "type": "xstate.done.actor.child",
          },
          "snapshot": {
            "value": "success",
          },
          "status": "active",
          "type": "@xstate.snapshot",
        },
      ]
    `);
  }));

  // upstream: test/inspect.test.ts > inspect > can inspect microsteps from always events
  it.effect('can inspect microsteps from always events', () => Effect.gen(function* () {
    const machine = createMachine({
      context: { count: 0 },
      initial: 'counting',
      states: {
        counting: {
          always: [
            { guard: ({ context }) => context.count === 3, target: 'done' },
            { actions: assign({ count: ({ context }) => context.count + 1 }) }
          ]
        },
        done: {}
      }
    });

    const events: InspectionEvent[] = [];

    (yield* Effect.tap(createActor(machine, {
      inspect: (ev) => Effect.sync(() => {
        events.push(ev);
      })
    }), (a) => a.start));

    // Four differences from the upstream text, named by a "Tests not ported" ledger row (SD-26):
    // the session id is the port's, x:0 per system where upstream's module-global counter
    // gives x:4 (SD-9); `assign` is an action definition object, not a function (D15); a
    // machine snapshot's JSON has no `error` or `output` key while they are `Option.none()`
    // (D8, SD-7); and the `sourceRef` of the init event is `Option.none()` (D8). The rest is
    // the upstream text.
    expect(events).toMatchInlineSnapshot(`
      [
        {
          "actorRef": {
            "id": "x:0",
            "xstate$$type": 1,
          },
          "rootId": "x:0",
          "type": "@xstate.actor",
        },
        {
          "_transitions": [
            {
              "actions": [
                {
                  "exec": [Function],
                  "type": "xstate.assign",
                },
              ],
              "eventType": "",
              "guard": undefined,
              "reenter": false,
              "source": "#(machine).counting",
              "target": undefined,
              "toJSON": [Function],
            },
          ],
          "actorRef": {
            "id": "x:0",
            "xstate$$type": 1,
          },
          "event": {
            "input": undefined,
            "type": "xstate.init",
          },
          "rootId": "x:0",
          "snapshot": {
            "children": {},
            "context": {
              "count": 1,
            },
            "historyValue": {},
            "status": "active",
            "tags": [],
            "value": "counting",
          },
          "type": "@xstate.microstep",
        },
        {
          "_transitions": [
            {
              "actions": [
                {
                  "exec": [Function],
                  "type": "xstate.assign",
                },
              ],
              "eventType": "",
              "guard": undefined,
              "reenter": false,
              "source": "#(machine).counting",
              "target": undefined,
              "toJSON": [Function],
            },
          ],
          "actorRef": {
            "id": "x:0",
            "xstate$$type": 1,
          },
          "event": {
            "input": undefined,
            "type": "xstate.init",
          },
          "rootId": "x:0",
          "snapshot": {
            "children": {},
            "context": {
              "count": 2,
            },
            "historyValue": {},
            "status": "active",
            "tags": [],
            "value": "counting",
          },
          "type": "@xstate.microstep",
        },
        {
          "_transitions": [
            {
              "actions": [
                {
                  "exec": [Function],
                  "type": "xstate.assign",
                },
              ],
              "eventType": "",
              "guard": undefined,
              "reenter": false,
              "source": "#(machine).counting",
              "target": undefined,
              "toJSON": [Function],
            },
          ],
          "actorRef": {
            "id": "x:0",
            "xstate$$type": 1,
          },
          "event": {
            "input": undefined,
            "type": "xstate.init",
          },
          "rootId": "x:0",
          "snapshot": {
            "children": {},
            "context": {
              "count": 3,
            },
            "historyValue": {},
            "status": "active",
            "tags": [],
            "value": "counting",
          },
          "type": "@xstate.microstep",
        },
        {
          "_transitions": [
            {
              "actions": [],
              "eventType": "",
              "guard": [Function],
              "reenter": false,
              "source": "#(machine).counting",
              "target": [
                "#(machine).done",
              ],
              "toJSON": [Function],
            },
          ],
          "actorRef": {
            "id": "x:0",
            "xstate$$type": 1,
          },
          "event": {
            "input": undefined,
            "type": "xstate.init",
          },
          "rootId": "x:0",
          "snapshot": {
            "children": {},
            "context": {
              "count": 3,
            },
            "historyValue": {},
            "status": "active",
            "tags": [],
            "value": "done",
          },
          "type": "@xstate.microstep",
        },
        {
          "actorRef": {
            "id": "x:0",
            "xstate$$type": 1,
          },
          "event": {
            "input": undefined,
            "type": "xstate.init",
          },
          "rootId": "x:0",
          "sourceRef": {
            "_id": "Option",
            "_tag": "None",
          },
          "type": "@xstate.event",
        },
        {
          "actorRef": {
            "id": "x:0",
            "xstate$$type": 1,
          },
          "event": {
            "input": undefined,
            "type": "xstate.init",
          },
          "rootId": "x:0",
          "snapshot": {
            "children": {},
            "context": {
              "count": 3,
            },
            "historyValue": {},
            "status": "active",
            "tags": [],
            "value": "done",
          },
          "type": "@xstate.snapshot",
        },
      ]
    `);
  }));

  // upstream: test/inspect.test.ts > inspect > can inspect microsteps from raised events
  it.effect('can inspect microsteps from raised events', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          entry: raise({ type: 'to_b' }),
          on: { to_b: 'b' }
        },
        b: {
          entry: raise({ type: 'to_c' }),
          on: { to_c: 'c' }
        },
        c: {}
      }
    });

    const events: InspectionEvent[] = [];

    (yield* Effect.tap(createActor(machine, {
      inspect: (ev) => Effect.sync(() => {
        events.push(ev);
      })
    }), (a) => a.start));

    // The session id is the port's, x:0 per system where upstream's module-global counter
    // gives x:5 (SD-9), named by a "Tests not ported" ledger row (SD-26). The rest is the
    // upstream text.
    expect(simplifyEvents(events)).toMatchInlineSnapshot(`
[
  {
    "actorId": "x:0",
    "type": "@xstate.actor",
  },
  {
    "event": {
      "type": "to_b",
    },
    "transitions": [
      {
        "eventType": "to_b",
        "target": [
          "(machine).b",
        ],
      },
    ],
    "type": "@xstate.microstep",
    "value": "b",
  },
  {
    "event": {
      "type": "to_c",
    },
    "transitions": [
      {
        "eventType": "to_c",
        "target": [
          "(machine).c",
        ],
      },
    ],
    "type": "@xstate.microstep",
    "value": "c",
  },
  {
    "event": {
      "input": undefined,
      "type": "xstate.init",
    },
    "sourceId": undefined,
    "targetId": "x:0",
    "type": "@xstate.event",
  },
  {
    "action": {
      "params": {
        "delay": undefined,
        "event": {
          "type": "to_b",
        },
        "id": undefined,
      },
      "type": "xstate.raise",
    },
    "type": "@xstate.action",
  },
  {
    "action": {
      "params": {
        "delay": undefined,
        "event": {
          "type": "to_c",
        },
        "id": undefined,
      },
      "type": "xstate.raise",
    },
    "type": "@xstate.action",
  },
  {
    "actorId": "x:0",
    "event": {
      "input": undefined,
      "type": "xstate.init",
    },
    "snapshot": {
      "value": "c",
    },
    "status": "active",
    "type": "@xstate.snapshot",
  },
]
`);
  }));

  // upstream: test/inspect.test.ts > inspect > should inspect microsteps for normal transitions
  it.effect('should inspect microsteps for normal transitions', () => Effect.gen(function* () {
    const events: any[] = [];
    const machine = createMachine({
      initial: 'a',
      states: {
        a: { on: { EV: 'b' } },
        b: {}
      }
    });
    const actorRef = (yield* Effect.tap(createActor(machine, {
      inspect: (ev) => Effect.sync(() => { events.push(ev); })
    }), (a) => a.start));
    (yield* actorRef.send({ type: 'EV' }));

    // The session id is the port's, x:0 per system where upstream's module-global counter
    // gives x:6 (SD-9), named by a "Tests not ported" ledger row (SD-26). The rest is the
    // upstream text.
    expect(simplifyEvents(events)).toMatchInlineSnapshot(`
      [
        {
          "actorId": "x:0",
          "type": "@xstate.actor",
        },
        {
          "event": {
            "input": undefined,
            "type": "xstate.init",
          },
          "sourceId": undefined,
          "targetId": "x:0",
          "type": "@xstate.event",
        },
        {
          "actorId": "x:0",
          "event": {
            "input": undefined,
            "type": "xstate.init",
          },
          "snapshot": {
            "value": "a",
          },
          "status": "active",
          "type": "@xstate.snapshot",
        },
        {
          "event": {
            "type": "EV",
          },
          "sourceId": undefined,
          "targetId": "x:0",
          "type": "@xstate.event",
        },
        {
          "event": {
            "type": "EV",
          },
          "transitions": [
            {
              "eventType": "EV",
              "target": [
                "(machine).b",
              ],
            },
          ],
          "type": "@xstate.microstep",
          "value": "b",
        },
        {
          "actorId": "x:0",
          "event": {
            "type": "EV",
          },
          "snapshot": {
            "value": "b",
          },
          "status": "active",
          "type": "@xstate.snapshot",
        },
      ]
    `);
  }));

  // upstream: test/inspect.test.ts > inspect > should inspect microsteps for eventless/always transitions
  it.effect('should inspect microsteps for eventless/always transitions', () => Effect.gen(function* () {
    const events: any[] = [];
    const machine = createMachine({
      initial: 'a',
      states: {
        a: { on: { EV: 'b' } },
        b: { always: 'c' },
        c: {}
      }
    });
    const actorRef = (yield* Effect.tap(createActor(machine, {
      inspect: (ev) => Effect.sync(() => { events.push(ev); })
    }), (a) => a.start));
    (yield* actorRef.send({ type: 'EV' }));

    // The session id is the port's, x:0 per system where upstream's module-global counter
    // gives x:7 (SD-9), named by a "Tests not ported" ledger row (SD-26). The rest is the
    // upstream text.
    expect(simplifyEvents(events)).toMatchInlineSnapshot(`
      [
        {
          "actorId": "x:0",
          "type": "@xstate.actor",
        },
        {
          "event": {
            "input": undefined,
            "type": "xstate.init",
          },
          "sourceId": undefined,
          "targetId": "x:0",
          "type": "@xstate.event",
        },
        {
          "actorId": "x:0",
          "event": {
            "input": undefined,
            "type": "xstate.init",
          },
          "snapshot": {
            "value": "a",
          },
          "status": "active",
          "type": "@xstate.snapshot",
        },
        {
          "event": {
            "type": "EV",
          },
          "sourceId": undefined,
          "targetId": "x:0",
          "type": "@xstate.event",
        },
        {
          "event": {
            "type": "EV",
          },
          "transitions": [
            {
              "eventType": "EV",
              "target": [
                "(machine).b",
              ],
            },
          ],
          "type": "@xstate.microstep",
          "value": "b",
        },
        {
          "event": {
            "type": "EV",
          },
          "transitions": [
            {
              "eventType": "",
              "target": [
                "(machine).c",
              ],
            },
          ],
          "type": "@xstate.microstep",
          "value": "c",
        },
        {
          "actorId": "x:0",
          "event": {
            "type": "EV",
          },
          "snapshot": {
            "value": "c",
          },
          "status": "active",
          "type": "@xstate.snapshot",
        },
      ]
    `);
  }));

  // upstream: test/inspect.test.ts > inspect > should inspect actions
  it.effect('should inspect actions', () => Effect.gen(function* () {
    const events: InspectedActionEvent[] = [];

    const machine = setup({
      actions: {
        enter1: () => {},
        exit1: () => {},
        stringAction: () => {},
        namedAction: () => {}
      }
    }).createMachine({
      entry: 'enter1',
      exit: 'exit1',
      initial: 'loading',
      states: {
        loading: {
          on: {
            event: {
              target: 'done',
              actions: [
                'stringAction',
                { type: 'namedAction', params: { foo: 'bar' } },
                () => {
                  /* inline */
                }
              ]
            }
          }
        },
        done: {
          type: 'final'
        }
      }
    });

    const actor = (yield* createActor(machine, {
      inspect: (ev) => Effect.sync(() => {
        if (ev.type === '@xstate.action') {
          events.push(ev);
        }
      })
    }));

    (yield* actor.start);
    (yield* actor.send({ type: 'event' }));

    expect(simplifyEvents(events, (ev) => ev.type === '@xstate.action'))
      .toMatchInlineSnapshot(`
[
  {
    "action": {
      "params": undefined,
      "type": "enter1",
    },
    "type": "@xstate.action",
  },
  {
    "action": {
      "params": undefined,
      "type": "stringAction",
    },
    "type": "@xstate.action",
  },
  {
    "action": {
      "params": {
        "foo": "bar",
      },
      "type": "namedAction",
    },
    "type": "@xstate.action",
  },
  {
    "action": {
      "params": undefined,
      "type": "(anonymous)",
    },
    "type": "@xstate.action",
  },
  {
    "action": {
      "params": undefined,
      "type": "exit1",
    },
    "type": "@xstate.action",
  },
]
`);
  }));

  // upstream: test/inspect.test.ts > inspect > @xstate.microstep inspection events should report no transitions if an unknown event was sent
  it.effect('@xstate.microstep inspection events should report no transitions if an unknown event was sent', () => Effect.gen(function* () {
    const machine = createMachine({});
    expect.assertions(1);

    // The port reports an error thrown by an inspection function through the logger and
    // goes on (SD-21, DEV-22), so a failed `expect` inside it would not fail the test. The
    // function records what upstream asserts on; the assertion runs here, once per
    // `@xstate.microstep` event, as upstream's does.
    const transitionCounts: number[] = [];
    const actor = (yield* createActor(machine, {
      inspect: (ev) => Effect.sync(() => {
        if (ev.type === '@xstate.microstep') {
          transitionCounts.push(ev._transitions.length);
        }
      })
    }));

    (yield* actor.start);
    (yield* actor.send({ type: 'any' }));

    for (const transitionCount of transitionCounts) {
      expect(transitionCount).toBe(0);
    }
  }));

  // upstream: test/inspect.test.ts > inspect > actor.system.inspect(…) can inspect actors
  it.effect('actor.system.inspect(…) can inspect actors', () => Effect.gen(function* () {
    const actor = (yield* createActor(createMachine({})));
    const events: InspectionEvent[] = [];

    // Scoped (D6): the function is removed when the test's scope closes
    yield* actor.system.inspect((ev) => Effect.sync(() => {
      events.push(ev);
    }));

    (yield* actor.start);

    expect(events).toContainEqual(
      expect.objectContaining({
        type: '@xstate.event'
      })
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: '@xstate.snapshot'
      })
    );
  }));

  // NOT PORTED: actor.system.inspect(…) can inspect actors (observer). The observer-object
  // form of system.inspect is not ported (SD-18, D6, DEV-20): a "Tests not ported" ledger row.

  // upstream: test/inspect.test.ts > inspect > actor.system.inspect(…) can be unsubscribed
  it.effect('actor.system.inspect(…) can be unsubscribed', () => Effect.gen(function* () {
    const actor = (yield* createActor(createMachine({})));
    const events: InspectionEvent[] = [];

    // No `Subscription` object (D6, DEV-4): the inspection ends when the scope it runs in
    // closes, so `sub` is that scope
    const sub = yield* Scope.make();
    yield* actor.system.inspect((ev) => Effect.sync(() => {
      events.push(ev);
    })).pipe(Scope.provide(sub));

    (yield* actor.start);

    expect(events.length).toEqual(2);

    events.length = 0;

    yield* Scope.close(sub, Exit.void);

    (yield* actor.send({ type: 'someEvent' }));

    expect(events.length).toEqual(0);
  }));

  // NOT PORTED: actor.system.inspect(…) can be unsubscribed (observer). The observer-object
  // form of system.inspect is not ported (SD-18, D6, DEV-20): a "Tests not ported" ledger row.
});
