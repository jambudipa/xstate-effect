/**
 * C17: actor.select emits derived values only when they change.
 *
 * T5.9. Upstream `Actor.select(selector, equalityFn = Object.is)` in `src/createActor.ts` at
 * xstate@5.33.2 returns a `Readable`: `get()` applies the selector to `getSnapshot()`;
 * `subscribe(fn)` reads `selector(getSnapshot())` as the previous value, then subscribes to the
 * actor with `next` only, and for each snapshot calls `fn` with the selected value when
 * `equalityFn(previous, value)` is false, and only then takes it as the previous value. A tsx
 * probe of 5.33.2 (`packages/core/.upstream/measure/t59/probe-up.ts`) gives: `get` is live
 * before start, after events and after stop; nothing at subscription time, nothing at start
 * for a subscriber added before it, nothing for an event that keeps the value; with
 * `|a - b| < 2` as the equality and the values 1, 2, 3 only 2 is given, after the calls
 * `[0, 1]`, `[0, 2]`, `[2, 3]`; one unsubscribed subscriber stops, another goes on; a selector
 * that throws for one snapshot is reported, the actor stays active, and the next value is
 * compared with the last value given; the done snapshot's value is given.
 *
 * Effect form (D6, SD-24, the select.test.ts rewrite): `select` is synchronous; `get` is an
 * Effect value; `subscribe(fn)` is scoped like `actor.subscribe` (closing its scope stands
 * for `unsubscribe`), and its callback runs in its own fiber, so each count is read after
 * every fiber had its turns. The port adds `changes`, the stream form (D6): the selected value
 * of the current snapshot, then each value that differs from the last one given; it ends and
 * fails with the actor's `changes` stream. A selector that throws inside a subscriber is
 * reported through the logger (SD-21). The root type `SnapshotFrom` gives the snapshot type of
 * an actor, an actor logic, or a function that returns one (upstream `SnapshotFrom`).
 */
import { assert, describe, it } from "@effect/vitest"
import { Cause, Deferred, Effect, Exit, Fiber, Logger, Option, Scope, Stream } from "effect"
import { assign, createActor, createMachine, type Readable, type SnapshotFrom } from "../../src/index.js"

/** True when `A` and `B` are the same type. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

/** Compiles only for `true`. */
const typeHolds = <T extends true>(holds: T): T => holds

/** Lets every other ready fiber take a hundred turns, so a subscriber takes what it was sent. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 100; turn++) {
    yield* Effect.yieldNow
  }
})

/** Runs `program` with a logger that keeps every message, with its level. */
const withLogsCaptured = <A, E, R>(program: Effect.Effect<A, E, R>) => {
  const logs: Array<string> = []
  return program.pipe(
    Effect.provide(
      Logger.layer([
        Logger.make((options) => {
          const parts: ReadonlyArray<unknown> = Array.isArray(options.message) ? options.message : [options.message]
          logs.push(`${options.logLevel}: ${parts.map(String).join(" ")}`)
        }),
      ])
    ),
    Effect.map((result) => ({ result, logs }))
  )
}

/**
 * Runs `stream` in a fiber that collects its values, and returns once the stream has given its
 * first value or ended, so the stream reads the actor before the caller goes on.
 */
const collecting = <A, E>(stream: Stream.Stream<A, E>) =>
  Effect.gen(function* () {
    const first = yield* Deferred.make<void>()
    const fiber = yield* Stream.runCollect(Stream.tap(stream, () => Deferred.succeed(first, undefined))).pipe(Effect.forkChild)
    yield* Effect.raceFirst(Deferred.await(first), Effect.asVoid(Fiber.await(fiber)))
    return fiber
  })

/** `Some` of the fiber's exit when it ends while the other fibers take turns, `None` while it still runs. */
const endedWithin = <A, E>(fiber: Fiber.Fiber<A, E>) =>
  Effect.raceFirst(Effect.map(Fiber.await(fiber), Option.some), Effect.as(settle, Option.none<Exit.Exit<A, E>>()))

/**
 * a: INC adds 1 to `count`, SET sets it, OTHER sets `other` (the count stays), BOOM throws
 * from a transition action; FINISH sets `count` to 99 and goes to the final state `done`.
 */
const counterMachine = (boom: Error = new Error("boom")) =>
  createMachine({
    types: {} as {
      context: { count: number; other: string }
      events:
        | { type: "INC" }
        | { type: "SET"; value: number }
        | { type: "OTHER"; value: string }
        | { type: "FINISH" }
        | { type: "BOOM" }
    },
    id: "c17-counter",
    context: { count: 0, other: "x" },
    initial: "a",
    states: {
      a: {
        on: {
          INC: { actions: assign({ count: ({ context }) => context.count + 1 }) },
          SET: { actions: assign({ count: ({ event }) => event.value }) },
          OTHER: { actions: assign({ other: ({ event }) => event.value }) },
          FINISH: { target: "done", actions: assign({ count: () => 99 }) },
          BOOM: {
            actions: () => {
              throw boom
            },
          },
        },
      },
      done: { type: "final" },
    },
  })

describe("C17 actor.select emits derived values only when they change", () => {
  it.effect("[C17] select is synchronous and its get gives the selected value of the live snapshot, before start, after an event and after stop", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(counterMachine())
      const count = actor.select(({ context }) => context.count)
      assert.strictEqual(yield* count.get, 0, "before start")

      yield* actor.start
      yield* actor.send({ type: "INC" })
      assert.strictEqual(yield* count.get, 1, "after INC")

      yield* actor.stop
      const statusAndCount = actor.select((snapshot) => [snapshot.status, snapshot.context.count] as const)
      assert.deepStrictEqual(yield* statusAndCount.get, ["stopped", 1], "after stop")
    }))

  it.effect("[C17] a subscriber receives nothing at subscription time, nothing for an event that keeps the selected value, then each changed value", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(counterMachine())
      yield* actor.start
      const given: Array<number> = []
      yield* actor.select(({ context }) => context.count).subscribe((value) => Effect.sync(() => given.push(value)))

      yield* settle
      assert.deepStrictEqual(given, [], "at subscription")

      yield* actor.send({ type: "OTHER", value: "y" })
      yield* settle
      assert.deepStrictEqual(given, [], "after an event that keeps the count")

      yield* actor.send({ type: "INC" })
      yield* actor.send({ type: "INC" })
      yield* settle
      assert.deepStrictEqual(given, [1, 2], "after two INC events")
    }))

  it.effect("[C17] a subscriber added before start receives nothing at start and each changed value after it", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(counterMachine())
      const given: Array<number> = []
      yield* actor.select(({ context }) => context.count).subscribe((value) => Effect.sync(() => given.push(value)))

      yield* actor.start
      yield* settle
      assert.deepStrictEqual(given, [], "after start")

      yield* actor.send({ type: "INC" })
      yield* settle
      assert.deepStrictEqual(given, [1], "after INC")
    }))

  it.effect("[C17] a custom equality function suppresses equal values and compares each value with the last value given", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(counterMachine())
      yield* actor.start
      const given: Array<number> = []
      const calls: Array<readonly [number, number]> = []
      const near = (a: number, b: number) => {
        calls.push([a, b])
        return Math.abs(a - b) < 2
      }
      yield* actor.select(({ context }) => context.count, near).subscribe((value) => Effect.sync(() => given.push(value)))

      for (const value of [1, 2, 3]) {
        yield* actor.send({ type: "SET", value })
        yield* settle
      }

      assert.deepStrictEqual(given, [2], "only 2 is far enough from the last value given")
      assert.deepStrictEqual(calls, [[0, 1], [0, 2], [2, 3]], "the previous value changes only when a value is given")
    }))

  it.effect("[C17] the default equality is Object.is: a selector that builds a new object gives a value for each published snapshot, also when its members stay", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(counterMachine())
      yield* actor.start
      const given: Array<{ readonly count: number }> = []
      yield* actor
        .select(({ context }) => ({ count: context.count }))
        .subscribe((value) => Effect.sync(() => given.push(value)))

      yield* actor.send({ type: "OTHER", value: "y" })
      yield* actor.send({ type: "OTHER", value: "z" })
      yield* settle

      assert.deepStrictEqual(given, [{ count: 0 }, { count: 0 }], "a new object each time, with the same count")
    }))

  it.effect("[C17] several subscribers each receive the changes, and closing one subscription's scope ends only that subscription", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(counterMachine())
      yield* actor.start
      const count = actor.select(({ context }) => context.count)
      const first: Array<number> = []
      const second: Array<number> = []
      const firstScope = yield* Scope.make()
      yield* count.subscribe((value) => Effect.sync(() => first.push(value))).pipe(Scope.provide(firstScope))
      yield* count.subscribe((value) => Effect.sync(() => second.push(value)))

      yield* actor.send({ type: "INC" })
      yield* settle
      yield* Scope.close(firstScope, Exit.void)
      yield* actor.send({ type: "INC" })
      yield* settle

      assert.deepStrictEqual(first, [1], "the closed subscription")
      assert.deepStrictEqual(second, [1, 2], "the open subscription")
    }))

  it.effect("[C17] a selector that throws for a snapshot is reported through the logger, the actor stays active, and the next value is compared with the last value given", () =>
    Effect.gen(function* () {
      const { result, logs } = yield* withLogsCaptured(
        Effect.gen(function* () {
          const actor = yield* createActor(counterMachine())
          yield* actor.start
          const given: Array<number> = []
          yield* actor
            .select(({ context }) => {
              if (context.count === 1) {
                throw new Error("selector boom")
              }
              return context.count
            })
            .subscribe((value) => Effect.sync(() => given.push(value)))

          yield* actor.send({ type: "INC" })
          yield* settle
          yield* actor.send({ type: "INC" })
          yield* settle
          return { given, status: (yield* actor.getSnapshot).status }
        })
      )

      assert.deepStrictEqual(result.given, [2], "the value after the throw")
      assert.strictEqual(result.status, "active")
      const reported = logs.filter((line) => line.includes("selector boom"))
      assert.strictEqual(reported.length, 1, "reported once")
      assert.match(reported[0] ?? "", /^error/i, "at the error level")
    }))

  it.effect("[C17] the selected value of the done snapshot reaches a subscriber", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(counterMachine())
      yield* actor.start
      const given: Array<number> = []
      const count = actor.select(({ context }) => context.count)
      yield* count.subscribe((value) => Effect.sync(() => given.push(value)))

      yield* actor.send({ type: "FINISH" })
      yield* settle

      assert.deepStrictEqual(given, [99])
      assert.strictEqual((yield* actor.getSnapshot).status, "done")
      assert.strictEqual(yield* count.get, 99)
    }))

  it.effect("[C17] the changes stream gives the current selected value, then each changed value only, and ends when the actor is done", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(counterMachine())
      yield* actor.start
      yield* actor.send({ type: "INC" })
      const fiber = yield* collecting(actor.select(({ context }) => context.count).changes)

      yield* actor.send({ type: "OTHER", value: "y" })
      yield* actor.send({ type: "INC" })
      yield* actor.send({ type: "OTHER", value: "z" })
      yield* actor.send({ type: "FINISH" })

      const ended = yield* endedWithin(fiber)
      assert.isTrue(Option.isSome(ended), "the stream ended")
      const exit = Option.getOrThrow(ended)
      assert.isTrue(Exit.isSuccess(exit), "the stream ended without a failure")
      assert.deepStrictEqual(Exit.isSuccess(exit) ? exit.value : [], [1, 2, 99])
    }))

  it.effect("[C17] the changes stream suppresses the values its equality function finds equal to the last value given", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(counterMachine())
      yield* actor.start
      const fiber = yield* collecting(
        actor.select(({ context }) => context.count, (a, b) => Math.abs(a - b) < 2).changes
      )

      for (const value of [1, 2, 3, 5]) {
        yield* actor.send({ type: "SET", value })
      }
      yield* actor.stop

      const exit = Option.getOrThrow(yield* endedWithin(fiber))
      assert.deepStrictEqual(Exit.isSuccess(exit) ? exit.value : [], [0, 2, 5], "values 1 and 3 are near the last value given")
    }))

  it.effect("[C17] the changes stream fails with the actor's error", () =>
    Effect.gen(function* () {
      const boom = new Error("boom")
      const actor = yield* createActor(counterMachine(boom))
      yield* actor.start
      const fiber = yield* collecting(actor.select(({ context }) => context.count).changes)

      yield* actor.send({ type: "BOOM" })

      const exit = Option.getOrThrow(yield* endedWithin(fiber))
      assert.isTrue(Exit.isFailure(exit), "the stream failed")
      assert.strictEqual(Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined, boom)
    }))

  it.effect("[C17] SnapshotFrom gives the snapshot type of an actor, its logic and a function that returns the logic; select is typed by its selector", () =>
    Effect.gen(function* () {
      const machine = counterMachine()
      const actor = yield* createActor(machine)
      const snapshot = yield* actor.getSnapshot

      typeHolds<Equals<SnapshotFrom<typeof machine>, typeof snapshot>>(true)
      typeHolds<Equals<SnapshotFrom<typeof actor>, typeof snapshot>>(true)
      typeHolds<Equals<SnapshotFrom<typeof counterMachine>, typeof snapshot>>(true)

      const acceptState = (_state: SnapshotFrom<typeof machine>) => true
      assert.isTrue(acceptState(snapshot))
      // @ts-expect-error a string is not the machine's snapshot
      acceptState("isn't any")

      // The selector fixes the value type; the equality function may take a wider type
      const named = actor.select(
        ({ context }: SnapshotFrom<typeof machine>) => ({ count: context.count, other: context.other }),
        (a: { readonly other: string }, b: { readonly other: string }) => a.other === b.other
      )
      typeHolds<Equals<typeof named, Readable<{ count: number; other: string }>>>(true)
      assert.deepStrictEqual(yield* named.get, { count: 0, other: "x" })
    }))
})
