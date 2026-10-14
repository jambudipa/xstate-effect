---
title: How to generate tests from a machine
doc-type: how-to
sources: [packages/core/src/graph/]
---

# How to generate tests from a machine

> **TL;DR:** Build a test model with `createTestModel(machine, options)` from
> `@jambudipa/xstate-effect/graph`, generate its paths with `model.getShortestPaths()`, and run
> each one with `path.test({ events, states })`. The event executors drive your real system
> through each step; the state tests check that the system matches the state the machine
> reached. Each of these calls returns an Effect, and a failing state test fails the path with
> the path appended to its message.

## When you need this

You have a system to test — a UI component, a service, a device driver — and a state machine
that describes how it should behave. Instead of writing each test case by hand, you let the
machine list the paths to its states and run every path against the real system. When the
machine gains a state, the tests cover it on the next run.

The machine here is a model, not the code under test. To test a machine's own logic, see
[How to test a machine without running an actor](test-machines-without-actors.md).

## Before you start

- The machine must have no `invoke`, no `after` transition and no delayed `raise` or `sendTo`
  written inline. `createTestModel` fails with `UnsupportedTestMachineError` for such a
  machine; see [Machines with delays or invocations](#machines-with-delays-or-invocations).
- Every event that carries data needs example values (step 2), because the model cannot invent
  them.

## Steps

1. Model the behaviour you expect as a machine.
2. Create the model: `yield* createTestModel(machine, { events })`. For each event type that
   carries data, list one event per case you want covered. The model sends `{ type }` for every
   other event a state takes.
3. Generate the paths: `yield* model.getShortestPaths()` gives the shortest path to each state.
4. For each path, create a fresh instance of the system under test and run
   `path.test({ events, states })`:
   - `events` maps each event type to an executor that drives the system through that event.
   - `states` maps a state key to a test of the system. A key is a state value such as
     `"form.invalid"`, a state node id such as `"#feedback.form"`, or `"*"` for every state
     that no other key matches.

An executor or a state test may return nothing or an Effect. A test fails the path when it
throws or when its Effect fails.

```ts
import { Effect } from "effect"
import { createMachine } from "@jambudipa/xstate-effect"
import { createTestModel } from "@jambudipa/xstate-effect/graph"

type FeedbackEvent =
  | { type: "GOOD" }
  | { type: "BAD" }
  | { type: "SUBMIT"; comment: string }
  | { type: "CLOSE" }

// The model: how the feedback widget should behave
const feedbackMachine = createMachine({
  id: "feedback",
  types: {} as { events: FeedbackEvent },
  initial: "question",
  states: {
    question: { on: { GOOD: "thanks", BAD: "form", CLOSE: "closed" } },
    form: {
      initial: "editing",
      states: { editing: {}, invalid: {} },
      on: {
        SUBMIT: [{ guard: ({ event }) => event.comment.length > 0, target: "thanks" }, { target: ".invalid" }],
        CLOSE: "closed"
      }
    },
    thanks: { on: { CLOSE: "closed" } },
    closed: { type: "final" }
  }
})

// The system under test: the widget, driven through its public methods
type Screen = "question" | "form" | "form-error" | "thanks" | "closed"

class FeedbackWidget {
  screen: Screen = "question"
  clickGood(): void {
    if (this.screen === "question") this.screen = "thanks"
  }
  clickBad(): void {
    if (this.screen === "question") this.screen = "form"
  }
  submit(comment: string): void {
    if (this.screen === "form" || this.screen === "form-error") {
      this.screen = comment.length > 0 ? "thanks" : "form-error"
    }
  }
  close(): void {
    this.screen = "closed"
  }
}

const expectScreen = (widget: FeedbackWidget, screen: Screen) =>
  widget.screen === screen
    ? Effect.void
    : Effect.fail(new Error(`Expected the ${screen} screen, saw ${widget.screen}`))

export const feedbackModelTest = Effect.gen(function* () {
  const model = yield* createTestModel(feedbackMachine, {
    // SUBMIT carries data: one example for each branch of its guard
    events: [
      { type: "SUBMIT", comment: "Too slow" },
      { type: "SUBMIT", comment: "" }
    ]
  })
  const paths = yield* model.getShortestPaths()

  yield* Effect.forEach(
    paths,
    (path) => {
      const widget = new FeedbackWidget()
      return path.test({
        events: {
          GOOD: () => widget.clickGood(),
          BAD: () => widget.clickBad(),
          SUBMIT: ({ event }) =>
            widget.submit("comment" in event && typeof event.comment === "string" ? event.comment : ""),
          CLOSE: () => widget.close()
        },
        states: {
          question: () => expectScreen(widget, "question"),
          "form.editing": () => expectScreen(widget, "form"),
          "form.invalid": () => expectScreen(widget, "form-error"),
          thanks: () => expectScreen(widget, "thanks"),
          closed: () => expectScreen(widget, "closed")
        }
      })
    },
    { discard: true }
  )
})
```

A path test runs its steps in order. The first step is the initial state, reached by the
`xstate.init` event, which has no executor; then, for each step, the executor of the step's
event runs first and the state tests of the state it reached run after it.

The executor receives the step: `{ event, state }`. Its `event` is typed with its `type` only,
so narrow it (as the `SUBMIT` executor does with `"comment" in event`) before you read its
other fields.

To run the test, pass `feedbackModelTest` to `it.effect` of `@effect/vitest`, or run it with
`Effect.runPromise(feedbackModelTest)`.

## Read a failure

A failing state test or executor fails the path test with its own error. When that error is
an `Error`, the path test appends the steps it ran and the target state to its message. For a
widget whose `clickGood` does nothing, the path `xstate.init → GOOD` fails with this message:

```text
Expected the thanks screen, saw question
Path:
	State: {"value":"question"}
	Event: {"type":"xstate.init"}

	State: {"value":"thanks"} via {"type":"xstate.init"}
	Event: {"type":"GOOD"}

	State: {"value":"thanks"} via {"type":"GOOD"}
```

## Variations

### One runner test per path

To see each path as its own test, compute the paths when the test file loads and register a
test for each one, named by `path.description` (for example
`Reaches state "thanks": xstate.init → GOOD`). With `@effect/vitest`:
`const paths = await Effect.runPromise(Effect.flatMap(createTestModel(machine, options), (model) => model.getShortestPaths()))`,
then `for (const path of paths) it.effect(path.description, () => path.test(makeParams()))`,
where your `makeParams()` creates a fresh system and returns its executors and state tests.

### Choose which paths to run

- `model.getShortestPaths()` gives the shortest path to each state. `model.getSimplePaths()`
  gives every path that visits no state twice: more tests, more coverage.
- `toState: (state) => …` keeps only the paths that end in a matching state, for example
  `model.getShortestPaths({ toState: (state) => state.matches("thanks") })`.
- By default the model drops a path whose events begin a longer path. Pass
  `allowDuplicatePaths: true` to keep them.
- `model.getPathsFromEvents(events)` gives the one path that a fixed event sequence takes, for
  a scenario you want tested by name. An event that the state ignores leaves the path in that
  state. The Effect fails with `InvalidEventSequenceError` when the traversal has no step for
  an event from the state it meets, for example an event that `filterEvents` leaves out.
- `model.getShortestPathsFrom(paths)` and `model.getSimplePathsFrom(paths)` continue each given
  path with the paths from its end state.

### Limit a large state space

The model keys each state by its value, its context and the transition that reached it, so a
context that keeps changing (a counter, a list) gives an endless state space. Stop the traversal with `stopWhen`, or cap it
with `limit`, which fails the Effect with `TraversalLimitError` when the traversal needs more
steps.

```ts
import { Effect } from "effect"
import { assign, createMachine } from "@jambudipa/xstate-effect"
import { createTestModel } from "@jambudipa/xstate-effect/graph"

const counterMachine = createMachine({
  types: {} as { context: { count: number }; events: { type: "INC" } },
  context: { count: 0 },
  initial: "counting",
  states: {
    counting: { on: { INC: { actions: assign({ count: ({ context }) => context.count + 1 }) } } }
  }
})

export const limitTest = Effect.gen(function* () {
  const model = yield* createTestModel(counterMachine)

  const paths = yield* model.getShortestPaths({ stopWhen: (state) => state.context.count >= 3 })
  console.log(paths.map((path) => path.description))
  // ['Reaches state "counting"({"count":3}): xstate.init → INC → INC → INC']

  const error = yield* Effect.flip(model.getShortestPaths({ limit: 100 }))
  console.log(error.message) // Traversal limit exceeded
})
```

`serializeState` and `serializeEvent` change how the model keys states and events; two states
with the same key count as one. `serializeTransition: () => ""` drops the transition from the
key, so the model keys states by value and context alone and gives fewer paths.

### Send only the events a state accepts

`filterEvents: (state, event) => …` decides whether the traversal sends an event in a state.
It may return an Effect, so `state.can(event)` works as a filter as it is:
`createTestModel(machine, { filterEvents: (state, event) => state.can(event) })`.

### Model actor logic that is not a machine

`new TestModel(logic, options)` builds a model of any actor logic, such as a `fromTransition`
reducer. Give it the events to send in `events` (a list or a function of the state) and a
`stateMatcher(state, key)` that decides which state tests apply. Without a matcher, only the
`"*"` test runs.

### Machines with delays or invocations

A test model cannot drive an `invoke`, an `after` transition or a delayed inline action, and
`createTestModel` fails with `UnsupportedTestMachineError` and one of these messages:
`Invocations on test machines are not supported`, `After events on test machines are not
supported`, `Delayed actions on test machines are not supported`. Model the behaviour with
plain events instead, for example a `TIMEOUT` event in place of the `after` transition, whose
executor moves the system's own clock. Test the timing itself with an actor: see
[How to test delayed transitions](test-delayed-transitions.md).

### Paths without a model

To work with the paths alone, call the traversals directly: `getShortestPaths(logic,
options)`, `getSimplePaths`, `getPathsFromEvents` and `getAdjacencyMap` take a machine or other
logic and return Effects (`getAdjacencyMap` requires its options; pass `{}` for the defaults). They give plain paths (`state`, `steps`, `weight`) with no
description and no `test`. They accept a machine with delays or invocations: an `after`
transition shows up as a step whose event is the delayed event, such as
`xstate.after.100.light.green`.

## Related

- [Graph and model-based testing](../reference/graph.md): every function, option and type of
  the `/graph` entry point.
- [Errors](../reference/errors.md): `UnsupportedTestMachineError`, `TraversalLimitError`,
  `InvalidEventSequenceError` and `JoinPathsError`.
- [How to test a machine without running an actor](test-machines-without-actors.md).
