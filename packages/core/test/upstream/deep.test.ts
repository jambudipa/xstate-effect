import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { createMachine, createActor } from "../../src/index.js";
import { trackEntries } from "./trackEntries.js";

describe('deep transitions', () => {
  describe('exiting super/substates', () => {
    // upstream: test/deep.test.ts > deep transitions > exiting super/substates > should exit all substates when superstates exits
    it.effect('should exit all substates when superstates exits', () => Effect.gen(function* () {
      const machine = createMachine({
        id: 'root',
        initial: 'A',
        states: {
          DONE: {},
          FAIL: {},
          A: {
            on: {
              A_EVENT: '#root.DONE'
            },
            initial: 'B',
            states: {
              B: {
                initial: 'C',
                states: {
                  C: {
                    initial: 'D',
                    states: {
                      D: {}
                    }
                  }
                }
              }
            }
          }
        }
      });

      const flushTracked = trackEntries(machine);

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
      flushTracked();

      (yield* actor.send({
        type: 'A_EVENT'
      }));

      expect(flushTracked()).toEqual([
        'exit: A.B.C.D',
        'exit: A.B.C',
        'exit: A.B',
        'exit: A',
        'enter: DONE'
      ]);
    }));

    // upstream: test/deep.test.ts > deep transitions > exiting super/substates > should exit substates and superstates when exiting (B_EVENT)
    it.effect('should exit substates and superstates when exiting (B_EVENT)', () => Effect.gen(function* () {
      const machine = createMachine({
        id: 'root',
        initial: 'A',
        states: {
          DONE: {},
          A: {
            initial: 'B',
            states: {
              B: {
                on: {
                  B_EVENT: '#root.DONE'
                },
                initial: 'C',
                states: {
                  C: {
                    initial: 'D',
                    states: {
                      D: {}
                    }
                  }
                }
              }
            }
          }
        }
      });

      const flushTracked = trackEntries(machine);

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
      flushTracked();

      (yield* actor.send({
        type: 'B_EVENT'
      }));

      expect(flushTracked()).toEqual([
        'exit: A.B.C.D',
        'exit: A.B.C',
        'exit: A.B',
        'exit: A',
        'enter: DONE'
      ]);
    }));

    // upstream: test/deep.test.ts > deep transitions > exiting super/substates > should exit substates and superstates when exiting (C_EVENT)
    it.effect('should exit substates and superstates when exiting (C_EVENT)', () => Effect.gen(function* () {
      const machine = createMachine({
        id: 'root',
        initial: 'A',
        states: {
          DONE: {},
          A: {
            initial: 'B',
            states: {
              B: {
                initial: 'C',
                states: {
                  C: {
                    on: {
                      C_EVENT: '#root.DONE'
                    },
                    initial: 'D',
                    states: {
                      D: {}
                    }
                  }
                }
              }
            }
          }
        }
      });

      const flushTracked = trackEntries(machine);

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
      flushTracked();

      (yield* actor.send({
        type: 'C_EVENT'
      }));

      expect(flushTracked()).toEqual([
        'exit: A.B.C.D',
        'exit: A.B.C',
        'exit: A.B',
        'exit: A',
        'enter: DONE'
      ]);
    }));

    // upstream: test/deep.test.ts > deep transitions > exiting super/substates > should exit superstates when exiting (D_EVENT)
    it.effect('should exit superstates when exiting (D_EVENT)', () => Effect.gen(function* () {
      const machine = createMachine({
        id: 'root',
        initial: 'A',
        states: {
          DONE: {},
          A: {
            initial: 'B',
            states: {
              B: {
                initial: 'C',
                states: {
                  C: {
                    initial: 'D',
                    states: {
                      D: {
                        on: {
                          D_EVENT: '#root.DONE'
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

      const flushTracked = trackEntries(machine);

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
      flushTracked();

      (yield* actor.send({
        type: 'D_EVENT'
      }));

      expect(flushTracked()).toEqual([
        'exit: A.B.C.D',
        'exit: A.B.C',
        'exit: A.B',
        'exit: A',
        'enter: DONE'
      ]);
    }));

    // upstream: test/deep.test.ts > deep transitions > exiting super/substates > should exit substate when machine handles event (MACHINE_EVENT)
    it.effect('should exit substate when machine handles event (MACHINE_EVENT)', () => Effect.gen(function* () {
      const machine = createMachine({
        id: 'deep',
        initial: 'A',
        on: {
          MACHINE_EVENT: '#deep.DONE'
        },
        states: {
          DONE: {},
          A: {
            initial: 'B',
            states: {
              B: {
                initial: 'C',
                states: {
                  C: {
                    initial: 'D',
                    states: {
                      D: {}
                    }
                  }
                }
              }
            }
          }
        }
      });

      const flushTracked = trackEntries(machine);

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
      flushTracked();

      (yield* actor.send({
        type: 'MACHINE_EVENT'
      }));

      expect(flushTracked()).toEqual([
        'exit: A.B.C.D',
        'exit: A.B.C',
        'exit: A.B',
        'exit: A',
        'enter: DONE'
      ]);
    }));

    // upstream: test/deep.test.ts > deep transitions > exiting super/substates > should exit deep and enter deep (A_S)
    it.effect('should exit deep and enter deep (A_S)', () => Effect.gen(function* () {
      const machine = createMachine({
        id: 'root',
        initial: 'A',
        states: {
          A: {
            on: {
              A_S: '#root.P.Q.R.S'
            },
            initial: 'B',
            states: {
              B: {
                initial: 'C',
                states: {
                  C: {
                    initial: 'D',
                    states: {
                      D: {}
                    }
                  }
                }
              }
            }
          },
          P: {
            initial: 'Q',
            states: {
              Q: {
                initial: 'R',
                states: {
                  R: {
                    initial: 'S',
                    states: {
                      S: {}
                    }
                  }
                }
              }
            }
          }
        }
      });
      const flushTracked = trackEntries(machine);

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
      flushTracked();

      (yield* actor.send({
        type: 'A_S'
      }));

      expect(flushTracked()).toEqual([
        'exit: A.B.C.D',
        'exit: A.B.C',
        'exit: A.B',
        'exit: A',
        'enter: P',
        'enter: P.Q',
        'enter: P.Q.R',
        'enter: P.Q.R.S'
      ]);
    }));

    // upstream: test/deep.test.ts > deep transitions > exiting super/substates > should exit deep and enter deep (D_P)
    it.effect('should exit deep and enter deep (D_P)', () => Effect.gen(function* () {
      const machine = createMachine({
        id: 'deep',
        initial: 'A',
        states: {
          A: {
            initial: 'B',
            states: {
              B: {
                initial: 'C',
                states: {
                  C: {
                    initial: 'D',
                    states: {
                      D: {
                        on: {
                          D_P: '#deep.P'
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          P: {
            initial: 'Q',
            states: {
              Q: {
                initial: 'R',
                states: {
                  R: {
                    initial: 'S',
                    states: {
                      S: {}
                    }
                  }
                }
              }
            }
          }
        }
      });

      const flushTracked = trackEntries(machine);

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
      flushTracked();

      (yield* actor.send({
        type: 'D_P'
      }));

      expect(flushTracked()).toEqual([
        'exit: A.B.C.D',
        'exit: A.B.C',
        'exit: A.B',
        'exit: A',
        'enter: P',
        'enter: P.Q',
        'enter: P.Q.R',
        'enter: P.Q.R.S'
      ]);
    }));

    // upstream: test/deep.test.ts > deep transitions > exiting super/substates > should exit deep and enter deep when targeting an ancestor of the final resolved deep target
    it.effect('should exit deep and enter deep when targeting an ancestor of the final resolved deep target', () => Effect.gen(function* () {
      const machine = createMachine({
        id: 'root',
        initial: 'A',
        states: {
          A: {
            on: {
              A_P: '#root.P'
            },
            initial: 'B',
            states: {
              B: {
                initial: 'C',
                states: {
                  C: {
                    initial: 'D',
                    states: {
                      D: {}
                    }
                  }
                }
              }
            }
          },
          P: {
            initial: 'Q',
            states: {
              Q: {
                initial: 'R',
                states: {
                  R: {
                    initial: 'S',
                    states: {
                      S: {}
                    }
                  }
                }
              }
            }
          }
        }
      });

      const flushTracked = trackEntries(machine);

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
      flushTracked();

      (yield* actor.send({
        type: 'A_P'
      }));

      expect(flushTracked()).toEqual([
        'exit: A.B.C.D',
        'exit: A.B.C',
        'exit: A.B',
        'exit: A',
        'enter: P',
        'enter: P.Q',
        'enter: P.Q.R',
        'enter: P.Q.R.S'
      ]);
    }));

    // upstream: test/deep.test.ts > deep transitions > exiting super/substates > should exit deep and enter deep when targeting a deep state
    it.effect('should exit deep and enter deep when targeting a deep state', () => Effect.gen(function* () {
      const machine = createMachine({
        id: 'root',
        initial: 'A',
        states: {
          A: {
            initial: 'B',
            states: {
              B: {
                initial: 'C',
                states: {
                  C: {
                    initial: 'D',
                    states: {
                      D: {
                        on: {
                          D_S: '#root.P.Q.R.S'
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          P: {
            initial: 'Q',
            states: {
              Q: {
                initial: 'R',
                states: {
                  R: {
                    initial: 'S',
                    states: {
                      S: {}
                    }
                  }
                }
              }
            }
          }
        }
      });

      const flushTracked = trackEntries(machine);

      const actor = (yield* Effect.tap(createActor(machine), (a) => a.start));
      flushTracked();

      (yield* actor.send({
        type: 'D_S'
      }));

      expect(flushTracked()).toEqual([
        'exit: A.B.C.D',
        'exit: A.B.C',
        'exit: A.B',
        'exit: A',
        'enter: P',
        'enter: P.Q',
        'enter: P.Q.R',
        'enter: P.Q.R.S'
      ]);
    }));
  });
});
