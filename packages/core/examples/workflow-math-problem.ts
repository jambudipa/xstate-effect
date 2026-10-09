/**
 * Workflow Math Problem Example
 *
 * A workflow that solves multiple math problems in batch.
 *
 * Demonstrates:
 * - Setup API with typed context
 * - Batch processing with fromPromise
 * - Array handling in context
 * - Final state with computed output
 *
 * Ported from xstate/examples/workflow-math-problem
 * Based on: https://github.com/serverlessworkflow/specification/tree/main/examples#solving-math-problems-example
 */
import { Option } from "effect"
import { setup, assign, fromPromise } from "../src/index.js"

/**
 * Result of solving a math problem.
 */
export interface MathResult {
  /** The expression as it was given. */
  problem: string
  /** The answer as text; the mock gives "Solved <problem>" and does not evaluate anything. */
  result: string
}

/**
 * Context type for the math problem workflow.
 */
export interface MathProblemContext {
  /** The answers in the order of the input expressions; undefined until the batch finishes. The final output repeats it. */
  results: string[] | undefined
}

/**
 * Events for the math problem workflow.
 */
export type MathProblemEvent =
  | { type: "xstate.init"; input: { expressions: string[] } }
  | { type: "xstate.done.actor.batchMathFunction"; output: MathResult[] }

/**
 * Batch math function actor.
 *
 * Solves multiple math problems in parallel.
 */
export const batchMathFunctionActor = fromPromise<MathResult[], { problems: string[] }>(
  async ({ input }) => {
    return Promise.all(
      input.problems.map(async (problem) => {
        // Simulate solving the problem
        await new Promise((resolve) => setTimeout(resolve, 50))
        return {
          problem,
          result: `Solved ${problem}`,
        }
      })
    )
  }
)

/**
 * Math problem workflow machine.
 *
 * This workflow:
 * 1. Receives a list of math expressions
 * 2. Solves them in batch
 * 3. Outputs the results
 */
export const mathProblemMachine = setup({
  types: {
    context: {} as MathProblemContext,
    events: {} as MathProblemEvent,
  },
  actors: {
    batchMathFunction: batchMathFunctionActor,
  },
}).createMachine({
  id: "math-problem",
  initial: "Solve",
  context: {
    results: undefined,
  },
  states: {
    Solve: {
      invoke: {
        src: "batchMathFunction",
        input: ({ event }) => ({
          problems: (event as { type: "xstate.init"; input: { expressions: string[] } }).input?.expressions ?? [],
        }),
        onDone: {
          target: "Solved",
          actions: assign(({ event }) => ({
            results: Option.getOrUndefined(Option.map(event.output, (output) => output.map((r) => r.result))),
          })),
        },
      },
    },
    Solved: {
      type: "final",
      output: ({ context }) => ({
        results: context.results,
      }),
    },
  },
})
