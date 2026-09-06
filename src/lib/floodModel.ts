/**
 * Illustrative rainfall-tide-flood model.
 *
 * ---------------------------------------------------------------------------
 * THIS IS NOT A CALIBRATED HYDRAULIC MODEL AND MUST NOT BE USED FOR ANY REAL
 * DECISION. It is a transparent, deliberately simple bucket model whose only
 * purpose is to demonstrate, on screen, the mechanism that Bulacan reporting
 * describes repeatedly: rainfall fills the lowlands, and Manila Bay high tide
 * decides whether that water can leave. Every parameter is an illustrative
 * value from public/data/flood-zones.geojson, not a surveyed or designed one.
 * No output of this file should be presented as a flood-reduction claim, a
 * forecast, or an assessment of any real structure.
 * ---------------------------------------------------------------------------
 *
 * Structure, per zone, per day (daily time step, water depth tracked in mm):
 *
 *   1. Antecedent wetness       API_t = k * API_{t-1} + P_t              (k = 0.85)
 *      Available storage        S_t   = storageMm * (1 - min(1, API_t / 150))
 *   2. Direct runoff            Q_t   = max(0, C * P_t - S_t)
 *   3. Upstream inflow          U_t   = upstreamShare * uplandRunoff_{t-1}
 *   4. Tidal gating             the outfall is shut whenever bay level exceeds
 *      the drain invert. Approximating the tide as a sinusoid of amplitude
 *      `tide_max_m` about mean sea level, the fraction of the day the gate is
 *      shut is  f = acos(clamp(invert / tideMax, -1, 1)) / PI  -- and 1 when
 *      the invert is below the tidal trough.
 *   5. Outflow                  O_t = conveyance * (1 - f) + pumpCapacity
 *   6. Barrier ingress          if tideMax > barrierCrest, water enters over
 *                               the crest: I_t = (tideMax - crest) * 1000 * 0.35
 *   7. Storage update           W_t = max(0, W_{t-1} * (1 - recession)
 *                                            + Q_t + U_t + I_t - O_t)
 *   8. Reported depth           floodwater does not spread evenly - it collects
 *      in the low-lying part of a zone - so the depth the UI shows is
 *      D_t = W_t/1000 * pondingConcentration, where the multiplier is an
 *      illustrative judgement per zone, not a measurement.
 *
 * The driver split reported per day attributes the day's *gross inflow* between
 * rainfall, upstream routing and tidal ingress, and separately reports how many
 * hours the gravity outfall was shut. That gate-closure figure is the point of
 * the whole exercise: it is how tide turns ordinary rain into a flood.
 */

import type { DriverDay, FloodZoneFeature, ZoneModelParams } from "../types";

export const MODEL_VERSION = "0.1.0-illustrative";

export const MODEL_DISCLAIMER =
  "Illustrative model. Not calibrated, not validated, not a forecast. Parameters are demonstration values, not surveyed elevations or design capacities.";

const API_DECAY = 0.85;
const API_SATURATION_MM = 150;
const BARRIER_INGRESS_COEFFICIENT = 0.35;

export interface ZoneDayState {
  zoneId: string;
  date: string;
  /** Depth in the low-lying, actually-inundated part of the zone, metres. */
  depthM: number;
  /** Mean water column over the whole zone, millimetres. */
  storedMm: number;
  /** Hours in the day the gravity outfall is shut by the tide. */
  gateClosedHours: number;
  /** Gross inflow attribution for the day, in mm. */
  inflow: { rainfall: number; upstream: number; tidal: number };
  /** Outflow achieved that day, mm. */
  outflowMm: number;
  /** True when modelled bay level exceeds the barrier crest. */
  barrierOvertopped: boolean;
  /** Antecedent precipitation index, mm. */
  apiMm: number;
}

export interface ModelRun {
  version: string;
  disclaimer: string;
  dates: string[];
  zones: Record<string, ZoneDayState[]>;
  /** Area-unweighted provincial mean depth per day, metres. */
  provincialMeanDepthM: number[];
  /** Fraction of zones with depth above the notable threshold, per day. */
  zonesFloodedFraction: number[];
}

export const NOTABLE_DEPTH_M = 0.15;

/** Fraction of a day the outfall is shut, given a sinusoidal tide. */
export function gateClosedFraction(tideMaxM: number, drainInvertM: number): number {
  if (tideMaxM <= 0) return 0;
  const ratio = drainInvertM / tideMaxM;
  if (ratio >= 1) return 0;
  if (ratio <= -1) return 1;
  return Math.acos(ratio) / Math.PI;
}

function stepZone(
  params: ZoneModelParams,
  day: DriverDay,
  prevStoredMm: number,
  prevApi: number,
  upstreamRunoffMm: number,
): Omit<ZoneDayState, "zoneId" | "date"> {
  const api = API_DECAY * prevApi + day.rain_mm;
  const wetness = Math.min(1, api / API_SATURATION_MM);
  const availableStorage = params.storageMm * (1 - wetness);
  const rainfallInflow = Math.max(0, params.runoffCoefficient * day.rain_mm - availableStorage);
  const upstreamInflow = params.upstreamShare * upstreamRunoffMm;

  const closedFraction = gateClosedFraction(day.tide_max_m, params.drainInvertM);
  const outflowCapacity =
    params.conveyanceMmPerDay * (1 - closedFraction) + params.pumpCapacityMmPerDay;

  const overtopped = day.tide_max_m > params.barrierCrestM;
  const tidalInflow = overtopped
    ? (day.tide_max_m - params.barrierCrestM) * 1000 * BARRIER_INGRESS_COEFFICIENT
    : 0;

  const carried = prevStoredMm * (1 - params.recessionPerDay);
  const available = carried + rainfallInflow + upstreamInflow + tidalInflow;
  const outflow = Math.min(available, outflowCapacity);
  const storedMm = Math.max(0, available - outflow);

  return {
    storedMm,
    depthM: (storedMm / 1000) * params.pondingConcentration,
    gateClosedHours: closedFraction * 24,
    inflow: { rainfall: rainfallInflow, upstream: upstreamInflow, tidal: tidalInflow },
    outflowMm: outflow,
    barrierOvertopped: overtopped,
    apiMm: api,
  };
}

/**
 * Runs the model across every zone for the whole driver series.
 * Upland zones (upstreamShare === 0) are treated as the runoff source that the
 * lowland zones draw on, with a one-day routing lag.
 */
export function runFloodModel(
  zones: FloodZoneFeature[],
  days: DriverDay[],
): ModelRun {
  const result: Record<string, ZoneDayState[]> = {};
  const stored: Record<string, number> = {};
  const api: Record<string, number> = {};
  for (const z of zones) {
    result[z.id] = [];
    stored[z.id] = 0;
    api[z.id] = 0;
  }

  const uplandZones = zones.filter((z) => z.properties.model.upstreamShare === 0);
  let previousUplandRunoff = 0;

  const provincialMeanDepthM: number[] = [];
  const zonesFloodedFraction: number[] = [];

  for (const day of days) {
    let uplandRunoffToday = 0;
    let depthSum = 0;
    let floodedCount = 0;

    for (const zone of zones) {
      const params = zone.properties.model;
      const state = stepZone(params, day, stored[zone.id], api[zone.id], previousUplandRunoff);
      stored[zone.id] = state.storedMm;
      api[zone.id] = state.apiMm;
      result[zone.id].push({ zoneId: zone.id, date: day.date, ...state });
      depthSum += state.depthM;
      if (state.depthM >= NOTABLE_DEPTH_M) floodedCount += 1;
      if (params.upstreamShare === 0) {
        uplandRunoffToday += state.inflow.rainfall + state.outflowMm;
      }
    }

    previousUplandRunoff = uplandZones.length ? uplandRunoffToday / uplandZones.length : 0;
    provincialMeanDepthM.push(depthSum / (zones.length || 1));
    zonesFloodedFraction.push(zones.length ? floodedCount / zones.length : 0);
  }

  return {
    version: MODEL_VERSION,
    disclaimer: MODEL_DISCLAIMER,
    dates: days.map((d) => d.date),
    zones: result,
    provincialMeanDepthM,
    zonesFloodedFraction,
  };
}

/** Pearson correlation coefficient. Returns 0 for degenerate input. */
export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    sa += a[i];
    sb += b[i];
  }
  const ma = sa / n;
  const mb = sb / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den === 0 ? 0 : num / den;
}

/** Correlation of `driver` against `response` shifted forward by `lag` days. */
export function laggedCorrelation(driver: number[], response: number[], lag: number): number {
  if (lag <= 0) return pearson(driver, response);
  return pearson(driver.slice(0, driver.length - lag), response.slice(lag));
}

export interface CorrelationSummary {
  rainfallVsDepth: { lag: number; r: number }[];
  tideVsDepth: { lag: number; r: number }[];
  bestRainfallLag: number;
  bestTideLag: number;
  /**
   * Correlation between a crude combined rainfall-and-tide index and depth.
   * Reported for completeness; a linear index is a poor description of an
   * interaction, which is what the next field is for.
   */
  combinedIndexVsDepth: number;
  /**
   * The honest way to show the tide's role. Tide does not put water on the
   * ground by itself - it decides whether the day's rain can leave. So this
   * splits the *wet* days (rainfall at or above the median wet-day total) by
   * whether the tide was above or below its median, and reports the mean
   * modelled depth of each group.
   */
  tideConditional: {
    wetDayCount: number;
    meanDepthHighTideM: number;
    meanDepthLowTideM: number;
    ratio: number;
    meanGateClosedHoursHighTide: number;
  };
  caveat: string;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function summariseCorrelations(days: DriverDay[], run: ModelRun): CorrelationSummary {
  const rain = days.map((d) => d.rain_mm);
  const tide = days.map((d) => d.tide_max_m);
  const depth = run.provincialMeanDepthM;

  const lags = [0, 1, 2, 3];
  const rainfallVsDepth = lags.map((lag) => ({ lag, r: laggedCorrelation(rain, depth, lag) }));
  const tideVsDepth = lags.map((lag) => ({ lag, r: laggedCorrelation(tide, depth, lag) }));

  const maxRain = Math.max(1, ...rain);
  const maxTide = Math.max(0.01, ...tide);
  const combined = days.map((d) => 0.65 * (d.rain_mm / maxRain) + 0.35 * (d.tide_max_m / maxTide));

  const best = (xs: { lag: number; r: number }[]) =>
    xs.reduce((acc, cur) => (Math.abs(cur.r) > Math.abs(acc.r) ? cur : acc)).lag;

  const wetThreshold = median(rain.filter((r) => r > 0));
  const wetIdx = days.map((_, i) => i).filter((i) => rain[i] >= wetThreshold);
  const tideThreshold = median(tide);
  const highIdx = wetIdx.filter((i) => tide[i] >= tideThreshold);
  const lowIdx = wetIdx.filter((i) => tide[i] < tideThreshold);
  // Depth responds with a lag, so look at the day itself and the day after.
  const responseAt = (i: number) => Math.max(depth[i] ?? 0, depth[i + 1] ?? 0);
  const meanDepthHighTideM = mean(highIdx.map(responseAt));
  const meanDepthLowTideM = mean(lowIdx.map(responseAt));
  const gateHours = Object.values(run.zones).reduce<number[]>((acc, states) => {
    highIdx.forEach((i) => acc.push(states[i]?.gateClosedHours ?? 0));
    return acc;
  }, []);

  return {
    rainfallVsDepth,
    tideVsDepth,
    tideConditional: {
      wetDayCount: wetIdx.length,
      meanDepthHighTideM,
      meanDepthLowTideM,
      ratio: meanDepthLowTideM > 0 ? meanDepthHighTideM / meanDepthLowTideM : 0,
      meanGateClosedHoursHighTide: mean(gateHours),
    },
    bestRainfallLag: best(rainfallVsDepth),
    bestTideLag: best(tideVsDepth),
    combinedIndexVsDepth: pearson(combined, depth),
    caveat:
      "These coefficients describe the model's own internal behaviour on schematic driver series. They are NOT evidence about the real relationship between rainfall, tide and flooding in Bulacan. Feed measured PAGASA rainfall, real tide tables and observed inundation to say anything about the real world.",
  };
}

/**
 * Qualitative-only comparison against the handful of published flooded-barangay
 * counts. Three or four points cannot validate a model; this exists so the UI
 * can show the reader exactly how thin the comparison is.
 */
export interface QualitativeCheck {
  date: string;
  reportedFloodedBarangays: number;
  modelledZonesFloodedFraction: number | null;
  source: string;
}

export function qualitativeCheck(
  run: ModelRun,
  observations: { date: string; metric: string; value: number | number[] | null; source: string }[],
): QualitativeCheck[] {
  return observations
    .filter((o) => o.metric === "flooded_barangays" && typeof o.value === "number")
    .map((o) => {
      const idx = run.dates.indexOf(o.date);
      return {
        date: o.date,
        reportedFloodedBarangays: o.value as number,
        modelledZonesFloodedFraction: idx >= 0 ? run.zonesFloodedFraction[idx] : null,
        source: o.source,
      };
    });
}
