import { useEffect, useState } from "react";

type LoadState = "idle" | "loading" | "ready" | "error";

let loaderPromise: Promise<void> | null = null;

/**
 * Loads the Google Maps JavaScript API once per page. A vector map (required
 * for tilt, heading and WebGLOverlayView) needs BOTH an API key and a Map ID
 * whose map type is "Vector" with tilt and rotation enabled - see README.
 */
/**
 * Resolves once `google.maps.Map` is actually constructible.
 *
 * The `loading=async` bootstrap defines `google.maps` immediately but fills the
 * classes in afterwards, so a script `onload` is not a promise that `new
 * google.maps.Map(...)` will work. Prefer the documented `importLibrary` call
 * and fall back to polling, because which of the two is available depends on
 * the bootstrap version Google serves.
 */
function whenMapsReady(timeoutMs = 12000): Promise<void> {
  const maps = window.google?.maps as
    | (typeof google.maps & { importLibrary?: (name: string) => Promise<unknown> })
    | undefined;
  if (!maps) return Promise.reject(new Error("The Maps script loaded but did not initialise the API."));

  const ready = () => typeof window.google?.maps?.Map === "function";
  if (ready()) return Promise.resolve();

  const viaImport =
    typeof maps.importLibrary === "function"
      ? Promise.all([maps.importLibrary("maps"), maps.importLibrary("marker")]).then(() => undefined)
      : null;

  const viaPolling = new Promise<void>((resolve, reject) => {
    const started = Date.now();
    const tick = window.setInterval(() => {
      if (ready()) {
        window.clearInterval(tick);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        window.clearInterval(tick);
        reject(new Error("The Maps API loaded but google.maps.Map never became available."));
      }
    }, 50);
  });

  // Whichever proves the API usable first wins.
  return viaImport ? Promise.race([viaImport.then(() => undefined), viaPolling]) : viaPolling;
}

export function loadGoogleMaps(apiKey: string): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("No window"));
  if (typeof window.google?.maps?.Map === "function") return Promise.resolve();
  if (window.google?.maps) return whenMapsReady();
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise<void>((resolve, reject) => {
    // A failure must not be cached: a transient network error would otherwise
    // disable the map for the life of the page even once the network recovers.
    const fail = (message: string) => {
      loaderPromise = null;
      // The API can still have finished loading while the tag reported an error.
      if (typeof window.google?.maps?.Map === "function") resolve();
      else reject(new Error(message));
    };

    const params = new URLSearchParams({
      key: apiKey,
      v: "weekly",
      libraries: "maps,marker",
      loading: "async",
    });
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      whenMapsReady()
        .then(resolve)
        .catch((e: Error) => fail(e.message));
    };
    script.onerror = () =>
      fail(
        "Google Maps JavaScript API failed to load. Check the API key, its HTTP referrer restrictions, and that billing is enabled on the project.",
      );
    document.head.appendChild(script);
  });

  return loaderPromise;
}

export function useGoogleMapsApi(apiKey: string, enabled: boolean) {
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled || !apiKey) return;
    let cancelled = false;
    setState("loading");
    setError(null);
    loadGoogleMaps(apiKey)
      .then(() => {
        if (!cancelled) setState("ready");
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [apiKey, enabled, attempt]);

  return { state, error, retry: () => setAttempt((n) => n + 1) };
}
