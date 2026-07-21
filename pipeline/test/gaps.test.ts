import { describe, expect, it } from "vitest";
import { T0, RUN_GAP, goodCellsAround, makeSim, obs, step } from "./helpers";

// Mid-Baltic point, far from every watch-region edge.
const LAT = 58.0;
const LON = 20.0;

function seedEligible(sim: ReturnType<typeof makeSim>, mmsi = "266123000") {
  goodCellsAround(sim.state, LAT, LON);
  for (let i = 0; i < 3; i++)
    step(sim, [obs(mmsi, LAT, LON, T0 + sim.runIndex * RUN_GAP)]);
  return mmsi;
}

describe("gap event lifecycle", () => {
  it("opens an event for a mid-coverage disappearance", () => {
    const sim = makeSim();
    const mmsi = seedEligible(sim);
    // absent runs: 30, 60 (missing), 90 min (open)
    step(sim, []);
    step(sim, []);
    const out = step(sim, []);
    expect(out.opened).toHaveLength(1);
    expect(out.opened[0].mmsi).toBe(mmsi);
    expect(out.opened[0].cellQuality).toBe("good");
    expect(sim.state.vessels.get(mmsi)?.status).toBe("dark-open");
  });

  it("does not open events for vessels seen only once", () => {
    const sim = makeSim();
    goodCellsAround(sim.state, LAT, LON);
    step(sim, [obs("266999000", LAT, LON, T0)]);
    for (let i = 0; i < 5; i++) step(sim, []);
    expect(sim.allOpened).toHaveLength(0);
    expect(sim.state.vessels.get("266999000")?.status).toBe("lost");
  });

  it("suppresses disappearances from marginal-coverage cells", () => {
    const sim = makeSim();
    // no goodCellsAround: the cell has no coverage history
    for (let i = 0; i < 3; i++)
      step(sim, [obs("266111000", LAT, LON, T0 + sim.runIndex * RUN_GAP)]);
    for (let i = 0; i < 3; i++) step(sim, []);
    expect(sim.allOpened).toHaveLength(0);
    expect(sim.state.vessels.get("266111000")?.status).toBe("lost");
  });

  it("suppresses fast vessels whose dead reckoning exits the region", () => {
    const sim = makeSim();
    // near the Baltic north edge (latMax 66), heading north at 20 kn
    const lat = 65.6;
    const lon = 20.0;
    goodCellsAround(sim.state, lat, lon);
    const mmsi = "230555000";
    for (let i = 0; i < 3; i++)
      step(sim, [obs(mmsi, lat, lon, T0 + sim.runIndex * RUN_GAP, { sog: 20, cog: 0 })]);
    for (let i = 0; i < 3; i++) step(sim, []);
    expect(sim.allOpened).toHaveLength(0);
    expect(sim.state.vessels.get(mmsi)?.status).toBe("lost");
  });

  it("treats collector downtime as not-observed time, not vessel absence", () => {
    const sim = makeSim();
    const mmsi = seedEligible(sim);
    const lastSeen = T0 + 2 * RUN_GAP;
    // collector was down for the next 2 hours
    sim.state.downtime.push({
      from: lastSeen,
      to: lastSeen + 2 * 3600,
      kind: "collector-down",
    });
    sim.runIndex += 4; // resume 2h later
    const out = step(sim, []);
    // effective absence is only ~30 min: no event, not even missing yet
    expect(out.opened).toHaveLength(0);
    expect(sim.state.vessels.get(mmsi)?.status).toBe("active");
  });

  it("skips absence transitions in degraded regions", () => {
    const sim = makeSim();
    const mmsi = seedEligible(sim);
    for (let i = 0; i < 3; i++)
      step(sim, [], { degradedRegions: new Set(["baltic"]) });
    expect(sim.allOpened).toHaveLength(0);
    expect(sim.state.vessels.get(mmsi)?.status).toBe("active");
  });

  it("does not open events during warmup", () => {
    const sim = makeSim();
    const mmsi = seedEligible(sim);
    for (let i = 0; i < 3; i++) step(sim, [], { warmup: true });
    expect(sim.allOpened).toHaveLength(0);
    expect(sim.state.vessels.get(mmsi)?.status).toBe("missing");
  });

  it("closes on reappearance with gap, distance and implied speed", () => {
    const sim = makeSim();
    const mmsi = seedEligible(sim);
    for (let i = 0; i < 3; i++) step(sim, []);
    expect(sim.state.openEvents.size).toBe(1);

    // reappears 3 runs later, 30 nm north (0.5 deg of latitude)
    const reappearTs = T0 + 8 * RUN_GAP;
    const out = step(sim, [obs(mmsi, LAT + 0.5, LON, reappearTs)]);
    expect(out.closed).toHaveLength(1);
    const ev = out.closed[0];
    expect(ev.resolution).toBe("reappeared");
    // last seen run 2 (t0+60m), reappeared run 8 (t0+240m): 180 min
    expect(ev.wallClockGapMin).toBe(180);
    expect(ev.distanceNm).toBeGreaterThan(28);
    expect(ev.distanceNm).toBeLessThan(32);
    expect(ev.impliedSpeedKn).toBeCloseTo(ev.distanceNm! / 3, 0);
    expect(sim.state.openEvents.size).toBe(0);
    expect(sim.state.vessels.get(mmsi)?.status).toBe("active");
  });

  it("tags impossible reappearance speeds as position-jump", () => {
    const sim = makeSim();
    const mmsi = seedEligible(sim);
    for (let i = 0; i < 3; i++) step(sim, []);
    // reappears 300 nm away after 3 h: ~100 kn implied
    const out = step(sim, [obs(mmsi, LAT + 5.0, LON, T0 + 8 * RUN_GAP)]);
    expect(out.closed[0].tags).toContain("position-jump");
  });

  it("opens nothing when a whole region vanishes at once (circuit breaker)", () => {
    const sim = makeSim();
    goodCellsAround(sim.state, LAT, LON);
    const fleet = Array.from({ length: 120 }, (_, i) => `2661${String(i).padStart(5, "0")}`);
    for (let i = 0; i < 3; i++)
      step(
        sim,
        fleet.map((m) => obs(m, LAT, LON, T0 + sim.runIndex * RUN_GAP)),
      );
    // everything disappears simultaneously: receiver outage, not a fleet going dark
    for (let i = 0; i < 3; i++) step(sim, []);
    expect(sim.allOpened).toHaveLength(0);
  });

  it("expires events still open after 14 days", () => {
    const sim = makeSim();
    const mmsi = seedEligible(sim);
    for (let i = 0; i < 3; i++) step(sim, []);
    expect(sim.state.openEvents.size).toBe(1);
    sim.runIndex += Math.ceil((15 * 24 * 3600) / RUN_GAP);
    const out = step(sim, []);
    expect(out.closed).toHaveLength(1);
    expect(out.closed[0].resolution).toBe("expired");
    expect(sim.state.vessels.get(mmsi)?.status).toBe("lost");
  });

  it("classifies an underway 6h+ gap in good coverage as possibly-deliberate", () => {
    const sim = makeSim();
    const mmsi = seedEligible(sim);
    for (let i = 0; i < 3; i++) step(sim, []);
    expect(sim.state.openEvents.size).toBe(1);
    // let the open event age past 6 h; reclassification runs each cycle
    sim.runIndex += 12;
    step(sim, []);
    const ev = [...sim.state.openEvents.values()][0];
    expect(ev.mmsi).toBe(mmsi);
    expect(ev.class).toBe("possibly-deliberate");
  });
});
