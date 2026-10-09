/**
 * StateValue tests
 */
import { describe, it, expect } from "vitest"
import { Option, HashSet, Chunk, HashMap } from "effect"
import {
  atomic,
  compound,
  isAtomicStateValue,
  isCompoundStateValue,
  keys,
  toHashMap,
  getChild,
  matches,
  toStrings,
  fromPath,
  fromString,
  getAtomicStateValues,
  merge,
  getFirstKey,
  hasPath,
  getActiveStateIds,
} from "../src/StateValue.js"
import type { StateValue, StateValueMap } from "../src/StateValue.js"

describe("StateValue", () => {
  describe("type guards", () => {
    it("isAtomicStateValue should return true for strings", () => {
      expect(isAtomicStateValue("idle")).toBe(true)
      expect(isAtomicStateValue("loading")).toBe(true)
      expect(isAtomicStateValue("")).toBe(true)
    })

    it("isAtomicStateValue should return false for objects", () => {
      expect(isAtomicStateValue({ a: "b" })).toBe(false)
      expect(isAtomicStateValue({ loading: "pending" })).toBe(false)
    })

    it("isCompoundStateValue should return true for objects", () => {
      expect(isCompoundStateValue({ a: "b" })).toBe(true)
      expect(isCompoundStateValue({ loading: "pending" })).toBe(true)
      expect(isCompoundStateValue({ upload: "active", download: "active" })).toBe(true)
    })

    it("isCompoundStateValue should return false for strings", () => {
      expect(isCompoundStateValue("idle")).toBe(false)
      expect(isCompoundStateValue("loading")).toBe(false)
    })
  })

  describe("constructors", () => {
    it("atomic should create an atomic state value", () => {
      const state = atomic("idle")
      expect(state).toBe("idle")
      expect(isAtomicStateValue(state)).toBe(true)
    })

    it("compound should create a compound state value", () => {
      const state = compound({ loading: "pending" })
      expect(state).toEqual({ loading: "pending" })
      expect(isCompoundStateValue(state)).toBe(true)
    })
  })

  describe("keys", () => {
    it("should return empty array for atomic states", () => {
      expect(keys("idle")).toEqual([])
    })

    it("should return keys for compound states", () => {
      expect(keys({ a: "b" })).toEqual(["a"])
      expect(keys({ upload: "active", download: "idle" })).toEqual(["upload", "download"])
    })
  })

  describe("toHashMap", () => {
    it("should return empty HashMap for atomic states", () => {
      const result = toHashMap("idle")
      expect(HashMap.size(result)).toBe(0)
    })

    it("should convert compound states to HashMap", () => {
      const result = toHashMap({ a: "b", c: "d" })
      expect(HashMap.size(result)).toBe(2)
      expect(HashMap.get(result, "a")).toEqual(Option.some("b"))
      expect(HashMap.get(result, "c")).toEqual(Option.some("d"))
    })
  })

  describe("getChild", () => {
    it("should return None for atomic states", () => {
      expect(getChild("idle", "anything")).toEqual(Option.none())
    })

    it("should return Some for existing child", () => {
      expect(getChild({ a: "b" }, "a")).toEqual(Option.some("b"))
      expect(getChild({ nested: { deep: "value" } }, "nested")).toEqual(
        Option.some({ deep: "value" })
      )
    })

    it("should return None for non-existing child", () => {
      expect(getChild({ a: "b" }, "c")).toEqual(Option.none())
    })
  })

  describe("matches", () => {
    it("should match identical atomic states", () => {
      expect(matches("idle", "idle")).toBe(true)
      expect(matches("loading", "loading")).toBe(true)
    })

    it("should not match different atomic states", () => {
      expect(matches("idle", "loading")).toBe(false)
    })

    it("should match identical compound states", () => {
      expect(matches({ a: "b" }, { a: "b" })).toBe(true)
      expect(matches({ loading: "pending" }, { loading: "pending" })).toBe(true)
    })

    it("should match nested compound states", () => {
      expect(matches({ a: { b: "c" } }, { a: { b: "c" } })).toBe(true)
    })

    it("should match when source has target as subset", () => {
      expect(matches({ a: { b: "c" } }, { a: { b: "c" } })).toBe(true)
    })

    it("should match atomic to compound with single key", () => {
      expect(matches("loading", { loading: "pending" })).toBe(true)
      expect(matches({ loading: "pending" }, "loading")).toBe(true)
    })

    it("should not match atomic to compound with multiple keys", () => {
      expect(matches("loading", { loading: "pending", upload: "active" })).toBe(false)
    })
  })

  describe("toStrings", () => {
    it("should return single-element array for atomic states", () => {
      expect(toStrings("idle")).toEqual(["idle"])
      expect(toStrings("loading")).toEqual(["loading"])
    })

    it("should return paths for compound states", () => {
      expect(toStrings({ a: "b" })).toEqual(["a.b"])
    })

    it("should return multiple paths for nested compound states", () => {
      const result = toStrings({ a: { b: "c" }, d: "e" })
      expect(result).toContain("a.b.c")
      expect(result).toContain("d.e")
    })
  })

  describe("fromPath", () => {
    it("should return empty string for empty path", () => {
      expect(fromPath([])).toBe("")
    })

    it("should return atomic state for single-element path", () => {
      expect(fromPath(["idle"])).toBe("idle")
    })

    it("should build compound state from path", () => {
      expect(fromPath(["a", "b", "c"])).toEqual({ a: { b: "c" } })
      expect(fromPath(["loading", "pending"])).toEqual({ loading: "pending" })
    })
  })

  describe("fromString", () => {
    it("should handle atomic state strings", () => {
      expect(fromString("idle")).toBe("idle")
    })

    it("should handle compound state strings", () => {
      expect(fromString("a.b.c")).toEqual({ a: { b: "c" } })
      expect(fromString("loading.pending")).toEqual({ loading: "pending" })
    })
  })

  describe("getAtomicStateValues", () => {
    it("should return single value for atomic state", () => {
      const result = getAtomicStateValues("idle")
      expect(HashSet.has(result, "idle")).toBe(true)
      expect(HashSet.size(result)).toBe(1)
    })

    it("should return all atomic values for compound state", () => {
      const result = getAtomicStateValues({ a: "b", c: "d" })
      expect(HashSet.has(result, "a.b")).toBe(true)
      expect(HashSet.has(result, "c.d")).toBe(true)
      expect(HashSet.size(result)).toBe(2)
    })

    it("should handle nested compound states", () => {
      const result = getAtomicStateValues({ a: { b: "c" } })
      expect(HashSet.has(result, "a.b.c")).toBe(true)
    })
  })

  describe("merge", () => {
    it("should return second value when first is atomic", () => {
      expect(merge("idle", "loading")).toBe("loading")
      expect(merge("idle", { a: "b" })).toEqual({ a: "b" })
    })

    it("should return second value when second is atomic", () => {
      expect(merge({ a: "b" }, "loading")).toBe("loading")
    })

    it("should merge compound states", () => {
      expect(merge({ a: "1" }, { b: "2" })).toEqual({ a: "1", b: "2" })
    })

    it("should override existing keys", () => {
      expect(merge({ a: "1" }, { a: "2" })).toEqual({ a: "2" })
    })

    it("should recursively merge nested compound states", () => {
      expect(merge({ a: { b: "1" } }, { a: { c: "2" } })).toEqual({
        a: { b: "1", c: "2" },
      })
    })
  })

  describe("getFirstKey", () => {
    it("should return Some with value for atomic states", () => {
      expect(getFirstKey("idle")).toEqual(Option.some("idle"))
    })

    it("should return Some with first key for compound states", () => {
      const result = getFirstKey({ loading: "pending" })
      expect(Option.isSome(result)).toBe(true)
    })

    it("should return None for empty compound state", () => {
      expect(getFirstKey({})).toEqual(Option.none())
    })
  })

  describe("hasPath", () => {
    it("should return true for empty path", () => {
      expect(hasPath("idle", [])).toBe(true)
      expect(hasPath({ a: "b" }, [])).toBe(true)
    })

    it("should check path for atomic states", () => {
      expect(hasPath("idle", ["idle"])).toBe(true)
      expect(hasPath("idle", ["loading"])).toBe(false)
      expect(hasPath("idle", ["idle", "nested"])).toBe(false)
    })

    it("should check path for compound states", () => {
      expect(hasPath({ a: "b" }, ["a"])).toBe(true)
      expect(hasPath({ a: "b" }, ["a", "b"])).toBe(true)
      expect(hasPath({ a: "b" }, ["c"])).toBe(false)
    })

    it("should check nested paths", () => {
      expect(hasPath({ a: { b: "c" } }, ["a", "b", "c"])).toBe(true)
      expect(hasPath({ a: { b: "c" } }, ["a", "b"])).toBe(true)
      expect(hasPath({ a: { b: "c" } }, ["a", "c"])).toBe(false)
    })
  })

  describe("getActiveStateIds", () => {
    it("should return machine ID for atomic state", () => {
      const result = getActiveStateIds("idle", "machine")
      const ids = Chunk.toArray(result)
      // For atomic states, returns machine id and the atomic state id
      expect(ids).toContain("machine")
      expect(ids.length).toBeGreaterThanOrEqual(1)
    })

    it("should return all active state IDs for compound state", () => {
      const result = getActiveStateIds({ loading: "pending" }, "machine")
      const ids = Chunk.toArray(result)
      // Returns machine id and compound state ids (not the leaf atomic values)
      expect(ids).toContain("machine")
      expect(ids).toContain("machine.loading")
    })

    it("should handle parallel states", () => {
      const result = getActiveStateIds(
        { upload: "active", download: "idle" },
        "machine"
      )
      const ids = Chunk.toArray(result)
      // Returns all active region IDs
      expect(ids).toContain("machine")
      expect(ids).toContain("machine.upload")
      expect(ids).toContain("machine.download")
    })

    it("should handle nested compound states", () => {
      const result = getActiveStateIds(
        { level1: { level2: "leaf" } },
        "machine"
      )
      const ids = Chunk.toArray(result)
      expect(ids).toContain("machine")
      expect(ids).toContain("machine.level1")
      expect(ids).toContain("machine.level1.level2")
    })
  })
})
