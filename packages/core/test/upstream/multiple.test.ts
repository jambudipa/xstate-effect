import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { createMachine, createActor } from "../../src/index.js";

describe('multiple', () => {
  const machine = createMachine({
    initial: 'simple',
    states: {
      simple: {
        on: {
          DEEP_M: 'para.K.M',
          DEEP_CM: [{ target: ['para.A.C', 'para.K.M'] }],
          DEEP_MR: [{ target: ['para.K.M', 'para.P.R'] }],
          DEEP_CMR: [{ target: ['para.A.C', 'para.K.M', 'para.P.R'] }],
          BROKEN_SAME_REGION: [{ target: ['para.A.C', 'para.A.B'] }],
          BROKEN_DIFFERENT_REGIONS: [
            { target: ['para.A.C', 'para.K.M', 'other'] }
          ],
          BROKEN_DIFFERENT_REGIONS_2: [{ target: ['para.A.C', 'para2.K2.M2'] }],
          BROKEN_DIFFERENT_REGIONS_3: [
            { target: ['para2.K2.L2.L2A', 'other'] }
          ],
          BROKEN_DIFFERENT_REGIONS_4: [
            { target: ['para2.K2.L2.L2A.L2C', 'para2.K2.M2'] }
          ],
          INITIAL: 'para'
        }
      },
      other: {
        initial: 'X',
        states: {
          X: {}
        }
      },
      para: {
        type: 'parallel',
        states: {
          A: {
            initial: 'B',
            states: {
              B: {},
              C: {}
            }
          },
          K: {
            initial: 'L',
            states: {
              L: {},
              M: {}
            }
          },
          P: {
            initial: 'Q',
            states: {
              Q: {},
              R: {}
            }
          }
        }
      },
      para2: {
        type: 'parallel',
        states: {
          A2: {
            initial: 'B2',
            states: {
              B2: {},
              C2: {}
            }
          },
          K2: {
            initial: 'L2',
            states: {
              L2: {
                type: 'parallel',
                states: {
                  L2A: {
                    initial: 'L2B',
                    states: {
                      L2B: {},
                      L2C: {}
                    }
                  },
                  L2K: {
                    initial: 'L2L',
                    states: {
                      L2L: {},
                      L2M: {}
                    }
                  },
                  L2P: {
                    initial: 'L2Q',
                    states: {
                      L2Q: {},
                      L2R: {}
                    }
                  }
                }
              },
              M2: {
                type: 'parallel',
                states: {
                  M2A: {
                    initial: 'M2B',
                    states: {
                      M2B: {},
                      M2C: {}
                    }
                  },
                  M2K: {
                    initial: 'M2L',
                    states: {
                      M2L: {},
                      M2M: {}
                    }
                  },
                  M2P: {
                    initial: 'M2Q',
                    states: {
                      M2Q: {},
                      M2R: {}
                    }
                  }
                }
              }
            }
          },
          P2: {
            initial: 'Q2',
            states: {
              Q2: {},
              R2: {}
            }
          }
        }
      }
    }
  });

  describe('transitions to parallel states', () => {
    // upstream: test/multiple.test.ts > multiple > transitions to parallel states > should enter initial states of parallel states
    it.effect('should enter initial states of parallel states', () => Effect.gen(function* () {
      const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
      (yield* actorRef.send({ type: 'INITIAL' }));
      expect((yield* actorRef.getSnapshot).value).toEqual({
        para: { A: 'B', K: 'L', P: 'Q' }
      });
    }));

    // upstream: test/multiple.test.ts > multiple > transitions to parallel states > should enter specific states in one region
    it.effect('should enter specific states in one region', () => Effect.gen(function* () {
      const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
      (yield* actorRef.send({ type: 'DEEP_M' }));
      expect((yield* actorRef.getSnapshot).value).toEqual({
        para: { A: 'B', K: 'M', P: 'Q' }
      });
    }));

    // upstream: test/multiple.test.ts > multiple > transitions to parallel states > should enter specific states in all regions
    it.effect('should enter specific states in all regions', () => Effect.gen(function* () {
      const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
      (yield* actorRef.send({ type: 'DEEP_CMR' }));
      expect((yield* actorRef.getSnapshot).value).toEqual({
        para: { A: 'C', K: 'M', P: 'R' }
      });
    }));

    // upstream: test/multiple.test.ts > multiple > transitions to parallel states > should enter specific states in some regions
    it.effect('should enter specific states in some regions', () => Effect.gen(function* () {
      const actorRef = (yield* Effect.tap(createActor(machine), (a) => a.start));
      (yield* actorRef.send({ type: 'DEEP_MR' }));
      expect((yield* actorRef.getSnapshot).value).toEqual({
        para: { A: 'B', K: 'M', P: 'R' }
      });
    }));

    // NOT PORTED (skipped upstream, ledger row): multiple > transitions to parallel states > should reject two targets in the same region

    // NOT PORTED (skipped upstream, ledger row): multiple > transitions to parallel states > should reject targets inside and outside a region

    // NOT PORTED (skipped upstream, ledger row): multiple > transitions to parallel states > should reject two targets in different regions

    // NOT PORTED (skipped upstream, ledger row): multiple > transitions to parallel states > should reject two targets in different regions at different levels

    // NOT PORTED (skipped upstream, ledger row): multiple > transitions to parallel states > should reject two deep targets in different regions at top level

    // NOT PORTED (skipped upstream, ledger row): multiple > transitions to parallel states > should reject two deep targets in different regions at different levels
  });
});
