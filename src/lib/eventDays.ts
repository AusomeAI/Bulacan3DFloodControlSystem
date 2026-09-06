/**
 * Day records: the index the date navigator drives from.
 *
 * The app simulates the past month day by day. Not every day is interesting -
 * some are dry, some are wet but drain away, some are the ones that made the
 * news. This module classifies each simulated day so the user can jump straight
 * to the days that carry a rainfall record, a flooding record, or a published
 * report, instead of scrubbing blindly through the slider.
 *
 * Classification is derived, never hand-authored: rainfall comes from the
 * driver series, flooding from the illustrative model run, and reports from the
 * cited observations. Change the thresholds here and the navigator follows.
 */

import type { DriverDay, DriversDoc, FloodZoneFeature, Observation } from "../types";
import { NOTABLE_DEPTH_M, type ModelRun } from "./floodModel";

/** A day counts as a rainfall day at or above this daily total. */
export const RAIN_RECORD_MM = 20;

/** A day counts as a flooding day when at least this many zones are inundated. */
export const FLOOD_RECORD_ZONES = 1;

export type DayFilter = "all" | "rain" | "flood" | "reported";

export const FILTER_LABELS: Record<DayFilter, string> = {
  all: "All days",
  rain: `Rain ≥ ${RAIN_RECORD_MM} mm`,
  flood: "Flooding",
  reported: "Reported",
};

export interface FloodedZone {
  id: string;
  name: string;
  depthM: number;
  gateClosedHours: number;
}

export interface DayRecord {
  index: number;
  date: string;
  rainMm: number;
  tideM: number;
  angatM: number;
  /** Zones at or above the notable depth, deepest first. */
  floodedZones: FloodedZone[];
  maxDepthM: number;
  meanGateClosedHours: number;
  hasRain: boolean;
  hasFlood: boolean;
  hasReport: boolean;
  /** True when the day carries any kind of record at all. */
  hasRecord: boolean;
  reports: Observation[];
  /** 0 none, 1 minor, 2 notable, 3 severe - drives the navigator's colour. */
  severity: 0 | 1 | 2 | 3;
}

function severityOf(maxDepthM: number, floodedCount: number): 0 | 1 | 2 | 3 {
  if (floodedCount === 0) return 0;
  if (maxDepthM >= 0.9 || floodedCount >= 6) return 3;
  if (maxDepthM >= 0.4 || floodedCount >= 3) return 2;
  return 1;
}

export function buildDayRecords(
  drivers: DriversDoc,
  zones: FloodZoneFeature[],
  run: ModelRun,
): DayRecord[] {
  const zoneName = new Map(zones.map((z) => [z.id, z.properties.name]));

  return drivers.days.map((day: DriverDay, index: number) => {
    const flooded: FloodedZone[] = [];
    let gateHoursTotal = 0;

    for (const zone of zones) {
      const state = run.zones[zone.id]?.[index];
      if (!state) continue;
      gateHoursTotal += state.gateClosedHours;
      if (state.depthM >= NOTABLE_DEPTH_M) {
        flooded.push({
          id: zone.id,
          name: zoneName.get(zone.id) ?? zone.id,
          depthM: state.depthM,
          gateClosedHours: state.gateClosedHours,
        });
      }
    }
    flooded.sort((a, b) => b.depthM - a.depthM);

    const reports = drivers.observations.filter((o) => o.date === day.date);
    const hasRain = day.rain_mm >= RAIN_RECORD_MM;
    const hasFlood = flooded.length >= FLOOD_RECORD_ZONES;
    const hasReport = reports.length > 0;

    return {
      index,
      date: day.date,
      rainMm: day.rain_mm,
      tideM: day.tide_max_m,
      angatM: day.angat_reservoir_m,
      floodedZones: flooded,
      maxDepthM: flooded[0]?.depthM ?? 0,
      meanGateClosedHours: zones.length ? gateHoursTotal / zones.length : 0,
      hasRain,
      hasFlood,
      hasReport,
      hasRecord: hasRain || hasFlood || hasReport,
      reports,
      severity: severityOf(flooded[0]?.depthM ?? 0, flooded.length),
    };
  });
}

export function matchesFilter(record: DayRecord, filter: DayFilter): boolean {
  switch (filter) {
    case "rain":
      return record.hasRain;
    case "flood":
      return record.hasFlood;
    case "reported":
      return record.hasReport;
    default:
      return record.hasRecord;
  }
}

/**
 * Next day matching the filter, walking in `direction`. Returns null when there
 * is nothing further in that direction, so the caller can disable the button
 * rather than wrapping the user around silently.
 */
export function stepToRecord(
  records: DayRecord[],
  from: number,
  direction: 1 | -1,
  filter: DayFilter,
): number | null {
  for (let i = from + direction; i >= 0 && i < records.length; i += direction) {
    if (matchesFilter(records[i], filter)) return i;
  }
  return null;
}

export function countMatching(records: DayRecord[], filter: DayFilter): number {
  return records.reduce((n, r) => n + (matchesFilter(r, filter) ? 1 : 0), 0);
}

/** One-line summary of a day, used by the navigator and the day detail block. */
export function summariseDay(record: DayRecord): string {
  const bits: string[] = [`${record.rainMm} mm rain`, `tide ${record.tideM.toFixed(2)} m`];
  if (record.floodedZones.length === 0) {
    bits.push("no zone above the flooding threshold");
  } else {
    bits.push(
      `${record.floodedZones.length} zone${record.floodedZones.length > 1 ? "s" : ""} flooded, deepest ${record.floodedZones[0].name} at ${record.floodedZones[0].depthM.toFixed(2)} m`,
    );
  }
  if (record.hasReport) bits.push(`${record.reports.length} published report${record.reports.length > 1 ? "s" : ""}`);
  return bits.join(" · ");
}
