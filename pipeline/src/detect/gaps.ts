import type {
  DarkEvent,
  DowntimeInterval,
  Pos,
  VesselState,
} from "../../../lib/types";
import type { Observation, StaticInfo } from "../lib/aisstream";
import type { CoverageCell, PipelineState } from "../state/store";
import { REGIONS, regionOf } from "../config/regions";
import { T } from "../config/thresholds";
import {
  cellKey,
  destPoint,
  distToBboxEdgeNm,
  haversineNm,
  inBbox,
} from "../lib/geo";
import { midOf } from "../../../lib/mid";
import { cellQuality } from "./coverage";
import { classify, type RiskZone } from "./classify";
import { effectiveAbsenceMin } from "./health";

export interface RunContext {
  runId: string;
  prevRunId: string | null;
  now: number; // run end, epoch seconds
  warmup: boolean;
  degradedRegions: Set<string>; // mutated by the circuit breaker
  downtime: DowntimeInterval[]; // mutated by the circuit breaker
  cells: Map<string, CoverageCell>;
  zones: RiskZone[];
}

export interface RunObservations {
  positions: Map<string, Observation>;
  statics: Map<string, StaticInfo>;
}

export interface RunOutcome {
  opened: DarkEvent[];
  closed: DarkEvent[];
}

function toPos(o: Observation): Pos {
  return {
    lat: o.lat,
    lon: o.lon,
    sog: o.sog,
    cog: o.cog,
    heading: o.heading,
    navStatus: o.navStatus,
    ts: o.ts,
  };
}

function applyStatic(v: VesselState, s: StaticInfo): void {
  if (s.name) v.name = s.name;
  if (s.callsign) v.callsign = s.callsign;
  if (s.imo) v.imo = s.imo;
  if (s.shipType) v.shipType = s.shipType;
  if (s.draught) v.draught = s.draught;
  if (s.dest) v.dest = s.dest;
}

function closeEvent(
  state: PipelineState,
  ctx: RunContext,
  v: VesselState,
  obs: Observation | null, // null = expiry
): DarkEvent | null {
  const ev = v.openEventId ? state.openEvents.get(v.openEventId) : undefined;
  v.openEventId = undefined;
  if (!ev) return null;
  state.openEvents.delete(ev.id);

  if (obs) {
    const wallGapMin = Math.max(0, (obs.ts - ev.lastSeenAt) / 60);
    const gapMin = effectiveAbsenceMin(
      ev.lastSeenAt,
      obs.ts,
      ev.region,
      state.downtime,
    );
    const distanceNm = haversineNm(
      ev.lastPos.lat,
      ev.lastPos.lon,
      obs.lat,
      obs.lon,
    );
    const impliedSpeedKn =
      wallGapMin > 1 ? distanceNm / (wallGapMin / 60) : undefined;
    ev.closedAt = obs.ts;
    ev.resolution = "reappeared";
    ev.reappearPos = toPos(obs);
    ev.gapMin = Math.round(gapMin);
    ev.wallClockGapMin = Math.round(wallGapMin);
    ev.distanceNm = Math.round(distanceNm * 10) / 10;
    ev.impliedSpeedKn =
      impliedSpeedKn !== undefined
        ? Math.round(impliedSpeedKn * 10) / 10
        : undefined;
    const c = classify({
      ev,
      cellQuality: ev.cellQuality,
      effGapMin: gapMin,
      wallGapMin,
      zones: ctx.zones,
      downtime: state.downtime,
      impliedSpeedKn,
    });
    ev.class = c.class;
    ev.score = c.score;
    ev.tags = c.tags;
  } else {
    ev.closedAt = ctx.now;
    ev.resolution = "expired";
    ev.wallClockGapMin = Math.round((ctx.now - ev.lastSeenAt) / 60);
    ev.gapMin = Math.round(
      effectiveAbsenceMin(ev.lastSeenAt, ctx.now, ev.region, state.downtime),
    );
  }
  return ev;
}

function runCircuitBreaker(
  state: PipelineState,
  obs: RunObservations,
  ctx: RunContext,
): void {
  const activeByRegion = new Map<string, number>();
  const vanishedByRegion = new Map<string, number>();
  for (const v of state.vessels.values()) {
    if (v.status !== "active") continue;
    activeByRegion.set(v.region, (activeByRegion.get(v.region) ?? 0) + 1);
    const wasPresentLastRun = ctx.prevRunId !== null && v.lastRunId === ctx.prevRunId;
    if (wasPresentLastRun && !obs.positions.has(v.mmsi))
      vanishedByRegion.set(v.region, (vanishedByRegion.get(v.region) ?? 0) + 1);
  }
  for (const [region, vanished] of vanishedByRegion) {
    const active = activeByRegion.get(region) ?? 0;
    if (
      active >= 100 &&
      vanished >= 10 &&
      vanished / active > T.massMissingFraction &&
      !ctx.degradedRegions.has(region)
    ) {
      ctx.degradedRegions.add(region);
      const interval: DowntimeInterval = {
        from: ctx.now - 40 * 60,
        to: ctx.now,
        kind: "degraded",
        region,
      };
      ctx.downtime.push(interval);
      state.downtime.push(interval);
    }
  }
}

function shouldSuppressAsRegionExit(v: VesselState, wallGapMin: number): boolean {
  const region = REGIONS.find((r) => r.name === v.region);
  if (!region) return true; // untracked water: never open events
  const p = v.lastPos;
  if (distToBboxEdgeNm(p.lat, p.lon, region.bbox) < T.innerBufferNm) return true;
  const sog = p.sog ?? 0;
  if (sog < 0.5) return false; // effectively stationary; cannot have sailed out
  const distNm = sog * T.drSpeedFactor * (wallGapMin / 60);
  const bearing = p.cog ?? p.heading;
  if (bearing === null) {
    // unknown direction: suppress if the edge is reachable at all
    return distToBboxEdgeNm(p.lat, p.lon, region.bbox) < distNm;
  }
  const dest = destPoint(p.lat, p.lon, bearing, distNm);
  return !inBbox(dest.lat, dest.lon, region.bbox);
}

export function processRun(
  state: PipelineState,
  obs: RunObservations,
  ctx: RunContext,
): RunOutcome {
  const opened: DarkEvent[] = [];
  const closed: DarkEvent[] = [];

  // 1. Observed vessels: update state, close any open events (reappearance
  //    is direct evidence, valid even in a degraded run).
  for (const [mmsi, o] of obs.positions) {
    let v = state.vessels.get(mmsi);
    if (!v) {
      v = {
        mmsi,
        flagMid: midOf(mmsi),
        firstSeen: o.ts,
        lastSeen: o.ts,
        lastPos: toPos(o),
        ring: [toPos(o)],
        runsSeen: 1,
        consecRuns: 1,
        lastRunId: ctx.runId,
        region: regionOf(o.lat, o.lon)?.name ?? "outside",
        status: "active",
      };
      state.vessels.set(mmsi, v);
    } else {
      if (v.status === "dark-open") {
        const ev = closeEvent(state, ctx, v, o);
        if (ev) closed.push(ev);
      }
      v.consecRuns =
        ctx.prevRunId !== null && v.lastRunId === ctx.prevRunId
          ? v.consecRuns + 1
          : 1;
      v.runsSeen += 1;
      v.lastRunId = ctx.runId;
      v.status = "active";
      v.missingSince = undefined;
      if (o.ts >= v.lastSeen) {
        v.lastSeen = o.ts;
        v.lastPos = toPos(o);
        v.region = regionOf(o.lat, o.lon)?.name ?? v.region;
        const lastRing = v.ring[v.ring.length - 1];
        if (!lastRing || o.ts - lastRing.ts >= T.ringMinGapMin * 60) {
          v.ring.push(toPos(o));
          if (v.ring.length > T.ringSize) v.ring.shift();
        }
      }
    }
    const s = obs.statics.get(mmsi);
    if (s) applyStatic(v, s);
  }

  // 2. Mass-disappearance circuit breaker before any absence transitions.
  runCircuitBreaker(state, obs, ctx);

  // 3. Absence transitions.
  for (const v of state.vessels.values()) {
    if (obs.positions.has(v.mmsi)) continue;
    if (v.status === "lost") continue;
    if (ctx.degradedRegions.has(v.region)) continue; // not looking = no evidence

    const effAbs = effectiveAbsenceMin(v.lastSeen, ctx.now, v.region, state.downtime);
    const wallGapMin = (ctx.now - v.lastSeen) / 60;

    if (v.status === "dark-open") {
      if (wallGapMin > T.expireDays * 24 * 60) {
        const ev = closeEvent(state, ctx, v, null);
        if (ev) closed.push(ev);
        v.status = "lost";
      }
      continue;
    }

    if (effAbs < T.candidateAbsenceMin) continue;

    const eligible = v.consecRuns >= T.eligibleConsecRuns;
    if (!eligible) {
      if (effAbs >= T.openAbsenceMin) v.status = "lost";
      continue;
    }

    if (v.status === "active") {
      v.status = "missing";
      v.missingSince = v.lastSeen;
    }

    if (v.status === "missing" && effAbs >= T.openAbsenceMin) {
      if (ctx.warmup) continue;
      if (shouldSuppressAsRegionExit(v, wallGapMin)) {
        v.status = "lost";
        continue;
      }
      const quality = cellQuality(
        ctx.cells,
        cellKey(v.lastPos.lat, v.lastPos.lon, T.cellSizeDeg),
      );
      if (quality === "marginal") {
        // thin coverage: absence is expected, not an event
        v.status = "lost";
        continue;
      }
      const ev: DarkEvent = {
        id: `${v.mmsi}-${Math.round(v.lastSeen)}`,
        mmsi: v.mmsi,
        name: v.name,
        imo: v.imo,
        shipType: v.shipType,
        flagMid: v.flagMid,
        region: v.region,
        openedAt: ctx.now,
        lastSeenAt: v.lastSeen,
        lastPos: v.lastPos,
        cellQuality: quality,
        class: "unknown",
        score: 0,
        tags: [],
      };
      const c = classify({
        ev,
        cellQuality: quality,
        effGapMin: effAbs,
        wallGapMin,
        zones: ctx.zones,
        downtime: state.downtime,
      });
      ev.class = c.class;
      ev.score = c.score;
      ev.tags = c.tags;
      state.openEvents.set(ev.id, ev);
      v.status = "dark-open";
      v.openEventId = ev.id;
      opened.push(ev);
    }
  }

  // 4. Reclassify still-open events as their gaps grow.
  for (const ev of state.openEvents.values()) {
    const effGap = effectiveAbsenceMin(
      ev.lastSeenAt,
      ctx.now,
      ev.region,
      state.downtime,
    );
    const wallGap = (ctx.now - ev.lastSeenAt) / 60;
    const c = classify({
      ev,
      cellQuality: ev.cellQuality,
      effGapMin: effGap,
      wallGapMin: wallGap,
      zones: ctx.zones,
      downtime: state.downtime,
    });
    ev.class = c.class;
    ev.score = c.score;
    ev.tags = c.tags;
  }

  // 5. Prune long-gone vessels without open events.
  for (const [mmsi, v] of state.vessels)
    if (
      !v.openEventId &&
      ctx.now - v.lastSeen > T.pruneUnseenDays * 24 * 3600
    )
      state.vessels.delete(mmsi);

  return { opened, closed };
}
