import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";

// three.js and the Maps overlay are ~600 kB and are only needed when the app
// actually has credentials and a GPU, so keep them out of the first load.
const MapView = lazy(() =>
  import("./components/MapView").then((m) => ({ default: m.MapView })),
);
const Scene3D = lazy(() =>
  import("./components/Scene3D").then((m) => ({ default: m.Scene3D })),
);

/** Which view fills the stage when there is no Google map to show. */
type FallbackView = "scene3d" | "schematic";
import { SchematicMap } from "./components/SchematicMap";
import { LayerControls } from "./components/LayerControls";
import { TimelinePanel } from "./components/TimelinePanel";
import { DetailsPanel } from "./components/DetailsPanel";
import { TourControls } from "./components/TourControls";
import { DataNotice, ModelPanel, SetupNotice, SourcesPanel } from "./components/InfoPanels";
import { DateNavigator } from "./components/DateNavigator";
import { buildDayRecords, type DayFilter } from "./lib/eventDays";
import { loadAppData } from "./lib/dataLoader";
import { pointInRing } from "./lib/geo";
import { LAYER_ORDER } from "./lib/palette";
import {
  compareTideCounterfactual,
  qualitativeCheck,
  runFloodModel,
  summariseCorrelations,
} from "./lib/floodModel";
import type { FloodScene } from "./three/floodScene";
import {
  GOOGLE_MAPS_API_KEY,
  GOOGLE_MAPS_MAP_ID,
  hasMapsCredentials,
  useMediaQuery,
  useReducedMotion,
  useWebGLSupport,
} from "./hooks/useEnvironment";
import { useGoogleMapsApi } from "./hooks/useGoogleMaps";
import type { MapErrorKind } from "./components/MapView";
import type { AppData, CameraPose, LayerId } from "./types";

const PLAYBACK_MS = 900;

function initialLayers(): Record<LayerId, boolean> {
  return LAYER_ORDER.reduce((acc, id) => {
    acc[id] = true;
    return acc;
  }, {} as Record<LayerId, boolean>);
}

export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapErrorKind, setMapErrorKind] = useState<MapErrorKind | null>(null);

  const [layers, setLayers] = useState<Record<LayerId, boolean>>(initialLayers);
  const [dayIndex, setDayIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tourIndex, setTourIndex] = useState<number | null>(null);
  const [touring, setTouring] = useState(false);
  const [cameraTarget, setCameraTarget] = useState<CameraPose | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dayFilter, setDayFilter] = useState<DayFilter>("all");
  const [fallbackView, setFallbackView] = useState<FallbackView>("scene3d");

  const sceneRef = useRef<FloodScene | null>(null);

  const reducedMotion = useReducedMotion();
  const webglOk = useWebGLSupport();
  const isNarrow = useMediaQuery("(max-width: 900px)");
  const wantMaps = hasMapsCredentials && webglOk;
  const { state: mapsState, error: mapsLoadError, retry: retryMaps } = useGoogleMapsApi(
    GOOGLE_MAPS_API_KEY,
    wantMaps,
  );

  const use3D = wantMaps && mapsState === "ready" && !mapError;
  // The local 3D canvas needs a GPU but no credentials; the schematic needs neither.
  const view: FallbackView = webglOk ? fallbackView : "schematic";
  const showScene3D = !use3D && view === "scene3d";

  useEffect(() => {
    loadAppData().then(setData).catch((e: Error) => setLoadError(e.message));
  }, []);

  // ------------------------------------------------------------------- model
  const run = useMemo(
    () => (data ? runFloodModel(data.zones.features, data.drivers.days) : null),
    [data],
  );
  const correlation = useMemo(
    () => (data && run ? summariseCorrelations(data.drivers.days, run) : null),
    [data, run],
  );
  const counterfactual = useMemo(
    () => (data ? compareTideCounterfactual(data.zones.features, data.drivers.days) : null),
    [data],
  );
  const checks = useMemo(
    () => (data && run ? qualitativeCheck(run, data.drivers.observations) : []),
    [data, run],
  );

  const dayRecords = useMemo(
    () => (data && run ? buildDayRecords(data.drivers, data.zones.features, run) : []),
    [data, run],
  );

  const depths = useMemo(() => {
    if (!data || !run) return {};
    const out: Record<string, number> = {};
    for (const zone of data.zones.features) {
      out[zone.id] = run.zones[zone.id]?.[dayIndex]?.depthM ?? 0;
    }
    return out;
  }, [data, run, dayIndex]);

  const sourceById = useMemo(() => {
    const map: Record<string, (typeof data extends null ? never : AppData)["sources"]["sources"][number]> = {};
    for (const s of data?.sources.sources ?? []) map[s.id] = s;
    return map;
  }, [data]);

  // --------------------------------------------------------------- playback
  useEffect(() => {
    if (!playing || !data) return;
    const id = window.setInterval(() => {
      setDayIndex((i) => (i + 1) % data.drivers.days.length);
    }, PLAYBACK_MS);
    return () => window.clearInterval(id);
  }, [playing, data]);

  // ------------------------------------------------------------------- tour
  const goToWaypoint = useCallback(
    (index: number) => {
      if (!data) return;
      const wp = data.tour.waypoints[index];
      if (!wp) return;
      setTourIndex(index);
      setCameraTarget({ ...wp.camera });
      if (wp.focusProject) setSelectedId(wp.focusProject);
    },
    [data],
  );

  useEffect(() => {
    if (!touring || !data || tourIndex === null) return;
    const wp = data.tour.waypoints[tourIndex];
    const hold = reducedMotion ? Math.max(2500, wp.holdMs * 0.6) : wp.holdMs;
    const id = window.setTimeout(() => {
      const next = (tourIndex + 1) % data.tour.waypoints.length;
      goToWaypoint(next);
    }, hold);
    return () => window.clearTimeout(id);
  }, [touring, tourIndex, data, reducedMotion, goToWaypoint]);

  const toggleTour = () => {
    if (touring) {
      setTouring(false);
      return;
    }
    setTouring(true);
    goToWaypoint(tourIndex === null ? 0 : (tourIndex + 1) % (data?.tour.waypoints.length ?? 1));
  };

  // ----------------------------------------------------------------- derived
  const selectedFeature = useMemo(
    () => data?.projects.features.find((f) => f.id === selectedId) ?? null,
    [data, selectedId],
  );

  const selectedZone = useMemo(() => {
    if (!data || !selectedFeature) return null;
    const pt = selectedFeature.geometry.coordinates;
    return data.zones.features.find((z) => pointInRing(pt, z.geometry.coordinates[0])) ?? null;
  }, [data, selectedFeature]);

  const selectedZoneState = useMemo(() => {
    if (!run || !selectedZone) return null;
    return run.zones[selectedZone.id]?.[dayIndex] ?? null;
  }, [run, selectedZone, dayIndex]);

  const layerCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of data?.projects.features ?? []) {
      counts[f.properties.category] = (counts[f.properties.category] ?? 0) + 1;
    }
    counts.waterways = data?.waterways.features.length ?? 0;
    counts["flood-zones"] = data?.zones.features.length ?? 0;
    counts["water-surface"] = data?.zones.features.length ?? 0;
    return counts;
  }, [data]);

  const handleImportModel = async (projectId: string, file: File) => {
    if (!sceneRef.current) return;
    try {
      const { loadGLBFromFile } = await import("./three/glbLoader");
      const object = await loadGLBFromFile(file);
      sceneRef.current.replaceProjectModel(projectId, object);
    } catch (e) {
      setMapError(`Could not read that GLB: ${(e as Error).message}`);
    }
  };

  // ------------------------------------------------------------------ render
  if (loadError) {
    return (
      <div className="fatal">
        <h1>Could not load the data files</h1>
        <p>{loadError}</p>
        <p>The app expects the JSON/GeoJSON files under <code>public/data/</code> to be reachable.</p>
      </div>
    );
  }

  if (!data || !run || !correlation || !counterfactual) {
    return (
      <div className="fatal">
        <h1>Bulacan flood control &mdash; 3D demonstration</h1>
        <p>Loading data&hellip;</p>
      </div>
    );
  }

  const noticeReason = !hasMapsCredentials
    ? "no-credentials"
    : !webglOk
      ? "no-webgl"
      : mapErrorKind === "raster-map-id"
        ? "raster-map-id"
        : mapError || mapsState === "error"
          ? "maps-error"
          : null;

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Bulacan flood control &mdash; interactive 3D demonstration</h1>
          <p className="subtitle">
            Angat, Malolos, Guiguinto, Bulacan and Santa Maria river systems, the interconnected lowland channels, and
            the coast beside the New Manila International Airport.{" "}
            <strong>All project markers and flood scenarios are demonstration data.</strong>
          </p>
        </div>
        <button
          type="button"
          className="btn small sidebar-toggle"
          onClick={() => setSidebarOpen((v) => !v)}
          aria-expanded={sidebarOpen}
        >
          {sidebarOpen ? "Close panels" : "Panels"}
        </button>
      </header>

      <main className="layout">
        <div className="stage">
          {noticeReason && (
            <SetupNotice
              reason={noticeReason}
              detail={mapError ?? mapsLoadError}
              onRetry={noticeReason === "maps-error" ? retryMaps : undefined}
            />
          )}
          {!use3D && webglOk && (
            <div className="view-switch" role="group" aria-label="Map view">
              <button
                type="button"
                className={`chip${view === "scene3d" ? " active" : ""}`}
                aria-pressed={view === "scene3d"}
                onClick={() => setFallbackView("scene3d")}
              >
                3D scene
              </button>
              <button
                type="button"
                className={`chip${view === "schematic" ? " active" : ""}`}
                aria-pressed={view === "schematic"}
                onClick={() => setFallbackView("schematic")}
              >
                Schematic
              </button>
            </div>
          )}

          {use3D ? (
            <Suspense fallback={<div className="map-canvas map-loading">Loading the 3D map&hellip;</div>}>
              <MapView
                data={data}
                mapId={GOOGLE_MAPS_MAP_ID}
                layers={layers}
                depths={depths}
                selectedProjectId={selectedId}
                cameraTarget={cameraTarget}
                animated={!reducedMotion}
                onSelectProject={setSelectedId}
                onSceneReady={(s) => (sceneRef.current = s)}
                onError={(message, kind) => {
                  setMapError(message);
                  setMapErrorKind(kind ?? "init");
                }}
              />
            </Suspense>
          ) : showScene3D ? (
            <Suspense fallback={<div className="map-canvas map-loading">Loading the 3D scene&hellip;</div>}>
              <Scene3D
                data={data}
                layers={layers}
                depths={depths}
                selectedProjectId={selectedId}
                reducedMotion={reducedMotion}
                onSelectProject={setSelectedId}
                onSceneReady={(s) => (sceneRef.current = s)}
              />
            </Suspense>
          ) : (
            <SchematicMap
              data={data}
              layers={layers}
              depths={depths}
              selectedProjectId={selectedId}
              onSelectProject={setSelectedId}
              reducedMotion={reducedMotion}
            />
          )}

          <DateNavigator
            records={dayRecords}
            index={dayIndex}
            filter={dayFilter}
            sourceById={sourceById}
            onIndex={(i) => {
              setPlaying(false);
              setDayIndex(i);
            }}
            onFilter={setDayFilter}
          />

          <TimelinePanel
            drivers={data.drivers}
            run={run}
            index={dayIndex}
            playing={playing}
            reducedMotion={reducedMotion}
            onIndex={setDayIndex}
            onTogglePlay={() => setPlaying((p) => !p)}
          />
        </div>

        <aside className={`sidebar${sidebarOpen || !isNarrow ? "" : " collapsed"}`} aria-label="Controls and information">
          <LayerControls
            layers={layers}
            counts={layerCounts}
            onToggle={(id) => setLayers((l) => ({ ...l, [id]: !l[id] }))}
            onSetAll={(v) =>
              setLayers(LAYER_ORDER.reduce((acc, id) => ({ ...acc, [id]: v }), {} as Record<LayerId, boolean>))
            }
          />

          <TourControls
            waypoints={data.tour.waypoints}
            activeIndex={tourIndex}
            touring={touring}
            available={use3D}
            reducedMotion={reducedMotion}
            onToggleTour={toggleTour}
            onGoTo={(i) => {
              setTouring(false);
              goToWaypoint(i);
            }}
          />

          <DetailsPanel
            feature={selectedFeature}
            zone={selectedZone}
            zoneState={selectedZoneState}
            source={sourceById[selectedFeature?.properties.source ?? ""]}
            canImportModels={use3D || showScene3D}
            onClose={() => setSelectedId(null)}
            onImportModel={handleImportModel}
          />

          <section className="panel" aria-labelledby="projects-heading">
            <h2 id="projects-heading">Demonstration projects ({data.projects.features.length})</h2>
            <ul className="project-list">
              {data.projects.features
                .filter((f) => layers[f.properties.category])
                .map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      className={`project-row${f.id === selectedId ? " active" : ""}`}
                      onClick={() => setSelectedId(f.id)}
                    >
                      <span className="project-name">{f.properties.name}</span>
                      <span className="project-meta">{f.properties.municipality}</span>
                    </button>
                  </li>
                ))}
            </ul>
          </section>

          <ModelPanel
            run={run}
            correlation={correlation}
            counterfactual={counterfactual}
            checks={checks}
            sourceById={sourceById}
          />
          <DataNotice />
          <SourcesPanel sources={data.sources.sources} />
        </aside>
      </main>

      <footer className="app-footer">
        <p>
          Demonstration prototype. Project features, flood scenarios and model parameters are illustrative and must not
          be used for planning, procurement or public communication. Real reported figures carry a source and a date.
        </p>
      </footer>
    </div>
  );
}
