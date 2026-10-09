/**
 * Snapshot tests
 */
import { describe, it, expect } from "vitest"
import { Option } from "effect"
import {
  SnapshotTypeId,
  MachineSnapshotTypeId,
  isSnapshot,
  isMachineSnapshot,
  active,
  done,
  error,
  stopped,
  isActive,
  isDone,
  isError,
  isStopped,
  makeMachineSnapshot,
  initialMachineSnapshot,
  matches,
  hasTag,
  getTags,
  updateContext,
  updateValue,
  updateStatus,
  complete,
  fail,
  stop,
} from "../src/Snapshot.js"
import { createMachine, matches as rootMatches } from "../src/index.js"

/** The machines the snapshots below belong to: a snapshot holds its machine object (SD-6). */
const counterMachine = createMachine({ id: "counter" })
const testMachine = createMachine({ id: "test" })

describe("Snapshot", () => {
  describe("type guards", () => {
    it("isSnapshot should return true for valid snapshots", () => {
      const snapshot = active()
      expect(isSnapshot(snapshot)).toBe(true)
    })

    it("isSnapshot should return false for non-snapshots", () => {
      expect(isSnapshot({})).toBe(false)
      expect(isSnapshot(null)).toBe(false)
      expect(isSnapshot("string")).toBe(false)
      expect(isSnapshot(123)).toBe(false)
    })

    it("isMachineSnapshot should return true for machine snapshots", () => {
      const snapshot = initialMachineSnapshot("idle", {}, testMachine)
      expect(isMachineSnapshot(snapshot)).toBe(true)
    })

    it("isMachineSnapshot should return false for basic snapshots", () => {
      const snapshot = active()
      expect(isMachineSnapshot(snapshot)).toBe(false)
    })
  })

  describe("constructors", () => {
    it("active should create an active snapshot", () => {
      const snapshot = active()
      expect(snapshot.status).toBe("active")
      expect(Option.isNone(snapshot.output)).toBe(true)
      expect(Option.isNone(snapshot.error)).toBe(true)
      expect(snapshot[SnapshotTypeId]).toBe(SnapshotTypeId)
    })

    it("done should create a done snapshot with output", () => {
      const snapshot = done({ result: "success" })
      expect(snapshot.status).toBe("done")
      expect(Option.isSome(snapshot.output)).toBe(true)
      expect(Option.getOrThrow(snapshot.output)).toEqual({ result: "success" })
      expect(Option.isNone(snapshot.error)).toBe(true)
    })

    it("error should create an error snapshot", () => {
      const err = new Error("Something went wrong")
      const snapshot = error(err)
      expect(snapshot.status).toBe("error")
      expect(Option.isNone(snapshot.output)).toBe(true)
      expect(Option.isSome(snapshot.error)).toBe(true)
      expect(Option.getOrThrow(snapshot.error)).toBe(err)
    })

    it("stopped should create a stopped snapshot", () => {
      const snapshot = stopped()
      expect(snapshot.status).toBe("stopped")
      expect(Option.isNone(snapshot.output)).toBe(true)
      expect(Option.isNone(snapshot.error)).toBe(true)
    })
  })

  describe("predicates", () => {
    it("isActive should return true for active snapshots", () => {
      expect(isActive(active())).toBe(true)
      expect(isActive(done("output"))).toBe(false)
      expect(isActive(error(new Error()))).toBe(false)
      expect(isActive(stopped())).toBe(false)
    })

    it("isDone should return true for done snapshots", () => {
      expect(isDone(done("output"))).toBe(true)
      expect(isDone(active())).toBe(false)
    })

    it("isError should return true for error snapshots", () => {
      expect(isError(error(new Error()))).toBe(true)
      expect(isError(active())).toBe(false)
    })

    it("isStopped should return true for stopped snapshots", () => {
      expect(isStopped(stopped())).toBe(true)
      expect(isStopped(active())).toBe(false)
    })
  })

  describe("MachineSnapshot constructors", () => {
    it("makeMachineSnapshot should create a machine snapshot", () => {
      const snapshot = makeMachineSnapshot({
        value: "idle",
        context: { count: 0 },
        status: "active",
        children: {},
        historyValue: {},
        tags: [],
        output: Option.none(),
        error: Option.none(),
        machine: counterMachine,
      })

      expect(snapshot.value).toBe("idle")
      expect(snapshot.context).toEqual({ count: 0 })
      expect(snapshot.status).toBe("active")
      expect(snapshot.machine).toBe(counterMachine)
      expect(snapshot.machine.id).toBe("counter")
      expect(snapshot[MachineSnapshotTypeId]).toBe(MachineSnapshotTypeId)
    })

    it("initialMachineSnapshot should create an initial snapshot", () => {
      const snapshot = initialMachineSnapshot("idle", { count: 0 }, counterMachine)

      expect(snapshot.value).toBe("idle")
      expect(snapshot.context).toEqual({ count: 0 })
      expect(snapshot.status).toBe("active")
      expect(snapshot.machine).toBe(counterMachine)
      expect(snapshot.machine.id).toBe("counter")
      expect(snapshot.tags.length).toBe(0)
    })
  })

  describe("MachineSnapshot matching", () => {
    it("matches should check if snapshot matches state value", () => {
      const snapshot = initialMachineSnapshot("idle", {}, testMachine)

      expect(matches(snapshot, "idle")).toBe(true)
      expect(matches(snapshot, "loading")).toBe(false)
    })

    it("matches should work with compound state values", () => {
      const snapshot = makeMachineSnapshot({
        value: { loading: "pending" },
        context: {},
        status: "active",
        children: {},
        historyValue: {},
        tags: [],
        output: Option.none(),
        error: Option.none(),
        machine: testMachine,
      })

      expect(matches(snapshot, { loading: "pending" })).toBe(true)
      expect(matches(snapshot, "loading")).toBe(true)
    })

    it("matches should compare the snapshot value against the given value", () => {
      const snapshot = makeMachineSnapshot({
        value: { a: "b", c: "d" },
        context: {},
        status: "active",
        children: {},
        historyValue: {},
        tags: [],
        output: Option.none(),
        error: Option.none(),
        machine: testMachine,
      })

      expect(matches(snapshot, { a: "b" })).toBe(true)
    })

    it("matches should be reachable from the root export", () => {
      const snapshot = initialMachineSnapshot("idle", {}, testMachine)

      expect(rootMatches(snapshot, "idle")).toBe(true)
    })
  })

  describe("MachineSnapshot tags", () => {
    it("hasTag should check for tag presence", () => {
      const snapshot = makeMachineSnapshot({
        value: "loading",
        context: {},
        status: "active",
        children: {},
        historyValue: {},
        tags: ["loading", "busy"],
        output: Option.none(),
        error: Option.none(),
        machine: testMachine,
      })

      expect(hasTag(snapshot, "loading")).toBe(true)
      expect(hasTag(snapshot, "busy")).toBe(true)
      expect(hasTag(snapshot, "idle")).toBe(false)
    })

    it("getTags should return all tags", () => {
      const snapshot = makeMachineSnapshot({
        value: "loading",
        context: {},
        status: "active",
        children: {},
        historyValue: {},
        tags: ["tag1", "tag2"],
        output: Option.none(),
        error: Option.none(),
        machine: testMachine,
      })

      const tags = getTags(snapshot)
      expect(tags).toContain("tag1")
      expect(tags).toContain("tag2")
      expect(tags.length).toBe(2)
    })

    it("getTags should return empty array when no tags", () => {
      const snapshot = initialMachineSnapshot("idle", {}, testMachine)
      expect(getTags(snapshot)).toEqual([])
    })
  })

  describe("MachineSnapshot transformations", () => {
    it("updateContext should update the context", () => {
      const snapshot = initialMachineSnapshot("idle", { count: 0 }, counterMachine)
      const updated = updateContext(snapshot, { count: 5 })

      expect(updated.context).toEqual({ count: 5 })
      expect(updated.value).toBe("idle")
    })

    it("updateValue should update the state value", () => {
      const snapshot = initialMachineSnapshot("idle", { count: 0 }, counterMachine)
      const updated = updateValue(snapshot, "loading")

      expect(updated.value).toBe("loading")
      expect(updated.context).toEqual({ count: 0 })
    })

    it("updateStatus should update the status", () => {
      const snapshot = initialMachineSnapshot("idle", {}, testMachine)
      const updated = updateStatus(snapshot, "stopped")

      expect(updated.status).toBe("stopped")
    })

    it("complete should set status to done with output", () => {
      const snapshot = initialMachineSnapshot("processing", {}, testMachine)
      const completed = complete(snapshot, { result: "success" })

      expect(completed.status).toBe("done")
      expect(Option.isSome(completed.output)).toBe(true)
      expect(Option.getOrThrow(completed.output)).toEqual({ result: "success" })
    })

    it("fail should set status to error with error", () => {
      const snapshot = initialMachineSnapshot("processing", {}, testMachine)
      const err = new Error("Failed")
      const failed = fail(snapshot, err)

      expect(failed.status).toBe("error")
      expect(Option.isSome(failed.error)).toBe(true)
      expect(Option.getOrThrow(failed.error)).toBe(err)
    })

    it("stop should set status to stopped", () => {
      const snapshot = initialMachineSnapshot("active", {}, testMachine)
      const stoppedSnapshot = stop(snapshot)

      expect(stoppedSnapshot.status).toBe("stopped")
    })
  })

  describe("snapshot immutability", () => {
    it("transformations should not mutate original snapshot", () => {
      const original = initialMachineSnapshot("idle", { count: 0 }, counterMachine)

      updateContext(original, { count: 5 })
      expect(original.context).toEqual({ count: 0 })

      updateValue(original, "loading")
      expect(original.value).toBe("idle")

      updateStatus(original, "stopped")
      expect(original.status).toBe("active")
    })
  })
})
