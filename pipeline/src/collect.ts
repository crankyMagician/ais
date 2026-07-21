import type { Observation } from "./lib/aisstream";
import { cellKey } from "./lib/geo";
import { regionOf } from "./config/regions";
import { T } from "./config/thresholds";

export interface RunCounts {
  cellMsgs: Map<string, number>;
  cellVessels: Map<string, Set<string>>;
  regionMsgs: Map<string, number>;
  regionVessels: Map<string, Set<string>>;
}

export function makeCounter(): {
  counts: RunCounts;
  onPosition: (obs: Observation) => void;
} {
  const counts: RunCounts = {
    cellMsgs: new Map(),
    cellVessels: new Map(),
    regionMsgs: new Map(),
    regionVessels: new Map(),
  };
  return {
    counts,
    onPosition: (obs) => {
      const key = cellKey(obs.lat, obs.lon, T.cellSizeDeg);
      counts.cellMsgs.set(key, (counts.cellMsgs.get(key) ?? 0) + 1);
      let cv = counts.cellVessels.get(key);
      if (!cv) counts.cellVessels.set(key, (cv = new Set()));
      cv.add(obs.mmsi);

      const region = regionOf(obs.lat, obs.lon)?.name ?? "outside";
      counts.regionMsgs.set(region, (counts.regionMsgs.get(region) ?? 0) + 1);
      let rv = counts.regionVessels.get(region);
      if (!rv) counts.regionVessels.set(region, (rv = new Set()));
      rv.add(obs.mmsi);
    },
  };
}
