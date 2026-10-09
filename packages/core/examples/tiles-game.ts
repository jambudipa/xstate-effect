/**
 * Tiles Game Example
 *
 * A tile swapping puzzle game state machine.
 *
 * Demonstrates:
 * - Complex guards for adjacency checking
 * - Nested states
 * - Always transitions for win detection
 * - ID-based state targeting
 *
 * Ported from xstate/examples/tiles
 *
 * Note: The original enqueues the swap with `enqueueActions` when the `isAdjacent` guard
 * holds. This version has a guarded transition and an unguarded one instead, with the same
 * effect.
 */
import { setup, assign } from "../src/index.js"

/**
 * Generate a range of numbers.
 */
function range(num: number): number[] {
  return Array.from(Array(num).keys())
}

/**
 * Tile with position info.
 */
export interface Tile {
  /** The position of the tile in `TilesContext.tiles`; the swap exchanges the values at two positions. */
  index: number
  /**
   * The column of the position. The sender of the event computes `x` and `y`; the machine does
   * not check them against `index`, and the adjacency guard reads only `x` and `y`.
   */
  x: number
  /** The row of the position; see `x`. */
  y: number
}

/**
 * Context for the tiles game.
 */
export interface TilesContext {
  /**
   * The tile number at each of the 16 positions. The puzzle is solved when each position holds
   * its own number; the machine starts solved, in "start", until the first shuffle.
   */
  tiles: number[]
  /**
   * The tile the player selected. A swap or a cancel clears it; a tile.move to a tile that is
   * not adjacent leaves it set.
   */
  selected: Tile | undefined
  /** The last tile the pointer passed over while a tile was selected; the swap target. Cleared with `selected`. */
  hovered: Tile | undefined
}

/**
 * Events for the tiles game.
 */
export type TilesEvent =
  | { type: "shuffle" }
  | { type: "tile.select"; tile: Tile }
  | { type: "tile.hover"; tile: Tile }
  | { type: "tile.move" }
  | { type: "move.canceled" }

/**
 * Swap two elements in an array.
 */
export function swap<T>(arr: T[], a: number, b: number): T[] {
  const result = [...arr]
  const first = arr[a]
  const second = arr[b]
  // Both indexes must hold an element (noUncheckedIndexedAccess reads them as T | undefined)
  if (first === undefined || second === undefined) return result
  result[a] = second
  result[b] = first
  return result
}

/**
 * Tiles Game machine.
 *
 * A tile puzzle game that:
 * - Allows selecting and swapping adjacent tiles
 * - Detects when all tiles are in order (win condition)
 * - Supports shuffling to restart
 */
export const tilesMachine = setup({
  types: {
    context: {} as TilesContext,
    events: {} as TilesEvent,
  },
  guards: {
    isAdjacent: ({ context }) => {
      const { selected, hovered } = context
      if (!selected || !hovered) return false
      const { x: hx, y: hy } = hovered
      const { x: sx, y: sy } = selected
      return (
        (hx === sx && Math.abs(hy - sy) === 1) ||
        (hy === sy && Math.abs(hx - sx) === 1)
      )
    },
    allTilesInOrder: ({ context }) =>
      context.tiles.every((tile, idx) => tile === idx),
  },
  actions: {
    clearSelectedTile: assign({ selected: undefined }),
    clearHoveredTile: assign({ hovered: undefined }),
    setSelectedTile: assign(({ event }) => ({
      selected: (event as { tile: Tile }).tile,
    })),
    setHoveredTile: assign(({ event }) => ({
      hovered: (event as { tile: Tile }).tile,
    })),
    swapTiles: assign(({ context }) => ({
      tiles: swap(context.tiles, context.hovered!.index, context.selected!.index),
    })),
    shuffleTiles: assign(({ context }) => {
      const newTiles = [...context.tiles]
      for (let i = newTiles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[newTiles[i], newTiles[j]] = [newTiles[j]!, newTiles[i]!]
      }
      return { tiles: newTiles }
    }),
  },
}).createMachine({
  id: "tiles",
  context: {
    tiles: range(16),
    selected: undefined,
    hovered: undefined,
  },
  initial: "start",
  states: {
    start: {},
    gameOver: {
      id: "gameOver",
      on: {
        shuffle: {
          target: "playing",
          actions: "shuffleTiles",
        },
      },
    },
    playing: {
      initial: "selecting",
      always: {
        guard: "allTilesInOrder",
        target: "#gameOver",
      },
      states: {
        selecting: {
          id: "selecting",
          on: {
            "tile.select": {
              target: "selected",
              actions: "setSelectedTile",
            },
          },
        },
        selected: {
          on: {
            "move.canceled": {
              target: "selecting",
              actions: ["clearSelectedTile", "clearHoveredTile"],
            },
            "tile.hover": {
              actions: "setHoveredTile",
            },
            "tile.move": [
              {
                guard: "isAdjacent",
                target: "#selecting",
                actions: ["swapTiles", "clearSelectedTile", "clearHoveredTile"],
              },
              {
                target: "#selecting",
              },
            ],
          },
        },
      },
    },
  },
  on: {
    shuffle: {
      target: ".playing",
      actions: "shuffleTiles",
    },
  },
})
