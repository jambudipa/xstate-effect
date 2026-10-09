/**
 * @since 0.1.0
 * @module graph/errors
 *
 * The failures of the graph entry point. Upstream (`src/graph/*.ts` at xstate@5.33.2) throws
 * each of them as a plain `Error` with the message below; the port fails the Effect of the
 * function instead (SD-3, SD-13). Each `name` is `Error`, so a failure prints as
 * `[Error: <message>]`, as the upstream inline snapshots expect; each `_tag` names the site.
 */
import { Data } from "effect"

/**
 * A traversal that takes more than its `limit` steps (upstream `src/graph/adjacency.ts`:
 * `Traversal limit exceeded`).
 *
 * @since 0.1.0
 * @category Errors
 */
export class TraversalLimitError extends Data.TaggedError("TraversalLimitError")<{
  readonly message: string
}> {
  override readonly name = "Error"
}

/**
 * `joinPaths` with a tail path that does not start where the head path ends (upstream
 * `src/graph/graph.ts`: `Paths cannot be joined`).
 *
 * @since 0.1.0
 * @category Errors
 */
export class JoinPathsError extends Data.TaggedError("JoinPathsError")<{
  readonly message: string
}> {
  override readonly name = "Error"
}

/**
 * `getPathsFromEvents` with an event that the reached state does not take (upstream
 * `src/graph/pathFromEvents.ts`: `Invalid transition from <state> with <event>`).
 *
 * @since 0.1.0
 * @category Errors
 */
export class InvalidEventSequenceError extends Data.TaggedError("InvalidEventSequenceError")<{
  readonly message: string
}> {
  override readonly name = "Error"
}

/**
 * `createTestModel` with a machine that a test model cannot drive: an invocation, an `after`
 * transition or a delayed inline action (upstream `src/graph/validateMachine.ts`).
 *
 * @since 0.1.0
 * @category Errors
 */
export class UnsupportedTestMachineError extends Data.TaggedError("UnsupportedTestMachineError")<{
  readonly message: string
}> {
  override readonly name = "Error"
}
