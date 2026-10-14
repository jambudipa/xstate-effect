---
title: Tutorials
doc-type: index
---

# Tutorials

Learning-oriented lessons. Start with the first one: each builds on the one before, with one running example, a turnstile that grows into a station of turnstile actors.

1. [Build your first state machine](./01-first-state-machine.md) — You build a coin-operated turnstile with two states, `locked` and `unlocked`, from an empty folder.
2. [Keep data in context](./02-working-with-context.md) — You give the turnstile from the first tutorial data of its own: the credit paid so far and the number of people who have passed.
3. [Guard your transitions](./03-guards-and-transitions.md) — You give the turnstile a fare of 100p and make it unlock only when the credit reaches the fare.
4. [Run side effects](./04-side-effects.md) — You make the turnstile act on the world: it reports its barrier, its credit and its passes on the console, and it locks itself again when nobody passes in time.
5. [Invoke and spawn child actors](./05-child-actors.md) — You build a station that runs one turnstile actor for each of its gates.
6. [Test your machine](./07-testing.md) — You write Vitest tests for the turnstile and the station of the two previous tutorials.

When you have finished, the [how-to guides](../how-to/index.md) cover real tasks, and the [explanation](../explanation/index.md) pages cover the design.
