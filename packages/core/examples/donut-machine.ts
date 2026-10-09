/**
 * Donut Machine Example
 *
 * A state machine for making donuts with parallel mixing steps.
 *
 * Demonstrates:
 * - Complex nested states
 * - Parallel states for concurrent operations
 * - onDone for compound state completion
 * - Step-by-step process
 *
 * Ported from xstate/examples/persisted-donut-maker
 */
import { createMachine } from "../src/index.js"

/**
 * Events for the donut machine.
 */
export type DonutEvent =
  | { type: "NEXT" }
  | { type: "MIXED_DRY" }
  | { type: "MIXED_WET" }
  | { type: "ANOTHER_DONUT" }

/**
 * Donut Machine.
 *
 * Follows the donut making process:
 * 1. Gather ingredients
 * 2. Make dough (with parallel dry/wet mixing)
 * 3. Fry, flip, dry, glaze
 * 4. Serve
 */
export const donutMachine = createMachine({
  types: {} as { events: DonutEvent },
  id: "donut",
  initial: "ingredients",
  states: {
    ingredients: {
      on: {
        NEXT: "directions",
      },
    },
    directions: {
      initial: "makeDough",
      onDone: "fry",
      states: {
        makeDough: {
          on: { NEXT: "mix" },
        },
        mix: {
          type: "parallel",
          states: {
            mixDry: {
              initial: "mixing",
              states: {
                mixing: {
                  on: { MIXED_DRY: "mixed" },
                },
                mixed: {
                  type: "final",
                },
              },
            },
            mixWet: {
              initial: "mixing",
              states: {
                mixing: {
                  on: { MIXED_WET: "mixed" },
                },
                mixed: {
                  type: "final",
                },
              },
            },
          },
          onDone: "allMixed",
        },
        allMixed: {
          type: "final",
        },
      },
    },
    fry: {
      on: {
        NEXT: "flip",
      },
    },
    flip: {
      on: {
        NEXT: "dry",
      },
    },
    dry: {
      on: {
        NEXT: "glaze",
      },
    },
    glaze: {
      on: {
        NEXT: "serve",
      },
    },
    serve: {
      on: {
        ANOTHER_DONUT: "ingredients",
      },
    },
  },
})
