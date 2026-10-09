/**
 * A8: log logs once with the XState signature.
 *
 * T4.14. Upstream `src/actions/log.ts` at xstate@5.33.2:
 *
 * - `log(value = ({ context, event }) => ({ context, event }), label?)`;
 * - `resolveLog` computes the value with the action arguments of that point of the action
 *   list: a string as it is, a function called `(actionArgs, actionParams)`, whatever it
 *   gives (not only a string);
 * - `executeLog` calls the actor's logger once: `logger(label, value)` with a label,
 *   `logger(value)` without one;
 * - the execution goes through `actorScope.actionExecutor`, which runs it at once in a
 *   running actor and queues it until `start` before that, so a log in an initial entry
 *   action logs at `start`.
 *
 * The `logger` actor option and its propagation to children come with phase 5 (C22); the
 * default logger is Effect logging (C12), so a test logger sees one entry per log action,
 * whose message is `[label, value]` or `[value]`. The port keeps its levels: `{ level }` as
 * the second argument and the helpers `logDebug`, `logInfo`, `logWarning`, `logError` map to
 * the Effect log levels; each entry carries the actorId and sessionId annotations. A value
 * function that throws sets status `error` with the thrown value (SD-4). The SCXML converter
 * passes a `<log>` element's `label` attribute as upstream's converter does.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Logger, Option, References } from "effect"
import {
  assign,
  createActor,
  createMachine,
  log,
  logDebug,
  logError,
  logInfo,
  logWarning,
  type EventObject,
} from "../../src/index.js"
import { toMachine } from "../upstream/support/scxml.js"

/** One log entry as a test logger saw it, with the annotations read at log time. */
interface Entry {
  readonly logLevel: Logger.Options<unknown>["logLevel"]
  /** The message as the argument list a logger function would receive */
  readonly message: ReadonlyArray<unknown>
  readonly annotations: Readonly<Record<string, unknown>>
}

/** The log entries a test logger kept. */
type Entries = Array<Entry>

/** Runs `program` with a logger that keeps every log entry, Debug included, in `entries`. */
const withLogger = <A, E, R>(entries: Entries, program: Effect.Effect<A, E, R>) =>
  program.pipe(
    Effect.provide(
      Logger.layer([
        Logger.make((options) => {
          entries.push({
            logLevel: options.logLevel,
            message: Array.isArray(options.message) ? options.message : [options.message],
            annotations: options.fiber.getRef(References.CurrentLogAnnotations),
          })
        }),
      ])
    ),
    Effect.provideService(References.MinimumLogLevel, "All")
  )

/** The message of one entry. */
const messageOf = (entry: Entry): ReadonlyArray<unknown> => entry.message

interface Ctx {
  readonly count: number
}

type Ev = { readonly type: "EV"; readonly n: number } | { readonly type: "INC" }

describe("A8 log logs once with the XState signature", () => {
  it.effect("[A8] each log action logs exactly one entry", () => {
    const entries: Entries = []
    return withLogger(
      entries,
      Effect.gen(function* () {
        const machine = createMachine<Ctx, Ev>({
          id: "a8-once",
          context: { count: 0 },
          entry: [log("entry a"), log("entry b")],
          on: { EV: { actions: log("on EV") } },
        })
        const actor = yield* createActor(machine, { id: "a8-once" })
        yield* actor.start
        yield* actor.send({ type: "EV", n: 1 })

        assert.deepStrictEqual(
          entries.map(messageOf),
          [["entry a"], ["entry b"], ["on EV"]]
        )
      })
    )
  })

  it.effect("[A8] log() with no arguments logs the context and the event", () => {
    const entries: Entries = []
    return withLogger(
      entries,
      Effect.gen(function* () {
        const machine = createMachine<Ctx, Ev>({
          id: "a8-default",
          context: { count: 1 },
          on: { EV: { actions: log() } },
        })
        const actor = yield* createActor(machine, { id: "a8-default" })
        yield* actor.start
        yield* actor.send({ type: "EV", n: 2 })

        assert.deepStrictEqual(entries.map(messageOf), [
          [{ context: { count: 1 }, event: { type: "EV", n: 2 } }],
        ])
      })
    )
  })

  it.effect("[A8] the label form passes the label and the value to the logger", () => {
    const entries: Entries = []
    return withLogger(
      entries,
      Effect.gen(function* () {
        const machine = createMachine<Ctx, Ev>({
          id: "a8-label",
          context: { count: 42 },
          on: {
            EV: {
              actions: [
                log("some string", "string label"),
                log(({ context }) => `expr ${context.count}`, "expr label"),
              ],
            },
          },
        })
        const actor = yield* createActor(machine, { id: "a8-label" })
        yield* actor.start
        yield* actor.send({ type: "EV", n: 0 })

        assert.deepStrictEqual(entries.map(messageOf), [
          ["string label", "some string"],
          ["expr label", "expr 42"],
        ])
      })
    )
  })

  it.effect("[A8] a value that is no string is logged unchanged, computed with the context of that point of the list", () => {
    const entries: Entries = []
    const payload = { nested: [1, 2] }
    return withLogger(
      entries,
      Effect.gen(function* () {
        const machine = createMachine<Ctx, Ev>({
          id: "a8-value",
          context: { count: 0 },
          on: {
            INC: {
              actions: [assign({ count: ({ context }) => context.count + 1 }), log(({ context }) => context)],
            },
            EV: { actions: log(() => payload) },
          },
        })
        const actor = yield* createActor(machine, { id: "a8-value" })
        yield* actor.start
        yield* actor.send({ type: "INC" })
        yield* actor.send({ type: "INC" })
        yield* actor.send({ type: "EV", n: 0 })

        const messages = entries.map(messageOf)
        assert.deepStrictEqual(messages.slice(0, 2), [[{ count: 1 }], [{ count: 2 }]])
        assert.strictEqual(messages.length, 3)
        assert.strictEqual(messages[2]?.[0], payload)
      })
    )
  })

  it.effect("[A8] the value function receives the action arguments and the params of the use", () => {
    const entries: Entries = []
    return withLogger(
      entries,
      Effect.gen(function* () {
        const seen: Array<{ readonly selfId: string; readonly eventType: string }> = []
        const machine = createMachine<Ctx, Ev>(
          {
            id: "a8-params",
            context: { count: 0 },
            on: { EV: { actions: { type: "report", params: { n: 7 } } } },
          },
          {
            actions: {
              report: log<Ctx, Ev>(({ self, event }, params) => {
                seen.push({ selfId: self.id, eventType: event.type })
                return params
              }, "params"),
            },
          }
        )
        const actor = yield* createActor(machine, { id: "a8-params" })
        yield* actor.start
        yield* actor.send({ type: "EV", n: 0 })

        assert.deepStrictEqual(seen, [{ selfId: "a8-params", eventType: "EV" }])
        assert.deepStrictEqual(entries.map(messageOf), [["params", { n: 7 }]])
      })
    )
  })

  it.effect("[A8] the level option and the level helpers keep mapping to Effect log levels", () => {
    const entries: Entries = []
    return withLogger(
      entries,
      Effect.gen(function* () {
        const machine = createMachine<Ctx, Ev>({
          id: "a8-levels",
          context: { count: 0 },
          on: {
            EV: {
              actions: [
                log("plain"),
                log("warned", { level: "warning" }),
                log("labelled", { level: "error", label: "with label" }),
                logDebug("debug"),
                logInfo("info"),
                logWarning("warning"),
                logError("error"),
              ],
            },
          },
        })
        const actor = yield* createActor(machine, { id: "a8-levels" })
        yield* actor.start
        yield* actor.send({ type: "EV", n: 0 })

        assert.deepStrictEqual(
          entries.map((entry) => [entry.logLevel, ...messageOf(entry)]),
          [
            ["Info", "plain"],
            ["Warn", "warned"],
            ["Error", "with label", "labelled"],
            ["Debug", "debug"],
            ["Info", "info"],
            ["Warn", "warning"],
            ["Error", "error"],
          ]
        )
      })
    )
  })

  it.effect("[A8] each entry carries the actorId and sessionId annotations", () => {
    const entries: Entries = []
    return withLogger(
      entries,
      Effect.gen(function* () {
        const machine = createMachine<Ctx, Ev>({
          id: "a8-annotations",
          context: { count: 0 },
          on: { EV: { actions: log("annotated") } },
        })
        const actor = yield* createActor(machine, { id: "a8-annotations" })
        yield* actor.start
        yield* actor.send({ type: "EV", n: 0 })

        const logged = entries.filter((entry) => messageOf(entry)[0] === "annotated")
        assert.strictEqual(logged.length, 1)
        const annotations = logged[0]!.annotations
        assert.strictEqual(annotations["actorId"], actor.id)
        assert.strictEqual(annotations["sessionId"], actor.sessionId)
      })
    )
  })

  it.effect("[A8] a log value function that throws sets status error with the thrown value", () => {
    const entries: Entries = []
    return withLogger(
      entries,
      Effect.gen(function* () {
        const thrown = new Error("thrown in a log expression")
        const machine = createMachine<Ctx, Ev>({
          id: "a8-throw",
          initial: "a",
          context: { count: 0 },
          states: {
            a: {
              on: {
                EV: {
                  target: "b",
                  actions: log(() => {
                    throw thrown
                  }),
                },
              },
            },
            b: {},
          },
        })
        const actor = yield* createActor(machine, { id: "a8-throw" })
        yield* actor.start
        yield* actor.send({ type: "EV", n: 0 })

        const snapshot = yield* actor.getSnapshot
        assert.strictEqual(snapshot.status, "error")
        assert.isTrue(Option.isSome(snapshot.error), "the snapshot holds an error")
        assert.strictEqual(Option.getOrUndefined(snapshot.error), thrown)
        assert.deepStrictEqual(
          entries.filter((entry) => entry.logLevel === "Info"),
          []
        )
      })
    )
  })

  it.effect("[A8] log() in an initial entry action logs nothing at creation and once at start", () => {
    const entries: Entries = []
    return withLogger(
      entries,
      Effect.gen(function* () {
        const machine = createMachine<Ctx, EventObject>({
          id: "a8-initial",
          context: { count: 5 },
          entry: log(),
        })
        const actor = yield* createActor(machine, { id: "a8-initial" })

        assert.deepStrictEqual(entries, [], "nothing is logged at creation")

        yield* actor.start

        assert.deepStrictEqual(entries.map(messageOf), [
          [{ context: { count: 5 }, event: { type: "xstate.init", input: undefined } }],
        ])
      })
    )
  })

  it.effect("[A8] a converted SCXML <log> passes its label and the value of its expression to the logger", () => {
    const entries: Entries = []
    return withLogger(
      entries,
      Effect.gen(function* () {
        // Upstream `src/scxml.ts` (case 'log'): `log(expr, label !== undefined ? String(label) : undefined)`
        const machine = toMachine(`<?xml version="1.0" encoding="UTF-8"?>
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" initial="a">
  <datamodel><data id="n" expr="3"/></datamodel>
  <state id="a">
    <onentry>
      <log label="n" expr="n + 1"/>
      <log expr="{ n: n }"/>
    </onentry>
  </state>
</scxml>`)
        const actor = yield* createActor(machine)
        yield* actor.start

        assert.deepStrictEqual(entries.map(messageOf), [["n", 4], [{ n: 3 }]])
      })
    )
  })
})
