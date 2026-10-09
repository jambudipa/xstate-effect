/**
 * S22: routable states accept `xstate.route` events.
 *
 * T3.21. Upstream `formatRouteTransitions` (`src/stateUtils.ts` at xstate@5.33.2) runs once,
 * after the root is initialized: for every descendant of the root, in document order, that
 * has both a `route` config and an explicit `id`, it formats a transition OF THE ROOT on
 * `xstate.route` from `{ ...route, guard, target: '#<id>' }`. The guard is
 * `({ event }) => event.to === '#<id>'`, or `and([thatCheck, route.guard])` when the route
 * has a guard of its own. So a route event `{ type: 'xstate.route', to: '#<id>' }` enters the
 * state from anywhere in the machine; a state without an id, the root itself and any `to`
 * that is not exactly `#<id>` (a dot path such as `#dashboard.overview`) route nowhere.
 *
 * The root is the source of every route transition, so the transition domain is the root
 * (upstream `getTransitionDomain`): routing to the current state exits and re-enters it,
 * routing to an ancestor of the current state re-enters it at its initial child, and in a
 * parallel root every region exits and the regions other than the target's re-enter at
 * their initial states (upstream `computeEntrySet` adds a parallel domain to the ancestors).
 *
 * The root's transitions are in its `on` record, as upstream, so the route transitions are
 * `machine.root.on['xstate.route']`.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { assign, createActor, createMachine, type EventObject, setup } from "../../src/index.js"

/** A route event to a state id, as upstream sends it. */
interface RouteEvent {
  readonly type: "xstate.route"
  readonly to: string
}

/** The events of the S22 machines: route events and a few plain ones. */
type S22Event = RouteEvent | { readonly type: "READY" } | { readonly type: "EDIT" } | { readonly type: "SETTINGS" }

const route = (to: string): RouteEvent => ({ type: "xstate.route", to })

const valueOf = (snapshot: object): unknown => ("value" in snapshot ? snapshot.value : undefined)

const statusOf = (snapshot: object): unknown => ("status" in snapshot ? snapshot.status : undefined)

/** The `to` of a route event, the empty string for any other event. */
const toOf = (event: EventObject): string => ("to" in event && typeof event.to === "string" ? event.to : "")

/**
 * `home` and `dashboard.overview` / `dashboard.settings` are routes; `plain` has an id but no
 * route config.
 */
const appMachine = (log: Array<string>) =>
  setup({ types: {} as { events: S22Event } }).createMachine({
    id: "s22-app",
    initial: "home",
    states: {
      home: { id: "home", route: {} },
      dashboard: {
        initial: "overview",
        states: {
          overview: { id: "overview", route: {} },
          settings: {
            id: "settings",
            route: { actions: ({ event }) => log.push(`settings action ${event.type} ${toOf(event)}`) },
          },
        },
      },
      plain: { id: "plain" },
    },
  })

describe("S22 Routable states accept xstate.route events", () => {
  // upstream: test/route.test.ts > route > should transition directly to a route if route is an empty transition config
  // upstream: test/route.test.ts > route > should route to deeply nested state from anywhere
  it.effect("[S22] route: {} on a state with an id is entered from anywhere by { type: 'xstate.route', to: '#id' }", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const actor = yield* Effect.tap(createActor(appMachine(log)), (a) => a.start)
      assert.strictEqual(valueOf(yield* actor.getSnapshot), "home")

      // Into a nested state from a sibling of its parent
      yield* actor.send(route("#overview"))
      assert.deepStrictEqual(valueOf(yield* actor.getSnapshot), { dashboard: "overview" })

      // Between siblings, with the route's own actions, which see the route event
      yield* actor.send(route("#settings"))
      assert.deepStrictEqual(valueOf(yield* actor.getSnapshot), { dashboard: "settings" })
      assert.deepStrictEqual(log, ["settings action xstate.route #settings"])

      // Out of the nested state, back to the top level
      yield* actor.send(route("#home"))
      assert.strictEqual(valueOf(yield* actor.getSnapshot), "home")
    })
  )

  it.effect("[S22] a state with an id and no route config, and an id that names no state, take no route event", () =>
    Effect.gen(function* () {
      const actor = yield* Effect.tap(createActor(appMachine([])), (a) => a.start)

      yield* actor.send(route("#plain"))
      yield* actor.send(route("#nowhere"))
      yield* actor.send({ type: "xstate.route", to: "plain" })

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(valueOf(snapshot), "home")
      assert.strictEqual(statusOf(snapshot), "active")

      // Positive control: the same actor still takes a route to a routable state
      yield* actor.send(route("#settings"))
      assert.deepStrictEqual(valueOf(yield* actor.getSnapshot), { dashboard: "settings" })
    })
  )

  // upstream: test/route.test.ts > route > should transition directly to a route if guard passes
  // upstream: test/route.test.ts > route > should resolve setup-registered string guards on route transitions
  it.effect("[S22] a guarded route is taken only when its guard passes, and a setup guard name resolves", () =>
    Effect.gen(function* () {
      const machine = setup({
        types: {} as { context: { readonly ready: boolean }; events: S22Event },
        guards: { isReady: ({ context }) => context.ready },
      }).createMachine({
        id: "s22-flow",
        initial: "amount",
        context: { ready: false },
        states: {
          amount: { id: "amount", route: {}, on: { READY: { actions: assign({ ready: true }) } } },
          review: { id: "review", route: { guard: "isReady" } },
          closed: { id: "closed", route: { guard: () => false } },
        },
      })
      const actor = yield* Effect.tap(createActor(machine), (a) => a.start)

      yield* actor.send(route("#review"))
      yield* actor.send(route("#closed"))
      assert.strictEqual(valueOf(yield* actor.getSnapshot), "amount")

      yield* actor.send({ type: "READY" })
      yield* actor.send(route("#review"))
      assert.strictEqual(valueOf(yield* actor.getSnapshot), "review")

      // A guard that fails keeps the actor where it is; an unguarded route still works
      yield* actor.send(route("#closed"))
      assert.strictEqual(valueOf(yield* actor.getSnapshot), "review")
      yield* actor.send(route("#amount"))
      assert.strictEqual(valueOf(yield* actor.getSnapshot), "amount")
    })
  )

  // upstream: test/route.test.ts > route > should work with parallel states
  it.effect("[S22] a route inside a parallel state changes its region, and the other regions re-enter at their initial states", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = setup({ types: {} as { events: S22Event } }).createMachine({
        id: "s22-todos",
        type: "parallel",
        states: {
          todo: {
            initial: "new",
            states: {
              new: { entry: () => log.push("enter todo.new"), on: { EDIT: "editing" } },
              editing: { exit: () => log.push("exit todo.editing") },
            },
          },
          filter: {
            initial: "all",
            states: {
              all: { id: "filter-all", route: {} },
              active: { id: "filter-active", route: {} },
              completed: { id: "filter-completed", route: {} },
            },
          },
        },
      })
      const actor = yield* Effect.tap(createActor(machine), (a) => a.start)
      assert.deepStrictEqual(valueOf(yield* actor.getSnapshot), { todo: "new", filter: "all" })

      yield* actor.send(route("#filter-active"))
      assert.deepStrictEqual(valueOf(yield* actor.getSnapshot), { todo: "new", filter: "active" })

      // The root is the source, so the todo region exits and re-enters at its initial state
      yield* actor.send({ type: "EDIT" })
      assert.deepStrictEqual(valueOf(yield* actor.getSnapshot), { todo: "editing", filter: "active" })
      log.length = 0
      yield* actor.send(route("#filter-completed"))
      assert.deepStrictEqual(valueOf(yield* actor.getSnapshot), { todo: "new", filter: "completed" })
      assert.deepStrictEqual(log, ["exit todo.editing", "enter todo.new"])
    })
  )

  // upstream: test/route.test.ts > route > should re-enter when routing to the current state
  it.effect("[S22] routing to the current state exits and re-enters it, and routing to an ancestor re-enters it at its initial child", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = setup({ types: {} as { events: S22Event } }).createMachine({
        id: "s22-reenter",
        initial: "a",
        states: {
          a: { id: "a", route: {}, entry: () => log.push("enter a"), exit: () => log.push("exit a") },
          dashboard: {
            id: "dashboard",
            route: {},
            initial: "overview",
            entry: () => log.push("enter dashboard"),
            exit: () => log.push("exit dashboard"),
            states: {
              overview: { entry: () => log.push("enter overview") },
              settings: { id: "settings", route: {}, exit: () => log.push("exit settings") },
            },
          },
        },
      })
      const actor = yield* Effect.tap(createActor(machine), (a) => a.start)
      log.length = 0

      yield* actor.send(route("#a"))
      assert.strictEqual(valueOf(yield* actor.getSnapshot), "a")
      assert.deepStrictEqual(log, ["exit a", "enter a"])

      yield* actor.send(route("#settings"))
      log.length = 0
      yield* actor.send(route("#dashboard"))
      assert.deepStrictEqual(valueOf(yield* actor.getSnapshot), { dashboard: "overview" })
      assert.deepStrictEqual(log, ["exit settings", "exit dashboard", "enter dashboard", "enter overview"])
    })
  )

  // upstream: test/route.test.ts > route > should route to self with guard
  it.effect("[S22] a self route with a guard re-enters the state only when the guard passes", () =>
    Effect.gen(function* () {
      let allowed = false
      let entries = 0
      const machine = setup({ types: {} as { events: S22Event } }).createMachine({
        id: "s22-self",
        initial: "a",
        states: {
          a: {
            id: "a",
            route: { guard: () => allowed },
            entry: () => {
              entries++
            },
          },
          b: { id: "b", route: {} },
        },
      })
      const actor = yield* Effect.tap(createActor(machine), (a) => a.start)
      entries = 0

      yield* actor.send(route("#a"))
      assert.strictEqual(entries, 0)

      allowed = true
      yield* actor.send(route("#a"))
      assert.strictEqual(entries, 1)
      assert.strictEqual(valueOf(yield* actor.getSnapshot), "a")
    })
  )

  // upstream: test/route.test.ts > route > route config without id should not generate route events
  // upstream: test/route.test.ts > route > should not route using dot-separated nested id like #id.nested
  it.effect("[S22] route config without an explicit id, a dot-path id and the root are not routable", () =>
    Effect.gen(function* () {
      const machine = setup({ types: {} as { events: S22Event } }).createMachine({
        id: "s22-root",
        route: {},
        initial: "a",
        states: {
          a: { route: {} },
          b: { id: "b", route: {} },
          dashboard: {
            id: "dashboard",
            initial: "overview",
            route: {},
            states: { overview: { id: "overview", route: {} } },
          },
        },
      })
      const actor = yield* Effect.tap(createActor(machine), (a) => a.start)

      // `a` has the id `s22-root.a`, but no explicit id, so it is no route target
      yield* actor.send(route("#s22-root.a"))
      yield* actor.send(route("#a"))
      yield* actor.send(route("#dashboard.overview"))
      yield* actor.send(route("#s22-root"))
      yield* actor.send({ type: "xstate.route" } as unknown as RouteEvent)
      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(valueOf(snapshot), "a")
      assert.strictEqual(statusOf(snapshot), "active")

      // The explicit ids route
      yield* actor.send(route("#b"))
      assert.strictEqual(valueOf(yield* actor.getSnapshot), "b")

      // Only the descendants with an explicit id have a route transition
      const routes = machine.root.on["xstate.route"] ?? []
      assert.deepStrictEqual(
        routes.map((transition) => transition.target?.map((node) => node.id)),
        [["b"], ["dashboard"], ["overview"]]
      )
    })
  )

  // upstream: test/route.test.ts > route > machine.root.on should include route events
  // upstream: test/route.test.ts > route > nested state on should include route events for child routes
  it.effect("[S22] the route transitions are the root's transitions on xstate.route, in document order, with the route meta", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "s22-data",
        initial: "home",
        states: {
          home: { id: "home", route: { description: "Home", meta: { title: "Home" } } },
          dashboard: {
            id: "dashboard",
            initial: "overview",
            route: { guard: () => true },
            states: { overview: { id: "overview", route: {} } },
          },
        },
      })

      const routes = machine.root.on["xstate.route"] ?? []
      assert.deepStrictEqual(
        routes.map((transition) => ({
          source: transition.source,
          eventType: transition.eventType,
          target: transition.target?.map((node) => node.id),
          reenter: transition.reenter,
          guarded: Option.isSome(transition.guard),
          description: transition.description,
          meta: transition.meta,
        })),
        [
          {
            source: "s22-data",
            eventType: "xstate.route",
            target: ["home"],
            reenter: false,
            guarded: true,
            description: "Home",
            meta: { title: "Home" },
          },
          {
            source: "s22-data",
            eventType: "xstate.route",
            target: ["dashboard"],
            reenter: false,
            guarded: true,
            description: undefined,
            meta: undefined,
          },
          {
            source: "s22-data",
            eventType: "xstate.route",
            target: ["overview"],
            reenter: false,
            guarded: true,
            description: undefined,
            meta: undefined,
          },
        ]
      )
      // A nested route is not a transition of its parent
      const dashboard = machine.root.states["dashboard"]
      assert.isTrue(dashboard !== undefined && dashboard.on["xstate.route"] === undefined)
      // A machine with no route has no route transitions
      const plain = createMachine({ id: "s22-plain", initial: "a", states: { a: { id: "a" } } })
      assert.isUndefined(plain.root.on["xstate.route"])
    })
  )
})
