/**
 * @since 0.4.0
 * @module internal/settlement
 *
 * The type check that an agent invocation's settlement leaves the invoking state. The
 * `Unsettled` output itself is in `actors/unsettled.ts`. `InvokedDoneConfig` in `Types.ts`
 * makes `onDone` required on an invocation of agent logic; `SettlementCheck` walks the machine config as written (a setup's `const
 * TConfig`) and refuses each agent `onDone` that may stay in the invoking state (S15) and each
 * `on` key that takes an agent's done event in place of `onDone`: the exact key in any state, and
 * a wildcard below the invoking state, where the engine selects it first, or in a parallel region
 * beside it where it conflicts with `onDone`. Upstream has no counterpart: agent settlement is a
 * port addition.
 */
import type { AgentBranded, AgentChildId, HoldsAgents } from "./agentBrand.js"

/**
 * The error an agent invocation's `onDone` gets when one of its branches may stay in the
 * invoking state: no target, a target of the invoking state or of a node below it, or a
 * guarded list with no unguarded fallback. No value fits it.
 *
 * @since 0.4.0
 * @category Internal
 */
export interface SettlementMustExit {
  /** Why the `onDone` is refused. */
  readonly SettlementMustExit: "an agent invocation's onDone must leave the invoking state on every branch"
}

/**
 * The error an `on` key gets when it takes the done event of an invoked agent
 * (`xstate.done.actor.<id>`): the agent settles only through its invocation's `onDone`. No
 * value fits it.
 *
 * @since 0.4.0
 * @category Internal
 */
export interface AgentDoneOutsideOnDone {
  /** Why the key is refused. */
  readonly AgentDoneOutsideOnDone: "an agent's done event is handled only by its invocation's onDone"
}

/**
 * The settlement errors of a setup machine's config as written, shaped as the config so that
 * each error lands on the `onDone` or `on` key it names; `unknown` when there is none. A setup
 * without agent actors (`TActor`, its `ProvidedActor` union) always gets `unknown`, with no
 * walk. A target that is not a literal, or an `#id` that names no node, fails closed.
 *
 * @since 0.4.0
 * @category Internal
 */
export type SettlementCheck<TConfig, TActor> = [SettledSrc<TActor>] extends [never] ? unknown
  : CheckNode<
    TConfig,
    WalkOf<TConfig, TActor>,
    "",
    "",
    false
  >

/** The walk's fixed inputs: agent src names, every `[id, path]` pair, and the refused `on` keys. */
interface Walk {
  /** The src names whose invocations must settle by leaving the state. */
  readonly srcs: string
  /** Each explicit node id with its node's path, the root's included. */
  readonly ids: readonly [string, string]
  /** The `on` keys that would take an invoked agent's done event. */
  readonly doneKeys: string
  /** The src names of the agent actors, whose done event a wildcard can take. */
  readonly agentSrcs: string
}

/** The {@link Walk} of a config, for the setup's `ProvidedActor` union `TActor`. */
interface WalkOf<TConfig, TActor> extends Walk {
  /** The src names of the agent actors and of the machines that hold agents. */
  readonly srcs: SettledSrc<TActor>
  /** Each explicit node id with its node's path, the root's included. */
  readonly ids: IdPaths<TConfig, ""> | readonly [RootId<TConfig>, ""]
  /** The done-event keys of every agent invocation id and every declared agent child id. */
  readonly doneKeys: `xstate.done.actor.${AgentInvokeIds<TConfig, AgentSrc<TActor>> | AgentChildId<TActor>}`
  /** The src names of the agent actors. */
  readonly agentSrcs: AgentSrc<TActor>
}

/**
 * The `on` keys that match every done event of a child, whatever its id. A generated invocation
 * id has no literal key, so these are all that can catch one.
 *
 * @since 0.4.0
 * @category Internal
 */
export type AgentDoneWildcard = "*" | "xstate.*" | "xstate.done.*" | "xstate.done.actor.*"

/**
 * The partial keys that match the done event of some child ids. The check does not know a
 * generated id, so it refuses each of them, even one that names another id: the structural proof
 * matches the real id.
 */
type PartialDoneKey = `xstate.done.actor.${string}.*`

/**
 * The `on` keys of `TOn` with a transition: a forbidden (`undefined`) one is no handler.
 *
 * @since 0.4.0
 * @category Internal
 */
export type DefinedKeys<TOn> = { [K in keyof TOn]: [TOn[K]] extends [undefined] ? never : K }[keyof TOn]

/**
 * The src names of the agent actors among `TActor`.
 *
 * @since 0.4.0
 * @category Internal
 */
export type AgentSrc<TActor> = TActor extends { readonly src: infer TSrc extends string; readonly logic: AgentBranded } ? TSrc
  : never

/**
 * The src names of the machines that hold agents among `TActor` (S17).
 *
 * @since 0.4.0
 * @category Internal
 */
export type HolderSrc<TActor> = TActor extends { readonly src: infer TSrc extends string; readonly logic: HoldsAgents } ? TSrc
  : never

/**
 * The src names whose invocations must settle by leaving the state, and which turn a setup's
 * settlement checks on: agent actors and machines that hold agents.
 *
 * @since 0.4.0
 * @category Internal
 */
export type SettledSrc<TActor> = AgentSrc<TActor> | HolderSrc<TActor>

/**
 * The machine's id as targets name it: the config's `id`, else `(machine)`.
 *
 * @since 0.4.0
 * @category Internal
 */
export type RootId<TConfig> = TConfig extends { readonly id: infer TId extends string } ? TId : "(machine)"

/**
 * A child path: `TKey` below `TPath`, joined with `.` (the root's path is `""`).
 *
 * @since 0.4.0
 * @category Internal
 */
export type Join<TPath extends string, TKey extends string> = TPath extends "" ? TKey : `${TPath}.${TKey}`

/**
 * Every explicit node id of the config as `[id, path]`, with the path of its node.
 *
 * @since 0.4.0
 * @category Internal
 */
export type IdPaths<TNode, TPath extends string> =
  | (TNode extends { readonly id: infer TId extends string } ? readonly [TId, TPath] : never)
  | (TNode extends { readonly states: infer TStates } ? {
    [K in keyof TStates & string]: IdPaths<TStates[K], Join<TPath, K>>
  }[keyof TStates & string]
    : never)

/** The ids the config gives invocations of agent logic, in any state. */
type AgentInvokeIds<TNode, TSrcs> =
  | (TNode extends { readonly invoke: infer TInvoke }
    ? (TInvoke extends ReadonlyArray<infer TEntry> ? TEntry : TInvoke) extends infer TEntry
      ? TEntry extends { readonly src: TSrcs; readonly id: infer TId extends string } ? TId : never
    : never
    : never)
  | (TNode extends { readonly states: infer TStates } ? { [K in keyof TStates]: AgentInvokeIds<TStates[K], TSrcs> }[keyof TStates]
    : never)

/**
 * How the engine reads a node beside or before an agent's `onDone`: `false` not at all, `true`
 * first (below the invoking state), or a region's path when the node sits in a parallel region
 * beside an agent: there a key conflicts with `onDone` only by leaving that region. The path
 * {@link AnyRegion} is in no config, so every target leaves it.
 */
type RivalMode = boolean | string

/** The region of a rival beside an agent whose `onDone` exits the regions, so that any target conflicts. */
type AnyRegion = "(any region)"

/** The settlement errors of one node and the nodes below it; `unknown` when there is none. */
type CheckNode<TNode, TWalk extends Walk, TSelf extends string, TParent extends string, TRival extends RivalMode> =
  & InvokeErrors<TNode, TWalk, TSelf, TParent>
  & OnErrors<TNode, TWalk, TSelf, TParent, TRival>
  & StatesErrors<TNode, TWalk, TSelf, TRival>

/** The errors below the node, under `states`, only for the children that have one. */
type StatesErrors<TNode, TWalk extends Walk, TSelf extends string, TRival extends RivalMode> = TNode extends
  { readonly states: infer TStates }
  ? [FailingKeys<TNode, TStates, TWalk, TSelf, TRival>] extends [never] ? unknown
  : {
    readonly states: {
      readonly [K in FailingKeys<TNode, TStates, TWalk, TSelf, TRival>]: CheckNode<
        TStates[K],
        TWalk,
        Join<TSelf, K>,
        TSelf,
        ChildRival<TNode, TStates, K, TWalk, TSelf, TRival>
      >
    }
  }
  : unknown

/** The child keys whose subtree has a settlement error. */
type FailingKeys<TNode, TStates, TWalk extends Walk, TSelf extends string, TRival extends RivalMode> = {
  [K in keyof TStates & string]: unknown extends
    CheckNode<TStates[K], TWalk, Join<TSelf, K>, TSelf, ChildRival<TNode, TStates, K, TWalk, TSelf, TRival>> ? never : K
}[keyof TStates & string]

/**
 * How the engine reads the child `K` of `TNode`: as the node, once it is below an agent; as a
 * rival below the invoking state when the node invokes an agent; as a rival beside an agent when
 * the node is parallel and another region holds one. An ancestor stays out: the engine reads it
 * only when nothing below selects, and a total `onDone` always selects.
 */
type ChildRival<TNode, TStates, K extends keyof TStates & string, TWalk extends Walk, TSelf extends string, TRival extends RivalMode> =
  true extends TRival ? true
    : [InvokesAgent<TNode, TWalk["agentSrcs"]>] extends [never]
      ? TNode extends { readonly type: "parallel" }
        ? [HoldsAgentInvocation<TStates[Exclude<keyof TStates, K>], TWalk["agentSrcs"]>] extends [never] ? TRival
        : true extends RegionsLeft<TStates, Exclude<keyof TStates & string, K>, TWalk, TSelf> ? AnyRegion
        : Join<TSelf, K>
      : TRival
    : true

/** `true` when the node itself invokes an agent, by name or inline; else none. */
type InvokesAgent<TNode, TSrcs> = TNode extends { readonly invoke: infer TInvoke }
  ? (TInvoke extends ReadonlyArray<infer TEntry> ? TEntry : TInvoke) extends infer TEntry
    ? TEntry extends { readonly src: TSrcs | AgentBranded } ? true : never
  : never
  : never

/** `true` when the node or a node below it invokes an agent; else none. */
type HoldsAgentInvocation<TNode, TSrcs> =
  | InvokesAgent<TNode, TSrcs>
  | (TNode extends { readonly states: infer TStates }
    ? { [K in keyof TStates]: HoldsAgentInvocation<TStates[K], TSrcs> }[keyof TStates]
    : never)

/** `true` for each of the regions `TKeys` where an agent's `onDone` leaves the region. */
type RegionsLeft<TStates, TKeys extends keyof TStates & string, TWalk extends Walk, TSelf extends string> = TKeys extends unknown
  ? OnDoneLeaves<TStates[TKeys], TWalk, Join<TSelf, TKeys>, TSelf, Join<TSelf, TKeys>>
  : never

/** `true` when an agent's `onDone` at or below the node has a target outside `TRegion`. */
type OnDoneLeaves<TNode, TWalk extends Walk, TSelf extends string, TParent extends string, TRegion extends string> =
  | (TNode extends { readonly invoke: infer TInvoke }
    ? (TInvoke extends ReadonlyArray<infer TEntry> ? TEntry : TInvoke) extends infer TEntry
      ? TEntry extends { readonly src: TWalk["agentSrcs"] | AgentBranded; readonly onDone: infer TDone }
        ? TransitionLeaves<TDone, TWalk, TSelf, TParent, TRegion>
      : false
    : false
    : false)
  | (TNode extends { readonly states: infer TStates } ? {
      [K in keyof TStates & string]: OnDoneLeaves<TStates[K], TWalk, Join<TSelf, K>, TSelf, TRegion>
    }[keyof TStates & string]
    : false)

/**
 * `true` for each member of a transition as written that has a target outside or at `TRegion`: a
 * target at the region's own node exits it, as the engine's domain is the node above a target.
 * A re-entering member counts, whatever its target.
 */
type TransitionLeaves<TTransition, TWalk extends Walk, TSelf extends string, TParent extends string, TRegion extends string> =
  TTransition extends ReadonlyArray<infer TEach> ? TransitionLeaves<TEach, TWalk, TSelf, TParent, TRegion>
    : TTransition extends string ? TargetLeavesRegion<TTransition, TWalk, TSelf, TParent, TRegion>
    : TTransition extends { readonly target: infer TTarget }
      ? [TTarget] extends [undefined] ? false
      : TTransition extends { readonly reenter: true } ? true
      : TTarget extends string ? TargetLeavesRegion<TTarget, TWalk, TSelf, TParent, TRegion>
      : TTarget extends ReadonlyArray<infer TEach extends string> ? TargetLeavesRegion<TEach, TWalk, TSelf, TParent, TRegion>
      : false
    : false

/** `true` when the target's path is not strictly below `TRegion`. An empty target moves nothing. */
type TargetLeavesRegion<TTarget extends string, TWalk extends Walk, TSelf extends string, TParent extends string, TRegion extends string> =
  TTarget extends "" ? false : ResolveTarget<TTarget, TWalk, TSelf, TParent> extends `${TRegion}.${string}` ? false : true

/** The refused `on` keys of the node: those that take an invoked agent's done event. */
type OnErrors<TNode, TWalk extends Walk, TSelf extends string, TParent extends string, TRival extends RivalMode> = TNode extends
  { readonly on: infer TOn }
  ? [RefusedKeys<TOn, TWalk, TSelf, TParent, TRival>] extends [never] ? unknown
  : { readonly on: { readonly [K in RefusedKeys<TOn, TWalk, TSelf, TParent, TRival>]: AgentDoneOutsideOnDone } }
  : unknown

/**
 * The exact done keys in any state, and the wildcards of a rival: each one below the invoking
 * state, and beside an agent each one that leaves the region. A wildcard on the invoking state
 * itself stays free: the engine tries the exact `onDone` candidates first, and a total `onDone`
 * takes the event. An exact key of a generated id has no literal here: `proveSettlement` reads
 * the real id.
 */
type RefusedKeys<TOn, TWalk extends Walk, TSelf extends string, TParent extends string, TRival extends RivalMode> =
  | (keyof TOn & TWalk["doneKeys"])
  | (true extends TRival ? Extract<DefinedKeys<TOn>, AgentDoneWildcard | PartialDoneKey>
    : TRival extends string ? {
        [K in Extract<DefinedKeys<TOn>, AgentDoneWildcard | PartialDoneKey>]: true extends
          TransitionLeaves<TOn[K], TWalk, TSelf, TParent, TRival> ? K : never
      }[Extract<DefinedKeys<TOn>, AgentDoneWildcard | PartialDoneKey>]
    : never)

/** The errors of the node's invocations: one entry, or a list with an entry per invocation. */
type InvokeErrors<TNode, TWalk extends Walk, TSelf extends string, TParent extends string> = TNode extends
  { readonly invoke: infer TInvoke }
  ? TInvoke extends ReadonlyArray<unknown>
    ? [FailingEntry<TInvoke[number], TWalk, TSelf, TParent>] extends [never] ? unknown
    : { readonly invoke: EntryErrors<TInvoke, TWalk, TSelf, TParent> }
  : unknown extends EntryError<TInvoke, TWalk, TSelf, TParent> ? unknown
  : { readonly invoke: EntryError<TInvoke, TWalk, TSelf, TParent> }
  : unknown

/** What an invocation whose `onDone` may stay in the state is checked against. */
interface SettlementErrorEntry {
  /** No `onDone` fits it. */
  readonly onDone: SettlementMustExit
}

/** The invocations among `TEntry` (a union) that have an error. */
type FailingEntry<TEntry, TWalk extends Walk, TSelf extends string, TParent extends string> = TEntry extends unknown
  ? unknown extends EntryError<TEntry, TWalk, TSelf, TParent> ? never : TEntry
  : never

/** The error of each invocation of a list, position by position. */
type EntryErrors<TInvoke extends ReadonlyArray<unknown>, TWalk extends Walk, TSelf extends string, TParent extends string> = {
  readonly [I in keyof TInvoke]: EntryError<TInvoke[I], TWalk, TSelf, TParent>
}

/**
 * The error of one invocation: none for ordinary logic, or for an agent invocation with no
 * `onDone` (the required member reports that one); else none only when every branch exits.
 */
type EntryError<TEntry, TWalk extends Walk, TSelf extends string, TParent extends string> = TEntry extends
  { readonly src: TWalk["srcs"]; readonly onDone: infer TDone }
  ? SettlementExits<TDone, TWalk, TSelf, TParent> extends true ? unknown : SettlementErrorEntry
  : unknown

/**
 * `true` when every branch of the `onDone` leaves the state: one unguarded exiting
 * transition, or a list whose every member exits and whose last member is unguarded.
 */
type SettlementExits<TDone, TWalk extends Walk, TSelf extends string, TParent extends string> = TDone extends
  ReadonlyArray<unknown>
  ? TDone extends readonly [...ReadonlyArray<unknown>, infer TLast]
    ? Unguarded<TLast> extends true ? AllExit<TDone[number], TWalk, TSelf, TParent> : false
  : false
  : Unguarded<TDone> extends true ? AllExit<TDone, TWalk, TSelf, TParent>
  : false

/** `true` when the transition has no guard: a target string, or a config whose guard is absent. */
type Unguarded<TTransition> = TTransition extends { readonly guard: infer TGuard } ? [TGuard] extends [undefined] ? true : false
  : true

/** `true` when every transition of the union exits the state. */
type AllExit<TTransition, TWalk extends Walk, TSelf extends string, TParent extends string> = false extends (
  TTransition extends string ? TargetExits<TTransition, TWalk, TSelf, TParent>
    : TTransition extends { readonly target: infer TTarget } ? TargetsExit<TTarget, TWalk, TSelf, TParent>
    : false
) ? false
  : true

/** `true` when the target, or every target of a list of them, exits the state. */
type TargetsExit<TTarget, TWalk extends Walk, TSelf extends string, TParent extends string> = TTarget extends string
  ? TargetExits<TTarget, TWalk, TSelf, TParent>
  : TTarget extends readonly [unknown, ...ReadonlyArray<unknown>]
    ? false extends (TTarget[number] extends infer T extends string ? TargetExits<T, TWalk, TSelf, TParent> : false) ? false : true
  : false

/**
 * `true` when the target resolves to a node outside the state (`TSelf`) and outside the nodes
 * below it. The root contains every node, so an invocation on the root never exits.
 */
type TargetExits<TTarget extends string, TWalk extends Walk, TSelf extends string, TParent extends string> = Exits<
  ResolveTarget<TTarget, TWalk, TSelf, TParent>,
  TSelf
>

/** `true` when the resolved path names a node outside `TSelf`; `false` for none or a wide string. */
type Exits<TPath, TSelf extends string> = [TPath] extends [never] ? false
  : string extends TPath ? false
  : TSelf extends "" ? false
  : TPath extends TSelf ? false
  : TPath extends `${TSelf}.${string}` ? false
  : true

/**
 * The path of the node a target names: `#id` and `#id.path` from the node with that id, `.path`
 * from the state, any other key from its parent. An empty target or an unknown id gives none.
 * The path is not checked against the config: `TargetOf` in `settlement.ts` does that.
 *
 * @since 0.4.0
 * @category Internal
 */
export type ResolveTarget<TTarget extends string, TWalk extends Pick<Walk, "ids">, TSelf extends string, TParent extends string> =
  TTarget extends "" ? never
    : TTarget extends `#${infer TRest}`
      ? TRest extends `${infer TId}.${infer TPath}` ? JoinFound<PathOfId<TWalk["ids"], TId>, TPath>
      : PathOfId<TWalk["ids"], TRest>
    : TTarget extends `.${infer TPath}` ? Join<TSelf, TPath>
    : Join<TParent, TTarget>

/** The path of the node with the id `TId`; none when no node has it. */
type PathOfId<TIds, TId extends string> = TIds extends readonly [TId, infer TPath extends string] ? TPath : never

/** `TPath` below a found path, or none when the path was not found. */
type JoinFound<TFound extends string, TPath extends string> = [TFound] extends [never] ? never : Join<TFound, TPath>
