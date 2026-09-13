"""Render a shallow Nyte crossed-band relief, with editable Blender geometry."""
import math
from pathlib import Path
import bpy
from mathutils import Vector
from mathutils.geometry import tessellate_polygon

OUT = Path(__file__).resolve().parent
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)


def material(name, color, metallic, roughness):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Metallic'].default_value = metallic
    shader.inputs['Roughness'].default_value = roughness
    return mat


base_mat = material('Charcoal ceramic', (0.005, 0.006, 0.008), 0.12, 0.40)
gold_mat = material('Pale gold satin', (0.96, 0.67, 0.22), 0.48, 0.24)
back_mat = material('Warm gold lower bands', (0.72, 0.43, 0.09), 0.45, 0.30)


def solid(name, polygon, bottom, top, mat, bevel):
    size = len(polygon)
    vertices = [(x, y, bottom) for x, y in polygon] + [(x, y, top) for x, y in polygon]
    top_vectors = [Vector((x, y, top)) for x, y in polygon]
    triangles = tessellate_polygon([top_vectors])
    faces = [tuple(i + size for i in triangle) for triangle in triangles]
    faces += [tuple(i - size for i in reversed(face)) for face in faces.copy()]
    faces += [(i, (i + 1) % size, (i + 1) % size + size, i + size) for i in range(size)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    obj.select_set(False)
    modifier = obj.modifiers.new('Fine edge catch', 'BEVEL')
    modifier.width = bevel
    modifier.segments = 4
    modifier.limit_method = 'ANGLE'
    modifier.angle_limit = 0.15
    modifier = obj.modifiers.new('Face normals', 'WEIGHTED_NORMAL')
    modifier.keep_sharp = True
    return obj


base_points = []
for index in range(192):
    angle = index * 2 * math.pi / 192
    c, s = math.cos(angle), math.sin(angle)
    base_points.append((math.copysign(abs(c) ** (2 / 4.6), c), math.copysign(abs(s) ** (2 / 4.6), s)))
solid('Rounded charcoal base', base_points, -0.09, 0, base_mat, 0.018)

radius = 0.66
circle = [(radius * math.cos(i * 2 * math.pi / 256), radius * math.sin(i * 2 * math.pi / 256)) for i in range(256)]


def clip_polygon(points):
    # Clip the sampled quadratic band against a convex circular boundary.
    for i, a in enumerate(circle):
        b = circle[(i + 1) % len(circle)]
        output = []
        if not points:
            return []
        previous = points[-1]
        def side(p):
            return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
        for current in points:
            before, after = side(previous), side(current)
            if (before >= 0) != (after >= 0):
                t = before / (before - after)
                output.append((previous[0] + t * (current[0] - previous[0]), previous[1] + t * (current[1] - previous[1])))
            if after >= 0:
                output.append(current)
            previous = current
        points = output
    return points


for family, angle in enumerate([135, 45]):
    for index in range(3):
        position = (index - 1) * radius * 0.86 * 0.73
        thickness = radius * 2 * 0.15
        end = position * (1 - 0.08 * 2.25)
        control = 2 * position - end
        points = []
        for side, samples in [(-1, range(49)), (1, range(48, -1, -1))]:
            for sample in samples:
                t = sample / 48
                x = -radius * 1.5 + radius * 3 * t
                y = (1-t)**2 * end + 2*(1-t)*t*control + t*t*end + side * thickness/2
                theta = math.radians(angle)
                points.append((x*math.cos(theta) - y*math.sin(theta), x*math.sin(theta) + y*math.cos(theta)))
        points = clip_polygon(points)
        solid(f'Band {family + 1}-{index + 1}', points, 0.001 if family == 0 else 0.027, 0.026 if family == 0 else 0.044, back_mat if family == 0 else gold_mat, 0.003)


def area(name, location, power, size, color):
    light = bpy.data.lights.new(name, 'AREA')
    light.energy = power
    light.shape = 'DISK'
    light.size = size
    light.color = color
    obj = bpy.data.objects.new(name, light)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (-obj.location).to_track_quat('-Z', 'Y').to_euler()


area('Large upper-left softbox', (-2.6, 3.6, 4.5), 500, 4.2, (1.0, 0.94, 0.81))
area('Quiet right fill', (3.0, -1.0, 3.0), 90, 3.5, (0.83, 0.9, 1.0))
scene = bpy.context.scene
scene.world.color = (0.11, 0.11, 0.11)
camera_data = bpy.data.cameras.new('Orthographic icon camera')
camera = bpy.data.objects.new('Orthographic icon camera', camera_data)
bpy.context.collection.objects.link(camera)
camera.location = (0, -0.1, 6)
camera.rotation_euler = (Vector((0, 0, 0)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera_data.type = 'ORTHO'
camera_data.ortho_scale = 2.24
scene.camera = camera
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 40
scene.cycles.use_denoising = True
scene.render.resolution_x = 768
scene.render.resolution_y = 768
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.film_transparent = True
scene.view_settings.view_transform = 'AgX'
scene.render.filepath = str(OUT / 'nyte-relief-study.png')
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'nyte-relief-study.blend'))
bpy.ops.render.render(write_still=True)
