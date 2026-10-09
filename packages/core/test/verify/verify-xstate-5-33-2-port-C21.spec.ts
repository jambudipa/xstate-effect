/**
 * C21: system.inspect subscribes within a scope.
 *
 * T5.11. Upstream `createSystem` in `src/system.ts` at xstate@5.33.2 keeps the inspection
 * observers in a `Set`: `inspect(fn)` adds `toObserver(fn)`, a new object per call, so one
 * function registered twice is two observers, and `unsubscribe` removes that one only.
 * `sendInspectionEvent` calls each observer in insertion order, one after another, also an
 * observer added while it runs (`Set.forEach`). The `inspect` option of an actor without a
 * parent registers the same way in the `Actor` constructor (`src/createActor.ts`), before the
 * actor books its session id; an actor with a parent ignores it. A tsx probe of 5.33.2
 * (`packages/core/.upstream/measure/t511/probe-up.ts`) gives, per inspection event,
 * `A, fn, B, fn` for the registrations A, fn, B, fn and `A, B, fn` after the first `fn`
 * unsubscribed; nothing for a child's own option; only later events for a late observer.
 *
 * Effect form (D6, SD-18): `system.inspect(fn)` takes a function that returns an Effect and
 * registers it until the scope it runs in closes; the `inspect` option takes the same function
 * and keeps it for the root actor's lifetime. The observer-object form is not ported (DEV-20).
 * Upstream lets an observer that throws break the actor that sent the event (the throw reaches
 * the actor's `start` or `_process`); the port reports what an inspection function throws, fails
 * or dies with through the logger and changes no actor (SD-21, DEV-22), so every later actor
 * start works. Waits are bounded yields; no test sleeps.
 */
import { assert, describe, it } from "@effect/vitest"
import { Cause, Effect, Exit, Logger, Option, Scope } from "effect"
import type { ActorRefBase } from "../../src/ActorRef.js"
import {
  type ActorType,
  assign,
  createActor,
  createMachine,
  type InspectionEvent,
  isActor,
  sendParent,
  sendTo,
  spawnChild,
} from "../../src/index.js"

type ChildEvent = { readonly type: "PING" }

/** A child machine that answers each PING with a PONG to its parent. */
const childMachine = createMachine<object, ChildEvent>({
  id: "c21-child",
  context: {},
  on: { PING: { actions: sendParent<object, ChildEvent>({ type: "PONG" }) } },
})

interface ParentContext {
  readonly pongs: number
}

type ParentEvent =
  | { readonly type: "LOAD" }
  | { readonly type: "PONG" }
  | { readonly type: "SPAWN" }
  | { readonly type: "LOAD_LATER" }

/**
 * A parent that spawns `child` at start: LOAD sends PING to `child`, SPAWN spawns another
 * child `later`, LOAD_LATER sends PING to `later`, and each PONG counts.
 */
const parentMachine = () =>
  createMachine<ParentContext, ParentEvent>({
    id: "c21-parent",
    context: { pongs: 0 },
    entry: spawnChild<ParentContext, ParentEvent, typeof childMachine>(childMachine, { id: "child" }),
    on: {
      LOAD: { actions: sendTo<ParentContext, ParentEvent>("child", { type: "PING" }) },
      PONG: { actions: assign<ParentContext, ParentEvent>(({ context }) => ({ pongs: context.pongs + 1 })) },
      SPAWN: { actions: spawnChild<ParentContext, ParentEvent, typeof childMachine>(childMachine, { id: "later" }) },
      LOAD_LATER: { actions: sendTo<ParentContext, ParentEvent>("later", { type: "PING" }) },
    },
  })

type ParentActor = Effect.Success<ReturnType<typeof createParent>>

const createParent = () => createActor(parentMachine(), { id: "parent" })

/** The child actor behind a reference; fails the test when the reference is not an actor. */
const asActor = (ref: ActorRefBase | undefined): ActorType.Any => {
  assert.isTrue(isActor(ref), "the reference is an actor")
  return ref as ActorType.Any
}

/** The child of `actor` under `id`. */
const childOf = (actor: ParentActor, id: string) =>
  Effect.map(actor.getSnapshot, (snapshot) => asActor(snapshot.children[id]))

/** Lets every other ready fiber take ten turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 10; turn++) {
    yield* Effect.yieldNow
  }
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
    return false
  })

/** Whether the parent counted `n` PONGs. */
const pongsReach = (actor: ParentActor, n: number) =>
  Effect.map(actor.getSnapshot, (snapshot) => snapshot.context.pongs === n)

/** An inspection function that keeps every event in `into`. */
const record = (into: Array<InspectionEvent>) => (event: InspectionEvent) =>
  Effect.sync(() => {
    into.push(event)
  })

/** The type of the event an inspection event carries, when it carries one. */
const eventTypeOf = (inspection: InspectionEvent): string | undefined =>
  inspection.type === "@xstate.event" || inspection.type === "@xstate.snapshot" ? inspection.event.type : undefined

/** The `@xstate.event` inspection events of `type` whose source is `source` and whose target is `target`. */
const relayed = (seen: ReadonlyArray<InspectionEvent>, type: string, source: ActorRefBase, target: ActorRefBase) =>
  seen.filter(
    (inspection) =>
      inspection.type === "@xstate.event" &&
      inspection.event.type === type &&
      inspection.actorRef === target &&
      Option.exists(inspection.sourceRef, (sender) => sender === source)
  )

/** The `@xstate.snapshot` inspection events of `actor` for an event of `type`. */
const snapshotsOf = (seen: ReadonlyArray<InspectionEvent>, actor: ActorRefBase, type: string) =>
  seen.filter((inspection) => inspection.type === "@xstate.snapshot" && inspection.actorRef === actor && inspection.event.type === type)

/** The ids of the actors that `@xstate.actor` inspection events name. */
const announced = (seen: ReadonlyArray<InspectionEvent>) =>
  seen.flatMap((inspection) => (inspection.type === "@xstate.actor" ? [inspection.actorRef.id] : []))

/** The ids of the actors whose start the inspection events report (the init `@xstate.event`), with the id of the source. */
const startedActors = (seen: ReadonlyArray<InspectionEvent>) =>
  seen.flatMap((inspection) =>
    inspection.type === "@xstate.event" && inspection.event.type === "xstate.init"
      ? [[inspection.actorRef.id, Option.getOrUndefined(Option.map(inspection.sourceRef, (source) => source.id))] as const]
      : []
  )

/** The log entries a test logger kept. */
type Entries = Array<Logger.Options<unknown>>

/** Runs `program` with a logger that keeps every log entry in `entries`. */
const withLogger = <A, E, R>(entries: Entries, program: Effect.Effect<A, E, R>) =>
  program.pipe(
    Effect.provide(
      Logger.layer([
        Logger.make((options) => {
          entries.push(options)
        }),
      ])
    )
  )

/** The values of every Error-level entry, one list per report: its message parts, then its cause's errors and defects. */
const reports = (entries: Entries): ReadonlyArray<ReadonlyArray<unknown>> =>
  entries
    .filter((entry) => entry.logLevel === "Error")
    .map((entry) => [
      ...(Array.isArray(entry.message) ? entry.message : [entry.message]),
      ...entry.cause.reasons.flatMap((reason) =>
        Cause.isDieReason(reason) ? [reason.defect] : Cause.isFailReason(reason) ? [reason.error] : []
      ),
    ])

describe("C21 system.inspect subscribes within a scope", () => {
  it.effect("[C21] a function registered with system.inspect in a scope receives the inspection events of the actors that start and exchange events", () =>
    Effect.gen(function* () {
      const actor = yield* createParent()
      const seen: Array<InspectionEvent> = []
      yield* actor.system.inspect(record(seen))

      yield* actor.start
      yield* actor.send({ type: "LOAD" })
      assert.isTrue(yield* eventually(pongsReach(actor, 1)), "the parent receives PONG")
      yield* settle
      const child = yield* childOf(actor, "child")

      // Both actors were created before the registration, so no `@xstate.actor` reaches it
      // (upstream sends it in the constructor); it sees both start, the parent with no source
      // and the child with the parent as source, the events they exchange with their senders,
      // and their snapshots
      assert.deepStrictEqual(announced(seen), [])
      assert.deepStrictEqual(startedActors(seen), [["parent", undefined], ["child", "parent"]])
      assert.strictEqual(relayed(seen, "PING", actor, child).length, 1, "PING from the parent to the child")
      assert.strictEqual(relayed(seen, "PONG", child, actor).length, 1, "PONG from the child to the parent")
      assert.strictEqual(snapshotsOf(seen, actor, "LOAD").length, 1)
      assert.strictEqual(snapshotsOf(seen, child, "PING").length, 1)
      assert.strictEqual(snapshotsOf(seen, actor, "PONG").length, 1)
    })
  )

  it.effect("[C21] after its scope closes the function receives no more events, and later actors start and exchange events normally", () =>
    Effect.gen(function* () {
      const actor = yield* createParent()
      const seen: Array<InspectionEvent> = []
      const scope = yield* Scope.make()
      yield* actor.system.inspect(record(seen)).pipe(Scope.provide(scope))
      yield* actor.start
      assert.isAbove(seen.length, 0, "the function receives the start's events")

      yield* Scope.close(scope, Exit.void)
      seen.length = 0

      yield* actor.send({ type: "LOAD" })
      assert.isTrue(yield* eventually(pongsReach(actor, 1)), "the first child answers")
      yield* actor.send({ type: "SPAWN" })
      const later = yield* childOf(actor, "later")
      yield* actor.send({ type: "LOAD_LATER" })
      assert.isTrue(yield* eventually(pongsReach(actor, 2)), "the child spawned after the close answers")
      yield* settle

      assert.strictEqual((yield* later.getSnapshot).status, "active")
      assert.strictEqual((yield* actor.getSnapshot).status, "active")
      assert.deepStrictEqual(seen, [])
    })
  )

  it.effect("[C21] a function registered late receives only the events after its registration", () =>
    Effect.gen(function* () {
      const actor = yield* createParent()
      yield* actor.start
      yield* actor.send({ type: "LOAD" })
      assert.isTrue(yield* eventually(pongsReach(actor, 1)))
      yield* settle

      const late: Array<InspectionEvent> = []
      yield* actor.system.inspect(record(late))
      assert.deepStrictEqual(late, [])

      yield* actor.send({ type: "PONG" })
      yield* settle

      // Upstream (probe): `@xstate.event`, then the snapshot, of PONG only
      assert.deepStrictEqual(
        late
          .filter((inspection) => inspection.type === "@xstate.event" || inspection.type === "@xstate.snapshot")
          .map((inspection) => [inspection.type, eventTypeOf(inspection)]),
        [
          ["@xstate.event", "PONG"],
          ["@xstate.snapshot", "PONG"],
        ]
      )
      assert.isTrue(late.every((inspection) => inspection.actorRef === actor), "only the parent's events")
    })
  )

  it.effect("[C21] the functions run one after another in registration order: each one ends before the next one starts", () =>
    Effect.gen(function* () {
      const actor = yield* createParent()
      const log: Array<string> = []
      // `yields` turns between the start and the end let a concurrent run interleave
      const named = (name: string, yields: number) => (event: InspectionEvent) =>
        Effect.gen(function* () {
          log.push(`${name} start ${event.type}`)
          for (let turn = 0; turn < yields; turn++) {
            yield* Effect.yieldNow
          }
          log.push(`${name} end ${event.type}`)
        })
      yield* actor.system.inspect(named("first", 3))
      yield* actor.system.inspect(named("second", 0))
      yield* actor.system.inspect(named("third", 1))

      yield* actor.start
      yield* actor.send({ type: "PONG" })
      yield* settle

      assert.isAbove(log.length, 0)
      assert.strictEqual(log.length % 6, 0)
      for (let at = 0; at < log.length; at += 6) {
        const type = log[at]!.split(" ")[2]
        assert.deepStrictEqual(
          log.slice(at, at + 6),
          ["first", "second", "third"].flatMap((name) => [`${name} start ${type}`, `${name} end ${type}`]),
          `inspection event ${at / 6}`
        )
      }
    })
  )

  it.effect("[C21] one function registered in two scopes is two registrations: each one keeps its place, and closing one scope removes that one only", () =>
    Effect.gen(function* () {
      const actor = yield* createParent()
      const log: Array<string> = []
      const named = (name: string) => (event: InspectionEvent) =>
        Effect.sync(() => {
          log.push(`${name} ${event.type}`)
        })
      const twice = named("twice")
      const firstScope = yield* Scope.make()
      const secondScope = yield* Scope.make()
      yield* actor.system.inspect(named("A"))
      yield* actor.system.inspect(twice).pipe(Scope.provide(firstScope))
      yield* actor.system.inspect(named("B"))
      yield* actor.system.inspect(twice).pipe(Scope.provide(secondScope))

      /** The names that ran, per inspection event, after one external PONG. */
      const namesPerEvent = (perEvent: number) =>
        Effect.gen(function* () {
          log.length = 0
          yield* actor.send({ type: "PONG" })
          yield* settle
          assert.isAbove(log.length, 0)
          assert.strictEqual(log.length % perEvent, 0)
          const groups: Array<ReadonlyArray<string>> = []
          for (let at = 0; at < log.length; at += perEvent) {
            groups.push(log.slice(at, at + perEvent).map((entry) => entry.split(" ")[0]!))
          }
          return groups
        })

      yield* actor.start
      for (const names of yield* namesPerEvent(4)) {
        assert.deepStrictEqual(names, ["A", "twice", "B", "twice"])
      }

      // Upstream (probe): `A, B, fn` once the first registration of `fn` is gone
      yield* Scope.close(firstScope, Exit.void)
      for (const names of yield* namesPerEvent(3)) {
        assert.deepStrictEqual(names, ["A", "B", "twice"])
      }

      yield* Scope.close(secondScope, Exit.void)
      for (const names of yield* namesPerEvent(2)) {
        assert.deepStrictEqual(names, ["A", "B"])
      }
    })
  )

  it.effect("[C21] a function registered while an inspection event goes round receives that event too, and one removed before its turn does not (upstream Set.forEach)", () =>
    Effect.gen(function* () {
      const actor = yield* createParent()
      const log: Array<string> = []
      const addedScope = yield* Scope.make()
      const removedScope = yield* Scope.make()
      let registered = false
      yield* actor.system.inspect((event) =>
        Effect.gen(function* () {
          log.push(`first ${event.type}`)
          if (!registered) {
            registered = true
            // Registered during the first event; the third function goes before its turn
            yield* actor.system
              .inspect((later) =>
                Effect.sync(() => {
                  log.push(`added ${later.type}`)
                })
              )
              .pipe(Scope.provide(addedScope))
            yield* Scope.close(removedScope, Exit.void)
          }
        })
      )
      yield* actor.system
        .inspect((event) =>
          Effect.sync(() => {
            log.push(`removed ${event.type}`)
          })
        )
        .pipe(Scope.provide(removedScope))

      yield* actor.start
      yield* actor.send({ type: "PONG" })
      yield* settle

      assert.isAbove(log.length, 0)
      assert.strictEqual(log.length % 2, 0)
      for (let at = 0; at < log.length; at += 2) {
        const type = log[at]!.split(" ")[1]
        assert.deepStrictEqual(log.slice(at, at + 2), [`first ${type}`, `added ${type}`], `inspection event ${at / 2}`)
      }
    })
  )

  it.effect("[C21] inspection functions that throw, fail or die are each reported, leave every actor active, and the functions after them still run", () => {
    const entries: Entries = []
    return withLogger(
      entries,
      Effect.gen(function* () {
        const thrown = new Error("thrown before an Effect")
        const inEffect = new Error("thrown inside Effect.sync")
        const died = new Error("died")
        const failed = new Error("failed")
        const actor = yield* createParent()
        const seen: Array<InspectionEvent> = []
        yield* actor.system.inspect((): Effect.Effect<void> => {
          throw thrown
        })
        yield* actor.system.inspect(() =>
          Effect.sync(() => {
            throw inEffect
          })
        )
        yield* actor.system.inspect(() => Effect.die(died))
        // A failure has no place in the function's type; a JavaScript caller can still give one
        yield* actor.system.inspect(() => Effect.fail(failed) as unknown as Effect.Effect<void>)
        yield* actor.system.inspect(record(seen))

        yield* actor.start
        yield* actor.send({ type: "LOAD" })
        assert.isTrue(yield* eventually(pongsReach(actor, 1)), "the actors still exchange events")
        yield* settle
        const child = yield* childOf(actor, "child")

        assert.strictEqual((yield* actor.getSnapshot).status, "active")
        assert.strictEqual((yield* child.getSnapshot).status, "active")
        assert.isAbove(seen.length, 0)
        const made = reports(entries)
        for (const error of [thrown, inEffect, died, failed]) {
          assert.strictEqual(
            made.filter((values) => values.includes(error)).length,
            seen.length,
            `${error.message}: one report per inspection event`
          )
        }
        assert.strictEqual(made.length, 4 * seen.length)
      })
    )
  })

  it.effect("[C21] after an inspection function failed, and with an observer object that only a JavaScript caller can give, later actors start and are inspected", () => {
    const entries: Entries = []
    return withLogger(
      entries,
      Effect.gen(function* () {
        const actor = yield* createParent()
        let nextCalls = 0
        // The observer-object form is not ported (SD-18, DEV-20): the gap row's "an observer
        // object breaks later actor starts"
        const observerObject = {
          next: () => {
            nextCalls++
          },
        } as unknown as (event: InspectionEvent) => Effect.Effect<void>
        yield* actor.system.inspect(observerObject)
        yield* actor.system.inspect(() => Effect.die(new Error("inspector failed")))
        const seen: Array<InspectionEvent> = []
        yield* actor.system.inspect(record(seen))

        yield* actor.start
        assert.strictEqual((yield* actor.getSnapshot).status, "active")
        assert.isAbove(reports(entries).length, 0, "the failures are reported")

        yield* actor.send({ type: "SPAWN" })
        const later = yield* childOf(actor, "later")
        yield* actor.send({ type: "LOAD_LATER" })
        assert.isTrue(yield* eventually(pongsReach(actor, 1)), "the later child starts and answers")
        yield* settle

        assert.strictEqual((yield* later.getSnapshot).status, "active")
        assert.include(announced(seen), "later")
        assert.strictEqual(relayed(seen, "PONG", later, actor).length, 1)
        assert.strictEqual(nextCalls, 0, "the port calls a function, never an observer's next")
        assert.strictEqual(reports(entries).length, 2 * seen.length, "both registrations are reported per event")
      })
    )
  })

  it.effect("[C21] the inspect option of a root actor registers its function with the system first: it sees every event that a function registered later sees, before it", () =>
    Effect.gen(function* () {
      const log: Array<readonly [string, InspectionEvent]> = []
      const actor = yield* createActor(parentMachine(), {
        id: "parent",
        inspect: (event) =>
          Effect.sync(() => {
            log.push(["option", event])
          }),
      })
      yield* actor.system.inspect((event) =>
        Effect.sync(() => {
          log.push(["system", event])
        })
      )

      yield* actor.start
      yield* actor.send({ type: "LOAD" })
      assert.isTrue(yield* eventually(pongsReach(actor, 1)))
      yield* settle
      const child = yield* childOf(actor, "child")

      const byOption = log.flatMap(([who, event]) => (who === "option" ? [event] : []))
      assert.includeMembers(announced(byOption), ["parent", "child"])
      assert.strictEqual(relayed(byOption, "PING", actor, child).length, 1)
      assert.strictEqual(relayed(byOption, "PONG", child, actor).length, 1)
      assert.isTrue(log.some(([who]) => who === "system"))
      log.forEach(([who, event], at) => {
        if (who === "system") {
          assert.isAbove(at, 0)
          assert.strictEqual(log[at - 1]![0], "option", `entry ${at}`)
          assert.strictEqual(log[at - 1]![1], event, `entry ${at}`)
        }
      })
    })
  )

  it.effect("[C21] the inspect option of an actor with a parent is ignored; the system's functions see that actor", () =>
    Effect.gen(function* () {
      const root = yield* createParent()
      yield* root.start
      const rootSeen: Array<InspectionEvent> = []
      yield* root.system.inspect(record(rootSeen))

      const own: Array<InspectionEvent> = []
      const extra = yield* createActor(childMachine, { id: "extra", parent: root.ref, inspect: record(own) })
      yield* extra.start
      yield* extra.send({ type: "PING" })
      assert.isTrue(yield* eventually(pongsReach(root, 1)), "the parent receives PONG")
      yield* settle

      assert.deepStrictEqual(own, [])
      assert.include(announced(rootSeen), "extra")
      assert.strictEqual(relayed(rootSeen, "PONG", extra, root).length, 1)
    })
  )
})
