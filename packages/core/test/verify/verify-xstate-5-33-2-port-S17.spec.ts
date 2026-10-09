/**
 * S17: wildcard and partial event descriptors match.
 *
 * T3.18. Upstream `matchesEventDescriptor` (`src/utils.ts` at xstate@5.33.2): a descriptor
 * matches an event type that equals it; `*` matches every type; a partial descriptor ends in
 * `.*` and matches token by token up to its `*` (`a.*` matches `a`, `a.b` and `a.b.c`, not `ab`
 * or `b.a`). Every other descriptor (`a*`, `a.*.b`) matches only its own text, with no
 * warning. While it matches a descriptor that ends in `.*`, upstream warns "Wildcards can only
 * be the last token ..." when a `*` has text after it, then "Infix wildcards ... are not
 * allowed" when the first `*` token is not the last token (and the tokens before it match);
 * such a descriptor never matches. `getCandidates` (`src/stateUtils.ts`) runs the matcher over
 * every other descriptor of the node, and `StateNode.next` memoizes its result on the node per
 * event type, so the warnings come once per node and event type (T8.8: the port's selection
 * step does the same); the candidates are the exact descriptor's transitions, then the matching ones,
 * longest first, and the first enabled one wins. `macrostep` throws `An event cannot have the
 * wildcard type ('*')` before anything else, so the actor keeps its pre-event snapshot with
 * status `error`.
 *
 * The port logs the warnings through the actor's logger (SD-21); a test logger captures them.
 * The order of the warnings of two invalid descriptors on one node follows the order the node
 * keeps its descriptors in (T3.23); these cases put one invalid descriptor on each node.
 */
import { assert, describe, it } from "@effect/vitest"
import { Cause, Effect, Exit, Logger, Option } from "effect"
import {
  type ActorLogicType,
  ActorScope,
  createActor,
  createMachine,
  type EventObject,
  getInitialSnapshot,
  type MachineSnapshot,
  matchesEventDescriptor,
  type SnapshotType,
} from "../../src/index.js"
import { createInertActorScope } from "../../src/testing/index.js"
import { infixWildcard, wildcardEventType, wildcardNotLast } from "./upstream-messages.js"

/** Runs `program` with a logger that keeps the text of every warning. */
const withWarningsCaptured = <A, E, R>(program: Effect.Effect<A, E, R>) => {
  const warnings: Array<string> = []
  return program.pipe(
    Effect.provide(
      Logger.layer([
        Logger.make((options) => {
          if (options.logLevel === "Warn") {
            const parts: ReadonlyArray<unknown> = Array.isArray(options.message) ? options.message : [options.message]
            warnings.push(parts.map(String).join(" "))
          }
        }),
      ])
    ),
    Effect.map((result) => ({ result, warnings }))
  )
}

/** The `value` of a machine snapshot. */
const valueOf = (snapshot: object): unknown => ("value" in snapshot ? snapshot.value : undefined)

/** The message of the snapshot's error, if it has one. */
const errorMessageOf = (snapshot: SnapshotType): Option.Option<string> =>
  Option.flatMap(snapshot.error, (error) => (error instanceof Error ? Option.some(error.message) : Option.none()))

/** A machine whose state `start` maps each descriptor in `on` to the state of that name. */
const routing = (id: string, on: Readonly<Record<string, string>>) =>
  createMachine<object, EventObject>({
    id,
    initial: "start",
    context: {},
    states: {
      start: { on },
      ...Object.fromEntries(Object.values(on).map((target) => [target, {}])),
    },
  })

/** Starts an actor of `machine`, sends `event`, and gives the snapshot after it and the warnings logged. */
const afterSending = (machine: ReturnType<typeof routing>, event: EventObject) =>
  withWarningsCaptured(
    Effect.gen(function* () {
      const actor = yield* createActor(machine)
      yield* actor.start
      yield* actor.send(event)
      return yield* actor.getSnapshot
    })
  )

/** The state value reached from `start` by `event`, with the warnings it logged. */
const reached = (machine: ReturnType<typeof routing>, type: string) =>
  afterSending(machine, { type }).pipe(Effect.map(({ result, warnings }) => ({ value: valueOf(result), warnings })))

/** The machine logic's `transition`, widened as the engine entry points type it (S21). */
interface MachineLogic {
  readonly transition: (snapshot: MachineSnapshot, event: EventObject) => Effect.Effect<MachineSnapshot, Error, ActorScope>
}

/** The initial snapshot through `getInitialSnapshot`, widened as S21 widens it. */
const initialSnapshotOf = (machine: object): Effect.Effect<MachineSnapshot> =>
  getInitialSnapshot(machine as ActorLogicType.Any, undefined) as unknown as Effect.Effect<MachineSnapshot>

describe("S17 Wildcard and partial event descriptors match", () => {
  it("[S17] the descriptor matrix: exact, *, partial a.* against a, a.b, a.b.c, ab and b.a, and the invalid a* and a.*.b", () => {
    const cases: ReadonlyArray<readonly [descriptor: string, eventType: string, matches: boolean]> = [
      ["a.b", "a.b", true],
      ["a.b", "a.c", false],
      ["*", "anything", true],
      ["*", "a.b.c", true],
      ["a.*", "a", true],
      ["a.*", "a.b", true],
      ["a.*", "a.b.c", true],
      ["a.*", "ab", false],
      ["a.*", "b.a", false],
      ["a.b.*", "a.b.c.d", true],
      ["a.b.*", "a.c.d", false],
      ["a*", "a", false],
      ["a*", "ab", false],
      ["a*", "a*", true],
      ["a.*.b", "a.x.b", false],
      ["a.*.b", "a.*.b", true],
      ["a.*.b.*", "a.x.b.y", false],
      ["*.a.*", "x.a.y", false],
      ["a*.b.*", "ab.b.c", false],
    ]
    for (const [descriptor, eventType, matches] of cases) {
      assert.strictEqual(matchesEventDescriptor(eventType, descriptor), matches, `"${descriptor}" against "${eventType}"`)
    }
  })

  it.effect("[S17] the exact descriptor beats a partial one, which beats *, whatever the declaration order", () =>
    Effect.gen(function* () {
      const declarations: ReadonlyArray<Readonly<Record<string, string>>> = [
        { "*": "wildcard", "feedback.*": "partial", "feedback.good": "exact" },
        { "feedback.good": "exact", "feedback.*": "partial", "*": "wildcard" },
        { "feedback.*": "partial", "*": "wildcard", "feedback.good": "exact" },
      ]
      for (const on of declarations) {
        const machine = routing("s17-priority", on)
        const order = Object.keys(on).join(", ")
        assert.strictEqual((yield* reached(machine, "feedback.good")).value, "exact", `feedback.good with ${order}`)
        assert.strictEqual((yield* reached(machine, "feedback.bad")).value, "partial", `feedback.bad with ${order}`)
        assert.strictEqual((yield* reached(machine, "other")).value, "wildcard", `other with ${order}`)
      }
    })
  )

  it.effect("[S17] a longer partial descriptor beats a shorter one, whatever the declaration order", () =>
    Effect.gen(function* () {
      for (const on of [
        { "foo.*": "shorter", "foo.bar.*": "longer" },
        { "foo.bar.*": "longer", "foo.*": "shorter" },
      ]) {
        const machine = routing("s17-longer", on)
        assert.strictEqual((yield* reached(machine, "foo.bar.baz")).value, "longer")
        assert.strictEqual((yield* reached(machine, "foo.qux")).value, "shorter")
      }
    })
  )

  it.effect("[S17] feedback.* matches feedback and feedback.x.y, not feedbackX", () =>
    Effect.gen(function* () {
      const machine = routing("s17-boundary", { "feedback.*": "matched" })

      assert.strictEqual((yield* reached(machine, "feedback")).value, "matched")
      assert.strictEqual((yield* reached(machine, "feedback.x.y")).value, "matched")
      assert.strictEqual((yield* reached(machine, "feedbackX")).value, "start")
      assert.strictEqual((yield* reached(machine, "feedbackX.y")).value, "start")
    })
  )

  it.effect("[S17] when the exact descriptor's guard fails, the partial and then the * candidate is used", () =>
    Effect.gen(function* () {
      const guarded = (exactPasses: boolean, partialPasses: boolean) =>
        createMachine<object, EventObject>({
          id: "s17-fallback",
          initial: "start",
          context: {},
          states: {
            start: {
              on: {
                "foo.bar": { guard: () => exactPasses, target: "exact" },
                "foo.*": { guard: () => partialPasses, target: "partial" },
                "*": "wildcard",
              },
            },
            exact: {},
            partial: {},
            wildcard: {},
          },
        })

      assert.strictEqual((yield* reached(guarded(true, true), "foo.bar")).value, "exact")
      assert.strictEqual((yield* reached(guarded(false, true), "foo.bar")).value, "partial")
      assert.strictEqual((yield* reached(guarded(false, false), "foo.bar")).value, "wildcard")
    })
  )

  it.effect("[S17] a* and the infix a.*.b match nothing but their own text and log no warning, as upstream", () =>
    Effect.gen(function* () {
      const machine = routing("s17-invalid", { "a*": "inToken", "a.*.b": "infix" })

      for (const type of ["a", "ab", "a.b", "a.x.b", "a.x.b.c"]) {
        const { value, warnings } = yield* reached(machine, type)
        assert.strictEqual(value, "start", `"${type}" is not handled`)
        assert.deepStrictEqual(warnings, [], `"${type}" logs no warning`)
      }
      assert.strictEqual((yield* reached(machine, "a*")).value, "inToken")
      assert.strictEqual((yield* reached(machine, "a.*.b")).value, "infix")
    })
  )

  it.effect("[S17] an infix wildcard before a final .* matches nothing and logs both upstream warnings for each event", () =>
    Effect.gen(function* () {
      const infix = routing("s17-infix", { "event.*.bar.*": "success" })

      const first = yield* reached(infix, "event.foo.bar.first.second")
      assert.strictEqual(first.value, "start")
      assert.deepStrictEqual(first.warnings, [wildcardNotLast("event.*.bar.*"), infixWildcard("event.*.bar.*")])

      // The tokens before the first * differ, so upstream stops before the infix warning
      const second = yield* reached(infix, "whatever.event")
      assert.strictEqual(second.value, "start")
      assert.deepStrictEqual(second.warnings, [wildcardNotLast("event.*.bar.*")])

      const leading = yield* reached(routing("s17-leading", { "*.event.*": "success" }), "whatever.event")
      assert.strictEqual(leading.value, "start")
      assert.deepStrictEqual(leading.warnings, [wildcardNotLast("*.event.*"), infixWildcard("*.event.*")])
    })
  )

  it.effect("[S17] a * inside a token before a final .* matches nothing and logs the last-token warning only", () =>
    Effect.gen(function* () {
      const inToken = routing("s17-in-token", { "event*.bar.*": "success" })

      for (const type of ["eventually.bar.baz", "event.bar.baz", "prevent.whatever"]) {
        const { value, warnings } = yield* reached(inToken, type)
        assert.strictEqual(value, "start", `"${type}" is not handled`)
        assert.deepStrictEqual(warnings, [wildcardNotLast("event*.bar.*")], `"${type}" logs one warning`)
      }
    })
  )

  it.effect("[S17] a node logs its warnings once per event type, as upstream memoizes a node's candidates per event type", () =>
    withWarningsCaptured(
      Effect.gen(function* () {
        const machine = routing("s17-once", { "event.*.bar.*": "success" })
        const first = yield* createActor(machine)
        yield* first.start
        yield* first.send({ type: "whatever.event" })
        yield* first.send({ type: "whatever.event" })
        // Another actor of the same machine meets the same state nodes
        const second = yield* createActor(machine)
        yield* second.start
        yield* second.send({ type: "whatever.event" })
        yield* second.send({ type: "other.event" })
        // `provide` builds new state nodes, whose candidates are not memoized yet
        const provided = yield* createActor(machine.provide({}))
        yield* provided.start
        yield* provided.send({ type: "whatever.event" })
        return [yield* first.getSnapshot, yield* second.getSnapshot, yield* provided.getSnapshot].map(valueOf)
      })
    ).pipe(
      Effect.map(({ result, warnings }) => {
        assert.deepStrictEqual(result, ["start", "start", "start"])
        // "whatever.event" on the machine's node, "other.event" on it, "whatever.event" on the provided machine's node
        assert.deepStrictEqual(warnings, [
          wildcardNotLast("event.*.bar.*"),
          wildcardNotLast("event.*.bar.*"),
          wildcardNotLast("event.*.bar.*"),
        ])
      })
    )
  )

  it.effect("[S17] an exact match still logs the warning of another invalid descriptor on the node", () =>
    Effect.gen(function* () {
      const machine = routing("s17-exact-warns", { GO: "go", "x.*.y.*": "never" })

      const { value, warnings } = yield* reached(machine, "GO")
      assert.strictEqual(value, "go")
      assert.deepStrictEqual(warnings, [wildcardNotLast("x.*.y.*")])
    })
  )

  it.effect("[S17] an event whose type is * sets status error with the recorded message and takes no * transition", () =>
    Effect.gen(function* () {
      const machine = routing("s17-star-event", { "*": "wildcard" })

      const { result: snapshot } = yield* afterSending(machine, { type: "*" })

      assert.strictEqual(snapshot.status, "error")
      assert.deepStrictEqual(errorMessageOf(snapshot), Option.some(wildcardEventType))
      assert.strictEqual(valueOf(snapshot), "start", "the * transition is not taken")
    })
  )

  it.effect("[S17] machine.transition fails with the recorded message for an event whose type is *", () =>
    Effect.gen(function* () {
      const machine = routing("s17-star-transition", { "*": "wildcard" })
      const initial = yield* initialSnapshotOf(machine)

      const exit = yield* Effect.exit(
        (machine as unknown as MachineLogic)
          .transition(initial, { type: "*" })
          .pipe(Effect.provideService(ActorScope, createInertActorScope(initial)))
      )

      assert.isTrue(Exit.isFailure(exit), "the macrostep fails")
      const failure = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined
      assert.instanceOf(failure, Error)
      assert.strictEqual((failure as Error).message, wildcardEventType)
    })
  )
})
