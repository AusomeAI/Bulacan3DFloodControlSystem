/**
 * Bundles the app into one standalone HTML file.
 *
 * Reads the single-file vite output plus every dataset in public/data, and
 * emits a page with no external requests: no module URLs, no stylesheet link,
 * no data fetches. The result runs from a file:// URL, a static host, or any
 * sandbox that blocks network access.
 *
 * The Google Maps path is inert in this build - there are no credentials and
 * the sandbox blocks the Maps script - so the page opens in its schematic
 * fallback view, which is the whole app minus the tilted basemap.
 *
 *   node scripts/build-artifact.mjs [outfile]
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const root = process.cwd();
const dist = join(root, "dist-artifact");
const dataDir = join(root, "public", "data");
const out = process.argv[2] ?? join(dist, "bulacan-flood-demo.html");

/** Safe to inline inside a <script> block: only the closing tag can break out. */
const guard = (text) => text.replace(/<\/script/gi, "<\\/script");

const DATASETS = {
  sources: "sources.json",
  projects: "projects.geojson",
  waterways: "waterways.geojson",
  zones: "flood-zones.geojson",
  drivers: "flood-drivers-timeline.json",
  tour: "camera-tour.json",
};

const known = new Set(Object.values(DATASETS));
const unused = readdirSync(dataDir).filter((f) => /\.(json|geojson)$/.test(f) && !known.has(f));
if (unused.length) {
  console.warn(`warning: not embedding ${unused.join(", ")} - add it to DATASETS if the app needs it`);
}

const data = Object.fromEntries(
  Object.entries(DATASETS).map(([key, file]) => [key, JSON.parse(readFileSync(join(dataDir, file), "utf8"))]),
);

// Structure models are separate files the page cannot fetch once it is a single
// document, so inline each referenced GLB as a data URI and rewrite the feature.
const modelCache = new Map();
let inlinedModelBytes = 0;
for (const feature of data.projects?.features ?? []) {
  const url = feature.properties?.modelUrl;
  if (!url || url.startsWith("data:")) continue;
  if (!modelCache.has(url)) {
    const buf = readFileSync(join(root, "public", url));
    if (buf.subarray(0, 4).toString("ascii") !== "glTF") {
      throw new Error(`${url} is not a GLB file`);
    }
    modelCache.set(url, `data:model/gltf-binary;base64,${buf.toString("base64")}`);
    inlinedModelBytes += buf.length;
  }
  feature.properties.modelUrl = modelCache.get(url);
}
if (modelCache.size) {
  console.log(`  inlined ${modelCache.size} models, ${(inlinedModelBytes / 1024).toFixed(0)} kB`);
}

const js = readFileSync(join(dist, "app.js"), "utf8");
const css = readFileSync(join(dist, "app.css"), "utf8");

// Vite compiles VITE_ variables into the bundle, so a local .env.local would
// otherwise ride along into a page that gets shared. Refuse to build one.
const CREDENTIAL_PATTERNS = [
  [/AIza[0-9A-Za-z_-]{30,}/, "a Google API key"],
  [/VITE_GOOGLE_MAPS_MAP_ID"?\s*[:=]\s*"[^"]+"/, "a Google Map ID"],
];
for (const [pattern, what] of CREDENTIAL_PATTERNS) {
  if (pattern.test(js)) {
    throw new Error(
      `Refusing to build a shareable page containing ${what}. ` +
        "Build this target with the VITE_GOOGLE_MAPS_* variables cleared " +
        "(npm run build:single does this) and try again.",
    );
  }
}

// The artifact host supplies <!doctype>, <html>, <head> and <body>, so emit the
// page contents only.
const html = `<title>Bulacan Flood Control</title>
<style>
${css}
/* The host page supplies the body; make sure the app still owns the viewport. */
html, body { height: 100%; }
</style>
<div id="root"></div>
<script>window.__BULACAN_DATA__ = ${guard(JSON.stringify(data))};</script>
<script type="module">
${guard(js)}
</script>
`;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`${out}  ${(Buffer.byteLength(html) / 1024).toFixed(0)} kB`);
