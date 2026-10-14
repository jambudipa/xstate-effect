---
title: About state machines and statecharts
doc-type: explanation
sources: [packages/core/src/StateMachine.ts, packages/core/src/stateUtils.ts]
---

# About state machines and statecharts

> **TL;DR:** A state machine names every mode a system can be in and the events that move it
> from one mode to the next; a statechart adds nesting, parallel regions and history so that
> real behaviour stays readable. This package runs XState 5.33.2's statechart algorithm, the
> SCXML one, so a machine behaves here as it does in XState. What changes is the surface:
> computing a transition is an Effect, and a machine definition never throws.

## The question

Most application code keeps its state in loose variables: an `isLoading` flag, an `error` that
might be set, a `data` field that might be stale. Each new flag doubles the number of
combinations, and nothing in the code says which combinations are allowed. A state machine
answers a different question: *what can the system be doing right now, and what may happen
next?* This page explains that model, the statechart extensions to it, and how this package
executes a machine when an event arrives.

## Finite state and context

A machine separates two kinds of state.

- **The finite state** is the mode the system is in: `idle`, `uploading`, `done`. There is a
  fixed set of them, they are declared up front, and the machine is in exactly one of them at a
  time (or, with parallel regions, in exactly one per region). The mode decides which events
  mean anything: an event that the current state does not handle is ignored.
- **The context**, sometimes called extended state, is the data the machine works on: a retry
  count, the text of a form, the last response. It can take any value, and actions update it.

The useful rule of thumb is that a value belongs in the finite state when it changes what the
system *does*, and in the context when it is only something the system *knows*. A `mode` field
in context that takes `"editing" | "saving" | "saved"` works, but it gives up the main benefit:
the machine can no longer tell you that a `SAVE` event in the `saving` mode is meaningless.

```ts
import { assign, setup } from "@jambudipa/xstate-effect"

export const uploadMachine = setup({
  types: {} as {
    context: { readonly attempts: number }
    events: { readonly type: "START" } | { readonly type: "FAIL" } | { readonly type: "SUCCEED" }
  }
}).createMachine({
  // The data: how many times the upload has started
  context: { attempts: 0 },
  // The modes: what the upload is doing now
  initial: "idle",
  states: {
    idle: { on: { START: "uploading" } },
    uploading: {
      entry: assign({ attempts: ({ context }) => context.attempts + 1 }),
      on: { SUCCEED: "done", FAIL: "idle" }
    },
    done: { type: "final" }
  }
})
```

Because the modes and the transitions between them are data, the machine can be drawn,
traversed and tested without running it. The graph functions of the `/graph` entry point walk
exactly this structure to generate test paths.

## What a statechart adds

A flat machine grows quickly: every state that must react to `LOGOUT` needs its own `LOGOUT`
transition, and two independent concerns (a video that plays or pauses, a sound that is muted or
not) multiply into four states. Statecharts, as David Harel described them and as SCXML
standardised them, keep the model small with a few additions:

- **Hierarchy.** A state can hold child states. A transition on the parent applies in every
  child, and leaving the parent leaves whichever child was active.
- **Parallel regions.** A `type: "parallel"` state is in one child of *each* of its regions at
  once, so independent concerns stay independent.
- **History.** A history state remembers which child was active when its parent was last left,
  so re-entering the parent can resume where it stopped.
- **Final states and completion.** Reaching a final child completes its parent, which raises a
  done event that the machine can react to; reaching a top-level final state completes the
  machine, and its output becomes the actor's output.
- **Eventless and delayed transitions.** An `always` transition is taken as soon as its guard
  holds; an `after` transition is taken when its delay has passed in the state.

The machine below combines hierarchy and parallel regions. `STOP` is declared once, on the
parent, and leaves both regions; `MUTE` changes one region and leaves the other alone. The state
value, the readable form of the active states, shows one entry per region.

```ts
import { Effect } from "effect"
import { createMachine, getInitialSnapshot, getNextSnapshot } from "@jambudipa/xstate-effect"

const player = createMachine({
  initial: "stopped",
  states: {
    stopped: { on: { PLAY: "playing" } },
    playing: {
      type: "parallel",
      on: { STOP: "stopped" },
      states: {
        video: {
          initial: "running",
          states: { running: { on: { PAUSE: "paused" } }, paused: { on: { RESUME: "running" } } }
        },
        audio: {
          initial: "unmuted",
          states: { unmuted: { on: { MUTE: "muted" } }, muted: { on: { UNMUTE: "unmuted" } } }
        }
      }
    }
  }
})

const program = Effect.gen(function* () {
  const stopped = yield* getInitialSnapshot(player)
  const playing = yield* getNextSnapshot(player, stopped, { type: "PLAY" })
  console.log(playing.value) // { playing: { video: "running", audio: "unmuted" } }

  const muted = yield* getNextSnapshot(player, playing, { type: "MUTE" })
  console.log(muted.value) // { playing: { video: "running", audio: "muted" } }

  const stoppedAgain = yield* getNextSnapshot(player, muted, { type: "STOP" })
  console.log(stoppedAgain.value) // "stopped"
})

void Effect.runPromise(program)
```

## How a machine takes an event

Once states nest and run in parallel, "the current state" is no longer one name. The engine
works with a **configuration**: the set of every active state node, from the root down to each
active leaf. The state value is only a view of it. Taking an event means turning one
configuration into the next, and the order in which that happens is observable, because entry
and exit actions run along the way.

The package ports XState's own algorithm for this, which is the SCXML one:

1. **Selection.** For each active leaf, the engine looks for a transition for the event, from
   the leaf outwards to its ancestors, and takes the first candidate whose guard holds. When
   two selected transitions conflict (both would exit the same state), the one from the more
   deeply nested source wins; between equals, the earlier one wins.
2. **The microstep.** For the transitions that remain, the engine computes each one's domain,
   the smallest compound state that contains both source and targets. It records history, exits
   the states inside the domain in reverse document order (children before parents), runs the
   transitions' actions, then enters the target states, their initial children and any
   ancestors they need, in document order (parents before children).
3. **The macrostep.** One external event can set more work in motion: an `always` transition
   may now be enabled, an action may `raise` an event, a final state may complete its parent.
   The engine keeps taking microsteps, eventless transitions first and then the events raised
   into its internal queue, until nothing is left. Only then does the actor publish a new
   snapshot. Observers therefore see one snapshot per external event, never a half-finished
   step.

A cycle of eventless transitions or raised events would loop for ever. The `maxIterations`
option of a machine's config bounds a macrostep; it has no limit unless you set one, and past
it the macrostep fails with XState's "Infinite loop detected" message.

**Why port the algorithm instead of writing a simpler one.** An engine that tracks a single
active leaf is much easier to write, and it handles flat and nested machines. It cannot express
parallel regions or history, and its exit and entry order differs from XState's in exactly the
cases where the order matters. A behaviour-compatible port needs the full configuration model,
and XState's algorithm already has a large test suite behind it: XState's own test files,
rewritten in Effect form, and the W3C SCXML test cases both run against this engine. The cost
is that the engine is more complex than the machines most people write, which is why the
[reference for state nodes](../reference/state-nodes.md) exists for the rare moment you need
to look inside it.

## Why computing a transition is an Effect

In XState, `getNextSnapshot(machine, snapshot, event)` returns the next snapshot directly. Here
it returns an Effect, and so do `machine.transition`, `getInitialSnapshot`, `snapshot.can` and
the graph traversals. The reason is that a guard may return an `Effect<boolean>` and an action
may return an Effect, so working out the next snapshot can mean running Effect code. One
signature for every machine was preferred to a synchronous variant that would fail on the
machines that use Effect guards.

The trade-off is a `yield*` even for a machine that never touches Effect in its guards. What
stays is the property that makes machines worth testing: given the same snapshot and the same
event, a machine whose guards are deterministic computes the same next snapshot, and
`getNextSnapshot` starts no actor and runs no action (an `assign` still updates the context). That is what lets you
[test a machine without running an actor](../how-to/test-machines-without-actors.md).

## Why a definition never throws

XState's `createMachine` throws when a config is wrong: a compound state without `initial`, a
target that names no state. This package never throws synchronously. `createMachine` keeps the
first definition error it finds, in XState's order and with XState's message, and every Effect
that computes a snapshot of that machine fails with it. Creating an actor from such a machine
gives an actor whose snapshot has status `error`.

The benefit is a single error model: problems arrive through Effect's error channel or the
actor's status, never as an exception from a module's top level. The cost is that a broken
config no longer fails at import time; it fails the first time something computes a snapshot,
so a test that does at least that is worth having for every machine.

## `createMachine` and `setup`

Both build the same kind of machine, and both are exported because XState exports both.
`setup(...).createMachine` is the typed path: it names the machine's actions, guards, actors
and delays, checks the config against those names, and gives the machine's actor the Effect
services its actions and actors need. `createMachine` on its own accepts the same configs with
looser checking and no service requirements. The second difference matters more than it first
appears; [How services reach actions and actors](services-and-requirements.md) explains why.

## What this means for you

- Model modes as states and data as context; reach for a nested or parallel state before you
  reach for a flag in context.
- Expect XState's semantics, including its exit and entry order, its handling of `always`
  transitions and raised events, and one snapshot per external event.
- Read every snapshot computation with `yield*`, and handle the failure of a machine with a
  definition error, in tests and in code that builds machines dynamically.
- Prefer `setup` for machines whose actions or actors use Effect services.

## Related

- [Build your first state machine](../tutorials/01-first-state-machine.md) — a guided first
  machine.
- [How to model parallel and history states](../how-to/model-parallel-and-history-states.md)
- [How to use delayed transitions and delayed events](../how-to/use-delayed-transitions.md)
- [createMachine and the machine](../reference/create-machine.md) and
  [setup and setupWithSchema](../reference/setup.md)
- [About the actor model](actor-model.md) — how a machine runs once it becomes an actor.
- [How an actor processes events](event-processing.md) — the macrostep inside a running actor.
