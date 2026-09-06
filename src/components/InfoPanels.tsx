import type { SourceRecord } from "../types";
import type { CorrelationSummary, ModelRun, QualitativeCheck, TideCounterfactual } from "../lib/floodModel";
import { DEPTH_EXAGGERATION } from "../lib/constants";

export type ViewMode = "3d" | "fallback";

interface SetupNoticeProps {
  reason: "no-credentials" | "no-webgl" | "maps-error" | "raster-map-id";
  detail?: string | null;
  onRetry?: () => void;
}

export function SetupNotice({ reason, detail, onRetry }: SetupNoticeProps) {
  return (
    <aside className="setup-notice" role="status">
      <h2>
        {reason === "no-credentials" && "Running without Google Maps credentials"}
        {reason === "no-webgl" && "3D rendering unavailable on this device"}
        {reason === "maps-error" && "Google Maps could not be loaded"}
        {reason === "raster-map-id" && "That Map ID is not a vector map"}
      </h2>
      {reason === "no-credentials" && (
        <>
          <p>
            You are seeing the schematic fallback view. Everything except the tilted basemap works: layers, the
            timeline, the flood model, project selection and the details panel all run from the same data files.
          </p>
          <ol>
            <li>
              Create an API key in the Google Cloud console and enable <strong>Maps JavaScript API</strong> (billing
              must be enabled on the project).
            </li>
            <li>
              Create a <strong>Map ID</strong> with map type <strong>JavaScript</strong> and rendering type{" "}
              <strong>Vector</strong>, with <em>Tilt</em> and <em>Rotation</em> enabled. A raster Map ID cannot show
              3D or run WebGLOverlayView.
            </li>
            <li>
              Copy <code>.env.example</code> to <code>.env.local</code> and set{" "}
              <code>VITE_GOOGLE_MAPS_API_KEY</code> and <code>VITE_GOOGLE_MAPS_MAP_ID</code>, then restart the dev
              server.
            </li>
          </ol>
        </>
      )}
      {reason === "no-webgl" && (
        <p>
          This browser or device reports no usable WebGL context, so the tilted 3D map and the three.js overlay cannot
          run. The schematic view below is drawn in plain SVG from the same data.
        </p>
      )}
      {reason === "raster-map-id" && (
        <>
          <p>
            {detail ?? "This Map ID renders raster tiles."} You are seeing the local 3D scene instead, which needs no
            credentials.
          </p>
          <ol>
            <li>
              <strong>Google Maps Platform → Map management → Create map ID.</strong>
            </li>
            <li>
              Map type <strong>JavaScript</strong>, rendering type <strong>Vector</strong>, with <em>Tilt</em> and{" "}
              <em>Rotation</em> enabled.
            </li>
            <li>
              Put it in <code>VITE_GOOGLE_MAPS_MAP_ID</code> and restart the dev server. Google&rsquo;s sample{" "}
              <code>DEMO_MAP_ID</code> will not work here &mdash; it is raster.
            </li>
          </ol>
        </>
      )}
      {reason === "maps-error" && (
        <>
          <p>
            {detail ?? "The Maps JavaScript API failed to load."} The view below keeps the app usable in the meantime.
          </p>
          {onRetry && (
            <button type="button" className="btn small" onClick={onRetry}>
              Try loading Google Maps again
            </button>
          )}
        </>
      )}
    </aside>
  );
}

export function DataNotice() {
  return (
    <section className="panel" aria-labelledby="data-heading">
      <h2 id="data-heading">What is real here, and what is not</h2>
      <ul className="notice-list">
        <li>
          <span className="tag tag-demo">demonstration</span> Every project marker is a placeholder. No budget,
          physical completion figure or flood-reduction claim is attached to any of them.
        </li>
        <li>
          <span className="tag tag-schematic">schematic</span> River centrelines, zone envelopes, model parameters,
          and the rainfall and tide series are hand-built approximations for the demonstration.
        </li>
        <li>
          <span className="tag tag-reported">reported</span> Dated statements, barangay counts, dam levels and
          programme descriptions come from the published sources listed below, each carrying its own date.
        </li>
        <li>
          <span className="tag tag-model">model</span> Water depths are output of an uncalibrated illustrative model.
          On the 3D map the water surface is exaggerated vertically &times;{DEPTH_EXAGGERATION} so it is visible at
          province scale.
        </li>
      </ul>
      <p className="panel-foot">
        Data files: <code>public/data/</code> &mdash; projects, waterways, flood zones, drivers timeline, camera tour
        and sources. Replace any of them without rebuilding.
      </p>
    </section>
  );
}

interface ModelPanelProps {
  run: ModelRun;
  correlation: CorrelationSummary;
  counterfactual: TideCounterfactual;
  checks: QualitativeCheck[];
  sourceById: Record<string, SourceRecord>;
}

export function ModelPanel({ run, correlation, counterfactual, checks, sourceById }: ModelPanelProps) {
  const fmt = (r: number) => (r >= 0 ? "+" : "") + r.toFixed(2);
  return (
    <section className="panel" aria-labelledby="model-heading">
      <div className="panel-head">
        <h2 id="model-heading">Rainfall &times; tide &rarr; flooding</h2>
        <span className="tag tag-model">{run.version}</span>
      </div>
      <p>
        The model treats each zone as a bucket. Rain fills it; the bay decides whether it can empty. When the modelled
        tide rises above a zone's outfall invert, gravity drainage shuts for part of the day and only pumping removes
        water &mdash; the mechanism behind the &ldquo;backflood at high tide&rdquo; pattern in the reporting.
      </p>

      <h3>Correlation with modelled depth</h3>
      <table className="corr-table">
        <thead>
          <tr>
            <th scope="col">Lag (days)</th>
            <th scope="col">Rainfall</th>
            <th scope="col">High tide</th>
          </tr>
        </thead>
        <tbody>
          {correlation.rainfallVsDepth.map((r, i) => (
            <tr key={r.lag}>
              <th scope="row">{r.lag}</th>
              <td>{fmt(r.r)}</td>
              <td>{fmt(correlation.tideVsDepth[i].r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">
        Strongest rainfall response at lag {correlation.bestRainfallLag} day(s). Note that the tide column is small and
        can even come out negative: that is the expected result, and it is the interesting one. A linear correlation
        looks for a driver that puts water on the ground, and the tide does not do that &mdash; it decides whether the
        day&rsquo;s rain can leave.
      </p>

      <h3>The tide&rsquo;s role, by counterfactual</h3>
      <p>
        So the model is re-run on the <em>same</em> rainfall with the bay pinned at the calmest tide of the month
        ({counterfactual.baselineTideM.toFixed(2)} m). Everything else is identical, so the difference is the tide.
      </p>
      <table className="corr-table">
        <thead>
          <tr>
            <th scope="col" />
            <th scope="col">Real tide</th>
            <th scope="col">Calm tide</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Zone-days flooded</th>
            <td>{counterfactual.floodedZoneDaysActual}</td>
            <td>{counterfactual.floodedZoneDaysCounterfactual}</td>
          </tr>
          <tr>
            <th scope="row">Mean depth</th>
            <td>{counterfactual.meanDepthActualM.toFixed(3)} m</td>
            <td>{counterfactual.meanDepthCounterfactualM.toFixed(3)} m</td>
          </tr>
          <tr>
            <th scope="row">Peak depth</th>
            <td>{counterfactual.peakDepthActualM.toFixed(2)} m</td>
            <td>{counterfactual.peakDepthCounterfactualM.toFixed(2)} m</td>
          </tr>
          <tr>
            <th scope="row">Outfall shut</th>
            <td>{counterfactual.meanGateClosedHoursActual.toFixed(1)} h/day</td>
            <td>{counterfactual.meanGateClosedHoursCounterfactual.toFixed(1)} h/day</td>
          </tr>
        </tbody>
      </table>
      <p className="muted">
        {counterfactual.extraZoneDaysFromTide > 0
          ? `${counterfactual.extraZoneDaysFromTide} extra zone-days of flooding in this month are attributable to the tide inside the model.`
          : "On this series the tide adds no extra zone-days of flooding in the model - the rainfall alone is enough to exceed the threshold on those days."}
        {counterfactual.peakDepthActualM === counterfactual.peakDepthCounterfactualM &&
          " The peak depth is unchanged because the month's deepest zone is a riverine one, upstream of tidal gating: the tide moves the coastal zones, not that peak."}
      </p>
      <p className="caveat">{counterfactual.method}</p>
      <p className="caveat">{correlation.caveat}</p>

      <h3>Comparison against reported counts</h3>
      <table className="corr-table">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Reported flooded barangays</th>
            <th scope="col">Modelled zones flooded</th>
            <th scope="col">Source</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((c) => {
            const src = sourceById[c.source];
            return (
              <tr key={c.date}>
                <th scope="row">{c.date}</th>
                <td>{c.reportedFloodedBarangays}</td>
                <td>
                  {c.modelledZonesFloodedFraction === null
                    ? "n/a"
                    : `${Math.round(c.modelledZonesFloodedFraction * 100)}%`}
                </td>
                <td>
                  {src ? (
                    <a href={src.url} target="_blank" rel="noreferrer noopener">
                      {src.publisher}
                    </a>
                  ) : (
                    c.source
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="caveat">
        Three published counts cannot validate anything. This table is shown so the thinness of the comparison is
        visible rather than hidden: the columns are not even the same unit &mdash; barangays flooded versus the share
        of eight coarse demonstration zones above a 15 cm threshold.
      </p>
    </section>
  );
}

export function SourcesPanel({ sources }: { sources: SourceRecord[] }) {
  return (
    <section className="panel" aria-labelledby="sources-heading">
      <h2 id="sources-heading">Sources</h2>
      <ul className="sources-list">
        {sources.map((s) => (
          <li key={s.id}>
            <a href={s.url} target="_blank" rel="noreferrer noopener">
              {s.title}
            </a>
            <span className="src-meta">
              {s.publisher} &middot; {s.date} &middot; {s.type}
            </span>
            {s.note && <span className="src-note">{s.note}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
