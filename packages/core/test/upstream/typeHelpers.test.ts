import { describe, it } from "@effect/vitest"
import { Effect } from "effect"
import {
  ActorLogic,
  ActorRefFrom,
  ContextFrom,
  EventFrom,
  MachineImplementationsFrom,
  Snapshot,
  SnapshotFrom,
  StateValueFrom,
  TagsFrom,
  assign,
  createActor,
  createMachine,
  makeActorLogic
} from "../../src/index.js";

describe('ContextFrom', () => {
  // upstream: test/typeHelpers.test.ts > ContextFrom > should return context of a machine
  it.effect('should return context of a machine', () => Effect.gen(function* () {
    const machine = createMachine({
      types: {
        context: {} as { counter: number }
      },
      context: {
        counter: 0
      }
    });

    type MachineContext = ContextFrom<typeof machine>;

    const acceptMachineContext = (_event: MachineContext) => {};

    acceptMachineContext({ counter: 100 });
    acceptMachineContext({
      counter: 100,
      // @ts-expect-error
      other: 'unknown'
    });
    const obj = { completely: 'invalid' };
    // @ts-expect-error
    acceptMachineContext(obj);
  }));
});

describe('EventFrom', () => {
  // upstream: test/typeHelpers.test.ts > EventFrom > should return events for a machine
  it.effect('should return events for a machine', () => Effect.gen(function* () {
    const machine = createMachine({
      types: {
        events: {} as
          | { type: 'UPDATE_NAME'; value: string }
          | { type: 'UPDATE_AGE'; value: number }
          | { type: 'ANOTHER_EVENT' }
      }
    });

    type MachineEvent = EventFrom<typeof machine>;

    const acceptMachineEvent = (_event: MachineEvent) => {};

    acceptMachineEvent({ type: 'UPDATE_NAME', value: 'test' });
    acceptMachineEvent({ type: 'UPDATE_AGE', value: 12 });
    acceptMachineEvent({ type: 'ANOTHER_EVENT' });
    acceptMachineEvent({
      // @ts-expect-error
      type: 'UNKNOWN_EVENT'
    });
  }));

  // upstream: test/typeHelpers.test.ts > EventFrom > should return events for an interpreter
  it.effect('should return events for an interpreter', () => Effect.gen(function* () {
    const machine = createMachine({
      types: {
        events: {} as
          | { type: 'UPDATE_NAME'; value: string }
          | { type: 'UPDATE_AGE'; value: number }
          | { type: 'ANOTHER_EVENT' }
      }
    });

    const service = (yield* createActor(machine));

    type InterpreterEvent = EventFrom<typeof service>;

    const acceptInterpreterEvent = (_event: InterpreterEvent) => {};

    acceptInterpreterEvent({ type: 'UPDATE_NAME', value: 'test' });
    acceptInterpreterEvent({ type: 'UPDATE_AGE', value: 12 });
    acceptInterpreterEvent({ type: 'ANOTHER_EVENT' });
    acceptInterpreterEvent({
      // @ts-expect-error
      type: 'UNKNOWN_EVENT'
    });
  }));
});

describe('MachineImplementationsFrom', () => {
  // upstream: test/typeHelpers.test.ts > MachineImplementationsFrom > should return implementations for a machine
  it.effect('should return implementations for a machine', () => Effect.gen(function* () {
    const machine = createMachine({
      context: {
        count: 100
      },
      types: {
        events: {} as { type: 'FOO' } | { type: 'BAR'; value: string }
      }
    });

    const acceptMachineImplementations = (
      _options: MachineImplementationsFrom<typeof machine>
    ) => {};

    acceptMachineImplementations({
      actions: {
        foo: () => {}
      }
    });
    acceptMachineImplementations({
      actions: {
        foo: assign(() => ({}))
      }
    });
    acceptMachineImplementations({
      actions: {
        foo: assign(({ context }) => {
          ((_accept: number) => {})(context.count);
          return {};
        })
      }
    });
    acceptMachineImplementations({
      actions: {
        foo: assign(({ event }) => {
          ((_accept: 'FOO' | 'BAR') => {})(event.type);
          return {};
        })
      }
    });
    // @ts-expect-error
    acceptMachineImplementations(100);
  }));
});

describe('StateValueFrom', () => {
  // upstream: test/typeHelpers.test.ts > StateValueFrom > should return any from a machine
  it.effect('should return any from a machine', () => Effect.gen(function* () {
    const machine = createMachine({});

    function matches(_value: StateValueFrom<typeof machine>) {}

    matches('just anything');
  }));
});

describe('SnapshotFrom', () => {
  // upstream: test/typeHelpers.test.ts > SnapshotFrom > should return state type from a service that has concrete event type
  it.effect('should return state type from a service that has concrete event type', () => Effect.gen(function* () {
    const service = (yield* createActor(
      createMachine({
        types: {
          events: {} as { type: 'FOO' }
        }
      })
    ));

    function acceptState(_state: SnapshotFrom<typeof service>) {}

    acceptState((yield* service.getSnapshot));
    // @ts-expect-error
    acceptState("isn't any");
  }));

  // upstream: test/typeHelpers.test.ts > SnapshotFrom > should return state from a machine without context
  it.effect('should return state from a machine without context', () => Effect.gen(function* () {
    const machine = createMachine({});

    function acceptState(_state: SnapshotFrom<typeof machine>) {}

    acceptState((yield* (yield* createActor(machine)).getSnapshot));
    // @ts-expect-error
    acceptState("isn't any");
  }));

  // upstream: test/typeHelpers.test.ts > SnapshotFrom > should return state from a machine with context
  it.effect('should return state from a machine with context', () => Effect.gen(function* () {
    const machine = createMachine({
      context: {
        counter: 0
      }
    });

    function acceptState(_state: SnapshotFrom<typeof machine>) {}

    acceptState((yield* (yield* createActor(machine)).getSnapshot));
    // @ts-expect-error
    acceptState("isn't any");
  }));
});

describe('ActorRefFrom', () => {
  // upstream: test/typeHelpers.test.ts > ActorRefFrom > should return `ActorRef` based on actor logic
  it.effect('should return `ActorRef` based on actor logic', () => Effect.gen(function* () {
    // Upstream writes the logic as an object whose methods return values. The port's logic
    // interface returns Effects and `makeActorLogic` builds it (SPEC context.md, API
    // patterns), with the snapshot type as its type argument and the snapshot from
    // `Snapshot.active()`, whose `output` and `error` are Options (D8)
    const logic: ActorLogic<Snapshot<undefined>, { type: 'TEST' }> = makeActorLogic<
      Snapshot<undefined>,
      { type: 'TEST' },
      unknown
    >({
      transition: (state) => Effect.succeed(state),
      getInitialSnapshot: () => Effect.succeed(Snapshot.active()),
      getPersistedSnapshot: (s) => Effect.succeed(s)
    });

    // `send` is an Effect (D6, SD-23): the helper returns it and the test runs it, so the
    // TEST event still reaches the started actor as upstream
    function acceptActorRef(actorRef: ActorRefFrom<typeof logic>) {
      return actorRef.send({ type: 'TEST' });
    }

    yield* acceptActorRef((yield* Effect.tap(createActor(logic), (a) => a.start)));
  }));
});

describe('tags', () => {
  // upstream: test/typeHelpers.test.ts > tags > derives string from StateMachine
  it.effect('derives string from StateMachine', () => Effect.gen(function* () {
    const machine = createMachine({});

    type Tags = TagsFrom<typeof machine>;

    const acceptTag = (_tag: Tags) => {};

    acceptTag('a');
    acceptTag('b');
    acceptTag('c');
    // d is a valid tag, as is any string
    acceptTag('d');
  }));
});
