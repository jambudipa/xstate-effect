/**
 * @since 0.4.0
 * @module internal/processingActors
 *
 * The fiber-local marker that tells a send made from inside an actor's processing apart from
 * an external one (SD-23). It moved here from `Actor.ts` so that agent logic (`fromAgent`) can
 * clear it for the one fiber that delivers a transition to the invoking machine and must wait
 * for that machine's macrostep: the fiber is no processing fiber, so its wait cannot deadlock.
 */
import { Context } from "effect"
import type { ActorRefBase } from "../ActorRef.js"

/**
 * The actors whose processing or callbacks the current fiber runs in: an actor's processing
 * fiber, its `start`, and its subscribe callbacks set it (SD-23). A send made from such a
 * fiber never waits for its macrostep, and a stop of one of these actors never waits for its
 * processing fiber, so an actor never waits for itself or for another actor.
 *
 * @since 0.4.0
 * @category Internal
 */
export const ProcessingActors = Context.Reference<ReadonlyArray<ActorRefBase>>(
  "@jambudipa/xstate-effect/Actor/ProcessingActors",
  { defaultValue: () => [] }
)
