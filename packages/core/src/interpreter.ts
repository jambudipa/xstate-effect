/**
 * @since 0.1.0
 * @module interpreter
 *
 * XState's deprecated interpreter names (`Interpreter` in `src/createActor.ts`,
 * `AnyInterpreter` and `InterpreterFrom` in `src/types.ts` at xstate@5.33.2): aliases of the
 * actor types, from the root as upstream exports them. `interpret` itself is not ported
 * (D6, DEV-1). The root re-exports this module with `export *`, so the gate's
 * `no-deprecated` rule does not read the re-export as a use of a deprecated name.
 */
import type { Actor, ActorClass, AnyActor } from "./Actor.js"
import type { ActorLogic } from "./ActorLogic.js"
import type { EventObject } from "./Event.js"
import type { Snapshot } from "./Snapshot.js"
import type { AnyStateMachine } from "./StateMachine.js"

/**
 * The type of the `Actor` class (upstream `Interpreter`, its deprecated alias of
 * `typeof Actor`).
 *
 * @deprecated Use `Actor` (upstream's own deprecation).
 * @since 0.1.0
 * @category Actor
 */
export type Interpreter = typeof ActorClass

/**
 * Any actor (upstream `AnyInterpreter`, its deprecated alias of `AnyActor`).
 *
 * @deprecated Use `AnyActor` (upstream's own deprecation).
 * @since 0.1.0
 * @category Actor
 */
export type AnyInterpreter = AnyActor

/**
 * The actor of a state machine, or of the machine a function returns (upstream
 * `InterpreterFrom`): what `createActor` gives for it.
 *
 * @deprecated Use `ActorRefFrom` or the actor `createActor` gives (upstream's own deprecation).
 * @since 0.1.0
 * @category Actor
 */
export type InterpreterFrom<T extends AnyStateMachine | ((...args: never) => AnyStateMachine)> =
  (T extends (...args: never) => infer TMachine ? TMachine : T) extends ActorLogic<
    infer TSnapshot extends Snapshot,
    infer TEvent extends EventObject,
    infer _TInput,
    infer TEmitted extends EventObject,
    infer _R
  > ? Actor<TSnapshot, TEvent, TEmitted>
  : never
