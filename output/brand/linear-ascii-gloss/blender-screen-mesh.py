"""Build two fine perforated metal screens with real offset openings."""
import json
import math
from pathlib import Path
import bpy
from mathutils import Vector

OUT = Path(__file__).resolve().parent
geometry = json.loads((OUT / 'screen-geometry.json').read_text())
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
    curve.bevel_resolution = 1
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



def linear_rgb(hex_color):
    values = [int(hex_color[i:i+2],16)/255 for i in (0,2,4)]
    return tuple(v/12.92 if v<=0.04045 else ((v+0.055)/1.055)**2.4 for v in values)


def screen_material(layer, kind):
    rear = layer == 'rear'
    top, bottom = ('516d8c', '0c1829') if kind == 'dark' else ('ffcf39', '9c4f08')
    mat = material(f'{layer} {kind} perforated metal', linear_rgb(top), 0.55 if not rear else 0.2, 0.29 if not rear else 0.55)
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    body = nodes.get('Principled BSDF')
    body.inputs['Coat Weight'].default_value = 0.30 if not rear else 0
    if rear:
        body.inputs['Specular IOR Level'].default_value = 0.08
    body.inputs['Coat Roughness'].default_value = 0.18
    position = nodes.new('ShaderNodeNewGeometry')
    dot = nodes.new('ShaderNodeVectorMath')
    dot.operation = 'DOT_PRODUCT'
    dot.inputs[1].default_value = (-0.4426,-0.5690,0)
    links.new(position.outputs['Position'],dot.inputs[0])
    add = nodes.new('ShaderNodeMath')
    add.operation = 'ADD'
    add.inputs[1].default_value = 0.3846
    links.new(dot.outputs['Value'],add.inputs[0])
    ramp = nodes.new('ShaderNodeValToRGB')
    shade = 0.04 if rear else 1
    ramp.color_ramp.elements[0].color = (*[v*shade for v in linear_rgb(top)],1)
    ramp.color_ramp.elements[1].color = (*[v*shade for v in linear_rgb(bottom)],1)
    links.new(add.outputs[0],ramp.inputs['Fac'])
    links.new(ramp.outputs['Color'],body.inputs['Base Color'])
    return mat


def ring_area(ring):
    return sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(ring,ring[1:]+ring[:1]))/2


screens = []
hole_centers = []
for group in geometry['groups']:
    polygons = [group['geometry']['coordinates']] if group['geometry']['type'] == 'Polygon' else group['geometry']['coordinates']
    rings = []
    centers = []
    for polygon in polygons:
        for index, source_ring in enumerate(polygon):
            ring = source_ring[:-1] if source_ring[0] == source_ring[-1] else source_ring
            area = ring_area(ring)
            if (area > 0) != (index == 0):
                ring = list(reversed(ring))
            rings.append(ring)
            if index > 0:
                area = ring_area(ring)
                cx = sum((a[0]+b[0])*(a[0]*b[1]-b[0]*a[1]) for a,b in zip(ring,ring[1:]+ring[:1]))/(6*area)
                cy = sum((a[1]+b[1])*(a[0]*b[1]-b[0]*a[1]) for a,b in zip(ring,ring[1:]+ring[:1]))/(6*area)
                centers.append((cx,cy))
    # The supplied separation is measured against the two-unit, 1024px icon base.
    height = 0.020 if group['layer'] == 'front' else 0.020-geometry['separation']*2/1024
    obj = shape(f"{group['layer']} {group['kind']} screen",rings,height-0.0011,0.0009,0.0002,screen_material(group['layer'],group['kind']))
    screens.append(obj)
    hole_centers.append(centers)

for obj in [base_object,*screens]:
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target='MESH')

verified = 0
for obj, centers in zip(screens,hole_centers):
    passed = sum(not obj.ray_cast(Vector((x,y,1)),Vector((0,0,-1)))[0] for x,y in centers)
    print(obj.name,'holes',len(centers),'verified open',passed)
    if passed != len(centers):
        raise RuntimeError(f'{obj.name} has filled pores')
    verified += passed
    obj.rotation_euler.z = math.pi
bpy.ops.object.select_all(action='DESELECT')
for obj in screens:
    obj.select_set(True)
bpy.context.view_layer.objects.active = screens[0]
bpy.ops.object.join()
emblem = bpy.context.object
emblem.name = '02 Emblem - two offset perforated screens'
bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
for vertex in emblem.data.vertices:
    radius_squared = vertex.co.x**2+vertex.co.y**2
    vertex.co.z += 0.025*max(0,1-radius_squared/0.74**2)
emblem.data.update()
print('Total verified openings:',verified)
print('Visible artwork objects:',len(artwork.objects))
print('Emblem vertices:',len(emblem.data.vertices),'Emblem faces:',len(emblem.data.polygons))
print('Material slots:',len(emblem.data.materials))


def area(name, location, power, width, height):
    data = bpy.data.lights.new(name,'AREA')
    data.energy = power
    data.shape = 'RECTANGLE'
    data.size = width
    data.size_y = height
    obj = bpy.data.objects.new(name,data)
    lighting.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (-obj.location).to_track_quat('-Z','Y').to_euler()
    return obj


area('Key - upper-left broad softbox',(-0.7,1.8,4),320,4,3)
warm = area('Warm gold reflection',(2,2,4),70,3,3)
warm.data.color = (1,0.87,0.64)
fill = area('Cool lower fill',(-1,-2,3),35,3,3)
fill.data.color = (0.52,0.67,1)
scene = bpy.context.scene
scene.world.color = (0.12,0.12,0.12)
data = bpy.data.cameras.new('Front orthographic')
camera = bpy.data.objects.new('Front orthographic',data)
lighting.objects.link(camera)
camera.location = (0,0,6)
camera.rotation_euler = (Vector((0,0,0))-camera.location).to_track_quat('-Z','Y').to_euler()
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
scene.view_settings.view_transform = 'AgX'
scene.render.filepath = str(OUT/'blender-screen-mesh.png')
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'screen-mesh.blend'))
bpy.ops.render.render(write_still=True)
# Render a second actual-camera close view to show pore walls and rear-layer offset.
camera.location = (0.25,0.24,6)
data.ortho_scale = 0.66
scene.render.resolution_x = 768
scene.render.resolution_y = 768
scene.render.filepath = str(OUT/'blender-screen-mesh-detail.png')
bpy.ops.render.render(write_still=True)
