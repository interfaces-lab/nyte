"""Build the official Linear mark as two editable visible geometry objects."""
import json
import math
from pathlib import Path
import bpy
from mathutils import Vector

OUT = Path(__file__).resolve().parent
geometry = json.loads((OUT / 'geometry.json').read_text())
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for collection in list(bpy.data.collections):
    bpy.data.collections.remove(collection)
artwork = bpy.data.collections.new('Artwork - 2 visible objects')
lighting = bpy.data.collections.new('Lighting')
bpy.context.scene.collection.children.link(artwork)
bpy.context.scene.collection.children.link(lighting)


def material(name, color, metallic, roughness):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Metallic'].default_value = metallic
    shader.inputs['Roughness'].default_value = roughness
    if name == 'Matte charcoal ceramic':
        shader.inputs['Specular IOR Level'].default_value = 0.18
    return mat


def shape(name, polygons, center, extrude, bevel, mat):
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '2D'
    curve.fill_mode = 'BOTH'
    curve.resolution_u = 16
    curve.extrude = extrude
    curve.bevel_depth = bevel
    curve.bevel_resolution = 4
    for polygon in polygons:
        spline = curve.splines.new('POLY')
        spline.points.add(len(polygon) - 1)
        for point, (x, y) in zip(spline.points, polygon):
            point.co = (x, y, 0, 1)
        spline.use_cyclic_u = True
    obj = bpy.data.objects.new(name, curve)
    artwork.objects.link(obj)
    obj.location.z = center
    obj.data.materials.append(mat)
    return obj


base = []
for index in range(256):
    angle = 2 * math.pi * index / 256
    c, s = math.cos(angle), math.sin(angle)
    base.append((math.copysign(abs(c)**(2/4.6), c), math.copysign(abs(s)**(2/4.6), s)))
shape('01 Base - matte charcoal', [base], -0.055, 0.035, 0.02,
      material('Matte charcoal ceramic', (0.005, 0.006, 0.008), 0.0, 0.46))
shape('02 Linear logo - four official contours', geometry['polygons'], 0.014, 0.009, 0.0035,
      material('Satin silver', (0.88, 0.89, 0.91), 0.65, 0.30))


def area(name, location, power, width, height):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy = power
    data.shape = 'RECTANGLE'
    data.size = width
    data.size_y = height
    obj = bpy.data.objects.new(name, data)
    lighting.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (-obj.location).to_track_quat('-Z', 'Y').to_euler()
    return obj


area('Key - upper-left softbox', (-0.7, 2, 4), 420, 4, 4)
area('Fill - broad right', (2, -1, 4), 70, 3, 4)
scene = bpy.context.scene
scene.world.color = (0.16, 0.16, 0.16)
data = bpy.data.cameras.new('Front orthographic')
camera = bpy.data.objects.new('Front orthographic', data)
lighting.objects.link(camera)
camera.location = (0, 0, 6)
camera.rotation_euler = (Vector((0, 0, 0)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
data.type = 'ORTHO'
data.ortho_scale = 2.28
scene.camera = camera
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 64
scene.cycles.use_denoising = True
scene.render.resolution_x = 1024
scene.render.resolution_y = 1024
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.film_transparent = True
scene.render.filepath = str(OUT / 'blender-linear.png')
scene.view_settings.view_transform = 'AgX'
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'linear-two-layer.blend'))
bpy.ops.render.render(write_still=True)
print('Visible artwork objects:', len(artwork.objects))
print('Logo contours:', len(geometry['polygons']))
