---
name: integrated-browser
description: >
  Explains the desktop's browser pages: `<webview>` guests that main binds and the renderer places,
  the Browser tab, live pages on the Design board, the agent browser tools, layering over a page,
  focus, sessions and permissions, across the desktop's browser main process, the page preload, the
  app's guest host and slot store, and the board's page frames. Load it when working on that code,
  and on "browser panel", "webview", "guest", "placeGuest", "slot", "page hides a menu",
  "z-index over the page", "layer.page", "floating surface", "live page", "data-page", "page
  frame", "WebContentsView", "occlusion", "CDP", "snapshot", "browser tool". Not for looking at or
  driving a page with the browser_* tools; the workbench-browser skill covers that.
paths:
  - "packages/desktop/src/main/browser/**"
  - "packages/desktop/src/shared/browser-*.ts"
  - "packages/desktop/src/preload/browser-page.ts"
  - "packages/desktop/e2e/browser.spec.ts"
  - "packages/desktop/e2e/design.spec.ts"
  - "packages/app/src/workbench/browser/**"
  - "packages/app/src/studio/board-pages.ts"
  - "packages/app/src/studio/board-design.tsx"
  - "packages/canvas/src/board/page-frames.ts"
  - "packages/plugin/src/browser-tools.ts"
  - "packages/plugin/src/browser-client.ts"
---

# Integrated browser

A browser page is an Electron `<webview>` guest. Main owns the list of pages and binds each guest;
the window's renderer mounts the element and places it. Follow these rules when you change the
Browser tab, a live page on the Design board, the page's main-process code or the agent browser
tools, and cite them by number in a review.

## Boundaries

Rule numbers are stable ids that other skills and reviews cite. A removed rule leaves a gap.

1. **Main owns the page; the renderer owns the element.** Main
   (`packages/desktop/src/main/browser/`) owns the list of pages and each one's hosting window, and
   never creates web contents. The renderer mounts one `<webview>` per page its window hosts, and
   main binds that guest to the page only after the attach checks (rule 42).
2. **The renderer reaches main only through `BrowserBridge`.** The guest host
   (`browser-guests.tsx`) uses `guests`, `attach` and `setShown`. The Browser tab
   (`packages/app/src/workbench/browser/`) and the board's pages
   (`packages/app/src/studio/board-pages.ts`) use the same bridge for everything else.
3. **New page state lives on the main surface.** The surface publishes it as `browser_changed`, and
   `applyBrowserEvent` applies it. A new capability is a surface method plus an event, then a tool
   in `browser-tools.ts`.
4. **`BrowserAgent` is the contract between main and the tools.** `browser-client.ts` maps its
   failures to tool outcomes. Keep `browser-tools.ts` and `browser-policy.ts` free of `electron`.

## The page is a guest the renderer places

Most bugs where a page won't move, sits misaligned, hides a menu, eats a drag or won't take the
keyboard come from this. The native view, occlusion and the still are gone. The DOM draws over a
page by z-index.

5. **Align the page through the measured slot.** The slot store in `browser-guests.tsx` holds one
   slot per page: `rect` in window CSS px after scaling, `scale`, `clip` and `interactive`. The page
   lays out at `rect` divided by `scale` and draws inside `rect` cut to `clip`. The Browser tab
   measures its empty slot in `browser-panel.tsx` and passes it to `placeGuest` with scale 1, no
   clip and input on, so layout that moves the page must feed that measurement. Never position the
   element by hand.
31. **Never move the element in the DOM.** Moving or re-parenting a `<webview>` reloads its page.
    `BrowserGuestHost` mounts every guest once, in one fixed layer at the shell's root, keyed by
    page and generation and sorted by page, and a slot moves it only by coordinates. Never render a
    guest inside the Browser tab or the board, or wrap the host in anything that remounts.
32. **Tell main only whether a slot shows the page.** `placeGuest` calls `setShown` when a page
    goes between parked and shown, because main's key routing, idle reclaim and window moves read
    it. Main never hears where the page is. A `setShown` that shows the page from another window
    moves the page there, which reloads it (rule 44).
33. **Draw a floating surface above `layer.page`.** Guests sit at `layer.page` (22), above the
    workbench (`layer.workbench`) and below the sidebar and title bar (`layer.chrome`), floating
    content in a pane (`layer.floatingContent`) and every Base UI portal. A surface that must draw
    over a page needs a `layer` token above `layer.page` on the box that forms its stacking context
    in the root, and no ancestor that forms a stacking context at or below it. A popup that lives
    inside a pane or the workbench must be a portal to the body, as the address field's suggestions
    are.
34. **Expect the page to swallow the pointer.** A guest takes every pointer event over its box, and
    none of them reach the app's document. The host turns pointer events off on a slot that is not
    `interactive`, and on every guest while a trusted primary-button press or an HTML drag that
    began in the app's document is held, so a splitter or tab drag can cross a page. A `contextmenu`
    ends the press, because the native menu takes its release. A drag that starts anywhere else,
    such as inside the board's iframe, loses the pointer over an interactive page.
35. **Close a custom popup on an outside `pointerdown` or `click`.** A press inside a page never
    reaches the document, so the host replays a `pointerdown` and a `click` on the element when the
    page preload reports a trusted press in the main frame (`BROWSER_PAGE_PRESS_CHANNEL`) and when
    the element takes focus. Base UI's outside press closes on those; a popup that closes on
    `mousedown` or window blur stays open. A press inside a subframe of a page that already has
    focus is not reported.
36. **Park a hidden page; never hide it with CSS.** A page no slot shows stays mounted at its last
    layout size and moves 100,000 px off screen. `sizeGuest` sets that size, so a parked page renders
    at the viewport its next slot gives it. Never use `display: none`, never detach the element, and
    never use `visibility: hidden`, which can blank a guest for good on macOS.
37. **Keep a painting page inside the viewport.** A guest outside the viewport makes no frames, so a
    capture of it times out. While main's list says `painting`, a parked guest sits at the window's
    origin at `opacity: 0` and `z-index: -1`, behind the app. Main sets `painting` while the page
    has an agent operation or a capture running, so new code that captures or drives a page must
    count itself in the page's `operations` or `captures`, as `SurfaceAgent` and `captureFrame` do.
38. **Cover the window for HTML fullscreen.** Main toggles the window's fullscreen and publishes
    `state.fullscreen`; the host then draws the element over the whole window at
    `layer.fullscreenPage`.
13. **A page takes the keyboard only when the user asks.** A navigation or the page's own
    `autofocus` or `focus()` does not take the window's keyboard; a trusted press does, whether a
    person's or an agent's CDP click. When a slot hides a page or takes its input away, the host
    blurs the element, so the keyboard returns to the window.
14. **Give the page the keyboard with `focusGuest`, from a gesture.** The Browser tab calls it from
    a gesture that starts a navigation by hand, and Design Mode's toggle calls it in a Browser tab
    and on the board. Entering a board page does not; a click in the page does. It does nothing without an interactive slot or while a text field, menu or dialog
    owns the keyboard (`keyOwner`), and it waits for attach. Main never focuses a guest;
    `guest.focus()` does nothing there.
39. **Hand the keyboard back after agent input.** Agent click, type and press run inside
    `keepingKeyboard` in `browser-runtime.ts`, which returns the keyboard to whatever held it,
    because a CDP press takes it like a person's. Any new agent action that presses must go through
    it.
40. **Read page focus from `focusedFrame`.** `getFocusedWebContents()` and `isFocused()` report a
    guest whenever its window has focus, so `focused(window)` reads `guest.focusedFrame`.
16. **Test the focus grab with a shown window.** The focus grab needs a key window, so a test with
    `show: false` cannot see it.
17. **Right-click opens a native menu.** `showContextMenu` opens it.
18. **Send all agent input through CDP.** Agent input goes through CDP, not `sendInputEvent`. Refs
    carry the snapshot generation, so an old ref is refused.
19. **Make every injection idempotent.** Page scripts run in an isolated world that a
    cross-document navigation wipes, so every injection must be idempotent.
41. **Every guest passes the attach gate.** Only Nyte's app windows have `webviewTag`, and any
    script in such a window's main frame can drive every guest it hosts, so only Nyte's renderer may
    load there. Their `will-attach-webview` handler (`hostGuests`) refuses any `src` but
    `about:blank` and any partition that is not one of our guest sessions'. It then replaces the
    guest's preferences with a fixed allow-list: the partition it checked, sandbox, context
    isolation, no node integration in any frame or worker, web security, no insecure content, no
    experimental features, no plugins, no nested `webviewTag`, no spellcheck, zoom 1,
    `focusOnNavigation: false` and no window resize for HTML fullscreen. Everything else the
    element asks for is dropped, a preload, `webpreferences` and `allowpopups` included. The page
    preload comes only from the guest session's `registerPreloadScript` and runs only in the main
    frame. Add to the allow-list only on purpose, and give any other window that gets `webviewTag`
    the same gate.
42. **Attach on the first `dom-ready`, with the generation.** The host creates the element itself
    and sets `partition` before the element joins the document, because the partition is fixed at
    the first navigation. It calls `attach({ surface, webContentsId, generation })` on the first
    `dom-ready`, since `getWebContentsId()` throws at `did-attach`. Main binds the guest only if it
    is a `webview` hosted by the calling window, in the page's own guest session, for the page's
    current generation, and the page is hosted by that window with no live guest. Then main wires
    the page's events and loads the last address. Until then the guest opens no windows and
    navigates only to web addresses. Main closes a guest not bound within 5 s, and every page of
    that window still waiting for a guest gets a new generation.

## Lifetime and trust

20. **A surface lives while a Browser tab, a board page frame or an agent session holds it.** A
    session keeps one page across tool calls, and the workspace's Browser tab follows that page
    without being revealed.
43. **A page with no window has no guest.** Main hosts a page in the window that shows it. An
    agent's page that no tab shows is hosted, parked, in the window opened last. With no window at
    all the page has no guest; an agent operation waits up to 10 s (`GUEST_WAIT_MS`) for one, then
    fails as a closed page does. A window that opens later hosts the page once its renderer calls
    `guests()`.
44. **A new guest reloads the page.** A page reloads at its last address when it moves to another
    window and when its guest is destroyed. Main raises the entry's `generation`, so the element
    remounts and attaches again, and unbinding drops an open find, a pending login, a debugger
    pause and HTML fullscreen. Parking never reloads a page, and main reloads a crashed page in the
    same guest.
53. **A window's renderer ending closes that window's pages.** When an app window's renderer
    closes, crashes or navigates, main releases the window's pages (`releaseWindow`): its Browser
    tabs and board pages close, and the fresh renderer reopens its tabs with `open`, which loads
    each address again. A page an agent still holds moves to another window, or waits for a
    renderer to call `guests()`.
45. **A page keeps its own zoom.** Electron pushes the app window's zoom onto every guest, so main
    sets each page's `zoom` again on attach and whenever the window zooms (`WINDOW_ZOOM_CHANNEL`).
21. **Idle pages are reclaimed beyond `WARM_POOL_LIMIT`.** This applies to idle pages that no tab
    holds and that have no agent operation or capture running.
22. **Guest sessions are per owner.** Each owner (a workspace or Home) has its own guest session,
    apart from the app's session.
23. **Permissions are an allow-list.** The allow-list lives in `browser-policy.ts`, and refusals
    publish as `deniedPermissions` for the address bar to show.
24. **Downloads save only on a page the user alone holds.** A page any agent holds saves no
    download, even while a panel shows it.
25. **Only a page a panel holds opens tabs.** A tab-opening gesture becomes `browser_open_tab` only
    on a page a panel holds. `setWindowOpenHandler` runs at all only because the attach gate's
    allow-list leaves out `disablePopups`, whatever the element asks for.
26. **A sized `window.open` on a held page gets one hardened child window.** Sign-in popups
    therefore keep `window.opener`. The child's parent is the hosting window, and it gets sandbox,
    context isolation, no node integration in any frame, web security, no `webviewTag` and no
    DevTools.
27. **Trust a bad certificate only on a local host.** The trust holds per guest session, for this
    run.
28. **Assume a hostile page.** Keep injected code minimal and free of side effects.

## Pages on the Design board

46. **Page pixels never enter the board.** The board is a sandboxed iframe, so it cannot mount a
    `<webview>`, and designs run in it, so it never gets a still either. It lays out a frame with
    `data-page`, covers it with the address on a muted fill, and reports each page frame's box,
    scale and state as `pages`. The app (`board-pages.ts`) feeds the live or entered page to
    `placeGuest` on every `pages`, cut to the board's iframe, with input only while entered. It
    draws each still as an image in its own layer over the iframe, taking no pointer input, shown
    only while the frame is still.
47. **The board owns a page frame's state.** A page frame is still by default and live while it is
    the only selection; a live page shows but takes no input, so the board keeps panning, zooming
    and selecting. A double-click on the frame, Enter on the live frame or the app's `enter` for it
    makes it entered, and the page takes input. Entering does not give the page the keyboard; a
    click in it does, or the Design Mode toggle. A press outside the frame, Esc or the app's `leave`
    returns it to live. At most one page frame is live or entered. The app asks; it never sets the
    state.
48. **Treat `pages` as untrusted.** Designs run in the board's window and can post messages of
    their own. A page frame counts only where the app's own parse of the design file finds a plain
    string-literal `data-page` at that frame equal to the reported address, and only the first
    frame reported live or entered counts as such. The app also parses each address with
    `parseWebUrl` and shows no page wider or taller than 10,000 px, and the protocol caps page
    frames at `MAX_PAGE_FRAMES`. Each page frame gets its own page (`design-page:<uuid>`) in the
    workspace's guest session, so it shares the Browser tab's logins, history and downloads.
49. **A board page loads only once its frame is live.** Until then the frame shows its address. At
    most five board pages are open and at most one opens per second; the page that was live least
    recently closes first. A frame that leaves `pages` keeps its page and still for 3 s, so a
    passing compile error costs nothing. Stills come from `captureFrame` after each load and when a
    live page goes back to still.
50. **Hand gestures back only while entered.** While a page is entered (`setEntered`, honoured only
    from the window that shows the page and cleared when it hides or moves), the page preload sends
    ⌘ or Ctrl wheel and pinch back on `BROWSER_PAGE_BOARD_CHANNEL`, main forwards them as
    `browser_board_wheel`, and the app turns them into the board's `wheel`. As over the board,
    pinch and Ctrl wheel zoom it and ⌘ wheel without Ctrl pans it. Main multiplies the deltas by
    the page's own zoom, and the app scales only the pointer position by the frame's scale, never
    the deltas, which stay in screen pixels. Main catches Esc before the page and emits
    `browser_board_leave`, unless Design Mode is on. A plain wheel scrolls the page. App shortcuts
    typed in an entered page are dropped, except the app menu's own.
51. **Design Mode on the board works on the live or entered page.** The Design tab's toggle, absent
    without `nyte.host.browser`, enters the live page and focuses it, and picks go to the chat
    through `addPickToChat`, as in the Browser tab. While the page has the keyboard, Esc cancels a
    drag, then leaves Design Mode, then leaves the page. A pick moves the keyboard to the composer,
    because inserting the reference focuses it, so right after a pick Esc goes to the composer. A
    press on `DesignBar` gives the page the keyboard back. Design Mode turns off when the page's
    slot goes to nothing, such as when the frame is panned off the board, and when the page goes
    back to still, before its still is captured.

## Testing

29. **Test guests, focus or CDP in Electron.** They need `*.electron.test.ts` run through
    `runBrowserHarness`, not jsdom. The harness's page mounts guests the way the renderer does, but
    it is a stand-in for `BrowserGuestHost`, not the real one.
30. **Prove a placement, layering or pointer change in the desktop e2e.** The occlusion tests are
    gone. `packages/desktop/e2e/browser.spec.ts` › "the integrated browser journey" drives guests in
    the Browser tab of the real app, and `packages/desktop/e2e/design.spec.ts` › "a live page frame
    loads once selected, follows the board's camera, takes input once entered, and works with
    Design Mode" drives a board page.
52. **The app's renderer tests cannot host a guest.** The `testRenderer` window has no
    `webviewTag`, so no renderer test proves a mounted page. Only a desktop run proves
    `BrowserGuestHost`.
54. **Send keys meant for main through the guest's own contents.** Main reads Esc in an entered
    board page and the browser shortcuts in the guest's `before-input-event`, and Playwright's
    keyboard goes through the app window, which never fires it. Use `pressInGuest`, which sends
    the key with the guest's `sendInputEvent`. That is test input only; agent input still goes
    through CDP (rule 18).
55. **Reach guests through the e2e helpers.** Find a guest in main by `getType() === "webview"`.
    The shared helpers in `packages/desktop/e2e/ui.ts` do it for you: `guestPages` lists each
    guest's URL, title and loading state, `inGuest` runs a script in a guest's main world,
    `pressInGuest` presses a key in it, `guestBox` returns where the renderer draws it (null while
    parked), and `captureComposited` saves the window's pixels, guests included.
