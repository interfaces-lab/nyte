# Yellow mesh phase

A separate version of the two-layer Linear study. The emblem rotates 180 degrees so its three smaller sections sit at the upper right. Those sections become yellow lattice; the large cap remains smooth silver.

## Blender

`yellow-mesh.blend` contains exactly two visible MESH objects: the dark base and the combined cap/lattice emblem. Two material slots distinguish silver and yellow. The yellow sections have 32 real through-holes, verified by ray casts before joining. See `blender-notes.md` for geometry and render details.

`blender-yellow-mesh.py` rebuilds the scene from `geometry.json`, and `blender-yellow-mesh.png` is the 1024px render.

## SVG and editor

Open `index.html` directly. The Figma-style selection handles remain available for moving, resizing and rotating the emblem or base. New controls adjust lattice spacing, strand thickness, perimeter thickness, and yellow material color. Settings persist separately from the original editor.

`yellow-mesh-icon.svg` is the two-layer icon export; `yellow-mesh-logo.svg` is the transparent emblem export. Both use SVG geometry, clipping, gradients and filters, with no embedded bitmap or font dependency. The SVG is an adjustable interpretation of the Blender mesh and does not dynamically rebuild the Blender scene when edited.

The original `../linear-study/` is preserved. This derivative study has not replaced Nyte's application assets.

Browser verification covered rotation, mesh controls, persistence, layer selection, the Blender reference, export validity and mobile overflow.
