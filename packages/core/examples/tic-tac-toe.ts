/**
 * Tic-Tac-Toe Example
 *
 * A classic tic-tac-toe game state machine.
 *
 * Demonstrates:
 * - Complex guards (win detection, valid move)
 * - Always transitions for game state detection
 * - Tags for state identification
 * - Entry actions
 * - Game reset
 *
 * Ported from xstate/examples/tic-tac-toe-react
 */
import { setup, assign } from "../src/index.js"

/**
 * Player type.
 */
export type Player = "x" | "o"

/**
 * Board type - 9 cells.
 */
export type Board = Array<Player | null>

/**
 * Context type for tic-tac-toe.
 */
export interface TicTacToeContext {
  board: Board
  moves: number
  player: Player
  winner: Player | undefined
}

/**
 * Events for tic-tac-toe.
 */
export type TicTacToeEvent =
  | { type: "PLAY"; value: number }
  | { type: "RESET" }

/**
 * Initial context.
 */
const initialContext: TicTacToeContext = {
  board: Array(9).fill(null),
  moves: 0,
  player: "x",
  winner: undefined,
}

/**
 * Winning lines - all possible ways to win.
 */
const winningLines = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
]

/**
 * Check if a player has won.
 */
const checkWin = (board: Board): boolean => {
  for (const line of winningLines) {
    const xWon = line.every((index) => board[index] === "x")
    if (xWon) return true

    const oWon = line.every((index) => board[index] === "o")
    if (oWon) return true
  }
  return false
}

/**
 * Tic-Tac-Toe machine.
 */
export const ticTacToeMachine = setup({
  types: {
    context: {} as TicTacToeContext,
    events: {} as TicTacToeEvent,
  },
  actions: {
    updateBoard: assign(({ context, event }) => {
      if (event.type !== "PLAY") return {}
      const updatedBoard = [...context.board]
      updatedBoard[event.value] = context.player
      return {
        board: updatedBoard,
        moves: context.moves + 1,
        player: context.player === "x" ? "o" : "x",
      }
    }),
    resetGame: assign(() => initialContext),
    setWinner: assign(({ context }) => ({
      winner: context.player === "x" ? "o" : "x",
    })),
  },
  guards: {
    checkWin: ({ context }) => checkWin(context.board),
    checkDraw: ({ context }) => context.moves === 9,
    isValidMove: ({ context, event }) => {
      if (event.type !== "PLAY") return false
      return context.board[event.value] === null
    },
  },
}).createMachine({
  id: "ticTacToe",
  initial: "playing",
  context: initialContext,
  states: {
    playing: {
      always: [
        { target: "gameOver.winner", guard: "checkWin" },
        { target: "gameOver.draw", guard: "checkDraw" },
      ],
      on: {
        PLAY: [
          {
            target: "playing",
            guard: "isValidMove",
            actions: "updateBoard",
          },
        ],
      },
    },
    gameOver: {
      initial: "winner",
      states: {
        winner: {
          tags: ["winner"],
          entry: "setWinner",
        },
        draw: {
          tags: ["draw"],
        },
      },
      on: {
        RESET: {
          target: "playing",
          actions: "resetGame",
        },
      },
    },
  },
})
