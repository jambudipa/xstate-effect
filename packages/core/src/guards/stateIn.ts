/**
 * @since 0.1.0
 * @module guards/stateIn
 *
 * The stateIn guard checks if the machine is in a specific state.
 */
import { Effect, Option, Result } from "effect"
import { GuardError } from "../Errors.js"
import type { EventObject } from "../Event.js"
import type { MachineSnapshot } from "../Snapshot.js"
import type { StateValue } from "../StateValue.js"
import type { BuiltInGuardDefinition } from "../Types.js"
import { evaluateGuard, guardScopeOf } from "./evaluateGuard.js"

/** The type of the `stateIn` guard definition, which an error of the guard names. */
const STATE_IN_TYPE = "xstate.stateIn"

/** Whether a state value is a state node id (upstream `isStateId`): a string that starts with `#`. */
const isStateId = (stateValue: StateValue): stateValue is string => typeof stateValue === "string" && stateValue.startsWith("#")

/**
 * Whether the snapshot is in the state (upstream `checkStateIn`): a state node id (`#id`,
 * then an optional key path) holds when that node is one of the snapshot's active nodes,
 * and any other state value is `snapshot.matches(stateValue)`. An id or path that names no
 * node fails with `GuardError` and the upstream message, as upstream's
 * `getStateNodeById` throws it inside the guard.
 */
const checkStateIn = (snapshot: MachineSnapshot, stateValue: StateValue): Effect.Effect<boolean, GuardError> => {
  if (!isStateId(stateValue)) {
    return Effect.succeed(snapshot.matches(stateValue))
  }
  return Result.match(snapshot.machine._snapshotQueries.stateNodeById(stateValue), {
    onFailure: (message) => Effect.fail(new GuardError({ message, guard: STATE_IN_TYPE })),
    // Upstream `snapshot._nodes.some((sn) => sn === target)`
    onSuccess: (target) => Effect.succeed(snapshot._nodes.includes(target)),
  })
}

/**
 * Creates a guard that checks if the machine is in a specific state (upstream `stateIn`),
 * against the snapshot the guard is evaluated with: a state node id (`"#id"`, also with a
 * key path such as `"#b.B1"`) holds while that node is active, and any other state value
 * holds when `snapshot.matches(stateValue)` does (a dotted string is a path, a parallel
 * region key matches). The check reads the whole configuration, so a guard in one region
 * can test a node of another. An id that names no node fails the guard with `GuardError`.
 * The engine gives the guard the snapshot of the step it decides; without a snapshot (a
 * direct `evaluateGuard` call with none in its scope) no state is active and it is false.
 *
 * The guard reads its state value from its closure (`params` only shows it), so it decides
 * the same way when it is used by name.
 *
 * @example
 * ```ts
 * // Check for atomic state
 * stateIn("loading")
 *
 * // Check for nested state
 * stateIn({ active: "loading" })
 *
 * // Check for parallel states
 * stateIn({ upload: "active", download: "idle" })
 *
 * // Check a state node by its id
 * stateIn("#uploading")
 * ```
 *
 * @since 0.1.0
 * @category Guards
 */
export const stateIn = <TContext, TEvent extends EventObject>(
  stateValue: StateValue
): BuiltInGuardDefinition<TContext, TEvent, { stateValue: StateValue }> => ({
  type: STATE_IN_TYPE,
  params: { stateValue },
  predicate: (ctx) =>
    Option.match(Option.fromNullishOr(ctx.snapshot), {
      onNone: () => Effect.succeed(false),
      onSome: (snapshot) => checkStateIn(snapshot, stateValue),
    }),
})

/**
 * Creates a guard that checks if the machine is NOT in a specific state (port extra): the
 * negation of `stateIn`, evaluated by the shared `evaluateGuard`.
 *
 * @example
 * ```ts
 * stateNotIn("error")
 * ```
 *
 * @since 0.1.0
 * @category Guards
 */
export const stateNotIn = <TContext, TEvent extends EventObject>(
  stateValue: StateValue
): BuiltInGuardDefinition<TContext, TEvent, { stateValue: StateValue }> => ({
  type: "xstate.stateNotIn",
  params: { stateValue },
  predicate: (ctx) =>
    evaluateGuard(stateIn<TContext, TEvent>(stateValue), ctx.context, ctx.event, guardScopeOf(ctx)).pipe(
      Effect.map((inState) => !inState)
    ),
})
