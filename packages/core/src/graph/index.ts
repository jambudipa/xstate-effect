/**
 * @since 0.1.0
 * @module graph
 *
 * The graph entry point (upstream `xstate/graph`, `src/graph/index.ts` at xstate@5.33.2):
 * adjacency maps, shortest and simple paths, paths from event sequences, directed graphs and
 * test models. The traversals run the logic's transitions, so they return Effects (SD-13);
 * the functions that walk the state node tree or a built map stay synchronous.
 */
export { TestModel, createTestModel } from "./TestModel.js"
export { adjacencyMapToArray, getAdjacencyMap } from "./adjacency.js"
export { getStateNodes, joinPaths, serializeSnapshot, toDirectedGraph } from "./graph.js"
export type { AdjacencyMap, AdjacencyValue } from "./types.js"
export { getPathsFromEvents } from "./pathFromEvents.js"
export * from "./pathGenerators.js"
export { getShortestPaths } from "./shortestPaths.js"
export { getSimplePaths } from "./simplePaths.js"
export type * from "./types.js"
export {
  InvalidEventSequenceError,
  JoinPathsError,
  TraversalLimitError,
  UnsupportedTestMachineError,
} from "./errors.js"
