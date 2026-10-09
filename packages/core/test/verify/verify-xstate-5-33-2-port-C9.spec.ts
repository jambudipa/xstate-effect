/**
 * C9: a transition actor reduces events with its actor scope.
 *
 * T2.51. Upstream (`actors/transition.ts` at xstate@5.33.2):
 * `fromTransition<TContext, TEvent, TSystem, TInput, TEmitted>(transition, initialContext)`.
 * `transition(state, event, actorScope)` gives the next context, and the actor scope carries the
 * actor's `self`, `id`, `sessionId`, `system` and `emit`; `emit` delivers to the actor's
 * listeners at once, inside the reducer call. `initialContext` is the context itself, or a
 * function of `{ input, self }` that builds it. The logic's `config` is the reducer.
 *
 * The port reads the actor scope from the `ActorScope` service and hands the reducer a plain
 * object, so the reducer stays a plain function. Its `emit` is a plain function too: each event
 * reaches the listeners inside the call (T4.13), so inside the transition, before the snapshot
 * commits, and before a later throw of the reducer, as upstream. Errors are
 * the raw thrown values (SD-4). `fromTransitionWithInput` stays as a port extra whose factory
 * takes the raw input (SD-12). Phase-2 children are spawned (SD-15).
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import type { ActorRefBase } from "../../src/ActorRef.js"
import {
  type ActorSystemService,
  type ActorType,
  type AnyActorLogic,
  assign,
  createActor,
  createMachine,
  type EventObject,
  fromTransition,
  fromTransitionWithInput,
  getInitialSnapshot,
  getNextSnapshot,
  isActor,
  spawnChild,
  type TransitionActorRef,
} from "../../src/index.js"

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

/** The child actor behind a reference; fails the test when the reference is not an actor. */
const asActor = (ref: ActorRefBase | undefined): ActorType.Any => {
  assert.isTrue(isActor(ref), "the reference is an actor")
  return ref as ActorType.Any
}

interface Counter {
  readonly count: number
  readonly step: number
}

type CounterEvent = { readonly type: "inc" } | { readonly type: "dec" } | { readonly type: "reset" }

/** Upstream's example reducer: `inc` adds `step`, `dec` takes it away, `reset` sets 0. */
const countBy = (state: Counter, event: CounterEvent): Counter => {
  switch (event.type) {
    case "inc":
      return { ...state, count: state.count + state.step }
    case "dec":
      return { ...state, count: state.count - state.step }
    case "reset":
      return { ...state, count: 0 }
  }
}

interface Received {
  readonly received: ReadonlyArray<unknown>
}

/** Keeps every event the parent takes, in order. */
const record = assign<Received, EventObject>(({ context, event }) => ({ received: [...context.received, event] }))

/** A parent that spawns `child` as `reducer` and keeps the child's error event. */
const parentOf = <TLogic extends AnyActorLogic>(child: TLogic) =>
  createMachine<Received, EventObject>({
    id: "c9-parent",
    context: { received: [] },
    entry: spawnChild<Received, EventObject, TLogic>(child, { id: "reducer" }),
    on: {
      "xstate.error.actor.reducer": { actions: record },
    },
  })

describe("C9 A transition actor reduces events with its actor scope", () => {
  it.effect("[C9] the factory receives { input, self } and builds the initial state from the input", () =>
    Effect.gen(function* () {
      const seen: Array<{ readonly input: unknown; readonly self: unknown }> = []
      // The upstream generic order: context, event, system, input, emitted events (SD-12)
      const logic = fromTransition<Counter, CounterEvent, ActorSystemService, { readonly step: number }>(countBy, ({ input, self }) => {
        const ref: TransitionActorRef<Counter, CounterEvent> = self
        seen.push({ input, self: ref })
        return { count: 0, step: input.step }
      })
      const input = { step: 10 }
      const actor = yield* createActor(logic, { input })

      assert.deepStrictEqual((yield* actor.getSnapshot).context, { count: 0, step: 10 })
      assert.strictEqual((yield* actor.getSnapshot).status, "active")
      assert.strictEqual(seen.length, 1)
      assert.strictEqual(seen[0]?.input, input)
      assert.strictEqual(seen[0]?.self, actor)

      yield* actor.start
      yield* actor.send({ type: "inc" })
      assert.deepStrictEqual((yield* actor.getSnapshot).context, { count: 10, step: 10 })
    })
  )

  it.effect("[C9] a plain initial state is used as it is, and the logic's config is the reducer", () =>
    Effect.gen(function* () {
      const initial: Counter = { count: 5, step: 1 }
      const logic = fromTransition(countBy, initial)
      const actor = yield* createActor(logic)

      assert.strictEqual((yield* actor.getSnapshot).context, initial)
      assert.strictEqual(logic.config, countBy)
    })
  )

  it.effect("[C9] the reducer receives (state, event, actorScope), and the scope carries the actor's self, id, sessionId and system", () =>
    Effect.gen(function* () {
      const seen: Array<{ readonly state: unknown; readonly event: unknown; readonly self: unknown; readonly id: string; readonly sessionId: string; readonly system: unknown }> = []
      const logic = fromTransition((state: Counter, event: CounterEvent, actorScope) => {
        const self: TransitionActorRef<Counter, CounterEvent> = actorScope.self
        const system: ActorSystemService = actorScope.system
        seen.push({ state, event, self, id: actorScope.id, sessionId: actorScope.sessionId, system })
        return countBy(state, event)
      }, { count: 0, step: 1 })
      const actor = yield* createActor(logic, { id: "c9-counter" })
      yield* actor.start

      yield* actor.send({ type: "inc" })

      assert.strictEqual(seen.length, 1)
      assert.deepStrictEqual(seen[0]?.state, { count: 0, step: 1 })
      assert.deepStrictEqual(seen[0]?.event, { type: "inc" })
      assert.strictEqual(seen[0]?.self, actor)
      assert.strictEqual(seen[0]?.id, "c9-counter")
      assert.strictEqual(seen[0]?.sessionId, actor.sessionId)
      assert.strictEqual(seen[0]?.system, actor.system)
    })
  )

  it.effect("[C9] the reducer can emit through the scope: each emitted event reaches the listeners in order, inside the transition", () =>
    Effect.gen(function* () {
      type Emitted = { readonly type: "c9.emitted"; readonly msg: string }
      const logic = fromTransition<Counter, CounterEvent, ActorSystemService, unknown, Emitted>((state, event, { emit }) => {
        emit({ type: "c9.emitted", msg: `${event.type} first` })
        emit({ type: "c9.emitted", msg: `${event.type} second` })
        return countBy(state, event)
      }, { count: 0, step: 1 })
      const actor = yield* createActor(logic)
      const heard: Array<{ readonly msg: string; readonly countSeen: number }> = []
      yield* actor.on("c9.emitted", (event) =>
        Effect.map(actor.getSnapshot, (snapshot) => {
          heard.push({ msg: event.msg, countSeen: snapshot.context.count })
        })
      )
      yield* actor.start

      yield* actor.send({ type: "inc" })

      // Upstream delivers inside the reducer call, before the snapshot commits: a listener reads
      // the snapshot from before the event
      assert.deepStrictEqual(heard, [
        { msg: "inc first", countSeen: 0 },
        { msg: "inc second", countSeen: 0 },
      ])
      assert.strictEqual((yield* actor.getSnapshot).context.count, 1)
    })
  )

  it.effect("[C9] after each send the actor snapshot shows the reduced state, and a subscriber sees each state", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(fromTransition(countBy, { count: 0, step: 2 }))
      const seen: Array<number> = []
      yield* actor.subscribe((snapshot) =>
        Effect.sync(() => {
          seen.push(snapshot.context.count)
        })
      )
      yield* actor.start

      const events: ReadonlyArray<CounterEvent> = [{ type: "inc" }, { type: "inc" }, { type: "dec" }, { type: "reset" }, { type: "inc" }]
      const counts: Array<number> = []
      for (const event of events) {
        yield* actor.send(event)
        counts.push((yield* actor.getSnapshot).context.count)
      }

      assert.deepStrictEqual(counts, [2, 4, 2, 0, 2])
      assert.isTrue(yield* eventually(Effect.sync(() => seen.length === 6)), "the subscriber sees every state")
      assert.deepStrictEqual(seen, [0, 2, 4, 2, 0, 2])
      assert.strictEqual((yield* actor.getSnapshot).status, "active")
    })
  )

  it.effect("[C9] a throwing reducer sets status error with the thrown value, after its earlier emits reached the listeners", () =>
    Effect.gen(function* () {
      const boom = { reason: "thrown in the reducer" }
      const logic = fromTransition<Counter, CounterEvent, ActorSystemService, unknown, { readonly type: "c9.before" }>((state, event, { emit }) => {
        if (event.type === "dec") {
          emit({ type: "c9.before" })
          throw boom
        }
        return countBy(state, event)
      }, { count: 0, step: 1 })
      const actor = yield* createActor(logic)
      const heard: Array<unknown> = []
      yield* actor.on("*", (event) =>
        Effect.sync(() => {
          heard.push(event)
        })
      )
      yield* actor.start
      yield* actor.send({ type: "inc" })

      yield* actor.send({ type: "dec" })
      assert.isTrue(yield* eventually(Effect.map(actor.getSnapshot, (snapshot) => snapshot.status === "error")), "the actor errors")

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(Option.getOrUndefined(snapshot.error), boom)
      assert.deepStrictEqual(heard, [{ type: "c9.before" }])
    })
  )

  it.effect("[C9] a spawned reducer that throws reaches its parent as xstate.error.actor.<id> with the thrown value", () =>
    Effect.gen(function* () {
      const boom = { reason: "thrown in a spawned reducer" }
      const logic = fromTransition((state: number, event: EventObject) => {
        if (event.type === "explode") {
          throw boom
        }
        return state + 1
      }, 0)
      const actor = yield* createActor(parentOf(logic))
      yield* actor.start
      const child = asActor((yield* actor.getSnapshot).children["reducer"])

      yield* child.send({ type: "explode" })
      assert.isTrue(
        yield* eventually(Effect.map(actor.getSnapshot, (snapshot) => snapshot.context.received.length > 0)),
        "the parent hears of it"
      )
      yield* settle

      assert.strictEqual((yield* child.getSnapshot).status, "error")
      assert.deepStrictEqual((yield* actor.getSnapshot).context.received, [
        { type: "xstate.error.actor.reducer", error: boom, actorId: "reducer" },
      ])
    })
  )

  it.effect("[C9] a throwing factory gives the actor status error with the thrown value", () =>
    Effect.gen(function* () {
      const boom = { reason: "thrown in the factory" }
      const logic = fromTransition(countBy, (): Counter => {
        throw boom
      })
      const actor = yield* createActor(logic)

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "error")
      assert.strictEqual(Option.getOrUndefined(snapshot.error), boom)
    })
  )

  it.effect("[C9] the pure helpers build the initial state from the input and reduce without an actor", () =>
    Effect.gen(function* () {
      const logic = fromTransition<Counter, CounterEvent, ActorSystemService, { readonly step: number }, { readonly type: "c9.ignored" }>(
        (state, event, { emit }) => {
          emit({ type: "c9.ignored" })
          return countBy(state, event)
        },
        ({ input }) => ({ count: 0, step: input.step })
      )

      const inc: CounterEvent = { type: "inc" }
      const initial = yield* getInitialSnapshot(logic, { step: 3 })
      const next = yield* getNextSnapshot(logic, initial, inc)

      assert.deepStrictEqual(initial.context, { count: 0, step: 3 })
      assert.deepStrictEqual(next.context, { count: 3, step: 3 })
    })
  )

  it.effect("[C9] fromTransitionWithInput (port extra) builds the initial state from the raw input, and its reducer receives the actor scope too", () =>
    Effect.gen(function* () {
      const selves: Array<unknown> = []
      const logic = fromTransitionWithInput<{ readonly initial: number }>()(
        (state: Counter, event: CounterEvent, { self }) => {
          selves.push(self)
          return countBy(state, event)
        },
        ({ initial }) => ({ count: initial, step: 1 })
      )
      const actor = yield* createActor(logic, { input: { initial: 41 } })
      yield* actor.start

      yield* actor.send({ type: "inc" })

      assert.deepStrictEqual((yield* actor.getSnapshot).context, { count: 42, step: 1 })
      assert.deepStrictEqual(selves, [actor])
    })
  )
})
