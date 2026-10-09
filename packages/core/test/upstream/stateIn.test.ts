import { describe, expect, it, vi } from "@effect/vitest"
import { Effect } from "effect"
import { createMachine, createActor } from "../../src/index.js";
import { stateIn } from "../../src/index.js";

describe('transition "in" check', () => {
  // upstream: test/stateIn.test.ts > transition "in" check > should transition if string state path matches current state value
  it.effect('should transition if string state path matches current state value', () => Effect.gen(function* () {
    const machine = createMachine({
      type: 'parallel',
      states: {
        a: {
          initial: 'a1',
          states: {
            a1: {
              on: {
                EVENT2: {
                  target: 'a2',
                  guard: stateIn({ b: 'b2' })
                }
              }
            },
            a2: {
              id: 'a_a2'
            }
          }
        },
        b: {
          initial: 'b2',
          states: {
            b1: {
              on: {
                EVENT: {
                  target: 'b2',
                  guard: stateIn('#a_a2')
                }
              }
            },
            b2: {
              id: 'b_b2',
              type: 'parallel',
              states: {
                foo: {
                  initial: 'foo2',
                  states: {
                    foo1: {},
                    foo2: {}
                  }
                },
                bar: {
                  initial: 'bar1',
                  states: {
                    bar1: {
                      id: 'bar1'
                    },
                    bar2: {}
                  }
                }
              }
            }
          }
        }
      }
    });
    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'EVENT2' }));

    expect((yield* actorRef.getSnapshot).value).toEqual({
      a: 'a2',
      b: {
        b2: {
          foo: 'foo2',
          bar: 'bar1'
        }
      }
    });
  }));

  // upstream: test/stateIn.test.ts > transition "in" check > should transition if state node ID matches current state value
  it.effect('should transition if state node ID matches current state value', () => Effect.gen(function* () {
    const machine = createMachine({
      type: 'parallel',
      states: {
        a: {
          initial: 'a1',
          states: {
            a1: {
              on: {
                EVENT3: {
                  target: 'a2',
                  guard: stateIn('#b_b2')
                }
              }
            },
            a2: {
              id: 'a_a2'
            }
          }
        },
        b: {
          initial: 'b2',
          states: {
            b1: {},
            b2: {
              id: 'b_b2',
              type: 'parallel',
              states: {
                foo: {
                  initial: 'foo2',
                  states: {
                    foo1: {},
                    foo2: {}
                  }
                },
                bar: {
                  initial: 'bar1',
                  states: {
                    bar1: {
                      id: 'bar1'
                    },
                    bar2: {}
                  }
                }
              }
            }
          }
        }
      }
    });
    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'EVENT3' }));

    expect((yield* actorRef.getSnapshot).value).toEqual({
      a: 'a2',
      b: {
        b2: {
          foo: 'foo2',
          bar: 'bar1'
        }
      }
    });
  }));

  // upstream: test/stateIn.test.ts > transition "in" check > should not transition if string state path does not match current state value
  it.effect('should not transition if string state path does not match current state value', () => Effect.gen(function* () {
    const machine = createMachine({
      type: 'parallel',
      states: {
        a: {
          initial: 'a1',
          states: {
            a1: {
              on: {
                EVENT1: {
                  target: 'a2',
                  guard: stateIn('b.b2')
                }
              }
            },
            a2: {
              id: 'a_a2'
            }
          }
        },
        b: {
          initial: 'b1',
          states: {
            b1: {},
            b2: {
              id: 'b_b2',
              type: 'parallel',
              states: {
                foo: {
                  initial: 'foo1',
                  states: {
                    foo1: {},
                    foo2: {}
                  }
                },
                bar: {
                  initial: 'bar1',
                  states: {
                    bar1: {
                      id: 'bar1'
                    },
                    bar2: {}
                  }
                }
              }
            }
          }
        }
      }
    });
    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'EVENT1' }));

    expect((yield* actorRef.getSnapshot).value).toEqual({
      a: 'a1',
      b: 'b1'
    });
  }));

  // upstream: test/stateIn.test.ts > transition "in" check > should not transition if state value matches current state value
  it.effect('should not transition if state value matches current state value', () => Effect.gen(function* () {
    const machine = createMachine({
      type: 'parallel',
      states: {
        a: {
          initial: 'a1',
          states: {
            a1: {
              on: {
                EVENT2: {
                  target: 'a2',
                  guard: stateIn({ b: 'b2' })
                }
              }
            },
            a2: {
              id: 'a_a2'
            }
          }
        },
        b: {
          initial: 'b2',
          states: {
            b1: {},
            b2: {
              id: 'b_b2',
              type: 'parallel',
              states: {
                foo: {
                  initial: 'foo2',
                  states: {
                    foo1: {},
                    foo2: {}
                  }
                },
                bar: {
                  initial: 'bar1',
                  states: {
                    bar1: {
                      id: 'bar1'
                    },
                    bar2: {}
                  }
                }
              }
            }
          }
        }
      }
    });
    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'EVENT2' }));

    expect((yield* actorRef.getSnapshot).value).toEqual({
      a: 'a2',
      b: {
        b2: {
          foo: 'foo2',
          bar: 'bar1'
        }
      }
    });
  }));

  // upstream: test/stateIn.test.ts > transition "in" check > matching should be relative to grandparent (match)
  it.effect('matching should be relative to grandparent (match)', () => Effect.gen(function* () {
    const machine = createMachine({
      type: 'parallel',
      states: {
        a: {
          initial: 'a1',
          states: {
            a1: {},
            a2: {
              id: 'a_a2'
            }
          }
        },
        b: {
          initial: 'b2',
          states: {
            b1: {},
            b2: {
              id: 'b_b2',
              type: 'parallel',
              states: {
                foo: {
                  initial: 'foo1',
                  states: {
                    foo1: {
                      on: {
                        EVENT_DEEP: { target: 'foo2', guard: stateIn('#bar1') }
                      }
                    },
                    foo2: {}
                  }
                },
                bar: {
                  initial: 'bar1',
                  states: {
                    bar1: {
                      id: 'bar1'
                    },
                    bar2: {}
                  }
                }
              }
            }
          }
        }
      }
    });
    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'EVENT_DEEP' }));

    expect((yield* actorRef.getSnapshot).value).toEqual({
      a: 'a1',
      b: {
        b2: {
          foo: 'foo2',
          bar: 'bar1'
        }
      }
    });
  }));

  // upstream: test/stateIn.test.ts > transition "in" check > matching should be relative to grandparent (no match)
  it.effect('matching should be relative to grandparent (no match)', () => Effect.gen(function* () {
    const machine = createMachine({
      type: 'parallel',
      states: {
        a: {
          initial: 'a1',
          states: {
            a1: {},
            a2: {
              id: 'a_a2'
            }
          }
        },
        b: {
          initial: 'b2',
          states: {
            b1: {},
            b2: {
              id: 'b_b2',
              type: 'parallel',
              states: {
                foo: {
                  initial: 'foo1',
                  states: {
                    foo1: {
                      on: {
                        EVENT_DEEP: { target: 'foo2', guard: stateIn('#bar1') }
                      }
                    },
                    foo2: {}
                  }
                },
                bar: {
                  initial: 'bar2',
                  states: {
                    bar1: {
                      id: 'bar1'
                    },
                    bar2: {}
                  }
                }
              }
            }
          }
        }
      }
    });
    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actorRef.send({ type: 'EVENT_DEEP' }));

    expect((yield* actorRef.getSnapshot).value).toEqual({
      a: 'a1',
      b: {
        b2: {
          foo: 'foo1',
          bar: 'bar2'
        }
      }
    });
  }));

  // upstream: test/stateIn.test.ts > transition "in" check > should work to forbid events
  it.effect('should work to forbid events', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'green',
      states: {
        green: { on: { TIMER: 'yellow' } },
        yellow: { on: { TIMER: 'red' } },
        red: {
          initial: 'walk',
          states: {
            walk: {
              on: { TIMER: 'wait' }
            },
            wait: {
              on: { TIMER: 'stop' }
            },
            stop: {}
          },
          on: {
            TIMER: [
              {
                target: 'green',
                guard: stateIn({ red: 'stop' })
              }
            ]
          }
        }
      }
    });

    const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));

    (yield* actorRef.send({ type: 'TIMER' }));
    (yield* actorRef.send({ type: 'TIMER' }));
    (yield* actorRef.send({ type: 'TIMER' }));
    expect((yield* actorRef.getSnapshot).value).toEqual({ red: 'wait' });

    (yield* actorRef.send({ type: 'TIMER' }));
    expect((yield* actorRef.getSnapshot).value).toEqual({ red: 'stop' });

    (yield* actorRef.send({ type: 'TIMER' }));
    expect((yield* actorRef.getSnapshot).value).toEqual('green');
  }));

  // upstream: test/stateIn.test.ts > transition "in" check > should be possible to use a referenced `stateIn` guard
  it.effect('should be possible to use a referenced `stateIn` guard', () => Effect.gen(function* () {
    const machine = createMachine(
      {
        type: 'parallel',
        // machine definition,
        states: {
          selected: {},
          location: {
            initial: 'home',
            states: {
              home: {
                on: {
                  NEXT: {
                    target: 'success',
                    guard: 'hasSelection'
                  }
                }
              },
              success: {}
            }
          }
        }
      },
      {
        guards: {
          hasSelection: stateIn('selected')
        }
      }
    );

    const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
    (yield* actor.send({
      type: 'NEXT'
    }));
    expect((yield* actor.getSnapshot).value).toEqual({
      selected: {},
      location: 'success'
    });
  }));

  // upstream: test/stateIn.test.ts > transition "in" check > should be possible to check an ID with a path
  it.effect('should be possible to check an ID with a path', () => Effect.gen(function* () {
    const spy = vi.fn();
    const machine = createMachine({
      type: 'parallel',
      states: {
        A: {
          initial: 'A1',
          states: {
            A1: {
              on: {
                MY_EVENT: {
                  guard: stateIn('#b.B1'),
                  actions: spy
                }
              }
            }
          }
        },
        B: {
          id: 'b',
          initial: 'B1',
          states: {
            B1: {}
          }
        }
      }
    });

    yield* (yield* Effect.tap(createActor(machine), (a) => a.start)).send({
      type: 'MY_EVENT'
    });

    expect(spy).toHaveBeenCalledTimes(1);
  }));
});
