"""Nyte mesh moon.

A crescent moon built from two gold lattice shells over a glossy night body.
The lattice grid's pole points at the sun, so the terminator is one clean
ring and every cell runs in an arc parallel to it. Run from the repo root:

  /Applications/Blender.app/Contents/MacOS/Blender --background \
      --python output/brand/nyte-mesh-moon/blender-mesh-moon.py

Set NYTE_QUICK=1 to render at reduced samples while iterating.
"""
import math
import os
import time
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector

OUT = Path(__file__).resolve().parent
QUICK = os.environ.get("NYTE_QUICK") == "1"

# Palette from output/brand/nyte-moon (amber on night) ---------------------
BG = "0a0c12"
AMBER = ("5a3e18", "ffc96b", "fff3dc")
NIGHT = ("202840", "4a5e8c", "a4b6d8")

# Geometry ------------------------------------------------------------------
BODY_R = 1.0
RECESS = 0.032           # the lit hemisphere of the body is sunk by this much
FRONT_R = 0.990          # front gold lattice, top surface flush with the dark limb
REAR_R = 0.978           # rear bronze lattice
SEGMENTS = 64            # longitude divisions (5.625 degrees)
RINGS = 16               # latitude divisions from terminator to pole (5.625 degrees)
STRUT = 0.028            # strut width, world units
REAR_STRUT = 0.022
REAR_OFFSET = 0.30       # rear grid offset in cells, both directions
BEVEL = 0.007            # strut edge rounding
POLE_GAP = 2             # rings left open at the sub-solar pole (hidden behind the limb)

# The sun sits to the right and a little behind: a waxing crescent, phase 0.33.
SUN = Vector((0.8, 0.3, -0.3)).normalized()
FILL = Vector((-0.4, 0.5, 0.75)).normalized()


def srgb(hex_color):
    values = [int(hex_color[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in values)


def look_at(obj, target=(0, 0, 0), roll=0.0):
    """Aim an object's -Z at target with +Y up, then roll about its own Z."""
    forward = (Vector(target) - Vector(obj.location)).normalized()
    up = Vector((0, 1, 0))
    if abs(forward.dot(up)) > 0.999:
        up = Vector((0, 0, 1))
    right = forward.cross(up).normalized()
    up = right.cross(forward).normalized()
    basis = Matrix((right, up, -forward)).transposed()
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = basis.to_quaternion() @ Quaternion((0, 0, 1), roll)


# Scene reset ---------------------------------------------------------------
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
for block in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.lights, bpy.data.cameras):
    for item in list(block):
        block.remove(item)
for collection in list(bpy.data.collections):
    bpy.data.collections.remove(collection)

scene = bpy.context.scene
artwork = bpy.data.collections.new("Artwork")
plate_col = bpy.data.collections.new("Icon plate")
lighting = bpy.data.collections.new("Lighting")
for col in (artwork, plate_col, lighting):
    scene.collection.children.link(col)


# Materials -----------------------------------------------------------------
def principled(name, color, metallic, roughness, coat=0.0, coat_roughness=0.15):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Coat Weight"].default_value = coat
    bsdf.inputs["Coat Roughness"].default_value = coat_roughness
    return mat


def add_ramp(mat, fac_node, fac_output, stops):
    """Colour ramp driven by a 0..1 factor, wired into Base Color. Returns ramp."""
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    ramp = nodes.new("ShaderNodeValToRGB")
    elements = ramp.color_ramp.elements
    while len(elements) < len(stops):
        elements.new(0.5)
    for element, (pos, color) in zip(elements, stops):
        element.position = pos
        element.color = (*color, 1)
    links.new(fac_node.outputs[fac_output], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], nodes["Principled BSDF"].inputs["Base Color"])
    return ramp


def local_axis_factor(mat, axis, low, high):
    """Object-space coordinate along one axis, mapped low..high -> 0..1."""
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    coords = nodes.new("ShaderNodeTexCoord")
    split = nodes.new("ShaderNodeSeparateXYZ")
    links.new(coords.outputs["Object"], split.inputs["Vector"])
    mapper = nodes.new("ShaderNodeMapRange")
    mapper.inputs["From Min"].default_value = low
    mapper.inputs["From Max"].default_value = high
    links.new(split.outputs[axis], mapper.inputs["Value"])
    return mapper


def local_dot_factor(mat, direction):
    """Object-space position dotted with a direction, mapped -1..1 -> 0..1."""
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    coords = nodes.new("ShaderNodeTexCoord")
    dot = nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    dot.inputs[1].default_value = tuple(Vector(direction).normalized())
    links.new(coords.outputs["Object"], dot.inputs[0])
    mapper = nodes.new("ShaderNodeMapRange")
    mapper.inputs["From Min"].default_value = -1
    mapper.inputs["From Max"].default_value = 1
    links.new(dot.outputs["Value"], mapper.inputs["Value"])
    return mapper


# Night body: smoky graphite blue, glossy coat, brighter toward the earthshine fill.
body_mat = principled("Night body - glossy graphite blue", srgb("1a2136"), 0.45, 0.26, coat=0.8, coat_roughness=0.16)
body_fac = local_dot_factor(body_mat, FILL)
add_ramp(body_mat, body_fac, "Result", [(0.0, srgb("080b12")), (0.5, srgb("151b2e")), (1.0, srgb("2a3656"))])

# Front lattice: amber gold, dark at the terminator, hot toward the limb, faint glow.
gold_mat = principled("Front lattice - amber gold", srgb(AMBER[1]), 0.65, 0.30, coat=0.25, coat_roughness=0.2)
gold_fac = local_axis_factor(gold_mat, "Z", 0.0, FRONT_R)
gold_ramp = add_ramp(gold_mat, gold_fac, "Result", [(0.0, srgb("b8741f")), (0.45, srgb(AMBER[1])), (1.0, srgb("fff0d0"))])
gold_bsdf = gold_mat.node_tree.nodes["Principled BSDF"]
gold_mat.node_tree.links.new(gold_ramp.outputs["Color"], gold_bsdf.inputs["Emission Color"])
glow = gold_mat.node_tree.nodes.new("ShaderNodeMath")
glow.operation = "MULTIPLY"
glow.inputs[1].default_value = 0.30
gold_mat.node_tree.links.new(gold_fac.outputs["Result"], glow.inputs[0])
gold_mat.node_tree.links.new(glow.outputs["Value"], gold_bsdf.inputs["Emission Strength"])

# Rear lattice: darker bronze, rougher, so it reads as depth inside the pores.
rear_mat = principled("Rear lattice - dark bronze", srgb("6a4518"), 0.6, 0.4)
rear_fac = local_axis_factor(rear_mat, "Z", 0.0, REAR_R)
add_ramp(rear_mat, rear_fac, "Result", [(0.0, srgb("3a2408")), (1.0, srgb("8a5c22"))])

plate_mat = principled("Icon plate - night", srgb(BG), 0.0, 0.55)
plate_mat.node_tree.nodes["Principled BSDF"].inputs["Specular IOR Level"].default_value = 0.15

wordmark_mat = principled("Wordmark - amber", srgb(AMBER[1]), 0.0, 0.6)
wm_bsdf = wordmark_mat.node_tree.nodes["Principled BSDF"]
wm_bsdf.inputs["Emission Color"].default_value = (*srgb(AMBER[1]), 1)
wm_bsdf.inputs["Emission Strength"].default_value = 1.6


# Geometry ------------------------------------------------------------------
def lattice_shell(name, radius, lon_offset, lat_offset, strut, mat):
    """Quad lat/long grid over the lit hemisphere (+Z pole). Returns object and cell centres."""
    bm = bmesh.new()
    dtheta = (math.pi / 2) / RINGS
    dlon = (2 * math.pi) / SEGMENTS
    thetas = []
    theta = math.pi / 2 - lat_offset * dtheta
    while theta > POLE_GAP * dtheta - 1e-9:
        thetas.append(theta)
        theta -= dtheta
    rings = []
    for theta in thetas:
        ring = []
        for i in range(SEGMENTS):
            lon = (i + lon_offset) * dlon
            ring.append(bm.verts.new((
                radius * math.sin(theta) * math.cos(lon),
                radius * math.sin(theta) * math.sin(lon),
                radius * math.cos(theta),
            )))
        rings.append(ring)
    centres = []
    for a, b in zip(rings, rings[1:]):
        for i in range(SEGMENTS):
            face = bm.faces.new((a[i], a[(i + 1) % SEGMENTS], b[(i + 1) % SEGMENTS], b[i]))
            face.smooth = True
            centres.append(face.calc_center_median().normalized() * radius)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    artwork.objects.link(obj)
    obj.data.materials.append(mat)
    wire = obj.modifiers.new("Struts", "WIREFRAME")
    wire.thickness = strut
    wire.use_boundary = True
    wire.use_even_offset = True
    wire.use_replace = True
    wire.use_relative_offset = False
    wire.offset = 0.0
    bevel = obj.modifiers.new("Round", "BEVEL")
    bevel.width = BEVEL
    bevel.segments = 4
    bevel.limit_method = "ANGLE"
    bevel.angle_limit = math.radians(40)
    bevel.harden_normals = True
    return obj, centres


front, front_cells = lattice_shell("02 Front lattice - amber gold", FRONT_R, 0.0, 0.0, STRUT, gold_mat)
rear, rear_cells = lattice_shell("03 Rear lattice - dark bronze", REAR_R, REAR_OFFSET, REAR_OFFSET, REAR_STRUT, rear_mat)

# Verify the pores are open before rotating anything: a ray from outside
# through each cell centre toward the origin must miss the shell.
depsgraph = bpy.context.evaluated_depsgraph_get()
verified = 0
for obj, cells in ((front, front_cells), (rear, rear_cells)):
    evaluated = obj.evaluated_get(depsgraph)
    blocked = 0
    checked = 0
    for centre in cells:
        # Cells within 30 degrees of the pole sit behind the limb and close up
        # naturally as the grid converges; only the visible cells must be open.
        if centre.normalized().z > math.cos(math.radians(30)):
            continue
        checked += 1
        blocked += int(evaluated.ray_cast(centre * 1.5, -centre.normalized())[0])
    print(f"{obj.name}: cells {len(cells)}, checked {checked}, blocked {blocked}")
    if blocked:
        raise RuntimeError(f"{obj.name} has {blocked} filled visible cells")
    verified += checked
print("Verified open cells:", verified)

# Point both grids' poles at the sun.
sun_rotation = SUN.to_track_quat("Z", "Y")
for obj in (front, rear):
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = sun_rotation

bpy.ops.mesh.primitive_uv_sphere_add(segments=256, ring_count=128, radius=BODY_R)
body = bpy.context.object
body.name = "01 Night body"
# Sink the lit hemisphere so the lattice sits in a recess and the silhouette
# stays one circle. The step hides under the terminator strut.
for vertex in body.data.vertices:
    normal = vertex.co.normalized()
    t = min(1.0, max(0.0, (normal.dot(SUN) + 0.02) / 0.04))
    t = t * t * (3 - 2 * t)
    vertex.co = normal * (BODY_R - RECESS * t)
body.data.update()
for col in body.users_collection:
    col.objects.unlink(body)
artwork.objects.link(body)
body.data.materials.append(body_mat)
bpy.ops.object.shade_smooth()

# Icon plate: the rounded square behind the mark, hidden for the hero and mark renders.
PLATE_HALF = 1.45
plate_curve = bpy.data.curves.new("Icon plate", "CURVE")
plate_curve.dimensions = "2D"
plate_curve.fill_mode = "BOTH"
plate_curve.extrude = 0.03
plate_curve.bevel_depth = 0.02
plate_curve.bevel_resolution = 3
spline = plate_curve.splines.new("POLY")
spline.points.add(255)
for index, point in enumerate(spline.points):
    angle = 2 * math.pi * index / 256
    c, s = math.cos(angle), math.sin(angle)
    point.co = (PLATE_HALF * math.copysign(abs(c) ** (2 / 4.6), c), PLATE_HALF * math.copysign(abs(s) ** (2 / 4.6), s), 0, 1)
spline.use_cyclic_u = True
plate = bpy.data.objects.new("00 Icon plate", plate_curve)
plate_col.objects.link(plate)
plate.location.z = -1.22
plate.data.materials.append(plate_mat)

# Wordmark for the hero render, parented to the camera so it stays flat.
font = bpy.data.fonts.load(str(OUT.parent / "JetBrainsMono-Regular.ttf"))
text_curve = bpy.data.curves.new("nyte", "FONT")
text_curve.body = "nyte"
text_curve.font = font
text_curve.size = 0.2
text_curve.space_character = 1.55
text_curve.align_x = "CENTER"
wordmark = bpy.data.objects.new("04 Wordmark", text_curve)
plate_col.objects.link(wordmark)
wordmark.data.materials.append(wordmark_mat)
# The glossy body would otherwise reflect the letters as four stray dots.
wordmark.visible_glossy = False
wordmark.visible_diffuse = False
wordmark.visible_shadow = False


# Lighting ------------------------------------------------------------------
def area(name, location, power, width, height, color=(1, 1, 1), roll=0.0, shape="RECTANGLE"):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = power
    data.shape = shape
    data.size = width
    data.size_y = height
    data.color = color
    obj = bpy.data.objects.new(name, data)
    lighting.objects.link(obj)
    obj.location = location
    look_at(obj, roll=roll)
    return obj


lattices = bpy.data.collections.new("Light link - lattices only")
lattices.objects.link(front)
lattices.objects.link(rear)

area("Sun - warm rim from behind right", tuple(SUN * 6.5), 900, 3.5, 3.5, (1.0, 0.86, 0.62))
gold_light = area("Gold face - warm front right", (2.8, 1.6, 4.4), 220, 2.6, 2.6, (1.0, 0.8, 0.52))
gold_light.light_linking.receiver_collection = lattices
area("Earthshine - cool fill", tuple(FILL * 9), 170, 9.0, 9.0, (0.58, 0.68, 1.0), shape="DISK")
area("Reflection - diagonal strip", (-2.4, 2.6, 3.0), 170, 6.0, 0.5, (0.86, 0.9, 1.0), roll=math.radians(25))

world = scene.world or bpy.data.worlds.new("World")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (*srgb(BG), 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0


# Cameras -------------------------------------------------------------------
def camera(name, location, ortho_scale=None, lens=60):
    data = bpy.data.cameras.new(name)
    obj = bpy.data.objects.new(name, data)
    lighting.objects.link(obj)
    obj.location = location
    look_at(obj)
    if ortho_scale:
        data.type = "ORTHO"
        data.ortho_scale = ortho_scale
    else:
        data.lens = lens
    return obj


front_cam = camera("Front orthographic", (0, 0, 8), ortho_scale=3.5)
orbit_yaw, orbit_pitch = math.radians(-20), math.radians(4)
hero_dir = Vector((math.sin(orbit_yaw) * math.cos(orbit_pitch), math.sin(orbit_pitch), math.cos(orbit_yaw) * math.cos(orbit_pitch)))
hero_cam = camera("Hero three-quarter", tuple(hero_dir * 8.6), lens=78)
look_at(hero_cam, (0, -0.2, 0))
wordmark.parent = hero_cam
wordmark.location = (0, -1.16, -8.6)


# Render settings -----------------------------------------------------------
scene.render.engine = "CYCLES"
scene.cycles.samples = 24 if QUICK else 160
scene.cycles.use_denoising = True
scene.cycles.device = "CPU"
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for device in prefs.devices:
        device.use = device.type != "CPU"
    if any(d.use for d in prefs.devices):
        scene.cycles.device = "GPU"
except Exception as error:  # noqa: BLE001 - fall back to CPU
    print("GPU unavailable, using CPU:", error)
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Punchy"
bpy.context.preferences.filepaths.save_version = 0

print("Artwork objects:", [o.name for o in artwork.objects])
front_eval = front.evaluated_get(bpy.context.evaluated_depsgraph_get())
print("Front lattice faces:", len(front_eval.data.polygons))


def render(name, cam, width, height, transparent, show_plate, show_wordmark):
    scene.camera = cam
    plate.hide_render = not show_plate
    wordmark.hide_render = not show_wordmark
    scene.render.film_transparent = transparent
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.filepath = str(OUT / name)
    started = time.time()
    bpy.ops.render.render(write_still=True)
    print(f"Rendered {name} in {time.time() - started:.1f}s")


scene.camera = front_cam
plate.hide_render = False
wordmark.hide_render = True
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "mesh-moon.blend"))

size = 512 if QUICK else 1024
render("blender-mesh-moon-icon.png", front_cam, size, size, True, True, False)
front_cam.data.ortho_scale = 2.3
render("blender-mesh-moon-mark.png", front_cam, size, size, True, False, False)
front_cam.data.ortho_scale = 0.62
front_cam.location = (0.62, 0.30, 8)
render("blender-mesh-moon-detail.png", front_cam, 768, 768, True, False, False)
render("blender-mesh-moon-hero.png", hero_cam, 800 if QUICK else 1600, 540 if QUICK else 1080, False, False, True)
