/**
 * @since 0.1.0
 * @module testing/SimulatedClock
 *
 * Provides a controllable clock for deterministic testing of state machines.
 */
import { Data, Effect, HashMap, Option } from "effect"

/**
 * Error raised when a SimulatedClock is set to a time earlier than its current time.
 *
 * @since 0.1.0
 * @category Errors
 */
export class TimeTravelError extends Data.TaggedError("TimeTravelError")<{
  readonly message: string
  readonly from: number
  readonly to: number
}> {}

/**
 * Interface for a timeout entry.
 *
 * @since 0.1.0
 * @category Testing
 */
export interface SimulatedTimeout {
  /** The id `setTimeout` gave for this timeout; `clearTimeout` takes it. */
  readonly id: number
  /** The clock's time, in milliseconds, when the timeout was set. */
  readonly start: number
  /** The delay in milliseconds from `start`: the timeout fires once `now() - start >= timeout`. */
  readonly timeout: number
  /**
   * The callback the timeout runs once. The clock removes the timeout before it calls `fn`, so
   * `fn` may set or clear other timeouts. `fn` must not throw: the throw leaves `increment` or
   * `set` with the clock still marked as flushing, so `makeSimulatedClock`'s clock fires no
   * later timeout (upstream's flush behaves the same).
   */
  readonly fn: () => void
}

/**
 * Clock interface for time-based operations.
 *
 * Unlike the `Clock` of the `clock` actor option (`ActorSystem`), this one also tells its time
 * and gives number ids. `makeSimulatedClock` and the `SimulatedClock` class implement it.
 *
 * @since 0.1.0
 * @category Testing
 */
export interface Clock {
  /** The clock's time in milliseconds; a simulated clock starts at 0. */
  readonly now: () => number
  /** Starts a timeout that calls `fn` once `timeout` milliseconds have passed; gives its id. */
  readonly setTimeout: (fn: () => void, timeout: number) => number
  /** Clears the timeout with this id; an id that is unknown or already fired changes nothing. */
  readonly clearTimeout: (id: number) => void
}

/**
 * The synchronous simulated clock that `makeSimulatedClock` makes (a port extra, COMPAT-4):
 * `increment` and `set` fire the due timeouts before they return. The `SimulatedClock` class
 * is the upstream form, whose `increment` and `set` return Effects (SD-28).
 *
 * @since 0.1.0
 * @category Testing
 */
export interface SyncSimulatedClock extends Clock {
  /** Increment the clock time by the given milliseconds */
  readonly increment: (ms: number) => void
  /**
   * Set the clock to a specific time. Returns false and leaves the time
   * unchanged when `ms` is earlier than the current time.
   */
  readonly set: (ms: number) => boolean
  /** Get all pending timeouts */
  readonly getPendingTimeouts: () => ReadonlyArray<SimulatedTimeout>
  /** Clear all pending timeouts */
  readonly clearAllTimeouts: () => void
}

/**
 * Creates a new SimulatedClock instance.
 *
 * A SimulatedClock allows you to control time in tests, making it possible
 * to test delayed events and timeouts without waiting for real time to pass.
 *
 * @example
 * ```ts
 * const clock = makeSimulatedClock()
 *
 * // Schedule a timeout
 * clock.setTimeout(() => console.log("fired!"), 1000)
 *
 * // Advance time - the timeout will fire
 * clock.increment(1000)
 * // logs: "fired!"
 * ```
 *
 * @since 0.1.0
 * @category Testing
 */
export const makeSimulatedClock = (): SyncSimulatedClock => {
  let timeouts: HashMap.HashMap<number, SimulatedTimeout> = HashMap.empty()
  let currentTime = 0
  let nextId = 0
  let flushing = false
  let flushingInvalidated = false

  const flushTimeouts = () => {
    if (flushing) {
      flushingInvalidated = true
      return
    }
    flushing = true

    // Sort timeouts by when they should fire
    const sorted = [...HashMap.entries(timeouts)].sort(([, a], [, b]) => {
      const endA = a.start + a.timeout
      const endB = b.start + b.timeout
      return endA - endB
    })

    for (const [id, timeout] of sorted) {
      if (flushingInvalidated) {
        flushingInvalidated = false
        flushing = false
        flushTimeouts()
        return
      }
      if (currentTime - timeout.start >= timeout.timeout) {
        timeouts = HashMap.remove(timeouts, id)
        timeout.fn()
      }
    }

    flushing = false
  }

  return {
    now: () => currentTime,

    setTimeout: (fn: () => void, timeout: number) => {
      flushingInvalidated = flushing
      const id = nextId++
      timeouts = HashMap.set(timeouts, id, {
        id,
        start: currentTime,
        timeout,
        fn,
      })
      return id
    },

    clearTimeout: (id: number) => {
      flushingInvalidated = flushing
      timeouts = HashMap.remove(timeouts, id)
    },

    increment: (ms: number) => {
      currentTime += ms
      flushTimeouts()
    },

    set: (time: number) => {
      if (currentTime > time) {
        return false
      }
      currentTime = time
      flushTimeouts()
      return true
    },

    getPendingTimeouts: () => [...HashMap.values(timeouts)],

    clearAllTimeouts: () => {
      timeouts = HashMap.empty()
    },
  }
}

/**
 * The port's baseline name of {@link makeSimulatedClock} (a port extra, COMPAT-4).
 *
 * @since 0.1.0
 * @category Testing
 */
export const createSimulatedClock = makeSimulatedClock

/**
 * The port's baseline name of {@link SyncSimulatedClock}, the clock that
 * `createSimulatedClock` makes (a port extra, COMPAT-4). Before the `SimulatedClock` class
 * (SD-28), `testing.createSimulatedClock` named both the factory and the type of its clock.
 *
 * @since 0.1.0
 * @category Testing
 */
export type createSimulatedClock = SyncSimulatedClock

/**
 * Effect-based SimulatedClock that can be used with Effect's testing utilities.
 *
 * @since 0.1.0
 * @category Testing
 */
export interface SimulatedClockEffect {
  /** Get the current time */
  readonly now: Effect.Effect<number>
  /** Schedule a timeout */
  readonly setTimeout: (fn: () => void, timeout: number) => Effect.Effect<number>
  /** Clear a timeout */
  readonly clearTimeout: (id: number) => Effect.Effect<void>
  /** Increment time */
  readonly increment: (ms: number) => Effect.Effect<void>
  /** Set time; fails with TimeTravelError when `ms` is earlier than now */
  readonly set: (ms: number) => Effect.Effect<void, TimeTravelError>
  /** Get pending timeouts */
  readonly getPendingTimeouts: Effect.Effect<ReadonlyArray<SimulatedTimeout>>
  /** Clear all timeouts */
  readonly clearAllTimeouts: Effect.Effect<void>
}

/**
 * Creates an Effect-based SimulatedClock.
 *
 * @example
 * ```ts
 * const program = Effect.gen(function* () {
 *   const clock = yield* makeSimulatedClockEffect
 *
 *   yield* clock.setTimeout(() => console.log("fired!"), 1000)
 *   yield* clock.increment(1000)
 * })
 * ```
 *
 * @since 0.1.0
 * @category Testing
 */
export const makeSimulatedClockEffect: Effect.Effect<SimulatedClockEffect> =
  Effect.sync(() => {
    const clock = makeSimulatedClock()

    return {
      now: Effect.sync(() => clock.now()),
      setTimeout: (fn: () => void, timeout: number) =>
        Effect.sync(() => clock.setTimeout(fn, timeout)),
      clearTimeout: (id: number) => Effect.sync(() => clock.clearTimeout(id)),
      increment: (ms: number) => Effect.sync(() => clock.increment(ms)),
      set: (ms: number) =>
        Effect.suspend(() => {
          const from = clock.now()
          return clock.set(ms)
            ? Effect.void
            : Effect.fail(new TimeTravelError({ message: "Unable to travel back in time", from, to: ms }))
        }),
      getPendingTimeouts: Effect.sync(() => clock.getPendingTimeouts()),
      clearAllTimeouts: Effect.sync(() => clock.clearAllTimeouts()),
    }
  })

// ============================================================
// SIMULATED CLOCK CLASS (upstream `SimulatedClock`, SD-28)
// ============================================================

/** One pending timer of a `SimulatedClock`: what firing it runs, and when it was set. */
interface PendingTimer {
  /** The id the clock gave; ids rise in set order, so a lower id was set first. */
  readonly id: number
  /** The clock's `currentTime`, in milliseconds, when the timer was set. */
  readonly start: number
  /** The delay in milliseconds from `start`; the timer is due once the target reaches the end. */
  readonly timeout: number
  /**
   * What firing the timer runs: `Effect.sync(fn)` for `setTimeout`, or the scheduler's delivery
   * for `_setEffectTimeout`, which the flush waits for before it picks the next timer.
   */
  readonly fire: Effect.Effect<void>
}

/** Whether `timer` fires before `other`: the earlier end, and for the same end the first set. */
const firesBefore = (timer: PendingTimer, other: PendingTimer): boolean => {
  const end = timer.start + timer.timeout
  const otherEnd = other.start + other.timeout
  return end < otherEnd || (end === otherEnd && timer.id < other.id)
}

/** The timer that fires first among `timers` that are due at `now`. */
const firstDue = (timers: HashMap.HashMap<number, PendingTimer>, now: number): Option.Option<PendingTimer> =>
  Array.from(HashMap.values(timers)).reduce<Option.Option<PendingTimer>>(
    (first, timer) =>
      now - timer.start < timer.timeout || Option.exists(first, (current) => !firesBefore(timer, current))
        ? first
        : Option.some(timer),
    Option.none()
  )

/**
 * A clock for tests (upstream `SimulatedClock`): its time moves only when `increment` or
 * `set` moves it. Give it to an actor with `createActor(logic, { clock })`; the actor's system
 * then starts every delayed event on it, and `TestClock.adjust` does not fire them.
 *
 * `increment(ms)` and `set(ms)` return Effects (SD-28). They fire the due timers one at a
 * time, the earliest end first and, for the same end, the first set first (upstream's sort),
 * and wait for the macrostep of each delivered event before they pick the next timer. While
 * a timer fires, `now()` is that timer's end, so a timer that the delivered event's
 * macrostep starts counts from there and, when it is due within the same increment, fires in
 * it too (P11c); upstream counts it from the end of the whole increment. `set` to an earlier
 * time fails with `TimeTravelError` (`Unable to travel back in time`) and keeps the time. A
 * call made while the clock fires its timers moves the end of the move and returns at once;
 * the timers that are then due fire in the call that is firing (upstream's restarted flush).
 *
 * @example
 * ```ts
 * const clock = new SimulatedClock()
 * const actor = yield* createActor(machine, { clock })
 * yield* actor.start
 * yield* clock.increment(1000) // fires the timers due by then
 * ```
 *
 * @since 0.1.0
 * @category Testing
 */
export class SimulatedClock implements Clock {
  /** The pending timers by id. */
  private timers: HashMap.HashMap<number, PendingTimer> = HashMap.empty()
  /** The current time in milliseconds: while timers fire, the end of the one firing. */
  private currentTime = 0
  /** The time the clock moves to: the current time, except while timers fire. */
  private targetTime = 0
  /** The id of the next timer. */
  private nextId = 0
  /** Whether an `increment` or `set` is firing timers now. */
  private flushing = false

  /** The current time in milliseconds, from 0. */
  now(): number {
    return this.currentTime
  }

  /** Starts a timer that calls `fn` once the clock has moved `timeout` milliseconds; gives its id. */
  setTimeout(fn: () => void, timeout: number): number {
    return this.addTimer(Effect.sync(fn), timeout)
  }

  /** Clears the timer with this id; an unknown id changes nothing. */
  clearTimeout(id: unknown): void {
    if (typeof id === "number") {
      this.timers = HashMap.remove(this.timers, id)
    }
  }

  /**
   * Starts a timer that runs `fire` once the clock has moved `timeout` milliseconds; gives its
   * id. The actor system's scheduler uses it, so that an increment waits for the delivery.
   *
   * @internal
   */
  _setEffectTimeout(fire: Effect.Effect<void>, timeout: number): number {
    return this.addTimer(fire, timeout)
  }

  /** Moves the clock `ms` milliseconds forward, firing the timers due on the way (SD-28). */
  increment(ms: number): Effect.Effect<void> {
    return Effect.suspend(() => {
      this.targetTime += ms
      return this.flush()
    })
  }

  /**
   * Moves the clock to `ms`, firing the timers due on the way; an earlier time fails with
   * `TimeTravelError` and keeps the time (SD-28).
   */
  set(ms: number): Effect.Effect<void, TimeTravelError> {
    return Effect.suspend(() => {
      if (this.targetTime > ms) {
        return Effect.fail(new TimeTravelError({ message: "Unable to travel back in time", from: this.targetTime, to: ms }))
      }
      this.targetTime = ms
      return this.flush()
    })
  }

  /** Adds a timer that runs `fire` once `timeout` milliseconds have passed from now. */
  private addTimer(fire: Effect.Effect<void>, timeout: number): number {
    const id = this.nextId
    this.nextId += 1
    this.timers = HashMap.set(this.timers, id, { id, start: this.currentTime, timeout, fire })
    return id
  }

  /**
   * Fires the timers due by the target time one at a time, each at its own end, then sets the
   * time to the target; a flush that is already running picks up the rest.
   */
  private flush(): Effect.Effect<void> {
    if (this.flushing) {
      return Effect.void
    }
    this.flushing = true
    const fireNext: Effect.Effect<void> = Effect.suspend(() =>
      Option.match(firstDue(this.timers, this.targetTime), {
        onNone: () => {
          this.currentTime = this.targetTime
          return Effect.void
        },
        onSome: (timer) => {
          this.timers = HashMap.remove(this.timers, timer.id)
          this.currentTime = Math.max(this.currentTime, timer.start + timer.timeout)
          return Effect.andThen(timer.fire, fireNext)
        },
      })
    )
    return Effect.ensuring(
      fireNext,
      Effect.sync(() => {
        this.currentTime = this.targetTime
        this.flushing = false
      })
    )
  }
}

