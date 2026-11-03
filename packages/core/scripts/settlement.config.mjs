/**
 * The library's own settlement fixture: the config that `pnpm check:settlement` hands to the
 * gate. It is `.mjs`, so the Node of every supported version loads it with no transform, and a
 * function's source text, which the certificate hashes, is the same on each of them. A module
 * under `test/` has no lint block for `.mjs`, so it sits here beside the gate.
 *
 * The agents are real `fromAgent` logic, as the structural proof counts nothing else as
 * agent progress; `timeboxedAgent` adds a state whose only progress is a `finiteDelay` timer.
 * The explorer starts no actor, so no turn runs and the run stays deterministic. Each
 * environment drives every event its machine handles.
 */
import { assign, finiteDelay, fromAgent, setup } from "@jambudipa/xstate-effect"
import { processRestart, timerFirings } from "@jambudipa/xstate-effect/graph"
import { Effect, Schema } from "effect"

/** The settlement the explorer delivers: the budget is spent. */
const settlement = { reason: "silent", attempts: 3 }

/** The event that ends a review: the one tool of {@link reviewer}. */
const Approved = Schema.Struct({ type: Schema.Literal("APPROVED") })

/** Agent logic that settles when its budget is spent. */
const agent = fromAgent({ budget: 3, deadline: 30_000, tools: {}, turn: () => Effect.void })

/** Agent logic with a tool, as its invoking state must accept. */
const reviewer = fromAgent({ budget: 3, deadline: 30_000, tools: { APPROVED: Approved }, turn: () => Effect.void })

/** The small case: an agent state whose handler leaves it for a final state. */
const settlesAgent = setup({ actors: { agent } }).createMachine({
  id: "settlesAgent",
  initial: "asking",
  states: {
    asking: { invoke: { src: "agent", id: "agent", input: 1, onDone: "done" }, on: { PING: {} } },
    done: { type: "final" },
  },
})

/**
 * The full case: a review that retries. The retry cycle re-enters the agent state, so its guarded
 * edge names the falling counter `retries` as its ranking. The guard reads the context, a timer
 * moves the machine out of `backoff` and out of a review that takes too long, and the environment
 * restarts the process in every state.
 */
const retriesReview = setup({
  actors: { reviewer },
  guards: { hasRetries: ({ context }) => context.retries > 0 },
  delays: { patience: 60_000 },
}).createMachine({
  id: "retriesReview",
  context: { retries: 2 },
  initial: "reviewing",
  states: {
    reviewing: {
      invoke: {
        src: "reviewer",
        id: "reviewer",
        input: { diff: "" },
        onDone: [
          {
            guard: "hasRetries",
            target: "backoff",
            actions: assign({ retries: ({ context }) => context.retries - 1 }),
            meta: { ranking: "retries" },
          },
          { target: "failed" },
        ],
      },
      on: { APPROVED: "approved" },
      after: { patience: "failed" },
    },
    backoff: { after: { 1000: "reviewing" } },
    approved: { type: "final" },
    failed: { type: "final" },
  },
})

/** Agent logic with the tool `GO`, as the brief's repro of a per-instance timebox has. */
const worker = fromAgent({ budget: 3, deadline: 30_000, tools: { GO: Schema.Struct({ type: Schema.Literal("GO") }) }, turn: () => Effect.void })

/**
 * The brief's repro with `finiteDelay` (0.4.1): each delay is computed from the context at entry
 * and clamped to a literal bound. `waiting` has no exit but its `warmup` timer, so the proof
 * holds only if it counts a `finiteDelay` as sure to fire; `running` leaves on its agent, on
 * `GO`, or when its `timebox` passes.
 */
const timeboxedAgent = setup({
  actors: { worker },
  delays: {
    warmup: finiteDelay(({ context }) => context.warmup, { max: 60_000 }),
    timebox: finiteDelay(({ context }) => context.deadline, { max: 14_400_000 }),
  },
}).createMachine({
  id: "timeboxedAgent",
  context: { warmup: 1_000, deadline: 60_000 },
  initial: "waiting",
  states: {
    waiting: { after: { warmup: "running" } },
    running: {
      invoke: { src: "worker", id: "worker", input: 1, onDone: "done" },
      on: { GO: "done" },
      after: { timebox: "done" },
    },
    done: { type: "final" },
  },
})

export default {
  output: "../test/settlement/certificate.ts",
  machines: {
    settlesAgent: {
      machine: settlesAgent,
      environment: {
        catalogue: ["settle", "ping"],
        inputs: {
          settle: () => [{ type: "xstate.done.actor.agent", output: settlement }],
          ping: () => [{ type: "PING" }],
        },
        abstraction: {},
        timeout: "30 seconds",
      },
    },
    retriesReview: {
      machine: retriesReview,
      environment: {
        catalogue: ["settle", "approve", "timer", "restart"],
        inputs: {
          settle: () => [{ type: "xstate.done.actor.reviewer", output: settlement }],
          approve: () => [{ type: "APPROVED" }],
          timer: timerFirings,
          restart: processRestart(retriesReview),
        },
        abstraction: { retries: (value) => Number(value) },
        timeout: "30 seconds",
      },
    },
    timeboxedAgent: {
      machine: timeboxedAgent,
      environment: {
        catalogue: ["settle", "go", "timer", "restart"],
        inputs: {
          settle: () => [{ type: "xstate.done.actor.worker", output: settlement }],
          go: () => [{ type: "GO" }],
          timer: timerFirings,
          restart: processRestart(timeboxedAgent),
        },
        // Each delay reads its bound field at entry; neither changes, so each keeps its value
        abstraction: { warmup: (value) => Number(value), deadline: (value) => Number(value) },
        timeout: "30 seconds",
      },
    },
  },
}
