/**
 * Port of `trackEntries` from upstream `packages/core/test/utils.ts` (xstate@5.33.2).
 *
 * It lives in its own module, not in `utils.ts`: `utils.ts` is written against the target API
 * and stays pending until the CONF-3 import of `id`, while `deep` (green in phase 2) and six
 * more phase-2 rewrites use `trackEntries`. This module imports only `createMachine`, which
 * exists now and stays (D9).
 *
 * Upstream unshifts a logging function into `StateNode.entry` and `StateNode.exit` of every
 * state node. The port's state nodes are immutable, and T2.32 rebuilds the node model (the
 * collection types change), so this port never touches a node. It copies the machine config
 * with the same logging function first in `entry` and `exit` of every state node config,
 * rebuilds the machine with `createMachine(config, machine.implementations)` (what XState's
 * own `provide` does), and grafts the rebuilt machine's own properties onto the given
 * machine. The caller's machine object is tracked in place, so a rewrite keeps the upstream
 * call shape: `const flushTracked = trackEntries(machine)`, then `createActor(machine)`.
 *
 * The logging functions are XState inline function actions (D15).
 */
import { createMachine } from "../../src/index.js"

/** The public parts of a machine that `trackEntries` reads and replaces. */
export interface TrackableMachine {
  readonly config: object
  readonly implementations: object
}

type StateNodeConfig = Readonly<Record<string, unknown>>

/** XState `toArray`: an action list, a single action, or none. */
const toArray = (value: unknown): ReadonlyArray<unknown> =>
  Array.isArray(value) ? value : value === undefined ? [] : [value]

const seen = new WeakSet<TrackableMachine>()

// upstream: test/utils.ts > trackEntries
export function trackEntries(machine: TrackableMachine): () => Array<string> {
  if (seen.has(machine)) {
    throw new Error(`This helper can't accept the same machine more than once`)
  }
  seen.add(machine)

  let logs: Array<string> = []

  function addTrackingActions(state: StateNodeConfig, stateDescription: string): StateNodeConfig {
    return {
      ...state,
      entry: [
        function __testEntryTracker() {
          logs.push(`enter: ${stateDescription}`)
        },
        ...toArray(state["entry"])
      ],
      exit: [
        function __testExitTracker() {
          logs.push(`exit: ${stateDescription}`)
        },
        ...toArray(state["exit"])
      ]
    }
  }

  function addTrackingActionsRecursively(state: StateNodeConfig, path: ReadonlyArray<string>): StateNodeConfig {
    const states = state["states"]
    if (typeof states !== "object" || states === null) {
      return state
    }
    return {
      ...state,
      states: Object.fromEntries(
        Object.entries(states as Readonly<Record<string, StateNodeConfig>>).map(([key, child]) => {
          const childPath = [...path, key]
          return [key, addTrackingActionsRecursively(addTrackingActions(child, childPath.join(".")), childPath)]
        })
      )
    }
  }

  const config = addTrackingActionsRecursively(addTrackingActions(machine.config as StateNodeConfig, `__root__`), [])
  const tracked = createMachine(
    config as unknown as Parameters<typeof createMachine>[0],
    machine.implementations as Parameters<typeof createMachine>[1]
  )
  Object.defineProperties(machine, Object.getOwnPropertyDescriptors(tracked))

  return () => {
    const flushed = logs
    logs = []
    return flushed
  }
}
