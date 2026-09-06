import type { LayerId, ProjectCategory } from "../types";

export const CATEGORY_HEX: Record<ProjectCategory, string> = {
  "pumping-station": "#2fb5c8",
  "drainage-channel": "#7bd389",
  "flood-barrier": "#f2a03d",
  "river-works": "#c98bdb",
  "airport-vicinity": "#e86a6a",
};

export const LAYER_LABELS: Record<LayerId, string> = {
  waterways: "Waterways & river systems",
  "pumping-station": "Pumping stations & flood gates",
  "drainage-channel": "Drainage channels",
  "flood-barrier": "Flood barriers, dikes & seawalls",
  "river-works": "River works: dredging, sabo, detention",
  "airport-vicinity": "NMIA-vicinity works",
  "flood-zones": "Flood zone envelopes",
  "water-surface": "Modelled water surface",
};

export const LAYER_ORDER: LayerId[] = [
  "waterways",
  "pumping-station",
  "drainage-channel",
  "flood-barrier",
  "river-works",
  "airport-vicinity",
  "flood-zones",
  "water-surface",
];

export const LAYER_SWATCH: Record<LayerId, string> = {
  waterways: "#4aa8e0",
  "pumping-station": CATEGORY_HEX["pumping-station"],
  "drainage-channel": CATEGORY_HEX["drainage-channel"],
  "flood-barrier": CATEGORY_HEX["flood-barrier"],
  "river-works": CATEGORY_HEX["river-works"],
  "airport-vicinity": CATEGORY_HEX["airport-vicinity"],
  "flood-zones": "#4a8fa8",
  "water-surface": "#2a7fbf",
};
