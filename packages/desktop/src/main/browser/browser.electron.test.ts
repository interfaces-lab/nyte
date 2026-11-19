import { expect, test } from "vitest";
import { runBrowserHarness } from "./fixtures/browser-harness.ts";

const enabled = process.env["NYTE_DESKTOP_BROWSER_E2E"] === "1";

const PAGES = `
  const pages = await serve((path) => {
    if (path === "/popup") return "<!doctype html><title>popup</title><p>popup";
    return '<!doctype html><title>guest page</title><body style="background:rgb(255,0,0);margin:0">' +
      '<input id="field" aria-label="Field"><button id="go">Go</button><p>hello guest</p>';
  });
  const url = pages.url + "/";
  const owner = { kind: "project", path: "/workspace" };
`;

test.runIf(enabled)(
  "a browser page runs on a gated <webview> guest with its preload, capture, CDP, popups, find, zoom, DevTools and focus",
  async () => {
    const report: unknown = JSON.parse(
      await runBrowserHarness({
        files: {
          "evil.js": 'require("electron").ipcRenderer.send("evil", typeof require);',
        },
        script: `${PAGES}
  const context = browser();
  const host = await context.guestWindow({ show: true });
  const other = await context.guestWindow();
  const key = await focusWindow(host.window);
  await host.focusComposer();

  const surface = "tab";
  context.surfaces.open({ surface, url, owner, holder: "tab" }, host.id);
  const guest = await context.attached(surface);
  await until(() => !guest.isLoading() && guest.getURL() === url);
  const guestEntry = context.surfaces.guests(host.id)[0];
  const prefs = guest.getLastWebPreferences();
  const evil = [];
  guest.ipc.on("evil", (_event, value) => evil.push(value));

  const afterNavigation = {
    active: await host.page("document.activeElement.id"),
    guestFocused: guest.focusedFrame !== null,
    focused: context.surfaces.focused(host.id) ?? null,
  };
  await host.show(surface, { x: 0, y: 40, width: 800, height: 500 });
  await host.focus(surface);
  await until(() => guest.focusedFrame !== null);
  const whileFocused = context.surfaces.focused(host.id) ?? null;
  const shortcut = process.platform === "darwin" ? "meta" : "control";
  guest.sendInputEvent({ type: "mouseMove", x: 20, y: 10 });
  guest.sendInputEvent({ type: "mouseDown", x: 20, y: 10, button: "left", clickCount: 1 });
  guest.sendInputEvent({ type: "mouseUp", x: 20, y: 10, button: "left", clickCount: 1 });
  await until(() => guest.executeJavaScript("document.activeElement.id === 'field'"));
  guest.sendInputEvent({ type: "keyDown", keyCode: "K", modifiers: [shortcut] });
  guest.sendInputEvent({ type: "keyUp", keyCode: "K", modifiers: [shortcut] });
  await until(() => context.keys.length > 0);
  await host.focusComposer();
  await until(() => guest.focusedFrame === null);
  const afterComposer = context.surfaces.focused(host.id) ?? null;

  const generation = guestEntry.generation;
  const rogue = await host.mount({ surface: "rogue", partition: guestEntry.partition, generation, painting: false }, {
    preload: "file://" + dir + "/evil.js",
    webpreferences: "partition=persist:elsewhere, contextIsolation=no, nodeIntegration=yes, sandbox=no",
  });
  const rogueContents = webContents.fromId(rogue.id);
  const roguePrefs = rogueContents.getLastWebPreferences();
  const rogueSession = rogueContents.session === guest.session;
  const rogueAttach = context.attaching.find((entry) => entry.element === guestEntry.partition && entry.preferences !== guestEntry.partition);
  await rogueContents.loadURL(url);
  const roguePopup = await rogueContents.executeJavaScript("String(window.open('/popup', 'x', 'width=300,height=300'))", true);
  const refusals = [];
  const refused = (attempt) => { try { attempt(); return false; } catch { return true; } };
  refusals.push(refused(() => context.surfaces.attach({ surface, webContentsId: rogue.id, generation }, host.id)));
  refusals.push(refused(() => context.surfaces.attach({ surface, webContentsId: guest.id, generation }, other.id)));
  refusals.push(refused(() => context.surfaces.attach({ surface, webContentsId: host.window.webContents.id, generation }, host.id)));
  refusals.push(refused(() => context.surfaces.attach({ surface, webContentsId: guest.id, generation: generation + 1 }, host.id)));
  const rogueMainWorld = await rogueContents.executeJavaScript("typeof require");
  const [refusedPartition, refusedSource] = await Promise.all([
    host.mount({ surface: "foreign", partition: "persist:elsewhere", generation, painting: false }, {}),
    host.mount({ surface: "source", partition: guestEntry.partition, generation, painting: false }, { src: "data:text/html,x" }),
  ]);

  const isolation = {
    mainWorld: await guest.executeJavaScript("typeof require"),
    rogueMainWorld,
  };

  await host.show(surface, null);
  const parked = await host.page("getComputedStyle(document.querySelector('webview')).left");
  const opened = await context.surfaces.agent.open({ session: "agent", url, owner });
  const agentGuest = context.guestOf(context.surfaces.agent.sessionSurfaceId("agent"));
  const go = opened.kind === "ok" ? opened.state.nodes.find((node) => node.name === "Go") : undefined;
  const clicked = await context.surfaces.agent.click({ session: "agent", ref: go.ref });
  const capture = await context.surfaces.agent.capture({ session: "agent" });
  const image = nativeImage.createFromBuffer(Buffer.from(capture));
  const bitmap = image.toBitmap();
  const center = (Math.floor(image.getSize().height / 2) * image.getSize().width + 4) * 4;
  const paintingAfter = context.surfaces.guests(other.id).find((entry) => entry.surface === context.surfaces.agent.sessionSurfaceId("agent")).painting;
  const frame = await context.surfaces.captureFrame({ surface });

  await host.show(surface, { x: 0, y: 40, width: 800, height: 500 });
  context.events.length = 0;
  await guest.executeJavaScript("window.open('/popup', 'login', 'width=300,height=300'); true", true);
  await until(() => context.surfaces.surface(surface).popup !== undefined);
  const popup = context.surfaces.surface(surface).popup;
  const popupPrefs = popup.webContents.getLastWebPreferences();
  const popupSession = popup.webContents.session === guest.session;
  await guest.executeJavaScript("window.open('/tab'); true", true);
  await until(() => context.events.some(({ event }) => event.kind === "browser_open_tab"));
  const openedTab = context.events.find(({ event }) => event.kind === "browser_open_tab")?.event;

  const found = await context.surfaces.find({ surface, text: "hello", direction: "next" });

  context.surfaces.navigate({ surface, action: "zoom-in" });
  const zoomed = guest.getZoomFactor();
  host.window.webContents.setZoomLevel(1);
  const pushed = guest.getZoomFactor();
  host.window.webContents.ipc.emit("nyte:window-zoom", {});
  const restored = guest.getZoomFactor();
  const hostZoom = host.window.webContents.getZoomFactor();

  context.surfaces.navigate({ surface, action: "toggle-devtools" });
  await until(() => guest.isDevToolsOpened() && guest.devToolsWebContents !== null);
  const devtools = guest.isDevToolsOpened();
  context.surfaces.navigate({ surface, action: "toggle-devtools" });
  const rogueClosed = await until(() => rogueContents.isDestroyed(), 300);

  report({
    key,
    entry: { generation: guestEntry.generation, painting: guestEntry.painting, partition: guestEntry.partition.startsWith("persist:nyte-browser-") },
    type: guest.getType(),
    hostedBy: guest.hostWebContents.id === host.id,
    prefs: { sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration, nodeIntegrationInSubFrames: prefs.nodeIntegrationInSubFrames, webSecurity: prefs.webSecurity },
    gate: {
      refusedPartition: refusedPartition ?? null,
      refusedSource: refusedSource ?? null,
      rogue: {
        sandbox: roguePrefs.sandbox,
        contextIsolation: roguePrefs.contextIsolation,
        nodeIntegration: roguePrefs.nodeIntegration,
        preload: roguePrefs.preload ?? null,
        evil,
        handedPartition: rogueAttach?.preferences ?? null,
        session: rogueSession,
        popup: roguePopup,
        closedUnbound: rogueClosed,
      },
      refusals,
    },
    isolation,
    keys: context.keys.map((entry) => entry.key),
    focus: { afterNavigation, whileFocused, afterComposer },
    parked,
    opened: opened.kind,
    agentHost: agentGuest.hostWebContents.id === other.id,
    clicked: clicked.kind,
    captured: { bytes: capture.length, red: bitmap[center + 2], green: bitmap[center + 1] },
    paintingAfter,
    frame: frame && { src: frame.src.slice(0, 23), url: frame.url === url, generation: frame.generation },
    popup: { sandbox: popupPrefs.sandbox, contextIsolation: popupPrefs.contextIsolation, nodeIntegration: popupPrefs.nodeIntegration, webviewTag: popupPrefs.webviewTag ?? false, session: popupSession },
    openedTab: openedTab && { url: openedTab.url, background: openedTab.background },
    found: found.total,
    zoom: { zoomed, pushed, restored, hostZoom },
    devtools,
  });
  pages.close();
`,
      }),
    );

    expect(report).toEqual({
      key: true,
      entry: { generation: 0, painting: false, partition: true },
      type: "webview",
      hostedBy: true,
      prefs: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        webSecurity: true,
      },
      gate: {
        refusedPartition: null,
        refusedSource: null,
        rogue: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          preload: null,
          evil: [],
          handedPartition: "persist:elsewhere",
          session: true,
          popup: "null",
          closedUnbound: true,
        },
        refusals: [true, true, true, true],
      },
      isolation: { mainWorld: "undefined", rogueMainWorld: "undefined" },
      keys: ["k"],
      focus: {
        afterNavigation: { active: "composer", guestFocused: false, focused: null },
        whileFocused: "tab",
        afterComposer: null,
      },
      parked: "-100000px",
      opened: "ok",
      agentHost: true,
      clicked: "ok",
      captured: { bytes: expect.any(Number), red: 255, green: 0 },
      paintingAfter: false,
      frame: { src: "data:image/jpeg;base64,", url: true, generation: 0 },
      popup: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
        session: true,
      },
      openedTab: { url: expect.stringMatching(/\/tab$/), background: false },
      found: 1,
      zoom: { zoomed: 1.1, pushed: 1.2, restored: 1.1, hostZoom: 1.2 },
      devtools: true,
    });
  },
  120_000,
);

test.runIf(enabled)(
  "a page lives in one window's renderer, waits there for an agent, and follows the window a tab shows it in",
  async () => {
    const report: unknown = JSON.parse(
      await runBrowserHarness({
        script: `${PAGES}
  const context = browser();
  const session = "agent";
  const surface = context.surfaces.agent.sessionSurfaceId(session);
  const lonely = await context.surfaces.agent.open({ session, url, owner });

  const first = await context.guestWindow();
  const second = await context.guestWindow();
  const recovered = await context.surfaces.agent.snapshot({ session });
  const agentHost = context.guestOf(surface).hostWebContents.id;

  for (const window of [first, second]) context.surfaces.open({ surface, url, owner, holder: "tab" }, window.id);
  await second.show(surface, { x: 0, y: 0, width: 400, height: 300 });
  await first.show(surface, { x: 0, y: 0, width: 400, height: 300 });
  const guest = await context.attached(surface);
  await until(() => !guest.isLoading() && guest.getURL() === url);
  const page = context.surfaces.surface(surface);
  const shown = { visible: page.visible, host: guest.hostWebContents.id === first.id };

  context.surfaces.close({ surface }, second.id);
  const afterOtherTabCloses = { visible: page.visible, same: context.guestOf(surface) === guest };

  second.window.destroy();
  context.windows.delete(second.id);
  context.surfaces.releaseWindow(second.id);
  const afterOtherWindowCloses = { visible: page.visible, same: context.guestOf(surface) === guest };

  context.surfaces.close({ surface }, first.id);
  context.surfaces.agent.release({ session });
  await until(() => guest.isDestroyed());
  const lists = context.events
    .filter(({ event, window }) => event.kind === "browser_guests" && window === first.id)
    .map(({ event }) => event.guests.map((entry) => entry.surface));
  const lastList = lists.at(-1);

  const boardPage = "design-page:1";
  context.surfaces.open({ surface: boardPage, url, owner, holder: "board" }, first.id);
  const survivor = context.surfaces.agent.sessionSurfaceId("survivor");
  await context.surfaces.agent.open({ session: "survivor", url, owner });
  const before = context.guestOf(survivor);
  await first.reload();
  const afterReload = await context.surfaces.agent.snapshot({ session: "survivor" });
  const remounted = context.guestOf(survivor);
  const reload = {
    tabClosed: context.surfaces.surface(boardPage) === undefined,
    agentPage: afterReload.kind,
    freshGuest: remounted !== undefined && remounted !== before && remounted.hostWebContents.id === first.id,
  };
  context.surfaces.agent.release({ session: "survivor" });

  report({
    lonely: lonely.kind === "failed" ? lonely.failure.kind : lonely.kind,
    recovered: recovered.kind,
    agentHost: agentHost === first.id,
    shown,
    afterOtherTabCloses,
    afterOtherWindowCloses,
    destroyedWhenUnheld: context.surfaces.surface(surface) === undefined,
    guestDestroyed: guest.isDestroyed(),
    lastList,
    reload,
  });
  pages.close();
`,
      }),
    );

    expect(report).toEqual({
      lonely: "closed",
      recovered: "ok",
      agentHost: true,
      shown: { visible: true, host: true },
      afterOtherTabCloses: { visible: true, same: true },
      afterOtherWindowCloses: { visible: true, same: true },
      destroyedWhenUnheld: true,
      guestDestroyed: true,
      lastList: [],
      reload: { tabClosed: true, agentPage: "ok", freshGuest: true },
    });
  },
  120_000,
);
