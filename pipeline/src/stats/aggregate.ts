import type {
  DailyStats,
  DarkEvent,
  DowntimeInterval,
  EventClass,
  RunRecord,
  StatsSummary,
} from "../../../lib/types";
import { gapBucket } from "../../../lib/types";
import { typeCategory } from "../../../lib/shiptype";

export function utcDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

export function utcMonth(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 7);
}

function emptyByClass(): Record<EventClass, number> {
  return {
    "likely-coverage-loss": 0,
    "possibly-deliberate": 0,
    unknown: 0,
  };
}

function bump(rec: Record<string, number>, key: string): void {
  rec[key] = (rec[key] ?? 0) + 1;
}

export function buildDailyStats(input: {
  date: string;
  events: DarkEvent[]; // any set that includes everything touching this date
  openCount: number;
  runs: RunRecord[];
  downtime: DowntimeInterval[];
  observedVessels: number;
}): DailyStats {
  const openedToday = input.events.filter(
    (e) => utcDate(e.openedAt) === input.date,
  );
  const closedToday = input.events.filter(
    (e) => e.closedAt !== undefined && utcDate(e.closedAt) === input.date,
  );

  const byRegion: Record<string, number> = {};
  const byClass = emptyByClass();
  const byFlag: Record<string, number> = {};
  const byTypeCategory: Record<string, number> = {};
  for (const e of openedToday) {
    bump(byRegion, e.region);
    byClass[e.class] += 1;
    bump(byFlag, e.flagMid);
    bump(byTypeCategory, typeCategory(e.shipType));
  }

  const gapHistogram: Record<string, number> = {};
  const gaps: number[] = [];
  for (const e of closedToday)
    if (e.gapMin !== undefined) {
      bump(gapHistogram, gapBucket(e.gapMin));
      gaps.push(e.gapMin);
    }
  gaps.sort((a, b) => a - b);

  const dayStart = Date.parse(`${input.date}T00:00:00Z`) / 1000;
  const dayEnd = dayStart + 86400;
  let downtimeMin = 0;
  for (const d of input.downtime) {
    if (d.kind !== "collector-down") continue;
    const overlap = Math.min(d.to, dayEnd) - Math.max(d.from, dayStart);
    if (overlap > 0) downtimeMin += overlap / 60;
  }

  return {
    date: input.date,
    eventsOpened: openedToday.length,
    eventsClosed: closedToday.length,
    openAtEOD: input.openCount,
    byRegion,
    byClass,
    byFlag,
    byTypeCategory,
    gapHistogram,
    medianGapMin: gaps.length ? gaps[Math.floor(gaps.length / 2)] : null,
    observedVessels: input.observedVessels,
    runCount: input.runs.filter((r) => utcDate(r.endedAt) === input.date).length,
    downtimeMin: Math.round(downtimeMin),
  };
}

export function buildSummary(input: {
  now: number;
  events: DarkEvent[]; // closed events from recent months plus open events
  windows?: number[];
}): StatsSummary {
  const windows = input.windows ?? [7, 30, 90];
  const totals: StatsSummary["totals"] = {};
  for (const days of windows) {
    const cutoff = input.now - days * 86400;
    const inWindow = input.events.filter((e) => e.openedAt >= cutoff);
    const byClass = emptyByClass();
    const byRegion: Record<string, number> = {};
    const byFlag: Record<string, number> = {};
    const byTypeCategory: Record<string, number> = {};
    const gapHistogram: Record<string, number> = {};
    for (const e of inWindow) {
      byClass[e.class] += 1;
      bump(byRegion, e.region);
      bump(byFlag, e.flagMid);
      bump(byTypeCategory, typeCategory(e.shipType));
      if (e.gapMin !== undefined) bump(gapHistogram, gapBucket(e.gapMin));
    }
    totals[String(days)] = {
      eventsOpened: inWindow.length,
      byClass,
      byRegion,
      byFlag,
      byTypeCategory,
      gapHistogram,
    };
  }
  return { generatedAt: input.now, windowDays: windows, totals };
}
