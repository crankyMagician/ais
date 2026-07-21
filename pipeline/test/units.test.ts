import { describe, expect, it } from "vitest";
import { foldMessage, type CollectResult } from "../src/lib/aisstream";
import {
  cellKey,
  destPoint,
  distToBboxEdgeNm,
  haversineNm,
  pointInRing,
} from "../src/lib/geo";
import { NmeaDecoder } from "../src/lib/nmea";
import { effectiveAbsenceMin } from "../src/detect/health";
import { classify } from "../src/detect/classify";
import { regionOf, WORLD_BOXES } from "../src/config/regions";

function empty(): CollectResult {
  return { positions: new Map(), statics: new Map(), msgCount: 0 };
}

describe("aisstream message folding", () => {
  it("parses PositionReport envelopes", () => {
    const r = empty();
    foldMessage(
      JSON.stringify({
        MessageType: "PositionReport",
        MetaData: {
          MMSI: 266123000,
          ShipName: "TEST SHIP@@@",
          latitude: 58.1,
          longitude: 20.2,
          time_utc: "2026-07-21 20:58:15.905454636 +0000 UTC",
        },
        Message: {
          PositionReport: {
            UserID: 266123000,
            Latitude: 58.1,
            Longitude: 20.2,
            Sog: 12.3,
            Cog: 271.1,
            TrueHeading: 270,
            NavigationalStatus: 0,
          },
        },
      }),
      r,
      0,
    );
    const p = r.positions.get("266123000")!;
    expect(p.lat).toBe(58.1);
    expect(p.sog).toBe(12.3);
    expect(p.heading).toBe(270);
    expect(p.ts).toBe(Date.parse("2026-07-21T20:58:15Z") / 1000);
    expect(r.statics.get("266123000")?.name).toBe("TEST SHIP");
  });

  it("parses ShipStaticData and merges", () => {
    const r = empty();
    foldMessage(
      JSON.stringify({
        MessageType: "ShipStaticData",
        MetaData: { MMSI: 266123000, time_utc: "" },
        Message: {
          ShipStaticData: {
            Name: "MV EXAMPLE",
            CallSign: "ABCD",
            ImoNumber: 9312345,
            Type: 82,
            Destination: "RIGA",
            MaximumStaticDraught: 7.4,
          },
        },
      }),
      r,
      100,
    );
    const s = r.statics.get("266123000")!;
    expect(s.shipType).toBe(82);
    expect(s.imo).toBe(9312345);
    expect(s.dest).toBe("RIGA");
  });

  it("ignores junk and out-of-range positions", () => {
    const r = empty();
    foldMessage("not json", r, 0);
    foldMessage(
      JSON.stringify({
        MessageType: "PositionReport",
        MetaData: { MMSI: 1, time_utc: "" },
        Message: { PositionReport: { Latitude: 99, Longitude: 20 } },
      }),
      r,
      0,
    );
    expect(r.positions.size).toBe(0);
  });
});

describe("AIVDM decoding (Kystverket feed)", () => {
  // reference sentences from the gpsd AIVDM documentation
  it("decodes a Class A position report", () => {
    const d = new NmeaDecoder();
    const out = d.decodeLine("!AIVDM,1,1,,B,177KQJ5000G?tO`K>RA1wUbN0TKH,0*5C", 1000);
    expect(out?.kind).toBe("position");
    if (out?.kind !== "position") return;
    expect(out.obs.mmsi).toBe("477553000");
    expect(out.obs.lat).toBeCloseTo(47.5828, 3);
    expect(out.obs.lon).toBeCloseTo(-122.3458, 3);
    expect(out.obs.sog).toBe(0);
    expect(out.obs.ts).toBe(1000);
  });

  it("uses the tag-block timestamp when present", () => {
    const d = new NmeaDecoder();
    const out = d.decodeLine(
      "\\s:2573235,c:1784670391*0B\\!BSVDM,1,1,,A,13m7>MPP000HE7`RBWB1Swvt0@B@,0*1E",
      99,
    );
    expect(out?.kind).toBe("position");
    if (out?.kind !== "position") return;
    expect(out.obs.ts).toBe(1784670391);
    expect(out.obs.mmsi.length).toBe(9);
  });

  it("assembles a multipart type 5 static message", () => {
    const d = new NmeaDecoder();
    const first = d.decodeLine(
      "!AIVDM,2,1,3,B,55P5TL01VIaAL@7WKO@mBplU@<PDhh000000001S;AJ::4A80?4i@E53,0*3E",
      1000,
    );
    expect(first).toBeNull();
    const out = d.decodeLine("!AIVDM,2,2,3,B,1@0000000000000,2*55", 1001);
    expect(out?.kind).toBe("static");
    if (out?.kind !== "static") return;
    expect(out.info.mmsi).toBe("369190000");
    expect(out.info.name).toBe("MT.MITCHELL");
    expect(out.info.callsign).toBe("WDA9674");
    expect(out.info.imo).toBe(6710932);
    expect(out.info.dest).toBe("SEATTLE");
    expect(out.info.draught).toBe(6);
  });

  it("decodes a Class B position report (type 18)", () => {
    const d = new NmeaDecoder();
    const out = d.decodeLine(
      "!AIVDM,1,1,,A,B52K>;h00Fc>jpUlNV@ikwpUoP06,0*4C",
      1000,
    );
    expect(out?.kind).toBe("position");
    if (out?.kind !== "position") return;
    expect(Math.abs(out.obs.lat)).toBeLessThanOrEqual(90);
    expect(Math.abs(out.obs.lon)).toBeLessThanOrEqual(180);
  });

  it("ignores junk lines", () => {
    const d = new NmeaDecoder();
    expect(d.decodeLine("$GPGGA,junk", 0)).toBeNull();
    expect(d.decodeLine("garbage", 0)).toBeNull();
    expect(d.decodeLine("\\c:123*00\\!AIVDM,bad", 0)).toBeNull();
  });
});

describe("geo", () => {
  it("haversine: one degree of latitude is 60 nm", () => {
    expect(haversineNm(58, 20, 59, 20)).toBeCloseTo(60, 0);
  });

  it("destPoint inverts haversine", () => {
    const d = destPoint(58, 20, 45, 100);
    expect(haversineNm(58, 20, d.lat, d.lon)).toBeCloseTo(100, 1);
  });

  it("bbox edge distance", () => {
    const b = { latMin: 53.5, latMax: 66, lonMin: 9.5, lonMax: 30.5 };
    expect(distToBboxEdgeNm(65.9, 20, b)).toBeLessThan(15);
    expect(distToBboxEdgeNm(58, 20, b)).toBeGreaterThan(100);
  });

  it("point in ring", () => {
    const ring = [
      [22.5, 59.2],
      [29.5, 59.2],
      [29.5, 60.5],
      [22.5, 60.5],
      [22.5, 59.2],
    ];
    expect(pointInRing(25, 59.8, ring)).toBe(true);
    expect(pointInRing(20, 59.8, ring)).toBe(false);
  });

  it("cellKey handles negative coordinates", () => {
    expect(cellKey(-0.1, -0.1, 0.25)).toBe("-1:-1");
  });
});

describe("regions", () => {
  it("maps positions to watch regions", () => {
    expect(regionOf(58, 20)?.name).toBe("baltic");
    expect(regionOf(26.5, 56)?.name).toBe("persian-gulf");
    expect(regionOf(62.5, 5.5)?.name).toBe("norway");
    expect(regionOf(59.9, 10.7)?.name).toBe("baltic"); // Oslo fjord overlap goes to first match
    expect(regionOf(0, -30)).toBeNull();
  });

  it("subscribes to the whole world on aisstream", () => {
    expect(WORLD_BOXES).toEqual([
      [
        [-90, -180],
        [90, 180],
      ],
    ]);
  });
});

describe("effective absence", () => {
  const t0 = 1_750_000_000;
  it("equals wall clock with no downtime", () => {
    expect(effectiveAbsenceMin(t0, t0 + 7200, "baltic", [])).toBe(120);
  });

  it("subtracts collector downtime and region degradation", () => {
    const downtime = [
      { from: t0, to: t0 + 3600, kind: "collector-down" as const },
      { from: t0 + 3600, to: t0 + 5400, kind: "degraded" as const, region: "baltic" },
      { from: t0 + 3600, to: t0 + 7200, kind: "degraded" as const, region: "black-sea" },
    ];
    expect(effectiveAbsenceMin(t0, t0 + 7200, "baltic", downtime)).toBe(30);
  });

  it("merges overlapping intervals instead of double counting", () => {
    const downtime = [
      { from: t0, to: t0 + 3600, kind: "collector-down" as const },
      { from: t0 + 1800, to: t0 + 5400, kind: "collector-down" as const },
    ];
    expect(effectiveAbsenceMin(t0, t0 + 7200, "baltic", downtime)).toBe(30);
  });
});

describe("classification", () => {
  const basePos = {
    lat: 59.9,
    lon: 27.0,
    sog: 8,
    cog: 90,
    heading: null,
    navStatus: 0,
    ts: 0,
  };
  const zones = [
    {
      name: "gulf-of-finland",
      label: "Gulf of Finland",
      rings: [
        [
          [22.5, 59.2],
          [29.5, 59.2],
          [29.5, 60.5],
          [22.5, 60.5],
          [22.5, 59.2],
        ],
      ],
    },
  ];

  it("tags a tanker with FOC flag in a risk zone and calls it possibly-deliberate", () => {
    const c = classify({
      ev: { lastPos: basePos, shipType: 84, flagMid: "626", region: "baltic" },
      cellQuality: "good",
      effGapMin: 400,
      wallGapMin: 420,
      zones,
      downtime: [],
    });
    expect(c.class).toBe("possibly-deliberate");
    expect(c.tags).toEqual(
      expect.arrayContaining(["type-tanker", "foc-flag", "risk-zone:gulf-of-finland"]),
    );
    expect(c.score).toBeGreaterThanOrEqual(60);
  });

  it("calls edge-cell disappearances likely-coverage-loss", () => {
    const c = classify({
      ev: { lastPos: basePos, shipType: 70, flagMid: "230", region: "baltic" },
      cellQuality: "edge",
      effGapMin: 400,
      wallGapMin: 420,
      zones: [],
      downtime: [],
    });
    expect(c.class).toBe("likely-coverage-loss");
  });

  it("blames the collector when downtime ate most of the gap", () => {
    const c = classify({
      ev: { lastPos: basePos, shipType: 70, flagMid: "230", region: "baltic" },
      cellQuality: "good",
      effGapMin: 60,
      wallGapMin: 400,
      zones: [],
      downtime: [],
    });
    expect(c.class).toBe("likely-coverage-loss");
  });

  it("tags moored slow vessels as in-port", () => {
    const c = classify({
      ev: {
        lastPos: { ...basePos, sog: 0.1, navStatus: 5 },
        shipType: 70,
        flagMid: "230",
        region: "baltic",
      },
      cellQuality: "good",
      effGapMin: 400,
      wallGapMin: 420,
      zones: [],
      downtime: [],
    });
    expect(c.tags).toContain("in-port");
    expect(c.class).toBe("unknown");
  });
});
