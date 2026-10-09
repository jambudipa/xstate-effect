# Store-Based Examples Not Ported

The following examples from the original XState repository cannot be directly ported to this Effect-based implementation because they use `@xstate/store`, which is a separate library from the core XState state machine library.

## Examples Using @xstate/store

### 1. store-counter-react
**Original location:** `/examples/store-counter-react`

Uses `@xstate/store` to create a simple counter store. This is a simpler reactive store pattern, not a full state machine.

```typescript
// Original uses:
import { createStore } from '@xstate/store';

const counterStore = createStore({
  context: { count: 0 },
  on: {
    increment: (context) => ({ count: context.count + 1 }),
    decrement: (context) => ({ count: context.count - 1 }),
  }
});
```

**Why it cannot be ported:** `@xstate/store` is a lightweight reactive store that doesn't use state machines. It's a different paradigm focused on simple state updates without states, transitions, or the other features of state machines.

### 2. store-tic-tac-toe
**Original location:** `/examples/store-tic-tac-toe`

Implements Tic-Tac-Toe using the store pattern instead of a state machine.

**Why it cannot be ported:** Same reason as above. However, we have ported the state machine version of Tic-Tac-Toe which is available in `tic-tac-toe.ts`.

### 3. local-store-counter-react
**Original location:** `/examples/local-store-counter-react`

A variant of the store counter that persists to localStorage.

**Why it cannot be ported:** Uses `@xstate/store` which is a separate library.

## Alternative

If you need store-like functionality, consider:

1. **Using a state machine** - Our implementation supports full state machines with context, which can model any store-like behavior.

2. **Effect's reactive primitives** - Since this is an Effect-based implementation, you can use Effect's built-in reactive primitives like `Ref` for simple state management.

3. **Simple counter example** - See `counter.ts` for a state machine approach to the counter pattern.

## Vue Examples

The Vue examples (`7guis-1-counter-vue`, `7guis-2-temperature-vue`) contain the same state machines as their React counterparts. We've ported the state machines which are framework-agnostic:

- `7guis-counter.ts` - Counter state machine
- `7guis-temperature.ts` - Temperature converter state machine
