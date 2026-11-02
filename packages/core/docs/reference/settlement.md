---
title: Settlement proof and certificates
doc-type: reference
sources: [packages/core/src/settlement.ts, packages/core/src/graph/settlement.ts, packages/core/src/graph/explore.ts, packages/core/src/graph/moduleClosure.ts, packages/core/src/graph/importScan.ts, packages/core/scripts/certify.ts, packages/core/scripts/gate.ts]
---

# Settlement proof and certificates

> **TL;DR:** A machine that invokes [agent logic](./actors/from-agent.md) must settle: each agent
> outcome moves the machine, and every state reaches a final state. Three layers check this. The
> type proof of `setup(...).createMachine` reads the config as written. `proveSettlement` reads
> the built machine. `explore` runs the real guards. `certify` records the result in a
> certificate, and `xstate-effect-certify --check` derives the result again.

`explore`, `proveSettlement`, `certify`, `checkCertificate`, `moduleClosure`, `unresolvedImports` and their types come
from `@jambudipa/xstate-effect/graph`. `certified` and the type-level names come from
`@jambudipa/xstate-effect`. Upstream XState has no counterpart to these exports.

## Summary

| Export | Kind | Description |
| --- | --- | --- |
| [`SettlementProof`](#the-type-proof) and its errors | types | The compile-time proof of a setup machine. |
| [`proveSettlement`](#provesettlement) | function | The structural proof over the built machine. |
| [`explore`](#explore) | function | The exhaustive run of a machine against its environment. |
| [`timerFirings`, `processRestart`](#explore) | drivers | Two ready-made environment inputs. |
| [`certify`](#certify) | function | Generates a certificate. |
| [`checkCertificate`](#checkcertificate) | function | Derives a certificate again and compares it. |
| [`moduleClosure`](#moduleclosure) | function | The source files that a certificate's hash covers. |
| [`unresolvedImports`](#moduleclosure) | function | The real imports of a closure that name no file. |
| [`certified`, `Certified`](#certified-and-certified) | function, type | Bind a certificate to a child machine. |
| [`xstate-effect-certify`](#the-xstate-effect-certify-bin) | bin | Writes or checks a certificate module. |

## The type proof

`setup(...).createMachine` applies the proof to a config as written. The rules and their limits
are in [setup.createMachine](./setup.md#setupcreatemachine). In a setup with an agent actor or a
certified child, each rule below gives a compile error at the line of the fault.

| Error | Meaning |
| --- | --- |
| `UnknownTarget`, `UnknownInitial` | A target or an `initial` names no state. This rule also applies in a setup with no agent. |
| `DuplicateStateId`, `HistoryNeedsDefaultTarget`, `StateKeyNotProvable` | The proof cannot read the graph. |
| `AgentSettlementHandler`, `SettlementMustExit`, `AgentDoneOutsideOnDone` | An agent has no `onDone`, its `onDone` stays in the state, or an `on` key takes its done event. The last rule covers the exact key in any state, and a wildcard (`*`, `xstate.*`, `xstate.done.*`, `xstate.done.actor.*`, or a partial key such as `xstate.done.actor.mind.*`) below the invoking state. In a parallel region beside the agent, a wildcard with a target is refused when it or the `onDone` leaves its region, as document order can then drop the `onDone`. A wildcard on the invoking state or on an ancestor is free, as `onDone` selects first. |
| `AgentToolNotAccepted`, `AgentStateAcceptsNoEvents` | A tool is not on the state's menu, or the menu has no event. See [Tools and the menu](./actors/from-agent.md#tools-and-the-menu). |
| `NoProgressGuarantee` | A non-final atomic state has nothing that must move it. |
| `CannotReachFinal`, `RegionCannotComplete`, `MachineHasNoStates` | No path goes from the state or the region to a final state. |
| `Livelock` | An `always` fallback can loop. |
| `ChildSettlementUnhandled`, `CertificateNotProved`, `StaleCertificate`, `StaleEdges` | A child's settlement has no handler, or its certificate does not cover it or does not prove it. |
| `ConfigNotLiteral` | TypeScript did not infer the config, so the proof cannot read it. |
| `MachineTooLargeForTypeProof` | A part of the machine is past `SettlementProofBound`. |

These states have a progress guarantee:

- a state with an agent invocation whose settlement is total and whose `onDone` exits the state;
- a state with an `after` that has a target outside the state and a finite delay;
- a state with an `always` set that has an unguarded fallback, and that exits the state.

A non-agent invocation alone gives no guarantee, as no type proves that an effect ends. A
targetless `after`, a self-target or `reenter` `after`, and a targetless `always` give no
guarantee. An `after` key of `Infinity`, `-Infinity` or `NaN` gives none. The compile-time proof
cannot read the value of a named delay, as its type is `number`; `proveSettlement` resolves the
name through the machine's delays, and refuses one with no implementation, an infinite one and a
function. A machine past `SettlementProofBound` states is proved part by part: each part gets
the same checks, and the parent assumes the proved exits of each child.

`TargetOf`, `TargetCheck`, `ChildSettlementCheck`, `HoldsAgentsFlag`, `SettlementReport` and
`ProofMode` are the parts of the proof. Use `SettlementReport` to read the proof as data.

## proveSettlement

```ts
import type { AnyStateMachine } from "@jambudipa/xstate-effect"
import type { SettlementProofError } from "@jambudipa/xstate-effect/graph"
import type { Effect } from "effect"

export declare const proveSettlement: (machine: AnyStateMachine) => Effect.Effect<void, SettlementProofError>
```

- It reads the machine that it gets, so a machine from `provide` is proved with what `provide`
  added.
- It finds agent logic by the run-time brand, so a cast does not hide an agent.
- It counts an agent as progress only when `fromAgent` built the logic. A brand copied by hand
  still obliges a settlement, but it buys no progress, and gives `NoProgressGuarantee`.
- It checks each agent's `onDone`, each `stopChild` of an agent, the progress guarantees, the
  reachability of a final state, `always` loops, and each cycle that re-enters an agent state.
- A guard counts as able to pass. Use [`explore`](#explore) for guarded reachability.
- A machine with no agent logic passes, unless it keeps a definition error.

`SettlementProofError.findings` holds every failure. Each `SettlementFinding` has a `kind`, a
`path` and a `message`.

| `SettlementFindingKind` | Meaning |
| --- | --- |
| `AgentWithoutSettlement` | An invocation of agent logic has no `onDone`. |
| `SettlementMustExit` | An agent's `onDone` can stay in the invoking state. |
| `AgentDoneOutsideOnDone` | An `on` key takes an agent's done event. |
| `StopsInvokedAgent` | An action stops an invoked agent by its id. |
| `UnrankedAgentCycle` | A cycle re-enters an agent state with no declared bound. |
| `CannotReachFinal`, `NoProgressGuarantee`, `Livelock`, `RegionCannotComplete`, `MachineHasNoStates` | As the type errors of those names. |
| `MachineDefinitionInvalid` | The machine keeps a definition error, so it cannot run. |

A cycle gets its bound from `SettlementTransitionMeta`, which you put in the `meta` of a
transition:

| Field | Meaning |
| --- | --- |
| `ranking` | The context counter that falls each time the guarded transition runs. `explore` checks that it falls. |
| `person` | `true` when only a person sends the transition's event. |

## explore

```ts
import type { AnyStateMachine } from "@jambudipa/xstate-effect"
import type { ExploreEnvironment, ExploreFailure, ExploreResult } from "@jambudipa/xstate-effect/graph"
import type { Effect } from "effect"

export declare const explore: <TMachine extends AnyStateMachine>(
  machine: TMachine,
  environment: ExploreEnvironment
) => Effect.Effect<ExploreResult, ExploreFailure>
```

The result's requirements are those of the machine. `explore` drives the real machine with each
input of the environment, from each state that it reaches. It has no state limit: the
environment's `timeout` bounds it, and a run past the timeout fails. A custom action does not
run, and no actor starts.

| `ExploreEnvironment` field | Required | Meaning |
| --- | --- | --- |
| `catalogue` | yes | Every kind of input. A kind with no driver, or a kind that gives no input, fails the run. |
| `inputs` | yes | The `ExploreDriver` of each kind: a snapshot gives the inputs of that snapshot. |
| `abstraction` | yes | The finite class of each context field that the machine reads. |
| `timeout` | yes | The longest run. |
| `input` | no | The machine's input. |
| `stalled` | no | Whether an ended run stalled. A stalled end never counts as final. |

A driver gives events, or `ExploreStep` values that replace the snapshot. `timerFirings` gives
the delayed transitions of a state. `processRestart(machine)` gives the restart of the process.

The explorer records the context fields that the machine reads, so nothing declares them. A state's
key is its configuration and the abstraction of those fields. Each failure of `ExploreFailure` is
an exported class:

| Failure | Meaning |
| --- | --- |
| `UnabstractedField` | The machine read a field that `abstraction` does not map. |
| `CongruenceViolation` | Two merged states have different successors, so the abstraction lost a fact. The explorer compares each merged state with new values in its read fields, so a field that keeps a new value in each state runs until `timeout`. |
| `UndrivenInput` | A catalogue kind has no driver, or its driver gave no input. |
| `CannotReachFinal` | A reachable state has no path to a final state. The failure holds the trace. |
| `UnrankedCycle`, `InvalidRanking` | A cycle has no bound, or its ranking does not fall. |
| `ExploreTimeout` | The run passed `timeout`. |
| `TransitionError`, `InitializationError` | The machine failed while it ran. |

## certify

```ts
import type { AnyStateMachine, SettlementCertificate } from "@jambudipa/xstate-effect"
import type { CertificateExploration, CertificateInputs, CertificateUnreadableValue, SettlementProofError } from "@jambudipa/xstate-effect/graph"
import type { Effect } from "effect"

export declare const certify: <E, R>(
  machine: AnyStateMachine,
  explore: (machine: AnyStateMachine) => Effect.Effect<CertificateExploration, E, R>,
  inputs: CertificateInputs
) => Effect.Effect<SettlementCertificate, E | SettlementProofError | CertificateUnreadableValue, R>
```

A certificate holds `states`, `edges`, `explored`, `hash` and `verdict`. The verdict is `"proved"`
only when `proveSettlement` and the explorer both prove the machine. The output is
byte-identical across runs of one runtime. A module closure with a real unresolved import gives
`"failed"`, as the hash cannot cover that file. The hash covers the machine, its provided
implementations, the module closure and the library version, so a new library version needs a new
certificate.

## checkCertificate

`checkCertificate(machine, certificate, explore, inputs)` runs `certify` again and compares each
field. It never trusts the recorded verdict. `CertificateCheckError.mismatches` names each field
that differs. A function hashes by its source text, so run the check under the runtime that
wrote the certificate.

## moduleClosure

`moduleClosure(entry)` gives every file that the entry module imports, with its content. It
needs the `FileSystem` and `Path` services. It follows:

- relative imports, where `./x.js` also finds `x.ts`, `./x.jsx` finds `x.tsx`, and `./x.cjs` finds
  `x.cts`;
- a package's `imports` map;
- `paths` and `baseUrl` from the nearest `tsconfig.json` or `jsconfig.json`, through `extends`. It
  reads no `references`, so an alias that only a referenced config holds is a real unresolved import;
- a package's import of its own name;
- a workspace package's `exports` map.

An installed package counts by name and version. A builtin counts by name, with or without
`node:`.

A name that resolves to no file gives a module with no text, so no edit to that file changes the
hash:

| `path` | What it means | Effect |
|---|---|---|
| `unresolved:<name>` | A real import names nothing. | `unresolvedImports(modules)` lists it, the verdict of `certify` is `"failed"`, and the bin reports the check `unresolved-import`. |
| `mentioned:<name>` | A comment, a string or a type-only import names nothing. A real import in a file that only such a name reaches gives the same. | None. No run depends on it. |

An erased import is an `import type`, an `export type`, or a clause of `type` names only. A file
that such a name reaches stays in the hash when it exists. The type form `import("./x").T` counts
as a real import, as a lexer cannot tell it from a call, and a file that it names is missing only
when the compiler also refuses it.

The scan has no parser. A lexer finds the real imports, in these forms: `import`, `export ... from`,
`import()`, `import.defer()`, `import.source()`, `require()`, `require.resolve()` and
`import.meta.resolve()`, with a comment or a line break at any place between the tokens. One
pattern over the whole text finds every name after those forms, so a name that the lexer loses
stays an input to the hash. The lexer can lose a real import only on a line where a regular
expression follows a `)` or a `}`, or where JSX text holds a quote. It then becomes a mention, and
its missing file does not fail.

Neither pass sees a computed name or a loader under another name: `import(name)`,
`require("./" + name)`, `const load = require`, `createRequire(url)("./x")`,
`import.meta.glob("./*.ts")` and `new URL("./x", import.meta.url)`. Name such a module with a
plain import in the config module, so that the hash covers it.

## certified and Certified

A machine that holds agents can be a child only with a certificate.

- `certified(machine, certificate)` returns the same machine with the certificate's mark. It
  checks at compile time that the certificate covers the machine.
- `machine satisfies Certified<typeof machine, typeof certificate>` makes the same check in a
  statement of its own.

Both read the state and edge lists. A change to a guard or action body changes the hash and not
the lists, so only `checkCertificate` finds that change. A certificate with a failed verdict
still binds, but the child then gives its parent no progress guarantee.

## The xstate-effect-certify bin

```text
xstate-effect-certify <config> [--check]
```

The config module's default export is a `CertifyConfig`: `output`, the certificate module's path
relative to the config, and `machines`, each with a `machine`, an `environment` and an optional
`layer`. Each name in `machines` becomes an export of the certificate module.

`layer` provides the services that the machine's guards and actions need. `explore` runs them, so
a machine that needs a service and has no layer fails with the check `crash`. The bin builds the
layer once for each machine, so no service state crosses from one machine to the next. It refuses
a config whose `layer` key holds anything but a `Layer`, `undefined` included. A layer that does
not build fails that machine with its own tag, or the check `layer`. The hash covers the layer's
source through the module closure.

- Without `--check`, the bin writes the certificate module.
- With `--check`, the bin writes nothing and compares a fresh derivation with the module.
- The bin prints one JSON report, `{ passed, failures }`, to stdout. It exits non-zero on a failure.
- A real import that names no file fails with the check `unresolved-import`. The bin still writes
  the certificate, with the verdict `"failed"`.

Run the bin under the runtime that runs the machines, for example
`bun --bun xstate-effect-certify <config>`.

## The xstate-effect-certify-gate bin

```text
xstate-effect-certify-gate <config> [--timeout-ms <ms>]
```

An exit code alone proves nothing: a config that calls `process.exit(0)` ends the first bin with
exit 0 and no report. Run this gate in CI. It runs `xstate-effect-certify <config> --check` under
a time limit, which is 120000 ms by default, and under the runtime and the flags that run the gate,
so a loader survives. It prints one report in the same form, and exits 1 unless it passes. It
passes only on exactly one report that says `passed: true`, that names no failure, that agrees with
the exit code, and that holds the nonce of this run.

A config runs in the bin's process and shares its stdout. The gate sends a new nonce on the bin's
stdin, and the bin reads it before it loads the config. So the gate fails each of these:

| What a config does | Check |
|---|---|
| It exits with no report. | `no-report` |
| It prints a report with no nonce, or prints beside the bin's report. | `malformed-report` |
| It prints a report with another nonce. | `forged-report` |
| It hangs. | `timeout` |

The gate also has the checks `usage`, `spawn` and `inconsistent-report`.

The gate is no sandbox. A config can run any code in that process, so a config that attacks the bin
can still pass. It can patch `process.stdout.write` or `JSON.stringify` to change the real report.
It can read the nonce through `node:inspector`. It can change a machine or the library before the
check runs. The gate stops a config that writes a report for itself, and a broken run. Read a
change to a config as you read code.

## Related

- [How to prove that an agent machine settles](../how-to/prove-an-agent-machine-settles.md)
- [Why agent machines must settle](../explanation/agent-settlement.md)
- [fromAgent and AgentTurn](./actors/from-agent.md)
- [Limits of the compile-time proof](./setup.md#limits-of-the-compile-time-proof)
- [Graph traversal and model-based testing](./graph.md)
