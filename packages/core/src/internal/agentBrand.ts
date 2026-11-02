/**
 * @since 0.4.0
 * @module internal/agentBrand
 *
 * The brand that tells agent logic apart from every other actor logic, by type and at run
 * time. Agent logic must settle through a declared `onDone`, so each entry point that cannot
 * declare one refuses it by type with `NotAgentLogic`, and the structural proof scans for the
 * run-time marker in case a cast hid the type. Upstream has no counterpart: agent settlement is
 * a port addition.
 */
import { Predicate } from "effect"
import type { AnyLogicSlot } from "../ActorLogic.js"

/**
 * The key of the agent brand. It is a registered symbol, so two copies of the library in one
 * program brand and recognise the same logic.
 *
 * @since 0.4.0
 * @category Internal
 */
export const AgentBrand: unique symbol = Symbol.for("@jambudipa/xstate-effect/AgentBrand")

/**
 * The type of the {@link AgentBrand} key.
 *
 * @since 0.4.0
 * @category Internal
 */
export type AgentBrand = typeof AgentBrand

/**
 * What agent logic carries: the brand key with the value `true`.
 *
 * @since 0.4.0
 * @category Internal
 */
export interface AgentBranded {
  /** Present only on agent logic. */
  readonly [AgentBrand]: true
}

/**
 * `true` when `T` is agent logic, `false` otherwise. A union counts as agent logic when any
 * member does: the check reads the union whole and never gives `boolean` (TS-115). `never` and
 * `AnyLogicSlot` are not agent logic.
 *
 * @since 0.4.0
 * @category Internal
 */
export type IsAgentLogic<T> = [T] extends [never] ? false : [Extract<T, AgentBranded>] extends [never] ? false : true

/**
 * The refusal shape: intersect it with a logic slot, as `AnyLogicSlot & NotAgentLogic`, and
 * agent logic no longer fits, with an error that names `[AgentBrand]`. Ordinary logic fits, as
 * the key is optional (`exactOptionalPropertyTypes` is off, so `never` is the only value
 * refused).
 *
 * @since 0.4.0
 * @category Internal
 */
export interface NotAgentLogic {
  /** Absent on ordinary logic; agent logic's `true` does not fit `never`. */
  readonly [AgentBrand]?: never
}

/**
 * Actor logic that is not agent logic: the logic a spawn takes (NEG-3). A named alias, so an
 * error that prints a spawn signature stays as short as with `AnyLogicSlot`, and TS 6 and
 * tsgo print it alike.
 *
 * @since 0.4.0
 * @category Internal
 */
export type OrdinaryLogic = AnyLogicSlot & NotAgentLogic

/**
 * The key of the {@link HoldsAgents} flag and of its run-time mark. The flag's type carries the
 * machine's config; the mark says only that the machine holds agent logic, as the progress delay
 * check must see that through a child (NEG-10). A cast past the flag is the structural proof's
 * concern (decision 10).
 *
 * @since 0.4.0
 * @category Internal
 */
export const HoldsAgentsKey: unique symbol = Symbol.for("@jambudipa/xstate-effect/HoldsAgents")

/**
 * The type of the {@link HoldsAgentsKey} key.
 *
 * @since 0.4.0
 * @category Internal
 */
export type HoldsAgentsKey = typeof HoldsAgentsKey

/**
 * The flag of a machine whose config holds agents, with that config as written (decision 10). It
 * is not the agent brand: the brand does not spread to machines, so a machine that holds agents
 * still runs at the root and fits every slot that refuses agent logic, but a parent takes it
 * only with a certificate.
 *
 * @since 0.4.0
 * @category Internal
 */
export interface HoldsAgents<TConfig = unknown> {
  /** Its type is the machine's config. Its run-time value, `true`, is {@link markHoldsAgents}'s; nothing reads it as a config. */
  readonly [HoldsAgentsKey]: TConfig
}

/**
 * The key of the {@link CertifiedChild} mark. It exists only in types.
 *
 * @since 0.4.0
 * @category Internal
 */
export const CertificateKey: unique symbol = Symbol.for("@jambudipa/xstate-effect/Certificate")

/**
 * The type of the {@link CertificateKey} key.
 *
 * @since 0.4.0
 * @category Internal
 */
export type CertificateKey = typeof CertificateKey

/**
 * What a machine carries once `certified` bound a certificate to it (decision 10): the
 * certificate's type. Only this mark lets a parent declare a {@link HoldsAgents} machine.
 *
 * @since 0.4.0
 * @category Internal
 */
export interface CertifiedChild<TCertificate = unknown> {
  /** Never present at run time; its type is the certificate. */
  readonly [CertificateKey]: TCertificate
}

/**
 * The shape of a slot that takes a logic with no declaration around it (a spawn or an invocation
 * given inline): no agent logic, and no machine that holds agents, certified or not, because the
 * settlement checks read a child through the name a setup declares.
 *
 * @since 0.4.0
 * @category Internal
 */
export interface NotInlineChild extends NotAgentLogic {
  /** Absent on any machine that holds no agents. */
  readonly [HoldsAgentsKey]?: never
}

/**
 * Actor logic an inline spawn or invocation takes (see {@link NotInlineChild}). A named alias, as
 * {@link OrdinaryLogic} is.
 *
 * @since 0.4.0
 * @category Internal
 */
export type InlineLogic = AnyLogicSlot & NotInlineChild

/**
 * The members of a `ProvidedActor` union a declared invocation takes: all but a machine that
 * holds agents and carries no certificate (S17).
 *
 * @since 0.4.0
 * @category Internal
 */
export type InvocableActor<TActor> = TActor extends { readonly logic: HoldsAgents }
  ? TActor extends { readonly logic: CertifiedChild } ? TActor : never
  : TActor

/**
 * The members of a `ProvidedActor` union a spawn takes by name: no agent logic (NEG-3), and a
 * machine that holds agents only with a certificate and an id from `types.children`, without
 * which no handler could name its settlement event (S17).
 *
 * @since 0.4.0
 * @category Internal
 */
export type SpawnableActor<TActor> = TActor extends { readonly logic: HoldsAgents }
  ? TActor extends { readonly logic: CertifiedChild; readonly id: string } ? TActor : never
  : NotAgentActor<TActor>

/**
 * The members of a `ProvidedActor` union a machine without setup may name: no agent logic and no
 * machine that holds agents, since such a machine has no settlement check.
 *
 * @since 0.4.0
 * @category Internal
 */
export type PlainActor<TActor> = TActor extends { readonly logic: HoldsAgents } ? never : NotAgentActor<TActor>

/**
 * The members of a `ProvidedActor` union whose logic is not agent logic, so the name of agent
 * logic is no name a spawn takes (NEG-3).
 *
 * @since 0.4.0
 * @category Internal
 */
export type NotAgentActor<TActor> = TActor extends { readonly logic: AgentBranded } ? never : TActor

/**
 * The child ids that `types.children` gives agent logic among the `ProvidedActor` union
 * `TActor`: only literal ids, as an actor that declares none takes any string and no stop by id
 * can be told apart. A stop of one of these ids is refused (NEG-9).
 *
 * @since 0.4.0
 * @category Internal
 */
export type AgentChildId<TActor> = TActor extends { readonly logic: AgentBranded; readonly id: infer TId extends string }
  ? string extends TId ? never : TId
  : never

/**
 * Marks logic as agent logic and returns the same object, typed with the brand. The marker is
 * a non-enumerable, read-only `true` under {@link AgentBrand}, on the logic and on its
 * `transition`. A spread or `Object.assign` copy drops the first, but keeps the `transition`
 * function and so the second. The logic must own its `transition` function; marking a function
 * that other logic shares would mark that logic too. Marking twice changes nothing.
 *
 * @since 0.4.0
 * @category Internal
 */
export const markAgentLogic = <T extends AnyLogicSlot>(logic: T): Omit<T, AgentBrand> & AgentBranded => {
  defineMarker(logic)
  defineMarker(logic.transition)
  return logic as unknown as Omit<T, AgentBrand> & AgentBranded
}

/**
 * `true` when the value is marked agent logic, or a structural copy of it, whatever its static
 * type says. It is the run-time check that a cast cannot hide (NEG-8).
 *
 * @since 0.4.0
 * @category Internal
 */
export const hasAgentBrand = (value: unknown): boolean =>
  Predicate.isObjectKeyword(value) && (hasMarker(value) || hasMarker(Reflect.get(value, "transition")))

/**
 * Marks a machine as one that holds agent logic, and returns it. It is no agent brand: the
 * machine still runs at the root and fits every slot that refuses agent logic. Every machine that
 * holds agent logic gets it when it is built, so a parent reads it through any depth of children.
 * Forging it can only add a refusal.
 *
 * @since 0.4.0
 * @category Internal
 */
export const markHoldsAgents = <T extends object>(machine: T): T =>
  Object.defineProperty(machine, HoldsAgentsKey, { value: true, enumerable: false })

/**
 * `true` when the value is a machine that {@link markHoldsAgents} marked.
 *
 * @since 0.4.0
 * @category Internal
 */
export const hasHoldsAgentsMark = (value: unknown): boolean =>
  Predicate.isObjectKeyword(value) && Object.getOwnPropertyDescriptor(value, HoldsAgentsKey)?.value === true

/** Defines the marker once, as an own, non-enumerable, read-only, non-configurable property. */
const defineMarker = (target: object): void => {
  if (hasMarker(target)) return
  Object.defineProperty(target, AgentBrand, { value: true, enumerable: false, writable: false, configurable: false })
}

/** `true` when the value owns the marker with the value `true`; a look-alike key with another value does not count. */
const hasMarker = (value: unknown): boolean =>
  Predicate.isObjectKeyword(value) && Object.getOwnPropertyDescriptor(value, AgentBrand)?.value === true
