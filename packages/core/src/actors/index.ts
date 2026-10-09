/**
 * @since 0.1.0
 * @module actors
 *
 * Pre-built actor logic implementations, and `createEmptyActor`.
 */
import { type Effect, Function, type Scope } from "effect"
import type { Actor } from "../Actor.js"
import { createActor } from "../Actor.js"
import type { ActorSystemService } from "../ActorLogic.js"
import type { AnyEventObject } from "../internal/anyEventObject.js"
import { fromTransition, type TransitionSnapshot } from "./fromTransition.js"

export * from "./fromPromise.js"
export * from "./fromCallback.js"
export * from "./fromTransition.js"
export * from "./fromObservable.js"
export * from "./fromEffect.js"

/**
 * The logic of every empty actor (upstream `fromTransition((_) => undefined, undefined)`): each
 * event leaves the state `undefined`. The initial state is the factory form, whose result is the
 * same `undefined` state.
 */
const emptyLogic = fromTransition<undefined, AnyEventObject, ActorSystemService, unknown, AnyEventObject>(
  Function.constUndefined,
  Function.constUndefined
)

/**
 * Creates an actor that does nothing (upstream `createEmptyActor`): its snapshot is `active`
 * with an `undefined` context, it accepts any event and leaves the context `undefined`, and it
 * emits nothing. As `createActor`, it creates a new, unstarted root actor with its own system,
 * in the caller's scope (D6). Upstream types the result `ActorRef<Snapshot<undefined>,
 * AnyEventObject, AnyEventObject>`; here it is the actor itself (its snapshot type also names
 * the `undefined` context), which that type accepts.
 *
 * @example
 * ```ts
 * const actor = yield* createEmptyActor()
 * yield* actor.start
 * yield* actor.send({ type: "ANYTHING" })
 * ```
 *
 * @since 0.1.0
 * @category Actors
 */
export const createEmptyActor = (): Effect.Effect<
  Actor<TransitionSnapshot<undefined>, AnyEventObject, AnyEventObject>,
  never,
  Scope.Scope
> => createActor(emptyLogic)
