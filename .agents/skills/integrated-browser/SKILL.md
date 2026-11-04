---
name: integrated-browser
description: >
  Use this when working on the desktop's browser panels: the embedded Chromium page, its
  workbench tab, the agent browser tools, bounds and occlusion, sessions and permissions.
  Covers the desktop's browser main process, the app's workbench browser and overlay occlusion.
  Trigger on "browser panel", "WebContentsView", "page hides under a menu", "overlay",
  "data-slot", "occlusion", "CDP", "snapshot", "browser tool".
paths:
  - "packages/desktop/src/main/browser/**"
  - "packages/desktop/src/shared/browser-*.ts"
  - "packages/desktop/src/preload/browser-page.ts"
  - "packages/desktop/e2e/browser.spec.ts"
  - "packages/app/src/workbench/browser/**"
  - "packages/app/src/components/overlay-occlusion*"
  - "packages/plugin/src/browser-tools.ts"
---

# Integrated browser

A browser panel embeds a real Chromium page in the desktop, backed by an Electron
`WebContentsView`. It renders live pages as a Browser tab in the workbench and lets an
agent drive those pages through tools. It is a heavyweight, security-sensitive,
multi-process primitive, and almost every design decision follows from that. This file
holds the load-bearing ideas; it does not enumerate current tools or features.

## Two processes, and why

| Process  | Location                                                                | What lives here                                                                                                                            |
| -------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Main     | `packages/desktop/src/main/browser/`: `browser.ts`, `browser-surface.ts`, `browser-runtime.ts`, `browser-policy.ts`, `browser-actions.ts` | The `WebContentsView`, guest sessions, holders, permissions, navigation, CDP input, snapshots. Only main can create native views. |
| Renderer | `packages/app/src/workbench/browser/`: `browser-panel.tsx`, `browser-surfaces.ts`; `packages/app/src/components/overlay-occlusion.ts` | The tab, address bar, bookmarks, bounds reporting, occlusion. Holds a mirror of page state, never the truth.                                |

`BrowserAgent` in `packages/desktop/src/shared/browser-agent.ts` is the contract between the
two halves and the agent tools. `packages/plugin/src/browser-tools.ts` never imports `electron`;
`browser-policy.ts` never needs it. The renderer reaches main only through `BrowserBridge` in
`packages/app/src/contract/bridge.ts`.

## The renderer holds a mirror

Page state is owned by the main-process surface and flows one way:

```text
panel ──command──▶ BrowserBridge ──IPC──▶ main surface ──▶ Chromium
  ▲                                              │
  └──────── browser_changed event ◀──────────────┘
```

New state belongs on the surface in main, published as a `browser_changed` event, and
applied by `applyBrowserEvent`. Do not keep page facts in renderer state.

## The native view floats above the DOM (the overlay problem)

The single most error-prone area, and the cause of nearly every "won't move, misaligned,
shows through a menu, won't focus" bug. The page is painted by main on top of the renderer,
so the workbench fakes a normal DOM element. Treat the page's rectangle and visibility as
things the renderer coordinates, never DOM facts.

- **Alignment.** The panel renders an empty slot, measures its rect on every resize, scroll
  and frame it moves, and ships `BrowserBoundsMessage` to main. New layout that moves the
  page must feed that measurement, not just move a DOM box.
- **Z-order.** The native view paints above all DOM. A menu, popup, dialog or tray that
  should sit over the page would be hidden behind it. `overlay-occlusion.ts` observes the
  DOM for floating surfaces by `data-slot` (`OVERLAY_SELECTOR`), measures them each frame
  while a panel is listening, and the panel reports itself hidden while one covers it. A
  new floating surface that can overlap a page must carry a listed `data-slot`; a high
  z-index does nothing. `@nyte-ai/ui` popups already do. Nothing registers by ref, and
  `@nyte-ai/ui` knows nothing about the host.
- **The still.** Nothing captures the page in the background. When an overlay starts
  covering the slot, `createPageCover` (`packages/app/src/workbench/browser/browser-cover.ts`) runs one
  cycle: the native view keeps showing while the page is captured (`captureFrame`, a JPEG
  at full device resolution), decoded and committed into the slot under it. Two frames
  later, once the still has painted, the view hides. If no still arrives within 500 ms, the
  view hides anyway so a menu is never stuck behind the page; a late still from the same
  cycle still fills in. Cursor waits the same 500 ms before moving its pane. When the overlay
  leaves, the view shows again and the still is dropped two frames later, after the view has
  painted over it. Each cover starts a new cycle, and work from an earlier one is dropped.
  A still is tagged with the URL it was requested for and is drawn only while that URL and
  surface are current. A paused page therefore looks like the page: no tint, no blank
  flash, at the cost of the overlay showing behind the page for its first few frames.
  Measured at a 720×820 panel on a 2x display, 120 Hz: about 30–38 ms median and 46 ms
  worst from the overlay's insertion to the hide. Of that, the capture takes about 12 ms
  in main, the paint wait two frames and detection up to two frames. Overlays that dim the
  window (dialog and command backdrops) are DOM and dim the still themselves.
- **Toasts.** The shell mounts the toast stack at the window inset the toast position
  setting picks, so it can land over the workbench; `toast` stays in the overlay list so it
  pauses a page there instead of hiding behind it.
- **No hit-testing.** VS Code counts an overlay only when it is topmost at the centre of
  its overlap with the page. Every slot we list is a top-layer portal, so nothing but
  another overlay paints above it; add hit-testing only for a reproduced false pause.
- **Why not `<webview>`.** A `<webview>` composites inside the DOM, so overlays would just
  work, at the cost of a different process model and the security and CDP work built on
  `WebContentsView`. Revisit it if menus or tooltips pausing the page becomes the complaint,
  or the overlay list needs repeated fixes.
- **Right-click.** Context menus are native (`packages/app/src/components/context-menu.ts`), so they need no
  occlusion.
- **Input.** All agent input goes through CDP, not `sendInputEvent`. Snapshot refs carry a
  generation so a stale ref fails loudly. The isolated world shares the DOM but not the
  page's JS, and is wiped by a cross-document navigation; every injection is idempotent.

## Lifetime and trust

- A surface lives while at least one holder retains it: the renderer tab, or an agent
  session. An agent's surface is one per session, so its page persists across tool calls,
  and the owning workspace's Browser tab follows it without being revealed.
- Guest sessions are per owner and separate from the app's session. Permissions are an
  allow-list in `browser-policy.ts`; everything else is denied. Downloads save to the
  Downloads folder only for a page the user alone holds; any page an agent holds is refused,
  even while a panel shows it.
  Likewise a tab-opening gesture becomes a `browser_open_tab` event only on a held page.
- Ad blocking is per page: `blocking` is `on`, `paused` (host on `adblockAllowedHosts`), or
  `off`. The shield menu in the panel writes the setting; main republishes on
  `settingsChanged`, so the badge is never stale.
- HTML fullscreen (`enter-html-full-screen`) takes the window fullscreen and sizes the view
  to it; `apply` ignores reported bounds until the page leaves fullscreen.
- Dev-workflow events a plain `WebContentsView` leaves broken are handled in `wire`: a sized
  `window.open` on a held page gets one hardened child window so sign-in popups keep
  `window.opener`; a 401 challenge becomes `browser_login_requested` and the panel's dialog
  answers through `login`; a bad certificate on a local host offers `trust-certificate`
  (remembered per guest session, this run only); a dead renderer reloads with backoff
  (`crashRetryDelay`); refused permissions are published as `deniedPermissions` so the
  address bar can say what was blocked instead of failing silently.
- Assume a hostile page. Anything injected into it is a trust boundary: keep it minimal
  and side-effect-free.

## Testing

- `browser-policy.test.ts`, `browser-surface.test.ts`, `browser-history.test.ts` and
  `adblock.test.ts` beside them in main, and `packages/plugin/test/browser-tools.test.ts`, cover
  the parts that need no Electron; `*.electron.test.ts` run in Electron.
- `packages/app/src/components/overlay-occlusion.test.ts` drives `overlay-occlusion.browser-test.tsx` in the
  real renderer: it expects no capture while nothing covers the page. It opens a menu over
  the panel and expects the page to hide only once the still has loaded, with the still
  dropped after the page shows again. With a capture that never resolves, it expects the
  page to hide after the 500 ms wait. Removing a slot from `OVERLAY_SELECTOR` must fail it.
  `packages/desktop/e2e/browser.spec.ts` checks against the real native view that the still exists only
  while a menu covers the page, and that a toast in the split layout leaves the page
  showing without a capture.
- Anything touching the native view, focus, or CDP needs the Electron harness, not a jsdom
  test.

## When extending

- New page capability: a method on the main surface plus an event, then a tool in
  `browser-tools.ts`. Not renderer state.
- New floating UI: give it a `data-slot` and add it to `OVERLAY_SELECTOR`.
- Layout change: feed the bounds measurement in `browser-panel.tsx`; never position the
  native view by hand.
