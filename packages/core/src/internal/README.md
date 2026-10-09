# src/internal

Private helpers that several modules share. No entry point exports them, except the
`AnyEventObject` type, which the root re-exports. Most of them reproduce one upstream detail
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

## Constraints

- Files here import at run time only from `effect` and from each other; their imports from the
  rest of `src` are type-only. Every module can then import them without an import cycle.
- `anyEventObject.ts` is the only file in `src` with a scoped lint exception
  (`@typescript-eslint/no-explicit-any`, SD-22). Do not add `any` in another file; a new `any`
  needs an SD-22 amendment and goes in that file.
- State that a helper keeps is per object (a `WeakMap` keyed by the object) or per fiber (a
  `Context.Reference`), so it never leaks from one actor to another.
- Each helper names the upstream source it reproduces (a file at xstate@5.33.2). Keep that
  reference current when you change the helper.
