import type { AppData } from "../types";

declare global {
  interface Window {
    /**
     * Optional embedded payload. The single-file build (scripts/build-artifact.mjs)
     * inlines every dataset here so the app runs from one HTML file with no
     * server and no network access at all. When absent, data is fetched from
     * DATA_BASE as normal.
     */
    __BULACAN_DATA__?: AppData;
  }
}

/**
 * All datasets live under `public/data` and are fetched at runtime, so they can
 * be swapped without rebuilding the app. Point DATA_BASE at a different origin
 * (e.g. a CMS or an open-data mirror) via VITE_DATA_BASE to load live data.
 */
export const DATA_BASE = (import.meta.env.VITE_DATA_BASE as string | undefined) ?? "data";

async function getJson<T>(file: string): Promise<T> {
  const res = await fetch(`${DATA_BASE}/${file}`);
  if (!res.ok) throw new Error(`Failed to load ${file}: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export async function loadAppData(): Promise<AppData> {
  const embedded = typeof window !== "undefined" ? window.__BULACAN_DATA__ : undefined;
  if (embedded) return embedded;

  const [sources, projects, waterways, zones, drivers, tour] = await Promise.all([
    getJson<AppData["sources"]>("sources.json"),
    getJson<AppData["projects"]>("projects.geojson"),
    getJson<AppData["waterways"]>("waterways.geojson"),
    getJson<AppData["zones"]>("flood-zones.geojson"),
    getJson<AppData["drivers"]>("flood-drivers-timeline.json"),
    getJson<AppData["tour"]>("camera-tour.json"),
  ]);
  return { sources, projects, waterways, zones, drivers, tour };
}
