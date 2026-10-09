import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { createMachine, assign } from "../../src/index.js";
import machineSchema from "./fixtures/machine.schema.json" with { type: "json" };

// The named export: under NodeNext the default import of the CommonJS `ajv` is not constructable.
import { Ajv } from 'ajv';

const ajv = new Ajv();
const validate = ajv.compile(machineSchema);

describe('json', () => {
  // upstream: test/json.test.ts > json > should serialize the machine
  it.effect('should serialize the machine', () => Effect.gen(function* () {
    interface Context {
      [key: string]: any;
    }

    const machine = createMachine({
      types: {} as { context: Context },
      initial: 'foo',
      version: '1.0.0',
      context: {
        number: 0,
        string: 'hello'
      },
      invoke: [{ id: 'invokeId', src: 'invokeSrc' }],
      states: {
        testActions: {
          invoke: [{ id: 'invokeId', src: 'invokeSrc' }],
          entry: [
            'stringActionType',
            {
              type: 'objectActionType'
            },
            {
              type: 'objectActionTypeWithExec',
              exec: () => {
                return true;
              },
              other: 'any'
            },
            function actionFunction() {
              return true;
            },
            // TODO: investigate why this had to be casted to any to satisfy TS
            assign({
              number: 10,
              string: 'test',
              evalNumber: () => 42
            }) as any,
            assign((ctx) => ({
              ...ctx
            }))
          ],
          on: {
            TO_FOO: {
              target: ['foo', 'bar'],
              guard: ({ context }) => !!context.string
            }
          },
          after: {
            1000: 'bar'
          }
        },
        foo: {},
        bar: {},
        testHistory: {
          type: 'history',
          history: 'deep'
        },
        testFinal: {
          type: 'final',
          output: {
            something: 'else'
          }
        },
        testParallel: {
          type: 'parallel',
          states: {
            one: {
              initial: 'inactive',
              states: {
                inactive: {}
              }
            },
            two: {
              initial: 'inactive',
              states: {
                inactive: {}
              }
            }
          }
        }
      },
      output: { result: 42 }
    });

    const json = JSON.parse(JSON.stringify(machine.definition));

    try {
      validate(json);
    } catch (err: any) {
      throw new Error(JSON.stringify(JSON.parse(err.message), null, 2));
    }

    expect(validate.errors).toBeNull();
  }));

  // upstream: test/json.test.ts > json > should detect an invalid machine
  it.effect('should detect an invalid machine', () => Effect.gen(function* () {
    const invalidMachineConfig = {
      id: 'something',
      key: 'something',
      type: 'invalid type',
      states: {}
    };

    validate(invalidMachineConfig);
    expect(validate.errors).not.toBeNull();
  }));

  // upstream: test/json.test.ts > json > should not double-serialize invoke transitions
  it.effect('should not double-serialize invoke transitions', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'active',
      states: {
        active: {
          id: 'active',
          invoke: {
            src: 'someSrc',
            onDone: 'foo',
            onError: 'bar'
          },
          on: {
            EVENT: 'foo'
          }
        },
        foo: {},
        bar: {}
      }
    });

    const machineJSON = JSON.stringify(machine);

    const machineObject = JSON.parse(machineJSON);

    const revivedMachine = createMachine(machineObject);

    // The port's transitions are the upstream Map's entries in its order (SD-22, amended 2026-10-08)
    expect(revivedMachine.states.active!.transitions.flatMap(([, transitions]) => transitions))
      .toMatchInlineSnapshot(`
      [
        {
          "actions": [],
          "eventType": "EVENT",
          "guard": undefined,
          "reenter": false,
          "source": "#active",
          "target": [
            "#(machine).foo",
          ],
          "toJSON": [Function],
        },
        {
          "actions": [],
          "eventType": "xstate.done.actor.0.active",
          "guard": undefined,
          "reenter": false,
          "source": "#active",
          "target": [
            "#(machine).foo",
          ],
          "toJSON": [Function],
        },
        {
          "actions": [],
          "eventType": "xstate.error.actor.0.active",
          "guard": undefined,
          "reenter": false,
          "source": "#active",
          "target": [
            "#(machine).bar",
          ],
          "toJSON": [Function],
        },
      ]
    `);

    // 1. onDone
    // 2. onError
    // 3. EVENT
    expect(
      (yield* revivedMachine.getStateNodeById('active')).transitions.flatMap(
        ([, t]) => t
      ).length
    ).toBe(3);
  }));
});
