import { useMemo, useRef } from "react";
import type { SourceRecord } from "../types";
import {
  FILTER_LABELS,
  countMatching,
  matchesFilter,
  stepToRecord,
  summariseDay,
  type DayFilter,
  type DayRecord,
} from "../lib/eventDays";

interface Props {
  records: DayRecord[];
  index: number;
  filter: DayFilter;
  sourceById: Record<string, SourceRecord>;
  onIndex: (i: number) => void;
  onFilter: (f: DayFilter) => void;
}

const FILTERS: DayFilter[] = ["all", "rain", "flood", "reported"];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function label(date: string) {
  const [, m, d] = date.split("-").map(Number);
  return { day: String(d).padStart(2, "0"), month: MONTHS[m - 1] };
}

/**
 * Calendar strip over the simulated month.
 *
 * One cell per day, sized by rainfall and coloured by modelled flood severity,
 * with a marker for days carrying published reporting. Cells are buttons, so
 * the whole month is reachable by keyboard, and the prev/next controls jump
 * between days matching the active filter rather than stepping one day at a
 * time.
 */
export function DateNavigator({ records, index, filter, sourceById, onIndex, onFilter }: Props) {
  const stripRef = useRef<HTMLDivElement>(null);
  const current = records[index];

  const maxRain = useMemo(() => Math.max(1, ...records.map((r) => r.rainMm)), [records]);
  const prev = stepToRecord(records, index, -1, filter);
  const next = stepToRecord(records, index, 1, filter);

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const move = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!move) return;
    e.preventDefault();
    const target = Math.min(records.length - 1, Math.max(0, i + move));
    onIndex(target);
    const buttons = stripRef.current?.querySelectorAll<HTMLButtonElement>(".day-cell");
    buttons?.[target]?.focus();
  };

  return (
    <section className="panel date-nav" aria-labelledby="datenav-heading">
      <div className="panel-head">
        <h2 id="datenav-heading">
          Past month &mdash; {records[0]?.date} to {records[records.length - 1]?.date}
        </h2>
        <span className="tag tag-schematic">simulated day by day</span>
      </div>

      <div className="filter-row">
        <div className="filter-chips" role="group" aria-label="Show days with">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              className={`chip${filter === f ? " active" : ""}`}
              aria-pressed={filter === f}
              onClick={() => onFilter(f)}
            >
              {FILTER_LABELS[f]}
              <span className="chip-count">{countMatching(records, f)}</span>
            </button>
          ))}
        </div>

        <div className="step-buttons">
          <button
            type="button"
            className="btn small"
            disabled={prev === null}
            onClick={() => prev !== null && onIndex(prev)}
            aria-label="Previous matching day"
          >
            ◀ Prev
          </button>
          <button
            type="button"
            className="btn small"
            disabled={next === null}
            onClick={() => next !== null && onIndex(next)}
            aria-label="Next matching day"
          >
            Next ▶
          </button>
        </div>
      </div>

      <div className="strip-row">
        <div className="day-strip" ref={stripRef} role="group" aria-label="Days in the simulated month">
          {records.map((r) => {
            const { day, month } = label(r.date);
            const matches = matchesFilter(r, filter);
            const classes = [
              "day-cell",
              `sev-${r.severity}`,
              r.index === index ? "current" : "",
              matches ? "" : "dim",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                key={r.date}
                type="button"
                className={classes}
                aria-current={r.index === index ? "date" : undefined}
                aria-label={`${r.date}: ${summariseDay(r)}`}
                title={`${r.date} — ${summariseDay(r)}`}
                onClick={() => onIndex(r.index)}
                onKeyDown={(e) => onKeyDown(e, r.index)}
              >
                <span className="day-month">{day === "01" || r.index === 0 ? month : ""}</span>
                <span className="day-num">{day}</span>
                <span className="rain-bar" style={{ height: `${Math.round((r.rainMm / maxRain) * 26)}px` }} />
                <span className="day-flags">
                  {r.hasFlood && <span className="flag flood" aria-hidden="true" />}
                  {r.hasReport && <span className="flag report" aria-hidden="true" />}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <ul className="strip-legend">
        <li><span className="legend-bar" /> Rainfall</li>
        <li><span className="legend-sev sev-1" /> 1&ndash;2 zones</li>
        <li><span className="legend-sev sev-2" /> 3+ zones or ≥ 0.4 m</li>
        <li><span className="legend-sev sev-3" /> 6+ zones or ≥ 0.9 m</li>
        <li><span className="flag report" /> Published report</li>
      </ul>

      {current && (
        <div className="day-detail" aria-live="polite">
          <h3>{current.date}</h3>
          <p className="muted">{summariseDay(current)}</p>

          {current.floodedZones.length > 0 && (
            <table className="corr-table">
              <thead>
                <tr>
                  <th scope="col">Zone above threshold</th>
                  <th scope="col">Modelled depth</th>
                  <th scope="col">Outfall shut</th>
                </tr>
              </thead>
              <tbody>
                {current.floodedZones.map((z) => (
                  <tr key={z.id}>
                    <th scope="row">{z.name}</th>
                    <td>{z.depthM.toFixed(2)} m</td>
                    <td>{z.gateClosedHours.toFixed(1)} h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {current.reports.map((o, i) => {
            const src = sourceById[o.source];
            return (
              <blockquote key={i} className="day-report">
                <p>{o.text}</p>
                {src && (
                  <cite>
                    <a href={src.url} target="_blank" rel="noreferrer noopener">
                      {src.publisher}
                    </a>
                    , {src.date} <span className="tag tag-reported">reported</span>
                  </cite>
                )}
              </blockquote>
            );
          })}

          <p className="caveat">
            Rainfall, tide and depth on this day are simulated. Quoted reports and their figures are real and dated;
            they are shown beside the simulation, not derived from it.
          </p>
        </div>
      )}
    </section>
  );
}
