/**
 * @since 0.1.0
 * @module Errors
 *
 * All error types for xstate-effect using Data.TaggedError for type-safe error handling.
 */
import { Data } from "effect"

/**
 * Error that occurs during state machine transitions.
 *
 * @since 0.1.0
 * @category Errors
 */
export class TransitionError extends Data.TaggedError("TransitionError")<{
  readonly message: string
  readonly snapshot: unknown
  readonly event: unknown
  readonly cause?: unknown
}> {}

/**
 * Error that occurs during actor initialization: an `initial` key that names no child state
 * node, with the upstream message `Initial state node "<key>" not found on parent state node
 * #<id>`, or a machine whose config has a definition error, with that error's upstream message
 * and the `MachineDefinitionError` as `cause` (SD-3, amended 2026-10-08). Upstream throws the
 * first as a plain `Error` and the actor stores it as its snapshot
 * error, so its `name` is `Error` and it prints as `[Error: <message>]`, as the upstream
 * inline snapshots expect; its `_tag` stays `InitializationError`.
 *
 * @since 0.1.0
 * @category Errors
 */
export class InitializationError extends Data.TaggedError("InitializationError")<{
  readonly message: string
  readonly input: unknown
  readonly cause?: unknown
}> {
  /**
   * `Error`, not the tag: upstream throws this as a plain `Error`, and its inline snapshots
   * print the actor's stored error as `[Error: <message>]`. Match on `_tag`, not on `name`.
   */
  override readonly name = "Error"
}

/**
 * Error that occurs during actor operations. Most carry an upstream message that upstream
 * throws as a plain `Error` (for example `Actor with system ID '<id>' already exists.`), so
 * its `name` is `Error`, as upstream's: it prints as `[Error: <message>]`, as the upstream
 * inline snapshots expect. Its `_tag` stays `ActorError`.
 *
 * @since 0.1.0
 * @category Errors
 */
export class ActorError extends Data.TaggedError("ActorError")<{
  readonly message: string
  readonly actorId: string
  readonly cause?: unknown
}> {
  /**
   * `Error`, not the tag: upstream throws these as a plain `Error`, so the error prints as
   * `[Error: <message>]`. Match on `_tag`, not on `name`.
   */
  override readonly name = "Error"
}

/**
 * Error that occurs during guard evaluation: a guard name without implementation, or the
 * upstream `Unable to evaluate guard ...` error around what a guard threw. Upstream throws
 * both as a plain `Error`, so its `name` is `Error` and it prints as `[Error: <message>]`;
 * its `_tag` stays `GuardError`.
 *
 * @since 0.1.0
 * @category Errors
 */
export class GuardError extends Data.TaggedError("GuardError")<{
  readonly message: string
  readonly guard: string
  readonly cause?: unknown
}> {
  /**
   * `Error`, not the tag: upstream throws both guard failures as a plain `Error`, so the
   * error prints as `[Error: <message>]`. Match on `_tag`, not on `name`.
   */
  override readonly name = "Error"
}

/**
 * Error that occurs during action execution.
 *
 * @since 0.1.0
 * @category Errors
 */
export class ActionError extends Data.TaggedError("ActionError")<{
  readonly message: string
  readonly action: string
  readonly cause?: unknown
}> {}

/**
 * Error that occurs when a state node is not found: `machine.getStateNodeById` with an id or
 * a path that names no state node. `id` is the id as given; `message` is the upstream text.
 *
 * @since 0.1.0
 * @category Errors
 */
export class StateNodeNotFoundError extends Data.TaggedError("StateNodeNotFoundError")<{
  readonly id: string
  readonly message: string
}> {}

/**
 * Error that occurs during snapshot serialization: a context the persisted-snapshot codec
 * cannot encode, or the upstream `An inline child actor cannot be persisted.`, which upstream
 * throws as a plain `Error`. Its `name` is `Error`, so it prints as `[Error: <message>]`, as
 * the upstream inline snapshots expect; its `_tag` stays `SerializationError`.
 *
 * @since 0.1.0
 * @category Errors
 */
export class SerializationError extends Data.TaggedError("SerializationError")<{
  readonly message: string
  readonly cause?: unknown
}> {
  /**
   * `Error`, not the tag: upstream throws the inline-child failure as a plain `Error`, so the
   * error prints as `[Error: <message>]`. Match on `_tag`, not on `name`.
   */
  override readonly name = "Error"
}

/**
 * Error that occurs during snapshot restoration.
 *
 * @since 0.1.0
 * @category Errors
 */
export class RestoreError extends Data.TaggedError("RestoreError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

/**
 * A persisted machine snapshot that is not consistent: status `done` on a state that does not
 * complete the machine. Only the opt-in `validateSnapshot` actor option checks it (D11,
 * see docs/decisions.md: XState accepts such a snapshot, so the check is an option, not the
 * default); by default the snapshot restores as in XState. `createActor` declares no failure
 * channel, so the restored actor has status `error` with this error. `stateValue` is the
 * state value, as JSON when it is not a string; `suggestedFix` names the status that makes
 * the snapshot usable again.
 *
 * @since 0.1.0
 * @category Errors
 */
export class InvalidPersistedSnapshotError extends Data.TaggedError("InvalidPersistedSnapshotError")<{
  readonly message: string
  readonly machineId: string
  readonly stateValue: string
  readonly status: string
  readonly suggestedFix: { readonly status: "active" }
}> {}

/**
 * Error that occurs during actor start.
 *
 * @since 0.1.0
 * @category Errors
 */
export class StartError extends Data.TaggedError("StartError")<{
  readonly message: string
  readonly actorId: string
  readonly cause?: unknown
}> {}

/**
 * Error that occurs when an invoke configuration is invalid.
 *
 * @since 0.1.0
 * @category Errors
 */
export class InvokeError extends Data.TaggedError("InvokeError")<{
  readonly message: string
  readonly src: string
  readonly cause?: unknown
}> {}

/**
 * Error that occurs when a delay cannot be resolved.
 *
 * @since 0.1.0
 * @category Errors
 */
export class DelayError extends Data.TaggedError("DelayError")<{
  readonly message: string
  readonly delay: string
  readonly cause?: unknown
}> {}

/**
 * An invalid machine definition, with the upstream message: for example a compound state node
 * without `initial`, which upstream `createMachine` throws. `createMachine` keeps it (SD-3,
 * amended 2026-10-08), and each Effect that computes a snapshot of the machine fails with it,
 * or with its `InitializationError`, `RestoreError` or `TransitionError`, whose `cause` it
 * is. `machine.resolveState` and `getStateNodes` fail with it for a state value that names
 * no state; the engine also returns it as a value when it meets a definition error lazily, as
 * upstream does for an `initial` key that names no child.
 *
 * @since 0.1.0
 * @category Errors
 */
export class MachineDefinitionError extends Data.TaggedError("MachineDefinitionError")<{
  readonly message: string
}> {}

/**
 * An event that matches none of the types given to `assertEvent`. The `assertEvent` Effect
 * fails with it (SD-3, amended 2026-10-08), with the upstream message, `Expected event <the
 * event as JSON> to have type matching "<type>"`. Upstream throws a plain `Error`, so its
 * `name` is `Error` and it prints as `[Error: <message>]`; its `_tag` stays
 * `EventAssertionError`.
 *
 * @since 0.1.0
 * @category Errors
 */
export class EventAssertionError extends Data.TaggedError("EventAssertionError")<{
  readonly message: string
}> {
  /**
   * `Error`, not the tag: upstream `assertEvent` throws a plain `Error`, so the error prints as
   * `[Error: <message>]`. Match on `_tag`, not on `name`.
   */
  override readonly name = "Error"
}

/**
 * Union type of all XState Effect errors.
 *
 * @since 0.1.0
 * @category Errors
 */
export type XStateError =
  | TransitionError
  | InitializationError
  | ActorError
  | GuardError
  | ActionError
  | StateNodeNotFoundError
  | SerializationError
  | RestoreError
  | InvalidPersistedSnapshotError
  | StartError
  | InvokeError
  | DelayError
