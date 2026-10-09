/**
 * Trivia Game Example
 *
 * A trivia quiz game state machine with questions and scoring.
 *
 * Demonstrates:
 * - Complex nested states
 * - Multiple invoke actors for data loading
 * - Guards for answer checking and game state
 * - Points and lives tracking
 * - Always transitions for win/lose detection
 *
 * Ported from xstate/examples/trivia-game-example
 *
 * Note: The original narrows the answer event with `assertEvent` and guards a wrong answer
 * with `not("isAnswerCorrect")`. This version checks the event type in each guard and has an
 * `isAnswerIncorrect` guard, which select the same transitions for an answer.
 */
import { Option } from "effect"
import { setup, assign, fromPromise } from "../src/index.js"

/**
 * Character type (simplified from Rick & Morty API).
 */
export interface Character {
  id: number
  name: string
  image: string
  species: string
  status: string
}

/**
 * Context for the trivia game.
 */
export interface TriviaContext {
  homePageCharacters: Character[]
  hasLoaded: boolean
  currentCharacter: Character | null
  randomCharacters: Character[]
  isClueOpened: boolean
  points: number
  question: number
  lifes: number
}

/**
 * Events for the trivia game.
 */
export type TriviaEvent =
  | { type: "user.play" }
  | { type: "user.close" }
  | { type: "user.reject" }
  | { type: "user.accept" }
  | { type: "user.selectAnswer"; answer: number }
  | { type: "user.nextQuestion" }
  | { type: "user.toggleClue" }
  | { type: "user.playAgain" }

/**
 * Mock character data.
 */
const mockCharacters: Character[] = [
  { id: 1, name: "Rick Sanchez", image: "", species: "Human", status: "Alive" },
  { id: 2, name: "Morty Smith", image: "", species: "Human", status: "Alive" },
  { id: 3, name: "Summer Smith", image: "", species: "Human", status: "Alive" },
  { id: 4, name: "Beth Smith", image: "", species: "Human", status: "Alive" },
  { id: 5, name: "Jerry Smith", image: "", species: "Human", status: "Alive" },
]

/**
 * Get random number for character selection.
 */
function getRandomNumber(): number {
  return Math.floor(Math.random() * mockCharacters.length) + 1
}

/**
 * Load home page characters actor.
 */
export const loadHomePageCharactersActor = fromPromise<Character[], void>(
  async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
    return mockCharacters
  }
)

/**
 * Load single character actor.
 */
export const loadSingleCharacterActor = fromPromise<Character, void>(
  async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
    const id = getRandomNumber()
    return mockCharacters.find((c) => c.id === id) || mockCharacters[0]!
  }
)

/**
 * Load random characters actor.
 */
export const loadRandomCharactersActor = fromPromise<Character[], void>(
  async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
    return mockCharacters.slice(0, 4)
  }
)

/**
 * Trivia Game machine.
 *
 * A quiz game that:
 * - Loads character data
 * - Presents questions to identify characters
 * - Tracks points and lives
 * - Ends when lives run out or points reach 100
 */
export const triviaMachine = setup({
  types: {
    context: {} as TriviaContext,
    events: {} as TriviaEvent,
  },
  guards: {
    isAnswerCorrect: ({ context, event }) => {
      if (event.type !== "user.selectAnswer") return false
      if (!context.currentCharacter) return false
      return event.answer === context.currentCharacter.id
    },
    isAnswerIncorrect: ({ context, event }) => {
      if (event.type !== "user.selectAnswer") return false
      if (!context.currentCharacter) return true
      return event.answer !== context.currentCharacter.id
    },
    hasLostGame: ({ context }) => context.lifes <= 0,
    hasWonGame: ({ context }) => context.points >= 100,
  },
  actions: {
    goToTriviaPage: () => {},
    resetTriviaData: assign({
      currentCharacter: null,
      randomCharacters: [],
      points: 0,
      question: 0,
      lifes: 3,
    }),
  },
  actors: {
    loadHomePageCharacters: loadHomePageCharactersActor,
    loadSingleCharacter: loadSingleCharacterActor,
    loadRandomCharacters: loadRandomCharactersActor,
  },
}).createMachine({
  id: "triviaMachine",
  initial: "homepage",
  context: {
    homePageCharacters: [],
    hasLoaded: false,
    currentCharacter: null,
    randomCharacters: [],
    isClueOpened: false,
    points: 0,
    question: 0,
    lifes: 3,
  },
  states: {
    homepage: {
      initial: "loadingData",
      states: {
        loadingData: {
          invoke: {
            src: "loadHomePageCharacters",
            onDone: {
              target: "dataLoaded",
              actions: assign(({ context, event }) => ({
                // A done event's output is an Option (D8)
                homePageCharacters: Option.getOrElse(event.output, () => context.homePageCharacters),
                hasLoaded: true,
              })),
            },
          },
        },
        dataLoaded: {
          on: {
            "user.play": "#instructionModal",
          },
        },
      },
    },
    instructionModal: {
      id: "instructionModal",
      on: {
        "user.close": "homepage.dataLoaded",
        "user.reject": "homepage.dataLoaded",
        "user.accept": {
          target: "startTrivia",
          actions: assign({ hasLoaded: false }),
        },
      },
    },
    startTrivia: {
      id: "startTrivia",
      initial: "loadQuestionData",
      entry: ["goToTriviaPage", "resetTriviaData"],
      states: {
        loadQuestionData: {
          id: "loadQuestionData",
          initial: "loadCharacter",
          entry: assign({ hasLoaded: false }),
          states: {
            loadCharacter: {
              invoke: {
                src: "loadSingleCharacter",
                onDone: {
                  target: "loadRandomCharacters",
                  actions: assign(({ context, event }) => ({
                    // A done event's output is an Option (D8)
                    currentCharacter: Option.getOrElse(event.output, () => context.currentCharacter),
                  })),
                },
              },
            },
            loadRandomCharacters: {
              invoke: {
                src: "loadRandomCharacters",
                onDone: {
                  target: "#questionReady",
                  actions: assign(({ context, event }) => ({
                    // A done event's output is an Option (D8)
                    randomCharacters: Option.getOrElse(event.output, () => context.randomCharacters),
                    question: context.question + 1,
                    hasLoaded: true,
                  })),
                },
              },
            },
          },
        },
        questionReady: {
          id: "questionReady",
          initial: "questionStart",
          on: {
            "user.toggleClue": {
              actions: assign(({ context }) => ({
                isClueOpened: !context.isClueOpened,
              })),
            },
          },
          states: {
            questionStart: {
              on: {
                "user.selectAnswer": [
                  {
                    target: "correctAnswer",
                    guard: "isAnswerCorrect",
                  },
                  {
                    target: "incorrectAnswer",
                    guard: "isAnswerIncorrect",
                  },
                ],
              },
            },
            correctAnswer: {
              entry: assign(({ context }) => ({
                points: context.points + 10,
              })),
              always: [
                { guard: "hasLostGame", target: "lostGame" },
                { guard: "hasWonGame", target: "wonGame" },
              ],
              on: {
                "user.nextQuestion": "#loadQuestionData",
              },
            },
            incorrectAnswer: {
              entry: assign(({ context }) => ({
                lifes: context.lifes - 1,
              })),
              always: [
                { guard: "hasLostGame", target: "lostGame" },
                { guard: "hasWonGame", target: "wonGame" },
              ],
              on: {
                "user.nextQuestion": "#loadQuestionData",
              },
            },
            lostGame: {
              on: {
                "user.playAgain": "#startTrivia",
              },
            },
            wonGame: {
              on: {
                "user.playAgain": "#startTrivia",
              },
            },
          },
        },
      },
    },
  },
})
