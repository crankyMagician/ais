import type { DarkEvent, DowntimeInterval } from "../../../lib/types";
import { typeCategory } from "../../../lib/shiptype";
import { isFocFlag } from "../../../lib/mid";
import { pointInRing } from "../lib/geo";
import { T } from "../config/thresholds";
import type { CellQuality } from "./coverage";

export interface RiskZone {
  name: string;
  label: string;
  rings: number[][][]; // polygons, outer ring only
}

export function loadZones(geojson: {
  features: Array<{
    properties: { name: string; label?: string };
    geometry: { type: string; coordinates: number[][][] };
  }>;
}): RiskZone[] {
  return geojson.features
    .filter((f) => f.geometry.type === "Polygon")
    .map((f) => ({
      name: f.properties.name,
      label: f.properties.label ?? f.properties.name,
      rings: [f.geometry.coordinates[0]],
    }));
}

export interface ClassifyInput {
  ev: Pick<DarkEvent, "lastPos" | "shipType" | "flagMid" | "region">;
  cellQuality: CellQuality;
  effGapMin: number;
  wallGapMin: number;
  zones: RiskZone[];
  downtime: DowntimeInterval[];
  impliedSpeedKn?: number; // present once closed
}

export interface Classification {
  class: DarkEvent["class"];
  score: number;
  tags: string[];
}

const MOORED = 5;
const ANCHORED = 1;

export function classify(input: ClassifyInput): Classification {
  const { ev } = input;
  const tags: string[] = [];
  const cat = typeCategory(ev.shipType);
  const sog = ev.lastPos.sog ?? 0;
  const nav = ev.lastPos.navStatus;

  if ((nav === MOORED || nav === ANCHORED) && sog < 0.5) tags.push("in-port");
  if (cat === "tanker") tags.push("type-tanker");
  if (cat === "cargo") tags.push("type-cargo");
  if (isFocFlag(ev.flagMid)) tags.push("foc-flag");
  for (const z of input.zones)
    if (z.rings.some((r) => pointInRing(ev.lastPos.lon, ev.lastPos.lat, r))) {
      tags.push(`risk-zone:${z.name}`);
      break;
    }

  const baseline = Math.max(
    input.impliedSpeedKn !== undefined ? sog : 0,
    T.positionJumpBaselineKn,
  );
  if (
    input.impliedSpeedKn !== undefined &&
    input.impliedSpeedKn > T.positionJumpFactor * baseline
  )
    tags.push("position-jump");

  // Downtime that ate more than half the wall-clock gap means we mostly
  // weren't looking; that is on us, not the vessel.
  const downtimeShare =
    input.wallGapMin > 0 ? 1 - input.effGapMin / input.wallGapMin : 0;

  let cls: DarkEvent["class"];
  if (input.cellQuality !== "good" || downtimeShare > 0.5) {
    cls = "likely-coverage-loss";
  } else if (
    sog >= T.deliberateMinSogKn &&
    input.effGapMin >= T.deliberateMinGapMin
  ) {
    cls = "possibly-deliberate";
  } else {
    cls = "unknown";
  }

  let score = 0;
  if (input.cellQuality === "good") score += 30;
  if (sog >= T.deliberateMinSogKn) score += 20;
  if (tags.includes("type-tanker") || tags.includes("type-cargo")) score += 15;
  if (tags.some((t) => t.startsWith("risk-zone:"))) score += 15;
  if (tags.includes("foc-flag")) score += 10;
  if (input.effGapMin >= T.deliberateMinGapMin) score += 10;
  if (tags.includes("position-jump")) score += 15;
  if (tags.includes("in-port")) score -= 25;
  score = Math.max(0, Math.min(100, score));

  return { class: cls, score, tags };
}
