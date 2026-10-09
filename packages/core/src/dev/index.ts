/**
 * @since 0.1.0
 * @module dev
 *
 * The dev entry point (upstream `xstate/dev`, `src/dev/index.ts` at xstate@5.33.2): the
 * global object, the dev tools hook that it may hold as `__xstate__`, and the adapter that
 * the `devTools` actor option calls to register each actor that starts with that hook. The
 * functions return Effects (D6, EFF-05) and read the global object only when they run,
 * through `Predicate` guards.
 */
import { Data, Effect, Option, Predicate } from "effect"
import type { AnyActor } from "../Actor.js"
import { firstGlobalObject } from "../internal/globalObject.js"

type ServiceListener = (service: AnyActor) => void

/**
 * The dev tools hook that a dev tools extension puts on the global object as `__xstate__`
 * (upstream `XStateDevInterface`). The port calls only its `register`.
 *
 * @example
 * ```ts
 * const services = new Set<AnyActor>()
 * const hook: XStateDevInterface = {
 *   services,
 *   register: (service) => { services.add(service) },
 *   unregister: (service) => { services.delete(service) },
 *   onRegister: () => ({ unsubscribe: () => {} })
 * }
 * ```
 *
 * @since 0.1.0
 * @category Models
 */
export interface XStateDevInterface {
  readonly register: (service: AnyActor) => void
  readonly unregister: (service: AnyActor) => void
  readonly onRegister: (listener: ServiceListener) => {
    readonly unsubscribe: () => void
  }
  readonly services: Set<AnyActor>
}

/**
 * The global hook could not register a service: its `register` threw (the thrown value is
 * `cause`), or the truthy `__xstate__` value has no `register` function (the value is
 * `cause`; upstream's call throws a `TypeError` there). Upstream lets the throw leave
 * `registerService`, `devToolsAdapter` and the actor's `start`; the port fails the Effect
 * with this error (EFF-04), and an actor's `start` dies with it.
 *
 * @since 0.1.0
 * @category Errors
 */
export class DevToolsError extends Data.TaggedError("DevToolsError")<{
  readonly message: string
  readonly cause: unknown
}> {}

/**
 * The global object (upstream `getGlobal`): `globalThis`, else `self`, `window` or `global`.
 * In an environment with none of them it logs upstream's warning and gives `Option.none()`.
 *
 * @example
 * ```ts
 * const global = yield* getGlobal() // Option.some(globalThis)
 * ```
 *
 * @since 0.1.0
 * @category Constructors
 */
export const getGlobal = Effect.fn("getGlobal")(function* (): Effect.fn.Return<Option.Option<typeof globalThis>> {
  return yield* firstGlobalObject([
    typeof globalThis === "undefined" ? Option.none() : Option.some(globalThis),
    typeof self === "undefined" ? Option.none() : Option.some<typeof globalThis>(self),
    typeof window === "undefined" ? Option.none() : Option.some<typeof globalThis>(window),
    typeof global === "undefined" ? Option.none() : Option.some(global),
  ])
})

/** A hook with a `register` function. */
const hasRegister = (u: unknown): u is XStateDevInterface =>
  Predicate.hasProperty(u, "register") && Predicate.isFunction(u.register)

/** The truthy `__xstate__` value of the global object (upstream `getDevTools`). */
const getDevTools: Effect.Effect<Option.Option<unknown>> = Effect.map(
  Effect.suspend(() => getGlobal()),
  Option.flatMap((global) =>
    Predicate.hasProperty(global, "__xstate__") ? Option.liftPredicate(global.__xstate__, Predicate.isTruthy) : Option.none()
  )
)

/**
 * Registers `service` with the global hook (upstream `registerService` and
 * `devToolsAdapter`, which have the same body): only where a `window` object exists, and only
 * when the hook is there. Otherwise it does nothing.
 */
const registerWithHook = (service: AnyActor): Effect.Effect<void, DevToolsError> =>
  Effect.suspend(() =>
    typeof window === "undefined"
      ? Effect.void
      : Effect.flatMap(
          getDevTools,
          Option.match({
            onNone: () => Effect.void,
            onSome: (devTools) =>
              hasRegister(devTools)
                ? Effect.try({
                    try: () => devTools.register(service),
                    catch: (cause) =>
                      new DevToolsError({ message: `The dev tools hook could not register actor "${service.id}"`, cause }),
                  })
                : Effect.fail(new DevToolsError({ message: "The dev tools hook has no register function", cause: devTools })),
          })
        )
  )

/**
 * Registers an actor with the global dev tools hook `__xstate__` (upstream `registerService`).
 * It does nothing where no `window` object exists or no hook is installed; a hook whose
 * `register` throws, or that has no `register` function, fails it with
 * {@link DevToolsError}.
 *
 * @example
 * ```ts
 * const actor = yield* createActor(machine)
 * yield* registerService(actor)
 * ```
 *
 * @since 0.1.0
 * @category Utils
 */
export const registerService = Effect.fn("registerService")(function* (
  service: AnyActor
): Effect.fn.Return<void, DevToolsError> {
  return yield* registerWithHook(service)
})

/**
 * The default dev tools adapter (upstream `devToolsAdapter`), which `createActor(logic,
 * { devTools: true })` calls with the actor when it starts: it registers the actor with the
 * global hook `__xstate__`, as {@link registerService} does.
 *
 * @example
 * ```ts
 * const actor = yield* createActor(machine, { devTools: true })
 * yield* actor.start // devToolsAdapter(actor) runs here
 * ```
 *
 * @since 0.1.0
 * @category Utils
 */
export const devToolsAdapter = Effect.fn("devToolsAdapter")(function* (
  service: AnyActor
): Effect.fn.Return<void, DevToolsError> {
  return yield* registerWithHook(service)
})
