/**
 * @since 0.1.0
 * @module persistence
 *
 * The Schema codec of persisted snapshots (D8, SD-7). Every logic's `getPersistedSnapshot`
 * encodes through it, and restore decodes through it, so a persisted snapshot survives
 * `JSON.stringify` and `JSON.parse` and decodes back to the same snapshot fields.
 *
 * - An `Option` field (`output`, `error`, an observable's `context`, a child's `systemId`)
 *   persists `None` as `undefined`, so the JSON has no key for it, and `Some(a)` as `a`. The
 *   persisted object then equals upstream's, whose keys hold `undefined` (xstate@5.33.2
 *   copies the snapshot as it is). A missing key or `undefined` decodes to `None`, so a
 *   `Some(undefined)` comes back as `None` (SD-7: an `undefined` value is `None` everywhere).
 * - A machine snapshot persists its children as `{ snapshot, src, systemId, syncSnapshot }`
 *   (upstream `getPersistedSnapshot` in `src/State.ts`), its history value as state-node ids,
 *   its tags as a sorted array, and its context with every actor reference (also nested in
 *   arrays and plain objects) as `{ xstate$$type: 1, id }` (upstream `persistContext`). It
 *   leaves out the machine and the methods.
 * - A context the codec cannot encode (a function, a bigint, a symbol, a non-finite number,
 *   a class instance or a circular reference) fails with `SerializationError`, as does a child
 *   whose `src` is not a name (upstream: `An inline child actor cannot be persisted.`).
 * - Output, error, input and a child's own persisted snapshot are values of the user's types:
 *   they persist as they are, as upstream copies them.
 *
 * Decoding does not rebuild children or actor references: the machine's `restoreSnapshot`
 * creates the children from the decoded form, then revives the context's markers with
 * {@link reviveContext}. As upstream `restoreSnapshot` reads them, a history value that is not
 * an object decodes to no history, and missing tags decode to none (restore reads the tags of
 * the configuration).
 *
 * An actor's persisted snapshot also holds the delayed events that actor scheduled and that
 * are still pending, under `scheduledEvents` ({@link PersistedScheduledEvents}, P4), so a
 * restored actor resumes them; upstream persists no delayed event. The key is absent when no
 * event is pending. Restore can check that a persisted machine snapshot is consistent
 * ({@link validateRestoredSnapshot}, opt-in, D11).
 */
import { Array as Arr, Effect, HashSet, Option, Order, Predicate, Schema, SchemaGetter, SchemaIssue, SchemaTransformation } from "effect"
import type { ScheduledEvent } from "./ActorLogic.js"
import type { ActorRefBase } from "./ActorRef.js"
import { isActorRef } from "./ActorRef.js"
import { InvalidPersistedSnapshotError, RestoreError, SerializationError } from "./Errors.js"
import type { EventObject } from "./Event.js"
import type { MachineSnapshot, Snapshot } from "./Snapshot.js"
import { isMachineSnapshot, SnapshotStatusSchema, SnapshotTypeId } from "./Snapshot.js"
import type { StateNode } from "./StateNode.js"
import { isConfigurationDone } from "./stateUtils.js"
import type { StateValue } from "./StateValue.js"

// ============================================================
// FIELD CODECS
// ============================================================

/**
 * A value of the user's own type (an output, an error, an input, a child's persisted
 * snapshot), persisted as it is, as upstream copies it: the codec has no schema for it.
 *
 * @since 0.1.0
 * @category Codecs
 */
export const PersistedValue = Schema.declare(Predicate.isUnknown).annotate({ identifier: "PersistedValue" })

/**
 * An `Option` field. `None` persists as `undefined` (no key in the JSON) and `Some(a)` as `a`;
 * a missing key or `undefined` decodes to `None`, every other value to `Some`.
 *
 * @since 0.1.0
 * @category Codecs
 */
export const PersistedOption = <S extends Schema.Constraint>(value: S) =>
  Schema.optional(value).pipe(
    Schema.decodeTo(
      Schema.Option(Schema.toType(value)),
      SchemaTransformation.transformOptional<Option.Option<S["Type"]>, S["Type"] | undefined>({
        decode: (persisted) => Option.some(Option.filter(persisted, (present): present is S["Type"] => present !== undefined)),
        encode: (field) => Option.some(Option.getOrUndefined(Option.flatten(field))),
      })
    )
  )

/**
 * The value that marks an actor reference in a persisted context (upstream `$$ACTOR_TYPE`).
 *
 * @since 0.1.0
 * @category Models
 */
export const ACTOR_REF_TYPE = 1

/**
 * An actor reference in a persisted context (upstream `persistContext`): the actor's id.
 *
 * @since 0.1.0
 * @category Models
 */
export interface PersistedActorRef {
  /**
   * Always {@link ACTOR_REF_TYPE}: this key with this value marks a reference. Restore treats
   * any context object that carries them as a marker, also one the user wrote.
   */
  readonly xstate$$type: typeof ACTOR_REF_TYPE
  /**
   * The referenced actor's own `id`. Restore revives the marker to the child with this id in
   * `snapshot.children`; a reference to an actor that is not a child revives to `undefined`.
   */
  readonly id: string
}

/** A path into the context, for the failure message. */
type ContextPath = ReadonlyArray<string | number>

/** The path as the failure message prints it: `context.a[0].b`, or `the context itself` for the root. */
const describePath = (path: ContextPath): string =>
  Arr.isReadonlyArrayEmpty(path)
    ? "the context itself"
    : `context${Arr.join(Arr.map(path, (segment) => (Predicate.isNumber(segment) ? `[${segment}]` : `.${segment}`)), "")}`

/**
 * The schema issue for a context value JSON cannot hold; `what` names the kind of value (for
 * example `a function`). The encoder turns the issue into a `SerializationError`.
 */
const notPersistable = (value: unknown, path: ContextPath, what: string): SchemaIssue.Issue =>
  new SchemaIssue.InvalidValue(
    { message: `${describePath(path)} is ${what}: a persisted context holds JSON values and actor references only` },
    value
  )

/** A plain object: its prototype is `Object.prototype` or none (also from another realm). */
const isPlainObject = (value: object): boolean => {
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || Predicate.isNull(prototype) || Predicate.isNull(Object.getPrototypeOf(prototype))
}

/** The class name of a non-plain object, for the failure message; `Object` when the prototype has no constructor. */
const constructorName = (value: object): string => {
  const prototype: unknown = Object.getPrototypeOf(value)
  return Predicate.hasProperty(prototype, "constructor") && Predicate.isFunction(prototype.constructor)
    ? prototype.constructor.name
    : "Object"
}

/**
 * The persisted form of a context value (upstream `persistContext`, with a JSON check):
 * actor references become `{ xstate$$type: 1, id }`, arrays and plain objects are copied with
 * their values persisted, JSON leaves and `undefined` (which JSON leaves out) stay.
 */
const persistContextValue = (
  value: unknown,
  path: ContextPath,
  ancestors: ReadonlyArray<object>
): Effect.Effect<unknown, SchemaIssue.Issue> => {
  if (isActorRef(value)) {
    const reference: PersistedActorRef = { xstate$$type: ACTOR_REF_TYPE, id: value.id }
    return Effect.succeed(reference)
  }
  if (Predicate.isFunction(value)) {
    return Effect.fail(notPersistable(value, path, "a function"))
  }
  if (Predicate.isBigInt(value)) {
    return Effect.fail(notPersistable(value, path, "a bigint"))
  }
  if (Predicate.isSymbol(value)) {
    return Effect.fail(notPersistable(value, path, "a symbol"))
  }
  if (Predicate.isNumber(value) && !Number.isFinite(value)) {
    return Effect.fail(notPersistable(value, path, `the non-finite number ${String(value)}`))
  }
  if (!Predicate.isObjectKeyword(value)) {
    // A string, a boolean, a finite number, `null` or `undefined`
    return Effect.succeed(value)
  }
  if (Arr.some(ancestors, (ancestor) => ancestor === value)) {
    return Effect.fail(notPersistable(value, path, "a circular reference"))
  }
  const inside = Arr.append(ancestors, value)
  if (Arr.isArray(value)) {
    return Effect.forEach(value, (item: unknown, index) => persistContextValue(item, Arr.append(path, index), inside))
  }
  if (!isPlainObject(value)) {
    return Effect.fail(notPersistable(value, path, `an instance of ${constructorName(value)}`))
  }
  return Effect.map(
    Effect.forEach(Object.entries(value), ([key, item]) =>
      Effect.map(persistContextValue(item, Arr.append(path, key), inside), (persisted) => [key, persisted] as const)
    ),
    (entries) => Object.fromEntries(entries)
  )
}

/**
 * A context (a machine's, a transition logic's, an observable's). Encoding persists the
 * actor references as `{ xstate$$type: 1, id }` and fails for a value JSON cannot hold;
 * decoding keeps the value as it is (the machine's restore revives the references).
 *
 * @since 0.1.0
 * @category Codecs
 */
export const PersistedContext = PersistedValue.pipe(
  Schema.decodeTo(PersistedValue, {
    decode: SchemaGetter.passthrough(),
    encode: SchemaGetter.transformEffect((context: unknown) => persistContextValue(context, [], [])),
  })
)

/** Whether a context value is the persisted form of an actor reference (upstream `$$ACTOR_TYPE` check). */
const isPersistedActorRef = (value: unknown): value is { readonly xstate$$type: typeof ACTOR_REF_TYPE; readonly id: unknown } =>
  Predicate.hasProperty(value, "xstate$$type") && value.xstate$$type === ACTOR_REF_TYPE

/** The child a marker names: an own entry of `children`, else none. */
const childNamed = (children: Readonly<Record<string, ActorRefBase>>, id: unknown): Option.Option<ActorRefBase> =>
  Predicate.isString(id) && Object.hasOwn(children, id) ? Option.fromNullishOr(children[id]) : Option.none()

/**
 * A context value with its markers revived: a marker becomes the child it names, or
 * `undefined` (upstream); an array or a plain object is copied when a value inside it
 * changed, and is kept as it is otherwise; any other value, and a value already on the path
 * (a cycle), is kept as it is.
 */
const reviveContextValue = (
  value: unknown,
  children: Readonly<Record<string, ActorRefBase>>,
  ancestors: ReadonlyArray<object>
): unknown => {
  if (isPersistedActorRef(value)) {
    return Option.getOrUndefined(childNamed(children, value.id))
  }
  if (!Predicate.isObjectKeyword(value) || Arr.some(ancestors, (ancestor) => ancestor === value)) {
    return value
  }
  const inside = Arr.append(ancestors, value)
  if (Arr.isArray(value)) {
    const items = Arr.map(value, (item: unknown) => reviveContextValue(item, children, inside))
    return Arr.every(items, (item, index) => item === value[index]) ? value : items
  }
  if (!isPlainObject(value)) {
    return value
  }
  return reviveMembers(value, children, inside)
}

/** A plain object with its members revived; the object itself when no member changed. */
const reviveMembers = (
  value: object,
  children: Readonly<Record<string, ActorRefBase>>,
  ancestors: ReadonlyArray<object>
): object => {
  const entries = Object.entries(value)
  const revived = Arr.map(entries, ([key, item]) => [key, reviveContextValue(item, children, ancestors)] as const)
  return Arr.every(revived, ([, item], index) => item === entries[index]?.[1]) ? value : Object.fromEntries(revived)
}

/**
 * Revives the actor references of a decoded context (upstream `reviveContext` in
 * `StateMachine.restoreSnapshot`): each `{ xstate$$type: 1, id }` marker below the context,
 * also inside arrays and plain objects, becomes the restored child with that id, or
 * `undefined` when no child has it. The context itself is never replaced. Upstream changes
 * the persisted object in place; here an array or object that holds a marker is copied, so
 * the persisted snapshot stays as it was and can be restored again.
 *
 * @since 0.1.0
 * @category Decoding
 */
export const reviveContext = (context: unknown, children: Readonly<Record<string, ActorRefBase>>): unknown =>
  Predicate.isObjectKeyword(context) && isPlainObject(context)
    ? reviveMembers(context, children, [context])
    : reviveContextValue(context, children, [])

/**
 * The tags of a machine snapshot: a `HashSet` that persists as a sorted array.
 *
 * @since 0.1.0
 * @category Codecs
 */
export const PersistedTags = Schema.Array(Schema.String).pipe(
  Schema.decodeTo(
    Schema.HashSet(Schema.String),
    SchemaTransformation.transform({
      decode: (tags) => HashSet.fromIterable(tags),
      encode: (tags) => Arr.sort(Arr.fromIterable(tags), Order.String),
    })
  )
)

/** A state node id (or a child id): a plain string in the persisted form. */
const NodeId = Schema.String.annotate({ identifier: "NodeId" })

/**
 * A recorded state node in a persisted history value: its id (upstream
 * `serializeHistoryValue`). Encoding keeps only the id of the machine's `StateNode`.
 *
 * @since 0.1.0
 * @category Codecs
 */
export const PersistedStateNodeRef = Schema.Struct({ id: NodeId }).annotate({ identifier: "PersistedStateNodeRef" })

/** The recorded state nodes of each history state, as ids. */
const HistoryRecord = Schema.Record(Schema.String, Schema.Array(PersistedStateNodeRef))

/** A persisted history value that is not an object: `null`, a number, a string or a boolean. */
const NotAHistoryRecord = Schema.Union([Schema.Null, Schema.Number, Schema.String, Schema.Boolean])

/**
 * A history value: the recorded state nodes of each history state, as ids. Decoding reads a
 * value that is not an object (`null`, a number, a string, a boolean) as no history, as
 * upstream `reviveHistoryValue` does; a missing key or `undefined` is no history too (the
 * machine codec's default).
 *
 * @since 0.1.0
 * @category Codecs
 */
export const PersistedHistoryValue = Schema.Union([
  HistoryRecord,
  NotAHistoryRecord.pipe(
    Schema.decodeTo(HistoryRecord, {
      decode: SchemaGetter.transform((): (typeof HistoryRecord)["Type"] => ({})),
      // Decode only: a history record encodes through the first member
      encode: SchemaGetter.forbiddenEncoding,
    })
  ),
])

/**
 * A persisted history value: the ids of the recorded state nodes of each history state
 * (upstream `PersistedHistoryValue`).
 *
 * @since 0.1.0
 * @category Codecs
 */
export type PersistedHistoryValue = (typeof PersistedHistoryValue)["Type"]

/**
 * A state value: a state key, or an object of the active child state values.
 *
 * @since 0.1.0
 * @category Codecs
 */
export const PersistedStateValue: Schema.Codec<StateValue> = Schema.Union([
  Schema.String,
  Schema.Record(Schema.String, Schema.suspend((): Schema.Codec<StateValue> => PersistedStateValue)),
])

/**
 * A child of a machine snapshot (upstream `getPersistedSnapshot`): the child's own
 * persisted snapshot, the name of its logic, its systemId and whether it syncs its snapshot.
 *
 * @since 0.1.0
 * @category Codecs
 */
export const PersistedChild = Schema.Struct({
  snapshot: PersistedValue,
  src: Schema.String,
  systemId: PersistedOption(Schema.String),
  syncSnapshot: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
}).annotate({ identifier: "PersistedChild" })

// ============================================================
// SNAPSHOT CODECS
// ============================================================

/**
 * The persisted form of a machine snapshot.
 *
 * @since 0.1.0
 * @category Codecs
 */
export const MachineSnapshotCodec = Schema.Struct({
  status: SnapshotStatusSchema,
  value: PersistedStateValue,
  context: Schema.optional(PersistedContext),
  output: PersistedOption(PersistedValue),
  error: PersistedOption(PersistedValue),
  historyValue: PersistedHistoryValue.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  // Upstream does not persist tags: a snapshot without them decodes to none (restore reads
  // the tags of the configuration)
  tags: PersistedTags.pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  children: Schema.Record(Schema.String, PersistedChild),
}).annotate({ identifier: "PersistedMachineSnapshot" })

/**
 * The persisted form of a promise, callback or effect snapshot.
 *
 * @since 0.1.0
 * @category Codecs
 */
export const LogicSnapshotCodec = Schema.Struct({
  status: SnapshotStatusSchema,
  output: PersistedOption(PersistedValue),
  error: PersistedOption(PersistedValue),
  input: Schema.optional(PersistedValue),
}).annotate({ identifier: "PersistedLogicSnapshot" })

/**
 * The persisted form of an observable or stream snapshot (its context is an `Option`, SD-17).
 *
 * @since 0.1.0
 * @category Codecs
 */
export const ObservableSnapshotCodec = Schema.Struct({
  status: SnapshotStatusSchema,
  output: PersistedOption(PersistedValue),
  error: PersistedOption(PersistedValue),
  context: PersistedOption(PersistedContext),
  input: Schema.optional(PersistedValue),
}).annotate({ identifier: "PersistedObservableSnapshot" })

/**
 * The persisted form of a transition logic snapshot.
 *
 * @since 0.1.0
 * @category Codecs
 */
export const TransitionSnapshotCodec = Schema.Struct({
  status: SnapshotStatusSchema,
  output: PersistedOption(PersistedValue),
  error: PersistedOption(PersistedValue),
  context: Schema.optional(PersistedContext),
}).annotate({ identifier: "PersistedTransitionSnapshot" })

/**
 * The JSON-safe persisted form of a machine snapshot.
 *
 * @since 0.1.0
 * @category Models
 */
export type PersistedMachineSnapshot = (typeof MachineSnapshotCodec)["Encoded"]

/**
 * A machine snapshot decoded from its persisted form: `Option` fields, a `HashSet` of tags,
 * history as ids, children as their persisted entries, actor references as markers.
 *
 * @since 0.1.0
 * @category Models
 */
export type DecodedMachineSnapshot = (typeof MachineSnapshotCodec)["Type"]

// ============================================================
// ENCODE AND DECODE
// ============================================================

/** The text of upstream's error for a child whose `src` is a logic (`src/State.ts`). */
const inlineChildCannotBePersisted = "An inline child actor cannot be persisted."

/**
 * The encoder of a codec, with the codec's issue mapped to `SerializationError` (the issue
 * text as `message`, the schema error as `cause`).
 */
const encoderOf = <S extends Schema.ConstraintCodec<unknown, unknown>>(codec: S) => {
  const encode = Schema.encodeEffect(codec)
  return (value: S["Type"]): Effect.Effect<S["Encoded"], SerializationError> =>
    Effect.mapError(encode(value), (error) => new SerializationError({ message: error.message, cause: error }))
}

/**
 * The decoder of a codec for an untrusted value (`JSON.parse` output), with the codec's issue
 * mapped to `RestoreError` (the issue text as `message`, the schema error as `cause`).
 */
const decoderOf = <S extends Schema.ConstraintCodec<unknown, unknown>>(codec: S) => {
  const decode = Schema.decodeUnknownEffect(codec)
  return (persisted: unknown): Effect.Effect<S["Type"], RestoreError> =>
    Effect.mapError(decode(persisted), (error) => new RestoreError({ message: error.message, cause: error }))
}

/** The machine snapshot codec's encoder; {@link persistMachineSnapshot} persists the children first. */
const encodeMachine = encoderOf(MachineSnapshotCodec)
/** The promise, callback and effect snapshot codec's encoder. */
const encodeLogic = encoderOf(LogicSnapshotCodec)
/** The observable and stream snapshot codec's encoder. */
const encodeObservable = encoderOf(ObservableSnapshotCodec)
/** The transition logic snapshot codec's encoder. */
const encodeTransition = encoderOf(TransitionSnapshotCodec)
/** The promise, callback and effect snapshot codec's decoder. */
const decodeLogic = decoderOf(LogicSnapshotCodec)
/** The observable and stream snapshot codec's decoder. */
const decodeObservable = decoderOf(ObservableSnapshotCodec)
/** The transition logic snapshot codec's decoder. */
const decodeTransition = decoderOf(TransitionSnapshotCodec)

/** The systemId of a child actor (upstream `child.systemId`). */
const systemIdOf = (child: ActorRefBase): Option.Option<string> =>
  Predicate.hasProperty(child, "systemId") && Predicate.isString(child.systemId) ? Option.some(child.systemId) : Option.none()

/** Whether a child actor syncs its snapshot to its parent (upstream `child._syncSnapshot`). */
const syncSnapshotOf = (child: ActorRefBase): boolean =>
  Predicate.hasProperty(child, "_syncSnapshot") && child._syncSnapshot === true

/** One child's persisted entry; a child whose `src` is a logic cannot be persisted (upstream). */
const persistChild = (child: ActorRefBase): Effect.Effect<(typeof PersistedChild)["Type"], SerializationError> => {
  const src = child.src
  if (!Predicate.isString(src)) {
    return Effect.fail(new SerializationError({ message: inlineChildCannotBePersisted }))
  }
  return Effect.map(child.getPersistedSnapshot, (snapshot) => ({
    snapshot,
    src,
    systemId: systemIdOf(child),
    syncSnapshot: syncSnapshotOf(child),
  }))
}

/**
 * Encodes a machine snapshot to its persisted form: each child (an actor in
 * `snapshot.children`) through its own `getPersistedSnapshot`, then the snapshot through
 * {@link MachineSnapshotCodec}.
 *
 * @since 0.1.0
 * @category Encoding
 */
export const persistMachineSnapshot = (
  snapshot: MachineSnapshot
): Effect.Effect<PersistedMachineSnapshot, SerializationError> =>
  Effect.gen(function* () {
    const children = yield* Effect.forEach(
      Arr.filter(Object.entries(snapshot.children), (entry): entry is [string, ActorRefBase] => isActorRef(entry[1])),
      ([id, child]) => Effect.map(persistChild(child), (persisted) => [id, persisted] as const)
    )
    // The codec's decoded form holds the tags as a HashSet; the live snapshot's are a Set
    return yield* encodeMachine({ ...snapshot, tags: HashSet.fromIterable(snapshot.tags), children: Object.fromEntries(children) })
  })

/**
 * The persisted form without the children a restore cannot rebuild (upstream
 * `restoreSnapshot` skips a child whose `src` gives no logic): an entry with no string `src`,
 * such as the actor marker `{ xstate$$type: 1, id }` that `JSON.stringify` of a live machine
 * snapshot writes for each child, is left out, so the rest of the snapshot restores (SD-7).
 */
const withoutChildMarkers = (persisted: unknown): unknown =>
  Predicate.hasProperty(persisted, "children") && Predicate.isObjectKeyword(persisted.children)
    ? {
        ...persisted,
        children: Object.fromEntries(
          Arr.filter(
            Object.entries(persisted.children),
            ([, child]) => Predicate.hasProperty(child, "src") && Predicate.isString(child.src)
          )
        ),
      }
    : persisted

/** The machine snapshot codec's decoder. */
const decodeMachine = decoderOf(MachineSnapshotCodec)

/**
 * Decodes the persisted form of a machine snapshot (a value from `JSON.parse` or from
 * `getPersistedSnapshot`); a value the codec rejects fails with `RestoreError`. A child with
 * no `src` is skipped, as upstream skips it.
 *
 * @since 0.1.0
 * @category Decoding
 */
export const decodeMachineSnapshot = (persisted: unknown): Effect.Effect<DecodedMachineSnapshot, RestoreError> =>
  decodeMachine(withoutChildMarkers(persisted))

/**
 * Encodes a promise, callback or effect snapshot to its persisted form.
 *
 * @since 0.1.0
 * @category Encoding
 */
export const persistLogicSnapshot = (
  snapshot: Snapshot & { readonly input: unknown }
): Effect.Effect<(typeof LogicSnapshotCodec)["Encoded"], SerializationError> => encodeLogic(snapshot)

/**
 * Restores a promise, callback or effect snapshot from its persisted form. The values are
 * the ones the logic persisted (the codec cannot check a user type), as upstream restores
 * them as they are.
 *
 * @since 0.1.0
 * @category Decoding
 */
export const restoreLogicSnapshot = <TOutput, TInput>(
  persisted: unknown
): Effect.Effect<Snapshot<TOutput> & { readonly input: TInput }, RestoreError> =>
  Effect.map(decodeLogic(persisted), (fields) => ({
    [SnapshotTypeId]: SnapshotTypeId,
    status: fields.status,
    output: fields.output as Option.Option<TOutput>,
    error: fields.error,
    input: fields.input as TInput,
  }))

/**
 * Encodes an observable or stream snapshot to its persisted form.
 *
 * @since 0.1.0
 * @category Encoding
 */
export const persistObservableSnapshot = (
  snapshot: Snapshot & { readonly context: Option.Option<unknown>; readonly input: unknown }
): Effect.Effect<(typeof ObservableSnapshotCodec)["Encoded"], SerializationError> => encodeObservable(snapshot)

/**
 * Restores an observable or stream snapshot from its persisted form (the values as
 * {@link restoreLogicSnapshot} takes them).
 *
 * @since 0.1.0
 * @category Decoding
 */
export const restoreObservableSnapshot = <TContext, TInput>(
  persisted: unknown
): Effect.Effect<
  Snapshot<undefined> & { readonly context: Option.Option<TContext>; readonly input: TInput },
  RestoreError
> =>
  Effect.map(decodeObservable(persisted), (fields) => ({
    [SnapshotTypeId]: SnapshotTypeId,
    status: fields.status,
    output: fields.output as Option.Option<undefined>,
    error: fields.error,
    context: fields.context as Option.Option<TContext>,
    input: fields.input as TInput,
  }))

/**
 * Encodes a transition logic snapshot to its persisted form.
 *
 * @since 0.1.0
 * @category Encoding
 */
export const persistTransitionSnapshot = (
  snapshot: Snapshot & { readonly context: unknown }
): Effect.Effect<(typeof TransitionSnapshotCodec)["Encoded"], SerializationError> => encodeTransition(snapshot)

/**
 * Restores a transition logic snapshot from its persisted form (the values as
 * {@link restoreLogicSnapshot} takes them).
 *
 * @since 0.1.0
 * @category Decoding
 */
export const restoreTransitionSnapshot = <TContext>(
  persisted: unknown
): Effect.Effect<Snapshot<undefined> & { readonly context: TContext }, RestoreError> =>
  Effect.map(decodeTransition(persisted), (fields) => ({
    [SnapshotTypeId]: SnapshotTypeId,
    status: fields.status,
    output: fields.output as Option.Option<undefined>,
    error: fields.error,
    context: fields.context as TContext,
  }))

// ============================================================
// PENDING DELAYED EVENTS (P4)
// ============================================================

/**
 * The key of an actor's persisted snapshot that holds its pending delayed events.
 *
 * @since 0.1.0
 * @category Models
 */
export const SCHEDULED_EVENTS_KEY = "scheduledEvents"

/** A systemId: a plain string in the persisted form. */
const SystemIdName = Schema.String.annotate({ identifier: "SystemId" })

/** A delayed event's id (`xstate.after.<delay>.<node id>`, a send id, or a generated one). */
const ScheduledEventId = Schema.String.annotate({ identifier: "ScheduledEventId" })

/**
 * The actor a persisted delayed event goes to, named from the actor that scheduled it: the
 * actor itself (`raise` with a delay, `after`), its parent (`sendParent` with a delay), one of
 * its children by id, or the actor the system registers under a systemId.
 *
 * @since 0.1.0
 * @category Codecs
 */
export const PersistedEventTarget = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("self") }),
  Schema.Struct({ kind: Schema.Literal("parent") }),
  Schema.Struct({ kind: Schema.Literal("child"), id: NodeId }),
  Schema.Struct({ kind: Schema.Literal("system"), systemId: SystemIdName }),
]).annotate({ identifier: "PersistedEventTarget" })

/**
 * The target of a persisted delayed event.
 *
 * @since 0.1.0
 * @category Models
 */
export type PersistedEventTarget = (typeof PersistedEventTarget)["Type"]

/** An event object: a value with a string `type`, persisted as it is (the user's own type). */
const PersistedEvent = Schema.declare(
  (u: unknown): u is EventObject => Predicate.hasProperty(u, "type") && Predicate.isString(u.type)
).annotate({ identifier: "PersistedEvent" })

/**
 * One pending delayed event of an actor (upstream `ScheduledEvent` without its `source`, which
 * is the actor whose snapshot holds it): its id, the event, its delay in milliseconds, the
 * time it was scheduled at on the system's clock, and its target.
 *
 * @since 0.1.0
 * @category Codecs
 */
export const PersistedScheduledEvent = Schema.Struct({
  id: ScheduledEventId,
  event: PersistedEvent,
  delay: Schema.Finite,
  startedAt: Schema.Finite,
  target: PersistedEventTarget,
}).annotate({ identifier: "PersistedScheduledEvent" })

/**
 * A pending delayed event of an actor, decoded from its persisted form.
 *
 * @since 0.1.0
 * @category Models
 */
export type PersistedScheduledEvent = (typeof PersistedScheduledEvent)["Type"]

/**
 * The pending delayed events of an actor, in id order.
 *
 * @since 0.1.0
 * @category Codecs
 */
export const PersistedScheduledEvents = Schema.Array(PersistedScheduledEvent).annotate({
  identifier: "PersistedScheduledEvents",
})

/**
 * What names the targets of an actor's delayed events: the actor, its parent, its children
 * (`snapshot.children`) and the system's systemId lookup.
 *
 * @since 0.1.0
 * @category Models
 */
export interface ScheduledEventScope {
  /**
   * The actor whose snapshot persists or restores the events. Only the events whose `source`
   * is this actor persist; the events of other actors in the system are theirs to persist.
   */
  readonly self: ActorRefBase
  /** The actor's parent; none for a root actor, so a `parent` target then resolves to none. */
  readonly parent: Option.Option<ActorRefBase>
  /**
   * The actor's `snapshot.children` by child id, or `{}` for logic without children. A value
   * that is not an actor reference never names a target.
   */
  readonly children: Readonly<Record<string, unknown>>
  /** The system's systemId registry: the actor registered under a systemId, if any. */
  readonly lookup: (systemId: string) => Option.Option<ActorRefBase>
}

/** The systemId an actor reference carries, if any. */
const systemIdOfTarget = (target: ActorRefBase): Option.Option<string> =>
  Predicate.hasProperty(target, "systemId") && Predicate.isString(target.systemId) ? Option.some(target.systemId) : Option.none()

/**
 * Names `target` from `scope`: the actor itself, its parent, its child, or a systemId under
 * which the system holds it; none for any other actor, which a restore could not find.
 */
const nameTarget = (target: ActorRefBase, scope: ScheduledEventScope): Option.Option<PersistedEventTarget> => {
  if (target === scope.self) {
    return Option.some({ kind: "self" })
  }
  if (Option.exists(scope.parent, (parent) => parent === target)) {
    return Option.some({ kind: "parent" })
  }
  return Option.orElse(
    Option.map(
      Arr.findFirst(Object.entries(scope.children), ([, child]) => child === target),
      ([id]): PersistedEventTarget => ({ kind: "child", id })
    ),
    () =>
      Option.map(
        Option.filter(systemIdOfTarget(target), (systemId) => Option.exists(scope.lookup(systemId), (held) => held === target)),
        (systemId): PersistedEventTarget => ({ kind: "system", systemId })
      )
  )
}

/**
 * The actor a persisted target names in `scope`, at restore; none when it names no actor (a
 * child that is gone, no parent, a systemId nobody holds).
 *
 * @since 0.1.0
 * @category Decoding
 */
export const resolveEventTarget = (target: PersistedEventTarget, scope: ScheduledEventScope): Option.Option<ActorRefBase> => {
  switch (target.kind) {
    case "self":
      return Option.some(scope.self)
    case "parent":
      return scope.parent
    case "child":
      return Option.filter(
        Object.hasOwn(scope.children, target.id) ? Option.some(scope.children[target.id]) : Option.none(),
        isActorRef
      )
    case "system":
      return scope.lookup(target.systemId)
  }
}

/** The pending delayed events codec's encoder. */
const encodeScheduledEvents = encoderOf(PersistedScheduledEvents)
/** The pending delayed events codec's decoder; {@link decodeScheduledEvents} picks the key first. */
const decodeScheduledEventList = decoderOf(PersistedScheduledEvents)

/**
 * Encodes the pending delayed events that `scope.self` scheduled, with the restored ones it
 * has not resumed yet (`kept`), in id order, each with its target named from the actor
 * ({@link PersistedEventTarget}). An event to an actor the actor cannot name (outside its
 * parent, its children and the systemIds) is left out, as a restore could not deliver it;
 * upstream persists no delayed event at all.
 *
 * @since 0.1.0
 * @category Encoding
 */
export const persistScheduledEvents = (
  events: ReadonlyArray<ScheduledEvent>,
  scope: ScheduledEventScope,
  kept: ReadonlyArray<PersistedScheduledEvent>
): Effect.Effect<ReadonlyArray<(typeof PersistedScheduledEvent)["Encoded"]>, SerializationError> =>
  encodeScheduledEvents(
    Arr.sort(
      Arr.appendAll(
        kept,
        Arr.getSomes(
          Arr.map(
            Arr.filter(events, (event) => event.source === scope.self),
            ({ id, event, delay, startedAt, target }) =>
              Option.map(nameTarget(target, scope), (named): PersistedScheduledEvent => ({ id, event, delay, startedAt, target: named }))
          )
        )
      ),
      Order.mapInput(Order.String, (event: PersistedScheduledEvent) => event.id)
    )
  )

/**
 * The pending delayed events of a persisted snapshot (its `scheduledEvents` key), decoded
 * through {@link PersistedScheduledEvents}: none for a live machine snapshot, for a value that
 * is not an object, and for a snapshot without the key; a value the codec rejects fails with
 * `RestoreError`.
 *
 * @since 0.1.0
 * @category Decoding
 */
export const decodeScheduledEvents = (persisted: unknown): Effect.Effect<ReadonlyArray<PersistedScheduledEvent>, RestoreError> =>
  Predicate.hasProperty(persisted, SCHEDULED_EVENTS_KEY) && !isMachineSnapshot(persisted) && persisted[SCHEDULED_EVENTS_KEY] !== undefined
    ? decodeScheduledEventList(persisted[SCHEDULED_EVENTS_KEY])
    : Effect.succeed([])

/**
 * A persisted snapshot with the actor's pending delayed events under `scheduledEvents`: the
 * snapshot as it is when there is none or when it is not a plain object.
 *
 * @since 0.1.0
 * @category Encoding
 */
export const withScheduledEvents = (persisted: unknown, events: ReadonlyArray<unknown>): unknown =>
  Arr.isReadonlyArrayNonEmpty(events) && Predicate.isObjectKeyword(persisted) && isPlainObject(persisted)
    ? { ...persisted, [SCHEDULED_EVENTS_KEY]: events }
    : persisted

// ============================================================
// RESTORE VALIDATION (P5, D11)
// ============================================================

/** The root state node above `node`. */
const rootOf = (node: StateNode.Any): StateNode.Any =>
  Option.match(node.parent, { onNone: () => node, onSome: rootOf })

/** Whether the snapshot's configuration completes its machine (upstream status `done`). */
const isMachineComplete = (snapshot: MachineSnapshot): boolean =>
  Option.match(Arr.head(snapshot._nodes), {
    onNone: () => false,
    onSome: (node) => isConfigurationDone(snapshot._nodes, rootOf(node)),
  })

/** The JSON text of a state value. */
const encodeJsonString = Schema.encodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

/**
 * Checks a machine snapshot restored from a persisted form (the opt-in validation of D11,
 * see docs/decisions.md; XState itself restores such a snapshot unchecked): status `done` on
 * a configuration that does not complete the machine (no final child of the root is active;
 * for a parallel root, not every region is complete) fails with
 * {@link InvalidPersistedSnapshotError}. A live snapshot (`persisted` is a
 * `MachineSnapshot`, for example from `resolveState`), a snapshot of other logic and any
 * other status pass as they are.
 *
 * @since 0.1.0
 * @category Decoding
 */
export const validateRestoredSnapshot = <TSnapshot>(
  persisted: unknown,
  restored: TSnapshot
): Effect.Effect<TSnapshot, InvalidPersistedSnapshotError> => {
  if (isMachineSnapshot(persisted) || !isMachineSnapshot(restored) || restored.status !== "done" || isMachineComplete(restored)) {
    return Effect.succeed(restored)
  }
  const machineId = restored.machine.id
  const stateValue = Predicate.isString(restored.value)
    ? restored.value
    : Option.getOrElse(encodeJsonString(restored.value), () => String(restored.value))
  return Effect.fail(
    new InvalidPersistedSnapshotError({
      message: `[Actor] Invalid persisted snapshot: status is 'done' but state '${stateValue}' is not a final state. This actor cannot process any events. If you want to retry/reset this actor, change status to 'active' in the persisted snapshot. Machine: ${machineId}`,
      machineId,
      stateValue,
      status: restored.status,
      suggestedFix: { status: "active" },
    })
  )
}
