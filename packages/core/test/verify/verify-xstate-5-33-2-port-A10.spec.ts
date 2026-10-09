/**
 * A10: stopChild stops the child by id or systemId.
 *
 * T2.44. Upstream `stopChild` in `src/actions/stopChild.ts` at xstate@5.33.2: `resolveStop`
 * resolves a string against `snapshot.children` (a function target receives the action
 * arguments) and removes the child from `snapshot.children`; `executeStop` unregisters the
 * child and its descendants from the system at once (so the same macrostep may register a new
 * actor under that systemId), stops a child that is not running yet at once (a child spawned
 * and stopped in one macrostep never starts), and defers the stop of a running child behind
 * the events already sent, so a `sendTo` in an exit action still reaches a child that the same
 * transition stops. An unknown id is a no-op. `actorScope.stopChild` (`createActor.ts`)
 * throws `Cannot stop child actor <child> of <actor> because it is not a child` for an actor
 * that is not a child, which sets the machine's status to `error` (SD-4).
 *
 * The port also resolves a string by systemId (D7, beyond XState: a ledger row). Stopping a
 * child closes its scope (D12), so its cleanup runs and its status becomes `stopped`.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import type { ActorRefBase } from "../../src/ActorRef.js"
import {
  type ActorType,
  assign,
  createActor,
  createMachine,
  fromCallback,
  isActor,
  sendTo,
  spawnChild,
  stopChild,
} from "../../src/index.js"
import { notAChild } from "./upstream-messages.js"

/** The child actor behind a reference; fails the test when the reference is not an actor. */
const asActor = (ref: ActorRefBase | undefined): ActorType.Any => {
  assert.isTrue(isActor(ref), "the reference is an actor")
  return ref as ActorType.Any
}

/** The status of the snapshot the reference reads now. */
const statusOf = (ref: ActorRefBase) => Effect.map(ref.getSnapshotUntyped, (snapshot) => snapshot.status)

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

/** Lets every other ready fiber take ten turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 10; turn++) {
    yield* Effect.yieldNow
  }
})

/** The message of an error value. */
const messageOf = (error: unknown): string => String((error as { readonly message?: unknown }).message)

/** A callback logic that records its start and its cleanup under `name`. */
const recorded = (name: string, log: Array<string>) =>
  fromCallback(() => {
    log.push(`${name} started`)
    return () => {
      log.push(`${name} cleanup`)
    }
  })

interface Refs {
  readonly ref?: ActorRefBase
}

type StopEvent =
  | { readonly type: "STOP_BOTH" }
  | { readonly type: "STOP_REF" }
  | { readonly type: "STOP_UNKNOWN" }
  | { readonly type: "STOP_STRANGER" }
  | { readonly type: "BRIEF" }
  | { readonly type: "REPLACE" }

describe("A10 stopChild stops the child by id or systemId", () => {
  it.effect("[A10] stopChild by id and stopChild by systemId stop each child: status stopped, cleanup run, gone from snapshot.children", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = createMachine<Refs, StopEvent>({
        id: "a10-both",
        context: {},
        entry: [
          spawnChild<Refs, StopEvent, ReturnType<typeof recorded>>(recorded("by-id", log), { id: "byId" }),
          spawnChild<Refs, StopEvent, ReturnType<typeof recorded>>(recorded("by-system-id", log), { id: "other", systemId: "sys" }),
        ],
        on: { STOP_BOTH: { actions: [stopChild<Refs, StopEvent>("byId"), stopChild<Refs, StopEvent>("sys")] } },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      const before = (yield* actor.getSnapshot).children
      const byId = before["byId"]
      const other = before["other"]
      assert.isDefined(byId)
      assert.isDefined(other)
      assert.deepStrictEqual(log, ["by-id started", "by-system-id started"])

      yield* actor.send({ type: "STOP_BOTH" })

      assert.deepStrictEqual(Object.keys((yield* actor.getSnapshot).children), [])
      assert.isTrue(Option.isNone(yield* actor.system.get("sys")))
      assert.isTrue(yield* eventually(Effect.map(statusOf(byId!), (status) => status === "stopped")))
      assert.isTrue(yield* eventually(Effect.map(statusOf(other!), (status) => status === "stopped")))
      yield* settle
      assert.deepStrictEqual([...log].sort(), ["by-id cleanup", "by-id started", "by-system-id cleanup", "by-system-id started"])
      assert.strictEqual((yield* actor.getSnapshot).status, "active")
    })
  )

  it.effect("[A10] stopChild with a function target stops the child it returns", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = createMachine<Refs, StopEvent>({
        id: "a10-ref",
        context: {},
        entry: assign<Refs, StopEvent>({ ref: ({ spawn }) => spawn(recorded("child", log), { id: "child" }) }),
        on: { STOP_REF: { actions: stopChild<Refs, StopEvent>(({ context }) => context.ref ?? "none") } },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      const ref = (yield* actor.getSnapshot).context.ref
      assert.isDefined(ref)

      yield* actor.send({ type: "STOP_REF" })

      assert.deepStrictEqual(Object.keys((yield* actor.getSnapshot).children), [])
      assert.isTrue(yield* eventually(Effect.map(statusOf(ref!), (status) => status === "stopped")))
      yield* settle
      assert.deepStrictEqual(log, ["child started", "child cleanup"])
    })
  )

  it.effect("[A10] stopChild with an unknown id changes nothing", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = createMachine<Refs, StopEvent>({
        id: "a10-unknown",
        context: {},
        entry: spawnChild<Refs, StopEvent, ReturnType<typeof recorded>>(recorded("kept", log), { id: "kept" }),
        on: { STOP_UNKNOWN: { actions: stopChild<Refs, StopEvent>("unknown") } },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      const before = yield* actor.getSnapshot

      yield* actor.send({ type: "STOP_UNKNOWN" })
      yield* settle

      const after = yield* actor.getSnapshot
      assert.strictEqual(after.status, "active")
      assert.deepStrictEqual(after.value, before.value)
      assert.deepStrictEqual(after.context, before.context)
      assert.deepStrictEqual(Object.keys(after.children), ["kept"])
      assert.strictEqual(after.children["kept"], before.children["kept"])
      assert.strictEqual(yield* statusOf(after.children["kept"]!), "active")
      assert.deepStrictEqual(log, ["kept started"])
    })
  )

  it.effect("[A10] stopChild of an actor that is not a child sets status error with the recorded message", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const stranger = yield* createActor(recorded("stranger", log), { id: "stranger" })
      yield* stranger.start
      const machine = createMachine<Refs, StopEvent>({
        id: "a10-stranger",
        context: {},
        on: { STOP_STRANGER: { actions: stopChild<Refs, StopEvent>(() => stranger) } },
      })
      const actor = yield* createActor(machine, { id: "a10-parent" })
      yield* actor.start

      yield* actor.send({ type: "STOP_STRANGER" })

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "error")
      assert.strictEqual(messageOf(Option.getOrUndefined(snapshot.error)), notAChild("stranger", "a10-parent"))
      // The other actor keeps running
      yield* settle
      assert.strictEqual(yield* statusOf(stranger), "active")
      assert.deepStrictEqual(log, ["stranger started"])
    })
  )

  it.effect("[A10] a child spawned and stopped in the same macrostep never starts", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = createMachine<Refs, StopEvent>({
        id: "a10-brief",
        context: {},
        on: {
          BRIEF: {
            actions: [
              assign<Refs, StopEvent>({ ref: ({ spawn }) => spawn(recorded("brief", log), { id: "brief" }) }),
              stopChild<Refs, StopEvent>("brief"),
            ],
          },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* actor.send({ type: "BRIEF" })
      yield* settle

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "active")
      assert.deepStrictEqual(Object.keys(snapshot.children), [])
      assert.isDefined(snapshot.context.ref)
      // Its logic never ran: no start, so no cleanup either
      assert.deepStrictEqual(log, [])
      // A later start does nothing for a stopped child
      yield* asActor(snapshot.context.ref).start
      yield* settle
      assert.deepStrictEqual(log, [])
    })
  )

  it.effect("[A10] a sendTo in an exit action reaches a child that the same transition stops, before the child stops", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const listener = fromCallback(({ receive }) => {
        receive((event) => {
          log.push(`received ${event.type}`)
        })
        return () => {
          log.push("cleanup")
        }
      })
      type LeaveEvent = { readonly type: "LEAVE" }
      const machine = createMachine<Refs, LeaveEvent>({
        id: "a10-exit",
        initial: "a",
        context: {},
        states: {
          a: {
            entry: assign<Refs, LeaveEvent>({ ref: ({ spawn }) => spawn(listener, { id: "listener" }) }),
            exit: sendTo<Refs, LeaveEvent>(({ context }) => context.ref ?? "none", { type: "BYE" }),
            on: { LEAVE: { target: "b", actions: stopChild<Refs, LeaveEvent>("listener") } },
          },
          b: {},
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      const ref = (yield* actor.getSnapshot).context.ref
      assert.isDefined(ref)

      yield* actor.send({ type: "LEAVE" })

      assert.isTrue(yield* eventually(Effect.map(statusOf(ref!), (status) => status === "stopped")))
      yield* settle
      assert.deepStrictEqual(log, ["received BYE", "cleanup"])
      assert.deepStrictEqual(Object.keys((yield* actor.getSnapshot).children), [])
    })
  )

  it.effect("[A10] a running child stopped and a new child spawned in one macrostep: the old child's cleanup runs before the new child starts", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      type RestartEvent = { readonly type: "RESTART" }
      const machine = createMachine<Refs, RestartEvent>({
        id: "a10-restart",
        context: {},
        entry: assign<Refs, RestartEvent>({ ref: ({ spawn }) => spawn(recorded("first", log), { id: "first" }) }),
        on: {
          RESTART: {
            actions: [
              stopChild<Refs, RestartEvent>(({ context }) => context.ref ?? "none"),
              assign<Refs, RestartEvent>({ ref: ({ spawn }) => spawn(recorded("second", log), { id: "second" }) }),
            ],
          },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* actor.send({ type: "RESTART" })
      yield* settle

      // Upstream's deferred stop of the idle child runs at once, before the deferred start
      assert.deepStrictEqual(log, ["first started", "first cleanup", "second started"])
      assert.deepStrictEqual(Object.keys((yield* actor.getSnapshot).children), ["second"])
    })
  )

  it.effect("[A10] stopChild gives the systemId up at once, so the same action list can spawn a new child under it", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = createMachine<Refs, StopEvent>({
        id: "a10-replace",
        context: {},
        entry: spawnChild<Refs, StopEvent, ReturnType<typeof recorded>>(recorded("old", log), { id: "old", systemId: "slot" }),
        on: {
          REPLACE: {
            actions: [
              stopChild<Refs, StopEvent>("slot"),
              spawnChild<Refs, StopEvent, ReturnType<typeof recorded>>(recorded("new", log), { id: "new", systemId: "slot" }),
            ],
          },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      const old = (yield* actor.getSnapshot).children["old"]

      yield* actor.send({ type: "REPLACE" })

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "active")
      assert.deepStrictEqual(Object.keys(snapshot.children), ["new"])
      const found = yield* actor.system.get("slot")
      assert.isTrue(Option.isSome(found) && found.value === snapshot.children["new"])
      assert.isTrue(yield* eventually(Effect.map(statusOf(old!), (status) => status === "stopped")))
    })
  )
})
