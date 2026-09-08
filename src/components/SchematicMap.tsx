import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppData, LayerId } from "../types";
import { CATEGORY_HEX } from "../lib/palette";
import { MapZoomControls } from "./MapZoomControls";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEP,
  centreOn,
  panBy,
  resetViewport,
  viewBoxOf,
  zoomAbout,
  zoomByStep,
  zoomOf,
  type Viewport,
} from "../lib/viewport";

interface Props {
  data: AppData;
  layers: Record<LayerId, boolean>;
  depths: Record<string, number>;
  selectedProjectId: string | null;
  onSelectProject: (id: string | null) => void;
  reducedMotion: boolean;
}

const WIDTH = 1000;
const PAD = 40;
/** Pointer travel, in CSS pixels, beyond which a press is a drag, not a click. */
const DRAG_SLOP = 4;

/**
 * Credential-free, WebGL-free fallback view.
 *
 * A plain SVG schematic drawn from the same GeoJSON the 3D map uses, so the
 * layer toggles, the timeline, the flood model and the details panel all remain
 * usable with no Google Maps API key and no GPU. It pans and zooms like a map:
 * geometry scales with the viewBox while labels, markers and stroke widths are
 * counter-scaled so they stay legible at every magnification.
 *
 * It is a schematic, not a basemap: there is no imagery and no coastline.
 */
export function SchematicMap({
  data,
  layers,
  depths,
  selectedProjectId,
  onSelectProject,
  reducedMotion,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);

  const { toX, toY, height } = useMemo(() => {
    const lngs: number[] = [];
    const lats: number[] = [];
    for (const f of data.waterways.features) {
      for (const [lng, lat] of f.geometry.coordinates) {
        lngs.push(lng);
        lats.push(lat);
      }
    }
    for (const f of data.zones.features) {
      for (const [lng, lat] of f.geometry.coordinates[0]) {
        lngs.push(lng);
        lats.push(lat);
      }
    }
    for (const f of data.projects.features) {
      lngs.push(f.geometry.coordinates[0]);
      lats.push(f.geometry.coordinates[1]);
    }
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    // Fit the width, then size the canvas to the data's own aspect ratio
    // (with the usual cos(lat) correction) so there is no dead space.
    const s = (WIDTH - PAD * 2) / (maxLng - minLng || 1);
    const latScale = s / Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
    const h = (maxLat - minLat) * latScale + PAD * 2 + 26;
    return {
      height: h,
      toX: (lng: number) => PAD + (lng - minLng) * s,
      toY: (lat: number) => h - 26 - PAD - (lat - minLat) * latScale,
    };
  }, [data]);

  const base: Viewport = useMemo(() => ({ x: 0, y: 0, w: WIDTH, h: height }), [height]);
  const [viewport, setViewport] = useState<Viewport>(base);
  useEffect(() => setViewport(resetViewport(base)), [base]);

  const zoom = zoomOf(viewport, base);
  /** Screen-constant sizing: undo the viewBox scale for text and markers. */
  const k = 1 / zoom;

  /** Client pixel position to map coordinates. */
  const toMap = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: viewport.x + ((clientX - rect.left) / rect.width) * viewport.w,
      y: viewport.y + ((clientY - rect.top) / rect.height) * viewport.h,
    };
  }, [viewport]);

  // Wheel zoom. Registered manually because React's wheel listener is passive,
  // and this one has to preventDefault to stop the page scrolling.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const at = toMap(e.clientX, e.clientY);
      if (!at) return;
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      setViewport((vp) => zoomAbout(vp, base, factor, at.x, at.y));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [base, toMap]);

  // Drag to pan with one pointer, pinch to zoom+pan with two - the gesture a
  // touch user expects from any map. Mouse and single-finger touch share the
  // same drag path; a second finger touching down promotes it to a pinch.
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinch = useRef<{ distance: number; midX: number; midY: number } | null>(null);
  const suppressClick = useRef(false);
  const [panning, setPanning] = useState(false);

  const pinchGeometry = (pts: { x: number; y: number }[]) => ({
    distance: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
    midX: (pts[0].x + pts[1].x) / 2,
    midY: (pts[0].y + pts[1].y) / 2,
  });

  /**
   * Capture is a nice-to-have - it lets a finger keep steering the gesture
   * after sliding outside the SVG's bounds. `setPointerCapture` can throw
   * ("No active pointer with the given id is found") when the UA's own
   * pointer bookkeeping and this component's disagree even briefly, which
   * happens across real browser/OS combinations, not only in synthetic
   * events. Losing capture must never abort the rest of the gesture handler -
   * that would strand mid-pinch state with no way to finish the gesture.
   */
  const tryCapture = (id: number) => {
    try {
      svgRef.current?.setPointerCapture(id);
    } catch {
      // Fall through: the gesture still tracks via pointermove/pointerup as
      // long as the finger stays over the element, just without capture.
    }
  };

  const tryRelease = (id: number) => {
    try {
      svgRef.current?.releasePointerCapture(id);
    } catch {
      // Already released, or never actually captured - nothing to undo.
    }
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (pointers.current.size === 0) suppressClick.current = false; // fresh gesture
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2) {
      // A second finger landed: hand off from single-pointer drag to pinch.
      // Capture both fingers so the gesture tracks even if they slide outside
      // the SVG's bounds - a pinch has no marker under it to click through to.
      drag.current = null;
      for (const id of pointers.current.keys()) tryCapture(id);
      const rect = svgRef.current?.getBoundingClientRect();
      const pts = [...pointers.current.values()];
      if (rect) {
        pinch.current = pinchGeometry(pts.map((p) => ({ x: p.x - rect.left, y: p.y - rect.top })));
      }
      setPanning(true);
      suppressClick.current = true;
    } else if (pointers.current.size === 1) {
      // Capture is claimed only once a drag actually starts: capturing here
      // would retarget the click away from the marker under the cursor.
      drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2 && pinch.current) {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const pts = [...pointers.current.values()].map((p) => ({ x: p.x - rect.left, y: p.y - rect.top }));
      const now = pinchGeometry(pts);
      const prev = pinch.current;
      pinch.current = now;
      setViewport((vp) => {
        const scaleFactor = prev.distance > 4 && now.distance > 4 ? now.distance / prev.distance : 1;
        const anchor = toMap(rect.left + now.midX, rect.top + now.midY) ?? { x: vp.x + vp.w / 2, y: vp.y + vp.h / 2 };
        const zoomed = zoomAbout(vp, base, scaleFactor, anchor.x, anchor.y);
        const dxMap = ((prev.midX - now.midX) / rect.width) * zoomed.w;
        const dyMap = ((prev.midY - now.midY) / rect.height) * zoomed.h;
        return panBy(zoomed, base, dxMap, dyMap);
      });
      return;
    }

    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dxPx = e.clientX - d.x;
    const dyPx = e.clientY - d.y;
    if (!d.moved && Math.hypot(dxPx, dyPx) < DRAG_SLOP) return;
    if (!d.moved) {
      d.moved = true;
      setPanning(true);
      tryCapture(e.pointerId);
    }
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    d.x = e.clientX;
    d.y = e.clientY;
    setViewport((vp) =>
      panBy(vp, base, (-dxPx / rect.width) * vp.w, (-dyPx / rect.height) * vp.h),
    );
  };

  const endDrag = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);

    if (pointers.current.size < 2) {
      pinch.current = null;
    }
    if (pointers.current.size === 1) {
      // One finger remains after a pinch: resume as a plain drag from here,
      // rather than jumping to the pinch midpoint's old baseline.
      const [[id, pt]] = pointers.current;
      drag.current = { id, x: pt.x, y: pt.y, moved: true };
      return;
    }

    const d = drag.current;
    if (d?.id !== e.pointerId) return;
    if (d.moved) {
      tryRelease(e.pointerId);
      // The click that follows a drag is the end of the drag, not a selection.
      suppressClick.current = true;
    }
    drag.current = null;
    setPanning(false);
  };

  const consumeClick = () => {
    const suppressed = suppressClick.current;
    suppressClick.current = false;
    return suppressed;
  };

  const zoomIn = () => setViewport((vp) => zoomByStep(vp, base, ZOOM_STEP));
  const zoomOut = () => setViewport((vp) => zoomByStep(vp, base, 1 / ZOOM_STEP));
  const reset = () => setViewport(resetViewport(base));

  // Zooming to a project is the useful thing to do with a selection here, but
  // only when the user has already zoomed in - otherwise it would yank the
  // whole-province view away every time a marker is clicked.
  useEffect(() => {
    if (!selectedProjectId || zoom <= 1) return;
    const f = data.projects.features.find((p) => p.id === selectedProjectId);
    if (!f) return;
    setViewport((vp) => centreOn(vp, base, toX(f.geometry.coordinates[0]), toY(f.geometry.coordinates[1])));
    // Re-centring is a response to the selection alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId]);

  const onKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    const step = viewport.w * 0.15;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (moves[e.key]) {
      e.preventDefault();
      const [dx, dy] = moves[e.key];
      setViewport((vp) => panBy(vp, base, dx, dy));
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      zoomIn();
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      zoomOut();
    } else if (e.key === "0") {
      e.preventDefault();
      reset();
    }
  };

  return (
    <div className="schematic-wrap">
      <svg
        ref={svgRef}
        viewBox={viewBoxOf(viewport)}
        preserveAspectRatio="xMidYMid meet"
        className={`schematic${panning ? " panning" : ""}`}
        role="application"
        tabIndex={0}
        aria-label="Schematic map of Bulacan rivers, flood zones and demonstration project locations. Arrow keys pan, plus and minus zoom, zero resets."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      >
        <defs>
          <linearGradient id="bay" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#0d2a3f" />
            <stop offset="100%" stopColor="#122f47" />
          </linearGradient>
        </defs>
        <rect x={0} y={0} width={WIDTH} height={height} fill="url(#bay)" />

        {layers["flood-zones"] &&
          data.zones.features.map((zone) => {
            const d =
              zone.geometry.coordinates[0]
                .map(([lng, lat], i) => `${i === 0 ? "M" : "L"}${toX(lng).toFixed(1)},${toY(lat).toFixed(1)}`)
                .join(" ") + " Z";
            const depth = depths[zone.id] ?? 0;
            const showWater = layers["water-surface"] && depth > 0.01;
            const intensity = Math.min(1, depth / 1.2);
            return (
              <g key={zone.id}>
                <path d={d} fill="#1f6f8b" fillOpacity={0.13} stroke="#4a8fa8" strokeWidth={k} strokeDasharray={`${4 * k} ${4 * k}`} />
                {showWater && (
                  <path
                    d={d}
                    fill={intensity > 0.55 ? "#b03a4a" : "#2a7fbf"}
                    fillOpacity={Math.min(0.66, 0.16 + depth * 0.85)}
                    className={reducedMotion ? undefined : "zone-water-pulse"}
                  >
                    <title>{`${zone.properties.name}: modelled ${depth.toFixed(2)} m (illustrative)`}</title>
                  </path>
                )}
              </g>
            );
          })}

        {layers.waterways &&
          data.waterways.features.map((w) => {
            const d = w.geometry.coordinates
              .map(([lng, lat], i) => `${i === 0 ? "M" : "L"}${toX(lng).toFixed(1)},${toY(lat).toFixed(1)}`)
              .join(" ");
            const width = Math.max(2.5, Math.min(9, w.properties.widthMeters / 22)) * k;
            return (
              <g key={w.id}>
                <path d={d} fill="none" stroke="#0b4f78" strokeWidth={width + 3 * k} strokeLinecap="round" strokeLinejoin="round" />
                <path
                  d={d}
                  fill="none"
                  stroke="#4aa8e0"
                  strokeWidth={width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={reducedMotion ? undefined : `${16 * k} ${12 * k}`}
                  className={reducedMotion ? undefined : "flow-dash"}
                >
                  <title>{`${w.properties.name} - schematic centreline`}</title>
                </path>
              </g>
            );
          })}

        {data.projects.features.map((f) => {
          if (!layers[f.properties.category]) return null;
          const x = toX(f.geometry.coordinates[0]);
          const y = toY(f.geometry.coordinates[1]);
          const selected = f.id === selectedProjectId;
          return (
            <g
              key={f.id}
              className="schematic-marker"
              tabIndex={0}
              role="button"
              aria-label={f.properties.name}
              onClick={() => {
                if (!consumeClick()) onSelectProject(f.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onSelectProject(f.id);
                }
              }}
            >
              <circle
                cx={x}
                cy={y}
                r={(selected ? 13 : 8) * k}
                fill={CATEGORY_HEX[f.properties.category]}
                stroke="#04121d"
                strokeWidth={2 * k}
              />
              {selected && (
                <circle cx={x} cy={y} r={19 * k} fill="none" stroke={CATEGORY_HEX[f.properties.category]} strokeWidth={2 * k} strokeOpacity={0.6} />
              )}
              <title>{`${f.properties.name} (demonstration placeholder)`}</title>
            </g>
          );
        })}

        {layers["flood-zones"] &&
          data.zones.features.map((zone) => {
            const ring = zone.geometry.coordinates[0];
            const cx = ring.reduce((a, p) => a + toX(p[0]), 0) / ring.length;
            const cy = ring.reduce((a, p) => a + toY(p[1]), 0) / ring.length;
            const depth = depths[zone.id] ?? 0;
            return (
              <text
                key={`lbl-${zone.id}`}
                x={cx}
                y={cy}
                textAnchor="middle"
                className="zone-label"
                style={{ fontSize: 13 * k, strokeWidth: 3 * k }}
              >
                {zone.properties.name.split(" (")[0]}
                {depth > 0.01 && (
                  <tspan x={cx} dy="1.15em" className="zone-depth" style={{ fontSize: 11 * k }}>
                    {depth.toFixed(2)} m modelled
                  </tspan>
                )}
              </text>
            );
          })}

        {layers.waterways &&
          data.waterways.features.map((w) => {
            const c = w.geometry.coordinates;
            const mid = c[Math.floor(c.length / 2)];
            return (
              <text
                key={`lbl-${w.id}`}
                x={toX(mid[0]) + 8 * k}
                y={toY(mid[1]) - 8 * k}
                className="river-label"
                style={{ fontSize: 11.5 * k, strokeWidth: 3 * k }}
              >
                {w.properties.name}
              </text>
            );
          })}

        <text
          x={viewport.x + 8 * k}
          y={viewport.y + viewport.h - 8 * k}
          className="schematic-note"
          style={{ fontSize: 13 * k }}
        >
          Schematic fallback view - simplified geometry, no basemap. Demonstration data.
        </text>
      </svg>

      <MapZoomControls
        zoomLabel={`${zoom.toFixed(1)}×`}
        canZoomIn={zoom < MAX_ZOOM - 1e-6}
        canZoomOut={zoom > MIN_ZOOM + 1e-6}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onReset={reset}
      />
    </div>
  );
}
