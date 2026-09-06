import { useMemo } from "react";
import type { DriversDoc, SourceRecord } from "../types";
import type { ModelRun } from "../lib/floodModel";

interface Props {
  drivers: DriversDoc;
  run: ModelRun;
  index: number;
  playing: boolean;
  reducedMotion: boolean;
  sourceById: Record<string, SourceRecord>;
  onIndex: (i: number) => void;
  onTogglePlay: () => void;
}

const W = 640;
const H = 150;
const PAD_L = 34;
const PAD_R = 34;
const PAD_T = 12;
const PAD_B = 24;

export function TimelinePanel({
  drivers,
  run,
  index,
  playing,
  reducedMotion,
  sourceById,
  onIndex,
  onTogglePlay,
}: Props) {
  const days = drivers.days;
  const day = days[index];
  const chart = useMemo(() => {
    const maxRain = Math.max(1, ...days.map((d) => d.rain_mm));
    const maxTide = Math.max(0.01, ...days.map((d) => d.tide_max_m));
    const maxDepth = Math.max(0.01, ...run.provincialMeanDepthM);
    const innerW = W - PAD_L - PAD_R;
    const innerH = H - PAD_T - PAD_B;
    const x = (i: number) => PAD_L + (innerW * i) / Math.max(1, days.length - 1);
    const yRain = (v: number) => H - PAD_B - (innerH * v) / maxRain;
    const yTide = (v: number) => H - PAD_B - (innerH * v) / maxTide;
    const yDepth = (v: number) => H - PAD_B - (innerH * v) / maxDepth;
    const barW = Math.max(2, innerW / days.length - 2);
    return { maxRain, maxTide, maxDepth, x, yRain, yTide, yDepth, barW };
  }, [days, run]);

  const observationsForDay = drivers.observations.filter((o) => o.date === day?.date);
  const observationDates = new Set(drivers.observations.map((o) => o.date));

  return (
    <section className="panel timeline" aria-labelledby="timeline-heading">
      <div className="panel-head">
        <h2 id="timeline-heading">Timeline &mdash; drivers and modelled response</h2>
        <span className="tag tag-model">illustrative model</span>
      </div>

      <div className="timeline-controls">
        <button
          type="button"
          className="play-btn"
          onClick={onTogglePlay}
          aria-pressed={playing}
          aria-label={playing ? "Pause the timeline" : "Play the timeline"}
        >
          {playing ? "❚❚ Pause" : "▶ Play"}
        </button>
        <input
          type="range"
          min={0}
          max={days.length - 1}
          value={index}
          onChange={(e) => onIndex(Number(e.target.value))}
          aria-label="Timeline day"
          className="scrub"
        />
        <time className="timeline-date" dateTime={day?.date}>
          {day?.date}
        </time>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Daily rainfall, tide and modelled mean water depth">
        {days.map((d, i) => (
          <rect
            key={d.date}
            x={chart.x(i) - chart.barW / 2}
            y={chart.yRain(d.rain_mm)}
            width={chart.barW}
            height={H - PAD_B - chart.yRain(d.rain_mm)}
            fill={i === index ? "#7cc4ff" : "#37628a"}
          >
            <title>{`${d.date}: ${d.rain_mm} mm (schematic)`}</title>
          </rect>
        ))}

        <polyline
          fill="none"
          stroke="#f2a03d"
          strokeWidth={2}
          points={days.map((d, i) => `${chart.x(i)},${chart.yTide(d.tide_max_m)}`).join(" ")}
        />
        <polyline
          fill="none"
          stroke="#e86a6a"
          strokeWidth={2}
          strokeDasharray="5 3"
          points={run.provincialMeanDepthM.map((v, i) => `${chart.x(i)},${chart.yDepth(v)}`).join(" ")}
        />

        {days.map((d, i) =>
          observationDates.has(d.date) ? (
            <circle key={`obs-${d.date}`} cx={chart.x(i)} cy={PAD_T + 4} r={4} fill="#ffd166">
              <title>{`${d.date}: reported observation`}</title>
            </circle>
          ) : null,
        )}

        <line x1={chart.x(index)} y1={PAD_T} x2={chart.x(index)} y2={H - PAD_B} stroke="#ffffff" strokeOpacity={0.55} strokeWidth={1} />
        <text x={PAD_L} y={H - 6} className="chart-label">
          {days[0]?.date}
        </text>
        <text x={W - PAD_R} y={H - 6} textAnchor="end" className="chart-label">
          {days[days.length - 1]?.date}
        </text>
      </svg>

      <ul className="chart-legend">
        <li><span className="swatch" style={{ background: "#37628a" }} /> Rainfall (mm, schematic)</li>
        <li><span className="swatch" style={{ background: "#f2a03d" }} /> Manila Bay daily high tide (m, schematic)</li>
        <li><span className="swatch" style={{ background: "#e86a6a" }} /> Modelled mean depth (m, illustrative)</li>
        <li><span className="swatch" style={{ background: "#ffd166" }} /> Reported observation (real, cited)</li>
      </ul>

      {day && (
        <dl className="readout">
          <div>
            <dt>Rainfall</dt>
            <dd>{day.rain_mm} mm <span className="tag tag-schematic">schematic</span></dd>
          </div>
          <div>
            <dt>Bay high tide</dt>
            <dd>{day.tide_max_m.toFixed(2)} m <span className="tag tag-schematic">schematic</span></dd>
          </div>
          <div>
            <dt>Angat reservoir</dt>
            <dd>
              {day.angat_reservoir_m.toFixed(2)} m{" "}
              <span className={day.angat_dataClass === "reported" ? "tag tag-reported" : "tag tag-schematic"}>
                {day.angat_dataClass}
              </span>
            </dd>
          </div>
          <div>
            <dt>Modelled mean depth</dt>
            <dd>{run.provincialMeanDepthM[index].toFixed(2)} m <span className="tag tag-model">model</span></dd>
          </div>
        </dl>
      )}

      {observationsForDay.length > 0 && (
        <div className="observations">
          <h3>Reported on this date</h3>
          {observationsForDay.map((o, i) => {
            const src = sourceById[o.source];
            return (
              <blockquote key={i}>
                <p>{o.text}</p>
                {src && (
                  <cite>
                    <a href={src.url} target="_blank" rel="noreferrer noopener">
                      {src.publisher}
                    </a>
                    , {src.date}
                  </cite>
                )}
              </blockquote>
            );
          })}
        </div>
      )}

      <p className="panel-foot">
        {reducedMotion && <strong>Reduced motion is on: animation is paused and stepping is instant. </strong>}
        Rainfall and tide series are schematic reconstructions used to drive the demonstration; the yellow markers and
        the quoted text are real reporting with sources. The modelled depth line comes from the illustrative bucket
        model described in <code>src/lib/floodModel.ts</code> and is not a forecast.
      </p>
    </section>
  );
}
