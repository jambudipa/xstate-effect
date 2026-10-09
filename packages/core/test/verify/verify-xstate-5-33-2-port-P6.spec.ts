/**
 * P6: inspection emits all six event types with rootId.
 *
 * T6.8. Upstream (`src/inspection.ts`, `src/createActor.ts`, `src/system.ts` and
 * `src/stateUtils.ts` at xstate@5.33.2) sends, to the `inspect` option of the root actor and to
 * every `system.inspect` observer:
 *
 * - `@xstate.actor` in the `Actor` constructor, before the systemId registration and the
 *   initial snapshot, so before the actor's first `@xstate.snapshot`;
 * - `@xstate.event` from `system._relay`, before the target receives the event: `send` relays
 *   with no source; `sendTo`, `sendParent`, a scheduled event and the done event of a child
 *   relay with the sender as source; `start` reports the init event with the parent as source
 *   (none for the root). Each event is reported once;
 * - `@xstate.snapshot` from `update`: at `start` with the init event, after each macrostep,
 *   and after a stop with `xstate.stop`; none after a transition that throws;
 * - `@xstate.microstep` from `macrostep` (`addMicrostep`), one per microstep after the initial
 *   one, for raised, eventless and normal transitions, with the transitions it took: none for
 *   an event that no transition takes, and none for the stop event;
 * - `@xstate.action` from the actor's `actionExecutor`, for custom actions and for the
 *   built-in actions that have an `execute` (raise, sendTo, emit, log, cancel, spawnChild,
 *   stopChild), with the params their `resolve` gives (`cancel`: `{ sendId }`), not for
 *   `assign` and `enqueueActions` (the actions it enqueues are reported). The `spawnChild` of
 *   the initial snapshot is reported at `start`, after the machine's `start` started the
 *   child. A port action definition (an object with `exec`) that gives the engine no work is
 *   the port's form of an action upstream executes, so it is reported with its type and params;
 * - `@xstate.transition` is a member of the `InspectionEvent` union and nothing sends it. Gap
 *   row P6 counts it among the "six event types"; five are sent (ledger row, as SD-16 records
 *   the `enqueue.log` inventory error).
 *
 * Every event carries `rootId`, the session id of the system's root actor, also the events of
 * a child. An actor reference inside an event serialises as `{ xstate$$type: 1, id }`.
 *
 * Port: `sourceRef` is an `Option` (D8, DEV-7); session ids are numbered per system (SD-9), so
 * the root is `x:0`; an inspection function is given a function (SD-18). Timers run on the
 * Effect clock (TestClock); waits are bounded yields.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { TestClock } from "effect/testing"
import type { ActorRefBase } from "../../src/ActorRef.js"
import {
  type ActorType,
  assign,
  cancel,
  createActor,
  createMachine,
  emit,
  enqueueActions,
  type EventObject,
  fromCallback,
  type InspectedTransitionEvent,
  type InspectionEvent,
  isActor,
  log,
  raise,
  sendParent,
  sendTo,
  spawnChild,
  stopChild,
} from "../../src/index.js"
import * as Types from "../../src/Types.js"

/** An inspection function that keeps every event in `into`. */
const record = (into: Array<InspectionEvent>) => (event: InspectionEvent) =>
  Effect.sync(() => {
    into.push(event)
  })

/** Yields until `check` holds, at most 200 times; gives whether it held. */
const eventually = (check: Effect.Effect<boolean>) =>
  Effect.gen(function* () {
    for (let turn = 0; turn < 200; turn++) {
      if (yield* check) {
        return true
      }
      yield* Effect.yieldNow
    }
    return yield* check
  })

/** Lets every other ready fiber take ten turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 10; turn++) {
    yield* Effect.yieldNow
  }
})

/** The child actor behind a reference; fails the test when the reference is not an actor. */
const asActor = (ref: ActorRefBase | undefined): ActorType.Any => {
  assert.isTrue(isActor(ref), "the reference is an actor")
  return ref as ActorType.Any
}

/** The `@xstate.event` inspection events whose event has `type`. */
const eventsOfType = (events: ReadonlyArray<InspectionEvent>, type: string) =>
  events.flatMap((inspection) => (inspection.type === "@xstate.event" && inspection.event.type === type ? [inspection] : []))

/** The JSON form of a value, read back (what `JSON.stringify` writes for it). */
const serialised = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

interface Pongs {
  readonly pongs: number
}

type RootEvent = { readonly type: "GO" } | { readonly type: "PONG" } | { readonly type: "FINISH" }
type ChildEvent = { readonly type: "PING" } | { readonly type: "FINISH" }

/**
 * A root that spawns `child` at creation: GO sends PING to it (a custom action runs too), the
 * child answers PONG to its parent, and FINISH makes the child final, so it relays its done
 * event.
 */
const rootMachine = () => {
  const child = createMachine<object, ChildEvent>({
    id: "p6-child",
    context: {},
    initial: "running",
    states: {
      running: {
        on: {
          PING: { actions: sendParent<object, ChildEvent>({ type: "PONG" }) },
          FINISH: "finished",
        },
      },
      finished: { type: "final" },
    },
  })
  return createMachine<Pongs, RootEvent>({
    id: "p6-root",
    context: { pongs: 0 },
    entry: spawnChild<Pongs, RootEvent, typeof child>(child, { id: "child" }),
    on: {
      GO: {
        actions: [
          function custom() {},
          sendTo<Pongs, RootEvent>("child", { type: "PING" }),
        ],
      },
      PONG: { actions: assign<Pongs, RootEvent>(({ context }) => ({ pongs: context.pongs + 1 })) },
      FINISH: { actions: sendTo<Pongs, RootEvent>("child", { type: "FINISH" }) },
    },
  })
}

/** Creates the root of `rootMachine` with `inspect`, starts it, sends GO and waits for the PONG. */
const runRoot = (events: Array<InspectionEvent>) =>
  Effect.gen(function* () {
    const actor = yield* createActor(rootMachine(), { id: "root", inspect: record(events) })
    yield* actor.start
    const child = asActor((yield* actor.getSnapshot).children["child"])
    yield* actor.send({ type: "GO" })
    assert.isTrue(yield* eventually(Effect.map(actor.getSnapshot, (snapshot) => snapshot.context.pongs === 1)), "the root receives PONG")
    yield* settle
    return { actor, child }
  })

describe("P6 Inspection emits all six event types with rootId", () => {
  it.effect("[P6] the inspect option receives @xstate.actor, @xstate.event, @xstate.snapshot, @xstate.microstep and @xstate.action, each with the root's session id as rootId, also for the child's events", () =>
    Effect.gen(function* () {
      const events: Array<InspectionEvent> = []
      const { actor, child } = yield* runRoot(events)

      assert.sameMembers(
        [...new Set(events.map((inspection) => inspection.type))],
        ["@xstate.actor", "@xstate.event", "@xstate.snapshot", "@xstate.microstep", "@xstate.action"]
      )
      assert.strictEqual(actor.sessionId, "x:0")
      assert.isTrue(events.every((inspection) => inspection.rootId === actor.sessionId), "every event names the root")
      const ofChild = events.filter((inspection) => inspection.actorRef === child)
      assert.sameMembers(
        [...new Set(ofChild.map((inspection) => inspection.type))],
        ["@xstate.actor", "@xstate.event", "@xstate.snapshot", "@xstate.microstep", "@xstate.action"]
      )
      assert.notStrictEqual(child.sessionId, actor.sessionId)
      assert.isTrue(ofChild.every((inspection) => inspection.rootId === actor.sessionId), "the child's events name the root too")
    })
  )

  it.effect("[P6] @xstate.event names its source: none for the root's init event and an external send, the parent for the child's init event and a sendTo, the child for sendParent and its done event; each event is reported once, before its snapshot", () =>
    Effect.gen(function* () {
      const events: Array<InspectionEvent> = []
      const { actor, child } = yield* runRoot(events)
      yield* actor.send({ type: "FINISH" })
      assert.isTrue(yield* eventually(Effect.map(child.getSnapshot, (snapshot) => snapshot.status === "done")), "the child is done")
      yield* settle

      const sourceOf = (inspection: Extract<InspectionEvent, { readonly type: "@xstate.event" }>) =>
        Option.getOrUndefined(Option.map(inspection.sourceRef, (source) => source.id))
      const reported = (type: string) =>
        eventsOfType(events, type).map((inspection) => ({ target: inspection.actorRef.id, source: sourceOf(inspection) }))

      assert.deepStrictEqual(reported("xstate.init"), [
        { target: "root", source: undefined },
        { target: "child", source: "root" },
      ])
      assert.deepStrictEqual(reported("GO"), [{ target: "root", source: undefined }])
      assert.deepStrictEqual(reported("PING"), [{ target: "child", source: "root" }])
      assert.deepStrictEqual(reported("PONG"), [{ target: "root", source: "child" }])
      assert.deepStrictEqual(reported("xstate.done.actor.child"), [{ target: "root", source: "child" }])

      // The event is reported before the snapshot its macrostep publishes, and the child's done
      // event before the child's own last snapshot (upstream `update` relays it first)
      const indexOfEvent = (type: string) => events.findIndex((inspection) => inspection.type === "@xstate.event" && inspection.event.type === type)
      const indexOfSnapshot = (target: ActorRefBase, type: string) =>
        events.findIndex(
          (inspection) => inspection.type === "@xstate.snapshot" && inspection.actorRef === target && inspection.event.type === type
        )
      assert.isBelow(indexOfEvent("GO"), indexOfSnapshot(actor, "GO"))
      assert.isBelow(indexOfEvent("PONG"), indexOfSnapshot(actor, "PONG"))
      assert.isBelow(indexOfEvent("xstate.done.actor.child"), indexOfSnapshot(child, "FINISH"))
    })
  )

  it.effect("[P6] @xstate.microstep reports raised, eventless and normal transitions with the transitions taken, and none for an event that no transition takes", () =>
    Effect.gen(function* () {
      type Ev = { readonly type: "toB" } | { readonly type: "EV" } | { readonly type: "unknown" }
      const machine = createMachine<object, Ev>({
        id: "p6-steps",
        context: {},
        initial: "a",
        states: {
          a: { entry: raise<object, Ev>({ type: "toB" }), on: { toB: "b" } },
          b: { always: "c" },
          c: { on: { EV: "d" } },
          d: {},
        },
      })
      const events: Array<InspectionEvent> = []
      const actor = yield* createActor(machine, { inspect: record(events) })
      yield* actor.start
      yield* actor.send({ type: "EV" })
      yield* actor.send({ type: "unknown" })

      const microsteps = events.flatMap((inspection) =>
        inspection.type === "@xstate.microstep"
          ? [
              {
                event: inspection.event.type,
                value: (inspection.snapshot as unknown as { readonly value: unknown }).value,
                transitions: inspection._transitions.map((transition) => ({
                  eventType: transition.eventType,
                  target: transition.target?.map((target) => target.id) ?? [],
                })),
              },
            ]
          : []
      )
      // The initial microstep is not reported; the raised and the eventless one are, with the
      // event the macrostep handled last
      assert.deepStrictEqual(microsteps, [
        { event: "toB", value: "b", transitions: [{ eventType: "toB", target: ["p6-steps.b"] }] },
        { event: "toB", value: "c", transitions: [{ eventType: "", target: ["p6-steps.c"] }] },
        { event: "EV", value: "d", transitions: [{ eventType: "EV", target: ["p6-steps.d"] }] },
        { event: "unknown", value: "d", transitions: [] },
      ])
      // The microsteps of the initial macrostep come at creation, before the init event
      const firstInit = eventsOfType(events, "xstate.init")[0]
      assert.isBelow(events.findIndex((inspection) => inspection.type === "@xstate.microstep"), events.indexOf(firstInit!))
    })
  )

  it.effect("[P6] @xstate.action reports custom actions and the built-ins with an execution (raise, log, emit, sendTo, cancel, stopChild, spawnChild), with their params, and nothing for assign and enqueueActions", () =>
    Effect.gen(function* () {
      interface Ctx {
        readonly n: number
      }
      type Ev = { readonly type: "GO" } | { readonly type: "RAISED" }
      const worker = fromCallback(() => undefined)
      const machine = createMachine<Ctx, Ev>({
        id: "p6-actions",
        context: { n: 0 },
        entry: spawnChild<Ctx, Ev, typeof worker>(worker, { id: "worker" }),
        on: {
          GO: {
            actions: [
              { type: "custom", params: { n: 1 } },
              assign<Ctx, Ev>(({ context }) => ({ n: context.n + 1 })),
              raise<Ctx, Ev>({ type: "RAISED" }),
              log<Ctx, Ev>("p6"),
              emit<Ctx, Ev>({ type: "p6.emitted" }),
              sendTo<Ctx, Ev>("worker", { type: "HELLO" }),
              cancel<Ctx, Ev>("nothing"),
              stopChild<Ctx, Ev>("worker"),
              enqueueActions<Ctx, Ev>(({ enqueue }) => {
                enqueue(function enqueued() {})
              }),
            ],
          },
        },
      })
      const events: Array<InspectionEvent> = []
      const actor = yield* createActor(machine, { inspect: record(events), logger: () => {} })
      yield* actor.start
      const workerRef = (yield* actor.getSnapshot).children["worker"]
      const actions = () => events.flatMap((inspection) => (inspection.type === "@xstate.action" ? [inspection.action] : []))
      assert.deepStrictEqual(
        actions().map((action) => action.type),
        ["xstate.spawnChild"]
      )
      // Upstream `resolveSpawn`'s params, reported when `start` runs the deferred
      // `executeSpawn`: after the machine's `start` started the child, so after the child's init
      // event (upstream probe)
      assert.deepStrictEqual(actions()[0]?.params, {
        id: "worker",
        systemId: undefined,
        actorRef: workerRef,
        src: worker,
        input: undefined,
      })
      const workerInit = events.findIndex(
        (inspection) => inspection.type === "@xstate.event" && inspection.actorRef === workerRef && inspection.event.type === "xstate.init"
      )
      assert.isAtLeast(workerInit, 0)
      assert.isBelow(workerInit, events.findIndex((inspection) => inspection.type === "@xstate.action"))

      events.length = 0
      yield* actor.send({ type: "GO" })
      assert.deepStrictEqual(
        actions().map((action) => action.type),
        ["custom", "xstate.raise", "xstate.log", "xstate.emit", "xstate.sendTo", "xstate.cancel", "xstate.stopChild", "enqueued"]
      )
      const paramsOf = (type: string) => actions().find((action) => action.type === type)?.params
      assert.deepStrictEqual(paramsOf("custom"), { n: 1 })
      assert.deepStrictEqual(paramsOf("xstate.raise"), { event: { type: "RAISED" }, id: undefined, delay: undefined })
      assert.deepStrictEqual(paramsOf("xstate.log"), { value: "p6", label: undefined })
      assert.deepStrictEqual(paramsOf("xstate.emit"), { event: { type: "p6.emitted" } })
      // Upstream `resolveCancel`'s params
      assert.deepStrictEqual(paramsOf("xstate.cancel"), { sendId: "nothing" })
      assert.deepStrictEqual(paramsOf("xstate.sendTo"), {
        to: workerRef,
        targetId: "worker",
        event: { type: "HELLO" },
        id: undefined,
        delay: undefined,
      })
      assert.strictEqual(paramsOf("xstate.stopChild"), workerRef)
      assert.isTrue(events.every((inspection) => inspection.type !== "@xstate.action" || inspection.actorRef === actor))
    })
  )

  it.effect("[P6] a port action definition that gives the engine no work reports @xstate.action with its type and params, as upstream reports every action it executes", () =>
    Effect.gen(function* () {
      type Ev = { readonly type: "GO" }
      const ran: Array<unknown> = []
      const machine = createMachine<object, Ev>({
        id: "p6-definition",
        context: {},
        on: {
          GO: {
            actions: {
              type: "port.definition",
              params: { k: 1 },
              exec: (_ctx: unknown, params: unknown) =>
                Effect.sync(() => {
                  ran.push(params)
                  return Types.ActionResult.NoOp()
                }),
            },
          },
        },
      })
      const events: Array<InspectionEvent> = []
      const actor = yield* createActor(machine, { inspect: record(events) })
      yield* actor.start
      yield* actor.send({ type: "GO" })

      assert.deepStrictEqual(ran, [{ k: 1 }])
      assert.deepStrictEqual(
        events.flatMap((inspection) => (inspection.type === "@xstate.action" ? [inspection.action] : [])),
        [{ type: "port.definition", params: { k: 1 } }]
      )
    })
  )

  it.effect("[P6] @xstate.actor arrives at creation, before the actor's first @xstate.snapshot, for the root and for a child spawned at creation", () =>
    Effect.gen(function* () {
      const events: Array<InspectionEvent> = []
      const actor = yield* createActor(rootMachine(), { id: "root", inspect: record(events) })
      // Created, not started: the root and the child spawned by its initial entry are reported
      assert.deepStrictEqual(
        events.map((inspection) => [inspection.type, inspection.actorRef.id]),
        [
          ["@xstate.actor", "root"],
          ["@xstate.actor", "child"],
        ]
      )

      yield* actor.start
      yield* settle
      for (const id of ["root", "child"]) {
        const created = events.findIndex((inspection) => inspection.type === "@xstate.actor" && inspection.actorRef.id === id)
        const firstSnapshot = events.findIndex((inspection) => inspection.type === "@xstate.snapshot" && inspection.actorRef.id === id)
        assert.isAtLeast(created, 0)
        assert.isAbove(firstSnapshot, created, `the actor event of ${id} precedes its first snapshot event`)
      }
    })
  )

  it.effect("[P6] a scheduled delivery emits @xstate.event with the scheduling actor as source, once, when its timer fires", () =>
    Effect.gen(function* () {
      type Ev = { readonly type: "TICK" }
      const machine = createMachine<{ readonly ticks: number }, Ev>({
        id: "p6-timers",
        context: { ticks: 0 },
        initial: "waiting",
        entry: raise<{ readonly ticks: number }, Ev>({ type: "TICK" }, { delay: 50 }),
        on: { TICK: { actions: assign<{ readonly ticks: number }, Ev>(({ context }) => ({ ticks: context.ticks + 1 })) } },
        states: {
          waiting: { after: { 100: "late" } },
          late: {},
        },
      })
      const events: Array<InspectionEvent> = []
      const actor = yield* createActor(machine, { inspect: record(events) })
      yield* actor.start
      assert.deepStrictEqual(eventsOfType(events, "TICK"), [])

      yield* TestClock.adjust("100 millis")
      assert.isTrue(yield* eventually(Effect.map(actor.getSnapshot, (snapshot) => snapshot.value === "late")), "the after transition fires")
      yield* settle

      for (const type of ["TICK", "xstate.after.100.p6-timers.waiting"]) {
        const delivered = eventsOfType(events, type)
        assert.strictEqual(delivered.length, 1, `${type} is reported once`)
        assert.strictEqual(delivered[0]?.actorRef, actor)
        assert.isTrue(Option.exists(delivered[0]!.sourceRef, (source) => source === actor), `${type} comes from the actor itself`)
      }
    })
  )

  it.effect("[P6] serialised refs inside inspection events show xstate$$type: 1", () =>
    Effect.gen(function* () {
      const events: Array<InspectionEvent> = []
      const { actor, child } = yield* runRoot(events)

      for (const inspection of events) {
        assert.deepStrictEqual(serialised(inspection.actorRef), { xstate$$type: 1, id: inspection.actorRef.id })
      }
      const pong = eventsOfType(events, "PONG")[0]
      assert.deepStrictEqual(serialised(Option.getOrUndefined(pong!.sourceRef)), { xstate$$type: 1, id: "child" })
      const rootSnapshot = events.find(
        (inspection) => inspection.type === "@xstate.snapshot" && inspection.actorRef === actor
      ) as Extract<InspectionEvent, { readonly type: "@xstate.snapshot" }>
      assert.deepStrictEqual((serialised(rootSnapshot.snapshot) as { readonly children: unknown }).children, {
        child: { xstate$$type: 1, id: "child" },
      })
      assert.strictEqual(child.id, "child")
    })
  )

  it.effect("[P6] @xstate.transition is a member of the InspectionEvent union and no actor sends it", () =>
    Effect.gen(function* () {
      // Type level: the member exists, as upstream's `InspectedTransitionEvent`
      type TransitionMember = Extract<InspectionEvent, { readonly type: "@xstate.transition" }>
      const memberExists: [TransitionMember] extends [never] ? false : true = true
      const memberType: InspectedTransitionEvent["type"] = "@xstate.transition"
      assert.isTrue(memberExists)
      assert.strictEqual(memberType, "@xstate.transition")

      // Run time: a run with raised, eventless, normal and relayed transitions, a done child, a
      // timer and a stop sends none
      const events: Array<InspectionEvent> = []
      const { actor } = yield* runRoot(events)
      yield* actor.send({ type: "FINISH" })
      yield* settle
      yield* actor.stop
      assert.isAbove(events.length, 10)
      assert.deepStrictEqual(
        events.filter((inspection) => inspection.type === "@xstate.transition"),
        []
      )
    })
  )

  it.effect("[P6] a stop sends @xstate.microstep and @xstate.snapshot with xstate.stop and status stopped; a macrostep that throws sends no @xstate.snapshot", () =>
    Effect.gen(function* () {
      type Ev = { readonly type: "NEXT" } | { readonly type: "BOOM" }
      const boom = new Error("boom")
      const machine = createMachine<object, Ev>({
        id: "p6-stop",
        context: {},
        initial: "a",
        states: {
          a: { on: { NEXT: "b" } },
          b: {
            on: {
              BOOM: {
                actions: () => {
                  throw boom
                },
              },
            },
          },
        },
      })

      const stoppedEvents: Array<InspectionEvent> = []
      const stopped = yield* createActor(machine, { inspect: record(stoppedEvents) })
      yield* stopped.start
      yield* stopped.send({ type: "NEXT" })
      yield* stopped.stop
      const lastTwo = stoppedEvents.slice(-2).map((inspection) => ({
        type: inspection.type,
        event: "event" in inspection ? inspection.event.type : undefined,
        status: "snapshot" in inspection ? inspection.snapshot.status : undefined,
        transitions: inspection.type === "@xstate.microstep" ? inspection._transitions.length : undefined,
      }))
      assert.deepStrictEqual(lastTwo, [
        { type: "@xstate.microstep", event: "xstate.stop", status: "stopped", transitions: 0 },
        { type: "@xstate.snapshot", event: "xstate.stop", status: "stopped", transitions: undefined },
      ])
      // No `@xstate.event` reports the stop event: the stop does not relay it
      assert.deepStrictEqual(eventsOfType(stoppedEvents, "xstate.stop"), [])

      const thrownEvents: Array<InspectionEvent> = []
      const thrown = yield* createActor(machine, { inspect: record(thrownEvents), logger: () => {} })
      yield* thrown.start
      yield* thrown.send({ type: "NEXT" })
      yield* thrown.send({ type: "BOOM" })
      assert.strictEqual((yield* thrown.getSnapshot).status, "error")
      assert.strictEqual(eventsOfType(thrownEvents, "BOOM").length, 1)
      assert.deepStrictEqual(
        thrownEvents.filter((inspection) => inspection.type === "@xstate.snapshot" && inspection.event.type === "BOOM"),
        []
      )
    })
  )
})
