/**
 * Service worker for the credential-free path.
 *
 * The whole point of this app's fallback story is that it needs nothing from
 * the network to be useful: no API key, no Map ID, no server. This worker
 * extends that to "no network at all, after the first visit" - install it
 * once online and the schematic map, the 3D scene, the flood model and every
 * dataset and structure model keep working offline.
 *
 * Two strategies, chosen by what changes and how often:
 *
 *  - App shell (the HTML entry) and hashed build assets (Vite fingerprints
 *    every JS/CSS filename, so a stale cached copy is never served under a
 *    live filename) use network-first: try the network so a redeploy is seen
 *    immediately, fall back to whatever is cached when there is no network.
 *  - Data files and structure models have stable, hand-authored filenames
 *    (they are meant to be replaced in place per the README), so they use
 *    stale-while-revalidate: answer instantly from cache, and refresh the
 *    cache in the background for next time.
 *
 * Explicitly out of scope: anything cross-origin. That is what keeps the
 * Google Maps script - and the API key on its query string - out of this
 * worker entirely; see the origin check in `fetch` below.
 */

const CACHE_VERSION = "v1";
const CACHE_NAME = `bulacan-flood-${CACHE_VERSION}`;

// Stable-named assets worth having before the network is asked for anything.
// Keep this in sync with public/data/ and public/models/ - it is a plain list
// because a service worker cannot import the TypeScript that names them
// elsewhere (src/lib/dataLoader.ts, public/data/projects.geojson).
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./data/sources.json",
  "./data/projects.geojson",
  "./data/waterways.geojson",
  "./data/flood-zones.geojson",
  "./data/flood-drivers-timeline.json",
  "./data/camera-tour.json",
  "./models/pump-station.glb",
  "./models/flood-gate.glb",
  "./models/drainage-channel.glb",
  "./models/flood-barrier.glb",
  "./models/sabo-dam.glb",
  "./models/detention-basin.glb",
  "./models/dredging-works.glb",
  "./models/airport-works.glb",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        // Best-effort: one missing file (a model not yet generated, say)
        // must not stop every other asset from being cached.
        Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url))),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

/** public/data/*.json|geojson and public/models/*.glb: stable names, revalidated in the background. */
function isStableAsset(url) {
  return /\/(data|models)\//.test(url.pathname);
}

async function networkFirst(request) {
  // Every route in this single-page app renders the same document, and a
  // shared deep link carries state in its query string (?d=...&p=...), not in
  // a distinct path. Cache and look up navigations by path alone, or an
  // offline reload of any shared link but the exact one last cached would
  // miss for no reason.
  const isNavigation = request.mode === "navigate";
  const cacheKey = isNavigation ? new URL(request.url).origin + new URL(request.url).pathname : request;

  try {
    const fresh = await fetch(request);
    if (fresh.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(cacheKey, fresh.clone());
    }
    return fresh;
  } catch {
    const cached = await caches.match(cacheKey, { ignoreSearch: isNavigation });
    if (cached) return cached;
    throw new Error("offline and nothing cached for " + request.url);
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((fresh) => {
      if (fresh.ok) cache.put(request, fresh.clone());
      return fresh;
    })
    .catch(() => undefined);
  return cached ?? (await network) ?? Response.error();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch Maps or any other third party

  event.respondWith(isStableAsset(url) ? staleWhileRevalidate(request) : networkFirst(request));
});
