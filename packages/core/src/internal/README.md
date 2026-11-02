# src/internal

Private helpers that several modules share. No entry point exports them, except the
`AnyEventObject` type, the agent brand (`agentBrand.ts`) and the settlement and menu error
types (`settlement.ts`, `agentMenu.ts`), which the root re-exports. Most of them reproduce one upstream detail
(a constant, a message text, a warning, a delay rule) that more than one port module must
reproduce the same way.

## What belongs here

Small, single-purpose helpers that do not depend on the engine or on the actor runtime. Code
that a user imports, or that needs `Actor`, `StateMachine` or the actor system at run time,
does not belong here.

## Where to start

- `outbox.ts`: how a plain user callback (`emit`, `sendBack`, an observer) delivers into a
  running actor, in the actor's scope.
- `reportError.ts`: how an error that nothing handles is reported through the logger (SD-21).
- `anyEventObject.ts`: every `any` in `src`.
- `stopTarget.ts`: the target a `stopChild` definition was written with, kept on the
  definition under a registered symbol for the structural settlement proof, so it survives a
  duplicate install.
- `contextReads.ts`: the recording Proxy the explorer hands to a machine as its context, and the
  merge `assign` uses, which counts as no read and keeps a recording context one.
- `logicCapability.ts`: the capability the actor runtime passes to agent logic's own methods,
  and to no other logic. `AgentActorLogic` requires it, so a direct call does not compile, and
  agent logic refuses a call without it at run time (NEG-4). It stays private to one copy of
  the library, on purpose: anything two copies could share, user code could reach too. It has no
  upstream source: agent settlement is a port addition.
- `agentBrand.ts`: the agent brand. `IsAgentLogic` tells agent logic apart by type (a union
  is read whole, TS-115); `NotAgentLogic` is the refusal shape for every slot that cannot
  declare a settlement; `markAgentLogic` and `hasAgentBrand` set and read the run-time marker
  that a cast cannot hide (NEG-8). `OrdinaryLogic`, `NotAgentActor` and `AgentChildId` are the
  refusals the spawn and stop entry points use: logic, declared actor names and child ids that
  are not agent logic (NEG-3, NEG-9). `HoldsAgents` and `CertifiedChild` are the marks of a machine that
  holds agents, the first with a run-time mark as well (`markHoldsAgents`, for the progress delay check), the second type-only; `InvocableActor`, `SpawnableActor`, `PlainActor` and `InlineLogic` are the slots that read them (S17). It has no upstream source: agent settlement is a port
  addition.
- `processingActors.ts`: `ProcessingActors`, the fiber-local marker that makes a send from
  inside an actor's processing queue without waiting (SD-23). `Actor.ts` sets it; `fromAgent`
  clears it for the fiber that delivers a transition and waits for the machine's macrostep.
- `settlement.ts`: `SettlementCheck`, the type walk over a setup machine's config that refuses
  an agent invocation's `onDone` that may stay in its state (`SettlementMustExit`, S15) and an
  `on` key that takes an agent's done event (`AgentDoneOutsideOnDone`): the exact key anywhere, or
  a wildcard below the invoking state or in a conflict from a parallel region beside it. The root re-exports
  both error types. Its target resolution (`ResolveTarget`, `IdPaths`, `Join`, `RootId`) and
  `AgentSrc` are exported for `../settlement.ts`, which checks every target against the
  config's states. Type-only; no upstream source.
- `agentMenu.ts`: `MenuCheck`, the type walk that refuses an agent invocation whose agent has a
  tool the invoking state does not accept (`AgentToolNotAccepted`) or whose state accepts no
  event (`AgentStateAcceptsNoEvents`, S21). `AgentMenu` is the menu rule: the state's own
  events, an ancestor's event only when its nearest handler has a target, and a sibling
  region's events, without wildcards, `xstate.` events or `X: undefined`. Type-only; no
  upstream source.
- `provideCheck.ts`: what `machine.provide` refuses by type (NEG-7, NEG-10).
  `ProvidedActorsCheck` refuses agent logic for an actor whose declared logic is not agent
  logic; `ProgressDelayNames` walks a config for its progress delays (a named `after` key whose
  transition leaves its state), which a setup with agent actors marks on its `provide`
  (`ProgressDelayMarker`), and `ProvidedDelayCheck` then takes only a positive integer literal
  for each. `StateMachine.ts` holds the run-time half. Type-only; no upstream source.

## Constraints

- Files here import at run time only from `effect` and from each other; their imports from the
  rest of `src` are type-only. Every module can then import them without an import cycle.
- `anyEventObject.ts` is the only file in `src` with a scoped lint exception
  (`@typescript-eslint/no-explicit-any`, SD-22). Do not add `any` in another file; a new `any`
  needs an SD-22 amendment and goes in that file.
- State that a helper keeps is per object (a `WeakMap` keyed by the object) or per fiber (a
  `Context.Reference`), so it never leaks from one actor to another.
- Each helper names the upstream source it reproduces (a file at xstate@5.33.2). Keep that
  reference current when you change the helper. `agentBrand.ts` says instead that it has none.
- Three facts are exceptions to per-object state in a `WeakMap`. The agent brand marker is an
  own, non-enumerable property on the logic and on its `transition` function, so a spread copy
  of the logic still carries it. An action's stop target and delay are own, non-enumerable
  properties under registered symbols, so a second copy of the library reads them.
