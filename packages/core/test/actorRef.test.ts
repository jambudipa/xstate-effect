/**
 * ActorRef tests
 */
import { describe, it, expect } from "vitest"
import { Effect, Fiber, Option, Stream, SubscriptionRef } from "effect"
import {
  ActorRefTypeId,
  isActorRef,
  getId,
  equals,
  isChildOf,
  sendUntyped,
  toSnapshotStream,
} from "../src/ActorRef.js"
import type { AnyActorRef } from "../src/ActorRef.js"

// The one system the mock references belong to, as the actors of one root do: a session id
// is unique only within its system (SD-9, SD-25)
const mockSystem = {} as any

// Helper to create a mock actor reference: an `AnyActorRef`, as an actor's parent is
// (upstream `_parent?: AnyActorRef`)
const createMockActorRef = (overrides: Partial<AnyActorRef> = {}): AnyActorRef => ({
  [ActorRefTypeId]: {},
  id: "test-actor",
  sessionId: "session-123",
  src: "testActor",
  send: () => Effect.void,
  sendUntyped: () => Effect.void,
  getSnapshot: Effect.succeed({ status: "active", output: undefined, error: undefined }),
  getSnapshotUntyped: Effect.succeed({ status: "active", output: undefined, error: undefined }),
  getPersistedSnapshot: Effect.succeed({}),
  _parent: Option.none(),
  _system: mockSystem,
  pipe: ((...args: any[]) => {}) as any,
  toJSON: () => ({}),
  [Symbol.for("nodejs.util.inspect.custom")]: () => "MockActorRef",
  ...overrides,
} as AnyActorRef)

describe("ActorRef", () => {
  describe("isActorRef", () => {
    it("should return true for objects with ActorRefTypeId", () => {
      const ref = createMockActorRef()
      expect(isActorRef(ref)).toBe(true)
    })

    it("should return false for non-ActorRef objects", () => {
      expect(isActorRef({})).toBe(false)
      expect(isActorRef(null)).toBe(false)
      expect(isActorRef("string")).toBe(false)
      expect(isActorRef(123)).toBe(false)
      expect(isActorRef({ id: "test" })).toBe(false)
    })
  })

  describe("getId", () => {
    it("should return ID from ActorRef", () => {
      const ref = createMockActorRef({ id: "my-actor" })
      expect(getId(ref)).toBe("my-actor")
    })

    it("should return string ID as-is", () => {
      expect(getId("actor-id")).toBe("actor-id")
    })
  })

  describe("equals", () => {
    it("should return true for refs with same sessionId", () => {
      const ref1 = createMockActorRef({ sessionId: "session-abc" })
      const ref2 = createMockActorRef({ sessionId: "session-abc" })
      expect(equals(ref1, ref2)).toBe(true)
    })

    it("should return false for refs with different sessionId", () => {
      const ref1 = createMockActorRef({ sessionId: "session-abc" })
      const ref2 = createMockActorRef({ sessionId: "session-xyz" })
      expect(equals(ref1, ref2)).toBe(false)
    })

    it("should work with same ref", () => {
      const ref = createMockActorRef()
      expect(equals(ref, ref)).toBe(true)
    })

    it("should return false for refs with same sessionId in two systems", () => {
      const ref1 = createMockActorRef({ sessionId: "x:0" })
      const ref2 = createMockActorRef({ sessionId: "x:0", _system: {} as any })
      expect(equals(ref1, ref2)).toBe(false)
    })
  })

  describe("isChildOf", () => {
    it("should return true when child has parent", async () => {
      const parent = createMockActorRef({ id: "parent", sessionId: "parent-session" })
      const child = createMockActorRef({
        id: "child",
        sessionId: "child-session",
        _parent: Option.some(parent),
      })

      const result = await Effect.runPromise(isChildOf(child, parent))
      expect(result).toBe(true)
    })

    it("should return false when child has different parent", async () => {
      const parent1 = createMockActorRef({ id: "parent1", sessionId: "parent1-session" })
      const parent2 = createMockActorRef({ id: "parent2", sessionId: "parent2-session" })
      const child = createMockActorRef({
        id: "child",
        sessionId: "child-session",
        _parent: Option.some(parent1),
      })

      const result = await Effect.runPromise(isChildOf(child, parent2))
      expect(result).toBe(false)
    })

    it("should return false when child has no parent", async () => {
      const parent = createMockActorRef({ id: "parent", sessionId: "parent-session" })
      const child = createMockActorRef({
        id: "child",
        sessionId: "child-session",
        _parent: Option.none(),
      })

      const result = await Effect.runPromise(isChildOf(child, parent))
      expect(result).toBe(false)
    })
  })

  describe("sendUntyped", () => {
    it("should call sendUntyped on the ref", async () => {
      let sentEvent: any = null
      const ref = createMockActorRef({
        sendUntyped: (event) => {
          sentEvent = event
          return Effect.void
        },
      })

      await Effect.runPromise(sendUntyped(ref, { type: "TEST_EVENT" }))
      expect(sentEvent).toEqual({ type: "TEST_EVENT" })
    })
  })

  describe("toSnapshotStream", () => {
    it("should create a SnapshotStream from SubscriptionRef", async () => {
      const program = Effect.gen(function* () {
        const ref = yield* SubscriptionRef.make({ count: 0 })
        const stream = toSnapshotStream(ref)

        // Get current value
        const current = yield* stream.get
        expect(current).toEqual({ count: 0 })

        return current
      }).pipe(Effect.scoped)

      await Effect.runPromise(program)
    })

    it("should provide changes stream", async () => {
      const program = Effect.gen(function* () {
        const ref = yield* SubscriptionRef.make({ count: 0 })
        const stream = toSnapshotStream(ref)

        // Update the ref
        yield* SubscriptionRef.set(ref, { count: 1 })

        // Get updated value
        const current = yield* stream.get
        expect(current).toEqual({ count: 1 })

        return true
      }).pipe(Effect.scoped)

      await Effect.runPromise(program)
    })

    it("should give changes after the current value only", async () => {
      const program = Effect.gen(function* () {
        const ref = yield* SubscriptionRef.make(0)
        const snapshotStream = toSnapshotStream(ref)

        // The stream runs before the update, so the current value would come first
        const fiber = yield* Effect.forkChild(Stream.runCollect(Stream.take(snapshotStream.changes, 2)), {
          startImmediately: true,
        })
        yield* SubscriptionRef.set(ref, 1)
        yield* SubscriptionRef.set(ref, 2)

        return yield* Fiber.join(fiber)
      }).pipe(Effect.scoped)

      expect(await Effect.runPromise(program)).toEqual([1, 2])
    })

    it("should provide stream starting with current value", async () => {
      const program = Effect.gen(function* () {
        const ref = yield* SubscriptionRef.make("initial")
        const snapshotStream = toSnapshotStream(ref)

        // Take first value from stream
        const first = yield* Stream.runHead(snapshotStream.stream)

        expect(Option.isSome(first)).toBe(true)
        expect(Option.getOrNull(first)).toBe("initial")

        return true
      }).pipe(Effect.scoped)

      await Effect.runPromise(program)
    })
  })

  describe("ActorRef properties", () => {
    it("should have required base properties", () => {
      const ref = createMockActorRef({
        id: "my-actor",
        sessionId: "my-session",
        src: "myLogic",
      })

      expect(ref.id).toBe("my-actor")
      expect(ref.sessionId).toBe("my-session")
      expect(ref.src).toBe("myLogic")
    })

    it("should have parent as Option", () => {
      const withoutParent = createMockActorRef({ _parent: Option.none() })
      expect(Option.isNone(withoutParent._parent)).toBe(true)

      const parent = createMockActorRef()
      const withParent = createMockActorRef({ _parent: Option.some(parent) })
      expect(Option.isSome(withParent._parent)).toBe(true)
    })
  })
})
