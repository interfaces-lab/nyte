/** Browser panel pages: one `WebContentsView` per surface, plus the guest sessions, holders, and agent control over them. */
import { createHash } from "node:crypto";
import { app, session, WebContentsView } from "electron";
import type { BrowserWindow, Session, WebContents } from "electron";
import { showBrowserMenu, performBrowserAction } from "./browser-actions.ts";
import type {
  BrowserBoundsMessage,
  BrowserNavigationAction,
  BrowserSurfaceState,
  HostEvent,
  HostBridge,
} from "../shared/ipc.ts";
import type { SessionId } from "@nyte-ai/core";
import { loadBlocker, type Blocker } from "./adblock.ts";
import {
  httpsUpgrade,
  permissionAllowed,
  plainRetry,
  surfaceSecurity,
  webUrl,
} from "./browser-policy.ts";
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

function partitionName(owner: BrowserOwner): string {
  if (owner.kind === "home") return "persist:nyte-browser";
  const hash = createHash("sha256").update(owner.path).digest("hex").slice(0, 16);

  return `persist:nyte-browser-${hash}`;
}

export interface BrowserSurfaces {
  menu(
    input: Parameters<HostBridge["browser"]["menu"]>[0],
    window: HostWindow,
  ): ReturnType<HostBridge["browser"]["menu"]>;
  perform(
    input: Parameters<HostBridge["browser"]["perform"]>[0],
    window: HostWindow,
  ): ReturnType<HostBridge["browser"]["perform"]>;
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
  /** The BrowserAgent implementation for the tools plugin. */
  agent: BrowserAgent;
}

export interface BrowserSurfacesDependencies {
  /** The open window with this id, or the last focused one when it is gone or unset. */
  readonly window: (id: HostWindow | undefined) => BrowserWindow | undefined;
  readonly emit: (event: HostEvent) => void;
  readonly filterListPath: string;
  /** Whether the window has been shown at least once. Mouse input is dropped until then. */
  readonly windowShown: (window: BrowserWindow) => boolean;
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

export function createBrowserSurfaces(dependencies: BrowserSurfacesDependencies): BrowserSurfaces {
  const surfaces = new Map<string, Surface>();
  const byWebContents = new Map<number, Surface>();
  let blocker: Blocker | undefined;
  let blockerReady: Promise<void> | undefined;
  let useClock = 0;

  /** Per-owner guest sessions, keyed by partition name. */
  const guestSessions = new Map<string, GuestSession>();

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

    guest.setPermissionRequestHandler((_contents, permission, callback) => {
      callback(permissionAllowed(permission));
    });
    guest.setPermissionCheckHandler((_contents, permission) => permissionAllowed(permission));

    guest.on("will-download", (event, item, contents) => {
      event.preventDefault();
      const surfaceId = byWebContents.get(contents.id)?.id;

      if (surfaceId !== undefined) {
        dependencies.emit({
          kind: "browser_download_refused",
          surface: surfaceId,
          url: item.getURL(),
        });
      }
    });

    guest.webRequest.onBeforeRequest((details, callback) => {
      if (blocker !== undefined) {
        const decision = blocker.decide(details);

        if (decision.kind !== "allow") {
          if (details.webContentsId !== undefined) {
            const surface = byWebContents.get(details.webContentsId);

            if (surface !== undefined) surface.blocked += 1;
          }

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

    const guestSession: GuestSession = { session: guest, plainHosts, upgrades };
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
        blocking: blocker !== undefined,
        blocked: surface.blocked,
        error: surface.error,
        agentHolders,
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
      agentHolders,
    };
  };

  const publish = (surface: Surface): void => {
    if (surface.destroyed) return;
    dependencies.emit({ kind: "browser_changed", surface: surface.id, state: stateOf(surface) });
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
    contents.on("did-stop-loading", () => {
      publish(surface);
      reclaimIdle();
    });
    contents.on("did-navigate", () => {
      guestSession.upgrades.delete(contents.id);
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
        const retry = plainRetry(validatedURL, guestSession.upgrades.get(contents.id), errorCode);
        guestSession.upgrades.delete(contents.id);

        if (retry !== undefined) {
          guestSession.plainHosts.add(new URL(retry).host);
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
      surface.runtime.error = surface.error;
      apply(surface);
      publish(surface);
    });

    attachConsoleCapture(contents, surface.runtime);
  };

  const create = (id: string, owner: BrowserOwner): Surface => {
    const guestSession = ensureGuestSession(owner);

    const view = new WebContentsView({
      webPreferences: {
        session: guestSession.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
        devTools: false,
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
    const contents = surface.view.webContents;
    byWebContents.delete(contents.id);
    surface.guestSession.upgrades.delete(contents.id);
    const window = surface.attachedTo;

    if (window !== undefined && !window.isDestroyed()) {
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

      if (target === undefined) throw new Error("Only web addresses can open in the browser panel");
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
        case "stop":
          contents.stop();

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
    async perform({ surface: id, action }, window) {
      if (action === "clear-history") {
        const requestingSurface = surfaces.get(id);
        const requestingOwner = requestingSurface?.owner;

        for (const surface of surfaces.values()) {
          // History is per cookie jar, so only the requesting surface's owner is cleared.
          if (requestingOwner !== undefined) {
            if (surface.owner.kind !== requestingOwner.kind) continue;

            if (
              surface.owner.kind === "project" &&
              requestingOwner.kind === "project" &&
              surface.owner.path !== requestingOwner.path
            )
              continue;
          }

          const contents = surface.view.webContents;

          if (contents.isDestroyed()) continue;
          contents.navigationHistory.clear();
          publish(surface);
        }

        return;
      }

      const surface = surfaces.get(id);

      return performBrowserAction({
        action,
        contents: surface?.view.webContents,
        guest: ensureGuestSession(surface?.owner ?? { kind: "home" }).session,
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
    warm() {
      return ensureBlocker();
    },
    releaseWindow(window) {
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
