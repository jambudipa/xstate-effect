/**
 * S27: state and transition meta are typed separately and kept at runtime.
 *
 * T3.25. Upstream xstate@5.33.2 (`test/meta.test.ts`, `src/types.ts`, `src/stateUtils.ts`,
 * `src/StateNode.ts`):
 *
 * - `setup({ types: { meta, transitionMeta } })` and `createMachine({ types: { meta,
 *   transitionMeta } })` type a state node's `meta` with `meta`, and the `meta` of every
 *   transition (`on`, `always`, `after`, `onDone`, the invoke `onDone`/`onError`, `route`, the
 *   object form of `initial`) with `transitionMeta`. Without `transitionMeta`, `meta` types
 *   both (5.33 compatibility). The config's meta fields infer nothing (`DoNotInfer`), so a
 *   machine with no meta types takes any meta.
 * - `snapshot.getMeta()` gives the meta of each active node by node id, typed
 *   `TMeta | undefined`.
 * - A transition definition (`formatTransition`) spreads its config: `meta` and `description`
 *   are there, plain, exactly when the config has them. Its `toJSON()` spreads the definition
 *   with `source: '#<id>'` and the targets as `#<id>` (`undefined` for no target), so it holds
 *   a `guard` key and its own `toJSON`.
 * - `stateNode.after` lists the delayed transitions, each with its `delay`; the initial
 *   transition keeps the `meta` and `description` of `initial: { target, meta, description }`.
 * - `machine.getTransitionData` returns the selected definitions with their meta, and
 *   `machine.toJSON()` writes the meta in `on`, `transitions` and `initial`.
 *
 * A node's own `meta` and `description` are the config values or `undefined`, as upstream,
 * and its `initial` is upstream's initial transition definition, on every node. The port:
 * `getTransitionData` returns an Effect (SD-13). The meta types here come from `setup`
 * (upstream meta.test.ts, in CONF-5, also covers `createMachine({ types })`).
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { createActor, createMachine, setup } from "../../src/index.js"

// ---------------------------------------------------------------- fixtures

/** The state meta of the separate-types machine. */
interface ViewMeta {
  readonly view: "compact" | "full"
}

/** The transition meta of the separate-types machine. */
interface TrackMeta {
  readonly analyticsEvent: string
}

/** The transition meta of the transition-data machine. */
interface SourceMeta {
  readonly source: string
}

/** A route event, which the machines below take besides their own events. */
interface RouteEvent {
  readonly type: "xstate.route"
  readonly to: string
}

/** Separate state and transition meta types through `setup`. */
const separateMetaMachine = () =>
  setup({
    types: {
      meta: {} as ViewMeta,
      transitionMeta: {} as TrackMeta,
    },
  }).createMachine({
    id: "s27",
    initial: "idle",
    states: {
      idle: {
        meta: { view: "compact" },
        on: {
          NEXT: { target: "done", meta: { analyticsEvent: "next" }, description: "go on" },
        },
      },
      done: { meta: { view: "full" } },
    },
  })

/** A transition meta on each kind of transition a node has. */
const transitionDataMachine = () =>
  setup({
    types: {
      events: {} as { readonly type: "GO" } | RouteEvent,
      transitionMeta: {} as SourceMeta,
    },
  }).createMachine({
    id: "data",
    initial: { target: "idle", meta: { source: "initial" }, description: "start" },
    states: {
      idle: {
        on: { GO: { target: "busy", meta: { source: "on" }, description: "go" } },
        always: { guard: () => false, target: "busy", meta: { source: "always" } },
        after: { 100: { target: "busy", meta: { source: "after" } } },
      },
      busy: { id: "busy", route: { meta: { source: "route" } } },
    },
  })

// ---------------------------------------------------------------- tests

describe("S27 State and transition meta are typed separately and kept at runtime", () => {
  it.effect("[S27] setup types state meta and transition meta separately", () =>
    Effect.gen(function* () {
      const machine = separateMetaMachine()
      const actor = yield* createActor(machine)
      const meta = (yield* actor.getSnapshot).getMeta()

      // The state meta type reaches getMeta(); the transition meta type the transitions
      meta["s27.idle"] satisfies ViewMeta | undefined
      assert.deepStrictEqual(meta, { "s27.idle": { view: "compact" } })

      const next = machine.states["idle"]!.transitions.find(([descriptor]) => descriptor === "NEXT")![1][0]!
      next.meta satisfies TrackMeta | undefined
      // @ts-expect-error the state meta type is not the transition meta type
      next.meta satisfies ViewMeta | undefined
      assert.deepStrictEqual(next.meta, { analyticsEvent: "next" })
      assert.strictEqual(next.description, "go on")

      const definition = machine.definition.states["idle"]!
      definition.meta satisfies ViewMeta | undefined
      definition.transitions[0]!.meta satisfies TrackMeta | undefined
      assert.deepStrictEqual(definition.meta, { view: "compact" })
      assert.deepStrictEqual(definition.transitions[0]!.meta, { analyticsEvent: "next" })

      // A node's own meta is the config value (upstream), of the state meta type
      const idleMeta = machine.states["idle"]!.meta
      idleMeta satisfies ViewMeta | undefined
      assert.deepStrictEqual(idleMeta, { view: "compact" })
    })
  )

  it.effect("[S27] types.meta alone types the transition meta too", () =>
    Effect.sync(() => {
      const machine = setup({ types: { meta: {} as { readonly legacy: string } } }).createMachine({
        meta: { legacy: "state" },
        on: { NEXT: { meta: { legacy: "transition" } } },
      })

      const next = machine.root.transitions.find(([descriptor]) => descriptor === "NEXT")![1][0]!
      next.meta satisfies { readonly legacy: string } | undefined
      assert.deepStrictEqual(next.meta, { legacy: "transition" })
      assert.deepStrictEqual(machine.definition.meta, { legacy: "state" })
    })
  )

  it.effect("[S27] a machine without meta types takes any meta, as the config infers no meta type", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "light",
        initial: "green",
        states: {
          green: { meta: ["green", "array", "data"], on: { TIMER: { target: "yellow", meta: 1 } } },
          yellow: { meta: { yellowData: "yellow data" } },
        },
      })
      const actor = yield* createActor(machine)
      assert.deepStrictEqual((yield* actor.getSnapshot).getMeta(), { "light.green": ["green", "array", "data"] })
      assert.strictEqual(machine.states["green"]!.transitions.find(([descriptor]) => descriptor === "TIMER")![1][0]!.meta, 1)
    })
  )

  it.effect("[S27] a transition's meta is in the transition data", () =>
    Effect.gen(function* () {
      const machine = transitionDataMachine()
      const snapshot = (yield* machine.resolveState({ value: "idle" }))

      const [go] = yield* machine.getTransitionData(snapshot, { type: "GO" })
      assert.deepStrictEqual(go?.meta, { source: "on" })
      assert.strictEqual(go?.description, "go")

      const [route] = yield* machine.getTransitionData(snapshot, { type: "xstate.route", to: "#busy" })
      assert.deepStrictEqual(route?.meta, { source: "route" })

      const idle = machine.states["idle"]!
      idle.always[0]!.meta satisfies SourceMeta | undefined
      assert.deepStrictEqual(idle.always[0]!.meta, { source: "always" })

      // Upstream `stateNode.after`: the delayed transitions with their delay
      idle.after[0]!.meta satisfies SourceMeta | undefined
      assert.strictEqual(idle.after.length, 1)
      assert.deepStrictEqual(idle.after[0]!.meta, { source: "after" })
      assert.strictEqual(idle.after[0]!.delay, 100)
      assert.strictEqual(idle.after[0]!.eventType, "xstate.after.100.data.idle")
      assert.strictEqual(idle.after[0], idle.transitions.find(([descriptor]) => descriptor === "xstate.after.100.data.idle")![1][0])

      // The initial transition keeps its meta and description
      const initial = machine.root.initial
      initial.meta satisfies SourceMeta | undefined
      assert.deepStrictEqual(initial.meta, { source: "initial" })
      assert.strictEqual(initial.description, "start")
      machine.definition.initial.meta satisfies SourceMeta | undefined
      assert.deepStrictEqual(machine.definition.initial.meta, { source: "initial" })
      assert.strictEqual(machine.definition.initial.description, "start")
    })
  )

  it.effect("[S27] a transition's meta is in machine.toJSON()", () =>
    Effect.sync(() => {
      const json = JSON.parse(JSON.stringify(transitionDataMachine())) as {
        readonly initial: { readonly meta: unknown; readonly description: unknown }
        readonly on: Readonly<Record<string, ReadonlyArray<{ readonly meta: unknown }>>>
        readonly states: Readonly<
          Record<
            string,
            {
              readonly on: Readonly<Record<string, ReadonlyArray<{ readonly meta: unknown; readonly description?: unknown }>>>
              readonly transitions: ReadonlyArray<{ readonly eventType: string; readonly meta: unknown }>
            }
          >
        >
      }

      assert.deepStrictEqual(json.initial.meta, { source: "initial" })
      assert.strictEqual(json.initial.description, "start")
      assert.deepStrictEqual(json.on["xstate.route"]?.[0]?.meta, { source: "route" })
      assert.deepStrictEqual(json.states["idle"]?.on["GO"]?.[0]?.meta, { source: "on" })
      assert.strictEqual(json.states["idle"]?.on["GO"]?.[0]?.description, "go")
      assert.deepStrictEqual(
        json.states["idle"]?.transitions.map((transition) => [transition.eventType, transition.meta]),
        [
          ["GO", { source: "on" }],
          ["xstate.after.100.data.idle", { source: "after" }],
        ]
      )
    })
  )

  it.effect("[S27] a transition's JSON form spreads the definition, as upstream formatTransition does", () =>
    Effect.sync(() => {
      const machine = createMachine({
        id: "json",
        initial: "a",
        states: {
          a: {
            on: {
              GO: "b",
              STAY: { actions: "noop" },
              NOTE: { target: "b", description: "noted", meta: { n: 1 } },
            },
          },
          b: {},
        },
      })
      const a = machine.states["a"]!
      const go = a.transitions.find(([descriptor]) => descriptor === "GO")![1][0]!
      const stay = a.transitions.find(([descriptor]) => descriptor === "STAY")![1][0]!
      const note = a.transitions.find(([descriptor]) => descriptor === "NOTE")![1][0]!

      // `meta` and `description` are there exactly when the config has them
      assert.isFalse("meta" in go)
      assert.isFalse("description" in go)
      assert.deepStrictEqual(note.meta, { n: 1 })
      assert.strictEqual(note.description, "noted")

      const goJson = go.toJSON() as Readonly<Record<string, unknown>>
      assert.deepStrictEqual(Object.keys(goJson).sort(), ["actions", "eventType", "guard", "reenter", "source", "target", "toJSON"])
      assert.deepStrictEqual(goJson["target"], ["#json.b"])
      assert.strictEqual(goJson["source"], "#json.a")
      assert.strictEqual(goJson["guard"], undefined)
      assert.strictEqual(goJson["toJSON"], go.toJSON)

      const stayJson = stay.toJSON() as Readonly<Record<string, unknown>>
      assert.isTrue("target" in stayJson)
      assert.strictEqual(stayJson["target"], undefined)
      assert.deepStrictEqual(stayJson["actions"], ["noop"])

      const noteJson = note.toJSON() as Readonly<Record<string, unknown>>
      assert.deepStrictEqual(noteJson["meta"], { n: 1 })
      assert.strictEqual(noteJson["description"], "noted")
    })
  )

  it.effect("[S27] the test type-check rejects meta of the wrong type", () =>
    Effect.gen(function* () {
      const machine = setup({
        types: {
          meta: {} as { readonly layout: string },
          transitionMeta: {} as { readonly transition: string },
        },
      }).createMachine({
        initial: "a",
        states: {
          a: {
            meta: {
              // @ts-expect-error a state meta needs a string layout
              layout: 42,
            },
            on: {
              E: {
                meta: {
                  // @ts-expect-error the state meta is not the transition meta
                  layout: "e",
                },
              },
              // A wrong value type fails the whole transition entry, so the error is at the
              // event key (upstream meta.test: "error is here for some reason...")
              // @ts-expect-error a transition meta needs a string transition
              F: {
                meta: {
                  transition: 1,
                },
              },
            },
          },
          b: {
            meta: {
              // @ts-expect-error the transition meta is not the state meta
              transition: "b",
            },
          },
          c: {},
        },
      })

      const meta = (yield* machine.resolveState({ value: "a" })).getMeta()
      meta["(machine).a"] satisfies { readonly layout: string } | undefined
      // @ts-expect-error getMeta() gives the state meta type
      meta["(machine).a"] satisfies { readonly layout: number } | undefined
      // @ts-expect-error a node may have no meta
      meta["(machine).a"] satisfies { readonly layout: string }
      // The rejected meta is still kept at run time
      assert.deepStrictEqual<unknown>(meta, { "(machine).a": { layout: 42 } })
    })
  )
})
