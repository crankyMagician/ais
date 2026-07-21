import type { DowntimeInterval, RunRecord } from "../../../lib/types";
import type { RunCounts } from "../collect";
import { REGIONS } from "../config/regions";
import { T } from "../config/thresholds";

export interface RunHealth {
  record: RunRecord;
  degradedRegions: Set<string>;
  newDowntime: DowntimeInterval[];
}

export function assessRun(input: {
  runId: string;
  startedAt: number;
  endedAt: number;
  windowSec: number;
  connectedSec: number;
  msgCount: number;
  counts: RunCounts;
  regionEma: Map<string, number>; // mutated with this run's values
  prevRunEnd: number | null;
}): RunHealth {
  const degraded = new Set<string>();
  const newDowntime: DowntimeInterval[] = [];
  const regions: RunRecord["regions"] = {};

  const connectivityBad =
    input.connectedSec / input.windowSec < T.minConnectedFraction;

  for (const r of REGIONS) {
    const msgs = input.counts.regionMsgs.get(r.name) ?? 0;
    const vessels = input.counts.regionVessels.get(r.name)?.size ?? 0;
    const ema = input.regionEma.get(r.name);
    let isDegraded = connectivityBad;
    let reason = connectivityBad ? "connectivity" : undefined;
    if (!isDegraded && ema !== undefined && ema > 50) {
      if (msgs < ema * T.degradedMsgFraction) {
        isDegraded = true;
        reason = "low-volume";
      }
    }
    if (isDegraded) {
      degraded.add(r.name);
      newDowntime.push({
        from: input.prevRunEnd ?? input.startedAt,
        to: input.endedAt,
        kind: "degraded",
        region: r.name,
      });
    } else {
      const a = T.regionEmaAlpha;
      input.regionEma.set(
        r.name,
        ema === undefined ? msgs : a * msgs + (1 - a) * ema,
      );
    }
    regions[r.name] = { msgs, vessels, degraded: isDegraded, reason };
  }

  if (
    input.prevRunEnd !== null &&
    input.startedAt - input.prevRunEnd > T.downtimeGapMin * 60
  ) {
    newDowntime.push({
      from: input.prevRunEnd,
      to: input.startedAt,
      kind: "collector-down",
    });
  }

  return {
    record: {
      runId: input.runId,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      windowSec: input.windowSec,
      connectedSec: input.connectedSec,
      msgCount: input.msgCount,
      regions,
    },
    degradedRegions: degraded,
    newDowntime,
  };
}

function mergeIntervals(
  spans: Array<[number, number]>,
): Array<[number, number]> {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [sorted[0].slice() as [number, number]];
  for (const [from, to] of sorted.slice(1)) {
    const last = out[out.length - 1];
    if (from <= last[1]) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

// Wall-clock absence minus any overlap with collector downtime or degraded
// coverage in the vessel's region. This is the number every threshold uses.
export function effectiveAbsenceMin(
  lastSeen: number,
  now: number,
  region: string,
  downtime: DowntimeInterval[],
): number {
  const wall = now - lastSeen;
  if (wall <= 0) return 0;
  const applicable = downtime
    .filter(
      (d) =>
        d.kind === "collector-down" || d.region === undefined || d.region === region,
    )
    .map((d): [number, number] => [
      Math.max(d.from, lastSeen),
      Math.min(d.to, now),
    ])
    .filter(([f, t]) => t > f);
  let overlap = 0;
  for (const [f, t] of mergeIntervals(applicable)) overlap += t - f;
  return Math.max(0, (wall - overlap) / 60);
}
