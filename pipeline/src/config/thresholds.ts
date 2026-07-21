// Every tunable in the detection pipeline lives here.
export const T = {
  // coverage grid
  cellSizeDeg: 0.25,
  emaAlpha: 0.2,
  cellGoodMsgs: 10, // per run
  cellGoodVessels: 2,
  edgeBadNeighbors: 3, // of 8

  // eligibility and absence (minutes are of *effective* absence)
  eligibleConsecRuns: 3,
  candidateAbsenceMin: 45,
  openAbsenceMin: 90,

  // region-boundary handling
  innerBufferNm: 15,
  drSpeedFactor: 1.3,

  // run health
  degradedMsgFraction: 0.2, // region degraded if msgs < 20% of its EMA
  regionEmaAlpha: 0.2,
  downtimeGapMin: 40, // gap between runs counted as collector downtime
  massMissingFraction: 0.05, // circuit breaker
  minConnectedFraction: 0.5, // run degraded overall below this

  // classification
  deliberateMinSogKn: 3,
  deliberateMinGapMin: 360,
  positionJumpFactor: 1.5,
  positionJumpBaselineKn: 25,
  eezNearKm: 25, // reserved: EEZ layer not shipped in v1

  // lifecycle
  expireDays: 14,
  pruneUnseenDays: 21,
  warmupMin: 120,

  // state details
  ringSize: 12,
  ringMinGapMin: 5,
  snapshotMaxAgeMin: 45,
  runsLogMax: 600,
  downtimeLogMax: 2000,
};
