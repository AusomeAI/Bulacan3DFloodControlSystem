import type { TourWaypoint } from "../types";

interface Props {
  waypoints: TourWaypoint[];
  activeIndex: number | null;
  touring: boolean;
  available: boolean;
  reducedMotion: boolean;
  onToggleTour: () => void;
  onGoTo: (index: number) => void;
}

export function TourControls({
  waypoints,
  activeIndex,
  touring,
  available,
  reducedMotion,
  onToggleTour,
  onGoTo,
}: Props) {
  const active = activeIndex !== null ? waypoints[activeIndex] : null;

  return (
    <section className="panel" aria-labelledby="tour-heading">
      <div className="panel-head">
        <h2 id="tour-heading">Camera tour</h2>
        <button type="button" className="btn small" onClick={onToggleTour} disabled={!available} aria-pressed={touring}>
          {touring ? "❚❚ Stop tour" : "▶ Start tour"}
        </button>
      </div>

      {!available && (
        <p className="caveat">
          The guided tour drives the 3D camera and needs the Google Maps view. In the fallback view the stops below
          still select their project.
        </p>
      )}
      {reducedMotion && available && (
        <p className="caveat">Reduced motion is on: the camera jumps between stops instead of flying.</p>
      )}

      <ol className="tour-list">
        {waypoints.map((w, i) => (
          <li key={w.id}>
            <button
              type="button"
              className={`tour-stop${i === activeIndex ? " active" : ""}`}
              onClick={() => onGoTo(i)}
              aria-current={i === activeIndex ? "step" : undefined}
            >
              <span className="tour-index">{i + 1}</span>
              <span className="tour-title">{w.title}</span>
            </button>
          </li>
        ))}
      </ol>

      {active && <p className="tour-caption">{active.caption}</p>}
    </section>
  );
}
