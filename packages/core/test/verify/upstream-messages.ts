/**
 * The recorded xstate@5.33.2 messages and the throw-site table (SD-3, INV-1).
 *
 * Each builder or constant below reproduces one upstream message template exactly, read
 * from the clone `packages/core/.upstream/xstate-5.33.2/packages/core/src` at tag commit
 * fbee62e7c1586315ed478c2fedf530d7e0ff5a3e. Upstream rewrites and scenario tests import
 * these texts instead of copying them, so "the recorded message" has one source.
 *
 * `throwSites` maps every throw, rethrow and console site that the frozen manifest
 * (`test/upstream/upstream-manifest.json`, `sourceSites`) records to the one channel the port
 * uses for it. Each entry keeps the upstream template text (`source`), and, for a site with a
 * message, one sample: the values that fill the template's `${...}` holes in order and the
 * text that the builder gives for the same values. The INV-1 evidence file compares every
 * entry with the manifest record at the same file and line.
 *
 * An entry names the port operation that reaches the site (`trigger`). A transition-time
 * site that a running actor reaches (`actor-error`) also fails the Effect of the pure
 * transition functions with the same text when they reach it (SD-13); the table lists the
 * actor path, which the rewrites assert.
 *
 * @since 0.1.0
 */

// ---------------------------------------------------------------- channels and entries

/**
 * The error channel of a site in the port.
 *
 * - `sync`: a synchronous throw, only of the plain `Error` of the SCXML converter, which is
 *   test support and throws as upstream's does (D4). No package site throws (SD-3, amended
 *   2026-10-08).
 * - `effect-failure`: the Effect of the port operation fails with the recorded text (SD-3,
 *   SD-13); a defect where the trigger says so. A `createMachine` definition error is kept by
 *   the machine and fails each Effect that computes a snapshot of it: the trigger reads the
 *   machine's initial snapshot, whose `InitializationError` has the recorded text (SD-3,
 *   amended 2026-10-08).
 * - `actor-error`: the actor sets `status: 'error'` and `snapshot.error` holds the error with
 *   the recorded text (SD-4).
 * - `warning`: reported through the actor's logger, with no failure and no status change
 *   (the console sites, and the SD-21 report of an unhandled error).
 *
 * @since 0.1.0
 */
export type Channel = "sync" | "effect-failure" | "actor-error" | "warning"

interface SiteBase {
  /** The upstream file, relative to `packages/core` at the tag. */
  readonly file: string
  /** The 1-based line of the throw or console call at the tag. */
  readonly line: number
  /** The upstream message as the manifest records it: the template text with `${...}` holes. */
  readonly source: string
  readonly channel: Channel
  /** The port operation that reaches the site (the INV-1 trigger, T8.9). */
  readonly trigger: string
}

/**
 * A `throw new Error(...)`, `console.warn(...)` or `console.error(...)` site with its message.
 *
 * @since 0.1.0
 */
export interface MessageSite extends SiteBase {
  readonly kind: "throw" | "console.warn" | "console.error"
  /** The sample values of the `${...}` holes of `source`, in order. */
  readonly holes: ReadonlyArray<string>
  /** The recorded message for the sample, built by the exported builder. */
  readonly message: string
}

/**
 * A bare rethrow (`throw err`): the message is the original error's.
 *
 * @since 0.1.0
 */
export interface RethrowSite extends SiteBase {
  readonly kind: "rethrow"
}

/** @since 0.1.0 */
export type ThrowSite = MessageSite | RethrowSite

/**
 * A Promise rejection with a new `Error` (not a throw site, so not in the manifest).
 *
 * @since 0.1.0
 */
export interface RejectionSite extends SiteBase {
  readonly kind: "reject"
  readonly holes: ReadonlyArray<string>
  readonly message: string
}

// ---------------------------------------------------------------- guards

/** `src/guards.ts:356` — a named guard with no implementation (the stray `'.` is upstream's). */
export const guardNotImplemented = (guardType: string): string => `Guard '${guardType}' is not implemented.'.`

/**
 * `src/StateNode.ts:459` — a guard that throws while a transition is selected. Pass `""` as
 * `guardType` for an inline function guard, which has no type.
 */
export const guardEvaluationFailed = (
  guardType: string,
  eventType: string,
  stateNodeId: string,
  message: string
): string =>
  `Unable to evaluate guard ${
    guardType ? `'${guardType}' ` : ""
  }in transition for event '${eventType}' in state node '${stateNodeId}':\n${message}`

/** The stub of a built-in action or guard function that user code calls directly. */
export const notSupposedToBeCalled = "This isn't supposed to be called"

// ---------------------------------------------------------------- definition (createMachine)

/** `src/StateNode.ts:217` — a compound state node without `initial`. */
export const noInitialState = (stateNodeId: string, firstChildKey: string): string =>
  `No initial state specified for compound state node "#${stateNodeId}". Try adding { initial: "${firstChildKey}" } to the state config.`

/** `src/stateUtils.ts:293` — a transition that declares the v4 `cond`. */
export const legacyCond = (stateNodeId: string): string =>
  `State "${stateNodeId}" has declared \`cond\` for one of its transitions. This property has been renamed to \`guard\`. Please update your code.`

/** `src/stateUtils.ts:329` — the empty event key in `on`. */
export const nullEventKey = 'Null events ("") cannot be specified as a transition key. Use `always: { ... }` instead.'

/** `src/stateUtils.ts:453` — an `initial` key that names no child. */
export const initialStateNotFound = (target: string, stateNodeId: string): string =>
  `Initial state node "${target}" not found on parent state node #${stateNodeId}`

/** `src/stateUtils.ts:512` — a sibling target that does not resolve; wraps the lookup message. */
export const invalidTransitionDefinition = (stateNodeId: string, message: string): string =>
  `Invalid transition definition for state node '${stateNodeId}':\n${message}`

/** `src/stateUtils.ts:517` — a root transition target without the leading dot. */
export const invalidTargetFromRoot = (target: string): string =>
  `Invalid target: "${target}" is not a valid target from the root node. Did you mean ".${target}"?`

/** `src/StateMachine.ts:525` — a `#id` that names no state node. */
export const childStateNodeDoesNotExist = (stateId: string, machineId: string): string =>
  `Child state node '#${stateId}' does not exist on machine '${machineId}'`

/** `src/stateUtils.ts:587` — a child lookup on a node without a `states` map. */
export const noChildStates = (stateKey: string, stateNodeId: string): string =>
  `Unable to retrieve child state '${stateKey}' from '${stateNodeId}'; no child states exist.`

/** `src/stateUtils.ts:593` — a child key that names no child. */
export const childStateDoesNotExist = (stateKey: string, stateNodeId: string): string =>
  `Child state '${stateKey}' does not exist on '${stateNodeId}'`

/** `src/stateUtils.ts:641` — a state value that names no state (`machine.resolveState`). */
export const stateDoesNotExist = (stateValue: string, stateNodeId: string): string =>
  `State '${stateValue}' does not exist on '${stateNodeId}'`

// ---------------------------------------------------------------- runtime (macrostep, actions, actors)

/** `src/stateUtils.ts:1764` — a macrostep that exceeds the machine's `maxIterations`. */
export const infiniteLoop = (maxIterations: number): string =>
  `Infinite loop detected: the machine has processed more than ${maxIterations} microsteps without reaching a stable state. This usually happens when there's a cycle of transitions (e.g., eventless transitions or raised events causing state A -> B -> C -> A).`

/** `src/stateUtils.ts:1685` — an event whose type is the wildcard `*`. */
export const wildcardEventType = "An event cannot have the wildcard type ('*')"

/** `src/actions/assign.ts:45` — `assign` in a machine without `context`. */
export const assignToUndefinedContext =
  "Cannot assign to undefined `context`. Ensure that `context` is defined in the machine config."

/** `src/actions/raise.ts:56` — `raise` with a string event. */
export const onlyEventObjectsRaise = (eventType: string): string =>
  `Only event objects may be used with raise; use raise({ type: "${eventType}" }) instead`

/** `src/actions/send.ts:72` — `sendTo` with a string event. */
export const onlyEventObjectsSendTo = (eventType: string): string =>
  `Only event objects may be used with sendTo; use sendTo({ type: "${eventType}" }) instead`

/** `src/createActor.ts:759` — `actor.send` with a string event. */
export const onlyEventObjectsSend = (eventType: string): string =>
  `Only event objects may be sent to actors; use .send({ type: "${eventType}" }) instead`

/** `src/actions/send.ts:115` — `sendTo` with a target that names no actor. */
export const unableToSend = (target: string, machineId: string): string =>
  `Unable to send event to actor '${target}' from machine '${machineId}'.`

/** `src/actions/send.ts:367` — `forwardTo` with a target that resolves to nothing. */
export const forwardToUndefinedActor =
  "Attempted to forward event to undefined actor. This risks an infinite loop in the sender."

/**
 * `src/actions/{assign,emit,raise,send}.ts` — the warning when a custom action calls a
 * built-in action creator.
 */
export const builtInCalledInCustomAction = (name: "assign" | "emit" | "raise" | "sendTo"): string =>
  `Custom actions should not call \`${name}()\` directly, as it is not imperative. See https://stately.ai/docs/actions#built-in-actions for more details.`

/** `src/spawn.ts:94` — `spawn` with a `src` that names no actor implementation. */
export const actorLogicNotImplemented = (src: string, machineId: string): string =>
  `Actor logic '${src}' not implemented in machine '${machineId}'`

/** `src/actions/spawnChild.ts:80` — the warning for `spawnChild` with an unknown `src`. */
export const actorTypeNotFound = (src: string, actorId: string): string =>
  `Actor type '${src}' not found in machine '${actorId}'.`

/** `src/system.ts:198` — a second actor registered under a `systemId` in use. */
export const duplicateSystemId = (systemId: string): string => `Actor with system ID '${systemId}' already exists.`

/** `src/createActor.ts:190` — `stopChild` of an actor that is not a child. */
export const notAChild = (childId: string, actorId: string): string =>
  `Cannot stop child actor ${childId} of ${actorId} because it is not a child`

/** `src/createActor.ts:651` — `stop` called on a child actor. */
export const nonRootStop = "A non-root actor cannot be stopped directly."

/** `src/createActor.ts:820` — a snapshot read while the actor computes its initial snapshot. */
export const snapshotReadDuringInit = "Snapshot can't be read while the actor initializes itself"

/** The upstream `JSON.stringify` with its `String` fallback for an event that cannot be serialized. */
const eventString = (event: unknown): string => {
  try {
    return JSON.stringify(event)
  } catch {
    return String(event)
  }
}

/** `src/createActor.ts:742` — the warning for an event sent to a stopped actor. */
export const eventSentToStoppedActor = (
  event: { readonly type: string },
  actorId: string,
  sessionId: string
): string =>
  `Event "${event.type}" was sent to stopped actor "${actorId} (${sessionId})". This actor has already reached its final state, and will not transition.\nEvent: ${
    eventString(event)
  }`

/** `src/assert.ts:45` — `assertEvent` with an event that matches none of the types. */
export const expectedEventType = (event: unknown, types: ReadonlyArray<string>): string => {
  const typesText = types.length === 1
    ? `type matching "${types[0]}"`
    : `one of types matching "${types.join('", "')}"`
  return `Expected event ${JSON.stringify(event)} to have ${typesText}`
}

// ---------------------------------------------------------------- warnings

/** `src/State.ts:310` — `snapshot.can` on a snapshot without its machine. */
export const canOutsideMachine =
  "state.can(...) used outside of a machine-created State object; this will always return false."

/** `src/StateMachine.ts:180` — a top-level final state with `output` and no machine `output`. */
export const missingMachineOutput =
  "Missing `machine.output` declaration (top-level final state with output detected)"

/** `src/StateMachine.ts:641` — a persisted history value that names no state node. */
export const unresolvedHistoryStateNode = (id: string): string => `Could not resolve StateNode for id: ${id}`

/** `src/dev/index.ts:35` — no global object for the dev tools hook. */
export const noGlobalObject =
  "XState could not find a global object in this environment. Please let the maintainers know and raise an issue here: https://github.com/statelyai/xstate/issues"

/** `src/utils.ts:179` — an `output` mapper object with function-valued properties (upstream checks no `input` mapper). */
export const dynamicMappingDeprecated = (mapper: Readonly<Record<string, unknown>>): string =>
  `Dynamically mapping values to individual properties is deprecated. Use a single function that returns the mapped object instead.\nFound object containing properties whose values are possibly mapping functions: ${
    Object.entries(mapper)
      .filter(([, value]) => typeof value === "function")
      .map(([key, value]) => `\n - ${key}: ${(value as { toString(): string }).toString().replace(/\n\s*/g, "")}`)
      .join("")
  }`

/** `src/utils.ts:314` — a wildcard that is not the last token of an event descriptor. */
export const wildcardNotLast = (descriptor: string): string =>
  `Wildcards can only be the last token of an event descriptor (e.g., "event.*") or the entire event descriptor ("*"). Check the "${descriptor}" event.`

/** `src/utils.ts:334` — an infix wildcard in a transition descriptor. */
export const infixWildcard = (descriptor: string): string =>
  `Infix wildcards in transition events are not allowed. Check the "${descriptor}" transition.`

/** `src/waitFor.ts:60` — `waitFor` with a negative `timeout` (upstream `console.error`). */
export const negativeWaitForTimeout =
  "`timeout` passed to `waitFor` is negative and it will reject its internal promise immediately."

// ---------------------------------------------------------------- waitFor rejections

/** `src/waitFor.ts:69` — `waitFor` whose `timeout` elapses first. */
export const waitForTimeout = (timeout: number): string => `Timeout of ${timeout} ms exceeded`

/** `src/waitFor.ts:122` — `waitFor` on an actor that completes before the predicate holds. */
export const actorTerminatedWithoutPredicate = "Actor terminated without satisfying predicate"

// ---------------------------------------------------------------- SimulatedClock, persistence

/** `src/SimulatedClock.ts:44` — `SimulatedClock.set` to an earlier time. */
export const unableToTravelBackInTime = "Unable to travel back in time"

/** `src/State.ts:464` — persisting a snapshot with an inline (non-string `src`) child. */
export const inlineChildCannotBePersisted = "An inline child actor cannot be persisted."

// ---------------------------------------------------------------- graph

/** `src/graph/adjacency.ts:63` — a traversal that exceeds its `limit`. */
export const traversalLimitExceeded = "Traversal limit exceeded"

/** `src/graph/graph.ts:227` — `joinPaths` with a tail that does not start at the head's end. */
export const pathsCannotBeJoined = "Paths cannot be joined"

/** `src/graph/pathFromEvents.ts:93` — an event the reached state does not accept. */
export const invalidGraphTransition = (stateSerial: string, eventSerial: string): string =>
  `Invalid transition from ${stateSerial} with ${eventSerial}`

/** `src/graph/validateMachine.ts:5` — `createTestModel` with an invoke. */
export const testModelInvocations = "Invocations on test machines are not supported"

/** `src/graph/validateMachine.ts:8` — `createTestModel` with an `after` transition. */
export const testModelAfter = "After events on test machines are not supported"

/** `src/graph/validateMachine.ts:24` — `createTestModel` with a delayed inline action. */
export const testModelDelayedActions = "Delayed actions on test machines are not supported"

// ---------------------------------------------------------------- SCXML converter

/** `src/scxml.ts:118` and `:124` — a delay the converter cannot parse. */
export const scxmlDelayUnparsable = (delay: string): string => `Can't parse "${delay} delay."`

/** `src/scxml.ts:230` — `<content/>` inside `<send/>`. */
export const scxmlSendContent = "Conversion of <content/> inside <send/> not implemented."

/** `src/scxml.ts:337` — an executable element the converter does not know. */
export const scxmlElementNotImplemented = (name: string): string =>
  `Conversion of "${name}" elements is not implemented yet.`

/** `src/scxml.ts:517` — an `<invoke>` whose type is not SCXML. */
export const scxmlInvokeType = "Currently only converting invoke elements of type SCXML is supported."

/** `src/scxml.ts:534` — more than one initial state. */
export const scxmlMultipleInitial = (initial: string): string =>
  `Multiple initial states are not supported ("${initial}").`

/** `src/scxml.ts:580` — a `src` attribute on a datamodel `<data>` element. */
export const scxmlDataSrc = "Conversion of `src` attribute on datamodel's <data> elements is not supported."

// ---------------------------------------------------------------- the table

/** One of the thirteen stubs whose upstream text is "This isn't supposed to be called". */
const STUB = (file: string, line: number, creator: string): ThrowSite => ({
  file,
  line,
  kind: "throw",
  source: "This isn't supposed to be called",
  channel: "actor-error",
  trigger: `user code calls the function that \`${creator}(...)\` returns, instead of passing it as an action or guard (SD-4)`,
  holes: [],
  message: notSupposedToBeCalled
})

/** A function whose source text is fixed, for the `dynamicMappingDeprecated` sample. */
const MAPPING_FUNCTION = Object.assign(() => 0, { toString: () => "({ context }) =>\n  context.count" })

/**
 * Every throw, rethrow and console site of xstate@5.33.2 `packages/core/src`, in manifest
 * order (file, then line), with its channel in the port. A site that several port operations
 * reach on one channel has one entry, whose trigger names each of them (SD-3, amended
 * 2026-10-08: a `createMachine` definition error, `machine.resolveState`,
 * `machine.getStateNodeById` and the root `getStateNodes` all fail Effects).
 * `src/stateUtils.ts:593` and `:641` have a second entry because a restore reaches them too:
 * `createActor` with a persisted snapshot whose state value names no state errors the actor
 * (`actor-error`, a `RestoreError`), as upstream `_initState` turns the restore's throw into
 * status `error` (SD-7, SD-8).
 *
 * @since 0.1.0
 */
export const throwSites: ReadonlyArray<ThrowSite> = [
  {
    file: "src/SimulatedClock.ts",
    line: 44,
    kind: "throw",
    source: "Unable to travel back in time",
    channel: "effect-failure",
    trigger: "`SimulatedClock.set` to a time before the clock's `now` (SD-28)",
    holes: [],
    message: unableToTravelBackInTime
  },
  {
    file: "src/State.ts",
    line: 310,
    kind: "console.warn",
    source: "state.can(...) used outside of a machine-created State object; this will always return false.",
    channel: "warning",
    trigger: "`snapshot.can` on a snapshot object that does not carry its machine (SD-6)",
    holes: [],
    message: canOutsideMachine
  },
  {
    file: "src/State.ts",
    line: 464,
    kind: "throw",
    source: "An inline child actor cannot be persisted.",
    channel: "effect-failure",
    trigger: "`getPersistedSnapshot` of an actor that has an inline-spawned child (SD-7)",
    holes: [],
    message: inlineChildCannotBePersisted
  },
  {
    file: "src/StateMachine.ts",
    line: 180,
    kind: "console.warn",
    source: "Missing `machine.output` declaration (top-level final state with output detected)",
    channel: "warning",
    trigger: "`createMachine` with a top-level final state that has `output` and no machine `output`",
    holes: [],
    message: missingMachineOutput
  },
  {
    file: "src/StateMachine.ts",
    line: 525,
    kind: "throw",
    source: "Child state node '#${resolvedStateId}' does not exist on machine '${this.id}'",
    channel: "effect-failure",
    trigger:
      "`createMachine` with a transition target `#id` that names no state node (the machine keeps the definition error, and its initial snapshot fails with it (SD-3, amended 2026-10-08)), and `machine.getStateNodeById` with an id that names no state node (SD-3)",
    holes: ["missing", "(machine)"],
    message: childStateNodeDoesNotExist("missing", "(machine)")
  },
  {
    file: "src/StateMachine.ts",
    line: 641,
    kind: "console.warn",
    source: "Could not resolve StateNode for id: ${referenced.id}",
    channel: "warning",
    trigger: "restoring a persisted snapshot whose `historyValue` names an unknown state node id",
    holes: ["nonexistent"],
    message: unresolvedHistoryStateNode("nonexistent")
  },
  {
    file: "src/StateNode.ts",
    line: 217,
    kind: "throw",
    source:
      "No initial state specified for compound state node \"#${this.id}\". Try adding { initial: \"${Object.keys(this.states)[0]}\" } to the state config.",
    channel: "effect-failure",
    trigger: "`createMachine` with a compound state node that has no `initial`: the machine keeps the definition error, and its initial snapshot fails with it (SD-3, amended 2026-10-08)",
    holes: ["(machine).a", "b"],
    message: noInitialState("(machine).a", "b")
  },
  {
    file: "src/StateNode.ts",
    line: 459,
    kind: "throw",
    source:
      "Unable to evaluate guard ${guardType ? `'${guardType}' ` : ''}in transition for event '${eventType}' in state node '${this.id}':\n${err.message}",
    channel: "actor-error",
    trigger: "a guard that throws or is not implemented, while a running actor selects a transition (SD-4)",
    holes: ["'doesNotExist' ", "BAD_COND", "(machine).foo", "Guard 'doesNotExist' is not implemented.'."],
    message: guardEvaluationFailed("doesNotExist", "BAD_COND", "(machine).foo", guardNotImplemented("doesNotExist"))
  },
  {
    file: "src/actions/assign.ts",
    line: 45,
    kind: "throw",
    source: "Cannot assign to undefined `context`. Ensure that `context` is defined in the machine config.",
    channel: "actor-error",
    trigger: "`assign` in a machine that has no `context`",
    holes: [],
    message: assignToUndefinedContext
  },
  {
    file: "src/actions/assign.ts",
    line: 166,
    kind: "console.warn",
    source:
      "Custom actions should not call `assign()` directly, as it is not imperative. See https://stately.ai/docs/actions#built-in-actions for more details.",
    channel: "warning",
    trigger: "a custom action that calls `assign(...)`",
    holes: [],
    message: builtInCalledInCustomAction("assign")
  },
  STUB("src/actions/assign.ts", 176, "assign"),
  STUB("src/actions/cancel.ts", 96, "cancel"),
  {
    file: "src/actions/emit.ts",
    line: 130,
    kind: "console.warn",
    source:
      "Custom actions should not call `emit()` directly, as it is not imperative. See https://stately.ai/docs/actions#built-in-actions for more details.",
    channel: "warning",
    trigger: "a custom action that calls `emit(...)`",
    holes: [],
    message: builtInCalledInCustomAction("emit")
  },
  STUB("src/actions/emit.ts", 140, "emit"),
  STUB("src/actions/enqueueActions.ts", 319, "enqueueActions"),
  STUB("src/actions/log.ts", 90, "log"),
  {
    file: "src/actions/raise.ts",
    line: 56,
    kind: "throw",
    source: "Only event objects may be used with raise; use raise({ type: \"${eventOrExpr}\" }) instead",
    channel: "actor-error",
    trigger: "`raise` with a string event (the type system rejects it; reached through a cast)",
    holes: ["a string"],
    message: onlyEventObjectsRaise("a string")
  },
  {
    file: "src/actions/raise.ts",
    line: 157,
    kind: "console.warn",
    source:
      "Custom actions should not call `raise()` directly, as it is not imperative. See https://stately.ai/docs/actions#built-in-actions for more details.",
    channel: "warning",
    trigger: "a custom action that calls `raise(...)`",
    holes: [],
    message: builtInCalledInCustomAction("raise")
  },
  STUB("src/actions/raise.ts", 167, "raise"),
  {
    file: "src/actions/send.ts",
    line: 72,
    kind: "throw",
    source: "Only event objects may be used with sendTo; use sendTo({ type: \"${eventOrExpr}\" }) instead",
    channel: "actor-error",
    trigger: "`sendTo` with a string event (its type takes one for a target given by name or as an untyped reference, as upstream's `any` does)",
    holes: ["a string"],
    message: onlyEventObjectsSendTo("a string")
  },
  {
    file: "src/actions/send.ts",
    line: 115,
    kind: "throw",
    source: "Unable to send event to actor '${resolvedTarget}' from machine '${snapshot.machine.id}'.",
    channel: "actor-error",
    trigger: "`sendTo` with an actor name that names no child of the sending actor",
    holes: ["child", "parent"],
    message: unableToSend("child", "parent")
  },
  {
    file: "src/actions/send.ts",
    line: 252,
    kind: "console.warn",
    source:
      "Custom actions should not call `sendTo()` directly, as it is not imperative. See https://stately.ai/docs/actions#built-in-actions for more details.",
    channel: "warning",
    trigger: "a custom action that calls `sendTo(...)`",
    holes: [],
    message: builtInCalledInCustomAction("sendTo")
  },
  STUB("src/actions/send.ts", 262, "sendTo"),
  {
    file: "src/actions/send.ts",
    line: 367,
    kind: "throw",
    source: "Attempted to forward event to undefined actor. This risks an infinite loop in the sender.",
    channel: "actor-error",
    trigger: "`forwardTo` with a target that resolves to nothing",
    holes: [],
    message: forwardToUndefinedActor
  },
  {
    file: "src/actions/spawnChild.ts",
    line: 80,
    kind: "console.warn",
    source: "Actor type '${src}' not found in machine '${actorScope.id}'.",
    channel: "warning",
    trigger: "`spawnChild` with a `src` that names no actor implementation",
    holes: ["child", "x:0"],
    message: actorTypeNotFound("child", "x:0")
  },
  STUB("src/actions/spawnChild.ts", 221, "spawnChild"),
  STUB("src/actions/stopChild.ts", 127, "stopChild"),
  {
    file: "src/assert.ts",
    line: 45,
    kind: "throw",
    source: "Expected event ${JSON.stringify(event)} to have ${typesText}",
    channel: "effect-failure",
    trigger: "`assertEvent` with an event that matches none of the given types: its Effect fails (SD-3, amended 2026-10-08)",
    holes: ['{"type":"OTHER"}', 'type matching "FEEDBACK.*"'],
    message: expectedEventType({ type: "OTHER" }, ["FEEDBACK.*"])
  },
  {
    file: "src/createActor.ts",
    line: 190,
    kind: "throw",
    source: "Cannot stop child actor ${child.id} of ${this.id} because it is not a child",
    channel: "actor-error",
    trigger: "`stopChild` of an actor that is not a child of the stopping actor",
    holes: ["other", "parent"],
    message: notAChild("other", "parent")
  },
  {
    file: "src/createActor.ts",
    line: 651,
    kind: "throw",
    source: "A non-root actor cannot be stopped directly.",
    channel: "effect-failure",
    trigger:
      "`stop` of an actor that has a parent (a non-root actor): a defect of the stop Effect, whose type has no error channel, and the actor goes on",
    holes: [],
    message: nonRootStop
  },
  {
    file: "src/createActor.ts",
    line: 742,
    kind: "console.warn",
    source:
      "Event \"${event.type}\" was sent to stopped actor \"${this.id} (${this.sessionId})\". This actor has already reached its final state, and will not transition.\nEvent: ${eventString}",
    channel: "warning",
    trigger: "`send` to an actor that is stopped or done",
    holes: ["TIMER", "x:27", "x:27", '{"type":"TIMER"}'],
    message: eventSentToStoppedActor({ type: "TIMER" }, "x:27", "x:27")
  },
  {
    file: "src/createActor.ts",
    line: 759,
    kind: "throw",
    source: "Only event objects may be sent to actors; use .send({ type: \"${event}\" }) instead",
    channel: "effect-failure",
    trigger: "`actor.send` with a string event: a defect of the send Effect, not a typed failure (SD-3)",
    holes: ["EVENT"],
    message: onlyEventObjectsSend("EVENT")
  },
  {
    file: "src/createActor.ts",
    line: 820,
    kind: "throw",
    source: "Snapshot can't be read while the actor initializes itself",
    channel: "actor-error",
    trigger:
      "logic that reads its own actor's snapshot while the actor computes the initial snapshot (status error at creation, as upstream `_initState`)",
    holes: [],
    message: snapshotReadDuringInit
  },
  {
    file: "src/dev/index.ts",
    line: 35,
    kind: "console.warn",
    source:
      "XState could not find a global object in this environment. Please let the maintainers know and raise an issue here: https://github.com/statelyai/xstate/issues",
    channel: "warning",
    trigger: "the dev tools global lookup in an environment with no global object",
    holes: [],
    message: noGlobalObject
  },
  {
    file: "src/graph/TestModel.ts",
    line: 240,
    kind: "rethrow",
    source: "err",
    channel: "effect-failure",
    trigger: "a TestModel path test whose event step fails: the original error, with the path description appended"
  },
  {
    file: "src/graph/TestModel.ts",
    line: 248,
    kind: "rethrow",
    source: "err",
    channel: "effect-failure",
    trigger: "a TestModel path test whose state step fails: the original error, with the path description appended"
  },
  {
    file: "src/graph/TestModel.ts",
    line: 254,
    kind: "rethrow",
    source: "err",
    channel: "effect-failure",
    trigger: "a TestModel path test that fails: the path description is appended to the original error message"
  },
  {
    file: "src/graph/adjacency.ts",
    line: 63,
    kind: "throw",
    source: "Traversal limit exceeded",
    channel: "effect-failure",
    trigger: "a graph traversal that exceeds its `limit` (SD-13)",
    holes: [],
    message: traversalLimitExceeded
  },
  {
    file: "src/graph/graph.ts",
    line: 227,
    kind: "throw",
    source: "Paths cannot be joined",
    channel: "effect-failure",
    trigger: "`joinPaths` with a tail path that does not start where the head path ends (SD-13)",
    holes: [],
    message: pathsCannotBeJoined
  },
  {
    file: "src/graph/pathFromEvents.ts",
    line: 93,
    kind: "throw",
    source: "Invalid transition from ${stateSerial} with ${eventSerial}",
    channel: "effect-failure",
    trigger:
      "`getPathsFromEvents` with an event whose adjacency entry has no next state; an event with no entry at all hits a TypeError upstream first (SD-13)",
    holes: ['{"value":"a"}', '{"type":"NEXT"}'],
    message: invalidGraphTransition('{"value":"a"}', '{"type":"NEXT"}')
  },
  {
    file: "src/graph/validateMachine.ts",
    line: 5,
    kind: "throw",
    source: "Invocations on test machines are not supported",
    channel: "effect-failure",
    trigger: "`createTestModel` with a machine that invokes an actor (SD-13)",
    holes: [],
    message: testModelInvocations
  },
  {
    file: "src/graph/validateMachine.ts",
    line: 8,
    kind: "throw",
    source: "After events on test machines are not supported",
    channel: "effect-failure",
    trigger: "`createTestModel` with a machine that has an `after` transition (SD-13)",
    holes: [],
    message: testModelAfter
  },
  {
    file: "src/graph/validateMachine.ts",
    line: 24,
    kind: "throw",
    source: "Delayed actions on test machines are not supported",
    channel: "effect-failure",
    trigger: "`createTestModel` with a machine that has a delayed inline action (SD-13)",
    holes: [],
    message: testModelDelayedActions
  },
  STUB("src/guards.ts", 119, "stateIn"),
  STUB("src/guards.ts", 181, "not"),
  STUB("src/guards.ts", 254, "and"),
  STUB("src/guards.ts", 325, "or"),
  {
    file: "src/guards.ts",
    line: 356,
    kind: "throw",
    source: "Guard '${typeof guard === 'string' ? guard : guard.type}' is not implemented.'.",
    channel: "actor-error",
    trigger:
      "a named guard with no implementation in a running actor; transition selection wraps it in the StateNode.ts:459 text, `enqueueActions` `check` does not (SD-4)",
    holes: ["doesNotExist"],
    message: guardNotImplemented("doesNotExist")
  },
  {
    file: "src/reportUnhandledError.ts",
    line: 11,
    kind: "rethrow",
    source: "err",
    channel: "warning",
    trigger:
      "an error of a root actor that has no error subscriber: reported once through the actor's logger instead of a global rethrow (SD-21)"
  },
  {
    file: "src/scxml.ts",
    line: 118,
    kind: "throw",
    source: "Can't parse \"${delay} delay.\"",
    channel: "sync",
    trigger: "the SCXML converter with a delay whose fraction has more than three digits (a synchronous throw of a plain `Error`, as upstream's converter: test support, not package code, D4)",
    holes: ["1.5000s"],
    message: scxmlDelayUnparsable("1.5000s")
  },
  {
    file: "src/scxml.ts",
    line: 124,
    kind: "throw",
    source: "Can't parse \"${delay} delay.\"",
    channel: "sync",
    trigger: "the SCXML converter with a delay that is not a number of seconds or milliseconds (a synchronous throw of a plain `Error`, as upstream's converter: test support, not package code, D4)",
    holes: ["soon"],
    message: scxmlDelayUnparsable("soon")
  },
  {
    file: "src/scxml.ts",
    line: 230,
    kind: "throw",
    source: "Conversion of <content/> inside <send/> not implemented.",
    channel: "sync",
    trigger: "the SCXML converter with `<content/>` inside `<send/>` (a synchronous throw of a plain `Error`, as upstream's converter: test support, not package code, D4)",
    holes: [],
    message: scxmlSendContent
  },
  {
    file: "src/scxml.ts",
    line: 337,
    kind: "throw",
    source: "Conversion of \"${element.name}\" elements is not implemented yet.",
    channel: "sync",
    trigger: "the SCXML converter with an executable element it does not know (a synchronous throw of a plain `Error`, as upstream's converter: test support, not package code, D4)",
    holes: ["script"],
    message: scxmlElementNotImplemented("script")
  },
  {
    file: "src/scxml.ts",
    line: 517,
    kind: "throw",
    source: "Currently only converting invoke elements of type SCXML is supported.",
    channel: "sync",
    trigger: "the SCXML converter with an `<invoke>` whose type is not SCXML (a synchronous throw of a plain `Error`, as upstream's converter: test support, not package code, D4)",
    holes: [],
    message: scxmlInvokeType
  },
  {
    file: "src/scxml.ts",
    line: 534,
    kind: "throw",
    source: "Multiple initial states are not supported (\"${String(initial)}\").",
    channel: "sync",
    trigger: "the SCXML converter with more than one initial state (a synchronous throw of a plain `Error`, as upstream's converter: test support, not package code, D4)",
    holes: ["a b"],
    message: scxmlMultipleInitial("a b")
  },
  {
    file: "src/scxml.ts",
    line: 580,
    kind: "throw",
    source: "Conversion of `src` attribute on datamodel's <data> elements is not supported.",
    channel: "sync",
    trigger: "the SCXML converter with a `src` attribute on a datamodel `<data>` element (a synchronous throw of a plain `Error`, as upstream's converter: test support, not package code, D4)",
    holes: [],
    message: scxmlDataSrc
  },
  {
    file: "src/spawn.ts",
    line: 94,
    kind: "throw",
    source: "Actor logic '${src}' not implemented in machine '${machine.id}'",
    channel: "actor-error",
    trigger: "`spawn` inside `assign` with a `src` that names no actor implementation",
    holes: ["child", "parent"],
    message: actorLogicNotImplemented("child", "parent")
  },
  {
    file: "src/stateUtils.ts",
    line: 293,
    kind: "throw",
    source:
      "State \"${stateNode.id}\" has declared `cond` for one of its transitions. This property has been renamed to `guard`. Please update your code.",
    channel: "effect-failure",
    trigger: "`createMachine` with a transition that declares `cond`: the machine keeps the definition error, and its initial snapshot fails with it (SD-3, amended 2026-10-08)",
    holes: ["(machine).a"],
    message: legacyCond("(machine).a")
  },
  {
    file: "src/stateUtils.ts",
    line: 329,
    kind: "throw",
    source: "Null events (\"\") cannot be specified as a transition key. Use `always: { ... }` instead.",
    channel: "effect-failure",
    trigger: "`createMachine` with the empty string as an event key in `on`: the machine keeps the definition error, and its initial snapshot fails with it (SD-3, amended 2026-10-08)",
    holes: [],
    message: nullEventKey
  },
  {
    file: "src/stateUtils.ts",
    line: 453,
    kind: "throw",
    source: "Initial state node \"${_target}\" not found on parent state node #${stateNode.id}",
    channel: "actor-error",
    trigger:
      "`createActor` of a machine whose `initial` names no child: status error at creation; upstream `createMachine` does not throw it (interpreter.test.ts)",
    holes: ["create", "fetchMachine"],
    message: initialStateNotFound("create", "fetchMachine")
  },
  {
    file: "src/stateUtils.ts",
    line: 512,
    kind: "throw",
    source: "Invalid transition definition for state node '${stateNode.id}':\n${err.message}",
    channel: "effect-failure",
    trigger: "`createMachine` with a sibling target that names no state node: the machine keeps the definition error, and its initial snapshot fails with it (SD-3, amended 2026-10-08)",
    holes: ["(machine).a", "Child state 'c' does not exist on '(machine)'"],
    message: invalidTransitionDefinition("(machine).a", childStateDoesNotExist("c", "(machine)"))
  },
  {
    file: "src/stateUtils.ts",
    line: 517,
    kind: "throw",
    source:
      "Invalid target: \"${target}\" is not a valid target from the root node. Did you mean \".${target}\"?",
    channel: "effect-failure",
    trigger: "`createMachine` with a root transition target that lacks the leading dot: the machine keeps the definition error, and its initial snapshot fails with it (SD-3, amended 2026-10-08)",
    holes: ["a", "a"],
    message: invalidTargetFromRoot("a")
  },
  {
    file: "src/stateUtils.ts",
    line: 587,
    kind: "throw",
    source: "Unable to retrieve child state '${stateKey}' from '${stateNode.id}'; no child states exist.",
    channel: "effect-failure",
    trigger:
      "the child lookup of a definition target or history target on a node without a `states` map; unreachable at the tag, where every node has a `states` object (SD-3, amended 2026-10-08)",
    holes: ["c", "(machine).a"],
    message: noChildStates("c", "(machine).a")
  },
  {
    file: "src/stateUtils.ts",
    line: 593,
    kind: "throw",
    source: "Child state '${stateKey}' does not exist on '${stateNode.id}'",
    channel: "effect-failure",
    trigger:
      "`createMachine` with a `.child` root target or a history `target` that names no child (the machine keeps the definition error, and its initial snapshot fails with it (SD-3, amended 2026-10-08)), and the root `getStateNodes`, a pure helper, with a state value object whose key names no child (SD-3)",
    holes: ["c", "(machine)"],
    message: childStateDoesNotExist("c", "(machine)")
  },
  {
    file: "src/stateUtils.ts",
    line: 593,
    kind: "throw",
    source: "Child state '${stateKey}' does not exist on '${stateNode.id}'",
    channel: "actor-error",
    trigger:
      "`createActor` with a persisted snapshot whose state value object has a key that names no child: status `error` with a `RestoreError` of the text, as upstream `_initState` turns the restore's throw into status `error` (SD-7, SD-8)",
    holes: ["c", "(machine)"],
    message: childStateDoesNotExist("c", "(machine)")
  },
  {
    file: "src/stateUtils.ts",
    line: 641,
    kind: "throw",
    source: "State '${stateValue}' does not exist on '${stateNode.id}'",
    channel: "effect-failure",
    trigger:
      "`machine.resolveState`, and the root `getStateNodes`, a pure helper, with a string state value that names no state node: each Effect fails (SD-3, amended 2026-10-08)",
    holes: ["invalid", "(machine)"],
    message: stateDoesNotExist("invalid", "(machine)")
  },
  {
    file: "src/stateUtils.ts",
    line: 641,
    kind: "throw",
    source: "State '${stateValue}' does not exist on '${stateNode.id}'",
    channel: "actor-error",
    trigger:
      "`createActor` with a persisted snapshot whose state value names no state node: status `error` with a `RestoreError` of the text, as upstream `_initState` turns the restore's throw into status `error` (SD-7, SD-8)",
    holes: ["invalid", "(machine)"],
    message: stateDoesNotExist("invalid", "(machine)")
  },
  {
    file: "src/stateUtils.ts",
    line: 1131,
    kind: "rethrow",
    source: "e",
    channel: "actor-error",
    trigger: "an error raised while a microstep resolves its actions; upstream rethrows it unchanged (SD-4)"
  },
  {
    file: "src/stateUtils.ts",
    line: 1685,
    kind: "throw",
    source: "An event cannot have the wildcard type ('${WILDCARD}')",
    channel: "actor-error",
    trigger: "an event whose type is `*` sent to a running actor",
    holes: ["*"],
    message: wildcardEventType
  },
  {
    file: "src/stateUtils.ts",
    line: 1764,
    kind: "throw",
    source:
      "Infinite loop detected: the machine has processed more than ${maxIterations} microsteps without reaching a stable state. This usually happens when there's a cycle of transitions (e.g., eventless transitions or raised events causing state A -> B -> C -> A).",
    channel: "actor-error",
    trigger: "a macrostep that exceeds the machine's `maxIterations` microsteps",
    holes: ["3"],
    message: infiniteLoop(3)
  },
  {
    file: "src/system.ts",
    line: 198,
    kind: "throw",
    source: "Actor with system ID '${systemId as string}' already exists.",
    channel: "actor-error",
    trigger: "spawning or invoking a second actor under a `systemId` that is in use",
    holes: ["test"],
    message: duplicateSystemId("test")
  },
  {
    file: "src/utils.ts",
    line: 179,
    kind: "console.warn",
    source:
      "Dynamically mapping values to individual properties is deprecated. Use a single function that returns the mapped object instead.\nFound object containing properties whose values are possibly mapping functions: ${Object.entries(mapper) .filter(([, value]) => typeof value === 'function') .map(([key, value]) => `\\n - ${key}: ${(value as () => any) .toString() .replace(/\\n\\s*/g, '')}`) .join('')}",
    channel: "warning",
    trigger: "an `output` mapper object whose property values are functions (upstream checks no `input` mapper)",
    holes: ["\n - count: ({ context }) =>context.count"],
    message: dynamicMappingDeprecated({ count: MAPPING_FUNCTION, label: "fixed" })
  },
  {
    file: "src/utils.ts",
    line: 314,
    kind: "console.warn",
    source:
      "Wildcards can only be the last token of an event descriptor (e.g., \"event.*\") or the entire event descriptor (\"*\"). Check the \"${descriptor}\" event.",
    channel: "warning",
    trigger: "an event descriptor with a `*` that is not its last token",
    holes: ["event.*.bar.*"],
    message: wildcardNotLast("event.*.bar.*")
  },
  {
    file: "src/utils.ts",
    line: 334,
    kind: "console.warn",
    source: "Infix wildcards in transition events are not allowed. Check the \"${descriptor}\" transition.",
    channel: "warning",
    trigger: "a transition descriptor with an infix wildcard",
    holes: ["*.event.*"],
    message: infixWildcard("*.event.*")
  },
  {
    file: "src/waitFor.ts",
    line: 60,
    kind: "console.error",
    source: "`timeout` passed to `waitFor` is negative and it will reject its internal promise immediately.",
    channel: "warning",
    trigger: "`waitFor` with a negative `timeout`",
    holes: [],
    message: negativeWaitForTimeout
  }
]

/**
 * The two `waitFor` Promise rejections with a new `Error`. They are not throw sites, so the
 * manifest does not record them; the texts were read from the clone at the lines below.
 *
 * @since 0.1.0
 */
export const rejectionSites: ReadonlyArray<RejectionSite> = [
  {
    file: "src/waitFor.ts",
    line: 69,
    kind: "reject",
    source: "Timeout of ${resolvedOptions.timeout} ms exceeded",
    channel: "effect-failure",
    trigger: "`waitFor` whose `timeout` elapses on the Effect clock before the predicate holds (SD-28)",
    holes: ["50"],
    message: waitForTimeout(50)
  },
  {
    file: "src/waitFor.ts",
    line: 122,
    kind: "reject",
    source: "Actor terminated without satisfying predicate",
    channel: "effect-failure",
    trigger: "`waitFor` on an actor that completes before the predicate holds",
    holes: [],
    message: actorTerminatedWithoutPredicate
  }
]
