# Linear two-layer recreation

Open `index.html` directly in a browser.

## Deliverables

- `linear-two-layer.blend`: recreated icon with exactly two visible geometry objects, base and logo. Camera and lights are in a separate collection.
- `blender-linear.png`: 1024px headless Blender render.
- `blender-linear.py`: reproducible scene construction and render script.
- `linear-two-layer-icon.svg`: icon artwork with two named visual groups, one base rectangle and one compound logo path. Shading uses SVG gradients and filters, without embedded images.
- `linear-logo.svg`: clean one-path dark logo from the official geometry.
- `linear-logo-export.svg`: verified editor logo-only export.
- `official-source.svg`: source from https://linear.app/static/favicon.svg.

## Direct selection editor

Select the logo or base from the layer list or artwork. Drag to move; corner handles resize; the top handle rotates. Arrow keys nudge one unit, Shift+arrow ten. Shift constrains rotation to 15-degree increments and constrains movement to one axis. Escape deselects.

The properties panel edits x/y, width/height, rotation, visibility, fill, corner rounding, logo depth, bevel width, face reflection, contact shadow, and light direction. Proportion locking, layer centering, resets, zoom, and browser-local persistence are included. The Blender render tab provides the rendered reference. It is a static reference and does not rerender when SVG properties change.

Export icon SVG omits selection outlines and controls. Logo SVG exports one path. The SVG retains the official curves exactly; the Blender scene samples those same curves into four closed contours in one object. SVG lighting is a scalable approximation of the Blender material and lighting, not an embedded Blender render or an automatic raster-to-vector conversion.

## Verification

Browser checks cover layer selection, move, corner resize, rotation handle, keyboard nudge, numeric/material input, persistence, visibility, Blender reference, icon and logo SVG downloads, and mobile overflow. Export parsing confirms two visual groups in the icon and one path in the flat logo, with no bitmap or selection UI.

This study remains separate from Nyte's production assets.
