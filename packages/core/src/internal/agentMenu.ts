/**
 * @since 0.4.0
 * @module internal/agentMenu
 *
 * The type check that an agent's tools are events its invoking state accepts (S21). Agent logic
 * declares its tools by event type (`fromAgent({ tools })`); `MenuCheck` walks a setup machine's
 * config as written (a setup's `const TConfig`) and, at each agent invocation, compares those
 * tools with the state's menu. The menu holds:
 *
 * - every event the state's own `on` handles, with or without a target (an accepted event that
 *   does not leave the state is still a tool; at run time it is an illegal turn);
 * - an event an ancestor handles, only when the nearest ancestor that names it has a target for
 *   it, as a targeted transition from an ancestor exits the state;
 * - every event a sibling region of a parallel ancestor handles, anywhere in that region (it is
 *   delivered, and is illegal when it does not exit).
 *
 * `on: { X: undefined }` removes `X`; a wildcard (`*`, `a.*`) and an `xstate.` event are never
 * tools. Upstream has no counterpart: agent settlement is a port addition.
 */
import type { AgentSrc, Join, RootId } from "./settlement.js"

/**
 * The error an agent invocation gets when one of its agent's tools names an event the invoking
 * state does not accept. It names the tools and the state. No value fits it.
 *
 * @since 0.4.0
 * @category Internal
 */
export interface AgentToolNotAccepted<TTool extends string, TState extends string> {
  /** Why the invocation is refused. */
  readonly AgentToolNotAccepted: `the state ${TState} does not accept the event of the agent tool ${TTool}`
}

/**
 * The error an agent invocation gets when its state accepts no concrete event: the agent would
 * have no tool that could move it. It names the state. No value fits it.
 *
 * @since 0.4.0
 * @category Internal
 */
export interface AgentStateAcceptsNoEvents<TState extends string> {
  /** Why the invocation is refused. */
  readonly AgentStateAcceptsNoEvents: `the state ${TState} accepts no event, so it cannot invoke an agent`
}

/**
 * The menu errors of a setup machine's config as written, shaped as the config so that each
 * error lands on the `src` of the agent invocation it names; `unknown` when there is none. A
 * setup without agent actors (`TActor`, its `ProvidedActor` union) always gets `unknown`, with
 * no walk. An agent whose tools are typed wide (`string` keys) fails closed.
 *
 * @since 0.4.0
 * @category Internal
 */
export type MenuCheck<TConfig, TActor> = [AgentSrc<TActor>] extends [never] ? unknown
  : MenuNode<TConfig, TActor, never, never, "", RootId<TConfig>>

/**
 * The event names an agent's menu holds for a state, from the events it inherits and those its
 * sibling regions handle (see the module comment).
 *
 * @since 0.4.0
 * @category Internal
 */
export type AgentMenu<TNode, TInherited extends string, TSiblings extends string> = Concrete<
  Handled<OnOf<TNode>> | Exclude<TInherited, OnKeys<TNode>> | TSiblings
>

/** The menu errors of one node and the nodes below it; `unknown` when there is none. */
type MenuNode<TNode, TActor, TInherited extends string, TSiblings extends string, TPath extends string, TRoot extends string> =
  & InvokeMenuErrors<TNode, TActor, AgentMenu<TNode, TInherited, TSiblings>, TPath extends "" ? TRoot : TPath>
  & StatesMenuErrors<TNode, TActor, Exclude<TInherited, OnKeys<TNode>> | Targeted<OnOf<TNode>>, TSiblings, TPath, TRoot>

/** The node's `on` record, or an empty one. */
type OnOf<TNode> = TNode extends { readonly on: infer TOn } ? TOn : Record<never, never>

/** Every key of the node's `on`, a forbidden one (`undefined`) included. */
type OnKeys<TNode> = keyof OnOf<TNode> & string

/** The keys of an `on` record whose transition is not forbidden (`undefined`). */
type Handled<TOn> = { [K in keyof TOn & string]: [TOn[K]] extends [undefined] ? never : K }[keyof TOn & string]

/** The keys of an `on` record with a target on at least one branch. */
type Targeted<TOn> = { [K in keyof TOn & string]: true extends HasTarget<TOn[K]> ? K : never }[keyof TOn & string]

/** `true` for each branch of a transition (a union, or a list of them) that has a target. */
type HasTarget<T> = T extends string ? (T extends "" ? false : true)
  : T extends ReadonlyArray<infer TBranch> ? HasTarget<TBranch>
  : T extends { readonly target: infer TTarget } ? TTarget extends string ? (TTarget extends "" ? false : true)
    : TTarget extends readonly [unknown, ...ReadonlyArray<unknown>] ? true
    : false
  : false

/** The names that can be tools: no wildcard, no `xstate.` event, not the empty key. */
type Concrete<K extends string> = K extends "" | "*" | `${string}.*` | `xstate.${string}` ? never : K

/** Every event the node and the nodes below it handle. */
type Subtree<TNode> =
  | Handled<OnOf<TNode>>
  | (TNode extends { readonly states: infer TStates } ? { [K in keyof TStates & string]: Subtree<TStates[K]> }[keyof TStates & string]
    : never)

/** The events the other regions of a parallel node handle, for its child `K`. */
type RegionSiblings<TNode, TStates, K extends string> = TNode extends { readonly type: "parallel" }
  ? { [J in Exclude<keyof TStates & string, K>]: Subtree<TStates[J]> }[Exclude<keyof TStates & string, K>]
  : never

/** The errors below the node, under `states`, only for the children that have one. */
type StatesMenuErrors<TNode, TActor, TInherited extends string, TSiblings extends string, TPath extends string, TRoot extends string> =
  TNode extends { readonly states: infer TStates }
    ? [FailingKeys<TNode, TStates, TActor, TInherited, TSiblings, TPath, TRoot>] extends [never] ? unknown
    : {
      readonly states: {
        readonly [K in FailingKeys<TNode, TStates, TActor, TInherited, TSiblings, TPath, TRoot>]: ChildMenu<
          TNode,
          TStates,
          K,
          TActor,
          TInherited,
          TSiblings,
          TPath,
          TRoot
        >
      }
    }
    : unknown

/** The menu errors of the child `K`, which inherits the parent's events and sibling regions. */
type ChildMenu<TNode, TStates, K extends keyof TStates & string, TActor, TInherited extends string, TSiblings extends string, TPath extends string, TRoot extends string> =
  MenuNode<TStates[K], TActor, TInherited, TSiblings | RegionSiblings<TNode, TStates, K>, Join<TPath, K>, TRoot>

/** The child keys whose subtree has a menu error. */
type FailingKeys<TNode, TStates, TActor, TInherited extends string, TSiblings extends string, TPath extends string, TRoot extends string> = {
  [K in keyof TStates & string]: unknown extends ChildMenu<TNode, TStates, K, TActor, TInherited, TSiblings, TPath, TRoot> ? never : K
}[keyof TStates & string]

/** The errors of the node's invocations: one entry, or a list with an entry per invocation. */
type InvokeMenuErrors<TNode, TActor, TMenu extends string, TName extends string> = TNode extends { readonly invoke: infer TInvoke }
  ? TInvoke extends ReadonlyArray<unknown>
    ? [FailingEntry<TInvoke[number], TActor, TMenu, TName>] extends [never] ? unknown
    : { readonly invoke: { readonly [I in keyof TInvoke]: EntryError<TInvoke[I], TActor, TMenu, TName> } }
  : unknown extends EntryError<TInvoke, TActor, TMenu, TName> ? unknown
  : { readonly invoke: EntryError<TInvoke, TActor, TMenu, TName> }
  : unknown

/** The invocations among `TEntry` (a union) that have an error. */
type FailingEntry<TEntry, TActor, TMenu extends string, TName extends string> = TEntry extends unknown
  ? unknown extends EntryError<TEntry, TActor, TMenu, TName> ? never : TEntry
  : never

/**
 * The error of one invocation: none for ordinary logic; for agent logic, an empty menu first,
 * else the tools that are not on the menu.
 */
type EntryError<TEntry, TActor, TMenu extends string, TName extends string> = TEntry extends
  { readonly src: infer TSrc extends AgentSrc<TActor> }
  ? [TMenu] extends [never] ? { readonly src: AgentStateAcceptsNoEvents<TName> }
  : [Exclude<ToolsOf<TActor, TSrc>, TMenu>] extends [never] ? unknown
  : { readonly src: AgentToolNotAccepted<Exclude<ToolsOf<TActor, TSrc>, TMenu>, TName> }
  : unknown

/** The tool names of the agent actor `TSrc`: the keys of its logic's `tools`; none without them. */
type ToolsOf<TActor, TSrc> = TActor extends { readonly src: TSrc; readonly logic: infer TLogic }
  ? TLogic extends { readonly tools: infer TTools } ? keyof TTools & string : never
  : never
