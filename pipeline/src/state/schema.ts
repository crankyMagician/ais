import { z } from "zod";

export const SCHEMA_VERSION = 1;

const pos = z.object({
  lat: z.number(),
  lon: z.number(),
  sog: z.number().nullable(),
  cog: z.number().nullable(),
  heading: z.number().nullable(),
  navStatus: z.number().nullable(),
  ts: z.number(),
});

export const vesselStateSchema = z.object({
  mmsi: z.string(),
  flagMid: z.string(),
  name: z.string().optional(),
  callsign: z.string().optional(),
  imo: z.number().optional(),
  shipType: z.number().optional(),
  draught: z.number().optional(),
  dest: z.string().optional(),
  firstSeen: z.number(),
  lastSeen: z.number(),
  lastPos: pos,
  ring: z.array(pos),
  runsSeen: z.number(),
  consecRuns: z.number(),
  lastRunId: z.string(),
  region: z.string(),
  status: z.enum(["active", "missing", "dark-open", "lost"]),
  missingSince: z.number().optional(),
  openEventId: z.string().optional(),
});

export const coverageCellSchema = z.object({
  emaMsgs: z.number(),
  emaVessels: z.number(),
  runs: z.number(),
});

export const coverageSchema = z.object({
  cells: z.record(z.string(), coverageCellSchema),
  regionEma: z.record(z.string(), z.number()),
});

export const manifestSchema = z.object({
  schemaVersion: z.number(),
  lastRunId: z.string(),
  lastRunEnd: z.number(),
  warmupUntil: z.number(),
});

export const downtimeSchema = z.object({
  from: z.number(),
  to: z.number(),
  kind: z.enum(["collector-down", "degraded"]),
  region: z.string().optional(),
});

export const runRecordSchema = z.object({
  runId: z.string(),
  startedAt: z.number(),
  endedAt: z.number(),
  windowSec: z.number(),
  connectedSec: z.number(),
  msgCount: z.number(),
  regions: z.record(
    z.string(),
    z.object({
      msgs: z.number(),
      vessels: z.number(),
      degraded: z.boolean(),
      reason: z.string().optional(),
    }),
  ),
});

export const darkEventSchema = z.object({
  id: z.string(),
  mmsi: z.string(),
  name: z.string().optional(),
  imo: z.number().optional(),
  shipType: z.number().optional(),
  flagMid: z.string(),
  region: z.string(),
  openedAt: z.number(),
  lastSeenAt: z.number(),
  lastPos: pos,
  cellQuality: z.enum(["good", "edge", "marginal"]),
  class: z.enum(["likely-coverage-loss", "possibly-deliberate", "unknown"]),
  score: z.number(),
  tags: z.array(z.string()),
  closedAt: z.number().optional(),
  resolution: z.enum(["reappeared", "expired"]).optional(),
  reappearPos: pos.optional(),
  gapMin: z.number().optional(),
  wallClockGapMin: z.number().optional(),
  distanceNm: z.number().optional(),
  impliedSpeedKn: z.number().optional(),
});
