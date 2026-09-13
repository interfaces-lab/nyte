# Nyte mesh moon

Open `index.html` in a browser. It is self-contained and works from `file://`.

## The mark

A waxing crescent, the sun to the right and a little behind, the same phase as the ASCII moon in `../nyte-moon`. Built the way macOS icons like Linear's are built: shallow flat layers on a plate, shot straight on.

- The night side is a glossy graphite-blue disc with a shallow dome, carrying the broad diagonal reflection from the `../linear-ascii-gloss` study.
- The crescent is two thin perforated gold sheets raised a hair above the disc, front amber and rear bronze, the rear offset by a third of a cell. It reads as solid amber from a distance and shows layered depth up close, the same trick as the gloss study's screens.
- The pore pattern is a latitude/longitude lattice on a sphere with its pole at the sun, projected flat. The terminator is one clean edge, every row of cells is an arc parallel to it, and the cells foreshorten toward the limb into the density gradient the ASCII moon has.

Amber on night. The crescent is the only warm thing on the plate.

## Files

- `blender-flat-moon-icon.png`: icon on the night plate, 1024 px, transparent corners.
- `blender-flat-moon-mark.png`: the moon alone on transparent, 1024 px.
- `blender-flat-moon-detail.png`: close orthographic view of the two sheets, 768 px.
- `flat-moon.blend`: the scene. Artwork holds plate, night disc, rear sheet, front sheet. Camera and lights live in Lighting.
- `blender-flat-moon.py`: rebuilds everything from scratch and renders the three images.
- `blender-notes.md`: layer heights, materials, lights, verification.
- `sphere/`: the first pass, a true sphere with lattice shells and a three-quarter hero. Kept for reference; too deep for an icon.
- `JetBrainsMono-Regular.ttf`, `JETBRAINS-MONO-LICENSE`: used by the sphere hero's wordmark, bundled under its OFL licence.

## Rebuild

From the repo root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python output/brand/nyte-mesh-moon/blender-flat-moon.py
```

Set `NYTE_QUICK=1` for a low-sample half-size pass. Disc radius, dome height, sheet thickness and gap, lattice density, strut widths, rear offset and the sun vector are constants at the top of the script.
