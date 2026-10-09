/**
 * Counter Example
 *
 * A simple counter state machine that demonstrates:
 * - Root-level event handlers
 * - Context mutations with assign action
 * - No state transitions (single state)
 *
 * Ported from xstate/examples/counter
 */
import { createMachine, assign } from "../src/index.js"

/**
 * Context type for the counter machine.
 */
export interface CounterContext {
  /** The current count: starts at 0, may go negative on decrement, and `set` replaces it. */
  count: number
}

/**
 * Events that the counter machine can receive.
 */
export type CounterEvent =
  | { type: "increment" }
  | { type: "decrement" }
  | { type: "reset" }
  | { type: "set"; value: number }

/**
 * Counter state machine.
 *
 * This machine has a single implicit state and handles all events at the root level.
 * Each event modifies the context using the assign action.
 *
 * @example
 * ```ts
 * import { Effect, Stream } from "effect"
 * import { createActor } from "@jambudipa/xstate-effect"
 * import { counterMachine } from "./counter.js"
 *
 * const program = Effect.gen(function* () {
 *   // The actor owns its system and lives in the scope of this program
 *   const actor = yield* createActor(counterMachine)
 *
 *   // Events sent before start wait in the mailbox; start processes them in order
 *   yield* actor.send({ type: "increment" })
 *   yield* actor.send({ type: "set", value: 42 })
 *   yield* actor.start
 *
 *   // Wait for the snapshot of the last event
 *   const snapshot = yield* actor.changes.pipe(
 *     Stream.filter((current) => current.context.count === 42),
 *     Stream.runHead
 *   )
 *   console.log(snapshot) // Some({ context: { count: 42 }, ... })
 * })
 *
 * Effect.runPromise(Effect.scoped(program))
 * ```
 */
export const counterMachine = createMachine({
  types: {} as { context: CounterContext; events: CounterEvent },
  id: "counter",
  initial: "active",
  context: {
    count: 0,
  },
  states: {
    active: {
      on: {
        increment: {
          actions: assign(({ context }) => ({
            count: context.count + 1,
          })),
        },
        decrement: {
          actions: assign(({ context }) => ({
            count: context.count - 1,
          })),
        },
        reset: {
          actions: assign({ count: 0 }),
        },
        set: {
          actions: assign(({ event }) => ({
            count: event.type === "set" ? event.value : 0,
          })),
        },
      },
    },
  },
})
