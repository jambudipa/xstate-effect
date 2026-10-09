/**
 * State Machine tests
 */
import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import { setup, createMachine } from "../src/index.js"
import { getInitialSnapshot, getNextSnapshot } from "../src/testing/index.js"

describe("StateMachine", () => {
  describe("basic machine creation", () => {
    it("should create a simple toggle machine", async () => {
      const toggleMachine = createMachine({
        id: "toggle",
        initial: "inactive",
        states: {
          inactive: {
            on: { TOGGLE: "active" },
          },
          active: {
            on: { TOGGLE: "inactive" },
          },
        },
      })

      expect(toggleMachine.id).toBe("toggle")
    })

    it("should get initial snapshot", async () => {
      const toggleMachine = createMachine({
        id: "toggle",
        initial: "inactive",
        context: { count: 0 },
        states: {
          inactive: {
            on: { TOGGLE: "active" },
          },
          active: {
            on: { TOGGLE: "inactive" },
          },
        },
      })

      const snapshot = await Effect.runPromise(
        getInitialSnapshot(toggleMachine, undefined)
      )

      expect(snapshot.value).toBe("inactive")
      expect(snapshot.context).toEqual({ count: 0 })
    })

    it("should transition between states", async () => {
      const toggleMachine = createMachine({
        id: "toggle",
        initial: "inactive",
        states: {
          inactive: {
            on: { TOGGLE: "active" },
          },
          active: {
            on: { TOGGLE: "inactive" },
          },
        },
      })

      const initial = await Effect.runPromise(
        getInitialSnapshot(toggleMachine, undefined)
      )
      expect(initial.value).toBe("inactive")

      const afterToggle = await Effect.runPromise(
        getNextSnapshot(toggleMachine, initial, { type: "TOGGLE" })
      )
      expect(afterToggle.value).toBe("active")

      const afterToggle2 = await Effect.runPromise(
        getNextSnapshot(toggleMachine, afterToggle, { type: "TOGGLE" })
      )
      expect(afterToggle2.value).toBe("inactive")
    })
  })

  describe("setup API", () => {
    it("should create machine with setup", async () => {
      interface Context {
        count: number
      }

      type Event = { type: "INCREMENT" } | { type: "DECREMENT" }

      const counterSetup = setup<Context, Event>({})

      const counterMachine = counterSetup.createMachine({
        id: "counter",
        initial: "counting",
        context: { count: 0 },
        states: {
          counting: {
            on: {
              INCREMENT: "counting",
              DECREMENT: "counting",
            },
          },
        },
      })

      expect(counterMachine.id).toBe("counter")

      const snapshot = await Effect.runPromise(
        getInitialSnapshot(counterMachine, undefined)
      )
      expect(snapshot.context.count).toBe(0)
    })
  })

  describe("nested states", () => {
    it("should handle compound states", async () => {
      const machine = createMachine({
        id: "traffic-light",
        initial: "green",
        states: {
          green: {
            on: { TIMER: "yellow" },
          },
          yellow: {
            on: { TIMER: "red" },
          },
          red: {
            initial: "walk",
            states: {
              walk: {
                on: { PED_TIMER: "wait" },
              },
              wait: {
                on: { PED_TIMER: "stop" },
              },
              stop: {},
            },
            on: { TIMER: "green" },
          },
        },
      })

      const initial = await Effect.runPromise(
        getInitialSnapshot(machine, undefined)
      )
      expect(initial.value).toBe("green")

      const yellow = await Effect.runPromise(
        getNextSnapshot(machine, initial, { type: "TIMER" })
      )
      expect(yellow.value).toBe("yellow")

      const red = await Effect.runPromise(
        getNextSnapshot(machine, yellow, { type: "TIMER" })
      )
      // Compound state should show the nested value
      expect(red.value).toEqual({ red: "walk" })

      // The parent's own transition leaves the compound state. (Sibling targets inside
      // `red`, such as PED_TIMER, need source-relative targets: gap row S9, a later phase.)
      const green = await Effect.runPromise(
        getNextSnapshot(machine, red, { type: "TIMER" })
      )
      expect(green.value).toBe("green")
    })
  })

  describe("context", () => {
    it("should initialize context from function", async () => {
      interface Context {
        userId: string
        timestamp: number
      }

      type Input = { userId: string }

      const machine = createMachine<Context, { type: "INIT" }, Input>({
        id: "user",
        initial: "idle",
        context: ({ input }) => ({
          userId: input.userId,
          timestamp: Date.now(),
        }),
        states: {
          idle: {},
        },
      })

      const snapshot = await Effect.runPromise(
        getInitialSnapshot(machine, { userId: "user-123" })
      )

      expect(snapshot.context.userId).toBe("user-123")
      expect(typeof snapshot.context.timestamp).toBe("number")
    })
  })

  describe("tags", () => {
    it("should handle state tags", async () => {
      const machine = createMachine({
        id: "fetch",
        initial: "idle",
        states: {
          idle: {
            tags: ["ready"],
            on: { FETCH: "loading" },
          },
          loading: {
            tags: ["busy", "fetching"],
            on: { SUCCESS: "success", ERROR: "error" },
          },
          success: {
            tags: ["ready", "done"],
          },
          error: {
            tags: ["ready", "error"],
          },
        },
      })

      const idle = await Effect.runPromise(
        getInitialSnapshot(machine, undefined)
      )
      expect(idle.tags).toContain("ready")

      const loading = await Effect.runPromise(
        getNextSnapshot(machine, idle, { type: "FETCH" })
      )
      expect(loading.tags).toContain("busy")
      expect(loading.tags).toContain("fetching")
      expect(loading.tags).not.toContain("ready")
    })
  })

  describe("final states", () => {
    it("should handle final states", async () => {
      const machine = createMachine({
        id: "workflow",
        initial: "pending",
        states: {
          pending: {
            on: { COMPLETE: "completed" },
          },
          completed: {
            type: "final",
          },
        },
      })

      const pending = await Effect.runPromise(
        getInitialSnapshot(machine, undefined)
      )
      expect(pending.status).toBe("active")

      const completed = await Effect.runPromise(
        getNextSnapshot(machine, pending, { type: "COMPLETE" })
      )
      expect(completed.value).toBe("completed")
      // Final state should mark the machine as done
      expect(completed.status).toBe("done")
    })
  })
})
