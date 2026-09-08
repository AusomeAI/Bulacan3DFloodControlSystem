import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { shouldRegisterServiceWorker } from "./lib/serviceWorker";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (
  shouldRegisterServiceWorker({
    hasServiceWorkerApi: "serviceWorker" in navigator,
    isProd: import.meta.env.PROD,
    hasEmbeddedData: Boolean(window.__BULACAN_DATA__),
    protocol: window.location.protocol,
  })
) {
  // Register after load so the worker's own install/fetch never competes
  // with the page's first paint for bandwidth or the main thread.
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // Offline support is a bonus on top of the app, never a requirement -
      // an unsupported browser or a blocked worker scope must not interrupt it.
    });
  });
}
