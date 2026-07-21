import type { RegionSnapshot, SnapshotVessel, VesselState } from "../../lib/types";
import type { PipelineState } from "./state/store";
import { REGIONS } from "./config/regions";
import { T } from "./config/thresholds";

const SNAPSHOT_ALL_MAX = 30000;

function toSnapshotVessel(v: VesselState): SnapshotVessel {
  return {
    mmsi: v.mmsi,
    lat: Math.round(v.lastPos.lat * 1e5) / 1e5,
    lon: Math.round(v.lastPos.lon * 1e5) / 1e5,
    sog: v.lastPos.sog,
    cog: v.lastPos.cog,
    heading: v.lastPos.heading,
    ts: Math.round(v.lastPos.ts),
    name: v.name,
    shipType: v.shipType,
    flagMid: v.flagMid,
  };
}

export function buildSnapshots(
  state: PipelineState,
  now: number,
): Map<string, object> {
  const cutoff = now - T.snapshotMaxAgeMin * 60;
  const byRegion = new Map<string, SnapshotVessel[]>();
  for (const r of REGIONS) byRegion.set(r.name, []);
  for (const v of state.vessels.values()) {
    if (v.lastSeen < cutoff) continue;
    byRegion.get(v.region)?.push(toSnapshotVessel(v));
  }

  const out = new Map<string, object>();
  const all: SnapshotVessel[] = [];
  for (const [region, vessels] of byRegion) {
    const snap: RegionSnapshot = { region, generatedAt: now, vessels };
    out.set(`snapshot-${region}.json`, snap);
    all.push(...vessels);
  }
  const allSnap: RegionSnapshot = {
    region: "all",
    generatedAt: now,
    vessels: all.slice(0, SNAPSHOT_ALL_MAX),
  };
  out.set("snapshot-all.json", allSnap);
  return out;
}
