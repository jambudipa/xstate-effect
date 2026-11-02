/**
 * @since 0.4.0
 * @module internal/provideCheck
 *
 * What `machine.provide` refuses by type, beside the names and types the machine declares
 * (NEG-7, NEG-10). Agent logic settles only through the `onDone` of an invocation that expects
 * it, so `provide` refuses agent logic in place of an actor whose declared logic is not agent
 * logic. In a machine that holds agent logic, directly or through a child, a named delay that keys an `after` transition out of its
 * state is that state's progress exit, so `provide` takes for it only a positive integer literal,
 * never a wide number (which may hold infinity or NaN) or a function (which may return either).
 * `StateMachine.ts` holds the run-time half. Upstream has no counterpart: agent settlement is a
 * port addition.
 */
import type { CheckedLiteral, PositiveIntegerLiteral } from "../actors/fromAgent.js"
import type { CertifiedChild, HoldsAgents, IsAgentLogic, NotInlineChild } from "./agentBrand.js"

/**
 * The key of the type-only marker that names a machine's progress delays in what its `provide`
 * takes. No value has it: `provide` reads it from the type alone.
 *
 * @since 0.4.0
 * @category Internal
 */
export declare const ProgressDelays: unique symbol

/**
 * The marker a setup machine that holds agent logic adds to what its `provide` takes: the names of its
 * progress delays (see {@link ProgressDelayNames}). It is optional, so no call passes it.
 *
 * @since 0.4.0
 * @category Internal
 */
export interface ProgressDelayMarker<TNames extends string> {
  /** Never present at run time; its type names the progress delays. */
  readonly [ProgressDelays]?: TNames
}

/**
 * The constraint `provide` adds to what it takes: each actor name whose declared logic is not
 * agent logic takes no agent logic (NEG-7). A record of any name (a machine without setup)
 * takes no agent logic under any name. An agent actor may still be replaced by agent logic, and a
 * certified child only by certified logic (S17).
 *
 * @since 0.4.0
 * @category Internal
 */
export interface ProvidedActorsCheck<TProvided> {
  /**
   * Per declared actor name: no refusal for an agent actor, a certificate for a machine that
   * holds agents, `NotInlineChild` for any other.
   */
  readonly actors?: {
    readonly [K in keyof ActorsOf<TProvided>]?: IsAgentLogic<ActorsOf<TProvided>[K]> extends true ? unknown
      : [Extract<ActorsOf<TProvided>[K], HoldsAgents>] extends [never] ? NotInlineChild
      : CertifiedChild
  }
}

/** The `actors` record of what `provide` takes; nothing when it has none. */
type ActorsOf<TProvided> = TProvided extends { readonly actors?: infer TActors } ? NonNullable<TActors> : never

/**
 * What the given implementations `TGiven` must also match (NEG-10): `unknown` unless the
 * machine names progress delays; then each progress delay given must be a positive integer
 * literal, and a wide number or a function fails with the {@link PositiveIntegerLiteral}
 * refusal that names the delay.
 *
 * @since 0.4.0
 * @category Internal
 */
export type ProvidedDelayCheck<TGiven, TProvided> = [ProgressNamesOf<TProvided>] extends [never] ? unknown
  : TGiven extends { readonly delays?: infer TDelays }
    ? {
      readonly delays?: {
        readonly [K in keyof TDelays & ProgressNamesOf<TProvided>]: ProgressDelayValue<TDelays[K], K & string>
      }
    }
  : unknown

/** The progress delay names the marker in `TProvided` holds; none without the marker. */
type ProgressNamesOf<TProvided> = TProvided extends { readonly [ProgressDelays]?: infer TNames extends string } ? TNames
  : never

/** What a given progress delay must match: a number is checked as a literal, anything else is refused. */
type ProgressDelayValue<TValue, TName extends string> = [TValue] extends [number]
  ? CheckedLiteral<TValue, `progress delay ${TName}`>
  : PositiveIntegerLiteral<`progress delay ${TName}`>

/**
 * The progress delays of a config: each named key of an `after` (one that reads as no number)
 * whose transition, on some branch, targets a state outside the state that holds it. A target
 * that starts with `.` (a child) or names the state itself stays inside; a `#id` target counts
 * as leaving, so the type is never weaker than the run-time check, which resolves it. The
 * root's own `after` has no state outside it and gives none.
 *
 * @since 0.4.0
 * @category Internal
 */
export type ProgressDelayNames<TConfig> = TConfig extends { readonly states: infer TStates } ? ChildDelays<TStates>
  : never

/** The progress delays of each child of a `states` record and of its descendants. */
type ChildDelays<TStates> = { readonly [K in keyof TStates & string]: NodeDelays<TStates[K], K> }[keyof TStates & string]

/** The progress delays of the node `TNode` under the key `TKey`, and of its descendants. */
type NodeDelays<TNode, TKey extends string> =
  | (TNode extends { readonly after: infer TAfter } ? LeavingKeys<TAfter, TKey> : never)
  | ProgressDelayNames<TNode>

/** The named keys of an `after` record with a transition that leaves the state `TKey`. */
type LeavingKeys<TAfter, TKey extends string> = {
  readonly [K in keyof TAfter & string]: K extends `${number}` ? never
    : true extends Leaves<TAfter[K], TKey> ? K
    : never
}[keyof TAfter & string]

/** `true` on each branch of a transition config that targets a state outside `TKey`. */
type Leaves<T, TKey extends string> = T extends string ? TargetLeaves<T, TKey>
  : T extends ReadonlyArray<infer TEntry> ? Leaves<TEntry, TKey>
  : T extends { readonly target: infer TTarget } ? Leaves<TTarget, TKey>
  : false

/** `true` when a target string names a state outside `TKey`: not a child (`.x`), not `TKey` itself. */
type TargetLeaves<T extends string, TKey extends string> = T extends `.${string}` ? false : T extends TKey ? false : true
