import type { LayerId } from "../types";
import { LAYER_LABELS, LAYER_ORDER, LAYER_SWATCH } from "../lib/palette";

interface Props {
  layers: Record<LayerId, boolean>;
  counts: Record<string, number>;
  onToggle: (id: LayerId) => void;
  onSetAll: (value: boolean) => void;
}

export function LayerControls({ layers, counts, onToggle, onSetAll }: Props) {
  return (
    <section className="panel" aria-labelledby="layers-heading">
      <div className="panel-head">
        <h2 id="layers-heading">Layers</h2>
        <div className="panel-head-actions">
          <button type="button" className="link-btn" onClick={() => onSetAll(true)}>
            All
          </button>
          <button type="button" className="link-btn" onClick={() => onSetAll(false)}>
            None
          </button>
        </div>
      </div>
      <ul className="layer-list">
        {LAYER_ORDER.map((id) => (
          <li key={id}>
            <label className="layer-row">
              <input type="checkbox" checked={layers[id]} onChange={() => onToggle(id)} />
              <span className="swatch" style={{ background: LAYER_SWATCH[id] }} aria-hidden="true" />
              <span className="layer-label">{LAYER_LABELS[id]}</span>
              {counts[id] !== undefined && <span className="layer-count">{counts[id]}</span>}
            </label>
          </li>
        ))}
      </ul>
      <p className="panel-foot">
        Structure layers show <strong>demonstration placeholders</strong>. The waterway layer uses schematic
        centrelines. Swap <code>public/data/*.geojson</code> to show real DPWH contract records.
      </p>
    </section>
  );
}
