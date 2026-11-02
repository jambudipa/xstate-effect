/**
 * The capability that lets a caller run an agent logic's own methods. The actor runtime hands the
 * one value to genuine agent logic only, and that logic refuses a call without it, whatever
 * static type the caller holds (NEG-4). Ordinary logic never receives it, so no logic given to
 * `createActor` can read it and pass it on. `ActorLogic` takes it as an optional rest parameter,
 * and `AnyLogicSlot` and `AgentActorLogic` require it. No entry point exports this module.
 *
 * Both the value and the record of holders stay private to one copy of the library, on purpose.
 * Whatever two copies could share (a registered symbol, a record on `globalThis`), user code can
 * reach too, and then it could grant its own logic the capability. So agent logic of one copy
 * under the runtime of another fails closed: the invocation is refused, the actor errors and no
 * turn runs. Agent settlement needs one copy of the library in a program.
 *
 * @since 0.4.0
 * @category Internal
 */
import { Predicate } from "effect"

/** The key of {@link LogicCapability}: private here, so no other module can build the type. */
const LogicCapabilityKey: unique symbol = Symbol("@jambudipa/xstate-effect/LogicCapability")

/**
 * The type of the capability. A required key refuses `{}`, and a required parameter of this type
 * refuses `undefined`.
 *
 * @since 0.4.0
 * @category Internal
 */
export interface LogicCapability {
  /** Present only on {@link logicCapability}. */
  readonly [LogicCapabilityKey]: true
}

/**
 * The value the actor runtime passes to agent logic. A check compares by identity, so a copy
 * with the same key is refused.
 *
 * @since 0.4.0
 * @category Internal
 */
export const logicCapability: LogicCapability = Object.freeze({ [LogicCapabilityKey]: true as const })

/** The logic objects `fromAgent` built. A marker would not do: the brand key is a registered symbol, so user code can write it. */
const capabilityHolders = new WeakSet()

/**
 * Records `logic` as logic the runtime may hand the capability to, and returns it.
 *
 * @since 0.4.0
 * @category Internal
 */
export const grantLogicCapability = <T extends object>(logic: T): T => {
  capabilityHolders.add(logic)
  return logic
}

/**
 * The arguments the actor runtime appends to a call of `logic`'s own methods: the capability for
 * logic `fromAgent` built, nothing for any other logic, so ordinary logic keeps upstream's
 * arguments.
 *
 * @since 0.4.0
 * @category Internal
 */
export const capabilityFor = (logic: object): ReadonlyArray<LogicCapability> => (capabilityHolders.has(logic) ? [logicCapability] : [])

/**
 * `true` only for logic `fromAgent` built, and no copy of it. The brand says what a machine must
 * do with a logic, so a forged one only costs its forger; this says what a machine may claim, so
 * the agent progress guarantee reads this and never the brand.
 *
 * @since 0.4.0
 * @category Internal
 */
export const isGenuineAgent = (logic: unknown): boolean => Predicate.isObjectKeyword(logic) && capabilityHolders.has(logic)

/**
 * `true` only for the runtime's own value.
 *
 * @since 0.4.0
 * @category Internal
 */
export const isLogicCapability = (value: unknown): boolean => value === logicCapability
