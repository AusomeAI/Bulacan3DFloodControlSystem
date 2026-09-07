"""
Bring a hand-authored Blender or glTF model into the app's conventions.

    python3 blender/normalise_model.py <input.blend|.glb|.gltf|.fbx|.obj> <name> [--height 12]

It imports the file, then:
  * drops cameras, lights and empties (the scene lights the model);
  * merges everything into one object graph and clears parent transforms;
  * moves the origin to the centre of the footprint at ground level, so the
    model sits on the basemap instead of floating or sinking;
  * optionally rescales so the structure is `--height` metres tall, which is
    the quickest way to fix a model authored in centimetres or inches;
  * reports the bounding box and triangle count, because a model drawn over a
    live basemap has to stay small;
  * exports public/models/<name>.glb, ready to reference from projects.geojson
    as "modelUrl": "models/<name>.glb".

The web app rotates Y-up glTF into its Z-up frame and applies the same scale
factor it uses for the placeholder it replaces, so a model that is correct in
metres here is correct on the map.
"""

import argparse
import os
import sys

import bpy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "public", "models")

IMPORTERS = {
    ".glb": lambda p: bpy.ops.import_scene.gltf(filepath=p),
    ".gltf": lambda p: bpy.ops.import_scene.gltf(filepath=p),
    ".fbx": lambda p: bpy.ops.import_scene.fbx(filepath=p),
    ".obj": lambda p: bpy.ops.wm.obj_import(filepath=p),
    ".stl": lambda p: bpy.ops.wm.stl_import(filepath=p),
}


def load(path):
    ext = os.path.splitext(path)[1].lower()
    if ext == ".blend":
        bpy.ops.wm.open_mainfile(filepath=path)
        return
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if ext not in IMPORTERS:
        raise SystemExit(f"unsupported input '{ext}'; use {', '.join(sorted(IMPORTERS))} or .blend")
    IMPORTERS[ext](path)


def strip_non_geometry():
    for ob in list(bpy.data.objects):
        if ob.type not in {"MESH", "CURVE", "SURFACE", "META", "FONT"}:
            bpy.data.objects.remove(ob, do_unlink=True)


def meshes():
    return [ob for ob in bpy.data.objects if ob.type == "MESH"]


def world_bounds():
    xs, ys, zs = [], [], []
    for ob in meshes():
        for corner in ob.bound_box:
            v = ob.matrix_world @ __import__("mathutils").Vector(corner)
            xs.append(v.x)
            ys.append(v.y)
            zs.append(v.z)
    if not xs:
        raise SystemExit("the file contains no mesh geometry")
    return (min(xs), max(xs)), (min(ys), max(ys)), (min(zs), max(zs))


def normalise(target_height=None):
    strip_non_geometry()
    for ob in meshes():
        ob.select_set(True)
    bpy.context.view_layer.objects.active = meshes()[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    (x0, x1), (y0, y1), (z0, z1) = world_bounds()
    height = z1 - z0

    if target_height:
        if height <= 0:
            raise SystemExit("cannot rescale a model with zero height")
        factor = target_height / height
        for ob in meshes():
            ob.scale = (factor, factor, factor)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        (x0, x1), (y0, y1), (z0, z1) = world_bounds()
        height = z1 - z0

    # Origin to the footprint centre at ground level.
    dx = -(x0 + x1) / 2
    dy = -(y0 + y1) / 2
    dz = -z0
    for ob in meshes():
        ob.location = (ob.location.x + dx, ob.location.y + dy, ob.location.z + dz)
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)

    (x0, x1), (y0, y1), (z0, z1) = world_bounds()
    tris = sum(len(ob.data.loop_triangles) if ob.data.loop_triangles else len(ob.data.polygons) for ob in meshes())
    return {
        "size_m": (round(x1 - x0, 2), round(y1 - y0, 2), round(z1 - z0, 2)),
        "base_z": round(z0, 4),
        "objects": len(meshes()),
        "triangles": tris,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("input")
    ap.add_argument("name", help="output name, written to public/models/<name>.glb")
    ap.add_argument("--height", type=float, default=None, help="rescale so the model is this many metres tall")
    args = ap.parse_args(sys.argv[1:])

    load(os.path.abspath(args.input))
    report = normalise(args.height)

    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, f"{args.name}.glb")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
    )

    size_kb = os.path.getsize(out) / 1024
    print(f"wrote {out}  ({size_kb:.1f} kB)")
    print(f"  size      {report['size_m'][0]} x {report['size_m'][1]} x {report['size_m'][2]} m")
    print(f"  base z    {report['base_z']} (0 means it sits on the ground)")
    print(f"  objects   {report['objects']}, triangles {report['triangles']}")
    if size_kb > 800:
        print("  NOTE: over 800 kB. This is drawn over a live basemap - decimate before shipping it.")
    print(f'  reference it with  "modelUrl": "models/{args.name}.glb"')


if __name__ == "__main__":
    main()
