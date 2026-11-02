/**
 * A spread inside the `states` of a `createMachine` config: the proof behind the type limit.
 *
 * TypeScript erases a spread's keys when an explicit key follows it (the A5 counterexample of
 * `docs/wide-config-gate-investigation.md`). The inferred type of the unsafe config equals the
 * valid control's, so the compiler takes the machine. Two layers stand in for the compiler: the
 * lint rule, which CONF-8 tests, as CONF-8 holds the ESLint capability, and `proveSettlement` at
 * run time, which this file pins.
 *
 * @since 0.4.0
 */
import { assert, describe, it } from "@effect/vitest"
import { Cause, Effect, Exit, Option } from "effect"
import { fromEffect } from "../../src/actors/index.js"
import { setup } from "../../src/index.js"
import { markAgentLogic } from "../../src/internal/agentBrand.js"
import { proveSettlement } from "../../src/graph/index.js"

/** The registered agent, as in the counterexample. */
const agent = markAgentLogic(fromEffect((_: { input: number }) => Effect.succeed(1)))

/** The setup of both machines. */
const s = setup({ actors: { agent } })

/** The hidden agent state: no `onDone`, no progress, no way to a final state. */
const wideStates: Readonly<Record<string, object>> = { hidden: { invoke: { src: "agent", input: 1 } } }

/** The kind and path of each finding, or no findings when the proof passes. */
const findings = (machine: Parameters<typeof proveSettlement>[0]): ReadonlyArray<string> =>
  Exit.match(Effect.runSyncExit(proveSettlement(machine)), {
    onSuccess: () => [],
    onFailure: (cause) => Option.getOrThrow(Cause.findErrorOption(cause)).findings.map((finding) => `${finding.kind}: ${finding.path}`)
  })

describe("the proof behind the type limit", () => {
  // The lint rule refuses this spread in the call, so the object is built first. The compiler
  // sees the same value and type as in the counterexample; the rule's limit is recorded in
  // docs/reference/setup.md.
  const unsafeStates = { ...wideStates, done: { type: "final" } } as const

  it("[T1.11] A5: the compiler takes the spread, and proveSettlement refuses it on `hidden`", () => {
    assert.isTrue(findings(s.createMachine({ initial: "done", states: unsafeStates })).includes("AgentWithoutSettlement: hidden"))
  })

  it("[T1.11] A5: the control with the same visible states passes", () => {
    assert.deepStrictEqual(findings(s.createMachine({ initial: "done", states: { done: { type: "final" } } })), [])
  })
})
