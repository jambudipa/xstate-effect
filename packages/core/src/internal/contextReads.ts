/**
 * @since 0.4.0
 * @module internal/contextReads
 *
 * The context as the explorer hands it to a machine: a Proxy that records each field user code
 * reads, so the explorer derives its abstraction from what the machine reads (decision 12)
 * rather than from what a person declares. Every snapshot of a recorded run holds such a
 * context: the explorer wraps the snapshot it drives, the initial snapshot wraps the context it
 * starts from, and `assign` wraps what it merges, so a guard that runs after an assign in the
 * same macrostep is recorded too. Upstream has no counterpart: the explorer is a port addition.
 */
import { Context, Option, Predicate } from "effect"
import type { AnyStateMachine } from "../StateMachine.js"

/** Takes the name of a field that was read. */
type RecordRead = (field: string) => void

/** What the initial snapshot of `machine` wraps its context with. */
interface InitialReads {
  /** The machine under exploration. A child machine it spawns reads its own context, not this one's. */
  readonly machine: AnyStateMachine
  /** Takes each read. */
  readonly record: RecordRead
}

/**
 * The recording of a machine's initial snapshot; none outside the explorer, so an actor pays
 * for one lookup at creation and records nothing.
 *
 * @since 0.4.0
 * @category Internal
 */
export const ContextReads = Context.Reference<Option.Option<InitialReads>>(
  "@jambudipa/xstate-effect/internal/contextReads/ContextReads",
  { defaultValue: () => Option.none() }
)

/** The target and recorder behind each recording context, keyed by the Proxy, which they do not outlive. */
const recordings = new WeakMap<object, { readonly target: object; readonly record: RecordRead }>()

/** The recording behind a context; none for any other value. */
const recordingOf = (context: unknown) =>
  Option.flatMap(Option.liftPredicate(context, Predicate.isObjectKeyword), (object) => Option.fromNullishOr(recordings.get(object)))

/**
 * `context` with its reads recorded. Every way user code can depend on a field counts: a read,
 * `in`, and a walk of the keys, which reads them all. A value that is no object has no fields.
 *
 * @since 0.4.0
 * @category Internal
 */
export const recordingContext = <TContext>(context: TContext, record: RecordRead): TContext => {
  if (!Predicate.isObjectKeyword(context)) return context
  const target = rawContext(context)
  const read = (field: string | symbol) => {
    if (typeof field === "string") record(field)
  }
  const proxy = new Proxy(target, {
    get: (object, field, receiver) => {
      read(field)
      return Reflect.get(object, field, receiver)
    },
    has: (object, field) => {
      read(field)
      return Reflect.has(object, field)
    },
    getOwnPropertyDescriptor: (object, field) => {
      read(field)
      return Reflect.getOwnPropertyDescriptor(object, field)
    },
    ownKeys: (object) => {
      Reflect.ownKeys(object).forEach(read)
      return Reflect.ownKeys(object)
    },
  })
  recordings.set(proxy, { target, record })
  return proxy
}

/**
 * The object behind a recording context; any other value as it is.
 *
 * @since 0.4.0
 * @category Internal
 */
export const rawContext = <TContext>(context: TContext): TContext =>
  Option.getOrElse(
    Option.map(recordingOf(context), (recording) => recording.target as TContext),
    () => context
  )

/**
 * The context `assign` leaves: a copy of `context` with `partial` merged in. The copy is the
 * engine's own, so it counts as no read, and a recording context stays one.
 *
 * @since 0.4.0
 * @category Internal
 */
export const mergeContext = <TContext>(context: TContext, partial: Partial<TContext>): TContext => {
  const recording = recordingOf(context)
  if (Option.isNone(recording)) return { ...context, ...partial }
  return recordingContext({ ...(recording.value.target as TContext), ...partial }, recording.value.record)
}
