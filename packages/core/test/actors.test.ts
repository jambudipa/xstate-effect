/**
 * Actor logic tests
 */
import { describe, it, expect, vi } from "vitest"
import { Effect, Deferred, Fiber, Option } from "effect"
import {
  fromPromise,
  fromCallback,
  fromTransition,
  fromEffect,
  fromObservable,
  fromStream,
} from "../src/index.js"
import { Cause, Queue, Stream } from "effect"
import { createActor } from "../src/Actor.js"
import { getInitialSnapshot } from "../src/testing/index.js"

/** The actor's snapshot once it is no longer active, after at most 200 yields. */
const settled = <S extends { readonly status: string }>(actor: { readonly getSnapshot: Effect.Effect<S> }) =>
  Effect.gen(function* () {
    for (let turn = 0; turn < 200; turn++) {
      const snapshot = yield* actor.getSnapshot
      if (snapshot.status !== "active") {
        return snapshot
      }
      yield* Effect.yieldNow
    }
    return yield* actor.getSnapshot
  })

describe("Actor Logic", () => {
  describe("fromPromise", () => {
    it("should create actor logic from promise", async () => {
      const fetchUser = fromPromise(({ input }: { input: { userId: string } }) =>
        Promise.resolve({ id: input.userId, name: "John" })
      )

      expect(fetchUser).toBeDefined()
    })

    // The promise runs once the actor starts, not in getInitialSnapshot (D12, C6, SD-20)
    it("should resolve with output", async () => {
      const fetchData = fromPromise(() =>
        Promise.resolve({ data: "test" })
      )

      const snapshot = await Effect.runPromise(
        Effect.scoped(Effect.gen(function* () {
          const actor = yield* createActor(fetchData)
          yield* actor.start
          return yield* settled(actor)
        }))
      )

      expect(snapshot.status).toBe("done")
      expect(Option.isSome(snapshot.output)).toBe(true)
      expect(Option.getOrThrow(snapshot.output)).toEqual({ data: "test" })
    })

    it("should handle promise rejection", async () => {
      const failingFetch = fromPromise(() =>
        Promise.reject(new Error("Network error"))
      )

      const snapshot = await Effect.runPromise(
        Effect.scoped(Effect.gen(function* () {
          const actor = yield* createActor(failingFetch)
          // A consumer of `changes` is an error listener, so the error is not reported (SD-21)
          yield* Effect.forkScoped(Effect.ignore(Stream.runDrain(actor.changes)), { startImmediately: true })
          yield* actor.start
          return yield* settled(actor)
        }))
      )

      expect(snapshot.status).toBe("error")
      expect(Option.isSome(snapshot.error)).toBe(true)
      expect(Option.getOrThrow(snapshot.error)).toBeInstanceOf(Error)
    })

    it("should pass input to promise creator", async () => {
      const fetchById = fromPromise(({ input }: { input: number }) =>
        Promise.resolve({ id: input, found: true })
      )

      const snapshot = await Effect.runPromise(
        Effect.scoped(Effect.gen(function* () {
          const actor = yield* createActor(fetchById, { input: 42 })
          yield* actor.start
          return yield* settled(actor)
        }))
      )

      expect(snapshot.status).toBe("done")
      expect(Option.isSome(snapshot.output)).toBe(true)
      expect(Option.getOrThrow(snapshot.output)).toEqual({ id: 42, found: true })
    })
  })

  describe("fromCallback", () => {
    it("should create actor logic from callback", () => {
      const timerActor = fromCallback(({ sendBack }) => {
        const interval = setInterval(() => {
          sendBack({ type: "TICK" })
        }, 1000)

        return () => clearInterval(interval)
      })

      expect(timerActor).toBeDefined()
    })

    it("should handle receive for incoming events", () => {
      const echoActor = fromCallback<{ type: "ECHO"; text: string }, { message: string }>(
        ({ receive, sendBack }) => {
          receive((event) => {
            if (event.type === "ECHO") {
              sendBack({ type: "RESPONSE", text: event.text })
            }
          })
        }
      )

      expect(echoActor).toBeDefined()
    })

    it("should clean up on stop", () => {
      const cleanup = vi.fn()

      const actor = fromCallback(() => {
        return cleanup
      })

      expect(actor).toBeDefined()
      // Cleanup would be called when actor stops
    })
  })

  describe("fromTransition", () => {
    it("should create actor logic from transition function", () => {
      interface State {
        count: number
      }

      type Event = { type: "INCREMENT" } | { type: "DECREMENT" }

      const counterActor = fromTransition<State, Event>(
        (state, event) => {
          switch (event.type) {
            case "INCREMENT":
              return { count: state.count + 1 }
            case "DECREMENT":
              return { count: state.count - 1 }
            default:
              return state
          }
        },
        { count: 0 }
      )

      expect(counterActor).toBeDefined()
    })

    it("should get initial snapshot with default state", async () => {
      interface State {
        value: string
      }

      const actor = fromTransition<State, { type: "SET"; value: string }>(
        (state, event) => {
          if (event.type === "SET") {
            return { value: event.value }
          }
          return state
        },
        { value: "initial" }
      )

      const snapshot = await Effect.runPromise(
        getInitialSnapshot(actor, undefined)
      )

      expect(snapshot.context).toEqual({ value: "initial" })
    })
  })

  describe("fromEffect", () => {
    // The effect runs once the actor starts, not in getInitialSnapshot (D12, C10, SD-20)
    it("should create actor logic from Effect", async () => {
      const effectActor = fromEffect(({ input }: { input: number }) =>
        Effect.succeed(input * 2)
      )

      const snapshot = await Effect.runPromise(
        Effect.scoped(Effect.gen(function* () {
          const actor = yield* createActor(effectActor, { input: 21 })
          yield* actor.start
          return yield* settled(actor)
        }))
      )

      expect(snapshot.status).toBe("done")
      expect(Option.isSome(snapshot.output)).toBe(true)
      expect(Option.getOrThrow(snapshot.output)).toBe(42)
    })

    it("should handle Effect failures", async () => {
      const failingActor = fromEffect(() =>
        Effect.fail(new Error("Effect failed"))
      )

      const snapshot = await Effect.runPromise(
        Effect.scoped(Effect.gen(function* () {
          const actor = yield* createActor(failingActor)
          // A consumer of `changes` is an error listener, so the error is not reported (SD-21)
          yield* Effect.forkScoped(Effect.ignore(Stream.runDrain(actor.changes)), { startImmediately: true })
          yield* actor.start
          return yield* settled(actor)
        }))
      )

      expect(snapshot.status).toBe("error")
      expect(Option.getOrThrow(snapshot.error)).toBeInstanceOf(Error)
    })

    it("should support Effect composition", async () => {
      const composedActor = fromEffect(({ input }: { input: string }) =>
        Effect.gen(function* () {
          const uppercased = input.toUpperCase()
          yield* Effect.yieldNow // Simulate async
          return { result: uppercased, length: uppercased.length }
        })
      )

      const snapshot = await Effect.runPromise(
        Effect.scoped(Effect.gen(function* () {
          const actor = yield* createActor(composedActor, { input: "hello" })
          yield* actor.start
          return yield* settled(actor)
        }))
      )

      expect(snapshot.status).toBe("done")
      expect(Option.isSome(snapshot.output)).toBe(true)
      expect(Option.getOrThrow(snapshot.output)).toEqual({ result: "HELLO", length: 5 })
    })

    it("should provide self and system to effect creator", async () => {
      const actorWithAccess = fromEffect(({ self, system }) =>
        Effect.succeed({
          hasSelf: self !== undefined,
          hasSystem: system !== undefined,
        })
      )

      const snapshot = await Effect.runPromise(
        Effect.scoped(Effect.gen(function* () {
          const actor = yield* createActor(actorWithAccess)
          yield* actor.start
          return yield* settled(actor)
        }))
      )

      expect(Option.isSome(snapshot.output)).toBe(true)
      expect(Option.getOrThrow(snapshot.output)).toEqual({
        hasSelf: true,
        hasSystem: true,
      })
    })

    it("should give an active initial snapshot with the input and run nothing", async () => {
      let runs = 0
      const effectActor = fromEffect(({ input }: { input: number }) =>
        Effect.sync(() => {
          runs++
          return input
        })
      )

      const snapshot = await Effect.runPromise(getInitialSnapshot(effectActor, 21))

      expect(snapshot.status).toBe("active")
      expect(snapshot.input).toBe(21)
      expect(Option.isNone(snapshot.output)).toBe(true)
      expect(runs).toBe(0)
    })

    // AC 4: a live effect actor starts without blocking, delivers its value to the snapshot,
    // and is interrupted when it stops (C10, D12)
    describe("as a live actor (AC 4)", () => {
      it("starts without blocking the caller while its effect runs", async () => {
        const snapshot = await Effect.runPromise(
          Effect.scoped(Effect.gen(function* () {
            const gate = yield* Deferred.make<number>()
            const actor = yield* createActor(fromEffect(() => Deferred.await(gate)))
            // The effect waits for the gate, which never opens: `start` must return while it waits
            yield* actor.start
            return yield* actor.getSnapshot
          }))
        )

        expect(snapshot.status).toBe("active")
        expect(Option.isNone(snapshot.output)).toBe(true)
      })

      it("delivers its value to the actor snapshot and is done when the effect succeeds", async () => {
        const result = await Effect.runPromise(
          Effect.scoped(Effect.gen(function* () {
            const gate = yield* Deferred.make<number>()
            const actor = yield* createActor(fromEffect(({ input }: { input: number }) =>
              Effect.map(Deferred.await(gate), (value) => value + input)
            ), { input: 1 })
            yield* actor.start
            const before = yield* actor.getSnapshot
            yield* Deferred.succeed(gate, 41)
            return { before, after: yield* settled(actor) }
          }))
        )

        expect(result.before.status).toBe("active")
        expect(result.after.status).toBe("done")
        expect(result.after.output).toEqual(Option.some(42))
      })

      it("is interrupted when its actor stops", async () => {
        let interrupted = 0
        let finalized = 0
        const result = await Effect.runPromise(
          Effect.scoped(Effect.gen(function* () {
            const gate = yield* Deferred.make<number>()
            const actor = yield* createActor(
              fromEffect(() =>
                Deferred.await(gate).pipe(
                  Effect.onInterrupt(() => Effect.sync(() => {
                    interrupted++
                  })),
                  Effect.ensuring(Effect.sync(() => {
                    finalized++
                  }))
                )
              )
            )
            yield* actor.start
            yield* Effect.yieldNow
            yield* actor.stop
            const atStop = { interrupted, finalized }
            // A value that arrives after the stop reaches no snapshot
            yield* Deferred.succeed(gate, 42)
            for (let turn = 0; turn < 20; turn++) {
              yield* Effect.yieldNow
            }
            return { atStop, snapshot: yield* actor.getSnapshot }
          }))
        )

        expect(result.atStop).toEqual({ interrupted: 1, finalized: 1 })
        expect(finalized).toBe(1)
        expect(result.snapshot.status).toBe("stopped")
        expect(Option.isNone(result.snapshot.output)).toBe(true)
      })
    })
  })

  describe("actor type guards", () => {
    it("should identify different actor types", () => {
      const promiseActor = fromPromise(() => Promise.resolve(1))
      const callbackActor = fromCallback(() => {})
      const transitionActor = fromTransition((s) => s, {})
      const effectActor = fromEffect(() => Effect.succeed(1))

      // All should be valid actor logic
      expect(promiseActor.transition).toBeDefined()
      expect(callbackActor.transition).toBeDefined()
      expect(transitionActor.transition).toBeDefined()
      expect(effectActor.transition).toBeDefined()
    })
  })

  describe("fromObservable", () => {
    it("should create actor logic from observable", () => {
      // Create a simple mock observable
      const createMockObservable = () => ({
        subscribe: (observer: { next?: (value: number) => void; error?: (err: unknown) => void; complete?: () => void }) => {
          // Emit some values
          observer.next?.(1)
          observer.next?.(2)
          observer.complete?.()
          return { unsubscribe: () => {} }
        }
      })

      const observableActor = fromObservable(() => createMockObservable())

      expect(observableActor).toBeDefined()
      expect(observableActor.transition).toBeDefined()
      expect(observableActor.getInitialSnapshot).toBeDefined()
      expect(observableActor.start).toBeDefined()
    })

    it("should get initial snapshot with active status", async () => {
      const observableActor = fromObservable<string, number>(() => ({
        subscribe: () => ({ unsubscribe: () => {} })
      }))

      // A logic reads the ActorScope service; the testing getInitialSnapshot provides an inert one (DEV-45, D6)
      const snapshot = await Effect.runPromise(
        getInitialSnapshot(observableActor, 42)
      )

      expect(snapshot.status).toBe("active")
      expect(Option.isNone(snapshot.context)).toBe(true)
      expect(snapshot.input).toBe(42)
    })

    it("should pass input to observable creator", async () => {
      let receivedInput: number | undefined

      const observableActor = fromObservable<string, number>(({ input }) => {
        receivedInput = input
        return {
          subscribe: () => ({ unsubscribe: () => {} })
        }
      })

      // Get initial snapshot to verify input handling
      // A logic reads the ActorScope service; the testing getInitialSnapshot provides an inert one (DEV-45, D6)
      const snapshot = await Effect.runPromise(
        getInitialSnapshot(observableActor, 123)
      )

      expect(snapshot.input).toBe(123)
    })

    it("should provide self and system to observable creator", () => {
      let hasSelf = false
      let hasSystem = false

      const observableActor = fromObservable(({ self, system }) => {
        hasSelf = self !== undefined
        hasSystem = system !== undefined
        return {
          subscribe: () => ({ unsubscribe: () => {} })
        }
      })

      expect(observableActor).toBeDefined()
    })

    it("should persist snapshot correctly", async () => {
      const observableActor = fromObservable<string, { id: string }>(() => ({
        subscribe: () => ({ unsubscribe: () => {} })
      }))

      // A logic reads the ActorScope service; the testing getInitialSnapshot provides an inert one (DEV-45, D6)
      const initialSnapshot = await Effect.runPromise(
        getInitialSnapshot(observableActor, { id: "test-123" })
      )

      // The persisted form is the codec's encoding, typed unknown (SD-7, DEV-11)
      const persisted = (await Effect.runPromise(
        observableActor.getPersistedSnapshot(initialSnapshot)
      )) as { readonly status: string; readonly input: unknown }

      expect(persisted.status).toBe("active")
      expect(persisted.input).toEqual({ id: "test-123" })
    })
  })

  describe("fromStream", () => {
    it("should create actor logic from Effect Stream", () => {
      const streamActor = fromStream(() =>
        Stream.fromIterable([1, 2, 3])
      )

      expect(streamActor).toBeDefined()
      expect(streamActor.transition).toBeDefined()
      expect(streamActor.getInitialSnapshot).toBeDefined()
      expect(streamActor.start).toBeDefined()
    })

    it("should get initial snapshot with active status", async () => {
      const streamActor = fromStream<number, string, never, never>(() =>
        Stream.fromIterable(["a", "b", "c"])
      )

      // A logic reads the ActorScope service; the testing getInitialSnapshot provides an inert one (DEV-45, D6)
      const snapshot = await Effect.runPromise(
        getInitialSnapshot(streamActor, 42)
      )

      expect(snapshot.status).toBe("active")
      expect(Option.isNone(snapshot.context)).toBe(true)
      expect(snapshot.input).toBe(42)
    })

    it("should pass input to stream creator", async () => {
      const streamActor = fromStream<{ count: number }, number, never, never>(({ input }) =>
        Stream.fromIterable(Array.from({ length: input.count }, (_, i) => i))
      )

      // A logic reads the ActorScope service; the testing getInitialSnapshot provides an inert one (DEV-45, D6)
      const snapshot = await Effect.runPromise(
        getInitialSnapshot(streamActor, { count: 5 })
      )

      expect(snapshot.input).toEqual({ count: 5 })
    })

    it("should provide self and system to stream creator", () => {
      let hasSelf = false
      let hasSystem = false

      const streamActor = fromStream(({ self, system }) => {
        hasSelf = self !== undefined
        hasSystem = system !== undefined
        return Stream.empty
      })

      expect(streamActor).toBeDefined()
    })

    it("should persist snapshot correctly", async () => {
      const streamActor = fromStream<{ label: string }, number, never, never>(() =>
        Stream.fromIterable([1, 2, 3])
      )

      // A logic reads the ActorScope service; the testing getInitialSnapshot provides an inert one (DEV-45, D6)
      const initialSnapshot = await Effect.runPromise(
        getInitialSnapshot(streamActor, { label: "my-stream" })
      )

      // The persisted form is the codec's encoding, typed unknown (SD-7, DEV-11)
      const persisted = (await Effect.runPromise(
        streamActor.getPersistedSnapshot(initialSnapshot)
      )) as { readonly status: string; readonly input: unknown }

      expect(persisted.status).toBe("active")
      expect(persisted.input).toEqual({ label: "my-stream" })
    })

    it("should handle streams with errors", () => {
      const streamActor = fromStream(() =>
        Stream.fail(new Error("Stream error"))
      )

      expect(streamActor).toBeDefined()
    })

    // AC 4: a live stream actor starts without blocking, delivers its elements to the
    // snapshot, and is interrupted when it stops (C8, D12)
    describe("as a live actor (AC 4)", () => {
      /** Yields until the actor's context is `Some(value)`, at most 200 times; gives whether it is. */
      const untilContext = (actor: { readonly getSnapshot: Effect.Effect<{ readonly context: Option.Option<number> }> }, value: number) =>
        Effect.gen(function* () {
          for (let turn = 0; turn < 200; turn++) {
            if (Option.contains((yield* actor.getSnapshot).context, value)) {
              return true
            }
            yield* Effect.yieldNow
          }
          return false
        })

      it("starts without blocking the caller while its stream runs", async () => {
        const snapshot = await Effect.runPromise(
          Effect.scoped(Effect.gen(function* () {
            const queue = yield* Queue.unbounded<number, Cause.Done>()
            const actor = yield* createActor(fromStream(() => Stream.fromQueue(queue)))
            // The stream never ends on its own: `start` must return while it waits
            yield* actor.start
            return yield* actor.getSnapshot
          }))
        )

        expect(snapshot.status).toBe("active")
        expect(Option.isNone(snapshot.context)).toBe(true)
      })

      it("delivers each element to the actor snapshot and is done when the stream ends", async () => {
        const result = await Effect.runPromise(
          Effect.scoped(Effect.gen(function* () {
            const queue = yield* Queue.unbounded<number, Cause.Done>()
            const actor = yield* createActor(fromStream(() => Stream.fromQueue(queue)))
            yield* actor.start
            const reached: Array<boolean> = []
            for (const value of [1, 2, 3]) {
              yield* Queue.offer(queue, value)
              reached.push(yield* untilContext(actor, value))
            }
            yield* Queue.end(queue)
            return { reached, snapshot: yield* settled(actor) }
          }))
        )

        expect(result.reached).toEqual([true, true, true])
        expect(result.snapshot.status).toBe("done")
        expect(result.snapshot.context).toEqual(Option.some(3))
        expect(Option.isNone(result.snapshot.output)).toBe(true)
      })

      it("is interrupted when its actor stops", async () => {
        let finalized = 0
        const result = await Effect.runPromise(
          Effect.scoped(Effect.gen(function* () {
            const queue = yield* Queue.unbounded<number, Cause.Done>()
            const actor = yield* createActor(
              fromStream(() =>
                Stream.fromQueue(queue).pipe(
                  Stream.ensuring(Effect.sync(() => {
                    finalized++
                  }))
                )
              )
            )
            yield* actor.start
            yield* Queue.offer(queue, 1)
            const reached = yield* untilContext(actor, 1)
            yield* actor.stop
            const finalizedAtStop = finalized
            // An element offered after the stop reaches no snapshot
            yield* Queue.offer(queue, 2)
            for (let turn = 0; turn < 20; turn++) {
              yield* Effect.yieldNow
            }
            return { reached, finalizedAtStop, snapshot: yield* actor.getSnapshot }
          }))
        )

        expect(result.reached).toBe(true)
        expect(result.finalizedAtStop).toBe(1)
        expect(finalized).toBe(1)
        expect(result.snapshot.status).toBe("stopped")
        expect(result.snapshot.context).toEqual(Option.some(1))
      })
    })
  })
})
