import type { IpcMainEvent, WebContents } from "electron";
import type { BrowserKey } from "@nyte-ai/app/bridge.ts";
import { BROWSER_PAGE_KEY_CHANNEL } from "../shared/browser-page.ts";
import {
  crashRetryDelay,
  onLocalNetwork,
  plainRetry,
  rememberPressedKey,
  takePressedKey,
  webUrl,
} from "./browser-policy.ts";
import { attachConsoleCapture } from "./browser-runtime.ts";
import { hasViewHolder } from "./browser-surface.ts";
import type { Surface, SurfaceRegistry } from "./browser-surface.ts";
import { decodeBrowserKey } from "./ipc-inputs.ts";

const ABORTED = -3;

function wirePopups(registry: SurfaceRegistry, surface: Surface, contents: WebContents): void {
  contents.setWindowOpenHandler(({ url, disposition }) => {
    const target = webUrl(url);

    if (target === undefined) return { action: "deny" };

    const held = hasViewHolder(surface);
    const wantsTab = disposition === "foreground-tab" || disposition === "background-tab";

    if (wantsTab && held) {
      registry.notify(surface, {
        kind: "browser_open_tab",
        surface: surface.id,
        url: target,
        background: disposition === "background-tab",
      });

      return { action: "deny" };
    }

    if (disposition === "new-window" && held && surface.popup === undefined) {
      const parent = surface.attachedTo;

      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          parent: parent !== undefined && !parent.isDestroyed() ? parent : undefined,
          width: 520,
          height: 680,
          autoHideMenuBar: true,
          webPreferences: {
            session: surface.guestSession.session,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            devTools: false,
          },
        },
      };
    }

    registry.load(surface, target);

    return { action: "deny" };
  });
  contents.on("did-create-window", (popup) => {
    surface.popup = popup;
    const child = popup.webContents;

    child.setWindowOpenHandler(() => ({ action: "deny" }));
    child.on("will-navigate", (event, url) => {
      if (webUrl(url) === undefined) event.preventDefault();
    });
    popup.once("closed", () => {
      if (surface.popup === popup) surface.popup = undefined;
    });
  });
}

function wireTrust(registry: SurfaceRegistry, surface: Surface, contents: WebContents): void {
  contents.on("login", (event, _details, authInfo, callback) => {
    if (authInfo.isProxy || !hasViewHolder(surface)) return;
    event.preventDefault();
    surface.login?.();
    surface.login = callback;
    registry.notify(surface, {
      kind: "browser_login_requested",
      surface: surface.id,
      host: authInfo.host,
      realm: authInfo.realm,
    });
  });
  contents.on("certificate-error", (event, url, _error, _certificate, callback, isMainFrame) => {
    let parsed: URL;

    try {
      parsed = new URL(url);
    } catch {
      callback(false);

      return;
    }

    if (surface.guestSession.trustedCertificateHosts.has(parsed.host)) {
      event.preventDefault();
      callback(true);

      return;
    }

    if (isMainFrame && onLocalNetwork(parsed.hostname)) surface.untrustedHost = parsed.host;
    callback(false);
  });
}

async function watchPauses(contents: WebContents): Promise<void> {
  if (!contents.debugger.isAttached()) contents.debugger.attach("1.3");
  await contents.debugger.sendCommand("Debugger.enable");
  await contents.debugger.sendCommand("Debugger.setBreakpointsActive", { active: false });
}

function wireKeys(registry: SurfaceRegistry, surface: Surface, contents: WebContents): void {
  const forwardFrom =
    (source: WebContents, user: (key: BrowserKey) => boolean) =>
    (event: IpcMainEvent, message: BrowserKey): void => {
      if (event.senderFrame !== source.mainFrame) return;
      let key: BrowserKey;

      try {
        key = decodeBrowserKey(message);
      } catch {
        return;
      }

      if (user(key)) registry.forwardKey(surface, source, key);
    };

  contents.ipc.on(
    BROWSER_PAGE_KEY_CHANNEL,
    forwardFrom(contents, (key) => takePressedKey(surface.pressed, key)),
  );
  contents.on("devtools-opened", () => {
    const devtools = contents.devToolsWebContents;

    if (devtools !== null)
      devtools.ipc.removeAllListeners(BROWSER_PAGE_KEY_CHANNEL).on(
        BROWSER_PAGE_KEY_CHANNEL,
        forwardFrom(devtools, () => true),
      );
    void watchPauses(contents).catch(() => undefined);
  });
  contents.on("devtools-closed", () => {
    surface.paused = false;

    if (!contents.isDestroyed() && contents.debugger.isAttached())
      void contents.debugger.sendCommand("Debugger.disable").catch(() => undefined);
  });
  contents.debugger.on("message", (_event, method) => {
    if (method === "Debugger.paused") surface.paused = true;

    if (method === "Debugger.resumed") surface.paused = false;
  });
  contents.debugger.on("detach", () => {
    surface.paused = false;
  });
  contents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;

    const key: BrowserKey = {
      key: input.key,
      code: input.code,
      ctrlKey: input.control,
      shiftKey: input.shift,
      altKey: input.alt,
      metaKey: input.meta,
      repeat: input.isAutoRepeat,
    };

    if (surface.view.getVisible() && !contents.isCrashed() && !surface.paused) {
      rememberPressedKey(surface.pressed, key);

      return;
    }

    if (!(input.control || input.alt || input.meta) && !/^F\d+$/.test(input.key)) return;

    if (["Control", "Shift", "Alt", "Meta"].includes(input.key)) return;
    event.preventDefault();
    registry.forwardKey(surface, contents, key);
  });
  contents.on("found-in-page", (_event, result) => {
    const pending = surface.find;

    if (pending === undefined || pending.request !== result.requestId || !result.finalUpdate)
      return;
    surface.find = undefined;
    pending.resolve({ active: result.activeMatchOrdinal, total: result.matches });
  });
}

function wireFullscreen(registry: SurfaceRegistry, surface: Surface, contents: WebContents): void {
  contents.on("enter-html-full-screen", () => {
    const window = surface.attachedTo;

    if (window === undefined || window.isDestroyed()) return;
    surface.fullscreen = true;
    surface.onWindowResize = () => registry.place(surface);
    window.on("resize", surface.onWindowResize);

    if (!window.isFullScreen()) {
      surface.windowWasWindowed = true;
      window.setFullScreen(true);
    }

    registry.place(surface);
    registry.publish(surface);
  });
  contents.on("leave-html-full-screen", () => {
    const window = surface.attachedTo;
    surface.fullscreen = false;

    if (surface.onWindowResize !== undefined && window !== undefined && !window.isDestroyed())
      window.off("resize", surface.onWindowResize);
    surface.onWindowResize = undefined;

    if (surface.windowWasWindowed && window !== undefined && !window.isDestroyed())
      window.setFullScreen(false);
    surface.windowWasWindowed = false;
    registry.place(surface);
    registry.publish(surface);
  });
}

function wireNavigation(registry: SurfaceRegistry, surface: Surface, contents: WebContents): void {
  const guestSession = surface.guestSession;

  contents.on("will-navigate", (event, url) => {
    if (webUrl(url) === undefined) event.preventDefault();
  });
  contents.on("did-start-navigation", (details) => {
    if (!details.isMainFrame || details.isSameDocument) return;
    surface.blocked = 0;
    surface.findText = "";
    surface.untrustedHost = undefined;
    surface.login?.();
    surface.login = undefined;

    if (surface.deniedPermissions.size > 0) surface.deniedPermissions.clear();
  });
  contents.on("did-start-loading", () => {
    surface.error = undefined;
    registry.place(surface);
    registry.publish(surface);
  });
  contents.on("did-stop-loading", () => {
    registry.publish(surface);
    registry.reclaimIdle();
  });
  contents.on("did-navigate", (_event, url) => {
    guestSession.upgrades.delete(contents.id);
    registry.remember(surface, url);
    registry.publish(surface);
  });
  contents.on("dom-ready", () => {
    const styles = registry.blockedStyles(contents.getURL());

    if (styles !== "")
      void contents.insertCSS(styles, { cssOrigin: "user" }).catch(() => undefined);
    registry.publish(surface);
  });
  contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (!isMainFrame) return;
    const previous = surface.visited?.split("#", 1)[0];

    if (previous !== url.split("#", 1)[0]) registry.remember(surface, url);
    registry.publish(surface);
  });
  contents.on("page-title-updated", (_event, title, explicitSet) => {
    const page = webUrl(contents.getURL());

    if (explicitSet && page !== undefined && !surface.destroyed && hasViewHolder(surface))
      void registry.dependencies.history.retitle(surface.owner, { url: page, title });

    registry.publish(surface);
  });
}

function wireFailures(registry: SurfaceRegistry, surface: Surface, contents: WebContents): void {
  const guestSession = surface.guestSession;

  contents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    const retry = plainRetry(validatedURL, guestSession.upgrades.get(contents.id), errorCode);
    guestSession.upgrades.delete(contents.id);

    if (retry !== undefined) {
      guestSession.plainHosts.add(new URL(retry).host);
      registry.load(surface, retry);

      return;
    }

    if (errorCode === ABORTED) return;
    surface.error =
      surface.untrustedHost === undefined
        ? { code: errorCode, description: errorDescription }
        : {
            code: errorCode,
            description: errorDescription,
            untrustedHost: surface.untrustedHost,
          };
    registry.place(surface);
    registry.publish(surface);
  });
  contents.on("render-process-gone", (_event, details) => {
    const now = Date.now();
    surface.crashes.push(now);
    const delay = crashRetryDelay(surface.crashes, now);

    surface.error = {
      code: 0,
      description:
        delay === undefined
          ? `The page stopped (${details.reason})`
          : `The page stopped (${details.reason}). Reloading…`,
    };
    surface.runtime.error = surface.error;
    registry.place(surface);
    registry.publish(surface);

    if (delay === undefined) return;

    setTimeout(() => {
      if (surface.destroyed || contents.isDestroyed()) return;
      surface.error = undefined;
      contents.reload();
    }, delay);
  });
}

export function wireSurface(registry: SurfaceRegistry, surface: Surface): void {
  const contents = surface.view.webContents;

  wirePopups(registry, surface, contents);
  wireTrust(registry, surface, contents);
  wireKeys(registry, surface, contents);
  wireFullscreen(registry, surface, contents);
  wireNavigation(registry, surface, contents);
  wireFailures(registry, surface, contents);
  attachConsoleCapture(contents, surface.runtime);
}
