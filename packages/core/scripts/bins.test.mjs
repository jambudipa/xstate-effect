/**
 * The two bins, end to end, under `node --test`, as `pnpm test:bins`. A bin spawns a process and
 * loads a config, so no Vitest test may reach it (CONF-8); `test/scripts.test.ts` covers their pure
 * logic. Run it after a build. Each config sits in a throwaway folder under `dist/`, the one place
 * git ignores from which a config can import the package by its own name.
 */
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { after, before, describe, it } from "node:test"
import { fileURLToPath } from "node:url"

/** The package folder. */
const root = join(dirname(fileURLToPath(import.meta.url)), "..")

/** The path of each bin, as `package.json` names it. */
const bins = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).bin

/** The throwaway folder of this run's configs. */
let folder = ""

/** A machine with no service, and the environment it runs in. */
const plain = `
import { createMachine } from "@jambudipa/xstate-effect"
const machine = createMachine({ id: "m", initial: "a", states: { a: { on: { GO: "b" } }, b: { type: "final" } } })
const environment = { catalogue: ["go"], inputs: { go: () => [{ type: "GO" }] }, abstraction: {}, timeout: "5 seconds" }
`

/** A machine whose guard reads a service, the layer that provides it, and its environment. */
const serviced = `
import { setup } from "@jambudipa/xstate-effect"
import { Context, Effect, Layer } from "effect"
class Flag extends Context.Service()("test/Flag") {}
const machine = setup({
  guards: { open: () => Effect.map(Effect.service(Flag), (flag) => flag.open) },
}).createMachine({ id: "m", initial: "a", states: { a: { on: { GO: { guard: "open", target: "b" } } }, b: { type: "final" } } })
const layer = Layer.succeed(Flag, { open: true })
const failing = Layer.effect(Flag, Effect.fail(new Error("no flag")))
const environment = { catalogue: ["go"], inputs: { go: () => [{ type: "GO" }] }, abstraction: {}, timeout: "5 seconds" }
`

/** The default export of a config over `machine`, with more fields of its target. */
const config = (fields = "") => `export default { output: "certificate.ts", machines: { m: { machine, environment${fields} } } }\n`

/** Writes a config module, and gives its path. */
const write = (name, text) => {
  const file = join(folder, name)
  writeFileSync(file, text)
  return file
}

/** Runs a bin of `package.json`, and gives its status and its report. */
const run = (bin, ...args) => {
  const child = spawnSync(process.execPath, [join(root, bins[bin]), ...args], { cwd: root, encoding: "utf8" })
  const report = child.stdout.trim().length === 0 ? undefined : JSON.parse(child.stdout)
  return { status: child.status, report, stderr: child.stderr }
}

/** Runs the certify bin to write, then again under the gate. */
const gated = (file) => {
  run("xstate-effect-certify", file)
  return run("xstate-effect-certify-gate", file)
}

before(() => {
  folder = mkdtempSync(join(root, "dist", "bins-test-"))
})

after(() => {
  rmSync(folder, { recursive: true, force: true })
})

describe("the certify bin", () => {
  it("writes a certificate the gate passes", () => {
    const file = write("plain.mjs", `${plain}${config()}`)
    assert.deepEqual(run("xstate-effect-certify", file).report, { passed: true, failures: [] })
    assert.deepEqual(run("xstate-effect-certify", file, "--check").report, { passed: true, failures: [] })
    assert.deepEqual(run("xstate-effect-certify-gate", file).report, { passed: true, failures: [] })
  })

  it("fails on a real unresolved import, and passes a comment and a string that name a missing file", () => {
    const good = write("mentions.mjs", `// import "./gone.js"\nconst text = 'from "./gone.js"'\n${plain}${config()}`)
    assert.equal(run("xstate-effect-certify", good).status, 0)
    assert.equal(run("xstate-effect-certify", good, "--check").status, 0)
    // A call that never runs, so the load passes and only the closure can see it
    const bad = write("real.mjs", `const later = () => import("./gone.js")\n${plain}${config()}`)
    const { status, report } = run("xstate-effect-certify", bad)
    assert.equal(status, 1)
    assert.deepEqual(report.failures[0].check, "unresolved-import")
    assert.match(report.failures[0].detail, /\.\/gone\.js/)
  })

  it("keeps a machine that imports its own certificate before it exists", () => {
    const file = write("own.mjs", `const later = () => import("./own.certificate.mjs")\n${plain}export default { output: "own.certificate.mjs", machines: { m: { machine, environment } } }\n`)
    assert.equal(run("xstate-effect-certify", file).status, 0)
  })
})

describe("a machine that needs a service (F15)", () => {
  it("fails by name with no layer", () => {
    const { status, report } = run("xstate-effect-certify", write("no-layer.mjs", `${serviced}${config()}`))
    assert.equal(status, 1)
    assert.equal(report.failures[0].check, "crash")
    assert.match(report.failures[0].detail, /Flag/)
  })

  it("passes with the layer of its target, and the check reads it too", () => {
    const file = write("layer.mjs", `${serviced}${config(", layer")}`)
    assert.deepEqual(run("xstate-effect-certify", file).report, { passed: true, failures: [] })
    assert.deepEqual(run("xstate-effect-certify-gate", file).report, { passed: true, failures: [] })
  })

  it("names a layer that does not build", () => {
    const { status, report } = run("xstate-effect-certify", write("failing.mjs", `${serviced}${config(", layer: failing")}`))
    assert.equal(status, 1)
    assert.equal(report.failures[0].machine, "m")
    assert.match(report.failures[0].detail, /no flag/)
  })

  it("refuses a layer that is no Layer", () => {
    for (const layer of ["{}", "undefined", "1"]) {
      const { status, report } = run("xstate-effect-certify", write("wrong.mjs", `${plain}${config(`, layer: ${layer}`)}`))
      assert.equal(status, 1, layer)
      assert.equal(report.failures[0].check, "config", layer)
    }
  })
})

describe("the gate over a config that fakes a pass (F28)", () => {
  /** The report a config prints for itself. */
  const forged = '{"passed":true,"failures":[]}'

  /** A config that writes the text of a JavaScript expression to stdout and exits 0 at once. */
  const exitWith = (text) => `;(await import("node:fs")).writeSync(1, ${text})\nprocess.exit(0)\n`

  it("fails a config that prints a report and exits 0 at load", () => {
    const file = write("forge.mjs", exitWith(`'${forged}\\n'`))
    const { status, report } = run("xstate-effect-certify-gate", file)
    assert.equal(status, 1)
    assert.equal(report.failures[0].check, "malformed-report")
  })

  it("fails a config that prints a report with a nonce of its own", () => {
    const text = '{"passed":true,"failures":[],"nonce":"guess"}'
    const { status, report } = run("xstate-effect-certify-gate", write("guess.mjs", exitWith(`'${text}\\n'`)))
    assert.equal(status, 1)
    assert.equal(report.failures[0].check, "forged-report")
  })

  it("fails a config that finds no nonce in its environment, its stdin or its arguments", () => {
    const text = `
const { readFileSync } = await import("node:fs")
const stdin = (() => { try { return readFileSync(0, "utf8") } catch { return "" } })()
const found = [stdin, ...Object.values(process.env), ...process.argv].find((each) => /^[0-9a-f]{64}$/.test(each ?? ""))
${exitWith('JSON.stringify({ passed: true, failures: [], nonce: found ?? "none" }) + "\\n"')}`
    const { status, report } = run("xstate-effect-certify-gate", write("hunt.mjs", text))
    assert.equal(status, 1)
    assert.equal(report.failures[0].check, "forged-report")
  })

  it("fails a config that exits 0 with no report", () => {
    const { status, report } = run("xstate-effect-certify-gate", write("exit.mjs", "process.exit(0)\n"))
    assert.equal(status, 1)
    assert.equal(report.failures[0].check, "no-report")
  })

  it("kills a config that hangs", () => {
    const { status, report } = run("xstate-effect-certify-gate", write("hang.mjs", "await new Promise(() => setInterval(() => {}, 1000))\n"), "--timeout-ms", "2000")
    assert.equal(status, 1)
    assert.equal(report.failures[0].check, "timeout")
  })

  it("passes the runtime's own flags to the bin, so a loader survives", () => {
    const loader = write("loader.cjs", "globalThis.loaderRan = true\n")
    const file = write("loaded.mjs", `if (globalThis.loaderRan !== true) throw new Error("the loader did not survive")\n${plain}${config()}`)
    run("xstate-effect-certify", file)
    const child = spawnSync(process.execPath, ["--require", loader, join(root, bins["xstate-effect-certify"]), file], { cwd: root, encoding: "utf8" })
    assert.equal(child.status, 0, child.stderr)
    const gate = spawnSync(process.execPath, ["--require", loader, join(root, bins["xstate-effect-certify-gate"]), file], { cwd: root, encoding: "utf8" })
    assert.equal(gate.status, 0, gate.stdout + gate.stderr)
  })
})

describe("the published bins", () => {
  it("start with a shebang and sit under a published folder", () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
    for (const bin of Object.values(manifest.bin)) {
      assert.match(readFileSync(join(root, bin), "utf8"), /^#!\/usr\/bin\/env node\n/)
      assert.ok(manifest.files.includes(bin.split("/")[1]))
    }
  })
})
