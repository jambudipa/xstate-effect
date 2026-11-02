/**
 * @since 0.4.0
 * @module actors/fromAgent
 *
 * Agent logic: actor logic for one non-deterministic model call that must move its invoking
 * state. `fromAgent({ budget, deadline, turn })` runs `turn` once per attempt, classifies each
 * attempt's outcome, prompts again with feedback that names the outcome just before, and ends
 * with the one output `Unsettled` when the literal budget is spent.
 *
 * Movement is detected only by an observed state exit (decision 13): `turn` delivers a
 * transition through the `AgentTurn` capability, which waits for the invoking machine's
 * macrostep. A move exits the state, the exit stops the agent, and the agent outputs nothing
 * (TS-117). A delivery that leaves the state in place is an illegal turn. Text that a turn
 * returns is never read: a turn that succeeds with no transition is silent.
 *
 * The agent's tools are its menu (S21): a record of event Schemas keyed by event type. A setup
 * machine refuses an invocation whose agent has a tool the invoking state does not accept
 * (`MenuCheck`). `transition` decodes each call through its tool's Schema, once, at this
 * boundary: a payload that fails is `malformed`, a type that is no tool is `illegal` and never
 * delivered, and the decoded event is what the machine receives. Upstream has no counterpart:
 * agent settlement is a port addition.
 */
import { Cause, Clock, Context, Deferred, Duration, Effect, Exit, Fiber, Function, HashMap, Option, Predicate, Ref, Result, Schema, Scope } from "effect"
import type { ActorLogic, ActorScopeService } from "../ActorLogic.js"
import { ActorLogicTypeId, ActorScope } from "../ActorLogic.js"
import type { ActorRefBase } from "../ActorRef.js"
import { AgentRunError, RestoreError } from "../Errors.js"
import type { SerializationError, StartError, TransitionError } from "../Errors.js"
import type { EventObject } from "../Event.js"
import { type AgentBrand, type AgentBranded, markAgentLogic } from "../internal/agentBrand.js"
import { clearedInput } from "../internal/clearedInput.js"
import { hasWaitingDelivery, WaitingDeliveryKey } from "../internal/delivery.js"
import { grantLogicCapability, isLogicCapability, type LogicCapability } from "../internal/logicCapability.js"
import { ProcessingActors } from "../internal/processingActors.js"
import { isStopEvent } from "../internal/stopEvent.js"
import * as Persistence from "../persistence.js"
import type { Snapshot } from "../Snapshot.js"
import * as Snap from "../Snapshot.js"
import type { Variance } from "../Types.js"
import type { Unsettled } from "./unsettled.js"

// ============================================================
// LITERAL CHECKS
// ============================================================

/**
 * `true` when `T` is a union of two or more members. The check reads `T` whole on the outside
 * and per member on the inside, so a single literal gives `false`.
 */
type IsUnion<T, TWhole = T> = T extends unknown ? ([TWhole] extends [T] ? false : true) : never

/**
 * `true` only for one positive integer literal written in plain digits. Wide `number`, a union,
 * zero, a negative or fractional value, `1e21` (whose text is `1e+21`) and a branded or
 * `number & {}` value give `false`; a generic `N extends number` stays unresolved.
 */
type IsPositiveIntegerLiteral<N extends number> = number extends N
  ? false
  : true extends IsUnion<N>
    ? false
    : `${N}` extends `${bigint}`
      ? `${N}` extends `-${string}` | "0"
        ? false
        : true
      : false

/**
 * The refusal that a `budget` or `deadline` that is no positive integer literal must match. No
 * number has the member, so the field fails to compile, and the error names the field.
 *
 * @since 0.4.0
 * @category Agent
 */
export interface PositiveIntegerLiteral<TField extends string> {
  /** Never present: a number never fits, so the error names the field and the rule. */
  readonly mustBe: `${TField} must be a positive integer literal`
}

/**
 * What a literal field of {@link fromAgent} must also match: `unknown` (no constraint) for a
 * positive integer literal, the {@link PositiveIntegerLiteral} refusal otherwise (NEG-5).
 *
 * @since 0.4.0
 * @category Agent
 */
export type CheckedLiteral<N extends number, TField extends string> = IsPositiveIntegerLiteral<N> extends true
  ? unknown
  : PositiveIntegerLiteral<TField>

// ============================================================
// OUTCOMES
// ============================================================

/**
 * How one attempt failed to move the state. The feedback for the next attempt is the outcome
 * just before it, and a spent budget reports the last one as the `Unsettled` reason (decision
 * 17). A move is no outcome: it exits the state, which stops the agent with no output.
 *
 * - `silent`: the turn ended, even successfully, with no transition delivered.
 * - `illegal`: a delivered transition left the state in place (an ignored event, a false guard,
 *   a targetless transition or one into a child of the state), or a second transition arrived
 *   while the first was in flight; `event` names the event.
 * - `malformed`: the turn reported a payload it could not decode; `event` and `detail` say which.
 * - `crashed`: the turn died with a defect, or threw before it returned an Effect, or the
 *   process stopped while the attempt ran.
 * - `overdue`: the turn passed its deadline and was interrupted.
 *
 * @since 0.4.0
 * @category Agent
 */
export type TurnOutcome =
  | { readonly reason: "silent" }
  | { readonly reason: "illegal"; readonly event: string }
  | { readonly reason: "malformed"; readonly event: string; readonly detail: string }
  | { readonly reason: "crashed"; readonly detail: string }
  | { readonly reason: "overdue"; readonly deadline: number }

/**
 * What a transition delivered through {@link AgentTurn} gives back when the state did not
 * move (a move stops the agent, so its delivery never returns).
 *
 * - `illegal`: the event left the state in place, or it was not delivered (`delivered: false`)
 *   because an earlier transition of the same turn was still in flight, or because its type is
 *   no tool of the agent (an `xstate.` event never is).
 * - `malformed`: the payload failed its tool's Schema and was not delivered; `detail` holds the
 *   decode issues (S21).
 * - `refused`: the event was not delivered: its attempt ended (`stale`), passed its deadline
 *   (`overdue`), or the agent already output `Unsettled` (`settled`) (CONC-2, CONC-3).
 *
 * @since 0.4.0
 * @category Agent
 */
export type TransitionReply =
  | { readonly status: "illegal"; readonly event: string; readonly delivered: boolean }
  | { readonly status: "malformed"; readonly event: string; readonly detail: string }
  | { readonly status: "refused"; readonly event: string; readonly reason: "stale" | "overdue" | "settled" }

// ============================================================
// TOOLS
// ============================================================

/**
 * The tools of agent logic: each event type the agent may send, with the Schema its payload
 * decodes through (a member of the setup's event Schema, for a `setupWithSchema` machine).
 *
 * @since 0.4.0
 * @category Agent
 */
export type AgentTools = Readonly<Record<string, Schema.Decoder<EventObject>>>

/**
 * What a tools record must also match: each key is the event type its Schema decodes to, so a
 * tool cannot name one event and send another.
 *
 * @since 0.4.0
 * @category Agent
 */
export type KeyedTools<TTools> = { readonly [K in keyof TTools]: Schema.Decoder<{ readonly type: K }> }

/**
 * A tool call as a turn makes it: the tool's event type and the payload fields, which are
 * decoded by the tool's Schema at the agent boundary, so they may still be in encoded form.
 *
 * @since 0.4.0
 * @category Agent
 */
export interface AgentToolCall<TTool extends string = string> {
  /** The tool's event type. */
  readonly type: TTool
  /** The payload fields, decoded by the tool's Schema. */
  readonly [field: string]: unknown
}

// ============================================================
// THE AGENT TURN CAPABILITY
// ============================================================

/**
 * The key only the library can write: it is not exported, so no value of `AgentTurnService`
 * is built by hand, and only `fromAgent` provides `AgentTurn`.
 */
const AgentTurnTypeId: unique symbol = Symbol.for("@jambudipa/xstate-effect/AgentTurn/TypeId")

/**
 * The capability `fromAgent` gives each attempt of `turn`, and nothing else gives (decision
 * 19). A function that needs it in its requirements compiles only inside a `turn`. `TTool`
 * names the tools its `transition` takes: `turn`'s fourth argument has the agent's own.
 *
 * @since 0.4.0
 * @category Agent
 */
export interface AgentTurnService<TTool extends string = string> {
  /** Present only on the values `fromAgent` builds. */
  readonly [AgentTurnTypeId]: typeof AgentTurnTypeId
  /** The attempt this capability belongs to, from 1. A call through it in a later attempt is stale. */
  readonly attempt: number
  /**
   * Decodes `event` through its tool's Schema, delivers the decoded event to the invoking
   * machine and waits for its macrostep. A move stops the agent, so the call never returns;
   * otherwise the reply says why the state stayed. `turn`'s own argument is typed with the
   * agent's tools; the `AgentTurn` service takes any event type.
   */
  readonly transition: (event: AgentToolCall<TTool>) => Effect.Effect<TransitionReply>
  /** Reports a tool call whose payload did not decode: the attempt counts as malformed. */
  readonly malformed: (event: string, detail: string) => Effect.Effect<void>
}

/**
 * The service tag of {@link AgentTurnService}. Only `fromAgent` provides it, to `turn`.
 *
 * @since 0.4.0
 * @category Agent
 */
export class AgentTurn extends Context.Service<AgentTurn, AgentTurnService>()("@jambudipa/xstate-effect/AgentTurn") {}

// ============================================================
// LOGIC TYPES
// ============================================================

/**
 * The outcome of one attempt, with the attempt it closed.
 *
 * @since 0.4.0
 * @category Agent
 */
export interface AttemptRecord {
  /** The attempt, from 1. */
  readonly attempt: number
  /** How the attempt failed to move the state. */
  readonly outcome: TurnOutcome
}

/**
 * The snapshot of agent logic. `attempts` counts the attempts started (written ahead of each
 * turn) and `last` keeps the last recorded outcome, so a restore neither resets the budget nor
 * loses the feedback.
 *
 * @since 0.4.0
 * @category Agent
 */
export interface AgentSnapshot<TInput = unknown> extends Snapshot<Unsettled> {
  /** The input while active; `undefined` once done or stopped. */
  readonly input: TInput | undefined
  /** The attempts started so far. */
  readonly attempts: number
  /** The last recorded attempt outcome. */
  readonly last: Option.Option<AttemptRecord>
}

/**
 * The event agent logic emits as it starts each attempt, before the turn runs, so an instance
 * can journal it (T3.4).
 *
 * @since 0.4.0
 * @category Agent
 */
export interface AgentAttemptEvent {
  /** Always `attempt`. */
  readonly type: "attempt"
  /** The attempt about to run, from 1. */
  readonly attempt: number
}

/**
 * Actor logic built by {@link fromAgent}: branded, with `Unsettled` as its only output and no
 * error. `R` is what `turn` needs, without `AgentTurn`. `TTools` are its tools, which a setup
 * machine checks against the invoking state's accepted events; the wide default fails that
 * check closed.
 *
 * @since 0.4.0
 * @category Agent
 */
export type AgentActorLogic<TInput = unknown, R = never, TTools extends AgentTools = AgentTools> =
  & AgentLogicMethods<TInput, R>
  & AgentBranded
  & AgentToolsOf<TTools>

/**
 * `ActorLogic`, with each method a direct call could run the agent through required to take the
 * {@link LogicCapability} of the machine runtime. It is a separate type, not an intersection with
 * `ActorLogic`: an intersection keeps the optional form as an overload, which a direct call
 * would match. It still fits `ActorLogic` and `AnyLogicSlot`, whose parameter is an optional rest.
 *
 * @since 0.4.0
 * @category Agent
 */
export interface AgentLogicMethods<TInput, R> extends
  Omit<
    ActorLogic<AgentSnapshot<TInput>, EventObject, TInput, AgentAttemptEvent, R>,
    "transition" | "start" | "restoreSnapshot" | "getPersistedSnapshot" | AgentBrand
  >
{
  /** `ActorLogic`'s `transition`, for the machine runtime only. */
  readonly transition: (
    snapshot: AgentSnapshot<TInput>,
    event: EventObject,
    capability: LogicCapability
  ) => Effect.Effect<AgentSnapshot<TInput>, TransitionError, ActorScope | R>
  /** `ActorLogic`'s `start`, for the machine runtime only. */
  readonly start: (
    snapshot: AgentSnapshot<TInput>,
    capability: LogicCapability
  ) => Effect.Effect<void, StartError, ActorScope | Scope.Scope | R>
  /** `ActorLogic`'s `restoreSnapshot`, for the machine runtime only. */
  readonly restoreSnapshot: (
    persisted: unknown,
    capability: LogicCapability
  ) => Effect.Effect<AgentSnapshot<TInput>, RestoreError, ActorScope | R>
  /** `ActorLogic`'s `getPersistedSnapshot`, for the machine runtime only. */
  readonly getPersistedSnapshot: (
    snapshot: AgentSnapshot<TInput>,
    capability: LogicCapability
  ) => Effect.Effect<unknown, SerializationError>
}

/**
 * What agent logic carries besides the brand: its tools, by event type.
 *
 * @since 0.4.0
 * @category Agent
 */
export interface AgentToolsOf<TTools extends AgentTools> {
  /** The tools the agent's turns may call, each with the Schema its payload decodes through. */
  readonly tools: TTools
}

/**
 * The configuration of {@link fromAgent}.
 *
 * @since 0.4.0
 * @category Agent
 */
export interface AgentConfig<TBudget extends number, TDeadline extends number, TInput, R, TTools extends AgentTools = AgentTools> {
  /** The number of attempts, a positive integer literal (NEG-5). */
  readonly budget: TBudget & CheckedLiteral<TBudget, "budget">
  /** The milliseconds each attempt may run, a positive integer literal (NEG-5). */
  readonly deadline: TDeadline & CheckedLiteral<TDeadline, "deadline">
  /**
   * The tools, keyed by event type, each with its event's Schema (S21). Each must be an event
   * the invoking state accepts; a payload decodes through its tool's Schema before delivery.
   */
  readonly tools: TTools & KeyedTools<TTools>
  /**
   * One attempt: prompt the model with `feedback` (none on attempt 1) and deliver any
   * transition through `agent`, the attempt's capability typed with the tools (or through
   * `AgentTurn`). Its error channel is `never`; a defect is `crashed`. What it succeeds with is
   * ignored.
   */
  readonly turn: (
    input: TInput,
    attempt: number,
    feedback: Option.Option<TurnOutcome>,
    agent: AgentTurnService<keyof TTools & string>
  ) => Effect.Effect<unknown, never, R>
}

// ============================================================
// SELF EVENTS
// ============================================================

/** The events the loop delivers to its own actor. Only the objects in `ownEvents` count. */
type SelfEvent =
  | { readonly type: "xstate.agent.attempt"; readonly attempt: number }
  | { readonly type: "xstate.agent.outcome"; readonly record: AttemptRecord }
  | { readonly type: "xstate.agent.unsettled"; readonly unsettled: Unsettled }

/** The self events this module built: another actor cannot forge one, as identity decides. */
const ownEvents = new WeakSet()

/** Builds a self event and records its identity. */
const selfEvent = (event: SelfEvent): SelfEvent => {
  ownEvents.add(event)
  return event
}

/** Narrows an event to a self event this module built. */
const isSelfEvent = (event: EventObject): event is SelfEvent & EventObject => ownEvents.has(event)

/**
 * The transition of agent logic. Only an active snapshot changes: the stop event gives status
 * `stopped`; the loop's own events write the attempt count ahead of a turn, the attempt's
 * outcome, and the final `Unsettled` (status `done`). Every other event changes nothing.
 */
const step = <TInput>(snapshot: AgentSnapshot<TInput>, event: EventObject): AgentSnapshot<TInput> => {
  if (snapshot.status !== "active") return snapshot
  if (isStopEvent(event)) return { ...snapshot, status: "stopped", input: clearedInput }
  if (!isSelfEvent(event)) return snapshot
  switch (event.type) {
    case "xstate.agent.attempt":
      return { ...snapshot, attempts: event.attempt }
    case "xstate.agent.outcome":
      return { ...snapshot, last: Option.some(event.record) }
    case "xstate.agent.unsettled":
      return { ...snapshot, status: "done", output: Option.some(event.unsettled), input: clearedInput }
  }
}

// ============================================================
// THE TURN LOOP
// ============================================================

/** Where one attempt stands: open or closed, the delivery in flight, its first recorded outcome. */
interface AttemptState {
  /** Calls are accepted only while the attempt is open. */
  readonly open: boolean
  /** Why a call after the close is refused. */
  readonly closedBy: "stale" | "overdue"
  /**
   * The delivery in flight, as the signal of its end. It is claimed in the same update that
   * checks `open`, so a close that reads it sees every delivery that won the claim.
   */
  readonly delivery: Option.Option<Deferred.Deferred<void>>
  /** The first outcome a call recorded. */
  readonly recorded: Option.Option<TurnOutcome>
}

/**
 * What a transition call may do: be refused, find another delivery in flight, name no tool,
 * fail its tool's Schema, or go ahead with the decoded event.
 */
type Claim =
  | { readonly kind: "refused"; readonly reason: "stale" | "overdue" }
  | { readonly kind: "busy" }
  | { readonly kind: "unknown" }
  | { readonly kind: "malformed"; readonly detail: string }
  | { readonly kind: "go"; readonly event: EventObject }

/** A claim after its delivery is forked: a `go` becomes the fiber a caller joins. */
type Started = Exclude<Claim, { readonly kind: "go" }> | { readonly kind: "started"; readonly delivery: Fiber.Fiber<void> }

/** A tool call decoded at the agent boundary: no tool, a failed decode, or the decoded event. */
type Decoded = Extract<Claim, { readonly kind: "unknown" | "malformed" | "go" }>

/** The decoder of each tool by event type: the decoded event, or the decode issues. */
type ToolDecoders = HashMap.HashMap<string, (payload: unknown) => Result.Result<EventObject, Schema.SchemaError>>

/** What the loop needs from `fromAgent`'s configuration, with the literals as plain numbers. */
interface LoopConfig<TInput, R> {
  /** The number of attempts. */
  readonly budget: number
  /** The milliseconds each attempt may run. */
  readonly deadline: number
  /** The decoder of each tool. */
  readonly decoders: ToolDecoders
  /** One attempt. */
  readonly turn: (
    input: TInput,
    attempt: number,
    feedback: Option.Option<TurnOutcome>,
    agent: AgentTurnService
  ) => Effect.Effect<unknown, never, R>
}

/**
 * Decodes a tool call once, at the agent boundary: a type that is no tool (an `xstate.` event
 * never is) is `unknown`; a payload its tool's Schema refuses is `malformed` with the issues.
 */
const decodeCall = (decoders: ToolDecoders, call: AgentToolCall): Decoded => {
  const decoder = call.type.startsWith("xstate.") ? Option.none() : HashMap.get(decoders, call.type)
  return Option.match(decoder, {
    onNone: (): Decoded => ({ kind: "unknown" }),
    onSome: (decode) =>
      Result.match(decode(call), {
        onFailure: (error): Decoded => ({ kind: "malformed", detail: error.message }),
        onSuccess: (event): Decoded => ({ kind: "go", event }),
      }),
  })
}

/**
 * Delivers `event` to `target` and waits for its macrostep, from a fiber that is no actor's
 * processing (the marker is cleared), so the wait is real (SD-23). The inspection functions
 * see the event with its source, as for a relay.
 */
const deliverAndWait = (actorScope: ActorScopeService, target: ActorRefBase, event: EventObject): Effect.Effect<void> =>
  Effect.andThen(
    actorScope.system._sendInspectionEvent({
      type: "@xstate.event",
      sourceRef: Option.some(actorScope.self),
      actorRef: target,
      event,
    }),
    hasWaitingDelivery(target) ? target[WaitingDeliveryKey](event) : target.sendUntyped(event)
  ).pipe(Effect.provideService(ProcessingActors, []))

/** The `crashed` detail of a defect that gives no text. */
const unprintableDefect = "a defect with no text"

/**
 * The text of a turn's failure, for `crashed` feedback. A defect is any value a turn holds, and
 * reading it can throw (no prototype, a hostile `toString` or `message`, a proxy). This runs in
 * the loop, where a throw would end the loop with no `Unsettled`, so it must always succeed.
 * `String` gives a `detail` that decodes on restore, whatever an Error holds as `message`.
 */
const describeDefect = (cause: Cause.Cause<unknown>): Effect.Effect<string> =>
  Effect.try({
    try: () => {
      const defect = Cause.squash(cause)
      return String(Predicate.isError(defect) ? defect.message : defect)
    },
    catch: Function.identity,
  }).pipe(Effect.orElseSucceed(() => unprintableDefect))

/** The outcome an attempt that the process left unfinished counts as, on restore. */
const restartedDuring = (attempt: number): TurnOutcome => ({
  reason: "crashed",
  detail: `the process stopped during attempt ${attempt}`,
})

/**
 * Runs the loop of an active snapshot in the actor's scope: it resumes after the attempts the
 * snapshot started, runs each remaining attempt, and outputs `Unsettled` when the budget is
 * spent. A move stops the actor, which interrupts the loop, so nothing is output (TS-117).
 */
const runLoop = <TInput, R>(
  config: LoopConfig<TInput, R>,
  snapshot: AgentSnapshot<TInput>
): Effect.Effect<void, never, ActorScope | Scope.Scope | Exclude<R, AgentTurn>> =>
  Effect.gen(function* () {
    const actorScope = yield* ActorScope
    const scope = yield* Scope.Scope
    const settled = yield* Ref.make(false)
    const input = snapshot.input as TInput
    const toSelf = (event: SelfEvent) => deliverAndWait(actorScope, actorScope.self, event)

    // One attempt: the attempt count is written ahead of the turn, then the outcome after it
    const attemptOnce = (attempt: number, feedback: Option.Option<TurnOutcome>) =>
      Effect.gen(function* () {
        yield* toSelf(selfEvent({ type: "xstate.agent.attempt", attempt }))
        const started: AgentAttemptEvent = { type: "attempt", attempt }
        yield* actorScope.emit(started)
        const outcome = yield* runAttempt(config, actorScope, scope, settled, input, attempt, feedback)
        yield* toSelf(selfEvent({ type: "xstate.agent.outcome", record: { attempt, outcome } }))
        return outcome
      })

    const loop = (attempt: number, feedback: Option.Option<TurnOutcome>): Effect.Effect<TurnOutcome, never, Exclude<R, AgentTurn>> =>
      Effect.flatMap(attemptOnce(attempt, feedback), (outcome) =>
        attempt >= config.budget ? Effect.succeed(outcome) : loop(attempt + 1, Option.some(outcome))
      )

    const resumed = resumeFrom(snapshot)
    const last = resumed.attempts >= config.budget
      ? yield* Effect.as(
          Option.isSome(resumed.unrecorded)
            ? toSelf(selfEvent({ type: "xstate.agent.outcome", record: { attempt: resumed.attempts, outcome: resumed.unrecorded.value } }))
            : Effect.void,
          Option.getOrElse(resumed.feedback, () => restartedDuring(resumed.attempts))
        )
      : yield* loop(resumed.attempts + 1, resumed.feedback)

    yield* Ref.set(settled, true)
    // Turns used: a restored count above a budget that a redeploy lowered is more than the budget
    const attempts = Math.max(resumed.attempts, config.budget)
    yield* toSelf(selfEvent({ type: "xstate.agent.unsettled", unsettled: { reason: last.reason, attempts } }))
  })

/**
 * Where a snapshot resumes: the attempts it started, the feedback for the next attempt, and an
 * outcome to record for a started attempt that recorded none (the process stopped during it,
 * so it counts as `crashed`; attempts are never given back).
 */
const resumeFrom = (snapshot: AgentSnapshot) => {
  const recordedLast = Option.filter(snapshot.last, (record) => record.attempt === snapshot.attempts)
  const unrecorded = snapshot.attempts > 0 && Option.isNone(recordedLast)
    ? Option.some(restartedDuring(snapshot.attempts))
    : Option.none<TurnOutcome>()
  return {
    attempts: snapshot.attempts,
    unrecorded,
    feedback: Option.orElse(
      Option.map(recordedLast, (record) => record.outcome),
      () => unrecorded
    ),
  }
}

/**
 * Runs one attempt of `turn` with its own `AgentTurn` capability, under the deadline, and
 * classifies it. The deadline closes the attempt first and then interrupts the turn, which
 * cancels the request in flight (CONC-3); a call at or after the deadline instant is refused
 * by the clock, whatever order the fibers run in. A crash or an overrun is the outcome; else
 * the first outcome a call recorded; else `silent`.
 */
const runAttempt = <TInput, R>(
  config: LoopConfig<TInput, R>,
  actorScope: ActorScopeService,
  scope: Scope.Scope,
  settled: Ref.Ref<boolean>,
  input: TInput,
  attempt: number,
  feedback: Option.Option<TurnOutcome>
): Effect.Effect<TurnOutcome, never, Exclude<R, AgentTurn>> =>
  Effect.gen(function* () {
    const state = yield* Ref.make<AttemptState>({ open: true, closedBy: "stale", delivery: Option.none(), recorded: Option.none() })
    const due = (yield* Clock.currentTimeMillis) + config.deadline

    const withOutcome = (current: AttemptState, outcome: TurnOutcome): AttemptState => ({
      ...current,
      recorded: Option.orElse(current.recorded, () => Option.some(outcome)),
    })

    const record = (outcome: TurnOutcome) => Ref.update(state, (current) => withOutcome(current, outcome))

    // The delivery runs in the actor's scope, so an interrupted turn does not cut it short; a
    // move stops the actor, whose scope then interrupts the delivery and the turn. Its own
    // bookkeeping runs whatever happens to the caller: a turn may time out its own call, and an
    // attempt classifies only after the delivery ends. The fiber starts uninterruptible, so an
    // interrupt that arrives before its body starts cannot skip that bookkeeping
    const startDelivery = (type: string, event: EventObject, finished: Deferred.Deferred<void>) =>
      Option.match(actorScope.self._parent, {
        onNone: () => Effect.void,
        onSome: (parent) => deliverAndWait(actorScope, parent, event),
      }).pipe(
        Effect.interruptible,
        Effect.onExit((exit) =>
          Effect.andThen(
            Ref.update(state, (current) => ({
              ...(Exit.isSuccess(exit) ? withOutcome(current, { reason: "illegal", event: type }) : current),
              delivery: Option.none(),
            })),
            Deferred.done(finished, Exit.void)
          )
        ),
        Effect.forkIn(scope, { uninterruptible: true })
      )

    const refuse = (event: AgentToolCall, reason: "stale" | "overdue") =>
      Effect.map(Ref.get(settled), (done): TransitionReply => ({
        status: "refused",
        event: event.type,
        reason: done ? "settled" : reason,
      }))

    const transition = (event: AgentToolCall): Effect.Effect<TransitionReply> =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const decoded = decodeCall(config.decoders, event)
        const finished = yield* Deferred.make<void>()
        // One step: a claim that an interrupt split from its fork would stay claimed for ever
        const claim = yield* Effect.uninterruptible(
          Effect.flatMap(
            Ref.modify(state, (current): readonly [Claim, AttemptState] => {
              if (!current.open) return [{ kind: "refused", reason: current.closedBy }, current]
              if (now >= due) return [{ kind: "refused", reason: "overdue" }, current]
              if (Option.isSome(current.delivery)) return [{ kind: "busy" }, current]
              if (decoded.kind !== "go") return [decoded, current]
              return [decoded, { ...current, delivery: Option.some(finished) }]
            }),
            (claimed): Effect.Effect<Started> =>
              claimed.kind === "go"
                ? Effect.map(startDelivery(event.type, claimed.event, finished), (delivery) => ({ kind: "started", delivery }))
                : Effect.succeed(claimed)
          )
        )
        if (claim.kind === "refused") return yield* refuse(event, claim.reason)
        if (claim.kind === "busy" || claim.kind === "unknown") {
          yield* record({ reason: "illegal", event: event.type })
          return { status: "illegal", event: event.type, delivered: false }
        }
        if (claim.kind === "malformed") {
          yield* record({ reason: "malformed", event: event.type, detail: claim.detail })
          return { status: "malformed", event: event.type, detail: claim.detail }
        }
        yield* Fiber.join(claim.delivery)
        return { status: "illegal", event: event.type, delivered: true }
      })

    const service: AgentTurnService = {
      [AgentTurnTypeId]: AgentTurnTypeId,
      attempt,
      transition,
      malformed: (event, detail) =>
        Ref.update(state, (current) =>
          current.open && Option.isNone(current.delivery) ? withOutcome(current, { reason: "malformed", event, detail }) : current
        ),
    }

    const turnFiber = yield* Effect.suspend(() => config.turn(input, attempt, feedback, service)).pipe(
      Effect.provideService(AgentTurn, service),
      Effect.forkIn(scope)
    )
    const ended = yield* Effect.timeoutOption(Fiber.await(turnFiber), Duration.millis(config.deadline))
    const closedBy: AttemptState["closedBy"] = Option.isNone(ended) ? "overdue" : "stale"
    yield* Ref.update(state, (current) => ({ ...current, open: false, closedBy }))
    if (Option.isNone(ended)) yield* Fiber.interrupt(turnFiber)
    // A delivery claimed before the close finishes before the attempt is classified
    const claimed = (yield* Ref.get(state)).delivery
    if (Option.isSome(claimed)) yield* Deferred.await(claimed.value)

    const recorded = (yield* Ref.get(state)).recorded
    if (Option.isNone(ended)) return { reason: "overdue", deadline: config.deadline }
    if (Exit.isFailure(ended.value)) return { reason: "crashed", detail: yield* describeDefect(ended.value.cause) }
    return Option.getOrElse(recorded, (): TurnOutcome => ({ reason: "silent" }))
  })

// ============================================================
// PERSISTENCE
// ============================================================

/**
 * A number a turn loop counts or times with. A persisted value is untrusted: `NaN` passes
 * `Schema.Number` and never reaches a budget, so the numbers of a snapshot decode through this.
 */
const PositiveSafeInteger = Schema.Natural.check(Schema.isGreaterThanOrEqualTo(1))

/** The persisted form of a {@link TurnOutcome}. */
const TurnOutcomeCodec = Schema.Union([
  Schema.Struct({ reason: Schema.Literal("silent") }),
  Schema.Struct({ reason: Schema.Literal("illegal"), event: Schema.String }),
  Schema.Struct({ reason: Schema.Literal("malformed"), event: Schema.String, detail: Schema.String }),
  Schema.Struct({ reason: Schema.Literal("crashed"), detail: Schema.String }),
  Schema.Struct({ reason: Schema.Literal("overdue"), deadline: PositiveSafeInteger }),
]).annotate({ identifier: "TurnOutcome" })

/** The persisted form of the `Unsettled` output, which `Persistence` keeps as an opaque value. */
const UnsettledCodec = Schema.Struct({
  reason: Schema.Literals(["silent", "illegal", "malformed", "crashed", "overdue"]),
  attempts: Schema.Natural,
}).annotate({ identifier: "Unsettled" })

/**
 * The agent fields of a persisted agent snapshot, beside the fields every logic persists.
 * `attempts` is 0 before the first turn, and `last.attempt` counts from 1. A count above the
 * budget stays valid: a redeploy may lower the budget.
 */
const AgentFieldsCodec = Schema.Struct({
  attempts: Schema.Natural,
  last: Schema.NullOr(Schema.Struct({ attempt: PositiveSafeInteger, outcome: TurnOutcomeCodec })),
  output: Schema.optional(Schema.NullOr(UnsettledCodec)),
}).annotate({ identifier: "AgentFields" })

/** Decodes the agent fields of an untrusted persisted value, as `RestoreError` on an issue. */
const decodeAgentFields = (persisted: unknown) =>
  Effect.mapError(
    Schema.decodeUnknownEffect(AgentFieldsCodec)(persisted),
    (error) => new RestoreError({ message: error.message, cause: error })
  )

// ============================================================
// FROM AGENT
// ============================================================

/**
 * Creates agent logic: the logic of one model call that must move its invoking state.
 *
 * - `tools` is the agent's menu: event Schemas keyed by event type. A setup machine refuses an
 *   invocation whose agent has a tool its state does not accept, and a state that accepts no
 *   event cannot invoke an agent (S21). `turn`'s fourth argument takes only these tools.
 * - Each call is decoded once, at the agent boundary: a payload that fails its tool's Schema is
 *   `malformed` (the reply and the feedback hold the issues), a type that is no tool is
 *   `illegal` and never delivered, and the machine receives the decoded event.
 * - `budget` and `deadline` must be positive integer literals; wide `number`, a union, zero, a
 *   negative or fractional value, `1e21`, a branded or generic number fail to compile at the
 *   field (NEG-5). A cast or plain JavaScript passes the types: a value that is no positive
 *   safe integer then dies with `AgentRunError` before any turn runs.
 * - Each attempt writes its count ahead (the snapshot's `attempts`, and the emitted `attempt`
 *   event), then runs `turn(input, attempt, feedback)` with the `AgentTurn` capability.
 * - A transition delivered through `AgentTurn.transition` waits for the machine's macrostep. A
 *   move exits the invoking state, which stops the agent: no further prompt, no output
 *   (S5, CONC-1, TS-117). Only the first transition of a turn is delivered while it is in
 *   flight; a later one is illegal (S22).
 * - An attempt that moves nothing is `silent`, `illegal`, `malformed`, `crashed` (a defect, or
 *   a throw before `turn` returns an Effect) or `overdue` (the deadline interrupts the turn and
 *   refuses every later call). The next attempt gets that outcome as feedback (S3, S4, S20).
 * - When the budget is spent the agent is done with `Unsettled { reason, attempts }`, the last
 *   outcome as reason. The error channel is `never`: no `xstate.error.actor.*` is ever sent.
 * - A call through an earlier attempt's capability, or after `Unsettled`, is refused and does
 *   not reach the machine (CONC-2).
 * - The persisted snapshot carries the attempts, so a restore resumes after them; an attempt
 *   the process left unfinished counts as `crashed`.
 *
 * @example
 * ```ts
 * const reporter = fromAgent({
 *   budget: 3,
 *   deadline: 60_000,
 *   tools: { SUBMITTED: Schema.Struct({ type: Schema.Literal("SUBMITTED"), summary: Schema.String }) },
 *   turn: (input: { prompt: string }, attempt, feedback, agent) =>
 *     Effect.gen(function* () {
 *       const reply = yield* model.ask(input.prompt, feedback)
 *       if (reply.tool === "SUBMITTED") yield* agent.transition({ type: "SUBMITTED", ...reply.payload })
 *     })
 * })
 * ```
 *
 * @since 0.4.0
 * @category Agent
 */
export const fromAgent = <const TBudget extends number, const TDeadline extends number, TInput, const TTools extends AgentTools, R = never>(
  config: AgentConfig<TBudget, TDeadline, TInput, R, TTools>
): AgentActorLogic<TInput, Exclude<R, AgentTurn>, TTools> => {
  const loopConfig: LoopConfig<TInput, R> = {
    budget: config.budget,
    deadline: config.deadline,
    decoders: HashMap.fromIterable(Object.entries(config.tools).map(([type, schema]) => [type, Schema.decodeUnknownResult(schema)] as const)),
    turn: config.turn,
  }
  // The run-time half of NEG-5, for a cast or plain JavaScript: no snapshot, so no turn
  const literals = Effect.andThen(checkLiteral("budget", config.budget), checkLiteral("deadline", config.deadline))
  const logic: AgentLogicMethods<TInput, Exclude<R, AgentTurn>> & AgentToolsOf<TTools> = {
    [ActorLogicTypeId]: variance<TInput, Exclude<R, AgentTurn>>(),

    config,

    tools: config.tools,

    // A new function per logic: the brand marker sits on it (markAgentLogic)
    transition: (snapshot, event, capability) => runtimeOnly(capability, () => Effect.succeed(step(snapshot, event))),

    getInitialSnapshot: (input) =>
      Effect.as(literals, {
        [Snap.SnapshotTypeId]: Snap.SnapshotTypeId,
        status: "active",
        output: Option.none<Unsettled>(),
        error: Option.none(),
        input,
        attempts: 0,
        last: Option.none<AttemptRecord>(),
      } satisfies AgentSnapshot<TInput>),

    // `turn` gets `AgentTurn` from the loop, so the loop needs only what `turn` needs besides it
    start: (snapshot, capability) =>
      runtimeOnly(capability, () =>
        snapshot.status === "active"
          ? Effect.andThen(literals, Effect.asVoid(Effect.forkScoped(runLoop(loopConfig, snapshot), { startImmediately: true })))
          : Effect.void
      ),

    getPersistedSnapshot: (snapshot, capability) =>
      runtimeOnly(capability, () =>
        Effect.map(Persistence.persistLogicSnapshot(snapshot), (persisted) => ({
          ...persisted,
          attempts: snapshot.attempts,
          last: Option.getOrNull(snapshot.last),
        }))
      ),

    restoreSnapshot: (persisted, capability) =>
      runtimeOnly(capability, () =>
        Effect.gen(function* () {
          yield* literals
          const base = yield* Persistence.restoreLogicSnapshot<Unsettled, TInput>(persisted)
          const fields = yield* decodeAgentFields(persisted)
          return { ...base, attempts: fields.attempts, last: Option.fromNullishOr(fields.last) }
        })
      ),
  }
  // Frozen: a replaced method on this object would receive the capability from the runtime
  return grantLogicCapability(Object.freeze(markAgentLogic(logic)))
}

/**
 * The refusal of a `budget` or `deadline` that is no positive safe integer. The type refuses it
 * at the field (NEG-5); a cast or plain JavaScript passes that, and `NaN` or `Infinity` would
 * then run an unbounded loop. `fromAgent` is sync and fails nowhere, so each Effect that gives
 * the loop a snapshot, and `start`, dies with this, as a cast past the types does elsewhere.
 * The Schema reads any value safely, so the message of a hostile one cannot throw.
 */
const checkLiteral = (field: string, value: unknown): Effect.Effect<void> =>
  Effect.catch(
    Effect.asVoid(Schema.decodeUnknownEffect(PositiveSafeInteger)(value)),
    (error) => Effect.die(new AgentRunError({ message: `fromAgent: ${field} must be a positive safe integer: ${error.message}` }))
  )

/**
 * Runs `method` for the holder of the runtime's capability. Any other caller gets a defect, not
 * a value of `E`, whatever static type it reached the method through (NEG-4): a cast past the
 * capability is a programming error, as with the same cast at `createActor`.
 */
const runtimeOnly = <A, E, R>(capability: LogicCapability, method: () => Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  isLogicCapability(capability) ? method() : Effect.die(new AgentRunError({ message: runtimeOnlyMessage }))

/** The message of the {@link AgentRunError} a call without the capability gets. */
const runtimeOnlyMessage = "Agent logic's own methods run only inside the actor runtime, as a machine's invocation"

/** The type-level variance markers of agent logic; no code reads them. */
const variance = <TInput, R>(): Variance.ActorLogic<AgentSnapshot<TInput>, EventObject, TInput, AgentAttemptEvent, R> => ({
  _Snapshot: (_: AgentSnapshot<TInput>): AgentSnapshot<TInput> => _,
  _Event: (_: EventObject): EventObject => _,
  _Input: (_: TInput) => _,
  _Emitted: (_: never): AgentAttemptEvent => _,
  _R: (_: never): R => _,
})
