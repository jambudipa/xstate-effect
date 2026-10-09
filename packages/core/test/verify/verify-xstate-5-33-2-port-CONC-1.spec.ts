/**
 * CONC-1: events from several fibers are processed one macrostep at a time.
 *
 * T2.43. Upstream `Mailbox` in `src/Mailbox.ts` at xstate@5.33.2 processes one event at a
 * time in arrival order, and `Actor.update` notifies each observer once per processed event.
 * In the port each actor has one processing fiber that takes events from its mailbox in
 * order (D12), so events from one sender keep their send order whatever the other senders
 * do, and a subscriber receives one snapshot per processed event (SD-24). An external send
 * completes after its macrostep commits (SD-23), so the snapshot read after the senders
 * return holds every event. Ordering is proved by these assertions, never by fork timing
 * (@ASSUMPTION:AS2.a): the senders run concurrently and only the per-sender order and the
 * counts are asserted.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { assign, createActor, createMachine } from "../../src/index.js"

interface Seen {
  readonly seen: ReadonlyArray<string>
}

type NoteEvent = { readonly type: "note"; readonly sender: string; readonly n: number }

/** Appends `<sender><n>` to `seen` for each `note`. */
const recorderMachine = () =>
  createMachine<Seen, NoteEvent>({
    id: "conc1-recorder",
    initial: "active",
    context: { seen: [] },
    states: {
      active: {
        on: {
          note: {
            actions: assign<Seen, NoteEvent>(({ context, event }) => ({ seen: [...context.seen, `${event.sender}${event.n}`] })),
          },
        },
      },
    },
  })

const SENDERS = ["a", "b", "c"] as const
const PER_SENDER = 5

/** Lets every other ready fiber take ten turns, so a subscriber takes what it was sent. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 10; turn++) {
    yield* Effect.yieldNow
  }
})

const numbers = Array.from({ length: PER_SENDER }, (_, index) => index + 1)

describe("CONC-1 Events from several fibers are processed one macrostep at a time", () => {
  it.effect("[CONC-1] three fibers sending at the same time: each sender's events are processed in its send order and the subscriber receives one snapshot per processed event", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(recorderMachine())
      yield* actor.start
      const received: Array<number> = []
      yield* actor.subscribe((snapshot) => Effect.sync(() => received.push(snapshot.context.seen.length)))

      yield* Effect.forEach(
        SENDERS,
        (sender) => Effect.forEach(numbers, (n) => actor.send({ type: "note", sender, n }), { discard: true }),
        { concurrency: "unbounded", discard: true }
      )
      // Every send has returned, so every event is processed (SD-23)
      const snapshot = yield* actor.getSnapshot
      yield* settle

      assert.strictEqual(snapshot.context.seen.length, SENDERS.length * PER_SENDER)
      for (const sender of SENDERS) {
        assert.deepStrictEqual(
          snapshot.context.seen.filter((entry) => entry.startsWith(sender)),
          numbers.map((n) => `${sender}${n}`)
        )
      }
      // One snapshot per processed event: each one holds exactly one more event
      assert.deepStrictEqual(received, Array.from({ length: SENDERS.length * PER_SENDER }, (_, index) => index + 1))
    })
  )

  it.effect("[CONC-1] senders that let the others run a different number of turns before each send keep their own send order, one snapshot per event", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(recorderMachine())
      yield* actor.start
      const received: Array<number> = []
      yield* actor.subscribe((snapshot) => Effect.sync(() => received.push(snapshot.context.seen.length)))

      yield* Effect.forEach(
        SENDERS,
        (sender, index) =>
          Effect.forEach(
            numbers,
            (n) =>
              Effect.gen(function* () {
                // Each sender lets the others run a different number of turns
                for (let turn = 0; turn < index + n; turn++) {
                  yield* Effect.yieldNow
                }
                yield* actor.send({ type: "note", sender, n })
              }),
            { discard: true }
          ),
        { concurrency: "unbounded", discard: true }
      )
      const snapshot = yield* actor.getSnapshot
      yield* settle

      assert.strictEqual(snapshot.context.seen.length, SENDERS.length * PER_SENDER)
      for (const sender of SENDERS) {
        assert.deepStrictEqual(
          snapshot.context.seen.filter((entry) => entry.startsWith(sender)),
          numbers.map((n) => `${sender}${n}`)
        )
      }
      assert.deepStrictEqual(received, Array.from({ length: SENDERS.length * PER_SENDER }, (_, index) => index + 1))
    })
  )
})
