/**
 * @since 0.1.0
 * @module internal/anyEventObject
 *
 * Upstream's `AnyEventObject` and upstream's other `any` of an untyped invocation, of an
 * `AnyActorRef` snapshot, of `MachineContext`, of the `AnyStateNode` metadata and of the
 * containers of state nodes (`types.ts` at xstate@5.33.2), the only `any` in `src` (SD-22
 * amendments, goal journal `2026-10-06-08-any-event.md`, `2026-10-07-09-upstream-any.md`,
 * `2026-10-07-10-anyactorref-any.md`, `2026-10-07-11-machinecontext-any.md`,
 * `2026-10-07-12-any-state-node.md` and `2026-10-07-13-node-containers-any.md`).
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
 * Upstream's `any` where its types do not know a type (`types.ts` at xstate@5.33.2): the
 * output of an untyped invocation's done event (`DoneActorEvent<any>`), the snapshot of its
 * snapshot event, and the input and event of `AnyActorLogic`
 * (`ActorLogic<any, any, any, any, any>`), so an inline logic written as an invocation's `src`
 * reads any member of its input and events, as upstream (SD-22 amendment 2026-10-07, goal
 * journal `2026-10-07-09-upstream-any.md`); and the snapshot of an `AnyActorRef`
 * (`ActorRef<any, any, any>`), so the snapshot of a child read through `snapshot.children`
 * gives any member (SD-22 amendment 2026-10-07, goal journal
 * `2026-10-07-10-anyactorref-any.md`); the members of `MachineContext`
 * (`Record<string, any>`, goal journal `2026-10-07-11-machinecontext-any.md`); and the meta
 * of `AnyStateNode` and the four types of `AnyStateNodeDefinition` (goal journal
 * `2026-10-07-12-any-state-node.md`); and the meta of the nodes and transitions that
 * `StateNode.Any`, `AnyStateConfig`, `Transitions`, `HistoryStateNode` and the engine helpers
 * named after upstream's hold (goal journal `2026-10-07-13-node-containers-any.md`).
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
