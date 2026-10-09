/**
 * @since 0.1.0
 * @module StateNode
 *
 * StateNode represents a state in a state machine.
 *
 * A machine builds one `StateNode` instance per state, in document order: each node links
 * to its parent and to its machine, keeps its children in a plain object in config order,
 * and carries the XState `path` (`[]` at the root) and id (`<machineId>.<path>`, or the
 * custom `id` of its config). Nodes compare by reference.
 */
import { Chunk, Equal, Hash, type HashMap, Inspectable, Option, Pipeable, Predicate, pipe } from "effect"
import type { EventObject } from "./Event.js"
import type { UpstreamAny } from "./internal/anyEventObject.js"
import { invokeSourceName, type TransitionEntries, transitionMap, transitionsOfDescriptor } from "./stateUtils.js"
import type {
  StateNodeType,
  HistoryType,
  TransitionDefinition,
  DelayedTransitionDefinition,
  InitialTransition,
  Action,
  InvokeConfig,
  InvokeDefinition,
  OutputDefinition,
  MachineImplementations,
  MachineOptions,
  StateNodeConfig,
  Variance,
} from "./Types.js"

// ============================================================
// STATE NODE TYPE ID
// ============================================================

/**
 * Type ID for StateNode.
 *
 * @since 0.1.0
 * @category Type ID
 */
export const StateNodeTypeId: unique symbol = Symbol.for("@xstate-effect/StateNode")

/**
 * Type ID type for StateNode.
 *
 * @since 0.1.0
 * @category Type ID
 */
export type StateNodeTypeId = typeof StateNodeTypeId

/**
 * Creates variance markers for StateNode TypeId.
 * @internal
 */
const makeStateNodeVariance = <TContext, TEvent extends EventObject>(): Variance.StateNode<TContext, TEvent> => ({
  _Context: (_: TContext): TContext => _,
  _Event: (_: TEvent): TEvent => _,
})

/**
 * Type guard for StateNode.
 *
 * @since 0.1.0
 * @category Guards
 */
export const isStateNode = (u: unknown): u is StateNode<unknown, EventObject> =>
  Predicate.hasProperty(u, StateNodeTypeId)

// ============================================================
// STATE NODE CONSTRUCTORS
// ============================================================

/**
 * Creates a StateNode from all of its fields.
 *
 * @since 0.1.0
 * @category Constructors
 */
export const make = <TContext, TEvent extends EventObject, TStateMeta = unknown, TTransitionMeta = TStateMeta>(
  options: StateNode.Options<TContext, TEvent, TStateMeta, TTransitionMeta>
): StateNode<TContext, TEvent, TStateMeta, TTransitionMeta> => new StateNode(options)

/**
 * The fields of a node built outside a machine: no parent, no machine, nothing to do.
 * @internal
 */
const detached = <TContext, TEvent extends EventObject>(
  type: StateNodeType,
  key: string,
  parentId: string,
  order: number
): StateNode.Options<TContext, TEvent> => ({
  type,
  key,
  id: parentId === "" ? key : `${parentId}.${key}`,
  path: [key],
  order,
  states: {},
  _initial: Option.none(),
  transitions: transitionMap([]),
  always: [],
  after: [],
  entry: [],
  exit: [],
  invoke: [],
  tags: [],
  output: Option.none(),
  history: false,
  target: Option.none(),
  parent: Option.none(),
  machine: Option.none(),
  config: {},
})

/**
 * Creates an atomic state node.
 *
 * @since 0.1.0
 * @category Constructors
 */
export const atomic = <TContext, TEvent extends EventObject>(
  key: string,
  parentId: string,
  order: number
): StateNode<TContext, TEvent> => make(detached<TContext, TEvent>("atomic", key, parentId, order))

/**
 * Creates a compound state node.
 *
 * @since 0.1.0
 * @category Constructors
 */
export const compound = <TContext, TEvent extends EventObject>(
  key: string,
  parentId: string,
  order: number,
  states: Readonly<Record<string, StateNode<TContext, TEvent>>>,
  initial: InitialTransition<TContext, TEvent>
): StateNode<TContext, TEvent> =>
  make({ ...detached<TContext, TEvent>("compound", key, parentId, order), states, _initial: Option.some(initial) })

/**
 * Creates a parallel state node.
 *
 * @since 0.1.0
 * @category Constructors
 */
export const parallel = <TContext, TEvent extends EventObject>(
  key: string,
  parentId: string,
  order: number,
  states: Readonly<Record<string, StateNode<TContext, TEvent>>>
): StateNode<TContext, TEvent> => make({ ...detached<TContext, TEvent>("parallel", key, parentId, order), states })

/**
 * Creates a final state node.
 *
 * @since 0.1.0
 * @category Constructors
 */
export const final = <TContext, TEvent extends EventObject>(
  key: string,
  parentId: string,
  order: number,
  output: Option.Option<OutputDefinition<TContext, TEvent>>
): StateNode<TContext, TEvent> => make({ ...detached<TContext, TEvent>("final", key, parentId, order), output })

/**
 * Creates a history state node.
 *
 * @since 0.1.0
 * @category Constructors
 */
export const historyState = <TContext, TEvent extends EventObject>(
  key: string,
  parentId: string,
  order: number,
  historyType: HistoryType,
  target: Option.Option<string>
): StateNode<TContext, TEvent> =>
  make({ ...detached<TContext, TEvent>("history", key, parentId, order), history: historyType, target })

// ============================================================
// STATE NODE ACCESSORS
// ============================================================

/**
 * Gets a child state by key.
 *
 * @since 0.1.0
 * @category Accessors
 */
export const getChild = <TContext, TEvent extends EventObject>(
  node: StateNode<TContext, TEvent>,
  key: string
): Option.Option<StateNode<TContext, TEvent>> =>
  Object.hasOwn(node.states, key) ? Option.fromNullishOr(node.states[key]) : Option.none()

/**
 * Gets all children, in document order.
 *
 * @since 0.1.0
 * @category Accessors
 */
export const getChildren = <TContext, TEvent extends EventObject>(
  node: StateNode<TContext, TEvent>
): Chunk.Chunk<StateNode<TContext, TEvent>> =>
  Chunk.fromIterable(Object.values(node.states))

/**
 * Gets transitions for an event type.
 *
 * @since 0.1.0
 * @category Accessors
 */
export const getTransitions = <TContext, TEvent extends EventObject>(
  node: StateNode<TContext, TEvent>,
  eventType: string
): Chunk.Chunk<TransitionDefinition<TContext, TEvent>> =>
  Chunk.fromIterable(Option.getOrElse(transitionsOfDescriptor(node.transitions, eventType), () => []))

/**
 * Gets the initial state target.
 *
 * @since 0.1.0
 * @category Accessors
 */
export const getInitialTarget = <TContext, TEvent extends EventObject>(
  node: StateNode<TContext, TEvent>
): Option.Option<ReadonlyArray<string>> =>
  Option.map(node._initial, (init) => init.target)

/**
 * Gets all leaf (atomic/final) state nodes, in document order.
 *
 * @since 0.1.0
 * @category Accessors
 */
export const getLeafStates = <TContext, TEvent extends EventObject>(
  node: StateNode<TContext, TEvent>
): Chunk.Chunk<StateNode<TContext, TEvent>> =>
  node.type === "atomic" || node.type === "final"
    ? Chunk.of(node)
    : pipe(getChildren(node), Chunk.flatMap(getLeafStates))

// ============================================================
// STATE NODE PREDICATES
// ============================================================

/**
 * Check if state node is atomic.
 *
 * @since 0.1.0
 * @category Predicates
 */
export const isAtomic = <TContext, TEvent extends EventObject>(
  node: StateNode<TContext, TEvent>
): boolean => node.type === "atomic"

/**
 * Check if state node is compound.
 *
 * @since 0.1.0
 * @category Predicates
 */
export const isCompound = <TContext, TEvent extends EventObject>(
  node: StateNode<TContext, TEvent>
): boolean => node.type === "compound"

/**
 * Check if state node is parallel.
 *
 * @since 0.1.0
 * @category Predicates
 */
export const isParallel = <TContext, TEvent extends EventObject>(
  node: StateNode<TContext, TEvent>
): boolean => node.type === "parallel"

/**
 * Check if state node is final.
 *
 * @since 0.1.0
 * @category Predicates
 */
export const isFinal = <TContext, TEvent extends EventObject>(
  node: StateNode<TContext, TEvent>
): boolean => node.type === "final"

/**
 * Check if state node is history.
 *
 * @since 0.1.0
 * @category Predicates
 */
export const isHistory = <TContext, TEvent extends EventObject>(
  node: StateNode<TContext, TEvent>
): boolean => node.type === "history"

/**
 * Check if state node is a leaf node (atomic or final).
 *
 * @since 0.1.0
 * @category Predicates
 */
export const isLeaf = <TContext, TEvent extends EventObject>(
  node: StateNode<TContext, TEvent>
): boolean => node.type === "atomic" || node.type === "final"

/**
 * Check if state node is an ancestor of another: its `path` is a proper prefix of the
 * other's `path`.
 *
 * @since 0.1.0
 * @category Predicates
 */
export const isAncestor = <TContext, TEvent extends EventObject>(
  ancestor: StateNode<TContext, TEvent>,
  descendant: StateNode<TContext, TEvent>
): boolean =>
  ancestor.path.length < descendant.path.length &&
  ancestor.path.every((segment, index) => descendant.path[index] === segment)

/**
 * Check if state node is a descendant of another.
 *
 * @since 0.1.0
 * @category Predicates
 */
export const isDescendant = <TContext, TEvent extends EventObject>(
  descendant: StateNode<TContext, TEvent>,
  ancestor: StateNode<TContext, TEvent>
): boolean => isAncestor(ancestor, descendant)

// ============================================================
// STATE NODE TRANSFORMATIONS
// ============================================================

/**
 * Updates the transitions of a state node: its `transitions` entries, which its `on` record
 * follows.
 *
 * @since 0.1.0
 * @category Transformations
 */
export const withTransitions = <TContext, TEvent extends EventObject>(
  node: StateNode<TContext, TEvent>,
  transitions: TransitionEntries<TContext, TEvent>
): StateNode<TContext, TEvent> =>
  make({ ...node, transitions })

/**
 * Updates the entry actions of a state node.
 *
 * @since 0.1.0
 * @category Transformations
 */
export const withEntry = <TContext, TEvent extends EventObject>(
  node: StateNode<TContext, TEvent>,
  entry: ReadonlyArray<Action<TContext, TEvent>>
): StateNode<TContext, TEvent> =>
  make({ ...node, entry })

/**
 * Updates the exit actions of a state node.
 *
 * @since 0.1.0
 * @category Transformations
 */
export const withExit = <TContext, TEvent extends EventObject>(
  node: StateNode<TContext, TEvent>,
  exit: ReadonlyArray<Action<TContext, TEvent>>
): StateNode<TContext, TEvent> =>
  make({ ...node, exit })

/**
 * Updates the invocations of a state node.
 *
 * @since 0.1.0
 * @category Transformations
 */
export const withInvoke = <TContext, TEvent extends EventObject>(
  node: StateNode<TContext, TEvent>,
  invoke: ReadonlyArray<InvokeDefinition<TContext, TEvent>>
): StateNode<TContext, TEvent> =>
  make({ ...node, invoke })

/**
 * Updates the tags of a state node.
 *
 * @since 0.1.0
 * @category Transformations
 */
export const withTags = <TContext, TEvent extends EventObject>(
  node: StateNode<TContext, TEvent>,
  tags: ReadonlyArray<string>
): StateNode<TContext, TEvent> =>
  make({ ...node, tags })

/**
 * Sets the parent reference.
 *
 * @since 0.1.0
 * @category Transformations
 */
export const withParent = <TContext, TEvent extends EventObject>(
  node: StateNode<TContext, TEvent>,
  parent: StateNode<TContext, TEvent>
): StateNode<TContext, TEvent> =>
  make({ ...node, parent: Option.some(parent) })

/**
 * An action as a definition lists it (upstream `toSerializableAction`): a name becomes
 * `{ type }`, a function `{ type: <its name> }`, and an object (a `{ type, params }` use or a
 * port action definition, built-in actions included) stays as it is.
 */
const toSerializableAction = <TContext, TEvent extends EventObject>(
  action: Action<TContext, TEvent>
): StateNode.SerializableAction =>
  typeof action === "string" ? { type: action } : typeof action === "function" ? { type: action.name } : action

/** Whether a config value written as one item or a list (XState `SingleOrArray`) is a list. */
const isList = <A>(value: A | ReadonlyArray<A>): value is ReadonlyArray<A> => Array.isArray(value)

/** The invoke configs of a node, in config order. */
const invokeConfigs = <TContext, TEvent extends EventObject>(
  node: StateNode<TContext, TEvent>
): ReadonlyArray<InvokeConfig<TContext, TEvent>> =>
  Option.match(Option.fromNullishOr(node.config.invoke), {
    onNone: () => [],
    onSome: (invoke) => (isList(invoke) ? invoke : [invoke]),
  })

/**
 * The event type of an initial transition: none, which upstream's definition writes as
 * `null` (the JSON form keeps it), so it is the nullable form of `Option.none()`.
 */
const NO_EVENT_TYPE = Option.getOrNull(Option.none())

/**
 * An invocation as a definition lists it (upstream `StateNode.invoke`): the invoke definition
 * with its JSON form, the config without `onDone` and `onError`, with `type:
 * 'xstate.invoke'`, the source name (`xstate.invoke.<index>.<node id>` for inline logic) and
 * the id.
 */
const invokeDefinition = <TContext, TEvent extends EventObject, TTransitionMeta>(
  node: StateNode<TContext, TEvent, unknown, TTransitionMeta>,
  invoke: InvokeDefinition<TContext, TEvent, TTransitionMeta>,
  index: number
): StateNode.DefinitionInvoke<TContext, TEvent, TTransitionMeta> => {
  const { onDone: _onDone, onError: _onError, ...config } = invokeConfigs(node)[index] ?? { src: invoke.src }
  const src = invokeSourceName(node.id, index, invoke.src)
  return { ...invoke, toJSON: () => ({ ...config, type: "xstate.invoke", src, id: invoke.id }) }
}

/**
 * The initial transition of a node (upstream `formatInitialTransition`, which the
 * `StateNode.initial` getter returns): the target nodes (none for a node without `initial`,
 * or whose `initial` key names no child), the node as source, the actions of the object form,
 * no event type, no re-entry, the meta and description of `initial: { target, meta,
 * description }`, and a JSON form with `#<id>` references.
 */
const initialTransitionOf = <TContext, TEvent extends EventObject, TTransitionMeta>(
  node: StateNode<TContext, TEvent, unknown, TTransitionMeta>
): StateNode.InitialTransitionDefinition<TContext, TEvent, TTransitionMeta> => {
  const target = Option.match(node._initial, {
    onNone: (): ReadonlyArray<StateNode<TContext, TEvent>> => [],
    onSome: (initial) => initial.target.flatMap((key) => Option.toArray(getChild(node, key))),
  })
  const actions = Option.match(node._initial, {
    onNone: (): ReadonlyArray<Action<TContext, TEvent>> => [],
    onSome: (initial) => Array.from(initial.actions),
  })
  const meta = Option.getOrUndefined(Option.flatMap(node._initial, (initial) => Option.fromUndefinedOr(initial.meta)))
  const description = Option.getOrUndefined(
    Option.flatMap(node._initial, (initial) => Option.fromUndefinedOr(initial.description))
  )
  const transition = { target, source: node, actions, eventType: NO_EVENT_TYPE, reenter: false, meta, description } as const
  return {
    ...transition,
    toJSON: () => ({ ...transition, source: `#${node.id}`, target: target.map((stateNode) => `#${stateNode.id}`) }),
  }
}

/**
 * The initial transition as a definition lists it (upstream `StateNode.initial` in
 * `definition`): the node's {@link StateNode.initial} with serialisable actions, and the JSON
 * form with `#<id>` references.
 */
const initialDefinition = <TContext, TEvent extends EventObject, TTransitionMeta>(
  node: StateNode<TContext, TEvent, unknown, TTransitionMeta>
): StateNode.InitialDefinition<TContext, TEvent, TTransitionMeta> => {
  const { target, meta, description } = node.initial
  const actions = node.initial.actions.map(toSerializableAction)
  return {
    target,
    source: node,
    actions,
    eventType: NO_EVENT_TYPE,
    reenter: false,
    meta,
    description,
    toJSON: () => ({
      target: target.map((stateNode) => `#${stateNode.id}`),
      source: `#${node.id}`,
      actions,
      eventType: NO_EVENT_TYPE,
      meta,
      description,
    }),
  }
}

/**
 * The well-structured definition of a node (upstream `StateNode.definition`): its fields in
 * XState's plain form (an `Option` field as its value or `undefined`, no history as `false`,
 * the root's order as `-1`), its children's definitions, its transitions with serialisable
 * actions, and the machine's version.
 */
const definitionOf = <TContext, TEvent extends EventObject, TStateMeta, TTransitionMeta>(
  node: StateNode<TContext, TEvent, TStateMeta, TTransitionMeta>
): StateNode.Definition<TContext, TEvent, TStateMeta, TTransitionMeta> => ({
  id: node.id,
  key: node.key,
  version: Option.getOrUndefined(Option.flatMap(node.machine, (machine) => Option.fromUndefinedOr(machine.version))),
  type: node.type,
  initial: initialDefinition(node),
  history: node.history,
  states: Object.fromEntries(Object.entries(node.states).map(([key, child]) => [key, child.definition])),
  on: node.on,
  transitions: node.transitions
    .flatMap(([, transitions]) => transitions)
    .map((transition) => ({ ...transition, actions: Array.from(transition.actions, toSerializableAction) })),
  entry: node.entry.map(toSerializableAction),
  exit: node.exit.map(toSerializableAction),
  meta: node.meta,
  // Upstream `this.order || -1`: the root, at order 0, has -1
  order: node.order === 0 ? -1 : node.order,
  // Upstream keeps an output only on a final node and the root
  output: Option.getOrUndefined(Option.filter(node.output, () => node.type === "final" || Option.isNone(node.parent))),
  invoke: node.invoke.map((invoke, index) => invokeDefinition(node, invoke, index)),
  description: node.description,
  tags: node.tags,
})

/**
 * Whether a transition does nothing when taken (the filter of XState `ownEvents`): no
 * target, no actions and no re-entry.
 */
const isInert = <TContext, TEvent extends EventObject>(transition: TransitionDefinition<TContext, TEvent>): boolean =>
  transition.target === undefined && Chunk.isEmpty(transition.actions) && !transition.reenter

// ============================================================
// STATE NODE CLASS
// ============================================================

/**
 * StateNode represents a state in a state machine (XState `StateNode`).
 *
 * `createMachine` builds the instances; `make` and the convenience constructors build a
 * node outside a machine (no parent, no machine). The static members are the functions of
 * this module, so the former `StateNode` namespace calls (`StateNode.getChild(...)`) keep
 * working.
 *
 * @since 0.1.0
 * @category State Node
 */
export class StateNode<
  in out TContext,
  in out TEvent extends EventObject,
  out TStateMeta = unknown,
  out TTransitionMeta = TStateMeta
>
  extends Pipeable.Class
  implements Inspectable.Inspectable, Equal.Equal
{
  /** Type of state node */
  declare readonly type: StateNodeType

  /** Key of this state within its parent; the machine id for the root */
  declare readonly key: string

  /** Id of this state: its config `id`, else `<machineId>.<path>` (e.g. "machine.parent.child") */
  declare readonly id: string

  /** Keys from the root to this node (XState): `[]` for the root, `["a", "b"]` for `#m.a.b` */
  declare readonly path: ReadonlyArray<string>

  /** The config's description, `undefined` when it has none (upstream `description`) */
  declare readonly description?: string

  /** Document order: the position of this node in a pre-order walk of the machine */
  declare readonly order: number

  /** Child states (for compound/parallel), in document order */
  declare readonly states: Readonly<Record<string, StateNode<TContext, TEvent, TStateMeta, TTransitionMeta>>>

  /**
   * The `initial` of the config with its target as a child key (for compound), which the
   * engine resolves when it enters the node; {@link initial} gives it in upstream's form.
   *
   * @internal
   */
  declare readonly _initial: Option.Option<InitialTransition<TContext, TEvent, TTransitionMeta>>

  /**
   * The transitions by event descriptor, in declaration order, as `[descriptor, transitions]`
   * entries (XState `transitions`, a native `Map`, whose entries in that order the port keeps:
   * SD-22, amended 2026-10-08): the `on` descriptors, then `onDone`
   * (`xstate.done.state.<id>`), then the delayed transitions (`xstate.after.<delay>.<id>`); a
   * forbidden event (`on: { E: undefined }`) keeps its descriptor with one transition that has
   * no target and no actions.
   */
  declare readonly transitions: TransitionEntries<TContext, TEvent, TTransitionMeta>

  /** Eventless (always) transitions, in config order (XState: an array) */
  declare readonly always: ReadonlyArray<TransitionDefinition<TContext, TEvent, TTransitionMeta>>

  /**
   * The delayed transitions (XState `after`), in the key order of the config's `after`, each
   * with its delay; they are the same objects as the {@link transitions} on their
   * `xstate.after.<delay>.<id>` events.
   */
  declare readonly after: ReadonlyArray<DelayedTransitionDefinition<TContext, TEvent, TTransitionMeta>>

  /**
   * Entry actions, in config order, then the `raise` of each delayed transition (XState: an
   * array)
   */
  declare readonly entry: ReadonlyArray<Action<TContext, TEvent>>

  /** Exit actions, in config order, then the `cancel` of each delayed transition (XState: an array) */
  declare readonly exit: ReadonlyArray<Action<TContext, TEvent>>

  /** Invocations, in config order (XState: an array) */
  declare readonly invoke: ReadonlyArray<InvokeDefinition<TContext, TEvent, TTransitionMeta>>

  /** The config's meta, of the state meta type; `undefined` when it has none (upstream `meta`) */
  declare readonly meta?: TStateMeta

  /** Tags, in config order (XState: an array) */
  declare readonly tags: ReadonlyArray<string>

  /** Output (for final states) */
  declare readonly output: Option.Option<OutputDefinition<TContext, TEvent>>

  /** The config's history kind (`true` is `"shallow"`), else `false`, as upstream's `history`: a `type: "history"` node without one has `false` and restores as shallow */
  declare readonly history: false | HistoryType

  /** Target for history states */
  declare readonly target: Option.Option<string>

  /** The parent state node; none for the root and for a node built outside a machine */
  declare readonly parent: Option.Option<StateNode<TContext, TEvent, TStateMeta, TTransitionMeta>>

  /** The machine this node belongs to; none for a node built outside a machine */
  declare readonly machine: Option.Option<StateNode.Machine<TContext, TEvent>>

  /**
   * The config the node was built from (XState `config`): the object the machine config holds
   * at this node's place, not a copy, so a change to it shows in the machine config. `{}` for
   * a node built outside a machine.
   */
  declare readonly config: StateNodeConfig<TContext, TEvent, TStateMeta, TTransitionMeta>

  constructor(options: StateNode.Options<TContext, TEvent, TStateMeta, TTransitionMeta>) {
    super()
    Object.assign(this, options)
  }

  get [StateNodeTypeId](): Variance.StateNode<TContext, TEvent> {
    return makeStateNodeVariance<TContext, TEvent>()
  }

  /**
   * The initial transition (XState `initial`), built on each read and there on every node:
   * the target child (none when the node has no `initial` or its key names no child), the
   * node as source, the actions, meta and description of `initial: { target, actions, meta,
   * description }`, no event type, and a JSON form with `#<id>` references.
   */
  get initial(): StateNode.InitialTransitionDefinition<TContext, TEvent, TTransitionMeta> {
    return initialTransitionOf(this)
  }

  /**
   * The transitions by event descriptor as a plain object (XState `on`), in the order of
   * {@link transitions}; a descriptor with no transition is left out.
   */
  get on(): Readonly<Record<string, ReadonlyArray<TransitionDefinition<TContext, TEvent, TTransitionMeta>>>> {
    return Object.fromEntries(this.transitions.filter(([, transitions]) => transitions.length > 0))
  }

  /**
   * The event descriptors this node itself takes (XState `ownEvents`), in the key order of
   * {@link on}: those with a transition that is not inert. An inert transition has no target,
   * no actions and does not re-enter, as a forbidden event (`on: { E: undefined }`) builds it.
   */
  get ownEvents(): ReadonlyArray<string> {
    return Object.entries(this.on)
      .filter(([, transitions]) => transitions.some((transition) => !isInert(transition)))
      .map(([descriptor]) => descriptor)
  }

  /**
   * The event descriptors this node and its descendants take (XState `events`): its own,
   * then each child's, in document order, each once.
   */
  get events(): ReadonlyArray<string> {
    const events = [...this.ownEvents, ...Object.values(this.states).flatMap((child) => child.events)]
    return events.filter((event, index) => events.indexOf(event) === index)
  }

  /**
   * The well-structured definition of the node (XState `definition`), built on each read:
   * plain fields, the children's definitions, the transitions and the machine's version.
   * `machine.definition` and `machine.toJSON()` are the root's.
   */
  get definition(): StateNode.Definition<TContext, TEvent, TStateMeta, TTransitionMeta> {
    return definitionOf(this)
  }

  /**
   * The JSON form of the node (XState `toJSON`): its {@link definition}, which names other
   * nodes by `#<id>` and holds no `parent` or `machine`, so serialising never climbs the tree.
   */
  toJSON(): StateNode.Definition<TContext, TEvent, TStateMeta, TTransitionMeta> {
    return this.definition
  }

  toString(): string {
    return `StateNode(${this.id})`
  }

  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  /** Nodes are linked into a graph, so equality is identity (DAT-05). */
  [Equal.symbol](that: Equal.Equal): boolean {
    return this === that
  }

  [Hash.symbol](): number {
    return Hash.random(this)
  }

  static readonly StateNodeTypeId: StateNodeTypeId = StateNodeTypeId
  static readonly isStateNode = isStateNode
  static readonly make = make
  static readonly atomic = atomic
  static readonly compound = compound
  static readonly parallel = parallel
  static readonly final = final
  static readonly historyState = historyState
  static readonly getChild = getChild
  static readonly getChildren = getChildren
  static readonly getTransitions = getTransitions
  static readonly getInitialTarget = getInitialTarget
  static readonly getLeafStates = getLeafStates
  static readonly isAtomic = isAtomic
  static readonly isCompound = isCompound
  static readonly isParallel = isParallel
  static readonly isFinal = isFinal
  static readonly isHistory = isHistory
  static readonly isLeaf = isLeaf
  static readonly isAncestor = isAncestor
  static readonly isDescendant = isDescendant
  static readonly withTransitions = withTransitions
  static readonly withEntry = withEntry
  static readonly withExit = withExit
  static readonly withInvoke = withInvoke
  static readonly withTags = withTags
  static readonly withParent = withParent
}

/**
 * Any state node (upstream `AnyStateNode`), whatever its context, event and meta types.
 *
 * Upstream writes it as a `StateNode` of `any`s. `StateNode` is invariant in its context and
 * event, so no instantiation of it (`StateNode.Any` included) takes every node.
 * `AnyStateNode` is a structural supertype instead, as `AnyStateMachine` is: it keeps the
 * members whose types do not depend on the context or the event, and the `StateNodeTypeId`
 * key, so only a real state node is one; its `meta` and its definition's metas are upstream's
 * `any` (SD-22 amendment, goal journal `2026-10-07-12-any-state-node.md`).
 * `AnyStateMachine.root` is one, and `getStateNodes` takes one.
 *
 * @example
 * ```ts
 * const ids = (node: AnyStateNode): ReadonlyArray<string> => [node.id, ...Object.values(node.states).flatMap(ids)]
 * ids(machine.root) // every state node id of the machine, in document order
 * ```
 *
 * @since 0.1.0
 * @category Models
 */
export interface AnyStateNode {
  readonly [StateNodeTypeId]: unknown
  /** Type of state node */
  readonly type: StateNodeType
  /** Key of this state within its parent; the machine id for the root */
  readonly key: string
  /** Id of this state */
  readonly id: string
  /** Keys from the root to this node */
  readonly path: ReadonlyArray<string>
  /** The config's description, `undefined` when it has none */
  readonly description?: string
  /** Document order */
  readonly order: number
  /** Child states, in document order */
  readonly states: Readonly<Record<string, AnyStateNode>>
  /** The parent state node; none for the root */
  readonly parent: Option.Option<AnyStateNode>
  /**
   * The config's meta, `undefined` when it has none: upstream's `any` (`StateNode<any, any,
   * any, any>`), so a node of any meta type is one and tooling that tracks `any` sees it
   */
  readonly meta?: UpstreamAny
  /** Tags, in config order */
  readonly tags: ReadonlyArray<string>
  /** The config's history kind, else `false` (upstream `history`) */
  readonly history: false | HistoryType
  /** Target for history states */
  readonly target: Option.Option<string>
  /** The event descriptors this node itself takes */
  readonly ownEvents: ReadonlyArray<string>
  /** The event descriptors this node and its descendants take */
  readonly events: ReadonlyArray<string>
  /** The node's well-structured definition (XState `definition`), of any meta */
  readonly definition: AnyStateNodeDefinition
}

/**
 * The definition of any state node (upstream `AnyStateNodeDefinition`,
 * `StateNodeDefinition<any, any, any, any>`): {@link StateNode.Definition} of upstream's
 * `any` context, events, state meta and transition meta, so its `meta` and the `meta` of its
 * transitions stay `any` (SD-22 amendment, goal journal `2026-10-07-12-any-state-node.md`).
 * `AnyStateNode.definition` is one.
 *
 * @example
 * ```ts
 * const metaOf = (definition: AnyStateNodeDefinition) => definition.meta
 * metaOf(machine.root.definition)
 * ```
 *
 * @since 0.1.0
 * @category Models
 */
export type AnyStateNodeDefinition = StateNode.Definition<UpstreamAny, UpstreamAny, UpstreamAny, UpstreamAny>

/**
 * A history state node (upstream `HistoryStateNode<TContext>`, a `StateNode<TContext,
 * EventObject, any, any>` whose `history` is set): its state and transition meta are
 * upstream's `any` (SD-22 amendment, goal journal `2026-10-07-13-node-containers-any.md`).
 * Its `history` is the history kind, as upstream types it; its `target` is the port's
 * `Option` field of every state node (DEV-28).
 *
 * @example
 * ```ts
 * const kindOf = (node: HistoryStateNode<MachineContext>) => node.history // "shallow" | "deep"
 * ```
 *
 * @since 0.1.0
 * @category Models
 */
export interface HistoryStateNode<TContext> extends StateNode<TContext, EventObject, UpstreamAny, UpstreamAny> {
  readonly history: HistoryType
}

// ============================================================
// STATE NODE NAMESPACE
// ============================================================

/** The class instance type, under a name the namespace below can alias. */
type StateNodeInstance<TContext, TEvent extends EventObject, TStateMeta = unknown, TTransitionMeta = TStateMeta> = StateNode<
  TContext,
  TEvent,
  TStateMeta,
  TTransitionMeta
>

/**
 * @since 0.1.0
 * @category State Node
 */
export declare namespace StateNode {
  /**
   * The state node type itself, as the former namespace exposed it.
   *
   * @since 0.1.0
   */
  export type StateNode<TContext, TEvent extends EventObject, TStateMeta = unknown, TTransitionMeta = TStateMeta> =
    StateNodeInstance<TContext, TEvent, TStateMeta, TTransitionMeta>

  /**
   * Extract the Context type from a StateNode.
   *
   * @since 0.1.0
   */
  export type ContextOf<T> = T extends StateNode<infer C, infer _E> ? C : never

  /**
   * Extract the Event type from a StateNode.
   *
   * @since 0.1.0
   */
  export type EventOf<T> = T extends StateNode<infer _C, infer E> ? E : never

  /**
   * Any StateNode type: a node of unknown context and event types whose state and transition
   * meta are upstream's `any` (`StateNode<any, any, any, any>`), as a snapshot's `_nodes` hold
   * them (SD-22 amendment, goal journal `2026-10-07-13-node-containers-any.md`).
   *
   * @since 0.1.0
   */
  export type Any = StateNode<unknown, EventObject, UpstreamAny, UpstreamAny>

  /**
   * The fields a StateNode is built from.
   *
   * @since 0.1.0
   */
  export type Options<TContext, TEvent extends EventObject, TStateMeta = unknown, TTransitionMeta = TStateMeta> = Pick<
    StateNode<TContext, TEvent, TStateMeta, TTransitionMeta>,
    | "type"
    | "key"
    | "id"
    | "path"
    | "description"
    | "order"
    | "states"
    | "_initial"
    | "transitions"
    | "always"
    | "after"
    | "entry"
    | "exit"
    | "invoke"
    | "meta"
    | "tags"
    | "output"
    | "history"
    | "target"
    | "parent"
    | "machine"
    | "config"
  >

  /**
   * The parts of the owning machine a node links to. At run time `node.machine` holds the
   * whole `StateMachine` object.
   *
   * @since 0.1.0
   */
  export interface Machine<TContext, TEvent extends EventObject> {
    readonly id: string
    /** The machine's own version (XState `machine.version`), which definitions carry. */
    readonly version: string | undefined
    readonly root: StateNode<TContext, TEvent>
    readonly idMap: HashMap.HashMap<string, StateNode<TContext, TEvent>>
    readonly implementations: MachineImplementations<TContext, TEvent>
    /** The machine's run-time options, `maxIterations` resolved (default `Infinity`). */
    readonly options: MachineOptions
  }

  /**
   * An action as a definition lists it (XState `toSerializableAction`): an object with a
   * `type`.
   *
   * @since 0.1.0
   */
  export interface SerializableAction {
    readonly type: string
  }

  /**
   * The initial transition of a node (XState `InitialTransitionDefinition`, the
   * `StateNode.initial` getter): target nodes, the node as source, the actions, no event
   * type, no re-entry, the meta and description of the object form of `initial`
   * (`undefined` when it has none), and a JSON form with `#<id>` references.
   *
   * @since 0.1.0
   */
  export interface InitialTransitionDefinition<TContext, TEvent extends EventObject, TTransitionMeta = unknown> {
    readonly target: ReadonlyArray<StateNode<TContext, TEvent>>
    readonly source: StateNode<TContext, TEvent>
    readonly actions: ReadonlyArray<Action<TContext, TEvent>>
    readonly eventType: null
    readonly reenter: false
    readonly meta: TTransitionMeta | undefined
    readonly description: string | undefined
    readonly toJSON: () => unknown
  }

  /**
   * The initial transition of a node's definition (XState): target nodes, the node as
   * source, serialisable actions, no event type, the meta and description of the object
   * form of `initial` (`undefined` when it has none), and a JSON form with `#<id>`
   * references.
   *
   * @since 0.1.0
   */
  export interface InitialDefinition<TContext, TEvent extends EventObject, TTransitionMeta = unknown> {
    readonly target: ReadonlyArray<StateNode<TContext, TEvent>>
    readonly source: StateNode<TContext, TEvent>
    readonly actions: ReadonlyArray<SerializableAction>
    readonly eventType: null
    readonly reenter: false
    readonly meta: TTransitionMeta | undefined
    readonly description: string | undefined
    readonly toJSON: () => unknown
  }

  /**
   * A transition as a definition's `transitions` list holds it: the transition definition
   * with serialisable actions.
   *
   * @since 0.1.0
   */
  export type DefinitionTransition<TContext, TEvent extends EventObject, TTransitionMeta = unknown> = Omit<
    TransitionDefinition<TContext, TEvent, TTransitionMeta>,
    "actions"
  > & { readonly actions: ReadonlyArray<SerializableAction> }

  /**
   * An invocation as a definition lists it: the invoke definition with its JSON form
   * (`{ ...config, type: 'xstate.invoke', src, id }`, without `onDone` and `onError`).
   *
   * @since 0.1.0
   */
  export type DefinitionInvoke<TContext, TEvent extends EventObject, TTransitionMeta = unknown> = InvokeDefinition<
    TContext,
    TEvent,
    TTransitionMeta
  > & {
    readonly toJSON: () => unknown
  }

  /**
   * The well-structured definition of a state node (XState `StateNodeDefinition`), as
   * `node.definition`, `machine.definition` and `machine.toJSON()` give it.
   *
   * @since 0.1.0
   */
  export interface Definition<TContext, TEvent extends EventObject, TStateMeta = unknown, TTransitionMeta = TStateMeta> {
    readonly id: string
    readonly key: string
    readonly version: string | undefined
    readonly type: StateNodeType
    readonly initial: InitialDefinition<TContext, TEvent, TTransitionMeta>
    readonly history: false | HistoryType
    readonly states: Readonly<Record<string, Definition<TContext, TEvent, TStateMeta, TTransitionMeta>>>
    readonly on: Readonly<Record<string, ReadonlyArray<TransitionDefinition<TContext, TEvent, TTransitionMeta>>>>
    readonly transitions: ReadonlyArray<DefinitionTransition<TContext, TEvent, TTransitionMeta>>
    readonly entry: ReadonlyArray<SerializableAction>
    readonly exit: ReadonlyArray<SerializableAction>
    readonly meta: TStateMeta | undefined
    readonly order: number
    readonly output: unknown
    readonly invoke: ReadonlyArray<DefinitionInvoke<TContext, TEvent, TTransitionMeta>>
    readonly description: string | undefined
    readonly tags: ReadonlyArray<string>
  }
}

/**
 * The initial transition of a state node, `node.initial` (upstream
 * `InitialTransitionDefinition`).
 *
 * @since 0.1.0
 * @category State Node
 */
export type InitialTransitionDefinition<TContext, TEvent extends EventObject, TTransitionMeta = unknown> =
  StateNode.InitialTransitionDefinition<TContext, TEvent, TTransitionMeta>
