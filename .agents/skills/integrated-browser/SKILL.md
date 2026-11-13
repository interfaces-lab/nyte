---
name: integrated-browser
description: >
  Explains the desktop's browser panels: the embedded Chromium page, its workbench tab, the agent
  browser tools, bounds and occlusion, sessions and permissions, across the desktop's browser main
  process, the app's workbench browser and overlay occlusion. Load it when working on that code,
  and on "browser panel", "WebContentsView", "page hides under a menu", "overlay", "data-slot",
  "occludes", "occlusion", "CDP", "snapshot", "browser tool". Not for looking at or driving a page
  with the browser_* tools; the workbench-browser skill covers that.
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

A browser panel is a `WebContentsView` that main paints over the window. Follow these rules when
you change the panel, its main-process code or the agent browser tools, and cite them by number in
a review.

## Boundaries

Rule numbers are stable ids that other skills and reviews cite. A removed rule leaves a gap.

1. **Main owns the page.** Main (`packages/desktop/src/main/browser/`) owns the page, and only main
   can create native views.
2. **The renderer only mirrors page state.** The renderer (`packages/app/src/workbench/browser/`,
   `overlay-occlusion.ts`) reaches main only through `BrowserBridge`.
3. **New page state lives on the main surface.** The surface publishes it as `browser_changed`, and
   `applyBrowserEvent` applies it. A new capability is a surface method plus an event, then a tool
   in `browser-tools.ts`.
4. **`BrowserAgent` is the contract between main and the tools.** `browser-client.ts` maps its
   failures to tool outcomes. Keep `browser-tools.ts` and `browser-policy.ts` free of `electron`.

## The native view paints over the DOM

Most bugs where the page won't move, sits misaligned, shows through a menu or won't take focus come
from this.

5. **Align the view through the measured slot.** The panel measures an empty slot and sends
   `BrowserBoundsMessage`, so layout that moves the page must feed that measurement in
   `browser-panel.tsx`. Never position the native view by hand.
6. **Hide the page with occlusion, not a z-index.** A z-index does nothing. The panel reports the
   page hidden while an element that `overlay-occlusion.ts` counts overlaps it.
7. **List a portal popup's `data-slot`.** In a Base UI portal, an element counts when its
   `data-slot` is in `OVERLAY_SELECTOR`; `@nyte-ai/ui` popups and toasts carry listed slots, so add
   the slot of any new portal popup. `toast` stays listed because the toast position setting can
   put the stack over the workbench.
8. **Register an element outside a portal with `occludes`.** Outside a portal, an element counts
   only when registered with `ref={occludes}`, as the tray and the drag overlay are. A `data-slot`
   there does nothing.
9. **A still covers the slot while the view hides.** There is no background capture. When an
   overlay starts to cover the slot, `createPageCover` paints a capture of the page into the slot,
   then hides the view, and with no still after 500 ms the view hides anyway, so a menu never
   sticks behind the page.
10. **Expect an overlay behind the page for its first frames.** The still costs an overlay behind
    the page for its first 30–38 ms median and 46 ms worst (720×820 panel, 2x display, 120 Hz),
    about 12 ms of it capture. Backdrops that dim the window are DOM, so they dim the still.
11. **Occlusion does no hit-testing.** An `occludes` element counts whenever it overlaps, whatever
    paints on top, unlike VS Code, which counts an overlay only when it is topmost at the centre of
    its overlap; only overlays sit above a listed portal slot. Add hit-testing only for a
    reproduced false pause.
12. **Keep `WebContentsView` rather than `<webview>`.** Overlays would work with `<webview>`'s DOM
    compositing, but it changes the process model and loses the security and CDP work built on
    `WebContentsView`. Revisit this if pausing under menus or tooltips becomes the complaint, or
    the overlay list keeps needing fixes.
13. **A page takes the keyboard only when the user asks.** The view sets
    `focusOnNavigation: false` because Electron's default focuses the view on every navigation,
    hidden or not, which steals the composer's keyboard. A hidden view that holds the keyboard
    makes macOS beep.
14. **Focus the page only from a navigation gesture.** The panel asks with `page.focus()` (the
    `focus` flag of `BrowserBoundsMessage`) from a gesture that starts a navigation by hand, and a
    focused text field, menu or dialog overrides it. Never focus the page from main on load.
15. **A reload after a renderer crash still focuses the page.** Electron has no switch to stop it.
16. **Test the focus grab with a shown window.** The focus grab needs a key window, so a test with
    `show: false` cannot see it.
17. **Right-click opens a native menu.** `showContextMenu` opens it, and it needs no occlusion.
18. **Send all agent input through CDP.** Agent input goes through CDP, not `sendInputEvent`. Refs
    carry the snapshot generation, so an old ref is refused.
19. **Make every injection idempotent.** Page scripts run in an isolated world that a
    cross-document navigation wipes, so every injection must be idempotent.

## Lifetime and trust

20. **A surface lives while a Browser tab or an agent session holds it.** A session keeps one page
    across tool calls, and the workspace's Browser tab follows that page without being revealed.
21. **Idle pages are reclaimed beyond `WARM_POOL_LIMIT`.** This applies to idle pages that no tab
    holds.
22. **Guest sessions are per owner.** Each owner (a workspace or Home) has its own guest session,
    apart from the app's session.
23. **Permissions are an allow-list.** The allow-list lives in `browser-policy.ts`, and refusals
    publish as `deniedPermissions` for the address bar to show.
24. **Downloads save only on a page the user alone holds.** A page any agent holds saves no
    download, even while a panel shows it.
25. **Only a page a panel holds opens tabs.** A tab-opening gesture becomes `browser_open_tab` only
    on a page a panel holds.
26. **A sized `window.open` on a held page gets one hardened child window.** Sign-in popups
    therefore keep `window.opener`.
27. **Trust a bad certificate only on a local host.** The trust holds per guest session, for this
    run.
28. **Assume a hostile page.** Keep injected code minimal and free of side effects.

## Testing

29. **Test the native view, focus or CDP in Electron.** They need `*.electron.test.ts`, not jsdom.
30. **Prove an occlusion change in both the renderer and the native view.** Run
    `overlay-occlusion.test.ts`, which drives `overlay-occlusion.browser-test.tsx` in the real
    renderer, and `packages/desktop/e2e/browser.spec.ts`, which drives the real native view.
