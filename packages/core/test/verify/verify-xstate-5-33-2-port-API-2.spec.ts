/**
 * API-2: createMachine and setup().createMachine build equivalent machines (D9, AC 12).
 *
 * T8.5. Upstream xstate@5.33.2 exports both `createMachine(config, implementations)` and
 * `setup(implementations).createMachine(config)`; `setup` only adds typed implementations, so
 * the two build the same machine from one config. D9 keeps both in the port beside each
 * other, with `setup().createMachine` as the typed, preferred path.
 *
 * Each case builds one config object both ways, checks that both are `StateMachine`s with the
 * same definition (`machine.toJSON()`, upstream `definition`), runs the same steps (events,
 * and test-clock waits for a delayed transition) through a live actor of each, and compares
 * the snapshots after start and after every step: the JSON form (`status`, `output`, `error`,
 * `context`, `value`, `children`, `historyValue`, `tags`), the active state nodes in order
 * (`_nodes`, by id) and `getMeta()`. The one config pair below uses context, an inline guard,
 * `assign`, tags, meta, a parallel state, an eventless transition and a final state with an
 * output; its second form names its action, guard and delay, which `createMachine` takes as
 * its second argument and `setup` as its records. The other cases take their machines from
 * upstream rewrites that pass in full (CONF-2 to CONF-5 import them).
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import * as Core from "../../src/index.js"
import {
  type AnyMachineSnapshot,
  type AnyStateMachine,
  assign,
  createActor,
  createMachine,
  type EventObject,
  setup
} from "../../src/index.js"

// ---------------------------------------------------------------- the comparison

/** A step of a run: an event to send, or a wait of the test clock in milliseconds. */
type Step = EventObject | { readonly waitMillis: number }

/** What one snapshot shows: its JSON form, its active state nodes in order and its meta. */
const view = (snapshot: AnyMachineSnapshot) => ({
  json: JSON.parse(JSON.stringify(snapshot)) as unknown,
  nodes: snapshot._nodes.map((node) => node.id),
  meta: snapshot.getMeta()
})

/** Starts a live actor of `machine`, runs `steps` one by one, and views each snapshot. */
const trace = (machine: AnyStateMachine, steps: ReadonlyArray<Step>, input?: unknown) =>
  Effect.scoped(
    Effect.gen(function* () {
      const actor = yield* createActor(machine, input === undefined ? undefined : { input })
      yield* actor.start
      const views = [view(yield* actor.getSnapshot)]
      for (const step of steps) {
        yield* "waitMillis" in step ? TestClock.adjust(step.waitMillis) : actor.send(step)
        views.push(view(yield* actor.getSnapshot))
      }
      return views
    })
  )

/** The two machines have one definition and reach equal snapshots for the same steps. */
const assertEquivalent = (
  viaCreateMachine: AnyStateMachine,
  viaSetup: AnyStateMachine,
  steps: ReadonlyArray<Step>,
  input?: unknown
) =>
  Effect.gen(function* () {
    assert.notStrictEqual(viaSetup, viaCreateMachine, "two separate machines")
    assert.instanceOf(viaCreateMachine, Core.StateMachine)
    assert.instanceOf(viaSetup, Core.StateMachine)
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(viaSetup)),
      JSON.parse(JSON.stringify(viaCreateMachine)),
      "the two machines have the same definition"
    )
    const expected = yield* trace(viaCreateMachine, steps, input)
    const actual = yield* trace(viaSetup, steps, input)
    assert.strictEqual(actual.length, steps.length + 1)
    assert.deepStrictEqual(actual, expected, "the same snapshot after start and after each step")
    return expected
  })

const events = (...types: ReadonlyArray<string>): ReadonlyArray<EventObject> => types.map((type) => ({ type }))

/** The JSON form of the last view of a run. */
const lastJson = (views: ReadonlyArray<ReturnType<typeof view>>) =>
  views.at(-1)?.json as { readonly context: unknown; readonly value: unknown; readonly status: string }

// ---------------------------------------------------------------- the one config pair

interface DoorContext {
  readonly opened: number
  readonly locked: boolean
}

type DoorEvent =
  | { readonly type: "OPEN" }
  | { readonly type: "CLOSE" }
  | { readonly type: "LOCK" }
  | { readonly type: "UNLOCK" }
  | { readonly type: "LIGHT" }
  | { readonly type: "LEAVE" }

/** The type declaration of the door machine. */
const doorTypes = {} as { context: DoorContext; events: DoorEvent; output: number }

/**
 * The one config both builders receive: a parallel root with context, an inline guard,
 * `assign`, tags, meta, an eventless transition and a final state, and a root output.
 */
const doorConfig = {
  id: "door",
  context: { opened: 0, locked: false },
  type: "parallel",
  states: {
    door: {
      initial: "closed",
      states: {
        closed: {
          tags: ["shut"],
          meta: { label: "closed" },
          on: {
            OPEN: { guard: ({ context }: { readonly context: DoorContext }) => !context.locked, target: "open" },
            LOCK: { actions: assign<DoorContext, DoorEvent>({ locked: true }) },
            UNLOCK: { actions: assign<DoorContext, DoorEvent>({ locked: false }) },
            LEAVE: "gone"
          }
        },
        open: {
          entry: assign<DoorContext, DoorEvent>({ opened: ({ context }) => context.opened + 1 }),
          always: { guard: ({ context }: { readonly context: DoorContext }) => context.opened >= 3, target: "gone" },
          on: { CLOSE: "closed" }
        },
        gone: { type: "final" }
      }
    },
    light: {
      initial: "off",
      states: {
        off: { on: { LIGHT: "on" } },
        on: { tags: ["lit"], on: { LIGHT: "off" }, meta: { label: "lit" } }
      }
    }
  },
  output: ({ context }: { readonly context: DoorContext }) => context.opened
} as const

/**
 * The door config with its action, guards and delay named: an open door closes by itself
 * after `autoClose`. `createMachine` takes the implementations as its second argument,
 * `setup` as its records.
 */
const namedDoorConfig = {
  id: "door",
  context: { opened: 0, locked: false },
  initial: "closed",
  states: {
    closed: {
      tags: ["shut"],
      on: {
        OPEN: { guard: "unlocked", target: "open" },
        LOCK: { actions: "lock" },
        UNLOCK: { actions: "unlock" }
      }
    },
    open: {
      entry: "countOpening",
      always: { guard: "worn", target: "gone" },
      after: { autoClose: "closed" },
      on: { CLOSE: "closed" }
    },
    gone: { type: "final" }
  },
  output: ({ context }: { readonly context: DoorContext }) => context.opened
} as const

/** The named implementations of the door, the same records for both builders. */
const doorImplementations = {
  actions: {
    lock: assign<DoorContext, DoorEvent>({ locked: true }),
    unlock: assign<DoorContext, DoorEvent>({ locked: false }),
    countOpening: assign<DoorContext, DoorEvent>({ opened: ({ context }) => context.opened + 1 })
  },
  guards: {
    unlocked: ({ context }: { readonly context: DoorContext }) => !context.locked,
    worn: ({ context }: { readonly context: DoorContext }) => context.opened >= 3
  },
  delays: { autoClose: 1000 }
}

describe("API-2 createMachine and setup().createMachine build equivalent machines", () => {
  it.effect("[API-2] createMachine and setup are both root exports (D9)", () =>
    Effect.sync(() => {
      assert.isFunction(Core.createMachine)
      assert.isFunction(Core.setup)
      assert.isFunction(Core.setup({}).createMachine)
    }))

  it.effect("[API-2] one config built both ways reaches equal snapshots for the same events", () =>
    Effect.gen(function* () {
      // The same object goes to both builders; only the type declaration travels separately,
      // because setup() takes it and createMachine reads it from the config (upstream)
      const viaCreateMachine = createMachine({ types: doorTypes, ...doorConfig })
      const viaSetup = setup({ types: doorTypes }).createMachine(doorConfig)
      const views = yield* assertEquivalent(
        viaCreateMachine,
        viaSetup,
        events("LIGHT", "OPEN", "CLOSE", "LOCK", "OPEN", "UNLOCK", "OPEN", "CLOSE", "LIGHT", "OPEN", "CLOSE", "OPEN")
      )
      // the run is not vacuous: the guard blocks, the counter grows, the eventless transition fires
      const last = lastJson(views)
      assert.deepStrictEqual(last.context, { opened: 3, locked: false })
      assert.deepStrictEqual(last.value, { door: "gone", light: "off" })
    }))

  it.effect("[API-2] one config with named implementations built both ways reaches equal snapshots", () =>
    Effect.gen(function* () {
      // upstream createMachine(config, implementations) and setup(implementations).createMachine(config)
      const viaCreateMachine = createMachine({ types: doorTypes, ...namedDoorConfig }, doorImplementations)
      const viaSetup = setup({ types: doorTypes, ...doorImplementations }).createMachine(namedDoorConfig)
      const views = yield* assertEquivalent(viaCreateMachine, viaSetup, [
        ...events("OPEN"),
        { waitMillis: 999 },
        { waitMillis: 1 },
        ...events("LOCK", "OPEN", "UNLOCK", "OPEN", "CLOSE", "OPEN")
      ])
      // the named delay closes the door (after 1000 ms, not 999), the named guard blocks a
      // locked door, the named action counts, and the named eventless guard ends the run
      assert.strictEqual((views[2]?.json as { readonly value: unknown }).value, "open")
      assert.strictEqual((views[3]?.json as { readonly value: unknown }).value, "closed")
      assert.strictEqual((views[5]?.json as { readonly value: unknown }).value, "closed")
      const last = lastJson(views)
      assert.deepStrictEqual(last.context, { opened: 3, locked: false })
      assert.strictEqual(last.status, "done")
    }))

  // ---------------------------------------------------------------- upstream machines

  it.effect("[API-2] upstream examples/6.6: the machine reaches equal snapshots through both builders", () =>
    Effect.gen(function* () {
      // upstream: test/examples/6.6.test.ts > Example 6.6 (the machine of the file)
      const config = {
        initial: "A",
        states: {
          A: {
            on: { 3: "B" },
            initial: "D",
            states: {
              C: { on: { 2: "#B" } },
              D: { on: { 1: "C" } }
            }
          },
          B: { id: "B", on: { 4: "A.D" } }
        }
      } as const
      yield* assertEquivalent(createMachine(config), setup({}).createMachine(config), events("1", "2", "4", "1", "3", "1", "4"))
    }))

  it.effect("[API-2] upstream examples/6.8: the history machine reaches equal snapshots through both builders", () =>
    Effect.gen(function* () {
      // upstream: test/examples/6.8.test.ts > Example 6.8 (the machine of the file)
      const config = {
        initial: "A",
        states: {
          A: {
            on: { 6: "F" },
            initial: "B",
            states: {
              B: { on: { 1: "C" } },
              C: { on: { 2: "E" } },
              D: { on: { 3: "B" } },
              E: { on: { 4: "B", 5: "D" } },
              hist: { history: true }
            }
          },
          F: { on: { 5: "A.hist" } }
        }
      } as const
      yield* assertEquivalent(
        createMachine(config),
        setup({}).createMachine(config),
        events("1", "2", "6", "5", "5", "3", "FAKE", "6", "5")
      )
    }))

  it.effect("[API-2] upstream examples/cd: the CD player reaches equal snapshots through both builders", () =>
    Effect.gen(function* () {
      // upstream: test/examples/cd.test.ts > Example: CD Player (the machine of the file)
      const config = {
        initial: "not_loaded",
        states: {
          not_loaded: { on: { INSERT_CD: "loaded" } },
          loaded: {
            initial: "stopped",
            on: { EJECT: "not_loaded" },
            states: {
              stopped: { on: { PLAY: "playing" } },
              playing: {
                on: { STOP: "stopped", EXPIRED_END: "stopped", EXPIRED_MID: "playing", PAUSE: "paused" }
              },
              paused: {
                initial: "not_blank",
                states: {
                  blank: { on: { TIMER: "not_blank" } },
                  not_blank: { on: { TIMER: "blank" } }
                },
                on: { PAUSE: "playing", PLAY: "playing", STOP: "stopped" }
              }
            }
          }
        }
      } as const
      yield* assertEquivalent(
        createMachine(config),
        setup({}).createMachine(config),
        events("INSERT_CD", "PLAY", "EXPIRED_MID", "PAUSE", "TIMER", "TIMER", "PLAY", "STOP", "EJECT", "FAKE")
      )
    }))

  it.effect("[API-2] upstream parallel: the word machine reaches equal snapshots through both builders", () =>
    Effect.gen(function* () {
      // upstream: test/parallel.test.ts > wordMachine (module-level machine of the file)
      const config = {
        id: "word",
        type: "parallel",
        states: {
          bold: {
            initial: "off",
            states: { on: { on: { TOGGLE_BOLD: "off" } }, off: { on: { TOGGLE_BOLD: "on" } } }
          },
          underline: {
            initial: "off",
            states: { on: { on: { TOGGLE_UNDERLINE: "off" } }, off: { on: { TOGGLE_UNDERLINE: "on" } } }
          },
          italics: {
            initial: "off",
            states: { on: { on: { TOGGLE_ITALICS: "off" } }, off: { on: { TOGGLE_ITALICS: "on" } } }
          },
          list: {
            initial: "none",
            states: {
              none: { on: { BULLETS: "bullets", NUMBERS: "numbers" } },
              bullets: { on: { NONE: "none", NUMBERS: "numbers" } },
              numbers: { on: { BULLETS: "bullets", NONE: "none" } }
            }
          }
        },
        on: { RESET: "#word" }
      } as const
      yield* assertEquivalent(
        createMachine(config),
        setup({}).createMachine(config),
        events("TOGGLE_BOLD", "BULLETS", "TOGGLE_ITALICS", "NUMBERS", "TOGGLE_BOLD", "RESET", "TOGGLE_UNDERLINE")
      )
    }))

  it.effect("[API-2] upstream assign: the counter machine reaches equal snapshots through both builders", () =>
    Effect.gen(function* () {
      // upstream: test/assign.test.ts > createCounterMachine (the counter machine of the file)
      interface CounterContext {
        readonly count: number
        readonly foo: string
        readonly maybe?: string
      }
      type Counter = CounterContext
      // One object for both builders, so each assigner names its context type itself
      const config = {
        initial: "counting",
        context: { count: 0, foo: "bar" },
        states: {
          counting: {
            on: {
              INC: [{ target: "counting", actions: assign<Counter, EventObject>(({ context }) => ({ count: context.count + 1 })) }],
              DEC: [{ target: "counting", actions: [assign<Counter, EventObject>({ count: ({ context }) => context.count - 1 })] }],
              WIN_PROP: [{ target: "counting", actions: [assign<Counter, EventObject>({ count: () => 100, foo: () => "win" })] }],
              WIN_STATIC: [{ target: "counting", actions: [assign<Counter, EventObject>({ count: 100, foo: "win" })] }],
              WIN_MIX: [{ target: "counting", actions: [assign<Counter, EventObject>({ count: () => 100, foo: "win" })] }],
              WIN: [{ target: "counting", actions: [assign<Counter, EventObject>(() => ({ count: 100, foo: "win" }))] }],
              SET_MAYBE: [{ actions: [assign<Counter, EventObject>({ maybe: "defined" })] }]
            }
          }
        }
      }
      const counterTypes = {} as { context: CounterContext }
      const viaCreateMachine = createMachine({ types: counterTypes, ...config })
      const viaSetup = setup({ types: counterTypes }).createMachine(config)
      const views = yield* assertEquivalent(
        viaCreateMachine,
        viaSetup,
        events("INC", "INC", "DEC", "SET_MAYBE", "WIN_PROP", "DEC", "WIN_MIX", "DEC", "WIN", "DEC", "WIN_STATIC")
      )
      assert.deepStrictEqual(lastJson(views).context, { count: 100, foo: "win", maybe: "defined" })
    }))

  it.effect("[API-2] upstream guards: the light machine with a named guard reaches equal snapshots through both builders", () =>
    Effect.gen(function* () {
      // upstream: test/guards.test.ts > guard conditions > lightMachine (the machine of the
      // describe), whose named guard createMachine takes as its second argument. The rewrite's
      // BAD_COND transition to the guard "doesNotExist" is left out: setup types its guard
      // names, so that name does not compile there.
      interface LightMachineCtx {
        readonly elapsed: number
      }
      type LightMachineEvents =
        | { readonly type: "TIMER" }
        | { readonly type: "EMERGENCY"; readonly isEmergency?: boolean }
        | { readonly type: "TIMER_COND_OBJ" }
      const lightTypes = {} as {
        input: { readonly elapsed?: number }
        context: LightMachineCtx
        events: LightMachineEvents
      }
      const config = {
        context: ({ input }: { readonly input: { readonly elapsed?: number } | undefined }) => ({
          elapsed: input?.elapsed ?? 0
        }),
        initial: "green",
        states: {
          green: {
            on: {
              TIMER: [
                { target: "green", guard: ({ context }: { readonly context: LightMachineCtx }) => context.elapsed < 100 },
                {
                  target: "yellow",
                  guard: ({ context }: { readonly context: LightMachineCtx }) =>
                    context.elapsed >= 100 && context.elapsed < 200
                }
              ],
              EMERGENCY: {
                target: "red",
                guard: ({ event }: { readonly event: { readonly isEmergency?: boolean } }) => event.isEmergency === true
              }
            }
          },
          yellow: {
            on: {
              TIMER: { target: "red", guard: "minTimeElapsed" },
              TIMER_COND_OBJ: { target: "red", guard: { type: "minTimeElapsed" } }
            }
          },
          red: {}
        }
      } as const
      const implementations = {
        guards: {
          minTimeElapsed: ({ context }: { readonly context: LightMachineCtx }) =>
            context.elapsed >= 100 && context.elapsed < 200
        }
      }
      const viaCreateMachine = createMachine({ types: lightTypes, ...config }, implementations)
      const viaSetup = setup({ types: lightTypes, ...implementations }).createMachine(config)
      // upstream "should transition only if condition is met" and the named guard: 120 ms
      // elapsed goes to yellow, then to red by the named guard
      const named = yield* assertEquivalent(viaCreateMachine, viaSetup, events("TIMER", "TIMER"), { elapsed: 120 })
      assert.strictEqual(lastJson(named).value, "red")
      // the guard object form of the same named guard
      yield* assertEquivalent(viaCreateMachine, viaSetup, events("TIMER", "TIMER_COND_OBJ"), { elapsed: 150 })
      // 50 ms elapsed stays green; only an emergency event with the flag goes to red
      const emergency = (isEmergency: boolean): LightMachineEvents => ({ type: "EMERGENCY", isEmergency })
      const event = yield* assertEquivalent(
        viaCreateMachine,
        viaSetup,
        [...events("TIMER"), emergency(false), emergency(true)],
        { elapsed: 50 }
      )
      assert.deepStrictEqual(
        event.map((step) => (step.json as { readonly value: unknown }).value),
        ["green", "green", "green", "red"]
      )
    }))

  it.effect("[API-2] upstream tags: the tagged traffic light reaches equal snapshots through both builders", () =>
    Effect.gen(function* () {
      // upstream: test/tags.test.ts > tags > supports tagging states
      const config = {
        initial: "green",
        states: {
          green: { tags: ["go"], on: { TIMER: "yellow" } },
          yellow: { tags: ["go"], on: { TIMER: "red" } },
          red: { tags: ["stop"] }
        }
      } as const
      yield* assertEquivalent(createMachine(config), setup({}).createMachine(config), events("TIMER", "TIMER", "TIMER"))
    }))

  it.effect("[API-2] upstream final: a machine whose root is final is done at once through both builders", () =>
    Effect.gen(function* () {
      // upstream: test/final.test.ts > final states > status of a machine with a root state being final should be done
      const views = yield* assertEquivalent(
        createMachine({ type: "final" }),
        setup({}).createMachine({ type: "final" }),
        events("ANY")
      )
      assert.strictEqual((views[0]?.json as { readonly status: string }).status, "done")
    }))
})
