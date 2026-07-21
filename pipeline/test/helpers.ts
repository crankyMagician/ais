import type { DarkEvent } from "../../lib/types";
import type { Observation } from "../src/lib/aisstream";
import type { CoverageCell, PipelineState } from "../src/state/store";
import { cellKey, neighborKeys } from "../src/lib/geo";
import { T } from "../src/config/thresholds";
import {
  processRun,
  type RunContext,
  type RunOutcome,
} from "../src/detect/gaps";

export const T0 = 1_750_000_000; // fixed epoch base for all tests
export const RUN_GAP = 30 * 60;

export function emptyState(): PipelineState {
  return {
    vessels: new Map(),
    coverageCells: new Map(),
    regionEma: new Map(),
    openEvents: new Map(),
    downtime: [],
    runs: [],
    manifest: null,
  };
}

export function goodCellsAround(
  state: PipelineState,
  lat: number,
  lon: number,
): void {
  const key = cellKey(lat, lon, T.cellSizeDeg);
  const good: CoverageCell = { emaMsgs: 50, emaVessels: 10, runs: 20 };
  state.coverageCells.set(key, { ...good });
  for (const nk of neighborKeys(key)) state.coverageCells.set(nk, { ...good });
}

export function obs(
  mmsi: string,
  lat: number,
  lon: number,
  ts: number,
  over: Partial<Observation> = {},
): Observation {
  return {
    mmsi,
    lat,
    lon,
    sog: 5,
    cog: 0,
    heading: null,
    navStatus: 0,
    ts,
    ...over,
  };
}

export interface Sim {
  state: PipelineState;
  runIndex: number;
  lastOutcome: RunOutcome | null;
  allOpened: DarkEvent[];
  allClosed: DarkEvent[];
}

export function makeSim(): Sim {
  return {
    state: emptyState(),
    runIndex: 0,
    lastOutcome: null,
    allOpened: [],
    allClosed: [],
  };
}

// Runs one collection cycle at T0 + runIndex * RUN_GAP with the given
// observations. Context defaults: warm, healthy, no zones.
export function step(
  sim: Sim,
  observations: Observation[],
  over: Partial<RunContext> = {},
): RunOutcome {
  const now = T0 + sim.runIndex * RUN_GAP;
  const runId = `run-${sim.runIndex}`;
  const ctx: RunContext = {
    runId,
    prevRunId: sim.runIndex > 0 ? `run-${sim.runIndex - 1}` : null,
    now,
    warmup: false,
    degradedRegions: new Set(),
    downtime: sim.state.downtime,
    cells: sim.state.coverageCells,
    zones: [],
    ...over,
  };
  const outcome = processRun(
    sim.state,
    {
      positions: new Map(observations.map((o) => [o.mmsi, o])),
      statics: new Map(),
    },
    ctx,
  );
  sim.runIndex += 1;
  sim.lastOutcome = outcome;
  sim.allOpened.push(...outcome.opened);
  sim.allClosed.push(...outcome.closed);
  return outcome;
}

export function simNow(sim: Sim): number {
  return T0 + (sim.runIndex - 1) * RUN_GAP;
}
