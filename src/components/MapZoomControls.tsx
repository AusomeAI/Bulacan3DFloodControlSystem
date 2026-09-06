interface ZoomControlProps {
  zoomLabel: string;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  resetLabel?: string;
}

/** Zoom cluster shared by the schematic map and the 3D map. */
export function MapZoomControls({
  zoomLabel,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onReset,
  resetLabel = "Reset the view",
}: ZoomControlProps) {
  return (
    <div className="map-zoom" role="group" aria-label="Map zoom">
      <button type="button" className="zoom-btn" onClick={onZoomIn} disabled={!canZoomIn} aria-label="Zoom in" title="Zoom in">
        +
      </button>
      <span className="zoom-level" aria-live="polite">
        {zoomLabel}
      </span>
      <button type="button" className="zoom-btn" onClick={onZoomOut} disabled={!canZoomOut} aria-label="Zoom out" title="Zoom out">
        −
      </button>
      <button type="button" className="zoom-btn reset" onClick={onReset} aria-label={resetLabel} title={resetLabel}>
        ⤢
      </button>
    </div>
  );
}
