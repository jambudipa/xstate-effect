/**
 * S23: snapshot queries `matches`, `hasTag`, `can`, `getMeta` and `toJSON` work.
 *
 * T3.22, SD-6, SD-20. Upstream `createMachineSnapshot` (`src/State.ts` at xstate@5.33.2) gives
 * every machine snapshot the machine that produced it (`snapshot.machine`), the tags of its
 * active state nodes as a native `Set`, and five methods:
 *
 * - `matches(partial)` is `matchesState(partial, this.value)` (`src/utils.ts`): the pattern
 *   comes first, a dotted string is a path, an atomic pattern matches a key of the actual
 *   value (so one region of a parallel state matches), and a pattern deeper than the actual
 *   value does not match.
 * - `hasTag(tag)` is `this.tags.has(tag)`; the tags come from every active node, and a single
 *   tag string in a config is one tag (`toArray(config.tags)`).
 * - `can(event)` selects the transitions as a transition would (`getTransitionData`) and is
 *   true when one of them is not forbidden (`t.target !== undefined || t.actions.length`), so
 *   `{ target: [] }` counts. Guards run; no action runs and nothing is spawned.
 * - `getMeta()` maps the id of each active node with a `meta` to that meta.
 * - `toJSON()` is the snapshot without `_nodes`, `machine` and the methods, with the tags as
 *   an array.
 *
 * The port (SD-6): the methods are non-enumerable own properties that one constructor
 * attaches on every engine path, so spreads cannot drop them and they survive a stopped or
 * errored snapshot; `can` returns an Effect, because guards can be Effects. A guard that
 * throws makes upstream `can` throw the guard-evaluation error (`src/StateNode.ts:459`); in
 * the port the Effect of `can` fails with it (SD-3) and the actor is not touched. `toJSON`
 * is JSON-safe: an `Option` field has the persisted form (no key for `None`, the value for
 * `Some`, SD-7). `StateValue.matches` keeps its symmetric rule (SD-20); the new
 * `StateValue.matchesState` has the XState semantics. The tags are the members of upstream's
 * `Set`, once each, as a list in its order, and `hasTag` reads membership (SD-22, amended
 * 2026-10-08).
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import {
  type ActorLogicType,
  assign,
  createActor,
  createMachine,
  type EventObject,
  fromCallback,
  getInitialSnapshot,
  type MachineSnapshot,
  setup,
  Snapshot,
  StateValue,
} from "../../src/index.js"
import { guardEvaluationFailed, guardNotImplemented } from "./upstream-messages.js"

/** The five methods every machine snapshot carries (SD-6). */
const METHODS = ["matches", "hasTag", "can", "getMeta", "toJSON"] as const

/** Checks that each method is a non-enumerable own function of the snapshot. */
const assertMethods = (snapshot: object, where: string) => {
  for (const name of METHODS) {
    const descriptor = Object.getOwnPropertyDescriptor(snapshot, name)
    assert.isDefined(descriptor, `${where}: ${name} is an own property`)
    assert.isFunction(descriptor?.value, `${where}: ${name} is a function`)
    assert.isFalse(descriptor?.enumerable, `${where}: ${name} is not enumerable`)
  }
  assert.deepStrictEqual(
    Object.keys(snapshot).filter((key) => (METHODS as ReadonlyArray<string>).includes(key)),
    [],
    `${where}: no method is an enumerable key`
  )
}

/** A context that may hold a spawned child. */
interface Refs {
  readonly ref?: unknown
}

/** The initial snapshot of `machine` through `getInitialSnapshot`, widened as S18 widens it. */
const initialSnapshotOf = (machine: object): Effect.Effect<MachineSnapshot> =>
  getInitialSnapshot(machine as ActorLogicType.Any, undefined) as unknown as Effect.Effect<MachineSnapshot>

// ---------------------------------------------------------------- fixtures

/** Nested states: the initial value is `{ a: { b: 'c' } }`. */
const nestedMachine = () =>
  createMachine({
    id: "s23-nested",
    initial: "a",
    states: {
      a: {
        initial: "b",
        states: {
          b: { initial: "c", states: { c: {}, d: {} } },
          e: {},
        },
      },
      x: {},
    },
  })

/** A parallel state: the initial value is `{ p: { r1: 'x', r2: 'y' } }`. */
const parallelMachine = () =>
  createMachine({
    id: "s23-parallel",
    initial: "p",
    states: {
      p: {
        type: "parallel",
        states: {
          r1: { initial: "x", states: { x: {}, z: {} } },
          r2: { initial: "y", states: { y: {} } },
        },
      },
      atom: {},
    },
  })

type TagEvent = { readonly type: "SWITCH" }

/**
 * Tags on the root, on each region's active state (one as a single string) and on an inactive
 * state; `x` repeats a tag, and `z` repeats the tag `yes` of the other region's `y`.
 */
const taggedMachine = () =>
  createMachine<object, TagEvent>({
    id: "s23-tags",
    type: "parallel",
    tags: ["root"],
    context: {},
    states: {
      r1: {
        initial: "x",
        states: {
          x: { tags: ["go", "light", "go"], on: { SWITCH: "z" } },
          z: { tags: ["no", "yes"] },
        },
      },
      r2: {
        initial: "y",
        states: { y: { tags: "yes" } },
      },
    },
  })

/** Meta on the root, on a compound state, on a custom-id leaf and on a parallel region. */
const metaMachine = () =>
  createMachine({
    id: "s23-meta",
    meta: { level: "root" },
    initial: "a",
    states: {
      a: {
        meta: { level: "a" },
        initial: "b",
        states: {
          b: { id: "custom", meta: ["custom", "leaf"] },
          c: { meta: { level: "c" } },
        },
      },
      p: {
        type: "parallel",
        states: {
          left: { meta: { level: "left" } },
          right: {},
        },
      },
    },
    on: { TO_P: ".p" },
  })

describe("S23 Snapshot queries matches, hasTag, can, getMeta and toJSON work", () => {
  // ---------------------------------------------------------------- matches

  it.effect("[S23] snapshot.matches follows XState matchesState: pattern first, dotted strings, a pattern deeper than the value fails", () =>
    Effect.gen(function* () {
      const snapshot = yield* (yield* createActor(nestedMachine())).getSnapshot
      assert.deepStrictEqual(snapshot.value, { a: { b: "c" } })

      assert.isTrue(snapshot.matches("a"))
      assert.isTrue(snapshot.matches("a.b"))
      assert.isTrue(snapshot.matches("a.b.c"))
      assert.isTrue(snapshot.matches({ a: "b" }))
      assert.isTrue(snapshot.matches({ a: { b: "c" } }))
      assert.isFalse(snapshot.matches("x"))
      assert.isFalse(snapshot.matches("a.e"))
      assert.isFalse(snapshot.matches({ a: { b: "d" } }))
      // A pattern deeper than the actual value does not match
      assert.isFalse(snapshot.matches("a.b.c.d"))
      assert.isFalse(snapshot.matches({ a: { b: { c: "deeper" } } }))

      // Snapshot.matches gives the same answers as the method
      assert.isTrue(Snapshot.matches(snapshot, "a.b"))
      assert.isFalse(Snapshot.matches(snapshot, "a.b.c.d"))
    })
  )

  it.effect("[S23] snapshot.matches in a parallel state: one region or one region key matches, a wrong region value does not", () =>
    Effect.gen(function* () {
      const snapshot = yield* (yield* createActor(parallelMachine())).getSnapshot
      assert.deepStrictEqual(snapshot.value, { p: { r1: "x", r2: "y" } })

      assert.isTrue(snapshot.matches("p"))
      assert.isTrue(snapshot.matches({ p: { r1: "x" } }))
      assert.isTrue(snapshot.matches({ p: "r2" }))
      assert.isTrue(snapshot.matches("p.r1.x"))
      assert.isTrue(snapshot.matches({ p: { r1: "x", r2: "y" } }))
      assert.isFalse(snapshot.matches({ p: { r1: "z" } }))
      assert.isFalse(snapshot.matches({ p: { r3: "x" } }))
      assert.isFalse(snapshot.matches("atom"))
    })
  )

  it.effect("[S23] StateValue.matches keeps its symmetric rule (SD-20), while snapshot.matches and StateValue.matchesState have the XState order", () =>
    Effect.gen(function* () {
      const machine = createMachine({ id: "s23-atomic", initial: "a", states: { a: {}, b: {} } })
      const snapshot = yield* (yield* createActor(machine)).getSnapshot
      assert.strictEqual(snapshot.value, "a")

      // The port function: an atomic value and a one-key object match each other both ways
      assert.isTrue(StateValue.matches("a", { a: "b" }))
      assert.isTrue(StateValue.matches({ a: "b" }, "a"))
      assert.isTrue(StateValue.matches({ loading: "pending" }, "loading"))

      // XState: the pattern { a: 'b' } is more specific than the value 'a'
      assert.isFalse(snapshot.matches({ a: "b" }))
      assert.isFalse(StateValue.matchesState({ a: "b" }, "a"))
      assert.isTrue(StateValue.matchesState("a", { a: "b" }))
      assert.isTrue(StateValue.matchesState("a.b", { a: { b: "c" } }))
      assert.isFalse(StateValue.matchesState("a.b.c", "a.b"))
      // A backslash escapes a dot: `a\.b` is the one state key `a.b`, not the path a, b
      assert.isTrue(StateValue.matchesState("a\\.b", { "a.b": "c" }))
      assert.isFalse(StateValue.matchesState("a\\.b", "a.b"))
    })
  )

  // ---------------------------------------------------------------- hasTag and tags

  it.effect("[S23] hasTag reports the tags of every active node, a single tag string is one tag, and tags and toJSON().tags hold each tag once, in the order of upstream's Set", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(taggedMachine())
      yield* actor.start
      const snapshot = yield* actor.getSnapshot

      assert.isTrue(snapshot.hasTag("root"))
      assert.isTrue(snapshot.hasTag("go"))
      assert.isTrue(snapshot.hasTag("light"))
      assert.isTrue(snapshot.hasTag("yes"))
      assert.isFalse(snapshot.hasTag("no"))
      // `tags: 'yes'` is the tag `yes`, not the tags `y` and `e`, `s`
      assert.isFalse(snapshot.hasTag("y"))
      // Upstream's native Set, as the list of its members, each once, in its insertion order
      // (SD-22, amended 2026-10-08): xstate 5.33.2 gives ["root", "go", "light", "yes"], the
      // repeated `go` of `x` once
      assert.isTrue(Array.isArray(snapshot.tags))
      assert.deepStrictEqual(snapshot.tags, ["root", "go", "light", "yes"])
      assert.deepStrictEqual((snapshot.toJSON() as { readonly tags: unknown }).tags, ["root", "go", "light", "yes"])
      assert.isTrue(Snapshot.hasTag(snapshot, "yes"))
      assert.deepStrictEqual([...Snapshot.getTags(snapshot)].sort(), ["go", "light", "root", "yes"])

      // `z` becomes active after `y`, so its tag `no` comes after the tag `yes` that `y` and `z`
      // share: xstate 5.33.2 gives ["root", "yes", "no"]
      yield* actor.send({ type: "SWITCH" })
      const switched = yield* actor.getSnapshot
      assert.deepStrictEqual(switched.tags, ["root", "yes", "no"])
      assert.deepStrictEqual((switched.toJSON() as { readonly tags: unknown }).tags, ["root", "yes", "no"])
      assert.isTrue(switched.hasTag("no"))
      assert.isFalse(switched.hasTag("go"))
    })
  )

  // ---------------------------------------------------------------- getMeta

  it.effect("[S23] getMeta maps the id of each active node that has meta to its meta, the root and custom ids included", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(metaMachine())
      yield* actor.start
      const snapshot = yield* actor.getSnapshot

      assert.deepStrictEqual(snapshot.getMeta(), {
        "s23-meta": { level: "root" },
        "s23-meta.a": { level: "a" },
        custom: ["custom", "leaf"],
      })
      assert.isFalse("s23-meta.a.c" in snapshot.getMeta())

      yield* actor.send({ type: "TO_P" })
      const parallel = yield* actor.getSnapshot
      // `right` has no meta, so it has no key
      assert.deepStrictEqual(parallel.getMeta(), {
        "s23-meta": { level: "root" },
        "s23-meta.p.left": { level: "left" },
      })
      assert.isFalse("s23-meta.p.right" in parallel.getMeta())
    })
  )

  // ---------------------------------------------------------------- toJSON

  it.effect("[S23] toJSON drops the machine and the methods, gives the tags as an array and has no Option object form", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "s23-json",
        initial: "green",
        context: { count: 1 },
        states: {
          green: { tags: ["go", "light"], on: { FINISH: "done" } },
          done: { type: "final" },
        },
        output: () => ({ result: 42 }),
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      const snapshot = yield* actor.getSnapshot

      const json = snapshot.toJSON() as Record<string, unknown>
      assert.deepStrictEqual(Object.keys(json).sort(), ["children", "context", "historyValue", "status", "tags", "value"])
      assert.isTrue(Array.isArray(json["tags"]))
      assert.deepStrictEqual([...(json["tags"] as ReadonlyArray<string>)].sort(), ["go", "light"])
      assert.strictEqual(json["status"], "active")
      assert.strictEqual(json["value"], "green")
      assert.deepStrictEqual(json["context"], { count: 1 })
      assert.isFalse("machine" in json)
      for (const name of METHODS) {
        assert.isFalse(name in json, `${name} is not in the JSON form`)
      }
      // JSON.stringify reads toJSON: the same form, and no Option object form
      const text = JSON.stringify(snapshot)
      assert.deepStrictEqual(JSON.parse(text), JSON.parse(JSON.stringify(json)))
      assert.notInclude(text, "\"_id\":\"Option\"")

      // A done snapshot: the output is its value (an Option field in the persisted form)
      yield* actor.send({ type: "FINISH" })
      const done = yield* actor.getSnapshot
      assert.deepStrictEqual(done.output, Option.some({ result: 42 }))
      const doneJson = done.toJSON() as Record<string, unknown>
      assert.deepStrictEqual(doneJson["output"], { result: 42 })
      assert.strictEqual(doneJson["status"], "done")
      assert.isFalse("error" in doneJson)
      assert.notInclude(JSON.stringify(done), "\"_id\":\"Option\"")
    })
  )

  it.effect("[S23] snapshot.machine is the machine object; the persisted form leaves it and the methods out", () =>
    Effect.gen(function* () {
      const machine = taggedMachine()
      const actor = yield* createActor(machine)
      yield* actor.start
      const snapshot = yield* actor.getSnapshot

      assert.isTrue((snapshot.machine as unknown) === machine)
      assert.strictEqual(snapshot.machine.id, "s23-tags")
      const persisted = (yield* actor.getPersistedSnapshot) as Record<string, unknown>
      assert.isFalse("machine" in persisted)
      for (const name of METHODS) {
        assert.isFalse(name in persisted, `${name} is not in the persisted form`)
      }
    })
  )

  // ---------------------------------------------------------------- can

  it.effect("[S23] can is true for an enabled transition with a target, with actions, or with an empty target list, as upstream", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "s23-can",
        initial: "a",
        context: {},
        states: {
          a: {
            on: {
              TARGET: "b",
              ACTIONS: { actions: () => {} },
              EMPTY_TARGET: { target: [] },
              PASSING: { target: "b", guard: () => true },
              EFFECT_GUARD: { target: "b", guard: () => Effect.succeed(true) },
              SELF: "a",
            },
          },
          b: {},
        },
      })
      const snapshot = yield* (yield* createActor(machine)).getSnapshot

      for (const type of ["TARGET", "ACTIONS", "EMPTY_TARGET", "PASSING", "EFFECT_GUARD", "SELF"]) {
        assert.isTrue(yield* snapshot.can({ type }), type)
      }
    })
  )

  it.effect("[S23] can is false for a failing guard, a forbidden transition and an unknown event", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "s23-cannot",
        initial: "a",
        context: {},
        on: { FORBIDDEN: ".b" },
        states: {
          a: {
            on: {
              FAILING: { target: "b", guard: () => false },
              EFFECT_FAILING: { target: "b", guard: () => Effect.succeed(false) },
              FORBIDDEN: undefined,
            },
          },
          b: {},
        },
      })
      const snapshot = yield* (yield* createActor(machine)).getSnapshot

      for (const type of ["FAILING", "EFFECT_FAILING", "FORBIDDEN", "UNKNOWN"]) {
        assert.isFalse(yield* snapshot.can({ type }), type)
      }
      // The same on a snapshot computed without an actor
      const pure = yield* initialSnapshotOf(machine)
      assert.isFalse(yield* pure.can({ type: "FORBIDDEN" }))
      assert.isFalse(yield* pure.can({ type: "UNKNOWN" }))
    })
  )

  it.effect("[S23] can runs the guards but no action: no assign, no entry action, no spawn, and the actor's snapshot does not change", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = createMachine<Refs, EventObject>({
        id: "s23-no-actions",
        initial: "a",
        context: {},
        states: {
          a: {
            on: {
              ASSIGN: {
                actions: assign<Refs, EventObject>(() => {
                  log.push("assign")
                  return {}
                }),
              },
              SPAWN: {
                actions: assign<Refs, EventObject>(({ spawn }) => ({
                  ref: spawn(
                    fromCallback(() => {
                      log.push("spawned")
                    })
                  ),
                })),
              },
              ENTER: {
                target: "b",
                guard: () => {
                  log.push("guard")
                  return true
                },
                actions: () => log.push("transition action"),
              },
            },
          },
          b: { entry: () => log.push("entry b") },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      const before = yield* actor.getSnapshot

      assert.isTrue(yield* before.can({ type: "ASSIGN" }))
      assert.isTrue(yield* before.can({ type: "SPAWN" }))
      assert.isTrue(yield* before.can({ type: "ENTER" }))

      assert.deepStrictEqual(log, ["guard"])
      const after = yield* actor.getSnapshot
      assert.strictEqual(after, before)
      assert.strictEqual(after.value, "a")
      assert.deepStrictEqual(Object.keys(after.children), [])
      assert.deepStrictEqual(after.context, {})
    })
  )

  it.effect("[S23] can fails its Effect with the recorded guard-evaluation message when a guard throws, and the actor stays active", () =>
    Effect.gen(function* () {
      const machine = setup({
        guards: {
          check: () => {
            throw new Error("check failed")
          },
        },
      }).createMachine({
        id: "s23-guard-error",
        initial: "a",
        states: {
          a: {
            on: {
              INLINE: {
                target: "b",
                guard: () => {
                  throw new Error("boom")
                },
              },
              NAMED: { target: "b", guard: "check" },
              MISSING: { target: "b", guard: "missing" as "check" },
            },
          },
          b: {},
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      const snapshot = yield* actor.getSnapshot

      const inline = yield* Effect.flip(snapshot.can({ type: "INLINE" }))
      assert.strictEqual(inline.message, guardEvaluationFailed("", "INLINE", "s23-guard-error.a", "boom"))
      const named = yield* Effect.flip(snapshot.can({ type: "NAMED" }))
      assert.strictEqual(named.message, guardEvaluationFailed("check", "NAMED", "s23-guard-error.a", "check failed"))
      const missing = yield* Effect.flip(snapshot.can({ type: "MISSING" }))
      assert.strictEqual(
        missing.message,
        guardEvaluationFailed("missing", "MISSING", "s23-guard-error.a", guardNotImplemented("missing"))
      )

      const after = yield* actor.getSnapshot
      assert.strictEqual(after.status, "active")
      assert.strictEqual(after.value, "a")
      assert.deepStrictEqual(after.error, Option.none())
    })
  )

  // ---------------------------------------------------------------- the methods on every path

  it.effect("[S23] the methods survive every engine path: initial, transition, spawn, restore, done, stop and the Snapshot transformers", () =>
    Effect.gen(function* () {
      const machine = createMachine<Refs, EventObject>({
        id: "s23-paths",
        initial: "a",
        context: {},
        states: {
          a: {
            tags: ["at-a"],
            on: {
              SPAWN: {
                actions: assign<Refs, EventObject>(({ spawn }) => ({ ref: spawn(fromCallback(() => {}), { id: "child" }) })),
              },
              NEXT: "b",
            },
          },
          b: { tags: ["at-b"], on: { FINISH: "done" } },
          done: { type: "final" },
        },
      })

      const pure = yield* initialSnapshotOf(machine)
      assertMethods(pure, "getInitialSnapshot")

      const actor = yield* createActor(machine)
      assertMethods(yield* actor.getSnapshot, "created actor")
      yield* actor.start
      yield* actor.send({ type: "SPAWN" })
      const spawned = yield* actor.getSnapshot
      assertMethods(spawned, "after a spawn")
      assert.deepStrictEqual(Object.keys(spawned.children), ["child"])
      yield* actor.send({ type: "NEXT" })
      const next = yield* actor.getSnapshot
      assertMethods(next, "after a transition")
      assert.isTrue(next.matches("b") && next.hasTag("at-b"))
      assert.isTrue(yield* next.can({ type: "FINISH" }))

      // An inline child cannot be persisted, so the restore uses an actor that spawned none
      const persistedActor = yield* createActor(machine)
      yield* persistedActor.start
      yield* persistedActor.send({ type: "NEXT" })
      const restored = yield* createActor(machine, { snapshot: yield* persistedActor.getPersistedSnapshot })
      const restoredSnapshot = yield* restored.getSnapshot
      assertMethods(restoredSnapshot, "restored")
      assert.isTrue(restoredSnapshot.matches("b") && restoredSnapshot.hasTag("at-b"))

      for (const [name, transformed] of [
        ["updateContext", Snapshot.updateContext(next, { other: 1 })],
        ["updateValue", Snapshot.updateValue(next, "a")],
        ["updateStatus", Snapshot.updateStatus(next, "stopped")],
        ["complete", Snapshot.complete(next, "out")],
        ["fail", Snapshot.fail(next, "bad")],
        ["stop", Snapshot.stop(next)],
      ] as const) {
        assertMethods(transformed, name)
        assert.isTrue((transformed.machine as unknown) === machine, name)
      }
      assert.isTrue(Snapshot.updateValue(next, "a").matches("a"))

      yield* actor.send({ type: "FINISH" })
      const done = yield* actor.getSnapshot
      assert.strictEqual(done.status, "done")
      assertMethods(done, "done")
      assert.isTrue(done.matches("done"))
    })
  )

  it.effect("[S23] a stopped and an errored actor's snapshots keep the methods", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "s23-stop",
        initial: "a",
        context: {},
        states: {
          a: {
            tags: ["running"],
            on: {
              GO: "b",
              BREAK: {
                actions: () => {
                  throw new Error("broken")
                },
              },
            },
          },
          b: {},
        },
      })

      const stoppedActor = yield* createActor(machine)
      yield* stoppedActor.start
      yield* stoppedActor.stop
      const stopped = yield* stoppedActor.getSnapshot
      assert.strictEqual(stopped.status, "stopped")
      assertMethods(stopped, "stopped")
      assert.isTrue(stopped.matches("a") && stopped.hasTag("running"))
      assert.isTrue(yield* stopped.can({ type: "GO" }))
      assert.deepStrictEqual(stopped.getMeta(), {})

      const brokenActor = yield* createActor(machine)
      yield* brokenActor.start
      yield* brokenActor.send({ type: "BREAK" })
      const errored = yield* brokenActor.getSnapshot
      assert.strictEqual(errored.status, "error")
      assertMethods(errored, "errored")
      assert.isTrue(errored.matches("a") && errored.hasTag("running"))
    })
  )
})
