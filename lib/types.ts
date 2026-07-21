// Shared between the Next.js site and the pipeline. Everything here is
// serialized to the data branch, so changes require a schemaVersion bump in
// pipeline/src/state/schema.ts.

export type VesselStatus = "active" | "missing" | "dark-open" | "lost";

export interface Pos {
  lat: number;
  lon: number;
  sog: number | null; // knots
  cog: number | null; // degrees
  heading: number | null;
  navStatus: number | null; // AIS navigational status code
  ts: number; // epoch seconds
}

export interface VesselState {
  mmsi: string;
  flagMid: string;
  name?: string;
  callsign?: string;
  imo?: number;
  shipType?: number;
  draught?: number;
  dest?: string;
  firstSeen: number;
  lastSeen: number;
  lastPos: Pos;
  ring: Pos[]; // last 12 positions, >=5 min apart
  runsSeen: number;
  consecRuns: number;
  lastRunId: string;
  region: string;
  status: VesselStatus;
  missingSince?: number; // epoch seconds, set when status leaves "active"
  openEventId?: string;
}

export type EventClass =
  | "likely-coverage-loss"
  | "possibly-deliberate"
  | "unknown";

export type EventResolution = "reappeared" | "expired";

export interface DarkEvent {
  id: string;
  mmsi: string;
  name?: string;
  imo?: number;
  shipType?: number;
  flagMid: string;
  region: string;
  openedAt: number; // when the pipeline opened the event
  lastSeenAt: number; // vessel's last received position
  lastPos: Pos;
  cellQuality: "good" | "edge" | "marginal";
  class: EventClass;
  score: number;
  tags: string[]; // in-port, type-tanker, type-cargo, risk-zone:<name>,
  // near-eez-boundary, foc-flag, position-jump, left-region
  // set when closed:
  closedAt?: number;
  resolution?: EventResolution;
  reappearPos?: Pos;
  gapMin?: number; // effective absence, minutes
  wallClockGapMin?: number;
  distanceNm?: number;
  impliedSpeedKn?: number;
}

export interface SnapshotVessel {
  mmsi: string;
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  ts: number;
  name?: string;
  shipType?: number;
  flagMid: string;
}

export interface RegionSnapshot {
  region: string;
  generatedAt: number;
  vessels: SnapshotVessel[];
}

export interface RunRecord {
  runId: string;
  startedAt: number;
  endedAt: number;
  windowSec: number;
  connectedSec: number;
  sources?: Record<string, number>; // connected seconds per source
  msgCount: number;
  regions: Record<
    string,
    { msgs: number; vessels: number; degraded: boolean; reason?: string }
  >;
}

export interface DowntimeInterval {
  from: number;
  to: number;
  kind: "collector-down" | "degraded";
  region?: string; // absent = all regions
}

export interface DailyStats {
  date: string; // YYYY-MM-DD
  eventsOpened: number;
  eventsClosed: number;
  openAtEOD: number;
  byRegion: Record<string, number>;
  byClass: Record<EventClass, number>;
  byFlag: Record<string, number>; // MID -> count
  byTypeCategory: Record<string, number>;
  gapHistogram: Record<string, number>; // bucket label -> count
  medianGapMin: number | null;
  observedVessels: number;
  runCount: number;
  downtimeMin: number;
}

export interface StatsSummary {
  generatedAt: number;
  windowDays: number[];
  totals: Record<
    string, // "7" | "30" | "90"
    {
      eventsOpened: number;
      byClass: Record<EventClass, number>;
      byRegion: Record<string, number>;
      byFlag: Record<string, number>;
      byTypeCategory: Record<string, number>;
      gapHistogram: Record<string, number>;
    }
  >;
}

export interface Manifest {
  schemaVersion: number;
  lastRunId: string;
  lastRunEnd: number;
  warmupUntil: number; // epoch seconds; no events opened before this
}

export const GAP_BUCKETS: Array<{ label: string; maxMin: number }> = [
  { label: "1.5-3 h", maxMin: 180 },
  { label: "3-6 h", maxMin: 360 },
  { label: "6-12 h", maxMin: 720 },
  { label: "12-24 h", maxMin: 1440 },
  { label: "1-3 d", maxMin: 4320 },
  { label: "3-14 d", maxMin: 20160 },
];

export function gapBucket(gapMin: number): string {
  for (const b of GAP_BUCKETS) if (gapMin <= b.maxMin) return b.label;
  return GAP_BUCKETS[GAP_BUCKETS.length - 1].label;
}
