import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  NOTABLE_DEPTH_M,
  gateClosedFraction,
  laggedCorrelation,
  pearson,
  qualitativeCheck,
  runFloodModel,
  summariseCorrelations,
} from "../src/lib/floodModel";
import type { DriversDoc, FeatureCollection, FloodZoneFeature, ProjectFeature, WaterwayFeature } from "../src/types";
import { pointInRing } from "../src/lib/geo";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data");
const read = <T>(f: string): T => JSON.parse(readFileSync(join(dataDir, f), "utf8")) as T;

const zones = read<FeatureCollection<FloodZoneFeature>>("flood-zones.geojson");
const drivers = read<DriversDoc>("flood-drivers-timeline.json");
const projects = read<FeatureCollection<ProjectFeature>>("projects.geojson");
const waterways = read<FeatureCollection<WaterwayFeature>>("waterways.geojson");

describe("tidal gating", () => {
  it("leaves the outfall open when the tide never reaches the invert", () => {
    expect(gateClosedFraction(0.4, 0.6)).toBe(0);
  });

  it("shuts the outfall for half the day when the invert sits at mean sea level", () => {
    expect(gateClosedFraction(1.0, 0)).toBeCloseTo(0.5, 6);
  });

  it("shuts the outfall all day when the invert is below the tidal trough", () => {
    expect(gateClosedFraction(1.2, -1.5)).toBe(1);
  });

  it("closes for longer as the tide rises above a fixed invert", () => {
    const low = gateClosedFraction(0.7, 0.4);
    const high = gateClosedFraction(1.1, 0.4);
    expect(high).toBeGreaterThan(low);
  });
});

describe("flood model", () => {
  const run = runFloodModel(zones.features, drivers.days);

  it("produces a state for every zone on every day", () => {
    expect(run.dates).toHaveLength(drivers.days.length);
    for (const zone of zones.features) {
      expect(run.zones[zone.id]).toHaveLength(drivers.days.length);
    }
  });

  it("never produces negative depth", () => {
    for (const states of Object.values(run.zones)) {
      for (const s of states) expect(s.depthM).toBeGreaterThanOrEqual(0);
    }
  });

  it("responds to the largest rainfall day within a couple of days", () => {
    const peakRainIdx = drivers.days.reduce(
      (best, d, i) => (d.rain_mm > drivers.days[best].rain_mm ? i : best),
      0,
    );
    const window = run.provincialMeanDepthM.slice(peakRainIdx, peakRainIdx + 3);
    const before = run.provincialMeanDepthM[Math.max(0, peakRainIdx - 1)];
    expect(Math.max(...window)).toBeGreaterThan(before);
  });

  it("floods the tide-dominated coast more readily than the uplands", () => {
    const coastal = run.zones["zone-hagonoy-paombong"];
    const upland = run.zones["zone-angat-norzagaray"];
    const coastalDays = coastal.filter((s) => s.depthM >= NOTABLE_DEPTH_M).length;
    const uplandDays = upland.filter((s) => s.depthM >= NOTABLE_DEPTH_M).length;
    expect(coastalDays).toBeGreaterThan(uplandDays);
  });

  it("keeps the gravity outfall shut for part of the day on the tidal coast", () => {
    const coastal = run.zones["zone-hagonoy-paombong"];
    expect(Math.max(...coastal.map((s) => s.gateClosedHours))).toBeGreaterThan(6);
  });

  it("attributes inflow to rainfall, upstream routing and tide separately", () => {
    const anyUpstream = Object.values(run.zones)
      .flat()
      .some((s) => s.inflow.upstream > 0);
    expect(anyUpstream).toBe(true);
  });
});

describe("correlation helpers", () => {
  it("returns 1 for a perfectly correlated pair", () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 10);
  });

  it("returns -1 for a perfectly anti-correlated pair", () => {
    expect(pearson([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 10);
  });

  it("handles degenerate input without throwing", () => {
    expect(pearson([1, 1, 1], [2, 2, 2])).toBe(0);
    expect(pearson([], [])).toBe(0);
  });

  it("detects a one-day lag", () => {
    const driver = [0, 5, 0, 0, 9, 0, 0, 3, 0];
    const response = [0, 0, 5, 0, 0, 9, 0, 0, 3];
    expect(laggedCorrelation(driver, response, 1)).toBeGreaterThan(
      laggedCorrelation(driver, response, 0),
    );
  });

  it("summarises rainfall and tide against the model run", () => {
    const run = runFloodModel(zones.features, drivers.days);
    const summary = summariseCorrelations(drivers.days, run);
    expect(summary.rainfallVsDepth).toHaveLength(4);
    expect(summary.tideVsDepth).toHaveLength(4);
    expect(summary.caveat).toMatch(/NOT evidence/);
    expect(summary.tideConditional.wetDayCount).toBeGreaterThan(4);
    expect(summary.tideConditional.meanDepthHighTideM).toBeGreaterThan(
      summary.tideConditional.meanDepthLowTideM,
    );
    expect(summary.tideConditional.meanGateClosedHoursHighTide).toBeGreaterThan(0);
    for (const r of [...summary.rainfallVsDepth, ...summary.tideVsDepth]) {
      expect(r.r).toBeGreaterThanOrEqual(-1);
      expect(r.r).toBeLessThanOrEqual(1);
    }
  });

  it("lines the published barangay counts up with model days", () => {
    const run = runFloodModel(zones.features, drivers.days);
    const checks = qualitativeCheck(run, drivers.observations);
    expect(checks.length).toBeGreaterThanOrEqual(3);
    for (const c of checks) {
      expect(c.modelledZonesFloodedFraction).not.toBeNull();
      expect(c.source).toBeTruthy();
    }
  });
});

describe("data integrity", () => {
  const sources = read<{ sources: { id: string }[] }>("sources.json");
  const sourceIds = new Set(sources.sources.map((s) => s.id));

  it("labels every project as demonstration data", () => {
    for (const f of projects.features) {
      expect(f.properties.demonstration).toBe(true);
      expect(f.properties.dataClass).toBe("demonstration");
      expect(f.properties.name.startsWith("DEMO")).toBe(true);
    }
  });

  it("asserts no budget or completion figures on project features", () => {
    const forbidden = /budget|cost|contract amount|percent complete|physical accomplishment/i;
    for (const f of projects.features) {
      const keys = Object.keys(f.properties).join(" ");
      expect(keys).not.toMatch(forbidden);
    }
  });

  it("gives every project, waterway and zone a resolvable source and a date", () => {
    const dated = [
      ...projects.features.map((f) => f.properties),
      ...waterways.features.map((f) => f.properties),
      ...zones.features.map((f) => f.properties),
    ];
    for (const p of dated) {
      expect(sourceIds.has(p.source)).toBe(true);
      expect(p.sourceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("resolves every observation source", () => {
    for (const o of drivers.observations) {
      expect(sourceIds.has(o.source)).toBe(true);
      expect(o.dataClass).toBe("reported");
    }
  });

  it("places every demonstration project inside a modelled flood zone", () => {
    for (const f of projects.features) {
      const inZone = zones.features.some((z) =>
        pointInRing(f.geometry.coordinates, z.geometry.coordinates[0]),
      );
      expect({ id: f.id, inZone }).toEqual({ id: f.id, inZone: true });
    }
  });

  it("marks schematic geometry as such", () => {
    expect(waterways.metadata.notice).toMatch(/SCHEMATIC/);
    expect(projects.metadata.notice).toMatch(/DEMONSTRATION/);
    for (const f of waterways.features) expect(f.properties.dataClass).toBe("schematic");
  });
});
