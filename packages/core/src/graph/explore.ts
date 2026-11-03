/**
 * @since 0.4.0
 * @module graph/explore
 *
 * The generic exhaustive explorer: {@link explore} drives a real machine with the inputs of a
 * declared environment, so every xstate-effect machine gets guarded reachability, which the
 * type proof and the structural proof cannot reach (they count a guard as able to pass). It
 * has no state limit: a caller's timeout bounds it, and fails closed.
 *
 * A state's key is its configuration plus the abstraction of the context fields the machine
 * reads. A Proxy records those reads while the run goes, so the abstraction is derived from the
 * machine; a field read that the environment does not map stops the run. Three things keep a
 * merge of two states under one key honest: that refusal, the congruence check at each merged
 * state, and the exact value of each declared ranking in the key.
 *
 * It computes each step as the pure helpers do, through an inert actor scope, so no custom
 * action runs and no actor starts. A custom action cannot change a snapshot, so what its body
 * reads cannot steer the machine; what its params read is recorded. Upstream has no counterpart.
 */
import { Array as Arr, type Duration, Effect, MutableHashMap, MutableHashSet, MutableList, MutableRef, Option, Order, Predicate, Result } from "effect"
import { ActorScope, type ActorScopeService } from "../ActorLogic.js"
import type { TransitionError, InitializationError } from "../Errors.js"
import type { EventObject } from "../Event.js"
import { hasAgentBrand } from "../internal/agentBrand.js"
import { ContextReads, rawContext, recordingContext } from "../internal/contextReads.js"
import type { AnyMachineSnapshot } from "../Snapshot.js"
import * as Snap from "../Snapshot.js"
import { resolveReferencedActor, type SpawningMachine } from "../spawn.js"
import type { AnyStateMachine } from "../StateMachine.js"
import { createInertActorScope } from "../testing/getNextSnapshot.js"
import type { TransitionDefinition } from "../Types.js"
import {
  CannotReachFinal,
  CongruenceViolation,
  ExploreTimeout,
  InvalidRanking,
  UnabstractedField,
  UndrivenInput,
  UnrankedCycle,
} from "./errors.js"
import { canonical } from "./settlement.js"
import { isUnguarded, simpleStringify } from "./utils.js"

/**
 * What an abstraction function gives. The value enters the state's key as it is, so the range
 * of the function bounds the state space.
 *
 * @since 0.4.0
 * @category Explore
 */
export type AbstractValue = string | number | boolean | null

/**
 * An input that is no event: it changes the snapshot itself, as a process restart does. It runs
 * in an inert actor scope. `label` identifies it among the inputs of a state.
 *
 * @since 0.4.0
 * @category Explore
 */
export interface ExploreStep {
  /** Its name in traces and edges. */
  readonly label: string
  /** The snapshot after the input. */
  readonly step: (snapshot: AnyMachineSnapshot) => Effect.Effect<AnyMachineSnapshot, unknown, ActorScope>
}

/**
 * One input of the environment: an event for the machine, or a {@link ExploreStep}.
 *
 * @since 0.4.0
 * @category Explore
 */
export type ExploreInput = EventObject | ExploreStep

/**
 * The inputs of one kind that the environment offers in a state. It reads the snapshot as the
 * environment, outside the machine, so what it reads records nothing.
 *
 * @since 0.4.0
 * @category Explore
 */
export type ExploreDriver = (snapshot: AnyMachineSnapshot) => ReadonlyArray<ExploreInput>

/**
 * What a machine's world can do to it. There is no field that exempts a context field: an
 * object that carries one has it ignored.
 *
 * @since 0.4.0
 * @category Explore
 */
export interface ExploreEnvironment {
  /**
   * Every kind of input the world has. A kind the run does not drive fails it. An event of the
   * kind `person` is the only input that bounds a cycle without a counter (S16).
   */
  readonly catalogue: ReadonlyArray<string>
  /** The driver of each kind. */
  readonly inputs: Readonly<Record<string, ExploreDriver>>
  /**
   * The finite class of each field the machine may read. The fields actually read are the
   * abstraction; one read with no entry here stops the run. A declared ranking keys by its
   * exact value, whatever its entry gives, as a merge of two of its values would hide its fall.
   */
  readonly abstraction: Readonly<Record<string, (value: unknown) => AbstractValue>>
  /** How long the run may take; past it, the run fails closed. */
  readonly timeout: Duration.Input
  /** The machine's input. */
  readonly input?: unknown
  /** Whether a run that ended here stalled, which never counts as final. */
  readonly stalled?: (snapshot: AnyMachineSnapshot) => boolean
}

/**
 * One step of a trace.
 *
 * @since 0.4.0
 * @category Explore
 */
export interface ExploreTraceStep {
  /** The kind of the input; `initial` for the first step of a trace. */
  readonly kind: string
  /** The input: an event as JSON, a step's label; `""` for the first step of a trace. */
  readonly input: string
  /** The key of the state the input led to. */
  readonly key: string
}

/**
 * The way to a state from the initial state, oldest step first.
 *
 * @since 0.4.0
 * @category Explore
 */
export type ExploreTrace = ReadonlyArray<ExploreTraceStep>

/**
 * One edge of the explored graph.
 *
 * @since 0.4.0
 * @category Explore
 */
export interface ExploreEdge {
  /** The key of the state the input was offered in. */
  readonly from: string
  /** The kind of the input. */
  readonly kind: string
  /** The input: an event as JSON, a step's label. */
  readonly input: string
  /** The key of the state it led to. */
  readonly to: string
  /** Whether it started an agent invocation, which buys a new budget. */
  readonly reentersAgent: boolean
}

/**
 * What a passed run proved it over.
 *
 * @since 0.4.0
 * @category Explore
 */
export interface ExploreResult {
  /** The states explored: the distinct keys. */
  readonly explored: number
  /** The keys, in the order the run reached them. */
  readonly keys: ReadonlyArray<string>
  /** The edges, in the order the run took them. */
  readonly edges: ReadonlyArray<ExploreEdge>
  /** The context fields the machine read: the abstraction, derived, in sorted order. */
  readonly abstraction: ReadonlyArray<string>
}

/**
 * Each way a run fails: the proof failed, or the run did not finish. `TransitionError` is a
 * macrostep past `maxIterations`, and `InitializationError` a definition error.
 *
 * @since 0.4.0
 * @category Explore
 */
export type ExploreFailure =
  | UnabstractedField
  | CongruenceViolation
  | UndrivenInput
  | CannotReachFinal
  | UnrankedCycle
  | InvalidRanking
  | ExploreTimeout
  | TransitionError
  | InitializationError

/** A step of the way to a state, linked to the step before it, so a state costs one link. */
interface TraceLink {
  /** The step before it; none for the initial state. */
  readonly previous: Option.Option<TraceLink>
  /** The step. */
  readonly step: ExploreTraceStep
}

/** What one input gave in one state. */
interface Successor {
  /** The input's kind. */
  readonly kind: string
  /** The input's label. */
  readonly input: string
  /** The state it led to. */
  readonly snapshot: AnyMachineSnapshot
  /** The state's key. */
  readonly key: string
}

/** The first state that took a key: what later states of that key are compared with. */
interface Representative {
  /** The state. */
  readonly snapshot: AnyMachineSnapshot
  /** The way to it. */
  readonly trace: TraceLink
  /** What each of its inputs gave. */
  readonly successors: ReadonlyArray<Successor>
}

/** A transition's declaration, as a microstep's inspection event gives it. */
type TakenTransition = TransitionDefinition<unknown, EventObject>

/** What the pass found when it ended before its end: nothing, or a run to start again. */
type RestartPass = typeof restartPass

/** The fixed point's signal: the read set grew, so every key so far misses a field. */
const restartPass = Symbol("restartPass")

/** The inert scope gives each transition's inspection events to nobody; the run reads its microsteps there. */
const recordingScope = (snapshot: AnyMachineSnapshot, taken: (transitions: ReadonlyArray<TakenTransition>) => void): ActorScopeService => {
  const scope = createInertActorScope(snapshot)
  return {
    ...scope,
    system: {
      ...scope.system,
      _sendInspectionEvent: (event) =>
        Effect.sync(() => {
          if (event.type === "@xstate.microstep") taken(event._transitions)
        }),
    },
  }
}

/**
 * The timer events a state holds: each `after` of its active nodes. Each is an input of its
 * own in each state, so a breadth-first run takes the firings in every order (S19). A firing
 * that leaves the state in place stays on offer there, which only adds a self-edge.
 *
 * It reads no delay value: a numeric delay, a `Duration` and a `finiteDelay` wrapper alike may
 * fire at any point, in any order with the others. That covers every value a `finiteDelay`
 * gives within `[0, max]`, so the explorer's verdict holds whatever the delay computes.
 *
 * @example
 * ```ts
 * inputs: { timer: timerFirings }
 * ```
 *
 * @since 0.4.0
 * @category Explore
 */
export const timerFirings: ExploreDriver = (snapshot) =>
  Arr.dedupe(snapshot._nodes.flatMap((node) => node.after.map((after) => after.eventType))).map((type) => ({ type }))

/**
 * A process restart in every state: the snapshot goes through the machine's own persist and
 * restore, as a recovery does (S19).
 *
 * @example
 * ```ts
 * inputs: { restart: processRestart(machine) }
 * ```
 *
 * @since 0.4.0
 * @category Explore
 */
export const processRestart = (machine: AnyStateMachine): ExploreDriver => () => [
  {
    label: "restart",
    step: (snapshot) =>
      Effect.gen(function* () {
        // `AnyStateMachine` types these with `never`: its snapshots are every machine's
        const logic = machine as unknown as Restartable
        return yield* logic.restoreSnapshot(yield* logic.getPersistedSnapshot(snapshot))
      }),
  },
]

/** The two methods a restart calls, as the explorer uses them on any machine. */
interface Restartable {
  /** The persisted form of a snapshot. */
  readonly getPersistedSnapshot: (snapshot: AnyMachineSnapshot) => Effect.Effect<unknown, unknown, ActorScope>
  /** The snapshot of a persisted form. */
  readonly restoreSnapshot: (persisted: unknown) => Effect.Effect<AnyMachineSnapshot, unknown, ActorScope>
}

/** A machine as the explorer drives it. */
interface Drivable {
  /** The initial snapshot. */
  readonly getInitialSnapshot: (input: unknown) => Effect.Effect<AnyMachineSnapshot, InitializationError, unknown>
  /** The next snapshot. */
  readonly transition: (snapshot: AnyMachineSnapshot, event: EventObject) => Effect.Effect<AnyMachineSnapshot, TransitionError, unknown>
}

/** The context services a machine's own transition needs, which the caller provides. */
type Requirements<TMachine> = TMachine extends {
  readonly transition: (...args: never) => Effect.Effect<unknown, unknown, infer R>
}
  ? Exclude<R, ActorScope>
  : never

/**
 * Proves a machine over the state space its environment opens, and gives what it explored.
 * From the initial state it takes every input of every catalogued kind in every state, on the
 * real machine, until no new key appears. It fails when:
 *
 * - the machine reads a context field the abstraction does not map ({@link UnabstractedField});
 * - two merged states have different successors ({@link CongruenceViolation}), which it checks
 *   at each merged state and, where a state's read fields differ from the first state of its
 *   key, at the successors of that state too, once per key and set of differing values, so a
 *   field that grows for ever runs to the timeout, which fails closed;
 * - a catalogued kind has no driver, or never gives an input ({@link UndrivenInput});
 * - an edge that starts an agent invocation lies on a cycle that passes no event of the kind
 *   `person` ({@link UnrankedCycle}). A guarded transition with `meta: { ranking }` keys by the
 *   counter's exact value, so a cycle whose counter truly falls never closes in the graph, and
 *   one that closes has a counter that did not fall along it;
 * - a declared ranking is not a natural number after its transition ({@link InvalidRanking});
 * - a reachable state cannot reach a final state ({@link CannotReachFinal}). In a finite graph
 *   every run that takes each input it is offered infinitely often ends in a closed set of
 *   states, so this also gives AF final under that fairness;
 * - the run passes its timeout ({@link ExploreTimeout}).
 *
 * @example
 * ```ts
 * const result = yield* explore(machine, {
 *   catalogue: ["timer", "person"],
 *   inputs: { timer: timerFirings, person: () => [{ type: "APPROVE" }] },
 *   abstraction: { attempts: (value) => Number(value) },
 *   timeout: "10 seconds",
 * })
 * ```
 *
 * @since 0.4.0
 * @category Explore
 */
export const explore = <TMachine extends AnyStateMachine>(
  machine: TMachine,
  environment: ExploreEnvironment
): Effect.Effect<ExploreResult, ExploreFailure, Requirements<TMachine>> =>
  Effect.gen(function* () {
    const missing = environment.catalogue.find((kind) => !Object.hasOwn(environment.inputs, kind))
    if (missing !== undefined) {
      return yield* new UndrivenInput({ message: `the catalogue lists the input kind '${missing}', and it has no driver`, kind: missing })
    }
    const reads = MutableHashSet.empty<string>()
    const ranked = MutableHashSet.empty<string>()
    const explored = MutableRef.make(0)
    // The timeout interrupts the fiber, so it also ends an eventless loop inside one macrostep
    return yield* Effect.gen(function* () {
      while (true) {
        const passed = yield* explorePass(machine, environment, explored, reads, ranked)
        if (passed !== restartPass) return passed
      }
    }).pipe(
      Effect.timeoutOrElse({
        duration: environment.timeout,
        orElse: () =>
          Effect.suspend(() => {
            const count = MutableRef.get(explored)
            return Effect.fail(new ExploreTimeout({ message: `the run passed its timeout after ${count} states`, explored: count }))
          }),
      })
    )
  }) as Effect.Effect<ExploreResult, ExploreFailure, Requirements<TMachine>>

/**
 * One run of the search with the fields known so far. It gives {@link restartPass} as soon as
 * the read set grows, so a finished pass keyed every state by every field the machine read.
 * The read set only grows, and a machine has a finite set of field names, so passes end.
 */
const explorePass = (
  machine: AnyStateMachine,
  environment: ExploreEnvironment,
  explored: MutableRef.MutableRef<number>,
  reads: MutableHashSet.MutableHashSet<string>,
  ranked: MutableHashSet.MutableHashSet<string>
): Effect.Effect<ExploreResult | RestartPass, ExploreFailure, unknown> =>
  Effect.gen(function* () {
    const known = MutableHashSet.size(reads)
    const knownRanked = MutableHashSet.size(ranked)
    const fields = Arr.sort(Array.from(reads), Order.String)
    const keyOf = stateKey(environment, fields, ranked)
    const drivable = machine as unknown as Drivable
    const nodes = MutableHashMap.empty<string, Representative>()
    const keys = MutableList.make<string>()
    const edges = MutableList.make<ExploreEdge>()
    const links = MutableList.make<readonly [ExploreEdge, TraceLink]>()
    const driven = MutableHashSet.empty<string>()
    const merges = MutableHashSet.empty<string>()
    const queue = MutableList.make<{ readonly snapshot: AnyMachineSnapshot; readonly trace: TraceLink }>()
    const record = (field: string) => {
      MutableHashSet.add(reads, field)
    }

    /** The field a pass that saw new reads stops on, when one has no mapping; the trace ends at the input. */
    const refuseNewReads = (trace: TraceLink) =>
      Effect.gen(function* () {
        const field = Array.from(reads).find((name) => !Object.hasOwn(environment.abstraction, name))
        if (field !== undefined) {
          return yield* new UnabstractedField({
            message: `the machine read the context field '${field}', which the abstraction does not map`,
            field,
            trace: traceOf(trace),
          })
        }
      })

    /** Takes every input of a state. Gives none when a read ended the pass. */
    const successorsOf = (snapshot: AnyMachineSnapshot, trace: TraceLink, key: string) =>
      Effect.gen(function* () {
        const offered = environment.catalogue.flatMap((kind) => environment.inputs[kind]!(snapshot).map((input) => ({ kind, input })))
        const successors = MutableList.make<Successor>()
        for (const { kind, input } of offered) {
          MutableHashSet.add(driven, kind)
          const label = inputLabel(input)
          const taken = MutableList.make<TakenTransition>()
          const scope = recordingScope(snapshot, (transitions) => {
            MutableList.appendAll(taken, transitions)
          })
          const next = yield* runInput(drivable, snapshot, input, scope, record)
          const edgeTo = (to: string): ExploreEdge => ({
            from: key,
            kind,
            input: label,
            to,
            reentersAgent: !isStep(input) && reentersAgent(machine, snapshot, next),
          })
          const link = (to: string): TraceLink => ({ previous: Option.some(trace), step: { kind, input: label, key: to } })
          const rankings = MutableList.toArray(taken).flatMap(rankingOf)
          const invalid = rankings.find((field) => !isNaturalField(next.context, field))
          if (invalid !== undefined) {
            return yield* new InvalidRanking({
              message: `the input ${label} takes a transition whose ranking '${invalid}' is no natural number after it`,
              field: invalid,
              edge: edgeTo(keyOf(next)),
              trace: traceOf(trace),
            })
          }
          rankings.forEach((field) => {
            MutableHashSet.add(ranked, field)
            record(field)
          })
          if (MutableHashSet.size(reads) !== known) {
            yield* refuseNewReads(link("(the read stopped the run)"))
            return Option.none<ReadonlyArray<Successor>>()
          }
          if (MutableHashSet.size(ranked) !== knownRanked) return Option.none<ReadonlyArray<Successor>>()
          const to = keyOf(next)
          const edge = edgeTo(to)
          MutableList.append(edges, edge)
          MutableList.append(links, [edge, trace])
          MutableList.append(successors, { kind, input: label, snapshot: next, key: to })
          MutableList.append(queue, { snapshot: next, trace: link(to) })
        }
        return Option.some<ReadonlyArray<Successor>>(MutableList.toArray(successors))
      })

    const start: TraceLink = { previous: Option.none(), step: { kind: "initial", input: "", key: "" } }
    const initial = yield* drivable
      .getInitialSnapshot(environment.input)
      .pipe(
        Effect.provideService(ActorScope, createInertActorScope(Snap.active())),
        Effect.provideService(ContextReads, Option.some({ machine, record })),
        Effect.scoped,
        Effect.map(withRawContext)
      )
    if (MutableHashSet.size(reads) !== known) {
      yield* refuseNewReads(start)
      return restartPass
    }
    MutableList.append(queue, { snapshot: initial, trace: { previous: Option.none(), step: { ...start.step, key: keyOf(initial) } } })

    for (let entry = MutableList.take(queue); entry !== MutableList.Empty; entry = MutableList.take(queue)) {
      yield* Effect.yieldNow
      const key = keyOf(entry.snapshot)
      const first = MutableHashMap.get(nodes, key)
      if (Option.isSome(first)) {
        const difference = differingFields(fields, first.value.snapshot, entry.snapshot)
        if (difference.length === 0 || entry.snapshot.status !== "active") continue
        const merge = mergeKey(key, difference, entry.snapshot)
        if (Option.exists(merge, (each) => MutableHashSet.has(merges, each))) continue
        if (Option.isSome(merge)) MutableHashSet.add(merges, merge.value)
        const successors = yield* successorsOf(entry.snapshot, entry.trace, key)
        if (Option.isNone(successors)) return restartPass
        yield* checkCongruence(key, first.value, entry.trace, successors.value)
        continue
      }
      MutableList.append(keys, key)
      const successors = entry.snapshot.status === "active" ? yield* successorsOf(entry.snapshot, entry.trace, key) : Option.some<ReadonlyArray<Successor>>([])
      if (Option.isNone(successors)) return restartPass
      MutableHashMap.set(nodes, key, { snapshot: entry.snapshot, trace: entry.trace, successors: successors.value })
      MutableRef.set(explored, MutableHashMap.size(nodes))
    }

    const order = MutableList.toArray(keys)
    const taken = MutableList.toArray(edges)
    const undriven = environment.catalogue.find((kind) => !MutableHashSet.has(driven, kind))
    if (undriven !== undefined) {
      return yield* new UndrivenInput({ message: `the catalogued input kind '${undriven}' gave no input in any state`, kind: undriven })
    }
    const nonPerson = Arr.groupBy(taken.filter((edge) => edge.kind !== "person"), (edge) => edge.from)
    const onward = (key: string) => (nonPerson[key] ?? []).map((edge) => edge.to)
    for (const [edge, trace] of MutableList.toArray(links)) {
      if (!edge.reentersAgent || edge.kind === "person") continue
      yield* Effect.yieldNow
      if (reachable([edge.to], onward).has(edge.from)) {
        return yield* new UnrankedCycle({
          message: `the input ${edge.input} re-enters an agent state on a cycle that no falling counter or event from a person bounds, from ${edge.from} to ${edge.to}`,
          edge,
          trace: traceOf(trace),
        })
      }
    }
    const inbound = Arr.groupBy(taken, (edge) => edge.to)
    const finals = order.filter((key) => isFinal(environment, Option.getOrThrow(MutableHashMap.get(nodes, key)).snapshot))
    const live = reachable(finals, (key) => (inbound[key] ?? []).map((edge) => edge.from))
    const stuck = order.filter((key) => !live.has(key))
    if (stuck.length > 0) {
      return yield* new CannotReachFinal({
        message: `${stuck.length} reachable states cannot reach a final state; the first is ${stuck[0]}`,
        states: stuck,
        trace: traceOf(Option.getOrThrow(MutableHashMap.get(nodes, stuck[0]!)).trace),
      })
    }
    return { explored: order.length, keys: order, edges: taken, abstraction: fields }
  })

/** Whether a state is an end the proof accepts. */
const isFinal = (environment: ExploreEnvironment, snapshot: AnyMachineSnapshot): boolean =>
  snapshot.status === "done" && !environment.stalled?.(snapshot)

/** Every key `next` leads to from `from`, `from` included. */
const reachable = (from: ReadonlyArray<string>, next: (key: string) => ReadonlyArray<string>) => {
  const seen = MutableHashSet.make(...from)
  const queue = MutableList.make<string>()
  MutableList.appendAll(queue, from)
  for (let key = MutableList.take(queue); key !== MutableList.Empty; key = MutableList.take(queue)) {
    for (const target of next(key)) {
      if (!MutableHashSet.has(seen, target)) {
        MutableHashSet.add(seen, target)
        MutableList.append(queue, target)
      }
    }
  }
  return { has: (key: string) => MutableHashSet.has(seen, key) }
}

/** Fails when the successors of a merged state differ from those of the first state of its key. */
const checkCongruence = (
  key: string,
  first: Representative,
  trace: TraceLink,
  successors: ReadonlyArray<Successor>
): Effect.Effect<void, CongruenceViolation> => {
  const absent = (input: string): Successor => ({ kind: "absent", input, snapshot: first.snapshot, key: "(no such input here)" })
  const inputs = Arr.dedupe([...first.successors, ...successors].map((successor) => successor.input))
  const pairs = inputs.map((input) => [
    first.successors.find((successor) => successor.input === input) ?? absent(input),
    successors.find((successor) => successor.input === input) ?? absent(input),
  ] as const)
  const mismatch = pairs.find(([a, b]) => a.key !== b.key)
  if (mismatch === undefined) return Effect.void
  const [a, b] = mismatch
  return Effect.fail(
    new CongruenceViolation({
      message: `two states merged under ${key} differ on the input ${a.input}: ${a.key} and ${b.key}`,
      key,
      first: [...traceOf(first.trace), { kind: a.kind, input: a.input, key: a.key }],
      second: [...traceOf(trace), { kind: b.kind, input: b.input, key: b.key }],
    })
  )
}

/** The read fields whose values differ between two states of one key, so what the key dropped. */
const differingFields = (fields: ReadonlyArray<string>, a: AnyMachineSnapshot, b: AnyMachineSnapshot): ReadonlyArray<string> =>
  fields.filter((field) => !Object.is(fieldOf(a.context, field), fieldOf(b.context, field)))

/**
 * What makes a merged state new to the congruence check: its key and the values of its differing
 * fields, as a value hides behind the abstraction whatever the field's name. None for a value
 * that has no canonical form, which the check then compares each time: the timeout bounds that.
 */
const mergeKey = (key: string, fields: ReadonlyArray<string>, snapshot: AnyMachineSnapshot): Option.Option<string> =>
  Option.map(
    Result.getSuccess(canonical(fields.map((field) => [field, fieldOf(snapshot.context, field)]))),
    (values) => `${key}\n${simpleStringify(values)}`
  )

/** A field of a context, which is any value a machine holds. */
const fieldOf = (context: unknown, field: string): unknown =>
  Reflect.get(Object(context), field)

/** Whether a context holds `field` as a natural number. */
const isNaturalField = (context: unknown, field: string): boolean => {
  const value = fieldOf(context, field)
  return typeof value === "number" && Number.isInteger(value) && value >= 0
}

/** The ranking a taken transition declares: a guarded one's `meta.ranking`, the only form that counts (S16). */
const rankingOf = (transition: TakenTransition): ReadonlyArray<string> => {
  const meta: unknown = transition.meta
  return !isUnguarded(transition) && Predicate.hasProperty(meta, "ranking") && Predicate.isString(meta.ranking) ? [meta.ranking] : []
}

/** Whether a move started an agent invocation: an agent child that was not in the state before. */
const reentersAgent = (machine: AnyStateMachine, before: AnyMachineSnapshot, after: AnyMachineSnapshot): boolean =>
  Object.entries(after.children).some(
    ([id, child]) =>
      before.children[id] !== child &&
      Predicate.isNotNullish(child) &&
      Option.exists(resolveReferencedActor(machine as unknown as SpawningMachine, Reflect.get(child, "src")), hasAgentBrand)
  )

/** Whether an input is a step rather than an event. */
const isStep = (input: ExploreInput): input is ExploreStep => Predicate.hasProperty(input, "step")

/** An input's name in traces, edges and the comparison of two states' inputs. */
const inputLabel = (input: ExploreInput): string => (isStep(input) ? input.label : simpleStringify(input))

/** The trace a link ends. */
const traceOf = (link: TraceLink): ExploreTrace => {
  const steps = MutableList.make<ExploreTraceStep>()
  for (let at = Option.some(link); Option.isSome(at); at = at.value.previous) {
    MutableList.prepend(steps, at.value.step)
  }
  return MutableList.toArray(steps)
}

/** A snapshot with its plain context: what the run keeps, so that nothing but the machine records. */
const withRawContext = (snapshot: AnyMachineSnapshot): AnyMachineSnapshot =>
  Snap.updateContext(snapshot, rawContext(snapshot.context))

/** The state after an input: the machine runs on a recording context, in an inert scope. */
const runInput = (
  machine: Drivable,
  snapshot: AnyMachineSnapshot,
  input: ExploreInput,
  scope: ActorScopeService,
  record: (field: string) => void
): Effect.Effect<AnyMachineSnapshot, TransitionError, unknown> =>
  (isStep(input)
    ? Effect.orDie(input.step(snapshot))
    : machine.transition(Snap.updateContext(snapshot, recordingContext(snapshot.context, record)), input)
  ).pipe(Effect.provideService(ActorScope, scope), Effect.scoped, Effect.map(withRawContext))

/** The key of a state: its configuration and the abstraction of the read fields, never a raw field. */
const stateKey =
  (environment: ExploreEnvironment, fields: ReadonlyArray<string>, ranked: MutableHashSet.MutableHashSet<string>) =>
  (snapshot: AnyMachineSnapshot): string =>
    simpleStringify({
      value: snapshot.value,
      status: snapshot.status,
      children: Arr.sort(Object.keys(snapshot.children), Order.String),
      history: historyKey(snapshot),
      context: fields.map((field) => [
        field,
        MutableHashSet.has(ranked, field)
          ? fieldOf(snapshot.context, field)
          : environment.abstraction[field]!(fieldOf(snapshot.context, field)),
      ]),
    })

/** The recorded history of a state, by node id: a state re-enters by it, so two histories are two states. */
const historyKey = (snapshot: AnyMachineSnapshot) =>
  Arr.sort(
    Object.entries(snapshot.historyValue).map(([id, nodes]) => [id, nodes.map((node) => node.id)] as const),
    Order.mapInput(Order.String, (entry: readonly [string, unknown]) => entry[0])
  )
