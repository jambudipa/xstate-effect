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
import type { ExploreEdge, ExploreTrace } from "./explore.js"
import type { SettlementFinding } from "./settlement.js"

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
  /** `Error`, so the failure prints as upstream's plain `Error` does. */
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
  /** `Error`, so the failure prints as upstream's plain `Error` does. */
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
  /** `Error`, so the failure prints as upstream's plain `Error` does. */
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
  /** `Error`, so the failure prints as upstream's plain `Error` does. */
  override readonly name = "Error"
}

/**
 * `proveSettlement` with a machine that leaves an agent outcome unhandled, or a state that may
 * never end. It is a port addition, not an upstream failure, so it keeps its own `name`.
 * `findings` holds every failure, in document order, each with its location.
 *
 * @since 0.4.0
 * @category Errors
 */
export class SettlementProofError extends Data.TaggedError("SettlementProofError")<{
  readonly message: string
  /** The machine's id. */
  readonly machineId: string
  /** Every failure of the proof; never empty. */
  readonly findings: ReadonlyArray<SettlementFinding>
}> {}

/**
 * `explore` stopped at a context field that the machine read and the environment's abstraction
 * does not map (DATA-3). Nothing can exempt a field: only a mapping ends this failure.
 *
 * @since 0.4.0
 * @category Errors
 */
export class UnabstractedField extends Data.TaggedError("UnabstractedField")<{
  readonly message: string
  /** The field. */
  readonly field: string
  /** The states and inputs that led to the read, the input of the read last. */
  readonly trace: ExploreTrace
}> {}

/**
 * `explore` merged two reachable states under one key, and their successors differ, so the
 * abstraction dropped something the machine depends on (DATA-2).
 *
 * @since 0.4.0
 * @category Errors
 */
export class CongruenceViolation extends Data.TaggedError("CongruenceViolation")<{
  readonly message: string
  /** The key of the merged states. */
  readonly key: string
  /** The trace to the first state, then the input and the successor it gives. */
  readonly first: ExploreTrace
  /** The trace to the second state, then the same input and the successor it gives. */
  readonly second: ExploreTrace
}> {}

/**
 * A kind of input that the environment's catalogue lists and the explorer did not drive: it has
 * no driver, or its driver gave no input in any state (S19).
 *
 * @since 0.4.0
 * @category Errors
 */
export class UndrivenInput extends Data.TaggedError("UndrivenInput")<{
  readonly message: string
  /** The catalogue's name for the kind. */
  readonly kind: string
}> {}

/**
 * Reachable states from which no input leads to a final state (a stalled end never counts as
 * final, S19). With no such state, every fair run ends in a final state.
 *
 * @since 0.4.0
 * @category Errors
 */
export class CannotReachFinal extends Data.TaggedError("CannotReachFinal")<{
  readonly message: string
  /** The key of each such state, in the order the run reached them. */
  readonly states: ReadonlyArray<string>
  /** The trace to the first of them. */
  readonly trace: ExploreTrace
}> {}

/**
 * An edge re-enters an agent state on a cycle that neither a declared counter nor an event from
 * a person bounds, so each round buys the agent a new budget (S16).
 *
 * @since 0.4.0
 * @category Errors
 */
export class UnrankedCycle extends Data.TaggedError("UnrankedCycle")<{
  readonly message: string
  /** The edge that re-enters the agent state. */
  readonly edge: ExploreEdge
  /** The trace to the edge's source state. */
  readonly trace: ExploreTrace
}> {}

/**
 * A transition declares a ranking field that the context does not hold as a natural number
 * after the transition, so it is no counter that can run out (S16).
 *
 * @since 0.4.0
 * @category Errors
 */
export class InvalidRanking extends Data.TaggedError("InvalidRanking")<{
  readonly message: string
  /** The declared field. */
  readonly field: string
  /** The edge that took the transition. */
  readonly edge: ExploreEdge
  /** The trace to the edge's source state. */
  readonly trace: ExploreTrace
}> {}

/**
 * `explore` ran past the caller's timeout. A run that did not finish proves nothing, so it
 * fails closed, with how far it got.
 *
 * @since 0.4.0
 * @category Errors
 */
export class ExploreTimeout extends Data.TaggedError("ExploreTimeout")<{
  readonly message: string
  /** The states explored when the time ran out. */
  readonly explored: number
}> {}

/**
 * `checkCertificate` with a certificate that the analysis, run again, does not give. `mismatches`
 * names each field that differs, so a hand-edited verdict reads apart from a stale hash.
 *
 * @since 0.4.0
 * @category Errors
 */
export class CertificateCheckError extends Data.TaggedError("CertificateCheckError")<{
  readonly message: string
  /** The machine's id. */
  readonly machineId: string
  /** Each field that differs, in the certificate's order; never empty. */
  readonly mismatches: ReadonlyArray<{
    /** The field's name. */
    readonly field: "states" | "edges" | "explored" | "hash" | "verdict"
    /** What the certificate holds, as JSON. */
    readonly recorded: string
    /** What the analysis gave, as JSON. */
    readonly derived: string
  }>
}> {}

/**
 * A value of a machine's config or implementations that the certificate's hash cannot read: an
 * object of a class with no own property, such as a `WeakMap` or a `Promise`. Two different such
 * values would hash alike, so a changed machine could keep its certificate; the hash refuses it.
 * A port addition: upstream has no certificates.
 *
 * @since 0.4.0
 * @category Errors
 */
export class CertificateUnreadableValue extends Data.TaggedError("CertificateUnreadableValue")<{
  readonly message: string
  /** The value's place in the config, keys joined with `.`. */
  readonly at: string
}> {}
