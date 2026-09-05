# Draw eleven isometric SVG illustrations for the Nyte package wall

The attached image is the reference style: Tailwind CSS's feature cards. Thin dark-gray isometric line drawings, near-white fills, one small object per card, no text inside the drawing, no gradients, no shadows, no color. Copy that drawing style exactly. Do not copy the subjects.

## Subjects

One SVG per package. Each drawing is a single physical-looking object that stands for what the package does. Keep each to 2–5 primitives (slabs, cylinders, cards, a cable, a screen). Nothing decorative.

| file | package | what it is | draw |
|---|---|---|---|
| `schema.svg` | @nyte-ai/schema | the shared contracts and types every package agrees on | a flat stencil / template plate with cut-out shapes |
| `ai.svg` | @nyte-ai/ai | provider blocks that turn a request into a streamed model reply | a socket with a plug going in |
| `core.svg` | @nyte-ai/core | the durable kernel: object store, refs, leases, the agent loop | a stacked block of three slabs with a small ledger card on top |
| `ui.svg` | @nyte-ai/ui | shared Base UI primitives styled with StyleX | a small isometric window frame with two flat controls in it |
| `plugin.svg` | @nyte-ai/plugin | plugin contracts: what the model is allowed to see and call | a puzzle-piece tile snapping onto a base |
| `telemetry.svg` | @nyte-ai/telemetry | traces and metrics out of the kernel | a tiny gauge dial on a plinth |
| `tui.svg` | @nyte-ai/tui | the terminal client on Bun and OpenTUI | a terminal screen slab with a single caret bar |
| `desktop.svg` | @nyte-ai/desktop | the Electron client | a laptop, closed-to-open at 30°, lid as a thin slab |
| `protocol.svg` | @nyte-ai/protocol (reserved) | the wire protocol between client and server | two cards joined by a short cable |
| `server.svg` | @nyte-ai/server (reserved) | a hosted kernel | a rack unit: one thin box with two small lights |
| `client.svg` | @nyte-ai/client (reserved) | a browser client | a browser window slab with a tab notch |

Reserved packages: draw the same way but use `stroke-dasharray="3 2"` on every outline so they read as outlines of something not built yet.

## Drawing rules

- `viewBox="0 0 96 64"`, `width="96" height="64"`, `xmlns` set. Object centred, ~10px margin.
- True isometric: 30° axes. Use straight lines and ellipses only.
- Strokes: `stroke="currentColor"` `stroke-width="1.25"` `stroke-linejoin="round"` `stroke-linecap="round"`. No other stroke colors. The page sets `color`.
- Fills: only `fill="currentColor" fill-opacity="0.04"` for top faces and `fill-opacity="0.08"` for side faces, or `fill="none"`. That is the whole palette.
- No `<text>`, no `<filter>`, no `<linearGradient>`, no `<image>`, no `<style>`, no ids, no classes, no comments longer than one line.
- Under 1.5 KB each.

## Output

Write the eleven files to `.codex-refs/packages/` in this repository. Do not touch anything else. When done, print one line per file: name and byte size.
