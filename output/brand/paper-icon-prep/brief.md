# Nyte icon preparation for Paper

Status: local preparation only. No Paper MCP tools called; no Paper document read or changed.

## Direction and references

Nyte is a durable, local-first runtime for agent conversations. Its session history persists; only part of that history is active at a given moment. The user's design system is called Cloud.

Carry forward the original amber ASCII waxing crescent, blue earthshine, a slight rightward lean, and the supplied monochrome horizontal-band moon. The mark should read as a company icon at Dock size. The bands connect it to the terminal without requiring hundreds of tiny character outlines.

Avoid the rejected N monogram, Notion-like boxed letters, cloud mascots, vague hollow-sphere objects, voxel stair-steps, heavy glow, decorative code, and realistic lunar craters. A proposed diagonal cut was not selected by the user; do not introduce it as an approved requirement.

References already reviewed:
- `../nyte-moon/index.html` and its README: original 9-cell voxel moon, amber light, blue earthshine.
- `../nyte-moon-icons/moon-editor.html`: latest controls and SVG-only requirement.
- User's crescent app-icon screenshot: strong amber/navy contrast, excessive glow and conventional moon silhouette.
- User's horizontal-band reference: smooth outer circle, thin left traces, bold right segments, minimal one-color geometry.
- `packages/ui/src/platform-tokens.css` and `packages/desktop/src/renderer/src/theme/tokens.css`: current app UI is largely neutral with blue accent. The amber/navy palette comes from the user's brand study, not those application tokens.

## Concrete construction draft

`nyte-banded-moon.svg` is prepared locally as a reviewable draft, not an approved final mark.

- Full square 1024-unit viewBox. No baked rounded-corner mask.
- Moon center 544,500; radius 316. About 62% icon width, slight optical shift right and up.
- Crescent rotated clockwise 12 degrees; horizontal bands remain level.
- Ten broad bands: 64-unit pitch, 42-unit painted height. Fine earthshine traces: 7 units tall.
- Midnight gradient #202A40 to #0A0C12.
- Amber #FFE9B1 to #FFC96B to #CB841F.
- Earthshine #536787.
- Gloss: one restrained radial-gradient overlay #FFF3DC. No blur filter or image texture.
- No text in the icon, so no font lookup or typography work is needed for this artboard.

Four painted elements: background rectangle, one compound earthshine path, crescent instance, reflection instance. Shared crescent geometry uses one circular arc and one cubic return. Horizontal segments are generated as compound paths and clipped, not drawn individually with the pen tool. The SVG has no bitmap, font, or external-resource dependency.

The reflection layer can be omitted for a three-element minimum, but keeping it provides separately adjustable gloss. The intended minimum is zero manual pen-tool strokes and one SVG insertion, not one tool call per stripe.

## Paper tooling learned without calling its MCP

Read the installed Paper code-to-design skill, startup rule, and already-advertised tool descriptions. The full runtime guide was NOT fetched because the user explicitly requested no MCP calls during preparation.

Known capabilities:
- `write_html` accepts SVG within one visual group.
- `create_artboard` can create a 1024×1024 frame.
- SVG export is supported only for SVG nodes. Export the inserted SVG node, not its enclosing HTML/artboard.
- `write_html` should add one visual group per call. This icon is one group.
- `finish_working_on_nodes` is required when done.
- Fonts require a lookup only if typography is introduced. This plan uses none.

## Smallest practical later call sequence

Target: about eight calls, assuming an existing open file, compatible SVG import, and no corrections. This is a planning estimate, not a verified quota price or guarantee.

1. `get_guide` with `paper-mcp-instructions`. Required before other Paper calls.
2. `get_basic_info`. Resolve the active file and dimensions.
3. `get_selection`. Establish user focus and avoid modifying unrelated work.
4. `create_artboard`. One new 1024×1024 artboard named “Nyte / Banded moon”.
5. `write_html`. Insert `paper-insert.html` once as one icon group. Capture the returned SVG node ID.
6. `get_screenshot`. One visual check of the imported result.
7. `export`. Export that SVG node as SVG, scale 1x.
8. `finish_working_on_nodes`. Release working indicators.

Do not create extra comparison artboards, tokens, typography samples, imported reference images, or invoke Paper image generation for this pass. If a correction is needed, use one targeted edit and one follow-up screenshot rather than redrawing the icon. The required guide may reveal compatibility rules that change this estimate.

## Remaining live facts

These cannot be gathered without Paper calls: active file, selection, node IDs, quota balance/billing, SVG import fidelity for clipPath/use/gradients, and export behavior in that file. No assumption that every call costs the same. If Paper alters shared paths or gradients, use one locally flattened equivalent SVG rather than repeated pen operations.

## Verification before any Paper call

Open `index.html` locally and inspect 16,32,64,128 px previews and the large mark. Validate SVG XML, internal references, absence of embedded raster/text, and source markup. Small-size band density remains a design decision to assess in Paper's actual preview; no app integration or Apple Icon Composer validation is claimed.
