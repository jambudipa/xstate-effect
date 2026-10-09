/**
 * @since 0.1.0
 * @module graph/validateMachine
 *
 * The check `createTestModel` makes on its machine (upstream `src/graph/validateMachine.ts` at
 * xstate@5.33.2): a test model cannot drive invocations, `after` transitions or delayed
 * inline actions. Upstream throws; the port fails the Effect with the same message (SD-3).
 */
import { Effect, Option, Predicate } from "effect"
import type { EventObject } from "../Event.js"
import { delayOf } from "../internal/actionDelay.js"
import type { AnyStateMachine } from "../StateMachine.js"
import { isStateNode, type StateNode } from "../StateNode.js"
import type { Action } from "../Types.js"
import { UnsupportedTestMachineError } from "./errors.js"

/**
 * Whether an action is a built-in `raise` or `sendTo` written with a numeric delay (upstream:
 * a function with `resolve` whose `delay` is a number). Like upstream, a named action is not
 * looked up.
 */
const isDelayedAction = (action: Action<unknown, EventObject>): boolean =>
  Predicate.isObject(action) && Option.exists(delayOf(action), (delay) => typeof delay === "number")

/**
 * Checks one state node, then its children in document order, and fails at the first node
 * that has an invocation, an `after` transition or a delayed inline action on its entry,
 * exit or transitions. Eventless (`always`) transitions are not checked, as upstream.
 */
const validateState = (state: StateNode<unknown, EventObject>): Effect.Effect<void, UnsupportedTestMachineError> =>
  Effect.gen(function* () {
    if (state.invoke.length > 0) {
      return yield* new UnsupportedTestMachineError({ message: "Invocations on test machines are not supported" })
    }
    if (state.after.length > 0) {
      return yield* new UnsupportedTestMachineError({ message: "After events on test machines are not supported" })
    }
    // Upstream: this doesn't account for always transitions
    const actions = [
      ...state.entry,
      ...state.exit,
      ...state.transitions.flatMap(([, transitions]) => transitions.flatMap((transition) => Array.from(transition.actions))),
    ]
    if (actions.some(isDelayedAction)) {
      return yield* new UnsupportedTestMachineError({ message: "Delayed actions on test machines are not supported" })
    }

    for (const child of Object.values(state.states)) {
      yield* validateState(child)
    }
  })

/**
 * Fails with the upstream message when the machine has an invocation, an `after` transition
 * or a delayed inline action in any state node, checked in document order.
 *
 * @since 0.1.0
 * @category Internal
 */
export const validateMachine = (machine: AnyStateMachine): Effect.Effect<void, UnsupportedTestMachineError> =>
  isStateNode(machine.root) ? validateState(machine.root) : Effect.void
