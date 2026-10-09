import { describe, expect, it, vi } from "@effect/vitest"
import { Effect, Exit } from "effect"
import { createMachine, createActor, StateValue, toEffect } from "../../src/index.js";
import { assign } from "../../src/index.js";
import { raise } from "../../src/index.js";
import { trackEntries } from "./trackEntries.js";
import { testMultiTransition } from "./utils.js";

const composerMachine = createMachine({
  initial: 'ReadOnly',
  states: {
    ReadOnly: {
      id: 'ReadOnly',
      initial: 'StructureEdit',
      entry: ['selectNone'],
      states: {
        StructureEdit: {
          id: 'StructureEditRO',
          type: 'parallel',
          on: {
            switchToProjectManagement: [
              {
                target: 'ProjectManagement'
              }
            ]
          },
          states: {
            SelectionStatus: {
              initial: 'SelectedNone',
              on: {
                singleClickActivity: [
                  {
                    target: '.SelectedActivity',
                    actions: ['selectActivity']
                  }
                ],
                singleClickLink: [
                  {
                    target: '.SelectedLink',
                    actions: ['selectLink']
                  }
                ]
              },
              states: {
                SelectedNone: {
                  entry: ['redraw']
                },
                SelectedActivity: {
                  entry: ['redraw'],
                  on: {
                    singleClickCanvas: [
                      {
                        target: 'SelectedNone',
                        actions: ['selectNone']
                      }
                    ]
                  }
                },
                SelectedLink: {
                  entry: ['redraw'],
                  on: {
                    singleClickCanvas: [
                      {
                        target: 'SelectedNone',
                        actions: ['selectNone']
                      }
                    ]
                  }
                }
              }
            },
            ClipboardStatus: {
              initial: 'Empty',
              states: {
                Empty: {
                  entry: ['emptyClipboard'],
                  on: {
                    cutInClipboardSuccess: [
                      {
                        target: 'FilledByCut'
                      }
                    ],
                    copyInClipboardSuccess: [
                      {
                        target: 'FilledByCopy'
                      }
                    ]
                  }
                },
                FilledByCopy: {
                  on: {
                    cutInClipboardSuccess: [
                      {
                        target: 'FilledByCut'
                      }
                    ],
                    copyInClipboardSuccess: [
                      {
                        target: 'FilledByCopy'
                      }
                    ],
                    pasteFromClipboardSuccess: [
                      {
                        target: 'FilledByCopy'
                      }
                    ]
                  }
                },
                FilledByCut: {
                  on: {
                    cutInClipboardSuccess: [
                      {
                        target: 'FilledByCut'
                      }
                    ],
                    copyInClipboardSuccess: [
                      {
                        target: 'FilledByCopy'
                      }
                    ],
                    pasteFromClipboardSuccess: [
                      {
                        target: 'Empty'
                      }
                    ]
                  }
                }
              }
            }
          }
        },
        ProjectManagement: {
          id: 'ProjectManagementRO',
          type: 'parallel',
          on: {
            switchToStructureEdit: [
              {
                target: 'StructureEdit'
              }
            ]
          },
          states: {
            SelectionStatus: {
              initial: 'SelectedNone',
              on: {
                singleClickActivity: [
                  {
                    target: '.SelectedActivity',
                    actions: ['selectActivity']
                  }
                ],
                singleClickLink: [
                  {
                    target: '.SelectedLink',
                    actions: ['selectLink']
                  }
                ]
              },
              states: {
                SelectedNone: {
                  entry: ['redraw']
                },
                SelectedActivity: {
                  entry: ['redraw'],
                  on: {
                    singleClickCanvas: [
                      {
                        target: 'SelectedNone',
                        actions: ['selectNone']
                      }
                    ]
                  }
                },
                SelectedLink: {
                  entry: ['redraw'],
                  on: {
                    singleClickCanvas: [
                      {
                        target: 'SelectedNone',
                        actions: ['selectNone']
                      }
                    ]
                  }
                }
              }
            }
          }
        }
      }
    }
  }
});

const wakMachine = createMachine({
  id: 'wakMachine',
  type: 'parallel',

  states: {
    wak1: {
      initial: 'wak1sonA',
      states: {
        wak1sonA: {
          entry: 'wak1sonAenter',
          exit: 'wak1sonAexit'
        },
        wak1sonB: {
          entry: 'wak1sonBenter',
          exit: 'wak1sonBexit'
        }
      },
      on: {
        WAK1: '.wak1sonB'
      },
      entry: 'wak1enter',
      exit: 'wak1exit'
    },
    wak2: {
      initial: 'wak2sonA',
      states: {
        wak2sonA: {
          entry: 'wak2sonAenter',
          exit: 'wak2sonAexit'
        },
        wak2sonB: {
          entry: 'wak2sonBenter',
          exit: 'wak2sonBexit'
        }
      },
      on: {
        WAK2: '.wak2sonB'
      },
      entry: 'wak2enter',
      exit: 'wak2exit'
    }
  }
});

const wordMachine = createMachine({
  id: 'word',
  type: 'parallel',
  states: {
    bold: {
      initial: 'off',
      states: {
        on: {
          on: { TOGGLE_BOLD: 'off' }
        },
        off: {
          on: { TOGGLE_BOLD: 'on' }
        }
      }
    },
    underline: {
      initial: 'off',
      states: {
        on: {
          on: { TOGGLE_UNDERLINE: 'off' }
        },
        off: {
          on: { TOGGLE_UNDERLINE: 'on' }
        }
      }
    },
    italics: {
      initial: 'off',
      states: {
        on: {
          on: { TOGGLE_ITALICS: 'off' }
        },
        off: {
          on: { TOGGLE_ITALICS: 'on' }
        }
      }
    },
    list: {
      initial: 'none',
      states: {
        none: {
          on: { BULLETS: 'bullets', NUMBERS: 'numbers' }
        },
        bullets: {
          on: { NONE: 'none', NUMBERS: 'numbers' }
        },
        numbers: {
          on: { BULLETS: 'bullets', NONE: 'none' }
        }
      }
    }
  },
  on: {
    RESET: '#word' // TODO: this should be 'word' or [{ internal: false }]
  }
});

const flatParallelMachine = createMachine({
  type: 'parallel',
  states: {
    foo: {},
    bar: {},
    baz: {
      initial: 'one',
      states: {
        one: { on: { E: 'two' } },
        two: {}
      }
    }
  }
});

const raisingParallelMachine = createMachine({
  type: 'parallel',
  states: {
    OUTER1: {
      initial: 'C',
      states: {
        A: {
          entry: [raise({ type: 'TURN_OFF' })],
          on: {
            EVENT_OUTER1_B: 'B',
            EVENT_OUTER1_C: 'C'
          }
        },
        B: {
          entry: [raise({ type: 'TURN_ON' })],
          on: {
            EVENT_OUTER1_A: 'A',
            EVENT_OUTER1_C: 'C'
          }
        },
        C: {
          entry: [raise({ type: 'CLEAR' })],
          on: {
            EVENT_OUTER1_A: 'A',
            EVENT_OUTER1_B: 'B'
          }
        }
      }
    },
    OUTER2: {
      type: 'parallel',
      states: {
        INNER1: {
          initial: 'ON',
          states: {
            OFF: {
              on: {
                TURN_ON: 'ON'
              }
            },
            ON: {
              on: {
                CLEAR: 'OFF'
              }
            }
          }
        },
        INNER2: {
          initial: 'OFF',
          states: {
            OFF: {
              on: {
                TURN_ON: 'ON'
              }
            },
            ON: {
              on: {
                TURN_OFF: 'OFF'
              }
            }
          }
        }
      }
    }
  }
});

const nestedParallelState = createMachine({
  type: 'parallel',
  states: {
    OUTER1: {
      initial: 'STATE_OFF',
      states: {
        STATE_OFF: {
          on: {
            EVENT_COMPLEX: 'STATE_ON',
            EVENT_SIMPLE: 'STATE_ON'
          }
        },
        STATE_ON: {
          type: 'parallel',
          states: {
            STATE_NTJ0: {
              initial: 'STATE_IDLE_0',
              states: {
                STATE_IDLE_0: {
                  on: {
                    EVENT_STATE_NTJ0_WORK: 'STATE_WORKING_0'
                  }
                },
                STATE_WORKING_0: {
                  on: {
                    EVENT_STATE_NTJ0_IDLE: 'STATE_IDLE_0'
                  }
                }
              }
            },
            STATE_NTJ1: {
              initial: 'STATE_IDLE_1',
              states: {
                STATE_IDLE_1: {
                  on: {
                    EVENT_STATE_NTJ1_WORK: 'STATE_WORKING_1'
                  }
                },
                STATE_WORKING_1: {
                  on: {
                    EVENT_STATE_NTJ1_IDLE: 'STATE_IDLE_1'
                  }
                }
              }
            }
          }
        }
      }
    },
    OUTER2: {
      initial: 'STATE_OFF',
      states: {
        STATE_OFF: {
          on: {
            EVENT_COMPLEX: 'STATE_ON_COMPLEX',
            EVENT_SIMPLE: 'STATE_ON_SIMPLE'
          }
        },
        STATE_ON_SIMPLE: {},
        STATE_ON_COMPLEX: {
          type: 'parallel',
          states: {
            STATE_INNER1: {
              initial: 'STATE_OFF',
              states: {
                STATE_OFF: {},
                STATE_ON: {}
              }
            },
            STATE_INNER2: {
              initial: 'STATE_OFF',
              states: {
                STATE_OFF: {},
                STATE_ON: {}
              }
            }
          }
        }
      }
    }
  }
});

const deepFlatParallelMachine = createMachine({
  type: 'parallel',
  states: {
    X: {},
    V: {
      initial: 'A',
      on: {
        a: {
          target: 'V.A'
        },
        b: {
          target: 'V.B'
        },
        c: {
          target: 'V.C'
        }
      },
      states: {
        A: {},
        B: {
          initial: 'BB',
          states: {
            BB: {
              type: 'parallel',
              states: {
                BBB_A: {},
                BBB_B: {}
              }
            }
          }
        },
        C: {}
      }
    }
  }
});

describe('parallel states', () => {
  // upstream: test/parallel.test.ts > parallel states > should have initial parallel states
  it.effect('should have initial parallel states', () => Effect.gen(function* () {
    const initialState = (yield* (yield* createActor(wordMachine)).getSnapshot);

    expect(initialState.value).toEqual({
      bold: 'off',
      italics: 'off',
      underline: 'off',
      list: 'none'
    });
  }));

  const expected: Record<string, Record<string, StateValue>> = {
    '{"bold": "off"}': {
      TOGGLE_BOLD: {
        bold: 'on',
        italics: 'off',
        underline: 'off',
        list: 'none'
      }
    },
    '{"bold": "on"}': {
      TOGGLE_BOLD: {
        bold: 'off',
        italics: 'off',
        underline: 'off',
        list: 'none'
      }
    },
    [JSON.stringify({
      bold: 'off',
      italics: 'off',
      underline: 'on',
      list: 'bullets'
    })]: {
      'TOGGLE_BOLD, TOGGLE_ITALICS': {
        bold: 'on',
        italics: 'on',
        underline: 'on',
        list: 'bullets'
      },
      RESET: {
        bold: 'off',
        italics: 'off',
        underline: 'off',
        list: 'none'
      }
    }
  };

  Object.keys(expected).forEach((fromState) => {
    Object.keys(expected[fromState]!).forEach((eventTypes) => {
      const toState = expected[fromState]![eventTypes];

      // upstream: test/parallel.test.ts > parallel states > should go from ${fromState} to ${JSON.stringify(toState)} on ${eventTypes}
      it.effect(`should go from ${fromState} to ${JSON.stringify(
        toState
      )} on ${eventTypes}`, () => Effect.gen(function* () {
        const resultState = (yield* testMultiTransition(
          wordMachine,
          fromState,
          eventTypes
        ));

        expect(resultState.value).toEqual(toState);
      }));
    });
  });

  // upstream: test/parallel.test.ts > parallel states > should have all parallel states represented in the state value
  it.effect('should have all parallel states represented in the state value', () => Effect.gen(function* () {
    const machine = createMachine({
      type: 'parallel',
      states: {
        wak1: {
          initial: 'wak1sonA',
          states: {
            wak1sonA: {},
            wak1sonB: {}
          },
          on: {
            WAK1: '.wak1sonB'
          }
        },
        wak2: {
          initial: 'wak2sonA',
          states: {
            wak2sonA: {}
          }
        }
      }
    });
    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'WAK1' }));

    expect((yield* actorRef.getSnapshot).value).toEqual({
      wak1: 'wak1sonB',
      wak2: 'wak2sonA'
    });
  }));

  // upstream: test/parallel.test.ts > parallel states > should have all parallel states represented in the state value (2)
  it.effect('should have all parallel states represented in the state value (2)', () => Effect.gen(function* () {
    const actorRef = (yield* Effect.tap(createActor(wakMachine), (a) => a.start));
    (yield* actorRef.send({ type: 'WAK2' }));

    expect((yield* actorRef.getSnapshot).value).toEqual({
      wak1: 'wak1sonA',
      wak2: 'wak2sonB'
    });
  }));

  // upstream: test/parallel.test.ts > parallel states > should work with regions without states #1
  it.effect('should work with regions without states', () => Effect.gen(function* () {
    expect((yield* (yield* createActor(flatParallelMachine)).getSnapshot).value).toEqual({
      foo: {},
      bar: {},
      baz: 'one'
    });
  }));

  // upstream: test/parallel.test.ts > parallel states > should work with regions without states #2
  it.effect('should work with regions without states', () => Effect.gen(function* () {
    const actorRef = (yield* Effect.tap(createActor(flatParallelMachine), (a) => a.start));
    (yield* actorRef.send({ type: 'E' }));
    expect((yield* actorRef.getSnapshot).value).toEqual({
      foo: {},
      bar: {},
      baz: 'two'
    });
  }));

  // upstream: test/parallel.test.ts > parallel states > should properly transition to relative substate
  it.effect('should properly transition to relative substate', () => Effect.gen(function* () {
    const actorRef = (yield* Effect.tap(createActor(composerMachine), (a) => a.start));
    (yield* actorRef.send({
      type: 'singleClickActivity'
    }));

    expect((yield* actorRef.getSnapshot).value).toEqual({
      ReadOnly: {
        StructureEdit: {
          SelectionStatus: 'SelectedActivity',
          ClipboardStatus: 'Empty'
        }
      }
    });
  }));

  // upstream: test/parallel.test.ts > parallel states > should properly transition according to entry events on an initial state
  it.effect('should properly transition according to entry events on an initial state', () => Effect.gen(function* () {
    const machine = createMachine({
      type: 'parallel',
      states: {
        OUTER1: {
          initial: 'B',
          states: {
            A: {},
            B: {
              entry: raise({ type: 'CLEAR' })
            }
          }
        },
        OUTER2: {
          type: 'parallel',
          states: {
            INNER1: {
              initial: 'ON',
              states: {
                OFF: {},
                ON: {
                  on: {
                    CLEAR: 'OFF'
                  }
                }
              }
            },
            INNER2: {
              initial: 'OFF',
              states: {
                OFF: {},
                ON: {}
              }
            }
          }
        }
      }
    });
    expect((yield* (yield* createActor(machine)).getSnapshot).value).toEqual({
      OUTER1: 'B',
      OUTER2: {
        INNER1: 'OFF',
        INNER2: 'OFF'
      }
    });
  }));

  // upstream: test/parallel.test.ts > parallel states > should properly transition when raising events for a parallel state
  it.effect('should properly transition when raising events for a parallel state', () => Effect.gen(function* () {
    const actorRef = (yield* Effect.tap(createActor(raisingParallelMachine), (a) => a.start));
    (yield* actorRef.send({
      type: 'EVENT_OUTER1_B'
    }));

    expect((yield* actorRef.getSnapshot).value).toEqual({
      OUTER1: 'B',
      OUTER2: {
        INNER1: 'ON',
        INNER2: 'ON'
      }
    });
  }));

  // upstream: test/parallel.test.ts > parallel states > should handle simultaneous orthogonal transitions
  it.effect('should handle simultaneous orthogonal transitions', () => Effect.gen(function* () {
    type Events = { type: 'CHANGE'; value: string } | { type: 'SAVE' };
    const simultaneousMachine = createMachine({
      types: {} as { context: { value: string }; events: Events },
      id: 'yamlEditor',
      type: 'parallel',
      context: {
        value: ''
      },
      states: {
        editing: {
          on: {
            CHANGE: {
              actions: assign({
                value: ({ event }) => event.value
              })
            }
          }
        },
        status: {
          initial: 'unsaved',
          states: {
            unsaved: {
              on: {
                SAVE: {
                  target: 'saved',
                  actions: 'save'
                }
              }
            },
            saved: {
              on: {
                CHANGE: 'unsaved'
              }
            }
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(simultaneousMachine), (a) => a.start));
    (yield* actorRef.send({
      type: 'SAVE'
    }));
    (yield* actorRef.send({
      type: 'CHANGE',
      value: 'something'
    }));

    expect((yield* actorRef.getSnapshot).value).toEqual({
      editing: {},
      status: 'unsaved'
    });

    expect((yield* actorRef.getSnapshot).context).toEqual({
      value: 'something'
    });
  }));

  // upstream: test/parallel.test.ts > parallel states > should execute actions of the initial transition of a parallel region when entering the initial state nodes of a machine
  it.effect('should execute actions of the initial transition of a parallel region when entering the initial state nodes of a machine', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine({
      type: 'parallel',
      states: {
        a: {
          initial: {
            target: 'a1',
            actions: spy
          },
          states: {
            a1: {}
          }
        }
      }
    });

    (yield* Effect.tap(createActor(machine), (a) => a.start));

    expect(spy).toHaveBeenCalledTimes(1);
  }));

  // upstream: test/parallel.test.ts > parallel states > should execute actions of the initial transition of a parallel region when the parallel state is targeted with an explicit transition
  it.effect('should execute actions of the initial transition of a parallel region when the parallel state is targeted with an explicit transition', () => Effect.gen(function* () {
    const spy = vi.fn();

    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          on: {
            NEXT: 'b'
          }
        },
        b: {
          type: 'parallel',
          states: {
            c: {
              initial: {
                target: 'c1',
                actions: spy
              },
              states: {
                c1: {}
              }
            }
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'NEXT' }));

    expect(spy).toHaveBeenCalledTimes(1);
  }));

  describe('transitions with nested parallel states', () => {
    // upstream: test/parallel.test.ts > parallel states > transitions with nested parallel states > should properly transition when in a simple nested state
    it.effect('should properly transition when in a simple nested state', () => Effect.gen(function* () {
      const actorRef = (yield* Effect.tap(createActor(nestedParallelState), (a) => a.start));
      (yield* actorRef.send({
        type: 'EVENT_SIMPLE'
      }));
      (yield* actorRef.send({
        type: 'EVENT_STATE_NTJ0_WORK'
      }));

      expect((yield* actorRef.getSnapshot).value).toEqual({
        OUTER1: {
          STATE_ON: {
            STATE_NTJ0: 'STATE_WORKING_0',
            STATE_NTJ1: 'STATE_IDLE_1'
          }
        },
        OUTER2: 'STATE_ON_SIMPLE'
      });
    }));

    // upstream: test/parallel.test.ts > parallel states > transitions with nested parallel states > should properly transition when in a complex nested state
    it.effect('should properly transition when in a complex nested state', () => Effect.gen(function* () {
      const actorRef = (yield* Effect.tap(createActor(nestedParallelState), (a) => a.start));
      (yield* actorRef.send({
        type: 'EVENT_COMPLEX'
      }));
      (yield* actorRef.send({
        type: 'EVENT_STATE_NTJ0_WORK'
      }));

      expect((yield* actorRef.getSnapshot).value).toEqual({
        OUTER1: {
          STATE_ON: {
            STATE_NTJ0: 'STATE_WORKING_0',
            STATE_NTJ1: 'STATE_IDLE_1'
          }
        },
        OUTER2: {
          STATE_ON_COMPLEX: {
            STATE_INNER1: 'STATE_OFF',
            STATE_INNER2: 'STATE_OFF'
          }
        }
      });
    }));
  });

  // https://github.com/statelyai/xstate/issues/191
  describe('nested flat parallel states', () => {
    const machine = createMachine({
      initial: 'A',
      states: {
        A: {
          on: {
            'to-B': 'B'
          }
        },
        B: {
          type: 'parallel',
          states: {
            C: {},
            D: {}
          }
        }
      },
      on: {
        'to-A': '.A'
      }
    });

    // upstream: test/parallel.test.ts > parallel states > nested flat parallel states > should represent the flat nested parallel states in the state value
    it.effect('should represent the flat nested parallel states in the state value', () => Effect.gen(function* () {
      const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
      (yield* actorRef.send({
        type: 'to-B'
      }));

      expect((yield* actorRef.getSnapshot).value).toEqual({
        B: {
          C: {},
          D: {}
        }
      });
    }));
  });

  describe('deep flat parallel states', () => {
    // upstream: test/parallel.test.ts > parallel states > deep flat parallel states > should properly evaluate deep flat parallel states
    it.effect('should properly evaluate deep flat parallel states', () => Effect.gen(function* () {
      const actorRef = (yield* Effect.tap(createActor(deepFlatParallelMachine), (a) => a.start));

      (yield* actorRef.send({ type: 'a' }));
      (yield* actorRef.send({ type: 'c' }));
      (yield* actorRef.send({ type: 'b' }));

      expect((yield* actorRef.getSnapshot).value).toEqual({
        V: {
          B: {
            BB: {
              BBB_A: {},
              BBB_B: {}
            }
          }
        },
        X: {}
      });
    }));

    // upstream: test/parallel.test.ts > parallel states > deep flat parallel states > should not overlap resolved state nodes in state resolution
    it.effect('should not overlap resolved state nodes in state resolution', () => Effect.gen(function* () {
      const machine = createMachine({
        id: 'pipeline',
        type: 'parallel',
        states: {
          foo: {
            on: {
              UPDATE: {
                actions: () => {
                  /* do nothing */
                }
              }
            }
          },
          bar: {
            on: {
              UPDATE: '.baz'
            },
            initial: 'idle',
            states: {
              idle: {},
              baz: {}
            }
          }
        }
      });

      const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
      // upstream asserts that the send does not throw; in Effect form a failure in the
      // transition would fail the send or set status 'error' (SD-4)
      const exit = yield* Effect.exit(
        actorRef.send({
          type: 'UPDATE'
        })
      );
      expect(Exit.isSuccess(exit)).toBe(true);
      expect((yield* actorRef.getSnapshot).status).toBe('active');
    }));
  });

  describe('other', () => {
    // https://github.com/statelyai/xstate/issues/518
    // upstream: test/parallel.test.ts > parallel states > other > regions should be able to transition to orthogonal regions
    it.effect('regions should be able to transition to orthogonal regions', () => Effect.gen(function* () {
      const testMachine = createMachine({
        type: 'parallel',
        states: {
          Pages: {
            initial: 'About',
            states: {
              About: {
                id: 'About'
              },
              Dashboard: {
                id: 'Dashboard'
              }
            }
          },
          Menu: {
            initial: 'Closed',
            states: {
              Closed: {
                id: 'Closed',
                on: {
                  toggle: '#Opened'
                }
              },
              Opened: {
                id: 'Opened',
                on: {
                  toggle: '#Closed',
                  'go to dashboard': {
                    target: ['#Dashboard', '#Opened']
                  }
                }
              }
            }
          }
        }
      });

      const actorRef = (yield* Effect.tap(createActor(testMachine), (a) => a.start));

      (yield* actorRef.send({ type: 'toggle' }));
      (yield* actorRef.send({ type: 'go to dashboard' }));

      expect(
        (yield* actorRef.getSnapshot).matches({ Menu: 'Opened', Pages: 'Dashboard' })
      ).toBe(true);
    }));

    // https://github.com/statelyai/xstate/issues/531
    // upstream: test/parallel.test.ts > parallel states > other > should calculate the entry set for reentering transitions in parallel states
    it.effect('should calculate the entry set for reentering transitions in parallel states', () => Effect.gen(function* () {
      const testMachine = createMachine({
        types: {} as { context: { log: string[] } },
        id: 'test',
        context: { log: [] },
        type: 'parallel',
        states: {
          foo: {
            initial: 'foobar',
            states: {
              foobar: {
                on: {
                  GOTO_FOOBAZ: 'foobaz'
                }
              },
              foobaz: {
                entry: assign({
                  log: ({ context }) => [...context.log, 'entered foobaz']
                }),
                on: {
                  GOTO_FOOBAZ: {
                    target: 'foobaz',
                    reenter: true
                  }
                }
              }
            }
          },
          bar: {}
        }
      });

      const actorRef = (yield* Effect.tap(createActor(testMachine), (a) => a.start));

      (yield* actorRef.send({
        type: 'GOTO_FOOBAZ'
      }));
      (yield* actorRef.send({
        type: 'GOTO_FOOBAZ'
      }));

      expect((yield* actorRef.getSnapshot).context.log.length).toBe(2);
    }));
  });

  // upstream: test/parallel.test.ts > parallel states > should raise a "xstate.done.state.*" event when all child states reach final state
  it.effect('should raise a "xstate.done.state.*" event when all child states reach final state', () => Effect.gen(function* () {
    const machine = createMachine({
      id: 'test',
      initial: 'p',
      states: {
        p: {
          type: 'parallel',
          states: {
            a: {
              initial: 'idle',
              states: {
                idle: {
                  on: {
                    FINISH: 'finished'
                  }
                },
                finished: {
                  type: 'final'
                }
              }
            },
            b: {
              initial: 'idle',
              states: {
                idle: {
                  on: {
                    FINISH: 'finished'
                  }
                },
                finished: {
                  type: 'final'
                }
              }
            },
            c: {
              initial: 'idle',
              states: {
                idle: {
                  on: {
                    FINISH: 'finished'
                  }
                },
                finished: {
                  type: 'final'
                }
              }
            }
          },
          onDone: 'success'
        },
        success: {
          type: 'final'
        }
      }
    });

    const service = (yield* createActor(machine));
    (yield* service.start);

    (yield* service.send({ type: 'FINISH' }));

    // upstream resolves on the observer's `complete`; toEffect waits for the actor to
    // finish (SD-19) and fails if it errors instead
    yield* toEffect(service);
  }));

  // upstream: test/parallel.test.ts > parallel states > should raise a "xstate.done.state.*" event when a pseudostate of a history type is directly on a parallel state
  it.effect('should raise a "xstate.done.state.*" event when a pseudostate of a history type is directly on a parallel state', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'parallelSteps',
      states: {
        parallelSteps: {
          type: 'parallel',
          states: {
            hist: {
              type: 'history'
            },
            one: {
              initial: 'wait_one',
              states: {
                wait_one: {
                  on: {
                    finish_one: {
                      target: 'done'
                    }
                  }
                },
                done: {
                  type: 'final'
                }
              }
            },
            two: {
              initial: 'wait_two',
              states: {
                wait_two: {
                  on: {
                    finish_two: {
                      target: 'done'
                    }
                  }
                },
                done: {
                  type: 'final'
                }
              }
            }
          },
          onDone: 'finished'
        },
        finished: {}
      }
    });

    const service = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* service.send({ type: 'finish_one' }));
    (yield* service.send({ type: 'finish_two' }));

    expect((yield* service.getSnapshot).value).toBe('finished');
  }));

  // upstream: test/parallel.test.ts > parallel states > source parallel region should be reentered when a transition within it targets another parallel region (parallel root)
  it.effect('source parallel region should be reentered when a transition within it targets another parallel region (parallel root)', () => Effect.gen(function* () {
    const machine = createMachine({
      type: 'parallel',
      states: {
        Operation: {
          initial: 'Waiting',
          states: {
            Waiting: {
              on: {
                TOGGLE_MODE: {
                  target: '#Demo'
                }
              }
            },
            Fetching: {}
          }
        },
        Mode: {
          initial: 'Normal',
          states: {
            Normal: {},
            Demo: {
              id: 'Demo'
            }
          }
        }
      }
    });

    const flushTracked = trackEntries(machine);

    const actor = (yield* createActor(machine));
    (yield* actor.start);
    flushTracked();

    (yield* actor.send({ type: 'TOGGLE_MODE' }));

    expect(flushTracked()).toEqual([
      'exit: Mode.Normal',
      'exit: Mode',
      'exit: Operation.Waiting',
      'exit: Operation',
      'enter: Operation',
      'enter: Operation.Waiting',
      'enter: Mode',
      'enter: Mode.Demo'
    ]);
  }));

  // upstream: test/parallel.test.ts > parallel states > source parallel region should be reentered when a transition within it targets another parallel region (nested parallel)
  it.effect('source parallel region should be reentered when a transition within it targets another parallel region (nested parallel)', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          type: 'parallel',
          states: {
            Operation: {
              initial: 'Waiting',
              states: {
                Waiting: {
                  on: {
                    TOGGLE_MODE: {
                      target: '#Demo'
                    }
                  }
                },
                Fetching: {}
              }
            },
            Mode: {
              initial: 'Normal',
              states: {
                Normal: {},
                Demo: {
                  id: 'Demo'
                }
              }
            }
          }
        }
      }
    });

    const flushTracked = trackEntries(machine);

    const actor = (yield* createActor(machine));
    (yield* actor.start);
    flushTracked();

    (yield* actor.send({ type: 'TOGGLE_MODE' }));

    expect(flushTracked()).toEqual([
      'exit: a.Mode.Normal',
      'exit: a.Mode',
      'exit: a.Operation.Waiting',
      'exit: a.Operation',
      'enter: a.Operation',
      'enter: a.Operation.Waiting',
      'enter: a.Mode',
      'enter: a.Mode.Demo'
    ]);
  }));

  // upstream: test/parallel.test.ts > parallel states > targetless transition on a parallel state should not enter nor exit any states
  it.effect('targetless transition on a parallel state should not enter nor exit any states', () => Effect.gen(function* () {
    const machine = createMachine({
      id: 'test',
      type: 'parallel',
      states: {
        first: {
          initial: 'disabled',
          states: {
            disabled: {},
            enabled: {}
          }
        },
        second: {}
      },
      on: {
        MY_EVENT: {
          actions: () => {}
        }
      }
    });

    const flushTracked = trackEntries(machine);

    const actor = (yield* createActor(machine));
    (yield* actor.start);
    flushTracked();

    (yield* actor.send({ type: 'MY_EVENT' }));

    expect(flushTracked()).toEqual([]);
  }));

  // upstream: test/parallel.test.ts > parallel states > targetless transition in one of the parallel regions should not enter nor exit any states
  it.effect('targetless transition in one of the parallel regions should not enter nor exit any states', () => Effect.gen(function* () {
    const machine = createMachine({
      id: 'test',
      type: 'parallel',
      states: {
        first: {
          initial: 'disabled',
          states: {
            disabled: {},
            enabled: {}
          },
          on: {
            MY_EVENT: {
              actions: () => {}
            }
          }
        },
        second: {}
      }
    });

    const flushTracked = trackEntries(machine);

    const actor = (yield* createActor(machine));
    (yield* actor.start);
    flushTracked();

    (yield* actor.send({ type: 'MY_EVENT' }));

    expect(flushTracked()).toEqual([]);
  }));
});
