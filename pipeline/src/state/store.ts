import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import type {
  DarkEvent,
  DowntimeInterval,
  Manifest,
  RunRecord,
  VesselState,
} from "../../../lib/types";
import {
  SCHEMA_VERSION,
  coverageSchema,
  darkEventSchema,
  downtimeSchema,
  manifestSchema,
  runRecordSchema,
  vesselStateSchema,
} from "./schema";

export interface CoverageCell {
  emaMsgs: number;
  emaVessels: number;
  runs: number;
}

export interface PipelineState {
  vessels: Map<string, VesselState>;
  coverageCells: Map<string, CoverageCell>;
  regionEma: Map<string, number>;
  openEvents: Map<string, DarkEvent>;
  downtime: DowntimeInterval[];
  runs: RunRecord[];
  manifest: Manifest | null; // null = cold start
}

function readGz(file: string): string {
  return zlib.gunzipSync(fs.readFileSync(file)).toString("utf8");
}

function writeGz(file: string, content: string): void {
  fs.writeFileSync(file, zlib.gzipSync(Buffer.from(content, "utf8")));
}

function readNdjson<T>(file: string, parse: (o: unknown) => T): T[] {
  if (!fs.existsSync(file)) return [];
  const raw = file.endsWith(".gz") ? readGz(file) : fs.readFileSync(file, "utf8");
  const out: T[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    out.push(parse(JSON.parse(line)));
  }
  return out;
}

export function loadState(stateDir: string): PipelineState {
  const empty: PipelineState = {
    vessels: new Map(),
    coverageCells: new Map(),
    regionEma: new Map(),
    openEvents: new Map(),
    downtime: [],
    runs: [],
    manifest: null,
  };
  const manifestFile = path.join(stateDir, "meta", "manifest.json");
  if (!fs.existsSync(manifestFile)) return empty;

  const manifest = manifestSchema.parse(
    JSON.parse(fs.readFileSync(manifestFile, "utf8")),
  ) as Manifest;
  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    console.warn(
      `state schema ${manifest.schemaVersion} != ${SCHEMA_VERSION}; cold start`,
    );
    return empty;
  }

  const vessels = new Map<string, VesselState>();
  for (const v of readNdjson(
    path.join(stateDir, "state", "vessels.ndjson.gz"),
    (o) => vesselStateSchema.parse(o) as VesselState,
  ))
    vessels.set(v.mmsi, v);

  const covFile = path.join(stateDir, "state", "coverage.json.gz");
  const coverageCells = new Map<string, CoverageCell>();
  const regionEma = new Map<string, number>();
  if (fs.existsSync(covFile)) {
    const cov = coverageSchema.parse(JSON.parse(readGz(covFile)));
    for (const [k, c] of Object.entries(cov.cells)) coverageCells.set(k, c);
    for (const [k, v] of Object.entries(cov.regionEma)) regionEma.set(k, v);
  }

  const openEvents = new Map<string, DarkEvent>();
  const openFile = path.join(stateDir, "live", "events-open.json");
  if (fs.existsSync(openFile)) {
    for (const e of JSON.parse(fs.readFileSync(openFile, "utf8")) as unknown[]) {
      const ev = darkEventSchema.parse(e) as DarkEvent;
      openEvents.set(ev.id, ev);
    }
  }

  return {
    vessels,
    coverageCells,
    regionEma,
    openEvents,
    downtime: readNdjson(path.join(stateDir, "meta", "downtime.ndjson"), (o) =>
      downtimeSchema.parse(o),
    ),
    runs: readNdjson(path.join(stateDir, "state", "runs.ndjson"), (o) =>
      runRecordSchema.parse(o) as RunRecord,
    ),
    manifest,
  };
}

export function loadMonthEvents(stateDir: string, month: string): DarkEvent[] {
  return readNdjson(
    path.join(stateDir, "events", `${month}.ndjson`),
    (o) => darkEventSchema.parse(o) as DarkEvent,
  );
}

export interface PublishInputs {
  state: PipelineState;
  manifest: Manifest;
  closedThisRun: DarkEvent[];
  snapshots: Map<string, object>; // filename -> JSON content
  dailyStats: Map<string, object>; // date -> stats
  summary: object;
  monthEvents: Map<string, DarkEvent[]>; // YYYY-MM -> full month contents
}

export function writeOutputs(outDir: string, p: PublishInputs): void {
  const dirs = ["state", "meta", "live", "events", path.join("stats", "daily")];
  for (const d of dirs) fs.mkdirSync(path.join(outDir, d), { recursive: true });

  writeGz(
    path.join(outDir, "state", "vessels.ndjson.gz"),
    [...p.state.vessels.values()].map((v) => JSON.stringify(v)).join("\n"),
  );
  writeGz(
    path.join(outDir, "state", "coverage.json.gz"),
    JSON.stringify({
      cells: Object.fromEntries(p.state.coverageCells),
      regionEma: Object.fromEntries(p.state.regionEma),
    }),
  );
  fs.writeFileSync(
    path.join(outDir, "state", "runs.ndjson"),
    p.state.runs.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
  fs.writeFileSync(
    path.join(outDir, "meta", "manifest.json"),
    JSON.stringify(p.manifest, null, 2),
  );
  fs.writeFileSync(
    path.join(outDir, "meta", "downtime.ndjson"),
    p.state.downtime.map((d) => JSON.stringify(d)).join("\n") + "\n",
  );
  fs.writeFileSync(
    path.join(outDir, "live", "events-open.json"),
    JSON.stringify([...p.state.openEvents.values()], null, 1),
  );
  for (const [name, content] of p.snapshots)
    fs.writeFileSync(path.join(outDir, "live", name), JSON.stringify(content));
  for (const [month, events] of p.monthEvents)
    fs.writeFileSync(
      path.join(outDir, "events", `${month}.ndjson`),
      events.map((e) => JSON.stringify(e)).join("\n") + (events.length ? "\n" : ""),
    );
  for (const [date, stats] of p.dailyStats)
    fs.writeFileSync(
      path.join(outDir, "stats", "daily", `${date}.json`),
      JSON.stringify(stats, null, 1),
    );
  fs.writeFileSync(
    path.join(outDir, "stats", "summary.json"),
    JSON.stringify(p.summary, null, 1),
  );
}

// Copies event/stat files forward from the previous state dir so the new
// output tree is complete (the data branch is replaced wholesale every run).
export function carryForward(stateDir: string, outDir: string): void {
  for (const sub of ["events", path.join("stats", "daily")]) {
    const from = path.join(stateDir, sub);
    if (!fs.existsSync(from)) continue;
    const to = path.join(outDir, sub);
    fs.mkdirSync(to, { recursive: true });
    for (const f of fs.readdirSync(from))
      fs.copyFileSync(path.join(from, f), path.join(to, f));
  }
}
