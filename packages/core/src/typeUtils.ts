/**
 * @since 0.1.0
 * @module typeUtils
 *
 * XState's general type utilities (the helpers at the top of `src/types.ts` at
 * xstate@5.33.2), with upstream's names and formulas, so a type written against xstate's
 * root exports reads the same here. They hold no machine or actor type; the root exports
 * each one (EXP-1). Where upstream writes `any`, these read {@link UpstreamAny}.
 */
import type { EventObject } from "./Event.js"
import type { UpstreamAny } from "./internal/anyEventObject.js"

/**
 * Any value but `unknown` itself (upstream `NonReducibleUnknown`): unlike `unknown`, it does
 * not absorb the other members of a union.
 *
 * @since 0.1.0
 * @category Type Utilities
 */
export type NonReducibleUnknown = NonNullable<unknown> | null | undefined

/**
 * Any function (upstream `AnyFunction`).
 *
 * @since 0.1.0
 * @category Type Utilities
 */
export type AnyFunction = (...args: Array<UpstreamAny>) => UpstreamAny

/**
 * A type whose members TypeScript shows one by one (upstream `Identity`).
 *
 * @since 0.1.0
 * @category Type Utilities
 */
export type Identity<T> = { [K in keyof T]: T[K] }

/**
 * `Pick` that keeps the modifiers of each member (upstream `HomomorphicPick`).
 *
 * @since 0.1.0
 * @category Type Utilities
 */
export type HomomorphicPick<T, K extends PropertyKey> = {
  [P in keyof T as P & K]: T[P]
}

/**
 * `Omit` that keeps the modifiers of each member (upstream `HomomorphicOmit`).
 *
 * @since 0.1.0
 * @category Type Utilities
 */
export type HomomorphicOmit<T, K extends PropertyKey> = {
  [P in keyof T as Exclude<P, K>]: T[P]
}

/**
 * A record with its keys and values swapped (upstream `Invert`).
 *
 * @since 0.1.0
 * @category Type Utilities
 */
export type Invert<T extends Record<PropertyKey, PropertyKey>> = {
  [K in keyof T as T[K]]: K
}

/**
 * `true` for `never`, else `false` (upstream `IsNever`).
 *
 * @since 0.1.0
 * @category Type Utilities
 */
export type IsNever<T> = [T] extends [never] ? true : false

/**
 * `false` for `never`, else `true` (upstream `IsNotNever`).
 *
 * @since 0.1.0
 * @category Type Utilities
 */
export type IsNotNever<T> = [T] extends [never] ? false : true

/**
 * An object type with its intersections flattened (upstream `Compute`).
 *
 * @since 0.1.0
 * @category Type Utilities
 */
export type Compute<A> = { [K in keyof A]: A[K] } & unknown

/**
 * The type of member `K` of `T`, `never` when `T` has no such member (upstream `Prop`).
 *
 * @since 0.1.0
 * @category Type Utilities
 */
export type Prop<T, K> = K extends keyof T ? T[K] : never

/**
 * The union of the member types of `T` (upstream `Values`).
 *
 * @since 0.1.0
 * @category Type Utilities
 */
export type Values<T> = T[keyof T]

/**
 * The union of the element types of a tuple (upstream `Elements`).
 *
 * @since 0.1.0
 * @category Type Utilities
 */
export type Elements<T> = T[keyof T & `${number}`]

/**
 * `M` with the members of `N` over its own (upstream `Merge`).
 *
 * @since 0.1.0
 * @category Type Utilities
 */
export type Merge<M, N> = Omit<M, keyof N> & N

/**
 * The members of a union, by the value of their property `P` (upstream `IndexByProp`).
 *
 * @since 0.1.0
 * @category Type Utilities
 */
export type IndexByProp<T extends Record<P, string>, P extends keyof T> = {
  [E in T as E[P]]: E
}

/**
 * The members of a union of objects with a `type`, by their type (upstream `IndexByType`).
 *
 * @since 0.1.0
 * @category Type Utilities
 */
export type IndexByType<T extends { type: string }> = IndexByProp<T, "type">

/**
 * `true` when the two types are the same, else `false` (upstream `Equals`).
 *
 * @since 0.1.0
 * @category Type Utilities
 */
export type Equals<A1, A2> = (<A>() => A extends A2 ? true : false) extends <A>() => A extends A1 ? true : false ? true
  : false

/**
 * `true` for `any`, else `false` (upstream `IsAny`).
 *
 * @since 0.1.0
 * @category Type Utilities
 */
export type IsAny<T> = Equals<T, UpstreamAny>

/**
 * `A` when it is a `B`, else `B` (upstream `Cast`): states a constraint TypeScript cannot
 * prove of a generic type.
 *
 * @since 0.1.0
 * @category Type Utilities
 */
export type Cast<A, B> = A extends B ? A : B

/**
 * `T`, where TypeScript does not infer `T` (upstream `DoNotInfer`).
 *
 * @since 0.1.0
 * @category Type Utilities
 */
export type DoNotInfer<T> = [T][T extends UpstreamAny ? 0 : UpstreamAny]

/**
 * `T` as a lower-priority inference site (upstream `LowInfer`).
 *
 * @since 0.1.0
 * @category Type Utilities
 */
export type LowInfer<T> = T & NonNullable<unknown>

/**
 * `T`, where TypeScript does not infer `T` (upstream `NoInfer`, its alias of
 * {@link DoNotInfer}). It is not TypeScript's own `NoInfer`.
 *
 * @since 0.1.0
 * @category Type Utilities
 */
export type NoInfer<T> = DoNotInfer<T>

/**
 * The type of a meta object (upstream `MetaObject`).
 *
 * @since 0.1.0
 * @category Type Utilities
 */
export type MetaObject = Record<string, UpstreamAny>

/**
 * A function that gives a `T` when called (upstream `Lazy`).
 *
 * @since 0.1.0
 * @category Type Utilities
 */
export type Lazy<T> = () => T

/**
 * A `T`, or a function that gives one (upstream `MaybeLazy`).
 *
 * @since 0.1.0
 * @category Type Utilities
 */
export type MaybeLazy<T> = T | Lazy<T>

/**
 * A type upstream has not written yet (upstream `TODO`, its `any`).
 *
 * @since 0.1.0
 * @category Type Utilities
 */
export type TODO = UpstreamAny

/**
 * One `T`, or a readonly array of them (upstream `SingleOrArray`).
 *
 * @since 0.1.0
 * @category Type Utilities
 */
export type SingleOrArray<T> = ReadonlyArray<T> | T

/**
 * `true` for a string literal type, `false` for `string` (upstream `IsLiteralString`).
 *
 * @since 0.1.0
 * @category Type Utilities
 */
export type IsLiteralString<T extends string> = string extends T ? false : true

/**
 * `T` with every member required when `Condition` is `true` (upstream
 * `ConditionalRequired`).
 *
 * @since 0.1.0
 * @category Type Utilities
 */
export type ConditionalRequired<T, Condition extends boolean> = Condition extends true ? Required<T> : T

/**
 * `T` with its member `TKey` narrowed to `TValue` (upstream `GetConcreteByKey`).
 *
 * @since 0.1.0
 * @category Type Utilities
 */
export type GetConcreteByKey<T, TKey extends keyof T, TValue extends T[TKey]> = T & Record<TKey, TValue>

/**
 * Each event of a union, with its `type` as a literal (upstream `InferEvent`).
 *
 * @since 0.1.0
 * @category Type Utilities
 */
export type InferEvent<E extends EventObject> = {
  [T in E["type"]]: { type: T } & Extract<E, { type: T }>
}[E["type"]]
