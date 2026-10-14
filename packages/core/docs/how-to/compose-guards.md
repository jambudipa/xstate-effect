---
title: How to combine guards
doc-type: how-to
sources: [packages/core/src/guards/]
---

# How to combine guards

> **TL;DR:** Write small named guards in `setup({ guards })`, then combine them with `and`,
> `or` and `not`, which take guards in every form a transition takes: a name,
> `{ type, params }`, an inline function, or another combinator. Name a combination in the same
> `guards` record to reuse it. Use `stateIn` and `stateNotIn` to make a guard depend on the
> current state.

## When you need this

- A transition depends on several conditions, and you want each condition named and testable
  on its own instead of one large inline function.
- The same condition appears in several transitions.
- A transition in one part of a statechart depends on the state of another part.

## Prerequisites

- You know how to put a `guard` on a transition. If not, follow
  [Guard your transitions](../tutorials/03-guards-and-transitions.md).
- Import the combinators from `@jambudipa/xstate-effect` or from
  `@jambudipa/xstate-effect/guards`; both export `and`, `or`, `not`, `stateIn` and
  `stateNotIn`.

## Combine named guards in a transition

1. Declare each condition once in `setup({ guards })`. A guard that needs a value per use takes
   it as its second argument, `params`.
2. Combine them in the transition's `guard` with `and`, `or` and `not`. Refer to a guard by its
   name, or by `{ type, params }` when it takes params.

```ts
import { and, not, or, setup } from "@jambudipa/xstate-effect"

type Role = "viewer" | "editor" | "admin"

export const documentMachine = setup({
  types: {} as {
    context: { role: Role; locked: boolean }
    events: { type: "EDIT" } | { type: "DONE" }
  },
  guards: {
    isAdmin: ({ context }) => context.role === "admin",
    isLocked: ({ context }) => context.locked,
    hasRole: ({ context }, params: { role: Role }) => context.role === params.role
  }
}).createMachine({
  context: { role: "editor", locked: false },
  initial: "viewing",
  states: {
    viewing: {
      on: {
        EDIT: {
          // An admin may always edit; an editor only while the document is unlocked
          guard: or(["isAdmin", and([{ type: "hasRole", params: { role: "editor" } }, not("isLocked")])]),
          target: "editing"
        }
      }
    },
    editing: {
      on: { DONE: "viewing" }
    }
  }
})
```

With `setup`, the type checker accepts only the names in `guards`, and requires `params` of the
right type for a guard that declares them.

`and` evaluates its guards in order and stops at the first that fails; `or` stops at the first
that passes. Put a cheap or likely-deciding guard first.

## Name a combination to reuse it

Write the combination as an entry of the same `guards` record. Inside `setup`, a combinator may
name only the guards of that record.

```ts
import { and, not, setup } from "@jambudipa/xstate-effect"

export const publishingMachine = setup({
  types: {} as {
    context: { approved: boolean; locked: boolean }
    events: { type: "EDIT" } | { type: "PUBLISH" }
  },
  guards: {
    isApproved: ({ context }) => context.approved,
    isLocked: ({ context }) => context.locked,
    canChange: not("isLocked"),
    canPublish: and(["isApproved", "canChange"])
  }
}).createMachine({
  context: { approved: false, locked: false },
  initial: "draft",
  states: {
    draft: {
      on: {
        EDIT: { guard: "canChange", target: "editing" },
        PUBLISH: { guard: "canPublish", target: "published" }
      }
    },
    editing: {},
    published: {}
  }
})
```

A combination resolves the names it holds against the machine's guards each time it runs. So
`publishingMachine.provide({ guards: { isLocked: () => true } })` changes `canChange` and
`canPublish` too.

## Depend on the current state

Use `stateIn(stateValue)` for "the machine is in this state" and `stateNotIn(stateValue)` for
the opposite. The value starts at the machine root: a state key, a dotted path, an object for
nested and parallel states, or a state node `#id`. This is how one region of a parallel state
checks another.

```ts
import { and, setup, stateIn, stateNotIn } from "@jambudipa/xstate-effect"

export const uploadMachine = setup({
  types: {} as {
    context: { fileCount: number }
    events: { type: "SUBMIT" } | { type: "SAVE" } | { type: "SAVED" }
  },
  guards: {
    hasFiles: ({ context }) => context.fileCount > 0
  }
}).createMachine({
  context: { fileCount: 1 },
  type: "parallel",
  states: {
    form: {
      initial: "editing",
      states: {
        editing: {
          on: {
            SUBMIT: {
              // Submit only when files exist and the sync region is not busy
              guard: and(["hasFiles", stateNotIn({ sync: "saving" })]),
              target: "submitted"
            }
          }
        },
        submitted: {}
      }
    },
    sync: {
      initial: "idle",
      states: {
        idle: { on: { SAVE: { guard: stateIn({ form: "editing" }), target: "saving" } } },
        saving: { on: { SAVED: "idle" } }
      }
    }
  }
})
```

## Variations

- **Params from the context.** `params` may be a function of `{ context, event }`, called each
  time the guard runs:
  `{ type: "hasMinWords", params: ({ context }) => ({ min: context.minWords }) }`.
- **Inline functions inside a combinator.** `and`, `or` and `not` also take inline functions,
  such as `not(({ context }) => context.items.length === 0)`.
- **A guard that runs an Effect.** See the next section.
- **Check a guard inside an action.** In `enqueueActions`, `check(guard)` evaluates any guard
  form, combinators included, and returns a boolean. See
  [How to choose actions at run time with enqueueActions](batch-actions-with-enqueue.md).
- **Ask whether an event would pass.** `snapshot.can(event)` evaluates the guards for that
  event and returns an `Effect<boolean>`.

## Decide with an Effect

A guard function may return an `Effect<boolean>` instead of a boolean, and the combinators
accept such a guard like any other. The Effect must not fail and must need no services of your
own; the default services, such as `Clock`, are available. Here the guard reads the time from
the Effect clock, so a test can move it with `TestClock`:

```ts
import { Clock, Effect } from "effect"
import { and, setup } from "@jambudipa/xstate-effect"

export const trialMachine = setup({
  types: {} as {
    context: { trialEndsAt: number; verified: boolean }
    events: { type: "OPEN" }
  },
  guards: {
    isVerified: ({ context }) => context.verified,
    inTrial: ({ context }) => Effect.map(Clock.currentTimeMillis, (now) => now < context.trialEndsAt)
  }
}).createMachine({
  context: { trialEndsAt: 0, verified: false },
  initial: "closed",
  states: {
    closed: { on: { OPEN: { guard: and(["isVerified", "inTrial"]), target: "open" } } },
    open: {}
  }
})
```

## If a guard fails

A name with no implementation fails the evaluation with a `GuardError`
(`Guard '<name>' is not implemented.'.`), and the running actor gets status `error`. A guard
function that throws, or whose Effect dies, also puts the actor in status `error`. With
`setup`, the type checker catches an unknown name before the code runs. See
[How to handle actor errors](handle-actor-errors.md).

## Related

- [Guards](../reference/guards.md) — every guard creator and the guard forms.
- [setup and setupWithSchema](../reference/setup.md) — the `guards` record and its type checks.
- [Errors](../reference/errors.md) — `GuardError`.
