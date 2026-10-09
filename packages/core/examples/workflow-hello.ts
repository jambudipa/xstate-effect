/**
 * Workflow Hello World Example
 *
 * The simplest possible workflow - immediately transitions to a final state
 * with static output.
 *
 * Demonstrates:
 * - Final states
 * - Static output
 *
 * Ported from xstate/examples/workflow-hello
 * Based on: https://github.com/serverlessworkflow/specification/tree/main/examples#hello-world-example
 */
import { createMachine } from "../src/index.js"

/**
 * Hello World workflow.
 *
 * This workflow immediately completes with a "Hello World!" output.
 */
export const helloWorldMachine = createMachine({
  id: "helloworld",
  initial: "Hello State",
  states: {
    "Hello State": {
      type: "final",
      output: {
        result: "Hello World!",
      },
    },
  },
})
