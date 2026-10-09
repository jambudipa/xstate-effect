# src/testing

Test helpers that ship with the package: the pure transition functions (upstream
`getNextSnapshot.ts` and `transition.ts`), `waitFor`, `toEffect` and `toPromise`, and the
simulated clocks. The root entry point re-exports them, by name and as the `testing` namespace;
there is no `./testing` subpath.

## What belongs here

Helpers that a user's test calls to compute snapshots without an actor, to wait on an actor's
snapshots or output, or to control time. A change to what a transition does belongs in the
engine (`src/stateUtils.ts`, `src/StateMachine.ts`), not here: the pure helpers only call the
logic's own `transition` and `getInitialSnapshot` with an inert actor scope.

## Where to start

- `getNextSnapshot.ts` holds `createInertActorScope` and the pure functions. Production code
  also uses the inert scope (`StateMachine.ts` and the graph code), so a change to it is not a
  test-only change.
- `SimulatedClock.ts` holds the `SimulatedClock` class, which `ActorSystem.ts` imports: the
  scheduler calls its internal `_setEffectTimeout`, so that an `increment` waits for each
  delivery (SD-28). `makeSimulatedClock` is a separate, synchronous clock kept for
  compatibility (COMPAT-4).

## Constraints

- The pure helpers run no action. The inert scope's methods do nothing, and `transition`,
  `initialTransition` and the microstep helpers only collect the actions. A new member of
  `ActorScopeService` or `ActorSystemService` needs an inert version in
  `createInertActorScope` that has no side effect.
- What upstream throws fails the Effect (`GuardError`, `TransitionError`,
  `InitializationError`, SD-3); any other thrown value stays a defect.
- `waitFor` and `toEffect` read the actor's `changes` stream in the caller's fiber and leave no
  fiber, subscription or listener behind. The Promise forms only wrap the Effect forms with
  `Effect.runPromise`.
- Each helper names the upstream function it mirrors. A behaviour that differs from upstream
  needs a decision in `docs/decisions.md` and a row in `test/upstream/CONFORMANCE.md`.
