/**
 * TodoMVC Example
 *
 * A complete TodoMVC implementation state machine.
 *
 * Demonstrates:
 * - Complex event handling at root level
 * - Array manipulation in context
 * - Guards on transitions
 * - Filter state management
 *
 * Ported from xstate/examples/todomvc-react
 */
import { setup, assign } from "../src/index.js"

/**
 * Todo item type.
 */
export interface TodoItem {
  id: string
  title: string
  completed: boolean
}

/**
 * Filter type for todos.
 */
export type TodosFilter = "all" | "active" | "completed"

/**
 * Context for todos.
 */
export interface TodosContext {
  todo: string
  todos: TodoItem[]
  filter: TodosFilter
}

/**
 * Events for todos.
 */
export type TodosEvent =
  | { type: "newTodo.change"; value: string }
  | { type: "newTodo.commit"; value: string }
  | { type: "todo.commit"; todo: TodoItem }
  | { type: "todo.delete"; id: string }
  | { type: "filter.change"; filter: TodosFilter }
  | { type: "todo.mark"; id: string; mark: "active" | "completed" }
  | { type: "todo.markAll"; mark: "active" | "completed" }
  | { type: "todos.clearCompleted" }

/**
 * Generate a random ID.
 */
function generateId(): string {
  return Math.random().toString(36).substring(7)
}

/**
 * TodoMVC machine.
 *
 * A complete todo list that supports:
 * - Adding new todos
 * - Editing existing todos
 * - Marking todos as complete/active
 * - Filtering by status
 * - Clearing completed todos
 */
export const todosMachine = setup({
  types: {
    context: {} as TodosContext,
    events: {} as TodosEvent,
  },
}).createMachine({
  id: "todos",
  context: {
    todo: "",
    todos: [
      {
        id: "1",
        title: "Learn state machines",
        completed: false,
      },
    ],
    filter: "all",
  },
  on: {
    "newTodo.change": {
      actions: assign(({ event }) => ({
        todo: event.value,
      })),
    },
    "newTodo.commit": {
      guard: ({ event }) => event.value.trim().length > 0,
      actions: assign(({ context, event }) => {
        const newTodo: TodoItem = {
          id: generateId(),
          title: event.value,
          completed: false,
        }
        return {
          todo: "",
          todos: [...context.todos, newTodo],
        }
      }),
    },
    "todo.commit": {
      actions: assign(({ context, event }) => {
        const { todo: todoToUpdate } = event

        if (!todoToUpdate.title.trim().length) {
          return {
            todos: context.todos.filter((todo) => todo.id !== todoToUpdate.id),
          }
        }

        return {
          todos: context.todos.map((todo) =>
            todo.id === todoToUpdate.id ? todoToUpdate : todo
          ),
        }
      }),
    },
    "todo.delete": {
      actions: assign(({ context, event }) => ({
        todos: context.todos.filter((todo) => todo.id !== event.id),
      })),
    },
    "filter.change": {
      actions: assign(({ event }) => ({
        filter: event.filter,
      })),
    },
    "todo.mark": {
      actions: assign(({ context, event }) => ({
        todos: context.todos.map((todo) =>
          todo.id === event.id
            ? { ...todo, completed: event.mark === "completed" }
            : todo
        ),
      })),
    },
    "todo.markAll": {
      actions: assign(({ context, event }) => ({
        todos: context.todos.map((todo) => ({
          ...todo,
          completed: event.mark === "completed",
        })),
      })),
    },
    "todos.clearCompleted": {
      actions: assign(({ context }) => ({
        todos: context.todos.filter((todo) => !todo.completed),
      })),
    },
  },
})
