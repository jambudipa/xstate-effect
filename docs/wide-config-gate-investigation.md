# Wide-config gate investigation

**Status: partial candidate; not acceptance-ready. A5 remains unsatisfied.**

**Merge status, 2026-11-02:** the owner merged this partial fix into `agent-settlement`. The lint rule and `proveSettlement` now cover the A5 form, and A5 stays open as a compile-time limit. The limits for a library reader are in `packages/core/docs/reference/setup.md`. The report below is the branch's record as written. The `_bmad-output` evidence that it links is gitignored and exists only in the `wide-config-gate` worktree.

**Evidence files:** each `_bmad-output/...` path in this record names a local run artefact. `_bmad-output` is gitignored, so these files are not in the repository or the package. The paths stay as a record of what the investigation read. The tests and fixtures this record cites are committed.

Date: 2026-11-02. Branch: `wide-config-gate`.
Worktree: a local checkout of that branch.
Baseline: `c30b211344a559749a1591874523c04aa1a5aaf5`.
Final production-source revision: `40496c096dcc707098c20c4487dbeb680da8e574`.
No merge, push, or release occurred. The main checkout's concurrent work was not edited.

## Decision

**Observed:** the branch fixes the reported wide-config bypass and the callback-inference refusals for the tested forms. The dual-compiler runner passes 127 sampled fixtures, with 102 expected diagnostics per compiler and zero unexpected diagnostics. These results do not establish the brief's universal rule.

**Observed:** A5 also covers a literal config that spreads wide states and supplies an explicit state afterwards. Both compilers accept an unsafe example. TypeScript erases the unknown state keys before the library signature can inspect them. The unsafe argument, its inferred `TConfig`, and its inferred `TGraph` match the valid control exactly.

**Inferred:** a signature that sees only those same structural types cannot accept the valid control and reject the unsafe value. A type-level rule cannot recover the erased spread provenance. Closing this class of escape requires information outside the inferred structural type, or a construction contract that the present acceptance criteria do not require. This investigation does not substitute a runtime or lint check and does not narrow A5 to its pure-spread example.

The brief instructs the implementer to stop and report if every criterion cannot be met. Production changes stopped after this counterexample. The branch preserves the useful partial candidate, tests, and evidence. It is not a completed settlement-proof guarantee.

## Decisive A5 counterexample

The registered `agent` is branded agent logic. This needs no `any` and no assertion on the config:

```text
const wideStates: Readonly<Record<string, object>> = {
  hidden: { invoke: { src: "agent", input: 1 } }
}

const unsafe = s.createMachine({
  initial: "done",
  states: { ...wideStates, done: { type: "final" } }
})
const control = s.createMachine({
  initial: "done",
  states: { done: { type: "final" } }
})
```

The hidden state invokes an agent without `onDone`, has no progress guarantee, and cannot reach a final state. The brief's proof checks all states, including unreachable ones.

**Observed:** TypeScript 6.0.3 produces zero complete-program diagnostics. tsgo `7.0.0-dev.20260707.2` exits zero with no diagnostics. Both calls infer the following config and graph:

```text
{
  readonly initial: "done";
  readonly states: { readonly done: { readonly type: "final" } };
}
```

The pure-spread case `{ states: { ...wideStates } }` retains the string index and is refused. The explicit `done` property changes the result of TypeScript's spread inference. The original A5 fixtures cover the first case; the second case disproves broader acceptance.

Run the portable counterexample from `packages/core`:

```sh
node scripts/repro-wide-spread.mjs --tsgo /tmp/wide-config-tools/node_modules/.bin/tsgo
```

A successful forensic reproduction means **A5 failed**, not that the unsafe machine is acceptable. The counterexample is not an expected-success acceptance fixture.

Full captured types and diagnostics: spread-results.json (`_bmad-output/features/wide-config-gate/spread-counterexample/spread-results.json`). The portable reproduction record (`_bmad-output/features/wide-config-gate/spread-counterexample/portable-results.json`) records three pairs (six machines): a simple spread, the exact C1 inline-assign control from `forms.ts`, and C4 const config variables. It records source hashes and compares complete return types and both inferred config parameters. All six machines compile with zero complete-program diagnostics under both compilers. All three type comparisons agree.

The C4 pair gives the unsafe variable the normal annotation `spreadConfig: typeof plainConfig`, with a const initializer. TypeScript accepts that structural assignment. Both calls therefore receive the same declared type, independently of contextual typing at the call. The annotation is not an unsafe cast. **Inferred:** a one-argument signature that accepts the required valid const-variable control cannot distinguish the unsafe variable through that identical declared type. This conclusion concerns the present structural call contract; it does not claim that every replacement construction API is impossible.

## Confirmed cause of the original false refusals

**Observed through an instrumented copy of TypeScript 6.0.3:**

1. `chooseOverload` first infers with `SkipContextSensitive`.
2. A context-sensitive callback contributes `NonInferrableType`; the containing object inherits it.
3. `inferTypes` skips the naked `TConfig` candidate. `getInferredType` receives no candidate and uses the wide default.
4. The strict gate fails preliminary applicability. The compiler never reaches its normal inference retry.
5. The old permissive gate allows the retry, which captures the literal config.

This confirms the brief's hypothesis more precisely: the observed path uses the generic default, not a candidate rejected by constraint comparison.

Compiler locations in the installed `typescript/lib/typescript.js`: `anyFunctionType` 51822, `inferTypes` 73342, `getInferredType` 73924, `checkObjectLiteral` 78819, `chooseOverload` 81472/81488. The installed compiler was not modified. The temporary trace reports zero diagnostics with the old gate and four TS2345 diagnostics at `forms.ts:7–10` with the closed gate. A minimal reduction also demonstrates that reverse mapping permits the preliminary structural inference.

The official [NoInfer documentation](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-4.html) describes inference-candidate suppression. It does not promise delayed applicability checks. The local trace establishes the specific behavior here.

## Partial implementation

**Observed in the source and tests:**

- `SetupCreateMachine` retains its original constrained `TConfig` for callback context, requirements, child types, and the returned literal config.
- A separate `TGraph` uses a recursive reverse map. Callback bodies are opaque in this graph. Dictionary mode distinguishes state/event/delay names from config fields. Actor sources and guards retain their types; `guard: undefined` remains unguarded.
- The five checks read `TGraph`. A conditional required rest argument rejects a root config typed `any`.
- `StructuralAny` rejects erased structural fields before recursive target resolution. It prevents nested `any` from absorbing a property diagnostic and prevents the observed target-`any` TS2589 failure.
- Plain setups retain the original signature. Both settlement wide branches now refuse unreadable graphs. Certificate coverage and the agent-holder marker recognize a wide member of a union.

**Observed audit:** the five checks do not inspect the omitted callback bodies or payloads. `ChildSettlementCheck` derives child IDs from the actor registry and reads state/handler structure; it does not discover children from action bodies. The complete original `TConfig` remains available for returned machine requirements and child types.

## Acceptance accounting

| Criterion | Status and evidence |
| --- | --- |
| A1–A4 | **Observed pass for the specified fixtures**, in both setup types; exact code, line and message fragment in the manifest. |
| A5 | **Observed failure in the general case.** Pure-wide-spread fixtures refuse; explicit-state-after-spread counterexample compiles under both compilers. |
| A6–A10 | **Observed pass for the specified fixtures**, including each A7 transition location and root `any`. |
| B1–B5 | **Observed pass:** 40 fixtures, four forms × five errors × two setup types. Each names the real error; none substitutes `ConfigNotLiteral`. |
| C1–C4 | **Observed pass:** the root forms, holder forms, combined forms, and const config variables compile in the complete diagnostic run. |
| C5–C6 | **Observed pass:** exact/non-any context, event and input assertions; `Option<number>` completion outputs; literal returned config assertions. Added nested invoke arrays and dictionary-name collisions also compile. |
| D1 | **Observed:** unchanged plain-setup signature and positive fixtures for the four forms, wide configs, `any`, and optional states. |
| D2 | **See verification below.** No assertion was weakened and no test was skipped. Existing COV-2 negative fixture received one justified negative type assertion. |
| D3 | **Observed:** five cited statements compile; the sixth is a true tool-menu refusal, described below. |
| E1 | **Observed:** 127 sampled fixtures pass under TS6.0.3 and tsgo7-dev; 102 diagnostics per compiler, identical codes/lines, complete output checked. The separate A5 counterexample fails the intended requirement under both. |
| E2 | **Partial:** the explicit wide branches in settlement proof/child checking refuse; certificate coverage and holder-marker union branches were reviewed and tested. The branch listing alone does not prove that every individual check refuses every wide config. `TargetCheck` can still return `unknown` independently; the composed setup refusal comes from `SettlementProof`. Gate listing (`_bmad-output/features/wide-config-gate/wide-branches.log`). |
| E3 | **Observed:** supplied repro now refuses bypass and accepts all four forms. Exact output is below. |
| E4 | **Observed:** +10.71% instantiations for 35 states. The figure and inferred cause are reported below, as the criterion permits. |
| E5 | **Observed/inferred labels** distinguish measurements from conclusions throughout this report. Final runners check complete diagnostics; no success claim depends on filtered output. |

**Observed E2 probe:** for an actor whose `AgentSrc` is exactly `"agent"`, `TargetCheck<Wide, Actor>` is exactly `unknown`, while `SettlementProof<Wide, Actor>` is exactly `ConfigNotLiteral<"">`. The complete program reports one deliberately triggered TS2322 at line14 and no other diagnostic. This prevents a full E2 claim despite the closed explicit wide branches. Exact probe output (`_bmad-output/features/wide-config-gate/e2-target-check.json`).

The assertion manifest is [manifest.json](../packages/core/test/fixtures/wide-config-gate/manifest.json). The complete dual-compiler record is acceptance-final.json (`_bmad-output/features/wide-config-gate/acceptance-final.json`). There are 102 negative sampled fixtures and 25 positive sampled fixtures. This finite sample does not cover the erased-spread counterexample.

## The six existing statements

The locators below are the brief's original locators; later additions can move them.

| Brief locator | Observed result |
| --- | --- |
| COV-1:170 (`settlesAgents`) | Compiles with typed invocation-array completion callbacks. |
| COV-2:722 (`agentHost`) | Compiles with typed nested `assign` and completion output. |
| COV-2:1377 (`menuHost`) | True refusal: TS2322 `AgentToolNotAccepted<"SIDE", "work.asking">` at the agent source. |
| COV-5:339 | Compiles in the complete test typecheck. |
| COV-6:173 | Compiles in the complete test typecheck. |
| COV-6:189 | Compiles in the complete test typecheck. |

`menuHost` deliberately offers SIDE, which only a sibling region handles. The existing runtime test explicitly calls that event illegal because it does not leave the agent state. The added `@ts-expect-error` asserts that genuine static refusal. It preserves the machine value and all runtime assertions. It does not suppress an inference failure.

## Verification

- **Observed:** `pnpm typecheck` exits zero for source and all tests.
- **Observed:** `pnpm build`, `pnpm lint`, and `pnpm run docs:audit` exit zero. The audit reports zero undocumented declarations, missing folder documents, or root gaps.
- **Observed:** the initial new regression fails as intended: one new COV-1 failure, 59 existing tests pass. The integrated COV-1 run passes all 60 tests.
- **Observed:** the dual-compiler runner checks 127 fixtures and all imported-source diagnostics. It checks diagnostic counts, codes, lines, required fragments and code/line agreement. It rejects unparsed compiler output. Both compilers report 102 expected diagnostics and zero unexpected diagnostics.
- **Observed:** final `pnpm test:coverage` exits zero: 157 files and 3,656 tests pass. Coverage is 98.03% lines, 96.63% branches, 97.74% statements, and 96.45% functions. No test is skipped. Complete coverage output (`_bmad-output/features/wide-config-gate/coverage-corrected.log`).

The first full coverage run passed 3,653 tests and failed three CONF-8 checks. The new helper imported `node:assert/strict`, which the existing module rules prohibit outside pinned harness modules. The correction uses the repository's allowed assertion API; it does not alter the guard, its allowlist, or assertion strength. The initial failed run did not produce a usable coverage report. The corrected full run produced the passing global coverage result above; this required the complete coverage command.

Reproduce the sampled fixture verification from `packages/core`:

```sh
node scripts/check-wide-config-gate.mjs \
  --tsgo /tmp/wide-config-tools/node_modules/.bin/tsgo \
  --report /tmp/wide-config-fixtures.json
```

The native compiler was installed in a temporary tooling directory. The package manifest and lockfile remain unchanged. Its exact version is `7.0.0-dev.20260707.2`.

## Reproduction output

**Observed:** command `_bmad-output/features/wide-config-gate/repro/run.sh HEAD`, against production source revision `40496c096dcc707098c20c4487dbeb680da8e574`.

The copied repro script's grep recognizes either direction of the wide conditional. This adapts its textual check to the implementation; fixture content and compilation remain unchanged. The supplied printer filters unrelated global diagnostics and truncates messages. The complete dual-compiler runner supplies the unfiltered evidence.

```text
=== commit HEAD, gate as committed
--- bypass.ts
DIAG TS2345 bypass.ts:11 Argument of type '{ readonly initial: string; readonly states: Readonly<Record<string, object>>; }' is not assignable to parameter of type 'MachineConfigMembers
TYPE bypass config-is-constraint=false
ts 6.0.3 diagnostic run finished
--- literal.ts
DIAG TS2322 literal.ts:9 Type '{ src: "agent"; input: number; }' is not assignable to type '((Omit<InvokeConfigMembers<unknown, AnyEventObject, unknown, SetupNames<Record<string, SetupA
DIAG TS2322 literal.ts:9 Type '"nowhere"' is not assignable to type '"nowhere" & UnknownTarget<"nowhere">'.   Type 'string' is not assignable to type 'UnknownTarget<"nowhere">'.
TYPE control config-is-constraint=true
ts 6.0.3 diagnostic run finished
--- forms.ts
TYPE inlineAssign config-is-constraint=false
TYPE destructuring config-is-constraint=false
TYPE contextFactory config-is-constraint=false
TYPE enqueued config-is-constraint=false
ts 6.0.3 diagnostic run finished
=== gate failing closed for every agent setup
--- bypass.ts
DIAG TS2345 bypass.ts:11 Argument of type '{ readonly initial: string; readonly states: Readonly<Record<string, object>>; }' is not assignable to parameter of type 'MachineConfigMembers
TYPE bypass config-is-constraint=false
ts 6.0.3 diagnostic run finished
--- forms.ts
TYPE inlineAssign config-is-constraint=false
TYPE destructuring config-is-constraint=false
TYPE contextFactory config-is-constraint=false
TYPE enqueued config-is-constraint=false
ts 6.0.3 diagnostic run finished
```

## Type cost

**Observed:** the same 35-state chain, compiler options, locked dependencies and TypeScript 6.0.3 produced these counts:

| Source | Instantiations | Diagnostics |
| --- | ---: | ---: |
| Baseline c30b211344a559749a1591874523c04aa1a5aaf5 | 311,503 | 0 |
| Candidate 40496c096dcc707098c20c4487dbeb680da8e574 | 344,866 | 0 |
| Change | +33,363 (+10.71%) | 0 |

**Inferred cause:** the second graph-inference path, additional generic signature machinery, and structural readability scan instantiate more types. This attribution follows the source changes; it is not a separate compiler profile. The increase exceeds 10%, so this report records it instead of claiming the threshold passed. No wall-clock speed claim follows from these runs.

The fixture and complete output are preserved in cost (`_bmad-output/features/wide-config-gate/cost`), before (`_bmad-output/features/wide-config-gate/cost-before.log`), and after (`_bmad-output/features/wide-config-gate/cost-after.log`).

## Attempt record

The two investigators preserved 32 and 17 experiment records, respectively. These records overlap and do not represent 49 distinct mechanisms. Early exploratory printers truncated individual diagnostic text; their counts, codes and lines remain recorded. Final acceptance runners preserve complete messages. Some early exported scratch repos lacked test-support modules; those failed runs are not treated as authoritative repository results.

The table below lists every first-investigator record. `original` means the original signature with the gate forced closed, not the permissive baseline. The linked transform script records the exact variant definitions.

| Variant | Suite | Observed diagnostics | Interpretation |
| --- | --- | ---: | --- |
| `original` | original forms.ts + bypass.ts | 5 | Original console printed all diagnostic records but truncated each message. Exact transforms remain in run.mjs. |
| `object` | original forms.ts + bypass.ts | 5 | Original console printed all diagnostic records but truncated each message. Exact transforms remain in run.mjs. |
| `unknown` | original forms.ts + bypass.ts | 5 | Original console printed all diagnostic records but truncated each message. Exact transforms remain in run.mjs. |
| `empty` | original forms.ts + bypass.ts | 5 | Original console printed all diagnostic records but truncated each message. Exact transforms remain in run.mjs. |
| `graph` | original forms.ts + bypass.ts | 5 | Original console printed all diagnostic records but truncated each message. Exact transforms remain in run.mjs. |
| `configfirst` | original forms.ts + bypass.ts | 5 | Original console printed all diagnostic records but truncated each message. Exact transforms remain in run.mjs. |
| `unconstrainedFirst` | original forms.ts + bypass.ts | 5 | Original console printed all diagnostic records but truncated each message. Exact transforms remain in run.mjs. |
| `noDefault` | original forms.ts + bypass.ts | 5 | Original console printed all diagnostic records but truncated each message. Exact transforms remain in run.mjs. |
| `noConstraintDefault` | original forms.ts + bypass.ts | 5 | Original console printed all diagnostic records but truncated each message. Exact transforms remain in run.mjs. |
| `noInferInside` | original forms.ts + bypass.ts | 5 | Original console printed all diagnostic records but truncated each message. Exact transforms remain in run.mjs. |
| `proofDefault` | original forms.ts + bypass.ts | 5 | Original console printed all diagnostic records but truncated each message. Exact transforms remain in run.mjs. |
| `allDefault` | original forms.ts + bypass.ts | 5 | Original console printed all diagnostic records but truncated each message. Exact transforms remain in run.mjs. |
| `thisProof` | original forms.ts + bypass.ts | 5 | Original console printed all diagnostic records but truncated each message. Exact transforms remain in run.mjs. |
| `thisAll` | original forms.ts + bypass.ts | 5 | Original console printed all diagnostic records but truncated each message. Exact transforms remain in run.mjs. |
| `splitStates` | original forms.ts + bypass.ts | 1 | Prototype requires root initial and states; not a complete solution. |
| `returnOnly` | original forms.ts + bypass.ts | 0 | Rejected: wide config call compiles; return carries proof error only. |
| `deepUnion` | See diagnostic file paths; records from latest invocation only | 2 | Recorded diagnostic file; later full-suite checks determine acceptance. |
| `boundDeep` | See diagnostic file paths; records from latest invocation only | 4 | Recorded diagnostic file; later full-suite checks determine acceptance. |
| `statesInline` | See diagnostic file paths; records from latest invocation only | 1 | Recorded diagnostic file; later full-suite checks determine acceptance. |
| `deepFields` | See diagnostic file paths; records from latest invocation only | 0 | Recorded diagnostic file; later full-suite checks determine acceptance. |
| `boundFields` | See diagnostic file paths; records from latest invocation only | 4 | Recorded diagnostic file; later full-suite checks determine acceptance. |
| `deepDictionaries` | See diagnostic file paths; records from latest invocation only | 0 | Recorded diagnostic file; later full-suite checks determine acceptance. |
| `returnOnly` | See diagnostic file paths; records from latest invocation only | 0 | Recorded diagnostic file; later full-suite checks determine acceptance. |
| `deepMap` | See diagnostic file paths; records from latest invocation only | 12 | Recorded diagnostic file; later full-suite checks determine acceptance. |
| `deepIntersection` | See diagnostic file paths; records from latest invocation only | 68 | Recorded diagnostic file; later full-suite checks determine acceptance. |
| `roleMap` | See diagnostic file paths; records from latest invocation only | 1 | Recorded diagnostic file; later full-suite checks determine acceptance. |
| `splitNoInferFields` | array-invoke + done-assign | 2 | NoInfer callbacks did not preserve array-invoke event contextual typing. |
| `splitPath` | typed holder root4, nested callbacks, state input, events input/actions | 0 | Recorded diagnostic file; later full-suite checks determine acceptance. |
| `splitPath` | array-invoke + done-assign | 0 | Recorded diagnostic file; later full-suite checks determine acceptance. |
| `splitPathGuard` | typed holder root4, nested/collision callbacks, typed event guard, explicit undefined guard | 0 | Recorded diagnostic file; later full-suite checks determine acceptance. |
| `splitPathGuard` | array-invoke typed guard + done-assign | 0 | Recorded diagnostic file; later full-suite checks determine acceptance. |
| `splitPathGuard` | all final focused fixtures combined | 0 | Recorded diagnostic file; later full-suite checks determine acceptance. |

Second-investigator records:

| Variant | Change | Observed outcome |
| --- | --- | --- |
| `rest-proof-only` | Move SettlementProof from parameter intersection to conditional rest tuple. | Rejected: all four valid forms fail with TS2554 and TConfig falls back to its constraint. |
| `rest-all-checks` | Move all five checks to conditional rest tuple. | Rejected: all four valid forms still fail with TS2554. |
| `shallow-map-constrained` | Replace naked TConfig with homomorphic property map; retain original constraint. | Rejected: three valid forms fail; context factory succeeds. |
| `shallow-map-object` | Use TConfig extends object and homomorphic property map. | Partial: root forms and real target/progress diagnostics succeed; root any bypasses. |
| `shallow-direct-capture` | Add naked TConfig alongside its map and IsAny rest on that same generic. | Rejected: root any still passes. |
| `separate-any-capture` | Add independent TArg capture and conditional IsAny rest. | Partial: root any refused; broad no-agent typing regressions and nested callback failures remain. Scratch suite also lacked some copied modules. |
| `conditional-shallow` | Choose original signature for no settled actors; mapped signature otherwise. | Partial: no-agent regressions removed. COV1:171 and COV2:722 false refusals remain. Five other diagnostics result from omitted scratch Vitest config files. |
| `deep-fields` | Recursive map, with context/entry/exit/actions/guard/input/output as direct leaves. | Partial: both compilers reject the negative samples and accept the valid forms; two provisional A7-onDone message expectations differ. Full suite finds inline actor incompatibility, nested assign contextual failures, and one genuine SIDE refusal. |
| `deep-leaf-noinfer` | Apply NoInfer to all leaf values, including src. | Rejected: literal graph inference breaks and many false refusals appear. |
| `actions-only-noinfer` | Apply NoInfer only to actions; retain other direct leaves. | Rejected: nested assign loses event.output. |
| `deep-intersection` | Recursively infer T[K] intersected with its mapped descendants. | Partial: nested assign succeeds. Invocation-array callback loses context, inline actor narrows incorrectly, genuine SIDE refusal remains. |
| `split-raw-and-graph` | Retain original constrained TConfig for context/return; infer separate TGraph for checks. Preserve unknown recursively. | Partial: root forms, root any, inline actors and nested assign succeed. Invocation-array contextual typing still fails. |
| `split-fields` | Use direct callback leaves with separate constrained TConfig and proof graph. | Rejected: invocation-array context succeeds but nested assign fails. |
| `split-hybrid` | Use direct callback leaves and recursive intersections elsewhere. | Rejected: nested assign succeeds but invocation-array event becomes any. |
| `split-array-special` | Remove direct intersection when a mapped value is an array. | Rejected: invocation-array event remains any. |
| `split-opaque-callbacks` | Use unknown callback leaves, retain src identity, retain original constrained TConfig for contextual typing and return. | Partial: full suite has only genuine COV2:1387 SIDE refusal. Both compilers agree on all 80 matrix cases. Path-aware helper still needed for keys that match callback names. |
| `path-aware-and-structural-any` | Use path-aware dictionary mapping from inference_research; add StructuralAny early gates to TargetCheck and SettlementProof. | Best partial candidate: integrated 84 cases pass, both compilers report 68 expected diagnostics. All 17 additional negatives refuse with matching code/line, opaque-any positive compiles, no TS2589. Full suite has only genuine COV2:1387 SIDE refusal. Does not solve the erased-spread A5 counterexample reported by parent. |

Detailed records: first investigator (`_bmad-output/features/wide-config-gate/inference-research/attempts.json`), exact transforms (`_bmad-output/features/wide-config-gate/inference-research/run.mjs`), second investigator (`_bmad-output/features/wide-config-gate/compiler-attempts.json`). Their cited temporary files remain available; the first investigator's diagnostic JSON files also reside beside the copied transform script.

**Observed failed lead:** putting the refusal only on the return type produces zero diagnostics for both `forms.ts` and `bypass.ts`. The unused bad return does not make the call fail. This does not meet A1.

**Observed partial success:** separate contextual and structural generics resolve the inference problem. They do not recover erased object-spread information, so they cannot establish the broad A5 rule.

## Commits

Implementation and evidence commits before this report commit follow. Each message includes Why, Source and Notes. All identifiers come directly from Git.

- `d02f2baa58c8cbf7c6eefd35f11681d9d0aeacc9` — Record the const-variable spread counterexample
- `24fa08d00ae8122d0c0d6b8988520f8c2500da61` — Preserve the erased-spread counterexample
- `fd6bb56469102d0df1f741da9746504f3bd1ac5d` — Use the approved assertion API in settlement fixtures
- `434132c8e02da734c23de7b4344d10cbe684c9e6` — Cover nested inference and erased structural inputs
- `40496c096dcc707098c20c4487dbeb680da8e574` — Refuse erased graph fields before resolving targets
- `1af6285b39a255d7888032cc50d4238f5c9697ba` — Assert the sibling tool fixture's compile-time refusal
- `b3c4d6185e99a71f8cb40fa3c689077007b7b44d` — Infer settlement graphs before checking setup calls
- `e0ef787fb00d30dbae32d8820c0f6e0c7220f03f` — Add a reproducible dual-compiler settlement check
- `c3ffcbe61cef5f162c1198819569ddbc5b5e2a7c` — Cover the complete wide-config acceptance matrix
- `40599eb7e3ba47167990d5468a9495d3c2c0baa4` — Add a failing regression for unreadable setup configs

## Remaining acceptance gaps

**Observed:** A5's erased-spread case still compiles under both required compilers. **Inferred:** the permitted signature cannot distinguish its erased type from the valid control's identical type. The candidate therefore remains partial. E2 also remains partial under its strict per-check wording: the standalone target check can accept a wide shape even though the composed setup call refuses it. No runtime proof, certificate, lint rule, skipped test, or revised acceptance criterion replaces the missing guarantee.
