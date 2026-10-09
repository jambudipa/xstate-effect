/**
 * P4: Children and pending delayed events persist and resume.
 *
 * T6.6. Upstream `StateMachine.restoreSnapshot` (`src/StateMachine.ts` at xstate@5.33.2)
 * creates each persisted child from its `src` (an inline invoke persists as its
 * `xstate.invoke.<index>.<state id>` name), and `StateMachine.start` starts each active child
 * only, so a done or errored child never notifies its parent again; `getPersistedSnapshot`
 * of an inline-spawned child throws `An inline child actor cannot be persisted.`. Upstream's
 * system (`src/system.ts`) records every scheduled event as `{ source, target, event, delay,
 * id, startedAt }` and `system.start` schedules the recorded ones again with their full
 * delay, but `createActor` never hands it a persisted record and the persisted snapshot holds
 * none, so upstream loses a pending delayed event on restore (its own `after` test that
 * restores one is skipped upstream, "TODO: figure out correct behavior for restoring delayed
 * transitions").
 *
 * The port persists the delayed events an actor scheduled and that are pending under the
 * `scheduledEvents` key of that actor's persisted snapshot, with the target named from the
 * actor (itself, its parent, a child id, or a systemId; an event to any other actor is left
 * out, as a restore could not deliver it) and `startedAt` read from the actor's
 * clock (the Effect clock, so `TestClock`, or the `clock` option, so a `SimulatedClock`). At
 * `start` a restored actor resumes them with the time left; one whose time has already passed
 * fires once at start (the difference from upstream's full-delay rescheduling is a ledger
 * row). `system.getSnapshot` gives the pending records, as upstream.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { TestClock } from "effect/testing"
import type { ActorRefBase } from "../../src/ActorRef.js"
import {
  assign,
  createActor,
  createMachine,
  Errors,
  fromPromise,
  isActorRef,
  raise,
  sendParent,
  sendTo,
  SimulatedClock,
} from "../../src/index.js"
import { inlineChildCannotBePersisted } from "./upstream-messages.js"

// ---------------------------------------------------------------- helpers

/** The JSON text of a value parsed back, as a stored snapshot comes back. */
const throughJson = (value: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(value)) as Record<string, unknown>

/** Lets every other ready fiber take a bounded number of turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 25; turn++) {
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

/** The persisted record of a child entry of a persisted machine snapshot. */
const childOf = (persisted: Record<string, unknown>, id: string): Record<string, unknown> =>
  ((persisted["children"] as Record<string, Record<string, unknown>>)[id]?.["snapshot"] ?? {}) as Record<string, unknown>

/** The child actor under `id` in a snapshot's children; the test fails when there is none. */
const refOf = (children: Readonly<Record<string, unknown>>, id: string): ActorRefBase => {
  const ref = children[id]
  if (!isActorRef(ref)) {
    return assert.fail(`no child actor '${id}'`)
  }
  return ref
}

/** The child's current snapshot, read as a machine snapshot of context `TContext`. */
const childSnapshot = <TContext>(children: Readonly<Record<string, unknown>>, id: string) =>
  Effect.map(
    refOf(children, id).getSnapshotUntyped,
    (snapshot) => snapshot as unknown as { readonly status: string; readonly value: unknown; readonly context: TContext; readonly children: Record<string, unknown> }
  )

// ---------------------------------------------------------------- fixtures

/** `ARM` raises `TICK` to the machine itself 100 ms later under the id `tick`; `TICK` counts. */
const ticker = createMachine({
  id: "p4-ticker",
  context: { ticks: 0 },
  on: {
    ARM: { actions: raise({ type: "TICK" }, { delay: 100, id: "tick" }) },
    TICK: { actions: assign({ ticks: ({ context }) => context.ticks + 1 }) },
  },
})

/** `a` goes to `b` 100 ms after it is entered; `LEAVE` goes to `c` first. */
const delayed = createMachine({
  id: "p4-after",
  initial: "a",
  states: {
    a: { after: { 100: "b" }, on: { LEAVE: "c" } },
    b: {},
    c: {},
  },
})

/** `grandchild` goes from `a` to `b` 100 ms after start and counts `INC`. */
const grandchild = createMachine({
  id: "p4-grandchild",
  context: { count: 0 },
  initial: "a",
  states: { a: { after: { 100: "b" } }, b: {} },
  on: { INC: { actions: assign({ count: ({ context }) => context.count + 1 }) } },
})

/** `child` invokes `grandchild` and forwards `INC` to it. */
const child = createMachine(
  {
    id: "p4-child",
    invoke: { id: "grandchild", src: "grandchild" },
    on: { INC: { actions: sendTo("grandchild", { type: "INC" }) } },
  },
  { actors: { grandchild } }
)

/** `root` invokes `child` and forwards `INC` to it: a tree three actors deep. */
const deepRoot = createMachine(
  {
    id: "p4-root",
    invoke: { id: "child", src: "child" },
    on: { INC: { actions: sendTo("child", { type: "INC" }) } },
  },
  { actors: { child } }
)

/** The grandchild's snapshot below a root of `deepRoot`. */
const grandchildSnapshotOf = (root: { readonly getSnapshot: Effect.Effect<{ readonly children: Readonly<Record<string, unknown>> }> }) =>
  Effect.gen(function* () {
    const middle = yield* childSnapshot<unknown>((yield* root.getSnapshot).children, "child")
    return yield* childSnapshot<{ readonly count: number }>(middle.children, "grandchild")
  })

// ---------------------------------------------------------------- P4

describe("P4 Children and pending delayed events persist and resume", () => {
  it.effect("[P4] a restored machine rehydrates its running child: registered under its systemId, stoppable, and gone from the system once stopped", () =>
    Effect.gen(function* () {
      const machine = createMachine(
        {
          id: "p4-running",
          initial: "a",
          states: {
            a: { invoke: { id: "kid", src: "kid", systemId: "kid-sys" }, on: { NEXT: "c" } },
            c: {},
          },
        },
        { actors: { kid: createMachine({ id: "p4-kid", context: { n: 1 } }) } }
      )
      const first = yield* createActor(machine)
      yield* first.start
      const persisted = throughJson(yield* first.getPersistedSnapshot)
      yield* first.stop

      const restored = yield* createActor(machine, { snapshot: persisted })
      yield* restored.start

      const kid = (yield* restored.getSnapshot).children["kid"]
      assert.isTrue(isActorRef(kid))
      assert.strictEqual((yield* kid!.getSnapshotUntyped).status, "active")
      assert.strictEqual(Option.getOrUndefined(yield* restored.system.get("kid-sys")), kid)

      yield* restored.send({ type: "NEXT" })
      assert.strictEqual((yield* restored.getSnapshot).value, "c")
      assert.isTrue(yield* eventually(Effect.map(kid!.getSnapshotUntyped, (snapshot) => snapshot.status === "stopped")))
      assert.isTrue(Option.isNone(yield* restored.system.get("kid-sys")))
    })
  )

  it.effect("[P4] a rehydrated done child is not registered in the system, and neither a done nor an errored child notifies its parent again", () =>
    Effect.gen(function* () {
      const heard: Array<string> = []
      const machine = createMachine(
        {
          id: "p4-ended",
          invoke: [
            { id: "fin", src: "fin", systemId: "fin-sys", onDone: { actions: () => heard.push("done") } },
            { id: "bad", src: "bad", onError: { actions: () => heard.push("error") } },
          ],
        },
        {
          actors: {
            fin: createMachine({ id: "p4-fin", type: "final" }),
            bad: fromPromise(() => Promise.reject(new Error("bad"))),
          },
        }
      )
      const first = yield* createActor(machine)
      yield* first.start
      assert.isTrue(yield* eventually(Effect.sync(() => heard.length === 2)))
      const persisted = throughJson(yield* first.getPersistedSnapshot)
      yield* first.stop
      heard.length = 0

      const restored = yield* createActor(machine, { snapshot: persisted })
      yield* restored.start
      yield* settle

      const children = (yield* restored.getSnapshot).children
      assert.strictEqual((yield* children["fin"]!.getSnapshotUntyped).status, "done")
      assert.strictEqual((yield* children["bad"]!.getSnapshotUntyped).status, "error")
      assert.isTrue(Option.isNone(yield* restored.system.get("fin-sys")))
      assert.deepStrictEqual(heard, [])
    })
  )

  it.effect("[P4] a pending delayed event persists with its id, event, delay, startedAt from the test clock and target, and resumes after the time left", () =>
    Effect.gen(function* () {
      yield* TestClock.adjust("25 millis")
      const first = yield* createActor(ticker)
      yield* first.start
      yield* first.send({ type: "ARM" })
      yield* TestClock.adjust("40 millis")

      const persisted = throughJson(yield* first.getPersistedSnapshot)
      assert.deepStrictEqual(persisted["scheduledEvents"], [
        { id: "tick", event: { type: "TICK" }, delay: 100, startedAt: 25, target: { kind: "self" } },
      ])
      yield* first.stop

      const restored = yield* createActor(ticker, { snapshot: persisted })
      yield* restored.start
      yield* TestClock.adjust("59 millis")
      yield* settle
      assert.strictEqual((yield* restored.getSnapshot).context.ticks, 0)
      yield* TestClock.adjust("1 millis")
      assert.isTrue(yield* eventually(Effect.map(restored.getSnapshot, (snapshot) => snapshot.context.ticks === 1)))
      // The event fired: nothing is pending any more
      assert.deepStrictEqual((yield* restored.system.getSnapshot)._scheduledEvents, {})
      assert.isUndefined(throughJson(yield* restored.getPersistedSnapshot)["scheduledEvents"])
    })
  )

  it.effect("[P4] on a SimulatedClock the record's startedAt is the clock's time, and the restored event fires after the time left", () =>
    Effect.gen(function* () {
      const clock = new SimulatedClock()
      yield* clock.set(25)
      const first = yield* createActor(ticker, { clock })
      yield* first.start
      yield* first.send({ type: "ARM" })
      yield* clock.increment(40)

      const persisted = throughJson(yield* first.getPersistedSnapshot)
      assert.deepStrictEqual(persisted["scheduledEvents"], [
        { id: "tick", event: { type: "TICK" }, delay: 100, startedAt: 25, target: { kind: "self" } },
      ])
      yield* first.stop

      const restored = yield* createActor(ticker, { snapshot: persisted, clock })
      yield* restored.start
      yield* clock.increment(59)
      assert.strictEqual((yield* restored.getSnapshot).context.ticks, 0)
      // The increment returns after the delivered event's macrostep (SD-28)
      yield* clock.increment(1)
      assert.strictEqual((yield* restored.getSnapshot).context.ticks, 1)
      assert.strictEqual(clock.now(), 125)
    })
  )

  it.effect("[P4] a persisted delayed event whose time has passed at restore fires once at start, on the test clock and on a SimulatedClock", () =>
    Effect.gen(function* () {
      // The Effect test clock
      const first = yield* createActor(ticker)
      yield* first.start
      yield* first.send({ type: "ARM" })
      yield* TestClock.adjust("40 millis")
      const persisted = throughJson(yield* first.getPersistedSnapshot)
      yield* first.stop
      yield* TestClock.adjust("500 millis")

      const restored = yield* createActor(ticker, { snapshot: persisted })
      yield* restored.start
      assert.isTrue(yield* eventually(Effect.map(restored.getSnapshot, (snapshot) => snapshot.context.ticks === 1)))
      yield* TestClock.adjust("1 second")
      yield* settle
      assert.strictEqual((yield* restored.getSnapshot).context.ticks, 1)

      // A SimulatedClock
      const clock = new SimulatedClock()
      const simulated = yield* createActor(ticker, { clock })
      yield* simulated.start
      yield* simulated.send({ type: "ARM" })
      const persistedOnClock = throughJson(yield* simulated.getPersistedSnapshot)
      yield* simulated.stop
      yield* clock.increment(300)

      const restoredOnClock = yield* createActor(ticker, { snapshot: persistedOnClock, clock })
      yield* restoredOnClock.start
      assert.isTrue(yield* eventually(Effect.map(restoredOnClock.getSnapshot, (snapshot) => snapshot.context.ticks === 1)))
      yield* clock.increment(1000)
      yield* settle
      assert.strictEqual((yield* restoredOnClock.getSnapshot).context.ticks, 1)
    })
  )

  it.effect("[P4] a resumed after timer keeps its id: leaving the restored state before it fires cancels it", () =>
    Effect.gen(function* () {
      const first = yield* createActor(delayed)
      yield* first.start
      yield* TestClock.adjust("40 millis")
      const persisted = throughJson(yield* first.getPersistedSnapshot)
      yield* first.stop
      assert.deepStrictEqual(persisted["scheduledEvents"], [
        {
          id: "xstate.after.100.p4-after.a",
          event: { type: "xstate.after.100.p4-after.a" },
          delay: 100,
          startedAt: 0,
          target: { kind: "self" },
        },
      ])

      // Two actors restored from it at the same time: one stays in `a`, one leaves it
      const resumed = yield* createActor(delayed, { snapshot: persisted })
      yield* resumed.start
      const left = yield* createActor(delayed, { snapshot: persisted })
      yield* left.start
      const pending = (yield* left.system.getSnapshot)._scheduledEvents
      assert.deepStrictEqual(Object.keys(pending), [`${left.sessionId}.xstate.after.100.p4-after.a`])

      // Left before it fires, its exit cancels it under the same id
      yield* left.send({ type: "LEAVE" })
      assert.deepStrictEqual((yield* left.system.getSnapshot)._scheduledEvents, {})

      // The one that stayed takes the transition after the time left; the other never does
      yield* TestClock.adjust("60 millis")
      assert.isTrue(yield* eventually(Effect.map(resumed.getSnapshot, (snapshot) => snapshot.value === "b")))
      yield* TestClock.adjust("1 second")
      yield* settle
      assert.strictEqual((yield* left.getSnapshot).value, "c")
    })
  )

  it.effect("[P4] system.getSnapshot records each pending delayed event with its source, target, event, delay, id and startedAt", () =>
    Effect.gen(function* () {
      yield* TestClock.adjust("7 millis")
      const actor = yield* createActor(ticker)
      yield* actor.start
      yield* actor.send({ type: "ARM" })

      const { _scheduledEvents } = yield* actor.system.getSnapshot
      assert.deepStrictEqual(Object.keys(_scheduledEvents), [`${actor.sessionId}.tick`])
      const record = _scheduledEvents[`${actor.sessionId}.tick`]!
      assert.strictEqual(record.source, actor)
      assert.strictEqual(record.target, actor)
      assert.deepStrictEqual(record.event, { type: "TICK" })
      assert.strictEqual(record.delay, 100)
      assert.strictEqual(record.id, "tick")
      assert.strictEqual(record.startedAt, 7)
    })
  )

  it.effect("[P4] delayed events to the parent, to a child and to a systemId persist with their targets and are delivered after restore; a generated id stays unique", () =>
    Effect.gen(function* () {
      const kid = createMachine({
        id: "p4-kid",
        context: { pokes: 0 },
        on: {
          POKE: { actions: assign({ pokes: ({ context }) => context.pokes + 1 }) },
          // `sendParent` takes no id: the scheduler generates one
          PING_LATER: { actions: sendParent({ type: "PING" }, { delay: 100 }) },
          SIGNAL_LATER: { actions: sendTo("peer-sys", { type: "SIGNAL" }, { delay: 100, id: "signal" }) },
        },
      })
      const peer = createMachine({
        id: "p4-peer",
        context: { signals: 0 },
        on: { SIGNAL: { actions: assign({ signals: ({ context }) => context.signals + 1 }) } },
      })
      const machine = createMachine(
        {
          id: "p4-family",
          context: { pings: 0 },
          invoke: [
            { id: "kid", src: "kid" },
            { id: "peer", src: "peer", systemId: "peer-sys" },
          ],
          on: {
            POKE_LATER: { actions: sendTo("kid", { type: "POKE" }, { delay: 100, id: "poke" }) },
            ASK: { actions: [sendTo("kid", { type: "PING_LATER" }), sendTo("kid", { type: "SIGNAL_LATER" })] },
            ASK_PING: { actions: sendTo("kid", { type: "PING_LATER" }) },
            PING: { actions: assign({ pings: ({ context }) => context.pings + 1 }) },
          },
        },
        { actors: { kid, peer } }
      )

      const first = yield* createActor(machine)
      yield* first.start
      yield* first.send({ type: "POKE_LATER" })
      yield* first.send({ type: "ASK" })
      assert.isTrue(
        yield* eventually(Effect.map(first.system.getSnapshot, (snapshot) => Object.keys(snapshot._scheduledEvents).length === 3))
      )
      yield* TestClock.adjust("30 millis")

      const persisted = throughJson(yield* first.getPersistedSnapshot)
      assert.deepStrictEqual(persisted["scheduledEvents"], [
        { id: "poke", event: { type: "POKE" }, delay: 100, startedAt: 0, target: { kind: "child", id: "kid" } },
      ])
      assert.deepStrictEqual(childOf(persisted, "kid")["scheduledEvents"], [
        { id: "signal", event: { type: "SIGNAL" }, delay: 100, startedAt: 0, target: { kind: "system", systemId: "peer-sys" } },
        { id: "xstate.scheduled.0", event: { type: "PING" }, delay: 100, startedAt: 0, target: { kind: "parent" } },
      ])
      yield* first.stop

      const restored = yield* createActor(machine, { snapshot: persisted })
      yield* restored.start
      const children = (yield* restored.getSnapshot).children
      const kidRef = refOf(children, "kid")

      // A new generated id of the kid does not take the one its restored event holds
      yield* restored.send({ type: "ASK_PING" })
      assert.isTrue(
        yield* eventually(
          Effect.map(restored.system.getSnapshot, (snapshot) =>
            Object.keys(snapshot._scheduledEvents).includes(`${kidRef.sessionId}.xstate.scheduled.1`)
          )
        )
      )
      assert.include(Object.keys((yield* restored.system.getSnapshot)._scheduledEvents), `${kidRef.sessionId}.xstate.scheduled.0`)

      yield* TestClock.adjust("69 millis")
      yield* settle
      assert.strictEqual((yield* restored.getSnapshot).context.pings, 0)

      // At 100 ms the three restored events arrive; the new PING follows 30 ms later
      yield* TestClock.adjust("1 millis")
      assert.isTrue(yield* eventually(Effect.map(restored.getSnapshot, (snapshot) => snapshot.context.pings === 1)))
      assert.isTrue(yield* eventually(Effect.map(childSnapshot<{ readonly pokes: number }>(children, "kid"), (kidSnapshot) => kidSnapshot.context.pokes === 1)))
      assert.isTrue(
        yield* eventually(Effect.map(childSnapshot<{ readonly signals: number }>(children, "peer"), (peerSnapshot) => peerSnapshot.context.signals === 1))
      )
      yield* TestClock.adjust("30 millis")
      assert.isTrue(yield* eventually(Effect.map(restored.getSnapshot, (snapshot) => snapshot.context.pings === 2)))
    })
  )

  it.effect("[P4] a delayed event to an actor that the persisted tree cannot name is left out of the persisted snapshot, and only the others resume", () =>
    Effect.gen(function* () {
      // A root actor of another system: neither the sender, its parent, its child nor a systemId
      const outsider = yield* createActor(
        createMachine({
          id: "p4-outsider",
          context: { pokes: 0 },
          on: { POKE: { actions: assign({ pokes: ({ context }) => context.pokes + 1 }) } },
        })
      )
      yield* outsider.start
      const sender = createMachine({
        id: "p4-sender",
        context: { ticks: 0 },
        on: {
          ARM: {
            actions: [
              sendTo(() => outsider, { type: "POKE" }, { delay: 100, id: "far" }),
              raise({ type: "TICK" }, { delay: 100, id: "near" }),
            ],
          },
          TICK: { actions: assign({ ticks: ({ context }) => context.ticks + 1 }) },
        },
      })
      const first = yield* createActor(sender)
      yield* first.start
      yield* first.send({ type: "ARM" })
      assert.deepStrictEqual(Object.keys((yield* first.system.getSnapshot)._scheduledEvents).sort(), [
        `${first.sessionId}.far`,
        `${first.sessionId}.near`,
      ])

      const persisted = throughJson(yield* first.getPersistedSnapshot)
      assert.deepStrictEqual(persisted["scheduledEvents"], [
        { id: "near", event: { type: "TICK" }, delay: 100, startedAt: 0, target: { kind: "self" } },
      ])
      yield* first.stop

      const restored = yield* createActor(sender, { snapshot: persisted })
      yield* restored.start
      assert.deepStrictEqual(Object.keys((yield* restored.system.getSnapshot)._scheduledEvents), [`${restored.sessionId}.near`])
      yield* TestClock.adjust("100 millis")
      assert.isTrue(yield* eventually(Effect.map(restored.getSnapshot, (snapshot) => snapshot.context.ticks === 1)))
      yield* settle
      assert.strictEqual((yield* outsider.getSnapshot).context.pokes, 0)
    })
  )

  it.effect("[P4] a deep tree persists and restores: the grandchild's context and its pending after timer resume", () =>
    Effect.gen(function* () {
      const first = yield* createActor(deepRoot)
      yield* first.start
      yield* first.send({ type: "INC" })
      assert.isTrue(yield* eventually(Effect.map(grandchildSnapshotOf(first), (snapshot) => snapshot.context.count === 1)))
      yield* TestClock.adjust("30 millis")

      const persisted = throughJson(yield* first.getPersistedSnapshot)
      yield* first.stop
      const persistedGrandchild = childOf(childOf(persisted, "child"), "grandchild")
      assert.strictEqual(persistedGrandchild["value"], "a")
      assert.deepStrictEqual(persistedGrandchild["scheduledEvents"], [
        {
          id: "xstate.after.100.p4-grandchild.a",
          event: { type: "xstate.after.100.p4-grandchild.a" },
          delay: 100,
          startedAt: 0,
          target: { kind: "self" },
        },
      ])

      const restored = yield* createActor(deepRoot, { snapshot: persisted })
      yield* restored.start
      const restoredGrandchild = yield* grandchildSnapshotOf(restored)
      assert.strictEqual(restoredGrandchild.context.count, 1)
      assert.strictEqual(restoredGrandchild.value, "a")

      yield* TestClock.adjust("69 millis")
      yield* settle
      assert.strictEqual((yield* grandchildSnapshotOf(restored)).value, "a")
      yield* TestClock.adjust("1 millis")
      assert.isTrue(yield* eventually(Effect.map(grandchildSnapshotOf(restored), (snapshot) => snapshot.value === "b")))
    })
  )

  it.effect("[P4] persisting a rehydrated tree gives the same JSON, before its start and right after it", () =>
    Effect.gen(function* () {
      const first = yield* createActor(deepRoot)
      yield* first.start
      yield* first.send({ type: "INC" })
      assert.isTrue(yield* eventually(Effect.map(grandchildSnapshotOf(first), (snapshot) => snapshot.context.count === 1)))
      yield* TestClock.adjust("30 millis")
      const text = JSON.stringify(yield* first.getPersistedSnapshot)
      yield* first.stop

      const restored = yield* createActor(deepRoot, { snapshot: JSON.parse(text) })
      assert.strictEqual(JSON.stringify(yield* restored.getPersistedSnapshot), text)
      yield* restored.start
      yield* settle
      assert.strictEqual(JSON.stringify(yield* restored.getPersistedSnapshot), text)
    })
  )

  it.effect("[P4] an inline-invoked child persists under its xstate.invoke src and rehydrates from it", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "p4-inline",
        invoke: {
          id: "inline",
          src: createMachine({
            id: "p4-inline-child",
            context: { n: 0 },
            on: { INC: { actions: assign({ n: ({ context }) => context.n + 1 }) } },
          }),
        },
        on: { INC: { actions: sendTo("inline", { type: "INC" }) } },
      })
      const first = yield* createActor(machine)
      yield* first.start
      yield* first.send({ type: "INC" })
      const inlineOf = (actor: typeof first) =>
        Effect.flatMap(actor.getSnapshot, (snapshot) => childSnapshot<{ readonly n: number }>(snapshot.children, "inline"))
      assert.isTrue(yield* eventually(Effect.map(inlineOf(first), (snapshot) => snapshot.context.n === 1)))

      const persisted = throughJson(yield* first.getPersistedSnapshot)
      yield* first.stop
      const entry = (persisted["children"] as Record<string, Record<string, unknown>>)["inline"]!
      assert.strictEqual(entry["src"], "xstate.invoke.0.p4-inline")

      const restored = yield* createActor(machine, { snapshot: persisted })
      yield* restored.start
      assert.strictEqual((yield* inlineOf(restored)).context.n, 1)
      yield* restored.send({ type: "INC" })
      assert.isTrue(yield* eventually(Effect.map(inlineOf(restored), (snapshot) => snapshot.context.n === 2)))
    })
  )

  it.effect("[P4] persisting an inline-spawned child fails with the recorded upstream message", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "p4-inline-spawn",
        context: ({ spawn }) => ({ ref: spawn(createMachine({ id: "p4-spawned" })) }),
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      const error = yield* Effect.flip(actor.getPersistedSnapshot)
      assert.instanceOf(error, Errors.SerializationError)
      assert.strictEqual(error.message, inlineChildCannotBePersisted)
    })
  )
})
