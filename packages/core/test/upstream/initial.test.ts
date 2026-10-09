import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { createActor, createMachine } from "../../src/index.js";

describe('Initial states', () => {
  // upstream: test/initial.test.ts > Initial states > should return the correct initial state
  it.effect('should return the correct initial state', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          initial: 'b',
          states: {
            b: {
              initial: 'c',
              states: {
                c: {}
              }
            }
          }
        },
        leaf: {}
      }
    });
    expect((yield* (yield* createActor(machine)).getSnapshot).value).toEqual({
      a: { b: 'c' }
    });
  }));

  // upstream: test/initial.test.ts > Initial states > should return the correct initial state (parallel)
  it.effect('should return the correct initial state (parallel)', () => Effect.gen(function* () {
    const machine = createMachine({
      type: 'parallel',
      states: {
        foo: {
          initial: 'a',
          states: {
            a: {
              initial: 'b',
              states: {
                b: {
                  initial: 'c',
                  states: {
                    c: {}
                  }
                }
              }
            },
            leaf: {}
          }
        },
        bar: {
          initial: 'a',
          states: {
            a: {
              initial: 'b',
              states: {
                b: {
                  initial: 'c',
                  states: {
                    c: {}
                  }
                }
              }
            },
            leaf: {}
          }
        }
      }
    });
    expect((yield* (yield* createActor(machine)).getSnapshot).value).toEqual({
      foo: { a: { b: 'c' } },
      bar: { a: { b: 'c' } }
    });
  }));

  // upstream: test/initial.test.ts > Initial states > should return the correct initial state (deep parallel)
  it.effect('should return the correct initial state (deep parallel)', () => Effect.gen(function* () {
    const machine = createMachine({
      initial: 'one',
      states: {
        one: {
          type: 'parallel',
          states: {
            foo: {
              initial: 'a',
              states: {
                a: {
                  initial: 'b',
                  states: {
                    b: {
                      initial: 'c',
                      states: {
                        c: {}
                      }
                    }
                  }
                },
                leaf: {}
              }
            },
            bar: {
              initial: 'a',
              states: {
                a: {
                  initial: 'b',
                  states: {
                    b: {
                      initial: 'c',
                      states: {
                        c: {}
                      }
                    }
                  }
                },
                leaf: {}
              }
            }
          }
        },
        two: {
          type: 'parallel',
          states: {
            foo: {
              initial: 'a',
              states: {
                a: {
                  initial: 'b',
                  states: {
                    b: {
                      initial: 'c',
                      states: {
                        c: {}
                      }
                    }
                  }
                },
                leaf: {}
              }
            },
            bar: {
              initial: 'a',
              states: {
                a: {
                  initial: 'b',
                  states: {
                    b: {
                      initial: 'c',
                      states: {
                        c: {}
                      }
                    }
                  }
                },
                leaf: {}
              }
            }
          }
        }
      }
    });
    expect((yield* (yield* createActor(machine)).getSnapshot).value).toEqual({
      one: {
        foo: { a: { b: 'c' } },
        bar: { a: { b: 'c' } }
      }
    });
  }));
});
