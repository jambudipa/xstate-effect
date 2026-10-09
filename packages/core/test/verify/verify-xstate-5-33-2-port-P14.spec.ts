/**
 * P14: the dev entry point registers actors with dev tools.
 *
 * T7.13. Upstream `src/dev/index.ts` at xstate@5.33.2 exports `getGlobal` (the global
 * object; with none it warns), `registerService` and `devToolsAdapter` (both register a
 * service with a truthy global hook `__xstate__` by calling its `register`, and only when
 * `window` exists) and the `XStateDevInterface` type of that hook. Upstream `createActor`
 * (`src/createActor.ts`, `start` and `attachDevTools`) calls the `devTools` option's adapter
 * with the actor in `start`, after `update` and before `mailbox.start`: `devToolsAdapter` for
 * `true`, the option itself for a function, and nothing without the option or with `false`.
 * It also calls it for an actor that an initial action errored in `update`, and never for an
 * actor that is done or errored before `update`. What the hook or the adapter throws leaves
 * `start`, and the mailbox never starts.
 *
 * In the port the three functions return Effects, `getGlobal` gives an `Option`, a custom
 * adapter returns an Effect (as the `inspect` option's function does), the hook's throw (or a
 * hook without a `register` function) fails `registerService` and `devToolsAdapter` with
 * `DevToolsError`, and what the adapter fails or dies with leaves `start` as a defect, before
 * the actor processes any event (ledger DEV-52, DEV-53). The lookup behind `getGlobal` takes
 * its candidates as an argument, so a test reaches the no-global warning.
 */
import { assert, describe, it } from "@effect/vitest"
import { Cause, Effect, Exit, Logger, Option } from "effect"
import { DevToolsError, devToolsAdapter, getGlobal, registerService, type XStateDevInterface } from "../../src/dev/index.js"
import { type AnyActor, createActor, createMachine, spawnChild } from "../../src/index.js"
import { firstGlobalObject } from "../../src/internal/globalObject.js"
import { noGlobalObject } from "./upstream-messages.js"

/** `idle -GO-> busy`. */
const machine = createMachine({
  id: "p14",
  initial: "idle",
  context: {},
  states: { idle: { on: { GO: "busy" } }, busy: {} },
})

/** Sets `globalThis[key]` to `value` for the test's scope, then puts back what was there. */
const withGlobal = (key: string, value: unknown) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const had = Object.hasOwn(globalThis, key)
      const previous: unknown = Reflect.get(globalThis, key)
      Reflect.set(globalThis, key, value)
      return { had, previous }
    }),
    ({ had, previous }) =>
      Effect.sync(() => {
        if (had) {
          Reflect.set(globalThis, key, previous)
        } else {
          Reflect.deleteProperty(globalThis, key)
        }
      })
  )

/** A dev tools hook that keeps every service it registers, in order, and tells its listeners. */
const makeHook = () => {
  const registered: Array<AnyActor> = []
  const listeners = new Set<(service: AnyActor) => void>()
  const hook: XStateDevInterface = {
    services: new Set(),
    register: (service) => {
      registered.push(service)
      hook.services.add(service)
      listeners.forEach((listener) => listener(service))
    },
    unregister: (service) => {
      hook.services.delete(service)
    },
    onRegister: (listener) => {
      listeners.add(listener)
      return { unsubscribe: () => listeners.delete(listener) }
    },
  }
  return { hook, registered }
}

/** A browser-like global: `window` and the hook `__xstate__`, for the test's scope. */
const installHook = (hook: unknown) =>
  Effect.gen(function* () {
    yield* withGlobal("window", globalThis)
    yield* withGlobal("__xstate__", hook)
  })

/** Runs `program` with a logger that keeps the messages of each entry logged at `level`. */
const withLogged = <A, E, R>(level: "Warn" | "Error", logged: Array<unknown>, program: Effect.Effect<A, E, R>) =>
  program.pipe(
    Effect.provide(
      Logger.layer([
        Logger.make((options) => {
          if (options.logLevel === level) {
            logged.push(...(Array.isArray(options.message) ? options.message : [options.message]))
          }
        }),
      ])
    )
  )

/** Lets every other ready fiber take a bounded number of turns, so a subscriber's fiber runs. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 25; turn++) {
    yield* Effect.yieldNow
  }
})

/** The defect that `start` died with; fails the test when `start` succeeded or failed. */
const defectOfStart = (actor: Pick<AnyActor, "start">) =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(actor.start)
    assert.isTrue(Exit.isFailure(exit), "start does not succeed")
    if (Exit.isSuccess(exit)) {
      return undefined
    }
    assert.isTrue(Cause.hasDies(exit.cause) && !Cause.hasFails(exit.cause), "start dies")
    return Cause.squash(exit.cause)
  })

describe("P14 The dev entry point registers actors with dev tools", () => {
  it.effect("[P14] with a global dev tools hook, an actor created with devTools: true registers itself through devToolsAdapter when it starts, once", () =>
    Effect.gen(function* () {
      const { hook, registered } = makeHook()
      yield* installHook(hook)

      const actor = yield* createActor(machine, { devTools: true })
      // Upstream attaches the dev tools in `start`, not at creation
      assert.strictEqual(registered.length, 0)

      yield* actor.start
      assert.strictEqual(registered.length, 1)
      assert.strictEqual(registered[0], actor)
      assert.isTrue(hook.services.has(actor))

      // A second start does nothing, so the actor is not registered again
      yield* actor.start
      assert.strictEqual(registered.length, 1)

      // The registered actor still processes its events
      yield* actor.send({ type: "GO" })
      assert.strictEqual((yield* actor.getSnapshot).value, "busy")
    })
  )

  it.effect("[P14] the adapter sees the snapshot the actor starts from, before the events sent before start", () =>
    Effect.gen(function* () {
      const seen: Array<unknown> = []
      const actor = yield* createActor(machine, {
        devTools: (service) => Effect.map(service.getSnapshot, (snapshot) => seen.push(snapshot.value)),
      })
      yield* actor.send({ type: "GO" })
      yield* actor.start
      assert.deepStrictEqual(seen, ["idle"])
      assert.strictEqual((yield* actor.getSnapshot).value, "busy")
    })
  )

  it.effect("[P14] registerService and devToolsAdapter register a service with the global hook, whose onRegister listeners hear of it", () =>
    Effect.gen(function* () {
      const { hook, registered } = makeHook()
      yield* installHook(hook)
      const heard: Array<AnyActor> = []
      const subscription = hook.onRegister((service) => heard.push(service))

      const actor = yield* createActor(machine)
      yield* registerService(actor)
      yield* devToolsAdapter(actor)
      assert.strictEqual(registered.length, 2)
      assert.strictEqual(registered[0], actor)
      assert.strictEqual(registered[1], actor)
      assert.strictEqual(heard.length, 2)

      subscription.unsubscribe()
      hook.unregister(actor)
      yield* registerService(actor)
      assert.strictEqual(heard.length, 2)
      assert.isTrue(hook.services.has(actor))
    })
  )

  it.effect("[P14] without a global hook, getGlobal gives the global object, and registerService, devToolsAdapter and devTools: true do nothing and do not fail", () =>
    Effect.gen(function* () {
      const warned: Array<unknown> = []
      const global = yield* withLogged("Warn", warned, getGlobal())
      assert.isTrue(Option.isSome(global))
      assert.strictEqual(Option.getOrThrow(global), globalThis)
      assert.deepStrictEqual(warned, [])
      assert.isFalse(Object.hasOwn(globalThis, "__xstate__"))

      const reported: Array<unknown> = []
      yield* withLogged(
        "Error",
        reported,
        Effect.gen(function* () {
          const actor = yield* createActor(machine, { devTools: true })
          // Neither with nor without a window object
          yield* registerService(actor)
          yield* devToolsAdapter(actor)
          yield* withGlobal("window", globalThis)
          yield* registerService(actor)
          yield* devToolsAdapter(actor)

          yield* actor.start
          assert.strictEqual((yield* actor.getSnapshot).status, "active")
          yield* actor.send({ type: "GO" })
          assert.strictEqual((yield* actor.getSnapshot).value, "busy")
        })
      )
      assert.deepStrictEqual(reported, [])
    })
  )

  it.effect("[P14] in an environment with no global object, the lookup behind getGlobal logs upstream's warning once and gives none", () =>
    Effect.gen(function* () {
      const warned: Array<unknown> = []
      const none = yield* withLogged("Warn", warned, firstGlobalObject([Option.none(), Option.none(), Option.none(), Option.none()]))
      assert.isTrue(Option.isNone(none))
      assert.deepStrictEqual(warned, [noGlobalObject])

      // The first candidate that exists wins, in upstream's order: globalThis, self, window, global
      const later = { marker: "window" } as unknown as typeof globalThis
      const found = yield* withLogged("Warn", warned, firstGlobalObject([Option.none(), Option.none(), Option.some(later), Option.some(globalThis)]))
      assert.strictEqual(Option.getOrThrow(found), later)
      assert.strictEqual(warned.length, 1)
    })
  )

  it.effect("[P14] without a window object the hook is never called, as upstream checks typeof window", () =>
    Effect.gen(function* () {
      const { hook, registered } = makeHook()
      yield* withGlobal("__xstate__", hook)
      assert.isFalse(Object.hasOwn(globalThis, "window"))

      const actor = yield* createActor(machine, { devTools: true })
      yield* actor.start
      yield* registerService(actor)
      yield* devToolsAdapter(actor)
      assert.strictEqual(registered.length, 0)
    })
  )

  it.effect("[P14] XStateDevInterface types register, unregister, onRegister and services", () =>
    Effect.gen(function* () {
      const { hook } = makeHook()
      assert.deepStrictEqual(Object.keys(hook).sort(), ["onRegister", "register", "services", "unregister"])
      assert.instanceOf(hook.services, Set)

      const noop = (_service: AnyActor) => {}
      // @ts-expect-error XStateDevInterface requires unregister
      const withoutUnregister: XStateDevInterface = {
        services: new Set(),
        register: noop,
        onRegister: () => ({ unsubscribe: () => {} }),
      }
      const withoutUnsubscribe: XStateDevInterface = {
        services: new Set(),
        register: noop,
        unregister: noop,
        // @ts-expect-error onRegister returns an object with unsubscribe
        onRegister: () => ({}),
      }
      assert.isDefined(withoutUnregister)
      assert.isDefined(withoutUnsubscribe)
      yield* Effect.void
    })
  )

  it.effect("[P14] with a global hook and no devTools option, or devTools: false, the hook never receives the actor", () =>
    Effect.gen(function* () {
      const { hook, registered } = makeHook()
      yield* installHook(hook)

      const withoutOption = yield* createActor(machine)
      yield* withoutOption.start
      const withFalse = yield* createActor(machine, { devTools: false })
      yield* withFalse.start
      yield* withFalse.send({ type: "GO" })

      assert.strictEqual(registered.length, 0)
      assert.strictEqual(hook.services.size, 0)
    })
  )

  it.effect("[P14] a custom adapter function given as devTools is called with the actor at start instead of devToolsAdapter", () =>
    Effect.gen(function* () {
      const { hook, registered } = makeHook()
      yield* installHook(hook)
      const adapted: Array<AnyActor> = []

      const actor = yield* createActor(machine, {
        devTools: (service) => Effect.sync(() => adapted.push(service)),
      })
      assert.strictEqual(adapted.length, 0)
      yield* actor.start

      assert.strictEqual(adapted.length, 1)
      assert.strictEqual(adapted[0], actor)
      assert.strictEqual(registered.length, 0)
    })
  )

  it.effect("[P14] a child that the actor spawns does not inherit the devTools option", () =>
    Effect.gen(function* () {
      const { hook, registered } = makeHook()
      yield* installHook(hook)
      const parent = createMachine({
        id: "p14-parent",
        context: {},
        entry: spawnChild(machine, { id: "child" }),
      })

      const actor = yield* createActor(parent, { devTools: true })
      yield* actor.start
      assert.isDefined((yield* actor.getSnapshot).children["child"])
      assert.deepStrictEqual(registered, [actor])
    })
  )

  it.effect("[P14] an actor that an initial action errors at start is still registered, after it errors; an actor done or errored before start is not", () =>
    Effect.gen(function* () {
      const { hook, registered } = makeHook()
      yield* installHook(hook)
      const boom = new Error("entry failed")
      const reported: Array<unknown> = []

      yield* withLogged(
        "Error",
        reported,
        Effect.gen(function* () {
          // Upstream `update` errors the actor (`_error`), then `start` calls `attachDevTools`
          const failing = yield* createActor(
            createMachine({
              id: "p14-entry-fails",
              context: {},
              entry: () => {
                throw boom
              },
            }),
            { devTools: true }
          )
          yield* failing.start
          assert.deepStrictEqual(registered, [failing])
          assert.strictEqual((yield* failing.getSnapshot).status, "error")

          // Upstream `start` returns before `attachDevTools` for a done or an errored snapshot
          const done = yield* createActor(
            createMachine({ id: "p14-done", initial: "end", context: {}, states: { end: { type: "final" } } }),
            { devTools: true }
          )
          yield* done.start
          assert.strictEqual((yield* done.getSnapshot).status, "done")

          const errored = yield* createActor(
            createMachine({
              id: "p14-context-fails",
              context: () => {
                throw boom
              },
            }),
            { devTools: true }
          )
          yield* errored.start
          assert.strictEqual((yield* errored.getSnapshot).status, "error")
          assert.deepStrictEqual(registered, [failing])
        })
      )
      // Each root actor with no error subscriber reports its own error once (SD-21)
      assert.deepStrictEqual(reported, [boom, boom])
    })
  )

  it.effect("[P14] the adapter runs after upstream's update: a custom adapter sees status error for an actor that an initial action errors", () =>
    Effect.gen(function* () {
      const boom = new Error("entry failed")
      const reported: Array<unknown> = []
      const seen: Array<string> = []

      yield* withLogged(
        "Error",
        reported,
        Effect.gen(function* () {
          const failing = yield* createActor(
            createMachine({
              id: "p14-entry-fails-adapter",
              context: {},
              entry: () => {
                throw boom
              },
            }),
            { devTools: (service) => Effect.map(service.getSnapshot, (snapshot) => seen.push(snapshot.status)) }
          )
          yield* failing.start
        })
      )
      // Upstream `update` runs the initial action, which errors the actor (`_error`); only then
      // does `start` call `attachDevTools`, so the adapter sees the errored snapshot, once
      assert.deepStrictEqual(seen, ["error"])
      assert.deepStrictEqual(reported, [boom])
    })
  )

  it.effect("[P14] the initial actions run and a subscriber gets the start snapshot before a throwing hook or a dying adapter makes start die", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const withEntry = createMachine({
        id: "p14-entry",
        initial: "idle",
        context: {},
        entry: () => log.push("entry"),
        states: { idle: { on: { GO: "busy" } }, busy: {} },
      })
      const boom = new Error("hook broke")
      const { hook } = makeHook()
      yield* installHook({
        ...hook,
        register: () => {
          log.push("register")
          throw boom
        },
      })

      // devTools: true, with a hook whose register throws
      const registered = yield* createActor(withEntry, { devTools: true })
      const registeredSeen: Array<unknown> = []
      yield* registered.subscribe((snapshot) => Effect.sync(() => registeredSeen.push(snapshot.value)))
      const defect = yield* defectOfStart(registered)
      assert.instanceOf(defect, DevToolsError)
      assert.strictEqual((defect as DevToolsError).cause, boom)
      // Upstream `update` runs the initial actions before `attachDevTools` calls the hook
      assert.deepStrictEqual(log, ["entry", "register"])
      // `update` also hands the start snapshot to the observers before the throw leaves
      // `start`; the port's subscriber hears of it in its own fiber
      yield* settle
      assert.deepStrictEqual(registeredSeen, ["idle"])

      // A custom adapter that dies
      log.length = 0
      const dying = yield* createActor(withEntry, {
        devTools: () => Effect.andThen(Effect.sync(() => log.push("adapter")), Effect.die("adapter died")),
      })
      const dyingSeen: Array<unknown> = []
      yield* dying.subscribe((snapshot) => Effect.sync(() => dyingSeen.push(snapshot.value)))
      assert.strictEqual(yield* defectOfStart(dying), "adapter died")
      assert.deepStrictEqual(log, ["entry", "adapter"])
      yield* settle
      assert.deepStrictEqual(dyingSeen, ["idle"])
      assert.strictEqual((yield* dying.getSnapshot).status, "active")
    })
  )

  it.effect("[P14] a hook whose register throws fails registerService with DevToolsError, and its throw leaves start as a defect before the actor processes any event", () =>
    Effect.gen(function* () {
      const boom = new Error("hook broke")
      const { hook } = makeHook()
      yield* installHook({ ...hook, register: () => { throw boom } })

      const probe = yield* createActor(machine)
      const error = yield* Effect.flip(registerService(probe))
      assert.instanceOf(error, DevToolsError)
      assert.strictEqual(error.cause, boom)
      const adapterError = yield* Effect.flip(devToolsAdapter(probe))
      assert.instanceOf(adapterError, DevToolsError)
      assert.strictEqual(adapterError.cause, boom)

      const reported: Array<unknown> = []
      yield* withLogged(
        "Error",
        reported,
        Effect.gen(function* () {
          const actor = yield* createActor(machine, { devTools: true })
          yield* actor.send({ type: "GO" })
          const defect = yield* defectOfStart(actor)
          assert.instanceOf(defect, DevToolsError)
          assert.strictEqual((defect as DevToolsError).cause, boom)
          // GO, sent before start, never ran: upstream's mailbox never starts
          assert.strictEqual((yield* actor.getSnapshot).value, "idle")
          assert.strictEqual((yield* actor.getSnapshot).status, "active")
        })
      )
      // The throw leaves start; the actor does not report it
      assert.deepStrictEqual(reported, [])
    })
  )

  it.effect("[P14] a custom adapter that fails or dies makes start die with that value", () =>
    Effect.gen(function* () {
      const failing = yield* createActor(machine, { devTools: () => Effect.fail("adapter failed") })
      assert.strictEqual(yield* defectOfStart(failing), "adapter failed")
      const dying = yield* createActor(machine, { devTools: () => Effect.die("adapter died") })
      assert.strictEqual(yield* defectOfStart(dying), "adapter died")
      assert.strictEqual((yield* failing.getSnapshot).status, "active")
      assert.strictEqual((yield* dying.getSnapshot).status, "active")
    })
  )

  it.effect("[P14] a truthy global __xstate__ value without a register function fails registration, as upstream's call throws; a falsy one is no hook", () =>
    Effect.gen(function* () {
      yield* installHook({ services: new Set() })
      const probe = yield* createActor(machine)
      assert.instanceOf(yield* Effect.flip(registerService(probe)), DevToolsError)
      assert.instanceOf(yield* Effect.flip(devToolsAdapter(probe)), DevToolsError)
      const actor = yield* createActor(machine, { devTools: true })
      assert.instanceOf(yield* defectOfStart(actor), DevToolsError)

      yield* withGlobal("__xstate__", 0)
      const quiet = yield* createActor(machine, { devTools: true })
      yield* quiet.start
      yield* registerService(quiet)
      yield* devToolsAdapter(quiet)
      assert.strictEqual((yield* quiet.getSnapshot).status, "active")
    })
  )
})
