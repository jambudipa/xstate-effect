/**
 * The library's own cases for the settlement certificate (T2.6). jamcode's S12, AUDIT-2 and
 * AUDIT-3 specs cover the behaviour through the published entry points. These hold the negative
 * cases of `certify` and `checkCertificate`, and what only the source can reach: the library
 * version in the hash, and each package form of the module closure, over an in-memory file system.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem, Layer, Path } from "effect"
import { readFileSync } from "node:fs"
import { fromAgent } from "../../src/actors/fromAgent.js"
import { CertificateCheckError, CertificateUnreadableValue } from "../../src/graph/errors.js"
import { moduleClosure } from "../../src/graph/moduleClosure.js"
import { certificateHash, certify, checkCertificate, libraryVersion } from "../../src/graph/settlement.js"
import { type AnyStateMachine, createMachine, type SettlementCertificate } from "../../src/index.js"

/** Real agent logic: its brand is what the proof reads. */
const agent = fromAgent({ budget: 1, deadline: 1000, tools: {}, turn: () => Effect.void })

/** A file system of `files` (path to text), with `links` from a path to its real path. */
const fileSystem = (files: Readonly<Record<string, string>>, links: Readonly<Record<string, string>> = {}) =>
  Layer.merge(
    Path.layer,
    FileSystem.layerNoop({
      stat: (file) =>
        Object.hasOwn(files, file)
          ? Effect.succeed({ type: "File" } as FileSystem.File.Info)
          : Effect.fail({ _tag: "PlatformError" } as never),
      readFileString: (file) => Effect.succeed(files[file] ?? ""),
      realPath: (file) => Effect.succeed(links[file] ?? file),
    })
  )

/** The module names the closure of `/app/entry.ts` gives. */
const closure = (files: Readonly<Record<string, string>>, links?: Readonly<Record<string, string>>) =>
  Effect.runSync(
    moduleClosure("/app/entry.ts").pipe(
      Effect.map((modules) => modules.map((each) => each.path)),
      Effect.provide(fileSystem(files, links))
    )
  )

describe("the certificate's library version", () => {
  it("equals package.json, and the hash covers it", async () => {
    const manifest: { version: string } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"))
    assert.strictEqual(libraryVersion, manifest.version)
    const machine = createMachine({ id: "m", initial: "a", states: { a: {} } })
    const hash = (version: string) => Effect.runPromise(certificateHash(machine, ["a"], [], [], version))
    assert.notStrictEqual(await hash("1.0.0"), await hash("1.0.1"))
  })
})

describe("the certificate's hash reads every value of a config (F30)", () => {
  /** The hash of a machine whose state meta holds `value`. */
  const hashOf = (value: unknown) =>
    certificateHash(createMachine({ id: "m", initial: "a", states: { a: { meta: { value } } } } as never), [], [], [], "1")

  /** The hash of `value`, for a value the hash reads. */
  const hash = (value: unknown) => Effect.runPromise(hashOf(value))

  it("tells two maps and two sets apart, and ignores their insertion order", async () => {
    assert.notStrictEqual(await hash(new Map([["a", 1]])), await hash(new Map([["a", 2]])))
    assert.notStrictEqual(await hash(new Set([1])), await hash(new Set([2])))
    assert.notStrictEqual(await hash(new Map([["a", 1]])), await hash({}))
    assert.strictEqual(await hash(new Map([["a", 1], ["b", 2]])), await hash(new Map([["b", 2], ["a", 1]])))
    assert.strictEqual(await hash(new Set(["x", "y"])), await hash(new Set(["y", "x"])))
    assert.notStrictEqual(await hash(new Set(["x"])), await hash(new Map([["x", "x"]])))
  })

  it("reads a Date and a RegExp by what they hold", async () => {
    assert.notStrictEqual(await hash(new Date(1)), await hash(new Date(2)))
    assert.strictEqual(await hash(new Date(1)), await hash(new Date(1)))
    assert.notStrictEqual(await hash(/a/), await hash(/b/))
    assert.notStrictEqual(await hash(/a/), await hash(/a/i))
  })

  it("reads symbol keys, whatever their order", async () => {
    const first = Symbol("s")
    const second = Symbol("t")
    assert.notStrictEqual(await hash({ [first]: 1 }), await hash({ [first]: 2 }))
    assert.notStrictEqual(await hash({ [first]: 1 }), await hash({}))
    assert.strictEqual(await hash({ [first]: 1, [second]: 2 }), await hash({ [second]: 2, [first]: 1 }))
  })

  it("stops a cycle through a map", async () => {
    const cyclic = new Map<string, unknown>()
    cyclic.set("self", cyclic)
    assert.isString(await hash(cyclic))
  })

  it("refuses an object it cannot read, and names its place", async () => {
    for (const value of [new WeakMap(), [new WeakSet()], { deep: new (class Opaque {})() }, new Map([["k", new WeakMap()]])]) {
      const failure = await Effect.runPromise(Effect.flip(hashOf(value)))
      assert.instanceOf(failure, CertificateUnreadableValue)
      assert.include(failure.at, "meta.value")
    }
  })
})

describe("certify and checkCertificate refuse what does not hold (F18)", () => {
  /** A machine that passes the proof. */
  const proved = createMachine({ id: "m", initial: "a", states: { a: { invoke: { src: agent, input: 1, onDone: "b" } }, b: { type: "final" } } } as never) as AnyStateMachine

  /** A machine with an agent and no onDone, which fails the proof. */
  const unsettled = createMachine({ id: "m", initial: "a", states: { a: { invoke: { src: agent, input: 1 }, after: { 10: "b" } }, b: { type: "final" } } } as never) as AnyStateMachine

  /** An explorer that reports two states. */
  const explored = () => Effect.succeed({ explored: 2 })

  /** What the hash covers beside the machine. */
  const inputs = { modules: [{ path: "m.ts", source: "" }] } as const

  /** A certificate of `proved`. */
  const certificate = () => Effect.runPromise(certify(proved, explored, inputs))

  it("gives a verdict of proved, and its own check passes", async () => {
    const recorded = await certificate()
    assert.strictEqual(recorded.verdict, "proved")
    await Effect.runPromise(checkCertificate(proved, recorded, explored, inputs))
  })

  it("gives a verdict of failed to a machine that fails the proof", async () => {
    assert.strictEqual((await Effect.runPromise(certify(unsettled, explored, inputs))).verdict, "failed")
  })

  it("gives a verdict of failed to an exploration that failed", async () => {
    const failed = () => Effect.succeed({ explored: 2, verdict: "failed" as const })
    assert.strictEqual((await Effect.runPromise(certify(proved, failed, inputs))).verdict, "failed")
  })

  it("names each tampered field, so that no field can leave the comparison", async () => {
    const recorded = await certificate()
    const tampered = {
      states: { ...recorded, states: ["forged"] },
      edges: { ...recorded, edges: ["forged"] },
      explored: { ...recorded, explored: 99 },
      hash: { ...recorded, hash: "forged" },
      verdict: { ...recorded, verdict: "failed" },
    }
    for (const [field, forged] of Object.entries(tampered)) {
      const failure = await Effect.runPromise(Effect.flip(checkCertificate(proved, forged as SettlementCertificate, explored, inputs)))
      assert.instanceOf(failure, CertificateCheckError)
      assert.strictEqual((failure as CertificateCheckError).machineId, "m")
      assert.deepStrictEqual((failure as CertificateCheckError).mismatches.map((each) => each.field), [field])
      assert.include(failure.message, field)
    }
  })

  it("does not take a hand-edited verdict for a machine that fails the proof", async () => {
    const recorded = await Effect.runPromise(certify(unsettled, explored, inputs))
    const failure = await Effect.runPromise(Effect.flip(checkCertificate(unsettled, { ...recorded, verdict: "proved" }, explored, inputs)))
    assert.instanceOf(failure, CertificateCheckError)
    assert.deepStrictEqual((failure as CertificateCheckError).mismatches, [{ field: "verdict", recorded: '"proved"', derived: '"failed"' }])
  })
})

describe("the module closure", () => {
  it("maps a .js import to its .ts file and records a name that resolves to nothing", () => {
    assert.deepStrictEqual(
      closure({ "/app/entry.ts": `import "./a.js"\nimport "./b.mjs"\nimport "./c.ts?raw"\nimport "./gone"\nimport "nothing"`, "/app/a.ts": "", "/app/b.mts": "", "/app/c.ts": "" }),
      ["a.ts", "b.mts", "c.ts", "entry.ts", "unresolved:./gone", "unresolved:nothing"]
    )
  })

  it("reads a JSON file for the hash and looks for no import in it", () => {
    assert.deepStrictEqual(
      closure({ "/app/entry.ts": `import "./data.json"`, "/app/data.json": `{ "from": "./gone" }` }),
      ["data.json", "entry.ts"]
    )
  })

  it("counts an installed package by name and version, however deep the name", () => {
    assert.deepStrictEqual(
      closure({
        "/app/entry.ts": `import "@scope/kit/deep"\nimport "plain"`,
        "/app/node_modules/@scope/kit/package.json": `{ "version": "1.2.3" }`,
        "/node_modules/plain/package.json": `{ "version": "9.0.0" }`,
      }, { "/app/node_modules/@scope/kit": "/app/node_modules/.store/kit/node_modules/@scope/kit" }),
      ["entry.ts", "package:@scope/kit@1.2.3", "package:plain@9.0.0"]
    )
  })

  it("walks a workspace package through each condition of its exports", () => {
    assert.deepStrictEqual(
      closure({
        "/app/entry.ts": `import "@w/a/one"\nimport "@w/a"`,
        "/app/node_modules/@w/a/package.json": `{ "exports": { ".": { "bun": "./src/bun.ts", "default": ["./src/node.ts"] }, "./*": "./src/*.ts" } }`,
        "/w/a/src/bun.ts": "",
        "/w/a/src/node.ts": "",
        "/w/a/src/one.ts": "",
      }, { "/app/node_modules/@w/a": "/w/a" }),
      ["../w/a/src/bun.ts", "../w/a/src/node.ts", "../w/a/src/one.ts", "entry.ts"]
    )
  })

  it("walks a workspace package with a bare exports string, with main, and with neither", () => {
    assert.deepStrictEqual(
      closure({
        "/app/entry.ts": `import "s"\nimport "m"\nimport "n"\nimport "n/sub"\nimport "bad"`,
        "/app/node_modules/s/package.json": `{ "exports": "./s.ts" }`,
        "/app/node_modules/m/package.json": `{ "main": "main.ts" }`,
        "/app/node_modules/n/package.json": `{}`,
        "/app/node_modules/bad/package.json": `not json`,
        "/w/s/s.ts": "",
        "/w/m/main.ts": "",
        "/w/n/index.ts": "",
        "/w/n/sub.ts": "",
      }, {
        "/app/node_modules/s": "/w/s",
        "/app/node_modules/m": "/w/m",
        "/app/node_modules/n": "/w/n",
        "/app/node_modules/bad": "/w/bad",
      }),
      ["../w/m/main.ts", "../w/n/index.ts", "../w/n/sub.ts", "../w/s/s.ts", "entry.ts", "unresolved:bad"]
    )
  })

  it("follows a # import through the nearest package.json, and records one with no match", () => {
    assert.deepStrictEqual(
      closure({
        "/app/entry.ts": `import "#db"\nimport "#gone"`,
        "/app/package.json": `{ "imports": { "#db": { "bun": "./db.bun.ts", "node": "./db.node.ts" } } }`,
        "/app/db.bun.ts": "",
        "/app/db.node.ts": "",
      }),
      ["db.bun.ts", "db.node.ts", "entry.ts", "unresolved:#gone"]
    )
  })

  it("records a # import with no package.json above it", () => {
    assert.deepStrictEqual(closure({ "/app/entry.ts": `import "#db"` }), ["entry.ts", "unresolved:#db"])
  })
})
