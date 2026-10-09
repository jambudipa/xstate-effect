/**
 * Workflow Parallel Execution Example
 *
 * A workflow that executes multiple branches in parallel and waits for all to complete.
 *
 * Demonstrates:
 * - Parallel states
 * - Multiple invoke actors in parallel regions
 * - onDone for parallel completion
 * - Final states in nested regions
 *
 * Ported from xstate/examples/workflow-parallel
 * Based on: https://github.com/serverlessworkflow/specification/tree/main/examples#parallel-execution-example
 */
import { setup, fromPromise } from "../src/index.js"

/**
 * Short delay actor - completes quickly.
 */
export const shortDelayActor = fromPromise<void, void>(async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 100))
})

/**
 * Long delay actor - takes longer to complete.
 */
export const longDelayActor = fromPromise<void, void>(async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 300))
})

/**
 * Parallel execution workflow machine.
 *
 * This workflow:
 * 1. Enters a parallel state with two branches
 * 2. Each branch invokes an async actor
 * 3. When both branches complete (reach final states), the parallel state completes
 * 4. Transitions to the Success final state
 */
export const parallelExecutionMachine = setup({
  actors: {
    shortDelay: shortDelayActor,
    longDelay: longDelayActor,
  },
}).createMachine({
  id: "parallel-execution",
  initial: "ParallelExec",
  states: {
    ParallelExec: {
      type: "parallel",
      states: {
        ShortDelayBranch: {
          initial: "active",
          states: {
            active: {
              invoke: {
                src: "shortDelay",
                onDone: "done",
              },
            },
            done: {
              type: "final",
            },
          },
        },
        LongDelayBranch: {
          initial: "active",
          states: {
            active: {
              invoke: {
                src: "longDelay",
                onDone: "done",
              },
            },
            done: {
              type: "final",
            },
          },
        },
      },
      onDone: "Success",
    },
    Success: {
      type: "final",
    },
  },
})
