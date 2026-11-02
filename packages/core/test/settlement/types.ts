/**
 * The library's settlement type tests, which `pnpm check:settlement` compiles on their own. Each
 * `@ts-expect-error` is a rule of the compile-time proof: the build fails when the rule stops
 * refusing the line below it. jamcode's specs match the exact diagnostics.
 */
import { Effect } from "effect"
import { fromEffect } from "../../src/actors/index.js"
import { setup } from "../../src/index.js"
import { markAgentLogic } from "../../src/internal/agentBrand.js"

/** The one setup of these cases: an agent that settles at once. */
const agentSetup = setup({
  actors: { agent: markAgentLogic(fromEffect((_: { input: number }) => Effect.succeed({ reason: "silent" as const, attempts: 3 }))) },
})

/** A handler that leaves the state compiles. */
export const settles = agentSetup.createMachine({
  initial: "waiting",
  states: {
    waiting: { invoke: { src: "agent", input: 1, onDone: "done" }, on: { PING: {} } },
    done: { type: "final" },
  },
})

/** An invocation with no settlement handler does not. */
export const noHandler = agentSetup.createMachine({
  initial: "waiting",
  states: {
    // @ts-expect-error The agent's invocation names no onDone.
    waiting: { invoke: { src: "agent", input: 1 }, on: { PING: {} } },
    done: { type: "final" },
  },
})

/** A handler that stays in the invoking state does not. */
export const stays = agentSetup.createMachine({
  initial: "waiting",
  states: {
    // @ts-expect-error The agent's onDone must leave the invoking state.
    waiting: { invoke: { src: "agent", input: 1, onDone: { actions: [] } }, on: { PING: {} } },
    done: { type: "final" },
  },
})

/** A state that no path leaves does not. */
export const stuck = agentSetup.createMachine({
  initial: "waiting",
  states: {
    // @ts-expect-error The state leads only to the sink, so it never reaches a final state.
    waiting: { invoke: { src: "agent", input: 1, onDone: "sink" }, on: { PING: {} } },
    // @ts-expect-error The sink never reaches a final state.
    sink: {},
    done: { type: "final" },
  },
})

/** A delay of infinity never fires, so it guarantees no progress. */
export const neverFires = agentSetup.createMachine({
  initial: "waiting",
  states: {
    waiting: { invoke: { src: "agent", input: 1, onDone: "idle" }, on: { PING: {} } },
    // @ts-expect-error The after never fires, so nothing moves the state.
    idle: { after: { Infinity: "done" } },
    done: { type: "final" },
  },
})

/** A finite delay does. */
export const fires = agentSetup.createMachine({
  initial: "waiting",
  states: {
    waiting: { invoke: { src: "agent", input: 1, onDone: "idle" }, on: { PING: {} } },
    idle: { after: { 10: "done" } },
    done: { type: "final" },
  },
})

/** A child selects first, so a wildcard below the invoking state takes the agent's done event. */
export const wildcardBelow = agentSetup.createMachine({
  initial: "waiting",
  states: {
    waiting: {
      invoke: { src: "agent", input: 1, onDone: "done" },
      on: { PING: {} },
      initial: "inner",
      states: {
        inner: {
          on: {
            // @ts-expect-error A child's wildcard takes the agent's done event.
            "xstate.done.actor.*": {},
          },
        },
      },
    },
    done: { type: "final" },
  },
})

/** A partial key below the invoking state matches a done event too. */
export const partialBelow = agentSetup.createMachine({
  initial: "waiting",
  states: {
    waiting: {
      invoke: { src: "agent", id: "mind", input: 1, onDone: "done" },
      on: { PING: {} },
      initial: "inner",
      states: {
        inner: {
          on: {
            // @ts-expect-error A partial key matches the event `xstate.done.actor.mind`.
            "xstate.done.actor.mind.*": {},
          },
        },
      },
    },
    done: { type: "final" },
  },
})

/** A region beside the agent selects too, and can win the conflict. */
export const wildcardBeside = agentSetup.createMachine({
  initial: "both",
  states: {
    both: {
      type: "parallel",
      states: {
        left: {
          initial: "working",
          states: { working: { invoke: { src: "agent", input: 1, onDone: "#done" }, on: { PING: {} } } },
        },
        right: {
          initial: "watching",
          states: {
            watching: {
              after: { 10: "#done" },
              on: {
                // @ts-expect-error A region beside the agent takes its done event.
                "*": "#done",
              },
            },
          },
        },
      },
    },
    done: { id: "done", type: "final" },
  },
})

/** Beside an agent whose onDone stays in its region, a wildcard that stays in its own runs beside it. */
export const wildcardStaysInItsRegion = agentSetup.createMachine({
  type: "parallel",
  states: {
    left: {
      initial: "working",
      states: { working: { invoke: { src: "agent", input: 1, onDone: "finished" }, on: { PING: {} } }, finished: { type: "final" } },
    },
    right: {
      initial: "watching",
      states: { watching: { on: { "*": "closed" }, after: { 10: "closed" } }, closed: { type: "final" } },
    },
  },
})

/** Beside an agent whose onDone exits the regions, a wildcard with any target conflicts with it. */
export const wildcardConflicts = agentSetup.createMachine({
  initial: "both",
  states: {
    both: {
      type: "parallel",
      states: {
        left: {
          initial: "working",
          states: { working: { invoke: { src: "agent", input: 1, onDone: "#done" }, on: { PING: {} } } },
        },
        right: {
          initial: "watching",
          states: {
            watching: {
              after: { 10: "#done" },
              on: {
                // @ts-expect-error Both exit sets hold this state, so document order can drop onDone.
                "*": "closed",
              },
            },
            closed: { after: { 10: "#done" } },
          },
        },
      },
    },
    done: { id: "done", type: "final" },
  },
})

/** A wildcard on the invoking state, on an ancestor and in an unrelated state takes nothing from the agent. */
export const wildcardsAside = agentSetup.createMachine({
  initial: "around",
  states: {
    around: {
      on: { "*": {} },
      initial: "waiting",
      states: { waiting: { invoke: { src: "agent", input: 1, onDone: "#idle" }, on: { "*": {}, PING: {} } } },
    },
    idle: { id: "idle", on: { "*": {} }, after: { 10: "done" } },
    done: { type: "final" },
  },
})
