/**
 * @since 0.4.0
 * @module graph/settlement
 *
 * The structural settlement proof: {@link proveSettlement} reads a built machine's state node
 * tree, so nothing a type can hide hides from it. It closes what the type proof
 * (`src/settlement.ts`) cannot reach: a plain `createMachine`, agent logic cast to ordinary
 * logic, agent logic that `provide` adds, and a stop of an agent by an id the types do not
 * declare. Progress, reach-final, region completion, the `always` livelock and each `on` key that
 * takes an agent's done event follow the type proof's semantics, and a test feeds one set of
 * machines to both proofs (the F32 cases of COV-5). Cycles, stops and a named delay's value are
 * this proof's alone. Upstream has no counterpart: agent settlement is a port addition.
 *
 * It reads structure only and runs no guard, action or context, so a guard counts as able to
 * pass, an action behind `enqueueActions` or a function target of `stopChild` stays unseen, and
 * a declared counter is taken at its word: the explorer checks that it does decrease.
 */
import { Array as Arr, Effect, HashMap, HashSet, type Layer, Option, Order, Predicate, Result, Schema } from "effect"
import type { AnyLogicSlot } from "../ActorLogic.js"
import { type EventObject, matchesEventDescriptor } from "../Event.js"
import { hasAgentBrand } from "../internal/agentBrand.js"
import { finiteDelayOf, isFiniteDelay, lookupDelay } from "../internal/delay.js"
import { isGenuineAgent } from "../internal/logicCapability.js"
import { stopTargetOf } from "../internal/stopTarget.js"
import { resolveReferencedActor, type SpawningMachine } from "../spawn.js"
import type { AnyStateMachine } from "../StateMachine.js"
import { isStateNode, type StateNode } from "../StateNode.js"
import type { Action, InvokeDefinition, TransitionDefinition } from "../Types.js"
import type { SettlementCertificate } from "../settlement.js"
import { resolveTarget } from "../stateUtils.js"
import { isStateMachine } from "../StateMachine.js"
import { CertificateCheckError, CertificateUnreadableValue, SettlementProofError } from "./errors.js"
import type { ExploreEnvironment } from "./explore.js"
import { type CertificateModule, unresolvedImports } from "./moduleClosure.js"
import { isUnguarded, simpleStringify } from "./utils.js"

/**
 * What the proof can fail on.
 *
 * - `AgentWithoutSettlement`: an invocation of agent logic has no `onDone` (NEG-8).
 * - `SettlementMustExit`: an agent's `onDone` may stay in the invoking state (S15).
 * - `AgentDoneOutsideOnDone`: an `on` key takes an agent's done event in place of `onDone`: the
 *   exact key on the invoking node, or any matching key below it or in a region beside it.
 * - `StopsInvokedAgent`: an action stops an invoked agent by its id (NEG-9).
 * - `UnrankedAgentCycle`: a cycle re-enters an agent state with no declared bound (S16).
 * - `MachineDefinitionInvalid`: the machine keeps a definition error, so it cannot run or be read.
 * - `CannotReachFinal`, `NoProgressGuarantee`, `Livelock`, `RegionCannotComplete` and
 *   `MachineHasNoStates`: as the type proof's errors of those names.
 *
 * @since 0.4.0
 * @category Settlement
 */
export type SettlementFindingKind =
  | "AgentWithoutSettlement"
  | "SettlementMustExit"
  | "AgentDoneOutsideOnDone"
  | "StopsInvokedAgent"
  | "UnrankedAgentCycle"
  | "CannotReachFinal"
  | "NoProgressGuarantee"
  | "Livelock"
  | "RegionCannotComplete"
  | "MachineHasNoStates"
  | "MachineDefinitionInvalid"

/**
 * One failure of the proof, with its location.
 *
 * @since 0.4.0
 * @category Settlement
 */
export interface SettlementFinding {
  /** What failed. */
  readonly kind: SettlementFindingKind
  /** The path of the state it names: keys joined with `.`, `""` for the root. */
  readonly path: string
  /** What failed and where, for a person. */
  readonly message: string
  /** The invocation it names, for a finding about one. */
  readonly invocation?: {
    /** Its position in the state's invocations. */
    readonly index: number
    /** The invoked actor's id. */
    readonly id: string
    /** Its source name; inline logic has the generated `xstate.invoke.<index>.<node id>`. */
    readonly src: string
  }
}

/**
 * The transition `meta` that bounds a cycle through an agent state (S16). An invocation's budget
 * is per invocation, so each re-entry buys a new one: every such cycle must pass a transition
 * that declares one of these. The machine's `meta` type must allow them.
 *
 * @example
 * ```ts
 * on: { RETRY: { target: "thinking", guard: "retriesLeft", meta: { ranking: "retries" } } }
 * on: { ANSWER: { target: "thinking", meta: { person: true } } }
 * ```
 *
 * @since 0.4.0
 * @category Settlement
 */
export interface SettlementTransitionMeta {
  /**
   * The context counter that falls each time the transition is taken. It counts only on a
   * guarded transition, as nothing else can stop the cycle. The explorer checks that it falls.
   */
  readonly ranking?: string
  /** `true` when only a person sends the transition's event, so no model can drive the cycle. */
  readonly person?: boolean
}

/** A state node of the machine under proof. */
type Node = StateNode<unknown, EventObject>

/** A transition of the machine under proof. */
type Transition = TransitionDefinition<unknown, EventObject>

/** An invocation of the machine under proof. */
type Invocation = InvokeDefinition<unknown, EventObject>

/** The machine as the proof reads it: the engine's view of any built machine. */
type ProvableMachine = AnyStateMachine & SpawningMachine

/** What one proof needs at hand, built once from the machine. */
interface Proof {
  /** The machine under proof. */
  readonly machine: ProvableMachine
  /** Every node, in document order, the root first. */
  readonly nodes: ReadonlyArray<Node>
  /** The agent invocations of each node, by path. */
  readonly agents: HashMap.HashMap<string, ReadonlyArray<AgentInvocation>>
}

/** An invocation of agent logic. */
interface AgentInvocation {
  /** `true` when `fromAgent` built the logic. A forged brand obliges a settlement, but buys no progress. */
  readonly genuine: boolean
  /** The invocation. */
  readonly invoke: Invocation
  /** Its position in the state's invocations. */
  readonly index: number
}

/**
 * Proves a machine's settlement over its state node tree, and fails with
 * {@link SettlementProofError}, which holds every finding, when it does not hold. It runs on
 * the machine it is given, so a machine from `provide` is proved with what `provide` added, and
 * it finds agent logic by its run-time brand, which a cast cannot hide. It checks:
 *
 * - every invocation of agent logic has an `onDone` that leaves the invoking state;
 * - no action stops an invoked agent by its id or system id;
 * - every non-final atomic state has a progress guarantee, every state reaches a final state,
 *   and no `always` fallback loops, as the type proof does;
 * - every cycle that re-enters an agent state passes a {@link SettlementTransitionMeta}.
 *
 * A machine that holds no agent logic owes none of this, whatever its shape, and passes
 * (COMPAT-1), unless it keeps a definition error: it then cannot run, and its tree cannot be read. Child machines are proved through their own certificates, not from here.
 *
 * @example
 * ```ts
 * import { createMachine } from "@jambudipa/xstate-effect"
 * import { proveSettlement } from "@jambudipa/xstate-effect/graph"
 * import { Effect } from "effect"
 *
 * const machine = createMachine({ initial: "done", states: { done: { type: "final" } } })
 * Effect.runSync(proveSettlement(machine))
 * ```
 *
 * @since 0.4.0
 * @category Graph
 */
export const proveSettlement = (machine: AnyStateMachine): Effect.Effect<void, SettlementProofError> =>
  Effect.flatMap(definitionFindings(machine), (invalid) => {
    // Every built machine has what `SpawningMachine` reads; `AnyStateMachine` does not list it
    const findings = invalid.length > 0 || !isStateNode(machine.root) ? invalid : findingsOf(machine as ProvableMachine, machine.root)
    if (findings.length === 0) return Effect.void
    const lines = findings.map((finding) => `  ${finding.kind}: ${finding.message}`).join("\n")
    return Effect.fail(
      new SettlementProofError({
        message: `Machine '${machine.id}' fails the settlement proof:\n${lines}`,
        machineId: machine.id,
        findings,
      })
    )
  })

/**
 * The definition error of a machine that keeps one (a target that names no state, SD-3). Such a
 * machine's tree is not fully built, so nothing else in it can be read, and it could hide an
 * agent. `resolveState` is the one read that reports the error and runs no user code; the empty
 * value resolves to the initial configuration of any valid machine.
 */
const definitionFindings = (machine: AnyStateMachine): Effect.Effect<ReadonlyArray<SettlementFinding>> =>
  Effect.match(machine.resolveState({ value: {} }), {
    onSuccess: () => [],
    onFailure: (error) => [{ kind: "MachineDefinitionInvalid" as const, path: "", message: error.message }],
  })

/** Every finding of the machine, or none when it holds no agent logic. */
const findingsOf = (machine: ProvableMachine, root: Node): ReadonlyArray<SettlementFinding> => {
  const nodes = nodesOf(root)
  const agents = HashMap.fromIterable(
    nodes.flatMap((node) => {
      const invocations = node.invoke.flatMap((invoke, index) => {
        const logic = invokedLogic(machine, invoke)
        return Option.exists(logic, hasAgentBrand) ? [{ invoke, index, genuine: Option.exists(logic, isGenuineAgent) }] : []
      })
      return invocations.length > 0 ? [[pathOf(node), invocations] as const] : []
    })
  )
  const provided = Object.values<AnyLogicSlot>(machine.implementations.actors ?? {})
  if (HashMap.isEmpty(agents) && !provided.some(hasAgentBrand)) return []
  if (Object.keys(root.states).length === 0) {
    return [{ kind: "MachineHasNoStates", path: "", message: "a machine needs states, and a final state that each of them reaches" }]
  }
  const proof: Proof = { machine, nodes, agents }
  return [
    ...settlementFindings(proof),
    ...stopFindings(proof),
    ...progressFindings(proof),
    ...livelockFindings(proof),
    ...reachFindings(proof),
    ...cycleFindings(proof),
  ]
}

/** The logic an invocation runs, under its name or as inline logic. */
const invokedLogic = (machine: ProvableMachine, invoke: Invocation): Option.Option<unknown> =>
  typeof invoke.src === "string" ? resolveReferencedActor(machine, invoke.src) : Option.some(invoke.src)

/** The node and every node below it, in document order. */
const nodesOf = (node: Node): ReadonlyArray<Node> => [node, ...Object.values(node.states).flatMap(nodesOf)]

/** The path of a node, as the type proof writes it. */
const pathOf = (node: Node): string => node.path.join(".")

/** The agent invocations of a node. */
const agentsOf = (proof: Proof, node: Node): ReadonlyArray<AgentInvocation> =>
  Option.getOrElse(HashMap.get(proof.agents, pathOf(node)), () => [])

/** `true` when `node` is `ancestor` or below it. */
const isAtOrBelow = (node: Node, ancestor: Node): boolean =>
  ancestor.path.length <= node.path.length && ancestor.path.every((key, index) => key === node.path[index])

/** The transitions of a node for one event descriptor. */
const transitionsFor = (node: Node, descriptor: string): ReadonlyArray<Transition> =>
  node.transitions.flatMap(([each, transitions]) => (each === descriptor ? transitions : []))

// ---------------------------------------------------------------------------------------------
// Settlement (NEG-8, S15)
// ---------------------------------------------------------------------------------------------

/** The findings of each agent invocation's settlement. */
const settlementFindings = (proof: Proof): ReadonlyArray<SettlementFinding> =>
  proof.nodes.flatMap((node) => agentsOf(proof, node).flatMap((agent) => settlementOf(node, agent)))

/** The transitions of a node whose descriptor the engine's own rule matches to the event. */
const takenBy = (node: Node, event: string): ReadonlyArray<Transition> =>
  node.transitions.flatMap(([descriptor, transitions]) => (matchesEventDescriptor(event, descriptor) ? transitions : []))

/** `true` when a transition's domain holds the parallel state or is it, so it exits every region. */
const exitsRegions = (source: Node, transition: Transition, parallel: Node): boolean =>
  Option.match(domainOf(source, transition), { onNone: () => true, onSome: (domain) => isAtOrBelow(parallel, domain) })

/** Each parallel state above a node, with the nodes of its regions beside the node. */
const besideRegions = (node: Node): ReadonlyArray<{ readonly parallel: Node; readonly nodes: ReadonlyArray<Node> }> =>
  [node, ...ancestorsOf(node)].flatMap((each) => {
    const parent = parentOf(each)
    return parent !== each && parent.type === "parallel"
      ? [{ parallel: parent, nodes: regionsOf(parent).filter((region) => region !== each).flatMap(nodesOf) }]
      : []
  })

/**
 * `true` when a transition of a region beside the agent removes `onDone` in the engine's conflict
 * resolution, as it can by document order. They conflict when their exit sets meet: it has a
 * target, and one of the two exits the regions. A transition that stays in its own region, or a
 * targetless one, runs beside `onDone`.
 */
const beatsOnDone = (node: Node, descriptor: string, parallel: Node, rival: Node, transition: Transition): boolean =>
  (transition.target ?? []).length > 0
  && (exitsRegions(rival, transition, parallel)
    || transitionsFor(node, descriptor).some((onDone) => exitsRegions(node, onDone, parallel)))

/**
 * `true` when an `on` key can take the done event in place of `onDone`: the exact key on the
 * invoking node, which the engine lists first; any matching key on a node below it, as a child
 * selects first; or a matching key beside it that wins the conflict ({@link beatsOnDone}) in
 * either document order. A wildcard on the invoking node cannot: the exact `onDone` candidates
 * come before it, and a total `onDone` takes the event. Nor can an ancestor: the engine reads one
 * only when nothing below selects. A guarded key counts, as a guard can pass.
 */
const isTakenOutsideOnDone = (node: Node, descriptor: string): boolean =>
  Object.hasOwn(node.config.on ?? {}, descriptor)
  || nodesOf(node).slice(1).some((below) => takenBy(below, descriptor).length > 0)
  || besideRegions(node).some(({ nodes, parallel }) =>
    nodes.some((rival) => takenBy(rival, descriptor).some((transition) => beatsOnDone(node, descriptor, parallel, rival, transition)))
  )

/** The findings of one agent invocation. */
const settlementOf = (node: Node, agent: AgentInvocation): ReadonlyArray<SettlementFinding> => {
  const descriptor = `xstate.done.actor.${agent.invoke.id}`
  const invocation = {
    index: agent.index,
    id: agent.invoke.id,
    src: typeof agent.invoke.src === "string" ? agent.invoke.src : `xstate.invoke.${agent.index}.${node.id}`,
  }
  const at = `invocation ${agent.index} ('${invocation.src}', id '${agent.invoke.id}') of state '${node.id}'`
  const path = pathOf(node)
  if (Predicate.isUndefined(agent.invoke.onDone)) {
    return [{ kind: "AgentWithoutSettlement", path, invocation, message: `${at} is agent logic with no onDone` }]
  }
  const transitions = transitionsFor(node, descriptor)
  return [
    ...(isTakenOutsideOnDone(node, descriptor)
      ? [{
        kind: "AgentDoneOutsideOnDone" as const,
        path,
        invocation,
        message: `an 'on' key of state '${node.id}', of a state below it or of a parallel region beside it takes the done event of ${at}`,
      }]
      : []),
    ...(transitions.some(isUnguarded) && transitions.every((transition) => settlementExits(node, transition))
      ? []
      : [{
        kind: "SettlementMustExit" as const,
        path,
        invocation,
        message: `the onDone of ${at} must leave the state on every branch`,
      }]),
  ]
}

/** `true` when the transition has a target and every target is outside the invoking state. */
const settlementExits = (node: Node, transition: Transition): boolean => {
  const targets = transition.target ?? []
  return targets.length > 0 && targets.every((target) => !isAtOrBelow(target, node))
}

// ---------------------------------------------------------------------------------------------
// Stops (NEG-9)
// ---------------------------------------------------------------------------------------------

/** The findings of each action that stops an invoked agent by a literal id. */
const stopFindings = (proof: Proof): ReadonlyArray<SettlementFinding> => {
  const agents = proof.nodes.flatMap((node) => agentsOf(proof, node))
  const ids = HashSet.fromIterable(agents.flatMap((agent) => [agent.invoke.id, ...Option.toArray(agent.invoke.systemId)]))
  return proof.nodes.flatMap((node) =>
    actionsOf(node).flatMap((action) => {
      const target = stopTarget(proof.machine, action)
      return Option.isSome(target) && HashSet.has(ids, target.value)
        ? [{
          kind: "StopsInvokedAgent" as const,
          path: pathOf(node),
          message: `an action of state '${node.id}' stops the invoked agent '${target.value}', which ends it with no settlement`,
        }]
        : []
    })
  )
}

/** Every action a node names: on entry, on exit and on its transitions. */
const actionsOf = (node: Node): ReadonlyArray<Action<unknown, EventObject>> => [
  ...node.entry,
  ...node.exit,
  ...movesOf(node).flatMap((transition) => Array.from(transition.actions)),
]

/** The literal id an action stops: the action's own, or that of the implementation it names. */
const stopTarget = (machine: ProvableMachine, action: Action<unknown, EventObject>): Option.Option<string> =>
  Option.firstSomeOf(
    [...implementationOf(machine, action), action].filter(Predicate.isObjectKeyword).map(stopTargetOf)
  ).pipe(Option.filter(Predicate.isString))

/** The implementation a named action resolves to, as a list of none or one. */
const implementationOf = (machine: ProvableMachine, action: Action<unknown, EventObject>): ReadonlyArray<unknown> => {
  const name: unknown = Predicate.hasProperty(action, "type") ? action.type : action
  const actions: unknown = Predicate.hasProperty(machine.implementations, "actions") ? machine.implementations.actions : {}
  return typeof name === "string" && Predicate.isObject(actions) && Object.hasOwn(actions, name)
    ? [Reflect.get(actions, name)]
    : []
}

// ---------------------------------------------------------------------------------------------
// Moves and entry
// ---------------------------------------------------------------------------------------------

/** Every transition of a node, its state `onDone` and its `always` included. */
const movesOf = (node: Node): ReadonlyArray<Transition> => [
  ...node.transitions.flatMap(([, transitions]) => transitions),
  ...node.always,
]

/** The descriptor prefix of a compound or parallel state's completion. */
const stateDone = "xstate.done.state."

/** `true` for a state `onDone` transition, which fires on the node's completion, not on a move. */
const isCompletion = (transition: Transition): boolean => transition.eventType.startsWith(stateDone)

/** `true` for an atomic state; the type proof's `atomic` kind. */
const isAtomic = (node: Node): boolean => node.type === "atomic"

/** The child nodes that are not history states. */
const regionsOf = (node: Node): ReadonlyArray<Node> => Object.values(node.states).filter((child) => child.type !== "history")

/** The nodes that entering `node` activates: itself, its initial chain, or every region. */
const entryOf = (node: Node): ReadonlyArray<Node> => {
  if (node.type === "parallel") return [node, ...regionsOf(node).flatMap(entryOf)]
  return node.type === "compound" ? [node, ...node.initial.target.flatMap(entryOf)] : [node]
}

/** The parent of a node; the node itself for the root. */
const parentOf = (node: Node): Node => Option.getOrElse(node.parent, () => node)

/** The nodes above a node, the nearest first, the root last. */
const ancestorsOf = (node: Node): ReadonlyArray<Node> =>
  Option.match(node.parent, { onNone: () => [], onSome: (parent) => [parent, ...ancestorsOf(parent)] })

/** The nodes below `node` that are no history state, `node` left out. */
const belowOf = (node: Node): ReadonlyArray<Node> => nodesOf(node).slice(1).filter((each) => each.type !== "history")

/** The atomic and final states that entering `target` can activate. */
const leavesOf = (target: Node): ReadonlyArray<Node> =>
  (target.type === "history" ? belowOf(parentOf(target)) : entryOf(target)).filter((node) => isAtomic(node) || node.type === "final")

// ---------------------------------------------------------------------------------------------
// Progress (S8)
// ---------------------------------------------------------------------------------------------

/** `true` when entering `target` leaves the atomic state: the type proof's `TargetLeaves`. */
const targetLeaves = (target: Node, state: Node): boolean => {
  if (target.type === "history") return !isAtOrBelow(state, parentOf(target))
  if (target === state) return false
  return !isAtOrBelow(state, target) || !entryOf(target).includes(state)
}

/** `true` when a set of transitions guarantees that the state is left: one is unguarded, and all leave it. */
const setLeaves = (transitions: ReadonlyArray<Transition>, state: Node): boolean =>
  transitions.some(isUnguarded) && transitions.every((transition) => transitionLeaves(transition, state))

/** `true` when the transition has targets and every one of them leaves the state. */
const transitionLeaves = (transition: Transition, state: Node): boolean => {
  const targets = transition.target ?? []
  return targets.length > 0 && targets.every((target) => targetLeaves(target, state))
}

/**
 * `true` when an `after` delay is sure to fire: a finite number, or a name that the machine's
 * delays resolve to one or to a `finiteDelay` wrapper. A name with no implementation, infinity
 * and a plain function may never fire, so such an `after` guarantees nothing, whatever target it
 * has.
 */
const delayFires = (proof: Proof, delay: number | string): boolean =>
  typeof delay === "string" ? Option.exists(lookupDelay(proof.machine.implementations, delay), isFiniteDelay) : isFiniteDelay(delay)

/** `true` when the node's own invocations or timed or eventless transitions guarantee that the state is left. */
const guarantees = (proof: Proof, node: Node, state: Node): boolean =>
  agentsOf(proof, node).some((agent) => agent.genuine && Predicate.isNotUndefined(agent.invoke.onDone))
  || setLeaves(node.always, state)
  || node.after.filter((transition) => delayFires(proof, transition.delay)).map((transition) => transition.eventType)
    .some((descriptor) => setLeaves(transitionsFor(node, descriptor), state))

/** A `NoProgressGuarantee` for each non-final atomic state that nothing is sure to leave. */
const progressFindings = (proof: Proof): ReadonlyArray<SettlementFinding> =>
  proof.nodes.filter(isAtomic).flatMap((state) =>
    [state, ...ancestorsOf(state)].some((node) => guarantees(proof, node, state))
      ? []
      : [{
        kind: "NoProgressGuarantee" as const,
        path: pathOf(state),
        message: `nothing guarantees that '${state.id}' is left: add a targeted after with a finite delay, an always with an unguarded fallback, or an agent invocation`,
      }]
  )

// ---------------------------------------------------------------------------------------------
// Fixed point
// ---------------------------------------------------------------------------------------------

/** One edge of a fixed point: `from` is reached once one of `to` is, or all of them with `all`. */
interface Edge {
  /** The tokens the edge reaches. */
  readonly from: ReadonlyArray<string>
  /** The tokens that decide it. */
  readonly to: ReadonlyArray<string>
  /** `true` when every token of `to` must be reached, not one. */
  readonly all?: boolean
}

/** The tokens the edges reach from `reached`, which is the least fixed point. */
const reach = (edges: ReadonlyArray<Edge>, reached: HashSet.HashSet<string>): HashSet.HashSet<string> => {
  const fired = edges.flatMap((edge) => {
    const decided = edge.all === true
      ? edge.to.every((token) => HashSet.has(reached, token))
      : edge.to.some((token) => HashSet.has(reached, token))
    return decided ? edge.from.filter((token) => !HashSet.has(reached, token)) : []
  })
  return fired.length === 0 ? reached : reach(edges, HashSet.union(reached, HashSet.fromIterable(fired)))
}

// ---------------------------------------------------------------------------------------------
// Livelock (S25)
// ---------------------------------------------------------------------------------------------

/**
 * The targets of the `always` fallback that fires for the state when every guard is false: the
 * first unguarded member of the nearest `always` set with one, from the state up. None when no
 * set has one, or when it does not leave the state: the snapshot then stays as it is, and the
 * engine stops selecting eventless transitions, so the state rests.
 */
const fallbackOf = (state: Node): Option.Option<ReadonlyArray<Node>> =>
  Option.flatMap(
    Option.firstSomeOf([state, ...ancestorsOf(state)].map((node) => Option.fromNullishOr(node.always.find(isUnguarded)))),
    (first) => (transitionLeaves(first, state) ? Option.some(first.target ?? []) : Option.none())
  )

/** A `Livelock` for each atomic state whose fallbacks never reach a state that rests. */
const livelockFindings = (proof: Proof): ReadonlyArray<SettlementFinding> => {
  const states = proof.nodes.filter(isAtomic)
  const resting = [
    ...proof.nodes.filter((node) => node.type === "final"),
    ...states.filter((state) => Option.isNone(fallbackOf(state))),
  ]
  const edges = states.flatMap((state) =>
    Option.match(fallbackOf(state), {
      onNone: () => [],
      onSome: (targets) => [{ from: [pathOf(state)], to: targets.flatMap(leavesOf).map(pathOf), all: true }],
    })
  )
  const escaped = reach(edges, HashSet.fromIterable(resting.map(pathOf)))
  return states.filter((state) => !HashSet.has(escaped, pathOf(state))).map((state) => ({
    kind: "Livelock" as const,
    path: pathOf(state),
    message: `'${state.id}' can loop through unguarded always transitions for ever`,
  }))
}

// ---------------------------------------------------------------------------------------------
// Reach-final (S7, S23.1)
// ---------------------------------------------------------------------------------------------

/** The token of a node's completion. */
const done = (node: Node): string => `\\done:${pathOf(node)}`

/** What a history state can enter: its default target and any state its parent can hold. */
const historyTargets = (proof: Proof, node: Node): ReadonlyArray<Node> => {
  const parent = parentOf(node)
  return [...defaultTarget(proof, node, parent), ...(node.history === "deep" ? belowOf(parent) : regionsOf(parent))]
}

/** A history state's written default target: a `#id`, or a path below its parent. */
const defaultTarget = (proof: Proof, node: Node, parent: Node): ReadonlyArray<Node> =>
  Option.match(Option.filter(node.target, (target) => target !== ""), {
    onNone: () => [],
    onSome: (target) => {
      const paths = target.startsWith("#")
        ? [Option.map(HashMap.get(proof.machine.idMap, target.slice(1)), (each) => each as unknown as Node)]
        : [Option.fromNullishOr(target.split(".").reduce<Node | undefined>((each, key) => each?.states[key], parent))]
      return paths.flatMap(Option.toArray)
    },
  })

/** The edges of a node's structure: entry, region, completion by a final state, or history. */
const structureEdges = (proof: Proof, node: Node): ReadonlyArray<Edge> => {
  if (node.type === "compound") return [{ from: [pathOf(node)], to: node.initial.target.map(pathOf) }]
  if (node.type === "parallel") return [{ from: [pathOf(node)], to: regionsOf(node).map(pathOf) }]
  if (node.type === "final") return [{ from: [pathOf(node)], to: [done(parentOf(node))] }]
  return node.type === "history" ? [{ from: [pathOf(node)], to: historyTargets(proof, node).map(pathOf) }] : []
}

/** The targets of a node's transitions outside `region`, from every node at or below it. */
const exitTargets = (region: Node): ReadonlyArray<Node> =>
  nodesOf(region).flatMap((node) => movesOf(node).flatMap((transition) => transition.target ?? []))
    .filter((target) => !isAtOrBelow(target, region))

/**
 * The reach graph without the region edges, which need to know which regions complete. A
 * node's transitions move it and every node below it, a completion goes to its `onDone`
 * targets, and a sibling region's move out of its region leaves the other regions.
 */
const baseEdges = (proof: Proof): ReadonlyArray<Edge> =>
  proof.nodes.flatMap((node) => {
    const below = nodesOf(node).map(pathOf)
    const moves = movesOf(node).filter((transition) => !isCompletion(transition)).flatMap((transition) => transition.target ?? [])
    const completions = movesOf(node).filter(isCompletion).flatMap((transition) => transition.target ?? [])
    return [
      { from: below, to: moves.map(pathOf) },
      { from: [done(node)], to: completions.map(pathOf) },
      ...structureEdges(proof, node),
      ...(node.type === "parallel"
        ? regionsOf(node).map((region) => ({
          from: nodesOf(node).slice(1).filter((each) => !isAtOrBelow(each, region)).map(pathOf),
          to: exitTargets(region).map(pathOf),
        }))
        : []),
    ]
  })

/** `true` when the node can complete: a compound state's initial state reaches its completion inside it, and a parallel state's regions all can. */
const isCompletable = (proof: Proof, node: Node): boolean => {
  if (node.type === "parallel") return regionsOf(node).every((region) => isCompletable(proof, region))
  if (node.type !== "compound") return false
  const inside = HashSet.fromIterable(nodesOf(node).flatMap((each) => [pathOf(each), done(each)]))
  const isInside = (token: string) => HashSet.has(inside, token)
  const edges = [...baseEdges(proof), ...regionEdges(proof, node)].map((edge) => ({
    from: edge.from.filter(isInside),
    to: edge.to.filter(isInside),
  }))
  const reached = reach(edges, HashSet.make(done(node)))
  return node.initial.target.some((target) => HashSet.has(reached, pathOf(target)))
}

/** For each parallel state below `node` whose regions all complete: each region's completion completes it. */
const regionEdges = (proof: Proof, node: Node): ReadonlyArray<Edge> =>
  nodesOf(node).filter((each) => each.type === "parallel" && isCompletable(proof, each)).map((parallel) => ({
    from: regionsOf(parallel).map(done),
    to: [done(parallel)],
  }))

/** A `CannotReachFinal` for each stuck state, and a `RegionCannotComplete` for each region around one. */
const reachFindings = (proof: Proof): ReadonlyArray<SettlementFinding> => {
  const root = proof.nodes[0]
  if (root === undefined) return []
  const reached = reach([...baseEdges(proof), ...regionEdges(proof, root)], HashSet.make(done(root)))
  const stuck = proof.nodes.slice(1).filter((node) =>
    (isAtomic(node) || node.type === "compound" || node.type === "parallel") && !HashSet.has(reached, pathOf(node))
  )
  const regions = proof.nodes.filter((node) => node.type === "parallel" && stuck.some((each) => isAtOrBelow(each, node)))
    .flatMap(regionsOf)
    .filter((region) => !isCompletable(proof, region))
  return [
    ...stuck.map((node) => ({
      kind: "CannotReachFinal" as const,
      path: pathOf(node),
      message: `no final state of the machine is reachable from '${node.id}'`,
    })),
    ...regions.map((region) => ({
      kind: "RegionCannotComplete" as const,
      path: pathOf(region),
      message: `the region '${region.id}' cannot reach a final state of its own`,
    })),
  ]
}

// ---------------------------------------------------------------------------------------------
// Cycles through agent states (S16)
// ---------------------------------------------------------------------------------------------

/** One way the machine's atomic configuration moves: from each leaf of `from` to each of `to`. */
interface Step {
  /** The leaves that can be active when the transition fires. */
  readonly from: ReadonlyArray<Node>
  /** The leaves it can enter. */
  readonly to: ReadonlyArray<Node>
  /** The nodes the transition exits and enters when one of `to` is active: those strictly below this one. */
  readonly domain: Option.Option<Node>
  /** The transition. */
  readonly transition: Transition
}

/** `true` when the transition's meta bounds a cycle: a counter on a guarded edge, or a person's event. */
const isBounded = (transition: Transition): boolean => {
  const meta: unknown = transition.meta
  return Predicate.hasProperty(meta, "person") && meta.person === true
    || (Predicate.hasProperty(meta, "ranking") && typeof meta.ranking === "string" && meta.ranking !== "" && !isUnguarded(transition))
}

/**
 * The transition's domain, as the engine computes it (`getTransitionDomain`): the source when
 * the transition does not re-enter and every target is at or below it, else the nearest node
 * above the source that holds every target. None for a re-entering root transition. A history
 * target stands for its own position, so the domain may be wider than the engine's for a
 * recorded state: more is exited, and the check stays on the safe side.
 */
const domainOf = (source: Node, transition: Transition): Option.Option<Node> => {
  const targets = transition.target ?? []
  if (!transition.reenter && targets.every((target) => isAtOrBelow(target, source))) return Option.some(source)
  const holder = ancestorsOf(source).find((ancestor) => targets.every((target) => isAtOrBelow(target, ancestor) && target !== ancestor))
  if (holder !== undefined) return Option.some(holder)
  return transition.reenter ? Option.none() : Option.some(ancestorsOf(source).at(-1) ?? source)
}

/** `true` when `node` is strictly below the domain, so the transition exits it when it is active. */
const isInsideDomain = (node: Node, domain: Option.Option<Node>): boolean =>
  Option.match(domain, { onNone: () => true, onSome: (each) => isAtOrBelow(node, each) && node !== each })

/** The atomic and final states at or below a node. */
const leavesBelow = (node: Node): ReadonlyArray<Node> => nodesOf(node).filter((each) => isAtomic(each) || each.type === "final")

/** The states in a region beside `source` that the transition's exit also takes: each parallel state it leaves. */
const besideOf = (source: Node, domain: Option.Option<Node>): ReadonlyArray<Node> =>
  [source, ...ancestorsOf(source)].flatMap((node) => {
    const parent = parentOf(node)
    const leaves = parent !== node && parent.type === "parallel" && Option.match(domain, {
      onNone: () => true,
      onSome: (each) => isAtOrBelow(parent, each),
    })
    return leaves ? regionsOf(parent).filter((region) => region !== node).flatMap(leavesBelow) : []
  })

/** The leaves the regions beside a target default to, for each parallel state the transition enters. */
const defaultEntered = (target: Node, domain: Option.Option<Node>): ReadonlyArray<Node> =>
  [target, ...ancestorsOf(target)].flatMap((node) => {
    const parent = parentOf(node)
    return parent !== node && parent.type === "parallel" && isInsideDomain(parent, domain)
      ? regionsOf(parent).filter((region) => region !== node).flatMap(leavesOf)
      : []
  })

/** The steps of one transition of `source`. */
const stepOf = (source: Node, transition: Transition): ReadonlyArray<Step> => {
  const targets = transition.target ?? []
  if (targets.length === 0) return []
  const domain = domainOf(source, transition)
  const from = isCompletion(transition) ? leavesBelow(source).filter((leaf) => leaf.type === "final") : leavesBelow(source)
  return [{
    from: [...from, ...besideOf(source, domain)],
    to: [...targets.flatMap(leavesOf), ...targets.flatMap((target) => defaultEntered(target, domain))],
    domain,
    transition,
  }]
}

/** The states holding an agent that a step enters when it activates `leaf`. */
const entersAgents = (proof: Proof, leaf: Node, domain: Option.Option<Node>): ReadonlyArray<Node> =>
  [leaf, ...ancestorsOf(leaf)].filter((node) => agentsOf(proof, node).length > 0 && isInsideDomain(node, domain))

/** The paths of the leaves reachable from `start` over `steps`, `start` included. */
const reachableFrom = (steps: ReadonlyArray<Step>, start: Node): HashSet.HashSet<string> =>
  reach(
    steps.flatMap((step) => step.from.map((leaf) => ({ from: step.to.map(pathOf), to: [pathOf(leaf)] }))),
    HashSet.make(pathOf(start))
  )

/**
 * An `UnrankedAgentCycle` for each state holding an agent that an undeclared step enters from a
 * leaf reachable, over undeclared steps only, from the leaf it enters. Removing the declared
 * steps first makes the rule exact: a cycle stays only when no step of it declares a bound.
 */
const cycleFindings = (proof: Proof): ReadonlyArray<SettlementFinding> => {
  const steps = proof.nodes.flatMap((node) => movesOf(node).flatMap((transition) => stepOf(node, transition)))
    .filter((step) => !isBounded(step.transition))
  const cycles = steps.flatMap((step) =>
    step.to.flatMap((leaf) => {
      const reachable = reachableFrom(steps, leaf)
      return step.from.some((from) => HashSet.has(reachable, pathOf(from)))
        ? entersAgents(proof, leaf, step.domain).map((holder) => ({ holder, leaf, step }))
        : []
    })
  )
  return proof.nodes.filter((node) => cycles.some((cycle) => cycle.holder === node)).map((node) => ({
    kind: "UnrankedAgentCycle" as const,
    path: pathOf(node),
    message: `a cycle re-enters the agent state '${node.id}' with no declared bound: give a guarded edge of it meta.ranking, or an event from a person meta.person`,
  }))
}

// ---------------------------------------------------------------------------------------------
// Certificates (S12, AUDIT-2, AUDIT-3)
// ---------------------------------------------------------------------------------------------

/**
 * The library version a certificate's hash covers. It equals `package.json`, as a library test
 * checks: the graph entry point reads no file.
 *
 * @since 0.4.0
 * @category Settlement
 */
export const libraryVersion = "0.4.1"

/**
 * What an explorer reports to {@link certify}: the states it visited, and optionally its verdict.
 * The result of `explore` fits as it is: a run that returns has passed, so no verdict means
 * `"proved"`. A failed Effect passes through {@link certify}, and no certificate exists for it; a
 * caller that wants a certificate that says `"failed"` maps such a failure to a verdict.
 *
 * @since 0.4.0
 * @category Settlement
 */
export interface CertificateExploration {
  /** How many states the explorer visited. */
  readonly explored: number
  /** `"failed"` when the exploration did not prove the machine; `"proved"`, or absent, when it did. */
  readonly verdict?: "proved" | "failed"
}

/**
 * What a certificate's hash covers beside the machine and the library version.
 *
 * @since 0.4.0
 * @category Settlement
 */
export interface CertificateInputs {
  /** The module closure of the machine (`moduleClosure`); a hash without one covers no code. */
  readonly modules: Arr.NonEmptyReadonlyArray<CertificateModule>
}

/**
 * One machine of a certify config: the machine, and the world its explorer runs in.
 *
 * @since 0.4.0
 * @category Settlement
 */
export interface CertifyTarget {
  /** The machine to certify. */
  readonly machine: AnyStateMachine
  /** What `explore` runs it against. */
  readonly environment: ExploreEnvironment
  /**
   * The services the machine's guards and actions need, which the bin provides to `explore` for
   * this machine alone: each machine builds its own, so no service state crosses from one
   * machine's run to the next. A `never` output type takes a layer of any services.
   */
  readonly layer?: Layer.Layer<never, unknown>
}

/**
 * The default export of a config module, which the `xstate-effect-certify` bin loads. The hash
 * covers the module closure of that config module, so it has to import the machines and their
 * environments. The certificate module stays out of the closure, so a machine may import it.
 *
 * @example
 * ```ts
 * export default {
 *   output: "certificate.ts",
 *   machines: { leaf: { machine: leaf, environment } },
 * } satisfies CertifyConfig
 * ```
 *
 * @since 0.4.0
 * @category Settlement
 */
export interface CertifyConfig {
  /** The certificate module's path, relative to the config module. */
  readonly output: string
  /** Each machine by the name it takes as an export of the certificate module; at least one. */
  readonly machines: Readonly<Record<string, CertifyTarget>>
}

/**
 * Generates a machine's certificate (AUDIT-2): every state path, every edge, the explorer's count,
 * the content hash and the verdict, which says `"proved"` only when both {@link proveSettlement}
 * and the explorer do and the hash covers every module a real import names: an `unresolved:`
 * module has no text, so no edit to that file could change the hash. The output is deterministic: lists sort in code-unit order, never by
 * locale, and the hash sees sorted keys and `\n` line endings, so it is byte-identical across
 * runs. A function hashes by its source text, so run a certificate and its check under one
 * runtime: a transpiler can print a function differently. A machine that keeps a definition error
 * has no certificate, and fails with {@link SettlementProofError}; a value the hash cannot read
 * fails with {@link CertificateUnreadableValue}.
 *
 * @example
 * ```ts
 * const certificate = Effect.gen(function*() {
 *   const modules = yield* moduleClosure("src/machine.ts")
 *   return yield* certify(machine, explore, { modules })
 * })
 * ```
 *
 * @since 0.4.0
 * @category Settlement
 */
export const certify = <E, R>(
  machine: AnyStateMachine,
  explore: (machine: AnyStateMachine) => Effect.Effect<CertificateExploration, E, R>,
  inputs: CertificateInputs
): Effect.Effect<SettlementCertificate, E | SettlementProofError | CertificateUnreadableValue, R> =>
  Effect.gen(function*() {
    const invalid = yield* definitionFindings(machine)
    if (invalid.length > 0) {
      return yield* new SettlementProofError({
        message: `Machine '${machine.id}' has no certificate: ${invalid[0]?.message ?? ""}`,
        machineId: machine.id,
        findings: invalid,
      })
    }
    const nodes = isStateNode(machine.root) ? nodesOf(machine.root) : []
    const states = sortedUnique(nodes.slice(1).map(pathOf))
    const edges = sortedUnique(nodes.flatMap(edgesOf))
    const exploration = yield* explore(machine)
    const proved = yield* Effect.isSuccess(proveSettlement(machine))
    const complete = unresolvedImports(inputs.modules).length === 0
    return {
      states,
      edges,
      explored: exploration.explored,
      hash: yield* certificateHash(machine, states, edges, inputs.modules, libraryVersion),
      verdict: proved && exploration.verdict !== "failed" && complete ? "proved" : "failed",
    }
  })

/**
 * Checks a certificate by deriving it again (AUDIT-3, decision 16): it runs the explorer and the
 * proof, and compares every field, so a hand-edited verdict fails although its hash still matches.
 * It never trusts the certificate, and fails with {@link CertificateCheckError} on any difference.
 *
 * @since 0.4.0
 * @category Settlement
 */
export const checkCertificate = <E, R>(
  machine: AnyStateMachine,
  certificate: SettlementCertificate,
  explore: (machine: AnyStateMachine) => Effect.Effect<CertificateExploration, E, R>,
  inputs: CertificateInputs
): Effect.Effect<void, E | SettlementProofError | CertificateCheckError | CertificateUnreadableValue, R> =>
  Effect.gen(function*() {
    const derived = yield* certify(machine, explore, inputs)
    const mismatches = certificateFields.flatMap((field) => {
      const recorded = simpleStringify(certificate[field])
      const fresh = simpleStringify(derived[field])
      return recorded === fresh ? [] : [{ field, recorded, derived: fresh }]
    })
    if (mismatches.length === 0) return
    const names = mismatches.map((each) => each.field).join(", ")
    return yield* new CertificateCheckError({
      message: `The certificate of machine '${machine.id}' differs from the analysis in: ${names}`,
      machineId: machine.id,
      mismatches,
    })
  })

/** The fields of a certificate, in the order a generated one holds them. */
const certificateFields = ["states", "edges", "explored", "hash", "verdict"] as const

/** The list sorted in code-unit order, which no locale changes, each entry once. */
const sortedUnique = (list: ReadonlyArray<string>): ReadonlyArray<string> => Arr.sort(Arr.dedupe(list), Order.String)

/** The edges a node writes, as `Certified` reads them from the config. */
const edgesOf = (node: Node): ReadonlyArray<string> => {
  const source = shown(pathOf(node))
  const config = node.config
  return [
    ...writtenMoves(node).flatMap(([label, written]) =>
      movesWritten(written).flatMap((move) =>
        targetsWritten(move).map((target) => `${source}: ${label} -> ${targetShown(node, target)}`)
      )
    ),
    ...(node.type === "history" && Predicate.isString(config.target)
      ? [`${source}: history -> ${shown(historyPath(node, config.target))}`]
      : []),
  ]
}

/** Each transition member of a node's config as written, with its edge label. */
const writtenMoves = (node: Node): ReadonlyArray<readonly [string, unknown]> => {
  const config = node.config
  const invocations: ReadonlyArray<unknown> = Arr.ensure(config.invoke ?? [])
  return [
    ...Object.entries(config.on ?? {}).map(([key, value]) => [`on ${key}`, value] as const),
    ...Object.entries(config.after ?? {}).map(([key, value]) => [`after ${key}`, value] as const),
    ["always", config.always],
    ["onDone", config.onDone],
    ...invocations.flatMap((invocation, index) =>
      invocationHandlers.flatMap((handler) =>
        Predicate.hasProperty(invocation, handler) ? [[`invoke.${index}.${handler}`, invocation[handler]] as const] : []
      )
    ),
  ]
}

/** The transition members of an invocation. */
const invocationHandlers = ["onDone", "onError", "onSnapshot"] as const

/** A transition member as written (a target, an object, a list of either) as single moves; `undefined` is none. */
const movesWritten = (written: unknown): ReadonlyArray<unknown> =>
  Predicate.isUndefined(written) ? [] : Array.isArray(written) ? written.flatMap(movesWritten) : [written]

/** The targets of one move as written, one each; a targetless move gives `""`. */
const targetsWritten = (move: unknown): ReadonlyArray<string> => {
  const target: unknown = Predicate.isString(move) ? move : Predicate.hasProperty(move, "target") ? move.target : ""
  const list: ReadonlyArray<unknown> = Predicate.isUndefined(target) ? [""] : Arr.ensure(target)
  return list.length === 0 ? [""] : list.filter(Predicate.isString)
}

/** One written target as an edge shows it; `(none)` for no target. */
const targetShown = (node: Node, target: string): string =>
  target === "" ? "(none)" : shown(pathOfTarget(node, target))

/** The path of the state a target names from `node`, as the engine resolves it; a valid machine always resolves it. */
const pathOfTarget = (node: Node, target: string): string =>
  Option.match(node.machine, {
    onNone: () => target,
    onSome: (machine) =>
      Result.match(resolveTarget(machine, node, Option.some([target])), {
        onFailure: () => target,
        onSuccess: Option.match({ onNone: () => target, onSome: (list) => list.map(pathOf).join() }),
      }),
  })

/** The path a history default names: below the history state's parent, unless it names an id. */
const historyPath = (node: Node, target: string): string => {
  if (target.startsWith("#")) return pathOfTarget(node, target)
  const parent = pathOf(parentOf(node))
  return parent === "" ? target : `${parent}.${target}`
}

/** A path as an edge shows it: `(root)` for the root. */
const shown = (path: string): string => (path === "" ? "(root)" : path)

/** A function's or a source's text with `\n` line endings. */
const withLf = (text: string): string => text.replaceAll("\r\n", "\n")

/**
 * A value as JSON that nothing but its content decides: keys sorted, functions as their source
 * text (a `finiteDelay` wrapper as the source of the function it wraps and its bound), a `Map` or a `Set` sorted by its entries' text, so their insertion order changes nothing,
 * a `Date` and a `RegExp` by what they hold, and enumerable symbol keys under `[symbols]`. A
 * machine counts by its config and implementations, not its built tree. A Schema counts as a
 * mark: its object can hold memoized state, and its source is in the module closure. `ancestors`
 * stops a cycle. It fails on an object with nothing to read rather than hash it as `{}`. The
 * explorer reads a context field through this one form too.
 *
 * @since 0.4.0
 * @category Settlement
 */
export const canonical = (
  value: unknown,
  ancestors: ReadonlyArray<object> = [],
  at = "(root)"
): Result.Result<unknown, CertificateUnreadableValue> => {
  if (Predicate.isFunction(value)) return canonicalFunction(value)
  if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "number") return Result.succeed(String(value))
  if (!Predicate.isObjectKeyword(value)) return Result.succeed(value)
  if (ancestors.includes(value)) return Result.succeed("[cycle]")
  if (Schema.isSchema(value)) return Result.succeed("[schema]")
  const below = [...ancestors, value]
  if (isStateMachine(value)) return canonical({ config: value.config, implementations: value.implementations }, below, at)
  if (Array.isArray(value)) return Result.all(value.map((each, index) => canonical(each, below, `${at}.${index}`)))
  if (Predicate.isDate(value)) return Result.succeed(`[date] ${value.getTime()}`)
  if (Predicate.isRegExp(value)) return Result.succeed(`[regexp] ${String(value)}`)
  if (Predicate.isMap(value)) return Result.map(canonicalList(Array.from(value), below, at), (entries) => ["[map]", ...entries])
  if (Predicate.isSet(value)) return Result.map(canonicalList(Array.from(value), below, at), (entries) => ["[set]", ...entries])
  return canonicalObject(value, below, at)
}

/**
 * A function as its source text. A `finiteDelay` wrapper has the same source for every delay, so
 * it counts by the function it wraps and by its bound: the proof's claim that the delay fires
 * rests on both, and a change of either makes a certificate stale.
 */
const canonicalFunction = (value: object): Result.Result<unknown, CertificateUnreadableValue> =>
  Result.succeed(
    Option.match(finiteDelayOf(value), {
      onNone: () => `function ${withLf(String(value))}`,
      onSome: ({ fn, max }) => `finiteDelay max ${max} function ${withLf(String(fn))}`,
    })
  )

/** The canonical form of each entry, sorted by its text: for a collection whose order means nothing. */
const canonicalList = (
  entries: ReadonlyArray<unknown>,
  ancestors: ReadonlyArray<object>,
  at: string
): Result.Result<ReadonlyArray<unknown>, CertificateUnreadableValue> =>
  Result.map(
    Result.all(entries.map((entry, index) => canonical(entry, ancestors, `${at}.${index}`))),
    (list) => Arr.sort(list, Order.mapInput(Order.String, (each: unknown) => simpleStringify(each)))
  )

/** `true` for an object that only a class can have made, so that its own keys may not be all it holds. */
const isClassInstance = (value: object): boolean => {
  const prototype: unknown = Object.getPrototypeOf(value)
  return Predicate.isNotNullish(prototype) && prototype !== Object.prototype
}

/** An object by its sorted keys, and its symbol keys in a list sorted by text, as two symbols may print alike. */
const canonicalObject = (
  value: object,
  ancestors: ReadonlyArray<object>,
  at: string
): Result.Result<unknown, CertificateUnreadableValue> => {
  const keys = Arr.sort(Object.keys(value), Order.String)
  const symbols = Object.getOwnPropertySymbols(value).filter((symbol) => Object.getOwnPropertyDescriptor(value, symbol)?.enumerable === true)
  if (keys.length === 0 && symbols.length === 0 && isClassInstance(value)) {
    return Result.fail(new CertificateUnreadableValue({ message: `the value at ${at} has nothing that a hash can read`, at }))
  }
  return Result.gen(function*() {
    const entries = yield* Result.all(
      keys.map((key) => Result.map(canonical(Reflect.get(value, key), ancestors, `${at}.${key}`), (each) => [key, each] as const))
    )
    const symbolEntries = symbols.map((symbol): ReadonlyArray<unknown> => [String(symbol), Reflect.get(value, symbol)])
    const listed = symbolEntries.length === 0 ? [] : [["[symbols]", yield* canonicalList(symbolEntries, ancestors, at)] as const]
    return Object.fromEntries([...entries, ...listed])
  })
}

/**
 * The hash of everything a certificate speaks for: the machine's config and implementations, its
 * states and edges, its module closure and the library version. The verdict and the count are
 * outputs, so they stay out: `checkCertificate` compares those by deriving them again.
 *
 * @since 0.4.0
 * @category Settlement
 */
export const certificateHash = (
  machine: AnyStateMachine,
  states: ReadonlyArray<string>,
  edges: ReadonlyArray<string>,
  modules: ReadonlyArray<CertificateModule>,
  version: string
): Effect.Effect<string, CertificateUnreadableValue> =>
  Effect.gen(function*() {
    // Every built machine has `implementations`; `AnyStateMachine` does not list it
    const readable = yield* Effect.fromResult(
      canonical({ config: machine.config, implementations: (machine as ProvableMachine).implementations })
    )
    const sorted = Arr.sort(modules, Order.mapInput(Order.String, (each: CertificateModule) => each.path))
    const text = simpleStringify({
      library: version,
      machine: readable,
      modules: sorted.map((each) => [each.path, withLf(each.source)]),
      states,
      edges,
    })
    const digest = yield* Effect.promise(() => globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
  })
