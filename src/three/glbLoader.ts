import { Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const loader = new GLTFLoader();

/**
 * Loads a GLB/glTF file for a project structure.
 *
 * Authoring conventions for models dropped into `public/models`:
 *  - metre units, Y up (the glTF default); the scene rotates them into the
 *    overlay's Z-up frame;
 *  - origin at the structure's ground contact point;
 *  - keep them small - these are drawn on top of a live basemap.
 *
 * Reference a model from a project feature with `"modelUrl": "models/pump.glb"`.
 */
export async function loadGLB(url: string): Promise<Object3D> {
  const gltf = await loader.loadAsync(url);
  return gltf.scene;
}

/** Loads a GLB the user picked from disk, for quick preview without a rebuild. */
export async function loadGLBFromFile(file: File): Promise<Object3D> {
  const buffer = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    loader.parse(buffer, "", (gltf) => resolve(gltf.scene), reject);
  });
}
