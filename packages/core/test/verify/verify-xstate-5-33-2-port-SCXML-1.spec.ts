/**
 * SCXML-1: the SCXML conformance suite passes (T4.10, T4.22, D4, SD-14).
 *
 * Upstream converts each SCXML document of the SCION and W3C suites with the unexported
 * `toMachine` of `src/scxml.ts` (xstate@5.33.2). The port keeps that converter as test
 * support, `test/upstream/support/scxml.ts`, so the package holds no SCXML converter and no
 * `eval` (D4, DELIVERY-1). The first block checks the conversion itself: the element
 * mapping, `sanitizeStateId`, the wildcard form of each event descriptor, the clear failure
 * for an SCXML feature it does not convert, and the one local override fixture that the
 * runner reads in place of the package's version.
 *
 * The second block checks the upstream table as a whole (T4.22): its 24 groups and 169
 * cases convert, the delayed sends the SimulatedClock cases depend on convert to the right
 * milliseconds, and what the runner itself relies on works: a done actor ends its `changes`
 * stream (the runner's completion signal), and `createActor`, `root` and `config` take an
 * `AnyStateMachine`. The suite's own cases are not run here: they run once, through CONF-4's
 * import of `test/upstream/scxml.test.ts` (SD-1). This file pins that run set: it reads the
 * rewrite's `testGroups` literal and its `onlyTests` list through the TypeScript syntax tree,
 * and the table must equal the frozen upstream table with `onlyTests` empty, so the cases
 * CONF-4 runs are exactly the 169 upstream cases, each once.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Fiber, Option, Stream } from "effect"
import { TestClock } from "effect/testing"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import * as Package from "../../src/index.js"
import {
  type AnyMachineSnapshot,
  type AnyStateMachine,
  createActor,
  getStateNodes,
  isStateMachine,
  SimulatedClock
} from "../../src/index.js"
import { sanitizeStateId, toMachine } from "../upstream/support/scxml.js"
import { readLedger, readManifest } from "./parity.js"

const PKG_ROOT = fileURLToPath(new URL("../../", import.meta.url))

// The SCION fixtures, located as the runner locates them (SD-14)
const TEST_FRAMEWORK = dirname(createRequire(import.meta.url).resolve("@scion-scxml/test-framework/package.json"))

const OVERRIDES_DIR = join(PKG_ROOT, "test/upstream/fixtures/scxml")

const scxml = (body: string, attributes = 'initial="a"'): string =>
  `<?xml version="1.0" encoding="UTF-8"?>
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" ${attributes}>
${body}
</scxml>`

/** The type of each action of a list (an array, or a transition's `Chunk`), in order. */
const actionTypes = (actions: Iterable<unknown>): ReadonlyArray<string> =>
  Array.from(actions, (action) =>
    typeof action === "object" && action !== null && "type" in action ? String(action.type) : typeof action
  )

/** The ids of the state nodes a state value names, as the runner reads a configuration. */
const configurationIds = (machine: ReturnType<typeof toMachine>, value: Package.StateValue) =>
  Effect.map(getStateNodes(machine.root, value), (nodes) => nodes.map((node) => node.id))

const walkFiles = (dir: string): ReadonlyArray<string> =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walkFiles(join(dir, entry.name)) : [join(dir, entry.name)]
  )

describe("SCXML-1 The SCXML conformance suite passes: the converter", () => {
  it.effect("[SCXML-1] toMachine converts states, parallel, final and history states, the initial state and the datamodel into a port machine", () =>
    Effect.gen(function* () {
      const machine = toMachine(
        scxml(`
  <datamodel>
    <data id="x" expr="1"/>
    <data id="list" expr="[1, 2]"/>
    <data id="unset"/>
  </datamodel>
  <state id="a">
    <transition event="go" target="b"/>
  </state>
  <state id="b">
    <initial><transition target="b2"/></initial>
    <state id="b1"/>
    <state id="b2"/>
    <history id="h" type="deep"><transition target="b1"/></history>
    <history id="hs"/>
  </state>
  <parallel id="p">
    <state id="r1"/>
    <state id="r2"/>
  </parallel>
  <state id="implicit">
    <state id="first"/>
    <state id="second"/>
  </state>
  <final id="done"/>`)
      )

      assert.isTrue(isStateMachine(machine))
      assert.strictEqual(machine.id, "(machine)")
      assert.deepStrictEqual(Object.keys(machine.root.states), ["a", "b", "p", "implicit", "done"])
      assert.deepStrictEqual(Object.keys(machine.root.states.b!.states), ["b1", "b2", "h", "hs"])

      const { b, p, done, implicit } = machine.root.states
      assert.strictEqual(b!.type, "compound")
      // `<initial>` names the initial state; without it the first child state is initial
      assert.strictEqual(b!.config.initial, "b2")
      assert.strictEqual(implicit!.config.initial, "first")
      assert.strictEqual(p!.type, "parallel")
      assert.deepStrictEqual(Object.keys(p!.states), ["r1", "r2"])
      assert.strictEqual(done!.type, "final")

      // A history state keeps its kind (shallow when not given) and its default target
      const h = b!.states.h!
      const hs = b!.states.hs!
      assert.strictEqual(h.type, "history")
      assert.strictEqual(h.history, "deep")
      assert.deepStrictEqual(h.target, Option.some("#b1"))
      assert.strictEqual(hs.history, "shallow")
      assert.deepStrictEqual(hs.target, Option.none())

      // The datamodel is the context; a `<data>` without `expr` is undefined
      const actor = yield* createActor(machine)
      yield* actor.start
      const snapshot = yield* actor.getSnapshot
      assert.deepStrictEqual(snapshot.context, { x: 1, list: [1, 2], unset: undefined })
      assert.deepStrictEqual(snapshot.value, "a")

      // A target is the `#id` of an SCXML state id; entering b enters its initial state b2
      yield* actor.send({ type: "go" })
      assert.deepStrictEqual((yield* actor.getSnapshot).value, { b: "b2" })
    })
  )

  it.effect("[SCXML-1] toMachine converts transitions: event lists, targets, cond, type internal, eventless and done events", () =>
    Effect.gen(function* () {
      const machine = toMachine(
        scxml(`
  <datamodel><data id="n" expr="0"/></datamodel>
  <state id="a">
    <transition event="one two" target="c2 d2"/>
    <transition event="stay" type="internal"/>
    <transition event="guarded" cond="n &gt; 0" target="b"/>
    <transition event="done.state.a" target="b"/>
    <transition event="done.invoke.child" target="b"/>
    <transition cond="n === 99" target="b"/>
  </state>
  <parallel id="b">
    <state id="r1"><state id="c1"/><state id="c2"/></state>
    <state id="r2"><state id="d1"/><state id="d2"/></state>
  </parallel>`)
      )
      const a = machine.root.states.a!
      const transitionsOf = (descriptor: string) =>
        a.transitions.find(([known]) => known === `${descriptor}.*`)?.[1] ?? []

      // One transition per event of the list, each with every target of the list
      for (const descriptor of ["one", "two"]) {
        const [transition] = transitionsOf(descriptor)
        assert.deepStrictEqual(
          transition!.target?.map((node) => node.id),
          ["c2", "d2"]
        )
        // A transition without type="internal" is external: it re-enters its source
        assert.isTrue(transition!.reenter)
        assert.isTrue(Option.isNone(transition!.guard))
      }
      const [stay] = transitionsOf("stay")
      assert.isFalse(stay!.reenter)
      assert.isUndefined(stay!.target)
      assert.isTrue(Option.isSome(transitionsOf("guarded")[0]!.guard))

      // SCXML's done events take the XState event types
      assert.strictEqual(transitionsOf("xstate.done.state.a").length, 1)
      assert.strictEqual(transitionsOf("xstate.done.actor.child").length, 1)

      // A transition without an event is eventless
      assert.strictEqual(a.always.length, 1)
      assert.isTrue(Option.isSome(a.always[0]!.guard))

      // cond is an expression over the datamodel: n is 0, so "guarded" is not taken
      const actor = yield* createActor(machine)
      yield* actor.start
      yield* actor.send({ type: "guarded" })
      assert.deepStrictEqual((yield* actor.getSnapshot).value, "a")
      yield* actor.send({ type: "two" })
      assert.deepStrictEqual((yield* actor.getSnapshot).value, { b: { r1: "c2", r2: "d2" } })
    })
  )

  it.effect("[SCXML-1] toMachine converts onentry, onexit and transition content: raise, assign, cancel, send, log and if/elseif/else", () =>
    Effect.gen(function* () {
      const machine = toMachine(
        scxml(
          `
  <datamodel>
    <data id="trail" expr="[]"/>
    <data id="n" expr="0"/>
    <data id="branch"/>
    <data id="got"/>
  </datamodel>
  <state id="idle">
    <onentry><assign location="n" expr="n + 1"/></onentry>
    <onexit><assign location="trail" expr="trail.concat(['exit idle'])"/></onexit>
    <transition event="start" target="running">
      <assign location="trail" expr="trail.concat(['start'])"/>
      <raise event="ping"/>
      <send event="data"><param name="value" expr="n * 10"/></send>
      <send event="timeout" delay="100ms" id="timeout"/>
      <send event="late" delay="200ms" id="late"/>
      <send event="internal" target="#_internal"/>
    </transition>
  </state>
  <state id="running">
    <onentry>
      <if cond="n === 0">
        <assign location="branch" expr="'if'"/>
      <elseif cond="n === 1"/>
        <assign location="branch" expr="'elseif'"/>
      <else/>
        <assign location="branch" expr="'else'"/>
      </if>
      <cancel sendid="late"/>
      <log label="n" expr="n"/>
    </onentry>
    <transition event="ping" type="internal"><assign location="trail" expr="trail.concat(['ping'])"/></transition>
    <transition event="internal" type="internal"><assign location="trail" expr="trail.concat(['internal'])"/></transition>
    <transition event="data" type="internal"><assign location="got" expr="_event.data.value"/></transition>
    <transition event="timeout" target="finished"/>
  </state>
  <state id="finished">
    <transition event="late" target="tooLate"/>
  </state>
  <state id="tooLate"/>`,
          'initial="idle"'
        )
      )

      // Each element becomes the port action of the same kind; `<send>` to `#_internal` raises
      const { idle, running } = machine.root.states
      assert.deepStrictEqual(actionTypes(idle!.entry), ["xstate.assign"])
      assert.deepStrictEqual(actionTypes(idle!.exit), ["xstate.assign"])
      assert.deepStrictEqual(actionTypes(idle!.transitions.find(([descriptor]) => descriptor === "start.*")![1][0]!.actions), [
        "xstate.assign",
        "xstate.raise",
        "xstate.sendTo",
        "xstate.sendTo",
        "xstate.sendTo",
        "xstate.raise"
      ])
      assert.deepStrictEqual(actionTypes(running!.entry), ["xstate.enqueueActions", "xstate.cancel", "xstate.log"])

      // The converted machine runs: exit, transition content, entry, then the raised events,
      // then the sent event; the delayed send arrives on time and the cancelled one never
      const clock = new SimulatedClock()
      const actor = yield* createActor(machine, { clock })
      yield* actor.start
      yield* actor.send({ type: "start" })
      // The machine's send to itself is queued (SD-23): a later external event follows it,
      // so that event's send completes once "data" is processed
      yield* actor.send({ type: "sync" })
      const afterStart = yield* actor.getSnapshot
      assert.deepStrictEqual(afterStart.value, "running")
      assert.deepStrictEqual(afterStart.context, {
        trail: ["exit idle", "start", "ping", "internal"],
        n: 1,
        branch: "elseif",
        got: 10
      })

      yield* clock.increment(100)
      assert.deepStrictEqual((yield* actor.getSnapshot).value, "finished")
      yield* clock.increment(200)
      assert.deepStrictEqual((yield* actor.getSnapshot).value, "finished")
    })
  )

  it("[SCXML-1] sanitizeStateId turns each '.' of an SCXML state id into '$', which the converter uses for keys, ids and targets", () => {
    assert.strictEqual(sanitizeStateId("a.b.c"), "a$b$c")
    assert.strictEqual(sanitizeStateId("plain"), "plain")
    assert.strictEqual(sanitizeStateId(""), "")

    const machine = toMachine(
      scxml(`
  <state id="s.one" initial="s.one.a">
    <state id="s.one.a"><transition event="next" target="s.one.b"/></state>
    <state id="s.one.b"/>
    <history id="s.one.h"><transition target="s.one.b"/></history>
  </state>`, 'initial="s.one"')
    )
    const outer = machine.root.states["s$one"]!
    assert.deepStrictEqual(Object.keys(machine.root.states), ["s$one"])
    assert.deepStrictEqual(Object.keys(outer.states), ["s$one$a", "s$one$b", "s$one$h"])
    assert.strictEqual(outer.id, "s$one")
    assert.strictEqual(outer.config.initial, "s$one$a")
    assert.deepStrictEqual(outer.states["s$one$h"]!.target, Option.some("#s$one$b"))
    const [next] = outer.states["s$one$a"]!.transitions.find(([descriptor]) => descriptor === "next.*")![1]
    assert.deepStrictEqual(
      next!.target?.map((node) => node.id),
      ["s$one$b"]
    )
  })

  it.effect("[SCXML-1] every event descriptor gets its wildcard form after the machine is built, so it matches its own event and the events below it", () =>
    Effect.gen(function* () {
      const document = scxml(`
  <state id="a">
    <transition event="go" target="b"/>
    <transition event="err.*" target="c"/>
    <transition event="*" target="d"/>
    <transition event="done.state.a" target="b"/>
  </state>
  <state id="b"/>
  <state id="c"/>
  <state id="d"/>`)
      const machine = toMachine(document)
      const a = machine.root.states.a!

      // In declaration order: `foo` becomes `foo.*`; `*` and a descriptor ending in `.*` stay
      assert.deepStrictEqual(
        a.transitions.map(([descriptor]) => descriptor),
        ["go.*", "err.*", "*", "xstate.done.state.a.*"]
      )
      // As upstream, the step runs after createMachine: the machine's events and each
      // transition's event type keep the descriptors as written
      assert.deepStrictEqual(machine.events, ["go", "err.*", "*", "xstate.done.state.a"])
      assert.strictEqual(a.transitions.find(([descriptor]) => descriptor === "go.*")![1][0]!.eventType, "go")
      assert.deepStrictEqual(Object.keys(machine.config.states!.a!.on!), ["go", "err.*", "*", "xstate.done.state.a"])

      const valueAfter = (type: string) =>
        Effect.gen(function* () {
          const actor = yield* createActor(toMachine(document))
          yield* actor.start
          yield* actor.send({ type })
          return (yield* actor.getSnapshot).value
        })
      assert.deepStrictEqual(yield* valueAfter("go"), "b")
      assert.deepStrictEqual(yield* valueAfter("go.deeper"), "b")
      // A descriptor matches whole tokens only: "gopher" is not below "go"
      assert.deepStrictEqual(yield* valueAfter("gopher"), "d")
      assert.deepStrictEqual(yield* valueAfter("err.io"), "c")
    })
  )

  it("[SCXML-1] an SCXML feature the converter does not convert fails the conversion with a clear message", () => {
    // `<invoke src>` (an invoke that is not of type SCXML)
    assert.throws(
      () => toMachine(scxml(`<state id="a"><invoke src="child.scxml"/></state>`)),
      "Currently only converting invoke elements of type SCXML is supported."
    )
    assert.throws(
      () => toMachine(scxml(`<state id="a"><onentry><script>x = 1;</script></onentry></state>`)),
      'Conversion of "script" elements is not implemented yet.'
    )
    assert.throws(
      () => toMachine(scxml(`<datamodel><data id="x" src="data.json"/></datamodel><state id="a"/>`)),
      "Conversion of `src` attribute on datamodel's <data> elements is not supported."
    )
    assert.throws(
      () =>
        toMachine(
          scxml(`<state id="a"><onentry><send event="e"><content>text</content></send></onentry></state>`)
        ),
      "Conversion of <content/> inside <send/> not implemented."
    )
    assert.throws(
      () => toMachine(scxml(`<state id="p" initial="a b"><state id="a"/><state id="b"/></state>`, 'initial="p"')),
      'Multiple initial states are not supported ("a b").'
    )
  })

  it.effect("[SCXML-1] assign-current-small-step/test0 converts from the one local override fixture, which replaces the package's <script> version", () =>
    Effect.gen(function* () {
      // The override folder holds exactly that one fixture
      assert.deepStrictEqual(
        walkFiles(OVERRIDES_DIR).map((file) => relative(OVERRIDES_DIR, file)),
        ["assign-current-small-step/test0.scxml"]
      )
      const packaged = readFileSync(join(TEST_FRAMEWORK, "test/assign-current-small-step/test0.scxml"), "utf-8")
      const override = readFileSync(join(OVERRIDES_DIR, "assign-current-small-step/test0.scxml"), "utf-8")

      // The package's version manipulates the datamodel with <script>, which is not converted
      assert.include(packaged, "<script>")
      assert.throws(() => toMachine(packaged), 'Conversion of "script" elements is not implemented yet.')

      // The override converts and meets the package's expectations (test0.json)
      const expected = JSON.parse(
        readFileSync(join(TEST_FRAMEWORK, "test/assign-current-small-step/test0.json"), "utf-8")
      ) as {
        readonly initialConfiguration: ReadonlyArray<string>
        readonly events: ReadonlyArray<{ readonly event: { readonly name: string }; readonly nextConfiguration: ReadonlyArray<string> }>
      }
      const machine = toMachine(override)
      const actor = yield* createActor(machine, { clock: new SimulatedClock() })
      yield* actor.start
      assert.include(yield* configurationIds(machine, (yield* actor.getSnapshot).value), expected.initialConfiguration[0])
      for (const { event, nextConfiguration } of expected.events) {
        yield* actor.send({ type: event.name })
        assert.include(
          yield* configurationIds(machine, (yield* actor.getSnapshot).value),
          sanitizeStateId(nextConfiguration[0]!)
        )
      }
    })
  )

  it("[SCXML-1] the converter is test support only: the package exports no converter and its source has no SCXML parser and no eval (D4)", () => {
    assert.isFalse("toMachine" in Package)
    assert.isFalse("sanitizeStateId" in Package)

    const srcDir = join(PKG_ROOT, "src")
    const offenders = walkFiles(srcDir)
      .filter((file) => file.endsWith(".ts"))
      .filter((file) => /from\s+["']xml-js["']|\beval\s*\(|new\s+Function\s*\(/.test(readFileSync(file, "utf-8")))
      .map((file) => relative(PKG_ROOT, file))
    assert.deepStrictEqual(offenders, [])
  })
})

// ---------------------------------------------------------------- the upstream table (T4.22)

/** One step of a SCION case: the event, after how many milliseconds, and the state it reaches. */
interface ScionStep {
  readonly after?: number
  readonly event: { readonly name: string }
  readonly nextConfiguration: ReadonlyArray<string>
}

/** One case of the upstream table: its SCXML document and its expectations (`<name>.json`). */
interface ScionCase {
  readonly title: string
  readonly source: string
  readonly initialConfiguration: ReadonlyArray<string>
  readonly events: ReadonlyArray<ScionStep>
}

// The `testGroups` table of upstream `test/scxml.test.ts`, as the manifest froze it
const TABLE = readManifest().scxmlGroups

// The rewrite reads the local override of a case when one exists, else the package's file
const readCase = (group: string, name: string): ScionCase => {
  const override = join(OVERRIDES_DIR, group, `${name}.scxml`)
  const expected = JSON.parse(readFileSync(join(TEST_FRAMEWORK, "test", group, `${name}.json`), "utf-8")) as {
    readonly initialConfiguration: ReadonlyArray<string>
    readonly events: ReadonlyArray<ScionStep>
  }
  return {
    title: `${group}/${name}`,
    source: readFileSync(existsSync(override) ? override : join(TEST_FRAMEWORK, "test", group, `${name}.scxml`), "utf-8"),
    ...expected
  }
}

const CASES: ReadonlyArray<ScionCase> = Object.entries(TABLE).flatMap(([group, names]) =>
  names.map((name) => readCase(group, name))
)

// The rewrite whose `it.effect` tests CONF-4 runs: one test per name of its `testGroups`
// literal, unless its `onlyTests` list names a case (then the others are left out)
const SCXML_REWRITE = "test/upstream/scxml.test.ts"

/** What the rewrite's syntax tree declares: the `testGroups` table and the `onlyTests` list. */
interface RewriteTable {
  readonly groups: Readonly<Record<string, ReadonlyArray<string>>>
  readonly onlyTests: ReadonlyArray<string>
  /** Each part of the two declarations that is not a plain literal of string names. */
  readonly problems: ReadonlyArray<string>
}

/** The text of a property name that is an identifier or a string literal, else null. */
const literalKey = (name: ts.PropertyName): string | null =>
  ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : null

/** The strings of an array literal whose elements are all string literals, else null. */
const literalNames = (node: ts.Expression | undefined): ReadonlyArray<string> | null =>
  node !== undefined && ts.isArrayLiteralExpression(node) && node.elements.every(ts.isStringLiteralLike)
    ? node.elements.map((element) => (element as ts.StringLiteralLike).text)
    : null

/**
 * Reads the rewrite's `testGroups` and `onlyTests` declarations through the TypeScript syntax
 * tree, as the freeze script reads the upstream table. Each must be declared once, as a
 * literal of string names: a spread, a computed or duplicate key, or a name that is not a
 * string literal is a problem, so the table cannot change at run time unseen.
 */
const readRewriteTable = (source: string): RewriteTable => {
  const sf = ts.createSourceFile(SCXML_REWRITE, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declarations = new Map<string, Array<ts.VariableDeclaration>>()
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      declarations.set(node.name.text, [...(declarations.get(node.name.text) ?? []), node])
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  const problems: Array<string> = []
  const single = (name: string): ts.VariableDeclaration | null => {
    const found = declarations.get(name) ?? []
    if (found.length !== 1) problems.push(`${name} is declared ${found.length} times, not once`)
    return found.length === 1 ? found[0]! : null
  }

  const groups: Record<string, ReadonlyArray<string>> = {}
  const table = single("testGroups")?.initializer
  if (table !== undefined && ts.isObjectLiteralExpression(table)) {
    for (const property of table.properties) {
      const key = ts.isPropertyAssignment(property) ? literalKey(property.name) : null
      const names = ts.isPropertyAssignment(property) ? literalNames(property.initializer) : null
      if (key === null || names === null) {
        problems.push(`testGroups entry "${property.getText(sf)}" is not a literal group of string names`)
      } else if (Object.hasOwn(groups, key)) {
        problems.push(`testGroups lists the group "${key}" twice`)
      } else {
        groups[key] = names
      }
    }
  } else if (table !== undefined) {
    problems.push("testGroups is not an object literal")
  }

  const onlyTests = literalNames(single("onlyTests")?.initializer)
  if (onlyTests === null) problems.push("onlyTests is not a literal list of string names")
  return { groups, onlyTests: onlyTests ?? [], problems }
}

/**
 * Compares the rewrite's table with the frozen upstream table: every group and every name,
 * in order, and an empty `onlyTests`. An empty list means the rewrite runs exactly the
 * upstream cases, each once.
 */
const rewriteTableProblems = (
  source: string,
  expected: Readonly<Record<string, ReadonlyArray<string>>>
): ReadonlyArray<string> => {
  const { groups, onlyTests, problems } = readRewriteTable(source)
  const groupProblems = [...new Set([...Object.keys(expected), ...Object.keys(groups)])].flatMap((group) => {
    const want = expected[group]
    const have = groups[group]
    if (have === undefined) return [`the group "${group}" of the upstream table is missing`]
    if (want === undefined) return [`the group "${group}" is not in the upstream table`]
    return have.length === want.length && have.every((name, index) => name === want[index])
      ? []
      : [`the group "${group}" lists [${have.join(", ")}], upstream lists [${want.join(", ")}]`]
  })
  const onlyProblems = onlyTests.length === 0 ? [] : [`onlyTests names ${onlyTests.join(", ")}, so the other cases do not run`]
  return [...problems, ...groupProblems, ...onlyProblems]
}

/** `source` with its one occurrence of `from` replaced by `to`; fails when `from` does not occur exactly once. */
const replaceOnce = (source: string, from: string, to: string): string => {
  assert.strictEqual(source.split(from).length - 1, 1, `the fixture anchor ${from} must occur once`)
  return source.replace(from, to)
}

/**
 * The milliseconds upstream's `delayToMs` gives an SCXML delay (a CSS2 time), worked out here
 * without the converter: `10ms` is 10, `.5s` 500, `1.5s` 1500, `2s` 2000. Its seconds pattern
 * `(\d*)(\.?)(\d+)s` keeps only the last digit of a whole number of seconds, so `20s` gives
 * 0 ms; the converter keeps that reading, as it keeps every upstream conversion (only
 * test347, an invoke case, uses `20s`, as a time-out the test must not reach).
 */
const upstreamMilliseconds = (delay: string): number =>
  delay.endsWith("ms")
    ? Number(delay.slice(0, -2))
    : /^\d+s$/.test(delay)
    ? Number(delay.slice(-2, -1)) * 1000
    : Number(delay.slice(0, -1)) * 1000

/** The literal delays of a document: each `delay` value, and each `delayexpr` that is a quoted string. */
const literalDelays = (source: string): ReadonlyArray<{ readonly attribute: "delay" | "delayexpr"; readonly value: string }> => [
  ...Array.from(source.matchAll(/\sdelay="([^"]+)"/g), (match) => ({ attribute: "delay" as const, value: match[1]! })),
  ...Array.from(source.matchAll(/\sdelayexpr="'([^']+)'"/g), (match) => ({ attribute: "delayexpr" as const, value: match[1]! }))
]

/** A document that reaches `pass` during `start`: its initial state raises the event it waits for. */
const doneAtStart = scxml(
  `
  <state id="s0">
    <onentry><raise event="foo"/></onentry>
    <transition event="foo" target="pass"/>
    <transition event="*" target="fail"/>
  </state>
  <final id="pass"/>
  <final id="fail"/>`,
  'initial="s0"'
)

/** A document that reaches `pass` on a later event (a send to itself, as W3C test173). */
const doneLater = scxml(
  `
  <state id="s0">
    <onentry><send event="event1"/></onentry>
    <transition event="event1" target="pass"/>
    <transition event="*" target="fail"/>
  </state>
  <final id="pass"/>
  <final id="fail"/>`,
  'initial="s0"'
)

describe("SCXML-1 The SCXML conformance suite passes: the upstream table", () => {
  it("[SCXML-1] the upstream table has 24 groups and 169 cases, the w3c-ecma (66) and parallel+interrupt (34) groups included", () => {
    assert.strictEqual(Object.keys(TABLE).length, 24)
    assert.strictEqual(CASES.length, 169)
    assert.strictEqual(TABLE["w3c-ecma"]?.length, 66)
    assert.strictEqual(TABLE["parallel+interrupt"]?.length, 34)
    // Five groups list no case upstream (each case is commented out there)
    assert.deepStrictEqual(
      Object.entries(TABLE).filter(([, names]) => names.length === 0).map(([group]) => group),
      ["assign", "data", "error", "forEach", "scxml-prefix-event-name-matching"]
    )
    // The rewrite runs each case under the upstream title `<group>/<name>`
    const manifestFile = readManifest().files.find((file) => file.path === "test/scxml.test.ts")
    assert.deepStrictEqual(
      manifestFile?.tests[0]?.expansion?.tests?.map((test) => test.title),
      CASES.map((testCase) => testCase.title)
    )
  })

  it("[SCXML-1] the rewrite runs exactly the upstream table: its testGroups literal equals the frozen 24 groups and 169 cases, and its onlyTests list is empty", () => {
    const source = readFileSync(join(PKG_ROOT, SCXML_REWRITE), "utf-8")
    const rewrite = readRewriteTable(source)
    assert.deepStrictEqual(rewrite.problems, [])
    assert.deepStrictEqual(rewrite.groups, TABLE)
    assert.deepStrictEqual(Object.keys(rewrite.groups), Object.keys(TABLE), "the groups run in the upstream order")
    assert.strictEqual(Object.values(rewrite.groups).flat().length, 169)
    assert.deepStrictEqual(rewrite.onlyTests, [])
    assert.deepStrictEqual(rewriteTableProblems(source, TABLE), [])

    // Negative fixtures, each the rewrite with one change: the check names each of them
    const fixtures: ReadonlyArray<readonly [string, string]> = [
      ["a listed case swapped for another", replaceOnce(source, "'hierarchy+documentOrder': ['test0', 'test1'],", "'hierarchy+documentOrder': ['test0', 'test2'],")],
      ["a case dropped", replaceOnce(source, "basic: ['basic0', 'basic1', 'basic2'],", "basic: ['basic0', 'basic1'],")],
      ["a commented-out upstream group turned on", replaceOnce(source, "// misc: ['deep-initial'],", "misc: ['deep-initial'],")],
      ["a case named in onlyTests", replaceOnce(source, "// 'test208.txml'", "'test208.txml'")],
      ["a group that is not a literal", replaceOnce(source, "basic: ['basic0', 'basic1', 'basic2'],", "basic: [...['basic0', 'basic1', 'basic2']],")],
      ["no testGroups declaration", replaceOnce(source, "const testGroups: Record<string, string[]> = {", "const groups: Record<string, string[]> = {")],
    ]
    for (const [label, fixture] of fixtures) {
      assert.isAbove(rewriteTableProblems(fixture, TABLE).length, 0, `the check must flag ${label}`)
    }
  })

  it("[SCXML-1] every case of the table converts through toMachine, and each state its expectations name is a state of the machine", () => {
    // A case that does not convert is allowed only with a "Tests not ported" row of the ledger
    const notPorted = readLedger()
      .ledger.notPorted.filter((row) => row["File"] === "test/scxml.test.ts")
      .map((row) => row["Title"])
    const problems = CASES.flatMap((testCase): ReadonlyArray<string> => {
      const converted = Effect.runSync(Effect.exit(Effect.sync(() => toMachine(testCase.source))))
      if (converted._tag === "Failure") {
        return notPorted.includes(testCase.title) ? [] : [`${testCase.title} does not convert and has no ledger row`]
      }
      const machine = converted.value
      const named = [testCase.initialConfiguration[0], ...testCase.events.map((step) => step.nextConfiguration[0])]
      return named
        .filter((id): id is string => id !== undefined)
        .filter((id) => !machine.stateIds.includes(sanitizeStateId(id)))
        .map((id) => `${testCase.title}: no state "${id}"`)
    })
    assert.deepStrictEqual(problems, [])
    // No case needs a row today
    assert.deepStrictEqual(notPorted, [])
  })

  it.effect("[SCXML-1] the delayed sends of the cases that move a SimulatedClock convert to milliseconds: each delay form they use fires exactly then", () =>
    Effect.gen(function* () {
      const clocked = CASES.filter((testCase) => testCase.events.some((step) => step.after !== undefined))
      assert.includeMembers(
        clocked.map((testCase) => testCase.title),
        ["delayedSend/send1", "delayedSend/send2", "delayedSend/send3", "w3c-ecma/test175.txml", "w3c-ecma/test187.txml"]
      )
      const forms = new Map(
        clocked.flatMap((testCase) => literalDelays(testCase.source)).map((delay) => [`${delay.attribute}=${delay.value}`, delay])
      )
      // The forms in use: milliseconds, fractional and whole seconds, as an attribute and as an expression
      assert.includeMembers([...forms.keys()], ["delay=10ms", "delayexpr=.5s", "delayexpr=1.5s", "delay=1s", "delay=20s"])

      for (const { attribute, value } of forms.values()) {
        const quoted = attribute === "delay" ? value : `'${value}'`
        const machine = toMachine(
          scxml(
            `
  <state id="wait">
    <onentry><send event="tick" ${attribute}="${quoted}"/></onentry>
    <transition event="tick" target="ticked"/>
  </state>
  <final id="ticked"/>`,
            'initial="wait"'
          )
        )
        const clock = new SimulatedClock()
        const actor = yield* createActor(machine, { clock })
        yield* actor.start
        const ms = upstreamMilliseconds(value)
        if (ms > 0) {
          yield* clock.increment(ms - 1)
          assert.deepStrictEqual((yield* actor.getSnapshot).value, "wait", `${attribute}="${quoted}" fired before ${ms} ms`)
        }
        yield* clock.increment(ms === 0 ? 0 : 1)
        assert.deepStrictEqual((yield* actor.getSnapshot).value, "ticked", `${attribute}="${quoted}" did not fire at ${ms} ms`)
      }
      // The one form upstream misreads is in use, and fires at once
      assert.strictEqual(upstreamMilliseconds("20s"), 0)
    })
  )

  it.effect("[SCXML-1] the runner's completion signal: a converted machine that reaches a final state ends its changes stream after the done snapshot, during start or later", () =>
    Effect.gen(function* () {
      for (const document of [doneAtStart, doneLater]) {
        const actor = yield* createActor(toMachine(document))
        // Read before start, as the runner does; bounded on the test clock, so a stream that
        // never ends gives none instead of hanging the test
        const collected = yield* actor.changes.pipe(
          Stream.runCollect,
          Effect.timeoutOption("1 second"),
          Effect.forkChild({ startImmediately: true })
        )
        yield* actor.start
        yield* TestClock.adjust("1 second")
        const snapshots = yield* Fiber.join(collected)

        assert.isTrue(Option.isSome(snapshots), "the changes stream did not end")
        const last = Option.getOrThrow(snapshots).at(-1)
        assert.strictEqual(last?.status, "done")
        assert.deepStrictEqual(last?.value, "pass")
        // A stream run after the actor is done gives the done snapshot, then ends
        const late = yield* actor.changes.pipe(Stream.runCollect, Effect.timeoutOption("1 second"), Effect.forkChild({ startImmediately: true }))
        yield* TestClock.adjust("1 second")
        assert.deepStrictEqual(
          Option.map(yield* Fiber.join(late), (values) => values.map((snapshot) => snapshot.value)),
          Option.some(["pass"])
        )
      }
    })
  )

  it.effect("[SCXML-1] the runner takes each converted machine as an AnyStateMachine: createActor accepts one, and root and config are read off it", () =>
    Effect.gen(function* () {
      // The runner's own shape (upstream `runTestToCompletion(machine: AnyStateMachine, ...)`)
      const run = (machine: AnyStateMachine) =>
        Effect.gen(function* () {
          const actor = yield* createActor(machine, { clock: new SimulatedClock() })
          yield* actor.start
          yield* actor.send({ type: "event1" })
          const snapshot: AnyMachineSnapshot = yield* actor.getSnapshot
          const ids = (yield* getStateNodes(machine.root, snapshot.value)).map((stateNode) => stateNode.id)
          return { ids, config: machine.config, status: snapshot.status }
        })

      const machine = toMachine(doneLater)
      const result = yield* run(machine)
      assert.include(result.ids, "pass")
      assert.strictEqual(result.status, "done")
      // `config` is the config the machine was built from
      assert.strictEqual(result.config, machine.config)
      assert.deepStrictEqual(Object.keys(machine.config.states ?? {}), ["s0", "pass", "fail"])
    })
  )
})
