# Fine layered screen icon

The current material follows the user's clarification: an ASCII-like texture perceived from a distance, with small holes and layered depth visible up close, like a vintage camera screen. It uses fine perforated sheets rather than legible characters, coarse ladder openings, or an unbroken smooth face.

Open `index.html` for the existing two-layer selector. The original emblem silhouette and upper-right stripe orientation remain. The large section is graphite blue; the smaller sections are warm gold.

## Material and controls

Two closely spaced screens form the emblem. The front has small rounded-square pores in staggered rows. A darker rear screen is offset behind it. Default density is 84 pitches across the mark diameter; hole width is 60% of pitch; rear offset is 28%; visual separation is 2.5 design pixels.

Mesh density, hole size, rear offset, and layer separation are adjustable. The material detail preview follows the emblem's position, size and rotation. Existing transform, color, light, bevel, reflection and export controls remain. The editor saves under its own `nyte-layered-screen-v1` key. Earlier saved material settings are unchanged.

## Outputs

- `screen-mesh-icon.svg`: two-layer icon export using native paths, patterns, masks, gradients and filters.
- `screen-mesh-emblem.svg`: transparent-background emblem export.
- `screen-mesh-preview.png`, `screen-mesh-256.png`, `screen-mesh-detail.png`: static SVG render checks.
- `screen-mesh.blend`: Blender scene with two visible mesh objects, base and combined layered emblem.
- `blender-screen-mesh.png` and `blender-screen-mesh-detail.png`: full and close-up Blender renders.
- `blender-screen-mesh.py`, `screen-geometry.json`, `screen-blender-notes.md`: reproduction data and construction notes.

The SVG uses procedural vector openings; it contains no embedded bitmap or text. Each sheet has openings, but the offset rear sheet intentionally obstructs some direct sightlines. Set offset and separation to zero to align the openings. The Blender scene uses real three-dimensional holes and sheet separation. Its static render is a corresponding material study and does not update when browser controls change.

Previous smooth exports and Blender files are preserved under their earlier names. They are no longer the editor's active references.

## Verification

Three SVG material variants and magnified pore views were rendered locally. The Blender scene and macro view were inspected twice; all 3,998 front and 3,901 rear holes passed individual ray checks. SVG exports were parsed and checked for native patterns with no image or text dependencies. Parameter calculations were checked for density, openness, rear offset and separation. An aligned-screen alpha test confirmed transparent openings between opaque screen lands.

Script syntax, formatting, control IDs and links were checked. Live browser inspection remains unavailable because the browser tool rejects the local file URL; this pass used static SVG and Blender renders.
