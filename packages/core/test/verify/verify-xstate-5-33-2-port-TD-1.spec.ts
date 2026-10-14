/**
 * TD-1: the P0 scenarios of the test design (`skills/test-artifacts/test-design-qa.md`,
 * P0-001 … P0-006), each proved as the one combined scenario the design states.
 *
 * - P0-001 (R-001, SD-23 stop path): closing the caller's scope stops an actor whose invoked
 *   callback cleanup and effect finalizer send to it while the close runs. Each send is dropped
 *   with upstream's warning (`Event "<type>" was sent to stopped actor …`, upstream `_send`), no
 *   exit action runs (upstream runs none on stop), each finalizer runs once, and the close
 *   completes.
 * - P0-002 (R-001, SD-23): a fiber that waits in `actor.send` can be interrupted (directly, or by
 *   a timeout) while the macrostep ahead of it waits; the event it queued is still processed, as
 *   upstream's `send` only enqueues, and the next external send processes and returns after its
 *   macrostep.
 * - P0-003 (R-001, D12, SD-27): closing the caller's scope stops a three-level tree of spawned
 *   and invoked children; each finalizer runs once, the scheduler holds nothing, and a TestClock
 *   advance fires no timer of any level.
 * - P0-004 (R-002): for a parallel state nested in a parallel region, `getAllStateNodes`, the
 *   exit and entry sets of `StateUtils.microstep` and the pure `getMicrosteps` give the orders
 *   upstream `stateUtils.ts` gives (read from xstate@5.33.2 source, not run): exits in reverse
 *   document order, entries in document order, `_nodes` as the kept nodes then the entered ones.
 * - P0-005 (R-003, SD-7): seeded, hand-rolled generators build contexts of nested arrays and
 *   objects that hold JSON values and actor references, children (transition and machine logic,
 *   odd ids, with and without a systemId) and event scripts that reach tags, shallow and deep
 *   history, a done child, a stopped child, and the done and error states; each persisted
 *   snapshot survives JSON, restores to the live snapshot's fields (the Option fields `output`,
 *   `error` and `systemId` included) and persists again to the same JSON, but for a reference to
 *   a stopped child, which revives to undefined (upstream `reviveContext`).
 * - P0-006 (R-003): a parallel machine with an invoked and a spawned child and a pending delayed
 *   transition, restored from its persisted JSON, has the original's snapshot and then the
 *   original's behaviour for the same next events and clock (a child that completes, the delayed
 *   transition, a re-invocation, a region transition).
 *
 * Timers run on TestClock; every other wait is a Deferred handshake or a bounded number of yields.
 */
import { assert, describe, it } from "@effect/vitest"
import { Deferred, Effect, Exit, Fiber, Logger, Option, Predicate, Result } from "effect"
import { TestClock } from "effect/testing"
import type { ActorRefBase } from "../../src/ActorRef.js"
import {
  assign,
  createActor,
  createMachine,
  type EventObject,
  fromCallback,
  fromEffect,
  fromTransition,
  getInitialSnapshot,
  getMicrosteps,
  isActorRef,
  raise,
  sendParent,
  sendTo,
  spawnChild,
  stopChild,
} from "../../src/index.js"
import * as StateUtils from "../../src/stateUtils.js"

// ---------------------------------------------------------------- shared helpers

/** Lets every other ready fiber take a bounded number of turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 50; turn++) {
    yield* Effect.yieldNow
  }
})

/** Yields until `condition` holds, at most 500 turns; gives whether it holds. */
const eventually = (condition: Effect.Effect<boolean>) =>
  Effect.gen(function* () {
    for (let turn = 0; turn < 500; turn++) {
      if (yield* condition) {
        return true
      }
      yield* Effect.yieldNow
    }
    return yield* condition
  })

/** The log entries a test logger kept, by level. */
interface Logged {
  readonly warnings: Array<string>
  readonly errors: Array<string>
}

/** Runs `program` with a logger that keeps the text of every warning and every error. */
const withLogged = <A, E, R>(program: Effect.Effect<A, E, R>) => {
  const logged: Logged = { warnings: [], errors: [] }
  return program.pipe(
    Effect.provide(
      Logger.layer([
        Logger.make((options) => {
          const parts: ReadonlyArray<unknown> = Array.isArray(options.message) ? options.message : [options.message]
          const text = parts.map(String).join(" ")
          if (options.logLevel === "Warn") {
            logged.warnings.push(text)
          }
          if (options.logLevel === "Error" || options.logLevel === "Fatal") {
            logged.errors.push(text)
          }
        }),
      ])
    ),
    Effect.map((result) => ({ result, logged }))
  )
}

/** A value through `JSON.stringify` and `JSON.parse`, as a stored snapshot comes back. */
const throughJson = (value: unknown): unknown => {
  const parsed: unknown = JSON.parse(JSON.stringify(value))
  return parsed
}

/** The own fields of an object value; the test fails for any other value. */
const recordOf = (value: unknown): Readonly<Record<string, unknown>> => {
  if (!Predicate.isObject(value) || Array.isArray(value)) {
    return assert.fail(`not an object: ${String(value)}`)
  }
  return Object.fromEntries(Object.entries(value))
}

/** The children a snapshot holds, by id (none for a snapshot without children). */
const childrenOf = (snapshot: unknown): Readonly<Record<string, unknown>> =>
  Predicate.hasProperty(snapshot, "children") ? recordOf(snapshot.children) : {}

/** The child `id` of a snapshot; the test fails when there is no such actor reference. */
const childOf = (snapshot: unknown, id: string): ActorRefBase => {
  const child = childrenOf(snapshot)[id]
  if (!isActorRef(child)) {
    return assert.fail(`no child "${id}"`)
  }
  return child
}

/** The status of the snapshot an actor reference holds now. */
const statusOf = (ref: ActorRefBase) => Effect.map(ref.getSnapshotUntyped, (snapshot) => snapshot.status)

/** A function action that pushes `name` to `log` when it runs; its function name is `name`. */
const named = (name: string, log: Array<string>): (() => void) => {
  const action = () => {
    log.push(name)
  }
  Object.defineProperty(action, "name", { value: name })
  return action
}

/** The ids of state nodes, in order. */
const idsOf = (nodes: Iterable<{ readonly id: string }>): ReadonlyArray<string> => Array.from(nodes, (node) => node.id)

/** The name of a planned action: a function's name, a string, or an object's `type`. */
const actionName = (action: unknown): string =>
  Predicate.isFunction(action)
    ? action.name
    : Predicate.isString(action)
      ? action
      : Predicate.hasProperty(action, "type")
        ? String(action.type)
        : assert.fail("an action without a name")

// ---------------------------------------------------------------- P0-001 fixtures

interface Heard {
  readonly heard: ReadonlyArray<string>
}

/** Keeps the type of every event the parent takes. */
const hear = assign<Heard, EventObject>(({ context, event }) => ({ heard: [...context.heard, event.type] }))

// ---------------------------------------------------------------- P0-002 fixtures

interface Counter {
  readonly count: number
  readonly blocked: boolean
  readonly order: ReadonlyArray<string>
}

/** Handshakes for a macrostep that waits inside an inline action. */
interface Gate {
  /** Completed when the `block` macrostep reached its inline action. */
  readonly entered: Deferred.Deferred<void>
  /** The `block` macrostep waits for this before it commits. */
  readonly release: Deferred.Deferred<void>
}

/** `increment` adds one; `block` waits on the gate in an inline action, then sets `blocked`. */
const gatedCounter = (gate: Gate) =>
  createMachine<Counter, EventObject>({
    id: "td1-gated",
    context: { count: 0, blocked: false, order: [] },
    on: {
      increment: {
        actions: assign<Counter, EventObject>(({ context }) => ({ count: context.count + 1, order: [...context.order, "increment"] })),
      },
      block: {
        actions: [
          () => Effect.andThen(Deferred.succeed(gate.entered, undefined), Deferred.await(gate.release)),
          assign<Counter, EventObject>(({ context }) => ({ blocked: true, order: [...context.order, "block"] })),
        ],
      },
    },
  })

// ---------------------------------------------------------------- P0-004 fixtures

/** The entry and exit actions of node `key`, each logged and named `enter <key>` / `exit <key>`. */
const traced = (key: string, log: Array<string>) => ({ entry: named(`enter ${key}`, log), exit: named(`exit ${key}`, log) })

/**
 * A parallel root `td` with two regions: `A`, itself parallel (regions `A1`: a1/a2 and `A2`:
 * x/y), and `B` (b1/b2). Document order: td, A, A1, a1, a2, A2, x, y, B, b1, b2. CROSS goes from
 * a1 to y (domain A, the nested parallel state); OUT goes from b1 to a2 (domain td).
 */
const nestedParallel = (log: Array<string>) =>
  createMachine({
    id: "td",
    type: "parallel",
    ...traced("td", log),
    states: {
      A: {
        type: "parallel",
        ...traced("A", log),
        states: {
          A1: {
            initial: "a1",
            tags: ["A1"],
            ...traced("A1", log),
            states: {
              a1: { ...traced("a1", log), on: { CROSS: { target: "#td.A.A2.y", actions: named("cross", log) } } },
              a2: traced("a2", log),
            },
          },
          A2: {
            initial: "x",
            ...traced("A2", log),
            states: { x: traced("x", log), y: { ...traced("y", log), tags: ["y"] } },
          },
        },
      },
      B: {
        initial: "b1",
        ...traced("B", log),
        states: {
          b1: { ...traced("b1", log), tags: ["b1"], on: { OUT: { target: "#td.A.A1.a2", actions: named("out", log) } } },
          b2: traced("b2", log),
        },
      },
    },
  })

// ---------------------------------------------------------------- P0-005 fixtures

/** A seeded pseudo-random source (mulberry32): the same seed gives the same sequence in [0, 1). */
const seeded = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = state
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

/** A whole number in [0, bound). */
const below = (random: () => number, bound: number): number => Math.floor(random() * bound)

/** One item of a non-empty list, chosen by `random`. */
const pick = <A>(random: () => number, items: readonly [A, ...ReadonlyArray<A>]): A => {
  const index = below(random, items.length)
  return items.reduce<A>((chosen, item, position) => (position === index ? item : chosen), items[0])
}

/** The items in an order chosen by `random` (each takes a random sort key). */
const shuffled = <A>(random: () => number, items: ReadonlyArray<A>): ReadonlyArray<A> =>
  items
    .map((item) => ({ item, key: random() }))
    .sort((left, right) => left.key - right.key)
    .map(({ item }) => item)

/** A JSON leaf value of a generated context. */
type Leaf = string | number | boolean | null

/** The shape of a generated context value: JSON leaves, actor references and nesting. */
type Template =
  | { readonly kind: "leaf"; readonly value: Leaf }
  | { readonly kind: "ref"; readonly child: number }
  | { readonly kind: "list"; readonly items: ReadonlyArray<Template> }
  | { readonly kind: "record"; readonly entries: ReadonlyArray<readonly [string, Template]> }

const LEAVES: readonly [Leaf, ...ReadonlyArray<Leaf>] = [0, 1, -42, 3.5, 1e21, Number.MAX_SAFE_INTEGER, "", "plain", 'with "quotes"', "line\nbreak", "ünïcödé", "😀", true, false, null]
const KEYS: readonly [string, ...ReadonlyArray<string>] = ["alpha", "b", "with space", "ünï", 'quote"d', "back\\slash", "0", "17", "nested.dot", "😀"]

/** A generated value: a record at the top, then lists, records, leaves and references, at most four levels deep. */
const generateTemplate = (random: () => number, depth: number, children: number): Template => {
  const roll = random()
  if (depth > 0 && (depth >= 3 || roll < 0.4)) {
    return children > 0 && random() < 0.35 ? { kind: "ref", child: below(random, children) } : { kind: "leaf", value: pick(random, LEAVES) }
  }
  const size = below(random, 4)
  if (depth > 0 && roll < 0.7) {
    return { kind: "list", items: Array.from({ length: size }, () => generateTemplate(random, depth + 1, children)) }
  }
  const keys = shuffled(random, KEYS).slice(0, depth === 0 ? size + 1 : size)
  return { kind: "record", entries: keys.map((key) => [key, generateTemplate(random, depth + 1, children)] as const) }
}

/** The value a template gives with `refs[i]` for each reference to child i. */
const materialise = (template: Template, refs: ReadonlyArray<unknown>): unknown => {
  switch (template.kind) {
    case "leaf":
      return template.value
    case "ref":
      return refs[template.child]
    case "list":
      return template.items.map((item) => materialise(item, refs))
    case "record":
      return Object.fromEntries(template.entries.map(([key, item]) => [key, materialise(item, refs)]))
  }
}

/** Asserts that `actual` has the template's shape; `checkRef` checks the value at each reference to child i. */
const assertShape = (
  actual: unknown,
  template: Template,
  checkRef: (value: unknown, child: number, path: string) => void,
  path: string
): void => {
  switch (template.kind) {
    case "leaf":
      assert.strictEqual(actual, template.value, path)
      return
    case "ref":
      checkRef(actual, template.child, path)
      return
    case "list": {
      if (!Array.isArray(actual)) {
        return assert.fail(`${path} is not a list`)
      }
      const items: ReadonlyArray<unknown> = actual
      assert.strictEqual(items.length, template.items.length, path)
      template.items.forEach((item, index) => assertShape(items[index], item, checkRef, `${path}[${index}]`))
      return
    }
    case "record": {
      const own = recordOf(actual)
      assert.deepStrictEqual(Object.keys(own).sort(), template.entries.map(([key]) => key).sort(), path)
      template.entries.forEach(([key, item]) => assertShape(own[key], item, checkRef, `${path}.${key}`))
      return
    }
  }
}

/** One generated child: its id, its logic and, maybe, a systemId. */
interface PlannedChild {
  readonly id: string
  readonly src: "bumper" | "stepper"
  readonly systemId: string | undefined
}

/** The events a generated script sends. */
type GenEvent =
  | { readonly type: "SWITCH" }
  | { readonly type: "POWER" }
  | { readonly type: "DEEP" }
  | { readonly type: "INC" }
  | { readonly type: "BUMP" }
  | { readonly type: "FINISH" }
  | { readonly type: "DROP" }
  | { readonly type: "BREAK" }

/** The ids the generated children take, in order: odd characters included. */
const CHILD_IDS: ReadonlyArray<string> = ["c0", "c.1", "c 2"]

const SCRIPT_EVENTS: readonly [GenEvent["type"], ...ReadonlyArray<GenEvent["type"]>] = ["SWITCH", "SWITCH", "POWER", "POWER", "DEEP", "INC", "BUMP", "BUMP", "BUMP", "FINISH", "DROP", "BREAK"]

/** What one seed generates: the children, the context shape and the event script. */
interface Plan {
  readonly seed: number
  readonly children: ReadonlyArray<PlannedChild>
  readonly tree: Template
  readonly script: ReadonlyArray<GenEvent>
}

const generatePlan = (seed: number): Plan => {
  const random = seeded(seed)
  const children = Array.from({ length: 1 + below(random, 3) }, (_, index): PlannedChild => ({
    id: CHILD_IDS[index] ?? `c${index}`,
    src: random() < 0.5 ? "bumper" : "stepper",
    systemId: random() < 0.5 ? `sys-${seed}-${index}` : undefined,
  }))
  const tree = generateTemplate(random, 0, children.length)
  const script = Array.from({ length: below(random, 9) }, () => ({ type: pick(random, SCRIPT_EVENTS) }))
  return { seed, children, tree, script }
}

interface GenContext {
  readonly count: number
  readonly tree: unknown
}

/** A child that counts the BUMP events it takes. */
const bumper = fromTransition((state: { readonly bumps: number }, event: EventObject) => (event.type === "BUMP" ? { bumps: state.bumps + 1 } : state), {
  bumps: 0,
})

/** A child machine that counts BUMP and is done after the second, with the count as its output. */
const stepper = createMachine<{ readonly bumps: number }, EventObject>({
  id: "td1-stepper",
  context: { bumps: 0 },
  initial: "counting",
  states: {
    counting: {
      on: { BUMP: { actions: assign<{ readonly bumps: number }, EventObject>(({ context }) => ({ bumps: context.bumps + 1 })) } },
      always: { guard: ({ context }) => context.bumps >= 2, target: "finished" },
    },
    finished: { type: "final" },
  },
  output: ({ context }: { readonly context: { readonly bumps: number } }) => ({ bumps: context.bumps }),
})

/**
 * The machine of one plan: the root entry spawns the planned children and builds the context
 * from the plan's shape; `on` (tags powered, switched, loud) has a shallow and a deep history
 * state; `off` (tag dark) goes back through either, or to the final state `done`, whose output
 * is the count.
 */
const generatedMachine = (plan: Plan) =>
  createMachine<GenContext, GenEvent>(
    {
      id: "gen",
      context: { count: 0, tree: null },
      entry: assign<GenContext, GenEvent>(({ spawn }) => ({
        tree: materialise(
          plan.tree,
          plan.children.map((child) => spawn(child.src, { id: child.id, systemId: child.systemId }))
        ),
      })),
      on: {
        INC: { actions: assign<GenContext, GenEvent>(({ context }) => ({ count: context.count + 1 })) },
        // Every child but the last, which DROP stops while the context keeps its references
        BUMP: { actions: plan.children.slice(0, -1).map((child) => sendTo<GenContext, GenEvent>(child.id, { type: "BUMP" })) },
        DROP: { actions: stopChild<GenContext, GenEvent>(plan.children.map((child) => child.id).reverse()[0] ?? "none") },
        // A send to no child errors the machine (upstream `sendTo` throws `Unable to send event …`)
        BREAK: { actions: sendTo<GenContext, GenEvent>("missing", { type: "BUMP" }) },
      },
      initial: "on",
      states: {
        on: {
          initial: "first",
          tags: ["powered"],
          states: {
            first: { on: { SWITCH: "second" } },
            second: {
              tags: ["switched"],
              initial: "low",
              states: { low: { on: { SWITCH: "high" } }, high: { tags: ["loud"] } },
            },
            shallow: { type: "history" },
            deep: { type: "history", history: "deep" },
          },
          on: { POWER: "off" },
        },
        off: { tags: ["dark"], on: { POWER: "on.shallow", DEEP: "on.deep", FINISH: "done" } },
        done: { type: "final" },
      },
      output: ({ context }: { readonly context: GenContext }) => ({ count: context.count }),
    },
    { actors: { bumper, stepper } }
  )

/**
 * The persisted context after upstream's restore and a new persist: `reviveContext` turns each
 * marker whose id names no persisted child into `undefined`, which JSON then drops (a record
 * key) or writes as `null` (a list item). Every other value stays as it is.
 */
const withoutDanglingMarkers = (value: unknown, childIds: ReadonlyArray<string>): unknown => {
  if (Array.isArray(value)) {
    const items: ReadonlyArray<unknown> = value
    return items.map((item) => withoutDanglingMarkers(item, childIds))
  }
  if (!Predicate.isObject(value)) {
    return value
  }
  if (Predicate.hasProperty(value, "xstate$$type") && value.xstate$$type === 1 && Predicate.hasProperty(value, "id")) {
    return childIds.includes(String(value.id)) ? value : undefined
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withoutDanglingMarkers(item, childIds)]))
}

/** The history value as state-node ids per history node. */
const historyIds = (history: Readonly<Record<string, ReadonlyArray<{ readonly id: string }>>>) =>
  Object.fromEntries(Object.entries(history).map(([id, nodes]) => [id, idsOf(nodes)]))

/** What the seeds reached, so the test can show that it covers every feature it names. */
interface Reached {
  errored: number
  dropped: number
  done: number
  history: number
  deepHistory: number
  systemIds: number
  nested: number
  doneChildren: number
}

/**
 * The round trip of one seed: the plan's script runs on an actor, whose persisted snapshot goes
 * through JSON and restores; the restored actor matches the live one, persists the same JSON,
 * and still does after it starts.
 */
const roundTrip = (seed: number, reached: Reached) =>
  Effect.gen(function* () {
    const plan = generatePlan(seed)
    const where = `seed ${seed}`
    const machine = generatedMachine(plan)

    const original = yield* createActor(machine)
    yield* original.start
    let dropped = false
    for (const event of plan.script) {
      if ((yield* original.getSnapshot).status === "active") {
        yield* original.send(event)
        dropped ||= event.type === "DROP"
      }
    }
    yield* settle
    const live = yield* original.getSnapshot
    const persisted = throughJson(yield* original.getPersistedSnapshot)
    const persistedFields = recordOf(persisted)

    const restored = yield* createActor(machine, { snapshot: persisted })
    const back = yield* restored.getSnapshot

    // The persisted form survives the round trip unchanged, but for a reference to a child that
    // was stopped: its marker revives to undefined, as upstream's `reviveContext` gives
    const persistedChildren = recordOf(persistedFields["children"])
    const again = throughJson({ ...persistedFields, context: withoutDanglingMarkers(persistedFields["context"], Object.keys(persistedChildren)) })
    assert.deepStrictEqual(throughJson(yield* restored.getPersistedSnapshot), again, where)

    // The restored snapshot has the live snapshot's fields
    assert.strictEqual(back.status, live.status, where)
    assert.deepStrictEqual(back.value, live.value, where)
    assert.strictEqual(back.context.count, live.context.count, where)
    assert.deepStrictEqual([...back.tags].sort(), [...live.tags].sort(), where)
    assert.deepStrictEqual(historyIds(back.historyValue), historyIds(live.historyValue), where)

    // Option fields: the output is Some for a done machine and the error Some for an errored
    // one (the value as persisted), each None otherwise, with no key in the JSON; a child's
    // systemId is a key only when it has one
    assert.deepStrictEqual(back.output, live.status === "done" ? Option.some({ count: live.context.count }) : Option.none(), where)
    assert.deepStrictEqual(back.error, live.status === "error" ? Option.some(persistedFields["error"]) : Option.none(), where)
    assert.strictEqual(Object.hasOwn(persistedFields, "output"), live.status === "done", where)
    assert.strictEqual(Object.hasOwn(persistedFields, "error"), live.status === "error", where)
    if (live.status === "error") {
      reached.errored++
      assert.strictEqual(recordOf(persistedFields["error"])["message"], "Unable to send event to actor 'missing' from machine 'gen'.", where)
    }

    // The children, each restored with its snapshot and its systemId. A done machine keeps
    // its stopped children in `children`, as upstream's macrostep drops the result of its
    // `stopChildren`, so their references persist and revive too
    const liveChildren = childrenOf(live)
    const backChildren = childrenOf(back)
    const lastId = plan.children.map((child) => child.id).reverse()[0]
    const kept = plan.children.filter((child) => !(dropped && child.id === lastId))
    assert.deepStrictEqual(Object.keys(liveChildren), kept.map((child) => child.id), where)
    assert.deepStrictEqual(Object.keys(backChildren), Object.keys(liveChildren), where)
    for (const child of kept) {
      const at = `${where} ${child.id}`
      const restoredChild = childOf(back, child.id)
      const liveChild = yield* childOf(live, child.id).getSnapshotUntyped
      const backChild = yield* restoredChild.getSnapshotUntyped
      // The child's own Option fields: a done stepper has Some output
      assert.deepStrictEqual(
        { status: backChild.status, output: backChild.output, error: backChild.error },
        { status: liveChild.status, output: liveChild.output, error: liveChild.error },
        at
      )
      assert.deepStrictEqual(throughJson(yield* restoredChild.getPersistedSnapshot), throughJson(yield* childOf(live, child.id).getPersistedSnapshot), at)
      assert.strictEqual(Object.hasOwn(recordOf(persistedChildren[child.id]), "systemId"), child.systemId !== undefined, at)
      if (child.systemId !== undefined) {
        reached.systemIds++
        // Registered under it while active (upstream constructor: `_set`, then `_unregister` when not active)
        assert.strictEqual(
          Option.getOrUndefined(yield* restored.system.get(child.systemId)),
          backChild.status === "active" ? restoredChild : undefined,
          at
        )
      }
      reached.doneChildren += Option.isSome(liveChild.output) ? 1 : 0
    }

    // The context: every reference revives to the restored child of its id
    // (a reference to a stopped child, which `children` no longer holds, revives to undefined)
    const idOf = (index: number) => plan.children[index]?.id ?? assert.fail(`no child ${index}`)
    assertShape(back.context.tree, plan.tree, (value, index, path) => assert.strictEqual(value, backChildren[idOf(index)], path), `${where} context.tree`)
    // The live context holds the spawned references (also once a done machine stopped them)
    assertShape(
      live.context.tree,
      plan.tree,
      (value, index, path) => assert.isTrue(isActorRef(value) && value.id === idOf(index), path),
      `${where} live context.tree`
    )

    reached.done += live.status === "done" ? 1 : 0
    reached.dropped += dropped && JSON.stringify(plan.tree).includes(`"child":${plan.children.length - 1}`) ? 1 : 0
    reached.history += Object.keys(live.historyValue).length > 0 ? 1 : 0
    reached.deepHistory += Object.hasOwn(live.historyValue, "gen.on.deep") ? 1 : 0
    reached.nested += JSON.stringify(plan.tree).includes('"kind":"list"') ? 1 : 0
    yield* original.stop

    // The restored actor starts and still persists the same JSON
    yield* restored.start
    yield* settle
    assert.deepStrictEqual(throughJson(yield* restored.getPersistedSnapshot), again, `${where} after start`)
    yield* restored.stop
  })

/** The round trip of seeds 1 to 50. */
const roundTrips = (reached: Reached) => Effect.forEach(Array.from({ length: 50 }, (_, index) => index + 1), (seed) => roundTrip(seed, reached), { discard: true })

// ---------------------------------------------------------------- P0-006 fixtures

/** Counts PING, answers each with PONG, and completes after the third with its count as output. */
const pingWorker = createMachine<{ readonly pings: number }, EventObject>({
  id: "td1-worker",
  context: { pings: 0 },
  initial: "waiting",
  states: {
    waiting: {
      on: {
        PING: {
          actions: [
            assign<{ readonly pings: number }, EventObject>(({ context }) => ({ pings: context.pings + 1 })),
            sendParent<{ readonly pings: number }, EventObject>({ type: "PONG" }),
          ],
        },
      },
      always: { guard: ({ context }) => context.pings >= 3, target: "finished" },
    },
    finished: { type: "final" },
  },
  output: ({ context }: { readonly context: { readonly pings: number } }) => ({ pings: context.pings }),
})

/** Counts the INC events it takes. */
const incCounter = fromTransition((state: { readonly count: number }, event: EventObject) => (event.type === "INC" ? { count: state.count + 1 } : state), {
  count: 0,
})

interface Coordinator {
  readonly replies: number
  readonly completed: number
}

/**
 * A parallel root: region `work` invokes the worker in `busy` (PING forwards to it; its done
 * event moves to `idle`, RESUME invokes it again); region `side` spawns the counter on entry
 * (PING forwards INC to it) and FLIPs between `left` and `right`; `right` goes back to `left`
 * after one second.
 */
const coordinator = createMachine<Coordinator, EventObject>(
  {
    id: "td1-parallel",
    type: "parallel",
    context: { replies: 0, completed: 0 },
    on: { PONG: { actions: assign<Coordinator, EventObject>(({ context }) => ({ replies: context.replies + 1 })) } },
    states: {
      work: {
        initial: "busy",
        states: {
          busy: {
            tags: ["busy"],
            invoke: {
              src: "worker",
              id: "worker",
              onDone: { target: "idle", actions: assign<Coordinator, EventObject>(({ context }) => ({ completed: context.completed + 1 })) },
            },
            on: { PING: { actions: sendTo<Coordinator, EventObject>("worker", { type: "PING" }) } },
          },
          idle: { on: { RESUME: "busy" } },
        },
      },
      side: {
        initial: "left",
        entry: spawnChild("counter", { id: "counter" }),
        on: { PING: { actions: sendTo<Coordinator, EventObject>("counter", { type: "INC" }) } },
        states: { left: { on: { FLIP: "right" } }, right: { tags: ["right"], on: { FLIP: "left" }, after: { 1000: "left" } } },
      },
    },
  },
  { actors: { worker: pingWorker, counter: incCounter } }
)

// ---------------------------------------------------------------- the scenarios

describe("TD-1 the P0 scenarios of the test design", () => {
  it.effect("[TD-1] P0-001: a callback cleanup and an effect finalizer that send while the scope closes are dropped without a warning, as a stop drops them, no exit action runs, each finalizer runs once and the close completes", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const callback = fromCallback(({ sendBack }) => () => {
        log.push("callback cleanup")
        sendBack({ type: "LATE_CALLBACK" })
      })
      const effect = fromEffect(({ self }) =>
        Effect.never.pipe(
          Effect.ensuring(
            Effect.andThen(
              Effect.sync(() => log.push("effect finalizer")),
              Option.match(self._parent, { onNone: () => Effect.void, onSome: (parent) => parent.send({ type: "LATE_EFFECT" }) })
            )
          )
        )
      )
      const machine = createMachine<Heard, EventObject>(
        {
          id: "td1-p0-001",
          context: { heard: [] },
          initial: "running",
          states: {
            running: {
              invoke: [
                { src: "callback", id: "callback" },
                { src: "effect", id: "effect" },
              ],
              exit: [named("exit running", log), sendTo<Heard, EventObject>("callback", { type: "FROM_EXIT" })],
            },
          },
          exit: named("exit root", log),
          on: { LATE_CALLBACK: { actions: hear }, LATE_EFFECT: { actions: hear }, FROM_EXIT: { actions: hear } },
        },
        { actors: { callback, effect } }
      )

      const { result, logged } = yield* withLogged(
        Effect.gen(function* () {
          const { actor, children } = yield* Effect.scoped(
            Effect.gen(function* () {
              const actor = yield* createActor(machine)
              yield* actor.start
              const snapshot = yield* actor.getSnapshot
              return { actor, children: [childOf(snapshot, "callback"), childOf(snapshot, "effect")] }
            })
          )
          // The scoped block returned: the close completed. Nothing is processed later
          yield* settle
          yield* TestClock.adjust("1 minute")
          yield* settle
          return {
            snapshot: yield* actor.getSnapshot,
            childStatuses: yield* Effect.forEach(children, statusOf),
          }
        })
      )

      assert.strictEqual(result.snapshot.status, "stopped")
      assert.deepStrictEqual(result.snapshot.context.heard, [])
      assert.deepStrictEqual(result.childStatuses, ["stopped", "stopped"])
      // Each finalizer ran once; no exit action ran, so the exit action's send was never made
      assert.deepStrictEqual([...log].sort(), ["callback cleanup", "effect finalizer"])
      // Each send came while the actor's lifetime closed, so it was dropped without a warning, as
      // a stop drops it (upstream queues it while the actor runs and `_stopProcedure` clears it),
      // whichever child sent it and whenever that child was created
      assert.deepStrictEqual(logged.warnings, [])
      assert.deepStrictEqual(logged.errors, [])
    })
  )

  it.effect("[TD-1] P0-002: interrupting fibers that wait in actor.send, directly or by a timeout, leaves the mailbox usable: the queued events and the next external send are processed in order", () =>
    Effect.gen(function* () {
      const { result, logged } = yield* withLogged(
        Effect.gen(function* () {
          const gate: Gate = { entered: yield* Deferred.make<void>(), release: yield* Deferred.make<void>() }
          const actor = yield* createActor(gatedCounter(gate))
          yield* actor.start

          // One send waits for its macrostep in progress, two wait behind it in the mailbox
          const blocking = yield* Effect.forkChild(actor.send({ type: "block" }))
          yield* Deferred.await(gate.entered)
          const queued = yield* Effect.forkChild(actor.send({ type: "increment" }))
          const timed = yield* Effect.forkChild(Effect.timeoutOption(actor.send({ type: "increment" }), "1 second"))
          yield* settle
          const waitingBefore = [blocking.pollUnsafe(), queued.pollUnsafe(), timed.pollUnsafe()].map((exit) => exit === undefined)

          // The timeout and the interrupts end the waits while the macrostep still waits
          yield* TestClock.adjust("1 second")
          const timedExit = yield* Fiber.await(timed)
          const blockingExit = yield* Fiber.interrupt(blocking).pipe(Effect.andThen(Fiber.await(blocking)))
          const queuedExit = yield* Fiber.interrupt(queued).pipe(Effect.andThen(Fiber.await(queued)))
          const whileBlocked = yield* actor.getSnapshot

          // The macrostep commits; the queued events follow it; the next send returns after its own
          yield* Deferred.succeed(gate.release, undefined)
          yield* actor.send({ type: "increment" })
          const afterNext = yield* actor.getSnapshot
          yield* actor.send({ type: "increment" })
          const afterAnother = yield* actor.getSnapshot
          yield* actor.stop
          return { waitingBefore, timedExit, blockingExit, queuedExit, whileBlocked, afterNext, afterAnother, final: yield* actor.getSnapshot }
        })
      )

      assert.deepStrictEqual(result.waitingBefore, [true, true, true])
      assert.isTrue(Exit.isSuccess(result.timedExit) && Option.isNone(result.timedExit.value), "the timeout ends the timed send with None")
      assert.isTrue(Exit.hasInterrupts(result.blockingExit), "the send of the macrostep in progress is interrupted")
      assert.isTrue(Exit.hasInterrupts(result.queuedExit), "the queued send is interrupted")
      assert.deepStrictEqual(result.whileBlocked.context, { count: 0, blocked: false, order: [] })
      // Every event a send queued is processed once, in mailbox order (upstream `send` enqueues)
      assert.deepStrictEqual(result.afterNext.context, { count: 3, blocked: true, order: ["block", "increment", "increment", "increment"] })
      assert.strictEqual(result.afterAnother.context.count, 4)
      assert.strictEqual(result.final.status, "stopped")
      assert.deepStrictEqual(logged.warnings, [])
      assert.deepStrictEqual(logged.errors, [])
    })
  )

  it.effect("[TD-1] P0-003: closing the caller scope stops a three-level tree of spawned and invoked children, each finalizer runs once, and a TestClock advance fires no timer", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const leafCallback = fromCallback<EventObject, string>(({ input }) => {
        log.push(`callback ${input} started`)
        return () => {
          log.push(`callback ${input} cleanup`)
        }
      })
      const leafEffect = fromEffect(({ input }: { readonly input: string }) =>
        Effect.andThen(
          Effect.sync(() => log.push(`effect ${input} started`)),
          Effect.sleep("4 seconds").pipe(
            Effect.andThen(Effect.sync(() => log.push(`effect ${input} timer`))),
            Effect.andThen(Effect.never),
            Effect.ensuring(Effect.sync(() => log.push(`effect ${input} finalizer`)))
          )
        )
      )
      const middle = createMachine(
        {
          id: "td1-middle",
          context: ({ input }: { readonly input: string }) => ({ name: input }),
          invoke: { src: "leafCallback", id: "leafInvoked", input: ({ context }: { readonly context: { readonly name: string } }) => context.name },
          entry: [
            spawnChild("leafEffect", { id: "leafSpawned", input: ({ context }: { readonly context: { readonly name: string } }) => context.name }),
            raise({ type: "MIDDLE_TICK" }, { delay: 3000 }),
            sendParent({ type: "MIDDLE_LATE" }, { delay: 2500 }),
          ],
          on: { MIDDLE_TICK: { actions: named("middle timer", log) } },
        },
        { actors: { leafCallback, leafEffect } }
      )
      const root = createMachine(
        {
          id: "td1-root",
          invoke: { src: "middle", id: "middleInvoked", input: "invoked" },
          entry: [spawnChild("middle", { id: "middleSpawned", input: "spawned" }), raise({ type: "ROOT_TICK" }, { delay: 5000 })],
          initial: "waiting",
          states: { waiting: { after: { 6000: "late" } }, late: { entry: named("root after", log) } },
          on: { ROOT_TICK: { actions: named("root timer", log) }, MIDDLE_LATE: { actions: named("middle late", log) } },
        },
        { actors: { middle } }
      )

      const { result, logged } = yield* withLogged(
        Effect.gen(function* () {
          const tree = yield* Effect.scoped(
            Effect.gen(function* () {
              const actor = yield* createActor(root)
              yield* actor.start
              yield* settle
              const snapshot = yield* actor.getSnapshot
              const middles = [childOf(snapshot, "middleInvoked"), childOf(snapshot, "middleSpawned")]
              const leaves = yield* Effect.forEach(middles, (ref) =>
                Effect.map(ref.getSnapshotUntyped, (middleSnapshot) => [childOf(middleSnapshot, "leafInvoked"), childOf(middleSnapshot, "leafSpawned")])
              )
              const actors: ReadonlyArray<ActorRefBase> = [actor, ...middles, ...leaves.flat()]
              const statusesBefore = yield* Effect.forEach(actors, statusOf)
              const pendingBefore = Object.keys(yield* actor.system.scheduler.scheduledEvents).length
              const logBefore = [...log]
              return { actor, actors, statusesBefore, pendingBefore, logBefore }
            })
          )
          const closedLog = [...log]
          const statusesAfter = yield* Effect.forEach(tree.actors, statusOf)
          const pendingAfter = Object.keys(yield* tree.actor.system.scheduler.scheduledEvents).length
          yield* TestClock.adjust("1 minute")
          yield* settle
          return { ...tree, closedLog, statusesAfter, pendingAfter, finalLog: [...log] }
        })
      )

      assert.deepStrictEqual(result.statusesBefore, Array.from({ length: 7 }, () => "active"))
      // Two delayed events of each middle and two of the root wait in the system's scheduler
      assert.strictEqual(result.pendingBefore, 6)
      assert.deepStrictEqual([...result.logBefore].sort(), [
        "callback invoked started",
        "callback spawned started",
        "effect invoked started",
        "effect spawned started",
      ])

      assert.deepStrictEqual(result.statusesAfter, Array.from({ length: 7 }, () => "stopped"))
      assert.strictEqual(result.pendingAfter, 0)
      const finalizers = result.closedLog.filter((entry) => entry.endsWith("cleanup") || entry.endsWith("finalizer"))
      assert.deepStrictEqual([...finalizers].sort(), [
        "callback invoked cleanup",
        "callback spawned cleanup",
        "effect invoked finalizer",
        "effect spawned finalizer",
      ])
      // No timer of any level fired, before or after the advance, and nothing ran again
      assert.deepStrictEqual(result.finalLog, result.closedLog)
      assert.deepStrictEqual(logged.warnings, [])
      assert.deepStrictEqual(logged.errors, [])
    })
  )

  it.effect("[TD-1] P0-004: getAllStateNodes, the exit and entry sets and pure getMicrosteps give upstream order for a parallel state nested in a parallel region", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = nestedParallel(log)
      const node = (id: string) => machine.getStateNodeById(id)

      // getAllStateNodes (upstream: a Set filled by the descendants pass, then the ancestors pass)
      assert.deepStrictEqual(idsOf(StateUtils.getAllStateNodes([yield* node("td.A")])), [
        "td.A",
        "td.A.A1",
        "td.A.A1.a1",
        "td.A.A2",
        "td.A.A2.x",
        "td",
      ])
      assert.deepStrictEqual(idsOf(StateUtils.getAllStateNodes([yield* node("td")])), [
        "td",
        "td.A",
        "td.A.A1",
        "td.A.A1.a1",
        "td.A.A2",
        "td.A.A2.x",
        "td.B",
        "td.B.b1",
      ])
      // A region's descendant and another region: the ancestors come last, so `A1` stays out
      assert.deepStrictEqual(idsOf(StateUtils.getAllStateNodes([yield* node("td.A.A2.y"), yield* node("td.B")])), [
        "td.A.A2.y",
        "td.B",
        "td.B.b1",
        "td.A.A2",
        "td.A",
        "td",
      ])

      // The exit and entry sets of the pure microstep plan
      const initial = Result.getOrThrow(StateUtils.initialMicrostep(machine.root))
      const initialIds = ["td", "td.A", "td.A.A1", "td.A.A1.a1", "td.A.A2", "td.A.A2.x", "td.B", "td.B.b1"]
      assert.deepStrictEqual(idsOf(initial.configuration), initialIds)
      const plan = (source: string, target: string, label: string) =>
        Effect.gen(function* () {
          const step = Result.getOrThrow(
            StateUtils.microstep(
              [{ source: yield* node(source), target: [yield* node(target)], definition: Option.none(), reenter: false, actions: [named(label, [])] }],
              initial.configuration
            )
          )
          return { exited: idsOf(step.exited), entered: idsOf(step.entered), configuration: idsOf(step.configuration), actions: step.actions.map(actionName) }
        })
      const crossExits = ["exit x", "exit A2", "exit a1", "exit A1"]
      const crossEntries = ["enter A1", "enter a1", "enter A2", "enter y"]
      const crossNodes = ["td", "td.A", "td.B", "td.B.b1", "td.A.A1", "td.A.A1.a1", "td.A.A2", "td.A.A2.y"]
      assert.deepStrictEqual(yield* plan("td.A.A1.a1", "td.A.A2.y", "cross"), {
        exited: ["td.A.A2.x", "td.A.A2", "td.A.A1.a1", "td.A.A1"],
        entered: ["td.A.A1", "td.A.A1.a1", "td.A.A2", "td.A.A2.y"],
        configuration: crossNodes,
        actions: [...crossExits, "cross", ...crossEntries],
      })
      const outExits = ["exit b1", "exit B", "exit x", "exit A2", "exit a1", "exit A1", "exit A"]
      const outEntries = ["enter A", "enter A1", "enter a2", "enter A2", "enter x", "enter B", "enter b1"]
      const outNodes = ["td", "td.A", "td.A.A1", "td.A.A1.a2", "td.A.A2", "td.A.A2.x", "td.B", "td.B.b1"]
      assert.deepStrictEqual(yield* plan("td.B.b1", "td.A.A1.a2", "out"), {
        exited: ["td.B.b1", "td.B", "td.A.A2.x", "td.A.A2", "td.A.A1.a1", "td.A.A1", "td.A"],
        entered: ["td.A", "td.A.A1", "td.A.A1.a2", "td.A.A2", "td.A.A2.x", "td.B", "td.B.b1"],
        configuration: outNodes,
        actions: [...outExits, "out", ...outEntries],
      })

      // Pure getMicrosteps: the same order, the snapshot's node order, its value and its tags
      const snapshot = yield* getInitialSnapshot(machine)
      assert.deepStrictEqual(idsOf(snapshot._nodes), initialIds)
      assert.deepStrictEqual(Array.from(snapshot.tags), ["A1", "b1"])
      const microstepsOf = (type: string) =>
        Effect.map(getMicrosteps(machine, snapshot, { type }), (steps) =>
          steps.map(([next, actions]) => ({
            nodes: idsOf(next._nodes),
            value: JSON.stringify(next.value),
            tags: Array.from(next.tags),
            // A function action's type is its name; the type lists only the built-in ones
            actions: actions.map((action): string => action.type),
          }))
        )
      assert.deepStrictEqual(yield* microstepsOf("CROSS"), [
        { nodes: crossNodes, value: `{"A":{"A1":"a1","A2":"y"},"B":"b1"}`, tags: ["b1", "A1", "y"], actions: [...crossExits, "cross", ...crossEntries] },
      ])
      assert.deepStrictEqual(yield* microstepsOf("OUT"), [
        { nodes: outNodes, value: `{"A":{"A1":"a2","A2":"x"},"B":"b1"}`, tags: ["A1", "b1"], actions: [...outExits, "out", ...outEntries] },
      ])
      assert.deepStrictEqual(log, [], "the pure functions run no action")

      // An actor runs the same actions in the same order
      const actor = yield* createActor(machine)
      yield* actor.start
      assert.deepStrictEqual(log, ["enter td", "enter A", "enter A1", "enter a1", "enter A2", "enter x", "enter B", "enter b1"])
      log.length = 0
      yield* actor.send({ type: "CROSS" })
      assert.deepStrictEqual(log, [...crossExits, "cross", ...crossEntries])
      assert.deepStrictEqual(idsOf((yield* actor.getSnapshot)._nodes), crossNodes)
      const other = yield* createActor(machine)
      yield* other.start
      log.length = 0
      yield* other.send({ type: "OUT" })
      assert.deepStrictEqual(log, [...outExits, "out", ...outEntries])
      assert.deepStrictEqual(idsOf((yield* other.getSnapshot)._nodes), outNodes)
    })
  )

  it.effect("[TD-1] P0-005: over seeded generated contexts of nested lists and records of actor references, with Option fields, tags and history, a persisted snapshot round-trips through JSON", () =>
    Effect.gen(function* () {
      const reached = { errored: 0, dropped: 0, done: 0, history: 0, deepHistory: 0, systemIds: 0, nested: 0, doneChildren: 0 }
      const { logged } = yield* withLogged(roundTrips(reached))
      // The seeds reach every feature the scenario names
      assert.isAbove(reached.done, 0, "a done machine")
      assert.isAbove(reached.dropped, 0, "a reference to a stopped child")
      assert.isAbove(reached.errored, 0, "an errored machine")
      assert.isAbove(reached.history, 0, "a recorded history")
      assert.isAbove(reached.deepHistory, 0, "a deep history")
      assert.isAbove(reached.systemIds, 0, "a child with a systemId")
      assert.isAbove(reached.nested, 0, "a nested list")
      assert.isAbove(reached.doneChildren, 0, "a done child with Some output")
      // Each errored machine reports its error once (SD-21), and so does its restored actor at
      // start (upstream `start`, case 'error'), with the error as persisted; nothing else errs
      assert.strictEqual(logged.errors.filter((text) => text.includes("Unable to send event to actor 'missing'")).length, reached.errored)
      assert.strictEqual(logged.errors.length, 2 * reached.errored)
    }), 60_000)

  it.effect("[TD-1] P0-006: a parallel machine with an invoked and a spawned child, restored from JSON, has the original's snapshot and the original's behaviour for the same next events", () =>
    Effect.gen(function* () {
      const original = yield* createActor(coordinator)
      yield* original.start
      for (const type of ["PING", "FLIP", "PING"]) {
        yield* original.send({ type })
        yield* settle
      }
      const replies = (actor: typeof original) => Effect.map(actor.getSnapshot, (snapshot) => snapshot.context.replies)
      assert.isTrue(yield* eventually(Effect.map(replies(original), (count) => count === 2)), "the worker answered twice")
      // `right`'s delayed transition has 600 ms left when the snapshot is persisted
      yield* TestClock.adjust("400 millis")
      const persisted = throughJson(yield* original.getPersistedSnapshot)

      const restored = yield* createActor(coordinator, { snapshot: persisted })
      const sendBoth = (type: string) => Effect.forEach([original, restored], (actor) => actor.send({ type }), { discard: true })

      /** What two actors of the coordinator must share: their snapshots and their children's. */
      const sameAs = (actor: typeof original, label: string) =>
        Effect.gen(function* () {
          const mine = yield* actor.getSnapshot
          const theirs = yield* original.getSnapshot
          assert.strictEqual(mine.status, theirs.status, label)
          assert.deepStrictEqual(mine.value, theirs.value, label)
          assert.deepStrictEqual(mine.context, theirs.context, label)
          assert.deepStrictEqual([...mine.tags].sort(), [...theirs.tags].sort(), label)
          assert.deepStrictEqual(Object.keys(childrenOf(mine)).sort(), Object.keys(childrenOf(theirs)).sort(), label)
          for (const id of Object.keys(childrenOf(theirs))) {
            assert.deepStrictEqual(throughJson(yield* childOf(mine, id).getSnapshotUntyped), throughJson(yield* childOf(theirs, id).getSnapshotUntyped), `${label} ${id}`)
          }
          assert.deepStrictEqual(throughJson(yield* actor.getPersistedSnapshot), throughJson(yield* original.getPersistedSnapshot), label)
        })

      // The same snapshot, before and after the restored actor starts
      yield* sameAs(restored, "restored")
      assert.deepStrictEqual((yield* restored.getSnapshot).value, { work: "busy", side: "right" })
      yield* restored.start
      yield* settle
      yield* sameAs(restored, "started")

      // The same next behaviour: the third PING completes the worker, the pending delayed
      // transition fires at the same time in both, RESUME invokes a new worker, FLIP starts a
      // new delay
      const busy = { replies: 3, completed: 1 }
      const steps: ReadonlyArray<{
        readonly step: string
        readonly run: Effect.Effect<void>
        readonly value: unknown
        readonly context: Coordinator
        readonly children: ReadonlyArray<string>
      }> = [
        { step: "PING", run: sendBoth("PING"), value: { work: "idle", side: "right" }, context: busy, children: ["counter"] },
        { step: "599 ms", run: TestClock.adjust("599 millis"), value: { work: "idle", side: "right" }, context: busy, children: ["counter"] },
        { step: "600 ms", run: TestClock.adjust("1 millis"), value: { work: "idle", side: "left" }, context: busy, children: ["counter"] },
        { step: "RESUME", run: sendBoth("RESUME"), value: { work: "busy", side: "left" }, context: busy, children: ["counter", "worker"] },
        { step: "PING again", run: sendBoth("PING"), value: { work: "busy", side: "left" }, context: { replies: 4, completed: 1 }, children: ["counter", "worker"] },
        { step: "FLIP", run: sendBoth("FLIP"), value: { work: "busy", side: "right" }, context: { replies: 4, completed: 1 }, children: ["counter", "worker"] },
        { step: "1 s", run: TestClock.adjust("1 second"), value: { work: "busy", side: "left" }, context: { replies: 4, completed: 1 }, children: ["counter", "worker"] },
      ]
      for (const { step, run, value, context, children } of steps) {
        yield* run
        yield* settle
        for (const actor of [original, restored]) {
          const snapshot = yield* actor.getSnapshot
          assert.deepStrictEqual(snapshot.value, value, step)
          assert.deepStrictEqual(snapshot.context, context, step)
          assert.deepStrictEqual(Object.keys(childrenOf(snapshot)).sort(), children, step)
        }
        yield* sameAs(restored, `after ${step}`)
      }
      const counterOf = (actor: typeof original) => Effect.flatMap(actor.getSnapshot, (snapshot) => childOf(snapshot, "counter").getSnapshotUntyped)
      assert.deepStrictEqual(recordOf(yield* counterOf(restored))["context"], { count: 4 })
      assert.deepStrictEqual(recordOf(yield* counterOf(original))["context"], { count: 4 })
    })
  )
})
