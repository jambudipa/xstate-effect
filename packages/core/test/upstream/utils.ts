/**
 * Port of upstream `packages/core/test/utils.ts` (xstate@5.33.2) in Effect form.
 *
 * Written against the target API (SD-13): `getNextSnapshot` returns an Effect, so
 * `testMultiTransition` returns an Effect; `machine.resolveState` returns an Effect too (SD-3,
 * amended 2026-10-08), so `computeNext` runs both in one Effect; `testAll`
 * makes one `it.effect` per inner key of `expected`, with the upstream title template. The
 * parity checker counts the assertions in the `testAll` body for every `testAll` annotation
 * (examples 6.16, 6.6, 6.8, 6.9, cd and id), so the body keeps the three upstream assertions.
 *
 * This file stays in `test/upstream/pending.json` until the CONF-3 import of `id`, its first
 * green user. `trackEntries` lives in `./trackEntries.ts`, which is not pending.
 */
import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import {
  type AnyMachineSnapshot,
  type AnyStateMachine,
  getNextSnapshot,
  matchesState,
  type StateValue
} from "../../src/index.js"

// upstream: test/utils.ts > resolveSerializedStateValue
const resolveSerializedStateValue = (machine: AnyStateMachine, serialized: string) =>
  serialized[0] === "{"
    ? machine.resolveState({ value: JSON.parse(serialized), context: {} })
    : machine.resolveState({ value: serialized, context: {} })

// upstream: test/utils.ts > testMultiTransition
export function testMultiTransition(machine: AnyStateMachine, fromState: string, eventTypes: string) {
  const computeNext = (state: AnyMachineSnapshot | string, eventType: string) =>
    Effect.gen(function* () {
      const resolved = typeof state === "string" ? yield* resolveSerializedStateValue(machine, state) : state
      return yield* getNextSnapshot(machine, resolved, {
        type: eventType
      })
    })

  const [firstEventType = "", ...restEvents] = eventTypes.split(/,\s?/)

  return Effect.gen(function* () {
    let resultState = yield* computeNext(fromState, firstEventType)
    for (const eventType of restEvents) {
      resultState = yield* computeNext(resultState, eventType)
    }
    return resultState
  })
}

// upstream: test/utils.ts > testAll
export function testAll(
  machine: AnyStateMachine,
  expected: Record<string, Record<string, StateValue | undefined>>
): void {
  Object.entries(expected).forEach(([fromState, transitions]) => {
    Object.entries(transitions).forEach(([eventTypes, toState]) => {
      it.effect(`should go from ${fromState} to ${JSON.stringify(toState)} on ${eventTypes}`, () =>
        Effect.gen(function* () {
          const resultState = yield* testMultiTransition(machine, fromState, eventTypes)

          if (toState === undefined) {
            // undefined means that the state didn't transition
            expect(resultState.value).toEqual((yield* resolveSerializedStateValue(machine, fromState)).value)
          } else if (typeof toState === "string") {
            expect(matchesState(toState, resultState.value)).toBeTruthy()
          } else {
            expect(resultState.value).toEqual(toState)
          }
        }))
    })
  })
}
