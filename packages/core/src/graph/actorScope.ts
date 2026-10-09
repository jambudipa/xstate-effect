/**
 * @since 0.1.0
 * @module graph/actorScope
 *
 * The actor scope of the graph traversals (upstream `src/graph/actorScope.ts` at
 * xstate@5.33.2). Upstream passes a mock actor scope to `transition` and
 * `getInitialSnapshot`; the port's logic reads its actor scope from the Effect context, so the
 * traversals provide it.
 */
import { Effect, type Scope } from "effect"
import { ActorScope, type ActorScopeService } from "../ActorLogic.js"
import * as Snap from "../Snapshot.js"
import { createInertActorScope } from "../testing/getNextSnapshot.js"

/**
 * A mock actor scope (upstream `createMockActorScope`): the inert scope of the pure helpers,
 * whose action executor runs no custom action (upstream `actionExecutor: () => {}`).
 *
 * @since 0.1.0
 * @category Internal
 */
export const createMockActorScope = (): ActorScopeService => createInertActorScope(Snap.active())

/**
 * Runs `effect` with a new mock actor scope, and closes the scope a logic's initial snapshot
 * may open (as the pure `getInitialSnapshot` does).
 *
 * @since 0.1.0
 * @category Internal
 */
export const withMockActorScope = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, Exclude<Exclude<R, ActorScope>, Scope.Scope>> =>
  effect.pipe(Effect.provideService(ActorScope, createMockActorScope()), Effect.scoped)
