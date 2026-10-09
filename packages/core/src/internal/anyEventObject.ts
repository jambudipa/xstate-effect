/**
 * @since 0.1.0
 * @module internal/anyEventObject
 *
 * Upstream's `AnyEventObject` and upstream's other `any` of an untyped invocation, of an
 * `AnyActorRef` snapshot, of `MachineContext`, of the `AnyStateNode` metadata and of the
 * containers of state nodes (`types.ts` at xstate@5.33.2): the only `any` in `src`, and the
 * only scoped lint exception in `src` (SD-22 and its amendments of 2026-10-06 and 2026-10-07,
 * see docs/decisions.md).
 *
 * The `any` stays because `unknown` would change what upstream's code and tests accept:
 * upstream's type tests assert `IsAny` on these types (the meta of `AnyStateNode`, of its
 * definition and of the node containers), and its tests read any member of an untyped event,
 * input or child snapshot. A new `any` belongs here, with an SD-22 amendment, and nowhere else.
 */
import type { EventObject } from "../Event.js"

/**
 * An event with any other members (upstream `AnyEventObject`): the event type of a machine
 * whose `types` declare no events, as `createMachine` and `setup` infer it. A guard, an action
 * or a params function of such a machine reads any member of its event, and the machine's
 * actor takes events with any members.
 *
 * @example
 * ```ts
 * createMachine({ on: { TIMER: { guard: ({ event }) => event.elapsed > 200 } } })
 * ```
 *
 * @since 0.1.0
 * @category Event
 */
export interface AnyEventObject extends EventObject {
  [key: string]: any
}

/**
 * Upstream's `any` where its types do not know a type (`types.ts` at xstate@5.33.2). Each use
 * below is an amendment of SD-22 (2026-10-07, see docs/decisions.md):
 *
 * - the output of an untyped invocation's done event (`DoneActorEvent<any>`), the snapshot of
 *   its snapshot event, and the input and event of `AnyActorLogic`
 *   (`ActorLogic<any, any, any, any, any>`), so an inline logic written as an invocation's
 *   `src` reads any member of its input and events, as upstream;
 * - the snapshot of an `AnyActorRef` (`ActorRef<any, any, any>`), so the snapshot of a child
 *   read through `snapshot.children` gives any member;
 * - the members of `MachineContext` (`Record<string, any>`);
 * - the meta of `AnyStateNode` and the four types of `AnyStateNodeDefinition`, and the meta of
 *   the nodes and transitions that `StateNode.Any`, `AnyStateConfig`, `Transitions`,
 *   `HistoryStateNode` and the engine helpers named after upstream's hold. Upstream's type
 *   tests assert `IsAny` on these metas, so they must stay `any`.
 *
 * @example
 * ```ts
 * createMachine({
 *   invoke: {
 *     src: fromCallback(({ input, receive }) => receive((event) => input.log(event.payload))),
 *     onDone: { actions: ({ event }) => Option.getOrThrow(event.output).count }
 *   }
 * })
 * ```
 *
 * @since 0.1.0
 * @category Event
 */
export type UpstreamAny = any
