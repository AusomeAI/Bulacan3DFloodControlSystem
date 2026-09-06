import { useEffect, useRef, useState } from "react";
import {
  AmbientLight,
  CanvasTexture,
  Color,
  DirectionalLight,
  Fog,
  GridHelper,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { FloodScene } from "../three/floodScene";
import { LocalProjector, boundsOf } from "../three/localProjector";
import { MapZoomControls } from "./MapZoomControls";
import type { AppData, LayerId } from "../types";

interface Props {
  data: AppData;
  layers: Record<LayerId, boolean>;
  depths: Record<string, number>;
  selectedProjectId: string | null;
  reducedMotion: boolean;
  onSelectProject: (id: string | null) => void;
  onSceneReady: (scene: FloodScene | null) => void;
}

/** Water is decimetres deep over tens of kilometres; without this it is invisible. */
const DEPTH_EXAGGERATION_3D = 160;
const STRUCTURE_SCALE = 6;
const PIN_HEIGHT_M = 2600;
const WATERWAY_WIDTH_SCALE = 12;
const DRAG_SLOP = 4;

/**
 * Credential-free interactive 3D view.
 *
 * The same FloodScene that renders through Google's WebGLOverlayView, drawn
 * instead into a plain WebGL canvas with an orbit camera. No basemap, no API
 * key, no network: the province is built entirely from the GeoJSON in
 * public/data, so the rivers, structures and modelled water surface behave
 * exactly as they do on the Google map.
 */
export function Scene3D({
  data,
  layers,
  depths,
  selectedProjectId,
  reducedMotion,
  onSelectProject,
  onSceneReady,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<WebGLRenderer | null>(null);
  const cameraRef = useRef<PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const sceneRef = useRef<FloodScene | null>(null);
  const projectorRef = useRef<LocalProjector | null>(null);
  const labelsRef = useRef<Sprite[]>([]);
  const homeRef = useRef<{ position: Vector3; target: Vector3 } | null>(null);
  const [distance, setDistance] = useState(1);
  const [failed, setFailed] = useState<string | null>(null);

  // ------------------------------------------------------------------ set-up
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const coords: [number, number][] = [];
    for (const f of data.waterways.features) coords.push(...f.geometry.coordinates);
    for (const f of data.zones.features) coords.push(...f.geometry.coordinates[0]);
    for (const f of data.projects.features) coords.push(f.geometry.coordinates);
    const bounds = boundsOf(coords);

    const projector = new LocalProjector(bounds.centre);
    projectorRef.current = projector;
    const scene = projector.scene;
    scene.background = new Color(0x081722);

    const min = projector.latLngAltitudeToVector3({ lat: bounds.minLat, lng: bounds.minLng });
    const max = projector.latLngAltitudeToVector3({ lat: bounds.maxLat, lng: bounds.maxLng });
    const extent = Math.max(max.x - min.x, max.y - min.y);
    scene.fog = new Fog(0x081722, extent * 1.1, extent * 3.4);

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: false });
    } catch (e) {
      setFailed((e as Error).message);
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(host.clientWidth, host.clientHeight || 420);
    host.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const camera = new PerspectiveCamera(48, host.clientWidth / (host.clientHeight || 420), 100, extent * 8);
    camera.up.set(0, 0, 1);
    // South-east of the province, looking north-west up the river systems.
    camera.position.set(extent * 0.45, -extent * 0.85, extent * 0.62);
    cameraRef.current = camera;

    scene.add(new AmbientLight(0xbcd6e8, 0.75));
    const sun = new DirectionalLight(0xffffff, 1.15);
    sun.position.set(-extent, -extent * 0.6, extent * 1.4);
    scene.add(sun);

    // Ground and a coarse graticule, so orbiting has something to read against.
    const ground = new Mesh(
      new PlaneGeometry(extent * 2.6, extent * 2.6),
      new MeshLambertMaterial({ color: 0x10222f }),
    );
    ground.position.z = -8;
    scene.add(ground);

    const grid = new GridHelper(extent * 2.2, 22, 0x1f3f52, 0x16303f);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -6;
    scene.add(grid);

    const floodScene = new FloodScene(projector, {
      structureScale: STRUCTURE_SCALE,
      pinHeightMeters: PIN_HEIGHT_M,
      depthExaggeration: DEPTH_EXAGGERATION_3D,
      waterwayWidthScale: WATERWAY_WIDTH_SCALE,
    });
    floodScene.addWaterways(data.waterways.features);
    floodScene.addZones(data.zones.features);
    floodScene.addProjects(data.projects.features);
    sceneRef.current = floodScene;
    onSceneReady(floodScene);

    // Zone name plates, kept at a constant size on screen.
    for (const zone of data.zones.features) {
      const ring = zone.geometry.coordinates[0];
      const lng = ring.reduce((a, p) => a + p[0], 0) / ring.length;
      const lat = ring.reduce((a, p) => a + p[1], 0) / ring.length;
      const sprite = makeLabel(zone.properties.name.split(" (")[0]);
      sprite.position.copy(projector.latLngAltitudeToVector3({ lat, lng, altitude: 900 }));
      scene.add(sprite);
      labelsRef.current.push(sprite);
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enableDamping = !reducedMotion;
    controls.dampingFactor = 0.08;
    controls.minDistance = extent * 0.12;
    controls.maxDistance = extent * 2.4;
    controls.maxPolarAngle = Math.PI / 2.06; // never below the ground plane
    controls.zoomSpeed = 0.8;
    controls.update();
    controlsRef.current = controls;
    homeRef.current = { position: camera.position.clone(), target: controls.target.clone() };
    setDistance(camera.position.distanceTo(controls.target));

    // Render continuously while the water animates; otherwise only on demand.
    let frame = 0;
    let last = performance.now();
    let dirty = true;
    const requestRender = () => {
      dirty = true;
    };
    controls.addEventListener("change", requestRender);

    const loop = () => {
      frame = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!reducedMotion) {
        floodScene.tick(dt);
        dirty = true;
      }
      if (controls.enableDamping) controls.update();
      if (!dirty) return;
      dirty = false;

      // Keep the plates legible whatever the camera does.
      const d = camera.position.distanceTo(controls.target);
      const labelHeight = d * 0.017;
      for (const sprite of labelsRef.current) {
        sprite.scale.set(labelHeight * (sprite.userData.aspect as number), labelHeight, 1);
      }
      renderer.render(scene, camera);
    };
    loop();

    const onResize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight || 420;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      requestRender();
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(host);

    // Click to pick, but a press that turned into an orbit is not a click.
    const pointer = { x: 0, y: 0, moved: false };
    const onPointerDown = (e: PointerEvent) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.moved = false;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) > DRAG_SLOP) pointer.moved = true;
    };
    const raycaster = new Raycaster();
    const onClick = (e: MouseEvent) => {
      if (pointer.moved) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObjects(floodScene.pickables, true)[0];
      onSelectProject((hit?.object.userData?.id as string) ?? null);
    };
    const canvas = renderer.domElement;
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("click", onClick);

    const onControlsEnd = () => setDistance(camera.position.distanceTo(controls.target));
    controls.addEventListener("end", onControlsEnd);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("click", onClick);
      controls.removeEventListener("change", requestRender);
      controls.removeEventListener("end", onControlsEnd);
      controls.dispose();
      floodScene.dispose();
      for (const sprite of labelsRef.current) {
        sprite.material.map?.dispose();
        sprite.material.dispose();
      }
      labelsRef.current = [];
      renderer.dispose();
      canvas.remove();
      sceneRef.current = null;
      onSceneReady(null);
    };
    // Built once from the loaded data; live updates go through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // ----------------------------------------------------------------- updates
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    (Object.keys(layers) as LayerId[]).forEach((id) => scene.setLayerVisible(id, layers[id]));
  }, [layers]);

  useEffect(() => {
    sceneRef.current?.setZoneDepths(depths);
  }, [depths]);

  useEffect(() => {
    sceneRef.current?.setSelected(selectedProjectId);
  }, [selectedProjectId]);

  useEffect(() => {
    sceneRef.current?.setAnimated(!reducedMotion);
    if (controlsRef.current) controlsRef.current.enableDamping = !reducedMotion;
  }, [reducedMotion]);

  // ------------------------------------------------------------------- zoom
  const dolly = (factor: number) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const offset = camera.position.clone().sub(controls.target);
    const next = Math.min(controls.maxDistance, Math.max(controls.minDistance, offset.length() * factor));
    camera.position.copy(controls.target).add(offset.setLength(next));
    controls.update();
    setDistance(next);
  };

  const resetView = () => {
    const home = homeRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!home || !camera || !controls) return;
    camera.position.copy(home.position);
    controls.target.copy(home.target);
    controls.update();
    setDistance(camera.position.distanceTo(controls.target));
  };

  const controls = controlsRef.current;
  const home = homeRef.current;
  const zoomLabel = home ? `${(home.position.distanceTo(home.target) / distance).toFixed(1)}×` : "1.0×";
  const selected = data.projects.features.find((f) => f.id === selectedProjectId);

  if (failed) {
    return (
      <div className="scene3d failed">
        <p>This browser could not create a WebGL context ({failed}). Switch to the schematic view.</p>
      </div>
    );
  }

  return (
    <div className="scene3d">
      <div ref={hostRef} className="scene3d-canvas" />
      <div className="scene3d-hint">
        <span>Drag to orbit · right-drag to pan · scroll to zoom</span>
        <span className="tag tag-model">water ×{DEPTH_EXAGGERATION_3D} vertical</span>
      </div>
      {selected && <div className="scene3d-caption">{selected.properties.name}</div>}
      <MapZoomControls
        zoomLabel={zoomLabel}
        canZoomIn={!controls || distance > controls.minDistance + 1}
        canZoomOut={!controls || distance < controls.maxDistance - 1}
        onZoomIn={() => dolly(1 / 1.6)}
        onZoomOut={() => dolly(1.6)}
        onReset={resetView}
        resetLabel="Back to the province view"
      />
    </div>
  );
}

/**
 * Text plate drawn on a 2D canvas, used as a sprite in the scene. The canvas is
 * sized to the text so nothing is clipped, and the resulting aspect ratio rides
 * along on the sprite so the render loop can scale it without distortion.
 */
function makeLabel(text: string): Sprite {
  const FONT = "600 44px ui-sans-serif, system-ui, sans-serif";
  const PAD = 26;
  const HEIGHT = 76;

  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = FONT;
  const width = Math.ceil(measure.measureText(text).width) + PAD * 2;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d")!;
  ctx.font = FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 7;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(4, 18, 29, 0.92)";
  ctx.strokeText(text, width / 2, HEIGHT / 2);
  ctx.fillStyle = "#dceaf4";
  ctx.fillText(text, width / 2, HEIGHT / 2);

  const sprite = new Sprite(
    new SpriteMaterial({ map: new CanvasTexture(canvas), transparent: true, depthTest: false }),
  );
  sprite.userData.aspect = width / HEIGHT;
  sprite.renderOrder = 10;
  return sprite;
}
