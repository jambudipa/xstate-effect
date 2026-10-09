/**
 * @since 0.1.0
 * @module StateValue
 *
 * StateValue type representing the current state configuration.
 * Supports atomic states (string) and parallel/compound states (record).
 */
import { HashMap, HashSet, Option, Chunk, Predicate, Array as Arr } from "effect"

// ============================================================
// STATE VALUE TYPE
// ============================================================

/**
 * Represents the current state value of a state machine.
 *
 * - For atomic/final states: a string (e.g., "idle")
 * - For compound states with active child: a record (e.g., { loading: "pending" })
 * - For parallel states: a record with all regions (e.g., { upload: "active", download: "active" })
 *
 * @since 0.1.0
 * @category State Value
 */
export type StateValue = string | StateValueMap

/**
 * A mapping of state keys to their active child state values.
 *
 * @since 0.1.0
 * @category State Value
 */
export interface StateValueMap {
  readonly [key: string]: StateValue
}

// ============================================================
// TYPE GUARDS
// ============================================================

/**
 * Check if a state value is atomic (string).
 *
 * @since 0.1.0
 * @category Guards
 */
export const isAtomicStateValue = (value: StateValue): value is string =>
  typeof value === "string"

/**
 * Check if a state value is compound/parallel (object).
 *
 * @since 0.1.0
 * @category Guards
 */
export const isCompoundStateValue = (value: StateValue): value is StateValueMap =>
  typeof value === "object" && !Predicate.isNull(value)

// ============================================================
// STATE VALUE UTILITIES
// ============================================================

/**
 * Creates an atomic state value.
 *
 * @since 0.1.0
 * @category Constructors
 */
export const atomic = (value: string): StateValue => value

/**
 * Creates a compound/parallel state value.
 *
 * @since 0.1.0
 * @category Constructors
 */
export const compound = (value: StateValueMap): StateValue => value

/**
 * Gets the keys from a compound state value.
 * Returns empty array for atomic states.
 *
 * @since 0.1.0
 * @category Accessors
 */
export const keys = (value: StateValue): ReadonlyArray<string> =>
  isAtomicStateValue(value) ? [] : Object.keys(value)

/**
 * Converts a state value to a HashMap.
 *
 * @since 0.1.0
 * @category Conversions
 */
export const toHashMap = (value: StateValue): HashMap.HashMap<string, StateValue> => {
  if (isAtomicStateValue(value)) {
    return HashMap.empty()
  }
  return HashMap.fromIterable(Object.entries(value))
}

/**
 * Gets a child state value by key.
 *
 * @since 0.1.0
 * @category Accessors
 */
export const getChild = (value: StateValue, key: string): Option.Option<StateValue> => {
  if (isAtomicStateValue(value)) {
    return Option.none()
  }
  return Option.fromNullishOr(value[key])
}

// ============================================================
// STATE VALUE MATCHING
// ============================================================

/**
 * Checks if a state value matches a target state value.
 *
 * A state value matches if:
 * - Both are the same atomic value
 * - The source is a subset of the target (for compound states)
 *
 * @example
 * ```ts
 * matches("idle", "idle") // true
 * matches("idle", "loading") // false
 * matches({ a: "b" }, { a: "b" }) // true
 * matches({ a: "b" }, { a: { b: "c" } }) // true (subset)
 * matches({ a: { b: "c" } }, { a: "b" }) // false
 * ```
 *
 * @since 0.1.0
 * @category Matching
 */
export const matches = (source: StateValue, target: StateValue): boolean => {
  if (isAtomicStateValue(source) && isAtomicStateValue(target)) {
    return source === target
  }

  if (isAtomicStateValue(source)) {
    // Source is atomic but target is compound
    // Check if the first key of target matches source
    const targetKeys = keys(target)
    if (targetKeys.length === 1) {
      const firstKey = targetKeys[0]
      return firstKey === source
    }
    return false
  }

  if (isAtomicStateValue(target)) {
    // Source is compound but target is atomic
    // Check if source contains the target key
    const sourceKeys = keys(source)
    if (sourceKeys.length === 1) {
      const firstKey = sourceKeys[0]
      return firstKey === target
    }
    return false
  }

  // Both are compound - check all target keys are matched in source
  const targetKeys = keys(target)

  return targetKeys.every((key) => {
    const sourceChild = Option.fromNullishOr(source[key])
    const targetChild = Option.fromNullishOr(target[key])
    if (Option.isNone(sourceChild) || Option.isNone(targetChild)) {
      return false
    }
    return matches(sourceChild.value, targetChild.value)
  })
}

/**
 * Gets all state paths from a state value.
 *
 * @example
 * ```ts
 * toStrings("idle") // ["idle"]
 * toStrings({ a: "b" }) // ["a.b"]
 * toStrings({ a: { b: "c" }, d: "e" }) // ["a.b.c", "d.e"]
 * ```
 *
 * @since 0.1.0
 * @category Conversions
 */
export const toStrings = (value: StateValue): ReadonlyArray<string> => {
  if (isAtomicStateValue(value)) {
    return [value]
  }

  const result: Array<string> = []
  const stack: Array<{ prefix: string; value: StateValueMap }> = [{ prefix: "", value }]

  while (stack.length > 0) {
    const current = Option.fromNullishOr(stack.pop())
    if (Option.isNone(current)) break
    const { prefix, value: currentValue } = current.value

    for (const [key, child] of Object.entries(currentValue)) {
      const path = prefix === "" ? key : `${prefix}.${key}`
      if (isAtomicStateValue(child)) {
        result.push(`${path}.${child}`)
      } else {
        stack.push({ prefix: path, value: child })
      }
    }
  }

  return result
}

/**
 * Converts a state path array to a state value.
 *
 * @example
 * ```ts
 * fromPath(["a", "b", "c"]) // { a: { b: "c" } }
 * fromPath(["idle"]) // "idle"
 * ```
 *
 * @since 0.1.0
 * @category Constructors
 */
export const fromPath = (path: ReadonlyArray<string>): StateValue => {
  if (path.length === 0) {
    return ""
  }
  if (path.length === 1) {
    return path[0]!
  }

  // Build from the end
  let result: StateValue = path[path.length - 1]!
  for (let i = path.length - 2; i >= 0; i--) {
    result = { [path[i]!]: result }
  }
  return result
}

/**
 * Converts a state path to a state value, as XState does (upstream `pathToStateValue`): one
 * segment is that string, more segments nest, and the empty path is the empty object. The
 * port function {@link fromPath} keeps `""` for the empty path (SD-20).
 *
 * @example
 * ```ts
 * pathToStateValue(["a", "b", "c"]) // { a: { b: "c" } }
 * pathToStateValue(["idle"]) // "idle"
 * pathToStateValue([]) // {}
 * ```
 *
 * @since 0.1.0
 * @category Constructors
 */
export const pathToStateValue = (statePath: ReadonlyArray<string>): StateValue =>
  statePath.length === 0 ? {} : fromPath(statePath)

/**
 * Converts a dot-separated string to a state value.
 *
 * @example
 * ```ts
 * fromString("a.b.c") // { a: { b: "c" } }
 * fromString("idle") // "idle"
 * ```
 *
 * @since 0.1.0
 * @category Constructors
 */
export const fromString = (str: string): StateValue => {
  const parts = str.split(".")
  return fromPath(parts)
}

/**
 * Splits a state path on `.`; a backslash escapes the next character (upstream
 * `toStatePath`), so `"a\\.b"` is the one segment `a.b`.
 *
 * @example
 * ```ts
 * toStatePath("a.b.c") // ["a", "b", "c"]
 * toStatePath("a\\.b") // ["a.b"]
 * ```
 *
 * @since 0.1.0
 * @category Conversions
 */
export const toStatePath = (statePath: string): ReadonlyArray<string> => {
  const last = Array.from(statePath).reduce(
    (
      acc: { readonly segments: ReadonlyArray<string>; readonly segment: string; readonly escaped: boolean },
      char
    ) =>
      acc.escaped
        ? { ...acc, segment: acc.segment + char, escaped: false }
        : char === "\\"
          ? { ...acc, escaped: true }
          : char === "."
            ? { segments: [...acc.segments, acc.segment], segment: "", escaped: false }
            : { ...acc, segment: acc.segment + char },
    { segments: [], segment: "", escaped: false }
  )
  return [...last.segments, last.segment]
}

/**
 * Whether a value given where a state value goes is a machine snapshot, by its shape
 * (upstream `isMachineSnapshot`): a non-null object with both a `machine` and a `value` key.
 * The check is structural, as upstream, so any such object counts, also inside a state value.
 */
const isMachineSnapshotShape = (u: unknown): u is { readonly machine: unknown; readonly value: StateValue } =>
  typeof u === "object" && !Predicate.isNull(u) && "machine" in u && "value" in u

/**
 * A state value (upstream `toStateValue`): a machine snapshot gives its own `value`, as it
 * is; a string is read as a dotted state path, so `"a.b.c"` is `{ a: { b: "c" } }` and
 * `"a\\.b"` is the one key `a.b`; any other value stays as it is.
 */
const toStateValue = (stateValue: StateValue): StateValue =>
  isMachineSnapshotShape(stateValue)
    ? stateValue.value
    : isAtomicStateValue(stateValue)
      ? pathToStateValue(toStatePath(stateValue))
      : stateValue

/**
 * Whether `childStateId` matches the pattern `parentStateId`, with XState semantics
 * (upstream `matchesState`): each side may be a state value or a dotted state path; an
 * atomic pattern matches the same atomic value or a key of a compound value (so one region
 * of a parallel state matches); a compound pattern matches when each of its keys is in the
 * value and matches there. A pattern more specific than the value does not match. The port
 * function {@link matches} keeps its own rule (SD-20).
 *
 * As upstream, either side may also be a machine snapshot, read as its state value: any
 * object with both a `machine` and a `value` key counts as one. The parameters take state
 * values only, as upstream types them, so a snapshot needs a cast.
 *
 * @example
 * ```ts
 * matchesState("a", { a: "b" }) // true
 * matchesState({ a: "b" }, "a") // false: the pattern is more specific
 * matchesState("a.b", { a: { b: "c" } }) // true
 * matchesState({ a: "x" }, { a: "x", b: "y" }) // true
 * ```
 *
 * @since 0.1.0
 * @category Matching
 */
export const matchesState = (parentStateId: StateValue, childStateId: StateValue): boolean => {
  const parentStateValue = toStateValue(parentStateId)
  const childStateValue = toStateValue(childStateId)

  if (isAtomicStateValue(childStateValue)) {
    // An atomic value matches only the same atomic pattern; a compound pattern is more specific
    return isAtomicStateValue(parentStateValue) && childStateValue === parentStateValue
  }

  if (isAtomicStateValue(parentStateValue)) {
    return parentStateValue in childStateValue
  }

  return Object.keys(parentStateValue).every(
    (key) => key in childStateValue && matchesState(parentStateValue[key]!, childStateValue[key]!)
  )
}

/**
 * Gets all atomic state values from a state value.
 *
 * @since 0.1.0
 * @category Accessors
 */
export const getAtomicStateValues = (value: StateValue): HashSet.HashSet<string> => {
  const result: Array<string> = []

  const collect = (v: StateValue, path: ReadonlyArray<string>): void => {
    if (isAtomicStateValue(v)) {
      result.push([...path, v].join("."))
      return
    }
    for (const [key, child] of Object.entries(v)) {
      collect(child, [...path, key])
    }
  }

  collect(value, [])
  return HashSet.fromIterable(result)
}

/**
 * Merges two state values. The second value takes precedence.
 *
 * @since 0.1.0
 * @category Combinators
 */
export const merge = (a: StateValue, b: StateValue): StateValue => {
  if (isAtomicStateValue(a) || isAtomicStateValue(b)) {
    return b
  }

  // Build merged result - using mutable record then freezing ensures type safety
  const mutableResult: { [key: string]: StateValue } = { ...a }
  for (const [key, value] of Object.entries(b)) {
    const existing = Option.fromNullishOr(mutableResult[key])
    if (Option.isSome(existing)) {
      mutableResult[key] = merge(existing.value, value)
    } else {
      mutableResult[key] = value
    }
  }
  // Return as StateValueMap (structurally compatible)
  const result: StateValueMap = mutableResult
  return result
}

/**
 * Gets the first-level state key from a state value.
 *
 * @since 0.1.0
 * @category Accessors
 */
export const getFirstKey = (value: StateValue): Option.Option<string> => {
  if (isAtomicStateValue(value)) {
    return Option.some(value)
  }
  const k = keys(value)
  return Arr.head(k)
}

/**
 * Checks if a state value contains a specific state path.
 *
 * @since 0.1.0
 * @category Predicates
 */
export const hasPath = (value: StateValue, path: ReadonlyArray<string>): boolean => {
  if (path.length === 0) {
    return true
  }

  if (isAtomicStateValue(value)) {
    return path.length === 1 && path[0] === value
  }

  const [head, ...tail] = path
  const child = Option.fromNullishOr(value[head!])
  if (Option.isNone(child)) {
    return false
  }
  return hasPath(child.value, tail)
}

/**
 * Collects all state IDs that are active in a state value.
 *
 * @since 0.1.0
 * @category Accessors
 */
export const getActiveStateIds = (
  value: StateValue,
  machineId: string
): Chunk.Chunk<string> => {
  const result: Array<string> = []

  const collect = (v: StateValue, path: ReadonlyArray<string>): void => {
    const id = path.length === 0
      ? machineId
      : `${machineId}.${path.join(".")}`
    result.push(id)

    if (!isAtomicStateValue(v)) {
      for (const [key, child] of Object.entries(v)) {
        collect(child, [...path, key])
      }
    }
  }

  collect(value, [])
  return Chunk.fromIterable(result)
}
