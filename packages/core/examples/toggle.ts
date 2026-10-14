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
import { assign, createMachine } from "../src/index.js"

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
 * This variant counts the toggles in its context. It is the port's own addition: the upstream
 * toggle example has only `toggleMachine`.
 */
export interface ToggleWithCountContext {
  /** The number of toggle events since the start or the last reset; each toggle adds 1, either way. */
  toggleCount: number
}

/** The events of `toggleWithCountMachine`: toggle flips the state, reset returns to "inactive" from either state. */
export type ToggleWithCountEvent = { type: "toggle" } | { type: "reset" }

/** Adds 1 to `toggleCount`; each toggle transition runs it. */
const countToggle = assign<ToggleWithCountContext, ToggleWithCountEvent>(({ context }) => ({
  toggleCount: context.toggleCount + 1,
}))

/**
 * Toggle machine with a context and a reset event. It starts "inactive"; toggle switches
 * between "inactive" and "active" and adds 1 to `toggleCount`, and reset goes to "inactive"
 * from either state and sets `toggleCount` back to 0.
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
        toggle: {
          target: "active",
          actions: countToggle,
        },
        reset: {
          target: "inactive",
          actions: assign({ toggleCount: 0 }),
        },
      },
    },
    active: {
      on: {
        toggle: {
          target: "inactive",
          actions: countToggle,
        },
        reset: {
          target: "inactive",
          actions: assign({ toggleCount: 0 }),
        },
      },
    },
  },
})
