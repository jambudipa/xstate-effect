/**
 * DELIVERY-3, the library's half (T2.9): the workflow file and the scripts that lead to the
 * gate. jamcode's spec of the same name runs the gate itself. A workflow is no module, so this
 * reads its steps: a failed `pnpm check` stops the job only while the step has no way past it.
 */
import { readFileSync } from "node:fs"
import { assert, describe, it } from "vitest"

/** The text of the library's CI workflow. */
const workflow = readFileSync(new URL("../../../../.github/workflows/ci.yml", import.meta.url), "utf8")

/** The fields of `package.json` the gate depends on. */
const manifest: {
  readonly bin: Readonly<Record<string, string>>
  readonly scripts: Readonly<Record<string, string>>
} = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"))

/** The command of each `run:` step of the workflow, in order. */
const steps = workflow.split("\n").flatMap((line) => /^\s*(?:- )?run: (.+)$/.exec(line)?.[1] ?? [])

describe("DELIVERY-3 the library CI runs the gate", () => {
  it("runs check, which builds, before the tests that read the build", () => {
    const check = steps.indexOf("pnpm check")
    assert.isAtLeast(check, 0)
    assert.isBelow(check, steps.indexOf("pnpm test:coverage"))
  })

  it("gives no step a way past a failure", () => {
    assert.notMatch(workflow, /continue-on-error/)
  })
})

describe("DELIVERY-3 the package scripts lead to the gate", () => {
  /** A script by its name. */
  const script = (name: string): string => manifest.scripts[name] ?? ""

  it("runs the settlement gate from check, and check from prepublishOnly", () => {
    assert.match(script("check"), /&& pnpm check:settlement(?: |$)/)
    assert.match(script("prepublishOnly"), /&& pnpm check(?: |$)/)
  })

  it("runs the settlement type tests, then the published gate, then its end-to-end tests", () => {
    const settlement = script("check:settlement")
    const types = settlement.indexOf("tsc -p tsconfig.settlement.json --noEmit &&")
    const gate = settlement.indexOf("bin['xstate-effect-certify-gate']")
    const bins = settlement.indexOf("&& pnpm test:bins")
    assert.isAtLeast(types, 0)
    assert.isAbove(gate, types)
    assert.isAbove(bins, gate)
    assert.notMatch(settlement, /\|\||;/)
  })

  it("holds both bins, each a built script", () => {
    assert.deepStrictEqual(manifest.bin, {
      "xstate-effect-certify": "./dist/scripts/certify.js",
      "xstate-effect-certify-gate": "./dist/scripts/gate.js",
    })
  })
})
