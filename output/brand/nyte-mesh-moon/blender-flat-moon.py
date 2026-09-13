"""Nyte mesh moon, macOS icon build.

Flat layers on a plate, shot straight on, the way the Linear icon is built:
a shallow glossy disc for the night side, and the crescent as two thin
perforated gold sheets raised a hair above it. The pore pattern is the
sun-aligned sphere lattice projected onto the icon plane. Run from the
repo root:

  /Applications/Blender.app/Contents/MacOS/Blender --background \
      --python output/brand/nyte-mesh-moon/blender-flat-moon.py

Set NYTE_QUICK=1 for a low-sample half-size pass.
"""
import math
import os
import time
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

OUT = Path(__file__).resolve().parent
QUICK = os.environ.get("NYTE_QUICK") == "1"

BG = "0a0c12"
AMBER = ("5a3e18", "ffc96b", "fff3dc")

# Icon geometry (plate half-width is 1.0, camera ortho scale 2.28) ---------
MOON_R = 0.66            # disc radius on the plate
DOME = 0.030             # shallow dome across the disc, like the gloss cap
DISC_T = 0.022           # disc thickness
SHEET_T = 0.0045         # each perforated sheet
SHEET_GAP = 0.0025       # air between rear and front sheet
SEGMENTS = 96            # lattice longitude divisions (3.75 degrees)
RINGS = 24               # latitude divisions from terminator to pole
STRUT = 0.0105           # front strut width on the icon plane
REAR_STRUT = 0.0085
REAR_OFFSET = 0.32       # rear grid offset, in cells, both directions
MIN_PORE = 0.006         # drop pores narrower than this (foreshortened at the limb)
BEVEL = 0.0012

SUN = Vector((0.8, 0.3, -0.3)).normalized()
FILL = Vector((-0.4, 0.5, 0.75)).normalized()


def srgb(hex_color):
    values = [int(hex_color[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in values)


def look_at(obj, target=(0, 0, 0), roll=0.0):
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
lighting = bpy.data.collections.new("Lighting")
scene.collection.children.link(artwork)
scene.collection.children.link(lighting)


# Materials -----------------------------------------------------------------
def principled(name, color, metallic, roughness, coat=0.0, coat_roughness=0.15, specular=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Coat Weight"].default_value = coat
    bsdf.inputs["Coat Roughness"].default_value = coat_roughness
    if specular is not None:
        bsdf.inputs["Specular IOR Level"].default_value = specular
    return mat


def ramp_along(mat, direction, low, high, stops):
    """Base colour ramped by (object position . direction) mapped low..high -> 0..1."""
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    coords = nodes.new("ShaderNodeTexCoord")
    dot = nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    dot.inputs[1].default_value = tuple(Vector(direction).normalized())
    links.new(coords.outputs["Object"], dot.inputs[0])
    mapper = nodes.new("ShaderNodeMapRange")
    mapper.inputs["From Min"].default_value = low
    mapper.inputs["From Max"].default_value = high
    links.new(dot.outputs["Value"], mapper.inputs["Value"])
    ramp = nodes.new("ShaderNodeValToRGB")
    elements = ramp.color_ramp.elements
    while len(elements) < len(stops):
        elements.new(0.5)
    for element, (pos, color) in zip(elements, stops):
        element.position = pos
        element.color = (*color, 1)
    links.new(mapper.outputs["Result"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], nodes["Principled BSDF"].inputs["Base Color"])


plate_mat = principled("Plate - matte night", srgb("12151f"), 0.0, 0.45, specular=0.05)
ramp_along(plate_mat, (-0.3, 1.0, 0), -1.0, 1.0, [(0.0, srgb("0c0e15")), (1.0, srgb("161a27"))])

disc_mat = principled("Disc - glossy graphite blue", srgb("1a2136"), 0.48, 0.18, coat=0.8, coat_roughness=0.12)
ramp_along(disc_mat, (-0.55, 0.65, 0), -MOON_R, MOON_R,
           [(0.0, srgb("0b0f1a")), (0.5, srgb("18203a")), (1.0, srgb("34446e"))])

sun_xy = Vector((SUN.x, SUN.y, 0)).normalized()
gold_mat = principled("Front sheet - amber gold", srgb(AMBER[1]), 0.72, 0.30, coat=0.3, coat_roughness=0.18)
ramp_along(gold_mat, sun_xy, MOON_R * 0.25, MOON_R,
           [(0.0, srgb("a8661a")), (0.5, srgb("f2b84c")), (1.0, srgb("ffd07a"))])

rear_mat = principled("Rear sheet - dark bronze", srgb("4a2f10"), 0.35, 0.5, specular=0.2)
ramp_along(rear_mat, sun_xy, MOON_R * 0.25, MOON_R,
           [(0.0, srgb("2a1a06")), (1.0, srgb("6a4618"))])


# 2D geometry ---------------------------------------------------------------
def ring_area(ring):
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:] + ring[:1])) / 2


def ccw(ring):
    return ring if ring_area(ring) > 0 else list(reversed(ring))


def inset(poly, d):
    """Inset a convex CCW polygon by d. Returns None when it collapses."""
    n = len(poly)
    lines = []
    for k in range(n):
        a, b = Vector(poly[k]), Vector(poly[(k + 1) % n])
        edge = b - a
        if edge.length < 1e-9:
            return None
        normal = Vector((-edge.y, edge.x)).normalized()
        lines.append((a + normal * d, edge.normalized()))
    result = []
    for k in range(n):
        (p1, d1), (p2, d2) = lines[k - 1], lines[k]
        cross = d1.x * d2.y - d1.y * d2.x
        if abs(cross) < 1e-9:
            return None
        t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / cross
        result.append(tuple(p1 + d1 * t))
    if ring_area(result) <= 0 or ring_area(result) >= ring_area(poly):
        return None
    for k in range(n):
        a, b, c = Vector(result[k]), Vector(result[(k + 1) % n]), Vector(result[(k + 2) % n])
        if (b - a).length < MIN_PORE:
            return None
        if (b - a).cross(c - b) <= 0:  # must stay convex and CCW
            return None
        # every inset vertex must sit inside the original cell
        for m in range(n):
            p1, p2 = Vector(poly[m]), Vector(poly[(m + 1) % n])
            if (p2 - p1).cross(a - p1) <= 0:
                return None
    return result


# Sphere frame with the pole at the sun.
axis_a = (Vector((0, 1, 0)) - SUN * SUN.y).normalized()
axis_b = SUN.cross(axis_a)


def on_sphere(theta, lon):
    return (axis_a * math.cos(lon) + axis_b * math.sin(lon)) * math.sin(theta) + SUN * math.cos(theta)


def project(p):
    return (p.x * MOON_R, p.y * MOON_R)


def pores(lon_offset, lat_offset, strut):
    dtheta = (math.pi / 2) / RINGS
    dlon = (2 * math.pi) / SEGMENTS
    rings = []
    total = 0
    for j in range(RINGS):
        theta_a = math.pi / 2 - (j + lat_offset) * dtheta
        theta_b = theta_a - dtheta
        if theta_b < 0:
            break
        for i in range(SEGMENTS):
            lon_a = (i + lon_offset) * dlon
            lon_b = lon_a + dlon
            corners = [on_sphere(theta_a, lon_a), on_sphere(theta_a, lon_b), on_sphere(theta_b, lon_b), on_sphere(theta_b, lon_a)]
            if any(c.z < 0.012 for c in corners):
                continue
            total += 1
            quad = ccw([project(c) for c in corners])
            hole = inset(quad, strut / 2)
            if hole is None:
                continue
            # Keep a solid rim along the limb and skip slivers the bevel would close.
            if max(math.hypot(x, y) for x, y in hole) > MOON_R - strut * 1.5:
                continue
            if ring_area(hole) < MIN_PORE ** 2:
                continue
            rings.append(hole)
    return rings, total


def crescent_outline(samples=720):
    """The lit, visible part of the disc: terminator arc plus limb arc."""
    terminator = []
    for k in range(samples):
        t = 2 * math.pi * k / samples
        p = axis_a * math.cos(t) + axis_b * math.sin(t)
        terminator.append(p)
    # Rotate the list so the visible run (z > 0) is contiguous from its start.
    start = next(k for k in range(samples) if terminator[k - 1].z <= 0 < terminator[k].z)
    ordered = terminator[start:] + terminator[:start]
    term_arc = [p for p in ordered if p.z > 0]
    limb = []
    for k in range(samples):
        phi = 2 * math.pi * k / samples
        limb.append(Vector((math.cos(phi), math.sin(phi), 0)))
    start = next(k for k in range(samples) if limb[k - 1].dot(SUN) <= 0 < limb[k].dot(SUN))
    ordered = limb[start:] + limb[:start]
    limb_arc = [p for p in ordered if p.dot(SUN) > 0]
    if (term_arc[-1] - limb_arc[0]).length > (term_arc[-1] - limb_arc[-1]).length:
        limb_arc.reverse()
    return ccw([project(p) for p in term_arc + limb_arc])


def superellipse(half, n=256, exponent=4.6):
    ring = []
    for k in range(n):
        angle = 2 * math.pi * k / n
        c, s = math.cos(angle), math.sin(angle)
        ring.append((half * math.copysign(abs(c) ** (2 / exponent), c), half * math.copysign(abs(s) ** (2 / exponent), s)))
    return ring


def circle(r, n=256):
    return [(r * math.cos(2 * math.pi * k / n), r * math.sin(2 * math.pi * k / n)) for k in range(n)]


def shape(name, rings, z_center, extrude, bevel, mat):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "2D"
    curve.fill_mode = "BOTH"
    curve.resolution_u = 12
    curve.extrude = extrude
    curve.bevel_depth = bevel
    curve.bevel_resolution = 2
    for index, ring in enumerate(rings):
        ring = ccw(ring) if index == 0 else list(reversed(ccw(ring)))
        spline = curve.splines.new("POLY")
        spline.points.add(len(ring) - 1)
        for point, (x, y) in zip(spline.points, ring):
            point.co = (x, y, 0, 1)
        spline.use_cyclic_u = True
    obj = bpy.data.objects.new(name, curve)
    artwork.objects.link(obj)
    obj.location.z = z_center
    obj.data.materials.append(mat)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    # Smooth within the caps and bevels, hard between cap and wall, so the
    # long fill triangles never pick up wall normals.
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))
    except AttributeError:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(35))
    return obj


plate = shape("00 Plate", [superellipse(1.0)], -0.055, 0.035, 0.02, plate_mat)
disc = shape("01 Night disc", [circle(MOON_R)], DISC_T / 2, DISC_T / 2, 0.004, disc_mat)

outline = crescent_outline()
front_holes, front_cells = pores(0.0, 0.0, STRUT)
rear_holes, rear_cells = pores(REAR_OFFSET, REAR_OFFSET, REAR_STRUT)
print(f"front pores {len(front_holes)} of {front_cells} cells, rear pores {len(rear_holes)} of {rear_cells} cells")

rear_z = DISC_T + SHEET_T / 2
front_z = DISC_T + SHEET_T + SHEET_GAP + SHEET_T / 2
rear = shape("02 Rear sheet - dark bronze", [outline, *rear_holes], rear_z, SHEET_T / 2, BEVEL * 0.7, rear_mat)
front = shape("03 Front sheet - amber gold", [outline, *front_holes], front_z, SHEET_T / 2, BEVEL, gold_mat)

# Verify every pore is open with a ray straight down through its centroid.
verified = 0
for obj, holes in ((front, front_holes), (rear, rear_holes)):
    blocked = 0
    for ring in holes:
        cx = sum(x for x, _ in ring) / len(ring)
        cy = sum(y for _, y in ring) / len(ring)
        blocked += int(obj.ray_cast(Vector((cx, cy, 1)), Vector((0, 0, -1)))[0])
    print(f"{obj.name}: pores {len(holes)}, blocked {blocked}")
    if blocked:
        raise RuntimeError(f"{obj.name} has {blocked} filled pores")
    verified += len(holes)
print("Verified open pores:", verified)

# A shallow dome across the disc and both sheets, so the gloss reflection
# reads as one broad band and the layers stay parallel.
DOME_R2 = (MOON_R * 1.05) ** 2
for obj in (disc, rear, front):
    mesh = obj.data
    for vertex in mesh.vertices:
        r2 = vertex.co.x ** 2 + vertex.co.y ** 2
        vertex.co.z += DOME * max(0.0, 1 - r2 / DOME_R2)
    mesh.update()
    # Analytic dome normals on the caps. The fill makes long thin triangles
    # from the outline to the pores, and interpolated normals streak across
    # them; custom normals from the dome function do not.
    normals = []
    for poly in mesh.polygons:
        for loop_index in poly.loop_indices:
            if poly.normal.z > 0.9:
                v = mesh.vertices[mesh.loops[loop_index].vertex_index].co
                slope = 2 * DOME / DOME_R2 if v.x ** 2 + v.y ** 2 < DOME_R2 else 0.0
                normals.append(Vector((v.x * slope, v.y * slope, 1.0)).normalized())
            elif poly.normal.z < -0.9:
                normals.append(Vector((0, 0, -1)))
            else:
                normals.append(Vector(mesh.corner_normals[loop_index].vector))
    mesh.normals_split_custom_set(normals)

print("Artwork objects:", [o.name for o in artwork.objects])
print("Front sheet faces:", len(front.data.polygons))


# Lighting ------------------------------------------------------------------
def area(name, location, power, width, height, color=(1, 1, 1), roll=0.0, shape_kind="RECTANGLE"):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = power
    data.shape = shape_kind
    data.size = width
    data.size_y = height
    data.color = color
    obj = bpy.data.objects.new(name, data)
    lighting.objects.link(obj)
    obj.location = location
    look_at(obj, roll=roll)
    return obj


sheets = bpy.data.collections.new("Light link - sheets only")
sheets.objects.link(front)
sheets.objects.link(rear)

area("Key - upper-left broad softbox", (-0.9, 1.9, 4.0), 300, 4.0, 3.0, (0.94, 0.96, 1.0))
warm = area("Warm gold - upper right", (2.0, 1.6, 3.8), 120, 3.0, 3.0, (1.0, 0.85, 0.6))
warm.light_linking.receiver_collection = sheets
area("Cool lower fill", (-1.2, -2.0, 3.0), 30, 3.0, 3.0, (0.52, 0.67, 1.0))
area("Reflection - diagonal strip", (-1.3, 1.5, 2.4), 95, 3.4, 0.26, (0.88, 0.92, 1.0), roll=math.radians(38))

world = scene.world or bpy.data.worlds.new("World")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.10, 0.10, 0.11, 1)

# Camera --------------------------------------------------------------------
cam_data = bpy.data.cameras.new("Front orthographic")
camera = bpy.data.objects.new("Front orthographic", cam_data)
lighting.objects.link(camera)
camera.location = (0, 0, 6)
camera.rotation_euler = (0, 0, 0)
cam_data.type = "ORTHO"
cam_data.ortho_scale = 2.28
scene.camera = camera

# Render --------------------------------------------------------------------
scene.render.engine = "CYCLES"
scene.cycles.samples = 32 if QUICK else 192
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
except Exception as error:  # noqa: BLE001
    print("GPU unavailable, using CPU:", error)
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.film_transparent = True
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Punchy"
scene.render.filter_size = 1.5
bpy.context.preferences.filepaths.save_version = 0


def render(name, size_x, size_y):
    scene.render.resolution_x = size_x
    scene.render.resolution_y = size_y
    scene.render.filepath = str(OUT / name)
    started = time.time()
    bpy.ops.render.render(write_still=True)
    print(f"Rendered {name} in {time.time() - started:.1f}s")


bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "flat-moon.blend"))
size = 512 if QUICK else 1024
render("blender-flat-moon-icon.png", size, size)
plate.hide_render = True
cam_data.ortho_scale = MOON_R * 2.2
render("blender-flat-moon-mark.png", size, size)
plate.hide_render = False
cam_data.ortho_scale = 0.46
camera.location = (MOON_R * 0.72, MOON_R * 0.18, 6)
render("blender-flat-moon-detail.png", 768, 768)
