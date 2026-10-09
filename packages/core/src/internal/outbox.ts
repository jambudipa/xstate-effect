/**
 * @since 0.1.0
 * @module internal/outbox
 *
 * The deliveries that user code asks for from plain functions — the `emit` of callback, promise,
 * observable and transition logic, a callback's `sendBack`, an observer's `next`, `error` and
 * `complete` — while its actor runs. Upstream calls the actor inside such a function
 * (`actorScope.emit`, `system._relay`), from any code. The port's deliveries are Effects, so such
 * a function is the edge where plain user code calls back into the actor: it runs the delivery
 * at once, in a fiber with the services the actor's `start` runs with (its logger, its clock, and
 * the marker that keeps the sends of its callbacks from waiting, SD-23). That fiber belongs to
 * the actor's scope (D12): the stop interrupts it.
 *
 * Upstream's delivery is a plain call, so an emit made inside a listener reaches its listeners
 * inside that listener, before the next listener of the first emit (depth first). The port
 * does the same: a delivery posted from inside a delivery of the same outbox runs at once.
 */
import { Array as Arr, Context, Effect, Fiber, MutableRef, Option } from "effect"
import type { Scope } from "effect"
import { isolateCallback } from "./reportError.js"

/**
 * An outbox of deliveries, open while the scope it was made in is open.
 *
 * @since 0.1.0
 * @category Internal
 */
export interface Outbox {
  /**
   * Runs a delivery at once, from any code: a delivery that does not wait has run when `post`
   * returns; one that waits (a listener that sleeps) goes on in its fiber. A delivery posted
   * from inside a delivery of this outbox (a listener that emits) runs at once, inside it
   * (upstream: depth first). Otherwise the deliveries of one outbox run one at a time, in post
   * order, so a delivery posted from elsewhere while another runs or waits runs after it. A
   * delivery that fails or dies is reported through the logger (SD-21) and the next one runs.
   * Once the scope has closed, a post is dropped.
   */
  readonly post: (deliver: Effect.Effect<void>) => void
}

/** What an outbox holds: whether it is open, the fiber that runs its deliveries, and those waiting. */
interface OutboxState {
  /** True until the scope closes; a closed outbox drops every post and never opens again. */
  readonly open: boolean
  /** Whether a run of the waiting deliveries is in progress; set by the `post` that starts it. */
  readonly running: boolean
  /**
   * The fiber of the run in progress, kept only while a delivery waits: a run that ends inside
   * the `post` that started it is never recorded. The close interrupts it.
   */
  readonly fiber: Option.Option<Fiber.Fiber<void>>
  /** The deliveries posted from outside a delivery, in post order; the run takes the head first. */
  readonly waiting: ReadonlyArray<Effect.Effect<void>>
}

/** The state of a closed outbox: nothing runs, nothing waits. */
const closed: OutboxState = { open: false, running: false, fiber: Option.none(), waiting: [] }

/** The outbox whose delivery the current fiber runs, by its identity; none outside a delivery. */
const Delivering = Context.Reference<Option.Option<object>>("@xstate-effect/internal/outbox/Delivering", {
  defaultValue: () => Option.none(),
})

/**
 * Makes an outbox in the current scope, with the current services. The scope's close drops what
 * waits, interrupts a delivery that still runs, and drops every later post.
 *
 * @since 0.1.0
 * @category Internal
 */
export const make: Effect.Effect<Outbox, never, Scope.Scope> = Effect.gen(function* () {
  const runFork = Effect.runForkWith(yield* Effect.context())
  const state = MutableRef.make<OutboxState>({ open: true, running: false, fiber: Option.none(), waiting: [] })
  // This outbox's identity in the fiber of each of its deliveries
  const identity: object = {}
  // The fibers of the nested deliveries that still run (they wait)
  const nested = MutableRef.make<ReadonlyArray<Fiber.Fiber<void>>>([])

  yield* Effect.addFinalizer(() =>
    Effect.suspend(() => {
      const fiber = MutableRef.get(state).fiber
      const nestedFibers = MutableRef.get(nested)
      // Closed first, so that the interrupted delivery runs nothing after it
      MutableRef.set(state, closed)
      MutableRef.set(nested, [])
      return Effect.andThen(
        Option.match(fiber, { onNone: () => Effect.void, onSome: Fiber.interrupt }),
        Fiber.interruptAll(nestedFibers)
      )
    })
  )

  /** One delivery, with this outbox marked as the one the fiber delivers for. */
  const delivery = (deliver: Effect.Effect<void>): Effect.Effect<void> =>
    isolateCallback(() => deliver).pipe(Effect.provideService(Delivering, Option.some(identity)))

  /** Whether the current fiber runs a delivery of this outbox (a listener's own code). */
  const insideDelivery = (): boolean =>
    Option.exists(Option.fromUndefinedOr(Fiber.getCurrent()), (fiber) =>
      Option.exists(fiber.getRef(Delivering), (delivering) => delivering === identity)
    )

  /** Runs a delivery posted inside a delivery at once, in its own fiber, which the close interrupts. */
  const runNested = (deliver: Effect.Effect<void>): void => {
    const fiber = runFork(delivery(deliver))
    // A delivery that does not wait has ended already; one that waits is kept until it ends
    if (fiber.pollUnsafe() === undefined) {
      MutableRef.update(nested, (fibers) => [...fibers, fiber])
      fiber.addObserver(() => MutableRef.update(nested, (fibers) => fibers.filter((other) => other !== fiber)))
    }
  }

  /** Takes the next waiting delivery off the outbox; with none waiting, the run ends. */
  const takeNext = (): Option.Option<Effect.Effect<void>> => {
    const current = MutableRef.get(state)
    const next = Arr.head(current.waiting)
    MutableRef.set(
      state,
      Option.isSome(next) ? { ...current, waiting: current.waiting.slice(1) } : { ...current, running: false, fiber: Option.none() }
    )
    return next
  }

  /** Runs every waiting delivery, in order, until none waits. */
  const runWaiting: Effect.Effect<void> = Effect.suspend(() =>
    Option.match(takeNext(), {
      onNone: () => Effect.void,
      // An interruption of one delivery (its own, or the close's) never stops the run: after the
      // close nothing waits
      onSome: (deliver) => Effect.andThen(Effect.exit(delivery(deliver)), runWaiting),
    })
  )

  return {
    post: (deliver) => {
      const current = MutableRef.get(state)
      if (!current.open) {
        return
      }
      if (insideDelivery()) {
        runNested(deliver)
        return
      }
      MutableRef.set(state, { ...current, running: true, waiting: [...current.waiting, deliver] })
      if (current.running) {
        return
      }
      // The fiber runs at once, until a delivery waits or none is left
      const fiber = runFork(runWaiting)
      MutableRef.update(state, (now) => (now.running ? { ...now, fiber: Option.some(fiber) } : now))
    },
  }
})
