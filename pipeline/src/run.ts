import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { DarkEvent, Manifest } from "../../lib/types";
import {
  collectWindow,
  emptyResult,
  foldMessage,
  type CollectResult,
} from "./lib/aisstream";
import { collectKystverket } from "./lib/kystverket";
import { makeCounter } from "./collect";
import { WORLD_BOXES } from "./config/regions";
import { T } from "./config/thresholds";
import { updateCoverage } from "./detect/coverage";
import { assessRun } from "./detect/health";
import { processRun } from "./detect/gaps";
import { loadZones } from "./detect/classify";
import { SCHEMA_VERSION } from "./state/schema";
import {
  carryForward,
  loadMonthEvents,
  loadState,
  writeOutputs,
} from "./state/store";
import { buildDailyStats, buildSummary, utcDate, utcMonth } from "./stats/aggregate";
import { buildSnapshots } from "./publish";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main(): Promise<void> {
  const stateDir = arg("state");
  const outDir = arg("out");
  const windowMin = Number(arg("window-min", "10"));
  const replayFile = arg("replay");
  if (!stateDir || !outDir) {
    console.error(
      "usage: run.ts --state <dir> --out <dir> [--window-min 10] [--replay frames.ndjson]",
    );
    process.exit(2);
  }

  const apiKey = process.env.AISSTREAM_API_KEY || undefined;
  if (!replayFile && !apiKey)
    console.warn(
      "AISSTREAM_API_KEY not set: collecting from Kystverket only (no global coverage)",
    );

  const zonesFile = fileURLToPath(
    new URL("../data-static/risk-zones.geojson", import.meta.url),
  );
  const zones = loadZones(JSON.parse(fs.readFileSync(zonesFile, "utf8")));

  const state = loadState(stateDir);
  const startedAt = Date.now() / 1000;
  const runId = new Date(startedAt * 1000).toISOString();
  const { counts, onPosition } = makeCounter();

  const result: CollectResult = emptyResult();
  const windowMs = windowMin * 60000;
  let sources = { aisstream: 0, kystverket: 0 };
  if (replayFile) {
    for (const line of fs.readFileSync(replayFile, "utf8").split("\n"))
      if (line.trim()) foldMessage(line, result, startedAt, onPosition);
    sources = { aisstream: windowMin * 60, kystverket: windowMin * 60 };
  } else {
    const log = (m: string) => console.log(m);
    const [aisMs, kystMs] = await Promise.all([
      apiKey
        ? collectWindow({
            apiKey,
            boxes: WORLD_BOXES,
            windowMs,
            result,
            onPosition,
            log,
          })
        : Promise.resolve(0),
      collectKystverket({ windowMs, result, onPosition, log }),
    ]);
    sources = { aisstream: aisMs / 1000, kystverket: kystMs / 1000 };
  }
  const endedAt = Date.now() / 1000;
  console.log(
    `window done: ${result.msgCount} msgs, ${result.positions.size} vessels, ` +
      `aisstream ${Math.round(sources.aisstream)}s / kystverket ${Math.round(sources.kystverket)}s of ${windowMin * 60}s`,
  );

  const prevRunEnd = state.manifest?.lastRunEnd ?? null;
  const health = assessRun({
    runId,
    startedAt,
    endedAt,
    windowSec: windowMin * 60,
    sources,
    msgCount: result.msgCount,
    counts,
    regionEma: state.regionEma,
    prevRunEnd,
  });
  state.downtime.push(...health.newDowntime);
  state.runs.push(health.record);
  updateCoverage(state.coverageCells, counts, health.degradedRegions);

  const warmupUntil =
    state.manifest?.warmupUntil ?? endedAt + T.warmupMin * 60;
  const outcome = processRun(
    state,
    { positions: result.positions, statics: result.statics },
    {
      runId,
      prevRunId: state.manifest?.lastRunId ?? null,
      now: endedAt,
      warmup: endedAt < warmupUntil,
      degradedRegions: health.degradedRegions,
      downtime: state.downtime,
      cells: state.coverageCells,
      zones,
    },
  );
  console.log(
    `detection: ${outcome.opened.length} opened, ${outcome.closed.length} closed, ` +
      `${state.openEvents.size} open, ${state.vessels.size} vessels tracked` +
      (health.degradedRegions.size
        ? `, degraded: ${[...health.degradedRegions].join(",")}`
        : ""),
  );

  // trim logs
  state.runs = state.runs.slice(-T.runsLogMax);
  const downtimeCutoff = endedAt - 45 * 86400;
  state.downtime = state.downtime
    .filter((d) => d.to >= downtimeCutoff)
    .slice(-T.downtimeLogMax);

  // fold closed events into their month files
  const monthEvents = new Map<string, DarkEvent[]>();
  for (const ev of outcome.closed) {
    const month = utcMonth(ev.closedAt ?? endedAt);
    if (!monthEvents.has(month))
      monthEvents.set(month, loadMonthEvents(stateDir, month));
    monthEvents.get(month)!.push(ev);
  }

  // events feeding today's stats and the rolling summary
  const recentEvents: DarkEvent[] = [...state.openEvents.values()];
  const seen = new Set(recentEvents.map((e) => e.id));
  for (let i = 0; i < 4; i++) {
    const month = utcMonth(endedAt - i * 30 * 86400);
    const events = monthEvents.get(month) ?? loadMonthEvents(stateDir, month);
    for (const e of events)
      if (!seen.has(e.id)) {
        seen.add(e.id);
        recentEvents.push(e);
      }
  }

  const today = utcDate(endedAt);
  const dailyStats = new Map<string, object>();
  dailyStats.set(
    today,
    buildDailyStats({
      date: today,
      events: recentEvents,
      openCount: state.openEvents.size,
      runs: state.runs,
      downtime: state.downtime,
      observedVessels: result.positions.size,
    }),
  );

  const manifest: Manifest = {
    schemaVersion: SCHEMA_VERSION,
    lastRunId: runId,
    lastRunEnd: endedAt,
    warmupUntil,
  };

  fs.mkdirSync(outDir, { recursive: true });
  carryForward(stateDir, outDir);
  writeOutputs(outDir, {
    state,
    manifest,
    closedThisRun: outcome.closed,
    snapshots: buildSnapshots(state, endedAt),
    dailyStats,
    summary: buildSummary({ now: endedAt, events: recentEvents }),
    monthEvents,
  });
  const sizeMb =
    fs.statSync(path.join(outDir, "state", "vessels.ndjson.gz")).size / 1e6;
  console.log(`published to ${outDir} (state ${sizeMb.toFixed(1)} MB gz)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
