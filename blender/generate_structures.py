"""
Generate the project structure models with Blender, export them as GLB.

Run headlessly with the Blender Python module (no Blender GUI needed):

    pip install bpy            # Blender as a Python module, needs Python 3.11
    python3 blender/generate_structures.py

or with a Blender install:

    blender --background --python blender/generate_structures.py

Each model is written to public/models/<name>.glb and referenced from
public/data/projects.geojson through the `modelUrl` field, so the web app
swaps it in for the coloured placeholder box at load time.

Conventions the app relies on (see public/models/README.md):
  * metres, and the exporter converts Blender's Z-up to glTF's Y-up;
  * origin at the structure's ground contact point, so it sits on the basemap;
  * no cameras or lights in the file - the scene lights it.

These are *illustrative* structures: a pump house that reads as a pump house at
a glance. They are not engineering drawings of any real facility, and nothing
here is dimensioned from a real design.
"""

import math
import os
import sys

import bpy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "public", "models")

# Matches CATEGORY_COLORS in src/three/floodScene.ts so a GLB and the
# placeholder it replaces read as the same thing.
PALETTE = {
    "pump": (0.184, 0.710, 0.784, 1.0),
    "gate": (0.184, 0.710, 0.784, 1.0),
    "channel": (0.482, 0.827, 0.537, 1.0),
    "barrier": (0.949, 0.627, 0.239, 1.0),
    "works": (0.788, 0.545, 0.859, 1.0),
    "airport": (0.910, 0.416, 0.416, 1.0),
    "concrete": (0.62, 0.64, 0.66, 1.0),
    "dark": (0.20, 0.24, 0.28, 1.0),
    "water": (0.16, 0.45, 0.70, 0.75),
}


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, rgba, rough=0.72, metal=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if rgba[3] < 1.0:
        bsdf.inputs["Alpha"].default_value = rgba[3]
        mat.blend_method = "BLEND"
    return mat


def box(name, size, loc, mat):
    """Axis-aligned box given full size and centre, in metres."""
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    ob.data.materials.append(mat)
    return ob


def cylinder(name, radius, depth, loc, mat, rot=(0, 0, 0), verts=20):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, location=loc, vertices=verts)
    ob = bpy.context.active_object
    ob.name = name
    ob.rotation_euler = rot
    ob.data.materials.append(mat)
    return ob


def wedge(name, length, width, height, loc, mat):
    """Trapezoidal embankment: wide at the toe, narrow at the crest."""
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = (length, width, height)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    # Pull the top face in on both sides to make the batter slope.
    mesh = ob.data
    for v in mesh.vertices:
        if v.co.z > 0:
            v.co.y *= 0.42
    ob.data.materials.append(mat)
    return ob


def export(name):
    """Export everything currently in the scene as one GLB."""
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, f"{name}.glb")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
    )
    return path


# --------------------------------------------------------------------- models


def build_pump_station():
    """Pump house with intake bay, pump columns, roof monitor and outfall pipe."""
    concrete = material("concrete", PALETTE["concrete"])
    shell = material("pump-shell", PALETTE["pump"], rough=0.55)
    dark = material("dark", PALETTE["dark"], rough=0.5)

    box("apron", (46, 34, 1.2), (0, 0, 0.6), concrete)
    box("house", (26, 18, 10), (0, 0, 6.2), shell)
    box("roof", (28, 20, 1.0), (0, 0, 11.7), dark)
    box("monitor", (12, 6, 2.4), (0, 0, 13.4), shell)  # raised roof lantern

    # Pump columns dropping into the intake bay.
    for i, x in enumerate((-8, 0, 8)):
        cylinder(f"pump-{i}", 1.5, 9, (x, -11, 4.5), dark)
        box(f"motor-{i}", (3.4, 3.4, 2.2), (x, -11, 10.2), shell)

    box("intake-bay", (30, 8, 3.0), (0, -11, -0.4), concrete)
    box("trash-rack", (30, 0.6, 3.6), (0, -15, 1.4), dark)

    # Outfall pipe over the dike to the river side.
    cylinder("outfall", 2.0, 22, (0, 14, 6.0), concrete, rot=(math.pi / 2, 0, 0))
    box("headwall", (12, 3, 7), (0, 24, 3.5), concrete)


def build_flood_gate():
    """Tidal flood gate: piers, lifting frames, gate leaves and a walkway."""
    concrete = material("concrete", PALETTE["concrete"])
    steel = material("gate-steel", PALETTE["gate"], rough=0.45, metal=0.35)
    dark = material("dark", PALETTE["dark"], rough=0.5)

    box("sill", (34, 12, 1.6), (0, 0, 0.8), concrete)
    for i, x in enumerate((-16, -5.5, 5.5, 16)):
        box(f"pier-{i}", (3, 12, 11), (x, 0, 6.4), concrete)
        box(f"frame-{i}", (2.2, 2.2, 7), (x, 0, 14.5), dark)
    box("deck", (36, 5, 1.2), (0, 0, 12.5), concrete)
    box("rail", (36, 0.3, 1.4), (0, 2.2, 13.8), dark)
    for i, x in enumerate((-10.7, 0, 10.7)):
        box(f"leaf-{i}", (8.4, 1.0, 8.0), (x, 0, 5.6), steel)
    box("wing-w", (6, 10, 8), (-20, 0, 4.8), concrete)
    box("wing-e", (6, 10, 8), (20, 0, 4.8), concrete)


def build_drainage_channel():
    """A run of lined trapezoidal channel with access berms."""
    concrete = material("concrete", PALETTE["concrete"])
    lining = material("channel-lining", PALETTE["channel"], rough=0.8)
    water = material("channel-water", PALETTE["water"], rough=0.2)

    length = 120
    box("bed", (length, 9, 0.8), (0, 0, -3.6), lining)
    for sign in (-1, 1):
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, sign * 6.4, -1.8))
        ob = bpy.context.active_object
        ob.name = f"bank-{'n' if sign > 0 else 's'}"
        ob.scale = (length, 4.6, 4.4)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        for v in ob.data.vertices:  # batter the inner face
            if v.co.z < 0:
                v.co.y -= sign * 1.6
        ob.data.materials.append(lining)
        box(f"berm-{'n' if sign > 0 else 's'}", (length, 5, 0.6), (0, sign * 11, 0.3), concrete)
    box("water", (length - 2, 8.4, 1.6), (0, 0, -2.6), water)


def build_flood_barrier():
    """Earth dike with a concrete crest wall and a wave-return face."""
    fill = material("dike-fill", PALETTE["barrier"], rough=0.9)
    concrete = material("concrete", PALETTE["concrete"])

    length = 140
    wedge("embankment", length, 26, 7, (0, 0, 3.5), fill)
    box("crest-path", (length, 6, 0.5), (0, 0, 7.2), concrete)
    box("crest-wall", (length, 1.2, 2.4), (0, -3.2, 8.6), concrete)
    box("toe-apron", (length, 5, 0.8), (0, -15, 0.4), concrete)
    for i in range(-2, 3):  # revetment blocks along the seaward toe
        box(f"block-{i + 2}", (16, 4, 2.2), (i * 26, -13.5, 1.4), concrete)


def build_sabo_dam():
    """Stepped sediment-control dam with a central notch and stilling apron."""
    concrete = material("concrete", PALETTE["concrete"])
    body = material("sabo-body", PALETTE["works"], rough=0.85)

    box("base", (54, 16, 3), (0, 0, 1.5), concrete)
    box("step-1", (48, 12, 3.5), (0, 0, 4.7), body)
    box("step-2", (40, 9, 3.5), (0, 0, 8.2), body)
    box("wing-l", (8, 12, 12), (-24, 0, 6), body)
    box("wing-r", (8, 12, 12), (24, 0, 6), body)
    box("notch-lip", (14, 10, 1.2), (0, 0, 10.5), concrete)
    box("apron", (44, 14, 1.0), (0, 14, 0.5), concrete)
    for i, x in enumerate((-12, 0, 12)):  # energy dissipation blocks
        box(f"baffle-{i}", (4, 4, 2.4), (x, 14, 2.2), concrete)


def build_detention_basin():
    """Shallow storage basin with inlet, outlet structure and access ramp."""
    ground = material("basin-ground", PALETTE["works"], rough=0.95)
    concrete = material("concrete", PALETTE["concrete"])
    water = material("basin-water", PALETTE["water"], rough=0.2)

    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, -2.0))
    bowl = bpy.context.active_object
    bowl.name = "basin"
    bowl.scale = (150, 110, 4.0)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    for v in bowl.data.vertices:  # taper to a bowl
        if v.co.z < 0:
            v.co.x *= 0.72
            v.co.y *= 0.68
    bowl.data.materials.append(ground)

    box("water", (110, 78, 1.2), (0, 0, -1.4), water)
    box("embankment-n", (156, 8, 2.4), (0, 57, 1.2), ground)
    box("embankment-s", (156, 8, 2.4), (0, -57, 1.2), ground)
    box("inlet", (10, 14, 5), (-72, 0, 1.5), concrete)
    box("outlet-tower", (7, 7, 9), (72, 0, 2.5), concrete)
    box("ramp", (26, 10, 0.6), (40, 48, 0.3), concrete)


def build_airport_works():
    """Perimeter channel with a headwall outfall and a maintenance track."""
    concrete = material("concrete", PALETTE["concrete"])
    edge = material("airport-edge", PALETTE["airport"], rough=0.7)
    water = material("perimeter-water", PALETTE["water"], rough=0.2)

    length = 150
    box("channel-bed", (length, 14, 0.9), (0, 0, -3.0), concrete)
    box("wall-n", (length, 1.4, 5.5), (0, 7.5, -0.4), edge)
    box("wall-s", (length, 1.4, 5.5), (0, -7.5, -0.4), edge)
    box("water", (length - 2, 13, 1.8), (0, 0, -2.2), water)
    box("track", (length, 9, 0.5), (0, 14, 0.25), concrete)
    box("headwall", (18, 12, 7), (length / 2 + 6, 0, 2.0), concrete)
    for i, y in enumerate((-4.2, -1.4, 1.4, 4.2)):  # outfall gate cells
        box(f"gate-{i}", (1.2, 2.2, 4.2), (length / 2 + 1.5, y, 2.1), edge)


def build_dredging_works():
    """Cutter-suction dredger on the reach, with spuds and a floating pipeline."""
    hull = material("dredger-hull", PALETTE["works"], rough=0.6)
    concrete = material("concrete", PALETTE["concrete"])
    dark = material("dark", PALETTE["dark"], rough=0.45)
    water = material("spoil-water", PALETTE["water"], rough=0.2)

    box("pontoon", (34, 12, 3.2), (0, 0, 1.6), hull)
    box("deckhouse", (10, 8, 4.5), (-8, 0, 5.4), concrete)
    box("wheelhouse", (5, 5, 2.6), (-8, 0, 9.0), dark)

    # Ladder and cutter head reaching down to the bed at the bow.
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(14, 0, 0.4))
    ladder = bpy.context.active_object
    ladder.name = "ladder"
    ladder.scale = (18, 2.2, 1.6)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    ladder.rotation_euler = (0, math.radians(22), 0)
    ladder.data.materials.append(dark)
    cylinder("cutter-head", 2.2, 3.0, (22, 0, -3.2), dark, rot=(0, math.pi / 2, 0), verts=12)

    # A-frame gantry over the ladder.
    for sign in (-1, 1):
        box(f"gantry-{'p' if sign > 0 else 's'}", (0.9, 0.9, 9), (2, sign * 4.5, 7.5), dark)
    box("gantry-top", (2, 10, 0.9), (2, 0, 12.3), dark)

    # Spud legs holding station astern.
    for sign in (-1, 1):
        cylinder(f"spud-{'p' if sign > 0 else 's'}", 0.8, 16, (-15, sign * 4.5, 5), dark, verts=10)

    # Discharge pipeline floating away from the stern.
    for i in range(5):
        cylinder(f"float-{i}", 1.5, 9, (-24 - i * 10, 0, 1.5), hull, rot=(0, math.pi / 2, 0), verts=12)
    box("spoil", (40, 16, 0.8), (-46, 0, 0.4), water)


MODELS = {
    "pump-station": build_pump_station,
    "flood-gate": build_flood_gate,
    "drainage-channel": build_drainage_channel,
    "flood-barrier": build_flood_barrier,
    "sabo-dam": build_sabo_dam,
    "detention-basin": build_detention_basin,
    "airport-works": build_airport_works,
    "dredging-works": build_dredging_works,
}


def main():
    wanted = sys.argv[1:] or list(MODELS)
    for name in wanted:
        if name not in MODELS:
            raise SystemExit(f"unknown model '{name}'; choose from {', '.join(MODELS)}")
        reset_scene()
        MODELS[name]()
        path = export(name)
        size_kb = os.path.getsize(path) / 1024
        print(f"  {name:<18} {size_kb:7.1f} kB  {path}")


if __name__ == "__main__":
    print("Building structure models with Blender", bpy.app.version_string)
    main()
