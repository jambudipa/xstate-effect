/**
 * Actions tests
 */
import { describe, it, expect, vi } from "vitest"
import { Effect, Option } from "effect"
import { evaluateGuard } from "../src/guards/evaluateGuard.js"
import {
  assign,
  assignProperty,
  raise,
  emit,
  cancel,
  log,
  enqueueActions,
} from "../src/index.js"
import type { ActionContext, ActionDefinition, ActionResult } from "../src/Types.js"
import type { SchedulerService } from "../src/ActorLogic.js"
import type { EventObject } from "../src/Event.js"

// Helper to create a mock ActionContext
const createMockContext = <TContext, TEvent extends EventObject>(
  context: TContext,
  event: TEvent
): ActionContext<TContext, TEvent> => ({
  context,
  event,
  self: {} as any,
  system: {} as any,
  defer: () => Effect.void,
  emit: () => Effect.void,
  spawn: (() => Effect.fail(new Error("Not implemented"))) as any,
  stopChild: () => Effect.void,
  children: {},
  // No machine: inline guards only, no named guards or delays
  evaluateGuard: (guard) => evaluateGuard(guard, context, event, { self: {} as any, system: {} as any }),
  resolveDelay: () => Option.none(),
})

describe("Actions", () => {
  describe("assign", () => {
    it("should create assign action with static value", async () => {
      interface Context {
        count: number
        name: string
      }

      type Event = { type: "INCREMENT" }

      const action = assign<Context, Event>({ count: 5 })

      expect(action.type).toBe("xstate.assign")

      const ctx = createMockContext<Context, Event>(
        { count: 0, name: "test" },
        { type: "INCREMENT" }
      )

      const result = await Effect.runPromise(action.exec(ctx, undefined))

      expect(result._tag).toBe("ContextUpdate")
      if (result._tag === "ContextUpdate") {
        expect((result as any).context.count).toBe(5)
      }
    })

    it("should create assign action with function", async () => {
      interface Context {
        count: number
      }

      type Event = { type: "INCREMENT"; amount: number }

      const action = assign<Context, Event>((ctx) => ({
        count: ctx.context.count + ctx.event.amount,
      }))

      const ctx = createMockContext<Context, Event>(
        { count: 10 },
        { type: "INCREMENT", amount: 5 }
      )

      const result = await Effect.runPromise(action.exec(ctx, undefined))

      expect(result._tag).toBe("ContextUpdate")
      if (result._tag === "ContextUpdate") {
        expect((result as any).context.count).toBe(15)
      }
    })

    it("should handle Effect-based assignment", async () => {
      interface Context {
        value: string
      }

      type Event = { type: "SET" }

      const action = assign<Context, Event>(() =>
        Effect.succeed({ value: "computed" })
      )

      const ctx = createMockContext<Context, Event>(
        { value: "initial" },
        { type: "SET" }
      )

      const result = await Effect.runPromise(action.exec(ctx, undefined))

      expect(result._tag).toBe("ContextUpdate")
      if (result._tag === "ContextUpdate") {
        expect((result as any).context.value).toBe("computed")
      }
    })
  })

  describe("assignProperty", () => {
    it("should assign a single property with static value", async () => {
      interface Context {
        count: number
        name: string
      }

      type Event = { type: "SET_COUNT" }

      const action = assignProperty<Context, Event, "count">("count", 42)

      const ctx = createMockContext<Context, Event>(
        { count: 0, name: "test" },
        { type: "SET_COUNT" }
      )

      const result = await Effect.runPromise(action.exec(ctx, undefined))

      expect(result._tag).toBe("ContextUpdate")
      if (result._tag === "ContextUpdate") {
        expect((result as any).context.count).toBe(42)
      }
    })

    it("should assign a single property with function", async () => {
      interface Context {
        count: number
      }

      type Event = { type: "DOUBLE" }

      const action = assignProperty<Context, Event, "count">(
        "count",
        (ctx) => ctx.context.count * 2
      )

      const ctx = createMockContext<Context, Event>(
        { count: 5 },
        { type: "DOUBLE" }
      )

      const result = await Effect.runPromise(action.exec(ctx, undefined))

      expect(result._tag).toBe("ContextUpdate")
      if (result._tag === "ContextUpdate") {
        expect((result as any).context.count).toBe(10)
      }
    })
  })

  describe("raise", () => {
    it("should create raise action with static event", async () => {
      type Event = { type: "RAISED" } | { type: "TRIGGER" }

      const action = raise<unknown, Event>({ type: "RAISED" })

      expect(action.type).toBe("xstate.raise")

      const ctx = createMockContext<unknown, Event>(
        {},
        { type: "TRIGGER" }
      )

      const result = await Effect.runPromise(action.exec(ctx, undefined))

      expect(result._tag).toBe("RaiseEvent")
      if (result._tag === "RaiseEvent") {
        expect((result as any).event.type).toBe("RAISED")
      }
    })

    it("should create raise action with function", async () => {
      interface Context {
        eventType: string
      }

      type Event = { type: "RAISED"; data: string } | { type: "TRIGGER" }

      const action = raise<Context, Event>((ctx) => ({
        type: "RAISED",
        data: ctx.context.eventType,
      }))

      const ctx = createMockContext<Context, Event>(
        { eventType: "test-data" },
        { type: "TRIGGER" }
      )

      const result = await Effect.runPromise(action.exec(ctx, undefined))

      expect(result._tag).toBe("RaiseEvent")
      if (result._tag === "RaiseEvent") {
        expect((result as any).event.type).toBe("RAISED")
        expect((result as any).event.data).toBe("test-data")
      }
    })
  })

  describe("emit", () => {
    it("should create emit action", async () => {
      type Event = { type: "TRIGGER" }

      const action = emit<unknown, Event>({ type: "EMITTED_EVENT" })

      expect(action.type).toBe("xstate.emit")

      const ctx = createMockContext<unknown, Event>(
        {},
        { type: "TRIGGER" }
      )

      const result = await Effect.runPromise(action.exec(ctx, undefined))

      expect(result._tag).toBe("EmitEvent")
      if (result._tag === "EmitEvent") {
        expect((result as any).event.type).toBe("EMITTED_EVENT")
      }
    })
  })

  describe("cancel", () => {
    it("should create cancel action with correct type", () => {
      type Event = { type: "CANCEL" }

      const action = cancel<unknown, Event>("delayed-event-id")

      expect(action.type).toBe("xstate.cancel")
    })

    // Gives the mock context a system whose scheduler records each cancel call, and a
    // `defer` that keeps the deferred effects, as the actor does until its macrostep commits.
    const createCancelContext = <TContext, TEvent extends EventObject>(
      context: TContext,
      event: TEvent
    ) => {
      const cancelled: Array<{ actor: unknown; id: string }> = []
      const deferred: Array<Effect.Effect<void>> = []
      const self = { id: "self", sessionId: "session-self" } as any
      const scheduler = {
        cancel: (actor, id) =>
          Effect.sync(() => {
            cancelled.push({ actor, id })
          }),
      } satisfies Pick<SchedulerService, "cancel">
      const ctx: ActionContext<TContext, TEvent> = {
        ...createMockContext(context, event),
        self,
        system: { scheduler } as any,
        defer: (effect) =>
          Effect.sync(() => {
            deferred.push(effect)
          }),
      }
      const runDeferred = Effect.suspend(() => Effect.forEach(deferred, (effect) => effect, { discard: true }))
      return { ctx, self, cancelled, runDeferred }
    }

    it("should call scheduler.cancel with self and the id once the macrostep commits", async () => {
      type Event = { type: "CANCEL" }

      const action = cancel<unknown, Event>("delayed-event-id")
      const { ctx, self, cancelled, runDeferred } = createCancelContext<unknown, Event>({}, { type: "CANCEL" })

      const result = await Effect.runPromise(action.exec(ctx, undefined))

      // Upstream `resolveCancel`'s params, which the engine reports through the action
      // executor (`@xstate.action`, T6.8; SD-20)
      expect(result).toMatchObject({ _tag: "Cancel", sendId: "delayed-event-id" })
      // Upstream `executeCancel` defers the scheduler call
      expect(cancelled).toHaveLength(0)
      await Effect.runPromise(runDeferred)
      expect(cancelled).toHaveLength(1)
      expect(cancelled[0]?.actor).toBe(self)
      expect(cancelled[0]?.id).toBe("delayed-event-id")
    })

    it("should call scheduler.cancel with an id computed from the context", async () => {
      interface Context {
        timerId: string
      }
      type Event = { type: "CANCEL" }

      const action = cancel<Context, Event>(({ context }) => context.timerId)
      const { ctx, self, cancelled, runDeferred } = createCancelContext<Context, Event>(
        { timerId: "timer-7" },
        { type: "CANCEL" }
      )

      const result = await Effect.runPromise(action.exec(ctx, undefined))

      expect(result).toMatchObject({ _tag: "Cancel", sendId: "timer-7" })
      await Effect.runPromise(runDeferred)
      expect(cancelled).toHaveLength(1)
      expect(cancelled[0]?.actor).toBe(self)
      expect(cancelled[0]?.id).toBe("timer-7")
    })
  })

  describe("log", () => {
    it("should create log action", async () => {
      type Event = { type: "LOG" }

      const action = log<unknown, Event>("Test message")

      expect(action.type).toBe("xstate.log")

      const ctx = createMockContext<unknown, Event>(
        {},
        { type: "LOG" }
      )

      const result = await Effect.runPromise(action.exec(ctx, undefined))

      // Log action returns the Log result with the value; the engine logs it
      expect(result._tag).toBe("Log")
    })

    it("should create log action with function message", async () => {
      interface Context {
        userId: string
      }

      type Event = { type: "LOG" }

      const action = log<Context, Event>((ctx) => `User: ${ctx.context.userId}`)

      const ctx = createMockContext<Context, Event>(
        { userId: "user-123" },
        { type: "LOG" }
      )

      const result = await Effect.runPromise(action.exec(ctx, undefined))

      // Log action returns the Log result with the computed value; the engine logs it
      expect(result._tag).toBe("Log")
    })
  })

  describe("sendTo", () => {
    it("should create sendTo action with ActorRef target", async () => {
      interface Context {
        targetRef: { id: string; sendUntyped: (e: any) => Effect.Effect<void> }
      }

      type Event = { type: "TRIGGER" }

      // Import sendTo
      const { sendTo } = await import("../src/actions/sendTo.js")

      const mockTarget = {
        id: "target-actor",
        sendUntyped: vi.fn(() => Effect.void),
        _parent: { _tag: "None" as const },
        _system: {} as any,
      }

      const action = sendTo<Context, Event>(
        (ctx) => ctx.context.targetRef as any,
        { type: "PING" }
      )

      expect(action.type).toBe("xstate.sendTo")

      const ctx = createMockContext<Context, Event>(
        { targetRef: mockTarget },
        { type: "TRIGGER" }
      )

      const result = await Effect.runPromise(action.exec(ctx, undefined))

      expect(result._tag).toBe("SendEvent")
      if (result._tag === "SendEvent") {
        expect((result as any).event.type).toBe("PING")
      }
    })

    it("should create sendTo action with string target", async () => {
      type Event = { type: "TRIGGER" }

      const { sendTo } = await import("../src/actions/sendTo.js")

      const action = sendTo<unknown, Event>(
        "#_parent",
        { type: "CHILD_DONE" }
      )

      expect(action.type).toBe("xstate.sendTo")
    })

    it("should create sendTo action with dynamic event", async () => {
      interface Context {
        value: number
      }

      type Event = { type: "TRIGGER" }

      const { sendTo } = await import("../src/actions/sendTo.js")

      const action = sendTo<Context, Event>(
        "#_self",
        (ctx) => ({ type: "COMPUTED", value: ctx.context.value * 2 })
      )

      expect(action.type).toBe("xstate.sendTo")
    })
  })

  describe("sendParent and sendSelf", () => {
    it("should create sendParent action", async () => {
      type Event = { type: "TRIGGER" }

      const { sendParent } = await import("../src/actions/sendTo.js")

      const action = sendParent<unknown, Event>({ type: "PARENT_EVENT" })

      expect(action.type).toBe("xstate.sendTo")
    })

    it("should create sendSelf action", async () => {
      type Event = { type: "TRIGGER" } | { type: "RETRY" }

      const { sendSelf } = await import("../src/actions/sendTo.js")

      const action = sendSelf<unknown, Event>({ type: "RETRY" })

      expect(action.type).toBe("xstate.sendTo")
    })
  })

  describe("spawnChild", () => {
    it("should create spawnChild action with logic", async () => {
      interface Context {
        childId: string
      }

      type Event = { type: "SPAWN" }

      const { spawnChild } = await import("../src/actions/spawnChild.js")
      const { fromPromise } = await import("../src/actors/fromPromise.js")

      const childLogic = fromPromise(() => Promise.resolve("done"))

      const action = spawnChild<Context, Event, typeof childLogic>(
        childLogic,
        {
          id: (ctx) => `child-${ctx.context.childId}`,
        }
      )

      expect(action.type).toBe("xstate.spawnChild")
    })

    it("should create spawnChild action with string src", async () => {
      type Event = { type: "SPAWN" }

      const { spawnChild } = await import("../src/actions/spawnChild.js")

      const action = spawnChild<unknown, Event, any>("fetchActor")

      expect(action.type).toBe("xstate.spawnChild")
    })
  })

  describe("stopChild", () => {
    it("should create stopChild action with string id", async () => {
      type Event = { type: "STOP" }

      const { stopChild } = await import("../src/actions/stopChild.js")

      const action = stopChild<unknown, Event>("child-actor-id")

      expect(action.type).toBe("xstate.stopChild")
    })

    it("should create stopChild action with function id", async () => {
      interface Context {
        targetChild: string
      }

      type Event = { type: "STOP" }

      const { stopChild } = await import("../src/actions/stopChild.js")

      const action = stopChild<Context, Event>(
        (ctx) => ctx.context.targetChild
      )

      expect(action.type).toBe("xstate.stopChild")
    })
  })

  describe("enqueueActions", () => {
    // The action collects; the engine runs what it collected in its place (upstream
    // `resolveEnqueueActions` returns the actions, A11), so `exec` gives them as the
    // `Enqueued` result, in order, as they were enqueued
    const enqueuedOf = (result: ActionResult): ReadonlyArray<unknown> => {
      expect(result._tag).toBe("Enqueued")
      return result._tag === "Enqueued" ? result.actions : []
    }
    const typesOf = (actions: ReadonlyArray<unknown>): ReadonlyArray<unknown> =>
      actions.map((action) => (typeof action === "object" && action !== null && "type" in action ? action.type : action))

    it("should queue multiple actions", async () => {
      interface Context {
        count: number
        message: string
      }

      type Event = { type: "UPDATE" }

      const action = enqueueActions<Context, Event>(({ enqueue, context }) => {
        enqueue.assign({ count: context.count + 1 })
        enqueue.assign({ message: "updated" })
      })

      expect(action.type).toBe("xstate.enqueueActions")

      const ctx = createMockContext<Context, Event>(
        { count: 0, message: "initial" },
        { type: "UPDATE" }
      )

      const result = await Effect.runPromise(action.exec(ctx, undefined))

      expect(typesOf(enqueuedOf(result))).toEqual(["xstate.assign", "xstate.assign"])
    })

    it("should conditionally queue actions", async () => {
      interface Context {
        count: number
        shouldDouble: boolean
      }

      type Event = { type: "PROCESS" }

      const action = enqueueActions<Context, Event>(({ enqueue, context }) => {
        enqueue.assign({ count: context.count + 1 })

        if (context.shouldDouble) {
          enqueue.assign({ count: (context.count + 1) * 2 })
        }
      })

      // Test without doubling
      const ctx1 = createMockContext<Context, Event>(
        { count: 5, shouldDouble: false },
        { type: "PROCESS" }
      )

      const result1 = await Effect.runPromise(action.exec(ctx1, undefined))
      expect(typesOf(enqueuedOf(result1))).toEqual(["xstate.assign"])

      // Test with doubling
      const ctx2 = createMockContext<Context, Event>(
        { count: 5, shouldDouble: true },
        { type: "PROCESS" }
      )

      const result2 = await Effect.runPromise(action.exec(ctx2, undefined))
      expect(typesOf(enqueuedOf(result2))).toEqual(["xstate.assign", "xstate.assign"])
    })

    it("should check guards with inline functions", async () => {
      interface Context {
        value: number
      }

      type Event = { type: "CHECK" }

      const action = enqueueActions<Context, Event>(({ enqueue, check, context }) => {
        if (check(() => context.value > 10)) {
          enqueue.assign({ value: 100 })
        } else {
          enqueue.assign({ value: 0 })
        }
      })

      // The one assign it enqueued, run against the same context
      const assigned = async (ctx: ActionContext<Context, Event>) => {
        const [enqueued] = enqueuedOf(await Effect.runPromise(action.exec(ctx, undefined)))
        const result = await Effect.runPromise((enqueued as ActionDefinition<Context, Event>).exec(ctx, undefined))
        return result._tag === "ContextUpdate" ? (result.context as Context).value : undefined
      }

      // Test value > 10
      expect(await assigned(createMockContext<Context, Event>({ value: 15 }, { type: "CHECK" }))).toBe(100)

      // Test value <= 10
      expect(await assigned(createMockContext<Context, Event>({ value: 5 }, { type: "CHECK" }))).toBe(0)
    })

    it("should enqueue raise action", async () => {
      interface Context {
        triggered: boolean
      }

      type Event = { type: "TRIGGER" } | { type: "RAISED" }

      const action = enqueueActions<Context, Event>(({ enqueue }) => {
        enqueue.raise({ type: "RAISED" })
      })

      const ctx = createMockContext<Context, Event>(
        { triggered: false },
        { type: "TRIGGER" }
      )

      const result = await Effect.runPromise(action.exec(ctx, undefined))
      // The engine raises it when it runs the enqueued action
      expect(typesOf(enqueuedOf(result))).toEqual(["xstate.raise"])
    })

    it("should enqueue emit action", async () => {
      type Event = { type: "TRIGGER" }

      const action = enqueueActions<unknown, Event>(({ enqueue }) => {
        enqueue.emit({ type: "EMITTED" })
      })

      const ctx = createMockContext<unknown, Event>(
        {},
        { type: "TRIGGER" }
      )

      const result = await Effect.runPromise(action.exec(ctx, undefined))
      expect(typesOf(enqueuedOf(result))).toEqual(["xstate.emit"])
    })

    it("should enqueue nothing when no actions are enqueued", async () => {
      type Event = { type: "TRIGGER" }

      const action = enqueueActions<unknown, Event>(() => {
        // Intentionally empty
      })

      const ctx = createMockContext<unknown, Event>(
        {},
        { type: "TRIGGER" }
      )

      const result = await Effect.runPromise(action.exec(ctx, undefined))
      expect(enqueuedOf(result)).toEqual([])
    })

    it("should enqueue string action reference", async () => {
      type Event = { type: "TRIGGER" }

      const action = enqueueActions<unknown, Event>(({ enqueue }) => {
        enqueue("namedAction")
      })

      const ctx = createMockContext<unknown, Event>(
        {},
        { type: "TRIGGER" }
      )

      const result = await Effect.runPromise(action.exec(ctx, undefined))
      // The name as enqueued: the engine resolves it against the machine's actions (A11,
      // SD-20: it was a NoOp stand-in)
      expect(enqueuedOf(result)).toEqual(["namedAction"])
    })

    it("should have access to collect function on the definition", () => {
      type Event = { type: "TEST" }

      const collectFn = ({ enqueue }: { enqueue: any }) => {
        enqueue.assign({ value: 1 })
      }

      const action = enqueueActions<{ value: number }, Event>(collectFn)

      // EnqueueActionsDefinition exposes the collect property
      expect(action.collect).toBe(collectFn)
    })
  })
})
