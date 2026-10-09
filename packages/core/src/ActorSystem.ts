/**
 * @since 0.1.0
 * @module ActorSystem
 *
 * ActorSystem manages actor registration, communication, and scheduling.
 */
import {
  Array as Arr,
  Clock as EffectClock,
  Effect,
  Context,
  Layer,
  Ref,
  HashMap,
  MutableHashMap,
  MutableRef,
  Option,
  Fiber,
  Predicate,
  Record,
  Scope,
  Duration,
  pipe,
} from "effect"
import type { ActorRefBase } from "./ActorRef.js"
import type { EventObject } from "./Event.js"
import type { InspectionEvent, InspectionEventInput } from "./inspection.js"
import type { ActorSystemService, ScheduledEvent, SchedulerService } from "./ActorLogic.js"
import { ActorError } from "./Errors.js"
import { hasWaitingDelivery, WaitingDeliveryKey } from "./internal/delivery.js"
import * as Outbox from "./internal/outbox.js"
import { isolateCallback } from "./internal/reportError.js"
import { SimulatedClock } from "./testing/SimulatedClock.js"

// ============================================================
// CLOCK
// ============================================================

/**
 * A clock that starts and clears timers (upstream `Clock`): `setTimeout(fn, timeout)` calls
 * `fn` once after `timeout` milliseconds and gives an id; `clearTimeout(id)` clears that
 * timer. The host's `setTimeout` and `clearTimeout` make one, and so does `SimulatedClock`.
 * Give one to a root actor with the `clock` option: its system then starts every delayed
 * event on it. Without one, timers run on the Effect clock (`TestClock` in tests).
 *
 * @since 0.1.0
 * @category Models
 */
export interface Clock {
  /**
   * Calls `fn` once after `timeout` milliseconds. The id it gives is opaque: only this
   * clock's `clearTimeout` reads it.
   */
  setTimeout(fn: () => void, timeout: number): unknown
  /** Clears the timer of an id this clock's `setTimeout` gave; a fired or unknown id is ignored. */
  clearTimeout(id: unknown): void
}

// ============================================================
// ACTOR SYSTEM TAG
// ============================================================

/**
 * ActorSystem context tag.
 *
 * @since 0.1.0
 * @category Services
 */
export class ActorSystem extends Context.Service<
  ActorSystem,
  ActorSystemService
>()("@xstate-effect/ActorSystem") {}

// ============================================================
// SCHEDULER TAG
// ============================================================

/**
 * Scheduler context tag.
 *
 * @since 0.1.0
 * @category Services
 */
export class Scheduler extends Context.Service<
  Scheduler,
  SchedulerService
>()("@xstate-effect/Scheduler") {}

// ============================================================
// IMPLEMENTATION (one copy behind every constructor and layer)
// ============================================================

/**
 * The actors of one system (upstream `createSystem`): every registered actor by session id
 * (`children`), the actors that have a systemId in registration order (`keyedActors`), and
 * the systemId of each of those by session id (`reverseKeyedActors`).
 */
interface Registry {
  /** Every registered actor by session id (upstream `children`). */
  readonly sessions: HashMap.HashMap<string, ActorRefBase>
  /** The actors that have a systemId, by systemId, in registration order (what `getAll` copies). */
  readonly keyed: Record.ReadonlyRecord<string, ActorRefBase>
  /** The systemId of each keyed actor by its session id, so `unregister` frees that systemId. */
  readonly systemIds: HashMap.HashMap<string, string>
}

/** The registry of a new system: no actors and no systemIds. */
const emptyRegistry: Registry = {
  sessions: HashMap.empty(),
  keyed: Record.empty(),
  systemIds: HashMap.empty(),
}

/** The registry with `actor` under `systemId`, or the error when another actor holds it. */
const setSystemId = (
  registry: Registry,
  systemId: string,
  actor: ActorRefBase
): readonly [Option.Option<ActorError>, Registry] =>
  pipe(
    Record.get(registry.keyed, systemId),
    Option.filter((existing) => existing !== actor),
    Option.match({
      onNone: () => [
        Option.none(),
        {
          ...registry,
          keyed: Record.set(registry.keyed, systemId, actor),
          systemIds: HashMap.set(registry.systemIds, actor.sessionId, systemId),
        },
      ] as const,
      onSome: () => [
        Option.some(
          new ActorError({ message: `Actor with system ID '${systemId}' already exists.`, actorId: actor.id })
        ),
        registry,
      ] as const,
    })
  )

/** The registry without `actor`: neither its session id nor its systemId (upstream `_unregister`). */
const removeActor = (registry: Registry, actor: ActorRefBase): Registry => ({
  sessions: HashMap.remove(registry.sessions, actor.sessionId),
  keyed: Option.match(HashMap.get(registry.systemIds, actor.sessionId), {
    onNone: () => registry.keyed,
    onSome: (systemId) => Record.remove(registry.keyed, systemId),
  }),
  systemIds: HashMap.remove(registry.systemIds, actor.sessionId),
})

/**
 * Delivers a scheduled event to its target. `waiting` is true for a delivery that a
 * `SimulatedClock` increment runs: it waits for the target's macrostep (SD-28).
 */
type Deliver = (source: ActorRefBase, target: ActorRefBase, event: EventObject, waiting: boolean) => Effect.Effect<void>

/**
 * Starts one timer on a clock: after `delayMs` it runs `fire` (with whether the delivery may
 * wait for its macrostep) and it gives the effect that clears the timer.
 */
type StartTimer = (delayMs: number, fire: (waiting: boolean) => Effect.Effect<void>) => Effect.Effect<Effect.Effect<void>>

/**
 * The timers of one clock: how to start one, and the clock's time now in milliseconds, which
 * a scheduled event records as its `startedAt` (P4).
 */
interface Timers {
  /** Starts one timer and gives the effect that clears it. */
  readonly start: StartTimer
  /** The clock's time now, in milliseconds. */
  readonly now: Effect.Effect<number>
}

/**
 * Timers on the Effect clock (no clock option): each one is a fiber of the system's scope,
 * so closing that scope (a root actor's stop) interrupts every timer still
 * pending, and `TestClock` drives them in tests. The time is the Effect clock's.
 */
const effectClockTimers = (systemScope: Scope.Scope): Timers => ({
  start: (delayMs, fire) =>
    Effect.map(
      Effect.forkIn(Effect.andThen(Effect.sleep(Duration.millis(delayMs)), fire(false)), systemScope),
      (fiber) => Effect.asVoid(Fiber.interrupt(fiber))
    ),
  now: EffectClock.currentTimeMillis,
})

/** A clock option that tells its time (a `SimulatedClock` does, upstream's `Clock` need not). */
const hasNow = (clock: Clock): clock is Clock & { readonly now: () => number } =>
  Predicate.hasProperty(clock, "now") && Predicate.isFunction(clock.now)

/**
 * Timers on a clock option (upstream `clock.setTimeout`). A `SimulatedClock` runs the
 * delivery itself when an increment fires the timer, and waits for it (SD-28); any other
 * clock calls a plain function, which posts the delivery to the system's outbox. The time is
 * the clock's own `now()` when it has one (a `SimulatedClock`), else the Effect clock's.
 */
const clockTimers = (clock: Clock, outbox: Outbox.Outbox): Timers => ({
  start: (delayMs, fire) =>
    Effect.sync(() => {
      const timeout =
        clock instanceof SimulatedClock
          ? clock._setEffectTimeout(fire(true), delayMs)
          : clock.setTimeout(() => outbox.post(fire(false)), delayMs)
      return Effect.sync(() => clock.clearTimeout(timeout))
    }),
  now: hasNow(clock) ? Effect.sync(() => clock.now()) : EffectClock.currentTimeMillis,
})

/** One pending scheduled event (upstream `ScheduledEvent`) and the effect that clears its timer. */
interface PendingEvent extends ScheduledEvent {
  /** Clears the event's timer so it never fires; `cancel` runs it after it drops the key. */
  readonly clear: Effect.Effect<void>
}

/** The key of a scheduled event (upstream `createScheduledEventId`). */
const scheduledEventId = (source: ActorRefBase, id: string): string => `${source.sessionId}.${id}`

/**
 * Builds the scheduler of one system (upstream `createSystem` scheduler). A delayed event is
 * keyed by `<sessionId>.<id>`; an anonymous one gets a fresh id that no pending event of its
 * actor holds (a restored event keeps its id, P4). As upstream, scheduling an id that is
 * already pending keeps the older timer running and forgets it: both fire, and a `cancel` of
 * the id clears the newer one only. A fired timer forgets its key. `cancel` clears a timer
 * only when it knows the key (issue #5001). Each pending event records its source, target,
 * event, delay, id and `startedAt`, the clock's time when it was scheduled (P4).
 */
const makeScheduler = (timers: Timers, deliver: Deliver): Effect.Effect<SchedulerService> =>
  Effect.gen(function* () {
    const scheduled = yield* Ref.make(HashMap.empty<string, PendingEvent>())
    const anonymousIds = yield* Ref.make(0)

    const cancel = (source: ActorRefBase, id: string): Effect.Effect<void> =>
      Effect.flatMap(
        Ref.modify(scheduled, (events) => {
          const key = scheduledEventId(source, id)
          return [HashMap.get(events, key), HashMap.remove(events, key)] as const
        }),
        Option.match({ onNone: () => Effect.void, onSome: (event) => event.clear })
      )

    /** The next anonymous id that no pending event of `source` holds. */
    const anonymousId = (source: ActorRefBase): Effect.Effect<string> =>
      Effect.gen(function* () {
        while (true) {
          const id = `xstate.scheduled.${yield* Ref.getAndUpdate(anonymousIds, (n) => n + 1)}`
          if (!HashMap.has(yield* Ref.get(scheduled), scheduledEventId(source, id))) {
            return id
          }
        }
      })

    /** Starts the timer of `event` for `remainingMs` and records it under its key. */
    const startPending = (event: ScheduledEvent, remainingMs: number): Effect.Effect<void> =>
      Effect.gen(function* () {
        const key = scheduledEventId(event.source, event.id)
        const fire = (waiting: boolean) =>
          Effect.andThen(Ref.update(scheduled, HashMap.remove(key)), deliver(event.source, event.target, event.event, waiting))
        const clear = yield* timers.start(remainingMs, fire)
        yield* Ref.update(scheduled, HashMap.set(key, { ...event, clear }))
      })

    return {
      schedule: (source, target, event, delayMs, id) =>
        Effect.gen(function* () {
          const eventId = Option.isSome(id) ? id.value : yield* anonymousId(source)
          const startedAt = yield* timers.now
          yield* startPending({ source, target, event, delay: delayMs, id: eventId, startedAt }, delayMs)
        }),

      cancel,

      cancelAll: (actor) =>
        Effect.flatMap(Ref.get(scheduled), (events) =>
          Effect.forEach(
            Array.from(HashMap.values(events)).filter((event) => event.source === actor),
            (event) => cancel(actor, event.id),
            { discard: true }
          )
        ),

      resume: (event) =>
        Effect.flatMap(timers.now, (now) => {
          const remainingMs = event.startedAt + event.delay - now
          return remainingMs > 0
            ? startPending(event, remainingMs)
            : deliver(event.source, event.target, event.event, false)
        }),

      scheduledEvents: Effect.map(Ref.get(scheduled), (events) =>
        Object.fromEntries(
          Array.from(events, ([key, { source, target, event, delay, id, startedAt }]) => [
            key,
            { source, target, event, delay, id, startedAt },
          ])
        )
      ),
    }
  })

/**
 * The system's default clock as a `Clock` object, for `actor.clock` without a clock option:
 * its timers run on the Effect clock, in fibers of the system's scope that the outbox starts.
 * The system's own scheduler does not use it; it sleeps on the Effect clock directly.
 */
const effectClock = (outbox: Outbox.Outbox, systemScope: Scope.Scope): Clock => {
  const nextId = MutableRef.make(0)
  const timers = MutableHashMap.empty<number, Fiber.Fiber<void>>()
  return {
    setTimeout: (fn, timeout) => {
      const id = MutableRef.getAndIncrement(nextId)
      outbox.post(
        Effect.flatMap(
          Effect.forkIn(
            Effect.sleep(Duration.millis(timeout)).pipe(
              Effect.andThen(isolateCallback(() => Effect.sync(fn))),
              Effect.ensuring(Effect.sync(() => MutableHashMap.remove(timers, id)))
            ),
            systemScope
          ),
          (fiber) => Effect.sync(() => MutableHashMap.set(timers, id, fiber))
        )
      )
      return id
    },
    clearTimeout: (id) => {
      outbox.post(
        Effect.suspend(() =>
          Option.match(Predicate.isNumber(id) ? MutableHashMap.get(timers, id) : Option.none(), {
            onNone: () => Effect.void,
            onSome: (fiber) => Effect.asVoid(Fiber.interrupt(fiber)),
          })
        )
      )
    },
  }
}

/**
 * One registration of an inspection function (upstream `toObserver(fn)`, a new observer per
 * `inspect` call): the same function registered twice is two registrations. `order` numbers
 * the registrations of a system from 0, in registration order.
 */
interface InspectionRegistration {
  /** The registration's number in its system: unique, and increasing in registration order. */
  readonly order: number
  /** The inspection function; its failures are isolated and logged (SD-21). */
  readonly observer: (event: InspectionEvent) => Effect.Effect<void>
}

/** The registrations of one system, in registration order, and the number of the next one. */
interface InspectionRegistrations {
  /** The `order` the next registration gets; it only grows, so a removed number never returns. */
  readonly next: number
  /** The live registrations, sorted by `order`. */
  readonly registrations: ReadonlyArray<InspectionRegistration>
}

/**
 * The inspection registrations of one system, how to add one, the function that reports to
 * them, and how the system names its root actor.
 */
interface Inspection {
  /**
   * Registers `observer` until the current scope closes (upstream `inspect`); the close
   * removes that registration only.
   */
  readonly add: (
    observer: (event: InspectionEvent) => Effect.Effect<void>
  ) => Effect.Effect<void, never, Scope.Scope>
  /** Reports `event` with `rootId`, the session id of the system's root actor. */
  readonly send: (event: InspectionEventInput) => Effect.Effect<void>
  /**
   * Notes a session id the system booked: the first one is the root actor's (upstream
   * `rootActor.sessionId`), since a root actor books its id right after it creates the system.
   */
  readonly booked: (sessionId: string) => Effect.Effect<void>
}

/**
 * Builds the inspection of one new system: no registrations, and no root id until the system
 * books its first session id. Each run gives a separate inspection.
 */
const makeInspection: Effect.Effect<Inspection> = Effect.gen(function* () {
  const state = yield* Ref.make<InspectionRegistrations>({ next: 0, registrations: [] })
  const rootId = yield* Ref.make(Option.none<string>())

  /**
   * Runs the first registration after `after` (by `order`), then the ones after it, each to its
   * end before the next starts (upstream `Set.forEach`): one added while the event goes round
   * runs too, and one removed before its turn does not. An inspection function that throws,
   * fails or dies is reported through the logger and changes nothing for the actor that sent
   * the event or for the functions after it (SD-21).
   */
  const sendFrom = (event: InspectionEvent, after: number): Effect.Effect<void> =>
    Effect.flatMap(Ref.get(state), ({ registrations }) =>
      Option.match(
        Arr.findFirst(registrations, (registration) => registration.order > after),
        {
          onNone: () => Effect.void,
          onSome: (registration) =>
            Effect.andThen(
              isolateCallback(() => registration.observer(event)),
              Effect.suspend(() => sendFrom(event, registration.order))
            ),
        }
      )
    )

  return {
    // The registration lasts until the scope it is added in closes; the close removes that
    // registration only
    add: (observer) =>
      Effect.flatMap(
        Ref.modify(state, ({ next, registrations }) => [
          next,
          { next: next + 1, registrations: [...registrations, { order: next, observer }] },
        ]),
        (order) =>
          Effect.addFinalizer(() =>
            Ref.update(state, (current) => ({
              ...current,
              registrations: current.registrations.filter((registration) => registration.order !== order),
            }))
          )
      ),
    // Upstream `sendInspectionEvent`: `{ ...event, rootId: rootActor.sessionId }`. Every actor
    // of the system books its session id before it sends an event, so the root id is known
    send: (event) =>
      Effect.flatMap(Ref.get(rootId), (root) =>
        sendFrom({ ...event, rootId: Option.getOrElse(root, () => "") }, -1)
      ),
    booked: (sessionId) => Ref.update(rootId, (root) => Option.orElse(root, () => Option.some(sessionId))),
  }
})

/**
 * Relays an event from one actor to another (upstream `_relay`): the inspection functions see
 * it with its source (`@xstate.event`, once per event), then the target receives it.
 * `waiting` makes the delivery wait for the target's macrostep; every other relay only queues
 * it (SD-23).
 */
const relayThrough =
  (inspection: Inspection): Deliver =>
  (source, target, event, waiting) =>
    Effect.andThen(
      inspection.send({ type: "@xstate.event", sourceRef: Option.some(source), actorRef: target, event }),
      waiting && hasWaitingDelivery(target) ? target[WaitingDeliveryKey](event) : target.sendUntyped(event)
    )

/** Builds one system around `scheduler` (upstream `createSystem`). */
const makeSystem = (
  scheduler: SchedulerService,
  inspection: Inspection,
  clock: Clock,
  logger: Option.Option<(...args: ReadonlyArray<unknown>) => void>
): Effect.Effect<ActorSystemService> =>
  Effect.gen(function* () {
    // Every registry change is one atomic Ref update, so concurrent actors never see half
    // of a registration
    const registry = yield* Ref.make(emptyRegistry)

    // ID counter
    const idCounter = yield* Ref.make(0)

    const relay = relayThrough(inspection)

    return {
      // Session ids per system in the XState format `x:<n>`, from `x:0` (SD-9)
      generateId: pipe(
        Ref.getAndUpdate(idCounter, (n) => n + 1),
        Effect.map((n) => `x:${n}`),
        Effect.tap(inspection.booked)
      ),

      register: (sessionId, actor) =>
        Ref.update(registry, (current) => ({ ...current, sessions: HashMap.set(current.sessions, sessionId, actor) })).pipe(
          Effect.as(sessionId)
        ),

      unregister: (actor) => Ref.update(registry, (current) => removeActor(current, actor)),

      _set: (systemId, actor) =>
        Ref.modify(registry, (current) => setSystemId(current, systemId, actor)).pipe(
          Effect.flatMap(Option.match({ onNone: () => Effect.void, onSome: Effect.fail }))
        ),

      get: <T extends ActorRefBase>(systemId: string) =>
        Effect.map(Ref.get(registry), (current) => Record.get(current.keyed, systemId) as Option.Option<T>),

      _lookup: (systemId) => Record.get(Ref.getUnsafe(registry).keyed, systemId),

      // A new record per call, so a caller cannot change the registry through it
      getAll: Effect.map(Ref.get(registry), (current) => ({ ...current.keyed })),

      relay: (source, target, event) => relay(source, target, event, false),

      scheduler,

      // Upstream `getSnapshot`: a copy of the pending delayed events
      getSnapshot: Effect.map(scheduler.scheduledEvents, (scheduledEvents) => ({ _scheduledEvents: scheduledEvents })),

      _clock: clock,

      _logger: logger,

      // Upstream `inspect`: each call is its own registration, after the ones before it
      inspect: inspection.add,

      _sendInspectionEvent: inspection.send,
    }
  })

/**
 * The outbox of a system, in the system's scope: what a clock's plain timer callback posts runs
 * at once, inside the callback (upstream relays inside it).
 */
const makeSystemOutbox: Effect.Effect<Outbox.Outbox, never, Scope.Scope> = Outbox.make

// ============================================================
// SCHEDULER LIVE LAYER
// ============================================================

/**
 * Live implementation of the Scheduler service: timers on the Effect clock, in the layer's
 * scope. Without a system it delivers each event straight to its target.
 *
 * @since 0.1.0
 * @category Layers
 */
export const SchedulerLive: Layer.Layer<Scheduler> = Layer.effect(
  Scheduler,
  Effect.flatMap(Effect.scope, (scope) =>
    makeScheduler(effectClockTimers(scope), (_source, target, event) => target.sendUntyped(event))
  )
)

// ============================================================
// ACTOR SYSTEM LIVE LAYER
// ============================================================

/**
 * Live implementation of the ActorSystem service, around the Scheduler service in context.
 *
 * @since 0.1.0
 * @category Layers
 */
export const ActorSystemLive: Layer.Layer<ActorSystem, never, Scheduler> = Layer.effect(
  ActorSystem,
  Effect.gen(function* () {
    const scheduler = yield* Scheduler
    const inspection = yield* makeInspection
    const outbox = yield* makeSystemOutbox
    return yield* makeSystem(scheduler, inspection, effectClock(outbox, yield* Effect.scope), Option.none())
  })
)

// ============================================================
// COMPLETE ACTOR SYSTEM LAYER
// ============================================================

/**
 * Complete ActorSystem layer with all dependencies.
 *
 * @since 0.1.0
 * @category Layers
 */
export const Live: Layer.Layer<ActorSystem | Scheduler> = Layer.merge(
  SchedulerLive,
  Layer.provide(ActorSystemLive, SchedulerLive)
)

// ============================================================
// ACTOR SYSTEM UTILITIES
// ============================================================

/**
 * Options of a standalone actor system.
 *
 * @since 0.1.0
 * @category Models
 */
export interface ActorSystemOptions {
  /** The clock every delayed event of the system starts on; the Effect clock without one. */
  readonly clock?: Clock
  /**
   * The function every `log` action of the system calls (upstream `logger`), unless its
   * actor has its own; Effect logging without one.
   */
  readonly logger?: (...args: ReadonlyArray<unknown>) => void
}

/**
 * Creates a standalone ActorSystem service with its own scheduler (not using Layers). Each
 * root actor creates its system this way, with its `clock` and `logger` options (upstream
 * `createSystem`).
 * The system's scope (the current one) holds its timers and its outbox.
 *
 * @since 0.1.0
 * @category Constructors
 */
export const makeActorSystem = (options?: ActorSystemOptions): Effect.Effect<ActorSystemService, never, Scope.Scope> =>
  Effect.gen(function* () {
    const systemScope = yield* Effect.scope
    const outbox = yield* makeSystemOutbox
    const inspection = yield* makeInspection
    const clock = Option.fromNullishOr(options?.clock)
    const scheduler = yield* makeScheduler(
      Option.match(clock, {
        onNone: () => effectClockTimers(systemScope),
        onSome: (given) => clockTimers(given, outbox),
      }),
      relayThrough(inspection)
    )
    return yield* makeSystem(
      scheduler,
      inspection,
      Option.getOrElse(clock, () => effectClock(outbox, systemScope)),
      Option.fromNullishOr(options?.logger)
    )
  })
