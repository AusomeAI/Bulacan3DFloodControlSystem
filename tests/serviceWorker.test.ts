import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { shouldRegisterServiceWorker } from "../src/lib/serviceWorker";

const BASE = { hasServiceWorkerApi: true, isProd: true, hasEmbeddedData: false, protocol: "https:" };

describe("shouldRegisterServiceWorker", () => {
  it("registers under the normal production conditions", () => {
    expect(shouldRegisterServiceWorker(BASE)).toBe(true);
    expect(shouldRegisterServiceWorker({ ...BASE, protocol: "http:" })).toBe(true);
  });

  it("skips when the browser has no Service Worker API", () => {
    expect(shouldRegisterServiceWorker({ ...BASE, hasServiceWorkerApi: false })).toBe(false);
  });

  it("skips in development, where it would fight Vite's HMR", () => {
    expect(shouldRegisterServiceWorker({ ...BASE, isProd: false })).toBe(false);
  });

  it("skips the single-file artifact build, which has no sw.js beside it", () => {
    expect(shouldRegisterServiceWorker({ ...BASE, hasEmbeddedData: true })).toBe(false);
  });

  it("skips a non-http(s) context such as file://", () => {
    expect(shouldRegisterServiceWorker({ ...BASE, protocol: "file:" })).toBe(false);
  });
});

describe("public/sw.js", () => {
  const source = readFileSync("public/sw.js", "utf8");

  it("never touches a cross-origin request", () => {
    // This is what keeps the Google Maps script - and the API key on its
    // query string - out of the cache entirely.
    expect(source).toMatch(/url\.origin\s*!==\s*self\.location\.origin/);
  });

  it("only intercepts GET requests", () => {
    expect(source).toMatch(/request\.method\s*!==\s*["']GET["']/);
  });

  it("precaches every dataset and structure model the app ships", () => {
    const dataFiles = JSON.parse(readFileSync("public/data/projects.geojson", "utf8"))
      ? [
          "sources.json",
          "projects.geojson",
          "waterways.geojson",
          "flood-zones.geojson",
          "flood-drivers-timeline.json",
          "camera-tour.json",
        ]
      : [];
    for (const f of dataFiles) expect(source).toContain(`./data/${f}`);

    const projects = JSON.parse(readFileSync("public/data/projects.geojson", "utf8"));
    const models = new Set<string>(
      projects.features.map((f: { properties: { modelUrl?: string } }) => f.properties.modelUrl).filter(Boolean),
    );
    expect(models.size).toBeGreaterThan(0);
    for (const url of models) expect(source).toContain(`./${url}`);
  });
});
