# src/guards

The `@jambudipa/xstate-effect/guards` entry point: the built-in guards (`stateIn`, `and`, `or`,
`not`, and the port extra `stateNotIn`) and `evaluateGuard`, the one evaluator that the engine
and every built-in guard share (upstream `src/guards.ts` at xstate@5.33.2).

## What belongs here

Guard creators and guard evaluation. The guard types (`Guard`, `GuardDefinition`,
`GuardContext`, `GuardScope`, `BuiltInGuardDefinition`) live in `src/Types.ts`. Transition
selection, which decides when a guard runs, lives in `src/stateUtils.ts` and calls
`evaluateGuard`; `src/ActorLogic.ts` also gives it to an action's context.

## Where to start

Read `evaluateGuard.ts` first. Every guard form (inline function, port `GuardDefinition`, name,
`{ type, params }`) resolves there, and its JSDoc states the failure contract.

## Rules that span the files

- **Evaluate through `evaluateGuard`.** A built-in guard evaluates the guards it holds with
  `evaluateGuard` and the scope from `guardScopeOf`, never by calling a predicate itself. That
  path resolves names against the implementations, counts the nesting depth and keeps every
  failure a `GuardError`.
- **Closure, not params.** A built-in guard reads its guards or state value from its closure;
  its `params` only shows them. So it decides the same way when a machine uses it by name with
  other params, as upstream ignores the params of that use.
- **Failures.** An unknown name fails with `GuardError` and upstream's message. A guard function
  that throws, or whose Effect fails, is a defect that keeps the original value (SD-4). A guard
  that refers back to itself through a built-in guard stops at 10,000 nested evaluations with
  `GuardError` and the stack-overflow message upstream gives.
- **Snapshot for `stateIn`.** `stateIn` reads the snapshot in the guard scope. Without one, no
  state is active and it is false.
- **Typing pattern.** `and`, `or` and `not` are cast to an interface with a second signature that
  no value can call. It exists only so the type checker defers an inline call until the machine
  has inferred its types. Keep that signature when you change or add a combinator.
