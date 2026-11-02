/**
 * @since 0.4.0
 * @module actors/unsettled
 *
 * The one output of agent logic (`fromAgent`): its budget is spent with no transition. An
 * invocation of agent logic must settle it through a required `onDone` that leaves the
 * invoking state. Upstream has no counterpart: agent settlement is a port addition.
 */

/**
 * The failed turn outcome an agent's budget ended on. A successful transition (a move) is no
 * reason: it exits the invoking state through a machine event, which stops the agent with no
 * output.
 *
 * @since 0.4.0
 * @category Agent
 */
export type UnsettledReason = "silent" | "illegal" | "malformed" | "crashed" | "overdue"

/**
 * The one output of agent logic: its budget is spent with no transition. `reason` is the
 * outcome of the last attempt and `attempts` the number of turns used. An invocation's
 * `onDone` receives it as `event.output` (an `Option`, as every done event's output, D8).
 *
 * @since 0.4.0
 * @category Agent
 */
export interface Unsettled {
  /** The outcome of the last attempt. */
  readonly reason: UnsettledReason
  /** The number of turns the agent used. */
  readonly attempts: number
}
