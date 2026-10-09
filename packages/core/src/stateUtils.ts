/**
 * @since 0.1.0
 * @module stateUtils
 *
 * The transition engine of XState 5.33.2 (`src/stateUtils.ts`), ported over the linked
 * `StateNode` tree.
 *
 * A configuration is the set of active state nodes. The functions here resolve transition
 * targets (`resolveTarget`), complete a configuration (`getAllStateNodes`), turn it into a
 * state value (`getStateValue`), test completion (`isInFinalState`), select the
 * transitions for an event (`transitionNode`, `getCandidates`), plan a microstep (which
 * transitions survive conflict removal, which nodes exit and enter, which history each
 * exit records and each history state restores, which actions run, in SCXML order, and
 * which parents and whether the machine complete when a final node is entered:
 * `microstep`, `initialMicrostep`), run actions (`runActions`) and process one event
 * (`macrostep`, `initialMacrostep`): the macrostep loop takes the eventless transitions
 * and the events raised into its internal queue, `xstate.done.state.*` events included,
 * until the snapshot is stable or done, bounded by `options.maxIterations`. Target
 * resolution and the microstep plan are pure; selection runs guards and `runActions` runs
 * actions, so they are Effects (SD-13). This module builds no native `Set` or `Map` (SD-22,
 * amended 2026-10-08): where upstream's insertion order is observable (configurations, exit
 * sets, targets, transitions, tags), an upstream `Set` or `Map` is an ordered list that holds
 * each member once, built with immutable updates; where only membership or a key is read,
 * it is a `HashSet`, `HashMap`, `MutableHashSet` or `MutableHashMap`, whose hash order is
 * never read.
 *
 * A microstep starts the invocations of each node it enters and stops those of each node
 * it exits, as `spawnChild` and `stopChild` actions (upstream `enterStates` and
 * `exitStates`). Not ported here yet: stopping every child of a snapshot that is no longer
 * active, at the end of the macrostep (upstream `stopChildren`).
 */
import { Cause, Chunk, Context, Deferred, Effect, Exit, HashMap, HashSet, MutableHashMap, MutableHashSet, Option, Predicate, Result } from "effect"
import type { ActorLogic, ActorScopeService, AnyActorLogic, CustomActionExecution } from "./ActorLogic.js"
import { createActionArgs, createActionContext, createActionInfo, resolveAction } from "./ActorLogic.js"
import type { ActorRefBase } from "./ActorRef.js"
import type { EventObject } from "./Event.js"
import { DoneStateEvent, ErrorActorEvent, isErrorActorEvent, isWildcardType, matchEventDescriptor } from "./Event.js"
import { ActorError, GuardError, MachineDefinitionError, TransitionError } from "./Errors.js"
import type { UpstreamAny } from "./internal/anyEventObject.js"
import { resolveDelay } from "./internal/delay.js"
import { isStopEvent } from "./internal/stopEvent.js"
import type { MachineSnapshot } from "./Snapshot.js"
import * as Snapshot from "./Snapshot.js"
import type { AnyStateNode, StateNode } from "./StateNode.js"
import type { StateValue, StateValueMap } from "./StateValue.js"
import { toStatePath } from "./StateValue.js"
import { spawnChild } from "./actions/spawnChild.js"
import { stopChild } from "./actions/stopChild.js"
import { evaluateGuard } from "./guards/evaluateGuard.js"
import { createSpawner, spawnRequested } from "./spawn.js"
import type { Action, ActionContext, ActionResult, DelayedTransitionDefinition, Guard, TransitionDefinition } from "./Types.js"
import * as Types from "./Types.js"

// ============================================================
// TYPES
// ============================================================

/**
 * An action as a state node or transition holds it: any XState action form, or a port
 * definition (D15).
 *
 * @since 0.1.0
 * @category Models
 */
export type ActionLike<TContext, TEvent extends EventObject> = Action<TContext, TEvent>

/**
 * A transition the engine takes: its source node, its target nodes (empty for a targetless
 * transition), whether it has a target list at all, whether it re-enters, and its actions.
 *
 * @since 0.1.0
 * @category Models
 */
export interface MicrostepTransition<TContext, TEvent extends EventObject> {
  readonly source: StateNode<TContext, TEvent>
  readonly target: ReadonlyArray<StateNode<TContext, TEvent>>
  /**
   * The transition definition selection took the transition from (upstream selects the
   * definitions themselves); none for the initial transition, which no node defines.
   */
  readonly definition: Option.Option<TransitionDefinition<TContext, TEvent>>
  readonly reenter: boolean
  readonly actions: ReadonlyArray<ActionLike<TContext, TEvent>>
}

/**
 * The plan of one microstep (SCXML microstep procedure).
 *
 * @since 0.1.0
 * @category Models
 */
/**
 * A range of a microstep's `actions`, `from` included and `to` not, and the actor ids whose
 * `sendTo` in it resolves after it.
 *
 * @since 0.1.0
 * @category Models
 */
export interface DeferredActorIds {
  readonly from: number
  readonly to: number
  readonly ids: ReadonlyArray<string>
}

export interface Microstep<TContext, TEvent extends EventObject> {
  /**
   * Every active node after the microstep, in the order they became active (upstream
   * `_nodes`): the nodes of the configuration it started from that it did not exit, in their
   * order, then the nodes it entered, in document order. When the microstep completes the
   * machine, every node in reverse document order (upstream sorts its node list in place
   * for the exit actions, `src/stateUtils.ts:1104`).
   */
  readonly configuration: ReadonlyArray<StateNode<TContext, TEvent>>
  /** The nodes the microstep exits, in exit order (reverse document order). */
  readonly exited: ReadonlyArray<StateNode<TContext, TEvent>>
  /** The nodes the microstep enters, in document order. */
  readonly entered: ReadonlyArray<StateNode<TContext, TEvent>>
  /**
   * The actions to run, in order: the exit actions of each exited node, each followed by a
   * `stopChild` per invocation of the node, the transition actions, then the entry actions
   * of each entered node followed by a `spawnChild` per invocation of the node and its
   * initial transition's actions when the node is entered by default. When the microstep
   * completes the machine, the exit actions of every active node follow, in reverse
   * document order.
   */
  readonly actions: ReadonlyArray<ActionLike<TContext, TEvent>>
  /** What entering each final node completes, in entry order, each placed in `actions`. */
  readonly completions: ReadonlyArray<Completion<TContext, TEvent>>
  /**
   * The entry list of each entered node that invokes (its entry actions, the `spawnChild` of
   * each invocation and its initial actions), as a range of `actions`, with the string ids of
   * its invocations: a `sendTo` in that range that names one of them resolves after the range
   * (upstream `enterStates` passes them as `deferredActorIds`).
   */
  readonly deferredActorIds: ReadonlyArray<DeferredActorIds>
  /**
   * The history value after the microstep: the one it started from, with the record of
   * each history child of an exited node replaced by the configuration it exited from.
   */
  readonly historyValue: ResolvedHistoryValue<TContext, TEvent>
}

/**
 * A node that completes: it raises `xstate.done.state.<stateNode id>` into the internal
 * queue. The event carries the output of `finalStateNode`, the final child of a compound
 * node, and none for a parallel node.
 *
 * @since 0.1.0
 * @category Models
 */
export interface DoneState<TContext, TEvent extends EventObject> {
  readonly stateNode: StateNode<TContext, TEvent>
  readonly finalStateNode: Option.Option<StateNode<TContext, TEvent>>
}

/**
 * What entering one final node completes (upstream `enterStates`). It takes effect after
 * the first `afterActions` actions of the microstep (the final node's entry actions
 * included), so each output reads the context those actions left.
 *
 * @since 0.1.0
 * @category Models
 */
export interface Completion<TContext, TEvent extends EventObject> {
  readonly afterActions: number
  /** The nodes that complete, bottom-up, in the order their done events are raised. */
  readonly doneStates: ReadonlyArray<DoneState<TContext, TEvent>>
  /**
   * Some when the machine completes: the node whose done event the root output receives
   * (upstream `rootCompletionNode`, read by `getMachineOutput`).
   */
  readonly machineDone: Option.Option<StateNode<TContext, TEvent>>
}

/**
 * The configuration each history state node recorded, keyed by its id, as the machine's
 * own nodes (upstream `HistoryValue`). `Snapshot.HistoryValue` is the same value under a
 * type that fits every machine; `resolveHistoryValue` reads it back as this one.
 *
 * @since 0.1.0
 * @category Models
 */
export type ResolvedHistoryValue<TContext, TEvent extends EventObject> = Readonly<
  Record<string, ReadonlyArray<StateNode<TContext, TEvent>>>
>

/**
 * The definition errors one engine walk meets. Upstream resolves `initial` and a history
 * default target lazily and throws when it needs a missing child; the walk records the
 * error instead, and the entry points return the first one.
 */
interface Walk {
  readonly errors: Array<MachineDefinitionError>
}

const newWalk = (): Walk => ({ errors: [] })

/** What the exit and entry set computations read: the recorded history and the walk. */
interface SetContext<TContext, TEvent extends EventObject> {
  readonly historyValue: ResolvedHistoryValue<TContext, TEvent>
  readonly walk: Walk
}

const byDocumentOrder = <TContext, TEvent extends EventObject>(
  a: StateNode<TContext, TEvent>,
  b: StateNode<TContext, TEvent>
): number => a.order - b.order

/**
 * The list with `item` added at the end unless it holds it already: upstream's `set.add` on
 * the insertion-ordered native `Set` the list stands for (SD-22, amended 2026-10-08).
 */
const appendOnce = <A>(items: ReadonlyArray<A>, item: A): ReadonlyArray<A> => (items.includes(item) ? items : [...items, item])

/** Each member once, in the order it first comes (upstream `new Set(iterable)`, iterated). */
const distinct = <A>(items: Iterable<A>): ReadonlyArray<A> => Array.from(items).reduce<ReadonlyArray<A>>(appendOnce, [])

// ============================================================
// NODE HELPERS
// ============================================================

/**
 * Whether the node is atomic: `atomic` or `final` (upstream `isAtomicStateNode`).
 *
 * @since 0.1.0
 * @category Predicates
 */
export const isAtomicStateNode = <TContext, TEvent extends EventObject>(stateNode: StateNode<TContext, TEvent>): boolean =>
  stateNode.type === "atomic" || stateNode.type === "final"

const isHistoryNode = <TContext, TEvent extends EventObject>(stateNode: StateNode<TContext, TEvent>): boolean =>
  stateNode.type === "history"

/**
 * The child of a node at a key: an own key of its `states` object only (`StateNode.getChild`,
 * kept here so this module imports no value from `StateNode.ts`, which imports
 * {@link transitionMap} from here).
 */
const getChild = <TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, TEvent>,
  key: string
): Option.Option<StateNode<TContext, TEvent>> =>
  Object.hasOwn(stateNode.states, key) ? Option.fromNullishOr(stateNode.states[key]) : Option.none()

/**
 * A state node's transitions by event descriptor: one entry per descriptor, in declaration
 * order (upstream `StateNode.transitions`, a native `Map`, which the port no longer builds:
 * SD-22, amended 2026-10-08). Read a descriptor's list with {@link transitionsOfDescriptor};
 * iterate the entries as upstream iterates the `Map`.
 *
 * @since 0.1.0
 * @category Models
 */
export type TransitionEntries<TContext, TEvent extends EventObject, TMeta = unknown> = ReadonlyArray<
  readonly [descriptor: string, transitions: ReadonlyArray<TransitionDefinition<TContext, TEvent, TMeta>>]
>

/**
 * The transitions of one event descriptor (upstream `transitions.get(descriptor)`); none when
 * no entry has that descriptor.
 *
 * @since 0.1.0
 * @category Transition Selection
 */
export const transitionsOfDescriptor = <TContext, TEvent extends EventObject, TMeta>(
  transitions: TransitionEntries<TContext, TEvent, TMeta>,
  descriptor: string
): Option.Option<ReadonlyArray<TransitionDefinition<TContext, TEvent, TMeta>>> =>
  Option.map(Option.fromNullishOr(transitions.find(([known]) => known === descriptor)), ([, list]) => list)

/**
 * A state node's transitions by event descriptor (upstream `formatTransitions` builds them
 * as a `Map`; the port as ordered entries, SD-22 amended 2026-10-08): each `set` entry in
 * order, a later entry for the same descriptor replacing the list in its first position
 * (upstream `transitions.set`), then each `appended` list joined to the descriptor's list or
 * added after the others (upstream's delayed transitions). Declaration order is what
 * `getCandidates` reads and `StateNode.on` keeps.
 *
 * @since 0.1.0
 * @category Transition Selection
 */
export const transitionMap = <TContext, TEvent extends EventObject, TMeta = unknown>(
  set: Iterable<readonly [string, ReadonlyArray<TransitionDefinition<TContext, TEvent, TMeta>>]>,
  appended: Iterable<readonly [string, ReadonlyArray<TransitionDefinition<TContext, TEvent, TMeta>>]> = []
): TransitionEntries<TContext, TEvent, TMeta> => {
  type Entries = TransitionEntries<TContext, TEvent, TMeta>
  // Upstream `transitions.set`: a descriptor that has an entry keeps its position
  const setEntry = (entries: Entries, [descriptor, list]: Entries[number]): Entries =>
    entries.some(([known]) => known === descriptor)
      ? entries.map((entry): Entries[number] => (entry[0] === descriptor ? [descriptor, list] : entry))
      : [...entries, [descriptor, list]]
  return Array.from(appended).reduce(
    (entries: Entries, [descriptor, list]) =>
      setEntry(entries, [descriptor, [...Option.getOrElse(transitionsOfDescriptor(entries, descriptor), () => []), ...list]]),
    Array.from(set).reduce(setEntry, [])
  )
}

/**
 * The id of a state node's invocation that names no id (upstream `createInvokeId`):
 * `<index>.<node id>`, the index being the invocation's position in the node's `invoke`
 * list. The invocation's done, error and snapshot events carry it
 * (`xstate.done.actor.<id>`), and inline logic gets the source name
 * `xstate.invoke.<index>.<node id>`.
 *
 * @example
 * ```ts
 * createInvokeId("(machine).loading", 0) // "0.(machine).loading"
 * ```
 *
 * @since 0.1.0
 * @category Configuration
 */
export const createInvokeId = (stateNodeId: string, index: number): string => `${index}.${stateNodeId}`

/**
 * The source name of a state node's invocation (upstream `StateNode.invoke`, its `src`): a
 * string src as it is, and inline logic as `xstate.invoke.<index>.<node id>`, which
 * `resolveReferencedActor` (spawn.ts) resolves back to that logic. The child the invocation
 * spawns reports it as its `src`, so a persisted snapshot keeps a name for it.
 *
 * @example
 * ```ts
 * invokeSourceName("(machine).loading", 0, "fetchUser") // "fetchUser"
 * invokeSourceName("(machine).loading", 1, fetchLogic) // "xstate.invoke.1.(machine).loading"
 * ```
 *
 * @since 0.1.0
 * @category Configuration
 */
export const invokeSourceName = (stateNodeId: string, index: number, src: string | AnyActorLogic): string =>
  typeof src === "string" ? src : `xstate.invoke.${createInvokeId(stateNodeId, index)}`

/** The children of a node that are not history nodes, in document order. */
const getChildren = <TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, TEvent>
): Array<StateNode<TContext, TEvent>> => Object.values(stateNode.states).filter((child) => child.type !== "history")

/** The root of the tree the node belongs to. */
const rootOf = <TContext, TEvent extends EventObject>(stateNode: StateNode<TContext, TEvent>): StateNode<TContext, TEvent> =>
  Option.match(stateNode.parent, { onNone: () => stateNode, onSome: rootOf })

/**
 * The proper ancestors of a node, from its parent upward, stopping before `toStateNode`
 * (none: up to and including the root). Empty when the node is `toStateNode` itself
 * (upstream `getProperAncestors`).
 *
 * @since 0.1.0
 * @category Configuration
 */
export const getProperAncestors = <TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, TEvent>,
  toStateNode: Option.Option<StateNode<TContext, TEvent>>
): Array<StateNode<TContext, TEvent>> => {
  if (Option.isSome(toStateNode) && toStateNode.value === stateNode) {
    return []
  }
  // From the marker up to, not including, `toStateNode`
  const from = (marker: Option.Option<StateNode<TContext, TEvent>>): Array<StateNode<TContext, TEvent>> =>
    Option.isSome(marker) && !(Option.isSome(toStateNode) && marker.value === toStateNode.value)
      ? [marker.value, ...from(marker.value.parent)]
      : []
  return from(stateNode.parent)
}

/**
 * Whether `child` is a strict descendant of `parent` (upstream `isDescendant`). With no
 * parent, every node counts as a descendant, as upstream's `undefined` domain of a
 * re-entering root transition does.
 */
const isDescendant = <TContext, TEvent extends EventObject>(
  child: StateNode<TContext, TEvent>,
  parent: Option.Option<StateNode<TContext, TEvent>>
): boolean => {
  const isParent = (candidate: Option.Option<StateNode<TContext, TEvent>>): boolean =>
    Option.isNone(parent) ? Option.isNone(candidate) : Option.isSome(candidate) && candidate.value === parent.value
  let marker = child
  while (Option.isSome(marker.parent) && !isParent(marker.parent)) {
    marker = marker.parent.value
  }
  return isParent(marker.parent)
}

/**
 * The initial child of a compound node: the child its `initial` key names. A key that
 * names no child is recorded on the walk with the upstream message
 * (`src/stateUtils.ts:453`), and the node is entered without a child.
 */
const initialChild = <TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, TEvent>,
  walk: Walk
): Option.Option<StateNode<TContext, TEvent>> => {
  const key = Option.flatMap(stateNode._initial, (initial) => Option.fromNullishOr(initial.target[0]))
  const child = Option.flatMap(key, (initialKey) => getChild(stateNode, initialKey))
  if (Option.isNone(child)) {
    walk.errors.push(
      new MachineDefinitionError({
        message: `Initial state node "${Option.getOrElse(key, () => "undefined")}" not found on parent state node #${stateNode.id}`,
      })
    )
  }
  return child
}

// ============================================================
// CONFIGURATION
// ============================================================

/**
 * The default-entry set of a node, in the order upstream's `Set` gets its members: the node,
 * the initial child of each compound node on the way down, and every child of each parallel
 * node (upstream `getInitialStateNodes`).
 */
const getInitialStateNodes = <TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, TEvent>,
  walk: Walk
): ReadonlyArray<StateNode<TContext, TEvent>> => {
  const iter = (
    visited: ReadonlyArray<StateNode<TContext, TEvent>>,
    descStateNode: StateNode<TContext, TEvent>
  ): ReadonlyArray<StateNode<TContext, TEvent>> => {
    if (visited.includes(descStateNode)) {
      return visited
    }
    const withNode = [...visited, descStateNode]
    if (descStateNode.type === "compound") {
      return Option.match(initialChild(descStateNode, walk), {
        onNone: () => withNode,
        onSome: (child) => iter(withNode, child),
      })
    }
    return descStateNode.type === "parallel"
      ? getChildren(descStateNode).reduce<ReadonlyArray<StateNode<TContext, TEvent>>>(iter, withNode)
      : withNode
  }
  return iter([], stateNode)
}

/** The default-entry set of a node plus the ancestors of its members up to the node. */
const getInitialStateNodesWithTheirAncestors = <TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, TEvent>,
  walk: Walk
): ReadonlyArray<StateNode<TContext, TEvent>> => {
  const states = getInitialStateNodes(stateNode, walk)
  // Every ancestor up to the node lies on the way down to a member, so it is a member already
  // and the members this adds (none) need no visit of their own
  return states.reduce<ReadonlyArray<StateNode<TContext, TEvent>>>(
    (withAncestors, initialState) => getProperAncestors(initialState, Option.some(stateNode)).reduce(appendOnce, withAncestors),
    states
  )
}

const completeConfiguration = <TContext, TEvent extends EventObject>(
  stateNodes: Iterable<StateNode<TContext, TEvent>>,
  walk: Walk
): ReadonlyArray<StateNode<TContext, TEvent>> => {
  let nodes = distinct(stateNodes)
  const adjList = getAdjList(nodes)
  const hasActiveChild = (stateNode: StateNode<TContext, TEvent>): boolean =>
    Option.exists(HashMap.get(adjList, stateNode), (children) => children.length > 0)

  // add descendants (the index walk visits the members it adds, as upstream's iteration of
  // its growing `Set` does)
  for (let index = 0; index < nodes.length; index++) {
    const s = nodes[index]
    if (s?.type === "compound" && !hasActiveChild(s)) {
      nodes = getInitialStateNodesWithTheirAncestors(s, walk).reduce(appendOnce, nodes)
    } else if (s?.type === "parallel") {
      nodes = getChildren(s).reduce(
        (withRegions, child) =>
          withRegions.includes(child) ? withRegions : getInitialStateNodesWithTheirAncestors(child, walk).reduce(appendOnce, withRegions),
        nodes
      )
    }
  }

  // add all ancestors, each node's from its parent up
  for (let index = 0; index < nodes.length; index++) {
    const s = nodes[index]
    if (s !== undefined) {
      nodes = getProperAncestors(s, Option.none()).reduce(appendOnce, nodes)
    }
  }

  return nodes
}

/**
 * Completes a set of nodes into a full configuration: a compound node with no active
 * child gets its initial descendants, a parallel node gets every region, and every node
 * gets its ancestors (upstream `getAllStateNodes`). An `initial` key that names no child
 * leaves that compound node without a child here; the microstep entry points report it.
 * Upstream gives a native `Set`; the port gives its members once each, in that `Set`'s
 * insertion order (SD-22, amended 2026-10-08).
 *
 * @since 0.1.0
 * @category Configuration
 */
export const getAllStateNodes = <TContext, TEvent extends EventObject>(
  stateNodes: Iterable<StateNode<TContext, TEvent>>
): ReadonlyArray<StateNode<TContext, TEvent>> => completeConfiguration(stateNodes, newWalk())

/** Parent → active children in the order the nodes come (upstream `getAdjList`, a `Map`). */
type AdjList<TContext, TEvent extends EventObject> = HashMap.HashMap<
  StateNode<TContext, TEvent>,
  ReadonlyArray<StateNode<TContext, TEvent>>
>

/**
 * Parent → active children, in the order the nodes come (upstream `getAdjList`): an entry
 * for each node and for each node's parent. The keys are nodes, equal by identity; only the
 * lists hold an order, so the hash order of the keys is never read.
 */
const getAdjList = <TContext, TEvent extends EventObject>(
  stateNodes: Iterable<StateNode<TContext, TEvent>>
): AdjList<TContext, TEvent> =>
  Array.from(stateNodes).reduce((adjList: AdjList<TContext, TEvent>, s) => {
    const withNode = HashMap.has(adjList, s) ? adjList : HashMap.set(adjList, s, [])
    return Option.match(s.parent, {
      onNone: () => withNode,
      onSome: (parent) =>
        HashMap.set(withNode, parent, [...Option.getOrElse(HashMap.get(withNode, parent), () => []), s]),
    })
  }, HashMap.empty())

/** The state value below `baseNode` (upstream `getValueFromAdj`). */
const getValueFromAdj = <TContext, TEvent extends EventObject>(
  baseNode: StateNode<TContext, TEvent>,
  adjList: AdjList<TContext, TEvent>
): StateValue =>
  Option.match(HashMap.get(adjList, baseNode), {
    onNone: (): StateValue => ({}),
    onSome: (childStateNodes): StateValue => {
      if (baseNode.type === "compound") {
        const childStateNode = Option.fromNullishOr(childStateNodes[0])
        if (Option.isNone(childStateNode)) {
          return {}
        }
        if (isAtomicStateNode(childStateNode.value)) {
          return childStateNode.value.key
        }
      }

      const stateValue: Record<string, StateValue> = {}
      for (const childStateNode of childStateNodes) {
        stateValue[childStateNode.key] = getValueFromAdj(childStateNode, adjList)
      }
      return stateValue
    },
  })

/**
 * The state value of a configuration, completed first (upstream `getStateValue`): a
 * compound node with an atomic active child gives the child's key, any other node gives
 * an object of its active children, and an atomic child of a parallel node gives `{}`. The
 * nodes are of any meta, as upstream's `AnyStateNode`s (SD-22 amendment, goal journal
 * `2026-10-07-13-node-containers-any.md`).
 *
 * @since 0.1.0
 * @category Configuration
 */
export const getStateValue = <TContext, TEvent extends EventObject>(
  rootNode: StateNode<TContext, TEvent, UpstreamAny, UpstreamAny>,
  stateNodes: Iterable<StateNode<TContext, TEvent, UpstreamAny, UpstreamAny>>
): StateValue => getValueFromAdj<TContext, TEvent>(rootNode, getAdjList<TContext, TEvent>(getAllStateNodes<TContext, TEvent>(stateNodes)))

/**
 * The transitions of a state node by event descriptor (upstream `formatTransitions`, which
 * builds them from the node's config when the node is created): the node's
 * {@link StateNode.transitions} as a new list of `[descriptor, transitions]` entries with new
 * arrays, in declaration order, with the same definition objects, of any meta (SD-22
 * amendment, goal journal `2026-10-07-13-node-containers-any.md`). Upstream gives a native
 * `Map`; the port gives that `Map`'s entries in its order (SD-22, amended 2026-10-08). The
 * port formats them when it builds the machine.
 *
 * @since 0.1.0
 * @category Transition Selection
 */
export const formatTransitions = <TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, TEvent, UpstreamAny, UpstreamAny>
): Array<[descriptor: string, transitions: Array<TransitionDefinition<TContext, TEvent, UpstreamAny>>]> =>
  stateNode.transitions.map(([descriptor, transitions]) => [descriptor, [...transitions]])

/**
 * The delayed transitions of a state node (upstream `getDelayedTransitions`, whose result
 * upstream keeps as the node's `after`): the node's {@link StateNode.after} as a new array,
 * one entry per transition of each `after` key in key order, each with its delay, of any
 * meta (SD-22 amendment, goal journal `2026-10-07-13-node-containers-any.md`). The port builds
 * them, and the `raise`/`cancel` entry and exit actions they need, when it builds the machine,
 * so a call adds no action (upstream's call pushes them on the node each time).
 *
 * @since 0.1.0
 * @category Transition Selection
 */
export const getDelayedTransitions = <TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, TEvent, UpstreamAny, UpstreamAny>
): Array<DelayedTransitionDefinition<TContext, TEvent, UpstreamAny>> => [...stateNode.after]

/**
 * Whether a node is complete in a configuration: a compound node has an active final
 * child, a parallel node has every region complete, and any other node is final
 * (upstream `isInFinalState`). Upstream takes the configuration as a native `Set`; the port
 * takes its nodes as a list and reads only which nodes it holds (SD-22, amended 2026-10-08).
 *
 * @since 0.1.0
 * @category Configuration
 */
export const isInFinalState = <TContext, TEvent extends EventObject>(
  stateNodes: ReadonlyArray<StateNode<TContext, TEvent>>,
  stateNode: StateNode<TContext, TEvent>
): boolean => {
  if (stateNode.type === "compound") {
    return getChildren(stateNode).some((child) => child.type === "final" && stateNodes.includes(child))
  }
  if (stateNode.type === "parallel") {
    return getChildren(stateNode).every((child) => isInFinalState(stateNodes, child))
  }
  return stateNode.type === "final"
}

/**
 * Whether a configuration completes its machine: the root is complete in it (upstream
 * `isInFinalState(new Set(_nodes), machine.root)`, the rule that gives a snapshot status
 * `done`).
 *
 * @since 0.1.0
 * @category Configuration
 */
export const isConfigurationDone = <TContext, TEvent extends EventObject>(
  configuration: Iterable<StateNode<TContext, TEvent>>,
  root: StateNode<TContext, TEvent>
): boolean => isInFinalState(Array.from(configuration), root)

/**
 * The tags of every node of a configuration, each once, in configuration order: the members
 * of upstream's `new Set(_nodes.flatMap((sn) => sn.tags))` in that `Set`'s order, as the list
 * a snapshot holds (SD-22, amended 2026-10-08).
 *
 * @since 0.1.0
 * @category Configuration
 */
export const getConfigurationTags = <TContext, TEvent extends EventObject>(
  configuration: Iterable<StateNode<TContext, TEvent>>
): ReadonlyArray<string> => distinct(Array.from(configuration).flatMap((stateNode) => stateNode.tags))

/**
 * The full configuration a state value names, in upstream
 * `getAllStateNodes(getStateNodes(root, value))` order (see {@link configurationOfValue});
 * none when the value names a state that does not exist.
 *
 * @since 0.1.0
 * @category Configuration
 */
export const resolveConfiguration = <TContext, TEvent extends EventObject>(
  rootNode: StateNode<TContext, TEvent>,
  stateValue: StateValue
): Option.Option<ReadonlyArray<StateNode<TContext, TEvent>>> =>
  Result.getSuccess(configurationOfValue({ ...lookupOf(rootNode), root: rootNode }, stateValue))

/**
 * The nodes a state value names from `stateNode` (upstream `getStateNodes`): for a string
 * value the node and that child, which must exist (`State '<value>' does not exist on
 * '<id>'`); for an object value the machine's root, the node, the node each key names (a
 * child or a `#id` node, with the `getStateNode` messages), then each of those nodes' own
 * list for its value. Duplicates stay, as upstream; a configuration goes through
 * {@link getAllStateNodes}.
 */
const stateNodesOfValue = <TContext, TEvent extends EventObject>(
  machine: NodeLookup<TContext, TEvent>,
  root: StateNode<TContext, TEvent>,
  stateNode: StateNode<TContext, TEvent>,
  stateValue: StateValue
): Result.Result<ReadonlyArray<StateNode<TContext, TEvent>>, string> =>
  typeof stateValue === "string"
    ? Option.match(getChild(stateNode, stateValue), {
        onNone: () => Result.fail(`State '${stateValue}' does not exist on '${stateNode.id}'`),
        onSome: (child) => Result.succeed([stateNode, child]),
      })
    : Result.flatMap(
        // Every key first, then each key's own list (upstream checks the keys in its `map`
        // before its `reduce` descends)
        Result.all(
          Object.entries(stateValue).map(([key, childValue]) =>
            Result.map(getStateNode(machine, stateNode, key), (child) => ({ child, childValue }))
          )
        ),
        (children) =>
          Result.map(
            Result.all(children.map(({ child, childValue }) => stateNodesOfValue(machine, root, child, childValue))),
            (lists): ReadonlyArray<StateNode<TContext, TEvent>> => [
              root,
              stateNode,
              ...children.map(({ child }) => child),
              ...lists.flat(),
            ]
          )
      )

/**
 * The state nodes a state value names from `stateNode` (upstream `getStateNodes`, the root
 * export; SD-11 keeps the graph function of that name in `./graph` only): for a string value
 * `[stateNode, child]`; for an object value `[machine root, stateNode, ...the node each key
 * names, ...each of those nodes' own list]`, duplicates included, as upstream (pass the list
 * through {@link getAllStateNodes} for a configuration). A key may name a node by `#id`.
 * Upstream throws for a value that names no state; this Effect fails with
 * `MachineDefinitionError` and the upstream message (SD-3).
 *
 * It takes any state node, as upstream (`AnyStateNode`): the nodes it gives have the type of
 * the node it takes, so a typed node gives typed nodes, and the root of an `AnyStateMachine`
 * gives `AnyStateNode`s.
 *
 * @example
 * ```ts
 * // machine: { initial: "a", states: { a: { initial: "one", states: { one: {} } } } }
 * getStateNodes(machine.root, "a") // Effect of [root, a]
 * getStateNodes(machine.root, { a: "one" }) // Effect of [root, root, a, a, one]
 * ```
 *
 * @since 0.1.0
 * @category Configuration
 */
export const getStateNodes = <TNode extends AnyStateNode>(
  stateNode: TNode,
  stateValue: StateValue
): Effect.Effect<ReadonlyArray<TNode>, MachineDefinitionError> => {
  // An `AnyStateNode` carries the `StateNodeTypeId` key, so it is a real node: the nodes of
  // its machine all have its own context, event and meta types, which the walk keeps
  const node = stateNode as unknown as StateNode<unknown, EventObject>
  return Result.match(
    stateNodesOfValue(
      lookupOf(node),
      Option.match(node.machine, { onNone: () => rootOf(node), onSome: (machine) => machine.root }),
      node,
      stateValue
    ),
    {
      onFailure: (message) => Effect.fail(new MachineDefinitionError({ message })),
      onSuccess: (stateNodes) => Effect.succeed(stateNodes as unknown as ReadonlyArray<TNode>),
    }
  )
}

/**
 * The full configuration a state value names, in the order upstream lists it
 * (`getAllStateNodes(getStateNodes(root, value))`, as `restoreSnapshot` reads a persisted
 * value): the root, the node each key names, then each of those nodes' own nodes, each node
 * once, then the initial descendants of a node the value leaves open. A snapshot built from
 * a value holds its nodes in this order (`_nodes`). Fails with the upstream message when
 * the value names a state that does not exist.
 *
 * @since 0.1.0
 * @category Configuration
 */
export const configurationOfValue = <TContext, TEvent extends EventObject>(
  machine: NodeLookup<TContext, TEvent> & { readonly root: StateNode<TContext, TEvent> },
  stateValue: StateValue
): Result.Result<ReadonlyArray<StateNode<TContext, TEvent>>, string> =>
  Result.map(stateNodesOfValue(machine, machine.root, machine.root, stateValue), getAllStateNodes)

/**
 * What a partial state value resolves to (upstream `StateMachine.resolveState`, before the
 * snapshot is built): the full configuration it names, in upstream order (`_nodes`), its
 * state value, and whether the machine is done in it.
 *
 * @since 0.1.0
 * @category Models
 */
export interface ResolvedState<TContext, TEvent extends EventObject> {
  readonly configuration: ReadonlyArray<StateNode<TContext, TEvent>>
  readonly value: StateValue
  readonly done: boolean
}

/**
 * Resolves a partial state value against the machine (upstream `StateMachine.resolveState`:
 * `getAllStateNodes(getStateNodes(root, resolveStateValue(root, value)))`): a compound node
 * the value leaves open enters its initial descendants, a parallel node every region. Fails
 * with `MachineDefinitionError` and the upstream message for a value that names no state
 * (SD-3, amended 2026-10-08: upstream throws).
 *
 * @since 0.1.0
 * @category Configuration
 */
export const resolveStateNodes = <TContext, TEvent extends EventObject>(
  machine: NodeLookup<TContext, TEvent> & { readonly root: StateNode<TContext, TEvent> },
  stateValue: StateValue
): Result.Result<ResolvedState<TContext, TEvent>, MachineDefinitionError> =>
  Result.mapError(
    // Upstream `resolveStateValue` first, then the nodes the full value names, in that order
    Result.flatMap(configurationOfValue(machine, stateValue), (partial) => {
      const value = getStateValue(machine.root, partial)
      return Result.map(configurationOfValue(machine, value), (configuration) => ({
        configuration,
        value,
        done: isConfigurationDone(configuration, machine.root),
      }))
    }),
    (message) => new MachineDefinitionError({ message })
  )

/**
 * The full state value of a partial one (upstream `resolveStateValue`): `#id` keys name the
 * node with that id, and every node the value leaves open is completed by default entry. An
 * Effect that fails with `MachineDefinitionError` and the upstream message for a value that
 * names no state (SD-3, amended 2026-10-08: upstream throws).
 *
 * @since 0.1.0
 * @category Configuration
 */
export const resolveStateValue = <TContext, TEvent extends EventObject>(
  rootNode: StateNode<TContext, TEvent>,
  stateValue: StateValue
): Effect.Effect<StateValue, MachineDefinitionError> =>
  Effect.fromResult(
    Result.map(resolveStateNodes({ ...lookupOf(rootNode), root: rootNode }, stateValue), (resolved) => resolved.value)
  )

// ============================================================
// TARGET RESOLUTION
// ============================================================

/**
 * The parts of a machine that a target lookup reads: its id (for the messages) and the
 * map from state node id to node.
 *
 * @since 0.1.0
 * @category Models
 */
export interface NodeLookup<TContext, TEvent extends EventObject> {
  readonly id: string
  readonly idMap: HashMap.HashMap<string, StateNode<TContext, TEvent>>
}

/** Whether a target or path segment names a state by id: it starts with `#` (upstream `isStateId`). */
const isStateId = (str: string): boolean => str.startsWith("#")

/**
 * The child of `stateNode` at `stateKey`, or the node a `#id` key names (upstream
 * `getStateNode`); fails with the upstream message. Every port node has a `states`
 * object, so upstream's "no child states exist" branch cannot occur.
 */
const getStateNode = <TContext, TEvent extends EventObject>(
  machine: NodeLookup<TContext, TEvent>,
  stateNode: StateNode<TContext, TEvent>,
  stateKey: string
): Result.Result<StateNode<TContext, TEvent>, string> =>
  isStateId(stateKey)
    ? getStateNodeById(machine, stateKey)
    : Option.match(getChild(stateNode, stateKey), {
        onNone: () => Result.fail(`Child state '${stateKey}' does not exist on '${stateNode.id}'`),
        onSome: (child) => Result.succeed(child),
      })

/** Walks `path` down from `stateNode`; an empty segment ends the walk. */
const walkStatePath = <TContext, TEvent extends EventObject>(
  machine: NodeLookup<TContext, TEvent>,
  stateNode: StateNode<TContext, TEvent>,
  path: ReadonlyArray<string>
): Result.Result<StateNode<TContext, TEvent>, string> => {
  const [key = "", ...rest] = path
  return key.length === 0
    ? Result.succeed(stateNode)
    : Result.flatMap(getStateNode(machine, stateNode, key), (child) => walkStatePath(machine, child, rest))
}

/**
 * The node at a state path relative to `stateNode` (upstream `getStateNodeByPath`): a
 * string path that starts with `#` is first tried as an id; otherwise each key names a
 * child, and an empty key ends the path. Fails with the upstream message.
 *
 * @since 0.1.0
 * @category Target Resolution
 */
export const getStateNodeByPath = <TContext, TEvent extends EventObject>(
  machine: NodeLookup<TContext, TEvent>,
  stateNode: StateNode<TContext, TEvent>,
  statePath: string | ReadonlyArray<string>
): Result.Result<StateNode<TContext, TEvent>, string> => {
  const byKeys = () => walkStatePath(machine, stateNode, typeof statePath === "string" ? toStatePath(statePath) : statePath)
  return typeof statePath === "string" && isStateId(statePath)
    ? Result.orElse(getStateNodeById(machine, statePath), byKeys)
    : byKeys()
}

/**
 * The node a state id names, `#` optional, followed by an optional key path (upstream
 * `StateMachine.getStateNodeById`). Fails with the upstream message.
 *
 * @since 0.1.0
 * @category Target Resolution
 */
export const getStateNodeById = <TContext, TEvent extends EventObject>(
  machine: NodeLookup<TContext, TEvent>,
  stateId: string
): Result.Result<StateNode<TContext, TEvent>, string> => {
  const [first = "", ...relativePath] = toStatePath(stateId)
  const resolvedStateId = isStateId(first) ? first.slice(1) : first
  return Option.match(HashMap.get(machine.idMap, resolvedStateId), {
    onNone: () => Result.fail(`Child state node '#${resolvedStateId}' does not exist on machine '${machine.id}'`),
    onSome: (stateNode) => walkStatePath(machine, stateNode, relativePath),
  })
}

/** One target of `stateNode` (upstream `resolveTarget`, one element of its `map`). */
const resolveOneTarget = <TContext, TEvent extends EventObject>(
  machine: NodeLookup<TContext, TEvent>,
  stateNode: StateNode<TContext, TEvent>,
  target: string
): Result.Result<StateNode<TContext, TEvent>, MachineDefinitionError> => {
  const definitionError = (message: string) => new MachineDefinitionError({ message })
  if (isStateId(target)) {
    return Result.mapError(getStateNodeById(machine, target), definitionError)
  }
  const isInternalTarget = target.startsWith(".")
  return Option.match(stateNode.parent, {
    // If an internal target is defined on the root, the root key is not part of the path
    onNone: () =>
      isInternalTarget
        ? Result.mapError(getStateNodeByPath(machine, stateNode, target.slice(1)), definitionError)
        : Result.fail(
            definitionError(`Invalid target: "${target}" is not a valid target from the root node. Did you mean ".${target}"?`)
          ),
    onSome: (parent) =>
      Result.mapError(getStateNodeByPath(machine, parent, isInternalTarget ? stateNode.key + target : target), (message) =>
        definitionError(`Invalid transition definition for state node '${stateNode.id}':\n${message}`)
      ),
  })
}

/**
 * Resolves the targets of a transition of `stateNode` (upstream `resolveTarget`): a `#id`
 * target by id, a `.child` target below the source, and any other target below the
 * source's parent; a target on the root must start with `.` or `#`. None stays none (a
 * targetless transition). Fails with the first target's upstream message, which upstream
 * `createMachine` throws; the machine keeps it as its definition error, and each Effect that
 * computes a snapshot of the machine fails with it (SD-3, amended 2026-10-08).
 *
 * @since 0.1.0
 * @category Target Resolution
 */
export const resolveTarget = <TContext, TEvent extends EventObject>(
  machine: NodeLookup<TContext, TEvent>,
  stateNode: StateNode<TContext, TEvent>,
  targets: Option.Option<ReadonlyArray<string>>
): Result.Result<Option.Option<ReadonlyArray<StateNode<TContext, TEvent>>>, MachineDefinitionError> =>
  Option.match(targets, {
    onNone: () => Result.succeed(Option.none()),
    onSome: (list) =>
      Result.map(
        Result.all(list.map((target) => resolveOneTarget(machine, stateNode, target))),
        (nodes): Option.Option<ReadonlyArray<StateNode<TContext, TEvent>>> => Option.some(nodes)
      ),
  })

// ============================================================
// HISTORY
// ============================================================

/**
 * Reads a snapshot's history value as the machine's own nodes: each recorded node is
 * looked up by id in the machine, so only nodes of this machine are restored. A recorded
 * id that names no node of the machine is left out (T2.54 warns about it on restore).
 *
 * @since 0.1.0
 * @category History
 */
export const resolveHistoryValue = <TContext, TEvent extends EventObject>(
  machine: NodeLookup<TContext, TEvent>,
  historyValue: Snapshot.HistoryValue
): ResolvedHistoryValue<TContext, TEvent> =>
  Object.fromEntries(
    Object.entries(historyValue).map(([historyStateNodeId, recorded]) => [
      historyStateNodeId,
      recorded.flatMap((stateNode) => Option.toArray(HashMap.get(machine.idMap, stateNode.id))),
    ])
  )

/** The history children of a node, in document order (upstream `getHistoryNodes`). */
const getHistoryNodes = <TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, TEvent>
): Array<StateNode<TContext, TEvent>> => Object.values(stateNode.states).filter(isHistoryNode)

/** The target lookup of the machine a node belongs to; a node outside a machine resolves key paths only. */
const lookupOf = <TContext, TEvent extends EventObject>(stateNode: StateNode<TContext, TEvent>): NodeLookup<TContext, TEvent> =>
  Option.getOrElse(stateNode.machine, (): NodeLookup<TContext, TEvent> => ({ id: rootOf(stateNode).id, idMap: HashMap.empty() }))

/** The default a history state takes when it has no record. */
interface HistoryDefault<TContext, TEvent extends EventObject> {
  readonly target: ReadonlyArray<StateNode<TContext, TEvent>>
  /** Whether the default is the parent's initial transition, whose actions then run. */
  readonly isParentInitial: boolean
}

/**
 * The default transition of a history state with no record (upstream
 * `resolveHistoryDefaultTransition`): its `target`, a path below its parent or a `#id`;
 * without one, the parent itself for a parallel parent, else the parent's initial
 * transition. A target that names no node, or a missing initial child, is recorded on the
 * walk with the upstream message, and the history state enters nothing.
 */
const resolveHistoryDefaultTransition = <TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, TEvent>,
  walk: Walk
): HistoryDefault<TContext, TEvent> =>
  Option.match(stateNode.parent, {
    onNone: (): HistoryDefault<TContext, TEvent> => ({ target: [], isParentInitial: false }),
    onSome: (parent) =>
      Option.match(
        Option.filter(stateNode.target, (target) => target !== ""),
        {
          onNone: (): HistoryDefault<TContext, TEvent> =>
            parent.type === "parallel"
              ? { target: [parent], isParentInitial: false }
              : { target: Option.toArray(initialChild(parent, walk)), isParentInitial: true },
          onSome: (target) =>
            Result.match(getStateNodeByPath(lookupOf(stateNode), parent, target), {
              onFailure: (message): HistoryDefault<TContext, TEvent> => {
                walk.errors.push(new MachineDefinitionError({ message }))
                return { target: [], isParentInitial: false }
              },
              onSuccess: (node): HistoryDefault<TContext, TEvent> => ({ target: [node], isParentInitial: false }),
            }),
        }
      ),
  })

/**
 * The history value after `statesToExit` exit from the configuration `stateNodes` (the
 * history part of upstream `exitStates`, SCXML `exitStates`): each history child of an exited
 * node records the active nodes below that node, in configuration order (upstream
 * `Array.from(mutStateNodeSet)`), its atomic descendants for a deep history and its direct
 * children otherwise. Any other record stays.
 */
const recordHistory = <TContext, TEvent extends EventObject>(
  statesToExit: ReadonlyArray<StateNode<TContext, TEvent>>,
  stateNodes: ReadonlyArray<StateNode<TContext, TEvent>>,
  historyValue: ResolvedHistoryValue<TContext, TEvent>
): ResolvedHistoryValue<TContext, TEvent> => {
  const recorded = statesToExit.flatMap((exitStateNode) =>
    getHistoryNodes(exitStateNode).map((historyNode) => {
      const isDeep = historyNode.history === "deep"
      const predicate = (stateNode: StateNode<TContext, TEvent>): boolean =>
        isDeep
          ? isAtomicStateNode(stateNode) && isDescendant(stateNode, Option.some(exitStateNode))
          : Option.isSome(stateNode.parent) && stateNode.parent.value === exitStateNode
      return [historyNode.id, stateNodes.filter(predicate)] as const
    })
  )
  return recorded.length === 0 ? historyValue : { ...historyValue, ...Object.fromEntries(recorded) }
}

// ============================================================
// TRANSITION DOMAINS AND EXIT/ENTRY SETS
// ============================================================

/** The first proper ancestor of the first node that contains all the others. */
const findLeastCommonAncestor = <TContext, TEvent extends EventObject>(
  stateNodes: ReadonlyArray<StateNode<TContext, TEvent>>
): Option.Option<StateNode<TContext, TEvent>> => {
  const [head, ...tail] = stateNodes
  if (!head) {
    return Option.none()
  }
  for (const ancestor of getProperAncestors(head, Option.none())) {
    if (tail.every((stateNode) => isDescendant(stateNode, Option.some(ancestor)))) {
      return Option.some(ancestor)
    }
  }
  return Option.none()
}

/**
 * The nodes the targets stand for, each once (upstream `getEffectiveTargetStates`): a
 * history state stands for its recorded nodes, or, with no record, for the targets of its
 * default transition; any other target stands for itself.
 */
const getEffectiveTargetStates = <TContext, TEvent extends EventObject>(
  targets: ReadonlyArray<StateNode<TContext, TEvent>>,
  ctx: SetContext<TContext, TEvent>
): ReadonlyArray<StateNode<TContext, TEvent>> =>
  // Each node once, in the order upstream's `Set` gets it
  targets.reduce<ReadonlyArray<StateNode<TContext, TEvent>>>((effective, targetNode) => {
    if (!isHistoryNode(targetNode)) {
      return appendOnce(effective, targetNode)
    }
    const recorded = Option.fromNullishOr(ctx.historyValue[targetNode.id])
    const stateNodes = Option.isSome(recorded)
      ? recorded.value
      : getEffectiveTargetStates(resolveHistoryDefaultTransition(targetNode, ctx.walk).target, ctx)
    return stateNodes.reduce(appendOnce, effective)
  }, [])

/**
 * The transition domain (upstream `getTransitionDomain`): the source when the transition
 * does not re-enter and every effective target is the source or inside it; else the least
 * common ancestor of the effective targets and the source; else none for a re-entering
 * root transition, and the root otherwise.
 */
const getTransitionDomain = <TContext, TEvent extends EventObject>(
  transition: MicrostepTransition<TContext, TEvent>,
  ctx: SetContext<TContext, TEvent>
): Option.Option<StateNode<TContext, TEvent>> => {
  const targetStates = getEffectiveTargetStates(transition.target, ctx)
  if (
    !transition.reenter &&
    targetStates.every((target) => target === transition.source || isDescendant(target, Option.some(transition.source)))
  ) {
    return Option.some(transition.source)
  }
  const lca = findLeastCommonAncestor([...targetStates, transition.source])
  if (Option.isSome(lca)) {
    return lca
  }
  // at this point it is a root transition, since no least common ancestor exists
  return transition.reenter ? Option.none() : Option.some(rootOf(transition.source))
}

/**
 * The active nodes inside the domain of each transition with a target (upstream
 * `computeExitSet`), each once, in the order upstream's `Set` gets them: the configuration
 * `stateNodes` is read in its order.
 */
const computeExitSet = <TContext, TEvent extends EventObject>(
  transitions: ReadonlyArray<MicrostepTransition<TContext, TEvent>>,
  stateNodes: ReadonlyArray<StateNode<TContext, TEvent>>,
  ctx: SetContext<TContext, TEvent>
): ReadonlyArray<StateNode<TContext, TEvent>> =>
  transitions.reduce<ReadonlyArray<StateNode<TContext, TEvent>>>((statesToExit, t) => {
    if (t.target.length === 0) {
      return statesToExit
    }
    const domain = getTransitionDomain(t, ctx)
    const withSource =
      t.reenter && Option.isSome(domain) && domain.value === t.source ? appendOnce(statesToExit, t.source) : statesToExit
    return stateNodes.filter((stateNode) => isDescendant(stateNode, domain)).reduce(appendOnce, withSource)
  }, [])

/**
 * Whether two collections share a member (upstream `hasIntersection`). Only membership is
 * read, so the second collection is a `HashSet` (members equal by `Equal`; a state node is
 * equal to itself only).
 */
const hasIntersection = <A>(s1: Iterable<A>, s2: Iterable<A>): boolean => {
  const set2 = HashSet.fromIterable(s2)
  return Array.from(s1).some((item) => HashSet.has(set2, item))
}

/**
 * Removes the transitions that conflict with an earlier one (upstream
 * `removeConflictingTransitions`, SCXML): two transitions conflict when their exit sets
 * intersect. A transition whose source is a descendant of the other's source preempts
 * it; otherwise the earlier transition, in selection (document) order, wins.
 */
const removeConflictingTransitions = <TContext, TEvent extends EventObject>(
  enabledTransitions: ReadonlyArray<MicrostepTransition<TContext, TEvent>>,
  stateNodes: ReadonlyArray<StateNode<TContext, TEvent>>,
  ctx: SetContext<TContext, TEvent>
): ReadonlyArray<MicrostepTransition<TContext, TEvent>> => {
  // Upstream's insertion-ordered `Set`s, as lists that hold each transition once
  let filteredTransitions: ReadonlyArray<MicrostepTransition<TContext, TEvent>> = []

  for (const t1 of enabledTransitions) {
    let t1Preempted = false
    let transitionsToRemove: ReadonlyArray<MicrostepTransition<TContext, TEvent>> = []
    for (const t2 of filteredTransitions) {
      if (hasIntersection(computeExitSet([t1], stateNodes, ctx), computeExitSet([t2], stateNodes, ctx))) {
        if (isDescendant(t1.source, Option.some(t2.source))) {
          transitionsToRemove = appendOnce(transitionsToRemove, t2)
        } else {
          t1Preempted = true
          break
        }
      }
    }
    if (!t1Preempted) {
      filteredTransitions = appendOnce(
        filteredTransitions.filter((t3) => !transitionsToRemove.includes(t3)),
        t1
      )
    }
  }

  return filteredTransitions
}

/**
 * The sets one entry computation fills, with the history it restores from. Upstream's
 * native `Set`s are `MutableHashSet`s (SD-22, amended 2026-10-08): the recursive walk adds to
 * them in place, and their order is never read: `statesToEnter` is read for membership and
 * sorted by document order (each node of a machine has its own `order`), and
 * `statesForDefaultEntry` is read for membership only.
 */
interface EntrySets<TContext, TEvent extends EventObject> extends SetContext<TContext, TEvent> {
  readonly statesToEnter: MutableHashSet.MutableHashSet<StateNode<TContext, TEvent>>
  /** The nodes entered by default, whose initial transition's actions run. */
  readonly statesForDefaultEntry: MutableHashSet.MutableHashSet<StateNode<TContext, TEvent>>
}

/**
 * Adds the nodes a history state enters (the history branch of upstream
 * `addDescendantStatesToEnter`): its recorded nodes, else the targets of its default
 * transition, each with its default descendants and its ancestors below the history
 * state's parent. When the default is the parent's initial transition, the parent counts
 * as entered by default, so its initial actions run.
 */
const addHistoryStatesToEnter = <TContext, TEvent extends EventObject>(
  historyNode: StateNode<TContext, TEvent>,
  sets: EntrySets<TContext, TEvent>
): void => {
  const recorded = Option.fromNullishOr(sets.historyValue[historyNode.id])
  const historyDefault = Option.isSome(recorded)
    ? { target: recorded.value, isParentInitial: false }
    : resolveHistoryDefaultTransition(historyNode, sets.walk)
  for (const s of historyDefault.target) {
    MutableHashSet.add(sets.statesToEnter, s)
    if (historyDefault.isParentInitial && Option.isSome(historyNode.parent)) {
      MutableHashSet.add(sets.statesForDefaultEntry, historyNode.parent.value)
    }
    addDescendantStatesToEnter(s, sets)
  }
  for (const s of historyDefault.target) {
    addProperAncestorStatesToEnter(s, historyNode.parent, sets)
  }
}

/** Adds the default descendants of an entered node (upstream `addDescendantStatesToEnter`). */
const addDescendantStatesToEnter = <TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, TEvent>,
  sets: EntrySets<TContext, TEvent>
): void => {
  if (isHistoryNode(stateNode)) {
    addHistoryStatesToEnter(stateNode, sets)
    return
  }
  if (stateNode.type === "compound") {
    const initialState = initialChild(stateNode, sets.walk)
    if (Option.isNone(initialState)) {
      return
    }
    if (!isHistoryNode(initialState.value)) {
      MutableHashSet.add(sets.statesToEnter, initialState.value)
      MutableHashSet.add(sets.statesForDefaultEntry, initialState.value)
    }
    addDescendantStatesToEnter(initialState.value, sets)
    addProperAncestorStatesToEnter(initialState.value, Option.some(stateNode), sets)
  } else if (stateNode.type === "parallel") {
    for (const child of getChildren(stateNode)) {
      if (!Array.from(sets.statesToEnter).some((s) => isDescendant(s, Option.some(child)))) {
        MutableHashSet.add(sets.statesToEnter, child)
        MutableHashSet.add(sets.statesForDefaultEntry, child)
        addDescendantStatesToEnter(child, sets)
      }
    }
  }
}

/**
 * Adds the ancestors that a transition enters, and the regions of each parallel ancestor
 * that no entered node lies in (upstream `addAncestorStatesToEnter`).
 */
const addAncestorStatesToEnter = <TContext, TEvent extends EventObject>(
  sets: EntrySets<TContext, TEvent>,
  ancestors: ReadonlyArray<StateNode<TContext, TEvent>>,
  reentrancyDomain: Option.Option<StateNode<TContext, TEvent>>
): void => {
  for (const anc of ancestors) {
    if (Option.isNone(reentrancyDomain) || isDescendant(anc, reentrancyDomain)) {
      MutableHashSet.add(sets.statesToEnter, anc)
    }
    if (anc.type === "parallel") {
      for (const child of getChildren(anc)) {
        if (!Array.from(sets.statesToEnter).some((s) => isDescendant(s, Option.some(child)))) {
          MutableHashSet.add(sets.statesToEnter, child)
          addDescendantStatesToEnter(child, sets)
        }
      }
    }
  }
}

const addProperAncestorStatesToEnter = <TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, TEvent>,
  toStateNode: Option.Option<StateNode<TContext, TEvent>>,
  sets: EntrySets<TContext, TEvent>
): void => addAncestorStatesToEnter(sets, getProperAncestors(stateNode, toStateNode), Option.none())

/** The nodes the transitions enter (upstream `computeEntrySet`). */
const computeEntrySet = <TContext, TEvent extends EventObject>(
  transitions: ReadonlyArray<MicrostepTransition<TContext, TEvent>>,
  sets: EntrySets<TContext, TEvent>
): void => {
  for (const t of transitions) {
    const domain = getTransitionDomain(t, sets)
    const domainIsSource = Option.isSome(domain) && domain.value === t.source

    for (const s of t.target) {
      if (
        !isHistoryNode(s) &&
        // a target other than the source is always entered; so is the source when the
        // domain lies outside it, or when the transition re-enters
        (t.source !== s || !domainIsSource || t.reenter)
      ) {
        MutableHashSet.add(sets.statesToEnter, s)
        MutableHashSet.add(sets.statesForDefaultEntry, s)
      }
      addDescendantStatesToEnter(s, sets)
    }

    for (const s of getEffectiveTargetStates(t.target, sets)) {
      // A parallel domain follows the proper ancestors (upstream `ancestors.push(domain)`)
      const ancestors = Option.isSome(domain) && domain.value.type === "parallel"
        ? [...getProperAncestors(s, domain), domain.value]
        : getProperAncestors(s, domain)
      addAncestorStatesToEnter(sets, ancestors, Option.isNone(t.source.parent) && t.reenter ? Option.none() : domain)
    }
  }
}

// ============================================================
// MICROSTEP
// ============================================================

const firstError = <A>(walk: Walk, value: A): Result.Result<A, MachineDefinitionError> =>
  Option.match(Option.fromNullishOr(walk.errors[0]), {
    onNone: () => Result.succeed(value),
    onSome: (error) => Result.fail(error),
  })

/**
 * What entering `finalStateNode` completes (the final-node branch of upstream
 * `enterStates`): the compound parent; then, from the parallel parent or else the
 * grandparent, each parallel ancestor that is now complete in the configuration `stateNodes`
 * and was not completed earlier in this microstep, walking up while they complete; and the
 * machine when no ancestor is left. `completedNodes` (upstream's `Set`, read for membership
 * only) keeps a parallel node from completing twice when several regions finish in one
 * microstep.
 */
const completionOfFinal = <TContext, TEvent extends EventObject>(
  finalStateNode: StateNode<TContext, TEvent>,
  stateNodes: ReadonlyArray<StateNode<TContext, TEvent>>,
  completedNodes: MutableHashSet.MutableHashSet<StateNode<TContext, TEvent>>,
  afterActions: number
): Completion<TContext, TEvent> => {
  const parent = finalStateNode.parent
  let ancestorMarker = Option.flatMap(parent, (parentNode) =>
    parentNode.type === "parallel" ? Option.some(parentNode) : parentNode.parent
  )
  let rootCompletionNode = Option.getOrElse(ancestorMarker, () => finalStateNode)

  let doneStates: ReadonlyArray<DoneState<TContext, TEvent>> =
    Option.isSome(parent) && parent.value.type === "compound"
      ? [{ stateNode: parent.value, finalStateNode: Option.some(finalStateNode) }]
      : []
  while (
    Option.isSome(ancestorMarker) &&
    ancestorMarker.value.type === "parallel" &&
    !MutableHashSet.has(completedNodes, ancestorMarker.value) &&
    isInFinalState(stateNodes, ancestorMarker.value)
  ) {
    MutableHashSet.add(completedNodes, ancestorMarker.value)
    doneStates = [...doneStates, { stateNode: ancestorMarker.value, finalStateNode: Option.none() }]
    rootCompletionNode = ancestorMarker.value
    ancestorMarker = ancestorMarker.value.parent
  }
  return {
    afterActions,
    doneStates,
    machineDone: Option.isNone(ancestorMarker) ? Option.some(rootCompletionNode) : Option.none(),
  }
}

/**
 * The actions that start the invocations of an entered node (upstream `enterStates`:
 * `spawnChild(invokeDef.src, { ...invokeDef, syncSnapshot: !!invokeDef.onSnapshot })`): one
 * `spawnChild` per invocation, in `invoke` order, of its source name, under its id and its
 * `systemId`, with its input, and syncing the child's snapshots to the parent when the
 * invocation has `onSnapshot`. The child's done, error and snapshot events reach the node's own transitions
 * through the normal selection (the invocation's `onDone`, `onError` and `onSnapshot` are
 * among them), so nothing else routes them.
 */
const spawnInvocations = <TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, TEvent>
): ReadonlyArray<ActionLike<TContext, TEvent>> =>
  stateNode.invoke.map((invokeDef, index) =>
    spawnChild<TContext, TEvent, ActorLogic.Any>(invokeSourceName(stateNode.id, index, invokeDef.src), {
      id: invokeDef.id,
      systemId: Option.getOrUndefined(invokeDef.systemId),
      input: Option.getOrUndefined(invokeDef.input),
      syncSnapshot: Boolean(invokeDef.onSnapshot),
    })
  )

/**
 * The actions that stop the invocations of an exited node (upstream `exitStates`:
 * `s.invoke.map((def) => stopChild(def.id))`): one `stopChild` per invocation, by its id,
 * after the node's exit actions.
 */
const stopInvocations = <TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, TEvent>
): ReadonlyArray<ActionLike<TContext, TEvent>> =>
  stateNode.invoke.map((invokeDef) => stopChild<TContext, TEvent>(invokeDef.id))

/**
 * Plans one microstep. `startsDone` says that the snapshot it starts from is done already,
 * so, as when the microstep completes the machine, the exit actions of every active node
 * follow (upstream `microstep` reads `nextState.status === 'done'` after the entry phase).
 */
const planMicrostep = <TContext, TEvent extends EventObject>(
  transitions: ReadonlyArray<MicrostepTransition<TContext, TEvent>>,
  configuration: Iterable<StateNode<TContext, TEvent>>,
  historyValue: ResolvedHistoryValue<TContext, TEvent>,
  isInitial: boolean,
  startsDone: boolean,
  walk: Walk
): Microstep<TContext, TEvent> => {
  // Upstream's `mutStateNodeSet`, as the ordered list of its members: the nodes it removes
  // leave their places, the nodes it adds go to the end
  const startNodes = distinct(configuration)

  // Conflicts and the exit set read the history the microstep starts from
  const before: SetContext<TContext, TEvent> = { historyValue, walk }
  const filteredTransitions = removeConflictingTransitions(transitions, startNodes, before)

  // Exit states, in reverse document order (none for the initial microstep). Each exited
  // node's history children record the configuration first; each exited node runs its exit
  // actions, then stops its invocations, and leaves the configuration.
  const exited: ReadonlyArray<StateNode<TContext, TEvent>> = isInitial
    ? []
    : [...computeExitSet(filteredTransitions, startNodes, before)].sort((a, b) => b.order - a.order)
  const nextHistoryValue = recordHistory(exited, startNodes, historyValue)
  const exitActions = exited.flatMap((stateNode) => [...stateNode.exit, ...stopInvocations(stateNode)])

  // Transition content
  const transitionActions = filteredTransitions.flatMap((t) => t.actions)

  // Enter states, in document order; a history target restores what the exits just recorded
  const sets: EntrySets<TContext, TEvent> = {
    statesToEnter: MutableHashSet.empty(),
    statesForDefaultEntry: MutableHashSet.empty(),
    historyValue: nextHistoryValue,
    walk,
  }
  computeEntrySet(filteredTransitions, sets)
  // In the initial microstep the root is entered by default.
  const [first] = filteredTransitions
  if (isInitial && first) {
    MutableHashSet.add(sets.statesForDefaultEntry, rootOf(first.source))
  }
  const entered = Array.from(sets.statesToEnter).sort(byDocumentOrder)
  let stateNodes: ReadonlyArray<StateNode<TContext, TEvent>> = startNodes.filter((stateNode) => !exited.includes(stateNode))
  let actions: ReadonlyArray<ActionLike<TContext, TEvent>> = [...exitActions, ...transitionActions]
  let completions: ReadonlyArray<Completion<TContext, TEvent>> = []
  let deferredActorIds: ReadonlyArray<DeferredActorIds> = []
  const completedNodes = MutableHashSet.empty<StateNode<TContext, TEvent>>()
  for (const stateNode of entered) {
    stateNodes = appendOnce(stateNodes, stateNode)
    // Its entry actions, then the start of its invocations, then its initial actions; a
    // `sendTo` among them may name one of its invocations
    const from = actions.length
    const initialActions =
      MutableHashSet.has(sets.statesForDefaultEntry, stateNode) && Option.isSome(stateNode._initial)
        ? Array.from(stateNode._initial.value.actions)
        : []
    actions = [...actions, ...stateNode.entry, ...spawnInvocations(stateNode), ...initialActions]
    if (stateNode.invoke.length > 0) {
      deferredActorIds = [
        ...deferredActorIds,
        { from, to: actions.length, ids: stateNode.invoke.map((invokeDef) => invokeDef.id) },
      ]
    }
    // A final node completes its parent, and maybe the machine, once its entry actions ran
    if (stateNode.type === "final") {
      completions = [...completions, completionOfFinal(stateNode, stateNodes, completedNodes, actions.length)]
    }
  }

  // A completed machine, or one that was done before the microstep, exits every active node,
  // in reverse document order; the node list stays in that order (upstream sorts
  // `nextStateNodes` in place)
  const machineExits = startsDone || completions.some((completion) => Option.isSome(completion.machineDone))
  const nextStateNodes = machineExits ? [...stateNodes].sort((a, b) => b.order - a.order) : stateNodes
  if (machineExits) {
    actions = [...actions, ...nextStateNodes.flatMap((stateNode) => stateNode.exit)]
  }

  return {
    configuration: nextStateNodes,
    exited,
    entered,
    actions,
    completions,
    deferredActorIds,
    historyValue: nextHistoryValue,
  }
}

/** The history value of a machine that never exited a state. */
const emptyHistoryValue = <TContext, TEvent extends EventObject>(): ResolvedHistoryValue<TContext, TEvent> => ({})

/**
 * Plans one microstep (upstream `microstep`, SCXML microstep procedure) from the current
 * configuration and history value: drop the transitions that conflict with an earlier or
 * a more deeply sourced one, record the history of each node about to exit, exit the
 * nodes inside each remaining transition's domain in reverse document order, run the
 * transition actions, then enter the target nodes (a history state restores its record,
 * else takes its default), their default descendants and the ancestors up to the domain
 * in document order. Entering a final node records the done events of the parents it
 * completes, and, when no ancestor is left to complete, the machine completion, which
 * adds the exit actions of every active node in reverse document order. With `startsDone`
 * (the snapshot the microstep starts from is done already) those exit actions follow too
 * (upstream reads `nextState.status === 'done'` after the entry phase). Fails with the
 * upstream message when an entered compound node's `initial` key, or a history state's
 * default target, names no child.
 *
 * @since 0.1.0
 * @category Microstep
 */
export const microstep = <TContext, TEvent extends EventObject>(
  transitions: ReadonlyArray<MicrostepTransition<TContext, TEvent>>,
  configuration: Iterable<StateNode<TContext, TEvent>>,
  historyValue: ResolvedHistoryValue<TContext, TEvent> = emptyHistoryValue<TContext, TEvent>(),
  startsDone = false
): Result.Result<Microstep<TContext, TEvent>, MachineDefinitionError> => {
  const walk = newWalk()
  const step = planMicrostep(transitions, configuration, historyValue, false, startsDone, walk)
  return firstError(walk, step)
}

/**
 * Plans the initial microstep (upstream `initialMicrostep`): a re-entering transition from
 * the root to its default-entry set, from the pre-initial configuration `[root]`, with no
 * exit phase. Its `configuration` is the initial configuration and its `actions` are the
 * entry actions of every entered node in document order, which the actor runs at `start`.
 *
 * @since 0.1.0
 * @category Microstep
 */
export const initialMicrostep = <TContext, TEvent extends EventObject>(
  root: StateNode<TContext, TEvent>
): Result.Result<Microstep<TContext, TEvent>, MachineDefinitionError> => {
  const walk = newWalk()
  const target = [...getInitialStateNodes(root, walk)]
  const step = planMicrostep(
    [{ source: root, target, definition: Option.none(), reenter: true, actions: [] }],
    [root],
    emptyHistoryValue<TContext, TEvent>(),
    true,
    false,
    walk
  )
  return firstError(walk, step)
}

// ============================================================
// TRANSITION SELECTION
// ============================================================

/**
 * What selection and action execution read: the machine, the snapshot the event meets,
 * the event, and the actor scope that sends, raises and spawns go through.
 *
 * @since 0.1.0
 * @category Models
 */
export interface EngineContext<TContext, TEvent extends EventObject> {
  readonly machine: StateNode.Machine<TContext, TEvent>
  readonly snapshot: MachineSnapshot<TContext, EventObject, Record<string, ActorRefBase>>
  readonly event: TEvent
  readonly actorScope: ActorScopeService
}

/** The transitions a selection step offers, in selection order. */
type Selection<TContext, TEvent extends EventObject> = Effect.Effect<ReadonlyArray<MicrostepTransition<TContext, TEvent>>>

/**
 * Evaluates a transition's guard with the shared evaluator (upstream `evaluateGuard`), with
 * the context of the current snapshot, the event, the machine's implementations, the actor
 * and the current snapshot itself, which `stateIn` checks. Fails with the evaluator's
 * `GuardError` when a guard name has no implementation (S16): the callers decide how it
 * reaches the actor, as upstream's callers do with the error `evaluateGuard` throws.
 */
const evaluateTransitionGuard = <TContext, TEvent extends EventObject>(
  ctx: EngineContext<TContext, TEvent>,
  guard: Guard<TContext, TEvent>
): Effect.Effect<boolean, GuardError> =>
  evaluateGuard(guard, ctx.snapshot.context, ctx.event, {
    self: ctx.actorScope.self,
    system: ctx.actorScope.system,
    implementations: ctx.machine.implementations,
    snapshot: ctx.snapshot,
  })

/**
 * The candidates of `stateNode` for an event type (see {@link getCandidates}) and the
 * warnings that matching the other descriptors gives (upstream prints them while it
 * matches). The other descriptors are matched in declaration order (the node's
 * `transitions` entries), which the order of two such warnings shows.
 */
const matchCandidates = <TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, TEvent, UpstreamAny, UpstreamAny>,
  receivedEventType: string
): {
  readonly candidates: Array<TransitionDefinition<TContext, TEvent, UpstreamAny>>
  readonly warnings: ReadonlyArray<string>
} => {
  const transitionsOf = (descriptor: string): ReadonlyArray<TransitionDefinition<TContext, TEvent, UpstreamAny>> =>
    Option.getOrElse(transitionsOfDescriptor(stateNode.transitions, descriptor), () => [])
  const matched = stateNode.transitions
    .map(([descriptor]) => descriptor)
    .filter((descriptor) => descriptor !== receivedEventType)
    .map((descriptor) => ({ descriptor, ...matchEventDescriptor(receivedEventType, descriptor) }))
  const wildcardCandidates = matched
    .filter(({ matches }) => matches)
    .map(({ descriptor }) => descriptor)
    .sort((a, b) => b.length - a.length)
    .flatMap(transitionsOf)
  return {
    candidates: [...transitionsOf(receivedEventType), ...wildcardCandidates],
    warnings: matched.flatMap(({ warnings }) => warnings),
  }
}

/**
 * The transitions of `stateNode` that may handle an event type, in priority order
 * (upstream `getCandidates`): the exact descriptor's transitions first, then those of each
 * other descriptor that matches the event (`matchEventDescriptor`: `*` or a partial
 * descriptor such as `a.*`), longest first. Synchronous and of any transition meta, as
 * upstream's (SD-22 amendment, goal journal `2026-10-07-14-candidates-any.md`). It logs
 * nothing: the selection step (`next`) logs the warnings upstream prints for an invalid
 * partial descriptor, once per node and event type (see `memoizedCandidates`).
 *
 * @since 0.1.0
 * @category Transition Selection
 */
export const getCandidates = <TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, TEvent, UpstreamAny, UpstreamAny>,
  receivedEventType: string
): Array<TransitionDefinition<TContext, TEvent, UpstreamAny>> => matchCandidates(stateNode, receivedEventType).candidates

/**
 * The candidates each state node gave for each event type (upstream `memo(this,
 * 'candidates-' + eventType, ...)` in `StateNode.next`, a `WeakMap` keyed by the node). A node
 * object lives as long as its machine, and `provide` builds new nodes, as upstream's does.
 * Each node's cache is a `MutableHashMap` by event type, read by key only (SD-22, amended
 * 2026-10-08).
 */
const candidatesByNode = new WeakMap<
  object,
  MutableHashMap.MutableHashMap<string, Array<TransitionDefinition<UpstreamAny, UpstreamAny, UpstreamAny>>>
>()

/**
 * The candidates of `stateNode` for an event type, computed once per node and event type, as
 * upstream's `StateNode.next` memoizes them; the warnings that matching gives come with the
 * first computation only, so a node warns once per event type, as upstream's prints.
 */
const memoizedCandidates = <TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, TEvent, UpstreamAny, UpstreamAny>,
  eventType: string
): Effect.Effect<{
  readonly candidates: Array<TransitionDefinition<TContext, TEvent, UpstreamAny>>
  readonly warnings: ReadonlyArray<string>
}> =>
  Effect.sync(() => {
    const byType = Option.getOrElse(Option.fromNullishOr(candidatesByNode.get(stateNode)), () =>
      MutableHashMap.empty<string, Array<TransitionDefinition<UpstreamAny, UpstreamAny, UpstreamAny>>>()
    )
    candidatesByNode.set(stateNode, byType)
    const known = MutableHashMap.get(byType, eventType)
    if (Option.isSome(known)) {
      return { candidates: known.value, warnings: [] }
    }
    const matched = matchCandidates(stateNode, eventType)
    MutableHashMap.set(byType, eventType, matched.candidates)
    return matched
  })

/** A transition definition of `stateNode` in the shape the microstep takes. */
const toMicrostepTransition = <TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, TEvent>,
  definition: TransitionDefinition<TContext, TEvent>
): MicrostepTransition<TContext, TEvent> => ({
  source: stateNode,
  target: definition.target ?? [],
  definition: Option.some(definition),
  reenter: definition.reenter,
  actions: Array.from(definition.actions),
})

/**
 * Whether a transition is enabled: it has no guard, or its guard passes. Fails with the
 * `GuardError` of a guard name that has no implementation.
 */
const guardPasses = <TContext, TEvent extends EventObject>(
  ctx: EngineContext<TContext, TEvent>,
  transition: TransitionDefinition<TContext, TEvent>
): Effect.Effect<boolean, GuardError> =>
  Option.match(transition.guard, {
    onNone: () => Effect.succeed(true),
    onSome: (guard) => evaluateTransitionGuard(ctx, guard),
  })

/**
 * The type a guard-evaluation message names (upstream `StateNode.next`): a guard name, or the
 * `type` of a `{ type, params }` use; none for an inline function, a port guard definition or
 * an empty type. The port writes the built-in guards (`and`, `or`, `not`, `stateIn`) as
 * definitions; upstream's are functions, so their message names no type either.
 */
const guardTypeOf = <TContext, TEvent extends EventObject>(guard: Guard<TContext, TEvent>): Option.Option<string> =>
  Option.filter(
    typeof guard === "string"
      ? Option.some(guard)
      : typeof guard === "function" || Predicate.hasProperty(guard, "predicate")
        ? Option.none()
        : Option.some(guard.type),
    (guardType) => guardType !== ""
  )

/**
 * A thrown value's `message`, as upstream's `${err.message}` prints it: the text `undefined`
 * for a value without one.
 */
const thrownMessage = (error: unknown): string => (Predicate.hasProperty(error, "message") ? String(error.message) : "undefined")

/**
 * Upstream's error around what a guard threw while a transition for an event was selected
 * (`src/StateNode.ts:459`): `Unable to evaluate guard '<type>' in transition for event
 * '<event>' in state node '<id>':\n<message>`, without `'<type>' ` for an inline function.
 */
const guardEvaluationError = <TContext, TEvent extends EventObject>(
  guard: Option.Option<Guard<TContext, TEvent>>,
  eventType: string,
  stateNode: StateNode<TContext, TEvent>,
  thrown: unknown
): GuardError => {
  const guardType = Option.flatMap(guard, guardTypeOf)
  return new GuardError({
    message: `Unable to evaluate guard ${Option.match(guardType, {
      onNone: () => "",
      onSome: (type) => `'${type}' `,
    })}in transition for event '${eventType}' in state node '${stateNode.id}':\n${thrownMessage(thrown)}`,
    guard: Option.getOrElse(guardType, () => ""),
    cause: thrown,
  })
}

/**
 * The transition `stateNode` itself takes for the event (upstream `StateNode.next`): the
 * first candidate whose guard passes, as a one-element list; empty when none passes. A
 * forbidden transition (no target, no actions) is a candidate like any other, so it
 * stops the event here. The warnings that matching the candidates gives are logged first, once
 * per node and event type, as upstream prints them while it memoizes the candidates. What a guard throws, or
 * its Effect dies with, and the not-implemented `GuardError` of a guard name with no
 * implementation (S16), stop the macrostep with the upstream guard-evaluation error
 * (SD-4); eventless guards are not wrapped, as upstream's are not.
 */
const next = <TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, TEvent>,
  ctx: EngineContext<TContext, TEvent>
): Selection<TContext, TEvent> =>
  Effect.gen(function* () {
    const { candidates, warnings } = yield* memoizedCandidates(stateNode, ctx.event.type)
    yield* Effect.forEach(warnings, (warning) => Effect.logWarning(warning), { discard: true })
    for (const candidate of candidates) {
      const passes = yield* guardPasses(ctx, candidate).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.die(guardEvaluationError(candidate.guard, ctx.event.type, stateNode, Cause.squash(cause)))
        )
      )
      if (passes) {
        return [toMicrostepTransition(stateNode, candidate)]
      }
    }
    return []
  })

/** The inner transitions when there are any, else the node's own (the upstream fallback). */
const orOwn =
  <TContext, TEvent extends EventObject>(stateNode: StateNode<TContext, TEvent>, ctx: EngineContext<TContext, TEvent>) =>
  (inner: ReadonlyArray<MicrostepTransition<TContext, TEvent>>): Selection<TContext, TEvent> =>
    inner.length > 0 ? Effect.succeed(inner) : next(stateNode, ctx)

/**
 * No transitions, for a value key that names no child. Unreachable: the engine selects
 * over a value it computed from a configuration.
 */
const nothing = <TContext, TEvent extends EventObject>(): Selection<TContext, TEvent> => Effect.succeed([])

/** Upstream `transitionAtomicNode`: the active atomic child's transition, else the node's own. */
const transitionAtomicNode = <TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, TEvent>,
  stateValue: string,
  ctx: EngineContext<TContext, TEvent>
): Selection<TContext, TEvent> =>
  Option.match(getChild(stateNode, stateValue), {
    onNone: () => nothing<TContext, TEvent>(),
    onSome: (child) => next(child, ctx),
  }).pipe(Effect.flatMap(orOwn(stateNode, ctx)))

/** Upstream `transitionCompoundNode`: the active child's selection, else the node's own. */
const transitionCompoundNode = <TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, TEvent>,
  stateValue: StateValueMap,
  ctx: EngineContext<TContext, TEvent>
): Selection<TContext, TEvent> =>
  Option.match(Option.fromNullishOr(Object.entries(stateValue)[0]), {
    onNone: () => nothing<TContext, TEvent>(),
    onSome: ([subStateKey, subStateValue]) =>
      Option.match(getChild(stateNode, subStateKey), {
        onNone: () => nothing<TContext, TEvent>(),
        onSome: (child) => selectFromNode(child, subStateValue, ctx),
      }),
  }).pipe(Effect.flatMap(orOwn(stateNode, ctx)))

/**
 * Upstream `transitionParallelNode`: every region's selection in the state value's key order
 * (the order of the snapshot's `_nodes`), else the node's own.
 */
const transitionParallelNode = <TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, TEvent>,
  stateValue: StateValueMap,
  ctx: EngineContext<TContext, TEvent>
): Selection<TContext, TEvent> =>
  Effect.forEach(
    Object.entries(stateValue).filter(([, subStateValue]) => subStateValue !== ""),
    ([subStateKey, subStateValue]) =>
      Option.match(getChild(stateNode, subStateKey), {
        onNone: () => nothing<TContext, TEvent>(),
        onSome: (child) => selectFromNode(child, subStateValue, ctx),
      })
  ).pipe(
    Effect.map((regions) => regions.flat()),
    Effect.flatMap(orOwn(stateNode, ctx))
  )

/**
 * The transitions that `stateNode` and its active descendants take for the event, in the
 * shape the microstep takes (the walk of upstream `transitionNode`), walking the state
 * value below the node: an atomic child offers its own transition, a compound child its
 * active descendant's, and a parallel node every region's in the value's key order. A node
 * offers its own transition only when nothing below it handles the event. Guards run, so
 * the selection is an Effect (SD-13).
 */
const selectFromNode = <TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, TEvent>,
  stateValue: StateValue,
  ctx: EngineContext<TContext, TEvent>
): Selection<TContext, TEvent> =>
  typeof stateValue === "string"
    ? transitionAtomicNode(stateNode, stateValue, ctx)
    : Object.keys(stateValue).length === 1
      ? transitionCompoundNode(stateNode, stateValue, ctx)
      : transitionParallelNode(stateNode, stateValue, ctx)

/**
 * The transitions that `stateNode` and its active descendants select for the event
 * (upstream `transitionNode`): the transition definitions of the selection, in selection
 * order, of any transition meta, or `undefined` when nothing is selected, as upstream's
 * (SD-22 amendment, goal journal `2026-10-07-14-candidates-any.md`). Guards run, so the
 * result is an Effect (SD-13); the guard errors are those of the microstep's selection.
 *
 * @since 0.1.0
 * @category Transition Selection
 */
export const transitionNode = <TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, TEvent>,
  stateValue: StateValue,
  ctx: EngineContext<TContext, TEvent>
): Effect.Effect<Array<TransitionDefinition<TContext, TEvent, UpstreamAny>> | undefined> =>
  Effect.map(selectFromNode(stateNode, stateValue, ctx), (transitions) =>
    Option.getOrUndefined(
      Option.filter(
        Option.some(transitions.flatMap((transition) => Option.toArray(transition.definition))),
        (definitions) => definitions.length > 0
      )
    )
  )

/**
 * The first `always` transition of the nodes, in the order given, that is enabled
 * (upstream `selectEventlessTransitions`, inner loop): each node's eventless transitions in
 * order, the next node only when none of them is enabled. The not-implemented `GuardError`
 * of a guard name with no implementation is a defect that carries it unwrapped, as
 * upstream's raw throw (S16), so the macrostep's error channel never sees it.
 */
const firstEnabledEventless = <TContext, TEvent extends EventObject>(
  ctx: EngineContext<TContext, TEvent>,
  stateNodes: ReadonlyArray<StateNode<TContext, TEvent>>
): Effect.Effect<
  Option.Option<readonly [TransitionDefinition<TContext, TEvent>, MicrostepTransition<TContext, TEvent>]>
> =>
  Effect.gen(function* () {
    for (const stateNode of stateNodes) {
      for (const definition of stateNode.always) {
        if (yield* Effect.orDie(guardPasses(ctx, definition))) {
          return Option.some([definition, toMicrostepTransition(stateNode, definition)] as const)
        }
      }
    }
    return Option.none()
  })

// ============================================================
// ACTIONS
// ============================================================

/**
 * The events a macrostep raised for itself, in the order it handles them (upstream
 * `internalQueue`): a `raise` without a numeric delay pushes its event when the action
 * runs, and the macrostep takes them from the front, each after the microstep before it.
 *
 * @since 0.1.0
 * @category Macrostep
 */
export type InternalQueue<TEvent extends EventObject> = Array<TEvent>

/**
 * Executes one action against the snapshot (upstream `resolveAndExecuteActionsWithContext`,
 * per action): `resolveAction` gives its type, the params of this use (computed with the
 * snapshot's context) and what runs it. A custom action goes to the actor's action executor
 * (upstream `actionExecutor`) with the arguments of this point of the list: it sends the
 * `@xstate.action` inspection event, then runs the action when it has an implementation (a
 * name without one gives the inspection event only), or queues both until `start`. A
 * custom action never changes the snapshot, so it resolves as a NoOp.
 */
const executeAction = <TContext, TEvent extends EventObject>(
  ctx: EngineContext<TContext, TEvent>,
  action: ActionLike<TContext, TEvent>,
  currentSnapshot: MachineSnapshot<TContext, EventObject, Record<string, ActorRefBase>>
): Effect.Effect<ExecutedAction> =>
  Effect.gen(function* () {
    const executable = resolveAction(ctx.machine.implementations, action, currentSnapshot.context, ctx.event)
    // The action's own spawn function (upstream `createSpawner` per assign): the children it
    // hands out are built once the action returns
    const spawner = createSpawner(ctx.actorScope, ctx.machine, currentSnapshot.context, ctx.event)
    const run = (exec: (actionContext: ActionContext<TContext, TEvent>) => Effect.Effect<ActionResult>) =>
      exec(createActionContext(ctx.actorScope, currentSnapshot, ctx.event, spawner.spawn, ctx.machine.implementations))
    if (executable.custom) {
      yield* ctx.actorScope.actionExecutor({
        info: createActionInfo(ctx.actorScope, currentSnapshot.context, ctx.event),
        type: executable.type,
        params: Option.getOrUndefined(executable.params),
        exec: Option.match(executable.exec, {
          onNone: () => Effect.void,
          onSome: (exec) => Effect.asVoid(run(exec)),
        }),
      })
      return { result: Types.ActionResult.NoOp(), spawned: {}, params: executable.params, type: executable.type, custom: true }
    }
    const result = yield* Option.match(executable.exec, {
      onNone: () => Effect.succeed(Types.ActionResult.NoOp()),
      onSome: run,
    })
    return { result, spawned: yield* spawner.flush, params: executable.params, type: executable.type, custom: false }
  })

/**
 * Resolves the target of a send (upstream `resolveSendTo`) with the snapshot of this point of
 * the action list, so a child spawned earlier in the list counts. A reference stays as it is;
 * `#_parent` is the parent, `#_internal` and the port's `#_self` the actor itself, `#_<id>`
 * the child with that id; any other name is a child id, then a systemId of the actor system
 * (D7, beyond XState). A name that resolves to nothing is the actor's error, with the
 * upstream message (SD-3, SD-4).
 */
const resolveSendTarget = <TContext, TEvent extends EventObject>(
  machine: StateNode.Machine<TContext, TEvent>,
  snapshot: EngineSnapshot<TContext>,
  actorScope: ActorScopeService,
  target: string | ActorRefBase
): Effect.Effect<ActorRefBase> => {
  if (typeof target !== "string") {
    return Effect.succeed(target)
  }
  const childById = (childId: string): Option.Option<ActorRefBase> =>
    Object.hasOwn(snapshot.children, childId) ? Option.fromNullishOr(snapshot.children[childId]) : Option.none()
  const found: Option.Option<ActorRefBase> =
    target === "#_parent"
      ? actorScope.self._parent
      : target === "#_internal" || target === "#_self"
        ? Option.some(actorScope.self)
        : target.startsWith("#_")
          ? childById(target.slice(2))
          : Option.orElse(childById(target), () => actorScope.system._lookup(target))
  return Option.match(found, {
    onNone: () =>
      Effect.die(
        new ActorError({
          message: `Unable to send event to actor '${target}' from machine '${machine.id}'.`,
          actorId: actorScope.self.id,
        })
      ),
    onSome: Effect.succeed,
  })
}

/**
 * The event a send delivers (upstream `executeSendTo`): an event of type `xstate.error` arrives
 * as the sender's error event, `{ type: "xstate.error.actor.<sender id>", error: data, actorId }`.
 */
const toRelayedEvent = (sender: ActorRefBase, event: EventObject): EventObject =>
  event.type === "xstate.error"
    ? new ErrorActorEvent({ actorId: sender.id, error: (event as { readonly data?: unknown }).data })
    : event

/**
 * The retry of a send whose target name resolves after its action list: a new cell that the
 * send reads once the macrostep commits, and that the end of the list fills.
 */
const deferTarget = (name: string, params: SendToParams): Effect.Effect<DeferredTarget> =>
  Effect.map(Deferred.make<ActorRefBase>(), (target) => ({ name, target, params }))

/**
 * What one action gave: its result, the children its spawn function created, by id, the
 * params of its use, which a delay function of the result receives (upstream `actionParams`),
 * its type, and whether it was a custom action, which the action executor ran and reported
 * already (`@xstate.action`).
 */
interface ExecutedAction {
  readonly result: ActionResult
  readonly spawned: Readonly<Record<string, ActorRefBase>>
  readonly params: Option.Option<unknown>
  readonly type: string
  readonly custom: boolean
}

/** The Effect log level of each port log level. */
const logSeverity: Readonly<Record<Types.LogLevel, "Debug" | "Info" | "Warn" | "Error">> = {
  debug: "Debug",
  info: "Info",
  warning: "Warn",
  error: "Error",
}

/**
 * Logs a `log` action's entry once (upstream `executeLog`): `(label, value)` with a label that
 * is not empty, `(value)` without one. The actor's logger receives them (upstream
 * `logger(label, value)`, no level); without one, Effect logging at the action's level, with
 * the actor's actorId and sessionId annotations (C12). A logger that throws is a defect, which
 * gives the actor status `error` with the thrown value (SD-4), as upstream's throw does.
 */
const executeLog = (actorScope: ActorScopeService, entry: Types.Log): Effect.Effect<void> => {
  const args = Option.match(
    Option.filter(entry.label, (label) => label !== ""),
    {
      onNone: (): ReadonlyArray<unknown> => [entry.value],
      onSome: (label): ReadonlyArray<unknown> => [label, entry.value],
    }
  )
  return Option.match(actorScope.logger, {
    onNone: () =>
      Effect.logWithLevel(logSeverity[entry.level])(...args).pipe(
        Effect.annotateLogs({ actorId: actorScope.self.id, sessionId: actorScope.self.sessionId })
      ),
    onSome: (logger) =>
      Effect.sync(() => {
        logger(...args)
      }),
  })
}

/**
 * A send whose target name waits for the end of its action list (upstream `retryResolveSendTo`):
 * the name, and the cell the send reads its target from once the list resolves it.
 */
interface DeferredTarget {
  readonly name: string
  readonly target: Deferred.Deferred<ActorRefBase>
  /** The params of the send's execution, whose `to` gets the resolved actor (upstream `retryResolveSendTo`) */
  readonly params: SendToParams
}

/**
 * The params of a send's execution (upstream `resolveSendTo`'s result). `to` is the target,
 * or the name of one that resolves after the action list; once the list has run, the name
 * is replaced by the actor it resolves to (`undefined` when it names none), as upstream's
 * `retryResolveSendTo` replaces it in the same object.
 */
interface SendToParams {
  to: string | ActorRefBase | undefined
  readonly targetId: string | undefined
  readonly event: EventObject
  readonly id: string | undefined
  readonly delay: number | undefined
}

/**
 * What the actions of one list share (upstream `resolveAndExecuteActionsWithContext`'s
 * `extra`): the internal queue and the actor ids whose `sendTo` resolves after the list.
 */
interface ActionListExtra<TEvent extends EventObject> {
  readonly internalQueue: InternalQueue<TEvent>
  readonly deferredActorIds: ReadonlyArray<string>
}

/**
 * What an action list leaves: the snapshot after it, and the sends that wait for its end
 * (upstream's `retries` of `extra`), in the order its actions, those an `enqueueActions`
 * collected included, made them.
 */
interface ActionListResult<TContext> {
  readonly snapshot: MachineSnapshot<TContext, EventObject, Record<string, ActorRefBase>>
  readonly retries: ReadonlyArray<DeferredTarget>
}

/**
 * Runs actions in order against a snapshot, as a microstep does: each action sees the
 * context the previous ones assigned; a raised event joins the internal queue as the
 * action runs (upstream `resolveRaise`), and sends, emits and spawns go through the actor
 * scope. The actions an `enqueueActions` collected run in its place, the same way. With no
 * action that changes it, the snapshot comes back identical.
 *
 * A `sendTo` that names one of `deferredActorIds` (upstream `resolveActionsAndContext`: the
 * invoke ids of the state node whose entry list this is) resolves its target after the whole
 * list, against the snapshot the list leaves (upstream `retryResolveSendTo`), so an entry
 * action reaches the child that the same node invokes after it. A name that is still not
 * resolved then fails that send once the macrostep commits, as upstream's relay to no actor
 * fails in the deferred phase.
 *
 * @since 0.1.0
 * @category Actions
 */
export const runActions = <TContext, TEvent extends EventObject>(
  machine: StateNode.Machine<TContext, TEvent>,
  snapshot: MachineSnapshot<TContext, EventObject, Record<string, ActorRefBase>>,
  event: TEvent,
  actorScope: ActorScopeService,
  actions: Iterable<ActionLike<TContext, TEvent>>,
  internalQueue: InternalQueue<TEvent>,
  deferredActorIds: ReadonlyArray<string> = []
): Effect.Effect<MachineSnapshot<TContext, EventObject, Record<string, ActorRefBase>>> =>
  Effect.gen(function* () {
    const extra: ActionListExtra<TEvent> = { internalQueue, deferredActorIds }
    const { snapshot: current, retries } = yield* resolveActionList(machine, snapshot, event, actorScope, actions, extra)
    for (const retry of retries) {
      const resolved = yield* Effect.exit(resolveSendTarget(machine, current, actorScope, retry.name))
      // Upstream `retryResolveSendTo`: the send's params now hold the actor the name names
      retry.params.to = Option.getOrUndefined(Exit.getSuccess(resolved))
      yield* Deferred.done(retry.target, resolved)
    }
    return current
  })

/**
 * The action list of {@link runActions}, with what its actions share; the actions an
 * `enqueueActions` collected run through it in place, with the same `extra`, and their
 * deferred sends join the list's at that place.
 */
const resolveActionList = <TContext, TEvent extends EventObject>(
  machine: StateNode.Machine<TContext, TEvent>,
  snapshot: MachineSnapshot<TContext, EventObject, Record<string, ActorRefBase>>,
  event: TEvent,
  actorScope: ActorScopeService,
  actions: Iterable<ActionLike<TContext, TEvent>>,
  extra: ActionListExtra<TEvent>
): Effect.Effect<ActionListResult<TContext>> =>
  Effect.gen(function* () {
    const { internalQueue } = extra
    const ctx: EngineContext<TContext, TEvent> = { machine, snapshot, event, actorScope }
    let current = snapshot
    let retries: ReadonlyArray<DeferredTarget> = []

    for (const action of actions) {
      // The action's arguments (upstream `actionArgs`): the context before it runs
      const info = createActionInfo(actorScope, current.context, event)
      const { result, spawned, params, type, custom } = yield* executeAction(ctx, action, current)

      // The children the action's spawn function created join the snapshot with the
      // action's own change (upstream `resolveAssign`)
      if (Object.keys(spawned).length > 0) {
        current = Snapshot.makeMachineSnapshot({ ...current, children: { ...current.children, ...spawned } })
      }

      switch (result._tag) {
        case "ContextUpdate":
          current = Snapshot.updateContext(current, result.context as TContext)
          break
        case "SendEvent": {
          // Upstream `resolveSendTo`: the delay, then the target, resolve now, against this
          // point of the list; a delay that does not resolve to a number is no delay. `sendTo`
          // gives milliseconds already; a name comes from a result a definition built itself
          const delay = Option.flatMap(result.delay, (given) =>
            resolveDelay(machine.implementations, given, createActionArgs(actorScope, current, event), Option.getOrUndefined(params))
          )
          // The target now (upstream `params.to`), or a name among the list's deferred actor ids,
          // which resolves after the list
          const to: string | ActorRefBase =
            typeof result.target === "string" && extra.deferredActorIds.includes(result.target)
              ? result.target
              : yield* resolveSendTarget(machine, current, actorScope, result.target)
          const sendParams: SendToParams = {
            to,
            targetId: Option.getOrUndefined(Option.liftPredicate(Predicate.isString)(result.target)),
            event: result.event,
            id: Option.getOrUndefined(result.id),
            delay: Option.getOrUndefined(delay),
          }
          // A name waits for the end of the list (upstream `retryResolveSendTo`)
          let target: Effect.Effect<ActorRefBase>
          if (typeof to === "string") {
            const retry = yield* deferTarget(to, sendParams)
            retries = [...retries, retry]
            target = Deferred.await(retry.target)
          } else {
            target = Effect.succeed(to)
          }
          // Upstream `executeSendTo` through the action executor (`@xstate.action`), after the
          // macrostep commits: a delayed send goes to the scheduler, an immediate one out
          // through the system, so a macrostep that fails sends and schedules nothing (SD-27)
          yield* actorScope.actionExecutor({
            info,
            type: "xstate.sendTo",
            params: sendParams,
            exec: actorScope.defer(
              Effect.flatMap(target, (to) =>
                Option.match(delay, {
                  onSome: (delay) => actorScope.system.scheduler.schedule(actorScope.self, to, result.event, delay, result.id),
                  onNone: () => actorScope.system.relay(actorScope.self, to, toRelayedEvent(actorScope.self, result.event)),
                })
              )
            ),
          })
          break
        }
        case "RaiseEvent": {
          // Upstream `resolveRaise`: a delay in milliseconds schedules the event to the actor
          // itself once the macrostep commits (`executeRaise`); no delay, or one that does not
          // resolve to a number, puts it on the internal queue, which the macrostep handles
          // before it returns, so before any queued external event. `raise` gives milliseconds
          // already; a name comes from a result a definition built itself
          const delay = Option.flatMap(result.delay, (given) =>
            resolveDelay(machine.implementations, given, createActionArgs(actorScope, current, event), Option.getOrUndefined(params))
          )
          if (Option.isNone(delay)) {
            internalQueue.push(result.event as TEvent)
          }
          // Upstream `executeRaise` through the action executor (`@xstate.action`)
          yield* actorScope.actionExecutor({
            info,
            type: "xstate.raise",
            params: { event: result.event, id: Option.getOrUndefined(result.id), delay: Option.getOrUndefined(delay) },
            exec: Option.match(delay, {
              onNone: () => Effect.void,
              onSome: (delay) =>
                actorScope.defer(actorScope.system.scheduler.schedule(actorScope.self, actorScope.self, result.event, delay, result.id)),
            }),
          })
          break
        }
        case "EmitEvent":
          // The listeners receive it after the macrostep commits, so they read the new
          // snapshot (upstream `executeEmit`, through the action executor: `@xstate.action`)
          yield* actorScope.actionExecutor({
            info,
            type: "xstate.emit",
            params: { event: result.event },
            exec: actorScope.defer(actorScope.emit(result.event)),
          })
          break
        case "Cancel":
          // Upstream `executeCancel` through the action executor (`@xstate.action` with
          // `resolveCancel`'s params); the action deferred the scheduler's cancel itself
          yield* actorScope.actionExecutor({ info, type: "xstate.cancel", params: { sendId: result.sendId }, exec: Effect.void })
          break
        case "SpawnChild": {
          // Upstream `resolveSpawn`: the child joins `snapshot.children` under the action's id
          // option and starts after the macrostep; an unknown src only warns. Without an id
          // option the key is "undefined" (upstream's `[resolvedId]` of `undefined`), while the
          // child's own id is its session id, so a second such spawn replaces the entry
          const spawned = yield* spawnRequested(actorScope, machine, result)
          const child = Option.map(spawned, (found) => found.child)
          if (Option.isSome(child)) {
            const key = Option.getOrElse(result.id, () => "undefined")
            current = Snapshot.makeMachineSnapshot({
              ...current,
              children: { ...current.children, [key]: child.value },
            })
          }
          // Upstream `executeSpawn` through the action executor (`@xstate.action`, also for an
          // unknown src); the actor scope already queued the child's start. Upstream's params
          // hold the `id` option as written and the input it resolved for a logic only
          yield* actorScope.actionExecutor({
            info,
            type: "xstate.spawnChild",
            params: {
              id: Predicate.hasProperty(result, "givenId") ? result.givenId : Option.getOrUndefined(result.id),
              systemId: Option.getOrUndefined(result.systemId),
              actorRef: Option.getOrUndefined(child),
              src: result.src,
              input: Option.getOrUndefined(Option.map(spawned, (found) => found.input)),
            },
            exec: Effect.void,
          })
          break
        }
        case "StopChild": {
          // Upstream `resolveStop`: a string names a child by id; the port also resolves the
          // systemId of a child (D7). A string that names no child changes nothing.
          const target = result.target
          const child: Option.Option<ActorRefBase> =
            typeof target === "string"
              ? Option.orElse(
                  Object.hasOwn(current.children, target) ? Option.fromNullishOr(current.children[target]) : Option.none(),
                  () =>
                    Option.filter(actorScope.system._lookup(target), (registered) =>
                      Option.exists(registered._parent, (parent) => parent === actorScope.self)
                    )
                )
              : Option.some(target)
          // Upstream `executeStop` through the action executor (`@xstate.action` with the
          // child, also when the target names none). The stop itself runs now, through the actor
          // scope, so a child spawned at creation and stopped there never starts
          yield* actorScope.actionExecutor({ info, type: "xstate.stopChild", params: Option.getOrUndefined(child), exec: Effect.void })
          if (Option.isSome(child)) {
            const { [child.value.id]: _, ...remainingChildren } = current.children
            current = Snapshot.makeMachineSnapshot({ ...current, children: remainingChildren })
            yield* actorScope.stopChild(child.value)
          }
          break
        }
        case "Log":
          // Upstream `executeLog` through the action executor: it logs at once in a running
          // actor and at `start` for the initial snapshot's actions, after the
          // `@xstate.action` inspection event with the resolved `{ value, label }`
          yield* actorScope.actionExecutor({
            info,
            type: "xstate.log",
            params: { value: result.value, label: Option.getOrUndefined(result.label) },
            exec: executeLog(actorScope, result),
          })
          break
        case "Enqueued":
          // Upstream `resolveAndExecuteActionsWithContext`: the actions an `enqueueActions`
          // collected resolve in place, in order, with the snapshot of this point of the list
          // (the machine's own actions, so they share its context and event types)
          {
            const enqueued = yield* resolveActionList(
              machine,
              current,
              event,
              actorScope,
              result.actions as ReadonlyArray<ActionLike<TContext, TEvent>>,
              extra
            )
            current = enqueued.snapshot
            retries = [...retries, ...enqueued.retries]
          }
          break
        case "NoOp":
          // A port definition with no result for the engine (a user's definition) is reported
          // as upstream reports an action with an execution (`@xstate.action`); a custom action
          // was reported when it ran
          if (!custom) {
            yield* actorScope.actionExecutor({ info, type, params: Option.getOrUndefined(params), exec: Effect.void })
          }
          break
      }
    }

    return { snapshot: current, retries }
  })

// ============================================================
// MACROSTEP
// ============================================================

/** A machine snapshot as the engine reads and writes it. */
type EngineSnapshot<TContext> = MachineSnapshot<TContext, EventObject, Record<string, ActorRefBase>>

/** The upstream message when a macrostep runs past `maxIterations` (`src/stateUtils.ts:1764`). */
const infiniteLoopMessage = (maxIterations: number): string =>
  `Infinite loop detected: the machine has processed more than ${maxIterations} microsteps without reaching a stable state. This usually happens when there's a cycle of transitions (e.g., eventless transitions or raised events causing state A -> B -> C -> A).`

/** The upstream message for an event whose type is the wildcard `*` (`src/stateUtils.ts:1685`). */
const wildcardEventTypeMessage = "An event cannot have the wildcard type ('*')"

/** The event type of the init event, which starts the initial macrostep. */
const INIT_EVENT_TYPE = "xstate.init"

/**
 * One microstep with its actions (upstream `Microstep`): the snapshot after it, and the
 * actions it handed to the action executor, in order.
 *
 * @since 0.1.0
 * @category Macrostep
 */
export type MicrostepWithActions<TSnapshot> = readonly [snapshot: TSnapshot, actions: ReadonlyArray<CustomActionExecution>]

/**
 * The microsteps a pure helper records (`getMicrosteps`, `getInitialMicrosteps`): those of
 * the macrosteps that run with `actorScope`, the helper's own inert scope, in order. A child
 * that the macrostep creates computes its initial snapshot with its own scope, so its
 * microsteps are not among them.
 *
 * @since 0.1.0
 * @category Macrostep
 */
export interface MicrostepRecording {
  readonly actorScope: ActorScopeService
  readonly steps: Array<MicrostepWithActions<MachineSnapshot>>
}

/**
 * The recording the engine adds each microstep to (upstream `macrostep(...).microsteps`);
 * none outside a pure microstep helper, so an actor records nothing.
 *
 * @since 0.1.0
 * @category Macrostep
 */
export const MicrostepRecorder = Context.Reference<Option.Option<MicrostepRecording>>(
  "@xstate-effect/stateUtils/MicrostepRecorder",
  { defaultValue: () => Option.none() }
)

/**
 * Takes one microstep with `run` (upstream `microstep` and `addMicrostep`). When a pure
 * helper records the microsteps of `actorScope`, the microstep runs with an action executor
 * that also keeps each action it hands over (upstream swaps `actorScope.actionExecutor` for
 * the microstep), and the snapshot it gives is recorded with those actions; otherwise it
 * runs with `actorScope` as it is. A microstep that runs no action (the stop event, an
 * unhandled child error) is recorded with an empty action list, as upstream records
 * `[snapshot, []]`.
 */
const recordMicrostep = <TContext, E>(
  actorScope: ActorScopeService,
  run: (actorScope: ActorScopeService) => Effect.Effect<EngineSnapshot<TContext>, E>
): Effect.Effect<EngineSnapshot<TContext>, E> =>
  Effect.gen(function* () {
    const recording = Option.filter(yield* MicrostepRecorder, (recorder) => recorder.actorScope === actorScope)
    if (Option.isNone(recording)) {
      return yield* run(actorScope)
    }
    let actions: ReadonlyArray<CustomActionExecution> = []
    const snapshot = yield* run({
      ...actorScope,
      actionExecutor: (action) =>
        Effect.andThen(
          Effect.sync(() => {
            actions = [...actions, action]
          }),
          actorScope.actionExecutor(action)
        ),
    })
    recording.value.steps.push([snapshot, actions])
    return snapshot
  })

/**
 * The active nodes of a snapshot of `machine` (upstream `snapshot._nodes`), in the order the
 * snapshot holds them; none for a snapshot that lists no node (built from a value that
 * names no state).
 */
const configurationOf = <TContext, TEvent extends EventObject>(
  snapshot: EngineSnapshot<TContext>
): Option.Option<ReadonlyArray<StateNode<TContext, TEvent>>> =>
  // A snapshot of this machine lists this machine's nodes, of its context and event types
  Option.liftPredicate(snapshot._nodes as unknown as ReadonlyArray<StateNode<TContext, TEvent>>, (nodes) => nodes.length > 0)

/**
 * A configuration as a snapshot's `_nodes`: `StateNode` is invariant in its context and
 * event, so the nodes are widened to `StateNode.Any`, as the machine's `nodes` query widens.
 */
const asSnapshotNodes = <TContext, TEvent extends EventObject>(
  configuration: ReadonlyArray<StateNode<TContext, TEvent>>
): ReadonlyArray<StateNode.Any> => configuration as unknown as ReadonlyArray<StateNode.Any>

/**
 * Whether two configurations hold the same nodes, in any order (upstream
 * `areStateNodeCollectionsEqual`): `b` as a `HashSet`, read for its size and membership (a
 * state node is equal to itself only).
 */
const sameStateNodes = <TContext, TEvent extends EventObject>(
  a: ReadonlyArray<StateNode<TContext, TEvent>>,
  b: ReadonlyArray<StateNode<TContext, TEvent>>
): boolean => {
  const set = HashSet.fromIterable(b)
  return a.length === HashSet.size(set) && a.every((stateNode) => HashSet.has(set, stateNode))
}

/**
 * The transitions the active configuration takes for an event (upstream
 * `selectTransitions`): `transitionNode` from the root, with guards that read the snapshot.
 */
const selectTransitions = <TContext, TEvent extends EventObject>(
  ctx: EngineContext<TContext, TEvent>
): Selection<TContext, TEvent> =>
  Option.match(configurationOf<TContext, TEvent>(ctx.snapshot), {
    onNone: () => nothing<TContext, TEvent>(),
    onSome: (configuration) => selectFromNode(ctx.machine.root, getStateValue(ctx.machine.root, configuration), ctx),
  })

/**
 * The transition definitions the active configuration selects for the event (upstream
 * `machine.getTransitionData`: `transitionNode` from the root), in selection order: one per
 * node that takes the event, a forbidden transition (`on: { E: undefined }`) included, none
 * when nothing takes it. Guards run; actions do not. A guard that throws, dies or names no
 * implementation fails the Effect with the guard-evaluation `GuardError` that `next` dies
 * with (upstream throws it; the port fails the Effect, SD-3).
 *
 * @since 0.1.0
 * @category Transition Selection
 */
export const getTransitionData = <TContext, TEvent extends EventObject>(
  ctx: EngineContext<TContext, TEvent>
): Effect.Effect<ReadonlyArray<TransitionDefinition<TContext, TEvent>>, GuardError> =>
  Option.match(configurationOf<TContext, TEvent>(ctx.snapshot), {
    onNone: () => Effect.succeed<ReadonlyArray<TransitionDefinition<TContext, TEvent>>>([]),
    onSome: (configuration) =>
      Effect.map(
        transitionNode(ctx.machine.root, getStateValue(ctx.machine.root, configuration), ctx),
        (definitions): ReadonlyArray<TransitionDefinition<TContext, TEvent>> => definitions ?? []
      ),
  }).pipe(Effect.catchDefect((defect) => (defect instanceof GuardError ? Effect.fail(defect) : Effect.die(defect))))

/**
 * Whether a selected transition is forbidden (the filter of upstream `snapshot.can`,
 * `t.target !== undefined || t.actions.length`): it has no target list and no actions, as
 * `on: { E: undefined }` builds it. `{ target: [] }` has a target list, so it is not
 * forbidden. Selection takes a forbidden transition like any other, so it stops the event at
 * its source, and then it does nothing.
 */
const isForbidden = <TContext, TEvent extends EventObject>(transition: TransitionDefinition<TContext, TEvent>): boolean =>
  transition.target === undefined && Chunk.isEmpty(transition.actions)

/**
 * Whether the active configuration takes the event: the engine query of upstream
 * `snapshot.can` (`src/State.ts`), {@link getTransitionData} with at least one transition
 * that is not forbidden. A forbidden transition (`on: { E: undefined }`) stops the event at
 * its state, so an ancestor's handler does not count either; another parallel region's
 * transition does. Guards run; actions do not; a guard error fails the Effect as in
 * {@link getTransitionData}.
 *
 * @since 0.1.0
 * @category Transition Selection
 */
export const canTakeEvent = <TContext, TEvent extends EventObject>(
  ctx: EngineContext<TContext, TEvent>
): Effect.Effect<boolean, GuardError> =>
  Effect.map(getTransitionData(ctx), (transitions) => transitions.some((transition) => !isForbidden(transition)))

/**
 * The enabled eventless transitions (upstream `selectEventlessTransitions`): for each active
 * atomic node, in the order of the snapshot's `_nodes` (the order the nodes became active, so
 * the region whose node was entered last comes last), the first enabled `always` transition
 * of the node or of its nearest ancestor that has one enabled; each transition once; then
 * the conflicts removed. Guards see the snapshot and the event the macrostep handles last.
 */
const selectEventlessTransitions = <TContext, TEvent extends EventObject>(
  ctx: EngineContext<TContext, TEvent>
): Selection<TContext, TEvent> =>
  Effect.gen(function* () {
    const configuration = configurationOf<TContext, TEvent>(ctx.snapshot)
    if (Option.isNone(configuration)) {
      return []
    }
    // Upstream's insertion-ordered `Set` of definitions: each definition once, with the
    // transition it was first selected as
    let enabledTransitions: ReadonlyArray<
      readonly [TransitionDefinition<TContext, TEvent>, MicrostepTransition<TContext, TEvent>]
    > = []
    for (const stateNode of configuration.value.filter(isAtomicStateNode)) {
      const enabled = yield* firstEnabledEventless(ctx, [stateNode, ...getProperAncestors(stateNode, Option.none())])
      if (Option.isSome(enabled) && !enabledTransitions.some(([definition]) => definition === enabled.value[0])) {
        enabledTransitions = [...enabledTransitions, enabled.value]
      }
    }
    // A walk error here (a history default that names no node) is reported by the microstep
    return removeConflictingTransitions(enabledTransitions.map(([, transition]) => transition), distinct(configuration.value), {
      historyValue: resolveHistoryValue(ctx.machine, ctx.snapshot.historyValue),
      walk: newWalk(),
    })
  })

/** An output mapper; the root's receives a done event, not a machine event. */
type OutputMapper<TContext> = (args: { context: TContext; event: EventObject; self: ActorRefBase }) => unknown

/**
 * Upstream's warning for an output object whose property values are functions (the
 * `isDevelopment` branch of `resolveOutput`, `src/utils.ts:173-190`): the object is the
 * output as it is, and its functions are never called. It names each function-valued key
 * with the function's source text on one line. None for any other value. The port has one
 * build, which behaves as upstream's development build, so the warning is always on.
 */
const dynamicMappingWarning = (output: unknown): Option.Option<string> => {
  const mapping = Predicate.isObjectOrArray(output)
    ? Object.entries(output).flatMap(([key, value]) =>
        Predicate.isFunction(value) ? [`\n - ${key}: ${value.toString().replace(/\n\s*/g, "")}`] : []
      )
    : []
  return mapping.length === 0
    ? Option.none()
    : Option.some(
        `Dynamically mapping values to individual properties is deprecated. Use a single function that returns the mapped object instead.\nFound object containing properties whose values are possibly mapping functions: ${mapping.join("")}`
      )
}

/**
 * The output of a node (upstream `resolveOutput`): a mapper's result for the context, the
 * event and `self`, else the value itself, after the warning for a value that is an object
 * of functions. None when the node has no output or the output is `undefined` (SD-7); `null`
 * is an output. A mapper that throws is a defect that carries the thrown value (SD-4).
 */
const resolveNodeOutput = <TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, TEvent>,
  context: TContext,
  event: EventObject,
  self: ActorRefBase
): Effect.Effect<Option.Option<unknown>> =>
  Option.match(stateNode.output, {
    onNone: () => Effect.succeedNone,
    onSome: (output) =>
      typeof output === "function"
        ? Effect.sync(() => Option.fromUndefinedOr((output as OutputMapper<TContext>)({ context, event, self })))
        : Effect.as(
            Option.match(dynamicMappingWarning(output), { onNone: () => Effect.void, onSome: (warning) => Effect.logWarning(warning) }),
            Option.fromUndefinedOr(output)
          ),
  })

/**
 * The machine output (upstream `getMachineOutput`): none without a root `output`; else the
 * root output resolved for the `xstate.done.state.<rootCompletionNode id>` event, which
 * carries that node's output when it is not the root.
 */
const getMachineOutput = <TContext, TEvent extends EventObject>(
  root: StateNode<TContext, TEvent>,
  rootCompletionNode: StateNode<TContext, TEvent>,
  context: TContext,
  event: TEvent,
  self: ActorRefBase
): Effect.Effect<Option.Option<unknown>> =>
  Option.isNone(root.output)
    ? Effect.succeedNone
    : Effect.gen(function* () {
        const doneStateEvent = new DoneStateEvent({
          stateId: rootCompletionNode.id,
          output: Option.isSome(rootCompletionNode.parent)
            ? yield* resolveNodeOutput(rootCompletionNode, context, event, self)
            : Option.none(),
        })
        return yield* resolveNodeOutput(root, context, doneStateEvent, self)
      })

/**
 * Applies one completion to the snapshot the actions before it left: each done event
 * joins the internal queue, its output resolved with that snapshot's context; a machine
 * completion sets status `done` and the machine output.
 */
const applyCompletion = <TContext, TEvent extends EventObject>(
  machine: StateNode.Machine<TContext, TEvent>,
  snapshot: EngineSnapshot<TContext>,
  event: TEvent,
  actorScope: ActorScopeService,
  completion: Completion<TContext, TEvent>,
  internalQueue: InternalQueue<TEvent>
): Effect.Effect<EngineSnapshot<TContext>> =>
  Effect.gen(function* () {
    for (const { stateNode, finalStateNode } of completion.doneStates) {
      const output = yield* Option.match(finalStateNode, {
        onNone: () => Effect.succeedNone,
        onSome: (node) => resolveNodeOutput(node, snapshot.context, event, actorScope.self),
      })
      const doneStateEvent: EventObject = new DoneStateEvent({ stateId: stateNode.id, output })
      internalQueue.push(doneStateEvent as TEvent)
    }
    if (Option.isNone(completion.machineDone)) {
      return snapshot
    }
    return Snapshot.makeMachineSnapshot({
      ...snapshot,
      status: "done",
      output: yield* getMachineOutput(machine.root, completion.machineDone.value, snapshot.context, event, actorScope.self),
    })
  })

/**
 * Runs the actions of a microstep plan in order, with each completion applied at its place
 * (upstream `enterStates`), so a done event follows the entry actions of its final node
 * and reads the context they left. An entry list with deferred actor ids runs as a list of
 * its own, so its sends to them resolve once it has run. With no completion and no action
 * that changes it, the snapshot comes back identical.
 */
const runMicrostepActions = <TContext, TEvent extends EventObject>(
  machine: StateNode.Machine<TContext, TEvent>,
  snapshot: EngineSnapshot<TContext>,
  event: TEvent,
  actorScope: ActorScopeService,
  step: Microstep<TContext, TEvent>,
  internalQueue: InternalQueue<TEvent>
): Effect.Effect<EngineSnapshot<TContext>> =>
  Effect.gen(function* () {
    // The actions from `start` to `end`, cut at the bounds of the deferred ranges
    const runRange = (current: EngineSnapshot<TContext>, start: number, end: number) =>
      Effect.gen(function* () {
        const bounds = step.deferredActorIds.flatMap(({ from, to }) => [from, to])
        const cuts = distinct([start, end, ...bounds])
          .filter((cut) => cut >= start && cut <= end)
          .sort((a, b) => a - b)
        let next = current
        for (const [index, from] of cuts.entries()) {
          const to = cuts[index + 1] ?? end
          if (to > from) {
            const ids = Option.match(
              Option.fromNullishOr(step.deferredActorIds.find((range) => range.from <= from && to <= range.to)),
              { onNone: (): ReadonlyArray<string> => [], onSome: (range) => range.ids }
            )
            next = yield* runActions(machine, next, event, actorScope, step.actions.slice(from, to), internalQueue, ids)
          }
        }
        return next
      })
    let current = snapshot
    let ran = 0
    for (const completion of step.completions) {
      current = yield* runRange(current, ran, completion.afterActions)
      ran = completion.afterActions
      current = yield* applyCompletion(machine, current, event, actorScope, completion, internalQueue)
    }
    return yield* runRange(current, ran, step.actions.length)
  })

/**
 * Takes one microstep from a snapshot (upstream `microstep`): plans it from the
 * configuration and history value the snapshot holds, runs its exit, transition and entry
 * actions in that order (a raise joins the internal queue) with the completions they reach
 * (a done event joins the internal queue; a machine completion sets status `done` and the
 * output, then the exit actions of every active node run, as they do after the entry
 * actions when the snapshot was done already), and returns the snapshot with
 * the next configuration's value and tags and the next history value. With no
 * transitions, or when neither the configuration nor the history value changed, it
 * returns the snapshot the actions left: the identical snapshot unless an action changed
 * it, as the eventless re-check rule of the macrostep needs.
 */
const runMicrostep = <TContext, TEvent extends EventObject>(
  ctx: EngineContext<TContext, TEvent>,
  transitions: ReadonlyArray<MicrostepTransition<TContext, TEvent>>,
  internalQueue: InternalQueue<TEvent>
): Effect.Effect<EngineSnapshot<TContext>, MachineDefinitionError> =>
  Effect.gen(function* () {
    const { machine, snapshot, event, actorScope } = ctx
    const configuration = configurationOf<TContext, TEvent>(snapshot)
    if (transitions.length === 0 || Option.isNone(configuration)) {
      return snapshot
    }
    const historyValue = resolveHistoryValue(machine, snapshot.historyValue)
    const step = yield* Effect.fromResult(microstep(transitions, configuration.value, historyValue, snapshot.status === "done"))

    // Exit actions, transition actions, then entry actions with the completions they reach,
    // in the planned order
    const acted = yield* runMicrostepActions(machine, snapshot, event, actorScope, step, internalQueue)
    if (step.historyValue === historyValue && sameStateNodes(configuration.value, step.configuration)) {
      return acted
    }

    return Snapshot.makeMachineSnapshot({
      ...acted,
      _nodes: asSnapshotNodes(step.configuration),
      value: getStateValue(machine.root, step.configuration),
      tags: getConfigurationTags(step.configuration),
      historyValue: step.historyValue,
    })
  })

/**
 * What a macrostep gives (upstream `macrostep`'s result): the snapshot it ends with and the
 * snapshot after each of its microsteps, in order.
 */
interface MacrostepResult<TContext> {
  readonly snapshot: EngineSnapshot<TContext>
  readonly microsteps: ReadonlyArray<EngineSnapshot<TContext>>
}

/**
 * The macrostep loop (upstream `macrostep`): the first microstep for the event (none for
 * the init event, whose initial microstep has run), then, while the snapshot is active,
 * one microstep at a time: the enabled eventless transitions when selection is on, else
 * the transitions for the next internal event, until neither is left. An eventless
 * microstep that returns the identical snapshot turns eventless selection off until an
 * internal event is handled. Each loop iteration counts, the one that finds the macrostep
 * stable included; past `maxIterations` the macrostep fails with the upstream message.
 * Each microstep's snapshot is recorded, the first one's even when it selected nothing, and
 * the error snapshot of an unhandled child error event (upstream `addMicrostep`). The stop
 * event stops every child and gives status `stopped` in one microstep.
 */
const runMacrostep =<TContext, TEvent extends EventObject>(
  machine: StateNode.Machine<TContext, TEvent>,
  snapshot: EngineSnapshot<TContext>,
  event: TEvent,
  actorScope: ActorScopeService,
  internalQueue: InternalQueue<TEvent>
): Effect.Effect<MacrostepResult<TContext>, MachineDefinitionError | TransitionError> =>
  Effect.gen(function* () {
    let microsteps: ReadonlyArray<EngineSnapshot<TContext>> = []
    // Upstream `addMicrostep`: the inspection functions see each microstep (`@xstate.microstep`)
    // with the event it handled and the transition definitions it took, then it is recorded
    const addMicrostep = (
      step: EngineSnapshot<TContext>,
      stepEvent: TEvent,
      transitions: ReadonlyArray<MicrostepTransition<TContext, TEvent>>
    ): Effect.Effect<void> =>
      Effect.andThen(
        actorScope.system._sendInspectionEvent({
          type: "@xstate.microstep",
          actorRef: actorScope.self,
          event: stepEvent,
          snapshot: step,
          // The inspection event names the definitions of any machine
          _transitions: transitions.flatMap((transition) => Option.toArray(transition.definition)) as unknown as ReadonlyArray<
            TransitionDefinition<unknown, EventObject>
          >,
        }),
        Effect.sync(() => {
          microsteps = [...microsteps, step]
        })
      )
    const contextOf = (current: EngineSnapshot<TContext>, currentEvent: TEvent): EngineContext<TContext, TEvent> => ({
      machine,
      snapshot: current,
      event: currentEvent,
      actorScope,
    })
    let nextSnapshot: EngineSnapshot<TContext> = snapshot
    let nextEvent: TEvent = event

    // The stop event takes no transition (upstream `macrostep`, `XSTATE_STOP`): every child is
    // stopped and leaves `children` (upstream `stopChildren`, whose snapshot is kept here), and
    // the status becomes `stopped`; it is the macrostep's one microstep. No exit action runs.
    if (isStopEvent(event)) {
      const stops = Object.values(snapshot.children).map((child) => stopChild<TContext, TEvent>(child))
      const withoutChildren = yield* runActions(machine, snapshot, event, actorScope, stops, [])
      const stopped = yield* recordMicrostep(actorScope, () =>
        Effect.succeed(Snapshot.makeMachineSnapshot({ ...withoutChildren, status: "stopped" }))
      )
      yield* addMicrostep(stopped, event, [])
      return { snapshot: stopped, microsteps }
    }

    if (event.type !== INIT_EVENT_TYPE) {
      const transitions = yield* selectTransitions(contextOf(nextSnapshot, nextEvent))
      // A child's error event that no transition takes is this machine's error, with the
      // child's raw error, so it climbs to the parent (upstream `macrostep`, SD-4)
      if (transitions.length === 0 && isErrorActorEvent(event)) {
        const errored = yield* recordMicrostep(actorScope, () =>
          Effect.succeed(Snapshot.makeMachineSnapshot({ ...snapshot, status: "error", error: Option.some(event.error) }))
        )
        yield* addMicrostep(errored, event, [])
        return { snapshot: errored, microsteps }
      }
      const current = nextSnapshot
      nextSnapshot = yield* recordMicrostep(actorScope, (scope) =>
        runMicrostep({ ...contextOf(current, nextEvent), actorScope: scope }, transitions, internalQueue)
      )
      yield* addMicrostep(nextSnapshot, nextEvent, transitions)
    }

    let shouldSelectEventlessTransitions = true
    const maxIterations = machine.options.maxIterations ?? Infinity
    let iterationCount = 0

    while (nextSnapshot.status === "active") {
      iterationCount++
      if (iterationCount > maxIterations) {
        return yield* Effect.fail(new TransitionError({ message: infiniteLoopMessage(maxIterations), event, snapshot }))
      }

      let enabledTransitions: ReadonlyArray<MicrostepTransition<TContext, TEvent>> = yield* shouldSelectEventlessTransitions
        ? selectEventlessTransitions(contextOf(nextSnapshot, nextEvent))
        : nothing<TContext, TEvent>()

      // After an internal event, or a microstep that took no eventless transition, the
      // next iteration selects eventless transitions again
      const previousState: Option.Option<EngineSnapshot<TContext>> =
        enabledTransitions.length > 0 ? Option.some(nextSnapshot) : Option.none()

      if (enabledTransitions.length === 0) {
        const internalEvent = Option.fromNullishOr(internalQueue.shift())
        if (Option.isNone(internalEvent)) {
          break
        }
        nextEvent = internalEvent.value
        enabledTransitions = yield* selectTransitions(contextOf(nextSnapshot, nextEvent))
      }

      const current = nextSnapshot
      const currentEvent = nextEvent
      const selected = enabledTransitions
      const stepped: EngineSnapshot<TContext> = yield* recordMicrostep(actorScope, (scope) =>
        runMicrostep({ ...contextOf(current, currentEvent), actorScope: scope }, selected, internalQueue)
      )
      shouldSelectEventlessTransitions = Option.match(previousState, {
        onNone: () => true,
        onSome: (previous) => stepped !== previous,
      })
      nextSnapshot = stepped
      yield* addMicrostep(nextSnapshot, nextEvent, enabledTransitions)
    }

    // A snapshot that is no longer active stops every child (upstream `stopChildren`), through
    // the actor scope, so they stop once the macrostep commits, before the observers receive
    // it. Upstream drops the snapshot those stops resolve to, so the references stay in
    // `children`.
    if (nextSnapshot.status !== "active") {
      const stops = Object.values(nextSnapshot.children).map((child) => stopChild<TContext, TEvent>(child))
      yield* runActions(machine, nextSnapshot, nextEvent, actorScope, stops, [])
    }
    return { snapshot: nextSnapshot, microsteps }
  })

/** Wraps a definition error the engine meets while it handles `event` as the macrostep's failure. */
const asTransitionError =
  <TContext, TEvent extends EventObject>(event: TEvent, snapshot: EngineSnapshot<TContext>) =>
  (error: MachineDefinitionError | TransitionError): TransitionError =>
    error._tag === "TransitionError" ? error : new TransitionError({ message: "Transition failed", event, snapshot, cause: error })

/**
 * Processes one event (upstream `macrostep`) with a fresh internal queue: the first
 * microstep for the event over the active configuration, then the eventless transitions
 * and the raised events, in the order the macrostep loop takes them, until the snapshot is
 * stable or no longer active. The stop event (`xstate.stop`) takes no transition: every child
 * is stopped and removed from `children`, and the status becomes `stopped` (upstream). A
 * snapshot that is not active (`done`, `error`, `stopped`) still takes the first microstep
 * for the event, as upstream's `macrostep` reads no status before it; only the loop needs
 * status `active`. An actor never hands such a snapshot an event. Fails with a
 * `TransitionError`: the upstream message for an event whose type is `*`, which no
 * transition takes; the upstream
 * infinite-loop message past `options.maxIterations`; or "Transition failed" around a
 * definition error.
 *
 * @since 0.1.0
 * @category Macrostep
 */
export const macrostep = <TContext, TEvent extends EventObject>(
  machine: StateNode.Machine<TContext, TEvent>,
  snapshot: EngineSnapshot<TContext>,
  event: TEvent,
  actorScope: ActorScopeService
): Effect.Effect<EngineSnapshot<TContext>, TransitionError> =>
  isWildcardType(event.type)
    ? Effect.fail(new TransitionError({ message: wildcardEventTypeMessage, event, snapshot }))
    : runMacrostep(machine, snapshot, event, actorScope, []).pipe(
        Effect.map((result) => result.snapshot),
        Effect.mapError(asTransitionError(event, snapshot))
      )

/**
 * The snapshot after each microstep of the macrostep that processes one event (upstream
 * `machine.microstep`: `macrostep(...).microsteps`), in order: the first microstep for the
 * event, a microstep that selects nothing included, then each eventless or internal-event
 * microstep. Fails as {@link macrostep} fails; a snapshot that is not active takes the first
 * microstep only.
 *
 * @since 0.1.0
 * @category Macrostep
 */
export const macrostepMicrosteps = <TContext, TEvent extends EventObject>(
  machine: StateNode.Machine<TContext, TEvent>,
  snapshot: EngineSnapshot<TContext>,
  event: TEvent,
  actorScope: ActorScopeService
): Effect.Effect<ReadonlyArray<EngineSnapshot<TContext>>, TransitionError> =>
  isWildcardType(event.type)
    ? Effect.fail(new TransitionError({ message: wildcardEventTypeMessage, event, snapshot }))
    : runMacrostep(machine, snapshot, event, actorScope, []).pipe(
        Effect.map((result) => result.microsteps),
        Effect.mapError(asTransitionError(event, snapshot))
      )

/**
 * Computes the initial snapshot from the pre-initial one (upstream `getInitialSnapshot`
 * after `_getPreInitialState`): the initial microstep enters the initial configuration and
 * runs the entry actions with the init event, then the initial macrostep, which shares
 * the internal queue with it, takes the eventless transitions and the raised events. Fails
 * with the `MachineDefinitionError` of an `initial` key that names no child, or with the
 * `TransitionError` that ends the initial macrostep.
 *
 * @since 0.1.0
 * @category Macrostep
 */
export const initialMacrostep = <TContext, TEvent extends EventObject>(
  machine: StateNode.Machine<TContext, TEvent>,
  preInitial: EngineSnapshot<TContext>,
  initEvent: TEvent,
  actorScope: ActorScopeService
): Effect.Effect<EngineSnapshot<TContext>, MachineDefinitionError | TransitionError> =>
  Effect.gen(function* () {
    const step = yield* Effect.fromResult(initialMicrostep(machine.root))
    const internalQueue: InternalQueue<TEvent> = []
    const initial = yield* recordMicrostep(actorScope, (scope) =>
      Effect.map(runMicrostepActions(machine, preInitial, initEvent, scope, step, internalQueue), (entered) =>
        Snapshot.makeMachineSnapshot({
          ...entered,
          _nodes: asSnapshotNodes(step.configuration),
          value: getStateValue(machine.root, step.configuration),
          tags: getConfigurationTags(step.configuration),
        })
      )
    )
    return yield* runMacrostep(machine, initial, initEvent, actorScope, internalQueue).pipe(
      Effect.map((result) => result.snapshot),
      Effect.mapError(asTransitionError(initEvent, initial))
    )
  })
