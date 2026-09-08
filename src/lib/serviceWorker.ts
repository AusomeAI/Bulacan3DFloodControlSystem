export interface ServiceWorkerEnv {
  hasServiceWorkerApi: boolean;
  isProd: boolean;
  /** True inside the single-file artifact build, where data rides on window.__BULACAN_DATA__. */
  hasEmbeddedData: boolean;
  protocol: string;
}

/**
 * Decides whether this load should register `public/sw.js`.
 *
 * Kept pure and separate from the actual `navigator.serviceWorker.register`
 * call so the decision is unit-testable without a browser:
 *
 *  - dev builds skip it - HMR and a cache-first/stale-while-revalidate worker
 *    fight each other, turning "edit and save" into "edit, save, then wonder
 *    why nothing changed";
 *  - the single-file artifact build skips it - there is no `sw.js` sitting
 *    next to it to fetch, everything is inlined into one HTML document;
 *  - `file://` or any other non-http(s) context skips it - the Service
 *    Worker API requires a real origin and throws on anything else.
 */
export function shouldRegisterServiceWorker(env: ServiceWorkerEnv): boolean {
  return (
    env.hasServiceWorkerApi &&
    env.isProd &&
    !env.hasEmbeddedData &&
    (env.protocol === "http:" || env.protocol === "https:")
  );
}
