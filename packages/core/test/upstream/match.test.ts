import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { matchesState, createMachine, createActor } from "../../src/index.js";

describe('matchesState()', () => {
  // upstream: test/match.test.ts > matchesState() > should return true if two states are equivalent
  it.effect('should return true if two states are equivalent', () => Effect.gen(function* () {
    expect(matchesState('a', 'a')).toBeTruthy();

    expect(matchesState('b.b1', 'b.b1')).toBeTruthy();

    expect(matchesState('B.bar', { A: 'foo' })).toBe(false);
  }));

  // upstream: test/match.test.ts > matchesState() > should return true if two state values are equivalent
  it.effect('should return true if two state values are equivalent', () => Effect.gen(function* () {
    expect(matchesState({ a: 'b' }, { a: 'b' })).toBeTruthy();
    expect(matchesState({ a: { b: 'c' } }, { a: { b: 'c' } })).toBeTruthy();
  }));

  // upstream: test/match.test.ts > matchesState() > should return true if two parallel states are equivalent
  it.effect('should return true if two parallel states are equivalent', () => Effect.gen(function* () {
    expect(
      matchesState(
        { a: { b1: 'foo', b2: 'bar' } },
        { a: { b1: 'foo', b2: 'bar' } }
      )
    ).toBeTruthy();

    expect(
      matchesState(
        { a: { b1: 'foo', b2: 'bar' }, b: { b3: 'baz', b4: 'quo' } },
        { a: { b1: 'foo', b2: 'bar' }, b: { b3: 'baz', b4: 'quo' } }
      )
    ).toBeTruthy();

    expect(
      matchesState({ a: 'foo', b: 'bar' }, { a: 'foo', b: 'bar' })
    ).toBeTruthy();
  }));

  // upstream: test/match.test.ts > matchesState() > should return true if a state is a substate of a superstate
  it.effect('should return true if a state is a substate of a superstate', () => Effect.gen(function* () {
    expect(matchesState('b', 'b.b1')).toBeTruthy();

    expect(matchesState('foo.bar', 'foo.bar.baz.quo')).toBeTruthy();
  }));

  // upstream: test/match.test.ts > matchesState() > should return true if a state value is a substate of a superstate value
  it.effect('should return true if a state value is a substate of a superstate value', () => Effect.gen(function* () {
    expect(matchesState('b', { b: 'b1' })).toBeTruthy();

    expect(
      matchesState({ foo: 'bar' }, { foo: { bar: { baz: 'quo' } } })
    ).toBeTruthy();
  }));

  // upstream: test/match.test.ts > matchesState() > should return true if a parallel state value is a substate of a superstate value
  it.effect('should return true if a parallel state value is a substate of a superstate value', () => Effect.gen(function* () {
    expect(matchesState('b', { b: 'b1', c: 'c1' })).toBeTruthy();

    expect(
      matchesState(
        { foo: 'bar', fooAgain: 'barAgain' },
        { foo: { bar: { baz: 'quo' } }, fooAgain: { barAgain: 'baz' } }
      )
    ).toBeTruthy();
  }));

  // upstream: test/match.test.ts > matchesState() > should return false if two states are not equivalent
  it.effect('should return false if two states are not equivalent', () => Effect.gen(function* () {
    expect(!matchesState('a', 'b')).toBeTruthy();

    expect(!matchesState('a.a1', 'b.b1')).toBeTruthy();
  }));

  // upstream: test/match.test.ts > matchesState() > should return false if parent state is more specific than child state
  it.effect('should return false if parent state is more specific than child state', () => Effect.gen(function* () {
    expect(!matchesState('a.b.c', 'a.b')).toBeTruthy();

    expect(!matchesState({ a: { b: { c: 'd' } } }, { a: 'b' })).toBeTruthy();
  }));

  // upstream: test/match.test.ts > matchesState() > should return false if two state values are not equivalent
  it.effect('should return false if two state values are not equivalent', () => Effect.gen(function* () {
    expect(!matchesState({ a: 'a1' }, { b: 'b1' })).toBeTruthy();
  }));

  // upstream: test/match.test.ts > matchesState() > should return false if a state is not a substate of a superstate
  it.effect('should return false if a state is not a substate of a superstate', () => Effect.gen(function* () {
    expect(!matchesState('a', 'b.b1')).toBeTruthy();

    expect(!matchesState('foo.false.baz', 'foo.bar.baz.quo')).toBeTruthy();
  }));

  // upstream: test/match.test.ts > matchesState() > should return false if a state value is not a substate of a superstate value
  it.effect('should return false if a state value is not a substate of a superstate value', () => Effect.gen(function* () {
    expect(!matchesState('a', { b: 'b1' })).toBeTruthy();

    expect(
      !matchesState({ foo: { false: 'baz' } }, { foo: { bar: { baz: 'quo' } } })
    ).toBeTruthy();
  }));

  // upstream: test/match.test.ts > matchesState() > should mix/match string state values and object state values
  it.effect('should mix/match string state values and object state values', () => Effect.gen(function* () {
    expect(matchesState('a.b.c', { a: { b: 'c' } })).toBeTruthy();
  }));
});

describe('matches() method', () => {
  // upstream: test/match.test.ts > matches() method > should execute matchesState on a State given the parent state value
  it.effect('should execute matchesState on a State given the parent state value', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'foo',
      states: {
        foo: {
          initial: 'bar',
          states: {
            bar: {
              initial: 'baz',
              states: {
                baz: {}
              }
            }
          }
        }
      }
    });

    const initialState = (yield* (yield* createActor(machine)).getSnapshot);

    expect(initialState.matches('foo')).toBeTruthy();
    expect(initialState.matches({ foo: 'bar' })).toBeTruthy();
    expect(initialState.matches('fake')).toBeFalsy();
  }));
});
