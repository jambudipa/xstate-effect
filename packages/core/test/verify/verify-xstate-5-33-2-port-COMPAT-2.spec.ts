/**
 * COMPAT-2: port definition objects work beside the XState forms.
 *
 * T8.7. D15 makes the engine take every XState action and guard form (an inline function that
 * receives `({ context, event, self, system }, params)`, a `{ type, params }` object, a plain
 * function in `setup`, in the implementations argument of `createMachine` and in `provide`)
 * "beside the port's existing definition objects": an `ActionDefinition` (`action(type,
 * exec)`, whose `exec(ctx, params)` gives an `ActionResult`) and a `GuardDefinition`
 * (`guard(type, predicate)`, `when(predicate)`). This file proves that the two kinds mix in one
 * machine and keep one semantics:
 *
 * - in one action list the two kinds run in list order, each reads the context that the
 *   earlier actions left, and both get the same event, `self` and `system`; guards of both
 *   kinds combine under `and`, where each one alone can refuse the transition, and a named
 *   definition and a named function get the params of each use;
 * - the same machine written with port definitions and with XState forms, inline and by
 *   name, and with `provide` swapping one kind for the other, reaches the same snapshots and
 *   runs the same actions for one event script;
 * - a hand-written definition whose `exec` gives a `RaiseEvent`, `EmitEvent` or `SendEvent`
 *   result follows the order of the built-in action: A3 (the raised event is handled in the
 *   same macrostep, before an external event that was already queued), A6 (a listener runs
 *   after the macrostep commits and reads the committed snapshot), A5 (the event reaches a
 *   child by id and by systemId after the macrostep commits, after a `sendTo` before it in the
 *   list, a macrostep that fails delivers none of its sends, and an unknown name sets status
 *   `error` with the recorded message);
 * - the port extras (`assignProperty`, `sendSelf`, `stopAllChildren`, `spawnChildFromRegistry`,
 *   `fromEffectRetry`, `setupWithSchema`) still work in a machine that also uses XState forms.
 *
 * Ordering is proved without fork timing (AS2.a): an external `send` returns after its
 * macrostep and that macrostep's deferred effects (SD-23), and the A3 case puts the external
 * events in the mailbox before `start` and reads the `@xstate.snapshot` inspection events.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option, Queue, Schedule, Schema } from "effect"
import { TestClock } from "effect/testing"
import type { ActorRefBase } from "../../src/ActorRef.js"
import {
  action,
  type ActionDefinition,
  actions,
  type ActorLogicType,
  actors,
  and,
  assign,
  assignProperty,
  type ActorSystemService,
  createActor,
  createMachine,
  emit,
  type EventObject,
  fromCallback,
  guard,
  type MachineSnapshot,
  raise,
  sendSelf,
  sendTo,
  setup,
  setupWithSchema,
  type SnapshotType,
  spawnChild,
  stopAllChildren,
  Types,
  when,
} from "../../src/index.js"
import { unableToSend } from "./upstream-messages.js"

// `spawnChildFromRegistry` and `fromEffectRetry` are public through the root's `actions` and
// `actors` namespaces only (as in the baseline export list)
const { spawnChildFromRegistry } = actions
const { fromEffectRetry } = actors

/** Lets every other ready fiber take ten turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 10; turn++) {
    yield* Effect.yieldNow
  }
})

/** Yields until `condition` holds, at most 200 turns; gives whether it holds. */
const eventually = (condition: Effect.Effect<boolean>) =>
  Effect.gen(function* () {
    for (let turn = 0; turn < 200; turn++) {
      if (yield* condition) {
        return true
      }
      yield* Effect.yieldNow
    }
    return yield* condition
  })

/** The message of an error value. */
const messageOf = (error: unknown): string => String((error as { readonly message?: unknown }).message)

/** A callback child that records its start and its cleanup under `name`. */
const lifecycle = (name: string, log: Array<string>) =>
  fromCallback(() => {
    log.push(`${name} started`)
    return () => {
      log.push(`${name} cleanup`)
    }
  })

interface Count {
  readonly count: number
}

// ---------------------------------------------------------------- one action list, both kinds

/** `GO`; the mixed machine's `when(...)` guard refuses one that holds (`hold: true`). */
type GoEvent = { readonly type: "GO"; readonly hold?: true }

/** What one action of either kind received. */
interface Received {
  readonly kind: string
  readonly event: EventObject
  readonly self: unknown
  readonly system: unknown
}

// ---------------------------------------------------------------- the same machine, four ways

type TwinEvent =
  | { readonly type: "ADD"; readonly amount: number }
  | { readonly type: "CHECK" }
  | { readonly type: "BACK" }

/** The amount an event adds: the `ADD` amount, else 0. */
const amountOf = (event: TwinEvent): number => (event.type === "ADD" ? event.amount : 0)

/** The guards and actions the twin machine uses, written in one of the forms. */
interface TwinUses {
  readonly small: Types.Guard<Count, TwinEvent>
  readonly isEven: Types.Guard<Count, TwinEvent>
  readonly add: Types.Action<Count, TwinEvent>
  readonly recordAdded: Types.Action<Count, TwinEvent>
  readonly recordOverflow: Types.Action<Count, TwinEvent>
  readonly recordEntry: Types.Action<Count, TwinEvent>
}

/**
 * `idle` takes `ADD` with a small amount (adds it, then records it), else goes to the final
 * `overflow`; `CHECK` goes to `even` or `odd` by the count; each records its entry.
 */
const twinConfig = (id: string, uses: TwinUses) => ({
  id,
  context: { count: 0 },
  initial: "idle",
  states: {
    idle: {
      on: {
        ADD: [
          { guard: uses.small, actions: [uses.add, uses.recordAdded] },
          { target: "overflow", actions: uses.recordOverflow },
        ],
        CHECK: [{ target: "even", guard: uses.isEven }, { target: "odd" }],
      },
    },
    even: { entry: uses.recordEntry, on: { BACK: "idle" } },
    odd: { entry: uses.recordEntry, on: { BACK: "idle" } },
    overflow: { type: "final" as const },
  },
})

/** One line of a twin's action log. */
const line = (label: string, event: TwinEvent, context: Count): string => `${label}: ${event.type} ${context.count}`

/** The port definitions of the twin, written inline. */
const portUses = (log: Array<string>): TwinUses => {
  const record = (label: (context: Count) => string) =>
    action<Count, TwinEvent>("record", ({ context, event }) =>
      Effect.sync(() => {
        log.push(line(label(context), event, context))
        return Types.ActionResult.NoOp()
      })
    )
  return {
    small: when<Count, TwinEvent>(({ event }) => amountOf(event) < 5),
    isEven: guard<Count, TwinEvent>("isEven", ({ context }) => Effect.succeed(context.count % 2 === 0)),
    add: action<Count, TwinEvent>("add", ({ context, event }) =>
      Effect.succeed(Types.ActionResult.ContextUpdate({ count: context.count + amountOf(event) }))
    ),
    recordAdded: record(() => "added"),
    recordOverflow: record(() => "overflow"),
    recordEntry: record((context) => `entry ${context.count}`),
  }
}

/** The XState forms of the twin, written inline. */
const xstateUses = (log: Array<string>): TwinUses => {
  const record =
    (label: (context: Count) => string) =>
    ({ context, event }: Types.ActionArgs<Count, TwinEvent>) => {
      log.push(line(label(context), event, context))
    }
  return {
    small: ({ event }) => amountOf(event) < 5,
    isEven: ({ context }) => context.count % 2 === 0,
    add: assign<Count, TwinEvent>(({ context, event }) => ({ count: context.count + amountOf(event) })),
    recordAdded: record(() => "added"),
    recordOverflow: record(() => "overflow"),
    recordEntry: record((context) => `entry ${context.count}`),
  }
}

/** The twin's uses by name: static params, and a params function for the entry. */
const namedUses: TwinUses = {
  small: "small",
  isEven: { type: "isEven" },
  add: "add",
  recordAdded: { type: "record", params: { label: "added" } },
  recordOverflow: { type: "record", params: { label: "overflow" } },
  recordEntry: { type: "record", params: ({ context }: { readonly context: Count }) => ({ label: `entry ${context.count}` }) },
}

interface RecordParams {
  readonly label: string
}

/** The implementations the named uses resolve to, as port definitions. */
const portImplementations = (log: Array<string>) => ({
  guards: {
    small: when<Count, TwinEvent>(({ event }) => amountOf(event) < 5),
    isEven: guard<Count, TwinEvent>("isEven", ({ context }) => Effect.succeed(context.count % 2 === 0)),
  },
  actions: {
    add: action<Count, TwinEvent>("add", ({ context, event }) =>
      Effect.succeed(Types.ActionResult.ContextUpdate({ count: context.count + amountOf(event) }))
    ),
    record: action<Count, TwinEvent, RecordParams>("record", ({ context, event }, params) =>
      Effect.sync(() => {
        log.push(line(params.label, event, context))
        return Types.ActionResult.NoOp()
      })
    ),
  },
})

/** The implementations the named uses resolve to, as XState plain functions. */
const xstateImplementations = (log: Array<string>) => ({
  guards: {
    small: ({ event }: { readonly event: TwinEvent }) => amountOf(event) < 5,
    isEven: ({ context }: { readonly context: Count }) => context.count % 2 === 0,
  },
  actions: {
    add: assign<Count, TwinEvent>(({ context, event }) => ({ count: context.count + amountOf(event) })),
    record: ({ context, event }: Types.ActionArgs<Count, TwinEvent>, params: RecordParams) => {
      log.push(line(params.label, event, context))
    },
  },
})

/** The events every twin runs. */
const TWIN_SCRIPT: ReadonlyArray<TwinEvent> = [
  { type: "ADD", amount: 2 },
  { type: "CHECK" },
  { type: "BACK" },
  { type: "ADD", amount: 3 },
  { type: "CHECK" },
  { type: "BACK" },
  { type: "ADD", amount: 7 },
]

/** What a twin did: one `<value> <count> <status>` step per event, and its action log. */
interface Trace {
  readonly steps: ReadonlyArray<string>
  readonly log: ReadonlyArray<string>
}

/** Runs the script through a live actor of `machine` and gives its trace. */
const traceOf = <S extends SnapshotType, Em extends EventObject, R>(
  machine: ActorLogicType<S, TwinEvent, unknown, Em, R>,
  log: ReadonlyArray<string>
) =>
  Effect.gen(function* () {
    const actor = yield* createActor(machine, { id: "twin" })
    yield* actor.start
    const steps: Array<string> = []
    for (const event of TWIN_SCRIPT) {
      yield* actor.send(event)
      // The twin is a machine of `Count`; the logic type the helper takes does not say so
      const snapshot = (yield* actor.getSnapshot) as unknown as MachineSnapshot<Count>
      steps.push(`${String(snapshot.value)} ${snapshot.context.count} ${snapshot.status}`)
    }
    return { steps, log: [...log] } satisfies Trace
  })

/** The trace every form of the twin must give. */
const EXPECTED_TRACE: Trace = {
  steps: [
    "idle 2 active",
    "even 2 active",
    "idle 2 active",
    "idle 5 active",
    "odd 5 active",
    "idle 5 active",
    "overflow 5 done",
  ],
  log: ["added: ADD 2", "entry 2: CHECK 2", "added: ADD 5", "entry 5: CHECK 5", "overflow: ADD 5"],
}

// ---------------------------------------------------------------- A3 helpers

/** One snapshot the actor published: the mailbox event it processed and the state value it reached. */
interface Published {
  readonly event: string
  readonly value: unknown
}

/** Collects, in order, every snapshot that the actor `actorId` publishes (one per mailbox event). */
const recordPublished = (system: ActorSystemService, actorId: string) =>
  Effect.gen(function* () {
    const published = yield* Queue.unbounded<Published>()
    yield* system.inspect((inspectionEvent) =>
      inspectionEvent.type === "@xstate.snapshot" && inspectionEvent.actorRef.id === actorId
        ? Queue.offer(published, {
            event: inspectionEvent.event.type,
            value: (inspectionEvent.snapshot as MachineSnapshot).value,
          }).pipe(Effect.asVoid)
        : Effect.void
    )
    return published
  })

/** Takes the published snapshots in order, up to and including the first one for `eventType`. */
const publishedThrough = (published: Queue.Queue<Published>, eventType: string) =>
  Effect.gen(function* () {
    const taken: Array<Published> = []
    for (;;) {
      const next = yield* Queue.take(published)
      taken.push(next)
      if (next.event === eventType) {
        return taken
      }
    }
  })

/** The published values for one event type. */
const valuesFor = (published: ReadonlyArray<Published>, eventType: string): ReadonlyArray<unknown> =>
  published.filter((entry) => entry.event === eventType).map((entry) => entry.value)

/**
 * `idle -GO-> raising`; `raising` raises `RAISED` on entry, with the given action, and goes to
 * `raised` on it. A `NEXT` that meets `raising` goes to `wrong`; one that meets `raised` goes to
 * `next`.
 */
const raiseMachine = (id: string, raiser: Types.Action<object, EventObject>) =>
  createMachine<object, EventObject>({
    id,
    initial: "idle",
    context: {},
    states: {
      idle: { on: { GO: "raising" } },
      raising: { entry: raiser, on: { RAISED: "raised", NEXT: "wrong" } },
      raised: { on: { NEXT: "next" } },
      next: {},
      wrong: {},
    },
  })

describe("COMPAT-2 Port definition objects work beside the XState forms", () => {
  it.effect("[COMPAT-2] one action list mixing action(...) definitions, named definitions, named and inline functions and assign runs in list order; each reads the context the earlier ones left, with the same event, self and system", () =>
    Effect.gen(function* () {
      const calls: Array<string> = []
      const received: Array<Received> = []
      const machine = setup({
        types: { context: {} as Count, events: {} as GoEvent, input: {} as { readonly start: number } },
        actions: {
          namedDefinition: action<Count, GoEvent, { readonly by: number }>("namedDefinition", ({ context }, params) =>
            Effect.sync(() => {
              calls.push(`namedDefinition +${params.by} at ${context.count}`)
              return Types.ActionResult.ContextUpdate({ count: context.count + params.by })
            })
          ),
          namedFunction: ({ context }, params: { readonly tag: string }) => {
            calls.push(`namedFunction ${params.tag} at ${context.count}`)
          },
        },
        guards: {
          notNegative: guard<Count, GoEvent>("notNegative", ({ context }) => Effect.succeed(context.count >= 0)),
        },
      }).createMachine({
        id: "compat2-mixed",
        context: ({ input }) => ({ count: input.start }),
        initial: "idle",
        states: {
          idle: {
            on: {
              GO: [
                {
                  target: "done",
                  // A named port definition (count >= 0), a when(...) definition (the event does
                  // not hold) and an inline XState function (count is 0): each one alone can refuse
                  guard: and([
                    "notNegative",
                    when<Count, GoEvent>(({ event }) => event.hold !== true),
                    ({ context }) => context.count === 0,
                  ]),
                  actions: [
                    ({ context, event, self, system }) => {
                      calls.push(`inline function at ${context.count}`)
                      received.push({ kind: "inline function", event, self, system })
                    },
                    action<Count, GoEvent>("inlineDefinition", ({ context, event, self, system }) =>
                      Effect.sync(() => {
                        calls.push(`inline definition at ${context.count}`)
                        received.push({ kind: "inline definition", event, self, system })
                        return Types.ActionResult.NoOp()
                      })
                    ),
                    assign<Count, GoEvent>(({ context }) => ({ count: context.count + 1 })),
                    { type: "namedDefinition", params: { by: 10 } },
                    { type: "namedFunction", params: ({ context }) => ({ tag: `p${context.count}` }) },
                    action<Count, GoEvent>("lastDefinition", ({ context }) =>
                      Effect.sync(() => {
                        calls.push(`last definition at ${context.count}`)
                        return Types.ActionResult.NoOp()
                      })
                    ),
                  ],
                },
                { target: "refused" },
              ],
            },
          },
          done: {},
          refused: {},
        },
      })
      const actor = yield* createActor(machine, { input: { start: 0 } })
      yield* actor.start

      yield* actor.send({ type: "GO" })

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.value, "done")
      assert.deepStrictEqual(snapshot.context, { count: 11 })
      assert.deepStrictEqual(calls, [
        "inline function at 0",
        "inline definition at 0",
        "namedDefinition +10 at 1",
        "namedFunction p11 at 11",
        "last definition at 11",
      ])
      assert.deepStrictEqual(received.map((entry) => entry.kind), ["inline function", "inline definition"])
      for (const entry of received) {
        assert.deepStrictEqual(entry.event, { type: "GO" }, entry.kind)
        assert.strictEqual(entry.self, actor.ref, entry.kind)
        assert.strictEqual(entry.system, actor.system, entry.kind)
      }

      // provide swaps the named port guard for one that refuses: the fallback is taken and no action runs
      calls.length = 0
      const refusing = machine.provide({
        guards: { notNegative: guard<Count, GoEvent>("notNegative", () => Effect.succeed(false)) },
      })
      const refused = yield* createActor(refusing, { input: { start: 0 } })
      yield* refused.start
      yield* refused.send({ type: "GO" })
      assert.strictEqual((yield* refused.getSnapshot).value, "refused")
      assert.deepStrictEqual(calls, [])

      // Only the when(...) definition is false (count 0, the event holds): the fallback is taken
      calls.length = 0
      const held = yield* createActor(machine, { input: { start: 0 } })
      yield* held.start
      yield* held.send({ type: "GO", hold: true })
      assert.strictEqual((yield* held.getSnapshot).value, "refused", "only the when(...) member is false")
      assert.deepStrictEqual(calls, [], "only the when(...) member is false")

      // Only the inline XState function is false (count 1 is not negative, the event does not hold)
      calls.length = 0
      const started = yield* createActor(machine, { input: { start: 1 } })
      yield* started.start
      yield* started.send({ type: "GO" })
      assert.strictEqual((yield* started.getSnapshot).value, "refused", "only the inline function member is false")
      assert.deepStrictEqual(calls, [], "only the inline function member is false")
    })
  )

  it.effect("[COMPAT-2] the same machine with port definitions and with XState forms, inline and by name, reaches the same snapshots and runs the same actions for one event script", () =>
    Effect.gen(function* () {
      const portInlineLog: Array<string> = []
      const xstateInlineLog: Array<string> = []
      const portNamedLog: Array<string> = []
      const xstateNamedLog: Array<string> = []

      const portInline = yield* traceOf(
        createMachine<Count, TwinEvent>(twinConfig("compat2-port-inline", portUses(portInlineLog))),
        portInlineLog
      )
      const xstateInline = yield* traceOf(
        createMachine<Count, TwinEvent>(twinConfig("compat2-xstate-inline", xstateUses(xstateInlineLog))),
        xstateInlineLog
      )
      const portNamed = yield* traceOf(
        createMachine<Count, TwinEvent>(twinConfig("compat2-port-named", namedUses), portImplementations(portNamedLog)),
        portNamedLog
      )
      const xstateNamed = yield* traceOf(
        createMachine<Count, TwinEvent>(twinConfig("compat2-xstate-named", namedUses), xstateImplementations(xstateNamedLog)),
        xstateNamedLog
      )

      assert.deepStrictEqual(portInline, EXPECTED_TRACE, "port definitions, inline")
      assert.deepStrictEqual(xstateInline, EXPECTED_TRACE, "XState forms, inline")
      assert.deepStrictEqual(portNamed, EXPECTED_TRACE, "port definitions by name, with the params of each use")
      assert.deepStrictEqual(xstateNamed, EXPECTED_TRACE, "XState plain functions by name, with the params of each use")
    })
  )

  it.effect("[COMPAT-2] provide swaps a named port definition for an XState function and back, and the machine keeps its behaviour", () =>
    Effect.gen(function* () {
      const portLog: Array<string> = []
      const xstateLog: Array<string> = []
      const portMachine = createMachine<Count, TwinEvent>(twinConfig("compat2-provide-a", namedUses), portImplementations(portLog))
      const xstateMachine = createMachine<Count, TwinEvent>(twinConfig("compat2-provide-b", namedUses), xstateImplementations(xstateLog))

      // The port machine gets the XState functions, the XState machine the port definitions
      const toXState = portMachine.provide(xstateImplementations(xstateLog))
      const toPort = xstateMachine.provide(portImplementations(portLog))

      assert.deepStrictEqual(yield* traceOf(toXState, xstateLog), EXPECTED_TRACE, "port machine with XState functions")
      assert.deepStrictEqual(yield* traceOf(toPort, portLog), EXPECTED_TRACE, "XState machine with port definitions")
    })
  )

  it.effect("[COMPAT-2] a hand-written definition that gives a RaiseEvent result follows A3: the raised event is handled in the same macrostep, before the external event already queued", () =>
    Effect.gen(function* () {
      const raiseResult = action<object, EventObject>("compat2.raise", () =>
        Effect.succeed(Types.ActionResult.RaiseEvent({ type: "RAISED" }))
      )
      for (const [id, raiser] of [
        ["compat2-raise-definition", raiseResult],
        ["compat2-raise-builtin", raise<object, EventObject>({ type: "RAISED" })],
      ] as const) {
        const actor = yield* createActor(raiseMachine(id, raiser), { id })
        const published = yield* recordPublished(actor.system, id)

        // Both external events are in the mailbox before the actor processes any event
        yield* actor.send({ type: "GO" })
        yield* actor.send({ type: "NEXT" })
        yield* actor.start

        const taken = yield* publishedThrough(published, "NEXT")
        assert.deepStrictEqual(valuesFor(taken, "GO"), ["raised"], id)
        assert.deepStrictEqual(valuesFor(taken, "NEXT"), ["next"], id)
        assert.deepStrictEqual(valuesFor(taken, "RAISED"), [], id)
      }
    })
  )

  it.effect("[COMPAT-2] a RaiseEvent result is handled after the rest of its action list: the raised event's guard reads the context an assign after it left", () =>
    Effect.gen(function* () {
      const machine = createMachine<Count, EventObject>({
        id: "compat2-raise-order",
        context: { count: 0 },
        initial: "idle",
        states: {
          idle: {
            on: {
              GO: {
                target: "waiting",
                actions: [
                  action<Count, EventObject>("compat2.raise", () => Effect.succeed(Types.ActionResult.RaiseEvent({ type: "RAISED" }))),
                  assign<Count, EventObject>(({ context }) => ({ count: context.count + 1 })),
                ],
              },
            },
          },
          waiting: {
            on: {
              RAISED: [{ target: "sawAssign", guard: ({ context }) => context.count === 1 }, { target: "missedAssign" }],
            },
          },
          sawAssign: {},
          missedAssign: {},
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* actor.send({ type: "GO" })

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.value, "sawAssign")
      assert.deepStrictEqual(snapshot.context, { count: 1 })
    })
  )

  it.effect("[COMPAT-2] a hand-written definition that gives an EmitEvent result, or calls ctx.emit, follows A6: the listeners run after the macrostep commits, read the committed snapshot, and the machine never takes the emitted event", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const emitResult: ActionDefinition<Count, EventObject> = {
        type: "compat2.emitResult",
        exec: () => Effect.succeed(Types.ActionResult.EmitEvent({ type: "fromResult" })),
      }
      const ctxEmit = action<Count, EventObject>("compat2.ctxEmit", (ctx) =>
        Effect.as(ctx.emit({ type: "fromContext" }), Types.ActionResult.NoOp())
      )
      const machine = createMachine<Count, EventObject>({
        id: "compat2-emit",
        initial: "a",
        context: { count: 0 },
        states: {
          a: {
            on: {
              GO: {
                target: "b",
                // The emits come before the assign in the list, and the transition leaves `a`
                actions: [
                  emitResult,
                  emit<Count, EventObject>({ type: "builtin" }),
                  ctxEmit,
                  assign<Count, EventObject>(({ context }) => ({ count: context.count + 1 })),
                ],
              },
            },
          },
          // An emitted event that entered the machine's own queue would leave `b`
          b: { on: { fromResult: "wrong", builtin: "wrong", fromContext: "wrong" } },
          wrong: {},
        },
      })
      const actor = yield* createActor(machine)
      const heard = (label: string) => (event: EventObject) =>
        Effect.map(actor.getSnapshot, (snapshot) => {
          log.push(`${label} ${event.type} ${String(snapshot.value)} ${snapshot.context.count}`)
        })
      yield* actor.on("fromResult", heard("typed"))
      yield* actor.on("builtin", heard("typed"))
      yield* actor.on("fromContext", heard("typed"))
      yield* actor.on("*", heard("wildcard"))
      yield* actor.start
      assert.deepStrictEqual(log, [], "no listener runs before the event")

      yield* actor.send({ type: "GO" })

      assert.deepStrictEqual(log.filter((entry) => entry.startsWith("typed")), [
        "typed fromResult b 1",
        "typed builtin b 1",
        "typed fromContext b 1",
      ])
      assert.deepStrictEqual(
        [...log.filter((entry) => entry.startsWith("wildcard"))].sort(),
        ["wildcard builtin b 1", "wildcard fromContext b 1", "wildcard fromResult b 1"]
      )
      yield* settle
      assert.strictEqual((yield* actor.getSnapshot).value, "b")
      assert.strictEqual((yield* actor.getSnapshot).status, "active")
    })
  )

  it.effect("[COMPAT-2] a hand-written definition that gives a SendEvent result follows A5: it reaches a child by id and by systemId, in list order with sendTo, after the macrostep commits", () =>
    Effect.gen(function* () {
      interface Stage {
        readonly stage: string
      }
      const log: Array<string> = []
      // The child reads its parent's live snapshot when it receives an event
      const peeker = (name: string) =>
        fromCallback(({ receive, self }) => {
          receive((event) => {
            const parentSnapshot = Effect.runSync(Option.getOrThrow(self._parent).getSnapshotUntyped) as unknown as {
              readonly context: Stage
            }
            log.push(`${name} ${event.type} ${parentSnapshot.context.stage}`)
          })
        })
      const sendResult = (target: string, type: string) =>
        action<Stage, GoEvent>(`compat2.send.${type}`, () =>
          Effect.succeed(Types.ActionResult.SendEvent(target, { type }))
        )
      const machine = createMachine<Stage, GoEvent>({
        id: "compat2-send",
        context: { stage: "before" },
        entry: [
          spawnChild<Stage, GoEvent, ReturnType<typeof peeker>>(peeker("child"), { id: "child" }),
          spawnChild<Stage, GoEvent, ReturnType<typeof peeker>>(peeker("audit"), { id: "audit", systemId: "logger" }),
        ],
        on: {
          GO: {
            // The built-in send comes first: a definition's send that left at once, before the
            // macrostep commits, would reach the child before it
            actions: [
              sendTo<Stage, GoEvent>("child", { type: "BUILTIN" }),
              sendResult("child", "BY_ID"),
              sendResult("logger", "BY_SYSTEM_ID"),
              assign<Stage, GoEvent>(() => ({ stage: "after" })),
            ],
          },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* actor.send({ type: "GO" })

      assert.isTrue(yield* eventually(Effect.sync(() => log.length >= 3)))
      yield* settle
      assert.deepStrictEqual(log.filter((entry) => entry.startsWith("child")), ["child BUILTIN after", "child BY_ID after"])
      assert.deepStrictEqual(log.filter((entry) => entry.startsWith("audit")), ["audit BY_SYSTEM_ID after"])
      assert.strictEqual((yield* actor.getSnapshot).status, "active")
    })
  )

  it.effect("[COMPAT-2] a SendEvent result in a macrostep that fails is never delivered, as the sendTo before it is not: the send waits for the macrostep to commit", () =>
    Effect.gen(function* () {
      interface Heard {
        readonly heard: ReadonlyArray<string>
      }
      const failure = new Error("compat2: the macrostep fails after its sends")
      // `GO` sends twice to the actor registered as `receiver`, then fails
      const sender = createMachine<object, GoEvent>({
        id: "compat2-failing-sender",
        context: {},
        on: {
          GO: {
            actions: [
              sendTo<object, GoEvent>("receiver", { type: "FROM_BUILTIN" }),
              action<object, GoEvent>("compat2.send.failing", () =>
                Effect.succeed(Types.ActionResult.SendEvent("receiver", { type: "FROM_DEFINITION" }))
              ),
              () => {
                throw failure
              },
            ],
          },
        },
      })
      const hear = assign<Heard, EventObject>(({ context, event }) => ({ heard: [...context.heard, event.type] }))
      // The receiver handles its child's error event, so it stays active and records what reaches it
      const receiver = createMachine<Heard, EventObject>({
        id: "compat2-receiver",
        context: { heard: [] },
        entry: spawnChild<Heard, EventObject, typeof sender>(sender, { id: "sender" }),
        on: {
          GO: { actions: sendTo<Heard, EventObject>("sender", { type: "GO" }) },
          FROM_BUILTIN: { actions: hear },
          FROM_DEFINITION: { actions: hear },
          "xstate.error.actor.sender": { actions: hear },
        },
      })
      const actor = yield* createActor(receiver, { systemId: "receiver" })
      yield* actor.start
      const heardNow = Effect.map(actor.getSnapshot, (snapshot) => snapshot.context.heard)

      yield* actor.send({ type: "GO" })

      assert.isTrue(yield* eventually(Effect.map(heardNow, (heard) => heard.includes("xstate.error.actor.sender"))))
      yield* settle
      assert.deepStrictEqual(yield* heardNow, ["xstate.error.actor.sender"])
      assert.strictEqual((yield* actor.getSnapshot).status, "active")
    })
  )

  it.effect("[COMPAT-2] a SendEvent result with a name that reaches no actor sets status error with the recorded message, as sendTo does", () =>
    Effect.gen(function* () {
      const machine = createMachine<object, GoEvent>({
        id: "compat2-send-unknown",
        context: {},
        on: {
          GO: {
            actions: action<object, GoEvent>("compat2.send.nowhere", () =>
              Effect.succeed(Types.ActionResult.SendEvent("nowhere", { type: "LOST" }))
            ),
          },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* actor.send({ type: "GO" })

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "error")
      assert.strictEqual(
        Option.match(snapshot.error, { onNone: () => "(no error)", onSome: messageOf }),
        unableToSend("nowhere", "compat2-send-unknown")
      )
    })
  )

  it.effect("[COMPAT-2] the port extras assignProperty, sendSelf, spawnChildFromRegistry, fromEffectRetry, stopAllChildren and setupWithSchema still work in a machine that also uses XState forms", () =>
    Effect.gen(function* () {
      const Context = Schema.Struct({ count: Schema.Number, label: Schema.String, output: Schema.Number })
      const Events = Schema.Union([
        Schema.Struct({ type: Schema.Literal("SET"), label: Schema.String }),
        Schema.Struct({ type: Schema.Literal("PING") }),
        Schema.Struct({ type: Schema.Literal("PONG") }),
        Schema.Struct({ type: Schema.Literal("SPAWN") }),
        Schema.Struct({ type: Schema.Literal("STOP_ALL") }),
      ])
      type Ctx = Schema.Schema.Type<typeof Context>
      type Ev = Schema.Schema.Type<typeof Events>
      const log: Array<string> = []
      const attempts: Array<number> = []
      const registry = {
        actors: {
          retrying: fromEffectRetry(
            () =>
              Effect.suspend(() => {
                attempts.push(attempts.length + 1)
                return attempts.length < 2 ? Effect.fail("first attempt failed") : Effect.succeed(42)
              }),
            Schedule.recurs(2).pipe(Schedule.addDelay(() => Effect.succeed("1 second")))
          ),
          idler: lifecycle("idler", log),
        },
      }
      const helpers = setupWithSchema({
        context: Context,
        events: Events,
        actions: {
          // A named XState action with the params of its use
          bump: assign<Ctx, Ev, { readonly by: number }>(({ context }, params) => ({ count: context.count + params.by })),
        },
      })
      const machine = helpers.createMachine({
        id: "compat2-extras",
        context: { count: 0, label: "", output: 0 },
        on: {
          SET: {
            actions: [
              assignProperty<Ctx, Ev, "label">("label", ({ event }) => (event.type === "SET" ? event.label : "")),
              // An inline XState function reads what the port extra assigned
              ({ context }) => {
                log.push(`label ${context.label}`)
              },
            ],
          },
          PING: { actions: sendSelf<Ctx, Ev, Ev>({ type: "PONG" }) },
          PONG: { actions: { type: "bump", params: { by: 5 } } },
          SPAWN: {
            actions: [
              spawnChildFromRegistry<Ctx, Ev>("retrying", registry, { id: "job" }),
              spawnChildFromRegistry<Ctx, Ev>("idler", registry, { id: "idle" }),
            ],
          },
          "xstate.done.actor.job": {
            actions: assign<Ctx, EventObject>(({ event }) => ({
              output: Option.getOrElse((event as unknown as { readonly output: Option.Option<number> }).output, () => -1),
            })),
          },
          STOP_ALL: { actions: stopAllChildren<Ctx, Ev>() },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      const contextNow = Effect.map(actor.getSnapshot, (snapshot) => snapshot.context)

      // assignProperty beside an inline XState function
      yield* actor.send({ type: "SET", label: "hello" })
      assert.deepStrictEqual(log, ["label hello"])

      // sendSelf delivers PONG, which a named XState action with params handles
      yield* actor.send({ type: "PING" })
      assert.isTrue(yield* eventually(Effect.map(contextNow, (context) => context.count === 5)))

      // spawnChildFromRegistry spawns a fromEffectRetry child; it succeeds on its retry
      yield* actor.send({ type: "SPAWN" })
      const children = (yield* actor.getSnapshot).children as Readonly<Record<string, ActorRefBase>>
      assert.deepStrictEqual(Object.keys(children).sort(), ["idle", "job"])
      yield* settle
      assert.deepStrictEqual(attempts, [1])
      yield* TestClock.adjust("1 second")
      assert.isTrue(yield* eventually(Effect.map(contextNow, (context) => context.output === 42)), "the retry succeeds")
      assert.deepStrictEqual(attempts, [1, 2])

      // stopAllChildren stops the child that is still running
      yield* actor.send({ type: "STOP_ALL" })
      assert.deepStrictEqual(Object.keys((yield* actor.getSnapshot).children), [])
      assert.isTrue(yield* eventually(Effect.sync(() => log.includes("idler cleanup"))))

      // setupWithSchema keeps its validators
      assert.deepStrictEqual(yield* helpers.validateEvent({ type: "SET", label: "x" }), { type: "SET", label: "x" })
      assert.isTrue(Schema.isSchemaError(yield* Effect.flip(helpers.validateContext({ count: "one" }))))
      assert.deepStrictEqual(yield* contextNow, { count: 5, label: "hello", output: 42 })
      assert.strictEqual((yield* actor.getSnapshot).status, "active")
    })
  )
})
