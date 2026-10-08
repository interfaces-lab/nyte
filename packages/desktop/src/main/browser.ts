/** Browser panel pages: one `WebContentsView` per surface, plus the guest sessions, holders, and agent control over them. */
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { app, session, WebContentsView, webContents } from "electron";
import type { BrowserWindow, DownloadItem, Session, WebContents } from "electron";
import { showBrowserMenu, performBrowserAction } from "./browser-actions.ts";
import type {
  BrowserBoundsMessage,
  BrowserDownload,
  BrowserFindResult,
  BrowserFocusMessage,
  BrowserHistoryEntry,
  BrowserKey,
  BrowserNavigationAction,
  BrowserSurfaceState,
  HostEvent,
  BrowserBridge,
} from "@nyte-ai/app/bridge.ts";
import type { SessionId } from "@nyte-ai/core";
import type { HostSettings } from "@nyte-ai/host/settings";
import { loadBlocker, shieldPaused, type Blocker } from "./adblock.ts";
import {
  crashRetryDelay,
  httpsUpgrade,
  isLocalHost,
  nextZoomFactor,
  permissionAllowed,
  plainRetry,
  surfaceSecurity,
  uniqueDownloadName,
  webUrl,
} from "./browser-policy.ts";
import { BROWSER_PAGE_KEY_CHANNEL } from "../shared/browser-page.ts";
import { ExpectedHostError } from "./errors.ts";
import { decodeBrowserKey } from "./ipc-inputs.ts";
import type { BrowserHistoryStore } from "./browser-history.ts";
import { sessionSurfaceId } from "./browser-agent.ts";
import type { BrowserAgent, BrowserHolder, BrowserOwner, BrowserRect } from "./browser-agent.ts";
import type { HostWindow } from "./host.ts";
import {
  createSurfaceRuntime,
  attachConsoleCapture,
  takeSnapshot,
  performClick,
  performType,
  performPress,
  performScroll,
  performWait,
  performEvaluate,
  performCapture,
} from "./browser-runtime.ts";
import type { SurfaceRuntime } from "./browser-runtime.ts";

/** A surface stays alive while at least one holder retains it. */
interface HolderState {
  readonly holders: Set<BrowserHolder>;
  lastBounds: BrowserRect;
}

/** Per-workspace guest session: its own cookie jar and storage. */
interface GuestSession {
  readonly session: Session;
  readonly plainHosts: Set<string>;
  readonly upgrades: Map<number, string>;
  /** Local hosts whose bad certificate the user chose to proceed past, for this run. */
  readonly trustedCertificateHosts: Set<string>;
}

const DEFAULT_BOUNDS: BrowserRect = { x: 0, y: 0, width: 1280, height: 800 };

/** Off-screen bounds preserving the last known size so the page viewport is never 0×0. */
function offscreenBounds(state: HolderState): BrowserRect {
  const width = state.lastBounds.width > 0 ? state.lastBounds.width : DEFAULT_BOUNDS.width;
  const height = state.lastBounds.height > 0 ? state.lastBounds.height : DEFAULT_BOUNDS.height;

  return { x: -10000, y: -10000, width, height };
}

function hasViewHolder(state: HolderState): boolean {
  for (const holder of state.holders) {
    if (holder.startsWith("view:")) return true;
  }

  return false;
}

function countSessionHolders(state: HolderState): number {
  let count = 0;

  for (const holder of state.holders) {
    if (holder.startsWith("session:")) count += 1;
  }

  return count;
}

/** Returns true when the surface now has zero holders and should be destroyed. */
function release(state: HolderState, holder: BrowserHolder): boolean {
  state.holders.delete(holder);

  return state.holders.size === 0;
}

/** How the renderer names a cookie jar: the workspace path, or null for home. */
function ownerPath(owner: BrowserOwner): string | null {
  return owner.kind === "home" ? null : owner.path;
}

function ownerOf(path: string | null): BrowserOwner {
  return path === null ? { kind: "home" } : { kind: "project", path };
}

function partitionName(owner: BrowserOwner): string {
  if (owner.kind === "home") return "persist:nyte-browser";
  const hash = createHash("sha256").update(owner.path).digest("hex").slice(0, 16);

  return `persist:nyte-browser-${hash}`;
}

export interface BrowserSurfaces {
  menu(
    input: Parameters<BrowserBridge["menu"]>[0],
    window: HostWindow,
  ): ReturnType<BrowserBridge["menu"]>;
  perform(
    input: Parameters<BrowserBridge["perform"]>[0],
    window: HostWindow,
  ): ReturnType<BrowserBridge["perform"]>;
  /** Opening a page places it in the requesting window. */
  open(
    input: {
      readonly surface: string;
      readonly url: string;
      readonly owner?: BrowserOwner;
    },
    window: HostWindow,
  ): BrowserSurfaceState;
  navigate(input: { readonly surface: string; readonly action: BrowserNavigationAction }): void;
  close(input: { readonly surface: string }): void;
  /** The page's current pixels as a data URL, captured without showing the view. */
  captureFrame(input: { readonly surface: string }): Promise<string | undefined>;
  find(input: Parameters<BrowserBridge["find"]>[0]): ReturnType<BrowserBridge["find"]>;
  cancelDownload(input: { readonly surface: string; readonly id: string }): void;
  login(input: Parameters<BrowserBridge["login"]>[0]): void;
  history(input: Parameters<BrowserBridge["history"]>[0]): ReturnType<BrowserBridge["history"]>;
  forgetHistory(
    input: Parameters<BrowserBridge["forgetHistory"]>[0],
  ): ReturnType<BrowserBridge["forgetHistory"]>;
  /** A visible placement moves the page into the reporting window. */
  setBounds(message: BrowserBoundsMessage, window: HostWindow): void;
  /** Retain a surface with a holder. Creates the surface if it does not exist. */
  retain(input: {
    readonly surface: string;
    readonly holder: BrowserHolder;
    readonly owner?: BrowserOwner;
  }): void;
  /** Release a holder from a surface. Destroys the surface when no holders remain. */
  release(input: { readonly surface: string; readonly holder: BrowserHolder }): void;
  /** Load the filter engine ahead of the first page so that open is not the slow path. */
  warm(): Promise<void>;
  /** The window closed: its panels let go, and pages the agent still holds move elsewhere. */
  releaseWindow(window: HostWindow): void;
  /** Settings changed: every page republishes, so a shield badge never shows a stale state. */
  settingsChanged(): void;
  /** The BrowserAgent implementation for the tools plugin. */
  agent: BrowserAgent;
}

/** Keyboard focus across pages and their panels; the window shell routes menu commands by it. */
export interface BrowserFocus {
  /** A panel's controls took or gave up keyboard focus in this window. */
  setFocus(message: BrowserFocusMessage, window: HostWindow): void;
  /** The surface holding keyboard focus: its page, the page's DevTools, or its panel's controls in this window. */
  focused(window: HostWindow | undefined): string | undefined;
}

export interface BrowserSurfacesDependencies {
  /** The open window with this id, or the last focused one when it is gone or unset. */
  readonly window: (id: HostWindow | undefined) => BrowserWindow | undefined;
  readonly emit: (event: HostEvent) => void;
  readonly filterListPath: string;
  /** Whether the window has been shown at least once. Mouse input is dropped until then. */
  readonly windowShown: (window: BrowserWindow) => boolean;
  /** Read per request, so a changed setting applies to the next one. */
  readonly settings: () => Pick<
    HostSettings,
    "blockAds" | "adblockAllowedHosts" | "upgradeToHttps"
  >;
  /** Visits of pages a panel holds, per cookie jar. */
  readonly history: BrowserHistoryStore;
  /** The guest preload that forwards keys a page leaves unhandled. */
  readonly pagePreload: string;
  /** A key the focused page left unhandled, for the window whose panel shows it. */
  readonly forwardKey: (input: {
    readonly surface: string;
    readonly window: HostWindow;
    readonly key: BrowserKey;
  }) => void;
}

interface Surface {
  readonly id: string;
  readonly view: WebContentsView;
  readonly holderState: HolderState;
  readonly runtime: SurfaceRuntime;
  readonly guestSession: GuestSession;
  bounds: BrowserBoundsMessage["bounds"];
  visible: boolean;
  /** The window whose panel last showed this page; agent-only pages have none. */
  home: HostWindow | undefined;
  /** The window the view is a child of. */
  attachedTo: BrowserWindow | undefined;
  /** Set once by destroy. Native events still arrive afterwards and must not touch state. */
  destroyed: boolean;
  /** Agent operations in flight. Throttling is off only while this is above zero. */
  operations: number;
  /** Tick of the last agent operation, so reclamation drops the longest-idle page first. */
  lastUse: number;
  blocked: number;
  error: BrowserSurfaceState["error"];
  owner: BrowserOwner;
  /** The page is in HTML fullscreen and covers the window; bounds reports are ignored. */
  fullscreen: boolean;
  /** Set when entering fullscreen also took the window fullscreen, so leaving restores it. */
  windowWasWindowed: boolean;
  /** Follows the window while fullscreen so the page always fills it. */
  onWindowResize: (() => void) | undefined;
  /** The request id of the find in flight; `found-in-page` answers it. */
  find:
    | { readonly request: number; readonly resolve: (result: BrowserFindResult) => void }
    | undefined;
  /** The text of the open find session; the same text again moves within it. */
  findText: string;
  /** Permissions refused since the page started loading, so the panel can say why. */
  readonly deniedPermissions: Set<string>;
  /** Answers the open HTTP auth challenge; no arguments cancels it. */
  login: ((username?: string, password?: string) => void) | undefined;
  /** A local host whose certificate failed on the current load. */
  untrustedHost: string | undefined;
  /** When the renderer died recently, so reloads back off and then stop. */
  readonly crashes: number[];
  /** The popup this page opened; one at a time, closed with the page. */
  popup: BrowserWindow | undefined;
  /** The URL this page last added to history, so an in-page jump to an anchor adds nothing. */
  visited: string | undefined;
}

/**
 * How many idle agent-only hidden pages stay warm. Beyond this the longest-idle one
 * is closed and its session sees `closed` on its next call, exactly as if it had
 * never opened a page. A starting point, not a measured limit.
 */
const WARM_POOL_LIMIT = 6;

const CLOSED = { kind: "failed", failure: { kind: "closed" } } as const;

function guestUserAgent(): string {
  return app.userAgentFallback
    .split(" ")
    .filter((token) => !token.startsWith("Electron/") && !token.startsWith(`${app.name}/`))
    .join(" ");
}

export function createBrowserSurfaces(
  dependencies: BrowserSurfacesDependencies,
): BrowserSurfaces & BrowserFocus {
  const surfaces = new Map<string, Surface>();
  const byWebContents = new Map<number, Surface>();
  /** Downloads still running, by id, so the panel can cancel one. */
  const downloads = new Map<string, DownloadItem>();
  let blocker: Blocker | undefined;
  let blockerReady: Promise<void> | undefined;
  let useClock = 0;

  /** Per-owner guest sessions, keyed by partition name. */
  const guestSessions = new Map<string, GuestSession>();

  /** The panel whose controls hold each window's keyboard focus. */
  const chromeFocus = new Map<HostWindow, string>();

  const isWindowShown = (surface: Surface): boolean => {
    const window = surface.attachedTo;

    return window !== undefined && !window.isDestroyed() && dependencies.windowShown(window);
  };

  const ensureBlocker = (): Promise<void> => {
    blockerReady ??= loadBlocker(dependencies.filterListPath).then((loaded) => {
      blocker = loaded;
    });

    return blockerReady;
  };

  const blockingFor = (url: string): BrowserSurfaceState["blocking"] => {
    const settings = dependencies.settings();

    if (blocker === undefined || !settings.blockAds) return "off";

    return shieldPaused(url, settings.adblockAllowedHosts) ? "paused" : "on";
  };

  const blockingOf = (surface: Surface): BrowserSurfaceState["blocking"] => {
    const contents = surface.view.webContents;

    return blockingFor(contents.isDestroyed() ? "" : contents.getURL());
  };

  const ensureGuestSession = (owner: BrowserOwner): GuestSession => {
    const partition = partitionName(owner);
    const existing = guestSessions.get(partition);

    if (existing !== undefined) return existing;

    void ensureBlocker();

    const guest = session.fromPartition(partition);
    const plainHosts = new Set<string>();
    const upgrades = new Map<number, string>();

    guest.setUserAgent(guestUserAgent());
    guest.setSpellCheckerEnabled(false);

    guest.setPermissionRequestHandler((contents, permission, callback) => {
      const allowed = permissionAllowed(permission);

      if (!allowed) {
        const surface = byWebContents.get(contents.id);

        if (surface !== undefined && !surface.deniedPermissions.has(permission)) {
          surface.deniedPermissions.add(permission);
          publish(surface);
        }
      }

      callback(allowed);
    });
    guest.setPermissionCheckHandler((_contents, permission) => permissionAllowed(permission));

    guest.on("will-download", (event, item, contents) => {
      const surface = byWebContents.get(contents.id);

      // Only a page the user alone drives may write to disk. A page an agent holds is
      // refused even while a panel shows it: revealing a tab is not consent to download.
      if (
        surface === undefined ||
        !hasViewHolder(surface.holderState) ||
        countSessionHolders(surface.holderState) > 0
      ) {
        event.preventDefault();

        return;
      }

      const folder = app.getPath("downloads");
      const id = randomUUID();

      const path = join(
        folder,
        uniqueDownloadName(item.getFilename(), (name) => existsSync(join(folder, name))),
      );

      item.setSavePath(path);
      downloads.set(id, item);

      const report = (state: BrowserDownload["state"]): void => {
        dependencies.emit({
          kind: "browser_download",
          surface: surface.id,
          download: {
            id,
            url: item.getURL(),
            filename: basename(path),
            path,
            received: item.getReceivedBytes(),
            total: item.getTotalBytes(),
            state,
          },
        });
      };

      let reported = 0;
      report("progressing");
      item.on("updated", (_event, state) => {
        const now = Date.now();

        if (state === "progressing" && now - reported < 250) return;
        reported = now;
        report(state);
      });
      item.once("done", (_event, state) => {
        downloads.delete(id);
        report(state);
      });
    });

    guest.webRequest.onBeforeRequest((details, callback) => {
      const surface =
        details.webContentsId === undefined ? undefined : byWebContents.get(details.webContentsId);

      const blocking = surface === undefined ? blockingFor("") : blockingOf(surface);

      if (blocker !== undefined && blocking === "on") {
        const decision = blocker.decide(details);

        if (decision.kind !== "allow") {
          if (surface !== undefined) surface.blocked += 1;

          callback(decision.kind === "block" ? { cancel: true } : { redirectURL: decision.url });

          return;
        }
      }

      if (details.resourceType !== "mainFrame") {
        callback({});

        return;
      }

      const upgraded = dependencies.settings().upgradeToHttps
        ? httpsUpgrade(details.url, plainHosts)
        : undefined;

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

    const guestSession: GuestSession = {
      session: guest,
      plainHosts,
      upgrades,
      trustedCertificateHosts: new Set(),
    };

    guestSessions.set(partition, guestSession);

    return guestSession;
  };

  const stateOf = (surface: Surface): BrowserSurfaceState => {
    const contents = surface.view.webContents;
    const agentHolders = countSessionHolders(surface.holderState);

    if (contents.isDestroyed()) {
      return {
        url: "",
        title: "",
        loading: false,
        canGoBack: false,
        canGoForward: false,
        secure: "none",
        blocking: "off",
        blocked: surface.blocked,
        error: surface.error,
        agentHolders,
        fullscreen: false,
        deniedPermissions: [],
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
      blocking: blockingFor(url),
      blocked: surface.blocked,
      error: surface.error,
      agentHolders,
      fullscreen: surface.fullscreen,
      deniedPermissions: [...surface.deniedPermissions],
    };
  };

  const publish = (surface: Surface): void => {
    if (surface.destroyed) return;
    dependencies.emit({ kind: "browser_changed", surface: surface.id, state: stateOf(surface) });
  };

  const publishHistory = (
    owner: BrowserOwner,
    entries: readonly BrowserHistoryEntry[] | undefined,
  ): void => {
    if (entries === undefined) return;
    dependencies.emit({ kind: "browser_history_changed", owner: ownerPath(owner), entries });
  };

  /**
   * History holds what a person saw: a page a panel holds, never one an agent
   * drives on its own, so a crawl cannot bury the user's own visits.
   */
  const remember = (surface: Surface, url: string): void => {
    const page = webUrl(url);

    if (surface.destroyed || page === undefined || !hasViewHolder(surface.holderState)) return;
    surface.visited = page;
    void dependencies.history
      .record(surface.owner, { url: page, at: Date.now() })
      .then((entries) => publishHistory(surface.owner, entries));
  };

  /**
   * A hidden page keeps keyboard focus unless it is handed back, which leaves a
   * menu that just opened over the page unable to receive arrow keys.
   */
  const hide = (surface: Surface, window: BrowserWindow): void => {
    const contents = surface.view.webContents;
    const held = !contents.isDestroyed() && contents.isFocused();
    surface.view.setVisible(false);

    if (held) window.webContents.focus();
  };

  const apply = (surface: Surface): void => {
    if (surface.destroyed) return;
    const window = dependencies.window(surface.home);

    if (window === undefined || window.isDestroyed()) return;

    if (surface.attachedTo !== window) {
      if (surface.attachedTo !== undefined && !surface.attachedTo.isDestroyed()) {
        surface.attachedTo.contentView.removeChildView(surface.view);
      }

      window.contentView.addChildView(surface.view);
      surface.attachedTo = window;
    }

    // A zero-sized view lays the page out at a 0-wide viewport, which changes what is
    // visible and ruins screenshots, so an unplaced or unmeasured surface is parked
    // off-screen at a real size instead.
    const placed =
      hasViewHolder(surface.holderState) && surface.bounds.width > 0 && surface.bounds.height > 0;

    if (surface.fullscreen && placed) {
      const { width, height } = window.getContentBounds();
      surface.view.setBounds({ x: 0, y: 0, width, height });
      surface.view.setVisible(true);

      return;
    }

    if (!placed) {
      hide(surface, window);
      surface.view.setBounds(offscreenBounds(surface.holderState));

      return;
    }

    surface.view.setBounds(surface.bounds);

    if (surface.visible && surface.error === undefined) surface.view.setVisible(true);
    else hide(surface, window);
  };

  const load = (surface: Surface, url: string): void => {
    surface.error = undefined;
    void ensureBlocker().then(() => {
      const contents = surface.view.webContents;

      if (surface.destroyed || contents.isDestroyed()) return undefined;

      return contents.loadURL(url).catch(() => undefined);
    });
  };

  const wire = (surface: Surface, contents: WebContents): void => {
    const guestSession = surface.guestSession;

    contents.setWindowOpenHandler(({ url, disposition }) => {
      const target = webUrl(url);

      if (target === undefined) return { action: "deny" };

      const held = hasViewHolder(surface.holderState);
      const wantsTab = disposition === "foreground-tab" || disposition === "background-tab";

      // A tab-opening gesture on a page someone is looking at becomes a tab.
      if (wantsTab && held) {
        dependencies.emit({
          kind: "browser_open_tab",
          surface: surface.id,
          url: target,
          background: disposition === "background-tab",
        });

        return { action: "deny" };
      }

      // A sized `window.open` is a popup flow, typically sign-in: it needs a real
      // window with `window.opener` so it can report back. One at a time, only for
      // a page someone is looking at, and never nested.
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
              session: guestSession.session,
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false,
              devTools: false,
            },
          },
        };
      }

      // Anything else follows the link in place, so an agent-only page still lands somewhere.
      load(surface, target);

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
    contents.on("login", (event, _details, authInfo, callback) => {
      // Proxy challenges and pages nobody is looking at get Chromium's default: cancel.
      if (authInfo.isProxy || !hasViewHolder(surface.holderState)) return;
      event.preventDefault();
      surface.login?.();
      surface.login = callback;
      dependencies.emit({
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

      if (guestSession.trustedCertificateHosts.has(parsed.host)) {
        event.preventDefault();
        callback(true);

        return;
      }

      // Only a dev server on this machine may be trusted past a bad certificate.
      if (isMainFrame && isLocalHost(parsed.hostname)) surface.untrustedHost = parsed.host;
      callback(false);
    });
    contents.ipc.on(BROWSER_PAGE_KEY_CHANNEL, (event, message) => {
      if (event.senderFrame !== contents.mainFrame) return;
      let key: BrowserKey;

      try {
        key = decodeBrowserKey(message);
      } catch {
        return;
      }

      forwardKey(surface, key);
    });
    // A hidden or crashed page runs no preload, so its command keys are forwarded from here.
    contents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown" || (surface.view.getVisible() && !contents.isCrashed())) return;

      if (!(input.control || input.alt || input.meta) && !/^F\d+$/.test(input.key)) return;

      if (["Control", "Shift", "Alt", "Meta"].includes(input.key)) return;
      event.preventDefault();
      forwardKey(surface, {
        key: input.key,
        code: input.code,
        ctrlKey: input.control,
        shiftKey: input.shift,
        altKey: input.alt,
        metaKey: input.meta,
        repeat: input.isAutoRepeat,
      });
    });
    contents.on("found-in-page", (_event, result) => {
      const pending = surface.find;

      if (pending === undefined || pending.request !== result.requestId || !result.finalUpdate)
        return;
      surface.find = undefined;
      pending.resolve({ active: result.activeMatchOrdinal, total: result.matches });
    });
    contents.on("enter-html-full-screen", () => {
      const window = surface.attachedTo;

      if (window === undefined || window.isDestroyed()) return;
      surface.fullscreen = true;
      surface.onWindowResize = () => apply(surface);
      window.on("resize", surface.onWindowResize);

      if (!window.isFullScreen()) {
        surface.windowWasWindowed = true;
        window.setFullScreen(true);
      }

      apply(surface);
      publish(surface);
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
      apply(surface);
      publish(surface);
    });
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
      apply(surface);
      publish(surface);
    });
    contents.on("did-stop-loading", () => {
      publish(surface);
      reclaimIdle();
    });
    contents.on("did-navigate", (_event, url) => {
      guestSession.upgrades.delete(contents.id);
      remember(surface, url);
      publish(surface);
    });
    contents.on("dom-ready", () => {
      const url = contents.getURL();
      const styles = blockingFor(url) === "on" ? (blocker?.stylesFor(url) ?? "") : "";

      if (styles !== "")
        void contents.insertCSS(styles, { cssOrigin: "user" }).catch(() => undefined);
      publish(surface);
    });
    contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      if (!isMainFrame) return;
      const previous = surface.visited?.split("#", 1)[0];

      if (previous !== url.split("#", 1)[0]) remember(surface, url);
      publish(surface);
    });
    contents.on("page-title-updated", (_event, title, explicitSet) => {
      const page = webUrl(contents.getURL());

      if (explicitSet && page !== undefined) {
        void dependencies.history
          .retitle(surface.owner, { url: page, title })
          .then((entries) => publishHistory(surface.owner, entries));
      }

      publish(surface);
    });
    contents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame) return;
        const retry = plainRetry(validatedURL, guestSession.upgrades.get(contents.id), errorCode);
        guestSession.upgrades.delete(contents.id);

        if (retry !== undefined) {
          guestSession.plainHosts.add(new URL(retry).host);
          load(surface, retry);

          return;
        }

        if (errorCode === -3) return;
        surface.error =
          surface.untrustedHost === undefined
            ? { code: errorCode, description: errorDescription }
            : {
                code: errorCode,
                description: errorDescription,
                untrustedHost: surface.untrustedHost,
              };
        apply(surface);
        publish(surface);
      },
    );
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
      apply(surface);
      publish(surface);

      if (delay === undefined) return;

      setTimeout(() => {
        if (surface.destroyed || contents.isDestroyed()) return;
        surface.error = undefined;
        contents.reload();
      }, delay);
    });

    attachConsoleCapture(contents, surface.runtime);
  };

  const forwardKey = (surface: Surface, key: BrowserKey): void => {
    if (surface.destroyed || surface.home === undefined) return;
    dependencies.forwardKey({ surface: surface.id, window: surface.home, key });
  };

  const create = (id: string, owner: BrowserOwner): Surface => {
    const guestSession = ensureGuestSession(owner);

    const view = new WebContentsView({
      webPreferences: {
        session: guestSession.session,
        preload: dependencies.pagePreload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
      },
    });

    const surface: Surface = {
      id,
      view,
      holderState: { holders: new Set(), lastBounds: DEFAULT_BOUNDS },
      runtime: createSurfaceRuntime(),
      guestSession,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      visible: false,
      home: undefined,
      attachedTo: undefined,
      destroyed: false,
      operations: 0,
      lastUse: ++useClock,
      blocked: 0,
      error: undefined,
      owner,
      fullscreen: false,
      windowWasWindowed: false,
      onWindowResize: undefined,
      find: undefined,
      findText: "",
      deniedPermissions: new Set(),
      login: undefined,
      untrustedHost: undefined,
      crashes: [],
      popup: undefined,
      visited: undefined,
    };

    surfaces.set(id, surface);
    byWebContents.set(view.webContents.id, surface);
    wire(surface, view.webContents);

    return surface;
  };

  const destroy = (surface: Surface): void => {
    if (surface.destroyed) return;
    surface.destroyed = true;
    surfaces.delete(surface.id);

    for (const [window, id] of chromeFocus) {
      if (id === surface.id) chromeFocus.delete(window);
    }

    const contents = surface.view.webContents;
    byWebContents.delete(contents.id);
    surface.guestSession.upgrades.delete(contents.id);
    surface.find?.resolve({ active: 0, total: 0 });
    surface.find = undefined;
    surface.login?.();
    surface.login = undefined;

    if (surface.popup !== undefined && !surface.popup.isDestroyed()) surface.popup.close();
    surface.popup = undefined;
    const window = surface.attachedTo;

    if (window !== undefined && !window.isDestroyed()) {
      if (surface.onWindowResize !== undefined) window.off("resize", surface.onWindowResize);

      if (surface.windowWasWindowed) window.setFullScreen(false);
      window.contentView.removeChildView(surface.view);
    }

    surface.attachedTo = undefined;

    if (!contents.isDestroyed()) contents.close();
  };

  /**
   * An idle page nobody is looking at: no panel holds it, it is not placed, not
   * loading, and no agent call is running against it. View-held pages are never
   * candidates.
   */
  const reclaimable = (surface: Surface): boolean => {
    if (surface.operations > 0 || surface.visible || hasViewHolder(surface.holderState)) {
      return false;
    }

    const contents = surface.view.webContents;

    return contents.isDestroyed() || !contents.isLoading();
  };

  const reclaimIdle = (): void => {
    const idle = [...surfaces.values()].filter(reclaimable).sort((a, b) => a.lastUse - b.lastUse);

    for (const surface of idle.slice(0, Math.max(0, idle.length - WARM_POOL_LIMIT))) {
      destroy(surface);
    }
  };

  /** Drop a holder; the surface closes when none remain, and idle pages are trimmed. */
  const dropHolder = (surface: Surface, holder: BrowserHolder): void => {
    if (release(surface.holderState, holder)) {
      destroy(surface);

      return;
    }

    apply(surface);
    reclaimIdle();
  };

  /**
   * Background throttling is off only while an agent call runs against this
   * surface. Electron never throttles a visible page, so this only changes what a
   * hidden page does between calls. Calls may overlap; the count, not a lock, owns it.
   */
  const operate = async <T>(
    surface: Surface,
    run: (contents: WebContents) => Promise<T>,
  ): Promise<T> => {
    const contents = surface.view.webContents;
    surface.operations += 1;
    surface.lastUse = ++useClock;

    try {
      if (surface.operations === 1 && !contents.isDestroyed()) {
        contents.setBackgroundThrottling(false);
      }

      reclaimIdle();

      return await run(contents);
    } finally {
      surface.operations -= 1;
      surface.lastUse = ++useClock;

      if (surface.operations === 0 && !surface.destroyed && !contents.isDestroyed()) {
        contents.setBackgroundThrottling(true);
      }

      reclaimIdle();
    }
  };

  /** Resolve a surface for an agent session, or fail. */
  const surfaceForSession = (sessionId: SessionId): Surface | undefined => {
    return surfaces.get(sessionSurfaceId(sessionId));
  };

  const agent: BrowserAgent = {
    async open(input) {
      const target = webUrl(input.url);

      if (target === undefined) return CLOSED;

      const surfId = sessionSurfaceId(input.session);
      const holder: BrowserHolder = `session:${input.session}`;
      const surface = surfaces.get(surfId) ?? create(surfId, input.owner);
      surface.holderState.holders.add(holder);

      return operate(surface, async (contents) => {
        if (contents.isDestroyed()) return CLOSED;

        if (contents.getURL() !== target || surface.error !== undefined) {
          load(surface, target);
        }

        apply(surface);

        // Tell the renderer so it can reveal the Browser tab for this surface.
        dependencies.emit({
          kind: "browser_agent_opened",
          surface: surfId,
          session: input.session,
          owner: input.owner.kind === "project" ? input.owner.path : null,
          url: target,
          state: stateOf(surface),
        });

        await waitForSettle(contents, input.signal);

        if (contents.isDestroyed()) return CLOSED;

        const state = await takeSnapshot(contents, surface.runtime);

        return { kind: "ok", state };
      });
    },

    async snapshot(input) {
      const surface = surfaceForSession(input.session);

      if (surface === undefined) return CLOSED;

      return operate(surface, async (contents) => {
        if (contents.isDestroyed()) return CLOSED;
        const state = await takeSnapshot(contents, surface.runtime, input.ref);

        return { kind: "ok", state };
      });
    },

    async click(input) {
      const surface = surfaceForSession(input.session);

      if (surface === undefined) return CLOSED;

      return operate(surface, (contents) =>
        performClick(
          contents,
          surface.runtime,
          input.ref,
          input.button ?? "left",
          input.double ?? false,
          isWindowShown(surface),
          input.signal,
        ),
      );
    },

    async type(input) {
      const surface = surfaceForSession(input.session);

      if (surface === undefined) return CLOSED;

      return operate(surface, (contents) =>
        performType(
          contents,
          surface.runtime,
          input.ref,
          input.text,
          input.clear ?? false,
          input.submit ?? false,
          isWindowShown(surface),
          input.signal,
        ),
      );
    },

    async press(input) {
      const surface = surfaceForSession(input.session);

      if (surface === undefined) return CLOSED;

      return operate(surface, (contents) =>
        performPress(
          contents,
          surface.runtime,
          input.key,
          input.ref,
          isWindowShown(surface),
          input.signal,
        ),
      );
    },

    async scroll(input) {
      const surface = surfaceForSession(input.session);

      if (surface === undefined) return CLOSED;

      return operate(surface, (contents) =>
        performScroll(contents, surface.runtime, input, isWindowShown(surface), input.signal),
      );
    },

    async wait(input) {
      const surface = surfaceForSession(input.session);

      if (surface === undefined) return CLOSED;

      return operate(surface, (contents) =>
        performWait(contents, surface.runtime, input, input.signal),
      );
    },

    console(input) {
      const surface = surfaceForSession(input.session);

      if (surface === undefined) return [];

      const entries = surface.runtime.consoleBuffer.slice(0, input.limit);

      if (input.clear) {
        surface.runtime.consoleBuffer.length = 0;
      }

      return entries;
    },

    async evaluate(input) {
      const surface = surfaceForSession(input.session);

      if (surface === undefined) {
        return { kind: "threw", message: "No page is open for this session" };
      }

      return operate(surface, (contents) =>
        performEvaluate(contents, surface.runtime, input.expression, input.ref),
      );
    },

    async capture(input) {
      const surface = surfaceForSession(input.session);

      if (surface === undefined) return undefined;

      return operate(surface, performCapture);
    },

    release(input) {
      const surface = surfaces.get(sessionSurfaceId(input.session));

      if (surface === undefined) return;
      dropHolder(surface, `session:${input.session}`);
    },

    sessionSurfaceId(sessionId) {
      return sessionSurfaceId(sessionId);
    },
  };

  return {
    open({ surface: id, url, owner }, window) {
      const target = webUrl(url);

      if (target === undefined)
        throw new ExpectedHostError({
          code: "invalid_input",
          message: "Only web addresses open in the browser panel.",
          issues: [{ path: "/url", message: "Enter an http or https address" }],
        });
      const surfaceOwner = owner ?? { kind: "home" };
      const surface = surfaces.get(id) ?? create(id, surfaceOwner);

      // Renderer open acts as a view holder retain.
      surface.holderState.holders.add(`view:${id}`);
      surface.home = window;

      const contents = surface.view.webContents;

      if (contents.getURL() !== target || surface.error !== undefined) load(surface, target);
      // The renderer may have sent this surface's bounds before the holder
      // existed, and it will not resend an identical message, so place it now.
      apply(surface);

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
        case "hard-reload":
          surface.error = undefined;
          contents.reloadIgnoringCache();

          return;
        case "stop":
          contents.stop();

          return;
        case "trust-certificate": {
          const host = surface.untrustedHost;

          if (host === undefined) return;
          surface.guestSession.trustedCertificateHosts.add(host);
          surface.untrustedHost = undefined;
          surface.error = undefined;
          contents.reload();

          return;
        }

        case "zoom-in":
        case "zoom-out":
          contents.setZoomFactor(
            nextZoomFactor(contents.getZoomFactor(), action === "zoom-in" ? "in" : "out"),
          );

          return;
        case "zoom-reset":
          contents.setZoomFactor(1);

          return;
        case "toggle-devtools":
          if (contents.isDevToolsOpened()) contents.closeDevTools();
          else contents.openDevTools({ mode: "detach" });

          return;

        default: {
          const _exhaustive: never = action;

          return _exhaustive;
        }
      }
    },
    async menu(input, window) {
      const contents = surfaces.get(input.surface)?.view.webContents;
      const hasPage = contents !== undefined && !contents.isDestroyed() && contents.getURL() !== "";

      return showBrowserMenu({ window: dependencies.window(window), hasPage, input });
    },
    async perform({ surface: id, action, owner: path }, window) {
      const surface = surfaces.get(id);
      // A new tab has no page in main yet, so the panel names its cookie jar.
      const owner = surface?.owner ?? ownerOf(path);

      if (action === "clear-history") {
        for (const other of surfaces.values()) {
          const contents = other.view.webContents;

          // History is per cookie jar, so only the requesting panel's jar is cleared.
          if (ownerPath(other.owner) !== ownerPath(owner) || contents.isDestroyed()) continue;
          contents.navigationHistory.clear();
          other.visited = undefined;
          publish(other);
        }

        publishHistory(owner, await dependencies.history.clear(owner));

        return;
      }

      return performBrowserAction({
        action,
        contents: surface?.view.webContents,
        guest: ensureGuestSession(owner).session,
        window: dependencies.window(window),
      });
    },
    close({ surface: id }) {
      const surface = surfaces.get(id);

      if (surface === undefined) return;
      // Renderer close releases the view holder, not an immediate destroy.
      dropHolder(surface, `view:${id}`);
    },
    retain({ surface: id, holder, owner }) {
      const surfaceOwner = owner ?? { kind: "home" };
      const surface = surfaces.get(id) ?? create(id, surfaceOwner);
      surface.holderState.holders.add(holder);
      apply(surface);
    },
    release({ surface: id, holder }) {
      const surface = surfaces.get(id);

      if (surface === undefined) return;
      dropHolder(surface, holder);
    },
    async captureFrame({ surface: id }) {
      const surface = surfaces.get(id);

      if (surface === undefined) return undefined;
      const contents = surface.view.webContents;

      if (contents.isDestroyed() || contents.getURL() === "") return undefined;

      try {
        // stayHidden keeps an already-hidden page from flashing into view, and
        // lets an occluded page still answer with its last pixels.
        const image = await contents.capturePage(undefined, { stayHidden: true });

        return image.isEmpty() ? undefined : image.toDataURL();
      } catch {
        return undefined;
      }
    },
    find({ surface: id, text, direction }) {
      const surface = surfaces.get(id);
      const contents = surface?.view.webContents;
      const none = { active: 0, total: 0 };

      if (surface === undefined || contents === undefined || contents.isDestroyed())
        return Promise.resolve(none);
      surface.find?.resolve(none);
      surface.find = undefined;

      if (text === "") {
        surface.findText = "";
        contents.stopFindInPage("clearSelection");

        return Promise.resolve(none);
      }

      return new Promise((resolve) => {
        const request = contents.findInPage(text, {
          forward: direction === "next",
          findNext: text !== surface.findText,
          matchCase: false,
        });

        surface.findText = text;
        surface.find = { request, resolve };
      });
    },
    cancelDownload({ id }) {
      downloads.get(id)?.cancel();
    },
    history({ owner }) {
      return dependencies.history.entries(ownerOf(owner));
    },
    async forgetHistory({ owner: path, url }) {
      const owner = ownerOf(path);
      publishHistory(owner, await dependencies.history.remove(owner, url));
    },
    login({ surface: id, credentials }) {
      const surface = surfaces.get(id);
      const answer = surface?.login;

      if (surface === undefined || answer === undefined) return;
      surface.login = undefined;

      if (credentials === undefined) answer();
      else answer(credentials.username, credentials.password);
    },
    setBounds({ surface: id, bounds, visible }, window) {
      const surface = surfaces.get(id);

      if (surface === undefined) return;

      if (visible) surface.home = window;

      const roundedBounds = {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      };

      surface.bounds = roundedBounds;
      surface.visible = visible;

      if (roundedBounds.width > 0 && roundedBounds.height > 0) {
        surface.holderState.lastBounds = roundedBounds;
      }

      apply(surface);
    },
    setFocus({ surface: id, focused }, window) {
      if (!focused) {
        if (chromeFocus.get(window) === id) chromeFocus.delete(window);

        return;
      }

      chromeFocus.set(window, id);
      const host = dependencies.window(window);

      // A shortcut pressed in the page can move focus to the address bar; typing must follow it.
      if (host !== undefined && !host.isDestroyed() && !host.webContents.isFocused())
        host.webContents.focus();
    },
    focused(window) {
      const focusedContents = webContents.getFocusedWebContents();

      if (focusedContents) {
        for (const surface of surfaces.values()) {
          const contents = surface.view.webContents;

          if (contents.isDestroyed()) continue;

          if (contents === focusedContents || contents.devToolsWebContents === focusedContents)
            return surface.id;
        }
      }

      return window === undefined ? undefined : chromeFocus.get(window);
    },
    warm() {
      return ensureBlocker();
    },
    settingsChanged() {
      for (const surface of surfaces.values()) publish(surface);
    },
    releaseWindow(window) {
      chromeFocus.delete(window);

      for (const surface of surfaces.values()) {
        if (surface.home !== window) continue;
        surface.home = undefined;
        surface.attachedTo = undefined;
        dropHolder(surface, `view:${surface.id}`);
      }
    },
    agent,
  };
}

/**
 * Resolve once the page is worth reading. Measured on Electron 44: a response the
 * server never completes fires no event at all, not even `dom-ready`, so the bounded
 * wait is the only exit from it; a view destroyed mid-load fires only `destroyed`.
 * Returning while a page still loads is safe because the state carries `loading`, and
 * the model can wait longer with browser_wait.
 */
const SETTLE_LIMIT_MS = 10_000;

function waitForSettle(contents: WebContents, signal?: AbortSignal): Promise<void> {
  if (contents.isDestroyed() || !contents.isLoading()) return Promise.resolve();

  return new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const done = () => {
      if (timer !== undefined) clearTimeout(timer);
      contents.removeListener("did-stop-loading", done);
      contents.removeListener("did-fail-load", done);
      contents.removeListener("destroyed", done);
      signal?.removeEventListener("abort", done);
      resolve();
    };

    timer = setTimeout(done, SETTLE_LIMIT_MS);
    contents.on("did-stop-loading", done);
    contents.on("did-fail-load", done);
    contents.on("destroyed", done);
    signal?.addEventListener("abort", done, { once: true });
  });
}
