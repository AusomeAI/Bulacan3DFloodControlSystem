import { useRef } from "react";
import type { FloodZoneFeature, ProjectFeature, SourceRecord } from "../types";
import type { ZoneDayState } from "../lib/floodModel";
import { CATEGORY_HEX } from "../lib/palette";
import { LAYER_LABELS } from "../lib/palette";

interface Props {
  feature: ProjectFeature | null;
  zone: FloodZoneFeature | null;
  zoneState: ZoneDayState | null;
  source: SourceRecord | undefined;
  canImportModels: boolean;
  onClose: () => void;
  onImportModel: (projectId: string, file: File) => void;
}

export function DetailsPanel({
  feature,
  zone,
  zoneState,
  source,
  canImportModels,
  onClose,
  onImportModel,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  if (!feature) {
    return (
      <section className="panel details empty" aria-labelledby="details-heading">
        <h2 id="details-heading">Project details</h2>
        <p className="muted">
          Select a marker on the map, or a project in the list, to see its record, the reporting behind it, and the
          modelled state of the zone it sits in.
        </p>
      </section>
    );
  }

  const p = feature.properties;
  return (
    <section className="panel details" aria-labelledby="details-heading">
      <div className="panel-head">
        <h2 id="details-heading">Project details</h2>
        <button type="button" className="link-btn" onClick={onClose} aria-label="Clear selection">
          Clear
        </button>
      </div>

      <h3 className="details-title">
        <span className="dot" style={{ background: CATEGORY_HEX[p.category] }} aria-hidden="true" />
        {p.name}
      </h3>

      <p>
        <span className="tag tag-demo">demonstration placeholder</span>{" "}
        <span className="tag">{LAYER_LABELS[p.category]}</span>
      </p>

      <dl className="kv">
        <div><dt>Structure type</dt><dd>{p.structureType}</dd></div>
        <div><dt>Municipality</dt><dd>{p.municipality}</dd></div>
        <div><dt>Waterway</dt><dd>{p.river}</dd></div>
        <div><dt>Status</dt><dd>{p.status}</dd></div>
        {p.heightMeters !== undefined && <div><dt>Height (illustrative)</dt><dd>{p.heightMeters} m</dd></div>}
        {p.lengthMeters !== undefined && <div><dt>Length (illustrative)</dt><dd>{p.lengthMeters} m</dd></div>}
        {p.areaHectares !== undefined && <div><dt>Area (illustrative)</dt><dd>{p.areaHectares} ha</dd></div>}
      </dl>

      <p className="details-desc">{p.description}</p>

      <div className="context-block">
        <h4>Real programme context</h4>
        <p>{p.context}</p>
        {source ? (
          <p className="cite">
            Source:{" "}
            <a href={source.url} target="_blank" rel="noreferrer noopener">
              {source.publisher} &mdash; {source.title}
            </a>{" "}
            ({source.date})
          </p>
        ) : (
          <p className="cite">Source id: {p.source} ({p.sourceDate})</p>
        )}
        <p className="caveat">
          This context describes the surrounding programme as publicly reported. It does not describe this placeholder
          feature, and no budget, completion percentage or flood-reduction figure is attributed to it.
        </p>
      </div>

      {zone && (
        <div className="context-block">
          <h4>Zone state on the selected day</h4>
          <p className="muted">{zone.properties.name} &mdash; {zone.properties.regime}</p>
          {zoneState ? (
            <dl className="kv">
              <div><dt>Modelled depth</dt><dd>{zoneState.depthM.toFixed(2)} m <span className="tag tag-model">model</span></dd></div>
              <div><dt>Outfall shut by tide</dt><dd>{zoneState.gateClosedHours.toFixed(1)} h/day</dd></div>
              <div><dt>Inflow: rainfall</dt><dd>{zoneState.inflow.rainfall.toFixed(1)} mm</dd></div>
              <div><dt>Inflow: upstream</dt><dd>{zoneState.inflow.upstream.toFixed(1)} mm</dd></div>
              <div><dt>Inflow: tidal ingress</dt><dd>{zoneState.inflow.tidal.toFixed(1)} mm</dd></div>
              <div><dt>Barrier overtopped</dt><dd>{zoneState.barrierOvertopped ? "yes" : "no"}</dd></div>
            </dl>
          ) : (
            <p className="muted">No modelled state for this day.</p>
          )}
          <p className="caveat">Illustrative model output on schematic drivers. Not a measurement, not a forecast.</p>
        </div>
      )}

      <div className="context-block">
        <h4>3D model</h4>
        <p className="muted">
          {p.modelUrl
            ? `Loading GLB from ${p.modelUrl}.`
            : "No GLB attached. Set \"modelUrl\" on this feature in projects.geojson, or import one now to preview it."}
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".glb,.gltf,model/gltf-binary"
          className="visually-hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImportModel(feature.id, file);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className="btn"
          disabled={!canImportModels}
          onClick={() => fileRef.current?.click()}
        >
          Import GLB for this project
        </button>
        {!canImportModels && <p className="caveat">Model import needs the 3D map; it is unavailable in the fallback view.</p>}
      </div>
    </section>
  );
}
