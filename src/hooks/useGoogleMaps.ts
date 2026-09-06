import { useEffect, useState } from "react";

type LoadState = "idle" | "loading" | "ready" | "error";

let loaderPromise: Promise<void> | null = null;

/**
 * Loads the Google Maps JavaScript API once per page. A vector map (required
 * for tilt, heading and WebGLOverlayView) needs BOTH an API key and a Map ID
 * whose map type is "Vector" with tilt and rotation enabled - see README.
 */
export function loadGoogleMaps(apiKey: string): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("No window"));
  if (window.google?.maps) return Promise.resolve();
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise<void>((resolve, reject) => {
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
    script.onload = () => resolve();
    script.onerror = () =>
      reject(
        new Error(
          "Google Maps JavaScript API failed to load. Check the API key, its HTTP referrer restrictions, and that billing is enabled on the project.",
        ),
      );
    document.head.appendChild(script);
  });

  return loaderPromise;
}

export function useGoogleMapsApi(apiKey: string, enabled: boolean) {
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !apiKey) return;
    let cancelled = false;
    setState("loading");
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
  }, [apiKey, enabled]);

  return { state, error };
}
