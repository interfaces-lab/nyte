# Rotated yellow mesh study

The three smaller sections are yellow lattice with actual openings. The large cap stays smooth silver. Both are rotated 180 degrees from the original Linear arrangement, putting the smaller sections at the upper right.

## Files

- [Blender scene](yellow-mesh.blend)
- [1024 px PNG](blender-yellow-mesh.png)
- [Reproduction script](blender-yellow-mesh.py)

Run from the repository root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python output/brand/linear-yellow-mesh/blender-yellow-mesh.py
```

The script reads the prepared `geometry.json` beside it. The yellow geometry uses its diagonal crossbars and perimeter rings without changing the supplied spacing of 0.13, rod width of 0.035, or rim width of 0.012 world units.

## Editable geometry

The Artwork collection contains exactly two visible objects, both actual Blender meshes. The base is one mesh. The silver cap and yellow sections share a second mesh with two material slots. The logo has 54,768 vertices and 50,968 faces, including its beveled sidewalls.

The prepared MultiPolygon contains 32 holes. The script creates closed exterior and interior curve rings with opposing winding, extrudes them, then converts them into real mesh geometry. It casts a ray through each hole before joining the cap and yellow sections. All 32 rays passed through without hitting yellow geometry. The rendered PNG was also inspected to confirm open holes, separate stripe sections, and the upper-right orientation.

The logo has 0.018-unit straight extrusion. Yellow bevel radius is 0.0018; silver bevel radius is 0.0035. The logo is shallow above a charcoal rounded-square base. Its camera, key light, and fill light are in a separate Lighting collection.

The render uses Cycles CPU, 64 samples, denoising, and a transparent exterior. Rendering took about seven seconds on this machine. Neither the original Linear study nor the SVG editor was changed.
