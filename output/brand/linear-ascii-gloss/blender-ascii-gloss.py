"""Build a smooth smoky-blue and gold icon with no character texture."""
import json
import math
from pathlib import Path
import bpy
from mathutils import Vector

OUT = Path(__file__).resolve().parent
geometry = json.loads((OUT.parent / 'linear-study' / 'geometry.json').read_text())
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
        shader.inputs['Specular IOR Level'].default_value = 0.025
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
      material('Matte charcoal ceramic', (0.0015, 0.0025, 0.005), 0.0, 0.50))


gold_material = material('Smooth warm gold', (1.0, 0.62, 0.11), 0.55, 0.24)
gold_shader = gold_material.node_tree.nodes.get('Principled BSDF')
gold_shader.inputs['Coat Weight'].default_value = 0.45
gold_shader.inputs['Coat Roughness'].default_value = 0.16
gold = shape('Three smooth gold sections', [[(-x,-y) for x,y in polygon] for polygon in geometry['polygons'][:3]], 0.016, 0.010, 0, gold_material)

# The large cap is one opaque curved surface, with no glyphs below it.
cap_geometry = geometry
outline = [(-x, -y) for x,y in cap_geometry['polygons'][3]]
if outline[0] == outline[-1]:
    outline = outline[:-1]
center_x = sum(p[0] for p in outline)/len(outline)
center_y = sum(p[1] for p in outline)/len(outline)
cap_vertices = []
cap_faces = []
count = len(outline)
ring_count = 20
for ring in range(1, ring_count+1):
    fraction = ring/ring_count
    for x,y in outline:
        x = center_x + (x-center_x)*fraction
        y = center_y + (y-center_y)*fraction
        z = 0.027 + 0.055 * max(0, 1-(x*x+y*y)/0.74**2)
        cap_vertices.append((x,y,z))
for ring in range(ring_count-1):
    for i in range(count):
        j = (i+1)%count
        cap_faces.append((ring*count+i, ring*count+j, (ring+1)*count+j, (ring+1)*count+i))
cap_vertices.append((center_x,center_y,0.027+0.055*max(0,1-(center_x**2+center_y**2)/0.74**2)))
for i in range(count):
    cap_faces.append((len(cap_vertices)-1,(i+1)%count,i))
cap_mesh = bpy.data.meshes.new('Smooth reflective cap surface')
cap_mesh.from_pydata(cap_vertices, [], cap_faces)
cap_mesh.update()
cap = bpy.data.objects.new('Smooth smoky-blue cap',cap_mesh)
artwork.objects.link(cap)
for polygon in cap_mesh.polygons:
    polygon.use_smooth = True


def linear_rgb(hex_color):
    values = [int(hex_color[i:i+2],16)/255 for i in (0,2,4)]
    return tuple(v/12.92 if v<=0.04045 else ((v+0.055)/1.055)**2.4 for v in values)


cap_mat = material('Opaque smoky-blue gloss',linear_rgb('36496b'),0.48,0.18)
cap.data.materials.append(cap_mat)
nodes = cap_mat.node_tree.nodes
links = cap_mat.node_tree.links
body = nodes.get('Principled BSDF')
body.inputs['Coat Weight'].default_value = 0.8
body.inputs['Coat Roughness'].default_value = 0.12
position = nodes.new('ShaderNodeNewGeometry')
dot = nodes.new('ShaderNodeVectorMath')
dot.operation = 'DOT_PRODUCT'
dot.inputs[1].default_value = (-0.4426,-0.5690,0)
links.new(position.outputs['Position'],dot.inputs[0])
add = nodes.new('ShaderNodeMath')
add.operation = 'ADD'
add.inputs[1].default_value = 0.3846
links.new(dot.outputs['Value'],add.inputs[0])
color_ramp = nodes.new('ShaderNodeValToRGB')
color_ramp.color_ramp.elements[0].position = 0
color_ramp.color_ramp.elements[0].color = (*linear_rgb('36496b'),1)
color_ramp.color_ramp.elements[1].position = 1
color_ramp.color_ramp.elements[1].color = (*linear_rgb('090d15'),1)
mid = color_ramp.color_ramp.elements.new(0.55)
mid.color = (*linear_rgb('1c2940'),1)
links.new(add.outputs[0],color_ramp.inputs['Fac'])
links.new(color_ramp.outputs['Color'],body.inputs['Base Color'])
# The Principled material stays fully opaque across the entire cap.
body.inputs['Alpha'].default_value = 1.0
links.new(body.outputs[0],nodes.get('Material Output').inputs['Surface'])
for obj in [base_object, gold]:
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target='MESH')
    if obj == gold:
        bevel = obj.modifiers.new('Clamped fine bevel', 'BEVEL')
        bevel.width = 0.003
        bevel.segments = 4
        bevel.limit_method = 'ANGLE'
        bevel.use_clamp_overlap = True
        bpy.ops.object.modifier_apply(modifier=bevel.name)
        normals = obj.modifiers.new('Smooth face normals', 'WEIGHTED_NORMAL')
        normals.keep_sharp = True
        bpy.ops.object.modifier_apply(modifier=normals.name)
# Four smooth contours share one emblem object and two materials.
bpy.ops.object.select_all(action='DESELECT')
gold.select_set(True)
cap.select_set(True)
bpy.context.view_layer.objects.active = cap
bpy.ops.object.join()
logo = bpy.context.object
logo.name = '02 Smooth emblem - blue cap and three gold sections'
print('Visible artwork objects:',len(artwork.objects))
print('Solid contours: 4; character geometry: 0; lattice geometry: 0')
print('Logo vertices:',len(logo.data.vertices),'Logo faces:',len(logo.data.polygons))


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


area('Key - warm upper-right', (2, 3, 5), 420, 3, 3)
streak = area('Reflection - diagonal strip softbox', (-0.4, -0.3, 3), 45, 3.4, 0.26)
streak.rotation_euler = (0, 0, -math.pi/4)
fill = area('Fill - cool broad left', (-2, 0.5, 4), 100, 3, 4)
fill.data.color = (0.48, 0.63, 1.0)
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
scene.render.filepath = str(OUT / 'blender-ascii-gloss.png')
scene.view_settings.view_transform = 'AgX'
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'ascii-gloss.blend'))
bpy.ops.render.render(write_still=True)
print('Visible artwork objects:', len(artwork.objects))
print('Logo material slots:', len(logo.data.materials))
