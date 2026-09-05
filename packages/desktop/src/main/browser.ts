/** Browser panel pages: one `WebContentsView` per surface in a guest partition. */
import { app, session, WebContentsView } from "electron";
import type { BrowserWindow, Session, WebContents } from "electron";
import type {
  BrowserBoundsMessage,
  BrowserNavigationAction,
  BrowserSurfaceState,
  HostEvent,
  HostBridge,
} from "../shared/ipc.ts";
import type { Blocker } from "./adblock.ts";
import {
  httpsUpgrade,
  permissionAllowed,
  plainRetry,
  surfaceSecurity,
  webUrl,
} from "./browser-policy.ts";

const PARTITION = "persist:nyte-browser";

export interface BrowserSurfaces {
  menu: HostBridge["browser"]["menu"];
  perform: HostBridge["browser"]["perform"];
  open(input: { readonly surface: string; readonly url: string }): BrowserSurfaceState;
  navigate(input: { readonly surface: string; readonly action: BrowserNavigationAction }): void;
  close(input: { readonly surface: string }): void;
  setBounds(message: BrowserBoundsMessage): void;
  /** Load the filter engine ahead of the first page so that open is not the slow path. */
  warm(): Promise<void>;
  dispose(): void;
}

export interface BrowserSurfacesDependencies {
  readonly window: () => BrowserWindow | undefined;
  readonly emit: (event: HostEvent) => void;
  readonly filterListPath: string;
}

interface Surface {
  readonly id: string;
  readonly view: WebContentsView;
  bounds: BrowserBoundsMessage["bounds"];
  visible: boolean;
  attached: boolean;
  blocked: number;
  error: BrowserSurfaceState["error"];
}

function guestUserAgent(): string {
  return app.userAgentFallback
    .split(" ")
    .filter((token) => !token.startsWith("Electron/") && !token.startsWith(`${app.name}/`))
    .join(" ");
}

export function createBrowserSurfaces(dependencies: BrowserSurfacesDependencies): BrowserSurfaces {
  const surfaces = new Map<string, Surface>();
  const byWebContents = new Map<number, Surface>();
  const upgrades = new Map<number, string>();
  const plainHosts = new Set<string>();
  let guestSession: Session | undefined;
  let blocker: Blocker | undefined;
  let blockerReady: Promise<void> | undefined;

  const ensureBlocker = (): Promise<void> => {
    blockerReady ??= import("./adblock.ts")
      .then(({ loadBlocker }) => loadBlocker(dependencies.filterListPath))
      .then((loaded) => {
        blocker = loaded;
      });
    return blockerReady;
  };

  const ensureSession = (): Session => {
    if (guestSession !== undefined) return guestSession;
    void ensureBlocker();
    const guest = session.fromPartition(PARTITION);
    guest.setUserAgent(guestUserAgent());
    guest.setSpellCheckerEnabled(false);
    guest.setPermissionRequestHandler((_contents, permission, callback) => {
      callback(permissionAllowed(permission));
    });
    guest.setPermissionCheckHandler((_contents, permission) => permissionAllowed(permission));
    guest.on("will-download", (event, item, contents) => {
      event.preventDefault();
      const surface = byWebContents.get(contents.id);
      if (surface === undefined) return;
      dependencies.emit({
        kind: "browser_download_refused",
        surface: surface.id,
        url: item.getURL(),
      });
    });
    guest.webRequest.onBeforeRequest((details, callback) => {
      if (blocker !== undefined) {
        const decision = blocker.decide(details);
        if (decision.kind !== "allow") {
          const surface =
            details.webContentsId === undefined
              ? undefined
              : byWebContents.get(details.webContentsId);
          if (surface !== undefined) surface.blocked += 1;
          callback(decision.kind === "block" ? { cancel: true } : { redirectURL: decision.url });
          return;
        }
      }
      if (details.resourceType !== "mainFrame") {
        callback({});
        return;
      }
      const upgraded = httpsUpgrade(details.url, plainHosts);
      if (upgraded === undefined) {
        callback({});
        return;
      }
      if (details.webContentsId !== undefined) upgrades.set(details.webContentsId, details.url);
      callback({ redirectURL: upgraded });
    });
    guest.webRequest.onBeforeSendHeaders((details, callback) => {
      callback({ requestHeaders: { ...details.requestHeaders, "Sec-GPC": "1" } });
    });
    guestSession = guest;
    return guest;
  };

  const stateOf = (surface: Surface): BrowserSurfaceState => {
    const contents = surface.view.webContents;
    if (contents.isDestroyed()) {
      return {
        url: "",
        title: "",
        loading: false,
        canGoBack: false,
        canGoForward: false,
        secure: "none",
        blocking: blocker !== undefined,
        blocked: surface.blocked,
        error: surface.error,
      };
    }
    const url = contents.getURL();
    return {
      url,
      title: contents.getTitle(),
      loading: contents.isLoading(),
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
      secure: surfaceSecurity(url),
      blocking: blocker !== undefined,
      blocked: surface.blocked,
      error: surface.error,
    };
  };

  const publish = (surface: Surface): void => {
    dependencies.emit({ kind: "browser_changed", surface: surface.id, state: stateOf(surface) });
  };

  const apply = (surface: Surface): void => {
    const window = dependencies.window();
    if (window === undefined || window.isDestroyed()) return;
    if (!surface.attached) {
      window.contentView.addChildView(surface.view);
      surface.attached = true;
    }
    surface.view.setBounds(surface.bounds);
    surface.view.setVisible(surface.visible && surface.error === undefined);
  };

  const load = (surface: Surface, url: string): void => {
    surface.error = undefined;
    void ensureBlocker().then(() => {
      const contents = surface.view.webContents;
      if (!contents.isDestroyed()) return contents.loadURL(url).catch(() => undefined);
      return undefined;
    });
  };

  const wire = (surface: Surface, contents: WebContents): void => {
    contents.setWindowOpenHandler(({ url }) => {
      const target = webUrl(url);
      if (target !== undefined) load(surface, target);
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      if (webUrl(url) === undefined) event.preventDefault();
    });
    contents.on("did-start-navigation", (details) => {
      if (details.isMainFrame && !details.isSameDocument) surface.blocked = 0;
    });
    contents.on("did-start-loading", () => {
      surface.error = undefined;
      apply(surface);
      publish(surface);
    });
    contents.on("did-stop-loading", () => publish(surface));
    contents.on("did-navigate", () => {
      upgrades.delete(contents.id);
      publish(surface);
    });
    contents.on("dom-ready", () => {
      const styles = blocker?.stylesFor(contents.getURL()) ?? "";
      if (styles !== "")
        void contents.insertCSS(styles, { cssOrigin: "user" }).catch(() => undefined);
      publish(surface);
    });
    contents.on("did-navigate-in-page", (_event, _url, isMainFrame) => {
      if (isMainFrame) publish(surface);
    });
    contents.on("page-title-updated", () => publish(surface));
    contents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame) return;
        const retry = plainRetry(validatedURL, upgrades.get(contents.id), errorCode);
        upgrades.delete(contents.id);
        if (retry !== undefined) {
          plainHosts.add(new URL(retry).host);
          load(surface, retry);
          return;
        }
        if (errorCode === -3) return;
        surface.error = { code: errorCode, description: errorDescription };
        apply(surface);
        publish(surface);
      },
    );
    contents.on("render-process-gone", (_event, details) => {
      surface.error = { code: 0, description: `The page stopped (${details.reason})` };
      apply(surface);
      publish(surface);
    });
  };

  const create = (id: string): Surface => {
    const guest = ensureSession();
    const view = new WebContentsView({
      webPreferences: {
        session: guest,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
        backgroundThrottling: true,
        devTools: false,
      },
    });
    const surface: Surface = {
      id,
      view,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      visible: false,
      attached: false,
      blocked: 0,
      error: undefined,
    };
    surfaces.set(id, surface);
    byWebContents.set(view.webContents.id, surface);
    wire(surface, view.webContents);
    return surface;
  };

  const destroy = (surface: Surface): void => {
    surfaces.delete(surface.id);
    const contents = surface.view.webContents;
    byWebContents.delete(contents.id);
    upgrades.delete(contents.id);
    const window = dependencies.window();
    if (surface.attached && window !== undefined && !window.isDestroyed()) {
      window.contentView.removeChildView(surface.view);
    }
    if (!contents.isDestroyed()) contents.close();
  };

  return {
    open({ surface: id, url }) {
      const target = webUrl(url);
      if (target === undefined) throw new Error("Only web addresses can open in the browser panel");
      const surface = surfaces.get(id) ?? create(id);
      const contents = surface.view.webContents;
      if (contents.getURL() !== target || surface.error !== undefined) load(surface, target);
      return stateOf(surface);
    },
    navigate({ surface: id, action }) {
      const surface = surfaces.get(id);
      if (surface === undefined) return;
      const contents = surface.view.webContents;
      if (contents.isDestroyed()) return;
      switch (action) {
        case "back":
          contents.navigationHistory.goBack();
          return;
        case "forward":
          contents.navigationHistory.goForward();
          return;
        case "reload":
          surface.error = undefined;
          contents.reload();
          return;
        case "stop":
          contents.stop();
          return;
        default: {
          const _exhaustive: never = action;
          return _exhaustive;
        }
      }
    },
    async menu(input) {
      const contents = surfaces.get(input.surface)?.view.webContents;
      const hasPage = contents !== undefined && !contents.isDestroyed() && contents.getURL() !== "";
      const { showBrowserMenu } = await import("./browser-actions.ts");
      return showBrowserMenu({ window: dependencies.window(), hasPage, input });
    },
    async perform({ surface: id, action }) {
      if (action === "clear-history") {
        for (const surface of surfaces.values()) {
          const contents = surface.view.webContents;
          if (contents.isDestroyed()) continue;
          contents.navigationHistory.clear();
          publish(surface);
        }
        return;
      }
      const { performBrowserAction } = await import("./browser-actions.ts");
      return performBrowserAction({
        action,
        contents: surfaces.get(id)?.view.webContents,
        guest: ensureSession(),
        window: dependencies.window(),
      });
    },
    close({ surface: id }) {
      const surface = surfaces.get(id);
      if (surface !== undefined) destroy(surface);
    },
    setBounds({ surface: id, bounds, visible }) {
      const surface = surfaces.get(id);
      if (surface === undefined) return;
      surface.bounds = {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      };
      surface.visible = visible;
      apply(surface);
    },
    warm() {
      return ensureBlocker();
    },
    dispose() {
      for (const surface of surfaces.values()) {
        surface.attached = false;
        destroy(surface);
      }
    },
  };
}
