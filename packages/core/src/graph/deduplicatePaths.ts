/**
 * @since 0.1.0
 * @module graph/deduplicatePaths
 *
 * Path deduplication (upstream `src/graph/deduplicatePaths.ts` at xstate@5.33.2).
 */
import type { EventObject } from "../Event.js"
import type { Snapshot } from "../Snapshot.js"
import type { StatePath } from "./types.js"
import { simpleStringify } from "./utils.js"

/** A path with the keys of its events, which the subpath check compares. */
interface PathWithEventSequence<TSnapshot extends Snapshot, TEvent extends EventObject> {
  /** The path as given; the result returns this same object. */
  readonly path: StatePath<TSnapshot, TEvent>
  /** The `serializeEvent` key of each step's event, in step order. */
  readonly eventSequence: ReadonlyArray<string>
}

/**
 * Whether the event sequence of `path` starts the event sequence of `superpath` (each event
 * of `path` equals the event of `superpath` at the same index).
 */
const isSubpathOf = <TSnapshot extends Snapshot, TEvent extends EventObject>(
  path: PathWithEventSequence<TSnapshot, TEvent>,
  superpath: PathWithEventSequence<TSnapshot, TEvent>
): boolean => path.eventSequence.every((event, i) => event === superpath.eventSequence[i])

/**
 * Deduplicates your paths so that A -> B is not executed separately to A -> B -> C: the
 * paths, longest first, without each path whose event sequence starts the sequence of a
 * longer path kept before it.
 *
 * @since 0.1.0
 * @category Internal
 */
export const deduplicatePaths = <TSnapshot extends Snapshot, TEvent extends EventObject>(
  paths: Array<StatePath<TSnapshot, TEvent>>,
  serializeEvent: (event: TEvent) => string = simpleStringify
): Array<StatePath<TSnapshot, TEvent>> => {
  /** Put all paths on the same level so we can dedup them */
  const allPathsWithEventSequence: Array<PathWithEventSequence<TSnapshot, TEvent>> = paths.map((path) => ({
    path,
    eventSequence: path.steps.map((step) => serializeEvent(step.event)),
  }))

  // Sort by path length, descending (a stable sort, as upstream's)
  allPathsWithEventSequence.sort((a, z) => z.path.steps.length - a.path.steps.length)

  const superpathsWithEventSequence: Array<PathWithEventSequence<TSnapshot, TEvent>> = []

  /** Filter out the paths that are subpaths of superpaths */
  for (const pathWithEventSequence of allPathsWithEventSequence) {
    // If the path is a subpath of an existing superpath, do not add it to the superpaths
    if (!superpathsWithEventSequence.some((superpath) => isSubpathOf(pathWithEventSequence, superpath))) {
      superpathsWithEventSequence.push(pathWithEventSequence)
    }
  }

  return superpathsWithEventSequence.map((path) => path.path)
}
