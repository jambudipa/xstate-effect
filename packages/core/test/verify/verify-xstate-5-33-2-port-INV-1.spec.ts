/**
 * INV-1: every upstream throw site uses one error channel (SD-3, SD-4, SD-13, SD-21).
 *
 * T1.6 adds the structure tests. The throw-site table of `upstream-messages.ts` must cover
 * every throw, rethrow and console site that the frozen manifest (T1.2) records for
 * xstate@5.33.2; each entry must equal the manifest record at its file and line; each
 * recorded message must equal the upstream template with its `${...}` holes filled by the
 * entry's sample values; and each channel must follow the SD rules. The texts are also
 * compared with the texts that the upstream tests assert in their inline snapshots.
 *
 * T8.9 adds the trigger tests: each entry's port operation runs, and the test checks the
 * channel the port used and the text it gave. The expected text is the upstream template of
 * the entry (the manifest line) filled with the values that the trigger reaches, so it does
 * not come from the builders under test. An entry with no trigger is either a deviation of
 * the conformance ledger (the row is named, and it must exist and name the site) or a site
 * that no input reaches upstream either (the reason is named); a structure test keeps the
 * three lists and the table in step.
 */
import { assert, describe, it } from "@effect/vitest"
import { Cause, Effect, Exit, Fiber, Logger, Option, Predicate, type Scope } from "effect"
import { TestClock } from "effect/testing"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { SourceSite, UpstreamManifest } from "../../scripts/upstream/freeze-upstream.js"
import type { ActorRefBase } from "../../src/ActorRef.js"
import {
  type ActorType,
  type AnyActorLogic,
  assertEvent,
  assign,
  createActor,
  createMachine,
  emit,
  enqueueActions,
  type EventObject,
  forwardTo,
  fromCallback,
  getInitialSnapshot,
  getStateNodes,
  type MachineConfig,
  raise,
  sendTo,
  spawnChild,
  stopChild,
} from "../../src/index.js"
import { createTestModel, getAdjacencyMap, getPathsFromEvents, joinPaths } from "../../src/graph/index.js"
import { firstGlobalObject } from "../../src/internal/globalObject.js"
import { SimulatedClock, waitFor } from "../../src/testing/index.js"
import { toMachine } from "../upstream/support/scxml.js"
import * as Messages from "./upstream-messages.js"
import { type Channel, rejectionSites, type ThrowSite, throwSites } from "./upstream-messages.js"

const pkgRoot = fileURLToPath(new URL("../../", import.meta.url))
const MANIFEST_PATH = join(pkgRoot, "test/upstream/upstream-manifest.json")

const readManifest = Effect.sync(() => JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as UpstreamManifest)

const siteKey = (site: { readonly file: string; readonly line: number }): string => `${site.file}:${site.line}`

/** Splits an upstream template text into its literal parts and its `${...}` hole expressions. */
const templateParts = (text: string): { readonly literals: ReadonlyArray<string>; readonly holes: ReadonlyArray<string> } => {
  const literals: Array<string> = []
  const holes: Array<string> = []
  let start = 0
  let index = 0
  while (index < text.length) {
    if (!text.startsWith("${", index)) {
      index += 1
      continue
    }
    literals.push(text.slice(start, index))
    // A hole may hold a nested template (`${a ? `'${a}' ` : ''}`): match the braces.
    let depth = 0
    let end = index + 1
    for (; end < text.length; end += 1) {
      if (text[end] === "{") depth += 1
      if (text[end] === "}") depth -= 1
      if (depth === 0) break
    }
    holes.push(text.slice(index + 2, end))
    index = end + 1
    start = index
  }
  literals.push(text.slice(start))
  return { literals, holes }
}

/** The template text with each hole replaced by the value at the same position. */
const fillTemplate = (text: string, values: ReadonlyArray<string>): string => {
  const { literals } = templateParts(text)
  return literals.map((literal, index) => literal + (index < values.length ? values[index] : "")).join("")
}

/**
 * The problems of a throw-site table measured against the manifest's source sites: an
 * entry with no upstream site at its file and line, a kind or source text that differs
 * from the upstream record, a sample with the wrong number of holes, a message that differs
 * from the filled upstream template, two entries for one site on one channel, and an
 * upstream site that no entry covers.
 */
const siteProblems = (table: ReadonlyArray<ThrowSite>, sites: ReadonlyArray<SourceSite>): ReadonlyArray<string> => {
  const problems: Array<string> = []
  const recorded = new Map(sites.map((site) => [siteKey(site), site] as const))
  const channels = new Map<string, Array<Channel>>()
  for (const entry of table) {
    const key = siteKey(entry)
    channels.set(key, [...(channels.get(key) ?? []), entry.channel])
    const site = recorded.get(key)
    if (site === undefined) {
      problems.push(`${key}: no upstream site at this file and line`)
      continue
    }
    if (site.kind !== entry.kind) problems.push(`${key}: kind ${entry.kind} differs from the upstream ${site.kind}`)
    if (site.text !== entry.source) problems.push(`${key}: source text differs from the upstream line`)
    if (entry.kind === "rethrow") continue
    const holeCount = templateParts(site.text).holes.length
    if (entry.holes.length !== holeCount) {
      problems.push(`${key}: sample fills ${entry.holes.length} holes, the upstream template has ${holeCount}`)
    } else if (fillTemplate(site.text, entry.holes) !== entry.message) {
      problems.push(`${key}: message differs from the upstream template filled with the sample`)
    }
  }
  for (const [key, used] of channels) {
    if (new Set(used).size !== used.length) problems.push(`${key}: two entries on the channel ${used.join(", ")}`)
  }
  for (const site of sites) {
    if (!channels.has(siteKey(site))) problems.push(`${siteKey(site)}: upstream site missing from the table`)
  }
  return problems
}

/**
 * SD-3 (amended 2026-10-08): the sites upstream throws synchronously that the port turns into
 * Effect failures. A createMachine definition error (missing initial, legacy `cond`, empty
 * event key, invalid target, unknown `#id`, invalid history) is kept by the machine and fails
 * each Effect that computes a snapshot of it; `machine.resolveState` with an invalid value and
 * `assertEvent` fail their own Effects. No package site throws.
 */
const SD3_EFFECT_SITES: ReadonlyArray<string> = [
  "src/StateMachine.ts:525", // createMachine with an unknown #id target
  "src/StateNode.ts:217", // compound state without initial
  "src/assert.ts:45", // assertEvent
  "src/stateUtils.ts:293", // legacy cond
  "src/stateUtils.ts:329", // empty event key
  "src/stateUtils.ts:512", // invalid sibling target
  "src/stateUtils.ts:517", // invalid target from the root
  "src/stateUtils.ts:587", // child lookup on a node without states
  "src/stateUtils.ts:593", // `.child` root target or history target that names no child
  "src/stateUtils.ts:641" // machine.resolveState with an unknown state value
]

/** SD-21: the unhandled-error rethrow becomes one report through the actor logger. */
const SD21_REPORT_SITE = "src/reportUnhandledError.ts:11"

/**
 * D4: the SCXML converter is test support (`test/upstream/support/scxml.ts`), not package code,
 * so SD-3 does not govern it; it throws a plain `Error` synchronously, as upstream's does.
 */
const isD4ConverterSite = (site: { readonly file: string }): boolean => site.file === "src/scxml.ts"

/**
 * The sites with more than one entry, and their channels in sorted order. SD-3 (amended
 * 2026-10-08) makes createMachine, `machine.resolveState` and the pure helpers
 * (`getStateNodes`) fail Effects, so each of these sites has one Effect failure entry. SD-7,
 * SD-8: the state value sites that a restore also reaches (`createActor` with a persisted
 * snapshot) error the actor as upstream `_initState` does: an actor-error entry.
 */
const MULTI_CHANNEL_SITES: ReadonlyArray<readonly [string, ReadonlyArray<Channel>]> = [
  ["src/stateUtils.ts:593", ["actor-error", "effect-failure"]],
  ["src/stateUtils.ts:641", ["actor-error", "effect-failure"]]
]

const CHANNELS: ReadonlyArray<Channel> = ["sync", "effect-failure", "actor-error", "warning"]

/** Undoes the escapes of a raw template literal (the manifest stores snapshots raw). */
const cook = (raw: string): string => raw.replace(/\\([\\`$])/g, "$1")

describe("INV-1 throw-site table (structure)", () => {
  it.effect("[INV-1] table lists every upstream throw site and each entry equals the manifest record", () =>
    Effect.gen(function* () {
      const manifest = yield* readManifest
      assert.deepStrictEqual(siteProblems(throwSites, manifest.sourceSites), [])
      const covered = new Set(throwSites.map(siteKey))
      assert.strictEqual(covered.size, manifest.sourceSites.length)
      assert.strictEqual(covered.size, 73)
      const kindCount = (kind: ThrowSite["kind"]) =>
        manifest.sourceSites.filter((site) => site.kind === kind && covered.has(siteKey(site))).length
      assert.deepStrictEqual(
        [kindCount("throw"), kindCount("console.warn"), kindCount("console.error"), kindCount("rethrow")],
        [54, 13, 1, 5]
      )
      for (const entry of throwSites) {
        assert.isTrue(entry.trigger.length > 0, `${siteKey(entry)} names the port operation that reaches it`)
      }
    }))

  it("[INV-1] each channel is sync, effect-failure, actor-error or warning, and sync holds only on the D4 converter", () => {
    for (const entry of throwSites) {
      assert.include(CHANNELS, entry.channel, siteKey(entry))
    }
    const sync = throwSites.filter((entry) => entry.channel === "sync")
    const packageSync = [...new Set(sync.filter((entry) => !isD4ConverterSite(entry)).map(siteKey))].sort()
    assert.deepStrictEqual(packageSync, [])
    // SD-3 (amended 2026-10-08): each site upstream throws synchronously fails an Effect
    for (const site of SD3_EFFECT_SITES) {
      const channels = throwSites.filter((entry) => siteKey(entry) === site).map((entry) => entry.channel)
      assert.include(channels, "effect-failure", site)
    }
    // D4: every site of the SCXML converter (test support) throws synchronously, as upstream's
    const converter = throwSites.filter(isD4ConverterSite)
    assert.strictEqual(converter.length, 7)
    for (const entry of converter) assert.strictEqual(entry.channel, "sync", siteKey(entry))
    // The sites that more than one port operation reaches, each on its own channel
    for (const [site, expected] of MULTI_CHANNEL_SITES) {
      const channels = throwSites.filter((entry) => siteKey(entry) === site).map((entry) => entry.channel)
      assert.deepStrictEqual([...channels].sort(), expected, site)
    }
    // The initial key that names no child errors the actor at creation upstream, not createMachine.
    const initialKey = throwSites.filter((entry) => siteKey(entry) === "src/stateUtils.ts:453")
    assert.deepStrictEqual(initialKey.map((entry) => entry.channel), ["actor-error"])
  })

  it("[INV-1] every console site and only the SD-21 report site use the warning channel", () => {
    const warnings = throwSites.filter((entry) => entry.channel === "warning")
    const consoleSites = throwSites.filter((entry) => entry.kind === "console.warn" || entry.kind === "console.error")
    for (const entry of consoleSites) assert.strictEqual(entry.channel, "warning", siteKey(entry))
    assert.deepStrictEqual(
      warnings.filter((entry) => entry.kind !== "console.warn" && entry.kind !== "console.error").map(siteKey),
      [SD21_REPORT_SITE]
    )
    assert.strictEqual(warnings.length, consoleSites.length + 1)
  })

  it("[INV-1] the module exports the exact upstream texts the rewrites and scenarios use", () => {
    // [label, text from the exported builder, upstream site, values of the template holes]
    const required: ReadonlyArray<readonly [string, string, string, ReadonlyArray<string>]> = [
      ["guard not implemented", Messages.guardNotImplemented("isAdmin"), "src/guards.ts:356", ["isAdmin"]],
      [
        "guard evaluation, named guard",
        Messages.guardEvaluationFailed("isAdmin", "EV", "(machine).a", "boom"),
        "src/StateNode.ts:459",
        ["'isAdmin' ", "EV", "(machine).a", "boom"]
      ],
      [
        "guard evaluation, inline guard",
        Messages.guardEvaluationFailed("", "EV", "(machine).a", "boom"),
        "src/StateNode.ts:459",
        ["", "EV", "(machine).a", "boom"]
      ],
      ["infinite loop, maxIterations 3", Messages.infiniteLoop(3), "src/stateUtils.ts:1764", ["3"]],
      ["infinite loop, maxIterations 100", Messages.infiniteLoop(100), "src/stateUtils.ts:1764", ["100"]],
      ["unable to send", Messages.unableToSend("child", "parent"), "src/actions/send.ts:115", ["child", "parent"]],
      ["only event objects (raise)", Messages.onlyEventObjectsRaise("PING"), "src/actions/raise.ts:56", ["PING"]],
      ["only event objects (sendTo)", Messages.onlyEventObjectsSendTo("PING"), "src/actions/send.ts:72", ["PING"]],
      ["only event objects (send)", Messages.onlyEventObjectsSend("PING"), "src/createActor.ts:759", ["PING"]],
      ["duplicate system id", Messages.duplicateSystemId("child"), "src/system.ts:198", ["child"]],
      ["assign to undefined context", Messages.assignToUndefinedContext, "src/actions/assign.ts:45", []],
      [
        "actor logic not implemented",
        Messages.actorLogicNotImplemented("child", "parent"),
        "src/spawn.ts:94",
        ["child", "parent"]
      ],
      [
        "actor type not found (warning)",
        Messages.actorTypeNotFound("child", "x:0"),
        "src/actions/spawnChild.ts:80",
        ["child", "x:0"]
      ],
      ["no initial state", Messages.noInitialState("(machine).a", "b"), "src/StateNode.ts:217", ["(machine).a", "b"]],
      [
        "invalid transition definition",
        Messages.invalidTransitionDefinition("(machine).a", Messages.childStateDoesNotExist("c", "(machine)")),
        "src/stateUtils.ts:512",
        ["(machine).a", "Child state 'c' does not exist on '(machine)'"]
      ],
      ["invalid target from root", Messages.invalidTargetFromRoot("a"), "src/stateUtils.ts:517", ["a", "a"]],
      [
        "child state node does not exist",
        Messages.childStateNodeDoesNotExist("missing", "(machine)"),
        "src/StateMachine.ts:525",
        ["missing", "(machine)"]
      ],
      ["unable to travel back in time", Messages.unableToTravelBackInTime, "src/SimulatedClock.ts:44", []],
      [
        "expected event to have type matching",
        Messages.expectedEventType({ type: "a", value: 1 }, ["b"]),
        "src/assert.ts:45",
        ['{"type":"a","value":1}', 'type matching "b"']
      ],
      [
        "expected event to have one of types matching",
        Messages.expectedEventType({ type: "a" }, ["b", "c.*"]),
        "src/assert.ts:45",
        ['{"type":"a"}', 'one of types matching "b", "c.*"']
      ],
      ["inline child actor cannot be persisted", Messages.inlineChildCannotBePersisted, "src/State.ts:464", []],
      [
        "event sent to stopped actor (warning)",
        Messages.eventSentToStoppedActor({ type: "PING" }, "child", "x:1"),
        "src/createActor.ts:742",
        ["PING", "child", "x:1", '{"type":"PING"}']
      ],
      ["timeout exceeded", Messages.waitForTimeout(50), "src/waitFor.ts:69", ["50"]],
      [
        "actor terminated without satisfying predicate",
        Messages.actorTerminatedWithoutPredicate,
        "src/waitFor.ts:122",
        []
      ],
      ["forward to undefined actor", Messages.forwardToUndefinedActor, "src/actions/send.ts:367", []]
    ]
    const sources = new Map(
      [...throwSites, ...rejectionSites].map((entry) => [siteKey(entry), entry.source] as const)
    )
    for (const [label, text, site, holes] of required) {
      const source = sources.get(site)
      assert.isDefined(source, `${label}: ${site} is recorded`)
      assert.strictEqual(templateParts(source ?? "").holes.length, holes.length, label)
      assert.strictEqual(text, fillTemplate(source ?? "", holes), label)
    }
  })

  it.effect("[INV-1] the recorded texts equal the texts the upstream tests assert", () =>
    Effect.gen(function* () {
      const manifest = yield* readManifest
      // [upstream test file, text it asserts in an inline snapshot]
      const asserted: ReadonlyArray<readonly [string, string]> = [
        [
          "test/guards.test.ts",
          Messages.guardEvaluationFailed(
            "doesNotExist",
            "BAD_COND",
            "(machine).foo",
            Messages.guardNotImplemented("doesNotExist")
          )
        ],
        [
          "test/guards.test.ts",
          Messages.guardEvaluationFailed(
            "missing-predicate",
            "EVENT",
            "invalid-predicate.active",
            Messages.guardNotImplemented("missing-predicate")
          )
        ],
        [
          "test/errors.test.ts",
          Messages.guardEvaluationFailed("", "NEXT", "(machine).a", "error_thrown_in_guard_when_transitioning")
        ],
        ["test/actions.test.ts", Messages.forwardToUndefinedActor],
        ["test/actions.test.ts", Messages.onlyEventObjectsSendTo("a string")],
        ["test/actions.test.ts", Messages.onlyEventObjectsRaise("a string")],
        ["test/actions.test.ts", Messages.builtInCalledInCustomAction("assign")],
        ["test/actions.test.ts", Messages.builtInCalledInCustomAction("raise")],
        ["test/actions.test.ts", Messages.builtInCalledInCustomAction("sendTo")],
        ["test/actions.test.ts", Messages.builtInCalledInCustomAction("emit")],
        ["test/actions.test.ts", Messages.eventSentToStoppedActor({ type: "PING" }, "myChild", "x:113")],
        ["test/interpreter.test.ts", Messages.eventSentToStoppedActor({ type: "TIMER" }, "x:27", "x:27")],
        ["test/interpreter.test.ts", Messages.initialStateNotFound("create", "fetchMachine")],
        ["test/assert.test.ts", Messages.expectedEventType({ type: "count", value: 42 }, ["greet"])],
        ["test/assert.test.ts", Messages.expectedEventType({ type: "count", value: 42 }, ["greet", "notify"])],
        ["test/eventDescriptors.test.ts", Messages.expectedEventType({ type: "OTHER" }, ["FEEDBACK.*"])],
        ["test/eventDescriptors.test.ts", Messages.wildcardNotLast("event.*.bar.*")],
        ["test/eventDescriptors.test.ts", Messages.infixWildcard("*.event.*")],
        ["test/actorLogic.test.ts", Messages.inlineChildCannotBePersisted],
        ["test/waitFor.test.ts", Messages.actorTerminatedWithoutPredicate],
        ["test/system.test.ts", Messages.duplicateSystemId("test")],
        ["src/graph/test/index.test.ts", Messages.traversalLimitExceeded]
      ]
      for (const [path, text] of asserted) {
        const file = manifest.files.find((candidate) => candidate.path === path)
        assert.isDefined(file, `manifest has ${path}`)
        const snapshots = (file?.tests ?? []).flatMap((test) =>
          test.inlineSnapshots.flatMap((snapshot) => (snapshot.text === null ? [] : [cook(snapshot.text)]))
        )
        const lines = text.split("\n")
        assert.isTrue(
          snapshots.some((snapshot) => lines.every((line) => snapshot.includes(line))),
          `${path} asserts ${JSON.stringify(text)}`
        )
      }
    }))

  it.effect("[INV-1] a text copied wrongly, a wrong line or a missing site fails the check", () =>
    Effect.gen(function* () {
      const manifest = yield* readManifest
      const index = throwSites.findIndex((entry) => siteKey(entry) === "src/guards.ts:356")
      const original = throwSites[index]
      assert.isDefined(original)
      if (original === undefined || original.kind === "rethrow") return
      const replaced = (entry: ThrowSite): ReadonlyArray<ThrowSite> =>
        throwSites.map((candidate, at) => (at === index ? entry : candidate))

      // A wrongly copied message: upstream's stray "'." suffix dropped.
      const wrongMessage = replaced({ ...original, message: "Guard 'isAdmin' is not implemented." })
      assert.deepStrictEqual(siteProblems(wrongMessage, manifest.sourceSites), [
        "src/guards.ts:356: message differs from the upstream template filled with the sample"
      ])

      // A wrongly copied source text.
      const wrongSource = replaced({ ...original, source: original.source.replace("is not", "isn't") })
      assert.deepStrictEqual(siteProblems(wrongSource, manifest.sourceSites), [
        "src/guards.ts:356: source text differs from the upstream line"
      ])

      // A wrong line: no upstream site there, and the real site is left uncovered.
      const wrongLine = replaced({ ...original, line: original.line + 1 })
      assert.deepStrictEqual(siteProblems(wrongLine, manifest.sourceSites), [
        "src/guards.ts:357: no upstream site at this file and line",
        "src/guards.ts:356: upstream site missing from the table"
      ])

      // A sample with too few hole values.
      const wrongHoles = replaced({ ...original, holes: [] })
      assert.deepStrictEqual(siteProblems(wrongHoles, manifest.sourceSites), [
        "src/guards.ts:356: sample fills 0 holes, the upstream template has 1"
      ])

      // A missing site and a duplicate channel.
      const missing = throwSites.filter((_, at) => at !== index)
      assert.deepStrictEqual(siteProblems(missing, manifest.sourceSites), [
        "src/guards.ts:356: upstream site missing from the table"
      ])
      const duplicated = [...throwSites, original]
      assert.deepStrictEqual(siteProblems(duplicated, manifest.sourceSites), [
        "src/guards.ts:356: two entries on the channel actor-error, actor-error"
      ])
    }))

  it("[INV-1] the waitFor rejections are recorded beside the table, not as manifest sites", () => {
    assert.deepStrictEqual(rejectionSites.map(siteKey), ["src/waitFor.ts:69", "src/waitFor.ts:122"])
    for (const entry of rejectionSites) {
      assert.strictEqual(entry.channel, "effect-failure")
      assert.strictEqual(fillTemplate(entry.source, entry.holes), entry.message)
      assert.isFalse(throwSites.some((site) => siteKey(site) === siteKey(entry)))
    }
  })
})

// ---------------------------------------------------------------- triggers (T8.9)

/** What the port did when a trigger ran: the channel it used and the texts it gave. */
interface Observed {
  readonly channel: Channel | "none"
  /** The message of the thrown value, of the failure, of the snapshot error, or of each log. */
  readonly messages: ReadonlyArray<string>
  /** `sync`: the thrown value has a `_tag` (a `Data.TaggedError`); the D4 converter's has none. */
  readonly tagged: boolean
  /** `effect-failure`: the Effect died (a defect) and did not fail with a typed error. */
  readonly defect: boolean
  /** `warning`: the level of each log, in the order of `messages`. */
  readonly levels: ReadonlyArray<string>
}

const NOTHING: Observed = { channel: "none", messages: [], tagged: false, defect: false, levels: [] }

/** The `message` of an error-like value, else its `String` form. */
const messageOf = (value: unknown): string =>
  Predicate.hasProperty(value, "message") && Predicate.isString(value.message) ? value.message : String(value)

const thrownObserved = (error: unknown): Observed => ({
  ...NOTHING,
  channel: "sync",
  messages: [messageOf(error)],
  tagged: Predicate.hasProperty(error, "_tag"),
})

const failedObserved = (cause: Cause.Cause<unknown>): Observed => ({
  ...NOTHING,
  channel: "effect-failure",
  messages: [messageOf(Cause.squash(cause))],
  defect: Cause.hasDies(cause) && !Cause.hasFails(cause),
})

/** The value `thunk` returns, or what it throws. */
const attempt = <A>(thunk: () => A): { readonly ok: true; readonly value: A } | { readonly ok: false; readonly error: unknown } => {
  try {
    return { ok: true, value: thunk() }
  } catch (error) {
    return { ok: false, error }
  }
}

/** Runs `thunk`: a synchronous throw is the `sync` channel. */
const observeSync = (thunk: () => unknown): Effect.Effect<Observed> =>
  Effect.sync(() => {
    const result = attempt(thunk)
    return result.ok ? NOTHING : thrownObserved(result.error)
  })

/**
 * Builds an Effect with `build` and runs it: a typed failure or a defect is the
 * `effect-failure` channel; a throw while the Effect is built is the `sync` channel.
 */
const observeEffect = <A, E, R>(build: () => Effect.Effect<A, E, R>): Effect.Effect<Observed, never, R> =>
  Effect.suspend(() => {
    const built = attempt(build)
    return built.ok
      ? Effect.map(Effect.exit(built.value), (exit) => (Exit.isSuccess(exit) ? NOTHING : failedObserved(exit.cause)))
      : Effect.succeed(thrownObserved(built.error))
  })

/**
 * Runs `steps`, which create an actor and drive it to the site, with a silent logger: the
 * actor's status `error` is the `actor-error` channel; a failure of the steps themselves is
 * the `effect-failure` channel.
 */
const observeActor = <E>(
  steps: Effect.Effect<Pick<ActorType.Any, "getSnapshot">, E, Scope.Scope>
): Effect.Effect<Observed, never, Scope.Scope> =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(Effect.provide(steps, Logger.layer([])))
    if (Exit.isFailure(exit)) {
      return failedObserved(exit.cause)
    }
    const snapshot = yield* exit.value.getSnapshot
    return snapshot.status === "error"
      ? {
          ...NOTHING,
          channel: "actor-error" as const,
          messages: [Option.match(snapshot.error, { onNone: () => "(no error value)", onSome: messageOf })],
        }
      : NOTHING
  })

/**
 * Runs `body` in its own scope with a logger that keeps every text logged at Warn or Error:
 * logs and no failure are the `warning` channel.
 */
const observeLogs = <A, E, R>(body: Effect.Effect<A, E, R>): Effect.Effect<Observed, never, Exclude<R, Scope.Scope>> =>
  Effect.suspend(() => {
    const messages: Array<string> = []
    const levels: Array<string> = []
    const logger = Logger.make((options) => {
      if (options.logLevel !== "Warn" && options.logLevel !== "Error") return
      const parts: ReadonlyArray<unknown> = Array.isArray(options.message) ? options.message : [options.message]
      for (const part of parts) {
        messages.push(messageOf(part))
        levels.push(options.logLevel)
      }
    })
    return Effect.map(Effect.exit(Effect.scoped(Effect.provide(body, Logger.layer([logger])))), (exit) =>
      Exit.isFailure(exit)
        ? failedObserved(exit.cause)
        : messages.length === 0
        ? NOTHING
        : { ...NOTHING, channel: "warning" as const, messages, levels }
    )
  })

/** What a trigger reaches: the values of the template's `${...}` holes, or the text of the rethrown error. */
type Expected = { readonly holes: ReadonlyArray<string> } | { readonly rethrown: string }

/** A trigger runs the port operation of one table entry and reports what the port did. */
type Trigger = Effect.Effect<readonly [Observed, Expected], never, Scope.Scope>

const holes = (...values: ReadonlyArray<string>): Expected => ({ holes: values })

const reaching = <R>(expected: Expected, observed: Effect.Effect<Observed, never, R>): Effect.Effect<readonly [Observed, Expected], never, R> =>
  Effect.map(observed, (result) => [result, expected] as const)

/**
 * The definition error of `createMachine(config)` (SD-3, amended 2026-10-08): the machine
 * keeps it, and the Effect that computes its initial snapshot fails with it.
 */
const definitionFailure = (config: MachineConfig<object, EventObject>): Effect.Effect<Observed> =>
  observeEffect(() => getInitialSnapshot(createMachine(config)))

/**
 * Two port operations of one entry (SD-3, amended 2026-10-08: they share the Effect failure
 * channel): the channel when both use it (else `none`), the texts both gave, and a defect when
 * either died.
 */
const bothObserved = <R1, R2>(
  first: Effect.Effect<Observed, never, R1>,
  second: Effect.Effect<Observed, never, R2>
): Effect.Effect<Observed, never, R1 | R2> =>
  Effect.zipWith(first, second, (one, other): Observed => ({
    ...one,
    channel: one.channel === other.channel ? one.channel : "none",
    messages: one.messages.filter((message) => other.messages.includes(message)),
    defect: one.defect || other.defect
  }))

/** The key of a table entry: its file, line and channel (one site may have two channels, SD-3). */
const entryKey = (entry: { readonly file: string; readonly line: number; readonly channel: Channel }): string =>
  `${siteKey(entry)} ${entry.channel}`

type GoEvent = { readonly type: "GO" }

interface Refs {
  readonly ref?: ActorRefBase
}

/** A function whose source text is fixed, as the table's `src/utils.ts:179` sample uses. */
const MAPPING_FUNCTION = Object.assign(() => 0, { toString: () => "({ context }) =>\n  context.count" })

/** An SCXML document with `body` inside the root element. */
const scxml = (body: string, initial = "a"): string =>
  `<?xml version="1.0" encoding="UTF-8"?><scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" initial="${initial}">${body}</scxml>`

/** A machine whose state `start` maps each descriptor in `on` to the state `next`. */
const routing = (descriptor: string) =>
  createMachine<object, EventObject>({
    initial: "start",
    context: {},
    states: { start: { on: { [descriptor]: "next" } }, next: {} },
  })

/** Starts an actor of a machine whose `GO` transition runs `actions`, sends `GO`, and gives the actor. */
const afterGo = (machine: ReturnType<typeof createMachine<object, GoEvent>>, id?: string) =>
  Effect.gen(function* () {
    const actor = yield* createActor(machine, id === undefined ? undefined : { id })
    yield* actor.start
    yield* actor.send({ type: "GO" })
    return actor
  })

/** Starts an actor of `machine` (whose entry reaches the site) and gives it. */
const started = (machine: ReturnType<typeof createMachine<object, EventObject>>) =>
  Effect.tap(createActor(machine), (actor) => actor.start)

/**
 * Restores an actor of `initial: "a", states: { a: {} }` from that machine's persisted snapshot
 * with its state value replaced by `value` (upstream `createActor(machine, { snapshot })`), and
 * reports what the restore did.
 */
const restoredWithValue = (value: unknown): Effect.Effect<Observed, never, Scope.Scope> =>
  Effect.gen(function* () {
    const machine = createMachine({ initial: "a", states: { a: {} } })
    const persisted = yield* Effect.orDie(Effect.flatMap(createActor(machine), (actor) => actor.getPersistedSnapshot))
    return yield* observeActor(createActor(machine, { snapshot: { ...(persisted as object), value } }))
  })

/** `a -GO-> b`: the machine of the TestModel path triggers. */
const pathMachine = createMachine({ id: "inv1-path", initial: "a", states: { a: { on: { GO: "b" } }, b: {} } })

/** The second argument of a TestModel's `testPath`: the event executors and state tests. */
type PathParams = Parameters<Effect.Success<ReturnType<typeof createTestModel<typeof pathMachine>>>["testPath"]>[1]

/**
 * Runs the path test of `pathMachine`'s path to `b` with `params` (the TestModel rethrow
 * sites): a failure is the `effect-failure` channel.
 */
const pathTest = (params: PathParams) =>
  Effect.gen(function* () {
    const model = yield* Effect.orDie(createTestModel(pathMachine))
    const [path] = yield* Effect.orDie(model.getShortestPaths({ toState: (state) => state.matches("b") }))
    return yield* observeEffect(() => (path === undefined ? Effect.die("no path to b") : model.testPath(path, params)))
  })

/**
 * The path descriptions a failing path test of `pathMachine` appends to the error message
 * (upstream `formatPathTestResult`; the texts were read from upstream with the same machine
 * and path): a failure at the `GO` step, and a failure of the first step's state test.
 */
const PATH_TO_B_AT_GO =
  '\nPath:\n\tState: {"value":"a"}\n\tEvent: {"type":"xstate.init"}\n\n\tState: {"value":"b"} via {"type":"xstate.init"}\n\tEvent: {"type":"GO"}\n\n\tState: {"value":"b"} via {"type":"GO"}'
const PATH_TO_B_AT_INIT = '\nPath:\n\tState: {"value":"a"}\n\tEvent: {"type":"xstate.init"}\n\n\tState: {"value":"b"} via {"type":"GO"}'

/** A machine that counts `INC` events for ever: its traversal never ends by itself. */
const unboundedCounter = createMachine({
  types: {} as { context: { count: number } },
  id: "inv1-counter",
  context: { count: 0 },
  on: { INC: { actions: assign({ count: ({ context }) => context.count + 1 }) } },
})

/**
 * The port operation that reaches each table entry, by `entryKey`. The holes are the values
 * the operation fills in, so the expected text is the upstream template of the entry filled
 * with them.
 */
const TRIGGERS: ReadonlyMap<string, Trigger> = new Map<string, Trigger>([
  [
    "src/SimulatedClock.ts:44 effect-failure",
    reaching(
      holes(),
      observeEffect(() => {
        const clock = new SimulatedClock()
        return Effect.andThen(clock.set(10), clock.set(5))
      })
    ),
  ],
  [
    "src/State.ts:464 effect-failure",
    reaching(
      holes(),
      Effect.gen(function* () {
        const machine = createMachine<Refs, EventObject>({
          context: {},
          entry: assign<Refs, EventObject>({ ref: ({ spawn }) => spawn(createMachine({})) }),
        })
        const actor = yield* Effect.tap(createActor(machine), (created) => created.start)
        return yield* observeEffect(() => actor.getPersistedSnapshot)
      })
    ),
  ],
  [
    "src/StateMachine.ts:525 effect-failure",
    reaching(
      holes("missing", "(machine)"),
      bothObserved(
        definitionFailure({ initial: "a", states: { a: { on: { E: "#missing" } } } }),
        observeEffect(() => createMachine({ initial: "a", states: { a: {} } }).getStateNodeById("missing"))
      )
    ),
  ],
  [
    "src/StateMachine.ts:641 warning",
    reaching(
      holes("nonexistent"),
      Effect.gen(function* () {
        const machine = createMachine({
          initial: "a",
          states: { a: { initial: "a1", states: { a1: {}, hist: { type: "history" } } } },
        })
        const first = yield* Effect.tap(createActor(machine), (created) => created.start)
        const persisted = (yield* Effect.orDie(first.getPersistedSnapshot)) as Readonly<Record<string, unknown>>
        const changed ={ ...persisted, historyValue: { "(machine).a.hist": [{ id: "nonexistent" }] } }
        return yield* observeLogs(createActor(machine, { snapshot: changed }))
      })
    ),
  ],
  [
    "src/StateNode.ts:217 effect-failure",
    reaching(
      holes("(machine).a", "b"),
      definitionFailure({ initial: "a", states: { a: { states: { b: {} } } } })
    ),
  ],
  [
    "src/StateNode.ts:459 actor-error",
    reaching(
      holes("'doesNotExist' ", "BAD_COND", "(machine).foo", "Guard 'doesNotExist' is not implemented.'."),
      observeActor(
        Effect.gen(function* () {
          const machine = createMachine<object, { readonly type: "BAD_COND" }>({
            initial: "foo",
            context: {},
            states: { foo: { on: { BAD_COND: { target: "bar", guard: "doesNotExist" } } }, bar: {} },
          })
          const actor = yield* Effect.tap(createActor(machine), (created) => created.start)
          yield* actor.send({ type: "BAD_COND" })
          return actor
        })
      )
    ),
  ],
  [
    "src/actions/assign.ts:45 actor-error",
    reaching(
      holes(),
      observeActor(
        Effect.gen(function* () {
          type Ctx = { readonly n: number }
          const machine = createMachine<Ctx, GoEvent>({
            initial: "a",
            context: { n: 0 },
            states: { a: { on: { GO: { target: "b", actions: assign<Ctx, GoEvent>({ n: 1 }) } } }, b: {} },
          })
          const first = yield* Effect.tap(createActor(machine), (created) => created.start)
          const persisted = (yield* first.getPersistedSnapshot) as Readonly<Record<string, unknown>>
          // A persisted snapshot without a context restores without one, as upstream spreads it (A1)
          const withoutContext = Object.fromEntries(Object.entries(persisted).filter(([key]) => key !== "context"))
          const restored = yield* Effect.tap(createActor(machine, { snapshot: withoutContext }), (created) => created.start)
          yield* restored.send({ type: "GO" })
          return restored
        })
      )
    ),
  ],
  [
    "src/actions/assign.ts:166 warning",
    reaching(
      holes(),
      observeLogs(
        started(
          createMachine<object, EventObject>({
            context: {},
            entry: () => {
              assign({})
            },
          })
        )
      )
    ),
  ],
  [
    "src/actions/emit.ts:130 warning",
    reaching(
      holes(),
      observeLogs(
        started(
          createMachine<object, EventObject>({
            context: {},
            entry: () => {
              emit({ type: "d" })
            },
          })
        )
      )
    ),
  ],
  [
    "src/actions/raise.ts:56 actor-error",
    reaching(
      holes("a string"),
      // The type system rejects a string event; a cast reaches the run-time check (upstream's test)
      observeActor(started(createMachine<object, EventObject>({ context: {}, entry: raise("a string" as unknown as EventObject) })))
    ),
  ],
  [
    "src/actions/raise.ts:157 warning",
    reaching(
      holes(),
      observeLogs(
        started(
          createMachine<object, EventObject>({
            context: {},
            entry: () => {
              raise({ type: "a" })
            },
          })
        )
      )
    ),
  ],
  [
    "src/actions/send.ts:72 actor-error",
    reaching(
      holes("a string"),
      observeActor(
        afterGo(
          createMachine<object, GoEvent>({
            context: {},
            entry: spawnChild<object, GoEvent, AnyActorLogic>(createMachine({}), { id: "child" }),
            on: { GO: { actions: sendTo<object, GoEvent>("child", "a string" as unknown as EventObject) } },
          })
        )
      )
    ),
  ],
  [
    "src/actions/send.ts:115 actor-error",
    reaching(
      holes("child", "parent"),
      observeActor(
        afterGo(
          createMachine<object, GoEvent>({
            id: "parent",
            context: {},
            on: { GO: { actions: sendTo<object, GoEvent>("child", { type: "PING" }) } },
          })
        )
      )
    ),
  ],
  [
    "src/actions/send.ts:252 warning",
    reaching(
      holes(),
      observeLogs(
        started(
          createMachine<object, EventObject>({
            context: {},
            entry: () => {
              sendTo("nobody", { type: "c" })
            },
          })
        )
      )
    ),
  ],
  [
    "src/actions/send.ts:367 actor-error",
    reaching(
      holes(),
      observeActor(
        afterGo(
          createMachine<object, GoEvent>({
            context: {},
            on: { GO: { actions: forwardTo<object, GoEvent>(() => undefined) } },
          })
        )
      )
    ),
  ],
  [
    "src/actions/spawnChild.ts:80 warning",
    reaching(
      holes("child", "inv1-root"),
      observeLogs(
        Effect.tap(
          createActor(
            createMachine<object, EventObject>({
              context: {},
              entry: spawnChild<object, EventObject, AnyActorLogic>("child", { id: "c" }),
            }),
            { id: "inv1-root" }
          ),
          (actor) => actor.start
        )
      )
    ),
  ],
  [
    "src/assert.ts:45 effect-failure",
    reaching(
      holes('{"type":"OTHER"}', 'type matching "FEEDBACK.*"'),
      observeEffect(() => {
        const event: EventObject = { type: "OTHER" }
        return assertEvent(event, "FEEDBACK.*")
      })
    ),
  ],
  [
    "src/createActor.ts:190 actor-error",
    reaching(
      holes("other", "parent"),
      Effect.gen(function* () {
        const other = yield* Effect.tap(createActor(fromCallback(() => () => undefined), { id: "other" }), (created) => created.start)
        return yield* observeActor(
          afterGo(
            createMachine<object, GoEvent>({
              context: {},
              on: { GO: { actions: stopChild<object, GoEvent>(() => other) } },
            }),
            "parent"
          )
        )
      })
    ),
  ],
  [
    "src/createActor.ts:651 effect-failure",
    reaching(
      holes(),
      Effect.gen(function* () {
        const parent = yield* createActor(createMachine({}))
        const child = yield* Effect.tap(createActor(createMachine({}), { parent: parent.ref }), (created) => created.start)
        const observed = yield* observeEffect(() => child.stop)
        // Upstream throws before `_stop`: the child goes on
        assert.strictEqual((yield* child.getSnapshot).status, "active")
        return observed
      })
    ),
  ],
  [
    "src/createActor.ts:742 warning",
    Effect.gen(function* () {
      const actor = yield* Effect.tap(createActor(createMachine({}), { id: "inv1-stopped" }), (created) => created.start)
      yield* actor.stop
      const observed = yield* observeLogs(actor.send({ type: "TIMER" }))
      return [observed, holes("TIMER", "inv1-stopped", actor.sessionId, '{"type":"TIMER"}')] as const
    }),
  ],
  [
    "src/createActor.ts:759 effect-failure",
    reaching(
      holes("EVENT"),
      Effect.gen(function* () {
        const actor = yield* Effect.tap(createActor(createMachine({})), (created) => created.start)
        // The type system rejects a string event; a cast reaches the run-time check (SD-3)
        const sendAny = actor.send as unknown as (event: unknown) => Effect.Effect<void>
        return yield* observeEffect(() => sendAny("EVENT"))
      })
    ),
  ],
  [
    "src/createActor.ts:820 actor-error",
    reaching(
      holes(),
      // An initial-entry assigner reads its own actor's snapshot, which does not exist yet
      observeActor(
        createActor(
          createMachine({
            context: { n: 0 },
            entry: assign(({ self }) => Effect.map(self.getSnapshot, () => ({ n: 1 }))),
          })
        )
      )
    ),
  ],
  [
    "src/dev/index.ts:35 warning",
    // The dev entry's lookup with none of the four global objects (the T7.13 seam)
    reaching(holes(), observeLogs(firstGlobalObject([Option.none(), Option.none(), Option.none(), Option.none()]))),
  ],
  [
    "src/graph/TestModel.ts:240 effect-failure",
    reaching(
      { rethrown: `inv1 event${PATH_TO_B_AT_GO}` },
      pathTest({ events: { GO: () => Effect.fail(new Error("inv1 event")) } })
    ),
  ],
  [
    "src/graph/TestModel.ts:248 effect-failure",
    reaching(
      { rethrown: `inv1 state${PATH_TO_B_AT_GO}` },
      pathTest({
        states: {
          b: () => {
            throw new Error("inv1 state")
          },
        },
      })
    ),
  ],
  [
    "src/graph/TestModel.ts:254 effect-failure",
    reaching(
      { rethrown: `inv1 path${PATH_TO_B_AT_INIT}` },
      pathTest({
        states: {
          a: () => {
            throw new Error("inv1 path")
          },
        },
      })
    ),
  ],
  [
    "src/graph/adjacency.ts:63 effect-failure",
    reaching(holes(), observeEffect(() => getAdjacencyMap(unboundedCounter, { limit: 100 }))),
  ],
  [
    "src/graph/graph.ts:227 effect-failure",
    reaching(
      holes(),
      Effect.gen(function* () {
        const machine = createMachine({
          id: "inv1-join",
          initial: "a",
          states: { a: { on: { NEXT: "b" } }, b: { on: { TO_C: "c" } }, c: {} },
        })
        const [toB] = yield* Effect.orDie(getPathsFromEvents(machine, [{ type: "NEXT" }]))
        const [toCFromA] = yield* Effect.orDie(getPathsFromEvents(machine, [{ type: "TO_C" }]))
        // The second path starts at `a`, not where the first one ends
        return yield* observeEffect(() =>
          toB === undefined || toCFromA === undefined ? Effect.die("no paths") : joinPaths(toB, toCFromA)
        )
      })
    ),
  ],
  [
    "src/graph/pathFromEvents.ts:93 effect-failure",
    reaching(
      holes('{"value":"a"}', '{"type":"NEXT"}'),
      observeEffect(() =>
        getPathsFromEvents(
          createMachine({ id: "inv1-invalid", initial: "a", states: { a: { on: { NEXT: "b" } }, b: {} } }),
          [{ type: "NEXT" }],
          // No event is in the adjacency map, so NEXT has no next state from `a`
          { filterEvents: () => false }
        )
      )
    ),
  ],
  [
    "src/graph/validateMachine.ts:5 effect-failure",
    reaching(holes(), observeEffect(() => createTestModel(createMachine({ invoke: { src: "myInvoke" } })))),
  ],
  [
    "src/graph/validateMachine.ts:8 effect-failure",
    reaching(holes(), observeEffect(() => createTestModel(createMachine({ after: { 5000: { actions: () => {} } } })))),
  ],
  [
    "src/graph/validateMachine.ts:24 effect-failure",
    reaching(
      holes(),
      observeEffect(() => createTestModel(createMachine({ entry: [raise({ type: "EVENT" }, { delay: 1000 })] })))
    ),
  ],
  [
    "src/guards.ts:356 actor-error",
    reaching(
      holes("doesNotExist"),
      observeActor(
        afterGo(
          createMachine<object, GoEvent>({
            context: {},
            on: {
              GO: {
                actions: enqueueActions<object, GoEvent>(({ check }) => {
                  check("doesNotExist")
                }),
              },
            },
          })
        )
      )
    ),
  ],
  [
    "src/reportUnhandledError.ts:11 warning",
    reaching(
      { rethrown: "inv1 unhandled" },
      observeLogs(
        started(
          createMachine<object, EventObject>({
            context: {},
            entry: () => {
              throw new Error("inv1 unhandled")
            },
          })
        )
      )
    ),
  ],
  [
    "src/scxml.ts:118 sync",
    reaching(
      holes("1.5000s"),
      observeSync(() => toMachine(scxml(`<state id="a"><onentry><send event="e" delay="1.5000s"/></onentry></state>`)))
    ),
  ],
  [
    "src/scxml.ts:124 sync",
    reaching(
      holes("soon"),
      observeSync(() => toMachine(scxml(`<state id="a"><onentry><send event="e" delay="soon"/></onentry></state>`)))
    ),
  ],
  [
    "src/scxml.ts:230 sync",
    reaching(
      holes(),
      observeSync(() => toMachine(scxml(`<state id="a"><onentry><send event="e"><content>x</content></send></onentry></state>`)))
    ),
  ],
  [
    "src/scxml.ts:337 sync",
    reaching(
      holes("script"),
      observeSync(() => toMachine(scxml(`<state id="a"><onentry><script>x = 1</script></onentry></state>`)))
    ),
  ],
  [
    "src/scxml.ts:517 sync",
    reaching(
      holes(),
      observeSync(() => toMachine(scxml(`<state id="a"><invoke type="http://example.com/other"/></state>`)))
    ),
  ],
  [
    "src/scxml.ts:534 sync",
    reaching(holes("a b"), observeSync(() => toMachine(scxml(`<state id="a"/><state id="b"/>`, "a b")))),
  ],
  [
    "src/scxml.ts:580 sync",
    reaching(
      holes(),
      observeSync(() =>
        toMachine(scxml(`<datamodel><data id="x" src="file.json"/></datamodel><state id="a"/>`))
      )
    ),
  ],
  [
    "src/spawn.ts:94 actor-error",
    reaching(
      holes("child", "parent"),
      observeActor(
        Effect.gen(function* () {
          const machine = createMachine<Refs, GoEvent>({
            id: "parent",
            context: {},
            on: { GO: { actions: assign<Refs, GoEvent>({ ref: ({ spawn }) => spawn("child") }) } },
          })
          const actor = yield* Effect.tap(createActor(machine), (created) => created.start)
          yield* actor.send({ type: "GO" })
          return actor
        })
      )
    ),
  ],
  [
    "src/stateUtils.ts:293 effect-failure",
    reaching(
      holes("(machine).a"),
      // The type of a transition config has no `cond`; upstream's run-time check reads it
      definitionFailure({
        initial: "a",
        states: { a: { on: { E: { target: "b", ...({ cond: () => true } as object) } } }, b: {} },
      })
    ),
  ],
  [
    "src/stateUtils.ts:329 effect-failure",
    reaching(holes(), definitionFailure({ initial: "a", states: { a: { on: { "": "b" } }, b: {} } })),
  ],
  [
    "src/stateUtils.ts:453 actor-error",
    reaching(
      holes("create", "fetchMachine"),
      Effect.suspend(() => {
        // Upstream createMachine does not throw for an initial key that names no child
        const config = { id: "fetchMachine", initial: "create", states: { idle: {} } }
        return observeActor(createActor(createMachine(config)))
      })
    ),
  ],
  [
    "src/stateUtils.ts:512 effect-failure",
    reaching(
      holes("(machine).a", "Child state 'c' does not exist on '(machine)'"),
      definitionFailure({ initial: "a", states: { a: { on: { E: "c" } } } })
    ),
  ],
  [
    "src/stateUtils.ts:517 effect-failure",
    reaching(
      holes("a", "a"),
      definitionFailure({ initial: "a", on: { E: "a" }, states: { a: {} } })
    ),
  ],
  [
    "src/stateUtils.ts:593 effect-failure",
    reaching(
      holes("c", "(machine)"),
      bothObserved(
        definitionFailure({ initial: "a", on: { E: ".c" }, states: { a: {} } }),
        observeEffect(() => getStateNodes(createMachine({ initial: "a", states: { a: {} } }).root, { c: "d" }))
      )
    ),
  ],
  [
    "src/stateUtils.ts:593 actor-error",
    reaching(holes("c", "(machine)"), restoredWithValue({ c: "d" })),
  ],
  [
    "src/stateUtils.ts:641 effect-failure",
    reaching(
      holes("invalid", "(machine)"),
      bothObserved(
        observeEffect(() => createMachine({ initial: "a", states: { a: {} } }).resolveState({ value: "invalid" })),
        observeEffect(() => getStateNodes(createMachine({ initial: "a", states: { a: {} } }).root, "invalid"))
      )
    ),
  ],
  [
    "src/stateUtils.ts:641 actor-error",
    reaching(holes("invalid", "(machine)"), restoredWithValue("invalid")),
  ],
  [
    "src/stateUtils.ts:1131 actor-error",
    reaching(
      { rethrown: "inv1 action" },
      observeActor(
        afterGo(
          createMachine<object, GoEvent>({
            context: {},
            on: {
              GO: {
                actions: () => {
                  throw new Error("inv1 action")
                },
              },
            },
          })
        )
      )
    ),
  ],
  [
    "src/stateUtils.ts:1685 actor-error",
    reaching(
      holes("*"),
      observeActor(
        Effect.gen(function* () {
          const actor = yield* started(routing("*"))
          yield* actor.send({ type: "*" })
          return actor
        })
      )
    ),
  ],
  [
    "src/stateUtils.ts:1764 actor-error",
    reaching(
      holes("3"),
      observeActor(
        Effect.gen(function* () {
          const actor = yield* started(
            createMachine<object, EventObject>({
              initial: "idle",
              context: {},
              options: { maxIterations: 3 },
              states: {
                idle: { on: { PING: "ping" } },
                ping: { entry: raise<object, EventObject>({ type: "PONG" }), on: { PONG: "pong" } },
                pong: { entry: raise<object, EventObject>({ type: "PING" }), on: { PING: "ping" } },
              },
            })
          )
          yield* actor.send({ type: "PING" })
          return actor
        })
      )
    ),
  ],
  [
    "src/system.ts:198 actor-error",
    reaching(
      holes("test"),
      observeActor(
        Effect.gen(function* () {
          const machine = createMachine({
            initial: "inactive",
            states: {
              inactive: { on: { toggle: "active" } },
              active: {
                invoke: [
                  { src: createMachine({}), systemId: "test" },
                  { src: createMachine({}), systemId: "test" },
                ],
              },
            },
          })
          const actor = yield* Effect.tap(createActor(machine), (created) => created.start)
          yield* actor.send({ type: "toggle" })
          return actor
        })
      )
    ),
  ],
  [
    "src/utils.ts:179 warning",
    reaching(
      holes("\n - count: ({ context }) =>context.count"),
      observeLogs(
        started(
          createMachine<object, EventObject>({
            initial: "a",
            context: {},
            // A mapper object: upstream checks it for function values and warns (only for `output`)
            output: { count: MAPPING_FUNCTION, label: "fixed" } as never,
            states: { a: { type: "final" } },
          })
        )
      )
    ),
  ],
  [
    "src/utils.ts:314 warning",
    reaching(
      holes("event.*.bar.*"),
      observeLogs(Effect.flatMap(started(routing("event.*.bar.*")), (actor) => actor.send({ type: "event.foo.bar.baz" })))
    ),
  ],
  [
    "src/utils.ts:334 warning",
    reaching(
      holes("*.event.*"),
      observeLogs(Effect.flatMap(started(routing("*.event.*")), (actor) => actor.send({ type: "x.event.y" })))
    ),
  ],
  [
    "src/waitFor.ts:60 warning",
    reaching(
      holes(),
      Effect.gen(function* () {
        const actor = yield* Effect.tap(createActor(createMachine({})), (created) => created.start)
        // A current match succeeds at once, so only the report remains (P9)
        return yield* observeLogs(waitFor(actor, () => true, { timeout: -1 }))
      })
    ),
  ],
  [
    "src/waitFor.ts:69 effect-failure",
    reaching(
      holes("50"),
      Effect.gen(function* () {
        const actor = yield* Effect.tap(createActor(createMachine({})), (created) => created.start)
        const waiting = yield* Effect.forkChild(observeEffect(() => waitFor(actor, () => false, { timeout: 50 })))
        yield* Effect.yieldNow
        yield* TestClock.adjust("50 millis")
        return yield* Fiber.join(waiting)
      })
    ),
  ],
  [
    "src/waitFor.ts:122 effect-failure",
    reaching(
      holes(),
      Effect.gen(function* () {
        const machine = createMachine({ initial: "done", states: { done: { type: "final" } } })
        const actor = yield* Effect.tap(createActor(machine), (created) => created.start)
        return yield* observeEffect(() => waitFor(actor, () => false))
      })
    ),
  ],
])


/** The stubs of the built-in creators: the port's creators return definition objects (D15). */
const STUB_SITES: ReadonlyArray<string> = [
  "src/actions/assign.ts:176",
  "src/actions/cancel.ts:96",
  "src/actions/emit.ts:140",
  "src/actions/enqueueActions.ts:319",
  "src/actions/log.ts:90",
  "src/actions/raise.ts:167",
  "src/actions/send.ts:262",
  "src/actions/spawnChild.ts:221",
  "src/actions/stopChild.ts:127",
  "src/guards.ts:119",
  "src/guards.ts:181",
  "src/guards.ts:254",
  "src/guards.ts:325",
]

/**
 * The entries the port does not reach with upstream's text on the table's channel, each with
 * the deviation row of `test/upstream/CONFORMANCE.md` that records it and cites its decision.
 */
const LEDGERED: ReadonlyMap<string, string> = new Map([
  // A creator's result is a definition object, not a function that throws when called (D15)
  ...STUB_SITES.map((site) => [`${site} actor-error`, "DEV-61"] as const),
  // Every machine snapshot carries its machine, and `can` is attached by one constructor (SD-6)
  ["src/State.ts:310 warning", "DEV-62"],
])

/**
 * The entries that no input reaches, upstream or in the port, with the reason. A test below
 * runs the nearest input in the port where one exists.
 */
const UNREACHABLE: ReadonlyMap<string, string> = new Map([
  [
    "src/StateMachine.ts:180 warning",
    "upstream's check `!('output' in this.root)` never holds: the StateNode constructor always assigns `this.output`, so a root without an `output` still has the key; the port logs nothing either",
  ],
  [
    "src/stateUtils.ts:587 effect-failure",
    "every state node has a `states` object, upstream (`EMPTY_OBJECT` for a node without children) and in the port (src/stateUtils.ts, comment of the child lookup), so the child lookup never finds none",
  ],
])

const ALL_ENTRIES: ReadonlyArray<{
  readonly file: string
  readonly line: number
  readonly kind: ThrowSite["kind"] | "reject"
  readonly source: string
  readonly channel: Channel
  readonly trigger: string
}> = [...throwSites, ...rejectionSites]

const LEDGER_PATH = join(pkgRoot, "test/upstream/CONFORMANCE.md")

/** The cells of the deviation row `id` of the conformance ledger, or none. */
const deviationRow = (ledger: string, id: string): Option.Option<ReadonlyArray<string>> =>
  Option.map(
    Option.fromUndefinedOr(ledger.split("\n").find((line) => line.startsWith(`| ${id} |`))),
    (line) => line.split(" | ").map((cell) => cell.replace(/^\| ?| ?\|$/g, ""))
  )

describe("INV-1 triggers: each site's port operation uses the table's channel and the recorded text (T8.9)", () => {
  it("[INV-1] every table entry has exactly one of a trigger, a ledger row and an unreachable reason, and the lists name only table entries", () => {
    const keys = ALL_ENTRIES.map(entryKey)
    assert.strictEqual(new Set(keys).size, keys.length)
    for (const key of keys) {
      const listed = [TRIGGERS.has(key), LEDGERED.has(key), UNREACHABLE.has(key)].filter(Boolean).length
      assert.strictEqual(listed, 1, `${key}: one of a trigger, a ledger row and an unreachable reason`)
    }
    for (const key of [...TRIGGERS.keys(), ...LEDGERED.keys(), ...UNREACHABLE.keys()]) {
      assert.include(keys, key)
    }
    // The size of each list, so a change shows here
    assert.deepStrictEqual([TRIGGERS.size, LEDGERED.size, UNREACHABLE.size], [61, 14, 2])
  })

  it.effect("[INV-1] each ledgered entry's row is a deviation that names the site and cites a decision", () =>
    Effect.gen(function* () {
      const ledger = yield* Effect.sync(() => readFileSync(LEDGER_PATH, "utf8"))
      for (const [key, id] of LEDGERED) {
        const site = key.split(" ")[0] ?? ""
        const row = deviationRow(ledger, id)
        assert.isTrue(Option.isSome(row), `${key}: ${id} is a row of the ledger`)
        if (Option.isNone(row)) continue
        const [, kind = "", subject = "", upstream = "", port = "", decision = ""] = row.value
        assert.strictEqual(kind, "deviation", `${id} is a deviation`)
        assert.include(`${subject} ${upstream} ${port}`, `\`${site}\``, `${id} names ${site}`)
        assert.match(decision, /\b(?:D\d+|SD-\d+)\b/, `${id} cites a decision`)
      }
    }))

  for (const entry of ALL_ENTRIES) {
    const key = entryKey(entry)
    const trigger = TRIGGERS.get(key)
    if (trigger === undefined) continue
    it.effect(`[INV-1] ${key}: ${entry.trigger}`, () =>
      Effect.gen(function* () {
        const [observed, expected] = yield* trigger
        assert.strictEqual("rethrown" in expected, entry.kind === "rethrow", "a rethrow site expects the original error")
        if ("holes" in expected) {
          assert.strictEqual(expected.holes.length, templateParts(entry.source).holes.length, "one value per template hole")
        }
        const text = "holes" in expected ? fillTemplate(entry.source, expected.holes) : expected.rethrown

        assert.strictEqual(observed.channel, entry.channel)
        assert.include(observed.messages, text)
        if (entry.channel === "sync") {
          // Only the D4 converter (test support) throws, a plain Error, as upstream's (SD-3, amended
          // 2026-10-08: no package site throws)
          assert.strictEqual(observed.tagged, !isD4ConverterSite(entry), "an SD-3 throw is a Data.TaggedError")
        }
        if (observed.channel === "effect-failure") {
          assert.strictEqual(observed.defect, /\bdefect\b/.test(entry.trigger), "a defect only where the trigger says so")
        }
        if (observed.channel === "warning") {
          assert.strictEqual(
            observed.levels[observed.messages.indexOf(text)],
            entry.kind === "console.warn" ? "Warn" : "Error",
            "console.warn logs at Warn; console.error and the SD-21 report log at Error"
          )
        }
      }))
  }

  it.effect("[INV-1] the root getStateNodes with a #id key that names no state node fails its Effect with the text of src/StateMachine.ts:525, a createMachine definition error (SD-3)", () =>
    Effect.gen(function* () {
      const root = createMachine({ initial: "a", states: { a: {} } }).root
      const byId = yield* observeEffect(() => getStateNodes(root, { "#missing": "d" }))
      const source = throwSites.find((entry) => entryKey(entry) === "src/StateMachine.ts:525 effect-failure")?.source ?? ""
      assert.deepStrictEqual(byId, { ...NOTHING, channel: "effect-failure", messages: [fillTemplate(source, ["missing", "(machine)"])] })
    }))

  it.effect("[INV-1] src/StateMachine.ts:180 is unreachable upstream: a top-level final state with output and no machine output logs nothing in the port either", () =>
    Effect.gen(function* () {
      const observed = yield* observeLogs(
        started(
          createMachine<object, EventObject>({
            initial: "a",
            context: {},
            states: { a: { type: "final", output: { x: 1 } } },
          })
        )
      )
      assert.deepStrictEqual(observed, NOTHING)
    }))

  it.effect("[INV-1] src/utils.ts:179: an input mapper object logs no warning, as upstream checks only output mappers", () =>
    Effect.gen(function* () {
      const observed = yield* observeLogs(
        started(
          createMachine<object, EventObject>({
            context: {},
            entry: spawnChild<object, EventObject, AnyActorLogic>(createMachine({}), {
              id: "c",
              input: { count: MAPPING_FUNCTION } as never,
            }),
          })
        )
      )
      assert.deepStrictEqual(observed, NOTHING)
    }))
})
