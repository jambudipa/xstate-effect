/**
 * Toggle Example
 *
 * A simple toggle state machine that demonstrates:
 * - Two states (active/inactive)
 * - Basic state transitions
 * - Event-driven state changes
 *
 * Ported from xstate/examples/toggle
 */
import { createMachine } from "../src/index.js"

/**
 * Events that the toggle machine can receive.
 */
export type ToggleEvent = { type: "toggle" }

/**
 * Toggle state machine.
 *
 * This machine toggles between "inactive" and "active" states
 * when receiving the "toggle" event.
 *
 * @example
 * ```ts
 * import { Effect, Stream } from "effect"
 * import { createActor } from "@jambudipa/xstate-effect"
 * import { toggleMachine } from "./toggle.js"
 *
 * const program = Effect.gen(function* () {
 *   // The actor owns its system and lives in the scope of this program
 *   const actor = yield* createActor(toggleMachine)
 *
 *   // Initial state, readable before start
 *   const initial = yield* actor.getSnapshot
 *   console.log(initial.value) // "inactive"
 *
 *   yield* actor.start
 *
 *   // Toggle on
 *   yield* actor.send({ type: "toggle" })
 *   const active = yield* actor.changes.pipe(
 *     Stream.filter((snapshot) => snapshot.value === "active"),
 *     Stream.runHead
 *   )
 *   console.log(active) // Some({ value: "active", ... })
 * })
 *
 * Effect.runPromise(Effect.scoped(program))
 * ```
 */
export const toggleMachine = createMachine({
  types: {} as { events: ToggleEvent },
  id: "toggle",
  initial: "inactive",
  states: {
    inactive: {
      on: {
        toggle: "active",
      },
    },
    active: {
      on: {
        toggle: "inactive",
      },
    },
  },
})

/**
 * Enhanced toggle with context.
 *
 * This variant is meant to track how many times the toggle has been activated; see
 * `toggleCount` for what it does today.
 */
export interface ToggleWithCountContext {
  /**
   * Meant to count the activations. No transition of `toggleWithCountMachine` assigns it, so it
   * stays 0; the tests check only its initial value.
   */
  toggleCount: number
}

/** The events of `toggleWithCountMachine`: toggle flips the state, reset returns to "inactive" from either state. */
export type ToggleWithCountEvent = { type: "toggle" } | { type: "reset" }

/**
 * Toggle machine with a context and a reset event. It starts "inactive"; toggle switches
 * between "inactive" and "active", and reset goes to "inactive" from either state.
 */
export const toggleWithCountMachine = createMachine({
  types: {} as { context: ToggleWithCountContext; events: ToggleWithCountEvent },
  id: "toggleWithCount",
  initial: "inactive",
  context: {
    toggleCount: 0,
  },
  states: {
    inactive: {
      on: {
        toggle: "active",
        reset: {
          target: "inactive",
          actions: [],
        },
      },
    },
    active: {
      on: {
        toggle: "inactive",
        reset: {
          target: "inactive",
          actions: [],
        },
      },
    },
  },
})
