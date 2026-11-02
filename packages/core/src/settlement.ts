/**
 * @since 0.4.0
 * @module settlement
 *
 * The type-level settlement proof of a setup machine. This module holds its first part: every
 * transition target of the config as written (a setup's `const TConfig`) must name a state of
 * that machine. `TargetOf` resolves one target the way the engine does (`stateUtils.ts`
 * `resolveTarget`), and `TargetCheck` walks the config and puts an error on each target that
 * names no state and on each duplicate state id; in a setup with agent actors, also on each
 * history state with no default target. A target typed as `string`, not a literal (a config
 * built as a variable before the call), cannot be checked by type and is left to the engine, as
 * upstream; the settlement proof decides what such a target means for it. A plain `createMachine` has no `const TConfig`, so its string targets stay unchecked by type;
 * a bad target there stays the run-time definition error (SD-3). Upstream has no counterpart:
 * the settlement proof is a port addition. The agent `onDone` exit rules are in
 * `internal/settlement.ts`.
 *
 * Child machines compose through certificates (decision 10, S17). The agent brand does not spread:
 * a config that invokes agent logic gives its machine the `HoldsAgents` flag, `certified` binds a
 * certificate to such a machine, and a parent declares it only in that form. A proved child counts
 * as progress for a parent that waits on its `onDone`, and `ChildSettlementCheck` needs a handler
 * for a spawned child's settlement event in every state where the child may be alive.
 */
import type { AnyLogicSlot } from "./ActorLogic.js"
import type { CertifiedChild, HoldsAgents } from "./internal/agentBrand.js"
import type {
  AgentDoneWildcard,
  AgentSrc,
  DefinedKeys,
  HolderSrc,
  IdPaths,
  Join,
  ResolveTarget,
  RootId,
  SettledSrc,
} from "./internal/settlement.js"

/**
 * The error a transition target gets when it names no state of the machine: an unknown key or
 * `#id`, a path through a node that has no such child, a target on the root that starts with
 * neither `.` nor `#`, or a target that is not a string literal. No value fits it.
 *
 * @since 0.4.0
 * @category Settlement
 */
export interface UnknownTarget<TTarget extends string> {
  /** Why the target is refused, with the target as written. */
  readonly UnknownTarget: `no state of this machine matches the target "${TTarget}"`
}

/**
 * The error a state id gets when another node of the same machine has that id too: a `#id`
 * target could name either node. No value fits it.
 *
 * @since 0.4.0
 * @category Settlement
 */
export interface DuplicateStateId<TId extends string> {
  /** Why the id is refused, with the id as written. */
  readonly DuplicateStateId: `more than one state of this machine has the id "${TId}"`
}

/**
 * What a history state of a setup with agent actors is checked against: it must name the
 * state it enters when it has no record yet. The engine falls back to the parent's initial
 * state; the settlement proof needs the edge written out, so a history state with no `target`,
 * or an empty one, is refused. A setup without agent actors keeps the upstream fallback.
 *
 * @since 0.4.0
 * @category Settlement
 */
export interface HistoryDefault {
  /** The state the history state enters when it has no record. */
  readonly target: HistoryNeedsDefaultTarget
}

/**
 * The error an empty history `target` gets. No value fits it.
 *
 * @since 0.4.0
 * @category Settlement
 */
export interface HistoryNeedsDefaultTarget {
  /** Why the target is refused. */
  readonly HistoryNeedsDefaultTarget: "a history state must name the state it enters when it has no record"
}

/**
 * The path (keys joined with `.`, `""` for the root) of the state that the target `TTarget`
 * names in the config `TConfig`, from the state at the path `TSource`; `never` when it names
 * no state. A `#id` resolves from the node with that id, `.path` from the source, a `#id` of
 * the machine id from the root, and any other key from the source's parent. On the root, a
 * target must start with `.` or `#`, as the engine requires. A target that is not a literal
 * names no state.
 *
 * @example
 * ```ts
 * type Config = { id: "m"; states: { a: { states: { b: {} } }; c: { id: "c" } } }
 * type Sibling = TargetOf<Config, "a", "c"> // "c"
 * type Child = TargetOf<Config, "a", ".b"> // "a.b"
 * type ById = TargetOf<Config, "a.b", "#m.c"> // "c"
 * type Unknown = TargetOf<Config, "a", "d"> // never
 * ```
 *
 * @since 0.4.0
 * @category Settlement
 */
export type TargetOf<TConfig, TSource extends string, TTarget extends string> = KnownPath<
  ResolveFrom<TTarget, Ids<TConfig>, TSource>,
  StatePaths<TConfig, "">
>

/**
 * The target errors of a setup machine's config as written, shaped as the config so that each
 * error lands on the target, `id` or history state it names; `unknown` when there is none.
 * Each `on`, `after`, `always` and state `onDone` transition is checked, and each invocation's
 * `onDone`, `onError` and `onSnapshot`, in every state and on the root. A targetless
 * transition (no `target`, or `""`) is legal, and so is a target typed as `string`. `TActor`
 * is the setup's `ProvidedActor` union: with an agent actor among it, a history state with no
 * default target is refused too. The walk recurses once per level of nesting, so its depth is
 * the config's depth, never its size.
 *
 * @since 0.4.0
 * @category Settlement
 */
export type TargetCheck<TConfig, TActor = never> = [SettledSrc<TActor>] extends [never]
  ? CheckNode<TConfig, TargetWalkOf<TConfig, TActor>, "", "">
  : true extends StructuralAny<TConfig> ? ConfigNotLiteral<"">
  : CheckNode<TConfig, TargetWalkOf<TConfig, TActor>, "", "">

/**
 * Detect erased structural information before recursive target resolution or graph closure.
 * A nested `any` can absorb a property-level diagnostic, so its error must be placed on
 * the complete config. Inspect only fields the proof reads. Callback bodies and payloads
 * remain opaque; actor logic and guards retain identity without traversing implementation
 * objects. Dictionary mode prevents state or event names from being mistaken for fields.
 *
 * @since 0.4.0
 */
type StructuralAny<T, Dictionary extends boolean = false> = 0 extends (1 & T) ? true
  : T extends ReadonlyArray<unknown> ? StructuralAny<T[number], Dictionary>
  : T extends object ? {
    [K in keyof T]-?: Dictionary extends true ? StructuralAny<T[K]>
      : K extends "states" | "on" | "after" ? StructuralAny<T[K], true>
      : K extends "src" | "guard" ? 0 extends (1 & T[K]) ? true : false
      : K extends "invoke" | "always" | "onDone" | "onError" | "onSnapshot" | "initial" | "target" | "id" | "type" | "history" | "reenter"
        ? StructuralAny<T[K]>
      : false
  }[keyof T] : false

/** The walk's fixed inputs, computed once per config: every `[id, path]` pair and every path. */
interface TargetWalk {
  /** Each explicit node id with its node's path, the root's included. */
  readonly ids: readonly [string, string]
  /** The path of every node the engine can reach by a target, the root's (`""`) included. */
  readonly paths: string
  /** The ids that more than one node has. */
  readonly duplicates: string
  /** `true` when the setup has agent actors, so a history state needs a default target. */
  readonly agents: boolean
}

/** The {@link TargetWalk} of a config, for the setup's `ProvidedActor` union `TActor`. */
interface TargetWalkOf<TConfig, TActor> extends TargetWalk {
  /** Each explicit node id with its node's path, the root's included. */
  readonly ids: Ids<TConfig>
  /** The path of every node the engine can reach by a target, the root's (`""`) included. */
  readonly paths: StatePaths<TConfig, "">
  /** The ids that more than one node has. */
  readonly duplicates: Duplicates<Ids<TConfig>>
  /** `true` when the setup has agent actors, so a history state needs a default target. */
  readonly agents: [AgentSrc<TActor>] extends [never] ? false : true
}

/** Every `[id, path]` pair of the config: the explicit ids, and the machine id for the root. */
type Ids<TConfig> = IdPaths<TConfig, ""> | readonly [RootId<TConfig>, ""]

/**
 * The path of every node below `TPath`, and `TPath` itself. A key with `.` or `\` in it is left
 * out: the engine splits a target on `.` and escapes with `\`, so the type proof does not follow
 * such a key, and a target into it fails closed.
 */
type StatePaths<TNode, TPath extends string> =
  | TPath
  | (TNode extends { readonly states: infer TStates } ? {
    [K in keyof TStates & string]: K extends `${string}.${string}` | `${string}\\${string}` ? never
      : StatePaths<TStates[K], Join<TPath, K>>
  }[keyof TStates & string]
    : never)

/** The ids of `TIds` that more than one path has; `TAll` keeps the whole union while `TIds` distributes. */
type Duplicates<TIds, TAll = TIds> = TIds extends readonly [infer TId extends string, infer TPath] ?
  [Exclude<PathsOfId<TAll, TId>, TPath>] extends [never] ? never : TId
  : never

/** Every path that has the id `TId`. */
type PathsOfId<TIds, TId extends string> = TIds extends readonly [TId, infer TPath extends string] ? TPath : never

/**
 * The path a target names from the source `TSelf` (whose parent is `TParent`), before the
 * existence check. On the root (`TSelf` is `""`) a plain key names nothing.
 */
type ResolveFrom<TTarget extends string, TIds extends readonly [string, string], TSelf extends string> = string extends
  TTarget ? never
  : TSelf extends "" ? TTarget extends `#${string}` | `.${string}` ? ResolveTarget<TTarget, { readonly ids: TIds }, "", "">
    : never
  : ResolveTarget<TTarget, { readonly ids: TIds }, TSelf, ParentOf<TSelf>>

/** The path of the parent of the node at `TPath`: everything before its last `.`. */
type ParentOf<TPath extends string, TDone extends string = ""> = TPath extends `${infer THead}.${infer TRest}`
  ? ParentOf<TRest, Join<TDone, THead>>
  : TDone

/** `TPath` when it is one known path, else `never`. */
type KnownPath<TPath, TPaths> = [TPath] extends [never] ? never : [TPath] extends [TPaths] ? TPath : never

/**
 * `true` when the target names a state from `TSelf`. `""` is targetless and always legal; a
 * target typed as `string` cannot be checked by type and passes.
 */
type Resolves<TTarget, TWalk extends TargetWalk, TSelf extends string> = TTarget extends "" ? true
  : string extends TTarget ? true
  : TTarget extends string ? [KnownPath<ResolveFrom<TTarget, TWalk["ids"], TSelf>, TWalk["paths"]>] extends [never] ? false
    : true
  : false

/** The target errors of one node and the nodes below it; `unknown` when there is none. */
type CheckNode<TNode, TWalk extends TargetWalk, TSelf extends string, TParent extends string> =
  & IdError<TNode, TWalk>
  & HistoryError<TNode, TWalk, TParent>
  & RecordErrors<TNode, "on", TWalk, TSelf>
  & RecordErrors<TNode, "after", TWalk, TSelf>
  & MemberError<TNode, "always", TWalk, TSelf>
  & MemberError<TNode, "onDone", TWalk, TSelf>
  & InvokeErrors<TNode, TWalk, TSelf>
  & StatesErrors<TNode, TWalk, TSelf>

/** The error of a node whose `id` another node has too. */
type IdError<TNode, TWalk extends TargetWalk> = TNode extends { readonly id: infer TId extends string }
  ? [TId] extends [TWalk["duplicates"]] ? { readonly id: DuplicateStateId<TId> } : unknown
  : unknown

/**
 * The error of a history state: none, when its default `target` names a state from its parent
 * (the engine resolves it there); else the unknown target. With no default target, the error is
 * {@link HistoryDefault} in a setup with agent actors, and none otherwise.
 */
type HistoryError<TNode, TWalk extends TargetWalk, TParent extends string> = TNode extends { readonly type: "history" }
  ? TNode extends { readonly target: infer TTarget }
    ? TTarget extends "" | undefined ? NoDefault<TWalk> : HistoryTargetError<TTarget, TWalk, TParent>
  : NoDefault<TWalk>
  : unknown

/** The error of a history state with no default target: {@link HistoryDefault} only with agent actors. */
type NoDefault<TWalk extends TargetWalk> = TWalk["agents"] extends true ? HistoryDefault : unknown

/** The error of a history state's default target, resolved below the history state's parent. */
type HistoryTargetError<TTarget, TWalk extends TargetWalk, TParent extends string> = string extends TTarget ? unknown
  : TTarget extends string ? [
    KnownPath<
      TTarget extends `#${string}` ? ResolveTarget<TTarget, { readonly ids: TWalk["ids"] }, TParent, TParent>
        : Join<TParent, TTarget>,
      TWalk["paths"]
    >
  ] extends [never] ? { readonly target: UnknownTarget<TTarget> }
  : unknown
  : { readonly target: UnknownTarget<string> }

/** The errors of a record of transitions (`on`, `after`), only for the keys that have one. */
type RecordErrors<TNode, TKey extends "on" | "after", TWalk extends TargetWalk, TSelf extends string> = TNode extends
  { readonly [K in TKey]: infer TRecord }
  ? [FailingTransitionKeys<TRecord, TWalk, TSelf>] extends [never] ? unknown
  : {
    readonly [K in TKey]: {
      readonly [E in FailingTransitionKeys<TRecord, TWalk, TSelf>]: TransitionError<TRecord[E], TWalk, TSelf>
    }
  }
  : unknown

/** The keys of a record of transitions whose transition has a target error. */
type FailingTransitionKeys<TRecord, TWalk extends TargetWalk, TSelf extends string> = {
  [E in keyof TRecord]: unknown extends TransitionError<TRecord[E], TWalk, TSelf> ? never : E
}[keyof TRecord]

/** The error of one transition member of a node (`always`, a state's `onDone`). */
type MemberError<TNode, TKey extends "always" | "onDone", TWalk extends TargetWalk, TSelf extends string> =
  TNode extends { readonly [K in TKey]: infer TTransition }
    ? unknown extends TransitionError<TTransition, TWalk, TSelf> ? unknown
    : { readonly [K in TKey]: TransitionError<TTransition, TWalk, TSelf> }
    : unknown

/**
 * The error of one transition as written: a target string, a transition config, or a list of
 * either, position by position. `unknown` when every target resolves.
 */
type TransitionError<TTransition, TWalk extends TargetWalk, TSelf extends string> = TTransition extends
  ReadonlyArray<unknown> ? ListError<TTransition, TWalk, TSelf>
  : TTransition extends string ? Resolves<TTransition, TWalk, TSelf> extends true ? unknown : UnknownTarget<TTransition>
  : TTransition extends { readonly target: infer TTarget }
    ? unknown extends TargetsError<TTarget, TWalk, TSelf> ? unknown : { readonly target: TargetsError<TTarget, TWalk, TSelf> }
  : unknown

/** The error of a list of transitions, position by position; `unknown` when none fails. */
type ListError<TList extends ReadonlyArray<unknown>, TWalk extends TargetWalk, TSelf extends string> =
  [FailingTransition<TList[number], TWalk, TSelf>] extends [never] ? unknown
    : { readonly [I in keyof TList]: TransitionError<TList[I], TWalk, TSelf> }

/** The transitions among `TTransition` (a union, checked member by member) that have an error. */
type FailingTransition<TTransition, TWalk extends TargetWalk, TSelf extends string> = TTransition extends unknown
  ? unknown extends TransitionError<TTransition, TWalk, TSelf> ? never : TTransition
  : never

/** The error of a transition's `target`: one string, or a list into parallel regions. */
type TargetsError<TTarget, TWalk extends TargetWalk, TSelf extends string> = TTarget extends undefined ? unknown
  : TTarget extends string ? Resolves<TTarget, TWalk, TSelf> extends true ? unknown : UnknownTarget<TTarget>
  : TTarget extends ReadonlyArray<unknown> ? false extends (TTarget[number] extends infer T ? Resolves<T, TWalk, TSelf> : never)
    ? { readonly [I in keyof TTarget]: Resolves<TTarget[I], TWalk, TSelf> extends true ? unknown : UnknownTarget<Literal<TTarget[I]>> }
    : unknown
  : unknown

/** A target as the error names it: the literal, or `string` for anything else. */
type Literal<TTarget> = TTarget extends string ? TTarget : string

/** The errors of the node's invocations: one entry, or a list with an entry per invocation. */
type InvokeErrors<TNode, TWalk extends TargetWalk, TSelf extends string> = TNode extends { readonly invoke: infer TInvoke }
  ? TInvoke extends ReadonlyArray<unknown>
    ? [FailingEntry<TInvoke[number], TWalk, TSelf>] extends [never] ? unknown
    : { readonly invoke: { readonly [I in keyof TInvoke]: EntryError<TInvoke[I], TWalk, TSelf> } }
  : unknown extends EntryError<TInvoke, TWalk, TSelf> ? unknown
  : { readonly invoke: EntryError<TInvoke, TWalk, TSelf> }
  : unknown

/** The invocations among `TEntry` (a union, checked member by member) that have an error. */
type FailingEntry<TEntry, TWalk extends TargetWalk, TSelf extends string> = TEntry extends unknown
  ? unknown extends EntryError<TEntry, TWalk, TSelf> ? never : TEntry
  : never

/** The errors of one invocation's `onDone`, `onError` and `onSnapshot`. */
type EntryError<TEntry, TWalk extends TargetWalk, TSelf extends string> =
  & MemberOf<TEntry, "onDone", TWalk, TSelf>
  & MemberOf<TEntry, "onError", TWalk, TSelf>
  & MemberOf<TEntry, "onSnapshot", TWalk, TSelf>

/** The error of one transition member of an invocation. */
type MemberOf<TEntry, TKey extends "onDone" | "onError" | "onSnapshot", TWalk extends TargetWalk, TSelf extends string> =
  TEntry extends { readonly [K in TKey]: infer TTransition }
    ? unknown extends TransitionError<TTransition, TWalk, TSelf> ? unknown
    : { readonly [K in TKey]: TransitionError<TTransition, TWalk, TSelf> }
    : unknown

/** The errors below the node, under `states`, only for the children that have one. */
type StatesErrors<TNode, TWalk extends TargetWalk, TSelf extends string> = TNode extends { readonly states: infer TStates }
  ? [FailingStateKeys<TStates, TWalk, TSelf>] extends [never] ? unknown
  : {
    readonly states: {
      readonly [K in FailingStateKeys<TStates, TWalk, TSelf>]: CheckNode<TStates[K], TWalk, Join<TSelf, K>, TSelf>
    }
  }
  : unknown

/** The child keys whose subtree has a target error. */
type FailingStateKeys<TStates, TWalk extends TargetWalk, TSelf extends string> = {
  [K in keyof TStates & string]: unknown extends CheckNode<TStates[K], TWalk, Join<TSelf, K>, TSelf> ? never : K
}[keyof TStates & string]

/**
 * The most states (every node below the root, final and history states included) the
 * whole-machine proof runs over. Above it, the proof runs part by part (decision 18): each
 * compound and parallel state is one part over its own children, and a part with more children
 * than this bound is {@link MachineTooLargeForTypeProof}. The bound keeps the proof well inside
 * the compilers' 5,000,000-instantiation cap (TS2589) in the `createMachine` statement, which
 * also pays for the target, settlement and menu checks. Measured with TS 6.0.3 (T2.3): a chain
 * of 64 states, the worst case for the fixed point's iterations, costs about 380,000
 * instantiations (under 8% of the cap); a chain of 96 about 600,000.
 *
 * @since 0.4.0
 * @category Settlement
 */
export type SettlementProofBound = 64

/**
 * The error the root, or the part, of a machine too large for the type proof gets. The proof
 * never passes such a machine silently: split the part into nested compound states so that
 * each part has at most {@link SettlementProofBound} children. No value fits it.
 *
 * @since 0.4.0
 * @category Settlement
 */
export interface MachineTooLargeForTypeProof<TPath extends string> {
  /** Why the part is refused, with its path. */
  readonly MachineTooLargeForTypeProof:
    `${ShowPath<TPath>} has more states than the type proof can check (at most ${SettlementProofBound} per part)`
}

/**
 * The error a non-final state gets when no final state of the machine is reachable from it over
 * the transition graph, with guards assumed able to pass (S7). No value fits it.
 *
 * @since 0.4.0
 * @category Settlement
 */
export interface CannotReachFinal<TPath extends string> {
  /** Why the state is refused, with its path. */
  readonly CannotReachFinal: `no final state of the machine is reachable from ${ShowPath<TPath>}`
}

/**
 * The error a non-final atomic state gets when nothing guarantees that it is left (S8): no
 * agent invocation (its settlement is total and its `onDone` exits), no `after` set and no
 * `always` set, in the state or an ancestor, whose every transition leaves the state and one of
 * which is unguarded. A targetless, self-targeted or re-entering transition does not leave it,
 * an ordinary event may never come, and an ordinary invocation may never end (decision 8). No
 * value fits it.
 *
 * @since 0.4.0
 * @category Settlement
 */
export interface NoProgressGuarantee<TPath extends string> {
  /** Why the state is refused, with its path. */
  readonly NoProgressGuarantee: `nothing guarantees that ${ShowPath<TPath>} is left: add a targeted after, an always with an unguarded fallback, or an agent invocation`
}

/**
 * The error an atomic state gets when, with every guard false, its unguarded `always`
 * fallbacks move it around a loop for ever, or an unguarded targetless `always` keeps it in
 * place (S25). Every state on the loop gets it. No value fits it.
 *
 * @since 0.4.0
 * @category Settlement
 */
export interface Livelock<TPath extends string> {
  /** Why the state is refused, with its path. */
  readonly Livelock: `${ShowPath<TPath>} can loop through unguarded always transitions for ever`
}

/**
 * The error a parallel state gets for each region whose initial state cannot reach a final state
 * of that region, so the parallel state never completes (S23.1). It names the region, and it is
 * reported when some state of that parallel state cannot reach a final state. No value fits it.
 *
 * @since 0.4.0
 * @category Settlement
 */
export interface RegionCannotComplete<TPath extends string> {
  /** Why the region is refused, with its path. */
  readonly RegionCannotComplete: `the region ${ShowPath<TPath>} cannot reach a final state of its own`
}

/**
 * The error a state gets when one of its transitions has a target typed as `string`, not a
 * literal, or when its `states` are typed with `string` keys: the proof cannot see where it
 * goes, so it fails closed. No value fits it.
 *
 * @since 0.4.0
 * @category Settlement
 */
export interface ConfigNotLiteral<TPath extends string> {
  /** Why the state is refused, with its path. */
  readonly ConfigNotLiteral: `the type proof cannot follow a target or state key of ${ShowPath<TPath>} typed as string; write it as a literal`
}

/**
 * The error a state gets when its `initial` names none of its children: the proof would enter
 * nothing there, so it fails closed. No value fits it.
 *
 * @since 0.4.0
 * @category Settlement
 */
export interface UnknownInitial<TPath extends string> {
  /** Why the state is refused, with its path. */
  readonly UnknownInitial: `the initial of ${ShowPath<TPath>} names none of its children`
}

/**
 * The error a state gets when a child key contains `.` or `\`: the engine splits targets on
 * `.`, so the proof does not follow such a key, and fails closed. No value fits it.
 *
 * @since 0.4.0
 * @category Settlement
 */
export interface StateKeyNotProvable<TPath extends string> {
  /** Why the state is refused, with its path. */
  readonly StateKeyNotProvable: `a child key of ${ShowPath<TPath>} contains "." or "\\"`
}

/**
 * The error a machine with no states gets: it can never reach a final state. No value fits it.
 *
 * @since 0.4.0
 * @category Settlement
 */
export interface MachineHasNoStates {
  /** Why the machine is refused. */
  readonly MachineHasNoStates: "a machine needs states, and a final state that each of them reaches"
}

/**
 * The settlement proof of a setup machine's config as written (decision 4), shaped as the config
 * so that each error lands on the state it names; `unknown` when the machine is proved. It runs
 * only in a setup with agent actors (`TActor` is the setup's `ProvidedActor` union); any other
 * setup keeps upstream behaviour (COMPAT-1). It checks, with guards assumed able to pass:
 *
 * - every non-final atomic state has a progress guarantee (decision 8, {@link NoProgressGuarantee});
 * - every non-final state reaches a final state of the machine, by a tail-recursive fixed point
 *   over the transition graph whose iterations are bounded by the state count
 *   ({@link CannotReachFinal}). A final state completes its parent; a compound state whose
 *   completion no `onDone` handles is a sink; a parallel state completes only when every region
 *   can, and a region that cannot is named ({@link RegionCannotComplete}); a history state
 *   enters any state its parent can hold;
 * - no unguarded `always` fallback loops for ever ({@link Livelock});
 * - every target, `initial` and state key is a literal ({@link ConfigNotLiteral},
 *   {@link StateKeyNotProvable}), and `initial` names a child ({@link UnknownInitial}).
 *
 * The proof reads a separately inferred structural graph. `setup` captures that graph through
 * a recursive reverse map before TypeScript's first applicability check. Callback inference
 * uses the original config constraint, and the returned machine keeps the complete literal
 * config. Thus inline `assign`, destructuring callbacks, context factories and `enqueueActions`
 * do not require a permissive wide branch. A wide graph always gets {@link ConfigNotLiteral}.
 * Unknown targets are `TargetCheck`'s errors; the proof adds no edge for them. A machine above
 * {@link SettlementProofBound} states runs part by part (decision 18): a part's children prove
 * against the part's own exits and completion, and the parent assumes each child's exits. A part
 * above the bound gets {@link MachineTooLargeForTypeProof}. The proof never resolves to `any`.
 *
 * A setup with a machine that holds agents among its actors gets the same proof. An invocation
 * of such a machine is progress only when its certificate says `"proved"`.
 *
 * @since 0.4.0
 * @category Settlement
 */
export type SettlementProof<TConfig, TActor = never> = [SettledSrc<TActor>] extends [never] ? unknown
  : true extends StructuralAny<TConfig> ? ConfigNotLiteral<"">
  : "wide" extends KindOf<TConfig> ? ConfigNotLiteral<"">
  : ShapeRoot<TConfig, ProofFailures<TConfig, AgentSrc<TActor> | ProvedHolderSrc<TActor>, "auto">>

/**
 * What the settlement proof found in `TConfig`, as data, for tests and tools: each failure as
 * `"<error>: <path>"` (`never` when proved), the state count the bound reads, which proof ran
 * (`"whole"` or `"compositional"`), and the reach-final fixed point's iteration counts (one per
 * part when compositional). `TAgents` names the `src` of each agent actor. `TMode` forces a
 * proof: `"auto"` picks it by the bound, as `SettlementProof` does.
 *
 * @since 0.4.0
 * @category Settlement
 */
export type SettlementReport<
  TConfig,
  TAgents extends string = never,
  TMode extends ProofMode = "auto"
> = ReportOf<ProofFailures<TConfig, TAgents, TMode>, ProofWalkOf<TConfig, TAgents>, TMode>

/**
 * Which reach-final proof runs: `"whole"` over the whole machine, `"compositional"` part by
 * part, or `"auto"`, which picks the whole-machine proof up to {@link SettlementProofBound}
 * states.
 *
 * @since 0.4.0
 * @category Settlement
 */
export type ProofMode = "auto" | "whole" | "compositional"

/**
 * What the analysis of a machine produced (decisions 6 and 10, AUDIT-2). `certify` in
 * `@jambudipa/xstate-effect/graph` generates it, and {@link Certified} compares its `states` and
 * `edges` with the machine's config. An edge reads `<source>: <label> -> <target>`:
 *
 * - the source and target are state paths, `(root)` for the root, and the target of a targetless
 *   transition is `(none)`; a transition into regions gives one edge per target;
 * - the label is `on <event>`, `after <delay>`, `always`, `onDone`, `history` (a history state's
 *   default) or `invoke.<index>.onDone`, `.onError`, `.onSnapshot`.
 *
 * @since 0.4.0
 * @category Settlement
 */
export interface SettlementCertificate {
  /** The path of every state of the machine, keys joined with `.`, the root left out. */
  readonly states: ReadonlyArray<string>
  /** Every transition of the machine, one edge per target. */
  readonly edges: ReadonlyArray<string>
  /** How many states the explorer visited. */
  readonly explored: number
  /** The hash of the machine, its module closure, its provided implementations and the library version. */
  readonly hash: string
  /** `"proved"` when the analysis showed that the machine reaches a final state. */
  readonly verdict: "proved" | "failed"
}

/**
 * The error a machine gets when its certificate no longer fits its config: `TMissing` are states
 * the certificate does not list, and `TExcess` are states it lists that no longer exist. No value
 * fits it.
 *
 * @since 0.4.0
 * @category Settlement
 */
export interface StaleCertificate<TMissing extends string, TExcess extends string> {
  /** Why the certificate is refused. */
  readonly StaleCertificate: "the certificate does not list the machine's states; generate it again"
  /** The states the certificate does not list. */
  readonly missing: TMissing
  /** The states the certificate lists that no longer exist. */
  readonly excess: TExcess
}

/**
 * The error a machine gets when its certificate lists its states but not its edges: `TMissing`
 * are edges the certificate does not list, and `TExcess` are edges it lists that no longer exist.
 * A missing edge with a `string` in it is a target or key typed as `string`: no certificate can
 * cover it, so it fails closed. No value fits it.
 *
 * @since 0.4.0
 * @category Settlement
 */
export interface StaleEdges<TMissing extends string, TExcess extends string> {
  /** Why the certificate is refused. */
  readonly StaleEdges: "the certificate does not list the machine's edges; generate it again"
  /** The edges the certificate does not list. */
  readonly missing: TMissing
  /** The edges the certificate lists that no longer exist. */
  readonly excess: TExcess
}

/**
 * The error a machine gets from {@link Certified} when its certificate covers it but does not
 * say `"proved"`, as a literal. No value fits it.
 *
 * @since 0.4.0
 * @category Settlement
 */
export interface CertificateNotProved<TVerdict extends string> {
  /** Why the certificate is refused. */
  readonly CertificateNotProved: "the analysis did not prove this machine"
  /** The verdict the certificate holds. */
  readonly verdict: TVerdict
}

/**
 * The check that `TCertificate` covers the machine `TMachine` and proves it: `unknown` when it
 * does or when the machine holds no agents, else the error. It compares both ways, so an entry
 * for a state or an edge that no longer exists fails as well (S12). It reads the config
 * `TMachine` holds, never the wide machine type (decision 6), and fails closed on a config
 * TypeScript did not infer. It sees structure only: a change to guard or action code is
 * `checkCertificate`'s to catch.
 *
 * @example
 * ```ts
 * machine satisfies Certified<typeof machine, typeof certificate>
 * ```
 *
 * @since 0.4.0
 * @category Settlement
 */
export type Certified<TMachine, TCertificate extends SettlementCertificate> = unknown extends
  CertificateCoverage<TMachine, TCertificate>
  ? TMachine extends HoldsAgents ? [TCertificate["verdict"]] extends ["proved"] ? unknown
    : CertificateNotProved<TCertificate["verdict"]>
  : unknown
  : CertificateCoverage<TMachine, TCertificate>

/**
 * The structural half of {@link Certified}: `unknown` when the certificate's lists equal the
 * config's states and edges. A failed verdict still covers: a parent may bind such a child, and
 * it is then no progress for that parent (S17).
 */
type CertificateCoverage<TMachine, TCertificate extends SettlementCertificate> = TMachine extends HoldsAgents<infer TConfig>
  ? "wide" extends KindOf<TConfig> ? ConfigNotLiteral<"">
  : CertificateFit<
    Exclude<StatePaths<TConfig, "">, "">,
    TCertificate["states"][number],
    ConfigEdges<TConfig>,
    TCertificate["edges"][number]
  >
  : unknown

/** `unknown` when both pairs of sets are equal, else the error that names the first differences. */
type CertificateFit<TStates extends string, TListed extends string, TEdges extends string, TListedEdges extends string> = [
  Exclude<TStates, TListed> | Exclude<TListed, TStates>
] extends [never] ? [Exclude<TEdges, TListedEdges> | Exclude<TListedEdges, TEdges>] extends [never] ? unknown
  : StaleEdges<Exclude<TEdges, TListedEdges>, Exclude<TListedEdges, TEdges>>
  : StaleCertificate<Exclude<TStates, TListed>, Exclude<TListed, TStates>>

/** Every edge of a config, as a certificate lists it. */
type ConfigEdges<TConfig> = EdgesOfEntries<ProofWalkOf<TConfig, never>>

/** The edges of each node of a walk. */
type EdgesOfEntries<TWalk extends ProofWalk, TEach extends Entry = TWalk["entries"]> = TEach extends unknown
  ? NodeEdges<TWalk, TEach["node"], TEach["path"], TEach["parent"]>
  : never

/** The edges a node writes: `on`, `after`, `always`, its `onDone`, its invocations and a history default. */
type NodeEdges<TWalk extends ProofWalk, TNode, TPath extends string, TParent extends string> =
  | (TNode extends { readonly on: infer TOn } ? RecordEdges<TWalk, TOn, "on", TPath> : never)
  | (TNode extends { readonly after: infer TAfter } ? RecordEdges<TWalk, TAfter, "after", TPath> : never)
  | (TNode extends { readonly always: infer TAlways } ? MoveEdges<TWalk, WrittenMoves<TAlways>, "always", TPath> : never)
  | (TNode extends { readonly onDone: infer TDone } ? MoveEdges<TWalk, WrittenMoves<TDone>, "onDone", TPath> : never)
  | (TNode extends { readonly invoke: infer TInvoke } ? TInvoke extends ReadonlyArray<unknown> ? {
      [I in keyof TInvoke & `${number}`]: InvokeEdges<TWalk, TInvoke[I], I, TPath>
    }[keyof TInvoke & `${number}`]
    : InvokeEdges<TWalk, TInvoke, "0", TPath>
    : never)
  | (TNode extends { readonly type: "history"; readonly target: infer TTarget extends string }
    ? `${ShowEdgeNode<TPath>}: history -> ${ShowEdgeNode<HistoryPath<TWalk, TTarget, TParent>>}`
    : never)

/** The path a history default names: below the history state's parent, unless it names an id. */
type HistoryPath<TWalk extends ProofWalk, TTarget extends string, TParent extends string> = TTarget extends `#${string}`
  ? ResolveTarget<TTarget, { readonly ids: TWalk["ids"] }, TParent, TParent>
  : Join<TParent, TTarget>

/** The edges of a record of transitions, each key under its label. */
type RecordEdges<TWalk extends ProofWalk, TRecord, TLabel extends string, TPath extends string> = {
  [K in keyof TRecord & (string | number)]: MoveEdges<TWalk, WrittenMoves<TRecord[K]>, `${TLabel} ${K}`, TPath>
}[keyof TRecord & (string | number)]

/** The edges of one invocation's handlers. */
type InvokeEdges<TWalk extends ProofWalk, TEntry, TIndex extends string, TPath extends string> =
  | (TEntry extends { readonly onDone: infer TDone } ? MoveEdges<TWalk, WrittenMoves<TDone>, `invoke.${TIndex}.onDone`, TPath> : never)
  | (TEntry extends { readonly onError: infer TError } ? MoveEdges<TWalk, WrittenMoves<TError>, `invoke.${TIndex}.onError`, TPath>
    : never)
  | (TEntry extends { readonly onSnapshot: infer TSnapshot }
    ? MoveEdges<TWalk, WrittenMoves<TSnapshot>, `invoke.${TIndex}.onSnapshot`, TPath>
    : never)

/** The edges of normalised transitions from the node at `TPath`, one per target. */
type MoveEdges<TWalk extends ProofWalk, TTransition, TLabel extends string, TPath extends string> = TTransition extends unknown
  ? `${ShowEdgeNode<TPath>}: ${TLabel} -> ${EdgeTargets<TWalk, TPath, TTransition>}`
  : never

/** The targets of one transition as an edge shows them; a transition with none is `(none)`. */
type EdgeTargets<TWalk extends ProofWalk, TSelf extends string, TTransition> = TTransition extends
  { readonly target: infer TTarget } ? TTarget extends ReadonlyArray<infer TEach> ? [TEach] extends [never] ? NoTarget
    : EdgeTarget<TWalk, TSelf, TEach>
  : EdgeTarget<TWalk, TSelf, TTarget>
  : NoTarget

/** One target as an edge shows it: `string` stays wide, so no certificate covers it. */
type EdgeTarget<TWalk extends ProofWalk, TSelf extends string, TTarget> = TTarget extends "" | undefined ? NoTarget
  : TTarget extends string ? string extends TTarget ? string
    : ShowEdgeNode<KnownPath<ResolveFrom<TTarget, TWalk["ids"], TSelf>, TWalk["paths"]>>
  : NoTarget

/**
 * A transition as written as one object per move, a target string included; a forbidden
 * (`undefined`) transition is none. `Normalise` will not do here: its `Transition` is a weak type,
 * so it drops a targetless move such as `{ actions }`, which moves nothing but is still an edge.
 */
type WrittenMoves<T> = T extends ReadonlyArray<infer TEach> ? WrittenMoves<TEach>
  : T extends string ? { readonly target: T }
  : T extends object ? T
  : never

/** The edge's target of a transition with none. */
type NoTarget = "(none)"

/** A path as an edge shows it: `(root)` for the root. */
type ShowEdgeNode<TPath extends string> = TPath extends "" ? "(root)" : TPath

/**
 * Binds a certificate to a machine, so a parent may declare the machine as a child (S17). A
 * `satisfies` adds no type to its value, so the mark comes from this call; the call checks that
 * the certificate covers the machine, as {@link Certified} does, and returns the same machine. A
 * certificate with a failed verdict binds too: the child is then no progress for its parent.
 *
 * @since 0.4.0
 * @category Settlement
 */
export const certified = <TMachine extends AnyLogicSlot, const TCertificate extends SettlementCertificate>(
  machine: TMachine & NoInfer<CertificateCoverage<TMachine, TCertificate>>,
  _certificate: TCertificate
): TMachine & CertifiedChild<TCertificate> => machine as unknown as TMachine & CertifiedChild<TCertificate>

/**
 * The flag of a setup machine (decision 10): {@link HoldsAgents} when its config invokes agent
 * logic, when its setup declares a machine that holds agents, as a spawn sits where no config
 * shows it, or when a setup with agents gives a config TypeScript did not infer; else `unknown`.
 *
 * @since 0.4.0
 * @category Settlement
 */
export type HoldsAgentsFlag<TConfig, TActor> = [HolderSrc<TActor>] extends [never]
  ? [AgentSrc<TActor>] extends [never] ? unknown
  : "wide" extends KindOf<TConfig> ? HoldsAgents<TConfig>
  : [Extract<InvokedSrcs<TConfig>, AgentSrc<TActor>>] extends [never] ? unknown
  : HoldsAgents<TConfig>
  : HoldsAgents<TConfig>

/** The `src` of every invocation in the config. */
type InvokedSrcs<TNode> =
  | (InvokesOf<TNode> extends infer TEach ? TEach extends { readonly src: infer TSrc } ? TSrc : never : never)
  | (TNode extends { readonly states: infer TStates } ? { [K in keyof TStates]: InvokedSrcs<TStates[K]> }[keyof TStates] : never)

/** The src names of the machines among `TActor` whose certificate says they reach a final state. */
type ProvedHolderSrc<TActor> = TActor extends
  { readonly src: infer TSrc extends string; readonly logic: CertifiedChild<{ readonly verdict: "proved" }> } ? TSrc
  : never

/**
 * The error a state gets when a spawned child that holds agents may be alive there and no handler
 * answers its settlement event. No value fits it.
 *
 * @since 0.4.0
 * @category Settlement
 */
export interface ChildSettlementUnhandled<TPath extends string, TId extends string> {
  /** Why the state is refused, with its path and the child ids. */
  readonly ChildSettlementUnhandled: `state "${TPath}" has no handler for xstate.done.actor.${TId}`
}

/**
 * The child-settlement errors of a setup machine's config as written (S17), shaped as the config
 * so that each error lands on the state it names; `unknown` when there is none. A spawn sits in an
 * action's body, or in an `enqueueActions` the config does not show, so the states where a child
 * is alive cannot be read: a certified machine with an id from `types.children`, the only form a
 * spawn takes, counts as alive in every non-final state. A handler is a defined `on` key in the
 * state or an ancestor, the nearest writer winning: `xstate.done.actor.<id>`, or a wildcard that
 * matches it. A wildcard is the only handler of an id known only at run time. An invoked child is
 * not checked here: its `onDone` is required by the invocation's type.
 *
 * @since 0.4.0
 * @category Settlement
 */
export type ChildSettlementCheck<TConfig, TActor> = [SpawnedChildId<TActor>] extends [never] ? unknown
  : ChildErrors<TConfig, SpawnedChildId<TActor>, never, "">

/** The ids of the certified machines among `TActor` that a spawn may start. */
type SpawnedChildId<TActor> = TActor extends
  { readonly logic: HoldsAgents & CertifiedChild; readonly id: infer TId extends string } ? TId
  : never

/** The `on` keys that take the settlement event of the child `TId`. */
type SettlementKeys<TId extends string> =
  | AgentDoneWildcard
  | ({} extends Record<TId, 1> ? never : `xstate.done.actor.${TId}`)

/** Which of `TIds` are handled below a node: its own defined keys add ids, and its forbidden keys remove them. */
type HandledBelow<TNode, TIds extends string, THandled extends string> = TNode extends { readonly on: infer TOn }
  ? TIds extends unknown
    ? [SettlementKeys<TIds> & DefinedKeys<TOn>] extends [never]
      ? [SettlementKeys<TIds> & keyof TOn] extends [never] ? Extract<THandled, TIds> : never
    : TIds
  : never
  : THandled

/** The errors of one node and the nodes below it: `THandled` are the ids its ancestors handle. */
type ChildErrors<TNode, TIds extends string, THandled extends string, TPath extends string> = "wide" extends KindOf<TNode>
  ? ConfigNotLiteral<TPath>
  : KindOf<TNode> extends "final" | "history" ? unknown
  : TNode extends { readonly states: infer TStates } ? [keyof TStates & string] extends [never]
      ? AtomicChildError<TIds, HandledBelow<TNode, TIds, THandled>, TPath>
    : [ChildFailingKeys<TStates, TIds, HandledBelow<TNode, TIds, THandled>, TPath>] extends [never] ? unknown
    : {
      readonly states: {
        readonly [K in ChildFailingKeys<TStates, TIds, HandledBelow<TNode, TIds, THandled>, TPath>]: ChildErrors<
          TStates[K],
          TIds,
          HandledBelow<TNode, TIds, THandled>,
          Join<TPath, K>
        >
      }
    }
  : AtomicChildError<TIds, HandledBelow<TNode, TIds, THandled>, TPath>

/** The error of an atomic state: none when every child id is handled. */
type AtomicChildError<TIds extends string, THandled extends string, TPath extends string> = [Exclude<TIds, THandled>] extends
  [never] ? unknown
  : ChildSettlementUnhandled<TPath, Exclude<TIds, THandled>>

/** The child keys whose subtree has an error. */
type ChildFailingKeys<TStates, TIds extends string, THandled extends string, TPath extends string> = {
  [K in keyof TStates & string]: unknown extends ChildErrors<TStates[K], TIds, THandled, Join<TPath, K>> ? never : K
}[keyof TStates & string]

/** A path as an error shows it: the machine for the root, else the quoted path. */
type ShowPath<TPath extends string> = TPath extends "" ? "the machine" : `state "${TPath}"`

/** The answer of a count that passed its limit. */
type Over = "over"

/** One failure of the proof: which error, and the path of the state it lands on. */
interface Failure {
  /** The error's name. */
  readonly kind: string
  /** The path of the state the error lands on (`""` for the root). */
  readonly path: string
}

/** One node of the proof walk. */
interface Entry {
  /** The node's path: keys joined with `.`, `""` for the root. */
  readonly path: string
  /** The node's config as written. */
  readonly node: unknown
  /** The parent's path; {@link NoParent} for the root. */
  readonly parent: string
  /** What the node is: `atomic`, `compound`, `parallel`, `final`, `history`, or `wide` (string keys). */
  readonly kind: string
  /** The paths entering the node activates: itself, its initial chain, every region of a parallel. */
  readonly entry: string
}

/** The root's parent: no path can equal it, as no key contains `\`. */
type NoParent = "\\parent"

/** The token for "the node at `TPath` completed and its completion is handled". */
type Done<TPath extends string> = `\\done:${TPath}`

/** The token for "left the part" in a compositional part graph. */
type Out = "\\out"

/** One edge of a reach graph: every token in `from` reaches the token set `to` (any of it, or `all` of it). */
interface Edge {
  /** The tokens that move. */
  readonly from: string
  /** The tokens they move to. */
  readonly to: string
  /** `true` when every token of `to` must be reached, `false` when one is enough. */
  readonly all: boolean
}

/** The proof's fixed inputs for one config, computed once. */
interface ProofWalk {
  /** Each explicit node id with its node's path, the root's included. */
  readonly ids: readonly [string, string]
  /** The path of every node a target can reach. */
  readonly paths: string
  /** Every node of the walk. */
  readonly entries: Entry
  /** The `src` of each agent actor. */
  readonly agents: string
}

/** The {@link ProofWalk} of a config. */
interface ProofWalkOf<TConfig, TAgents extends string> extends ProofWalk {
  /** Each explicit node id with its node's path, the root's included. */
  readonly ids: Ids<TConfig>
  /** The path of every node a target can reach. */
  readonly paths: StatePaths<TConfig, "">
  /** Every node of the walk. */
  readonly entries: Entries<TConfig, "", NoParent>
  /** The `src` of each agent actor. */
  readonly agents: TAgents
}

/** Every failure of the proof, picking the reach-final proof by `TMode`. */
type ProofFailures<TConfig, TAgents extends string, TMode extends ProofMode> = Failures<
  ProofWalkOf<TConfig, TAgents>,
  TMode
>

/**
 * The failures of a walk: the root's own; else, when a target or key is not a literal, only
 * those, as the other checks cannot see that edge; else the checks over its states.
 */
type Failures<TWalk extends ProofWalk, TMode extends ProofMode> = Extract<
  TWalk["entries"],
  { readonly path: "" }
>["kind"] extends "atomic" | "final" ? { readonly kind: "MachineHasNoStates"; readonly path: "" }
  : LiteralFailures<TWalk> extends infer TLiteral extends Failure ? [TLiteral] extends [never] ?
        | NoProgress<TWalk>
        | Livelocks<TWalk>
        | ReachFailures<TWalk, ModeOf<TWalk, TMode>>
    : TLiteral
  : never

/** The proof `TMode` names, or for `"auto"` the whole-machine proof when the states fit the bound. */
type ModeOf<TWalk extends ProofWalk, TMode extends ProofMode> = TMode extends "auto"
  ? CountUpTo<Exclude<TWalk["entries"]["path"], "">, SettlementProofBound> extends Over ? "compositional" : "whole"
  : TMode

/** The reach-final failures of the proof `TMode` names. */
type ReachFailures<TWalk extends ProofWalk, TMode> = TMode extends "whole" ? WholeFailures<TWalk>
  : CompositionalFailures<TWalk>

/** The report of a proof: failures as strings, the state count, the proof and its iterations. */
type ReportOf<TFailures extends Failure, TWalk extends ProofWalk, TMode extends ProofMode> = {
  /** Each failure as `"<error>: <path>"`. */
  readonly failures: TFailures extends unknown ? `${TFailures["kind"]}: ${TFailures["path"]}` : never
  /** The state count, root excluded, or `"over"` past the bound. */
  readonly states: CountUpTo<Exclude<TWalk["entries"]["path"], "">, SettlementProofBound>
  /** The reach-final proof that ran. */
  readonly mode: ModeOf<TWalk, TMode>
  /** The reach-final fixed point's iteration counts. */
  readonly iterations: ModeOf<TWalk, TMode> extends "whole" ? IterationsOf<WholeReach<TWalk>>
    : IterationsOf<PartReach<TWalk, PartPaths<TWalk>>>
}

/** The iteration counts of reach results. */
type IterationsOf<TReach> = TReach extends { readonly iterations: infer TCount } ? TCount : Over

// ---------------------------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------------------------

/** What a node is, for the proof; `wide` when its `states` are not a literal record (optional or string-keyed). */
type KindOf<TNode> = TNode extends { readonly type: "final" } ? "final"
  : TNode extends { readonly type: "history" } ? "history"
  : TNode extends { readonly states: infer TStates } ? string extends keyof TStates ? "wide"
    : TNode extends { readonly type: "parallel" } ? "parallel"
    : [keyof TStates & string] extends [never] ? "atomic"
    : "compound"
  : "states" extends keyof TNode ? "wide"
  : TNode extends { readonly type: "parallel" } ? "parallel"
  : "atomic"

/** `true` when a key cannot be a path segment: the engine splits targets on `.` and escapes with `\`. */
type Unprovable<TKey extends string> = TKey extends `${string}.${string}` | `${string}\\${string}` ? true : false

/** Every node at and below `TPath`, keys that cannot be a path segment left out. */
type Entries<TNode, TPath extends string, TParent extends string> =
  | {
    readonly path: TPath
    readonly node: TNode
    readonly parent: TParent
    readonly kind: KindOf<TNode>
    readonly entry: EntryOf<TNode, TPath>
  }
  | (KindOf<TNode> extends "compound" | "parallel" ? TNode extends { readonly states: infer TStates } ? {
      [K in keyof TStates & string]: Unprovable<K> extends true ? never : Entries<TStates[K], Join<TPath, K>, TPath>
    }[keyof TStates & string]
    : never
    : never)

/** The paths entering the node at `TPath` activates: itself, its initial chain, or every region. */
type EntryOf<TNode, TPath extends string> =
  | TPath
  | (TNode extends { readonly type: "parallel"; readonly states: infer TStates } ? {
    [K in keyof TStates & string]: EntryOf<TStates[K], Join<TPath, K>>
  }[keyof TStates & string]
    : TNode extends { readonly initial: infer TInitial extends string; readonly states: infer TStates }
      ? TInitial extends keyof TStates ? EntryOf<TStates[TInitial], Join<TPath, TInitial>> : never
    : never)

/** The paths among `TPaths` at or below `TPath`. */
type AtOrBelow<TPaths extends string, TPath extends string> = TPath extends "" ? TPaths
  : Extract<TPaths, TPath | `${TPath}.${string}`>

/** The paths among `TPaths` strictly below `TPath`. */
type Below<TPaths extends string, TPath extends string> = Exclude<AtOrBelow<TPaths, TPath>, TPath>

/** The entry of the node at `TPath`. */
type EntryAt<TWalk extends ProofWalk, TPath> = Extract<TWalk["entries"], { readonly path: TPath }>

/** The paths of the children of the node at `TPath`. */
type ChildrenOf<TWalk extends ProofWalk, TPath extends string> = Extract<
  TWalk["entries"],
  { readonly parent: TPath }
>["path"]

/** The paths of the nodes that can be active: no history state. */
type StatePathsOf<TEntries extends Entry> = Exclude<TEntries, { readonly kind: "history" }>["path"]

/**
 * How many members `TUnion` has, or {@link Over} when it has more than `TLimit`. It removes one
 * member per step, so it stops after `TLimit + 1` steps whatever the union's size.
 */
type CountUpTo<TUnion, TLimit extends number, TCount extends ReadonlyArray<0> = []> = [TUnion] extends [never]
  ? TCount["length"]
  : TCount["length"] extends TLimit ? Over
  : CountUpTo<Exclude<TUnion, LastOf<TUnion>>, TLimit, [...TCount, 0]>

/** One member of a union (the checker's last). */
type LastOf<TUnion> = UnionToIntersection<TUnion extends unknown ? () => TUnion : never> extends () => infer TLast
  ? TLast
  : never

/** The intersection of the members of a union. */
type UnionToIntersection<TUnion> = (TUnion extends unknown ? (value: TUnion) => void : never) extends
  (value: infer TIntersection) => void ? TIntersection
  : never

// ---------------------------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------------------------

/** One transition as written, as an object. */
interface Transition {
  /** Where it goes: one target or a list into regions. */
  readonly target?: unknown
  /** Its guard, when it has one. */
  readonly guard?: unknown
}

/** A transition as written (a target, an object, or a list of either) as transition objects. */
type Normalise<T> = T extends ReadonlyArray<infer TEach> ? NormaliseOne<TEach> : NormaliseOne<T>

/** One transition as an object; a forbidden (`undefined`) transition is none. */
type NormaliseOne<T> = T extends string ? { readonly target: T } : T extends Transition ? T : never

/** The invocations of a node, one or a list, as a union. */
type InvokesOf<TNode> = TNode extends { readonly invoke: infer TInvoke }
  ? TInvoke extends ReadonlyArray<infer TEach> ? TEach : TInvoke
  : never

/** Every transition of a node that moves its states: `on`, `after`, `always`, and its invocations' handlers. */
type Moves<TNode> =
  | (TNode extends { readonly on: infer TOn } ? Normalise<TOn[keyof TOn]> : never)
  | (TNode extends { readonly after: infer TAfter } ? Normalise<TAfter[keyof TAfter]> : never)
  | (TNode extends { readonly always: infer TAlways } ? Normalise<TAlways> : never)
  | (InvokesOf<TNode> extends infer TEach ? TEach extends unknown ?
      | (TEach extends { readonly onDone: infer TDone } ? Normalise<TDone> : never)
      | (TEach extends { readonly onError: infer TError } ? Normalise<TError> : never)
      | (TEach extends { readonly onSnapshot: infer TSnapshot } ? Normalise<TSnapshot> : never)
    : never
    : never)

/** The state `onDone` transitions of a node. */
type OnDoneOf<TNode> = TNode extends { readonly onDone: infer TDone } ? Normalise<TDone> : never

/** The targets of a transition as written, one each. */
type TargetsOf<T> = T extends { readonly target: infer TTarget } ? TTarget extends ReadonlyArray<infer TEach> ? TEach : TTarget
  : never

/** The paths the targets of `TTransition` name from the state at `TSelf`; none for an unknown or targetless one. */
type TargetPaths<TWalk extends ProofWalk, TSelf extends string, TTransition> = TargetsOf<TTransition> extends
  infer TTarget ? TTarget extends string ? KnownPath<ResolveFrom<TTarget, TWalk["ids"], TSelf>, TWalk["paths"]> : never
  : never

/** `true` when a transition among `TTransition` has a target typed as a wide `string`. */
type HasWideTarget<TTransition> = true extends (
  TargetsOf<TTransition> extends infer TTarget ? TTarget extends string ? string extends TTarget ? true : false : false
    : false
) ? true
  : false

/** `true` when the transition has no guard. */
type Unguarded<T> = T extends { readonly guard: infer TGuard } ? [TGuard] extends [undefined] ? true : false : true

// ---------------------------------------------------------------------------------------------
// Literal config
// ---------------------------------------------------------------------------------------------

/** The failures of a config the proof cannot read: wide targets or keys, keys that are no path segment, an unknown `initial`. */
type LiteralFailures<TWalk extends ProofWalk, TEach extends Entry = TWalk["entries"]> = TEach extends unknown ?
  | (TEach["kind"] extends "wide" ? { readonly kind: "ConfigNotLiteral"; readonly path: TEach["path"] }
    : HasWideTarget<Moves<TEach["node"]> | OnDoneOf<TEach["node"]> | HistoryDefaultOf<TEach["node"]>> extends true
      ? { readonly kind: "ConfigNotLiteral"; readonly path: TEach["path"] }
    : TEach["node"] extends { readonly initial: infer TInitial extends string } ? string extends TInitial
        ? { readonly kind: "ConfigNotLiteral"; readonly path: TEach["path"] }
      : never
    : never)
  | (TEach["node"] extends { readonly initial: infer TInitial extends string; readonly states: infer TStates }
    ? string extends TInitial ? never
    : TInitial extends keyof TStates ? never
    : { readonly kind: "UnknownInitial"; readonly path: TEach["path"] }
    : never)
  | (TEach["node"] extends { readonly states: infer TStates }
    ? true extends { [K in keyof TStates & string]: Unprovable<K> }[keyof TStates & string]
      ? { readonly kind: "StateKeyNotProvable"; readonly path: TEach["path"] }
    : never
    : never)
  : never

/** A history state's default target, as a transition. */
type HistoryDefaultOf<TNode> = TNode extends { readonly type: "history"; readonly target: infer TTarget }
  ? { readonly target: TTarget }
  : never

// ---------------------------------------------------------------------------------------------
// Progress (decision 8)
// ---------------------------------------------------------------------------------------------

/** `NoProgressGuarantee`: each non-final atomic state with no guarantee in itself or an ancestor. */
type NoProgress<TWalk extends ProofWalk, TEach extends Entry = TWalk["entries"]> = TEach extends
  { readonly kind: "atomic" } ? TEach["path"] extends "" ? never
  : true extends GuaranteedBy<TWalk, EntryAt<TWalk, AncestorsOf<TEach["path"]>>, TEach["path"]> ? never
  : { readonly kind: "NoProgressGuarantee"; readonly path: TEach["path"] }
  : never

/** A path and every path above it, the root's `""` included. */
type AncestorsOf<TPath extends string, TDone extends string = ""> = TPath extends `${infer THead}.${infer TRest}`
  ? TDone | AncestorsOf<TRest, Join<TDone, THead>>
  : TDone | Join<TDone, TPath>

/** `true` for each node among `TNodes` whose transitions guarantee that the state at `TState` is left. */
type GuaranteedBy<TWalk extends ProofWalk, TNodes extends Entry, TState extends string> = TNodes extends unknown ?
  | (InvokesOf<TNodes["node"]> extends infer TEach ? TEach extends { readonly src: TWalk["agents"]; readonly onDone: unknown } ? true
    : false
    : false)
  | (TNodes["node"] extends { readonly after: infer TAfter }
    ? { [K in keyof TAfter]: K extends NeverFiringKey ? false : SetLeaves<TWalk, TNodes["path"], Normalise<TAfter[K]>, TState> }[keyof TAfter]
    : false)
  | (TNodes["node"] extends { readonly always: infer TAlways } ? SetLeaves<TWalk, TNodes["path"], Normalise<TAlways>, TState>
    : false)
  : never

/**
 * The `after` keys that read as a number and never fire, which TypeScript takes as numeric names.
 * The value of a named delay is out of the proof's reach, as a setup's `delays` type holds
 * `number`: `provide` and `proveSettlement` refuse those.
 */
type NeverFiringKey = "Infinity" | "-Infinity" | "NaN"

/**
 * `true` when a set of transitions declared at `TSource` guarantees that the state at `TState`
 * is left: one of them is unguarded, and every one of them leaves it.
 */
type SetLeaves<TWalk extends ProofWalk, TSource extends string, TSet, TState extends string> = [TSet] extends [never]
  ? false
  : true extends Unguarded<TSet>
    ? false extends (TSet extends unknown ? TransitionLeaves<TWalk, TSource, TSet, TState> : never) ? false : true
  : false

/** `true` when the transition has targets and every one of them leaves the state at `TState`. */
type TransitionLeaves<TWalk extends ProofWalk, TSource extends string, TTransition, TState extends string> = [
  TargetsOf<TTransition>
] extends [never] ? false
  : false extends (
    TargetsOf<TTransition> extends infer TTarget
      ? TTarget extends string
        ? TargetLeaves<TWalk, KnownPath<ResolveFrom<TTarget, TWalk["ids"], TSource>, TWalk["paths"]>, TState>
      : false
      : false
  ) ? false
  : true

/**
 * `true` when entering the node at `TTarget` leaves the state at `TState`: it is not the state,
 * not an ancestor whose entry re-enters the state, and not a history state that may restore it.
 */
type TargetLeaves<TWalk extends ProofWalk, TTarget, TState extends string> = [TTarget] extends [never] ? false
  : TTarget extends string ? EntryAt<TWalk, TTarget> extends infer TEntry extends Entry
      ? TEntry["kind"] extends "history" ? IsAtOrBelow<TState, TEntry["parent"]> extends true ? false : true
      : TTarget extends TState ? false
      : IsAtOrBelow<TState, TTarget> extends true ? TState extends TEntry["entry"] ? false : true
      : true
    : false
  : false

/** `true` when the path `TPath` is `TAncestor` or below it. */
type IsAtOrBelow<TPath extends string, TAncestor extends string> = TAncestor extends "" ? true
  : TPath extends TAncestor | `${TAncestor}.${string}` ? true
  : false

// ---------------------------------------------------------------------------------------------
// Livelock (S25)
// ---------------------------------------------------------------------------------------------

/** `Livelock`: each atomic state whose unguarded `always` fallbacks never reach a resting state. */
type Livelocks<TWalk extends ProofWalk> = LivelockOf<
  TWalk,
  Reach<FallbackEdges<TWalk>, Resting<TWalk>, []>
>

/** The atomic states the escape fixed point did not reach. */
type LivelockOf<TWalk extends ProofWalk, TReach> = TReach extends { readonly reached: infer TReached }
  ? Exclude<Extract<TWalk["entries"], { readonly kind: "atomic" }>["path"], TReached | ""> extends infer TPath
    ? TPath extends string ? { readonly kind: "Livelock"; readonly path: TPath } : never
  : never
  : { readonly kind: "MachineTooLargeForTypeProof"; readonly path: "" }

/** The atomic and final states that rest when every guard is false: no unguarded `always` moves them. */
type Resting<TWalk extends ProofWalk, TEach extends Entry = TWalk["entries"]> = TEach extends unknown
  ? TEach["kind"] extends "final" ? TEach["path"]
  : TEach["kind"] extends "atomic" ? Fallback<TWalk, TEach["path"], TEach["path"]> extends "none" ? TEach["path"] : never
  : never
  : never

/** An atomic state escapes when every state its fallback enters escapes. */
type FallbackEdges<TWalk extends ProofWalk, TEach extends Entry = TWalk["entries"]> = TEach extends
  { readonly kind: "atomic" } ? Fallback<TWalk, TEach["path"], TEach["path"]> extends infer TTargets
    ? TTargets extends "none" ? never
    : { readonly from: TEach["path"]; readonly to: LeavesOf<TWalk, TTargets & string>; readonly all: true }
  : never
  : never

/**
 * The targets of the unguarded `always` fallback that fires for the state at `TState` when every
 * guard is false: the first unguarded member of the nearest `always` set, from the state up
 * (`TPath`), that has one. `"none"` when no set has one, or when that member does not leave the
 * state: a targetless or self-targeted fallback leaves the snapshot as it is, and the engine stops
 * selecting eventless transitions, so the state rests (the progress check refuses it).
 */
type Fallback<TWalk extends ProofWalk, TState extends string, TPath extends string> = EntryAt<TWalk, TPath>["node"] extends
  { readonly always: infer TAlways } ? FirstUnguarded<TAlways> extends infer TFirst
    ? [TFirst] extends [never] ? FallbackAbove<TWalk, TState, TPath>
    : TransitionLeaves<TWalk, TPath, TFirst, TState> extends true ? TargetPaths<TWalk, TPath, TFirst>
    : "none"
  : never
  : FallbackAbove<TWalk, TState, TPath>

/** The fallback from the parent of `TPath` up, or `"none"` above the root. */
type FallbackAbove<TWalk extends ProofWalk, TState extends string, TPath extends string> = TPath extends "" ? "none"
  : Fallback<TWalk, TState, ParentOf<TPath>>

/** The first unguarded transition of an `always` set as written, or `never`. */
type FirstUnguarded<TAlways> = TAlways extends readonly [infer THead, ...infer TRest]
  ? Unguarded<NormaliseOne<THead>> extends true ? NormaliseOne<THead> : FirstUnguarded<TRest>
  : TAlways extends ReadonlyArray<unknown> ? never
  : Unguarded<NormaliseOne<TAlways>> extends true ? NormaliseOne<TAlways>
  : never

/** The atomic and final states entering the nodes at `TTargets` can activate. */
type LeavesOf<TWalk extends ProofWalk, TTargets extends string> = TTargets extends unknown
  ? EntryAt<TWalk, TTargets> extends infer TEntry extends Entry
    ? TEntry["kind"] extends "history"
      ? Extract<TWalk["entries"], { readonly kind: "atomic" | "final"; readonly path: Below<TWalk["paths"], TEntry["parent"]> }>[
        "path"
      ]
    : Extract<TWalk["entries"], { readonly kind: "atomic" | "final"; readonly path: TEntry["entry"] }>["path"]
  : never
  : never

// ---------------------------------------------------------------------------------------------
// Reach-final: the edge graph
// ---------------------------------------------------------------------------------------------

/**
 * The reach graph of a walk. A node's transitions move it and every node below it; a compound
 * state reaches its initial state, a parallel state any region, a final state its parent's
 * completion, a completion its `onDone` targets, a region's completion its parallel state's
 * completion when every region can complete, and a history state any state its parent holds.
 */
type GraphEdges<TWalk extends ProofWalk> = BaseEdges<TWalk> | RegionEdges<TWalk, ""> | SiblingEdges<TWalk>

/** The reach graph without the region edges, which need to know which regions can complete. */
type BaseEdges<TWalk extends ProofWalk, TEach extends Entry = TWalk["entries"]> = TEach extends unknown ?
  | MoveEdge<TWalk, TEach, TargetPaths<TWalk, TEach["path"], Moves<TEach["node"]>>>
  | StructureEdge<TWalk, TEach>
  | CompletionEdge<TEach, TargetPaths<TWalk, TEach["path"], OnDoneOf<TEach["node"]>>>
  : never

/** The edge of a node's transitions, from the node and every node below it. */
type MoveEdge<TWalk extends ProofWalk, TEach extends Entry, TTo extends string> = [TTo] extends [never] ? never
  : { readonly from: AtOrBelow<TWalk["paths"], TEach["path"]>; readonly to: TTo; readonly all: false }

/** The edge of a node's structure: entry, region, completion by a final state, or history. */
type StructureEdge<TWalk extends ProofWalk, TEach extends Entry> = TEach["kind"] extends "compound"
  ? TEach["node"] extends { readonly initial: infer TInitial extends string }
    ? { readonly from: TEach["path"]; readonly to: Join<TEach["path"], TInitial>; readonly all: false }
  : never
  : TEach["kind"] extends "parallel"
    ? { readonly from: TEach["path"]; readonly to: ChildrenOf<TWalk, TEach["path"]>; readonly all: false }
  : TEach["kind"] extends "final" ? { readonly from: TEach["path"]; readonly to: Done<TEach["parent"]>; readonly all: false }
  : TEach["kind"] extends "history" ? {
      readonly from: TEach["path"]
      readonly to: HistoryTargets<TWalk, TEach>
      readonly all: false
    }
  : never

/** What a history state can enter: its default target, and any state its parent can hold (every level when deep). */
type HistoryTargets<TWalk extends ProofWalk, TEach extends Entry> =
  | (TEach["node"] extends { readonly target: infer TTarget extends string }
    ? KnownPath<
      TTarget extends `#${string}` ? ResolveTarget<TTarget, { readonly ids: TWalk["ids"] }, TEach["parent"], TEach["parent"]>
        : Join<TEach["parent"], TTarget>,
      TWalk["paths"]
    >
    : never)
  | (TEach["node"] extends { readonly history: "deep" } ? StatePathsOf<
      Extract<TWalk["entries"], { readonly path: Below<TWalk["paths"], TEach["parent"]> }>
    >
    : StatePathsOf<Extract<TWalk["entries"], { readonly parent: TEach["parent"] }>>)

/** The edge of a node's completion to its `onDone` targets. */
type CompletionEdge<TEach extends Entry, TTo extends string> = [TTo] extends [never] ? never
  : { readonly from: Done<TEach["path"]>; readonly to: TTo; readonly all: false }

/**
 * A sibling region can move every region of its parallel state: each state of a parallel state
 * outside a region reaches what that region's transitions out of the region target (out of the
 * parallel state, or into another region). Regions run side by side, and such a transition
 * exits every region, so a state waiting in one region is left when another region moves out.
 */
type SiblingEdges<TWalk extends ProofWalk> = Extract<TWalk["entries"], { readonly kind: "parallel" }>["path"] extends
  infer TParallel ? TParallel extends string ? ChildrenOf<TWalk, TParallel> extends infer TRegion
      ? TRegion extends string ? ExitTargets<TWalk, TRegion> extends infer TTo extends string
          ? [TTo] extends [never] ? never
          : {
            readonly from: Exclude<Below<TWalk["paths"], TParallel>, AtOrBelow<TWalk["paths"], TRegion>>
            readonly to: TTo
            readonly all: false
          }
        : never
      : never
    : never
  : never
  : never

/** The targets outside the node at `TRegion` of every transition declared at or below it. */
type ExitTargets<TWalk extends ProofWalk, TRegion extends string> = Extract<
  TWalk["entries"],
  { readonly path: AtOrBelow<TWalk["paths"], TRegion> }
> extends infer TEach ? TEach extends Entry ? Exclude<
      TargetPaths<TWalk, TEach["path"], Moves<TEach["node"]> | OnDoneOf<TEach["node"]>>,
      AtOrBelow<TWalk["paths"], TRegion>
    >
  : never
  : never

/** The paths a sibling region can move: those {@link SiblingEdges} moves. */
type Rescued<TWalk extends ProofWalk> = SiblingEdges<TWalk>["from"]

/**
 * For each parallel state at or below `TPath` whose regions can all complete: each region's
 * completion completes it. Only the parallel states at or below the part are asked, so that a
 * region's own completability never depends on itself.
 */
type RegionEdges<TWalk extends ProofWalk, TPath extends string> = Extract<
  TWalk["entries"],
  { readonly kind: "parallel"; readonly path: AtOrBelow<TWalk["paths"], TPath> }
>["path"] extends infer TParallel ? TParallel extends string ? Completable<TWalk, TParallel> extends true ? {
        readonly from: Done<ChildrenOf<TWalk, TParallel>>
        readonly to: Done<TParallel>
        readonly all: false
      }
    : never
  : never
  : never

/**
 * The tail-recursive fixed point: `TReached` grows by the `from` of every edge whose `to` it
 * reaches, until a step adds nothing. Each step adds at least one token, so the iterations stay
 * under the token count; {@link IterationCap} guards it anyway.
 */
type Reach<TEdges extends Edge, TReached extends string, TCount extends ReadonlyArray<0>> = TCount["length"] extends
  IterationCap ? Over
  : Step<TEdges, TReached> extends infer TNext extends string
    ? [TNext] extends [never] ? { readonly reached: TReached; readonly iterations: TCount["length"] }
    : Reach<TEdges, TReached | TNext, [...TCount, 0]>
  : never

/**
 * The fixed point's guard: above the most tokens a graph within the bound has (a path and a
 * completion token per state, and the root's), so a proof inside the bound never reaches it.
 */
type IterationCap = 200

/** The tokens one edge away from `TReached` that it does not hold yet. */
type Step<TEdges extends Edge, TReached extends string> = TEdges extends unknown
  ? [Exclude<TEdges["from"], TReached>] extends [never] ? never
  : TEdges["all"] extends true ? [TEdges["to"]] extends [TReached] ? Exclude<TEdges["from"], TReached> : never
  : [Extract<TEdges["to"], TReached>] extends [never] ? never
  : Exclude<TEdges["from"], TReached>
  : never

// ---------------------------------------------------------------------------------------------
// Reach-final: the whole-machine proof
// ---------------------------------------------------------------------------------------------

/** The whole-machine fixed point, from the machine's completion. */
type WholeReach<TWalk extends ProofWalk> = Reach<GraphEdges<TWalk>, Done<"">, []>

/** The whole-machine reach-final failures. */
type WholeFailures<TWalk extends ProofWalk> = WholeReach<TWalk> extends { readonly reached: infer TReached }
  ? StuckFailures<TWalk, Exclude<Provable<TWalk>, TReached>>
  : { readonly kind: "MachineTooLargeForTypeProof"; readonly path: "" }

/** The paths reach-final checks: every state except the root, final and history states. */
type Provable<TWalk extends ProofWalk> = Exclude<
  TWalk["entries"],
  { readonly kind: "final" | "history" | "wide" } | { readonly path: "" }
>["path"]

/** The failures of the stuck states `TStuck`: each one, and each region that cannot complete around one. */
type StuckFailures<TWalk extends ProofWalk, TStuck extends string> =
  | (TStuck extends unknown ? { readonly kind: "CannotReachFinal"; readonly path: TStuck } : never)
  | RegionFailures<TWalk, TStuck>

/** Each region that cannot complete, of a parallel state at or above which some state is stuck. */
type RegionFailures<TWalk extends ProofWalk, TStuck extends string, TEach extends Entry = TWalk["entries"]> = TEach extends
  { readonly kind: "parallel" }
  ? [Extract<TStuck, AtOrBelow<TWalk["paths"], TEach["path"]>>] extends [never] ? never
  : ChildrenOf<TWalk, TEach["path"]> extends infer TRegion
    ? TRegion extends string ? Completable<TWalk, TRegion> extends true ? never
      : { readonly kind: "RegionCannotComplete"; readonly path: TRegion }
    : never
  : never
  : never

// ---------------------------------------------------------------------------------------------
// Reach-final: parts (decision 18)
// ---------------------------------------------------------------------------------------------

/** The paths of the parts: the root, and every compound and parallel state. */
type PartPaths<TWalk extends ProofWalk> = Extract<TWalk["entries"], { readonly kind: "compound" | "parallel" }>["path"]

/**
 * The graph of the part at `TPart`, over its children: every edge of the machine graph, with
 * each token mapped to the child holding it, the part's own completion, or {@link Out}; each
 * child that can complete reaching its completion; and each child that a sibling region can move
 * reaching {@link Out}.
 */
type PartEdges<TWalk extends ProofWalk, TPart extends string> =
  | (BaseEdges<TWalk> | RegionEdges<TWalk, TPart> extends infer TEdge ? TEdge extends Edge
      ? PartEdge<FromPart<TPart, TEdge["from"]>, ToPart<TWalk, TPart, TEdge["to"]>>
    : never
    : never)
  | PartEdge<Extract<ChildrenOf<TWalk, TPart>, Rescued<TWalk>>, Out>
  | (ChildrenOf<TWalk, TPart> extends infer TChild
    ? TChild extends string ? Completable<TWalk, TChild> extends true
        ? { readonly from: TChild; readonly to: Done<TChild>; readonly all: false }
      : never
    : never
    : never)

/** An edge of a part graph, or none when an end maps to nothing. */
type PartEdge<TFrom extends string, TTo extends string> = [TFrom] extends [never] ? never
  : [TTo] extends [never] ? never
  : { readonly from: TFrom; readonly to: TTo; readonly all: false }

/** The part tokens a `from` set maps to: each child holding a token, and each child's own completion. */
type FromPart<TPart extends string, TFrom extends string> = TFrom extends `\\done:${infer TPath}`
  ? TPath extends TPart ? never
  : ChildOfPart<TPart, TPath> extends infer TChild extends string ? TChild extends TPath ? Done<TPath> : TChild
  : never
  : TFrom extends TPart ? never
  : ChildOfPart<TPart, TFrom>

/** The part tokens a `to` set maps to: a child, the part's completion, the part's entry, or {@link Out}. */
type ToPart<TWalk extends ProofWalk, TPart extends string, TTo extends string> = TTo extends `\\done:${infer TPath}`
  ? TPath extends TPart ? Done<TPart>
  : ChildOfPart<TPart, TPath> extends infer TChild extends string
    ? [TChild] extends [never] ? Out : TChild extends TPath ? Done<TPath> : TChild
  : Out
  : TTo extends TPart ? PartEntry<TWalk, TPart>
  : ChildOfPart<TPart, TTo> extends infer TChild extends string ? [TChild] extends [never] ? Out : TChild
  : Out

/** What entering the part itself activates among its children. */
type PartEntry<TWalk extends ProofWalk, TPart extends string> = Extract<
  ChildrenOf<TWalk, TPart>,
  EntryAt<TWalk, TPart>["entry"]
>

/** The child of the part at `TPart` that holds the path `TPath`, or `never` when the part does not hold it. */
type ChildOfPart<TPart extends string, TPath extends string> = TPart extends ""
  ? TPath extends `${infer THead}.${string}` ? THead : TPath
  : TPath extends `${TPart}.${infer TRest}` ? TRest extends `${infer THead}.${string}` ? Join<TPart, THead> : TPath
  : never

/** The tokens that end the part's proof: leaving it (not for the root), and its completion when handled. */
type PartSeeds<TWalk extends ProofWalk, TPart extends string> =
  | (TPart extends "" ? never : Out)
  | (TPart extends "" ? Done<TPart>
    : EntryAt<TWalk, TPart>["node"] extends { readonly onDone: unknown } ? Done<TPart>
    : EntryAt<TWalk, EntryAt<TWalk, TPart>["parent"]>["kind"] extends "parallel" ? Done<TPart>
    : never)

/** The fixed point of each part among `TParts`. */
type PartReach<TWalk extends ProofWalk, TParts extends string> = TParts extends unknown
  ? Reach<PartEdges<TWalk, TParts>, PartSeeds<TWalk, TParts>, []>
  : never

/**
 * `true` when the node at `TPath` can complete: a compound state's initial state reaches its
 * completion inside it, a parallel state's regions all can.
 */
type Completable<TWalk extends ProofWalk, TPath extends string> = EntryAt<TWalk, TPath>["kind"] extends "parallel"
  ? false extends (ChildrenOf<TWalk, TPath> extends infer TRegion ? TRegion extends string ? Completable<TWalk, TRegion> : never
    : never) ? false
  : true
  : EntryAt<TWalk, TPath>["kind"] extends "compound"
    ? Reach<PartEdges<TWalk, TPath>, Done<TPath>, []> extends { readonly reached: infer TReached }
      ? [PartEntry<TWalk, TPath>] extends [never] ? false
      : [Extract<PartEntry<TWalk, TPath>, TReached>] extends [never] ? false
      : true
    : false
  : false

/** The compositional reach-final failures: each part over its children, or too large. */
type CompositionalFailures<TWalk extends ProofWalk, TParts extends string = PartPaths<TWalk>> = TParts extends unknown
  ? CountUpTo<ChildrenOf<TWalk, TParts>, SettlementProofBound> extends Over
    ? { readonly kind: "MachineTooLargeForTypeProof"; readonly path: TParts }
  : Reach<PartEdges<TWalk, TParts>, PartSeeds<TWalk, TParts>, []> extends { readonly reached: infer TReached }
    ? StuckFailures<TWalk, PartStuck<TWalk, TParts, TReached>>
  : { readonly kind: "MachineTooLargeForTypeProof"; readonly path: TParts }
  : never

/** Every provable path at or below each child of the part that its fixed point did not reach. */
type PartStuck<TWalk extends ProofWalk, TPart extends string, TReached> = Exclude<
  Extract<TWalk["entries"], { readonly parent: TPart; readonly kind: "atomic" | "compound" | "parallel" }>["path"],
  TReached
> extends infer TChild ? TChild extends string ? Extract<Provable<TWalk>, AtOrBelow<TWalk["paths"], TChild>> : never
  : never

// ---------------------------------------------------------------------------------------------
// The error shape
// ---------------------------------------------------------------------------------------------

/** The failures shaped as the config: `unknown` with none. */
type ShapeRoot<TConfig, TFailures extends Failure> = [TFailures] extends [never] ? unknown
  : Shape<TConfig, "", Placed<TFailures>, Placed<TFailures>["at"]>

/** A failure with the path of the node its error lands on. */
interface PlacedFailure extends Failure {
  /** The path of the node the error lands on: the state's own, or a region's parallel state. */
  readonly at: string
}

/** Each failure placed: a region's error lands on its parallel state, every other on its state. */
type Placed<TFailures extends Failure> = TFailures extends unknown ? TFailures & {
    readonly at: TFailures["kind"] extends "RegionCannotComplete" ? ParentOf<TFailures["path"]> : TFailures["path"]
  }
  : never

/**
 * The errors of the node at `TPath`, or, when it has none of its own, of the nodes below it that
 * have one. A node's own error stops the shape there: the compilers report only the deepest
 * error of an object literal, so the topmost failing state is the one named (a compound sink is
 * reported, not its children), and the errors below it surface once it is fixed.
 */
type Shape<TNode, TPath extends string, TFailures extends PlacedFailure, TPaths extends string> = [
  Extract<TFailures, { readonly at: TPath }>
] extends [never] ? TNode extends { readonly states: infer TStates }
    ? [FailingChildren<TStates, TPath, TPaths>] extends [never] ? unknown
    : {
      readonly states: {
        readonly [K in FailingChildren<TStates, TPath, TPaths>]: Shape<TStates[K], Join<TPath, K>, TFailures, TPaths>
      }
    }
  : unknown
  : ErrorsAt<Extract<TFailures, { readonly at: TPath }>>

/** The child keys with a failure at or below them. */
type FailingChildren<TStates, TPath extends string, TPaths extends string> = {
  [K in keyof TStates & string]: [Extract<TPaths, Join<TPath, K> | `${Join<TPath, K>}.${string}`>] extends [never] ? never : K
}[keyof TStates & string]

/**
 * The error properties of one node, one per kind, each naming the paths of the states or
 * regions it is about (several regions of one parallel state share one error, as two error
 * properties of one name would reduce the intersection to `never`).
 */
type ErrorsAt<TFailures extends Failure> = UnionToIntersection<
  TFailures["kind"] extends infer TKind ? TKind extends string
      ? ErrorOf<TKind, Extract<TFailures, { readonly kind: TKind }>["path"]>
    : never
    : never
>

/** The error interface a failure kind names. */
type ErrorOf<TKind, TPath extends string> = TKind extends "CannotReachFinal" ? CannotReachFinal<TPath>
  : TKind extends "NoProgressGuarantee" ? NoProgressGuarantee<TPath>
  : TKind extends "Livelock" ? Livelock<TPath>
  : TKind extends "RegionCannotComplete" ? RegionCannotComplete<TPath>
  : TKind extends "ConfigNotLiteral" ? ConfigNotLiteral<TPath>
  : TKind extends "UnknownInitial" ? UnknownInitial<TPath>
  : TKind extends "StateKeyNotProvable" ? StateKeyNotProvable<TPath>
  : TKind extends "MachineHasNoStates" ? MachineHasNoStates
  : MachineTooLargeForTypeProof<TPath>
