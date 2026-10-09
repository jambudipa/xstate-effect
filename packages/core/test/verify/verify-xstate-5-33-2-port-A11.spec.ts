/**
 * A11: enqueueActions passes every enqueued action to the engine.
 *
 * T4.15. Upstream `src/actions/enqueueActions.ts` at xstate@5.33.2: `resolveEnqueueActions`
 * calls `collect` once, while the engine resolves the action, with `{ context, event,
 * enqueue, check, self, system }` and the params of the use, and returns the collected
 * actions (`[snapshot, undefined, actions]`). `resolveAndExecuteActionsWithContext`
 * (`src/stateUtils.ts`) then resolves those actions in place, in order, with the snapshot of
 * that point of the list, as if they stood in the list themselves: a name and `{ type,
 * params }` read the machine's implementations, an inline function is a custom action, and a
 * built-in action (raise, sendTo, sendParent, emit, spawnChild, stopChild, cancel, assign,
 * log, a nested enqueueActions) does what it does anywhere else.
 *
 * `check(guard)` is `evaluateGuard(guard, snapshot.context, event, snapshot)`: synchronous,
 * against the snapshot from before any enqueued action ran, with the machine's guard
 * implementations; a name without one throws `Guard '<name>' is not implemented.'.`, which
 * the actor takes as its error (S16; no transition wrapper). Upstream has no `enqueue.log`
 * (SD-16): `enqueue(log(...))` is the way.
 *
 * `resolveSendTo` (`src/actions/send.ts`) resolves the event, then the delay (a name through
 * the machine's `delays`), then the target, so a named delay function runs before a target
 * function. The SCXML converter maps `<if>` to an `enqueueActions` whose branches `check`
 * the `cond`, so a `<raise>` inside it reaches the machine (W3C test147).
 *
 * The type-level cases are the file's own type check (`tsc -p tsconfig.test.green.json`):
 * `self` is a typed reference and the enqueuer's helpers take the XState options.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Logger, Option } from "effect"
import { TestClock } from "effect/testing"
import type { ActorRefBase } from "../../src/ActorRef.js"
import {
  type AnyActorLogic,
  type EventObject,
  and,
  assign,
  createActor,
  createMachine,
  enqueueActions,
  fromCallback,
  log,
  not,
  or,
  raise,
  sendTo,
  stateIn,
} from "../../src/index.js"
import { toMachine } from "../upstream/support/scxml.js"
import { guardNotImplemented } from "./upstream-messages.js"

/** Lets every other ready fiber take a bounded number of turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 25; turn++) {
    yield* Effect.yieldNow
  }
})

/** Moves the test clock by `millis` and lets each delivery it caused run. */
const advance = (millis: number) => Effect.andThen(TestClock.adjust(`${millis} millis`), settle)

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

/** A callback logic that records the type of each event it receives, and its cleanup. */
const recorder = (log: Array<string>) =>
  fromCallback(({ receive }) => {
    receive((event) => {
      log.push(event.type)
    })
    return () => {
      log.push("cleanup")
    }
  })

/** The status of the snapshot the reference reads now. */
const statusOf = (ref: ActorRefBase) => Effect.map(ref.getSnapshotUntyped, (snapshot) => snapshot.status)

/** The error the snapshot holds; fails the test when it holds none. */
const errorOf = (snapshot: { readonly error: Option.Option<unknown> }): Error => {
  assert.isTrue(Option.isSome(snapshot.error), "the snapshot holds an error")
  const error = Option.getOrUndefined(snapshot.error)
  assert.instanceOf(error, Error)
  return error as Error
}

/** Runs `program` with a logger that keeps the message of every entry. */
const withMessages = <A, E, R>(messages: Array<ReadonlyArray<unknown>>, program: Effect.Effect<A, E, R>) =>
  program.pipe(
    Effect.provide(
      Logger.layer([
        Logger.make((options) => {
          messages.push(Array.isArray(options.message) ? options.message : [options.message])
        }),
      ])
    )
  )

interface Ctx {
  readonly count: number
  readonly n: number
}

type Ev =
  | { readonly type: "GO" }
  | { readonly type: "RAISED"; readonly from: string }
  | { readonly type: "PING" }
  | { readonly type: "STOP" }
  | { readonly type: "CANCEL" }
  | { readonly type: "LATE" }
  | { readonly type: "FROM_CHILD" }

describe("A11 enqueueActions passes every enqueued action to the engine", () => {
  it.effect("[A11] a name, { type, params }, an inline function and built-in action objects run through the engine, in the order enqueued", () =>
    Effect.gen(function* () {
      const calls: Array<string> = []
      const machine = createMachine<Ctx, Ev>(
        {
          id: "a11-forms",
          context: { count: 0, n: 0 },
          on: {
            GO: {
              actions: enqueueActions<Ctx, Ev>(({ enqueue }) => {
                enqueue("named")
                enqueue({ type: "withParams", params: { by: 2 } })
                enqueue(({ context }) => {
                  calls.push(`inline ${context.count}`)
                })
                enqueue(assign<Ctx, Ev>({ count: 5 }))
                enqueue({ type: "withParams", params: ({ context }) => ({ by: context.count }) })
              }),
            },
          },
        },
        {
          actions: {
            named: ({ context }) => {
              calls.push(`named ${context.count}`)
            },
            withParams: ({ context }, params: { readonly by: number }) => {
              calls.push(`params ${params.by} at ${context.count}`)
            },
          },
        }
      )
      const actor = yield* createActor(machine)
      yield* actor.start
      yield* actor.send({ type: "GO" })

      assert.deepStrictEqual(calls, ["named 0", "params 2 at 0", "inline 0", "params 5 at 5"])
      assert.strictEqual((yield* actor.getSnapshot).context.count, 5)
    })
  )

  it.effect("[A11] enqueue.raise and an enqueued raise() join the internal queue in order, before the next external event", () =>
    Effect.gen(function* () {
      const handled: Array<string> = []
      const machine = createMachine<Ctx, Ev>({
        id: "a11-raise",
        context: { count: 0, n: 0 },
        on: {
          GO: {
            actions: enqueueActions<Ctx, Ev>(({ enqueue }) => {
              enqueue.raise({ type: "RAISED", from: "helper" })
              enqueue(raise<Ctx, Ev>({ type: "RAISED", from: "object" }))
            }),
          },
          RAISED: {
            actions: ({ event }) => {
              handled.push(event.type === "RAISED" ? event.from : event.type)
            },
          },
          PING: {
            actions: () => {
              handled.push("PING")
            },
          },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      yield* actor.send({ type: "GO" })
      yield* actor.send({ type: "PING" })

      assert.deepStrictEqual(handled, ["helper", "object", "PING"])
    })
  )

  it.effect("[A11] enqueue.raise and enqueue.sendTo take a delay name of the machine's delays, and enqueue.cancel cancels by id", () =>
    Effect.gen(function* () {
      const handled: Array<string> = []
      const machine = createMachine<Ctx, Ev>(
        {
          id: "a11-delays",
          context: { count: 0, n: 0 },
          entry: enqueueActions<Ctx, Ev>(({ enqueue }) => {
            enqueue.raise({ type: "RAISED", from: "raise" }, { delay: "soon", id: "r" })
            enqueue.sendTo(({ self }) => self, { type: "PING" }, { delay: "later", id: "s" })
            enqueue.raise({ type: "LATE" }, { delay: 300, id: "late" })
          }),
          on: {
            RAISED: { actions: ({ event }) => void handled.push(event.type === "RAISED" ? event.from : "?") },
            PING: { actions: () => void handled.push("PING") },
            LATE: { actions: () => void handled.push("LATE") },
            CANCEL: { actions: enqueueActions<Ctx, Ev>(({ enqueue }) => enqueue.cancel("late")) },
          },
        },
        { delays: { soon: 100, later: ({ context }) => 200 + context.count } }
      )
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* advance(99)
      assert.deepStrictEqual(handled, [])
      yield* advance(1)
      assert.deepStrictEqual(handled, ["raise"])
      yield* advance(99)
      assert.deepStrictEqual(handled, ["raise"])
      yield* advance(1)
      assert.deepStrictEqual(handled, ["raise", "PING"])

      yield* actor.send({ type: "CANCEL" })
      yield* advance(200)
      assert.deepStrictEqual(handled, ["raise", "PING"], "the cancelled raise never arrives")
    })
  )

  it.effect("[A11] enqueue.spawnChild, enqueue.sendTo and enqueue.stopChild reach the child: spawned, sent to by id in the same list, stopped", () =>
    Effect.gen(function* () {
      const childLog: Array<string> = []
      const machine = createMachine<Ctx, Ev>(
        {
          id: "a11-children",
          context: { count: 0, n: 0 },
          entry: enqueueActions<Ctx, Ev>(({ enqueue }) => {
            enqueue.spawnChild<AnyActorLogic>("worker", { id: "w" })
            enqueue.sendTo("w", { type: "PING" })
          }),
          on: {
            STOP: { actions: enqueueActions<Ctx, Ev>(({ enqueue }) => enqueue.stopChild("w")) },
          },
        },
        { actors: { worker: recorder(childLog) } }
      )
      const actor = yield* createActor(machine)
      yield* actor.start

      const child = (yield* actor.getSnapshot).children["w"]
      assert.isDefined(child)
      assert.isTrue(yield* eventually(Effect.sync(() => childLog.includes("PING"))))
      assert.deepStrictEqual(childLog, ["PING"])

      yield* actor.send({ type: "STOP" })
      assert.isUndefined((yield* actor.getSnapshot).children["w"])
      assert.isTrue(yield* eventually(Effect.map(statusOf(child!), (status) => status === "stopped")))
      assert.deepStrictEqual(childLog, ["PING", "cleanup"])
    })
  )

  it.effect("[A11] enqueue.sendParent reaches the parent", () =>
    Effect.gen(function* () {
      const child = createMachine<Ctx, Ev>({
        id: "a11-child",
        context: { count: 0, n: 0 },
        entry: enqueueActions<Ctx, Ev>(({ enqueue }) => {
          enqueue.sendParent({ type: "FROM_CHILD" })
        }),
      })
      const parent = createMachine<Ctx, Ev>(
        {
          id: "a11-parent",
          context: { count: 0, n: 0 },
          entry: enqueueActions<Ctx, Ev>(({ enqueue }) => {
            enqueue.spawnChild<AnyActorLogic>("child", { id: "c" })
          }),
          on: { FROM_CHILD: { actions: assign<Ctx, Ev>({ count: 1 }) } },
        },
        { actors: { child } }
      )
      const actor = yield* createActor(parent)
      yield* actor.start

      assert.isTrue(yield* eventually(Effect.map(actor.getSnapshot, (snapshot) => snapshot.context.count === 1)))
    })
  )

  it.effect("[A11] enqueue.emit reaches an actor.on listener after the transition commits", () =>
    Effect.gen(function* () {
      const heard: Array<string> = []
      const machine = createMachine<Ctx, Ev>({
        id: "a11-emit",
        context: { count: 0, n: 0 },
        on: {
          GO: {
            actions: enqueueActions<Ctx, Ev>(({ enqueue }) => {
              enqueue.emit({ type: "emitted" })
              enqueue.assign({ count: 1 })
              enqueue.emit(({ context }) => ({ type: "computed", count: context.count }))
            }),
          },
        },
      })
      const actor = yield* createActor(machine)
      const listener = (event: EventObject) =>
        Effect.map(actor.getSnapshot, (snapshot) => {
          heard.push(`${event.type} ${String((event as { readonly count?: number }).count)} ${snapshot.context.count}`)
        })
      yield* actor.on("emitted", listener)
      yield* actor.on("computed", listener)
      yield* actor.start
      yield* actor.send({ type: "GO" })

      assert.deepStrictEqual(heard, ["emitted undefined 1", "computed 1 1"])
    })
  )

  it.effect("[A11] enqueue.assign takes an object with property assigners and an assigner of (args, params), with undefined params", () =>
    Effect.gen(function* () {
      const seen: Array<unknown> = []
      const machine = createMachine<Ctx, Ev>({
        id: "a11-assign",
        context: { count: 1, n: 0 },
        on: {
          GO: {
            actions: enqueueActions<Ctx, Ev>(({ enqueue }) => {
              enqueue.assign({
                count: ({ context }, params) => {
                  seen.push(params)
                  return context.count + 10
                },
              })
              enqueue.assign(({ context }, params) => {
                seen.push(params)
                return { n: context.count * 2 }
              })
            }),
          },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      yield* actor.send({ type: "GO" })

      assert.deepStrictEqual((yield* actor.getSnapshot).context, { count: 11, n: 22 })
      assert.deepStrictEqual(seen, [undefined, undefined])
    })
  )

  it.effect("[A11] check evaluates a name, { type, params }, combinators of names and stateIn against the machine's guard implementations", () =>
    Effect.gen(function* () {
      const results: Array<boolean> = []
      const paramsSeen: Array<unknown> = []
      const machine = createMachine<Ctx, Ev>(
        {
          id: "a11-check",
          context: { count: 3, n: 0 },
          initial: "idle",
          states: {
            idle: {
              on: {
                GO: {
                  actions: enqueueActions<Ctx, Ev>(({ check }) => {
                    results.push(check("isPositive"))
                    results.push(check({ type: "atLeast", params: { min: 5 } }))
                    results.push(check({ type: "atLeast", params: ({ context }) => ({ min: context.count }) }))
                    results.push(check(and(["isPositive", not("isLocked")])))
                    results.push(check(or(["isLocked", { type: "atLeast", params: { min: 10 } }])))
                    results.push(check(stateIn("other")))
                    results.push(check(not(stateIn("other"))))
                  }),
                },
              },
            },
            other: {},
          },
        },
        {
          guards: {
            isPositive: ({ context }) => context.count > 0,
            isLocked: () => false,
            atLeast: ({ context }, params: { readonly min: number }) => {
              paramsSeen.push(params)
              return context.count >= params.min
            },
          },
        }
      )
      const actor = yield* createActor(machine)
      yield* actor.start
      yield* actor.send({ type: "GO" })

      assert.deepStrictEqual(results, [true, false, true, true, false, false, true])
      assert.deepStrictEqual(paramsSeen, [{ min: 5 }, { min: 3 }, { min: 10 }])
    })
  )

  it.effect("[A11] check of a name without implementation sets status error with the S16 message; no enqueued action runs", () =>
    Effect.gen(function* () {
      const calls: Array<string> = []
      const machine = createMachine<Ctx, Ev>({
        id: "a11-unknown",
        context: { count: 0, n: 0 },
        initial: "idle",
        states: {
          idle: {
            on: {
              GO: {
                target: "next",
                actions: enqueueActions<Ctx, Ev>(({ enqueue, check }) => {
                  enqueue(() => {
                    calls.push("before")
                  })
                  if (check("unknown")) {
                    enqueue(() => {
                      calls.push("guarded")
                    })
                  }
                  calls.push("after check")
                }),
              },
            },
          },
          next: {},
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      yield* actor.send({ type: "GO" })

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "error")
      const error = errorOf(snapshot)
      assert.strictEqual(error.message, guardNotImplemented("unknown"))
      assert.strictEqual(error.name, "Error")
      assert.strictEqual(snapshot.value, "idle", "the transition is not taken")
      assert.deepStrictEqual(calls, [], "check throws: collect stops there and no enqueued action runs")
    })
  )

  it.effect("[A11] check reads the context from before the enqueued assign; an action enqueued after it sees the assign", () =>
    Effect.gen(function* () {
      const seen: Array<string> = []
      const machine = createMachine<Ctx, Ev>({
        id: "a11-check-order",
        context: { count: 0, n: 0 },
        on: {
          GO: {
            actions: enqueueActions<Ctx, Ev>(({ enqueue, check }) => {
              enqueue.assign({ n: 1 })
              seen.push(`check ${check(({ context }) => context.n === 1)}`)
              enqueue(({ context }) => {
                seen.push(`action ${context.n === 1}`)
              })
            }),
          },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      yield* actor.send({ type: "GO" })

      assert.deepStrictEqual(seen, ["check false", "action true"])
    })
  )

  it.effect("[A11] a nested enqueueActions resolves in place, and an enqueueActions used as a named action receives the params of the use", () =>
    Effect.gen(function* () {
      const calls: Array<string> = []
      const record = (label: string) => () => {
        calls.push(label)
      }
      const machine = createMachine<Ctx, Ev>(
        {
          id: "a11-nested",
          context: { count: 0, n: 0 },
          on: {
            GO: {
              actions: [
                enqueueActions<Ctx, Ev>(({ enqueue }) => {
                  enqueue(record("outer before"))
                  enqueue(
                    enqueueActions<Ctx, Ev>(({ enqueue: inner, context }) => {
                      inner(record(`inner sees ${context.count}`))
                      inner.assign({ count: 1 })
                    })
                  )
                  enqueue(({ context }) => {
                    calls.push(`outer after sees ${context.count}`)
                  })
                }),
                { type: "batch", params: { label: "from params" } },
              ],
            },
          },
        },
        {
          actions: {
            batch: enqueueActions<Ctx, Ev, { readonly label: string }>(({ enqueue }, params) => {
              enqueue(record(params.label))
            }),
          },
        }
      )
      const actor = yield* createActor(machine)
      yield* actor.start
      yield* actor.send({ type: "GO" })

      assert.deepStrictEqual(calls, ["outer before", "inner sees 0", "outer after sees 1", "from params"])
    })
  )

  it.effect("[A11] enqueue(log(...)) logs once; the enqueuer has no log helper (SD-16)", () => {
    const messages: Array<ReadonlyArray<unknown>> = []
    return withMessages(
      messages,
      Effect.gen(function* () {
        const hasLog: Array<boolean> = []
        const machine = createMachine<Ctx, Ev>({
          id: "a11-log",
          context: { count: 7, n: 0 },
          on: {
            GO: {
              actions: enqueueActions<Ctx, Ev>(({ enqueue }) => {
                hasLog.push("log" in enqueue)
                enqueue(log<Ctx, Ev>(({ context }) => `count ${context.count}`, "label"))
              }),
            },
          },
        })
        const actor = yield* createActor(machine)
        yield* actor.start
        yield* actor.send({ type: "GO" })

        assert.deepStrictEqual(messages, [["label", "count 7"]])
        assert.deepStrictEqual(hasLog, [false])
      })
    )
  })

  it.effect("[A11] collect receives a typed self and system, and a throw in collect sets status error with the thrown value", () =>
    Effect.gen(function* () {
      const ids: Array<string> = []
      const boom = new Error("collect failed")
      const machine = createMachine<Ctx, Ev>({
        id: "a11-self",
        context: { count: 0, n: 0 },
        entry: enqueueActions<Ctx, Ev>(({ self, system }) => {
          ids.push(self.id)
          ids.push(typeof system.get)
        }),
        on: {
          GO: {
            actions: enqueueActions<Ctx, Ev>(() => {
              throw boom
            }),
          },
        },
      })
      const actor = yield* createActor(machine, { id: "a11-self-actor" })
      yield* actor.start
      assert.deepStrictEqual(ids, ["a11-self-actor", "function"])

      yield* actor.send({ type: "GO" })
      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "error")
      assert.strictEqual(errorOf(snapshot), boom)
    })
  )

  it.effect("[A11] sendTo resolves a named delay before its target function, as upstream: event, delay, target", () =>
    Effect.gen(function* () {
      const order: Array<string> = []
      const target = ({ self }: { readonly self: ActorRefBase }) => {
        order.push("target")
        return self
      }
      const event = (): Ev => {
        order.push("event")
        return { type: "PING" }
      }
      const machine = createMachine<Ctx, Ev>(
        {
          id: "a11-send-order",
          context: { count: 0, n: 0 },
          on: {
            GO: { actions: sendTo<Ctx, Ev>(target, event, { delay: "recorded" }) },
            CANCEL: {
              actions: enqueueActions<Ctx, Ev>(({ enqueue }) => {
                enqueue.sendTo(target, event, { delay: "recorded" })
              }),
            },
          },
        },
        {
          delays: {
            recorded: () => {
              order.push("delay")
              return 10
            },
          },
        }
      )
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* actor.send({ type: "GO" })
      assert.deepStrictEqual(order, ["event", "delay", "target"])

      yield* actor.send({ type: "CANCEL" })
      assert.deepStrictEqual(order, ["event", "delay", "target", "event", "delay", "target"])
    })
  )

  it.effect("[A11] an SCXML <if> raises only from its first true branch, and the machine takes that event (W3C test147)", () =>
    Effect.gen(function* () {
      const machine = toMachine(`<?xml version="1.0" encoding="UTF-8"?>
<scxml xmlns="http://www.w3.org/2005/07/scxml" initial="s0" version="1.0" datamodel="ecmascript">
  <datamodel><data id="Var1" expr="0"/></datamodel>
  <state id="s0">
    <onentry>
      <if cond="false">
        <raise event="foo"/>
        <assign location="Var1" expr="Var1 + 1"/>
      <elseif cond="true"/>
        <raise event="bar"/>
        <assign location="Var1" expr="Var1 + 1"/>
      <else/>
        <raise event="baz"/>
        <assign location="Var1" expr="Var1 + 1"/>
      </if>
      <raise event="bat"/>
    </onentry>
    <transition event="bar" cond="Var1==1" target="pass"/>
    <transition event="*" target="fail"/>
  </state>
  <final id="pass"/>
  <final id="fail"/>
</scxml>`)
      const actor = yield* createActor(machine)
      yield* actor.start

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.value, "pass")
      assert.strictEqual(snapshot.status, "done")
    })
  )
})
