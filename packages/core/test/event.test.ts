/**
 * Event tests
 */
import { describe, it, expect } from "vitest"
import { Equal, Option } from "effect"
import {
  isEventObject,
  InitEvent,
  StopEvent,
  DoneActorEvent,
  ErrorActorEvent,
  DoneStateEvent,
  AfterEvent,
  SnapshotEvent,
  ObservableNextEvent,
  NULL_EVENT,
  isNullEvent,
  isWildcardType,
  isDoneActorEvent,
  isErrorActorEvent,
  isDoneStateEvent,
  isAfterEvent,
  matchesEventDescriptor,
} from "../src/Event.js"

describe("Event", () => {
  describe("isEventObject", () => {
    it("should return true for valid event objects", () => {
      expect(isEventObject({ type: "TEST" })).toBe(true)
      expect(isEventObject({ type: "CLICK", payload: 123 })).toBe(true)
      expect(isEventObject(new InitEvent({ input: undefined }))).toBe(true)
    })

    it("should return false for invalid event objects", () => {
      expect(isEventObject({})).toBe(false)
      expect(isEventObject({ type: 123 })).toBe(false)
      expect(isEventObject(null)).toBe(false)
      expect(isEventObject("string")).toBe(false)
      expect(isEventObject(123)).toBe(false)
    })
  })

  // Built-in events are plain data with no `_tag` (SD-5); the former `_tag` assertions
  // now check that the field is absent (SD-20).
  describe("InitEvent", () => {
    it("should create an init event", () => {
      const event = new InitEvent({ input: { n: 1 } })
      expect(event.type).toBe("xstate.init")
      expect(event.input).toEqual({ n: 1 })
      expect("_tag" in event).toBe(false)
    })
  })

  describe("StopEvent", () => {
    it("should create a stop event", () => {
      const event = new StopEvent()
      expect(event.type).toBe("xstate.stop")
      expect("_tag" in event).toBe(false)
    })
  })

  describe("DoneActorEvent", () => {
    it("should create a done actor event with output", () => {
      const event = new DoneActorEvent({ actorId: "myActor", output: Option.some({ result: "success" }) })
      expect(event.type).toBe("xstate.done.actor.myActor")
      expect(event.actorId).toBe("myActor")
      expect(event.output).toEqual(Option.some({ result: "success" }))
    })

    it("should have correct type prefix", () => {
      const event = new DoneActorEvent({ actorId: "child", output: Option.none() })
      expect(event.type.startsWith("xstate.done.actor.")).toBe(true)
    })
  })

  describe("ErrorActorEvent", () => {
    it("should create an error actor event", () => {
      const error = new Error("Actor failed")
      const event = new ErrorActorEvent({ actorId: "failingActor", error })
      expect(event.type).toBe("xstate.error.actor.failingActor")
      expect(event.actorId).toBe("failingActor")
      expect(event.error).toBe(error)
    })
  })

  describe("DoneStateEvent", () => {
    it("should create a done state event", () => {
      const event = new DoneStateEvent({ stateId: "loading", output: Option.some({ data: "loaded" }) })
      expect(event.type).toBe("xstate.done.state.loading")
      expect(Object.keys(event)).toEqual(["type", "output"])
      expect(event.output).toEqual(Option.some({ data: "loaded" }))
    })
  })

  describe("AfterEvent", () => {
    it("should create an after event", () => {
      const event = new AfterEvent({ delay: 1000, stateNodeId: "machine.idle" })
      expect(event.type).toBe("xstate.after.1000.machine.idle")
      expect(Object.keys(event)).toEqual(["type"])
    })
  })

  describe("SnapshotEvent", () => {
    it("should create a snapshot event", () => {
      const snapshot = { value: "idle", context: {} }
      const event = new SnapshotEvent({ actorId: "child", snapshot })
      expect(event.type).toBe("xstate.snapshot.child")
      expect(event.snapshot).toBe(snapshot)
    })
  })

  describe("ObservableNextEvent", () => {
    it("should create an observable next event", () => {
      const event = new ObservableNextEvent({ data: 42 })
      expect(event.type).toBe("xstate.observable.next")
      expect(event.data).toBe(42)
    })
  })

  describe("NULL_EVENT", () => {
    it("should have empty string type", () => {
      expect(NULL_EVENT.type).toBe("")
    })
  })

  describe("isNullEvent", () => {
    it("should return true for null events", () => {
      expect(isNullEvent(NULL_EVENT)).toBe(true)
      expect(isNullEvent({ type: "" })).toBe(true)
    })

    it("should return false for regular events", () => {
      expect(isNullEvent({ type: "CLICK" })).toBe(false)
      expect(isNullEvent(new InitEvent({ input: undefined }))).toBe(false)
    })
  })

  describe("isWildcardType", () => {
    it("should return true for wildcard", () => {
      expect(isWildcardType("*")).toBe(true)
    })

    it("should return false for regular types", () => {
      expect(isWildcardType("CLICK")).toBe(false)
      expect(isWildcardType("")).toBe(false)
    })
  })

  describe("isDoneActorEvent", () => {
    it("should return true for done actor events", () => {
      const event = new DoneActorEvent({ actorId: "test", output: Option.none() })
      expect(isDoneActorEvent(event)).toBe(true)
    })

    it("should return false for other events", () => {
      expect(isDoneActorEvent({ type: "CLICK" })).toBe(false)
      expect(isDoneActorEvent(new InitEvent({ input: undefined }))).toBe(false)
    })
  })

  describe("isErrorActorEvent", () => {
    it("should return true for error actor events", () => {
      const event = new ErrorActorEvent({ actorId: "test", error: new Error() })
      expect(isErrorActorEvent(event)).toBe(true)
    })

    it("should return false for other events", () => {
      expect(isErrorActorEvent({ type: "CLICK" })).toBe(false)
    })
  })

  describe("isDoneStateEvent", () => {
    it("should return true for done state events", () => {
      const event = new DoneStateEvent({ stateId: "loading", output: Option.none() })
      expect(isDoneStateEvent(event)).toBe(true)
    })

    it("should return false for other events", () => {
      expect(isDoneStateEvent({ type: "CLICK" })).toBe(false)
    })
  })

  describe("isAfterEvent", () => {
    it("should return true for after events", () => {
      const event = new AfterEvent({ delay: "timeout", stateNodeId: "machine.idle" })
      expect(isAfterEvent(event)).toBe(true)
    })

    it("should return false for other events", () => {
      expect(isAfterEvent({ type: "CLICK" })).toBe(false)
    })
  })

  describe("matchesEventDescriptor", () => {
    it("should match wildcard to any event", () => {
      expect(matchesEventDescriptor("CLICK", "*")).toBe(true)
      expect(matchesEventDescriptor("SUBMIT", "*")).toBe(true)
      expect(matchesEventDescriptor("", "*")).toBe(true)
    })

    it("should match empty string to empty event type", () => {
      expect(matchesEventDescriptor("", "")).toBe(true)
      expect(matchesEventDescriptor("CLICK", "")).toBe(false)
    })

    it("should match exact event types", () => {
      expect(matchesEventDescriptor("CLICK", "CLICK")).toBe(true)
      expect(matchesEventDescriptor("CLICK", "SUBMIT")).toBe(false)
    })
  })

  // Built-in events are plain data, so equality is structural (DAT-05), no longer the
  // Data.TaggedClass equality (SD-5, SD-20).
  describe("Event equality (structural)", () => {
    it("InitEvent instances with same data should be equal", () => {
      const a = new InitEvent({ input: undefined })
      const b = new InitEvent({ input: undefined })
      expect(a).toEqual(b)
      expect(Equal.equals(a, b)).toBe(true)
    })

    it("DoneActorEvent instances with same data should be equal", () => {
      const a = new DoneActorEvent({ actorId: "test", output: Option.some("done") })
      const b = new DoneActorEvent({ actorId: "test", output: Option.some("done") })
      expect(a).toEqual(b)
      expect(Equal.equals(a, b)).toBe(true)
    })

    it("DoneActorEvent instances with different data should not be equal", () => {
      const a = new DoneActorEvent({ actorId: "test", output: Option.some("done") })
      const b = new DoneActorEvent({ actorId: "other", output: Option.some("done") })
      expect(a).not.toEqual(b)
      expect(Equal.equals(a, b)).toBe(false)
    })
  })
})
