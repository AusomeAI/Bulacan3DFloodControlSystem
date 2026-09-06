import { useEffect, useRef, useState } from "react";
import { ThreeJSOverlayView } from "@googlemaps/three";
import { Vector2 } from "three";
import { FloodScene } from "../three/floodScene";
import { loadGLB } from "../three/glbLoader";
import { MapZoomControls } from "./MapZoomControls";
import type { AppData, CameraPose, LayerId } from "../types";

interface Props {
  data: AppData;
  mapId: string;
  layers: Record<LayerId, boolean>;
  depths: Record<string, number>;
  selectedProjectId: string | null;
  cameraTarget: CameraPose | null;
  animated: boolean;
  onSelectProject: (id: string | null) => void;
  onSceneReady: (scene: FloodScene) => void;
  onError: (message: string, kind?: MapErrorKind) => void;
}

export type MapErrorKind = "raster-map-id" | "init";

/** Google's vector maps go further, but past these the demonstration geometry
 * stops meaning anything: the structures are placeholders, not surveys. */
const MIN_MAP_ZOOM = 8;
const MAX_MAP_ZOOM = 19;

/** Cubic ease-in-out for camera moves. */
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

class TickingOverlay extends ThreeJSOverlayView {
  onTick?: (dt: number) => void;
  private last = performance.now();

  onBeforeDraw(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.onTick?.(dt);
  }
}

export function MapView({
  data,
  mapId,
  layers,
  depths,
  selectedProjectId,
  cameraTarget,
  animated,
  onSelectProject,
  onSceneReady,
  onError,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const overlayRef = useRef<TickingOverlay | null>(null);
  const sceneRef = useRef<FloodScene | null>(null);
  const animationRef = useRef<number | null>(null);
  const [zoom, setZoom] = useState(data.tour.defaultCamera.zoom);

  // ------------------------------------------------------------------ set-up
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const { defaultCamera } = data.tour;

    let map: google.maps.Map;
    try {
      map = new google.maps.Map(containerRef.current, {
        center: defaultCamera.center,
        zoom: defaultCamera.zoom,
        tilt: defaultCamera.tilt,
        heading: defaultCamera.heading,
        mapId,
        disableDefaultUI: false,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        keyboardShortcuts: true,
        gestureHandling: "greedy",
      });
    } catch (e) {
      onError((e as Error).message, "init");
      return;
    }
    mapRef.current = map;

    // A raster Map ID renders a perfectly good flat basemap and then silently
    // drops every WebGLOverlayView object on it. Say so instead.
    let renderingChecked = false;
    const checkRenderingType = () => {
      if (renderingChecked) return true;
      const type = map.getRenderingType?.();
      // Stays UNINITIALIZED until the map has actually drawn. If tiles never
      // arrive it never resolves, and saying nothing is the right answer.
      if (!type || type === google.maps.RenderingType.UNINITIALIZED) return false;
      renderingChecked = true;
      if (type !== google.maps.RenderingType.VECTOR) {
        onError(
          `This Map ID renders ${String(type).toLowerCase()} tiles. WebGLOverlayView - and so every structure, river and water surface in this app - needs a vector map.`,
          "raster-map-id",
        );
      }
      return true;
    };
    const renderingListener = map.addListener("idle", checkRenderingType);
    // idle can be missed or never fire, so poll for a while as well.
    const renderingPoll = window.setInterval(() => {
      if (checkRenderingType()) window.clearInterval(renderingPoll);
    }, 400);
    window.setTimeout(() => window.clearInterval(renderingPoll), 15000);

    const anchor = { lat: defaultCamera.center.lat, lng: defaultCamera.center.lng, altitude: 0 };
    const overlay = new TickingOverlay({ map, anchor, upAxis: "Z", animationMode: "always" });
    overlayRef.current = overlay;

    const scene = new FloodScene(overlay);
    scene.addWaterways(data.waterways.features);
    scene.addZones(data.zones.features);
    scene.addProjects(data.projects.features);
    scene.setAnimated(animated);
    overlay.onTick = (dt) => scene.tick(dt);
    sceneRef.current = scene;
    onSceneReady(scene);

    // Optional GLB structures declared in the project data.
    for (const feature of data.projects.features) {
      const url = feature.properties.modelUrl;
      if (!url) continue;
      loadGLB(url)
        .then((obj) => scene.replaceProjectModel(feature.id, obj))
        .catch(() => {
          /* keep the placeholder; a missing model must not break the map */
        });
    }

    const zoomListener = map.addListener("zoom_changed", () => {
      const z = map.getZoom();
      if (typeof z === "number") setZoom(z);
    });

    const clickListener = map.addListener("click", (event: google.maps.MapMouseEvent & { domEvent?: MouseEvent }) => {
      const dom = event.domEvent as MouseEvent | undefined;
      const bounds = containerRef.current?.getBoundingClientRect();
      if (!dom || !bounds) return;
      const point = new Vector2(
        ((dom.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((dom.clientY - bounds.top) / bounds.height) * 2 + 1,
      );
      const hits = overlay.raycast(point, scene.pickables, { recursive: true });
      const hit = hits.find((h) => h.object.userData?.kind === "project");
      onSelectProject((hit?.object.userData?.id as string) ?? null);
    });

    return () => {
      google.maps.event.removeListener(clickListener);
      google.maps.event.removeListener(zoomListener);
      google.maps.event.removeListener(renderingListener);
      window.clearInterval(renderingPoll);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      scene.dispose();
      overlay.setMap(null as unknown as google.maps.Map);
      sceneRef.current = null;
      overlayRef.current = null;
      mapRef.current = null;
    };
    // Deliberately one-shot: the map and scene are built once from the loaded data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, mapId]);

  // ----------------------------------------------------------------- updates
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    (Object.keys(layers) as LayerId[]).forEach((id) => scene.setLayerVisible(id, layers[id]));
    overlayRef.current?.requestRedraw();
  }, [layers]);

  useEffect(() => {
    sceneRef.current?.setZoneDepths(depths);
    overlayRef.current?.requestRedraw();
  }, [depths]);

  useEffect(() => {
    sceneRef.current?.setAnimated(animated);
    if (overlayRef.current) overlayRef.current.animationMode = animated ? "always" : "ondemand";
    overlayRef.current?.requestRedraw();
  }, [animated]);

  // ------------------------------------------------------------ camera moves
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !cameraTarget) return;

    const from: CameraPose = {
      lat: map.getCenter()?.lat() ?? cameraTarget.lat,
      lng: map.getCenter()?.lng() ?? cameraTarget.lng,
      zoom: map.getZoom() ?? cameraTarget.zoom,
      tilt: map.getTilt() ?? cameraTarget.tilt,
      heading: map.getHeading() ?? cameraTarget.heading,
    };

    if (!animated) {
      map.moveCamera({
        center: { lat: cameraTarget.lat, lng: cameraTarget.lng },
        zoom: cameraTarget.zoom,
        tilt: cameraTarget.tilt,
        heading: cameraTarget.heading,
      });
      return;
    }

    // Take the short way round the compass.
    let headingDelta = cameraTarget.heading - from.heading;
    while (headingDelta > 180) headingDelta -= 360;
    while (headingDelta < -180) headingDelta += 360;

    const duration = 2200;
    const start = performance.now();
    if (animationRef.current) cancelAnimationFrame(animationRef.current);

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const k = ease(t);
      map.moveCamera({
        center: {
          lat: from.lat + (cameraTarget.lat - from.lat) * k,
          lng: from.lng + (cameraTarget.lng - from.lng) * k,
        },
        zoom: from.zoom + (cameraTarget.zoom - from.zoom) * k,
        tilt: from.tilt + (cameraTarget.tilt - from.tilt) * k,
        heading: from.heading + headingDelta * k,
      });
      if (t < 1) animationRef.current = requestAnimationFrame(step);
    };
    animationRef.current = requestAnimationFrame(step);

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [cameraTarget, animated]);

  // Centre on a project selected from the list.
  useEffect(() => {
    if (!selectedProjectId || !mapRef.current) return;
    const feature = data.projects.features.find((f) => f.id === selectedProjectId);
    if (!feature) return;
    const [lng, lat] = feature.geometry.coordinates;
    mapRef.current.panTo({ lat, lng });
  }, [selectedProjectId, data.projects.features]);

  const stepZoom = (delta: number) => {
    const map = mapRef.current;
    if (!map) return;
    const next = Math.min(MAX_MAP_ZOOM, Math.max(MIN_MAP_ZOOM, (map.getZoom() ?? zoom) + delta));
    map.setZoom(next);
  };

  const resetView = () => {
    const map = mapRef.current;
    if (!map) return;
    const { defaultCamera } = data.tour;
    map.moveCamera({
      center: defaultCamera.center,
      zoom: defaultCamera.zoom,
      tilt: defaultCamera.tilt,
      heading: defaultCamera.heading,
    });
  };

  return (
    <div className="map-shell">
      <div
        ref={containerRef}
        className="map-canvas"
        role="application"
        aria-label="Interactive 3D map of Bulacan flood control demonstration"
      />
      <MapZoomControls
        zoomLabel={`z${zoom.toFixed(1)}`}
        canZoomIn={zoom < MAX_MAP_ZOOM}
        canZoomOut={zoom > MIN_MAP_ZOOM}
        onZoomIn={() => stepZoom(1)}
        onZoomOut={() => stepZoom(-1)}
        onReset={resetView}
        resetLabel="Back to the province view"
      />
    </div>
  );
}
