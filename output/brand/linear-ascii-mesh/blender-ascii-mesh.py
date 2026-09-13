"""Build rotated silver cap and outlined ASCII glyphs as two editable meshes."""
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
        if polygon[0] == polygon[-1]:
            polygon = polygon[:-1]
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
base_object = shape('01 Base - matte charcoal', [base], -0.055, 0.035, 0.02,
      material('Matte charcoal ceramic', (0.005, 0.006, 0.008), 0.0, 0.46))
cap = shape('Silver smooth cap', [geometry['capPolygon']], 0.014, 0.009, 0.0035,
      material('Satin silver', (0.88, 0.89, 0.91), 0.65, 0.30))


def ring_area(ring):
    return sum(a[0]*b[1] - b[0]*a[1] for a, b in zip(ring, ring[1:] + ring[:1])) / 2


glyph_objects = []
source_polygons = 0
for group in geometry['groups']:
    rings = []
    for polygon in group['geometry']['coordinates']:
        source_polygons += 1
        for index, source_ring in enumerate(polygon):
            ring = source_ring[:-1] if source_ring[0] == source_ring[-1] else source_ring
            area = ring_area(ring)
            if (area > 0) != (index == 0):
                ring = list(reversed(ring))
            rings.append(ring)
    mat = material(f"Yellow ASCII brightness {group['brightness']}", group['color'], 0.1, 0.4)
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Emission Color'].default_value = (*group['color'], 1)
    shader.inputs['Emission Strength'].default_value = 0.12
    glyph_objects.append(shape(f"ASCII glyphs level {group['brightness']}", rings, 0.023, 0.001, 0, mat))

for obj in [base_object, cap, *glyph_objects]:
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target='MESH')
    for polygon in obj.data.polygons:
        polygon.use_smooth = False

for obj in [cap, *glyph_objects]:
    obj.rotation_euler.z = math.pi
bpy.ops.object.select_all(action='DESELECT')
for obj in [cap, *glyph_objects]:
    obj.select_set(True)
bpy.context.view_layer.objects.active = cap
bpy.ops.object.join()
logo = bpy.context.object
logo.name = '02 Logo - silver cap and 911 outlined ASCII glyphs'
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
print('Source glyph count:', geometry['glyphCount'])
print('Source glyph polygon components:', source_polygons)
print('Visible artwork objects:', len(artwork.objects))
print('Logo vertices:', len(logo.data.vertices), 'Logo faces:', len(logo.data.polygons))
print('Artwork object types:', [obj.type for obj in artwork.objects])


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
scene.render.filepath = str(OUT / 'blender-ascii-mesh.png')
scene.view_settings.view_transform = 'AgX'
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'ascii-mesh.blend'))
bpy.ops.render.render(write_still=True)
print('Visible artwork objects:', len(artwork.objects))
print('Logo material slots:', len(logo.data.materials))
