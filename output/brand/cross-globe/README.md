# Nyte cross globe

Open `index.html` directly in a browser. The editor now follows the supplied Linear finish references: shallow raised bands, fine directional bevels, a quiet matte tile, and close soft shadows. Nyte retains its own crossed-band geometry.

## Adjustable SVG

The default is three primary bands and two crossing bands at 45 and 135 degrees. Controls cover both band counts, angles, width, spacing, curvature, mark size, relief depth, bevel width, light direction, shadow, face reflection, bevel highlight, crossing separation, palette, and over/under order. Presets include satin gold, silver, smoked glass, graphic, and open globe. Drag or arrow keys rotate the mark.

Settings persist under `nyte-cross-globe-relief-v2`. The earlier glass editor's saved values remain untouched under their previous key.

Export SVG writes square, scalable geometry with local paths, clips, masks, gradients, and SVG filters for bevels and shadows. It contains no bitmap or font dependency. Crossing gaps use actual masks; transparent export removes the background. The three filters are evaluated by the viewing application, so verify their appearance in the intended SVG importer before production use. Rounded corners are applied only in the HTML preview.

`nyte-cross-globe.svg` and `nyte-cross-globe-transparent.svg` are the verified default exports.

## Image and 3D references

The ImageGen tab preserves the earlier generated glass concept from `imagegen-concept.png`; its exact prompt is `imagegen-prompt.txt`.

The Blender tab shows `blender/nyte-relief-study.png`. Its editable scene, reproduction script, and lighting notes are in that directory. A headless Blender study established shallow extrusion, a fine bevel, broad upper-left area lighting, and lower-right contact shadow. The SVG is an independently constructed approximation of that material treatment, not a raster embedded in an SVG or an automatic Blender vector export. The Blender study uses 3×3 bands while the editor's simpler default uses 3×2.

## Verification

Browser checks covered band and lighting controls, persistence, all reference tabs, presets, crossing order, keyboard input, opaque and transparent exports, image loading, and mobile overflow. Export XML parsing and the absence of embedded images were checked. No app assets have been replaced, and this is not an Icon Composer-validated production asset.
