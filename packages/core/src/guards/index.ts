/**
 * @since 0.1.0
 * @module guards
 *
 * Built-in guards for xstate-effect, and the shared guard evaluator (upstream
 * `xstate/guards`).
 */

export * from "./stateIn.js"
export * from "./and.js"
export * from "./or.js"
export * from "./not.js"
export { evaluateGuard } from "./evaluateGuard.js"
export type { Guard, GuardArgs, GuardPredicate, UnknownGuard } from "../Types.js"
