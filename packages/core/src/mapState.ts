/**
 * @since 0.1.0
 * @module mapState
 *
 * XState `mapState` (`src/mapState.ts` at xstate@5.33.2): maps a machine snapshot to one
 * result for each active state node whose mapper has a `map` function.
 */
import { Array as Arr, Option } from "effect"
import type { MachineSnapshot } from "./Snapshot.js"
import type { StateNode } from "./StateNode.js"
import { isAtomicStateNode } from "./stateUtils.js"
import type { StateSchema } from "./Types.js"

/**
 * The child state schemas of a state schema by key: none for a node without child states,
 * any key for the wide `StateSchema`.
 *
 * @since 0.1.0
 * @category Models
 */
export type ChildStateSchemas<TSchema> = TSchema extends { readonly states?: infer TStates }
  ? NonNullable<TStates>
  : Record<never, never>

/**
 * A mapper object (upstream `StateSchemaMapper`): `map` turns the snapshot into a result
 * while its state is active, and `states` holds the mappers of the child states by key, as
 * deep as the machine's states. The keys come from the state schema `TSchema`: a key that
 * names no child state is a type error for a `setup` machine; the wide `StateSchema` of a
 * machine built without `setup` takes any key.
 *
 * @since 0.1.0
 * @category Models
 */
export interface StateMapper<TSnapshot, TResult, TSchema = StateSchema> {
  /** Maps the snapshot to a value when this state is active. */
  readonly map?: (snapshot: TSnapshot) => TResult
  /** Nested mappers for child states. */
  readonly states?: {
    readonly [K in keyof ChildStateSchemas<TSchema>]?: StateMapper<TSnapshot, TResult, ChildStateSchemas<TSchema>[K]>
  }
}

/**
 * One result of {@link mapState}: an active state node and what its mapper returned.
 *
 * @since 0.1.0
 * @category Models
 */
export interface MapStateResult<TResult> {
  readonly stateNode: StateNode.Any
  readonly result: TResult
}

/**
 * The mapper at a state node path: each key steps into `states` (upstream `findMapper`);
 * none when a step has no `states` or no mapper for the key.
 */
const findMapper = <TSnapshot, TResult>(
  mapper: StateMapper<TSnapshot, TResult>,
  path: ReadonlyArray<string>
): Option.Option<StateMapper<TSnapshot, TResult>> =>
  path.reduce(
    (current: Option.Option<StateMapper<TSnapshot, TResult>>, key) =>
      Option.flatMap(current, (found) =>
        Option.flatMap(Option.fromNullishOr(found.states), (states) =>
          Object.hasOwn(states, key) ? Option.fromNullishOr(states[key]) : Option.none()
        )
      ),
    Option.some(mapper)
  )

/** The node and its ancestors, up to the root. */
const ancestry = (stateNode: StateNode.Any): ReadonlyArray<StateNode.Any> => [
  stateNode,
  ...Option.match(stateNode.parent, { onNone: (): ReadonlyArray<StateNode.Any> => [], onSome: ancestry }),
]

/**
 * Maps a machine snapshot to a list of results, one for each active state node whose mapper
 * (found by the node's path through nested `states`) has a `map`, called with the snapshot
 * (upstream `mapState`). It walks from each active atomic state node up to the root and
 * visits each node once, so the results are leaf to root, the most specific state first, and
 * an ancestor that parallel regions share comes once, after the first region's nodes.
 *
 * It walks the atomic nodes in the order of the snapshot's `_nodes`, the order they became
 * active, as upstream: after a transition changes the active node of a parallel region that
 * is not the last, that region's nodes come after the later regions' (for `{ A: "a2", B:
 * "b1" }` reached by `a1 → a2`: b1, B, root, a2, A).
 *
 * @example
 * ```ts
 * // machine: { context: { count: 42 }, initial: "a", states: { a: { initial: "one", states: { one: {} } } } }
 * mapState(snapshot, {
 *   map: ({ context }) => `root:${context.count}`,
 *   states: { a: { states: { one: { map: () => "one" } } } }
 * })
 * // [{ stateNode: <one>, result: "one" }, { stateNode: <root>, result: "root:42" }]
 * ```
 *
 * @since 0.1.0
 * @category Utilities
 */
export const mapState = <TSnapshot extends MachineSnapshot.Any, TResult>(
  snapshot: TSnapshot,
  mapper: StateMapper<TSnapshot, TResult, MachineSnapshot.StateSchemaOf<TSnapshot>>
): Array<MapStateResult<TResult>> => {
  // From each active atomic node up to the first node an earlier walk visited (upstream's
  // `visited` set: the visited nodes always include every ancestor of a visited node)
  const visited = snapshot._nodes
    .filter(isAtomicStateNode)
    .reduce(
      (seen: ReadonlyArray<StateNode.Any>, atomicNode) => [
        ...seen,
        ...Arr.takeWhile(ancestry(atomicNode), (stateNode) => !seen.includes(stateNode)),
      ],
      []
    )
  return visited.flatMap((stateNode) =>
    Option.match(
      Option.flatMap(findMapper(mapper, stateNode.path), (found) => Option.fromNullishOr(found.map)),
      {
        onNone: (): Array<MapStateResult<TResult>> => [],
        onSome: (map) => [{ stateNode, result: map(snapshot) }],
      }
    )
  )
}
