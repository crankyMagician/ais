import type { CoverageCell } from "../state/store";
import type { RunCounts } from "../collect";
import { neighborKeys } from "../lib/geo";
import { regionOf } from "../config/regions";
import { T } from "../config/thresholds";

export type CellQuality = "good" | "edge" | "marginal";

function cellRegion(key: string): string {
  const [y, x] = key.split(":").map(Number);
  const lat = (y + 0.5) * T.cellSizeDeg;
  const lon = (x + 0.5) * T.cellSizeDeg;
  return regionOf(lat, lon)?.name ?? "outside";
}

// EMA-update the grid with this run's counts. Cells in degraded regions keep
// their previous values: a receiver outage is not evidence of lower coverage.
export function updateCoverage(
  cells: Map<string, CoverageCell>,
  counts: RunCounts,
  degradedRegions: Set<string>,
): void {
  const touched = new Set<string>([...counts.cellMsgs.keys(), ...cells.keys()]);
  for (const key of touched) {
    if (degradedRegions.has(cellRegion(key))) continue;
    const msgs = counts.cellMsgs.get(key) ?? 0;
    const vessels = counts.cellVessels.get(key)?.size ?? 0;
    const prev = cells.get(key);
    if (!prev) {
      cells.set(key, { emaMsgs: msgs, emaVessels: vessels, runs: 1 });
    } else {
      const a = T.emaAlpha;
      cells.set(key, {
        emaMsgs: a * msgs + (1 - a) * prev.emaMsgs,
        emaVessels: a * vessels + (1 - a) * prev.emaVessels,
        runs: prev.runs + 1,
      });
    }
  }
  // Drop cells that have decayed to noise so the grid doesn't grow forever.
  for (const [key, c] of cells)
    if (c.emaMsgs < 0.05 && c.emaVessels < 0.05) cells.delete(key);
}

function isGood(c: CoverageCell | undefined): boolean {
  return (
    !!c && c.emaMsgs >= T.cellGoodMsgs && c.emaVessels >= T.cellGoodVessels
  );
}

export function cellQuality(
  cells: Map<string, CoverageCell>,
  key: string,
): CellQuality {
  const c = cells.get(key);
  if (!isGood(c)) return "marginal";
  let bad = 0;
  for (const nk of neighborKeys(key)) if (!isGood(cells.get(nk))) bad++;
  return bad >= T.edgeBadNeighbors ? "edge" : "good";
}
