/**
 * A16: stateIn checks the active configuration.
 *
 * T4.16. Upstream `stateIn` and `checkStateIn` in `src/guards.ts` at xstate@5.33.2: the guard
 * is decided against the snapshot it is evaluated with. A string that starts with `#` names a
 * state node through `snapshot.machine.getStateNodeById` (an id, then an optional key path,
 * as in `#b.B1`), and the guard holds when that node is one of the snapshot's active nodes
 * (`snapshot._nodes`); any other state value is `snapshot.matches(stateValue)`, so a dotted
 * string is a path and a parallel region key matches. The check reads the whole
 * configuration, so a guard deep inside one region tests a node of another region (the
 * "relative to grandparent" cases). An id that names no node throws
 * `Child state node '#<id>' does not exist on machine '<id>'` from inside the guard, which
 * the transition selection wraps in its guard-evaluation message (the guard is a function,
 * so the message names no guard type).
 *
 * The snapshot is the one each evaluation gets: an eventless selection reads the interim
 * snapshot of that iteration, `snapshot.can` reads the snapshot it is called on, and an
 * `enqueueActions` `check` reads the snapshot of that point of the action list, whose
 * configuration is the one from before the microstep (upstream `microstep` replaces
 * `_nodes` only at its end), in transition and entry actions alike.
 *
 * Port: `stateIn` is a guard definition (D15), so it works by name and inside `and`, `or`
 * and `not`; `stateNotIn` (port extra) negates it. The evaluator's `GuardScope` and a guard
 * definition's `GuardContext` carry the snapshot as `snapshot`; with none, no state is
 * active and `stateIn` is false.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import {
  and,
  createActor,
  createMachine,
  enqueueActions,
  guards,
  not,
  or,
  stateIn,
  stateNotIn,
  type Types,
} from "../../src/index.js"
import { childStateNodeDoesNotExist, guardEvaluationFailed } from "./upstream-messages.js"

/** The error the snapshot holds; fails the test when it holds none. */
const errorOf = (snapshot: { readonly error: Option.Option<unknown> }): Error => {
  assert.isTrue(Option.isSome(snapshot.error), "the snapshot holds an error")
  const error = Option.getOrUndefined(snapshot.error)
  assert.instanceOf(error, Error)
  return error as Error
}

/**
 * Two parallel regions: region `a` moves on events guarded by `stateIn` and `stateNotIn` of
 * region `b`, whose `on` node has the id `b_on`; `TOGGLE` switches region `b`.
 */
const regionsMachine = () =>
  createMachine({
    id: "a16",
    type: "parallel",
    states: {
      a: {
        initial: "a1",
        states: {
          a1: {
            on: {
              BY_ID: { target: "byId", guard: stateIn("#b_on") },
              BY_OBJECT: { target: "byObject", guard: stateIn({ b: "on" }) },
              BY_PATH: { target: "byPath", guard: stateIn("b.on") },
              BY_REGION: { target: "byRegion", guard: stateIn("b") },
              NOT_ON: { target: "notOn", guard: stateNotIn("#b_on") },
            },
          },
          byId: {},
          byObject: {},
          byPath: {},
          byRegion: {},
          notOn: {},
        },
      },
      b: {
        initial: "off",
        states: {
          off: { on: { TOGGLE: "on" } },
          on: { id: "b_on", on: { TOGGLE: "off" } },
        },
      },
    },
  })

/** The value of region `a` after the events, sent one by one to a new actor of the regions machine. */
const regionAAfter = (events: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const actor = yield* createActor(regionsMachine())
    yield* actor.start
    for (const type of events) {
      yield* actor.send({ type })
    }
    const value = (yield* actor.getSnapshot).value
    return typeof value === "string" ? value : value["a"]
  })

interface Ctx {
  readonly count: number
}

type Ev = { readonly type: "GO" } | { readonly type: "PING" }

describe("A16 stateIn checks the active configuration", () => {
  it.effect("[A16] stateIn(\"#id\") lets the transition be taken only while the state node with that id is active in the other region", () =>
    Effect.gen(function* () {
      assert.strictEqual(yield* regionAAfter(["BY_ID"]), "a1", "b_on is not active")
      assert.strictEqual(yield* regionAAfter(["TOGGLE", "BY_ID"]), "byId", "b_on is active")
      assert.strictEqual(yield* regionAAfter(["TOGGLE", "TOGGLE", "BY_ID"]), "a1", "b_on is active no more")
    })
  )

  it.effect("[A16] stateIn of a state value uses snapshot.matches: an object value, a dotted path and a parallel region key", () =>
    Effect.gen(function* () {
      assert.strictEqual(yield* regionAAfter(["BY_OBJECT"]), "a1")
      assert.strictEqual(yield* regionAAfter(["TOGGLE", "BY_OBJECT"]), "byObject")
      assert.strictEqual(yield* regionAAfter(["BY_PATH"]), "a1")
      assert.strictEqual(yield* regionAAfter(["TOGGLE", "BY_PATH"]), "byPath")
      assert.strictEqual(yield* regionAAfter(["BY_REGION"]), "byRegion", "a region key matches whatever the region's state")
    })
  )

  it.effect("[A16] stateNotIn (port extra) negates stateIn", () =>
    Effect.gen(function* () {
      assert.strictEqual(yield* regionAAfter(["NOT_ON"]), "notOn")
      assert.strictEqual(yield* regionAAfter(["TOGGLE", "NOT_ON"]), "a1")
    })
  )

  it.effect("[A16] snapshot.can decides a stateIn guard against the snapshot it is called on", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(regionsMachine())
      yield* actor.start
      assert.isFalse(yield* (yield* actor.getSnapshot).can({ type: "BY_ID" }))
      assert.isTrue(yield* (yield* actor.getSnapshot).can({ type: "NOT_ON" }))
      yield* actor.send({ type: "TOGGLE" })
      assert.isTrue(yield* (yield* actor.getSnapshot).can({ type: "BY_ID" }))
      assert.isFalse(yield* (yield* actor.getSnapshot).can({ type: "NOT_ON" }))
    })
  )

  it.effect("[A16] in nested parallel states a guard deep in one region checks a node of another region (the grandparent case), and \"#b.B1\" names a node by id and path", () =>
    Effect.gen(function* () {
      const reached: Array<string> = []
      const machine = createMachine({
        id: "a16-nested",
        type: "parallel",
        states: {
          a: {
            initial: "a1",
            states: {
              a1: { on: { MY_EVENT: { guard: stateIn("#b.B1"), actions: () => reached.push("B1") } } },
            },
          },
          b: {
            id: "b",
            initial: "b2",
            states: {
              B1: {},
              b2: {
                type: "parallel",
                states: {
                  foo: {
                    initial: "foo1",
                    states: {
                      foo1: { on: { EVENT_DEEP: { target: "foo2", guard: stateIn("#bar1") } } },
                      foo2: {},
                    },
                  },
                  bar: {
                    initial: "bar2",
                    states: {
                      bar1: { id: "bar1" },
                      bar2: { on: { SWITCH: "bar1" } },
                    },
                  },
                },
                on: { LEAVE: "B1" },
              },
            },
          },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* actor.send({ type: "EVENT_DEEP" })
      assert.deepStrictEqual((yield* actor.getSnapshot).value, { a: "a1", b: { b2: { foo: "foo1", bar: "bar2" } } })
      yield* actor.send({ type: "SWITCH" })
      yield* actor.send({ type: "EVENT_DEEP" })
      assert.deepStrictEqual((yield* actor.getSnapshot).value, { a: "a1", b: { b2: { foo: "foo2", bar: "bar1" } } })

      yield* actor.send({ type: "MY_EVENT" })
      assert.deepStrictEqual(reached, [], "B1 is not active")
      yield* actor.send({ type: "LEAVE" })
      yield* actor.send({ type: "MY_EVENT" })
      assert.deepStrictEqual(reached, ["B1"])
    })
  )

  it.effect("[A16] stateIn works as a named implementation and inside and, or and not", () =>
    Effect.gen(function* () {
      const machine = createMachine(
        {
          id: "a16-named",
          type: "parallel",
          states: {
            selected: {},
            location: {
              initial: "home",
              states: {
                home: {
                  on: {
                    NAMED: { target: "named", guard: "hasSelection" },
                    AND: { target: "and", guard: and(["hasSelection", stateIn("#a16-named.location.home")]) },
                    OR: { target: "or", guard: or([stateIn("missing"), "hasSelection"]) },
                    NOT: { target: "not", guard: not(stateIn({ location: "away" })) },
                    NOT_TAKEN: { target: "not", guard: not("hasSelection") },
                  },
                },
                named: {},
                and: {},
                or: {},
                not: {},
              },
            },
          },
        },
        {
          guards: {
            hasSelection: stateIn("selected"),
          },
        }
      )
      for (const [type, expected] of [
        ["NAMED", "named"],
        ["AND", "and"],
        ["OR", "or"],
        ["NOT", "not"],
        ["NOT_TAKEN", "home"],
      ] as const) {
        const actor = yield* createActor(machine)
        yield* actor.start
        yield* actor.send({ type })
        assert.deepStrictEqual((yield* actor.getSnapshot).value, { selected: {}, location: expected }, type)
      }
    })
  )

  it.effect("[A16] an always transition guarded by stateIn reads the interim snapshot of each eventless step", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "a16-always",
        type: "parallel",
        states: {
          A: {
            initial: "A2",
            states: {
              A2: { on: { A: "A3" } },
              A3: { always: "A4" },
              A4: { always: "A5" },
              A5: {},
            },
          },
          B: {
            initial: "B0",
            states: {
              B0: { always: [{ target: "B4", guard: stateIn("A.A4") }] },
              B4: {},
            },
          },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      assert.deepStrictEqual((yield* actor.getSnapshot).value, { A: "A2", B: "B0" })
      yield* actor.send({ type: "A" })
      assert.deepStrictEqual((yield* actor.getSnapshot).value, { A: "A5", B: "B4" })
    })
  )

  it.effect("[A16] enqueueActions check(stateIn(...)) reads the configuration from before the microstep, in transition and entry actions", () =>
    Effect.gen(function* () {
      const seen: Array<readonly [string, ReadonlyArray<boolean>]> = []
      const machine = createMachine<Ctx, Ev>({
        id: "a16-check",
        context: { count: 0 },
        initial: "idle",
        states: {
          idle: {
            on: {
              GO: {
                target: "next",
                actions: enqueueActions<Ctx, Ev>(({ check }) => {
                  seen.push([
                    "transition",
                    [check(stateIn("idle")), check(stateIn("#a16-check.next")), check(not(stateIn("idle"))), check(stateNotIn("idle"))],
                  ])
                }),
              },
            },
          },
          next: {
            entry: enqueueActions<Ctx, Ev>(({ check }) => {
              seen.push(["entry", [check(stateIn("idle")), check(stateIn("next"))]])
            }),
            on: {
              PING: {
                actions: enqueueActions<Ctx, Ev>(({ check }) => {
                  seen.push(["ping", [check(stateIn("#a16-check.next")), check(and([stateIn("next"), not(stateIn("idle"))]))]])
                }),
              },
            },
          },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      yield* actor.send({ type: "GO" })
      yield* actor.send({ type: "PING" })

      assert.deepStrictEqual(seen, [
        ["transition", [true, false, false, false]],
        ["entry", [true, false]],
        ["ping", [true, true]],
      ])
    })
  )

  it.effect("[A16] a stateIn id that names no state node sets status error with the upstream guard-evaluation message", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "a16-missing",
        initial: "idle",
        states: {
          idle: { on: { GO: { target: "next", guard: stateIn("#nope") } } },
          next: {},
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      yield* actor.send({ type: "GO" })

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "error")
      assert.strictEqual(
        errorOf(snapshot).message,
        guardEvaluationFailed("", "GO", "a16-missing.idle", childStateNodeDoesNotExist("nope", "a16-missing"))
      )
      assert.strictEqual(snapshot.value, "idle", "the transition is not taken")
    })
  )

  it.effect("[A16] guards.evaluateGuard decides stateIn from the snapshot in its scope, a guard definition receives that snapshot, and with none no state is active", () =>
    Effect.gen(function* () {
      const machine = createMachine<Ctx, Ev>({
        id: "a16-direct",
        context: { count: 0 },
        initial: "idle",
        states: { idle: { on: { GO: "next" } }, next: {} },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      const snapshot = yield* actor.getSnapshot
      const withSnapshot: Types.GuardScope<Ctx, Ev> = {
        self: {} as Types.GuardScope<Ctx, Ev>["self"],
        system: {} as Types.GuardScope<Ctx, Ev>["system"],
        snapshot,
      }
      const withoutSnapshot: Types.GuardScope<Ctx, Ev> = { self: withSnapshot.self, system: withSnapshot.system }
      const event: Ev = { type: "GO" }

      assert.isTrue(yield* guards.evaluateGuard(stateIn<Ctx, Ev>("idle"), snapshot.context, event, withSnapshot))
      assert.isTrue(yield* guards.evaluateGuard(stateIn<Ctx, Ev>("#a16-direct.idle"), snapshot.context, event, withSnapshot))
      assert.isFalse(yield* guards.evaluateGuard(stateIn<Ctx, Ev>("next"), snapshot.context, event, withSnapshot))
      assert.isFalse(yield* guards.evaluateGuard(stateIn<Ctx, Ev>("idle"), snapshot.context, event, withoutSnapshot))
      assert.isTrue(yield* guards.evaluateGuard(stateNotIn<Ctx, Ev>("idle"), snapshot.context, event, withoutSnapshot))

      const definition: Types.GuardDefinition<Ctx, Ev, undefined> = {
        type: "readsSnapshot",
        params: undefined,
        predicate: (ctx) => Effect.succeed(ctx.snapshot !== undefined && ctx.snapshot.matches("idle")),
      }
      assert.isTrue(yield* guards.evaluateGuard(definition, snapshot.context, event, withSnapshot))
      assert.isFalse(yield* guards.evaluateGuard(definition, snapshot.context, event, withoutSnapshot))

      // @ts-expect-error a number is no state value
      stateIn<Ctx, Ev>(42)
    })
  )
})
