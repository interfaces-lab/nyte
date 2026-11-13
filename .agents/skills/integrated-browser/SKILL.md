---
name: integrated-browser
description: >
  Use this when working on the desktop's browser panels: the embedded Chromium page, its
  workbench tab, the agent browser tools, bounds and occlusion, sessions and permissions.
  Covers the desktop's browser main process, the app's workbench browser and overlay occlusion.
  Trigger on "browser panel", "WebContentsView", "page hides under a menu", "overlay",
  "data-slot", "occludes", "occlusion", "CDP", "snapshot", "browser tool". Not for looking at or
  driving a page with the browser_* tools; read .agents/skills/workbench-browser/SKILL.md for that.
paths:
  - "packages/desktop/src/main/browser/**"
  - "packages/desktop/src/shared/browser-*.ts"
  - "packages/desktop/src/preload/browser-page.ts"
  - "packages/desktop/e2e/browser.spec.ts"
  - "packages/app/src/workbench/browser/**"
  - "packages/app/src/components/overlay-occlusion*"
  - "packages/plugin/src/browser-tools.ts"
  - "packages/plugin/src/browser-client.ts"
---

# Integrated browser

A browser panel is an Electron `WebContentsView` that main paints over the window, shown as
the workbench's Browser tab and driven by agents through the `browser_*` tools.

## Boundaries

- Main (`packages/desktop/src/main/browser/`) owns the page. Only main can create native views.
- The renderer (`packages/app/src/workbench/browser/`, `overlay-occlusion.ts`) reaches main only
  through `BrowserBridge` and holds a mirror of page state, never the truth. Put new page state
  on the main surface, publish it as `browser_changed`, and let `applyBrowserEvent` apply it. A
  new page capability is a surface method plus an event, then a tool in `browser-tools.ts`.
- `BrowserAgent` is the contract between main and the agent tools; `browser-client.ts` maps its
  failures to the tools' outcomes. Keep `browser-tools.ts` and `browser-policy.ts` free of
  `electron`.

## The native view paints over the DOM

This causes nearly every "won't move, misaligned, shows through a menu, won't focus" bug.

**Alignment.** The panel measures an empty slot and sends `BrowserBoundsMessage` to main. Layout
that moves the page must feed that measurement in `browser-panel.tsx`; never position the
native view by hand.

**Z-order.** A high z-index does nothing. The panel reports the page hidden while anything
`overlay-occlusion.ts` counts overlaps it, and it counts two kinds of element.

- Inside a Base UI portal, an element whose `data-slot` is in `OVERLAY_SELECTOR`. `@nyte-ai/ui`
  popups and toasts carry listed slots; a new portal popup needs its slot added there.
- Outside a portal, an element that registers with `ref={occludes}`, as the tray and the drag
  overlay do. A `data-slot` there does nothing.

**The still.** Nothing captures the page in the background. When an overlay starts to cover the
slot, `createPageCover` captures the page, paints the still into the slot, then hides the view,
so a paused page looks like the page with no tint or blank flash. Without a still in 500 ms
(Cursor waits the same) the view hides anyway, so a menu never sticks behind the page. The cost
is an overlay behind the page for its first 30–38 ms median, 46 ms worst (720×820 panel, 2x
display, 120 Hz); the capture is about 12 ms of that. Backdrops that dim the window are DOM and
dim the still themselves.

**Toasts.** The toast stack can land over the workbench, wherever the toast position setting
puts it, so `toast` stays in the list and the page pauses under it instead of hiding it.

**No hit-testing.** VS Code counts an overlay only when it is topmost at the centre of its
overlap with the page. Here a listed portal slot has nothing above it but another overlay, and an
`occludes` element counts whenever it overlaps, whatever paints on top. Add hit-testing only for
a reproduced false pause.

**Why not `<webview>`.** It composites inside the DOM, so overlays would just work, at the cost
of a different process model and the security and CDP work built on `WebContentsView`. Revisit
it if pausing under menus or tooltips becomes the complaint, or the overlay list keeps needing
fixes.

**Keyboard.** A page takes the keyboard only when the user asks. Electron's default focuses a
view on every committed navigation, hidden or not, which pulls the keyboard out of the composer
whenever an agent's page or a dev server reloads, and a hidden view holding the keyboard makes
macOS beep on every key. Hence `focusOnNavigation: false`. The panel asks for the page with
`page.focus()` (the `focus` flag of `BrowserBoundsMessage`), which a focused text field, menu or
dialog overrides. Call it from a gesture that starts a navigation by hand; never focus the page
from main on load. A reload after a renderer crash still focuses the page; Electron has no
switch for it. The focus grab needs a key window, so a test with `show: false` cannot see it.

**Right-click.** `showContextMenu` opens a native menu, which needs no occlusion.

**Agent input.** All agent input goes through CDP, not `sendInputEvent`. Refs carry the snapshot
generation, so an old ref is refused instead of hitting another node. Page scripts run in an
isolated world that a cross-document navigation wipes, so every injection must be idempotent.

## Lifetime and trust

- A surface lives while a Browser tab or an agent session holds it. Each session holds one, so
  its page persists across tool calls and the workspace's Browser tab follows it without being
  revealed. Idle pages no tab holds are reclaimed beyond `WARM_POOL_LIMIT`.
- Guest sessions are per owner (workspace or Home), apart from the app's session. Permissions
  are an allow-list in `browser-policy.ts`; refused ones publish as `deniedPermissions` so the
  address bar says what was blocked.
- Downloads save only for a page the user alone holds; a page any agent holds refuses them, even
  while a panel shows it. A tab-opening gesture becomes `browser_open_tab` only on a page a panel
  holds.
- A sized `window.open` on a held page gets one hardened child window, so sign-in popups keep
  `window.opener`. A bad certificate is trustable only on a local host, per guest session, for
  this run.
- Assume a hostile page. Anything injected into it is a trust boundary: keep it minimal and free
  of side effects.

## Testing

- Anything touching the native view, focus or CDP needs `*.electron.test.ts`, not jsdom.
- Prove an occlusion change with `overlay-occlusion.test.ts`, which drives
  `overlay-occlusion.browser-test.tsx` in the real renderer, and with
  `packages/desktop/e2e/browser.spec.ts` against the real native view.

## Not covered

- Design Mode (`browser-design.ts` and the panel's design bar).
