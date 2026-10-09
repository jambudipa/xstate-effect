/**
 * Guards tests
 */
import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import { and, or, not, stateIn, when, guard } from "../src/index.js"
import { GuardError } from "../src/Errors.js"
import type { GuardContext, GuardDefinition } from "../src/Types.js"
import type { EventObject } from "../src/Event.js"

// Helper to create a mock GuardContext
const createMockGuardContext = <TContext, TEvent extends EventObject>(
  context: TContext,
  event: TEvent,
  implementations?: import("../src/Types.js").MachineImplementations<TContext, TEvent>
): GuardContext<TContext, TEvent> => ({
  context,
  event,
  self: {} as any,
  system: {} as any,
  implementations,
})

describe("Guards", () => {
  describe("when", () => {
    it("should create guard from predicate function", async () => {
      interface Context {
        count: number
      }

      type Event = { type: "CHECK" }

      const isPositive = when<Context, Event>((ctx) => ctx.context.count > 0)

      expect(isPositive.type).toBe("xstate.when")

      const ctx1 = createMockGuardContext<Context, Event>(
        { count: 5 },
        { type: "CHECK" }
      )

      const result1 = await Effect.runPromise(
        isPositive.predicate(ctx1, isPositive.params)
      )
      expect(result1).toBe(true)

      const ctx2 = createMockGuardContext<Context, Event>(
        { count: -1 },
        { type: "CHECK" }
      )

      const result2 = await Effect.runPromise(
        isPositive.predicate(ctx2, isPositive.params)
      )
      expect(result2).toBe(false)
    })
  })

  describe("guard", () => {
    it("should create guard with Effect predicate", async () => {
      interface Context {
        items: string[]
      }

      type Event = { type: "CHECK" }

      const hasItems = guard<Context, Event>("hasItems", (ctx) =>
        Effect.succeed(ctx.context.items.length > 0)
      )

      expect(hasItems.type).toBe("hasItems")

      const ctx1 = createMockGuardContext<Context, Event>(
        { items: ["a", "b"] },
        { type: "CHECK" }
      )

      const result1 = await Effect.runPromise(
        hasItems.predicate(ctx1, hasItems.params)
      )
      expect(result1).toBe(true)

      const ctx2 = createMockGuardContext<Context, Event>(
        { items: [] },
        { type: "CHECK" }
      )

      const result2 = await Effect.runPromise(
        hasItems.predicate(ctx2, hasItems.params)
      )
      expect(result2).toBe(false)
    })
  })

  describe("and", () => {
    it("should combine guards with AND logic", async () => {
      interface Context {
        count: number
        enabled: boolean
      }

      type Event = { type: "CHECK" }

      const isPositive = when<Context, Event>((ctx) => ctx.context.count > 0)
      const isEnabled = when<Context, Event>((ctx) => ctx.context.enabled)

      const combined = and<Context, Event>([isPositive, isEnabled])

      expect(combined.type).toBe("xstate.and")

      // Both true
      const ctx1 = createMockGuardContext<Context, Event>(
        { count: 5, enabled: true },
        { type: "CHECK" }
      )
      const result1 = await Effect.runPromise(
        combined.predicate(ctx1, combined.params!)
      )
      expect(result1).toBe(true)

      // First false
      const ctx2 = createMockGuardContext<Context, Event>(
        { count: -1, enabled: true },
        { type: "CHECK" }
      )
      const result2 = await Effect.runPromise(
        combined.predicate(ctx2, combined.params!)
      )
      expect(result2).toBe(false)

      // Second false
      const ctx3 = createMockGuardContext<Context, Event>(
        { count: 5, enabled: false },
        { type: "CHECK" }
      )
      const result3 = await Effect.runPromise(
        combined.predicate(ctx3, combined.params!)
      )
      expect(result3).toBe(false)

      // Both false
      const ctx4 = createMockGuardContext<Context, Event>(
        { count: -1, enabled: false },
        { type: "CHECK" }
      )
      const result4 = await Effect.runPromise(
        combined.predicate(ctx4, combined.params!)
      )
      expect(result4).toBe(false)
    })

    it("should handle inline function guards", async () => {
      interface Context {
        a: number
        b: number
      }

      type Event = { type: "CHECK" }

      const combined = and<Context, Event>([
        (ctx) => ctx.context.a > 0,
        (ctx) => ctx.context.b > 0,
      ])

      const ctx1 = createMockGuardContext<Context, Event>(
        { a: 5, b: 10 },
        { type: "CHECK" }
      )
      const result1 = await Effect.runPromise(
        combined.predicate(ctx1, combined.params!)
      )
      expect(result1).toBe(true)

      const ctx2 = createMockGuardContext<Context, Event>(
        { a: 5, b: -1 },
        { type: "CHECK" }
      )
      const result2 = await Effect.runPromise(
        combined.predicate(ctx2, combined.params!)
      )
      expect(result2).toBe(false)
    })
  })

  describe("or", () => {
    it("should combine guards with OR logic", async () => {
      interface Context {
        isAdmin: boolean
        hasPermission: boolean
      }

      type Event = { type: "CHECK" }

      const isAdmin = when<Context, Event>((ctx) => ctx.context.isAdmin)
      const hasPermission = when<Context, Event>((ctx) => ctx.context.hasPermission)

      const combined = or<Context, Event>([isAdmin, hasPermission])

      expect(combined.type).toBe("xstate.or")

      // Both true
      const ctx1 = createMockGuardContext<Context, Event>(
        { isAdmin: true, hasPermission: true },
        { type: "CHECK" }
      )
      const result1 = await Effect.runPromise(
        combined.predicate(ctx1, combined.params!)
      )
      expect(result1).toBe(true)

      // First true only
      const ctx2 = createMockGuardContext<Context, Event>(
        { isAdmin: true, hasPermission: false },
        { type: "CHECK" }
      )
      const result2 = await Effect.runPromise(
        combined.predicate(ctx2, combined.params!)
      )
      expect(result2).toBe(true)

      // Second true only
      const ctx3 = createMockGuardContext<Context, Event>(
        { isAdmin: false, hasPermission: true },
        { type: "CHECK" }
      )
      const result3 = await Effect.runPromise(
        combined.predicate(ctx3, combined.params!)
      )
      expect(result3).toBe(true)

      // Both false
      const ctx4 = createMockGuardContext<Context, Event>(
        { isAdmin: false, hasPermission: false },
        { type: "CHECK" }
      )
      const result4 = await Effect.runPromise(
        combined.predicate(ctx4, combined.params!)
      )
      expect(result4).toBe(false)
    })
  })

  describe("not", () => {
    it("should negate a guard", async () => {
      interface Context {
        disabled: boolean
      }

      type Event = { type: "CHECK" }

      const isDisabled = when<Context, Event>((ctx) => ctx.context.disabled)
      const isEnabled = not<Context, Event>(isDisabled)

      expect(isEnabled.type).toBe("xstate.not")

      // disabled = true -> not = false
      const ctx1 = createMockGuardContext<Context, Event>(
        { disabled: true },
        { type: "CHECK" }
      )
      const result1 = await Effect.runPromise(
        isEnabled.predicate(ctx1, isEnabled.params!)
      )
      expect(result1).toBe(false)

      // disabled = false -> not = true
      const ctx2 = createMockGuardContext<Context, Event>(
        { disabled: false },
        { type: "CHECK" }
      )
      const result2 = await Effect.runPromise(
        isEnabled.predicate(ctx2, isEnabled.params!)
      )
      expect(result2).toBe(true)
    })

    it("should negate inline function guard", async () => {
      interface Context {
        value: number
      }

      type Event = { type: "CHECK" }

      const isNotZero = not<Context, Event>((ctx) => ctx.context.value === 0)

      const ctx1 = createMockGuardContext<Context, Event>(
        { value: 0 },
        { type: "CHECK" }
      )
      const result1 = await Effect.runPromise(
        isNotZero.predicate(ctx1, isNotZero.params!)
      )
      expect(result1).toBe(false)

      const ctx2 = createMockGuardContext<Context, Event>(
        { value: 5 },
        { type: "CHECK" }
      )
      const result2 = await Effect.runPromise(
        isNotZero.predicate(ctx2, isNotZero.params!)
      )
      expect(result2).toBe(true)
    })
  })

  describe("stateIn", () => {
    it("should check if in specific state", async () => {
      const guard = stateIn<unknown, EventObject>("active")

      expect(guard.type).toBe("xstate.stateIn")
      expect(guard.params!.stateValue).toBe("active")
    })
  })

  describe("complex combinations", () => {
    it("should handle nested guard combinations", async () => {
      interface Context {
        age: number
        hasLicense: boolean
        isSupervisor: boolean
      }

      type Event = { type: "CHECK" }

      // (age >= 18 AND hasLicense) OR isSupervisor
      const ageAndLicense = and<Context, Event>([
        (ctx) => ctx.context.age >= 18,
        (ctx) => ctx.context.hasLicense,
      ])
      const canDrive = or<Context, Event>([
        ageAndLicense as unknown as GuardDefinition<Context, Event, void>,
        (ctx) => ctx.context.isSupervisor,
      ])

      // Adult with license
      const ctx1 = createMockGuardContext<Context, Event>(
        { age: 25, hasLicense: true, isSupervisor: false },
        { type: "CHECK" }
      )
      expect(
        await Effect.runPromise(canDrive.predicate(ctx1, canDrive.params!))
      ).toBe(true)

      // Underage with license
      const ctx2 = createMockGuardContext<Context, Event>(
        { age: 16, hasLicense: true, isSupervisor: false },
        { type: "CHECK" }
      )
      expect(
        await Effect.runPromise(canDrive.predicate(ctx2, canDrive.params!))
      ).toBe(false)

      // Supervisor (any age)
      const ctx3 = createMockGuardContext<Context, Event>(
        { age: 16, hasLicense: false, isSupervisor: true },
        { type: "CHECK" }
      )
      expect(
        await Effect.runPromise(canDrive.predicate(ctx3, canDrive.params!))
      ).toBe(true)

      // No conditions met
      const ctx4 = createMockGuardContext<Context, Event>(
        { age: 16, hasLicense: false, isSupervisor: false },
        { type: "CHECK" }
      )
      expect(
        await Effect.runPromise(canDrive.predicate(ctx4, canDrive.params!))
      ).toBe(false)
    })
  })

  describe("named guards with implementations", () => {
    it("should resolve named guards from implementations in and()", async () => {
      interface Context {
        count: number
        enabled: boolean
      }

      type Event = { type: "CHECK" }

      const implementations = {
        guards: {
          isPositive: {
            type: "isPositive",
            params: undefined,
            predicate: (ctx: GuardContext<Context, Event>) =>
              Effect.succeed(ctx.context.count > 0),
          },
          isEnabled: {
            type: "isEnabled",
            params: undefined,
            predicate: (ctx: GuardContext<Context, Event>) =>
              Effect.succeed(ctx.context.enabled),
          },
        },
      }

      // Mix named guards with inline guards
      const combined = and<Context, Event>(
        ["isPositive", "isEnabled"],
        implementations
      )

      // Both true
      const ctx1 = createMockGuardContext<Context, Event>(
        { count: 5, enabled: true },
        { type: "CHECK" }
      )
      const result1 = await Effect.runPromise(
        combined.predicate(ctx1, combined.params!)
      )
      expect(result1).toBe(true)

      // First false
      const ctx2 = createMockGuardContext<Context, Event>(
        { count: -1, enabled: true },
        { type: "CHECK" }
      )
      const result2 = await Effect.runPromise(
        combined.predicate(ctx2, combined.params!)
      )
      expect(result2).toBe(false)
    })

    it("should resolve named guards from implementations in or()", async () => {
      interface Context {
        isAdmin: boolean
        hasPermission: boolean
      }

      type Event = { type: "CHECK" }

      const implementations = {
        guards: {
          isAdmin: {
            type: "isAdmin",
            params: undefined,
            predicate: (ctx: GuardContext<Context, Event>) =>
              Effect.succeed(ctx.context.isAdmin),
          },
          hasPermission: {
            type: "hasPermission",
            params: undefined,
            predicate: (ctx: GuardContext<Context, Event>) =>
              Effect.succeed(ctx.context.hasPermission),
          },
        },
      }

      const combined = or<Context, Event>(
        ["isAdmin", "hasPermission"],
        implementations
      )

      // Both false
      const ctx1 = createMockGuardContext<Context, Event>(
        { isAdmin: false, hasPermission: false },
        { type: "CHECK" }
      )
      const result1 = await Effect.runPromise(
        combined.predicate(ctx1, combined.params!)
      )
      expect(result1).toBe(false)

      // One true
      const ctx2 = createMockGuardContext<Context, Event>(
        { isAdmin: true, hasPermission: false },
        { type: "CHECK" }
      )
      const result2 = await Effect.runPromise(
        combined.predicate(ctx2, combined.params!)
      )
      expect(result2).toBe(true)
    })

    it("should resolve named guards from implementations in not()", async () => {
      interface Context {
        disabled: boolean
      }

      type Event = { type: "CHECK" }

      const implementations = {
        guards: {
          isDisabled: {
            type: "isDisabled",
            params: undefined,
            predicate: (ctx: GuardContext<Context, Event>) =>
              Effect.succeed(ctx.context.disabled),
          },
        },
      }

      const isEnabled = not<Context, Event>("isDisabled", implementations)

      // disabled = true -> not = false
      const ctx1 = createMockGuardContext<Context, Event>(
        { disabled: true },
        { type: "CHECK" }
      )
      const result1 = await Effect.runPromise(
        isEnabled.predicate(ctx1, isEnabled.params!)
      )
      expect(result1).toBe(false)

      // disabled = false -> not = true
      const ctx2 = createMockGuardContext<Context, Event>(
        { disabled: false },
        { type: "CHECK" }
      )
      const result2 = await Effect.runPromise(
        isEnabled.predicate(ctx2, isEnabled.params!)
      )
      expect(result2).toBe(true)
    })

    it("should use implementations from context when not provided directly", async () => {
      interface Context {
        value: number
      }

      type Event = { type: "CHECK" }

      const implementations = {
        guards: {
          isPositive: {
            type: "isPositive",
            params: undefined,
            predicate: (ctx: GuardContext<Context, Event>) =>
              Effect.succeed(ctx.context.value > 0),
          },
        },
      }

      // Create guard without implementations
      const combined = and<Context, Event>(["isPositive"])

      // Pass implementations via context
      const ctx = createMockGuardContext<Context, Event>(
        { value: 5 },
        { type: "CHECK" },
        implementations
      )

      const result = await Effect.runPromise(
        combined.predicate(ctx, combined.params!)
      )
      expect(result).toBe(true)
    })

    // SD-20: these replace the former "defaults to true/false" tests, which contradicted S16.
    // A missing name fails the guard Effect with the upstream message; T3.17 (S16) turns that
    // failure into the actor's `error` status.
    it("should fail with the not-implemented GuardError for a missing named guard in and()", async () => {
      type Event = { type: "CHECK" }

      // No implementations provided
      const combined = and<unknown, Event>(["nonExistentGuard"])

      const ctx = createMockGuardContext<unknown, Event>(
        {},
        { type: "CHECK" }
      )

      const error = await Effect.runPromise(
        Effect.flip(combined.predicate(ctx, combined.params!))
      )
      expect(error).toBeInstanceOf(GuardError)
      expect(error.message).toBe("Guard 'nonExistentGuard' is not implemented.'.")
      expect(error.guard).toBe("nonExistentGuard")
    })

    it("should fail with the not-implemented GuardError for a missing named guard in or()", async () => {
      type Event = { type: "CHECK" }

      // No implementations provided
      const combined = or<unknown, Event>(["nonExistentGuard"])

      const ctx = createMockGuardContext<unknown, Event>(
        {},
        { type: "CHECK" }
      )

      const error = await Effect.runPromise(
        Effect.flip(combined.predicate(ctx, combined.params!))
      )
      expect(error).toBeInstanceOf(GuardError)
      expect(error.message).toBe("Guard 'nonExistentGuard' is not implemented.'.")
      expect(error.guard).toBe("nonExistentGuard")
    })

    it("should fail with the not-implemented GuardError for a missing named guard in not()", async () => {
      type Event = { type: "CHECK" }

      // No implementations provided
      const negated = not<unknown, Event>("nonExistentGuard")

      const ctx = createMockGuardContext<unknown, Event>(
        {},
        { type: "CHECK" }
      )

      const error = await Effect.runPromise(
        Effect.flip(negated.predicate(ctx, negated.params!))
      )
      expect(error).toBeInstanceOf(GuardError)
      expect(error.message).toBe("Guard 'nonExistentGuard' is not implemented.'.")
      expect(error.guard).toBe("nonExistentGuard")
    })
  })
})
