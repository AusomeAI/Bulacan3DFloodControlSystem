export type DataClass = "reported" | "schematic" | "demonstration" | "mixed" | "modelled";

export interface SourceRecord {
  id: string;
  publisher: string;
  title: string;
  date: string;
  url: string;
  type: string;
  note?: string;
}

export interface SourcesDoc {
  description: string;
  compiledOn: string;
  sources: SourceRecord[];
}

export type LayerId =
  | "waterways"
  | "pumping-station"
  | "drainage-channel"
  | "flood-barrier"
  | "river-works"
  | "airport-vicinity"
  | "flood-zones"
  | "water-surface";

export type ProjectCategory = Extract<
  LayerId,
  "pumping-station" | "drainage-channel" | "flood-barrier" | "river-works" | "airport-vicinity"
>;

export interface ProjectProperties {
  name: string;
  category: ProjectCategory;
  structureType: string;
  municipality: string;
  river: string;
  status: string;
  demonstration: boolean;
  dataClass: DataClass;
  heightMeters?: number;
  lengthMeters?: number;
  areaHectares?: number;
  footprintMeters?: [number, number];
  modelUrl?: string | null;
  description: string;
  context: string;
  source: string;
  sourceDate: string;
}

export interface ProjectFeature {
  type: "Feature";
  id: string;
  properties: ProjectProperties;
  geometry: { type: "Point"; coordinates: [number, number] };
}

export interface WaterwayProperties {
  name: string;
  system: string;
  class: string;
  flowDirection: string;
  widthMeters: number;
  note: string;
  source: string;
  sourceDate: string;
  dataClass: DataClass;
}

export interface WaterwayFeature {
  type: "Feature";
  id: string;
  properties: WaterwayProperties;
  geometry: { type: "LineString"; coordinates: [number, number][] };
}

export interface ZoneModelParams {
  /** Mean ground level of the built-up area, metres above mean sea level. */
  groundLevelM: number;
  /** Invert (bed level) of the gravity outfall, metres above mean sea level. */
  drainInvertM: number;
  /** Depression + soil storage available when dry, in millimetres. */
  storageMm: number;
  /** Fraction of rainfall that becomes direct runoff when saturated. */
  runoffCoefficient: number;
  /** Channel conveyance out of the zone with the outfall fully open, mm/day over the zone. */
  conveyanceMmPerDay: number;
  /** Pumped drainage available when the gravity outfall is shut, mm/day. */
  pumpCapacityMmPerDay: number;
  /** Crest level of the coastal/river barrier, metres above mean sea level. */
  barrierCrestM: number;
  /** Share of upland routed runoff that arrives in this zone. */
  upstreamShare: number;
  /** Fraction of standing water lost per day to infiltration and evaporation. */
  recessionPerDay: number;
  /**
   * Multiplier from the zone-mean water column to the depth in the low-lying
   * part where water actually collects. An illustrative judgement per zone.
   */
  pondingConcentration: number;
}

export interface FloodZoneProperties {
  name: string;
  municipalities: string[];
  regime: string;
  dataClass: DataClass;
  model: ZoneModelParams;
  context: string;
  source: string;
  sourceDate: string;
}

export interface FloodZoneFeature {
  type: "Feature";
  id: string;
  properties: FloodZoneProperties;
  geometry: { type: "Polygon"; coordinates: [number, number][][] };
}

export interface FeatureCollection<F> {
  type: "FeatureCollection";
  name: string;
  metadata: {
    dataClass: DataClass;
    notice: string;
    compiledOn: string;
    [k: string]: unknown;
  };
  features: F[];
}

export interface DriverDay {
  date: string;
  rain_mm: number;
  rain_dataClass: DataClass;
  tide_max_m: number;
  tide_dataClass: DataClass;
  angat_reservoir_m: number;
  angat_dataClass: DataClass;
  angat_source: string | null;
}

export interface Observation {
  date: string;
  metric: string;
  value: number | number[] | null;
  text: string;
  breakdown?: Record<string, number>;
  source: string;
  dataClass: DataClass;
}

export interface DriversDoc {
  name: string;
  metadata: {
    dataClass: DataClass;
    notice: string;
    period: { start: string; end: string };
    replaceWith: string;
    compiledOn: string;
  };
  days: DriverDay[];
  observations: Observation[];
}

export interface CameraPose {
  lat: number;
  lng: number;
  zoom: number;
  tilt: number;
  heading: number;
}

export interface TourWaypoint {
  id: string;
  title: string;
  caption: string;
  camera: CameraPose;
  holdMs: number;
  focusLayers: string[];
  focusProject?: string;
}

export interface TourDoc {
  name: string;
  metadata: { dataClass: DataClass; notice: string; compiledOn: string };
  defaultCamera: { center: { lat: number; lng: number }; zoom: number; tilt: number; heading: number };
  waypoints: TourWaypoint[];
}

export interface AppData {
  sources: SourcesDoc;
  projects: FeatureCollection<ProjectFeature>;
  waterways: FeatureCollection<WaterwayFeature>;
  zones: FeatureCollection<FloodZoneFeature>;
  drivers: DriversDoc;
  tour: TourDoc;
}
