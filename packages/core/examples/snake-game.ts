/**
 * Snake Game Example
 *
 * A classic snake game state machine.
 *
 * Demonstrates:
 * - Complex game state management
 * - Callback actor for game ticks
 * - Guards for collision detection
 * - Entry actions
 * - Always transitions for game over detection
 *
 * Ported from xstate/examples/snake-react
 *
 * Note: The original ends the game through one always transition guarded by
 * `or(["hit tail", "hit wall"])`. This version has one guarded always transition for each
 * guard, which ends the game the same way.
 */
import { setup, assign, fromCallback } from "../src/index.js"
import type { EventObject } from "../src/index.js"

/**
 * Direction type.
 */
export type Dir = "Up" | "Left" | "Down" | "Right"

/**
 * Point in 2D space.
 */
export interface Point {
  /** The column, in grid cells; 0 is the left edge. */
  x: number
  /** The row, in grid cells; 0 is the top edge, and "Up" decreases it. */
  y: number
}

/**
 * Snake body part with direction.
 */
export interface BodyPart extends Point {
  /** The direction of the move that made this part the head; later moves do not change it. */
  dir: Dir
}

/**
 * Snake type - array of body parts.
 */
export type Snake = BodyPart[]

/**
 * Context for the snake game.
 */
export interface SnakeContext {
  /** The snake, head first. It always has at least one part: the guards read the head without a check. */
  snake: Snake
  /** The grid width (`x`) and height (`y`) in cells; 25 by 15. A head outside it ends the game. */
  gridSize: Point
  /**
   * The direction of the next move. An ARROW_KEY sets it, except a key for the opposite
   * direction, which the machine ignores so that the snake cannot reverse into itself.
   */
  dir: Dir
  /** The apple cell. A new apple never appears on a snake part. */
  apple: Point
  /** The apples eaten in this game; NEW_GAME sets it back to 0. */
  score: number
  /** The best score since the machine started; NEW_GAME keeps it. */
  highScore: number
}

/**
 * Events for the snake game.
 */
export type SnakeEvent =
  | { type: "NEW_GAME" }
  | { type: "ARROW_KEY"; dir: Dir }
  | { type: "TICK" }

/**
 * Opposite directions map.
 */
const oppositeDir: Record<Dir, Dir> = {
  Up: "Down",
  Down: "Up",
  Left: "Right",
  Right: "Left",
}

/**
 * Check if two points are the same.
 */
function isSamePos(p1: Point, p2: Point): boolean {
  return p1.x === p2.x && p1.y === p2.y
}

/**
 * Check if point is outside grid.
 */
function isOutsideGrid(gridSize: Point, p: Point): boolean {
  return p.x < 0 || p.x >= gridSize.x || p.y < 0 || p.y >= gridSize.y
}

/**
 * Find a point in an array of points.
 */
function find<T extends Point>(points: T[], p: Point): T | undefined {
  return points.find((pp) => isSamePos(pp, p))
}

/**
 * Get the head of the snake.
 */
function head(snake: Snake): BodyPart {
  return snake[0]!
}

/**
 * Get the body (everything except head) of the snake.
 */
function body(snake: Snake): Snake {
  return snake.slice(1)
}

/**
 * Create new head in direction.
 */
function newHead(oldHead: BodyPart, dir: Dir): BodyPart {
  switch (dir) {
    case "Up":
      return { x: oldHead.x, y: oldHead.y - 1, dir }
    case "Down":
      return { x: oldHead.x, y: oldHead.y + 1, dir }
    case "Left":
      return { x: oldHead.x - 1, y: oldHead.y, dir }
    case "Right":
      return { x: oldHead.x + 1, y: oldHead.y, dir }
  }
}

/**
 * Move snake in direction.
 */
function moveSnake(snake: Snake, dir: Dir): Snake {
  return [newHead(head(snake), dir), ...snake.slice(0, -1)]
}

/**
 * Generate random grid point.
 */
function randomGridPoint(gridSize: Point): Point {
  return {
    x: Math.floor(Math.random() * gridSize.x),
    y: Math.floor(Math.random() * gridSize.y),
  }
}

/**
 * Generate new apple position.
 */
function newApple(gridSize: Point, ineligiblePoints: Point[]): Point {
  let apple = randomGridPoint(gridSize)
  while (find(ineligiblePoints, apple)) {
    apple = randomGridPoint(gridSize)
  }
  return apple
}

/**
 * Grow the snake by one segment.
 */
function growSnake(snake: Snake): Snake {
  return [...snake, snake[snake.length - 1]!]
}

/**
 * Make initial snake in center of grid.
 */
function makeInitialSnake(gridSize: Point): Snake {
  const h: BodyPart = {
    x: Math.floor(gridSize.x / 2),
    y: Math.floor(gridSize.y / 2),
    dir: "Right",
  }
  return [h, { ...h, x: h.x - 1 }, { ...h, x: h.x - 2 }]
}

/**
 * Make initial apple position.
 */
function makeInitialApple(gridSize: Point): Point {
  return {
    x: Math.floor((gridSize.x * 3) / 4),
    y: Math.floor(gridSize.y / 2),
  }
}

/**
 * Create initial context.
 */
export function createInitialContext(): SnakeContext {
  const gridSize: Point = { x: 25, y: 15 }
  return {
    gridSize,
    snake: makeInitialSnake(gridSize),
    apple: makeInitialApple(gridSize),
    score: 0,
    highScore: 0,
    dir: "Right",
  }
}

/**
 * Ticks actor - emits TICK events at game speed.
 */
export const ticksActor = fromCallback<EventObject, void, EventObject>(
  ({ sendBack }) => {
    const i = setInterval(() => {
      sendBack({ type: "TICK" })
    }, 80)
    return () => clearInterval(i)
  }
)

/**
 * Snake Game machine.
 *
 * A classic snake game that:
 * - Moves the snake on arrow key input
 * - Grows when eating apples
 * - Ends when hitting wall or tail
 * - Tracks score and high score
 */
export const snakeMachine = setup({
  types: {
    context: {} as SnakeContext,
    events: {} as SnakeEvent,
  },
  guards: {
    "ate apple": ({ context }) => isSamePos(head(context.snake), context.apple),
    "hit tail": ({ context }) => !!find(body(context.snake), head(context.snake)),
    "hit wall": ({ context }) =>
      isOutsideGrid(context.gridSize, head(context.snake)),
  },
  actions: {
    "move snake": assign(({ context }) => ({
      snake: moveSnake(context.snake, context.dir),
    })),
    "save dir": assign(({ context, event }) => {
      if (event.type !== "ARROW_KEY") return {}
      return {
        dir:
          event.dir !== oppositeDir[context.dir] ? event.dir : context.dir,
      }
    }),
    "increase score": assign(({ context }) => ({
      score: context.score + 1,
      highScore: Math.max(context.score + 1, context.highScore),
    })),
    "show new apple": assign(({ context }) => ({
      apple: newApple(context.gridSize, context.snake),
    })),
    "grow snake": assign(({ context }) => ({
      snake: growSnake(context.snake),
    })),
    reset: assign(({ context }) => ({
      ...createInitialContext(),
      highScore: context.highScore,
    })),
  },
  actors: {
    ticks: ticksActor,
  },
}).createMachine({
  id: "SnakeMachine",
  context: createInitialContext(),
  initial: "New Game",
  states: {
    "New Game": {
      on: {
        ARROW_KEY: {
          actions: "save dir",
          target: "Moving",
        },
      },
    },
    Moving: {
      entry: "move snake",
      invoke: {
        src: "ticks",
      },
      always: [
        {
          guard: "ate apple",
          actions: ["grow snake", "increase score", "show new apple"],
        },
        {
          guard: "hit tail",
          target: "Game Over",
        },
        {
          guard: "hit wall",
          target: "Game Over",
        },
      ],
      on: {
        TICK: {
          actions: "move snake",
        },
        ARROW_KEY: {
          actions: "save dir",
          target: "Moving",
        },
      },
    },
    "Game Over": {
      on: {
        NEW_GAME: {
          actions: "reset",
          target: "New Game",
        },
      },
    },
  },
})
