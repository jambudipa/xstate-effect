/**
 * Testing utilities tests
 */
import { describe, it, expect, vi } from "vitest"
import { Cause, Effect, Duration, Exit } from "effect"
import {
  makeSimulatedClock,
  makeSimulatedClockEffect,
  SimulatedClock,
  TimeTravelError,
} from "../src/testing/SimulatedClock.js"
import {
  WaitForTimeoutError,
  WaitForTerminatedError,
} from "../src/testing/waitFor.js"
import {
  ActorOutputError,
} from "../src/testing/toPromise.js"

/** The value that `run` throws, or undefined when it returns. */
const thrownBy = (run: () => unknown): unknown => {
  try {
    run()
  } catch (error) {
    return error
  }
  return undefined
}

describe("Testing Utilities", () => {
  describe("SimulatedClock", () => {
    it("should start at time 0", () => {
      const clock = makeSimulatedClock()
      expect(clock.now()).toBe(0)
    })

    it("should increment time", () => {
      const clock = makeSimulatedClock()

      clock.increment(100)
      expect(clock.now()).toBe(100)

      clock.increment(50)
      expect(clock.now()).toBe(150)
    })

    it("should set time to specific value", () => {
      const clock = makeSimulatedClock()

      clock.set(500)
      expect(clock.now()).toBe(500)
    })

    it("should not allow setting time backwards", () => {
      const clock = makeSimulatedClock()

      expect(clock.set(100)).toBe(true)

      expect(clock.set(50)).toBe(false)
      expect(clock.now()).toBe(100)
    })

    it("should schedule and execute timeouts", () => {
      const clock = makeSimulatedClock()
      const callback = vi.fn()

      clock.setTimeout(callback, 100)

      expect(callback).not.toHaveBeenCalled()

      clock.increment(99)
      expect(callback).not.toHaveBeenCalled()

      clock.increment(1)
      expect(callback).toHaveBeenCalledTimes(1)
    })

    it("should execute multiple timeouts in order", () => {
      const clock = makeSimulatedClock()
      const order: number[] = []

      clock.setTimeout(() => order.push(1), 100)
      clock.setTimeout(() => order.push(2), 50)
      clock.setTimeout(() => order.push(3), 150)

      clock.increment(200)

      expect(order).toEqual([2, 1, 3])
    })

    it("should clear timeouts", () => {
      const clock = makeSimulatedClock()
      const callback = vi.fn()

      const id = clock.setTimeout(callback, 100)

      clock.clearTimeout(id)
      clock.increment(200)

      expect(callback).not.toHaveBeenCalled()
    })

    it("should handle timeouts scheduled during callback execution", () => {
      const clock = makeSimulatedClock()
      const order: string[] = []

      clock.setTimeout(() => {
        order.push("first")
        clock.setTimeout(() => order.push("nested"), 50)
      }, 100)

      clock.increment(100)
      expect(order).toEqual(["first"])

      clock.increment(50)
      expect(order).toEqual(["first", "nested"])
    })

    it("should return pending timeouts", () => {
      const clock = makeSimulatedClock()

      clock.setTimeout(() => {}, 100)
      clock.setTimeout(() => {}, 200)

      const pending = clock.getPendingTimeouts()
      expect(pending).toHaveLength(2)
    })

    it("should clear all timeouts", () => {
      const clock = makeSimulatedClock()
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      clock.setTimeout(callback1, 100)
      clock.setTimeout(callback2, 200)

      clock.clearAllTimeouts()
      clock.increment(300)

      expect(callback1).not.toHaveBeenCalled()
      expect(callback2).not.toHaveBeenCalled()
      expect(clock.getPendingTimeouts()).toHaveLength(0)
    })

    it("stays usable after a callback throws: the throw reaches the caller of increment, then a later increment or set fires the due timeouts", () => {
      const clock = makeSimulatedClock()
      const failure = new Error("timeout A failed")
      const fired: Array<string> = []

      clock.setTimeout(() => {
        fired.push("A")
        throw failure
      }, 100)
      clock.setTimeout(() => fired.push("B"), 150)
      clock.setTimeout(() => fired.push("C"), 300)

      // The throw stops the flush where it happens: B is due but does not fire in this call.
      expect(thrownBy(() => clock.increment(150))).toBe(failure)
      expect(fired).toEqual(["A"])
      expect(clock.now()).toBe(150)

      clock.increment(50)
      expect(fired).toEqual(["A", "B"])

      expect(clock.set(300)).toBe(true)
      expect(fired).toEqual(["A", "B", "C"])
      expect(clock.getPendingTimeouts()).toHaveLength(0)
    })

    it("fires inside a callback's increment the timeouts that the increment makes due (DEV-75: upstream fires them after the callback returns)", () => {
      const clock = makeSimulatedClock()
      const order: Array<string> = []

      clock.setTimeout(() => {
        order.push("A starts")
        clock.increment(50)
        order.push("A ends")
      }, 100)
      clock.setTimeout(() => order.push("B"), 150)

      clock.increment(100)
      expect(order).toEqual(["A starts", "B", "A ends"])
      expect(clock.now()).toBe(150)
      expect(clock.getPendingTimeouts()).toHaveLength(0)
    })
  })

  describe("SimulatedClock class", () => {
    it("stays usable after a callback throws: the throw is a defect of increment, then a later increment or set fires the due timers", async () => {
      const clock = new SimulatedClock()
      const failure = new Error("timer A failed")
      const fired: Array<string> = []

      clock.setTimeout(() => {
        fired.push("A")
        throw failure
      }, 100)
      clock.setTimeout(() => fired.push("B"), 150)
      clock.setTimeout(() => fired.push("C"), 300)

      const program = Effect.gen(function* () {
        const exit = yield* Effect.exit(clock.increment(150))
        expect(Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined).toBe(failure)
        expect(fired).toEqual(["A"])
        expect(clock.now()).toBe(150)

        yield* clock.increment(50)
        expect(fired).toEqual(["A", "B"])

        yield* clock.set(300)
        expect(fired).toEqual(["A", "B", "C"])
      })

      await Effect.runPromise(program)
    })
  })

  describe("SimulatedClockEffect", () => {
    it("should work with Effect", async () => {
      const program = Effect.gen(function* () {
        const clock = yield* makeSimulatedClockEffect

        expect(yield* clock.now).toBe(0)

        yield* clock.increment(100)
        expect(yield* clock.now).toBe(100)

        yield* clock.set(500)
        expect(yield* clock.now).toBe(500)
      })

      await Effect.runPromise(program)
    })

    it("should fail with TimeTravelError when set backwards", async () => {
      const program = Effect.gen(function* () {
        const clock = yield* makeSimulatedClockEffect
        yield* clock.set(100)

        const error = yield* Effect.flip(clock.set(50))

        expect(error).toBeInstanceOf(TimeTravelError)
        expect(error.message).toBe("Unable to travel back in time")
        expect(error.from).toBe(100)
        expect(error.to).toBe(50)
        expect(yield* clock.now).toBe(100)
      })

      await Effect.runPromise(program)
    })

    it("should execute timeouts with Effect", async () => {
      const program = Effect.gen(function* () {
        const clock = yield* makeSimulatedClockEffect
        let called = false

        yield* clock.setTimeout(() => {
          called = true
        }, 100)

        expect(called).toBe(false)

        yield* clock.increment(100)

        expect(called).toBe(true)
      })

      await Effect.runPromise(program)
    })
  })

  describe("WaitForTimeoutError", () => {
    it("should create error with timeout message", () => {
      const error = new WaitForTimeoutError({ timeout: 5000 })
      expect(error.message).toBe("Timeout of 5000 ms exceeded")
      expect(error.name).toBe("WaitForTimeoutError")
      expect(error._tag).toBe("WaitForTimeoutError")
    })

    it("should be instanceof Error", () => {
      const error = new WaitForTimeoutError({ timeout: 1000 })
      expect(error).toBeInstanceOf(Error)
    })
  })

  describe("WaitForTerminatedError", () => {
    it("should create error with termination message", () => {
      const error = new WaitForTerminatedError()
      expect(error.message).toBe("Actor terminated without satisfying predicate")
      expect(error.name).toBe("WaitForTerminatedError")
      expect(error._tag).toBe("WaitForTerminatedError")
    })

    it("should be instanceof Error", () => {
      const error = new WaitForTerminatedError()
      expect(error).toBeInstanceOf(Error)
    })
  })

  describe("ActorOutputError", () => {
    it("should create error with cause", () => {
      const cause = new Error("Original error")
      const error = new ActorOutputError({ cause })
      expect(error.message).toBe("Actor errored before producing output")
      expect(error.name).toBe("ActorOutputError")
      expect(error._tag).toBe("ActorOutputError")
      expect(error.cause).toBe(cause)
    })

    it("should be instanceof Error", () => {
      const error = new ActorOutputError({ cause: "some cause" })
      expect(error).toBeInstanceOf(Error)
    })

    it("should handle any cause type", () => {
      const error1 = new ActorOutputError({ cause: { custom: "error" } })
      expect(error1.cause).toEqual({ custom: "error" })

      const error2 = new ActorOutputError({ cause: null })
      expect(error2.cause).toBeNull()

      const error3 = new ActorOutputError({ cause: 42 })
      expect(error3.cause).toBe(42)
    })
  })
})
