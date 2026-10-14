---
title: Build your first state machine
doc-type: tutorial
sources: [packages/core/src/StateMachine.ts, packages/core/src/Actor.ts, packages/core/src/setup.ts]
---

# Build your first state machine

> **TL;DR:** You build a coin-operated turnstile with two states, `locked` and `unlocked`, from an
> empty folder. You define it with `setup` and `createMachine`, run it as an actor, send it events
> and read its snapshot. The same turnstile grows through every tutorial that follows.

## What you will build

A turnstile at a station barrier. It starts `locked`. A coin unlocks it; a push lets one person
through and locks it again. A push while it is locked does nothing.

| State      | Event  | Next state |
| ---------- | ------ | ---------- |
| `locked`   | `COIN` | `unlocked` |
| `unlocked` | `PUSH` | `locked`   |

At the end of this tutorial you have a program that prints:

```text
start: locked (active)
after COIN: unlocked (active)
after PUSH: locked (active)
after PUSH: locked (active)
```

## Before you start

- Node.js 20 or later, with npm. `node --version` prints the version you have.
- A terminal and a text editor.
- Some TypeScript. You do not need to know Effect: this tutorial explains the few parts of it
  that it uses.

## Step 1: Create the project

Run these commands in a terminal:

```bash
mkdir turnstile
cd turnstile
npm init -y
npm pkg set type=module
npm install @jambudipa/xstate-effect effect
npm install --save-dev tsx typescript
```

`@jambudipa/xstate-effect` is the state machine library, and `effect` is the library it is built
on; your project needs both. `tsx` runs a TypeScript file directly, and `typescript` checks your
types. The library ships as ES modules only, so `npm pkg set type=module` makes your project an ES
module project too.

**What you should see:** each `npm install` ends without an error. `package.json` now lists
`@jambudipa/xstate-effect` and `effect` under `dependencies`, `tsx` and `typescript` under
`devDependencies`, and has `"type": "module"`. A recent npm can also warn that it did not run the
install script of `esbuild`, a package that `tsx` uses; you can ignore that warning, because `tsx`
works without the script.

## Step 2: Configure TypeScript

Create a file named `tsconfig.json` in the `turnstile` folder:

```json
{
  "compilerOptions": {
    "strict": true,
    "module": "nodenext",
    "target": "es2022",
    "noEmit": true,
    "skipLibCheck": true
  }
}
```

**What you should see:** nothing yet. The next step uses this file to check your machine.

## Step 3: Define the machine

Create a file named `turnstile.ts` with this content:

```ts
import { setup } from "@jambudipa/xstate-effect"

export const turnstileMachine = setup({
  types: {} as {
    events: { type: "COIN" } | { type: "PUSH" }
  }
}).createMachine({
  id: "turnstile",
  initial: "locked",
  states: {
    locked: {
      on: {
        COIN: { target: "unlocked" }
      }
    },
    unlocked: {
      on: {
        PUSH: { target: "locked" }
      }
    }
  }
})
```

`setup` takes the types of your machine. The `types: {} as { … }` line declares them for
TypeScript only: the empty object carries no data. Here it says that the machine accepts two
events, `COIN` and `PUSH`, and no others.

`createMachine` takes the machine itself:

- `id` names the machine.
- `initial` names the state the machine starts in.
- `states` lists the states. In each state, `on` maps an event type to a transition, and `target`
  names the state that the transition goes to.

Check the types:

```bash
npx tsc
```

**What you should see:** no output. `tsc` prints nothing when your types are correct.

## Step 4: Run the machine in an actor

The machine is only a definition, and nothing runs yet. To run it, you create an **actor**: a
running instance of the machine that holds its current state and takes events.

Replace the content of `turnstile.ts` with this program:

```ts
import { createActor, setup } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

const turnstileMachine = setup({
  types: {} as {
    events: { type: "COIN" } | { type: "PUSH" }
  }
}).createMachine({
  id: "turnstile",
  initial: "locked",
  states: {
    locked: {
      on: {
        COIN: { target: "unlocked" }
      }
    },
    unlocked: {
      on: {
        PUSH: { target: "locked" }
      }
    }
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(turnstileMachine)
  yield* actor.start

  const report = (label: string) =>
    Effect.gen(function* () {
      const snapshot = yield* actor.getSnapshot
      console.log(`${label}: ${snapshot.value} (${snapshot.status})`)
    })

  yield* report("start")
  yield* actor.send({ type: "COIN" })
  yield* report("after COIN")
  yield* actor.send({ type: "PUSH" })
  yield* report("after PUSH")
  yield* actor.send({ type: "PUSH" })
  yield* report("after PUSH")
})

void Effect.runPromise(Effect.scoped(program))
```

The machine is the same as in step 3. The new parts are:

- `Effect.gen(function* () { … })` describes a program as a sequence of steps. Each `yield*` runs
  one step and gives back its result.
- `createActor(turnstileMachine)` creates the actor, and `actor.start` starts it in its initial
  state.
- `actor.send(event)` gives the actor an event. When the step ends, the actor has processed the
  event.
- `actor.getSnapshot` reads the actor's current **snapshot**. `snapshot.value` is the current
  state, and `snapshot.status` is `active` while the actor runs.
- `report` prints the snapshot with a label. It is a small program of its own, so each
  `yield* report(…)` reads a fresh snapshot.
- `Effect.runPromise(Effect.scoped(program))` runs the program. `Effect.scoped` gives the actor a
  scope: when the program ends, the scope closes and the actor stops.

Run the program:

```bash
npx tsx turnstile.ts
```

**What you should see:**

```text
start: locked (active)
after COIN: unlocked (active)
after PUSH: locked (active)
after PUSH: locked (active)
```

The coin unlocks the turnstile and the push locks it again. The second push arrives while the
turnstile is `locked`, a state with no transition for `PUSH`, so the machine ignores it and stays
`locked`.

## Step 5: Let TypeScript check your events

In `turnstile.ts`, change the line `yield* actor.send({ type: "COIN" })` to send an event the
machine does not know:

```text
  yield* actor.send({ type: "KICK" })
```

Run the type check:

```bash
npx tsc
```

**What you should see:** an error like this one.

```text
turnstile.ts(36,23): error TS2322: Type '"KICK"' is not assignable to type '"COIN" | "PUSH"'.
```

The event types you gave `setup` reach every `send`. Change `KICK` back to `COIN` and run
`npx tsc` again: it prints nothing.

## What you learned

- `setup` declares the types of a machine, and its `createMachine` defines the states and the
  transitions between them.
- A transition goes from one state to another when the state receives the event it names. A state
  ignores an event it has no transition for.
- `createActor` turns a machine into a running actor; `start`, `send` and `getSnapshot` are steps
  that you run with `yield*` inside `Effect.gen`.
- A snapshot holds the current state in `value` and the actor's status in `status`.
- `Effect.runPromise(Effect.scoped(program))` runs the program, and the actor stops when it ends.

## Next steps

- [Keep data in context](./02-working-with-context.md): give the turnstile data of its own, in the
  same project.
- [createMachine and the machine](../reference/create-machine.md) describes the machine definition
  and what it can hold.
- [createActor and the actor](../reference/create-actor.md) describes the actor's options and
  members.
- [About state machines and statecharts](../explanation/state-machines.md) explains the ideas
  behind states and transitions.
