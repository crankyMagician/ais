"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { fetchData, fetchNdjson } from "@/lib/data";
import { flagName } from "@/lib/mid";
import { typeLabel } from "@/lib/shiptype";
import type {
  DarkEvent,
  Manifest,
  RunRecord,
  StatsSummary,
} from "@/lib/types";
import { GAP_BUCKETS } from "@/lib/types";
import { REGIONS } from "@/pipeline/src/config/regions";
import {
  CLASS_COLORS,
  CLASS_LABELS,
  ClassSplit,
  CoverageStrip,
  HBarChart,
  Histogram,
} from "./charts";

const EventsMap = dynamic(() => import("./EventsMap"), { ssr: false });

const REGION_LABEL = new Map(REGIONS.map((r) => [r.name, r.label]));

function fmtGapMin(min: number | undefined): string {
  if (min === undefined) return "–";
  if (min < 90) return `${Math.round(min)} min`;
  if (min < 48 * 60) return `${(min / 60).toFixed(1)} h`;
  return `${(min / 1440).toFixed(1)} d`;
}

function fmtAgo(ts: number, now: number): string {
  return fmtGapMin((now - ts) / 60) + " ago";
}

function monthsBack(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    out.push(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
    );
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
}

function EventRow({ e, now }: { e: DarkEvent; now: number }) {
  const openGap = e.gapMin ?? (now - e.lastSeenAt) / 60;
  return (
    <tr>
      <td>
        {e.name || `MMSI ${e.mmsi}`}
        <div className="muted small">{flagName(e.flagMid)}</div>
      </td>
      <td>{typeLabel(e.shipType)}</td>
      <td>{REGION_LABEL.get(e.region) ?? e.region}</td>
      <td className="num">{fmtAgo(e.lastSeenAt, now)}</td>
      <td className="num">{fmtGapMin(openGap)}</td>
      <td>
        <span className="swatch" style={{ background: CLASS_COLORS[e.class] }} />
        {CLASS_LABELS[e.class]}
      </td>
      <td>
        {e.resolution === "expired" && <span className="tag">expired</span>}
        {e.impliedSpeedKn !== undefined && (
          <span className="tag">{e.impliedSpeedKn} kn implied</span>
        )}
        {e.tags.map((t) => (
          <span key={t} className="tag">
            {t}
          </span>
        ))}
      </td>
    </tr>
  );
}

function EventsTable({ events, now }: { events: DarkEvent[]; now: number }) {
  if (!events.length) return <p className="muted">None.</p>;
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            <th>Vessel</th>
            <th>Type</th>
            <th>Region</th>
            <th>Last seen</th>
            <th>Gap</th>
            <th>Class</th>
            <th>Signals</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <EventRow key={e.id} e={e} now={now} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DarkDashboard() {
  const [summary, setSummary] = useState<StatsSummary | null>(null);
  const [openEvents, setOpenEvents] = useState<DarkEvent[]>([]);
  const [closedEvents, setClosedEvents] = useState<DarkEvent[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loading, setLoading] = useState(true);
  const now = Date.now() / 1000;

  useEffect(() => {
    (async () => {
      const [sum, open, man, runRecords, ...months] = await Promise.all([
        fetchData<StatsSummary>("stats/summary.json"),
        fetchData<DarkEvent[]>("live/events-open.json"),
        fetchData<Manifest>("meta/manifest.json"),
        fetchNdjson<RunRecord>("state/runs.ndjson"),
        ...monthsBack(2).map((m) => fetchNdjson<DarkEvent>(`events/${m}.ndjson`)),
      ]);
      setSummary(sum);
      setOpenEvents(
        (open ?? []).sort((a, b) => b.score - a.score || b.openedAt - a.openedAt),
      );
      setManifest(man);
      setRuns(runRecords);
      setClosedEvents(
        months
          .flat()
          .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
          .slice(0, 30),
      );
      setLoading(false);
    })();
  }, []);

  const w30 = summary?.totals?.["30"];
  const w7 = summary?.totals?.["7"];

  const regionBars = useMemo(
    () =>
      Object.entries(w30?.byRegion ?? {})
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => ({ label: REGION_LABEL.get(k) ?? k, value: v })),
    [w30],
  );
  const flagBars = useMemo(
    () =>
      Object.entries(w30?.byFlag ?? {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([k, v]) => ({ label: flagName(k), value: v })),
    [w30],
  );
  const gapHist = useMemo(
    () =>
      GAP_BUCKETS.map((b) => ({
        label: b.label,
        value: w30?.gapHistogram?.[b.label] ?? 0,
      })),
    [w30],
  );
  const stripRuns = useMemo(
    () =>
      runs.map((r) => ({
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        degraded: Object.values(r.regions).some((x) => x.degraded),
      })),
    [runs],
  );

  if (loading) return <p className="muted">Loading data…</p>;
  if (!manifest)
    return (
      <p className="muted">
        No data published yet. The collection pipeline has not completed its
        first run; check back once the data branch exists.
      </p>
    );

  const inWarmup = now < manifest.warmupUntil;

  return (
    <>
      <div className="tiles">
        <div className="tile">
          <div className="tile-value">{openEvents.length}</div>
          <div className="tile-label">open dark events</div>
        </div>
        <div className="tile">
          <div className="tile-value">{w7?.eventsOpened ?? 0}</div>
          <div className="tile-label">opened, last 7 days</div>
        </div>
        <div className="tile">
          <div className="tile-value">
            {w7?.byClass?.["possibly-deliberate"] ?? 0}
          </div>
          <div className="tile-label">possibly deliberate, 7 days</div>
        </div>
        <div className="tile">
          <div className="tile-value">{fmtAgo(manifest.lastRunEnd, now)}</div>
          <div className="tile-label">last collection run</div>
        </div>
      </div>

      {inWarmup && (
        <p className="muted">
          The pipeline is in warmup after a cold start; event detection begins
          once it has enough history (about two hours).
        </p>
      )}

      <h2>Where events sit right now</h2>
      <EventsMap open={openEvents} closed={closedEvents} />

      <h2>Observation coverage, last 48 h</h2>
      <p className="muted small">
        Gaps in our own collection are subtracted from every absence clock;
        they never count against a vessel.
      </p>
      <CoverageStrip runs={stripRuns} now={now} />

      <h2>Open events</h2>
      <EventsTable events={openEvents} now={now} />

      <h2>Recently closed</h2>
      <EventsTable events={closedEvents} now={now} />

      <div className="chartgrid">
        <section>
          <h2>Classification, last 30 days</h2>
          <ClassSplit counts={w30?.byClass ?? {}} />
        </section>
        <section>
          <h2>Gap durations, last 30 days</h2>
          <Histogram data={gapHist} />
        </section>
        <section>
          <h2>Events by region, last 30 days</h2>
          <HBarChart data={regionBars} />
        </section>
        <section>
          <h2>Events by flag state, last 30 days</h2>
          <HBarChart data={flagBars} />
        </section>
      </div>
    </>
  );
}
