import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  FLOOD_RECORD_ZONES,
  RAIN_RECORD_MM,
  buildDayRecords,
  countMatching,
  matchesFilter,
  stepToRecord,
  summariseDay,
  type DayFilter,
} from "../src/lib/eventDays";
import { NOTABLE_DEPTH_M, runFloodModel } from "../src/lib/floodModel";
import type { DriversDoc, FeatureCollection, FloodZoneFeature } from "../src/types";

const read = <T>(f: string): T => JSON.parse(readFileSync(`public/data/${f}`, "utf8")) as T;
const zones = read<FeatureCollection<FloodZoneFeature>>("flood-zones.geojson");
const drivers = read<DriversDoc>("flood-drivers-timeline.json");
const run = runFloodModel(zones.features, drivers.days);
const records = buildDayRecords(drivers, zones.features, run);

describe("simulated month", () => {
  it("covers roughly the past month up to the compile date", () => {
    expect(records).toHaveLength(drivers.days.length);
    expect(records.length).toBeGreaterThanOrEqual(30);
    expect(records[0].date).toBe(drivers.metadata.period.start);
    expect(records[records.length - 1].date).toBe(drivers.metadata.period.end);
    expect(drivers.metadata.period.end).toBe(drivers.metadata.compiledOn);
  });

  it("keeps one record per day in date order", () => {
    for (let i = 1; i < records.length; i++) {
      expect(records[i].date > records[i - 1].date).toBe(true);
      expect(records[i].index).toBe(i);
    }
  });
});

describe("day classification", () => {
  it("flags rain days by the published threshold", () => {
    for (const r of records) expect(r.hasRain).toBe(r.rainMm >= RAIN_RECORD_MM);
  });

  it("flags flood days from the model run, deepest zone first", () => {
    for (const r of records) {
      expect(r.hasFlood).toBe(r.floodedZones.length >= FLOOD_RECORD_ZONES);
      for (const z of r.floodedZones) expect(z.depthM).toBeGreaterThanOrEqual(NOTABLE_DEPTH_M);
      for (let i = 1; i < r.floodedZones.length; i++) {
        expect(r.floodedZones[i - 1].depthM).toBeGreaterThanOrEqual(r.floodedZones[i].depthM);
      }
      expect(r.maxDepthM).toBe(r.floodedZones[0]?.depthM ?? 0);
    }
  });

  it("attaches every cited observation to its day", () => {
    const attached = records.flatMap((r) => r.reports);
    expect(attached).toHaveLength(drivers.observations.length);
    for (const r of records) {
      for (const o of r.reports) expect(o.date).toBe(r.date);
      expect(r.hasReport).toBe(r.reports.length > 0);
    }
  });

  it("finds real record days of each kind in the month", () => {
    expect(countMatching(records, "rain")).toBeGreaterThan(10);
    expect(countMatching(records, "flood")).toBeGreaterThan(5);
    expect(countMatching(records, "reported")).toBeGreaterThanOrEqual(8);
    expect(countMatching(records, "all")).toBeLessThanOrEqual(records.length);
  });

  it("escalates severity with depth and extent", () => {
    for (const r of records) {
      if (r.floodedZones.length === 0) expect(r.severity).toBe(0);
      else expect(r.severity).toBeGreaterThan(0);
      if (r.maxDepthM >= 0.9 || r.floodedZones.length >= 6) expect(r.severity).toBe(3);
    }
    expect(Math.max(...records.map((r) => r.severity))).toBe(3);
  });

  it("marks the reported peak of the event as a flooding day", () => {
    // 12 Aug 2026: 149 barangays reported flooded (philstar-2026-08-12).
    const peak = records.find((r) => r.date === "2026-08-12")!;
    expect(peak.hasFlood).toBe(true);
    expect(peak.hasReport).toBe(true);
    expect(peak.severity).toBeGreaterThanOrEqual(2);
  });
});

describe("navigation", () => {
  const filters: DayFilter[] = ["all", "rain", "flood", "reported"];

  it("steps forward and back to the next matching day only", () => {
    for (const filter of filters) {
      let cursor = -1;
      const visited: number[] = [];
      for (;;) {
        const next = stepToRecord(records, cursor, 1, filter);
        if (next === null) break;
        expect(next).toBeGreaterThan(cursor);
        expect(matchesFilter(records[next], filter)).toBe(true);
        visited.push(next);
        cursor = next;
      }
      expect(visited).toHaveLength(countMatching(records, filter));

      // Walking back from the end must retrace the same days.
      const back: number[] = [];
      let c = records.length;
      for (;;) {
        const prev = stepToRecord(records, c, -1, filter);
        if (prev === null) break;
        back.unshift(prev);
        c = prev;
      }
      expect(back).toEqual(visited);
    }
  });

  it("returns null at the ends instead of wrapping", () => {
    const last = stepToRecord(records, -1, -1, "all");
    expect(last).toBeNull();
    expect(stepToRecord(records, records.length - 1, 1, "all")).toBeNull();
  });

  it("summarises a day in one line with its drivers", () => {
    const peak = records.find((r) => r.date === "2026-08-12")!;
    const text = summariseDay(peak);
    expect(text).toContain("mm rain");
    expect(text).toContain("tide");
    expect(text).toMatch(/zones? flooded, deepest/);
    expect(text).toContain("published report");
  });
});
