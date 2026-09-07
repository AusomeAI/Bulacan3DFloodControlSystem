import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  Scene,
  Shape,
  ShapeGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { DEPTH_EXAGGERATION } from "../lib/constants";
import type {
  FloodZoneFeature,
  LayerId,
  ProjectFeature,
  WaterwayFeature,
} from "../types";

export const CATEGORY_COLORS: Record<string, number> = {
  "pumping-station": 0x2fb5c8,
  "drainage-channel": 0x7bd389,
  "flood-barrier": 0xf2a03d,
  "river-works": 0xc98bdb,
  "airport-vicinity": 0xe86a6a,
};

export { DEPTH_EXAGGERATION } from "../lib/constants";

const flowVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const flowFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uSpeed;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;

  void main() {
    // Chevrons travelling along the channel: purely illustrative of direction
    // and relative activity, not a computed velocity field.
    float travel = fract(vUv.x * 14.0 - uTime * uSpeed);
    float pulse = smoothstep(0.0, 0.35, travel) * (1.0 - smoothstep(0.55, 0.95, travel));
    float edge = 1.0 - abs(vUv.y - 0.5) * 2.0;
    float a = uOpacity * (0.30 + 0.70 * pulse) * smoothstep(0.0, 0.45, edge);
    gl_FragColor = vec4(uColor + pulse * 0.22, a);
  }
`;

const waterVertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uRipple;
  varying vec2 vPos;
  void main() {
    vPos = position.xy;
    vec3 p = position;
    p.z += sin(position.x * 0.004 + uTime * 1.1) * uRipple
         + cos(position.y * 0.005 - uTime * 0.8) * uRipple;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const waterFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vPos;
  void main() {
    gl_FragColor = vec4(uColor, uOpacity);
  }
`;

/**
 * Everything FloodScene needs from its host: somewhere to put objects, and a
 * way to turn a coordinate into a position in the scene's metric frame.
 *
 * Google's ThreeJSOverlayView satisfies this, and so does the local projector
 * used by the credential-free 3D view, so one scene builder serves both.
 */
export interface SceneProjector {
  readonly scene: Scene;
  latLngAltitudeToVector3(
    position: { lat: number; lng: number; altitude?: number },
    target?: Vector3,
  ): Vector3;
}

export interface FloodSceneOptions {
  /** Multiplies placeholder structure geometry. Raise it where the camera sits far back. */
  structureScale?: number;
  /** When set, each structure also gets a map-pin mast of this height, in metres. */
  pinHeightMeters?: number;
  /** Vertical exaggeration applied to modelled water depth. */
  depthExaggeration?: number;
  /**
   * Widens the river ribbons. A 60 m river is well under a pixel across a
   * 60 km view, so the standalone 3D scene draws them wider than life and says
   * so, rather than drawing them faithfully and invisibly.
   */
  waterwayWidthScale?: number;
}

interface WaterwayEntry {
  mesh: Mesh;
  material: ShaderMaterial;
}

interface ZoneEntry {
  mesh: Mesh;
  material: ShaderMaterial;
  group: Group;
}

/**
 * Builds and owns every three.js object drawn through the WebGLOverlayView.
 * Geometry is expressed in the overlay's local metric frame (Z up) via
 * `overlay.latLngAltitudeToVector3`.
 */
export class FloodScene {
  private overlay: SceneProjector;
  private structureScale: number;
  private pinHeightMeters: number;
  private depthExaggeration: number;
  private waterwayWidthScale: number;
  private pinHeads = new Map<string, Mesh>();
  private selectedId: string | null = null;
  private layers = new Map<LayerId, Group>();
  private waterways: WaterwayEntry[] = [];
  private zones = new Map<string, ZoneEntry>();
  private projectMeshes: Object3D[] = [];
  private clock = 0;
  private animate = true;

  constructor(overlay: SceneProjector, options: FloodSceneOptions = {}) {
    this.overlay = overlay;
    this.structureScale = options.structureScale ?? 1;
    this.pinHeightMeters = options.pinHeightMeters ?? 0;
    this.depthExaggeration = options.depthExaggeration ?? DEPTH_EXAGGERATION;
    this.waterwayWidthScale = options.waterwayWidthScale ?? 1;
    const ids: LayerId[] = [
      "waterways",
      "pumping-station",
      "drainage-channel",
      "flood-barrier",
      "river-works",
      "airport-vicinity",
      "flood-zones",
      "water-surface",
    ];
    for (const id of ids) {
      const g = new Group();
      g.name = id;
      this.layers.set(id, g);
      overlay.scene.add(g);
    }
  }

  private project(lng: number, lat: number, altitude = 0): Vector3 {
    return this.overlay.latLngAltitudeToVector3({ lat, lng, altitude });
  }

  setAnimated(animate: boolean) {
    this.animate = animate;
  }

  /** Advances shader time. Called from onBeforeDraw. */
  tick(deltaSeconds: number) {
    if (!this.animate) return;
    this.clock += deltaSeconds;
    for (const w of this.waterways) w.material.uniforms.uTime.value = this.clock;
    for (const z of this.zones.values()) z.material.uniforms.uTime.value = this.clock;
  }

  setLayerVisible(id: LayerId, visible: boolean) {
    const g = this.layers.get(id);
    if (g) g.visible = visible;
  }

  // ---------------------------------------------------------------- waterways

  addWaterways(features: WaterwayFeature[]) {
    const group = this.layers.get("waterways")!;
    for (const feature of features) {
      const points = feature.geometry.coordinates.map(([lng, lat]) => this.project(lng, lat, 6));
      if (points.length < 2) continue;
      const geometry = this.buildRibbon(
        points,
        Math.max(30, feature.properties.widthMeters) * this.waterwayWidthScale,
      );
      const material = new ShaderMaterial({
        vertexShader: flowVertexShader,
        fragmentShader: flowFragmentShader,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        uniforms: {
          uTime: { value: 0 },
          uSpeed: { value: feature.properties.class === "tidal-channel" ? 0.25 : 0.6 },
          uColor: { value: colorVec(feature.properties.class === "tidal-channel" ? 0x3f7fbf : 0x2b6cb0) },
          uOpacity: { value: 0.85 },
        },
      });
      const mesh = new Mesh(geometry, material);
      mesh.userData = { kind: "waterway", id: feature.id, name: feature.properties.name };
      group.add(mesh);
      this.waterways.push({ mesh, material });
    }
  }

  /** Flat ribbon along a polyline, UV.x running 0..1 downstream. */
  private buildRibbon(points: Vector3[], widthMeters: number): BufferGeometry {
    const half = widthMeters / 2;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    const segLengths: number[] = [0];
    for (let i = 1; i < points.length; i++) {
      segLengths.push(segLengths[i - 1] + points[i].distanceTo(points[i - 1]));
    }
    const total = segLengths[segLengths.length - 1] || 1;

    for (let i = 0; i < points.length; i++) {
      const prev = points[Math.max(0, i - 1)];
      const next = points[Math.min(points.length - 1, i + 1)];
      const dir = new Vector3().subVectors(next, prev);
      dir.z = 0;
      if (dir.lengthSq() === 0) dir.set(1, 0, 0);
      dir.normalize();
      const normal = new Vector3(-dir.y, dir.x, 0).multiplyScalar(half);
      const p = points[i];
      positions.push(p.x + normal.x, p.y + normal.y, p.z);
      positions.push(p.x - normal.x, p.y - normal.y, p.z);
      const u = segLengths[i] / total;
      uvs.push(u, 1, u, 0);
      if (i < points.length - 1) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  // ----------------------------------------------------------------- projects

  addProjects(features: ProjectFeature[]) {
    for (const feature of features) {
      const group = this.layers.get(feature.properties.category as LayerId);
      if (!group) continue;
      const [lng, lat] = feature.geometry.coordinates;
      const origin = this.project(lng, lat, 0);
      const holder = new Group();
      holder.position.copy(origin);
      holder.userData = { kind: "project", id: feature.id };

      const placeholder = this.buildPlaceholder(feature);
      placeholder.userData = { kind: "project", id: feature.id };
      holder.add(placeholder);

      if (this.pinHeightMeters > 0) {
        for (const part of this.buildPin(feature)) {
          part.userData = { kind: "pin", id: feature.id };
          holder.add(part);
        }
      }

      const target = this.buildPickTarget();
      target.userData = { kind: "pick", id: feature.id };
      holder.add(target);

      group.add(holder);
      this.projectMeshes.push(holder);
    }
  }

  /**
   * A mast and head above the structure. At province scale a pump house is a
   * couple of pixels, so the pin - not the building - is what the eye and the
   * raycaster actually find.
   */
  private buildPin(feature: ProjectFeature): Object3D[] {
    const color = CATEGORY_COLORS[feature.properties.category] ?? 0x8899aa;
    const h = this.pinHeightMeters;
    const mast = new Mesh(
      new CylinderGeometry(h * 0.012, h * 0.012, h, 6),
      new MeshLambertMaterial({ color, transparent: true, opacity: 0.55 }),
    );
    mast.geometry.rotateX(Math.PI / 2);
    mast.position.z = h / 2;

    const head = new Mesh(
      new SphereGeometry(h * 0.085, 16, 12),
      new MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.35 }),
    );
    head.position.z = h;
    this.pinHeads.set(feature.id, head);
    return [mast, head];
  }

  /**
   * Invisible, generous click target.
   *
   * A pump house is a few metres across and a pin mast a few tens; seen from
   * 50 km back that is a sliver of a pixel, so aiming at the geometry itself is
   * hopeless. This sphere is never drawn but is raycast, giving the structure a
   * target you can actually hit - the equivalent of a marker's hit area.
   */
  private buildPickTarget(): Mesh {
    const radius = this.pinHeightMeters > 0 ? this.pinHeightMeters * 0.5 : 130 * this.structureScale;
    const mesh = new Mesh(new SphereGeometry(radius, 8, 6), new MeshBasicMaterial());
    mesh.visible = false;
    mesh.position.z = this.pinHeightMeters > 0 ? this.pinHeightMeters * 0.92 : radius * 0.6;
    return mesh;
  }

  private buildPlaceholder(feature: ProjectFeature): Object3D {
    const p = feature.properties;
    const color = CATEGORY_COLORS[p.category] ?? 0x8899aa;
    const material = new MeshLambertMaterial({ color, transparent: true, opacity: 0.92 });
    const scale = this.structureScale;
    const height = (p.heightMeters ?? 8) * 6 * scale; // exaggerated for province-scale legibility
    let geometry: BufferGeometry;
    if (p.category === "pumping-station") {
      const [w, d] = p.footprintMeters ?? [40, 30];
      geometry = new BoxGeometry(w * 3 * scale, d * 3 * scale, height);
    } else if (p.category === "flood-barrier") {
      geometry = new BoxGeometry(Math.min(1200, p.lengthMeters ?? 800) * scale, 60 * scale, height);
    } else if (p.category === "drainage-channel") {
      geometry = new BoxGeometry(300 * scale, 90 * scale, Math.max(60 * scale, height * 0.4));
    } else if (p.category === "river-works") {
      geometry = new CylinderGeometry(140 * scale, 190 * scale, height, 14);
      geometry.rotateX(Math.PI / 2);
    } else {
      geometry = new BoxGeometry(320 * scale, 320 * scale, height);
    }
    const mesh = new Mesh(geometry, material);
    mesh.position.z = height / 2;
    return mesh;
  }

  /**
   * Replaces a project's placeholder with an imported GLB scene.
   *
   * `object` is expected to be metre-scaled with Y up (the glTF convention);
   * it is rotated into the overlay's Z-up frame here and scaled by the same
   * factor as the placeholders, so a real-size model reads at the same size in
   * whichever view it is dropped into. The pin above it is left in place: at
   * province scale the pin is what you can actually see and click.
   */
  replaceProjectModel(projectId: string, object: Object3D, scale = 1) {
    const holder = this.projectMeshes.find((m) => m.userData.id === projectId);
    if (!holder) return false;
    // Pins and the pick target belong to the placement, not to the placeholder.
    const keep = holder.children.filter(
      (child) => child.userData.kind === "pin" || child.userData.kind === "pick",
    );
    holder.clear();
    for (const part of keep) holder.add(part);
    object.rotation.x = Math.PI / 2;
    object.scale.setScalar(scale * this.structureScale);
    object.traverse((child) => {
      child.userData = { kind: "project", id: projectId };
    });
    holder.add(object);
    return true;
  }

  // -------------------------------------------------------------- flood zones

  addZones(features: FloodZoneFeature[]) {
    const outlineGroup = this.layers.get("flood-zones")!;
    const waterGroup = this.layers.get("water-surface")!;

    for (const feature of features) {
      const ring = feature.geometry.coordinates[0];
      const pts = ring.map(([lng, lat]) => this.project(lng, lat, 0));
      const shape = new Shape();
      pts.forEach((p, i) => (i === 0 ? shape.moveTo(p.x, p.y) : shape.lineTo(p.x, p.y)));
      shape.closePath();

      const outlineMesh = new Mesh(
        new ShapeGeometry(shape),
        new MeshLambertMaterial({
          color: 0x1f6f8b,
          transparent: true,
          opacity: 0.12,
          side: DoubleSide,
          depthWrite: false,
        }),
      );
      outlineMesh.position.z = 2;
      outlineMesh.userData = { kind: "zone", id: feature.id, name: feature.properties.name };
      outlineGroup.add(outlineMesh);

      const material = new ShaderMaterial({
        vertexShader: waterVertexShader,
        fragmentShader: waterFragmentShader,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        uniforms: {
          uTime: { value: 0 },
          uRipple: { value: 6 },
          uColor: { value: colorVec(0x2a7fbf) },
          uOpacity: { value: 0 },
        },
      });
      const waterMesh = new Mesh(new ShapeGeometry(shape), material);
      waterMesh.visible = false;
      waterMesh.userData = { kind: "zone-water", id: feature.id };

      const group = new Group();
      group.add(waterMesh);
      waterGroup.add(group);
      this.zones.set(feature.id, { mesh: waterMesh, material, group });
    }
  }

  /**
   * Applies the modelled depth per zone. Depth is exaggerated vertically by
   * DEPTH_EXAGGERATION so that decimetre-scale water reads at province zoom.
   */
  setZoneDepths(depths: Record<string, number>) {
    for (const [zoneId, entry] of this.zones) {
      const depth = depths[zoneId] ?? 0;
      const visible = depth > 0.01;
      entry.mesh.visible = visible;
      entry.mesh.position.z = 3 + depth * this.depthExaggeration;
      entry.material.uniforms.uOpacity.value = Math.min(0.62, 0.14 + depth * 0.9);
      const warm = Math.min(1, depth / 1.2);
      entry.material.uniforms.uColor.value = colorVec(
        lerpColor(0x2a7fbf, 0xb03a4a, warm),
      );
      entry.material.uniforms.uRipple.value = this.animate ? 4 + depth * 10 : 0;
    }
  }

  /** Highlights the selected structure by swelling its pin head. */
  setSelected(projectId: string | null) {
    if (this.selectedId === projectId) return;
    const previous = this.selectedId ? this.pinHeads.get(this.selectedId) : undefined;
    previous?.scale.setScalar(1);
    this.selectedId = projectId;
    const head = projectId ? this.pinHeads.get(projectId) : undefined;
    head?.scale.setScalar(1.9);
  }

  /** World position of a project's placement, for camera framing. */
  positionOf(projectId: string): Vector3 | null {
    const holder = this.projectMeshes.find((m) => m.userData.id === projectId);
    return holder ? holder.position.clone() : null;
  }

  /** Objects eligible for click-picking. */
  get pickables(): Object3D[] {
    return this.projectMeshes;
  }

  dispose() {
    for (const g of this.layers.values()) {
      g.traverse((o) => {
        const mesh = o as Mesh;
        mesh.geometry?.dispose?.();
        const mat = mesh.material as { dispose?: () => void } | undefined;
        mat?.dispose?.();
      });
      this.overlay.scene.remove(g);
    }
    this.layers.clear();
    this.waterways = [];
    this.zones.clear();
    this.projectMeshes = [];
    this.pinHeads.clear();
  }
}

function colorVec(hex: number): Vector3 {
  return new Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
}

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}
