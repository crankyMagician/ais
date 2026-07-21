import type { Bbox } from "../config/regions";

const R_NM = 3440.065; // earth radius in nautical miles
const DEG = Math.PI / 180;

export function haversineNm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function cellKey(lat: number, lon: number, sizeDeg: number): string {
  return `${Math.floor(lat / sizeDeg)}:${Math.floor(lon / sizeDeg)}`;
}

export function neighborKeys(key: string): string[] {
  const [y, x] = key.split(":").map(Number);
  const out: string[] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++)
      if (dy !== 0 || dx !== 0) out.push(`${y + dy}:${x + dx}`);
  return out;
}

export function destPoint(
  lat: number,
  lon: number,
  bearingDeg: number,
  distNm: number,
): { lat: number; lon: number } {
  const br = bearingDeg * DEG;
  const d = distNm / R_NM;
  const la1 = lat * DEG;
  const lo1 = lon * DEG;
  const la2 = Math.asin(
    Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(br),
  );
  const lo2 =
    lo1 +
    Math.atan2(
      Math.sin(br) * Math.sin(d) * Math.cos(la1),
      Math.cos(d) - Math.sin(la1) * Math.sin(la2),
    );
  return { lat: la2 / DEG, lon: ((lo2 / DEG + 540) % 360) - 180 };
}

export function inBbox(lat: number, lon: number, b: Bbox): boolean {
  return lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax;
}

// Distance from a point to the nearest bbox edge, in nautical miles.
// Approximate (equirectangular) — fine at the 15 nm buffer scale.
export function distToBboxEdgeNm(lat: number, lon: number, b: Bbox): number {
  const latNm = (d: number) => d * 60;
  const lonNm = (d: number) => d * 60 * Math.cos(lat * DEG);
  return Math.min(
    latNm(lat - b.latMin),
    latNm(b.latMax - lat),
    lonNm(lon - b.lonMin),
    lonNm(b.lonMax - lon),
  );
}

export function pointInRing(
  lon: number,
  lat: number,
  ring: number[][],
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    )
      inside = !inside;
  }
  return inside;
}
