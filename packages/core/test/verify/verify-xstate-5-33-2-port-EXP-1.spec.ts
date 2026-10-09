/**
 * EXP-1: every upstream export has a counterpart or a ledger row.
 *
 * T8.2: the type helpers. Upstream exports from its root (`src/types.ts` at xstate@5.33.2)
 * `ContextFrom`, `EventFrom` (with a second parameter that keeps the events of the given
 * types), `InputFrom`, `OutputFrom`, `EmittedFrom`, `MachineImplementationsFrom`,
 * `StateValueFrom`, `TagsFrom`, `SnapshotFrom` and `ActorRefFrom`. The port exports each from
 * its root by the same name, and each resolves as upstream's `test/typeHelpers.test.ts` reads
 * it. Two port facts shape the results: `ContextFrom` and `EventFrom` also read a `setup`
 * return, as the port's setup-only helpers did before (SD-11, DEV-14); and `OutputFrom` is the
 * output type itself, which a done snapshot stores as an `Option` of it (D8, DEV-55). The
 * type-level cases are this file's own type check (`tsc -p tsconfig.test.green.json`; an
 * unused `@ts-expect-error` fails as TS2578); the run-time cases use each resolved type with
 * a running actor.
 *
 * T8.3: the export parity of the six entry points. The export-parity test
 * `test/upstream/exports.test.ts` holds the checks (AC 1 names it): it reads the frozen export
 * lists of the six upstream entry points from the manifest and checks each value name at
 * runtime, the class exports, the root and `./actions` `stop` alias (SD-11), and that
 * `test/upstream/exports.types.ts` imports every upstream type name or the ledger names it.
 * `test/upstream/**` is outside the default run (SD-1), so this evidence file imports the test
 * inside one describe block; its tests run once, here, and their evidence routes to EXP-1.
 * The cases tagged "wiring" pin what the imported checks rely on: the test type-check covers
 * both files (so a missing type and an unused `@ts-expect-error` fail `pnpm typecheck`),
 * neither file is pending or counted among the upstream rewrites, and no CONF evidence file
 * imports the export-parity test (CONF-8 counts only the rewrites).
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  type ActorRefFrom,
  assign,
  type ContextFrom,
  createActor,
  createMachine,
  emit,
  type EmittedFrom,
  type EventFrom,
  fromPromise,
  type InputFrom,
  type MachineImplementationsFrom,
  type OutputFrom,
  setup,
  type SnapshotFrom,
  type StateValue,
  type StateValueFrom,
  type TagsFrom,
} from "../../src/index.js"
import { confEvidenceSources, importsOf } from "./conformance.js"
import { isNonTestFile, listRewriteFiles, PKG_ROOT, readManifest } from "./parity.js"

/** True when `A` and `B` are the same type. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

/** Compiles only for `true`. */
const typeHolds = <T extends true>(holds: T): T => holds

/** The events of the machines below. */
type ProfileEvent =
  | { readonly type: "UPDATE_NAME"; readonly value: string }
  | { readonly type: "UPDATE_AGE"; readonly value: number }
  | { readonly type: "RESET" }

/** A machine with a typed context and typed events (upstream typeHelpers "ContextFrom", "EventFrom"). */
const profileMachine = createMachine({
  types: {} as { context: { readonly name: string; readonly age: number }; events: ProfileEvent },
  context: { name: "", age: 0 },
  on: {
    UPDATE_NAME: { actions: assign(({ event }) => ({ name: event.type === "UPDATE_NAME" ? event.value : "" })) },
  },
})

/** A setup with a typed context and typed events, and a machine of it. */
const profileSetup = setup({
  types: {} as { context: { readonly name: string; readonly age: number }; events: ProfileEvent },
})
const profileSetupMachine = profileSetup.createMachine({ context: { name: "", age: 0 } })

/** A machine with typed tags and typed states (a setup machine types its state values). */
const statusMachine = setup({
  types: {} as { events: { readonly type: "LOAD" }; tags: "idle" | "loading" },
}).createMachine({
  initial: "idle",
  states: {
    idle: { tags: ["idle"], on: { LOAD: "loading" } },
    loading: { tags: ["loading"], initial: "fetching", states: { fetching: {} } },
  },
})

/** A machine with a typed input and output that completes at once. */
const doublingMachine = createMachine({
  types: {} as {
    input: { readonly value: number }
    context: { readonly value: number }
    output: number
  },
  context: ({ input }) => ({ value: input.value }),
  initial: "done",
  states: { done: { type: "final" } },
  output: ({ context }) => context.value * 2,
})

/** A promise logic with a typed input and output. */
const fetchUser = fromPromise(({ input }: { readonly input: { readonly id: string } }) => Promise.resolve(`user-${input.id}`))

/** A machine that emits typed events. */
const savingMachine = createMachine({
  types: {} as { events: { readonly type: "SAVE" }; emitted: { readonly type: "saved"; readonly at: number } },
  on: { SAVE: { actions: emit({ type: "saved", at: 1 }) } },
})

// ---------------------------------------------------------------- the export-parity test

describe("upstream/exports.test.ts", async () => {
  await import("../upstream/exports.test.js")
})

/** A JSON file of the package, parsed. */
const readJson = <A>(relative: string): A => JSON.parse(readFileSync(join(PKG_ROOT, relative), "utf8")) as A

/** The parts of a tsconfig file that the wiring cases read. */
interface TsConfig {
  readonly extends?: string
  readonly include?: ReadonlyArray<string>
  readonly exclude?: ReadonlyArray<string>
}

/** The two files of the export-parity test. */
const EXPORT_FILES = ["test/upstream/exports.test.ts", "test/upstream/exports.types.ts"] as const

describe("EXP-1 Every upstream export has a counterpart or a ledger row", () => {
  // upstream: test/typeHelpers.test.ts > ContextFrom > should return context of a machine
  it.effect("[EXP-1] ContextFrom reads a machine, an actor, a snapshot and a setup return", () =>
    Effect.gen(function* () {
      type Context = { readonly name: string; readonly age: number }
      typeHolds<Equals<ContextFrom<typeof profileMachine>, Context>>(true)
      typeHolds<Equals<ContextFrom<() => typeof profileMachine>, Context>>(true)
      // SD-11: the setup return and its machines keep their context
      typeHolds<Equals<ContextFrom<typeof profileSetup>, Context>>(true)
      typeHolds<Equals<ContextFrom<typeof profileSetupMachine>, Context>>(true)

      const actor = yield* createActor(profileMachine)
      typeHolds<Equals<ContextFrom<typeof actor>, Context>>(true)
      const snapshot = yield* actor.getSnapshot
      typeHolds<Equals<ContextFrom<typeof snapshot>, Context>>(true)

      const acceptContext = (context: ContextFrom<typeof profileMachine>): string => context.name
      // @ts-expect-error a context with an unknown property is not the machine's context
      acceptContext({ name: "a", age: 1, other: "unknown" })
      assert.strictEqual(acceptContext(snapshot.context), "")
    }))

  // upstream: test/typeHelpers.test.ts > EventFrom > should return events for a machine
  // upstream: test/typeHelpers.test.ts > EventFrom > should return events for an interpreter
  it.effect("[EXP-1] EventFrom reads a machine, an actor and a setup return, and keeps the events of given types", () =>
    Effect.gen(function* () {
      typeHolds<Equals<EventFrom<typeof profileMachine>, ProfileEvent>>(true)
      typeHolds<Equals<EventFrom<typeof profileSetup>, ProfileEvent>>(true)
      typeHolds<Equals<EventFrom<typeof profileSetupMachine>, ProfileEvent>>(true)
      // Upstream's second parameter: the events of the given types
      typeHolds<Equals<EventFrom<typeof profileMachine, "UPDATE_NAME">, Extract<ProfileEvent, { readonly type: "UPDATE_NAME" }>>>(
        true
      )
      typeHolds<Equals<EventFrom<typeof profileMachine, "UPDATE_NAME" | "RESET">, Exclude<ProfileEvent, { readonly type: "UPDATE_AGE" }>>>(
        true
      )
      // @ts-expect-error a type the machine does not take
      typeHolds<Equals<EventFrom<typeof profileMachine, "UNKNOWN_EVENT">, never>>(true)

      const actor = yield* createActor(profileMachine)
      typeHolds<Equals<EventFrom<typeof actor>, ProfileEvent>>(true)
      yield* actor.start
      const event: EventFrom<typeof actor, "UPDATE_NAME"> = { type: "UPDATE_NAME", value: "Ada" }
      yield* actor.send(event)
      // @ts-expect-error an event of a type the actor does not take
      const unknown: EventFrom<typeof actor> = { type: "UNKNOWN_EVENT" }
      assert.isDefined(unknown)
      assert.strictEqual((yield* actor.getSnapshot).context.name, "Ada")
    }))

  // upstream: test/typeHelpers.test.ts > MachineImplementationsFrom > should return implementations for a machine
  it.effect("[EXP-1] MachineImplementationsFrom is what provide takes, typed by the machine's context and events", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        types: {} as { context: { readonly count: number }; events: { readonly type: "INC"; readonly by: number } | { readonly type: "RESET" } },
        context: { count: 1 },
        on: { INC: { actions: "increment" }, RESET: { actions: "reset" } },
      })
      const implementations: MachineImplementationsFrom<typeof machine> = {
        actions: {
          increment: assign(({ context, event }) => {
            typeHolds<Equals<typeof context.count, number>>(true)
            typeHolds<Equals<typeof event.type, "INC" | "RESET">>(true)
            return { count: context.count + (event.type === "INC" ? event.by : 0) }
          }),
          reset: assign(() => ({ count: 0 })),
        },
      }
      typeHolds<Equals<MachineImplementationsFrom<() => typeof machine>, MachineImplementationsFrom<typeof machine>>>(true)
      // @ts-expect-error a number is no implementations object
      const wrong: MachineImplementationsFrom<typeof machine> = 100
      assert.isDefined(wrong)

      const actor = yield* createActor(machine.provide(implementations))
      yield* actor.start
      yield* actor.send({ type: "INC", by: 41 })
      assert.strictEqual((yield* actor.getSnapshot).context.count, 42)
      yield* actor.send({ type: "RESET" })
      assert.strictEqual((yield* actor.getSnapshot).context.count, 0)
    }))

  // upstream: test/typeHelpers.test.ts > StateValueFrom > should return any from a machine
  it.effect("[EXP-1] StateValueFrom is what snapshot.matches takes", () =>
    Effect.gen(function* () {
      // A machine built without setup matches any state value
      const plain = createMachine({ initial: "a", states: { a: {} } })
      typeHolds<Equals<StateValueFrom<typeof plain>, StateValue>>(true)
      const anything: StateValueFrom<typeof plain> = "just anything"
      const plainSnapshot = yield* (yield* createActor(plain)).getSnapshot
      assert.isFalse(plainSnapshot.matches(anything))
      assert.isTrue(plainSnapshot.matches("a"))

      // A setup machine matches the values of its states only
      const idle: StateValueFrom<typeof statusMachine> = "idle"
      const fetching: StateValueFrom<typeof statusMachine> = { loading: "fetching" }
      // @ts-expect-error a state the machine does not have
      const unknownState: StateValueFrom<typeof statusMachine> = "unknown"
      assert.isDefined(unknownState)
      const actor = yield* createActor(statusMachine)
      yield* actor.start
      assert.isTrue((yield* actor.getSnapshot).matches(idle))
      yield* actor.send({ type: "LOAD" })
      assert.isTrue((yield* actor.getSnapshot).matches(fetching))
    }))

  // upstream: test/typeHelpers.test.ts > tags > derives string from StateMachine
  it.effect("[EXP-1] TagsFrom is what snapshot.hasTag takes: the machine's tags, any string by default", () =>
    Effect.gen(function* () {
      const plain = createMachine({})
      typeHolds<Equals<TagsFrom<typeof plain>, string>>(true)
      typeHolds<Equals<TagsFrom<typeof statusMachine>, "idle" | "loading">>(true)
      // @ts-expect-error a tag the machine does not declare
      const unknownTag: TagsFrom<typeof statusMachine> = "d"
      assert.isDefined(unknownTag)

      const loading: TagsFrom<typeof statusMachine> = "loading"
      const actor = yield* createActor(statusMachine)
      yield* actor.start
      assert.isFalse((yield* actor.getSnapshot).hasTag(loading))
      yield* actor.send({ type: "LOAD" })
      assert.isTrue((yield* actor.getSnapshot).hasTag(loading))
    }))

  it.effect("[EXP-1] InputFrom and OutputFrom give the input and output types of a logic, a machine and an actor", () =>
    Effect.gen(function* () {
      typeHolds<Equals<InputFrom<typeof fetchUser>, { readonly id: string }>>(true)
      typeHolds<Equals<OutputFrom<typeof fetchUser>, string>>(true)
      typeHolds<Equals<InputFrom<typeof doublingMachine>, { readonly value: number }>>(true)
      typeHolds<Equals<OutputFrom<typeof doublingMachine>, number>>(true)
      typeHolds<Equals<InputFrom<string>, never>>(true)
      typeHolds<Equals<OutputFrom<string>, never>>(true)

      const input: InputFrom<typeof doublingMachine> = { value: 21 }
      const actor = yield* createActor(doublingMachine, { input })
      typeHolds<Equals<OutputFrom<typeof actor>, number>>(true)
      typeHolds<Equals<OutputFrom<ActorRefFrom<typeof doublingMachine>>, number>>(true)
      yield* actor.start
      const snapshot = yield* actor.getSnapshot
      // D8: the done snapshot stores the output as an Option of OutputFrom
      typeHolds<Equals<typeof snapshot.output, Option.Option<OutputFrom<typeof doublingMachine>>>>(true)
      assert.strictEqual(snapshot.status, "done")
      assert.deepStrictEqual(snapshot.output, Option.some(42))
    }))

  it.effect("[EXP-1] EmittedFrom gives the events a logic emits", () =>
    Effect.gen(function* () {
      typeHolds<Equals<EmittedFrom<typeof savingMachine>, { readonly type: "saved"; readonly at: number }>>(true)

      const heard: Array<EmittedFrom<typeof savingMachine>> = []
      const actor = yield* createActor(savingMachine)
      yield* actor.on("saved", (event) => Effect.sync(() => void heard.push(event)))
      yield* actor.start
      yield* actor.send({ type: "SAVE" })
      assert.deepStrictEqual(heard, [{ type: "saved", at: 1 }])
    }))

  // upstream: test/typeHelpers.test.ts > SnapshotFrom > should return state type from a service that has concrete event type
  // upstream: test/typeHelpers.test.ts > ActorRefFrom > should return `ActorRef` based on actor logic
  it.effect("[EXP-1] SnapshotFrom and ActorRefFrom read a machine and an actor", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(profileMachine)
      const snapshot: SnapshotFrom<typeof actor> = yield* actor.getSnapshot
      typeHolds<Equals<SnapshotFrom<typeof actor>, SnapshotFrom<typeof profileMachine>>>(true)
      // @ts-expect-error a string is no snapshot
      const notSnapshot: SnapshotFrom<typeof profileMachine> = "isn't any"
      assert.isDefined(notSnapshot)

      yield* actor.start
      const ref: ActorRefFrom<typeof profileMachine> = actor
      yield* ref.send({ type: "UPDATE_NAME", value: "Grace" })
      assert.strictEqual(snapshot.context.name, "")
      assert.strictEqual((yield* ref.getSnapshot).context.name, "Grace")
    }))

  it.effect("[EXP-1] wiring: the test type-check covers exports.test.ts and exports.types.ts, and the green type-check excludes neither", () =>
    Effect.sync(() => {
      const full = readJson<TsConfig>("tsconfig.test.json")
      assert.include(full.include ?? [], "test/**/*.ts")
      const green = readJson<TsConfig>("tsconfig.test.green.json")
      assert.strictEqual(green.extends, "./tsconfig.test.json")
      for (const file of EXPORT_FILES) {
        assert.notInclude(green.exclude ?? [], file, `${file} is type-checked by pnpm typecheck`)
      }
    }))

  it.effect("[EXP-1] wiring: neither export file is pending, and neither counts among the upstream rewrites", () =>
    Effect.sync(() => {
      const pending = readJson<ReadonlyArray<string>>("test/upstream/pending.json")
      for (const file of EXPORT_FILES) {
        assert.notInclude(pending, file, `${file} is not pending`)
        assert.isTrue(isNonTestFile(file.replace("test/upstream/", "")), `${file} is not an upstream rewrite`)
      }
      const rewrites = listRewriteFiles(join(PKG_ROOT, "test/upstream"))
      assert.notInclude(rewrites, "exports.test.ts")
      assert.notInclude(rewrites, "exports.types.ts")
    }))

  it.effect("[EXP-1] wiring: no CONF evidence file imports the export-parity test", () =>
    Effect.sync(() => {
      const importers = confEvidenceSources(join(PKG_ROOT, "test/verify")).filter(({ file, source }) =>
        importsOf(source, file).some((entry) => entry.file === "exports")
      )
      assert.deepStrictEqual(importers.map(({ file }) => file), [])
    }))

  it.effect("[EXP-1] wiring: the frozen export lists name the six upstream entry points of xstate@5.33.2", () =>
    Effect.sync(() => {
      const manifest = readManifest()
      assert.strictEqual(manifest.upstream.version, "5.33.2")
      assert.deepStrictEqual(Object.keys(manifest.exports).sort(), [".", "./actions", "./actors", "./dev", "./graph", "./guards"])
      // D6: the frozen root lists still name what the port leaves out, so the test cannot pass by omission
      const root = manifest.exports["."]
      assert.isDefined(root)
      assert.includeMembers([...root.values], ["interpret", "toObserver", "stop", "stopChild", "SimulatedClock"])
      assert.include(root.types, "Subscription")
    }))
})
