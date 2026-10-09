/**
 * A5: sendTo reaches a child by id and by systemId.
 *
 * T2.45. Upstream `sendTo` in `src/actions/send.ts` at xstate@5.33.2: `resolveSendTo`
 * resolves the target while the transition runs. A function target and an event function
 * receive the action arguments; `#_parent` is the parent, `#_internal` the machine itself,
 * `#_<id>` the child with that id, and any other string a child id (`snapshot.children`, so a
 * child spawned earlier in the same action list counts). A string that names no actor, and
 * `sendParent` without a parent, throw `Unable to send event to actor '<target>' from machine
 * '<id>'.`; a string event throws `Only event objects may be used with sendTo; ...`. Both
 * throws set the machine's status to `error` (SD-3, SD-4). A function that gives no target
 * sends to the machine itself. `executeSendTo` sends after the macrostep through
 * `system._relay`, so the `@xstate.event` inspection event names the sender, and an event of
 * type `xstate.error` arrives as `{ type: 'xstate.error.actor.<sender id>', error: data,
 * actorId }`. `forwardTo` sends the event being handled; a target that resolves to nothing
 * throws `Attempted to forward event to undefined actor. ...`.
 *
 * The port also resolves a string by systemId (D7, beyond XState: a ledger row) and keeps
 * its `#_self` target (`sendSelf`). `sourceRef` is an `Option` (D8). Phase-2 children are
 * spawned, not invoked (SD-15), so the parent takes the child's error event with an `on`
 * handler for `xstate.error.actor.<id>`, where upstream's test uses an invoke `onError`.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { TestClock } from "effect/testing"
import type { ActorRefBase } from "../../src/ActorRef.js"
import {
  type ActorType,
  assign,
  createActor,
  createMachine,
  type EventObject,
  forwardTo,
  fromCallback,
  type InspectionEvent,
  sendParent,
  sendSelf,
  sendTo,
  spawnChild,
} from "../../src/index.js"
import { forwardToUndefinedActor, onlyEventObjectsSendTo, unableToSend } from "./upstream-messages.js"

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

/** Yields until `log` holds `entries` in that order, at most 200 turns; gives whether it does. */
const logReaches = (log: ReadonlyArray<string>, entries: ReadonlyArray<string>) =>
  eventually(Effect.sync(() => log.length >= entries.length && entries.every((entry, i) => log[i] === entry)))

/** Lets every other ready fiber take ten turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 10; turn++) {
    yield* Effect.yieldNow
  }
})

/** The message of an error value. */
const messageOf = (error: unknown): string => String((error as { readonly message?: unknown }).message)

/** A callback logic that records each event it receives as `<name> <type>`. */
const recorder = (name: string, log: Array<string>) =>
  fromCallback(({ receive }) => {
    receive((event) => {
      log.push(`${name} ${event.type}`)
    })
  })

/** The status and the error message of the actor's snapshot now (`"(no error)"` without one). */
const errorOf = (actor: Pick<ActorType.Any, "getSnapshot">) =>
  Effect.map(actor.getSnapshot, (snapshot) => ({
    status: snapshot.status,
    message: Option.match(snapshot.error, { onNone: () => "(no error)", onSome: messageOf }),
  }))

type GoEvent = { readonly type: "GO" }

describe("A5 sendTo reaches a child by id and by systemId", () => {
  it.effect("[A5] sendTo by child id reaches the child under that id, and sendTo by systemId reaches the actor registered under it", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = createMachine<object, GoEvent>({
        id: "a5-names",
        context: {},
        entry: [
          spawnChild<object, GoEvent, ReturnType<typeof recorder>>(recorder("child", log), { id: "child" }),
          spawnChild<object, GoEvent, ReturnType<typeof recorder>>(recorder("logger", log), { id: "audit", systemId: "logger" }),
        ],
        on: {
          GO: {
            actions: [
              sendTo<object, GoEvent>("child", { type: "TO_CHILD" }),
              sendTo<object, GoEvent>("logger", { type: "TO_LOGGER" }),
            ],
          },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* actor.send({ type: "GO" })

      assert.isTrue(yield* logReaches(log, ["child TO_CHILD", "logger TO_LOGGER"]))
      yield* settle
      assert.deepStrictEqual(log, ["child TO_CHILD", "logger TO_LOGGER"])
      assert.strictEqual((yield* actor.getSnapshot).status, "active")
    })
  )

  it.effect("[A5] sendParent and sendTo('#_parent') from a spawned child reach the parent", () =>
    Effect.gen(function* () {
      interface Heard {
        readonly heard: ReadonlyArray<string>
      }
      type HeardEvent = { readonly type: "HELLO" } | { readonly type: "AGAIN" }
      const child = createMachine<object, EventObject>({
        id: "a5-child",
        context: {},
        entry: [
          sendParent<object, EventObject>({ type: "HELLO" }),
          sendTo<object, EventObject>("#_parent", { type: "AGAIN" }),
        ],
      })
      const machine = createMachine<Heard, HeardEvent>({
        id: "a5-parent",
        context: { heard: [] },
        entry: spawnChild<Heard, HeardEvent, typeof child>(child, { id: "child" }),
        on: {
          HELLO: { actions: assign<Heard, HeardEvent>(({ context }) => ({ heard: [...context.heard, "HELLO"] })) },
          AGAIN: { actions: assign<Heard, HeardEvent>(({ context }) => ({ heard: [...context.heard, "AGAIN"] })) },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      assert.isTrue(yield* eventually(Effect.map(actor.getSnapshot, (snapshot) => snapshot.context.heard.length >= 2)))
      assert.deepStrictEqual((yield* actor.getSnapshot).context.heard, ["HELLO", "AGAIN"])
    })
  )

  it.effect("[A5] #_internal, #_self and a function target that gives undefined send to the machine itself", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      type SelfEvent =
        | { readonly type: "VIA_INTERNAL" }
        | { readonly type: "VIA_SELF" }
        | { readonly type: "VIA_UNDEFINED" }
        | { readonly type: "HIT"; readonly via: string }
      const machine = createMachine<object, SelfEvent>({
        id: "a5-self",
        context: {},
        on: {
          VIA_INTERNAL: { actions: sendTo<object, SelfEvent, SelfEvent>("#_internal", { type: "HIT", via: "#_internal" }) },
          VIA_SELF: { actions: sendSelf<object, SelfEvent, SelfEvent>({ type: "HIT", via: "#_self" }) },
          VIA_UNDEFINED: { actions: sendTo<object, SelfEvent, SelfEvent>(() => undefined, { type: "HIT", via: "undefined" }) },
          HIT: {
            actions: ({ event }) => {
              if (event.type === "HIT") {
                log.push(`self ${event.via}`)
              }
            },
          },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* actor.send({ type: "VIA_INTERNAL" })
      assert.isTrue(yield* logReaches(log, ["self #_internal"]))
      yield* actor.send({ type: "VIA_SELF" })
      assert.isTrue(yield* logReaches(log, ["self #_internal", "self #_self"]))
      yield* actor.send({ type: "VIA_UNDEFINED" })
      assert.isTrue(yield* logReaches(log, ["self #_internal", "self #_self", "self undefined"]))
      assert.strictEqual((yield* actor.getSnapshot).status, "active")
    })
  )

  it.effect("[A5] #_<childId>, a function that gives a child id, a function that gives a ref and a ref reach their actor", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const stranger = yield* createActor(recorder("stranger", log))
      yield* stranger.start
      interface Kid {
        readonly kid?: ActorRefBase
      }
      type KidEvent =
        | { readonly type: "VIA_HASH" }
        | { readonly type: "VIA_NAME_FUNCTION" }
        | { readonly type: "VIA_REF_FUNCTION" }
        | { readonly type: "VIA_REF" }
      const machine = createMachine<Kid, KidEvent>({
        id: "a5-targets",
        context: {},
        entry: assign<Kid, KidEvent>({ kid: ({ spawn }) => spawn(recorder("kid", log), { id: "kid" }) }),
        on: {
          VIA_HASH: { actions: sendTo<Kid, KidEvent>("#_kid", { type: "HASH" }) },
          VIA_NAME_FUNCTION: { actions: sendTo<Kid, KidEvent>(() => "kid", { type: "NAME_FUNCTION" }) },
          VIA_REF_FUNCTION: { actions: sendTo<Kid, KidEvent>(({ context }) => context.kid, { type: "REF_FUNCTION" }) },
          VIA_REF: { actions: sendTo<Kid, KidEvent>(stranger, { type: "REF" }) },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* actor.send({ type: "VIA_HASH" })
      assert.isTrue(yield* logReaches(log, ["kid HASH"]))
      yield* actor.send({ type: "VIA_NAME_FUNCTION" })
      assert.isTrue(yield* logReaches(log, ["kid HASH", "kid NAME_FUNCTION"]))
      yield* actor.send({ type: "VIA_REF_FUNCTION" })
      assert.isTrue(yield* logReaches(log, ["kid HASH", "kid NAME_FUNCTION", "kid REF_FUNCTION"]))
      yield* actor.send({ type: "VIA_REF" })
      assert.isTrue(yield* logReaches(log, ["kid HASH", "kid NAME_FUNCTION", "kid REF_FUNCTION", "stranger REF"]))
      assert.strictEqual((yield* actor.getSnapshot).status, "active")
    })
  )

  it.effect("[A5] the target and event functions receive the action arguments and the params of the use", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      interface Named {
        readonly name: string
      }
      const machine = createMachine<Named, GoEvent>(
        {
          id: "a5-params",
          context: { name: "kid" },
          entry: spawnChild<Named, GoEvent, ReturnType<typeof recorder>>(recorder("kid", log), { id: "kid" }),
          on: { GO: { actions: { type: "tell", params: { suffix: "!" } } } },
        },
        {
          actions: {
            tell: sendTo<Named, GoEvent>(
              ({ context }) => context.name,
              ({ event }, params) => ({ type: `${event.type}${(params as { readonly suffix: string }).suffix}` })
            ),
          },
        }
      )
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* actor.send({ type: "GO" })

      assert.isTrue(yield* logReaches(log, ["kid GO!"]))
    })
  )

  it.effect("[A5] sendTo with an unknown name sets status error with the recorded message", () =>
    Effect.gen(function* () {
      const machine = createMachine<object, GoEvent>({
        id: "a5-unknown",
        context: {},
        on: { GO: { actions: sendTo<object, GoEvent>("nobody", { type: "PING" }) } },
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* actor.send({ type: "GO" })

      assert.deepStrictEqual(yield* errorOf(actor), { status: "error", message: unableToSend("nobody", "a5-unknown") })
    })
  )

  it.effect("[A5] sendParent without a parent sets status error with the recorded message", () =>
    Effect.gen(function* () {
      const machine = createMachine<object, GoEvent>({
        id: "a5-orphan",
        context: {},
        on: { GO: { actions: sendParent<object, GoEvent>({ type: "PING" }) } },
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* actor.send({ type: "GO" })

      assert.deepStrictEqual(yield* errorOf(actor), { status: "error", message: unableToSend("#_parent", "a5-orphan") })
    })
  )

  it.effect("[A5] sendTo with a string event sets status error with the recorded message", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = createMachine<object, GoEvent>({
        id: "a5-string-event",
        context: {},
        entry: spawnChild<object, GoEvent, ReturnType<typeof recorder>>(recorder("child", log), { id: "child" }),
        // The type system rejects a string event; upstream's test reaches it the same way
        on: { GO: { actions: sendTo<object, GoEvent>("child", "a string" as unknown as EventObject) } },
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* actor.send({ type: "GO" })
      yield* settle

      assert.deepStrictEqual(yield* errorOf(actor), { status: "error", message: onlyEventObjectsSendTo("a string") })
      assert.deepStrictEqual(log, [])
    })
  )

  it.effect("[A5] a sendTo after a spawnChild with a dynamic id in the same action list reaches the new child", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      interface ChildId {
        readonly childId: string
      }
      const machine = createMachine<ChildId, GoEvent>({
        id: "a5-same-list",
        context: { childId: "myChild" },
        on: {
          GO: {
            actions: [
              spawnChild<ChildId, GoEvent, ReturnType<typeof recorder>>(recorder("myChild", log), {
                id: ({ context }) => context.childId,
              }),
              sendTo<ChildId, GoEvent>("myChild", { type: "FOO" }),
            ],
          },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* actor.send({ type: "GO" })

      assert.isTrue(yield* logReaches(log, ["myChild FOO"]))
      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "active")
      assert.deepStrictEqual(Object.keys(snapshot.children), ["myChild"])
    })
  )

  it.effect("[A5] a delayed sendTo by child id reaches the child after the delay", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = createMachine<object, GoEvent>({
        id: "a5-delayed",
        context: {},
        entry: spawnChild<object, GoEvent, ReturnType<typeof recorder>>(recorder("child", log), { id: "child" }),
        on: { GO: { actions: sendTo<object, GoEvent>("child", { type: "LATER" }, { delay: 100 }) } },
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* actor.send({ type: "GO" })
      yield* settle
      assert.deepStrictEqual(log, [])

      yield* TestClock.adjust("100 millis")

      assert.isTrue(yield* logReaches(log, ["child LATER"]))
    })
  )

  it.effect("[A5] an event of type xstate.error from a child reaches the parent as xstate.error.actor.<childId> with its data as the error, and the parent's handler takes it", () =>
    Effect.gen(function* () {
      const boom = new Error("boom")
      type ChildErrorEvent = { readonly type: "xstate.error.actor.failing"; readonly error: unknown; readonly actorId: string }
      interface Received {
        readonly received: ReadonlyArray<ChildErrorEvent>
      }
      const child = createMachine<object, EventObject>({
        id: "a5-failing",
        context: {},
        entry: sendParent<object, EventObject, { readonly type: "xstate.error"; readonly data: Error }>({
          type: "xstate.error",
          data: boom,
        }),
      })
      const machine = createMachine<Received, ChildErrorEvent>({
        id: "a5-error-parent",
        context: { received: [] },
        entry: spawnChild<Received, ChildErrorEvent, typeof child>(child, { id: "failing" }),
        on: {
          "xstate.error.actor.failing": {
            actions: assign<Received, ChildErrorEvent>(({ context, event }) => ({ received: [...context.received, event] })),
          },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      assert.isTrue(yield* eventually(Effect.map(actor.getSnapshot, (snapshot) => snapshot.context.received.length > 0)))
      const snapshot = yield* actor.getSnapshot
      assert.deepStrictEqual(snapshot.context.received, [{ type: "xstate.error.actor.failing", error: boom, actorId: "failing" }])
      assert.strictEqual(snapshot.context.received[0]?.error, boom)
      assert.strictEqual(snapshot.status, "active")
    })
  )

  it.effect("[A5] a sendTo goes through the system relay: its @xstate.event names the sender as sourceRef", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const relayed: Array<Extract<InspectionEvent, { readonly type: "@xstate.event" }>> = []
      const machine = createMachine<object, GoEvent>({
        id: "a5-relay",
        context: {},
        entry: spawnChild<object, GoEvent, ReturnType<typeof recorder>>(recorder("child", log), { id: "child" }),
        on: { GO: { actions: sendTo<object, GoEvent>("child", { type: "PING" }) } },
      })
      const actor = yield* createActor(machine)
      yield* actor.system.inspect((event) =>
        Effect.sync(() => {
          if (event.type === "@xstate.event" && event.event.type === "PING") {
            relayed.push(event)
          }
        })
      )
      yield* actor.start
      const child = (yield* actor.getSnapshot).children["child"]

      yield* actor.send({ type: "GO" })

      assert.isTrue(yield* logReaches(log, ["child PING"]))
      const fromParent = relayed.filter((event) => Option.exists(event.sourceRef, (source) => source === actor))
      assert.strictEqual(fromParent.length, 1)
      assert.strictEqual(fromParent[0]!.actorRef, child)
    })
  )

  it.effect("[A5] forwardTo sends the event the machine handles to the target", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      type ForwardEvent = { readonly type: "FORWARD"; readonly value: number }
      const machine = createMachine<object, ForwardEvent>({
        id: "a5-forward",
        context: {},
        entry: spawnChild<object, ForwardEvent, ReturnType<typeof recorder>>(recorder("child", log), { id: "child" }),
        on: { FORWARD: { actions: forwardTo<object, ForwardEvent>("child") } },
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* actor.send({ type: "FORWARD", value: 42 })

      assert.isTrue(yield* logReaches(log, ["child FORWARD"]))
      assert.strictEqual((yield* actor.getSnapshot).status, "active")
    })
  )

  it.effect("[A5] forwardTo with a target that resolves to nothing sets status error with the recorded message", () =>
    Effect.gen(function* () {
      const machine = createMachine<object, GoEvent>({
        id: "a5-forward-nothing",
        context: {},
        on: { GO: { actions: forwardTo<object, GoEvent>(() => undefined) } },
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* actor.send({ type: "GO" })

      assert.deepStrictEqual(yield* errorOf(actor), { status: "error", message: forwardToUndefinedActor })
    })
  )
})
