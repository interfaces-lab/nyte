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

A browser panel is a `WebContentsView` that main paints over the window.

## Boundaries

- Main (`packages/desktop/src/main/browser/`) owns the page. Only main can create native views.
- The renderer (`packages/app/src/workbench/browser/`, `overlay-occlusion.ts`) reaches main only
  through `BrowserBridge` and only mirrors page state.
- New page state lives on the main surface, published as `browser_changed`, applied by
  `applyBrowserEvent`. A new capability is a surface method plus an event, then a tool in
  `browser-tools.ts`.
- `BrowserAgent` is the main-to-tools contract; `browser-client.ts` maps its failures to tool
  outcomes. Keep `browser-tools.ts` and `browser-policy.ts` free of `electron`.

## The native view paints over the DOM

Most "won't move, misaligned, shows through a menu, won't focus" bugs come from this.

**Alignment.** The panel measures an empty slot and sends `BrowserBoundsMessage`. Layout that
moves the page must feed that measurement in `browser-panel.tsx`. Never position the native view
by hand.

**Z-order.** A z-index does nothing. The panel reports the page hidden while an element
`overlay-occlusion.ts` counts overlaps it:

- In a Base UI portal, an element whose `data-slot` is in `OVERLAY_SELECTOR`. `@nyte-ai/ui`
  popups and toasts carry listed slots; add the slot of any new portal popup.
- Outside a portal, an element registered with `ref={occludes}` (the tray, the drag overlay). A
  `data-slot` there does nothing.

`toast` stays listed because the toast position setting can put the stack over the workbench.

**The still.** There is no background capture. When an overlay starts to cover the slot,
`createPageCover` paints a capture of the page into the slot, then hides the view. With no still
after 500 ms (Cursor waits the same) the view hides anyway, so a menu never sticks behind the
page. The cost is an overlay behind the page for its first 30–38 ms median, 46 ms worst (720×820
panel, 2x display, 120 Hz), about 12 ms of it capture. Backdrops that dim the window are DOM and
dim the still.

**No hit-testing.** Unlike VS Code, which counts an overlay only when topmost at the centre of its
overlap, an `occludes` element counts whenever it overlaps, whatever paints on top; only overlays
sit above a listed portal slot. Add hit-testing only for a reproduced false pause.

**Why not `<webview>`.** Overlays would work with its DOM compositing, but it changes the process
model and loses the security and CDP work built on `WebContentsView`. Revisit if pausing under
menus or tooltips becomes the complaint, or the overlay list keeps needing fixes.

**Keyboard.** A page takes the keyboard only when the user asks, hence `focusOnNavigation: false`.
Electron's default focuses the view on every navigation, hidden or not, which steals the
composer's keyboard, and a hidden view holding it makes macOS beep.

- The panel asks with `page.focus()` (the `focus` flag of `BrowserBoundsMessage`) from a gesture
  that starts a navigation by hand. A focused text field, menu or dialog overrides it.
- Never focus the page from main on load.
- A reload after a renderer crash still focuses the page; Electron has no switch.
- The focus grab needs a key window, so a test with `show: false` cannot see it.

**Right-click.** `showContextMenu` opens a native menu; no occlusion needed.

**Agent input.** All of it goes through CDP, not `sendInputEvent`. Refs carry the snapshot
generation, so an old ref is refused. Page scripts run in an isolated world that a cross-document
navigation wipes, so every injection must be idempotent.

## Lifetime and trust

- A surface lives while a Browser tab or agent session holds it. A session keeps one page across
  tool calls, which the workspace's Browser tab follows without being revealed.
- Idle pages no tab holds are reclaimed beyond `WARM_POOL_LIMIT`.
- Guest sessions are per owner (workspace or Home), apart from the app's session.
- Permissions are an allow-list in `browser-policy.ts`; refusals publish as `deniedPermissions`
  for the address bar to show.
- Downloads save only on a page the user alone holds, not one any agent holds, even while a
  panel shows it.
- A tab-opening gesture becomes `browser_open_tab` only on a page a panel holds.
- A sized `window.open` on a held page gets one hardened child window, so sign-in popups keep
  `window.opener`.
- A bad certificate is trustable only on a local host, per guest session, for this run.
- Assume a hostile page; keep injected code minimal and free of side effects.

## Testing

- The native view, focus or CDP need `*.electron.test.ts`, not jsdom.
- Prove an occlusion change with `overlay-occlusion.test.ts` (drives
  `overlay-occlusion.browser-test.tsx` in the real renderer) and
  `packages/desktop/e2e/browser.spec.ts` (the real native view).

## Not covered

- Design Mode (`browser-design.ts` and the panel's design bar).
