/**
 * @since 0.1.0
 * @module testing
 *
 * Testing utilities for effect-xstate.
 */

// SimulatedClock
export {
  type SimulatedTimeout,
  type Clock,
  SimulatedClock,
  type SyncSimulatedClock,
  makeSimulatedClock,
  createSimulatedClock,
  type SimulatedClockEffect,
  makeSimulatedClockEffect,
  TimeTravelError,
} from "./SimulatedClock.js"

// waitFor
export {
  WaitForTimeoutError,
  WaitForTerminatedError,
  type WaitForOptions,
  waitFor,
  waitForPromise,
} from "./waitFor.js"

// toPromise
export {
  ActorOutputError,
  toEffect,
  toPromise,
} from "./toPromise.js"

// getNextSnapshot
export {
  createInertActorScope,
  type ExecutableActionObject,
  type ExecutableActionsFrom,
  type ExecutableRaiseAction,
  type ExecutableSendToAction,
  type ExecutableSpawnAction,
  getInitialMicrosteps,
  getInitialSnapshot,
  getMicrosteps,
  getNextSnapshot,
  getNextTransitions,
  initialTransition,
  type SpecialExecutableAction,
  transition,
} from "./getNextSnapshot.js"
