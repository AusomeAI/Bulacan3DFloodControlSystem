import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Scene, ShaderMaterial, Vector3, type Mesh } from "three";
import { FloodScene } from "../src/three/floodScene";
import type { FeatureCollection, FloodZoneFeature, ProjectFeature, WaterwayFeature } from "../src/types";

const read = <T>(f: string): T => JSON.parse(readFileSync(`public/data/${f}`, "utf8")) as T;
const projects = read<FeatureCollection<ProjectFeature>>("projects.geojson");
const waterways = read<FeatureCollection<WaterwayFeature>>("waterways.geojson");
const zones = read<FeatureCollection<FloodZoneFeature>>("flood-zones.geojson");

/**
 * Stands in for ThreeJSOverlayView. The scene builder never touches WebGL - it
 * only builds geometry in the overlay's local metric frame - so a plain
 * equirectangular projection about the map anchor is enough to exercise it
 * headlessly.
 */
function stubOverlay() {
  const anchor = { lat: 14.845, lng: 120.86 };
  const M_PER_DEG = 111320;
  return {
    scene: new Scene(),
    latLngAltitudeToVector3: (p: { lat: number; lng: number; altitude?: number }) =>
      new Vector3(
        (p.lng - anchor.lng) * M_PER_DEG * Math.cos((anchor.lat * Math.PI) / 180),
        (p.lat - anchor.lat) * M_PER_DEG,
        p.altitude ?? 0,
      ),
  };
}

function build() {
  const overlay = stubOverlay();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scene = new FloodScene(overlay as any);
  scene.addWaterways(waterways.features);
  scene.addZones(zones.features);
  scene.addProjects(projects.features);
  return { overlay, scene };
}

describe("FloodScene", () => {
  it("creates a group per layer", () => {
    const { overlay } = build();
    const names = overlay.scene.children.map((c) => c.name);
    for (const id of [
      "waterways",
      "pumping-station",
      "drainage-channel",
      "flood-barrier",
      "river-works",
      "airport-vicinity",
      "flood-zones",
      "water-surface",
    ]) {
      expect(names).toContain(id);
    }
  });

  it("builds a watertight ribbon per waterway with downstream UVs", () => {
    const { overlay } = build();
    const group = overlay.scene.getObjectByName("waterways")!;
    expect(group.children).toHaveLength(waterways.features.length);
    for (const child of group.children) {
      const geom = (child as Mesh).geometry;
      const pos = geom.getAttribute("position");
      const uv = geom.getAttribute("uv");
      expect(pos.count).toBeGreaterThan(3);
      expect(uv.count).toBe(pos.count);
      // Two vertices per centreline point, and u runs 0 -> 1 downstream.
      expect(uv.getX(0)).toBeCloseTo(0, 6);
      expect(uv.getX(uv.count - 1)).toBeCloseTo(1, 6);
      expect(geom.getIndex()!.count % 3).toBe(0);
    }
  });

  it("places one pickable holder per project, positioned away from the anchor", () => {
    const { scene } = build();
    expect(scene.pickables).toHaveLength(projects.features.length);
    const ids = scene.pickables.map((p) => p.userData.id);
    expect(new Set(ids).size).toBe(projects.features.length);
    // Every structure sits somewhere real, not collapsed at the origin.
    expect(scene.pickables.every((p) => p.position.length() > 0)).toBe(true);
  });

  it("hides layers on request", () => {
    const { overlay, scene } = build();
    scene.setLayerVisible("flood-barrier", false);
    expect(overlay.scene.getObjectByName("flood-barrier")!.visible).toBe(false);
    scene.setLayerVisible("flood-barrier", true);
    expect(overlay.scene.getObjectByName("flood-barrier")!.visible).toBe(true);
  });

  it("raises, shows and colours the water surface with modelled depth", () => {
    const { overlay, scene } = build();
    const waterGroup = overlay.scene.getObjectByName("water-surface")!;
    const first = waterGroup.children[0].children[0] as Mesh;
    expect(first.visible).toBe(false);

    scene.setZoneDepths({ [zones.features[0].id]: 0.8 });
    expect(first.visible).toBe(true);
    expect(first.position.z).toBeGreaterThan(3);
    const opacity = (first.material as ShaderMaterial).uniforms.uOpacity.value;
    expect(opacity).toBeGreaterThan(0.14);

    scene.setZoneDepths({ [zones.features[0].id]: 0 });
    expect(first.visible).toBe(false);
  });

  it("swaps a placeholder for an imported GLB and keeps it pickable", () => {
    const { scene } = build();
    const target = projects.features[0].id;
    const imported = new Scene();
    expect(scene.replaceProjectModel(target, imported)).toBe(true);
    expect(scene.replaceProjectModel("does-not-exist", new Scene())).toBe(false);
    const holder = scene.pickables.find((p) => p.userData.id === target)!;
    expect(holder.children).toHaveLength(1);
    expect(holder.children[0].userData.id).toBe(target);
    // glTF is Y-up; the overlay frame is Z-up.
    expect(holder.children[0].rotation.x).toBeCloseTo(Math.PI / 2, 6);
  });

  it("advances shader time only while animation is enabled", () => {
    const { overlay, scene } = build();
    const mesh = overlay.scene.getObjectByName("waterways")!.children[0] as Mesh;
    const uniforms = (mesh.material as ShaderMaterial).uniforms;

    scene.setAnimated(false);
    scene.tick(0.5);
    expect(uniforms.uTime.value).toBe(0);

    scene.setAnimated(true);
    scene.tick(0.5);
    expect(uniforms.uTime.value).toBeCloseTo(0.5, 6);
  });

  it("tears everything down on dispose", () => {
    const { overlay, scene } = build();
    scene.dispose();
    expect(overlay.scene.children).toHaveLength(0);
    expect(scene.pickables).toHaveLength(0);
  });
});
