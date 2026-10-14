---
title: How to model parallel and history states
doc-type: how-to
sources: [packages/core/src/StateNode.ts, packages/core/src/stateUtils.ts]
---

# How to model parallel and history states

> **TL;DR:** Set `type: "parallel"` on a state to run its children as independent regions that
> are all active at once; its `onDone` runs when every region reaches a final state. Add a child
> with `type: "history"` to a state, and target that child, to return to the state the parent
> was in when it last exited. Use `history: "deep"` to restore nested states as well.

## When you need this

- One part of your system has several aspects that change independently: playback and volume,
  bold and italic, the shipping and payment sections of a form.
- A state can be interrupted (a help screen, a suspension, an error dialog), and on return the
  machine must resume where it was instead of at the initial state.

## Prerequisites

- A machine with nested (compound) states. For the concepts, read
  [About state machines and statecharts](../explanation/state-machines.md).

## Run independent regions at the same time

1. Set `type: "parallel"` on the state. Each child becomes a region; give each region its own
   `initial` state and children.
2. Send events as usual. Every region that handles an event takes its transition, so one event
   can change several regions in the same step.
3. Read the state. The value of a parallel state is an object with one key per region.

```ts
import { Effect } from "effect"
import { createActor, createMachine } from "@jambudipa/xstate-effect"

const playerMachine = createMachine({
  id: "player",
  type: "parallel",
  states: {
    playback: {
      initial: "paused",
      states: {
        paused: { on: { PLAY: "playing" } },
        playing: { on: { PAUSE: "paused", STOP: "paused" } }
      }
    },
    volume: {
      initial: "unmuted",
      states: {
        unmuted: { on: { MUTE: "muted" } },
        muted: { on: { UNMUTE: "unmuted", STOP: "unmuted" } }
      }
    }
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(playerMachine)
  yield* actor.start
  yield* actor.send({ type: "PLAY" })
  yield* actor.send({ type: "MUTE" })

  const snapshot = yield* actor.getSnapshot
  console.log(snapshot.value) // { playback: "playing", volume: "muted" }
  console.log(snapshot.matches({ playback: "playing" })) // true
  console.log(snapshot.matches("volume.muted")) // true

  // Both regions handle STOP
  yield* actor.send({ type: "STOP" })
  console.log((yield* actor.getSnapshot).value) // { playback: "paused", volume: "unmuted" }
})

void Effect.runPromise(Effect.scoped(program))
```

`snapshot.matches` accepts part of the value: an object that names only some regions, or a
dotted path into one region.

## Continue when every region has finished

1. Mark the last state of each region `type: "final"`.
2. Give the parallel state an `onDone` transition. The machine takes it once every region is in
   a final state.
3. To make one region wait for another, guard its transition with `stateIn`. The state value
   you give `stateIn` starts at the machine root, so it can name a state in any region.

```ts
import { createMachine, stateIn } from "@jambudipa/xstate-effect"

export const checkoutMachine = createMachine({
  id: "checkout",
  initial: "details",
  states: {
    details: {
      type: "parallel",
      states: {
        shipping: {
          initial: "editing",
          states: {
            editing: { on: { SHIPPING_DONE: "complete" } },
            complete: { type: "final" }
          }
        },
        payment: {
          initial: "editing",
          states: {
            editing: {
              on: {
                PAYMENT_DONE: {
                  // Take payment only once the shipping region is complete
                  guard: stateIn({ details: { shipping: "complete" } }),
                  target: "complete"
                }
              }
            },
            complete: { type: "final" }
          }
        }
      },
      // Taken when both regions are in `complete`
      onDone: "review"
    },
    review: {}
  }
})
```

The done event of a parallel state carries no output: its `output` is `Option.none()`.

## Enter chosen states in several regions at once

Give the transition a list of targets, one for each region you want to set. A region that no
target names starts in its `initial` state.

```ts
import { createMachine } from "@jambudipa/xstate-effect"

export const appMachine = createMachine({
  id: "app",
  initial: "off",
  states: {
    off: {
      on: {
        START: "on",
        QUICK_START: { target: ["on.playback.playing", "on.volume.muted"] }
      }
    },
    on: {
      type: "parallel",
      states: {
        playback: { initial: "paused", states: { paused: {}, playing: {} } },
        volume: { initial: "unmuted", states: { unmuted: {}, muted: {} } }
      }
    }
  }
})
```

## Return to the last active state

1. Add a child with `type: "history"` to the state whose position you want to remember. Give
   it any key; `resume` is used here.
2. Target the history state from outside its parent. The machine enters the child of the parent
   that was active when the parent last exited.

```ts
import { Effect } from "effect"
import { createActor, createMachine } from "@jambudipa/xstate-effect"

const formMachine = createMachine({
  id: "form",
  initial: "editing",
  states: {
    editing: {
      initial: "account",
      states: {
        account: { on: { NEXT: "profile" } },
        profile: { on: { NEXT: "confirm" } },
        confirm: {},
        // Remembers which child of `editing` was active when `editing` exited
        resume: { type: "history" }
      },
      on: { HELP: "help" }
    },
    help: {
      on: { BACK: "editing.resume" }
    }
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(formMachine)
  yield* actor.start
  yield* actor.send({ type: "NEXT" })
  yield* actor.send({ type: "HELP" })
  yield* actor.send({ type: "BACK" })
  console.log((yield* actor.getSnapshot).value) // { editing: "profile" }
})

void Effect.runPromise(Effect.scoped(program))
```

A history state is never active itself, so it never appears in `snapshot.value`.

## Restore nested states too (deep history)

A history state is shallow by default: it restores the direct child of its parent, and that
child then starts in its own `initial` state. Set `history: "deep"` to restore the innermost
active states instead.

| `history` | What the history state records when its parent exits | What it restores |
|---|---|---|
| `"shallow"` (the default; also `true`) | The active direct children of the parent | Those children, each entering its own initial state |
| `"deep"` | The active innermost (atomic) states below the parent | Those exact states, in every region |

Deep history is what you usually want for a parallel state: with shallow history the regions
come back, but each one restarts in its initial state.

```ts
import { createMachine } from "@jambudipa/xstate-effect"

export const editorMachine = createMachine({
  id: "editor",
  initial: "on",
  states: {
    on: {
      type: "parallel",
      states: {
        bold: {
          initial: "off",
          states: {
            off: { on: { TOGGLE_BOLD: "on" } },
            on: { on: { TOGGLE_BOLD: "off" } }
          }
        },
        italic: {
          initial: "off",
          states: {
            off: { on: { TOGGLE_ITALIC: "on" } },
            on: { on: { TOGGLE_ITALIC: "off" } }
          }
        },
        // Restores the active state of every region
        previous: { type: "history", history: "deep" }
      },
      on: { SUSPEND: "suspended" }
    },
    suspended: {
      on: { RESUME: "on.previous" }
    }
  }
})
```

After `TOGGLE_BOLD`, `SUSPEND` and `RESUME`, the value is `{ on: { bold: "on", italic: "off" } }`.
With `history: "shallow"` it would be `{ on: { bold: "off", italic: "off" } }`.

## Choose where to go before any history exists

The first time the machine enters a history state, its parent has not exited yet, so there is
nothing to restore. The history state then enters:

- its `target`, when you give one (a key path below the parent, or a `#id`);
- otherwise the parent's `initial` state, or every region of a parallel parent.

```ts
import { createMachine } from "@jambudipa/xstate-effect"

export const onboardingMachine = createMachine({
  id: "onboarding",
  initial: "welcome",
  states: {
    welcome: {
      on: { CONTINUE: "steps.last" }
    },
    steps: {
      initial: "account",
      states: {
        account: { on: { NEXT: "profile" } },
        profile: {},
        // With no record yet, `steps.last` enters `profile`, not `account`
        last: { type: "history", target: "profile" }
      }
    }
  }
})
```

## Variations

- **Shorter history config.** A state with a `history` value and no `type` is a history state
  too: `{ history: "deep" }` is the same as `{ type: "history", history: "deep" }`.
- **History across a restart.** The persisted snapshot holds the recorded history, so an actor
  restored from it resumes in the same place. See
  [How to persist and restore an actor](persist-and-restore-an-actor.md).
- **Guards across regions.** `stateIn` and `stateNotIn` also accept a `#id` of a state node. See
  [How to combine guards](compose-guards.md).

## Related

- [State nodes](../reference/state-nodes.md) — the node types and the `history` and `target`
  members.
- [State values](../reference/state-value.md) — the shape of `snapshot.value` and how
  `matches` reads it.
- [createMachine and the machine](../reference/create-machine.md) — the state config.
- [About state machines and statecharts](../explanation/state-machines.md) — why statecharts
  have regions and history.
