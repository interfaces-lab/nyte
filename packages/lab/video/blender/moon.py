"""Render the Nyte pixel moon as a voxel relief.

blender -b -P moon.py -- <shot> <out_dir> [first last]

Shots:
  rise    the icon seen flat, then the camera swings round to show its depth
  phases  front view while the sun circles once, so the moon waxes and wanes

Each shot writes two passes as RGBA PNG sequences: `beauty` and `heat`. The
heat pass maps height to a gradient so the film can wipe from one to the
other, the render-pass reveal from the rajz reference.
"""

import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

FPS = 30
LENGTH = {"rise": 150, "phases": 210}
MOON = "#c1d0f6"
HEAT = ["#3b2aff", "#b04dff", "#ff4f9a", "#ff8a3d", "#ffe36b"]


def srgb(hex_colour, alpha=1.0):
    def channel(i):
        c = int(hex_colour[i : i + 2], 16) / 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return (channel(1), channel(3), channel(5), alpha)


def reset(first, last):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    engines = {item.identifier for item in scene.render.bl_rna.properties["engine"].enum_items}
    scene.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in engines else "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080
    scene.render.fps = FPS
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"
    scene.frame_start = first
    scene.frame_end = last
    scene.eevee.taa_render_samples = 32
    world = bpy.data.worlds.new("night")
    world.color = (0, 0, 0)
    scene.world = world
    return scene


def material(name, colour, roughness):
    mat = bpy.data.materials.new(name)
    if hasattr(mat, "use_nodes"):
        mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = colour
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def heat_material(top):
    mat = bpy.data.materials.new("heat")
    if hasattr(mat, "use_nodes"):
        mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    geometry = nodes.new("ShaderNodeNewGeometry")
    split = nodes.new("ShaderNodeSeparateXYZ")
    scale = nodes.new("ShaderNodeMapRange")
    scale.inputs["From Min"].default_value = top * 0.3
    scale.inputs["From Max"].default_value = top
    ramp = nodes.new("ShaderNodeValToRGB")
    elements = ramp.color_ramp.elements
    elements[0].color = srgb(HEAT[0])
    elements[1].position = 1
    elements[1].color = srgb(HEAT[-1])
    for index, hex_colour in enumerate(HEAT[1:-1], start=1):
        stop = elements.new(index / (len(HEAT) - 1))
        stop.color = srgb(hex_colour)
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value = 1
    output = nodes.new("ShaderNodeOutputMaterial")
    links.new(geometry.outputs["Position"], split.inputs["Vector"])
    links.new(split.outputs["Z"], scale.inputs["Value"])
    links.new(scale.outputs["Result"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], emission.inputs["Color"])
    links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return mat


def build_moon():
    grid = json.loads((Path(__file__).parent.parent / "moon.json").read_text())
    centre = (grid["size"] - 1) / 2
    radius = grid["size"] / 2 + 0.6
    lit = material("lit", srgb(MOON), 0.45)
    dim = material("dim", srgb("#1c2238"), 0.8)
    mesh = bpy.data.meshes.new("cell")
    verts = [(x, y, z) for z in (0, 1) for y in (-0.5, 0.5) for x in (-0.5, 0.5)]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    mesh.from_pydata(verts, [], faces)
    # Each tile sits on a sphere and faces outward, so seen straight on the
    # tiles line up as the flat icon, and a moving sun draws a terminator.
    for cell_data in grid["cells"]:
        x, y, is_lit = cell_data["x"], cell_data["y"], cell_data["lit"]
        dx, dy = x - centre, centre - y
        normal = Vector((dx, dy, math.sqrt(radius**2 - dx**2 - dy**2))).normalized()
        cell = bpy.data.objects.new(f"cell_{x}_{y}", mesh.copy())
        cell.location = (dx, dy, normal.z * radius)
        cell.rotation_euler = Vector((0, 0, 1)).rotation_difference(normal).to_euler()
        cell.scale = (0.8, 0.8, 0.45)
        cell.data.materials.append(lit if is_lit else dim)
        bpy.context.scene.collection.objects.link(cell)
    return radius


def keyframe_camera(camera, frame, azimuth, elevation, distance):
    a, e = math.radians(azimuth), math.radians(elevation)
    camera.location = (
        distance * math.sin(a) * math.cos(e),
        -distance * math.cos(a) * math.cos(e),
        distance * math.sin(e),
    )
    camera.keyframe_insert("location", frame=frame)


def stage(shot, scene):
    camera = bpy.data.objects.new("camera", bpy.data.cameras.new("camera"))
    scene.collection.objects.link(camera)
    scene.camera = camera
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 4.5
    sun.data.angle = math.radians(2)
    scene.collection.objects.link(sun)
    fill = bpy.data.objects.new("fill", bpy.data.lights.new("fill", "SUN"))
    fill.data.energy = 0.35
    fill.data.color = srgb("#6c7bd6")[:3]
    fill.rotation_euler = (math.radians(-60), 0, math.radians(200))
    scene.collection.objects.link(fill)

    if shot == "rise":
        camera.data.lens = 85
        # A constraint keeps the moon centred through the swing; keyed
        # rotations would drift between the two ends.
        target = bpy.data.objects.new("target", None)
        target.location = (0, 0, 4)
        scene.collection.objects.link(target)
        aim = camera.constraints.new("TRACK_TO")
        aim.target = target
        aim.track_axis = "TRACK_NEGATIVE_Z"
        aim.up_axis = "UP_Y"
        keyframe_camera(camera, 1, 0, 89, 75)
        keyframe_camera(camera, LENGTH["rise"], 38, 26, 62)
        sun.rotation_euler = (math.radians(40), math.radians(-35), 0)
        return

    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 30
    camera.location = (0, 0, 40)
    camera.rotation_euler = (0, 0, 0)
    for frame, angle in ((1, -95), (LENGTH["phases"], 95)):
        sun.rotation_euler = (0, math.radians(angle), 0)
        sun.keyframe_insert("rotation_euler", frame=frame)


def render(shot, out_dir, first, last):
    scene = reset(first, last)
    top = build_moon()
    stage(shot, scene)
    heat = heat_material(top)
    for name, override in (("beauty", None), ("heat", heat)):
        if shot == "phases" and name == "heat":
            continue
        scene.view_layers[0].material_override = override
        scene.render.filepath = f"{Path(out_dir) / shot / name}/"
        bpy.ops.render.render(animation=True)


def main():
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(args) < 2 or args[0] not in LENGTH:
        raise SystemExit(f"usage: blender -b -P moon.py -- <{'|'.join(LENGTH)}> <out_dir> [first last]")
    shot, out_dir = args[0], args[1]
    first = int(args[2]) if len(args) > 2 else 1
    last = int(args[3]) if len(args) > 3 else LENGTH[shot]
    render(shot, out_dir, first, last)


main()
