/**
 * @since 0.1.0
 * @module internal/delivery
 *
 * The delivery behind an actor's `send` (upstream `_send`, which `_relay` calls after it sent
 * the `@xstate.event` inspection event). An actor's own `send` reports the event with no
 * source and then delivers it; the system relay reports it with its source and then delivers
 * it. A relay that waits for the target's macrostep (a `SimulatedClock` delivery, SD-28) needs
 * that delivery without a second report, so each actor keeps it under a module-private key.
 */
import type { Effect } from "effect"
import { Predicate } from "effect"
import type { ActorRefBase } from "../ActorRef.js"
import type { EventObject } from "../Event.js"

/**
 * The key of an actor's waiting delivery.
 *
 * @since 0.1.0
 * @category Symbols
 */
export const WaitingDeliveryKey: unique symbol = Symbol.for("@xstate-effect/Actor/waitingDelivery")

/**
 * An actor's delivery as `send` makes it, without the inspection event (SD-23): from outside
 * every actor's processing it waits for the event's macrostep; from inside one, or to an actor
 * that has not started, it only queues the event.
 *
 * @since 0.1.0
 * @category Models
 */
export type WaitingDelivery = (event: EventObject) => Effect.Effect<void>

/**
 * Whether `target` keeps a waiting delivery (every actor of the `Actor` module does).
 *
 * @since 0.1.0
 * @category Guards
 */
export const hasWaitingDelivery = (
  target: ActorRefBase
): target is ActorRefBase & { readonly [WaitingDeliveryKey]: WaitingDelivery } =>
  Predicate.hasProperty(target, WaitingDeliveryKey) && Predicate.isFunction(target[WaitingDeliveryKey])
