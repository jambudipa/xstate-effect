# src/actors

The actor logic creators of the `./actors` entry point: upstream's `fromPromise`,
`fromCallback`, `fromObservable`, `fromEventObservable` and `fromTransition`, the port's
`fromEffect`, `fromEffectBackground`, `fromEffectRetry` and `fromStream`, and
`createEmptyActor`. `unsettled.ts` holds `Unsettled`, the one output of agent logic, which an
agent invocation's required `onDone` receives (a port addition). `fromAgent.ts` holds
`fromAgent`, agent logic: a literal-bounded turn loop that classifies each attempt, prompts
again with feedback, and outputs `Unsettled` when the budget is spent, and `AgentTurn`, the
capability only its `turn` receives.

## What belongs here

A creator that turns user code into an `ActorLogic` value. The actor runtime (`Actor.ts`,
`ActorSystem.ts`), machine logic (`StateMachine.ts`) and the persisted-snapshot codecs
(`persistence.ts`) do not belong here; a creator only references them.

## Where to start

`index.ts` re-exports each creator and defines `createEmptyActor`. `fromPromise.ts` is the
plainest example of the pattern that the other creators follow.

## Constraints

- A creator returns a plain `ActorLogic` object. User code runs in `start`, inside the actor's
  own scope (D12), or in `transition` for the reducer of `fromTransition` and the listeners of
  `fromCallback`. A stop closes the scope: it unsubscribes, interrupts the fibers and runs each
  cleanup once.
- Asynchronous work never writes the snapshot. A settled promise, an ended Effect or a source
  value is relayed to the actor itself through the system, and `transition` turns that event
  into the next snapshot. A relay to an actor that is no longer active changes nothing.
- A plain function handed to user code (`emit`, `sendBack`, an observer's `next`, `error` and
  `complete`) posts its delivery through the actor's outbox (`src/internal/outbox.ts`), so it
  works from any code and is dropped after the stop.
- `output` and `error` are `Option` values (D8); `undefined` is `None` (SD-7). A throw, a
  rejection or a failure becomes the actor's error with the raw value (SD-4). A cleanup or an
  `unsubscribe` that throws is reported through the logger (SD-21) and never fails the stop.
- Promise, effect and observable logic clear `input` when the actor ends, as upstream; callback
  logic keeps it.
- State that a creator keeps per actor (listeners, outboxes) lives in a `WeakMap` keyed by the
  actor itself, never by session id, because two systems can give the same session id.
- The order of the generic parameters follows upstream (SD-12).
- `fromAgent` detects a move only by the state exit it observes: its delivery to the invoking
  machine waits for the macrostep, from a fiber whose `ProcessingActors` marker is cleared
  (`src/internal/processingActors.ts`), and a move stops the agent before the delivery returns.
  Its loop writes the attempt count ahead of each turn through its own actor.
