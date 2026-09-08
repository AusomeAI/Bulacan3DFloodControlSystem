/**
 * Shareable view state, encoded into the URL query string.
 *
 * Kept free of the DOM and of React so the encode/decode contract can be
 * tested directly: given a state and the app's known layer/day vocabulary,
 * what query string comes out, and given a query string, what state comes
 * back. `App.tsx` is the only place that touches `window.location` or
 * `history` - this module just describes the mapping.
 *
 * Deliberately encodes only "what you are looking at": the day, the selected
 * project, the day-list filter, which view is showing, and which layers are
 * off. It never encodes transient interaction state - whether the timeline is
 * playing, whether the tour is mid-flight, whether a panel is expanded -
 * because restoring those on load would surprise a reader who just wanted to
 * see the state a link pointed at.
 */

import type { DayFilter } from "./eventDays";
import type { LayerId } from "../types";

export type FallbackView = "scene3d" | "schematic";

const DAY_FILTERS: readonly DayFilter[] = ["all", "rain", "flood", "reported"];
const VIEWS: readonly FallbackView[] = ["scene3d", "schematic"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface ShareableState {
  /** ISO date (YYYY-MM-DD) of the selected day. Omitted at the default (first day). */
  date?: string;
  /** Selected project's feature id. */
  projectId?: string;
  /** Day-list filter. Omitted at its default, "all". */
  filter?: DayFilter;
  /** Which credential-free view is showing. Omitted at its default, "scene3d". */
  view?: FallbackView;
  /** Layer ids that are turned off. Omitted when every layer is on (the default). */
  hiddenLayers?: LayerId[];
}

const KEYS = { date: "d", projectId: "p", filter: "f", view: "v", hiddenLayers: "off" } as const;

/** Builds the query string for a state, omitting anything at its default. */
export function encodeUrlState(state: ShareableState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.date) params.set(KEYS.date, state.date);
  if (state.projectId) params.set(KEYS.projectId, state.projectId);
  if (state.filter && state.filter !== "all") params.set(KEYS.filter, state.filter);
  if (state.view && state.view !== "scene3d") params.set(KEYS.view, state.view);
  if (state.hiddenLayers && state.hiddenLayers.length > 0) {
    params.set(KEYS.hiddenLayers, state.hiddenLayers.join(","));
  }
  return params;
}

/**
 * Parses a query string against the app's known vocabulary. Anything
 * unrecognised - a garbled date, a layer id that no longer exists, a filter
 * from some future version - is silently dropped rather than surfaced as an
 * error, so an old or hand-edited link degrades to "show the default" instead
 * of failing to load.
 */
export function decodeUrlState(
  search: string,
  knownLayerIds: readonly LayerId[],
): ShareableState {
  const params = new URLSearchParams(search);
  const state: ShareableState = {};

  const date = params.get(KEYS.date);
  if (date && ISO_DATE.test(date)) state.date = date;

  const projectId = params.get(KEYS.projectId);
  if (projectId) state.projectId = projectId;

  const filter = params.get(KEYS.filter);
  if (filter && (DAY_FILTERS as readonly string[]).includes(filter)) {
    state.filter = filter as DayFilter;
  }

  const view = params.get(KEYS.view);
  if (view && (VIEWS as readonly string[]).includes(view)) {
    state.view = view as FallbackView;
  }

  const off = params.get(KEYS.hiddenLayers);
  if (off) {
    const known = new Set<string>(knownLayerIds);
    const hidden = off
      .split(",")
      .map((s) => s.trim())
      .filter((id): id is LayerId => known.has(id));
    if (hidden.length > 0) state.hiddenLayers = hidden;
  }

  return state;
}

/** Convenience for building a full shareable URL, mainly for tests. */
export function buildShareableUrl(origin: string, pathname: string, state: ShareableState): string {
  const qs = encodeUrlState(state).toString();
  return qs ? `${origin}${pathname}?${qs}` : `${origin}${pathname}`;
}

/** Derives the hidden-layer list from a full layer-visibility record. */
export function hiddenLayersOf(layers: Record<LayerId, boolean>): LayerId[] {
  return (Object.keys(layers) as LayerId[]).filter((id) => !layers[id]);
}

/** Rebuilds a full layer-visibility record from a hidden-layer list. */
export function layersFromHidden(
  knownLayerIds: readonly LayerId[],
  hidden: readonly LayerId[] | undefined,
): Record<LayerId, boolean> {
  const hiddenSet = new Set(hidden ?? []);
  return knownLayerIds.reduce(
    (acc, id) => {
      acc[id] = !hiddenSet.has(id);
      return acc;
    },
    {} as Record<LayerId, boolean>,
  );
}
