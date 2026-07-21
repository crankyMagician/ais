export interface Bbox {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

export interface Region {
  name: string;
  label: string;
  bbox: Bbox;
}

export const REGIONS: Region[] = [
  {
    name: "baltic",
    label: "Baltic Sea",
    bbox: { latMin: 53.5, latMax: 66.0, lonMin: 9.5, lonMax: 30.5 },
  },
  {
    name: "black-sea",
    label: "Black Sea",
    bbox: { latMin: 40.5, latMax: 47.5, lonMin: 27.0, lonMax: 42.0 },
  },
  {
    name: "east-med",
    label: "Eastern Mediterranean",
    bbox: { latMin: 30.0, latMax: 38.5, lonMin: 19.0, lonMax: 36.5 },
  },
  {
    name: "persian-gulf",
    label: "Persian Gulf and Gulf of Oman",
    bbox: { latMin: 23.5, latMax: 30.5, lonMin: 47.0, lonMax: 60.0 },
  },
  {
    name: "gulf-of-guinea",
    label: "Gulf of Guinea",
    bbox: { latMin: -1.0, latMax: 7.0, lonMin: -8.0, lonMax: 10.0 },
  },
  {
    name: "south-china-sea",
    label: "South China Sea",
    bbox: { latMin: 1.0, latMax: 25.0, lonMin: 105.0, lonMax: 121.0 },
  },
];

export function regionOf(lat: number, lon: number): Region | null {
  for (const r of REGIONS) {
    const b = r.bbox;
    if (lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax)
      return r;
  }
  return null;
}

// aisstream BoundingBoxes: [[lat, lon], [lat, lon]] corner pairs.
export function toAisstreamBoxes(): number[][][] {
  return REGIONS.map((r) => [
    [r.bbox.latMin, r.bbox.lonMin],
    [r.bbox.latMax, r.bbox.lonMax],
  ]);
}
