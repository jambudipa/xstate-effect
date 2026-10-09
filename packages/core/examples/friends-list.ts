/**
 * Friends List Example
 *
 * A state machine for managing a friends list with async loading.
 *
 * Demonstrates:
 * - Async data loading with fromPromise
 * - Loading/success/failure states
 * - Error handling
 * - Retry functionality
 *
 * Ported from xstate/examples/friends-list-react
 */
import { Option } from "effect"
import { setup, assign, fromPromise } from "../src/index.js"

/**
 * Friend type.
 */
export interface Friend {
  /** The friend's identifier, unique in the list (the mock data uses "1", "2", "3"). */
  id: string
  /** The display name. */
  name: string
}

/**
 * Context type for friends list.
 */
export interface FriendsListContext {
  /**
   * The friends from the last load that succeeded. A failed load keeps the old list, and a done
   * event without output also keeps it.
   */
  friends: Friend[]
  /** The error of the last failed load; a load that succeeds clears it to null. */
  error: Error | null
}

/**
 * Events for friends list.
 */
export type FriendsListEvent =
  | { type: "LOAD" }
  | { type: "RETRY" }

/**
 * Mock friends data.
 */
const mockFriends: Friend[] = [
  { id: "1", name: "Alice" },
  { id: "2", name: "Bob" },
  { id: "3", name: "Charlie" },
]

/**
 * Load friends actor.
 */
export const loadFriendsActor = fromPromise<Friend[], void>(async () => {
  await new Promise((resolve) => setTimeout(resolve, 100))
  // Simulate occasional failure
  if (Math.random() < 0.1) {
    throw new Error("Failed to load friends")
  }
  return mockFriends
})

/**
 * Friends List machine.
 *
 * Manages loading and displaying a list of friends.
 */
export const friendsListMachine = setup({
  types: {
    context: {} as FriendsListContext,
    events: {} as FriendsListEvent,
  },
  actors: {
    loadFriends: loadFriendsActor,
  },
}).createMachine({
  id: "friendsList",
  initial: "idle",
  context: {
    friends: [],
    error: null,
  },
  states: {
    idle: {
      on: {
        LOAD: "loading",
      },
    },
    loading: {
      invoke: {
        src: "loadFriends",
        onDone: {
          target: "success",
          actions: assign(({ context, event }) => ({
            // A done event's output is an Option (D8)
            friends: Option.getOrElse(event.output, () => context.friends),
            error: null,
          })),
        },
        onError: {
          target: "failure",
          actions: assign(({ event }) => ({
            error: (event as { error: Error }).error,
          })),
        },
      },
    },
    success: {
      on: {
        LOAD: "loading",
      },
    },
    failure: {
      on: {
        RETRY: "loading",
      },
    },
  },
})
