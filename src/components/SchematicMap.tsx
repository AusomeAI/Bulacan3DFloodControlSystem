import { useMemo } from "react";
import type { AppData, LayerId } from "../types";
import { CATEGORY_HEX } from "../lib/palette";

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

/**
 * Credential-free, WebGL-free fallback view.
 *
 * This is a plain SVG schematic drawn from exactly the same GeoJSON the 3D map
 * uses, so the layer toggles, the timeline, the flood model and the details
 * panel all remain usable with no Google Maps API key and no GPU. It is a
 * schematic, not a basemap: there is no imagery, no coastline and no scale bar.
 */
export function SchematicMap({
  data,
  layers,
  depths,
  selectedProjectId,
  onSelectProject,
  reducedMotion,
}: Props) {
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

  const HEIGHT = height;

  return (
    <div className="schematic-wrap">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        className="schematic"
        role="img"
        aria-label="Schematic map of Bulacan rivers, flood zones and demonstration project locations"
      >
        <defs>
          <linearGradient id="bay" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#0d2a3f" />
            <stop offset="100%" stopColor="#122f47" />
          </linearGradient>
        </defs>
        <rect width={WIDTH} height={HEIGHT} fill="url(#bay)" />

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
                <path d={d} fill="#1f6f8b" fillOpacity={0.13} stroke="#4a8fa8" strokeWidth={1} strokeDasharray="4 4" />
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
            const width = Math.max(2.5, Math.min(9, w.properties.widthMeters / 22));
            return (
              <g key={w.id}>
                <path d={d} fill="none" stroke="#0b4f78" strokeWidth={width + 3} strokeLinecap="round" strokeLinejoin="round" />
                <path
                  d={d}
                  fill="none"
                  stroke="#4aa8e0"
                  strokeWidth={width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={reducedMotion ? undefined : "16 12"}
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
              onClick={() => onSelectProject(f.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectProject(f.id);
                }
              }}
            >
              <circle cx={x} cy={y} r={selected ? 13 : 8} fill={CATEGORY_HEX[f.properties.category]} stroke="#04121d" strokeWidth={2} />
              {selected && <circle cx={x} cy={y} r={19} fill="none" stroke={CATEGORY_HEX[f.properties.category]} strokeWidth={2} strokeOpacity={0.6} />}
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
              <text key={`lbl-${zone.id}`} x={cx} y={cy} textAnchor="middle" className="zone-label">
                {zone.properties.name.split(" (")[0]}
                {depth > 0.01 && (
                  <tspan x={cx} dy="1.15em" className="zone-depth">
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
              <text key={`lbl-${w.id}`} x={toX(mid[0]) + 8} y={toY(mid[1]) - 8} className="river-label">
                {w.properties.name}
              </text>
            );
          })}

        <text x={PAD} y={HEIGHT - 14} className="schematic-note">
          Schematic fallback view - simplified geometry, no basemap. Demonstration data.
        </text>
      </svg>
    </div>
  );
}
