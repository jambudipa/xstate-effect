---
title: fromAgent and AgentTurn
doc-type: reference
sources: [packages/core/src/actors/fromAgent.ts, packages/core/src/actors/unsettled.ts, packages/core/src/internal/agentMenu.ts]
---

# fromAgent and AgentTurn

> **TL;DR:** `fromAgent({ budget, deadline, tools, turn })` builds agent logic: the logic of one
> model call that must move its invoking state. Its `tools` are event Schemas keyed by event
> type, and each must be an event its invoking state accepts. It runs `turn` once per attempt,
> decodes each tool call at its boundary, classifies each attempt that moves nothing, prompts
> again with feedback, and ends with the one output `Unsettled` when the literal budget is
> spent. A move exits the state, which stops the agent with no output. Its error channel is
> `never`.

`fromAgent`, `AgentTurn` and the types below come from `@jambudipa/xstate-effect` and from
`@jambudipa/xstate-effect/actors`. Agent logic is a port addition; upstream XState has no
counterpart.

## Summary

| Export | Kind | Description |
| --- | --- | --- |
| [`fromAgent`](#fromagent) | function | Agent logic with a literal attempt budget and deadline. |
| [`AgentTurn`](#agentturn) | service tag | The capability only a `turn` receives. |
| [`AgentTurnService`](#agentturn) | interface | `attempt`, `transition(event)`, `malformed(event, detail)`. |
| [`AgentTools`, `KeyedTools`, `AgentToolCall`, `AgentToolsOf`](#tools-and-the-menu) | types | The tools record, its key rule, a tool call, and the logic's `tools`. |
| [`AgentToolNotAccepted`, `AgentStateAcceptsNoEvents`](#tools-and-the-menu) | types | The menu errors of a setup machine. |
| [`TurnOutcome`](#turnoutcome) | type | How one attempt failed to move the state. |
| [`TransitionReply`](#transitionreply) | type | What `transition` gives back when the state stayed. |
| [`AgentSnapshot`](#agentsnapshot) | interface | The snapshot, with the attempts started and the last outcome. |
| [`AgentActorLogic`](#agentactorlogic) | type | The branded logic that `fromAgent` returns. |
| `AgentAttemptEvent` | interface | The emitted `{ type: "attempt", attempt }`, ahead of each turn. |
| `AgentConfig`, `AttemptRecord`, `CheckedLiteral`, `PositiveIntegerLiteral` | types | The configuration and its literal checks. |

## fromAgent

### Signature

```ts
import type {
  AgentActorLogic,
  AgentTools,
  AgentTurn,
  AgentTurnService,
  CheckedLiteral,
  KeyedTools,
  TurnOutcome,
} from "@jambudipa/xstate-effect"
import type { Effect, Option } from "effect"

export declare const fromAgent: <
  const TBudget extends number,
  const TDeadline extends number,
  TInput,
  const TTools extends AgentTools,
  R = never
>(config: {
  readonly budget: TBudget & CheckedLiteral<TBudget, "budget">
  readonly deadline: TDeadline & CheckedLiteral<TDeadline, "deadline">
  readonly tools: TTools & KeyedTools<TTools>
  readonly turn: (
    input: TInput,
    attempt: number,
    feedback: Option.Option<TurnOutcome>,
    agent: AgentTurnService<keyof TTools & string>
  ) => Effect.Effect<unknown, never, R>
}) => AgentActorLogic<TInput, Exclude<R, AgentTurn>, TTools>
```

### Behaviour

- `budget` (attempts) and `deadline` (milliseconds per attempt) must be positive integer
  literals. Wide `number`, a union such as `2 | 3`, zero, a negative or fractional value,
  `1e21`, `Infinity`, `number & {}`, a branded number and a generic `N extends number` fail to
  compile at the field, with the message `<field> must be a positive integer literal`. A value
  that passes the types through a cast or plain JavaScript must still be a positive safe
  integer: otherwise the initial snapshot, the restore and `start` die with `AgentRunError`,
  the invoking actor gets status `error`, and no turn runs.
- `tools` is required: each key is an event type, and its value is that event's Schema (for a
  `setupWithSchema` machine, a member of the setup's event Schema). A key that is not the type
  its Schema decodes to fails to compile. See [Tools and the menu](#tools-and-the-menu).
- Each attempt first writes its count into the snapshot (`attempts`) and emits
  `{ type: "attempt", attempt }`, then runs `turn(input, attempt, feedback, agent)` with a new
  `AgentTurn` capability; `agent` is that capability, typed so that `transition` takes only the
  agent's tools. `feedback` is `None` on attempt 1 and the outcome of the attempt just
  before otherwise.
- A move is detected only by the state exit: `AgentTurn.transition(event)` delivers the event to
  the invoking machine and waits for its macrostep. When the event exits the state, the exit
  stops the agent before the call returns: no further prompt and no output.
- An attempt that moves nothing has one outcome. A deadline overrun is `overdue`, a defect (or a
  throw before `turn` returns an Effect) is `crashed`; otherwise the first outcome a call
  recorded (`illegal`, `malformed`); otherwise `silent`. A turn that succeeds is silent whatever
  it returns: text that names a transition is never a move.
- When the budget is spent the agent is `done` with `Unsettled { reason, attempts }`, where
  `reason` is the last outcome and `attempts` the turns used. A restored count above a budget
  that a redeploy lowered is reported as it stands. The invocation's required `onDone` receives it. No
  `xstate.error.actor.*` event is ever sent.
- A stop of the agent, its invoking state, its machine or its system interrupts the turn and
  outputs nothing; an interrupted agent is not unsettled.
- The persisted snapshot carries `attempts` and the last outcome, so a restore resumes after the
  attempts already started. An attempt that the process left unfinished counts as `crashed`.
  A persisted snapshot is untrusted: `attempts`, `last.attempt`, an `overdue` deadline and the
  `Unsettled` output decode as safe integers in range, and any other value fails the restore
  with `RestoreError`.

### Example

```ts
import { fromAgent, setupWithSchema } from "@jambudipa/xstate-effect"
import { Effect, Schema } from "effect"

declare const askModel: (prompt: string, attempt: number) => Effect.Effect<{ readonly tool: string; readonly args: unknown }>

const Submitted = Schema.Struct({ type: Schema.Literal("SUBMITTED"), summary: Schema.String })

const reporter = fromAgent({
  budget: 3,
  deadline: 60_000,
  tools: { SUBMITTED: Submitted },
  turn: (input: { readonly prompt: string }, attempt, _feedback, agent) =>
    Effect.gen(function* () {
      const reply = yield* askModel(input.prompt, attempt)
      // The payload is decoded by the SUBMITTED Schema before the machine sees it
      if (reply.tool === "SUBMITTED") yield* agent.transition({ type: "SUBMITTED", summary: reply.args })
    }),
})

export const machine = setupWithSchema({
  context: Schema.Struct({}),
  events: Submitted,
  actors: { reporter },
}).createMachine({
  context: {},
  initial: "asking",
  states: {
    asking: {
      invoke: { src: "reporter", input: { prompt: "Report your result." }, onDone: "unsettled" },
      on: { SUBMITTED: "done" },
    },
    unsettled: { type: "final" },
    done: { type: "final" },
  },
})
```

## AgentTurn

`AgentTurn` is a service tag that only `fromAgent` provides, and only to `turn`. A function that
needs it in its requirements therefore compiles only inside a `turn`: a plain `fromEffect` that
needs it leaves `AgentTurn` in its requirements, and no value of `AgentTurnService` can be built
by hand (its key is not exported).

- `attempt`: the attempt the capability belongs to, from 1.
- `transition(event)`: decodes `event` through its tool's Schema, delivers the decoded event and
  waits for the macrostep (see above). A type that is no tool of the agent (an `xstate.` event
  never is) is `illegal` and not delivered (`delivered: false`). A payload that fails its tool's
  Schema is `malformed`: it is not delivered, and the reply's and the feedback's `detail` hold
  the decode issues. The value `yield* AgentTurn` gives takes any event type; `turn`'s fourth
  argument takes only the agent's tools. While one
  delivery of the attempt is in flight, a second call is not delivered and is `illegal`. A call
  through a capability whose attempt has ended is refused as `stale`, at or after its deadline
  instant as `overdue`, and after `Unsettled` as `settled`; a refused call never reaches the
  machine. The deadline is checked against the clock, so a call at the deadline instant is
  refused whatever order the fibers run in. A delivery does not depend on its caller: a turn
  that interrupts its own `transition`, with `Effect.timeout` or a race, gets no reply, but the
  delivery still runs and its result still counts. The attempt ends only when the delivery ends,
  so a macrostep that outlasts the deadline holds the next attempt back until it finishes.
- `malformed(event, detail)`: records that a tool call's payload did not decode; the attempt is
  `malformed` unless an earlier call recorded an outcome.

## TurnOutcome

```ts
export type TurnOutcome =
  | { readonly reason: "silent" }
  | { readonly reason: "illegal"; readonly event: string }
  | { readonly reason: "malformed"; readonly event: string; readonly detail: string }
  | { readonly reason: "crashed"; readonly detail: string }
  | { readonly reason: "overdue"; readonly deadline: number }
```

An `illegal` delivery left the state in place: the state ignores the event, its guard is false,
or the transition is targetless or targets a child of the state. An event whose type is no tool
of the agent is `illegal` too, and is never delivered.

## TransitionReply

```ts
export type TransitionReply =
  | { readonly status: "illegal"; readonly event: string; readonly delivered: boolean }
  | { readonly status: "malformed"; readonly event: string; readonly detail: string }
  | { readonly status: "refused"; readonly event: string; readonly reason: "stale" | "overdue" | "settled" }
```

## Tools and the menu

An agent's tools are checked against the events its invoking state accepts (S21). A setup
machine's `createMachine` walks the config as written and, at each agent invocation, computes the
state's menu:

- every event the state's own `on` handles, with or without a target (an accepted event that
  does not leave the state is still a tool; at run time it is an `illegal` turn);
- an event an ancestor handles, only when the nearest ancestor that names it has a target for it
  (a targeted transition from an ancestor exits the state);
- every event a sibling region of a parallel ancestor handles (it is delivered, and is `illegal`
  when it does not exit).

`on: { X: undefined }` removes `X`. A wildcard (`*`, `a.*`) and an `xstate.` event are never on
the menu. Events that only the agent state's own child states handle are not on it.

- A tool that is not on the menu fails at the invocation's `src` with
  `AgentToolNotAccepted<"<tool>", "<state path>">`.
- A state whose menu is empty cannot invoke an agent: `AgentStateAcceptsNoEvents<"<state path>">`.
- Agent logic typed with wide tools (`AgentActorLogic<TInput>`) fails the check closed; type it
  with its tools, `AgentActorLogic<TInput, R, typeof tools>`.

## AgentSnapshot

The snapshot of agent logic: the `Snapshot` fields (`output` is `Option<Unsettled>`), the
`input` while active, `attempts` (the attempts started) and `last`
(`Option<{ attempt, outcome }>`).

## AgentActorLogic

`AgentActorLogic<TInput, R, TTools>` has the members of an `ActorLogic` with `AgentSnapshot<TInput>`,
emitted `AgentAttemptEvent` and requirements `R`, intersected with the agent brand (`AgentBranded`)
and its `tools` (`AgentToolsOf<TTools>`). The
brand makes `onDone` required on its invocation and refuses it in every spawn.

Its `transition`, `start`, `restoreSnapshot` and `getPersistedSnapshot` require a capability that
only the actor runtime holds, and that no entry point exports, so a direct call of one of them
does not compile. It does not fit `ActorLogic` or `AnyActorLogic`, where the capability is optional,
so it cannot widen to them. It fits [`AnyLogicSlot`](./custom-logic.md#anylogicslot), which requires
the capability on every method.

A cast through `unknown` or `any` still compiles, so the logic also refuses at run time: a call of
one of these methods without the runtime's value dies with `AgentRunError` before a turn starts.
The runtime hands the value to logic that `fromAgent` built, and to no other logic.

## See also

- [Settlement proof and certificates](../settlement.md): the proofs that check a machine with agent logic.
- [Why agent machines must settle](../../explanation/agent-settlement.md).
- `Unsettled` (`src/actors/unsettled.ts`): the one output, `{ reason, attempts }`.
- [fromEffect, fromEffectBackground and fromEffectRetry](./from-effect.md): the plain Effect
  logic that `fromAgent` builds on.
