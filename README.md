# Bulacan 3D Flood Control System

An interactive 3D web application for presenting flood-control infrastructure and
rainfall–tide flood dynamics across the river systems of Bulacan, Philippines:
the Angat, Malolos, Guiguinto, Bulacan (Bulakan) and Santa Maria rivers, the
interconnected lowland channels that drain to Manila Bay, and the coast beside
the New Manila International Airport (NMIA) site at Taliptip.

Built with **React + TypeScript + Vite**, the **Google Maps JavaScript API**
(vector map, tilted) and **three.js** rendered through
**`WebGLOverlayView`** via `@googlemaps/three`.

> **Read this before showing it to anyone.**
> Every project marker, every flood scenario and every model parameter in this
> repository is **demonstration data**. No budget, physical-completion figure or
> flood-reduction claim is asserted for any structure. Real-world figures appear
> only where a `source` and a `sourceDate` point at a published document, and
> they describe the surrounding programme — never the demonstration features.

---

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
```

It runs with **no credentials**. Without an API key the app shows a schematic
SVG fallback drawn from the same GeoJSON, and every other feature — layers,
timeline, flood model, project selection, details panel, sources — works
normally.

```bash
npm run build    # typecheck + production build into dist/
npm run preview  # serve the build
npm run build:single  # one standalone HTML file with the data embedded
npm test         # 59 unit tests: model, counterfactual, day records, scene,
                 # viewport pan/zoom, and data integrity
npm run lint     # typecheck only
```

---

## Google Maps API key and Map ID setup

The 3D view needs **two** things. An API key alone is not enough.

### 1. API key

1. Open the [Google Cloud console](https://console.cloud.google.com/) and select
   or create a project.
2. Enable **billing** on the project — the Maps JavaScript API will not serve
   tiles without it.
3. **APIs & Services → Library → Maps JavaScript API → Enable.**
4. **APIs & Services → Credentials → Create credentials → API key.**
5. Restrict the key before deploying anywhere public: *Application
   restrictions → Websites*, listing your origins (`http://localhost:5173/*`
   for development); *API restrictions → Maps JavaScript API*.

### 2. Map ID (must be **Vector**)

`WebGLOverlayView` — and therefore every three.js structure, water surface and
flow ribbon in this app — only runs on a **vector** map. A raster Map ID will
load a flat map and silently render nothing in 3D.

1. **Google Maps Platform → Map management → Create map ID.**
2. Map type: **JavaScript**. Rendering type: **Vector**.
3. Turn **Tilt** and **Rotation** on.
4. Copy the map ID string.

### 3. Wire them up

```bash
cp .env.example .env.local
```

```dotenv
VITE_GOOGLE_MAPS_API_KEY=AIza...
VITE_GOOGLE_MAPS_MAP_ID=abc123def456
```

Restart the dev server. The setup banner disappears and the tilted 3D map,
camera tour and GLB import become available.

`.env.local` is git-ignored. Note that a Vite `VITE_`-prefixed variable is
compiled into the client bundle — that is unavoidable for a browser Maps key,
which is why the referrer restriction in step 5 above matters.

---

## What you can do in the app

| Feature | Notes |
| --- | --- |
| **Tilted 3D map** | Vector basemap at ~55–68° tilt with heading, driven by the camera tour or by dragging. |
| **Animated camera tour** | Seven stops from the Angat headwaters down to the NMIA coast, with play/stop and per-stop jumps. Eased 2.2 s flights; instant jumps under reduced motion. |
| **Zoom and pan** | Both views carry the same control cluster: zoom in, zoom out, a level readout and a reset. On the 3D map they drive the Maps camera (clamped to z8–z19). On the schematic they drive the SVG viewBox — plus wheel-zoom toward the pointer, drag to pan, and arrow keys / `+` / `-` / `0` when it has focus. Labels, markers and stroke widths are counter-scaled so they stay the same size on screen at every magnification. |
| **Clickable projects** | three.js structures are raycast-picked on the 3D map; SVG markers are clickable and keyboard-focusable in the fallback. |
| **Project details panel** | Record fields, the real programme context with a dated source link, the modelled state of the containing zone, and GLB import. |
| **Layer controls** | Waterways, pumping stations & flood gates, drainage channels, flood barriers, river works, NMIA-vicinity works, flood-zone envelopes, modelled water surface. |
| **Water-flow animation** | Custom GLSL chevrons travelling downstream along each channel; a rippling translucent water surface whose height and colour follow modelled depth. |
| **Simulated month** | The past month, 5 Aug – 6 Sep 2026, simulated day by day: rainfall, Manila Bay tide, Angat level, and per-zone flood depth from the model. |
| **Date navigation** | A calendar strip over the month — cell height is rainfall, the underline is modelled flood severity, a yellow dot marks a day carrying published reporting. Filter to rain days, flooding days or reported days; *Prev*/*Next* jump between matching days; arrow keys walk the strip; the timeline chart is itself a date picker. Selecting a day lists every flooded zone with its depth and how long its outfall was modelled shut, plus the day's quoted reports with sources. |
| **Timeline** | Play/pause and scrub across the same month, with a rainfall/tide/depth chart. |
| **Reduced motion** | `prefers-reduced-motion` disables flow animation, ripples and camera flights; the timeline still steps, instantly. |
| **Fallback** | No API key, no Map ID, no WebGL, or a Maps load failure → the SVG schematic, plus setup instructions. |
| **Responsive** | Two-column desktop layout collapses to a single column with a panel toggle below 900 px. |

---

### Sharing a runnable copy

`npm run build:single` emits `dist-artifact/bulacan-flood-demo.html`: the whole
app in one file with every dataset inlined on `window.__BULACAN_DATA__`, so it
opens from a `file://` URL or any static host with no server and no network
access. The Google Maps path stays inert there — no credentials — so it opens in
the schematic view. Use it to hand someone a working copy; use a real key and
`npm run dev` to exercise the 3D map.

---

## Data: everything is a replaceable file

All datasets are fetched at runtime from `public/data/`, so you can replace them
without rebuilding. Point `VITE_DATA_BASE` at another origin to load them from a
CMS or an open-data mirror instead.

| File | Contents | Class |
| --- | --- | --- |
| `projects.geojson` | 16 demonstration project points across five categories | demonstration |
| `waterways.geojson` | 10 river / tidal-channel centrelines | schematic |
| `flood-zones.geojson` | 8 zone envelopes with the model parameters | demonstration |
| `flood-drivers-timeline.json` | daily rainfall, tide, Angat level + 11 cited observations | mixed |
| `camera-tour.json` | tour waypoints and the default camera | demonstration |
| `sources.json` | the bibliography every `source` id resolves against | reported |

Each file carries a `metadata.notice` stating exactly what it is. Each feature
carries `dataClass`, `source` and `sourceDate`. `npm test` enforces this:
projects must be flagged as demonstrations, every `source` must resolve, every
`sourceDate` must be an ISO date, and no project property may look like a budget
or completion field.

### Replacing the demonstration projects with real DPWH records

`projects.geojson` is shaped to take real per-contract data. The public
transparency mirror of the DPWH dataset
(<https://transparency.bettergov.ph/dpwh/projects>) exposes project ID,
description, location, contractor, cost and status per contract. Map those onto
the feature properties, set `demonstration: false`, drop the `DEMO:` name
prefix, and point `source` at a new entry in `sources.json`. The tests that
assert everything is a demonstration will fail — that is the intended signal to
review the labelling copy in `DataNotice` before publishing real data.

### Importing GLB models

Two routes:

- **Declared** — drop a `.glb` in `public/models/` and set
  `"modelUrl": "models/pump-station.glb"` on the feature. It loads at start-up;
  a missing or broken file leaves the placeholder in place rather than breaking
  the map.
- **Ad hoc** — select a project and use *Import GLB for this project* in the
  details panel to preview a local file immediately.

Authoring conventions: metre units, Y-up (the glTF default — the scene rotates
models into the overlay's Z-up frame), origin at the ground-contact point, and
keep them light; they are drawn over a live basemap.

---

## The rainfall × tide flood model

`src/lib/floodModel.ts` — an **illustrative** daily bucket model, deliberately
simple and fully commented, whose purpose is to make one mechanism visible:

> Rain fills the lowlands. **Manila Bay decides whether that water can leave.**

Per zone, per day:

1. Antecedent wetness — `API_t = 0.85·API_{t-1} + P_t`, consuming depression storage.
2. Direct runoff — `Q_t = max(0, C·P_t − available storage)`.
3. Upstream inflow — a share of upland runoff routed with a one-day lag.
4. **Tidal gating** — approximating the tide as a sinusoid, the gravity outfall
   is shut for `acos(invert / tideMax)/π` of the day.
5. Outflow — `conveyance·(1 − closed) + pump capacity`. When the gate is shut,
   pumps are the only way out. That is what a pumping station buys.
6. Barrier ingress when modelled bay level exceeds the barrier crest.
7. Storage update, then a **ponding concentration** multiplier, because
   floodwater collects in the low-lying part of a zone rather than spreading
   evenly.

The app reports lagged Pearson correlations of rainfall and tide against
modelled depth. The tide column comes out small or negative, and that is the
honest and interesting result: tide is not a driver that puts water on the
ground, it is a *gate*.

Since a correlation cannot measure a gate, the panel answers the question with a
**counterfactual run** instead: the identical rainfall series is re-run with the
bay pinned at the calmest tide of the month, and the two runs are differenced.
Same rain, same catchments, same structures — only the tide changes. On the
shipped series that is +5 zone-days of flooding, mean depth 0.214 m against
0.201 m, and outfalls shut 3.7 h/day against 2.4 h/day. The month's *peak* depth
is unchanged, because the deepest zone is riverine Calumpit, upstream of tidal
gating — the tide moves the coastal zones, not that peak.

(An earlier version of this panel split wet days by tide height instead. That
statistic flipped sign when the series was extended by a single day, which is
exactly what a confounded comparison does — the counterfactual replaced it.)

**Limits, stated plainly.** The model is not calibrated, not validated and not a
forecast. Its parameters are illustrative judgements, not surveyed elevations or
design capacities. The rainfall and tide series are schematic reconstructions
generated by `scripts/gen-timeline.mjs`, not gauge measurements or official tide
predictions. The comparison against published flooded-barangay counts is shown
in the app precisely so its thinness is visible: three data points, in different
units from the model output, cannot validate anything.

To do real work with it: feed PAGASA daily rainfall, NAMRIA/PAGASA Manila Bay
tide tables, NWRB Angat reservoir bulletins, NAMRIA elevation and DPWH/JICA
catchment parameters, then calibrate against observed inundation.

---

## Research behind the real-world content

Compiled 6 September 2026 from public reporting and government statements. Full
records with URLs are in `public/data/sources.json` and are listed in the app.

**The August 2026 flooding.** The enhanced southwest monsoon, reinforced by
tropical cyclones Luis and Maymay, flooded Bulacan through most of August 2026.
Water reached about 6 feet on 9 August, with 11,535 residents from 3,477
families evacuated across all 24 towns and cities by 10 August (*Inquirer*).
Angat Dam rose to 170.74 m on 10 August, up 8.66 m in a day (*Manila Bulletin*).
149 barangays were still flooded at noon on 12 August — Malolos 32, Calumpit 28,
Hagonoy 25, San Miguel 16, Paombong 14 — attributed to Manila Bay high tide plus
downpours (*Philippine Star*). 116 remained flooded on 17 August; the province
declared a state of calamity on 21 August; 71 villages were flooded again on 30
August, deepest at Barangays Meysulao and Gugo in Calumpit. Reporting
consistently names the same combination: monsoon rain, high tide, dam discharge,
and floodwater arriving from Pampanga and Nueva Ecija — which is exactly the
structure the model reproduces.

**The infrastructure programme.** DPWH has publicly described 19 pumping
stations and flood gates planned across Malolos City, Hagonoy, Calumpit,
Paombong, Bulakan and Guiguinto, the first 10 funded at ₱250–300 million each,
with the largest station at Barangay Sto. Rosario, Hagonoy (*BusinessWorld*).
Proposed "green" measures include sabo dams, catchment and detention basins,
revetments and dredging on the Pampanga and Angat rivers (*Philippine Star*).
The provincial government names the Angat, Pamarawan, Malolos, Hagonoy and
Guiguinto rivers as heavily silted and in need of dredging.

**The audit context, which the app does not paper over.** Roughly 200 flood
control projects in Bulacan were reported stalled amid the DPWH flood control
investigation. COA flagged ₱279 million of Bulacan projects as ghost or
relocated; Senate proceedings flagged alleged ghost projects in Calumpit and
Hagonoy tied to a top contractor; DPWH inspections described dikes in Paombong's
Barangays Masukol and Sta. Cruz as improperly designed inland dikes facing the
open sea. Reported funding allocations include Malolos City ₱3.04 billion across
45 projects, Hagonoy ₱3.05 billion across 43, and Calumpit ₱2.18 billion across
37 (*Rappler* analysis of DPWH data). These figures are carried as **programme
context with sources**, never attached to a demonstration marker.

**NMIA.** Online claims linked the New Manila International Airport project to
the August 2026 flooding. San Miguel Aerocity rejects them, saying flooding is a
long-standing provincial problem, and cites integrated flood measures: an
elevated airfield and terminal, enhanced drainage, river channel improvements
and water management works extending beyond the airport footprint, with 4.3
million metric tons of debris and silt reported cleared across Bulacan's river
systems as of 18 August 2026 (a company figure, not independently audited).
**This prototype takes no position on causation.** It presents the claim and the
response, each with a source and a date, and labels the airport-vicinity
features as demonstration placeholders like every other feature.

---

## Project structure

```
public/data/          replaceable JSON + GeoJSON, fetched at runtime
public/models/        drop GLB files here
scripts/              gen-timeline.mjs — regenerates the schematic driver series
src/lib/              flood model, correlation, day records, viewport pan/zoom,
                      data loading, geometry, palette
src/three/            FloodScene (ribbons, structures, water surface), GLB loader
src/components/       MapView (Maps + WebGLOverlayView), SchematicMap fallback,
                      layer / date-navigator / timeline / tour / details panels
src/hooks/            Maps loader, reduced motion, WebGL detection, media queries
tests/                model, counterfactual, day-record, viewport, scene and
                      data-integrity tests
```

`MapView` and three.js are lazy-loaded, so the credential-free fallback ships
about 178 kB of JavaScript instead of 780 kB.

## Accessibility

Semantic landmarks and headings, labelled form controls, keyboard-operable
markers and tour stops, a keyboard-navigable schematic map (arrow keys pan,
`+`/`-` zoom, `0` resets), visible focus rings, `aria-pressed` on the play and
tour toggles, `<title>` tooltips on every SVG shape, and a full
`prefers-reduced-motion` path covering CSS animation, the flow shaders, the
water ripple and the camera flights.

## Licence and use

Demonstration software. Do not use its outputs for planning, procurement,
emergency response or public communication. Verify every real-world figure
against the linked primary source before repeating it.
