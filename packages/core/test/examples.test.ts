/**
 * Examples Tests
 *
 * Tests for all example state machines demonstrating
 * the effect-first XState implementation. The pure transition functions come from the root
 * entry point, as upstream's do (they return Effects, SD-13).
 */
import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import { getInitialSnapshot, getNextSnapshot } from "../src/index.js"

// Import all examples
import {
  counterMachine,
  toggleMachine,
  toggleWithCountMachine,
  stopwatchMachine,
  simpleStopwatchMachine,
  fetchMachine,
  simpleFetchMachine,
} from "../examples/index.js"

describe("Examples", () => {
  // ============================================================
  // COUNTER EXAMPLE
  // ============================================================
  describe("Counter Machine", () => {
    it("should have correct initial state", async () => {
      const snapshot = await Effect.runPromise(
        getInitialSnapshot(counterMachine, undefined)
      )

      expect(snapshot.value).toBe("active")
      expect(snapshot.context.count).toBe(0)
      expect(snapshot.status).toBe("active")
    })

    it("should increment count", async () => {
      const initial = await Effect.runPromise(
        getInitialSnapshot(counterMachine, undefined)
      )

      const after = await Effect.runPromise(
        getNextSnapshot(counterMachine, initial, { type: "increment" })
      )

      expect(after.context.count).toBe(1)
    })

    it("should decrement count", async () => {
      const initial = await Effect.runPromise(
        getInitialSnapshot(counterMachine, undefined)
      )

      // First increment to 1
      const afterInc = await Effect.runPromise(
        getNextSnapshot(counterMachine, initial, { type: "increment" })
      )

      // Then decrement
      const afterDec = await Effect.runPromise(
        getNextSnapshot(counterMachine, afterInc, { type: "decrement" })
      )

      expect(afterDec.context.count).toBe(0)
    })

    it("should handle multiple increments", async () => {
      let snapshot = await Effect.runPromise(
        getInitialSnapshot(counterMachine, undefined)
      )

      // Increment 5 times
      for (let i = 0; i < 5; i++) {
        snapshot = await Effect.runPromise(
          getNextSnapshot(counterMachine, snapshot, { type: "increment" })
        )
      }

      expect(snapshot.context.count).toBe(5)
    })

    it("should reset count to zero", async () => {
      let snapshot = await Effect.runPromise(
        getInitialSnapshot(counterMachine, undefined)
      )

      // Increment to 3
      for (let i = 0; i < 3; i++) {
        snapshot = await Effect.runPromise(
          getNextSnapshot(counterMachine, snapshot, { type: "increment" })
        )
      }

      expect(snapshot.context.count).toBe(3)

      // Reset
      snapshot = await Effect.runPromise(
        getNextSnapshot(counterMachine, snapshot, { type: "reset" })
      )

      expect(snapshot.context.count).toBe(0)
    })

    it("should set count to specific value", async () => {
      const initial = await Effect.runPromise(
        getInitialSnapshot(counterMachine, undefined)
      )

      const after = await Effect.runPromise(
        getNextSnapshot(counterMachine, initial, { type: "set", value: 42 })
      )

      expect(after.context.count).toBe(42)
    })

    it("should handle negative counts", async () => {
      const initial = await Effect.runPromise(
        getInitialSnapshot(counterMachine, undefined)
      )

      // Decrement from 0
      const after = await Effect.runPromise(
        getNextSnapshot(counterMachine, initial, { type: "decrement" })
      )

      expect(after.context.count).toBe(-1)
    })
  })

  // ============================================================
  // TOGGLE EXAMPLE
  // ============================================================
  describe("Toggle Machine", () => {
    it("should have correct initial state", async () => {
      const snapshot = await Effect.runPromise(
        getInitialSnapshot(toggleMachine, undefined)
      )

      expect(snapshot.value).toBe("inactive")
      expect(snapshot.status).toBe("active")
    })

    it("should toggle from inactive to active", async () => {
      const initial = await Effect.runPromise(
        getInitialSnapshot(toggleMachine, undefined)
      )

      expect(initial.value).toBe("inactive")

      const toggled = await Effect.runPromise(
        getNextSnapshot(toggleMachine, initial, { type: "toggle" })
      )

      expect(toggled.value).toBe("active")
    })

    it("should toggle from active to inactive", async () => {
      let snapshot = await Effect.runPromise(
        getInitialSnapshot(toggleMachine, undefined)
      )

      // Toggle to active
      snapshot = await Effect.runPromise(
        getNextSnapshot(toggleMachine, snapshot, { type: "toggle" })
      )
      expect(snapshot.value).toBe("active")

      // Toggle back to inactive
      snapshot = await Effect.runPromise(
        getNextSnapshot(toggleMachine, snapshot, { type: "toggle" })
      )
      expect(snapshot.value).toBe("inactive")
    })

    it("should toggle multiple times", async () => {
      let snapshot = await Effect.runPromise(
        getInitialSnapshot(toggleMachine, undefined)
      )

      const expectedStates = ["active", "inactive", "active", "inactive", "active"]

      for (const expectedState of expectedStates) {
        snapshot = await Effect.runPromise(
          getNextSnapshot(toggleMachine, snapshot, { type: "toggle" })
        )
        expect(snapshot.value).toBe(expectedState)
      }
    })
  })

  describe("Toggle With Count Machine", () => {
    it("should have correct initial state", async () => {
      const snapshot = await Effect.runPromise(
        getInitialSnapshot(toggleWithCountMachine, undefined)
      )

      expect(snapshot.value).toBe("inactive")
      expect(snapshot.context.toggleCount).toBe(0)
    })

    it("should toggle states", async () => {
      const initial = await Effect.runPromise(
        getInitialSnapshot(toggleWithCountMachine, undefined)
      )

      const toggled = await Effect.runPromise(
        getNextSnapshot(toggleWithCountMachine, initial, { type: "toggle" })
      )

      expect(toggled.value).toBe("active")
    })

    it("should reset to inactive", async () => {
      let snapshot = await Effect.runPromise(
        getInitialSnapshot(toggleWithCountMachine, undefined)
      )

      // Toggle to active
      snapshot = await Effect.runPromise(
        getNextSnapshot(toggleWithCountMachine, snapshot, { type: "toggle" })
      )
      expect(snapshot.value).toBe("active")

      // Reset
      snapshot = await Effect.runPromise(
        getNextSnapshot(toggleWithCountMachine, snapshot, { type: "reset" })
      )
      expect(snapshot.value).toBe("inactive")
    })
  })

  // ============================================================
  // STOPWATCH EXAMPLE
  // ============================================================
  describe("Stopwatch Machine", () => {
    it("should have correct initial state", async () => {
      const snapshot = await Effect.runPromise(
        getInitialSnapshot(stopwatchMachine, undefined)
      )

      expect(snapshot.value).toBe("stopped")
      expect(snapshot.context.elapsed).toBe(0)
    })

    it("should start from stopped state", async () => {
      const initial = await Effect.runPromise(
        getInitialSnapshot(stopwatchMachine, undefined)
      )

      const running = await Effect.runPromise(
        getNextSnapshot(stopwatchMachine, initial, { type: "start" })
      )

      expect(running.value).toBe("running")
    })

    it("should increment elapsed on TICK", async () => {
      let snapshot = await Effect.runPromise(
        getInitialSnapshot(stopwatchMachine, undefined)
      )

      // Start
      snapshot = await Effect.runPromise(
        getNextSnapshot(stopwatchMachine, snapshot, { type: "start" })
      )

      // Tick
      snapshot = await Effect.runPromise(
        getNextSnapshot(stopwatchMachine, snapshot, { type: "TICK" })
      )

      expect(snapshot.context.elapsed).toBe(1)
    })

    it("should handle multiple ticks", async () => {
      let snapshot = await Effect.runPromise(
        getInitialSnapshot(stopwatchMachine, undefined)
      )

      // Start
      snapshot = await Effect.runPromise(
        getNextSnapshot(stopwatchMachine, snapshot, { type: "start" })
      )

      // 10 ticks
      for (let i = 0; i < 10; i++) {
        snapshot = await Effect.runPromise(
          getNextSnapshot(stopwatchMachine, snapshot, { type: "TICK" })
        )
      }

      expect(snapshot.context.elapsed).toBe(10)
    })

    it("should stop from running state", async () => {
      let snapshot = await Effect.runPromise(
        getInitialSnapshot(stopwatchMachine, undefined)
      )

      // Start
      snapshot = await Effect.runPromise(
        getNextSnapshot(stopwatchMachine, snapshot, { type: "start" })
      )

      // Some ticks
      for (let i = 0; i < 5; i++) {
        snapshot = await Effect.runPromise(
          getNextSnapshot(stopwatchMachine, snapshot, { type: "TICK" })
        )
      }

      // Stop
      snapshot = await Effect.runPromise(
        getNextSnapshot(stopwatchMachine, snapshot, { type: "stop" })
      )

      expect(snapshot.value).toBe("stopped")
      expect(snapshot.context.elapsed).toBe(5) // Preserves elapsed time
    })

    it("should pause from running state", async () => {
      let snapshot = await Effect.runPromise(
        getInitialSnapshot(stopwatchMachine, undefined)
      )

      // Start
      snapshot = await Effect.runPromise(
        getNextSnapshot(stopwatchMachine, snapshot, { type: "start" })
      )

      // Some ticks
      for (let i = 0; i < 3; i++) {
        snapshot = await Effect.runPromise(
          getNextSnapshot(stopwatchMachine, snapshot, { type: "TICK" })
        )
      }

      // Pause
      snapshot = await Effect.runPromise(
        getNextSnapshot(stopwatchMachine, snapshot, { type: "pause" })
      )

      expect(snapshot.value).toBe("paused")
      expect(snapshot.context.elapsed).toBe(3)
    })

    it("should resume from paused state", async () => {
      let snapshot = await Effect.runPromise(
        getInitialSnapshot(stopwatchMachine, undefined)
      )

      // Start -> tick -> pause
      snapshot = await Effect.runPromise(
        getNextSnapshot(stopwatchMachine, snapshot, { type: "start" })
      )
      snapshot = await Effect.runPromise(
        getNextSnapshot(stopwatchMachine, snapshot, { type: "TICK" })
      )
      snapshot = await Effect.runPromise(
        getNextSnapshot(stopwatchMachine, snapshot, { type: "pause" })
      )

      expect(snapshot.value).toBe("paused")
      expect(snapshot.context.elapsed).toBe(1)

      // Resume
      snapshot = await Effect.runPromise(
        getNextSnapshot(stopwatchMachine, snapshot, { type: "resume" })
      )

      expect(snapshot.value).toBe("running")
      expect(snapshot.context.elapsed).toBe(1) // Preserves elapsed
    })

    it("should reset from any state", async () => {
      let snapshot = await Effect.runPromise(
        getInitialSnapshot(stopwatchMachine, undefined)
      )

      // Start and tick
      snapshot = await Effect.runPromise(
        getNextSnapshot(stopwatchMachine, snapshot, { type: "start" })
      )
      for (let i = 0; i < 5; i++) {
        snapshot = await Effect.runPromise(
          getNextSnapshot(stopwatchMachine, snapshot, { type: "TICK" })
        )
      }

      expect(snapshot.context.elapsed).toBe(5)

      // Reset
      snapshot = await Effect.runPromise(
        getNextSnapshot(stopwatchMachine, snapshot, { type: "reset" })
      )

      expect(snapshot.value).toBe("stopped")
      expect(snapshot.context.elapsed).toBe(0)
    })

    it("should ignore TICK when stopped", async () => {
      const snapshot = await Effect.runPromise(
        getInitialSnapshot(stopwatchMachine, undefined)
      )

      // Try to tick while stopped
      const afterTick = await Effect.runPromise(
        getNextSnapshot(stopwatchMachine, snapshot, { type: "TICK" })
      )

      expect(afterTick.value).toBe("stopped")
      expect(afterTick.context.elapsed).toBe(0)
    })
  })

  describe("Simple Stopwatch Machine", () => {
    it("should have correct initial state", async () => {
      const snapshot = await Effect.runPromise(
        getInitialSnapshot(simpleStopwatchMachine, undefined)
      )

      expect(snapshot.value).toBe("stopped")
      expect(snapshot.context.elapsed).toBe(0)
    })

    it("should handle full lifecycle", async () => {
      let snapshot = await Effect.runPromise(
        getInitialSnapshot(simpleStopwatchMachine, undefined)
      )

      // Start
      snapshot = await Effect.runPromise(
        getNextSnapshot(simpleStopwatchMachine, snapshot, { type: "start" })
      )
      expect(snapshot.value).toBe("running")

      // Tick
      snapshot = await Effect.runPromise(
        getNextSnapshot(simpleStopwatchMachine, snapshot, { type: "TICK" })
      )
      expect(snapshot.context.elapsed).toBe(1)

      // Pause
      snapshot = await Effect.runPromise(
        getNextSnapshot(simpleStopwatchMachine, snapshot, { type: "pause" })
      )
      expect(snapshot.value).toBe("paused")

      // Resume
      snapshot = await Effect.runPromise(
        getNextSnapshot(simpleStopwatchMachine, snapshot, { type: "resume" })
      )
      expect(snapshot.value).toBe("running")

      // More ticks
      snapshot = await Effect.runPromise(
        getNextSnapshot(simpleStopwatchMachine, snapshot, { type: "TICK" })
      )
      expect(snapshot.context.elapsed).toBe(2)

      // Stop
      snapshot = await Effect.runPromise(
        getNextSnapshot(simpleStopwatchMachine, snapshot, { type: "stop" })
      )
      expect(snapshot.value).toBe("stopped")
      expect(snapshot.context.elapsed).toBe(2)
    })
  })

  // ============================================================
  // FETCH EXAMPLE
  // ============================================================
  describe("Fetch Machine", () => {
    it("should have correct initial state", async () => {
      const snapshot = await Effect.runPromise(
        getInitialSnapshot(fetchMachine, undefined)
      )

      expect(snapshot.value).toBe("idle")
      expect(snapshot.context.name).toBe("World")
      expect(snapshot.context.data).toBeNull()
      expect(snapshot.context.error).toBeNull()
    })

    it("should transition to loading on FETCH", async () => {
      const initial = await Effect.runPromise(
        getInitialSnapshot(fetchMachine, undefined)
      )

      const loading = await Effect.runPromise(
        getNextSnapshot(fetchMachine, initial, { type: "FETCH" })
      )

      expect(loading.value).toBe("loading")
    })

    it("should transition to success on SUCCESS event", async () => {
      let snapshot = await Effect.runPromise(
        getInitialSnapshot(fetchMachine, undefined)
      )

      // Start fetch
      snapshot = await Effect.runPromise(
        getNextSnapshot(fetchMachine, snapshot, { type: "FETCH" })
      )
      expect(snapshot.value).toBe("loading")

      // Simulate successful fetch
      snapshot = await Effect.runPromise(
        getNextSnapshot(fetchMachine, snapshot, {
          type: "SUCCESS",
          data: { greeting: "Hello, World!" },
        })
      )

      expect(snapshot.value).toBe("success")
      expect(snapshot.context.data).toEqual({ greeting: "Hello, World!" })
      expect(snapshot.context.error).toBeNull()
    })

    it("should transition to failure on ERROR event", async () => {
      let snapshot = await Effect.runPromise(
        getInitialSnapshot(fetchMachine, undefined)
      )

      // Start fetch
      snapshot = await Effect.runPromise(
        getNextSnapshot(fetchMachine, snapshot, { type: "FETCH" })
      )

      // Simulate failed fetch
      const error = new Error("Network error")
      snapshot = await Effect.runPromise(
        getNextSnapshot(fetchMachine, snapshot, {
          type: "ERROR",
          error,
        })
      )

      expect(snapshot.value).toBe("failure")
      expect(snapshot.context.error).toBe(error)
    })

    it("should retry from failure state", async () => {
      let snapshot = await Effect.runPromise(
        getInitialSnapshot(fetchMachine, undefined)
      )

      // FETCH -> loading -> failure
      snapshot = await Effect.runPromise(
        getNextSnapshot(fetchMachine, snapshot, { type: "FETCH" })
      )
      snapshot = await Effect.runPromise(
        getNextSnapshot(fetchMachine, snapshot, {
          type: "ERROR",
          error: new Error("Failed"),
        })
      )
      expect(snapshot.value).toBe("failure")

      // Retry
      snapshot = await Effect.runPromise(
        getNextSnapshot(fetchMachine, snapshot, { type: "RETRY" })
      )

      expect(snapshot.value).toBe("loading")
      expect(snapshot.context.retryCount).toBe(1)
    })

    it("should reset from success state", async () => {
      let snapshot = await Effect.runPromise(
        getInitialSnapshot(fetchMachine, undefined)
      )

      // FETCH -> success
      snapshot = await Effect.runPromise(
        getNextSnapshot(fetchMachine, snapshot, { type: "FETCH" })
      )
      snapshot = await Effect.runPromise(
        getNextSnapshot(fetchMachine, snapshot, {
          type: "SUCCESS",
          data: { greeting: "Hello!" },
        })
      )
      expect(snapshot.value).toBe("success")
      expect(snapshot.context.data).not.toBeNull()

      // Reset
      snapshot = await Effect.runPromise(
        getNextSnapshot(fetchMachine, snapshot, { type: "RESET" })
      )

      expect(snapshot.value).toBe("idle")
      expect(snapshot.context.data).toBeNull()
    })

    it("should refetch from success state", async () => {
      let snapshot = await Effect.runPromise(
        getInitialSnapshot(fetchMachine, undefined)
      )

      // FETCH -> success
      snapshot = await Effect.runPromise(
        getNextSnapshot(fetchMachine, snapshot, { type: "FETCH" })
      )
      snapshot = await Effect.runPromise(
        getNextSnapshot(fetchMachine, snapshot, {
          type: "SUCCESS",
          data: { greeting: "Hello!" },
        })
      )

      // Fetch again
      snapshot = await Effect.runPromise(
        getNextSnapshot(fetchMachine, snapshot, { type: "FETCH" })
      )

      expect(snapshot.value).toBe("loading")
    })

    it("should update name in idle state", async () => {
      let snapshot = await Effect.runPromise(
        getInitialSnapshot(fetchMachine, undefined)
      )

      expect(snapshot.context.name).toBe("World")

      snapshot = await Effect.runPromise(
        getNextSnapshot(fetchMachine, snapshot, {
          type: "SET_NAME",
          name: "Alice",
        })
      )

      expect(snapshot.context.name).toBe("Alice")
      expect(snapshot.value).toBe("idle") // Still in idle
    })
  })

  describe("Simple Fetch Machine", () => {
    it("should have correct initial state", async () => {
      const snapshot = await Effect.runPromise(
        getInitialSnapshot(simpleFetchMachine, undefined)
      )

      expect(snapshot.value).toBe("idle")
      expect(snapshot.context.name).toBe("World")
    })

    it("should handle fetch lifecycle", async () => {
      let snapshot = await Effect.runPromise(
        getInitialSnapshot(simpleFetchMachine, undefined)
      )

      // FETCH
      snapshot = await Effect.runPromise(
        getNextSnapshot(simpleFetchMachine, snapshot, { type: "FETCH" })
      )
      expect(snapshot.value).toBe("loading")

      // Success
      snapshot = await Effect.runPromise(
        getNextSnapshot(simpleFetchMachine, snapshot, {
          type: "SUCCESS",
          data: { greeting: "Test" },
        })
      )
      expect(snapshot.value).toBe("success")
      expect(snapshot.context.data).toEqual({ greeting: "Test" })
    })
  })
})
