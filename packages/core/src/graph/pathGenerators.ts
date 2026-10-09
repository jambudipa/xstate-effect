/**
 * @since 0.1.0
 * @module graph/pathGenerators
 *
 * The path generators a test model uses (upstream `src/graph/pathGenerators.ts` at
 * xstate@5.33.2).
 */
import type { EventObject } from "../Event.js"
import type { Snapshot } from "../Snapshot.js"
import { getShortestPaths } from "./shortestPaths.js"
import { getSimplePaths } from "./simplePaths.js"
import type { PathGenerator } from "./types.js"

/**
 * A path generator of the shortest paths ({@link getShortestPaths}).
 *
 * @since 0.1.0
 * @category Graph
 */
export const createShortestPathsGen =
  <TSnapshot extends Snapshot, TEvent extends EventObject, TInput>(): PathGenerator<TSnapshot, TEvent, TInput> =>
  (logic, defaultOptions) =>
    getShortestPaths(logic, defaultOptions)

/**
 * A path generator of the simple paths ({@link getSimplePaths}).
 *
 * @since 0.1.0
 * @category Graph
 */
export const createSimplePathsGen =
  <TSnapshot extends Snapshot, TEvent extends EventObject, TInput>(): PathGenerator<TSnapshot, TEvent, TInput> =>
  (logic, defaultOptions) =>
    getSimplePaths(logic, defaultOptions)
