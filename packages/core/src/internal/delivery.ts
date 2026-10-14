/**
 * @since 0.1.0
 * @module internal/delivery
 *
 * The delivery behind an actor's `send` (upstream `_send`, which `_relay` calls after it sent
 * the `@xstate.event` inspection event). An actor's own `send` reports the event with no
 * source and then delivers it; the system relay reports it with its source and then delivers
 * it. A relay that waits for the target's macrostep (a `SimulatedClock` delivery, SD-28) needs
 * that delivery without a second report, so each actor keeps it under a module-private key.
 *
 * A `SimulatedClock` delivery then waits until the whole system has settled (SD-28), as
 * upstream's synchronous clock returns only after every event that the delivery set off has
 * been processed: each actor keeps a drain, and each system a settle, under module-private
 * keys too, so neither is a member of the public interfaces.
 */
import { Effect, Predicate } from "effect"
import type { ActorRefBase } from "../ActorRef.js"
import type { EventObject } from "../Event.js"

/**
 * The key of an actor's waiting delivery.
 *
 * @since 0.1.0
 * @category Symbols
 */
export const WaitingDeliveryKey: unique symbol = Symbol.for("@jambudipa/xstate-effect/Actor/waitingDelivery")

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

/**
 * The key of an actor's drain.
 *
 * @since 0.2.1
 * @category Symbols
 */
export const DrainKey: unique symbol = Symbol.for("@jambudipa/xstate-effect/Actor/drain")

/**
 * An actor's drain (SD-28). From outside every actor's processing, a running actor first
 * processes every event queued in its mailbox now; inside an actor's processing, or for an
 * actor that is not running, it does nothing. It then gives how many mailbox entries the
 * actor has processed since its creation, so a caller can tell whether a round of drains
 * processed any.
 *
 * @since 0.2.1
 * @category Models
 */
export type Drain = Effect.Effect<number>

/**
 * Whether `target` keeps a drain (every actor of the `Actor` module does).
 *
 * @since 0.2.1
 * @category Guards
 */
export const hasDrain = (target: ActorRefBase): target is ActorRefBase & { readonly [DrainKey]: Drain } =>
  Predicate.hasProperty(target, DrainKey) && Effect.isEffect(target[DrainKey])

/**
 * The key of a system's settle.
 *
 * @since 0.2.1
 * @category Symbols
 */
export const SettleKey: unique symbol = Symbol.for("@jambudipa/xstate-effect/ActorSystem/settle")

/**
 * A system's settle (SD-28): it drains every registered actor, round after round, until a
 * round finds that no actor processed a mailbox entry since the round before, and no actor
 * joined or left the system.
 *
 * @since 0.2.1
 * @category Models
 */
export type Settle = Effect.Effect<void>

/**
 * Whether `system` keeps a settle (every system of the `ActorSystem` module does).
 *
 * @since 0.2.1
 * @category Guards
 */
export const hasSettle = (system: object): system is { readonly [SettleKey]: Settle } =>
  Predicate.hasProperty(system, SettleKey) && Effect.isEffect(system[SettleKey])
