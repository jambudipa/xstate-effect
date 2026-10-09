# How-to Guides

How-to guides are **task-oriented** recipes that guide you through accomplishing specific goals. Unlike tutorials, they assume you have basic knowledge and focus on solving real problems.

## Machine Configuration

- [Define Custom Types](./define-custom-types.md) - Set up context, events, and input types
- [Use Dynamic Context](./dynamic-context.md) - Initialize context from input or external data
- [Configure Delays](./configure-delays.md) - Set up delayed transitions and timeouts

## Actions

- [Update Context](./update-context.md) - Use assign to modify machine data
- [Execute Side Effects](./execute-side-effects.md) - Run effects during transitions
- [Send Events](./send-events.md) - Communicate between actors
- [Batch Multiple Actions](./batch-actions.md) - Execute actions atomically

## Guards

- [Conditional Transitions](./conditional-transitions.md) - Control flow with guards
- [Compose Guards](./compose-guards.md) - Combine guards with and/or/not
- [Access Event Data in Guards](./guard-event-data.md) - Validate event payloads

## Actors

- [Invoke Async Operations](./invoke-async.md) - Call APIs and handle responses
- [Spawn Dynamic Actors](./spawn-actors.md) - Create actors on-demand
- [Parent-Child Communication](./parent-child-communication.md) - Exchange events between actors
- [Handle Actor Errors](./handle-actor-errors.md) - Gracefully manage failures

## State Organization

- [Nested States](./nested-states.md) - Organize with hierarchical states
- [Parallel States](./parallel-states.md) - Model concurrent regions
- [History States](./history-states.md) - Remember previous states
- [Final States](./final-states.md) - Signal completion

## Testing

- [Test Transitions](./test-transitions.md) - Verify state changes
- [Test with Time](./test-with-time.md) - Control time in tests
- [Test Async Actors](./test-async-actors.md) - Test invoked services
- [Snapshot Testing](./snapshot-testing.md) - Assert on entire snapshots

## Integration

- [Use with Effect Services](./effect-services.md) - Access Effect services in actions
- [Persist Machine State](./persist-state.md) - Save and restore snapshots
- [Subscribe to Changes](./subscribe-to-changes.md) - React to state updates

## Patterns

- [Retry Failed Operations](./retry-pattern.md) - Implement retry logic
- [Debounce Events](./debounce-pattern.md) - Delay processing rapid events
- [State Machine Composition](./composition-pattern.md) - Combine multiple machines
